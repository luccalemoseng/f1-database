"""Phase 1 - historical session comparison.

Everything the "Compare" page shows is computed here from three FastF1 objects:

* ``session.laps``             - one row per lap: lap/sector times, tyres, flags
* ``lap.get_telemetry()``      - car data (speed, throttle, brake, gear, RPM, DRS)
                                 merged with position data (X, Y, Z) + Distance
* ``session.get_circuit_info()`` - corner numbers/positions and map rotation

See docs/02-phase1-compare.md for a step-by-step explanation.
"""
from __future__ import annotations

from functools import lru_cache

import fastf1
import numpy as np
import pandas as pd

from .config import RESAMPLE_POINTS
from .loader import load_session
from .utils import arr, num, rotate, secs, team_color

PURPLE, GREEN, YELLOW = "purple", "green", "yellow"
EPS = 1e-6


# --------------------------------------------------------------------------- #
# Schedule
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=16)
def season_events(year: int) -> list[dict]:
    """All Grands Prix of a season with their sessions (FP1..Race).

    ``fastf1.get_event_schedule`` returns one row per event with columns
    Session1..Session5 (names) and Session1DateUtc..Session5DateUtc.
    """
    sched = fastf1.get_event_schedule(year, include_testing=False)
    now = pd.Timestamp.now(tz="UTC").tz_localize(None)
    events = []
    for _, ev in sched.iterrows():
        sessions = []
        for i in range(1, 6):
            name = ev.get(f"Session{i}")
            date = ev.get(f"Session{i}DateUtc")
            if not isinstance(name, str) or not name or pd.isna(date):
                continue
            date = pd.Timestamp(date)
            if date.tzinfo is not None:
                date = date.tz_convert(None)
            sessions.append({"name": name, "dateUtc": date.isoformat(),
                             "available": bool(date + pd.Timedelta(hours=3) < now)})
        events.append({
            "round": int(ev["RoundNumber"]),
            "name": ev["EventName"],
            "officialName": ev.get("OfficialEventName"),
            "country": ev["Country"],
            "location": ev["Location"],
            "date": pd.Timestamp(ev["EventDate"]).isoformat(),
            "format": ev["EventFormat"],
            "sessions": sessions,
        })
    return events


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _valid_laps(laps):
    """Laps that count for 'best' times: not deleted for track limits."""
    if "Deleted" in laps.columns:
        laps = laps[laps["Deleted"] != True]  # noqa: E712 (column may hold NA)
    return laps


def _status(value, session_best, personal_best) -> str | None:
    """Official F1 timing colours: purple = session best, green = personal
    best, yellow = slower than the driver's own best."""
    if value is None:
        return None
    if session_best is not None and value <= session_best + EPS:
        return PURPLE
    if personal_best is not None and value <= personal_best + EPS:
        return GREEN
    return YELLOW


def _segment_edges(corner_frac: np.ndarray, ref_rel: np.ndarray, ref_speed: np.ndarray) -> np.ndarray:
    """Split the lap into one segment per corner.

    Each boundary sits at the fastest point (on the session's fastest lap)
    between two consecutive corners, so segment i contains the braking zone,
    apex and exit of corner i. Cutting where the cars are fastest minimises
    timing error: a few metres of distance error cost far less time at
    300 km/h than in the middle of a slow chicane.
    """
    mids = []
    for a, b in zip(corner_frac[:-1], corner_frac[1:]):
        m = (ref_rel > a) & (ref_rel < b)
        mids.append(ref_rel[m][np.argmax(ref_speed[m])] if m.sum() > 2 else (a + b) / 2)
    return np.concatenate([[0.0], mids, [1.0]])


def _anchor_to_official(t, rel, lap, sector_frac) -> np.ndarray:
    """Warp the telemetry clock so it matches the official timing.

    Telemetry time is accurate, but the *distance* is integrated from speed and
    drifts by tens of metres. We know exactly when the car crossed each sector
    line (FIA timing loops), so within every sector we rescale time linearly so
    that t(sector line) equals the official split. Validated on Monza 2024 Q:
    this removes a 50-100 ms bias at the sector lines.
    """
    official = [secs(lap["Sector1Time"]), secs(lap["Sector2Time"]), secs(lap["Sector3Time"])]
    if len(sector_frac) != 2 or any(v is None for v in official):
        return t
    anchors_rel = [0.0, sector_frac[0], sector_frac[1], 1.0]
    anchors_off = np.cumsum([0.0] + official)
    anchors_tel = np.interp(anchors_rel, rel, t)
    return np.interp(t, anchors_tel, anchors_off)


