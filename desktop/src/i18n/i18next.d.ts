import type { Resources } from './locales/ja'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: Resources
    returnNull: false
  }
}
