# Phase 4 · Live timing

The **Live** page shows a session as it happens: timing tower with sector
colours, gaps and intervals, tyres, pit stops, race control, track status,
weather and car positions on a map. It has two sources that feed **the same
engine** (`backend/app/live.py`).

## 1. Live session (F1 TV)

FastF1 includes a client for F1's live-timing feed (a SignalR connection to
`livetiming.formula1.com`). F1 requires an **F1 TV Access, Pro or Premium**
subscription for it.

### Signing in, without sharing a password

1. Click **Connect to live timing**.
2. The first time, FastF1 starts a small local helper and asks you to sign in.
   The page shows an **Open F1 TV sign-in** button (a link to
   `f1login.fastf1.dev`, FastF1's sign-in page).
3. You log in **on formula1.com in your own browser**. The page hands FastF1 a
   session token, which FastF1 verifies against F1's public keys and stores in
   its own user folder (`%LOCALAPPDATA%\fastf1\f1auth.json`).
4. The feed starts. Next time the saved token is reused until it expires. The
   page shows "F1 TV token saved".

This project never asks for, receives or stores your F1 TV password.

### What happens while connected

```python
from fastf1.livetiming.client import SignalRClient
SignalRClient("data/live/live_20261025_190000.txt", timeout=0).start()
```

* Every message is written to a file in `data/live/`, so a live session is also
  a recording you keep.
* A second thread **tails** that file and applies each message to the state.

You can also record from a terminal, without the dashboard:

```powershell
.venv\Scripts\python -m fastf1.livetiming save data\live\my_session.txt
```

## 2. Replay a past session

No subscription is needed. F1 archives the same live-timing topics for every
session. FastF1 fetches them (`fastf1._api.fetch_page`, cached and rate
limited):

| Topic | Gives |
|---|---|
| `SessionInfo`, `SessionStatus`, `LapCount`, `ExtrapolatedClock` | header, lap counter, clock |
| `DriverList` | codes, names, team colours |
| `TimingData` | position, gap, interval, last/best lap, sectors with **personal / overall best flags** |
| `TimingAppData` | tyre stints (compound, age, new or used) |
| `TrackStatus`, `RaceControlMessages` | flags, Safety Car, penalties, deleted laps |
| `WeatherData` | air and track temperature, rain |
| `Position.z` | X/Y of every car (zlib-compressed, decoded by `fastf1._api.parse`) |

All messages are merged into one timeline and played on a clock you can speed
up (1–60×) or **seek** with the slider. The clock's zero is when the session
status becomes `Started`.

## The state engine

F1 sends **only what changed**. A message like

```json
["TimingData", {"Lines": {"16": {"Sectors": {"1": {"Value": "28.095", "OverallFastest": true}}}}}]
```

updates one sector of car 16. `deep_merge` applies such deltas to the stored
state. Lists arrive as objects keyed by index (`{"1": …}`) and are merged in
place.

* **Sector and lap colours** come straight from F1's flags: `OverallFastest`
  → purple, `PersonalFastest` → green, any other time → yellow.
* **Track map.** No circuit file is needed: the outline is drawn from one car's
  own positions (one point every 6 m). It breaks into a new segment whenever
  that car "jumps" more than 150 m (garage, skipped data).
* The page polls `/api/live/state` every second.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/live/status` | mode (idle / live / replay), sign-in link if FastF1 is waiting, token state, replay clock |
| GET | `/api/live/state` | current snapshot: session, lap, track status, weather, timing rows, race control, positions, outline |
| POST | `/api/live/start` | `{"mode": "live"}` or `{"mode": "replay", "year", "round", "session", "speed", "start"}` |
| POST | `/api/live/control` | `{"speed": 30}` or `{"seek": 1800}` (seconds from the start) |
| POST | `/api/live/stop` | stop the current source |

## Limits

* Live data only flows while a session is running (practice, qualifying, sprint
  or race).
* The feed is unofficial for third-party use. F1 can change it at any time, and
  FastF1 usually adapts within days. Keep FastF1 up to date
  (`pip install -U fastf1`).
* Car positions on the map lag the timing by a few seconds, as on F1's own app.
