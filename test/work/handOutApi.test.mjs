// Redesign Part 2 (spec 2026-10-24, "The board hands out all work"): the give (refined → queued by the server, for one
// worker), the take-back (queued → refined by the server) and the person's pin, through the work API; Main's queue,
// requeue and unqueue are gone. The API refuses a second give of a task and a give to a worker that holds one (Review
// Focus 4). Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW, flowHandsOut, parseFlow } from '../../src/work/flow.mjs'
import { GUARDS } from '../../src/work/guards.mjs'
import { HEAD_KEYS, valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 25, 10, 0).getTime()
const ROLES = { Lead: 'main', Digger: 'worker', Mower: 'worker', Partner: 'advisor', Helper: 'helper' }

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const step = (id, state, more = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Activity: 'Garden', Since: stamp(NOW - 60 * MIN), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more },
  { History: [`- ${stamp(NOW - 60 * MIN)} Partner: made`] })

async function garden(...all) {
  const dir = await mkdtemp(join(tmpdir(), 'hand-out-api-'))
  const items = new Map(all.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW - 60 * MIN })
  const ctx = (at = NOW) => ({ dir, now: at, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), overlapsOfStore: true })
  return {
    dir,
    server: (body, at) => workApi(body, { ...ctx(at), as: 'server' }),
    person: (body, at) => workApi(body, { ...ctx(at), as: 'person' }),
    as: chat => (body, at) => workApi({ chat, ...body }, ctx(at)),
    read: async id => (await readStore(dir)).items.get(id),
  }
}
const cleanUp = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('the give: the board hands a ready task to one worker, once; never to a worker that holds one; never a pinned one to another', async () => {
  const one = await garden(step('B1', 'refined'), step('B2', 'in progress', { Owner: 'Mower' }), step('B3', 'refined', { Pinned: 'Mower' }), step('B4', 'refined'))
  try {
    const given = await one.server({ action: 'advance', id: 'B1', to: 'queued', for: 'Digger' })
    assert.equal(given.ok, true, given.why)
    assert.deepEqual(given.result.given, { id: 'B1', chat: 'Digger', since: '2026-10-25 10:00' })
    const b1 = await one.read('B1')
    assert.deepEqual(['State', 'Owner', 'Since'].map(key => valueOf(b1, key)), ['queued', 'Digger', '2026-10-25 10:00'])
    assert.equal(b1.sections.get('History').at(-1), '- 2026-10-25 10:00 server: refined → queued (given by the board to Digger)')
    // A second give of B1, to anyone: refused.
    assert.equal((await one.server({ action: 'advance', id: 'B1', to: 'queued', for: 'Mower' })).status, 409)
    // Digger holds B1 now (queued): no second task for it; Mower holds B2 in progress: none for it either.
    assert.equal((await one.server({ action: 'advance', id: 'B4', to: 'queued', for: 'Digger' })).status, 409)
    assert.equal((await one.server({ action: 'advance', id: 'B4', to: 'queued', for: 'Mower' })).status, 409)
    // B3 is pinned to Mower: not to Digger.
    const pinned = await one.server({ action: 'advance', id: 'B3', to: 'queued', for: 'Digger' })
    assert.equal(pinned.status, 409)
    assert.match(pinned.why, /pinned to Mower/)
    // Only the board gives; the partner's helper gets no task.
    assert.equal((await one.as('Lead')({ action: 'advance', id: 'B4', to: 'queued', for: 'Mower' })).status, 403)
    assert.equal((await one.server({ action: 'advance', id: 'B4', to: 'queued', for: 'Helper' })).status, 409)
  } finally {
    await cleanUp(one.dir)
  }
})

