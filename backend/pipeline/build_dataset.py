"""Phase 2 - build the season dataset (Parquet, queried with DuckDB).

Usage (from the project root):
    .venv\\Scripts\\python -m backend.pipeline.build_dataset                 # 2018 -> today
    .venv\\Scripts\\python -m backend.pipeline.build_dataset --seasons 2024 2025
    .venv\\Scripts\\python -m backend.pipeline.build_dataset --no-laps       # results only (minutes)
    .venv\\Scripts\\python -m backend.pipeline.build_dataset --standings-only

The build has two passes:

1. Results pass (fast, minutes). Race, sprint and qualifying classifications for
   a whole season come from the Jolpica-F1 (Ergast) API in a handful of paged
   requests (fastf1.ergast.Ergast). Standings are derived from them.
2. Laps pass (slow, hours, resumable). For every race and sprint, the session's
   lap timing and weather are loaded with FastF1 to derive pace, pit stops,
   tyre stints and weather. FastF1 allows at most 500 API calls per hour (to
   protect the free F1 and Ergast services), so this pass paces itself to stay
   under that budget. Stop it any time; it resumes where it left off.

Output layout (one file per round):

    data/
      events/season=2024.parquet
      results/season=2024/round=05.parquet          Race + Sprint classification
      qualifying/season=2024/round=05.parquet       Qualifying classification
      driver_race/season=2024/round=05.parquet      Per-driver race summary from laps
      stints/season=2024/round=05.parquet           Tyre stints
      weather/season=2024/round=05.parquet          Weather summary per race/sprint
      driver_standings.parquet                      Derived: standings after each round
      constructor_standings.parquet                 Derived: same for teams

Every column is documented in docs/03-phase2-dataset.md.
"""
from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

import fastf1
import fastf1.req
import numpy as np
import pandas as pd
from fastf1.ergast import Ergast

from ..app.config import DATA_DIR, FIRST_SEASON, LAST_SEASON
from ..app import loader  # noqa: F401  (enables the FastF1 cache)

log = logging.getLogger("pipeline")

# Team colours by Ergast constructor id (Ergast itself has no colours).
TEAM_COLORS = {
    "mercedes": "#27F4D2", "ferrari": "#E8002D", "red_bull": "#3671C6", "mclaren": "#FF8000",
    "aston_martin": "#229971", "alpine": "#0093CC", "williams": "#64C4FF", "rb": "#6692FF",
    "alphatauri": "#5E8FAA", "toro_rosso": "#469BFF", "sauber": "#52E252", "alfa": "#C92D4B",
    "haas": "#B6BABD", "renault": "#FFF500", "force_india": "#F596C8", "racing_point": "#F596C8",
    "audi": "#F50537", "cadillac": "#AAAAAD",
}
API_BUDGET = 440        # stay well under FastF1's 500 calls / hour


def td(v) -> float:
    return v.total_seconds() if isinstance(v, pd.Timedelta) else np.nan


def part_path(table: str, year: int, rnd: int) -> Path:
    return DATA_DIR / table / f"season={year}" / f"round={rnd:02d}.parquet"


def write(df: pd.DataFrame, table: str, year: int, rnd: int):
    p = part_path(table, year, rnd)
    p.parent.mkdir(parents=True, exist_ok=True)
    # season/round live in the path - drop them from the file.
    df.drop(columns=["season", "round"], errors="ignore").to_parquet(p, index=False)


# --------------------------------------------------------------------------- #
# Pass 1 - results from the Ergast API (a few paged calls per season)
# --------------------------------------------------------------------------- #
def ergast_all(fetch, season: int) -> dict[int, pd.DataFrame]:
    """All pages of a multi-race Ergast response, merged per round."""
    resp = fetch(season=season)
    pages = [resp]
    while not resp.is_complete:
        try:
            resp = resp.get_next_result_page()
        except ValueError:  # last page reached (is_complete can lag on partial pages)
            break
        pages.append(resp)
    merged: dict[int, list] = {}
    for page in pages:
        for rnd, df in zip(page.description["round"], page.content):
            merged.setdefault(int(rnd), []).append(df)   # a race can span two pages
    return {rnd: pd.concat(dfs, ignore_index=True) for rnd, dfs in merged.items()}


