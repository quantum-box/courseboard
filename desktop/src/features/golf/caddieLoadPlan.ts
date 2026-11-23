export type CaddieView = 'roster' | 'dispatch' | 'duties' | 'attendance' | 'survey' | 'payroll'

export function caddieLoadPlan(view: CaddieView, profilesLoaded: boolean) {
  const canLoadSupportingData = profilesLoaded && view !== 'payroll'
  return {
    assignments: canLoadSupportingData && (view === 'roster' || view === 'dispatch' || view === 'duties'),
    recommendations: canLoadSupportingData && view === 'dispatch',
    courses: canLoadSupportingData && view === 'roster',
    attendance: canLoadSupportingData && view !== 'duties' && view !== 'survey',
  }
}