test('the give holds to the ready list: blocked, an open blocking ask or Touches under way refuse it', async () => {
  const touches = (one, path) => ({ ...one, sections: new Map([...one.sections, ['Context', [`  Touches: ${path}`]]]) })
  const one = await garden(
    step('B1', 'refined', { 'Blocked by': 'B2' }), step('B2', 'in progress', { Owner: 'Mower' }),
    touches(step('B3', 'refined'), 'src/a.mjs'), touches(step('B5', 'in progress', { Owner: 'Mower' }), 'src'),
    step('B6', 'refined'), item({ Id: 'Q1', Kind: 'ask', Title: 'Which hedge?', State: 'open', Owner: 'Partner', Since: stamp(NOW - 5 * MIN), Asks: 'decide', Blocking: 'yes', Of: 'B6' }),
  )
  try {
    for (const id of ['B1', 'B3', 'B6']) assert.equal((await one.server({ action: 'advance', id, to: 'queued', for: 'Digger' })).status, 409, id)
  } finally {
    await cleanUp(one.dir)
  }
})

test('the take-back: queued → refined, no Owner, the History line says why and whether its worker was stuck', async () => {
  const one = await garden(step('B1', 'refined'), step('B2', 'in progress', { Owner: 'Mower' }))
  try {
    await one.server({ action: 'advance', id: 'B1', to: 'queued', for: 'Digger' })
    const back = await one.server({ action: 'advance', id: 'B1', to: 'refined', takeBack: { chat: 'Digger', stuck: true, why: 'not taken within 2 min' } }, NOW + 2 * MIN)
    assert.equal(back.ok, true, back.why)
    const b1 = await one.read('B1')
    assert.deepEqual(['State', 'Owner'].map(key => valueOf(b1, key)), ['refined', null])
    assert.equal(b1.sections.get('History').at(-1), '- 2026-10-25 10:02 server: queued → refined (taken back from Digger: not taken within 2 min; stuck)')
    // Not stuck: no "; stuck".
    await one.server({ action: 'advance', id: 'B1', to: 'queued', for: 'Digger' }, NOW + 3 * MIN)
    await one.server({ action: 'advance', id: 'B1', to: 'refined', takeBack: { chat: 'Digger', stuck: false, why: 'not taken within 2 min' } }, NOW + 5 * MIN)
    assert.equal((await one.read('B1')).sections.get('History').at(-1), '- 2026-10-25 10:05 server: queued → refined (taken back from Digger: not taken within 2 min)')
    // Only from queued, and only from the worker named.
    assert.equal((await one.server({ action: 'advance', id: 'B2', to: 'refined', takeBack: { chat: 'Mower', stuck: false, why: 'x' } })).status, 409)
    await one.server({ action: 'advance', id: 'B1', to: 'queued', for: 'Digger' }, NOW + 6 * MIN)
    assert.equal((await one.server({ action: 'advance', id: 'B1', to: 'refined', takeBack: { chat: 'Mower', stuck: false, why: 'x' } })).status, 409)
  } finally {
    await cleanUp(one.dir)
  }
})

test('the person pins a task to a worker, moves the pin, unpins it; not Main, not a queued task, not the helper', async () => {
  const one = await garden(step('B1', 'refined'), step('B2', 'new'), step('B3', 'queued', { Owner: 'Digger' }))
  try {
    const pinned = await one.person({ action: 'pin', id: 'B1', for: 'Mower' })
    assert.equal(pinned.ok, true, pinned.why)
    assert.equal(valueOf(await one.read('B1'), 'Pinned'), 'Mower')
    assert.equal((await one.read('B1')).sections.get('History').at(-1), '- 2026-10-25 10:00 person: pinned to Mower')
    assert.equal((await one.person({ action: 'pin', id: 'B2', for: 'Digger' })).ok, true)
    assert.equal((await one.as('Lead')({ action: 'pin', id: 'B1', for: 'Digger' })).status, 403)
    assert.equal((await one.person({ action: 'pin', id: 'B3', for: 'Mower' })).status, 409)
    assert.equal((await one.person({ action: 'pin', id: 'B1', for: 'Helper' })).status, 409)
    assert.equal((await one.person({ action: 'pin', id: 'B1', for: 'Nobody' })).status, 409)
    const unpinned = await one.person({ action: 'pin', id: 'B1', for: '' })
    assert.equal(unpinned.ok, true, unpinned.why)
    assert.equal(valueOf(await one.read('B1'), 'Pinned'), null)
    assert.equal((await one.read('B1')).sections.get('History').at(-1), '- 2026-10-25 10:00 person: unpinned')
    // The board unpins too (a pin to a chat gone: the supervisor).
    assert.equal((await one.server({ action: 'pin', id: 'B2', for: '' })).ok, true)
    assert.ok(HEAD_KEYS.step.indexOf('Pinned') === HEAD_KEYS.step.indexOf('Owner') + 1)
  } finally {
    await cleanUp(one.dir)
  }
})

