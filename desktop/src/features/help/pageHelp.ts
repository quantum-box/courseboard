import { helpEn } from './help.en'
import { helpJa } from './help.ja'
import { helpJaPlain } from './help.ja-plain'
import type { HelpCatalog, PageHelp, PageHelpSection } from './types'

export type { PageHelp, PageHelpSection }

const catalogs: Record<string, HelpCatalog> = {
  ja: helpJa,
  en: helpEn,
  'ja-plain': helpJaPlain,
}

const CADDIE_SUBVIEWS = ['dispatch', 'attendance', 'shifts', 'payroll']

/** Detail routes (a caddie id, an invoice id) reuse their list page's guide. */
function normalizeHelpRoute(route: string, routes: Record<string, PageHelp>) {
  if (route.startsWith('cancellation-fees')) return 'cancellation-fees'
  if (
    route === 'golf/caddies'
    || (route.startsWith('golf/caddies/') && !CADDIE_SUBVIEWS.includes(route.split('/')[2] ?? ''))
  ) {
    return 'golf/caddies'
  }
  // A course id opens that course's week and the tee times built from it — a
  // different job from the course list its route nests under.
  if (route.startsWith('golf/courses/')) return 'golf/courses/schedule'
  if (routes[route]) return route
  // Longest matching prefix for nested routes.
  const candidates = Object.keys(routes)
    .filter(key => route === key || route.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)
  return candidates[0] ?? null
}

export function getPageHelp(route: string, locale = 'ja'): PageHelp {
  const catalog = catalogs[locale] ?? helpJa
  const key = normalizeHelpRoute(route, helpJa.routes)
  if (!key) return catalog.fallback
  return catalog.routes[key] ?? helpJa.routes[key] ?? catalog.fallback
}
