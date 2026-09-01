/**
 * The settings masters that have a route of their own, with the copy keys each
 * one takes its name and one-liner from.
 *
 * One list so the hub's links and the title bar cannot drift: a master added
 * here appears in both, and one left out of it is a screen the shell would
 * render as "not found". The keys are spelled out rather than built from the
 * section name because i18next checks them against the catalogue.
 */
export const SETTINGS_MASTERS = [
  {
    route: 'settings/membership-plans',
    key: 'membership',
    titleKey: 'settings:membership.title',
    descriptionKey: 'settings:membership.linkDescription',
  },
  {
    route: 'settings/membership-discounts',
    key: 'discounts',
    titleKey: 'settings:discounts.title',
    descriptionKey: 'settings:discounts.linkDescription',
  },
  {
    route: 'settings/membership-play-windows',
    key: 'playWindows',
    titleKey: 'settings:playWindows.title',
    descriptionKey: 'settings:playWindows.linkDescription',
  },
  {
    route: 'settings/customer-grades',
    key: 'grades',
    titleKey: 'settings:grades.title',
    descriptionKey: 'settings:grades.linkDescription',
  },
  {
    route: 'settings/caddie-duties',
    key: 'caddieDuties',
    titleKey: 'settings:caddieDuties.title',
    descriptionKey: 'settings:caddieDuties.linkDescription',
  },
  {
    route: 'settings/reception-fields',
    key: 'receptionFields',
    titleKey: 'settings:receptionFields.title',
    descriptionKey: 'settings:receptionFields.linkDescription',
  },
] as const

export type SettingsMaster = (typeof SETTINGS_MASTERS)[number]

/** The master a route opens, or null for anything else. */
export function settingsMaster(route: string): SettingsMaster | null {
  return SETTINGS_MASTERS.find(master => master.route === route) ?? null
}
