// Typed client for the FastAPI backend (see backend/app/main.py).

export type Status = 'purple' | 'green' | 'yellow' | null

export interface SessionInfo { name: string; dateUtc: string; available: boolean }
export interface EventInfo {
  round: number; name: string; officialName?: string; country: string; location: string
  date: string; format: string; sessions: SessionInfo[]
}

export interface Sector { time: number | null; status: Status }
export interface FastestLap {
  time: number; lapNumber: number; compound: string | null; tyreLife: number | null
  status: Status; gap: number; sectors: Sector[]; speedTrap: number | null
}
export interface Driver {
  abbr: string; number: string; name: string; team: string; color: string
  headshot: string | null; position: number | null; gridPosition: number | null
  points: number | null; status: string | null; lapsCompleted: number
  theoreticalBest: number | null; fastestLap: FastestLap | null
}
export interface Corner { number: number; letter: string; x: number; y: number; frac: number; angle: number }
export interface Overview {
  event: { year: number; round: number; name: string; country: string; location: string; officialName?: string }
  session: { name: string; date: string; isRace: boolean; totalLaps: number | null }
  best: { lap: number; s1: number; s2: number; s3: number }
  fastestDriver: string
  track: { x: number[]; y: number[]; length: number; rotation: number; sectorFrac: (number | null)[]; corners: Corner[] }
  drivers: Driver[]
}

export interface Telemetry {
  x: number[]; y: number[]; t: number[]; speed: number[]; throttle: number[]; brake: number[]
  gear: number[]; rpm: number[]; drs: number[]; delta: number[]
}
export interface CornerRow { time: number; minSpeed: number; delta: number; status: Status }
export interface CompareDriver {
  abbr: string; name: string; team: string; color: string; number: string
  fastestLap: FastestLap | null; tel: Telemetry; corners: CornerRow[]
}
export interface CompareCorner extends Corner {
  segStart: number; segEnd: number; sessionBest: { time: number; driver: string }
}
export interface Compare {
  reference: string; grid: number[]; corners: CompareCorner[]; idealLap: number; drivers: CompareDriver[]
}

// ----------------------------------------------------------------- Phase 2
export interface SeasonEvent { round: number; event_name: string; country: string; location: string; event_date: string; event_format: string; done: boolean }
export interface StandingRow {
  driver_id?: string; driver_code?: string; driver_name?: string
  team_id: string; team_name: string; team_color: string
  points: number; position: number; wins: number; podiums: number; races: number; dnfs: number
  p2: number; p3: number; round_points: number
  poles?: number; sprint_points?: number; avg_grid?: number | null; avg_finish?: number | null; best_finish?: number | null
}
export interface ProgressRow { round: number; driver_id?: string; team_id?: string; points: number; position: number; round_points: number }
export interface ResultCell {
  round: number; session: 'race' | 'sprint'; driver_id: string; grid: number | null; position: number | null
  classified_position: string; status: string; points: number; finished: boolean
}
export interface H2H { team_id: string; team_name: string; team_color: string; a: string; b: string; race: [number, number]; quali: [number, number]; points: [number, number] }
export interface Season {
  available: boolean; season: number; lastRound: number; events: SeasonEvent[]
  drivers: StandingRow[]; constructors: StandingRow[]
  driverProgress: ProgressRow[]; constructorProgress: ProgressRow[]; cells: ResultCell[]; h2h: H2H[]
}
export interface DatasetTable { name: string; rows: number; seasons: number[]; columns: { name: string; type: string }[] }

