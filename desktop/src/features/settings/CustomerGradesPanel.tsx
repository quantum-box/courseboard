import { Button, Input } from '@tachyon-sdk/native-ui'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import { Field, LoadingState, Notice, Panel, ResourceError } from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { showToast } from '../../lib/toast'
import {
  customerGradeRulesPath,
  isBlankGradeRule,
  type CustomerGradeRule,
  type CustomerGradeRuleList,
} from '../golf/customers/visits'

/** Matches the server's cap; more rungs than this is not a ladder. */
const MAX_RULES = 10

const EMPTY_RULE: CustomerGradeRule = { name: '', minVisits: 0 }

/**
 * The ladder a club sorts its regulars by.
 *
 * Not a membership. A member holds a plan the club sold them; a grade is what
 * the club works out from how somebody actually plays — so a visitor who comes
 * fortnightly can outrank a 正会員 nobody has seen in three years.
 *
 * Order is the judgement, not decoration: rungs are read top down and the first
 * one somebody reaches is the one they get. A club that wants 来場回数 to
 * outrank spend puts it higher, rather than arguing with a sort.
 */
export function CustomerGradesPanel() {
  const { t } = useTranslation(['settings', 'common'])
  const resource = useResource(
    () => courseboardApiJson<CustomerGradeRuleList>(customerGradeRulesPath),
    [],
    { cacheKey: 'customer:grade-rules' },
  )
  const [draft, setDraft] = useState<CustomerGradeRule[] | null>(null)
  const [saving, setSaving] = useState(false)

  // The saved ladder becomes the draft once it arrives; edits stay local until
  // the operator saves, so a half-arranged ladder never reaches a customer.
  useEffect(() => {
    if (resource.data) setDraft(resource.data.items)
  }, [resource.data])

  const rules = draft ?? []
  const named = rules.filter(rule => !isBlankGradeRule(rule))
  const duplicate = named.some(
    (rule, index) => named.findIndex(other => other.name.trim() === rule.name.trim()) !== index,
  )

  const update = (index: number, patch: Partial<CustomerGradeRule>) => {
    setDraft(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)))
  }

  const save = async () => {
    if (duplicate) return
    setSaving(true)
    try {
      await courseboardApiJson<CustomerGradeRuleList>(customerGradeRulesPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: named }),
      })
      showToast({ tone: 'success', message: t('settings:grades.saved') })
      await resource.refresh()
    } catch (saveError) {
      showToast({
        tone: 'danger',
        title: t('settings:grades.failed'),
        message: saveError instanceof Error ? saveError.message : String(saveError),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title={t('settings:grades.title')}
      description={t('settings:grades.description')}
      actions={
        <Button type="button" onClick={() => void save()} disabled={saving || duplicate}>
          {t('common:action.save')}
        </Button>
      }
    >
      {resource.loading ? <LoadingState /> : null}
      {resource.error ? (
        <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
      ) : null}

      {draft ? (
        <>
          {/* Said where the thresholds are typed, because it is the thing an
              operator gets wrong: a blank box asks nothing rather than zero. */}
          <Notice tone="info">{t('settings:grades.hint')}</Notice>

          {duplicate ? (
            <Notice tone="danger">{t('settings:grades.duplicate')}</Notice>
          ) : null}

          <ul className="settings-rows">
            {rules.length > 0 ? (
              <li className="settings-rows__head customer-grade-row" aria-hidden="true">
                <span />
                <span>{t('settings:grades.field.name')}</span>
                <span>{t('settings:grades.field.minVisits')}</span>
                <span>{t('settings:grades.field.minSpendPerPlayer')}</span>
                <span>{t('settings:grades.field.minTotalAmount')}</span>
                <span />
              </li>
            ) : null}
            {rules.map((rule, index) => (
              // Index-keyed on purpose: rows are positional here, and keying by
              // name would remount every row as the operator types one.
              // eslint-disable-next-line react/no-array-index-key
              <li className="settings-rows__row customer-grade-row" key={index}>
                <span className="settings-rows__rank">{index + 1}</span>
                <Field label={t('settings:grades.field.name')}>
                  <Input
                    value={rule.name}
                    onChange={event => update(index, { name: event.target.value })}
                    placeholder={t('settings:grades.placeholder.name')}
                  />
                </Field>
                <Field label={t('settings:grades.field.minVisits')}>
                  <Input
                    type="number"
                    min={0}
                    value={String(rule.minVisits)}
                    onChange={event =>
                      update(index, { minVisits: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </Field>
                <Field label={t('settings:grades.field.minSpendPerPlayer')}>
                  <Input
                    type="number"
                    min={0}
                    value={rule.minSpendPerPlayer == null ? '' : String(rule.minSpendPerPlayer)}
                    onChange={event =>
                      update(index, {
                        minSpendPerPlayer:
                          event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label={t('settings:grades.field.minTotalAmount')}>
                  <Input
                    type="number"
                    min={0}
                    value={rule.minTotalAmount == null ? '' : String(rule.minTotalAmount)}
                    onChange={event =>
                      update(index, {
                        minTotalAmount:
                          event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('settings:grades.remove')}
                  onClick={() => setDraft(rules.filter((_, position) => position !== index))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>

          {rules.length === 0 ? (
            <Notice tone="info">{t('settings:grades.empty')}</Notice>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={rules.length >= MAX_RULES}
            onClick={() => setDraft([...rules, { ...EMPTY_RULE }])}
          >
            <Plus />
            {t('settings:grades.add')}
          </Button>
        </>
      ) : null}
    </Panel>
  )
}
