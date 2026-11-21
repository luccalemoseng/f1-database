"""Phase 4 - live timing.

Two sources feed one state engine:

* **Live**: FastF1's ``SignalRClient`` connects to F1's live-timing feed
  (needs an F1 TV subscription) and records every message to a text file.
  A tail thread reads the file as it grows and applies each message.
  Sign-in is done by FastF1 in *your* browser (f1login.fastf1.dev); this
  project never sees credentials, only FastF1's stored token.
* **Replay**: the same topics, recorded by F1 for every past session, are
  downloaded from the live-timing archive (``fastf1._api.fetch_page``) and
  played back on a clock you can speed up or seek.

Each message is ``(topic, payload)``. Payloads are partial updates that are
deep-merged into the current state (F1 sends only what changed).
See docs/06-phase4-live.md.
"""
from __future__ import annotations

import ast
import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import fastf1
from fastf1 import _api
from fastf1.internals import f1auth

from . import loader  # noqa: F401  (project FastF1 cache)
from .config import DATA_DIR

LIVE_DIR = DATA_DIR / "live"
LIVE_DIR.mkdir(exist_ok=True)

REPLAY_TOPICS = {  # FastF1 page name -> live topic name
    "session_info": "SessionInfo", "driver_list": "DriverList", "timing_data": "TimingData",
    "timing_app_data": "TimingAppData", "track_status": "TrackStatus", "lap_count": "LapCount",
    "race_control_messages": "RaceControlMessages", "weather_data": "WeatherData",
    "session_status": "SessionStatus", "extrapolated_clock": "ExtrapolatedClock", "position": "Position.z",
}


def _ts(s: str) -> float:
    h, m, rest = s.split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest)


def deep_merge(dst, src):
    """Apply an F1 live-timing delta. Lists arrive as dicts keyed by index."""
    for k, v in src.items():
        if k == "_kf":
            continue
        cur = dst.get(k) if isinstance(dst, dict) else None
        if isinstance(v, dict) and isinstance(cur, list):
            for idx, val in v.items():
                i = int(idx)
                while len(cur) <= i:
                    cur.append({})
                if isinstance(val, dict) and isinstance(cur[i], dict):
                    deep_merge(cur[i], val)
                else:
                    cur[i] = val
        elif isinstance(v, dict) and isinstance(cur, dict):
            deep_merge(cur, v)
        elif isinstance(v, dict):
            dst[k] = {}
            deep_merge(dst[k], v)
        else:
            dst[k] = v


