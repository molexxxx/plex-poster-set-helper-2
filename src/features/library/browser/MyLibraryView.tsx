import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Image as ImageIcon } from 'lucide-react'
import Spinner from '../../../components/ui/Spinner'
import type { LibraryItem } from '../../../../electron/ipc/types'
import { useSmoothScroll } from '../../../app/useSmoothScroll'
import { useLibraryGrid } from './hooks/useLibraryGrid'
import LibraryToolbar from './components/LibraryToolbar'
import ItemCard from './components/ItemCard'
import SetsPanel from '../sets/SetsPanel'
import cardStyles from './components/ItemCard.module.css'
import styles from './MyLibraryView.module.css'
/** Plex library grid with per-section tabs, cross-library search, and the poster-sets panel. */
export default function MyLibraryView({ targetSection, targetItem }: { targetSection: string | null; targetItem: LibraryItem | null })
{
  const [selected, setSelected] = useState<LibraryItem | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useSmoothScroll(scrollRef)
  const grid = useLibraryGrid(scrollRef)
  const {
    items, setItems, total, loading, setSearch, setActiveKey, globalResults, setGlobalResults, collectionHits,
    globalLoading, artFilter, showStatus, isCollectionsView, isGlobalSearch, totalGlobalHits, onScroll,
  } = grid
  // The floating dock centers itself beside an open sets panel instead of over it.
  const panelOpen = selected != null
  useEffect(() =>
  {
    if (!panelOpen) return
    document.documentElement.dataset.libraryPanel = 'open'
    return () => { delete document.documentElement.dataset.libraryPanel }
  }, [panelOpen])

  // Deep-link from the command palette: jump to a specific library section.
  useEffect(() =>
  {
    if (!targetSection) return
    setSearch('')
    setActiveKey(targetSection)
    setSelected(null)
  }, [targetSection, setSearch, setActiveKey])

  // Deep-link from the command palette: open a specific item's sets panel,
  // and scroll its card into view within the active library tab.
  const scrollTargetRef = useRef<string | null>(null)
  const flashCard = useCallback((key: string) =>
  {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-item-key="${key}"]`)
    if (!el) return false
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add(cardStyles.itemCardPulse)
    setTimeout(() => el.classList.remove(cardStyles.itemCardPulse), 1600)
    return true
  }, [])

  useEffect(() =>
  {
    if (!targetItem) return
    // Filter the grid down to the chosen title (cross-library search) and open
    // its sets panel, so a command-palette jump lands on just that item.
    setSearch(targetItem.title)
    setSelected(targetItem)
    scrollTargetRef.current = targetItem.key
    // Best-effort once the grid for this section has had a moment to load.
    const t = setTimeout(() => { if (flashCard(targetItem.key)) scrollTargetRef.current = null }, 350)
    return () => clearTimeout(t)
  }, [targetItem, flashCard, setSearch])

  // Backup: if the grid loads later, scroll once the card appears.
  useEffect(() =>
  {
    const key = scrollTargetRef.current
    if (key && flashCard(key)) scrollTargetRef.current = null
  }, [items, flashCard])

  // When a new item is selected the grid reflows (gridScrollWithPanel adds
  // padding-right equal to the panel width). Two rAFs let React flush the DOM
  // and the browser complete layout before we scroll so the measured position
  // is post-reflow, not the pre-open position.
  useEffect(() =>
  {
    if (!selected) return
    let raf2: number
    const raf1 = requestAnimationFrame(() =>
    {
      raf2 = requestAnimationFrame(() =>
      {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-item-key="${selected.key}"]`)
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key])

  return (
    <>
      <LibraryToolbar grid={grid} setSelected={setSelected} />
      {/* Grid area */}
      <div
        className={`${styles.gridScroll} ${selected ? styles.gridScrollWithPanel : ''}`}
        ref={scrollRef}
        onScroll={onScroll}
      >
        {isGlobalSearch ? (
          globalLoading ? (
            <div className={styles.gridLoading}><Spinner size="sm" /><span>Searching all libraries…</span></div>
          ) : globalResults.length === 0 && collectionHits.length === 0 ? (
            <div className={styles.emptyGrid}>
              <ImageIcon size={32} />
              <p>No results across any library.</p>
            </div>
          ) : (
            <div className={styles.globalResults}>
              {collectionHits.length > 0 && (
                <div className={styles.globalGroup}>
                  <div className={styles.globalGroupHeader}>
                    <span className={styles.globalGroupTitle}>Collections</span>
                    <span className={styles.globalGroupMeta}>
                      <span className={styles.sectionType}>Collections</span>
                      {collectionHits.length} result{collectionHits.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={styles.itemGrid}>
                    {collectionHits.map(item => (
                      <ItemCard
                        key={item.key}
                        item={item}
                        active={selected?.key === item.key}
                        onClick={() => setSelected(item)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {globalResults.map(({ section, items: hits }) => (
                <div key={section.key} className={styles.globalGroup}>
                  <div className={styles.globalGroupHeader}>
                    <span className={styles.globalGroupTitle}>{section.title}</span>
                    <span className={styles.globalGroupMeta}>
                      <span className={styles.sectionType}>{section.type === 'movie' ? 'Movies' : 'TV'}</span>
                      {hits.length} result{hits.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className={styles.itemGrid}>
                    {hits.map(item => (
                      <ItemCard
                        key={item.key}
                        item={item}
                        active={selected?.key === item.key}
                        onClick={() => setSelected(item)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className={styles.gridCount}>{totalGlobalHits} result{totalGlobalHits !== 1 ? 's' : ''} across {globalResults.length} librar{globalResults.length !== 1 ? 'ies' : 'y'}</div>
            </div>
          )
        ) : (
          <>
            {items.length === 0 && !loading ? (
              <div className={styles.emptyGrid}>
                <ImageIcon size={32} />
                <p>{isCollectionsView ? 'No movie collections found.' : artFilter !== 'all' || showStatus !== 'any' ? 'No titles match these filters.' : 'This library is empty.'}</p>
              </div>
            ) : (
              <div className={styles.itemGrid}>
                {items.map(item => (
                  <ItemCard
                    key={item.key}
                    item={item}
                    active={selected?.key === item.key}
                    onClick={() => setSelected(item)}
                  />
                ))}
              </div>
            )}
            {loading && <div className={styles.gridLoading}><Spinner size="sm" /><span>Loading…</span></div>}
            {!loading && items.length > 0 && <div className={styles.gridCount}>{items.length} of {total}</div>}
          </>
        )}
      </div>

      {/* Sets panel. Stable key: the panel mounts once per open/close and
          swaps content internally as `item` changes, instead of a full
          remount per item - a remount-per-item used to fight its own
          slide-in animation whenever the user picked a different item while
          the panel was already open. */}
      <AnimatePresence>
        {selected && (
          <SetsPanel
            key="sets-panel"
            item={selected}
            onClose={() => setSelected(null)}
            onItemPoster={(key, thumb) =>
            {
              setItems(prev => prev.map(it => it.key === key ? { ...it, thumb } : it))
              // The grid may be showing cross-library search results instead of `items`.
              setGlobalResults(prev => prev.map(g => ({ ...g, items: g.items.map(it => it.key === key ? { ...it, thumb } : it) })))
              setSelected(prev => prev && prev.key === key ? { ...prev, thumb } : prev)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
