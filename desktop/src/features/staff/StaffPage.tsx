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
import { ArrowLeft, Link2, Pencil, Search, UserPlus, Users } from 'lucide-react'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
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
  caddieLinkPayload,
  employmentTypeKey,
  filterStaffRows,
  newStaffPayload,
  staffRows,
  unlinkedCaddies,
  type EmploymentType,
  type StaffAttendanceSnapshot,
  type StaffCaddieProfile,
  type StaffFilter,
  type StaffMember,
  type StaffRow,
} from './models'
import {
  StaffMemberNotFoundError,
  updateStaffName,
  type StaffNameUpdateResult,
} from './staffNameUpdate'

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

export function StaffPage({ staffId }: { staffId?: string }) {
  const { t, i18n } = useTranslation(['staff', 'caddies', 'common'])
  const businessDate = today()

  const staffLoader = useCallback(
    () => fieldApiJson<ListResponse<StaffMember>>('/v1/erp/staff'),
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
  const [editingName, setEditingName] = useState<StaffMember | null>(null)

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
          {row.staff.active ? null : (
            <>
              {' '}
              <Badge variant="neutral">{t('staff:retired')}</Badge>
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
              {detail.staff.active ? null : (
                <Badge variant="neutral">{t('staff:retired')}</Badge>
              )}
              <code className="text-sm text-muted-foreground">{detail.staff.id}</code>
            </header>

            <Panel
              title={t('staff:detail.basics')}
              actions={(
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingName(detail.staff)}
                >
                  <Pencil /> {t('staff:editName.action')}
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
              ) : detail.staff.active ? (
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
          </>
        ) : staffResource.data ? (
          <EmptyState
            title={t('staff:detail.notFound.title')}
            description={t('staff:detail.notFound.description')}
          />
        ) : null}

        {makeCaddieDialog}
        {editingName ? (
          <StaffNameEditDialog
            staff={editingName}
            onOpenChange={open => {
              if (!open) setEditingName(null)
            }}
            onUpdated={result => {
              // `result.roster` is the GET performed after Field accepted the
              // PATCH, so the heading changes to the HRM value we confirmed.
              writeResourceCache('staff:list', result.roster)
              staffResource.setData(result.roster)
              setEditingName(null)
              showToast({
                tone: 'success',
                message: t('staff:editName.success', { name: result.member.name }),
              })
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
            <option value="active">{t('staff:filter.employmentActive')}</option>
            <option value="retired">{t('staff:filter.employmentRetired')}</option>
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

function StaffNameEditDialog({
  staff,
  onOpenChange,
  onUpdated,
}: {
  staff: StaffMember
  onOpenChange: (open: boolean) => void
  onUpdated: (result: StaffNameUpdateResult) => void
}) {
  const { t } = useTranslation(['staff', 'common'])
  const [name, setName] = useState(staff.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('staff:editName.error.name'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      onUpdated(await updateStaffName(fieldApiJson, staff.id, trimmed))
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        setError(t('staff:editName.error.forbidden'))
      } else if (reason instanceof StaffMemberNotFoundError) {
        setError(t('staff:editName.error.notFound'))
      } else {
        setError(errorMessage(reason, t('staff:editName.error.failed')))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('staff:editName.title', { name: staff.name })}</DialogTitle>
          <DialogDescription>{t('staff:editName.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          <Field label={t('staff:editName.name')} required>
            <Input
              value={name}
              onChange={event => setName(event.target.value)}
              autoFocus
            />
          </Field>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              <Pencil /> {busy ? t('staff:editName.submitting') : t('staff:editName.submit')}
            </Button>
          </DialogFooter>
        </form>
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
