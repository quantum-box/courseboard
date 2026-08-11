import { Badge, Button } from '@tachyon-sdk/native-ui'
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react'
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../../api'
import { currentYearMonth } from '../../../lib/clock'
import { yearMonthRange } from '../../../lib/yearMonth'
import { showToast } from '../../../lib/toast'
import { useRegisterPageReload } from '../../../lib/pageReload'
import {
  Field,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  resourceErrorText,
} from '../../../components/Page'
import { importReservationReport, listReservationReportEntries, previewReservationReport } from './api'
import {
  RESERVATION_REPORT_TARGETS,
  columnMappingsFromAnalysis,
  fileValidationError,
  formatMonth,
  formatReportDate,
  monthGridRows,
  monthsInRows,
  suggestCourseMappings,
  sumRows,
  validateCourseMappings,
  validateColumnMappings,
  type ReservationReportAnalysis,
  type ReservationReportColumnMappings,
  type ReservationReportCourse,
  type ReservationReportEntry,
  type ReservationReportImportResult,
  type ReservationReportPreview,
} from './models'

type ImportStage = 'choose' | 'mapping' | 'confirm' | 'result'

const REPORT_COURSES_PATH = '/v1/course/courses'

function yearsAroundCurrent() {
  const current = Number(currentYearMonth().slice(0, 4))
  return Array.from({ length: 7 }, (_, index) => current - 2 + index)
}

function isPreviewPayload(value: ReservationReportPreview | null): value is ReservationReportPreview {
  return Boolean(
    value
    && Array.isArray(value.facilities)
    && Array.isArray(value.rows)
    && value.totals
    && typeof value.totals.rowCount === 'number'
    && typeof value.normalizedFingerprint === 'string'
  )
}

function reportMonth(rows: ReservationReportPreview['rows']) {
  return monthsInRows(rows)[0] ?? currentYearMonth()
}

function localeForDate(locale: string) {
  return locale === 'en' ? 'en-US' : 'ja-JP'
}

