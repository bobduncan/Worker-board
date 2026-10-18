// B319: the Workers mod is installed once per PC, also when two projects' boards run on it. Setup never installs over
// a newer copy, and leaves a copy that came from another board's folder to that folder. A board whose folder carries
// another version than the PC runs says so on top of its page. Made-up versions and folders only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { MARKETPLACE, MOD, compareVersions, installedVersion, modVersions, pluginsFile, setupPlan } from '../src/setup.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BOARD_ID = `${MOD}@${MARKETPLACE}`
const modsDir = 'D:\\Work\\beta\\worker-board\\mods'
const copy = version => ({ id: BOARD_ID, marketplace: MARKETPLACE, version, scope: 'user', isOn: true })

test('compareVersions: by number, part by part', () => {
  assert.ok(compareVersions('0.13.10', '0.13.9') > 0)
  assert.ok(compareVersions('0.9.1', '0.10.0') < 0)
  assert.equal(compareVersions('1.2', '1.2.0'), 0)
})

test('the plan never installs over a newer Workers mod', () => {
  const newer = setupPlan({ copies: [copy('0.14.0')], known: null, modsDir, version: '0.13.5', platform: 'win32' })
  assert.deepEqual([newer.calls, newer.problem, newer.isRestart], [[], null, false])
  assert.match(newer.lines.join('\n'), /0\.14\.0.*newer than the 0\.13\.5 this board carries.*leaves it/s)
})

test('the plan leaves a copy from another board\'s folder to that folder, also when this board carries a newer one', () => {
  const other = { name: MARKETPLACE, path: 'C:\\Work\\alpha\\worker-board\\mods' }
  const older = setupPlan({ copies: [copy('0.13.0')], known: other, modsDir, version: '0.13.5', platform: 'win32' })
  assert.deepEqual([older.calls, older.problem], [[], null])
  const said = older.lines.join('\n')
  assert.ok(said.includes(other.path) && said.includes('0.13.0') && said.includes('0.13.5'), said)
  // From this board's own folder it is updated as before.
  const own = setupPlan({ copies: [copy('0.13.0')], known: { name: MARKETPLACE, path: modsDir }, modsDir, version: '0.13.5', platform: 'win32' })
  assert.deepEqual(own.calls, [['plugin', 'marketplace', 'update', MARKETPLACE], ['plugin', 'update', BOARD_ID]])
})

test('installedVersion: the Workers mod as the app\'s list of installed plugins names it', () => {
  const list = { version: 2, plugins: {
    'superpowers@claude-plugins-official': [{ scope: 'user', version: '7.0.0' }],
    [BOARD_ID]: [{ scope: 'user', installPath: 'C:\\x', version: '0.13.5' }],
  } }
  assert.deepEqual(installedVersion(JSON.stringify(list)), { id: BOARD_ID, version: '0.13.5' })
  assert.deepEqual(installedVersion(JSON.stringify({ version: 2, plugins: { 'folder-branches@team-mods': [{ version: '0.9.0' }] } })), { id: 'folder-branches@team-mods', version: '0.9.0' })
  // A list without it: not installed. No list, or one that cannot be read: nobody can tell (undefined).
  assert.equal(installedVersion(JSON.stringify({ version: 2, plugins: {} })), null)
  for (const unknown of ['', 'not json', '[]', '{"plugins":3}']) assert.equal(installedVersion(unknown), undefined, unknown)
})

test('pluginsFile: the app\'s list in the person\'s .claude folder, or where CLAUDE_CONFIG_DIR says', () => {
  assert.equal(pluginsFile({}), join(homedir(), '.claude', 'plugins', 'installed_plugins.json'))
  assert.equal(pluginsFile({ CLAUDE_CONFIG_DIR: 'E:\\claude' }), join('E:\\claude', 'plugins', 'installed_plugins.json'))
})

test('modVersions: what this board\'s folder carries, what the PC runs, and from which folder it came', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-mod-version-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'installed_plugins.json')
  const markets = join(dir, 'known_marketplaces.json')
  const modsDir = join(ROOT, 'mods')
  const carried = JSON.parse(await readFile(join(modsDir, MOD, '.claude-plugin', 'plugin.json'), 'utf8')).version
  assert.deepEqual(await modVersions({ modsDir, file, markets }), { carried, installed: undefined, from: null, isHere: false })
  await writeFile(file, JSON.stringify({ version: 2, plugins: { [BOARD_ID]: [{ version: '0.1.0' }] } }))
  assert.deepEqual(await modVersions({ modsDir, file, markets }), { carried, installed: '0.1.0', from: null, isHere: false })
  // The app's list of marketplaces says where the board's marketplace is: this board's folder, or another's.
  const known = path => writeFile(markets, JSON.stringify({ [MARKETPLACE]: { source: { source: 'directory', path }, installLocation: path } }))
  await known(modsDir.toUpperCase())
  assert.deepEqual(await modVersions({ modsDir, file, markets }), { carried, installed: '0.1.0', from: modsDir.toUpperCase(), isHere: process.platform === 'win32' })
  await known('C:\\Work\\alpha\\worker-board\\mods')
  assert.deepEqual(await modVersions({ modsDir, file, markets }), { carried, installed: '0.1.0', from: 'C:\\Work\\alpha\\worker-board\\mods', isHere: false })
  await writeFile(file, JSON.stringify({ version: 2, plugins: {} }))
  assert.equal((await modVersions({ modsDir, file, markets })).installed, null)
  await mkdir(join(dir, 'mods'))
  assert.equal((await modVersions({ modsDir: join(dir, 'mods'), file, markets })).carried, null)
})

// The note on top of the page.

const PUBLIC = join(ROOT, 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('modnote')}\nthis.modNote = modNote`, page)

test('the page says so when the board carries another Workers mod than the PC runs', () => {
  // The same version, the demo (no mod), or a PC whose list cannot be read: nothing to say.
  for (const quiet of [{ carried: '0.13.5', installed: '0.13.5' }, null, undefined, { carried: '0.13.5' }, { carried: null, installed: '0.13.5' }]) {
    assert.equal(page.modNote(quiet), null, JSON.stringify(quiet))
  }
  const older = page.modNote({ carried: '0.13.5', installed: '0.13.0', from: 'D:\\board\\mods', isHere: true })
  assert.equal(older.tone, 'problem')
  assert.match(older.text, /carries the Workers mod 0\.13\.5.*this PC runs 0\.13\.0.*npm run setup in this board's folder.*quit the Claude app/s)
  // Installed from another board's folder: setup runs there, not here.
  const elsewhere = page.modNote({ carried: '0.13.5', installed: '0.13.0', from: 'C:\\Work\\alpha\\worker-board\\mods', isHere: false })
  assert.match(elsewhere.text, /installed from C:\\Work\\alpha\\worker-board\\mods.*bring that folder up to date.*npm run setup there/s)
  const newer = page.modNote({ carried: '0.13.0', installed: '0.14.0' })
  assert.equal(newer.tone, 'info')
  assert.match(newer.text, /0\.14\.0.*newer.*keeps it/s)
  const none = page.modNote({ carried: '0.13.5', installed: null })
  assert.equal(none.tone, 'problem')
  assert.match(none.text, /not installed.*npm run setup/s)
  // Its place on top of the page, beside the other notes.
  assert.match(html, /<p class="app-note" id="mod-note" role="status" hidden><\/p>/)
  assert.ok(script.includes('drawModNote(state)'))
})
