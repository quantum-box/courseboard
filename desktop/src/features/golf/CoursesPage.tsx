import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  ArrowLeft,
  CalendarDays,
  Flag,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
  resourceErrorText,
  type DataTableColumn,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { navigate } from '../../lib/router'
import { useResource } from '../../hooks/useResource'
import {
  courseToDraft,
  emptyCourseDraft,
  type GolfCourse,
  type GolfCourseDraft,
} from './models'

const coursesPath = '/v1/course/courses'

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; courseId: string }
  | null

/**
 * Save failures land in the inline notice, which has no room for a detail block
 * and used to print the server's own English. Route them through the shared
 * mapping so the sentence the operator reads first follows the active locale.
 */
function errorMessage(error: unknown) {
  return error instanceof Error ? resourceErrorText(error) : i18next.t('courses:error.generic')
}

function formatUpdatedAt(value: string, timezone: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: timezone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function validateCourse(draft: GolfCourseDraft) {
  if (!draft.name.trim()) return i18next.t('courses:validation.name')
  if (![9, 18].includes(draft.holeCount)) return i18next.t('courses:validation.holeCount')
  if (
    !Number.isInteger(draft.startIntervalMinutes)
    || draft.startIntervalMinutes < 1
    || draft.startIntervalMinutes > 60
  ) {
    return i18next.t('courses:validation.startInterval')
  }
  return null
}

export function CoursesPage() {
  const { t } = useTranslation(['courses', 'common', 'nav'])
  const timezone = useTenantTimezone()
  const coursesResource = useResource(
    () => courseboardApiJson<{ items: GolfCourse[] }>(coursesPath),
    [],
    { cacheKey: 'courses:list' },
  )
  const courses = coursesResource.data?.items ?? []
  const [editor, setEditor] = useState<EditorState>(null)
  const [draft, setDraft] = useState<GolfCourseDraft>(emptyCourseDraft)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  /** Every finished mutation reports in the same place: bottom right. */
  function saved(message: string) {
    showToast({ tone: 'success', title: i18next.t('common:state.saved'), message })
  }

  useRegisterPageReload(coursesResource.refresh)

  function beginCreate() {
    setDraft(emptyCourseDraft())
    setEditor({ mode: 'create' })
    setMutationError(null)
  }

  function beginEdit(course: GolfCourse) {
    setDraft(courseToDraft(course))
    setEditor({ mode: 'edit', courseId: course.id })
    setMutationError(null)
  }

  function closeEditor() {
    setEditor(null)
    setMutationError(null)
  }

  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const validationError = validateCourse(draft)
    if (validationError) {
      setMutationError(validationError)
      return
    }

    setSaving(true)
    setMutationError(null)
    const body = {
      name: draft.name.trim(),
      shortName: draft.shortName.trim() || null,
      holeCount: draft.holeCount,
      startIntervalMinutes: draft.startIntervalMinutes,
      isActive: editor.mode === 'create' ? true : draft.isActive,
    }

    try {
      if (editor.mode === 'create') {
        const created = await courseboardApiJson<GolfCourse>(coursesPath, {
          method: 'POST',
          body: JSON.stringify(body),
        })
        coursesResource.setData(current => ({
          items: [...(current?.items ?? []), created],
        }))
        saved(t('courses:notice.added', { name: body.name }))
      } else {
        const updated = await courseboardApiJson<GolfCourse>(
          `${coursesPath}/${encodeURIComponent(editor.courseId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        )
        coursesResource.setData(current => ({
          items: (current?.items ?? []).map(course =>
            course.id === updated.id ? updated : course,
          ),
        }))
        saved(t('courses:notice.updated', { name: body.name }))
      }
      setEditor(null)
      await coursesResource.refresh()
    } catch (error) {
      setMutationError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteCourse(course: GolfCourse) {
    if (!window.confirm(t('courses:confirmDelete', { name: course.name }))) return
    setDeletingId(course.id)
    try {
      await courseboardApiJson(
        `${coursesPath}/${encodeURIComponent(course.id)}`,
        { method: 'DELETE' },
      )
      coursesResource.setData(current => ({
        items: (current?.items ?? []).filter(item => item.id !== course.id),
      }))
      if (editor?.mode === 'edit' && editor.courseId === course.id) setEditor(null)
      saved(t('courses:notice.deleted', { name: course.name }))
      await coursesResource.refresh()
    } catch (error) {
      // The editor is closed during a delete, so there is no form to put this
      // in; a toast is the only place it can be read without moving the table.
      showToast({
        tone: 'danger',
        title: t('courses:notice.failed'),
        message: errorMessage(error),
      })
    } finally {
      setDeletingId(null)
    }
  }

  const columns: DataTableColumn<GolfCourse>[] = [
    {
      key: 'name',
      header: t('courses:table.course'),
      mobileLabel: t('courses:table.course'),
      cell: course => (
        <div className="grid gap-0.5">
          <strong>{course.name}</strong>
          <span className="text-xs text-muted-foreground">
            {course.shortName || course.id}
          </span>
        </div>
      ),
    },
    {
      key: 'holes',
      header: t('courses:table.holes'),
      mobileLabel: t('courses:table.holes'),
      align: 'right',
      cell: course => `${course.holeCount}H`,
    },
    {
      key: 'interval',
      header: t('courses:table.interval'),
      mobileLabel: t('courses:table.interval'),
      align: 'right',
      cell: course => t('common:unit.minutes', { n: String(course.startIntervalMinutes) }),
    },
    {
      key: 'hours',
      header: t('courses:table.hours'),
      mobileLabel: t('courses:table.hours'),
      cell: course => course.businessHoursJson
        ? `${course.businessHoursJson.open}–${course.businessHoursJson.close}`
        : t('common:state.unset'),
    },
    {
      key: 'status',
      header: t('courses:table.status'),
      mobileLabel: t('courses:table.status'),
      cell: course => (
        <Badge variant={course.isActive ? 'success' : 'neutral'}>
          {course.isActive ? t('common:state.enabled') : t('common:state.disabled')}
        </Badge>
      ),
    },
    {
      key: 'updated',
      header: t('courses:table.updated'),
      mobileLabel: t('courses:table.updated'),
      cell: course => formatUpdatedAt(course.updatedAt, timezone),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('courses:table.actions')}</span>,
      align: 'right',
      cell: course => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('courses:table.scheduleAria', { name: course.name })}
            onClick={() => navigate(`golf/courses/${encodeURIComponent(course.id)}`)}
          >
            <CalendarDays /> {t('courses:table.schedule')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('courses:table.editAria', { name: course.name })}
            onClick={() => beginEdit(course)}
          >
            <Pencil /> {t('common:action.edit')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('courses:table.deleteAria', { name: course.name })}
            disabled={deletingId === course.id}
            onClick={() => void deleteCourse(course)}
          >
            <Trash2 /> {deletingId === course.id ? t('courses:table.deleting') : t('common:action.delete')}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Button type="button" variant="ghost" onClick={() => navigate('settings')}>
          <ArrowLeft /> {t('common:action.backToSettings')}
        </Button>
        <Button
          type="button"
          className="course-add-button"
          variant="primary"
          onClick={beginCreate}
        >
          <Plus /> {t('courses:add')}
        </Button>
      </div>

      {editor ? (
        <Sheet
          open
          onOpenChange={open => {
            if (!open) closeEditor()
          }}
          title={editor.mode === 'create' ? t('courses:editor.createTitle') : t('courses:editor.editTitle')}
          description={t('courses:editor.description')}
          className="course-editor-sheet"
        >
          <form className="grid gap-4" onSubmit={saveCourse}>
            <FormGrid columns={1}>
              <Field label={t('courses:field.name')} required>
                <Input
                  value={draft.name}
                  onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                  placeholder={t('courses:field.namePlaceholder')}
                  autoFocus
                  required
                />
              </Field>
              <Field label={t('courses:field.shortName')}>
                <Input
                  value={draft.shortName}
                  onChange={event => setDraft(current => ({ ...current, shortName: event.target.value }))}
                  placeholder={t('courses:field.shortNamePlaceholder')}
                />
              </Field>
              {editor.mode === 'edit' ? (
                <Field label={t('courses:field.status')} required>
                  <NativeSelect
                    value={draft.isActive ? 'active' : 'inactive'}
                    onChange={event => setDraft(current => ({
                      ...current,
                      isActive: event.target.value === 'active',
                    }))}
                  >
                    <option value="active">{t('common:state.enabled')}</option>
                    <option value="inactive">{t('common:state.disabled')}</option>
                  </NativeSelect>
                </Field>
              ) : null}
              <Field label={t('courses:field.holeCount')} required>
                <NativeSelect
                  value={draft.holeCount}
                  onChange={event => setDraft(current => ({
                    ...current,
                    holeCount: Number(event.target.value),
                  }))}
                >
                  <option value={18}>{t('courses:option.holes18')}</option>
                  <option value={9}>{t('courses:option.holes9')}</option>
                </NativeSelect>
              </Field>
              <Field
                label={t('courses:field.startInterval')}
                hint={t('courses:field.startIntervalHint')}
                required
              >
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={draft.startIntervalMinutes}
                  onChange={event => setDraft(current => ({
                    ...current,
                    startIntervalMinutes: Number(event.target.value),
                  }))}
                  required
                />
              </Field>
            </FormGrid>

            {mutationError ? (
              <Notice tone="danger" title={t('courses:notice.checkInput')}>{mutationError}</Notice>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={closeEditor} disabled={saving}>
                {t('common:action.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                <Save /> {saving ? t('common:action.saving') : t('common:action.save')}
              </Button>
            </div>
          </form>
        </Sheet>
      ) : null}

      <Panel
        title={t('courses:list.title')}
        description={t('courses:list.description')}
        actions={<Badge variant="outline">{t('common:unit.count', { n: String(courses.length) })}</Badge>}
      >
        {coursesResource.loading && !coursesResource.data
          ? <LoadingState label={t('courses:loading')} />
          : null}
        {coursesResource.error
          ? <ResourceError error={coursesResource.error} onRetry={coursesResource.refresh} />
          : null}
        {coursesResource.data ? (
          <DataTable
            rows={courses}
            columns={columns}
            rowKey={course => course.id}
            empty={(
              <EmptyState
                title={t('courses:empty.title')}
                description={t('courses:empty.description')}
                action={(
                  <Button
                    type="button"
                    className="course-add-button"
                    variant="primary"
                    onClick={beginCreate}
                  >
                    <Flag /> {t('courses:empty.action')}
                  </Button>
                )}
              />
            )}
          />
        ) : null}
      </Panel>
    </div>
  )
}

export default CoursesPage
