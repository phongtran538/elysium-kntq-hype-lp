import { useEffect, useState } from 'react'
import { botFetch, botToken, captureBotToken, type BotStatus } from '../lib/botClient'

/** Poll the local bot server no faster than its own POLL_SECONDS, and never under 60s. */
export function useBotFeed(): { status: BotStatus | null; online: boolean } {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [online, setOnline] = useState(false)

  useEffect(() => {
    captureBotToken()
    if (!botToken()) return
    let stop = false
    let timer = 0
    const pull = async () => {
      try {
        const data = (await botFetch('/api/status')) as BotStatus
        if (stop) return
        setStatus(data)
        setOnline(true)
        const sec = Math.max(60, data.config?.pollSeconds || 60)
        timer = window.setTimeout(() => void pull(), sec * 1000)
      } catch {
        if (stop) return
        setOnline(false)
        timer = window.setTimeout(() => void pull(), 60_000)
      }
    }
    void pull()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [])

  return { status, online }
}
