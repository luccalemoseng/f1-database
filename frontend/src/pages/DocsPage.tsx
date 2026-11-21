import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useHashParams } from '../router'

// The Markdown files in /docs are the single source of truth: the same text
// is readable on GitHub and rendered here inside the app.
const files = import.meta.glob('../../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const docs = Object.entries(files)
  .map(([path, body]) => ({
    slug: path.split('/').pop()!.replace(/\.md$/, ''),
    title: body.match(/^#\s+(.+)$/m)?.[1] ?? path,
    body,
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug))

export default function DocsPage() {
  const [params, setParams] = useHashParams()
  const cur = docs.find((d) => d.slug === params.doc) ?? docs[0]
  return (
    <div className="page docs-page">
      <nav className="docs-nav" aria-label="Documentation">
        <div className="eyebrow">How it works</div>
        {docs.map((d) => (
          <button key={d.slug} className={d.slug === cur?.slug ? 'on' : ''} onClick={() => { setParams({ doc: d.slug }); window.scrollTo(0, 0) }}>
            {d.title}
          </button>
        ))}
      </nav>
      <article className="markdown">
        {cur ? <Markdown remarkPlugins={[remarkGfm]}>{cur.body}</Markdown> : <p>No docs found.</p>}
      </article>
    </div>
  )
}
