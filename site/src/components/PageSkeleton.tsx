import type { Route } from '../lib/router'

const LINES = ['100%', '97%', '99%', '62%']

function Bone({ className = '', width }: { className?: string; width?: string })
{
  return <span className={`bone ${className}`} style={width ? { width } : undefined} />
}

function Paragraph()
{
  return <div className="bone-block">{LINES.map((w, i) => <Bone key={i} width={w} />)}</div>
}

/**
 * Stands in for a page while its code loads on a first visit, laid out with
 * the page's own classes so the content lands where the skeleton was and the
 * footer stays below the fold.
 */
export function PageSkeleton({ route }: { route: Route })
{
  if (route === 'docs')
  {
    return (
      <main id="main" className="docs skeleton" aria-busy="true">
        <div className="docs-rail" aria-hidden="true">
          <Bone className="bone-label" />
          {Array.from({ length: 8 }, (_, i) => <Bone key={i} className="bone-rail" width={`${58 + ((i * 23) % 36)}%`} />)}
        </div>
        <div className="docs-body">
          <h1>Docs</h1>
          <div aria-hidden="true">
            <div className="bone-lede"><Bone width="94%" /><Bone width="58%" /></div>
            {[0, 1].map(i => (
              <div key={i}>
                <Bone className="bone-heading" />
                <Paragraph />
                <Bone className="bone-panel" />
                <Paragraph />
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }
  if (route === 'changelog')
  {
    return (
      <main id="main" className="changelog skeleton" aria-busy="true">
        <div className="changelog-head">
          <h1>Changelog</h1>
          <div className="bone-lede" aria-hidden="true"><Bone width="88%" /><Bone width="46%" /></div>
        </div>
        <div className="releases" aria-hidden="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="release">
              <div className="release-label"><Bone className="bone-version" /><Bone className="bone-label" /></div>
              <div><Bone className="bone-subhead" /><Paragraph /><Paragraph /></div>
            </div>
          ))}
        </div>
      </main>
    )
  }
  return <main id="main" className="skeleton" aria-busy="true" />
}
