import { Button, Input } from '@tachyon-sdk/native-ui'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import {
  DataTable,
  EmptyState,
  Field,
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
import { membershipPlansPath, type MembershipPlanList } from '../golf/customers/membership'
import { SettingsSubPage } from './SettingsSubPage'

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

type WindowRow = { planId: string; planName: string; window: MembershipPlayWindow }

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
export function MembershipPlayWindowsPage() {
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
  useRegisterPageReload(() => {
    void plansResource.refresh()
    void windowsResource.refresh()
  })
  const [editing, setEditing] = useState<WindowRow | null>(null)
  const [saving, setSaving] = useState(false)

  const plans = useMemo(() => plansResource.data?.items ?? [], [plansResource.data])
  const byPlan = useMemo(() => {
    const map: Record<string, MembershipPlayWindow> = {}
    for (const entry of windowsResource.data?.items ?? []) map[entry.planId] = entry
    return map
  }, [windowsResource.data])

  const rows = useMemo<WindowRow[]>(
    () =>
      plans.map(plan => ({
        planId: plan.id,
        planName: plan.name,
        window: byPlan[plan.id] ?? emptyWindow(plan.id),
      })),
    [plans, byPlan],
  )

  async function save(edited: MembershipPlayWindow) {
    setSaving(true)
    try {
      const items = rows.map(row => (row.planId === edited.planId ? edited : row.window))
      await courseboardApiJson<MembershipPlayWindowList>(membershipPlayWindowsPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      showToast({ tone: 'success', message: t('settings:playWindows.saved') })
      setEditing(null)
      await windowsResource.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('settings:playWindows.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  /** Every day or no day both read as "no restriction", so both say so. */
  function daysLabel(window: MembershipPlayWindow) {
    const on = DAY_KEYS.filter((_, index) => window.days[index])
    if (on.length === 0 || on.length === DAY_KEYS.length) {
      return t('settings:playWindows.noRestriction')
    }
    return on.map(key => t(`settings:playWindows.day.${key}`)).join('・')
  }

  function hoursLabel(window: MembershipPlayWindow) {
    const from = window.from ?? ''
    const to = window.to ?? ''
    if (from === '' && to === '') return t('settings:playWindows.anyTime')
    return `${from || '—'}–${to || '—'}`
  }

  const columns = useMemo<DataTableColumn<WindowRow>[]>(
    () => [
      {
        key: 'plan',
        header: t('settings:playWindows.field.plan'),
        cell: row => row.planName,
        sortValue: row => row.planName,
      },
      {
        key: 'days',
        header: t('settings:playWindows.field.days'),
        cell: row => daysLabel(row.window),
      },
      {
        key: 'hours',
        header: t('settings:playWindows.field.hours'),
        cell: row => hoursLabel(row.window),
      },
    ],
    // The labels are read off the same rows these deps track.
    [t],
  )

  const loading = plansResource.loading || windowsResource.loading
  const error = plansResource.error ?? windowsResource.error

  return (
    <SettingsSubPage>
      <Panel
        title={t('settings:playWindows.title')}
        description={t('settings:playWindows.description')}
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

        {!loading && !error ? (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={row => row.planId}
            onRowClick={row =>
              setEditing({ ...row, window: { ...row.window, days: [...row.window.days] } })
            }
            empty={
              <EmptyState
                title={t('settings:playWindows.emptyTitle')}
                description={t('settings:playWindows.noPlans')}
              />
            }
          />
        ) : null}

        {/* The part an operator does not expect: this warns, it does not refuse. */}
        <Notice tone="info">{t('settings:playWindows.hint')}</Notice>
      </Panel>

      <Sheet
        open={editing !== null}
        onOpenChange={open => {
          if (!open) setEditing(null)
        }}
        title={t('settings:playWindows.editTitle')}
        description={editing?.planName}
      >
        {editing ? (
          <div className="space-y-3">
            <Field
              label={t('settings:playWindows.field.days')}
              requirement="none"
              hint={t('settings:playWindows.daysHint')}
            >
              <div className="flex flex-wrap gap-3">
                {DAY_KEYS.map((key, index) => (
                  <label className="flex items-center gap-1 text-sm" key={key}>
                    <input
                      type="checkbox"
                      checked={editing.window.days[index] ?? false}
                      onChange={() =>
                        setEditing({
                          ...editing,
                          window: {
                            ...editing.window,
                            days: editing.window.days.map((on, position) =>
                              position === index ? !on : on,
                            ),
                          },
                        })
                      }
                    />
                    {t(`settings:playWindows.day.${key}`)}
                  </label>
                ))}
              </div>
            </Field>

            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('settings:playWindows.field.from')} requirement="none" className="w-32">
                <Input
                  type="time"
                  value={editing.window.from ?? ''}
                  onChange={event =>
                    setEditing({
                      ...editing,
                      window: { ...editing.window, from: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label={t('settings:playWindows.field.to')} requirement="none" className="w-32">
                <Input
                  type="time"
                  value={editing.window.to ?? ''}
                  onChange={event =>
                    setEditing({
                      ...editing,
                      window: { ...editing.window, to: event.target.value },
                    })
                  }
                />
              </Field>
            </div>

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
                onClick={() => void save(editing.window)}
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
