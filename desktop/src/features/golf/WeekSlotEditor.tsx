import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '../../components/Page'
import {
  collectSlotIssues,
  collectSlotOvercommits,
  copyWeekdaySlots,
  nextSlotForWeekday,
  normalizeSlot,
  slotIssueText,
  sortSlots,
  weekdayIndexes,
  weekdayLabel,
  type GolfProductSlot,
  type SlotIssueCode,
} from './models'

/**
 * `clientKey` keeps a row identifiable while it is being edited: a saved row
 * has an id, a row the operator just added has nothing else to key React on,
 * and both move around as the week gets sorted by weekday and time.
 */
export type EditableSlot = GolfProductSlot & { clientKey: string }

let clientSlotSequence = 0

export function toEditableSlot(slot: GolfProductSlot): EditableSlot {
  clientSlotSequence += 1
  return {
    ...normalizeSlot(slot),
    clientKey: slot.id ?? `local-slot-${clientSlotSequence}`,
  }
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const
const WEEKEND = [6, 0] as const

type CopyTarget = { value: string; label: string; targets: number[] }

/**
 * The whole week, one card per weekday, including the days that take no
 * bookings — a closed Thursday is a decision the operator has to be able to see
 * and reverse, and a flat list of rows never showed it.
 */
export function WeekSlotEditor({
  slots,
  onChange,
  startIntervalMinutes,
  disabled = false,
}: {
  slots: EditableSlot[]
  onChange: (next: EditableSlot[]) => void
  /** Tee interval of the course this plan is sold on, when it names one. */
  startIntervalMinutes?: number | null
  disabled?: boolean
}) {
  const { t } = useTranslation(['products', 'common'])
  const issues = collectSlotIssues(slots)
  const issuesByKey = new Map(slots.map((slot, index) => [slot.clientKey, issues[index]]))
  const overcommits = collectSlotOvercommits(slots, startIntervalMinutes)
  const overcommitByKey = new Map(slots.map((slot, index) => [slot.clientKey, overcommits[index]]))

  function updateSlot(clientKey: string, patch: Partial<EditableSlot>) {
    onChange(slots.map(slot => (slot.clientKey === clientKey ? { ...slot, ...patch } : slot)))
  }

  function addSlot(weekday: number) {
    onChange([...slots, toEditableSlot(nextSlotForWeekday(slots, weekday))])
  }

  function removeSlot(clientKey: string) {
    onChange(slots.filter(slot => slot.clientKey !== clientKey))
  }

  /**
   * No toast: the target weekdays fill in where the operator is already
   * looking, and the unsaved bar names the count. A message on top of that only
   * covered the save button it was telling them to press.
   */
  function copyWeekday(from: number, target: CopyTarget) {
    const copied = copyWeekdaySlots(slots, from, target.targets)
    onChange(copied.map(slot => ('clientKey' in slot ? slot as EditableSlot : toEditableSlot(slot))))
  }

  function copyTargets(from: number): CopyTarget[] {
    const groups: CopyTarget[] = [
      {
        value: 'group:weekdays',
        label: t('products:slots.week.copyWeekdays'),
        targets: [...WEEKDAYS],
      },
      {
        value: 'group:weekend',
        label: t('products:slots.week.copyWeekend'),
        targets: [...WEEKEND],
      },
      {
        value: 'group:all',
        label: t('products:slots.week.copyAll'),
        targets: weekdayIndexes,
      },
    ]
    const days = weekdayIndexes
      .filter(weekday => weekday !== from)
      .map(weekday => ({
        value: `day:${weekday}`,
        label: t('products:slots.week.copyDay', { day: weekdayLabel(weekday) }),
        targets: [weekday],
      }))
    return [...groups, ...days]
  }

  return (
    <div className="slot-week">
      {weekdayIndexes.map(weekday => {
        const daySlots = sortSlots(slots.filter(slot => slot.weekday === weekday))
        const targets = copyTargets(weekday)
        const dayName = weekdayLabel(weekday)

        return (
          <section
            key={weekday}
            className={`slot-day${daySlots.length === 0 ? ' is-empty' : ''}`}
            aria-label={t('products:slots.week.dayLabel', { day: dayName })}
          >
            <header className="slot-day-header">
              <strong className="slot-day-name">
                {t('products:slots.week.dayLabel', { day: dayName })}
              </strong>
              {daySlots.length > 0 ? (
                <Badge variant="outline">
                  {t('products:slots.week.slotCount', { n: String(daySlots.length) })}
                </Badge>
              ) : (
                <span className="slot-day-closed">{t('products:slots.week.closed')}</span>
              )}
              <div className="slot-day-tools">
                {daySlots.length > 0 ? (
                  <NativeSelect
                    className="slot-copy-select"
                    aria-label={t('products:slots.week.copyAria', { day: dayName })}
                    value=""
                    disabled={disabled}
                    onChange={event => {
                      const picked = targets.find(target => target.value === event.target.value)
                      if (picked) copyWeekday(weekday, picked)
                    }}
                  >
                    <option value="">{t('products:slots.week.copyPlaceholder')}</option>
                    {targets.map(target => (
                      <option key={target.value} value={target.value}>{target.label}</option>
                    ))}
                  </NativeSelect>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={t('products:slots.week.addAria', { day: dayName })}
                  onClick={() => addSlot(weekday)}
                >
                  <Plus /> {t('products:slots.week.add')}
                </Button>
              </div>
            </header>

            {daySlots.length > 0 ? (
              <div className="slot-rows">
                {daySlots.map(slot => (
                  <SlotRow
                    key={slot.clientKey}
                    slot={slot}
                    dayName={dayName}
                    issues={issuesByKey.get(slot.clientKey) ?? []}
                    overcommitCapacity={overcommitByKey.get(slot.clientKey) ?? null}
                    startIntervalMinutes={startIntervalMinutes}
                    disabled={disabled}
                    onChange={patch => updateSlot(slot.clientKey, patch)}
                    onRemove={() => removeSlot(slot.clientKey)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function SlotRow({
  slot,
  dayName,
  issues,
  overcommitCapacity,
  startIntervalMinutes,
  disabled,
  onChange,
  onRemove,
}: {
  slot: EditableSlot
  dayName: string
  issues: SlotIssueCode[]
  /** Groups the course can actually start here, when the row asks for more. */
  overcommitCapacity: number | null
  startIntervalMinutes?: number | null
  disabled: boolean
  onChange: (patch: Partial<EditableSlot>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation(['products', 'common'])
  const band = `${slot.startTime}–${slot.endTime}`

  return (
    <div className={`slot-row${issues.length > 0 ? ' has-issue' : ''}`}>
      <Input
        className="slot-time"
        type="time"
        aria-label={t('products:slots.week.startAria', { day: dayName, band })}
        value={slot.startTime}
        disabled={disabled}
        onChange={event => onChange({ startTime: event.target.value })}
      />
      <span className="slot-range-sep" aria-hidden="true">–</span>
      <Input
        className="slot-time"
        type="time"
        aria-label={t('products:slots.week.endAria', { day: dayName, band })}
        value={slot.endTime}
        disabled={disabled}
        onChange={event => onChange({ endTime: event.target.value })}
      />

      <SlotCount
        label={t('products:slots.table.maxGroups')}
        unit={t('products:slots.week.unitGroups')}
        aria={t('products:slots.week.groupsAria', { day: dayName, band })}
        value={slot.maxGroups}
        disabled={disabled}
        onChange={maxGroups => onChange({ maxGroups })}
      />
      <SlotCount
        label={t('products:slots.table.maxPlayers')}
        unit={t('products:slots.week.unitPlayers')}
        aria={t('products:slots.week.playersAria', { day: dayName, band })}
        value={slot.maxPlayers}
        disabled={disabled}
        onChange={maxPlayers => onChange({ maxPlayers })}
      />

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="slot-row-remove"
        disabled={disabled}
        aria-label={t('products:slots.table.deleteAria', { day: dayName, time: slot.startTime })}
        onClick={onRemove}
      >
        <Trash2 /> {t('common:action.delete')}
      </Button>

      {issues.length > 0 ? (
        <p className="slot-row-issues" role="alert">
          {issues.map(code => slotIssueText(code)).join(' ')}
        </p>
      ) : null}

      {/* A warning, not an issue: selling more groups than the tee can start is
          a decision the operator may have a reason for, so saving still works. */}
      {issues.length === 0 && overcommitCapacity !== null ? (
        <p className="slot-row-warning">
          {t('products:slots.week.overCapacity', {
            n: String(overcommitCapacity),
            interval: String(startIntervalMinutes ?? 0),
          })}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A count with its unit attached, because "4" alone reads as neither groups nor
 * players, and 0 means unlimited — a rule that used to live only in the panel
 * description, three scroll positions away from the field it governs.
 */
function SlotCount({
  label,
  unit,
  aria,
  value,
  disabled,
  onChange,
}: {
  label: string
  unit: string
  aria: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const { t } = useTranslation('products')
  return (
    <span className="slot-count" title={label}>
      <Input
        className="slot-number"
        type="number"
        min={0}
        step={1}
        aria-label={aria}
        value={value}
        disabled={disabled}
        onChange={event => onChange(Number(event.target.value))}
      />
      <span className="slot-unit">{unit}</span>
      {value === 0 ? (
        <span className="slot-unlimited">{t('slots.week.unlimited')}</span>
      ) : null}
    </span>
  )
}
