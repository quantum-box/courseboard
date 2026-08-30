import { Button, Input } from '@tachyon-sdk/native-ui'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import {
  DataTable,
  EmptyState,
  Field,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
  type DataTableColumn,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import { membershipPlansPath, type MembershipPlanList } from '../golf/customers/membership'
import { SettingsSubPage } from './SettingsSubPage'

type DiscountKind = 'yen' | 'percent'

type MembershipDiscount = { planId: string; kind: DiscountKind; value: number }
type MembershipDiscountList = { items: MembershipDiscount[] }

const membershipDiscountsPath = '/v1/course/membership-discounts'

type DiscountRow = { planId: string; planName: string; discount: MembershipDiscount }

/**
 * What each membership takes off the green fee.
 *
 * A discount rather than a member's own posted rate: the green fee already
 * moves with the day and the season, and a flat member price would freeze that
 * into one number and undo the operator's weekday pricing.
 *
 * One row per plan the club still sells. A plan left at zero discounts nothing,
 * which is where every plan starts and where a club puts one back when it
 * withdraws the rate.
 */
export function MembershipDiscountsPage() {
  const { t } = useTranslation(['settings', 'common'])
  const plansResource = useResource(
    () => courseboardApiJson<MembershipPlanList>(membershipPlansPath),
    [],
    { cacheKey: 'membership:plans:active' },
  )
  const discountsResource = useResource(
    () => courseboardApiJson<MembershipDiscountList>(membershipDiscountsPath),
    [],
    { cacheKey: 'membership:discounts' },
  )
  useRegisterPageReload(() => {
    void plansResource.refresh()
    void discountsResource.refresh()
  })
  const [editing, setEditing] = useState<DiscountRow | null>(null)
  const [saving, setSaving] = useState(false)

  const plans = useMemo(() => plansResource.data?.items ?? [], [plansResource.data])
  const byPlan = useMemo(() => {
    const map: Record<string, MembershipDiscount> = {}
    for (const entry of discountsResource.data?.items ?? []) map[entry.planId] = entry
    return map
  }, [discountsResource.data])

  // A row for every plan the club sells, whether or not it has a discount yet
  // — the alternative is a table that hides the plans an operator most wants
  // to add one to.
  const rows = useMemo<DiscountRow[]>(
    () =>
      plans.map(plan => ({
        planId: plan.id,
        planName: plan.name,
        discount: byPlan[plan.id] ?? { planId: plan.id, kind: 'yen', value: 0 },
      })),
    [plans, byPlan],
  )

  async function save(edited: MembershipDiscount) {
    setSaving(true)
    try {
      // Zero is dropped server-side too, but sending it would make "no
      // discount" and "discounts nothing" two different stored states.
      const items = rows
        .map(row => (row.planId === edited.planId ? edited : row.discount))
        .filter(entry => entry.value > 0)
      await courseboardApiJson<MembershipDiscountList>(membershipDiscountsPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      showToast({ tone: 'success', message: t('settings:discounts.saved') })
      setEditing(null)
      await discountsResource.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('settings:discounts.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<DataTableColumn<DiscountRow>[]>(
    () => [
      {
        key: 'plan',
        header: t('settings:discounts.field.plan'),
        cell: row => row.planName,
        sortValue: row => row.planName,
      },
      {
        key: 'discount',
        header: t('settings:discounts.field.value'),
        align: 'right',
        cell: row =>
          row.discount.value > 0
            ? t(
                row.discount.kind === 'percent'
                  ? 'settings:discounts.valuePercent'
                  : 'settings:discounts.valueYen',
                { value: row.discount.value.toLocaleString('ja-JP') },
              )
            : t('settings:discounts.none'),
        sortValue: row => row.discount.value,
      },
    ],
    [t],
  )

  const loading = plansResource.loading || discountsResource.loading
  const error = plansResource.error ?? discountsResource.error

  return (
    <SettingsSubPage>
      <Panel
        title={t('settings:discounts.title')}
        description={t('settings:discounts.description')}
      >
        {loading ? <LoadingState /> : null}
        {error ? (
          <ResourceError
            error={error}
            onRetry={() => {
              void plansResource.refresh()
              void discountsResource.refresh()
            }}
          />
        ) : null}

        {!loading && !error ? (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={row => row.planId}
            onRowClick={row => setEditing({ ...row, discount: { ...row.discount } })}
            empty={
              <EmptyState
                title={t('settings:discounts.emptyTitle')}
                description={t('settings:discounts.noPlans')}
              />
            }
          />
        ) : null}

        {/* Said here because it is the part an operator does not expect: a
            lower green fee can land in a lower golf course tax bracket. */}
        <Notice tone="info">{t('settings:discounts.hint')}</Notice>
      </Panel>

      <Sheet
        open={editing !== null}
        onOpenChange={open => {
          if (!open) setEditing(null)
        }}
        title={t('settings:discounts.editTitle')}
        description={editing?.planName}
      >
        {editing ? (
          <div className="space-y-3">
            <Field label={t('settings:discounts.field.kind')} requirement="required">
              <NativeSelect
                value={editing.discount.kind}
                onChange={event =>
                  setEditing({
                    ...editing,
                    discount: { ...editing.discount, kind: event.target.value as DiscountKind },
                  })
                }
              >
                <option value="yen">{t('settings:discounts.kind.yen')}</option>
                <option value="percent">{t('settings:discounts.kind.percent')}</option>
              </NativeSelect>
            </Field>

            <Field label={t('settings:discounts.field.value')} requirement="required">
              <Input
                type="number"
                min={0}
                max={editing.discount.kind === 'percent' ? 100 : undefined}
                value={String(editing.discount.value)}
                onChange={event =>
                  setEditing({
                    ...editing,
                    discount: {
                      ...editing.discount,
                      value: Math.max(0, Number(event.target.value) || 0),
                    },
                  })
                }
              />
            </Field>

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
                disabled={saving}
                onClick={() => void save(editing.discount)}
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
