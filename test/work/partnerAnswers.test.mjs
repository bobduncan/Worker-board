// Partner answers (the person, 2026-10-19): "detail questions go to your partner first; the partner answers them,
// taking the worker's advice, and lists each answer in its daily note with an Undo; questions only you can answer
// still come to you; work keeps moving and you keep the last word". A worker's or the main chat's ask of kind decide or
// look that carries options or advice is routed to the partner (`Route: partner`) while the setting is on (the store's
// partner-answers.json, on unless switched off); the partner answers it (`partner-answer`) or hands it to the person
// (`escalate`); the person's Undo opens it again for them. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { messageText } from '../../src/bridge.mjs'
import { undoLine } from '../../src/focus.mjs'
import { memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { dailyNote } from '../../src/work/dailyNote.mjs'
import { deliverWork, partnerAskWords } from '../../src/work/deliver.mjs'
import { parseItem, serializeItem, validateHead, valueOf } from '../../src/work/item.mjs'
import { storeNeeds } from '../../src/work/lists.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 19, 10, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Fights', '- [ ] B1 Show the damage (for Digger; about 1 h)', '- [ ] B2 Heavier hits (for Lead; about 1 h)', ''].join('\n')
const ROLES = { Lead: 'main', Digger: 'worker', Sage: 'advisor' }
const TIMES = { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN, partnerMs: 30 * MIN }

