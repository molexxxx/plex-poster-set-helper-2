import type { Dispatch, SetStateAction } from 'react'
import { User } from 'lucide-react'
import Select from '../../../../components/ui/Select'
import TypeToggles from '../../../../components/ui/TypeToggles'
import type { PosterSetSummary, SetSource } from '../../../../../electron/ipc/types'
import { SOURCE_LABEL, type FileType } from '../../../../utils/posterGroups'
import type { arrangeSets } from '../../../../utils/librarySets'
import { SOURCES } from '../setsPanelUtils'
import styles from './SetFilters.module.css'

type Arranged = ReturnType<typeof arrangeSets>

interface SetFiltersProps
{
  sourceCounts: Arranged['sourceCounts']
  activeSource: Arranged['activeSource']
  setSource: (source: SetSource | 'all') => void
  allSets: PosterSetSummary[]
  /** The uploaders the dropdown offers. */
  uploaders: Arranged['uploaders']
  activeUploader: Arranged['activeUploader']
  setUploader: (uploader: string) => void
  /** The active site's sets, which "All uploaders" counts. */
  sourceSets: Arranged['sourceSets']
  types: Set<FileType>
  setTypes: Dispatch<SetStateAction<Set<FileType>>>
}

/** The panel filters: which site, which uploader, and which artwork types to show and apply. */
export default function SetFilters({ sourceCounts, activeSource, setSource, allSets, uploaders, activeUploader, setUploader, sourceSets, types, setTypes }: SetFiltersProps)
{
  return (
    <div className={styles.filters}>
      {/* Only worth a row when both sites answered; the card badges and
          the notices cover a single-site list. */}
      {sourceCounts.mediux > 0 && sourceCounts.posterdb > 0 && (
        <div className={styles.sourceToggles} role="group" aria-label="Source">
          <button
            className={`${styles.sourceToggle} ${activeSource === 'all' ? styles.sourceToggleOn : ''}`}
            onClick={() => setSource('all')}
            aria-pressed={activeSource === 'all'}
            title="Show sets from both sites"
          >
            All <span className={styles.sourceCount}>{allSets.length}</span>
          </button>
          {SOURCES.map(src => (
            <button
              key={src}
              className={`${styles.sourceToggle} ${activeSource === src ? styles.sourceToggleOn : ''}`}
              onClick={() => setSource(src)}
              aria-pressed={activeSource === src}
              title={`Show only ${SOURCE_LABEL[src]} sets`}
            >
              {SOURCE_LABEL[src]} <span className={styles.sourceCount}>{sourceCounts[src]}</span>
            </button>
          ))}
        </div>
      )}
      <Select
        value={activeUploader}
        onChange={setUploader}
        searchable={uploaders.length > 5}
        options={[
          { value: 'all', label: `All uploaders (${sourceSets.length})`, icon: <User size={13} /> },
          ...uploaders.map(u => ({ value: u.value, label: u.label })),
        ]}
      />
      <TypeToggles value={types} onChange={setTypes} label="Artwork types to show and apply" className={styles.typeToggles} />
    </div>
  )
}
