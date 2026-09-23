#!/usr/bin/env node
// Regenerates src/i18n/locales/<locale>/index.ts from the namespace files in
// each locale directory. Run after adding or removing a namespace.
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales')

const EXPORTS = { ja: 'ja', en: 'en', 'ja-plain': 'jaPlain' }

const jaNamespaces = namespacesOf('ja')

function namespacesOf(locale) {
  return readdirSync(join(root, locale))
    .filter(file => file.endsWith('.ts') && file !== 'index.ts')
    .map(file => file.replace(/\.ts$/, ''))
    .sort()
}

for (const [locale, exportName] of Object.entries(EXPORTS)) {
  const available = new Set(namespacesOf(locale))
  const missing = jaNamespaces.filter(ns => !available.has(ns))
  if (missing.length > 0) {
    console.warn(`[i18n] ${locale} is missing: ${missing.join(', ')} (falls back to ja)`)
  }
  const used = jaNamespaces.filter(ns => available.has(ns))
  const header = locale === 'ja'
    ? '\n/** Japanese is the source of truth: every key must exist here first. */'
    : ''
  const footer = locale === 'ja'
    ? '\n\nexport type Resources = typeof ja\nexport type Namespace = keyof Resources'
    : ''
  const body = [
    ...used.map(ns => `import { ${camel(ns)} } from './${ns}'`),
    header,
    `export const ${exportName} = {`,
    ...used.map(ns => `  ${camel(ns)},`),
    locale === 'ja' ? '} as const' : '}',
  ].join('\n')
  writeFileSync(join(root, locale, 'index.ts'), `${body}${footer}\n`)
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

console.log(`[i18n] wrote index for ${Object.keys(EXPORTS).length} locales, ${jaNamespaces.length} namespaces`)
