import { Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../../api'
import { useAuth } from '../../../auth/AuthProvider'
import { Field, LoadingState, NativeSelect, Notice, Panel } from '../../../components/Page'
import { clearResourceCache } from '../../../hooks/useResource'
import { navigate } from '../../../lib/router'
import { showToast } from '../../../lib/toast'
import { getJob, issueMessage, listTargets, type ImportJob, type ImportOptions, type ImportTarget } from './api'
import { executeDocumentRevision, fetchDocumentOriginal, readReservationDocument, reserveReservationDocument, saveDocumentRevision, uploadDocumentSources, type DocumentRow, type DocumentSource } from './document-api'
import { businessValues, operationStorageKey, persistDocumentOperation, readDocumentOperation, remapReviewedRow, reservationFields, reviewedRows, sourceCells, type DocumentOperation, type DocumentUploadSnapshot, type ReservationField, type ReservationValues } from './document-review'
import './document-import.css'
import { PdfPages } from '../customers/reception/PdfPages'

const targetKey = 'courseboardReservationReports'
const listRoute = `golf/data-imports/${targetKey}`
type Course = { id: string; name: string; isActive?: boolean }
export function ReservationDocumentPage({ jobId }: { jobId?: string }) {
  const { t } = useTranslation('documentImport')
  const auth = useAuth()
  const identity = auth.state.status === 'ready' ? auth.state : null
  const storageKey = operationStorageKey(identity?.tenant.operatorId ?? '', identity?.tenant.platformId ?? '', identity?.user.id ?? '')
  const [target, setTarget] = useState<ImportTarget>()
  const [courses, setCourses] = useState<Course[]>([])
  const [catalogReady, setCatalogReady] = useState(false)
  const [job, setJob] = useState<ImportJob>()
  const [rows, setRows] = useState<DocumentRow[]>([])
  const [options, setOptions] = useState<ImportOptions>({ year: new Date().getFullYear(), columnMappings: {}, courseMappings: {} })
  const [files, setFiles] = useState<File[]>([])
  const [rotations, setRotations] = useState<DocumentSource['rotation'][]>([])
  const [pages, setPages] = useState('')
  const [uploadSnapshot, setUploadSnapshot] = useState<DocumentUploadSnapshot>()
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [physicalPage, setPhysicalPage] = useState(1)
  const [originalUrl, setOriginalUrl] = useState('')
  const [verifiedSource, setVerifiedSource] = useState<number>()
  const [renderedPage, setRenderedPage] = useState<number>()
  const [discardConfirmation, setDiscardConfirmation] = useState(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const blobUrl = useRef('')
  const current = useRef<ImportJob | undefined>(undefined)
  const document = job?.document
  const expired = !!document && Date.now() >= Date.parse(document.expiresAt)
  const locked = !!document?.executionConfirmed || expired || ['failed', 'cancelled', 'expired'].includes(document?.ocrStatus ?? '')
  const canCreate = target?.documentImport?.pricingStatus === 'undecided' && catalogReady
  const columns = [...new Set(rows.flatMap(row => Object.keys(sourceCells(row))))]
  const facilities = [...new Set(rows.filter(row => !row.excludedReason).flatMap(row => businessValues(row).map(value => value.facilityName)).filter(Boolean))]
  const sourcePages = [...new Set(rows.filter(row => row.source.fileIndex === sourceIndex).map(row => row.source.page))]
  const visiblePage = sourcePages.includes(physicalPage) ? physicalPage : sourcePages[0] ?? 1
  useEffect(() => { setRenderedPage(undefined) }, [sourceIndex, visiblePage, originalUrl])
  const completeReview = rows.length > 0 && rows.every(row => row.values.originalConfirmed === true && (row.excludedReason == null || !!row.excludedReason.trim()))

  function apply(next: ImportJob, restore = false) {
    const previous = current.current
    if (next.objectKey !== targetKey || !next.document) throw new Error(t('error.job'))
    current.current = next
    setJob(next)
    if (restore || previous?.id !== next.id || previous.document?.ocrStatus !== 'completed' && next.document.ocrStatus === 'completed' || previous.document?.revisionVersion !== next.document.revisionVersion) {
      setRows(reviewedRows(next.document)); setOptions(next.importOptions); setDirty(false); setPage(0)
    }
    if (next.status === 'completed') clearResourceCache('reservation-report')
  }
  async function run(task: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort()
    const active = new AbortController(); controller.current = active
    setBusy(true); setError('')
    try { await task(active.signal) }
    catch (failure) { if (!active.signal.aborted) { const message = failure instanceof Error ? failure.message : t('error.retry'); setError(message); showToast({ tone: 'danger', message }) } }
    finally { if (controller.current === active) setBusy(false) }
  }
  useEffect(() => {
    current.current = undefined; setJob(undefined); setRows([]); setDirty(false); setTarget(undefined); setCatalogReady(false); setFiles([]); setRotations([]); setVerifiedSource(undefined)
    setUploadSnapshot(undefined); setPages(''); setOptions({ year: new Date().getFullYear(), columnMappings: {}, courseMappings: {} })
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
    blobUrl.current = ''; setOriginalUrl('')
    if (!identity) return
    void run(async signal => {
      const pending = jobId ? null : readDocumentOperation(storageKey)
      if (pending?.upload) {
        setUploadSnapshot(pending.upload); setPages(pending.upload.pages); setRotations(pending.upload.rotations)
        setOptions({ year: pending.upload.year, columnMappings: {}, courseMappings: {} })
      }
      const id = jobId ?? pending?.jobId
      const [catalog, courseList, restored] = await Promise.allSettled([
        listTargets(signal), courseboardApiJson<{ items: Course[] }>('/v1/course/courses', { signal }), id ? getJob(id, signal) : undefined,
      ])
      signal.throwIfAborted()
      if (restored.status === 'fulfilled' && restored.value) apply(restored.value, true)
      if (catalog.status === 'fulfilled') setTarget(catalog.value.find(item => item.key === targetKey))
      if (courseList.status === 'fulfilled') setCourses(courseList.value.items.filter(course => course.isActive !== false))
      setCatalogReady(catalog.status === 'fulfilled' && courseList.status === 'fulfilled')
      if (restored.status === 'rejected') throw restored.reason
      if (catalog.status === 'rejected' || courseList.status === 'rejected') setError(t('catalogMessage'))
    })
    return () => { controller.current?.abort(); if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); blobUrl.current = '' }
    // Tenant/actor/platform changes invalidate delayed replies and local handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, jobId])

  async function readAll(initial: ImportJob, signal: AbortSignal) {
    let next = initial
    for (let step = 0; step < 256 && !['completed', 'failed', 'cancelled', 'expired'].includes(next.document!.ocrStatus); step++) {
      signal.throwIfAborted()
      const result = await readReservationDocument(next.id, next.document!.ocrStatus === 'uploading' ? 'confirm' : 'advance', signal)
      signal.throwIfAborted(); next = result.job; apply(next)
    }
    if (next.document!.ocrStatus !== 'completed') throw new Error(t('error.read'))
    showToast({ tone: 'success', message: t('readComplete') })
  }
  async function start(signal: AbortSignal) {
    let operation = readDocumentOperation(storageKey)
    if (!operation) operation = { idempotencyKey: crypto.randomUUID() }
    if (!operation.upload) operation = { ...operation, upload: { year: options.year!, pages, rotations } }
    persistDocumentOperation(storageKey, operation)
    const snapshot = operation.upload!
    setUploadSnapshot(snapshot)
    const reserved = await reserveReservationDocument(files, snapshot.rotations, snapshot.pages, { year: snapshot.year, columnMappings: {}, courseMappings: {} }, operation.idempotencyKey, signal)
    signal.throwIfAborted()
    persistDocumentOperation(storageKey, { ...operation, jobId: reserved.job.id }); apply(reserved.job, true)
    if (reserved.ocr.status === 'uploading') await uploadDocumentSources(reserved.job, reserved.ocr, files, signal)
    await readAll(reserved.job, signal)
  }
  async function resumeUpload(signal: AbortSignal) {
    const result = await readReservationDocument(job!.id, 'uploads', signal)
    await uploadDocumentSources(result.job, { ...result.ocr, uploads: result.uploads }, files, signal)
    await readAll(result.job, signal)
  }
  function edit(index: number, change: (row: DocumentRow) => DocumentRow) {
    setRows(previous => previous.map((row, i) => i === index ? change({ ...row, values: { ...row.values, originalConfirmed: false } }) : row)); setDirty(true)
  }
  function editValue(index: number, manualIndex: number, field: ReservationField, value: string) {
    edit(index, row => {
      const values = businessValues(row); values[manualIndex] = { ...values[manualIndex]!, [field]: value }
      return { ...row, values: { ...row.values, editedFields: [...new Set([...(Array.isArray(row.values.editedFields) ? row.values.editedFields : []), field])], ...(Array.isArray(row.values.manualRows) ? { manualRows: values } : { normalized: values[0] }) } }
    })
  }
  function changeMapping(field: ReservationField, column: string) {
    const mappings = { ...options.columnMappings, [field]: column }
    setOptions(previous => ({ ...previous, columnMappings: mappings }))
    setRows(previous => previous.map(row => remapReviewedRow(row, options.columnMappings ?? {}, mappings))); setDirty(true)
  }
  async function inspect(signal: AbortSignal) {
    const restored = (await readReservationDocument(job!.id, 'inspect', signal)).job
    signal.throwIfAborted(); apply(restored)
  }
  async function retryCatalog(signal: AbortSignal) {
    const [catalog, courseList] = await Promise.all([listTargets(signal), courseboardApiJson<{ items: Course[] }>('/v1/course/courses', { signal })])
    signal.throwIfAborted(); setTarget(catalog.find(item => item.key === targetKey)); setCourses(courseList.items.filter(course => course.isActive !== false)); setCatalogReady(true)
  }
  async function save(signal: AbortSignal) {
    const saved = await saveDocumentRevision(job!, rows, signal, options)
    signal.throwIfAborted(); apply(saved, true); showToast({ tone: 'success', message: t('revisionSaved') })
  }
  async function progress(operation: 'validate' | 'confirm', signal: AbortSignal) {
    let next = job!
    for (let step = 0; step < 512; step++) {
      next = await executeDocumentRevision(next, operation, signal)
      signal.throwIfAborted(); apply(next)
      if (operation === 'validate' ? next.status !== 'validating' : !['ready', 'running'].includes(next.status)) break
    }
    if (next.status === 'completed') showToast({ tone: 'success', message: t('completed') })
  }
  async function openOriginal(signal: AbortSignal) {
    const original = await fetchDocumentOriginal(job!, sourceIndex, signal)
    signal.throwIfAborted()
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
    blobUrl.current = URL.createObjectURL(original); setOriginalUrl(blobUrl.current); setVerifiedSource(sourceIndex)
  }
  function confirmPage() {
    setRows(previous => previous.map(row => row.source.fileIndex === sourceIndex && row.source.page === visiblePage ? { ...row, values: { ...row.values, originalConfirmed: true } } : row)); setDirty(true)
  }
  function chooseFiles(chosen: File[]) { setFiles(chosen); setRotations(chosen.map((_, index) => uploadSnapshot?.rotations[index] ?? 0)) }
  function newDocument() {
    const operation: DocumentOperation = { idempotencyKey: crypto.randomUUID() }
    persistDocumentOperation(storageKey, operation)
    current.current = undefined; setJob(undefined); setRows([]); setFiles([]); setRotations([]); setDirty(false); setOriginalUrl(''); setVerifiedSource(undefined)
    setUploadSnapshot(undefined); setPages(''); setOptions({ year: new Date().getFullYear(), columnMappings: {}, courseMappings: {} })
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); blobUrl.current = ''
    setDiscardConfirmation(false)
    if (jobId) navigate(`${listRoute}/documents`)
  }

  return <div className="document-import-page">
    <Button onClick={() => navigate(listRoute)}>{t('back')}</Button>
    <h1>{t('title')}</h1>
    {busy && <LoadingState label={t('working')} />}
    {error && <div role="alert"><p>{error}</p>{job && <Button disabled={busy} onClick={() => void run(inspect)}>{t('inspect')}</Button>}{!catalogReady && <Button disabled={busy} onClick={() => void run(retryCatalog)}>{t('retryCatalog')}</Button>}</div>}
    {!job && <Panel title={t('choose')}>
      {!canCreate && !busy && <Notice tone="warning">{t('unavailable')}</Notice>}
      <p>{t('pricingMessage')}</p><p>{t('limitsMessage')}</p>
      <Field label={t('fields.year')}><Input type="number" min={1900} max={9999} value={options.year ?? ''} disabled={busy || !!uploadSnapshot} onChange={event => setOptions(previous => ({ ...previous, year: Number(event.target.value) }))} /></Field>
      <Field label={t('pages')} hint={t('pagesMessage')}><Input value={pages} maxLength={256} disabled={busy || !!uploadSnapshot} onChange={event => setPages(event.target.value)} /></Field>
      <Field label={t('files')}><Input type="file" accept="application/pdf,.pdf" multiple disabled={busy || !canCreate} onChange={event => chooseFiles(Array.from(event.target.files ?? []))} /></Field>
      {files.map((file, index) => <Field key={index} label={file.name}><NativeSelect aria-label={t('rotation', { file: file.name })} value={rotations[index]} disabled={busy || !!uploadSnapshot} onChange={event => setRotations(previous => previous.map((rotation, i) => i === index ? Number(event.target.value) as DocumentSource['rotation'] : rotation))}>{[0, 90, 180, 270].map(rotation => <option key={rotation} value={rotation}>{t('degrees', { rotation })}</option>)}</NativeSelect></Field>)}
      <Button variant="primary" disabled={busy || !canCreate || !files.length || files.length > 32 || !Number.isInteger(options.year) || options.year! < 1900 || options.year! > 9999} onClick={() => void run(start)}>{t('start')}</Button>
      {uploadSnapshot && <Button disabled={busy} onClick={() => void run(async () => newDocument())}>{t('newDocument')}</Button>}
    </Panel>}
    {job && document && <>
      <p role="status">{t(`status.${job.status}`, { defaultValue: t('status.reading') })} · {document.executionConfirmed ? `${job.processed} / ${job.total ?? rows.length}` : rows.length} {t('rows')}</p>
      {expired && <Notice tone="warning">{t('expiredMessage')}</Notice>}
      {!document.executionConfirmed && (expired || ['failed', 'cancelled', 'expired'].includes(document.ocrStatus)) && <Panel title={t('newDocument')}><p>{t('newReadMessage')}</p><Button disabled={busy} onClick={() => void run(async () => newDocument())}>{t('newDocument')}</Button></Panel>}
      {!document.executionConfirmed && document.ocrStatus !== 'cancelled' && <Button disabled={busy} onClick={() => setDiscardConfirmation(true)}>{t('discard')}</Button>}
      {discardConfirmation && <Panel title={t('discard')}><p>{t('discardMessage')}</p><div className="document-controls"><Button disabled={busy} onClick={() => setDiscardConfirmation(false)}>{t('keepDocument')}</Button><Button disabled={busy} onClick={() => void run(async signal => { apply((await readReservationDocument(job.id, 'discard', signal)).job); setDiscardConfirmation(false) })}>{t('confirmDiscard')}</Button></div></Panel>}
      {document.ocrStatus === 'uploading' && <Panel title={t('resumeUpload')}><Field label={t('files')}><Input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={event => chooseFiles(Array.from(event.target.files ?? []))} /></Field><Button disabled={busy || !target?.documentImport || !files.length} onClick={() => void run(resumeUpload)}>{t('resumeUpload')}</Button></Panel>}
      {!['uploading', 'completed', 'failed', 'cancelled', 'expired'].includes(document.ocrStatus) && <Button variant="primary" disabled={busy || !target?.documentImport} onClick={() => void run(signal => readAll(job, signal))}>{t('resumeRead')}</Button>}
      {document.extracted && <>
        {document.extracted.warnings.length > 0 && <Notice tone="warning">{t('warningsMessage', { count: document.extracted.warnings.length })}</Notice>}
        <Panel title={t('original')}>
          <div className="document-controls"><NativeSelect aria-label={t('originalFile')} value={sourceIndex} disabled={busy} onChange={event => { setSourceIndex(Number(event.target.value)); setVerifiedSource(undefined); setOriginalUrl(''); if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); blobUrl.current = '' }}>{document.sources.map(source => <option key={source.index} value={source.index}>{t('fileNumber', { number: source.index + 1 })}</option>)}</NativeSelect><NativeSelect aria-label={t('physicalPage')} value={visiblePage} onChange={event => setPhysicalPage(Number(event.target.value))}>{sourcePages.map(number => <option key={number} value={number}>{t('pageNumber', { number })}</option>)}</NativeSelect><Button disabled={busy || expired} onClick={() => void run(openOriginal)}>{t('openOriginal')}</Button></div>
          {originalUrl && <><a href={`${originalUrl}#page=${visiblePage}`} target="_blank" rel="noopener noreferrer">{t('openSeparate')}</a><PdfPages key={originalUrl} url={originalUrl} sourceIndex={sourceIndex} pages={[visiblePage]} label={`${t('original')} ${visiblePage}`} onRendered={setRenderedPage} /><Button disabled={busy || locked || verifiedSource !== sourceIndex || renderedPage !== visiblePage} onClick={confirmPage}>{t('confirmPage', { number: visiblePage })}</Button></>}
        </Panel>
        {!locked && <Panel title={t('mapping')}>
          <Field label={t('fields.year')}><Input type="number" min={1900} max={9999} value={options.year ?? ''} disabled={busy} onChange={event => { setOptions(previous => ({ ...previous, year: Number(event.target.value) })); setDirty(true) }} /></Field>
          <div className="document-grid">{reservationFields.map(field => <Field key={field} label={t(`fields.${field}`)}><NativeSelect value={options.columnMappings?.[field] ?? ''} disabled={busy} onChange={event => changeMapping(field, event.target.value)}><option value="">{t('automatic')}</option>{columns.map(column => <option key={column}>{column}</option>)}</NativeSelect></Field>)}</div>
          {facilities.map(facility => <Field key={facility} label={facility}><NativeSelect value={options.courseMappings?.[facility] ?? ''} disabled={busy} onChange={event => { setOptions(previous => ({ ...previous, courseMappings: { ...previous.courseMappings, [facility]: event.target.value } })); setDirty(true) }}><option value="">{t('unlinked')}</option>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</NativeSelect></Field>)}
        </Panel>}
        <Panel title={t('review')}>
          {rows.slice(page * 25, (page + 1) * 25).map((row, i) => {
            const index = page * 25 + i
            return <section className="document-row" key={`${row.source.fileIndex}:${row.source.page}:${row.source.row}`}>
              <h2>{t('coordinate', { file: row.source.fileIndex + 1, page: row.source.page, row: row.source.row })}</h2>
              <p>{row.values.originalConfirmed === true ? t('originalConfirmed') : t('originalRequired')}</p>
              {Object.keys(sourceCells(row)).length === 0 && <p>{t('unreadableMessage')}</p>}
              <details><summary>{t('extracted')}</summary><dl>{Object.entries(sourceCells(row)).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></details>
              {businessValues(row).map((values, manualIndex) => <div className="document-grid" key={manualIndex}>{reservationFields.map(field => <Field key={field} label={t(`fields.${field}`)}>{field === 'dayPart' ? <NativeSelect value={values[field]} disabled={busy || locked || row.excludedReason != null} onChange={event => editValue(index, manualIndex, field, event.target.value)}><option value="">{t('select')}</option><option value="morning">{t('morning')}</option><option value="afternoon">{t('afternoon')}</option></NativeSelect> : <Input value={values[field]} disabled={busy || locked || row.excludedReason != null} onChange={event => editValue(index, manualIndex, field, event.target.value)} />}</Field>)}{manualIndex > 0 && !locked && <Button disabled={busy || row.excludedReason != null} onClick={() => edit(index, item => ({ ...item, values: { ...item.values, manualRows: businessValues(item).filter((_, position) => position !== manualIndex) } }))}>{t('removeManual')}</Button>}</div>)}
              {!locked && <div className="document-controls"><Button disabled={busy || row.excludedReason != null} onClick={() => edit(index, item => ({ ...item, values: { ...item.values, manualRows: [...businessValues(item), Object.fromEntries(reservationFields.map(field => [field, ''])) as ReservationValues] } }))}>{t('addManual')}</Button><Button disabled={busy} onClick={() => edit(index, item => ({ ...item, excludedReason: item.excludedReason == null ? '' : null }))}>{row.excludedReason == null ? t('exclude') : t('restoreRow')}</Button></div>}
              {row.excludedReason != null && <Field label={t('excludeReason')}><Input value={row.excludedReason} disabled={busy || locked} onChange={event => edit(index, item => ({ ...item, excludedReason: event.target.value }))} /></Field>}
            </section>
          })}
          <div className="document-controls"><Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>{t('previous')}</Button><span>{page + 1} / {Math.max(1, Math.ceil(rows.length / 25))}</span><Button disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(value => value + 1)}>{t('next')}</Button></div>
          {!locked && <div className="document-controls"><Button disabled={busy || !dirty} onClick={() => { setRows(reviewedRows(document)); setOptions(job.importOptions); setDirty(false) }}>{t('undo')}</Button><Button variant="primary" disabled={busy || !dirty || !completeReview} onClick={() => void run(save)}>{t('saveRevision')}</Button></div>}
          {!locked && <p>{t('reviewMessage')}</p>}
        </Panel>
        {job.validationErrors.length > 0 && <Panel title={t('validationErrors')}>{job.validationErrors.map((issue, index) => <p key={index}>{issueMessage(issue)}</p>)}</Panel>}
        <div className="document-controls">
          {!locked && !!document.revisionSha256 && <Button disabled={busy || dirty || !catalogReady || !target?.documentImport || !completeReview} onClick={() => void run(signal => progress('validate', signal))}>{t(job.status === 'validating' ? 'resumeValidation' : 'validate')}</Button>}
          {job.status === 'ready' && <Button variant="primary" disabled={busy || dirty || expired || !catalogReady || !target?.documentImport} onClick={() => void run(signal => progress('confirm', signal))}>{t('confirmSave')}</Button>}
          {document.executionConfirmed && job.status !== 'completed' && <Button variant="primary" disabled={busy} onClick={() => void run(signal => progress('confirm', signal))}>{t('reconcile')}</Button>}
          <Button disabled={busy} onClick={() => void run(inspect)}>{t('inspect')}</Button>
        </div>
        {job.status === 'completed' && <><p>{t('completedMessage')}</p><div className="document-controls"><Button variant="primary" onClick={() => navigate('golf/reservation-report-import')}>{t('viewSaved')}</Button>{!jobId && <Button onClick={() => void run(async () => newDocument())}>{t('newDocument')}</Button>}</div></>}
      </>}
    </>}
  </div>
}
