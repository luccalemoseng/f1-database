"""FastAPI entry point.

Run from the project root:
    .venv\\Scripts\\python -m uvicorn backend.app.main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import phase1, phase2, phase3
from .live import manager as live
from .config import FIRST_SEASON, LAST_SEASON

app = FastAPI(title="F1 Database API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _guard(fn, *args):
    try:
        return fn(*args)
    except HTTPException:
        raise
    except Exception as exc:  # surface FastF1 errors (no data, bad session...)
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/seasons")
def seasons():
    return list(range(LAST_SEASON, FIRST_SEASON - 1, -1))


@app.get("/api/events/{year}")
def events(year: int):
    if not FIRST_SEASON <= year <= LAST_SEASON:
        raise HTTPException(404, "Season out of range")
    return _guard(phase1.season_events, year)


# Plain `def` endpoints run in FastAPI's thread pool, so a slow first
# download of one session does not block other requests.
@app.get("/api/session/{year}/{rnd}/{session}")
def session_overview(year: int, rnd: int, session: str):
    return _guard(phase1.session_overview, year, rnd, session)


@app.get("/api/season/{year}")
def season(year: int):
    return _guard(phase2.season_summary, year)


@app.get("/api/analysis/race/{year}/{rnd}/{session}")
def race_analysis(year: int, rnd: int, session: str):
    return _guard(phase3.race_analysis, year, rnd, session)


@app.get("/api/analysis/season/{year}")
def season_analysis(year: int):
    return _guard(phase3.season_analysis, year)


@app.get("/api/dataset")
def dataset():
    return _guard(phase2.dataset_status)


@app.get("/api/compare/{year}/{rnd}/{session}")
def compare(year: int, rnd: int, session: str,
            drivers: str = Query(..., description="Comma-separated abbreviations, e.g. VER,NOR")):
    abbrs = [d.strip().upper() for d in drivers.split(",") if d.strip()][:6]
    return _guard(phase1.compare, year, rnd, session, abbrs)


# --------------------------------------------------------------------- live
@app.get("/api/live/status")
def live_status():
    return live.status()


@app.get("/api/live/state")
def live_state():
    return live.state.snapshot()


@app.post("/api/live/start")
def live_start(body: dict = Body(...)):
    if body.get("mode") == "replay":
        live.start_replay(int(body["year"]), int(body["round"]), body.get("session", "Race"),
                          float(body.get("speed", 10)), float(body.get("start", 0)))
    else:
        live.start_live(no_auth=bool(body.get("noAuth", False)))
    return live.status()


@app.post("/api/live/control")
def live_control(body: dict = Body(...)):
    live.control(body.get("speed"), body.get("seek"))
    return live.status()


@app.post("/api/live/stop")
def live_stop():
    live.stop()
    return live.status()
