import { FormEvent, useMemo, useState } from 'react'
import {
  courseboardApiJson,
  CreateCollectionResponse,
  fieldTenant,
  yen,
} from './api'

type FormState = {
  reference: string
  customerName: string
  customerPhone: string
  amount: string
  dueDate: string
  reason: string
  notes: string
}

const defaultDueDate = () => {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

export function CollectionConsole() {
  const tenantId = useMemo(() => fieldTenant(), [])
  const [form, setForm] = useState<FormState>({
    reference: '',
    customerName: '',
    customerPhone: '',
    amount: '5000',
    dueDate: defaultDueDate(),
    reason: '当日キャンセル',
    notes: '',
  })
  const [result, setResult] = useState<CreateCollectionResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const response = await courseboardApiJson<CreateCollectionResponse>(
        '/cancellation-fee-collections',
        {
          method: 'POST',
          body: JSON.stringify({
            tenant_id: tenantId,
            reference: form.reference || undefined,
            customer_name: form.customerName,
            customer_phone: form.customerPhone,
            amount: Number(form.amount),
            currency: 'JPY',
            due_date: form.dueDate,
            reason: form.reason || undefined,
            notes: form.notes || undefined,
            send_sms: true,
          }),
        },
      )
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="console-shell">
      <section className="console-main">
        <div className="console-heading">
          <p className="eyebrow">Course Board collections</p>
          <h1>キャンセル料をSMSで送る</h1>
          <p>
            金額と電話番号を入力すると、Stripe支払いページへのリンクをSMSで送信します。
          </p>
        </div>

        <form className="collection-form" onSubmit={onSubmit}>
          <label>
            <span>予約・受付番号</span>
            <input
              value={form.reference}
              onChange={event => setForm({ ...form, reference: event.target.value })}
              placeholder="RSV-1001"
            />
          </label>
          <label>
            <span>請求先名</span>
            <input
              required
              value={form.customerName}
              onChange={event => setForm({ ...form, customerName: event.target.value })}
              placeholder="山田 太郎"
            />
          </label>
          <label>
            <span>SMS送付先</span>
            <input
              required
              type="tel"
              value={form.customerPhone}
              onChange={event => setForm({ ...form, customerPhone: event.target.value })}
              placeholder="+819012345678"
            />
          </label>
          <div className="field-pair">
            <label>
              <span>キャンセル料</span>
              <input
                required
                type="number"
                min="1"
                value={form.amount}
                onChange={event => setForm({ ...form, amount: event.target.value })}
              />
            </label>
            <label>
              <span>支払期限</span>
              <input
                required
                type="date"
                value={form.dueDate}
                onChange={event => setForm({ ...form, dueDate: event.target.value })}
              />
            </label>
          </div>
          <label>
            <span>理由</span>
            <input
              value={form.reason}
              onChange={event => setForm({ ...form, reason: event.target.value })}
              placeholder="当日キャンセル"
            />
          </label>
          <label>
            <span>備考</span>
            <textarea
              value={form.notes}
              onChange={event => setForm({ ...form, notes: event.target.value })}
              placeholder="連絡時の補足があれば入力"
            />
          </label>
          <button disabled={submitting} type="submit">
            {submitting ? '送信中...' : 'SMSで支払いリンクを送る'}
          </button>
        </form>
      </section>

      <aside className="console-side">
        <div className="amount-ticket">
          <span>請求金額</span>
          <strong>{yen(Number(form.amount) || 0)}</strong>
          <small>{form.dueDate || '期限未設定'} まで</small>
        </div>
        {error ? <pre className="error-box">{error}</pre> : null}
        {result ? (
          <div className="result-box">
            <p className="result-label">SMS status: {result.collection.sms_status}</p>
            <a href={result.collection.payment_url} target="_blank" rel="noreferrer">
              支払いページを開く
            </a>
            <textarea readOnly value={result.sms_message} />
          </div>
        ) : (
          <p className="side-note">
            Field admin iframe内ではproxy経由で認証付き送信します。ローカル直開きの場合は
            API bearerをdev envに設定してください。
          </p>
        )}
      </aside>
    </main>
  )
}
