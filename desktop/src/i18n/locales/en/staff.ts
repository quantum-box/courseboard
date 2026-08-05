export const staff = {
  loading: 'Loading staff…',
  caddieUnavailable: 'Caddie data could not be loaded, so the caddie column stays blank.',
  filter: {
    search: 'Search',
    searchPlaceholder: 'Name or staff ID',
    employment: 'Employment',
    employmentActive: 'Currently employed',
    employmentRetired: 'Retired',
    role: 'Role',
    roleCaddie: 'Works as a caddie',
    roleOther: 'Staff who do not caddie',
    all: 'All',
  },
  list: {
    empty: {
      title: 'No staff match',
      description: 'Change the search, or register a staff member.',
    },
  },
  table: {
    name: 'Name',
    employmentType: 'Employment type',
    caddie: 'Caddie',
  },
  retired: 'Retired',
  employmentType: {
    full_time: 'Full-time',
    part_time: 'Part-time',
  },
  role: {
    caddie: 'Rank {{rank}}, {{skill}}',
  },
  action: {
    makeCaddie: 'Make a caddie',
  },
  detail: {
    back: 'Back to roster',
    basics: 'Basics',
    openCaddie: 'Open caddie page',
    noCaddie: 'Holds no caddie duty.',
    notFound: {
      title: 'Staff member not found',
      description: 'They may have been removed, or the ID is wrong. Go back to the roster and search again.',
    },
  },
  create: {
    open: 'Register staff',
    title: 'Register a staff member',
    description: 'Add someone to the company roster. Whether they caddie is decided later.',
    name: 'Name',
    employmentType: 'Employment type',
    submit: 'Register',
    submitting: 'Registering…',
    success: '{{name}} was added to the staff roster.',
    error: {
      name: 'Enter a name.',
      failed: 'The staff member could not be registered. Try again.',
    },
  },
  makeCaddie: {
    title: 'Make {{name}} a caddie',
    description: 'Gives this staff member the caddie role. Attendance and payroll stay on the staff record.',
    target: 'Caddie profile',
    targetNew: 'Create a new one',
    targetExisting: 'Link {{name}} ({{id}})',
    linkNotice: 'An existing caddie profile is linked to this staff member. Their rounds and ratings carry over.',
    submit: 'Make a caddie',
    submitting: 'Saving…',
    success: '{{name}} now holds the caddie role.',
    error: {
      baseFee: 'Enter a fee of 0 or more.',
      failed: 'The caddie role could not be given. Try again.',
    },
  },
} as const
