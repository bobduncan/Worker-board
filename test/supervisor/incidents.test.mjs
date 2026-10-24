// The supervisor's Task 3: incidents in the work store (spec 2026-10-24, "Incidents"). A finding of a watch rule, a
// failed rule or the sweep becomes an incident `X<n>`: source, subject, first and last seen, a count, its evidence and
// its state, open → with the advisor → fix B<n> → fixed, or came back. The same key again only counts (Review Focus 2).
// Temporary stores, made-up items; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { recordFindings } from '../../src/supervisor/incidents.mjs'
import { workApi } from '../../src/work/api.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { writeView } from '../../src/work/view.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 9, 0).getTime()
const ROLES = { Lead: 'main', Painter: 'worker', Partner: 'advisor', Watcher: 'supervisor', Second: 'helper' }

async function store(t) {
  const dir = await mkdtemp(join(tmpdir(), 'incidents-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const backlog = '# Backlog\n\n## Work\n- [ ] B12 Teach the lanes to wake (for Painter; about 1 h)\n- [ ] B13 Another fix (for Painter; about 1 h)\n'
  await writeStore(dir, migrateBacklog(backlog, { now: NOW }), undefined, { now: NOW })
  let clock = NOW
  const ctx = () => ({ dir, now: clock, prefix: '', roleOf: chat => ROLES[chat] ?? null })
  return {
    dir,
    tick: minutes => { clock += minutes * MIN },
    board: body => workApi(body, { ...ctx(), as: 'server' }),
    chat: (chat, body) => workApi({ chat, ...body }, ctx()),
    person: body => workApi(body, { ...ctx(), as: 'person' }),
    item: async id => (await readStore(dir)).items.get(id),
    incidents: async () => [...(await readStore(dir)).items.values()].filter(one => one.head.get('Kind') === 'incident'),
  }
}
const head = (item, key) => item.head.get(key)
const finding = (more = {}) => ({ rule: 'unknown-lane', key: 'unknown-lane Painter', subject: 'Painter', text: 'Painter unknown for 11 min, B12 waits', evidence: 'state unknown since 08:49', ...more })

test('a new key opens X1 (open, count 1); the same key again only counts: count 2, last seen moves, no new record', async t => {
  const s = await store(t)
  const first = await recordFindings([finding()], { work: s.board, now: NOW })
  assert.deepEqual(first, { opened: ['X1'], returned: [], counted: [], failed: [] })
  const x1 = await s.item('X1')
  assert.deepEqual(['Kind', 'Title', 'State', 'Source', 'Subject', 'Key', 'First seen', 'Last seen', 'Count', 'Evidence'].map(key => head(x1, key)),
    ['incident', 'Painter unknown for 11 min, B12 waits', 'open', 'unknown-lane', 'Painter', 'unknown-lane Painter', '2026-10-24 09:00', '2026-10-24 09:00', '1', 'state unknown since 08:49'])
  assert.match(x1.sections.get('History').at(-1), /server: opened by the rule unknown-lane$/)
  s.tick(3)
  const again = await recordFindings([finding({ text: 'Painter unknown for 14 min, B12 waits', evidence: 'state unknown since 08:49, still' })], { work: s.board, now: NOW + 3 * MIN })
  assert.deepEqual(again, { opened: [], returned: [], counted: ['X1'], failed: [] })
  const counted = await s.item('X1')
  assert.deepEqual(['State', 'Count', 'First seen', 'Last seen', 'Title', 'Evidence'].map(key => head(counted, key)),
    ['open', '2', '2026-10-24 09:00', '2026-10-24 09:03', 'Painter unknown for 14 min, B12 waits', 'state unknown since 08:49, still'])
  assert.equal(counted.sections.get('History').length, 1, 'a count writes no History line')
  assert.equal((await s.incidents()).length, 1)
})

test('incident-fix X1 B12 (the partner) sets its Fix and its state; B12 done makes X1 fixed; the same key then comes back, count + 1', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board, now: NOW })
  const fix = await s.chat('Partner', { action: 'incident-fix', id: 'X1', fix: 'B12' })
  assert.equal(fix.ok, true, fix.why)
  const fixing = await s.item('X1')
  assert.deepEqual([head(fixing, 'State'), head(fixing, 'Fix')], ['fix', 'B12'])
  assert.match(fix.result.text, /X1: fix B12/)
  assert.match(fixing.sections.get('History').at(-1), /Partner: fix B12$/)
  // Not done yet: nothing changes.
  assert.equal((await s.board({ action: 'incidents-fixed' })).result.changed, false)
  // B12 done: the board's reconcile marks X1 fixed.
  assert.equal((await s.person({ action: 'tick', id: 'B12' })).ok, true)
  s.tick(5)
  const fixed = await s.board({ action: 'incidents-fixed' })
  assert.deepEqual([fixed.ok, fixed.result.fixed], [true, ['X1']])
  const x1 = await s.item('X1')
  assert.equal(head(x1, 'State'), 'fixed')
  assert.match(x1.sections.get('History').at(-1), /server: fixed: B12 is done$/)
  // Seen again: it came back.
  s.tick(30)
  const back = await recordFindings([finding()], { work: s.board, now: NOW + 35 * MIN })
  assert.deepEqual(back, { opened: [], returned: ['X1'], counted: [], failed: [] })
  const returned = await s.item('X1')
  assert.deepEqual([head(returned, 'State'), head(returned, 'Count'), head(returned, 'Fix')], ['came back', '2', 'B12'])
  assert.match(returned.sections.get('History').at(-1), /server: came back \(seen 2 times\)$/)
  // Counted again while it stands: no second "came back".
  assert.deepEqual((await recordFindings([finding()], { work: s.board, now: NOW + 38 * MIN })).counted, ['X1'])
})

