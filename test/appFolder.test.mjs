// B135: the board finds the Claude app's own folder per system when the settings do not name it: Windows, also the
// Microsoft Store app's package folder, a Mac and Linux; a setting of its own wins. Made-up folders only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { appFolder, followApp, loadConfig } from '../src/config.mjs'

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
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const roaming = join(root, 'Roaming')
  await mkdir(join(roaming, 'Claude', 'claude-code-sessions'), { recursive: true })
  const file = join(root, 'config.json')
  await writeFile(file, '{ "port": 4399 }')
  const found = await loadConfig(file, { APPDATA: roaming }, 'win32')
  assert.deepEqual([found.appSessions, found.usageHistory, found.appFolder], [join(roaming, 'Claude', 'claude-code-sessions'), join(roaming, 'Claude', 'plan-usage-history.json'), join(roaming, 'Claude')])
  // B273: a set folder wins while it is there (one that is gone falls back to the search, below).
  const elsewhere = join(root, 'elsewhere')
  await mkdir(join(elsewhere, 'sessions'), { recursive: true })
  await writeFile(file, JSON.stringify({ appSessions: join(elsewhere, 'sessions'), usageHistory: join(elsewhere, 'usage.json') }))
  const set = await loadConfig(file, { APPDATA: roaming }, 'win32')
  assert.deepEqual([set.appSessions, set.usageHistory, set.appFolder, set.appMoved], [join(elsewhere, 'sessions'), join(elsewhere, 'usage.json'), undefined, undefined])
})

// B273: on 2026-10-17 the Store app moved its folder: %APPDATA%\Claude (and the package's Roaming\Claude) kept only a
// marker ".user-data-left.<id>", and the data went to %LOCALAPPDATA%\Claude-Data\<id>. The board found no chats.

/** A made-up file system by path: what each folder lists, and the folders that hold a list of chats. */
const tree = (folders, withSessions) => ({
  list: async path => {
    if (folders[path] === undefined) throw Object.assign(new Error('no folder'), { code: 'ENOENT' })
    return folders[path]
  },
  there: async path => withSessions.some(place => path === join(place, 'claude-code-sessions')),
})
const ENV = { APPDATA: 'C:/U/AppData/Roaming', LOCALAPPDATA: 'C:/U/AppData/Local' }
const ROAMING = join(ENV.APPDATA, 'Claude')
const PACKAGE = join(ENV.LOCALAPPDATA, 'Packages', 'Claude_pkg1', 'LocalCache', 'Roaming', 'Claude')
const MOVED = join(ENV.LOCALAPPDATA, 'Claude-Data', 'claude_pkg1')

test('Windows: the app\'s folder is followed where its marker says it went', async () => {
  const folders = { [ROAMING]: ['.user-data-left.claude_pkg1'], [join(ENV.LOCALAPPDATA, 'Packages')]: ['Claude_pkg1'], [PACKAGE]: ['.user-data-left.claude_pkg1'], [join(ENV.LOCALAPPDATA, 'Claude-Data')]: ['claude_pkg1'] }
  assert.equal(await appFolder(ENV, 'win32', tree(folders, [MOVED])), MOVED)
  // The folder that holds the marker is left behind, also when an old list of chats is still in it.
  assert.equal(await appFolder(ENV, 'win32', tree(folders, [ROAMING, MOVED])), MOVED)
  // A marker that names something odd is not followed out of Claude-Data.
  const odd = { [ROAMING]: ['.user-data-left.../../x'], [join(ENV.LOCALAPPDATA, 'Claude-Data')]: [] }
  assert.equal(await appFolder(ENV, 'win32', tree(odd, [join(ENV.LOCALAPPDATA, 'x')])), null)
})

test('Windows: without a marker, a folder in Claude-Data is found too, after the usual places', async () => {
  const folders = { [ROAMING]: [], [join(ENV.LOCALAPPDATA, 'Claude-Data')]: ['claude_pkg1'] }
  assert.equal(await appFolder(ENV, 'win32', tree(folders, [MOVED])), MOVED)
  assert.equal(await appFolder(ENV, 'win32', tree(folders, [ROAMING, MOVED])), ROAMING)
  assert.equal(await appFolder(ENV, 'win32', tree({}, [])), null, 'nothing there: nothing found')
})

test('a list of chats that is gone: the board searches again, follows it, and says from where to where', async () => {
  const config = { appSessions: join(ROAMING, 'claude-code-sessions'), usageHistory: join(ROAMING, 'plan-usage-history.json') }
  const look = { there: async () => false, exists: async () => false, find: async () => MOVED }
  assert.equal(await followApp(config, ENV, 'win32', { ...look, now: 1000 }), true)
  assert.deepEqual(config, {
    appSessions: join(MOVED, 'claude-code-sessions'), usageHistory: join(MOVED, 'plan-usage-history.json'), appFolder: MOVED,
    appMoved: { from: join(ROAMING, 'claude-code-sessions'), to: MOVED, at: 1000 }, appSearchedAt: 1000,
  })
  // Where it is now is there: nothing more happens.
  assert.equal(await followApp(config, ENV, 'win32', { ...look, there: async () => true, now: 2000 }), false)
})

