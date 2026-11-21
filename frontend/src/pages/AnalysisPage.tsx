import { useEffect, useMemo, useState } from 'react'
import type { EventInfo, RaceAnalysis, RaceDriver, SeasonAnalysis, TrackChar } from '../api'
import { api, fmtLap, SESSION_SHORT } from '../api'
import { HBars, Scatter, Tooltip, useWidth, type Tip } from '../components/charts'
import TraceChart, { type Series } from '../components/TraceChart'
import { ErrorBox, Loading } from '../components/Status'
import { useHashParams } from '../router'

// Pirelli compound colours (identity in F1, used as such everywhere).
const COMPOUND: Record<string, string> = {
  SOFT: '#e10600', MEDIUM: '#ffd12e', HARD: '#f0f0f0', INTERMEDIATE: '#39b54a', WET: '#2f7fd6',
  HYPERSOFT: '#ffb3c3', ULTRASOFT: '#a64dff', SUPERSOFT: '#e10600', UNKNOWN: '#6a6a76', TEST_UNKNOWN: '#6a6a76',
}
const compColor = (c: string) => COMPOUND[c] ?? '#6a6a76'

// Sequential single-hue ramp for speed (dark slate -> bright cyan).
const RAMP_A = [0x24, 0x3a, 0x4d], RAMP_B = [0x9b, 0xec, 0xff]
const ramp = (t: number) => `rgb(${RAMP_A.map((a, i) => Math.round(a + (RAMP_B[i] - a) * Math.max(0, Math.min(1, t)))).join(',')})`
const KIND_T = { slow: 0.12, medium: 0.55, fast: 1 }
const RACE_SESSIONS = ['Race', 'Sprint', 'Qualifying', 'Sprint Qualifying', 'Sprint Shootout']

export default function AnalysisPage() {
  const [params, setParams] = useHashParams()
  const tab = params.tab === 'season' ? 'season' : 'race'
  const [seasons, setSeasons] = useState<number[]>([])
  useEffect(() => { api.seasons().then(setSeasons) }, [])
  const year = params.y ? +params.y : seasons[0]

  return (
    <div className="page">
      <div className="page-title"><h1>Analysis</h1><span className="sub">What decided a race, and how a season was won</span></div>
      <div className="filters">
        <div className="field">
          <label>Level</label>
          <div className="seg">
            <button className={tab === 'race' ? 'on' : ''} onClick={() => setParams({ tab: '' })}>Race</button>
            <button className={tab === 'season' ? 'on' : ''} onClick={() => setParams({ tab: 'season' })}>Season</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="a-season">Season</label>
          <select id="a-season" className="select" value={year ?? ''} onChange={(e) => setParams({ y: e.target.value, r: '', s: '' })}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {tab === 'race' && year && <RacePicker year={year} />}
      </div>
      {year && (tab === 'race' ? <RaceTab year={year} /> : <SeasonTab year={year} />)}
    </div>
  )
}

