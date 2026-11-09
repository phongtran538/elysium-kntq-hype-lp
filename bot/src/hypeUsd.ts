const URL = 'https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd'
let cache: { at: number; usd: number | null } = { at: 0, usd: null }

/** CoinGecko HYPE/USD. Cached 5 minutes. Null if the request fails. */
export async function fetchHypeUsd(now = Date.now()): Promise<number | null> {
  if (cache.usd != null && now - cache.at < 5 * 60_000) return cache.usd
  if (cache.usd == null && now - cache.at < 60_000) return null
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) throw new Error(String(res.status))
    const body = (await res.json()) as { hyperliquid?: { usd?: number } }
    const usd = body.hyperliquid?.usd
    if (typeof usd === 'number' && usd > 0) {
      cache = { at: now, usd }
      return usd
    }
  } catch {
    cache = { at: now, usd: cache.usd }
  }
  return cache.usd
}

export function setHypeUsdForTests(usd: number | null): void {
  cache = { at: Date.now(), usd }
}
