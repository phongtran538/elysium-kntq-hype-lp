import fs from 'node:fs'
import path from 'node:path'

export type HistoryItem = {
  at: number
  kind: 'dry-run' | 'live' | 'info'
  summary: string
}

const file = path.resolve(process.cwd(), 'bot', 'history.json')
let items: HistoryItem[] = []

export function loadHistory(): HistoryItem[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as HistoryItem[]
    if (Array.isArray(parsed)) items = parsed.slice(-50)
  } catch {
    items = []
  }
  return items.slice()
}

export function getHistory(): HistoryItem[] {
  return items.slice().reverse()
}

export function addHistory(item: HistoryItem): void {
  items.push(item)
  if (items.length > 50) items = items.slice(-50)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(items, null, 2))
  } catch {
    // history is optional
  }
}
