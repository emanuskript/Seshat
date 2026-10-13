import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/prisma.js', () => ({
  prisma: {}
}))

const { hashAccessToken, normalizeSessionAnnotations } = await import('./SessionService.js')

describe('normalizeSessionAnnotations', () => {
  it('stores legacy measure annotations under the canonical angles key', () => {
    const normalized = normalizeSessionAnnotations({
      highlights: [{ id: 'h1' }],
      angles: [{ id: 'a1', label: 'T' }],
      measures: [
        { id: 'a1', label: 'duplicate T' },
        { id: 'a2', label: 'U' }
      ],
      settings: {
        angleLabels: ['T', 'U']
      }
    })

    expect(normalized.measures).toBeUndefined()
    expect(normalized.angles).toEqual([
      { id: 'a1', label: 'T' },
      { id: 'a2', label: 'U' }
    ])
    expect(normalized.settings.angleLabels).toEqual(['T', 'U'])
  })
})

describe('session access tokens', () => {
  it('stores a deterministic SHA-256 digest rather than the bearer token', () => {
    const token = 'test-token-that-is-long-enough-to-be-a-capability'
    const digest = hashAccessToken(token)

    expect(digest).toHaveLength(64)
    expect(digest).toMatch(/^[0-9a-f]+$/)
    expect(digest).not.toContain(token)
    expect(hashAccessToken(token)).toBe(digest)
  })
})
