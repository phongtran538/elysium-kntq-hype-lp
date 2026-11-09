import { decodeAbiParameters, type Hex } from 'viem'
import { formatUnits } from './math'

const MAX_EXCEEDED = '0x31e30ad0'
const MIN_INSUFFICIENT = '0x12816f22'
const DEADLINE = '0xbfb22adf'

function fmt(amount: bigint): string {
  return formatUnits(amount, 18, 4)
}

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

/** Pull 0x revert payload out of a viem error or a plain message. */
export function extractRevertData(err: unknown): Hex | null {
  let found: Hex | null = null
  walk(err, (value) => {
    if (found) return
    if (typeof value === 'string') {
      const match = value.match(/0x[0-9a-fA-F]{8,}/)
      if (match) found = match[0] as Hex
      return
    }
    const rec = value as Record<string, unknown>
    for (const key of ['data', 'raw']) {
      const item = rec[key]
      if (typeof item === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(item)) {
        found = item as Hex
        return
      }
    }
  })
  return found
}

export function decodeV4Error(err: unknown): string | null {
  const data = extractRevertData(err)
  if (!data || data.length < 10) return null
  const selector = data.slice(0, 10).toLowerCase()
  const body = (`0x${data.slice(10)}`) as Hex
  try {
    if (selector === MAX_EXCEEDED) {
      const [max, requested] = decodeAbiParameters(
        [{ type: 'uint128' }, { type: 'uint128' }],
        body,
      )
      return `Giá đã chạy, cần ${fmt(requested)} nhưng chỉ cho tối đa ${fmt(max)}. Tăng trượt giá hoặc giảm số lượng.`
    }
    if (selector === MIN_INSUFFICIENT) {
      const [min, got] = decodeAbiParameters(
        [{ type: 'uint128' }, { type: 'uint128' }],
        body,
      )
      return `Nhận về ít hơn mức tối thiểu (${fmt(got)} < ${fmt(min)}). Giá chạy ngược, hoặc tăng trượt giá rồi thử lại.`
    }
    if (selector === DEADLINE) {
      return 'Hết hạn giao dịch. Bấm lại, đừng ký giao dịch cũ.'
    }
  } catch {
    return null
  }
  return null
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
