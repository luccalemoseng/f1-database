# Getting started

## Requirements

* Python 3.11+ (tested with 3.13)
* Node.js 20+ (tested with 24)
* Internet access the first time each session is opened

## 1. Install

From the project root (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt

cd frontend
npm install
cd ..
```

## 2. Run

Open two terminals, or run `.\start.ps1`, which starts both:

```powershell
# Terminal 1 - API on http://127.0.0.1:8000  (docs: /docs)
.venv\Scripts\python -m uvicorn backend.app.main:app --reload --port 8000

# Terminal 2 - Web app on http://localhost:5173
cd frontend
npm run dev
```

Open **http://localhost:5173**.

> If port 8000 is busy, run the API on another port and tell Vite where it is:
> `$env:API_URL = "http://127.0.0.1:8010"; npm run dev` (PowerShell).

## 3. Build the season dataset (Phase 2)

The Season page reads a local dataset. Build it once (about 80 minutes; it can
be stopped and resumed), then re-run it after each race weekend to add the new
round:

```powershell
.venv\Scripts\python -m backend.pipeline.build_dataset
```

See *Phase 2 · Season dataset* for details.

## 4. First load

The first time you open a session, the backend downloads it from the F1 archive
through FastF1. While that happens the page shows the five start lights. This
takes **20–60 seconds**. The data is then cached in `cache/` and later loads take
a few seconds.

> Tip: the cache can grow to several GB if you browse many sessions. It is safe
> to delete `cache/` at any time; it will be rebuilt on demand.

## Project layout

```
F1 Database/
├── backend/
│   ├── requirements.txt
│   ├── pipeline/
│   │   ├── build_dataset.py   Phase 2 dataset builder
│   │   └── export_ml.py       Flat ML tables
│   └── app/
│       ├── main.py       FastAPI routes
│       ├── loader.py     FastF1 session loading + caching
│       ├── phase1.py     Compare page computations
│       ├── phase2.py     DuckDB views + Season page queries
│       ├── phase3.py     Race and season analysis
│       ├── live.py       Live timing / replay engine
│       ├── utils.py      JSON / rotation helpers
│       └── config.py     Paths and constants
├── frontend/
│   └── src/
│       ├── pages/        ComparePage, DocsPage, ...
│       ├── components/   TrackMap, TraceChart, TimingTower, SplitTables
│       ├── api.ts        Typed API client + formatters
│       └── index.css     Design tokens (F1 palette)
├── docs/                 This documentation (also shown in-app under "Docs")
├── cache/                FastF1 HTTP cache (generated)
└── data/                 Parquet datasets (Phase 2, generated)
```

## API endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/seasons` | Supported seasons (2018 → current) |
| GET | `/api/events/{year}` | Grands Prix of the season with their sessions and whether each already ran |
| GET | `/api/session/{year}/{round}/{session}` | Session overview: track, corners, sectors, every driver's fastest lap with timing colours |
| GET | `/api/compare/{year}/{round}/{session}?drivers=VER,NOR` | Resampled telemetry, gaps and corner-by-corner timing for up to 6 drivers |
| GET | `/api/season/{year}` | Standings, points progression, results grid, teammate head-to-heads (from the dataset) |
| GET | `/api/dataset` | Tables in the dataset with row counts, seasons and columns |
| GET | `/api/analysis/race/{year}/{round}/{session}` | Strategy, pace, degradation, track character, corner-type performance |
| GET | `/api/analysis/season/{year}` | Team points split, racecraft, form, reliability, pace |
| GET/POST | `/api/live/*` | Live timing and replay (see *Phase 4 · Live timing*) |

Interactive API docs (Swagger) are available at http://127.0.0.1:8000/docs.
