"""Export the ML-ready views to standalone files.

    .venv\Scripts\python -m backend.pipeline.export_ml

Writes data/ml/race_features.{parquet,csv} and data/ml/season_summary.{parquet,csv}.
These are flat tables you can load straight into pandas / scikit-learn.
"""
from ..app.config import DATA_DIR
from ..app.phase2 import connect


def main():
    out = DATA_DIR / "ml"
    out.mkdir(exist_ok=True)
    con = connect()
    for view, name in (("ml_race_features", "race_features"), ("ml_season_summary", "season_summary")):
        df = con.execute(f"SELECT * FROM {view}").df()
        df.to_parquet(out / f"{name}.parquet", index=False)
        df.to_csv(out / f"{name}.csv", index=False)
        print(f"{name}: {len(df):,} rows x {df.shape[1]} columns -> {out / name}.parquet/.csv")


if __name__ == "__main__":
    main()
