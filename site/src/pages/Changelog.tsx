import changelog from '../../../CHANGELOG.md?raw'
import { REPO_URL, releaseDay } from '../data/release'
import { Markdown, parseBlocks, sections } from '../lib/markdown'

const releases = sections(parseBlocks(changelog)).map(section =>
{
  const version = /v(\d+\.\d+\.\d+)/.exec(section.title)?.[1] ?? section.title
  return { ...section, version, tag: `v${version}` }
})

/** The changelog page: every release's notes from CHANGELOG.md, newest first, each dated from GitHub. */
export function Changelog()
{
  return (
    <>
      <main id="main" className="changelog">
        <div className="changelog-head">
          <h1>Changelog</h1>
          <p className="lede">Release notes for every version, newest first. Each version's installers are on its <a href={`${REPO_URL}/releases`}>GitHub release</a>.</p>
        </div>
        <ol className="releases">
          {releases.map(r =>
          {
            const day = releaseDay(r.tag)
            return (
              <li key={r.tag} id={r.tag} className="release">
                <div className="release-label">
                  <h2><a href={`#${r.tag}`}>v{r.version}</a></h2>
                  {day && <p><time dateTime={day}>{day}</time></p>}
                </div>
                <div className="release-notes">
                  <Markdown blocks={r.blocks} />
                </div>
              </li>
            )
          })}
        </ol>
      </main>
    </>
  )
}
