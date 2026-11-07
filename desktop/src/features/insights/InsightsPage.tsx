import { Button } from '@tachyon-sdk/native-ui'
import { JSONUIProvider, Renderer } from '@json-render/react'
import { Sparkles } from 'lucide-react'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { LoadingState, NativeSelect, NativeTextarea, Notice, PageHeader, Panel, ResourceError, resourceErrorText } from '../../components/Page'
import { MOCK_FIXTURE_DATE, isMockFieldDataEnabled } from '../../dev/mockFieldApi'
import { useResource } from '../../hooks/useResource'
import { today } from '../../lib/clock'
import { fetchReservations, requestLayout, type LayoutAnswer } from './api'
import { buildDatasets } from './datasets'
import { buildSystemPrompt, compileLayout, type CompiledLayout } from './layoutSpec'
import { PERIOD_LABELS, periodFor, type PeriodPreset } from './period'
import { insightsRegistry } from './registry'

const SUGGESTIONS = [
  '今週の予約を曜日別グラフで',
  '日ごとの予約推移を折れ線で',
  'コース別の予約組数を比べたい',
  'スタート時間帯ごとの混み具合',
  'キャディ付きとセルフの割合',
]

type Answer = LayoutAnswer & CompiledLayout & { question: string; id: number }

export function InsightsPage() {
  const timezone = String(useTenantTimezone())
  const [preset, setPreset] = useState<PeriodPreset>('thisWeek')
  const [question, setQuestion] = useState(SUGGESTIONS[0])
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)

  // The mock desk's fixtures are written around one day; anchor "today" there.
  const anchor = isMockFieldDataEnabled() ? MOCK_FIXTURE_DATE : today(timezone)
  const period = useMemo(() => periodFor(preset, anchor), [preset, anchor])

  const reservations = useResource(
    useCallback(() => fetchReservations(period), [period]),
    [period.from, period.to],
  )
  const datasets = useMemo(
    () => (reservations.data ? buildDatasets(reservations.data, period, timezone) : null),
    [reservations.data, period, timezone],
  )
  const systemPrompt = useMemo(() => (datasets ? buildSystemPrompt(datasets) : ''), [datasets])

  const ask = async (event?: FormEvent) => {
    event?.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || !datasets) return
    setAsking(true)
    setAskError(null)
    try {
      const reply = await requestLayout(systemPrompt, trimmed)
      setAnswer({ ...reply, ...compileLayout(reply.text), question: trimmed, id: Date.now() })
    } catch (error) {
      setAskError(resourceErrorText(error))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="PoC"
        title="予約インサイト"
        description="質問すると、AI が予約データからグラフや表のレイアウトを組み立てます。数値は台帳から集計した値だけを表示します。"
      />
      <Panel title="質問">
        <form className="insights-ask" onSubmit={ask}>
          <div className="insights-ask-row">
            <label htmlFor="insights-period">期間</label>
            <NativeSelect
              id="insights-period"
              value={preset}
              onChange={event => setPreset(event.target.value as PeriodPreset)}
            >
              {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map(key => (
                <option key={key} value={key}>{PERIOD_LABELS[key]}</option>
              ))}
            </NativeSelect>
            <span className="insights-meta">
              {datasets ? `${datasets.summary.period}・${datasets.summary.reservations}組` : '集計中…'}
            </span>
          </div>
          <NativeTextarea
            aria-label="質問"
            value={question}
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void ask()
            }}
            maxLength={2000}
          />
          <div className="insights-suggestions">
            {SUGGESTIONS.map(suggestion => (
              <button type="button" key={suggestion} onClick={() => setQuestion(suggestion)}>{suggestion}</button>
            ))}
          </div>
          <div className="insights-ask-row">
            <Button type="submit" variant="primary" disabled={asking || !datasets || !question.trim()}>
              <Sparkles /> {asking ? '作成中…' : '表示する'}
            </Button>
          </div>
        </form>
      </Panel>

      {reservations.error ? <ResourceError error={reservations.error} onRetry={reservations.refresh} /> : null}
      {askError ? <Notice tone="danger">{askError}</Notice> : null}
      {asking ? <LoadingState label="レイアウトを作成しています" /> : null}

      {answer && datasets && !asking ? (
        <Panel
          title={answer.question}
          actions={(
            <Button type="button" size="sm" onClick={() => setShowDebug(value => !value)}>
              {showDebug ? '詳細を隠す' : '詳細'}
            </Button>
          )}
        >
          {answer.sample ? (
            <Notice tone="info">モックデータ環境のため、AI は呼ばずにサンプルのレイアウトを表示しています（数値はモック台帳の集計です）。</Notice>
          ) : null}
          {answer.spec ? (
            <JSONUIProvider
              key={`${answer.id}:${period.from}`}
              registry={insightsRegistry}
              initialState={{ datasets }}
            >
              <Renderer spec={answer.spec} registry={insightsRegistry} />
            </JSONUIProvider>
          ) : (
            <Notice tone="danger">AI の応答からレイアウトを組み立てられませんでした。質問を変えて試してください。</Notice>
          )}
          {showDebug ? (
            <div className="insights-debug">
              <p className="insights-meta">model: {answer.model}</p>
              {answer.warnings.length ? (
                <ul>{answer.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              ) : <p className="insights-meta">ガードによる除去はありません</p>}
              <pre>{answer.text}</pre>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}
