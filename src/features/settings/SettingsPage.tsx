import { useEffect, useState, useCallback, useRef } from 'react'
import Spinner from '../../components/ui/Spinner'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useNavStore } from '../../app/navStore'
import { formatBytes } from '../../../electron/services/logFormat'
import { ANCHOR_GROUP, GROUPS, type GroupId } from './settingsOptions'
import { useAnnouncer } from './hooks/useAnnouncer'
import { useSettingsConfig } from './hooks/useSettingsConfig'
import { usePlexAccount } from './hooks/usePlexAccount'
import { useAnimeList } from './hooks/useAnimeList'
import { useBrowserEngine } from './hooks/useBrowserEngine'
import { useLogsAndCaches } from './hooks/useLogsAndCaches'
import { useAppEnv } from './hooks/useAppEnv'
import PlexGroup from './groups/PlexGroup'
import ArtworkGroup from './groups/ArtworkGroup'
import AppGroup from './groups/AppGroup'
import AdvancedGroup from './groups/AdvancedGroup'
import rowStyles from './components/settingsRows.module.css'
import styles from './SettingsPage.module.css'
/** Settings: Plex connection, artwork options, app behavior, and advanced maintenance, one group at a time. */
export default function SettingsPage()
{
  const [group, setGroup] = useState<GroupId>('plex')
  const rootRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<GroupId, HTMLButtonElement | null>>({ plex: null, artwork: null, app: null, advanced: null })
  const [showKey, setShowKey] = useState(false)
  const [confirm, setConfirm] = useState<'signout' | 'caches' | 'logs' | null>(null)

  const { announcement, announce } = useAnnouncer()
  const { cfg, setCfg, autosave, loadConfig, loaded, savedTmdbKey, saveTmdbKey } = useSettingsConfig()
  const plex = usePlexAccount({ cfg, setCfg, autosave, loadConfig, loaded, announce })
  const anime = useAnimeList(group === 'artwork', announce)
  const browser = useBrowserEngine(announce)
  const maintenance = useLogsAndCaches(group === 'advanced', announce, setCfg)
  const { env, autoStart, engine, toggleAutoStart } = useAppEnv()
  const isWeb = !!env?.web

  /** Shows a group and returns the page to its top. */
  const openGroup = useCallback((id: GroupId) =>
  {
    setGroup(id)
    rootRef.current?.parentElement?.scrollTo({ top: 0 })
  }, [])

  // Command-palette deep link: open the group that holds the anchor, then bring it into view.
  const settingsAnchor = useNavStore(s => s.settingsAnchor)
  const clearSettings  = useNavStore(s => s.clearSettings)
  useEffect(() =>
  {
    if (!settingsAnchor || !cfg) return
    const id = settingsAnchor
    let reveal: ReturnType<typeof setTimeout> | undefined
    const open = setTimeout(() =>
    {
      openGroup(ANCHOR_GROUP[id] ?? 'plex')
      reveal = setTimeout(() =>
      {
        const el = document.querySelector(`[data-anchor="${id}"]`)
        if (el)
        {
          el.scrollIntoView({ block: 'start' })
          el.classList.add(rowStyles.anchorPulse)
          setTimeout(() => el.classList.remove(rowStyles.anchorPulse), 1600)
        }
        clearSettings()
      }, 60)
    }, 0)
    return () => { clearTimeout(open); if (reveal) clearTimeout(reveal) }
  }, [settingsAnchor, cfg, clearSettings, openGroup])

  function onTabKey(e: React.KeyboardEvent)
  {
    const i = GROUPS.findIndex(g => g.id === group)
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i + 1) % GROUPS.length
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (i - 1 + GROUPS.length) % GROUPS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? GROUPS.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    openGroup(GROUPS[next].id)
    tabRefs.current[GROUPS[next].id]?.focus()
  }

  if (!cfg) return (
    <div className={styles.loading}><Spinner size="md" /></div>
  )

  const showAutoStart = !!env && !env.web && !env.container && !engine.external
  const active = GROUPS.find(g => g.id === group) ?? GROUPS[0]

  return (
    <div className={styles.page} ref={rootRef}>
      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="Settings">
          <div className={styles.sidebarHead}>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Changes save automatically.</p>
          </div>
          <div className={styles.tabs} role="tablist" aria-orientation="vertical" onKeyDown={onTabKey}>
            {GROUPS.map(g => (
              <button
                key={g.id}
                ref={el => { tabRefs.current[g.id] = el }}
                id={`settings-tab-${g.id}`}
                type="button"
                role="tab"
                aria-selected={group === g.id}
                aria-controls="settings-panel"
                tabIndex={group === g.id ? 0 : -1}
                className={`${styles.tab} ${group === g.id ? styles.tabActive : ''}`}
                onClick={() => openGroup(g.id)}
              >
                <g.Icon size={16} aria-hidden />
                <span>{g.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${group}`} className={styles.content}>
          <header className={styles.groupHead}>
            <h2 className={styles.groupTitle}>{active.label}</h2>
            <p className={styles.groupDesc}>{active.description}</p>
          </header>

          {group === 'plex' && <PlexGroup cfg={cfg} setCfg={setCfg} plex={plex} setConfirm={setConfirm} />}

          {group === 'artwork' && (
            <ArtworkGroup
              cfg={cfg}
              setCfg={setCfg}
              autosave={autosave}
              libraries={plex.libraries}
              serverConnected={plex.serverConnected}
              savedTmdbKey={savedTmdbKey}
              saveTmdbKey={saveTmdbKey}
              showKey={showKey}
              setShowKey={setShowKey}
              anime={anime}
            />
          )}

          {group === 'app' && (
            <AppGroup
              cfg={cfg}
              autosave={autosave}
              env={env}
              isWeb={isWeb}
              showAutoStart={showAutoStart}
              autoStart={autoStart}
              toggleAutoStart={toggleAutoStart}
              announce={announce}
            />
          )}

          {group === 'advanced' && (
            <AdvancedGroup cfg={cfg} autosave={autosave} isWeb={isWeb} browser={browser} maintenance={maintenance} setConfirm={setConfirm} />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'signout'}
        title="Sign out of Plex?"
        body={`The app stops reading your libraries and applying art until you sign in again, and scheduled jobs cannot apply art in the meantime.${isWeb ? ' Every browser signed in to this app is signed out, and the next Plex account to sign in becomes its owner.' : ''} Your library choices, schedules, and history are kept.`}
        confirmLabel="Sign out"
        onConfirm={() => { setConfirm(null); void plex.signOut() }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'logs'}
        title="Clear all logs?"
        body={`Every saved log file is deleted${maintenance.logStatus ? `, ${formatBytes(maintenance.logStatus.totalBytes)} in all` : ''}. Logs are what a bug report needs, so save a copy first if something went wrong.`}
        confirmLabel="Clear logs"
        onConfirm={() => { setConfirm(null); void maintenance.clearLogs() }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'caches'}
        title="Clear cached data?"
        body="Creator catalogs, series statuses, and library listings are read again the next time they are used. A large MediUX creator takes several minutes to read again."
        confirmLabel="Clear cached data"
        onConfirm={() => { setConfirm(null); void maintenance.clearCaches() }}
        onCancel={() => setConfirm(null)}
      />

      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </div>
  )
}
