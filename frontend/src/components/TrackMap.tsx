import { useEffect, useMemo, useRef, useState } from 'react'
import type { Compare, Overview } from '../api'

export type MapMode = 'lines' | 'dominance' | 'session'
export type Cursor = { kind: 'idx'; i: number } | { kind: 'time'; t: number } | null

interface Props {
  overview: Overview
  compare: Compare | null
  mode: MapMode
  cursor: Cursor
  focusCorner: number | null            // index into corners, zooms the map
  onCornerClick: (i: number | null) => void
  colorOf: (abbr: string) => string
  dashedOf: (abbr: string) => boolean
}

type VB = { x: number; y: number; w: number; h: number }

// Physical track width (metres) - lines are drawn inside it when zoomed in.
const TRACK_WIDTH_M = 14

/** Cumulative distance along a polyline, normalised to 0..1. */
function cumFrac(xs: number[], ys: number[]): number[] {
  const out = [0]
  for (let i = 1; i < xs.length; i++) out.push(out[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]))
  const total = out[out.length - 1] || 1
  return out.map((d) => d / total)
}

function pathOf(xs: number[], ys: number[], from = 0, to = xs.length - 1): string {
  let d = ''
  for (let i = from; i <= to; i++) {
    if (xs[i] == null || ys[i] == null) continue
    d += `${d ? 'L' : 'M'}${xs[i].toFixed(1)} ${(-ys[i]).toFixed(1)}`
  }
  return d
}

/** Position of a driver at time t (s) into their lap: binary search + lerp. */
function posAtTime(tel: { t: number[]; x: number[]; y: number[] }, t: number): [number, number] {
  const ts = tel.t
  if (t <= ts[0]) return [tel.x[0], tel.y[0]]
  const n = ts.length - 1
  if (t >= ts[n]) return [tel.x[n], tel.y[n]]
  let lo = 0, hi = n
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m }
  const u = (t - ts[lo]) / (ts[hi] - ts[lo] || 1)
  return [tel.x[lo] + u * (tel.x[hi] - tel.x[lo]), tel.y[lo] + u * (tel.y[hi] - tel.y[lo])]
}

