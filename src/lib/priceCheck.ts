import { createPublicClient, http } from 'viem'
import { stateViewAbi } from '../abis/stateView'
import { elysium } from '../config/chain'
import { POOL_ID, STATE_VIEW } from '../config/contracts'
import { RPC_URLS } from '../config/rpc'
import { priceFromSqrtX96, priceSpreadPct } from './math'

/** Block sends when RPC prices differ by more than this percent. */
export const MAX_PRICE_DEVIATION_PCT = 1

export type RpcPriceSample = {
  url: string
  ok: boolean
  price?: number
  tick?: number
  sqrtPriceX96?: bigint
  error?: string
}

export type PriceConsensus = {
  samples: RpcPriceSample[]
  agreed: boolean
  deviationPct: number | null
  /** Chinese message for the UI. Null when it is safe to send. */
  blockReason: string | null
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
    throw new Error('slot0 价格为 0')
  }
  return { price, tick, sqrtPriceX96 }
}

/** Read slot0 from each RPC on its own. Needs at least two that agree within 1%. */
export async function crossCheckPoolPrice(
  urls: readonly string[] = RPC_URLS,
): Promise<PriceConsensus> {
  const samples: RpcPriceSample[] = await Promise.all(
    urls.map(async (url) => {
      try {
        const slot = await readSlot0(url)
        return { url, ok: true, ...slot }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return { url, ok: false, error }
      }
    }),
  )
  const ok = samples.filter((s) => s.ok && s.price != null && s.price > 0)
  const deviationPct = priceSpreadPct(ok.map((s) => s.price ?? 0))
  const sorted = [...ok].sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
  const mid = sorted[Math.floor((sorted.length - 1) / 2)]

  let agreed = false
  let blockReason: string | null
  if (ok.length < 2) {
    blockReason = `只读到 ${ok.length} 个 RPC 的 slot0，至少需要 2 个才能交叉核对，已暂停发交易。`
  } else if (deviationPct == null || deviationPct > MAX_PRICE_DEVIATION_PCT) {
    blockReason = `多个 RPC 的现价相差 ${(deviationPct ?? 0).toFixed(2)}%，超过 ${MAX_PRICE_DEVIATION_PCT}%。已暂停发交易。`
  } else {
    agreed = true
    blockReason = null
  }

  return {
    samples,
    agreed,
    deviationPct,
    blockReason,
    medianPrice: mid?.price ?? null,
    medianTick: mid?.tick ?? null,
    medianSqrtPriceX96: mid?.sqrtPriceX96 ?? null,
    chosenRpc: mid?.url ?? null,
  }
}
