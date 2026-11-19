import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ListChecks, Loader2, Search, X } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import Segmented from '../../../../components/ui/Segmented'
import type { MediuxUserSet, ScheduledJob } from '../../../../../electron/ipc/types'
import { count, type LibraryFilter, type Tab } from '../catalogUtils'
import shared from './catalogShared.module.css'
import styles from './CatalogToolbar.module.css'

interface CatalogToolbarProps
{
  tab: Tab
  tabCounts: Record<Tab, number>
  changeTab: (tab: Tab) => void
  filter: LibraryFilter
  changeFilter: (filter: LibraryFilter) => void
  /** The sets the search matches, before the library filter. */
  queried: MediuxUserSet[]
  libraryCount: number
  query: string
  changeQuery: (value: string) => void
  searching: boolean
  searchRef: RefObject<HTMLInputElement | null>
  username: string
  /** The job that syncs this creator; Select is offered only without one. */
  creatorJob?: ScheduledJob
  selecting: boolean
  setSelecting: Dispatch<SetStateAction<boolean>>
  setSelected: (selected: Set<string>) => void
}

/** The catalog toolbar: the Sets, Posters, Backdrops, and Title cards tabs, the library filter, search, and Select. */
export default function CatalogToolbar({
  tab, tabCounts, changeTab, filter, changeFilter, queried, libraryCount, query, changeQuery, searching, searchRef, username, creatorJob,
  selecting, setSelecting, setSelected,
}: CatalogToolbarProps)
{
  return (
    <div className={styles.toolbar}>
      <div role="tablist" aria-label="Show" className={styles.tabs}>
        {([['sets', 'Sets', tabCounts.sets], ['posters', 'Posters', tabCounts.posters], ['backdrops', 'Backdrops', tabCounts.backdrops], ['titlecards', 'Title cards', tabCounts.titlecards]] as const).map(([value, label, n]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            className={`${shared.tab} ${tab === value ? shared.tabActive : ''}`}
            onClick={() => changeTab(value)}
            onKeyDown={e =>
            {
              const order: Tab[] = ['sets', 'posters', 'backdrops', 'titlecards']
              const i = order.indexOf(tab)
              const next = e.key === 'ArrowRight' ? order[(i + 1) % 4] : e.key === 'ArrowLeft' ? order[(i + 3) % 4] : null
              if (!next) return
              e.preventDefault()
              changeTab(next)
              ;(e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tab="${next}"]`))?.focus()
            }}
            data-tab={value}
          >
            {label}<span className={shared.tabCount}>{count(n)}</span>
          </button>
        ))}
      </div>

      <div className={styles.tools}>
        <Segmented
          ariaLabel="Library filter"
          value={filter}
          onChange={changeFilter}
          options={[
            { value: 'library', label: `In my library ${count(libraryCount)}` },
            { value: 'missing', label: `Not in library ${count(queried.length - libraryCount)}` },
            { value: 'all', label: `All ${count(queried.length)}` },
          ]}
        />
        <div className={styles.search}>
          {searching ? <Loader2 size={13} className={`${styles.searchIcon} ${shared.spin}`} aria-hidden /> : <Search size={13} className={styles.searchIcon} aria-hidden />}
          <input
            ref={searchRef}
            className={styles.searchInput}
            placeholder="Search titles"
            aria-label={`Search @${username}'s titles`}
            value={query}
            onChange={e => changeQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); changeQuery('') } }}
            spellCheck={false}
          />
          {query && (
            <button type="button" className={styles.searchClear} onClick={() => { changeQuery(''); searchRef.current?.focus() }} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>
        {tab === 'sets' && !creatorJob && (
          <Button
            variant={selecting ? 'secondary' : 'ghost'}
            size="sm"
            icon={<ListChecks size={13} />}
            aria-pressed={selecting}
            onClick={() => { setSelecting(v => !v); setSelected(new Set()) }}
          >
            {selecting ? 'Done' : 'Select'}
          </Button>
        )}
      </div>
    </div>
  )
}
