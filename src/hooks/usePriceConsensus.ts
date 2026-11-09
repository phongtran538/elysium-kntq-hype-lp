import { useCallback, useEffect, useRef, useState } from 'react'
import { crossCheckPoolPrice, type PriceConsensus } from '../lib/priceCheck'

const LOADING = 'Đang đối chiếu giá từ nhiều RPC…'

export function usePriceConsensus(pollMs = 60_000, enabled = true) {
  const [result, setResult] = useState<PriceConsensus | null>(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      setResult(await crossCheckPoolPrice())
      setFetchedAt(Date.now())
    } catch (e) {
      setResult({
        samples: [],
        agreed: false,
        agreeing: 0,
        deviationPct: null,
        blockReason: e instanceof Error ? e.message : String(e),
        medianPrice: null,
        medianTick: null,
        medianSqrtPriceX96: null,
        chosenRpc: null,
      })
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(id)
  }, [refresh, pollMs, enabled])

  const blockReason = result == null ? LOADING : result.blockReason
  return { result, blockReason, refresh, fetchedAt }
}
