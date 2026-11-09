/** Public Elysium RPCs. Official Kinetiq endpoint first, then the others. */
export const OFFICIAL_RPC = 'https://rpc.elysium.kinetiq.xyz'

export const RPC_URLS = [
  OFFICIAL_RPC,
  'https://rpc-live.boxa.club',
  'https://rpc.boxa.club',
  'https://rpc.eleos.fun',
  'https://rpc.stockium.fun',
  'https://rpc.elysiumswap.finance',
] as const

export type RpcUrl = (typeof RPC_URLS)[number]