function RacePicker({ year }: { year: number }) {
  const [params, setParams] = useHashParams()
  const [events, setEvents] = useState<EventInfo[]>([])
  useEffect(() => { api.events(year).then(setEvents) }, [year])
  const done = events.filter((e) => e.sessions.some((s) => s.name === 'Race' && s.available))
  const round = params.r ? +params.r : done.at(-1)?.round
  const ev = events.find((e) => e.round === round)
  const sessions = ev?.sessions.filter((s) => RACE_SESSIONS.includes(s.name)) ?? []
  useEffect(() => {
    if (!params.r && done.length) setParams({ r: String(done.at(-1)!.round) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events])
  return (
    <>
      <div className="field">
        <label htmlFor="a-gp">Grand Prix</label>
        <select id="a-gp" className="select" value={round ?? ''} onChange={(e) => setParams({ r: e.target.value, s: '' })}>
          {done.map((e) => <option key={e.round} value={e.round}>R{String(e.round).padStart(2, '0')} · {e.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Session</label>
        <div className="seg">
          {sessions.map((s) => (
            <button key={s.name} disabled={!s.available} className={(params.s || 'Race') === s.name ? 'on' : ''} onClick={() => setParams({ s: s.name === 'Race' ? '' : s.name })}>
              {SESSION_SHORT[s.name] ?? s.name}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

// =========================================================================== //
// Race tab
// =========================================================================== //
function RaceTab({ year }: { year: number }) {
  const [params] = useHashParams()
  const round = params.r ? +params.r : null
  const session = params.s || 'Race'
  const [data, setData] = useState<RaceAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!round) return
    setLoading(true); setError(null)
    api.raceAnalysis(year, round, session).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [year, round, session])

  if (error) return <ErrorBox message={error} />
  if (!data) return loading ? <Loading text="Loading laps, tyres and telemetry with FastF1…" /> : null
  const isRace = data.session.isRace
  const pits = data.drivers.reduce((n, d) => n + d.pits.length, 0)
  const neutral = data.neutralised.length

  return (
    <div className={loading ? 'refetching' : ''}>
      <div className="event-banner">
        <div>
          <div className="eyebrow">{data.event.year} · Round {data.event.round} · {data.session.name}</div>
          <h2>{data.event.name}</h2>
          <div className="muted">{data.event.location} · {data.totalLaps} laps · {(data.track.length / 1000).toFixed(3)} km</div>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="label">Full throttle</div><div className="value num">{data.track.fullThrottle}%</div><div className="meta">of the lap distance</div></div>
        <div className="stat"><div className="label">Braking</div><div className="value num">{data.track.braking}%</div><div className="meta">{data.track.zones.length} braking zones</div></div>
        <div className="stat"><div className="label">Top / average speed</div><div className="value num">{data.track.topSpeed}<small className="muted" style={{ fontSize: 14 }}> / {data.track.avgSpeed} km/h</small></div><div className="meta">fastest lap · {data.track.driver} {fmtLap(data.track.lapTime)}</div></div>
        {isRace
          ? <div className="stat"><div className="label">Pit stops</div><div className="value num">{pits}</div><div className="meta">{neutral ? `${neutral} laps under SC / VSC / red` : 'no neutralisation'}</div></div>
          : <div className="stat"><div className="label">Corners</div><div className="value num">{data.track.corners.length}</div><div className="meta">{data.track.counts.slow} slow · {data.track.counts.medium} medium · {data.track.counts.fast} fast</div></div>}
      </div>

      {isRace && <StrategyCard data={data} />}
      {isRace && <PaceCard data={data} />}
      {isRace && <DegradationCard data={data} />}
      <TrackCard track={data.track} />
      <CornerPerfCard data={data} />
    </div>
  )
}

function CompoundLegend({ list }: { list: string[] }) {
  return (
    <div className="legend">
      {list.map((c) => <span key={c} className="legend-item"><i className="comp-dot" style={{ background: compColor(c) }} />{c[0] + c.slice(1).toLowerCase()}</span>)}
      <span className="legend-item muted"><i className="comp-dot used" /> used set</span>
    </div>
  )
}

function StrategyCard({ data }: { data: RaceAnalysis }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const L = 56, R = 12, row = 22
  const sx = (lap: number) => L + ((lap - 0.5) / data.totalLaps) * (w - L - R)
  const H = data.drivers.length * row + 26
  const used = [...new Set(data.drivers.flatMap((d) => d.stints.map((s) => s.compound)))]
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h2>Tyre strategy</h2><CompoundLegend list={used} /></div>
      <div ref={ref} className="chart" style={{ padding: '8px 0' }}>
        <svg width={w} height={H}>
          {data.neutralised.map((n) => (
            <rect key={n.lap} x={sx(n.lap - 0.5)} width={sx(n.lap + 0.5) - sx(n.lap - 0.5)} y={0} height={H - 22} fill={n.kind === 'RED' ? '#e1060033' : '#ffd12e1c'} />
          ))}
          {Array.from({ length: Math.floor(data.totalLaps / 10) }, (_, i) => (i + 1) * 10).map((l) => (
            <g key={l}><line x1={sx(l + 0.5)} x2={sx(l + 0.5)} y1={0} y2={H - 22} stroke="var(--grid)" /><text x={sx(l + 0.5)} y={H - 8} fontSize={10.5} fill="var(--text-3)" textAnchor="middle" className="num">{l}</text></g>
          ))}
          {data.drivers.map((d, i) => (
            <g key={d.abbr}>
              <text x={L - 10} y={i * row + row / 2 + 2} fontSize={12} fill="var(--text-2)" textAnchor="end" dominantBaseline="central" fontWeight={600}>{d.abbr}</text>
              <rect x={L - 6} y={i * row + 5} width={3} height={row - 8} rx={1.5} fill={d.color} />
              {d.stints.map((s) => (
                <rect key={s.stint} x={sx(s.from - 0.5) + 1} y={i * row + 5} width={Math.max(2, sx(s.to + 0.5) - sx(s.from - 0.5) - 2)} height={row - 8} rx={4}
                  fill={compColor(s.compound)} opacity={s.fresh === false ? 0.5 : 0.92}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: `${d.abbr} · stint ${s.stint}`, rows: [['compound', s.compound], ['laps', `${s.from}–${s.to} (${s.to - s.from + 1})`], ['tyre age at start', `${s.startLife ?? '—'} laps${s.fresh === false ? ' (used)' : ''}`]] })}
                  onPointerLeave={() => setTip(null)} />
              ))}
            </g>
          ))}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <p className="map-hint">Drivers in finishing order. Each bar is a stint; faded bars started on a used set. Yellow bands = laps under Safety Car or VSC, red = red flag.</p>
    </section>
  )
}

function PaceCard({ data }: { data: RaceAnalysis }) {
  const [sel, setSel] = useState<string[]>(() => data.drivers.slice(0, 4).map((d) => d.abbr))
  const [fuel, setFuel] = useState(true)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => { setSel(data.drivers.slice(0, 4).map((d) => d.abbr)) }, [data])
  const laps = Array.from({ length: data.totalLaps }, (_, i) => i + 1)
  const colors = new Map<string, number>()
  const series: Series[] = data.drivers.filter((d) => sel.includes(d.abbr)).map((d: RaceDriver) => {
    const byLap = new Map(d.laps.n.map((n, i) => [n, d.laps.clean[i] ? (fuel ? d.laps.fc[i] : d.laps.t[i]) : null]))
    const k = colors.get(d.color) ?? 0
    colors.set(d.color, k + 1)
    return { key: d.abbr, label: d.abbr, color: d.color, dashed: k > 0, values: laps.map((l) => byLap.get(l) ?? null) }
  })
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null)).sort((a, b) => a - b)
  const lo = all[0] ?? 0, hi = all[Math.floor(all.length * 0.97)] ?? 1
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2>Race pace</h2>
        <div className="seg"><button className={fuel ? 'on' : ''} onClick={() => setFuel(true)}>Fuel corrected</button><button className={!fuel ? 'on' : ''} onClick={() => setFuel(false)}>Raw</button></div>
      </div>
      <div className="chips">
        {data.drivers.map((d) => (
          <button key={d.abbr} className={`chip${sel.includes(d.abbr) ? ' on' : ''}`} onClick={() => setSel((s) => s.includes(d.abbr) ? s.filter((x) => x !== d.abbr) : [...s, d.abbr].slice(-6))}>
            <i style={{ background: d.color }} />{d.abbr}
          </button>
        ))}
      </div>
      <div className="traces">
        <TraceChart title="Lap time" unit={fuel ? `s · minus ${data.fuelCorrection.toFixed(3)} s per lap of fuel still on board` : 's'} x={laps} series={series} height={300}
          domain={[lo - 0.3, hi + 0.3]} fmt={(v) => v.toFixed(1)} range={[0, laps.length - 1]} hover={hover} onHover={setHover}
          markers={laps.filter((l) => l % 5 === 0).map((l) => ({ at: l - 1, label: String(l) }))} markerLines={false} sectorLines={[]}
          xFmt={(l) => `Lap ${l}`} sortTip />
      </div>
      <p className="map-hint">Only clean laps: green flag, no pit in/out lap, timing marked accurate. Gaps are pit stops, Safety Cars or traffic-free data FastF1 flagged as inaccurate.</p>
    </section>
  )
}