// ----------------------------------------------------------------- Phase 3
export interface Stint { stint: number; compound: string; from: number; to: number; fresh: boolean | null; startLife: number | null }
export interface RaceDriver {
  abbr: string; name: string; team: string; color: string; position: number | null; status: string | null
  stints: Stint[]; pits: number[]
  laps: { n: number[]; t: (number | null)[]; fc: (number | null)[]; clean: boolean[]; pos: (number | null)[] }
}
export interface CompoundDeg { compound: string; stints: number; median: number; p25: number; p75: number; points: [number, number][] }
export interface TrackCorner { number: number; letter: string; distance: number; minSpeed: number; kind: 'slow' | 'medium' | 'fast'; brakeLength: number; entrySpeed: number | null }
export interface TrackChar {
  driver: string; lapTime: number; length: number; fullThrottle: number; braking: number; topSpeed: number; avgSpeed: number
  gearChanges: number; zones: { start: number; length: number; entry: number; min: number }[]; corners: TrackCorner[]
  counts: { slow: number; medium: number; fast: number }
  map: { x: number[]; y: number[]; speed: number[]; brake: boolean[]; d: number[] }
  trace: { d: number[]; speed: number[]; throttle: number[]; brake: number[] }
}
export interface CornerPerf { team: string; color: string; drivers: string[]; slow?: number; medium?: number; fast?: number }
export interface RaceAnalysis {
  event: Overview['event']; session: Overview['session']; totalLaps: number; fuelCorrection: number
  neutralised: { lap: number; kind: 'SC' | 'VSC' | 'RED' }[]; drivers: RaceDriver[]
  degradation: { compounds: CompoundDeg[]; stints: { driver: string; team: string; color: string; compound: string; laps: number; slope: number; pace: number }[] }
  track: TrackChar; cornerPerformance: CornerPerf[]
}
export interface SeasonAnalysis {
  available: boolean; season: number; rounds: number
  teams: { team_id: string; team: string; color: string; points: number; drivers: { driver: string; points: number; share: number }[] }[]
  racecraft: { driver_id: string; driver_code: string; team_color: string; races: number; avg_grid: number | null; avg_finish: number | null; gained: number | null; avg_quali: number | null }[]
  form: { driver: string; color: string; rounds: number[]; rolling: number[] }[]
  reliability: { team_id: string; team_name: string; team_color: string; starts: number; dnfs: number; causes: Record<string, number> | null }[]
  pace: { team_id: string; team: string; color: string; quali: number; race: number; rounds: number }[]
}

const cache = new Map<string, Promise<unknown>>()

async function get<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(path).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail ?? `${r.status} ${r.statusText}`)
      }
      return r.json()
    })
    p.catch(() => cache.delete(path)) // allow retry after an error
    cache.set(path, p)
  }
  return cache.get(path) as Promise<T>
}

const enc = encodeURIComponent
export const api = {
  seasons: () => get<number[]>('/api/seasons'),
  events: (year: number) => get<EventInfo[]>(`/api/events/${year}`),
  overview: (y: number, r: number, s: string) => get<Overview>(`/api/session/${y}/${r}/${enc(s)}`),
  season: (y: number) => get<Season>(`/api/season/${y}`),
  raceAnalysis: (y: number, r: number, s: string) => get<RaceAnalysis>(`/api/analysis/race/${y}/${r}/${enc(s)}`),
  seasonAnalysis: (y: number) => get<SeasonAnalysis>(`/api/analysis/season/${y}`),
  dataset: () => get<{ tables: DatasetTable[] }>('/api/dataset'),
  compare: (y: number, r: number, s: string, drivers: string[]) =>
    get<Compare>(`/api/compare/${y}/${r}/${enc(s)}?drivers=${drivers.join(',')}`),
}

// ---------------------------------------------------------------- formatting
export function fmtLap(s: number | null | undefined): string {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  const rest = (s - m * 60).toFixed(3).padStart(6, '0')
  return m ? `${m}:${rest}` : rest
}
export const fmtSec = (s: number | null | undefined) => (s == null ? '—' : s.toFixed(3))
export const fmtGap = (s: number | null | undefined) => (s == null ? '—' : s === 0 ? 'Leader' : `+${s.toFixed(3)}`)
export const fmtDelta = (s: number | null | undefined) =>
  s == null ? '—' : `${s > 0 ? '+' : s < 0 ? '−' : '±'}${Math.abs(s).toFixed(3)}`

export const SESSION_SHORT: Record<string, string> = {
  'Practice 1': 'FP1', 'Practice 2': 'FP2', 'Practice 3': 'FP3', Qualifying: 'Quali',
  'Sprint Qualifying': 'Sprint Quali', 'Sprint Shootout': 'Shootout', Sprint: 'Sprint', Race: 'Race',
}