class LiveState:
    def __init__(self):
        self.lock = threading.Lock()
        self.data: dict = {}
        self.positions: dict[str, tuple[float, float]] = {}
        self.outline: list[list[tuple[float, float]]] = []   # polylines
        self._ref_car: str | None = None
        self._ref_last: tuple[float, float] | None = None
        self.outline_points = 0
        self.rcm: list[dict] = []
        self.count = 0
        self.last = None

    def apply(self, topic: str, payload):
        if topic.endswith(".z"):
            topic = topic[:-2]
            if isinstance(payload, str):
                payload = _api.parse(payload, zipped=True)
        with self.lock:
            self.count += 1
            self.last = time.time()
            if topic == "Position":
                for entry in payload.get("Position", []):   # ~4 samples per message
                    for num, e in entry.get("Entries", {}).items():
                        if e.get("X") or e.get("Y"):
                            self.positions[num] = (e["X"], e["Y"])
                    self._grow_outline()
            elif topic == "RaceControlMessages":
                msgs = payload.get("Messages", [])
                self.rcm += list(msgs.values()) if isinstance(msgs, dict) else msgs
                self.rcm = self.rcm[-40:]
            elif topic == "CarData":
                pass
            elif isinstance(payload, dict):
                deep_merge(self.data.setdefault(topic, {}), payload)

    def _grow_outline(self):
        """Draw the circuit from one car's path (no extra download needed).

        Positions are in 1/10 m. A step longer than 150 m between two samples
        means data was skipped (or the car was moved in the garage), so the
        path is broken into a new polyline instead of drawing a straight jump."""
        if self._ref_car not in self.positions:
            self._ref_car, self._ref_last = next(iter(self.positions), None), None
        if not self._ref_car or self.outline_points >= 1500:
            return
        x, y = self.positions[self._ref_car]
        last, self._ref_last = self._ref_last, (x, y)
        if last is None or (x - last[0]) ** 2 + (y - last[1]) ** 2 > 1500 ** 2:
            self.outline.append([(x, y)])
            self.outline_points += 1
            return
        seg = self.outline[-1]
        if (x - seg[-1][0]) ** 2 + (y - seg[-1][1]) ** 2 > 60 ** 2:
            seg.append((x, y))
            self.outline_points += 1

    def snapshot(self) -> dict:
        with self.lock:
            d = self.data
            drivers = {k: v for k, v in d.get("DriverList", {}).items() if isinstance(v, dict) and v.get("Tla")}
            lines = d.get("TimingData", {}).get("Lines", {})
            app = d.get("TimingAppData", {}).get("Lines", {})
            rows = []
            for num, info in drivers.items():
                t = lines.get(num, {})
                secs = t.get("Sectors", [])
                secs = list(secs.values()) if isinstance(secs, dict) else secs
                stints = app.get(num, {}).get("Stints", [])
                stints = list(stints.values()) if isinstance(stints, dict) else stints
                last_stint = stints[-1] if stints else {}
                last = t.get("LastLapTime", {}) or {}
                gap = t.get("GapToLeader") or (t.get("TimeDiffToFastest") if "TimeDiffToFastest" in t else "")
                interval = (t.get("IntervalToPositionAhead") or {}).get("Value", "") if isinstance(t.get("IntervalToPositionAhead"), dict) else ""
                rows.append({
                    "num": num, "tla": info.get("Tla"), "name": info.get("FullName"), "team": info.get("TeamName"),
                    "color": "#" + (info.get("TeamColour") or "949498"),
                    "pos": int(t.get("Position") or info.get("Line") or 99),
                    "gap": gap if isinstance(gap, str) else "", "interval": interval,
                    "last": last.get("Value", ""), "lastStatus": "purple" if last.get("OverallFastest") else "green" if last.get("PersonalFastest") else None,
                    "best": (t.get("BestLapTime") or {}).get("Value", ""),
                    "sectors": [{"v": s.get("Value", ""), "s": "purple" if s.get("OverallFastest") else "green" if s.get("PersonalFastest") else ("yellow" if s.get("Value") else None)} for s in secs[:3] if isinstance(s, dict)],
                    "laps": t.get("NumberOfLaps"), "pits": t.get("NumberOfPitStops"),
                    "inPit": bool(t.get("InPit")), "pitOut": bool(t.get("PitOut")),
                    "out": bool(t.get("Retired") or t.get("Stopped") or t.get("KnockedOut")),
                    "tyre": last_stint.get("Compound"), "tyreAge": last_stint.get("TotalLaps"), "tyreNew": last_stint.get("New") == "true",
                    "xy": self.positions.get(num),
                })
            rows.sort(key=lambda r: r["pos"])
            si = d.get("SessionInfo", {})
            ts = d.get("TrackStatus", {})
            return {
                "session": {"meeting": si.get("Meeting", {}).get("Name"), "name": si.get("Name"), "type": si.get("Type"),
                            "circuit": si.get("Meeting", {}).get("Circuit", {}).get("ShortName"),
                            "status": d.get("SessionStatus", {}).get("Status")},
                "lap": d.get("LapCount", {}), "clock": d.get("ExtrapolatedClock", {}).get("Remaining"),
                "track": {"status": ts.get("Status"), "message": ts.get("Message")},
                "weather": d.get("WeatherData", {}),
                "rows": rows, "rcm": self.rcm[-12:][::-1],
                "outline": [seg for seg in self.outline if len(seg) > 3], "messages": self.count,
            }


