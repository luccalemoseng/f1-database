import { useId, useLayoutEffect, useRef, useState } from 'react'

export interface Series {
  key: string
  label: string
  color: string
  dashed?: boolean
  values: (number | null)[]
}

interface Props {
  title: string
  unit: string
  x: number[]                    // distance (m) per index - shared by every series
  series: Series[]
  height?: number
  domain?: [number, number]
  step?: boolean                 // gear: draw as steps
  zeroLine?: boolean             // delta: highlight y = 0
  fmt?: (v: number) => string
  range: [number, number]        // visible index range
  hover: number | null
  onHover: (i: number | null) => void
  markers: { at: number; label: string }[]   // corner positions (index)
  sectorLines: number[]                       // index
  xFmt?: (x: number, i: number) => string     // tooltip header
  sortTip?: boolean                           // order tooltip rows by value (high first)
  markerLines?: boolean
}

const PAD = { l: 44, r: 12, t: 8, b: 18 }

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

export default function TraceChart({ title, unit, x, series, height = 150, domain, step, zeroLine, fmt = (v) => v.toFixed(0), range, hover, onHover, markers, sectorLines, xFmt = (x) => `${Math.round(x)} m`, sortTip, markerLines = true }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  const [tip, setTip] = useState<{ cx: number; cy: number } | null>(null)
  const clipId = useId()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [i0, i1] = range
  let lo = domain?.[0] ?? Infinity, hi = domain?.[1] ?? -Infinity
  if (!domain) {
    for (const s of series) for (let i = i0; i <= i1; i++) {
      const v = s.values[i]
      if (v == null) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const pad = (hi - lo) * 0.08 || 1
    lo -= pad; hi += pad
  }
  const iw = Math.max(10, w - PAD.l - PAD.r), ih = height - PAD.t - PAD.b
  const x0 = x[i0], x1 = x[i1]
  const sx = (d: number) => PAD.l + ((d - x0) / (x1 - x0 || 1)) * iw
  const sy = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * ih

  const path = (vals: (number | null)[]) => {
    let d = ''
    let prevY: number | null = null
    for (let i = i0; i <= i1; i++) {
      const v = vals[i]
      if (v == null) { prevY = null; continue }
      const X = sx(x[i]).toFixed(1), Y = sy(v).toFixed(1)
      if (prevY == null) d += `M${X} ${Y}`
      else d += step ? `H${X}V${Y}` : `L${X} ${Y}`
      prevY = v
    }
    return d
  }

  const ticks = niceTicks(lo, hi, height < 120 ? 2 : 4)

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const d = x0 + ((e.clientX - r.left - PAD.l) / iw) * (x1 - x0)
    // snap to nearest index (x is monotonic)
    let a = i0, b = i1
    while (b - a > 1) { const m = (a + b) >> 1; if (x[m] < d) a = m; else b = m }
    const i = Math.abs(x[a] - d) < Math.abs(x[b] - d) ? a : b
    onHover(i)
    setTip({ cx: e.clientX, cy: e.clientY })
  }

  return (
    <div className="trace" ref={ref}>
      <div className="trace-title"><span>{title}</span><span className="unit">{unit}</span></div>
      <svg width={w} height={height} onPointerMove={onMove} onPointerLeave={() => { onHover(null); setTip(null) }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={PAD.l - 6} y={sy(t)} fontSize={10.5} fill="var(--text-3)" textAnchor="end" dominantBaseline="central" className="num">{fmt(t)}</text>
          </g>
        ))}
        {zeroLine && lo < 0 && hi > 0 && <line x1={PAD.l} x2={PAD.l + iw} y1={sy(0)} y2={sy(0)} stroke="var(--text-3)" />}
        {sectorLines.filter((s) => s >= i0 && s <= i1).map((s) => (
          <line key={`s${s}`} x1={sx(x[s])} x2={sx(x[s])} y1={PAD.t} y2={PAD.t + ih} stroke="var(--f1-red)" strokeOpacity={0.5} />
        ))}
        {markers.filter((m) => m.at >= i0 && m.at <= i1).map((m) => (
          <g key={m.label}>
            {markerLines && <line x1={sx(x[m.at])} x2={sx(x[m.at])} y1={PAD.t} y2={PAD.t + ih} stroke="var(--hairline)" strokeDasharray="2 3" />}
            <text x={sx(x[m.at])} y={height - 4} fontSize={10} fill="var(--text-3)" textAnchor="middle">{m.label}</text>
          </g>
        ))}
        <clipPath id={clipId}><rect x={PAD.l} y={PAD.t} width={iw} height={ih} /></clipPath>
        {series.map((s) => (
          <path key={s.key} clipPath={`url(#${clipId})`} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2}
            strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover != null && hover >= i0 && hover <= i1 && (
          <g>
            <line x1={sx(x[hover])} x2={sx(x[hover])} y1={PAD.t} y2={PAD.t + ih} stroke="var(--text-2)" />
            {series.map((s) => s.values[hover] != null && (
              <circle key={s.key} cx={sx(x[hover])} cy={sy(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {tip && hover != null && (
        <div className="tip" style={{ left: Math.min(tip.cx + 14, window.innerWidth - 190), top: tip.cy + 14 }}>
          <div className="tip-h">{title} · {xFmt(x[hover], hover)}</div>
          {(sortTip ? [...series].sort((a, b) => (b.values[hover] ?? -Infinity) - (a.values[hover] ?? -Infinity)) : series).map((s) => (
            <div className="row" key={s.key}>
              <b>{s.values[hover] == null ? '—' : fmt(s.values[hover]!)}</b>
              <span><i className={`swatch-line${s.dashed ? ' dashed' : ''}`} style={{ borderColor: s.color }} />{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
