import { describe, expect, it } from 'vitest'
import { OFFICIAL_RPC } from '../src/config/rpc'
import { summarizeRpcPrices, type RpcPriceSample } from '../src/lib/priceCheck'

function quote(url: string, price: number): RpcPriceSample {
  return { url, ok: true, price, tick: 1, sqrtPriceX96: 1n }
}

const live = 'https://rpc-live.boxa.club'
const boxa = 'https://rpc.boxa.club'
const eleos = 'https://rpc.eleos.fun'
const swap = 'https://rpc.elysiumswap.finance'
const stockium = 'https://rpc.stockium.fun'

describe('RPC median consensus', () => {
  it('drops the two far quotes and keeps the official RPC when four agree', () => {
    const result = summarizeRpcPrices([
      quote(live, 208.57),
      quote(boxa, 200.07),
      quote(eleos, 208.57),
      quote(swap, 135.9),
      quote(stockium, 208.37),
      quote(OFFICIAL_RPC, 208.57),
    ])
    expect(result.agreed).toBe(true)
    expect(result.agreeing).toBe(4)
    expect(result.blockReason).toBeNull()
    expect(result.chosenRpc).toBe(OFFICIAL_RPC)
    expect(result.medianPrice).toBeCloseTo(208.47, 2)
    const outliers = result.samples.filter((s) => s.outlier).map((s) => s.url)
    expect(outliers).toEqual([boxa, swap])
    expect(result.deviationPct).toBeLessThanOrEqual(1)
  })

  it('blocks when fewer than 3 RPCs sit within 1% of the median', () => {
    const result = summarizeRpcPrices([
      quote(live, 100),
      quote(boxa, 100.5),
      quote(eleos, 250),
    ])
    expect(result.agreed).toBe(false)
    expect(result.agreeing).toBe(2)
    expect(result.samples.find((s) => s.url === eleos)?.outlier).toBe(true)
    expect(result.blockReason).toMatch(/ít nhất 3/)
    expect(result.blockReason).toMatch(/khóa gửi giao dịch/)
  })

  it('does not count a dead RPC, and still allows three that match', () => {
    const result = summarizeRpcPrices([
      quote(OFFICIAL_RPC, 50),
      quote(live, 50.2),
      quote(eleos, 49.9),
      { url: stockium, ok: false, error: 'timeout' },
      quote(swap, 10),
    ])
    expect(result.agreed).toBe(true)
    expect(result.agreeing).toBe(3)
    expect(result.chosenRpc).toBe(OFFICIAL_RPC)
    expect(result.samples.find((s) => s.url === swap)?.outlier).toBe(true)
    expect(result.samples.find((s) => s.url === stockium)?.outlier).toBeFalsy()
  })

  it('blocks when only two RPCs answer', () => {
    const result = summarizeRpcPrices([quote(OFFICIAL_RPC, 10), quote(live, 10.05)])
    expect(result.agreed).toBe(false)
    expect(result.agreeing).toBe(2)
  })
})
