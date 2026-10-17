// B296: the store as a shadow of the backlog: written at a refresh when the backlog changed, read back through the
// adapter, and one line about it on the Backlog tab. Made-up samples only.

import assert from 'node:assert/strict'
import * as real from 'node:fs/promises'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseBacklog } from '../../src/backlog.mjs'
import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../../src/state.mjs'
import { flowOfStep, shadowBacklog, shadowKeeper } from '../../src/work/shadow.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKLOG = await readFile(join(HERE, 'fixtures', 'backlog-small.md'), 'utf8')
const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const RULES = { prefix: 'Team - ', names: ['Board', 'Support', 'Units'] }

/** The real file functions, counting the writes. */
function counting() {
  const fs = { readFile: real.readFile, rename: real.rename, rm: real.rm, mkdir: real.mkdir, readdir: real.readdir, writes: 0 }
  fs.writeFile = (...args) => {
    fs.writes += 1
    return real.writeFile(...args)
  }
  return fs
}

test('in shadow the store folder mirrors the backlog after a refresh, and a second refresh writes nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-shadow-'))
  try {
    const fs = counting()
    const keeper = shadowKeeper({ dir, canWrite: true, clock: () => NOW, fs })
    const work = await keeper(BACKLOG)
    assert.equal(work.ok, true)
    assert.equal(work.items.size, 19)
    assert.equal(work.truth, 'shadow')
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'truth.json'), 'utf8')), { truth: 'shadow', since: '2026-10-17 11:05' })
    const written = fs.writes
    assert.ok(written >= 22)
    await keeper(BACKLOG)
    assert.equal(fs.writes, written, 'the same text: no write at all')
    // A board started anew migrates once more, and finds every file as it would write it.
    await shadowKeeper({ dir, canWrite: true, clock: () => NOW + 60_000, fs })(BACKLOG)
    assert.equal(fs.writes, written)
    // One step ticked: one file.
    const ticked = await keeper(BACKLOG.replace('- [ ] B18', '- [x] B18'))
    assert.equal(ticked.lastWrite.files, 1)
    assert.equal(ticked.items.get('B18').head.get('State'), 'done')
    // A step that left the backlog keeps its file and is named.
    const gone = await keeper(BACKLOG.replace(/^- \[ \] B15 .*\n/m, ''))
    assert.ok((await readdir(dir)).includes('B15.md'))
    const shown = shadowBacklog(gone, parseBacklog(BACKLOG.replace(/^- \[ \] B15 .*\n/m, ''), RULES), RULES)
    assert.deepEqual(shown.store.problems, ['B15: in the store, but no longer on the backlog'])
    assert.equal(shown.store.differences, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a board that may not write reads the store as it is, and writes nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-shadow-'))
  try {
    const work = await shadowKeeper({ dir, canWrite: false, clock: () => NOW })(BACKLOG)
    assert.equal(work.ok, true)
    assert.equal(work.items.size, 0)
    assert.deepEqual(await readdir(dir), [])
    const shown = shadowBacklog(work, parseBacklog(BACKLOG, RULES), RULES)
    assert.deepEqual(shown.backlog, parseBacklog(BACKLOG, RULES))
    assert.equal(shown.store.why, 'The store has not been written yet: the board shows the backlog.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the state payload is unchanged by the adapter: a fixture backlog gives the same state with and without the store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-shadow-'))
  try {
    const work = await shadowKeeper({ dir, canWrite: true, clock: () => NOW })(BACKLOG)
    const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: 1, lastAssistantUuid: 'u' })
    const raw = { listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: ['Main', 'Board', 'Units'].map(app), tails: {}, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {} }
    const options = { lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game' } }
    const without = buildState(raw, options)
    const withStore = buildState({ ...raw, work }, options)
    assert.equal(without.store, null)
    assert.deepEqual(withStore.store, { mode: 'shadow', ok: true, items: 19, differences: 0, problems: [], why: null, failed: false })
    const plain = state => JSON.parse(JSON.stringify({ ...state, store: null, backlog: state.backlog.map(activity => ({ ...activity, steps: activity.steps.map(({ flow, ...step }) => step) })) }))
    assert.deepEqual(plain(withStore), plain(without))
    // A store that cannot be read: the backlog's state, with the line that says so.
    const broken = buildState({ ...raw, work: { ok: false, why: 'The work store in X could not be read (EACCES).' } }, options)
    assert.deepEqual(plain(broken), plain(without))
    assert.equal(broken.store.why, 'The work store in X could not be read (EACCES). The board shows the backlog.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the step window carries the flow strip with the step\'s state marked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-shadow-'))
  try {
    const work = await shadowKeeper({ dir, canWrite: true, clock: () => NOW })(BACKLOG)
    const flow = flowOfStep(work, 'B10')
    assert.deepEqual([flow.state, flow.states.length, flow.next.map(move => move.to)], ['queued', 9, ['taken', 'done', 'dropped']])
    assert.match(flowOfStep(work, '1:0').id, /^L-[0-9a-f]{8}$/)
    assert.equal(flowOfStep(work, '1:0').state, 'done')
    assert.deepEqual(flowOfStep(work, 'B13').states, ['open', 'answered', 'withdrawn'])
    assert.equal(flowOfStep(work, 'B99'), null)
    assert.equal(flowOfStep({ ok: false }, 'B10'), null)
    const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: 1, lastAssistantUuid: 'u' })
    const raw = { listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: ['Main', 'Board'].map(app), tails: {}, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work }
    const state = buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game' } })
    const step = state.backlog.flatMap(activity => activity.steps).find(one => one.id === 'B17')
    assert.deepEqual(step.flow.state, 'in progress')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// The page's line about the store, cut out of board.js between its marks.