test('queue, requeue and unqueue are gone, with one line saying why', async () => {
  const one = await garden(step('B1', 'refined'), step('B2', 'queued', { Owner: 'Digger' }))
  try {
    const words = action => `"${action}" is gone: the board hands out all tasks (redesign Part 2); the person pins a task on the board.`
    for (const [action, body] of [['queue', { id: 'B1', for: 'Digger' }], ['requeue', { id: 'B2', for: 'Mower' }], ['unqueue', { id: 'B2' }]]) {
      const done = await one.as('Lead')({ action, ...body })
      assert.deepEqual([done.status, done.why], [410, words(action)], action)
    }
    assert.equal((await one.person({ action: 'unqueue', id: 'B2' })).status, 410)
    assert.equal(valueOf(await one.read('B2'), 'Owner'), 'Digger')
  } finally {
    await cleanUp(one.dir)
  }
})

test('a failed result check makes its fix refined, for nobody: a follow-up of its builder', async () => {
  const built = item({ Id: 'B1', Kind: 'step', Title: 'Light the lamps', State: 'review', Owner: 'Digger', Activity: 'Garden', Since: stamp(NOW - 10 * MIN), Refined: 'ready' }, {
    'What we build': ['- a lamp at every bench'],
    History: [`- ${stamp(NOW - 20 * MIN)} Digger: in progress → review`, `- ${stamp(NOW - 19 * MIN)} server: check passed: branch gone`],
  })
  const one = await garden(built)
  try {
    const checked = await one.as('Partner')({ action: 'checked', id: 'B1', evidence: 'none (nothing to see)', points: ['fail: a lamp at every bench (one bench has none)'] })
    assert.equal(checked.ok, true, checked.why)
    const fix = await one.read(checked.result.fix)
    assert.deepEqual(['State', 'Owner', 'Fix of', 'Refined'].map(key => valueOf(fix, key)), ['refined', null, 'B1', 'ready'])
    assert.ok(!fix.sections.get('History').some(line => / → queued|queued for/.test(line)))
  } finally {
    await cleanUp(one.dir)
  }
})

test('the flow: the board gives and takes back; an older flow.json still reads, but hands out nothing', () => {
  const moves = DEFAULT_FLOW.step.moves
  assert.deepEqual(moves.find(move => move.from === 'refined' && move.to === 'queued'), { from: 'refined', to: 'queued', by: 'server', sets: ['Owner'], when: 'the board hands it out' })
  assert.equal(moves.filter(move => move.from === 'refined' && move.to === 'queued').length, 1)
  assert.deepEqual(moves.filter(move => move.from === 'queued' && ['refined', 'new'].includes(move.to)), [{ from: 'queued', to: 'refined', by: 'server' }, { from: 'queued', to: 'new', by: 'server' }])
  assert.equal(flowHandsOut(DEFAULT_FLOW), true)
  const older = JSON.stringify({ step: { states: DEFAULT_FLOW.step.states, moves: [
    { from: 'refined', to: 'queued', by: 'main', when: 'Touches overlaps no taken step' },
    { from: 'refined', to: 'queued', by: 'server', when: 'a queue was asked before its refine' },
    { from: 'refined', to: 'queued', by: 'server', when: 'an incident fix is ready' },
    { from: 'queued', to: 'refined', by: ['main', 'person'] },
  ] } })
  const read = parseFlow(older)
  assert.equal(read.problem, null)
  assert.equal(flowHandsOut(read.flow), false)
  assert.equal(GUARDS['a queue was asked before its refine'](), false)
  assert.equal(GUARDS['an incident fix is ready'](), false)
})