class LiveManager:
    def __init__(self):
        self.mode = "idle"
        self.state = LiveState()
        self.stop_evt = threading.Event()
        self.threads: list[threading.Thread] = []
        self.file: Path | None = None
        self.auth_url: str | None = None
        self.log: list[str] = []
        self.replay: dict | None = None
        self.error: str | None = None

    # ---- shared ------------------------------------------------------------
    def stop(self):
        self.stop_evt.set()
        client = getattr(self, "_client", None)
        if client is not None:
            try:
                client._exit()
            except Exception:  # noqa: BLE001
                pass
            self._client = None
        self.mode = "idle"

    def _reset(self, mode: str):
        self.stop()
        time.sleep(0.2)
        self.stop_evt = threading.Event()
        self.state = LiveState()
        self.mode, self.error, self.auth_url, self.replay = mode, None, None, None
        self.log = []

    def _say(self, *args, **_):
        line = " ".join(str(a) for a in args).strip()
        if not line:
            return
        self.log = (self.log + [line])[-20:]
        if "f1login.fastf1.dev" in line:
            self.auth_url = next((w for w in line.split() if w.startswith("https://f1login")), None)
        if "Sign-in successful" in line:
            self.auth_url = None

    # ---- live --------------------------------------------------------------
    def start_live(self, no_auth: bool = False):
        from fastf1.livetiming.client import SignalRClient
        self._reset("live")
        self.file = LIVE_DIR / f"live_{datetime.now(timezone.utc):%Y%m%d_%H%M%S}.txt"
        self.file.touch()
        f1auth.print = self._say  # FastF1 prints the sign-in link; we show it in the UI

        def run():
            try:
                self._client = SignalRClient(str(self.file), timeout=0, no_auth=no_auth)
                self._client.start()
            except Exception as exc:  # noqa: BLE001
                self.error = f"{type(exc).__name__}: {exc}"
                self.mode = "idle"

        def tail():
            with open(self.file, encoding="utf-8", errors="replace") as fh:
                while not self.stop_evt.is_set():
                    line = fh.readline()
                    if not line:
                        time.sleep(0.25)
                        continue
                    self._apply_recorded(line)

        self.threads = [threading.Thread(target=run, daemon=True), threading.Thread(target=tail, daemon=True)]
        for t in self.threads:
            t.start()

    def _apply_recorded(self, line: str):
        """One line written by SignalRClient: str(list) of a feed message, or
        [topic, json_string, ''] for the initial snapshot."""
        try:
            msg = ast.literal_eval(line.strip())
        except (ValueError, SyntaxError):
            return
        if not isinstance(msg, list) or len(msg) < 2:
            return
        topic, payload = msg[0], msg[1]
        if isinstance(payload, str) and payload[:1] in "{[":
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                return
        self.state.apply(topic, payload)

    # ---- replay ------------------------------------------------------------
    def start_replay(self, year: int, rnd: int, session: str, speed: float = 10, start: float = 0):
        self._reset("replay")
        self.replay = {"year": year, "round": rnd, "session": session, "speed": speed, "t": 0.0,
                       "t0": 0.0, "t1": 0.0, "loading": True}

        def run():
            try:
                path = fastf1.get_session(year, rnd, session).api_path
                msgs = []
                for page, topic in REPLAY_TOPICS.items():
                    data = _api.fetch_page(path, page) or []
                    for rec in data:
                        if page == "position":  # raw "HH:MM:SS.mmm<payload>" lines, parsed lazily
                            msgs.append((_ts(rec[:12]), topic, rec[12:]))
                        else:
                            msgs.append((_ts(rec[0]), topic, rec[1]))
                msgs.sort(key=lambda m: m[0])
                if not msgs:
                    raise RuntimeError("no archived live-timing data for this session")
                # The clock's zero is when the session starts (SessionStatus "Started").
                t_first = next((m[0] for m in msgs if m[1] == "SessionStatus" and isinstance(m[2], dict)
                                and m[2].get("Status") == "Started"),
                               next((m[0] for m in msgs if m[1] == "TimingData"), msgs[0][0]))
                # replay everything before the start instantly, so the grid is complete at t = 0
                start_at = t_first + start
                rp = self.replay
                rp.update(t0=t_first, t1=msgs[-1][0], t=start_at, loading=False)
                i = 0
                last = time.time()
                while not self.stop_evt.is_set():
                    now = time.time()
                    rp["t"] = min(rp["t1"], rp["t"] + (now - last) * rp["speed"])
                    last = now
                    if rp.get("seek") is not None:      # seek: rebuild the state from the start
                        target = rp.pop("seek")
                        self.state = LiveState()
                        i, rp["t"] = 0, target
                    while i < len(msgs) and msgs[i][0] <= rp["t"]:
                        t, topic, payload = msgs[i]
                        # stale positions are skipped when fast-forwarding, except while
                        # the circuit outline is still being drawn (about one lap)
                        if topic != "Position.z" or rp["t"] - t < 2 or self.state.outline_points < 1000:
                            self.state.apply(topic, payload)
                        i += 1
                    time.sleep(0.1)
            except Exception as exc:  # noqa: BLE001
                self.error = f"{type(exc).__name__}: {exc}"
                self.mode = "idle"

        self.threads = [threading.Thread(target=run, daemon=True)]
        self.threads[0].start()

    def control(self, speed: float | None = None, seek: float | None = None):
        if self.replay:
            if speed is not None:
                self.replay["speed"] = max(0.0, min(120.0, speed))
            if seek is not None:
                self.replay["seek"] = self.replay["t0"] + max(0.0, seek)

    # ---- status ------------------------------------------------------------
    def status(self) -> dict:
        token = f1auth.AUTH_DATA_FILE.read_text().strip() if f1auth.AUTH_DATA_FILE.exists() else ""
        expires = None
        if token:
            try:
                import jwt
                exp = jwt.decode(token, options={"verify_signature": False}).get("exp")
                expires = datetime.fromtimestamp(exp, timezone.utc).isoformat() if exp else None
            except Exception:  # noqa: BLE001
                pass
        rp = self.replay
        return {
            "mode": self.mode, "error": self.error, "authUrl": self.auth_url, "log": self.log[-6:],
            "token": {"saved": bool(token), "expires": expires},
            "file": self.file.name if self.file and self.mode == "live" else None,
            "replay": None if not rp else {k: rp[k] for k in ("year", "round", "session", "speed", "loading")}
            | {"t": round(rp["t"] - rp["t0"], 1), "duration": round(rp["t1"] - rp["t0"], 1)},
        }


manager = LiveManager()
