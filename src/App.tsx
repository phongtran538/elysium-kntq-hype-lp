import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectBar } from './components/ConnectBar'
import { StaleBanner } from './components/StaleBanner'
import { AddLiquidityForm } from './components/AddLiquidityForm'
import { PositionGrid } from './components/PositionGrid'
import { TxPreviewModal } from './components/TxPreviewModal'
import { PriceCheckBanner } from './components/PriceCheckBanner'
import { usePoolState } from './hooks/usePoolState'
import { usePriceConsensus } from './hooks/usePriceConsensus'
import { useBalances } from './hooks/useBalances'
import { usePositions, type LpPosition } from './hooks/usePositions'
import { useTxFlow } from './hooks/useTxFlow'
import {
  applySlippageMin,
  decodePositionInfo,
  formatUnits,
  getAmountsForLiquidity,
  getSqrtRatioAtTick,
} from './lib/math'
import { encodeCollectFees, encodeDecreaseLiquidity } from './lib/actions'
import { publicClient } from './lib/rpcClient'
import { positionManagerAbi } from './abis/positionManager'
import {
  DEFAULT_DEADLINE_MIN,
  DEFAULT_SLIPPAGE_PCT,
  POOL_KEY,
  POSITION_MANAGER,
  explorerTx,
} from './config/contracts'
import './App.css'

