"""Phase 2 - season scoring, served from the Parquet dataset with DuckDB.

The dataset is produced by ``backend/pipeline/build_dataset.py``. DuckDB reads
the Parquet files in place (no import step) through the views defined below.
See docs/03-phase2-dataset.md.
"""
from __future__ import annotations

import math

import duckdb
import pandas as pd

from .config import DATA_DIR

_D = DATA_DIR.as_posix()


def _per_round(table: str, extra: str = "") -> str:
    """Files are data/<table>/season=YYYY/round=RR.parquet. DuckDB's Hive
    partitioning reads `season` from the folder; `round` comes from the file name."""
    return (f"SELECT * EXCLUDE (filename), "
            f"CAST(regexp_extract(filename, 'round=(\d+)', 1) AS INTEGER) AS round "
            f"FROM read_parquet('{_D}/{table}/*/*.parquet', hive_partitioning = true, "
            f"union_by_name = true, filename = true{extra})")


VIEWS = {
    "events": (f"SELECT * EXCLUDE (filename), "
               f"CAST(regexp_extract(filename, 'season=(\d+)', 1) AS INTEGER) AS season "
               f"FROM read_parquet('{_D}/events/*.parquet', filename = true)"),
    "results": _per_round("results"),
    "qualifying": _per_round("qualifying"),
    "driver_race": _per_round("driver_race"),
    "stints": _per_round("stints"),
    "weather": _per_round("weather"),
    "driver_standings": f"SELECT * FROM read_parquet('{_D}/driver_standings.parquet')",
    "constructor_standings": f"SELECT * FROM read_parquet('{_D}/constructor_standings.parquet')",
    # ---- ML-ready views (derived; see docs/03-phase2-dataset.md) -------------
    # One row per driver per Grand Prix. Columns are split into FEATURES (known
    # before the race starts) and TARGETS / post-race facts, to avoid leakage.
    "ml_race_features": """
        WITH race AS (SELECT * FROM results WHERE session = 'race'),
        quali AS (
            SELECT season, round, driver_id, position AS quali_position,
                   segment_gap_pct AS quali_gap_pct, last_segment AS quali_segment
            FROM qualifying WHERE session = 'qualifying'),
        form AS (   -- rolling form over the previous 3 Grands Prix of the season
            SELECT season, round, driver_id,
                   avg(position) OVER w AS avg_finish_last3,
                   avg(points) OVER w AS avg_points_last3,
                   sum(CASE WHEN dnf THEN 1 ELSE 0 END) OVER w AS dnfs_last3
            FROM race
            WINDOW w AS (PARTITION BY season, driver_id ORDER BY round
                         ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING))
        SELECT
            r.season, r.round, e.event_name, e.location, e.event_format,
            r.driver_id, r.driver_code, r.team_id,
            -- features: known before lights out
            r.grid, r.pit_lane_start, q.quali_position, q.quali_gap_pct, q.quali_segment,
            coalesce(ds.points, 0)   AS driver_points_before,
            ds.position              AS driver_rank_before,
            coalesce(ds.wins, 0)     AS driver_wins_before,
            coalesce(cs.points, 0)   AS team_points_before,
            cs.position              AS team_rank_before,
            f.avg_finish_last3, f.avg_points_last3, f.dnfs_last3,
            -- targets / post-race facts: do NOT use as features for this race
            r.position               AS finish_position,
            r.points                 AS points_scored,
            r.dnf, r.status,
            r.position = 1           AS won,
            r.position <= 3          AS podium,
            dr.pace_gap_pct, dr.pit_stops, dr.laps_led, dr.pos_after_lap1,
            wr.rain_fraction         AS race_rain_fraction,
            wr.track_temp_mean       AS race_track_temp
        FROM race r
        LEFT JOIN events e      ON e.season = r.season AND e.round = r.round
        LEFT JOIN quali q       ON q.season = r.season AND q.round = r.round AND q.driver_id = r.driver_id
        LEFT JOIN driver_standings ds ON ds.season = r.season AND ds.round = r.round - 1 AND ds.driver_id = r.driver_id
        LEFT JOIN constructor_standings cs ON cs.season = r.season AND cs.round = r.round - 1 AND cs.team_id = r.team_id
        LEFT JOIN form f        ON f.season = r.season AND f.round = r.round AND f.driver_id = r.driver_id
        LEFT JOIN driver_race dr ON dr.season = r.season AND dr.round = r.round AND dr.driver_code = r.driver_code AND dr.session = 'race'
        LEFT JOIN weather wr    ON wr.season = r.season AND wr.round = r.round AND wr.session = 'race'
        ORDER BY r.season, r.round, r.position""",
    # One row per driver per season: the championship outcome (label) plus
    # season aggregates.
    "ml_season_summary": """
        WITH last AS (SELECT season, max(round) AS round FROM driver_standings GROUP BY 1),
        agg AS (
            SELECT season, driver_id,
                   avg(quali_position) AS avg_quali_position, avg(quali_gap_pct) AS avg_quali_gap_pct,
                   avg(grid) FILTER (WHERE grid > 0) AS avg_grid,
                   avg(finish_position) FILTER (WHERE NOT dnf) AS avg_finish,
                   avg(pace_gap_pct) AS avg_race_pace_gap_pct
            FROM ml_race_features f
            WHERE f.round <= (SELECT round FROM last WHERE last.season = f.season)
            GROUP BY 1, 2)
        SELECT ds.season, ds.driver_id, ds.driver_code, ds.driver_name, ds.team_id, ds.team_name,
               ds.round AS rounds_counted, ds.points, ds.position AS final_position,
               ds.wins, ds.podiums, ds.races, ds.dnfs,
               a.avg_quali_position, a.avg_quali_gap_pct, a.avg_grid, a.avg_finish, a.avg_race_pace_gap_pct,
               ds.position = 1 AS champion
        FROM driver_standings ds
        JOIN last USING (season, round)
        LEFT JOIN agg a ON a.season = ds.season AND a.driver_id = ds.driver_id
        ORDER BY ds.season, ds.position""",
}


