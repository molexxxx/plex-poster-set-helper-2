import type { Dispatch, SetStateAction } from 'react'
import { CalendarClock } from 'lucide-react'
import Button from '../../../components/ui/Button'
import type { MediuxUserSet } from '../../../../electron/ipc/types'
import type { SyncScope } from './CreatorSyncDialog'
import { plural } from './catalogUtils'
import shared from './catalogShared.module.css'
import styles from './SelectBar.module.css'

interface SelectBarProps
{
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  /** The sets on this page that match the library, which Select all picks. */
  pageSelectable: MediuxUserSet[]
  selectedSets: MediuxUserSet[]
  setSyncScope: (scope: SyncScope) => void
}

/** The selection bar: how many sets are picked, Select all on this page, Clear, and Sync. */
export default function SelectBar({ selected, setSelected, pageSelectable, selectedSets, setSyncScope }: SelectBarProps)
{
  return (
    <div className={styles.selectBar}>
      <span className={styles.selectCount}>
        {selected.size ? `${plural(selected.size, 'set')} selected` : 'Pick sets to sync on a schedule'}
      </span>
      <button type="button" className={shared.inlineAction} onClick={() => setSelected(prev => new Set([...prev, ...pageSelectable.map(s => s.id)]))} disabled={!pageSelectable.length}>
        Select all on this page
      </button>
      <button type="button" className={shared.inlineAction} onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear</button>
      <Button variant="primary" size="sm" icon={<CalendarClock size={12} />} disabled={!selected.size} onClick={() => setSyncScope({ kind: 'sets', sets: selectedSets })}>
        {selected.size ? `Sync ${plural(selected.size, 'set')}…` : 'Sync selected…'}
      </Button>
    </div>
  )
}
