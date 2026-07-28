import type { DeepPartial } from '../../types'
import type { map as source } from '../ja/map'

export const map: DeepPartial<typeof source> = {
  status: {
    live: 'Showing cart positions · {{n}} carts',
    mock: 'Showing test data · {{n}} carts',
    connecting: 'Connecting…',
    offline: 'Not connected',
  },
  demoCourseName: 'Soranuma Course',
  legend: {
    inProgress: 'On the round',
    delayed: 'Running late',
    waiting: 'Waiting',
  },
  source: {
    mock: 'Test data for the browser',
    desktop: 'Connected to the on-course trackers',
  },
}
