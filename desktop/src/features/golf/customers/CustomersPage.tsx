import { Button, Input } from '@tachyon-sdk/native-ui'
import { ArrowLeft, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import {
  Field,
  FormGrid,
  LoadingState,
  Notice,
  PageHeader,
  Panel,
} from '../../../components/Page'
import { navigate, navigateFromClick } from '../../../lib/router'
import { showToast } from '../../../lib/toast'
import { MembershipBadge } from './MembershipBadge'
import { customerDistinguisher, customersPath, type Customer } from './models'
import { useCustomerSearch } from './useCustomerSearch'

/**
 * The customer ledger.
 *
 * Members and visitors are the same ledger. A visitor is not a lesser record —
 * they are the person nobody would otherwise write down, and the reason this
 * screen exists is so the second visit can be recognised as a second visit.
 *
 * There is no "list everyone" here on purpose. The search refuses an empty box
 * server-side: walking the whole ledger a page at a time is what a scraper
 * wants, and the desk always arrives with a name or a number in hand.
 */
export function CustomersPage() {
  const { t } = useTranslation(['customers', 'common'])
  const [term, setTerm] = useState('')
  const search = useCustomerSearch(term)

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Button type="button" variant="primary" onClick={() => navigate('golf/customers/new')}>
          <UserPlus /> {t('customers:create.open')}
        </Button>
      </div>

      <Panel title={t('customers:search.title')} description={t('customers:search.description')}>
        <Field label={t('customers:search.label')}>
          <Input
            value={term}
            placeholder={t('customers:search.placeholder')}
            onChange={event => setTerm(event.target.value)}
          />
        </Field>

        {search.searching ? <LoadingState /> : null}
        {/* A ledger that cannot be reached is a note, not a blocked screen:
            the desk still has to be able to register someone. */}
        {search.error ? <Notice tone="danger">{search.error}</Notice> : null}

        {!search.searching && !search.error && term.trim().length >= 2
          && search.candidates.length === 0 ? (
          <Notice tone="info">{t('customers:search.noMatches', { term: term.trim() })}</Notice>
        ) : null}

        {term.trim().length < 2 ? (
          <Notice tone="info">{t('customers:search.prompt')}</Notice>
        ) : null}

        <ul className="customer-ledger-list">
          {search.candidates.map(customer => (
            <li className="customer-ledger-row" key={customer.id}>
              {/* A link rather than a button: a customer's page is somewhere the
                  desk opens in a second tab and comes back to. */}
              <a
                className="customer-ledger-row__pick"
                href={`#/golf/customers/${encodeURIComponent(customer.id)}`}
                onClick={event => navigateFromClick(event, `golf/customers/${customer.id}`)}
              >
                <span className="customer-ledger-row__name">{customer.name}</span>
                {/* Phone or email, whichever the desk has — two people share a
                    name often enough that the row needs something else on it. */}
                <span className="customer-ledger-row__detail">
                  {customerDistinguisher(customer) ?? t('customers:noContact')}
                </span>
              </a>
              <MembershipBadge customerId={customer.id} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

/**
 * Registering someone the desk could not find.
 *
 * Only the name is required. A phone booking often yields nothing else, and
 * demanding an email here is exactly what kept visitors out of the ledger
 * before PLT-3358.
 *
 * Its own route, not a panel bolted onto the search screen: the desk fills
 * this in while on the phone, and a route survives a refresh or a bookmark
 * the way a piece of local state does not.
 */
export function NewCustomerPage() {
  const { t } = useTranslation(['customers', 'common'])
  const [draft, setDraft] = useState({ name: '', nameKana: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      const created = await courseboardApiJson<Customer>(customersPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          nameKana: draft.nameKana.trim() || null,
          phone: draft.phone.trim() || null,
          email: draft.email.trim() || null,
        }),
      })
      showToast({ tone: 'success', message: t('customers:create.saved') })
      navigate(`golf/customers/${created.id}`)
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('customers:create.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-stack page-narrow">
      <PageHeader
        title={t('customers:create.title')}
        description={t('customers:create.description')}
        actions={(
          <Button type="button" onClick={() => navigate('golf/customers')}>
            <ArrowLeft /> {t('customers:detail.back')}
          </Button>
        )}
      />

      <Panel>
        <FormGrid columns={2}>
          <Field label={t('customers:field.name')}>
            <Input
              value={draft.name}
              placeholder={t('customers:create.namePlaceholder')}
              onChange={event => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label={t('customers:field.nameKana')} requirement="optional">
            <Input
              value={draft.nameKana}
              onChange={event => setDraft({ ...draft, nameKana: event.target.value })}
            />
          </Field>
          <Field label={t('customers:field.phone')} requirement="optional">
            <Input
              value={draft.phone}
              onChange={event => setDraft({ ...draft, phone: event.target.value })}
            />
          </Field>
          <Field label={t('customers:field.email')} requirement="optional">
            <Input
              value={draft.email}
              onChange={event => setDraft({ ...draft, email: event.target.value })}
            />
          </Field>
        </FormGrid>

        <div className="customer-ledger-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('golf/customers')}
            disabled={saving}
          >
            {t('common:action.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={save}
            disabled={saving || !draft.name.trim()}
          >
            {saving ? t('common:action.saving') : t('common:action.save')}
          </Button>
        </div>
      </Panel>
    </div>
  )
}
