import fs from 'node:fs'

const EDITABLE = new Set([
  'RANGE_PCT',
  'TRIGGER_PCT',
  'POLL_SECONDS',
  'MAX_SLIPPAGE_BPS',
  'MIN_REBALANCE_INTERVAL_MINUTES',
  'DRY_RUN',
  'GAS_RESERVE_HYPE',
  'MAX_GAS',
  'RPC_URLS',
])

export type ConfigPatch = {
  rangePct?: number
  triggerPct?: number
  pollSeconds?: number
  maxSlippageBps?: number
  minRebalanceIntervalMinutes?: number
  dryRun?: boolean
  confirmLive?: boolean
}

export function validateConfigPatch(
  body: unknown,
): { ok: true; values: Record<string, string> } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Thiếu dữ liệu' }
  const src = body as ConfigPatch & { privateKey?: unknown; PRIVATE_KEY?: unknown }
  if ('privateKey' in src || 'PRIVATE_KEY' in src) {
    return { ok: false, message: 'Không nhận private key từ trình duyệt' }
  }
  if (src.dryRun === false && src.confirmLive !== true) {
    return {
      ok: false,
      message: 'Muốn chạy thật thì phải xác nhận trên trang. Bot không tự tắt DRY_RUN.',
    }
  }
  const values: Record<string, string> = {}
  const num = (
    key: string,
    value: number | undefined,
    min: number,
    max: number,
  ): string | null => {
    if (value === undefined) return null
    if (!Number.isFinite(value) || value < min || value > max) {
      return `${key} phải từ ${min} đến ${max}`
    }
    values[key] = String(value)
    return null
  }
  const err =
    num('RANGE_PCT', src.rangePct, 0.1, 90) ||
    num('TRIGGER_PCT', src.triggerPct, 0, 50) ||
    num('POLL_SECONDS', src.pollSeconds, 5, 86_400) ||
    num('MAX_SLIPPAGE_BPS', src.maxSlippageBps, 0, 2_000) ||
    num('MIN_REBALANCE_INTERVAL_MINUTES', src.minRebalanceIntervalMinutes, 0, 10_080)
  if (err) return { ok: false, message: err }
  if (src.dryRun !== undefined) values.DRY_RUN = src.dryRun ? 'true' : 'false'
  return { ok: true, values }
}

/** Rewrite editable keys. Never touches PRIVATE_KEY. */
export function writeEnvValues(file: string, values: Record<string, string>): void {
  if ('PRIVATE_KEY' in values || 'privateKey' in values) {
    throw new Error('Từ chối ghi private key')
  }
  for (const key of Object.keys(values)) {
    if (!EDITABLE.has(key)) throw new Error(`Không cho sửa ${key}`)
  }
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const lines = original.length ? original.split(/\r?\n/) : []
  const seen = new Set<string>()
  const next = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return line
    const key = trimmed.slice(0, trimmed.indexOf('=')).trim()
    if (key === 'PRIVATE_KEY') return line
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      seen.add(key)
      return `${key}=${values[key]}`
    }
    return line
  })
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`)
  }
  const text = next.join('\n').replace(/\n*$/, '\n')
  fs.writeFileSync(file, text)
}
