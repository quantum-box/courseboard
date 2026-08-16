import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Separator,
} from '@tachyon-sdk/native-ui'
import { ArrowLeft, Link2, Pencil, Search, Trash2, UserPlus, Users } from 'lucide-react'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { ApiError, courseboardApiJson, fieldApiJson, today } from '../../api'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
  SearchInput,
  resourceErrorText,
  type DataTableColumn,
} from '../../components/Page'
import { navigate } from '../../lib/router'
import { useResource, writeResourceCache } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import { caddieCreatePayload, skillLabelKey } from '../golf/caddieRegistration'
import {
  EMPLOYMENT_TYPES,
  STAFF_EMPLOYMENT_STATUSES,
  caddieLinkPayload,
  caddieStatusForStaff,
  employmentTypeKey,
  filterStaffRows,
  newStaffPayload,
  staffRows,
  unlinkedCaddies,
  type EmploymentType,
  type StaffAttendanceSnapshot,
  type StaffCaddieProfile,
  type StaffEmploymentStatus,
  type StaffFilter,
  type StaffMember,
  type StaffRow,
} from './models'
import {
  deleteStaffMember,
  rosterWith,
  rosterWithout,
  updateStaffBasics,
  type StaffListResponse,
} from './staffUpdate'

const COURSE_API = '/v1/course'

type ListResponse<T> = { items: T[] }
type AttendanceResponse = { date: string; items: StaffAttendanceSnapshot[] }

