/**
 * Copies text to the clipboard. The async Clipboard API exists only in secure
 * contexts, and the Docker web UI is usually served over plain HTTP, so this
 * falls back to a hidden text area and the copy command there.
 *
 * @param text - Text to copy.
 * @returns Whether the copy succeeded.
 */
export async function copyText(text: string): Promise<boolean>
{
  if (navigator.clipboard && window.isSecureContext)
  {
    try
    {
      await navigator.clipboard.writeText(text)
      return true
    }
    catch
    {
      /* fall back below */
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(area)
  area.select()
  let ok: boolean
  try
  {
    ok = document.execCommand('copy')
  }
  catch
  {
    ok = false
  }
  area.remove()
  active?.focus?.()
  return ok
}
