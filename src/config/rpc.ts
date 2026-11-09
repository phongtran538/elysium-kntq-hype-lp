/**
 * Public Elysium RPCs. Fail over in this order. The shared Conduit endpoint
 * (`rpc.elysium.kinetiq.xyz`) answers, but it is not first: log scans hit its 429.
 */
export const OFFICIAL_RPC = 'https://rpc.elysium.kinetiq.xyz'

export const RPC_URLS = [
  'https://rpc-live.boxa.club',
  'https://rpc.eleos.fun',
  OFFICIAL_RPC,
  'https://rpc.stockium.fun',
  'https://rpc.boxa.club',
  'https://rpc.elysiumswap.finance',
] as const

export type RpcUrl = (typeof RPC_URLS)[number]
