// B297: the cutover. The store becomes the truth, backlog.md its generated view; the board's own writers (a tick, a
// close, a delete, the person's refine answers) change the item and the view, not the old file's lines; the command
// prints the steps in flight and every chat card beside the store's state of its step. Made-up samples only.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { editStep, settleByBoard } from '../../src/tick.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, readTruth, writeStore, writeTruth } from '../../src/work/store.mjs'
import { BOARD_ANSWERS_ASKS } from '../../src/work/api.mjs'
import { boardRunsWork, run } from '../../tools/migrate-backlog.mjs'

/** The checks of the running board, as they stand once B299 is in and the board runs this version. */
const READY = { asksOnBoard: true, boardAnswers: async () => ({ ok: true }) }
const quiet = () => {
  const lines = []
  return { lines, log: line => lines.push(line), text: () => lines.join('\n') }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, '..', '..', 'tools', 'migrate-backlog.mjs')
const FIXTURE = join(HERE, 'fixtures', 'backlog-small.md')
const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const command = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' })

/** A project folder with the fixture as its backlog and two chat cards. */
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'work-cutover-'))
  const claude = join(root, '.claude')
  await mkdir(join(claude, 'chats'), { recursive: true })
  await copyFile(FIXTURE, join(claude, 'backlog.md'))
  await writeFile(join(claude, 'chats', 'list.json'), '{ "prefix": "Team - ", "main": "Main" }\n')
  await writeFile(join(claude, 'chats', 'aaa.json'), JSON.stringify({ name: 'Units', role: 'worker', state: 'working', task: { text: 'B17 the shop screen', step: 2, steps: 4, left: null, isReported: false }, at: 1 }))
  await writeFile(join(claude, 'chats', 'bbb.json'), JSON.stringify({ name: 'Board', role: 'worker', state: 'waiting', task: { text: 'Draw the strip', step: 1, steps: 3, left: null, isReported: false }, at: 1 }))
  await writeFile(join(claude, 'chats', 'ccc.json'), JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: 1 }))
  await writeFile(join(claude, 'chats', 'ddd.json'), '{ "left": true }')
  return { root, claude, backlog: join(claude, 'backlog.md'), work: join(claude, 'work') }
}

