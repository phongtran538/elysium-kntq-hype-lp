import fs from 'node:fs'
import path from 'node:path'
import { emptyIndex, type ScanIndex } from '../../src/lib/logScan'

const defaultFile = path.resolve(process.cwd(), 'bot', 'data', 'scan-index.json')

type FileShape = { byWallet: Record<string, ScanIndex> }

function readFile(file: string): FileShape {
  if (!fs.existsSync(file)) return { byWallet: {} }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as FileShape
    if (!parsed || typeof parsed !== 'object' || !parsed.byWallet) return { byWallet: {} }
    return parsed
  } catch {
    return { byWallet: {} }
  }
}

export function loadScanIndex(wallet: string, file = defaultFile): ScanIndex {
  const key = wallet.toLowerCase()
  const row = readFile(file).byWallet[key]
  if (!row || row.wallet?.toLowerCase() !== key) return emptyIndex(key)
  return {
    wallet: key,
    lastScannedBlock: row.lastScannedBlock ?? null,
    tokenIds: Array.isArray(row.tokenIds) ? row.tokenIds.map(String) : [],
    mintBlock: row.mintBlock && typeof row.mintBlock === 'object' ? row.mintBlock : {},
    dropped: Array.isArray(row.dropped) ? row.dropped.map(String) : [],
  }
}

export function saveScanIndex(index: ScanIndex, file = defaultFile): void {
  const all = readFile(file)
  all.byWallet[index.wallet.toLowerCase()] = index
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(all))
  fs.renameSync(tmp, file)
}
