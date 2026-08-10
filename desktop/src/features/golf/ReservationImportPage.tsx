import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { CalendarRange, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react'
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson, currentYearMonth } from '../../api'
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
  dailyRows,
  formatMonthDay,
  formatYearMonth,
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const range = useMemo(
    () => monthBounds(yearMonth) ?? monthBounds(currentYearMonth()),
    [yearMonth],
  )

  const load = useCallback(async () => {
    if (!range) return
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
      setCourses(coursePayload.items)
      setStored(summaryPayload.items)
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [courseFilter, range])

  useEffect(() => {
    void load()
  }, [load])
  useRegisterPageReload(load)

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setUploadError(null)
    setPreview(null)
    setFile(event.target.files?.[0] ?? null)
  }

  function discard() {
    setPreview(null)
    setFile(null)
    setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /**
   * The month is read from the file name on the server, so the picker is only
   * sent once the server has said it could not find one. Parsing the name in
   * two places is how the two would come to disagree.
   */
  function importPath(step: 'preview' | 'import', withMonth: boolean) {
    const params = new URLSearchParams()
    if (file) params.set('fileName', file.name)
    if (withMonth) params.set('yearMonth', yearMonth)
    return `/v1/course/reservation-summaries/${step}?${params.toString()}`
  }

  async function send(step: 'preview' | 'import') {
    if (!file) return null
    const body = await file.arrayBuffer()
    const request = {
      method: 'POST',
      headers: { 'Content-Type': WORKBOOK_CONTENT_TYPE },
      body,
    } as const
    try {
      return await courseboardApiJson<ReservationImportResult>(
        importPath(step, false),
        request,
      )
    } catch (error) {
      // The one error the desk can answer: say which month, then retry with it.
      const needsMonth =
        error instanceof Error && error.message.includes('does not say which month')
      if (!needsMonth) throw error
      return await courseboardApiJson<ReservationImportResult>(
        importPath(step, true),
        request,
      )
    }
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
      // Follow the file's month rather than whatever the picker was left on,
      // so the table below shows what was just imported.
      setYearMonth(result.yearMonth)
      discard()
      await load()
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('reservationImport:error.failed'))
    } finally {
      setApplying(false)
    }
  }

  const totals = useMemo(
    () => (preview ? importTotals(preview.courses) : null),
    [preview],
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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="lg"
              type="button"
              disabled={!file || checking || applying}
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
                  disabled={applying}
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

          <DataTable
            rows={preview.courses}
            rowKey={course => course.golfCourseId}
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
                cell: course => course.courseName,
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
