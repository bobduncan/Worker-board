// B303: the main chat queues a step before its refine. The flow lets a step be queued only once it is refined (B285),
// so the wish is kept on the step ("Queue when refined: ..."), the refine gate sends the step to the Advisor, and once
// it is refined the board queues it by itself, as the server, with what was asked. Every other refusal of a queue
// stays one. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { refineWhenDue } from '../../src/refineGate.mjs'
import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW, parseFlow } from '../../src/work/flow.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { itemOfStep, storeFromText } from '../../src/work/read.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const BACKLOG = [
  '# Backlog',
  '',
  '## Kite work',
  '- [ ] B1 Paint the kite tail (for Kite; about 1 h)',
  '- [x] B2 Cut the kite paper',
  '- [ ] B3 Tie the kite string',
  '',
].join('\n')
const ROLES = { Lead: 'main', Kite: 'worker', Oracle: 'advisor' }
/** The default flow without the board's own queue after a refine: as a project's older flow.json says it. */
const OLDER_FLOW = { step: { ...DEFAULT_FLOW.step, moves: DEFAULT_FLOW.step.moves.filter(move => move.when !== 'a queue was asked before its refine') } }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-queue-refine-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Kite']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, ctx, lead: as('Lead'), kite: as('Kite'), oracle: as('Oracle'), person: body => workApi(body, { ...ctx, as: 'person' }), server: body => workApi(body, { ...ctx, as: 'server' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const history = async (dir, id) => (await item(dir, id)).sections.get('History')

test('the default flow lets the board queue a refined step whose queue was asked before its refine', () => {
  assert.deepEqual(DEFAULT_FLOW.step.moves.find(move => move.when === 'a queue was asked before its refine'), { from: 'refined', to: 'queued', by: 'server', when: 'a queue was asked before its refine' })
  assert.equal(parseFlow(JSON.stringify(OLDER_FLOW)).problem, null)
})

