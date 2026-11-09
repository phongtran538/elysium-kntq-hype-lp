import { describe, expect, it } from 'vitest'
import {
  applySlippageMax,
  applySlippageMin,
  decodePositionInfo,
  feesFromGrowth,
  formatUnits,
  fullRangeIlPct,
  getAmountsForLiquidity,
  getLiquidityForAmount0,
  getLiquidityForAmount1,
  getLiquidityForAmounts,
  getSqrtRatioAtTick,
  impermanentLossPct,
  parseUnits,
  priceFromSqrtX96,
  priceSpreadPct,
  rangeEdgeStatus,
} from '../src/lib/math'

const Q96 = 2n ** 96n

describe('price and ticks', () => {
  it('maps sqrtPrice 2^96 to price 1', () => {
    expect(priceFromSqrtX96(Q96, 18, 18)).toBeCloseTo(1, 8)
    expect(priceFromSqrtX96(0n)).toBe(0)
  })

  it('getSqrtRatioAtTick(0) is exactly 2^96', () => {
    expect(getSqrtRatioAtTick(0)).toBe(Q96)
  })

  it('sqrt price increases with tick, including protocol bounds', () => {
    const ticks = [-887272, -887200, -200, -1, 0, 1, 200, 887200, 887272]
    const ratios = ticks.map((t) => getSqrtRatioAtTick(t))
    for (const r of ratios) expect(r > 0n).toBe(true)
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]! > ratios[i - 1]!).toBe(true)
    }
  })

  it('sqrt price matches 1.0001^tick on common ticks', () => {
    for (const tick of [-2000, -200, 0, 200, 2000]) {
      const fromSqrt = priceFromSqrtX96(getSqrtRatioAtTick(tick), 18, 18)
      const fromTick = 1.0001 ** tick
      expect(fromSqrt).toBeCloseTo(fromTick, 4)
    }
  })
})

describe('liquidity amounts', () => {
  const sqrtA = getSqrtRatioAtTick(-2_000)
  const sqrtB = getSqrtRatioAtTick(2_000)
  const liquidity = 10n ** 18n
  const amount0 = 10n ** 18n
  const amount1 = 10n ** 18n

  it('in range uses both tokens and round-trips under the budgets', () => {
    const sqrtP = getSqrtRatioAtTick(0)
    const used = getAmountsForLiquidity(sqrtP, sqrtA, sqrtB, liquidity)
    expect(used.amount0 > 0n).toBe(true)
    expect(used.amount1 > 0n).toBe(true)

    const liq = getLiquidityForAmounts(sqrtP, sqrtA, sqrtB, amount0, amount1)
    const back = getAmountsForLiquidity(sqrtP, sqrtA, sqrtB, liq)
    expect(back.amount0 <= amount0).toBe(true)
    expect(back.amount1 <= amount1).toBe(true)
    expect(back.amount0 > 0n && back.amount1 > 0n).toBe(true)

    const liq0 = getLiquidityForAmount0(sqrtP, sqrtB, amount0)
    const liq1 = getLiquidityForAmount1(sqrtA, sqrtP, amount1)
    expect(liq).toBe(liq0 < liq1 ? liq0 : liq1)
  })

  it('below the range is token0 only, including the lower boundary', () => {
    const below = getAmountsForLiquidity(getSqrtRatioAtTick(-4_000), sqrtA, sqrtB, liquidity)
    expect(below.amount1).toBe(0n)
    expect(below.amount0 > 0n).toBe(true)

    const atLower = getAmountsForLiquidity(sqrtA, sqrtA, sqrtB, liquidity)
    expect(atLower.amount1).toBe(0n)
    expect(atLower.amount0 > 0n).toBe(true)

    const liq = getLiquidityForAmounts(
      getSqrtRatioAtTick(-4_000),
      sqrtA,
      sqrtB,
      amount0,
      amount1 * 5n,
    )
    expect(liq).toBe(getLiquidityForAmount0(sqrtA, sqrtB, amount0))
  })

  it('above the range is token1 only, including the upper boundary', () => {
    const above = getAmountsForLiquidity(getSqrtRatioAtTick(4_000), sqrtA, sqrtB, liquidity)
    expect(above.amount0).toBe(0n)
    expect(above.amount1 > 0n).toBe(true)

    const atUpper = getAmountsForLiquidity(sqrtB, sqrtA, sqrtB, liquidity)
    expect(atUpper.amount0).toBe(0n)
    expect(atUpper.amount1 > 0n).toBe(true)

    const liq = getLiquidityForAmounts(
      getSqrtRatioAtTick(4_000),
      sqrtA,
      sqrtB,
      amount0 * 5n,
      amount1,
    )
    expect(liq).toBe(getLiquidityForAmount1(sqrtA, sqrtB, amount1))
  })

  it('swapped bounds match sorted bounds, and zero liquidity is zero', () => {
    const sqrtP = getSqrtRatioAtTick(100)
    const a = getAmountsForLiquidity(sqrtP, sqrtA, sqrtB, liquidity)
    const b = getAmountsForLiquidity(sqrtP, sqrtB, sqrtA, liquidity)
    expect(a).toEqual(b)
    expect(getAmountsForLiquidity(sqrtP, sqrtA, sqrtB, 0n)).toEqual({ amount0: 0n, amount1: 0n })
  })
})

