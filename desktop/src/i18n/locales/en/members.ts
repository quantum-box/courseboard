import type { DeepPartial } from '../../types'
import type { members as source } from '../ja/members'

export const members: DeepPartial<typeof source> = {
  title: 'Members & roles',
  description: 'List, invite, and manage the roles of everyone who can work in this tenant.',
  loading: 'Loading members',
  forbidden: {
    title: 'You cannot manage members',
    body: 'This screen requires the field:ManageUsers permission. Tenant owners always have it. Ask for the administrator role (pol_erp_admin) or contact a platform administrator.',
  },
  list: {
    title: 'Members',
    description: 'Change roles from “Edit”. Administrator / Staff / Viewer are mutually exclusive; domain roles can be combined freely.',
    empty: {
      title: 'No member has a role yet',
      description: 'Use “Invite member” to invite someone by email address and role.',
    },
  },
  table: {
    name: 'Name',
    email: 'Email',
    role: 'Role',
    self: 'You',
  },
  action: {
    editRole: 'Edit',
    editRoleAria: 'Edit roles for {{name}}',
    remove: 'Remove',
    removeAria: 'Revoke access for {{name}}',
  },
  remove: {
    confirm: 'This removes every role from “{{name}}”. Continue?',
    success: 'Revoked access for {{name}}.',
    failed: 'Could not remove the member.',
  },
  roleField: 'Roles',
  roles: {
    owner: 'Owner',
    ownerSummary: 'Tenant owner. AdministratorAccess always grants every action.',
    unassigned: 'No role',
    unassignedSummary: 'No role assigned. Field data stays read-protected until a role is assigned.',
    admin: {
      label: 'Administrator',
      summary: 'Full access to every feature plus member and settings management. No other role is needed.',
    },
    staff: {
      label: 'Staff',
      summary: 'Can create and update day-to-day operational data. Cannot manage members or change settings.',
    },
    viewer: {
      label: 'Viewer',
      summary: 'Read-only access to operational data. Cannot create, update, or delete.',
    },
  },
  edit: {
    title: 'Edit roles for {{name}}',
    description: 'Administrator / Staff / Viewer are mutually exclusive; domain roles can be combined freely. Changes take effect as soon as you save.',
    saveFailedTitle: 'Could not save',
    saveFailed: 'Could not update the roles.',
    success: 'Updated the roles for {{name}}.',
  },
  invite: {
    trigger: 'Invite member',
    title: 'Invite member',
    description: 'Existing Tachyon users get access and roles immediately; unknown addresses receive an invitation email.',
    email: 'Email address',
    emailPlaceholder: 'staff@example.com',
    hint: 'Managing members requires the field:ManageUsers permission (owners always have it, and the administrator role includes it).',
    submit: 'Send invitation',
    submitting: 'Sending the invitation…',
    failedTitle: 'Could not invite',
    failed: 'The invitation failed. Please try again in a moment.',
    validation: {
      emailRequired: 'Enter an email address.',
      emailFormat: 'That email address is not in a valid format.',
      roleRequired: 'Select at least one role.',
    },
    result: {
      sent: 'Sent an invitation email to {{email}}. Assign roles here once it is accepted.',
      sentFallback: 'that address',
      applied: '{{name}} already had an account, so access and roles were applied immediately.',
      appliedFallback: 'The existing user',
    },
  },
}
