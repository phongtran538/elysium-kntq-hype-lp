import { encodeFunctionData, type PublicClient, type WalletClient } from 'viem'
import { positionManagerAbi } from '../../src/abis/positionManager'
import {
  KNTQ,
  PERMIT2,
  POOL_KEY,
  POSITION_MANAGER,
  UNIVERSAL_ROUTER,
  explorerAddress,
} from '../../src/config/contracts'
import { priceAtTick } from '../../src/config/ranges'
import {
  encodeClosePosition,
  encodeMintPosition,
  encodeV4ExactInputSingle,
} from '../../src/lib/actions'
import {
  formatUnits,
  getSqrtRatioAtTick,
  liquidityUnderSlippageCap,
  principalSlippageMins,
  rangeEdgeStatus,
} from '../../src/lib/math'
import { crossCheckPoolPrice, type PriceConsensus } from '../../src/lib/priceCheck'
import { createResilientClient } from '../../src/lib/resilientRpc'
import {
  accountFrom,
  assertChain,
  ensureKntqAllowance,
  hypeBalance,
  kntqBalance,
  makeClients,
  quoteExactIn,
  reserveWei,
  sendChecked,
} from './chain'
import type { BotConfig } from './env'
import { log, safeError } from './log'
import {
  cooldownRemainingMs,
  decideRebalance,
  planSwap,
  rangeAroundTick,
  spendable,
} from './plan'
import { loadPositions, type BotPosition } from './positions'
import { withBackoff } from './retry'
import { addHistory } from './history'
import { markPositionClosed, notePendingMint, recordCollected, recordGas, recordSwapCost } from './pnlStore'
import { readState, writeState } from './state'

const DEADLINE_SECONDS = 10 * 60

function fmtPrice(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '?'
  if (p >= 1000) return p.toFixed(2)
  if (p >= 1) return p.toPrecision(6)
  return p.toPrecision(4)
}

function host(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

function shortRpcError(error: string | undefined): string {
  const raw = (error ?? 'lỗi').replace(/\s+/g, ' ')
  if (/timed out|timeout|took too long/i.test(raw)) return 'hết giờ chờ'
  if (/failed to fetch|network|econn/i.test(raw)) return 'không kết nối được'
  return (raw.split(/request body/i)[0] ?? raw).trim().slice(0, 120)
}

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)
}

function printConsensus(c: PriceConsensus): void {
  log('Đối chiếu giá slot0 (StateView) trên từng RPC:')
  for (const s of c.samples) {
    if (s.ok && s.price != null && s.outlier) {
      log(
        `  ${host(s.url)}: 1 HYPE ≈ ${fmtPrice(s.price)} KNTQ, tick ${s.tick} — loại, lệch ${(s.deviationPct ?? 0).toFixed(2)}% so với giá giữa`,
      )
    } else if (s.ok && s.price != null) {
      log(`  ${host(s.url)}: 1 HYPE ≈ ${fmtPrice(s.price)} KNTQ, tick ${s.tick}`)
    } else {
      log(`  ${host(s.url)}: không đọc được (${shortRpcError(s.error)})`)
    }
  }
  if (c.agreed) {
    const dropped = c.samples.filter((s) => s.outlier).length
    log(
      `Giá khớp: ${c.agreeing} RPC trong 1% quanh giá giữa${dropped ? `, ${dropped} RPC bị loại` : ''}. Dùng RPC ${c.chosenRpc ? host(c.chosenRpc) : '?'}.`,
    )
  } else {
    log(c.blockReason ?? 'Không đủ RPC khớp quanh giá giữa. Bot sẽ không gửi giao dịch.')
  }
}

