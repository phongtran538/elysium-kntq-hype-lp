/**
 * Uniswap V4 PositionManager action encoding
 * Actions from v4-periphery/src/libraries/Actions.sol
 */
import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Address,
  type Hex,
  concatHex,
} from 'viem'
import { POOL_KEY, NATIVE, UNIVERSAL_ROUTER } from '../config/contracts'

export const Actions = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SWAP_EXACT_IN_SINGLE: 0x06,
  SETTLE_ALL: 0x0c,
  SETTLE_PAIR: 0x0d,
  TAKE_ALL: 0x0f,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
  SWEEP: 0x14,
} as const

/** Universal Router command byte. v2.1.2 uses the same V4_SWAP opcode as v2.1.1. */
export const UR_V4_SWAP = 0x10

export const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export type PoolKeyStruct = {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

const poolKeyType = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const

function packActions(actions: number[]): Hex {
  return encodePacked(
    actions.map(() => 'uint8' as const),
    actions.map((a) => a),
  )
}

function encodeUnlockData(actions: number[], params: Hex[]): Hex {
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [packActions(actions), params],
  )
}

export function encodeMintPosition(args: {
  tickLower: number
  tickUpper: number
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
  recipient: Address
  hookData?: Hex
}): { unlockData: Hex; value: bigint } {
  const hookData = args.hookData ?? '0x'
  const mintParams = encodeAbiParameters(
    [
      poolKeyType,
      { type: 'int24' },
      { type: 'int24' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'address' },
      { type: 'bytes' },
    ],
    [
      {
        currency0: POOL_KEY.currency0,
        currency1: POOL_KEY.currency1,
        fee: POOL_KEY.fee,
        tickSpacing: POOL_KEY.tickSpacing,
        hooks: POOL_KEY.hooks,
      },
      args.tickLower,
      args.tickUpper,
      args.liquidity,
      args.amount0Max,
      args.amount1Max,
      args.recipient,
      hookData,
    ],
  )
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [POOL_KEY.currency0, POOL_KEY.currency1],
  )
  // Native currency0 → SETTLE_PAIR + SWEEP excess ETH
  const sweepParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [NATIVE, args.recipient],
  )
  const unlockData = encodeUnlockData(
    [Actions.MINT_POSITION, Actions.SETTLE_PAIR, Actions.SWEEP],
    [mintParams, settleParams, sweepParams],
  )
  return { unlockData, value: args.amount0Max }
}

export function encodeIncreaseLiquidity(args: {
  tokenId: bigint
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
  recipient: Address
  hookData?: Hex
}): { unlockData: Hex; value: bigint } {
  const hookData = args.hookData ?? '0x'
  const inc = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [args.tokenId, args.liquidity, args.amount0Max, args.amount1Max, hookData],
  )
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [POOL_KEY.currency0, POOL_KEY.currency1],
  )
  const sweepParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [NATIVE, args.recipient],
  )
  return {
    unlockData: encodeUnlockData(
      [Actions.INCREASE_LIQUIDITY, Actions.SETTLE_PAIR, Actions.SWEEP],
      [inc, settleParams, sweepParams],
    ),
    value: args.amount0Max,
  }
}

/** Collect fees only: decrease 0 liquidity + TAKE_PAIR */
export function encodeCollectFees(args: {
  tokenId: bigint
  recipient: Address
  amount0Min?: bigint
  amount1Min?: bigint
  hookData?: Hex
}): { unlockData: Hex; value: bigint } {
  const hookData = args.hookData ?? '0x'
  const dec = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [args.tokenId, 0n, args.amount0Min ?? 0n, args.amount1Min ?? 0n, hookData],
  )
  const take = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [POOL_KEY.currency0, POOL_KEY.currency1, args.recipient],
  )
  return {
    unlockData: encodeUnlockData(
      [Actions.DECREASE_LIQUIDITY, Actions.TAKE_PAIR],
      [dec, take],
    ),
    value: 0n,
  }
}

