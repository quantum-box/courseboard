import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { ArrowDown, ArrowUp, Download, Plus, RotateCcw } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { fieldPlatformId, fieldTenant } from '../../api'
import {
  DataTable, EmptyState, Field, FormGrid, LoadingState, NativeSelect,
  NativeTextarea, Notice, Panel, type DataTableColumn,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import { SettingsSubPage } from '../settings/SettingsSubPage'
import {
  createExportDefinition, downloadExportCsv, emptyExportDraft, exportDraftError,
  exportErrorMessage, exportObjectLabel, loadDataExports, type ExportDefinition, type ExportDraft, type ExportObject,
} from './api'
import './dataExports.css'

export function DataExportsPage() {
  const { t } = useTranslation(['dataExports', 'common'])
  const resource = useResource(loadDataExports, [], { cacheKey: 'bridge:exports' })
  useRegisterPageReload(resource.refresh)
  const [creating, setCreating] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const downloadInFlight = useRef(false)
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null)

  async function download(definition: ExportDefinition) {
    if (downloadInFlight.current) return
    downloadInFlight.current = true
    setDownloading(definition.id)
    setDownloadError(null)
    try {
      await downloadExportCsv(definition)
      showToast({ tone: 'success', message: t('dataExports:downloaded') })
    } catch (error) {
      const message = exportErrorMessage(error, t('dataExports:error.download'))
      setDownloadError({ id: definition.id, message })
      showToast({ tone: 'danger', message })
    } finally {
      downloadInFlight.current = false
      setDownloading(null)
    }
  }

  const objects = resource.data?.objects ?? []
  const columns: DataTableColumn<ExportDefinition>[] = [
    { key: 'name', header: t('dataExports:name'), cell: row => row.name },
    {
      key: 'source', header: t('dataExports:source'),
      cell: row => {
        const object = objects.find(item => item.key === row.sourceObject)
        return object ? exportObjectLabel(object) : row.sourceObject
      },
    },
    {
      key: 'columns', header: t('dataExports:columns'),
      cell: row => row.mapping.fields.map(field => field.target).join(' / '),
    },
    {
      key: 'status', header: t('dataExports:status'),
      cell: row => <Badge variant={row.status === 'active' ? 'accent' : 'outline'}>
        {row.status === 'active' ? t('dataExports:active') : t('dataExports:inactive')}
      </Badge>,
    },
    {
      key: 'download', header: '', align: 'right',
      cell: row => {
        const available = objects.some(object => object.key === row.sourceObject)
        const enabled = row.status === 'active' && row.destinationType === 'csv' && available
        return <div className="data-export-download">
          <Button
            type="button"
            disabled={!enabled || downloading !== null || Boolean(resource.error)}
            title={!available ? t('dataExports:unavailableHint') : !enabled ? t('dataExports:inactiveHint') : undefined}
            aria-label={t('dataExports:downloadNamed', { name: row.name })}
            onClick={() => void download(row)}
          >
            <Download aria-hidden="true" />
            {downloading === row.id ? t('dataExports:downloading') : t('dataExports:download')}
          </Button>
          {downloadError?.id === row.id ? <div className="data-export-error" role="alert">
            <p>{downloadError.message}</p>
            <Button type="button" variant="ghost" disabled={!enabled || downloading !== null || Boolean(resource.error)}
              onClick={() => void download(row)}>{t('common:action.retry')}</Button>
          </div> : null}
        </div>
      },
    },
  ]

  return <div className="data-exports-page"><SettingsSubPage>
      <Panel actions={<Button type="button" onClick={() => setCreating(true)}
        disabled={!resource.data || !objects.length || Boolean(resource.error)}>
        <Plus aria-hidden="true" /> {t('dataExports:create')}
      </Button>}>
        {resource.loading ? <LoadingState /> : null}
        {resource.error ? <Notice tone="danger" actions={<Button type="button"
          onClick={() => void resource.refresh()}>{t('common:action.retry')}</Button>}>
          {exportErrorMessage(resource.error, t('dataExports:error.load'))}
        </Notice> : null}
        {!resource.loading && resource.data ? <>
          {!objects.length ? <Notice>{t('dataExports:noSources')}</Notice> : null}
          <DataTable rows={resource.data.definitions} columns={columns} rowKey={row => row.id}
            empty={<EmptyState title={t('dataExports:emptyTitle')}
              description={t('dataExports:emptyDescription')} />} />
        </> : null}
      </Panel>
      <details className="data-export-help">
        <summary>{t('dataExports:helpTitle')}</summary>
        <p>{t('dataExports:helpDescription')}</p>
      </details>
      {creating ? <ExportDefinitionEditor key={`${fieldPlatformId()}:${fieldTenant()}`} objects={objects} onClose={() => setCreating(false)}
        onSaved={definition => {
          resource.setData(current => current ? {
            ...current, definitions: [...current.definitions, definition],
          } : current)
          setCreating(false)
        }} /> : null}
  </SettingsSubPage></div>
}