async function garden({ focusGoal = 'G6' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'partner-answers-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const ctx = (now = NOW) => ({ dir, now, prefix: 'Garden · ', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), freeChats: new Set(), hasGoal: id => id === 'G6', focusGoal })
  const as = chat => (body, now) => workApi({ chat, ...body }, ctx(now))
  const digger = as('Digger')
  await digger({ action: 'take', id: 'B1', branch: 'b1' })
  return {
    dir, ctx, digger, lead: as('Lead'), sage: as('Sage'),
    person: (body, now) => workApi(body, { ...ctx(now), as: 'person' }),
    server: (body, now) => workApi(body, { ...ctx(now), as: 'server' }),
  }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const DECIDE = { action: 'ask', of: 'B1', kind: 'decide', text: 'A number or a bar for the damage?', options: ['A number', 'B bar'], advice: 'A', blocking: true }

test('routing: a worker\'s or the main chat\'s decide or look with advice or options goes to the partner first', async () => {
  const { dir, digger, lead, sage } = await garden()
  try {
    const routed = await digger(DECIDE)
    assert.equal(routed.ok, true, routed.why)
    assert.equal(routed.result.route, 'partner')
    assert.match(routed.result.text, /^Q1 goes to your partner first/)
    assert.doesNotMatch(routed.result.text, /For you/, 'nothing for the person now: no "For you" block')
    assert.equal(valueOf(await item(dir, 'Q1'), 'Route'), 'partner')
    // A blocking ask of the holder still holds its step, as before.
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'waiting on you')
    assert.match((await item(dir, 'Q1')).sections.get('History').join('\n'), /to the partner first/)
    const look = await lead({ action: 'ask', of: 'B1', kind: 'look', text: 'Does the bar read at a glance?', options: ['A yes', 'B no'] })
    assert.equal(valueOf(await item(dir, look.result.id), 'Route'), 'partner')
    const advised = await digger({ action: 'ask', of: 'B1', kind: 'decide', text: 'Yellow or white?', advice: 'yellow' })
    assert.equal(valueOf(await item(dir, advised.result.id), 'Route'), 'partner')
    // Not routed: provide and do, no advice and no options, the partner's own, the app's question form.
    const kept = [
      await digger({ action: 'ask', of: 'B1', kind: 'provide', text: 'The font file', advice: 'the one you bought' }),
      await digger({ action: 'ask', of: 'B1', kind: 'do', text: 'Restart the app', options: ['A now', 'B tonight'], advice: 'A' }),
      await digger({ action: 'ask', of: 'B1', kind: 'decide', text: 'Anything else you want here?' }),
      await sage({ action: 'ask', of: 'B1', kind: 'decide', text: 'Icons or words?', options: ['A icons', 'B words'], advice: 'A' }),
      await digger({ action: 'ask', kind: 'decide', text: 'Which map first?', options: ['A north', 'B south'], via: 'form' }),
    ]
    for (const one of kept) {
      assert.equal(one.ok, true, one.why)
      assert.equal(valueOf(await item(dir, one.result.id), 'Route'), null, one.result.id)
      assert.match(one.result.text, /For you/)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the setting: on unless switched off (partner-answers.json); off, every ask goes to the person as before; only the person switches it', async () => {
  const { dir, digger, lead, person } = await garden()
  try {
    assert.deepEqual((await readStore(dir)).partnerAnswers, { on: true })
    assert.equal((await lead({ action: 'partner-answers', on: false })).status, 403)
    const off = await person({ action: 'partner-answers', on: false })
    assert.equal(off.ok, true, off.why)
    assert.match(off.result.text, /off/)
    assert.deepEqual((await readStore(dir)).partnerAnswers, { on: false, since: NOW })
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'partner-answers.json'), 'utf8')), { on: false, since: NOW })
    const asked = await digger(DECIDE)
    assert.equal(valueOf(await item(dir, asked.result.id), 'Route'), null)
    assert.match(asked.result.text, /For you/)
    assert.equal((await person({ action: 'partner-answers', on: true })).ok, true)
    assert.equal((await readStore(dir)).partnerAnswers.on, true)
    assert.equal((await person({ action: 'partner-answers' })).status, 400)
    // A file that cannot be read counts as on: the person's choice of 2026-10-19.
    await writeFile(join(dir, 'partner-answers.json'), 'not json')
    assert.deepEqual((await readStore(dir)).partnerAnswers, { on: true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a routed ask does not stand under Needs your attention; one handed to the person does, with the partner\'s why', async () => {
  const { dir, digger, sage } = await garden()
  try {
    await digger(DECIDE)
    await digger({ action: 'ask', of: 'B1', kind: 'decide', text: 'Yellow or white?', options: ['A yellow', 'B white'], advice: 'A' })
    const needs = async () => storeNeeds({ ok: true, dir, ...(await readStore(dir)) }, { now: NOW, names: ['Digger', 'Lead', 'Sage'], prefix: 'Garden · ' })
    assert.deepEqual((await needs()).map(one => one.workId), [])
    assert.equal((await digger({ action: 'escalate', id: 'Q2', why: 'x' })).status, 403)
    assert.equal((await sage({ action: 'escalate', id: 'Q2' })).status, 400)
    const handed = await sage({ action: 'escalate', id: 'Q2', why: 'it is about the look of your art references' })
    assert.equal(handed.ok, true, handed.why)
    const q2 = await item(dir, 'Q2')
    assert.equal(valueOf(q2, 'Route'), 'person')
    assert.equal(valueOf(q2, 'State'), 'open')
    assert.match(q2.sections.get('History').at(-1), /Sage: to the person: it is about the look of your art references$/)
    const [need] = await needs()
    assert.deepEqual([need.workId, need.route, need.routeNote], ['Q2', 'person', 'Your partner hands this to you: it is about the look of your art references'])
    // Only an ask routed to the partner is handed on; twice is refused.
    assert.equal((await sage({ action: 'escalate', id: 'Q2', why: 'again' })).status, 409)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('partner-answer: the ask is answered by the partner, the asking chat woken as for the person\'s answer, the line in today\'s note', async () => {
  const { dir, digger, sage } = await garden()
  try {
    await digger(DECIDE)
    assert.equal((await digger({ action: 'partner-answer', id: 'Q1', text: 'A', why: 'x' })).status, 403)
    assert.equal((await sage({ action: 'partner-answer', id: 'Q1', text: 'A number' })).status, 400, 'a why is needed')
    const answered = await sage({ action: 'partner-answer', id: 'Q1', text: 'A number', why: 'your advice; it fits the vibe' }, NOW + 2 * MIN)
    assert.equal(answered.ok, true, answered.why)
    const q1 = await item(dir, 'Q1')
    assert.deepEqual(['State', 'Answered by', 'Route', 'Daily note'].map(key => valueOf(q1, key)), ['answered', 'partner', 'partner', 'N1'])
    assert.deepEqual(q1.sections.get('Answer'), ['A number'])
    assert.match(q1.sections.get('History').at(-1), /Sage: answered by the partner: A number \(why: your advice; it fits the vibe\)$/)
    // The step goes on, as with the person's answer.
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'in progress')
    assert.equal(answered.result.wake.to, 'Digger')
    assert.equal(answered.result.wake.id, 'Q1')
    assert.match(answered.result.wake.text, /^Your partner answered this for the person: A number \(why: your advice; it fits the vibe\)\. The person may still take it back\.$/)
    // The line in the daily note of the focus, with an Undo.
    const note = await item(dir, 'N1')
    assert.deepEqual(['Kind', 'From', 'To', 'Of'].map(key => valueOf(note, key)), ['note', 'Sage', 'you', 'G6'])
    assert.deepEqual(dailyNote(note).decided, [{ text: 'Q1 (Digger, B1): A number or a bar for the damage? → A number (your advice; it fits the vibe)', undoAsked: false, ask: 'Q1' }])
    assert.equal(answered.result.note, 'N1')
    // A second answer the same day joins the same note; the note's line counts it.
    await digger({ action: 'ask', of: 'B1', kind: 'decide', text: 'Yellow or white?', options: ['A yellow', 'B white'], advice: 'A' })
    assert.equal((await sage({ action: 'partner-answer', id: 'Q2', why: 'your advice' })).ok, true, 'the text is the advice when none is given')
    const both = await item(dir, 'N1')
    assert.equal(both.sections.get('Decided for you').length, 2)
    assert.equal(valueOf(both, 'Text'), 'Today\'s note on G6: 2 decided for you, 0 need you')
    assert.deepEqual((await item(dir, 'Q2')).sections.get('Answer'), ['A'])
    // Answered once: a second answer is refused.
    assert.equal((await sage({ action: 'partner-answer', id: 'Q1', text: 'B bar', why: 'changed my mind' })).status, 409)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('partner-answer: the newest note is the partner\'s own of today; yesterday\'s gets none; no focus makes a note of the day', async () => {
  const { dir, digger, sage } = await garden()
  try {
    await sage({ action: 'note', to: 'you', of: 'G6', decided: ['Kept the old map icons'] }, NOW - 24 * 60 * MIN)
    await digger(DECIDE)
    await sage({ action: 'partner-answer', id: 'Q1', why: 'your advice' })
    assert.equal(valueOf(await item(dir, 'Q1'), 'Daily note'), 'N2')
    assert.deepEqual((await item(dir, 'N1')).sections.get('Decided for you'), ['- Kept the old map icons'])
    // The morning note of today takes the answers of today.
    await sage({ action: 'note', to: 'you', of: 'G6', decided: ['Death puff lasts half a second'], needs: [] }, NOW + MIN)
    await digger({ action: 'ask', of: 'B1', kind: 'decide', text: 'Yellow or white?', options: ['A yellow', 'B white'], advice: 'A' }, NOW + 2 * MIN)
    await sage({ action: 'partner-answer', id: 'Q2', why: 'your advice' }, NOW + 3 * MIN)
    assert.deepEqual(dailyNote(await item(dir, 'N3')).decided.map(one => one.text), ['Death puff lasts half a second', 'Q2 (Digger, B1): Yellow or white? → A (your advice)'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  const bare = await garden({ focusGoal: null })
  try {
    await bare.digger(DECIDE)
    assert.equal((await bare.sage({ action: 'partner-answer', id: 'Q1', why: 'your advice' })).ok, true)
    const note = await item(bare.dir, 'N1')
    assert.deepEqual(['To', 'Of', 'From'].map(key => valueOf(note, key)), ['you', null, 'Sage'])
    assert.deepEqual(note.sections.get('Decided for you'), ['- Q1 (Digger, B1): A number or a bar for the damage? → A (your advice)'])
  } finally {
    await rm(bare.dir, { recursive: true, force: true })
  }
})

test('Undo of a partner\'s answer: the ask opens again for the person, the asking chat is told once to wait; once only', async () => {
  const { dir, digger, sage, person } = await garden()
  try {
    await digger(DECIDE)
    await sage({ action: 'partner-answer', id: 'Q1', text: 'A number', why: 'your advice' })
    const line = 'Q1 (Digger, B1): A number or a bar for the damage? → A number (your advice)'
    const checked = await person({ action: 'undo', id: 'N1', line, check: true })
    assert.equal(checked.ok, true, checked.why)
    assert.equal(checked.result.undo.ask, 'Q1')
    const undone = await person({ action: 'undo', id: 'N1', line }, NOW + 5 * MIN)
    assert.equal(undone.ok, true, undone.why)
    assert.deepEqual(undone.result.wake, { to: 'Digger', id: 'Q1', line: 'The person took back the partner\'s answer on Q1; wait for their answer.' })
    const q1 = await item(dir, 'Q1')
    assert.deepEqual(['State', 'Route', 'Answered by'].map(key => valueOf(q1, key)), ['open', 'person', null])
    assert.equal(q1.sections.has('Answer'), false)
    assert.deepEqual(q1.sections.get('Route'), ['Your partner had answered: A number; you took it back'])
    assert.match(q1.sections.get('History').at(-1), /person: took back the partner's answer: A number; open for the person$/)
    // The step waits on the person again; the note marks the line.
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'waiting on you')
    assert.deepEqual(dailyNote(await item(dir, 'N1')).decided.map(one => one.undoAsked), [true])
    // Under Needs your attention again, with the line.
    const [need] = storeNeeds({ ok: true, dir, ...(await readStore(dir)) }, { now: NOW + 5 * MIN, names: ['Digger'], prefix: 'Garden · ' })
    assert.deepEqual([need.workId, need.routeNote, need.canAnswer], ['Q1', 'Your partner had answered: A number; you took it back', true])
    // Once only: from the note or from the ask's card.
    for (const again of [await person({ action: 'undo', id: 'N1', line }), await person({ action: 'undo', id: 'Q1' })]) {
      assert.equal(again.ok, true, again.why)
      assert.equal(again.result.changed, false)
      assert.equal(again.result.wake ?? null, null)
    }
    // The person answers it now as any ask.
    assert.equal((await person({ action: 'answer', id: 'Q1', text: 'B bar' })).ok, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Undo from the answered ask\'s card (by its id) does the same; an ask the person answered has no such Undo', async () => {
  const { dir, digger, sage, person } = await garden()
  try {
    await digger({ ...DECIDE, blocking: false })
    await sage({ action: 'partner-answer', id: 'Q1', text: 'A number', why: 'your advice' })
    const needs = () => readStore(dir).then(store => storeNeeds({ ok: true, dir, ...store }, { now: NOW + 60 * MIN, names: ['Digger'], prefix: 'Garden · ' }))
    // Answered by the partner, it stays among the closed cards for a day, with its Undo.
    const [shown] = await needs()
    assert.deepEqual([shown.workId, shown.answer.by, shown.answer.text, shown.answer.why, shown.canTakeBack], ['Q1', 'partner', 'A number', 'your advice', true])
    const undone = await person({ action: 'undo', id: 'Q1' }, NOW + 61 * MIN)
    assert.equal(undone.ok, true, undone.why)
    assert.equal(undone.result.wake.to, 'Digger')
    assert.equal(valueOf(await item(dir, 'Q1'), 'State'), 'open')
    assert.deepEqual(dailyNote(await item(dir, 'N1')).decided.map(one => one.undoAsked), [true])
    // Not blocking: the step stays in progress.
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'in progress')
    await person({ action: 'answer', id: 'Q1', text: 'B bar' })
    assert.equal((await person({ action: 'undo', id: 'Q1' })).status, 409)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('undoLine: a partner\'s answer is taken back in the store and its asking chat told, nothing typed to the partner', async () => {
  const { dir, ctx, digger, sage } = await garden()
  try {
    await digger(DECIDE)
    await sage({ action: 'partner-answer', id: 'Q1', text: 'A number', why: 'your advice' })
    const work = body => workApi(body, { ...ctx(), as: 'person' })
    const typed = []
    const told = []
    const ports = { work, type: async undo => typed.push(undo) && { ok: true, result: {} }, tell: async wake => told.push(wake) }
    const line = 'Q1 (Digger, B1): A number or a bar for the damage? → A number (your advice)'
    const both = await Promise.all([undoLine({ note: 'N1', line }, ports), undoLine({ note: 'Q1' }, ports)])
    assert.deepEqual(both.map(one => one.ok), [true, true])
    assert.deepEqual(typed, [])
    assert.deepEqual(told, [{ to: 'Digger', id: 'Q1', line: 'The person took back the partner\'s answer on Q1; wait for their answer.' }])
    assert.equal(valueOf(await item(dir, 'Q1'), 'State'), 'open')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('work next shows the partner the asks it answers for the person first', async () => {
  const { dir, digger, sage } = await garden()
  try {
    await digger(DECIDE)
    const next = await sage({ action: 'next' })
    assert.equal(next.ok, true, next.why)
    assert.match(next.result.text, /^Asks you answer for the person \(roles\/partner\.md, "Detail questions"\):\n- Q1 decide from Digger on B1, blocking: A number or a bar for the damage\? · A number \| B bar · advised: A\n/)
    assert.match(next.result.text, /work partner-answer Q1 .*work escalate Q1/s)
    // Nobody else sees them.
    assert.doesNotMatch((await digger({ action: 'next' })).result.text, /answer for the person/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- the board wakes the partner, and hands on what it does not answer ----

const partnerLane = (state, idleSince = null, isRunning = true) => ({ name: 'Sage', state, isRunning, idle: idleSince === null ? null : { since: idleSince } })
const plan = async (dir, partner, now = NOW) => reconcile({ store: await readStore(dir), lanes: [{ name: 'Lead', isMain: true, state: 'free', isRunning: true }], partner, now, times: TIMES, prefix: 'Garden · ' })

test('the reconciler: the partner is woken for a routed ask while it is free; not while busy or paused', async () => {
  const { dir, digger, person } = await garden()
  try {
    await digger(DECIDE, NOW - 2 * MIN)
    assert.deepEqual((await plan(dir, partnerLane('free', NOW - 20 * MIN))).partnerAsks, [{ id: 'Q1', chat: 'Sage', since: '2026-10-19 09:58' }])
    assert.deepEqual((await plan(dir, partnerLane('working'))).partnerAsks, [])
    assert.deepEqual((await plan(dir, partnerLane('free', NOW - 20 * MIN))).escalations, [])
    await person({ action: 'pause-all' })
    assert.deepEqual((await plan(dir, partnerLane('free', NOW - 20 * MIN))).partnerAsks, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the reconciler: to the person after 30 minutes the partner was free and did not answer; at once without a partner chat or when switched off', async () => {
  const { dir, digger, person } = await garden()
  try {
    await digger(DECIDE, NOW)
    const routed = valueOf(await item(dir, 'Q1'), 'Filed')
    assert.equal(routed, String(NOW))
    assert.deepEqual((await plan(dir, partnerLane('free', NOW - 60 * MIN), NOW + 29 * MIN)).escalations, [])
    assert.deepEqual((await plan(dir, partnerLane('free', NOW - 60 * MIN), NOW + 31 * MIN)).escalations, [{ id: 'Q1', why: 'the partner did not answer in 30 min' }])
    // Busy for most of it: the 30 minutes count from when it was free again.
    assert.deepEqual((await plan(dir, partnerLane('free', NOW + 20 * MIN), NOW + 31 * MIN)).escalations, [])
    assert.deepEqual((await plan(dir, partnerLane('working'), NOW + 90 * MIN)).escalations, [])
    // Not the person's yet: no "has waited for your answer" either.
    assert.equal((await plan(dir, partnerLane('working'), NOW + 90 * MIN)).flags.some(flag => flag.kind === 'old ask'), false)
    assert.deepEqual((await plan(dir, null, NOW + MIN)).escalations, [{ id: 'Q1', why: 'no partner chat is on the board' }])
    await person({ action: 'partner-answers', on: false })
    assert.deepEqual((await plan(dir, partnerLane('working'), NOW + MIN)).escalations, [{ id: 'Q1', why: 'your partner\'s answers are switched off' }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the delivery: one line per routed ask, once; withdrawn once answered; the board hands on as the server', async () => {
  const { dir, digger, sage, server } = await garden()
  try {
    await digger(DECIDE)
    const outbox = memoryStore()
    let n = 0
    const deliver = async (reconciled, pause = null) => deliverWork({ state: { reconciled, chats: [], pause }, dir, outbox, apply: body => server(body), now: NOW, maxChars: 2000, newId: () => `m${(n += 1)}` })
    const once = { moves: [], deliveries: [], says: [], notes: [], partnerAsks: [{ id: 'Q1', chat: 'Sage', since: '2026-10-19 10:00' }], escalations: [] }
    await deliver(once)
    await deliver(once)
    assert.deepEqual(outbox.outbox().map(one => [one.to, one.kind, one.about, messageText(one, () => '10:00')]), [['Sage', 'partner-ask', 'Q1', 'work: Q1 is yours to answer for the person; run work next']])
    assert.equal(partnerAskWords('Q7'), 'work: Q7 is yours to answer for the person; run work next')
    // Answered: a line still waiting is withdrawn.
    await sage({ action: 'partner-answer', id: 'Q1', why: 'your advice' })
    await deliver({ ...once, partnerAsks: [] })
    assert.equal(outbox.outbox()[0].state, 'dropped')
    // Handed on by the board: History says why.
    await digger({ action: 'ask', of: 'B1', kind: 'decide', text: 'Yellow or white?', options: ['A yellow', 'B white'], advice: 'A' })
    await deliver({ ...once, partnerAsks: [], escalations: [{ id: 'Q2', why: 'the partner did not answer in 30 min' }] }, { state: 'pausing', since: NOW })
    const q2 = await item(dir, 'Q2')
    assert.equal(valueOf(q2, 'Route'), 'person')
    assert.match(q2.sections.get('History').at(-1), /server: to the person: the partner did not answer in 30 min$/)
    assert.deepEqual(q2.sections.get('Route'), ['Your partner did not answer in 30 min: it is yours'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the ask\'s head keeps its route: Route, Answered by and Daily note are keys of an ask', () => {
  const ask = parseItem('Id: Q1\nKind: ask\nTitle: t\nState: answered\nSince: 2026-10-19 10:00\nRoute: partner\nAnswered by: partner\nDaily note: N1\n')
  assert.equal(validateHead(ask.head), null)
  assert.match(serializeItem(ask), /Route: partner\nAnswered by: partner\nDaily note: N1/)
})
