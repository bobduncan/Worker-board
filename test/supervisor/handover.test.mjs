// The supervisor's Task 7: the hand-over of what the rules found. Each incident that opened or came back gives the person one
// line. Signals change 6 (B915, 2026-11-02, the lead's Addendum 7 and the Advisor's refine points 4b.1 and 4b.3): the
// Supervisor, not the Advisor, judges it: one judge word at a time through the outbox (its own kind, `judge`), listing EVERY
// incident that waits (25 Oct 22:06: X60-X64 in one run: one word, not five); the incident is "with the supervisor" once the
// word arrived; the next word goes only after the Supervisor's turn ended (the word's record, `endedAt`). The Advisor gets
// no word at all. A counted one gives neither (Review Focus 2). Temporary stores, made-up chats; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { messageText } from '../../src/bridge.mjs'
import { judgeWords } from '../../src/say.mjs'
import { wakeNeeds } from '../../src/wake.mjs'
import { createSupervisor } from '../../src/supervisor/index.mjs'
import { workApi } from '../../src/work/api.mjs'
import { isJudging, judgeInFlight } from '../../src/work/judgeWord.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIN = 60_000
const START = new Date(2026, 9, 24, 14, 0).getTime()
const ROLES = { Lead: 'main', Digger: 'worker', Shoveller: 'worker', Partner: 'advisor', Watcher: 'supervisor' }
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })
/** The Supervisor's chat as state.mjs gives it: its setting held at `effort`, read back (`isSet`) or not. */
const watcher = (more = {}) => ({ ...lane('Watcher'), setting: { model: 'sonnet', effort: 'medium', isSet: true }, ...more })

/**
 * A board whose workers Digger (and Shoveller, `two`) have cards that say they work while their chats made no call for 20
 * minutes and they hold no step (the rule working-not-running trips at once), with the Supervisor's chat (unless `supervisor`
 * is null) and a partner, a real work store, and the outbox the supervisor's words go into (`refuse.value` true: the outbox
 * refuses them). `keep` how long a word waits, as the outbox keeps it.
 */
async function board(t, { supervisor = watcher(), keep = undefined, two = false, stuckOne = true } = {}) {
  const refuse = { value: false }
  const dir = await mkdtemp(join(tmpdir(), 'handover-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 Wake an unknown worker (for Digger; about 1 h)\n- [ ] B13 Hold the beds (for Digger; about 1 h)\n', { now: START }), undefined, { now: START })
  let now = START
  const outbox = []
  const failures = []
  const chat = { value: supervisor }
  const ctx = () => ({ dir, now, prefix: '', roleOf: name => ROLES[name] ?? null })
  // B1168: when the stop began (a close answers for the stop it was about; a stop after the close counts anew: `stopAt`)
  const off = { at: START - 20 * MIN }
  const stuck = name => lane(name, { state: 'working', isRunning: false, offSince: off.at })
  const state = () => ({
    chats: [lane('Lead', { isMain: true }), stuckOne ? stuck('Digger') : lane('Digger'), ...(two ? [stuck('Shoveller')] : [])], advisor: lane('Partner'), supervisorChat: chat.value, chatPrefix: '',
  })
  const sup = createSupervisor({
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
    tell: async words => {
      if (refuse.value) return { ok: false, why: 'the outbox is held' }
      outbox.push({ id: `m${outbox.length + 1}`, at: now, ...words, state: 'waiting' })
      return { ok: true, started: false, copied: false }
    },
    markWord: async (id, fields) => Object.assign(outbox.find(one => one.id === id), fields),
    sweep: { chat: async () => ({ named: 'Watcher', title: 'Watcher', card: chat.value, withoutMod: false, mod: '0.30.0' }), job: 'C:/board/roles/supervisor.md', tokens: async () => null },
    settings: { supervisorSweepMinutes: 0 },
    ...(keep === undefined ? {} : { keep }),
  })
  const items = async () => [...(await readStore(dir)).items.values()]
  return {
    supervisor: sup, outbox, dir, failures, refuse, card: chat,
    /** The Supervisor's chat took and typed every word that waits for it. */
    deliver: () => outbox.filter(one => one.state === 'waiting').forEach(one => { Object.assign(one, { state: 'delivered', deliveredAt: now }) }),
    /** Its turn after the word ended. */
    ended: () => sup.heard({ action: 'turn-ended', ok: true, session: 's-Watcher', since: now - MIN }),
    at: minutes => { now = START + minutes * MIN },
    /** A new stop of the stuck workers begins at this minute (after a close, B1168). */
    stopAt: minutes => { off.at = START + minutes * MIN },
    run: () => sup.run(),
    chat: (name, body) => workApi({ chat: name, ...body }, ctx()),
    person: body => workApi(body, { ...ctx(), as: 'person' }),
    server: body => workApi(body, { ...ctx(), as: 'server' }),
    words: () => outbox.filter(one => one.command === 'judge'),
    lines: async () => (await items()).filter(one => one.head.get('Kind') === 'note' && one.head.get('Via') === 'supervisor'),
    incident: async id => (await readStore(dir)).items.get(id),
    store: async () => (await readStore(dir)).items,
  }
}

