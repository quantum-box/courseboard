import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { useMemo, useState } from 'react'
import type {
  ComponentProps,
  FormEvent,
  HTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  LoaderCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api'
import { i18next } from '../i18n'
import {
  filterRows,
  nextSort,
  pageCountOf,
  pageSlice,
  sortRows,
  type DataTableSort,
} from './dataTable'

export type { DataTableSort } from './dataTable'

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

/**
 * A section the operator opens when they want it.
 *
 * Screens that carry supporting figures next to the day's work grow past one
 * screenful, and the work then starts below the fold. What is read while
 * deciding stays open; what is consulted now and then goes in here, named on
 * the button so nothing is hidden behind an icon.
 */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details className="collapsible-section" open={defaultOpen}>
      <summary className="collapsible-summary">
        <ChevronRight aria-hidden="true" />
        <span>{title}</span>
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
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
      // 400/422 payloads often contain validator field names such as
      // `yearMonth`. They are implementation vocabulary, not operator copy.
      const hideValidatorDetail = error.status === 400 || error.status === 422
      return { key: byStatus, detail: bodiless || hideValidatorDetail ? undefined : raw }
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
        <Button type="button" size="sm" onClick={onRetry}>
          {t('action.retry')}
        </Button>
      ) : undefined}
    >
      {operatorMessage ?? t(key)}
      {detail ? <small className="notice-detail">{detail}</small> : null}
    </Notice>
  )
}

/**
 * `none` is for filters and other controls that are never submitted: neither
 * "required" nor "optional" says anything true about them.
 */
/**
 * A labelled control.
 *
 * Only what the form insists on is marked. Marking the rest as well put "任意"
 * on thirteen of the booking sheet's sixteen fields, where it said nothing the
 * absence of "必須" did not already say, and buried the two that matter. Pass
 * `requirement="optional"` where a single optional field sits among required
 * ones and the desk would otherwise wonder.
 */
export function Field({
  label,
  hint,
  required,
  requirement = required ? 'required' : 'none',
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
  /**
   * Makes the column sortable, by saying what it sorts on. A cell renders to a
   * ReactNode, which cannot be compared — the column has to name the value
   * behind it. `null` sorts last in both directions, so "not set" never looks
   * like the smallest amount.
   */
  sortValue?: (row: T) => string | number | null
  /** What this column contributes to the search box, if anything. */
  searchValue?: (row: T) => string
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowClassName,
  empty,
  onRowClick,
  defaultSort,
  pageSize,
  searchable = false,
  searchPlaceholder,
}: {
  rows: T[]
  columns: DataTableColumn<T>[]
  rowKey: (row: T, index: number) => string
  /**
   * Marks a row as something other than an ordinary one — a second round of
   * the day, say. Returning nothing leaves the row exactly as it was.
   */
  rowClassName?: (row: T) => string | undefined
  empty?: ReactNode
  onRowClick?: (row: T) => void
  /** Which column the table opens sorted by. */
  defaultSort?: DataTableSort
  /** Rows per page. Omitted, the whole set is rendered. */
  pageSize?: number
  /** Shows a search box filtering on the columns that define `searchValue`. */
  searchable?: boolean
  searchPlaceholder?: string
}) {
  const { t } = useTranslation('common')
  const [sort, setSort] = useState<DataTableSort | null>(defaultSort ?? null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const searchColumns = useMemo(
    () => columns.filter(column => column.searchValue),
    [columns],
  )
  const sortColumn = sort ? columns.find(column => column.key === sort.key) : undefined

  const visible = useMemo(
    () => sortRows(filterRows(rows, columns, query), sortColumn, sort?.direction ?? 'asc'),
    [rows, columns, query, sortColumn, sort?.direction],
  )

  const pageCount = pageSize ? pageCountOf(visible.length, pageSize) : 1
  const paged = pageSize ? pageSlice(visible, page, pageSize) : { page: 0, rows: visible }
  const currentPage = paged.page
  const pageRows = paged.rows

  function toggleSort(column: DataTableColumn<T>) {
    if (!column.sortValue) return
    setPage(0)
    setSort(current => nextSort(current, column.key))
  }

  const search = searchable && searchColumns.length > 0 ? (
    <div className="data-table-toolbar">
      <SearchInput
        value={query}
        onChange={event => {
          setQuery(event.target.value)
          setPage(0)
        }}
        placeholder={searchPlaceholder ?? t('action.search')}
        aria-label={searchPlaceholder ?? t('action.search')}
      />
      {query.trim() !== '' ? (
        <span className="data-table-count">
          {t('table.matches', { shown: String(visible.length), total: String(rows.length) })}
        </span>
      ) : null}
    </div>
  ) : null

  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title={t('state.emptyRows')} />}</>
  }

  return (
    <div className="data-table-frame">
      {search}
      {visible.length === 0 ? (
        <EmptyState
          title={t('table.noMatches.title')}
          description={t('table.noMatches.description')}
          action={(
            <Button type="button" variant="secondary" size="sm" onClick={() => setQuery('')}>
              {t('table.clearSearch')}
            </Button>
          )}
        />
      ) : (
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map(column => {
                  const sorted = sort?.key === column.key ? sort.direction : null
                  const className = `${column.className ?? ''} align-${column.align ?? 'left'}`
                  if (!column.sortValue) {
                    return <th key={column.key} className={className}>{column.header}</th>
                  }
                  return (
                    <th
                      key={column.key}
                      className={className}
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                    >
                      <button
                        type="button"
                        className="data-table-sort"
                        onClick={() => toggleSort(column)}
                        title={t('table.sortBy')}
                      >
                        {column.header}
                        {sorted === 'asc' ? <ArrowUp aria-hidden="true" /> : null}
                        {sorted === 'desc' ? <ArrowDown aria-hidden="true" /> : null}
                        {sorted === null ? <ChevronsUpDown aria-hidden="true" className="data-table-sort-idle" /> : null}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, rowIndex) => (
                <tr
                  key={rowKey(row, rowIndex)}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={[onRowClick ? 'clickable-row' : '', rowClassName?.(row) ?? '']
                    .filter(Boolean)
                    .join(' ') || undefined}
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
      )}
      {pageSize && visible.length > 0 ? (
        <div className="data-table-pager">
          <span className="data-table-count">
            {t('table.range', {
              from: String(currentPage * pageSize + 1),
              to: String(currentPage * pageSize + pageRows.length),
              total: String(visible.length),
            })}
          </span>
          <div className="data-table-pager-buttons">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft /> {t('table.prev')}
            </Button>
            <span className="data-table-count">
              {t('table.page', { page: String(currentPage + 1), pages: String(pageCount) })}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              {t('table.next')} <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function SearchInput(props: ComponentProps<typeof Input>) {
  return <Input type="search" {...props} />
}

export function stopForm(event: FormEvent) {
  event.preventDefault()
}
