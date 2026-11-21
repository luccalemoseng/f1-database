# The car figure

At the bottom of the **Season** page, an interactive isometric drawing shows
the car of that season's regulation era, standing on an FIA scrutineering
platform.

| Era | Seasons | What changes in the drawing |
|---|---|---|
| High-rake | 2018–2021 | 13-inch wheels, high nose with pylons, tall front-wing endplates, bargeboards, tall rear-wing endplates, shark fin |
| Ground effect | 2022–2025 | 18-inch wheels with covers and wake deflectors, low nose on the mainplane, floor edge wing, downwash sidepods, rolled-tip rear wing and beam wing |
| Active aero | 2026– | 100 mm narrower, 200 mm shorter wheelbase, narrower tyres, moving front **and** rear flaps, no beam wing |

## Reading it

* **The platform is a ruler.** Ticks along the near edge and across the front
  edge are every **100 mm**, with a major tick every metre. The white markers
  sit at the two axles (wheelbase) and at the car's overall width, so the eras
  can be compared directly.
* **Load pads** under each tyre stand for the weighbridge. The readout shows
  the FIA minimum weight for the selected season (driver included).
* **The lit part moves.** The rear-wing flap swings open and closed the way
  DRS does on a straight. In 2026 both front-wing flaps and the rear flap
  switch together (active aero). Click the drawing, or press Enter or Space,
  to toggle it.
* **Hover any part** (front wing, halo, sidepods, floor, wheels…) for the
  regulation fact behind it.
* **Livery buttons** repaint the bodywork in any team colour from that season.

## How it is made

The drawing is built ahead of time with the **Anatomy** isometric kit, a small
library that draws solid objects as layered SVG with four-tone shading and a
measured painter's order.

```powershell
node frontend/figures/f1car/build.mjs      # writes frontend/src/generated/f1car.json
```

* **One parametric car.** `ERAS` in `build.mjs` holds each era's real
  dimensions from the FIA Technical Regulations (wheelbase, width, tyre
  diameter and widths, wing spans, flap angles). Everything is drawn from
  those numbers, at 1 world unit = 20 mm.
* **Bodywork as contour slices.** The nose, survival cell, sidepods and engine
  cover are stacks of extruded slices, like a machined scale model. Each slice
  is a rounded plan built from half-width "knots" along the car.
* **Wings are airfoil prisms.** Every element is an inverted airfoil section
  (suction side down) extruded across the span. The moving flap is pre-built in
  9 positions, pivoting on its trailing edge, and the page swaps between them
  with eased motion.
* **Wheels are turned parts** (tyre profile with rounded shoulders, rim, wheel
  cover or spokes, nut). Suspension members and the halo are tubes.
* **Painter's order is measured, not guessed.** Every part records its true 3D
  shape. The kit ray-casts every pair of parts that overlap on screen and sets
  the drawing order so the nearer surface is always painted last.
* The page loads the ~1 MB of pre-built SVG lazily, only when the Season page
  is opened.

## Sources for the numbers

| Value | 2018–21 | 2022–25 | 2026 |
|---|---|---|---|
| Minimum weight (kg) | 733 / 743 / 746 / 752 | 798 / 798 / 798 / 800 | 768 |
| Max. width | 2,000 mm | 2,000 mm | 1,900 mm |
| Max. wheelbase | free (≈ 3,650 mm typical) | 3,600 mm | 3,400 mm |
| Wheel rims | 13 in | 18 in | 18 in (front −25 mm, rear −30 mm tyre width) |
| Overtaking aid | DRS, 85 mm slot | DRS, 85 mm slot | active front and rear wings |
| Power unit | V6 turbo + MGU-K 120 kW + MGU-H | same, E10 fuel | V6 + MGU-K 350 kW, no MGU-H, sustainable fuel |

Values are rounded from the FIA Formula 1 Technical Regulations of each
season. The drawing is illustrative: real team designs differ in every detail.
