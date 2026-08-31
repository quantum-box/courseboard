import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { CheckCircle2, ChevronLeft, FileScan, Plus, RefreshCw, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  EmptyState,
  Field,
  LoadingState,
  Notice,
  Panel,
  resourceErrorText,
} from '../../../../components/Page'
import { navigate, navigateFromClick } from '../../../../lib/router'
import { showToast } from '../../../../lib/toast'
import { draftReceptionSheet, registerReceptionRow } from './api'
import {
  blankRow,
  canRegister,
  blockedReason,
  duplicateNameKeys,
  fileValidationError,
  isConsentCorrected,
  isCorrected,
  prepareReceptionSheet,
  previewKind,
  pendingRows,
  receptionReadFailure,
  rowsFromDraft,
  savedCount,
  RECEPTION_CONSENT_KEYS,
  RECEPTION_SHEET_ACCEPT,
  REQUIRED_RECEPTION_CONSENT,
  type ReceptionConsentKey,
  type ReceptionFieldKey,
  type ReceptionRow,
} from './models'

/**
 * Registering a group off the paper it arrived on.
 *
 * Two columns because the work is comparison: the scan on the right, the rows
 * read out of it on the left, and every proposed value beside the original that
 * produced it. A read that is only ever checked against itself is a read nobody
 * can defend when the member says their name is spelled differently.
 *
 * Nothing is written until the desk registers a row. The reader returns a
 * draft, which is why a misread stays a misread on screen instead of becoming a
 * second ledger entry for somebody who already has one.
 */
