import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { LayoutGrid, Users } from 'lucide-react'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import type { LibraryItem } from '../../../electron/ipc/types'
import { useCreatorPrefs } from '../../utils/creatorPrefs'
import { useAppContext } from '../../app/AppContext'
import { useNavStore } from '../../app/navStore'
import { CreatorNav } from './libraryShared'
import MyLibraryView from './browser/MyLibraryView'
import CreatorsView from './creators/CreatorsView'
import styles from './LibraryPage.module.css'
/** Library Browser page: switches between the My Library grid and the Creators view. */
export default function LibraryPage() {
  const { plexConnected } = useAppContext()
  const mode    = useNavStore(s => s.libraryMode)
  const setMode = useNavStore(s => s.setLibraryMode)
  const [creatorTarget, setCreatorTarget] = useState<string | null>(null)
  const [sectionTarget, setSectionTarget] = useState<string | null>(null)
  const [itemTarget, setItemTarget] = useState<LibraryItem | null>(null)
  const libraryIntent = useNavStore(s => s.libraryIntent)
  const clearLibrary  = useNavStore(s => s.clearLibrary)
  const { prefs: creatorPrefs } = useCreatorPrefs()
  const followCount = creatorPrefs.mediuxFollows.length + creatorPrefs.posterdbFollows.length

  const openCreator = useCallback((username: string) => {
    setCreatorTarget(username)
    setMode('creators')
  }, [setMode])

  // Consume a deep-link intent from the command palette (creator, section, or item).
  useEffect(() => {
    if (!libraryIntent) return
    if (libraryIntent.creator || libraryIntent.creators) {
      if (libraryIntent.creator) setCreatorTarget(libraryIntent.creator)
      setMode('creators')
    } else if (libraryIntent.item) {
      if (libraryIntent.section) setSectionTarget(libraryIntent.section)
      setItemTarget(libraryIntent.item)
      setMode('library')
    } else if (libraryIntent.section) {
      setSectionTarget(libraryIntent.section)
      setMode('library')
    }
    clearLibrary()
  }, [libraryIntent, clearLibrary, setMode])

  return (
    <CreatorNav.Provider value={openCreator}>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className="page-title">{mode === 'library' ? 'Library Browser' : 'Creators'}</h1>
            <p className="page-subtitle">
              {mode === 'library'
                ? 'Browse your Plex library and apply MediUX and ThePosterDB poster sets.'
                : 'Browse a MediUX creator\'s whole catalog against your library and keep it in sync.'}
            </p>
          </div>

          <div className={styles.tabBar} role="tablist" aria-label="Library Browser view">
            <button
              role="tab"
              aria-selected={mode === 'library'}
              className={`${styles.tabBarBtn} ${mode === 'library' ? styles.tabBarBtnActive : ''}`}
              onClick={() => setMode('library')}
            >
              {mode === 'library' && (
                <motion.span className={styles.tabBarIndicator} layoutId="libTabIndicator" transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} />
              )}
              <LayoutGrid size={14} />
              <span>My Library</span>
            </button>
            <button
              role="tab"
              aria-selected={mode === 'creators'}
              className={`${styles.tabBarBtn} ${mode === 'creators' ? styles.tabBarBtnActive : ''}`}
              onClick={() => setMode('creators')}
            >
              {mode === 'creators' && (
                <motion.span className={styles.tabBarIndicator} layoutId="libTabIndicator" transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} />
              )}
              <Users size={14} />
              <span>Creators</span>
              {followCount > 0 && (
                <span className={styles.tabBadge} aria-label={`${followCount} followed`}>{followCount}</span>
              )}
            </button>
          </div>
        </div>

        {!plexConnected ? (
          <PlexConnectBanner />
        ) : mode === 'library' ? (
          <MyLibraryView targetSection={sectionTarget} targetItem={itemTarget} />
        ) : (
          <CreatorsView initialCreator={creatorTarget} />
        )}
      </div>
    </CreatorNav.Provider>
  )
}
