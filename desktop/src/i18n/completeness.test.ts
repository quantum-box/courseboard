import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { ja } from './locales/ja'
import { jaPlain } from './locales/ja-plain'

type Tree = { [key: string]: unknown }

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') entries.set(path, value)
    else if (value && typeof value === 'object') {
      for (const [nested, text] of flatten(value as Tree, path)) entries.set(nested, text)
    }
  }
  return entries
}

function placeholders(text: string) {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort()
}

const jaKeys = flatten(ja as unknown as Tree)
const enKeys = flatten(en as unknown as Tree)
const plainKeys = flatten(jaPlain as unknown as Tree)

describe('translation catalogues', () => {
  it('translates every Japanese key into English', () => {
    const missing = [...jaKeys.keys()].filter(key => !enKeys.has(key))
    expect(missing).toEqual([])
  })

  it('defines no key that Japanese does not have', () => {
    // ja is the source of truth; a stray key would silently never render.
    expect([...enKeys.keys()].filter(key => !jaKeys.has(key))).toEqual([])
    expect([...plainKeys.keys()].filter(key => !jaKeys.has(key))).toEqual([])
  })

  it('keeps interpolation placeholders identical across locales', () => {
    const mismatched: string[] = []
    for (const [key, source] of jaKeys) {
      for (const [name, catalogue] of [['en', enKeys], ['ja-plain', plainKeys]] as const) {
        const translated = catalogue.get(key)
        if (translated === undefined) continue
        if (placeholders(source).join(',') !== placeholders(translated).join(',')) {
          mismatched.push(`${name}:${key}`)
        }
      }
    }
    expect(mismatched).toEqual([])
  })

  it('leaves no empty strings', () => {
    for (const [name, catalogue] of [['ja', jaKeys], ['en', enKeys], ['ja-plain', plainKeys]] as const) {
      const empty = [...catalogue.entries()].filter(([, text]) => text.trim() === '')
      expect(empty, `${name} has empty values`).toEqual([])
    }
  })

  it('rewrites the copy that carries meaning into plain Japanese', () => {
    // ja-plain deliberately omits words that would read the same as ja (buttons
    // like 開く, 閉じる) and leans on the fallback. What it must not skip is the
    // prose that explains a screen — that is the whole point of the locale.
    const prose = [...jaKeys.keys()].filter(key => /(description|summary|message|body)$/i.test(key))
    const skipped = prose.filter(key => !plainKeys.has(key))
    expect(skipped).toEqual([])
  })
})
