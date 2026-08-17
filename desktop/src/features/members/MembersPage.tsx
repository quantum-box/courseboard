import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from '@tachyon-sdk/native-ui'
import { MailPlus, ShieldCheck, SquarePen, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, fieldApiJson } from '../../api'
import { useAuth } from '../../auth/AuthProvider'
import {
  DataTable,
  EmptyState,
  Field,
  LoadingState,
  Notice,
  Panel,
  ResourceError,
  resourceErrorText,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import {
  customPolicyNames,
  domainPolicies,
  inviteResultMessage,
  isAdminSelected,
  memberDisplayName,
  memberPolicyIds,
  policyIdByName,
  roleBadgeVariant,
  roleLabel,
  rolePermissionSummary,
  sortMembers,
  togglePolicySelection,
  validateInviteEmail,
  ROLE_OPTIONS,
  type ErpCustomPolicy,
  type ErpMember,
  type ErpUserListResponse,
  type InviteMemberResponse,
} from './models'

/** Announcements are toasts, so the page itself never shifts under a message. */
const setRowFeedback = showToast

/**
 * Invite and role changes report failures in a flash message with no room for a
 * detail block, and used to print the IAM API's own English. Route them through
 * the shared mapping so the sentence follows the active locale; `fallback` still
 * covers the throw that carries no message of its own.
 */
function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? resourceErrorText(error) : fallback
}

