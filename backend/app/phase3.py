"""Phase 3 - analysis at race level (FastF1 session) and season level (dataset).

Race level  : tyre strategy, race pace, tyre degradation (fuel corrected),
              track character (speed, throttle, braking) and corner-type
              performance per team.
Season level: points per driver within each team, qualifying vs race,
              form, reliability and pace (from the Phase 2 dataset).

See docs/05-phase3-analysis.md for every formula.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from . import phase1
from .loader import load_session
from .phase2 import _records, connect
from .utils import arr, num, rotate, secs

# Fuel correction: cars start with ~100 kg of fuel and burn it evenly; every kg
# costs ~0.03 s per lap (a common engineering rule of thumb).
FUEL_START_KG = 100.0
FUEL_S_PER_KG = 0.03
# Corner classes by minimum speed on the session's fastest lap (km/h).
SLOW, FAST = 125, 200


def corner_class(v: float) -> str:
    return "slow" if v < SLOW else "fast" if v >= FAST else "medium"


def _neutralised(laps: pd.DataFrame) -> dict[int, str]:
    """Lap number -> 'SC', 'VSC' or 'RED' when the race was neutralised.

    `TrackStatus` holds every status code seen during the lap, e.g. "1", "24",
    "671": 4 = Safety Car, 6/7 = Virtual Safety Car, 5 = red flag."""
    out = {}
    for n, st in laps.groupby("LapNumber")["TrackStatus"]:
        codes = "".join(st.dropna().astype(str))
        if "5" in codes:
            out[int(n)] = "RED"
        elif "4" in codes:
            out[int(n)] = "SC"
        elif "6" in codes or "7" in codes:
            out[int(n)] = "VSC"
    return out


# --------------------------------------------------------------------------- #
# Race level
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=8)
def race_analysis(year: int, rnd: int, name: str) -> dict:
    s = load_session(year, rnd, name)
    ov = phase1.session_overview(year, rnd, name)
    laps = s.laps.copy()
    laps["t"] = laps["LapTime"].dt.total_seconds()
    total = int(laps["LapNumber"].max())
    fuel_k = FUEL_S_PER_KG * FUEL_START_KG / max(total, 1)          # s per lap of fuel
    laps["t_fc"] = laps["t"] - fuel_k * (total - laps["LapNumber"])  # fuel corrected
    neutral = _neutralised(laps)
    laps["clean"] = ((laps["TrackStatus"] == "1") & laps["PitInTime"].isna() & laps["PitOutTime"].isna()
                     & (laps["IsAccurate"] == True) & (laps["LapNumber"] > 1))  # noqa: E712

    drivers, deg_points, stint_rows = [], {}, []
    for d in ov["drivers"]:
        dl = laps[laps["Driver"] == d["abbr"]].sort_values("LapNumber")
        if dl.empty:
            continue
        stints = []
        for st, sl in dl.groupby("Stint"):
            comp = sl["Compound"].iloc[0] if isinstance(sl["Compound"].iloc[0], str) else "UNKNOWN"
            fresh = sl["FreshTyre"].iloc[0]
            stints.append({"stint": int(st), "compound": comp, "from": int(sl["LapNumber"].min()),
                           "to": int(sl["LapNumber"].max()), "fresh": bool(fresh) if pd.notna(fresh) else None,
                           "startLife": num(sl["TyreLife"].min(), 0)})
            # Degradation: slope of fuel-corrected clean laps vs. tyre age,
            # without outliers (> 3 % slower than the stint median: traffic, mistakes).
            sc = sl[sl["clean"]]
            sc = sc[sc["t_fc"] < sc["t_fc"].median() * 1.03]
            sc = sc.dropna(subset=["TyreLife", "t_fc"])
            if len(sc) >= 5 and sc["TyreLife"].nunique() > 1:
                slope, icpt = np.polyfit(sc["TyreLife"], sc["t_fc"], 1)
                base = icpt + slope * sc["TyreLife"].min()
                pts = deg_points.setdefault(comp, [])
                pts += [[float(a), round(float(b - base), 3)] for a, b in zip(sc["TyreLife"], sc["t_fc"])]
                stint_rows.append({"driver": d["abbr"], "team": d["team"], "color": d["color"], "compound": comp,
                                   "laps": int(len(sl)), "slope": round(float(slope), 4),
                                   "pace": round(float(sc["t_fc"].median()), 3)})
        drivers.append({
            "abbr": d["abbr"], "name": d["name"], "team": d["team"], "color": d["color"],
            "position": d["position"], "status": d.get("status"),
            "stints": stints,
            "pits": [int(n) for n in dl.loc[dl["PitInTime"].notna(), "LapNumber"]],
            "laps": {
                "n": dl["LapNumber"].astype(int).tolist(),
                "t": arr(dl["t"], 3), "fc": arr(dl["t_fc"], 3),
                "clean": dl["clean"].astype(bool).tolist(),
                "pos": arr(dl["Position"], 0),
            },
        })

    compounds = []
    for comp, pts in deg_points.items():
        slopes = [r["slope"] for r in stint_rows if r["compound"] == comp]
        pts = np.array(pts)
        if len(pts) > 600:
            pts = pts[np.random.default_rng(0).choice(len(pts), 600, replace=False)]
        compounds.append({"compound": comp, "stints": len(slopes),
                          "median": round(float(np.median(slopes)), 4),
                          "p25": round(float(np.percentile(slopes, 25)), 4),
                          "p75": round(float(np.percentile(slopes, 75)), 4),
                          "points": pts.round(3).tolist()})

    return {
        "event": ov["event"], "session": ov["session"], "totalLaps": total,
        "fuelCorrection": round(fuel_k, 4),
        "neutralised": [{"lap": k, "kind": v} for k, v in sorted(neutral.items())],
        "drivers": drivers,
        "degradation": {"compounds": compounds, "stints": stint_rows},
        "track": track_character(year, rnd, name),
        "cornerPerformance": corner_performance(year, rnd, name),
    }


@lru_cache(maxsize=8)
def track_character(year: int, rnd: int, name: str) -> dict:
    """How the circuit is driven, from the session's fastest lap."""
    s = load_session(year, rnd, name)
    ci = s.get_circuit_info()
    lap = s.laps.pick_fastest()
    tel = lap.get_telemetry()
    d = tel["Distance"].to_numpy(float)
    v = tel["Speed"].to_numpy(float)
    thr = tel["Throttle"].to_numpy(float)
    brk = tel["Brake"].astype(bool).to_numpy()
    step = np.diff(d, prepend=d[0])
    length = d[-1]

    # Braking zones: continuous Brake=on runs longer than 10 m.
    zones = []
    i = 0
    while i < len(brk):
        if brk[i]:
            j = i
            while j + 1 < len(brk) and brk[j + 1]:
                j += 1
            if d[j] - d[i] > 10:
                k = j + int(np.argmin(v[j:min(len(v), j + 15)]))  # apex just after the brakes release
                zones.append({"start": round(d[i], 1), "length": round(d[j] - d[i], 1),
                              "entry": round(float(v[i]), 0), "min": round(float(v[k]), 0)})
            i = j + 1
        else:
            i += 1

    corners = []
    for _, c in ci.corners.iterrows():
        m = np.abs(d - c["Distance"]) < 60
        vmin = float(v[m].min()) if m.any() else float("nan")
        # the braking zone that ends closest before this corner
        before = [z for z in zones if z["start"] < c["Distance"] + 30 and c["Distance"] - (z["start"] + z["length"]) < 120]
        z = before[-1] if before else None
        corners.append({"number": int(c["Number"]), "letter": c["Letter"] or "", "distance": round(float(c["Distance"]), 1),
                        "minSpeed": round(vmin, 0), "kind": corner_class(vmin),
                        "brakeLength": z["length"] if z else 0, "entrySpeed": z["entry"] if z else round(float(v[m].max()), 0) if m.any() else None})

    x, y = rotate(tel["X"], tel["Y"], ci.rotation)
    idx = np.linspace(0, len(d) - 1, min(len(d), 700)).astype(int)
    return {
        "driver": lap["Driver"], "lapTime": secs(lap["LapTime"]), "length": round(length, 0),
        "fullThrottle": round(100 * step[thr >= 98].sum() / length, 1),
        "braking": round(100 * step[brk].sum() / length, 1),
        "topSpeed": round(float(v.max()), 0), "avgSpeed": round(length / secs(lap["LapTime"]) * 3.6, 1),
        "gearChanges": int((np.diff(tel["nGear"].to_numpy()) != 0).sum()),
        "zones": zones, "corners": corners,
        "counts": {k: sum(1 for c in corners if c["kind"] == k) for k in ("slow", "medium", "fast")},
        "map": {"x": arr(x[idx] / 10, 1), "y": arr(y[idx] / 10, 1), "speed": arr(v[idx], 0),
                "brake": [bool(b) for b in brk[idx]], "d": arr(d[idx], 0)},
        "trace": {"d": arr(d[idx], 0), "speed": arr(v[idx], 0), "throttle": arr(thr[idx], 0),
                  "brake": [1 if b else 0 for b in brk[idx]]},
    }


