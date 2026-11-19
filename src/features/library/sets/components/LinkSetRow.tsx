import { Link2, Loader2, Plus } from 'lucide-react'
import type { LinkedSets } from '../hooks/useLinkedSets'
import shared from '../../libraryShared.module.css'
import styles from './LinkSetRow.module.css'

/** The link-a-set row: a field for a MediUX or ThePosterDB link whose sets join the title's list. */
export default function LinkSetRow({ links }: { links: LinkedSets })
{
  const { linkInputRef, linkUrl, updateLinkUi, linking, linkError, submitLink } = links
  return (
    <form className={styles.linkRow} onSubmit={e => { e.preventDefault(); void submitLink() }}>
      <span className={styles.addLabel}>Link a set to this title</span>
      <div className={styles.addField}>
        <Link2 size={14} className={styles.addIcon} />
        <input
          ref={linkInputRef}
          className={styles.addInput}
          placeholder="MediUX or ThePosterDB link: a set, a poster, or the title's own page"
          value={linkUrl}
          onChange={e => updateLinkUi({ url: e.target.value })}
          spellCheck={false}
        />
        <button type="submit" className={styles.addBtn} disabled={!linkUrl.trim() || linking} title="Add">
          {linking ? <Loader2 size={14} className={shared.spin} /> : <Plus size={14} />}
        </button>
      </div>
      {linkError && <p className={styles.addError}>{linkError}</p>}
      <p className={styles.linkHint}>
        The sets behind the link join this title&apos;s list and are remembered. Paste the title&apos;s own page on either site to use every set listed there.
      </p>
    </form>
  )
}
