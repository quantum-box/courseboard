import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { CalendarRange, CheckCircle2, FileSpreadsheet, Save, Upload, X } from 'lucide-react'
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, courseboardApiJson, currentYearMonth } from '../../api'
import {
  DataTable,
  EmptyState,
  Field,
  LoadingState,
  Metric,
  MetricGrid,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { YearMonthPicker, useYearMonthValue } from '../../components/YearMonthPicker'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import {
  courseChoiceOf,
  dailyRows,
  formatMonthDay,
  formatYearMonth,
  hasSomethingToApply,
  IGNORE_COURSE,
  importTotals,
  monthBounds,
  warningCopy,
  type ImportWarning,
  type ReservationImportResult,
  type ReservationSummary,
} from './reservationImport'

type GolfCourse = {
  id: string
  name: string
}

const WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * One line of "worth checking", written out.
 *
 * Each kind gets its own sentence rather than one template with holes: the
 * useful part of a warning is the specific thing it says, and a generic
 * "problem on 7月3日" would leave the reader to go and find out what.
 */
function WarningLine({ warning }: { warning: ImportWarning }) {
  const { t } = useTranslation('reservationImport')
  const copy = warningCopy(warning)
  const half = copy.timeOfDay
    ? t(copy.timeOfDay === 'am' ? 'daily.morning' : 'daily.afternoon')
    : ''
  const { course, date, candidates } = copy

  const text = (() => {
    switch (copy.kind) {
      case 'unreadableCount':
        return t('warning.unreadableCount', { course, date, half })
      case 'caddieGroupsExceedTotal':
        return t('warning.caddieGroupsExceedTotal', {
          course,
          date,
          half,
          totalGroups: String(copy.totalGroups),
          caddieGroups: String(copy.caddieGroups),
        })
      case 'courseTotalsDisagreeWithSheet':
        return t('warning.courseTotalsDisagreeWithSheet', {
          date,
          half,
          sheetTotal: String(copy.sheetTotal),
          importedTotal: String(copy.importedTotal),
        })
      case 'unknownCourse':
        return t('warning.unknownCourse', { course })
      case 'ambiguousCourse':
        return t('warning.ambiguousCourse', { course, candidates })
      default:
        return t('warning.unknown')
    }
  })()

  return <Notice tone={copy.tone}>{text}</Notice>
}

/**
 * Bringing the club's daily reservation export into CourseBoard.
 *
 * The screen is deliberately two steps. The export is re-issued all month long
 * as bookings come in, so importing is routine rather than rare — and a routine
 * action that overwrites a month needs somewhere to stop and look first. The
 * check step writes nothing, which is what makes "discard" an honest button.
 */
export function ReservationImportPage() {
  const { t } = useTranslation(['reservationImport', 'common'])
  const {
    value: yearMonth,
    error: yearMonthError,
    setCandidate: setYearMonth,
  } = useYearMonthValue(currentYearMonth())
  const [courseFilter, setCourseFilter] = useState('all')
  const [courses, setCourses] = useState<GolfCourse[]>([])
  const [stored, setStored] = useState<ReservationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ReservationImportResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Set only once the server has said the file name does not carry a month.
  // Until then the month below is not sent at all, so an unnamed file cannot be
  // dated by whatever the table filter happens to be showing.
  const [needsMonth, setNeedsMonth] = useState(false)
  // The desk's answers for this file's course names, before they are saved.
  // Keyed by the name the sheet uses, which is what the answer is stored
  // against — a course id would not survive the name being asked about again.
  const [courseChoice, setCourseChoice] = useState<Record<string, string>>({})
  const [savingLinks, setSavingLinks] = useState(false)
  const {
    value: importMonth,
    error: importMonthError,
    setCandidate: setImportMonth,
  } = useYearMonthValue(currentYearMonth())
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Which load is the current one. Importing moves the table to the file's
  // month, which starts a second read while the first is still in flight;
  // without this the older answer can land last and leave the previous month's
  // rows under the new month's heading.
  const loadSequence = useRef(0)

  const range = useMemo(
    () => monthBounds(yearMonth) ?? monthBounds(currentYearMonth()),
    [yearMonth],
  )

  const load = useCallback(async () => {
    if (!range) return
    const sequence = (loadSequence.current += 1)
    setLoading(true)
    setLoadError(null)
    const params = new URLSearchParams({ from: range.from, to: range.to })
    if (courseFilter !== 'all') params.set('golfCourseIds', courseFilter)
    try {
      const [coursePayload, summaryPayload] = await Promise.all([
        courseboardApiJson<{ items: GolfCourse[] }>('/v1/course/courses'),
        courseboardApiJson<{ items: ReservationSummary[] }>(
          `/v1/course/reservation-summaries?${params.toString()}`,
        ),
      ])
      // A newer read has already been asked for, so this answer is about a
      // month the screen has moved on from.
      if (loadSequence.current !== sequence) return
      setCourses(coursePayload.items)
      setStored(summaryPayload.items)
    } catch (error) {
      if (loadSequence.current !== sequence) return
      setLoadError(error)
    } finally {
      if (loadSequence.current === sequence) setLoading(false)
    }
  }, [courseFilter, range])

  useEffect(() => {
    void load()
  }, [load])
  useRegisterPageReload(load)

  function chooseCourse(sheetLabel: string, value: string) {
    setCourseChoice(current => ({ ...current, [sheetLabel]: value }))
  }

  /**
   * Record what each name in this file refers to, then look again.
   *
   * Saved rather than applied to this import alone: the same file arrives every
   * month, and a club whose course names differ from the export's would
   * otherwise answer the same question every time.
   */
  async function saveCourseChoices() {
    if (!preview) return
    setSavingLinks(true)
    setUploadError(null)
    try {
      await courseboardApiJson('/v1/course/reservation-summaries/course-links', {
        method: 'PUT',
        body: JSON.stringify({
          items: preview.courses
            .map(course => ({
              sheetLabel: course.sheetLabel,
              choice: courseChoice[course.sheetLabel] ?? courseChoiceOf(course),
            }))
            .filter(item => item.choice !== '')
            .map(item => ({
              sheetLabel: item.sheetLabel,
              // "Do not import" is an answer, and it travels as the absence of
              // a course rather than as a sentinel the API would have to know.
              golfCourseId: item.choice === IGNORE_COURSE ? undefined : item.choice,
            })),
        }),
      })
      setCourseChoice({})
      // Look again rather than patching the result in place: the counts, the
      // warnings and the totals all move when a course joins or leaves.
      await check()
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : t('reservationImport:courses.saveFailed'),
      )
    } finally {
      setSavingLinks(false)
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setUploadError(null)
    setPreview(null)
    setCourseChoice({})
    // A new file gets asked about on its own terms. The month answered for the
    // last one says nothing about this one, and carrying it over is invisible:
    // backfilling an unnamed 2025 file and then picking an unnamed 2026 one
    // would put the second into 2025 with the picker quietly showing why.
    setNeedsMonth(false)
    setImportMonth(currentYearMonth())
    setFile(event.target.files?.[0] ?? null)
  }

  /**
   * Changing the month throws the checked result away.
   *
   * The month only reaches the rows as a year, so previewing 2026 and then
   * applying 2027 would write a month nobody looked at — and the check step is
   * worth having only while it describes what the button below it will do.
   */
  function chooseImportMonth(candidate: string) {
    setImportMonth(candidate)
    setPreview(null)
  }

  function discard() {
    setPreview(null)
    setFile(null)
    setCourseChoice({})
    setUploadError(null)
    setNeedsMonth(false)
    setImportMonth(currentYearMonth())
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /**
   * The month is read from the file name on the server, so the picker is sent
   * only after the desk has been asked for one. Parsing the name in two places
   * is how the two would come to disagree, and sending the picker's default
   * unasked would date the whole file to whatever month happened to be showing.
   */
  function importPath(step: 'preview' | 'import') {
    const params = new URLSearchParams()
    if (file) params.set('fileName', file.name)
    if (needsMonth) params.set('yearMonth', importMonth)
    return `/v1/course/reservation-summaries/${step}?${params.toString()}`
  }

  async function send(step: 'preview' | 'import') {
    if (!file) return null
    return await courseboardApiJson<ReservationImportResult>(importPath(step), {
      method: 'POST',
      headers: { 'Content-Type': WORKBOOK_CONTENT_TYPE },
      body: await file.arrayBuffer(),
    })
  }

  /**
   * Whether the server is asking which month this file is, rather than
   * refusing it. Keyed on the error code, not the message: the message is
   * shown to the reader and is free to be rewritten.
   */
  function asksForTheMonth(error: unknown) {
    if (!(error instanceof ApiError)) return false
    const details = error.details as { error?: string } | undefined
    return details?.error === 'month_required'
  }

  async function check() {
    if (!file) return
    setChecking(true)
    setUploadError(null)
    try {
      const result = await send('preview')
      if (result) setPreview(result)
    } catch (error) {
      setPreview(null)
      if (asksForTheMonth(error)) {
        // Ask, do not assume. Picking the month showing in the filter would
        // silently date every column of the sheet to an unrelated month.
        setNeedsMonth(true)
        setUploadError(t('reservationImport:error.monthRequired'))
        return
      }
      setUploadError(error instanceof Error ? error.message : t('reservationImport:error.failed'))
    } finally {
      setChecking(false)
    }
  }

  async function apply() {
    if (!file || !preview) return
    setApplying(true)
    setUploadError(null)
    try {
      const result = await send('import')
      if (!result) return
      showToast({
        tone: 'success',
        title: t('reservationImport:imported.title'),
        message: t('reservationImport:imported.message', {
          yearMonth: formatYearMonth(result.yearMonth),
          n: String(result.imported),
        }),
      })
      // Follow the file's month rather than whatever the filter was left on,
      // so the table below shows what was just imported. When that is a
      // different month the range changes and the loader effect reads it; this
      // call covers the common case of re-importing the month already shown,
      // where nothing changes and no effect fires. The two are sequenced
      // against each other in `load`, so the older read cannot land last.
      setYearMonth(result.yearMonth)
      discard()
      await load()
    } catch (error) {
      if (asksForTheMonth(error)) {
        setNeedsMonth(true)
        setUploadError(t('reservationImport:error.monthRequired'))
        return
      }
      setUploadError(error instanceof Error ? error.message : t('reservationImport:error.failed'))
    } finally {
      setApplying(false)
    }
  }

  const totals = useMemo(
    () => (preview ? importTotals(preview.courses) : null),
    [preview],
  )
  const mappingChanged = useMemo(
    () =>
      Boolean(preview)
      && (preview?.courses ?? []).some(
        course =>
          courseChoice[course.sheetLabel] !== undefined
          && courseChoice[course.sheetLabel] !== courseChoiceOf(course),
      ),
    [preview, courseChoice],
  )
  const rows = useMemo(
    () => dailyRows(preview ? preview.summaries : stored),
    [preview, stored],
  )

  return (
    <div className="page-stack">
      <Panel
        title={t('reservationImport:upload.title')}
        description={t('reservationImport:upload.description')}
      >
        <div className="grid gap-3">
          <Field
            label={t('reservationImport:upload.file')}
            required
            hint={t('reservationImport:upload.fileHint')}
          >
            <Input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={chooseFile}
            />
          </Field>
          {file ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <FileSpreadsheet className="size-3.5" /> {file.name}
            </div>
          ) : null}
          {uploadError ? <Notice tone="danger">{uploadError}</Notice> : null}
          {needsMonth ? (
            // Shown only after the server has asked, and sent only from here.
            // It opens on the current month because a year/month pair has no
            // empty state to open on — which is fine, because the desk has just
            // been told the file did not say and has to press the button again
            // themselves. What must not happen is sending a month nobody was
            // asked for, and until this appears none is sent at all.
            <div className="grid gap-1">
              <YearMonthPicker
                label={t('reservationImport:upload.month')}
                value={importMonth}
                error={importMonthError}
                onChange={chooseImportMonth}
                className="sm:w-64"
              />
              <small className="text-xs text-muted-foreground">
                {t('reservationImport:upload.monthHint')}
              </small>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="lg"
              type="button"
              disabled={!file || checking || applying || (needsMonth && Boolean(importMonthError))}
              onClick={() => void check()}
            >
              <Upload />
              {checking
                ? t('reservationImport:upload.checking')
                : t('reservationImport:upload.check')}
            </Button>
            {preview ? (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  type="button"
                  // Unsaved course choices are not what the import would use:
                  // it re-uploads the file and the server reads the answers on
                  // file. Importing now would apply the previous mapping while
                  // the screen shows the new one.
                  //
                  // Enabled on a file that imports nothing but excludes
                  // something: that file's job is to take the excluded names
                  // off the board.
                  disabled={applying || mappingChanged || !hasSomethingToApply(preview.courses)}
                  onClick={() => void apply()}
                >
                  <CheckCircle2 />
                  {applying
                    ? t('reservationImport:preview.applying')
                    : t('reservationImport:preview.apply')}
                </Button>
                <Button variant="ghost" size="lg" type="button" onClick={discard}>
                  <X /> {t('reservationImport:preview.cancel')}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </Panel>

      {preview && totals ? (
        <Panel
          title={t('reservationImport:preview.title')}
          description={t('reservationImport:preview.description', {
            yearMonth: formatYearMonth(preview.yearMonth),
          })}
        >
          <MetricGrid>
            <Metric
              label={t('reservationImport:preview.metric.month')}
              value={formatYearMonth(preview.yearMonth)}
              detail={`${formatMonthDay(preview.from)} 〜 ${formatMonthDay(preview.to)}`}
            />
            <Metric
              label={t('reservationImport:preview.metric.courses')}
              value={t('reservationImport:preview.unit.courses', { n: String(totals.courseCount) })}
              detail={t('reservationImport:preview.unit.days', { n: String(totals.dayCount) })}
            />
            <Metric
              label={t('reservationImport:preview.metric.groups')}
              value={t('reservationImport:preview.unit.groups', { n: String(totals.totalGroups) })}
            />
            <Metric
              label={t('reservationImport:preview.metric.caddieGroups')}
              value={t('reservationImport:preview.unit.groups', { n: String(totals.caddieGroups) })}
            />
            <Metric
              label={t('reservationImport:preview.metric.skipped')}
              value={t('reservationImport:preview.unit.halfDays', { n: String(preview.skipped) })}
              tone={preview.skipped > 0 ? 'warning' : 'neutral'}
            />
          </MetricGrid>

          {preview.unansweredCourses > 0 ? (
            <Notice tone="warning">
              {t('reservationImport:courses.unanswered', {
                n: String(preview.unansweredCourses),
              })}
            </Notice>
          ) : null}

          <DataTable
            rows={preview.courses}
            rowKey={course => course.sheetLabel}
            columns={[
              {
                key: 'sheetLabel',
                header: t('reservationImport:preview.courses.sheetLabel'),
                mobileLabel: t('reservationImport:preview.courses.sheetLabel'),
                cell: course => course.sheetLabel,
              },
              {
                key: 'courseName',
                header: t('reservationImport:preview.courses.courseName'),
                mobileLabel: t('reservationImport:preview.courses.courseName'),
                cell: course => (
                  <NativeSelect
                    value={courseChoice[course.sheetLabel] ?? courseChoiceOf(course)}
                    onChange={event => chooseCourse(course.sheetLabel, event.target.value)}
                  >
                    <option value="">{t('reservationImport:courses.unset')}</option>
                    {courses.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                    <option value={IGNORE_COURSE}>{t('reservationImport:courses.ignore')}</option>
                  </NativeSelect>
                ),
              },
              {
                key: 'resolution',
                header: t('reservationImport:courses.state'),
                mobileLabel: t('reservationImport:courses.state'),
                cell: course => (
                  <span className="text-2xs text-muted-foreground">
                    {t(`reservationImport:courses.resolution.${course.resolution}`)}
                    {course.candidates?.length ? `: ${course.candidates.join('、')}` : ''}
                  </span>
                ),
              },
              {
                key: 'days',
                header: t('reservationImport:preview.courses.days'),
                mobileLabel: t('reservationImport:preview.courses.days'),
                align: 'right',
                cell: course => Math.ceil(course.dayCount / 2),
              },
              {
                key: 'groups',
                header: t('reservationImport:preview.courses.groups'),
                mobileLabel: t('reservationImport:preview.courses.groups'),
                align: 'right',
                cell: course => course.totalGroups,
              },
              {
                key: 'caddieGroups',
                header: t('reservationImport:preview.courses.caddieGroups'),
                mobileLabel: t('reservationImport:preview.courses.caddieGroups'),
                align: 'right',
                cell: course => course.caddieGroups,
              },
            ]}
          />

          {mappingChanged ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                type="button"
                disabled={savingLinks}
                onClick={() => void saveCourseChoices()}
              >
                <Save />
                {savingLinks
                  ? t('reservationImport:courses.saving')
                  : t('reservationImport:courses.save')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('reservationImport:courses.saveHint')}
              </span>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {preview && preview.warnings.length > 0 ? (
        <Panel
          title={t('reservationImport:warnings.title')}
          description={t('reservationImport:warnings.description')}
        >
          <div className="grid gap-2">
            {preview.warnings.map((warning, index) => (
              <WarningLine
                key={`${warning.kind}-${warning.date ?? ''}-${index}`}
                warning={warning}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title={t('reservationImport:daily.title')}
        description={
          range ? t('reservationImport:daily.description', { from: range.from, to: range.to }) : ''
        }
        actions={(
          <Badge variant="neutral">
            <CalendarRange /> {t('reservationImport:preview.unit.days', { n: String(rows.length) })}
          </Badge>
        )}
      >
        {preview ? null : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <YearMonthPicker
              label={t('reservationImport:upload.month')}
              value={yearMonth}
              error={yearMonthError}
              onChange={setYearMonth}
              className="sm:w-64"
            />
            <Field
              requirement="none"
              label={t('reservationImport:daily.course')}
              className="sm:min-w-64"
            >
              <NativeSelect
                value={courseFilter}
                onChange={event => setCourseFilter(event.target.value)}
              >
                <option value="all">{t('reservationImport:daily.allCourses')}</option>
                {courses.map(course => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        )}

        {loading && !preview ? (
          <LoadingState label={t('common:state.loading')} />
        ) : loadError && !preview ? (
          <ResourceError error={loadError} onRetry={() => void load()} />
        ) : (
          <DataTable
            rows={rows}
            rowKey={row => row.date}
            empty={(
              <EmptyState
                title={t('reservationImport:daily.empty.title')}
                description={t('reservationImport:daily.empty.description')}
              />
            )}
            columns={[
              {
                key: 'date',
                header: t('reservationImport:daily.date'),
                mobileLabel: t('reservationImport:daily.date'),
                cell: row => formatMonthDay(row.date),
                sortValue: row => row.date,
              },
              {
                key: 'morning',
                header: t('reservationImport:daily.morning'),
                mobileLabel: t('reservationImport:daily.morning'),
                align: 'right',
                cell: row => `${row.morningGroups} (${row.morningCaddieGroups})`,
                sortValue: row => row.morningGroups,
              },
              {
                key: 'afternoon',
                header: t('reservationImport:daily.afternoon'),
                mobileLabel: t('reservationImport:daily.afternoon'),
                align: 'right',
                cell: row => `${row.afternoonGroups} (${row.afternoonCaddieGroups})`,
                sortValue: row => row.afternoonGroups,
              },
              {
                key: 'total',
                header: t('reservationImport:daily.total'),
                mobileLabel: t('reservationImport:daily.total'),
                align: 'right',
                cell: row => row.totalGroups,
                sortValue: row => row.totalGroups,
              },
              {
                key: 'caddieGroups',
                header: t('reservationImport:daily.caddieGroups'),
                mobileLabel: t('reservationImport:daily.caddieGroups'),
                align: 'right',
                cell: row => row.caddieGroups,
                sortValue: row => row.caddieGroups,
              },
            ]}
            defaultSort={{ key: 'date', direction: 'asc' }}
          />
        )}
      </Panel>
    </div>
  )
}
