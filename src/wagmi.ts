import { http, createConfig, fallback } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { elysium } from './config/chain'
import { RPC_URLS } from './config/rpc'

export const wagmiConfig = createConfig({
  chains: [elysium],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [elysium.id]: fallback(RPC_URLS.map((u) => http(u, { timeout: 12_000, retryCount: 0 }))),
  },
  batch: { multicall: false },
  multiInjectedProviderDiscovery: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
