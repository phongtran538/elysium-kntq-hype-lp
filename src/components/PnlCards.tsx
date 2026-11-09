import type { PnlResult } from '../lib/pnl'

function money(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  const abs = Math.abs(n)
  const text = abs >= 1000 ? abs.toFixed(2) : abs.toFixed(digits)
  return `${n < 0 ? '-' : sign}${text}`
}

function usd(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return ''
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  return ` (${sign}$${Math.abs(n).toFixed(2)})`
}

function tone(n: number): string {
  if (n > 0.0000001) return 'pnl-pos'
  if (n < -0.0000001) return 'pnl-neg'
  return ''
}

export function PnlCards({
  pnl,
  estimated,
  apr,
}: {
  pnl: PnlResult
  estimated?: boolean
  apr?: number | null
}) {
  const cards: { label: string; hype: number; kntq: number; usd?: number; flip?: boolean }[] = [
    { label: 'Tổng phí kiếm được', hype: pnl.feesHype, kntq: pnl.feesKntq, usd: pnl.usd?.fees },
    { label: 'Phí chưa thu', hype: pnl.uncollectedHype, kntq: pnl.uncollectedKntq, usd: pnl.usd?.uncollected },
    { label: 'Gas đã tốn', hype: -pnl.gasHype, kntq: -pnl.gasKntq, usd: pnl.usd ? -pnl.usd.gas : undefined },
    { label: 'Lỗ tạm thời (IL)', hype: -pnl.ilHype, kntq: -pnl.ilKntq, usd: pnl.usd ? -pnl.usd.il : undefined },
    { label: 'Lãi/lỗ ròng', hype: pnl.netHype, kntq: pnl.netKntq, usd: pnl.usd?.net },
    { label: 'So với giữ nguyên', hype: pnl.vsHodlHype, kntq: pnl.vsHodlKntq, usd: pnl.usd?.vsHodl },
  ]
  return (
    <div>
      {estimated && (
        <p className="muted small">
          Mốc này là ước lượng lúc thấy vị thế lần đầu, không phải số chính xác lúc tạo.
        </p>
      )}
      <div className="pnl-grid">
        {cards.map((c) => (
          <div key={c.label} className={`pnl-card ${tone(c.hype)}`}>
            <div className="label">{c.label}</div>
            <div className="pnl-num">
              {money(c.hype)} HYPE{usd(c.usd)}
            </div>
            <div className="muted small">{money(c.kntq)} KNTQ</div>
          </div>
        ))}
      </div>
      <p className="muted small">
        Giá trị hiện tại gồm vốn trong pool và phí chưa thu. Lãi/lỗ ròng = giá trị đó + phí đã thu − vốn lúc mốc − gas.
        {apr != null ? ` APR phí ước tính khoảng ${apr.toFixed(1)}%/năm.` : ' Chưa đủ thời gian để ước tính APR phí.'}
        {pnl.usd ? '' : ' Chưa có giá USD.'}
      </p>
    </div>
  )
}

export function PnlChart({ points }: { points: { at: number; netHype: number; feesHype: number }[] }) {
  if (points.length < 2) {
    return <p className="muted small">Biểu đồ hiện khi đã có vài lần đọc giá.</p>
  }
  const width = 320
  const height = 110
  const nets = points.map((p) => p.netHype)
  const fees = points.map((p) => p.feesHype)
  const min = Math.min(0, ...nets, ...fees)
  const max = Math.max(0, ...nets, ...fees)
  const span = max - min || 1
  const x = (i: number) => (i / (points.length - 1)) * (width - 8) + 4
  const y = (v: number) => height - 8 - ((v - min) / span) * (height - 16)
  const line = (series: number[]) => series.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  return (
    <svg className="pnl-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ lãi lỗ">
      <polyline points={line(fees)} fill="none" stroke="#6ea8ff" strokeWidth="2" />
      <polyline points={line(nets)} fill="none" stroke={nets[nets.length - 1]! >= 0 ? '#3ecf8e' : '#ff6b6b'} strokeWidth="2" />
    </svg>
  )
}
