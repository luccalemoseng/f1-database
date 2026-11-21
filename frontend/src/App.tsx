import { useRoute } from './router'
import ComparePage from './pages/ComparePage'
import DocsPage from './pages/DocsPage'
import SeasonPage from './pages/SeasonPage'
import AnalysisPage from './pages/AnalysisPage'
import LivePage from './pages/LivePage'
import './app.css'

const NAV = [
  { path: '/compare', label: 'Compare', phase: 1 },
  { path: '/season', label: 'Season', phase: 2 },
  { path: '/analysis', label: 'Analysis', phase: 3 },
  { path: '/live', label: 'Live', phase: 4 },
  { path: '/docs', label: 'Docs' },
]

export default function App() {
  const { path } = useRoute()
  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/compare">
          <svg className="brand-mark" viewBox="0 0 34 22" aria-hidden>
            <path d="M0 22 L12 4 Q14 0 19 0 H34 L30 6 H19 Q17 6 16 8 L7 22Z" fill="#E10600" />
            <path d="M12 22 L18 13 Q19 11 21 11 H30 L26 17 H22 L19 22Z" fill="#fff" />
          </svg>
          F1 DATABASE <small>powered by FastF1</small>
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={path === n.path ? 'active' : ''}>
              {n.label}{n.phase && n.phase > 1 && <span className="phase">P{n.phase}</span>}
            </a>
          ))}
        </nav>
      </header>
      {path === '/compare' && <ComparePage />}
      {path === '/docs' && <DocsPage />}
      {path === '/season' && <SeasonPage />}
      {path === '/analysis' && <AnalysisPage />}
      {path === '/live' && <LivePage />}
    </>
  )
}
