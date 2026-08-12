import type { DeepPartial } from '../../types'
import type { nav as source } from '../ja/nav'

export const nav: DeepPartial<typeof source> = {
  sections: {
    home: 'Home',
    courseBooking: 'Bookings & courses',
    caddie: 'Caddies',
    company: 'Company',
    finance: 'Revenue & billing',
    dataIntegration: 'Data integration',
    settings: 'Settings',
    account: 'Account',
    tenantMaster: 'Initial setup',
  },
  items: {
    golf: {
      label: 'Home',
      description: 'Where the day starts',
    },
    'golf/ledger': {
      label: 'Start ledger',
      description: 'What is open and who is out, by tee time',
    },
    'golf/customers': {
      label: 'Customers',
      description: 'Members and visitors',
    },
    'golf/reservation-report-import': {
      label: 'Booking report',
      description: 'Review and save daily CSV, Excel, or PDF totals',
    },
    'golf/timeline': {
      label: 'Timeline',
      description: "Today's bookings and caddies in time order",
    },
    'golf/products': {
      label: 'Play products',
      description: 'Play plans and bookable slots',
    },
    'golf/reservation-import': {
      label: 'Import bookings',
      description: 'Bring daily group counts in from the booking system',
    },
    'course-map': {
      label: 'Course map',
      description: 'See where each cart is now',
    },
    'golf/caddies': {
      label: 'Caddie roster',
      description: 'Caddie details and requested days off',
    },
    'golf/caddies/dispatch': {
      label: 'Caddie assignments',
      description: 'Decide who takes each group',
    },
    'golf/caddies/attendance': {
      label: 'Attendance',
      description: 'Clock-ins and what actually happened',
    },
    'golf/caddies/shifts': {
      label: 'Shift board',
      description: 'A month of schedules and working streaks',
    },
    'golf/caddies/payroll': {
      label: 'Payroll',
      description: 'Total up one month of pay',
    },
    'golf/budgets': {
      label: 'Revenue targets',
      description: 'Daily targets and how close you are',
    },
    'golf/simulator': {
      label: 'Pricing',
      description: 'Work out fees, tax, and a revenue estimate',
    },
    'golf/settlement': {
      label: 'Monthly close',
      description: 'Close out a month of revenue and cost',
    },
    'cancellation-fees': {
      label: 'Cancellation fees',
      description: 'Send a bill and confirm payment',
    },
    staff: {
      label: 'Staff roster',
      description: 'Everyone the club employs',
    },
    'golf/courses': {
      label: 'Courses',
      description: 'Bookable hours and tee times per course',
    },
    'golf/policy': {
      label: 'Booking rules',
      description: 'Conditions for accepting bookings',
    },
    'settings/members': {
      label: 'Members & roles',
      description: 'Invite members and manage roles',
    },
    settings: {
      label: 'Settings',
      description: 'Integrations and initial setup',
    },
  },
  sidebar: {
    search: 'Search',
    pinned: 'Pinned',
    expand: 'Expand sidebar',
    collapse: 'Collapse sidebar',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    menuLabel: 'Navigation menu',
    pin: 'Pin to sidebar',
    unpin: 'Unpin from sidebar',
    resize: 'Resize sidebar',
  },
  workspace: {
    openHelp: 'How to use this page',
    closeHelp: 'Close the guide',
    tenantUnset: 'No course selected',
    production: 'Live',
    sandbox: 'Test',
  },
  command: {
    title: 'Command palette',
    description: 'Type a page name to jump straight to it.',
    inputLabel: 'Search pages',
    placeholder: 'Find a page…',
    empty: 'Nothing found',
  },
  tabs: {
    listLabel: 'Course Board tabs',
    newTab: 'New tab',
    closeTab: 'Close {{title}}',
    history: 'Go back or forward',
    back: 'Back',
    forward: 'Forward',
  },
  account: {
    openMenu: 'Open account menu',
    switchTenant: 'Switch course',
    settings: 'Settings',
    signOut: 'Sign out',
    defaultUser: 'Course Board user',
  },
  notFound: {
    title: 'Page not found',
    description: 'This page has moved or no longer exists.',
  },
  redirect: {
    message: 'Taking you to the signed-in Course Board…',
  },
}
