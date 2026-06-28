import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { loadStripe, Stripe } from '@stripe/stripe-js'
import { Component, FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import {
  apiJson,
  CancellationFeeCollection,
  publicApiBaseUrl,
  StripePaymentIntentResponse,
  yen,
} from './api'

type PaymentPageProps = {
  token: string
}

export function PaymentPage({ token }: PaymentPageProps) {
  const apiBase = useMemo(() => publicApiBaseUrl(), [])
  const [collection, setCollection] = useState<CancellationFeeCollection | null>(null)
  const [intent, setIntent] = useState<StripePaymentIntentResponse | null>(null)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const nextCollection = await apiJson<CancellationFeeCollection>(
          apiBase,
          `/public/cancellation-fees/${token}`,
        )
        if (cancelled) return
        setCollection(nextCollection)
        if (nextCollection.status === 'paid') return
        if (!nextCollection.field_invoice_id) {
          setPaymentError(
            'この支払いリンクは現在利用できません。お手数ですが施設へお問い合わせください。',
          )
          return
        }
        try {
          const nextIntent = await apiJson<StripePaymentIntentResponse>(
            apiBase,
            `/public/cancellation-fees/${token}/stripe-payment-intent`,
            { method: 'POST' },
          )
          if (cancelled) return
          setIntent(nextIntent)
          setStripePromise(loadStripe(nextIntent.publishable_key))
        } catch (err) {
          if (!cancelled) {
            setPaymentError(
              err instanceof Error ? err.message : '支払いフォームを準備できませんでした',
            )
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : '支払い情報を読み込めませんでした')
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [apiBase, token])

  if (loadError) {
    return (
      <main className="payment-shell">
        <section className="payment-panel">
          <p className="eyebrow">Course Board</p>
          <h1>支払いページを開けません</h1>
          <pre className="error-box">{loadError}</pre>
        </section>
      </main>
    )
  }

  if (!collection) {
    return (
      <main className="payment-shell">
        <section className="payment-panel">
          <p className="eyebrow">Course Board</p>
          <h1>読み込み中...</h1>
        </section>
      </main>
    )
  }

  if (collection.status === 'paid') {
    return (
      <main className="payment-shell">
        <section className="payment-panel success">
          <p className="eyebrow">Course Board</p>
          <h1>お支払い済みです</h1>
          <p>キャンセル料のお支払いを確認しました。</p>
        </section>
      </main>
    )
  }

  return (
    <main className="payment-shell">
      <section className="payment-summary">
        <p className="eyebrow">Course Board</p>
        <h1>キャンセル料のお支払い</h1>
        <div className="payment-amount">{yen(collection.amount)}</div>
        <dl>
          <div>
            <dt>請求先</dt>
            <dd>{collection.customer_name}</dd>
          </div>
          {collection.reference ? (
            <div>
              <dt>対象</dt>
              <dd>{collection.reference}</dd>
            </div>
          ) : null}
          <div>
            <dt>支払期限</dt>
            <dd>{collection.due_date}</dd>
          </div>
          {collection.reason ? (
            <div>
              <dt>理由</dt>
              <dd>{collection.reason}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="payment-panel">
        {paymentError ? (
          <div>
            <h2>支払いフォームを準備できません</h2>
            <pre className="error-box">{paymentError}</pre>
          </div>
        ) : stripePromise && intent ? (
          <PaymentElementBoundary>
            <Elements
              stripe={stripePromise}
              options={{ clientSecret: intent.client_secret, appearance: stripeAppearance }}
            >
              <StripeCheckoutForm
                apiBase={apiBase}
                token={token}
                collection={collection}
                onPaid={setCollection}
              />
            </Elements>
          </PaymentElementBoundary>
        ) : (
          <p>支払いフォームを準備しています...</p>
        )}
      </section>
    </main>
  )
}

class PaymentElementBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state = { message: null }

  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error
        ? error.message
        : '支払いフォームを初期化できませんでした',
    }
  }

  render() {
    if (this.state.message) {
      return (
        <div>
          <h2>支払いフォームを初期化できません</h2>
          <pre className="error-box">{this.state.message}</pre>
        </div>
      )
    }

    return this.props.children
  }
}

const stripeAppearance = {
  theme: 'stripe' as const,
  variables: {
    colorPrimary: '#286f5a',
    borderRadius: '6px',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
}

function StripeCheckoutForm({
  apiBase,
  token,
  collection,
  onPaid,
}: {
  apiBase: string
  token: string
  collection: CancellationFeeCollection
  onPaid: (collection: CancellationFeeCollection) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [formReady, setFormReady] = useState(false)
  const [formLoadError, setFormLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    setMessage(null)
    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: window.location.href,
      },
    })
    if (result.error) {
      setMessage(result.error.message ?? '決済に失敗しました')
      setSubmitting(false)
      return
    }
    if (result.paymentIntent) {
      const confirmed = await apiJson<{ collection: CancellationFeeCollection }>(
        apiBase,
        `/public/cancellation-fees/${token}/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ payment_intent_id: result.paymentIntent.id }),
        },
      )
      onPaid(confirmed.collection)
      setMessage(confirmed.collection.status === 'paid'
        ? 'お支払いを確認しました'
        : 'お支払い処理を受け付けました。確認まで少しお待ちください。')
    }
    setSubmitting(false)
  }

  return (
    <form className="stripe-form" onSubmit={submit}>
      <div className="form-total">
        <span>お支払い金額</span>
        <strong>{yen(collection.amount)}</strong>
      </div>
      <div className="payment-element-host">
        {!formReady && !formLoadError ? (
          <p className="payment-element-loading">支払いフォームを読み込んでいます...</p>
        ) : null}
        <PaymentElement
          options={{ layout: 'tabs' }}
          onReady={() => {
            setFormReady(true)
            setFormLoadError(null)
          }}
          onLoadError={event => {
            setFormReady(false)
            setFormLoadError(event.error.message ?? '支払いフォームを読み込めませんでした')
          }}
        />
      </div>
      {formLoadError ? <pre className="error-box">{formLoadError}</pre> : null}
      {message ? <p className="form-message">{message}</p> : null}
      <button disabled={!stripe || !elements || !formReady || submitting} type="submit">
        {submitting ? '処理中...' : '支払いを完了する'}
      </button>
    </form>
  )
}
