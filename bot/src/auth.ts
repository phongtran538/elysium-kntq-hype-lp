import { createHash, timingSafeEqual } from 'node:crypto'

/** The bot server must never listen on every interface. */
export const BIND_HOST = '127.0.0.1'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  if (url.origin === 'null') return false
  return LOCAL_HOSTS.has(url.hostname)
}

export function tokensMatch(provided: string | null | undefined, expected: string): boolean {
  if (!expected || expected.length < 16) return false
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export type AuthDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403; reason: string }

/**
 * Browser calls must send the local token and a localhost Origin.
 * State-changing methods also require Origin so a random page cannot post a form.
 */
export function checkRequestAuth(opts: {
  method: string
  origin: string | null
  token: string | null
  expectedToken: string
}): AuthDecision {
  const method = opts.method.toUpperCase()
  if (method === 'OPTIONS') {
    if (opts.origin && !isAllowedOrigin(opts.origin)) {
      return { ok: false, status: 403, reason: 'Origin không được phép' }
    }
    if (!opts.origin) return { ok: false, status: 403, reason: 'Thiếu Origin' }
    return { ok: true }
  }
  if (!tokensMatch(opts.token, opts.expectedToken)) {
    return { ok: false, status: 401, reason: 'Sai mã kết nối' }
  }
  if (!opts.origin || !isAllowedOrigin(opts.origin)) {
    return { ok: false, status: 403, reason: 'Origin không phải trang local' }
  }
  return { ok: true }
}
