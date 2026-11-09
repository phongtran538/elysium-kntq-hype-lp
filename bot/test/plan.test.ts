import { describe, expect, it } from 'vitest'
import { POOL_KEY } from '../../src/config/contracts'
import { priceAtTick } from '../../src/config/ranges'
import { getAmountsForLiquidity, getSqrtRatioAtTick, rangeEdgeStatus } from '../../src/lib/math'
import {
  cooldownRemainingMs,
  decideRebalance,
  planSwap,
  rangeAroundTick,
  spendable,
} from '../src/plan'

describe('range snapping', () => {
  it('centers ±RANGE_PCT on the current tick and snaps to spacing 200', () => {
    for (const tick of [-12_345, -1, 0, 1, 12_345]) {
      const range = rangeAroundTick(tick, 20)
      expect(range.tickLower / POOL_KEY.tickSpacing).toBe(
        Math.trunc(range.tickLower / POOL_KEY.tickSpacing),
      )
      expect(range.tickUpper / POOL_KEY.tickSpacing).toBe(
        Math.trunc(range.tickUpper / POOL_KEY.tickSpacing),
      )
      expect(range.tickLower).toBeLessThan(tick)
      expect(range.tickUpper).toBeGreaterThan(tick)
      const spot = priceAtTick(tick)
      const lower = priceAtTick(range.tickLower)
      const upper = priceAtTick(range.tickUpper)
      const down = ((spot - lower) / spot) * 100
      const up = ((upper - spot) / spot) * 100
      expect(down).toBeGreaterThan(10)
      expect(up).toBeGreaterThan(10)
      expect(down).toBeLessThan(35)
      expect(up).toBeLessThan(35)
    }
  })

  it('a ±20% range is not already inside a 5% trigger', () => {
    const tick = 4_321
    const range = rangeAroundTick(tick, 20)
    const status = rangeEdgeStatus(
      priceAtTick(tick),
      priceAtTick(range.tickLower),
      priceAtTick(range.tickUpper),
      5,
    )
    expect(status.level).toBe('inside')
  })
})

describe('rebalance trigger', () => {
  it('stays put when the position is comfortably inside', () => {
    const range = rangeAroundTick(0, 20)
    const decision = decideRebalance({
      price: priceAtTick(0),
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      currentTick: 0,
      triggerPct: 5,
      rangePct: 20,
    })
    expect(decision.action).toBe('none')
  })

  it('triggers inside 5% of an edge and when price is outside', () => {
    const near = decideRebalance({
      price: priceAtTick(0),
      tickLower: -200,
      tickUpper: 200,
      currentTick: 0,
      triggerPct: 5,
      rangePct: 20,
    })
    expect(near.action).toBe('rebalance')
    expect(near.status.level).toBe('near')

    const below = decideRebalance({
      price: priceAtTick(-8_000),
      tickLower: -200,
      tickUpper: 200,
      currentTick: -8_000,
      triggerPct: 5,
      rangePct: 20,
    })
    expect(below.action).toBe('rebalance')
    expect(below.status).toMatchObject({ level: 'out', side: 'below' })

    const above = decideRebalance({
      price: priceAtTick(8_000),
      tickLower: -200,
      tickUpper: 200,
      currentTick: 8_000,
      triggerPct: 5,
      rangePct: 20,
    })
    expect(above.action).toBe('rebalance')
    expect(above.status).toMatchObject({ level: 'out', side: 'above' })
  })

  it('refuses a new range that would immediately retrigger', () => {
    const decision = decideRebalance({
      price: priceAtTick(-8_000),
      tickLower: -200,
      tickUpper: 200,
      currentTick: -8_000,
      triggerPct: 5,
      rangePct: 2,
    })
    expect(decision.action).toBe('skip-hot-range')
  })

  it('treats the upper tick boundary as out and the lower tick as in-range', () => {
    const atUpper = rangeEdgeStatus(priceAtTick(200), priceAtTick(0), priceAtTick(200), 5)
    expect(atUpper.level).toBe('out')
    const atLower = rangeEdgeStatus(priceAtTick(0), priceAtTick(0), priceAtTick(4_000), 5)
    expect(atLower.level === 'out').toBe(false)
  })
})

describe('swap sizing and cooldown', () => {
  it('does not swap when balances already match the range', () => {
    const sqrt = getSqrtRatioAtTick(0)
    const ref = getAmountsForLiquidity(sqrt, getSqrtRatioAtTick(-2_000), getSqrtRatioAtTick(2_000), 10n ** 18n)
    const plan = planSwap({
      bal0: ref.amount0 * 5n,
      bal1: ref.amount1 * 5n,
      sqrtPriceX96: sqrt,
      tickLower: -2_000,
      tickUpper: 2_000,
    })
    expect(plan).toBeNull()
  })

  it('sells the surplus token and never more than the balance', () => {
    const sqrt = getSqrtRatioAtTick(0)
    const onlyHype = planSwap({
      bal0: 2n * 10n ** 18n,
      bal1: 0n,
      sqrtPriceX96: sqrt,
      tickLower: -2_000,
      tickUpper: 2_000,
    })
    expect(onlyHype).not.toBeNull()
    expect(onlyHype!.zeroForOne).toBe(true)
    expect(onlyHype!.amountIn > 0n).toBe(true)
    expect(onlyHype!.amountIn < 2n * 10n ** 18n).toBe(true)

    const onlyKntq = planSwap({
      bal0: 0n,
      bal1: 2n * 10n ** 18n,
      sqrtPriceX96: sqrt,
      tickLower: -2_000,
      tickUpper: 2_000,
    })
    expect(onlyKntq).not.toBeNull()
    expect(onlyKntq!.zeroForOne).toBe(false)
    expect(onlyKntq!.amountIn <= 2n * 10n ** 18n).toBe(true)
  })

  it('sells the whole surplus when the price is outside the new range', () => {
    const above = planSwap({
      bal0: 10n ** 18n,
      bal1: 10n ** 18n,
      sqrtPriceX96: getSqrtRatioAtTick(5_000),
      tickLower: -2_000,
      tickUpper: 2_000,
    })
    expect(above).toEqual({ zeroForOne: true, amountIn: 10n ** 18n })

    const below = planSwap({
      bal0: 10n ** 18n,
      bal1: 3n * 10n ** 18n,
      sqrtPriceX96: getSqrtRatioAtTick(-5_000),
      tickLower: -2_000,
      tickUpper: 2_000,
    })
    expect(below).toEqual({ zeroForOne: false, amountIn: 3n * 10n ** 18n })
  })

  it('keeps a gas reserve and honors the cooldown', () => {
    expect(spendable(100n, 40n)).toBe(60n)
    expect(spendable(10n, 40n)).toBe(0n)
    const now = 1_000_000
    expect(cooldownRemainingMs(null, now, 60)).toBe(0)
    expect(cooldownRemainingMs(now - 10 * 60_000, now, 60)).toBe(50 * 60_000)
    expect(cooldownRemainingMs(now - 120 * 60_000, now, 60)).toBe(0)
  })
})