def corner_performance(year: int, rnd: int, name: str) -> list[dict]:
    """Time each team loses to the best car in slow, medium and fast corners.

    Uses the corner-segment times of every driver's fastest lap (Phase 1). The
    corner class comes from the minimum speed on the session's fastest lap.
    Each team is represented by its quicker driver in each class."""
    fp = phase1._fastest_profiles(year, rnd, name)
    tc = track_character(year, rnd, name)
    ov = phase1.session_overview(year, rnd, name)
    kinds = [c["kind"] for c in tc["corners"]]
    prof = fp["profiles"]
    if not prof:
        return []
    seg = np.vstack([p["seg_time"] for p in prof.values()])
    best = np.nanmin(seg, axis=0)
    team_of = {d["abbr"]: (d["team"], d["color"]) for d in ov["drivers"]}
    teams: dict[str, dict] = {}
    for abbr, p in prof.items():
        team, color = team_of.get(abbr, (abbr, "#949498"))
        loss = p["seg_time"] - best
        row = teams.setdefault(team, {"team": team, "color": color, "drivers": []})
        row["drivers"].append(abbr)
        for k in ("slow", "medium", "fast"):
            m = np.array([kk == k for kk in kinds[: len(loss)]])
            if m.any():
                val = float(loss[m].sum())
                row[k] = round(min(row.get(k, val), val), 3)
    out = list(teams.values())
    out.sort(key=lambda r: sum(r.get(k, 0) for k in ("slow", "medium", "fast")))
    return out


