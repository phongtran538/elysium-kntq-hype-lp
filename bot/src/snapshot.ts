import { formatUnits, rangeEdgeStatus } from '../../src/lib/math'
import { crossCheckPoolPrice, type PriceConsensus } from '../../src/lib/priceCheck'
import { accountFrom, hypeBalance, kntqBalance, makeClients } from './chain'
import type { BotConfig } from './env'
import { fetchHypeUsd } from './hypeUsd'
import { getHistory } from './history'
import { observePositions, walletPnl, type SeenPosition, type WalletPnl } from './pnlStore'
import { loadPositions } from './positions'

export type PublicPosition = {
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
}

export type PublicStatus = {
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
      outlier: boolean
      deviationPct: number | null
    }[]
  } | null
  positions: PublicPosition[]
  history: ReturnType<typeof getHistory>
  pnl: WalletPnl | null
  error: string | null
}

function shortErr(error: string | undefined): string | null {
  if (!error) return null
  const raw = error.replace(/\s+/g, ' ')
  if (/timed out|timeout|took too long/i.test(raw)) return 'hết giờ'
  return (raw.split(/request body/i)[0] ?? raw).trim().slice(0, 80)
}

function priceView(c: PriceConsensus | null) {
  if (!c) return null
  return {
    agreed: c.agreed,
    deviationPct: c.deviationPct,
    medianPrice: c.medianPrice,
    medianTick: c.medianTick,
    blockReason: c.blockReason,
    samples: c.samples.map((s) => ({
      url: s.url,
      ok: s.ok,
      price: s.price ?? null,
      tick: s.tick ?? null,
      error: shortErr(s.error),
      outlier: s.outlier === true,
      deviationPct: s.deviationPct ?? null,
    })),
  }
}

export async function buildSnapshot(
  cfg: BotConfig,
  flags: { running: boolean; stopping: boolean; lastCheckAt: number | null },
): Promise<PublicStatus> {
  const base: PublicStatus = {
    running: flags.running,
    stopping: flags.stopping,
    dryRun: cfg.dryRun,
    hasPrivateKey: Boolean(cfg.privateKey),
    wallet: null,
    balances: null,
    lastCheckAt: flags.lastCheckAt,
    nextCheckAt: flags.lastCheckAt == null ? null : flags.lastCheckAt + cfg.pollSeconds * 1000,
    config: {
      rangePct: cfg.rangePct,
      triggerPct: cfg.triggerPct,
      pollSeconds: cfg.pollSeconds,
      maxSlippageBps: cfg.maxSlippageBps,
      minRebalanceIntervalMinutes: cfg.minRebalanceIntervalMinutes,
    },
    price: null,
    positions: [],
    history: getHistory(),
    pnl: null,
    error: null,
  }
  try {
    const consensus = await crossCheckPoolPrice(cfg.rpcUrls)
    base.price = priceView(consensus)
    base.lastCheckAt = Date.now()
    base.nextCheckAt = base.lastCheckAt + cfg.pollSeconds * 1000
    if (!cfg.privateKey || !consensus.medianSqrtPriceX96 || !consensus.chosenRpc || consensus.medianPrice == null) {
      return base
    }
    const account = accountFrom(cfg.privateKey)
    base.wallet = account.address
    const { publicClient } = makeClients(consensus.chosenRpc, account)
    try {
      const [hype, kntq] = await Promise.all([
        hypeBalance(publicClient, account.address),
        kntqBalance(publicClient, account.address),
      ])
      base.balances = { hype: formatUnits(hype, 18, 4), kntq: formatUnits(kntq, 18, 4) }
    } catch (e) {
      base.error = e instanceof Error ? e.message.slice(0, 180) : 'Không đọc được số dư'
    }
    const hypeUsd = await fetchHypeUsd()
    const positions = await loadPositions(publicClient, account.address, consensus.medianSqrtPriceX96)
    const seen: SeenPosition[] = positions.map((p) => ({
      tokenId: p.tokenId.toString(),
      amount0: p.amount0,
      amount1: p.amount1,
      fees0: p.fees0,
      fees1: p.fees1,
    }))
    observePositions({
      wallet: account.address,
      price: consensus.medianPrice,
      hypeUsd,
      positions: seen,
    })
    base.pnl = walletPnl({
      wallet: account.address,
      price: consensus.medianPrice,
      hypeUsd,
      positions: seen,
    })
    base.positions = positions.map((p) => {
      const edge = rangeEdgeStatus(consensus.medianPrice!, p.lowerPrice, p.upperPrice, cfg.triggerPct)
      return {
        tokenId: p.tokenId.toString(),
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        lowerPrice: p.lowerPrice,
        upperPrice: p.upperPrice,
        inRange: edge.level === 'inside' || edge.level === 'near',
        nearEdge: edge.level === 'near',
        side: edge.level === 'out' ? edge.side : null,
        distanceLowerPct: edge.distanceLowerPct,
        distanceUpperPct: edge.distanceUpperPct,
        fees0: formatUnits(p.fees0, 18, 6),
        fees1: formatUnits(p.fees1, 18, 6),
        feesKnown: p.feesKnown,
        amount0: formatUnits(p.amount0, 18, 4),
        amount1: formatUnits(p.amount1, 18, 4),
      }
    })
  } catch (e) {
    base.error = e instanceof Error ? e.message.slice(0, 180) : 'Không đọc được chain'
  }
  return base
}
