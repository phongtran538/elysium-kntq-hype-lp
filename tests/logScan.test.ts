import { describe, expect, it } from 'vitest'
import {
  DEFAULT_START_BLOCK,
  KNOWN_MINT_BLOCK,
  applyTransfers,
  emptyIndex,
  nextPaceMs,
  planLogChunks,
  scanFromBlock,
  seedKnownToken,
} from '../src/lib/logScan'

describe('incremental Transfer scan', () => {
  it('starts at START_BLOCK or the known mint, never at genesis', () => {
    const fresh = emptyIndex('0xAbC')
    expect(scanFromBlock(fresh, DEFAULT_START_BLOCK, [KNOWN_MINT_BLOCK])).toBe(3_300_000n)
    expect(scanFromBlock(fresh, 4_000_000n, [KNOWN_MINT_BLOCK])).toBe(KNOWN_MINT_BLOCK)
    const seeded = seedKnownToken(fresh)
    expect(seeded.tokenIds).toEqual(['1844'])
    expect(seeded.mintBlock['1844']).toBe('3328536')
    expect(scanFromBlock(seeded, DEFAULT_START_BLOCK)).toBe(3_300_000n)
    expect(seedKnownToken(seeded)).toBe(seeded)
  })

  it('continues after the last scanned block and chunks about 1800 blocks', () => {
    const index = { ...emptyIndex('0xabc'), lastScannedBlock: '3328536' }
    expect(scanFromBlock(index, 0n, [KNOWN_MINT_BLOCK])).toBe(3_328_537n)
    expect(planLogChunks(100n, 3_700n)).toEqual([
      { from: 100n, to: 1_899n },
      { from: 1_900n, to: 3_699n },
      { from: 3_700n, to: 3_700n },
    ])
    expect(planLogChunks(10n, 9n)).toEqual([])
  })

  it('adds mints, drops transfers out, and slows the pace after a 429', () => {
    let index = seedKnownToken(emptyIndex('0xabc'))
    index = applyTransfers(
      index,
      [
        { tokenId: '1844', toOwner: false },
        { tokenId: '1900', toOwner: true, blockNumber: 4_000n, mint: true },
      ],
      4_000n,
    )
    expect(index.tokenIds).toEqual(['1900'])
    expect(index.lastScannedBlock).toBe('4000')
    expect(index.mintBlock['1900']).toBe('4000')
    expect(nextPaceMs(300, true)).toBe(600)
    expect(nextPaceMs(1_000, false)).toBe(800)
    expect(nextPaceMs(300, false)).toBe(300)
  })
})
