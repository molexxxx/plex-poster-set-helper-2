import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { displayName } from '../bulkText'
import shared from './bulkShared.module.css'
import styles from './RenameInput.module.css'


/** Inline rename field for a bulk file. */
export default function RenameInput({
  initial,
  onConfirm,
  onCancel,
}: {
  initial: string
  onConfirm: (v: string) => void
  onCancel: () => void
})
{
  const [value, setValue] = useState(displayName(initial))
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.select() }, [])

  function submit()
  {
    const v = value.trim()
    if (v && v !== displayName(initial)) onConfirm(v)
    else onCancel()
  }

  return (
    <div className={styles.renameRow}>
      <input
        ref={ref}
        className={shared.renameInput}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e =>
        {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
        spellCheck={false}
        autoFocus
      />
      <button className={shared.iconBtn} onClick={submit}><Check size={12} /></button>
      <button className={shared.iconBtn} onClick={onCancel}><X size={12} /></button>
    </div>
  )
}
