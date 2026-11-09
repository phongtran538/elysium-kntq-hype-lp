import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { BIND_HOST, checkRequestAuth, isAllowedOrigin } from './auth'

export type BotHttpDeps = {
  token: string
  getStatus: () => unknown
  start: () => Promise<{ ok: boolean; status: number; message: string }>
  stop: () => { ok: boolean; message: string }
  shutdown: () => void
  updateConfig: (body: unknown) => { ok: boolean; status: number; message: string }
  openEnv: () => { ok: boolean; message: string }
  reloadKey: () => { ok: boolean; message: string }
  pnlSeen: (body: unknown) =>
    | { ok: boolean; status: number; message: string; pnl?: unknown }
    | Promise<{ ok: boolean; status: number; message: string; pnl?: unknown }>
  pnlReset: (body: unknown) => { ok: boolean; status: number; message: string }
  recentLogs: () => string[]
  subscribeLogs: (fn: (line: string) => void) => () => void
}

function header(req: http.IncomingMessage, name: string): string | null {
  const value = req.headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = header(req, 'origin')
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bot-Token')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(json)
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > 65_536) throw new Error('Nội dung quá dài')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function createBotServer(deps: BotHttpDeps): http.Server & { pushStatus: () => void } {
  const streams = new Set<http.ServerResponse>()

  function pushStatus(): void {
    const payload = `event: status\ndata: ${JSON.stringify(deps.getStatus())}\n\n`
    for (const res of streams) res.write(payload)
  }

  const server = http.createServer(async (req, res) => {
    applyCors(req, res)
    const method = (req.method ?? 'GET').toUpperCase()
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const origin = header(req, 'origin')
    const token = header(req, 'x-bot-token')
    const auth = checkRequestAuth({
      method,
      origin,
      token,
      expectedToken: deps.token,
    })
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, message: auth.reason })
      return
    }
    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    try {
      if (method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, deps.getStatus())
        return
      }
      if (method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
        res.write(`event: status\ndata: ${JSON.stringify(deps.getStatus())}\n\n`)
        for (const line of deps.recentLogs().slice(-80)) {
          res.write(`event: log\ndata: ${JSON.stringify({ line })}\n\n`)
        }
        const unsub = deps.subscribeLogs((line) => {
          res.write(`event: log\ndata: ${JSON.stringify({ line })}\n\n`)
        })
        streams.add(res)
        req.on('close', () => {
          unsub()
          streams.delete(res)
        })
        return
      }
      if (method === 'POST' && url.pathname === '/api/start') {
        const result = await deps.start()
        sendJson(res, result.status, result)
        pushStatus()
        return
      }
      if (method === 'POST' && url.pathname === '/api/stop') {
        const result = deps.stop()
        sendJson(res, 200, result)
        pushStatus()
        return
      }
      if (method === 'POST' && url.pathname === '/api/config') {
        const body = await readJson(req)
        const result = deps.updateConfig(body)
        sendJson(res, result.status, result)
        pushStatus()
        return
      }
      if (method === 'POST' && url.pathname === '/api/open-env') {
        sendJson(res, 200, deps.openEnv())
        return
      }
      if (method === 'POST' && url.pathname === '/api/reload-key') {
        const result = deps.reloadKey()
        sendJson(res, result.ok ? 200 : 400, result)
        pushStatus()
        return
      }
      if (method === 'POST' && url.pathname === '/api/pnl/seen') {
        const result = await deps.pnlSeen(await readJson(req))
        sendJson(res, result.status, result)
        pushStatus()
        return
      }
      if (method === 'POST' && url.pathname === '/api/pnl/reset') {
        const result = deps.pnlReset(await readJson(req))
        sendJson(res, result.status, result)
        pushStatus()
        return
      }
      if (method === 'POST' && url.pathname === '/api/shutdown') {
        sendJson(res, 200, { ok: true, message: 'Đang tắt' })
        setTimeout(() => deps.shutdown(), 50)
        return
      }
      sendJson(res, 404, { ok: false, message: 'Không có đường dẫn này' })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Lỗi'
      sendJson(res, 400, { ok: false, message: message.slice(0, 200) })
    }
  })

  return Object.assign(server, { pushStatus })
}

export function listenOnLoopback(server: http.Server, port: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, BIND_HOST, () => {
      server.removeListener('error', reject)
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Không lấy được địa chỉ lắng nghe'))
        return
      }
      resolve(addr)
    })
  })
}