export default function App() {
  const { address, isConnected } = useAccount()
  const { state: pool, error: poolErr, refresh: refreshPool } = usePoolState()
  const { result: priceCheck, blockReason: sendBlockReason, refresh: refreshPrice } = usePriceConsensus()
  const { hype, kntq, refresh: refreshBal } = useBalances()
  // Optional: user can paste HYPE/USD; never fabricate
  const [hypeUsd, setHypeUsd] = useState('')
  const hypeUsdNum = useMemo(() => {
    const n = Number(hypeUsd)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [hypeUsd])

  const { positions, loading, error: posError, refresh: refreshPos } = usePositions(pool, hypeUsdNum)
  const tx = useTxFlow()
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PCT))
  const [deadlineMin, setDeadlineMin] = useState(String(DEFAULT_DEADLINE_MIN))
  const [manualTokenId, setManualTokenId] = useState('')
  const slip = Number(slippage)
  const slipOk = Number.isFinite(slip) && slip >= 0

  async function loadPosition(tokenId: bigint): Promise<LpPosition | null> {
    if (!pool) return null
    const [poolAndInfo, liquidity, owner] = await Promise.all([
      publicClient.readContract({
        address: POSITION_MANAGER,
        abi: positionManagerAbi,
        functionName: 'getPoolAndPositionInfo',
        args: [tokenId],
      }),
      publicClient.readContract({
        address: POSITION_MANAGER,
        abi: positionManagerAbi,
        functionName: 'getPositionLiquidity',
        args: [tokenId],
      }),
      publicClient.readContract({
        address: POSITION_MANAGER,
        abi: positionManagerAbi,
        functionName: 'ownerOf',
        args: [tokenId],
      }),
    ])
    if (!address || owner.toLowerCase() !== address.toLowerCase()) {
      alert(`NFT #${tokenId} 不属于当前钱包（owner ${owner}）`)
      return null
    }
    if (liquidity === 0n) {
      alert(`NFT #${tokenId} 流动性已为 0`)
      return null
    }
    const [, infoPacked] = poolAndInfo
    const { tickLower, tickUpper } = decodePositionInfo(infoPacked)
    const { amount0, amount1 } = getAmountsForLiquidity(
      pool.sqrtPriceX96,
      getSqrtRatioAtTick(tickLower),
      getSqrtRatioAtTick(tickUpper),
      liquidity,
    )
    return {
      tokenId,
      tickLower,
      tickUpper,
      liquidity,
      amount0,
      amount1,
      fees0: 0n,
      fees1: 0n,
      principalUsd: null,
      feesUsd: null,
      aprPct: null,
      inRange: pool.tick >= tickLower && pool.tick < tickUpper,
    }
  }

  async function onManualWithdraw() {
    if (sendBlockReason) {
      alert(sendBlockReason)
      return
    }
    const id = BigInt(manualTokenId.trim() || '0')
    if (id <= 0n) {
      alert('请填写有效 tokenId')
      return
    }
    const p = await loadPosition(id)
    if (p) await onWithdraw(p)
  }

  async function onCollect(p: LpPosition) {
    if (!address || !pool) return
    if (sendBlockReason) {
      alert(sendBlockReason)
      return
    }
    if (pool.stale) {
      alert('行情已过期，请先刷新')
      return
    }
    if (!slipOk) {
      alert('请填写有效滑点（不会自动放宽）')
      return
    }
    const amount0Min = applySlippageMin(p.fees0, slip)
    const amount1Min = applySlippageMin(p.fees1, slip)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(deadlineMin) * 60)
    const { unlockData, value } = encodeCollectFees({
      tokenId: p.tokenId,
      recipient: address,
      amount0Min,
      amount1Min,
    })
    await tx.buildModifyTx({
      title: `提取手续费 #${p.tokenId}`,
      summary: [
        `预估待领 ${formatUnits(p.fees0, 18, 6)} HYPE + ${formatUnits(p.fees1, 18, 6)} KNTQ`,
        `最少领取 ${formatUnits(amount0Min, 18, 6)} HYPE + ${formatUnits(amount1Min, 18, 6)} KNTQ（滑点 ${slip}%）`,
        '动作：DECREASE_LIQUIDITY(0) + TAKE_PAIR',
      ],
      unlockData,
      value,
      deadline,
      hypeDetail: `最少领取 ${formatUnits(amount0Min, 18, 6)} HYPE。不发送原生币（msg.value = 0）。`,
      kntqDetail: `最少领取 ${formatUnits(amount1Min, 18, 6)} KNTQ。这次不从钱包转出余额。`,
      permitDetail: '这次不调用 Permit2，也不授权 KNTQ。',
    })
  }

  async function onWithdraw(p: LpPosition) {
    if (!address || !pool) return
    if (sendBlockReason) {
      alert(sendBlockReason)
      return
    }
    if (pool.stale) {
      alert('行情已过期，请先刷新')
      return
    }
    if (!slipOk) {
      alert('请填写有效滑点（不会自动放宽）')
      return
    }
    const ok = confirm(`确认撤出仓位 #${p.tokenId} 的全部流动性并领回代币？`)
    if (!ok) return
    const sqrtA = getSqrtRatioAtTick(p.tickLower)
    const sqrtB = getSqrtRatioAtTick(p.tickUpper)
    const amounts = getAmountsForLiquidity(pool.sqrtPriceX96, sqrtA, sqrtB, p.liquidity)
    const amount0Min = applySlippageMin(amounts.amount0, slip)
    const amount1Min = applySlippageMin(amounts.amount1, slip)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(deadlineMin) * 60)
    const { unlockData, value } = encodeDecreaseLiquidity({
      tokenId: p.tokenId,
      liquidity: p.liquidity,
      amount0Min,
      amount1Min,
      recipient: address,
      burn: true,
    })
    await tx.buildModifyTx({
      title: `撤池并销毁 NFT #${p.tokenId}`,
      summary: [
        `流动性 ${p.liquidity.toString()}`,
        `最少收回 ${formatUnits(amount0Min, 18)} HYPE + ${formatUnits(amount1Min, 18)} KNTQ（滑点 ${slip}%）`,
        `deadline ${deadlineMin} 分钟`,
        '动作：BURN_POSITION + TAKE_PAIR',
      ],
      unlockData,
      value,
      deadline,
      hypeDetail: `最少收回 ${formatUnits(amount0Min, 18)} HYPE。不发送原生币（msg.value = 0）。`,
      kntqDetail: `最少收回 ${formatUnits(amount1Min, 18)} KNTQ。这次不从钱包转出余额。`,
      permitDetail: '这次不调用 Permit2，也不授权 KNTQ。',
    })
  }

  function refreshAll() {
    void refreshPool()
    void refreshBal()
    void refreshPos()
    void refreshPrice()
  }

  return (
    <div className="app">
      <ConnectBar />
      <StaleBanner stale={!!pool?.stale} rpcError={poolErr} onRefresh={refreshAll} />
      <PriceCheckBanner result={priceCheck} />

      <section className="panel meta">
        <div>
          <div className="label">池子</div>
          <div className="mono small">
            HYPE(native) / KNTQ · fee {POOL_KEY.fee} ({POOL_KEY.fee / 10000}%) · spacing{' '}
            {POOL_KEY.tickSpacing}
          </div>
        </div>
        <div>
          <div className="label">现价（链上 slot0）</div>
          <div>
            {pool
              ? `1 HYPE ≈ ${pool.priceKntqPerHype.toPrecision(6)} KNTQ · tick ${pool.tick}`
              : '读取中…'}
          </div>
        </div>
        <div>
          <div className="label">HYPE/USD（可选，仅展示，不伪造）</div>
          <input
            value={hypeUsd}
            onChange={(e) => setHypeUsd(e.target.value)}
            placeholder="手动填入，用于卡片美元估值"
          />
        </div>
        <div>
          <div className="label">领费 / 撤池滑点 %</div>
          <input
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            placeholder="0.5"
          />
          <div className="muted small">仅你填写；失败不会自动放宽</div>
        </div>
        <div>
          <div className="label">领费 / 撤池 Deadline（分钟）</div>
          <input
            value={deadlineMin}
            onChange={(e) => setDeadlineMin(e.target.value)}
            placeholder="20"
          />
        </div>
        {isConnected && (
          <div>
            <div className="label">钱包余额</div>
            <div>
              {formatUnits(hype, 18, 4)} HYPE · {formatUnits(kntq, 18, 4)} KNTQ
            </div>
          </div>
        )}
      </section>

      {isConnected ? (
        <div className="layout-main">
          <div className="col-mint">
            <AddLiquidityForm
              pool={pool}
              hypeBal={hype}
              kntqBal={kntq}
              tx={tx}
              sendBlockReason={sendBlockReason}
            />
          </div>
          <div className="col-positions">
            <PositionGrid
              positions={positions}
              pool={pool}
              loading={loading}
              error={posError}
              manualTokenId={manualTokenId}
              sendBlockReason={sendBlockReason}
              onManualTokenIdChange={setManualTokenId}
              onManualWithdraw={() => void onManualWithdraw()}
              onRefresh={() => void refreshPos()}
              onCollect={(p) => void onCollect(p)}
              onWithdraw={(p) => void onWithdraw(p)}
            />
          </div>
        </div>
      ) : (
        <p className="panel muted">连接钱包后可查看余额、持仓并组池/领费/撤池。</p>
      )}

      {tx.preview && (
        <TxPreviewModal
          preview={tx.preview}
          simulating={tx.simulating}
          sending={tx.sending}
          error={tx.error}
          onConfirm={() =>
            void tx.confirmAndSend().then(() => {
              refreshAll()
            })
          }
          onCancel={tx.closePreview}
        />
      )}
      {tx.lastTx && (
        <p className="panel muted mono">
          最近交易：{' '}
          <a href={explorerTx(tx.lastTx)} target="_blank" rel="noreferrer">
            {tx.lastTx}
          </a>
        </p>
      )}
    </div>
  )
}