function printPosition(p: BotPosition, price: number, triggerPct: number): void {
  const status = rangeEdgeStatus(price, p.lowerPrice, p.upperPrice, triggerPct)
  const where =
    status.level === 'out'
      ? `NGOÀI khoảng (phía ${status.side === 'below' ? 'dưới' : 'trên'})`
      : status.level === 'near'
        ? `TRONG khoảng nhưng sát mép ${status.nearest === 'lower' ? 'dưới' : 'trên'} (${Math.min(status.distanceLowerPct, status.distanceUpperPct).toFixed(2)}%)`
        : status.level === 'inside'
          ? `TRONG khoảng (cách mép dưới ${status.distanceLowerPct.toFixed(2)}%, mép trên ${status.distanceUpperPct.toFixed(2)}%)`
          : 'không rõ'
  const fees = p.feesKnown
    ? `${formatUnits(p.fees0, 18, 6)} HYPE + ${formatUnits(p.fees1, 18, 6)} KNTQ`
    : 'không đọc được'
  log(
    `Vị thế #${p.tokenId}: tick [${p.tickLower}, ${p.tickUpper}], giá ${fmtPrice(p.lowerPrice)} – ${fmtPrice(p.upperPrice)} KNTQ/HYPE. ${where}.`,
  )
  log(
    `  Thanh khoản ${p.liquidity}. Ước lượng ${formatUnits(p.amount0, 18, 4)} HYPE + ${formatUnits(p.amount1, 18, 4)} KNTQ. Phí chưa rút: ${fees}.`,
  )
}

async function freshConsensus(cfg: BotConfig): Promise<PriceConsensus> {
  return withBackoff('đối chiếu giá', () => crossCheckPoolPrice(cfg.rpcUrls))
}

export async function runStatus(cfg: BotConfig): Promise<number> {
  log(cfg.dryRun ? 'Chế độ DRY_RUN (lệnh status không gửi giao dịch).' : 'Lệnh status chỉ đọc, không gửi giao dịch.')
  let consensus: PriceConsensus
  try {
    consensus = await freshConsensus(cfg)
  } catch (e) {
    log(`Không gọi được RPC: ${safeError(e)}`)
    return 1
  }
  printConsensus(consensus)
  const reachable = consensus.samples.some((s) => s.ok)
  if (!reachable || consensus.medianSqrtPriceX96 == null || consensus.chosenRpc == null) {
    log('Không RPC công khai nào trả lời. Kiểm tra mạng rồi chạy lại.')
    return 1
  }
  if (!cfg.privateKey) {
    log('Chưa có PRIVATE_KEY nên không xem được ví. Giá ở trên vẫn đọc được. Đừng gửi khoá cho ai — chỉ để trong file .env trên máy bạn.')
    return 0
  }
  const account = accountFrom(cfg.privateKey)
  log(`Ví: ${account.address}`)
  const { publicClient } = makeClients(consensus.chosenRpc, account)
  await assertChain(publicClient)
  const reader = createResilientClient(cfg.rpcUrls)
  const [hype, kntq, positions] = await Promise.all([
    hypeBalance(reader, account.address),
    kntqBalance(reader, account.address),
    loadPositions(reader, account.address, consensus.medianSqrtPriceX96, {
      startBlock: cfg.startBlock,
      cacheMs: Math.max(5_000, cfg.pollSeconds * 1000 - 2_000),
    }),
  ])
  log(`Số dư: ${formatUnits(hype, 18, 4)} HYPE, ${formatUnits(kntq, 18, 4)} KNTQ.`)
  if (positions.length === 0) {
    log('Ví này không có vị thế nào (liquidity > 0) trong pool HYPE/KNTQ. Bot không tự mở vị thế mới.')
  } else {
    for (const p of positions) printPosition(p, consensus.medianPrice ?? 0, cfg.triggerPct)
  }
  return 0
}

async function guardBalance(
  client: PublicClient,
  address: `0x${string}`,
  value: bigint,
  reserve: bigint,
  label: string,
): Promise<void> {
  const bal = await hypeBalance(client, address)
  if (bal < value + reserve) {
    throw new Error(
      `${label}: ví có ${formatUnits(bal, 18, 4)} HYPE, cần giữ lại ${formatUnits(reserve, 18, 4)} cho gas và còn phải gửi ${formatUnits(value, 18, 4)}. Dừng, không gửi.`,
    )
  }
}

