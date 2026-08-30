import { Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import { Field, LoadingState, Notice, Panel, ResourceError } from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { showToast } from '../../lib/toast'
import { membershipPlansPath, type MembershipPlanList } from '../golf/customers/membership'

type MembershipPlayWindow = {
  planId: string
  /** Monday first. */
  days: boolean[]
  from?: string | null
  to?: string | null
}

type MembershipPlayWindowList = { items: MembershipPlayWindow[] }

const membershipPlayWindowsPath = '/v1/course/membership-play-windows'

/** Monday first, matching the server's bit order. */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function emptyWindow(planId: string): MembershipPlayWindow {
  return { planId, days: [false, false, false, false, false, false, false], from: '', to: '' }
}

/**
 * When each membership may be played.
 *
 * 平日会員 is the point: a cheaper membership that is only good Monday to
 * Friday. Advisory, not enforcement — the desk is warned when a booking falls
 * outside the window and the tee time is sold anyway, because exceptions
 * happen every week and refusing would only send the desk to Field's admin.
 *
 * All seven days ticked, or none, both mean "no restriction". A row the
 * operator started and left blank must not lock a member out of the week.
 */
export function MembershipPlayWindowsPanel() {
  const { t } = useTranslation(['settings', 'common'])
  const plansResource = useResource(
    () => courseboardApiJson<MembershipPlanList>(membershipPlansPath),
    [],
    { cacheKey: 'membership:plans:active' },
  )
  const windowsResource = useResource(
    () => courseboardApiJson<MembershipPlayWindowList>(membershipPlayWindowsPath),
    [],
    { cacheKey: 'membership:play-windows' },
  )
  const [draft, setDraft] = useState<Record<string, MembershipPlayWindow> | null>(null)
  const [saving, setSaving] = useState(false)

  const plans = plansResource.data?.items ?? []

  useEffect(() => {
    if (!windowsResource.data) return
    const byPlan: Record<string, MembershipPlayWindow> = {}
    for (const entry of windowsResource.data.items) byPlan[entry.planId] = entry
    setDraft(byPlan)
  }, [windowsResource.data])

  const rowFor = (planId: string) => draft?.[planId] ?? emptyWindow(planId)

  const update = (planId: string, patch: Partial<MembershipPlayWindow>) => {
    setDraft({ ...(draft ?? {}), [planId]: { ...rowFor(planId), ...patch } })
  }

  const toggleDay = (planId: string, index: number) => {
    const row = rowFor(planId)
    const days = row.days.map((on, position) => (position === index ? !on : on))
    update(planId, { days })
  }

  const save = async () => {
    setSaving(true)
    try {
      await courseboardApiJson<MembershipPlayWindowList>(membershipPlayWindowsPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: Object.values(draft ?? {}) }),
      })
      showToast({ tone: 'success', message: t('settings:playWindows.saved') })
      await windowsResource.refresh()
    } catch (saveError) {
      showToast({
        tone: 'danger',
        title: t('settings:playWindows.failed'),
        message: saveError instanceof Error ? saveError.message : String(saveError),
      })
    } finally {
      setSaving(false)
    }
  }

  const loading = plansResource.loading || windowsResource.loading
  const error = plansResource.error ?? windowsResource.error

  return (
    <Panel
      title={t('settings:playWindows.title')}
      description={t('settings:playWindows.description')}
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
            void windowsResource.refresh()
          }}
        />
      ) : null}

      {draft && !loading ? (
        plans.length === 0 ? (
          <Notice tone="info">{t('settings:playWindows.noPlans')}</Notice>
        ) : (
          <ul className="settings-rows">
            <li className="settings-rows__head membership-window-row" aria-hidden="true">
              <span />
              <span />
              <span>{t('settings:playWindows.field.from')}</span>
              <span>{t('settings:playWindows.field.to')}</span>
            </li>
            {plans.map(plan => {
              const row = rowFor(plan.id)
              return (
                <li className="settings-rows__row membership-window-row" key={plan.id}>
                  <span className="settings-rows__name">{plan.name}</span>
                  <div className="membership-window-row__days">
                    {DAY_KEYS.map((key, index) => (
                      <label className="membership-window-day" key={key}>
                        <input
                          type="checkbox"
                          checked={row.days[index] ?? false}
                          onChange={() => toggleDay(plan.id, index)}
                        />
                        {t(`settings:playWindows.day.${key}`)}
                      </label>
                    ))}
                  </div>
                  <Field label={t('settings:playWindows.field.from')}>
                    <Input
                      type="time"
                      value={row.from ?? ''}
                      onChange={event => update(plan.id, { from: event.target.value })}
                    />
                  </Field>
                  <Field label={t('settings:playWindows.field.to')}>
                    <Input
                      type="time"
                      value={row.to ?? ''}
                      onChange={event => update(plan.id, { to: event.target.value })}
                    />
                  </Field>
                </li>
              )
            })}
          </ul>
        )
      ) : null}

      {/* The part an operator does not expect: this warns, it does not refuse. */}
      <Notice tone="info">{t('settings:playWindows.hint')}</Notice>
    </Panel>
  )
}
