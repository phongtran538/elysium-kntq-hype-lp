import {
  type Address,
  type Hex,
  type PublicClient,
  parseAbiItem,
} from 'viem'
import { positionManagerAbi } from '../../src/abis/positionManager'
import { stateViewAbi } from '../../src/abis/stateView'
import {
  KNTQ,
  NATIVE,
  POOL_ID,
  POOL_KEY,
  POSITION_MANAGER,
  STATE_VIEW,
} from '../../src/config/contracts'
import { priceAtTick } from '../../src/config/ranges'
import {
  decodePositionInfo,
  feesFromGrowth,
  getAmountsForLiquidity,
  getSqrtRatioAtTick,
} from '../../src/lib/math'
import {
  KNOWN_MINT_BLOCK,
  LOG_PACE_MS,
  applyTransfers,
  scanFromBlock,
  planLogChunks,
  seedKnownToken,
  nextPaceMs,
  dropToken,
  type ScanIndex,
  type TransferHit,
} from '../../src/lib/logScan'
import { log, safeError } from './log'
import { sleep } from './retry'
import { loadScanIndex, saveScanIndex } from './scanStore'

export type BotPosition = {
  tokenId: bigint
  tickLower: number
  tickUpper: number
  liquidity: bigint
  amount0: bigint
  amount1: bigint
  fees0: bigint
  fees1: bigint
  feesKnown: boolean
  lowerPrice: number
  upperPrice: number
}

function matchesPool(key: {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
}): boolean {
  return (
    key.currency0.toLowerCase() === NATIVE.toLowerCase() &&
    key.currency1.toLowerCase() === KNTQ.toLowerCase() &&
    Number(key.fee) === POOL_KEY.fee &&
    Number(key.tickSpacing) === POOL_KEY.tickSpacing
  )
}

type PositionCache = {
  wallet: string
  sqrt: string
  at: number
  positions: BotPosition[]
}

let positionCache: PositionCache | null = null
let inflight: Promise<BotPosition[]> | null = null
let inflightKey = ''

export async function loadPositions(
  client: PublicClient,
  owner: Address,
  sqrtPriceX96: bigint,
  opts?: { startBlock?: bigint; cacheMs?: number },
): Promise<BotPosition[]> {
  const cacheMs = opts?.cacheMs ?? 55_000
  const sqrt = sqrtPriceX96.toString()
  const key = `${owner.toLowerCase()}:${sqrt}`
  if (
    positionCache &&
    positionCache.wallet === owner.toLowerCase() &&
    positionCache.sqrt === sqrt &&
    Date.now() - positionCache.at < cacheMs
  ) {
    return positionCache.positions
  }
  if (inflight && inflightKey === key) return inflight
  inflightKey = key
  const run = loadPositionsFresh(client, owner, sqrtPriceX96, opts?.startBlock)
  inflight = run
  void run.finally(() => {
    if (inflight === run) inflight = null
  })
  return run
}

