export type CaddieView = 'roster' | 'dispatch' | 'attendance' | 'payroll'

export function caddieLoadPlan(view: CaddieView, profilesLoaded: boolean) {
  const canLoadSupportingData = profilesLoaded && view !== 'payroll'
  return {
    assignments: canLoadSupportingData && (view === 'roster' || view === 'dispatch'),
    recommendations: canLoadSupportingData && view === 'dispatch',
    courses: canLoadSupportingData && view === 'roster',
    attendance: canLoadSupportingData,
  }
}
