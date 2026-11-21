import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventInfo } from '../api'
import { api, SESSION_SHORT } from '../api'
import { ErrorBox } from '../components/Status'

// ------------------------------------------------------------------ types
interface LiveRow {
  num: string; tla: string; name: string; team: string; color: string; pos: number
  gap: string; interval: string; last: string; lastStatus: 'purple' | 'green' | null; best: string
  sectors: { v: string; s: 'purple' | 'green' | 'yellow' | null }[]
  laps: number | null; pits: number | null; inPit: boolean; pitOut: boolean; out: boolean
  tyre: string | null; tyreAge: number | null; tyreNew: boolean; xy: [number, number] | null
}
interface LiveSnapshot {
  session: { meeting: string | null; name: string | null; type: string | null; circuit: string | null; status: string | null }
  lap: { CurrentLap?: number; TotalLaps?: number }; clock: string | null
  track: { status: string | null; message: string | null }
  weather: { AirTemp?: string; TrackTemp?: string; Rainfall?: string; WindSpeed?: string; Humidity?: string }
  rows: LiveRow[]; rcm: { Utc: string; Lap?: number; Category: string; Message: string; Flag?: string }[]
  outline: [number, number][][]; messages: number
}
interface LiveStatus {
  mode: 'idle' | 'live' | 'replay'; error: string | null; authUrl: string | null; log: string[]
  token: { saved: boolean; expires: string | null }; file: string | null
  replay: { year: number; round: number; session: string; speed: number; loading: boolean; t: number; duration: number } | null
}

const post = (path: string, body: object = {}) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<LiveStatus>)
const getJSON = <T,>(path: string) => fetch(path).then((r) => r.json() as Promise<T>)

// Track status codes from the F1 feed
const TRACK: Record<string, { label: string; cls: string }> = {
  '1': { label: 'Green flag', cls: 'ts-green' }, '2': { label: 'Yellow flag', cls: 'ts-yellow' },
  '4': { label: 'Safety Car', cls: 'ts-yellow' }, '5': { label: 'Red flag', cls: 'ts-red' },
  '6': { label: 'Virtual Safety Car', cls: 'ts-yellow' }, '7': { label: 'VSC ending', cls: 'ts-yellow' },
}
const TYRE: Record<string, string> = { SOFT: 'var(--soft)', MEDIUM: 'var(--medium)', HARD: 'var(--hard)', INTERMEDIATE: 'var(--inter)', WET: 'var(--wet)' }
const fmtClock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function LivePage() {
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [snap, setSnap] = useState<LiveSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Poll status every 2 s, and the state every second while a source runs.
  useEffect(() => {
    let live = true
    const tick = () => getJSON<LiveStatus>('/api/live/status').then((s) => live && setStatus(s)).catch((e) => live && setError(String(e)))
    tick()
    const id = setInterval(tick, 2000)
    return () => { live = false; clearInterval(id) }
  }, [])
  const running = status?.mode && status.mode !== 'idle'
  useEffect(() => {
    if (!running) return
    let live = true
    const tick = () => getJSON<LiveSnapshot>('/api/live/state').then((s) => live && setSnap(s))
    tick()
    const id = setInterval(tick, 1000)
    return () => { live = false; clearInterval(id) }
  }, [running])

  const act = (p: Promise<LiveStatus>) => p.then(setStatus).catch((e) => setError(String(e)))

  return (
    <div className="page">
      <div className="page-title"><h1>Live timing</h1><span className="sub">F1 live-timing feed via FastF1, or a past session replayed from the archive</span></div>
      {error && <ErrorBox message={error} />}
      {status?.error && <ErrorBox message={status.error} />}

      {!running && status && <Sources status={status} act={act} />}
      {running && status && <ControlBar status={status} snap={snap} act={act} />}
      {running && status?.authUrl && (
        <div className="auth-box">
          <b>Sign in to F1 TV to continue.</b> FastF1 is waiting for you to log in. Open the link, sign in with your F1 TV account in your own browser, and the feed starts on its own.
          <a className="btn primary" href={status.authUrl} target="_blank" rel="noreferrer">Open F1 TV sign-in ↗</a>
          <small className="muted">Your password goes only to formula1.com. This app never sees it; FastF1 keeps the session token on this computer.</small>
        </div>
      )}
      {running && snap && <Board snap={snap} />}
    </div>
  )
}

