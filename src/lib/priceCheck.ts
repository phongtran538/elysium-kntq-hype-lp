import { createPublicClient, http } from 'viem'
import { stateViewAbi } from '../abis/stateView'
import { elysium } from '../config/chain'
import { POOL_ID, STATE_VIEW } from '../config/contracts'
import { OFFICIAL_RPC, RPC_URLS } from '../config/rpc'
import { priceFromSqrtX96 } from './math'
import { shortenRpcError } from './rpcHealth'
import { currentPriceUrls, observePriceSamples } from './resilientRpc'

/** A quote farther than this from the median is an outlier and is ignored. */
export const MAX_PRICE_DEVIATION_PCT = 1
/** Sends stay blocked until at least this many RPCs sit within 1% of the median. */
export const MIN_AGREEING_RPCS = 3

export type RpcPriceSample = {
  url: string
  ok: boolean
  price?: number
  tick?: number
  sqrtPriceX96?: bigint
  error?: string
  /** True when this RPC answered but its price is more than 1% off the median. */
  outlier?: boolean
  deviationPct?: number
}

export type PriceConsensus = {
  samples: RpcPriceSample[]
  agreed: boolean
  deviationPct: number | null
  /** Vietnamese message for the UI. Null when it is safe to send. */
  blockReason: string | null
  /** How many RPCs are within 1% of the median. */
  agreeing: number
  medianPrice: number | null
  medianTick: number | null
  medianSqrtPriceX96: bigint | null
  chosenRpc: string | null
}

async function readSlot0(url: string): Promise<{
  price: number
  tick: number
  sqrtPriceX96: bigint
}> {
  const client = createPublicClient({
    chain: elysium,
    transport: http(url, { timeout: 8_000, retryCount: 0 }),
    batch: { multicall: false },
  })
  const slot0 = await client.readContract({
    address: STATE_VIEW,
    abi: stateViewAbi,
    functionName: 'getSlot0',
    args: [POOL_ID],
  })
  const sqrtPriceX96 = slot0[0]
  const tick = Number(slot0[1])
  const price = priceFromSqrtX96(sqrtPriceX96, 18, 18)
  if (!(price > 0)) {
    throw new Error('Giá slot0 bằng 0')
  }
  return { price, tick, sqrtPriceX96 }
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

function pctFromMedian(price: number, median: number): number {
  if (!(median > 0)) return Number.POSITIVE_INFINITY
  return (Math.abs(price - median) / median) * 100
}

/**
 * Median of the RPCs that answered. Quotes more than 1% from that median are
 * outliers and do not count. Sends are allowed only when at least 3 remain.
 */
export function summarizeRpcPrices(
  samples: RpcPriceSample[],
  opts?: { maxDeviationPct?: number; minAgree?: number; preferredUrl?: string },
): PriceConsensus {
  const maxDeviationPct = opts?.maxDeviationPct ?? MAX_PRICE_DEVIATION_PCT
  const minAgree = opts?.minAgree ?? MIN_AGREEING_RPCS
  const preferredUrl = (opts?.preferredUrl ?? OFFICIAL_RPC).toLowerCase()
  const ok = samples.filter((s) => s.ok && s.price != null && s.price > 0)
  const median = medianOf(ok.map((s) => s.price!))

  const marked: RpcPriceSample[] = samples.map((s) => {
    if (!s.ok || s.price == null || !(s.price > 0) || median == null) return { ...s, outlier: false }
    const deviationPct = pctFromMedian(s.price, median)
    return {
      ...s,
      deviationPct,
      outlier: deviationPct > maxDeviationPct,
    }
  })
  const inliers = marked.filter((s) => s.ok && s.price != null && !s.outlier)
  const deviationPct =
    median == null || inliers.length === 0
      ? null
      : Math.max(...inliers.map((s) => s.deviationPct ?? 0))
  const agreed = inliers.length >= minAgree

  const pick = (group: RpcPriceSample[]): RpcPriceSample | undefined => {
    const preferred = group.find((s) => s.url.toLowerCase() === preferredUrl)
    if (preferred) return preferred
    if (median == null) return group[0]
    return [...group].sort(
      (a, b) => pctFromMedian(a.price ?? 0, median) - pctFromMedian(b.price ?? 0, median),
    )[0]
  }
  const pool = inliers.length > 0 ? inliers : marked.filter((s) => s.ok && s.price != null && s.price > 0)
  const chosen = pick(pool)

  const blockReason = agreed
    ? null
    : `Chỉ có ${inliers.length} RPC khớp quanh giá giữa (cần ít nhất ${minAgree}, lệch không quá ${maxDeviationPct}%). Đã khóa gửi giao dịch.`

  return {
    samples: marked,
    agreed,
    agreeing: inliers.length,
    deviationPct,
    blockReason,
    medianPrice: median,
    medianTick: chosen?.tick ?? null,
    medianSqrtPriceX96: chosen?.sqrtPriceX96 ?? null,
    chosenRpc: chosen?.url ?? null,
  }
}

/** Read slot0 from each healthy RPC, skip price outliers, then keep the ones near the median. */
export async function crossCheckPoolPrice(
  urls: readonly string[] = RPC_URLS,
): Promise<PriceConsensus> {
  const list = currentPriceUrls(urls)
  if (list.length === 0) {
    return summarizeRpcPrices(
      urls.map((url) => ({ url, ok: false, error: 'đang nghỉ vì bị giới hạn (429)' })),
    )
  }
  const samples: RpcPriceSample[] = await Promise.all(
    list.map(async (url) => {
      try {
        const slot = await readSlot0(url)
        return { url, ok: true, ...slot }
      } catch (e) {
        const error = shortenRpcError(e instanceof Error ? e.message : String(e))
        return { url, ok: false, error }
      }
    }),
  )
  observePriceSamples(samples)
  return summarizeRpcPrices(samples)
}
