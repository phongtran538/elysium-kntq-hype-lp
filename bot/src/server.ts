import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { BIND_HOST } from './auth'
import { createBotServer, listenOnLoopback } from './http'
import { type BotConfig, loadConfig, readKeyFromFile } from './env'
import { validateConfigPatch, writeEnvValues } from './envfile'
import { getHistory, loadHistory } from './history'
import { log, recentLogs, subscribeLogs } from './log'
import { runLoop } from './execute'
import { observePositions, resetBaseline, walletPnl, type SeenPosition } from './pnlStore'
import { fetchHypeUsd } from './hypeUsd'
import { buildSnapshot, type PublicStatus } from './snapshot'
import { parseUnits } from '../../src/lib/math'

const TOKEN_FILE = path.resolve(process.cwd(), 'bot', '.auth-token')
const ENV_FILE = path.resolve(process.cwd(), '.env')
const PORT = 8787

function ensureToken(): string {
  if (fs.existsSync(TOKEN_FILE)) {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
    if (/^[a-f0-9]{32,128}$/.test(existing)) return existing
  }
  const token = randomBytes(24).toString('hex')
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  fs.writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 })
  return token
}

function applyValues(cfg: BotConfig, values: Record<string, string>): void {
  if (values.RANGE_PCT) cfg.rangePct = Number(values.RANGE_PCT)
  if (values.TRIGGER_PCT) cfg.triggerPct = Number(values.TRIGGER_PCT)
  if (values.POLL_SECONDS) cfg.pollSeconds = Number(values.POLL_SECONDS)
  if (values.MAX_SLIPPAGE_BPS) cfg.maxSlippageBps = Number(values.MAX_SLIPPAGE_BPS)
  if (values.MIN_REBALANCE_INTERVAL_MINUTES) {
    cfg.minRebalanceIntervalMinutes = Number(values.MIN_REBALANCE_INTERVAL_MINUTES)
  }
  if (values.DRY_RUN) cfg.dryRun = values.DRY_RUN !== 'false'
  for (const [key, value] of Object.entries(values)) process.env[key] = value
}

const cfg = loadConfig()
loadHistory()
let running = false
let stopping = false
let lastCheckAt: number | null = null
let snapshot: PublicStatus | null = null
let refreshing = false

function view(): PublicStatus {
  const chain = snapshot
  return {
    running,
    stopping,
    dryRun: cfg.dryRun,
    hasPrivateKey: Boolean(cfg.privateKey),
    wallet: chain?.wallet ?? null,
    balances: chain?.balances ?? null,
    lastCheckAt: chain?.lastCheckAt ?? lastCheckAt,
    nextCheckAt:
      (chain?.lastCheckAt ?? lastCheckAt) == null
        ? null
        : (chain?.lastCheckAt ?? lastCheckAt)! + cfg.pollSeconds * 1000,
    config: {
      rangePct: cfg.rangePct,
      triggerPct: cfg.triggerPct,
      pollSeconds: cfg.pollSeconds,
      maxSlippageBps: cfg.maxSlippageBps,
      minRebalanceIntervalMinutes: cfg.minRebalanceIntervalMinutes,
    },
    price: chain?.price ?? null,
    positions: chain?.positions ?? [],
    history: getHistory(),
    pnl: chain?.pnl ?? null,
    error: chain?.error ?? null,
  }
}

function parseSeen(body: unknown): { error: string } | { wallet: string; price: number; positions: SeenPosition[] } {
  if (!body || typeof body !== 'object') return { error: 'Thiếu dữ liệu' }
  const src = body as Record<string, unknown>
  if ('privateKey' in src || 'PRIVATE_KEY' in src) return { error: 'Không nhận private key từ trình duyệt' }
  const wallet = String(src.wallet ?? '')
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { error: 'Thiếu địa chỉ ví' }
  const price = Number(src.price)
  if (!(price > 0)) return { error: 'Thiếu giá' }
  const rows = Array.isArray(src.positions) ? src.positions : []
  const positions: SeenPosition[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const tokenId = String(item.tokenId ?? '')
    if (!tokenId) continue
    positions.push({
      tokenId,
      amount0: parseUnits(String(item.amount0 ?? '0'), 18),
      amount1: parseUnits(String(item.amount1 ?? '0'), 18),
      fees0: parseUnits(String(item.fees0 ?? '0'), 18),
      fees1: parseUnits(String(item.fees1 ?? '0'), 18),
    })
  }
  return { wallet, price, positions }
}

