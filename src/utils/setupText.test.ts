import { describe, it, expect } from 'vitest'
import type { BrowserInstallState } from '../../electron/ipc/types'
import { describeStage, ERROR_TITLES, FALLBACK_ERROR } from '../features/setup/setupText'

function state(over: Partial<BrowserInstallState>): BrowserInstallState
{
  return { stage: 'preparing', label: '', percent: null, attempt: 1, maxAttempts: 3, ...over }
}

describe('setup text', () =>
{
  it('names the install stage and what is in flight', () =>
  {
    expect(describeStage(null)).toBe('Starting…')
    expect(describeStage(state({ stage: 'downloading', label: 'Chromium Headless Shell 141' }))).toBe('Downloading Chromium Headless Shell 141')
    expect(describeStage(state({ stage: 'downloading', label: 'Downloading…' }))).toBe('Downloading…')
    expect(describeStage(state({ stage: 'extracting', label: '' }))).toBe('Extracting…')
    expect(describeStage(state({ stage: 'retrying', label: '' }))).toBe('Retrying…')
    expect(describeStage(state({ stage: 'retrying', label: 'Retrying in 5 s' }))).toBe('Retrying in 5 s')
  })

  it('has a title for every failure and a generic fallback', () =>
  {
    expect(ERROR_TITLES[FALLBACK_ERROR.kind]).toBe('Setup failed')
    expect(ERROR_TITLES.offline).toBe('No internet connection')
  })
})
