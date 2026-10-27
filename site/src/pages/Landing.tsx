import { useEffect, useState } from 'react'
import { BoothLog } from '../components/BoothLog'
import { Credits } from '../components/Credits'
import { Footer } from '../components/Footer'
import { Header } from '../components/Header'
import { HeroStrip } from '../components/HeroStrip'
import { Reel } from '../components/Reel'
import { ReelLabel } from '../components/ReelLabel'
import { frames } from '../data/frames'
import { useMedia } from '../lib/useMedia'

/** The landing page: the lit strip and reel label, the reel, the install table, and the credits. */
export function Landing()
{
  const narrow = useMedia('(max-width: 760px)')
  const [labelGone, setLabelGone] = useState(false)

  useEffect(() =>
  {
    const label = document.getElementById('get')
    const install = document.getElementById('install')
    if (!label || !install) return
    let labelOut = false
    let installIn = false
    const sync = () => setLabelGone(labelOut && !installIn)
    const watch = new IntersectionObserver(entries =>
    {
      for (const e of entries)
      {
        if (e.target === label) labelOut = !e.isIntersecting
        if (e.target === install) installIn = e.isIntersecting
      }
      sync()
    })
    watch.observe(label)
    watch.observe(install)
    return () => watch.disconnect()
  }, [])

  return (
    <>
      <Header current="overview" />
      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <HeroStrip />
          <div className="hero-copy">
            <div className="hero-text">
              <h1 id="hero-title">Every title in your Plex library, <em>in the art the community made for it.</em></h1>
              <p className="lede">MediUX and ThePosterDB sets side by side, ranked by downloads, applied in one click and kept current on a schedule.</p>
            </div>
            <ReelLabel id="get" />
          </div>
        </section>
        <Reel frames={frames} />
        <BoothLog />
        <Credits />
      </main>
      <Footer />
      {labelGone && <ReelLabel compact docked={!narrow} />}
    </>
  )
}
