/** Verified Elysium Uniswap V4 deployments (2026-11-09) */
export const CHAIN_ID = 99901

export const KNTQ = '0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0' as const
export const WHYPE = '0xba876237b0f021a6c6d852d6c26e107997cc5e81' as const
/** Native HYPE is currency0 (address(0)) in this pool's PoolKey */
export const NATIVE = '0x0000000000000000000000000000000000000000' as const

export const POOL_ID =
  '0xc96bfd21d36f8e7252f0d80fcb5f3bcacdf47c8b927b20711104713ebeb383ac' as const

export const POOL_MANAGER = '0xe2e105d3f7209a9da11f83ccf3e7398a753823f1' as const
export const POSITION_MANAGER = '0x1d1c51b9d07fd27d36412a2b66cc23d19eb3e518' as const
export const STATE_VIEW = '0x27ed73ae0652fdcf71d6793412a7525f32be9dfe' as const
export const QUOTER = '0x379f556c5a748bd7cc9baf0f7a344094ac1814f5' as const
export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3' as const
/** Universal Router v2.1.2 — the V4 swap entrypoint on this deployment */
export const UNIVERSAL_ROUTER = '0xa13f7611115752deb2b13813bdde16a5073e4b45' as const

export const EXPLORER_URL = 'https://elyscan.fun' as const

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
}

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

/** On-chain PoolKey for KNTQ/HYPE (confirmed via POSM.poolKeys) */
export const POOL_KEY = {
  currency0: NATIVE,
  currency1: KNTQ,
  fee: 10_000, // 1%
  tickSpacing: 200,
  hooks: NATIVE,
} as const

export const FULL_RANGE = {
  tickLower: -887_200,
  tickUpper: 887_200,
} as const

export const TOKEN_META = {
  HYPE: { symbol: 'HYPE', decimals: 18, address: NATIVE },
  KNTQ: { symbol: 'KNTQ', decimals: 18, address: KNTQ, name: 'Kinetiq Governance Token' },
  WHYPE: { symbol: 'WHYPE', decimals: 18, address: WHYPE },
} as const

export const STALE_MS = 20_000
export const DEFAULT_SLIPPAGE_PCT = 0.5
export const DEFAULT_DEADLINE_MIN = 20