export async function runLoop(cfg: BotConfig, shouldStop: () => boolean): Promise<boolean> {
  if (!cfg.privateKey) {
    log('Thiếu PRIVATE_KEY trong file .env. Tạo một ví MỚI, chỉ bỏ ít tiền vào, rồi dán khoá vào .env trên máy bạn. Đừng gửi khoá cho bất kỳ ai.')
    return false
  }
  const account = accountFrom(cfg.privateKey)
  if (cfg.dryRun) {
    log('DRY_RUN=true — bot CHỈ in kế hoạch ra màn hình và file logs/bot.log. Không gửi giao dịch.')
  } else {
    log('DRY_RUN=false — bot SẼ gửi giao dịch thật từ ví riêng này. Bấm Dừng trên trang hoặc Ctrl+C.')
  }
  log(`Ví bot: ${account.address}`)
  log(
    `Khoảng mới ±${cfg.rangePct}% (tickSpacing ${POOL_KEY.tickSpacing}), kích hoạt khi cách mép ≤ ${cfg.triggerPct}% hoặc ra ngoài. Chờ tối thiểu ${cfg.minRebalanceIntervalMinutes} phút. Trượt giá tối đa ${cfg.maxSlippageBps} bps. Gas tối đa ${cfg.maxGas}.`,
  )
  if (cfg.rangePct <= cfg.triggerPct) {
    log('RANGE_PCT đang nhỏ hơn hoặc bằng TRIGGER_PCT. Vị thế mới sẽ bị coi là sát mép ngay, bot sẽ không cân bằng lại cho đến khi bạn nới khoảng.')
  }
  log(`Hợp đồng: PositionManager ${explorerAddress(POSITION_MANAGER)}`)
  log(`Hợp đồng: Permit2 ${explorerAddress(PERMIT2)}`)
  log(`Hợp đồng: KNTQ ${explorerAddress(KNTQ)}`)
  log(`Hợp đồng: Universal Router ${explorerAddress(UNIVERSAL_ROUTER)} (chỉ swap đúng pool này)`)

  while (!shouldStop()) {
    try {
      await cycle(cfg, account)
    } catch (e) {
      log(`Vòng này lỗi, đợi ${cfg.pollSeconds} giây rồi thử lại: ${safeError(e)}`)
    }
    let left = cfg.pollSeconds * 1000
    while (left > 0 && !shouldStop()) {
      const step = Math.min(1000, left)
      await new Promise((r) => setTimeout(r, step))
      left -= step
    }
  }
  log('Bot đã dừng. Không gửi thêm giao dịch.')
  return true
}

