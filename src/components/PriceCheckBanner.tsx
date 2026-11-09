import type { PriceConsensus } from '../lib/priceCheck'

function host(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

function shortErr(error: string | undefined): string {
  const raw = (error ?? 'lỗi').replace(/\s+/g, ' ')
  if (/timed out|timeout|took too long/i.test(raw)) return 'hết giờ, không đọc được slot0'
  if (/failed to fetch|network|econn|fetch/i.test(raw)) return 'không kết nối được'
  const cut = raw.split(/request body/i)[0]?.trim() || raw
  return cut.slice(0, 80)
}

export function PriceCheckBanner({ result }: { result: PriceConsensus | null }) {
  if (!result) {
    return (
      <div className="banner banner-warn">
        <span>Đang đối chiếu giá pool (slot0) trên nhiều RPC…</span>
      </div>
    )
  }

  const lines = result.samples.map((s) => {
    if (s.ok && s.price != null) {
      return `${host(s.url)}: 1 HYPE ≈ ${s.price.toPrecision(6)} KNTQ`
    }
    return `${host(s.url)}: đọc lỗi (${shortErr(s.error)})`
  })

  if (!result.agreed) {
    return (
      <div className="banner banner-err">
        <div>
          <strong>{result.blockReason}</strong>
          <ul className="rpc-list">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  const n = result.samples.filter((s) => s.ok).length
  return (
    <div className="banner banner-ok">
      <span>
        Đối chiếu RPC ổn: {n} nút, lệch {(result.deviationPct ?? 0).toFixed(3)}% (ngưỡng 1%)
      </span>
    </div>
  )
}
