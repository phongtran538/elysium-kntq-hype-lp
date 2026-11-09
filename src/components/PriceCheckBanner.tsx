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
    if (s.ok && s.price != null && s.outlier) {
      return `${host(s.url)}: 1 HYPE ≈ ${s.price.toPrecision(6)} KNTQ · loại (lệch ${(s.deviationPct ?? 0).toFixed(2)}% so với giá giữa)`
    }
    if (s.ok && s.price != null) {
      return `${host(s.url)}: 1 HYPE ≈ ${s.price.toPrecision(6)} KNTQ`
    }
    return `${host(s.url)}: đọc lỗi (${shortErr(s.error)})`
  })
  const excluded = result.samples.filter((s) => s.outlier).length

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

  return (
    <div className="banner banner-ok">
      <div>
        <span>
          Đối chiếu ổn: {result.agreeing} RPC khớp quanh giá giữa
          {excluded > 0 ? `, ${excluded} RPC bị loại vì lệch quá 1%` : ''}. Lệch trong nhóm khớp{' '}
          {(result.deviationPct ?? 0).toFixed(3)}%.
        </span>
        {excluded > 0 && (
          <ul className="rpc-list">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
