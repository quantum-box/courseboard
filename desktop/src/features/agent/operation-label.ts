import type { TFunction } from 'i18next'

/** Keep transport details out of the activity log, including API fallback summaries. */
export function operationLabel(
  operation: { method?: string; path?: string; summary?: string | null },
  t: TFunction<'agent'>,
): string {
  const resource = operation.path?.replace(/^\/v1\/(?:course|erp\/extensions\/golf-course)\//, '').split('/')[0]
  const resources = {
    'tee-sheet': 'reservations',
    'tee-ledger': 'reservations',
    reservations: 'reservations',
    customers: 'customers',
    'monthly-settlement': 'settlement',
    'reservation-products': 'products',
    courses: 'courses',
    'caddie-profiles': 'caddies',
    'caddie-assignments': 'assignments',
    'caddie-shifts': 'shifts',
    'daily-budgets': 'budgets',
  } as const
  const action = operation.method === 'GET' ? 'read'
    : operation.method === 'DELETE' ? 'remove'
      : operation.method === 'POST' ? 'create' : 'update'
  const key = resource && resource in resources ? resources[resource as keyof typeof resources] : undefined
  if (key) return t(`chat.operations.${action}`, { resource: t(`chat.resources.${key}`) })
  const summary = operation.summary?.trim()
  if (summary && !/(?:\/v\d+\/|\b(?:GET|POST|PUT|PATCH|DELETE)\b)/.test(summary)) return summary
  return operation.method ? t(`chat.operations.${action}`, { resource: t('chat.resources.information') }) : t('chat.working')
}