export function ReceptionPage() {
  const { t } = useTranslation(['customers', 'common'])
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [rows, setRows] = useState<ReceptionRow[]>([])
  const [registeringAll, setRegisteringAll] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const addedRowsRef = useRef(0)

  // The preview is an object URL over the file the desk picked; it is revoked
  // when the file changes so a morning of scans does not accumulate blobs.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const duplicates = useMemo(() => duplicateNameKeys(rows), [rows])
  const pending = pendingRows(rows)
  const saved = savedCount(rows)

  function updateRow(key: string, patch: Partial<ReceptionRow>) {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
  }

  async function read(picked: File) {
    setRows([])
    setWarnings([])
    setReadError(null)
    setReading(true)
    try {
      // Converting a phone photo can take a second on a large image, so the
      // screen is already in its reading state before it starts.
      let next: File
      try {
        next = await prepareReceptionSheet(picked)
      } catch {
        setFile(null)
        setReadError(t('customers:reception.file.convert'))
        return
      }
      const invalid = fileValidationError(next)
      if (invalid) {
        setFile(null)
        setReadError(t(`customers:reception.file.${invalid}`))
        return
      }
      setFile(next)
      const draft = await draftReceptionSheet(next)
      setRows(rowsFromDraft(draft))
      setWarnings(draft.warnings ?? [])
    } catch (error) {
      setRows([])
      // A reader that never ran is not a sheet that could not be read. Saying
      // so is the whole point: the generic copy would send the desk back to
      // the scanner for an outage no photograph can fix, which is exactly what
      // happened while an upstream 402 was arriving as an empty draft.
      const failure = receptionReadFailure(error)
      setReadError(
        failure
          ? t(`customers:reception.readerFailure.${failure}`)
          : resourceErrorText(error),
      )
    } finally {
      setReading(false)
    }
  }

  async function register(row: ReceptionRow) {
    if (!canRegister(row)) return
    updateRow(row.key, { status: 'saving', error: undefined })
    try {
      // The row's position on screen is its line on the paper — rows are added
      // to the end, never reordered — so it is what makes the entry traceable
      // back to the sheet once the sheet is gone.
      const created = await registerReceptionRow(
        row,
        rows.findIndex(candidate => candidate.key === row.key),
      )
      updateRow(row.key, {
        status: 'saved',
        customerId: created.id,
        // Saved either way: the person is in the ledger. Registering again to
        // "fix" the consents would put a second one there.
        consentsMissing: created.consentsRecorded === false,
      })
    } catch (error) {
      updateRow(row.key, { status: 'pending', error: resourceErrorText(error) })
      throw error
    }
  }

  async function registerAll() {
    setRegisteringAll(true)
    let registered = 0
    try {
      // One at a time, in sheet order: the ledger has no bulk write, and a
      // group registered in parallel comes back in an order nobody can match
      // against the paper when one of them fails.
      for (const row of pendingRows(rows)) {
        try {
          await register(row)
          registered += 1
        } catch {
          // The row keeps its own message; the run continues so one bad
          // address does not strand the three players behind it.
        }
      }
    } finally {
      setRegisteringAll(false)
    }
    if (registered > 0) {
      showToast({
        tone: 'success',
        message: t('customers:reception.rows.registeredCount', { count: registered }),
      })
    }
  }

  const busy = reading || registeringAll

  return (
    <div className="page-stack">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={event => navigateFromClick(event, 'golf/customers')}
      >
        <ChevronLeft />
        {t('customers:reception.back')}
      </Button>

      <Panel
        title={t('customers:reception.title')}
        description={t('customers:reception.description')}
        actions={(
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={RECEPTION_SHEET_ACCEPT}
              className="visually-hidden-input"
              onChange={event => {
                const next = event.target.files?.[0]
                // Reset so picking the same scan twice still fires a change.
                event.target.value = ''
                if (next) void read(next)
              }}
            />
            <Button
              type="button"
              variant={file ? 'ghost' : 'primary'}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? <RefreshCw /> : <Upload />}
              {file ? t('customers:reception.choose.again') : t('customers:reception.choose.open')}
            </Button>
          </>
        )}
      >
        <p className="reception-hint">{t('customers:reception.choose.hint')}</p>
        {readError ? <Notice tone="danger">{readError}</Notice> : null}
        {/* Said once, above the rows: a partial read looks exactly like a
            complete one, and this is the only thing that sends the desk back
            to the paper. */}
        {warnings.map(warning => (
          <Notice key={warning} tone="warning">{warning}</Notice>
        ))}
      </Panel>

      {reading ? <LoadingState label={t('customers:reception.reading')} /> : null}

      {!file && !reading ? (
        <Panel>
          <EmptyState
            title={t('customers:reception.empty.title')}
            description={t('customers:reception.empty.description')}
            action={(
              <Button type="button" variant="primary" onClick={() => fileInputRef.current?.click()}>
                <FileScan />
                {t('customers:reception.choose.open')}
              </Button>
            )}
          />
        </Panel>
      ) : null}

      {file && !reading ? (
        <div className="reception-workspace">
          <Panel
            className="reception-rows"
            title={t('customers:reception.rows.title')}
            description={t('customers:reception.rows.description')}
            actions={(
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    addedRowsRef.current += 1
                    setRows(current => [...current, blankRow(`added-${addedRowsRef.current}`)])
                  }}
                >
                  <Plus />
                  {t('customers:reception.rows.add')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy || pending.length === 0}
                  onClick={() => void registerAll()}
                >
                  {registeringAll
                    ? t('common:action.saving')
                    : t('customers:reception.rows.registerAll', { count: pending.length })}
                </Button>
              </>
            )}
          >
            {saved > 0 ? (
              <p className="reception-hint">
                {t('customers:reception.rows.savedSoFar', { count: saved })}
              </p>
            ) : null}

            {rows.length === 0 ? (
              <EmptyState
                title={t('customers:reception.rows.emptyTitle')}
                description={t('customers:reception.rows.emptyDescription')}
              />
            ) : null}

            <ol className="reception-row-list">
              {rows.map((row, index) => (
                <ReceptionRowCard
                  key={row.key}
                  row={row}
                  index={index}
                  duplicate={duplicates.has(row.key)}
                  disabled={busy}
                  onChange={patch => updateRow(row.key, patch)}
                  onRegister={() => void register(row).catch(() => {})}
                />
              ))}
            </ol>
          </Panel>

          <Panel
            className="reception-preview"
            title={t('customers:reception.preview.title')}
            description={t('customers:reception.preview.description')}
          >
            {previewUrl && previewKind(file) === 'pdf' ? (
              <iframe
                className="reception-preview-frame"
                src={previewUrl}
                title={t('customers:reception.preview.title')}
              />
            ) : null}
            {previewUrl && previewKind(file) === 'image' ? (
              <img
                className="reception-preview-image"
                src={previewUrl}
                alt={t('customers:reception.preview.alt')}
              />
            ) : null}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

const ROW_FIELDS: readonly { key: ReceptionFieldKey; requirement: 'required' | 'optional' }[] = [
  { key: 'name', requirement: 'required' },
  { key: 'nameKana', requirement: 'optional' },
  { key: 'phone', requirement: 'optional' },
  { key: 'email', requirement: 'optional' },
]

const CONSENT_LABEL = {
  golf_antisocial_and_course_terms: 'customers:reception.consents.antisocialAndCourseTerms',
  golf_cart_terms: 'customers:reception.consents.cartTerms',
  golf_marketing_contact: 'customers:reception.consents.marketingContact',
} as const satisfies Record<ReceptionConsentKey, string>

const FIELD_LABEL = {
  name: 'customers:field.name',
  nameKana: 'customers:field.nameKana',
  phone: 'customers:field.phone',
  email: 'customers:field.email',
} as const satisfies Record<ReceptionFieldKey, string>

/**
 * One person from the sheet.
 *
 * The read value sits under each input rather than in a second column: the
 * desk's eye is already on the field it is correcting, and a value it has to
 * look away to find is a value nobody checks.
 */
function ReceptionRowCard({
  row,
  index,
  duplicate,
  disabled,
  onChange,
  onRegister,
}: {
  row: ReceptionRow
  index: number
  duplicate: boolean
  disabled: boolean
  onChange: (patch: Partial<ReceptionRow>) => void
  onRegister: () => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const saved = row.status === 'saved'
  const blocked = blockedReason(row)

  return (
    <li className={`reception-row${saved ? ' reception-row-saved' : ''}`}>
      <div className="reception-row-head">
        <strong>{t('customers:reception.rows.person', { index: String(index + 1) })}</strong>
        {saved ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden="true" />
            {t('customers:reception.rows.saved')}
          </Badge>
        ) : null}
        {duplicate && !saved ? (
          <Badge variant="outline">{t('customers:reception.rows.duplicate')}</Badge>
        ) : null}
      </div>

      <div className="reception-row-fields">
        {ROW_FIELDS.map(({ key, requirement }) => (
          <Field key={key} label={t(FIELD_LABEL[key])} requirement={requirement}>
            <Input
              value={row[key]}
              disabled={disabled || saved || row.status === 'saving'}
              onChange={event => onChange({ [key]: event.target.value } as Partial<ReceptionRow>)}
            />
            {/* Only where it differs: repeating an untouched value under every
                field turns the one changed row into noise. */}
            {isCorrected(row, key) ? (
              <span className="reception-read-value">
                {t('customers:reception.rows.readAs', { value: row.read[key] })}
              </span>
            ) : null}
          </Field>
        ))}
      </div>

      <div className="reception-row-consents">
        {RECEPTION_CONSENT_KEYS.map(key => {
          const answer = row.consents[key]
          return (
            <label key={key} className="reception-consent">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={answer === true}
                disabled={disabled || saved || row.status === 'saving'}
                onChange={event =>
                  onChange({ consents: { ...row.consents, [key]: event.target.checked } })
                }
              />
              <span className="reception-consent-label">
                {t(CONSENT_LABEL[key])}
                {key === REQUIRED_RECEPTION_CONSENT ? (
                  <Badge variant="outline">{t('customers:reception.consents.required')}</Badge>
                ) : null}
              </span>
              {/* An unread box and a refused box look identical once they are
                  both an empty checkbox. Saying which is which is the whole
                  reason the reader's answer is kept beside the desk's. */}
              {answer === null ? (
                <span className="reception-read-value">
                  {t('customers:reception.consents.unread')}
                </span>
              ) : isConsentCorrected(row, key) ? (
                <span className="reception-read-value">
                  {t('customers:reception.consents.readAs', {
                    value: t(
                      row.readConsents[key] === null
                        ? 'customers:reception.consents.readUnread'
                        : row.readConsents[key]
                          ? 'customers:reception.consents.readTicked'
                          : 'customers:reception.consents.readBlank',
                    ),
                  })}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>

      {blocked === 'declaration' && !saved ? (
        <Notice tone="warning">{t('customers:reception.consents.blocked')}</Notice>
      ) : null}
      {row.consentsMissing ? (
        <Notice tone="danger">{t('customers:reception.consents.notFiled')}</Notice>
      ) : null}
      {row.error ? <Notice tone="danger">{row.error}</Notice> : null}

      <div className="reception-row-actions">
        {saved && row.customerId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`golf/customers/${encodeURIComponent(row.customerId ?? '')}`)}
          >
            {t('customers:reception.rows.openCustomer')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || !canRegister(row) || row.status === 'saving'}
            onClick={onRegister}
          >
            {row.status === 'saving' ? t('common:action.saving') : t('customers:reception.rows.register')}
          </Button>
        )}
      </div>
    </li>
  )
}