test('Main queues a step before its refine: the wish is kept, and the board queues it by itself once it is refined', async () => {
  const { dir, lead, oracle } = await fresh()
  try {
    const asked = await lead({ action: 'queue', id: 'B3', for: 'Kite', after: 'B1', about: '1.5 h' })
    assert.equal(asked.ok, true, asked.why)
    assert.equal(asked.result.text, 'B3 is not refined yet: the Advisor refines it first, then the board queues it for Kite by itself.')
    let three = await item(dir, 'B3')
    assert.deepEqual(['State', 'Owner', 'Queue when refined'].map(key => valueOf(three, key)), ['new', null, 'for Kite; after B1; about 1.5 h'])
    assert.equal((await history(dir, 'B3')).at(-1), '- 2026-10-17 11:06 Lead: queue asked before its refine: for Kite; after B1; about 1.5 h')

    await oracle({ action: 'refine', id: 'B3', summary: 'One knot per kite.' })
    const refined = await oracle({ action: 'refined', id: 'B3', what: ['the knot'] })
    assert.equal(refined.ok, true, refined.why)
    three = await item(dir, 'B3')
    assert.deepEqual(['State', 'Owner', 'Blocked by', 'Waits for', 'Estimate', 'Queue when refined'].map(key => valueOf(three, key)), ['queued', 'Kite', 'B1', null, '1.5 h', null])
    assert.deepEqual((await history(dir, 'B3')).slice(-2), [
      '- 2026-10-17 11:06 server: refined → queued',
      '- 2026-10-17 11:06 server: queued for Kite; after B1; about 1.5 h (asked by Lead before its refine)',
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a wish the board could not carry out at the refine is carried out by the reconciler\'s move', async () => {
  const { dir, lead, oracle, server } = await fresh()
  try {
    assert.equal((await lead({ action: 'queue', id: 'B3', for: 'Kite' })).ok, true)
    // Refined while the flow did not let the board queue it: it stays refined, the wish kept.
    await writeFile(join(dir, 'flow.json'), JSON.stringify(OLDER_FLOW))
    await oracle({ action: 'refine', id: 'B3', summary: 'One knot per kite.' })
    assert.equal((await oracle({ action: 'refined', id: 'B3', what: ['the knot'] })).ok, true)
    let three = await item(dir, 'B3')
    assert.deepEqual(['State', 'Queue when refined'].map(key => valueOf(three, key)), ['refined', 'for Kite'])
    // The flow lets it now: the reconciler names the move, the board makes it with what was asked.
    await rm(join(dir, 'flow.json'))
    const store = await readStore(dir)
    const plan = reconcile({ store, lanes: [], now: NOW + 120_000, times: { graceMs: 60_000, askMs: 60_000 } })
    assert.deepEqual(plan.moves, [{ id: 'B3', to: 'queued', why: 'refined → queued (a queue was asked before its refine)' }])
    const moved = await server({ action: 'advance', id: 'B3', to: 'queued' })
    assert.equal(moved.ok, true, moved.why)
    three = await item(dir, 'B3')
    assert.deepEqual(['State', 'Owner', 'Queue when refined'].map(key => valueOf(three, key)), ['queued', 'Kite', null])
    assert.equal((await history(dir, 'B3')).at(-1), '- 2026-10-17 11:06 server: queued for Kite (asked by Lead before its refine)')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('every other refusal of a queue stays one: a worker, a step done, a flow that would never queue it, a bad time', async () => {
  const { dir, lead, kite, person } = await fresh()
  try {
    assert.deepEqual(await kite({ action: 'queue', id: 'B3', for: 'Kite' }), { ok: false, status: 409, why: 'B3: no move from new to queued (flow.json)' })
    assert.deepEqual(await lead({ action: 'queue', id: 'B2', for: 'Kite' }), { ok: false, status: 409, why: 'B2: no move from done to queued (flow.json)' })
    // The person may not queue by the default flow, before the refine either.
    assert.equal((await person({ action: 'queue', id: 'B3', for: 'Kite' })).ok, false)
    assert.equal((await lead({ action: 'queue', id: 'B3', for: 'Kite', about: 'soon' })).status, 400)
    await writeFile(join(dir, 'flow.json'), JSON.stringify(OLDER_FLOW))
    assert.deepEqual(await lead({ action: 'queue', id: 'B3', for: 'Kite' }), { ok: false, status: 409, why: 'B3: no move from new to queued (flow.json)' })
    assert.equal(valueOf(await item(dir, 'B3'), 'Queue when refined'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the wish shows in the backlog view, comes back from it, and the refine gate sends that step to the Advisor', () => {
  const text = BACKLOG.replace('- [ ] B3 Tie the kite string', '- [ ] B3 Tie the kite string\n  [store] Queue when refined: for Kite; about 1 h')
  const work = storeFromText(text, { now: NOW })
  assert.equal(valueOf(work.items.get('B3'), 'Queue when refined'), 'for Kite; about 1 h')
  assert.equal(itemOfStep(work, 'B3').queueWhenRefined, 'for Kite; about 1 h')
  // An old step (not above the first look) the main chat asked to queue: refined first, as a step it queued.
  const step = { id: 'B3', text: 'Tie the kite string', title: 'Tie the kite string', status: 'open', refined: null, worker: null, item: itemOfStep(work, 'B3') }
  const due = refineWhenDue({ backlog: [{ name: 'Kite work', steps: [step] }], advisor: { name: 'Oracle' } }, [], { since: 9, queuedBefore: [], waiting: [] }, NOW)
  assert.equal(due.refine?.about, 'B3')
  assert.equal(due.refine?.why, 'queued')
  // Without the wish an old step waits for its turn.
  const none = refineWhenDue({ backlog: [{ name: 'Kite work', steps: [{ ...step, item: { ...step.item, queueWhenRefined: null } }] }], advisor: { name: 'Oracle' } }, [], { since: 9, queuedBefore: [], waiting: [] }, NOW)
  assert.equal(none.refine, null)
})
