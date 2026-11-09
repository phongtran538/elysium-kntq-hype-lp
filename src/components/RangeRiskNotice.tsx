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
  if (ilPct == null || !Number.isFinite(ilPct)) return '算不出'
  if (ilPct >= -0.005) return '几乎为 0'
  return `约 ${Math.abs(ilPct).toFixed(2)}%`
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
          <strong>出区间警告</strong>
          <p>
            {status.side === 'below'
              ? '现价已经低于区间下沿，这个仓位现在收不到手续费，而且几乎只剩 HYPE。'
              : '现价已经高于区间上沿，这个仓位现在收不到手续费，而且几乎只剩 KNTQ。'}
            价格回到区间里才会重新两边挂单。
          </p>
        </div>
      )}
      {status.level === 'near' && (
        <div className="risk-box near">
          <strong>快出区间了</strong>
          <p>
            现价还在区间里，但离
            {status.nearest === 'lower' ? '下沿' : '上沿'}
            只剩约 {Math.abs(status.nearest === 'lower' ? status.distanceLowerPct : status.distanceUpperPct).toFixed(2)}
            %（警戒线是 5%）。再走一点就出区间，手续费会停。
            {status.distanceLowerPct <= 5 && status.distanceUpperPct <= 5
              ? ` 下沿 ${status.distanceLowerPct.toFixed(2)}%，上沿 ${status.distanceUpperPct.toFixed(2)}%，两边都在警戒内。`
              : ''}
          </p>
        </div>
      )}
      <div className="risk-box il">
        <strong>无常损失（用大白话）</strong>
        <p>
          两种币放进池子后，涨的那边会被换成跌的那边。所以价格一变，仓位会比「当初那两笔币一直放钱包里」少一点。区间越窄，少得越快；真出了区间，这笔差额先被锁住，要等价格回来，或者你自己把仓位移回去。下面是从<strong>现在的价格</strong>再动 ±10% / ±20% / ±50% 的估算，<strong>没算手续费收入</strong>（手续费有时能补上一部分）。
        </p>
        <table className="il-table">
          <thead>
            <tr>
              <th>价格变动</th>
              <th>大约少这么多</th>
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
