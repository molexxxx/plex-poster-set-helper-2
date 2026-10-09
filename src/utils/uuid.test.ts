import { describe, it, expect, afterEach, vi } from 'vitest'
import { uuid } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuid', () =>
{
  afterEach(() =>
  {
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when it is available', () =>
  {
    expect(uuid()).toMatch(V4)
  })

  it('falls back to getRandomValues outside a secure context', () =>
  {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    const ids = new Set(Array.from({ length: 100 }, () => uuid()))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(V4)
  })
})
