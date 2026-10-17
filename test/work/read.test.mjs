// B301: the work store is the one source of the work. The board reads it at every refresh; a store that is not there,
// cannot be read, or holds a broken file is said in one line on top of the board, naming the folder or the file and what
// to run, and nothing is drawn from the backlog file instead. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../../src/state.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { flowOfStep, itemOfStep, storeBacklog, storeFault, storeFromText, storeKeeper } from '../../src/work/read.mjs'
import { writeStore } from '../../src/work/store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKLOG = await readFile(join(HERE, 'fixtures', 'backlog-small.md'), 'utf8')
const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const RULES = { prefix: 'Team - ', names: ['Board', 'Support', 'Units'] }

const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: 1, lastAssistantUuid: 'u' })
/** The board's state over `work`, with the backlog file's text beside it: the board must not read that. */
const stateOf = work => buildState({
  listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: ['Main', 'Board'].map(app), tails: {}, planLineTexts: {},
  backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
}, { lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game' } })

test('the keeper reads the store, keeps a read for the reread time, and reads anew after a change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-read-'))
  try {
    await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
    let now = NOW
    const keeper = storeKeeper({ dir, clock: () => now })
    const first = await keeper()
    assert.deepEqual([first.ok, first.exists, first.dir, first.items.size], [true, true, dir, 19])
    await rm(join(dir, 'B18.md'))
    assert.equal((await keeper()).items.has('B18'), true, 'kept for the reread time')
    keeper.reset()
    assert.equal((await keeper()).items.has('B18'), false)
    await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
    now += 30_000
    assert.equal((await keeper()).items.has('B18'), true, 'read anew after the reread time')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('no store folder: the keeper says so, the board shows no work, and its line on top names the folder and what to run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-read-'))
  try {
    const work = await storeKeeper({ dir: join(dir, 'work') })()
    assert.deepEqual([work.ok, work.exists], [true, false])
    const fault = storeFault(work, { backlog: 'C:\\game\\.claude\\backlog.md' })
    assert.equal(fault, `No work store in ${join(dir, 'work')}: the board shows no work. In the board's folder, make it from the backlog with "node tools/migrate-backlog.mjs --backlog C:\\game\\.claude\\backlog.md --work ${join(dir, 'work')} --make-store", or make an empty one with "node tools/migrate-backlog.mjs --work ${join(dir, 'work')} --init".`)
    // Nothing is drawn from the backlog file instead, though its text is there.
    const state = stateOf(work)
    assert.deepEqual(state.backlog, [])
    assert.deepEqual([state.store.ok, state.store.items], [false, 0])
    assert.match(state.store.why, /^No work store in .*: the board shows no work\. In the board's folder, make it from the backlog with "node tools\/migrate-backlog\.mjs --backlog C:\\game\\\.claude\\backlog\.md /)
    assert.deepEqual([state.backlogForYou, state.unassigned, state.reconciled], [[], [], null])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a store folder that cannot be read: one line naming it, and nothing drawn from the backlog file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-read-'))
  try {
    const file = join(dir, 'work')
    await writeFile(file, 'not a folder')
    const keeper = storeKeeper({ dir: file })
    const work = await keeper()
    assert.equal(work.ok, false)
    assert.match(storeFault(work), new RegExp(`^The work store ${file.replace(/\\/g, '\\\\')} cannot be read \\((ENOTDIR|EEXIST|EINVAL)\\): the board shows no work until it can\\. Check that it is a folder this board may read, and the setting "work" in the board's config\\.json\\.$`))
    const state = stateOf(work)
    assert.deepEqual([state.backlog, state.store.ok], [[], false])
    // A failed read is not kept: once it is a folder, the next refresh reads it.
    await rm(file)
    await writeStore(file, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
    assert.equal((await keeper()).items.size, 19)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a broken item file is named on top with its folder; the rest of the store is shown, the file as it is', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-read-'))
  try {
    await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
    await writeFile(join(dir, 'B10.md'), 'Id: B10\nKind: step\nThis is no head line\n')
    const work = await storeKeeper({ dir })()
    const state = stateOf(work)
    assert.equal(state.store.ok, true)
    assert.ok(state.workFlags.some(line => /^B10\.md: /.test(line)), state.workFlags.join(' | '))
    assert.ok(state.backlog.flatMap(activity => activity.steps).some(step => step.id === 'B11'))
    assert.equal(page.storeNote(state.store, state.workFlags).text.startsWith(`The work store ${dir}: B10.md: `), true)
    // A store folder without activities.json lists no step: that is named too.
    await rm(join(dir, 'activities.json'))
    const bare = stateOf(await storeKeeper({ dir })())
    assert.ok(bare.workFlags.includes('activities.json is missing, so no step is listed'), bare.workFlags.join(' | '))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('storeBacklog: the store as the backlog the board shows, with its line; an empty backlog and the fault without one', () => {
  const work = storeFromText(BACKLOG, { now: NOW, dir: 'W' })
  const shown = storeBacklog(work, RULES)
  assert.deepEqual(shown.store, { ok: true, dir: 'W', items: 19, problems: [], why: null })
  assert.ok(shown.backlog.activities.length > 0)
  assert.deepEqual(storeBacklog(undefined, RULES), { backlog: { activities: [] }, store: null })
  const none = storeBacklog({ ok: true, dir: 'W', exists: false, items: new Map(), activities: [], problems: [] }, RULES)
  assert.deepEqual(none.backlog, { activities: [] })
  assert.equal(none.store.ok, false)
  assert.match(none.store.why, /^No work store in W: /)
})

test('the step window carries the flow strip and the item as the store holds them', () => {
  const work = storeFromText(BACKLOG, { now: NOW })
  const flow = flowOfStep(work, 'B10')
  assert.deepEqual([flow.state, flow.states.length, flow.next.map(move => move.to)], ['queued', 9, ['taken', 'refined', 'new', 'done', 'dropped']])
  assert.match(flowOfStep(work, '1:0').id, /^L-[0-9a-f]{8}$/)
  assert.equal(flowOfStep(work, '1:0').state, 'done')
  assert.deepEqual(flowOfStep(work, 'B13').states, ['open', 'answered', 'withdrawn'])
  assert.equal(flowOfStep(work, 'B99'), null)
  assert.equal(flowOfStep({ ok: false }, 'B10'), null)
  assert.equal(itemOfStep(work, 'B10').id, 'B10')
  assert.equal(itemOfStep({ ok: false, dir: 'W', code: 'EACCES' }, 'B10'), null)
  const step = stateOf(work).backlog.flatMap(activity => activity.steps).find(one => one.id === 'B17')
  assert.equal(step.flow.state, 'in progress')
})

// The page's line about the store and its note on top, cut out of board.js between their marks.
const script = await readFile(join(HERE, '..', '..', 'public', 'board.js'), 'utf8')
const html = await readFile(join(HERE, '..', '..', 'public', 'index.html'), 'utf8')
const page = {}
vm.runInNewContext(`${script.slice(script.indexOf('// store:start'), script.indexOf('// store:end'))}\nthis.storeLine = storeLine\nthis.storeNote = storeNote`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('the Backlog tab says in one line how many items the store holds and that backlog.md is its view', () => {
  assert.equal(page.storeLine(null), null)
  assert.deepEqual(plain(page.storeLine({ ok: true, items: 370, problems: [], why: null })), { tone: 'ok', text: 'Store · 370 items · backlog.md is its view', problems: [] })
  assert.deepEqual(plain(page.storeLine({ ok: true, items: 3, problems: ['B15: an activity lists it, but the store has no file for it'], why: null })).text, 'Store · 3 items · backlog.md is its view · 1 problem')
  assert.deepEqual(plain(page.storeLine({ ok: false, items: 0, problems: [], why: 'No work store in W.' })), { tone: 'problem', text: 'Store: No work store in W.', problems: [] })
  assert.match(html, /<p class="coordinate-store" id="coordinate-store" role="status" hidden><\/p>/)
})

test('no store, or one that cannot be read, puts its line on top of the board; so does a kept hand edit of the view', () => {
  const why = 'The work store W cannot be read (EACCES): the board shows no work until it can.'
  assert.deepEqual(plain(page.storeNote({ ok: false, items: 0, problems: [], why })), { tone: 'problem', text: why })
  assert.equal(page.storeNote(null), null)
  assert.match(html, /id="store-note" role="status" hidden/)
  const note = plain(page.storeNote({ ok: true, kept: 'X/backlog.edited-2026-10-17-1106.md' }))
  assert.equal(note.tone, 'warn')
  assert.match(note.text, /^backlog\.md was edited by hand\. .*X\/backlog\.edited-2026-10-17-1106\.md/)
})