test('a usage file of its own that still exists is kept; a list found nowhere is said too, and looked for again a minute later', async () => {
  const kept = { appSessions: 'D:/old/sessions', usageHistory: 'D:/mine/usage.json' }
  await followApp(kept, ENV, 'win32', { there: async () => false, exists: async () => true, find: async () => MOVED, now: 0 })
  assert.equal(kept.usageHistory, 'D:/mine/usage.json')
  assert.equal(kept.appSessions, join(MOVED, 'claude-code-sessions'))

  let looked = 0
  const lost = { appSessions: 'D:/old/sessions', usageHistory: 'D:/old/usage.json' }
  const look = { there: async () => false, exists: async () => false, find: async () => { looked += 1; return null } }
  assert.equal(await followApp(lost, ENV, 'win32', { ...look, now: 0 }), false)
  assert.deepEqual(lost.appMoved, { from: 'D:/old/sessions', to: null, at: 0 })
  await followApp(lost, ENV, 'win32', { ...look, now: 30_000 })
  assert.equal(looked, 1, 'not again within the minute')
  await followApp(lost, ENV, 'win32', { ...look, now: 61_000 })
  assert.equal(looked, 2)
  assert.equal(lost.appSessions, 'D:/old/sessions', 'nothing found: the setting stands')
  // Back where it was (an app update, a drive plugged in again): the note goes.
  await followApp(lost, ENV, 'win32', { ...look, there: async () => true, now: 200_000 })
  assert.equal(lost.appMoved, undefined)
  // Found where the setting already points: no note that it was found nowhere.
  const same = { appSessions: join(MOVED, 'claude-code-sessions'), usageHistory: 'D:/u.json' }
  assert.equal(await followApp(same, ENV, 'win32', { there: async () => false, exists: async () => true, find: async () => MOVED, now: 0 }), false)
  assert.equal(same.appMoved, undefined)
})

test('a setting that points at a folder that is gone falls back to the search when the board starts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'worker-board-app-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const local = join(root, 'Local')
  const moved = join(local, 'Claude-Data', 'claude_pkg9')
  await mkdir(join(moved, 'claude-code-sessions'), { recursive: true })
  await writeFile(join(moved, 'plan-usage-history.json'), '[]')
  await mkdir(join(root, 'Roaming', 'Claude'), { recursive: true })
  await writeFile(join(root, 'Roaming', 'Claude', '.user-data-left.claude_pkg9'), '')
  const file = join(root, 'config.json')
  const gone = join(root, 'Roaming', 'Claude', 'claude-code-sessions')
  await writeFile(file, JSON.stringify({ appSessions: gone, usageHistory: join(root, 'Roaming', 'Claude', 'plan-usage-history.json') }))
  const config = await loadConfig(file, { APPDATA: join(root, 'Roaming'), LOCALAPPDATA: local }, 'win32')
  assert.equal(config.appSessions, join(moved, 'claude-code-sessions'))
  assert.equal(config.usageHistory, join(moved, 'plan-usage-history.json'))
  assert.equal(config.appMoved.from, gone)
  assert.equal(config.appMoved.to, moved)
})

test('the page says that the app\'s folder moved, and where the board found it', async () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const [script, html, style, server] = await Promise.all([
    readFile(join(here, '..', 'public', 'board.js'), 'utf8'), readFile(join(here, '..', 'public', 'index.html'), 'utf8'),
    readFile(join(here, '..', 'public', 'board.css'), 'utf8'), readFile(join(here, '..', 'server.mjs'), 'utf8'),
  ])
  // B467: as a loop, so a failed search shows and is logged.
  assert.match(server, /await loops\.run\('app-folder', \(\) => followApp\(config, process\.env, process\.platform\)\)\n\s+return readSources\(config, folders, undefined, branches, work\)/)
  assert.match(server, /appMoved: isDemo \? null : config\.appMoved \?\? null/, 'the demo shows no note about the real app')
  assert.match(html, /<p class="app-note" id="app-note" role="status" hidden><\/p>/)
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// appnote:start'), script.indexOf('// appnote:end'))}\nthis.appNote = appNote`, page)
  const clock = at => new Date(at).toISOString().slice(11, 16)
  assert.equal(page.appNote(null, clock), null)
  assert.equal(page.appNote({ from: 'D:/old/sessions', to: 'D:/new', at: Date.UTC(2026, 9, 17, 8, 57) }, clock).text,
    'The Claude app\'s folder moved: found it at D:/new (08:57). The board reads the chats from there, no longer from D:/old/sessions.')
  const lost = page.appNote({ from: 'D:/old/sessions', to: null, at: 0 }, clock)
  assert.equal(lost.tone, 'problem')
  assert.match(lost.text, /^The Claude app's list of chats is gone from D:\/old\/sessions/)
  assert.match(style, /\.app-note \{/)
})