test('an opened incident gives the Supervisor one judge word and the person one line; once it arrived it is with the supervisor; the Advisor gets nothing', async t => {
  const b = await board(t)
  await b.run()
  const x1 = await b.incident('X1')
  assert.equal(x1.head.get('Source'), 'working-not-running')
  assert.equal((await b.lines()).length, 1, 'one line to the person')
  assert.equal(b.words().length, 1, 'one judge word')
  const [word] = b.words()
  assert.deepEqual([word.to, word.command, word.kind, word.incidents, word.state], ['Watcher', 'judge', 'judge', ['X1'], 'waiting'])
  assert.equal(b.outbox.filter(one => one.to === 'Partner').length, 0, 'no word to the Advisor')
  assert.deepEqual(word.text.split('\n'), [
    'judge: one incident waits for your judgment: a false alarm or no fault left (work drop X<n> with why), or a fault (work new "Fix of X<n>: ..." with priority fix, then work incident-fix X<n> with that step); then end your turn',
    `- X1 ${x1.head.get('Title')}`, '  new; seen once; source: the rule working-not-running; subject: Digger', `  evidence: ${x1.head.get('Evidence')}`,
    'Judge at medium effort.', 'Your job: C:/board/roles/supervisor.md, "Judging incidents"',
  ])
  // On its way, it is not with the supervisor yet; once typed into its chat, it is.
  assert.equal(x1.head.get('State'), 'open')
  b.deliver()
  b.at(3)
  await b.run()
  const handed = await b.incident('X1')
  assert.equal(handed.head.get('State'), 'with the supervisor')
  assert.match(handed.sections.get('History').at(-1), /server: handed to Watcher$/)
  // Every 3 minutes while it lasts: counted, and nothing more for the person or the Supervisor (Review Focus 2).
  for (const minutes of [6, 9, 12]) {
    b.at(minutes)
    await b.run()
  }
  assert.equal((await b.incident('X1')).head.get('Count'), '5')
  assert.equal((await b.lines()).length, 1)
  assert.equal(b.words().length, 1)
})

