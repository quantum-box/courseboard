import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  FileScan,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  ScanLine,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  EmptyState,
  Field,
  LoadingState,
  NativeSelect,
  NativeTextarea,
  Notice,
  Panel,
  ResourceError,
  resourceErrorText,
} from '../../../../components/Page'
import { useResource } from '../../../../hooks/useResource'
import { navigate, navigateFromClick } from '../../../../lib/router'
import { showToast } from '../../../../lib/toast'
import { autoOrientReceptionSheet, rotateReceptionSheet, type ReceptionRotation } from './orientation'
import {
  analyzeReceptionForm,
  createReceptionConsentItem,
  draftReceptionSheets,
  listReceptionConsentItems,
  listReceptionFields,
  registerReceptionRow,
  retryReceptionValues,
  ReceptionBatchError,
  saveReceptionFields,
} from './api'
import {
  blankRow,
  applyReceptionFormProposal,
  canRegister,
  blockedReason,
  duplicateNameKeys,
  fileValidationError,
  isConsentCorrected,
  isStandardReceptionFieldKey,
  isReceptionFieldCorrected,
  missingRequiredConsentItems,
  missingRequiredFields,
  prepareReceptionSheet,
  prepareReceptionSheets,
  previewKind,
  pendingRows,
  receptionFieldLabel,
  receptionFieldDefaultLabel,
  receptionReadFailure,
  receptionPreviewImageSrc,
  receptionRowReadValue,
  receptionRowValue,
  updateReceptionRowField,
  valueText,
  DEFAULT_RECEPTION_FIELDS,
  DEFAULT_RECEPTION_CONSENT_ITEMS,
  activeReceptionConsentItems,
  type ReceptionAddress,
  type ReceptionDraft,
  type ReceptionConsentCandidate,
  type ReceptionConsentItem,
  type ReceptionConsentItemWriteInput,
  type ReceptionField,
  type ReceptionFieldValue,
  type ReceptionFieldType,
  rowsFromDraft,
  savedCount,
  sheetsValidationError,
  MAX_RECEPTION_SHEETS,
  RECEPTION_SHEET_ACCEPT,
  type ReceptionConsentKey,
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
  const fieldSettings = useResource(
    () => listReceptionFields(),
    [],
    { cacheKey: 'course:customer-reception-fields' },
  )
  const consentSettings = useResource(
    () => listReceptionConsentItems(),
    [],
    { cacheKey: 'course:customer-consent-items-active' },
  )
  const [files, setFiles] = useState<File[]>([])
  const [orientationSources, setOrientationSources] = useState<File[]>([])
  const [manualRotations, setManualRotations] = useState<ReceptionRotation[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [readProgress, setReadProgress] = useState<{ current: number; total: number } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [batchResume, setBatchResume] = useState<{
    files: File[]
    nextBatchIndex: number
    draft: ReceptionDraft
  } | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [rows, setRows] = useState<ReceptionRow[]>([])
  const [registeringAll, setRegisteringAll] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const addedRowsRef = useRef(0)

  // The previews are object URLs over the files the desk picked; they are
  // revoked when the files change so a morning of scans does not accumulate
  // blobs.
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file))
    setPreviewUrls(urls)
    return () => urls.forEach(url => URL.revokeObjectURL(url))
  }, [files])

  const duplicates = useMemo(() => duplicateNameKeys(rows), [rows])
  const receptionFields = fieldSettings.data ?? DEFAULT_RECEPTION_FIELDS
  const receptionConsentItems = activeReceptionConsentItems(
    consentSettings.data ?? DEFAULT_RECEPTION_CONSENT_ITEMS,
  )
  const pending = pendingRows(rows, receptionFields, receptionConsentItems)
  const saved = savedCount(rows)

  function updateRow(key: string, patch: Partial<ReceptionRow>) {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
  }

  function receptionDraftOptions() {
    return {
      onBatchProgress: (current: number, total: number) => setReadProgress({ current, total }),
      formatBatchWarning: (warning: string, firstSheet: number, lastSheet: number) => t(
        'customers:reception.batchWarning',
        { warning, firstSheet: String(firstSheet), lastSheet: String(lastSheet) },
      ),
      formatRowLimitWarning: (maxRows: number) => t(
        'customers:reception.rowLimitWarning',
        { count: maxRows },
      ),
    }
  }

  function handleBatchFailure(
    error: unknown,
    sourceFiles: File[],
    previousDraft?: ReceptionDraft,
  ): error is ReceptionBatchError {
    if (!(error instanceof ReceptionBatchError)) return false
    const newVisitors = error.partialDraft.visitors.slice(previousDraft?.visitors.length ?? 0)
    const newRows = rowsFromDraft(
      { ...error.partialDraft, visitors: newVisitors },
      receptionFields,
      receptionConsentItems,
      previousDraft?.visitors.length ?? 0,
    )
    if (previousDraft) {
      setRows(current => [...current, ...newRows])
    } else {
      setRows(newRows)
    }
    setWarnings(error.partialDraft.warnings ?? [])
    setBatchResume({
      files: sourceFiles,
      nextBatchIndex: error.nextBatchIndex,
      draft: error.partialDraft,
    })
    return true
  }

  function readErrorMessage(error: unknown) {
    const failure = receptionReadFailure(error)
    if (failure === 'billing') return t('customers:reception.readerFailure.billing')
    if (failure === 'rateLimited') return t('customers:reception.readerFailure.rateLimited')
    if (failure === 'unavailable') return t('customers:reception.readerFailure.unavailable')
    return resourceErrorText(error)
  }

  async function read(picked: File[]) {
    setBatchResume(null)
    setRows([])
    setWarnings([])
    setReadError(null)
    setReadProgress(null)
    // Refuse an oversized selection before decoding any of its photos.
    if (picked.length > MAX_RECEPTION_SHEETS) {
      setFiles([])
      setOrientationSources([])
      setManualRotations([])
      setReadError(t('customers:reception.file.count', { count: MAX_RECEPTION_SHEETS }))
      return
    }
    setReading(true)
    setFiles([])
    setOrientationSources([])
    setManualRotations([])
    let next: File[] = []
    try {
      // Converting phone photos can take a second each on large images, so the
      // screen is already in its reading state before it starts.
      try {
        next = await prepareReceptionSheets(picked)
      } catch {
        setFiles([])
        setReadError(t('customers:reception.file.convert'))
        return
      }
      try {
        const oriented: File[] = []
        for (const file of next) oriented.push(await autoOrientReceptionSheet(file))
        next = oriented
        next = await prepareReceptionSheets(next)
      } catch {
        setFiles([])
        setReadError(t('customers:reception.file.orientationFailed'))
        return
      }
      const invalid = sheetsValidationError(next)
      if (invalid) {
        setFiles([])
        setReadError(t(`customers:reception.file.${invalid}`, { count: MAX_RECEPTION_SHEETS }))
        return
      }
      setFiles(next)
      setOrientationSources(next)
      setManualRotations(next.map(() => 0 as const))
      const draft = await draftReceptionSheets(next, receptionDraftOptions())
      setRows(rowsFromDraft(draft, receptionFields, receptionConsentItems))
      setWarnings(draft.warnings ?? [])
    } catch (error) {
      if (!handleBatchFailure(error, next)) setRows([])
      // A reader that never ran is not a sheet that could not be read. Saying
      // so is the whole point: the generic copy would send the desk back to
      // the scanner for an outage no photograph can fix, which is exactly what
      // happened while an upstream 402 was arriving as an empty draft.
      const readError = error instanceof ReceptionBatchError ? error.originalError : error
      const failure = receptionReadFailure(readError)
      setReadError(
        failure
          ? t(`customers:reception.readerFailure.${failure}`)
          : resourceErrorText(error),
      )
    } finally {
      setReading(false)
      setReadProgress(null)
    }
  }

  async function rotateSheet(index: number, step: -90 | 90) {
    if (rotationLocked || !orientationSources[index]) return
    const currentRotation = manualRotations[index] ?? 0
    const nextRotation = ((currentRotation + step + 360) % 360) as ReceptionRotation
    setBatchResume(null)
    setRows([])
    setWarnings([])
    setReadError(null)
    setReadProgress(null)
    setReading(true)

    let turned: File[]
    try {
      turned = await Promise.all(orientationSources.map((source, page) => {
        const rotation = page === index ? nextRotation : manualRotations[page] ?? 0
        return rotation === 0 ? source : rotateReceptionSheet(source, rotation)
      }))
      turned = await prepareReceptionSheets(turned)
    } catch {
      setReadError(t('customers:reception.file.orientationFailed'))
      setReading(false)
      return
    }

    const invalid = sheetsValidationError(turned)
    if (invalid) {
      setReadError(t(`customers:reception.file.${invalid}`, { count: MAX_RECEPTION_SHEETS }))
      setReading(false)
      return
    }
    setFiles(turned)
    setManualRotations(current => current.map((rotation, page) => (
      page === index ? nextRotation : rotation
    )))

    try {
      const draft = await draftReceptionSheets(turned, receptionDraftOptions())
      setRows(rowsFromDraft(draft, receptionFields, receptionConsentItems))
      setWarnings(draft.warnings ?? [])
    } catch (error) {
      if (!handleBatchFailure(error, turned)) setRows([])
      const readError = error instanceof ReceptionBatchError ? error.originalError : error
      const failure = receptionReadFailure(readError)
      setReadError(
        failure
          ? t(`customers:reception.readerFailure.${failure}`)
          : resourceErrorText(error),
      )
    } finally {
      setReading(false)
      setReadProgress(null)
    }
  }

  async function retryRemainingBatches() {
    const resume = batchResume
    if (!resume || busy) return
    setReadError(null)
    setReadProgress(null)
    setReading(true)
    try {
      const draft = await draftReceptionSheets(
        resume.files,
        receptionDraftOptions(),
        { draft: resume.draft, nextBatchIndex: resume.nextBatchIndex },
      )
      const newVisitors = draft.visitors.slice(resume.draft.visitors.length)
      const newRows = rowsFromDraft(
        { ...draft, visitors: newVisitors },
        receptionFields,
        receptionConsentItems,
        resume.draft.visitors.length,
      )
      setRows(current => [...current, ...newRows])
      setWarnings(draft.warnings ?? [])
      setBatchResume(null)
    } catch (error) {
      if (!handleBatchFailure(error, resume.files, resume.draft)) {
        setBatchResume(resume)
      }
      const underlyingError = error instanceof ReceptionBatchError ? error.originalError : error
      setReadError(readErrorMessage(underlyingError))
    } finally {
      setReading(false)
      setReadProgress(null)
    }
  }

  async function register(row: ReceptionRow) {
    if (!canRegister(row, receptionFields, receptionConsentItems)) return
    updateRow(row.key, { status: 'saving', error: undefined })
    try {
      // The row's position on screen is its line on the paper — rows are added
      // to the end, never reordered — so it is what makes the entry traceable
      // back to the sheet once the sheet is gone.
      const created = await registerReceptionRow(
        row,
        rows.findIndex(candidate => candidate.key === row.key),
        receptionFields,
        receptionConsentItems,
      )
      updateRow(row.key, {
        status: 'saved',
        customerId: created.id,
        // Saved either way: the person is in the ledger. Registering again to
        // "fix" the consents would put a second one there.
        consentsMissing: created.consentsRecorded === false,
        customFieldsMissing: created.customFieldsRecorded === false,
      })
    } catch (error) {
      updateRow(row.key, { status: 'pending', error: resourceErrorText(error) })
      throw error
    }
  }

  async function retryCustomValues(row: ReceptionRow) {
    if (!row.customerId) return
    updateRow(row.key, { customFieldsRetrying: true, error: undefined })
    try {
      await retryReceptionValues(row.customerId, row, receptionFields)
      updateRow(row.key, { customFieldsRetrying: false, customFieldsMissing: false })
    } catch (error) {
      updateRow(row.key, { customFieldsRetrying: false, error: resourceErrorText(error) })
    }
  }

  async function registerAll() {
    setRegisteringAll(true)
    let registered = 0
    try {
      // One at a time, in sheet order: the ledger has no bulk write, and a
      // group registered in parallel comes back in an order nobody can match
      // against the paper when one of them fails.
      for (const row of pendingRows(rows, receptionFields, receptionConsentItems)) {
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

  const busy = reading
    || registeringAll
    || fieldSettings.loading
    || Boolean(fieldSettings.error)
    || consentSettings.loading
    || Boolean(consentSettings.error)
  const rotationLocked = busy || saved > 0 || rows.some(row => row.status === 'saving')

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
              multiple
              accept={RECEPTION_SHEET_ACCEPT}
              className="visually-hidden-input"
              onChange={event => {
                // In the order the picker hands them over, which is the order
                // the rows come back in.
                const next = Array.from(event.target.files ?? [])
                // Reset so picking the same scans twice still fires a change.
                event.target.value = ''
                if (next.length > 0) void read(next)
              }}
            />
            <Button
              type="button"
              variant={files.length > 0 ? 'ghost' : 'primary'}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {files.length > 0 ? <RefreshCw /> : <Upload />}
              {files.length > 0
                ? t('customers:reception.choose.again')
                : t('customers:reception.choose.open')}
            </Button>
          </>
        )}
      >
        <p className="reception-hint">{t('customers:reception.choose.hint')}</p>
        {readError ? <Notice tone="danger">{readError}</Notice> : null}
        {batchResume && !reading ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void retryRemainingBatches()}
          >
            <RefreshCw />
            {t('customers:reception.retryRemaining')}
          </Button>
        ) : null}
        {/* Said once, above the rows: a partial read looks exactly like a
            complete one, and this is the only thing that sends the desk back
            to the paper. */}
        {warnings.map(warning => (
          <Notice key={warning} tone="warning">{warning}</Notice>
        ))}
      </Panel>

      {fieldSettings.error ? (
        <ResourceError error={fieldSettings.error} onRetry={() => void fieldSettings.refresh()} />
      ) : null}
      {consentSettings.error ? (
        <ResourceError
          error={consentSettings.error}
          onRetry={() => void consentSettings.refresh()}
        />
      ) : null}

      {reading ? (
        <LoadingState
          label={readProgress && readProgress.total > 1
            ? t('customers:reception.readingBatch', {
                current: String(readProgress.current),
                total: String(readProgress.total),
              })
            : t('customers:reception.reading')}
        />
      ) : null}

      {files.length === 0 && !reading ? (
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

      {files.length > 0 && !reading ? (
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
                    setRows(current => [
                      ...current,
                      blankRow(
                        `added-${addedRowsRef.current}`,
                        receptionFields,
                        receptionConsentItems,
                      ),
                    ])
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
                  fields={receptionFields}
                  consentItems={receptionConsentItems}
                  index={index}
                  duplicate={duplicates.has(row.key)}
                  disabled={busy}
                  onChange={patch => updateRow(row.key, patch)}
                  onRegister={() => void register(row).catch(() => {})}
                  onRetryCustomValues={() => void retryCustomValues(row)}
                />
              ))}
            </ol>
          </Panel>

          <Panel
            className="reception-preview"
            title={t('customers:reception.preview.title')}
            description={t('customers:reception.preview.description')}
          >
            <div className="reception-preview-list">
              {files.map((file, index) => {
                const url = previewUrls[index]
                if (!url) return null
                // Numbered only when there is more than one, so a single sheet
                // looks the way it always did.
                const label = files.length > 1
                  ? t('customers:reception.preview.page', { index: String(index + 1), total: String(files.length) })
                  : null
                return (
                  <figure key={url} className="reception-preview-page">
                    {label ? <figcaption className="reception-hint">{label}</figcaption> : null}
                    <div className="reception-preview-page-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('customers:reception.preview.rotateLeft', { index: String(index + 1) })}
                        disabled={rotationLocked}
                        onClick={() => void rotateSheet(index, -90)}
                      >
                        <RotateCcw />
                        {t('customers:reception.preview.rotateLeftShort')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('customers:reception.preview.rotateRight', { index: String(index + 1) })}
                        disabled={rotationLocked}
                        onClick={() => void rotateSheet(index, 90)}
                      >
                        <RotateCw />
                        {t('customers:reception.preview.rotateRightShort')}
                      </Button>
                    </div>
                    {previewKind(file) === 'pdf' ? (
                      <iframe
                        className="reception-preview-frame"
                        src={url}
                        loading="lazy"
                        title={label ?? t('customers:reception.preview.title')}
                      />
                    ) : (
                      <img
                        className="reception-preview-image"
                        src={url}
                        loading="lazy"
                        alt={label
                          ? `${t('customers:reception.preview.alt')} (${label})`
                          : t('customers:reception.preview.alt')}
                      />
                    )}
                  </figure>
                )
              })}
            </div>
            {saved > 0 ? (
              <p className="reception-hint">{t('customers:reception.preview.rotationLocked')}</p>
            ) : null}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u

const FIELD_TYPE_OPTIONS = [
  'text',
  'date',
  'select',
  'boolean',
] as const satisfies readonly ReceptionFieldType[]

type ReceptionFieldDraft = ReceptionField & { editorKey: string }

let receptionFieldEditorSequence = 0

function nextReceptionFieldEditorKey() {
  receptionFieldEditorSequence += 1
  return `reception-field-editor-${receptionFieldEditorSequence}`
}

function cloneReceptionFields(fields: readonly ReceptionField[]): ReceptionFieldDraft[] {
  return fields.map(field => ({
    ...field,
    editorKey: 'editorKey' in field && typeof field.editorKey === 'string'
      ? field.editorKey
      : nextReceptionFieldEditorKey(),
    options: [...field.options],
  }))
}

function settingsEqual(left: readonly ReceptionField[], right: readonly ReceptionField[]) {
  const settings = (fields: readonly ReceptionField[]) => fields.map(field => {
    const { editorKey: _editorKey, ...setting } = field as ReceptionField & { editorKey?: string }
    return setting
  })
  return JSON.stringify(settings(left)) === JSON.stringify(settings(right))
}

function customFieldKeyIsInvalid(fields: readonly ReceptionField[]) {
  const custom = fields.filter(field => field.kind === 'custom')
  const keys = custom.map(field => field.fieldKey.trim())
  return keys.some(key => !CUSTOM_FIELD_KEY_PATTERN.test(key))
    || keys.some(key => isStandardReceptionFieldKey(key))
    || new Set(keys).size !== keys.length
}

/**
 * Settings for the sheet live under the Settings hub, away from the morning
 * reception workflow. The editor deliberately sends the complete list:
 * the API treats PUT as a replacement and the server merges missing defaults
 * back in, so a newly added standard field cannot disappear from old tenants.
 */
export function ReceptionFieldSettingsPanel({
  fields,
  consentItems = DEFAULT_RECEPTION_CONSENT_ITEMS,
  consentItemsLoading = false,
  consentItemsError = null,
  onRetryConsentItems,
  onConsentItemsCreated,
  loading,
  error,
  onRetry,
  onSaved,
}: {
  fields: readonly ReceptionField[]
  consentItems?: readonly ReceptionConsentItem[]
  consentItemsLoading?: boolean
  consentItemsError?: unknown
  onRetryConsentItems?: () => void
  onConsentItemsCreated?: (items: readonly ReceptionConsentItem[]) => void
  loading: boolean
  error: unknown
  onRetry: () => void
  onSaved: (fields: readonly ReceptionField[]) => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const [drafts, setDrafts] = useState<ReceptionFieldDraft[]>(() => cloneReceptionFields(fields))
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [creatingConsentItems, setCreatingConsentItems] = useState(false)
  const [proposalActive, setProposalActive] = useState(false)
  const [proposedConsentItems, setProposedConsentItems] = useState<ReceptionConsentCandidate[]>([])
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([])
  const [analysisPreview, setAnalysisPreview] = useState<string | null>(null)
  const [analysisFile, setAnalysisFile] = useState<File | null>(null)
  const [analysisDisplayFile, setAnalysisDisplayFile] = useState<File | null>(null)
  const [analysisDisplayUrl, setAnalysisDisplayUrl] = useState<{
    file: File
    url: string
  } | null>(null)
  const [analysisRotation, setAnalysisRotation] = useState<ReceptionRotation>(0)
  const analysisInputRef = useRef<HTMLInputElement | null>(null)
  const proposalSnapshotRef = useRef<ReceptionFieldDraft[] | null>(null)
  const analysisLocalPreviewUrl = analysisDisplayUrl?.file === analysisDisplayFile
    ? analysisDisplayUrl.url
    : null

  useEffect(() => {
    if (!analysisDisplayFile || typeof URL.createObjectURL !== 'function') {
      setAnalysisDisplayUrl(null)
      return
    }
    const url = URL.createObjectURL(analysisDisplayFile)
    setAnalysisDisplayUrl({ file: analysisDisplayFile, url })
    return () => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
    }
  }, [analysisDisplayFile])

  useEffect(() => {
    setDrafts(cloneReceptionFields(fields))
    setProposalActive(false)
    setAnalysisWarnings([])
    setAnalysisPreview(null)
    setAnalysisFile(null)
    setAnalysisDisplayFile(null)
    setAnalysisRotation(0)
    setProposedConsentItems([])
    proposalSnapshotRef.current = null
  }, [fields])

  // A refresh may arrive after a POST whose response was lost. Never keep a
  // candidate visible once Field confirms that its key exists (including an
  // inactive definition).
  useEffect(() => {
    const existingKeys = new Set(consentItems.map(item => item.consentKey))
    setProposedConsentItems(current => {
      const next = current.filter(candidate => !existingKeys.has(candidate.consentKey))
      return next.length === current.length ? current : next
    })
  }, [consentItems])

  const dirty = !settingsEqual(drafts, fields)
  const invalidCustomKey = customFieldKeyIsInvalid(drafts)
  const standard = drafts.filter(field => field.kind === 'standard')
  const custom = drafts.filter(field => field.kind === 'custom')
  const changing = saving || analyzing || creatingConsentItems
  const canCreateConsentItems = !consentItemsLoading && !consentItemsError

  function update(editorKey: string, patch: Partial<ReceptionField>) {
    setDrafts(current => current.map(field => (
      field.editorKey === editorKey ? { ...field, ...patch } : field
    )))
  }

  function addCustomField() {
    const existing = new Set(custom.map(field => field.fieldKey))
    let number = custom.length + 1
    let fieldKey = `custom_field_${number}`
    while (existing.has(fieldKey)) {
      number += 1
      fieldKey = `custom_field_${number}`
    }
    setDrafts(current => [
      ...current,
      {
        fieldKey,
        kind: 'custom',
        fieldType: 'text',
        enabled: true,
        required: false,
        label: '',
        customLabel: false,
        sortOrder: current.length,
        options: [],
        editorKey: nextReceptionFieldEditorKey(),
      },
    ])
  }

  function removeCustomField(editorKey: string) {
    setDrafts(current => current.filter(field => field.editorKey !== editorKey))
  }

  function moveCustomField(editorKey: string, delta: number) {
    setDrafts(current => {
      const indexes = current
        .map((field, index) => (field.kind === 'custom' ? index : -1))
        .filter(index => index >= 0)
      const index = current.findIndex(field => field.editorKey === editorKey)
      const customPosition = indexes.indexOf(index)
      const target = customPosition + delta
      if (customPosition < 0 || target < 0 || target >= indexes.length) return current
      const next = [...current]
      const targetIndex = indexes[target]
      const moved = next[index]
      next[index] = next[targetIndex] as ReceptionFieldDraft
      next[targetIndex] = moved as ReceptionFieldDraft
      return next.map((field, position) => ({ ...field, sortOrder: position }))
    })
  }

  function cancelProposal() {
    const restore = proposalActive && proposalSnapshotRef.current
      ? proposalSnapshotRef.current
      : fields
    setDrafts(cloneReceptionFields(restore))
    setProposalActive(false)
    setAnalysisWarnings([])
    setAnalysisPreview(null)
    setAnalysisFile(null)
    setAnalysisDisplayFile(null)
    setAnalysisRotation(0)
    setProposedConsentItems([])
    proposalSnapshotRef.current = null
  }

  async function analyzeBlankForm(
    picked: File,
    rotation: ReceptionRotation = 0,
    alreadyOriented = false,
  ) {
    const beforeAnalysis = proposalSnapshotRef.current ?? cloneReceptionFields(drafts)
    setAnalyzing(true)
    try {
      let source: File
      try {
        source = alreadyOriented ? picked : await prepareReceptionSheet(picked)
      } catch {
        throw new Error(t('customers:reception.file.convert'))
      }
      if (!alreadyOriented) {
        try {
          source = await autoOrientReceptionSheet(source)
        } catch {
          throw new Error(t('customers:reception.file.orientationFailed'))
        }
      }
      const prepared = rotation === 0 ? source : await rotateReceptionSheet(source, rotation)
      const invalid = fileValidationError(prepared)
      if (invalid) throw new Error(t(`customers:reception.file.${invalid}`))
      if (!analysisFile) {
        // Keep a local recovery preview when the first server request fails.
        setAnalysisFile(source)
        setAnalysisDisplayFile(prepared)
        setAnalysisRotation(rotation)
        setAnalysisPreview(null)
      }
      const proposal = await analyzeReceptionForm(prepared)
      proposalSnapshotRef.current = beforeAnalysis
      setAnalysisFile(source)
      setAnalysisDisplayFile(prepared)
      setAnalysisRotation(rotation)
      setAnalysisPreview(proposal.previewImage ?? null)
      setDrafts(cloneReceptionFields(applyReceptionFormProposal(beforeAnalysis, proposal)))
      const existingConsentKeys = new Set(consentItems.map(item => item.consentKey))
      setProposedConsentItems(proposal.consentItems.filter(
        candidate => !existingConsentKeys.has(candidate.consentKey),
      ))
      setProposalActive(true)
      setAnalysisWarnings(proposal.warnings)
      showToast({ tone: 'success', message: t('customers:reception.analysis.applied') })
    } catch (analysisError) {
      showToast({
        tone: 'danger',
        title: t('customers:reception.analysis.failed'),
        message: resourceErrorText(analysisError),
      })
    } finally {
      setAnalyzing(false)
    }
  }

  /** Create confirmed Field consent definitions one at a time. */
  async function createProposedConsentItems() {
    if (!canCreateConsentItems || proposedConsentItems.length === 0) return
    setCreatingConsentItems(true)
    const remaining: ReceptionConsentCandidate[] = []
    const createdItems: ReceptionConsentItem[] = []
    const firstSortOrder = consentItems.reduce(
      (maximum, item) => Math.max(maximum, item.sortOrder),
      -1,
    ) + 1
    let failure: unknown = null

    try {
      for (const [index, candidate] of proposedConsentItems.entries()) {
        if (failure) {
          remaining.push(candidate)
          continue
        }
        try {
          const input: ReceptionConsentItemWriteInput = {
            body: candidate.body?.trim() || null,
            consentKey: candidate.consentKey,
            label: candidate.label.trim() || candidate.consentKey,
            required: candidate.required,
            sortOrder: firstSortOrder + index,
            termsVersion: '1',
          }
          createdItems.push(await createReceptionConsentItem(input))
        } catch (createError) {
          // A request can commit in Field while its HTTP response is lost. A
          // re-read distinguishes that case from a genuine failure and makes
          // retrying safe instead of repeatedly hitting the duplicate key.
          try {
            const latest = await listReceptionConsentItems({ includeInactive: true })
            const reconciled = latest.find(
              item => item.consentKey === candidate.consentKey,
            )
            if (reconciled) {
              createdItems.push(reconciled)
              continue
            }
          } catch {
            // Keep the original create error; an inconclusive re-read is not a
            // reason to hide the error that the operator can act on.
          }
          failure = createError
          remaining.push(candidate)
        }
      }
    } finally {
      setCreatingConsentItems(false)
    }

    setProposedConsentItems(remaining)
    if (createdItems.length > 0) onConsentItemsCreated?.(createdItems)
    if (failure) {
      showToast({
        tone: 'danger',
        title: t('customers:reception.settings.consentCreateFailed'),
        message: resourceErrorText(failure),
      })
      return
    }
    showToast({
      tone: 'success',
      message: t('customers:reception.settings.consentCreated', {
        count: createdItems.length,
      }),
    })
  }

  async function save() {
    if (invalidCustomKey) return
    setSaving(true)
    try {
      const next = await saveReceptionFields(drafts.map(field => ({
        fieldKey: field.fieldKey.trim(),
        kind: field.kind,
        fieldType: field.fieldType,
        enabled: field.enabled,
        required: field.kind === 'standard' && field.fieldKey === 'name'
          ? true
          : field.required,
        label: field.customLabel ? field.label?.trim() || null : null,
        customLabel: field.customLabel,
        sortOrder: field.sortOrder,
        options: field.fieldType === 'select' ? field.options : [],
      })))
      setDrafts(cloneReceptionFields(next))
      onSaved(next)
      setProposalActive(false)
      setAnalysisWarnings([])
      setAnalysisPreview(null)
      setAnalysisFile(null)
      setAnalysisDisplayFile(null)
      setAnalysisRotation(0)
      setProposedConsentItems([])
      proposalSnapshotRef.current = null
      showToast({ tone: 'success', message: t('customers:reception.settings.saved') })
    } catch (saveError) {
      showToast({
        tone: 'danger',
        title: t('customers:reception.settings.failed'),
        message: resourceErrorText(saveError),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      className="reception-settings"
      title={t('customers:reception.settings.title')}
      description={t('customers:reception.settings.description')}
      actions={(
        <>
          <input
            ref={analysisInputRef}
            id="reception-analysis-file"
            type="file"
            accept={RECEPTION_SHEET_ACCEPT}
            className="visually-hidden-input"
            onChange={event => {
              const next = event.target.files?.[0]
              event.target.value = ''
              if (changing) return
              if (next) void analyzeBlankForm(next)
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={loading || changing}
            onClick={() => analysisInputRef.current?.click()}
          >
            <ScanLine />
            {analyzing
              ? t('customers:reception.analysis.analyzing')
              : t('customers:reception.analysis.choose')}
          </Button>
          {dirty || proposalActive ? (
            <Button
              type="button"
              variant="ghost"
              disabled={changing}
              onClick={cancelProposal}
            >
              <RotateCcw />
              {t('customers:reception.analysis.cancel')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            disabled={!dirty || changing || loading || invalidCustomKey}
            onClick={() => void save()}
          >
            <Save />
            {saving
              ? t('customers:reception.settings.saving')
              : t('customers:reception.settings.save')}
          </Button>
        </>
      )}
    >
      {analysisWarnings.map((warning, index) => (
        <Notice key={`${warning}-${index}`} tone="warning">{warning}</Notice>
      ))}
      {consentItemsError ? (
        <ResourceError
          error={consentItemsError}
          onRetry={onRetryConsentItems ?? (() => undefined)}
        />
      ) : null}
      {consentItemsLoading ? (
        <LoadingState label={t('customers:reception.settings.consentLoading')} />
      ) : null}
      {proposedConsentItems.length > 0 ? (
        <div className="reception-consent-candidates">
          <div className="reception-settings-section-head">
            <div>
              <h3>{t('customers:reception.settings.consentCandidatesTitle')}</h3>
              <p className="reception-settings-hint">
                {t('customers:reception.settings.consentCandidatesHint')}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={changing || !canCreateConsentItems}
              onClick={() => void createProposedConsentItems()}
            >
              {creatingConsentItems
                ? t('customers:reception.settings.consentCreating')
                : t('customers:reception.settings.consentCreate', {
                  count: proposedConsentItems.length,
                })}
            </Button>
          </div>
          <ul className="reception-consent-candidate-list">
            {proposedConsentItems.map(candidate => (
              <li key={candidate.consentKey}>
                <strong>{candidate.label}</strong>
                <small>
                  {candidate.consentKey}
                  {candidate.required
                    ? ` / ${t('customers:reception.consents.required')}`
                    : ''}
                </small>
                {candidate.body ? <span>{candidate.body}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysisFile ? (
        <div className="reception-analysis-preview">
          {analysisDisplayFile && analysisLocalPreviewUrl ? (
            <>
              <p className="reception-settings-hint">
                {t('customers:reception.analysis.sourcePreviewTitle')}
              </p>
              {previewKind(analysisDisplayFile) === 'pdf' ? (
                <iframe
                  className="reception-preview-frame reception-analysis-source-frame"
                  src={analysisLocalPreviewUrl}
                  loading="lazy"
                  title={t('customers:reception.analysis.sourcePreviewTitle')}
                />
              ) : (
                <img
                  className="reception-preview-image"
                  src={analysisLocalPreviewUrl}
                  alt={t('customers:reception.analysis.sourcePreviewAlt')}
                />
              )}
            </>
          ) : null}
          <div className="reception-preview-page-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={changing}
              aria-label={t('customers:reception.preview.rotateLeft', { index: '1' })}
              onClick={() => void analyzeBlankForm(
                analysisFile,
                ((analysisRotation + 270) % 360) as ReceptionRotation,
                true,
              )}
            >
              <RotateCcw />
              {t('customers:reception.preview.rotateLeftShort')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={changing}
              aria-label={t('customers:reception.preview.rotateRight', { index: '1' })}
              onClick={() => void analyzeBlankForm(
                analysisFile,
                ((analysisRotation + 90) % 360) as ReceptionRotation,
                true,
              )}
            >
              <RotateCw />
              {t('customers:reception.preview.rotateRightShort')}
            </Button>
          </div>
        </div>
      ) : null}
      {receptionPreviewImageSrc(analysisPreview) ? (
        <div className="reception-analysis-preview">
          <p className="reception-settings-hint">{t('customers:reception.analysis.previewTitle')}</p>
          <img
            src={receptionPreviewImageSrc(analysisPreview) ?? undefined}
            alt={t('customers:reception.analysis.previewAlt')}
          />
        </div>
      ) : null}
      {loading ? <LoadingState label={t('customers:reception.settings.loading')} /> : null}
      {error ? (
        <ResourceError error={error} onRetry={onRetry} />
      ) : null}

      <div className="reception-settings-section">
        <h3>{t('customers:reception.settings.standardTitle')}</h3>
        <p className="reception-settings-hint">{t('customers:reception.settings.standardHint')}</p>
        <div className="reception-settings-table-wrap">
          <table className="reception-settings-table">
            <thead>
              <tr>
                <th>{t('customers:reception.settings.columns.field')}</th>
                <th>{t('customers:reception.settings.columns.enabled')}</th>
                <th>{t('customers:reception.settings.columns.required')}</th>
                <th>{t('customers:reception.settings.columns.label')}</th>
              </tr>
            </thead>
            <tbody>
              {standard.map(field => {
                const alwaysRequired = field.fieldKey === 'name'
                return (
                  <tr key={field.fieldKey}>
                    <td>
                      <strong>{receptionFieldLabel(field)}</strong>
                      <small>{field.fieldKey}</small>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('customers:reception.settings.enableLabel', { field: receptionFieldLabel(field) })}
                        checked={field.enabled}
                        disabled={alwaysRequired || changing}
                        onChange={event => update(field.editorKey, { enabled: event.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('customers:reception.settings.requiredLabel', { field: receptionFieldLabel(field) })}
                        checked={alwaysRequired || field.required}
                        disabled={alwaysRequired || !field.enabled || changing}
                        onChange={event => update(field.editorKey, { required: event.target.checked })}
                      />
                      {alwaysRequired ? (
                        <small>{t('customers:reception.settings.alwaysRequired')}</small>
                      ) : null}
                    </td>
                    <td>
                      <Input
                        aria-label={t('customers:reception.settings.labelLabel', { field: receptionFieldLabel(field) })}
                        value={field.customLabel ? field.label ?? '' : receptionFieldLabel(field)}
                        disabled={changing}
                        onChange={event => update(field.editorKey, {
                          label: event.target.value,
                          customLabel: event.target.value.trim().length > 0,
                        })}
                      />
                      {field.customLabel ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('customers:reception.settings.resetLabel')}
                          disabled={changing}
                          onClick={() => update(field.editorKey, {
                            label: receptionFieldDefaultLabel(field.fieldKey),
                            customLabel: false,
                          })}
                        >
                          <RotateCcw />
                          {t('customers:reception.settings.resetLabel')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="reception-settings-section">
        <div className="reception-settings-section-head">
          <div>
            <h3>{t('customers:reception.settings.customTitle')}</h3>
            <p className="reception-settings-hint">{t('customers:reception.settings.customHint')}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" disabled={changing} onClick={addCustomField}>
            <Plus />
            {t('customers:reception.settings.addCustom')}
          </Button>
        </div>

        {invalidCustomKey ? (
          <Notice tone="warning">{t('customers:reception.settings.invalidKey')}</Notice>
        ) : null}

        {custom.length === 0 ? (
          <p className="reception-settings-empty">{t('customers:reception.settings.customEmpty')}</p>
        ) : (
          <div className="reception-custom-field-list">
            {custom.map((field, index) => (
              <div className="reception-custom-field" key={field.editorKey}>
                <div className="reception-custom-field-grid">
                  <Field label={t('customers:reception.settings.customKey')}>
                    <Input
                      value={field.fieldKey}
                      disabled={changing}
                      onChange={event => update(field.editorKey, { fieldKey: event.target.value })}
                    />
                  </Field>
                  <Field label={t('customers:reception.settings.customLabel')}>
                    <Input
                      value={field.customLabel ? field.label ?? '' : receptionFieldLabel(field)}
                      disabled={changing}
                      onChange={event => update(field.editorKey, {
                        label: event.target.value,
                        customLabel: event.target.value.trim().length > 0,
                      })}
                    />
                    {field.customLabel ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('customers:reception.settings.resetLabel')}
                        disabled={changing}
                        onClick={() => update(field.editorKey, {
                          label: receptionFieldDefaultLabel(field.fieldKey),
                          customLabel: false,
                        })}
                      >
                        <RotateCcw />
                        {t('customers:reception.settings.resetLabel')}
                      </Button>
                    ) : null}
                  </Field>
                  <Field label={t('customers:reception.settings.customType')}>
                    <NativeSelect
                      value={field.fieldType}
                      disabled={changing}
                      onChange={event => update(field.editorKey, {
                        fieldType: event.target.value as ReceptionFieldType,
                        options: event.target.value === 'select' ? field.options : [],
                      })}
                    >
                      {FIELD_TYPE_OPTIONS.map(type => (
                        <option key={type} value={type}>
                          {t(`customers:reception.settings.types.${type}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <label className="reception-custom-field-check">
                    <input
                      type="checkbox"
                      checked={field.enabled}
                      disabled={changing}
                      onChange={event => update(field.editorKey, { enabled: event.target.checked })}
                    />
                    {t('customers:reception.settings.columns.enabled')}
                  </label>
                  <label className="reception-custom-field-check">
                    <input
                      type="checkbox"
                      checked={field.required}
                      disabled={!field.enabled || changing}
                      onChange={event => update(field.editorKey, { required: event.target.checked })}
                    />
                    {t('customers:reception.settings.columns.required')}
                  </label>
                  <div className="reception-custom-field-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('customers:reception.settings.moveUp')}
                      disabled={changing || index === 0}
                      onClick={() => moveCustomField(field.editorKey, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('customers:reception.settings.moveDown')}
                      disabled={changing || index === custom.length - 1}
                      onClick={() => moveCustomField(field.editorKey, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('customers:reception.settings.removeCustom')}
                      disabled={changing}
                      onClick={() => removeCustomField(field.editorKey)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {field.fieldType === 'select' ? (
                  <Field
                    className="reception-custom-field-options"
                    label={t('customers:reception.settings.options')}
                    hint={t('customers:reception.settings.optionsHint')}
                  >
                    <NativeTextarea
                      value={field.options.join('\n')}
                      disabled={changing}
                      onChange={event => update(field.editorKey, {
                        options: event.target.value.split('\n').map(option => option.trim()).filter(Boolean),
                      })}
                    />
                  </Field>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

const CONSENT_LABEL = {
  golf_antisocial_and_course_terms: 'customers:reception.consents.antisocialAndCourseTerms',
  golf_cart_terms: 'customers:reception.consents.cartTerms',
  golf_marketing_contact: 'customers:reception.consents.marketingContact',
} as const satisfies Record<ReceptionConsentKey, string>

const ADDRESS_PART_KEYS = [
  'postalCode',
  'state',
  'city',
  'address1',
  'address2',
] as const

function receptionDisplayValue(
  value: ReceptionFieldValue,
  booleanYes: string,
  booleanNo: string,
) {
  if (typeof value === 'boolean') {
    return value ? booleanYes : booleanNo
  }
  return valueText(value)
}

function ReceptionAddressEditor({
  value,
  label,
  disabled,
  onChange,
}: {
  value: ReceptionFieldValue
  label: string
  disabled: boolean
  onChange: (value: ReceptionFieldValue) => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const empty: ReceptionAddress = {
    postalCode: '',
    state: '',
    city: '',
    address1: '',
    address2: '',
  }
  const address: ReceptionAddress = typeof value === 'object' && value !== null
    ? value
    : { ...empty, address1: valueText(value) }
  return (
    <div className="reception-address-fields">
      {ADDRESS_PART_KEYS.map(part => (
        <div className="reception-address-part" key={part}>
          <span className="reception-address-part-label">
            {t(`customers:reception.addressParts.${part}`)}
          </span>
          <Input
            aria-label={`${label} ${t(`customers:reception.addressParts.${part}`)}`}
            value={address[part] ?? ''}
            disabled={disabled}
            onChange={event => onChange({ ...address, [part]: event.target.value })}
          />
        </div>
      ))}
    </div>
  )
}

function ReceptionDynamicField({
  row,
  field,
  disabled,
  onChange,
}: {
  row: ReceptionRow
  field: ReceptionField
  disabled: boolean
  onChange: (patch: Partial<ReceptionRow>) => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const value = receptionRowValue(row, field.fieldKey)
  const read = receptionRowReadValue(row, field.fieldKey)
  const label = receptionFieldLabel(field)
  const fieldDisabled = disabled || row.status === 'saved' || row.status === 'saving'
  const requirement = field.required ? 'required' : 'optional'
  const update = (next: ReceptionFieldValue) => {
    onChange(updateReceptionRowField(row, field.fieldKey, next))
  }
  const corrected = isReceptionFieldCorrected(row, field)

  let control: ReactNode
  if (field.fieldType === 'select') {
    control = (
      <NativeSelect
        aria-label={label}
        value={valueText(value)}
        disabled={fieldDisabled}
        onChange={event => update(event.target.value || null)}
      >
        <option value="">{t('customers:reception.rows.chooseValue')}</option>
        {field.options.map(option => <option key={option} value={option}>{option}</option>)}
      </NativeSelect>
    )
  } else if (field.fieldType === 'boolean') {
    control = (
      <div className="reception-boolean-input">
        <input
          type="checkbox"
          aria-label={label}
          checked={value === true}
          disabled={fieldDisabled}
          onChange={event => update(event.target.checked)}
        />
        <span>
          {value === null
            ? t('customers:reception.rows.unanswered')
            : receptionDisplayValue(
              value,
              t('customers:reception.rows.booleanYes'),
              t('customers:reception.rows.booleanNo'),
            )}
        </span>
      </div>
    )
  } else if (field.fieldType === 'address') {
    control = (
      <ReceptionAddressEditor
        value={value}
        label={label}
        disabled={fieldDisabled}
        onChange={update}
      />
    )
  } else {
    const inputType = field.fieldType === 'tel' || field.fieldType === 'email' || field.fieldType === 'date'
      ? field.fieldType
      : 'text'
    control = (
      <Input
        type={inputType}
        aria-label={label}
        value={valueText(value)}
        disabled={fieldDisabled}
        onChange={event => update(event.target.value || null)}
      />
    )
  }

  return (
    <Field label={label} requirement={requirement}>
      {control}
      {corrected ? (
        <span className="reception-read-value">
          {t('customers:reception.rows.readAs', {
            value: receptionDisplayValue(
              read,
              t('customers:reception.rows.booleanYes'),
              t('customers:reception.rows.booleanNo'),
            ),
          })}
        </span>
      ) : null}
    </Field>
  )
}

/**
 * One person from the sheet.
 *
 * The read value sits under each input rather than in a second column: the
 * desk's eye is already on the field it is correcting, and a value it has to
 * look away to find is a value nobody checks.
 */
function ReceptionRowCard({
  row,
  fields,
  consentItems,
  index,
  duplicate,
  disabled,
  onChange,
  onRegister,
  onRetryCustomValues,
}: {
  row: ReceptionRow
  fields: readonly ReceptionField[]
  consentItems: readonly ReceptionConsentItem[]
  index: number
  duplicate: boolean
  disabled: boolean
  onChange: (patch: Partial<ReceptionRow>) => void
  onRegister: () => void
  onRetryCustomValues: () => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const saved = row.status === 'saved'
  const blocked = blockedReason(row, fields, consentItems)
  const missing = missingRequiredFields(row, fields)
  const missingConsents = missingRequiredConsentItems(row, consentItems)

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
        {fields
          .filter(field => field.enabled)
          .map(field => (
            <ReceptionDynamicField
              key={field.fieldKey}
              row={row}
              field={field}
              disabled={disabled}
              onChange={onChange}
            />
          ))}
      </div>

      <div className="reception-row-consents">
        {activeReceptionConsentItems(consentItems).map(item => {
          const key = item.consentKey
          const answer = row.consents[key] ?? null
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
                {item.id === null && CONSENT_LABEL[key as ReceptionConsentKey]
                  ? t(CONSENT_LABEL[key as ReceptionConsentKey])
                  : item.label}
                {item.required ? (
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
        <Notice tone="warning">
          {t('customers:reception.consents.blocked', {
            items: missingConsents.map(item => item.label).join('、'),
          })}
        </Notice>
      ) : null}
      {missing.length > 0 && !saved ? (
        <Notice tone="warning">
          {t('customers:reception.rows.requiredFields', {
            fields: missing.map(field => receptionFieldLabel(field)).join('、'),
          })}
        </Notice>
      ) : null}
      {row.consentsMissing ? (
        <Notice tone="danger">{t('customers:reception.consents.notFiled')}</Notice>
      ) : null}
      {row.customFieldsMissing ? (
        <Notice tone="danger">{t('customers:reception.rows.customFieldsNotFiled')}</Notice>
      ) : null}
      {row.error ? <Notice tone="danger">{row.error}</Notice> : null}

      <div className="reception-row-actions">
        {saved && row.customFieldsMissing ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || row.customFieldsRetrying}
            onClick={onRetryCustomValues}
          >
            {row.customFieldsRetrying
              ? t('common:action.saving')
              : t('customers:reception.rows.retryCustomFields')}
          </Button>
        ) : null}
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
            disabled={disabled || !canRegister(row, fields, consentItems) || row.status === 'saving'}
            onClick={onRegister}
          >
            {row.status === 'saving' ? t('common:action.saving') : t('customers:reception.rows.register')}
          </Button>
        )}
      </div>
    </li>
  )
}
