import type { DeepPartial } from '../../types'
import type { help as source } from '../ja/help'

export const help: DeepPartial<typeof source> = {
  panel: {
    kicker: 'Guide',
    ariaLabel: 'How to use {{title}}',
    close: 'Close the guide',
    resize: 'Change the width',
    usage: 'What you do here',
    data: 'Words on this page',
  },
}
