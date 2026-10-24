// The supervisor's Task 7: the hand-over to the Advisor (spec 2026-10-24, "To you and to the Advisor"). Each incident that
// opened or came back gives the person one line and the partner one board word through the outbox, with its id, count,
// source, subject and evidence; the incident is then "with the advisor" until the partner names its fix step
// (`work incident-fix`). A counted one gives neither (Review Focus 2). The word waits in the outbox when the partner
// does not run, as every board word. Temporary stores, made-up chats; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { messageText } from '../../src/bridge.mjs'
import { incidentWords, wakeFor } from '../../src/say.mjs'
import { createSupervisor } from '../../src/supervisor/index.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIN = 60_000
const START = new Date(2026, 9, 24, 14, 0).getTime()
const ROLES = { Lead: 'main', Digger: 'worker', Partner: 'advisor', Watcher: 'supervisor' }
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })

/**
 * A board whose one worker, Digger, has been "unknown" for 20 minutes (the rule unknown-lane trips at once), with a
 * partner (unless `partner` is null), a real work store, and the outbox the supervisor's words go into.
 */
async function board(t, { partner = lane('Partner'), tell = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'handover-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 Wake an unknown worker (for Digger; about 1 h)\n', { now: START }), undefined, { now: START })
  let now = START
  const outbox = []
  const failures = []
  const ctx = () => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null })
  const state = () => ({
    chats: [lane('Lead', { isMain: true }), lane('Digger', { state: 'unknown' })], advisor: partner, chatPrefix: '',
    today: [{ chat: 'Digger', spans: [{ from: START - 20 * MIN, to: now, state: 'unknown' }] }],
  })
  const supervisor = createSupervisor({
    state: async () => state(),
    items: async () => (await readStore(dir)).items,
    outbox: () => outbox,
    refused: () => [],
    apply: body => workApi(body, { ...ctx(), as: 'server' }),
    wake: async () => null,
    noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} },
    now: () => now,
    // As the board's loop record: a loop that throws is recorded, and the next run goes on.
    loops: { run: async (name, fn) => { try { return await fn() } catch (error) { failures.push(`${name}: ${error.message}`) } }, failed: () => {} },
    tell: tell ?? (async words => {
      outbox.push({ id: `m${outbox.length + 1}`, at: now, ...words, state: 'waiting' })
      return { ok: true, started: false, copied: false }
    }),
    partnerJob: 'C:/board/roles/partner.md',
  })
  const items = async () => [...(await readStore(dir)).items.values()]
  return {
    supervisor, outbox, dir, failures,
    at: minutes => { now = START + minutes * MIN },
    run: () => supervisor.run(),
    chat: (chat, body) => workApi({ chat, ...body }, ctx()),
    person: body => workApi(body, { ...ctx(), as: 'person' }),
    server: body => workApi(body, { ...ctx(), as: 'server' }),
    words: () => outbox.filter(one => one.command === 'incident'),
    lines: async () => (await items()).filter(one => one.head.get('Kind') === 'note' && one.head.get('Via') === 'supervisor'),
    incident: async id => (await readStore(dir)).items.get(id),
  }
}

test('an opened incident gives the partner one word and the person one line, and is with the advisor; a counted one gives neither', async t => {
  const b = await board(t)
  await b.run()
  const x1 = await b.incident('X1')
  assert.equal(x1.head.get('Source'), 'unknown-lane')
  assert.equal((await b.lines()).length, 1, 'one line to the person')
  assert.equal(b.words().length, 1, 'one word to the partner')
  const [word] = b.words()
  assert.deepEqual([word.to, word.about, word.state], ['Partner', 'X1', 'waiting'])
  assert.deepEqual(word.text.split('\n'), [
    `incident: X1 ${x1.head.get('Title')}`, 'State: new', 'Count: 1 (seen once)', 'Source: the rule unknown-lane', 'Subject: Digger',
    `Evidence: ${x1.head.get('Evidence')}`, 'Your job: C:/board/roles/partner.md, "Incidents"',
  ])
  assert.equal(x1.head.get('State'), 'with the advisor')
  assert.match(x1.sections.get('History').at(-1), /server: handed to Partner$/)
  // Every 3 minutes while it lasts: counted, and nothing more for the person or the partner (Review Focus 2).
  for (const minutes of [3, 6, 9]) {
    b.at(minutes)
    await b.run()
  }
  assert.equal((await b.incident('X1')).head.get('Count'), '4')
  assert.equal((await b.lines()).length, 1)
  assert.equal(b.words().length, 1)
  assert.equal(b.supervisor.view(START + 9 * MIN).incidents[0].state, 'with the advisor')
})

