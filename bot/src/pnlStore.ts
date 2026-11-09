import fs from 'node:fs'
import path from 'node:path'
import { computePnl, sumPnl, type PnlResult } from '../../src/lib/pnl'

export type StoredPosition = {
  tokenId: string
  wallet: string
  openedAt: number
  source: 'first-seen' | 'bot-mint' | 'reset'
  estimated: boolean
  price: number
  hypeUsd: number | null
  deposit0: string
  deposit1: string
  collected0: string
  collected1: string
  gas0: string
  swapCost0: string
  closedAt: number | null
  exit0: string | null
  exit1: string | null
  last0: string
  last1: string
  lastFee0: string
  lastFee1: string
}

type Book = {
  pendingMint: { at: number; amount0: string; amount1: string; price: number } | null
  pendingGas: string
  pendingSwap: string
  positions: StoredPosition[]
  points: { at: number; netHype: number; feesHype: number }[]
}

type FileShape = { wallets: Record<string, Book> }

export type PnlCard = PnlResult & {
  tokenId: string
  estimated: boolean
  source: StoredPosition['source']
  openedAt: number
  closedAt: number | null
}

export type WalletPnl = {
  wallet: string
  hypeUsd: number | null
  totals: PnlResult | null
  positions: PnlCard[]
  series: { at: number; netHype: number; feesHype: number }[]
}

const DEFAULT_FILE = path.resolve(process.cwd(), 'bot', 'data', 'pnl.json')
let filePath = DEFAULT_FILE

export function setPnlFileForTests(file: string): void {
  filePath = file
}

function emptyBook(): Book {
  return { pendingMint: null, pendingGas: '0', pendingSwap: '0', positions: [], points: [] }
}

function load(): FileShape {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as FileShape
    if (parsed && typeof parsed.wallets === 'object') return parsed
  } catch {
    // new file
  }
  return { wallets: {} }
}

function save(data: FileShape): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, filePath)
}

function book(data: FileShape, wallet: string): Book {
  const key = wallet.toLowerCase()
  if (!data.wallets[key]) data.wallets[key] = emptyBook()
  const found = data.wallets[key]!
  if (!found.pendingGas) found.pendingGas = '0'
  if (!found.pendingSwap) found.pendingSwap = '0'
  if (!found.points) found.points = []
  if (!found.positions) found.positions = []
  return found
}

function add(a: string, b: bigint): string {
  return (BigInt(a || '0') + b).toString()
}

function num(wei: string | null | undefined): number {
  if (!wei) return 0
  const v = BigInt(wei)
  const neg = v < 0n
  const abs = neg ? -v : v
  const whole = abs / 10n ** 18n
  const frac = abs % 10n ** 18n
  const n = Number(whole) + Number(frac) / 1e18
  return neg ? -n : n
}

export function notePendingMint(wallet: string, amount0: bigint, amount1: bigint, price: number): void {
  const data = load()
  const b = book(data, wallet)
  b.pendingMint = { at: Date.now(), amount0: amount0.toString(), amount1: amount1.toString(), price }
  save(data)
}

export function recordGas(wallet: string, tokenId: string | null, gasWei: bigint): void {
  if (gasWei <= 0n) return
  const data = load()
  const b = book(data, wallet)
  if (tokenId) {
    const pos = b.positions.find((p) => p.tokenId === tokenId && p.closedAt == null)
    if (pos) pos.gas0 = add(pos.gas0, gasWei)
    else b.pendingGas = add(b.pendingGas, gasWei)
  } else {
    b.pendingGas = add(b.pendingGas, gasWei)
  }
  save(data)
}

export function recordCollected(wallet: string, tokenId: string, fees0: bigint, fees1: bigint): void {
  const data = load()
  const b = book(data, wallet)
  const pos = b.positions.find((p) => p.tokenId === tokenId)
  if (!pos) return
  pos.collected0 = add(pos.collected0, fees0)
  pos.collected1 = add(pos.collected1, fees1)
  save(data)
}

export function recordSwapCost(wallet: string, tokenId: string | null, cost0: bigint): void {
  if (cost0 === 0n) return
  const data = load()
  const b = book(data, wallet)
  const pos = tokenId
    ? b.positions.find((p) => p.tokenId === tokenId && p.closedAt == null)
    : b.positions.find((p) => p.closedAt == null)
  if (!pos) b.pendingSwap = add(b.pendingSwap, cost0)
  else pos.swapCost0 = add(pos.swapCost0, cost0)
  save(data)
}

export function markPositionClosed(wallet: string, tokenId: string): void {
  const data = load()
  const b = book(data, wallet)
  const pos = b.positions.find((p) => p.tokenId === tokenId && p.closedAt == null)
  if (!pos) return
  pos.closedAt = Date.now()
  pos.exit0 = pos.last0
  pos.exit1 = pos.last1
  pos.collected0 = add(pos.collected0, BigInt(pos.lastFee0 || '0'))
  pos.collected1 = add(pos.collected1, BigInt(pos.lastFee1 || '0'))
  pos.lastFee0 = '0'
  pos.lastFee1 = '0'
  save(data)
}

export type SeenPosition = {
  tokenId: string
  amount0: bigint
  amount1: bigint
  fees0: bigint
  fees1: bigint
}

