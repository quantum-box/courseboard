import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}))

vi.mock('@tachyon-sdk/native-ui', () => ({ toast: toastMocks }))

import {
  DEFAULT_TOAST_DURATION_MS,
  ERROR_TOAST_DURATION_MS,
  showToast,
} from './toast'

describe('showToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gives ordinary notices an explicit finite lifetime', () => {
    showToast({ tone: 'success', message: '保存しました' })

    expect(toastMocks.success).toHaveBeenCalledWith('保存しました', {
      duration: DEFAULT_TOAST_DURATION_MS,
    })
  })

  it('keeps errors readable for longer without making them permanent', () => {
    showToast({ tone: 'danger', title: '保存できません', message: 'もう一度試してください' })

    expect(toastMocks.error).toHaveBeenCalledWith('保存できません', {
      description: 'もう一度試してください',
      duration: ERROR_TOAST_DURATION_MS,
    })
  })

  it('replaces repeated feedback when it has a stable id', () => {
    showToast({
      tone: 'success',
      message: '再読み込みしました',
      id: 'page-reload',
      position: 'bottom-left',
    })

    expect(toastMocks.success).toHaveBeenCalledWith('再読み込みしました', {
      id: 'page-reload',
      position: 'bottom-left',
      duration: DEFAULT_TOAST_DURATION_MS,
    })
  })

  it('keeps the animated loading indicator visible until it is replaced', () => {
    showToast({
      tone: 'loading',
      message: '再読み込み中…',
      id: 'page-reload',
      position: 'bottom-left',
    })

    expect(toastMocks.loading).toHaveBeenCalledWith('再読み込み中…', {
      id: 'page-reload',
      position: 'bottom-left',
      duration: Number.POSITIVE_INFINITY,
    })
  })
})
