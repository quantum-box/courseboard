import type { DeepPartial } from '../../types'
import type { agent as source } from '../ja/agent'

export const agent: DeepPartial<typeof source> = {
  chat: {

  "activityRunning": "Working…",
  "activityDone": "Activity ({{count}} completed)",
  "activityErrors": "Activity ({{count}}, review needed)",
  "operations": {
    "read": "Reading {{resource}}",
    "create": "Creating {{resource}}",
    "update": "Updating {{resource}}",
    "remove": "Deleting {{resource}}"
  },
  "resources": {
    "reservations": "reservations",
    "customers": "customers",
    "settlement": "monthly totals",
    "products": "play products",
    "courses": "courses",
    "caddies": "caddies",
    "assignments": "caddie assignments",
    "shifts": "shifts",
    "budgets": "sales targets",
    "information": "information"
  }
,
  breakdown: {
  "title": "Reservations by course — {{date}}",
  "source": "Course names and figures are displayed directly from the reservation ledger.",
  "course": "Course",
  "groups": "Groups",
  "players": "Players",
  "self": "Self play",
  "caddie": "With caddie",
  "total": "Total",
  "capacity": "Available slots: {{count}}",
  "capacityPartial": "Known available slots: {{count}} (unknown for {{missing}} courses)"
},
  reservationTotals: 'Reservation ledger {{date}}: {{groups}} groups, {{players}} players',
  reservationIncomplete: 'The reservation ledger could not be loaded completely',
  reservationStatus: 'Checking reservation counts in the booking ledger',
  "title": "Courseboard Agent",
  "description": "Ask about reservations, customers and reports in your own words.",
  "new": "New conversation",
  "conversation": "Conversation",
  "welcome": "Tell the agent what you want to find or change.",
  "examples": {
    "reservations": "Check today's reservations",
    "customers": "Help me find a customer by name",
    "summary": "Summarize revenue and visitors this month"
  },
  "you": "You",
  "assistant": "Agent",
  "working": "Working…",
  "searching": "Finding available operations",
  "describing": "Checking the operation",
  "confirmTitle": "Apply this change?",
  "change": "Business data will be changed.",
  "confirmDescription": "Review the values below. Applied changes cannot be undone from this screen.",
  "approve": "Apply change",
  "reject": "Do not apply",
  "declined": "Change declined",
  "prompt": "Your request",
  "placeholder": "For example: Show today's reservations",
  "send": "Send",
  "stop": "Stop",
  "awaiting": "Waiting for your confirmation",
  "tooLong": "Your request is too long. Shorten it and try again.",
  "interrupted": "Stopped. Changes already applied have not been undone. Check the relevant screen and start a new conversation to continue.",
  "forbidden": "Agent access or AI availability could not be confirmed. Contact your administrator.",
  "failed": "The response could not be completed. A change may already have been applied. Check the relevant screen before starting a new conversation.",
  "demo": "Demo only. No AI connection or changes to business data.",
  "demoReply": "This is a conversation demo. In a connected environment, the agent can inspect reservations, customers and reports using your permissions.",
  "fields": {
    "name": "Name",
    "customerName": "Customer name",
    "customerId": "Customer",
    "reservationId": "Reservation",
    "date": "Date",
    "startTime": "Start time",
    "endTime": "End time",
    "amount": "Amount",
    "status": "Status",
    "reason": "Reason",
    "phone": "Phone",
    "email": "Email",
    "courseId": "Course",
    "partySize": "Party size",
    "notes": "Notes",
    "target": "Target",
    "body": "Details",
    "query": "Filter"
  }
},
}