test('a fix that is dropped puts the incident back to open', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board, now: NOW })
  await s.chat('Partner', { action: 'incident-fix', id: 'X1', fix: 'B13' })
  assert.equal((await s.chat('Lead', { action: 'drop', id: 'B13', why: 'not needed' })).ok, true)
  const done = await s.board({ action: 'incidents-fixed' })
  assert.deepEqual(done.result.reopened, ['X1'])
  assert.equal(head(await s.item('X1'), 'State'), 'open')
})

test('who may: incident by the board or the supervisor chat; incident-fix by the partner; anyone else is refused', async t => {
  const s = await store(t)
  for (const chat of ['Lead', 'Painter', 'Partner', 'Second']) {
    assert.equal((await s.chat(chat, { action: 'incident', key: 'k', title: 'x' })).status, 403, chat)
  }
  assert.equal((await s.person({ action: 'incident', key: 'k', title: 'x' })).status, 403)
  // The supervisor chat's own finding: from the sweep, with the rule that could catch it.
  const swept = await s.chat('Watcher', { action: 'incident', title: 'Painter worked three hours without a checkpoint', subject: 'Painter', evidence: 'no checkpoint since 06:00', rule: 'a step in progress with no checkpoint for 2 h' })
  assert.equal(swept.ok, true, swept.why)
  const x1 = await s.item('X1')
  assert.deepEqual(['Source', 'Rule wanted', 'Subject'].map(key => head(x1, key)), ['sweep', 'a step in progress with no checkpoint for 2 h', 'Painter'])
  await recordFindings([finding()], { work: s.board, now: NOW })
  for (const chat of ['Lead', 'Painter', 'Watcher', 'Second']) {
    assert.equal((await s.chat(chat, { action: 'incident-fix', id: 'X2', fix: 'B12' })).status, 403, chat)
  }
  assert.equal((await s.board({ action: 'incident-fix', id: 'X2', fix: 'B12' })).status, 403)
  assert.equal((await s.chat('Partner', { action: 'incident-fix', id: 'X2', fix: 'B99' })).status, 404, 'a fix step the store does not hold')
  assert.equal((await s.chat('Partner', { action: 'incident-fix', id: 'B12', fix: 'B13' })).status, 409, 'not an incident')
  assert.equal((await s.chat('Painter', { action: 'incidents-fixed' })).status, 403, 'only the board')
  // A finding needs its key and its words.
  assert.equal((await s.board({ action: 'incident', title: 'x' })).status, 400)
  assert.equal((await s.board({ action: 'incident', key: 'k' })).status, 400)
})

test('Review Focus 2: a finding seen every 3 minutes for an hour is one record with count 20 and one History line', async t => {
  const s = await store(t)
  for (let run = 0; run < 20; run += 1) {
    await recordFindings([finding({ text: `Painter unknown for ${11 + 3 * run} min` })], { work: s.board, now: NOW + run * 3 * MIN })
    s.tick(3)
  }
  const all = await s.incidents()
  assert.equal(all.length, 1)
  assert.deepEqual(['Count', 'First seen', 'Last seen', 'State'].map(key => head(all[0], key)), ['20', '2026-10-24 09:00', '2026-10-24 09:57', 'open'])
  assert.equal(all[0].sections.get('History').length, 1)
})

test('recordFindings: one record per key in a run, and what could not be filed is named, not thrown', async t => {
  const s = await store(t)
  const twice = await recordFindings([finding(), finding({ evidence: 'again' }), finding({ key: 'old-mod Painter 0.14.2', rule: 'old-mod', text: 'Painter runs 0.14.2' })], { work: s.board, now: NOW })
  assert.deepEqual([twice.opened, twice.counted], [['X1', 'X2'], []])
  const refused = await recordFindings([finding()], { work: async () => ({ ok: false, status: 409, why: 'X1.md changed in the meantime' }), now: NOW })
  assert.deepEqual(refused, { opened: [], returned: [], counted: [], failed: [{ key: 'unknown-lane Painter', why: 'X1.md changed in the meantime' }] })
  const thrown = await recordFindings([finding()], { work: async () => { throw new Error('EBUSY') }, now: NOW })
  assert.deepEqual(thrown.failed, [{ key: 'unknown-lane Painter', why: 'EBUSY' }])
})

