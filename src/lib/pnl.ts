/**
 * P&L for a HYPE/KNTQ position. Amounts are human units (not wei).
 * Price is KNTQ per 1 HYPE.
 *
 * Current value = tokens still in the position, including fees not yet collected.
 * Net = current value + fees already collected − deposit − gas.
 * Vs HODL = (position + all fees) − what the original deposit is worth now.
 * Gas is real spending, so it is in net P&L and not in the HODL comparison.
 */

export type PnlInput = {
  price: number
  deposit0: number
  deposit1: number
  position0: number
  position1: number
  uncollected0: number
  uncollected1: number
  collected0: number
  collected1: number
  gas0: number
  openedAt: number
  now?: number
  hypeUsd?: number | null
}

export type PnlResult = {
  currentHype: number
  currentKntq: number
  feesHype: number
  feesKntq: number
  uncollectedHype: number
  uncollectedKntq: number
  collectedHype: number
  collectedKntq: number
  gasHype: number
  gasKntq: number
  depositHype: number
  depositKntq: number
  ilHype: number
  ilKntq: number
  netHype: number
  netKntq: number
  vsHodlHype: number
  vsHodlKntq: number
  feeAprPct: number | null
  usd: {
    current: number
    fees: number
    uncollected: number
    gas: number
    il: number
    net: number
    vsHodl: number
  } | null
}

export function valueInHype(amount0: number, amount1: number, price: number): number {
  if (!(price > 0) || !Number.isFinite(price)) return amount0
  return amount0 + amount1 / price
}

export function valueInKntq(amount0: number, amount1: number, price: number): number {
  if (!(price > 0) || !Number.isFinite(price)) return amount1
  return amount0 * price + amount1
}

export function computePnl(input: PnlInput): PnlResult | null {
  const price = input.price
  if (!(price > 0) || !Number.isFinite(price)) return null
  const nums = [
    input.deposit0,
    input.deposit1,
    input.position0,
    input.position1,
    input.uncollected0,
    input.uncollected1,
    input.collected0,
    input.collected1,
    input.gas0,
  ]
  if (nums.some((n) => !Number.isFinite(n))) return null

  const current0 = input.position0 + input.uncollected0
  const current1 = input.position1 + input.uncollected1
  const currentHype = valueInHype(current0, current1, price)
  const currentKntq = valueInKntq(current0, current1, price)
  const collectedHype = valueInHype(input.collected0, input.collected1, price)
  const collectedKntq = valueInKntq(input.collected0, input.collected1, price)
  const fees0 = input.collected0 + input.uncollected0
  const fees1 = input.collected1 + input.uncollected1
  const feesHype = valueInHype(fees0, fees1, price)
  const feesKntq = valueInKntq(fees0, fees1, price)
  const uncollectedHype = valueInHype(input.uncollected0, input.uncollected1, price)
  const uncollectedKntq = valueInKntq(input.uncollected0, input.uncollected1, price)
  const depositHype = valueInHype(input.deposit0, input.deposit1, price)
  const depositKntq = valueInKntq(input.deposit0, input.deposit1, price)
  const gasHype = input.gas0
  const gasKntq = input.gas0 * price
  const netHype = currentHype + collectedHype - depositHype - gasHype
  const netKntq = currentKntq + collectedKntq - depositKntq - gasKntq
  const bagHype = valueInHype(
    input.position0 + fees0,
    input.position1 + fees1,
    price,
  )
  const bagKntq = valueInKntq(input.position0 + fees0, input.position1 + fees1, price)
  const vsHodlHype = bagHype - depositHype
  const vsHodlKntq = bagKntq - depositKntq
  const ilHype = -vsHodlHype
  const ilKntq = -vsHodlKntq

  const now = input.now ?? Date.now()
  const ageMs = now - input.openedAt
  let feeAprPct: number | null = null
  if (depositHype > 0 && ageMs >= 60 * 60 * 1000 && feesHype >= 0) {
    const yearMs = 365.25 * 24 * 60 * 60 * 1000
    feeAprPct = (feesHype / depositHype) * (yearMs / ageMs) * 100
  }

  const usdPx = input.hypeUsd
  const usd =
    usdPx != null && usdPx > 0 && Number.isFinite(usdPx)
      ? {
          current: currentHype * usdPx,
          fees: feesHype * usdPx,
          uncollected: uncollectedHype * usdPx,
          gas: gasHype * usdPx,
          il: ilHype * usdPx,
          net: netHype * usdPx,
          vsHodl: vsHodlHype * usdPx,
        }
      : null

  return {
    currentHype,
    currentKntq,
    feesHype,
    feesKntq,
    uncollectedHype,
    uncollectedKntq,
    collectedHype,
    collectedKntq,
    gasHype,
    gasKntq,
    depositHype,
    depositKntq,
    ilHype,
    ilKntq,
    netHype,
    netKntq,
    vsHodlHype,
    vsHodlKntq,
    feeAprPct,
    usd,
  }
}

export function sumPnl(parts: PnlResult[]): PnlResult | null {
  if (parts.length === 0) return null
  const z = (): PnlResult => ({
    currentHype: 0,
    currentKntq: 0,
    feesHype: 0,
    feesKntq: 0,
    uncollectedHype: 0,
    uncollectedKntq: 0,
    collectedHype: 0,
    collectedKntq: 0,
    gasHype: 0,
    gasKntq: 0,
    depositHype: 0,
    depositKntq: 0,
    ilHype: 0,
    ilKntq: 0,
    netHype: 0,
    netKntq: 0,
    vsHodlHype: 0,
    vsHodlKntq: 0,
    feeAprPct: null,
    usd: null,
  })
  const total = parts.reduce((acc, p) => {
    acc.currentHype += p.currentHype
    acc.currentKntq += p.currentKntq
    acc.feesHype += p.feesHype
    acc.feesKntq += p.feesKntq
    acc.uncollectedHype += p.uncollectedHype
    acc.uncollectedKntq += p.uncollectedKntq
    acc.collectedHype += p.collectedHype
    acc.collectedKntq += p.collectedKntq
    acc.gasHype += p.gasHype
    acc.gasKntq += p.gasKntq
    acc.depositHype += p.depositHype
    acc.depositKntq += p.depositKntq
    acc.ilHype += p.ilHype
    acc.ilKntq += p.ilKntq
    acc.netHype += p.netHype
    acc.netKntq += p.netKntq
    acc.vsHodlHype += p.vsHodlHype
    acc.vsHodlKntq += p.vsHodlKntq
    if (p.usd && acc.usd) {
      acc.usd.current += p.usd.current
      acc.usd.fees += p.usd.fees
      acc.usd.uncollected += p.usd.uncollected
      acc.usd.gas += p.usd.gas
      acc.usd.il += p.usd.il
      acc.usd.net += p.usd.net
      acc.usd.vsHodl += p.usd.vsHodl
    } else if (p.usd && !acc.usd) {
      acc.usd = { ...p.usd }
    }
    return acc
  }, z())
  const aprs = parts.map((p) => p.feeAprPct).filter((n): n is number => n != null)
  total.feeAprPct = aprs.length ? aprs.reduce((a, b) => a + b, 0) / aprs.length : null
  return total
}
