import { createPublicClient, custom, type PublicClient } from 'viem'
import { elysium } from '../config/chain'
import {
  availableUrls,
  freshHealth,
  isRateLimitMessage,
  isTimeoutMessage,
  noteFailure,
  noteSuccess,
  parseRetryAfter,
  priceUrls,
  rateLimitLine,
  rememberOutliers,
  timeoutLine,
  type OutlierMark,
  type RpcHealth,
} from './rpcHealth'

const health = new Map<string, RpcHealth>()
let outliers: OutlierMark[] = []
let logger: (line: string) => void = (line) => {
  console.warn(line)
}

export function setRpcLogger(fn: (line: string) => void): void {
  logger = fn
}

export function resetRpcRuntime(): void {
  health.clear()
  outliers = []
}

function touch(url: string): RpcHealth {
  const existing = health.get(url)
  if (existing) return existing
  const created = freshHealth(url)
  health.set(url, created)
  return created
}

export function currentPriceUrls(urls: readonly string[]): string[] {
  const now = Date.now()
  const flagged = new Set(outliers.filter((row) => row.until > now).map((row) => row.url))
  return priceUrls(urls, [...health.values()], flagged, now)
}

export function observePriceSamples(
  samples: readonly { url: string; ok: boolean; outlier?: boolean; error?: string }[],
): void {
  const now = Date.now()
  for (const sample of samples) {
    if (!sample.ok && sample.error && isRateLimitMessage(sample.error)) {
      const noted = noteFailure(touch(sample.url), now, 'rate', null)
      health.set(sample.url, noted.health)
      if (noted.shouldLog) logger(rateLimitLine(sample.url, noted.waitMs))
    } else if (!sample.ok && sample.error && isTimeoutMessage(sample.error)) {
      const noted = noteFailure(touch(sample.url), now, 'timeout', null)
      health.set(sample.url, noted.health)
      if (noted.shouldLog) logger(timeoutLine(sample.url, noted.waitMs))
    } else if (sample.ok) {
      health.set(sample.url, noteSuccess(touch(sample.url)))
    }
  }
  outliers = rememberOutliers(outliers, samples, now)
}

class RpcCallError extends Error {
  kind: 'rate' | 'timeout' | 'down' | 'revert'
  retryAfterMs: number | null

  constructor(message: string, kind: 'rate' | 'timeout' | 'down' | 'revert', retryAfterMs: number | null) {
    super(message)
    this.name = 'RpcCallError'
    this.kind = kind
    this.retryAfterMs = retryAfterMs
  }
}

async function postJson(url: string, method: string, params: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (isTimeoutMessage(message) || /abort/i.test(message)) {
      throw new RpcCallError('hết giờ', 'timeout', null)
    }
    throw new RpcCallError('không kết nối được', 'down', null)
  }
  if (res.status === 429) {
    throw new RpcCallError('429 Rate Limit Exceeded', 'rate', parseRetryAfter(res.headers.get('retry-after'), Date.now()))
  }
  if (res.status >= 500 || res.status === 408) {
    throw new RpcCallError(`HTTP ${res.status}`, 'down', parseRetryAfter(res.headers.get('retry-after'), Date.now()))
  }
  const text = await res.text()
  if (!res.ok) throw new RpcCallError(`HTTP ${res.status}`, 'down', null)
  let body: { result?: unknown; error?: { message?: string; code?: number } }
  try {
    body = JSON.parse(text) as { result?: unknown; error?: { message?: string; code?: number } }
  } catch {
    throw new RpcCallError('RPC trả về không phải JSON', 'down', null)
  }
  if (body.error) {
    const message = body.error.message || 'RPC error'
    if (body.error.code === -32005 || isRateLimitMessage(message)) {
      throw new RpcCallError(message, 'rate', null)
    }
    throw new RpcCallError(message, 'revert', null)
  }
  return body.result
}

/**
 * One public client. Each call tries the next RPC that is not in backoff.
 * A contract revert is returned to the caller. A 429 or a timeout is logged
 * once per RPC per window, then the next RPC is used.
 */
export function createResilientClient(
  urls: readonly string[],
  opts?: { onUsed?: (url: string) => void },
): PublicClient {
  const transport = custom({
    async request({ method, params }) {
      const now = Date.now()
      const order = availableUrls(urls, [...health.values()], now)
      if (order.length === 0) {
        throw new Error('Mọi RPC đang nghỉ vì bị giới hạn. Đợi một lát.')
      }
      let last: RpcCallError | null = null
      for (const url of order) {
        try {
          const result = await postJson(url, method, params)
          health.set(url, noteSuccess(touch(url)))
          opts?.onUsed?.(url)
          return result
        } catch (e) {
          if (!(e instanceof RpcCallError)) throw e
          if (e.kind === 'revert') throw new Error(e.message)
          last = e
          const kind = e.kind === 'rate' ? 'rate' : 'timeout'
          const noted = noteFailure(touch(url), Date.now(), kind, e.retryAfterMs)
          health.set(url, noted.health)
          if (noted.shouldLog) {
            logger(kind === 'rate' ? rateLimitLine(url, noted.waitMs) : timeoutLine(url, noted.waitMs))
          }
        }
      }
      if (last?.kind === 'rate') throw new Error('Mọi RPC đang bị giới hạn (429).')
      throw new Error(last?.message || 'Mọi RPC đều không trả lời.')
    },
  })
  return createPublicClient({
    chain: elysium,
    transport,
    batch: { multicall: false },
  })
}
