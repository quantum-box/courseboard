import { Button, Input } from '@tachyon-sdk/native-ui'
import { CalendarX, FileScan, PhoneCall, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Notice,
  Panel,
} from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { useKeptData } from '../../../hooks/useKeptData'
import { clearResourceCache } from '../../../hooks/useResource'
import { navigate, navigateFromClick } from '../../../lib/router'
import { showToast } from '../../../lib/toast'
import { customersPath, type Customer } from './models'
import {
  customerSearchParameter,
  LEDGER_PAGE_SIZE,
  useCustomerSearch,
} from './useCustomerSearch'

/**
 * The customer ledger.
 *
 * Members and visitors are the same ledger. A visitor is not a lesser record —
 * they are the person nobody would otherwise write down, and the reason this
 * screen exists is so the second visit can be recognised as a second visit.
 *
 * An empty box lists the ledger rather than nothing, most recently touched
 * first, a page at a time from Field. The ledger grows with every visitor, so
 * nothing here holds more of it than the page on screen.
 */
export function CustomersPage() {
  const { t } = useTranslation(['customers', 'common'])
  const [term, setTermState] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  // A new search starts from its first page; page three of the old answer
  // means nothing for the new one.
  const setTerm = (next: string) => {
    setTermState(next)
    setPageIndex(0)
  }
  // An empty box lists the ledger rather than waiting to be typed into: the
  // desk arrives with a name most of the time, but not always, and a screen
  // that answers a reload with nothing reads as if the ledger were empty.
  const search = useCustomerSearch(term, {
    listWhenEmpty: true,
    limit: LEDGER_PAGE_SIZE,
    offset: pageIndex * LEDGER_PAGE_SIZE,
  })
  // The page on screen stays up, dimmed, while the next one loads, so turning
  // a page does not collapse the table under the pointer.
  const shown = useKeptData(search.searching ? null : search)
  const [creating, setCreating] = useState(false)
  const trimmedTerm = term.trim()
  const searchParameter = customerSearchParameter(term)
  const searchCondition = searchParameter
    ? t(`customers:search.condition.${searchParameter}`)
    : ''

  const columns = useMemo<DataTableColumn<Customer>[]>(() => [
    {
      key: 'name',
      header: t('customers:field.name'),
      cell: customer => <strong>{customer.name}</strong>,
    },
    {
      key: 'nameKana',
      header: t('customers:field.nameKana'),
      // Blank rather than a dash: a visitor taken by phone usually has no
      // reading on file, and that is the normal state, not a gap to fill.
      cell: customer => customer.nameKana ?? null,
    },
    {
      key: 'phone',
      header: t('customers:field.phone'),
      cell: customer => customer.phone ?? null,
    },
    {
      key: 'email',
      header: t('customers:field.email'),
      cell: customer => customer.email ?? null,
    },
  ], [t])

  return (
    <div className="page-stack">
      {/* Registering sits on the panel's own header rather than a strip above
          it: a toolbar holding one button leaves a band of empty page between
          the workspace bar and the first thing to read. */}
      <Panel
        title={t('customers:search.title')}
        description={t('customers:search.description')}
        actions={(
          <>
            {/* Reading a sheet is its own screen, not a sheet-over-the-ledger:
                it needs the scan and the rows side by side, which is more than
                a quick aside while the desk is on the phone. */}
            <Button
              type="button"
              variant="ghost"
              onClick={event => navigateFromClick(event, 'golf/customers/reception')}
            >
              <FileScan /> {t('customers:reception.open')}
            </Button>
            {/* Ringing people back starts from a ranked slice of the ledger,
                which is a different question from "who is this person" and so
                a different screen. */}
            <Button
              type="button"
              variant="ghost"
              onClick={event => navigateFromClick(event, 'golf/customers/call-list')}
            >
              <PhoneCall /> {t('customers:callList.open')}
            </Button>
            {/* Who cancelled and who still owes for it: the same ledger read
                by what people gave up rather than by who they are, and the
                only place a cancellation fee starts from a real booking. */}
            <Button
              type="button"
              variant="ghost"
              onClick={event => navigateFromClick(event, 'golf/customers/cancellations')}
            >
              <CalendarX /> {t('customers:cancellations.open')}
            </Button>
            <Button type="button" variant="primary" onClick={() => setCreating(true)}>
              <UserPlus /> {t('customers:create.open')}
            </Button>
          </>
        )}
      >
        <Field label={t('customers:search.label')}>
          <Input
            value={term}
            placeholder={t('customers:search.placeholder')}
            onChange={event => setTerm(event.target.value)}
          />
        </Field>

        {search.searching && !shown ? <LoadingState /> : null}
        {/* A ledger that cannot be reached is a note, not a blocked screen:
            the desk still has to be able to register someone. */}
        {search.error ? <Notice tone="danger">{search.error}</Notice> : null}


        {/* No column sorts: Field lists the ledger in one fixed order and
            sorting one page of it would not sort the ledger (PLT-4746). */}
        {shown && (!search.error || shown.candidates.length > 0) ? (
          <DataTable
            rows={shown.candidates}
            columns={columns}
            rowKey={customer => customer.id}
            onRowClick={customer => navigate(`golf/customers/${customer.id}`)}
            pageSize={LEDGER_PAGE_SIZE}
            server={{
              page: pageIndex,
              onPageChange: setPageIndex,
              total: shown.total ?? undefined,
              // Without a count, a full page is the only sign of another one.
              hasMore: shown.candidates.length >= LEDGER_PAGE_SIZE,
              loading: search.searching,
            }}
            empty={(
              <EmptyState
                title={trimmedTerm
                  ? t('customers:search.noMatchesTitle', { term: trimmedTerm })
                  : t('customers:search.emptyLedgerTitle')}
                description={trimmedTerm
                  ? t('customers:search.noMatches', {
                    term: trimmedTerm,
                    condition: searchCondition,
                  })
                  : t('customers:search.emptyLedger')}
              />
            )}
          />
        ) : null}
      </Panel>

      <NewCustomerSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={customer => {
          setCreating(false)
          // Search for what was just registered rather than opening it. There is
          // no "list everyone" here, so a desk that got sent to the new page and
          // came back would find an empty box and no sign the person was saved.
          // Their row underneath the search is that sign — and the next visitor
          // can be registered without navigating back.
          setTerm(customer.name)
        }}
      />
    </div>
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
      clearResourceCache('customers:search:')
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
