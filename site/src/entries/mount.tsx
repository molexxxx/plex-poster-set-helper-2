import '@fontsource-variable/archivo/wdth.css'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/permanent-marker'
import '../styles/booth.css'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * Renders a page into the document's root element with the site's fonts and styles.
 *
 * @param page - The page element.
 */
export function mount(page: ReactNode)
{
  createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)
}
