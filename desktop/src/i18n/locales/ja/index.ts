import { auth } from './auth'
import { budgets } from './budgets'
import { caddies } from './caddies'
import { cancellationFees } from './cancellationFees'
import { common } from './common'
import { courses } from './courses'
import { download } from './download'
import { help } from './help'
import { home } from './home'
import { map } from './map'
import { nav } from './nav'
import { payment } from './payment'
import { policy } from './policy'
import { products } from './products'
import { settings } from './settings'
import { settlement } from './settlement'
import { shifts } from './shifts'
import { timeline } from './timeline'

/** Japanese is the source of truth: every key must exist here first. */
export const ja = {
  auth,
  budgets,
  caddies,
  cancellationFees,
  common,
  courses,
  download,
  help,
  home,
  map,
  nav,
  payment,
  policy,
  products,
  settings,
  settlement,
  shifts,
  timeline,
} as const

export type Resources = typeof ja
export type Namespace = keyof Resources
