import type { Driver, Overview } from '../api'
import { fmtGap, fmtLap, fmtSec } from '../api'

interface Props {
  overview: Overview
  selected: string[]
  onToggle: (abbr: string) => void
  max: number
}

const TYRE: Record<string, { c: string; l: string }> = {
  SOFT: { c: 'var(--soft)', l: 'S' }, MEDIUM: { c: 'var(--medium)', l: 'M' }, HARD: { c: 'var(--hard)', l: 'H' },
  INTERMEDIATE: { c: 'var(--inter)', l: 'I' }, WET: { c: 'var(--wet)', l: 'W' },
}

export function Tyre({ compound }: { compound: string | null | undefined }) {
  const t = compound ? TYRE[compound] : undefined
  if (!t) return <span className="tyre unknown" title={compound ?? 'Unknown'}>?</span>
  return <span className="tyre" style={{ borderColor: t.c }} title={compound!}>{t.l}</span>
}

export default function TimingTower({ overview, selected, onToggle, max }: Props) {
  return (
    <div className="tower" role="list">
      <div className="tower-head">
        <span>Pos</span><span>Driver</span><span className="r">Best lap</span><span className="r">Gap</span><span>Sectors</span><span />
      </div>
      {overview.drivers.map((d: Driver, i) => {
        const on = selected.includes(d.abbr)
        const disabled = !on && (selected.length >= max || !d.fastestLap)
        const fl = d.fastestLap
        return (
          <button key={d.abbr} role="listitem" className={`tower-row${on ? ' on' : ''}`} disabled={disabled}
            onClick={() => onToggle(d.abbr)} aria-pressed={on}
            title={`${d.name} — ${d.team}${fl ? `, lap ${fl.lapNumber}` : ''}`}>
            <span className="pos">{overview.session.isRace && d.position ? d.position : i + 1}</span>
            <span className="drv">
              <i className="team-bar" style={{ background: d.color }} />
              <b>{d.abbr}</b>
            </span>
            <span className={`r num lap ${fl?.status === 'purple' ? 'is-purple' : ''}`}>{fmtLap(fl?.time)}</span>
            <span className="r num gap">{fl ? fmtGap(fl.gap) : '—'}</span>
            <span className="sectors">
              {(fl?.sectors ?? [null, null, null]).map((s, k) => (
                <span key={k} className={`sec t-${s?.status ?? 'none'}`} title={s ? `S${k + 1} ${fmtSec(s.time)} (${s.status === 'purple' ? 'session best' : s.status === 'green' ? 'personal best' : 'slower than personal best'})` : ''}>
                  <i className="tbar" />
                </span>
              ))}
            </span>
            <span className="tyre-cell"><Tyre compound={fl?.compound} /></span>
          </button>
        )
      })}
    </div>
  )
}
