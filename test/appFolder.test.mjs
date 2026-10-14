// B135: the board finds the Claude app's own folder per system when the settings do not name it: Windows, also the
// Microsoft Store app's package folder, a Mac and Linux; a setting of its own wins. Made-up folders only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { appFolder, loadConfig } from '../src/config.mjs'

/** A made-up file system: the folders that hold a list of chats, and what each Packages folder lists. */
const fake = (withSessions, packages = []) => ({
  list: async () => packages,
  there: async path => withSessions.some(place => path === join(place, 'claude-code-sessions')),
})

test('Windows: the app\'s folder in APPDATA first, else the Store app\'s package folder', async () => {
  const env = { APPDATA: 'C:/U/AppData/Roaming', LOCALAPPDATA: 'C:/U/AppData/Local' }
  const roaming = join('C:/U/AppData/Roaming', 'Claude')
  const store = join('C:/U/AppData/Local', 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude')
  assert.equal(await appFolder(env, 'win32', fake([roaming, store], ['Claude_abc123'])), roaming)
  assert.equal(await appFolder(env, 'win32', fake([store], ['Other_x', 'Claude_abc123'])), store)
  assert.equal(await appFolder(env, 'win32', fake([], ['Claude_abc123'])), null)
})

test('a Mac and Linux: the app\'s folder under the home folder', async () => {
  const mac = join('/Users/sam', 'Library', 'Application Support', 'Claude')
  assert.equal(await appFolder({ HOME: '/Users/sam' }, 'darwin', fake([mac])), mac)
  const linux = join('/home/sam', '.config', 'Claude')
  assert.equal(await appFolder({ HOME: '/home/sam' }, 'linux', fake([linux])), linux)
  assert.equal(await appFolder({}, 'darwin', fake([mac])), null)
})

test('the settings: the found folder fills what is not set; what is set wins', async t => {
  const root = await mkdtemp(join(tmpdir(), 'worker-board-app-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const roaming = join(root, 'Roaming')
  await mkdir(join(roaming, 'Claude', 'claude-code-sessions'), { recursive: true })
  const file = join(root, 'config.json')
  await writeFile(file, '{ "port": 4399 }')
  const found = await loadConfig(file, { APPDATA: roaming }, 'win32')
  assert.deepEqual([found.appSessions, found.usageHistory, found.appFolder], [join(roaming, 'Claude', 'claude-code-sessions'), join(roaming, 'Claude', 'plan-usage-history.json'), join(roaming, 'Claude')])
  await writeFile(file, JSON.stringify({ appSessions: 'D:/elsewhere/sessions', usageHistory: 'D:/elsewhere/usage.json' }))
  const set = await loadConfig(file, { APPDATA: roaming }, 'win32')
  assert.deepEqual([set.appSessions, set.usageHistory, set.appFolder], ['D:/elsewhere/sessions', 'D:/elsewhere/usage.json', undefined])
})