async function cycle(cfg: BotConfig, account: ReturnType<typeof accountFrom>): Promise<void> {
  const consensus = await freshConsensus(cfg)
  printConsensus(consensus)
  if (!consensus.agreed || !consensus.chosenRpc || consensus.medianSqrtPriceX96 == null || consensus.medianTick == null || consensus.medianPrice == null) {
    log('Bỏ qua vòng này vì giá các RPC không khớp hoặc không đọc được.')
    return
  }
  const { publicClient, walletClient } = makeClients(consensus.chosenRpc, account)
  await assertChain(publicClient)
  const reader = createResilientClient(cfg.rpcUrls)
  const positions = await withBackoff('đọc vị thế', () =>
    loadPositions(reader, account.address, consensus.medianSqrtPriceX96!, {
      startBlock: cfg.startBlock,
      cacheMs: Math.max(5_000, cfg.pollSeconds * 1000 - 2_000),
    }),
  )
  const state = readState()

  if (!cfg.dryRun && state.pendingTokenId) {
    log(`Còn việc dở với vị thế #${state.pendingTokenId}. Làm nốt, không tính thời gian chờ.`)
    const still = positions.find((p) => p.tokenId.toString() === state.pendingTokenId)
    if (still) {
      await closeOne(cfg, publicClient, walletClient, account, still, consensus.medianSqrtPriceX96)
      await swapAndMint(cfg, account)
      writeState({ lastRebalanceAt: Date.now(), pendingTokenId: null })
      log('Cân bằng lại xong.')
      return
    }
    if (positions.length > 0) {
      log('Vị thế cũ đã đóng và ví đang có vị thế khác. Không mint thêm. Xóa cờ việc dở.')
      writeState({ lastRebalanceAt: state.lastRebalanceAt ?? Date.now(), pendingTokenId: null })
      return
    }
    log('Vị thế cũ không còn, ví cũng chưa có vị thế mới. Mint tiếp.')
    await swapAndMint(cfg, account)
    writeState({ lastRebalanceAt: Date.now(), pendingTokenId: null })
    log('Cân bằng lại xong.')
    return
  }

  if (positions.length === 0) {
    log('Không có vị thế trong pool này. Bot không tự mở vị thế mới.')
    return
  }
  for (const p of positions) printPosition(p, consensus.medianPrice, cfg.triggerPct)

  const wait = cooldownRemainingMs(state.lastRebalanceAt, Date.now(), cfg.minRebalanceIntervalMinutes)
  if (wait > 0) {
    log(`Còn thời gian chờ ${(wait / 60000).toFixed(1)} phút. Bỏ qua, không gửi gì.`)
    return
  }

  const ranked = positions
    .map((p) => ({
      p,
      decision: decideRebalance({
        price: consensus.medianPrice!,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        currentTick: consensus.medianTick!,
        triggerPct: cfg.triggerPct,
        rangePct: cfg.rangePct,
      }),
    }))
    .filter((row) => row.decision.action !== 'none')

  if (ranked.length === 0) {
    log('Giá còn khá xa mép khoảng. Không cân bằng lại.')
    return
  }
  const hot = ranked.find((row) => row.decision.action === 'skip-hot-range')
  const ready = ranked.find((row) => row.decision.action === 'rebalance')
  if (!ready) {
    log('Có vị thế cần chuyển, nhưng khoảng mới (±RANGE_PCT) vẫn nằm trong ngưỡng kích hoạt. Tăng RANGE_PCT hoặc giảm TRIGGER_PCT. Không gửi gì.')
    if (hot) printPosition(hot.p, consensus.medianPrice, cfg.triggerPct)
    return
  }
  if (ranked.length > 1) {
    log(`Có ${ranked.length} vị thế cần chuyển. Vòng này chỉ làm #${ready.p.tokenId}, vị thế khác đợi hết thời gian chờ.`)
  }

  log(`Quyết định cân bằng lại vị thế #${ready.p.tokenId}.`)
  if (cfg.dryRun) {
    await describePlan(cfg, publicClient, account.address, ready.p, consensus)
    log('DRY_RUN kết thúc vòng này. Không có giao dịch nào được gửi.')
    addHistory({
      at: Date.now(),
      kind: 'dry-run',
      summary: `Chỉ in kế hoạch cho vị thế #${ready.p.tokenId}. Không gửi giao dịch.`,
    })
    return
  }

  writeState({ lastRebalanceAt: state.lastRebalanceAt, pendingTokenId: ready.p.tokenId.toString() })
  await closeOne(cfg, publicClient, walletClient, account, ready.p, consensus.medianSqrtPriceX96)
  await swapAndMint(cfg, account)
  writeState({ lastRebalanceAt: Date.now(), pendingTokenId: null })
  addHistory({
    at: Date.now(),
    kind: 'live',
    summary: `Đã cân bằng lại vị thế #${ready.p.tokenId}.`,
  })
  log('Cân bằng lại xong.')
}

