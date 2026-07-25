import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const [version, archivePath, signaturePath, outputPath, downloadUrl] = process.argv.slice(2)

if (!version || !archivePath || !signaturePath || !outputPath || !downloadUrl) {
  console.error(
    'Usage: node create-updater-manifest.mjs <version> <archive> <signature> <output> <download-url>',
  )
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid semantic version: ${version}`)
}

const signature = (await readFile(resolve(signaturePath), 'utf8')).trim()
if (!signature) throw new Error('Updater signature is empty')

const manifest = {
  version,
  notes: `Course Board ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-aarch64': {
      signature,
      url: downloadUrl,
    },
  },
}

await writeFile(resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${basename(outputPath)} for ${basename(archivePath)}`)