async function loadPositionsFresh(
  client: PublicClient,
  owner: Address,
  sqrtPriceX96: bigint,
  startBlock = 3_300_000n,
): Promise<BotPosition[]> {
  let index = seedKnownToken(loadScanIndex(owner))
  saveScanIndex(index)
  const reachedHead = await scanNewLogs(client, owner, index, startBlock)
  index = loadScanIndex(owner)

  const positions: BotPosition[] = []
  for (const idStr of index.tokenIds) {
    const tokenId = BigInt(idStr)
    const [poolAndInfo, liquidity, tokenOwner] = await Promise.all([
      client.readContract({
        address: POSITION_MANAGER,
        abi: positionManagerAbi,
        functionName: 'getPoolAndPositionInfo',
        args: [tokenId],
      }),
      client.readContract({
        address: POSITION_MANAGER,
        abi: positionManagerAbi,
        functionName: 'getPositionLiquidity',
        args: [tokenId],
      }),
      client.readContract({
        address: POSITION_MANAGER,
        abi: positionManagerAbi,
        functionName: 'ownerOf',
        args: [tokenId],
      }).catch(() => null),
    ])
    if (!tokenOwner || tokenOwner.toLowerCase() !== owner.toLowerCase()) {
      if (tokenOwner) {
        index = dropToken(index, idStr)
        saveScanIndex(index)
      }
      continue
    }
    const [key, packed] = poolAndInfo
    if (!matchesPool(key)) continue
    if (liquidity === 0n) continue
    const { tickLower, tickUpper } = decodePositionInfo(packed)
    const amounts = getAmountsForLiquidity(
      sqrtPriceX96,
      getSqrtRatioAtTick(tickLower),
      getSqrtRatioAtTick(tickUpper),
      liquidity,
    )
    let fees0 = 0n
    let fees1 = 0n
    let feesKnown = false
    try {
      const salt = (`0x${tokenId.toString(16).padStart(64, '0')}`) as Hex
      const [posInfo, growth] = await Promise.all([
        client.readContract({
          address: STATE_VIEW,
          abi: stateViewAbi,
          functionName: 'getPositionInfo',
          args: [POOL_ID, POSITION_MANAGER, tickLower, tickUpper, salt],
        }),
        client.readContract({
          address: STATE_VIEW,
          abi: stateViewAbi,
          functionName: 'getFeeGrowthInside',
          args: [POOL_ID, tickLower, tickUpper],
        }),
      ])
      fees0 = feesFromGrowth(liquidity, growth[0], posInfo[1])
      fees1 = feesFromGrowth(liquidity, growth[1], posInfo[2])
      feesKnown = true
    } catch (e) {
      log(`Không đọc được phí của vị thế #${tokenId}: ${safeError(e)}`)
    }
    positions.push({
      tokenId,
      tickLower,
      tickUpper,
      liquidity,
      amount0: amounts.amount0,
      amount1: amounts.amount1,
      fees0,
      fees1,
      feesKnown,
      lowerPrice: priceAtTick(tickLower),
      upperPrice: priceAtTick(tickUpper),
    })
  }

  if (reachedHead) {
    positionCache = {
      wallet: owner.toLowerCase(),
      sqrt: sqrtPriceX96.toString(),
      at: Date.now(),
      positions,
    }
  }
  try {
    const balance = await client.readContract({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: 'balanceOf',
      args: [owner],
    })
    if (balance > BigInt(positions.length)) {
      log(
        `Ví đang giữ ${balance} NFT, bot thấy ${positions.length} vị thế trong pool này. Lần quét sau chỉ đọc block mới.`,
      )
    }
  } catch (e) {
    log(`Không đọc được balanceOf: ${safeError(e)}`)
  }
  return positions
}

async function scanNewLogs(
  client: PublicClient,
  owner: Address,
  index: ScanIndex,
  startBlock: bigint,
): Promise<boolean> {
  const knownMints = index.dropped.includes('1844') ? [] : [KNOWN_MINT_BLOCK]
  const from = scanFromBlock(index, startBlock, knownMints)
  let latest: bigint
  try {
    latest = await client.getBlockNumber()
  } catch (e) {
    log(`Không đọc được block mới: ${safeError(e)}`)
    return false
  }
  const chunks = planLogChunks(from, latest)
  if (chunks.length === 0) return true
  if (index.lastScannedBlock == null) {
    log(
      `Quét log lần đầu từ block ${from} đến ${latest} (${chunks.length} đoạn, khoảng ${LOG_PACE_MS}ms mỗi yêu cầu). Lần sau chỉ đọc block mới.`,
    )
  }
  const transferEvent = parseAbiItem(
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  )
  let pace = LOG_PACE_MS
  let current = index
  let done = 0
  for (const chunk of chunks) {
    if (done > 0) await sleep(pace)
    try {
      const ins = await client.getLogs({
        address: POSITION_MANAGER,
        event: transferEvent,
        args: { to: owner },
        fromBlock: chunk.from,
        toBlock: chunk.to,
      })
      await sleep(pace)
      const outs = await client.getLogs({
        address: POSITION_MANAGER,
        event: transferEvent,
        args: { from: owner },
        fromBlock: chunk.from,
        toBlock: chunk.to,
      })
      const hits: TransferHit[] = []
      for (const row of ins) {
        if (row.args.tokenId === undefined) continue
        const fromAddr = row.args.from?.toLowerCase()
        hits.push({
          tokenId: row.args.tokenId.toString(),
          toOwner: true,
          blockNumber: row.blockNumber ?? undefined,
          mint: fromAddr === '0x0000000000000000000000000000000000000000',
        })
      }
      for (const row of outs) {
        if (row.args.tokenId === undefined) continue
        hits.push({
          tokenId: row.args.tokenId.toString(),
          toOwner: false,
          blockNumber: row.blockNumber ?? undefined,
        })
      }
      current = applyTransfers(current, hits, chunk.to)
      saveScanIndex(current)
      pace = nextPaceMs(pace, false)
      done += 1
      if (chunks.length > 20 && done % 25 === 0) {
        log(`Đã quét đến block ${chunk.to} / ${latest}.`)
      }
    } catch (e) {
      pace = nextPaceMs(pace, true)
      log(`Dừng quét log ở block ${chunk.from}. ${safeError(e)} Lần sau quét tiếp từ đây.`)
      return false
    }
  }
  return true
}