test('the cutover dry run prints the table and every card beside its step, and writes nothing', async () => {
  const { root, claude, backlog, work } = await project()
  try {
    const dry = command('--backlog', backlog, '--work', work, '--cutover', '--dry-run')
    // Review 1 and 7: until the board answers the store's asks and runs this version, the cutover is refused. B299: the
    // board answers them now (Needs your attention, POST /api/work answer); it still has to run this version.
    assert.equal(BOARD_ANSWERS_ASKS, true)
    assert.equal(dry.status, 1, dry.stdout + dry.stderr)
    assert.doesNotMatch(dry.stdout, /the board cannot answer the store's asks yet/)
    assert.match(dry.stdout, /^Would refuse: no board runs \(no board\.json beside the backlog\): start the board with this version first\.$/m)
    assert.match(dry.stdout, /^Steps: 19 on the backlog, 19 in the store$/m)
    assert.match(dry.stdout, /^The view reads back as the same items: yes$/m)
    assert.match(dry.stdout, /^In flight: 13$/m)
    // Review 2: a step in progress that names nobody is claimed by the worker on it.
    assert.match(dry.stdout, /^ {2}B17 \| in progress \| - \| feature\/shop \| no owner: the worker on it runs work take$/m)
    assert.match(dry.stdout, /^ {2}B10 \| queued \| Board \| -$/m)
    assert.match(dry.stdout, /^Cards with a task: 2 \(1 disagree with the store\)$/m)
    assert.match(dry.stdout, /^ {2}Units \| B17 the shop screen \(2\/4\) \| B17 in progress$/m)
    assert.match(dry.stdout, /^ {2}Board \| Draw the strip \(1\/3\) \| names no step; Board holds in the store: nothing in progress \(queued: B10, B20, B21, B24\) <- check$/m)
    assert.match(dry.stdout, /^Dry run: nothing written\.$/m)
    assert.deepEqual(await readdir(claude), ['backlog.md', 'chats'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the cutover makes the store the truth, keeps the old file and writes the view; it runs once', async () => {
  const { root, claude, backlog, work } = await project()
  try {
    const before = await readFile(backlog, 'utf8')
    const out = quiet()
    assert.equal(await run(['--backlog', backlog, '--work', work, '--cutover'], out.log, READY), 0, out.text())
    const cut = { stdout: out.text() }
    assert.equal(await readFile(join(claude, 'backlog.before-store.md'), 'utf8'), before)
    assert.equal((await readTruth(work)).truth, 'store')
    const view = await readFile(backlog, 'utf8')
    assert.match(view.split('\n')[0], /^<!-- generated by the worker board from .*; edit nothing here -->$/)
    assert.match(cut.stdout, /^The store is the truth now; backlog\.md is its view\.$/m)
    const again = quiet()
    assert.equal(await run(['--backlog', backlog, '--work', work, '--cutover'], again.log, READY), 1)
    assert.match(again.text(), /is the truth already/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('after the cutover a tick on the page changes the item and the view, not the old file\'s lines', async () => {
  const { root, backlog, work } = await project()
  try {
    await writeStore(work, migrateBacklog(await readFile(backlog, 'utf8'), { now: NOW }), undefined, { now: NOW })
    await writeTruth(work, { truth: 'store', since: '2026-10-17 11:05' })
    const options = { canWrite: true, file: backlog, now: NOW + 60_000, work: { dir: work, viewFile: backlog } }
    const closed = await editStep({ action: 'close', step: 'B18', reason: 'not now' }, options)
    assert.deepEqual(closed, { ok: true, result: { step: 'B18', action: 'close' } })
    const store = await readStore(work)
    assert.equal(valueOf(store.items.get('B18'), 'State'), 'done')
    const view = await readFile(backlog, 'utf8')
    assert.match(view, /^- \[x\] B18 See enemy plans \(later; not handed out\)\n {2}Closed by you on the worker board on 2026-10-17 at 11:06: not now$/m)
    assert.equal((await editStep({ action: 'close', step: 'B18' }, options)).status, 409)
    assert.equal((await editStep({ action: 'delete', step: 'B20' }, options)).ok, true)
    assert.doesNotMatch(await readFile(backlog, 'utf8'), /B20 Pick the order/)
    // The person's refine answer goes into the item's block.
    await editStep({ action: 'refine-answer', step: 'B21', answers: [{ index: 0, answer: 'no' }], feedback: 'fewer cliffs' }, options)
    const block = (await readStore(work)).items.get('B21').sections.get('Refined')
    assert.ok(block.includes('  - Fold it in? I advise yes. Answer: no'))
    assert.ok(block.includes('  - Round 2: fewer cliffs'))
    // The board settles an approval of merged work: the Verify ask is answered, the view ticks it.
    const said = []
    const message = { id: 'm1', at: NOW, to: 'Units', ask: 'backlog:B13', step: 'B13', title: 'x', verdict: 'approve', text: 'fine', state: 'waiting' }
    const state = { backlogForYou: [{ id: 'backlog:B13', approval: 'tick', kind: 'verify', branch: null }], baseBranch: 'main', restart: { main: 'Main' } }
    const settled = await settleByBoard(message, state, { ...options, branchesNow: async () => [], say: async one => said.push(one), newId: () => 'n1' })
    assert.equal(settled.ok, true)
    assert.equal(valueOf((await readStore(work)).items.get('B13'), 'State'), 'answered')
    assert.match(await readFile(backlog, 'utf8'), /^- \[x\] B13 Verify: Is the golem the boss you meant/m)
    assert.equal(said[0].text, 'B13 is approved and ticked on the worker board; no worker was woken for it. Open steps that waited for it: B12 (for Units).')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('before the cutover the tick writers change backlog.md as before', async () => {
  const { root, backlog, work } = await project()
  try {
    await writeStore(work, migrateBacklog(await readFile(backlog, 'utf8'), { now: NOW }), undefined, { now: NOW })
    const closed = await editStep({ action: 'close', step: 'B18' }, { canWrite: true, file: backlog, now: NOW, work: { dir: work, viewFile: backlog } })
    assert.equal(closed.ok, true)
    assert.match(await readFile(backlog, 'utf8'), /^- \[x\] B18 /m)
    assert.equal(valueOf((await readStore(work)).items.get('B18'), 'State'), 'new')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('review 3: a store that does not read back as the one checked is refused, and stays a shadow', async () => {
  const { root, backlog, work } = await project()
  try {
    // A step the shadow kept that left the backlog: on disk, but not in the checked store.
    await writeStore(work, migrateBacklog(await readFile(backlog, 'utf8'), { now: NOW }), undefined, { now: NOW })
    await writeFile(join(work, 'B99.md'), 'Id: B99\nKind: step\nTitle: Gone\nState: new\nSince: -\n')
    const out = quiet()
    assert.equal(await run(['--backlog', backlog, '--work', work, '--cutover'], out.log, READY), 1)
    assert.match(out.text(), /B99/)
    assert.match(out.text(), /^The store stays a shadow: nothing else written\.$/m)
    assert.equal((await readTruth(work)).truth, 'shadow')
    assert.doesNotMatch(await readFile(backlog, 'utf8'), /generated by the worker board/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('review 7: the running board must answer the work route; an older one answers 404', async () => {
  const { createServer } = await import('node:http')
  const { root, claude } = await project()
  const statuses = [404, 400]
  const server = createServer((req, res) => {
    req.resume()
    res.writeHead(statuses[0]).end()
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  try {
    await writeFile(join(claude, 'board.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, key: 'ab'.repeat(32) }))
    assert.match((await boardRunsWork(claude)).why, /answers 404 to \/api\/bridge\/work: it runs an older version/)
    statuses.shift()
    assert.deepEqual(await boardRunsWork(claude), { ok: true })
  } finally {
    await new Promise(done => server.close(done))
    await rm(root, { recursive: true, force: true })
  }
})
