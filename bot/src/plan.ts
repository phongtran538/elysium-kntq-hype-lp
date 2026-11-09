/**
 * Pure rebalance decisions: when to move a position, where the new range sits,
 * and how much of one token to swap so the wallet matches that range.
 * No network, no keys.
 */
import { POOL_KEY } from '../../src/config/contracts'
import { priceAtTick, ticksFromPct } from '../../src/config/ranges'
import {
  getAmountsForLiquidity,
  getSqrtRatioAtTick,
  rangeEdgeStatus,
  type RangeEdgeStatus,
} from '../../src/lib/math'

const Q96 = 2n ** 96n
const Q192 = Q96 * Q96
const FEE_DENOM = 1_000_000n

export function edgesForTicks(tickLower: number, tickUpper: number): {
  lowerPrice: number
  upperPrice: number
} {
  return { lowerPrice: priceAtTick(tickLower), upperPrice: priceAtTick(tickUpper) }
}

export function rangeAroundTick(
  currentTick: number,
  rangePct: number,
  spacing = POOL_KEY.tickSpacing,
): { tickLower: number; tickUpper: number } {
  return ticksFromPct(currentTick, rangePct, spacing)
}

export type RebalanceDecision =
  | { action: 'none'; status: RangeEdgeStatus }
  | { action: 'rebalance'; status: RangeEdgeStatus }
  | { action: 'skip-hot-range'; status: RangeEdgeStatus }

/** Trigger when price is outside the range or within triggerPct of either edge. */
export function decideRebalance(args: {
  price: number
  tickLower: number
  tickUpper: number
  currentTick: number
  triggerPct: number
  rangePct: number
}): RebalanceDecision {
  const { lowerPrice, upperPrice } = edgesForTicks(args.tickLower, args.tickUpper)
  const status = rangeEdgeStatus(args.price, lowerPrice, upperPrice, args.triggerPct)
  if (status.level !== 'out' && status.level !== 'near') {
    return { action: 'none', status }
  }
  const next = rangeAroundTick(args.currentTick, args.rangePct)
  const nextSpot = priceAtTick(args.currentTick)
  const nextEdges = edgesForTicks(next.tickLower, next.tickUpper)
  const nextStatus = rangeEdgeStatus(
    nextSpot,
    nextEdges.lowerPrice,
    nextEdges.upperPrice,
    args.triggerPct,
  )
  if (nextStatus.level === 'out' || nextStatus.level === 'near') {
    return { action: 'skip-hot-range', status }
  }
  return { action: 'rebalance', status }
}

export function spendable(balance: bigint, reserve: bigint): bigint {
  if (reserve < 0n) return balance > 0n ? balance : 0n
  return balance > reserve ? balance - reserve : 0n
}

export function cooldownRemainingMs(
  lastAt: number | null,
  now: number,
  minutes: number,
): number {
  if (lastAt == null || !Number.isFinite(lastAt) || !(minutes > 0)) return 0
  const need = minutes * 60_000
  const left = need - (now - lastAt)
  return left > 0 ? left : 0
}

export type SwapPlan = {
  zeroForOne: boolean
  amountIn: bigint
}

/**
 * Swap size so balances match the token ratio of `liquidity` inside [tickLower, tickUpper]
 * at `sqrtPriceX96`, after the pool fee. Returns null when no swap is needed (or only dust).
 * Caps amountIn at the balance of the token being sold. Ignores price impact; the caller quotes.
 */
export function planSwap(args: {
  bal0: bigint
  bal1: bigint
  sqrtPriceX96: bigint
  tickLower: number
  tickUpper: number
  feePips?: number
}): SwapPlan | null {
  if (args.bal0 < 0n || args.bal1 < 0n) return null
  if (args.sqrtPriceX96 <= 0n) return null
  if (!(args.tickUpper > args.tickLower)) return null
  const feePips = BigInt(args.feePips ?? POOL_KEY.fee)
  if (feePips < 0n || feePips >= FEE_DENOM) return null

  const sqrtA = getSqrtRatioAtTick(args.tickLower)
  const sqrtB = getSqrtRatioAtTick(args.tickUpper)
  const ref = getAmountsForLiquidity(args.sqrtPriceX96, sqrtA, sqrtB, 10n ** 18n)
  const a0 = ref.amount0
  const a1 = ref.amount1
  if (a0 === 0n && a1 === 0n) return null

  if (a0 === 0n) {
    return dustOrNull(true, args.bal0, args.bal0)
  }
  if (a1 === 0n) {
    return dustOrNull(false, args.bal1, args.bal1)
  }

  const priceX192 = args.sqrtPriceX96 * args.sqrtPriceX96
  if (priceX192 === 0n) return null
  const keep = FEE_DENOM - feePips
  const numer = args.bal0 * a1 - args.bal1 * a0

  if (numer > 0n) {
    const denom = Q192 * FEE_DENOM
    const k = priceX192 * keep
    const dx = (numer * denom) / (a1 * denom + a0 * k)
    const capped = dx > args.bal0 ? args.bal0 : dx
    return dustOrNull(true, capped, args.bal0)
  }
  if (numer < 0n) {
    const denom0 = priceX192 * FEE_DENOM
    const k0 = Q192 * keep
    const dy = (-numer * denom0) / (k0 * a1 + a0 * denom0)
    const capped = dy > args.bal1 ? args.bal1 : dy
    return dustOrNull(false, capped, args.bal1)
  }
  return null
}

function dustOrNull(zeroForOne: boolean, amountIn: bigint, balance: bigint): SwapPlan | null {
  if (amountIn <= 0n) return null
  const minAbs = 10n ** 15n
  if (amountIn < minAbs) return null
  if (balance > 0n && amountIn * 1000n < balance) return null
  return { zeroForOne, amountIn }
}
