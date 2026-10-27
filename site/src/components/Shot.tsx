/** A screenshot imported with `?ladder`: a srcset per format, plus the largest fallback image. */
export interface Picture
{
  sources: Record<string, string>
  img: { src: string; w: number; h: number }
}

/**
 * A screenshot ladder, so the browser fetches the rung that fits the space
 * instead of scaling a full-size capture. It can't be dragged out or
 * selected, so it behaves as part of whatever holds it.
 *
 * @param props.sizes - The rendered width, as an `<img sizes>` value.
 */
export function Shot({ picture, alt, sizes, className, loading = 'eager', hidden }: {
  picture: Picture
  alt: string
  sizes: string
  className?: string
  loading?: 'eager' | 'lazy'
  hidden?: boolean
})
{
  return (
    <picture className={className} hidden={hidden}>
      {Object.entries(picture.sources).map(([format, srcSet]) => (
        <source key={format} type={`image/${format}`} srcSet={srcSet} sizes={sizes} />
      ))}
      <img src={picture.img.src} width={picture.img.w} height={picture.img.h} alt={alt} loading={loading} decoding="async" draggable={false} />
    </picture>
  )
}