function DegradationCard({ data }: { data: RaceAnalysis }) {
  const comps = data.degradation.compounds.filter((c) => c.stints > 0)
  if (!comps.length) return null
  const points = comps.flatMap((c) => c.points.map(([x, y]) => ({ x, y, color: compColor(c.compound), r: 2.2, opacity: 0.35 })))
  const maxAge = Math.max(...comps.flatMap((c) => c.points.map((p) => p[0])))
  const lines = comps.map((c) => ({ x1: 0, y1: 0, x2: maxAge, y2: c.median * maxAge, color: compColor(c.compound), width: 2.5 }))
  const ys = points.map((p) => p.y).sort((a, b) => a - b)
  const yDomain: [number, number] = [ys[Math.floor(ys.length * 0.02)] ?? -1, ys[Math.floor(ys.length * 0.98)] ?? 1]
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h2>Tyre degradation</h2><CompoundLegend list={comps.map((c) => c.compound)} /></div>
      <div className="split-2">
        <div className="traces">
          <Scatter points={points} lines={lines} xLabel="tyre age (laps)" yLabel="lap time vs. start of stint (s, fuel corrected)" height={300} yDomain={yDomain} />
        </div>
        <div className="deg-table">
          {comps.map((c) => (
            <div key={c.compound} className="deg-row">
              <i className="comp-dot big" style={{ background: compColor(c.compound) }} />
              <div><b>{c.compound[0] + c.compound.slice(1).toLowerCase()}</b><small className="muted">{c.stints} stints</small></div>
              <div className="r"><b className="num">{c.median >= 0 ? '+' : ''}{c.median.toFixed(3)}</b><small className="muted">s / lap · IQR {c.p25.toFixed(3)} – {c.p75.toFixed(3)}</small></div>
            </div>
          ))}
          <p className="muted small">Median slope of lap time against tyre age over every stint with 5+ clean laps. Lines show that median rate.</p>
        </div>
      </div>
    </section>
  )
}

