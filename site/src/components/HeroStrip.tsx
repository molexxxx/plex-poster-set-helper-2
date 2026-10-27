import { frames } from '../data/frames'
import { release, isoDay } from '../data/release'
import { Frame, Perfs } from './Film'

const find = (id: string) => frames.find(f => f.id === id)!
const strip = [find('creators'), find('import'), find('library'), find('scheduler')]

/** The first viewport's strip: the real Library Browser lit, three other screens dimmed beside it, numbered in strip order. */
export function HeroStrip()
{
  const day = isoDay(release.date)
  return (
    <div className="strip strip-hero">
      <Perfs edge="top" />
      <div className="strip-track strip-track-hero">
        {strip.map((f, i) =>
        {
          const key = 21 + i
          const lit = f.id === 'library'
          const top = lit
            ? [String(key), `V${release.version}`, day, `${key}A`].filter(Boolean).join(' ▸ ')
            : [String(key), f.label.toUpperCase(), `${key}A`].join(' ▸ ')
          return (
            <Frame
              key={f.id}
              src={lit ? f.full : f.thumb}
              alt={lit ? f.alt : ''}
              lit={lit}
              top={top}
              bottom={f.edge.toUpperCase()}
              focus={lit ? undefined : f.focus}
            />
          )
        })}
      </div>
      <Perfs edge="bottom" />
    </div>
  )
}
