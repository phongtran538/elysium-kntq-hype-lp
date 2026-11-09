import fs from 'node:fs'

const tokenPath = 'bot/.auth-token'
const token = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8').trim() : ''
const cmd = process.argv[2] ?? 'ping'
const headers = {
  Origin: 'http://127.0.0.1:5173',
  'X-Bot-Token': token,
  'Content-Type': 'application/json',
}

if (cmd === 'shutdown') {
  await fetch('http://127.0.0.1:8787/api/shutdown', { method: 'POST', headers, body: '{}' }).catch(() => {})
  process.exit(0)
}

try {
  const res = await fetch('http://127.0.0.1:8787/api/status', { headers })
  process.exit(res.ok ? 0 : 1)
} catch {
  process.exit(1)
}