function SpeedMap({ track }: { track: TrackChar }) {
  const { x, y, speed, brake } = track.map
  const vb = useMemo(() => {
    const ys = y.map((v) => -v)
    const minX = Math.min(...x), maxX = Math.max(...x), minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = Math.max(maxX - minX, maxY - minY) * 0.08
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
  }, [x, y])
  const vmin = Math.min(...speed), vmax = Math.max(...speed)
  const k = vb.w / 600
  const segs = []
  for (let i = 1; i < x.length; i++) {
    segs.push(<line key={i} x1={x[i - 1]} y1={-y[i - 1]} x2={x[i]} y2={-y[i]} stroke={ramp((speed[i] - vmin) / (vmax - vmin))} strokeWidth={7 * k} strokeLinecap="round" />)
  }
  const brakes = []
  for (let i = 1; i < x.length; i++) if (brake[i]) brakes.push(<line key={`b${i}`} x1={x[i - 1]} y1={-y[i - 1]} x2={x[i]} y2={-y[i]} stroke="var(--f1-red)" strokeWidth={2.4 * k} strokeLinecap="round" />)
  // corner labels: place them at the telemetry point closest to the corner's distance
  const labels = track.corners.map((c) => {
    let j = 0
    for (let i = 0; i < track.map.d.length; i++) if (Math.abs(track.map.d[i] - c.distance) < Math.abs(track.map.d[j] - c.distance)) j = i
    return { c, px: x[j], py: -y[j] }
  })
  return (
    <svg className="speedmap" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label="Circuit coloured by speed, braking zones in red">
      <path d={x.map((v, i) => `${i ? 'L' : 'M'}${v} ${-y[i]}`).join('')} fill="none" stroke="#0b0b10" strokeWidth={11 * k} strokeLinejoin="round" />
      {segs}{brakes}
      {labels.map(({ c, px, py }) => (
        <g key={`${c.number}${c.letter}`}>
          <circle cx={px} cy={py} r={9 * k} fill="#0f0f15" stroke={ramp(KIND_T[c.kind])} strokeWidth={2 * k} />
          <text x={px} y={py} fontSize={9 * k} fill="#fff" textAnchor="middle" dominantBaseline="central" fontWeight={700}>{c.number}{c.letter}</text>
        </g>
      ))}
    </svg>
  )
}

