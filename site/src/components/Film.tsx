import { Icon } from './Icon'
import { Shot, type Picture } from './Shot'

/** The strip's frame width: 1.5 times its height, at most 600px, and 84vw on phones. */
const FRAME_SIZES = '(max-width: 760px) 84vw, 600px'

/** A row of sprocket holes at 35mm pitch, sized from the strip's frame height. */
export function Perfs({ edge }: { edge: 'top' | 'bottom' })
{
  return <div className={`perfs perfs-${edge}`} aria-hidden="true" />
}

/**
 * One frame on the strip with the latent print on its edges, so key numbers
 * and the screen's own facts travel with the frame.
 *
 * @param props.shot - The screen shown in the frame.
 * @param props.alt - What the screen shows.
 * @param props.lit - Whether the lamp is on this frame.
 * @param props.top - Edge print above the frame: its key number and name.
 * @param props.bottom - Edge print below the frame: what the screen shows.
 * @param props.cue - Changes whenever the cue dot should flash again.
 * @param props.onEnlarge - Opens the lit frame full size; adds its button.
 */
export function Frame({ shot, alt, lit, top, bottom, cue, index, loading, onEnlarge }: {
  shot: Picture
  alt: string
  lit?: boolean
  top?: string
  bottom?: string
  cue?: number
  index?: number
  loading?: 'eager' | 'lazy'
  onEnlarge?: () => void
})
{
  return (
    <div className={`slot${lit ? ' slot-lit' : ''}`} data-index={index}>
      {top && <span className="slot-edge slot-edge-top" aria-hidden="true">{top}</span>}
      <div className={`frame${lit ? ' frame-lit' : ''}`}>
        <Shot className="frame-shot" picture={shot} alt={alt} sizes={FRAME_SIZES} loading={loading} />
        {lit && <span key={cue} className="cue-dot" aria-hidden="true" />}
        {lit && onEnlarge && (
          <button type="button" className="carousel-button frame-enlarge" aria-label="Enlarge this screen"
            onPointerDown={e => e.stopPropagation()} onClick={onEnlarge}>
            <Icon name="enlarge" />
          </button>
        )}
      </div>
      {bottom && <span className="slot-edge slot-edge-bottom" aria-hidden="true">{bottom}</span>}
    </div>
  )
}
