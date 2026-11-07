/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18next } from '../../i18n'
import { WeatherObservationsPanel } from './WeatherObservationsPanel'

const api = vi.hoisted(() => ({ json: vi.fn() }))
vi.mock('../../api', async importOriginal => ({
  ...await importOriginal<typeof import('../../api')>(), courseboardApiJson: api.json,
}))

const observation = { golfCourseId: 'east', observedAt: '2026-11-07T09:00:00', weather: 'rain', timezone: 'Asia/Tokyo' }
function renderPanel() {
  return render(<I18nextProvider i18n={i18next}><WeatherObservationsPanel
    courses={[{ id: 'east', name: '東コース' }]} from="2026-11-01" to="2026-11-30" courseFilter="all"
  /></I18nextProvider>)
}

afterEach(cleanup)
beforeEach(async () => {
  await i18next.changeLanguage('ja')
  api.json.mockReset()
})

describe('weather observations', () => {
  it('edits and saves a local observation with its date and time', async () => {
    api.json.mockImplementation(async (_path: string, init?: RequestInit) => init ? observation : { items: [observation] })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: '編集' }))
    fireEvent.change(screen.getByLabelText('天気'), { target: { value: 'snow' } })
    fireEvent.click(screen.getByRole('button', { name: '天気を保存' }))
    await screen.findByText('天気の実績を保存しました')
    expect(api.json).toHaveBeenCalledWith('/v1/course/weather-observations', {
      method: 'POST', body: JSON.stringify({ golfCourseId: 'east', observedAt: '2026-11-07T09:00:00', weather: 'snow' }),
    })
    expect(screen.getByText('2026-11-07 09:00 (Asia/Tokyo)')).toBeTruthy()
  })

  it('keeps the draft and allows retry when saving fails', async () => {
    api.json.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init) throw new Error('save failed')
      return { items: [] }
    })
    renderPanel()
    await screen.findByText('この期間の天気の実績はありません。')
    fireEvent.click(screen.getByRole('button', { name: '天気を保存' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '天気を保存' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText('天気の実績を保存しました')).toBeNull()
    expect((screen.getByLabelText(/観測日時/) as HTMLInputElement).value).toBe('2026-11-01T09:00')
  })
})
