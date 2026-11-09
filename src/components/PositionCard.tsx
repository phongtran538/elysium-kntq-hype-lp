import type { LpPosition } from '../hooks/usePositions'
import type { PoolState } from '../hooks/usePoolState'
import { formatPrice, isFullRange, priceAtTick } from '../config/ranges'
import { formatUnits } from '../lib/math'
import { RangeRiskNotice } from './RangeRiskNotice'

export function PositionCard({
  pos,
  pool,
  sendBlocked,
  onCollect,
  onWithdraw,
}: {
  pos: LpPosition
  pool: PoolState | null
  sendBlocked: boolean
  onCollect: (p: LpPosition) => void
  onWithdraw: (p: LpPosition) => void
}) {
  const priceLo = priceAtTick(pos.tickLower)
  const priceHi = priceAtTick(pos.tickUpper)
  const full = isFullRange(pos.tickLower, pos.tickUpper)

  return (
    <article className={`card${pos.inRange ? '' : ' card-out'}${full ? ' card-full' : ''}`}>
      <div className="card-head">
        <strong>#{pos.tokenId.toString()}</strong>
        <div className="tag-row">
          {full && <span className="tag warn">全区间·吃费稀</span>}
          <span className={`tag ${pos.inRange ? 'ok' : 'off'}`}>
            {pos.inRange ? '范围内' : '出范围'}
          </span>
        </div>
      </div>
      <p className="muted mono small">
        tick [{pos.tickLower}, {pos.tickUpper}]
      </p>
      <p className="price-sub">
        1 HYPE ≈ {formatPrice(priceLo)} – {formatPrice(priceHi)} KNTQ
      </p>
      <div className="tri">
        <div>
          <div className="label">本金</div>
          <div className="val">
            {formatUnits(pos.amount0, 18, 4)} HYPE
            <br />
            {formatUnits(pos.amount1, 18, 4)} KNTQ
          </div>
          <div className="sub">
            {pos.principalUsd != null
              ? `≈ $${pos.principalUsd.toFixed(2)}`
              : 'USD 待报价'}
          </div>
        </div>
        <div>
          <div className="label">待领收益</div>
          <div className="val">
            {formatUnits(pos.fees0, 18, 6)} HYPE
            <br />
            {formatUnits(pos.fees1, 18, 6)} KNTQ
          </div>
          <div className="sub">
            {pos.feesUsd != null ? `≈ $${pos.feesUsd.toFixed(4)}` : '—'}
          </div>
        </div>
        <div>
          <div className="label">近期年化</div>
          <div className="val">
            {pos.aprPct != null ? `${pos.aprPct.toFixed(1)}%` : '采样中…'}
          </div>
          <div className="sub">秒级估算 · 需连续刷新</div>
        </div>
      </div>
      {pool && (
        <RangeRiskNotice
          spotPrice={pool.priceKntqPerHype}
          tickLower={pos.tickLower}
          tickUpper={pos.tickUpper}
          sqrtPriceX96={pool.sqrtPriceX96}
          liquidity={pos.liquidity}
        />
      )}
      <div className="row gap">
        <button className="btn" disabled={sendBlocked} onClick={() => onCollect(pos)}>
          提取手续费
        </button>
        <button className="btn danger" disabled={sendBlocked} onClick={() => onWithdraw(pos)}>
          撤池
        </button>
      </div>
    </article>
  )
}
