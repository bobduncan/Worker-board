// Stop and rethink (docs/stop-and-rethink.md, T13.2.1), the work API's part: `rethink-hold` finds the topic of a goal (a part of its
// how, a fix chain, a recap row's steps), holds its open steps with `Waits for: the rethink of G<n> "<topic>" (<minute>)` and keeps
// the person's words on each; `rethink-free` takes those words away again. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { isReady, readyHold, waitIds, waitWords } from '../../src/work/guards.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { goalsToFree, rethinkLine, rethinkWords, withHold, withoutHoldOf } from '../../src/work/rethink.mjs'
import { rethinkTopicsOf, topicOf } from '../../src/work/rethinkTopic.mjs'
import { readStore, share, writeStore } from '../../src/work/store.mjs'
import { yourWordsOf } from '../../src/work/yourWords.mjs'

share.ms = 0

const NOW = new Date(2026, 10, 7, 11, 30).getTime()
const MINUTE = stamp(NOW + 60_000)
const file = (head, history = []) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n## History\n- 2026-11-07 09:00 Main: made\n${history.join('\n')}\n`)
const step = (id, state, more = {}) => file({ Id: id, Kind: 'step', Title: `Stairs try ${id}`, State: state, ...(['taken', 'in progress', 'waiting on you'].includes(state) ? { Owner: 'Worker 5' } : {}), Activity: 'Art', Goal: 'G60', Since: stamp(NOW - 60 * 60_000), ...more })

/**
 * Side stairs: B1 (in progress, Worker 5), its fixes B2 (refined, waits for B7), B3 (done), B4 (dropped), B6 (a fix of B2, new), B8
 * (review); Walls: B9 (refined); a recap row names B1 and B20 (queued); the tries of B30 (under no part): B31 (taken, Worker 2).
 */
const STEPS = [
  step('B1', 'in progress'), step('B2', 'refined', { 'Fix of': 'B1', 'Waits for': 'B7' }), step('B3', 'done', { 'Fix of': 'B1' }), step('B4', 'dropped', { 'Fix of': 'B1' }),
  step('B6', 'new', { 'Fix of': 'B2' }), step('B7', 'done'), step('B8', 'review', { 'Fix of': 'B1' }),
  step('B9', 'refined'), step('B20', 'queued', { Owner: 'Worker 2' }),
  step('B30', 'refined'), step('B31', 'taken', { 'Fix of': 'B30', Owner: 'Worker 2' }),
  file({ Id: 'B40', Kind: 'step', Title: 'Check B1', State: 'refined', Checks: 'B1', Activity: 'Art', Goal: 'G60', Since: stamp(NOW) }),
]
const NODE = { id: 'G60', title: 'The stairs', parts: [{ title: 'Side stairs', size: null, steps: ['B1'] }, { title: 'Walls', size: null, steps: ['B9'] }] }
const ROWS = [{ key: 'row', steps: ['B1', 'B20'] }]
const ROLES = { Main: 'main', 'Worker 5': 'worker', Advisor: 'advisor' }
const sorted = list => [...list].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))

