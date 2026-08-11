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
import { Sheet } from '../../../components/Sheet'
import { navigateFromClick } from '../../../lib/router'
import { showToast } from '../../../lib/toast'
import { MembershipBadge } from './MembershipBadge'
import { customerDistinguisher, customersPath, type Customer } from './models'
import {
  rememberRegisteredCustomer,
  useRecentlyRegisteredCustomers,
} from './recentlyRegistered'
import { customerSearchParameter, useCustomerSearch } from './useCustomerSearch'

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
 *
 * The one exception is the person the desk has just registered. They arrived
 * with no name to search for — they were being written down, not looked up —
 * so the registrations made in this session stay listed until the desk
 * searches for somebody else.
 */
export function CustomersPage() {
  const { t } = useTranslation(['customers', 'common'])
  const [term, setTerm] = useState('')
  const search = useCustomerSearch(term)
  const [creating, setCreating] = useState(false)
  const justRegistered = useRecentlyRegisteredCustomers()
  const trimmedTerm = term.trim()
  const searchParameter = customerSearchParameter(term)
  const searchCondition = searchParameter
    ? t(`customers:search.condition.${searchParameter}`)
    : ''

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Button type="button" variant="primary" onClick={() => setCreating(true)}>
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

        {!search.searching && !search.error && search.completedQuery === trimmedTerm
          && search.candidates.length === 0 ? (
          <Notice tone="info">
            {t('customers:search.noMatches', { term: trimmedTerm, condition: searchCondition })}
          </Notice>
        ) : null}

        {!trimmedTerm ? (
          <Notice tone="info">{t('customers:search.prompt')}</Notice>
        ) : null}

        <CustomerRows customers={search.candidates} />
      </Panel>

      {/* Only while nothing is being searched: once the desk has typed a name,
          the answer to that question is the list they are reading, and a second
          list underneath it holding the same person twice is noise. */}
      {!trimmedTerm && justRegistered.length > 0 ? (
        <Panel
          title={t('customers:recent.title')}
          description={t('customers:recent.description')}
        >
          <CustomerRows customers={justRegistered} />
        </Panel>
      ) : null}

      <NewCustomerSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={customer => {
          setCreating(false)
          // Stays on the ledger screen. Registering used to jump straight to the
          // new customer's page, which left the desk one "back" away from an
          // empty search box with no trace of the person they had just added —
          // the save read as having done nothing.
          rememberRegisteredCustomer(customer)
        }}
      />
    </div>
  )
}

/** One row per person, for whichever list is being shown. */
function CustomerRows({ customers }: { customers: readonly Customer[] }) {
  const { t } = useTranslation(['customers'])
  return (
    <ul className="customer-ledger-list">
      {customers.map(customer => (
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
  )
}

const EMPTY_DRAFT = { name: '', nameKana: '', phone: '', email: '' }

/**
 * Registering someone the desk could not find.
 *
 * Only the name is required. A phone booking often yields nothing else, and
 * demanding an email here is exactly what kept visitors out of the ledger
 * before PLT-3358.
 *
 * A sheet rather than a route: this is a quick aside while the desk is on the
 * phone, not a destination — the search screen (and whatever the desk typed
 * into it) should still be there underneath when it closes.
 */
function NewCustomerSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (customer: Customer) => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)

  function close(next: boolean) {
    if (!next) setDraft(EMPTY_DRAFT)
    onOpenChange(next)
  }

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
      setDraft(EMPTY_DRAFT)
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
    <Sheet
      open={open}
      onOpenChange={close}
      title={t('customers:create.title')}
      description={t('customers:create.description')}
    >
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
        <Button type="button" variant="ghost" onClick={() => close(false)} disabled={saving}>
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
    </Sheet>
  )
}
