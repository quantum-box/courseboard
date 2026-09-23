/** Translation trees are plain nested string maps; ja is the source of truth. */
export type TranslationTree = { [key: string]: string | TranslationTree }

/**
 * `en` and `ja-plain` may omit keys — i18next falls back to `ja` — so their
 * modules are typed against a deep-partial of the Japanese tree. Missing keys
 * are reported by `src/i18n/completeness.test.ts` instead of by the compiler,
 * which keeps a half-translated locale from blocking `tsc`.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]>
}
