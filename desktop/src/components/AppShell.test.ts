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
})
