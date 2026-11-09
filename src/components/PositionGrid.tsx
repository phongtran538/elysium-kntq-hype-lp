import { useMemo, useState } from 'react'
import type { LpPosition } from '../hooks/usePositions'
import type { PoolState } from '../hooks/usePoolState'
import { PositionCard } from './PositionCard'

type SortKey = 'principal' | 'fees' | 'apr' | 'id'

export function PositionGrid({
  positions,
  pool,
  loading,
  error,
  manualTokenId,
  sendBlockReason,
  onManualTokenIdChange,
  onManualWithdraw,
  onRefresh,
  onCollect,
  onWithdraw,
}: {
  positions: LpPosition[]
  pool: PoolState | null
  loading: boolean
  error?: string | null
  manualTokenId: string
  sendBlockReason: string | null
  onManualTokenIdChange: (v: string) => void
  onManualWithdraw: () => void
  onRefresh: () => void
  onCollect: (p: LpPosition) => void
  onWithdraw: (p: LpPosition) => void
}) {
  const [sort, setSort] = useState<SortKey>('principal')

  const sorted = useMemo(() => {
    const arr = [...positions]
    arr.sort((a, b) => {
      if (sort === 'id') return a.tokenId > b.tokenId ? -1 : 1
      if (sort === 'principal') return (b.principalUsd ?? 0) - (a.principalUsd ?? 0)
      if (sort === 'fees') return (b.feesUsd ?? 0) - (a.feesUsd ?? 0)
      return (b.aprPct ?? -1) - (a.aprPct ?? -1)
    })
    return arr
  }, [positions, sort])

  return (
    <section className="panel panel-positions">
      <div className="row between wrap gap">
        <h2>Vị thế</h2>
        <label className="inline-label">
          Sắp xếp{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="principal">Vốn USD</option>
            <option value="fees">Phí chưa rút</option>
            <option value="apr">Lãi năm</option>
            <option value="id">Mã NFT</option>
          </select>
        </label>
      </div>

      <div className="quick-withdraw">
        <div className="quick-withdraw-head">
          <strong>Rút nhanh theo mã NFT</strong>
          <span className="muted small">Danh sách trống hoặc quét lỗi thì điền số NFT vào đây</span>
        </div>
        <div className="row gap wrap">
          <label className="grow">
            Mã NFT
            <input
              value={manualTokenId}
              onChange={(e) => onManualTokenIdChange(e.target.value)}
              placeholder="ví dụ 827"
            />
          </label>
          <button
            className="btn danger"
            type="button"
            disabled={!!sendBlockReason}
            onClick={onManualWithdraw}
          >
            Xem trước rút #{manualTokenId || '…'}
          </button>
          <button className="btn" type="button" onClick={onRefresh}>
            Làm mới danh sách
          </button>
        </div>
      </div>

      {sendBlockReason && <p className="err">{sendBlockReason}</p>}
      {loading && <p className="muted">Đang đọc vị thế trên chain…</p>}
      {error && <p className="err">Đọc vị thế lỗi: {error}</p>}
      {!loading && !error && sorted.length === 0 && (
        <p className="muted">
          Chưa có vị thế đang mở trong pool này (đã ẩn chỗ liquidity = 0). Vừa tạo xong thì bấm làm mới, hoặc rút bằng mã NFT phía trên.
        </p>
      )}
      <div className="cards">
        {sorted.map((p) => (
          <PositionCard
            key={p.tokenId.toString()}
            pos={p}
            pool={pool}
            sendBlocked={!!sendBlockReason}
            onCollect={onCollect}
            onWithdraw={onWithdraw}
          />
        ))}
      </div>
    </section>
  )
}
