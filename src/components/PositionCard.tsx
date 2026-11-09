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
          {full && <span className="tag warn">Cả dải · ăn phí ít</span>}
          <span className={`tag ${pos.inRange ? 'ok' : 'off'}`}>
            {pos.inRange ? 'Trong khoảng' : 'Ngoài khoảng'}
          </span>
        </div>
      </div>
      <p className="muted mono small">
        Tick [{pos.tickLower}, {pos.tickUpper}]
      </p>
      <p className="price-sub">
        1 HYPE ≈ {formatPrice(priceLo)} – {formatPrice(priceHi)} KNTQ
      </p>
      <div className="tri">
        <div>
          <div className="label">Vốn</div>
          <div className="val">
            {formatUnits(pos.amount0, 18, 4)} HYPE
            <br />
            {formatUnits(pos.amount1, 18, 4)} KNTQ
          </div>
          <div className="sub">
            {pos.principalUsd != null
              ? `≈ $${pos.principalUsd.toFixed(2)}`
              : 'Chưa có giá USD'}
          </div>
        </div>
        <div>
          <div className="label">Phí chưa rút</div>
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
          <div className="label">Lãi năm gần đây</div>
          <div className="val">
            {pos.aprPct != null ? `${pos.aprPct.toFixed(1)}%` : 'Đang lấy mẫu…'}
          </div>
          <div className="sub">Ước tính vài giây · cần làm mới liên tục</div>
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
          Rút phí
        </button>
        <button className="btn danger" disabled={sendBlocked} onClick={() => onWithdraw(pos)}>
          Rút pool
        </button>
      </div>
    </article>
  )
}
