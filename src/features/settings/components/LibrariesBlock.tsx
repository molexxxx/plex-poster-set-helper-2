import { RefreshCw, Film, Tv } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Switch from '../../../components/ui/Switch'
import type { AppConfig, Library } from '../../../../electron/ipc/types'
import type { PlexAccount } from '../hooks/usePlexAccount'
import { agentLabel } from '../settingsText'
import Block from './Block'
import Row from './Row'
import styles from './LibrariesBlock.module.css'

/** The server's movie and TV libraries, each with a switch that keeps the app off it, and a Reload button. */
export default function LibrariesBlock({ cfg, plex }: { cfg: AppConfig; plex: PlexAccount })
{
  const { libraries, refreshingLibs, libCounts, loadLibraries, toggleLibrary } = plex
  const movieLibs = libraries.filter(l => l.type === 'movie')
  const showLibs  = libraries.filter(l => l.type === 'show')

  function libraryRow(lib: Library, kind: 'movie' | 'show') {
    const included = !(cfg!.excludedLibraries ?? []).includes(lib.title)
    const count = libCounts[lib.key]
    const noun = kind === 'movie' ? 'movies' : 'shows'
    const meta = [
      count != null ? `${count.toLocaleString()} ${noun}` : kind === 'movie' ? 'Movies' : 'TV shows',
      agentLabel(lib.agent) || null,
    ].filter(Boolean).join(' · ')
    const Icon = kind === 'movie' ? Film : Tv
    return (
      <Row key={lib.key} label={<span className={styles.libName}><Icon size={14} aria-hidden /> {lib.title}</span>} description={meta}>
        {({ labelId, descId }) => (
          <Switch checked={included} onChange={on => toggleLibrary(lib.title, on)} ariaLabelledBy={labelId} ariaDescribedBy={descId} />
        )}
      </Row>
    )
  }

  return (
    <Block
      title="Libraries"
      anchor="libraries"
      description="Libraries you turn off are skipped by the Library Browser, matching, and scheduled syncs."
      action={
        <Button
          variant="ghost" size="sm"
          icon={<RefreshCw size={13} className={refreshingLibs ? styles.spin : undefined} />}
          onClick={loadLibraries}
          disabled={refreshingLibs}
        >
          Reload
        </Button>
      }
    >
      {libraries.length === 0 ? (
        <Row label="No libraries found" description="The server answered but listed no movie or TV libraries. Reload after adding one in Plex." />
      ) : (
        <>
          {movieLibs.map(lib => libraryRow(lib, 'movie'))}
          {showLibs.map(lib => libraryRow(lib, 'show'))}
        </>
      )}
    </Block>
  )
}
