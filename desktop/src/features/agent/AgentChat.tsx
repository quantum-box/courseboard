import { Button } from '@tachyon-sdk/native-ui'
import { Plus, Send, Square } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toolResultText } from '@tachyon-sdk/agent'
import { ApiError, today } from '../../api'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { getReservationStatus, reservationStatusForModel, type ReservationStatus } from './reservation-status'
import { ReservationStatusCard } from './ReservationStatusCard'
import { operationLabel } from './operation-label'
import { Notice } from '../../components/Page'
import { agentSessionClient, callFieldTool, demoEvents, describeOperation, executeOperation, isAgentDemo, loadCatalog, searchOperations, toolArgs, type Catalog, type FieldContext, type Operation, type ToolArgs } from './chat-api'
import './agent.css'

type Entry = { id: string; role: 'user' | 'assistant' | 'activity' | 'reservation'; text: string; reservation?: ReservationStatus; state?: 'running' | 'ok' | 'error'; turnId?: string }
type Pending = { operation: Pick<Operation, 'method' | 'path' | 'summary'>; args: ToolArgs; decide: (allow: boolean) => void }

export function AgentChat() {
  const { t, i18n } = useTranslation('agent')
  const timezone = useTenantTimezone()
  const [draft, setDraft] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [needsNew, setNeedsNew] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const session = useRef<string | null>(null)
  const running = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  useEffect(() => () => running.current?.abort(), [])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [entries, pending])

  function reset() {
    if (running.current) return
    session.current = null
    setEntries([]); setError(''); setNeedsNew(false); setPending(null); setDraft('')
    composer.current?.focus()
  }
  function confirm(operation: Pending['operation'], args: ToolArgs, signal: AbortSignal) {
    return new Promise<boolean>((resolve, reject) => {
      const abort = () => { setPending(null); reject(new DOMException('Aborted', 'AbortError')) }
      if (signal.aborted) return abort()
      signal.addEventListener('abort', abort, { once: true })
      setPending({ operation, args, decide: allow => {
        signal.removeEventListener('abort', abort)
        setPending(null)
        resolve(allow)
      } })
    })
  }

  async function send(event?: FormEvent, text = draft) {
    event?.preventDefault()
    text = text.trim()
    if (!text || running.current || needsNew) return
    if (new TextEncoder().encode(text).length > 32_000) { setError(t('chat.tooLong')); return }
    const controller = new AbortController()
    running.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 10 * 60_000)
    const signal = controller.signal
    const turnId = crypto.randomUUID()
    setActiveTurnId(turnId)
    setBusy(true); setError(''); setDraft('')
    setEntries(current => [...current, { id: turnId, role: 'user', text }])
    let hasReservationResult = false
    let hasOtherBusinessExecution = false
    const generated = new Map<string, Entry>()
    const append = (entry: Entry) => {
      entry = { ...entry, turnId }
      if (entry.role === 'assistant') generated.set(entry.id, entry)
      if (!signal.aborted && (entry.role !== 'assistant' || !hasReservationResult)) setEntries(current => [...current, entry])
    }
    const presentReservation = (status: ReservationStatus) => {
      hasReservationResult = true
      if (!signal.aborted) setEntries(current => [
        ...current.filter(entry => !generated.has(entry.id)),
        { id: crypto.randomUUID(), role: 'reservation', text: '', reservation: status, turnId },
      ])
      return reservationStatusForModel(status)
    }
    const update = (id: string, patch: Partial<Entry>) => { if (!signal.aborted) setEntries(current => current.map(entry => entry.id === id ? { ...entry, ...patch } : entry)) }
    let messageId = ''
    let lastType = ''
    let spoken = ''
    try {
      const sdk = agentSessionClient()
      const demo = isAgentDemo()
      let catalog: Catalog | null = null
      const described = new Set<string>()
      let fieldContext: FieldContext = { files: [], allowed_jobs: [], described: {} }
      const handled = new Set<string>()
      if (!demo) session.current ??= await sdk.createSession(undefined, signal)
      const activeSession = session.current
      const events = demo ? demoEvents(signal) : sdk.execute(activeSession!, {
        task: text,
        reservation_status: true,
        reservation_status_view: true,
        page: `CourseBoard /agent; date=${today(timezone)}; timezone=${timezone}; language=${i18n.language}`,
      }, signal)
      for await (const event of events) {
        signal.throwIfAborted()
        if (event.type === 'error') throw new Error('Agent runtime error')
        if (['say', 'assistant', 'ask'].includes(event.type) && event.text) {
          if (lastType !== event.type) {
            messageId = crypto.randomUUID()
            append({ id: messageId, role: 'assistant', text: '' })
          }
          lastType = event.type
          spoken += event.text
          const fragment = event.text
          const message = generated.get(messageId)!
          const next = { ...message, text: message.text + fragment }
          generated.set(messageId, next)
          if (!hasReservationResult) setEntries(current => current.map(entry => entry.id === messageId ? next : entry))
        } else if (event.type.startsWith('tool_')) lastType = ''
        if (event.type === 'attempt_completion' && event.result && !spoken.includes(event.result)) {
          append({ id: crypto.randomUUID(), role: 'assistant', text: event.result })
          spoken += event.result
        }
        if (event.type !== 'tool_call_pending' || !event.tool_id || handled.has(event.tool_id)) continue
        handled.add(event.tool_id)
        const toolId = event.tool_id
        const name = event.tool_name ?? ''
        const activity = crypto.randomUUID()
        append({ id: activity, role: 'activity', text: t('chat.working'), state: 'running' })
        let result: unknown
        let failed = false
        try {
          const args = toolArgs(event.args)
          if (name.startsWith('courseboard_')) {
            if (name === 'courseboard_get_reservation_status') {
              update(activity, { text: t('chat.reservationStatus') })
              const status = await getReservationStatus(args, signal, today(timezone))
              result = presentReservation(status)
              update(activity, { text: status.reservationTotals
                ? t('chat.reservationTotals', { date: status.date, groups: status.reservationTotals.groups, players: status.reservationTotals.players })
                : t('chat.reservationIncomplete') })
            } else {
              catalog ??= await loadCatalog(signal)
              if (name === 'courseboard_search_operations') {
                if (typeof args.query !== 'string') throw new Error('Search query required')
                result = searchOperations(catalog, args.query)
                update(activity, { text: t('chat.searching') })
              } else if (name === 'courseboard_describe_operation') {
                if (!args.operationId) throw new Error('Operation required')
                result = describeOperation(catalog, args.operationId)
                described.add(args.operationId)
                update(activity, { text: t('chat.describing') })
              } else if (name === 'courseboard_execute_operation') {
                if (!args.operationId || !described.has(args.operationId)) throw new Error('Describe the operation before executing')
                const operation = describeOperation(catalog, args.operationId).operation
                update(activity, { text: operationLabel(operation, t) })
                if (operation.method !== 'GET' && !await confirm(operation, args, signal)) {
                  result = { cancelled: true, message: 'The user declined this change. Do not execute or retry it.' }
                  update(activity, { text: t('chat.declined') })
                } else {
                  const reservationRead = operation.method === 'GET' && operation.path === '/v1/course/tee-ledger'
                  if (!reservationRead) hasOtherBusinessExecution = true
                  result = await executeOperation(operation, args, signal)
                  if (reservationRead) result = presentReservation(result as ReservationStatus)
                }
              } else throw new Error('Unknown CourseBoard tool')
            }
            await sdk.submitToolResult(activeSession!, { tool_id: toolId, is_error: false, result: toolResultText(result ?? { ok: true }, 48_000, 'Result is incomplete. Narrow the query or fetch all pages before computing totals.') }, signal)
          } else if (['field_search_operations', 'field_describe_operation', 'field_execute_operation'].includes(name)) {
            if (name === 'field_execute_operation') {
              const operation = args.operationId ? fieldContext.described?.[args.operationId] : null
              if (!operation) throw new Error('Describe the operation before executing')
              update(activity, { text: operationLabel(operation, t) })
              if (operation.method !== 'GET' && !await confirm(operation, args, signal)) {
                await sdk.submitToolResult(activeSession!, { tool_id: toolId, is_error: true, result: 'The user declined this change. Do not execute or retry it.' }, signal)
                update(activity, { text: t('chat.declined'), state: 'ok' })
                continue
              }
            }
            // Field preserves IAM, its describe-before-execute guard and its tool result callback.
            if (name === 'field_execute_operation') hasOtherBusinessExecution = true
            const answer = await callFieldTool(activeSession!, toolId, name, args, fieldContext, signal)
            fieldContext = answer.context
            failed = answer.event.state === 'error'
            update(activity, { text: name === 'field_search_operations' ? t('chat.searching')
              : name === 'field_describe_operation' ? t('chat.describing')
                : operationLabel({ ...fieldContext.described?.[args.operationId ?? ''],
                  ...(answer.event.operation as Partial<Operation> | undefined) }, t) })
          } else {
            throw new Error('Unsupported tool')
          }
        } catch (toolError) {
          signal.throwIfAborted()
          // A failed Field call may already have submitted a result. Never replay its side effects.
          if (name.startsWith('field_')) throw toolError
          failed = true
          await sdk.submitToolResult(activeSession!, { tool_id: toolId, is_error: true,
            result: toolError instanceof ApiError
              ? `Operation failed (HTTP ${toolError.status}): ${toolError.message.slice(0, 2000)}. A write may have applied. Read the current state before considering another write.`
              : 'Operation rejected or response unavailable. Check the schema and read the current state before retrying any write.' }, signal)
        }
        update(activity, { state: failed ? 'error' : 'ok' })
      }
      // A pure reservation answer is the verified table above. Never show an
      // additional generated copy that can swap IN/OUT or shift a row's figures.
      // Mixed requests retain their other answers after all tools finish.
      if (hasReservationResult && hasOtherBusinessExecution && !signal.aborted) {
        setEntries(current => [...current, ...generated.values()])
      }
    } catch (cause) {
      setError(signal.aborted ? t('chat.interrupted') : cause instanceof ApiError && cause.status === 403 ? t('chat.forbidden') : t('chat.failed'))
      setNeedsNew(true)
      setEntries(current => current.map(entry => entry.state === 'running' ? { ...entry, state: 'error' } : entry))
    } finally {
      clearTimeout(timeout)
      if (running.current === controller) running.current = null
      setPending(null); setBusy(false); setActiveTurnId(null)
    }
  }

  const activities = new Map<string, Entry[]>()
  for (const entry of entries) {
    if (entry.role !== 'activity' || !entry.turnId) continue
    const group = activities.get(entry.turnId) ?? []
    group.push(entry)
    activities.set(entry.turnId, group)
  }

  return <section className="agent-chat" aria-label={t('chat.title')}>
    <div className="agent-chat-toolbar">
      <p>{t('chat.description')}</p>
      <Button onClick={reset} disabled={busy}><Plus aria-hidden="true" />{t('chat.new')}</Button>
    </div>
    {isAgentDemo() ? <Notice>{t('chat.demo')}</Notice> : null}
    <div className="agent-transcript" aria-label={t('chat.conversation')} role="log" aria-live="polite" aria-relevant="additions text" aria-busy={busy && !pending}>
      {!entries.length ? <div className="agent-welcome"><h1>{t('chat.title')}</h1><p>{t('chat.welcome')}</p>
        <div className="agent-suggestions">{(['reservations', 'customers', 'summary'] as const).map(key => <Button key={key} onClick={() => { setDraft(t(`chat.examples.${key}`)); composer.current?.focus() }}>{t(`chat.examples.${key}`)}</Button>)}</div>
      </div> : null}
      {entries.map(entry => entry.role === 'reservation' && entry.reservation
        ? <ReservationStatusCard key={entry.id} status={entry.reservation} />
        : entry.role === 'activity'
        ? activities.get(entry.turnId ?? '')?.[0]?.id === entry.id
          ? <ActivityLog key={entry.id} entries={activities.get(entry.turnId!)!} running={activeTurnId === entry.turnId} />
          : null
        : <article key={entry.id} className={`agent-message agent-message-${entry.role}`}><strong>{t(entry.role === 'user' ? 'chat.you' : 'chat.assistant')}</strong><div className="agent-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt}</span> }}>{entry.text}</Markdown></div></article>)}
      {pending ? <div className="agent-confirm" role="region" aria-label={t('chat.confirmTitle')}>
        <h2>{t('chat.confirmTitle')}</h2>
        <p>{pending.args.confirmation || operationLabel(pending.operation, t)}</p>
        <p>{t('chat.confirmDescription')}</p>
        <dl>{confirmationFields(pending.args).map(([key, value], index) => <div key={`${key}:${index}`}><dt>{t(`chat.fields.${key}`, { defaultValue: key })}</dt><dd>{value}</dd></div>)}</dl>
        <div><Button variant="primary" onClick={() => pending.decide(true)}>{t('chat.approve')}</Button><Button onClick={() => pending.decide(false)}>{t('chat.reject')}</Button></div>
      </div> : null}
      <div ref={bottom} />
    </div>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <form className="agent-composer" onSubmit={event => void send(event)}>
      <label className="sr-only" htmlFor="agent-prompt">{t('chat.prompt')}</label>
      <div className="agent-composer-input">
        <textarea
          ref={composer}
          id="agent-prompt"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)
              && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          disabled={busy || needsNew}
          rows={3}
          placeholder={t('chat.placeholder')}
        />
        <div className="agent-composer-actions">
          {busy ? <Button type="button" onClick={() => running.current?.abort()}><Square aria-hidden="true" />{t('chat.stop')}</Button>
            : <Button type="submit" variant="primary" disabled={!draft.trim() || needsNew}><Send aria-hidden="true" />{t('chat.send')}</Button>}
        </div>
      </div>
    </form>
  </section>
}