export function MembersPage() {
  const { t, i18n } = useTranslation(['members', 'common'])
  const auth = useAuth()
  const loader = useCallback(async () => {
    return fieldApiJson<ErpUserListResponse>('/v1/field/iam/users')
  }, [])
  const resource = useResource(loader, [], { cacheKey: 'members:list' })
  useRegisterPageReload(resource.refresh)

  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)
  const [editingMember, setEditingMember] = useState<ErpMember | null>(null)

  const members = useMemo(
    () => sortMembers(resource.data?.users ?? []),
    [resource.data],
  )
  const customPolicies = resource.data?.customPolicies ?? []

  const removeMember = async (member: ErpMember) => {
    if (!window.confirm(t('members:remove.confirm', { name: memberDisplayName(member) }))) {
      return
    }
    setBusyMemberId(member.id)
    try {
      await fieldApiJson<void>(`/v1/field/iam/users/${encodeURIComponent(member.id)}`, {
        method: 'DELETE',
      })
      setRowFeedback({
        tone: 'success',
        message: t('members:remove.success', { name: memberDisplayName(member) }),
      })
      resource.refresh()
    } catch (error) {
      setRowFeedback({
        tone: 'danger',
        message: errorMessage(error, t('members:remove.failed')),
      })
    } finally {
      setBusyMemberId(null)
    }
  }

  const columns = useMemo(() => [
    {
      key: 'name',
      header: t('members:table.name'),
      cell: (entry: ErpMember) => (
        <div className="member-name-cell">
          <strong>{memberDisplayName(entry)}</strong>
          {entry.id === auth.user?.id ? <Badge variant="accent">{t('members:table.self')}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'email',
      header: t('members:table.email'),
      cell: (entry: ErpMember) => entry.email ?? '—',
    },
    {
      key: 'role',
      header: t('members:table.role'),
      cell: (entry: ErpMember) => {
        const policyNames = customPolicyNames(entry, customPolicies)
        return (
          <div className="member-role-cell">
            <span className="member-policy-badges">
              <Badge
                variant={roleBadgeVariant(entry)}
                title={rolePermissionSummary(entry)}
              >
                {roleLabel(entry)}
              </Badge>
              {policyNames.map(name => <Badge key={name} variant="neutral">{name}</Badge>)}
              {!entry.isOwner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyMemberId === entry.id}
                  onClick={() => setEditingMember(entry)}
                  aria-label={t('members:action.editRoleAria', { name: memberDisplayName(entry) })}
                >
                  <SquarePen /> {t('members:action.editRole')}
                </Button>
              ) : null}
            </span>
          </div>
        )
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      cell: (entry: ErpMember) => {
        if (entry.isOwner) return null
        return (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busyMemberId === entry.id}
            onClick={() => void removeMember(entry)}
            aria-label={t('members:action.removeAria', { name: memberDisplayName(entry) })}
          >
            <Trash2 /> {t('members:action.remove')}
          </Button>
        )
      },
    },
    // `i18n.language` keeps the memoized header strings in step with a switch.
  ], [auth.user?.id, busyMemberId, customPolicies, t, i18n.language])

  return (
    <div className="page-stack">
      {resource.loading && !resource.data ? <LoadingState label={t('members:loading')} /> : null}
      {resource.error instanceof ApiError && resource.error.status === 403 ? (
        <Notice tone="warning" title={t('members:forbidden.title')}>
          {t('members:forbidden.body')}
        </Notice>
      ) : resource.error ? (
        <ResourceError error={resource.error} onRetry={resource.refresh} />
      ) : null}

      {resource.data ? (
        <Panel
          title={t('members:list.title')}
          description={t('members:list.description')}
          actions={(
            <>
              <InviteDialog
                catalog={customPolicies}
                onInvited={message => {
                  setRowFeedback({ tone: 'success', message })
                  resource.refresh()
                }}
              />
            </>
          )}
        >
          <DataTable
            rows={members}
            columns={columns}
            rowKey={(entry: ErpMember) => entry.id}
            empty={(
              <EmptyState
                title={t('members:list.empty.title')}
                description={t('members:list.empty.description')}
              />
            )}
          />
        </Panel>
      ) : null}

      {editingMember ? (
        <EditRolesDialog
          member={editingMember}
          catalog={customPolicies}
          onClose={() => setEditingMember(null)}
          onSaved={message => {
            setEditingMember(null)
            setRowFeedback({ tone: 'success', message })
            resource.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Unified role picker over one flat policy list. The three exclusive roles
 * come first, then the tenant's domain roles. The administrator role covers
 * everything, so selecting it clears and grays out every other entry (the
 * toggle helper in models keeps the selection consistent). Custom policy names
 * come from the tenant's own catalogue, so they are never translated here.
 */
function RoleChecklist({
  catalog,
  selected,
  disabled,
  onToggle,
}: {
  catalog: ErpCustomPolicy[]
  selected: string[]
  disabled: boolean
  onToggle: (policyId: string, checked: boolean) => void
}) {
  const { t } = useTranslation(['members'])
  const adminSelected = isAdminSelected(catalog, selected)
  const renderItem = (policyId: string, label: string, description?: string | null) => {
    const checked = selected.includes(policyId)
    const itemDisabled = disabled || (adminSelected && !checked)
    return (
      <label key={policyId} data-disabled={itemDisabled || undefined}>
        <input
          type="checkbox"
          checked={checked}
          disabled={itemDisabled}
          onChange={event => onToggle(policyId, event.currentTarget.checked)}
        />
        <span>
          <strong>{label}</strong>
          {description ? <small>{description}</small> : null}
        </span>
      </label>
    )
  }
  // Only the roles this tenant actually has. A missing one is left out rather
  // than shown as a checkbox that fails on save.
  const roles = ROLE_OPTIONS
    .map(option => ({ option, id: policyIdByName(catalog, option.responseValue) }))
    .filter((entry): entry is { option: typeof ROLE_OPTIONS[number]; id: string } => entry.id !== null)
  // The basic roles are listed above, so they are dropped here to keep one
  // policy from appearing twice in the same checklist.
  const domain = domainPolicies(catalog)
  return (
    <div className="member-roles-checklist">
      {roles.map(({ option, id }) => renderItem(
        id,
        t(option.labelKey),
        t(option.summaryKey),
      ))}
      {roles.length > 0 && domain.length > 0
        ? <div className="member-roles-divider" role="separator" />
        : null}
      {domain.map(policy => renderItem(policy.id, policy.name, policy.description))}
    </div>
  )
}

function EditRolesDialog({
  member,
  catalog,
  onClose,
  onSaved,
}: {
  member: ErpMember
  catalog: ErpCustomPolicy[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useTranslation(['members', 'common'])
  const [selected, setSelected] = useState<string[]>(() => memberPolicyIds(member, catalog))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await fieldApiJson<ErpMember>(
        `/v1/field/iam/users/${encodeURIComponent(member.id)}/policies`,
        {
          method: 'PUT',
          body: JSON.stringify({ policyIds: selected }),
        },
      )
      onSaved(t('members:edit.success', { name: memberDisplayName(member) }))
    } catch (cause) {
      setError(errorMessage(cause, t('members:edit.saveFailed')))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next && !saving) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('members:edit.title', { name: memberDisplayName(member) })}</DialogTitle>
          <DialogDescription>{t('members:edit.description')}</DialogDescription>
        </DialogHeader>
        <form className="member-invite-dialog-form" onSubmit={save}>
          <div className="field">
            <span className="field-label">{t('members:roleField')}</span>
            <RoleChecklist
              catalog={catalog}
              selected={selected}
              disabled={saving}
              onToggle={(policyId, checked) => {
                setSelected(current => togglePolicySelection(catalog, current, policyId, checked))
              }}
            />
          </div>
          {error ? (
            <Notice tone="danger" title={t('members:edit.saveFailedTitle')}>{error}</Notice>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t('common:action.saving') : t('common:action.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Everyday access, preselected — but only if this tenant actually has the
 * policy. A default id that is not in the catalogue would be rejected on
 * submit, with nothing on screen explaining why.
 */
function defaultInvitePolicyIds(catalog: ErpCustomPolicy[]) {
  const operator = policyIdByName(catalog, 'field:operator')
  return operator ? [operator] : []
}

function InviteDialog({
  catalog,
  onInvited,
}: {
  catalog: ErpCustomPolicy[]
  onInvited: (message: string) => void
}) {
  const { t } = useTranslation(['members', 'common'])
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [selected, setSelected] = useState<string[]>(() => defaultInvitePolicyIds(catalog))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const validated = validateInviteEmail(email)
    if ('error' in validated) {
      setError(validated.error)
      return
    }
    if (selected.length === 0) {
      setError(t('members:invite.validation.roleRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const response = await fieldApiJson<InviteMemberResponse>('/v1/field/iam/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: validated.email,
          notifyUser: true,
          policyIds: selected,
        }),
      })
      setEmail('')
      setSelected(defaultInvitePolicyIds(catalog))
      setOpen(false)
      onInvited(inviteResultMessage(response))
    } catch (cause) {
      setError(errorMessage(cause, t('members:invite.failed')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (submitting) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="primary">
          <MailPlus /> {t('members:invite.trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('members:invite.title')}</DialogTitle>
          <DialogDescription>{t('members:invite.description')}</DialogDescription>
        </DialogHeader>
        <form className="member-invite-dialog-form" onSubmit={submit}>
          <Field label={t('members:invite.email')} required>
            <Input
              type="email"
              value={email}
              onChange={event => setEmail(event.currentTarget.value)}
              placeholder={t('members:invite.emailPlaceholder')}
              autoComplete="off"
              disabled={submitting}
            />
          </Field>
          <div className="field">
            <span className="field-label">{t('members:roleField')}</span>
            <RoleChecklist
              catalog={catalog}
              selected={selected}
              disabled={submitting}
              onToggle={(policyId, checked) => {
                setSelected(current => togglePolicySelection(catalog, current, policyId, checked))
              }}
            />
          </div>
          {error ? (
            <Notice tone="danger" title={t('members:invite.failedTitle')}>{error}</Notice>
          ) : null}
          <p className="member-invite-hint">
            <ShieldCheck aria-hidden="true" /> {t('members:invite.hint')}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => setOpen(false)}
            >
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              <MailPlus /> {submitting ? t('members:invite.submitting') : t('members:invite.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
