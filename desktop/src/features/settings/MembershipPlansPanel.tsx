import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import {
  Field,
  FormGrid,
  LoadingState,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { showToast } from '../../lib/toast'
import {
  emptyPlanDraft,
  membershipPlansPath,
  planDraft,
  planRequestBody,
  validatePlanDraft,
  type MembershipPlan,
  type MembershipPlanDraft,
  type MembershipPlanList,
} from '../golf/customers/membership'

/**
 * The memberships a course sells.
 *
 * What a club calls them is theirs — 正会員, 平日会員, 株主会員, 法人会員 — so
 * this is a list they write, not a fixed set to choose from. The one rule
 * CourseBoard imposes is the reading of it: a customer holding one of these is
 * a member, and everyone else is a visitor.
 *
 * Retiring a plan does not touch the people already holding it. A course that
 * stops selling 株主会員 still has 株主会員 members, and deleting the plan to
 * mean "stop selling it" would erase what they are.
 */
export function MembershipPlansPanel() {
  const { t } = useTranslation(['settings', 'common'])
  // Inactive plans included: the settings screen is the only place a retired
  // plan can be brought back, so it is the one screen that has to show it.
  const plansResource = useResource(
    () => courseboardApiJson<MembershipPlanList>(`${membershipPlansPath}?includeInactive=true`),
    [],
    { cacheKey: 'membership:plans:all' },
  )
  const [editing, setEditing] = useState<MembershipPlanDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const plans = plansResource.data?.items ?? []
  const error = editing ? validatePlanDraft(editing) : null

  const save = async () => {
    if (!editing || error) return
    setSaving(true)
    try {
      await courseboardApiJson<MembershipPlan>(
        editing.id ? `${membershipPlansPath}/${encodeURIComponent(editing.id)}` : membershipPlansPath,
        {
          method: editing.id ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(planRequestBody(editing)),
        },
      )
      showToast({ tone: 'success', message: t('settings:membership.saved') })
      setEditing(null)
      await plansResource.refresh()
    } catch (saveError) {
      showToast({
        tone: 'danger',
        title: t('settings:membership.failed'),
        message: saveError instanceof Error ? saveError.message : String(saveError),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title={t('settings:membership.title')}
      description={t('settings:membership.description')}
    >
      {plansResource.loading ? <LoadingState /> : null}
      {plansResource.error ? (
        <ResourceError error={plansResource.error} onRetry={() => void plansResource.refresh()} />
      ) : null}

      {!plansResource.loading && !plansResource.error && plans.length === 0 ? (
        <Notice tone="info">{t('settings:membership.empty')}</Notice>
      ) : null}

      <ul className="membership-plan-list">
        {plans.map(plan => (
          <li className="membership-plan-row" key={plan.id}>
            <span className="membership-plan-row__name">
              {plan.name}
              {/* A retired plan still has members; the badge says it is no
                  longer sold, not that it stopped counting. */}
              {plan.active ? null : (
                <Badge variant="neutral">{t('settings:membership.retired')}</Badge>
              )}
            </span>
            <span className="membership-plan-row__detail">
              {typeof plan.feeJpy === 'number'
                ? t('settings:membership.feeValue', { fee: plan.feeJpy.toLocaleString('ja-JP') })
                : t('settings:membership.noFee')}
              {typeof plan.validDays === 'number'
                ? ` · ${t('settings:membership.validDaysValue', { days: String(plan.validDays) })}`
                : ` · ${t('settings:membership.noExpiry')}`}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(planDraft(plan))}>
              {t('common:action.edit')}
            </Button>
          </li>
        ))}
      </ul>

      {editing ? (
        <div className="membership-plan-editor">
          <FormGrid columns={2}>
            <Field label={t('settings:membership.name')}>
              <Input
                value={editing.name}
                placeholder={t('settings:membership.namePlaceholder')}
                onChange={event => setEditing({ ...editing, name: event.target.value })}
              />
            </Field>
            <Field label={t('settings:membership.fee')} requirement="none">
              <Input
                type="number"
                min={0}
                value={editing.feeJpy}
                onChange={event => setEditing({ ...editing, feeJpy: event.target.value })}
              />
            </Field>
            <Field label={t('settings:membership.validDays')} requirement="none">
              <Input
                type="number"
                min={1}
                value={editing.validDays}
                placeholder={t('settings:membership.validDaysPlaceholder')}
                onChange={event => setEditing({ ...editing, validDays: event.target.value })}
              />
            </Field>
            <Field label={t('settings:membership.descriptionLabel')} requirement="none">
              <Input
                value={editing.description}
                onChange={event => setEditing({ ...editing, description: event.target.value })}
              />
            </Field>
          </FormGrid>

          {editing.id ? (
            <label className="membership-plan-editor__active">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={event => setEditing({ ...editing, active: event.target.checked })}
              />
              {t('settings:membership.activeLabel')}
            </label>
          ) : null}

          {error ? <Notice tone="danger">{t(`settings:membership.validation.${error}`)}</Notice> : null}

          <div className="membership-plan-editor__actions">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              {t('common:action.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={save}
              disabled={saving || Boolean(error)}
            >
              {saving ? t('common:action.saving') : t('common:action.save')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(emptyPlanDraft(plans.length))}
        >
          <Plus />
          {t('settings:membership.add')}
        </Button>
      )}
    </Panel>
  )
}
