/** Uniswap V3/V4 liquidity & price helpers (Q64.96 / Q128) */

const Q96 = 2n ** 96n
const Q128 = 2n ** 128n

export function mulDiv(a: bigint, b: bigint, denom: bigint): bigint {
  return (a * b) / denom
}

/** token1 / token0 human price from sqrtPriceX96 */
export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0 = 18, decimals1 = 18): number {
  if (sqrtPriceX96 === 0n) return 0
  // price = (sqrtP / 2^96)^2 * 10^(dec0-dec1)
  const num = Number(sqrtPriceX96) / Number(Q96)
  const raw = num * num
  const scale = 10 ** (decimals0 - decimals1)
  return raw * scale
}

export function getAmount0ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): bigint {
  let a = sqrtRatioAX96
  let b = sqrtRatioBX96
  if (a > b) [a, b] = [b, a]
  if (a === 0n) return 0n
  return mulDiv(mulDiv(liquidity, Q96, a), b - a, b)
}

export function getAmount1ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): bigint {
  let a = sqrtRatioAX96
  let b = sqrtRatioBX96
  if (a > b) [a, b] = [b, a]
  return mulDiv(liquidity, b - a, Q96)
}

export function getAmountsForLiquidity(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  let a = sqrtRatioAX96
  let b = sqrtRatioBX96
  if (a > b) [a, b] = [b, a]
  if (sqrtRatioX96 <= a) {
    return { amount0: getAmount0ForLiquidity(a, b, liquidity), amount1: 0n }
  }
  if (sqrtRatioX96 < b) {
    return {
      amount0: getAmount0ForLiquidity(sqrtRatioX96, b, liquidity),
      amount1: getAmount1ForLiquidity(a, sqrtRatioX96, liquidity),
    }
  }
  return { amount0: 0n, amount1: getAmount1ForLiquidity(a, b, liquidity) }
}

export function getLiquidityForAmount0(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
): bigint {
  let a = sqrtRatioAX96
  let b = sqrtRatioBX96
  if (a > b) [a, b] = [b, a]
  const intermediate = mulDiv(a, b, Q96)
  return mulDiv(amount0, intermediate, b - a)
}

export function getLiquidityForAmount1(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount1: bigint,
): bigint {
  let a = sqrtRatioAX96
  let b = sqrtRatioBX96
  if (a > b) [a, b] = [b, a]
  return mulDiv(amount1, Q96, b - a)
}

export function getLiquidityForAmounts(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  let a = sqrtRatioAX96
  let b = sqrtRatioBX96
  if (a > b) [a, b] = [b, a]
  if (sqrtRatioX96 <= a) return getLiquidityForAmount0(a, b, amount0)
  if (sqrtRatioX96 < b) {
    const liq0 = getLiquidityForAmount0(sqrtRatioX96, b, amount0)
    const liq1 = getLiquidityForAmount1(a, sqrtRatioX96, amount1)
    return liq0 < liq1 ? liq0 : liq1
  }
  return getLiquidityForAmount1(a, b, amount1)
}

/** Approximate TickMath.getSqrtRatioAtTick for full-range / common ticks */
export function getSqrtRatioAtTick(tick: number): bigint {
  // Use well-known boundary values + geometric interpolation via abs(tick)
  // Full Uniswap TickMath port (subset) — accurate enough for UI + mint sizing.
  const absTick = tick < 0 ? -tick : tick
  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n

  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio
  // round up to Q64.96
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

export function feesFromGrowth(
  liquidity: bigint,
  feeGrowthInsideX128: bigint,
  feeGrowthInsideLastX128: bigint,
): bigint {
  if (liquidity === 0n) return 0n
  const delta =
    feeGrowthInsideX128 >= feeGrowthInsideLastX128
      ? feeGrowthInsideX128 - feeGrowthInsideLastX128
      : // overflow wrap
        2n ** 256n - feeGrowthInsideLastX128 + feeGrowthInsideX128
  return mulDiv(delta, liquidity, Q128)
}

export function applySlippageMax(amount: bigint, slippagePct: number): bigint {
  // never auto-widen: caller passes user slippage only
  const bps = BigInt(Math.round(slippagePct * 100)) // 0.5% -> 50 bps
  return amount + (amount * bps) / 10_000n
}

export function applySlippageMin(amount: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100))
  const v = amount - (amount * bps) / 10_000n
  return v < 0n ? 0n : v
}

/**
 * Mins for DECREASE_LIQUIDITY / BURN_POSITION.
 * PositionManager checks these against principal only (liquidity removed),
 * not against fees. Do not add fee estimates into these numbers.
 */