test('4b.1: one judge word at a time, listing every incident that waits; the next only after its turn ended (X60-X64: one word, not five)', async t => {
  const b = await board(t, { two: true })
  await b.run()
  assert.deepEqual(b.words().map(one => one.incidents), [['X1', 'X2']], 'both in one word')
  // A third that opens while the word is on its way waits for the next word.
  assert.equal((await b.chat('Watcher', { action: 'incident', key: 'rule-miss working-not-running Lead', title: 'Lead quiet', subject: 'Lead', evidence: 'x', rule: 'a main chat quiet for an hour' })).ok, true)
  b.at(3)
  await b.run()
  assert.equal(b.words().length, 1, 'one in flight')
  b.deliver()
  b.at(6)
  await b.run()
  assert.equal(b.words().length, 1, 'arrived, its turn not ended: still one in flight')
  assert.equal((await b.incident('X3')).head.get('State'), 'open', 'not in the word that arrived')
  assert.equal(judgeInFlight(b.outbox, 'Watcher', START + 6 * MIN), true)
  // Its turn ends: the record says so, and the next word lists what waits now.
  await b.ended()
  assert.ok(Number.isFinite(b.words()[0].endedAt))
  assert.deepEqual(b.words().map(one => one.incidents), [['X1', 'X2'], ['X3']])
})

test('a judge word does not end or count as a sweep, and no sweep starts while the Supervisor judges', async t => {
  const b = await board(t)
  await b.run()
  b.deliver()
  // Check now while it judges: no sweep, said why.
  const asked = await b.supervisor.checkNow()
  assert.equal(asked.sweep.started, false)
  assert.match(asked.sweep.why, /judges incidents/)
  // Its calls in the judgment turn are no sweep's; its turn's end ends the judgment, and no sweep is recorded.
  await b.supervisor.heard({ action: 'incident', ok: true })
  await b.ended()
  assert.equal(b.supervisor.view(START).lastSweep, null, 'no sweep began or ended')
  assert.equal(b.outbox.filter(one => one.command === 'sweep').length, 0)
})

test('a returned one gives a line and a judge word again, naming its count; the Supervisor\'s fix in between', async t => {
  const b = await board(t)
  await b.run()
  b.deliver()
  b.at(1)
  await b.run()
  await b.ended()
  // The Supervisor names its fix step; the step is done; fixed once not seen (the loop's `incident-gone`).
  assert.equal((await b.chat('Watcher', { action: 'incident-fix', id: 'X1', fix: 'B12' })).ok, true)
  assert.equal((await b.person({ action: 'tick', id: 'B12' })).ok, true)
  b.at(5)
  assert.deepEqual((await b.server({ action: 'incident-gone', fixed: [{ id: 'X1', notSeenSince: START }] })).result.fixed, ['X1'])
  // Seen again: it came back. B1168: the stop the close answered for never counts again, so the worker stops anew after the close.
  b.stopAt(6)
  b.at(13)
  await b.run()
  const back = await b.incident('X1')
  assert.deepEqual([back.head.get('Count'), back.head.get('State')], ['3', 'came back'])
  assert.equal(b.words().length, 2)
  assert.deepEqual(b.words()[1].text.split('\n')[2], '  came back after its fix B12; seen 3 times; source: the rule working-not-running; subject: Digger')
  const lines = await b.lines()
  assert.equal(lines.length, 2)
  assert.match(lines[1].sections.get('Text')?.join(' ') ?? lines[1].head.get('Text'), /Supervisor: X1 came back: /)
  b.deliver()
  b.at(13)
  await b.run()
  assert.equal((await b.incident('X1')).head.get('State'), 'with the supervisor')
  assert.equal(b.words().length, 2)
})

test('the word wakes the Supervisor\'s chat when it does not run, and is typed as the board\'s word, with its mark', () => {
  const words = judgeWords('Watcher', [{ id: 'X1', title: 'Digger unknown for 21 min', state: 'open', count: 1, source: 'unknown-lane', subject: 'Digger', evidence: 'state unknown since 13:40' }], { job: 'C:/board/roles/supervisor.md' })
  const state = { restart: { main: 'Lead' }, chats: [lane('Lead', { isMain: true })], supervisorChat: { ...lane('Watcher'), isRunning: false, appSession: 'local_watcher' } }
  const start = wakeNeeds(state, [{ ...words, at: START, state: 'waiting' }])[0]
  assert.deepEqual([start?.why, start?.chat], ['words', 'Watcher'])
  assert.match(messageText({ ...words, at: START }, () => '14:00'), /^judge: one incident waits[\s\S]*\(typed on the worker board, 14:00\)$/)
})