def _results_frame(df: pd.DataFrame, year: int, rnd: int, kind: str) -> pd.DataFrame:
    col = lambda name: df[name] if name in df else pd.Series(np.nan, index=df.index)  # noqa: E731
    out = pd.DataFrame({
        "season": year, "round": rnd, "session": kind,
        "driver_number": df["driverNumber"].astype(str),
        "driver_code": df["driverCode"], "driver_id": df["driverId"],
        "driver_name": df["givenName"] + " " + df["familyName"],
        "nationality": df["driverNationality"],
        "team_id": df["constructorId"], "team_name": df["constructorName"],
        "team_color": df["constructorId"].map(TEAM_COLORS).fillna("#949498"),
        "grid": pd.to_numeric(df["grid"], errors="coerce"),
        "position": pd.to_numeric(df["position"], errors="coerce"),
        "classified_position": df["positionText"].astype(str),
        "status": df["status"],
        "points": pd.to_numeric(df["points"], errors="coerce").fillna(0.0),
        "laps": pd.to_numeric(df["laps"], errors="coerce"),
        "race_time_s": pd.to_numeric(col("totalRaceTimeMillis"), errors="coerce") / 1000,
        "fastest_lap_rank": pd.to_numeric(col("fastestLapRank"), errors="coerce"),
    })
    out["finished"] = out["classified_position"].str.isdigit()
    out["dnf"] = ~out["finished"]
    out["pit_lane_start"] = out["grid"] == 0
    return out


def _quali_frame(df: pd.DataFrame, year: int, rnd: int) -> pd.DataFrame:
    seg_col = lambda name: df[name].map(td) if name in df else pd.Series(np.nan, index=df.index)  # noqa: E731
    out = pd.DataFrame({
        "season": year, "round": rnd, "session": "qualifying",
        "driver_number": df["driverNumber"].astype(str), "driver_code": df["driverCode"],
        "driver_id": df["driverId"], "team_id": df["constructorId"], "team_name": df["constructorName"],
        "position": pd.to_numeric(df["position"], errors="coerce"),
        "q1_s": seg_col("Q1"), "q2_s": seg_col("Q2"), "q3_s": seg_col("Q3"),
    })
    # Conditions change between Q1, Q2 and Q3 (rain!), so a driver is only
    # compared with others in the last segment they took part in.
    seg = out[["q1_s", "q2_s", "q3_s"]]
    out["last_segment"] = np.where(seg.notna(), [1, 2, 3], 0).max(axis=1)
    out["best_s"] = [row[f"q{k}_s"] if k else np.nan for k, (_, row) in zip(out["last_segment"], out.iterrows())]
    seg_best = {k: out[f"q{k}_s"].min() for k in (1, 2, 3)}
    out["segment_gap_pct"] = [100 * (b - seg_best[k]) / seg_best[k] if k else np.nan
                              for k, b in zip(out["last_segment"], out["best_s"])]
    return out


