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
      alert('行情已过期，请先刷新')
      return
    }
    if (!(slip >= 0) || Number.isNaN(slip)) {
      alert('请填写有效滑点（不会自动放宽）')
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
        title: `增加流动性 #${increaseTokenId}`,
        summary: [
          `流动性 Δ ${previewCalc.liq.toString()}`,
          `最多支付 ${formatUnits(amount0Max, 18)} HYPE + ${formatUnits(amount1Max, 18)} KNTQ`,
          `滑点 ${slip}%（用户设定，不会自动加宽）`,
          amount1Max > 0n
            ? `KNTQ 授权将按本次上限 ${formatUnits(amount1Max, 18)}（+0.1% 缓冲）封顶，Permit2 约 1 小时有效`
            : '本次无需 KNTQ 授权',
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
    const presetLabel = activePreset?.label ?? '自定义'
    await tx.buildModifyTx({
      title: '组池 · Mint 新仓位',
      summary: [
        `预设 ${presetLabel} · 区间 [${tl}, ${tu}]`,
        rangeMeta
          ? `价格 1 HYPE ≈ ${formatPrice(rangeMeta.priceLo)}–${formatPrice(rangeMeta.priceHi)} KNTQ`
          : '',
        `流动性 ${previewCalc.liq.toString()}`,
        `预计使用 ${formatUnits(previewCalc.used.amount0, 18)} HYPE + ${formatUnits(previewCalc.used.amount1, 18)} KNTQ`,
        `上限（含滑点 ${slip}%） ${formatUnits(amount0Max, 18)} HYPE + ${formatUnits(amount1Max, 18)} KNTQ`,
        `deadline ${deadlineMin} 分钟`,
        amount1Max > 0n
          ? `KNTQ 授权按本次上限封顶（+0.1% 缓冲），Permit2 约 1 小时有效`
          : '本次无需 KNTQ 授权',
      ].filter(Boolean),
      unlockData,
      value,
      deadline,
      kntqAmountNeeded: amount1Max,
    })
  }

  return (
    <section className="panel panel-mint">
      <h2>{increaseTokenId != null ? `加仓 #${increaseTokenId}` : '组池（添加流动性）'}</h2>

      {increaseTokenId == null && (
        <div className="preset-block">
          <div className="label">价格区间预设</div>
          <div className="preset-grid" role="group" aria-label="区间预设">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`preset-btn${presetId === p.id ? ' selected' : ''}${p.recommended ? ' rec' : ''}`}
                onClick={() => selectPreset(p.id)}
              >
                {p.label}
                {p.recommended ? <span className="preset-badge">推荐</span> : null}
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
                <span className="label">价格</span>
                <span>
                  1 HYPE ≈ {formatPrice(rangeMeta.priceLo)} – {formatPrice(rangeMeta.priceHi)} KNTQ
                </span>
              </div>
              <div className="range-row">
                <span className="label">相对现价</span>
                <span>
                  ≈ ±{rangeMeta.width.toFixed(1)}%
                  {rangeMeta.mult != null ? ` · 相对全区间约 ${rangeMeta.mult.toFixed(0)}× 流动性密度` : ''}
                </span>
              </div>
              <div className="range-row">
                <span className="label">状态</span>
                <span className={rangeMeta.inRange ? 'ok-text' : 'warn-text'}>
                  {rangeMeta.inRange ? '现价在区间内' : '现价已出区间（不会吃到手续费）'}
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
                tickLower
                <input value={tickLower} onChange={(e) => setTickLower(e.target.value)} />
              </label>
              <label>
                tickUpper
                <input value={tickUpper} onChange={(e) => setTickUpper(e.target.value)} />
              </label>
            </div>
          )}
        </div>
      )}

      <div className="grid2">
        <label>
          HYPE 预算
          <input value={amt0} onChange={(e) => setAmt0(e.target.value)} placeholder="0.0" />
          <span className="muted small">余额 {formatUnits(hypeBal, 18, 4)}</span>
        </label>
        <label>
          KNTQ 预算
          <input value={amt1} onChange={(e) => setAmt1(e.target.value)} placeholder="0.0" />
          <span className="muted small">余额 {formatUnits(kntqBal, 18, 4)}</span>
        </label>
      </div>
      <button type="button" className="btn ghost" onClick={fillFromBalance}>
        用余额填入（留约 0.08 HYPE 作 gas）
      </button>

      <div className="grid2">
        <label>
          滑点 %（仅用户设定）
          <input value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </label>
        <label>
          Deadline（分钟）
          <input value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value)} />
        </label>
      </div>

      {previewCalc && (
        <p className="muted">
          预估流动性 {previewCalc.liq.toString()} · 使用约{' '}
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
        预览并确认建仓
      </button>
    </section>
  )
}
