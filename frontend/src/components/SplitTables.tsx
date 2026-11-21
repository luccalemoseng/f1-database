import type { Compare, Overview, Status } from '../api'
import { fmtDelta, fmtSec } from '../api'

const STATUS_TEXT: Record<string, string> = {
  purple: 'Session best', green: 'Personal best', yellow: 'Slower than personal best',
}
const CORNER_STATUS_TEXT: Record<string, string> = {
  purple: 'Session best through this corner (all drivers)',
  green: 'Best of the drivers you are comparing',
  yellow: 'Slower than the best compared driver',
}

function Cell({ status, main, sub, title }: { status: Status; main: string; sub?: string; title: string }) {
  return (
    <td className={`split t-${status ?? 'none'}`} title={title}>
      <i className="tbar" />
      <span className="num main">{main}</span>
      {sub && <span className="num sub">{sub}</span>}
    </td>
  )
}

function DriverTh({ abbr, color, dashed }: { abbr: string; color: string; dashed: boolean }) {
  return (
    <th className="drv-th">
      <i className={`swatch-line${dashed ? ' dashed' : ''}`} style={{ borderColor: color }} /> {abbr}
    </th>
  )
}

export function SectorTable({ overview, compare, dashedOf }: { overview: Overview; compare: Compare; dashedOf: (a: string) => boolean }) {
  const best = [overview.best.s1, overview.best.s2, overview.best.s3]
  return (
    <table className="splits">
      <thead>
        <tr>
          <th>Sector</th><th className="r">Session best</th>
          {compare.drivers.map((d) => <DriverTh key={d.abbr} abbr={d.abbr} color={d.color} dashed={dashedOf(d.abbr)} />)}
        </tr>
      </thead>
      <tbody>
        {[0, 1, 2].map((k) => (
          <tr key={k}>
            <td className="lbl">S{k + 1}</td>
            <td className="r num muted">{fmtSec(best[k])}</td>
            {compare.drivers.map((d) => {
              const s = d.fastestLap?.sectors[k]
              return <Cell key={d.abbr} status={s?.status ?? null} main={fmtSec(s?.time)}
                sub={s?.time != null ? fmtDelta(s.time - best[k]) : undefined}
                title={`${d.abbr} S${k + 1}: ${STATUS_TEXT[s?.status ?? ''] ?? ''}`} />
            })}
          </tr>
        ))}
        <tr className="total">
          <td className="lbl">Lap</td>
          <td className="r num muted">{fmtSec(overview.best.lap)}</td>
          {compare.drivers.map((d) => (
            <Cell key={d.abbr} status={d.fastestLap?.status ?? null} main={fmtSec(d.fastestLap?.time)}
              sub={d.fastestLap ? fmtDelta(d.fastestLap.gap) : undefined} title={`${d.abbr} lap ${d.fastestLap?.lapNumber}`} />
          ))}
        </tr>
      </tbody>
    </table>
  )
}

export function CornerTable({ compare, focus, onFocus, dashedOf }: {
  compare: Compare; focus: number | null; onFocus: (i: number | null) => void; dashedOf: (a: string) => boolean
}) {
  return (
    <div className="table-scroll">
      <table className="splits corners">
        <thead>
          <tr>
            <th>Turn</th><th className="r">Best</th>
            {compare.drivers.map((d) => <DriverTh key={d.abbr} abbr={d.abbr} color={d.color} dashed={dashedOf(d.abbr)} />)}
          </tr>
        </thead>
        <tbody>
          {compare.corners.map((c, i) => (
            <tr key={i} className={focus === i ? 'focus' : ''} onClick={() => onFocus(focus === i ? null : i)} tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onFocus(focus === i ? null : i)}>
              <td className="lbl">T{c.number}{c.letter}</td>
              <td className="r">
                <span className="num">{fmtSec(c.sessionBest.time)}</span>
                <small className="muted"> {c.sessionBest.driver}</small>
              </td>
              {compare.drivers.map((d) => {
                const r = d.corners[i]
                return <Cell key={d.abbr} status={r.status} main={fmtDelta(r.delta)} sub={`${r.minSpeed} km/h`}
                  title={`${d.abbr} T${c.number}: ${fmtSec(r.time)} s, min ${r.minSpeed} km/h — ${CORNER_STATUS_TEXT[r.status ?? '']}`} />
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