async function describePlan(
  cfg: BotConfig,
  client: PublicClient,
  owner: `0x${string}`,
  position: BotPosition,
  consensus: PriceConsensus,
): Promise<void> {
  const sqrt = consensus.medianSqrtPriceX96!
  const tick = consensus.medianTick!
  const next = rangeAroundTick(tick, cfg.rangePct)
  const slipPct = cfg.maxSlippageBps / 100
  const mins = principalSlippageMins({
    sqrtPriceX96: sqrt,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: position.liquidity,
    slippagePct: slipPct,
  })
  log('Kế hoạch (DRY_RUN, không gửi):')
  log(
    `1. Gọi PositionManager ${POSITION_MANAGER}: DECREASE_LIQUIDITY về 0 + TAKE_PAIR + BURN_POSITION cho #${position.tokenId}.`,
  )
  log(
    `   Liquidity ${position.liquidity}. Tối thiểu trên phần gốc (không gồm phí) ${formatUnits(mins.amount0Min, 18, 4)} HYPE + ${formatUnits(mins.amount1Min, 18, 4)} KNTQ. Hạn ${DEADLINE_SECONDS / 60} phút. Trượt giá ${cfg.maxSlippageBps} bps.`,
  )
  const hype = await hypeBalance(client, owner)
  const kntq = await kntqBalance(client, owner)
  const reserve = await reserveWei(client, cfg)
  const after0 = spendable(hype + position.amount0 + position.fees0, reserve)
  const after1 = kntq + position.amount1 + position.fees1
  log(
    `   Ước lượng số dư sau khi rút (chưa tính giá trượt): ${formatUnits(after0, 18, 4)} HYPE dùng được + ${formatUnits(after1, 18, 4)} KNTQ. Giữ lại ${formatUnits(reserve, 18, 4)} HYPE cho gas.`,
  )
  const swap = planSwap({
    bal0: after0,
    bal1: after1,
    sqrtPriceX96: sqrt,
    tickLower: next.tickLower,
    tickUpper: next.tickUpper,
  })
  if (!swap) {
    log('2. Không cần swap. Tỉ lệ HYPE/KNTQ đã gần với khoảng mới.')
  } else {
    log(
      `2. Swap qua Universal Router ${UNIVERSAL_ROUTER}, chỉ pool V4 này (fee ${POOL_KEY.fee}, spacing ${POOL_KEY.tickSpacing}, không hook).`,
    )
    log(
      swap.zeroForOne
        ? `   Bán khoảng ${formatUnits(swap.amountIn, 18, 4)} HYPE lấy KNTQ. msg.value = số đó. Trượt giá tối đa ${cfg.maxSlippageBps} bps.`
        : `   Bán khoảng ${formatUnits(swap.amountIn, 18, 4)} KNTQ lấy HYPE. Cần approve KNTQ ${KNTQ} → Permit2 ${PERMIT2} → router. Trượt giá tối đa ${cfg.maxSlippageBps} bps.`,
    )
    try {
      const quoted = await quoteExactIn(client, swap.zeroForOne, swap.amountIn)
      const minOut = (quoted * BigInt(10_000 - cfg.maxSlippageBps)) / 10_000n
      log(`   Quoter báo nhận khoảng ${formatUnits(quoted, 18, 4)}, tối thiểu chấp nhận ${formatUnits(minOut, 18, 4)}.`)
    } catch (e) {
      log(`   Không quote được (${safeError(e)}). Lúc chạy thật bot sẽ hủy swap chứ không swap mù.`)
    }
  }
  log(
    `3. Mint khoảng mới tick [${next.tickLower}, ${next.tickUpper}] (±${cfg.rangePct}% quanh tick ${tick}, đã làm tròn spacing ${POOL_KEY.tickSpacing}) trên PositionManager ${POSITION_MANAGER}.`,
  )
  log('Không gửi approve, không gửi swap, không gửi mint.')
}

async function closeOne(
  cfg: BotConfig,
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: ReturnType<typeof accountFrom>,
  position: BotPosition,
  sqrtPriceX96: bigint,
): Promise<void> {
  const slipPct = cfg.maxSlippageBps / 100
  const mins = principalSlippageMins({
    sqrtPriceX96,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: position.liquidity,
    slippagePct: slipPct,
  })
  const { unlockData, value } = encodeClosePosition({
    tokenId: position.tokenId,
    liquidity: position.liquidity,
    amount0Min: mins.amount0Min,
    amount1Min: mins.amount1Min,
    recipient: account.address,
  })
  const data = encodeFunctionData({
    abi: positionManagerAbi,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline()],
  })
  const reserve = await reserveWei(publicClient, cfg)
  await guardBalance(publicClient, account.address, value, reserve, 'Đóng vị thế')
  log(
    `Đóng #${position.tokenId}: giảm liquidity về 0, TAKE_PAIR, rồi burn NFT. Tối thiểu trên phần gốc (không gồm phí) ${formatUnits(mins.amount0Min, 18, 4)} HYPE + ${formatUnits(mins.amount1Min, 18, 4)} KNTQ.`,
  )
  await sendChecked({
    publicClient,
    walletClient,
    account,
    to: POSITION_MANAGER,
    data,
    value,
    maxGas: cfg.maxGas,
    dryRun: cfg.dryRun,
    label: `Đóng vị thế #${position.tokenId}`,
    onReceipt: ({ gasWei }) => {
      const id = position.tokenId.toString()
      recordGas(account.address, id, gasWei)
      recordCollected(account.address, id, position.fees0, position.fees1)
      markPositionClosed(account.address, id)
    },
  })
}

