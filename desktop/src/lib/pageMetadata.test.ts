// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { i18next } from '../i18n'
import { applyPageMetadata, metadataForRoute } from './pageMetadata'

beforeEach(async () => {
  await i18next.changeLanguage('ja')
  document.head.innerHTML = `
    <title>Course Board</title>
    <meta name="description" content="initial">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <meta name="googlebot" content="noindex, nofollow, noarchive">
  `
})

describe('metadataForRoute', () => {
  const protectedRoutes = [
    'golf',
    'golf/ledger',
    'golf/courses',
    'golf/courses/course-1',
    'golf/products',
    'golf/products/service-1',
    'golf/reservation-products',
    'golf/reservation-products/service-1',
    'golf/reservation-report-import',
    'golf/timeline',
    'golf/caddies',
    'golf/caddies/caddie-1',
    'golf/caddies/dispatch',
    'golf/caddies/attendance',
    'golf/caddies/shifts',
    'golf/caddies/payroll',
    'golf/customers',
    'golf/customers/customer-1',
    'golf/customers/reception',
    'golf/customers/call-list',
    'golf/customers/cancellations',
    'golf/budgets',
    'golf/policy',
    'golf/settlement',
    'golf/simulator',
    'cancellation-fees',
    'cancellation-fees/new',
    'cancellation-fees/invoice-1',
    'course-map',
    'staff',
    'staff/staff-1',
    'settings',
    'settings/advanced',
    'settings/members',
    'settings/reception-fields',
  ]

  it('makes only the public download page indexable', () => {
    const metadata = metadataForRoute('download', 'https://preview.example')

    expect(metadata).toMatchObject({
      title: 'Course Board をダウンロード',
      robots: 'index, follow',
      canonicalUrl: 'https://preview.example/download',
      openGraph: {
        url: 'https://preview.example/download',
        imageUrl: 'https://preview.example/brand/courseboard-favicon-light-rounded.png',
        locale: 'ja_JP',
      },
    })
  })

  it.each([
    ['golf/ledger', '予約台帳 | Course Board'],
    ['golf/customers/customer-1', '顧客台帳 | Course Board'],
    ['golf/reservation-products/product-1', 'プレー商品 | Course Board'],
    ['pay/private-token', 'キャンセル料のお支払い | Course Board'],
  ])('keeps %s private and gives it a page title', (route, title) => {
    const metadata = metadataForRoute(route)

    expect(metadata.title).toBe(title)
    expect(metadata.robots).toBe('noindex, nofollow, noarchive')
    expect(metadata.canonicalUrl).toBeUndefined()
    expect(metadata.openGraph).toBeUndefined()
  })

  it.each(protectedRoutes)('recognises protected route %s', route => {
    const metadata = metadataForRoute(route)

    expect(metadata.title).not.toBe('画面が見つかりません | Course Board')
    expect(metadata.description).not.toBe('この画面は移動したか、なくなりました。')
    expect(metadata.robots).toBe('noindex, nofollow, noarchive')
    expect(metadata.canonicalUrl).toBeUndefined()
    expect(metadata.openGraph).toBeUndefined()
  })

  it('uses not-found copy for an unknown route', () => {
    expect(metadataForRoute('missing-page')).toMatchObject({
      title: '画面が見つかりません | Course Board',
      description: 'この画面は移動したか、なくなりました。',
      robots: 'noindex, nofollow, noarchive',
    })
  })

  it('follows the active locale', async () => {
    await i18next.changeLanguage('en')

    expect(metadataForRoute('golf/ledger').title).toBe('Start ledger | Course Board')
    expect(metadataForRoute('download').openGraph?.locale).toBe('en_US')
  })
})

describe('applyPageMetadata', () => {
  it('writes canonical and social metadata for the public page', () => {
    applyPageMetadata(metadataForRoute('download'))

    expect(document.title).toBe('Course Board をダウンロード')
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content'))
      .toContain('Mac・Windows')
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content'))
      .toBe('index, follow')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://courseboard.txcloud.app/download')
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content'))
      .toBe('Course Board をダウンロード')
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content'))
      .toBe('summary')
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content'))
      .toBe('https://courseboard.txcloud.app/brand/courseboard-favicon-light-rounded.png')
  })

  it('removes public-only metadata after navigating to a private page', () => {
    applyPageMetadata(metadataForRoute('download'))
    applyPageMetadata(metadataForRoute('golf/ledger'))

    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.querySelector('meta[property^="og:"]')).toBeNull()
    expect(document.querySelector('meta[name^="twitter:"]')).toBeNull()
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content'))
      .toBe('noindex, nofollow, noarchive')
  })
})
