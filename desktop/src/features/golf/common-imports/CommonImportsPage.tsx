import { Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../auth/AuthProvider'
import { ApiError, courseboardApiJson } from '../../../api'
import { Field, LoadingState, NativeSelect, Notice, PageHeader, Panel } from '../../../components/Page'
import { clearResourceCache } from '../../../hooks/useResource'
import { navigate } from '../../../lib/router'
import { useRouteGate } from '../../../feature-flags/gated-routes'
import { downloadTemplate, getJob, getPreview, issueMessage, listJobs, listTargets, previewImport, reuploadSource, statusLabels, stepJob, targetLabels, uploadImport, type ImportJob, type ImportMode, type ImportOptions, type ImportRow, type ImportTarget } from './api'
import { importFilePlanLabels, inspectImportFile } from './import-file-inspection'

const reportKey = 'courseboardReservationReports'
const reportFields = [{ key: 'facilityName', label: '施設名' }, { key: 'date', label: '日付' }, { key: 'dayPart', label: '午前・午後' }, { key: 'groupCount', label: '組数' }, { key: 'caddieAttachedGroupCount', label: 'キャディ付き組数' }]
const resultRoutes: Record<string, string> = { customer: 'golf/customers', dailyBudgets: 'golf/budgets', [reportKey]: 'golf/reservation-report-import' }
const hidden = new Set(['id', 'sourceCourseKey', 'golfCourseId', 'tenantId', 'sourceFileSha256', 'bucket'])

export function CommonImportsPage({ initialTarget = 'customer' }: { initialTarget?: string }) {
  const auth = useAuth()
  const reportGate = useRouteGate('golf/reservation-report-import')
  const tenant = auth.state.status === 'ready' ? auth.state.tenant.id : ''
  const [targets, setTargets] = useState<ImportTarget[]>([])
  const [key, setKey] = useState(initialTarget)
  const [mode, setMode] = useState<ImportMode>(initialTarget === 'dailyBudgets' ? 'upsert' : 'create_only')
  const [options, setOptions] = useState<ImportOptions>({ year: new Date().getFullYear(), courseMappings: {}, columnMappings: {} })
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([])
  const [facility, setFacility] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [preview, setPreview] = useState<ImportRow[]>([])
  const [page, setPage] = useState(0)
  const [history, setHistory] = useState<ImportJob[]>([])
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [plan, setPlan] = useState('')
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const currentJob = useRef<ImportJob | null>(null)
  const currentOptions = useRef(options)
  currentOptions.current = options
  function apply(next: ImportJob, explicitPreview = false) {
    currentJob.current = next; setJob(next)
    if (explicitPreview || next.preview.length) { setPreview(next.preview); setPage(next.previewPage) }
  }
  function begin() {
    controller.current?.abort()
    controller.current = new AbortController()
    return { signal: controller.current.signal, version: ++generation.current }
  }
  const live = (version: number) => version === generation.current
  const availableTargets = targets.filter(target => target.key !== reportKey || reportGate === 'visible')
  const selected = availableTargets.find(target => target.key === key)
  const report = key === reportKey
  const pageCount = job?.batch ? job.previewPages : Math.ceil(preview.length / 100)
  const shown = job?.batch ? preview : preview.slice(page * 100, (page + 1) * 100)
  const labels = useMemo(() => ({ ...Object.fromEntries((selected?.import.fields ?? []).map(f => [f.key, f.label])), sourceCourseName: '施設名', date: '日付', dayPart: '午前・午後', groupCount: '組数', caddieAttachedGroupCount: 'キャディ付き組数' }), [selected])
  const columns = [...new Set(shown.flatMap(row => Object.keys(row.object)))].filter(column => !hidden.has(column) && column in labels)
  useEffect(() => {
    const { signal, version } = begin()
    setJob(null); currentJob.current = null; setPreview([]); setFile(null); setError(''); setBusy(false)
    setTargets([]); setHistory([]); setCourses([]); setPlan(''); setPage(0); setDirty(false); setFacility('')
    setOptions({ year: new Date().getFullYear(), courseMappings: {}, columnMappings: {} })
    Promise.all([listTargets(signal), listJobs(signal), courseboardApiJson<{ items: { id: string; name: string }[] }>('/v1/course/courses', { signal }).catch(() => ({ items: [] }))])
      .then(([catalog, jobs, catalogCourses]) => { if (live(version)) { setTargets(catalog); setHistory(jobs); setCourses(catalogCourses.items); if (!catalog.some(t => t.key === key)) setKey(catalog[0]?.key ?? '') } })
      .catch(e => { if (live(version)) setError(e instanceof Error ? e.message : '取込対象を取得できませんでした。') })
    return () => { generation.current++; controller.current?.abort() }
  // Tenant changes invalidate the entire import session, including delayed replies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant])
  useEffect(() => {
    if (targets.length === 0) return
    if (key === reportKey && reportGate === 'loading') return
    if (!selected) { setKey(availableTargets[0]?.key ?? ''); return }
    if (!selected.importModes.includes(mode)) setMode(selected.importModes[0] ?? 'create_only')
  }, [targets, key, mode, reportGate, selected, availableTargets])
  function configure(next: ImportOptions) {
    controller.current?.abort(); generation.current++; setBusy(false); setOptions(next); setDirty(Boolean(job))
  }
  async function runLoop(next: ImportJob, operation: 'validate' | 'advance', version: number, signal: AbortSignal) {
    while (live(version) && (operation === 'validate' ? ['uploading', 'validating'].includes(next.status) : ['ready', 'running'].includes(next.status))) {
      try { next = await stepJob(next.id, operation, signal) }
      catch (error) {
        try { const current = await getJob(next.id, signal); if (live(version)) apply(current) } catch { /* Keep the last preview if the status request also fails. */ }
        throw error
      }
      if (!live(version)) return
      apply(next)
    }
    if (live(version) && ['completed', 'completed_with_errors'].includes(next.status)) {
      clearResourceCache(); setHistory(await listJobs(signal))
    }
  }
  async function validate(selectedFile = file) {
    if (!selectedFile || !selected) return
    const previous = currentJob.current
    const { signal, version } = begin()
    setBusy(true); setError(''); setDirty(false); setPreview([]); setPage(0); setJob(null); currentJob.current = null
    try {
      if (previous && !['completed', 'completed_with_errors', 'cancelled'].includes(previous.status)) await cancelPending(previous, signal)
      const route = await inspectImportFile(selectedFile, signal)
      if (!live(version)) return
      setPlan(importFilePlanLabels[route])
      const snapshot = structuredClone(currentOptions.current)
      const idempotencyKey = crypto.randomUUID()
      const next = route === 'single'
        ? await previewImport(key, selectedFile, mode, snapshot, idempotencyKey, signal)
        : await uploadImport(key, selectedFile, mode, snapshot, idempotencyKey, signal, reserved => { if (live(version)) apply(reserved) })
      if (!live(version)) return
      apply(next, true)
      await runLoop(next, 'validate', version, signal)
      if (live(version)) setHistory(await listJobs(signal))
    } catch (e) { if (live(version)) setError(e instanceof Error ? e.message : '検証できませんでした。') }
    finally { if (live(version)) setBusy(false) }
  }
  async function execute() {
    if (!job || dirty) return
    const { signal, version } = begin(); setBusy(true); setError('')
    try { await runLoop(job, 'advance', version, signal) }
    catch (e) { if (live(version)) setError(e instanceof Error ? e.message : '処理を再開してください。') }
    finally { if (live(version)) setBusy(false) }
  }
  async function resume(source = file) {
    if (!job || dirty) return
    const { signal, version } = begin(); setBusy(true); setError('')
    try { const next = await stepJob(job.id, 'resume', signal); if (live(version)) { apply(next); if (next.status === 'uploading') { if (!source) throw new Error('元のファイルを選び直すと、同じ取込のアップロードを再開できます。'); await reuploadSource(next, source, signal) } if (['uploading', 'validating'].includes(next.status)) await runLoop(next, 'validate', version, signal) } }
    catch (e) { if (live(version)) setError(e instanceof Error ? e.message : '再開できませんでした。') }
    finally { if (live(version)) setBusy(false) }
  }
  async function cancelPending(selectedJob: ImportJob, signal: AbortSignal): Promise<ImportJob> {
    const end = Date.now() + 125_000
    for (;;) {
      signal.throwIfAborted()
      try { return await stepJob(selectedJob.id, 'cancel', signal) }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409 || Date.now() >= end) throw error
        const current = await getJob(selectedJob.id, signal)
        if (['cancelled', 'completed', 'completed_with_errors'].includes(current.status)) return current
        await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(signal.reason) }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1000); signal.addEventListener('abort', abort, { once: true }) })
      }
    }
  }
  async function cancel() {
    const selectedJob = currentJob.current
    const { signal, version } = begin(); setBusy(true); setError('')
    try { if (selectedJob) { const next = await cancelPending(selectedJob, signal); if (live(version)) apply(next) } }
    catch (e) { if (live(version)) setError(e instanceof Error ? e.message : '中止状態を確認できませんでした。') }
    finally { if (live(version)) setBusy(false) }
  }
  async function openJob(item: ImportJob) {
    const { signal, version } = begin(); setBusy(true); setError('')
    try {
      const next = await getJob(item.id, signal)
      if (!live(version)) return
      setKey(next.objectKey); setMode(next.mode); setOptions(next.importOptions); setDirty(false); setFile(null); apply(next, true)
      if (next.batch && next.previewPages > 0) { const first = await getPreview(next.id, 0, signal); if (live(version)) apply(first, true) }
    } catch (e) { if (live(version)) setError(e instanceof Error ? e.message : '履歴を取得できませんでした。') }
    finally { if (live(version)) setBusy(false) }
  }
  async function changePage(nextPage: number) {
    if (!job?.batch) { setPage(nextPage); return }
    const { signal, version } = begin(); setBusy(true); setError('')
    try { const next = await getPreview(job.id, nextPage, signal); if (live(version)) apply(next, true) }
    catch (e) { if (live(version)) setError(e instanceof Error ? e.message : 'ページを取得できませんでした。') }
    finally { if (live(version)) setBusy(false) }
  }
  return <div className="page-stack">
    <PageHeader title="共通取込" description="全行を検証してから取り込みます。結果は顧客台帳・日次予算・予約表集計に反映されます。" />
    {error && <Notice tone="danger">{error}</Notice>}
    <Panel title="1. 対象とファイル">
      <Field label="取込対象"><NativeSelect value={key} disabled={busy} onChange={event => { setKey(event.target.value); setMode(event.target.value === 'dailyBudgets' ? 'upsert' : 'create_only'); setFile(null); setDirty(Boolean(job)); setPreview([]); setJob(null); controller.current?.abort(); generation.current++ }}>
        {availableTargets.map(target => <option key={target.key} value={target.key}>{target.label}</option>)}
      </NativeSelect></Field>
      <div className="flex gap-2"><Button disabled={!selected || busy} onClick={() => void downloadTemplate(key, 'csv').catch(e => setError(String(e)))}>CSVテンプレート</Button><Button disabled={!selected || busy} onClick={() => void downloadTemplate(key, 'excel').catch(e => setError(String(e)))}>Excelテンプレート</Button></div>
      {selected && selected.importModes.length > 1 && <Field label="登録方法"><NativeSelect value={mode} disabled={busy} onChange={event => { setMode(event.target.value as ImportMode); setDirty(Boolean(job)) }}>
        {selected.importModes.map(value => <option key={value} value={value}>{({ create_only: '新規登録', update_only: '既存データを更新', upsert: '新規登録・更新' })[value]}</option>)}
      </NativeSelect></Field>}
      {key === 'dailyBudgets' && <Notice>コース・日付に既存の予算がある場合は「新規登録・更新」を選んでください。</Notice>}
      {report && <>
        <Field label="対象年"><Input type="number" min="1" max="9999" value={options.year ?? ''} disabled={busy} onChange={event => configure({ ...options, year: Number(event.target.value) })} /></Field>
        <details><summary>列の対応を指定</summary>{reportFields.map(field => <Field key={field.key} label={field.label}><Input value={options.columnMappings?.[field.key] ?? ''} placeholder="元ファイルの列名（空欄は自動対応）" disabled={busy} onChange={event => configure({ ...options, columnMappings: { ...options.columnMappings, [field.key]: event.target.value } })} /></Field>)}</details>
        <details><summary>施設とコースの対応</summary>
          <Field label="元ファイルの施設名"><Input value={facility} disabled={busy} onChange={event => setFacility(event.target.value)} /></Field>
          <Field label="対応するコース"><NativeSelect value={options.courseMappings?.[facility] ?? ''} disabled={busy || !facility.trim()} onChange={event => configure({ ...options, courseMappings: { ...options.courseMappings, [facility]: event.target.value } })}>
            <option value="">未連携施設として保存</option>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
          </NativeSelect></Field>
          <p>対応を指定しない施設も、未連携施設として保存されます。</p>
        </details>
      </>}
      <Field label="CSV／Excel"><input aria-label="CSV／Excel" type="file" accept=".csv,.xls,.xlsx" disabled={!selected} onChange={event => { const chosen = event.target.files?.[0]; if (chosen) { setFile(chosen); void validate(chosen) } }} /></Field>
      {file && <p>{file.name}</p>}{plan && <p>{plan}</p>}
      {dirty && <Notice tone="warning">設定が変わりました。元のファイルを選び、全行を再検証してください。</Notice>}
      {dirty && file && <Button disabled={busy} onClick={() => void validate()}>この設定で再検証</Button>}
    </Panel>
    {job && <Panel title="2. 検証結果と実行確認">
      <p role="status">{statusLabels[job.status] ?? '状態を確認中'}：{job.processed} / {job.total ?? '確認中'} 行</p>
      {busy && <LoadingState label={job.status === 'running' ? '取り込み中…' : '処理中…'} />}
      {job.failure && <Notice tone="danger">{job.failure}</Notice>}
      {job.validationErrors.map((issue, index) => <Notice key={index} tone="danger">{issue && typeof issue === 'object' && 'rowNumber' in issue ? `${String(issue.rowNumber)} 行目：` : ''}{issueMessage(issue)}</Notice>)}
      {preview.length > 0 && <div className="overflow-x-auto"><table><thead><tr><th>元の行</th>{columns.map(column => <th key={column}>{labels[column as keyof typeof labels]}</th>)}<th>確認・結果</th></tr></thead><tbody>
        {shown.map((row, index) => <tr key={`${row.rowNumber}:${index}`}><td>{row.rowNumber}</td>{columns.map(column => <td key={column}>{row.object[column] === 'morning' ? '午前' : row.object[column] === 'afternoon' ? '午後' : String(row.object[column] ?? '')}</td>)}<td>{row.error ?? row.warnings.map(issueMessage).join(' / ') ?? ''}{row.outcome === 'created' ? '登録済み' : row.outcome === 'updated' ? '更新済み' : ''}</td></tr>)}
      </tbody></table></div>}
      {pageCount > 1 && <div className="flex gap-2"><Button disabled={busy || page === 0} onClick={() => void changePage(page - 1)}>前のページ</Button><span>{page + 1} / {pageCount} ページ</span><Button disabled={busy || page + 1 >= pageCount} onClick={() => void changePage(page + 1)}>次のページ</Button></div>}
      <div className="flex gap-2">
        {job.status === 'ready' && <Button variant="primary" disabled={busy || dirty} onClick={() => void execute()}>確認して取り込む</Button>}
        {job.status === 'cancelled' && <Button disabled={busy || dirty} onClick={() => void resume()}>中止した取込を再開</Button>}
        {job.status === 'running' && <Button variant="primary" disabled={busy || dirty} onClick={() => void execute()}>処理を再開</Button>}
        {job.status === 'uploading' && !busy && <Field label="元のファイルを選んでアップロードを再開"><Input type="file" accept=".csv,.xls,.xlsx" onChange={event => { const source = event.target.files?.[0]; if (source) { setFile(source); void resume(source) } }} /></Field>}
        {job.status === 'validating' && !busy && <Button onClick={() => { const { signal, version } = begin(); setBusy(true); void runLoop(job, 'validate', version, signal).catch(e => { if (live(version)) setError(String(e)) }).finally(() => { if (live(version)) setBusy(false) }) }}>検証を再開</Button>}
        {!['completed', 'completed_with_errors', 'cancelled'].includes(job.status) && <Button onClick={() => void cancel()}>中止</Button>}
        {['completed', 'completed_with_errors'].includes(job.status) && <Button onClick={() => navigate(resultRoutes[job.objectKey])}>保存先の画面を開く</Button>}
      </div>
      {job.status === 'ready' && <p>実行確認前には対象データを書き込みません。{report ? '予約表集計は、全行を処理してから施設単位で一括反映します。' : ''}</p>}
    </Panel>}
    <Panel title="進捗・結果・履歴">{history.filter(item => item.objectKey !== reportKey || reportGate === 'visible').length ? history.filter(item => item.objectKey !== reportKey || reportGate === 'visible').map(item => <div key={item.id} className="flex items-center justify-between gap-2"><span>{targetLabels[item.objectKey]} · {item.filename ?? 'CSV'} · {statusLabels[item.status]} · {item.processed}/{item.total ?? '確認中'}行</span><Button disabled={busy} onClick={() => void openJob(item)}>確認する</Button></div>) : <p>取込履歴はありません。</p>}</Panel>
  </div>
}
