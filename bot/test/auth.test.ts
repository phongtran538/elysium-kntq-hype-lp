import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { BIND_HOST, checkRequestAuth, isAllowedOrigin, tokensMatch } from '../src/auth'
import { createBotServer, listenOnLoopback } from '../src/http'
import { writeEnvValues, validateConfigPatch } from '../src/envfile'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TOKEN = 'a'.repeat(48)
const SECRET_KEY = `0x${'ab'.repeat(32)}`

describe('origin and token', () => {
  it('only allows localhost origins', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedOrigin('http://[::1]:5173')).toBe(true)
    expect(isAllowedOrigin('https://evil.com')).toBe(false)
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false)
    expect(isAllowedOrigin('http://user:pass@127.0.0.1:5173')).toBe(false)
    expect(isAllowedOrigin('null')).toBe(false)
    expect(isAllowedOrigin(null)).toBe(false)
    expect(isAllowedOrigin('')).toBe(false)
  })

  it('rejects a missing, wrong, or short token', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true)
    expect(tokensMatch('b'.repeat(48), TOKEN)).toBe(false)
    expect(tokensMatch(null, TOKEN)).toBe(false)
    expect(tokensMatch(TOKEN, 'short')).toBe(false)
    expect(
      checkRequestAuth({ method: 'POST', origin: 'http://127.0.0.1:5173', token: 'nope', expectedToken: TOKEN }),
    ).toMatchObject({ ok: false, status: 401 })
    expect(
      checkRequestAuth({ method: 'GET', origin: null, token: TOKEN, expectedToken: TOKEN }),
    ).toMatchObject({ ok: false, status: 403 })
    expect(
      checkRequestAuth({ method: 'POST', origin: 'https://evil.com', token: TOKEN, expectedToken: TOKEN }),
    ).toMatchObject({ ok: false, status: 403 })
    expect(
      checkRequestAuth({ method: 'POST', origin: 'http://127.0.0.1:5173', token: TOKEN, expectedToken: TOKEN }).ok,
    ).toBe(true)
  })

  it('refuses to turn live mode on without an explicit confirm, and never writes the key', () => {
    expect(validateConfigPatch({ dryRun: false })).toMatchObject({ ok: false })
    expect(validateConfigPatch({ dryRun: false, confirmLive: true, rangePct: 20 }).ok).toBe(true)
    expect(validateConfigPatch({ PRIVATE_KEY: SECRET_KEY }).ok).toBe(false)

    const file = path.join(os.tmpdir(), `kntq-env-${Date.now()}.env`)
    fs.writeFileSync(file, `PRIVATE_KEY=${SECRET_KEY}\nDRY_RUN=true\n# giữ comment\n`)
    writeEnvValues(file, { DRY_RUN: 'false', RANGE_PCT: '15' })
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain(`PRIVATE_KEY=${SECRET_KEY}`)
    expect(text).toContain('DRY_RUN=false')
    expect(text).toContain('RANGE_PCT=15')
    expect(text).toContain('# giữ comment')
    fs.unlinkSync(file)
  })
})

describe('local bot http server', () => {
  const servers: { close: () => Promise<void> }[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()))
  })

  async function boot() {
    let started = false
    const server = createBotServer({
      token: TOKEN,
      getStatus: () => ({ ok: true, wallet: '0xabc', note: 'no-key' }),
      start: async () => {
        started = true
        return { ok: true, status: 200, message: 'Đã bật' }
      },
      stop: () => ({ ok: true, message: 'Đang dừng' }),
      shutdown: () => {},
      updateConfig: () => ({ ok: true, status: 200, message: 'Đã lưu' }),
      openEnv: () => ({ ok: true, message: 'mở file' }),
      reloadKey: () => ({ ok: true, message: 'đã đọc' }),
      recentLogs: () => [],
      subscribeLogs: () => () => {},
    })
    const addr = await listenOnLoopback(server, 0)
    servers.push({
      close: () =>
        new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    })
    return { addr, started: () => started }
  }

  it('binds only to 127.0.0.1', async () => {
    const { addr } = await boot()
    expect(addr.address).toBe(BIND_HOST)
    expect(addr.address).not.toBe('0.0.0.0')
    expect(createServer().address()).toBeNull()
  })

  it('blocks other sites and a missing token, and does not echo the token', async () => {
    const { addr } = await boot()
    const url = `http://127.0.0.1:${addr.port}/api/status`
    const denied = await fetch(url, { headers: { Origin: 'https://evil.com', 'X-Bot-Token': TOKEN } })
    expect(denied.status).toBe(403)
    const noToken = await fetch(url, { headers: { Origin: 'http://127.0.0.1:5173' } })
    expect(noToken.status).toBe(401)
    const ok = await fetch(url, {
      headers: { Origin: 'http://127.0.0.1:5173', 'X-Bot-Token': TOKEN },
    })
    expect(ok.status).toBe(200)
    const text = await ok.text()
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(SECRET_KEY)
    expect(text).toContain('0xabc')

    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' },
    })
    expect(preflight.status).toBe(403)
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('accepts a localhost POST with the token', async () => {
    const { addr, started } = await boot()
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/start`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Bot-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect(started()).toBe(true)
  })
})