export function principalSlippageMins(args: {
  sqrtPriceX96: bigint
  tickLower: number
  tickUpper: number
  liquidity: bigint
  slippagePct: number
}): { amount0: bigint; amount1: bigint; amount0Min: bigint; amount1Min: bigint } {
  const principal = getAmountsForLiquidity(
    args.sqrtPriceX96,
    getSqrtRatioAtTick(args.tickLower),
    getSqrtRatioAtTick(args.tickUpper),
    args.liquidity,
  )
  return {
    amount0: principal.amount0,
    amount1: principal.amount1,
    amount0Min: applySlippageMin(principal.amount0, args.slippagePct),
    amount1Min: applySlippageMin(principal.amount1, args.slippagePct),
  }
}

/**
 * Size liquidity from a reduced budget so
 * used * (1 + slippage) stays within the available balance.
 * Do not size from the full balance and then set max = used * (1 + slippage),
 * because that max can exceed the wallet or a later price move.
 */
export function liquidityUnderSlippageCap(args: {
  sqrtPriceX96: bigint
  sqrtLowerX96: bigint
  sqrtUpperX96: bigint
  available0: bigint
  available1: bigint
  slippagePct: number
}): {
  liquidity: bigint
  used0: bigint
  used1: bigint
  amount0Max: bigint
  amount1Max: bigint
} {
  const bps = BigInt(Math.max(0, Math.round(args.slippagePct * 100)))
  const denom = 10_000n + bps
  const budget0 = denom === 0n ? 0n : (args.available0 * 10_000n) / denom
  const budget1 = denom === 0n ? 0n : (args.available1 * 10_000n) / denom
  const liquidity = getLiquidityForAmounts(
    args.sqrtPriceX96,
    args.sqrtLowerX96,
    args.sqrtUpperX96,
    budget0,
    budget1,
  )
  const used = getAmountsForLiquidity(
    args.sqrtPriceX96,
    args.sqrtLowerX96,
    args.sqrtUpperX96,
    liquidity,
  )
  let amount0Max = applySlippageMax(used.amount0, Math.max(0, args.slippagePct))
  let amount1Max = applySlippageMax(used.amount1, Math.max(0, args.slippagePct))
  if (amount0Max > args.available0) amount0Max = args.available0
  if (amount1Max > args.available1) amount1Max = args.available1
  return { liquidity, used0: used.amount0, used1: used.amount1, amount0Max, amount1Max }
}