test('a word that could not go is tried at the next run; one on its way is not sent twice', async t => {
  const b = await board(t)
  b.refuse.value = true
  await b.run()
  assert.equal(b.words().length, 0)
  assert.deepEqual(b.failures, ['incidents: 1 not filed (the judge word to Watcher of X1: the outbox is held)'], 'the page says so, as the loop "incidents"')
  assert.equal((await b.incident('X1')).head.get('State'), 'open', 'not handed on while its word did not go')
  assert.equal((await b.lines()).length, 1, 'the person\'s line went')
  b.refuse.value = false
  b.at(3)
  await b.run()
  assert.equal(b.words().length, 1)
  b.at(6)
  await b.run()
  assert.equal(b.words().length, 1, 'on its way: not sent again')
  assert.equal((await b.lines()).length, 1, 'no second line')
})

test('the review: a judge word waits as long as a step\'s; one lost is sent again; one taken long ago arrived; one arrived ends after 30 min without a turn\'s end', async t => {
  const b = await board(t, { keep: { messageMs: 10 * MIN, answerMs: 60 * MIN } })
  await b.run()
  b.at(30)
  await b.run()
  assert.equal(b.words().length, 1, 'still waiting after 30 minutes')
  b.at(61)
  await b.run()
  assert.equal(b.words().length, 2, 'lost past its time: sent again')
  Object.assign(b.outbox.at(-1), { state: 'taken', takenAt: START + 62 * MIN })
  b.at(70)
  await b.run()
  assert.equal((await b.incident('X1')).head.get('State'), 'open', 'taken a moment ago: on its way')
  b.at(73)
  await b.run()
  assert.equal((await b.incident('X1')).head.get('State'), 'with the supervisor')
  // No turn's end ever comes (a word pasted by hand): it stops counting as in flight 30 min after it arrived.
  assert.equal(judgeInFlight(b.outbox, 'Watcher', START + 91 * MIN, { messageMs: 10 * MIN, answerMs: 60 * MIN }), true)
  assert.equal(judgeInFlight(b.outbox, 'Watcher', START + 92 * MIN, { messageMs: 10 * MIN, answerMs: 60 * MIN }), false)
})

test('the effort: the judge word waits for the chat to run at its judging effort, at most 5 min, then says it was not set', async t => {
  const b = await board(t, { supervisor: watcher({ setting: { model: 'sonnet', effort: 'medium', isSet: false } }) })
  await b.run()
  assert.equal(b.words().length, 0, 'not set yet: it waits')
  b.at(3)
  await b.run()
  assert.equal(b.words().length, 0)
  b.at(6)
  await b.run()
  assert.equal(b.words().length, 1)
  assert.match(b.words()[0].text, /\nJudge at medium effort \(the board could not set it before this word: say so in your first line\)\.\n/)
  // The board holds the chat at the judging effort while an incident waits or a word is in flight (state.mjs reads this).
  assert.equal(isJudging({ items: await b.store(), outbox: b.outbox, to: 'Watcher', now: START + 6 * MIN }), true)
})

test('a run of the rules and a sweep\'s turn\'s end at once give one line and one word, never two', async t => {
  const b = await board(t)
  assert.equal((await b.chat('Watcher', { action: 'incident', title: 'Digger worked an hour with no step', subject: 'Digger', evidence: 'card empty', key: 'working-without-step Digger', rule: 'a worker working with no step for 30 min' })).ok, true)
  const ended = () => b.supervisor.heard({ action: 'turn-ended', ok: true, session: 's-Watcher', since: START })
  await Promise.all([ended(), ended(), b.run()])
  const about = async id => (await b.lines()).filter(one => (one.sections.get('About') ?? [])[0]?.trim() === id).length
  assert.equal(await about('X1'), 1)
  assert.equal(b.words().length, 1)
})

