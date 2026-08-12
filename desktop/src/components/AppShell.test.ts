import { describe, expect, it } from 'vitest'
import { navigationSections, sidebarNavigationSections } from './AppShell'

function routes(sections: typeof navigationSections) {
  return sections.flatMap(section => section.items.map(item => item.route))
}

describe('sidebar navigation', () => {
  it('keeps the timeline route available without promoting it in the sidebar', () => {
    expect(routes(navigationSections)).toContain('golf/timeline')
    expect(routes(sidebarNavigationSections)).not.toContain('golf/timeline')
  })

  it('keeps occasional data imports in the final sidebar section', () => {
    const finalSection = sidebarNavigationSections.at(-1)
    expect(finalSection?.id).toBe('dataIntegration')
    expect(finalSection?.items.map(item => item.route)).toEqual([
      'golf/reservation-report-import',
    ])
  })
})
