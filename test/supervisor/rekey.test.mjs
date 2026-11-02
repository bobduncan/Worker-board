// Signals change 4's follow-up (2026-11-02): change 4 changed handover-unanswered's key (per envelope → per worker and
// spell) without a migration: the open X119-X122 were re-filed as X124-X127 and kept counting. Now a key change carries
// an entry in rekey.mjs: a standing incident under the old form is re-keyed where the new key is free, superseded where
// another holds it, and every change writes one History line. Temporary stores, made-up items; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { recordFindings } from '../../src/supervisor/incidents.mjs'
import { KEY_MIGRATIONS, STANDING, rekeyPlan } from '../../src/supervisor/rekey.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 10, 31).getTime()
const ROLES = { Lead: 'main', Painter: 'worker', Partner: 'advisor' }

async function store(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rekey-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 Teach the lanes to wake (for Painter; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  let clock = NOW
  const ctx = () => ({ dir, now: clock, prefix: '', roleOf: chat => ROLES[chat] ?? null })
  return {
    tick: minutes => { clock += minutes * MIN },
    board: body => workApi(body, { ...ctx(), as: 'server' }),
    chat: (chat, body) => workApi({ chat, ...body }, ctx()),
    items: async () => (await readStore(dir)).items,
    item: async id => (await readStore(dir)).items.get(id),
  }
}
const head = (item, key) => item.head.get(key)
const envelope = (id, to, atMinutes) => ({ id, at: NOW + atMinutes * MIN, to, command: 'handover', about: to, kind: 'task', step: 'B12', state: 'dropped', netAt: NOW + (atMinutes + 10) * MIN })
const oldFinding = (key, subject) => ({ rule: 'handover-unanswered', key, subject, text: `${subject} did not answer its hand-over (B12) within 10 min`, evidence: 'the net fired' })
const newKeyOf = (to, atMinutes) => `handover-unanswered ${to} ${NOW + atMinutes * MIN}`

test('rekeyPlan: an old handover-unanswered key is re-keyed to the worker and its spell (the envelope\'s minute without a wake record, the spell with one); a free new key moves, a held one supersedes, a gone envelope supersedes by the change', async t => {
  const s = await store(t)
  // X1: the old form, its envelope in the outbox; X2: the old form for a worker whose new key X3 holds already; X4: the old form, envelope gone.
  await recordFindings([oldFinding('handover-unanswered 83c1a7be1feab83b', 'Painter')], { work: s.board })
  await recordFindings([oldFinding('handover-unanswered fae092d4f2555ebe', 'Weeder')], { work: s.board })
  await recordFindings([oldFinding(newKeyOf('Weeder', 10), 'Weeder')], { work: s.board })
  await recordFindings([oldFinding('handover-unanswered 0000000000000000', 'Digger')], { work: s.board })
  const outbox = [envelope('83c1a7be1feab83b', 'Painter', 0), envelope('fae092d4f2555ebe', 'Weeder', 10)]
  const plan = rekeyPlan({ items: await s.items(), outbox, wakes: null })
  assert.deepEqual(plan.moves.map(one => [one.id, one.key]), [['X1', newKeyOf('Painter', 0)]])
  assert.match(plan.moves[0].why, /^re-keyed from "handover-unanswered 83c1a7be1feab83b": the key form of handover-unanswered changed \(change 4/)
  assert.deepEqual(plan.closes.map(one => one.id), ['X2', 'X4'])
  assert.match(plan.closes[0].why, /^superseded by X3: the key form of handover-unanswered changed/)
  assert.match(plan.closes[1].why, /^superseded: the key form of handover-unanswered changed .* cannot be told any more$/)
  // With a wake record: the newest spell that began before the envelope keys it, as the rule does.
  const spell = NOW - 20 * 60 * MIN
  const withSpell = rekeyPlan({ items: await s.items(), outbox, wakes: { Painter: { spells: [spell] } } })
  assert.equal(withSpell.moves[0].key, `handover-unanswered Painter ${spell}`)
  // Carried out by the board: the Key moves with a History line, the superseded ones close with theirs; a second plan is empty.
  const done = await s.board({ action: 'incidents-rekey', ...plan })
  assert.deepEqual([done.result.moved, done.result.closed], [['X1'], ['X2', 'X4']])
  const x1 = await s.item('X1')
  assert.equal(head(x1, 'Key'), newKeyOf('Painter', 0))
  assert.equal(head(x1, 'State'), 'open')
  assert.match(x1.sections.get('History').at(-1), /server: re-keyed from "handover-unanswered 83c1a7be1feab83b"/)
  const x2 = await s.item('X2')
  assert.equal(head(x2, 'State'), 'closed')
  assert.match(x2.sections.get('History').at(-1), /server: closed: superseded by X3/)
  assert.deepEqual(rekeyPlan({ items: await s.items(), outbox, wakes: null }), { moves: [], closes: [] })
  // The new key now counts X1, not a new incident.
  const again = await recordFindings([oldFinding(newKeyOf('Painter', 0), 'Painter')], { work: s.board })
  assert.deepEqual(again.counted, ['X1'])
})

test('rekeyPlan: only standing incidents; a fixed or closed one under the old form is left alone; the action refuses every role but the board', async t => {
  const s = await store(t)
  await recordFindings([oldFinding('handover-unanswered 83c1a7be1feab83b', 'Painter')], { work: s.board })
  await s.chat('Partner', { action: 'drop', id: 'X1', why: 'handled' })
  assert.deepEqual(rekeyPlan({ items: await s.items(), outbox: [envelope('83c1a7be1feab83b', 'Painter', 0)] }), { moves: [], closes: [] })
  assert.deepEqual(STANDING, ['open', 'came back', 'with the advisor', 'with the supervisor', 'fix'])
  assert.equal(KEY_MIGRATIONS[0].rule, 'handover-unanswered')
  assert.equal((await s.chat('Partner', { action: 'incidents-rekey', moves: [{ id: 'X1', key: 'x' }] })).ok, false)
  assert.equal((await s.chat('Lead', { action: 'incidents-rekey', closes: [{ id: 'X1', why: 'x' }] })).ok, false)
})