def results_pass(year: int) -> tuple[list[int], list[int]]:
    sched = fastf1.get_event_schedule(year, include_testing=False)
    ev_path = DATA_DIR / "events" / f"season={year}.parquet"
    ev_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame({
        "round": sched["RoundNumber"].astype(int), "event_name": sched["EventName"],
        "country": sched["Country"], "location": sched["Location"],
        "event_date": pd.to_datetime(sched["EventDate"]), "event_format": sched["EventFormat"],
    }).to_parquet(ev_path, index=False)

    e = Ergast(result_type="pandas", auto_cast=True, limit=100)
    races = ergast_all(e.get_race_results, year)
    sprints = ergast_all(e.get_sprint_results, year) if year >= 2021 else {}
    qualis = ergast_all(e.get_qualifying_results, year)
    for rnd, df in races.items():
        frames = [_results_frame(df, year, rnd, "race")]
        if rnd in sprints:
            frames.append(_results_frame(sprints[rnd], year, rnd, "sprint"))
        write(pd.concat(frames, ignore_index=True), "results", year, rnd)
        if rnd in qualis:
            write(_quali_frame(qualis[rnd], year, rnd), "qualifying", year, rnd)
    log.info("%d results: %d races, %d sprints, %d qualifyings", year, len(races), len(sprints), len(qualis))
    return sorted(races), sorted(sprints)


# --------------------------------------------------------------------------- #
# Pass 2 - lap data, paced to FastF1's API budget
# --------------------------------------------------------------------------- #
def _recent_calls() -> int:
    """API calls FastF1 made in the last hour, read from its own rate limiter."""
    now = time.time()
    for limiters in fastf1.req._SessionWithRateLimiting._RATE_LIMITS.values():
        for lim in limiters:
            if getattr(lim, "_info", "").startswith("any API"):
                return sum(1 for t in lim._timestamps if t > now - 3600)
    return 0


def _wait_for_budget(need: int = 60):
    while _recent_calls() > API_BUDGET - need:
        log.info("API budget: %d calls in the last hour - pausing 5 min", _recent_calls())
        time.sleep(300)


class NoTimingData(Exception):
    """The F1 archive has no lap timing for this session (a few old races)."""


MISSING = DATA_DIR / "laps_missing.txt"   # rounds with no timing data, skipped next time


def _load_laps(year: int, rnd: int, name: str):
    """Load a session's laps. A failed load is retried twice, 15 minutes apart:
    the F1 servers also throttle on their side, and a throttled load looks
    exactly like a session with no data. Only a session that fails all three
    times is recorded as missing."""
    for attempt in range(3):
        _wait_for_budget()
        s = fastf1.get_session(year, rnd, name)
        s.load(laps=True, telemetry=False, weather=True, messages=False)
        try:
            _ = s.laps
            return s
        except fastf1.core.DataNotLoadedError:
            if attempt < 2:
                log.warning("%d R%02d %s: no lap data (try %d/3), retrying in 15 min", year, rnd, name, attempt + 1)
                time.sleep(900)
    raise NoTimingData(f"{year} R{rnd:02d} {name}")


def weather_rows(s, year, rnd, kind) -> pd.DataFrame:
    w = s.weather_data
    if w is None or w.empty:
        return pd.DataFrame()
    return pd.DataFrame([{
        "season": year, "round": rnd, "session": kind,
        "air_temp_mean": w["AirTemp"].mean(), "track_temp_mean": w["TrackTemp"].mean(),
        "track_temp_max": w["TrackTemp"].max(), "humidity_mean": w["Humidity"].mean(),
        "pressure_mean": w["Pressure"].mean(), "wind_speed_mean": w["WindSpeed"].mean(),
        "rain_fraction": w["Rainfall"].astype(float).mean(),
    }])


