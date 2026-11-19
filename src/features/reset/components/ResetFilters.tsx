import Spinner from '../../../components/ui/Spinner'
import { SOURCE_LABEL } from '../../../utils/posterGroups'
import type { SourceFilter, TypeFilter } from '../resetText'
import styles from './ResetFilters.module.css'


interface ResetFiltersProps
{
  search: string
  onSearch: (text: string) => void
  sourceFilter: SourceFilter
  onSource: (f: SourceFilter) => void
  typeFilter: TypeFilter
  onType: (f: TypeFilter) => void
  /** A Reset All is in progress; its count shows at the end of the row. */
  running: boolean
  completed: number
  total: number
}


/** The list's title search, source and type filters, and the Reset All progress. */
export default function ResetFilters({ search, onSearch, sourceFilter, onSource, typeFilter, onType, running, completed, total }: ResetFiltersProps)
{
  return (
    <div className={styles.filters}>
      <input
        className={styles.searchInput}
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder="Search by title…"
      />
      <div className={styles.filterGroup}>
        {(['all', 'mediux', 'posterdb'] as SourceFilter[]).map(f => (
          <button
            key={f}
            className={`${styles.filterBtn} ${sourceFilter === f ? styles.filterActive : ''}`}
            onClick={() => onSource(f)}
          >
            {f === 'all' ? 'All Sources' : SOURCE_LABEL[f]}
          </button>
        ))}
      </div>
      <div className={styles.filterGroup}>
        {(['all', 'movie', 'show'] as TypeFilter[]).map(f => (
          <button
            key={f}
            className={`${styles.filterBtn} ${typeFilter === f ? styles.filterActive : ''}`}
            onClick={() => onType(f)}
          >
            {f === 'all' ? 'All Types' : f === 'movie' ? 'Movies' : 'Shows'}
          </button>
        ))}
      </div>
      {running && (
        <span className={styles.workingTag}>
          <Spinner size="xs" /> Resetting… {completed}/{total}
        </span>
      )}
    </div>
  )
}
