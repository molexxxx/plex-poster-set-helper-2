import { useEffect, useState } from 'react'
import type { CronPreview } from '../../../../electron/ipc/types'
/**
 * Asks the scheduler to evaluate an expression, debounced while the user types.
 *
 * @param expr - Cron expression.
 * @returns The latest preview, and whether it belongs to `expr` yet.
 */
export function useCronPreview(expr: string): { preview: CronPreview | null; current: boolean }
{
  const [result, setResult] = useState<{ expr: string; preview: CronPreview } | null>(null)
  useEffect(() =>
  {
    let cancelled = false
    const t = setTimeout(() =>
    {
      window.api.scheduler.preview(expr)
        .then(preview => { if (!cancelled) setResult({ expr, preview }) })
        .catch(() => { /* preview is advisory; the save call validates */ })
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [expr])
  return { preview: result?.preview ?? null, current: result?.expr === expr }
}
