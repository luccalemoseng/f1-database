"""Small helpers to turn pandas / numpy values into JSON-safe Python values."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd


def secs(td) -> float | None:
    """Timedelta -> seconds (float), NaT -> None."""
    if td is None or pd.isna(td):
        return None
    return round(td.total_seconds(), 3)


def num(v, nd: int = 3):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else round(f, nd)


def arr(a, nd: int = 2) -> list:
    """numpy array -> list with NaN replaced by None."""
    a = np.round(np.asarray(a, dtype=float), nd)
    return [None if math.isnan(x) else x for x in a.tolist()]


def rotate(x, y, angle_deg: float):
    """Rotate track coordinates so the circuit is drawn like the official map.

    FastF1's ``CircuitInfo.rotation`` is the angle (degrees) needed to match the
    orientation used on the F1 website. Same matrix as in the FastF1 docs.
    """
    a = np.deg2rad(angle_deg)
    rot = np.array([[np.cos(a), np.sin(a)], [-np.sin(a), np.cos(a)]])
    xy = np.column_stack([np.asarray(x, float), np.asarray(y, float)]) @ rot
    return xy[:, 0], xy[:, 1]


def team_color(hex_str) -> str:
    if isinstance(hex_str, str) and len(hex_str) == 6:
        return f"#{hex_str}"
    return "#949498"
