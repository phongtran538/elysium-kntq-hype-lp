import { decodeAbiParameters, toFunctionSelector, type Hex } from 'viem'
import { formatUnits } from './math'

function fmt(amount: bigint): string {
  return formatUnits(amount, 18, 4)
}

type DecodedArgs = readonly (bigint | string)[]

type ErrorSpec = {
  signature: string
  types: readonly { type: string }[]
  explain: (args: DecodedArgs) => string
  fallback: string
}

const ERRORS: readonly ErrorSpec[] = [
  {
    signature: 'MaximumAmountExceeded(uint128,uint128)',
    types: [{ type: 'uint128' }, { type: 'uint128' }],
    explain: ([max, requested]) =>
      `Giá đã chạy, cần ${fmt(requested as bigint)} nhưng chỉ cho tối đa ${fmt(max as bigint)}. Tăng trượt giá hoặc giảm số lượng.`,
    fallback: 'Giá đã chạy, số token cần vượt mức tối đa. Tăng trượt giá hoặc giảm số lượng.',
  },
  {
    signature: 'MinimumAmountInsufficient(uint128,uint128)',
    types: [{ type: 'uint128' }, { type: 'uint128' }],
    explain: ([min, got]) =>
      `Nhận về ít hơn mức tối thiểu (${fmt(got as bigint)} < ${fmt(min as bigint)}). Mức này chỉ tính phần gốc, không tính phí. Giá chạy ngược thì tăng trượt giá rồi thử lại.`,
    fallback: 'Nhận về ít hơn mức tối thiểu. Mức này chỉ tính phần gốc, không tính phí.',
  },
  {
    signature: 'DeadlinePassed(uint256)',
    types: [{ type: 'uint256' }],
    explain: () => 'Hết hạn giao dịch. Bấm lại, đừng ký giao dịch cũ.',
    fallback: 'Hết hạn giao dịch. Bấm lại, đừng ký giao dịch cũ.',
  },
  {
    signature: 'NotApproved(address)',
    types: [{ type: 'address' }],
    explain: ([caller]) =>
      `Ví ${caller} không phải chủ NFT, cũng chưa được chủ cho phép. Kết nối đúng ví rồi thử lại.`,
    fallback: 'Ví này không phải chủ NFT, cũng chưa được chủ cho phép. Kết nối đúng ví rồi thử lại.',
  },
  {
    signature: 'UnsupportedAction(uint256)',
    types: [{ type: 'uint256' }],
    explain: ([action]) => `PositionManager không nhận hành động ${action}.`,
    fallback: 'PositionManager không nhận hành động này.',
  },
  {
    signature: 'ContractLocked()',
    types: [],
    explain: () => 'Hợp đồng đang bận. Đợi một lát rồi bấm lại.',
    fallback: 'Hợp đồng đang bận. Đợi một lát rồi bấm lại.',
  },
  {
    signature: 'InputLengthMismatch()',
    types: [],
    explain: () => 'Dữ liệu giao dịch bị lệch. Chưa gửi.',
    fallback: 'Dữ liệu giao dịch bị lệch. Chưa gửi.',
  },
  {
    signature: 'DeltaNotPositive(address)',
    types: [{ type: 'address' }],
    explain: () => 'Pool không trả token về như mong đợi. Thử lại.',
    fallback: 'Pool không trả token về như mong đợi. Thử lại.',
  },
  {
    signature: 'DeltaNotNegative(address)',
    types: [{ type: 'address' }],
    explain: () => 'Pool không thu token như mong đợi. Thử lại.',
    fallback: 'Pool không thu token như mong đợi. Thử lại.',
  },
]

const BY_SELECTOR = new Map(ERRORS.map((spec) => [toFunctionSelector(spec.signature).toLowerCase(), spec]))

const STRING_REVERT = '0x08c379a0'

function walk(err: unknown, visit: (value: unknown) => void): void {
  const seen = new Set<unknown>()
  const stack = [err]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || (typeof cur !== 'object' && typeof cur !== 'string')) continue
    if (typeof cur === 'object') {
      if (seen.has(cur)) continue
      seen.add(cur)
      visit(cur)
      const rec = cur as Record<string, unknown>
      if (typeof rec.message === 'string') visit(rec.message)
      if (rec.cause) stack.push(rec.cause)
      if (rec.error) stack.push(rec.error)
      if (rec.data) stack.push(rec.data)
      if (rec.raw) stack.push(rec.raw)
    } else {
      visit(cur)
    }
  }
}

