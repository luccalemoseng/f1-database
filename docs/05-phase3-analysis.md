# Phase 3 · Analysis

The **Analysis** page has two levels. **Race** works on one session loaded with
FastF1. **Season** works on the Phase 2 dataset. All code is in
`backend/app/phase3.py`.

## Race level

Pick a season, a Grand Prix and a session (Race, Sprint or a qualifying
session). The first load parses the session with FastF1 (about 30–60 s); after
that it comes from memory.

### Tyre strategy

```python
laps = session.laps
for stint, sl in laps.pick_drivers("LEC").groupby("Stint"):
    sl["Compound"].iloc[0], sl["LapNumber"].min(), sl["LapNumber"].max(), sl["FreshTyre"].iloc[0]
```

* One bar per stint, in Pirelli colours. **Faded** bars started on a used set
  (`FreshTyre == False`).
* **Neutralised laps** come from `TrackStatus`, a string holding every status
  code seen during the lap: `4` = Safety Car, `6`/`7` = Virtual Safety Car,
  `5` = red flag. They are shaded behind the bars.

### Race pace

Lap time for every driver on **clean laps** only:

```python
clean = (laps.TrackStatus == "1") & laps.PitInTime.isna() & laps.PitOutTime.isna() \
        & (laps.IsAccurate == True) & (laps.LapNumber > 1)
```

**Fuel correction.** A car starts with about 100 kg of fuel and gets faster as
it burns it. Every kilogram costs roughly 0.03 s per lap (a common rule of
thumb), so

```
fuel effect per lap  k = 0.03 s/kg × 100 kg / total laps          (≈ 0.057 s at Monza)
corrected lap time     = lap time − k × (total laps − lap number)
```

That removes the "car gets lighter" trend, so what remains is mostly tyres,
traffic and driving. Toggle **Raw** to see the original times.

### Tyre degradation

For every stint with at least 5 clean laps (laps more than 3 % slower than the
stint median are dropped as traffic or mistakes):

```python
slope, intercept = np.polyfit(stint.TyreLife, stint.fuel_corrected_time, 1)
```

* `slope` is the **degradation in seconds per lap of tyre age**.
* Each compound shows the **median** slope over all stints, with the
  interquartile range (IQR, the middle 50 %).
* The scatter shows every clean lap relative to the start of its stint, and the
  line shows the median rate.

> Example, Monza 2024: medium +0.025 s/lap, hard +0.045 s/lap. Leclerc won on a
> one-stop (medium → hard) while the McLarens stopped twice.

### The track: speed and braking

From the session's fastest lap (`lap.get_telemetry()`):

| Figure | How |
|---|---|
| Full throttle % | share of the lap **distance** with `Throttle ≥ 98` |
| Braking % and zones | runs of `Brake == True` longer than 10 m |
| Entry speed / braking distance | speed where a braking zone starts / its length |
| Corner class | minimum speed within ±60 m of each corner (`circuit_info.corners`): **slow** < 125 km/h, **medium** 125–200, **fast** > 200 |
| Speed map | the lap's X/Y coloured by speed (one-hue ramp), braking zones in red |

The scatter of **entry speed vs. braking distance** shows the physics: the
faster a car arrives, the longer it brakes. Corners taken flat have no braking
zone.

### Where each car is quick (corner types)

This reuses the corner-by-corner split from Phase 1 (each driver's fastest
lap, cut into one segment per corner and anchored to the official sector
times). For every team and every corner class:

```
time lost = Σ over corners of that class ( team's segment time − best segment time of anyone )
```

A team counts its quicker car. Read it on **Qualifying** sessions, where every
car runs low fuel on fresh tyres. In a race, fastest laps happen under
different fuel and tyre conditions.

## Season level

| Chart | Data | Formula |
|---|---|---|
| Who scored for each team | `results` (race + sprint) | each driver's points ÷ team total |
| Qualifying vs. race | `results` | mean of (grid − finish) over classified finishes |
| Reliability | `results` | Grands Prix not classified per team, with the most common `status` texts |
| Form | `driver_standings.round_points` | 5-round rolling mean for the top 6 |
| One-lap vs. race pace | `qualifying.segment_gap_pct`, `driver_race.pace_gap_pct` | per round, each team's best car; then the median over the season |

On the pace chart, the dashed diagonal means "as strong on Sunday as on
Saturday". **Below** it, a team is relatively stronger in races (kind on its
tyres, good in traffic). It needs the dataset's laps pass. The chart says how
many rounds are covered.
