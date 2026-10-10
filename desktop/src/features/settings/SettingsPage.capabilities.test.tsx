/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../../i18n'
import { SettingsPage } from './SettingsPage'

const access = vi.hoisted(() => ({ actions: {} as Record<string, boolean | null> }))

vi.mock('../../auth/EffectiveCapabilitiesProvider', () => ({
  useEffectiveCapabilities: () => ({ capabilities: {
    actions: access.actions,
    navigation: { otherBusinessAccess: true },
    cancellationFees: { list: false, manage: false },
  } }),
}))

describe('settings entry capabilities', () => {
  beforeEach(async () => {
    access.actions = {
      'field_extension_golf:ListMembership': true,
      'field:ListMembership': true,
    }
    await i18next.changeLanguage('ja')
  })
  afterEach(cleanup)

  it('shows permitted membership settings without exposing member administration or golf settings', () => {
    render(<I18nextProvider i18n={i18next}><SettingsPage /></I18nextProvider>)
    expect(screen.getByText(i18next.t('settings:membership.title'), { selector: 'strong' }).closest('button')).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(i18next.t('nav:items.settings/members.label')) })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(i18next.t('nav:items.golf/policy.label')) })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(i18next.t('settings:advanced.linkLabel')) })).toBeNull()
  })
})
