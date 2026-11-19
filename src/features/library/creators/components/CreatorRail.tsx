import { useId, useRef, useState } from 'react'
import { CalendarClock, ExternalLink, Eye, EyeOff, Plus, Star, UserPlus, X } from 'lucide-react'
import type { ScheduleCoverage } from '../../../../../electron/services/schedule/coverage'
import { parseCreatorInput, type useCreatorPrefs } from '../../../../utils/creatorPrefs'
import { errorMessage } from '../../../../utils/errorMessage'
import { creatorUrl } from '../../libraryShared'
import { catalogCache } from '../catalogCache'
import { plural } from '../catalogUtils'
import shared from './catalogShared.module.css'
import styles from './CreatorRail.module.css'

type CreatorPrefsApi = ReturnType<typeof useCreatorPrefs>

interface CreatorRailProps
{
  prefs: CreatorPrefsApi['prefs']
  /** The creator whose catalog is open. */
  active: string | null
  coverage: ScheduleCoverage
  setPicked: (name: string) => void
  stateOf: CreatorPrefsApi['stateOf']
  setState: CreatorPrefsApi['setState']
  /** Runs a follow or hide change, showing its error under the follow field. */
  savePrefs: (run: Promise<unknown>) => void
  prefsError: string | null
  setPrefsError: (error: string | null) => void
}

/** The creators rail: followed and hidden MediUX creators, ThePosterDB creators, and the follow field. */
export default function CreatorRail({ prefs, active, coverage, setPicked, stateOf, setState, savePrefs, prefsError, setPrefsError }: CreatorRailProps)
{
  const follows = prefs.mediuxFollows
  const [adding, setAdding] = useState('')
  const railRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const followingId = useId()
  const hiddenId = useId()

  const hiddenMediux = prefs.hidden.filter(h => h.source === 'mediux').map(h => h.username)
  const hiddenPosterdb = prefs.hidden.filter(h => h.source === 'posterdb').map(h => h.username)
  const browsable = [...follows, ...hiddenMediux]

  const isActive = (name: string) => active?.toLowerCase() === name.toLowerCase()

  async function addCreator()
  {
    const parsed = parseCreatorInput(adding)
    if (!parsed)
    {
      setPrefsError('Enter a username or a MediUX or ThePosterDB profile link.')
      return
    }
    setPrefsError(null)
    try
    {
      if (stateOf(parsed.source, parsed.name) !== 'followed') await setState(parsed.source, parsed.name, 'followed')
      if (parsed.source === 'mediux') setPicked(parsed.name)
      setAdding('')
    }
    catch (err)
    {
      setPrefsError(errorMessage(err))
    }
  }

  function onRailKey(e: React.KeyboardEvent)
  {
    if (!browsable.length) return
    const i = Math.max(0, browsable.findIndex(isActive))
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, browsable.length - 1)
      : e.key === 'ArrowUp' ? Math.max(i - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? browsable.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    setPicked(browsable[next])
    railRef.current?.querySelector<HTMLElement>(`[data-creator="${CSS.escape(browsable[next].toLowerCase())}"]`)?.focus()
  }

  function railOption(name: string, hidden: boolean)
  {
    const selected = isActive(name)
    const known = catalogCache.get(name.toLowerCase())
    const synced = coverage.creators.has(name.toLowerCase())
    const sub = [known ? plural(known.sets.length, 'set') : '', synced ? 'Synced' : ''].filter(Boolean).join(' · ')
    return (
      <div
        key={`${hidden ? 'hidden' : 'follow'}:${name}`}
        role="option"
        aria-selected={selected}
        tabIndex={selected || (!active && name === browsable[0]) ? 0 : -1}
        data-creator={name.toLowerCase()}
        className={`${styles.railItem} ${selected ? styles.railItemActive : ''}`}
        onClick={() => setPicked(name)}
      >
        {hidden ? <EyeOff size={13} className={styles.railIcon} aria-hidden /> : <Star size={13} className={styles.railIconFollowed} aria-hidden />}
        <span className={styles.railText}>
          <span className={styles.railName}>{name}</span>
          {sub && <span className={styles.railSub}>{sub}</span>}
        </span>
        {synced && <CalendarClock size={13} className={styles.railSynced} aria-hidden />}
      </div>
    )
  }

  return (
    <aside className={styles.rail} aria-label="Creators">
      <div ref={railRef} className={styles.railScroll}>
        {browsable.length > 0 && (
          <div role="listbox" aria-label="MediUX creators" className={styles.railList} onKeyDown={onRailKey}>
            {follows.length > 0 && (
              <div role="group" aria-labelledby={followingId}>
                <h2 id={followingId} className={styles.railHeading}>Following</h2>
                {follows.map(name => railOption(name, false))}
              </div>
            )}
            {hiddenMediux.length > 0 && (
              <div role="group" aria-labelledby={hiddenId}>
                <h2 id={hiddenId} className={styles.railHeading}>Hidden</h2>
                {hiddenMediux.map(name => railOption(name, true))}
              </div>
            )}
          </div>
        )}

        {(prefs.posterdbFollows.length > 0 || hiddenPosterdb.length > 0) && (
          <section className={styles.railList} aria-label="ThePosterDB creators">
            <h2 className={styles.railHeading}>On ThePosterDB</h2>
            <p className={styles.railNote}>These open on ThePosterDB; only MediUX catalogs are browsed here.</p>
            {[...prefs.posterdbFollows.map(name => ({ name, hidden: false })), ...hiddenPosterdb.map(name => ({ name, hidden: true }))].map(({ name, hidden }) => (
              <div key={`posterdb:${name}`} className={styles.railExternal}>
                <button type="button" className={styles.railExternalOpen} onClick={() => window.api.app.openExternal(creatorUrl('posterdb', name))}>
                  {hidden ? <EyeOff size={13} className={styles.railIcon} aria-hidden /> : <Star size={13} className={styles.railIconFollowed} aria-hidden />}
                  <span className={styles.railName}>{name}</span>
                  <ExternalLink size={12} className={styles.railIcon} aria-hidden />
                  <span className={shared.srOnly}>(opens ThePosterDB)</span>
                </button>
                <button
                  type="button"
                  className={styles.railRemove}
                  onClick={() => savePrefs(setState('posterdb', name, 'none'))}
                  aria-label={hidden ? `Unhide ${name}` : `Unfollow ${name}`}
                  title={hidden ? 'Unhide' : 'Unfollow'}
                >
                  {hidden ? <Eye size={13} /> : <X size={13} />}
                </button>
              </div>
            ))}
          </section>
        )}

        {!browsable.length && !prefs.posterdbFollows.length && (
          <p className={styles.railEmpty}>You are not following anyone yet.</p>
        )}
      </div>

      <div className={styles.follow}>
        <label htmlFor={inputId} className={styles.followLabel}>Follow a creator</label>
        <div className={styles.followField}>
          <UserPlus size={14} className={styles.followIcon} aria-hidden />
          <input
            id={inputId}
            className={styles.followInput}
            placeholder="Username or profile link"
            value={adding}
            onChange={e => setAdding(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void addCreator() }}
            spellCheck={false}
          />
          <button type="button" className={styles.followAdd} onClick={() => void addCreator()} disabled={!adding.trim()} aria-label="Follow" title="Follow">
            <Plus size={14} />
          </button>
        </div>
        {prefsError && <p className={styles.followError} role="alert">{prefsError}</p>}
      </div>
    </aside>
  )
}
