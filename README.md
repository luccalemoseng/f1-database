# F1 Database

An interactive Formula 1 dashboard powered by [FastF1](https://docs.fastf1.dev/).
It uses a FastAPI backend and a React + TypeScript frontend styled in the official F1 palette.

* **Phase 1 · Compare** ✅ Compare drivers' fastest laps in any session from 2018 onwards: racing lines on the track map,
  sector and corner timing in F1 colours, speed/throttle/brake/gear traces, and lap replay.
* **Phase 2 · Season** ✅ Standings, points progression, teammate duels, results grid, and a documented Parquet + DuckDB dataset ready for ML (`docs/03-phase2-dataset.md`). Includes an interactive isometric car for each regulation era (`docs/04-car-figure.md`).
* **Phase 3 · Analysis** ✅ Tyre strategy, fuel-corrected race pace and degradation, speed and braking vs. the track, corner-type performance per team; season-level points split, racecraft, form, reliability and pace (`docs/05-phase3-analysis.md`).
* **Phase 4 · Live** ✅ Live timing through FastF1's F1 TV client (you sign in on formula1.com yourself), or a replay of any past session from F1's archive (`docs/06-phase4-live.md`).

## Quick start (Windows / PowerShell)

```powershell
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt
cd frontend; npm install; cd ..
.\start.ps1          # opens http://localhost:5173
```

Full documentation is in [`docs/`](docs/00-overview.md) and on the **Docs** tab inside the app.
