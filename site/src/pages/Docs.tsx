import { useEffect, useState } from 'react'
import readme from '../../../README.md?raw'
import { Footer } from '../components/Footer'
import { Header } from '../components/Header'
import docList from '../data/docs.json'
import { release } from '../data/release'
import { Markdown, parseBlocks, sections } from '../lib/markdown'

// README.md is the single source: editing it updates GitHub and this page
// together. The build fails when a listed section or a linked anchor has no
// matching README heading (see vite.config.ts).
const docs = sections(parseBlocks(readme)).filter(s => docList.sections.includes(s.id))

/** The docs page: the README's reference sections, with a rail that tracks the one in view. */
export function Docs()
{
  const [current, setCurrent] = useState(docs[0]?.id ?? '')

  useEffect(() =>
  {
    const watch = new IntersectionObserver(entries =>
    {
      const seen = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (seen[0]) setCurrent(seen[0].target.id)
    }, { rootMargin: '-15% 0px -70% 0px' })
    for (const s of docs)
    {
      const el = document.getElementById(s.id)
      if (el) watch.observe(el)
    }
    return () => watch.disconnect()
  }, [])

  return (
    <>
      <Header current="docs" />
      <main id="main" className="docs">
        <nav className="docs-rail" aria-label="Docs sections">
          <p className="docs-rail-title">Docs · v{release.version}</p>
          <ol>
            {docs.map(s => (
              <li key={s.id}><a href={`#${s.id}`} aria-current={current === s.id ? 'location' : undefined}>{s.title}</a></li>
            ))}
          </ol>
        </nav>
        <article className="docs-body">
          <h1>Docs</h1>
          <p className="lede">Installing, first run, everyday use, and troubleshooting, kept in step with the project README.</p>
          {docs.map(s => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`}>{s.title}</h2>
              <Markdown blocks={s.blocks} />
            </section>
          ))}
        </article>
      </main>
      <Footer />
    </>
  )
}
