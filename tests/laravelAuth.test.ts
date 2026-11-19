import { describe, expect, it } from 'vitest'
import { AUTH_SCRIPT, parseAuthOutput } from '../src/main/laravelAuth'

describe('log in as (Laravel)', () => {
  it('reads the result line even with warnings around it', () => {
    const out = 'PHP Deprecated: something\n\n__SPINDLE__{"total":2,"users":[{"id":"1","name":"Ada","email":"ada@example.com","role":"admin"}]}\n'
    expect(parseAuthOutput<{ total: number }>(out).total).toBe(2)
  })
  it('turns script errors and missing output into readable messages', () => {
    expect(() => parseAuthOutput('__SPINDLE__{"error":"This is a production environment"}')).toThrow(/production/)
    expect(() => parseAuthOutput('', 'PHP Fatal error: Class "X" not found')).toThrow(/Class "X" not found/)
  })
  it('refuses production and cookie-less session drivers', () => {
    expect(AUTH_SCRIPT).toContain("environment('production')")
    expect(AUTH_SCRIPT).toMatch(/\['array', 'cookie'\]/)
  })
})
