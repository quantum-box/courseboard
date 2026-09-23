import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const releaseBaseUrl = (
  import.meta.env.VITE_COURSEBOARD_DESKTOP_RELEASE_BASE_URL
  ?? 'https://downloads.courseboard.txcloud.app'
).replace(/\/$/, '')

const desktopDownloads = [
  {
    name: 'macOS（Apple Silicon）',
    descriptionKey: 'mac',
    href: `${releaseBaseUrl}/releases/latest/courseboard-macos-arm64.dmg`,
  },
  {
    name: 'Windows（64-bit）',
    descriptionKey: 'windows',
    href: `${releaseBaseUrl}/releases/latest/courseboard-windows-x64.msi`,
  },
]

export function DownloadPage() {
  const { t } = useTranslation(['download'])
  return (
    <main className="download-page">
      <div className="download-shell">
        <header className="download-header">
          <p>COURSE BOARD</p>
          <h1>{t('download:hero.title')}</h1>
          <span>{t('download:hero.subtitle')}</span>
        </header>

        <section aria-labelledby="desktop-downloads">
          <h2 id="desktop-downloads">{t('download:desktop.title')}</h2>
          <div className="download-grid">
            {desktopDownloads.map(download => (
              <a key={download.name} href={download.href} className="download-card">
                <Download aria-hidden="true" />
                <strong>{download.name}</strong>
                <span>{t(`download:${download.descriptionKey}` as 'download:mac')}</span>
                <small>{t('download:desktop.latest')}</small>
              </a>
            ))}
          </div>
        </section>

        <section className="download-mobile">
          <h2>{t('download:mobile.title')}</h2>
          <p>{t('download:mobile.description')}</p>
        </section>

        <a className="download-release-link" href={`${releaseBaseUrl}/releases/latest.json`}>
          {t('download:releaseNotes')}
        </a>
      </div>
    </main>
  )
}