test('a returned one gives both again, naming its count; the partner\'s fix in between makes it fixed', async t => {
  const b = await board(t)
  await b.run()
  // The partner names its fix step; the step is done; the board marks it fixed.
  assert.equal((await b.chat('Partner', { action: 'incident-fix', id: 'X1', fix: 'B12' })).ok, true)
  assert.equal((await b.person({ action: 'tick', id: 'B12' })).ok, true)
  b.at(5)
  assert.deepEqual((await b.server({ action: 'incidents-fixed' })).result.fixed, ['X1'])
  // Seen again: it came back.
  b.at(10)
  await b.run()
  const back = await b.incident('X1')
  assert.equal(back.head.get('Count'), '2')
  assert.equal(b.words().length, 2)
  const word = b.words()[1].text.split('\n')
  assert.deepEqual(word.slice(1, 3), ['State: came back after its fix B12', 'Count: 2 (seen 2 times)'])
  const lines = await b.lines()
  assert.equal(lines.length, 2)
  assert.match(lines[1].sections.get('Text')?.join(' ') ?? lines[1].head.get('Text'), /Supervisor: X1 came back: /)
  assert.equal(back.head.get('State'), 'with the advisor')
})

test('the word waits in the outbox when the partner does not run: the main chat is asked to start it, as for every board word', () => {
  const words = incidentWords('Partner', { id: 'X1', title: 'Digger unknown for 21 min', state: 'open', count: 1, source: 'unknown-lane', subject: 'Digger', evidence: 'state unknown since 13:40' }, 'C:/board/roles/partner.md')
  const state = { restart: { main: 'Lead' }, chats: [lane('Lead', { isMain: true })], advisor: { ...lane('Partner'), isRunning: false, appSession: 'local_partner' } }
  const start = wakeFor({ ...words, at: START }, state, [], START, 3000)
  assert.deepEqual([start?.command, start?.about], ['start', 'Partner'])
  // Typed as the board's word, with its mark, as a result check's is.
  assert.match(messageText({ ...words, at: START }, () => '14:00'), /^incident: X1 Digger unknown for 21 min\n[\s\S]*\(typed on the worker board, 14:00\)$/)
})

test('a word that could not go is tried at the next run; one already in the outbox is not sent twice', async t => {
  let refuse = true
  const sent = []
  const b = await board(t, { tell: async words => {
    if (refuse) return { ok: false, why: 'the outbox is held' }
    sent.push(words)
    return { ok: true, started: false, copied: false }
  } })
  await b.run()
  assert.equal(sent.length, 0)
  assert.deepEqual(b.failures, ['incidents: 1 not filed (the word to Partner of X1: the outbox is held)'], 'the page says so, as the loop "incidents"')
  assert.equal((await b.incident('X1')).head.get('State'), 'open', 'not handed on while its word did not go')
  assert.equal((await b.lines()).length, 1, 'the person\'s line went')
  refuse = false
  b.at(3)
  await b.run()
  assert.equal(sent.length, 1)
  assert.equal((await b.incident('X1')).head.get('State'), 'with the advisor')
  assert.equal((await b.lines()).length, 1, 'no second line')
})

