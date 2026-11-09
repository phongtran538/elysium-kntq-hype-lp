import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { DEFAULT_DEADLINE_MIN, DEFAULT_MINT_SLIPPAGE_PCT } from '../config/contracts'
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
  GAS_RESERVE_HYPE,
} from '../config/ranges'
import type { PoolState } from '../hooks/usePoolState'
import {
  formatUnits,
  getSqrtRatioAtTick,
  liquidityUnderSlippageCap,
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
  const [slippage, setSlippage] = useState(String(DEFAULT_MINT_SLIPPAGE_PCT))
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
    const input0 = parseUnits(amt0 || '0', 18)
    const input1 = parseUnits(amt1 || '0', 18)
    if (input0 === 0n && input1 === 0n) return null
    const reserve = parseUnits(String(GAS_RESERVE_HYPE), 18)
    const hypeCap = hypeBal > reserve ? hypeBal - reserve : 0n
    const available0 = input0 < hypeCap ? input0 : hypeCap
    const available1 = input1 < kntqBal ? input1 : kntqBal
    if (available0 === 0n && available1 === 0n) return null
    const slipPct = Number.isFinite(slip) && slip >= 0 ? slip : 0
    const sized = liquidityUnderSlippageCap({
      sqrtPriceX96: pool.sqrtPriceX96,
      sqrtLowerX96: getSqrtRatioAtTick(tl),
      sqrtUpperX96: getSqrtRatioAtTick(tu),
      available0,
      available1,
      slippagePct: slipPct,
    })
    if (sized.liquidity === 0n) return null
    return { ...sized, available0, available1, slipPct }
  }, [pool, amt0, amt1, tl, tu, ticksValid, hypeBal, kntqBal, slip])

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
    const { liquidity, used0, used1, amount0Max, amount1Max, available0, available1, slipPct } = previewCalc
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(deadlineMin) * 60)
    const resize = {
      kind: increaseTokenId != null ? ('increase' as const) : ('mint' as const),
      tokenId: increaseTokenId ?? undefined,
      tickLower: tl,
      tickUpper: tu,
      budget0: available0,
      budget1: available1,
      slippagePct: slipPct,
    }

    if (increaseTokenId != null) {
      const { unlockData, value } = encodeIncreaseLiquidity({
        tokenId: increaseTokenId,
        liquidity,
        amount0Max,
        amount1Max,
        recipient: address,
      })
      await tx.buildModifyTx({
        title: `Thêm thanh khoản #${increaseTokenId}`,
        summary: [
          `Thanh khoản thêm ${liquidity.toString()}`,
          `Dùng khoảng ${formatUnits(used0, 18)} HYPE + ${formatUnits(used1, 18)} KNTQ`,
          `Trần ${formatUnits(amount0Max, 18)} HYPE + ${formatUnits(amount1Max, 18)} KNTQ (trượt giá ${slipPct}%, không vượt số dư)`,
          'Ngay trước khi ký, giá được đọc lại và thanh khoản tính lại cho vừa trần.',
          available1 > 0n
            ? `Quyền KNTQ theo số dư dùng được ${formatUnits(available1, 18)} (+0,1%), Permit2 khoảng 1 giờ`
            : 'Lần này không cần cấp quyền KNTQ',
        ],
        unlockData,
        value,
        deadline,
        kntqAmountNeeded: available1,
        resize,
      })
      return
    }

    const { unlockData, value } = encodeMintPosition({
      tickLower: tl,
      tickUpper: tu,
      liquidity,
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
        `Thanh khoản ${liquidity.toString()}`,
        `Dùng khoảng ${formatUnits(used0, 18)} HYPE + ${formatUnits(used1, 18)} KNTQ`,
        `Trần ${formatUnits(amount0Max, 18)} HYPE + ${formatUnits(amount1Max, 18)} KNTQ (trượt giá ${slipPct}%, không vượt số dư)`,
        'Ngay trước khi ký, giá được đọc lại và thanh khoản tính lại cho vừa trần.',
        `Hạn chót ${deadlineMin} phút`,
        available1 > 0n
          ? `Quyền KNTQ theo số dư dùng được ${formatUnits(available1, 18)} (+0,1%), Permit2 khoảng 1 giờ`
          : 'Lần này không cần cấp quyền KNTQ',
      ].filter(Boolean),
      unlockData,
      value,
      deadline,
      kntqAmountNeeded: available1,
      resize,
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
                liquidity={previewCalc?.liquidity}
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
          Thanh khoản ước tính {previewCalc.liquidity.toString()} · dùng khoảng{' '}
          {formatUnits(previewCalc.used0, 18)} HYPE + {formatUnits(previewCalc.used1, 18)} KNTQ.
          Trần {formatUnits(previewCalc.amount0Max, 18)} HYPE + {formatUnits(previewCalc.amount1Max, 18)} KNTQ.
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
