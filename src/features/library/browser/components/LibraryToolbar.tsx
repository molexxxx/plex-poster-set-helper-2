import { ArrowDown, ArrowUp, Film, Layers, Library, RefreshCw, Search, Tv, X } from 'lucide-react'
import Select from '../../../../components/ui/Select'
import type { LibraryItem, LibrarySort, LibraryStatusFilter } from '../../../../../electron/ipc/types'
import { COLLECTIONS_TAB_KEY, SORT_LABEL, type ArtFilterValue } from '../gridOptions'
import type { LibraryGrid } from '../hooks/useLibraryGrid'
import shared from '../../libraryShared.module.css'
import styles from './LibraryToolbar.module.css'

/** The grid toolbar: the section tabs and Collections, the art and status filters, sort, search, and refresh. */
export default function LibraryToolbar({ grid, setSelected }: { grid: LibraryGrid; setSelected: (item: LibraryItem | null) => void })
{
  const {
    sections, activeKey, setActiveKey, search, setSearch, isGlobalSearch, isCollectionsView, showCollections, artFilter, setArtFilter,
    artFilterOptions, showStatus, setShowStatus, shownSort, sortList, changeSort, sortDir, toggleSortDir, refreshing, handleRefresh,
  } = grid
  return (
    <div className={styles.controls}>
      <div className={`${styles.sectionTabs} ${isGlobalSearch ? styles.sectionTabsDimmed : ''}`}>
        {isGlobalSearch && (
          <span className={styles.allLibsChip}>
            <Library size={12} />
            All libraries
          </span>
        )}
        {sections.map(s => (
          <button
            key={s.key}
            className={`${styles.sectionTab} ${!isGlobalSearch && activeKey === s.key ? styles.sectionTabActive : ''}`}
            onClick={() => { setSearch(''); setActiveKey(s.key); setSelected(null) }}
          >
            {s.type === 'movie'
              ? <Film size={13} className={styles.sectionTabIcon} />
              : <Tv size={13} className={styles.sectionTabIcon} />}
            {s.title}
          </button>
        ))}
        {showCollections && (
          <button
            className={`${styles.sectionTab} ${!isGlobalSearch && isCollectionsView ? styles.sectionTabActive : ''}`}
            onClick={() => { setSearch(''); setActiveKey(COLLECTIONS_TAB_KEY); setSelected(null) }}
          >
            <Layers size={13} className={styles.sectionTabIcon} />
            Collections
          </button>
        )}
      </div>

      <div className={styles.controlsRight}>
        {!isCollectionsView && (
          <div className={styles.artFilter} title="Show only titles by their applied artwork">
            <Select
              value={artFilter}
              onChange={v => setArtFilter(v as ArtFilterValue)}
              options={artFilterOptions}
            />
          </div>
        )}
        {!isCollectionsView && (isGlobalSearch || sections.find(s => s.key === activeKey)?.type === 'show') && (
          <div className={styles.statusFilter} title="Show only series that are still going, or only ones that have finished. Uses TMDB when a key is set in Settings; without one, a show counts as continuing when an episode aired in the last year.">
            <Select
              value={showStatus}
              onChange={v => setShowStatus(v as 'any' | LibraryStatusFilter)}
              options={[
                { value: 'any', label: 'Any status' },
                { value: 'continuing', label: 'Continuing', description: 'Running, renewed, or in production' },
                { value: 'ended', label: 'Ended', description: 'Finished or canceled' },
              ]}
            />
          </div>
        )}
        <div className={styles.sortControl}>
          <Select
            value={shownSort}
            onChange={v => changeSort(v as LibrarySort)}
            options={sortList.map(s => ({ value: s, label: SORT_LABEL[s] }))}
          />
          <button
            className={styles.refreshBtn}
            onClick={toggleSortDir}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
          >
            {sortDir === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          </button>
        </div>
        <div className={styles.searchBox}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={`${styles.searchInput} ${isGlobalSearch ? styles.searchInputActive : ''}`}
            placeholder={isCollectionsView ? 'Filter collections…' : isGlobalSearch ? 'Filtering all libraries…' : 'Filter all libraries…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            spellCheck={false}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch('')}><X size={13} /></button>
          )}
        </div>
        <button
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh from Plex"
          aria-label="Refresh library from Plex"
        >
          <RefreshCw size={15} className={refreshing ? shared.spin : ''} />
        </button>
      </div>
    </div>
  )
}
