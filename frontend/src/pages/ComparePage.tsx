import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Compare, EventInfo, Overview } from '../api'
import { api, fmtDelta, fmtLap, SESSION_SHORT } from '../api'
import TrackMap, { type Cursor, type MapMode } from '../components/TrackMap'
import TraceChart, { type Series } from '../components/TraceChart'
import TimingTower from '../components/TimingTower'
import { CornerTable, SectorTable } from '../components/SplitTables'
import { Loading, ErrorBox } from '../components/Status'
import { useHashParams } from '../router'

const MAX_DRIVERS = 5

export default function ComparePage() {
  const [params, setParams] = useHashParams()
  const [seasons, setSeasons] = useState<number[]>([])
  const [events, setEvents] = useState<EventInfo[] | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [compare, setCompare] = useState<Compare | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mode = (params.m as MapMode) || 'lines'
  const setMode = (m: MapMode) => setParams({ m: m === 'lines' ? '' : m })
  const focus = params.c ? +params.c : null
  const setFocus = useCallback((i: number | null) => setParams({ c: i == null ? '' : String(i) }), [setParams])
  const [hover, setHover] = useState<number | null>(null)
  const [replay, setReplay] = useState<{ playing: boolean; t: number; speed: number } | null>(null)

  const year = params.y ? +params.y : null
  const round = params.r ? +params.r : null
  const session = params.s ?? null
  const selected = useMemo(() => (params.d ? params.d.split(',').filter(Boolean) : []), [params.d])

  // 1. Seasons
  useEffect(() => { api.seasons().then(setSeasons).catch((e) => setError(String(e.message))) }, [])

  // 2. Events of the season (defaults to the latest one that already ran)
  useEffect(() => {
    if (!seasons.length) return
    const y = year ?? seasons[0]
    setEvents(null)
    api.events(y).then((evs) => {
      const done = evs.filter((e) => e.sessions.some((s) => s.available))
      setEvents(evs)
      if (!done.length) {
        if (!year && seasons[1]) setParams({ y: String(seasons[1]) })
        return
      }
      if (year == null || round == null || !evs.some((e) => e.round === round)) {
        const ev = done[done.length - 1]
        const sess = ev.sessions.find((s) => s.name === 'Qualifying' && s.available) ?? ev.sessions.filter((s) => s.available).at(-1)!
        setParams({ y: String(y), r: String(ev.round), s: sess.name, d: '' })
      }
    }).catch((e) => setError(String(e.message)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasons, year])

  // 3. Session overview (first load downloads from F1 - may take ~30 s)
  useEffect(() => {
    if (year == null || round == null || !session) return
    setError(null); setLoading('Loading session timing & telemetry from FastF1…')
    setReplay(null)
    let live = true
    api.overview(year, round, session).then((ov) => {
      if (!live) return
      setOverview(ov)
      if (!params.d) setParams({ d: ov.drivers.filter((d) => d.fastestLap).slice(0, 2).map((d) => d.abbr).join(',') })
    }).catch((e) => live && setError(e.message)).finally(() => live && setLoading(null))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, round, session])

  // 4. Comparison of the selected drivers
  useEffect(() => {
    if (!overview || year == null || round == null || !session || !selected.length) { setCompare(null); return }
    let live = true
    api.compare(year, round, session, selected).then((c) => live && setCompare(c)).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [overview, year, round, session, selected])

  // Replay loop - advances the lap clock in real time × speed.
  const raf = useRef<number>(0)
  useEffect(() => {
    if (!replay?.playing || !compare) return
    const maxT = Math.max(...compare.drivers.map((d) => d.tel.t[d.tel.t.length - 1]))
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now
      setReplay((r) => {
        if (!r) return r
        const t = r.t + dt * r.speed
        return t >= maxT ? { ...r, t: maxT, playing: false } : { ...r, t }
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [replay?.playing, compare])

  // Team colours; the 2nd driver of a team is drawn dashed.
  const colorOf = useCallback((abbr: string) => overview?.drivers.find((d) => d.abbr === abbr)?.color ?? '#949498', [overview])
  const dashedOf = useCallback((abbr: string) => {
    const c = colorOf(abbr)
    const same = selected.filter((a) => colorOf(a) === c)
    return same.indexOf(abbr) > 0
  }, [selected, colorOf])

  const toggle = (abbr: string) => {
    const next = selected.includes(abbr) ? selected.filter((a) => a !== abbr) : [...selected, abbr].slice(0, MAX_DRIVERS)
    setParams({ d: next.join(',') })
  }

  const N = compare?.grid.length ?? 0
  const toIdx = (f: number) => Math.max(0, Math.min(N - 1, Math.round(f * (N - 1))))
  const range: [number, number] = focus != null && compare
    ? [toIdx(compare.corners[focus].segStart - 0.015), toIdx(compare.corners[focus].segEnd + 0.015)]
    : [0, Math.max(0, N - 1)]
  const markers = compare ? compare.corners.map((c) => ({ at: toIdx(c.frac), label: `${c.number}${c.letter}` })) : []
  const sectorLines = overview ? overview.track.sectorFrac.filter((f): f is number => f != null).map(toIdx) : []

  const seriesOf = (ch: keyof Compare['drivers'][number]['tel']): Series[] =>
    compare ? compare.drivers.map((d) => ({ key: d.abbr, label: d.abbr, color: d.color, dashed: dashedOf(d.abbr), values: d.tel[ch] })) : []

  const cursor: Cursor = replay ? { kind: 'time', t: replay.t } : hover != null ? { kind: 'idx', i: hover } : null
  const ev = events?.find((e) => e.round === round)
  const officialIdeal = overview ? overview.best.s1 + overview.best.s2 + overview.best.s3 : null
  const topSpeed = overview ? overview.drivers.reduce<{ v: number; d: string } | null>((m, d) => {
    const v = d.fastestLap?.speedTrap
    return v && (!m || v > m.v) ? { v, d: d.abbr } : m
  }, null) : null

  return (
    <div className="page">
      <div className="page-title">
        <h1>Session compare</h1>
        <span className="sub">Fastest laps head-to-head — racing lines, sectors and corner-by-corner timing</span>
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="season">Season</label>
          <select id="season" className="select" value={year ?? ''} onChange={(e) => setParams({ y: e.target.value, r: '', s: '', d: '', c: '' })}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="gp">Grand Prix</label>
          <select id="gp" className="select" value={round ?? ''} disabled={!events}
            onChange={(e) => {
              const evn = events!.find((x) => x.round === +e.target.value)!
              const s = evn.sessions.find((x) => x.name === session && x.available) ?? evn.sessions.find((x) => x.name === 'Qualifying' && x.available) ?? evn.sessions.filter((x) => x.available).at(-1)
              setParams({ r: e.target.value, s: s?.name ?? '', d: '', c: '' })
            }}>
            {events?.map((e) => (
              <option key={e.round} value={e.round} disabled={!e.sessions.some((s) => s.available)}>
                R{String(e.round).padStart(2, '0')} · {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Session</label>
          <div className="seg" role="group" aria-label="Session">
            {ev?.sessions.map((s) => (
              <button key={s.name} className={s.name === session ? 'on' : ''} disabled={!s.available}
                onClick={() => setParams({ s: s.name, d: '', c: '' })} title={s.available ? s.name : `${s.name} — not run yet`}>
                {SESSION_SHORT[s.name] ?? s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !overview && <Loading text={loading} />}

      {overview && (
        <div className={loading ? 'refetching' : ''}>
          <div className="event-banner">
            <div>
              <div className="eyebrow">{overview.event.year} · Round {overview.event.round} · {overview.session.name}</div>
              <h2>{overview.event.name}</h2>
              <div className="muted">{overview.event.location}, {overview.event.country} · {(overview.track.length / 1000).toFixed(3)} km · {overview.track.corners.length} corners</div>
            </div>
          </div>

          <div className="stats">
            <div className="stat t-purple">
              <div className="label">Fastest lap</div>
              <div className="value num">{fmtLap(overview.best.lap)}</div>
              <div className="meta"><i className="tdot" style={{ background: colorOf(overview.fastestDriver) }} />{overview.fastestDriver}</div>
            </div>
            <div className="stat">
              <div className="label">Ideal lap · best sectors</div>
              <div className="value num">{fmtLap(officialIdeal)}</div>
              <div className="meta">Official S1 + S2 + S3 bests · {fmtDelta(officialIdeal! - overview.best.lap)}</div>
            </div>
            <div className="stat">
              <div className="label">Ideal lap · best corners</div>
              <div className="value num">{compare ? fmtLap(compare.idealLap) : '—'}</div>
              <div className="meta" title="Sum of the fastest time through each corner segment, from telemetry. Estimate: ±0.05 s per corner.">Telemetry estimate (≈)</div>
            </div>
            <div className="stat">
              <div className="label">Top speed trap</div>
              <div className="value num">{topSpeed ? `${topSpeed.v}` : '—'}<small style={{ fontSize: 14, color: 'var(--text-3)' }}> km/h</small></div>
              <div className="meta">{topSpeed?.d} · on fastest lap</div>
            </div>
          </div>

          <div className="compare-grid">
            <section className="card tower-card">
              <div className="card-head"><h2>Timing</h2><span className="hint">Pick up to {MAX_DRIVERS}</span></div>
              <TimingTower overview={overview} selected={selected} onToggle={toggle} max={MAX_DRIVERS} />
            </section>

            <section className="card map-card">
              <div className="card-head">
                <h2>Track · {mode === 'lines' ? 'Racing lines' : mode === 'dominance' ? 'Corner dominance' : 'Session best'}</h2>
                <div className="seg" role="group" aria-label="Map mode">
                  <button className={mode === 'lines' ? 'on' : ''} onClick={() => setMode('lines')}>Lines</button>
                  <button className={mode === 'dominance' ? 'on' : ''} onClick={() => setMode('dominance')}>Dominance</button>
                  <button className={mode === 'session' ? 'on' : ''} onClick={() => setMode('session')}>Session best</button>
                </div>
              </div>
              <TrackMap overview={overview} compare={compare} mode={mode} cursor={cursor} focusCorner={focus}
                onCornerClick={setFocus} colorOf={colorOf} dashedOf={dashedOf} />
              <div className="map-foot">
                <div className="legend">
                  {(mode === 'session' && compare
                    ? [...new Set(compare.corners.map((c) => c.sessionBest.driver))]
                    : selected
                  ).map((a) => (
                    <span key={a} className="legend-item">
                      <i className={`swatch-line${mode === 'lines' && dashedOf(a) ? ' dashed' : ''}`} style={{ borderColor: colorOf(a) }} />{a}
                    </span>
                  ))}
                  {mode === 'session' && <span className="legend-item"><i className="swatch-line dashed" style={{ borderColor: 'var(--t-purple)' }} />Fastest lap line ({overview.fastestDriver})</span>}
                </div>
                <div className="replay">
                  <button className="btn icon" disabled={!compare} onClick={() => setReplay((r) => r ? { ...r, playing: !r.playing, t: r.playing ? r.t : (r.t >= Math.max(...compare!.drivers.map((d) => d.tel.t.at(-1)!)) ? 0 : r.t) } : { playing: true, t: 0, speed: 1 })}>
                    {replay?.playing ? '❚❚ Pause' : '▶ Replay lap'}
                  </button>
                  {replay && (
                    <>
                      <span className="num replay-t">{fmtLap(replay.t)}</span>
                      <div className="seg">
                        {[0.25, 0.5, 1, 2].map((s) => (
                          <button key={s} className={replay.speed === s ? 'on' : ''} onClick={() => setReplay({ ...replay, speed: s })}>{s}×</button>
                        ))}
                      </div>
                      <button className="btn icon" onClick={() => setReplay(null)} aria-label="Stop replay">✕</button>
                    </>
                  )}
                </div>
              </div>
              <p className="map-hint">Scroll to zoom, drag to pan, click a corner number to zoom in on it and on the charts. Lines differ by only a few metres, so zoom in to see them split.</p>
            </section>

            <section className="card splits-card">
              <div className="card-head"><h2>Sectors</h2><span className="hint">Fastest lap of each driver</span></div>
              <div className="card-body">
                {compare ? <SectorTable overview={overview} compare={compare} dashedOf={dashedOf} /> : <div className="empty">Select drivers</div>}
              </div>
              <div className="card-head"><h2>Corners</h2><span className="hint">Δ to session best · min speed</span></div>
              <div className="card-body tight">
                {compare ? <CornerTable compare={compare} focus={focus} onFocus={setFocus} dashedOf={dashedOf} /> : <div className="empty">Select drivers</div>}
              </div>
              <div className="status-legend">
                <span><i className="tdot" style={{ background: 'var(--t-purple)' }} /> Session best</span>
                <span><i className="tdot" style={{ background: 'var(--t-green)' }} /> Personal / best compared</span>
                <span><i className="tdot" style={{ background: 'var(--t-yellow)' }} /> Slower</span>
              </div>
            </section>
          </div>

          {compare && (
            <section className="card" style={{ marginTop: 16 }}>
              <div className="card-head">
                <h2>Telemetry · fastest laps{focus != null ? ` · Turn ${compare.corners[focus].number}${compare.corners[focus].letter}` : ''}</h2>
                <div className="legend">
                  {compare.drivers.map((d) => (
                    <span key={d.abbr} className="legend-item"><i className={`swatch-line${dashedOf(d.abbr) ? ' dashed' : ''}`} style={{ borderColor: d.color }} />{d.abbr} <span className="muted num">{fmtLap(d.fastestLap?.time)}</span></span>
                  ))}
                  {focus != null && <button className="btn icon" onClick={() => setFocus(null)}>Full lap</button>}
                </div>
              </div>
              <div className="traces">
                <TraceChart title="Speed" unit="km/h" x={compare.grid} series={seriesOf('speed')} height={190}
                  range={range} hover={hover} onHover={setHover} markers={markers} sectorLines={sectorLines} />
                <TraceChart title={`Gap to ${compare.reference}`} unit="s · above 0 = behind" x={compare.grid} series={seriesOf('delta')} height={130}
                  zeroLine fmt={(v) => v.toFixed(2)} range={range} hover={hover} onHover={setHover} markers={markers} sectorLines={sectorLines} />
                <TraceChart title="Throttle" unit="%" x={compare.grid} series={seriesOf('throttle')} height={110} domain={[0, 105]}
                  range={range} hover={hover} onHover={setHover} markers={markers} sectorLines={sectorLines} />
                <TraceChart title="Brake" unit="on / off" x={compare.grid} series={seriesOf('brake')} height={80} domain={[-0.05, 1.1]}
                  fmt={(v) => (v >= 0.5 ? 'On' : 'Off')} range={range} hover={hover} onHover={setHover} markers={markers} sectorLines={sectorLines} />
                <TraceChart title="Gear" unit="" x={compare.grid} series={seriesOf('gear')} height={100} domain={[0.5, 8.5]} step
                  range={range} hover={hover} onHover={setHover} markers={markers} sectorLines={sectorLines} />
              </div>
              <p className="map-hint">Distance on the x-axis is the {compare.reference} lap. Every lap is resampled to the same {compare.grid.length} points (fraction of the lap), so the same point means the same place on track for every driver.</p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
