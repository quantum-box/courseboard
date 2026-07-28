import type { DeepPartial } from '../../types'
import type { download as source } from '../ja/download'

export const download: DeepPartial<typeof source> = {
  hero: {
    title: 'Run the course from the machine you already use.',
    subtitle: 'Download the desktop version of Course Board.',
  },
  desktop: {
    title: 'Desktop app',
    latest: 'Download the latest →',
  },
  mac: 'For Apple silicon Macs',
  windows: 'For Windows 10 and 11',
  mobile: {
    title: 'Mobile app',
    description: 'iPhone and iPad on the App Store, Android on Google Play — rolling out in stages.',
  },
  releaseNotes: 'Release notes and checksums',
}
