import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from 'wagmi'
import { CHAIN_ID } from '../config/contracts'
import { RPC_URLS } from '../config/rpc'
import { getActiveRpc, subscribeRpc } from '../lib/rpcClient'
import { useEffect, useState } from 'react'

export function ConnectBar() {
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const [rpc, setRpc] = useState(getActiveRpc().url)

  useEffect(() => {
    const unsub = subscribeRpc((url) => setRpc(url))
    return () => {
      unsub()
    }
  }, [])

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''

  async function ensureElysium() {
    try {
      await switchChainAsync({ chainId: CHAIN_ID })
      return
    } catch {
      // try wallet_addEthereumChain then switch
    }
    if (!walletClient) return
    await walletClient.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: `0x${CHAIN_ID.toString(16)}`,
          chainName: 'Elysium',
          nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
          rpcUrls: [...RPC_URLS],
          blockExplorerUrls: ['https://elyscan.fun'],
        },
      ],
    })
    await switchChainAsync({ chainId: CHAIN_ID })
  }

  return (
    <header className="topbar">
      <div>
        <h1>KNTQ / HYPE LP</h1>
        <p className="muted">Elysium Uniswap V4 · số liệu thật trên chain · không tự nới trượt giá</p>
      </div>
      <div className="topbar-actions">
        <span className="pill" title="RPC đang dùng">
          RPC {rpc.replace('https://', '')}
        </span>
        {!isConnected ? (
          <button
            className="btn primary"
            disabled={isPending || connectors.length === 0}
            onClick={() => connect({ connector: connectors[0]! })}
          >
            Kết nối ví
          </button>
        ) : (
          <>
            {chainId !== CHAIN_ID && (
              <button className="btn warn" onClick={() => void ensureElysium()}>
                Chuyển sang Elysium (99901)
              </button>
            )}
            <span className="pill mono">{short}</span>
            <button className="btn" onClick={() => disconnect()}>
              Ngắt kết nối
            </button>
          </>
        )}
        {error && <span className="err">{error.message}</span>}
      </div>
    </header>
  )
}
