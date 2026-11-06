import { Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../auth/AuthProvider'
import { Field, FormGrid, LoadingState, NativeSelect, Notice, PageHeader, Panel } from '../../../components/Page'
import { clearResourceCache } from '../../../hooks/useResource'
import { navigate } from '../../../lib/router'
import { showToast } from '../../../lib/toast'
import { PdfPages } from '../customers/reception/PdfPages'
import { PartyRemarksFields } from '../ledger/PartyRemarksFields'
import {
  cancelStartLedgerJob, createStartLedgerJob, getStartLedgerContext, getStartLedgerJob, importStartLedgerParties, operationKey, readOperation,
  START_LEDGER_LIMITS, stepStartLedgerJob, TERMINAL_STATUSES, uploadStartLedgerPdfs, writeOperation,
  type StartLedgerContext, type StartLedgerRead,
} from './api'
import { blocking, buildReview, chunks, doneGroups, isDone, restoreDone, partiesToImport, pendingParties, rematch, reviewIssues, soldOn, toImportParty, type ReviewParty } from './review'
import '../common-imports/document-import.css'

const PAGE_SIZE = 20

export function StartLedgerImportPage() {
  const { t } = useTranslation('startLedgerImport')
  const auth = useAuth()
  const identity = auth.state.status === 'ready' ? auth.state : null
  const storageKey = operationKey(identity?.tenant.operatorId ?? '', identity?.tenant.platformId ?? '', identity?.user.id ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [fileUrls, setFileUrls] = useState<string[]>([])
  const [sourceIndex, setSourceIndex] = useState(0)
  const [read, setRead] = useState<StartLedgerRead>()
  const [context, setContext] = useState<StartLedgerContext>()
  const [date, setDate] = useState('')
  const [parties, setParties] = useState<ReviewParty[]>([])
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | undefined>(undefined)

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort()
    const active = new AbortController(); controller.current = active
    setBusy(true); setError('')
    try { await task(active.signal) }
    catch (failure) {
      if (!active.signal.aborted) {
        const message = failure instanceof Error ? failure.message : t('error.retry')
        setError(message); showToast({ tone: 'danger', message })
      }
    } finally { if (controller.current === active) setBusy(false) }
  }

  async function review(next: StartLedgerRead, signal: AbortSignal) {
    // A recovered read comes back as the desk left it: confirmed date and booked groups.
    const saved = readOperation(storageKey)
    const day = saved?.date ?? next.date ?? ''
    setDate(day)
    if (!day) { setParties(restoreDone(buildReview(next, { courses: [], plans: [], booked: [] }), saved?.done)); return }
    const loaded = await getStartLedgerContext(day, signal)
    signal.throwIfAborted()
    setContext(loaded); setParties(restoreDone(buildReview(next, loaded), saved?.done)); setPage(0)
  }

  async function apply(next: StartLedgerRead, signal: AbortSignal) {
    setRead(next)
    if (next.status === 'completed') await review(next, signal)
  }

  useEffect(() => {
    setRead(undefined); setParties([]); setContext(undefined)
    if (!identity) return
    const pending = readOperation(storageKey)
    if (!pending?.jobId) return
    const jobId = pending.jobId
    void run(async signal => { await apply(await getStartLedgerJob(jobId, signal), signal) })
    return () => controller.current?.abort()
    // A new tenant or actor must not see another desk's read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  useEffect(() => () => fileUrls.forEach(url => URL.revokeObjectURL(url)), [fileUrls])

  function chooseFiles(chosen: File[]) {
    setFiles(chosen); setSourceIndex(0)
    setFileUrls(chosen.map(file => URL.createObjectURL(file)))
  }

  async function readAll(initial: StartLedgerRead, signal: AbortSignal) {
    let next = initial
    for (let step = 0; step < 256 && !TERMINAL_STATUSES.has(next.status); step++) {
      next = await stepStartLedgerJob(next.id, next.status === 'uploading' ? 'confirm' : 'advance', signal)
      signal.throwIfAborted(); setRead(next)
    }
    if (next.status !== 'completed') throw new Error(t('readFailed'))
    await apply(next, signal)
    showToast({ tone: 'success', message: t('readComplete') })
  }

  async function start(signal: AbortSignal) {
    const operation = readOperation(storageKey) ?? { idempotencyKey: crypto.randomUUID() }
    writeOperation(storageKey, operation)
    // The same key answers the same read, including fresh upload URLs.
    const created = await createStartLedgerJob(files, operation.idempotencyKey, signal)
    signal.throwIfAborted()
    writeOperation(storageKey, { ...operation, jobId: created.job.id })
    setRead(created.job)
    if (created.job.status === 'uploading') await uploadStartLedgerPdfs(files, created.uploads, signal)
    await readAll(created.job, signal)
  }

  function newRead() {
    writeOperation(storageKey, null)
    setRead(undefined); setParties([]); setContext(undefined); setDate(''); setFiles([]); setFileUrls([])
  }

  async function discard(signal: AbortSignal) {
    if (read && !TERMINAL_STATUSES.has(read.status)) await cancelStartLedgerJob(read.id, signal)
    newRead()
  }

  async function changeDate(value: string, signal: AbortSignal) {
    setDate(value)
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return
    const saved = readOperation(storageKey)
    if (saved) writeOperation(storageKey, { ...saved, date: value })
    const loaded = await getStartLedgerContext(value, signal)
    signal.throwIfAborted()
    setContext(loaded)
    setParties(previous => previous.length ? rematch(previous, loaded) : read ? buildReview(read, loaded) : previous)
  }

  function edit(key: string, change: (party: ReviewParty) => ReviewParty) {
    // A correction makes a failed group sendable again, so its failure no longer applies.
    setParties(previous => previous.map(party => party.key === key
      ? { ...change(party), checked: false, result: party.result?.outcome === 'failed' ? undefined : party.result }
      : party))
  }

  async function importChecked(signal: AbortSignal) {
    const targets = partiesToImport(parties)
    const outcomes = new Map<string, ReviewParty['result']>()
    try {
      for (const batch of chunks(targets, START_LEDGER_LIMITS.importBatch)) {
        const results = await importStartLedgerParties(date, batch.map(toImportParty), signal)
        signal.throwIfAborted()
        batch.forEach((item, index) => outcomes.set(item.key, results[index]))
        const settled = parties.map(party => outcomes.has(party.key) ? { ...party, result: outcomes.get(party.key) } : party)
        setParties(previous => previous.map(party => outcomes.has(party.key) ? { ...party, result: outcomes.get(party.key) } : party))
        // Remember each batch's bookings at once, so a reload mid-import cannot offer them again.
        const saved = readOperation(storageKey)
        if (saved) writeOperation(storageKey, { ...saved, date, done: doneGroups(settled) })
      }
    } finally {
      clearResourceCache('tee-ledger')
    }
    // Keep the read recoverable until every group still in play is in the ledger.
    const settled = parties.map(party => outcomes.has(party.key) ? { ...party, result: outcomes.get(party.key) } : party)
    if (settled.every(party => party.excluded || isDone(party))) writeOperation(storageKey, null)
  }

  const activeContext = context ?? { courses: [], plans: [], booked: [] }
  const pending = context ? pendingParties(parties, activeContext) : parties
  const toImport = partiesToImport(parties)
  const results = parties.flatMap(party => party.result ? [party.result] : [])
  const count = (outcome: string) => results.filter(result => result.outcome === outcome).length
  const styleLabel = (style?: string) => style === 'self' || style === 'caddie' ? t(`style.${style}`) : ''

  return <div className="document-import-page">
    <Button onClick={() => navigate('golf/reservation-report-import')}>{t('back')}</Button>
    <PageHeader title={t('title')} />
    {busy && <LoadingState label={t('working')} />}
    {error && <Notice tone="danger">{error}</Notice>}

    {!read && <Panel title={t('choose')}>
      <p>{t('chooseMessage')}</p>
      <Field label={t('files')}><Input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={event => chooseFiles(Array.from(event.target.files ?? []))} /></Field>
      <Button variant="primary" disabled={busy || !files.length || files.length > START_LEDGER_LIMITS.files} onClick={() => void run(start)}>{t('start')}</Button>
    </Panel>}

    {read && read.status !== 'completed' && <Panel title={t('choose')}>
      <p role="status">{read.totalUnits ? t('progress', { done: read.completedUnits, total: read.totalUnits }) : t('progressUnknown', { done: read.completedUnits })}</p>
      {['failed', 'cancelled', 'expired'].includes(read.status) && <Notice tone="warning">{t('readFailed')}</Notice>}
      {read.status === 'uploading' && <><p>{t('resumeUpload')}</p><Field label={t('files')}><Input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={event => chooseFiles(Array.from(event.target.files ?? []))} /></Field></>}
      <div className="document-controls">
        {!TERMINAL_STATUSES.has(read.status) && <Button variant="primary" disabled={busy || (read.status === 'uploading' && !files.length)} onClick={() => void run(signal => read.status === 'uploading' ? start(signal) : readAll(read, signal))}>{t('resume')}</Button>}
        <Button disabled={busy} onClick={() => void run(discard)}>{TERMINAL_STATUSES.has(read.status) ? t('newRead') : t('discard')}</Button>
      </div>
    </Panel>}

    {read?.status === 'completed' && <>
      {read.warnings.length > 0 && <Notice tone="warning">{t('readWarnings', { count: read.warnings.length })}</Notice>}
      <Panel title={t('date')}>
        {!read.date && <Notice tone="warning">{t('dateMissing')}</Notice>}
        <Field label={t('date')}><Input type="date" value={date} disabled={busy || results.length > 0} onChange={event => { const value = event.target.value; void run(signal => changeDate(value, signal)) }} /></Field>
        <p role="status">{t('summary', { count: parties.length })} · {pending.length ? t('pending', { count: pending.length }) : t('allChecked')}</p>
      </Panel>

      <div className="start-ledger-review">
        <Panel title={t('original')}>
          {fileUrls.length === 0 ? <p>{t('originalMissing')}<Input type="file" accept="application/pdf,.pdf" multiple onChange={event => chooseFiles(Array.from(event.target.files ?? []))} /></p> : <>
            {fileUrls.length > 1 && <NativeSelect aria-label={t('originalFile')} value={sourceIndex} onChange={event => setSourceIndex(Number(event.target.value))}>{fileUrls.map((_, index) => <option key={index} value={index}>{t('fileNumber', { number: index + 1 })}</option>)}</NativeSelect>}
            <PdfPages key={fileUrls[sourceIndex]} url={fileUrls[sourceIndex]!} sourceIndex={sourceIndex} label={t('original')} />
          </>}
        </Panel>

        <Panel title={t('summary', { count: parties.length })}>
          {parties.length === 0 && <Notice tone="warning">{t('noParties')}</Notice>}
          {parties.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(party => {
            const issues = reviewIssues(party, parties, activeContext)
            const plan = activeContext.plans.find(item => item.reservationServiceId === party.planId)
            const locked = busy || party.excluded || isDone(party)
            return <section className="document-row" key={party.key} aria-label={`${party.source.courseName ?? ''} ${party.teeTime}`}>
              <h2>{party.source.courseName ?? '—'} {party.teeTime} {party.customerName}</h2>
              <p>{t('printed', { course: party.source.courseName ?? '', time: party.source.teeTime ?? '', style: party.source.playStyleText ?? '', plan: party.source.planName ?? '' })}</p>
              {party.source.copiedFromAbove.length > 0 && <p>{t('copiedFromAbove', { fields: party.source.copiedFromAbove.map(field => t(`fields.${field}`, { defaultValue: field })).join('・') })}</p>}
              {party.source.warnings.map(code => <Notice key={code} tone="warning">{t(`warning.${code}`, { defaultValue: code })}</Notice>)}
              {party.result && <Notice tone={party.result.outcome === 'failed' ? 'danger' : 'success'}>{t(`result.${party.result.outcome}`, { message: party.result.message ?? '' })}</Notice>}
              {party.excluded ? <p>{t('excluded')}</p> : <>
                {issues.course && <Notice tone="warning">{t('issue.course')}</Notice>}
                {issues.teeTime && <Notice tone="warning">{t('issue.teeTime')}</Notice>}
                {issues.name && <Notice tone="warning">{t('issue.name')}</Notice>}
                {issues.caddieMismatch && !plan && <Notice tone="warning">{t('issue.caddieNoPlan')}</Notice>}
                {issues.caddieMismatch && plan && <Notice tone="warning">{t('issue.caddieMismatch', { printed: party.source.playStyleText ?? styleLabel(party.source.playStyle), plan: styleLabel(plan?.requiresCaddie ? 'caddie' : 'self') })}</Notice>}
                {issues.booked && !party.result && <Notice tone="warning">{t('issue.booked', { name: issues.booked.customerName ?? '' })}</Notice>}
                {issues.repeated && <Notice tone="warning">{t('issue.repeated')}</Notice>}
                <FormGrid columns={3}>
                  <Field label={t('course')}><NativeSelect value={party.courseId} disabled={locked} onChange={event => edit(party.key, item => ({ ...item, courseId: event.target.value, planId: activeContext.plans.some(p => p.reservationServiceId === item.planId && soldOn(p, event.target.value)) ? item.planId : '' }))}><option value="">{t('selectCourse')}</option>{activeContext.courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</NativeSelect></Field>
                  <Field label={t('teeTime')}><Input value={party.teeTime} disabled={locked} placeholder="08:45" onChange={event => edit(party.key, item => ({ ...item, teeTime: event.target.value }))} /></Field>
                  <Field label={t('plan')}><NativeSelect value={party.planId} disabled={locked} onChange={event => edit(party.key, item => ({ ...item, planId: event.target.value }))}><option value="">{t('noPlan')}</option>{activeContext.plans.filter(item => !party.courseId || soldOn(item, party.courseId)).map(item => <option key={item.reservationServiceId} value={item.reservationServiceId}>{item.name}（{styleLabel(item.requiresCaddie ? 'caddie' : 'self')}）</option>)}</NativeSelect></Field>
                  <Field label={t('representative')}><Input value={party.customerName} disabled={locked} onChange={event => edit(party.key, item => ({ ...item, customerName: event.target.value }))} /></Field>
                  <Field label={t('competition')}><Input value={party.competitionName} disabled={locked} onChange={event => edit(party.key, item => ({ ...item, competitionName: event.target.value }))} /></Field>
                </FormGrid>
                {party.players.map((player, index) => <FormGrid key={index} columns={3}>
                  <Field label={`${t('playerLabel', { number: index + 1 })} ${t('playerName')}`}><Input value={player.name} disabled={locked} onChange={event => edit(party.key, item => ({ ...item, players: item.players.map((p, i) => i === index ? { ...p, name: event.target.value } : p) }))} /></Field>
                  <Field label={t('playerTag')}><Input value={player.tag} disabled={locked} onChange={event => edit(party.key, item => ({ ...item, players: item.players.map((p, i) => i === index ? { ...p, tag: event.target.value } : p) }))} /></Field>
                  <Field label={t('playerNumber')}><Input value={player.memberNumber} disabled={locked} onChange={event => edit(party.key, item => ({ ...item, players: item.players.map((p, i) => i === index ? { ...p, memberNumber: event.target.value } : p) }))} /></Field>
                </FormGrid>)}
                {locked ? null : <PartyRemarksFields value={party.remarks} onChange={remarks => edit(party.key, item => ({ ...item, remarks }))} />}
                <Field label={t('notes')}><Input value={party.notes} disabled={locked} maxLength={1000} onChange={event => edit(party.key, item => ({ ...item, notes: event.target.value }))} /></Field>
                {!isDone(party) && <label><input type="checkbox" checked={party.checked} disabled={busy || blocking(issues)} onChange={event => setParties(previous => previous.map(item => item.key === party.key ? { ...item, checked: event.target.checked } : item))} /> {t('checked')}</label>}
              </>}
              {!party.result && <Button disabled={busy} onClick={() => setParties(previous => previous.map(item => item.key === party.key ? { ...item, excluded: !item.excluded, checked: false } : item))}>{party.excluded ? t('restore') : t('exclude')}</Button>}
            </section>
          })}
          {parties.length > PAGE_SIZE && <div className="document-controls"><Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>←</Button><span>{page + 1} / {Math.ceil(parties.length / PAGE_SIZE)}</span><Button disabled={(page + 1) * PAGE_SIZE >= parties.length} onClick={() => setPage(value => value + 1)}>→</Button></div>}
        </Panel>
      </div>

      {pending.length > 0 && toImport.length > 0 && <Notice tone="warning">{t('importBlocked')}</Notice>}
      <div className="document-controls">
        <Button variant="primary" disabled={busy || !context || !date || toImport.length === 0} onClick={() => void run(importChecked)}>{t('import', { count: toImport.length })}</Button>
        <Button disabled={busy} onClick={() => void run(discard)}>{t('newRead')}</Button>
      </div>
      {results.length > 0 && <Panel>
        <p role="status">{t('done', { created: count('created'), skipped: count('already_booked'), failed: count('failed') })}</p>
        <Button variant="primary" onClick={() => navigate('golf/ledger')}>{t('viewLedger')}</Button>
      </Panel>}
    </>}
  </div>
}
