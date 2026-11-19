import type { BrowserInstallError, BrowserInstallState } from '../../../electron/ipc/types'

/** Headline for each way the browser setup can fail. */
export const ERROR_TITLES: Record<BrowserInstallError['kind'], string> = {
  offline: 'No internet connection',
  network: 'Download interrupted',
  blocked: 'Download blocked',
  disk: 'Not enough disk space',
  permission: 'Folder not writable',
  antivirus: 'Files were blocked',
  'missing-deps': 'System libraries missing',
  launch: 'Chromium could not start',
  cancelled: 'Setup cancelled',
  unknown: 'Setup failed',
}

const STAGE_VERBS: Partial<Record<BrowserInstallState['stage'], string>> = {
  preparing: 'Preparing',
  downloading: 'Downloading',
  extracting: 'Extracting',
  verifying: 'Verifying',
  retrying: 'Retrying',
}

/** The error shown when setup fails without saying why. */
export const FALLBACK_ERROR: BrowserInstallError = {
  kind: 'unknown',
  message: 'Setup failed',
  hint: 'Retry, or check the log for details.',
}

/**
 * Headline for the install block: the stage verb plus the item in flight.
 *
 * @param state - Latest install state from the main process.
 * @returns Text such as "Downloading Chromium Headless Shell 141".
 */
export function describeStage(state: BrowserInstallState | null): string
{
  if (!state) return 'Starting…'
  const verb = STAGE_VERBS[state.stage] ?? 'Working'
  if (state.stage === 'retrying') return state.label || 'Retrying…'
  if (state.stage === 'downloading' && state.label && !state.label.endsWith('…')) return `${verb} ${state.label}`
  return state.label || `${verb}…`
}
