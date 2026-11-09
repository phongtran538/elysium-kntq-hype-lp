import { useCallback, useState } from 'react'
import {
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem'
import { useAccount, useWalletClient } from 'wagmi'
import { publicClient } from '../lib/rpcClient'
import { positionManagerAbi } from '../abis/positionManager'
import { erc20Abi } from '../abis/erc20'
import { permit2Abi } from '../abis/permit2'
import {
  KNTQ,
  PERMIT2,
  POSITION_MANAGER,
} from '../config/contracts'
import { toChineseError } from '../lib/errors'
import { formatUnits } from '../lib/math'
import { crossCheckPoolPrice } from '../lib/priceCheck'

/** Permit2 amount is uint160 */
const PERMIT2_MAX_AMOUNT = 2n ** 160n - 1n
/** Session-scale Permit2 expiry (1 hour), not multi-week unlimited */
const PERMIT2_EXPIRY_SECONDS = 3600
/** Tiny buffer so rounding / pool moves don't brick a just-approved mint */
const APPROVAL_BUFFER_BPS = 10n // 0.1%

export type ApprovalStep = {
  label: string
  to: Address
  data: Hex
  value?: bigint
  /** Human-readable details shown in the preview modal */
  detail?: string[]
}

export type ContractLine = {
  role: string
  name: string
  address: Address
  detail: string
}

export type TxPreview = {
  title: string
  summary: string[]
  to: Address
  data: Hex
  value: bigint
  approvals?: ApprovalStep[]
  /** PositionManager, Permit2, and KNTQ — shown before every step. */
  contracts: ContractLine[]
  /**
   * Which step the user is confirming right now.
   * 0..approvals.length-1 = that approval; approvals.length = main LP tx.
   */
  stepIndex: number
}

function contractLines(opts: {
  hypeDetail: string
  permitDetail: string
  kntqDetail: string
}): ContractLine[] {
  return [
    {
      role: 'Giao dịch chính gọi tới',
      name: 'PositionManager',
      address: POSITION_MANAGER,
      detail: opts.hypeDetail,
    },
    {
      role: 'Hợp đồng cấp quyền',
      name: 'Permit2',
      address: PERMIT2,
      detail: opts.permitDetail,
    },
    {
      role: 'Hợp đồng token',
      name: 'KNTQ',
      address: KNTQ,
      detail: opts.kntqDetail,
    },
  ]
}

function withApprovalBuffer(needed: bigint): bigint {
  if (needed <= 0n) return 0n
  const buffered = needed + (needed * APPROVAL_BUFFER_BPS) / 10_000n
  return buffered > PERMIT2_MAX_AMOUNT ? PERMIT2_MAX_AMOUNT : buffered
}

export function useTxFlow() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [preview, setPreview] = useState<TxPreview | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [sending, setSending] = useState(false)
  const { error, setError } = useStateError()
  const [lastTx, setLastTx] = useState<Hex | null>(null)

  const openPreview = useCallback((p: Omit<TxPreview, 'stepIndex'> & { stepIndex?: number }) => {
    setPreview({ ...p, stepIndex: p.stepIndex ?? 0 })
    setError(null)
    setLastTx(null)
  }, [setError])

  const closePreview = useCallback(() => {
    if (sending || simulating) return
    setPreview(null)
  }, [sending, simulating])

  const ensureKntqPermit2 = useCallback(
    async (neededKntq: bigint): Promise<ApprovalStep[]> => {
      if (!address || neededKntq <= 0n) return []
      const amount = withApprovalBuffer(neededKntq)
      const approvals: ApprovalStep[] = []
      const amountLabel = formatUnits(amount, 18, 6)

      const allowance = await publicClient.readContract({
        address: KNTQ,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, PERMIT2],
      })
      if (allowance < amount) {
        approvals.push({
          label: 'Cho phép KNTQ → Permit2',
          to: KNTQ,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [PERMIT2, amount],
          }),
          detail: [
            `Bên được tiêu: Permit2 (${PERMIT2})`,
            `Hạn mức: ${amountLabel} KNTQ (đúng số lần này + 0,1%, không phải cấp quyền vô hạn)`,
          ],
        })
      }

      const [amt, exp] = await publicClient.readContract({
        address: PERMIT2,
        abi: permit2Abi,
        functionName: 'allowance',
        args: [address, KNTQ, POSITION_MANAGER],
      })
      const now = Math.floor(Date.now() / 1000)
      const expiry = now + PERMIT2_EXPIRY_SECONDS
      const permitAmtOk = amt >= amount
      const permitExpOk = Number(exp) >= now + 300 // at least ~5 min left
      if (!permitAmtOk || !permitExpOk) {
        const permitAmount =
          amount > PERMIT2_MAX_AMOUNT ? PERMIT2_MAX_AMOUNT : amount
        approvals.push({
          label: 'Permit2 cho PositionManager tiêu KNTQ',
          to: PERMIT2,
          data: encodeFunctionData({
            abi: permit2Abi,
            functionName: 'approve',
            args: [KNTQ, POSITION_MANAGER, permitAmount, expiry],
          }),
          detail: [
            `Bên được tiêu: PositionManager (${POSITION_MANAGER})`,
            `Hạn mức: ${formatUnits(permitAmount, 18, 6)} KNTQ (đúng số lần này, không phải 2^160-1)`,
            `Hết hạn sau khoảng 1 giờ (đến ${new Date(expiry * 1000).toLocaleString('vi-VN')})`,
          ],
        })
      }
      return approvals
    },
    [address],
  )

  const buildModifyTx = useCallback(
    async (opts: {
      title: string
      summary: string[]
      unlockData: Hex
      value: bigint
      deadline: bigint
      /** Exact KNTQ the mint/increase may pull (usually amount1Max). Cap approvals to this. */
      kntqAmountNeeded?: bigint
      hypeDetail?: string
      permitDetail?: string
      kntqDetail?: string
    }) => {
      const data = encodeFunctionData({
        abi: positionManagerAbi,
        functionName: 'modifyLiquidities',
        args: [opts.unlockData, opts.deadline],
      })
      const need = opts.kntqAmountNeeded ?? 0n
      const buffered = need > 0n ? withApprovalBuffer(need) : 0n
      const approvals = need > 0n ? await ensureKntqPermit2(need) : []
      const hypeDetail =
        opts.hypeDetail ??
        (opts.value > 0n
          ? `Gửi tối đa ${formatUnits(opts.value, 18)} HYPE (tiền native, msg.value)`
          : 'Không gửi HYPE native (msg.value = 0)')
      const permitDetail =
        opts.permitDetail ??
        (need > 0n
          ? `Nếu hạn mức chưa đủ, KNTQ sẽ được approve cho hợp đồng này, rồi nó cấp quyền cho PositionManager. Hạn mức ${formatUnits(buffered, 18)} KNTQ (số lần này + 0,1%), khoảng 1 giờ, không phải vô hạn.`
          : 'Lần này không cần cấp quyền Permit2.')
      const kntqDetail =
        opts.kntqDetail ??
        (need > 0n
          ? `Dùng tối đa ${formatUnits(need, 18)} KNTQ`
          : 'Lần này không chuyển KNTQ ra khỏi ví.')
      openPreview({
        title: opts.title,
        summary: opts.summary,
        to: POSITION_MANAGER,
        data,
        value: opts.value,
        approvals,
        contracts: contractLines({ hypeDetail, permitDetail, kntqDetail }),
        stepIndex: 0,
      })
    },
    [ensureKntqPermit2, openPreview],
  )

  /** Confirm and send ONLY the current step (one approval OR the main tx). */
  const confirmAndSend = useCallback(async () => {
    if (!preview || !walletClient || !address) {
      setError('Hãy kết nối ví trước')
      return
    }
    setError(null)

    const gate = await crossCheckPoolPrice()
    if (!gate.agreed) {
      setError(gate.blockReason ?? 'Giá các RPC không khớp, đã hủy')
      return
    }

    const approvals = preview.approvals ?? []
    const isApproval = preview.stepIndex < approvals.length
    const step = isApproval
      ? approvals[preview.stepIndex]
      : {
          label: preview.title,
          to: preview.to,
          data: preview.data,
          value: preview.value,
        }

    setSimulating(true)
    try {
      await publicClient.call({
        account: address,
        to: step.to,
        data: step.data,
        value: step.value ?? 0n,
      })
      setSimulating(false)
      setSending(true)
      // Exactly one send for this step — never auto-resubmit
      const hash = await walletClient.sendTransaction({
        account: address,
        to: step.to,
        data: step.data,
        value: step.value ?? 0n,
        chain: walletClient.chain,
      })
      await publicClient.waitForTransactionReceipt({ hash })

      if (isApproval) {
        // Advance to next step; require a fresh in-app confirm (no chaining wallet popups)
        setPreview({
          ...preview,
          stepIndex: preview.stepIndex + 1,
        })
        setLastTx(hash)
      } else {
        setLastTx(hash)
        setPreview(null)
      }
    } catch (e) {
      setError(toChineseError(e))
    } finally {
      setSimulating(false)
      setSending(false)
    }
  }, [preview, walletClient, address, setError])

  return {
    preview,
    openPreview,
    closePreview,
    buildModifyTx,
    confirmAndSend,
    simulating,
    sending,
    error,
    lastTx,
  }
}

function useStateError() {
  const [error, setError] = useState<string | null>(null)
  return { error, setError }
}
