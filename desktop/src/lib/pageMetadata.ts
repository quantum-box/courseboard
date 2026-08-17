import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { isKnownAppRoute, routeDescription, routeTitle } from '../components/AppShell'
import { i18next } from '../i18n'

const MANAGED_ATTRIBUTE = 'data-courseboard-metadata'
const INDEXABLE_ROBOTS = 'index, follow'
const PRIVATE_ROBOTS = 'noindex, nofollow, noarchive'
const OFFICIAL_SITE_ORIGIN = 'https://courseboard.txcloud.app'

export interface PageMetadata {
  title: string
  description: string
  robots: typeof INDEXABLE_ROBOTS | typeof PRIVATE_ROBOTS
  canonicalUrl?: string
  openGraph?: {
    title: string
    description: string
    url: string
    imageUrl: string
    locale: 'ja_JP' | 'en_US'
  }
}

function pageTitle(title: string) {
  const appName = i18next.t('common:app.name')
  return title === appName ? appName : `${title} | ${appName}`
}

function absoluteUrl(path: string, origin: string) {
  return new URL(path, origin.endsWith('/') ? origin : `${origin}/`).href
}

export function metadataForRoute(route: string, siteOrigin = OFFICIAL_SITE_ORIGIN): PageMetadata {
  if (route === 'download') {
    const url = absoluteUrl('/download', siteOrigin)
    const title = i18next.t('download:meta.title')
    const description = i18next.t('download:meta.description')
    return {
      title,
      description,
      robots: INDEXABLE_ROBOTS,
      canonicalUrl: url,
      openGraph: {
        title,
        description,
        url,
        imageUrl: absoluteUrl('/brand/courseboard-favicon-light-rounded.png', siteOrigin),
        locale: i18next.language === 'en' ? 'en_US' : 'ja_JP',
      },
    }
  }

  if (route.startsWith('pay/')) {
    return {
      title: pageTitle(i18next.t('payment:title')),
      description: i18next.t('payment:meta.description'),
      robots: PRIVATE_ROBOTS,
    }
  }

  if (!isKnownAppRoute(route)) {
    return {
      title: pageTitle(i18next.t('nav:notFound.title')),
      description: i18next.t('nav:notFound.description'),
      robots: PRIVATE_ROBOTS,
    }
  }

  return {
    title: pageTitle(routeTitle(route)),
    description: routeDescription(route),
    robots: PRIVATE_ROBOTS,
  }
}

function managedElement<T extends Element>(selector: string, create: () => T): T {
  const existing = document.head.querySelector<T>(selector)
  if (existing) return existing
  const element = create()
  element.setAttribute(MANAGED_ATTRIBUTE, '')
  document.head.append(element)
  return element
}

function setNamedMeta(name: string, content: string) {
  const element = managedElement(`meta[name="${name}"]`, () => {
    const meta = document.createElement('meta')
    meta.name = name
    return meta
  })
  element.setAttribute('content', content)
}

function setPropertyMeta(property: string, content: string) {
  const element = managedElement(`meta[property="${property}"]`, () => {
    const meta = document.createElement('meta')
    meta.setAttribute('property', property)
    return meta
  })
  element.setAttribute('content', content)
}

function removeOptionalMetadata() {
  document.head.querySelectorAll(
    `link[rel="canonical"][${MANAGED_ATTRIBUTE}], meta[property][${MANAGED_ATTRIBUTE}], meta[name^="twitter:"][${MANAGED_ATTRIBUTE}]`,
  ).forEach(element => element.remove())
}

export function applyPageMetadata(metadata: PageMetadata) {
  document.title = metadata.title
  setNamedMeta('description', metadata.description)
  setNamedMeta('robots', metadata.robots)
  setNamedMeta('googlebot', metadata.robots)
  removeOptionalMetadata()

  if (!metadata.canonicalUrl || !metadata.openGraph) return

  const canonical = managedElement('link[rel="canonical"]', () => {
    const link = document.createElement('link')
    link.rel = 'canonical'
    return link
  })
  canonical.setAttribute(MANAGED_ATTRIBUTE, '')
  canonical.setAttribute('href', metadata.canonicalUrl)

  setPropertyMeta('og:type', 'website')
  setPropertyMeta('og:site_name', i18next.t('common:app.name'))
  setPropertyMeta('og:title', metadata.openGraph.title)
  setPropertyMeta('og:description', metadata.openGraph.description)
  setPropertyMeta('og:url', metadata.openGraph.url)
  setPropertyMeta('og:locale', metadata.openGraph.locale)
  setPropertyMeta('og:image', metadata.openGraph.imageUrl)
  setPropertyMeta('og:image:width', '512')
  setPropertyMeta('og:image:height', '512')
  setPropertyMeta('og:image:alt', i18next.t('common:app.name'))
  setNamedMeta('twitter:card', 'summary')
  setNamedMeta('twitter:title', metadata.openGraph.title)
  setNamedMeta('twitter:description', metadata.openGraph.description)
  setNamedMeta('twitter:image', metadata.openGraph.imageUrl)
}

export function PageMetadata({ route }: { route: string }) {
  const { i18n } = useTranslation()

  useEffect(() => {
    applyPageMetadata(metadataForRoute(route))
  }, [route, i18n.language])

  return null
}
