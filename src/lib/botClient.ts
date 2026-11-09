import type { PnlResult } from './pnl'

const BASE = 'http://127.0.0.1:8787'
const STORAGE_KEY = 'kntq-bot-token'

export type BotStatus = {
  running: boolean
  stopping: boolean
  dryRun: boolean
  hasPrivateKey: boolean
  wallet: string | null
  balances: { hype: string; kntq: string } | null
  lastCheckAt: number | null
  nextCheckAt: number | null
  config: {
    rangePct: number
    triggerPct: number
    pollSeconds: number
    maxSlippageBps: number
    minRebalanceIntervalMinutes: number
  }
  price: {
    agreed: boolean
    deviationPct: number | null
    medianPrice: number | null
    medianTick: number | null
    blockReason: string | null
    samples: {
      url: string
      ok: boolean
      price: number | null
      tick: number | null
      error: string | null
      outlier?: boolean
      deviationPct?: number | null
    }[]
  } | null
  positions: {
    tokenId: string
    tickLower: number
    tickUpper: number
    lowerPrice: number
    upperPrice: number
    inRange: boolean
    nearEdge: boolean
    side: 'below' | 'above' | null
    distanceLowerPct: number
    distanceUpperPct: number
    fees0: string
    fees1: string
    feesKnown: boolean
    amount0: string
    amount1: string
  }[]
  history: { at: number; kind: string; summary: string }[]
  pnl: WalletPnl | null
  error: string | null
}

export type WalletPnl = {
  wallet: string
  hypeUsd: number | null
  totals: PnlResult | null
  positions: (PnlResult & {
    tokenId: string
    estimated: boolean
    source: string
    openedAt: number
    closedAt: number | null
  })[]
  series: { at: number; netHype: number; feesHype: number }[]
}

export function captureBotToken(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const fromHash = hash.get('botToken')
  if (fromHash && /^[a-f0-9]{32,128}$/.test(fromHash)) {
    localStorage.setItem(STORAGE_KEY, fromHash)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return localStorage.getItem(STORAGE_KEY)
}

export function botToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export async function botFetch(path: string, body?: unknown): Promise<BotStatus | { ok?: boolean; message?: string }> {
  const token = botToken()
  if (!token) throw new Error('NO_TOKEN')
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined && path !== '/api/status' ? 'POST' : path === '/api/status' ? 'GET' : 'POST',
    headers: {
      'X-Bot-Token': token,
      'Content-Type': 'application/json',
    },
    body: path === '/api/status' ? undefined : JSON.stringify(body ?? {}),
  })
  const data = (await res.json().catch(() => ({}))) as { message?: string }
  if (!res.ok) throw new Error(data.message || 'Máy bot không trả lời')
  return data as BotStatus
}

export async function openBotEvents(
  onLog: (line: string) => void,
  onStatus: (status: BotStatus) => void,
  signal: AbortSignal,
): Promise<void> {
  const token = botToken()
  if (!token) throw new Error('NO_TOKEN')
  const res = await fetch(`${BASE}/api/events`, {
    headers: { 'X-Bot-Token': token },
    signal,
  })
  if (!res.ok || !res.body) throw new Error('Không mở được nhật ký')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const event = /event: (\w+)/.exec(chunk)?.[1]
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      const data = JSON.parse(dataLine.slice(6)) as { line?: string }
      if (event === 'log' && data.line) onLog(data.line)
      if (event === 'status') onStatus(data as BotStatus)
    }
  }
}
