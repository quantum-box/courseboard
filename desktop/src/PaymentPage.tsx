import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { loadStripe, Stripe } from '@stripe/stripe-js'
import { Component, FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18next } from './i18n'
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
  const { t } = useTranslation(['payment'])
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
            t('payment:unavailable'),
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
              err instanceof Error ? err.message : t('payment:formFailed'),
            )
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : t('payment:loadFailed'))
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
          <h1>{t('payment:cannotOpen')}</h1>
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
          <h1>{t('payment:loading')}</h1>
        </section>
      </main>
    )
  }

  if (collection.status === 'paid') {
    return (
      <main className="payment-shell">
        <section className="payment-panel success">
          <p className="eyebrow">Course Board</p>
          <h1>{t('payment:paid.title')}</h1>
          <p>{t('payment:paid.description')}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="payment-shell">
      <section className="payment-summary">
        <p className="eyebrow">Course Board</p>
        <h1>{t('payment:title')}</h1>
        <div className="payment-amount">{yen(collection.amount)}</div>
        <dl>
          <div>
            <dt>{t('payment:field.client')}</dt>
            <dd>{collection.customer_name}</dd>
          </div>
          {collection.reference ? (
            <div>
              <dt>{t('payment:field.reference')}</dt>
              <dd>{collection.reference}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('payment:field.due')}</dt>
            <dd>{collection.due_date}</dd>
          </div>
          {collection.reason ? (
            <div>
              <dt>{t('payment:field.reason')}</dt>
              <dd>{collection.reason}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="payment-panel">
        {paymentError ? (
          <div>
            <h2>{t('payment:form.unavailableTitle')}</h2>
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
          <p>{t('payment:form.preparing')}</p>
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
        : i18next.t('payment:form.initFailed'),
    }
  }

  render() {
    if (this.state.message) {
      return (
        <div>
          <h2>{i18next.t('payment:form.initFailedTitle')}</h2>
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
  const { t } = useTranslation(['payment'])
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
      setMessage(result.error.message ?? t('payment:form.failed'))
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
        ? t('payment:form.succeeded')
        : t('payment:form.processing'))
    }
    setSubmitting(false)
  }

  return (
    <form className="stripe-form" onSubmit={submit}>
      <div className="form-total">
        <span>{t('payment:form.amount')}</span>
        <strong>{yen(collection.amount)}</strong>
      </div>
      <div className="payment-element-host">
        {!formReady && !formLoadError ? (
          <p className="payment-element-loading">{t('payment:form.loading')}</p>
        ) : null}
        <PaymentElement
          options={{ layout: 'tabs' }}
          onReady={() => {
            setFormReady(true)
            setFormLoadError(null)
          }}
          onLoadError={event => {
            setFormReady(false)
            setFormLoadError(event.error.message ?? t('payment:form.loadFailed'))
          }}
        />
      </div>
      {formLoadError ? <pre className="error-box">{formLoadError}</pre> : null}
      {message ? <p className="form-message">{message}</p> : null}
      <button disabled={!stripe || !elements || !formReady || submitting} type="submit">
        {submitting ? t('payment:form.submitting') : t('payment:form.submit')}
      </button>
    </form>
  )
}
