import { AlertCircle, Image as ImageIcon, Loader2 } from 'lucide-react'
import Spinner from '../../../../components/ui/Spinner'
import type { LibraryItem, PosterSetSummary } from '../../../../../electron/ipc/types'
import { SOURCE_LABEL } from '../../../../utils/posterGroups'
import type { BrowseSets } from '../hooks/useBrowseSets'
import type { LinkedSets } from '../hooks/useLinkedSets'
import { SOURCES } from '../setsPanelUtils'
import shared from '../../libraryShared.module.css'
import styles from './PanelNotices.module.css'

interface PanelNoticesProps
{
  item: LibraryItem
  isCollectionItem: boolean
  browse: BrowseSets
  links: LinkedSets
  /** Why the last follow or hide could not be saved. */
  creatorError: string | null
  hasTmdbKey: boolean
  allSets: PosterSetSummary[]
  visibleSets: PosterSetSummary[]
  /** Sets from hidden creators the list tucks away. */
  hiddenCount: number
}

/** The notes above the sets: loading, sites still searching or that failed, unreadable links, and why nothing shows. */
export default function PanelNotices({ item, isCollectionItem, browse, links, creatorError, hasTmdbKey, allSets, visibleSets, hiddenCount }: PanelNoticesProps)
{
  const { loading, pending, sourceErrors, error, tmdbMissing, sets, posterdbMore } = browse
  const { linkErrors, unlink, updateLinkUi } = links
  return (
    <>
      {loading && <div className={styles.panelLoading}><Spinner size="sm" /> <span>{isCollectionItem ? 'Finding collection sets on MediUX and ThePosterDB…' : 'Finding sets on MediUX and ThePosterDB…'}</span></div>}

      {!loading && pending.size > 0 && (
        <div className={styles.panelInlineNotice}>
          <Loader2 size={13} className={shared.spin} />
          <span>Still searching {[...pending].map(s => SOURCE_LABEL[s]).join(' and ')}…</span>
        </div>
      )}

      {creatorError && (
        <div className={styles.panelInlineNotice}>
          <AlertCircle size={13} />
          <span>Could not save that creator preference: {creatorError}</span>
        </div>
      )}

      {/* A site that could not be searched is a note beside the other site's
          sets, never a reason to hide them. */}
      {!loading && SOURCES.filter(s => sourceErrors[s]).map(s => (
        <div key={s} className={styles.panelInlineNotice}>
          <AlertCircle size={13} />
          <span>{SOURCE_LABEL[s]} could not be searched: {sourceErrors[s]}</span>
        </div>
      ))}

      {/* A link whose page could not be read this time stays attached; the
          user can retry with Refresh or let it go. */}
      {linkErrors.map((e, i) => (
        <div key={e.url || i} className={styles.panelInlineNotice}>
          <AlertCircle size={13} />
          <span>
            A linked page could not be read: {e.error}
            {e.url && <>{' '}<span className={styles.linkUrl}>{e.url}</span>{' '}<button className={styles.noteSearchLink} onClick={() => unlink(e.url)}>Unlink</button></>}
          </span>
        </div>
      ))}

      {error === 'no_movies' && (
        <div className={styles.panelNotice}>
          <AlertCircle size={20} />
          <p><strong>No movies in this collection.</strong></p>
          <p className={styles.noticeSub}>Plex needs at least one movie in the collection to discover MediUX collection art.</p>
        </div>
      )}

      {error === 'no_tmdb' && isCollectionItem && (
        <div className={styles.panelNotice}>
          <AlertCircle size={20} />
          <p><strong>No TMDB ids for collection members.</strong></p>
          <p className={styles.noticeSub}>
            {hasTmdbKey
              ? <>Plex did not expose TMDB ids for the movies in this collection, so MediUX cannot look up collection art.</>
              : <>Add a free TMDB API key in Settings so member movies can be matched to MediUX.</>}
          </p>
        </div>
      )}

      {error === 'no_tmdb' && !isCollectionItem && (() =>
      {
        const agent = item.tvdbId ? 'TVDB' : item.imdbId ? 'IMDb' : item.anidbId ? 'AniDB' : 'non-TMDB'
        // A key only helps convert tvdb/imdb ids via TMDB; AniDB is mapped
        // separately, so its failures mean "no known mapping", not "add a key".
        const keyWouldHelp = !hasTmdbKey && (item.tvdbId || item.imdbId)
        return (
          <div className={styles.panelNotice}>
            <AlertCircle size={20} />
            <p><strong>No TMDB match for this item.</strong></p>
            <p className={styles.noticeSub}>
              {keyWouldHelp ? (
                <>This title uses a {agent} agent. Add a free TMDB API key in Settings to auto-convert it to TMDB.</>
              ) : (
                <>This title&apos;s {agent} id has no known TMDB mapping, so MediUX has no sets to show for it.</>
              )}
            </p>
            <p className={styles.noticeSub}>ThePosterDB matches on title instead, and had nothing for this one either.</p>
          </div>
        )
      })()}
      {error && error !== 'no_tmdb' && (
        <div className={styles.panelNotice}><AlertCircle size={20} /><p>{error}</p></div>
      )}

      {/* Sets came back from ThePosterDB (title match) but MediUX was skipped
          for want of a TMDB id - worth saying, not worth hiding results for.
          A key only converts TVDB/IMDb ids, so it is suggested only then. */}
      {!loading && !error && tmdbMissing && sets.length > 0 && (
        <div className={styles.panelInlineNotice}>
          <AlertCircle size={13} />
          <span>
            ThePosterDB sets only: this item has no TMDB id, so MediUX could not be searched.
            {!hasTmdbKey && (item.tvdbId || item.imdbId) && ' Add a TMDB API key in Settings to include it.'}
          </span>
        </div>
      )}

      {!loading && !error && posterdbMore && (
        <div className={styles.panelInlineNotice}>
          <ImageIcon size={13} />
          <span>
            ThePosterDB lists more sets for this title than are shown here.{' '}
            <button className={styles.noteSearchLink} onClick={() => window.api.app.openExternal(posterdbMore)}>Open on ThePosterDB</button>
          </span>
        </div>
      )}

      {!loading && !error && pending.size === 0 && allSets.length === 0 && (() =>
      {
        const searched = SOURCES.filter(s => !sourceErrors[s])
        return (
          <div className={styles.panelNotice}>
            <ImageIcon size={20} />
            <p>
              {searched.length === 0
                ? 'Neither site could be searched for this title.'
                : `No sets found for this title on ${searched.map(s => SOURCE_LABEL[s]).join(' or ')}.`}
            </p>
            <p className={styles.noticeSub}>
              Know where the art is?{' '}
              <button className={styles.noteSearchLink} onClick={() => updateLinkUi({ open: true })}>Link a set or the title&apos;s page</button>
              {' '}from either site and it will be used here.
            </p>
          </div>
        )
      })()}

      {!loading && !error && allSets.length > 0 && visibleSets.length === 0 && hiddenCount === 0 && (
        <div className={styles.panelNotice}><ImageIcon size={20} /><p>No sets match the current filters.</p></div>
      )}
    </>
  )
}
