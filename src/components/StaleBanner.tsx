export function StaleBanner({
  stale,
  onRefresh,
  rpcError,
}: {
  stale: boolean
  onRefresh: () => void
  rpcError?: string | null
}) {
  if (!stale && !rpcError) return null
  return (
    <div className={`banner ${rpcError ? 'banner-err' : 'banner-warn'}`}>
      {rpcError ? (
        <span>RPC lỗi: {rpcError} (đã thử chuyển sang RPC khác)</span>
      ) : (
        <span>Giá đã cũ (hơn 20 giây). Làm mới rồi hãy giao dịch.</span>
      )}
      <button className="btn" onClick={onRefresh}>
        Làm mới ngay
      </button>
    </div>
  )
}
