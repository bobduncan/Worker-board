// Workers mod 0.30.0 (0.29.0 and 0.28.0 before it): the version stands the same in the plugin's manifest and in the mod's code (the header every call to
// the board carries), and the manifest's release note names what this release does.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const mod = path => fileURLToPath(new URL(`../mods/workers/${path}`, import.meta.url))

test('0.30.0 stands in the manifest and in MOD_VERSION, and the release note says what it does', async () => {
  const manifest = JSON.parse(await readFile(mod('.claude-plugin/plugin.json'), 'utf8'))
  const code = (await readFile(mod('hooks/board.ts'), 'utf8')).match(/export const MOD_VERSION = '([^']+)'/)?.[1]
  assert.equal(manifest.version, '0.30.0')
  assert.equal(code, manifest.version)
  for (const part of ['0.28.0:', 'board\'s own status', '(board not reached)', 'Product owner', 'RESTARTING envelope', '0.29.0:', 'asset action', '0.30.0:', 'turn runs on', 'typedAt and enteredAt', 'two missed pings', 'Monitor']) assert.ok(manifest.description.includes(part), part)
})
