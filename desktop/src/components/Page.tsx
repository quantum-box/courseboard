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
import { ApiError } from '../api'
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

type ResourceErrorKey =
  | 'error.unknown'
  | 'error.offline'
  | 'error.authRejected'
  | 'error.providerError'
  | 'error.badRequest'
  | 'error.forbidden'
  | 'error.notFound'
  | 'error.conflict'
  | 'error.unprocessable'
  | 'error.serverError'
  | 'error.apiUnreachable'
  | 'error.unexpected'

/**
 * A fetch that never reaches the server rejects with a TypeError whose wording
 * differs per engine — Chrome says "Failed to fetch", the Tauri/WebKit webview
 * says "Load failed". Each pattern has to start on a word boundary: plain
 * substring matching reads an unrelated "Download failed" or "Upload failed"
 * — the shape a CSV export failure takes — as the app being offline.
 */
const NETWORK_FAILURE_PATTERNS = [
  'failed to fetch',
  'load failed',
  'networkerror',
  'network request failed',
  'connection appears to be offline',
  'err_internet_disconnected',
  'err_connection',
].map(pattern => new RegExp(`(?:^|[^a-z])${pattern}`))

/** `message` must already be lower-cased. */
function isNetworkFailureMessage(message: string) {
  return NETWORK_FAILURE_PATTERNS.some(pattern => pattern.test(message))
}

/** `api.ts` falls back to `Request failed with <status>` for bodiless errors. */
const STATUS_ERROR_KEYS: Record<string, ResourceErrorKey> = {
  400: 'error.badRequest',
  401: 'error.authRejected',
  403: 'error.forbidden',
  404: 'error.notFound',
  409: 'error.conflict',
  422: 'error.unprocessable',
  500: 'error.serverError',
  502: 'error.apiUnreachable',
  503: 'error.apiUnreachable',
  504: 'error.apiUnreachable',
}

/**
 * Raw API failures name internal services the operator cannot act on, so map the
 * known ones onto plain-language advice. Returns a key instead of a string so the
 * caller resolves it through its own hook and the copy follows the active locale.
 */
export function resourceErrorCopy(error: unknown): {
  key: ResourceErrorKey
  detail?: string
  operatorMessage?: string
} {
  if (!(error instanceof Error)) return { key: 'error.unknown' }
  const raw = error.message
  const lower = raw.toLowerCase()
  if (error instanceof TypeError || isNetworkFailureMessage(lower)) {
    return { key: 'error.offline' }
  }
  if (
    lower.includes('verify_user')
    || lower.includes('rejected the authenticated bearer')
    || lower.includes('field_api_oauth_incompatible')
    || (lower.includes('field api returned 401') && lower.includes('unauthorized'))
  ) {
    return { key: 'error.authRejected' }
  }
  if (lower.includes('provider_error') || lower.includes('external provider error')) {
    // Provider failures can contain infrastructure details and are not
    // operator-correctable. Only sanitized Field 4xx messages cross the
    // explicit upstream_client_error boundary below.
    return { key: 'error.providerError' }
  }
  if (
    error instanceof ApiError
    && error.status >= 400
    && error.status < 500
    && typeof error.details === 'object'
    && error.details !== null
    && 'error' in error.details
    && error.details.error === 'upstream_client_error'
  ) {
    return { key: 'error.badRequest', operatorMessage: raw }
  }
  // A failure that carries its status is answered by status even when the body
  // supplied wording of its own: server-authored copy is English, so it belongs
  // in the detail line rather than as the sentence the operator reads first.
  if (error instanceof ApiError) {
    const byStatus = STATUS_ERROR_KEYS[String(error.status)]
    if (byStatus) {
      const bodiless = raw === `Request failed with ${error.status}`
      return { key: byStatus, detail: bodiless ? undefined : raw }
    }
  }
  const status = /^request failed with (\d{3})$/.exec(lower)?.[1]
  const mapped = status ? STATUS_ERROR_KEYS[status] : undefined
  if (mapped) return { key: mapped }
  // Anything left is a server-authored message, usually English: lead with copy
  // the operator can act on and keep the original as a support detail.
  return { key: 'error.unexpected', detail: raw }
}

/**
 * The same mapping as `ResourceError`, flattened onto one line for the dialogs
 * and flash messages that have no room for a detail block. Without this a save
 * failure reaches the operator as whatever English the server wrote.
 */
export function resourceErrorText(error: unknown) {
  const { key, detail, operatorMessage } = resourceErrorCopy(error)
  if (operatorMessage) return operatorMessage
  const copy = i18next.t(`common:${key}` as 'common:error.unknown')
  return detail ? `${copy}（${detail}）` : copy
}

export function ResourceError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  const { t } = useTranslation('common')
  const { key, detail, operatorMessage } = resourceErrorCopy(error)
  return (
    <Notice
      tone="danger"
      title={t('error.loadFailed')}
      actions={onRetry ? (
        <PageRefreshButton size="sm" onClick={onRetry} label={t('action.retry')} />
      ) : undefined}
    >
      {operatorMessage ?? t(key)}
      {detail ? <small className="notice-detail">{detail}</small> : null}
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

/**
 * `none` is for filters and other controls that are never submitted: neither
 * "required" nor "optional" says anything true about them.
 */
export function Field({
  label,
  hint,
  required,
  requirement = required ? 'required' : 'optional',
  children,
  className = '',
}: {
  label: string
  hint?: string
  required?: boolean
  requirement?: 'required' | 'optional' | 'none'
  children: ReactNode
  className?: string
}) {
  const { t } = useTranslation('common')
  return (
    <label className={`field ${className}`}>
      <span className="field-label">
        {label}
        {requirement === 'required' ? <Badge variant="accent">{t('state.required')}</Badge> : null}
        {requirement === 'optional' ? <span className="optional">{t('state.optional')}</span> : null}
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
  rowKey: (row: T, index: number) => string
  empty?: ReactNode
  onRowClick?: (row: T) => void
}) {
  const { t } = useTranslation('common')
  if (rows.length === 0) return <>{empty ?? <EmptyState title={t('state.emptyRows')} />}</>
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
          {rows.map((row, rowIndex) => (
            <tr
              key={rowKey(row, rowIndex)}
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
