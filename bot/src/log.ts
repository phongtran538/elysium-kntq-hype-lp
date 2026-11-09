import fs from 'node:fs'
import path from 'node:path'

const logFile = path.resolve(process.cwd(), 'logs', 'bot.log')
const ring: string[] = []
const listeners = new Set<(line: string) => void>()

export function redactSecrets(message: string): string {
  let out = message
  const key = process.env.PRIVATE_KEY?.trim()
  if (key && key.length >= 16) {
    if (out.includes(key)) out = out.split(key).join('***')
    const bare = key.replace(/^0x/i, '')
    if (bare.length >= 16 && out.toLowerCase().includes(bare.toLowerCase())) {
      out = out.replace(new RegExp(bare, 'ig'), '***')
    }
  }
  return out
}

export function recentLogs(): string[] {
  return ring.slice()
}

export function subscribeLogs(fn: (line: string) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${redactSecrets(message)}`
  ring.push(line)
  if (ring.length > 200) ring.shift()
  for (const fn of listeners) fn(line)
  console.log(line)
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.appendFileSync(logFile, line + '\n')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`Không ghi được file log: ${msg}`)
  }
}

export function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/\s+/g, ' ').slice(0, 500)
}
