import type { HelpCatalog } from './types'

export const helpEn: HelpCatalog = {
  fallback: {
    title: 'Course Board',
    summary: 'The operations screen for a golf course. Open each task from the menu on the left.',
    usage: [
      {
        heading: 'Finding a screen',
        body: 'The menu is grouped into bookings & courses, caddies, and revenue & billing. Pin the ones you use most to the top.',
      },
      {
        heading: 'Jump with search',
        body: 'Press ⌘K (Ctrl+K on Windows), type a screen name, and go straight there.',
      },
      {
        heading: 'Using this guide',
        body: 'Open it with the “?” at the top right. It follows whichever screen you are on.',
      },
    ],
    data: [
      {
        heading: 'Course',
        body: 'The name at the top right is the course you are working on. Everything you save and list stays inside it.',
      },
    ],
  },
  routes: {
    golf: {
      title: 'Home',
      summary: 'Where the day starts: shortcuts to the screens you use most, in the order you use them.',
      usage: [
        {
          heading: 'Start with the timeline',
          body: 'Open today’s timeline first to see the day’s bookings and caddie assignments.',
        },
        {
          heading: 'Work top to bottom',
          body: 'Timeline → caddie assignments → revenue & billing → monthly close. Each step hands the same data to the next.',
        },
        {
          heading: 'Setup lives elsewhere',
          body: 'Courses and booking rules are one-time setup; open them from Settings.',
        },
      ],
      data: [],
    },

    'golf/timeline': {
      title: 'Timeline',
      summary: 'The day’s bookings and caddie assignments on one shared time axis.',
      usage: [
        {
          heading: 'Pick the day and course',
          body: 'Use the date and course controls at the top. “Today” jumps back to today.',
        },
        {
          heading: 'Spot gaps and clashes',
          body: 'Colour carries the state: orange is a booking with nobody assigned, red is one caddie double-booked.',
        },
        {
          heading: 'Go fix it',
          body: 'Press a block to see its details on the right, then “Open assignments” to change who works it.',
        },
      ],
      data: [
        {
          heading: 'Tee sheet',
          body: 'One lane per course, bookings in time order. Block length is the expected round time.',
        },
        {
          heading: 'Caddie lanes',
          body: 'One lane per caddie showing their assignments. A red outline means overlapping times.',
        },
      ],
    },

    'golf/products': {
      title: 'Play products',
      summary: 'The kinds of play you sell and the slots you can accept each weekday.',
      usage: [
        {
          heading: 'Open a service',
          body: 'Select a row to open that service’s own screen. The weekly slots are edited there.',
        },
        {
          heading: 'Edit the slots',
          body: 'Each weekday has its own card. Enter start, end, groups, and players; 0 means no limit. Build one day, then use “Copy to…” to stamp it onto Mon–Fri or the weekend.',
        },
        {
          heading: 'Build from caddie supply',
          body: 'For caddie-required products, morning and afternoon slots can be derived from available caddies and applied to that date’s weekday.',
        },
      ],
      data: [
        {
          heading: 'Play type',
          body: 'With caddie or self play. Only caddie-required products track caddie supply.',
        },
        {
          heading: 'Slot',
          body: 'The cap on groups and players for one weekday and time band. Saving replaces the whole week, so check the added/dropped/changed counts in the bottom bar first.',
        },
      ],
    },

    'course-map': {
      title: 'Course map',
      summary: 'Where each cart is on the course right now. Open it from Settings or the ⌘K search.',
      usage: [
        {
          heading: 'Check the state',
          body: 'The top left shows whether you are connected and how many carts are displayed.',
        },
        {
          heading: 'What the colours mean',
          body: 'Yellow is on the round, red is running late, blue is waiting.',
        },
      ],
      data: [
        {
          heading: 'Cart position',
          body: 'Comes from the on-course trackers. While disconnected, the last known position stays on screen.',
        },
      ],
    },

    'golf/caddies': {
      title: 'Caddie roster',
      summary: 'Caddie details, staff links, day-off requests, and ratings.',
      usage: [
        {
          heading: 'Find someone',
          body: 'Filter the list by name, availability, skill, or whether they are linked to a staff record.',
        },
        {
          heading: 'Link to staff',
          body: 'Being a caddie is one staff role, so a newly added caddie is linked from their name automatically. Older unlinked profiles are flagged at the top; attendance and payroll only include linked caddies.',
        },
        {
          heading: 'Record day-off requests',
          body: 'On the day-off tab, click a date to open it in a panel on the right. Set availability and a condition note, then save — assignments and capacity use them.',
        },
      ],
      data: [
        {
          heading: 'Skill and rank',
          body: 'Skill is rookie, regular, or veteran. Rank is the rounds-per-month guideline. Auto-assign uses both.',
        },
        {
          heading: 'Daily limit',
          body: 'How many rounds this caddie can work in a day. Two-round caddies have a limit of 2.',
        },
      ],
    },

    'golf/caddies/dispatch': {
      title: 'Caddie assignments',
      summary: 'Decide who takes each group on a given day — today or weeks ahead.',
      usage: [
        {
          heading: 'Pick the day',
          body: 'Set the date at the top of the board. Pick a future date to staff it in advance; caddies do not need to have clocked in.',
        },
        {
          heading: 'Adjust assignments',
          body: 'Complete or cancel assignments from the list. Clock-ins happen on the Attendance screen.',
        },
        {
          heading: 'Fill the gaps automatically',
          body: 'Press “Preview assignments”, review the result, then commit it.',
        },
      ],
      data: [
        {
          heading: 'Caddie-required capacity',
          body: 'The safe ceiling on caddie-required groups, derived from availability and two-round capability.',
        },
        {
          heading: 'Safety buffer',
          body: 'Groups held back from the ceiling to absorb last-minute absences.',
        },
      ],
    },

    'golf/caddies/attendance': {
      title: 'Attendance',
      summary: 'Compare the day’s assignments with clock-ins and record attendance here.',
      usage: [
        {
          heading: 'Record attendance',
          body: 'Use the clock-in and clock-out buttons in the list.',
        },
        {
          heading: 'Catch what is missing',
          body: '“Needs a look” lists caddies who have an assignment but no clock-in.',
        },
      ],
      data: [
        {
          heading: 'Attendance state',
          body: 'Not clocked in, working, or clocked out. Caddies without a staff link cannot be clocked in.',
        },
      ],
    },

    'golf/caddies/shifts': {
      title: 'Shift board',
      summary: 'A month of caddie schedules in one table — requested days off and assignments together, so long working streaks stand out.',
      usage: [
        {
          heading: 'Pick a month and scan',
          body: 'Choose the month at the top. Rows are caddies, columns are days; W means assigned, O means a requested day off.',
        },
        {
          heading: 'Spot long streaks',
          body: 'Six or more assigned days in a row are highlighted in red, with the streak length in the left column. Adjust via the roster or assignments.',
        },
      ],
      data: [
        {
          heading: 'Symbols',
          body: 'W = assigned, O = day off requested, AM/PM = half day, L = light duty. Blank means nothing planned.',
        },
      ],
    },
    'golf/caddies/payroll': {
      title: 'Payroll',
      summary: 'A month priced off the rank fees, reconciled against attendance and ready to hand to payroll as CSV.',
      usage: [
        {
          heading: 'Pick the month, then narrow it',
          body: 'Choose the month at the top to list the caddies. Search by name, staff id, or rank, and click a header to sort.',
        },
        {
          heading: 'Set the rank fees',
          body: 'Press "Set the fees" to enter what one round pays at each rank, A through D. Every amount on the screen is priced off that table.',
        },
        {
          heading: 'Check before exporting',
          body: 'Look for missing staff links, missing clock-outs, and assignments without a clock-in first.',
        },
      ],
      data: [
        {
          heading: 'Pay',
          body: 'The rounds worked that month times the per-round fee. Cancelled assignments are excluded.',
        },
        {
          heading: 'Per round',
          body: "Normally the caddie's rank fee. A caddie with a fee of their own is paid that instead, and the row says so. Correcting a fee re-prices months that are already closed.",
        },
      ],
    },

    'golf/budgets': {
      title: 'Revenue targets',
      summary: 'Set daily revenue targets and compare them with actual bookings.',
      usage: [
        {
          heading: 'Pick month and course',
          body: 'Choose the month at the top. The course filter applies to the list below.',
        },
        {
          heading: 'Enter one day',
          body: 'Set course, date, target revenue, target per player, and caddie share, then save.',
        },
        {
          heading: 'Import in bulk',
          body: 'Load a CSV in the same shape to register a whole month at once. Grab the template from the button.',
        },
      ],
      data: [
        {
          heading: 'Attainment',
          body: 'Actual revenue ÷ target revenue. It turns green above 100%.',
        },
        {
          heading: 'Per player',
          body: 'Revenue divided by the number of players. The booking rules can check against it.',
        },
      ],
    },

    'golf/settlement': {
      title: 'Monthly close',
      summary: 'Check a month of revenue, caddie cost, cancellation fees, and payments before closing.',
      usage: [
        {
          heading: 'Pick the month',
          body: 'Choose the month at the top to see the totals.',
        },
        {
          heading: 'Clear what is unpaid',
          body: 'Unpaid cancellation fees can be invoiced and sent from this screen.',
        },
        {
          heading: 'Export the CSV',
          body: 'Once it looks right, export the detail for accounting.',
        },
      ],
      data: [
        {
          heading: 'Outstanding',
          body: 'Booking revenue minus what has actually been received.',
        },
        {
          heading: 'Unmatched rows',
          body: 'Payment records not yet tied to a booking. Ideally this is zero.',
        },
      ],
    },

    'cancellation-fees': {
      title: 'Cancellation fees',
      summary: 'Create and send cancellation fee invoices, then confirm payment.',
      usage: [
        {
          heading: 'Create an invoice',
          body: 'Press “New invoice” and fill in the booking, amount, billing details, and due date.',
        },
        {
          heading: 'Choose how to send it',
          body: 'Email, SMS, or both. Sending SMS requires confirming the recipient’s consent.',
        },
        {
          heading: 'Confirm payment',
          body: 'You are done when the status reads “Paid”. Resend from the invoice page if needed.',
        },
      ],
      data: [
        {
          heading: 'Payment link',
          body: 'The URL the customer opens to pay. It is issued with the invoice and inserted into the message.',
        },
        {
          heading: 'Overdue',
          body: 'Past the due date with no payment received.',
        },
      ],
    },

    'golf/courses': {
      title: 'Course setup',
      summary: 'One-time setup for your courses. Play products and caddie coverage build on it.',
      usage: [
        {
          heading: 'How to open it',
          body: 'Settings → Initial setup. You will rarely open it day to day.',
        },
        {
          heading: 'Add a course',
          body: 'Enter the name, hole count, start interval, and time zone, then save.',
        },
        {
          heading: 'Take one out of use',
          body: 'Edit it and set the status to disabled. It stops appearing in play products without being deleted.',
        },
      ],
      data: [
        {
          heading: 'Start interval',
          body: 'Minutes between groups going out. It determines how many slots a day holds.',
        },
      ],
    },

    'golf/policy': {
      title: 'Booking rules',
      summary: 'One-time setup for the conditions under which you accept bookings.',
      usage: [
        {
          heading: 'Set the slot basics',
          body: 'Default holes, players per slot, cart handling, and the booking cutoff.',
        },
        {
          heading: 'Set the deposit',
          body: 'How much is paid up front, set separately for members and guests.',
        },
        {
          heading: 'Protect busy times',
          body: 'Reserve time bands for caddie-accompanied play, and decide what to do with low-value bookings.',
        },
      ],
      data: [
        {
          heading: 'Cutoff',
          body: 'How many hours before the tee time bookings stop being accepted.',
        },
        {
          heading: 'Per-player spend check',
          body: 'Sends bookings below your threshold to review, or refuses them.',
        },
      ],
    },

    'settings/advanced': {
      title: 'System integration details',
      summary: 'Runtime status of the golf features and the settings for connecting other systems. Not needed day to day.',
      usage: [
        {
          heading: 'Check the runtime status',
          body: 'Confirm the golf features read as enabled and validation passes; any problems are listed on this page.',
        },
        {
          heading: 'Edit the integration settings',
          body: 'Edit and save the metadataJson used when bookings are sent to external systems. Daily reception never touches this.',
        },
      ],
      data: [
        {
          heading: 'Config version',
          body: 'Increments on every save; “default” means nothing has been saved yet.',
        },
      ],
    },

    staff: {
      title: 'Staff roster',
      summary: 'Everyone the club employs. Caddies appear here as one of the roles staff hold.',
      usage: [
        {
          heading: 'Register a staff member',
          body: 'Use "Register staff" to enter a name and employment type. Whether they caddie is decided later.',
        },
        {
          heading: 'Give the caddie role',
          body: '"Make a caddie" gives that staff member the role. Any caddie profile still without a person can be picked up instead of starting fresh.',
        },
        {
          heading: 'Search',
          body: 'Search by name, staff ID, or caddie name, and filter by employment or role.',
        },
      ],
      data: [
        {
          heading: 'Staff records',
          body: 'Held by Field HRM (/v1/erp/staff). Renaming someone or retiring them is not available on this screen yet.',
        },
        {
          heading: 'Today’s attendance',
          body: 'Read from caddie punches, so non-caddie staff stay as “—”.',
        },
      ],
    },
    'settings/members': {
      title: 'Members & roles',
      summary: 'List, invite, and manage the roles of everyone who can use this facility.',
      usage: [
        {
          heading: 'Change roles',
          body: 'Use Edit on a row to swap roles. Admin, staff and viewer are exclusive; per-domain roles can stack. Picking admin makes every other role unnecessary.',
        },
        {
          heading: 'Invite a member',
          body: 'Invite with an email address and roles. New addresses receive an invitation email; assign their roles here after they accept.',
        },
        {
          heading: 'Remove a member',
          body: 'Remove detaches every role. The owner cannot be changed.',
        },
      ],
      data: [
        {
          heading: 'Roles',
          body: 'Admin: everything including member management. Staff: day-to-day edits. Viewer: read only. The owner always has full access.',
        },
        {
          heading: 'Member data',
          body: 'Managed by Field IAM (/v1/field/iam/*). Actions require the field:ManageUsers permission; owners always pass.',
        },
      ],
    },
    settings: {
      title: 'Settings',
      summary: 'One-time setup and integrations with other services.',
      usage: [
        {
          heading: 'Initial setup',
          body: 'Course setup and booking rules open from here.',
        },
        {
          heading: 'Currency and time zone',
          body: 'Used across the whole course. Set once during setup.',
        },
      ],
      data: [
        {
          heading: 'Integration metadata',
          body: 'Settings used when bookings sync to other systems. Not touched during day-to-day work.',
        },
      ],
    },
  },
}
