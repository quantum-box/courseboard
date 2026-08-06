import type { DeepPartial } from '../../types'
import type { simulator as source } from '../ja/simulator'

export const simulator: DeepPartial<typeof source> = {
  tax: {
    title: 'This course’s tax settings',
    description: 'The golf course tax is set by prefectural ordinance. Nothing can be priced until the course says which prefecture it is under.',
    field: {
      prefecture: 'Prefecture',
      prefectureUnset: 'Choose one',
      grade: 'Course grade',
      gradeHint: 'The grade the prefecture notified. Left blank, the green fee stands in for it.',
    },
    prefecture: {
      hokkaido: 'Hokkaido',
    },
    saved: 'Tax settings saved',
    savedBody: 'Pricing will use these settings.',
    failed: 'Could not save the tax settings',
  },
  eyebrow: 'Pricing',
  title: 'Golf pricing',
  description:
    'Resolve the course grade and golf course tax from the green fee, and project revenue for a period.',
  quote: {
    title: 'Fee and tax',
    description:
      'Calculate the course grade and golf course tax from the green fee, including optional cart and caddy fees.',
    field: {
      greenFee: 'Green fee',
      numHoles: 'Holes',
      cartFee: 'Cart fee (optional)',
      caddyFee: 'Caddy fee (optional)',
    },
    holes: {
      eighteen: '18 holes',
      nine: '9 holes',
    },
    submit: 'Calculate',
    submitting: 'Calculating',
    prompt: 'Enter the fees to calculate.',
    empty: 'No tax breakdown.',
    metric: {
      grade: 'Grade',
      taxRate: 'Tax rate',
      taxAmount: 'Tax',
      total: 'Total',
    },
    table: {
      player: 'Player',
      tax: 'Tax',
      status: 'Status',
      taxable: 'Taxable',
      exempt: 'Exempt ({{reason}})',
    },
    reason: {
      minor: 'minor',
      senior: 'senior',
      disability_cert: 'disability certificate',
      unknown: 'no reason given',
    },
  },
  range: {
    title: 'Revenue projection',
    description: 'Project revenue, tax, and profit from a booking period and visitor range.',
    field: {
      dateFrom: 'From',
      dateTo: 'To',
      visitorsMin: 'Visitors (min)',
      visitorsMax: 'Visitors (max)',
      avgGreenFee: 'Average green fee',
    },
    submit: 'Simulate',
    submitting: 'Simulating',
    prompt: 'Enter a period and visitor range to simulate.',
    empty: 'No projected rows.',
    metric: {
      revenueMin: 'Revenue (min)',
      revenueMax: 'Revenue (max)',
      taxTotal: 'Tax (max)',
    },
    table: {
      greenFee: 'Green fee',
      grade: 'Grade',
      visitors: 'Visitors',
      revenue: 'Revenue',
      taxTotal: 'Tax',
      profit: 'Profit',
      margin: 'Margin',
    },
  },
}
