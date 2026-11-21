# Phase 2 · Season dataset

Phase 2 turns every season since 2018 into a **tidy, documented dataset**. It
feeds the **Season** page today and is meant to feed a championship-prediction
model later. (No model is built in this project. This page documents the data
so one can be built on top of it.)

## How it is built

```powershell
# full build, 2018 -> today: results in ~2 min, then the slow laps pass
.venv\Scripts\python -m backend.pipeline.build_dataset

# results and standings only (~2 min)
.venv\Scripts\python -m backend.pipeline.build_dataset --no-laps

# laps pass only (skips the results pass; use it to resume)
.venv\Scripts\python -m backend.pipeline.build_dataset --laps-only

# some seasons only / redo the laps pass / recompute standings only
.venv\Scripts\python -m backend.pipeline.build_dataset --seasons 2025 2026
.venv\Scripts\python -m backend.pipeline.build_dataset --force
.venv\Scripts\python -m backend.pipeline.build_dataset --standings-only

# flat ML files (Parquet + CSV)
.venv\Scripts\python -m backend.pipeline.export_ml
```

The build runs in **two passes**:

**Pass 1: results (about 2 minutes for all seasons).**
1. Calendar: `fastf1.get_event_schedule(year)`.
2. Race, sprint and qualifying classifications for the **whole season** come
   from the Jolpica-F1 (Ergast-compatible) API in a few paged requests:
   ```python
   from fastf1.ergast import Ergast
   e = Ergast(result_type="pandas", auto_cast=True, limit=100)
   resp = e.get_race_results(season=2024)        # 100 rows per page
   while not resp.is_complete:
       resp = resp.get_next_result_page()
   ```
3. One Parquet file per round (`data/<table>/season=YYYY/round=RR.parquet`).
4. **Standings after every round** are computed from the results, using the FIA
   tie-break (equal points are split by number of wins, then 2nd places, …).

**Pass 2: lap data (several hours, resumable).** For every race and sprint:
```python
s = fastf1.get_session(year, rnd, "Race")
s.load(laps=True, telemetry=False, weather=True)   # no telemetry: faster
```
* `s.laps` → pace, pit stops, stints, tyre degradation (`driver_race`, `stints`)
* `s.weather_data` → temperatures, rain (`weather`)

> **Why so slow?** FastF1 deliberately limits itself to **500 API calls per
> hour**, across the F1 live-timing archive and Ergast, so the free services
> people rely on don't get overloaded (exceeding it has got projects blocked
> before). A session load costs several calls. The pipeline reads FastF1's own
> rate-limiter counter and pauses whenever it gets close to the budget. **Never
> disable the limiter.** Stop the pass any time; re-running it skips finished
> rounds. Everything is cached in `cache/`, so later runs cost no API calls.

A few old sessions have **no lap timing in the F1 archive** (for example the
2018 Italian GP race). FastF1 reports "Failed to load timing data". Those rounds
are listed in `data/laps_missing.txt` and skipped; their results and standings
are still complete.

Ergast has no team colours, so `team_color` comes from a fixed map per
constructor id in the pipeline (`TEAM_COLORS`). Sprint-qualifying
classifications aren't in Ergast and aren't part of the dataset.

### Validation

Standings computed by the pipeline match the official championships, for
example:

| Season | Drivers' champion | Constructors' champion |
|---|---|---|
| 2018 | HAM 408 · VET 320 | Mercedes 655 |
| 2021 | VER 395.5 · HAM 387.5 (half points at Spa included) | Mercedes 613.5 |
| 2024 | VER 437 · NOR 374 | McLaren 666 |
| 2025 | NOR 423 · VER 421 · PIA 410 | McLaren 833 |

## Querying with DuckDB

DuckDB reads the Parquet files in place. `backend/app/phase2.py → connect()`
returns a connection where every table below is a view:

```python
from backend.app.phase2 import connect
con = connect()
con.execute("""
    SELECT driver_code, sum(points) AS pts
    FROM results WHERE season = 2024
    GROUP BY 1 ORDER BY pts DESC LIMIT 5
""").df()
```

Or from any DuckDB client:

```sql
SELECT * FROM read_parquet('data/results/*/*.parquet', hive_partitioning = true, filename = true);
```

`season` comes from the folder name. `round` is taken from the file name (the
`connect()` views do this for you).

---

## Data dictionary

Common keys: `season` (int), `round` (int, calendar round), `session`
(`race`, `sprint`, `qualifying`, `sprint_qualifying`). Drivers are identified by
`driver_id` (stable Ergast id, e.g. `max_verstappen`), `driver_code` (3 letters)
and `driver_number`. Teams are identified by `team_id` (e.g. `red_bull`).

### `events`: calendar
| Column | Type | Description |
|---|---|---|
| round | int | Calendar round |
| event_name | text | e.g. "Italian Grand Prix" |
| country, location | text | Country and venue |
| event_date | date | Sunday of the event |
| event_format | text | `conventional`, `sprint`, `sprint_shootout`, `sprint_qualifying` |

