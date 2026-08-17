import type { DeepPartial } from '../../types'
import type { members as source } from '../ja/members'

export const members: DeepPartial<typeof source> = {
  title: 'Members & roles',
  description: 'List, invite, and manage the roles of everyone who can work in this tenant.',
  loading: 'Loading members',
  forbidden: {
    title: 'You cannot manage members',
    body: 'This screen requires the field:ManageUsers permission. Tenant owners always have it. Ask to be granted the administrator role, or contact a platform administrator.',
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
    status: 'Status',
    role: 'Role',
    self: 'You',
  },
  status: {
    active: 'Active',
    pending: 'Invited',
  },
  searchPlaceholder: 'Search by name, email, or ID',
  checklist: {
    selectAll: 'Check all',
    clearAll: 'Clear all',
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
    description: 'Existing Tachyon users get access and roles immediately. Unknown addresses only receive an invitation email; assign roles here again once the invitation is accepted.',
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
  policies: {
    golfManager: {
      label: 'Course manager',
      description: 'Can create and update everything in golf operations — reservations, tee sheet, caddies, shifts, customers, memberships, settlement, and cancellation fees. Member management is not included.',
    },
    golfReception: {
      label: 'Front desk',
      description: 'Can create and update reservations, the tee sheet, customers, and memberships, and run fee simulations. Caddies and shifts are out of reach.',
    },
    golfCaddieMaster: {
      label: 'Caddie master',
      description: 'Can create and update the caddie roster, assignments, availability, and shifts. Customers and memberships are out of reach.',
    },
    golfAccounting: {
      label: 'Golf accounting',
      description: 'Can run monthly settlement, payroll summaries, and fee simulations, and collect cancellation fees. Reservations are read-only.',
    },
    golfViewer: {
      label: 'Golf viewer',
      description: 'Read-only access to the tee sheet, reservations, caddies, and shifts, plus fee simulation. Cannot create or update.',
    },
    fieldSales: {
      label: 'Sales',
      description: 'Can create and update deals, customers, orders, memberships, and sales tasks. Products and sales analytics are read-only.',
    },
    fieldFinance: {
      label: 'Finance',
      description: 'Can create and update invoices, payments, sales and purchase ledgers, expenses, and sales contracts, and approve expense and SaaS requests. Customers and dashboards are read-only.',
    },
    fieldProcurement: {
      label: 'Procurement & inventory',
      description: 'Can create and update inventory, purchase orders, suppliers, and products. Sales analytics are read-only.',
    },
    fieldReservations: {
      label: 'Reservations',
      description: 'Can create and update reservations, slots, and plans. Customers and sales analytics are read-only.',
    },
    fieldHr: {
      label: 'HR & labor',
      description: 'Can create and update staff, shifts, and attendance. Sales analytics are read-only.',
    },
    fieldAccountingManager: {
      label: 'Accounting manager',
      description: 'Can create and update the books and closings, and confirm and reconcile payments. Other accounting data is read-only.',
    },
    fieldExpenseApprover: {
      label: 'Expense approver',
      description: 'Can review, approve, and reject expense requests. Cannot create or edit requests.',
    },
    fieldPurchaseApprover: {
      label: 'Purchase approver',
      description: 'Can create and update purchase ledgers and journal candidates. Purchase orders and receiving are read-only.',
    },
    fieldExtensionManager: {
      label: 'Extension manager',
      description: 'Can install, enable, and configure extensions. Reservations are read-only.',
    },
    fieldSaasApprover: {
      label: 'SaaS approver',
      description: 'Can review, approve, and send back SaaS change requests. Cannot create requests.',
    },
  },
}
