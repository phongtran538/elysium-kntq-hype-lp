import { encodeAbiParameters, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { decodeV4Error, toChineseError } from '../src/lib/errors'

function revert(signature: string, types: ('uint128' | 'uint256')[], values: bigint[]): string {
  const selector = toFunctionSelector(signature)
  const body = encodeAbiParameters(
    types.map((type) => ({ type })),
    values,
  ).slice(2)
  return `${selector}${body}`
}

describe('V4 revert text', () => {
  it('matches the MaximumAmountExceeded selector from the failed mint', () => {
    expect(toFunctionSelector('MaximumAmountExceeded(uint128,uint128)')).toBe('0x31e30ad0')
  })

  it('explains MaximumAmountExceeded in Vietnamese and does not ask the wallet', () => {
    const data = revert(
      'MaximumAmountExceeded(uint128,uint128)',
      ['uint128', 'uint128'],
      [603n * 10n ** 17n, 622n * 10n ** 17n],
    )
    const text = toChineseError(new Error(`execution reverted ${data}`))
    expect(text).toContain('60.3')
    expect(text).toContain('62.2')
    expect(text).toContain('Tăng trượt giá hoặc giảm số lượng')
    expect(text).not.toContain('0x31e30ad0')
    expect(decodeV4Error({ data, cause: new Error('viem dump') })).toBe(text)
  })

  it('explains a short payout and a passed deadline', () => {
    const low = revert(
      'MinimumAmountInsufficient(uint128,uint128)',
      ['uint128', 'uint128'],
      [10n ** 18n, 10n ** 17n],
    )
    expect(toChineseError({ data: low })).toContain('ít hơn mức tối thiểu')
    const late = revert('DeadlinePassed(uint256)', ['uint256'], [123n])
    expect(toChineseError(new Error(late))).toContain('Hết hạn')
  })
})
