import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { DEFAULT_DEADLINE_MIN, DEFAULT_SLIPPAGE_PCT } from '../config/contracts'
import {
  DEFAULT_PRESET_ID,
  RANGE_PRESETS,
  budgetsFromBalances,
  formatPrice,
  liquidityMultipleVsFull,
  priceAtTick,
  relativeWidthPct,
  resolvePresetTicks,
  type RangePresetId,
} from '../config/ranges'
import type { PoolState } from '../hooks/usePoolState'
import {
  applySlippageMax,
  formatUnits,
  getAmountsForLiquidity,
  getLiquidityForAmounts,
  getSqrtRatioAtTick,
  parseUnits,
} from '../lib/math'
import { encodeIncreaseLiquidity, encodeMintPosition } from '../lib/actions'
import type { useTxFlow } from '../hooks/useTxFlow'
import { RangeRiskNotice } from './RangeRiskNotice'

type Tx = ReturnType<typeof useTxFlow>

export function AddLiquidityForm({
  pool,
  hypeBal,
  kntqBal,
  tx,
  sendBlockReason,
  increaseTokenId,
}: {
  pool: PoolState | null
  hypeBal: bigint
  kntqBal: bigint
  tx: Tx
  sendBlockReason: string | null
  increaseTokenId?: bigint | null
}) {
  const { address } = useAccount()
  const [presetId, setPresetId] = useState<RangePresetId>(DEFAULT_PRESET_ID)
  const [tickLower, setTickLower] = useState('')
  const [tickUpper, setTickUpper] = useState('')
  const [amt0, setAmt0] = useState('')
  const [amt1, setAmt1] = useState('')
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PCT))
  const [deadlineMin, setDeadlineMin] = useState(String(DEFAULT_DEADLINE_MIN))
  const [budgetSeeded, setBudgetSeeded] = useState(false)

  // Seed budgets once when balances arrive
  useEffect(() => {
    if (budgetSeeded) return
    if (hypeBal === 0n && kntqBal === 0n) return
    const b = budgetsFromBalances(hypeBal, kntqBal)
    setAmt0(b.hype)
    setAmt1(b.kntq)
    setBudgetSeeded(true)
  }, [hypeBal, kntqBal, budgetSeeded])

  // Recalculate ticks when spot or % preset changes (not custom)
  useEffect(() => {
    if (!pool || increaseTokenId != null) return
    if (presetId === 'custom') return
    const { tickLower: lo, tickUpper: hi } = resolvePresetTicks(presetId, pool.tick)
    setTickLower(String(lo))
    setTickUpper(String(hi))
  }, [pool?.tick, presetId, increaseTokenId, pool])

  const tl = Number(tickLower)
  const tu = Number(tickUpper)
  const slip = Number(slippage) || 0
  const ticksValid = Number.isFinite(tl) && Number.isFinite(tu) && tu > tl

  const activePreset = RANGE_PRESETS.find((p) => p.id === presetId)

  const rangeMeta = useMemo(() => {
    if (!pool || !ticksValid) return null
    const priceLo = priceAtTick(tl)
    const priceHi = priceAtTick(tu)
    const width = relativeWidthPct(tl, tu, pool.tick)
    const a0 = parseUnits(amt0 || '0', 18)
    const a1 = parseUnits(amt1 || '0', 18)
    const mult = liquidityMultipleVsFull(pool.sqrtPriceX96, tl, tu, a0, a1)
    return {
      priceLo,
      priceHi,
      width,
      mult,
      inRange: pool.tick >= tl && pool.tick < tu,
    }
  }, [pool, tl, tu, ticksValid, amt0, amt1])

  const previewCalc = useMemo(() => {
    if (!pool || !ticksValid || (!amt0 && !amt1)) return null
    const a0 = parseUnits(amt0 || '0', 18)
    const a1 = parseUnits(amt1 || '0', 18)
    if (a0 === 0n && a1 === 0n) return null
    const sqrtA = getSqrtRatioAtTick(tl)
    const sqrtB = getSqrtRatioAtTick(tu)
    const liq = getLiquidityForAmounts(pool.sqrtPriceX96, sqrtA, sqrtB, a0, a1)
    const used = getAmountsForLiquidity(pool.sqrtPriceX96, sqrtA, sqrtB, liq)
    return { liq, used, a0, a1 }
  }, [pool, amt0, amt1, tl, tu, ticksValid])

  function fillFromBalance() {
    const b = budgetsFromBalances(hypeBal, kntqBal)
    setAmt0(b.hype)
    setAmt1(b.kntq)
  }

  function selectPreset(id: RangePresetId) {
    setPresetId(id)
    if (id === 'custom' && pool) {
      // Keep current ticks if already set; otherwise seed from ±10%
      if (!ticksValid) {
        const r = resolvePresetTicks('balanced10', pool.tick)
        setTickLower(String(r.tickLower))
        setTickUpper(String(r.tickUpper))
      }
    }
  }

  async function onSubmit() {
    if (!address || !pool || !previewCalc || !ticksValid) return
    if (sendBlockReason) {
      alert(sendBlockReason)
      return
    }
    if (pool.stale) {
      alert('Giá đã cũ, hãy làm mới trước')
      return
    }
    if (!(slip >= 0) || Number.isNaN(slip)) {
      alert('Điền trượt giá hợp lệ (app không tự nới)')
      return
    }
    const amount0Max = applySlippageMax(previewCalc.used.amount0, slip)
    const amount1Max = applySlippageMax(previewCalc.used.amount1, slip)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(deadlineMin) * 60)

    if (increaseTokenId != null) {
      const { unlockData, value } = encodeIncreaseLiquidity({
        tokenId: increaseTokenId,
        liquidity: previewCalc.liq,
        amount0Max,
        amount1Max,
        recipient: address,
      })
      await tx.buildModifyTx({
        title: `Thêm thanh khoản #${increaseTokenId}`,
        summary: [
          `Thanh khoản thêm ${previewCalc.liq.toString()}`,
          `Trả tối đa ${formatUnits(amount0Max, 18)} HYPE + ${formatUnits(amount1Max, 18)} KNTQ`,
          `Trượt giá ${slip}% (bạn đặt, app không tự nới)`,
          amount1Max > 0n
            ? `Quyền KNTQ bị trần theo mức tối đa lần này ${formatUnits(amount1Max, 18)} (+0,1%), Permit2 khoảng 1 giờ`
            : 'Lần này không cần cấp quyền KNTQ',
        ],
        unlockData,
        value,
        deadline,
        kntqAmountNeeded: amount1Max,
      })
      return
    }

    const { unlockData, value } = encodeMintPosition({
      tickLower: tl,
      tickUpper: tu,
      liquidity: previewCalc.liq,
      amount0Max,
      amount1Max,
      recipient: address,
    })
    const presetLabel = activePreset?.label ?? 'Tự chọn'
    await tx.buildModifyTx({
      title: 'Thêm thanh khoản · mở vị thế mới',
      summary: [
        `Mẫu ${presetLabel} · khoảng [${tl}, ${tu}]`,
        rangeMeta
          ? `Giá 1 HYPE ≈ ${formatPrice(rangeMeta.priceLo)}–${formatPrice(rangeMeta.priceHi)} KNTQ`
          : '',
        `Thanh khoản ${previewCalc.liq.toString()}`,
        `Dự kiến dùng ${formatUnits(previewCalc.used.amount0, 18)} HYPE + ${formatUnits(previewCalc.used.amount1, 18)} KNTQ`,
        `Trần (gồm trượt giá ${slip}%) ${formatUnits(amount0Max, 18)} HYPE + ${formatUnits(amount1Max, 18)} KNTQ`,
        `Hạn chót ${deadlineMin} phút`,
        amount1Max > 0n
          ? `Quyền KNTQ bị trần theo mức lần này (+0,1%), Permit2 khoảng 1 giờ`
          : 'Lần này không cần cấp quyền KNTQ',
      ].filter(Boolean),
      unlockData,
      value,
      deadline,
      kntqAmountNeeded: amount1Max,
    })
  }

  return (
    <section className="panel panel-mint">
      <h2>{increaseTokenId != null ? `Thêm vào #${increaseTokenId}` : 'Thêm thanh khoản'}</h2>

      {increaseTokenId == null && (
        <div className="preset-block">
          <div className="label">Chọn khoảng giá</div>
          <div className="preset-grid" role="group" aria-label="Mẫu khoảng giá">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`preset-btn${presetId === p.id ? ' selected' : ''}${p.recommended ? ' rec' : ''}`}
                onClick={() => selectPreset(p.id)}
              >
                {p.label}
                {p.recommended ? <span className="preset-badge">Gợi ý</span> : null}
              </button>
            ))}
          </div>

          {pool && rangeMeta && (
            <div className={`range-summary${rangeMeta.inRange ? '' : ' out'}`}>
              <div className="range-row">
                <span className="label">Tick</span>
                <span className="mono">
                  [{tl}, {tu}]
                </span>
              </div>
              <div className="range-row">
                <span className="label">Giá</span>
                <span>
                  1 HYPE ≈ {formatPrice(rangeMeta.priceLo)} – {formatPrice(rangeMeta.priceHi)} KNTQ
                </span>
              </div>
              <div className="range-row">
                <span className="label">So với giá hiện tại</span>
                <span>
                  khoảng ±{rangeMeta.width.toFixed(1)}%
                  {rangeMeta.mult != null ? ` · dày hơn full range khoảng ${rangeMeta.mult.toFixed(0)} lần` : ''}
                </span>
              </div>
              <div className="range-row">
                <span className="label">Trạng thái</span>
                <span className={rangeMeta.inRange ? 'ok-text' : 'warn-text'}>
                  {rangeMeta.inRange ? 'Giá đang trong khoảng' : 'Giá đã ra khỏi khoảng (không nhận phí)'}
                </span>
              </div>
              {activePreset && <p className="risk-hint">{activePreset.riskHint}</p>}
              <RangeRiskNotice
                spotPrice={pool.priceKntqPerHype}
                tickLower={tl}
                tickUpper={tu}
                sqrtPriceX96={pool.sqrtPriceX96}
                liquidity={previewCalc?.liq}
              />
            </div>
          )}

          {presetId === 'custom' && (
            <div className="row gap wrap custom-ticks">
              <label>
                Tick dưới
                <input value={tickLower} onChange={(e) => setTickLower(e.target.value)} />
              </label>
              <label>
                Tick trên
                <input value={tickUpper} onChange={(e) => setTickUpper(e.target.value)} />
              </label>
            </div>
          )}
        </div>
      )}

      <div className="grid2">
        <label>
          Số HYPE muốn bỏ
          <input value={amt0} onChange={(e) => setAmt0(e.target.value)} placeholder="0.0" />
          <span className="muted small">Số dư {formatUnits(hypeBal, 18, 4)}</span>
        </label>
        <label>
          Số KNTQ muốn bỏ
          <input value={amt1} onChange={(e) => setAmt1(e.target.value)} placeholder="0.0" />
          <span className="muted small">Số dư {formatUnits(kntqBal, 18, 4)}</span>
        </label>
      </div>
      <button type="button" className="btn ghost" onClick={fillFromBalance}>
        Điền theo số dư (chừa khoảng 0,08 HYPE trả gas)
      </button>

      <div className="grid2">
        <label>
          Trượt giá % (chỉ số bạn điền)
          <input value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </label>
        <label>
          Hạn chót (phút)
          <input value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value)} />
        </label>
      </div>

      {previewCalc && (
        <p className="muted">
          Thanh khoản ước tính {previewCalc.liq.toString()} · dùng khoảng{' '}
          {formatUnits(previewCalc.used.amount0, 18)} HYPE +{' '}
          {formatUnits(previewCalc.used.amount1, 18)} KNTQ
        </p>
      )}

      {sendBlockReason && <p className="err">{sendBlockReason}</p>}
      <button
        className="btn primary wide"
        disabled={!previewCalc || !address || !ticksValid || !!sendBlockReason}
        onClick={() => void onSubmit()}
      >
        Xem trước rồi xác nhận
      </button>
    </section>
  )
}
