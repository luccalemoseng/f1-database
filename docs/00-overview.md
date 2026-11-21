# Overview

**F1 Database** is an interactive Formula 1 dashboard built on top of
[FastF1](https://docs.fastf1.dev/), the open-source Python library that gives
access to official F1 timing, telemetry and results.

This documentation explains **how the platform works** and **how every figure
on screen is obtained from FastF1**, so you can reproduce, audit or extend it.

## Phases

| Phase | Page | What it does | Status |
|---|---|---|---|
| 1 | **Compare** | Head-to-head of drivers' fastest laps in any session (FP1–FP3, Sprint Quali, Sprint, Quali, Race): racing lines on the circuit, sector and corner timing with F1 colours, telemetry traces, lap replay | ✅ Done |
| 2 | **Season** | Points per driver per round, standings progression, teammate head-to-heads, results grid, and a documented Parquet + DuckDB dataset for a future championship-prediction model | ✅ Done |
| 3 | **Analysis** | Race level: tyre strategy, race pace, fuel-corrected degradation, speed and braking vs. the track, corner-type performance per team. Season level: points per driver within each team, qualifying vs. race, form, reliability, one-lap vs. race pace | ✅ Done |
| 4 | **Live** | Live timing through FastF1's F1 TV client (you sign in on formula1.com, never in this app), plus replay of any past session from F1's archive | ✅ Done |

## Architecture

```
┌──────────────────────┐   /api/*   ┌──────────────────────┐   HTTPS   ┌──────────────────────┐
│ React + TypeScript   │ ─────────▶ │ FastAPI (Python)     │ ────────▶ │ F1 live-timing       │
│ (Vite, hand-made SVG │ ◀───────── │ FastF1 + pandas      │ ◀──────── │ archive + Jolpica    │
│  charts and maps)    │    JSON    │ in-memory cache      │           │ (Ergast) API         │
└──────────────────────┘            └──────────┬───────────┘           └──────────────────────┘
                                               │
                                     cache/  (FastF1 HTTP cache)
                                     data/   (Parquet datasets, Phase 2+)
```

* **Frontend** (`frontend/`): React 19 + TypeScript built with Vite. All charts
  and the track map are drawn as plain SVG, which gives full control over the F1
  look and keeps the bundle small.
* **Backend** (`backend/app/`): FastAPI. Each endpoint calls FastF1, turns
  pandas objects into compact JSON and caches the result.
* **Caching**: FastF1 stores every raw HTTP response in `cache/`. The first time a
  session is opened it is downloaded (20–60 s). After that it loads in a few seconds.

## Data coverage

FastF1 provides full telemetry (car data and positions) from **2018** onwards.
That is the range this dashboard supports. Results-only history (1950+) can be
added later from the Jolpica-F1 (Ergast) API, which FastF1 also wraps.

## Design

* Official F1 palette: F1 Red `#E10600`, Black `#15151E`, Carbon `#38383F`, White,
  and the timing colours **purple** (session best), **green** (personal best) and
  **yellow** (slower).
* Drivers are identified by their **team colour** (from FastF1's `TeamColor`).
  When two teammates are compared, the second one is drawn **dashed**. Every
  line also carries the driver's three-letter code in a legend, so identity never
  depends on colour alone.
* Timing colours are reserved for status and are never used as series colours.
  Green and yellow can look alike for colour-blind users, so every coloured cell
  also prints its gap to the best as a number.
