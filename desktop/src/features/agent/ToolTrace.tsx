import { Check, ChevronRight, CircleAlert, LoaderCircle, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Entry } from './conversation-history'

/** Compact, expandable tool rows following the shadcn Trace composition. */
export function ToolTrace({ entry }: { entry: Entry }) {
  const { t } = useTranslation('agent')
  const StatusIcon = entry.state === 'running' ? LoaderCircle : entry.state === 'error' ? CircleAlert : Check
  return <details className="agent-trace" data-state={entry.state}>
    <summary>
      <Wrench className="agent-trace-tool" aria-hidden="true" />
      <span className="agent-trace-title">{entry.text}</span>
      <span className="agent-trace-status">
        <StatusIcon aria-hidden="true" />
        <span className="sr-only">{t(`chat.trace.${entry.state ?? 'ok'}`)}</span>
      </span>
      <ChevronRight className="agent-trace-chevron" aria-hidden="true" />
    </summary>
    <div className="agent-trace-content">
      {entry.tool ? <code className="agent-trace-name">{entry.tool}</code> : null}
      {entry.input ? <div><h3>{t('chat.trace.input')}</h3><pre>{entry.input}</pre></div> : null}
      {entry.output ? <div><h3>{t('chat.trace.output')}</h3><pre>{entry.output}</pre></div> : null}
    </div>
  </details>
}
