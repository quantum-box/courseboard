import type { DeepPartial } from '../../types'
import type { map as source } from '../ja/map'

/** See `ja-plain/common.ts` for what this locale is for. */
export const map: DeepPartial<typeof source> = {
  status: {
    live: 'カートの今の場所を出しています · {{n}}台',
    mock: 'お試しの表示です · {{n}}台',
    connecting: 'つないでいます…',
    offline: 'つながっていません',
  },
  source: {
    mock: '画面を確かめるためのお試しの表示です',
    desktop: 'コースにある機械から場所を受け取っています',
  },
}
