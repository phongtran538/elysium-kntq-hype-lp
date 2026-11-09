import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import {
  type Address,
  type Hex,
  parseAbiItem,
} from 'viem'
import { publicClient } from '../lib/rpcClient'
import { positionManagerAbi } from '../abis/positionManager'
import { stateViewAbi } from '../abis/stateView'
import {
  KNTQ,
  NATIVE,
  POOL_ID,
  POOL_KEY,
  POSITION_MANAGER,
  STATE_VIEW,
} from '../config/contracts'
import {
  decodePositionInfo,
  feesFromGrowth,
  getAmountsForLiquidity,
  getSqrtRatioAtTick,
} from '../lib/math'
import type { PoolState } from './usePoolState'

export type LpPosition = {
  tokenId: bigint
  tickLower: number
  tickUpper: number
  liquidity: bigint
  amount0: bigint
  amount1: bigint
  fees0: bigint
  fees1: bigint
  principalUsd: number | null
  feesUsd: number | null
  aprPct: number | null
  inRange: boolean
}

const KNOWN_TOKEN_ID = 1844n
const WEB_CHUNK = 1_800n

type WebScan = { lastBlock: string; ids: string[]; droppedKnown: boolean }

function scanKey(owner: Address): string {
  return `kntq-lp-scan:${owner.toLowerCase()}`
}

function readWebScan(owner: Address): WebScan {
  try {
    const raw = sessionStorage.getItem(scanKey(owner))
    if (!raw) return { lastBlock: '', ids: [], droppedKnown: false }
    const parsed = JSON.parse(raw) as WebScan
    return {
      lastBlock: typeof parsed.lastBlock === 'string' ? parsed.lastBlock : '',
      ids: Array.isArray(parsed.ids) ? parsed.ids.map(String) : [],
      droppedKnown: parsed.droppedKnown === true,
    }
  } catch {
    return { lastBlock: '', ids: [], droppedKnown: false }
  }
}

function writeWebScan(owner: Address, scan: WebScan): void {
  try {
    sessionStorage.setItem(scanKey(owner), JSON.stringify(scan))
  } catch {
    // private mode
  }
}

async function ownerOf(tokenId: bigint): Promise<Address | null> {
  try {
    return await publicClient.readContract({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: 'ownerOf',
      args: [tokenId],
    })
  } catch {
    return null
  }
}

