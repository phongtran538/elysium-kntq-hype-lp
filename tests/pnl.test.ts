import { describe, expect, it } from 'vitest'
import { computePnl, valueInHype, valueInKntq } from '../src/lib/pnl'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  markPositionClosed,
  notePendingMint,
  observePositions,
  readBook,
  recordCollected,
  recordGas,
  resetBaseline,
  setPnlFileForTests,
  walletPnl,
} from '../bot/src/pnlStore'

describe('P&L math', () => {
  const openedAt = 1_700_000_000_000

  it('values a mix of HYPE and KNTQ at the pool price', () => {
    expect(valueInHype(2, 200, 100)).toBeCloseTo(4)
    expect(valueInKntq(2, 200, 100)).toBeCloseTo(400)
  })

  it('net is fees minus gas when the price does not move', () => {
    const pnl = computePnl({
      price: 100,
      deposit0: 10,
      deposit1: 1000,
      position0: 10,
      position1: 1000,
      uncollected0: 0.2,
      uncollected1: 10,
      collected0: 0.5,
      collected1: 0,
      gas0: 0.1,
      openedAt,
      now: openedAt + 2 * 60 * 60 * 1000,
      hypeUsd: 50,
    })
    expect(pnl).not.toBeNull()
    // deposit = 10 + 1000/100 = 20 HYPE
    // current = 10.2 + 1010/100 = 20.3
    // collected = 0.5
    // net = 20.3 + 0.5 - 20 - 0.1 = 0.7
    expect(pnl!.depositHype).toBeCloseTo(20)
    expect(pnl!.currentHype).toBeCloseTo(20.3)
    expect(pnl!.feesHype).toBeCloseTo(0.8)
    expect(pnl!.netHype).toBeCloseTo(0.7)
    expect(pnl!.netKntq).toBeCloseTo(70)
    expect(pnl!.vsHodlHype).toBeCloseTo(0.8)
    expect(pnl!.ilHype).toBeCloseTo(-0.8)
    expect(pnl!.usd!.net).toBeCloseTo(35)
    expect(pnl!.feeAprPct).toBeGreaterThan(0)
  })

  it('shows a loss versus holding when price moves and no fees were earned', () => {
    const pnl = computePnl({
      price: 200,
      deposit0: 10,
      deposit1: 1000,
      position0: 5,
      position1: 1500,
      uncollected0: 0,
      uncollected1: 0,
      collected0: 0,
      collected1: 0,
      gas0: 0,
      openedAt,
      now: openedAt + 10 * 60 * 60 * 1000,
    })
    expect(pnl).not.toBeNull()
    // HODL = 10 + 1000/200 = 15 HYPE. Position = 5 + 1500/200 = 12.5
    expect(pnl!.depositHype).toBeCloseTo(15)
    expect(pnl!.currentHype).toBeCloseTo(12.5)
    expect(pnl!.vsHodlHype).toBeCloseTo(-2.5)
    expect(pnl!.ilHype).toBeCloseTo(2.5)
    expect(pnl!.netHype).toBeCloseTo(-2.5)
    expect(pnl!.usd).toBeNull()
  })

  it('does not invent an APR in the first hour', () => {
    const pnl = computePnl({
      price: 10,
      deposit0: 1,
      deposit1: 10,
      position0: 1,
      position1: 10,
      uncollected0: 0,
      uncollected1: 0,
      collected0: 1,
      collected1: 0,
      gas0: 0,
      openedAt,
      now: openedAt + 10 * 60 * 1000,
    })
    expect(pnl!.feeAprPct).toBeNull()
  })
})

describe('P&L ledger', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnl-'))
  const file = path.join(dir, 'pnl.json')
  const wallet = '0xabc'
  setPnlFileForTests(file)

  it('keeps the first deposit, then uses the bot mint amounts for the next position', () => {
    observePositions({
      wallet,
      price: 100,
      hypeUsd: null,
      positions: [{ tokenId: '1', amount0: 10n * 10n ** 18n, amount1: 1000n * 10n ** 18n, fees0: 0n, fees1: 0n }],
      now: 1_000,
    })
    observePositions({
      wallet,
      price: 100,
      hypeUsd: null,
      positions: [{ tokenId: '1', amount0: 9n * 10n ** 18n, amount1: 1100n * 10n ** 18n, fees0: 1n * 10n ** 18n, fees1: 0n }],
      now: 2_000,
    })
    const first = readBook(wallet)!.positions[0]!
    expect(first.deposit0).toBe((10n * 10n ** 18n).toString())
    expect(first.estimated).toBe(true)
    recordCollected(wallet, '1', 2n * 10n ** 18n, 0n)
    recordGas(wallet, '1', 10n ** 17n)
    markPositionClosed(wallet, '1')
    notePendingMint(wallet, 8n * 10n ** 18n, 800n * 10n ** 18n, 100)
    observePositions({
      wallet,
      price: 100,
      hypeUsd: 40,
      positions: [{ tokenId: '2', amount0: 8n * 10n ** 18n, amount1: 800n * 10n ** 18n, fees0: 0n, fees1: 0n }],
      now: 3_000,
    })
    const book = readBook(wallet)!
    const minted = book.positions.find((p) => p.tokenId === '2')!
    expect(minted.source).toBe('bot-mint')
    expect(minted.estimated).toBe(false)
    expect(minted.deposit0).toBe((8n * 10n ** 18n).toString())
    const view = walletPnl({
      wallet,
      price: 100,
      hypeUsd: 40,
      positions: [{ tokenId: '2', amount0: 8n * 10n ** 18n, amount1: 800n * 10n ** 18n, fees0: 0n, fees1: 0n }],
      now: 5_000,
    })
    expect(view!.positions).toHaveLength(2)
    expect(JSON.stringify(view)).not.toContain('PRIVATE')
    resetBaseline({
      wallet,
      price: 100,
      hypeUsd: null,
      positions: [{ tokenId: '2', amount0: 8n * 10n ** 18n, amount1: 800n * 10n ** 18n, fees0: 0n, fees1: 0n }],
    })
    const after = walletPnl({
      wallet,
      price: 100,
      hypeUsd: null,
      positions: [{ tokenId: '2', amount0: 8n * 10n ** 18n, amount1: 800n * 10n ** 18n, fees0: 0n, fees1: 0n }],
    })
    expect(after!.positions).toHaveLength(1)
    expect(after!.totals!.netHype).toBeCloseTo(0, 6)
  })
})
