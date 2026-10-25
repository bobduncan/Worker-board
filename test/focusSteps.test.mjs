// Focus 2, the review's findings: the partner's steps from an agreed how are refined when made (no second round from
// the board's refine gate), and a decide ask the partner files on one does not hold it back. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { isRefined } from '../src/backlog.mjs'
import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { refineAsksOf } from '../src/work/stepAsks.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const NOW = new Date(2026, 9, 18, 15, 0).getTime()
const BACKLOG = '# Backlog\n\n## Board work #focus\n- [ ] B1 Draw the strip\n'
const ROLES = { Main: 'main', Board: 'worker', Advisor: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'focus-steps-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, main: as('Main'), board: as('Board'), advisor: as('Advisor'), server: body => workApi(body, { ...ctx, as: 'server' }) }
}
const itemOf = async (dir, id) => (await readStore(dir)).items.get(id)
const STEP = { action: 'new', title: 'Give hits a heavy landing', activity: 'Board work', goal: 'G6', text: 'Hits land with weight.', summary: 'Hits, pushes and deaths land with weight.', size: '3 h', what: ['a short shake on a heavy hit', 'Not in it: new map art'] }

test('a step the partner makes from the agreed how (goal, summary, what) is refined at once', async () => {
  const { dir, advisor } = await fresh()
  const made = await advisor(STEP)
  assert.equal(made.ok, true, made.why)
  const step = await itemOf(dir, made.result.id)
  assert.deepEqual([valueOf(step, 'State'), valueOf(step, 'Refined'), valueOf(step, 'Goal')], ['refined', 'ready', 'G6'])
  const block = step.sections.get('Refined')
  assert.match(block[0], /^\s*Refined \(2026-10-18 15:01; ready; from the how of G6 by Advisor\):$/)
  assert.ok(block.some(one => /Summary: Hits, pushes and deaths land with weight\./.test(one)))
  assert.ok(block.some(one => /Size: about 3 h/.test(one)))
  assert.ok(block.some(one => /- a short shake on a heavy hit/.test(one)))
  // So the board's refine gate sends no round for it: the backlog reads it as refined.
  assert.equal(isRefined({ ready: true, asks: refineAsksOf((await readStore(dir)).items, step) }), true)
})

test('only the partner makes a step refined at once, and only with its goal, summary and what', async () => {
  const { advisor, main, board } = await fresh()
  for (const as of [main, board]) assert.equal((await as(STEP)).status, 403)
  assert.equal((await advisor({ ...STEP, goal: undefined })).status, 400)
  assert.equal((await advisor({ ...STEP, summary: undefined })).status, 400)
  // Without "what" it is an ordinary new step.
  const plain = await advisor({ ...STEP, what: undefined, summary: undefined, size: undefined })
  assert.equal(plain.ok, true)
})

test('a decide ask the partner files on such a step does not hold it back: it is refined, and the board gives it', async () => {
  const { dir, advisor, main, server } = await fresh()
  const { result: { id } } = await advisor(STEP)
  const asked = await advisor({ action: 'ask', of: id, kind: 'decide', text: 'How strong is the shake?', options: ['A soft', 'B hard'], advice: 'A' })
  assert.equal(asked.ok, true, asked.why)
  const step = await itemOf(dir, id)
  assert.deepEqual(refineAsksOf((await readStore(dir)).items, step), [])
  const queued = await server({ action: 'advance', id, to: 'queued', for: 'Board' })
  assert.equal(queued.ok, true, queued.why)
  assert.equal(valueOf(await itemOf(dir, id), 'State'), 'queued')
  // Another chat's ask on it still counts, as on any step.
  const other = await advisor({ ...STEP, title: 'Mark the danger before the click' })
  await main({ action: 'ask', of: other.result.id, kind: 'decide', text: 'Red or orange?' })
  assert.equal(refineAsksOf((await readStore(dir)).items, await itemOf(dir, other.result.id)).length, 1)
})