const script = await readFile(join(HERE, '..', '..', 'public', 'board.js'), 'utf8')
const html = await readFile(join(HERE, '..', '..', 'public', 'index.html'), 'utf8')
const page = {}
vm.runInNewContext(`${script.slice(script.indexOf('// store:start'), script.indexOf('// store:end'))}\nthis.storeLine = storeLine\nthis.storeNote = storeNote`, page)
const line = store => JSON.parse(JSON.stringify(page.storeLine(store)))

test('the Backlog tab says in one line whether the store is in step with the backlog', () => {
  assert.equal(line(null), null)
  assert.deepEqual(line({ mode: 'shadow', ok: true, items: 370, differences: 0, problems: [], why: null }), { tone: 'ok', text: 'Store: shadow · 370 items · in step with the backlog', problems: [] })
  assert.deepEqual(line({ mode: 'shadow', ok: true, items: 370, differences: 2, problems: [], why: null }), { tone: 'problem', text: 'Store: shadow · 370 items · 2 steps differ from the backlog: the board shows the backlog', problems: [] })
  assert.deepEqual(line({ mode: 'shadow', ok: true, items: 3, differences: 1, problems: ['B15: in the store, but no longer on the backlog'], why: null }).text, 'Store: shadow · 3 items · 1 step differs from the backlog: the board shows the backlog · 1 problem')
  assert.deepEqual(line({ mode: 'shadow', ok: false, items: 0, differences: null, problems: [], why: 'The store has not been written yet: the board shows the backlog.' }), { tone: 'problem', text: 'Store: The store has not been written yet: the board shows the backlog.', problems: [] })
  assert.match(html, /<p class="coordinate-store" id="coordinate-store" role="status" hidden><\/p>/)
})

test('a store that cannot be read puts one line on top of the board', () => {
  const why = 'The work store in X could not be read (EACCES). The board shows the backlog.'
  assert.deepEqual(JSON.parse(JSON.stringify(page.storeNote({ ok: false, failed: true, why }))), { tone: 'problem', text: why })
  assert.equal(page.storeNote({ ok: false, failed: false, why: 'The store has not been written yet: the board shows the backlog.' }), null)
  assert.equal(page.storeNote(null), null)
  assert.match(html, /id="store-note" role="status" hidden/)
})

test('B297: a store that is the truth is never written by the shadow, and the board shows it even where backlog.md differs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-shadow-'))
  try {
    const fs = counting()
    await shadowKeeper({ dir, canWrite: true, clock: () => NOW, fs })(BACKLOG)
    const { writeTruth } = await import('../../src/work/store.mjs')
    await writeTruth(dir, { truth: 'store', since: '2026-10-17 11:05' })
    const written = fs.writes
    const keeper = shadowKeeper({ dir, canWrite: true, clock: () => NOW + 60_000, fs })
    const edited = BACKLOG.replace('- [ ] B18', '- [x] B18')
    const work = await keeper(edited)
    assert.equal(fs.writes, written, 'the shadow writes nothing over the truth')
    assert.equal(work.truth, 'store')
    assert.deepEqual(work.lastWrite?.problems ?? [], [])
    // backlog.md was edited by hand: the board shows the store, and says how many steps differ.
    const shown = shadowBacklog(work, parseBacklog(edited, RULES), RULES)
    assert.equal(shown.backlog.activities[0].steps.find(step => step.id === 'B18').isDone, false)
    assert.deepEqual(shown.store, { mode: 'store', ok: true, items: 19, differences: 1, problems: [], why: null, failed: false })
    assert.deepEqual(line(shown.store), { tone: 'problem', text: 'Store: store · 19 items · 1 step of backlog.md differs from the store: the board shows the store; backlog.md is rewritten at the next change', problems: [] })
    assert.deepEqual(line({ ...shown.store, differences: 0 }).text, 'Store: store · 19 items · backlog.md is its view')
    // A change through the API is read at the next refresh: the keeper is told to read anew.
    await real.rm(join(dir, 'B18.md'))
    assert.equal((await keeper(edited)).items.has('B18'), true, 'kept for the reread time')
    keeper.reset()
    assert.equal((await keeper(edited)).items.has('B18'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('B297, review 4: a kept hand edit of the view puts one line on top of the board', () => {
  const note = JSON.parse(JSON.stringify(page.storeNote({ ok: true, failed: false, kept: 'X/backlog.edited-2026-10-17-1106.md' })))
  assert.equal(note.tone, 'warn')
  assert.match(note.text, /^backlog\.md was edited by hand after the cutover\. .*X\/backlog\.edited-2026-10-17-1106\.md/)
})
