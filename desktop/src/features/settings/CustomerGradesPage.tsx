import { Button, Input } from '@tachyon-sdk/native-ui'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Notice,
  Panel,
  ResourceError,
  type DataTableColumn,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import {
  customerGradeRulesPath,
  isBlankGradeRule,
  type CustomerGradeRule,
  type CustomerGradeRuleList,
} from '../golf/customers/visits'
import { SettingsSubPage } from './SettingsSubPage'

/** Matches the server's cap; more rungs than this is not a ladder. */
const MAX_RULES = 10

const EMPTY_RULE: CustomerGradeRule = { name: '', minVisits: 0 }

type GradeRow = { rule: CustomerGradeRule; index: number }

/** The rung the sheet is on: an existing rung, or a new one at the bottom. */
type GradeEdit = { index: number | null; rule: CustomerGradeRule }

/** A threshold left blank is not a condition, so the cell stays empty. */
function amount(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString('ja-JP') : ''
}

/**
 * The ladder a club sorts its regulars by.
 *
 * Not a membership. A member holds a plan the club sold them; a grade is what
 * the club works out from how somebody actually plays — so a visitor who comes
 * fortnightly can outrank a 正会員 nobody has seen in three years.
 *
 * Order is the judgement, not decoration: rungs are read top down and the first
 * one somebody reaches is the one they get. The table keeps that order, which
 * is why no column here sorts — a sorted view of a ladder would show a reading
 * the server never makes.
 */
export function CustomerGradesPage() {
  const { t } = useTranslation(['settings', 'common'])
  const resource = useResource(
    () => courseboardApiJson<CustomerGradeRuleList>(customerGradeRulesPath),
    [],
    { cacheKey: 'customer:grade-rules' },
  )
  useRegisterPageReload(resource.refresh)
  const [editing, setEditing] = useState<GradeEdit | null>(null)
  const [saving, setSaving] = useState(false)

  const rules = useMemo(() => resource.data?.items ?? [], [resource.data])
  const rows = useMemo<GradeRow[]>(
    () => rules.map((rule, index) => ({ rule, index })),
    [rules],
  )

  /** The API takes the whole ladder, so every edit writes all of it. */
  async function commit(next: CustomerGradeRule[]) {
    setSaving(true)
    try {
      await courseboardApiJson<CustomerGradeRuleList>(customerGradeRulesPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: next.filter(rule => !isBlankGradeRule(rule)) }),
      })
      showToast({ tone: 'success', message: t('settings:grades.saved') })
      setEditing(null)
      await resource.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('settings:grades.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved as CustomerGradeRule)
    void commit(next)
  }

  const columns = useMemo<DataTableColumn<GradeRow>[]>(
    () => [
      {
        key: 'rank',
        header: t('settings:grades.rank'),
        align: 'right',
        cell: row => row.index + 1,
      },
      {
        key: 'name',
        header: t('settings:grades.field.name'),
        cell: row => row.rule.name,
      },
      {
        key: 'minVisits',
        header: t('settings:grades.field.minVisits'),
        align: 'right',
        cell: row => amount(row.rule.minVisits),
      },
      {
        key: 'minSpendPerPlayer',
        header: t('settings:grades.field.minSpendPerPlayer'),
        align: 'right',
        cell: row => amount(row.rule.minSpendPerPlayer),
      },
      {
        key: 'minTotalAmount',
        header: t('settings:grades.field.minTotalAmount'),
        align: 'right',
        cell: row => amount(row.rule.minTotalAmount),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: row => (
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('settings:grades.moveUp')}
              disabled={saving || row.index === 0}
              onClick={event => {
                event.stopPropagation()
                move(row.index, -1)
              }}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('settings:grades.moveDown')}
              disabled={saving || row.index === rules.length - 1}
              onClick={event => {
                event.stopPropagation()
                move(row.index, 1)
              }}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('settings:grades.remove')}
              disabled={saving}
              onClick={event => {
                event.stopPropagation()
                void commit(rules.filter((_, position) => position !== row.index))
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ),
      },
    ],
    // `move` and `commit` close over the same ladder these deps track.
    [t, rules, saving],
  )

  const draft = editing
    ? editing.index === null
      ? [...rules, editing.rule]
      : rules.map((rule, position) => (position === editing.index ? editing.rule : rule))
    : rules
  const named = draft.filter(rule => !isBlankGradeRule(rule))
  const duplicate = named.some(
    (rule, index) => named.findIndex(other => other.name.trim() === rule.name.trim()) !== index,
  )

  return (
    <SettingsSubPage>
      <Panel
        title={t('settings:grades.title')}
        description={t('settings:grades.description')}
        actions={
          <Button
            type="button"
            size="sm"
            disabled={rules.length >= MAX_RULES}
            onClick={() => setEditing({ index: null, rule: { ...EMPTY_RULE } })}
          >
            <Plus />
            {t('settings:grades.add')}
          </Button>
        }
      >
        {resource.loading ? <LoadingState /> : null}
        {resource.error ? (
          <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
        ) : null}

        {/* Said above the table because it is the thing an operator gets
            wrong: the order is the rule, not a sort. */}
        {!resource.loading && !resource.error && rules.length > 0 ? (
          <Notice tone="info">{t('settings:grades.hint')}</Notice>
        ) : null}

        {!resource.loading && !resource.error ? (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={row => String(row.index)}
            onRowClick={row => setEditing({ index: row.index, rule: { ...row.rule } })}
            empty={
              <EmptyState
                title={t('settings:grades.emptyTitle')}
                description={t('settings:grades.empty')}
              />
            }
          />
        ) : null}
      </Panel>

      <Sheet
        open={editing !== null}
        onOpenChange={open => {
          if (!open) setEditing(null)
        }}
        title={t(editing?.index === null ? 'settings:grades.addTitle' : 'settings:grades.editTitle')}
        description={t('settings:grades.sheetHint')}
      >
        {editing ? (
          <GradeForm
            rule={editing.rule}
            onChange={rule => setEditing({ ...editing, rule })}
            duplicate={duplicate}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={() => void commit(draft)}
          />
        ) : null}
      </Sheet>
    </SettingsSubPage>
  )
}

