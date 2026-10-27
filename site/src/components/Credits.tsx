import changelog from '../../../CHANGELOG.md?raw'

const contributors = [...new Set([...changelog.matchAll(/Thanks to @([A-Za-z0-9-]+)/g)].map(m => m[1]))]
  .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))

/** The end credits: the art communities, the maintainer, and every credited contributor. */
export function Credits()
{
  return (
    <section className="credits" aria-labelledby="credits-title">
      <h2 id="credits-title">Credits</h2>
      <dl>
        <div>
          <dt>Artwork by the communities of</dt>
          <dd><a href="https://mediux.pro">MediUX</a> <span aria-hidden="true">and</span> <a href="https://theposterdb.com">ThePosterDB</a></dd>
        </div>
        <div>
          <dt>Built and maintained by</dt>
          <dd><a href="https://github.com/molexxxx">molexxxx</a></dd>
        </div>
        {contributors.length > 0 && (
          <div>
            <dt>With contributions from</dt>
            <dd className="credits-names">{contributors.map(name => <a key={name} href={`https://github.com/${name}`}>{name}</a>)}</dd>
          </div>
        )}
        <div>
          <dt>Rebuilt from the original Python tool by</dt>
          <dd><a href="https://github.com/bbrown430/plex-poster-set-helper">bbrown430</a></dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>MIT</dd>
        </div>
      </dl>
    </section>
  )
}
