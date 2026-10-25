// Fix first (the person, 2026-10-18: "also when something is classified as a fix for the worker board, it should take
// priority over the current goal/focus of the advisor"): a step with `Priority: fix` goes first wherever the board
// picks the next step: the delivery to a free worker, a worker's `work next` and pull, the Backlog tab and the lanes'
// queues; it stays with its owner and jumps that owner's queue. The Focus page says why a part waits. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { ASK_MS, GRACE_MS, IDLE_HOLD_MS, parseConfig } from '../../src/config.mjs'
import { parseGoals } from '../../src/goals.mjs'
import { buildState, focusState } from '../../src/state.mjs'
import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { parseItem, validateHead, valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { storeFromText } from '../../src/work/read.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeItem, writeStore } from '../../src/work/store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const made = {}
vm.runInNewContext(`function whyText() { return null }
${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
${script.slice(script.indexOf('// coordinate:start'), script.indexOf('// coordinate:end'))}
${script.slice(script.indexOf('// calmoverview:start'), script.indexOf('// calmoverview:end'))}
Object.assign(this, { coordinateList, focusView, nextInQueue })`, made)
const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

const NOW = new Date(2026, 9, 18, 11, 5).getTime()
const MIN = 60_000
const BACKLOG = [
  '# Backlog',
  '',
  '## Board work #focus',
  '- [ ] B1 Draw the strip (for Board; about 1 h)',
  '- [ ] B2 Keep the cards apart (for Board; about 30 min)',
  '- [ ] B5 A ready step',
  '  Refined (2026-10-17 10:00; ready):',
  '  Summary: One description.',
  '  What we build:',
  '  - the strip',
  '- [ ] B7 An unrefined step',
  '',
].join('\n')
const ROLES = { Main: 'main', Board: 'worker', Support: 'worker', Advisor: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'fix-first-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + MIN, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board', 'Support']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, main: as('Main'), board: as('Board'), advisor: as('Advisor'), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)

test('a step may carry Priority: fix, and nothing else there', () => {
  const head = more => new Map([['Id', 'B9'], ['Kind', 'step'], ['Title', 'A step'], ['State', 'new'], ['Since', '2026-10-18 10:00'], ...Object.entries(more)])
  assert.equal(validateHead(head({ Priority: 'fix' })), null)
  assert.equal(validateHead(head({ Priority: '-' })), null)
  assert.equal(validateHead(head({ Priority: 'urgent' })), 'Priority is not fix: urgent')
})

