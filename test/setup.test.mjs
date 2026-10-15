// B251: `npm run setup` installs the Workers mod from the board's own folder (`mods/`) with the Claude app's own
// command-line program, which the app does not put on the PATH. A project folder cannot bring the mod by itself: the
// app loads a project's plugin only after the trust question for that exact folder, and it never asks it (tried
// 2026-10-15). A copy installed already, from any source, is recognised and no second copy is installed.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { MARKETPLACE, MOD, findClaude, installedCopies, knownMarketplace, runSetup, setupPlan } from '../src/setup.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODS = join(ROOT, 'mods')
const FAKE = [process.execPath, join(ROOT, 'fixtures', 'fake-claude.mjs')]
const BOARD_ID = `${MOD}@${MARKETPLACE}`

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'board-setup-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function program(dir, ...parts) {
  await mkdir(join(dir, ...parts.slice(0, -1)), { recursive: true })
  await writeFile(join(dir, ...parts), 'x')
  return join(dir, ...parts)
}

test('the board carries the Workers mod as a marketplace of one plugin, in its own folder', () => {
  const market = JSON.parse(readFileSync(join(MODS, '.claude-plugin', 'marketplace.json'), 'utf8'))
  assert.equal(market.name, MARKETPLACE)
  assert.equal(MARKETPLACE, 'worker-board')
  assert.equal(typeof market.description, 'string')
  assert.deepEqual(market.plugins.map(plugin => [plugin.name, plugin.source]), [[MOD, './folder-branches']])
  const manifest = JSON.parse(readFileSync(join(MODS, MOD, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(manifest.name, MOD)
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  const hooks = JSON.parse(readFileSync(join(MODS, MOD, 'hooks', 'hooks.json'), 'utf8'))
  for (const module of hooks.modules) assert.ok(existsSync(join(MODS, MOD, 'hooks', module)), module)
  // The engine writes its API types beside a mod when it loads it, anew on every PC: they stay out of git.
  assert.match(readFileSync(join(MODS, '.gitignore'), 'utf8'), /^\*\*\/\.claude-plugin\/types\/$/m)
})

test('setup finds the Claude app\'s own program: the newest under the app\'s folder, the Store app\'s, a Mac\'s, else the PATH', async t => {
  const home = await folder(t)
  const roaming = join(home, 'Roaming', 'Claude')
  await mkdir(join(roaming, 'claude-code-sessions'), { recursive: true })
  for (const [version, hash] of [['2.1.9', 'aaa'], ['2.1.10', 'bbb'], ['2.0.99', 'ccc']]) await program(roaming, 'claude-code', version, hash, 'claude.exe')
  // A newer version folder without the program in it is passed over.
  await mkdir(join(roaming, 'claude-code', '2.1.11', 'ddd'), { recursive: true })
  assert.equal(await findClaude({ env: { APPDATA: join(home, 'Roaming') }, platform: 'win32' }), join(roaming, 'claude-code', '2.1.10', 'bbb', 'claude.exe'))

  // From a shell the Microsoft Store app did not start, its folder is the package's.
  const local = join(home, 'Local')
  const store = join(local, 'Packages', 'Claude_x1y2z3', 'LocalCache', 'Roaming', 'Claude')
  await mkdir(join(store, 'claude-code-sessions'), { recursive: true })
  const fromStore = await program(store, 'claude-code', '3.0.0', 'eee', 'claude.exe')
  assert.equal(await findClaude({ env: { APPDATA: join(home, 'nothing'), LOCALAPPDATA: local }, platform: 'win32' }), fromStore)

  const mac = join(home, 'Library', 'Application Support', 'Claude')
  await mkdir(join(mac, 'claude-code-sessions'), { recursive: true })
  const onMac = await program(mac, 'claude-code', '1.0.0', 'fff', 'claude')
  assert.equal(await findClaude({ env: { HOME: home }, platform: 'darwin' }), onMac)

  // No app folder with the program: a `claude` installed apart, on the PATH.
  const bin = join(home, 'bin')
  const onPath = await program(bin, 'claude.cmd')
  assert.equal(await findClaude({ env: { Path: `${join(home, 'none')};${bin}` }, platform: 'win32' }), onPath)
  assert.equal(await findClaude({ env: {}, platform: 'win32' }), null)
})

test('what is installed: every copy of the Workers mod the program lists, from any marketplace, and the marketplaces', () => {
  const list = JSON.stringify([
    { id: 'folder-branches@team-mods', version: '0.9.0', scope: 'user', enabled: true, installPath: 'x' },
    { id: 'other-mod@team-mods', version: '1.0.0', scope: 'user', enabled: true },
    { id: 'folder-branches@worker-board', version: '0.9.1', scope: 'project', enabled: false },
  ])
  assert.deepEqual(installedCopies(list), [
    { id: 'folder-branches@team-mods', marketplace: 'team-mods', version: '0.9.0', scope: 'user', isOn: true },
    { id: 'folder-branches@worker-board', marketplace: 'worker-board', version: '0.9.1', scope: 'project', isOn: false },
  ])
  assert.deepEqual(installedCopies('[]'), [])
  // Words that are no list: setup cannot tell what is installed, and says so rather than install a second copy.
  for (const text of ['', 'Something went wrong', '{"id":"x"}']) assert.equal(installedCopies(text), null, text)

  const markets = JSON.stringify([{ name: 'team-mods', source: 'directory', path: 'D:\\Mods' }, { name: 'worker-board', source: 'directory', path: 'D:\\Board\\mods' }])
  assert.deepEqual(knownMarketplace(markets, 'worker-board'), { name: 'worker-board', path: 'D:\\Board\\mods' })
  assert.equal(knownMarketplace(markets, 'elsewhere'), null)
  assert.equal(knownMarketplace('not json', 'worker-board'), null)
})

test('the plan: install on a PC without the mod; nothing when a copy is on, from whatever source; update or turn on the board\'s own', () => {
  const modsDir = 'D:\\Work\\project\\worker-board\\mods'
  const base = { known: null, modsDir, version: '0.9.1', platform: 'win32' }
  const add = ['plugin', 'marketplace', 'add', modsDir]
  const install = ['plugin', 'install', BOARD_ID, '--scope', 'user']

  const fresh = setupPlan({ ...base, copies: [] })
  assert.deepEqual(fresh.calls, [add, install])
  assert.equal(fresh.problem, null)
  assert.equal(fresh.isRestart, true)

  // The board's marketplace is known from this same folder (the case and the slashes may differ): only the install.
  const known = setupPlan({ ...base, copies: [], known: { name: MARKETPLACE, path: 'd:/work/project/worker-board/mods/' } })
  assert.deepEqual(known.calls, [install])
  // Known from another folder: setup stops and names both, rather than install from the other one.
  const other = setupPlan({ ...base, copies: [], known: { name: MARKETPLACE, path: 'E:\\Old\\worker-board\\mods' } })
  assert.deepEqual(other.calls, [])
  assert.ok(other.problem.includes('E:\\Old\\worker-board\\mods') && other.problem.includes(modsDir), other.problem)

  // A copy that is on, from another marketplace: it is recognised, and no second copy goes in.
  const theirs = setupPlan({ ...base, copies: [{ id: 'folder-branches@team-mods', marketplace: 'team-mods', version: '0.9.0', scope: 'user', isOn: true }] })
  assert.deepEqual([theirs.calls, theirs.problem, theirs.isRestart], [[], null, false])
  assert.match(theirs.lines.join('\n'), /installed already.*folder-branches@team-mods.*0\.9\.0/s)

  const same = setupPlan({ ...base, copies: [{ id: BOARD_ID, marketplace: MARKETPLACE, version: '0.9.1', scope: 'user', isOn: true }] })
  assert.deepEqual([same.calls, same.isRestart], [[], false])
  assert.match(same.lines.join('\n'), /Nothing to do/)

  const older = setupPlan({ ...base, copies: [{ id: BOARD_ID, marketplace: MARKETPLACE, version: '0.8.0', scope: 'user', isOn: true }] })
  assert.deepEqual(older.calls, [['plugin', 'marketplace', 'update', MARKETPLACE], ['plugin', 'update', BOARD_ID]])
  assert.equal(older.isRestart, true)

  // A copy that is off is turned on, whichever marketplace it came from, rather than a second one installed.
  const off = setupPlan({ ...base, copies: [{ id: 'folder-branches@team-mods', marketplace: 'team-mods', version: '0.9.0', scope: 'user', isOn: false }] })
  assert.deepEqual([off.calls, off.isRestart], [[['plugin', 'enable', 'folder-branches@team-mods']], true])

  // Two copies on clash: setup says which, and changes nothing.
  const two = setupPlan({ ...base, copies: [
    { id: 'folder-branches@team-mods', marketplace: 'team-mods', version: '0.9.0', scope: 'user', isOn: true },
    { id: BOARD_ID, marketplace: MARKETPLACE, version: '0.9.1', scope: 'user', isOn: true },
  ] })
  assert.deepEqual(two.calls, [])
  assert.ok(two.problem.includes('folder-branches@team-mods') && two.problem.includes(BOARD_ID), two.problem)
})

async function fakeState(t, state) {
  const file = join(await folder(t), 'state.json')
  await writeFile(file, JSON.stringify({ plugins: [], marketplaces: [], calls: [], ...state }))
  process.env.FAKE_CLAUDE_STATE = file
  t.after(() => delete process.env.FAKE_CLAUDE_STATE)
  return async () => JSON.parse(await readFile(file, 'utf8'))
}

const commands = calls => calls.map(args => args.filter(arg => !arg.startsWith('-')).slice(0, 3).join(' '))

test('setup on a PC without the mod adds the board\'s marketplace, installs it for the person, checks it, and says to restart the app', async t => {
  const read = await fakeState(t, {})
  const done = await runSetup({ command: FAKE, modsDir: MODS })
  assert.equal(done.ok, true)
  const state = await read()
  assert.deepEqual(commands(state.calls), ['plugin list', 'plugin marketplace list', 'plugin marketplace add', 'plugin install ' + BOARD_ID, 'plugin list'])
  assert.deepEqual(state.calls[2], ['plugin', 'marketplace', 'add', MODS])
  assert.deepEqual(state.plugins.map(plugin => [plugin.id, plugin.enabled]), [[BOARD_ID, true]])
  const said = done.lines.join('\n')
  assert.match(said, /quit the Claude app fully/)
  assert.match(said, /\/workers/)

  // Run again: it recognises its own copy and does nothing.
  const again = await runSetup({ command: FAKE, modsDir: MODS })
  assert.equal(again.ok, true)
  assert.deepEqual(commands((await read()).calls).slice(5), ['plugin list', 'plugin marketplace list'])
  assert.match(again.lines.join('\n'), /Nothing to do/)
})

test('setup leaves a copy installed from elsewhere as it is, and --check only says what it would do', async t => {
  const theirs = { id: 'folder-branches@team-mods', version: '0.9.0', scope: 'user', enabled: true }
  const read = await fakeState(t, { plugins: [theirs] })
  const kept = await runSetup({ command: FAKE, modsDir: MODS })
  assert.equal(kept.ok, true)
  assert.deepEqual((await read()).plugins, [theirs])
  assert.deepEqual(commands((await read()).calls), ['plugin list', 'plugin marketplace list'])

  const readFresh = await fakeState(t, {})
  const check = await runSetup({ command: FAKE, modsDir: MODS, isCheck: true })
  assert.equal(check.ok, true)
  assert.deepEqual(commands((await readFresh()).calls), ['plugin list', 'plugin marketplace list'])
  assert.match(check.lines.join('\n'), /Would run: claude plugin marketplace add/)
  assert.deepEqual((await readFresh()).plugins, [])
})

test('setup stops and says so when the program cannot tell what is installed, or a step fails', async t => {
  await fakeState(t, { isBroken: true })
  const broken = await runSetup({ command: FAKE, modsDir: MODS })
  assert.equal(broken.ok, false)
  assert.match(broken.lines.join('\n'), /could not tell which mods are installed.*Something went wrong inside the program/s)

  // The board's marketplace name is taken by another folder: nothing is installed.
  const read = await fakeState(t, { marketplaces: [{ name: MARKETPLACE, source: 'directory', path: join(tmpdir(), 'another-board', 'mods') }] })
  const taken = await runSetup({ command: FAKE, modsDir: MODS })
  assert.equal(taken.ok, false)
  assert.deepEqual((await read()).plugins, [])
})