export function formatUnits(value: bigint, decimals: number, digits = 6): string {
  const neg = value < 0n
  const v = neg ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  const frac = v % base
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${fracStr ? '.' + fracStr : ''}`
}

export function parseUnits(value: string, decimals: number): bigint {
  const t = value.trim()
  if (!t || t === '.') return 0n
  const [w, f = ''] = t.split('.')
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0')
}

/** (max-min)/min in percent. Ignores non-positive samples. Null when fewer than 2 prices. */
export function priceSpreadPct(prices: number[]): number | null {
  const xs = prices.filter((p) => Number.isFinite(p) && p > 0)
  if (xs.length < 2) return null
  let min = xs[0]!
  let max = xs[0]!
  for (const p of xs) {
    if (p < min) min = p
    if (p > max) max = p
  }
  return ((max - min) / min) * 100
}

export type RangeEdgeStatus =
  | { level: 'unknown'; distanceLowerPct: number; distanceUpperPct: number }
  | { level: 'inside'; distanceLowerPct: number; distanceUpperPct: number }
  | {
      level: 'near'
      distanceLowerPct: number
      distanceUpperPct: number
      nearest: 'lower' | 'upper'
    }
  | {
      level: 'out'
      side: 'below' | 'above'
      distanceLowerPct: number
      distanceUpperPct: number
    }

/**
 * How close `spot` is to a position's price edges.
 * Out below: spot < lower. Out above: spot >= upper (Uniswap's tick < tickUpper rule).
 * Near: still inside, but either edge is within `nearPct` percent of spot.
 */
export function rangeEdgeStatus(
  spot: number,
  lower: number,
  upper: number,
  nearPct = 5,
): RangeEdgeStatus {
  if (!(spot > 0) || !(lower > 0) || !(upper > lower) || !Number.isFinite(nearPct)) {
    return { level: 'unknown', distanceLowerPct: Number.NaN, distanceUpperPct: Number.NaN }
  }
  const distanceLowerPct = ((spot - lower) / spot) * 100
  const distanceUpperPct = ((upper - spot) / spot) * 100
  if (distanceLowerPct < 0) {
    return { level: 'out', side: 'below', distanceLowerPct, distanceUpperPct }
  }
  if (distanceUpperPct <= 0) {
    return { level: 'out', side: 'above', distanceLowerPct, distanceUpperPct }
  }
  const nearLower = distanceLowerPct <= nearPct
  const nearUpper = distanceUpperPct <= nearPct
  if (nearLower || nearUpper) {
    return {
      level: 'near',
      distanceLowerPct,
      distanceUpperPct,
      nearest: distanceLowerPct <= distanceUpperPct ? 'lower' : 'upper',
    }
  }
  return { level: 'inside', distanceLowerPct, distanceUpperPct }
}

/** Constant-product IL for a full-range 50/50 position, in percent (negative = loss). */
export function fullRangeIlPct(priceMultiplier: number): number | null {
  if (!(priceMultiplier > 0) || !Number.isFinite(priceMultiplier)) return null
  const sqrtK = Math.sqrt(priceMultiplier)
  return ((2 * sqrtK) / (1 + priceMultiplier) - 1) * 100
}

function scaleSqrtPrice(sqrtPriceX96: bigint, priceMultiplier: number): bigint {
  const sqrtM = Math.sqrt(priceMultiplier)
  if (!Number.isFinite(sqrtM) || sqrtM <= 0) return 0n
  const scale = 1_000_000_000n
  const num = BigInt(Math.round(sqrtM * 1_000_000_000))
  if (num <= 0n) return 0n
  return (sqrtPriceX96 * num) / scale
}

/**
 * IL vs holding the position's current tokens, if price is multiplied by `priceMultiplier`.
 * Percent, negative means the LP is worth less than holding. Independent of fee income.
 */
export function impermanentLossPct(args: {
  sqrtPriceX96: bigint
  sqrtLowerX96: bigint
  sqrtUpperX96: bigint
  liquidity: bigint
  priceMultiplier: number
}): number | null {
  if (args.liquidity <= 0n) return null
  if (!(args.priceMultiplier > 0) || !Number.isFinite(args.priceMultiplier)) return null
  if (args.sqrtPriceX96 <= 0n) return null
  const sqrtNext = scaleSqrtPrice(args.sqrtPriceX96, args.priceMultiplier)
  if (sqrtNext <= 0n) return null
  const now = getAmountsForLiquidity(
    args.sqrtPriceX96,
    args.sqrtLowerX96,
    args.sqrtUpperX96,
    args.liquidity,
  )
  const next = getAmountsForLiquidity(
    sqrtNext,
    args.sqrtLowerX96,
    args.sqrtUpperX96,
    args.liquidity,
  )
  const priceNow = priceFromSqrtX96(args.sqrtPriceX96)
  const priceNext = priceNow * args.priceMultiplier
  if (!(priceNext > 0)) return null
  const valueLp = Number(next.amount1) + Number(next.amount0) * priceNext
  const valueHold = Number(now.amount1) + Number(now.amount0) * priceNext
  if (!(valueHold > 0) || !Number.isFinite(valueLp) || !Number.isFinite(valueHold)) return null
  return ((valueLp - valueHold) / valueHold) * 100
}

export const IL_MOVES = [10, -10, 20, -20, 50, -50] as const

export function impermanentLossRows(args: {
  sqrtPriceX96: bigint
  sqrtLowerX96: bigint
  sqrtUpperX96: bigint
  liquidity: bigint
  moves?: readonly number[]
}): { movePct: number; ilPct: number | null }[] {
  const moves = args.moves ?? IL_MOVES
  return moves.map((movePct) => ({
    movePct,
    ilPct: impermanentLossPct({
      sqrtPriceX96: args.sqrtPriceX96,
      sqrtLowerX96: args.sqrtLowerX96,
      sqrtUpperX96: args.sqrtUpperX96,
      liquidity: args.liquidity,
      priceMultiplier: 1 + movePct / 100,
    }),
  }))
}

export function decodePositionInfo(info: bigint): {
  tickLower: number
  tickUpper: number
  hasSubscriber: boolean
} {
  const tickLowerRaw = Number((info >> 8n) & 0xffffffn)
  const tickUpperRaw = Number((info >> 32n) & 0xffffffn)
  const signExtend = (n: number) => (n >= 0x800000 ? n - 0x1000000 : n)
  return {
    tickLower: signExtend(tickLowerRaw),
    tickUpper: signExtend(tickUpperRaw),
    hasSubscriber: (info & 0xffn) !== 0n,
  }
}
