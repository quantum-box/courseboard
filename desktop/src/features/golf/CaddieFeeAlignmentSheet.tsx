import { Badge, Button } from '@tachyon-sdk/native-ui'
import { ArrowRightLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import {
  EmptyState,
  Field,
  LoadingState,
  NativeTextarea,
  Notice,
  ResourceError,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { useResource } from '../../hooks/useResource'
import {
  alignmentRequest,
  canAlign,
  initialSelection,
  selectedCuts,
  summarizeResults,
  type FeeAlignmentCandidate,
  type FeeAlignmentPreview,
  type FeeAlignmentResult,
} from './caddieFeeAlignment'

const COURSE_API = '/v1/course'

/** The same cap the API enforces on a reason. */
const MAX_NOTE_CHARS = 500

function formatMoney(amount: number, currency = 'JPY') {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(amount)
}

function formatSigned(amount: number, currency: string) {
  return `${amount > 0 ? '+' : ''}${formatMoney(amount, currency)}`
}

const EFFECT_BADGE = {
  cut: 'warning',
  raise: 'accent',
  unchanged: 'success',
} as const

/**
 * Moving caddies who carry a fee of their own onto their rank's fee (PLT-3346).
 *
 * Lives beside the rank fee table on the payroll screen: the operator who just
 * set what a rank pays is the one who can see who is still not paid by it. The
 * list opens with only the moves that change nobody's pay ticked — raising or
 * cutting someone is the club's decision, and the screen does not make it.
 */
export function CaddieFeeAlignmentSheet({
  open,
  onClose,
  onAligned,
}: {
  open: boolean
  onClose: () => void
  onAligned: () => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const timezone = useTenantTimezone()
  const resource = useResource(
    () => courseboardApiJson<FeeAlignmentPreview>(`${COURSE_API}/caddie-fee-alignment`),
    [open],
    // Read only while the sheet is open: it is a pay screen nobody needs
    // loaded behind the payroll table.
    { enabled: open },
  )
  const preview = resource.data
  const candidates = useMemo(() => preview?.candidates ?? [], [preview])
  const currency = preview?.fees.currency ?? 'JPY'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<FeeAlignmentResult[] | null>(null)

  // A fresh list re-seeds the ticks, so a caddie moved a moment ago is never
  // still ticked against an amount they no longer carry.
  useEffect(() => {
    setSelected(initialSelection(candidates))
  }, [candidates])

  useEffect(() => {
    if (!open) {
      setNote('')
      setError(null)
      setResults(null)
    }
  }, [open])

  const cuts = selectedCuts(candidates, selected)
  const request = alignmentRequest(candidates, selected, note)
  const counts = {
    cut: String(candidates.filter(candidate => candidate.effect === 'cut').length),
    raise: String(candidates.filter(candidate => candidate.effect === 'raise').length),
    unchanged: String(candidates.filter(candidate => candidate.effect === 'unchanged').length),
  }
  const names = new Map(candidates.map(candidate => [candidate.caddieProfileId, candidate.displayName]))

  function toggle(candidate: FeeAlignmentCandidate) {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(candidate.caddieProfileId)) next.delete(candidate.caddieProfileId)
      else next.add(candidate.caddieProfileId)
      return next
    })
    setError(null)
  }

  async function align() {
    if (request.items.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const response = await courseboardApiJson<{ results: FeeAlignmentResult[] }>(
        `${COURSE_API}/caddie-fee-alignment`,
        { method: 'POST', body: JSON.stringify(request) },
      )
      // Only the caddies left behind are named in the results, and those are
      // still on the refreshed list.
      setResults(response.results)
      setNote('')
      resource.refresh()
      onAligned()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const summary = results ? summarizeResults(results) : null

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
      title={t('caddies:payroll.feeAlignment.title')}
      description={t('caddies:payroll.feeAlignment.description')}
    >
      <div className="space-y-4 px-1 pb-1">
        {resource.loading && !preview ? <LoadingState label={t('caddies:payroll.feeAlignment.loading')} /> : null}
        {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}

        {summary && results ? (
          <Notice tone={summary.skipped > 0 ? 'warning' : 'success'} title={t('caddies:payroll.feeAlignment.done.title')}>
            <p>{t('caddies:payroll.feeAlignment.done.message', { aligned: String(summary.aligned), skipped: String(summary.skipped) })}</p>
            {summary.skipped > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {results.filter(result => result.outcome !== 'aligned').map(result => (
                  <li key={result.caddieProfileId}>
                    {names.get(result.caddieProfileId) ?? result.caddieProfileId}
                    {'：'}
                    {t(`caddies:payroll.feeAlignment.outcome.${result.outcome}`)}
                    {result.message ? `（${result.message}）` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </Notice>
        ) : null}

        {preview && !preview.rankFeesConfirmed ? (
          <Notice tone="warning" title={t('caddies:payroll.feeAlignment.unconfirmed.title')}>
            {t('caddies:payroll.feeAlignment.unconfirmed.description')}
          </Notice>
        ) : null}

        {preview && candidates.length === 0 ? (
          <EmptyState
            title={t('caddies:payroll.feeAlignment.empty.title')}
            description={t('caddies:payroll.feeAlignment.empty.description')}
          />
        ) : null}

        {preview && candidates.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">
              {t('caddies:payroll.feeAlignment.counts', counts)}
            </p>
            <ul className="space-y-2">
              {candidates.map(candidate => {
                const alignable = preview.rankFeesConfirmed && canAlign(candidate)
                return (
                  <li key={candidate.caddieProfileId}>
                    <label
                      className={`flex items-start gap-3 rounded-md border border-border px-3 py-2 ${alignable ? 'cursor-pointer' : 'opacity-60'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary"
                        disabled={!alignable || busy}
                        checked={alignable && selected.has(candidate.caddieProfileId)}
                        onChange={() => toggle(candidate)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{candidate.displayName}</span>
                          <Badge variant="outline">{candidate.rank}</Badge>
                          <Badge variant={EFFECT_BADGE[candidate.effect]}>
                            {t(`caddies:payroll.feeAlignment.effect.${candidate.effect}`)}
                          </Badge>
                          {candidate.active ? null : (
                            <span className="text-xs text-muted-foreground">
                              {t('caddies:payroll.feeAlignment.inactive')}
                            </span>
                          )}
                        </div>
                        <p className="text-sm tabular-nums">
                          {formatMoney(candidate.ownFee, currency)}
                          {' → '}
                          {formatMoney(candidate.rankFee, currency)}
                          {candidate.difference !== 0 ? (
                            <span className={candidate.difference < 0 ? 'text-destructive' : 'text-muted-foreground'}>
                              {' '}
                              {t('caddies:payroll.feeAlignment.perRound', {
                                amount: formatSigned(candidate.difference, currency),
                              })}
                            </span>
                          ) : null}
                        </p>
                        {canAlign(candidate) ? null : (
                          <p className="text-xs text-muted-foreground">
                            {t('caddies:payroll.feeAlignment.unpriced', { rank: candidate.rank })}
                          </p>
                        )}
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>

            {cuts.count > 0 ? (
              <Notice tone="danger" title={t('caddies:payroll.feeAlignment.cutWarning.title', { count: cuts.count })}>
                {t('caddies:payroll.feeAlignment.cutWarning.description', {
                  amount: formatMoney(Math.abs(cuts.perRound), currency),
                })}
              </Notice>
            ) : null}
            <Notice tone="info" title={t('caddies:payroll.feeAlignment.scope.title')}>
              {t('caddies:payroll.feeAlignment.scope.description')}
            </Notice>
            <Field label={t('caddies:payroll.feeAlignment.noteLabel')}>
              <NativeTextarea
                rows={2}
                maxLength={MAX_NOTE_CHARS}
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder={t('caddies:payroll.feeAlignment.notePlaceholder')}
              />
            </Field>
            {error ? (
              <Notice tone="danger" title={t('caddies:payroll.feeAlignment.failed')}>{error}</Notice>
            ) : null}
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={busy || !preview.rankFeesConfirmed || request.items.length === 0}
              onClick={() => void align()}
            >
              <ArrowRightLeft />
              {busy
                ? t('caddies:payroll.feeAlignment.submitting')
                : t('caddies:payroll.feeAlignment.submit', { count: request.items.length })}
            </Button>
          </>
        ) : null}

        {preview ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('caddies:payroll.feeAlignment.history.title')}</h3>
            {preview.recentChanges.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('caddies:payroll.feeAlignment.history.empty')}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {preview.recentChanges.map(change => (
                  <li key={change.id} className="border-b border-border pb-1 last:border-b-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">
                        {change.displayName ?? t('caddies:payroll.feeAlignment.history.unknownCaddie')}
                      </span>
                      <span className="tabular-nums">
                        {t('caddies:payroll.feeAlignment.history.entry', {
                          rank: change.rank,
                          from: formatMoney(change.previousFee, change.currency),
                          to: formatMoney(change.rankFee, change.currency),
                        })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat('ja-JP', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                          timeZone: timezone,
                        }).format(new Date(change.changedAt))}
                        {change.changedByName ? ` · ${change.changedByName}` : ''}
                      </span>
                    </div>
                    {change.note ? <p className="text-xs text-muted-foreground">{change.note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </Sheet>
  )
}
