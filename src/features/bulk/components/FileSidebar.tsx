import { AnimatePresence, motion } from 'framer-motion'
import { FilePlus2, Trash2, FileText, Pencil, Check } from 'lucide-react'
import { displayName } from '../bulkText'
import type { BulkFiles } from '../hooks/useBulkFiles'
import RenameInput from './RenameInput'
import shared from './bulkShared.module.css'
import styles from './FileSidebar.module.css'


interface FileSidebarProps {
  bulk: BulkFiles
}


/** The bulk file list: new file, open, rename, and delete. */
export default function FileSidebar({ bulk }: FileSidebarProps) {
  const {
    files, active, renaming, setRenaming, newFileName, setNewFile, showNewInput, setShowNew, newInputRef,
    selectFile, createFile, renameFile, deleteFile,
  } = bulk

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <span className="page-title">Files</span>
        <button
          className={shared.iconBtn}
          title="New file"
          onClick={() => setShowNew(v => !v)}
        >
          <FilePlus2 size={14} />
        </button>
      </div>

      {/* new file input */}
      <AnimatePresence>
        {showNewInput && (
          <motion.div
            className={styles.newFileRow}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            <input
              ref={newInputRef}
              className={shared.renameInput}
              value={newFileName}
              onChange={e => setNewFile(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') createFile()
                if (e.key === 'Escape') { setShowNew(false); setNewFile('') }
              }}
              placeholder="file name"
              spellCheck={false}
            />
            <button className={shared.iconBtn} onClick={createFile}><Check size={12} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* file list */}
      <div className={styles.fileList}>
        {files.length === 0 && !showNewInput && (
          <p className={styles.noFiles}>No files yet</p>
        )}
        <AnimatePresence initial={false}>
          {files.map(f => (
            <motion.div
              key={f}
              className={`${styles.fileItem} ${active === f ? styles.fileActive : ''}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.15 }}
            >
              {renaming === f ? (
                <RenameInput
                  initial={f}
                  onConfirm={newName => renameFile(f, newName)}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <>
                  <button
                    className={styles.fileBtn}
                    onClick={() => selectFile(f)}
                  >
                    <FileText size={13} className={styles.fileIcon} />
                    <span className={styles.fileName}>{displayName(f)}</span>
                  </button>
                  <div className={styles.fileActions}>
                    <button
                      className={shared.iconBtn}
                      title="Rename"
                      onClick={e => { e.stopPropagation(); setRenaming(f) }}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      className={`${shared.iconBtn} ${shared.iconBtnDestructive}`}
                      title="Delete"
                      onClick={e => { e.stopPropagation(); deleteFile(f) }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </aside>
  )
}
