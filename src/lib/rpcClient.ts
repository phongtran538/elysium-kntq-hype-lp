import { type PublicClient } from 'viem'
import { RPC_URLS, type RpcUrl } from '../config/rpc'
import { isRateLimitMessage } from './rpcHealth'
import { createResilientClient } from './resilientRpc'

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
  const brief = !reason ? '' : isRateLimitMessage(reason) ? '429' : reason.replace(/\s+/g, ' ').slice(0, 80)
  console.warn(`[rpc] đổi RPC${brief ? ` vì ${brief}` : ''} → ${RPC_URLS[activeIndex]}`)
  notify()
  return RPC_URLS[activeIndex]!
}

export const publicClient: PublicClient = createResilientClient(RPC_URLS, {
  onUsed(url) {
    const index = RPC_URLS.indexOf(url as RpcUrl)
    if (index >= 0 && index !== activeIndex) {
      activeIndex = index
      notify()
    }
  },
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