test('new with priority fix marks the step a board fix: the main chat, the partner and the person; not a worker', async () => {
  const { dir, main, board, advisor, person } = await fresh()
  try {
    const made = await main({ action: 'new', title: 'The lane flickers', activity: 'Board work', priority: 'fix' })
    assert.equal(made.ok, true, made.why)
    const id = made.result.id
    assert.equal(valueOf(await item(dir, id), 'Priority'), 'fix')
    assert.ok((await item(dir, id)).sections.get('History').some(line => line.endsWith('Main: marked a board fix')))
    // The head keeps its order: the priority right under the title.
    assert.deepEqual([...(await item(dir, id)).head.keys()].slice(0, 4), ['Id', 'Kind', 'Title', 'Priority'])
    assert.equal((await advisor({ action: 'new', title: 'The board shows twice', activity: 'Board work', priority: 'fix' })).ok, true)
    assert.equal((await person({ action: 'new', title: 'The page is blank', activity: 'Board work', priority: 'fix' })).ok, true)
    assert.deepEqual(await board({ action: 'new', title: 'Mine', activity: 'Board work', priority: 'fix' }), { ok: false, status: 403, why: 'Only the main chat, the partner or the person marks a step as a board fix.' })
    assert.deepEqual(await main({ action: 'new', title: 'Other', activity: 'Board work', priority: 'high' }), { ok: false, status: 400, why: '"priority" is fix, or left out.' })
    // Redesign Part 2: Main's queue is gone (a fix is marked when it is made); the board gives a fix first.
    assert.equal((await main({ action: 'queue', id: 'B5', for: 'Board', priority: 'fix' })).status, 410)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('work next lists the fix first among the queued steps, marked; the pull wakes the chat for the fix', async () => {
  const { dir, main, board } = await fresh()
  try {
    const two = (await readStore(dir)).items.get('B2')
    two.head.set('Priority', 'fix')
    assert.equal((await writeItem(dir, two)).ok, true)
    const next = await board({ action: 'next' })
    assert.deepEqual(next.result.items, ['B2', 'B1'])
    assert.match(next.result.text, /^- B2 queued, board fix: Keep the cards apart$/m)
    assert.match(next.result.text, /^- B1 queued: Draw the strip$/m)
    assert.equal(next.result.id, 'B2')
    const pulled = await board({ action: 'pull' })
    assert.equal(pulled.result.wake.id, 'B2')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const file = head => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)
const step = (id, state, more = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: '2026-10-18 10:00', ...more })
const lane = (name, state = 'free') => ({ name, state, isMain: false, isLeftover: false, isRunning: true, lastActivityAt: NOW - 30 * MIN, task: null })
const deliver = (items, lanes) => reconcile({ store: { items: new Map(items.map(one => [one.head.get('Id'), one])), flow: DEFAULT_FLOW, problems: [] }, lanes, now: NOW, times: { graceMs: GRACE_MS, askMs: ASK_MS, idleMs: IDLE_HOLD_MS }, prefix: 'Team - ' }).deliveries

test('the delivery to a free worker takes its fix first; a fix that may not go yet lets the next one go', () => {
  const queued = [step('B286', 'queued', { Owner: 'Units' }), step('B330', 'queued', { Owner: 'Team - Units', Priority: 'fix' })]
  assert.deepEqual(deliver(queued, [lane('Units')]).map(one => one.id), ['B330'])
  // It stays with its owner: another free chat is not given it.
  assert.deepEqual(deliver([step('B330', 'queued', { Owner: 'Units', Priority: 'fix' })], [lane('Board')]), [])
  // A fix that waits on an open step does not hold the queue.
  const blocked = [step('B1', 'in progress', { Owner: 'Board' }), step('B286', 'queued', { Owner: 'Units' }), step('B330', 'queued', { Owner: 'Units', Priority: 'fix', 'Blocked by': 'B1' })]
  assert.deepEqual(deliver(blocked, [lane('Units'), lane('Board', 'working')]).map(one => one.id), ['B286'])
})

const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: 1, lastAssistantUuid: 'u' })
const stateOf = work => buildState({
  listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: ['Main', 'Board'].map(app), tails: {}, planLineTexts: {},
  backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
}, { lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game' } })

test('the lane\'s queue and the Backlog tab put the fix first and mark it', () => {
  const work = storeFromText(BACKLOG, { now: NOW, dir: 'W' })
  work.items.get('B2').head.set('Priority', 'fix')
  const state = stateOf(work)
  const queue = state.chats.find(one => one.name === 'Board').queue
  assert.deepEqual(queue.map(one => [one.id, one.isFix === true]), [['B2', true], ['B1', false]])
  assert.equal(plain(made.nextInQueue(queue)).isFix, true)
  // Only a fix carries the field.
  assert.equal('isFix' in queue[1], false)
  const steps = state.backlog.flatMap(activity => activity.steps)
  assert.equal(steps.find(one => one.id === 'B2').isFix, true)
  assert.equal(steps.find(one => one.id === 'B1').isFix, undefined)
  const list = plain(made.coordinateList(state.backlog))
  assert.deepEqual(list.groups[0].steps.map(one => one.id).slice(0, 2), ['B2', 'B1'])
  const one = plain(made.coordinateList(state.backlog, { asOne: true }))
  assert.equal(one.groups[0].steps[0].id, 'B2')
  // The chip: in the lane's queue, its next step and the Backlog tab's row.
  assert.ok(css.includes('.fix-chip'))
  assert.equal((script.match(/fixChip\(\)/g) ?? []).length >= 3, true)
})

const GOALS = [
  'Last id: G2',
  'Focus: G2',
  '',
  '- [~] G2 Benches that feel like home',
  '  Vibe: you sit down without thinking',
  '  Vibe agreed: 2026-10-18 10:00',
  '  Part: Draw the bench · about 1 h · steps B10',
  '  Part: Place them · 30 min · steps B11',
  '  How agreed: 2026-10-18 11:00',
  '',
].join('\n')

test('a focus part waits for a board fix its owner works on, or has queued before it: the Focus page says so', () => {
  const run = items => focusState(parseGoals(GOALS), items, [], 'Team - ').parts
  const working = run([step('B10', 'queued', { Owner: 'Units' }), step('B11', 'queued', { Owner: 'Board' }), step('B330', 'in progress', { Owner: 'Team - Units', Priority: 'fix' })])
  assert.deepEqual(working.map(part => part.fixFirst ?? null), ['B330', null])
  const queued = run([step('B10', 'queued', { Owner: 'Units' }), step('B11', 'queued', { Owner: 'Board' }), step('B331', 'queued', { Owner: 'Units', Priority: 'fix' })])
  assert.deepEqual(queued.map(part => part.fixFirst ?? null), ['B331', null])
  // A part whose step is itself a fix, or is under way, waits for nothing.
  assert.deepEqual(run([step('B10', 'queued', { Owner: 'Units', Priority: 'fix' }), step('B331', 'queued', { Owner: 'Units', Priority: 'fix' })]).map(part => part.fixFirst ?? null), [null, null])
  assert.deepEqual(run([step('B10', 'in progress', { Owner: 'Units' }), step('B331', 'queued', { Owner: 'Units', Priority: 'fix' })]).map(part => part.fixFirst ?? null), [null, null])
  const focus = focusState(parseGoals(GOALS), [step('B10', 'queued', { Owner: 'Units' }), step('B330', 'in progress', { Owner: 'Units', Priority: 'fix' })], [], 'Team - ')
  const view = plain(made.focusView(focus, { roots: [], nodes: [] }))
  assert.equal(view.run.parts[0].fixFirst, 'A board fix goes first: B330')
  assert.equal(view.run.parts[1].fixFirst, undefined)
  assert.match(script, /focus-fix/)
})

test('the job texts and the design say it', async () => {
  const read = name => readFile(join(ROOT, name), 'utf8')
  assert.match(await read('roles/main.md'), /--priority fix|priority fix/)
  assert.match(await read('roles/partner.md'), /board fix/i)
  assert.match(await read('roles/protocol.md'), /Priority: fix/)
  assert.match(await read('DESIGN.md'), /Fix first/)
})
