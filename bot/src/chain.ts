import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { erc20Abi } from '../../src/abis/erc20'
import { permit2Abi } from '../../src/abis/permit2'
import { elysium } from '../../src/config/chain'
import {
  CHAIN_ID,
  KNTQ,
  PERMIT2,
  POOL_KEY,
  QUOTER,
  explorerTx,
} from '../../src/config/contracts'
import { formatUnits, parseUnits } from '../../src/lib/math'
import type { BotConfig } from './env'
import { log, safeError } from './log'
import { withBackoff } from './retry'

const UINT160 = 2n ** 160n - 1n
const PERMIT_SECONDS = 3600

export const quoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export function accountFrom(privateKey: `0x${string}`): PrivateKeyAccount {
  return privateKeyToAccount(privateKey)
}

export function makeClients(url: string, account: PrivateKeyAccount): {
  publicClient: PublicClient
  walletClient: WalletClient
} {
  const transport = http(url, { timeout: 20_000, retryCount: 0 })
  return {
    publicClient: createPublicClient({
      chain: elysium,
      transport,
      batch: { multicall: false },
    }),
    walletClient: createWalletClient({ account, chain: elysium, transport }),
  }
}

export async function assertChain(client: PublicClient): Promise<void> {
  const id = await client.getChainId()
  if (id !== CHAIN_ID) {
    throw new Error(`RPC trả chain id ${id}, bot chỉ chạy trên Elysium ${CHAIN_ID}.`)
  }
}

export async function quoteExactIn(
  client: PublicClient,
  zeroForOne: boolean,
  amountIn: bigint,
): Promise<bigint> {
  const quoted = await client.readContract({
    address: QUOTER,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        poolKey: {
          currency0: POOL_KEY.currency0,
          currency1: POOL_KEY.currency1,
          fee: POOL_KEY.fee,
          tickSpacing: POOL_KEY.tickSpacing,
          hooks: POOL_KEY.hooks,
        },
        zeroForOne,
        exactAmount: amountIn,
        hookData: '0x',
      },
    ],
  })
  return quoted[0]
}

export async function hypeBalance(client: PublicClient, address: Address): Promise<bigint> {
  return client.getBalance({ address })
}

export async function kntqBalance(client: PublicClient, address: Address): Promise<bigint> {
  return client.readContract({
    address: KNTQ,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
}

/** Keep the larger of the configured HYPE reserve and 4 max-gas transactions. */
export async function reserveWei(client: PublicClient, cfg: BotConfig): Promise<bigint> {
  const configured = parseUnits(cfg.gasReserveHype, 18)
  const gasPrice = await client.getGasPrice()
  const fromGas = gasPrice * cfg.maxGas * 4n
  return configured > fromGas ? configured : fromGas
}

export async function sendChecked(opts: {
  publicClient: PublicClient
  walletClient: WalletClient
  account: PrivateKeyAccount
  to: Address
  data: Hex
  value: bigint
  maxGas: bigint
  dryRun: boolean
  label: string
}): Promise<Hex | null> {
  const { publicClient, account, to, data, value } = opts
  let gas: bigint | null = null
  try {
    gas = await withBackoff(`${opts.label} ước lượng gas`, () =>
      publicClient.estimateGas({
        account: account.address,
        to,
        data,
        value,
      }),
    )
  } catch (e) {
    if (opts.dryRun) {
      log(`${opts.label}: DRY_RUN, mô phỏng không chạy (${safeError(e)}). Không gửi.`)
      return null
    }
    throw e
  }
  if (gas > opts.maxGas) {
    throw new Error(
      `${opts.label}: gas ước lượng ${gas} vượt MAX_GAS ${opts.maxGas}. Hủy, không gửi.`,
    )
  }
  if (opts.dryRun) {
    log(`${opts.label}: DRY_RUN, gas ước lượng ${gas}. Không gửi.`)
    return null
  }
  const padded = (gas * 12n) / 10n
  const limit = padded > opts.maxGas ? opts.maxGas : padded
  const hash = await opts.walletClient.sendTransaction({
    account,
    chain: elysium,
    to,
    data,
    value,
    gas: limit,
  })
  log(`${opts.label}: đã gửi ${hash} — ${explorerTx(hash)}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 })
  if (receipt.status !== 'success') {
    throw new Error(`${opts.label} bị revert. Xem ${explorerTx(hash)}`)
  }
  log(`${opts.label}: thành công, block ${receipt.blockNumber}.`)
  return hash
}

export async function ensureKntqAllowance(opts: {
  publicClient: PublicClient
  walletClient: WalletClient
  account: PrivateKeyAccount
  spender: Address
  amount: bigint
  maxGas: bigint
  dryRun: boolean
  spenderName: string
}): Promise<void> {
  if (opts.amount <= 0n) return
  const buffered = opts.amount + (opts.amount * 10n) / 10_000n
  const capped = buffered > UINT160 ? UINT160 : buffered
  const allowance = await opts.publicClient.readContract({
    address: KNTQ,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [opts.account.address, PERMIT2],
  })
  if (allowance < capped) {
    log(
      `Cần approve ${formatUnits(capped, 18)} KNTQ cho Permit2 ${PERMIT2} (không phải unlimited).`,
    )
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [PERMIT2, capped],
    })
    await sendChecked({
      publicClient: opts.publicClient,
      walletClient: opts.walletClient,
      account: opts.account,
      to: KNTQ,
      data,
      value: 0n,
      maxGas: opts.maxGas,
      dryRun: opts.dryRun,
      label: 'Approve KNTQ → Permit2',
    })
  } else {
    log('KNTQ đã approve đủ cho Permit2, bỏ qua.')
  }

  const [amt, exp] = await opts.publicClient.readContract({
    address: PERMIT2,
    abi: permit2Abi,
    functionName: 'allowance',
    args: [opts.account.address, KNTQ, opts.spender],
  })
  const now = Math.floor(Date.now() / 1000)
  if (amt < capped || Number(exp) < now + 300) {
    const expiry = now + PERMIT_SECONDS
    log(
      `Permit2 cho ${opts.spenderName} ${opts.spender} hạn mức ${formatUnits(capped, 18)} KNTQ, hết hạn sau khoảng 1 giờ.`,
    )
    const data = encodeFunctionData({
      abi: permit2Abi,
      functionName: 'approve',
      args: [KNTQ, opts.spender, capped, expiry],
    })
    await sendChecked({
      publicClient: opts.publicClient,
      walletClient: opts.walletClient,
      account: opts.account,
      to: PERMIT2,
      data,
      value: 0n,
      maxGas: opts.maxGas,
      dryRun: opts.dryRun,
      label: `Permit2 → ${opts.spenderName}`,
    })
  } else {
    log(`Permit2 đã cho ${opts.spenderName} đủ hạn mức.`)
  }
}
