import nativeUiPreset from '@tachyon-sdk/native-ui/src/tailwind-preset'
import type { Config } from 'tailwindcss'

export default {
  presets: [nativeUiPreset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './node_modules/@tachyon-sdk/native-ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config
