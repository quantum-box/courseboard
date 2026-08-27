import { Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import {
  Field,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { showToast } from '../../lib/toast'
import { membershipPlansPath, type MembershipPlanList } from '../golf/customers/membership'

type DiscountKind = 'yen' | 'percent'

type MembershipDiscount = { planId: string; kind: DiscountKind; value: number }
type MembershipDiscountList = { items: MembershipDiscount[] }

const membershipDiscountsPath = '/v1/course/membership-discounts'

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
export function MembershipDiscountsPanel() {
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
  const [draft, setDraft] = useState<Record<string, MembershipDiscount> | null>(null)
  const [saving, setSaving] = useState(false)

  const plans = plansResource.data?.items ?? []

  // Keyed by plan so a row exists for every plan the club sells, whether or not
  // it has a discount yet — the alternative is a form that hides the plans the
  // operator most wants to add one to.
  useEffect(() => {
    if (!discountsResource.data) return
    const byPlan: Record<string, MembershipDiscount> = {}
    for (const entry of discountsResource.data.items) byPlan[entry.planId] = entry
    setDraft(byPlan)
  }, [discountsResource.data])

  const rowFor = (planId: string): MembershipDiscount =>
    draft?.[planId] ?? { planId, kind: 'yen', value: 0 }

  const update = (planId: string, patch: Partial<MembershipDiscount>) => {
    setDraft({ ...(draft ?? {}), [planId]: { ...rowFor(planId), ...patch } })
  }

  const save = async () => {
    setSaving(true)
    try {
      // Zero is dropped server-side too, but sending it would make "no
      // discount" and "discounts nothing" two different stored states.
      const items = Object.values(draft ?? {}).filter(entry => entry.value > 0)
      await courseboardApiJson<MembershipDiscountList>(membershipDiscountsPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      showToast({ tone: 'success', message: t('settings:discounts.saved') })
      await discountsResource.refresh()
    } catch (saveError) {
      showToast({
        tone: 'danger',
        title: t('settings:discounts.failed'),
        message: saveError instanceof Error ? saveError.message : String(saveError),
      })
    } finally {
      setSaving(false)
    }
  }

  const loading = plansResource.loading || discountsResource.loading
  const error = plansResource.error ?? discountsResource.error

  return (
    <Panel
      title={t('settings:discounts.title')}
      description={t('settings:discounts.description')}
      actions={
        <Button type="button" onClick={() => void save()} disabled={saving || !draft}>
          {t('common:action.save')}
        </Button>
      }
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

      {draft && !loading ? (
        plans.length === 0 ? (
          <Notice tone="info">{t('settings:discounts.noPlans')}</Notice>
        ) : (
          <ul className="settings-rows">
            {/* Named once, above the rows, rather than beside every input:
                four labels repeated down the list triples the height of a form
                the operator reads as a table. */}
            <li className="settings-rows__head membership-discount-row" aria-hidden="true">
              <span />
              <span>{t('settings:discounts.field.kind')}</span>
              <span>{t('settings:discounts.field.value')}</span>
            </li>
            {plans.map(plan => {
              const row = rowFor(plan.id)
              return (
                <li className="settings-rows__row membership-discount-row" key={plan.id}>
                  <span className="settings-rows__name">{plan.name}</span>
                  <Field label={t('settings:discounts.field.kind')}>
                    <NativeSelect
                      value={row.kind}
                      onChange={event =>
                        update(plan.id, { kind: event.target.value as DiscountKind })
                      }
                    >
                      <option value="yen">{t('settings:discounts.kind.yen')}</option>
                      <option value="percent">{t('settings:discounts.kind.percent')}</option>
                    </NativeSelect>
                  </Field>
                  <Field label={t('settings:discounts.field.value')}>
                    <Input
                      type="number"
                      min={0}
                      max={row.kind === 'percent' ? 100 : undefined}
                      value={String(row.value)}
                      onChange={event =>
                        update(plan.id, { value: Math.max(0, Number(event.target.value) || 0) })
                      }
                    />
                  </Field>
                </li>
              )
            })}
          </ul>
        )
      ) : null}

      {/* Said here because it is the part an operator does not expect: a lower
          green fee can land in a lower golf course tax bracket. */}
      <Notice tone="info">{t('settings:discounts.hint')}</Notice>
    </Panel>
  )
}