test('the store keeps incidents as items: read without a problem, never flagged by the reconciler, never on the backlog view', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board, now: NOW })
  const read = await readStore(s.dir)
  assert.deepEqual(read.problems, [])
  const flags = reconcile({ store: read, lanes: [], now: NOW, times: { graceMs: 10 * MIN, askMs: 60 * MIN } }).flags
  assert.deepEqual(flags.filter(one => one.id === 'X1'), [])
  const viewFile = join(s.dir, '..', `view-${Date.now()}.md`)
  t.after(() => rm(viewFile, { force: true }))
  await writeView({ dir: s.dir, ...read }, viewFile, undefined, { now: NOW })
  assert.doesNotMatch(await readFile(viewFile, 'utf8'), /X1|unknown-lane/)
  assert.match((await s.board({ action: 'list' })).result.text, /^X1 · incident · open · - · Painter unknown for 11 min, B12 waits$/m)
})

test('Task 4: the person\'s line is a note of the board\'s, Via supervisor; a chat cannot file one as such', async t => {
  const s = await store(t)
  await recordFindings([finding()], { work: s.board, now: NOW })
  const line = await s.board({ action: 'note', to: 'you', text: ['Supervisor: Painter unknown for 11 min, B12 waits'], of: 'X1', via: 'supervisor' })
  assert.equal(line.ok, true, line.why)
  const note = await s.item(line.result.id)
  assert.deepEqual(['To', 'From', 'Via'].map(key => head(note, key)), ['you', 'server', 'supervisor'])
  assert.deepEqual(note.sections.get('About'), ['X1'])
  const chat = await s.chat('Lead', { action: 'note', to: 'you', text: ['looks like one'], via: 'supervisor' })
  assert.equal(head(await s.item(chat.result.id), 'Via'), undefined)
})

test('the board\'s reconcile marks fixed incidents, only while the supervisor\'s view holds one being fixed (each work call reads the whole store)', async () => {
  const server = await readFile(new URL('../../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /if \(supervisor !== null && supervisor\.view\(clock\(\)\)\.incidents\.some\(one => one\.state === 'fix'\)\) \{\n\s+await loops\.run\('incidents-fixed', async \(\) => \{\n\s+const fixed = await workAction\(\{ action: 'incidents-fixed' \}, 'server'\)/)
})

// The review of Part 1 (2026-10-24).

test('the review: the line owed to the person is read from the store: open or came back, and no line about it since', async t => {
  const { incidentsOf, linesOwed } = await import('../../src/supervisor/incidents.mjs')
  const s = await store(t)
  let clock = NOW
  const owed = async () => {
    const read = (await readStore(s.dir)).items
    return linesOwed(read, incidentsOf(read, clock)).map(one => [one.id, one.state])
  }
  await recordFindings([finding()], { work: s.board, now: NOW })
  assert.deepEqual(await owed(), [['X1', 'open']])
  // A note of the board's about another item, or of a chat, is no line about it.
  await s.board({ action: 'note', to: 'you', text: ['Supervisor: something else'], of: 'B12', via: 'supervisor' })
  await s.chat('Lead', { action: 'note', to: 'you', text: ['about X1'], of: 'X1' })
  assert.deepEqual(await owed(), [['X1', 'open']])
  await s.board({ action: 'note', to: 'you', text: ['Supervisor: Painter unknown for 11 min, B12 waits'], of: 'X1', via: 'supervisor' })
  assert.deepEqual(await owed(), [])
  // Being fixed, or fixed: nothing owed; seen again later, it came back and a line is owed again.
  await s.chat('Partner', { action: 'incident-fix', id: 'X1', fix: 'B12' })
  assert.deepEqual(await owed(), [])
  await s.person({ action: 'tick', id: 'B12' })
  await s.board({ action: 'incidents-fixed' })
  s.tick(10)
  clock += 10 * MIN
  await recordFindings([finding()], { work: s.board, now: clock })
  assert.deepEqual(await owed(), [['X1', 'came back']])
})

test('the review: a chat of role supervisor may end its turns (turn-ended), read its next and pull, and file incidents; nothing else', async t => {
  const s = await store(t)
  const ended = await s.chat('Watcher', { action: 'turn-ended', since: NOW - MIN })
  assert.equal(ended.ok, true, ended.why)
  for (const action of ['next', 'pull', 'list']) assert.equal((await s.chat('Watcher', { action })).ok, true, action)
  for (const body of [{ action: 'note', to: 'main', text: ['x'] }, { action: 'new', title: 'x' }, { action: 'take', id: 'B12' }, { action: 'block', id: 'B12', on: 'B13' }, { action: 'incident-fix', id: 'X1', fix: 'B12' }]) {
    assert.equal((await s.chat('Watcher', body)).status, 403, body.action)
  }
})
