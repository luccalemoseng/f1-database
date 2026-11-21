// Builds the isometric F1 car figure for each regulation era (Anatomy kit).
//
//   node frontend/figures/f1car/build.mjs           -> frontend/src/generated/f1car.json
//   node frontend/figures/f1car/build.mjs --audit   -> also prints the geometry audit
//
// One parametric car, three eras. World units: 1 unit = 20 mm. x runs along
// the car (nose at +x), y across it (+y faces the viewer), z up. The car stands
// on an FIA scrutineering platform: a weighbridge with a load pad under each
// tyre and ruler strips with a tick every 100 mm, so the drawing itself shows
// the true length, width and wheelbase of each era.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import * as A from "../kit/audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../src/generated/f1car.json");
const DEG = Math.PI / 180;
const MM = 1 / 20; // world units per millimetre

const W = 960;
const H = 470;
const AZ = 60;
const EL = 25;

// ---------------------------------------------------------------- the eras
// Dimensions from the FIA Technical Regulations of each era (rounded).
const ERAS = {
  e2018: {
    label: "2018–2021", wheelbase: 3650, width: 2000, tyreD: 660, rimIn: 13, frontTyre: 305, rearTyre: 405,
    nose: "high", fwSpan: 2000, fwFlaps: 3, rwSpan: 950, rwTop: 950, beam: false, endplates: "tall",
    bargeboards: true, wheelCovers: false, active: false, sidepods: "classic", sharkFin: true, floorWidth: 1600,
    flapClosed: 34, flapOpen: 8, drs: "DRS",
  },
  e2022: {
    label: "2022–2025", wheelbase: 3600, width: 2000, tyreD: 720, rimIn: 18, frontTyre: 305, rearTyre: 405,
    nose: "low", fwSpan: 2000, fwFlaps: 3, rwSpan: 950, rwTop: 920, beam: true, endplates: "rolled",
    bargeboards: false, wheelCovers: true, active: false, sidepods: "downwash", sharkFin: false, floorWidth: 1800,
    flapClosed: 34, flapOpen: 8, drs: "DRS",
  },
  e2026: {
    label: "2026–", wheelbase: 3400, width: 1900, tyreD: 720, rimIn: 18, frontTyre: 280, rearTyre: 375,
    nose: "low", fwSpan: 1900, fwFlaps: 2, rwSpan: 950, rwTop: 900, beam: false, endplates: "rolled",
    bargeboards: false, wheelCovers: true, active: true, sidepods: "downwash", sharkFin: false, floorWidth: 1500,
    flapClosed: 30, flapOpen: 4, drs: "Active aero",
  },
};

// ------------------------------------------------------------- the camera
const PLATE = { x: -170, y: -66, w: 344, d: 132, r: 6 };
const PLATE_H = 5;
const FOOT_H = 4;
const PAD_H = 1.6; // load pads: the tyres stand on these
const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-120, 0, 52], [-150, 20, 52], [-150, -20, 52]],
  W, H, { pad: 22, azimuth: AZ, elevation: EL },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const ALONG_Y = (o = [0, 0, 0]) => G.frameOf(o, [0, 1, 0], [1, 0, 0], [0, 0, 1]); // section in (x, z), extruded along y

// ------------------------------------------------------------- shapes
const rot = (cx, cz, a) => ([x, z]) => {
  const dx = x - cx, dz = z - cz;
  return [cx + dx * Math.cos(a) - dz * Math.sin(a), cz + dx * Math.sin(a) + dz * Math.cos(a)];
};

/** Inverted airfoil (suction side down) as a convex (x, z) polygon.
 *  `le` leading edge, the chord runs rearwards (-x) and the trailing edge rises by `aoa`. */
function airfoil(le, z, chord, thick, aoa, n = 9) {
  const up = [], low = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const f = 2.6 * Math.sqrt(t) * (1 - t);
    up.push([le - t * chord, z + 0.22 * thick * f]);
    low.push([le - t * chord, z - thick * f]);
  }
  const pts = [...up, ...low.slice(1, -1).reverse()];
  return pts.map(rot(le, z, -aoa * DEG));
}

/** A rounded plan from half-width knots [[x, halfWidth], …] (x descending),
 *  mirrored about y = 0, with round caps at both ends. */
