// Small SVG chart pieces shared by the Analysis page. Same rules as the rest of
// the app: thin marks, recessive grid, text in text tokens, hover tooltips.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function useWidth<T extends HTMLElement>(initial = 600): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function ticks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

export interface Tip { x: number; y: number; title: string; rows: [string, string][] }
export function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 230), top: tip.y + 14 }}>
      <div className="tip-h">{tip.title}</div>
      {tip.rows.map(([k, v]) => <div className="row" key={k}><b>{v}</b><span>{k}</span></div>)}
    </div>
  )
}

/** Horizontal bars from a zero baseline (values may be negative). */
export function HBars({ rows, fmt = (v) => v.toFixed(1), unit = '', height = 22, labelWidth = 70 }: {
  rows: { key: string; label: string; value: number; color: string; note?: string; dim?: boolean }[]
  fmt?: (v: number) => string; unit?: string; height?: number; labelWidth?: number
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const L = labelWidth, R = 64
  const lo = Math.min(0, ...rows.map((r) => r.value)), hi = Math.max(0, ...rows.map((r) => r.value))
  const sx = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (w - L - R)
  const H = rows.length * height + 20
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={H}>
        {ticks(lo, hi, 4).map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={0} y2={H - 16} stroke="var(--grid)" />
            <text x={sx(t)} y={H - 4} fontSize={10.5} fill="var(--text-3)" textAnchor="middle" className="num">{fmt(t)}</text>
          </g>
        ))}
        <line x1={sx(0)} x2={sx(0)} y1={0} y2={H - 16} stroke="var(--text-3)" />
        {rows.map((r, i) => {
          const y = i * height + 4, x0 = sx(Math.min(0, r.value)), x1 = sx(Math.max(0, r.value))
          return (
            <g key={r.key} onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: r.label, rows: [[unit, fmt(r.value)], ...(r.note ? [['', r.note] as [string, string]] : [])] })} onPointerLeave={() => setTip(null)}>
              <rect x={0} y={y - 2} width={w} height={height} fill="transparent" />
              <text x={L - 8} y={y + height / 2 - 2} fontSize={12} fill="var(--text-2)" textAnchor="end" dominantBaseline="central" fontWeight={600}>{r.label}</text>
              <rect x={x0} y={y + 3} width={Math.max(2, x1 - x0)} height={height - 10} rx={3} fill={r.color} opacity={r.dim ? 0.45 : 1} />
              <text x={x1 + 6} y={y + height / 2 - 2} fontSize={11.5} fill="var(--text-2)" textAnchor="start" dominantBaseline="central" className="num">{fmt(r.value)}</text>
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Scatter with optional point labels and reference lines. */
export function Scatter({ points, xLabel, yLabel, height = 300, xDomain, yDomain, lines = [], children }: {
  points: { x: number; y: number; color: string; label?: string; r?: number; tip?: Tip['rows']; title?: string; opacity?: number }[]
  xLabel: string; yLabel: string; height?: number; xDomain?: [number, number]; yDomain?: [number, number]
  lines?: { x1: number; y1: number; x2: number; y2: number; color: string; dashed?: boolean; width?: number }[]
  children?: ReactNode
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const P = { l: 48, r: 16, t: 12, b: 34 }
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
  const pad = (a: number, b: number): [number, number] => { const d = (b - a) * 0.06 || 1; return [a - d, b + d] }
  const [x0, x1] = xDomain ?? pad(Math.min(...xs), Math.max(...xs))
  const [y0, y1] = yDomain ?? pad(Math.min(...ys), Math.max(...ys))
  const sx = (v: number) => P.l + ((v - x0) / (x1 - x0 || 1)) * (w - P.l - P.r)
  const sy = (v: number) => P.t + (1 - (v - y0) / (y1 - y0 || 1)) * (height - P.t - P.b)
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={height}>
        {ticks(y0, y1, 5).map((t) => (
          <g key={`y${t}`}>
            <line x1={P.l} x2={w - P.r} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={P.l - 6} y={sy(t)} fontSize={10.5} fill="var(--text-3)" textAnchor="end" dominantBaseline="central" className="num">{+t.toFixed(3)}</text>
          </g>
        ))}
        {ticks(x0, x1, 6).map((t) => (
          <text key={`x${t}`} x={sx(t)} y={height - P.b + 14} fontSize={10.5} fill="var(--text-3)" textAnchor="middle" className="num">{+t.toFixed(3)}</text>
        ))}
        <text x={w - P.r} y={height - 4} fontSize={11} fill="var(--text-3)" textAnchor="end">{xLabel}</text>
        <text x={P.l} y={P.t - 2} fontSize={11} fill="var(--text-3)">{yLabel}</text>
        {lines.map((l, i) => (
          <line key={i} x1={sx(l.x1)} y1={sy(l.y1)} x2={sx(l.x2)} y2={sy(l.y2)} stroke={l.color} strokeWidth={l.width ?? 2} strokeDasharray={l.dashed ? '5 4' : undefined} />
        ))}
        {points.map((p, i) => (
          <g key={i} onPointerMove={(e) => p.tip && setTip({ x: e.clientX, y: e.clientY, title: p.title ?? p.label ?? '', rows: p.tip })} onPointerLeave={() => setTip(null)}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={12} fill="transparent" />
            <circle cx={sx(p.x)} cy={sy(p.y)} r={p.r ?? 4} fill={p.color} opacity={p.opacity ?? 1} stroke={p.opacity && p.opacity < 1 ? 'none' : 'var(--surface)'} strokeWidth={2} />
            {p.label && <text x={sx(p.x) + 7} y={sy(p.y) - 6} fontSize={10.5} fill="var(--text-2)" fontWeight={600}>{p.label}</text>}
          </g>
        ))}
        {children}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}