function ActivityLog({ entries, running }: { entries: Entry[]; running: boolean }) {
  const { t } = useTranslation('agent')
  const [expanded, setExpanded] = useState(running)
  useEffect(() => setExpanded(running), [running])
  const hasError = entries.some(entry => entry.state === 'error')
  return <details className="agent-activity-log" open={expanded}
    onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{running ? t('chat.activityRunning')
      : t(hasError ? 'chat.activityErrors' : 'chat.activityDone', { count: entries.length })}</summary>
    <ul>{entries.map(entry => <li className="agent-activity" key={entry.id} data-state={entry.state}>
      <span aria-hidden="true">{entry.state === 'running' ? '…' : entry.state === 'error' ? '!' : '✓'}</span> {entry.text}
    </li>)}</ul>
  </details>
}

/** Show actual submitted values as plain text; model-generated confirmation copy cannot hide them. */
export function confirmationFields(args: ToolArgs): [string, string][] {
  const fields: [string, string][] = []
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 6) { fields.push([key, '…']); return }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey, depth + 1)
    } else fields.push([key, String(value ?? '')])
  }
  if (args.pathParams) visit(args.pathParams, 'target', 0)
  if (args.query && typeof args.query === 'object') visit(args.query, 'query', 0)
  if (args.body !== undefined) visit(args.body, 'body', 0)
  return fields
}
