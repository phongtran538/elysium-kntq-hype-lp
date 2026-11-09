export function toChineseError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('denied') || lower.includes('rejected the request')) {
    return 'Bạn đã hủy ký trên ví'
  }
  if (lower.includes('insufficient funds')) return 'Không đủ số dư (kể cả phí gas)'
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
