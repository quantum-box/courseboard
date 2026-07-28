import type { DeepPartial } from '../../types'
import type { download as source } from '../ja/download'

/** See `ja-plain/common.ts` for what this locale is for. */
export const download: DeepPartial<typeof source> = {
  hero: {
    title: 'いつものパソコンで、コースの仕事を。',
    subtitle: 'パソコンに入れて使う Course Board を、ここから受け取れます。',
  },
  desktop: {
    title: 'パソコンで使う',
    latest: '最新のものを受け取る →',
  },
  mac: 'M1 以降の Mac 用',
  windows: 'Windows 10・11 用',
  mobile: {
    title: 'スマートフォンで使う',
    description: 'iPhone と iPad は App Store、Android は Google Play で、順に公開していきます。',
  },
  releaseNotes: '更新の記録',
}
