# Phase 1 · Session compare

This page explains, figure by figure, how the **Compare** page is built from
FastF1. All code lives in `backend/app/phase1.py`. The snippets below are
simplified versions you can run in a notebook.

```python
import fastf1
fastf1.Cache.enable_cache("cache")          # always enable the cache first
```

---

## Step 1 · The season calendar

```python
schedule = fastf1.get_event_schedule(2024, include_testing=False)
schedule[["RoundNumber", "EventName", "Session1", "Session5", "Session5DateUtc"]]
```

Each row is a Grand Prix. Columns `Session1`…`Session5` hold the session names
(`Practice 1`, `Qualifying`, `Sprint`, `Race`…) and `SessionNDateUtc` their start
times. A session is marked **available** once its start time plus three hours has
passed. Sessions that haven't run yet are greyed out in the selector.

## Step 2 · Loading a session

```python
session = fastf1.get_session(2024, 16, "Qualifying")   # year, round, session name
session.load(laps=True, telemetry=True, weather=True, messages=False)
```

`load()` downloads and parses three families of data:

| Object | What it contains |
|---|---|
| `session.laps` | One row per lap: `LapTime`, `Sector1Time`–`Sector3Time`, `Compound`, `TyreLife`, `SpeedST` (speed trap), `Deleted` (track limits)… |
| `session.car_data` | ~4 Hz car channels per driver: `Speed`, `RPM`, `nGear`, `Throttle`, `Brake`, `DRS` |
| `session.pos_data` | ~4 Hz car positions `X`, `Y`, `Z` (in 1/10 m) |
| `session.results` | Driver info: name, team, `TeamColor`, `HeadshotUrl`, grid and final position |

## Step 3 · Timing tower and sector colours

```python
laps = session.laps
valid = laps[laps["Deleted"] != True]          # laps deleted for track limits don't count

session_best_s1 = valid["Sector1Time"].min()   # purple threshold
for drv in session.drivers:
    dl = laps.pick_drivers(drv)
    fastest = dl.pick_fastest()                # the driver's best lap
    personal_best_s1 = valid[valid["DriverNumber"] == drv]["Sector1Time"].min()
```

Each sector of each driver's **fastest lap** gets the official F1 colour:

| Colour | Rule |
|---|---|
| 🟪 **Purple** | equals the fastest time of that sector by anyone in the session |
| 🟩 **Green** | equals the driver's own best of that sector (on any of their laps) |
| 🟨 **Yellow** | slower than the driver's own best (they went faster in that sector on another lap) |

Order: practice and qualifying are sorted by best lap time. Race and sprint use
the official classification (`session.results["Position"]`).

## Step 4 · The circuit map

```python
fastest = session.laps.pick_fastest()          # session's fastest lap
tel = fastest.get_telemetry()                  # car data + positions, merged & interpolated
circuit = session.get_circuit_info()           # corners + map rotation
```

* The **outline** is the `X`/`Y` path of the session's fastest lap.
* It is rotated by `circuit.rotation` degrees so it matches the official F1 map:

```python
import numpy as np
def rotate(x, y, angle_deg):
    a = np.deg2rad(angle_deg)
    rot = np.array([[np.cos(a), np.sin(a)], [-np.sin(a), np.cos(a)]])
    xy = np.column_stack([x, y]) @ rot
    return xy[:, 0], xy[:, 1]
```

* **Corner numbers** come from `circuit.corners` (columns `X`, `Y`, `Number`,
  `Letter`, `Distance`).
* **Sector lines (S2, S3)**: the lap table tells us *when* sector 1 ended
  (`Sector1SessionTime`). We look up the car's `Distance` at that moment in the
  telemetry (`np.interp`), and that gives the point on the map.

## Step 5 · Racing lines

Each compared driver's line is the `X`/`Y` of **their own fastest lap**
(`lap.get_telemetry()`), rotated the same way. Racing lines differ by only a few
metres, so on the full map they overlap. Zoom in (scroll, `+` or click a corner)
to see them separate. Position data is sampled at about 4 Hz and interpolated,
so treat differences under ~2 m as noise.

## Step 6 · Resampling: putting every lap on the same grid

