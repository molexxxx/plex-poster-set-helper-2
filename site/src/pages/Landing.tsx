import { useEffect, useState } from 'react'
import { BoothLog } from '../components/BoothLog'
import { Credits } from '../components/Credits'
import { FilmCarousel } from '../components/FilmCarousel'
import { ReelLabel } from '../components/ReelLabel'
import { useMedia } from '../lib/useMedia'

/** The landing page: the film strip carousel and reel label, the install table, and the credits. */
export function Landing()
{
  const narrow = useMedia('(max-width: 760px)')
  const [labelGone, setLabelGone] = useState(false)

  useEffect(() =>
  {
    const label = document.getElementById('get')
    const install = document.getElementById('install')
    const footer = document.querySelector('.footer-body')
    if (!label || !install) return
    let labelOut = false
    let installIn = false
    let footerIn = false
    const watch = new IntersectionObserver(entries =>
    {
      for (const e of entries)
      {
        if (e.target === label) labelOut = !e.isIntersecting
        if (e.target === install) installIn = e.isIntersecting
        if (e.target === footer) footerIn = e.isIntersecting
      }
      setLabelGone(labelOut && !installIn && !footerIn)
    })
    watch.observe(label)
    watch.observe(install)
    if (footer) watch.observe(footer)
    return () => watch.disconnect()
  }, [])

  return (
    <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <FilmCarousel />
        <div className="hero-copy">
          <div className="hero-text">
            <h1 id="hero-title">Every title in your Plex library, <em>in the art the community made for it.</em></h1>
            <p className="lede">MediUX and ThePosterDB sets side by side, ranked by downloads, applied in one click and kept current on a schedule.</p>
          </div>
          <ReelLabel id="get" />
        </div>
      </section>
      <BoothLog />
      <Credits />
      {labelGone && <ReelLabel compact docked={!narrow} />}
    </main>
  )
}