async function fresh(t, rows = []) {
  const dir = await mkdtemp(join(tmpdir(), 'work-rethink-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const items = new Map(STEPS.map(one => [valueOf(one, 'Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Art', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(), goalNode: id => (id === 'G60' ? NODE : null), hasGoal: id => id === 'G60', recapRows: rows }
  return {
    dir,
    person: body => workApi(body, { ...ctx, as: 'person' }),
    server: body => workApi(body, { ...ctx, as: 'server' }),
    chat: (chat, body) => workApi({ chat, ...body }, ctx),
    item: async id => (await readStore(dir)).items.get(id),
  }
}
const hold = (board, more = {}) => board.person({ action: 'rethink-hold', goal: 'G60', text: 'all wrong, look at this', pictures: ['art-inbox/stairs/ref.png'], ...more })

test('the topic by the part: its steps and their fixes are held, in the exact words; done, dropped, review and other parts stay', async t => {
  const board = await fresh(t)
  const done = await hold(board, { title: 'Side stairs' })
  assert.equal(done.ok, true, JSON.stringify(done))
  assert.deepEqual([done.result.topic, done.result.kind], ['Side stairs', 'part'])
  assert.deepEqual(sorted(done.result.held), ['B1', 'B2', 'B6'])
  assert.deepEqual(done.result.stop, [{ id: 'B1', owner: 'Worker 5' }])
  const mark = `the rethink of G60 "Side stairs" (${MINUTE})`
  assert.equal(valueOf(await board.item('B1'), 'Waits for'), mark)
  // A step that waits for something already keeps it, and gets the hold after it.
  assert.equal(valueOf(await board.item('B2'), 'Waits for'), `B7; ${mark}`)
  assert.equal(valueOf(await board.item('B6'), 'Waits for'), mark)
  for (const id of ['B3', 'B4', 'B8', 'B9', 'B20', 'B30', 'B40']) assert.equal(valueOf(await board.item(id), 'Waits for'), null, `${id} is not held`)
})

test('a recap row that names a step of the topic adds its steps', async t => {
  const board = await fresh(t, ROWS)
  const done = await hold(board, { of: 'B1' })
  assert.deepEqual(sorted(done.result.held), ['B1', 'B2', 'B6', 'B20'])
  assert.deepEqual(done.result.stop, [{ id: 'B1', owner: 'Worker 5' }])
  // B20 is queued for a worker: held, but it holds no step yet, so no stop.
  assert.equal(valueOf(await board.item('B20'), 'Waits for'), `the rethink of G60 "Side stairs" (${MINUTE})`)
})

test('the topic by the fix chain: a step up or down the chain names the part; with no part it is "the tries of B<root>"', async t => {
  const byFix = await hold(await fresh(t), { of: 'B6' })
  assert.deepEqual([byFix.result.topic, byFix.result.held.includes('B1')], ['Side stairs', true])
  const board = await fresh(t)
  const chain = await hold(board, { of: 'B31' })
  assert.deepEqual([chain.result.topic, chain.result.kind, sorted(chain.result.held)], ['the tries of Stairs try', 'chain', ['B30', 'B31']])
  assert.deepEqual(chain.result.stop, [{ id: 'B31', owner: 'Worker 2' }])
  assert.equal(valueOf(await board.item('B31'), 'Waits for'), `the rethink of G60 "the tries of Stairs try" (${MINUTE})`)
  // A title of a chain is no way to name it: name a step of it.
  assert.equal((await hold(await fresh(t), { title: 'the tries of Stairs try' })).status, 409)
})

test('the words: each held step gets a point of its "Your words" with where it was said and the pictures named; the History says why it waits', async t => {
  const board = await fresh(t)
  await hold(board, { title: 'Side stairs' })
  for (const id of ['B1', 'B2', 'B6']) {
    const item = await board.item(id)
    const points = yourWordsOf(item)
    assert.equal(points.length, 1, id)
    assert.deepEqual([points[0].how, points[0].answer, points[0].shown], [`note (rethink, ${MINUTE})`, 'all wrong, look at this', ['art-inbox/stairs/ref.png']])
    assert.match(item.sections.get('History').at(-1), new RegExp(`held for the rethink of G60 "Side stairs" \\(${MINUTE}\\)`))
  }
  assert.equal(yourWordsOf(await board.item('B3')).length, 0, 'a done step gets none')
})

test('refusals: no goal, no words, a topic the goal does not have, a chat that is not the person', async t => {
  const board = await fresh(t)
  assert.equal((await board.person({ action: 'rethink-hold', text: 'x', title: 'Side stairs' })).status, 400)
  assert.equal((await hold(board, { goal: 'G99', title: 'Side stairs' })).status, 409)
  assert.equal((await hold(board, { title: 'Side stairs', text: '  ' })).status, 400)
  const none = await hold(board, { title: 'No such part' })
  assert.deepEqual([none.ok, none.status], [false, 409])
  assert.match(none.why, /No such part is no part of this goal/)
  assert.equal((await hold(board, { of: 'Q1' })).why, 'Name the goal and a step of the topic.')
  for (const who of ['Main', 'Advisor', 'Worker 5']) assert.equal((await board.chat(who, { action: 'rethink-hold', goal: 'G60', title: 'Side stairs', text: 'x' })).status, 403, who)
  assert.equal(valueOf(await board.item('B1'), 'Waits for'), null, 'nothing was written')
})

test('the end: rethink-free takes only the rethink words away; what a step waits for otherwise stays; a second call changes nothing', async t => {
  const board = await fresh(t)
  await hold(board, { title: 'Side stairs' })
  const freed = await board.server({ action: 'rethink-free', goal: 'G60' })
  assert.deepEqual(sorted(freed.result.freed), ['B1', 'B2', 'B6'])
  assert.equal(valueOf(await board.item('B1'), 'Waits for'), null)
  assert.equal(valueOf(await board.item('B2'), 'Waits for'), 'B7')
  assert.match((await board.item('B2')).sections.get('History').at(-1), /no longer waits for: the rethink of G60 "Side stairs" .* \(the evaluation of G60 ended\)/)
  const empty = await board.server({ action: 'rethink-free', goal: 'G60' })
  assert.deepEqual([empty.result.freed, empty.result.changed], [[], false])
  // Only the person and the board free it.
  assert.equal((await board.chat('Main', { action: 'rethink-free', goal: 'G60' })).status, 403)
})

test('the hold words carry no step or ask id; a step that waits on a step AND a rethink stays held after the step is done', () => {
  const line = rethinkLine('G60', 'the tries of B1068 and Q12 "stairs"', '2026-11-07 10:55')
  assert.equal(line, `the rethink of G60 "the tries of and 'stairs'" (2026-11-07 10:55)`)
  assert.doesNotMatch(line, /\b[BQ]\d+\b/)
  const held = file({ Id: 'B5', Kind: 'step', State: 'refined', Refined: 'ready', 'Waits for': line })
  assert.deepEqual(waitIds(held), [], 'no id in the words')
  assert.equal(waitWords(held), line)
  assert.equal(readyHold(held, { store: { items: new Map() } }), `waits for: ${line}`)
  assert.equal(isReady(held, { store: { items: new Map() } }), false)
  // Beside a wait for a step that is done: the rethink holds all the same.
  const both = file({ Id: 'B5', Kind: 'step', State: 'refined', Refined: 'ready', 'Waits for': `B7; ${line}` })
  assert.deepEqual(waitIds(both), ['B7'])
  assert.equal(waitWords(both), line)
  const items = new Map([['B7', file({ Id: 'B7', Kind: 'step', State: 'done' })]])
  assert.equal(readyHold(both, { store: { items } }), `waits for: ${line}`)
  assert.equal(rethinkWords(file({ Id: 'B5', Kind: 'step', 'Waits for': 'B7' })), null)
  assert.equal(withHold('B7', 'G60', line), `B7; ${line}`)
  assert.equal(withHold(line, 'G60', line), line)
  assert.equal(withoutHoldOf(`B7; ${line}`, 'G60'), 'B7')
  assert.equal(withoutHoldOf(line, 'G60'), null)
  assert.equal(withoutHoldOf(`${line}; ${rethinkLine('G61', 'x', '2026-11-07 10:56')}`, 'G60'), 'the rethink of G61 "x" (2026-11-07 10:56)')
})

test('unblock of the step a held step also waited for leaves the rethink words', async t => {
  const board = await fresh(t)
  await hold(board, { title: 'Side stairs' })
  // B2 waits for "B7; the rethink ...": B7 is done, so the wait on B7 may be cleared, never the rethink.
  const cleared = await board.chat('Main', { action: 'unblock', id: 'B2', on: 'B7' })
  assert.equal(valueOf(await board.item('B2'), 'Waits for'), `B7; the rethink of G60 "Side stairs" (${MINUTE})`, JSON.stringify(cleared))
})

test('topicOf and rethinkTopicsOf: the topics the Focus page lists, each with its open steps', () => {
  const items = new Map(STEPS.map(one => [valueOf(one, 'Id'), one]))
  const found = topicOf({ node: NODE, items, rows: ROWS, of: 'B1' })
  assert.deepEqual([found.ok, found.title, sorted(found.steps)], [true, 'Side stairs', ['B1', 'B2', 'B3', 'B4', 'B6', 'B8', 'B20']])
  assert.equal(topicOf({ node: NODE, items, title: 'Nope' }).ok, false)
  const topics = rethinkTopicsOf(NODE, items, { prefix: 'Team - ' })
  assert.deepEqual(topics.map(one => [one.title, one.kind, one.steps.map(row => row.id)]), [
    ['Side stairs', 'part', ['B1', 'B2', 'B6', 'B8']],
    ['Walls', 'part', ['B9']],
    ['the tries of Stairs try', 'chain', ['B30', 'B31']],
  ])
  assert.deepEqual(topics[0].steps[0], { id: 'B1', title: 'Stairs try B1', state: 'in progress', owner: 'Worker 5' })
  // A topic whose steps are all done is not listed.
  const finished = new Map(items)
  finished.set('B9', step('B9', 'done'))
  assert.deepEqual(rethinkTopicsOf(NODE, finished).map(one => one.title), ['Side stairs', 'the tries of Stairs try'])
})

test('a checkpoint on a step held for the rethink is the stop checkpoint: the step is given back (refined, still held), the worker free', async t => {
  const board = await fresh(t)
  await hold(board, { title: 'Side stairs' })
  const before = await board.item('B1')
  assert.equal(valueOf(before, 'State'), 'in progress')
  const saved = await board.chat('Worker 5', { action: 'step', id: 'B1', commit: 'abc1234', next: 'stopped for the rethink' })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.match(saved.result.text, /given back/)
  const after = await board.item('B1')
  assert.deepEqual([valueOf(after, 'State'), valueOf(after, 'Owner'), valueOf(after, 'Checkpoint')?.startsWith('abc1234')], ['refined', null, true])
  assert.match(valueOf(after, 'Waits for'), /^the rethink of G60 /)
  // A step not held for a rethink stays with its worker on a checkpoint.
  const other = await board.chat('Worker 5', { action: 'step', id: 'B31', commit: 'abc1234', next: 'x' })
  assert.notEqual(valueOf(await board.item('B31'), 'State'), 'refined', JSON.stringify(other))
})

test('the tick frees a hold only for a recorded end: a goal missing from the map, or still evaluating, is never freed', () => {
  const nodes = [{ id: 'G60', evaluationAsked: '2026-11-07 11:30' }, { id: 'G61', evaluationAsked: null }, { id: 'G62', evaluationAsked: null, state: 'done' }]
  const holds = new Set(['G60', 'G61', 'G62', 'G99'])
  assert.deepEqual(goalsToFree(nodes, holds), ['G61', 'G62'])
  assert.deepEqual(goalsToFree(nodes, holds, new Set(['G61'])), ['G62'])
  assert.deepEqual(goalsToFree([], holds), [])
  assert.deepEqual(goalsToFree(nodes, new Set(['G60'])), [])
})