Telemetry samples arrive at slightly different moments for every car, and each
car's integrated lap distance differs by a few metres. To compare like for like,
every lap is resampled onto the **same 800 points**, defined as the *fraction of
the lap completed* (`RelativeDistance`, from 0 to 1):

```python
grid = np.linspace(0, 1, 800)
speed_on_grid = np.interp(grid, tel["RelativeDistance"], tel["Speed"])
```

Index *i* therefore means "the same place on track" for every driver. That is
what lets the crosshair on the charts move a dot for each driver on the map at
the same time.

## Step 7 · Telemetry traces

| Chart | FastF1 channel | Notes |
|---|---|---|
| Speed | `Speed` (km/h) | |
| Gap to reference | `Time` | `t_driver(i) − t_reference(i)`. Above 0 means behind the first selected driver at that point. The value at the finish line equals the official gap. |
| Throttle | `Throttle` (0–100 %) | |
| Brake | `Brake` (boolean) | F1 only publishes on/off, not brake pressure |
| Gear | `nGear` | Drawn as steps |

Dashed vertical lines mark corners and red lines mark sector boundaries.

## Step 8 · Corner-by-corner timing

F1 only publishes three sector times (plus internal mini-sectors that FastF1
does not expose). To get a time **per corner**, the lap is cut into one segment
per corner:

1. Corner positions come from `circuit.corners["Distance"]`.
2. Between two consecutive corners, the boundary is placed at the **highest-speed
   point** of the session's fastest lap. Timing error is distance error ÷ speed,
   so cutting where cars are fastest keeps the error smallest.
3. **Clock anchoring.** Telemetry distance is integrated from speed and drifts by
   tens of metres. We know exactly when each car crossed the official sector lines,
   so the telemetry clock is rescaled within each sector to match the official
   S1/S2/S3 times:

   ```python
   anchors_rel = [0, s1_end_frac, s2_end_frac, 1]
   anchors_off = cumsum([0, S1, S2, S3])          # official times
   anchors_tel = np.interp(anchors_rel, rel, t)   # telemetry times at those points
   t_fixed = np.interp(t, anchors_tel, anchors_off)
   ```

   On Monza 2024 qualifying this removed a **50–100 ms** systematic error at the
   sector lines (checked against the official sector times).
4. Segment time = `t(end) − t(start)`. The minimum speed in the segment is also shown.

Corner colours:

| Colour | Rule |
|---|---|
| 🟪 Purple | fastest through this corner of **all drivers'** fastest laps |
| 🟩 Green | fastest of the drivers **you are comparing** |
| 🟨 Yellow | slower than the best compared driver |

> **Precision.** Per-corner times are an estimate with about **±0.05 s** of
> noise (4 Hz position data). They are good for spotting where time is gained
> or lost, not for thousandths.

## Step 9 · Ideal laps and the "quickest line"

* **Ideal lap · best sectors**: sum of the official session-best S1 + S2 + S3.
  This is exact.
* **Ideal lap · best corners**: sum of the session-best time through every
  corner segment. Because it picks the minimum of 11–20 noisy values, it is
  optimistic. Read it as an upper bound on what was possible.
* **Map → Session best** paints every corner segment in the team colour of the
  driver who was fastest there. That is the session's "quickest line" assembled
  from the best driver in each corner. The dashed purple line on top is the
  single fastest lap of the session.
* **Map → Dominance** does the same for the drivers you selected only.

## Step 10 · Lap replay

The **Replay lap** button animates every compared driver along their fastest lap
in real time (or 0.25×–2×), using the telemetry `Time` channel. All cars start at
0 s, so the gap you see between the dots is the real time gap at that moment.

---

## Reproduce a figure in a notebook

```python
import fastf1, matplotlib.pyplot as plt
fastf1.Cache.enable_cache("cache")
s = fastf1.get_session(2024, "Monza", "Q"); s.load()
for drv, c in (("NOR", "orange"), ("LEC", "red")):
    tel = s.laps.pick_drivers(drv).pick_fastest().get_telemetry()
    plt.plot(tel["Distance"], tel["Speed"], color=c, label=drv)
plt.legend(); plt.xlabel("Distance (m)"); plt.ylabel("Speed (km/h)"); plt.show()
```
