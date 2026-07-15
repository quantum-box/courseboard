import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  Flag,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { fieldApiJson, fieldApiText, fieldTenant } from '../../api'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Metric,
  MetricGrid,
  NativeSelect,
  Notice,
  PageHeader,
  Panel,
  ResourceError,
  type DataTableColumn,
} from '../../components/Page'
import {
  courseToDraft,
  emptyCourseDraft,
  type GolfCourse,
  type GolfCourseDraft,
} from './models'

const coursesPath = '/v1/erp/extensions/golf-course/courses'

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; courseId: string }
  | null

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作を完了できませんでした。'
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '—'
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function validateCourse(draft: GolfCourseDraft) {
  if (!draft.name.trim()) return 'コース名を入力してください。'
  if (!draft.timezone.trim()) return 'タイムゾーンを入力してください。'
  if (![9, 18].includes(draft.holeCount)) return 'ホール数は9Hまたは18Hを選択してください。'
  if (
    !Number.isInteger(draft.startIntervalMinutes)
    || draft.startIntervalMinutes < 1
    || draft.startIntervalMinutes > 60
  ) {
    return 'スタート間隔は1〜60分の整数で入力してください。'
  }
  return null
}

export function CoursesPage() {
  const tenant = fieldTenant()
  const [courses, setCourses] = useState<GolfCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  const [draft, setDraft] = useState<GolfCourseDraft>(emptyCourseDraft)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  const loadCourses = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fieldApiJson<{ items: GolfCourse[] }>(coursesPath)
      setCourses(response.items)
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCourses()
  }, [loadCourses])

  function beginCreate() {
    setDraft(emptyCourseDraft())
    setEditor({ mode: 'create' })
    setMutationError(null)
    setSavedMessage(null)
  }

  function beginEdit(course: GolfCourse) {
    setDraft(courseToDraft(course))
    setEditor({ mode: 'edit', courseId: course.id })
    setMutationError(null)
    setSavedMessage(null)
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
    setSavedMessage(null)
    const body = {
      name: draft.name.trim(),
      shortName: draft.shortName.trim() || null,
      holeCount: draft.holeCount,
      timezone: draft.timezone.trim(),
      startIntervalMinutes: draft.startIntervalMinutes,
      isActive: editor.mode === 'create' ? true : draft.isActive,
    }

    try {
      if (editor.mode === 'create') {
        await fieldApiText(coursesPath, {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setSavedMessage(`「${body.name}」を追加しました。`)
      } else {
        await fieldApiText(
          `${coursesPath}/${encodeURIComponent(editor.courseId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        )
        setSavedMessage(`「${body.name}」を更新しました。`)
      }
      setEditor(null)
      await loadCourses()
    } catch (error) {
      setMutationError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteCourse(course: GolfCourse) {
    if (!window.confirm(`「${course.name}」を削除します。よろしいですか？`)) return
    setDeletingId(course.id)
    setMutationError(null)
    setSavedMessage(null)
    try {
      await fieldApiText(
        `${coursesPath}/${encodeURIComponent(course.id)}`,
        { method: 'DELETE' },
      )
      if (editor?.mode === 'edit' && editor.courseId === course.id) setEditor(null)
      setSavedMessage(`「${course.name}」を削除しました。`)
      await loadCourses()
    } catch (error) {
      setMutationError(errorMessage(error))
    } finally {
      setDeletingId(null)
    }
  }

  const columns: DataTableColumn<GolfCourse>[] = [
    {
      key: 'name',
      header: 'コース',
      mobileLabel: 'コース',
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
      header: 'ホール',
      mobileLabel: 'ホール',
      align: 'right',
      cell: course => `${course.holeCount}H`,
    },
    {
      key: 'interval',
      header: 'スタート間隔',
      mobileLabel: 'スタート間隔',
      align: 'right',
      cell: course => `${course.startIntervalMinutes}分`,
    },
    {
      key: 'hours',
      header: '営業時間',
      mobileLabel: '営業時間',
      cell: course => course.businessHoursJson
        ? `${course.businessHoursJson.open}–${course.businessHoursJson.close}`
        : '未設定',
    },
    {
      key: 'timezone',
      header: 'タイムゾーン',
      mobileLabel: 'タイムゾーン',
      cell: course => course.timezone,
    },
    {
      key: 'status',
      header: '状態',
      mobileLabel: '状態',
      cell: course => (
        <Badge variant={course.isActive ? 'success' : 'neutral'}>
          {course.isActive ? '有効' : '無効'}
        </Badge>
      ),
    },
    {
      key: 'updated',
      header: '更新',
      mobileLabel: '更新',
      cell: course => formatUpdatedAt(course.updatedAt),
    },
    {
      key: 'actions',
      header: <span className="sr-only">操作</span>,
      align: 'right',
      cell: course => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`${course.name}を編集`}
            onClick={() => beginEdit(course)}
          >
            <Pencil /> 編集
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`${course.name}を削除`}
            disabled={deletingId === course.id}
            onClick={() => void deleteCourse(course)}
          >
            <Trash2 /> {deletingId === course.id ? '削除中' : '削除'}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`Golf operations · ${tenant}`}
        title="コース管理"
        description="ホール数とスタート間隔を含むコースマスタを、Web・デスクトップ・モバイルで共通管理します。"
        actions={(
          <>
            <Button type="button" onClick={() => void loadCourses()} disabled={loading}>
              <RefreshCw className={loading ? 'spin' : ''} /> 更新
            </Button>
            <Button type="button" variant="primary" onClick={beginCreate}>
              <Plus /> コース追加
            </Button>
          </>
        )}
      />

      <MetricGrid>
        <Metric label="登録コース" value={courses.length} detail="全コース" />
        <Metric
          label="営業中"
          value={courses.filter(course => course.isActive).length}
          detail="有効なコース"
          tone="success"
        />
        <Metric
          label="18ホール"
          value={courses.filter(course => course.holeCount === 18).length}
          detail="標準ラウンド"
        />
      </MetricGrid>

      {savedMessage ? (
        <Notice tone="success" title="保存しました">{savedMessage}</Notice>
      ) : null}
      {mutationError && !editor ? (
        <Notice tone="danger" title="操作を完了できませんでした">{mutationError}</Notice>
      ) : null}

      {editor ? (
        <Panel
          title={editor.mode === 'create' ? 'コースを追加' : 'コースを編集'}
          description="予約枠生成に使う基本条件です。"
          actions={(
            <Button type="button" variant="ghost" size="sm" onClick={closeEditor}>
              <X /> 閉じる
            </Button>
          )}
        >
          <form className="grid gap-4" onSubmit={saveCourse}>
            <FormGrid columns={3}>
              <Field label="コース名" required>
                <Input
                  value={draft.name}
                  onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                  placeholder="真駒内カントリークラブ"
                  autoFocus
                  required
                />
              </Field>
              <Field label="略称">
                <Input
                  value={draft.shortName}
                  onChange={event => setDraft(current => ({ ...current, shortName: event.target.value }))}
                  placeholder="真駒内"
                />
              </Field>
              {editor.mode === 'edit' ? (
                <Field label="状態" required>
                  <NativeSelect
                    value={draft.isActive ? 'active' : 'inactive'}
                    onChange={event => setDraft(current => ({
                      ...current,
                      isActive: event.target.value === 'active',
                    }))}
                  >
                    <option value="active">有効</option>
                    <option value="inactive">無効</option>
                  </NativeSelect>
                </Field>
              ) : null}
              <Field label="ホール数" required>
                <NativeSelect
                  value={draft.holeCount}
                  onChange={event => setDraft(current => ({
                    ...current,
                    holeCount: Number(event.target.value),
                  }))}
                >
                  <option value={18}>18ホール</option>
                  <option value={9}>9ホール</option>
                </NativeSelect>
              </Field>
              <Field label="スタート間隔" hint="1〜60分" required>
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
              <Field label="タイムゾーン" required>
                <Input
                  value={draft.timezone}
                  onChange={event => setDraft(current => ({ ...current, timezone: event.target.value }))}
                  placeholder="Asia/Tokyo"
                  required
                />
              </Field>
            </FormGrid>

            {mutationError ? (
              <Notice tone="danger" title="入力内容を確認してください">{mutationError}</Notice>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={closeEditor} disabled={saving}>キャンセル</Button>
              <Button type="submit" variant="primary" disabled={saving}>
                <Save /> {saving ? '保存中' : '変更を保存'}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel
        title="コース一覧"
        description="予約商品と枠設定が参照するコースマスタです。"
        actions={<Badge variant="outline">{courses.length}件</Badge>}
      >
        {loading ? <LoadingState label="コースを読み込んでいます" /> : null}
        {!loading && loadError ? <ResourceError error={loadError} onRetry={loadCourses} /> : null}
        {!loading && !loadError ? (
          <DataTable
            rows={courses}
            columns={columns}
            rowKey={course => course.id}
            empty={(
              <EmptyState
                title="コースが登録されていません"
                description="最初のコースを追加すると、予約商品とスタート枠を設定できます。"
                action={(
                  <Button type="button" variant="primary" onClick={beginCreate}>
                    <Flag /> 最初のコースを追加
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