def lap_tables(s, year, rnd, kind) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Per-driver race summary and tyre stints, from ``session.laps``."""
    laps = s.laps
    if laps is None or laps.empty:
        return pd.DataFrame(), pd.DataFrame()
    laps = laps.copy()
    laps["t"] = laps["LapTime"].map(td)
    # "Clean" laps: green flag, not in/out laps, timing marked accurate.
    clean = laps[(laps["TrackStatus"] == "1") & laps["PitInTime"].isna()
                 & laps["PitOutTime"].isna() & (laps["IsAccurate"] == True)]  # noqa: E712
    ref_pace = clean.groupby("Driver")["t"].median().min()

    rows, stints = [], []
    for drv, dl in laps.groupby("Driver"):
        dl = dl.sort_values("LapNumber")
        dc = clean[clean["Driver"] == drv]
        rows.append({
            "season": year, "round": rnd, "session": kind, "driver_code": drv,
            "driver_number": str(dl["DriverNumber"].iloc[0]),
            "laps_completed": int(dl["LapNumber"].max()),
            "laps_led": int((dl["Position"] == 1).sum()),
            "pos_after_lap1": dl.loc[dl["LapNumber"] == 1, "Position"].min(),
            "pit_stops": int(dl["PitInTime"].notna().sum()),
            "stints": int(dl["Stint"].nunique()),
            "compounds_used": ",".join(dict.fromkeys(dl["Compound"].dropna())),
            "best_lap_s": dl["t"].min(),
            "median_clean_lap_s": dc["t"].median(),
            "clean_laps": int(len(dc)),
            "pace_gap_pct": 100 * (dc["t"].median() - ref_pace) / ref_pace if len(dc) else np.nan,
            "lap_time_std_s": dc["t"].std(),
            "top_speed_trap": dl["SpeedST"].max(),
        })
        for st, sl in dl.groupby("Stint"):
            sc = sl[sl.index.isin(dc.index)]
            # Degradation: slope of clean lap time vs. tyre age (s per lap).
            try:
                slope = np.polyfit(sc["TyreLife"], sc["t"], 1)[0] if len(sc) >= 5 else np.nan
            except (np.linalg.LinAlgError, ValueError):  # degenerate stint (e.g. NaN tyre ages)
                slope = np.nan
            stints.append({
                "season": year, "round": rnd, "session": kind, "driver_code": drv,
                "stint": int(st), "compound": sl["Compound"].iloc[0],
                "fresh_tyre": bool(sl["FreshTyre"].iloc[0]) if pd.notna(sl["FreshTyre"].iloc[0]) else None,
                "lap_start": int(sl["LapNumber"].min()), "lap_end": int(sl["LapNumber"].max()),
                "laps": int(len(sl)), "tyre_life_start": sl["TyreLife"].min(),
                "median_lap_s": sc["t"].median(), "deg_s_per_lap": slope,
            })
    return pd.DataFrame(rows), pd.DataFrame(stints)


def laps_pass(year: int, races: list[int], sprints: list[int], force: bool):
    missing = set(MISSING.read_text().split()) if MISSING.exists() else set()
    for rnd in races:
        if (part_path("driver_race", year, rnd).exists() or f"{year}-{rnd}" in missing) and not force:
            continue
        t0 = time.time()
        acc = {"driver_race": [], "stints": [], "weather": []}
        try:
            names = [("Race", "race")]
            if rnd in sprints:  # the 2021 sprints were officially "Sprint Qualifying"
                names.insert(0, ("Sprint Qualifying" if year == 2021 else "Sprint", "sprint"))
            for name, kind in names:
                s = _load_laps(year, rnd, name)
                dr, st = lap_tables(s, year, rnd, kind)
                acc["driver_race"].append(dr); acc["stints"].append(st)
                acc["weather"].append(weather_rows(s, year, rnd, kind))
            for table, frames in acc.items():
                frames = [f for f in frames if not f.empty]
                if frames:
                    write(pd.concat(frames, ignore_index=True), table, year, rnd)
            log.info("%d R%02d laps done in %3.0fs (%d API calls in the last hour)",
                     year, rnd, time.time() - t0, _recent_calls())
        except NoTimingData as exc:
            log.warning("%s: no lap timing in the F1 archive - recorded in %s", exc, MISSING.name)
            with MISSING.open("a") as f:
                f.write(f"{year}-{rnd}\n")
        except Exception as exc:  # noqa: BLE001 - keep going, report at the end
            log.error("%d R%02d laps FAILED: %s: %s", year, rnd, type(exc).__name__, exc)


# --------------------------------------------------------------------------- #
# Derived tables: standings after every round
# --------------------------------------------------------------------------- #
def _rank_with_countback(df: pd.DataFrame, key: str) -> pd.Series:
    """FIA tie-break: equal points are split by number of wins, then 2nds, ...
    (Grand Prix results only)."""
    counts = df[[f"p{k}" for k in range(1, 21)]].to_numpy()
    order = sorted(range(len(df)), key=lambda i: (-df["points"].iat[i], *(-counts[i])))
    rank = np.empty(len(df), int)
    rank[order] = np.arange(1, len(df) + 1)
    return pd.Series(rank, index=df.index)


def build_standings():
    from ..app.phase2 import connect
    res = connect().execute("SELECT * FROM results").df()
    if res.empty:
        return
    res["season"] = res["season"].astype(int); res["round"] = res["round"].astype(int)

    for entity, key, extra in (("driver", "driver_id", ["driver_code", "driver_name", "team_id", "team_name", "team_color"]),
                               ("constructor", "team_id", ["team_name", "team_color"])):
        out = []
        for season, sres in res.groupby("season"):
            for rnd in sorted(sres["round"].unique()):
                upto = sres[sres["round"] <= rnd]
                gp = upto[upto["session"] == "race"]
                agg = upto.groupby(key).agg(points=("points", "sum")).reset_index()
                pos = gp.pivot_table(index=key, columns="position", values="points", aggfunc="size", fill_value=0)
                for k in range(1, 21):
                    agg[f"p{k}"] = agg[key].map(pos[k] if k in pos.columns else {}).fillna(0).astype(int)
                agg["wins"] = agg["p1"]
                agg["podiums"] = agg[["p1", "p2", "p3"]].sum(axis=1)
                agg["races"] = agg[key].map(gp.groupby(key)["round"].nunique()).fillna(0).astype(int)
                agg["dnfs"] = agg[key].map(gp[gp["dnf"]].groupby(key).size()).fillna(0).astype(int)
                agg["round_points"] = agg[key].map(sres[sres["round"] == rnd].groupby(key)["points"].sum()).fillna(0)
                agg["position"] = _rank_with_countback(agg, key)
                # Latest identity (a driver can change team mid-season)
                last = upto.sort_values("round").groupby(key)[extra].last()
                agg = agg.join(last, on=key)
                agg["season"], agg["round"] = season, rnd
                out.append(agg)
        df = pd.concat(out, ignore_index=True)
        df = df.drop(columns=[f"p{k}" for k in range(4, 21)])
        df.to_parquet(DATA_DIR / f"{entity}_standings.parquet", index=False)
        log.info("%s standings: %d rows", entity, len(df))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", nargs="*", type=int, default=list(range(FIRST_SEASON, LAST_SEASON + 1)))
    ap.add_argument("--no-laps", action="store_true", help="results pass only (minutes instead of hours)")
    ap.add_argument("--force", action="store_true", help="redo the laps pass for rounds that exist")
    ap.add_argument("--standings-only", action="store_true")
    ap.add_argument("--laps-only", action="store_true", help="skip the results pass (uses the rounds already on disk)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("fastf1").setLevel(logging.ERROR)

    if args.standings_only:
        build_standings()
        return
    if args.laps_only:
        from ..app.phase2 import connect
        df = connect().execute("SELECT DISTINCT season, round, session FROM results").df()
        rounds = {y: (sorted(df[(df.season == y) & (df.session == "race")]["round"]),
                      sorted(df[(df.season == y) & (df.session == "sprint")]["round"])) for y in args.seasons}
    else:
        rounds = {y: results_pass(y) for y in args.seasons}
        build_standings()                   # the Season page is complete from here
    if not args.no_laps:
        for y in args.seasons:
            laps_pass(y, *rounds[y], force=args.force)


if __name__ == "__main__":
    main()