const server = createBotServer({
  token: ensureToken(),
  getStatus: () => view(),
  recentLogs,
  subscribeLogs,
  async start() {
    if (running) return { ok: false, status: 409, message: 'Bot đang chạy rồi' }
    if (!cfg.privateKey) {
      return { ok: false, status: 400, message: 'Chưa có PRIVATE_KEY trong file .env. Mở Notepad và dán khoá của ví mới.' }
    }
    stopping = false
    running = true
    log(cfg.dryRun ? 'Bấm Chạy: chế độ chỉ xem, không gửi giao dịch.' : 'Bấm Chạy: chế độ THẬT, sẽ gửi giao dịch.')
    void runLoop(cfg, () => stopping).finally(() => {
      running = false
      stopping = false
      server.pushStatus()
    })
    return { ok: true, status: 200, message: 'Đã bật' }
  },
  stop() {
    if (!running) return { ok: true, message: 'Bot đang tắt' }
    stopping = true
    log('Nhận lệnh Dừng. Sẽ ngừng sau bước đang làm.')
    return { ok: true, message: 'Đang dừng' }
  },
  shutdown() {
    stopping = true
    log('Tắt chương trình bot.')
    server.close(() => process.exit(0))
  },
  updateConfig(body) {
    const parsed = validateConfigPatch(body)
    if (!parsed.ok) return { ok: false, status: 400, message: parsed.message }
    writeEnvValues(ENV_FILE, parsed.values)
    applyValues(cfg, parsed.values)
    log(`Đã lưu cấu hình. DRY_RUN=${cfg.dryRun}. Khoảng ±${cfg.rangePct}%, kích hoạt ${cfg.triggerPct}%.`)
    return { ok: true, status: 200, message: 'Đã lưu' }
  },
  openEnv() {
    if (!fs.existsSync(ENV_FILE) && fs.existsSync(path.resolve('.env.example'))) {
      fs.copyFileSync(path.resolve('.env.example'), ENV_FILE)
    }
    if (process.platform === 'win32') {
      spawn('notepad.exe', [ENV_FILE], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true, message: 'Đã mở Notepad. Dán PRIVATE_KEY rồi lưu. Đừng dán khoá vào trang này.' }
    }
    return {
      ok: true,
      message: 'Mở file .env trên máy và dán PRIVATE_KEY. Đừng gõ khoá vào trình duyệt, đừng gửi khoá cho ai.',
    }
  },
  async pnlSeen(body) {
    const parsed = parseSeen(body)
    if ('error' in parsed) return { ok: false, status: 400, message: parsed.error }
    const hypeUsd = await fetchHypeUsd()
    observePositions({
      wallet: parsed.wallet,
      price: parsed.price,
      hypeUsd,
      positions: parsed.positions,
    })
    const pnl = walletPnl({
      wallet: parsed.wallet,
      price: parsed.price,
      hypeUsd,
      positions: parsed.positions,
    })
    return { ok: true, status: 200, message: 'Đã ghi mốc', pnl }
  },
  pnlReset(body) {
    if (!body || typeof body !== 'object') return { ok: false, status: 400, message: 'Thiếu dữ liệu' }
    const src = body as Record<string, unknown>
    if ('privateKey' in src || 'PRIVATE_KEY' in src) {
      return { ok: false, status: 400, message: 'Không nhận private key từ trình duyệt' }
    }
    if (src.confirm !== true) {
      return { ok: false, status: 400, message: 'Cần xác nhận trước khi đặt lại mốc.' }
    }
    const parsed = parseSeen(body)
    if ('error' in parsed) return { ok: false, status: 400, message: parsed.error }
    resetBaseline({
      wallet: parsed.wallet,
      tokenId: typeof src.tokenId === 'string' ? src.tokenId : null,
      price: parsed.price,
      hypeUsd: null,
      positions: parsed.positions,
    })
    return { ok: true, status: 200, message: 'Đã đặt lại mốc tính.' }
  },
  reloadKey() {
    try {
      const key = readKeyFromFile(ENV_FILE)
      cfg.privateKey = key
      if (key) process.env.PRIVATE_KEY = key
      else delete process.env.PRIVATE_KEY
      return {
        ok: true,
        message: key
          ? 'Đã đọc khoá từ file .env. Trang này không hiện khoá.'
          : 'File .env chưa có PRIVATE_KEY.',
      }
    } catch {
      return {
        ok: false,
        message: 'PRIVATE_KEY trong file không đúng. Sửa bằng Notepad. Đừng gửi khoá cho ai.',
      }
    }
  },
})

async function refresh(): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    snapshot = await buildSnapshot(cfg, { running, stopping, lastCheckAt })
    lastCheckAt = snapshot.lastCheckAt
    server.pushStatus()
  } catch (e) {
    log(`Không đọc được trạng thái: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    refreshing = false
  }
}

let timer: NodeJS.Timeout | null = null
function arm(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => void refresh(), Math.max(5, cfg.pollSeconds) * 1000)
}

const addr = await listenOnLoopback(server, PORT)
if (addr.address !== BIND_HOST) {
  log(`Từ chối lắng nghe trên ${addr.address}. Chỉ được dùng 127.0.0.1.`)
  process.exit(1)
}
log(`Trang điều khiển bot nghe tại http://${BIND_HOST}:${addr.port}. Chỉ máy này. Không hiện private key.`)
arm()
void refresh()

process.on('SIGINT', () => {
  stopping = true
  server.close(() => process.exit(0))
})
process.on('SIGTERM', () => {
  stopping = true
  server.close(() => process.exit(0))
})
