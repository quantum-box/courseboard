import { Badge, Button, Input, Kbd } from '@tachyon-sdk/native-ui'
import type {
  ComponentProps,
  FormEvent,
  HTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { i18next } from '../i18n'
import { pageRefreshShortcutLabel } from '../lib/shortcuts'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {eyebrow ? <div className="page-eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLElement> & {
  title?: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <section className={`panel ${className}`} {...props}>
      {title || description || actions ? (
        <div className="panel-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Notice({
  tone = 'info',
  title,
  children,
  actions,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <AlertTriangle aria-hidden="true" />
      <div className="notice-copy">
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
      {actions ? <div className="notice-actions">{actions}</div> : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <Inbox aria-hidden="true" />
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation('common')
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      {label ?? t('state.loading')}
    </div>
  )
}

/**
 * Raw API failures name internal services the operator cannot act on, so map the
 * known ones onto plain-language advice and keep the rest verbatim.
 */
function humanizeResourceError(error: unknown) {
  const raw = error instanceof Error ? error.message : i18next.t('common:error.unknown')
  const lower = raw.toLowerCase()
  if (
    lower.includes('verify_user')
    || lower.includes('rejected the authenticated bearer')
    || lower.includes('field_api_oauth_incompatible')
    || (lower.includes('field api returned 401') && lower.includes('unauthorized'))
  ) {
    return i18next.t('common:error.authRejected')
  }
  if (lower.includes('provider_error') || lower.includes('external provider error')) {
    return i18next.t('common:error.providerError')
  }
  if (raw === 'Request failed with 500' || raw === 'Request failed with 502') {
    return i18next.t('common:error.apiUnreachable')
  }
  return raw
}

export function ResourceError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  const { t } = useTranslation('common')
  const message = humanizeResourceError(error)
  return (
    <Notice
      tone="danger"
      title={t('error.loadFailed')}
      actions={onRetry ? (
        <PageRefreshButton size="sm" onClick={onRetry} label={t('action.retry')} />
      ) : undefined}
    >
      {message}
    </Notice>
  )
}

export function PageRefreshButton({
  label,
  loading = false,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  label?: string
  loading?: boolean
}) {
  const { t } = useTranslation('common')
  return (
    <Button
      {...props}
      type="button"
      data-page-refresh=""
      aria-keyshortcuts="Meta+R Control+R"
      disabled={disabled || loading}
    >
      <RefreshCw className={loading ? 'spin' : ''} />
      {label ?? t('action.reload')}
      <Kbd>{pageRefreshShortcutLabel()}</Kbd>
    </Button>
  )
}

export function Field({
  label,
  hint,
  required,
  children,
  className = '',
}: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  const { t } = useTranslation('common')
  return (
    <label className={`field ${className}`}>
      <span className="field-label">
        {label}
        {required ? (
          <Badge variant="accent">{t('state.required')}</Badge>
        ) : (
          <span className="optional">{t('state.optional')}</span>
        )}
      </span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function NativeSelect({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`native-select ${className}`} {...props} />
}

export function NativeTextarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`native-textarea ${className}`} {...props} />
}

export function FormGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
  return <div className={`form-grid form-grid-${columns}`}>{children}</div>
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="metric-grid">{children}</div>
}

export function Metric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

export type DataTableColumn<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  align?: 'left' | 'center' | 'right'
  className?: string
  mobileLabel?: string
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  onRowClick,
}: {
  rows: T[]
  columns: DataTableColumn<T>[]
  rowKey: (row: T) => string
  empty?: ReactNode
  onRowClick?: (row: T) => void
}) {
  if (rows.length === 0) return <>{empty ?? <EmptyState title={i18next.t('common:state.emptyRows')} />}</>
  return (
    <div className="data-table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.key} className={`${column.className ?? ''} align-${column.align ?? 'left'}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={rowKey(row)}
              tabIndex={onRowClick ? 0 : undefined}
              className={onRowClick ? 'clickable-row' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onRowClick(row)
                }
              } : undefined}
            >
              {columns.map(column => (
                <td
                  key={column.key}
                  data-label={column.mobileLabel ?? (typeof column.header === 'string' ? column.header : '')}
                  className={`${column.className ?? ''} align-${column.align ?? 'left'}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SearchInput(props: ComponentProps<typeof Input>) {
  return <Input type="search" {...props} />
}

export function stopForm(event: FormEvent) {
  event.preventDefault()
}
