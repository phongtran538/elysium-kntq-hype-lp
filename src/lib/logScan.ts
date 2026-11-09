/**
 * Plan an incremental ERC-721 Transfer scan. The bot persists the result;
 * this module only decides the next block range and how the token set changes.
 */

export const DEFAULT_START_BLOCK = 3_300_000n
/** Owner's known position. Minted here, so a first scan must not start at block 0. */
export const KNOWN_TOKEN_ID = '1844'
export const KNOWN_MINT_BLOCK = 3_328_536n
export const LOG_CHUNK = 1_800n
export const LOG_PACE_MS = 300

export type ScanIndex = {
  wallet: string
  lastScannedBlock: string | null
  tokenIds: string[]
  mintBlock: Record<string, string>
  /** Token ids we already checked and this wallet does not own. */
  dropped: string[]
}

export type TransferHit = {
  tokenId: string
  toOwner: boolean
  blockNumber?: bigint
  mint?: boolean
}

export function emptyIndex(wallet: string): ScanIndex {
  return {
    wallet: wallet.toLowerCase(),
    lastScannedBlock: null,
    tokenIds: [],
    mintBlock: {},
    dropped: [],
  }
}

/**
 * First run starts at the earlier of START_BLOCK and the known mint blocks
 * (never 0). Later runs start at the last scanned block + 1.
 */
export function scanFromBlock(
  index: ScanIndex,
  startBlock: bigint,
  knownMints: readonly bigint[] = [],
): bigint {
  if (index.lastScannedBlock != null && index.lastScannedBlock !== '') {
    return BigInt(index.lastScannedBlock) + 1n
  }
  let from = startBlock
  const candidates = [...knownMints, ...Object.values(index.mintBlock).map((value) => BigInt(value))]
  for (const block of candidates) {
    if (block < from) from = block
  }
  return from < 0n ? 0n : from
}

export function planLogChunks(
  from: bigint,
  to: bigint,
  size = LOG_CHUNK,
): { from: bigint; to: bigint }[] {
  if (to < from || size <= 0n) return []
  const out: { from: bigint; to: bigint }[] = []
  let cursor = from
  while (cursor <= to) {
    const end = cursor + size - 1n
    const toBlock = end > to ? to : end
    out.push({ from: cursor, to: toBlock })
    cursor = toBlock + 1n
  }
  return out
}

export function seedKnownToken(index: ScanIndex, tokenId = KNOWN_TOKEN_ID): ScanIndex {
  if (index.tokenIds.includes(tokenId) || index.dropped.includes(tokenId)) return index
  return {
    ...index,
    tokenIds: [...index.tokenIds, tokenId].sort(byId),
    mintBlock:
      index.mintBlock[tokenId] != null
        ? index.mintBlock
        : { ...index.mintBlock, [tokenId]: KNOWN_MINT_BLOCK.toString() },
  }
}

export function applyTransfers(index: ScanIndex, hits: readonly TransferHit[], scannedTo: bigint): ScanIndex {
  const ids = new Set(index.tokenIds)
  const dropped = new Set(index.dropped)
  const mintBlock = { ...index.mintBlock }
  for (const hit of hits) {
    if (!hit.tokenId) continue
    if (hit.toOwner) {
      ids.add(hit.tokenId)
      dropped.delete(hit.tokenId)
      if (hit.blockNumber != null && (hit.mint || mintBlock[hit.tokenId] == null)) {
        mintBlock[hit.tokenId] = hit.blockNumber.toString()
      }
    } else {
      ids.delete(hit.tokenId)
    }
  }
  return {
    ...index,
    tokenIds: [...ids].sort(byId),
    mintBlock,
    dropped: [...dropped],
    lastScannedBlock: scannedTo.toString(),
  }
}

export function dropToken(index: ScanIndex, tokenId: string): ScanIndex {
  if (!index.tokenIds.includes(tokenId) && index.dropped.includes(tokenId)) return index
  return {
    ...index,
    tokenIds: index.tokenIds.filter((id) => id !== tokenId),
    dropped: index.dropped.includes(tokenId) ? index.dropped : [...index.dropped, tokenId],
  }
}

/** Slow down after a 429, ease back toward one request per 300ms after a clean chunk. */
export function nextPaceMs(current: number, slowed: boolean): number {
  if (slowed) return Math.min(30_000, Math.max(LOG_PACE_MS, current) * 2)
  return Math.max(LOG_PACE_MS, Math.floor(current * 0.8))
}

function byId(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
}
