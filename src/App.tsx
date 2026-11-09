import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectBar } from './components/ConnectBar'
import { StaleBanner } from './components/StaleBanner'
import { AddLiquidityForm } from './components/AddLiquidityForm'
import { PositionGrid } from './components/PositionGrid'
import { TxPreviewModal } from './components/TxPreviewModal'
import { PriceCheckBanner } from './components/PriceCheckBanner'
import { BotPanel } from './components/BotPanel'
import { botFetch, botToken, type WalletPnl } from './lib/botClient'
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
  const [tab, setTab] = useState<'pool' | 'bot'>('pool')
  const [manualPnl, setManualPnl] = useState<WalletPnl | null>(null)
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
      alert(`NFT #${tokenId} không thuộc ví đang kết nối (chủ sở hữu ${owner})`)
      return null
    }
    if (liquidity === 0n) {
      alert(`NFT #${tokenId} không còn thanh khoản`)
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
      alert('Điền mã NFT hợp lệ')
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
      alert('Giá đã cũ, hãy làm mới trước')
      return
    }
    if (!slipOk) {
      alert('Điền trượt giá hợp lệ (app không tự nới)')
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
      title: `Rút phí #${p.tokenId}`,
      summary: [
        `Ước tính được nhận ${formatUnits(p.fees0, 18, 6)} HYPE + ${formatUnits(p.fees1, 18, 6)} KNTQ`,
        `Nhận tối thiểu ${formatUnits(amount0Min, 18, 6)} HYPE + ${formatUnits(amount1Min, 18, 6)} KNTQ (trượt giá ${slip}%)`,
        'Việc làm: DECREASE_LIQUIDITY(0) + TAKE_PAIR',
      ],
      unlockData,
      value,
      deadline,
      hypeDetail: `Nhận tối thiểu ${formatUnits(amount0Min, 18, 6)} HYPE. Không gửi HYPE native (msg.value = 0).`,
      kntqDetail: `Nhận tối thiểu ${formatUnits(amount1Min, 18, 6)} KNTQ. Không chuyển số dư ra khỏi ví.`,
      permitDetail: 'Lần này không gọi Permit2 và không cấp quyền KNTQ.',
    })
  }

  async function onWithdraw(p: LpPosition) {
    if (!address || !pool) return
    if (sendBlockReason) {
      alert(sendBlockReason)
      return
    }
    if (pool.stale) {
      alert('Giá đã cũ, hãy làm mới trước')
      return
    }
    if (!slipOk) {
      alert('Điền trượt giá hợp lệ (app không tự nới)')
      return
    }
    const ok = confirm(`Rút hết thanh khoản vị thế #${p.tokenId} và nhận lại token?`)
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
      title: `Rút pool và hủy NFT #${p.tokenId}`,
      summary: [
        `Thanh khoản ${p.liquidity.toString()}`,
        `Nhận lại tối thiểu ${formatUnits(amount0Min, 18)} HYPE + ${formatUnits(amount1Min, 18)} KNTQ (trượt giá ${slip}%)`,
        `Hạn chót ${deadlineMin} phút`,
        'Việc làm: BURN_POSITION + TAKE_PAIR',
      ],
      unlockData,
      value,
      deadline,
      hypeDetail: `Nhận lại tối thiểu ${formatUnits(amount0Min, 18)} HYPE. Không gửi HYPE native (msg.value = 0).`,
      kntqDetail: `Nhận lại tối thiểu ${formatUnits(amount1Min, 18)} KNTQ. Không chuyển số dư ra khỏi ví.`,
      permitDetail: 'Lần này không gọi Permit2 và không cấp quyền KNTQ.',
    })
  }

  useEffect(() => {
    if (!address || !pool || loading || posError || !botToken()) return
    const dec = (v: bigint) => {
      const neg = v < 0n
      const a = neg ? -v : v
      const whole = a / 10n ** 18n
      const frac = (a % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
      return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`
    }
    void botFetch('/api/pnl/seen', {
      wallet: address,
      price: pool.priceKntqPerHype,
      positions: positions.map((p) => ({
        tokenId: p.tokenId.toString(),
        amount0: dec(p.amount0),
        amount1: dec(p.amount1),
        fees0: dec(p.fees0),
        fees1: dec(p.fees1),
      })),
    })
      .then((res) => {
        const pnl = (res as { pnl?: WalletPnl }).pnl
        if (pnl?.positions) setManualPnl(pnl)
      })
      .catch(() => {
        // Bot server is optional on this tab.
      })
  }, [address, pool, loading, posError, positions])

  function refreshAll() {
    void refreshPool()
    void refreshBal()
    void refreshPos()
    void refreshPrice()
  }

  return (
    <div className="app">
      <ConnectBar />
      <div className="row gap wrap" style={{ marginBottom: '0.8rem' }}>
        <button className={`btn${tab === 'pool' ? ' primary' : ''}`} type="button" onClick={() => setTab('pool')}>
          Thủ công
        </button>
        <button className={`btn${tab === 'bot' ? ' primary' : ''}`} type="button" onClick={() => setTab('bot')}>
          Bot tự động
        </button>
      </div>
      {tab === 'bot' ? (
        <BotPanel />
      ) : (
        <>
      <StaleBanner stale={!!pool?.stale} rpcError={poolErr} onRefresh={refreshAll} />
      <PriceCheckBanner result={priceCheck} />

      <section className="panel meta">
        <div>
          <div className="label">Cặp</div>
          <div className="mono small">
            HYPE(native) / KNTQ · fee {POOL_KEY.fee} ({POOL_KEY.fee / 10000}%) · spacing{' '}
            {POOL_KEY.tickSpacing}
          </div>
        </div>
        <div>
          <div className="label">Giá hiện tại (slot0 trên chain)</div>
          <div>
            {pool
              ? `1 HYPE ≈ ${pool.priceKntqPerHype.toPrecision(6)} KNTQ · tick ${pool.tick}`
              : 'Đang đọc…'}
          </div>
        </div>
        <div>
          <div className="label">HYPE/USD (tùy chọn, chỉ để xem, không tự bịa)</div>
          <input
            value={hypeUsd}
            onChange={(e) => setHypeUsd(e.target.value)}
            placeholder="Tự điền để ước tính đô trên thẻ"
          />
        </div>
        <div>
          <div className="label">Trượt giá khi rút phí / rút pool %</div>
          <input
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            placeholder="0.5"
          />
          <div className="muted small">Chỉ số bạn điền. Lỗi thì không tự nới</div>
        </div>
        <div>
          <div className="label">Hạn chót rút phí / rút pool (phút)</div>
          <input
            value={deadlineMin}
            onChange={(e) => setDeadlineMin(e.target.value)}
            placeholder="20"
          />
        </div>
        {isConnected && (
          <div>
            <div className="label">Số dư ví</div>
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
              pnl={manualPnl}
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
        <p className="panel muted">Kết nối ví để xem số dư, vị thế, thêm thanh khoản, rút phí hoặc rút pool.</p>
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
          Giao dịch gần nhất:{' '}
          <a href={explorerTx(tx.lastTx)} target="_blank" rel="noreferrer">
            {tx.lastTx}
          </a>
        </p>
      )}
        </>
      )}
    </div>
  )
}
