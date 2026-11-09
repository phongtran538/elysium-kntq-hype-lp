import { describe, expect, it } from 'vitest'
import { safeError } from '../src/log'

describe('safeError', () => {
  it('keeps a 429 as one short Vietnamese line', () => {
    const dump =
      'HTTP request failed.\n\nStatus: 429\nURL: https://rpc.elysium.kinetiq.xyz\nRequest body: {"method":"eth_getLogs","params":[{"fromBlock":"0x0"}]}'
    expect(safeError(new Error(dump))).toBe('RPC bị giới hạn (429).')
    expect(safeError(new Error('The request took too long to respond.'))).toBe('RPC hết giờ chờ.')
  })
})