describe('fees, slippage, units, position info', () => {
  it('computes fee growth including a uint256 wrap', () => {
    const liquidity = 1000n
    expect(feesFromGrowth(0n, 5n, 1n)).toBe(0n)
    expect(feesFromGrowth(liquidity, 2n ** 128n, 0n)).toBe(liquidity)
    const last = 2n ** 256n - 10n
    const now = 5n
    expect(feesFromGrowth(liquidity, now, last)).toBe((15n * liquidity) / 2n ** 128n)
  })

  it('applies user slippage without going negative', () => {
    expect(applySlippageMax(1_000_000n, 0.5)).toBe(1_005_000n)
    expect(applySlippageMin(1_000_000n, 0.5)).toBe(995_000n)
    expect(applySlippageMin(10n, 50)).toBe(5n)
    expect(applySlippageMin(1n, 100)).toBe(0n)
  })

  it('parses and formats token units', () => {
    expect(parseUnits('1.5', 18)).toBe(15n * 10n ** 17n)
    expect(parseUnits('', 18)).toBe(0n)
    expect(parseUnits('.', 18)).toBe(0n)
    expect(formatUnits(15n * 10n ** 17n, 18, 6)).toBe('1.5')
    expect(formatUnits(-(10n ** 18n), 18, 2)).toBe('-1')
  })

  it('decodes signed ticks and the subscriber flag', () => {
    const enc = (n: number) => BigInt((n + 0x1000000) % 0x1000000)
    const pack = (tickLower: number, tickUpper: number, sub: number) =>
      BigInt(sub) | (enc(tickLower) << 8n) | (enc(tickUpper) << 32n)
    expect(decodePositionInfo(pack(-200, 400, 1))).toEqual({
      tickLower: -200,
      tickUpper: 400,
      hasSubscriber: true,
    })
    expect(decodePositionInfo(pack(0, 200, 0))).toEqual({
      tickLower: 0,
      tickUpper: 200,
      hasSubscriber: false,
    })
  })
})

describe('price spread, range edge, impermanent loss', () => {
  it('measures spread and ignores empty samples', () => {
    expect(priceSpreadPct([100, 101])).toBeCloseTo(1, 8)
    expect(priceSpreadPct([100, 102])).toBeCloseTo(2, 8)
    expect(priceSpreadPct([100])).toBeNull()
    expect(priceSpreadPct([100, 0, 100.5])).toBeCloseTo(0.5, 8)
  })

  it('flags out of range, near an edge, and comfortably inside', () => {
    expect(rangeEdgeStatus(70, 80, 120, 5)).toMatchObject({ level: 'out', side: 'below' })
    expect(rangeEdgeStatus(120, 80, 120, 5)).toMatchObject({ level: 'out', side: 'above' })
    expect(rangeEdgeStatus(80, 80, 120, 5).level).toBe('near')
    const near = rangeEdgeStatus(100, 96, 130, 5)
    expect(near.level).toBe('near')
    if (near.level === 'near') expect(near.nearest).toBe('lower')
    expect(rangeEdgeStatus(100, 80, 120, 5).level).toBe('inside')
    expect(rangeEdgeStatus(0, 80, 120, 5).level).toBe('unknown')
  })

  it('matches the constant-product IL curve and is ~0 when price does not move', () => {
    expect(fullRangeIlPct(1)).toBeCloseTo(0, 8)
    expect(fullRangeIlPct(1.1)).toBeCloseTo(-0.1137, 2)
    expect(fullRangeIlPct(1.2)).toBeCloseTo(-0.413, 2)
    expect(fullRangeIlPct(1.5)).toBeCloseTo(-2.02, 2)
    expect(fullRangeIlPct(1.1)).toBeCloseTo(fullRangeIlPct(1 / 1.1)!, 6)

    const sqrt = getSqrtRatioAtTick(0)
    const il = impermanentLossPct({
      sqrtPriceX96: sqrt,
      sqrtLowerX96: getSqrtRatioAtTick(-10_000),
      sqrtUpperX96: getSqrtRatioAtTick(10_000),
      liquidity: 10n ** 18n,
      priceMultiplier: 1,
    })
    expect(il).not.toBeNull()
    expect(Math.abs(il!)).toBeLessThan(0.05)
  })

  it('a narrow range loses more than full-range IL on a large move', () => {
    const wide = impermanentLossPct({
      sqrtPriceX96: getSqrtRatioAtTick(0),
      sqrtLowerX96: getSqrtRatioAtTick(-80_000),
      sqrtUpperX96: getSqrtRatioAtTick(80_000),
      liquidity: 10n ** 18n,
      priceMultiplier: 1.5,
    })
    const narrow = impermanentLossPct({
      sqrtPriceX96: getSqrtRatioAtTick(0),
      sqrtLowerX96: getSqrtRatioAtTick(-500),
      sqrtUpperX96: getSqrtRatioAtTick(500),
      liquidity: 10n ** 18n,
      priceMultiplier: 1.5,
    })
    expect(wide).not.toBeNull()
    expect(narrow).not.toBeNull()
    expect(narrow!).toBeLessThan(wide!)
    expect(narrow!).toBeLessThan(fullRangeIlPct(1.5)!)
  })
})
