import type { PriceConsensus } from '../lib/priceCheck'

function host(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

function shortErr(error: string | undefined): string {
  const raw = (error ?? '失败').replace(/\s+/g, ' ')
  if (/timed out|timeout|took too long/i.test(raw)) return '超时，没读到 slot0'
  if (/failed to fetch|network|econn|fetch/i.test(raw)) return '连不上'
  const cut = raw.split(/request body/i)[0]?.trim() || raw
  return cut.slice(0, 80)
}

export function PriceCheckBanner({ result }: { result: PriceConsensus | null }) {
  if (!result) {
    return (
      <div className="banner banner-warn">
        <span>正在用多个 RPC 交叉核对池子现价（StateView slot0）…</span>
      </div>
    )
  }

  const lines = result.samples.map((s) => {
    if (s.ok && s.price != null) {
      return `${host(s.url)}：1 HYPE ≈ ${s.price.toPrecision(6)} KNTQ`
    }
    return `${host(s.url)}：读失败（${shortErr(s.error)}）`
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
        RPC 交叉核对通过：{n} 个节点，价差 {(result.deviationPct ?? 0).toFixed(3)}%（阈值 1%）
      </span>
    </div>
  )
}