function request(method: string, payload?: unknown): RequestInit {
  return {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? resourceErrorText(error) : fallback
}

/** Field still sends older skill labels, so an unnamed band shows as it came. */
function skillLabel(skill: string, t: TFunction<['staff', 'caddies', 'common']>) {
  const key = skillLabelKey(skill)
  return key ? t(`caddies:skill.${key}` as 'caddies:skill.regular') : skill
}

function statusLabel(
  status: StaffEmploymentStatus,
  t: TFunction<['staff', 'caddies', 'common']>,
) {
  return t(`staff:status.${status}` as 'staff:status.retired')
}

/**
 * Only somebody who is away carries a badge. Marking every working staff
 * member "在籍" says nothing the roster does not already imply, and buries the
 * handful of rows the front desk is looking for.
 */
function StatusBadge({
  status,
  t,
}: {
  status: StaffEmploymentStatus
  t: TFunction<['staff', 'caddies', 'common']>
}) {
  if (status === 'active') return null
  return (
    <Badge variant={status === 'on_leave' ? 'warning' : 'neutral'}>
      {statusLabel(status, t)}
    </Badge>
  )
}

export function StaffPage({ staffId }: { staffId?: string }) {
  const { t, i18n } = useTranslation(['staff', 'caddies', 'common'])
  const timezone = useTenantTimezone()
  const businessDate = today(timezone)

  const staffLoader = useCallback(
    () => fieldApiJson<StaffListResponse>('/v1/erp/staff'),
    [],
  )
  const caddieLoader = useCallback(
    () => courseboardApiJson<ListResponse<StaffCaddieProfile>>(`${COURSE_API}/caddie-profiles`),
    [],
  )
  const attendanceLoader = useCallback(
    () => courseboardApiJson<AttendanceResponse>(
      `${COURSE_API}/caddie-attendance-snapshot?date=${encodeURIComponent(businessDate)}`,
    ),
    [businessDate],
  )

  const staffResource = useResource(staffLoader, [], { cacheKey: 'staff:list' })
  const caddieResource = useResource(caddieLoader, [], { cacheKey: 'staff:caddies' })
  const attendanceResource = useResource(attendanceLoader, [businessDate], {
    cacheKey: `staff:attendance:${businessDate}`,
  })

  const refreshAll = useCallback(() => {
    staffResource.refresh()
    caddieResource.refresh()
    attendanceResource.refresh()
  }, [staffResource.refresh, caddieResource.refresh, attendanceResource.refresh])
  useRegisterPageReload(refreshAll)

  const [filter, setFilter] = useState<StaffFilter>({ query: '', status: 'active', role: 'all' })
  const [creating, setCreating] = useState(false)
  const [linking, setLinking] = useState<StaffRow | null>(null)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [deleting, setDeleting] = useState<StaffRow | null>(null)

  /** Replace one member in the roster the screen is already showing. */
  const applyMember = useCallback((member: StaffMember) => {
    const roster = rosterWith(staffResource.data ?? { items: [member] }, member)
    writeResourceCache('staff:list', roster)
    staffResource.setData(roster)
  }, [staffResource.data, staffResource.setData])

  const profiles = caddieResource.data?.items ?? []
  const rows = useMemo(
    () => staffRows(
      staffResource.data?.items ?? [],
      profiles,
      attendanceResource.data?.items ?? [],
    ),
    [staffResource.data, caddieResource.data, attendanceResource.data],
  )
  const visible = useMemo(() => filterStaffRows(rows, filter), [rows, filter])

  const columns = useMemo<DataTableColumn<StaffRow>[]>(() => [
    {
      key: 'name',
      header: t('staff:table.name'),
      cell: (row: StaffRow) => (
        <div>
          <strong>{row.staff.name}</strong>
          {row.status === 'active' ? null : (
            <>
              {' '}
              <StatusBadge status={row.status} t={t} />
            </>
          )}
          <br />
          <code>{row.staff.id}</code>
        </div>
      ),
    },
    {
      key: 'employmentType',
      header: t('staff:table.employmentType'),
      cell: (row: StaffRow) => {
        const key = employmentTypeKey(row.staff.employmentType)
        // Blank, not a dash: HRM simply has not recorded one for this person.
        if (!key) return null
        return t(`staff:employmentType.${key}` as 'staff:employmentType.full_time')
      },
    },
    {
      key: 'caddie',
      header: t('staff:table.caddie'),
      // Caddie is the one duty CourseBoard tracks; the kitchen and the front
      // desk hold jobs it never sees, so an empty cell says "nothing to show
      // here", not "this person has no job". Their pages live under the
      // caddie roster, which is where caddie work is managed.
      cell: (row: StaffRow) => (row.caddie ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="accent">
            {t('staff:role.caddie', {
              rank: row.caddie.rank,
              skill: skillLabel(row.caddie.skillLevel, t),
            })}
          </Badge>
          {row.attendance ? (
            <Badge variant={row.attendance === 'working' ? 'success' : 'neutral'}>
              {t(`caddies:attendanceStatus.${row.attendance}` as 'caddies:attendanceStatus.working')}
            </Badge>
          ) : null}
        </div>
      ) : null),
    },
  ], [t, i18n.language])

  const loading = staffResource.loading && !staffResource.data
  const detail = staffId ? rows.find(row => row.staff.id === staffId) ?? null : null

  const makeCaddieDialog = linking ? (
    <MakeCaddieDialog
      row={linking}
      unlinked={unlinkedCaddies(profiles)}
      onOpenChange={open => {
        if (!open) setLinking(null)
      }}
      onDone={message => {
        setLinking(null)
        showToast({ tone: 'success', message })
        caddieResource.refresh()
      }}
    />
  ) : null

  if (staffId) {
    return (
      <div className="page-stack">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate('staff')}>
            <ArrowLeft /> {t('staff:detail.back')}
          </Button>
        </div>

        {staffResource.error ? (
          <ResourceError error={staffResource.error} onRetry={staffResource.refresh} />
        ) : null}
        {loading ? <LoadingState label={t('staff:loading')} /> : null}

        {detail ? (
          <>
            <header className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-xl font-semibold leading-7">{detail.staff.name}</h1>
              <StatusBadge status={detail.status} t={t} />
              <code className="text-sm text-muted-foreground">{detail.staff.id}</code>
            </header>

            <Panel
              title={t('staff:detail.basics')}
              actions={(
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(detail)}
                >
                  <Pencil /> {t('staff:edit.action')}
                </Button>
              )}
            >
              <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-8 gap-y-2 px-0.5 text-sm">
                <dt className="text-muted-foreground">{t('staff:table.employmentType')}</dt>
                <dd className="m-0">
                  {(() => {
                    const key = employmentTypeKey(detail.staff.employmentType)
                    return key
                      ? t(`staff:employmentType.${key}` as 'staff:employmentType.full_time')
                      : '—'
                  })()}
                </dd>
                <dt className="text-muted-foreground">{t('staff:table.status')}</dt>
                <dd className="m-0">{statusLabel(detail.status, t)}</dd>
              </dl>
            </Panel>

            <Panel
              title={t('staff:table.caddie')}
              actions={detail.caddie ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`golf/caddies/${encodeURIComponent(detail.caddie?.id ?? '')}`)}
                >
                  <Users /> {t('staff:detail.openCaddie')}
                </Button>
              ) : detail.status === 'active' ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setLinking(detail)}>
                  <Link2 /> {t('staff:action.makeCaddie')}
                </Button>
              ) : null}
            >
              {detail.caddie ? (
                <div className="flex flex-wrap items-center gap-1.5 px-0.5">
                  <Badge variant="accent">
                    {t('staff:role.caddie', {
                      rank: detail.caddie.rank,
                      skill: skillLabel(detail.caddie.skillLevel, t),
                    })}
                  </Badge>
                  {detail.attendance ? (
                    <Badge variant={detail.attendance === 'working' ? 'success' : 'neutral'}>
                      {t(`caddies:attendanceStatus.${detail.attendance}` as 'caddies:attendanceStatus.working')}
                    </Badge>
                  ) : null}
                </div>
              ) : (
                <p className="m-0 px-0.5 text-sm text-muted-foreground">{t('staff:detail.noCaddie')}</p>
              )}
            </Panel>

            <Panel
              title={t('staff:delete.title')}
              actions={(
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleting(detail)}
                >
                  <Trash2 /> {t('staff:delete.action')}
                </Button>
              )}
            >
              <p className="m-0 px-0.5 text-sm text-muted-foreground">
                {t('staff:delete.description')}
              </p>
            </Panel>
          </>
        ) : staffResource.data ? (
          <EmptyState
            title={t('staff:detail.notFound.title')}
            description={t('staff:detail.notFound.description')}
          />
        ) : null}

        {makeCaddieDialog}
        {editing ? (
          <StaffBasicsEditDialog
            row={editing}
            onOpenChange={open => {
              if (!open) setEditing(null)
            }}
            onUpdated={(member, caddieSynced) => {
              // Field returns the stored row, so the heading shows what HRM
              // now holds rather than what this screen submitted.
              applyMember(member)
              caddieResource.refresh()
              setEditing(null)
              showToast(caddieSynced
                ? { tone: 'success', message: t('staff:edit.success', { name: member.name }) }
                : {
                  tone: 'warning',
                  message: t('staff:edit.caddieUnsynced', { name: member.name }),
                })
            }}
          />
        ) : null}
        {deleting ? (
          <StaffDeleteDialog
            row={deleting}
            onOpenChange={open => {
              if (!open) setDeleting(null)
            }}
            onDeleted={() => {
              const roster = rosterWithout(
                staffResource.data ?? { items: [] },
                deleting.staff.id,
              )
              writeResourceCache('staff:list', roster)
              staffResource.setData(roster)
              caddieResource.refresh()
              setDeleting(null)
              showToast({
                tone: 'success',
                message: t('staff:delete.success', { name: deleting.staff.name }),
              })
              // The detail route no longer resolves to anybody.
              navigate('staff')
            }}
          />
        ) : null}
      </div>
    )
  }

  // The workspace bar already names the screen, so the page itself starts at
  // the toolbar — no repeated title, eyebrow, or description above the list.
  return (
    <div className="page-stack">
      <Panel>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:w-64">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <SearchInput
              value={filter.query}
              onChange={event => setFilter({ ...filter, query: event.target.value })}
              placeholder={t('staff:filter.searchPlaceholder')}
              aria-label={t('staff:filter.search')}
              className="pl-8"
            />
          </div>
          <NativeSelect
            value={filter.status}
            onChange={event => setFilter({
              ...filter,
              status: event.target.value as StaffFilter['status'],
            })}
            aria-label={t('staff:filter.employment')}
            className="sm:w-40"
          >
            {STAFF_EMPLOYMENT_STATUSES.map(status => (
              <option key={status} value={status}>{statusLabel(status, t)}</option>
            ))}
            <option value="all">{t('staff:filter.all')}</option>
          </NativeSelect>
          <NativeSelect
            value={filter.role}
            onChange={event => setFilter({
              ...filter,
              role: event.target.value as StaffFilter['role'],
            })}
            aria-label={t('staff:filter.role')}
            className="sm:w-40"
          >
            <option value="all">{t('staff:filter.all')}</option>
            <option value="caddie">{t('staff:filter.roleCaddie')}</option>
            <option value="other">{t('staff:filter.roleOther')}</option>
          </NativeSelect>
          <div className="flex-1" />
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <UserPlus /> {t('staff:create.open')}
          </Button>
        </div>

        {staffResource.error ? (
          <ResourceError error={staffResource.error} onRetry={staffResource.refresh} />
        ) : null}
        {loading ? <LoadingState label={t('staff:loading')} /> : null}
        {caddieResource.error ? (
          <Notice tone="warning">{t('staff:caddieUnavailable')}</Notice>
        ) : null}

        {staffResource.data ? (
          <DataTable
            rows={visible}
            columns={columns}
            rowKey={(row: StaffRow) => row.staff.id}
            onRowClick={row => navigate(`staff/${encodeURIComponent(row.staff.id)}`)}
            empty={(
              <EmptyState
                title={t('staff:list.empty.title')}
                description={t('staff:list.empty.description')}
              />
            )}
          />
        ) : null}
      </Panel>

      <StaffCreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={name => {
          setCreating(false)
          showToast({ tone: 'success', message: t('staff:create.success', { name }) })
          staffResource.refresh()
        }}
      />

      {makeCaddieDialog}
    </div>
  )
}