def connect() -> duckdb.DuckDBPyConnection:
    """In-memory DuckDB with one view per dataset table (missing tables skipped)."""
    con = duckdb.connect()
    for name, src in VIEWS.items():
        try:
            con.execute(f"CREATE VIEW {name} AS {src}")
        except duckdb.Error:
            pass  # table not built yet
    return con


def _records(df: pd.DataFrame) -> list[dict]:
    out = []
    for r in df.to_dict("records"):
        out.append({k: (None if isinstance(v, float) and math.isnan(v) else
                        v.item() if hasattr(v, "item") else v) for k, v in r.items()})
    return out


def dataset_status() -> dict:
    con = connect()
    tables = []
    for name in VIEWS:
        try:
            n = con.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
            cols = con.execute(f"DESCRIBE {name}").df()[["column_name", "column_type"]]
            seasons = []
            if "season" in cols["column_name"].values:
                seasons = [int(s) for (s,) in con.execute(f"SELECT DISTINCT season FROM {name} ORDER BY 1").fetchall()]
            tables.append({"name": name, "rows": int(n), "seasons": seasons,
                           "columns": _records(cols.rename(columns={"column_name": "name", "column_type": "type"}))})
        except duckdb.Error:
            tables.append({"name": name, "rows": 0, "seasons": [], "columns": []})
    return {"tables": tables}