function TrackCard({ track }: { track: TrackChar }) {
  const [hover, setHover] = useState<number | null>(null)
  const idx = track.trace.d.map((_, i) => i)
  const markers = track.corners.map((c) => {
    let j = 0
    for (let i = 0; i < track.trace.d.length; i++) if (Math.abs(track.trace.d[i] - c.distance) < Math.abs(track.trace.d[j] - c.distance)) j = i
    return { at: j, label: `${c.number}${c.letter}` }
  })
  const pts = track.corners.filter((c) => c.brakeLength > 0 && c.entrySpeed != null).map((c) => ({
    x: c.entrySpeed!, y: c.brakeLength, color: ramp(KIND_T[c.kind]), r: 5, label: `T${c.number}${c.letter}`,
    title: `Turn ${c.number}${c.letter} · ${c.kind}`, tip: [['entry speed', `${c.entrySpeed} km/h`], ['braking distance', `${c.brakeLength} m`], ['minimum speed', `${c.minSpeed} km/h`]] as [string, string][],
  }))
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2>The track · speed and braking</h2>
        <div className="legend">
          <span className="legend-item"><span className="ramp-bar" style={{ background: `linear-gradient(90deg, ${ramp(0)}, ${ramp(1)})` }} /> speed {Math.min(...track.map.speed)}–{track.topSpeed} km/h</span>
          <span className="legend-item"><i className="swatch-line" style={{ borderColor: 'var(--f1-red)' }} /> braking</span>
          {(['slow', 'medium', 'fast'] as const).map((k) => <span key={k} className="legend-item"><i className="comp-dot" style={{ background: ramp(KIND_T[k]) }} />{k} ({track.counts[k]})</span>)}
        </div>
      </div>
      <div className="split-2">
        <SpeedMap track={track} />
        <div className="traces">
          <div className="sub-h">Braking zones · entry speed vs. braking distance</div>
          <Scatter points={pts} xLabel="entry speed (km/h)" yLabel="braking distance (m)" height={300} />
        </div>
      </div>
      <div className="traces">
        <TraceChart title={`Speed · ${track.driver} fastest lap`} unit="km/h" x={track.trace.d} series={[{ key: 'v', label: track.driver, color: ramp(1), values: track.trace.speed }]} height={170}
          range={[0, idx.length - 1]} hover={hover} onHover={setHover} markers={markers} sectorLines={[]} />
        <TraceChart title="Brake" unit="on / off" x={track.trace.d} series={[{ key: 'b', label: 'brake', color: 'var(--f1-red)', values: track.trace.brake }]} height={70} domain={[-0.05, 1.1]}
          fmt={(v) => (v >= 0.5 ? 'On' : 'Off')} range={[0, idx.length - 1]} hover={hover} onHover={setHover} markers={markers} sectorLines={[]} />
      </div>
      <p className="map-hint">Corners are classed by their minimum speed: slow &lt; 125 km/h, medium 125–200, fast &gt; 200. The faster a car arrives, the longer it brakes. Corners taken flat out have no braking zone.</p>
    </section>
  )
}

function CornerPerfCard({ data }: { data: RaceAnalysis }) {
  const rows = data.cornerPerformance
  if (!rows.length) return null
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h2>Where each car is quick · corner types</h2><span className="hint">Time lost to the best car, summed over each corner class</span></div>
      <div className="split-3">
        {(['slow', 'medium', 'fast'] as const).map((k) => {
          const list = rows.filter((r) => r[k] != null).sort((a, b) => a[k]! - b[k]!)
          return (
            <div key={k} className="traces">
              <div className="sub-h">{k} corners · {data.track.counts[k]}</div>
              {list.length ? <HBars rows={list.map((r) => ({ key: r.team, label: r.team.split(' ')[0], value: r[k]!, color: r.color, note: r.drivers.join(' / ') }))} fmt={(v) => `+${v.toFixed(3)}`} unit="s lost" />
                : <div className="empty">No {k} corners</div>}
            </div>
          )
        })}
      </div>
      <p className="map-hint">From each driver's fastest lap, split corner by corner (as on the Compare page). A team counts its quicker car. Most telling in <b>Qualifying</b>, where everyone runs low fuel on fresh tyres. Pick it in the session selector.</p>
    </section>
  )
}

