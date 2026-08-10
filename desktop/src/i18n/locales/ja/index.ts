import { auth } from './auth'
import { budgets } from './budgets'
import { caddies } from './caddies'
import { cancellationFees } from './cancellationFees'
import { common } from './common'
import { courses } from './courses'
import { customers } from './customers'
import { download } from './download'
import { help } from './help'
import { home } from './home'
import { ledger } from './ledger'
import { map } from './map'
import { members } from './members'
import { nav } from './nav'
import { payment } from './payment'
import { policy } from './policy'
import { products } from './products'
import { schedule } from './schedule'
import { settings } from './settings'
import { settlement } from './settlement'
import { simulator } from './simulator'
import { staff } from './staff'
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
  customers,
  download,
  help,
  home,
  ledger,
  map,
  members,
  nav,
  payment,
  policy,
  products,
  schedule,
  settings,
  settlement,
  simulator,
  staff,
  shifts,
  timeline,
} as const

export type Resources = typeof ja
export type Namespace = keyof Resources