function hexBlobs(value: string): string[] {
  return value.match(/0x[0-9a-fA-F]{8,}/g) ?? []
}

/** Pull the revert payload out of a viem error. Prefer a known PositionManager selector over an address that appears first. */
export function extractRevertData(err: unknown): Hex | null {
  const blobs: string[] = []
  walk(err, (value) => {
    if (typeof value === 'string') {
      blobs.push(...hexBlobs(value))
      return
    }
    const rec = value as Record<string, unknown>
    for (const key of ['data', 'raw', 'reason', 'shortMessage', 'details']) {
      const item = rec[key]
      if (typeof item === 'string') blobs.push(...hexBlobs(item))
    }
    const meta = rec.metaMessages
    if (Array.isArray(meta)) {
      for (const line of meta) {
        if (typeof line === 'string') blobs.push(...hexBlobs(line))
      }
    }
  })
  for (const blob of blobs) {
    if (BY_SELECTOR.has(blob.slice(0, 10).toLowerCase())) return blob as Hex
  }
  const longest = blobs.reduce<string | null>((best, blob) => (best == null || blob.length > best.length ? blob : best), null)
  return longest as Hex | null
}

function explainData(data: Hex): string | null {
  if (data.length < 10) return null
  const selector = data.slice(0, 10).toLowerCase()
  const body = (`0x${data.slice(10)}`) as Hex
  if (selector === STRING_REVERT) {
    try {
      const [reason] = decodeAbiParameters([{ type: 'string' }], body)
      if (/unknown reason/i.test(reason)) return 'Chain từ chối giao dịch. Không đọc được lỗi của PositionManager.'
      return `Chain từ chối giao dịch: ${reason}`
    } catch {
      return null
    }
  }
  const spec = BY_SELECTOR.get(selector)
  if (!spec) return null
  try {
    const args = (spec.types.length === 0 ? [] : decodeAbiParameters([...spec.types], body)) as DecodedArgs
    return spec.explain(args)
  } catch {
    return spec.fallback
  }
}

export function decodeV4Error(err: unknown): string | null {
  const data = extractRevertData(err)
  if (!data) return null
  return explainData(data)
}

export function toChineseError(err: unknown): string {
  const decoded = decodeV4Error(err)
  if (decoded) return decoded
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('denied') || lower.includes('rejected the request')) {
    return 'Bạn đã hủy ký trên ví'
  }
  if (lower.includes('insufficient funds')) return 'Không đủ số dư (kể cả phí gas)'
  if (lower.includes('maximumamountexceeded') || lower.includes('0x31e30ad0')) {
    return 'Giá đã chạy, số token cần vượt mức tối đa. Tăng trượt giá hoặc giảm số lượng.'
  }
  if (lower.includes('minimumamountinsufficient') || lower.includes('0x12816f22')) {
    return 'Nhận về ít hơn mức tối thiểu. Tăng trượt giá rồi thử lại.'
  }
  if (lower.includes('deadlinepassed') || lower.includes('0xbfb22adf')) {
    return 'Hết hạn giao dịch. Bấm lại, đừng ký giao dịch cũ.'
  }
  if (lower.includes('notapproved')) {
    return 'Ví này không phải chủ NFT, cũng chưa được chủ cho phép. Kết nối đúng ví rồi thử lại.'
  }
  if (lower.includes('unsupportedaction')) return 'PositionManager không nhận hành động này.'
  if (lower.includes('contractlocked')) return 'Hợp đồng đang bận. Đợi một lát rồi bấm lại.'
  if (lower.includes('unknown reason')) {
    return 'Chain từ chối giao dịch. Không đọc được lỗi của PositionManager.'
  }
  if (lower.includes('rpc') || lower.includes('fetch') || lower.includes('network') || lower.includes('timeout')) {
    return `RPC lỗi: ${msg}`
  }
  if (lower.includes('execution reverted') || lower.includes('revert')) {
    return `Chain từ chối giao dịch: ${msg}`
  }
  if (lower.includes('slippage') || lower.includes('minmax')) {
    return `Trượt giá hoặc giới hạn số lượng đã chặn giao dịch: ${msg}`
  }
  return msg
}