function planOf(knots, steps = 7) {
  const ring = [];
  const [x0, w0] = knots[0];
  const [x1, w1] = knots[knots.length - 1];
  const mid = knots.slice(1, -1);
  for (let i = 0; i <= steps; i++) {             // front cap, +y round the tip to -y
    const a = (90 - (180 * i) / steps) * DEG;
    ring.push([x0 + w0 * 0.55 * Math.cos(a), w0 * Math.sin(a)]);
  }
  for (const [x, w] of mid) ring.push([x, -w]);
  for (let i = 0; i <= steps; i++) {             // rear cap, -y round the tail to +y
    const a = (-90 - (180 * i) / steps) * DEG;
    ring.push([x1 + w1 * 0.4 * Math.cos(a), w1 * Math.sin(a)]);
  }
  for (const [x, w] of [...mid].reverse()) ring.push([x, w]);
  return ring;
}

// ------------------------------------------------------------- one car
function buildEra(id) {
  const E = ERAS[id];
  const R = A.recorder(P);
  const rec = R.solid;
  const put = (part, ref, svg, shapes, bias = 0) =>
    R.put({ at: ref, bias, svg: `<g data-part="${part}">${svg}</g>`, shapes: shapes.map(rec), name: R.nameFor(part), part });

  const half = (E.width * MM) / 2;
  const tyreR = (E.tyreD * MM) / 2;
  const rimR = (E.rimIn * 25.4 * MM) / 2 + 0.6;
  const fw = E.frontTyre * MM, rw = E.rearTyre * MM;
  const xF = (E.wheelbase * MM) / 2, xR = -xF;
  const wz = PAD_H + tyreR;                  // axle height
  const FLOOR = 3.4;                          // floor underside (60 mm ride height)
  const floorHalf = (E.floorWidth * MM) / 2;
  const low = E.nose === "low";
  const anim = {};                            // active parts: [frames] of svg

  // --- extruded body slices -------------------------------------------------
  const slice = (part, knots, z0, z1, { livery = true, tone = "hi", bias = 0, bevel = 0.5, extra = "" } = {}) => {
    const ring = planOf(knots);
    const paths = k.extrude(ring, z0, z1 - z0, P, { convex: false, bevel });
    const cx = (knots[0][0] + knots[knots.length - 1][0]) / 2;
    put(part, [cx, 0, (z0 + z1) / 2], S(paths, { tone, className: livery ? "livery" : undefined }) + extra,
      [A.extruded(ring, z0, z1 - z0, { name: `${part}.slice` })], bias);
    return ring;
  };
  const wing = (part, le, z, chord, thick, aoa, y0, y1, { lit = false, livery = false, bias = 0 } = {}) => {
    const poly = airfoil(le, z, chord, thick, aoa);
    const F = ALONG_Y();
    const svg = S(G.prismOf(F, poly, y0, y1, P), { tone: "hi", lit, className: livery ? "livery" : undefined });
    put(part, [le - chord / 2, (y0 + y1) / 2, z], svg, [A.prism(F, poly, y0, y1, { name: `${part}.element` })], bias);
    return { F, poly };
  };
  const plate = (part, plan, z0, z1, { tone = "mid", livery = false, bias = 0 } = {}) => {
    put(part, [plan.x + plan.w / 2, plan.y + plan.d / 2, (z0 + z1) / 2],
      S(k.slabOf(plan, z0, z1 - z0, P, 2, 0.25), { tone, className: livery ? "livery" : undefined }),
      [A.slab(plan, z0, z1 - z0, { name: `${part}.plate` }, 2)], bias);
  };
  const rod = (part, a, b, r = 0.5, tone = "mid") => {
    const pieces = tubePieces([a, b], r, P, { maxLength: 14 });
    pieces.forEach((pc) => put(part, pc.mid, tubeSvg(pc, { tone }), [A.tube(pc.points, pc.radii, { name: `${part}.rod` })]));
  };
  const route = (part, points, r, tone = "hi", bend = 5) => {
    const pts = G.fillet(points, bend, 7, { P, tube: r });
    tubePieces(pts, r, P, { maxLength: 9 }).forEach((pc) =>
      put(part, pc.mid, tubeSvg(pc, { tone }), [A.tube(pc.points, pc.radii, { name: `${part}.tube` })]));
  };

  // A dark opening on the round front cap of a slice: angles a0..a1 round the cap.
  const capOpening = ([x0, w0], z0, z1, a0, a1) => {
    const arc = (z, from, to) => Array.from({ length: 13 }, (_, i) => {
      const a = (from + ((to - from) * i) / 12) * DEG;
      return at([x0 + w0 * 0.55 * Math.cos(a) + 0.05, w0 * Math.sin(a), z]);
    });
    const pts = [...arc(z0, a0, a1), ...arc(z1, a1, a0)];
    const d = `M${pts.map((q) => q.join(" ")).join("L")}Z`;
    return `<path class="car-void" d="${d}"/>` + Ln(d, { tone: "lo" });
  };

  // --- floor, plank, diffuser -------------------------------------------------
  const fx0 = xF - tyreR - 8;                  // floor leading edge
  const rearCut = xR + tyreR + 6;
  slice("floor", [[fx0, low ? 26 : 30], [fx0 - 12, floorHalf], [rearCut + 10, floorHalf], [rearCut, floorHalf - 8], [xR - 6, 26]],
    FLOOR, FLOOR + 1.1, { livery: false, tone: "mid", bevel: 0.3 });
  if (low) {
    // Ground-effect era: the floor edge wing and the Venturi tunnel inlets.
    slice("floor", [[fx0 - 10, floorHalf - 1.2], [rearCut + 16, floorHalf - 1.2]], FLOOR + 1.1, FLOOR + 1.9, { livery: false, tone: "mid", bias: 0.05 });
  }
  const dif = ALONG_Y();
  const difPoly = [[xR + 10, FLOOR], [xR - 9, FLOOR], [xR - 9, FLOOR + 9], [xR - 2, FLOOR + 6]];
  put("floor", [xR, 0, FLOOR + 4], S(G.prismOf(dif, difPoly, -24, 24, P), { tone: "mid" }), [A.prism(dif, difPoly, -24, 24, { name: "diffuser" })]);
  for (const y of [-18, -8, 8, 18]) {
    const poly = [[xR + 6, FLOOR + 1.1], [xR - 9, FLOOR + 1.1], [xR - 9, FLOOR + 9.6]];
    put("floor", [xR - 4, y, FLOOR + 4], S(G.prismOf(dif, poly, y - 0.35, y + 0.35, P), { tone: "mid" }), [A.prism(dif, poly, y - 0.35, y + 0.35, { name: "strake" })], 0.1);
  }

  // --- survival cell, nose, cockpit ------------------------------------------
  const cock = [xF - 40, xF - 74];             // cockpit opening (front, rear)
  slice("chassis", [[xF + 8, 11], [xF - 20, 14.5], [xF - 45, 18.5], [xF - 82, 19.5]], FLOOR + 1.1, 14);
  // cockpit floor: the dark recess sits on top of the middle slice
  const open = [[cock[0] + 2, -7], [cock[0] + 2, 7], [cock[1] - 2, 10.5], [cock[1] - 2, -10.5]];
  const recess = `<path class="car-void" d="${k.onTop(open, 23, P, true)}"/>`;
  slice("chassis", [[xF + 6, 9.5], [xF - 20, 13], [xF - 45, 16.5], [xF - 82, 17.5]], 14, 23, { extra: recess });
  // top slice: dash ahead of the cockpit, headrest behind, a rail each side
  const rimW = (x) => (x > xF - 25 ? 7.5 + (xF + 2 - x) * (3 / 27) : x > xF - 50 ? 10.5 + (xF - 25 - x) * (3 / 25) : 13.5 + (xF - 50 - x) * (1 / 32));
  slice("chassis", [[xF + 2, 7.5], [xF - 25, 10.5], [cock[0] + 4, rimW(cock[0])]], 23, 29);
  slice("chassis", [[cock[1] - 2, rimW(cock[1]) - 1], [xF - 82, 14.5]], 23, 29);
  for (const sgn of [-1, 1]) {
    const inner = (x) => (x > cock[0] - 14 ? 6.5 + (cock[0] - x) * (3 / 14) : 9.5 + (cock[0] - 14 - x) * (0.5 / 20));
    const xs = [cock[0] + 2, cock[0] - 10, cock[0] - 22, cock[1]];
    const ring = [...xs.map((x) => [x, sgn * rimW(x)]), ...[...xs].reverse().map((x) => [x, sgn * inner(x)])];
    put("chassis", [(cock[0] + cock[1]) / 2, sgn * 11, 26], S(k.extrude(ring, 23, 6, P, { convex: false, bevel: 0.4 }), { tone: "hi", className: "livery" }),
      [A.extruded(ring, 23, 6, { name: "chassis.rail" })]);
  }
  // driver: helmet with visor band, steering wheel
  const helmet = [cock[1] + 13, 0, 27.6];
  put("cockpit", helmet, S(G.sphereOf(helmet, 4.8, P), { tone: "hi", className: "helmet" }) +
    Ln(G.arcOf(G.frameOf(helmet, [0, 0, 1], [1, 0, 0], [0, 1, 0]), 1.2, 4.6, P, { least: 0.1 }), { tone: "lo" }),
  [A.ball(helmet, 4.8, { name: "helmet" })], 0.8);
  plate("cockpit", { x: cock[0] - 3, y: -3.5, w: 1.6, d: 7, r: 0.8 }, 25.5, 28, { tone: "mid" }); // steering wheel

  if (low) {
    slice("nose", [[xF + 50, 3.6], [xF + 36, 7], [xF + 18, 9.5], [xF + 4, 11]], 6.5, 12);
    slice("nose", [[xF + 38, 3.6], [xF + 22, 7.4], [xF + 4, 9.8]], 12, 17.5);
    slice("nose", [[xF + 20, 4.5], [xF + 2, 8.5]], 17.5, 22);
  } else {
    slice("nose", [[xF + 54, 3.2], [xF + 38, 6.5], [xF + 18, 9.5], [xF + 4, 11]], 12.5, 17.5);
    slice("nose", [[xF + 44, 3.4], [xF + 26, 7], [xF + 4, 9.8]], 17.5, 21.5);
    slice("nose", [[xF + 24, 4.2], [xF + 2, 8.2]], 21.5, 24);
    for (const y of [-3.4, 3.4]) plate("nose", { x: xF + 36, y: y - 0.4, w: 5, d: 0.8, r: 0.3 }, 5.4, 12.5, { bias: -0.2 }); // pylons
  }

  // --- sidepods ---------------------------------------------------------------
  const sp = E.sidepods === "classic"
    ? [
        [[[xF - 50, 36], [xF - 84, 37], [xR + 52, 28], [xR + 26, 16], [xR + 10, 11]], FLOOR + 1.1, 12],
        [[[xF - 52, 34], [xF - 84, 34.5], [xR + 56, 23], [xR + 30, 13], [xR + 12, 9]], 12, 19],
        [[[xF - 57, 29], [xF - 84, 29.5], [xR + 62, 18], [xR + 36, 11]], 19, 23],
      ]
    : [
        [[[xF - 52, 38], [xF - 88, 39], [xR + 48, 24], [xR + 22, 13], [xR + 10, 10]], FLOOR + 1.1, 11],
        [[[xF - 54, 36], [xF - 88, 36.5], [xR + 74, 20], [xR + 46, 12], [xR + 14, 8.5]], 11, 19],
        [[[xF - 58, 31], [xF - 84, 31.5], [xR + 96, 16], [xR + 70, 11]], 19, 23.5],
      ];
  if (E.width < 2000) sp.forEach((s) => (s[0] = s[0].map(([x, w]) => [x, w * 0.94])));
  sp.forEach(([knots, z0, z1], i) => slice("sidepods", knots, z0, z1,
    { extra: i === 1 ? capOpening(knots[0], z0 + 1.6, z1 - 1.4, 28, 72) + capOpening(knots[0], z0 + 1.6, z1 - 1.4, -72, -28) : "" }));
  // mirrors: housing on a stalk each side
  for (const s of [-1, 1]) {
    rod("mirrors", [xF - 50, s * 13.8, 26], [xF - 51, s * 21, 29.5], 0.45);
    plate("mirrors", { x: xF - 54, y: s > 0 ? 20.5 : -25, w: 5.5, d: 4.5, r: 1 }, 29.2, 32.2, { tone: "hi", livery: true });
  }
  // bargeboards (2018-21 only): a row of vertical vanes ahead of the sidepods
  if (E.bargeboards) {
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const x = xF - 24 - i * 4.5;
      plate("bargeboards", { x, y: s * (24 + i * 2.6) - 0.3, w: 9, d: 0.6, r: 0.2 }, FLOOR + 1.1, 12 - i, { tone: "mid" });
    }
  }

  // --- engine cover, airbox, roll hoop ---------------------------------------
  slice("engine", [[xF - 76, 14], [xF - 100, 13], [xR + 40, 8.5], [xR + 6, 6]], 23, 29.5);
  slice("engine", [[xF - 79, 10], [xF - 95, 10], [xR + 54, 6], [xR + 22, 4]], 29.5, 35.5);
  slice("engine", [[xF - 80, 7.4], [xF - 92, 8], [xF - 122, 4.2], [xR + 46, 2.6]], 35.5, 41.5,
    { extra: capOpening([xF - 80, 7.4], 37, 40.6, -55, 55) });
  // T-camera on the roll hoop
  plate("engine", { x: xF - 87, y: -1, w: 3.2, d: 2, r: 0.5 }, 41.5, 43.6, { tone: "mid" });
  plate("engine", { x: xF - 87.2, y: -6, w: 3.6, d: 12, r: 0.8 }, 43.6, 44.6, { tone: "mid", livery: true });
  if (E.sharkFin) {
    const fin = [[xF - 95, 35.5], [xR + 18, 27], [xR + 18, 35.5]];
    const F = ALONG_Y();
    put("engine", [xF - 120, 0, 33], S(G.prismOf(F, fin, -0.4, 0.4, P), { tone: "hi", className: "livery" }), [A.prism(F, fin, -0.4, 0.4, { name: "fin" })], 0.2);
  }
  // crash structure, rain light and exhaust
  slice("rear", [[xR + 8, 4.4], [xR - 12, 3.4]], 11, 17, { tone: "mid", livery: false });
  plate("rear", { x: xR - 13.2, y: -2.2, w: 1, d: 4.4, r: 0.4 }, 12, 15, { tone: "hi" });
  put("rear", [xR - 13, 0, 13.5], `<path class="car-rainlight" d="${k.onTop([[xR - 13.2, -2], [xR - 12.4, -2], [xR - 12.4, 2], [xR - 13.2, 2]], 15, P, true)}"/>`, [], 0.3);
  const ex = G.frameOf([xR + 4, 0, 22.5], [-1, 0, 0], [0, 1, 0], [0, 0, 1]);
  put("rear", [xR, 0, 22.5], S(G.disc(0, 6, 2.2, ex, P), { tone: "mid" }) + Ln(G.circleOf(ex, 6, 1.5, P), { tone: "lo" }),
    [A.disc(ex, 0, 6, 2.2, { name: "exhaust" })], 0.2);

  // --- halo ---------------------------------------------------------------------
  const hx = cock[1] + 2;
  route("halo", [[hx, 12.6, 29], [hx + 2, 12.2, 35.5], [hx + 16, 9.4, 37.6], [hx + 30, 0, 37.2], [hx + 16, -9.4, 37.6], [hx + 2, -12.2, 35.5], [hx, -12.6, 29]], 1.3, "hi", 6);
  route("halo", [[hx + 30, 0, 37.2], [hx + 36, 0, 29]], 1.1, "hi", 2);

  // --- front wing -----------------------------------------------------------
  const fwHalf = (E.fwSpan * MM) / 2;
  const le = low ? xF + 56 : xF + 60;
  wing("frontwing", le, 4.2, 15, 1.6, 4, -fwHalf + 1, fwHalf - 1, { bias: -0.1 });
  const flapFrames = [];
  for (let f = 0; f <= E.fwFlaps; f++) flapFrames.push([]);
  for (let i = 0; i < E.fwFlaps; i++) {
    const segs = [[-fwHalf + 1, -8], [8, fwHalf - 1]];
    for (const [y0, y1] of segs) {
      const base = { le: le - 7 - i * 3.6, z: 6 + i * 2.2, chord: 9 - i * 1.5, aoa: 14 + i * 10 };
      if (E.active) {
        // 2026: the flaps pivot at their trailing edge into straight-line mode.
        const frames = [];
        for (let t = 0; t <= 8; t++) {
          const aoa = base.aoa + (6 - base.aoa) * (t / 8);
          const poly = airfoil(base.le, base.z, base.chord, 1.1, aoa);
          frames.push(S(G.prismOf(ALONG_Y(), poly, y0, y1, P), { tone: "hi", lit: true }));
        }
        const key = `fw${i}${y0 < 0 ? "L" : "R"}`;
        anim[key] = frames;
        const poly = airfoil(base.le, base.z, base.chord, 1.1, base.aoa);
        R.put({ at: [base.le - 4, (y0 + y1) / 2, base.z], bias: 0, svg: `<g data-part="frontwing" data-anim="${key}">${frames[0]}</g>`,
          shapes: [rec(A.prism(ALONG_Y(), poly, y0, y1, { name: key }))], name: key, part: "frontwing" });
      } else {
        wing("frontwing", base.le, base.z, base.chord, 1.1, base.aoa, y0, y1, { livery: i === E.fwFlaps - 1 });
      }
    }
  }
  for (const s of [-1, 1]) {
    const y = s * fwHalf - (s > 0 ? 1.2 : 0);
    if (low) {
      plate("frontwing", { x: le - 18, y, w: 20, d: 1.2, r: 0.5 }, 3.6, 9.5, { tone: "mid", livery: true });
      plate("frontwing", { x: le - 18, y: y + (s > 0 ? -6 : 1.2), w: 10, d: 6, r: 2.5 }, 9.5, 10.4, { tone: "mid", livery: true }); // swept tip
    } else {
      plate("frontwing", { x: le - 19, y, w: 21, d: 1.2, r: 0.5 }, 3.4, 15, { tone: "mid", livery: true });
      plate("frontwing", { x: le - 20, y: y + (s > 0 ? -1.5 : 1.2), w: 6, d: 1.5, r: 0.4 }, 3.4, 8, { tone: "mid" }); // footplate
    }
  }

  // --- rear wing --------------------------------------------------------------
  const rwHalf = (E.rwSpan * MM) / 2;
  const rwz = (E.rwTop * MM) - 10;              // mainplane height
  const rle = xR - 8;
  wing("rearwing", rle, rwz, 13, 2.2, 6, -rwHalf + 0.8, rwHalf - 0.8, { livery: true });
  // flap: pivots at its trailing edge, as DRS / active aero does
  const flap = { le: rle - 9, z: rwz + 4.6, chord: 11 };
  const te = (aoa) => [flap.le - flap.chord * Math.cos(aoa * DEG), flap.z + flap.chord * Math.sin(aoa * DEG)];
  const pivot = te(E.flapClosed);
  const flapAt = (aoa) => {
    const tip = te(aoa);
    const leNow = flap.le + (pivot[0] - tip[0]);
    const zNow = flap.z + (pivot[1] - tip[1]);
    return airfoil(leNow, zNow, flap.chord, 1.5, aoa);
  };
  const rframes = [];
  for (let t = 0; t <= 8; t++) {
    const aoa = E.flapClosed + (E.flapOpen - E.flapClosed) * (t / 8);
    rframes.push(S(G.prismOf(ALONG_Y(), flapAt(aoa), -rwHalf + 0.8, rwHalf - 0.8, P), { tone: "hi", lit: true }));
  }
  anim.rw = rframes;
  R.put({ at: [flap.le - 5, 0, flap.z + 3], bias: 0.05, svg: `<g data-part="rearwing" data-anim="rw">${rframes[0]}</g>`,
    shapes: [rec(A.prism(ALONG_Y(), flapAt(E.flapClosed), -rwHalf + 0.8, rwHalf - 0.8, { name: "rw.flap" }))], name: "rw.flap", part: "rearwing" });
  // DRS actuator pod on the mainplane, link to the flap
  plate("rearwing", { x: rle - 9, y: -1.2, w: 5, d: 2.4, r: 0.8 }, rwz + 1.2, rwz + 4.4, { tone: "mid", bias: 0.1 });
  for (const s of [-1, 1]) {
    const y = s * rwHalf - (s > 0 ? 1 : 0);
    if (E.endplates === "tall") {
      plate("rearwing", { x: rle - 24, y, w: 27, d: 1, r: 0.6 }, 20, rwz + 12, { tone: "mid", livery: true });
    } else {
      plate("rearwing", { x: rle - 21, y, w: 22, d: 1, r: 3 }, 24, rwz + 2, { tone: "mid", livery: true });
      plate("rearwing", { x: rle - 21, y: y + (s > 0 ? -3.4 : 1), w: 22, d: 3.4, r: 1.6 }, rwz + 2, rwz + 3.2, { tone: "mid", livery: true }); // rolled tip
    }
  }
  // pylon from the crash structure to the wing
  plate("rearwing", { x: rle - 9, y: -0.5, w: 7, d: 1, r: 0.3 }, 17, rwz - 1, { tone: "mid" });
  if (E.beam) {
    wing("rearwing", xR - 4, 19, 8, 1.2, 10, -rwHalf + 3, rwHalf - 3);
    wing("rearwing", xR - 9, 22.4, 6, 1, 26, -rwHalf + 3, rwHalf - 3);
  }

  // --- wheels and suspension ----------------------------------------------------
  const corners = [
    { x: xF, w: fw, front: true }, { x: xR, w: rw, front: false },
  ];
  for (const c of corners) for (const s of [-1, 1]) {
    const yIn = s * (half - c.w);                // inner face of the tyre
    const yUp = s * (half - c.w - 2.2);          // upright
    const near = s > 0;
    // suspension: upper and lower wishbones, push/pull rod, track rod
    const body = c.front ? [c.x + 4, c.x - 12] : [c.x + 10, c.x - 4];
    const inb = c.front ? 10.5 : 7;
    for (const [z0, z1] of [[wz + 6.5, 21], [wz - 6.5, 8.5]]) {
      rod("suspension", [body[0], s * inb, z1], [c.x + 0.6, yUp, z0]);
      rod("suspension", [body[1], s * inb, z1], [c.x - 0.6, yUp, z0]);
    }
    rod("suspension", [c.x - 6, s * (inb - 0.5), 25], [c.x + 0.4, yUp, wz - 5.6], 0.45);
    if (c.front) rod("suspension", [c.x + 7, s * inb, 13], [c.x + 5, yUp, wz], 0.4);
    else rod("suspension", [c.x + 2, s * 6, wz], [c.x, yUp, wz], 0.9); // driveshaft
    plate("suspension", { x: c.x - 2.4, y: yUp - 1.2, w: 4.8, d: 2.4, r: 0.6 }, wz - 8, wz + 8, { tone: "mid" });

    // tyre: a turned profile with rounded shoulders, axis along y (outwards)
    const F = G.frameOf([c.x, yIn, wz], [0, s, 0], [1, 0, 0], [0, 0, 1]);
    const w = c.w;
    const prof = [[0, tyreR - 2.6], [0.4, tyreR - 1.2, 1], [1.6, tyreR, 1], [w - 1.6, tyreR, 1], [w - 0.4, tyreR - 1.2, 1], [w, tyreR - 2.6]];
    const details = [];
    if (near) {
      details.push(Ln(G.circleOf(F, w, rimR + (tyreR - rimR) * 0.62, P), { tone: "faint" })); // compound band
      details.push(S(G.disc(w - 0.6, w + 0.05, rimR, F, P), { tone: "mid" }));
      if (E.wheelCovers) {
        details.push(S(G.disc(w + 0.05, w + 0.35, rimR - 0.8, F, P), { tone: "hi", className: "livery" }));
        details.push(Ln(G.circleOf(F, w + 0.35, rimR * 0.45, P), { tone: "lo" }));
      } else {
        details.push(Ln(G.spokesOf(F, w + 0.05, 2.2, rimR - 0.7, 10, P), { tone: "lo" }));
        details.push(Ln(G.circleOf(F, w + 0.05, rimR - 0.7, P), { tone: "lo" }));
      }
      details.push(S(G.disc(w + 0.35, w + 1.5, 1.7, F, P), { tone: "hi" }));
      details.push(Dots(G.dotsOf(F, w + 1.5, 1.0, 6, P, { all: true }), { size: 0.4, tone: "lo" }));
    }
    put("wheels", [c.x, yIn + s * w / 2, wz], S(G.solidOf(prof, F, P), { tone: "lo", className: "tyre" }) + details.join(""),
      [A.solid(F, prof, { name: "tyre" })]);
    // wheel-wake deflector over the front tyre (ground-effect era)
    if (E.wheelCovers && c.front) plate("wheels", { x: c.x - 5, y: s > 0 ? yIn + 1 : yIn - c.w + 1, w: 10, d: c.w - 2, r: 2 }, wz + tyreR + 0.8, wz + tyreR + 1.4, { tone: "mid" });
  }

  // --- settle the painter's order from the recorded shapes ---------------------
  A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  if (process.argv.includes("--audit")) {
    const res = A.audit(R, P, {});
    console.log(id, "depth problems:", res.depth?.problems?.length ?? 0);
    if (process.argv.includes("--verbose")) for (const q of (res.depth?.problems ?? []).slice(0, 60)) console.log("  ", JSON.stringify(q).slice(0, 160));
  }
  return { svg: R.items.map((i) => i.svg).join(""), anim, dims: { xF, xR, half, tyreR, wz } };
}

