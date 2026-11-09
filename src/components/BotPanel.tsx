import { useEffect, useRef, useState } from 'react'
import {
  botFetch,
  botToken,
  captureBotToken,
  openBotEvents,
  type BotStatus,
} from '../lib/botClient'
import { PnlCards, PnlChart } from './PnlCards'

function host(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

function clock(ms: number | null): string {
  if (!ms) return 'chưa có'
  return new Date(ms).toLocaleString('vi-VN')
}

function priceText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '?'
  if (n >= 100) return n.toFixed(2)
  return n.toPrecision(6)
}

function RangeBar({
  lower,
  upper,
  price,
  triggerPct,
}: {
  lower: number
  upper: number
  price: number
  triggerPct: number
}) {
  const span = upper - lower
  if (!(span > 0) || !(price > 0)) return null
  const t = triggerPct / 100
  const nearLow = lower / (1 - t)
  const nearHigh = upper / (1 + t)
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - lower) / span) * 100))
  const mark = pct(price)
  const outside = price < lower || price >= upper
  return (
    <div className="range-wrap">
      <div className="range-bar" aria-hidden="true">
        <div className="range-zone" style={{ left: 0, width: `${Math.max(0, pct(nearLow))}%` }} />
        <div
          className="range-zone"
          style={{ left: `${pct(nearHigh)}%`, width: `${Math.max(0, 100 - pct(nearHigh))}%` }}
        />
        <div className={`range-mark${outside ? ' out' : ''}`} style={{ left: `${mark}%` }} />
      </div>
      <div className="range-legend">
        <span>Mép dưới {priceText(lower)}</span>
        <span>Vùng kích hoạt {triggerPct}%</span>
        <span>Mép trên {priceText(upper)}</span>
      </div>
    </div>
  )
}