function Sources({ status, act }: { status: LiveStatus; act: (p: Promise<LiveStatus>) => void }) {
  const [seasons, setSeasons] = useState<number[]>([])
  const [year, setYear] = useState<number | null>(null)
  const [events, setEvents] = useState<EventInfo[]>([])
  const [round, setRound] = useState<number | null>(null)
  const [session, setSession] = useState('Race')
  const [speed, setSpeed] = useState(10)
  const [next, setNext] = useState<{ ev: EventInfo; name: string; date: string } | null>(null)
  useEffect(() => { api.seasons().then((s) => { setSeasons(s); setYear(s[0]) }) }, [])
  useEffect(() => {
    if (!year) return
    api.events(year).then((evs) => {
      setEvents(evs)
      const done = evs.filter((e) => e.sessions.some((s) => s.name === 'Race' && s.available))
      if (done.length) setRound(done.at(-1)!.round)
      for (const e of evs) {
        const s = e.sessions.find((x) => !x.available)
        if (s && year === seasons[0]) { setNext({ ev: e, name: s.name, date: s.dateUtc }); break }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])
  const ev = events.find((e) => e.round === round)
  return (
    <div className="sources">
      <section className="card source">
        <div className="card-head"><h2>Live session · F1 TV</h2><span className={`pill ${status.token.saved ? 'ok' : ''}`}>{status.token.saved ? 'F1 TV token saved' : 'Not signed in'}</span></div>
        <div className="card-body">
          <p>Connects to the official live-timing feed while a session is running: positions, gaps, sector times, tyres, race control and car positions on track.</p>
          <ul className="steps">
            <li>Needs an active <b>F1 TV Access, Pro or Premium</b> subscription.</li>
            <li>The first time, FastF1 gives you a sign-in link: you log in on <b>formula1.com</b> in your own browser. No password is ever typed into this app.</li>
            <li>Everything received is also saved to <code>data/live/</code>, so a session can be replayed later.</li>
          </ul>
          {next && <p className="muted">Next session: <b>{next.ev.name} · {next.name}</b> · {new Date(next.date + 'Z').toLocaleString()}</p>}
          <button className="btn primary" onClick={() => act(post('/api/live/start', { mode: 'live' }))}>Connect to live timing</button>
        </div>
      </section>
      <section className="card source">
        <div className="card-head"><h2>Replay a past session</h2><span className="pill">No subscription needed</span></div>
        <div className="card-body">
          <p>Plays back the same live-timing messages F1 archived for a past session, through the same engine, at the speed you choose.</p>
          <div className="filters">
            <div className="field"><label>Season</label>
              <select className="select" value={year ?? ''} onChange={(e) => setYear(+e.target.value)}>{seasons.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            <div className="field"><label>Grand Prix</label>
              <select className="select" value={round ?? ''} onChange={(e) => setRound(+e.target.value)}>
                {events.filter((e) => e.sessions.some((s) => s.available)).map((e) => <option key={e.round} value={e.round}>R{e.round} · {e.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Session</label>
              <div className="seg">{ev?.sessions.filter((s) => s.available).map((s) => (
                <button key={s.name} className={session === s.name ? 'on' : ''} onClick={() => setSession(s.name)}>{SESSION_SHORT[s.name] ?? s.name}</button>
              ))}</div>
            </div>
            <div className="field"><label>Speed</label>
              <div className="seg">{[1, 5, 10, 30, 60].map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
            </div>
          </div>
          <button className="btn primary" disabled={!round} onClick={() => act(post('/api/live/start', { mode: 'replay', year, round, session, speed }))}>Start replay</button>
        </div>
      </section>
    </div>
  )
}

function ControlBar({ status, snap, act }: { status: LiveStatus; snap: LiveSnapshot | null; act: (p: Promise<LiveStatus>) => void }) {
  const rp = status.replay
  const ts = TRACK[snap?.track.status ?? ''] ?? null
  return (
    <div className="live-bar card">
      <span className={`live-dot ${status.mode}`} /> <b>{status.mode === 'live' ? 'LIVE' : 'REPLAY'}</b>
      <span className="live-title">{snap?.session.meeting ?? '…'} · {snap?.session.name ?? ''}</span>
      {ts && <span className={`track-pill ${ts.cls}`}>{ts.label}</span>}
      {snap?.lap.CurrentLap != null && <span className="num">Lap {snap.lap.CurrentLap}{snap.lap.TotalLaps ? ` / ${snap.lap.TotalLaps}` : ''}</span>}
      {snap?.clock && <span className="num muted">{snap.clock} left</span>}
      {snap?.weather.AirTemp && <span className="muted">Air {snap.weather.AirTemp}° · Track {snap.weather.TrackTemp}°{snap.weather.Rainfall === '1' ? ' · Rain' : ''}</span>}
      <span className="spacer" />
      {rp && (rp.loading ? <span className="muted">Downloading archived feed…</span> : (
        <>
          <input className="scrub" type="range" min={0} max={rp.duration} value={rp.t} onChange={(e) => act(post('/api/live/control', { seek: +e.target.value }))} aria-label="Replay position" />
          <span className="num muted">{fmtClock(Math.max(0, rp.t))}</span>
          <div className="seg">{[1, 5, 10, 30, 60].map((s) => <button key={s} className={rp.speed === s ? 'on' : ''} onClick={() => act(post('/api/live/control', { speed: s }))}>{s}×</button>)}</div>
        </>
      ))}
      <button className="btn" onClick={() => act(post('/api/live/stop'))}>Stop</button>
    </div>
  )
}

function Board({ snap }: { snap: LiveSnapshot }) {
  const isRace = snap.session.type === 'Race'
  return (
    <div className="live-grid">
      <section className="card">
        <div className="card-head"><h2>Timing</h2><span className="hint">{snap.messages.toLocaleString()} messages</span></div>
        <table className="splits live-table">
          <thead>
            <tr><th>P</th><th>Driver</th><th className="r">{isRace ? 'Gap' : 'Best'}</th>{isRace && <th className="r">Int</th>}<th className="r">Last lap</th><th>S1</th><th>S2</th><th>S3</th><th>Tyre</th>{isRace && <th className="r">Pit</th>}</tr>
          </thead>
          <tbody>
            {snap.rows.map((r) => (
              <tr key={r.num} className={r.out ? 'out' : ''}>
                <td><span className="pos">{r.pos < 99 ? r.pos : '–'}</span></td>
                <td><span className="drv"><i className="team-bar" style={{ background: r.color }} /><b>{r.tla}</b>{(r.inPit || r.pitOut) && <span className="pit-badge">{r.inPit ? 'PIT' : 'OUT'}</span>}{r.out && <span className="pit-badge">OUT</span>}</span></td>
                <td className="r num">{isRace ? r.gap : r.best}</td>
                {isRace && <td className="r num muted">{r.interval}</td>}
                <td className={`r num ${r.lastStatus ? `t-${r.lastStatus}-text` : ''}`}>{r.last}</td>
                {[0, 1, 2].map((k) => {
                  const s = r.sectors[k]
                  return <td key={k} className={`sec-cell t-${s?.s ?? 'none'}`}><i className="tbar" /><span className="num">{s?.v ?? ''}</span></td>
                })}
                <td>{r.tyre && <span className="live-tyre" style={{ borderColor: TYRE[r.tyre] ?? '#6a6a76' }} title={`${r.tyre}${r.tyreNew ? ' (new)' : ''}`}>{r.tyre[0]}</span>}<small className="muted num"> {r.tyreAge ?? ''}</small></td>
                {isRace && <td className="r num muted">{r.pits ?? ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="live-side">
        <section className="card"><div className="card-head"><h2>Track</h2><span className="hint">Live car positions</span></div><LiveMap snap={snap} /></section>
        <section className="card">
          <div className="card-head"><h2>Race control</h2></div>
          <ul className="rcm">
            {snap.rcm.map((m, i) => (
              <li key={i}><span className="muted num">{m.Utc?.slice(11, 19)}{m.Lap ? ` · L${m.Lap}` : ''}</span>{m.Flag && <span className={`flag flag-${m.Flag.toLowerCase().replace(/\s+/g, '-')}`}>{m.Flag}</span>}<span>{m.Message}</span></li>
            ))}
            {!snap.rcm.length && <li className="muted">No messages yet</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}

function LiveMap({ snap }: { snap: LiveSnapshot }) {
  const pts = snap.outline
  const ref = useRef<SVGSVGElement>(null)
  const vb = useMemo(() => {
    const all = [...pts.flat(), ...snap.rows.flatMap((r) => (r.xy ? [r.xy] : []))]
    if (!all.length) return null
    const xs = all.map((p) => p[0]), ys = all.map((p) => -p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = Math.max(maxX - minX, maxY - minY) * 0.08 + 200
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
    // the outline only grows; recomputing on its length keeps the view steady
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts.reduce((n, s) => n + s.length, 0) >> 5, snap.rows.length])
  if (!vb) return <div className="empty">Waiting for car positions…</div>
  const k = vb.w / 500
  return (
    <svg ref={ref} className="live-map" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label="Car positions on track">
      <path d={pts.map((seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${-p[1]}`).join('')).join('')} fill="none" stroke="#3a3a47" strokeWidth={9 * k} strokeLinejoin="round" strokeLinecap="round" />
      {[...snap.rows].reverse().map((r) => r.xy && (
        <g key={r.num} style={{ transition: 'transform 1s linear' }} transform={`translate(${r.xy[0]} ${-r.xy[1]})`}>
          <circle r={6 * k} fill={r.color} stroke="var(--surface)" strokeWidth={2 * k} />
          <text x={9 * k} y={4 * k} fontSize={11 * k} fill="#fff" fontWeight={700} stroke="var(--surface)" strokeWidth={3 * k} paintOrder="stroke">{r.tla}</text>
        </g>
      ))}
    </svg>
  )
}