test('a word in the outbox since the incident got its state counts as sent: only the state is set', async t => {
  const b = await board(t)
  await b.run()
  // The state went back to open (its fix was dropped); a word about it sent since then counts.
  assert.equal((await b.chat('Partner', { action: 'incident-fix', id: 'X1', fix: 'B12' })).ok, true)
  assert.equal((await b.chat('Lead', { action: 'drop', id: 'B12', why: 'not needed' })).ok, true)
  b.at(4)
  assert.deepEqual((await b.server({ action: 'incidents-fixed' })).result.reopened, ['X1'])
  b.outbox.push({ id: 'early', at: START + 4 * MIN + 1000, command: 'incident', about: 'X1', to: 'Partner', state: 'delivered' })
  b.at(6)
  await b.run()
  assert.equal(b.words().length, 2, 'the first word and the one already there; none sent anew')
  assert.equal((await b.incident('X1')).head.get('State'), 'with the advisor')
})

test('without a partner on the board the person gets the line and the incident stays open', async t => {
  const b = await board(t, { partner: null })
  await b.run()
  assert.equal((await b.lines()).length, 1)
  assert.equal(b.words().length, 0)
  assert.equal((await b.incident('X1')).head.get('State'), 'open')
})

test('what the sweep filed reaches the person and the partner when the sweep\'s turn ends', async t => {
  const b = await board(t)
  await b.run()
  const filed = await b.chat('Watcher', { action: 'incident', title: 'Digger worked an hour with no step', subject: 'Digger', evidence: 'working since 13:00, card empty', rule: 'a worker working with no step for 30 min', key: 'working-without-step Digger' })
  assert.equal(filed.ok, true, filed.why)
  await b.supervisor.heard({ action: 'turn-ended', ok: true, session: 's-Watcher', since: START })
  const word = b.words().find(one => one.about === 'X2')
  assert.ok(word !== undefined, 'the partner has its word at once')
  assert.match(word.text, /\nSource: sweep \(the supervisor's chat\)\n/)
  assert.match(word.text, /\nRule wanted: a worker working with no step for 30 min\n/)
  assert.equal((await b.lines()).length, 2)
})

test('incident-told is the board\'s alone; an incident in another state stays as it is', async t => {
  const b = await board(t, { partner: null })
  await b.run()
  for (const chat of ['Lead', 'Digger', 'Partner', 'Watcher']) assert.equal((await b.chat(chat, { action: 'incident-told', id: 'X1' })).status, 403, chat)
  assert.equal((await b.server({ action: 'incident-told', id: 'X1', to: 'Partner' })).result.changed, true)
  const again = await b.server({ action: 'incident-told', id: 'X1', to: 'Partner' })
  assert.deepEqual([again.ok, again.result.changed, again.result.text], [true, false, 'X1 is with the advisor: nothing to hand on.'])
})

test('the job texts: the partner decides a tweak or a structural fix and files the fix step; the protocol and the main chat know the words', async () => {
  const partner = (await readFile(join(ROOT, 'roles', 'partner.md'), 'utf8')).replace(/\s+/g, ' ')
  for (const words of ['## Incidents', '`incident: X<n> <title>`', 'a small tweak', 'a structural fix', 'Count 2 or more', 'a deeper look', '`priority` fix', 'Fix of X<n>', 'adds a rule', '`work incident-fix X<n>`']) {
    assert.ok(partner.includes(words), `partner.md: ${words}`)
  }
  const protocol = (await readFile(join(ROOT, 'roles', 'protocol.md'), 'utf8')).replace(/\s+/g, ' ')
  for (const words of ['`incident: X<n> <title>`', '`sweep: run work health', '`work health`', '`work incident`', '`work incident-fix X<n>`']) assert.ok(protocol.includes(words), `protocol.md: ${words}`)
  const main = (await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')).replace(/\s+/g, ' ')
  for (const words of ['Fix of X<n>', 'the supervisor\'s chat']) assert.ok(main.includes(words), `main.md: ${words}`)
})
