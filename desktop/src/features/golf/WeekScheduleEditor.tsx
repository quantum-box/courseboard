import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '../../components/Page'
import { weekdayIndexes, weekdayLabel } from './models'
import {
  bandStartCount,
  collectRuleIssues,
  copyWeekdayRules,
  nextRuleForWeekday,
  normalizeRule,
  ruleIssueText,
  sortRules,
  type GolfAvailabilityRule,
  type RuleIssueCode,
} from './schedule'

/**
 * `clientKey` keeps a band identifiable while it is being edited: a saved band
 * has an id, one the operator just added has nothing else to key React on, and
 * both move around as the week gets sorted. `isNew` is separate from the
 * absence of an id so a malformed persisted row cannot silently turn into a
 * create when the whole week is saved.
 */
export type EditableRule = GolfAvailabilityRule & { clientKey: string; isNew: boolean }

let clientRuleSequence = 0

function editableRule(rule: GolfAvailabilityRule, isNew: boolean): EditableRule {
  clientRuleSequence += 1
  return {
    ...normalizeRule(rule),
    clientKey: rule.id ?? `${isNew ? 'local' : 'persisted'}-rule-${clientRuleSequence}`,
    isNew,
  }
}

export function toEditableRule(rule: GolfAvailabilityRule): EditableRule {
  return editableRule(rule, false)
}

