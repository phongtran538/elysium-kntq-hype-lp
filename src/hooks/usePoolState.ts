import { useCallback, useEffect, useState } from 'react'
import { publicClient } from '../lib/rpcClient'
import { stateViewAbi } from '../abis/stateView'
import { POOL_ID, STATE_VIEW, STALE_MS } from '../config/contracts'
import { priceFromSqrtX96 } from '../lib/math'

export type PoolState = {
  sqrtPriceX96: bigint
  tick: number
  lpFee: number
  liquidity: bigint
  priceKntqPerHype: number
  fetchedAt: number
  stale: boolean
}

export function usePoolState(pollMs = 60_000, enabled = true) {
  const [state, setState] = useState<PoolState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [slot0, liq] = await Promise.all([
        publicClient.readContract({
          address: STATE_VIEW,
          abi: stateViewAbi,
          functionName: 'getSlot0',
          args: [POOL_ID],
        }),
        publicClient.readContract({
          address: STATE_VIEW,
          abi: stateViewAbi,
          functionName: 'getLiquidity',
          args: [POOL_ID],
        }),
      ])
      const [sqrtPriceX96, tick, , lpFee] = slot0
      const price = priceFromSqrtX96(sqrtPriceX96, 18, 18)
      const fetchedAt = Date.now()
      setState({
        sqrtPriceX96,
        tick: Number(tick),
        lpFee: Number(lpFee),
        liquidity: liq,
        // currency1/currency0 = KNTQ per HYPE
        priceKntqPerHype: price,
        fetchedAt,
        stale: false,
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    const staleId = setInterval(() => {
      setState((s) =>
        s ? { ...s, stale: Date.now() - s.fetchedAt > STALE_MS } : s,
      )
    }, 2_000)
    return () => {
      clearInterval(id)
      clearInterval(staleId)
    }
  }, [refresh, pollMs, enabled])

  return { state, error, loading, refresh }
}
