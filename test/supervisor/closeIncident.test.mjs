// B685: the partner closes an incident that is a false alarm or was handled already (`work drop X<n>` with why). The
// incident is "closed": it counts as fixed in the lists and the health summary, and a newer sighting opens it again.
// Temporary stores, made-up items; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { incidentCards } from '../../src/supervisor/cards.mjs'
import { incidentsOf, recordFindings } from '../../src/supervisor/incidents.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 9, 0).getTime()
const ROLES = { Lead: 'main', Painter: 'worker', Partner: 'advisor', Watcher: 'supervisor' }

async function store(t) {
  const dir = await mkdtemp(join(tmpdir(), 'close-incident-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const backlog = '# Backlog\n\n## Work\n- [ ] B12 Teach the lanes to wake (for Painter; about 1 h)\n'
  await writeStore(dir, migrateBacklog(backlog, { now: NOW }), undefined, { now: NOW })
  let clock = NOW
  const ctx = () => ({ dir, now: clock, prefix: '', roleOf: chat => ROLES[chat] ?? null })
  return {
    tick: minutes => { clock += minutes * MIN },
    board: body => workApi(body, { ...ctx(), as: 'server' }),
    chat: (chat, body) => workApi({ chat, ...body }, ctx()),
    person: body => workApi(body, { ...ctx(), as: 'person' }),
    items: async () => (await readStore(dir)).items,
    item: async id => (await readStore(dir)).items.get(id),
  }
}
const head = (item, key) => item.head.get(key)
const finding = (more = {}) => ({ rule: 'unknown-lane', key: 'unknown-lane Painter', subject: 'Painter', text: 'Painter unknown for 11 min', evidence: 'state unknown since 08:49', ...more })

test('the partner closes an open incident with a why: State closed, Since now, the why and who in its History', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board })
  s.tick(5)
  const closed = await s.chat('Partner', { action: 'drop', id: 'X1', why: 'a false alarm: the chat was only slow' })
  assert.equal(closed.ok, true)
  const x1 = await s.item('X1')
  assert.deepEqual([head(x1, 'State'), head(x1, 'Since')], ['closed', '2026-10-24 09:05'])
  assert.match(x1.sections.get('History').at(-1), /Partner: closed: a false alarm: the chat was only slow$/)
  // With no why it is refused; the incident stays as it was.
  const s2 = await store(t)
  await recordFindings([finding()], { work: s2.board })
  assert.equal((await s2.chat('Partner', { action: 'drop', id: 'X1', why: '' })).ok, false)
  assert.equal(head(await s2.item('X1'), 'State'), 'open')
})

test('an incident with the advisor or one that came back can be closed too; one being fixed, fixed or closed already is refused with a line', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board })
  await s.board({ action: 'incident-told', id: 'X1', to: 'Partner' })
  assert.equal(head(await s.item('X1'), 'State'), 'with the advisor')
  assert.equal((await s.chat('Partner', { action: 'drop', id: 'X1', why: 'handled already' })).ok, true)
  assert.equal((await s.chat('Partner', { action: 'drop', id: 'X1', why: 'again' })).status, 409, 'closed already')

  // Being fixed: refused, and it stays being fixed.
  await recordFindings([finding({ key: 'k2', text: 'Two' })], { work: s.board })
  await s.chat('Partner', { action: 'incident-fix', id: 'X2', fix: 'B12' })
  const fixing = await s.chat('Partner', { action: 'drop', id: 'X2', why: 'no fault left' })
  assert.equal(fixing.ok, false)
  assert.equal(fixing.status, 409)
  assert.match(fixing.why, /X2.*fix/)
  assert.equal(head(await s.item('X2'), 'State'), 'fix')

  // Fixed: refused.
  s.tick(10)
  await s.person({ action: 'tick', id: 'B12' })
  await s.board({ action: 'incidents-fixed' })
  assert.equal(head(await s.item('X2'), 'State'), 'fixed')
  assert.equal((await s.chat('Partner', { action: 'drop', id: 'X2', why: 'no fault left' })).status, 409)

  // Came back: can be closed.
  s.tick(10)
  await recordFindings([finding({ key: 'k2', text: 'Two' })], { work: s.board })
  assert.equal(head(await s.item('X2'), 'State'), 'came back')
  assert.equal((await s.chat('Partner', { action: 'drop', id: 'X2', why: 'a false alarm' })).ok, true)
  assert.equal(head(await s.item('X2'), 'State'), 'closed')
})

