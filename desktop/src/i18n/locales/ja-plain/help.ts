import type { DeepPartial } from '../../types'
import type { help as source } from '../ja/help'

/** See `ja-plain/common.ts` for what this locale is for. */
export const help: DeepPartial<typeof source> = {
  panel: {
    ariaLabel: '{{title}} の使い方',
    resize: 'この案内の幅を変える',
    usage: 'この画面ですること',
    data: 'この画面に出てくることば',
  },
}