# --------------------------------------------------------------------------- #
# Session overview
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=16)
def session_overview(year: int, rnd: int, name: str) -> dict:
    s = load_session(year, rnd, name)
    laps = s.laps
    valid = _valid_laps(laps)
    ci = s.get_circuit_info()

    # Session bests (lap + each sector) across all drivers.
    best = {
        "lap": secs(valid["LapTime"].min()),
        "s1": secs(valid["Sector1Time"].min()),
        "s2": secs(valid["Sector2Time"].min()),
        "s3": secs(valid["Sector3Time"].min()),
    }

    # --- Track outline: the session's fastest lap, rotated like the F1 map ---
    fastest = laps.pick_fastest()
    tel = fastest.get_telemetry()
    x, y = rotate(tel["X"], tel["Y"], ci.rotation)
    lap_len = float(tel["Distance"].max())

    # Sector boundaries: time of the sector end -> distance on that lap.
    st = tel["SessionTime"].dt.total_seconds().to_numpy()
    dist = tel["Distance"].to_numpy()
    sector_frac = []
    for col in ("Sector1SessionTime", "Sector2SessionTime"):
        t_end = secs(fastest[col])
        sector_frac.append(num(np.interp(t_end, st, dist) / lap_len, 4) if t_end else None)

    cx, cy = rotate(ci.corners["X"], ci.corners["Y"], ci.rotation)
    corners = [{
        "number": int(r["Number"]),
        "letter": r["Letter"] or "",
        "x": num(cx[i] / 10, 1), "y": num(cy[i] / 10, 1),
        "frac": num(min(max(r["Distance"] / lap_len, 0), 1), 4),
        "angle": num(r["Angle"], 1),
    } for i, (_, r) in enumerate(ci.corners.iterrows())]

    # --- Drivers ---
    results = s.results
    drivers = []
    for drv in s.drivers:
        info = s.get_driver(drv)
        dl = laps.pick_drivers(drv)
        dv = _valid_laps(dl)
        f = dl.pick_fastest()
        pb = {k: secs(dv[c].min()) for k, c in
              (("s1", "Sector1Time"), ("s2", "Sector2Time"), ("s3", "Sector3Time"))}
        entry = {
            "abbr": info["Abbreviation"],
            "number": str(info["DriverNumber"]),
            "name": info["FullName"],
            "team": info["TeamName"],
            "color": team_color(info["TeamColor"]),
            "headshot": info.get("HeadshotUrl") or None,
            "position": num(info.get("Position"), 0),
            "gridPosition": num(info.get("GridPosition"), 0),
            "points": num(info.get("Points"), 1),
            "status": info.get("Status"),
            "lapsCompleted": int(len(dl)),
            "theoreticalBest": None,
            "fastestLap": None,
        }
        if all(pb.values()):
            entry["theoreticalBest"] = round(pb["s1"] + pb["s2"] + pb["s3"], 3)
        if f is not None and not pd.isna(f["LapTime"]):
            sectors = []
            for k, c in (("s1", "Sector1Time"), ("s2", "Sector2Time"), ("s3", "Sector3Time")):
                v = secs(f[c])
                sectors.append({"time": v, "status": _status(v, best[k], pb[k])})
            lt = secs(f["LapTime"])
            entry["fastestLap"] = {
                "time": lt,
                "lapNumber": int(f["LapNumber"]),
                "compound": f["Compound"] if isinstance(f["Compound"], str) else None,
                "tyreLife": num(f["TyreLife"], 0),
                "status": PURPLE if lt <= best["lap"] + EPS else GREEN,
                "gap": round(lt - best["lap"], 3),
                "sectors": sectors,
                "speedTrap": num(f["SpeedST"], 0),
            }
        drivers.append(entry)

    # Practice / quali: order by fastest lap. Race / sprint: official result.
    is_race = name in ("Race", "Sprint")
    def order(d):
        if is_race and d["position"]:
            return (0, d["position"])
        fl = d["fastestLap"]
        return (1, fl["time"]) if fl else (2, 0)
    drivers.sort(key=order)

    ev = s.event
    return {
        "event": {"year": year, "round": rnd, "name": ev["EventName"],
                  "country": ev["Country"], "location": ev["Location"],
                  "officialName": ev.get("OfficialEventName")},
        "session": {"name": s.name, "date": pd.Timestamp(s.date).isoformat(),
                    "isRace": is_race, "totalLaps": num(getattr(s, "total_laps", None), 0)},
        "best": best,
        "fastestDriver": fastest["Driver"],
        "track": {
            "x": arr(x / 10, 1), "y": arr(y / 10, 1),       # metres
            "length": round(lap_len, 1),
            "rotation": float(ci.rotation),
            "sectorFrac": sector_frac,
            "corners": corners,
        },
        "drivers": drivers,
    }