// ------------------------------------------------------------- the platform
function platform() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  const feet = k.corners(PLATE, 16).sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of feet) {
    out.push(S(k.cylinder(x, y, 6, -PLATE_H - FOOT_H, 1.4, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 4.6, -PLATE_H - FOOT_H + 1.4, FOOT_H - 1.4, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: "mid" }));
  out.push(Ln(k.planOutline(k.insetPlan(PLATE, 4.5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 9);
  out.push(Ln(screws.map(([x, y]) => k.ring(x, y, 1.9, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(Dots(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // ruler strip along the near edge: a tick every 100 mm, a major every metre
  const strip = { x: -160, y: PLATE.y + PLATE.d - 13, w: 324, d: 6, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.5, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.x + 2, strip.x + strip.w - 2, 100 * MM, 10, strip.y + 0.6, 0.5, [1.6, 3.4], P);
  out.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  // width strip across the front edge
  const wstrip = { x: PLATE.x + PLATE.w - 12, y: -58, w: 5.5, d: 116, r: 1 };
  out.push(S(k.slabOf(wstrip, 0, 0.5, P, 3), { tone: "lo", crease: "none" }));
  const wt = k.topTicks(wstrip.y + 2, wstrip.y + wstrip.d - 2, 100 * MM, 10, wstrip.x + 0.6, 0.5, [1.4, 3], P, "y");
  out.push(Ln(wt.minor, { tone: "lo" }), Ln(wt.major, { tone: "mid" }));
  // FIA label plate, rear corner
  const lab = { x: PLATE.x + 10, y: PLATE.y + PLATE.d - 30, w: 24, d: 13, r: 1 };
  out.push(S(k.slabOf(lab, 0, 0.6, P, 3), { tone: "mid" }));
  out.push(Ln(k.planOutline(k.insetPlan(lab, 1.4), 0.6, P, 3), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([lab.x + 3, lab.y + 4.6], 0.6, P, "x"), "FIA", { size: 3.2, tone: "mid" }));
  for (const [i, len] of [[0, 15], [1, 11]]) out.push(Ln(k.lineOnTop([lab.x + 3, lab.y + 7.4 + i * 2.4], [lab.x + 3 + len, lab.y + 7.4 + i * 2.4], 0.6, P), { tone: "lo", free: true }));
  out.push(Dots([at([lab.x + lab.w - 2, lab.y + 2, 0.6]), at([lab.x + lab.w - 2, lab.y + lab.d - 2, 0.6])], { size: 0.4 }));
  return out.join("");
}

// Pads, ruler markers and readout positions depend on the era's wheelbase and width.
function eraFloor(id, dims) {
  const E = ERAS[id];
  const out = [];
  const pad = (x, y) => {
    const plan = { x: x - 15, y: y - 12, w: 30, d: 24, r: 2 };
    out.push(S(k.slabOf(plan, 0, PAD_H, P, 4, 0.5), { tone: "mid" }));
    out.push(Ln(k.planOutline(k.insetPlan(plan, 2.2), PAD_H, P, 4), { tone: "faint" }));
    out.push(Dots(k.corners(plan, 3.2).map(([px, py]) => at([px, py, PAD_H])), { size: 0.42 }));
  };
  const fwY = dims.half - (E.frontTyre * MM) / 2, rwY = dims.half - (E.rearTyre * MM) / 2;
  const pads = [[dims.xR, -rwY], [dims.xF, -fwY], [dims.xR, rwY], [dims.xF, fwY]]
    .sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  pads.forEach(([x, y]) => pad(x, y));
  // wheelbase markers on the length ruler, overall-width markers on the width ruler
  const ry = PLATE.y + PLATE.d - 13;
  for (const x of [dims.xR, dims.xF]) {
    out.push(S(k.slabOf({ x: x - 1.4, y: ry - 1.2, w: 2.8, d: 8.4, r: 0.6 }, 0.5, 1.6, P, 2), { tone: "hi" }));
    out.push(Ln(k.lineOnTop([x, ry - 1.2], [x, ry + 7.2], 2.1, P), { tone: "lit" }));
  }
  const wx = PLATE.x + PLATE.w - 12;
  for (const y of [-dims.half, dims.half]) {
    out.push(S(k.slabOf({ x: wx - 1.2, y: y - 1.4, w: 8, d: 2.8, r: 0.6 }, 0.5, 1.6, P, 2), { tone: "hi" }));
    out.push(Ln(k.lineOnTop([wx - 1.2, y], [wx + 6.8, y], 2.1, P), { tone: "lit" }));
  }
  return out.join("");
}

// ------------------------------------------------------------- emit
const result = { width: W, height: H, platform: platform(), eras: {} };
for (const id of Object.keys(ERAS)) {
  const t0 = Date.now();
  const car = buildEra(id);
  result.eras[id] = { label: ERAS[id].label, floor: eraFloor(id, car.dims), svg: car.svg, anim: car.anim, frames: 8 };
  console.log(`${id}: ${(car.svg.length / 1024).toFixed(0)} KB, ${Object.keys(car.anim).length} animated parts, ${Date.now() - t0} ms`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result));
console.log("wrote", OUT);
