import { Button, Input } from '@tachyon-sdk/native-ui'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import {
  Field,
  FormGrid,
  LoadingState,
  Notice,
  Panel,
} from '../../../components/Page'
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
  const [selected, setSelected] = useState<Customer | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className="page-stack">
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
            <li
              className={`customer-ledger-row${selected?.id === customer.id ? ' is-selected' : ''}`}
              key={customer.id}
            >
              <button
                type="button"
                className="customer-ledger-row__pick"
                onClick={() => setSelected(customer)}
              >
                <span className="customer-ledger-row__name">{customer.name}</span>
                {/* Phone or email, whichever the desk has — two people share a
                    name often enough that the row needs something else on it. */}
                <span className="customer-ledger-row__detail">
                  {customerDistinguisher(customer) ?? t('customers:noContact')}
                </span>
              </button>
              <MembershipBadge customerId={customer.id} />
            </li>
          ))}
        </ul>

        <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(true)}>
          <UserPlus />
          {t('customers:create.open')}
        </Button>
      </Panel>

      {creating ? (
        <NewCustomerPanel
          onCancel={() => setCreating(false)}
          onCreated={customer => {
            setCreating(false)
            setSelected(customer)
            setTerm(customer.name)
          }}
        />
      ) : null}

      {selected ? (
        <Panel title={selected.name} description={t('customers:detail.description')}>
          <dl className="customer-ledger-detail">
            <dt>{t('customers:field.nameKana')}</dt>
            <dd>{selected.nameKana || t('common:state.unset')}</dd>
            <dt>{t('customers:field.phone')}</dt>
            <dd>{selected.phone || t('common:state.unset')}</dd>
            <dt>{t('customers:field.email')}</dt>
            <dd>{selected.email || t('common:state.unset')}</dd>
            <dt>{t('customers:field.membership')}</dt>
            <dd><MembershipBadge customerId={selected.id} /></dd>
          </dl>
        </Panel>
      ) : null}
    </div>
  )
}

/**
 * Registering someone the desk could not find.
 *
 * Only the name is required. A phone booking often yields nothing else, and
 * demanding an email here is exactly what kept visitors out of the ledger
 * before PLT-3358.
 */
function NewCustomerPanel({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (customer: Customer) => void
}) {
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
      onCreated(created)
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
    <Panel title={t('customers:create.title')} description={t('customers:create.description')}>
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
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
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
  )
}