function ExportDefinitionEditor({ objects, onClose, onSaved }: {
  objects: ExportObject[]
  onClose: () => void
  onSaved: (definition: ExportDefinition) => void
}) {
  const { t } = useTranslation(['dataExports', 'common'])
  const [draft, setDraft] = useState<ExportDraft>(emptyExportDraft)
  const [saving, setSaving] = useState(false)
  const saveInFlight = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const validation = exportDraftError(draft)

  function changeSource(key: string) {
    const source = objects.find(object => object.key === key)
    setDraft(current => ({
      ...current, sourceObject: key,
      columns: (source?.fields ?? []).map(field => ({ ...field, included: false, target: field.label })),
    }))
    setSaveError(null)
  }

  function moveColumn(index: number, delta: -1 | 1) {
    setDraft(current => {
      const next = [...current.columns]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...current, columns: next }
    })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (validation || saveInFlight.current) return
    saveInFlight.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const definition = await createExportDefinition(draft)
      onSaved(definition)
      showToast({ tone: 'success', message: t('dataExports:saved') })
    } catch (error) {
      const message = exportErrorMessage(error, t('dataExports:error.save'))
      setSaveError(message)
      showToast({ tone: 'danger', message })
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  return <Sheet open onOpenChange={open => { if (!open && !saveInFlight.current) onClose() }}
    title={t('dataExports:create')} description={t('dataExports:editorDescription')}
    className="data-export-editor">
    <form className="page-stack" onSubmit={event => void save(event)}>
      <fieldset className="data-export-fields" disabled={saving}>
        <FormGrid columns={1}>
          <Field label={t('dataExports:name')} required>
            <Input value={draft.name} maxLength={255} onChange={event =>
              setDraft(current => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label={t('dataExports:source')} required>
            <NativeSelect value={draft.sourceObject} onChange={event => changeSource(event.target.value)}>
              <option value="">{t('dataExports:chooseSource')}</option>
              {objects.map(object => <option key={object.key} value={object.key}>{exportObjectLabel(object)}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t('dataExports:description')} requirement="optional">
            <NativeTextarea value={draft.description} onChange={event =>
              setDraft(current => ({ ...current, description: event.target.value }))} />
          </Field>
          <Field label={t('dataExports:status')}>
            <NativeSelect value={draft.status} onChange={event =>
              setDraft(current => ({ ...current, status: event.target.value as ExportDraft['status'] }))}>
              <option value="active">{t('dataExports:active')}</option>
              <option value="inactive">{t('dataExports:inactive')}</option>
            </NativeSelect>
          </Field>
        </FormGrid>
        {draft.columns.length ? <div className="page-stack">
          <div className="data-export-column-toolbar">
            <strong>{t('dataExports:columns')}</strong>
            <Button type="button" variant="ghost" onClick={() => setDraft(current => ({
              ...current, columns: current.columns.map(column => ({ ...column, included: true })),
            }))}>{t('dataExports:selectAll')}</Button>
          </div>
          <ol className="data-export-columns">
            {draft.columns.map((column, index) => <li key={column.field}>
              <label className="data-export-checkbox">
                <input type="checkbox" checked={column.included} onChange={event =>
                  setDraft(current => ({ ...current, columns: current.columns.map((item, position) =>
                    position === index ? { ...item, included: event.target.checked } : item) }))} />
                {column.label}
              </label>
              <Input aria-label={t('dataExports:headerFor', { field: column.label })}
                value={column.target} disabled={!column.included}
                onChange={event => setDraft(current => ({ ...current,
                  columns: current.columns.map((item, position) => position === index
                    ? { ...item, target: event.target.value } : item),
                }))} />
              <div className="data-export-column-actions">
                <Button type="button" variant="ghost" disabled={index === 0}
                  aria-label={t('dataExports:moveUpNamed', { field: column.label })}
                  onClick={() => moveColumn(index, -1)}><ArrowUp aria-hidden="true" />{t('dataExports:moveUp')}</Button>
                <Button type="button" variant="ghost" disabled={index === draft.columns.length - 1}
                  aria-label={t('dataExports:moveDownNamed', { field: column.label })}
                  onClick={() => moveColumn(index, 1)}><ArrowDown aria-hidden="true" />{t('dataExports:moveDown')}</Button>
              </div>
            </li>)}
          </ol>
        </div> : null}
        <Button type="button" variant="ghost" onClick={() => {
          setDraft(emptyExportDraft())
          setSaveError(null)
        }}><RotateCcw aria-hidden="true" />{t('dataExports:reset')}</Button>
      </fieldset>
      {validation ? <p className="data-export-validation" role="status">{validation}</p> : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
      <Button type="submit" disabled={saving || Boolean(validation)}>
        {saving ? t('common:action.saving') : saveError ? t('common:action.retry') : t('common:action.save')}
      </Button>
    </form>
  </Sheet>
}
