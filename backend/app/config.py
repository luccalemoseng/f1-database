"""Shared paths and constants for the backend."""
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT_DIR / "cache"          # FastF1 HTTP cache (raw API responses)
DATA_DIR = ROOT_DIR / "data"            # Curated Parquet datasets (Phase 2+)

FIRST_SEASON = 2018                      # First season with full FastF1 telemetry
LAST_SEASON = 2026

# Number of points every compared lap is resampled to. All drivers share the
# same grid, so index i means "the same fraction of the lap" for everyone.
RESAMPLE_POINTS = 800

CACHE_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
