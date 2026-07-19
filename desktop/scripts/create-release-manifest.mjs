import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const [version, artifactsDirectory, outputPath, downloadBaseUrl] = process.argv.slice(2)

if (!version || !artifactsDirectory || !outputPath || !downloadBaseUrl) {
	console.error(
		'Usage: node create-release-manifest.mjs <version> <artifacts-dir> <output> <download-base-url>',
	)
	process.exit(1)
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
	throw new Error(`Invalid semantic version: ${version}`)
}

const artifactDirectory = resolve(artifactsDirectory)
const filenames = (await readdir(artifactDirectory)).sort()
const supportedArtifacts = filenames.filter((filename) =>
	/\.(?:dmg|msi|exe|AppImage)$/.test(filename),
)

if (supportedArtifacts.length === 0) {
	throw new Error(`No desktop installers found in ${artifactDirectory}`)
}

const baseUrl = downloadBaseUrl.replace(/\/$/, '')
const artifacts = {}

for (const filename of supportedArtifacts) {
	const contents = await readFile(join(artifactDirectory, filename))
	const platform = filename
		.replace(/^courseboard-/, '')
		.replace(/\.(?:dmg|msi|exe|AppImage)$/, '')

	artifacts[platform] = {
		filename,
		url: `${baseUrl}/releases/${version}/${encodeURIComponent(filename)}`,
		size: contents.byteLength,
		sha256: createHash('sha256').update(contents).digest('hex'),
	}
}

const manifest = {
	schemaVersion: 1,
	product: 'Course Board',
	version,
	publishedAt: new Date().toISOString(),
	artifacts,
}

await writeFile(resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${basename(outputPath)} with ${supportedArtifacts.length} artifact(s)`)
