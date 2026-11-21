"""Loading FastF1 sessions with a disk cache and a small in-memory cache.

FastF1 downloads timing + telemetry from the official F1 live-timing archive
the first time a session is requested (this can take 20-60 s). The raw
responses are stored in ``cache/`` so later loads take a few seconds.
On top of that we keep the last few parsed ``Session`` objects in memory.
"""
from __future__ import annotations

import logging
import threading
from collections import OrderedDict

import fastf1

from .config import CACHE_DIR

fastf1.Cache.enable_cache(str(CACHE_DIR))
logging.getLogger("fastf1").setLevel(logging.WARNING)

_MAX_SESSIONS = 4  # a race with telemetry is ~150 MB in memory
_sessions: "OrderedDict[tuple, fastf1.core.Session]" = OrderedDict()
_locks: dict[tuple, threading.Lock] = {}
_global = threading.Lock()


def _lock_for(key: tuple) -> threading.Lock:
    with _global:
        return _locks.setdefault(key, threading.Lock())


def load_session(year: int, rnd: int, session: str):
    """Return a fully loaded FastF1 session (laps, telemetry, weather).

    ``session`` is a FastF1 session identifier, e.g. "Practice 1",
    "Qualifying", "Sprint", "Sprint Qualifying" or "Race".
    """
    key = (year, rnd, session)
    with _lock_for(key):  # two requests for the same session load it once
        if key in _sessions:
            _sessions.move_to_end(key)
            return _sessions[key]

        s = fastf1.get_session(year, rnd, session)
        s.load(laps=True, telemetry=True, weather=True, messages=False)

        _sessions[key] = s
        while len(_sessions) > _MAX_SESSIONS:
            _sessions.popitem(last=False)
        return s
