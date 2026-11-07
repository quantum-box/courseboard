import { Button, Input } from '@tachyon-sdk/native-ui'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { DataTable, Field, FormGrid, NativeSelect, Notice, Panel, ResourceError } from '../../components/Page'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'

const weatherOptions = ['sunny', 'cloudy', 'rain', 'snow', 'other'] as const

type Observation = {
  golfCourseId: string
  observedAt: string
  timezone: string
  weather: typeof weatherOptions[number]
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
  const [observedAt, setObservedAt] = useState(`${from}T09:00`)
  const [weather, setWeather] = useState<Observation['weather']>('sunny')
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
    setObservedAt(`${from}T09:00`)
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await courseboardApiJson<Observation>('/v1/course/weather-observations', {
        method: 'POST',
        body: JSON.stringify({ golfCourseId: courseId, observedAt: `${observedAt}:00`, weather }),
      })
      setSaved(true)
      reload()
    } catch (cause) {
      setSaveError(cause)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel title={t('weather.title')} description={t('weather.description')}>
      <form onSubmit={event => void save(event)} className="grid gap-4">
        <FormGrid>
          <Field label={t('weather.course')}>
            <NativeSelect required value={courseId} disabled={saving} onChange={event => { setCourseId(event.target.value); setSaved(false) }}>
              {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t('weather.observedAt', { timezone })}>
            <Input type="datetime-local" required min={`${from}T00:00`} max={`${to}T23:59`} value={observedAt} disabled={saving} onChange={event => { setObservedAt(event.target.value); setSaved(false) }} />
          </Field>
          <Field label={t('weather.condition')}>
            <NativeSelect value={weather} disabled={saving} onChange={event => { setWeather(event.target.value as Observation['weather']); setSaved(false) }}>
              {weatherOptions.map(value => <option key={value} value={value}>{t(`weather.options.${value}`)}</option>)}
            </NativeSelect>
          </Field>
        </FormGrid>
        <div><Button type="submit" disabled={saving || !courseId}>{t(saving ? 'weather.saving' : 'weather.save')}</Button></div>
        {saved ? <Notice tone="success">{t('weather.saved')}</Notice> : null}
        {saveError ? <ResourceError error={saveError} /> : null}
      </form>
      <div className="mt-4">
        {error ? <ResourceError error={error} onRetry={reload} /> : loading ? <p>{t('weather.loading')}</p> : items.length === 0 ? <p>{t('weather.empty')}</p> : (
          <DataTable rows={items} rowKey={row => `${row.golfCourseId}-${row.observedAt}`} columns={[
            { key: 'course', header: t('weather.course'), cell: row => courses.find(course => course.id === row.golfCourseId)?.name ?? row.golfCourseId },
            { key: 'time', header: t('weather.datetime'), cell: row => `${row.observedAt.replace('T', ' ').slice(0, 16)} (${row.timezone})` },
            { key: 'weather', header: t('weather.condition'), cell: row => t(`weather.options.${row.weather}`) },
            { key: 'edit', header: '', cell: row => <Button type="button" disabled={saving} onClick={() => { setCourseId(row.golfCourseId); setObservedAt(row.observedAt.slice(0, 16)); setWeather(row.weather); setSaved(false); setSaveError(null) }}>{t('weather.edit')}</Button> },
          ]} />
        )}
      </div>
    </Panel>
  )
}
