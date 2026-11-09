import { priceAtTick } from '../config/ranges'
import {
  getSqrtRatioAtTick,
  impermanentLossRows,
  rangeEdgeStatus,
} from '../lib/math'

function moveLabel(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(0)}%`
}

function lossLabel(ilPct: number | null): string {
  if (ilPct == null || !Number.isFinite(ilPct)) return 'không tính được'
  if (ilPct >= -0.005) return 'gần như 0'
  return `khoảng ${Math.abs(ilPct).toFixed(2)}%`
}

export function RangeRiskNotice({
  spotPrice,
  tickLower,
  tickUpper,
  sqrtPriceX96,
  liquidity,
}: {
  spotPrice: number
  tickLower: number
  tickUpper: number
  sqrtPriceX96: bigint
  liquidity?: bigint
}) {
  if (!(spotPrice > 0) || !(tickUpper > tickLower)) return null
  const lower = priceAtTick(tickLower)
  const upper = priceAtTick(tickUpper)
  const status = rangeEdgeStatus(spotPrice, lower, upper, 5)
  const liq = liquidity && liquidity > 0n ? liquidity : 10n ** 18n
  const rows = impermanentLossRows({
    sqrtPriceX96,
    sqrtLowerX96: getSqrtRatioAtTick(tickLower),
    sqrtUpperX96: getSqrtRatioAtTick(tickUpper),
    liquidity: liq,
  })

  return (
    <div className="risk-stack">
      {status.level === 'out' && (
        <div className="risk-box out">
          <strong>Cảnh báo: giá đã ra khỏi khoảng</strong>
          <p>
            {status.side === 'below'
              ? 'Giá đang thấp hơn mép dưới. Vị thế này không nhận phí, và gần như chỉ còn HYPE.'
              : 'Giá đang cao hơn mép trên. Vị thế này không nhận phí, và gần như chỉ còn KNTQ.'}{' '}
            Khi giá quay lại trong khoảng thì mới treo hai bên trở lại.
          </p>
        </div>
      )}
      {status.level === 'near' && (
        <div className="risk-box near">
          <strong>Sắp ra khỏi khoảng</strong>
          <p>
            Giá vẫn trong khoảng, nhưng cách mép{' '}
            {status.nearest === 'lower' ? 'dưới' : 'trên'} chỉ còn khoảng{' '}
            {Math.abs(status.nearest === 'lower' ? status.distanceLowerPct : status.distanceUpperPct).toFixed(2)}
            % (mức cảnh báo là 5%). Nhích thêm một chút là hết phí.
            {status.distanceLowerPct <= 5 && status.distanceUpperPct <= 5
              ? ` Mép dưới còn ${status.distanceLowerPct.toFixed(2)}%, mép trên còn ${status.distanceUpperPct.toFixed(2)}%. Cả hai đều trong vùng cảnh báo.`
              : ''}
          </p>
        </div>
      )}
      <div className="risk-box il">
        <strong>Tổn thất tạm thời (nói dễ hiểu)</strong>
        <p>
          Bỏ hai đồng vào pool thì đồng nào tăng sẽ bị đổi bớt sang đồng giảm. Nên khi giá đổi, vị thế
          thường ít hơn so với cứ cầm hai đồng trong ví. Khoảng càng hẹp thì lệch càng nhanh. Ra hẳn khỏi
          khoảng thì phần lệch này bị khóa, phải đợi giá quay lại hoặc tự chuyển vị thế. Bảng dưới là ước
          tính nếu giá từ <strong>mức hiện tại</strong> chạy ±10% / ±20% / ±50%. <strong>Chưa tính phí</strong> bạn
          nhận được (phí đôi khi bù lại một phần).
        </p>
        <table className="il-table">
          <thead>
            <tr>
              <th>Giá chạy</th>
              <th>Khoảng ít đi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.movePct}>
                <td>{moveLabel(row.movePct)}</td>
                <td>{lossLabel(row.ilPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
