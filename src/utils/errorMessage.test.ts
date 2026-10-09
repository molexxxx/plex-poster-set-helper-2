import { describe, it, expect } from 'vitest'
import { errorMessage } from './errorMessage'

describe('errorMessage', () =>
{
  it('strips the Electron IPC wrapper and error name', () =>
  {
    const err = new Error("Error invoking remote method 'scheduler:save': ScheduleValidationError: Give the job a name")
    expect(errorMessage(err)).toBe('Give the job a name')
  })

  it('passes plain messages and strings through', () =>
  {
    expect(errorMessage(new Error('Not connected to Plex'))).toBe('Not connected to Plex')
    expect(errorMessage('Rate limit exceeded')).toBe('Rate limit exceeded')
  })

  it('falls back when there is no message', () =>
  {
    expect(errorMessage(new Error(''))).toBe('Something went wrong')
  })
})