export default function TrackMap({ overview, compare, mode, cursor, focusCorner, onCornerClick, colorOf, dashedOf }: Props) {
  const { track } = overview
  const svgRef = useRef<SVGSVGElement>(null)
  const [px, setPx] = useState(800)                 // rendered width in pixels

  const full = useMemo<VB>(() => {
    const xs = track.x, ys = track.y.map((v) => -v)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = Math.max(maxX - minX, maxY - minY) * 0.08
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
  }, [track])
  const [vb, setVb] = useState<VB>(full)

  // Zoom to the focused corner, or back to the full circuit.
  useEffect(() => {
    if (focusCorner == null) { setVb(full); return }
    const c = track.corners[focusCorner]
    const size = 260
    const aspect = full.h / full.w
    setVb({ x: c.x - size / 2, y: -c.y - (size * aspect) / 2, w: size, h: size * aspect })
  }, [focusCorner, full, track.corners])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setPx(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Wheel zoom (around the pointer) and drag to pan.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setVb((v) => {
        const k = e.deltaY > 0 ? 1.15 : 1 / 1.15
        const w = Math.min(full.w * 1.5, Math.max(60, v.w * k))
        const h = (w * v.h) / v.w
        const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height
        return { x: v.x + (v.w - w) * fx, y: v.y + (v.h - h) * fy, w, h }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [full])

  const drag = useRef<{ x: number; y: number; vb: VB } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vb }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !svgRef.current) return
    const r = svgRef.current.getBoundingClientRect()
    const s = drag.current.vb.w / r.width
    setVb({ ...drag.current.vb, x: drag.current.vb.x - (e.clientX - drag.current.x) * s, y: drag.current.vb.y - (e.clientY - drag.current.y) * s })
  }
  const onUp = () => { drag.current = null }

  const unitPerPx = vb.w / px
  const trackStroke = Math.max(TRACK_WIDTH_M, 9 * unitPerPx)
  const zoomed = vb.w < full.w * 0.6

  const outlineFrac = useMemo(() => cumFrac(track.x, track.y), [track])
  const idxAtFrac = (f: number) => {
    let i = outlineFrac.findIndex((v) => v >= f)
    if (i < 0) i = outlineFrac.length - 1
    return i
  }

  // Corner-segment ownership for dominance / session-best modes.
  const segments = useMemo(() => {
    if (!compare || mode === 'lines') return []
    return compare.corners.map((c, i) => {
      let owner: string
      if (mode === 'session') owner = c.sessionBest.driver
      else {
        let best = Infinity
        owner = compare.drivers[0].abbr
        for (const d of compare.drivers) if (d.corners[i].time < best) { best = d.corners[i].time; owner = d.abbr }
      }
      return { owner, d: pathOf(track.x, track.y, Math.max(0, idxAtFrac(c.segStart) - 1), idxAtFrac(c.segEnd)) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare, mode, track, outlineFrac])

  const sectorTicks = track.sectorFrac.filter((f): f is number => f != null).map((f) => {
    const i = idxAtFrac(f)
    return { x: track.x[i], y: track.y[i] }
  })
  const startI = 0

  const dots = compare && cursor
    ? compare.drivers.map((d) => {
        const [x, y] = cursor.kind === 'idx' ? [d.tel.x[cursor.i], d.tel.y[cursor.i]] : posAtTime(d.tel, cursor.t)
        return { abbr: d.abbr, x, y }
      })
    : []

  const r = 5 * unitPerPx
  const font = 11 * unitPerPx

  return (
    <div className="trackmap">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        role="img" aria-label={`Track map of ${overview.event.location}`}
      >
        {/* Track tarmac */}
        <path d={pathOf(track.x, track.y)} fill="none" stroke="#2a2a35" strokeWidth={trackStroke + 4 * unitPerPx} strokeLinejoin="round" strokeLinecap="round" />
        <path d={pathOf(track.x, track.y)} fill="none" stroke="#3a3a47" strokeWidth={trackStroke} strokeLinejoin="round" strokeLinecap="round" />

        {/* Corner segment ownership */}
        {segments.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={colorOf(s.owner)} strokeWidth={Math.max(trackStroke * 0.55, 5 * unitPerPx)} strokeLinecap="butt" opacity={0.95} />
        ))}

        {/* Session fastest lap line */}
        {mode === 'session' && (
          <path d={pathOf(track.x, track.y)} fill="none" stroke="var(--t-purple)" strokeWidth={1.5 * unitPerPx} strokeDasharray={`${4 * unitPerPx} ${4 * unitPerPx}`} />
        )}

        {/* Each driver's racing line */}
        {compare && mode === 'lines' && compare.drivers.map((d) => (
          <path key={d.abbr} d={pathOf(d.tel.x, d.tel.y)} fill="none" stroke={colorOf(d.abbr)}
            strokeWidth={(zoomed ? 2 : 1.6) * unitPerPx} strokeLinejoin="round"
            strokeDasharray={dashedOf(d.abbr) ? `${6 * unitPerPx} ${4 * unitPerPx}` : undefined} opacity={0.95} />
        ))}

        {/* Start/finish + sector lines */}
        <circle cx={track.x[startI]} cy={-track.y[startI]} r={r * 1.1} fill="#fff" />
        {sectorTicks.map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={-s.y} r={r * 0.9} fill="var(--f1-red)" stroke="#fff" strokeWidth={1.2 * unitPerPx} />
            <text x={s.x + r * 1.8} y={-s.y - r * 1.2} fontSize={font} fill="var(--text-2)" fontWeight={700}>S{i + 2}</text>
          </g>
        ))}

        {/* Corner numbers */}
        {track.corners.map((c, i) => {
          const on = focusCorner === i
          return (
            <g key={i} className="corner-label" onClick={(e) => { e.stopPropagation(); onCornerClick(on ? null : i) }} style={{ cursor: 'pointer' }}>
              <circle cx={c.x} cy={-c.y} r={font * 1.05} fill={on ? 'var(--f1-red)' : '#0f0f15cc'} stroke={on ? '#fff' : '#55556a'} strokeWidth={unitPerPx} />
              <text x={c.x} y={-c.y} fontSize={font * 0.95} fill="#fff" textAnchor="middle" dominantBaseline="central" fontWeight={700}>
                {c.number}{c.letter}
              </text>
            </g>
          )
        })}

        {/* Cursor dots (hover in charts or replay) */}
        {dots.map((d) => d.x != null && (
          <g key={d.abbr}>
            <circle cx={d.x} cy={-d.y} r={r * 1.3} fill={colorOf(d.abbr)} stroke="var(--surface)" strokeWidth={2 * unitPerPx} />
            <text x={d.x + r * 2} y={-d.y + font * 0.35} fontSize={font} fill="#fff" fontWeight={700} stroke="var(--surface)" strokeWidth={3 * unitPerPx} paintOrder="stroke">{d.abbr}</text>
          </g>
        ))}
      </svg>
      <div className="map-tools">
        <button className="btn icon" onClick={() => setVb((v) => ({ x: v.x + v.w * 0.15, y: v.y + v.h * 0.15, w: v.w * 0.7, h: v.h * 0.7 }))} aria-label="Zoom in">＋</button>
        <button className="btn icon" onClick={() => setVb((v) => ({ x: v.x - v.w * 0.2, y: v.y - v.h * 0.2, w: v.w * 1.4, h: v.h * 1.4 }))} aria-label="Zoom out">−</button>
        <button className="btn icon" onClick={() => { setVb(full); onCornerClick(null) }}>Reset</button>
      </div>
    </div>
  )
}
