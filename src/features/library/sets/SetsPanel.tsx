import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Download, Eye, EyeOff, Library } from 'lucide-react'
import type { LibraryItem, PosterSetSummary, SetSource } from '../../../../electron/ipc/types'
import { ALL_TYPES, setKey } from '../../../utils/posterGroups'
import { useCreatorPrefs } from '../../../utils/creatorPrefs'
import { arrangeSets, mergeLinkedSets, uploaderValue } from '../../../utils/librarySets'
import { appliedKey } from '../../../utils/appliedTracker'
import { errorMessage } from '../../../utils/errorMessage'
import { artworkOverride, coveringJob, describeArtworkTypes, describeCron } from '../../../../electron/services/scheduleUtils'
import { useSmoothScroll } from '../../../app/useSmoothScroll'
import { useBrowseSets } from './hooks/useBrowseSets'
import { useCurrentArt } from './hooks/useCurrentArt'
import { useLinkedSets } from './hooks/useLinkedSets'
import { usePanelSettings } from './hooks/usePanelSettings'
import { useSetSchedule } from './hooks/useSetSchedule'
import { useCollectionMembership } from './hooks/useCollectionMembership'
import { useSetApply } from './hooks/useSetApply'
import PanelHeader from './components/PanelHeader'
import CurrentArtStrip from './components/CurrentArtStrip'
import LinkSetRow from './components/LinkSetRow'
import SetFilters from './components/SetFilters'
import PanelNotices from './components/PanelNotices'
import SetCard from './components/SetCard'
import styles from './SetsPanel.module.css'

