import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('create-updater-manifest', () => {
  it('writes a Tauri v2 static updater manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'courseboard-updater-'))
    const archive = join(directory, 'Course Board.app.tar.gz')
    const signature = `${archive}.sig`
    const output = join(directory, 'latest.json')
    await writeFile(archive, 'archive')
    await writeFile(signature, 'signed-value\n')

    const result = spawnSync(
      process.execPath,
      [
        'scripts/create-updater-manifest.mjs',
        '0.2.0',
        archive,
        signature,
        output,
        'https://downloads.example/releases/0.2.0/courseboard-macos-arm64.app.tar.gz',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    const manifest = JSON.parse(await readFile(output, 'utf8'))
    expect(manifest.version).toBe('0.2.0')
    expect(manifest.platforms['darwin-aarch64']).toEqual({
      signature: 'signed-value',
      url: 'https://downloads.example/releases/0.2.0/courseboard-macos-arm64.app.tar.gz',
    })
  })
})
