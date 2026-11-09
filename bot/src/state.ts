import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve(process.cwd(), 'bot', 'state.json')

export type BotState = {
  lastRebalanceAt: number | null
  /** Token id we started closing. Cleared after the new mint lands. */
  pendingTokenId: string | null
}

export function readState(): BotState {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as Partial<BotState>
    return {
      lastRebalanceAt: typeof parsed.lastRebalanceAt === 'number' ? parsed.lastRebalanceAt : null,
      pendingTokenId: typeof parsed.pendingTokenId === 'string' ? parsed.pendingTokenId : null,
    }
  } catch {
    return { lastRebalanceAt: null, pendingTokenId: null }
  }
}

export function writeState(state: BotState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, file)
}