/** The sets panel beside the grid: the item's current art, then its MediUX and ThePosterDB sets to filter, apply, and schedule. */
export default function SetsPanel({ item, onClose, onItemPoster }: {
  item: LibraryItem
  onClose: () => void
  onItemPoster: (key: string, thumb: string) => void
}) {
  const [uploader, setUploader] = useState<string>('all')
  const [source, setSource]     = useState<SetSource | 'all'>('all')
  // Reveals hidden creators' sets for this title, until the next title.
  const [showHidden, setShowHidden] = useState(false)
  const { stateOf, setState: setCreatorState } = useCreatorPrefs()
  const [creatorError, setCreatorError] = useState<string | null>(null)
  const browse = useBrowseSets(item)
  const { sets, loading, error, setsReloadKey, resolvedTmdbId, collectionMembers } = browse
  const { artSlots, artLoading, bumpArtReload } = useCurrentArt(item)
  const links = useLinkedSets(item, setsReloadKey)
  const { linked, linkOpen, unlink } = links
  const { hasTmdbKey, types, setTypes, settingsTypes, quickCron, resizing, startPanelResize, resetPanelWidth } = usePanelSettings()
  const { coverage, schedulingId, setSchedulingId, scheduleError, scheduleSet, openScheduledJob } = useSetSchedule(item, types, settingsTypes, quickCron)
  // Everything the panel lists: linked sets first, then what the sites found.
  const allSets = useMemo(() => mergeLinkedSets(linked, sets), [linked, sets])
  const { memberInLib, collectionInPlex } = useCollectionMembership(item, allSets, resolvedTmdbId, collectionMembers)
  const { applyMap, setApplyMap, setCollectionScope, picks, setPickState, appliedIdx, scopeOf, applySet } = useSetApply({
    item, types, memberInLib, collectionInPlex, collectionMembers, resolvedTmdbId, onItemPoster, bumpArtReload,
  })
  const panelBodyRef = useRef<HTMLDivElement>(null)
  useSmoothScroll(panelBodyRef)

  // The panel chrome no longer remounts per item (see the parent's stable
  // "sets-panel" key), so per-item UI state that used to reset for free via
  // remount needs an explicit reset here. `sets`/`error`/`loading`/`artSlots`/
  // etc. already key their own effects off item.key and don't need to be
  // listed - only genuinely transient UI state does.
  useEffect(() => {
    setUploader('all')
    setSource('all')
    setShowHidden(false)
    setApplyMap({})
    setCollectionScope({})
    setSchedulingId(null)
    panelBodyRef.current?.scrollTo({ top: 0 })
  }, [item.key, setApplyMap, setCollectionScope, setSchedulingId])

  const isCollectionItem = item.type === 'collection'
  const itemApplied = isCollectionItem
    ? appliedIdx.currentByItem.has(item.key)
    : appliedIdx.titles.has(appliedKey(item.title, item.year))

  const creatorOf = useCallback((s: PosterSetSummary) => stateOf(s.source, s.uploader), [stateOf])

  // Filters and creator preferences are applied in one tested helper, so the
  // dropdown, the list and the hidden count always agree. A stale choice (an
  // uploader hidden since, a site that returned nothing) falls back to "all"
  // in the same render instead of flashing an empty list first.
  const { sourceCounts, activeSource, sourceSets, uploaders, activeUploader, visibleSets, hiddenCount } = useMemo(
    () => arrangeSets(allSets, { source, uploader, types, showHidden, stateOf }),
    [allSets, source, uploader, types, showHidden, stateOf],
  )

  return (
    <motion.div
      className={styles.panel}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.3 }}
    >
      <div
        className={`${styles.panelResizeHandle} ${resizing ? styles.panelResizeHandleActive : ''}`}
        onMouseDown={startPanelResize}
        onDoubleClick={resetPanelWidth}
        title="Drag to resize · double-click to reset"
      >
        <span className={styles.panelResizeGrip} />
      </div>
      <PanelHeader item={item} isCollectionItem={isCollectionItem} browse={browse} links={links} onClose={onClose} />
      <CurrentArtStrip slots={artSlots} loading={artLoading} />

      {linkOpen && <LinkSetRow links={links} />}
      {/* Filters */}
      {!loading && !error && allSets.length > 0 && (
        <SetFilters
          sourceCounts={sourceCounts}
          activeSource={activeSource}
          setSource={setSource}
          allSets={allSets}
          uploaders={uploaders}
          activeUploader={activeUploader}
          setUploader={setUploader}
          sourceSets={sourceSets}
          types={types}
          setTypes={setTypes}
        />
      )}

      {/* Body. Scroll position and content fade both key off item.key since
          this container - like the panel itself - now persists across item
          switches instead of remounting. */}
      <div className={styles.panelBody} ref={panelBodyRef}>
        <motion.div
          key={item.key}
          className={styles.panelBodyInner}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
        >
        <PanelNotices
          item={item}
          isCollectionItem={isCollectionItem}
          browse={browse}
          links={links}
          creatorError={creatorError}
          hasTmdbKey={hasTmdbKey}
          allSets={allSets}
          visibleSets={visibleSets}
          hiddenCount={hiddenCount}
        />
        {visibleSets.map(s => {
          const sKey = setKey(s)
          // "Applied" = the set currently live on this item; "Downloaded" = a set
          // applied before but since overwritten; "Has art" = title has art elsewhere.
          const isCurrent = appliedIdx.currentByItem.get(item.key) === sKey
          const badge = isCurrent
            ? <span className={styles.matchBadge}><CheckCircle2 size={11} /> Applied</span>
            : appliedIdx.setKeys.has(sKey)
              ? <span className={styles.downloadedBadge}><Download size={11} /> Downloaded</span>
              : itemApplied
                ? <span className={styles.scheduledBadge}><Library size={11} /> Has art</span>
                : undefined
          const { moviesInLib, moviesTotal, hasCollectionArt, collectionMissing, defaultScope, scope: applyScope, showScope } = scopeOf(s)
          const scheduledBy = coveringJob(coverage, s.id, s.uploader, s.source)
          return (
            <SetCard
              key={sKey}
              set={s}
              apply={applyMap[sKey]}
              onApply={() => applySet(s)}
              enabledTypes={types}
              creator={creatorOf(s)}
              onCreatorChange={state => {
                // Hiding the creator the dropdown is narrowed to would leave
                // an empty list, and the stale choice would resurface on Show.
                if (state === 'hidden' && uploaderValue(s) === uploader) setUploader('all')
                setCreatorError(null)
                setCreatorState(s.source, s.uploader, state).catch((err: unknown) => setCreatorError(errorMessage(err)))
              }}
              showSource
              badge={badge}
              onSchedule={() => scheduleSet(s)}
              scheduledBy={scheduledBy ? `${scheduledBy.name} · ${describeCron(scheduledBy.cronExpr)}` : undefined}
              onOpenSchedule={scheduledBy ? () => openScheduledJob(scheduledBy.id) : undefined}
              scheduleHint={artworkOverride(types, settingsTypes) ? `${describeCron(quickCron)}, ${types.size === ALL_TYPES.length ? 'every artwork type' : `${describeArtworkTypes(types)} only`}` : describeCron(quickCron)}
              scheduleError={scheduleError?.setId === sKey ? scheduleError.message : undefined}
              scheduling={schedulingId === sKey}
              collectionMovies={moviesInLib}
              collectionTotal={moviesTotal}
              hasCollectionArt={hasCollectionArt}
              collectionMissing={collectionMissing}
              applyScope={showScope ? applyScope : undefined}
              scopeContext={isCollectionItem ? 'collection' : 'movie'}
              onApplyScopeChange={showScope ? (patch) => {
                setCollectionScope(m => ({
                  ...m,
                  [sKey]: { ...(m[sKey] ?? defaultScope), ...patch },
                }))
                setApplyMap(m => { const next = { ...m }; delete next[sKey]; return next })
              } : undefined}
              linked={!!s.linkedFrom}
              onUnlink={s.linkedFrom ? () => unlink(s.linkedFrom!) : undefined}
              variantContext={isCollectionItem ? 'collection' : 'title'}
              itemTitle={item.title}
              picks={picks[sKey]}
              onPick={(slot, url) => {
                setPickState(prev => {
                  const bySet = prev.key === item.key ? prev.bySet : {}
                  return { key: item.key, bySet: { ...bySet, [sKey]: { ...(bySet[sKey] ?? {}), [slot]: url } } }
                })
                setApplyMap(m => { const next = { ...m }; delete next[sKey]; return next })
              }}
            />
          )
        })}

        {/* Hidden creators' sets are tucked away, not deleted: say how many
            there are so a short list isn't mistaken for a short catalog. */}
        {!loading && !error && hiddenCount > 0 && (
          <button className={styles.hiddenToggle} onClick={() => setShowHidden(v => !v)}>
            {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
            {showHidden
              ? `Showing ${hiddenCount} set${hiddenCount !== 1 ? 's' : ''} from hidden creators · Hide`
              : `${hiddenCount} set${hiddenCount !== 1 ? 's' : ''} from hidden creators · Show`}
          </button>
        )}
        </motion.div>
      </div>
    </motion.div>
  )
}