# --------------------------------------------------------------------------- #
# Season level
# --------------------------------------------------------------------------- #
def season_analysis(year: int) -> dict:
    con = connect()
    q = lambda sql: con.execute(sql, [year]).df()  # noqa: E731
    res = q("SELECT * FROM results WHERE season = ?")
    if res.empty:
        return {"available": False}
    gp = res[res["session"] == "race"]

    # Points per driver inside each team (race + sprint)
    pts = res.groupby(["team_id", "team_name", "team_color", "driver_code"], as_index=False)["points"].sum()
    teams = []
    for (tid, tname, tcol), g in pts.groupby(["team_id", "team_name", "team_color"]):
        total = float(g["points"].sum())
        teams.append({"team_id": tid, "team": tname, "color": tcol, "points": total,
                      "drivers": [{"driver": r.driver_code, "points": float(r.points),
                                   "share": round(100 * r.points / total, 1) if total else 0}
                                  for r in g.sort_values("points", ascending=False).itertuples()]})
    teams.sort(key=lambda t: -t["points"])

    # Qualifying vs race: average grid, finish and places gained per driver
    qual = q("SELECT driver_id, avg(position) AS avg_quali FROM qualifying WHERE season = ? AND session = 'qualifying' GROUP BY 1")
    fin = gp[gp["finished"]]
    # one row per driver, coloured by their latest team (drivers can switch mid-season)
    racecraft = (gp.sort_values("round").groupby(["driver_id"], as_index=False)
                 .agg(driver_code=("driver_code", "last"), team_color=("team_color", "last"),
                      races=("round", "nunique"), avg_grid=("grid", lambda g: g[g > 0].mean())))
    racecraft["avg_finish"] = racecraft["driver_id"].map(fin.groupby("driver_id")["position"].mean())
    gained = fin[fin["grid"] > 0].assign(g=lambda f: f["grid"] - f["position"]).groupby("driver_id")["g"].mean()
    racecraft["gained"] = racecraft["driver_id"].map(gained)
    racecraft["avg_quali"] = racecraft["driver_id"].map(qual.set_index("driver_id")["avg_quali"])
    racecraft = racecraft[racecraft["races"] >= max(3, gp["round"].nunique() // 3)]

    # Form: points per round, rolling over 5 rounds, for the top 6
    ds = q("SELECT round, driver_code, team_color, round_points, position FROM driver_standings WHERE season = ?")
    last = ds["round"].max()
    top = ds[ds["round"] == last].nsmallest(6, "position")["driver_code"].tolist()
    form = []
    for code in top:
        g = ds[ds["driver_code"] == code].sort_values("round")
        form.append({"driver": code, "color": g["team_color"].iloc[-1],
                     "rounds": g["round"].astype(int).tolist(),
                     "rolling": arr(g["round_points"].rolling(5, min_periods=1).mean(), 2)})

    # Reliability: classified finishes vs retirements, and the causes
    dnf = gp[gp["dnf"]]
    rel = (gp.groupby(["team_id", "team_name", "team_color"], as_index=False)
           .agg(starts=("driver_id", "size"), dnfs=("dnf", "sum")))
    causes = dnf.groupby("team_id")["status"].agg(lambda s: s.value_counts().head(3).to_dict())
    rel["causes"] = rel["team_id"].map(causes)
    rel = rel.sort_values("dnfs", ascending=False)

    # Pace: qualifying gap vs race-pace gap per team (needs the laps pass)
    pace = []
    try:
        qp = q("""SELECT q.round, q.team_id, min(q.segment_gap_pct) AS quali
                  FROM qualifying q WHERE q.season = ? AND q.session = 'qualifying' GROUP BY 1, 2""")
        rp = q("""SELECT d.round, r.team_id, min(d.pace_gap_pct) AS race
                  FROM driver_race d JOIN results r ON r.season = d.season AND r.round = d.round
                       AND r.driver_code = d.driver_code AND r.session = 'race'
                  WHERE d.season = ? AND d.session = 'race' GROUP BY 1, 2""")
        m = qp.merge(rp, on=["round", "team_id"])
        if not m.empty:
            agg = m.groupby("team_id").agg(quali=("quali", "median"), race=("race", "median"), rounds=("round", "nunique")).reset_index()
            names = res.drop_duplicates("team_id").set_index("team_id")
            for r in agg.itertuples():
                pace.append({"team_id": r.team_id, "team": names.loc[r.team_id, "team_name"],
                             "color": names.loc[r.team_id, "team_color"], "quali": round(r.quali, 3),
                             "race": round(r.race, 3), "rounds": int(r.rounds)})
    except Exception:  # noqa: BLE001 - laps pass not run yet for this season
        pace = []

    return {
        "available": True, "season": year, "rounds": int(gp["round"].nunique()),
        "teams": teams,
        "racecraft": _records(racecraft.round(2)),
        "form": form,
        "reliability": _records(rel),
        "pace": pace,
    }
