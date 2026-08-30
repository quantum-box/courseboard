import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { Plus } from 'lucide-react'
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
  emptyPlanDraft,
  membershipPlansPath,
  planDraft,
  planRequestBody,
  validatePlanDraft,
  type MembershipPlan,
  type MembershipPlanDraft,
  type MembershipPlanList,
} from '../golf/customers/membership'
import { SettingsSubPage } from './SettingsSubPage'

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
export function MembershipPlansPage() {
  const { t } = useTranslation(['settings', 'common'])
  // Inactive plans included: this is the only screen a retired plan can be
  // brought back from, so it is the one screen that has to show it.
  const resource = useResource(
    () => courseboardApiJson<MembershipPlanList>(`${membershipPlansPath}?includeInactive=true`),
    [],
    { cacheKey: 'membership:plans:all' },
  )
  useRegisterPageReload(resource.refresh)
  const [editing, setEditing] = useState<MembershipPlanDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const plans = useMemo(() => resource.data?.items ?? [], [resource.data])
  const problem = editing ? validatePlanDraft(editing) : null

  async function save() {
    if (!editing || problem) return
    setSaving(true)
    try {
      await courseboardApiJson<MembershipPlan>(
        editing.id
          ? `${membershipPlansPath}/${encodeURIComponent(editing.id)}`
          : membershipPlansPath,
        {
          method: editing.id ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(planRequestBody(editing)),
        },
      )
      showToast({ tone: 'success', message: t('settings:membership.saved') })
      setEditing(null)
      await resource.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('settings:membership.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<DataTableColumn<MembershipPlan>[]>(
    () => [
      {
        key: 'name',
        header: t('settings:membership.name'),
        cell: plan => plan.name,
        sortValue: plan => plan.name,
      },
      {
        key: 'fee',
        header: t('settings:membership.fee'),
        align: 'right',
        cell: plan => (typeof plan.feeJpy === 'number' ? plan.feeJpy.toLocaleString('ja-JP') : ''),
        sortValue: plan => plan.feeJpy ?? null,
      },
      {
        key: 'validDays',
        header: t('settings:membership.validDays'),
        align: 'right',
        cell: plan =>
          typeof plan.validDays === 'number'
            ? t('settings:membership.validDaysValue', { days: String(plan.validDays) })
            : t('settings:membership.noExpiry'),
        sortValue: plan => plan.validDays ?? null,
      },
      {
        key: 'status',
        header: t('settings:membership.status'),
        // A retired plan still has members; the badge says it is no longer
        // sold, not that it stopped counting.
        cell: plan =>
          plan.active ? (
            <Badge variant="accent">{t('settings:membership.selling')}</Badge>
          ) : (
            <Badge variant="neutral">{t('settings:membership.retired')}</Badge>
          ),
        sortValue: plan => (plan.active ? 0 : 1),
      },
      {
        key: 'description',
        header: t('settings:membership.descriptionLabel'),
        cell: plan => plan.description ?? '',
      },
    ],
    [t],
  )

  return (
    <SettingsSubPage>
      <Panel
        title={t('settings:membership.title')}
        description={t('settings:membership.description')}
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => setEditing(emptyPlanDraft(plans.length))}
          >
            <Plus />
            {t('settings:membership.add')}
          </Button>
        }
      >
        {resource.loading ? <LoadingState /> : null}
        {resource.error ? (
          <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
        ) : null}

        {!resource.loading && !resource.error ? (
          <DataTable
            rows={plans}
            columns={columns}
            rowKey={plan => plan.id}
            onRowClick={plan => setEditing(planDraft(plan))}
            empty={
              <EmptyState
                title={t('settings:membership.emptyTitle')}
                description={t('settings:membership.empty')}
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
        title={t(
          editing?.id ? 'settings:membership.editTitle' : 'settings:membership.addTitle',
        )}
      >
        {editing ? (
          <div className="space-y-3">
            <Field label={t('settings:membership.name')} requirement="required">
              <Input
                value={editing.name}
                placeholder={t('settings:membership.namePlaceholder')}
                onChange={event => setEditing({ ...editing, name: event.target.value })}
              />
            </Field>

            <FormGrid columns={1}>
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

            {/* Only an existing plan can be retired: a plan being created is
                one the club is starting to sell. */}
            {editing.id ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={event => setEditing({ ...editing, active: event.target.checked })}
                />
                <span>{t('settings:membership.activeLabel')}</span>
              </label>
            ) : null}

            {problem ? (
              <Notice tone="danger">{t(`settings:membership.validation.${problem}`)}</Notice>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                {t('common:action.cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={saving || problem !== null}
                onClick={() => void save()}
              >
                {saving ? t('common:action.saving') : t('common:action.save')}
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </SettingsSubPage>
  )
}