function GradeForm({
  rule,
  onChange,
  duplicate,
  saving,
  onCancel,
  onSave,
}: {
  rule: CustomerGradeRule
  onChange: (rule: CustomerGradeRule) => void
  duplicate: boolean
  saving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  // A blank box asks nothing rather than zero, which is why the optional
  // thresholds go back to null instead of 0 when the operator clears them.
  const optional = (value: string) => (value === '' ? null : Math.max(0, Number(value) || 0))

  return (
    <div className="space-y-3">
      <Field label={t('settings:grades.field.name')} requirement="required">
        <Input
          value={rule.name}
          placeholder={t('settings:grades.placeholder.name')}
          onChange={event => onChange({ ...rule, name: event.target.value })}
        />
      </Field>

      <FormGrid columns={1}>
        <Field label={t('settings:grades.field.minVisits')} requirement="none">
          <Input
            type="number"
            min={0}
            value={String(rule.minVisits)}
            onChange={event =>
              onChange({ ...rule, minVisits: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </Field>
        <Field label={t('settings:grades.field.minSpendPerPlayer')} requirement="none">
          <Input
            type="number"
            min={0}
            value={rule.minSpendPerPlayer == null ? '' : String(rule.minSpendPerPlayer)}
            onChange={event =>
              onChange({ ...rule, minSpendPerPlayer: optional(event.target.value) })
            }
          />
        </Field>
        <Field label={t('settings:grades.field.minTotalAmount')} requirement="none">
          <Input
            type="number"
            min={0}
            value={rule.minTotalAmount == null ? '' : String(rule.minTotalAmount)}
            onChange={event => onChange({ ...rule, minTotalAmount: optional(event.target.value) })}
          />
        </Field>
      </FormGrid>

      {duplicate ? <Notice tone="danger">{t('settings:grades.duplicate')}</Notice> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common:action.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={saving || rule.name.trim() === '' || duplicate}
          onClick={onSave}
        >
          {saving ? t('common:action.saving') : t('common:action.save')}
        </Button>
      </div>
    </div>
  )
}