test('without a Supervisor on the board the person gets the line and the incident stays open', async t => {
  const b = await board(t, { supervisor: null })
  await b.run()
  assert.equal((await b.lines()).length, 1)
  assert.equal(b.words().length, 0)
  assert.equal((await b.incident('X1')).head.get('State'), 'open')
})

test('the migration (Addendum 9): every incident with the advisor moves to with the supervisor, one line each; one judge word lists them; a second run changes nothing', async t => {
  const b = await board(t)
  await b.run()
  // A record from before the change: with the advisor (written by hand here as the old code wrote it).
  const text = await readFile(join(b.dir, 'X1.md'), 'utf8')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(b.dir, 'X1.md'), text.replace('State: open', 'State: with the advisor'))
  b.outbox.length = 0
  b.at(3)
  await b.run()
  const moved = await b.incident('X1')
  assert.equal(moved.head.get('State'), 'with the supervisor')
  assert.equal(moved.sections.get('History').filter(line => /with the supervisor now: the Supervisor judges incidents, not the Advisor/.test(line)).length, 1)
  assert.deepEqual(b.words().map(one => one.incidents), [['X1']], 'one judge word lists it')
  b.at(6)
  await b.run()
  assert.equal((await b.incident('X1')).sections.get('History').filter(line => /with the supervisor now/.test(line)).length, 1, 'idempotent')
  assert.equal(b.words().length, 1)
})

test('incident-told is the board\'s alone; an incident in another state stays as it is', async t => {
  const b = await board(t, { supervisor: null })
  await b.run()
  for (const name of ['Lead', 'Digger', 'Partner', 'Watcher']) assert.equal((await b.chat(name, { action: 'incident-told', id: 'X1' })).status, 403, name)
  assert.equal((await b.server({ action: 'incident-told', id: 'X1', to: 'Watcher' })).result.changed, true)
  const again = await b.server({ action: 'incident-told', id: 'X1', to: 'Watcher' })
  assert.deepEqual([again.ok, again.result.changed, again.result.text], [true, false, 'X1 is with the supervisor: nothing to hand on.'])
})

