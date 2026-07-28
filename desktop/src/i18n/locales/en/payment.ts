import type { DeepPartial } from '../../types'
import type { payment as source } from '../ja/payment'

export const payment: DeepPartial<typeof source> = {
  unavailable: 'This payment link is not available right now. Please contact the golf course.',
  loadFailed: 'Could not load the payment details',
  formFailed: 'Could not prepare the payment form',
  cannotOpen: 'This payment page cannot be opened',
  loading: 'Loading…',
  paid: {
    title: 'Already paid',
    description: 'We have confirmed your cancellation fee payment.',
  },
  title: 'Cancellation fee payment',
  field: {
    client: 'Name',
    reference: 'For',
    due: 'Due date',
    reason: 'Reason',
  },
  form: {
    unavailableTitle: 'The payment form cannot be prepared',
    preparing: 'Preparing the payment form…',
    initFailed: 'Could not start the payment form',
    initFailedTitle: 'The payment form cannot start',
    loading: 'Loading the payment form…',
    loadFailed: 'Could not load the payment form',
    amount: 'Amount due',
    submit: 'Complete the payment',
    submitting: 'Processing…',
    failed: 'The payment did not go through',
    succeeded: 'Payment confirmed',
    processing: 'Your payment was received. Confirmation will follow shortly.',
  },
  pdf: {
    fontFailed: 'Could not load the font for the invoice PDF.',
    title: 'Invoice',
    titleContinued: 'Invoice (continued)',
    due: 'Due  {{date}}',
    columns: {
      item: 'Item',
      quantity: 'Qty',
      unitPrice: 'Unit price',
      amount: 'Amount',
    },
    subtotal: 'Subtotal',
    tax: 'Tax',
    total: 'Total',
    notes: 'Notes',
    paymentLink: 'Payment link',
  },
}