export function ReservationReportImportPage() {
  const { t, i18n } = useTranslation(['reservationReportImport', 'common'])
  const [stage, setStage] = useState<ImportStage>('choose')
  const [file, setFile] = useState<File | null>(null)
  const [year, setYear] = useState(currentYearMonth().slice(0, 4))
  const [fileError, setFileError] = useState<ReturnType<typeof fileValidationError>>(null)
  const [preview, setPreview] = useState<ReservationReportPreview | null>(null)
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [columnMappings, setColumnMappings] = useState<ReservationReportColumnMappings>({})
  const [columnMappingApproved, setColumnMappingApproved] = useState(false)
  const [columnMappingError, setColumnMappingError] = useState<'missing' | 'duplicate' | 'unknown' | 'unapproved' | 'reparse' | null>(null)
  const [previewMonth, setPreviewMonth] = useState(currentYearMonth())
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [mappingError, setMappingError] = useState<'missing' | 'duplicate' | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [mappingPreviewing, setMappingPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ReservationReportImportResult | null>(null)
  const [courses, setCourses] = useState<ReservationReportCourse[]>([])
  const [courseError, setCourseError] = useState<string | null>(null)
  const [courseLoading, setCourseLoading] = useState(true)
  const [savedMonth, setSavedMonth] = useState(currentYearMonth())
  const [savedEntries, setSavedEntries] = useState<ReservationReportEntry[]>([])
  const [savedLoading, setSavedLoading] = useState(true)
  const [savedError, setSavedError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadCourses = useCallback(async () => {
    setCourseLoading(true)
    setCourseError(null)
    try {
      const payload = await courseboardApiJson<{ items: ReservationReportCourse[] }>(REPORT_COURSES_PATH)
      setCourses(payload.items ?? [])
    } catch (error) {
      setCourses([])
      setCourseError(resourceErrorText(error))
    } finally {
      setCourseLoading(false)
    }
  }, [])

  const loadSavedEntries = useCallback(async (month = savedMonth) => {
    const range = yearMonthRange(month)
    if (!range) return
    setSavedLoading(true)
    setSavedError(null)
    try {
      const payload = await listReservationReportEntries(range.from, range.to)
      setSavedEntries(payload.items ?? [])
    } catch (error) {
      setSavedEntries([])
      setSavedError(resourceErrorText(error))
    } finally {
      setSavedLoading(false)
    }
  }, [savedMonth])

  useEffect(() => {
    void loadCourses()
  }, [loadCourses])

  useEffect(() => {
    void loadSavedEntries(savedMonth)
  }, [loadSavedEntries, savedMonth])

  useRegisterPageReload(() => Promise.all([loadCourses(), loadSavedEntries(savedMonth)]).then(() => undefined))

  const previewMonths = useMemo(
    () => (preview ? monthsInRows(preview.rows) : []),
    [preview],
  )
  const currentPreviewMonth = previewMonths.includes(previewMonth)
    ? previewMonth
    : previewMonths[0] ?? currentYearMonth()
  const previewRows = useMemo(
    () => (preview ? monthGridRows(preview.rows, currentPreviewMonth) : []),
    [currentPreviewMonth, preview],
  )
  const previewTotals = useMemo(
    () => (preview ? sumRows(preview.rows) : null),
    [preview],
  )
  const courseNames = useMemo(
    () => new Map(courses.map(course => [course.id, course.shortName?.trim() || course.name] as const)),
    [courses],
  )

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null
    setFile(next)
    setFileError(fileValidationError(next))
    setPreviewError(null)
    setImportError(null)
    setColumnMappingApproved(false)
    setColumnMappingError(null)
  }

  function validateFileAndYear() {
    const nextFileError = fileValidationError(file)
    setFileError(nextFileError)
    const parsedYear = Number(year)
    if (nextFileError) return null
    if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2200) {
      setPreviewError(t('reservationReportImport:error.invalidYear'))
      return null
    }
    return parsedYear
  }

  async function runPreview() {
    const parsedYear = validateFileAndYear()
    if (!file || parsedYear === null) return
    setPreviewing(true)
    setPreviewError(null)
    setImportError(null)
    try {
      const payload = await previewReservationReport(file, parsedYear)
      if (!isPreviewPayload(payload)) {
        setPreviewError(t('reservationReportImport:error.invalidResponse'))
        return
      }
      setPreview(payload)
      setMappings(suggestCourseMappings(payload.facilities, courses))
      setColumnMappings(columnMappingsFromAnalysis(payload.analysis))
      setColumnMappingApproved(false)
      setColumnMappingError(null)
      setPreviewMonth(reportMonth(payload.rows))
      if (payload.rows.length === 0) {
        setPreviewError(t('reservationReportImport:notice.noRows'))
        return
      }
      setStage('mapping')
    } catch (error) {
      setPreviewError(resourceErrorText(error) || t('reservationReportImport:notice.previewFailed'))
    } finally {
      setPreviewing(false)
    }
  }

  function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void runPreview()
  }

  function handleMappingChange(sourceCourseKey: string, golfCourseId: string) {
    setMappings(current => ({ ...current, [sourceCourseKey]: golfCourseId }))
    setMappingError(null)
  }

  function handleColumnMappingChange(target: string, source: string) {
    setColumnMappings(current => ({ ...current, [target]: source }))
    setColumnMappingApproved(false)
    setColumnMappingError(null)
  }

  async function continueToConfirm() {
    if (!preview || !file) return
    let confirmedPreview = preview
    let confirmedCourseMappings = mappings
    if (preview.analysis) {
      const columnValidation = validateColumnMappings(preview.analysis.headers, columnMappings)
      if (!columnValidation.valid) {
        setColumnMappingError(columnValidation.reason)
        return
      }
      if (!columnMappingApproved) {
        setColumnMappingError('unapproved')
        return
      }
      setMappingPreviewing(true)
      setColumnMappingError(null)
      try {
        const payload = await previewReservationReport(file, Number(year), columnMappings)
        if (!isPreviewPayload(payload)) {
          setColumnMappingError('reparse')
          return
        }
        confirmedPreview = payload
        const suggested = suggestCourseMappings(payload.facilities, courses)
        confirmedCourseMappings = Object.fromEntries(payload.facilities.map(facility => [
          facility.sourceCourseKey,
          mappings[facility.sourceCourseKey] ?? suggested[facility.sourceCourseKey] ?? '',
        ]))
        setPreview(payload)
        setMappings(confirmedCourseMappings)
        setColumnMappings(columnMappingsFromAnalysis(payload.analysis))
        setPreviewMonth(reportMonth(payload.rows))
      } catch {
        setColumnMappingError('reparse')
        return
      } finally {
        setMappingPreviewing(false)
      }
    }
    const validation = validateCourseMappings(confirmedPreview.facilities, confirmedCourseMappings)
    if (!validation.valid) {
      setMappingError(validation.reason)
      return
    }
    setMappingError(null)
    setStage('confirm')
  }

  async function confirmImport() {
    if (!preview || !file) return
    if (preview.analysis) {
      const columnValidation = validateColumnMappings(preview.analysis.headers, columnMappings)
      if (!columnValidation.valid || !columnMappingApproved) {
        setColumnMappingError(columnValidation.valid ? 'unapproved' : columnValidation.reason)
        setStage('mapping')
        return
      }
    }
    const validation = validateCourseMappings(preview.facilities, mappings)
    if (!validation.valid) {
      setMappingError(validation.reason)
      setStage('mapping')
      return
    }
    const parsedYear = Number(year)
    setImporting(true)
    setImportError(null)
    try {
      const saved = await importReservationReport(
        file,
        parsedYear,
        mappings,
        preview.normalizedFingerprint,
        preview.analysis ? columnMappings : undefined,
      )
      setResult(saved)
      setStage('result')
      const importedMonth = reportMonth(preview.rows)
      setSavedMonth(importedMonth)
      await loadSavedEntries(importedMonth)
      showToast({
        tone: 'success',
        title: t('reservationReportImport:result.title'),
        message: t('reservationReportImport:result.description'),
      })
    } catch (error) {
      setImportError(resourceErrorText(error) || t('reservationReportImport:notice.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  function startOver() {
    setStage('choose')
    setFile(null)
    setPreview(null)
    setMappings({})
    setColumnMappings({})
    setColumnMappingApproved(false)
    setColumnMappingError(null)
    setResult(null)
    setFileError(null)
    setPreviewError(null)
    setMappingError(null)
    setImportError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="page-stack reservation-report-import-page">
      <header className="reservation-report-hero">
        <div className="reservation-report-hero-mark"><FileSpreadsheet aria-hidden="true" /></div>
        <div>
          <p className="reservation-report-kicker">{t('reservationReportImport:title')}</p>
          <h1>{t('reservationReportImport:intro.title')}</h1>
          <p>{t('reservationReportImport:intro.body')}</p>
        </div>
      </header>

      <nav className="reservation-report-steps" aria-label={t('reservationReportImport:title')}>
        {([
          ['choose', t('reservationReportImport:step.choose')],
          ['mapping', t('reservationReportImport:step.mapping')],
          ['confirm', t('reservationReportImport:step.confirm')],
          ['result', t('reservationReportImport:step.result')],
        ] as const).map(([key, label], index) => (
          <div key={key} className="reservation-report-step" data-current={stage === key || undefined}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </nav>

      <Notice tone="info" title={t('reservationReportImport:notice.individualTitle')}>
        {t('reservationReportImport:notice.individualBody')}
      </Notice>

      {courseError ? (
        <Notice tone="danger" title={t('common:error.loadFailed')} actions={(
          <Button type="button" variant="secondary" onClick={() => { void loadCourses() }}>
            <RefreshCw /> {t('common:action.retry')}
          </Button>
        )}>
          {courseError}
        </Notice>
      ) : null}

      {stage === 'choose' ? (
        <Panel title={t('reservationReportImport:step.choose')} className="reservation-report-panel">
          <form className="reservation-report-choose-form" onSubmit={event => { void handlePreview(event) }}>
            <Field label={t('reservationReportImport:field.file')} required hint={t('reservationReportImport:file.hint')}>
              <div className="reservation-report-file-control">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleFileChange}
                  aria-describedby={fileError ? 'reservation-report-file-error' : undefined}
                />
                <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  <Upload /> {t('reservationReportImport:file.choose')}
                </Button>
                <span className="reservation-report-file-name">
                  {file ? t('reservationReportImport:file.selected', { name: file.name }) : t('reservationReportImport:file.missing')}
                </span>
              </div>
              {fileError ? (
                <span id="reservation-report-file-error" className="reservation-report-field-error" role="alert">
                  {fileError === 'required'
                    ? t('reservationReportImport:file.missing')
                    : fileError === 'size'
                      ? t('reservationReportImport:file.tooLarge')
                      : t('reservationReportImport:file.wrongType')}
                </span>
              ) : null}
            </Field>
            <Field label={t('reservationReportImport:field.year')} required>
              <NativeSelect value={year} onChange={event => setYear(event.target.value)}>
                <option value="">—</option>
                {yearsAroundCurrent().map(option => <option key={option} value={option}>{option}</option>)}
              </NativeSelect>
            </Field>
            <div className="reservation-report-form-actions">
              <Button type="submit" variant="primary" disabled={previewing || courseLoading}>
                {previewing ? <RefreshCw className="spin" /> : <ArrowRight />}
                {previewing ? t('reservationReportImport:action.previewing') : t('reservationReportImport:action.preview')}
              </Button>
            </div>
          </form>
          {previewError ? (
            <Notice tone="danger" title={t('reservationReportImport:notice.previewFailed')} actions={(
              <Button type="button" variant="secondary" onClick={() => { void runPreview() }}>
                {t('reservationReportImport:action.retryPreview')}
              </Button>
            )}>
              {previewError}
            </Notice>
          ) : null}
        </Panel>
      ) : null}

      {stage === 'mapping' && preview ? (
        <Panel title={t('reservationReportImport:mapping.title')} description={t('reservationReportImport:mapping.description')} className="reservation-report-panel">
          {preview.analysis ? (
            <TabularMappingPreview
              analysis={preview.analysis}
              mappings={columnMappings}
              approved={columnMappingApproved}
              onMappingChange={handleColumnMappingChange}
              onApprovedChange={checked => {
                setColumnMappingApproved(checked)
                setColumnMappingError(null)
              }}
            />
          ) : null}
          {columnMappingError ? (
            <Notice tone="danger" title={t('reservationReportImport:mapping.columnErrorTitle')}>
              {t(`reservationReportImport:mapping.columnError.${columnMappingError}`)}
            </Notice>
          ) : null}
          <div className="reservation-report-mapping-list">
            {preview.facilities.map(facility => {
              const selected = mappings[facility.sourceCourseKey] ?? ''
              return (
                <div className="reservation-report-mapping-row" key={facility.sourceCourseKey}>
                  <div className="reservation-report-source">
                    <strong>{facility.sourceCourseName}</strong>
                    <span>{facility.sourceCourseKey}</span>
                  </div>
                  <Field label={t('reservationReportImport:field.courseMapping')} requirement="none">
                    <NativeSelect
                      value={selected}
                      onChange={event => handleMappingChange(facility.sourceCourseKey, event.target.value)}
                    >
                      <option value="">{t('reservationReportImport:mapping.unselected')}</option>
                      {courses.filter(course => course.isActive !== false).map(course => (
                        <option key={course.id} value={course.id}>
                          {course.shortName?.trim() || course.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  {selected ? <Badge variant="success">{t('reservationReportImport:mapping.selected')}</Badge> : null}
                </div>
              )
            })}
          </div>
          {mappingError ? (
            <Notice tone="danger" title={mappingError === 'duplicate'
              ? t('reservationReportImport:notice.mappingDuplicate')
              : t('reservationReportImport:notice.mappingRequired')}>
              {mappingError === 'duplicate'
                ? t('reservationReportImport:notice.mappingDuplicate')
                : t('reservationReportImport:notice.mappingRequired')}
            </Notice>
          ) : null}
          <div className="reservation-report-form-actions">
            <Button type="button" variant="secondary" onClick={() => setStage('choose')}>
              <ArrowLeft /> {t('reservationReportImport:action.back')}
            </Button>
            <Button type="button" variant="primary" disabled={mappingPreviewing} onClick={() => { void continueToConfirm() }}>
              {mappingPreviewing ? <RefreshCw className="spin" /> : <ArrowRight />}
              {mappingPreviewing ? t('reservationReportImport:action.recheckingMapping') : t('reservationReportImport:action.continue')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {stage === 'confirm' && preview ? (
        <Panel title={t('reservationReportImport:preview.title')} description={t('reservationReportImport:preview.description')} className="reservation-report-panel">
          <div className="reservation-report-preview-toolbar">
            <Field label={t('reservationReportImport:field.month')} requirement="none">
              <NativeSelect value={currentPreviewMonth} onChange={event => setPreviewMonth(event.target.value)}>
                {previewMonths.map(month => <option key={month} value={month}>{formatMonth(month, localeForDate(i18n.language))}</option>)}
              </NativeSelect>
            </Field>
            <span className="reservation-report-preview-count">
              {t('reservationReportImport:result.rows')}: {previewRows.length}
            </span>
          </div>
          <MonthlyPreviewTable rows={previewRows} locale={localeForDate(i18n.language)} />
          {previewTotals ? <ReportTotals totals={previewTotals} /> : null}
          {importError ? (
            <Notice tone="danger" title={t('reservationReportImport:notice.importFailed')}>
              {importError}
            </Notice>
          ) : null}
          <div className="reservation-report-form-actions">
            <Button type="button" variant="secondary" onClick={() => setStage('mapping')}>
              <ArrowLeft /> {t('reservationReportImport:action.back')}
            </Button>
            <Button type="button" variant="primary" disabled={importing} onClick={() => { void confirmImport() }}>
              {importing ? <RefreshCw className="spin" /> : <CheckCircle2 />}
              {importing ? t('reservationReportImport:action.importing') : t('reservationReportImport:action.import')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {stage === 'result' && result ? (
        <Panel title={t('reservationReportImport:result.title')} description={t('reservationReportImport:result.description')} className="reservation-report-panel">
          <div className="reservation-report-result-heading"><CheckCircle2 aria-hidden="true" /><strong>{t('reservationReportImport:result.title')}</strong></div>
          <ResultStats result={result} />
          <div className="reservation-report-form-actions">
            <Button type="button" variant="primary" onClick={startOver}>
              <Upload /> {t('reservationReportImport:action.startOver')}
            </Button>
          </div>
        </Panel>
      ) : null}

      <SavedEntriesPanel
        month={savedMonth}
        entries={savedEntries}
        loading={savedLoading}
        error={savedError}
        courseNames={courseNames}
        locale={localeForDate(i18n.language)}
        onMonthChange={setSavedMonth}
        onReload={() => { void loadSavedEntries(savedMonth) }}
      />
    </div>
  )
}

function TabularMappingPreview({
  analysis,
  mappings,
  approved,
  onMappingChange,
  onApprovedChange,
}: {
  analysis: ReservationReportAnalysis
  mappings: ReservationReportColumnMappings
  approved: boolean
  onMappingChange: (target: string, source: string) => void
  onApprovedChange: (checked: boolean) => void
}) {
  const { t } = useTranslation('reservationReportImport')
  const targetLabels: Record<string, string> = {
    facilityName: t('mapping.target.facilityName'),
    date: t('mapping.target.date'),
    dayPart: t('mapping.target.dayPart'),
    groupCount: t('mapping.target.groupCount'),
    caddieAttachedGroupCount: t('mapping.target.caddieAttachedGroupCount'),
  }
  return (
    <section className="reservation-report-column-mapping" aria-labelledby="reservation-report-column-mapping-title">
      <h3 id="reservation-report-column-mapping-title">{t('mapping.columnTitle')}</h3>
      <p>{t('mapping.columnDescription')}</p>
      <div className="reservation-report-table-scroll">
        <table className="reservation-report-table">
          <thead>
            <tr>
              <th>{t('mapping.targetColumn')}</th>
              <th>{t('mapping.sourceColumn')}</th>
              <th>{t('mapping.method')}</th>
              <th>{t('mapping.confidence')}</th>
              <th>{t('mapping.samples')}</th>
            </tr>
          </thead>
          <tbody>
            {RESERVATION_REPORT_TARGETS.map(target => {
              const source = mappings[target] ?? ''
              const field = analysis.mapping.fields.find(candidate => (
                candidate.target === target && candidate.source === source
              ))
              const method = field
                ? analysis.mapping.mode === 'ai'
                  ? t('mapping.methodValue.ai')
                  : analysis.mapping.mode === 'user'
                    ? t('mapping.methodValue.user')
                    : t('mapping.methodValue.alias')
                : t('mapping.methodValue.manual')
              const explanation = analysis.mapping.mode === 'user'
                ? t('mapping.approvedExplanation')
                : field?.explanation
              return (
                <tr key={target}>
                  <td><strong>{targetLabels[target]}</strong></td>
                  <td>
                    <NativeSelect
                      value={source}
                      aria-label={t('mapping.sourceForTarget', { target: targetLabels[target] })}
                      onChange={event => onMappingChange(target, event.target.value)}
                    >
                      <option value="">{t('mapping.sourceUnselected')}</option>
                      {analysis.headers.map(header => <option key={header} value={header}>{header}</option>)}
                    </NativeSelect>
                  </td>
                  <td>
                    <strong>{method}</strong>
                    {explanation ? <small>{explanation}</small> : null}
                  </td>
                  <td>{field && analysis.mapping.mode !== 'user'
                    ? `${Math.round(Math.max(0, Math.min(1, field.confidence)) * 100)}%`
                    : '—'}</td>
                  <td>{field?.samples.length ? field.samples.join('、') : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <label className="reservation-report-column-approval">
        <input
          type="checkbox"
          checked={approved}
          onChange={event => onApprovedChange(event.target.checked)}
        />
        <span>
          <strong>{t('mapping.approve')}</strong>
          <small>{t('mapping.approveHint')}</small>
        </span>
      </label>
      {analysis.mapping.notes ? <p className="reservation-report-mapping-note">{analysis.mapping.notes}</p> : null}
      {analysis.warnings.length > 0 ? (
        <Notice tone="warning" title={t('mapping.warningTitle')}>
          {analysis.warnings.join(' / ')}
        </Notice>
      ) : null}
    </section>
  )
}

function MonthlyPreviewTable({
  rows,
  locale,
}: {
  rows: ReturnType<typeof monthGridRows>
  locale: string
}) {
  const { t } = useTranslation('reservationReportImport')
  if (rows.length === 0) {
    return <div className="reservation-report-empty-month">{t('preview.noMonth')}</div>
  }
  return (
    <div className="reservation-report-table-scroll">
      <table className="reservation-report-table">
        <thead>
          <tr>
            <th rowSpan={2}>{t('preview.date')}</th>
            <th rowSpan={2}>{t('preview.facility')}</th>
            <th colSpan={2}>{t('preview.morning')}</th>
            <th colSpan={2}>{t('preview.afternoon')}</th>
          </tr>
          <tr>
            <th>{t('preview.groups')}</th>
            <th>{t('preview.caddie')}</th>
            <th>{t('preview.groups')}</th>
            <th>{t('preview.caddie')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <td>{formatReportDate(row.date, locale)}</td>
              <td>{row.sourceCourseName}</td>
              <td className="align-right">{row.morningGroupCount}</td>
              <td className="align-right">{row.morningCaddieAttachedGroupCount}</td>
              <td className="align-right">{row.afternoonGroupCount}</td>
              <td className="align-right">{row.afternoonCaddieAttachedGroupCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportTotals({ totals }: { totals: ReturnType<typeof sumRows> }) {
  const { t } = useTranslation('reservationReportImport')
  return (
    <div className="reservation-report-totals" aria-label={t('preview.total')}>
      <div><span>{t('result.facilities')}</span><strong>{totals.facilityCount}</strong></div>
      <div><span>{t('result.rows')}</span><strong>{totals.rowCount}</strong></div>
      <div><span>{t('result.groups')}</span><strong>{totals.groupCount}</strong></div>
      <div><span>{t('result.caddie')}</span><strong>{totals.caddieAttachedGroupCount}</strong></div>
    </div>
  )
}

function ResultStats({ result }: { result: ReservationReportImportResult }) {
  const { t } = useTranslation('reservationReportImport')
  return (
    <div className="reservation-report-result-grid">
      <div><span>{t('result.created')}</span><strong>{result.createdCount}</strong></div>
      <div><span>{t('result.updated')}</span><strong>{result.updatedCount}</strong></div>
      <div><span>{t('result.unchanged')}</span><strong>{result.unchangedCount}</strong></div>
      <div><span>{t('result.rows')}</span><strong>{result.totals.rowCount}</strong></div>
      <div><span>{t('result.groups')}</span><strong>{result.totals.groupCount}</strong></div>
      <div><span>{t('result.caddie')}</span><strong>{result.totals.caddieAttachedGroupCount}</strong></div>
    </div>
  )
}

function SavedEntriesPanel({
  month,
  entries,
  loading,
  error,
  courseNames,
  locale,
  onMonthChange,
  onReload,
}: {
  month: string
  entries: ReservationReportEntry[]
  loading: boolean
  error: string | null
  courseNames: Map<string, string>
  locale: string
  onMonthChange: (month: string) => void
  onReload: () => void
}) {
  const { t } = useTranslation('reservationReportImport')
  return (
    <Panel
      title={t('list.title')}
      description={t('list.description')}
      className="reservation-report-panel reservation-report-saved-panel"
      actions={(
        <Button type="button" variant="ghost" onClick={onReload} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> {t('action.reload')}
        </Button>
      )}
    >
      <div className="reservation-report-saved-toolbar">
        <Field label={t('field.month')} requirement="none">
          <input
            type="month"
            value={month}
            onChange={event => onMonthChange(event.target.value)}
            aria-label={t('field.month')}
          />
        </Field>
      </div>
      {error ? <Notice tone="danger" title={t('list.failed')}>{error}</Notice> : null}
      {loading ? <LoadingState label={t('list.loading')} /> : entries.length === 0 ? (
        <div className="reservation-report-empty-month">{t('list.empty')}</div>
      ) : (
        <div className="reservation-report-table-scroll">
          <table className="reservation-report-table reservation-report-saved-table">
            <thead>
              <tr>
                <th>{t('list.date')}</th>
                <th>{t('list.facility')}</th>
                <th>{t('list.dayPart')}</th>
                <th>{t('list.groups')}</th>
                <th>{t('list.caddie')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td>{formatReportDate(entry.date, locale)}</td>
                  <td>{courseNames.get(entry.golfCourseId) ?? entry.sourceCourseName}</td>
                  <td>{entry.dayPart === 'morning' ? t('list.morning') : t('list.afternoon')}</td>
                  <td className="align-right">{entry.groupCount}</td>
                  <td className="align-right">{entry.caddieAttachedGroupCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
