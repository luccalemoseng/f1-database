import { useEffect, useMemo, useState } from 'react'
import type { DatasetTable, ResultCell, Season, StandingRow } from '../api'
import { api } from '../api'
import TraceChart, { type Series } from '../components/TraceChart'
import { ErrorBox, Loading } from '../components/Status'
import { useHashParams } from '../router'
import CarFigure from '../components/f1car/CarFigure'

const MAX_SERIES = 8

// Sequential single-hue ramp (surface -> F1 red) for "points scored in a round".
function pointsFill(p: number): string {
  if (p <= 0) return 'var(--surface-2)'
  const t = Math.min(1, Math.sqrt(p / 25))
  const a = [0x2a, 0x1d, 0x27], b = [0xe1, 0x06, 0x00]
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * (0.25 + 0.75 * t))).join(',')})`
}

const COUNTRY_CODE: Record<string, string> = {
  Australia: 'AUS', Austria: 'AUT', Azerbaijan: 'AZE', Bahrain: 'BHR', Belgium: 'BEL', Brazil: 'BRA', Canada: 'CAN',
  China: 'CHN', France: 'FRA', Germany: 'GER', Hungary: 'HUN', Italy: 'ITA', Japan: 'JPN', Mexico: 'MEX',
  Monaco: 'MON', Netherlands: 'NED', Portugal: 'POR', Qatar: 'QAT', Russia: 'RUS', 'Saudi Arabia': 'KSA',
  Singapore: 'SGP', Spain: 'ESP', Turkey: 'TUR', 'United Kingdom': 'GBR', 'Great Britain': 'GBR',
  'United States': 'USA', USA: 'USA', 'Abu Dhabi': 'ABU', 'United Arab Emirates': 'UAE', UAE: 'UAE', 'Las Vegas': 'LVG',
}
const short = (country: string) => COUNTRY_CODE[country] ?? country.slice(0, 3).toUpperCase()

export default function SeasonPage() {
  const [params, setParams] = useHashParams()
  const [seasons, setSeasons] = useState<number[]>([])
  const [data, setData] = useState<Season | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const view = (params.v as 'drivers' | 'constructors') || 'drivers'
  const year = params.y ? +params.y : null

  useEffect(() => { api.seasons().then(setSeasons).catch((e) => setError(e.message)) }, [])
  useEffect(() => {
    if (!seasons.length) return
    if (year == null) { setParams({ y: String(seasons[0]) }); return }
    setLoading(true); setError(null)
    api.season(year).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [seasons, year, setParams])

  const rows: StandingRow[] = data?.available ? (view === 'drivers' ? data.drivers : data.constructors) : []
  const idOf = (r: StandingRow) => (view === 'drivers' ? r.driver_id! : r.team_id)
  const nameOf = (r: StandingRow) => (view === 'drivers' ? r.driver_code ?? r.driver_name! : r.team_name)

  // Selected series (default: top 5). Stored in the URL like everything else.
  const key = view === 'drivers' ? 'sd' : 'sc'
  const selected = useMemo(() => {
    if (params[key]) return params[key].split(',')
    return rows.slice(0, 5).map(idOf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, key, rows])
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-MAX_SERIES)
    setParams({ [key]: next.join(',') })
  }

  if (!data || !data.available) {
    return (
      <div className="page">
        <Header seasons={seasons} year={year} setParams={setParams} />
        {error && <ErrorBox message={error} />}
        {loading && <Loading text="Querying the season dataset…" />}
        {data && !data.available && (
          <div className="card"><div className="card-body empty">
            No data for {year} yet. Build it with <code className="mono">python -m backend.pipeline.build_dataset --seasons {year}</code>
          </div></div>
        )}
      </div>
    )
  }

  const rounds = data.events.filter((e) => e.done).map((e) => e.round)
  const evByRound = new Map(data.events.map((e) => [e.round, e]))
  const progress = view === 'drivers' ? data.driverProgress : data.constructorProgress
  const progId = (p: (typeof progress)[number]) => (view === 'drivers' ? p.driver_id! : p.team_id!)
  const rowById = new Map(rows.map((r) => [idOf(r), r]))

  // Teammates share a colour: the 2nd selected driver of a team is dashed.
  const dashed = (id: string) => {
    const c = rowById.get(id)?.team_color
    return selected.filter((s) => rowById.get(s)?.team_color === c).indexOf(id) > 0
  }
  const series: Series[] = selected.filter((id) => rowById.has(id)).map((id) => {
    const byRound = new Map(progress.filter((p) => progId(p) === id).map((p) => [p.round, p.points]))
    let lastV = 0
    return {
      key: id, label: nameOf(rowById.get(id)!), color: rowById.get(id)!.team_color, dashed: dashed(id),
      values: rounds.map((r) => { const v = byRound.get(r); if (v != null) lastV = v; return v ?? lastV }),
    }
  })

  const carTeams = data.constructors.map((c) => ({ id: c.team_id, name: c.team_name, color: c.team_color }))
  const leader = rows[0], second = rows[1]
  const champion = data.lastRound === Math.max(...data.events.map((e) => e.round))
  const mostWins = [...data.drivers].sort((a, b) => b.wins - a.wins)[0]

  return (
    <div className="page">
      <Header seasons={seasons} year={year} setParams={setParams}>
        <div className="field">
          <label>Championship</label>
          <div className="seg">
            <button className={view === 'drivers' ? 'on' : ''} onClick={() => setParams({ v: '' })}>Drivers</button>
            <button className={view === 'constructors' ? 'on' : ''} onClick={() => setParams({ v: 'constructors' })}>Constructors</button>
          </div>
        </div>
      </Header>

      <div className="stats">
        <div className="stat">
          <div className="label">{champion ? 'World champion' : 'Leader'} · {view}</div>
          <div className="value">{view === 'drivers' ? leader.driver_name : leader.team_name}</div>
          <div className="meta"><i className="tdot" style={{ background: leader.team_color }} />{leader.points} pts · {view === 'drivers' ? leader.team_name : `${leader.wins} wins`}</div>
        </div>
        <div className="stat">
          <div className="label">Margin to P2</div>
          <div className="value num">{(leader.points - (second?.points ?? 0)).toFixed(0)}<small className="muted" style={{ fontSize: 14 }}> pts</small></div>
          <div className="meta">over {second ? nameOf(second) : '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Rounds</div>
          <div className="value num">{rounds.length}<small className="muted" style={{ fontSize: 14 }}> / {data.events.length}</small></div>
          <div className="meta">{champion ? 'Season complete' : `Next: ${data.events.find((e) => !e.done)?.event_name ?? '—'}`}</div>
        </div>
        <div className="stat">
          <div className="label">Most wins</div>
          <div className="value num">{mostWins.wins}</div>
          <div className="meta"><i className="tdot" style={{ background: mostWins.team_color }} />{mostWins.driver_name}</div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Points progression · {view}</h2>
          <div className="legend">
            {series.map((s) => (
              <span key={s.key} className="legend-item"><i className={`swatch-line${s.dashed ? ' dashed' : ''}`} style={{ borderColor: s.color }} />{s.label}</span>
            ))}
          </div>
        </div>
        <div className="traces">
          <TraceChart title="Cumulative points" unit="after each round" x={rounds} series={series} height={340}
            range={[0, rounds.length - 1]} hover={hover} onHover={setHover} sortTip markerLines={false}
            markers={rounds.map((r, i) => ({ at: i, label: short(evByRound.get(r)!.country) }))} sectorLines={[]}
            xFmt={(r) => `R${r} ${evByRound.get(r)?.event_name ?? ''}`} />
        </div>
        <p className="map-hint">Pick up to {MAX_SERIES} {view} in the table below. Sprint points are included in the round they were scored.</p>
      </section>

      <div className="season-grid">
        <section className="card">
          <div className="card-head"><h2>Standings</h2><span className="hint">After round {data.lastRound}</span></div>
          <div className="table-scroll tall">
            <table className="splits standings">
              <thead>
                <tr>
                  <th>Pos</th><th>{view === 'drivers' ? 'Driver' : 'Team'}</th><th className="r">Pts</th><th className="r">Wins</th>
                  <th className="r">Podiums</th>{view === 'drivers' && <><th className="r">Poles</th><th className="r">Sprint</th><th className="r">Avg grid</th><th className="r">Avg finish</th></>}
                  <th className="r">DNF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const id = idOf(r), on = selected.includes(id)
                  return (
                    <tr key={id} className={on ? 'focus' : ''} onClick={() => toggle(id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && toggle(id)} style={{ cursor: 'pointer' }}>
                      <td><span className="pos">{r.position}</span></td>
                      <td>
                        <span className="drv"><i className="team-bar" style={{ background: r.team_color }} />
                          <b>{view === 'drivers' ? r.driver_name : r.team_name}</b>
                          {view === 'drivers' && <small>{r.team_name}</small>}
                        </span>
                      </td>
                      <td className="r num"><b>{r.points}</b></td>
                      <td className="r num">{r.wins}</td><td className="r num">{r.podiums}</td>
                      {view === 'drivers' && <>
                        <td className="r num">{r.poles}</td><td className="r num">{r.sprint_points}</td>
                        <td className="r num">{r.avg_grid ?? '—'}</td><td className="r num">{r.avg_finish ?? '—'}</td>
                      </>}
                      <td className="r num">{r.dnfs}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Teammate head-to-head</h2><span className="hint">Qualifying · race finish (both classified)</span></div>
          <div className="card-body h2h">
            {data.h2h.map((h) => {
              const da = data.drivers.find((d) => d.driver_id === h.a), db = data.drivers.find((d) => d.driver_id === h.b)
              return (
                <div key={h.team_id} className="h2h-row">
                  <div className="h2h-team"><i className="team-bar" style={{ background: h.team_color }} />{h.team_name}</div>
                  {(['quali', 'race'] as const).map((k) => {
                    const [x, y] = h[k], tot = x + y || 1
                    return (
                      <div key={k} className="h2h-bar" title={`${k}: ${da?.driver_code} ${x} – ${y} ${db?.driver_code}`}>
                        <span className="num">{x}</span>
                        <div className="h2h-track">
                          <i style={{ width: `${(100 * x) / tot}%`, background: h.team_color }} />
                          <i style={{ width: `${(100 * y) / tot}%`, background: h.team_color, opacity: 0.35 }} />
                        </div>
                        <span className="num">{y}</span>
                        <small>{k === 'quali' ? 'Q' : 'R'}</small>
                      </div>
                    )
                  })}
                  <div className="h2h-names"><b>{da?.driver_code ?? h.a}</b> <span className="muted num">{h.points[0]} – {h.points[1]} pts</span> <b>{db?.driver_code ?? h.b}</b></div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {view === 'drivers' && <ResultsGrid data={data} rounds={rounds} short={short} />}
      <CarFigure season={data.season} teams={carTeams} />
      <DatasetCard />
    </div>
  )
}

function Header({ seasons, year, setParams, children }: { seasons: number[]; year: number | null; setParams: (p: Record<string, string>) => void; children?: React.ReactNode }) {
  return (
    <>
      <div className="page-title"><h1>Season</h1><span className="sub">Championship scoring, round by round</span></div>
      <div className="filters">
        <div className="field">
          <label htmlFor="season">Season</label>
          <select id="season" className="select" value={year ?? ''} onChange={(e) => setParams({ y: e.target.value, sd: '', sc: '' })}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {children}
      </div>
    </>
  )
}

function ResultsGrid({ data, rounds, short }: { data: Season; rounds: number[]; short: (c: string) => string }) {
  const [tip, setTip] = useState<{ x: number; y: number; race?: ResultCell; sprint?: ResultCell; round: number; driver: string } | null>(null)
  const idx = useMemo(() => {
    const m = new Map<string, ResultCell>()
    for (const c of data.cells) m.set(`${c.driver_id}|${c.round}|${c.session}`, c)
    return m
  }, [data.cells])
  const ev = new Map(data.events.map((e) => [e.round, e]))
  // Every round of the calendar gets a column; rounds not run yet stay empty
  // so the grid also shows how far into the season we are.
  const done = new Set(rounds)
  const all = data.events.map((e) => e.round)
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2>Results grid</h2>
        <div className="legend">
          <span className="legend-item muted">Race finish · shade = points scored in the round</span>
          <span className="ramp">{[0, 1, 6, 12, 18, 25].map((p) => <i key={p} style={{ background: pointsFill(p) }} title={`${p} pts`} />)}</span>
          <span className="legend-item muted">0 → 25+ pts</span>
        </div>
      </div>
      <div className="grid-scroll">
        <table className="rgrid">
          <thead>
            <tr><th className="sticky">Driver</th>{all.map((r) => <th key={r} className={done.has(r) ? '' : 'future'} title={`${ev.get(r)?.event_name}${done.has(r) ? '' : ' (not run yet)'}`}>{short(ev.get(r)!.country)}<br /><small>R{r}</small></th>)}<th className="r">Pts</th></tr>
          </thead>
          <tbody>
            {data.drivers.map((d) => (
              <tr key={d.driver_id}>
                <td className="sticky"><span className="drv"><i className="team-bar" style={{ background: d.team_color }} /><b>{d.driver_code}</b></span></td>
                {all.map((r) => {
                  if (!done.has(r)) return <td key={r} className="cell future" title={`${ev.get(r)?.event_name}: not run yet`} />
                  const race = idx.get(`${d.driver_id}|${r}|race`), sprint = idx.get(`${d.driver_id}|${r}|sprint`)
                  const pts = (race?.points ?? 0) + (sprint?.points ?? 0)
                  const label = !race ? '–' : race.finished ? String(race.position) : race.classified_position === 'D' ? 'DSQ' : race.classified_position === 'W' ? 'DNS' : 'DNF'
                  const dark = pts > 8
                  return (
                    <td key={r} className={`cell${race?.position === 1 ? ' win' : ''}${!race && !sprint ? ' absent' : ''}`} style={{ background: race || sprint ? pointsFill(pts) : undefined, color: dark ? '#fff' : undefined }}
                      onPointerEnter={(e) => setTip({ x: e.clientX, y: e.clientY, race, sprint, round: r, driver: d.driver_name! })}
                      onPointerLeave={() => setTip(null)}>
                      {label}{sprint && sprint.points > 0 && <sup>•</sup>}
                    </td>
                  )
                })}
                <td className="r num"><b>{d.points}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="map-hint">• = scored sprint points that weekend. – = did not take part in that round (replaced or not yet in the team). Faded columns are rounds still to come. Hover a cell for grid → finish and status.</p>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 220), top: tip.y + 14 }}>
          <div className="tip-h">R{tip.round} · {ev.get(tip.round)?.event_name}</div>
          <div className="row"><b>{tip.driver}</b></div>
          {!tip.race && !tip.sprint && <div className="row"><span>Did not take part in this round</span></div>}
          {tip.race && <div className="row"><span>Race</span><b>P{tip.race.grid || 'L'} → {tip.race.finished ? `P${tip.race.position}` : tip.race.status} · {tip.race.points} pts</b></div>}
          {tip.sprint && <div className="row"><span>Sprint</span><b>P{tip.sprint.position} · {tip.sprint.points} pts</b></div>}
        </div>
      )}
    </section>
  )
}

function DatasetCard() {
  const [tables, setTables] = useState<DatasetTable[] | null>(null)
  useEffect(() => { api.dataset().then((d) => setTables(d.tables)).catch(() => setTables([])) }, [])
  if (!tables) return null
  const span = (t: DatasetTable) => (t.seasons.length ? `${t.seasons[0]}–${t.seasons[t.seasons.length - 1]}` : '—')
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2>Dataset · Parquet + DuckDB</h2>
        <a className="hint" href="#/docs?doc=03-phase2-dataset">Data dictionary →</a>
      </div>
      <div className="dataset">
        {tables.map((t) => (
          <div key={t.name} className="ds-table" title={t.columns.map((c) => `${c.name}: ${c.type}`).join(', ')}>
            <code className="mono">{t.name}</code>
            <b className="num">{t.rows.toLocaleString()}</b>
            <small className="muted">rows · {t.columns.length} cols · {span(t)}</small>
          </div>
        ))}
      </div>
    </section>
  )
}