/**
 * Correcting the name, the contract, and where somebody stands with the club.
 *
 * Leaving and going on leave are edits to the same record rather than separate
 * actions: a club that mixes the two up wants to switch between them, not undo
 * a retirement.
 */
function StaffBasicsEditDialog({
  row,
  onOpenChange,
  onUpdated,
}: {
  row: StaffRow
  onOpenChange: (open: boolean) => void
  onUpdated: (member: StaffMember, caddieSynced: boolean) => void
}) {
  const { t } = useTranslation(['staff', 'caddies', 'common'])
  const [name, setName] = useState(row.staff.name)
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    // Field HRM defaults an unnamed contract to part-time, so the select shows
    // what a save would actually store rather than an empty box.
    employmentTypeKey(row.staff.employmentType) ?? 'part_time',
  )
  const [status, setStatus] = useState<StaffEmploymentStatus>(row.status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const caddie = row.caddie
  const caddieStatus = caddieStatusForStaff(status)
  const caddieChanges = caddie !== null
    && (caddie.employmentStatus ?? 'active').trim().toLowerCase() !== caddieStatus

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('staff:edit.error.name'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      const member = await updateStaffBasics(fieldApiJson, row.staff, {
        name: trimmed,
        employmentType,
        status,
      })
      onUpdated(member, await syncCaddie())
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        setError(t('staff:edit.error.forbidden'))
      } else if (reason instanceof ApiError && reason.status === 404) {
        // Field 404s an id it no longer has: somebody deleted this person
        // while the dialog was open.
        setError(t('staff:edit.error.notFound'))
      } else {
        setError(errorMessage(reason, t('staff:edit.error.failed')))
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * Whether the caddie roster now agrees. The staff record is already saved by
   * this point, so a failure here is reported as a warning and left for the
   * caddie screen — undoing the roster edit would lose the change the operator
   * actually asked for.
   */
  async function syncCaddie() {
    if (!caddie || !caddieChanges) return true
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-profiles/${encodeURIComponent(caddie.id)}`,
        request('PATCH', { employmentStatus: caddieStatus }),
      )
      return true
    } catch {
      return false
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('staff:edit.title', { name: row.staff.name })}</DialogTitle>
          <DialogDescription>{t('staff:edit.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          <Field label={t('staff:edit.name')} required>
            <Input
              value={name}
              onChange={event => setName(event.target.value)}
              autoFocus
            />
          </Field>
          <FormGrid columns={2}>
            <Field label={t('staff:edit.employmentType')} required>
              <NativeSelect
                value={employmentType}
                onChange={event => setEmploymentType(event.target.value as EmploymentType)}
              >
                {EMPLOYMENT_TYPES.map(type => (
                  <option key={type} value={type}>
                    {t(`staff:employmentType.${type}` as 'staff:employmentType.full_time')}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label={t('staff:edit.status')}
              required
              hint={status === 'active' ? undefined : t('staff:edit.statusHint')}
            >
              <NativeSelect
                value={status}
                onChange={event => setStatus(event.target.value as StaffEmploymentStatus)}
              >
                {STAFF_EMPLOYMENT_STATUSES.map(option => (
                  <option key={option} value={option}>{statusLabel(option, t)}</option>
                ))}
              </NativeSelect>
            </Field>
          </FormGrid>

          {caddieChanges ? (
            <Notice tone="info">
              {t('staff:edit.caddieNotice', {
                status: t(`caddies:employment.${caddieStatus}` as 'caddies:employment.active'),
              })}
            </Notice>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              <Pencil /> {busy ? t('staff:edit.submitting') : t('staff:edit.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The caddie roster refused the edit that has to land before a delete. */
class CaddieStandDownError extends Error {
  constructor(readonly reason: unknown) {
    super('the caddie profile could not be suspended')
    this.name = 'CaddieStandDownError'
  }
}

/**
 * Removing somebody from the roster.
 *
 * Field hides the record and keeps their attendance and payroll, but there is
 * no API that brings them back — so this asks plainly rather than reusing the
 * one-click confirm the member list uses for invitations.
 */
function StaffDeleteDialog({
  row,
  onOpenChange,
  onDeleted,
}: {
  row: StaffRow
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation(['staff', 'common'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      // Stand the caddie down first, and abandon the delete if that fails.
      //
      // Deleting the staff member is the point of no return for their caddie
      // profile too: Field resolves the profile's staff link through the staff
      // record, and a deleted one is not found, so every later write to that
      // profile fails — from here and from the caddie screen alike. A caddie
      // stranded that way stays "出勤できる" on the assignment board with no
      // way back.
      await standCaddieDown()
      await deleteStaffMember(fieldApiJson, row.staff.id)
      onDeleted()
    } catch (reason) {
      if (reason instanceof CaddieStandDownError) {
        setError(t('staff:delete.error.caddie'))
      } else if (reason instanceof ApiError && reason.status === 403) {
        setError(t('staff:delete.error.forbidden'))
      } else if (reason instanceof ApiError && reason.status === 404) {
        setError(t('staff:delete.error.notFound'))
      } else {
        setError(errorMessage(reason, t('staff:delete.error.failed')))
      }
      setBusy(false)
    }
  }

  /**
   * Suspend the caddie profile, or refuse to go any further.
   *
   * Failing here leaves the staff member and their caddie exactly as they
   * were — the one failure in this flow the operator can retry or undo.
   */
  async function standCaddieDown() {
    if (!row.caddie) return
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-profiles/${encodeURIComponent(row.caddie.id)}`,
        request('PATCH', { employmentStatus: 'suspended' }),
      )
    } catch (reason) {
      throw new CaddieStandDownError(reason)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('staff:delete.confirm.title', { name: row.staff.name })}</DialogTitle>
          <DialogDescription>{t('staff:delete.confirm.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Notice tone="warning">{t('staff:delete.confirm.warning')}</Notice>
          {row.caddie ? (
            <Notice tone="info">{t('staff:delete.confirm.caddieNotice')}</Notice>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('staff:delete.confirm.keep')}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
              <Trash2 /> {busy ? t('staff:delete.confirm.submitting') : t('staff:delete.confirm.submit')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StaffCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (name: string) => void
}) {
  const { t } = useTranslation(['staff', 'common'])
  const [name, setName] = useState('')
  const [employmentType, setEmploymentType] = useState<EmploymentType>('full_time')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('staff:create.error.name'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await fieldApiJson<StaffMember>(
        '/v1/erp/staff',
        request('POST', newStaffPayload(trimmed, employmentType)),
      )
      setName('')
      setEmploymentType('full_time')
      onCreated(trimmed)
    } catch (reason) {
      setError(errorMessage(reason, t('staff:create.error.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('staff:create.title')}</DialogTitle>
          <DialogDescription>{t('staff:create.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          <FormGrid columns={2}>
            <Field label={t('staff:create.name')} required>
              <Input
                value={name}
                onChange={event => setName(event.target.value)}
                autoFocus
              />
            </Field>
            <Field label={t('staff:create.employmentType')} required>
              <NativeSelect
                value={employmentType}
                onChange={event => setEmploymentType(event.target.value as EmploymentType)}
              >
                {EMPLOYMENT_TYPES.map(type => (
                  <option key={type} value={type}>
                    {t(`staff:employmentType.${type}` as 'staff:employmentType.full_time')}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FormGrid>

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              <UserPlus /> {busy ? t('staff:create.submitting') : t('staff:create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Giving a staff member the caddie role, from the staff side.
 *
 * A profile is normally created for them, but a club migrating in still has
 * legacy caddie profiles nobody is behind — those are offered here so the
 * person's rounds and pay carry over instead of starting again.
 */
function MakeCaddieDialog({
  row,
  unlinked,
  onOpenChange,
  onDone,
}: {
  row: StaffRow
  unlinked: StaffCaddieProfile[]
  onOpenChange: (open: boolean) => void
  onDone: (message: string) => void
}) {
  const { t } = useTranslation(['staff', 'caddies', 'common'])
  const [target, setTarget] = useState('')
  const [skillLevel, setSkillLevel] = useState('regular')
  const [rank, setRank] = useState('D')
  const [baseFeeAmount, setBaseFeeAmount] = useState('12000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const linkExisting = target !== ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    const fee = Number.parseInt(baseFeeAmount, 10)
    if (!linkExisting && (!Number.isFinite(fee) || fee < 0)) {
      setError(t('staff:makeCaddie.error.baseFee'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (linkExisting) {
        await courseboardApiJson(
          `${COURSE_API}/caddie-profiles/${encodeURIComponent(target)}`,
          request('PATCH', caddieLinkPayload(row.staff.id)),
        )
      } else {
        await courseboardApiJson(
          `${COURSE_API}/caddie-profiles`,
          request('POST', caddieCreatePayload({
            name: row.staff.name,
            skillLevel,
            rank,
            baseFeeAmount: fee,
            staffId: row.staff.id,
          })),
        )
      }
      onDone(t('staff:makeCaddie.success', { name: row.staff.name }))
    } catch (reason) {
      setError(errorMessage(reason, t('staff:makeCaddie.error.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('staff:makeCaddie.title', { name: row.staff.name })}</DialogTitle>
          <DialogDescription>{t('staff:makeCaddie.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          {unlinked.length > 0 ? (
            <Field label={t('staff:makeCaddie.target')} required>
              <NativeSelect value={target} onChange={event => setTarget(event.target.value)}>
                <option value="">{t('staff:makeCaddie.targetNew')}</option>
                {unlinked.map(profile => (
                  <option key={profile.id} value={profile.id}>
                    {t('staff:makeCaddie.targetExisting', {
                      name: profile.displayName,
                      id: profile.id,
                    })}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {linkExisting ? (
            <Notice tone="info">{t('staff:makeCaddie.linkNotice')}</Notice>
          ) : (
            <>
              <Separator />
              <FormGrid columns={2}>
                <Field label={t('caddies:create.baseFee')} required>
                  <Input
                    type="number"
                    min={0}
                    value={baseFeeAmount}
                    onChange={event => setBaseFeeAmount(event.target.value)}
                    />
                </Field>
                <Field label={t('caddies:create.skill')} required>
                  <NativeSelect
                    value={skillLevel}
                    onChange={event => setSkillLevel(event.target.value)}
                  >
                    <option value="rookie">{t('caddies:skill.rookie')}</option>
                    <option value="regular">{t('caddies:skill.regular')}</option>
                    <option value="veteran">{t('caddies:skill.veteran')}</option>
                  </NativeSelect>
                </Field>
                <Field label={t('caddies:create.rank')} required>
                  <NativeSelect value={rank} onChange={event => setRank(event.target.value)}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                  </NativeSelect>
                </Field>
              </FormGrid>
            </>
          )}

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              <Link2 /> {busy ? t('staff:makeCaddie.submitting') : t('staff:makeCaddie.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
