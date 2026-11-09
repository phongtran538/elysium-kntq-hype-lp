import {
  createPublicClient,
  http,
  fallback,
  type PublicClient,
  type Transport,
} from 'viem'
import { elysium } from '../config/chain'
import { RPC_URLS, type RpcUrl } from '../config/rpc'

let activeIndex = 0
const listeners = new Set<(url: RpcUrl, index: number) => void>()

export function getActiveRpc(): { url: RpcUrl; index: number } {
  return { url: RPC_URLS[activeIndex]!, index: activeIndex }
}

export function subscribeRpc(fn: (url: RpcUrl, index: number) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function notify() {
  const { url, index } = getActiveRpc()
  listeners.forEach((fn) => fn(url, index))
}

export function rotateRpc(reason?: string): RpcUrl {
  activeIndex = (activeIndex + 1) % RPC_URLS.length
  console.warn('[rpc] failover', reason, '→', RPC_URLS[activeIndex])
  notify()
  return RPC_URLS[activeIndex]!
}

function buildTransport(): Transport {
  // Prefer ordered failover; individual http with short timeout
  return fallback(
    RPC_URLS.map((url) =>
      http(url, {
        timeout: 12_000,
        retryCount: 0, // never silent-retry sends; reads may rotate manually
      }),
    ),
    { rank: false },
  )
}

export const publicClient: PublicClient = createPublicClient({
  chain: elysium,
  transport: buildTransport(),
  batch: { multicall: true },
})

/** Read with manual failover on failure */
export async function withRpcFailover<T>(fn: (client: PublicClient) => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < RPC_URLS.length; i++) {
    try {
      return await fn(publicClient)
    } catch (e) {
      lastErr = e
      rotateRpc(String(e))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Tất cả RPC đều không dùng được')
}
