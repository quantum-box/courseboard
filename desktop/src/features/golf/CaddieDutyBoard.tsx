import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { ClipboardList } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import {
  EmptyState,
  Field,
  LoadingState,
  NativeSelect,
  NativeTextarea,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useResource } from '../../hooks/useResource'
import { navigate } from '../../lib/router'
import { showToast } from '../../lib/toast'
import { CaddieLink } from './CaddieLink'
import {
  caddiesWithFreeHours,
  dutyWindowProblem,
  filedDuties,
  type CaddieDutyAssignment,
  type DutyCandidate,
  type DutyProfile,
  type DutyRoundAssignment,
  type DutyShift,
} from './caddieDuties'

const COURSE_API = '/v1/course'

type ListResponse<T> = { items: T[] }

type ShiftRow = {
  caddieProfileId: string
  date: string
  isWorking: boolean
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The day's non-round work: who is on it and for which hours, and who still
 * has hours free to be put on it.
 *
 * Work is filed against a stretch of the day, so a caddie sent to the range
 * until noon is out of the morning's caddie supply and back in for the
 * afternoon — the automatic run, the ranked candidates and the counts all read
 * the hours rather than the bare fact of a job.
 */
export function CaddieDutiesPanel({
  date,
  profiles,
  assignments,
  onChanged,
  onSummaryChange,
}: {
  date: string
  profiles: DutyProfile[]
  assignments: DutyRoundAssignment[]
  onChanged: () => void
  onSummaryChange?: (summary: { dutyCount: number | null; freeCount: number | null }) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [assigning, setAssigning] = useState(false)
  const [clearing, setClearing] = useState<string | null>(null)

  const filed = useResource(
    useCallback(
      () =>
        courseboardApiJson<ListResponse<CaddieDutyAssignment>>(
          `${COURSE_API}/caddie-duty-assignments?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`,
        ),
      [date],
    ),
    [date],
  )
  // Who the confirmed month has in today. A day nobody planned leaves this
  // empty, and the sheet then falls back to the whole active roster.
  const shifts = useResource(
    useCallback(
      () =>
        courseboardApiJson<ListResponse<ShiftRow>>(
          `${COURSE_API}/caddie-shifts?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`,
        ),
      [date],
    ),
    [date],
  )

  const duties = useMemo(() => filed.data?.items ?? [], [filed.data])
  const dayShifts = useMemo<DutyShift[]>(() => shifts.data?.items ?? [], [shifts.data])
  const rows = useMemo(() => filedDuties({ profiles, duties, date }), [profiles, duties, date])
  const dutyCaddieCount = useMemo(
    () => new Set(rows.map(row => row.duty.caddieProfileId)).size,
    [rows],
  )
  const free = useMemo(
    () => caddiesWithFreeHours({ profiles, assignments, shifts: dayShifts, duties, date }),
    [profiles, assignments, dayShifts, duties, date],
  )

  useEffect(() => {
    if (!onSummaryChange) return
    onSummaryChange({
      dutyCount: filed.loading || filed.error ? null : dutyCaddieCount,
      freeCount: filed.loading || filed.error || shifts.loading || shifts.error ? null : free.length,
    })
  }, [dutyCaddieCount, filed.error, filed.loading, free.length, onSummaryChange, shifts.error, shifts.loading])

  async function clear(duty: CaddieDutyAssignment, displayName: string) {
    setClearing(duty.id)
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-duty-assignments/${encodeURIComponent(duty.id)}`,
        { method: 'DELETE' },
      )
      showToast({
        tone: 'success',
        message: t('caddies:duties.cleared', { name: displayName }),
      })
      filed.refresh()
      onChanged()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('caddies:duties.failed'),
        message: errorMessage(error),
      })
    } finally {
      setClearing(null)
    }
  }

  return (
    <Panel
      title={t('caddies:duties.title')}
      description={t('caddies:duties.description')}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          {!filed.loading && !filed.error && !shifts.loading && !shifts.error ? (
            <Badge variant="neutral">
              {t('caddies:duties.freeCount', { n: String(free.length) })}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={free.length === 0}
            onClick={() => setAssigning(true)}
          >
            <ClipboardList />
            {t('caddies:duties.assign')}
          </Button>
        </div>
      )}
    >
      {filed.loading || shifts.loading ? (
        <LoadingState label={t('caddies:duties.loading')} />
      ) : null}
      {filed.error ? <ResourceError error={filed.error} onRetry={filed.refresh} /> : null}
      {/* The confirmed month only decides who the sheet offers. Losing it must
          not take the panel down: the hours already filed are still worth
          showing, and still worth clearing. */}
      {shifts.error ? <ResourceError error={shifts.error} onRetry={shifts.refresh} /> : null}

      {!filed.loading && !filed.error ? (
        <div className="space-y-2">
          {rows.length === 0 ? (
            <EmptyState
              title={t('caddies:duties.onDutyEmpty.title')}
              description={t('caddies:duties.onDutyEmpty.description')}
            />
          ) : (
            rows.map(row => (
              <div
                key={row.duty.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3"
              >
                <span className="font-mono text-sm font-semibold">
                  {row.duty.allDay
                    ? t('caddies:duties.allDay')
                    : `${row.duty.startTime}–${row.duty.endTime}`}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CaddieLink
                      caddieId={row.duty.caddieProfileId}
                      displayName={row.displayName}
                    />
                    <Badge variant="accent">{row.duty.dutyLabel}</Badge>
                  </div>
                  {row.duty.note ? (
                    <p className="text-xs text-muted-foreground">{row.duty.note}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={clearing !== null}
                  onClick={() => void clear(row.duty, row.displayName)}
                >
                  {clearing === row.duty.id
                    ? t('caddies:duties.clearing')
                    : t('caddies:duties.clear')}
                </Button>
              </div>
            ))
          )}
        </div>
      ) : null}

      <AssignDutySheet
        open={assigning}
        candidates={free}
        date={date}
        assignments={assignments}
        duties={duties}
        onClose={() => setAssigning(false)}
        onAssigned={() => {
          setAssigning(false)
          filed.refresh()
          onChanged()
        }}
      />
    </Panel>
  )
}

/** Where a whole-day window starts and ends, as the API reads it. */
const ALL_DAY = { start: '00:00', end: '24:00' }

/**
 * Put one caddie on one job for a stretch of the day.
 *
 * The jobs come from the club's own list rather than a free text box: a job
 * typed past the picker is one nothing else can group, count, or find again,
 * and the API refuses it for the same reason.
 */
export function AssignDutySheet({
  open,
  candidates,
  date,
  assignments,
  duties,
  onClose,
  onAssigned,
}: {
  open: boolean
  candidates: DutyCandidate[]
  date: string
  assignments: DutyRoundAssignment[]
  duties: CaddieDutyAssignment[]
  onClose: () => void
  onAssigned: () => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [caddieProfileId, setCaddieProfileId] = useState('')
  const [dutyLabel, setDutyLabel] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('12:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const options = useResource(
    useCallback(
      () => courseboardApiJson<ListResponse<string>>(`${COURSE_API}/caddie-duties`),
      [],
    ),
    [open],
    { enabled: open },
  )
  const items = useMemo(() => options.data?.items ?? [], [options.data])
  const caddie = candidates.find(item => item.caddieProfileId === caddieProfileId) ?? null

  const window = allDay ? ALL_DAY : { start: startTime, end: endTime }
  const problem = caddie
    ? dutyWindowProblem({
        startTime: window.start,
        endTime: window.end,
        caddieProfileId: caddie.caddieProfileId,
        assignments,
        duties,
        date,
      })
    : null

  function reset() {
    setCaddieProfileId('')
    setDutyLabel('')
    setAllDay(true)
    setStartTime('08:00')
    setEndTime('12:00')
    setNote('')
  }

  async function save() {
    if (!caddie || dutyLabel === '' || problem) return
    setSaving(true)
    try {
      await courseboardApiJson(`${COURSE_API}/caddie-duty-assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          caddieProfileId: caddie.caddieProfileId,
          date,
          dutyLabel,
          // Left off entirely for a whole day, which is what the API reads as
          // "the desk did not name hours".
          ...(allDay ? {} : { startTime, endTime }),
          note: note.trim() === '' ? null : note.trim(),
        }),
      })
      showToast({
        tone: 'success',
        message: t('caddies:duties.assigned', { name: caddie.displayName, duty: dutyLabel }),
      })
      reset()
      onAssigned()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('caddies:duties.failed'),
        message: errorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) {
          reset()
          onClose()
        }
      }}
      title={t('caddies:duties.sheetTitle')}
      description={t('caddies:duties.sheetDescription', { date })}
    >
      <div className="space-y-3">
        {options.loading ? <LoadingState label={t('caddies:duties.loadingOptions')} /> : null}
        {options.error ? <ResourceError error={options.error} onRetry={options.refresh} /> : null}
        {/* Nothing to pick from is a settings gap, not a failure of this
            screen, so the sheet says where the list is arranged. */}
        {!options.loading && !options.error && items.length === 0 ? (
          <EmptyState
            title={t('caddies:duties.noOptions.title')}
            description={t('caddies:duties.noOptions.description')}
            action={(
              <Button type="button" variant="secondary" onClick={() => navigate('settings/caddie-duties')}>
                {t('caddies:duties.noOptions.action')}
              </Button>
            )}
          />
        ) : null}

        <Field label={t('caddies:duties.caddieLabel')} requirement="required">
          <NativeSelect
            value={caddieProfileId}
            onChange={event => setCaddieProfileId(event.target.value)}
          >
            <option value="">{t('caddies:duties.caddiePlaceholder')}</option>
            {candidates.map(candidate => (
              <option key={candidate.caddieProfileId} value={candidate.caddieProfileId}>
                {[
                  candidate.displayName,
                  candidate.morningFree && candidate.afternoonFree
                    ? null
                    : t(
                        candidate.morningFree
                          ? 'caddies:duties.morningFree'
                          : 'caddies:duties.afternoonFree',
                      ),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {items.length > 0 ? (
          <Field label={t('caddies:duties.dutyLabel')} requirement="required">
            <NativeSelect
              value={dutyLabel}
              onChange={event => setDutyLabel(event.target.value)}
            >
              <option value="">{t('caddies:duties.dutyPlaceholder')}</option>
              {items.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field
          label={t('caddies:duties.hours')}
          requirement="none"
          hint={t('caddies:duties.hoursHint')}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allDay}
              onChange={event => setAllDay(event.target.checked)}
            />
            <span>{t('caddies:duties.allDay')}</span>
          </label>
        </Field>

        {!allDay ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('caddies:duties.startTime')} requirement="required" className="w-32">
              <Input
                type="time"
                value={startTime}
                onChange={event => setStartTime(event.target.value)}
              />
            </Field>
            <Field label={t('caddies:duties.endTime')} requirement="required" className="w-32">
              <Input
                type="time"
                value={endTime}
                onChange={event => setEndTime(event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {problem === 'order' ? (
          <Notice tone="danger">{t('caddies:duties.orderNotice')}</Notice>
        ) : null}
        {problem === 'clash' ? (
          <Notice tone="warning">{t('caddies:duties.clashNotice')}</Notice>
        ) : null}

        <Field
          label={t('caddies:duties.note')}
          requirement="none"
          hint={t('caddies:duties.noteHint')}
        >
          <NativeTextarea
            rows={3}
            value={note}
            onChange={event => setNote(event.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t('common:action.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || caddie === null || dutyLabel === '' || problem !== null}
            onClick={() => void save()}
          >
            {saving ? t('common:action.saving') : t('common:action.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