async function swapAndMint(
  cfg: BotConfig,
  account: ReturnType<typeof accountFrom>,
): Promise<void> {
  const again = await freshConsensus(cfg)
  printConsensus(again)
  if (!again.agreed || again.medianSqrtPriceX96 == null || again.medianTick == null || !again.chosenRpc) {
    throw new Error('Giá RPC lệch sau khi đóng vị thế. Dừng trước khi swap. Vòng sau sẽ thử mint tiếp.')
  }
  const clients = makeClients(again.chosenRpc, account)
  const sqrt = again.medianSqrtPriceX96
  const tick = again.medianTick
  const next = rangeAroundTick(tick, cfg.rangePct)
  const spot = again.medianPrice ?? 0
  const nextStatus = rangeEdgeStatus(
    spot,
    priceAtTick(next.tickLower),
    priceAtTick(next.tickUpper),
    cfg.triggerPct,
  )
  if (nextStatus.level === 'out' || nextStatus.level === 'near') {
    throw new Error('Khoảng mới vẫn sát mép. Không swap, không mint. Sửa RANGE_PCT / TRIGGER_PCT.')
  }

  const reserve = await reserveWei(clients.publicClient, cfg)
  let hype = await hypeBalance(clients.publicClient, account.address)
  let kntq = await kntqBalance(clients.publicClient, account.address)
  let bal0 = spendable(hype, reserve)
  log(
    `Sau khi rút: ${formatUnits(hype, 18, 4)} HYPE (dùng được ${formatUnits(bal0, 18, 4)} sau khi chừa ${formatUnits(reserve, 18, 4)} gas), ${formatUnits(kntq, 18, 4)} KNTQ.`,
  )
  const swap = planSwap({
    bal0,
    bal1: kntq,
    sqrtPriceX96: sqrt,
    tickLower: next.tickLower,
    tickUpper: next.tickUpper,
  })
  if (swap) {
    if (swap.zeroForOne && swap.amountIn > bal0) {
      throw new Error('Số HYPE cần swap lớn hơn số dư sau khi chừa gas. Hủy.')
    }
    const quoted = await withBackoff('quote swap', () =>
      quoteExactIn(clients.publicClient, swap.zeroForOne, swap.amountIn),
    )
    if (quoted <= 0n) throw new Error('Quoter trả 0. Không swap mù.')
    const minOut = (quoted * BigInt(10_000 - cfg.maxSlippageBps)) / 10_000n
    log(
      swap.zeroForOne
        ? `Swap ${formatUnits(swap.amountIn, 18, 4)} HYPE → tối thiểu ${formatUnits(minOut, 18, 4)} KNTQ qua pool này.`
        : `Swap ${formatUnits(swap.amountIn, 18, 4)} KNTQ → tối thiểu ${formatUnits(minOut, 18, 4)} HYPE qua pool này.`,
    )
    if (!swap.zeroForOne) {
      await ensureKntqAllowance({
        publicClient: clients.publicClient,
        walletClient: clients.walletClient,
        account,
        spender: UNIVERSAL_ROUTER,
        amount: swap.amountIn,
        maxGas: cfg.maxGas,
        dryRun: cfg.dryRun,
        spenderName: 'Universal Router',
      })
    }
    const tx = encodeV4ExactInputSingle({
      zeroForOne: swap.zeroForOne,
      amountIn: swap.amountIn,
      amountOutMinimum: minOut,
      deadline: deadline(),
    })
    const kntqBefore = kntq
    const hypeBefore = hype
    await guardBalance(clients.publicClient, account.address, tx.value, reserve, 'Swap')
    await sendChecked({
      publicClient: clients.publicClient,
      walletClient: clients.walletClient,
      account,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      maxGas: cfg.maxGas,
      dryRun: cfg.dryRun,
      label: 'Swap trong pool HYPE/KNTQ',
      onReceipt: ({ gasWei }) => recordGas(account.address, null, gasWei),
    })
    hype = await hypeBalance(clients.publicClient, account.address)
    kntq = await kntqBalance(clients.publicClient, account.address)
    if (!cfg.dryRun && again.medianPrice && again.medianPrice > 0) {
      const actualOut = swap.zeroForOne ? kntq - kntqBefore : hype - hypeBefore
      if (quoted > actualOut && actualOut >= 0n) {
        const short = quoted - actualOut
        const priceWei = BigInt(Math.round(again.medianPrice * 1e8)) * 10n ** 10n
        const costHype = swap.zeroForOne ? (short * 10n ** 18n) / priceWei : short
        recordSwapCost(account.address, null, costHype)
      }
    }
    bal0 = spendable(hype, reserve)
  } else {
    log('Không cần swap. Tỉ lệ hai đồng đã khớp khoảng mới.')
  }

  const fresh = await freshConsensus(cfg)
  printConsensus(fresh)
  if (!fresh.agreed || !fresh.medianSqrtPriceX96 || fresh.medianPrice == null) {
    throw new Error('Giá các RPC không khớp ngay trước khi mint. Dừng, không gửi.')
  }
  const slipPct = cfg.maxSlippageBps / 100
  const sqrtA = getSqrtRatioAtTick(next.tickLower)
  const sqrtB = getSqrtRatioAtTick(next.tickUpper)
  const sized = liquidityUnderSlippageCap({
    sqrtPriceX96: fresh.medianSqrtPriceX96,
    sqrtLowerX96: sqrtA,
    sqrtUpperX96: sqrtB,
    available0: bal0,
    available1: kntq,
    slippagePct: slipPct,
  })
  if (sized.liquidity === 0n) {
    throw new Error('Không đủ HYPE/KNTQ để mint sau khi chừa gas. Dừng.')
  }
  const { liquidity: liq, used0, used1, amount0Max, amount1Max } = sized
  if (amount1Max > 0n) {
    await ensureKntqAllowance({
      publicClient: clients.publicClient,
      walletClient: clients.walletClient,
      account,
      spender: POSITION_MANAGER,
      amount: amount1Max,
      maxGas: cfg.maxGas,
      dryRun: cfg.dryRun,
      spenderName: 'PositionManager',
    })
  }
  const minted = encodeMintPosition({
    tickLower: next.tickLower,
    tickUpper: next.tickUpper,
    liquidity: liq,
    amount0Max,
    amount1Max,
    recipient: account.address,
  })
  const data = encodeFunctionData({
    abi: positionManagerAbi,
    functionName: 'modifyLiquidities',
    args: [minted.unlockData, deadline()],
  })
  log(
    `Mint tick [${next.tickLower}, ${next.tickUpper}], liquidity ${liq}, tối đa ${formatUnits(amount0Max, 18, 4)} HYPE + ${formatUnits(amount1Max, 18, 4)} KNTQ.`,
  )
  if (!cfg.dryRun) {
    notePendingMint(account.address, used0, used1, fresh.medianPrice ?? 0)
  }
  await guardBalance(clients.publicClient, account.address, minted.value, reserve, 'Mint')
  await sendChecked({
    publicClient: clients.publicClient,
    walletClient: clients.walletClient,
    account,
    to: POSITION_MANAGER,
    data,
    value: minted.value,
    maxGas: cfg.maxGas,
    dryRun: cfg.dryRun,
    label: 'Mint vị thế mới',
    onReceipt: ({ gasWei }) => recordGas(account.address, null, gasWei),
  })
}
