import { loadConfig } from './env'
import { runLoop, runStatus } from './execute'
import { log, safeError } from './log'

const statusMode = process.argv.includes('--status') || process.argv.includes('status')

let stop = false
process.on('SIGINT', () => {
  if (stop) {
    log('Thoát ngay.')
    process.exit(130)
  }
  stop = true
  log('Nhận Ctrl+C. Dừng sau khi xong việc đang làm. Bấm Ctrl+C lần nữa để thoát ngay.')
})
process.on('SIGTERM', () => {
  stop = true
  log('Nhận tín hiệu dừng.')
})

try {
  const cfg = loadConfig()
  if (statusMode) {
    const code = await runStatus(cfg)
    process.exit(code)
  }
  const ok = await runLoop(cfg, () => stop)
  if (!ok) process.exit(1)
} catch (e) {
  log(safeError(e))
  process.exit(1)
}
