/** Pure RPC health. No network. Callers persist nothing; the map lives in the process. */

export type RpcHealth = {
  url: string
  consecutive: number
  backoffUntil: number
  /** Log at most once until this time (the end of the backoff window). */
  loggedUntil: number
}

export type OutlierMark = {
  url: string
  until: number
}

export function freshHealth(url: string): RpcHealth {
  return { url, consecutive: 0, backoffUntil: 0, loggedUntil: 0 }
}

export function isRateLimitMessage(message: string): boolean {
  return /429|rate limit|too many requests/i.test(message)
}

export function isTimeoutMessage(message: string): boolean {
  return /timeout|timed out|took too long|aborted|headers timeout/i.test(message)
}

/** Short text for UI and logs. Never includes the JSON-RPC body. */
export function shortenRpcError(message: string): string {
  if (isRateLimitMessage(message)) return 'bị giới hạn (429)'
  if (isTimeoutMessage(message)) return 'hết giờ'
  const flat = message.replace(/\s+/g, ' ').split(/request body/i)[0]?.trim() || message
  return flat.slice(0, 80)
}

export function rateLimitLine(url: string, waitMs: number): string {
  const sec = Math.max(1, Math.round(waitMs / 1000))
  return `RPC ${hostOf(url)} bị giới hạn (429). Nghỉ ${sec} giây rồi chuyển RPC khác.`
}

export function timeoutLine(url: string, waitMs: number): string {
  const sec = Math.max(1, Math.round(waitMs / 1000))
  return `RPC ${hostOf(url)} hết giờ. Nghỉ ${sec} giây rồi chuyển RPC khác.`
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Retry-After is either seconds or an HTTP date. Null when the header is missing or junk. */
export function parseRetryAfter(header: string | null | undefined, now: number): number | null {
  if (header == null) return null
  const text = header.trim()
  if (!text) return null
  const seconds = Number(text)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 10 * 60_000)
  }
  const date = Date.parse(text)
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - now, 10 * 60_000))
  return null
}

function exponentialMs(consecutive: number, base: number, cap: number): number {
  const exp = base * 2 ** Math.min(consecutive, 8)
  return Math.min(cap, exp)
}

/**
 * Record a 429 or a timeout. `retryAfterMs` wins over the exponential wait when the
 * server sent Retry-After. `shouldLog` is true once per URL per backoff window.
 */
export function noteFailure(
  health: RpcHealth,
  now: number,
  kind: 'rate' | 'timeout',
  retryAfterMs?: number | null,
): { health: RpcHealth; shouldLog: boolean; waitMs: number } {
  const computed =
    kind === 'timeout'
      ? exponentialMs(health.consecutive, 4_000, 30_000)
      : exponentialMs(health.consecutive, 2_000, 5 * 60_000)
  const header = retryAfterMs != null && retryAfterMs > 0 ? retryAfterMs : null
  const waitMs = Math.min(header ?? computed, 10 * 60_000)
  const shouldLog = now >= health.loggedUntil
  return {
    health: {
      ...health,
      consecutive: health.consecutive + 1,
      backoffUntil: now + waitMs,
      loggedUntil: shouldLog ? now + waitMs : health.loggedUntil,
    },
    shouldLog,
    waitMs,
  }
}

export function noteSuccess(health: RpcHealth): RpcHealth {
  if (health.consecutive === 0 && health.backoffUntil === 0) return health
  return { ...health, consecutive: 0, backoffUntil: 0 }
}

/** URLs that are not inside a backoff window, in the original order. */
export function availableUrls(
  urls: readonly string[],
  health: readonly RpcHealth[],
  now: number,
): string[] {
  const until = new Map(health.map((row) => [row.url, row.backoffUntil]))
  return urls.filter((url) => (until.get(url) ?? 0) <= now)
}

/**
 * Price reads skip URLs flagged as outliers when at least 3 others are usable.
 * Logs and balances use `availableUrls` instead, so an outlier can still serve them.
 * An empty list means every URL is in backoff: do not call.
 */
export function priceUrls(
  urls: readonly string[],
  health: readonly RpcHealth[],
  outliers: ReadonlySet<string>,
  now: number,
): string[] {
  const open = availableUrls(urls, health, now)
  const clean = open.filter((url) => !outliers.has(url))
  if (clean.length >= 3) return clean
  return open
}

export function rememberOutliers(
  current: readonly OutlierMark[],
  samples: readonly { url: string; outlier?: boolean }[],
  now: number,
  ttlMs = 10 * 60_000,
): OutlierMark[] {
  const seen = new Set(samples.map((sample) => sample.url))
  const next = new Map<string, number>()
  for (const row of current) {
    if (row.until <= now) continue
    if (seen.has(row.url)) continue
    next.set(row.url, row.until)
  }
  for (const sample of samples) {
    if (sample.outlier) next.set(sample.url, now + ttlMs)
  }
  return [...next.entries()].map(([url, until]) => ({ url, until }))
}
