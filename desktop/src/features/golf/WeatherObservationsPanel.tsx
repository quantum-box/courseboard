import { Button, Input } from '@tachyon-sdk/native-ui'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { DataTable, Field, FormGrid, NativeSelect, Notice, Panel, ResourceError } from '../../components/Page'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'

const weatherOptions = ['sunny', 'cloudy', 'rain', 'snow', 'other'] as const
const periods = ['morning', 'afternoon'] as const

type Weather = typeof weatherOptions[number]
type Period = typeof periods[number]
type PeriodDraft = { weather: Weather | ''; time: string }
type Observation = {
  golfCourseId: string
  observedAt: string
  timezone: string
  weather: Weather
}

type Props = {
  courses: { id: string; name: string }[]
  from: string
  to: string
  courseFilter: string
}

export function WeatherObservationsPanel({ courses, from, to, courseFilter }: Props) {
  const { t } = useTranslation('budgets')
  const timezone = useTenantTimezone()
  const [items, setItems] = useState<Observation[]>([])
  const [courseId, setCourseId] = useState('')
  const [date, setDate] = useState(from)
  const [drafts, setDrafts] = useState<Record<Period, PeriodDraft>>({
    morning: { weather: '', time: '09:00' },
    afternoon: { weather: '', time: '15:00' },
  })
  const [editing, setEditing] = useState<Observation | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    if (!courses.some(course => course.id === courseId)) setCourseId(courses[0]?.id ?? '')
  }, [courses, courseId])

  useEffect(() => {
    setDate(from)
    setEditing(null)
    setSaved(false)
  }, [from])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ from, to })
    if (courseFilter !== 'all') params.set('golfCourseId', courseFilter)
    void courseboardApiJson<{ items: Observation[] }>(`/v1/course/weather-observations?${params}`)
      .then(payload => { if (active) setItems(payload.items) })
      .catch(cause => { if (active) setError(cause) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [from, to, courseFilter, revision])

  function updateDraft(period: Period, patch: Partial<PeriodDraft>) {
    setDrafts(previous => ({ ...previous, [period]: { ...previous[period], ...patch } }))
    setSaved(false)
  }

  async function saveObservations(body: unknown) {
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await courseboardApiJson('/v1/course/weather-observations', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setSaved(true)
      setEditing(null)
      reload()
    } catch (cause) {
      setSaveError(cause)
    } finally {
      setSaving(false)
    }
  }

  function saveDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const observations = periods
      .filter(period => drafts[period].weather)
      .map(period => ({
        golfCourseId: courseId,
        observedAt: `${date}T${drafts[period].time}:00`,
        weather: drafts[period].weather,
      }))
    if (observations.length > 0) void saveObservations({ items: observations })
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editing) {
      void saveObservations({
        golfCourseId: editing.golfCourseId,
        observedAt: editing.observedAt,
        weather: editing.weather,
      })
    }
  }

  return (
    <Panel title={t('weather.title')} description={t('weather.description')}>
      <form onSubmit={saveDay} className="grid gap-4">
        <FormGrid>
          <Field label={t('weather.course')}>
            <NativeSelect
              required value={courseId} disabled={saving}
              onChange={event => { setCourseId(event.target.value); setSaved(false) }}
            >
              {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t('weather.date', { timezone })}>
            <Input
              type="date" required min={from} max={to} value={date} disabled={saving}
              onChange={event => { setDate(event.target.value); setSaved(false) }}
            />
          </Field>
        </FormGrid>
        <div className="grid gap-4 md:grid-cols-2">
          {periods.map(period => (
            <fieldset key={period} className="grid gap-3 rounded-lg border border-white/10 p-4">
              <legend className="px-1 font-medium">{t(`weather.${period}`)}</legend>
              <Field label={t(`weather.${period}Weather`)}>
                <NativeSelect
                  value={drafts[period].weather} disabled={saving}
                  onChange={event => updateDraft(period, { weather: event.target.value as Weather | '' })}
                >
                  <option value="">{t('weather.notEntered')}</option>
                  {weatherOptions.map(value => <option key={value} value={value}>{t(`weather.options.${value}`)}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t(`weather.${period}Time`)}>
                <Input
                  type="time" value={drafts[period].time}
                  min={period === 'morning' ? '00:00' : '12:00'}
                  max={period === 'morning' ? '11:59' : '23:59'}
                  disabled={saving || !drafts[period].weather}
                  required={Boolean(drafts[period].weather)}
                  onChange={event => updateDraft(period, { time: event.target.value })}
                />
              </Field>
            </fieldset>
          ))}
        </div>
        <div>
          <Button type="submit" disabled={saving || !courseId || !periods.some(period => drafts[period].weather)}>
            {t(saving ? 'weather.saving' : 'weather.save')}
          </Button>
        </div>
      </form>
      {editing ? (
        <form onSubmit={saveEdit} className="mt-4 grid gap-4 rounded-lg border border-white/10 p-4">
          <strong>{t('weather.edit')}</strong>
          <p>{courses.find(course => course.id === editing.golfCourseId)?.name ?? editing.golfCourseId}</p>
          <FormGrid>
            <Field label={t('weather.observedAt', { timezone: editing.timezone })}>
              <Input
                type="datetime-local" required value={editing.observedAt.slice(0, 16)} disabled={saving}
                onChange={event => {
                  setEditing({ ...editing, observedAt: `${event.target.value}:00` })
                  setSaved(false)
                }}
              />
            </Field>
            <Field label={t('weather.condition')}>
              <NativeSelect
                value={editing.weather} disabled={saving}
                onChange={event => { setEditing({ ...editing, weather: event.target.value as Weather }); setSaved(false) }}
              >
                {weatherOptions.map(value => <option key={value} value={value}>{t(`weather.options.${value}`)}</option>)}
              </NativeSelect>
            </Field>
          </FormGrid>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>{t(saving ? 'weather.saving' : 'weather.saveEdit')}</Button>
            <Button type="button" disabled={saving} onClick={() => setEditing(null)}>{t('weather.cancel')}</Button>
          </div>
        </form>
      ) : null}
      {saved ? <Notice tone="success">{t('weather.saved')}</Notice> : null}
      {saveError ? <ResourceError error={saveError} /> : null}
      <div className="mt-4">
        {error ? <ResourceError error={error} onRetry={reload} /> : loading ? <p>{t('weather.loading')}</p> : items.length === 0 ? <p>{t('weather.empty')}</p> : (
          <DataTable rows={items} rowKey={row => `${row.golfCourseId}-${row.observedAt}`} columns={[
            { key: 'course', header: t('weather.course'), cell: row => courses.find(course => course.id === row.golfCourseId)?.name ?? row.golfCourseId },
            { key: 'time', header: t('weather.datetime'), cell: row => `${row.observedAt.replace('T', ' ').slice(0, 16)} (${row.timezone})` },
            { key: 'period', header: t('weather.period'), cell: row => t(Number(row.observedAt.slice(11, 13)) < 12 ? 'weather.morning' : 'weather.afternoon') },
            { key: 'weather', header: t('weather.condition'), cell: row => t(`weather.options.${row.weather}`) },
            {
              key: 'edit', header: '', cell: row => (
                <Button type="button" disabled={saving} onClick={() => { setEditing(row); setSaved(false); setSaveError(null) }}>
                  {t('weather.edit')}
                </Button>
              ),
            },
          ]} />
        )}
      </div>
    </Panel>
  )
}
