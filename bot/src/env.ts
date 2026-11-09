import fs from 'node:fs'
import path from 'node:path'
import { RPC_URLS } from '../../src/config/rpc'

export type BotConfig = {
  privateKey: `0x${string}` | null
  rpcUrls: readonly string[]
  rangePct: number
  triggerPct: number
  pollSeconds: number
  maxSlippageBps: number
  minRebalanceIntervalMinutes: number
  maxGas: bigint
  dryRun: boolean
  gasReserveHype: string
}

function loadDotEnv(file = path.resolve(process.cwd(), '.env')): void {
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function requiredNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const n = raw == null || raw.trim() === '' ? fallback : Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} phải là số từ ${min} đến ${max} (đang là ${raw ?? fallback})`)
  }
  return n
}

function parseKey(raw: string | undefined): `0x${string}` | null {
  if (raw == null || raw.trim() === '') return null
  const t = raw.trim().replace(/^['"]|['"]$/g, '')
  const withPrefix = (t.startsWith('0x') || t.startsWith('0X') ? t : `0x${t}`).replace(/^0X/, '0x')
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      'PRIVATE_KEY không đúng định dạng (cần 64 ký tự hex). Sửa file .env trên máy bạn. Đừng gửi khoá cho bất kỳ ai.',
    )
  }
  return withPrefix as `0x${string}`
}

function parseDryRun(): boolean {
  const raw = process.env.DRY_RUN
  if (raw == null || raw.trim() === '') return true
  const v = raw.trim().toLowerCase()
  if (v === 'false' || v === '0' || v === 'no') return false
  if (v === 'true' || v === '1' || v === 'yes') return true
  throw new Error('DRY_RUN phải là true hoặc false')
}

function parseRpcUrls(): readonly string[] {
  const raw = process.env.RPC_URLS?.trim()
  const urls = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [...RPC_URLS]
  if (urls.length < 2) {
    throw new Error('Cần ít nhất 2 RPC trong RPC_URLS để đối chiếu giá trước khi làm gì.')
  }
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) throw new Error(`RPC không hợp lệ: ${url}`)
  }
  return urls
}

export function readKeyFromFile(file = path.resolve(process.cwd(), '.env')): `0x${string}` | null {
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('PRIVATE_KEY=')) continue
    return parseKey(trimmed.slice('PRIVATE_KEY='.length))
  }
  return null
}

export function loadConfig(): BotConfig {
  loadDotEnv()
  const maxGasNum = requiredNumber('MAX_GAS', 1_500_000, 21_000, 30_000_000)
  const gasReserveHype = (process.env.GAS_RESERVE_HYPE ?? '0.08').trim() || '0.08'
  if (!/^\d+(\.\d+)?$/.test(gasReserveHype)) {
    throw new Error('GAS_RESERVE_HYPE phải là số HYPE, ví dụ 0.08')
  }
  return {
    privateKey: parseKey(process.env.PRIVATE_KEY),
    rpcUrls: parseRpcUrls(),
    rangePct: requiredNumber('RANGE_PCT', 20, 0.1, 90),
    triggerPct: requiredNumber('TRIGGER_PCT', 5, 0, 50),
    pollSeconds: requiredNumber('POLL_SECONDS', 30, 5, 86_400),
    maxSlippageBps: requiredNumber('MAX_SLIPPAGE_BPS', 50, 0, 2_000),
    minRebalanceIntervalMinutes: requiredNumber('MIN_REBALANCE_INTERVAL_MINUTES', 60, 0, 10_080),
    maxGas: BigInt(Math.floor(maxGasNum)),
    dryRun: parseDryRun(),
    gasReserveHype,
  }
}
