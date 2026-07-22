export type CaddieView = 'roster' | 'dispatch' | 'attendance' | 'payroll'

export function caddieLoadPlan(view: CaddieView, profilesSettled: boolean) {
  const canLoadSupportingData = profilesSettled && view !== 'payroll'
  return {
    assignments: canLoadSupportingData && (view === 'roster' || view === 'dispatch'),
    recommendations: canLoadSupportingData && view === 'dispatch',
    courses: canLoadSupportingData && view === 'roster',
    attendance: canLoadSupportingData,
  }
}
