# F1 car figure

`build.mjs` draws the car with the Anatomy isometric kit (copied in `../kit/`) and
writes `src/generated/f1car.json`, which `src/components/f1car/CarFigure.tsx`
loads lazily. Rebuild it after editing the geometry:

```powershell
node frontend/figures/f1car/build.mjs
```
