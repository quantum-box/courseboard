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
import { ApiError, fieldApiJson } from '../../api'
import { useAuth } from '../../auth/AuthProvider'
import {
  DataTable,
  EmptyState,
  Field,
  LoadingState,
  Notice,
  PageHeader,
  PageRefreshButton,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import {
  customPolicyNames,
  inviteResultMessage,
  isAdminSelected,
  memberDisplayName,
  memberPolicyIds,
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

type Feedback = { tone: 'success' | 'danger'; message: string }

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function MembersPage() {
  const auth = useAuth()
  const loader = useCallback(async () => {
    return fieldApiJson<ErpUserListResponse>('/v1/field/iam/users')
  }, [])
  const resource = useResource(loader, [], { cacheKey: 'members:list' })
  useRegisterPageReload(resource.refresh)

  const [rowFeedback, setRowFeedback] = useState<Feedback | null>(null)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)
  const [editingMember, setEditingMember] = useState<ErpMember | null>(null)

  const members = useMemo(
    () => sortMembers(resource.data?.users ?? []),
    [resource.data],
  )
  const customPolicies = resource.data?.customPolicies ?? []

  const removeMember = async (member: ErpMember) => {
    if (!window.confirm(
      `「${memberDisplayName(member)}」のロールをすべて外します。よろしいですか？`,
    )) {
      return
    }
    setBusyMemberId(member.id)
    setRowFeedback(null)
    try {
      await fieldApiJson<void>(`/v1/field/iam/users/${encodeURIComponent(member.id)}`, {
        method: 'DELETE',
      })
      setRowFeedback({
        tone: 'success',
        message: `${memberDisplayName(member)} のアクセス権を外しました。`,
      })
      resource.refresh()
    } catch (error) {
      setRowFeedback({
        tone: 'danger',
        message: errorMessage(error, 'メンバーの削除に失敗しました。'),
      })
    } finally {
      setBusyMemberId(null)
    }
  }

  const columns = useMemo(() => [
    {
      key: 'name',
      header: '名前',
      cell: (entry: ErpMember) => (
        <div className="member-name-cell">
          <strong>{memberDisplayName(entry)}</strong>
          {entry.id === auth.user?.id ? <Badge variant="accent">自分</Badge> : null}
        </div>
      ),
    },
    {
      key: 'email',
      header: 'メール',
      cell: (entry: ErpMember) => entry.email ?? '—',
    },
    {
      key: 'role',
      header: 'ロール',
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
                  aria-label={`${memberDisplayName(entry)} のロールを編集`}
                >
                  <SquarePen /> 編集
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
            aria-label={`${memberDisplayName(entry)} のアクセス権を外す`}
          >
            <Trash2 /> 外す
          </Button>
        )
      },
    },
  ], [auth.user?.id, busyMemberId, customPolicies])

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Course Board"
        title="メンバーと権限"
        description="このテナントを操作できるメンバーの一覧、招待、ロールの管理を行います。"
        actions={<PageRefreshButton onClick={resource.refresh} loading={resource.loading} />}
      />

      {resource.loading && !resource.data ? <LoadingState label="メンバーを読み込み中" /> : null}
      {resource.error instanceof ApiError && resource.error.status === 403 ? (
        <Notice tone="warning" title="メンバーを管理する権限がありません">
          この画面の操作には field:ManageUsers を許可されている必要があります。テナントのオーナーは常に許可されます。管理者ロール（pol_erp_admin）の付与、またはプラットフォーム管理者への依頼を検討してください。
        </Notice>
      ) : resource.error ? (
        <ResourceError error={resource.error} onRetry={resource.refresh} />
      ) : null}

      {rowFeedback ? (
        <Notice tone={rowFeedback.tone}>{rowFeedback.message}</Notice>
      ) : null}

      {resource.data ? (
        <Panel
          title="メンバー一覧"
          description="ロールは「編集」から付け替えます。管理者 / スタッフ / 閲覧者 はいずれかひとつ、業務領域のロールはあわせて複数付与できます。"
          actions={(
            <InviteDialog
              catalog={customPolicies}
              onInvited={message => {
                setRowFeedback({ tone: 'success', message })
                resource.refresh()
              }}
            />
          )}
        >
          <DataTable
            rows={members}
            columns={columns}
            rowKey={(entry: ErpMember) => entry.id}
            empty={(
              <EmptyState
                title="ロールを持つメンバーがいません"
                description="「メンバーを招待」からメールアドレスとロールを指定して招待できます。"
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
 * come first, then the tenant's domain roles. 管理者 covers everything, so
 * selecting it clears and grays out every other entry (the toggle helper in
 * models keeps the selection consistent).
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
  const adminSelected = isAdminSelected(selected)
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
  return (
    <div className="member-roles-checklist">
      {ROLE_OPTIONS.map(option => renderItem(option.policyId, option.label, option.summary))}
      {catalog.length > 0 ? <div className="member-roles-divider" role="separator" /> : null}
      {catalog.map(policy => renderItem(policy.id, policy.name, policy.description))}
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
  const [selected, setSelected] = useState<string[]>(() => memberPolicyIds(member))
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
      onSaved(`${memberDisplayName(member)} のロールを更新しました。`)
    } catch (cause) {
      setError(errorMessage(cause, 'ロールの更新に失敗しました。'))
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
          <DialogTitle>{memberDisplayName(member)} のロールを編集</DialogTitle>
          <DialogDescription>
            管理者 / スタッフ / 閲覧者 はいずれかひとつ、業務領域のロールはあわせて複数付与できます。保存すると即時に反映されます。
          </DialogDescription>
        </DialogHeader>
        <form className="member-invite-dialog-form" onSubmit={save}>
          <div className="field">
            <span className="field-label">ロール</span>
            <RoleChecklist
              catalog={catalog}
              selected={selected}
              disabled={saving}
              onToggle={(policyId, checked) => {
                setSelected(current => togglePolicySelection(current, policyId, checked))
              }}
            />
          </div>
          {error ? (
            <Notice tone="danger" title="保存できませんでした">{error}</Notice>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const DEFAULT_INVITE_POLICY_IDS = ['pol_erp_staff']

function InviteDialog({
  catalog,
  onInvited,
}: {
  catalog: ErpCustomPolicy[]
  onInvited: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [selected, setSelected] = useState<string[]>(DEFAULT_INVITE_POLICY_IDS)
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
      setError('ロールをひとつ以上選択してください。')
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
      setSelected(DEFAULT_INVITE_POLICY_IDS)
      setOpen(false)
      onInvited(inviteResultMessage(response))
    } catch (cause) {
      setError(errorMessage(cause, '招待に失敗しました。時間をおいて再試行してください。'))
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
          <MailPlus /> メンバーを招待
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>メンバーを招待</DialogTitle>
          <DialogDescription>
            既存の Tachyon ユーザーには即時にアクセスとロールを付与し、未登録のアドレスには招待メールを送信します。
          </DialogDescription>
        </DialogHeader>
        <form className="member-invite-dialog-form" onSubmit={submit}>
          <Field label="メールアドレス" required>
            <Input
              type="email"
              value={email}
              onChange={event => setEmail(event.currentTarget.value)}
              placeholder="staff@example.com"
              autoComplete="off"
              disabled={submitting}
            />
          </Field>
          <div className="field">
            <span className="field-label">ロール</span>
            <RoleChecklist
              catalog={catalog}
              selected={selected}
              disabled={submitting}
              onToggle={(policyId, checked) => {
                setSelected(current => togglePolicySelection(current, policyId, checked))
              }}
            />
          </div>
          {error ? (
            <Notice tone="danger" title="招待できませんでした">{error}</Notice>
          ) : null}
          <p className="member-invite-hint">
            <ShieldCheck aria-hidden="true" /> メンバー管理には field:ManageUsers の許可が必要です（オーナーは常に許可、管理者ロールにも含まれます）。
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => setOpen(false)}
            >
              キャンセル
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              <MailPlus /> {submitting ? '招待を送信中…' : '招待を送信'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