test('only the partner closes an incident; a step is still dropped as before', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board })
  for (const chat of ['Painter', 'Watcher']) assert.equal((await s.chat(chat, { action: 'drop', id: 'X1', why: 'a false alarm' })).ok, false, chat)
  assert.equal(head(await s.item('X1'), 'State'), 'open')
  assert.equal((await s.person({ action: 'drop', id: 'B12', why: 'not needed' })).ok, true)
  assert.equal(head(await s.item('B12'), 'State'), 'dropped')
})

test('a closed incident seen again for a case that began before the close only counts; a newer case, or none given, opens it again as came back', async t => {
  const closedOne = async () => {
    const s = await store(t)
    await recordFindings([finding({ since: NOW - 30 * MIN })], { work: s.board })
    s.tick(10)
    await s.chat('Partner', { action: 'drop', id: 'X1', why: 'a false alarm' })
    s.tick(3)
    return s
  }
  // The old case still standing: it only counts, said once.
  let s = await closedOne()
  assert.deepEqual(await recordFindings([finding({ since: NOW - 30 * MIN })], { work: s.board }), { opened: [], returned: [], counted: ['X1'], failed: [] })
  await recordFindings([finding({ since: NOW - 30 * MIN })], { work: s.board })
  let x1 = await s.item('X1')
  assert.deepEqual([head(x1, 'State'), head(x1, 'Count')], ['closed', '3'])
  assert.equal(x1.sections.get('History').filter(entry => /old case still standing/.test(entry)).length, 1, 'said once')
  // A case that began after the close: came back.
  s = await closedOne()
  assert.deepEqual((await recordFindings([finding({ since: NOW + 11 * MIN })], { work: s.board })).returned, ['X1'])
  x1 = await s.item('X1')
  assert.equal(head(x1, 'State'), 'came back')
  assert.match(x1.sections.get('History').at(-1), /server: came back \(seen 2 times\)$/)
  // No since: as for a fixed one, it came back.
  s = await closedOne()
  assert.deepEqual((await recordFindings([finding()], { work: s.board })).returned, ['X1'])
  // The old case still there 2 h after the close outlived it.
  s = await closedOne()
  s.tick(120)
  assert.deepEqual((await recordFindings([finding({ since: NOW - 30 * MIN })], { work: s.board })).returned, ['X1'])
})

test('no fix step can be named for a closed incident, and the board leaves it closed', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board })
  await s.chat('Partner', { action: 'drop', id: 'X1', why: 'a false alarm' })
  assert.equal((await s.chat('Partner', { action: 'incident-fix', id: 'X1', fix: 'B12' })).status, 409)
  assert.deepEqual((await s.board({ action: 'incidents-fixed' })).result.fixed, [])
  assert.equal(head(await s.item('X1'), 'State'), 'closed')
})

test('a closed incident is kept like a fixed one in the lists, and its card says closed, not "sending to the Advisor"', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board })
  await recordFindings([finding({ key: 'k2', text: 'Two' })], { work: s.board })
  await s.chat('Partner', { action: 'drop', id: 'X1', why: 'a false alarm' })
  const items = await s.items()
  assert.deepEqual(incidentsOf(items, NOW).map(one => [one.id, one.state]).sort(), [['X1', 'closed'], ['X2', 'open']])
  // Three days after it was last seen it leaves the list, as a fixed one does.
  assert.deepEqual(incidentsOf(items, NOW + 3 * 24 * 60 * MIN).map(one => one.id), ['X2'])
  const cards = incidentCards({ incidents: incidentsOf(items, NOW), items, lanes: [] })
  const closed = cards.find(card => card.incidents.some(one => one.id === 'X1'))
  assert.equal(closed.state.tone, 'done')
  assert.match(closed.state.text, /closed/)
  assert.equal(closed.phase, 'done', 'counted as fixed')
  assert.equal(cards.find(card => card.incidents.some(one => one.id === 'X2')).state.tone, 'sending')
})

test('a reopened closed incident says its old case outlived the close, not a fix', async t => {
  const s = await store(t)
  await recordFindings([finding({ since: NOW - 30 * MIN })], { work: s.board })
  s.tick(10)
  await s.chat('Partner', { action: 'drop', id: 'X1', why: 'a false alarm' })
  s.tick(120)
  await recordFindings([finding({ since: NOW - 30 * MIN })], { work: s.board })
  const x1 = await s.item('X1')
  assert.equal(head(x1, 'State'), 'came back')
  assert.match(x1.sections.get('History').at(-1), /server: came back \(seen 2 times; old case outlived its close\)$/)
})
