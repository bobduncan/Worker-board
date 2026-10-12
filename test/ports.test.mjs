// B92: a copy of the board started from another folder than main takes a port of its own. Made-up folders only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { OWN_PORTS_FROM, choosePort, freePort, launchEntry, portArg, readOwnPort, resolvePort, withEntry, writeOwnPort } from '../src/ports.mjs'

test('portArg: a port given on the command line, or null', () => {
  assert.equal(portArg('4311'), 4311)
  for (const none of [undefined, null, '', ' ', 'abc', '80', '70000', '4311.5']) assert.equal(portArg(none), null, String(none))
})

test('freePort: the lowest one from the start that nobody has', () => {
  assert.equal(OWN_PORTS_FROM, 4320)
  assert.equal(freePort([]), 4320)
  assert.equal(freePort([4320, 4321, 4323]), 4322)
  assert.equal(freePort([4310, 4999]), 4320)
})

test('choosePort: a given port wins, the main folder keeps the configured one, a copy has its own', () => {
  const configured = 4310
  assert.deepEqual(choosePort({ given: 4311, configured, isMain: false, own: 4322 }), { port: 4311, why: 'given' })
  assert.deepEqual(choosePort({ given: 4500, configured, isMain: true }), { port: 4500, why: 'given' })
  assert.deepEqual(choosePort({ configured, isMain: true, own: 4322, taken: [4320] }), { port: 4310, why: 'main' })
  // A copy keeps the port it wrote down, whatever the others have.
  assert.deepEqual(choosePort({ configured, isMain: false, own: 4322, taken: [4320, 4322] }), { port: 4322, why: 'own' })
  // A copy without one takes the lowest that no other folder has, and never main's.
  assert.deepEqual(choosePort({ configured, isMain: false, taken: [4320, 4321] }), { port: 4322, why: 'new' })
  assert.deepEqual(choosePort({ configured: 4320, isMain: false, taken: [] }), { port: 4321, why: 'new' })
  // What a file says is used only when it is a port, and not main's.
  for (const bad of [null, 80, 4310, 4320.5, '4322']) assert.equal(choosePort({ configured, isMain: false, own: bad }).why, 'new', String(bad))
})

/** Made-up folders of one repository in a temporary place, with a stand-in for git that lists them. */
async function folders(names) {
  const root = await mkdtemp(join(tmpdir(), 'board-ports-'))
  const paths = names.map(name => join(root, name))
  const list = paths.map(path => `worktree ${path}\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/x\n`).join('\n')
  return { root, paths, run: async () => list }
}

test('resolvePort: main keeps its port; each copy takes its own, the same every time, side by side', async t => {
  const { root, paths: [main, one, two], run } = await folders(['board', 'board-one', 'board-two'])
  t.after(() => rm(root, { recursive: true, force: true }))
  const start = (here, given) => resolvePort({ here, given, configured: 4310, run })

  assert.deepEqual(await start(main), { port: 4310, why: 'main', main, isMain: true })
  assert.equal(await readOwnPort(main), null)                       // main writes nothing down

  assert.deepEqual(await start(one), { port: 4320, why: 'new', main, isMain: false })
  assert.deepEqual(await start(two), { port: 4321, why: 'new', main, isMain: false })
  assert.deepEqual(JSON.parse(await readFile(join(one, 'data', 'port.json'), 'utf8')), { port: 4320 })

  // Started again, in any order, also after another folder is gone: each has the port it had.
  assert.deepEqual([(await start(two)).port, (await start(two)).why], [4321, 'own'])
  assert.deepEqual([(await start(one)).port, (await start(one)).why], [4320, 'own'])
  await rm(one, { recursive: true, force: true })
  assert.equal((await start(two)).port, 4321)

  // A port on the command line wins and is not written down; the folder's own port stays what it was.
  assert.deepEqual([(await start(two, '4311')).port, (await start(two, '4311')).why, await readOwnPort(two)], [4311, 'given', 4321])
  assert.equal((await start(main, '4399')).port, 4399)
})

test('resolvePort: a new copy does not take a port another copy holds', async t => {
  const { root, paths: [, one, two], run } = await folders(['board', 'board-one', 'board-two'])
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeOwnPort(one, 4320)
  await writeOwnPort(two, 4320)   // two folders with the same file, as after a copied folder
  // The folder keeps what it wrote down; a third one would take the next.
  assert.equal((await resolvePort({ here: two, configured: 4310, run })).port, 4320)
  const three = join(root, 'board-three')
  const list = [join(root, 'board'), one, two, three].map(path => `worktree ${path}\nHEAD 0\nbranch refs/heads/x\n`).join('\n')
  assert.equal((await resolvePort({ here: three, configured: 4310, run: async () => list })).port, 4321)
})

test('resolvePort: without git a folder is its own main folder and keeps the configured port', async t => {
  const { root, paths: [, one] } = await folders(['board', 'board-one'])
  t.after(() => rm(root, { recursive: true, force: true }))
  const noGit = async () => { throw new Error('git is not there') }
  assert.deepEqual(await resolvePort({ here: one, configured: 4310, run: noGit }), { port: 4310, why: 'main', main: one, isMain: true })
  assert.equal((await resolvePort({ here: one, configured: 4310, run: async () => null })).port, 4310)
})

test('launchEntry: a folder\'s entry is named after it and opens its own port; a copy shows main\'s history', () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe'
  assert.deepEqual(launchEntry({ folder: 'C:\\x\\board-one', port: 4320, node, main: 'C:\\x\\board' }), {
    name: 'board-one',
    runtimeExecutable: 'C:/Program Files/nodejs/node.exe',
    runtimeArgs: ['C:/x/board-one/server.mjs', '--history-from', 'C:/x/board/data'],
    port: 4320,
    url: 'http://127.0.0.1:4320',
  })
  assert.deepEqual(launchEntry({ folder: 'C:\\x\\board', port: 4310, node, main: 'C:/x/Board/' }).runtimeArgs, ['C:/x/board/server.mjs'])
})

test('withEntry: the entry replaces the one of its name or is added; the others stay', () => {
  const other = { name: 'game', port: 5173 }
  const entry = { name: 'board-one', port: 4320 }
  assert.deepEqual(JSON.parse(withEntry(JSON.stringify({ version: '0.0.1', configurations: [other] }), entry)), { version: '0.0.1', configurations: [other, entry] })
  const old = { version: '0.0.1', extra: true, configurations: [{ name: 'board-one', port: 4312 }, other] }
  assert.deepEqual(JSON.parse(withEntry(JSON.stringify(old), entry)), { version: '0.0.1', extra: true, configurations: [entry, other] })
  // A file that is missing, broken or something else starts anew.
  for (const text of ['', 'not json', '[]', '{"configurations":"x"}']) {
    assert.deepEqual(JSON.parse(withEntry(text, entry)), { version: '0.0.1', configurations: [entry] })
  }
  assert.ok(withEntry('', entry).endsWith('}\n'))
})