function toNewEditableRule(rule: GolfAvailabilityRule): EditableRule {
  return editableRule(rule, true)
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const
const WEEKEND = [6, 0] as const

type CopyTarget = { value: string; label: string; targets: number[] }

/**
 * The course's whole week, one card per weekday, including the days it stays
 * shut — a closed Thursday is a decision that has to be visible and reversible.
 */
export function WeekScheduleEditor({
  rules,
  onChange,
  disabled = false,
}: {
  rules: EditableRule[]
  onChange: (next: EditableRule[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation(['schedule', 'common'])
  const issues = collectRuleIssues(rules)
  const issuesByKey = new Map(rules.map((rule, index) => [rule.clientKey, issues[index]]))

  function updateRule(clientKey: string, patch: Partial<EditableRule>) {
    onChange(rules.map(rule => (rule.clientKey === clientKey ? { ...rule, ...patch } : rule)))
  }

  function addRule(weekday: number) {
    onChange([...rules, toNewEditableRule(nextRuleForWeekday(rules, weekday))])
  }

  function removeRule(clientKey: string) {
    onChange(rules.filter(rule => rule.clientKey !== clientKey))
  }

  /**
   * No message: the target weekdays fill in where the operator is already
   * looking, and the unsaved bar names the count.
   */
  function copyWeekday(from: number, target: CopyTarget) {
    const copied = copyWeekdayRules(rules, from, target.targets)
    onChange(copied.map(rule => (
      'clientKey' in rule ? rule as EditableRule : toNewEditableRule(rule)
    )))
  }

  function copyTargets(from: number): CopyTarget[] {
    const groups: CopyTarget[] = [
      { value: 'group:weekdays', label: t('schedule:copyWeekdays'), targets: [...WEEKDAYS] },
      { value: 'group:weekend', label: t('schedule:copyWeekend'), targets: [...WEEKEND] },
      { value: 'group:all', label: t('schedule:copyAll'), targets: weekdayIndexes },
    ]
    const days = weekdayIndexes
      .filter(weekday => weekday !== from)
      .map(weekday => ({
        value: `day:${weekday}`,
        label: t('schedule:copyDay', { day: weekdayLabel(weekday) }),
        targets: [weekday],
      }))
    return [...groups, ...days]
  }

  return (
    <div className="slot-week">
      {weekdayIndexes.map(weekday => {
        const dayRules = sortRules(rules.filter(rule => rule.weekday === weekday))
        const targets = copyTargets(weekday)
        const dayName = weekdayLabel(weekday)

        return (
          <section
            key={weekday}
            className={`slot-day${dayRules.length === 0 ? ' is-empty' : ''}`}
            aria-label={t('schedule:dayLabel', { day: dayName })}
          >
            <header className="slot-day-header">
              <strong className="slot-day-name">
                {t('schedule:dayLabel', { day: dayName })}
              </strong>
              {dayRules.length > 0 ? (
                <Badge variant="outline">
                  {t('schedule:bandCount', { n: String(dayRules.length) })}
                </Badge>
              ) : (
                <span className="slot-day-closed">{t('schedule:closed')}</span>
              )}
              <div className="slot-day-tools">
                {dayRules.length > 0 ? (
                  <NativeSelect
                    className="slot-copy-select"
                    aria-label={t('schedule:copyAria', { day: dayName })}
                    value=""
                    disabled={disabled}
                    onChange={event => {
                      const picked = targets.find(target => target.value === event.target.value)
                      if (picked) copyWeekday(weekday, picked)
                    }}
                  >
                    <option value="">{t('schedule:copyPlaceholder')}</option>
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
                  aria-label={t('schedule:addAria', { day: dayName })}
                  onClick={() => addRule(weekday)}
                >
                  <Plus /> {t('schedule:add')}
                </Button>
              </div>
            </header>

            {dayRules.length > 0 ? (
              <div className="slot-rows">
                {dayRules.map(rule => (
                  <RuleRow
                    key={rule.clientKey}
                    rule={rule}
                    dayName={dayName}
                    issues={issuesByKey.get(rule.clientKey) ?? []}
                    disabled={disabled}
                    onChange={patch => updateRule(rule.clientKey, patch)}
                    onRemove={() => removeRule(rule.clientKey)}
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

function RuleRow({
  rule,
  dayName,
  issues,
  disabled,
  onChange,
  onRemove,
}: {
  rule: EditableRule
  dayName: string
  issues: RuleIssueCode[]
  disabled: boolean
  onChange: (patch: Partial<EditableRule>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation(['schedule', 'common'])
  const band = `${rule.startTime}–${rule.endTime}`
  const starts = bandStartCount(rule)

  return (
    <div className={`slot-row${issues.length > 0 ? ' has-issue' : ''}`}>
      <Input
        className="slot-time"
        type="time"
        aria-label={t('schedule:startAria', { day: dayName, band })}
        value={rule.startTime}
        disabled={disabled}
        onChange={event => onChange({ startTime: event.target.value })}
      />
      <span className="slot-range-sep" aria-hidden="true">–</span>
      <Input
        className="slot-time"
        type="time"
        aria-label={t('schedule:endAria', { day: dayName, band })}
        value={rule.endTime}
        disabled={disabled}
        onChange={event => onChange({ endTime: event.target.value })}
      />

      <span className="slot-count" title={t('schedule:capacity')}>
        <Input
          className="slot-number"
          type="number"
          min={1}
          step={1}
          aria-label={t('schedule:capacityAria', { day: dayName, band })}
          value={rule.capacity}
          disabled={disabled}
          onChange={event => onChange({ capacity: Number(event.target.value) })}
        />
        <span className="slot-unit">{t('schedule:unitGroups')}</span>
      </span>

      <span className="slot-count" title={t('schedule:interval')}>
        <Input
          className="slot-number"
          type="number"
          min={1}
          step={1}
          aria-label={t('schedule:intervalAria', { day: dayName, band })}
          value={rule.slotIntervalMinutes}
          disabled={disabled}
          onChange={event => onChange({ slotIntervalMinutes: Number(event.target.value) })}
        />
        <span className="slot-unit">{t('schedule:unitInterval')}</span>
      </span>

      {/* What this band actually puts on sale. The two numbers beside it decide
          it, but neither one says it on its own. */}
      {issues.length === 0 && starts !== null ? (
        <span className="slot-starts">{t('schedule:starts', { n: String(starts) })}</span>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="slot-row-remove"
        disabled={disabled}
        aria-label={t('schedule:deleteAria', { day: dayName, time: rule.startTime })}
        onClick={onRemove}
      >
        <Trash2 /> {t('common:action.delete')}
      </Button>

      {issues.length > 0 ? (
        <p className="slot-row-issues" role="alert">
          {issues.map(code => ruleIssueText(code)).join(' ')}
        </p>
      ) : null}
    </div>
  )
}