async function tokenIdsForOwner(owner: Address): Promise<bigint[]> {
  const scan = readWebScan(owner)
  const owned = new Set(scan.ids)
  if (!scan.droppedKnown && !owned.has(KNOWN_TOKEN_ID.toString())) {
    const who = await ownerOf(KNOWN_TOKEN_ID)
    if (who && who.toLowerCase() === owner.toLowerCase()) owned.add(KNOWN_TOKEN_ID.toString())
    else if (who) scan.droppedKnown = true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  const next = await publicClient.readContract({
    address: POSITION_MANAGER,
    abi: positionManagerAbi,
    functionName: 'nextTokenId',
  })
  const n = Number(next)
  const startId = Math.max(1, n - 40)
  for (let i = startId; i < n; i += 4) {
    const chunk = Array.from({ length: Math.min(4, n - i) }, (_, k) => BigInt(i + k))
    const owners = await Promise.all(chunk.map((tokenId) => ownerOf(tokenId)))
    owners.forEach((o, idx) => {
      if (o && o.toLowerCase() === owner.toLowerCase()) owned.add(chunk[idx]!.toString())
    })
  }

  try {
    const transferEvent = parseAbiItem(
      'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    )
    const latest = await publicClient.getBlockNumber()
    const stored = scan.lastBlock ? BigInt(scan.lastBlock) : -1n
    const from = stored >= 0n ? stored + 1n : latest > WEB_CHUNK ? latest - WEB_CHUNK : 0n
    if (from <= latest) {
      const to = from + WEB_CHUNK - 1n > latest ? latest : from + WEB_CHUNK - 1n
      const ins = await publicClient.getLogs({
        address: POSITION_MANAGER,
        event: transferEvent,
        args: { to: owner },
        fromBlock: from,
        toBlock: to,
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      const outs = await publicClient.getLogs({
        address: POSITION_MANAGER,
        event: transferEvent,
        args: { from: owner },
        fromBlock: from,
        toBlock: to,
      })
      for (const row of ins) {
        if (row.args.tokenId !== undefined) owned.add(row.args.tokenId.toString())
      }
      for (const row of outs) {
        if (row.args.tokenId !== undefined) owned.delete(row.args.tokenId.toString())
      }
      scan.lastBlock = to.toString()
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('[positions]', /429|rate limit/i.test(message) ? 'RPC bị giới hạn (429).' : 'không đọc hết log Transfer')
  }

  scan.ids = [...owned]
  writeWebScan(owner, scan)
  return [...owned].map((s) => BigInt(s)).sort((a, b) => (a < b ? -1 : 1))
}

function matchesPool(key: {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
}): boolean {
  const c0 = (key.currency0 ?? (key as unknown as Address[])[0]) as Address | undefined
  const c1 = (key.currency1 ?? (key as unknown as Address[])[1]) as Address | undefined
  const fee = Number(key.fee ?? (key as unknown as number[])[2])
  const spacing = Number(key.tickSpacing ?? (key as unknown as number[])[3])
  if (!c0 || !c1) return false
  return (
    c0.toLowerCase() === NATIVE.toLowerCase() &&
    c1.toLowerCase() === KNTQ.toLowerCase() &&
    fee === POOL_KEY.fee &&
    spacing === POOL_KEY.tickSpacing
  )
}

export function usePositions(
  pool: PoolState | null,
  hypeUsd?: number | null,
  opts?: { enabled?: boolean; pollMs?: number },
) {
  const enabled = opts?.enabled !== false
  const pollMs = opts?.pollMs ?? 60_000
  const { address, isConnected } = useAccount()
  const [positions, setPositions] = useState<LpPosition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState(0)
  const feeSnapshotRef = useRef<Map<string, { feesUsd: number; at: number }>>(new Map())
  const poolRef = useRef(pool)
  poolRef.current = pool

  const refresh = useCallback(async () => {
    const poolNow = poolRef.current
    if (!address || !poolNow) {
      setPositions([])
      return
    }
    setLoading(true)
    try {
      const ids = await tokenIdsForOwner(address)
      const enriched: LpPosition[] = []

      for (const tokenId of ids) {
        const [poolAndInfo, liquidity] = await Promise.all([
          publicClient.readContract({
            address: POSITION_MANAGER,
            abi: positionManagerAbi,
            functionName: 'getPoolAndPositionInfo',
            args: [tokenId],
          }),
          publicClient.readContract({
            address: POSITION_MANAGER,
            abi: positionManagerAbi,
            functionName: 'getPositionLiquidity',
            args: [tokenId],
          }),
        ])
        const [key, infoPacked] = poolAndInfo
        if (!matchesPool(key)) continue
        // Hide fully withdrawn empty positions
        if (liquidity === 0n) continue

        const { tickLower, tickUpper } = decodePositionInfo(infoPacked)
        const sqrtA = getSqrtRatioAtTick(tickLower)
        const sqrtB = getSqrtRatioAtTick(tickUpper)
        const { amount0, amount1 } = getAmountsForLiquidity(
          poolNow.sqrtPriceX96,
          sqrtA,
          sqrtB,
          liquidity,
        )

        let fees0 = 0n
        let fees1 = 0n
        try {
          // Official POSM salt = bytes32(tokenId)
          const saltRaw = (`0x${tokenId.toString(16).padStart(64, '0')}`) as Hex
          const [posInfo, growth] = await Promise.all([
            publicClient.readContract({
              address: STATE_VIEW,
              abi: stateViewAbi,
              functionName: 'getPositionInfo',
              args: [POOL_ID, POSITION_MANAGER, tickLower, tickUpper, saltRaw],
            }),
            publicClient.readContract({
              address: STATE_VIEW,
              abi: stateViewAbi,
              functionName: 'getFeeGrowthInside',
              args: [POOL_ID, tickLower, tickUpper],
            }),
          ])
          const [, fee0Last, fee1Last] = posInfo
          const [g0, g1] = growth
          fees0 = feesFromGrowth(liquidity, g0, fee0Last)
          fees1 = feesFromGrowth(liquidity, g1, fee1Last)
        } catch {
          // fee read optional — leave 0
        }

        const price = poolNow.priceKntqPerHype // KNTQ per 1 HYPE
        // Principal in HYPE terms: amount0 + amount1 / price
        const hypePrincipal =
          Number(amount0) / 1e18 + (price > 0 ? Number(amount1) / 1e18 / price : 0)
        const hypeFees =
          Number(fees0) / 1e18 + (price > 0 ? Number(fees1) / 1e18 / price : 0)
        const usd = hypeUsd && hypeUsd > 0 ? hypeUsd : null
        const principalUsd = usd ? hypePrincipal * usd : null
        const feesUsd = usd ? hypeFees * usd : null

        enriched.push({
          tokenId,
          tickLower,
          tickUpper,
          liquidity,
          amount0,
          amount1,
          fees0,
          fees1,
          principalUsd,
          feesUsd,
          aprPct: null,
          inRange: poolNow.tick >= tickLower && poolNow.tick < tickUpper,
        })
      }

      // APR from fee delta vs prior snapshot (~seconds estimate)
      const now = Date.now()
      const nextSnap = new Map(feeSnapshotRef.current)
      for (const p of enriched) {
        const key = p.tokenId.toString()
        const prev = feeSnapshotRef.current.get(key)
        const feesNow = p.feesUsd ?? 0
        if (prev && p.principalUsd && p.principalUsd > 0) {
          const dt = (now - prev.at) / 1000
          if (dt >= 5) {
            const dFee = Math.max(0, feesNow - prev.feesUsd)
            const perSec = dFee / dt
            p.aprPct = (perSec * 86_400 * 365 * 100) / p.principalUsd
          }
        }
        nextSnap.set(key, { feesUsd: feesNow, at: now })
      }
      feeSnapshotRef.current = nextSnap
      setPositions(enriched)
      setUpdatedAt(Date.now())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [address, hypeUsd])

  const poolReady = pool != null
  useEffect(() => {
    if (!enabled || !isConnected || !poolReady) return
    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(id)
  }, [enabled, isConnected, address, poolReady, pollMs, refresh])

  const sorted = useMemo(() => positions, [positions])

  return { positions: sorted, loading, error, refresh, updatedAt }
}
