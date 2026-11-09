import { describe, expect, it } from 'vitest'
import {
  availableUrls,
  freshHealth,
  noteFailure,
  parseRetryAfter,
  priceUrls,
  rateLimitLine,
  rememberOutliers,
  shortenRpcError,
} from '../src/lib/rpcHealth'

const url = 'https://rpc.elysium.kinetiq.xyz'

describe('RPC backoff', () => {
  it('honors Retry-After and logs once per window', () => {
    const header = parseRetryAfter('5', 0)
    expect(header).toBe(5_000)
    const first = noteFailure(freshHealth(url), 1_000, 'rate', header)
    expect(first.waitMs).toBe(5_000)
    expect(first.shouldLog).toBe(true)
    expect(first.health.backoffUntil).toBe(6_000)
    const again = noteFailure(first.health, 2_000, 'rate', null)
    expect(again.shouldLog).toBe(false)
    const after = noteFailure(first.health, 6_000, 'rate', null)
    expect(after.shouldLog).toBe(true)
  })

  it('grows the wait when the server does not say how long', () => {
    const first = noteFailure(freshHealth(url), 0, 'rate', null)
    expect(first.waitMs).toBe(2_000)
    const second = noteFailure(first.health, 3_000, 'rate', null)
    expect(second.waitMs).toBe(4_000)
  })

  it('parses an HTTP date and ignores junk', () => {
    expect(parseRetryAfter('not-a-date', 0)).toBeNull()
    const when = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', when - 4_000)).toBe(4_000)
  })

  it('skips a backed-off RPC and keeps price outliers off the price list', () => {
    const urls = ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example']
    const health = [{ ...freshHealth(urls[0]!), backoffUntil: 10_000, consecutive: 1, loggedUntil: 10_000 }]
    const now = 1_000
    expect(availableUrls(urls, health, now)).toEqual(urls.slice(1))
    const outliers = new Set([urls[1]!])
    expect(priceUrls(urls, health, outliers, now)).toEqual(urls.slice(2))
    const manyOut = new Set([urls[1]!, urls[2]!, urls[3]!])
    expect(priceUrls(urls, health, manyOut, now)).toEqual(urls.slice(1))
    const allAsleep = urls.map((item) => ({ ...freshHealth(item), backoffUntil: 50_000 }))
    expect(priceUrls(urls, allAsleep, new Set(), now)).toEqual([])
  })

  it('remembers an outlier until it is sampled again and the 429 text stays short', () => {
    const kept = rememberOutliers([], [{ url: 'https://b.example', outlier: true }], 0, 1_000)
    expect(kept).toEqual([{ url: 'https://b.example', until: 1_000 }])
    const still = rememberOutliers(kept, [{ url: 'https://c.example', outlier: false }], 500, 1_000)
    expect(still.map((row) => row.url)).toEqual(['https://b.example'])
    const cleared = rememberOutliers(kept, [{ url: 'https://b.example', outlier: false }], 500, 1_000)
    expect(cleared).toEqual([])
    const dump =
      'HTTP request failed. Status: 429 Rate Limit Exceeded. Request body: {"method":"eth_getLogs","params":[...]}'
    expect(shortenRpcError(dump)).toBe('bị giới hạn (429)')
    expect(rateLimitLine(url, 5_000)).toBe(
      'RPC rpc.elysium.kinetiq.xyz bị giới hạn (429). Nghỉ 5 giây rồi chuyển RPC khác.',
    )
  })
})