def season_summary(year: int) -> dict:
    con = connect()
    q = lambda sql, *p: con.execute(sql, list(p)).df()  # noqa: E731

    try:
        events = q("SELECT round, event_name, country, location, event_date, event_format FROM events "
                   "WHERE season = ? ORDER BY round", year)
    except duckdb.Error:
        return {"available": False}
    try:
        res = q("SELECT * FROM results WHERE season = ? ORDER BY round, session, position", year)
    except duckdb.Error:
        res = pd.DataFrame()
    if res.empty:
        return {"available": False, "events": _records(events.assign(event_date=events["event_date"].astype(str)))}

    done = sorted(res["round"].astype(int).unique().tolist())
    last = done[-1]
    ds = q("SELECT * FROM driver_standings WHERE season = ? ORDER BY round, position", year)
    cs = q("SELECT * FROM constructor_standings WHERE season = ? ORDER BY round, position", year)
    final_d = ds[ds["round"] == last].sort_values("position")
    final_c = cs[cs["round"] == last].sort_values("position")

    # Extra per-driver stats for the season table.
    gp = res[res["session"] == "race"]
    poles = pd.Series(dtype=int)
    try:
        ql = q("SELECT driver_id, count(*) AS n FROM qualifying WHERE season = ? AND session = 'qualifying' "
               "AND position = 1 GROUP BY 1", year)
        poles = ql.set_index("driver_id")["n"]
    except duckdb.Error:
        pass
    sprint_pts = res[res["session"] == "sprint"].groupby("driver_id")["points"].sum()
    avg_grid = gp[gp["grid"] > 0].groupby("driver_id")["grid"].mean()
    avg_finish = gp[gp["finished"]].groupby("driver_id")["position"].mean()
    best = gp.groupby("driver_id")["position"].min()
    final_d = final_d.assign(
        poles=final_d["driver_id"].map(poles).fillna(0).astype(int),
        sprint_points=final_d["driver_id"].map(sprint_pts).fillna(0),
        avg_grid=final_d["driver_id"].map(avg_grid).round(1),
        avg_finish=final_d["driver_id"].map(avg_finish).round(1),
        best_finish=final_d["driver_id"].map(best),
    )

    # Round-by-round matrix (driver x round) for the results grid.
    cells = res[["round", "session", "driver_id", "grid", "position", "classified_position",
                 "status", "points", "finished"]].copy()

    # Teammate head-to-head (race finish and qualifying position).
    h2h = []
    try:
        qq = q("SELECT round, driver_id, team_id, position FROM qualifying WHERE season = ? "
               "AND session = 'qualifying'", year)
    except duckdb.Error:
        qq = pd.DataFrame(columns=["round", "driver_id", "team_id", "position"])
    for team, tg in gp.groupby("team_id"):
        drivers = tg.groupby("driver_id")["round"].nunique().sort_values(ascending=False).index[:2].tolist()
        if len(drivers) < 2:
            continue
        a, b = drivers
        def duel(df):
            p = df[df["driver_id"].isin([a, b])].pivot_table(index="round", columns="driver_id", values="position")
            p = p.dropna()
            return int((p[a] < p[b]).sum()) if a in p and b in p else 0, int((p[b] < p[a]).sum()) if a in p and b in p else 0
        ra, rb = duel(tg)
        qa, qb = duel(qq[qq["team_id"] == team])
        h2h.append({"team_id": team, "team_name": tg["team_name"].iloc[-1], "team_color": tg["team_color"].iloc[-1],
                    "a": a, "b": b, "race": [ra, rb], "quali": [qa, qb],
                    "points": [float(tg[tg["driver_id"] == a]["points"].sum() + res[(res["session"] == "sprint") & (res["driver_id"] == a)]["points"].sum()),
                               float(tg[tg["driver_id"] == b]["points"].sum() + res[(res["session"] == "sprint") & (res["driver_id"] == b)]["points"].sum())]})
    h2h.sort(key=lambda h: final_c["team_id"].tolist().index(h["team_id"]) if h["team_id"] in final_c["team_id"].tolist() else 99)

    ev = events.assign(event_date=events["event_date"].astype(str), done=events["round"].isin(done))
    return {
        "available": True,
        "season": year,
        "lastRound": last,
        "events": _records(ev),
        "drivers": _records(final_d),
        "constructors": _records(final_c),
        "driverProgress": _records(ds[["round", "driver_id", "points", "position", "round_points"]]),
        "constructorProgress": _records(cs[["round", "team_id", "points", "position", "round_points"]]),
        "cells": _records(cells),
        "h2h": h2h,
    }