### `results`: race and sprint classification (one row per driver per race/sprint)
| Column | Description |
|---|---|
| driver_name, team_name, team_color | Identity (team colour as hex) |
| grid | Starting position (0 = pit-lane start) |
| position | Finishing order (also set for non-classified cars) |
| classified_position | Official result: a number, or `R` retired, `D` disqualified, `E` excluded, `W` withdrawn, `F` failed to qualify, `N` not classified |
| status | e.g. `Finished`, `+1 Lap`, `Collision`, `Engine` |
| points | Points scored (includes fastest-lap point where applicable) |
| laps | Laps completed |
| race_time_s | Total race time in seconds (finishers on the lead lap only) |
| fastest_lap_rank | Rank of the driver's fastest lap in the race (1 = fastest lap of the race) |
| nationality | Driver nationality |
| finished / dnf | `classified_position` is numeric / is not |
| pit_lane_start | `grid == 0` |

### `qualifying`: Grand Prix qualifying
| Column | Description |
|---|---|
| position | Official qualifying position (not the grid: penalties apply after) |
| q1_s, q2_s, q3_s | Best lap in each segment (s) |
| last_segment | 1, 2 or 3: last segment the driver took part in |
| best_s | Lap time in `last_segment` |
| segment_gap_pct | Gap (%) to the fastest driver **in that same segment**. Robust when it rains between segments. |

### `driver_race`: per-driver race summary from lap data (races and sprints)
| Column | Description |
|---|---|
| laps_completed, laps_led | Laps done / laps in P1 |
| pos_after_lap1 | Position at the end of lap 1 (start performance) |
| pit_stops, stints, compounds_used | Strategy |
| best_lap_s | Fastest lap |
| median_clean_lap_s | Median of *clean* laps: green flag, no pit in/out, timing accurate |
| clean_laps | How many laps that median uses |
| pace_gap_pct | Gap (%) of the median clean lap to the best driver's median. **The best single measure of race pace.** |
| lap_time_std_s | Consistency (std. dev. of clean laps) |
| top_speed_trap | Fastest speed-trap reading (km/h) |

### `stints`: tyre stints (Phase 3 uses this)
| Column | Description |
|---|---|
| stint, compound, fresh_tyre | Stint number, tyre, new or used |
| lap_start, lap_end, laps, tyre_life_start | Extent of the stint |
| median_lap_s | Median clean lap in the stint |
| deg_s_per_lap | Degradation: slope of clean lap time against tyre age (s/lap). Needs ≥ 5 clean laps. Includes fuel burn-off, so it reads lower than true tyre wear. |

### `weather`: one row per race / sprint
`air_temp_mean`, `track_temp_mean`, `track_temp_max`, `humidity_mean`,
`pressure_mean`, `wind_speed_mean`, `rain_fraction` (share of samples with
rain, 0–1).

### `driver_standings` / `constructor_standings`: after every round
| Column | Description |
|---|---|
| points, position | Cumulative points and championship position after the round |
| wins, p2, p3, podiums | Grand Prix results (sprints excluded, as in the FIA tie-break) |
| races, dnfs | Grands Prix started / not classified |
| round_points | Points scored in that round (GP + sprint) |

---

## ML-ready views

Two flat views join everything above. Run `export_ml` to write them to
`data/ml/` as Parquet and CSV.

### `ml_race_features`: one row per driver per Grand Prix

Columns are split so a model can't accidentally learn from the future:

| Group | Columns | Known before the race? |
|---|---|---|
| Keys | season, round, event_name, location, event_format, driver_id, driver_code, team_id | ✅ |
| Grid and qualifying | grid, pit_lane_start, quali_position, quali_gap_pct, quali_segment | ✅ |
| Championship so far | driver_points_before, driver_rank_before, driver_wins_before, team_points_before, team_rank_before | ✅ standings after the **previous** round |
| Form | avg_finish_last3, avg_points_last3, dnfs_last3 | ✅ previous 3 GPs |
| **Targets** | finish_position, points_scored, won, podium, dnf, status | ❌ outcome |
| Post-race facts | pace_gap_pct, pit_stops, laps_led, pos_after_lap1, race_rain_fraction, race_track_temp | ❌ use only as features for *later* races |

### `ml_season_summary`: one row per driver per season

Final points and position, wins, podiums, DNFs, average qualifying, grid,
finish and race pace, and the label **`champion`** (true or false).

### Ideas for the future model (not implemented)

* **Predict the champion mid-season**: train on `ml_race_features` cut at round
  *k* of past seasons, aggregated per driver, with `champion` as the label.
* **Race-by-race simulation**: predict `points_scored` per race from the
  pre-race features, then simulate the remaining calendar (Monte Carlo) to
  get championship probabilities.
* Validate with **season-based splits** (train 2018–2023, test 2024), never random rows.
* Regulation changes (2022 ground-effect, 2026 new power units and active aero)
  shift the competitive order. Consider an era feature or weight recent seasons more.
