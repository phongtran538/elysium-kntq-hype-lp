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
    ? 'Đang thử…'
    : sending
      ? 'Đợi ví…'
      : isApproval
        ? `Thử và ký · bước ${stepNum}/${totalSteps} (cấp quyền)`
        : `Thử và ký · bước ${stepNum}/${totalSteps} (giao dịch chính)`

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{preview.title}</h2>
        <p className="muted small">
          Trước khi ký, đối chiếu 3 địa chỉ dưới đây. Địa chỉ trong ví phải giống hệt. Mỗi bước thử riêng và ký riêng.
        </p>

        <div className="addr-block">
          <div className="label">Lần này gửi tới</div>
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
            Tiền gửi kèm (msg.value): {formatUnits(called.value, 18)} HYPE
          </div>
        </div>

        <div className="label">Địa chỉ hợp đồng (bấm để mở explorer)</div>
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
              Tổng {totalSteps} bước ({approvals.length} lần cấp quyền + 1 giao dịch chính), đang ở bước {stepNum}
            </li>
          )}
          {currentApproval?.detail?.map((d) => (
            <li key={d} className="mono small">
              {d}
            </li>
          ))}
          <li className="muted">
            Bấm xác nhận sẽ đọc lại slot0 trên nhiều RPC. Lệch quá 1% thì hủy, không gửi. Lỗi cũng không tự gửi lại hay nới trượt giá.
          </li>
        </ul>
        {error && <p className="err">{error}</p>}
        <div className="row gap">
          <button className="btn" disabled={busy} onClick={onCancel}>
            Hủy
          </button>
          <button className="btn primary" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
