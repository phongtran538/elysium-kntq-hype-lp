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
import { log, safeError } from './log'

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

async function ownerOfChunk(
  client: PublicClient,
  ids: bigint[],
  owner: Address,
): Promise<bigint[]> {
  const out = await client.multicall({
    allowFailure: true,
    contracts: ids.map((tokenId) => ({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: 'ownerOf' as const,
      args: [tokenId] as const,
    })),
  })
  const owned: bigint[] = []
  out.forEach((row, i) => {
    if (row.status === 'success' && row.result.toLowerCase() === owner.toLowerCase()) {
      owned.push(ids[i]!)
    }
  })
  return owned
}

export async function loadPositions(
  client: PublicClient,
  owner: Address,
  sqrtPriceX96: bigint,
): Promise<BotPosition[]> {
  const next = await client.readContract({
    address: POSITION_MANAGER,
    abi: positionManagerAbi,
    functionName: 'nextTokenId',
  })
  const n = Number(next)
  const window = Math.min(Math.max(n - 1, 0), 400)
  const start = Math.max(1, n - window)
  const ids: bigint[] = []
  for (let i = start; i < n; i++) ids.push(BigInt(i))

  const owned = new Set<string>()
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80)
    const hits = await ownerOfChunk(client, chunk, owner)
    for (const id of hits) owned.add(id.toString())
  }

  try {
    const balance = await client.readContract({
      address: POSITION_MANAGER,
      abi: positionManagerAbi,
      functionName: 'balanceOf',
      args: [owner],
    })
    if (balance > BigInt(owned.size)) {
      log(
        `Ví đang giữ ${balance} NFT nhưng mới thấy ${owned.size} cái trong cửa sổ token gần đây. Đang đọc thêm log Transfer.`,
      )
    }
  } catch (e) {
    log(`Không đọc được balanceOf: ${safeError(e)}`)
  }

  try {
    const transferEvent = parseAbiItem(
      'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    )
    const latest = await client.getBlockNumber()
    const step = 1800n
    const lookback = 30_000n
    const from0 = latest > lookback ? latest - lookback : 0n
    for (let from = from0; from <= latest; from += step + 1n) {
      const to = from + step > latest ? latest : from + step
      const [ins, outs] = await Promise.all([
        client.getLogs({
          address: POSITION_MANAGER,
          event: transferEvent,
          args: { to: owner },
          fromBlock: from,
          toBlock: to,
        }),
        client.getLogs({
          address: POSITION_MANAGER,
          event: transferEvent,
          args: { from: owner },
          fromBlock: from,
          toBlock: to,
        }),
      ])
      for (const row of ins) {
        if (row.args.tokenId !== undefined) owned.add(row.args.tokenId.toString())
      }
      for (const row of outs) {
        if (row.args.tokenId !== undefined) owned.delete(row.args.tokenId.toString())
      }
    }
  } catch (e) {
    log(`Không đọc hết log Transfer (RPC giới hạn khoảng 2000 block): ${safeError(e)}`)
  }

  const positions: BotPosition[] = []
  for (const idStr of [...owned].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))) {
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
    if (!tokenOwner || tokenOwner.toLowerCase() !== owner.toLowerCase()) continue
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

  return positions
}
