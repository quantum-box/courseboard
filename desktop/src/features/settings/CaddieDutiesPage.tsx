import { Button, Input } from '@tachyon-sdk/native-ui'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
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
import {
  MAX_CADDIE_DUTIES,
  MAX_CADDIE_DUTY_LENGTH,
  normalizedCaddieDuties,
  validateCaddieDuties,
} from '../golf/caddieDuties'
import { SettingsSubPage } from './SettingsSubPage'

const caddieDutiesPath = '/v1/course/caddie-duties'

type DutyRow = { label: string; index: number }

/** The row the sheet is on: an existing position, or a new one at the end. */
type DutyEdit = { index: number | null; label: string }

/**
 * The jobs this club fills when a caddie has no round.
 *
 * A pick list rather than a free text box on the dispatch screen: a job typed
 * once at the desk is one nothing else can group, count, or find again. The
 * days already filed keep the name they were filed under, so retiring a job
 * here never rewrites what last week says a caddie did.
 *
 * Order is the club's own — the dispatch sheet offers the list in this order,
 * so the jobs a course actually fills belong at the top.
 */
export function CaddieDutiesPage() {
  const { t } = useTranslation(['settings', 'common'])
  const resource = useResource(
    () => courseboardApiJson<{ items: string[] }>(caddieDutiesPath),
    [],
    { cacheKey: 'course:caddie-duties' },
  )
  useRegisterPageReload(resource.refresh)
  const [editing, setEditing] = useState<DutyEdit | null>(null)
  const [saving, setSaving] = useState(false)

  const duties = useMemo(() => resource.data?.items ?? [], [resource.data])
  const rows = useMemo<DutyRow[]>(() => duties.map((label, index) => ({ label, index })), [duties])

  /**
   * Every edit writes the whole list, because that is the shape of the API.
   * A write that fails leaves the saved list as it was rather than half
   * applied, so the sheet stays open on what the operator typed.
   */
  async function commit(next: string[]) {
    setSaving(true)
    try {
      await courseboardApiJson<{ items: string[] }>(caddieDutiesPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: normalizedCaddieDuties(next) }),
      })
      showToast({ tone: 'success', message: t('settings:caddieDuties.saved') })
      setEditing(null)
      await resource.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('settings:caddieDuties.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= duties.length) return
    const next = [...duties]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved as string)
    void commit(next)
  }

  const columns = useMemo<DataTableColumn<DutyRow>[]>(
    () => [
      {
        key: 'rank',
        header: t('settings:caddieDuties.rank'),
        align: 'right',
        cell: row => row.index + 1,
      },
      {
        key: 'label',
        header: t('settings:caddieDuties.field.label'),
        cell: row => row.label,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: row => (
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('settings:caddieDuties.moveUp')}
              disabled={saving || row.index === 0}
              onClick={event => {
                event.stopPropagation()
                move(row.index, -1)
              }}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('settings:caddieDuties.moveDown')}
              disabled={saving || row.index === duties.length - 1}
              onClick={event => {
                event.stopPropagation()
                move(row.index, 1)
              }}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('settings:caddieDuties.remove')}
              disabled={saving}
              onClick={event => {
                event.stopPropagation()
                void commit(duties.filter((_, position) => position !== row.index))
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ),
      },
    ],
    // `move` and `commit` are re-created every render; the list and the saving
    // flag are what actually change what these buttons do.
    [t, duties, saving],
  )

  const draft = editing
    ? editing.index === null
      ? [...duties, editing.label]
      : duties.map((duty, position) => (position === editing.index ? editing.label : duty))
    : duties
  const problem = validateCaddieDuties(draft)

  return (
    <SettingsSubPage>
      <Panel
        title={t('settings:caddieDuties.title')}
        description={t('settings:caddieDuties.description')}
        actions={
          <Button
            type="button"
            size="sm"
            disabled={duties.length >= MAX_CADDIE_DUTIES}
            onClick={() => setEditing({ index: null, label: '' })}
          >
            <Plus />
            {t('settings:caddieDuties.add')}
          </Button>
        }
      >
        {resource.loading ? <LoadingState /> : null}
        {resource.error ? (
          <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
        ) : null}

        {!resource.loading && !resource.error ? (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={row => String(row.index)}
            onRowClick={row => setEditing({ index: row.index, label: row.label })}
            empty={
              <EmptyState
                title={t('settings:caddieDuties.emptyTitle')}
                description={t('settings:caddieDuties.empty')}
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
          editing?.index === null
            ? 'settings:caddieDuties.addTitle'
            : 'settings:caddieDuties.editTitle',
        )}
      >
        <div className="space-y-3">
          <Field label={t('settings:caddieDuties.field.label')} requirement="required">
            <Input
              value={editing?.label ?? ''}
              placeholder={t('settings:caddieDuties.placeholder')}
              onChange={event =>
                setEditing(current => (current ? { ...current, label: event.target.value } : current))
              }
            />
          </Field>

          {problem === 'duplicate' ? (
            <Notice tone="danger">{t('settings:caddieDuties.duplicate')}</Notice>
          ) : null}
          {problem === 'tooLong' ? (
            <Notice tone="danger">
              {t('settings:caddieDuties.tooLong', { max: String(MAX_CADDIE_DUTY_LENGTH) })}
            </Notice>
          ) : null}
          {problem === 'tooMany' ? (
            <Notice tone="danger">
              {t('settings:caddieDuties.tooMany', { max: String(MAX_CADDIE_DUTIES) })}
            </Notice>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              {t('common:action.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={saving || (editing?.label ?? '').trim() === '' || problem !== null}
              onClick={() => void commit(draft)}
            >
              {saving ? t('common:action.saving') : t('common:action.save')}
            </Button>
          </div>
        </div>
      </Sheet>
    </SettingsSubPage>
  )
}