// =========================================================================== //
// Season tab
// =========================================================================== //
function SeasonTab({ year }: { year: number }) {
  const [data, setData] = useState<SeasonAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => { setData(null); api.seasonAnalysis(year).then(setData).catch((e) => setError(e.message)) }, [year])
  if (error) return <ErrorBox message={error} />
  if (!data) return <Loading text="Querying the season dataset…" />
  if (!data.available) return <div className="card"><div className="card-body empty">No data for {year}. Build it on the Season page instructions.</div></div>

  const maxPts = Math.max(...data.teams.map((t) => t.points))
  const rounds = data.form[0]?.rounds ?? []
  const form: Series[] = data.form.map((f, i) => ({
    key: f.driver, label: f.driver, color: f.color,
    dashed: data.form.slice(0, i).some((g) => g.color === f.color),
    values: rounds.map((r) => { const j = f.rounds.indexOf(r); return j >= 0 ? f.rolling[j] : null }),
  }))
  const gained = [...data.racecraft].filter((r) => r.gained != null).sort((a, b) => b.gained! - a.gained!)

  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Who scored for each team</h2><span className="hint">Race + sprint points · {data.rounds} rounds</span></div>
        <div className="card-body team-split">
          {data.teams.map((t) => (
            <div key={t.team_id} className="ts-row">
              <div className="ts-name"><i className="team-bar" style={{ background: t.color }} />{t.team}</div>
              <div className="ts-bar" style={{ width: `${(100 * t.points) / maxPts}%` }}>
                {t.drivers.map((d, i) => (
                  <div key={d.driver} className="ts-seg" style={{ flex: d.points || 0.0001, background: t.color, opacity: i === 0 ? 1 : i === 1 ? 0.6 : 0.35 }} title={`${d.driver}: ${d.points} pts (${d.share}%)`}>
                    {(t.points / maxPts) * d.share >= 9 && <span>{d.driver} {d.share}%</span>}
                  </div>
                ))}
              </div>
              <div className="ts-pts num">{t.points}</div>
            </div>
          ))}
        </div>
        <p className="map-hint">Each bar is a team's total. Segments show each driver's share, the top scorer first. A balanced bar means two drivers scoring evenly; a lopsided one means one driver carried the team.</p>
      </section>

      <div className="split-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="card-head"><h2>Qualifying vs. race</h2><span className="hint">Average places gained from grid to finish</span></div>
          <div className="traces">
            <HBars rows={gained.map((r) => ({ key: r.driver_id, label: r.driver_code, value: r.gained!, color: r.team_color, note: `avg quali P${r.avg_quali?.toFixed(1)} · grid P${r.avg_grid?.toFixed(1)} · finish P${r.avg_finish?.toFixed(1)}` }))}
              fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} unit="places / race" height={20} />
          </div>
          <p className="map-hint">Finishes only (DNFs excluded). Positive = moves forward on Sundays; front-runners have fewer places to gain.</p>
        </section>
        <section className="card">
          <div className="card-head"><h2>Reliability</h2><span className="hint">Grand Prix retirements per team</span></div>
          <div className="traces">
            <HBars rows={data.reliability.map((r) => ({ key: r.team_id, label: r.team_name.replace(/ F1 Team$/, ''), value: r.dnfs, color: r.team_color, note: Object.entries(r.causes ?? {}).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none' }))}
              fmt={(v) => v.toFixed(0)} unit="DNFs" height={22} labelWidth={130} />
          </div>
          <p className="map-hint">Counts every car not classified (crashes included). Hover a bar for the listed causes.</p>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Form · points per round, 5-round average</h2>
          <div className="legend">{form.map((s) => <span key={s.key} className="legend-item"><i className={`swatch-line${s.dashed ? ' dashed' : ''}`} style={{ borderColor: s.color }} />{s.label}</span>)}</div>
        </div>
        <div className="traces">
          <TraceChart title="Rolling points" unit="per round" x={rounds} series={form} height={260} fmt={(v) => v.toFixed(1)}
            range={[0, rounds.length - 1]} hover={hover} onHover={setHover} markers={rounds.map((r, i) => ({ at: i, label: `R${r}` }))} markerLines={false} sectorLines={[]}
            xFmt={(r) => `after round ${r}`} sortTip />
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h2>One-lap vs. race pace</h2><span className="hint">Median gap to the fastest team, % of lap time</span></div>
        {data.pace.length ? (
          <div className="traces">
            <Scatter points={data.pace.map((p) => ({ x: p.quali, y: p.race, color: p.color, r: 6, label: p.team.split(' ')[0], title: p.team, tip: [['qualifying gap', `${p.quali.toFixed(2)} %`], ['race pace gap', `${p.race.toFixed(2)} %`], ['rounds with lap data', String(p.rounds)]] as [string, string][] }))}
              lines={[{ x1: 0, y1: 0, x2: 4, y2: 4, color: 'var(--text-3)', dashed: true, width: 1 }]}
              xLabel="qualifying gap (%)" yLabel="race pace gap (%)" height={340} />
            <p className="map-hint">Below the dashed line = relatively stronger in races than in qualifying (kind on tyres, good in traffic). Race pace = median clean, fuel-uncorrected lap. Needs the laps pass of the dataset; {Math.max(...data.pace.map((p) => p.rounds))} of {data.rounds} rounds available so far.</p>
          </div>
        ) : <div className="card-body empty">Lap data for {year} is still being collected by the dataset's laps pass.</div>}
      </section>
    </>
  )
}