export function encodeDecreaseLiquidity(args: {
  tokenId: bigint
  liquidity: bigint
  amount0Min: bigint
  amount1Min: bigint
  recipient: Address
  burn?: boolean
  hookData?: Hex
}): { unlockData: Hex; value: bigint } {
  const hookData = args.hookData ?? '0x'
  if (args.burn) {
    const burn = encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'uint128' },
        { type: 'uint128' },
        { type: 'bytes' },
      ],
      [args.tokenId, args.amount0Min, args.amount1Min, hookData],
    )
    const take = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
      [POOL_KEY.currency0, POOL_KEY.currency1, args.recipient],
    )
    return {
      unlockData: encodeUnlockData(
        [Actions.BURN_POSITION, Actions.TAKE_PAIR],
        [burn, take],
      ),
      value: 0n,
    }
  }
  const dec = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [args.tokenId, args.liquidity, args.amount0Min, args.amount1Min, hookData],
  )
  const take = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [POOL_KEY.currency0, POOL_KEY.currency1, args.recipient],
  )
  return {
    unlockData: encodeUnlockData(
      [Actions.DECREASE_LIQUIDITY, Actions.TAKE_PAIR],
      [dec, take],
    ),
    value: 0n,
  }
}

/**
 * Withdraw everything: decrease liquidity to 0 (principal + fees),
 * TAKE_PAIR to the recipient, then BURN_POSITION.
 * Burn sees zero liquidity and only destroys the NFT.
 */
export function encodeClosePosition(args: {
  tokenId: bigint
  liquidity: bigint
  amount0Min: bigint
  amount1Min: bigint
  recipient: Address
  hookData?: Hex
}): { unlockData: Hex; value: bigint } {
  const hookData = args.hookData ?? '0x'
  const dec = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [args.tokenId, args.liquidity, args.amount0Min, args.amount1Min, hookData],
  )
  const take = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [POOL_KEY.currency0, POOL_KEY.currency1, args.recipient],
  )
  const burn = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [args.tokenId, 0n, 0n, hookData],
  )
  return {
    unlockData: encodeUnlockData(
      [Actions.DECREASE_LIQUIDITY, Actions.TAKE_PAIR, Actions.BURN_POSITION],
      [dec, take, burn],
    ),
    value: 0n,
  }
}

const swapSingleType = {
  type: 'tuple',
  components: [
    {
      name: 'poolKey',
      type: 'tuple',
      components: poolKeyType.components,
    },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountIn', type: 'uint128' },
    { name: 'amountOutMinimum', type: 'uint128' },
    { name: 'minHopPriceX36', type: 'uint256' },
    { name: 'hookData', type: 'bytes' },
  ],
} as const

/**
 * Exact-input swap through THIS pool only, via Universal Router v2.1.2.
 * minHopPriceX36 defaults to 0 (per-hop floor off). amountOutMinimum is the slippage bound.
 * zeroForOne sells native HYPE, so value = amountIn. Selling KNTQ sends value 0 (Permit2 pays).
 */
export function encodeV4ExactInputSingle(args: {
  zeroForOne: boolean
  amountIn: bigint
  amountOutMinimum: bigint
  deadline: bigint
  minHopPriceX36?: bigint
}): { to: Address; data: Hex; value: bigint } {
  const hookData: Hex = '0x'
  const minHop = args.minHopPriceX36 ?? 0n
  const inputCurrency = args.zeroForOne ? POOL_KEY.currency0 : POOL_KEY.currency1
  const outputCurrency = args.zeroForOne ? POOL_KEY.currency1 : POOL_KEY.currency0
  const swapParams = encodeAbiParameters([swapSingleType], [
    {
      poolKey: {
        currency0: POOL_KEY.currency0,
        currency1: POOL_KEY.currency1,
        fee: POOL_KEY.fee,
        tickSpacing: POOL_KEY.tickSpacing,
        hooks: POOL_KEY.hooks,
      },
      zeroForOne: args.zeroForOne,
      amountIn: args.amountIn,
      amountOutMinimum: args.amountOutMinimum,
      minHopPriceX36: minHop,
      hookData,
    },
  ])
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [inputCurrency, args.amountIn],
  )
  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [outputCurrency, args.amountOutMinimum],
  )
  const actions = packActions([
    Actions.SWAP_EXACT_IN_SINGLE,
    Actions.SETTLE_ALL,
    Actions.TAKE_ALL,
  ])
  const payload = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [actions, [swapParams, settleParams, takeParams]],
  )
  const commands = encodePacked(['uint8'], [UR_V4_SWAP])
  const data = encodeFunctionData({
    abi: universalRouterAbi,
    functionName: 'execute',
    args: [commands, [payload], args.deadline],
  })
  return {
    to: UNIVERSAL_ROUTER,
    data,
    value: args.zeroForOne ? args.amountIn : 0n,
  }
}

/** unused but kept for debugging packed bytes */
export function debugConcat(...parts: Hex[]): Hex {
  return concatHex(parts)
}