export function BotPanel() {
  const [token] = useState<string | null>(() => captureBotToken())
  const seeded = useRef(false)
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [offline, setOffline] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [liveAsk, setLiveAsk] = useState(false)
  const [form, setForm] = useState({
    rangePct: '20',
    triggerPct: '5',
    pollSeconds: '60',
    maxSlippageBps: '50',
    cooldown: '60',
  })
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!token) return
    const ac = new AbortController()
    let stop = false
    const pull = async () => {
      try {
        const data = (await botFetch('/api/status')) as BotStatus
        if (stop) return
        setStatus(data)
        setOffline(false)
        pollRef.ms = Math.max(60, data.config.pollSeconds || 60) * 1000
        if (!seeded.current) {
          seeded.current = true
          setForm({
            rangePct: String(data.config.rangePct),
            triggerPct: String(data.config.triggerPct),
            pollSeconds: String(data.config.pollSeconds),
            maxSlippageBps: String(data.config.maxSlippageBps),
            cooldown: String(data.config.minRebalanceIntervalMinutes),
          })
        }
      } catch {
        if (!stop) setOffline(true)
      }
    }
    const pollRef = { ms: 60_000 }
    const tick = async () => {
      await pull()
      if (!stop) timer = window.setTimeout(() => void tick(), pollRef.ms)
    }
    let timer = 0
    void tick()
    void openBotEvents(
      (line) => {
        setLogs((prev) => [...prev, line].slice(-200))
      },
      (next) => {
        setStatus(next)
        setOffline(false)
      },
      ac.signal,
    ).catch(() => {
      if (!stop) setOffline(true)
    })
    return () => {
      stop = true
      window.clearTimeout(timer)
      ac.abort()
    }
  }, [token])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  async function act(path: string, body?: unknown) {
    setNote(null)
    try {
      const res = (await botFetch(path, body)) as { message?: string }
      if (res.message) setNote(res.message)
      const data = (await botFetch('/api/status')) as BotStatus
      setStatus(data)
      setOffline(false)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Không làm được')
    }
  }

  if (!token && !botToken()) {
    return (
      <section className="panel">
        <h2>Bot tự động</h2>
        <p>
          Trang này chưa có mã kết nối với chương trình trên máy. Hãy đóng tab và <strong>bấm đúp file Bat-dau.bat</strong> trong thư mục project. Đừng gõ private key vào trình duyệt.
        </p>
      </section>
    )
  }

  const price = status?.price?.medianPrice ?? null

  return (
    <div className="bot-page">
      <section className="panel">
        <div className="row between wrap gap">
          <h2>Bot tự động</h2>
          <div className="tag-row">
            <span className={`tag ${status?.running ? 'ok' : 'off'}`}>
              {status?.stopping ? 'Đang dừng…' : status?.running ? 'Đang chạy' : 'Đang tắt'}
            </span>
            <span className={`tag ${status?.dryRun === false ? 'warn' : 'ok'}`}>
              {status?.dryRun === false ? 'Chạy thật' : 'Chỉ xem (DRY_RUN)'}
            </span>
          </div>
        </div>
        <p className="muted small">
          Khoá ví chỉ nằm trong file .env trên máy. Trang này không hiện, không gửi, và không nhận private key.
        </p>
        {offline && (
          <p className="err">Không thấy chương trình bot. Bấm đúp Bat-dau.bat rồi mở lại trang.</p>
        )}
        {note && <p className="muted">{note}</p>}
        <div className="row gap wrap">
          <button className="btn primary" disabled={!status || status.running || !status.hasPrivateKey} onClick={() => void act('/api/start')}>
            Chạy
          </button>
          <button className="btn" disabled={!status?.running} onClick={() => void act('/api/stop')}>
            Dừng
          </button>
          <button
            className="btn warn"
            disabled={!status}
            onClick={() => {
              if (status?.dryRun === false) {
                void act('/api/config', { dryRun: true })
              } else {
                setLiveAsk(true)
              }
            }}
          >
            {status?.dryRun === false ? 'Đổi về chỉ xem' : 'Đổi sang chạy thật'}
          </button>
        </div>
        <p className="muted small">
          Lần kiểm tra gần nhất: {clock(status?.lastCheckAt ?? null)}. Lần tới khoảng: {clock(status?.nextCheckAt ?? null)}.
        </p>
      </section>

      {!status?.hasPrivateKey && (
        <section className="panel risk-box near">
          <h2>Chưa có khoá ví bot</h2>
          <ol>
            <li>Trong ví, tạo một tài khoản MỚI. Chỉ chuyển ít HYPE và KNTQ vào đó.</li>
            <li>Bấm nút dưới để mở file .env bằng Notepad.</li>
            <li>Dán private key vào dòng PRIVATE_KEY=, rồi Save. Đừng gửi khoá cho ai, đừng dán vào trang này.</li>
            <li>Bấm “Đọc lại file .env”.</li>
          </ol>
          <div className="row gap wrap">
            <button className="btn primary" onClick={() => void act('/api/open-env')}>
              Mở file .env bằng Notepad
            </button>
            <button className="btn" onClick={() => void act('/api/reload-key')}>
              Đọc lại file .env
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Giá từng RPC</h2>
        {status?.price?.blockReason && <p className="err">{status.price.blockReason}</p>}
        {status?.price && !status.price.blockReason && status.price.agreed && (
          <p className="ok-text">
            Khớp nhau. Lệch {(status.price.deviationPct ?? 0).toFixed(3)}%. Giá giữa: 1 HYPE ≈ {priceText(price)} KNTQ
            {status.price.medianTick != null ? ` · tick ${status.price.medianTick}` : ''}
          </p>
        )}
        <ul className="rpc-list">
          {(status?.price?.samples ?? []).map((s) => (
            <li key={s.url}>
              {host(s.url)}:{' '}
              {s.ok && s.price != null
                ? `1 HYPE ≈ ${priceText(s.price)} KNTQ (tick ${s.tick})${
                    s.outlier ? ` · loại (lệch ${(s.deviationPct ?? 0).toFixed(2)}% so với giá giữa)` : ''
                  }`
                : `không đọc được${s.error ? ` (${s.error})` : ''}`}
            </li>
          ))}
        </ul>
        {status?.wallet && (
          <p>
            Ví bot: <span className="mono small">{status.wallet}</span>
            {status.balances
              ? ` · ${status.balances.hype} HYPE · ${status.balances.kntq} KNTQ`
              : ' · chưa đọc được số dư'}
          </p>
        )}
        {status?.error && <p className="err">{status.error}</p>}
      </section>

      {status?.pnl?.totals && (
        <section className="panel">
          <div className="row between wrap gap">
            <h2>Lãi lỗ</h2>
            <button
              className="btn"
              type="button"
              onClick={() => {
                const ok = confirm('Đặt lại mốc tính từ số token đang có? Phí và gas cũ sẽ không còn trong số này.')
                if (!ok || !status.wallet || !status.price?.medianPrice) return
                void act('/api/pnl/reset', {
                  confirm: true,
                  wallet: status.wallet,
                  price: status.price.medianPrice,
                  positions: status.positions.map((p) => ({
                    tokenId: p.tokenId,
                    amount0: p.amount0,
                    amount1: p.amount1,
                    fees0: p.fees0,
                    fees1: p.fees1,
                  })),
                })
              }}
            >
              Đặt lại mốc tính
            </button>
          </div>
          <PnlCards pnl={status.pnl.totals} apr={status.pnl.totals.feeAprPct} estimated={status.pnl.positions.some((p) => p.estimated)} />
          <PnlChart points={status.pnl.series} />
          <p className="muted small">Đường xanh dương là phí tích lũy. Đường kia là lãi/lỗ ròng.</p>
        </section>
      )}

      <section className="panel">
        <h2>Vị thế</h2>
        {(status?.positions.length ?? 0) === 0 && (
          <p>
            Chưa có vị thế nào trong pool này. Bot không tự mở vị thế lần đầu. Sang tab{' '}
            <strong>Thủ công</strong>, kết nối <strong>đúng ví bot này</strong>
            {status?.wallet ? (
              <>
                : <span className="mono">{status.wallet}</span>
              </>
            ) : (
              ' (địa chỉ hiện sau khi file .env có khoá)'
            )}
            , rồi tạo vị thế khoảng <strong>±20%</strong> (nút “Chắc ±20%”).
          </p>
        )}
        {status?.positions.map((p) => (
          <article key={p.tokenId} className="card">
            <div className="card-head">
              <strong>#{p.tokenId}</strong>
              <span className={`tag ${p.inRange ? (p.nearEdge ? 'warn' : 'ok') : 'off'}`}>
                {!p.inRange ? 'Ngoài khoảng' : p.nearEdge ? 'Sát mép' : 'Trong khoảng'}
              </span>
            </div>
            <p className="small">
              Tick [{p.tickLower}, {p.tickUpper}] · 1 HYPE ≈ {priceText(p.lowerPrice)} – {priceText(p.upperPrice)} KNTQ
            </p>
            {price != null && (
              <RangeBar
                lower={p.lowerPrice}
                upper={p.upperPrice}
                price={price}
                triggerPct={status.config.triggerPct}
              />
            )}
            <p>
              Trong vị thế khoảng {p.amount0} HYPE + {p.amount1} KNTQ.
              <br />
              Phí chưa rút:{' '}
              {p.feesKnown ? `${p.fees0} HYPE + ${p.fees1} KNTQ` : 'không đọc được'}
            </p>
            {p.side && (
              <p className="warn-text">Giá đang ở {p.side === 'below' ? 'dưới' : 'trên'} khoảng.</p>
            )}
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Chỉnh thông số</h2>
        <div className="grid2">
          <label>
            RANGE_PCT (khoảng mới ±%)
            <input value={form.rangePct} onChange={(e) => setForm({ ...form, rangePct: e.target.value })} />
          </label>
          <label>
            TRIGGER_PCT (kích hoạt khi cách mép %)
            <input value={form.triggerPct} onChange={(e) => setForm({ ...form, triggerPct: e.target.value })} />
          </label>
          <label>
            POLL_SECONDS (giây giữa mỗi lần hỏi)
            <input value={form.pollSeconds} onChange={(e) => setForm({ ...form, pollSeconds: e.target.value })} />
          </label>
          <label>
            MAX_SLIPPAGE_BPS (trượt giá, 50 = 0,5%)
            <input value={form.maxSlippageBps} onChange={(e) => setForm({ ...form, maxSlippageBps: e.target.value })} />
          </label>
          <label>
            Nghỉ tối thiểu sau mỗi lần cân bằng (phút)
            <input value={form.cooldown} onChange={(e) => setForm({ ...form, cooldown: e.target.value })} />
          </label>
        </div>
        <button
          className="btn primary"
          onClick={() =>
            void act('/api/config', {
              rangePct: Number(form.rangePct),
              triggerPct: Number(form.triggerPct),
              pollSeconds: Number(form.pollSeconds),
              maxSlippageBps: Number(form.maxSlippageBps),
              minRebalanceIntervalMinutes: Number(form.cooldown),
            })
          }
        >
          Lưu cấu hình
        </button>
      </section>

      <section className="panel">
        <h2>Lịch sử cân bằng</h2>
        {(status?.history.length ?? 0) === 0 && <p className="muted">Chưa có lần nào.</p>}
        <ul className="summary">
          {status?.history.map((h) => (
            <li key={`${h.at}-${h.summary}`}>
              {clock(h.at)} · {h.kind === 'live' ? 'chạy thật' : h.kind === 'dry-run' ? 'chỉ xem' : 'ghi chú'} · {h.summary}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Nhật ký</h2>
        <pre ref={logRef} className="bot-log">
          {logs.length === 0 ? 'Chưa có dòng nào.' : logs.join('\n')}
        </pre>
      </section>

      {liveAsk && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Chạy thật?</h2>
            <p>
              Bot sẽ gửi giao dịch thật từ ví trong file .env. Gas và phí swap có thể ăn hết lãi. Khi rút vị thế, lỗ tạm thời thành lỗ thật. Khoá nằm trên máy này. Pool mỏng thì dễ bị người khác chen giá.
            </p>
            <p>Nếu chưa chắc, hãy để chế độ chỉ xem.</p>
            <div className="row gap">
              <button className="btn" onClick={() => setLiveAsk(false)}>
                Giữ chế độ chỉ xem
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  setLiveAsk(false)
                  void act('/api/config', { dryRun: false, confirmLive: true })
                }}
              >
                Tôi hiểu, cho chạy thật
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