# --------------------------------------------------------------------------- #
# Fastest-lap telemetry profiles (every driver) + corner segment times
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=8)
def _fastest_profiles(year: int, rnd: int, name: str) -> dict:
    s = load_session(year, rnd, name)
    ci = s.get_circuit_info()
    ov = session_overview(year, rnd, name)
    corner_frac = np.array([c["frac"] for c in ov["track"]["corners"]], float)
    ref_tel = s.laps.pick_fastest().get_telemetry()
    edges = _segment_edges(corner_frac, ref_tel["RelativeDistance"].to_numpy(float),
                           ref_tel["Speed"].to_numpy(float))
    sector_frac = [f for f in ov["track"]["sectorFrac"] if f]

    profiles = {}
    for drv in s.drivers:
        lap = s.laps.pick_drivers(drv).pick_fastest()
        if lap is None or pd.isna(lap["LapTime"]):
            continue
        try:
            tel = lap.get_telemetry()
        except Exception:  # missing position data for this lap
            continue
        if tel.empty:
            continue
        x, y = rotate(tel["X"], tel["Y"], ci.rotation)
        rel = tel["RelativeDistance"].to_numpy(float)
        t = _anchor_to_official(tel["Time"].dt.total_seconds().to_numpy(float),
                                rel, lap, sector_frac)
        v = tel["Speed"].to_numpy(float)

        # Time through each corner segment = t(end edge) - t(start edge)
        t_edges = np.interp(edges, rel, t)
        seg_time = np.diff(t_edges)
        seg_min_speed = []
        for a, b in zip(edges[:-1], edges[1:]):
            m = (rel >= a) & (rel <= b)
            seg_min_speed.append(float(v[m].min()) if m.any() else np.nan)

        profiles[lap["Driver"]] = {
            "rel": rel, "t": t, "v": v,
            "d": tel["Distance"].to_numpy(float),
            "thr": tel["Throttle"].to_numpy(float),
            "brk": tel["Brake"].astype(float).to_numpy(),
            "gear": tel["nGear"].to_numpy(float),
            "rpm": tel["RPM"].to_numpy(float),
            "drs": tel["DRS"].to_numpy(float),
            "x": x / 10, "y": y / 10,
            "seg_time": seg_time,
            "seg_min_speed": np.array(seg_min_speed),
        }
    return {"edges": edges, "profiles": profiles}


def compare(year: int, rnd: int, name: str, abbrs: list[str]) -> dict:
    ov = session_overview(year, rnd, name)
    fp = _fastest_profiles(year, rnd, name)
    profiles, edges = fp["profiles"], fp["edges"]
    abbrs = [a for a in abbrs if a in profiles]
    if not abbrs:
        return {"drivers": [], "corners": [], "grid": []}

    # Session best per corner segment (across every driver's fastest lap).
    all_abbr = list(profiles)
    seg = np.vstack([profiles[a]["seg_time"] for a in all_abbr])
    best_idx = np.nanargmin(seg, axis=0)
    session_best = seg[best_idx, np.arange(seg.shape[1])]
    sel = np.vstack([profiles[a]["seg_time"] for a in abbrs])
    selected_best = np.nanmin(sel, axis=0)

    # Common grid: fraction of the lap. Distances are expressed on the
    # reference (first) driver's lap length.
    grid = np.linspace(0, 1, RESAMPLE_POINTS)
    ref = profiles[abbrs[0]]
    ref_len = ref["d"].max()
    ref_t = np.interp(grid, ref["rel"], ref["t"])

    by_abbr = {d["abbr"]: d for d in ov["drivers"]}
    out = []
    for a in abbrs:
        p = profiles[a]
        rs = lambda ch: np.interp(grid, p["rel"], p[ch])  # noqa: E731
        t = rs("t")
        corner_rows = []
        for i, st in enumerate(p["seg_time"]):
            if st <= session_best[i] + EPS:
                status = PURPLE
            elif st <= selected_best[i] + EPS:
                status = GREEN
            else:
                status = YELLOW
            corner_rows.append({"time": num(st), "minSpeed": num(p["seg_min_speed"][i], 0),
                                "delta": num(st - session_best[i]), "status": status})
        info = by_abbr.get(a, {})
        out.append({
            "abbr": a, "name": info.get("name"), "team": info.get("team"),
            "color": info.get("color"), "number": info.get("number"),
            "fastestLap": info.get("fastestLap"),
            "tel": {
                "x": arr(rs("x"), 1), "y": arr(rs("y"), 1),
                "t": arr(t, 3), "speed": arr(rs("v"), 0),
                "throttle": arr(rs("thr"), 0), "brake": arr(rs("brk"), 2),
                "gear": arr(np.round(rs("gear")), 0), "rpm": arr(rs("rpm"), -1),
                "drs": arr(rs("drs"), 0), "delta": arr(t - ref_t, 3),
            },
            "corners": corner_rows,
        })

    corners = []
    for i, c in enumerate(ov["track"]["corners"]):
        corners.append({**c, "segStart": num(edges[i], 4), "segEnd": num(edges[i + 1], 4),
                        "sessionBest": {"time": num(session_best[i]),
                                        "driver": all_abbr[best_idx[i]]}})

    return {
        "reference": abbrs[0],
        "grid": arr(grid * ref_len, 1),     # distance in metres (reference lap)
        "corners": corners,
        "idealLap": num(float(np.nansum(session_best))),
        "drivers": out,
    }
