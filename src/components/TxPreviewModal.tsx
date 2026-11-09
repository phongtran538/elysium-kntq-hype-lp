import { explorerAddress } from '../config/contracts'
import type { TxPreview } from '../hooks/useTxFlow'
import { formatUnits } from '../lib/math'

export function TxPreviewModal({
  preview,
  simulating,
  sending,
  error,
  onConfirm,
  onCancel,
}: {
  preview: TxPreview
  simulating: boolean
  sending: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const busy = simulating || sending
  const approvals = preview.approvals ?? []
  const totalSteps = approvals.length + 1
  const stepNum = preview.stepIndex + 1
  const isApproval = preview.stepIndex < approvals.length
  const currentApproval = isApproval ? approvals[preview.stepIndex] : null
  const called = currentApproval
    ? { name: currentApproval.label, address: currentApproval.to, value: currentApproval.value ?? 0n }
    : { name: 'PositionManager.modifyLiquidities', address: preview.to, value: preview.value }

  const confirmLabel = simulating
    ? '模拟中…'
    : sending
      ? '等待钱包…'
      : isApproval
        ? `模拟并签名 · 步骤 ${stepNum}/${totalSteps}（授权）`
        : `模拟并签名 · 步骤 ${stepNum}/${totalSteps}（主交易）`

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{preview.title}</h2>
        <p className="muted small">
          签名前核对下面三个合约地址。钱包弹窗里的地址必须一模一样。每一步单独模拟、单独签名。
        </p>

        <div className="addr-block">
          <div className="label">这次实际发给</div>
          <div className="addr-called">{called.name}</div>
          <a
            className="mono small"
            href={explorerAddress(called.address)}
            target="_blank"
            rel="noreferrer"
          >
            {called.address}
          </a>
          <div className="small">
            msg.value：{formatUnits(called.value, 18)} HYPE
          </div>
        </div>

        <div className="label">合约地址（点开浏览器核对）</div>
        <ul className="addr-list">
          {preview.contracts.map((c) => (
            <li key={c.name}>
              <div>
                <strong>{c.role}</strong> · {c.name}
              </div>
              <a href={explorerAddress(c.address)} target="_blank" rel="noreferrer" className="mono small">
                {c.address}
              </a>
              <div className="small">{c.detail}</div>
            </li>
          ))}
        </ul>

        <ul className="summary">
          {preview.summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
          {approvals.length > 0 && (
            <li>
              共 {totalSteps} 步（{approvals.length} 笔授权 + 1 笔主交易），当前第 {stepNum} 步
            </li>
          )}
          {currentApproval?.detail?.map((d) => (
            <li key={d} className="mono small">
              {d}
            </li>
          ))}
          <li className="muted">
            点确认后会再向多个 RPC 读一次 slot0。价差超过 1% 就取消，不会发交易。失败也不会自动重发或放宽滑点。
          </li>
        </ul>
        {error && <p className="err">{error}</p>}
        <div className="row gap">
          <button className="btn" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