export function observePositions(args: {
  wallet: string
  price: number
  hypeUsd: number | null
  positions: SeenPosition[]
  now?: number
}): void {
  if (!args.wallet || !(args.price > 0)) return
  const now = args.now ?? Date.now()
  const data = load()
  const b = book(data, args.wallet)
  for (const p of args.positions) {
    let row = b.positions.find((x) => x.tokenId === p.tokenId && x.closedAt == null)
    if (!row) {
      const pending =
        b.pendingMint && now - b.pendingMint.at < 30 * 60 * 1000 ? b.pendingMint : null
      row = {
        tokenId: p.tokenId,
        wallet: args.wallet.toLowerCase(),
        openedAt: pending?.at ?? now,
        source: pending ? 'bot-mint' : 'first-seen',
        estimated: !pending,
        price: pending?.price ?? args.price,
        hypeUsd: args.hypeUsd,
        deposit0: pending?.amount0 ?? p.amount0.toString(),
        deposit1: pending?.amount1 ?? p.amount1.toString(),
        collected0: '0',
        collected1: '0',
        gas0: b.pendingGas,
        swapCost0: b.pendingSwap,
        closedAt: null,
        exit0: null,
        exit1: null,
        last0: p.amount0.toString(),
        last1: p.amount1.toString(),
        lastFee0: p.fees0.toString(),
        lastFee1: p.fees1.toString(),
      }
      b.pendingGas = '0'
      b.pendingSwap = '0'
      b.pendingMint = null
      b.positions.push(row)
    }
    row.last0 = p.amount0.toString()
    row.last1 = p.amount1.toString()
    row.lastFee0 = p.fees0.toString()
    row.lastFee1 = p.fees1.toString()
  }
  const view = buildWalletPnl(data, args.wallet, args.positions, args.price, args.hypeUsd, now)
  if (view?.totals) {
    const last = b.points[b.points.length - 1]
    if (!last || now - last.at >= 20_000) {
      b.points.push({ at: now, netHype: view.totals.netHype, feesHype: view.totals.feesHype })
      if (b.points.length > 400) b.points = b.points.slice(-400)
    }
  }
  save(data)
}

export function resetBaseline(args: {
  wallet: string
  tokenId?: string | null
  price: number
  hypeUsd: number | null
  positions: SeenPosition[]
}): void {
  const data = load()
  const b = book(data, args.wallet)
  const now = Date.now()
  if (!args.tokenId) b.positions = b.positions.filter((p) => p.closedAt == null)
  const targets = args.tokenId
    ? b.positions.filter((p) => p.tokenId === args.tokenId)
    : b.positions.filter((p) => p.closedAt == null)
  for (const row of targets) {
    const live = args.positions.find((p) => p.tokenId === row.tokenId)
    if (!live) continue
    row.openedAt = now
    row.source = 'reset'
    row.estimated = false
    row.price = args.price
    row.hypeUsd = args.hypeUsd
    row.deposit0 = live.amount0.toString()
    row.deposit1 = live.amount1.toString()
    row.collected0 = '0'
    row.collected1 = '0'
    row.gas0 = '0'
    row.swapCost0 = '0'
    row.last0 = live.amount0.toString()
    row.last1 = live.amount1.toString()
    row.lastFee0 = live.fees0.toString()
    row.lastFee1 = live.fees1.toString()
  }
  b.points = []
  b.pendingGas = '0'
  b.pendingSwap = '0'
  save(data)
}

function cardFor(
  row: StoredPosition,
  live: SeenPosition | undefined,
  price: number,
  hypeUsd: number | null,
  now: number,
): PnlCard | null {
  const open = row.closedAt == null && live
  const position0 = num(open ? live.amount0.toString() : row.exit0 ?? row.last0)
  const position1 = num(open ? live.amount1.toString() : row.exit1 ?? row.last1)
  const uncollected0 = num(open ? live.fees0.toString() : '0')
  const uncollected1 = num(open ? live.fees1.toString() : '0')
  const metrics = computePnl({
    price,
    deposit0: num(row.deposit0),
    deposit1: num(row.deposit1),
    position0,
    position1,
    uncollected0,
    uncollected1,
    collected0: num(row.collected0),
    collected1: num(row.collected1),
    gas0: num(row.gas0),
    openedAt: row.openedAt,
    now,
    hypeUsd,
  })
  if (!metrics) return null
  return {
    ...metrics,
    tokenId: row.tokenId,
    estimated: row.estimated,
    source: row.source,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
  }
}

function buildWalletPnl(
  data: FileShape,
  wallet: string,
  live: SeenPosition[],
  price: number,
  hypeUsd: number | null,
  now: number,
): WalletPnl | null {
  const b = data.wallets[wallet.toLowerCase()]
  if (!b) return null
  const cards = b.positions
    .map((row) => cardFor(row, live.find((p) => p.tokenId === row.tokenId), price, hypeUsd, now))
    .filter((c): c is PnlCard => c != null)
  return {
    wallet: wallet.toLowerCase(),
    hypeUsd,
    totals: sumPnl(cards),
    positions: cards,
    series: b.points.slice(-400),
  }
}

export function walletPnl(args: {
  wallet: string
  price: number
  hypeUsd: number | null
  positions: SeenPosition[]
  now?: number
}): WalletPnl | null {
  if (!(args.price > 0)) return null
  return buildWalletPnl(load(), args.wallet, args.positions, args.price, args.hypeUsd, args.now ?? Date.now())
}

export function readBook(wallet: string): Book | null {
  return load().wallets[wallet.toLowerCase()] ?? null
}