test('the job texts: the Supervisor judges and files the fix step; the partner\'s job no longer has the incidents; the protocol and the main chat know the words', async () => {
  const supervisor = (await readFile(join(ROOT, 'roles', 'supervisor.md'), 'utf8')).replace(/\s+/g, ' ')
  for (const words of ['## Judging incidents', '`judge:', 'a false alarm', 'no fault left', 'Fix of X<n>', '`priority` fix', '`work incident-fix X<n>`', 'medium effort', 'B685', 'B584', 'B736', 'B883', 'rule-miss']) {
    assert.ok(supervisor.includes(words), `supervisor.md: ${words}`)
  }
  const partner = (await readFile(join(ROOT, 'roles', 'partner.md'), 'utf8')).replace(/\s+/g, ' ')
  assert.ok(!partner.includes('## Incidents'), 'partner.md has no Incidents section any more')
  const protocol = (await readFile(join(ROOT, 'roles', 'protocol.md'), 'utf8')).replace(/\s+/g, ' ')
  for (const words of ['`judge:', '`sweep', '`work health`', '`work incident`', '`work incident-fix X<n>`']) assert.ok(protocol.includes(words), `protocol.md: ${words}`)
  const main = (await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')).replace(/\s+/g, ' ')
  for (const words of ['Fix of X<n>', 'the supervisor\'s chat']) assert.ok(main.includes(words), `main.md: ${words}`)
})

test('the cards follow the hand-over: sending while the word waits, with the Supervisor once it arrived, one fix card the moment the Supervisor names its step', async t => {
  const b = await board(t)
  await b.run()
  const live = async (supervisor = 'Watcher') => ({ items: (await readStore(b.dir)).items, lanes: [lane('Lead', { isMain: true }), lane('Digger', { state: 'working' })], supervisor })
  const cards = async supervisor => b.supervisor.view(START + MIN, await live(supervisor)).cards
  let [card] = await cards()
  assert.deepEqual([card.key, card.state.text, card.incidents.map(one => one.id)], ['nofix', 'sending to the Supervisor…', ['X1']])
  assert.equal((await cards(null))[0].state.text, 'no Supervisor on the board')
  b.deliver()
  ;[card] = await cards()
  assert.equal(card.state.text, 'with the Supervisor')
  b.at(1)
  await b.run()
  assert.equal((await b.incident('X1')).head.get('State'), 'with the supervisor')
  assert.equal((await b.chat('Watcher', { action: 'incident-fix', id: 'X1', fix: 'B12' })).ok, true)
  const fresh = await cards()
  assert.deepEqual(fresh.map(one => [one.key, one.title, one.state.text, one.incidents.map(inc => inc.id)]), [['B12', 'Wake an unknown worker', 'queued for Digger', ['X1']]])
})

test('the outbox sweep drops a judge word that waits while none of its incidents waits any more (gone, closed, in fix)', async () => {
  const { whyClosed } = await import('../../src/work/outboxSweep.mjs')
  const items = new Map([['X1', { head: new Map([['State', 'gone']]) }], ['X2', { head: new Map([['State', 'with the supervisor']]) }]])
  const ctx = { all: [], items, now: START, keep: { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }, runs: new Map(), closing: new Map() }
  const word = incidents => ({ id: 'j1', command: 'judge', kind: 'judge', to: 'Watcher', at: START - MIN, state: 'waiting', incidents })
  assert.deepEqual(whyClosed(word(['X1']), ctx), { state: 'dropped', why: 'none of X1 waits for a judgment any more' })
  assert.equal(whyClosed(word(['X1', 'X2']), ctx), null, 'one still waits')
})

test('one thing at a time with the chat of the Supervisor: no judge word while its sweep runs; it goes once the turn of the sweep ended', async t => {
  const b = await board(t, { stuckOne: false })
  assert.equal((await b.supervisor.checkNow()).sweep.started, true)
  b.outbox.find(one => one.command === 'sweep').state = 'delivered'
  // The sweep files a finding; the rules run meanwhile: the incident waits for the sweep's end.
  assert.equal((await b.chat('Watcher', { action: 'incident', key: 'working-without-step Digger', title: 'Digger worked an hour with no step', subject: 'Digger', evidence: 'card empty', rule: 'a worker working with no step for 30 min' })).ok, true)
  b.at(3)
  await b.run()
  assert.equal(b.words().length, 0, 'no judge word while the sweep runs')
  await b.supervisor.heard({ action: 'turn-ended', ok: true, session: 's-Watcher', since: START })
  assert.deepEqual(b.words().map(one => one.incidents), [['X1']])
})

test('the morning-after count (decision 10): a judgment turn\'s session, start and tokens are kept on its word; the view counts the day\'s judgments', async t => {
  const b = await board(t)
  await b.run()
  b.deliver()
  b.at(2)
  await b.supervisor.heard({ action: 'turn-ended', ok: true, session: 's-Watcher', since: START + MIN })
  const [word] = b.words()
  assert.deepEqual([word.session, word.from, Number.isFinite(word.endedAt)], ['s-Watcher', START + MIN, true])
  assert.deepEqual(b.supervisor.view(START + 3 * MIN).judgmentsToday, { count: 1, tokens: 0 })
})

test('the review of change 6 (3): a stale card setting (still low, read back) is not the judging effort: the word waits, then says it was not set', async t => {
  const b = await board(t, { supervisor: watcher({ setting: { model: 'sonnet', effort: 'low', isSet: true } }) })
  await b.run()
  assert.equal(b.words().length, 0, 'the board has not turned it to medium yet: no word at low')
  b.card.value = watcher({ setting: { model: 'sonnet', effort: 'medium', isSet: true } })
  b.at(3)
  await b.run()
  assert.equal(b.words().length, 1)
  assert.match(b.words()[0].text, /\nJudge at medium effort\.\n/)
})
