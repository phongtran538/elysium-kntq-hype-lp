import { decodeAbiParameters, decodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'
import { NATIVE, UNIVERSAL_ROUTER } from '../src/config/contracts'
import {
  encodeClosePosition,
  encodeCollectFees,
  encodeIncreaseLiquidity,
  encodeMintPosition,
  encodeV4ExactInputSingle,
  universalRouterAbi,
} from '../src/lib/actions'

function sweepCurrency(unlockData: `0x${string}`): string {
  const [, params] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    unlockData,
  )
  const sweep = params[params.length - 1]!
  const [currency] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    sweep,
  )
  return currency.toLowerCase()
}

function decreaseParams(unlockData: `0x${string}`) {
  const [actions, params] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    unlockData,
  )
  const [tokenId, liquidity, amount0Min, amount1Min] = decodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    params[0]!,
  )
  return { actions, tokenId, liquidity, amount0Min, amount1Min }
}

describe('action encoding', () => {
  it('collects fees with a zero minimum so liquidity 0 does not revert', () => {
    const recipient = '0x0000000000000000000000000000000000000001'
    const { unlockData, value } = encodeCollectFees({ tokenId: 1844n, recipient })
    expect(value).toBe(0n)
    const decoded = decreaseParams(unlockData)
    // DECREASE_LIQUIDITY, TAKE_PAIR
    expect(decoded.actions).toBe('0x0111')
    expect(decoded.tokenId).toBe(1844n)
    expect(decoded.liquidity).toBe(0n)
    // The failed collect used fee estimates as mins. The contract checks principal, which is 0.
    expect(decoded.amount0Min).toBe(0n)
    expect(decoded.amount1Min).toBe(0n)
    expect(unlockData.includes('34ce586c061bb4')).toBe(false)
    expect(unlockData.includes('28a102ad1501450e')).toBe(false)
  })

  it('packs decrease, take, and burn for a full close', () => {
    const { unlockData, value } = encodeClosePosition({
      tokenId: 7n,
      liquidity: 123n,
      amount0Min: 5n,
      amount1Min: 9n,
      recipient: '0x0000000000000000000000000000000000000001',
    })
    expect(value).toBe(0n)
    const [actions] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes[]' }],
      unlockData,
    )
    // DECREASE_LIQUIDITY, TAKE_PAIR, BURN_POSITION
    expect(actions).toBe('0x011103')
    const decoded = decreaseParams(unlockData)
    expect(decoded.liquidity).toBe(123n)
    expect(decoded.amount0Min).toBe(5n)
    expect(decoded.amount1Min).toBe(9n)
    const [, params] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes[]' }],
      unlockData,
    )
    const [, burn0, burn1] = decodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
      params[2]!,
    )
    expect(burn0).toBe(0n)
    expect(burn1).toBe(0n)
  })

  it('encodes a V4 exact-input swap with slippage and a deadline', () => {
    const encoded = encodeV4ExactInputSingle({
      zeroForOne: true,
      amountIn: 1_000n,
      amountOutMinimum: 900n,
      deadline: 1_700_000_000n,
    })
    expect(encoded.to).toBe(UNIVERSAL_ROUTER)
    expect(encoded.value).toBe(1_000n)
    const decoded = decodeFunctionData({ abi: universalRouterAbi, data: encoded.data })
    expect(decoded.functionName).toBe('execute')
    const [commands, inputs, deadline] = decoded.args
    expect(commands).toBe('0x10')
    expect(deadline).toBe(1_700_000_000n)
    const [actions, params] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes[]' }],
      inputs[0]!,
    )
    // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    expect(actions).toBe('0x060c0f')
    expect(params).toHaveLength(3)

    const sellingKntq = encodeV4ExactInputSingle({
      zeroForOne: false,
      amountIn: 50n,
      amountOutMinimum: 1n,
      deadline: 10n,
    })
    expect(sellingKntq.value).toBe(0n)
  })

  it('sweeps leftover native HYPE, not KNTQ, on mint and increase', () => {
    const recipient = '0x00000000000000000000000000000000000000ab'
    const mint = encodeMintPosition({
      tickLower: 52_000,
      tickUpper: 54_200,
      liquidity: 1000n,
      amount0Max: 10n ** 17n,
      amount1Max: 60n * 10n ** 18n,
      recipient,
    })
    const increase = encodeIncreaseLiquidity({
      tokenId: 4n,
      liquidity: 1000n,
      amount0Max: 10n ** 17n,
      amount1Max: 60n * 10n ** 18n,
      recipient,
    })
    const [mintActions] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes[]' }],
      mint.unlockData,
    )
    const [incActions] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes[]' }],
      increase.unlockData,
    )
    expect(mintActions).toBe('0x020d14')
    expect(incActions).toBe('0x000d14')
    expect(sweepCurrency(mint.unlockData)).toBe(NATIVE)
    expect(sweepCurrency(increase.unlockData)).toBe(NATIVE)
    expect(mint.value).toBe(10n ** 17n)
  })
})
