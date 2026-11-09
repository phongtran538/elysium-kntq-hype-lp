import { log, safeError } from './log'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isTransient(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase()
  if (m.includes('execution reverted') || m.includes('revert')) return false
  return (
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('fetch') ||
    m.includes('network') ||
    m.includes('econn') ||
    m.includes('socket') ||
    m.includes('429') ||
    m.includes('502') ||
    m.includes('503') ||
    m.includes('504') ||
    m.includes('http request failed') ||
    m.includes('failed to fetch')
  )
}

export async function withBackoff<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let wait = 2_000
  let last: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (!isTransient(e) || i === attempts) throw e
      log(
        `${label}: lỗi mạng (${safeError(e)}). Thử lại lần ${i + 1}/${attempts} sau ${wait / 1000} giây.`,
      )
      await sleep(wait)
      wait *= 2
    }
  }
  throw last
}
