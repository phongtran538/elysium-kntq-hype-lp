import fs from 'node:fs'
import path from 'node:path'

const logFile = path.resolve(process.cwd(), 'logs', 'bot.log')

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
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
