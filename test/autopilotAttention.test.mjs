// Autopilot clears what it can the moment the person switches it on (the person, 2026-11-02, on a 47-hour-old Do card "Open the
// recap and try it": "if autopilot is turned on, the outstanding, needing for attentions get reevaluated and possible resolved if
// autopilot would answer them"). The store's side: the switch-on's sweep puts the asks the focus goal's recap asks already into the
// recap (the live Q569, the goal's own "open the recap", and the live Q578, a look of a step the recap names), never touches one
// somebody handed to the person, and keeps what it moved for the Undo; the recap's Send answers the goal's own ask; the Advisor's
// check "by autopilot" judges only what stands for the person and its closes join that record; the person's Undo opens it all again,
// once. Made-up items in a temporary folder; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseAutopilotCleared, startedCleared, addedCleared, clearedItem, isLiveCleared, SHOWN_MS } from '../src/work/autopilotCleared.mjs'
import { workApi } from '../src/work/api.mjs'
import { routedAwayOf, storeNeeds } from '../src/work/lists.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readAutopilotClearedFile, readObsoleteFile, readStore, share, writeAutopilotClearedFile } from '../src/work/store.mjs'
import { openItemsOf } from '../src/work/obsolete.mjs'

// B917: these tests edit store files by hand and read at once; on the board a hand edit shows within share.ms.
share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 12, 27).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** An item file's text from its head fields and its sections. */
function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
/** An open ask; `routed` true: the board's own route to the person is in its History (what the first switch-on wrote). */
const ask = (id, fields, words = null, { routed = false, route = [] } = {}) => text(
  { Id: id, Kind: 'ask', Title: fields.Title, State: 'open', Since: at(50), Filed: String(NOW - 50 * MIN), Blocking: 'no', ...fields },
  { Text: [words ?? fields.Title], ...(route.length === 0 ? {} : { Route: route }), History: [`- ${at(50)} ${fields.Owner ?? 'server'}: asked (${fields.Asks ?? 'decide'})`, ...(routed ? [`- ${at(5)} server: autopilot: routed to person`] : [])] },
)
const step = (id, fields, sections = {}) => text({ Id: id, Kind: 'step', Activity: 'Garden', Since: at(90), ...fields }, { ...sections, History: [`- ${at(90)} Lead: made`] })
const incident = (id, title, state = 'open') => text({ Id: id, Kind: 'incident', Title: title, State: state, Since: at(300) }, { History: [`- ${at(300)} server: opened`] })

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'autopilot-attention-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}

const ROLES = { Lead: 'main', Partner: 'advisor', Painter: 'worker', Checker: 'worker' }
const PATH = 'pictures/g29/recap/demo.json'
/** The recap rows of the focus goal G29: its part names B50. */
const RECAPS = [{ step: 'B50', goal: 'G29', path: PATH, key: 'Moat', title: 'The moat', verdict: null, at: null }]
const ctx = (dir, now, as, more = {}) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G29', focusHasDemo: true, recaps: RECAPS, pictureProblem: async () => null, ...(as === undefined ? {} : { as }), ...more })
const pass = (dir, body, now = NOW, more = {}) => workApi({ action: 'autopilot', on: true, ...body }, ctx(dir, now, 'server', more))
const person = (dir, body, now = NOW + MIN) => workApi(body, ctx(dir, now, 'person'))
const chat = (dir, who, body, now = NOW + MIN) => workApi({ ...body, chat: who }, ctx(dir, now))
const read = async dir => (await readStore(dir)).items
const field = (items, id, key) => items.get(id).head.get(key)
const history = (items, id) => items.get(id).sections.get('History') ?? []
const cleared = async dir => (await readAutopilotClearedFile(dir)).record

const RECAP_LINK = `Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=${PATH}).`
/** The live Q569 and Q578, made up: both routed to the person by the first switch-on's pass. */
const live = () => ({
  B50: step('B50', { Title: 'Round the moat', State: 'review', Owner: 'Painter', Goal: 'G29' }),
  Q1: ask('Q1', { Title: RECAP_LINK, Owner: 'Painter', Asks: 'do', Via: 'chat', Route: 'person', Pictures: 'pictures/B49/live.jpg' }, `${RECAP_LINK} It runs on the trial board, which has the change.`, { routed: true }),
  Q2: ask('Q2', { Title: 'Is 68 beside the other map\'s 64 good enough for this map, or should the 75 target be reset for this panel?', Owner: 'Painter', Asks: 'look', Advice: 'accepting it and keeping 75', Via: 'chat', Route: 'person', Pictures: 'pictures/B50/evidence.png' }, null, { routed: true }),
})

test('the switch-on\'s sweep puts the asks the focus recap asks already into the recap; what somebody handed on, or is no recap ask, stays', async t => {
  const dir = await storeWith({
    ...live(),
    // Board-routed to the person, but a goal question: stays.
    Q3: ask('Q3', { Title: 'Rebuild G29: which way?', Owner: 'Partner', Asks: 'decide', Of: 'G29', Options: 'A walls | B pool', Advice: 'A', Route: 'person' }, null, { routed: true }),
    // The recap of another goal: the same words stay the person's as before.
    Q4: ask('Q4', { Title: 'Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=pictures/g7/recap/demo.json).', Owner: 'Painter', Asks: 'do', Via: 'chat', Route: 'person' }, null, { routed: true }),
    // Somebody handed it to the person (a line on its card): never judged again, whatever its words.
    Q5: ask('Q5', { Title: RECAP_LINK, Owner: 'Painter', Asks: 'do', Via: 'chat', Route: 'person' }, null, { routed: true, route: ['Your partner hands this to you: a new look is yours'] }),
    // Its step is named by no part of the recap.
    Q6: ask('Q6', { Title: 'Is 70 beside the other map\'s 64 good enough, or should the 75 target be reset?', Owner: 'Painter', Asks: 'look', Via: 'chat', Route: 'person', Pictures: 'pictures/B60/evidence.png' }, null, { routed: true }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const before = await Promise.all(['Q3', 'Q4', 'Q5', 'Q6'].map(id => readFile(join(dir, `${id}.md`), 'utf8')))
  // The board's refresh (no sweep) judges nothing it routed to the person already.
  const plain = await pass(dir, {})
  assert.deepEqual(plain.result.routed, [])
  assert.equal(field(await read(dir), 'Q1', 'Route'), 'person')
  assert.equal(await cleared(dir), null, 'no switch-on, no record')
  // The switch-on.
  const swept = await pass(dir, { sweep: true })
  assert.equal(swept.ok, true, swept.why)
  assert.deepEqual(swept.result.routed, [{ id: 'Q1', to: 'recap' }, { id: 'Q2', to: 'recap' }])
  const items = await read(dir)
  // The goal's own ask: routed to the recap, under no step; one more route line in its History, the board's own.
  assert.deepEqual([field(items, 'Q1', 'Route'), field(items, 'Q1', 'Of')], ['recap', undefined])
  assert.deepEqual(history(items, 'Q1').filter(line => line.includes('autopilot: routed to')).map(line => line.replace(/^- [\d: -]+ /, '')), ['server: autopilot: routed to person', 'server: autopilot: routed to recap'])
  // The step's look: put under B50, which reads that it waits for the recap (as any ask of a step does).
  assert.deepEqual([field(items, 'Q2', 'Route'), field(items, 'Q2', 'Of')], ['recap', 'B50'])
  assert.ok(history(items, 'Q2').some(line => line.includes('autopilot: put under B50, which the goal\'s recap names')))
  assert.ok(items.get('B50').sections.get('Context').some(line => line.trim() === 'Recap verdict: waits (Q2)'))
  assert.equal(field(items, 'B50', 'State'), 'review', 'the step stays as it is')
  // The rest stays as it was, byte for byte.
  assert.deepEqual(await Promise.all(['Q3', 'Q4', 'Q5', 'Q6'].map(id => readFile(join(dir, `${id}.md`), 'utf8'))), before)
  // Out of Needs your attention, in the recap's lists.
  const work = { ok: true, items }
  const needs = storeNeeds(work, { now: NOW + 2 * MIN, autopilot: true, roleOf: name => ROLES[name] ?? null, focusGoal: 'G29', focusHasDemo: true, recapSteps: RECAPS }).filter(one => one.answer === null).map(one => one.workId)
  assert.deepEqual(needs.sort(), ['Q3', 'Q4', 'Q5', 'Q6'])
  assert.deepEqual(routedAwayOf(work).map(one => [one.id, one.route, one.of, one.asks]), [['Q1', 'recap', null, 'do'], ['Q2', 'recap', 'B50', 'look']])
  // The record: each item moved into the recap, in the words of the page's line.
  const record = await cleared(dir)
  assert.deepEqual(record, {
    at: NOW, undoneAt: null,
    items: [{ id: 'Q1', title: RECAP_LINK, how: 'recap', why: 'moved into your recap' }, { id: 'Q2', title: 'Is 68 beside the other map\'s 64 good enough for this map, or should the 75 target be reset for this panel?', how: 'recap', why: 'moved into your recap' }],
  })
  // The sweep is once: the next pass moves nothing and keeps the record.
  const again = await pass(dir, { sweep: true }, NOW + 5 * MIN)
  assert.deepEqual(again.result.routed, [])
  assert.equal((await cleared(dir)).at, NOW)
})

test('a new ask is filed under no route when it names a step of the recap; the board\'s pass puts it under that step', async t => {
  // Painter holds no step (B50 is Checker's), so its ask stands under none.
  const dir = await storeWith({ B50: step('B50', { Title: 'Round the moat', State: 'review', Owner: 'Checker', Goal: 'G29' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filed = await chat(dir, 'Painter', { action: 'ask', kind: 'look', text: 'Is the moat good enough as it is?', pictures: ['pictures/B50/evidence.png'] }, NOW, { autopilot: true })
  assert.equal(filed.ok, true, filed.why)
  const id = filed.result.id
  assert.equal(field(await read(dir), id, 'Route'), undefined, 'no route at filing: the pass routes it')
  const done = await pass(dir, {}, NOW + MIN)
  assert.deepEqual(done.result.routed, [{ id, to: 'recap' }])
  const items = await read(dir)
  assert.deepEqual([field(items, id, 'Route'), field(items, id, 'Of')], ['recap', 'B50'])
})

test('the recap\'s Send answers the goal\'s own ask (its words link the recap) once any part is judged, and wakes its chat', async t => {
  const dir = await storeWith(live())
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir, { sweep: true })
  // A Send with no part judged answers nothing.
  const none = await workApi({ action: 'recap-answered', goal: 'G29', round: 1, path: PATH, parts: [] }, ctx(dir, NOW + MIN, 'server'))
  assert.deepEqual(none.result.closed, [])
  // Another goal's recap does not answer it.
  const other = await workApi({ action: 'recap-answered', goal: 'G7', round: 1, path: 'pictures/g7/recap/demo.json', parts: [{ verdict: 'approved', steps: ['B7'], title: 'The wall' }] }, ctx(dir, NOW + MIN, 'server', { recaps: [] }))
  assert.deepEqual(other.result.closed, [])
  // The recap of G29: the part showing B50 is sent back; the look of B50 and the goal's own ask close.
  const answered = await workApi({ action: 'recap-answered', goal: 'G29', round: 2, path: PATH, parts: [{ verdict: 'sent-back', steps: ['B50'], comment: 'rounder at the top', title: 'The moat' }] }, ctx(dir, NOW + 10 * MIN, 'server'))
  assert.equal(answered.ok, true, answered.why)
  assert.deepEqual(answered.result.closed, ['Q2', 'Q1'])
  assert.deepEqual(answered.result.wakes.map(one => [one.to, one.id]), [['Painter', 'Q2'], ['Painter', 'Q1']])
  const items = await read(dir)
  assert.deepEqual(items.get('Q1').sections.get('Answer'), ['Answered in the recap of G29, round 2.'])
  assert.equal(field(items, 'Q1', 'State'), 'answered')
  assert.ok(history(items, 'Q1').some(line => line.includes('closed by the goal\'s recap: Answered in the recap of G29, round 2.')))
  assert.equal(answered.result.wakes[1].text, 'The person answered this in the goal\'s recap: Answered in the recap of G29, round 2.')
  // Without the path of the Send, the recap rows of the goal give it.
  const dir2 = await storeWith(live())
  t.after(() => rm(dir2, { recursive: true, force: true }))
  await pass(dir2, { sweep: true })
  const byRows = await workApi({ action: 'recap-answered', goal: 'G29', round: 1, parts: [{ verdict: 'approved', steps: ['B50'], title: 'The moat' }] }, ctx(dir2, NOW + MIN, 'server'))
  assert.deepEqual(byRows.result.closed, ['Q2', 'Q1'])
})

test('a recap ask with no step waits only while the focus goal\'s recap is the one its words link; else it is the person\'s, with a line', async t => {
  const dir = await storeWith(live())
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir, { sweep: true })
  const stays = await pass(dir, {}, NOW + 5 * MIN)
  assert.deepEqual(stays.result.escalated, [])
  assert.equal(field(await read(dir), 'Q1', 'Route'), 'recap')
  // The focus moved on (its recap is another file now): the goal's own ask is the person's again, and says why.
  const moved = await pass(dir, {}, NOW + 6 * MIN, { focusGoal: 'G30', recaps: [{ step: 'B70', goal: 'G30', path: 'pictures/g30/recap/demo.json' }] })
  assert.ok(moved.result.escalated.includes('Q1'))
  const items = await read(dir)
  assert.equal(field(items, 'Q1', 'Route'), 'person')
  assert.match(items.get('Q1').sections.get('Route')[0], /^The recap it links is not the focus goal's recap now/)
})

test('the Advisor\'s check by Autopilot judges only what stands for the person, and what it closes joins the record; Undo opens it all again, once', async t => {
  const dir = await storeWith({
    ...live(),
    B60: step('B60', { Title: 'Plant the hedge', State: 'in progress', Owner: 'Painter', Goal: 'G30' }),
    B61: step('B61', { Title: 'Label the hedge', State: 'queued', Goal: 'G30' }),
    // Stands for the person: no route, and the board's own person route; one routed away is none of the check's.
    Q10: ask('Q10', { Title: 'Which spade for the hedge?', Owner: 'Painter', Asks: 'provide', Of: 'B60', Via: 'chat', Blocking: 'yes' }),
    Q11: ask('Q11', { Title: 'Restart the board for the hedge popup?', Owner: 'Painter', Asks: 'provide', Via: 'chat', Route: 'person' }, null, { routed: true }),
    Q12: ask('Q12', { Title: 'Icons or words on the bar?', Owner: 'Painter', Asks: 'decide', Of: 'B60', Via: 'chat', Route: 'partner' }),
    Q13: ask('Q13', { Title: 'Shorter names on the hedge labels? A: yes B: no', Owner: 'Partner', Asks: 'decide', Of: 'B61', Via: 'refine' }),
    // An incident that came back: signals change 6 (B915, the lead's decision 8): the Supervisor judges it, never the Advisor's check.
    X1: incident('X1', 'A watch rule fired twice', 'came back'),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir, { sweep: true })
  // The check by Autopilot: the open asks that stand for the person; never a refine question (Q13: Autopilot answers those itself,
  // and closing one would tick its step done), and since signals change 6 no incident (X1 is the Supervisor's to judge).
  const checked = await person(dir, { action: 'obsolete-check', by: 'autopilot' }, NOW + MIN)
  assert.equal(checked.ok, true, checked.why)
  assert.deepEqual(checked.result.obsoleteCheck.ids, ['Q10', 'Q11'], 'not Q1 and Q2 (in the recap), not Q12 (the partner\'s), not Q13 (a refine question), not X1 (an incident)')
  const file = await readObsoleteFile(dir)
  assert.equal(file.record.by, 'autopilot')
  // The Advisor's verdicts: Q10 is obsolete; a line for the refine question, or for the incident, is refused (not in this check).
  const stray = await chat(dir, 'Partner', { action: 'obsolete', points: ['obsolete: Q13 · its step has been refined again'] }, NOW + 2 * MIN)
  assert.equal(stray.status, 400)
  assert.equal((await chat(dir, 'Partner', { action: 'obsolete', points: ['obsolete: X1 · a false alarm'] }, NOW + 2 * MIN)).status, 400)
  const verdicts = await chat(dir, 'Partner', { action: 'obsolete', points: ['obsolete: Q10 · the spade was chosen · B60 is in progress', 'open: Q11 · still needed'] }, NOW + 2 * MIN)
  assert.equal(verdicts.ok, true, verdicts.why)
  assert.deepEqual(verdicts.result.closed, ['Q10'])
  const record = await cleared(dir)
  assert.equal(record.at, NOW + 2 * MIN, 'the record holds the closes too, from the newest clear')
  assert.deepEqual(record.items.map(one => [one.id, one.how, one.why, one.was]), [
    ['Q1', 'recap', 'moved into your recap', undefined], ['Q2', 'recap', 'moved into your recap', undefined],
    ['Q10', 'closed', 'the spade was chosen', undefined],
  ])
  assert.equal(record.items[2].title, 'Which spade for the hedge?')
  let items = await read(dir)
  assert.equal(field(items, 'Q10', 'State'), 'withdrawn')
  assert.equal(field(items, 'X1', 'State'), 'came back', 'the incident is left to the Supervisor')
  assert.equal(field(items, 'B61', 'State'), 'queued', 'no step is ticked done')
  assert.equal(field(items, 'Q13', 'State'), 'open', 'the refine question is left alone')

  // Undo: the person's alone, once.
  assert.equal((await chat(dir, 'Painter', { action: 'autopilot-undo' })).status, 403)
  const undone = await person(dir, { action: 'autopilot-undo' }, NOW + 5 * MIN)
  assert.equal(undone.ok, true, undone.why)
  assert.deepEqual(undone.result.undone, ['Q1', 'Q2', 'Q10'])
  assert.deepEqual(undone.result.skipped, [])
  assert.equal(undone.result.text, 'Undone 3: Q1, Q2, Q10.')
  items = await read(dir)
  // A closed ask: open again for the person, with the line that says they took it back, and its step told.
  assert.deepEqual([field(items, 'Q10', 'State'), field(items, 'Q10', 'Route'), field(items, 'Q10', 'Since')], ['open', 'person', stamp(NOW + 5 * MIN)])
  assert.deepEqual(items.get('Q10').sections.get('Route'), ['The person took it back from Autopilot (Undo)'])
  // It was blocking its step, which went on when the ask was closed: it comes back non-blocking and the step is not moved.
  assert.equal(field(items, 'Q10', 'Blocking'), 'no')
  assert.deepEqual(history(items, 'Q10').slice(-2).map(line => line.replace(/^- [\d: -]+ /, '')), ['person: reopened: the person\'s Undo of Autopilot\'s clear', 'person: reopened non-blocking: its step went on'])
  assert.equal(field(items, 'B60', 'State'), 'in progress', 'its step is not moved')
  assert.ok(items.get('B60').sections.get('Context').some(line => line.trim() === 'Q10 reopened by the person\'s Undo'))
  // The incident was never closed by the check: it stands as it was. The two moved into the recap: back to the person, with the same line.
  assert.equal(field(items, 'X1', 'State'), 'came back')
  for (const id of ['Q1', 'Q2']) {
    assert.equal(field(items, id, 'Route'), 'person', id)
    assert.deepEqual(items.get(id).sections.get('Route'), ['The person took it back from Autopilot (Undo)'], id)
    assert.ok(history(items, id).at(-1).endsWith('person: autopilot: undone, back to the person'), id)
  }
  assert.equal((await cleared(dir)).undoneAt, NOW + 5 * MIN)
  // They stand in Needs your attention again, and no later pass (the sweep too) routes them away.
  const later = await pass(dir, { sweep: true }, NOW + 8 * MIN)
  assert.deepEqual(later.result.routed, [])
  items = await read(dir)
  const needs = storeNeeds({ ok: true, items }, { now: NOW + 9 * MIN, autopilot: true, roleOf: name => ROLES[name] ?? null, focusGoal: 'G29', focusHasDemo: true, recapSteps: RECAPS }).filter(one => one.answer === null).map(one => one.workId)
  for (const id of ['Q1', 'Q2', 'Q10', 'Q11']) assert.ok(needs.includes(id), id)
  // A second Undo is refused.
  const twice = await person(dir, { action: 'autopilot-undo' }, NOW + 9 * MIN)
  assert.equal(twice.ok, false)
  assert.equal(twice.status, 409)
  assert.equal(twice.why, 'Undone already.')
})

test('Undo leaves what is not as it was cleared; with nothing cleared it says so; the check of the person closes without the record', async t => {
  const dir = await storeWith({
    ...live(),
    Q20: ask('Q20', { Title: 'Which spade?', Owner: 'Painter', Asks: 'provide', Via: 'chat' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.equal((await person(dir, { action: 'autopilot-undo' })).status, 404, 'no record')
  // A check started by the person closes Q20 and writes no record.
  assert.equal((await person(dir, { action: 'obsolete-check' }, NOW + MIN)).ok, true)
  const closed = await chat(dir, 'Partner', { action: 'obsolete', points: ['obsolete: Q20 · stale · none', 'open: Q1 · open · none', 'open: Q2 · open · none'] }, NOW + 2 * MIN)
  assert.deepEqual(closed.result.closed, ['Q20'])
  assert.equal(await cleared(dir), null)
  // The switch-on moves Q1 and Q2; Q1 is answered by the recap before the Undo, Q2 is gone from the store.
  await pass(dir, { sweep: true }, NOW + 3 * MIN)
  await workApi({ action: 'recap-answered', goal: 'G29', round: 1, path: PATH, parts: [{ verdict: 'approved', steps: ['B50'], title: 'The moat' }] }, ctx(dir, NOW + 4 * MIN, 'server'))
  const undone = await person(dir, { action: 'autopilot-undo' }, NOW + 5 * MIN)
  assert.equal(undone.ok, true, undone.why)
  assert.deepEqual(undone.result.undone, [])
  assert.deepEqual(undone.result.skipped, [{ id: 'Q1', why: 'it is answered now' }, { id: 'Q2', why: 'it is answered now' }])
  assert.equal(undone.result.text, 'Nothing was undone. Left as it is: Q1 (it is answered now); Q2 (it is answered now).')
  assert.equal((await cleared(dir)).undoneAt, NOW + 5 * MIN)
})

test('the record: read as written, bad files are none, a live one is kept by a new switch-on and added to by the Advisor\'s closes', () => {
  assert.equal(parseAutopilotCleared(null), null)
  assert.equal(parseAutopilotCleared('{'), null)
  assert.equal(parseAutopilotCleared('{"at":"x","items":[]}'), null)
  const long = 'w'.repeat(300)
  const record = parseAutopilotCleared(JSON.stringify({ at: NOW, items: [{ id: 'Q1', title: long, how: 'closed', why: long }, { id: 'Q2', title: 'x', how: 'burned' }, { title: 'no id', how: 'recap' }], undoneAt: null }))
  assert.equal(record.items.length, 1, 'an item of no id or with a how of its own is left out')
  assert.deepEqual([record.items[0].title.length, record.items[0].why.length], [140, 160], 'one line, cut at 140 and 160 characters')
  assert.equal(isLiveCleared(record, NOW + SHOWN_MS - 1), true)
  assert.equal(isLiveCleared(record, NOW + SHOWN_MS), false, 'a day later the page shows no line')
  assert.equal(isLiveCleared({ ...record, undoneAt: NOW }, NOW + MIN), false)
  const one = clearedItem('Q3', 'Which?', 'recap', 'moved into your recap')
  // A switch-on within the day keeps the items still to undo; an old or undone record is replaced.
  assert.deepEqual(startedCleared(record, [one], NOW + MIN), { at: NOW + MIN, items: [...record.items, one], undoneAt: null })
  assert.deepEqual(startedCleared({ ...record, undoneAt: NOW }, [one], NOW + MIN).items, [one])
  assert.deepEqual(startedCleared(null, [one], NOW).items, [one])
  // Every addition starts the day anew: the newest clear gets its full 24 h for the Undo.
  assert.deepEqual(addedCleared(record, [one, one], NOW + MIN), { at: NOW + MIN, items: [...record.items, one], undoneAt: null }, 'each item once, from the newest clear')
  assert.deepEqual(addedCleared(null, [one], NOW + MIN), { at: NOW + MIN, items: [one], undoneAt: null })
  assert.deepEqual(addedCleared({ ...record, undoneAt: NOW }, [one], NOW + MIN).items, [one], 'an undone record is not carried on')
  // An incident keeps the state it had.
  assert.equal(clearedItem('X1', 'A rule', 'closed', 'false alarm', 'came back').was, 'came back')
  assert.equal(parseAutopilotCleared(JSON.stringify({ at: NOW, items: [clearedItem('X1', 'A rule', 'closed', 'false alarm', 'came back'), clearedItem('Q1', 'x', 'closed', 'y')], undoneAt: null })).items.map(item => item.was).join(','), 'came back,')
  assert.equal(openItemsOf(new Map()).length, 0)
})

test('the switch-on\'s check never replaces one the person started: still checking (late or not), or answered with items left, stays theirs', async t => {
  const files = () => ({
    Q20: ask('Q20', { Title: 'Which spade for the hedge?', Owner: 'Painter', Asks: 'provide', Via: 'chat' }),
    Q21: ask('Q21', { Title: 'Which rake for the hedge?', Owner: 'Painter', Asks: 'provide', Via: 'chat' }),
  })
  const dir = await storeWith(files())
  const dir2 = await storeWith(files())
  t.after(() => Promise.all([dir, dir2].map(one => rm(one, { recursive: true, force: true }))))
  const byAutopilot = (where, now) => person(where, { action: 'obsolete-check', by: 'autopilot' }, now)
  // The person's check waits for the Advisor: refused at once, and when it is late too (a late check may be asked again, but not by Autopilot).
  assert.equal((await person(dir, { action: 'obsolete-check' }, NOW)).ok, true)
  const waiting = await byAutopilot(dir, NOW + MIN)
  assert.equal(waiting.ok, false)
  assert.equal(waiting.status, 409)
  const late = await byAutopilot(dir, NOW + 20 * MIN)
  assert.equal(late.ok, false, 'late: the person\'s to ask again')
  assert.equal(late.status, 409)
  assert.match(late.why, /^The person's own check is open/)
  assert.equal((await readObsoleteFile(dir)).record.by, null, 'the person\'s check is as it was')
  // Answered with an item left (Q21 stays open): still theirs.
  const answered = await chat(dir, 'Partner', { action: 'obsolete', points: ['obsolete: Q20 · stale · none', 'unsure: Q21 · cannot tell · none'] }, NOW + 21 * MIN)
  assert.equal(answered.ok, true, answered.why)
  assert.equal((await byAutopilot(dir, NOW + 22 * MIN)).status, 409)
  assert.deepEqual((await readObsoleteFile(dir)).record.items.map(one => one.id), ['Q21'])
  // Answered with nothing left in it: Autopilot may start its own, and its own old answer is replaced.
  assert.equal((await person(dir2, { action: 'obsolete-check' }, NOW)).ok, true)
  assert.equal((await chat(dir2, 'Partner', { action: 'obsolete', points: ['obsolete: Q20 · stale · none', 'obsolete: Q21 · stale · none'] }, NOW + MIN)).ok, true)
  assert.deepEqual((await readObsoleteFile(dir2)).record.items, [])
  assert.equal((await byAutopilot(dir2, NOW + 2 * MIN)).result.none, true, 'nothing is open any more: it says so')
  await writeFile(join(dir2, 'Q22.md'), ask('Q22', { Title: 'Which hoe for the hedge?', Owner: 'Painter', Asks: 'provide', Via: 'chat' }))
  const own = await byAutopilot(dir2, NOW + 3 * MIN)
  assert.equal(own.ok, true, own.why)
  assert.equal((await readObsoleteFile(dir2)).record.by, 'autopilot')
  assert.equal((await chat(dir2, 'Partner', { action: 'obsolete', points: ['unsure: Q22 · cannot tell · none'] }, NOW + 4 * MIN)).ok, true)
  assert.equal((await byAutopilot(dir2, NOW + 5 * MIN)).ok, true, 'its own answered check, with an item left, is replaced')
})

test('Undo is for a day: a record from 24 h ago or more is refused, and the newest clear starts the day anew', async t => {
  const dir = await storeWith({ ...live(), Q20: ask('Q20', { Title: 'Which spade for the hedge?', Owner: 'Painter', Asks: 'provide', Via: 'chat' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir, { sweep: true })
  assert.equal((await cleared(dir)).at, NOW)
  // The Advisor's check closes Q20 22 hours later: the record is from then.
  const later = NOW + 22 * 60 * MIN
  assert.equal((await person(dir, { action: 'obsolete-check', by: 'autopilot' }, later)).ok, true)
  const closed = await chat(dir, 'Partner', { action: 'obsolete', points: ['obsolete: Q20 · stale · none'] }, later + MIN)
  assert.deepEqual(closed.result.closed, ['Q20'])
  assert.equal((await cleared(dir)).at, later + MIN)
  // 24 h after the first clear it can still be undone; 24 h after the newest one it cannot.
  const refused = await person(dir, { action: 'autopilot-undo' }, later + MIN + SHOWN_MS)
  assert.equal(refused.ok, false)
  assert.equal(refused.status, 409)
  assert.equal(refused.why, 'Older than 24 h: nothing undone.')
  assert.equal((await cleared(dir)).undoneAt, null, 'nothing is marked undone, nothing is opened')
  assert.equal(field(await read(dir), 'Q20', 'State'), 'withdrawn')
  const done = await person(dir, { action: 'autopilot-undo' }, NOW + SHOWN_MS + 60 * MIN)
  assert.equal(done.ok, true, done.why)
  assert.deepEqual(done.result.undone, ['Q1', 'Q2', 'Q20'])
})

test('Undo leaves a refine question whose step is done, and an incident or ask that is not as it was closed', async t => {
  const dir = await storeWith({
    B62: step('B62', { Title: 'Label the hedge', State: 'done', Goal: 'G30' }),
    Q22: ask('Q22', { Title: 'Shorter names on the hedge labels? A: yes B: no', Owner: 'Partner', Asks: 'decide', Of: 'B62', Via: 'refine', State: 'withdrawn' }),
    Q23: ask('Q23', { Title: 'Which spade?', Owner: 'Painter', Asks: 'provide', State: 'open' }),
    X2: incident('X2', 'A watch rule fired', 'fix'),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const record = { at: NOW, undoneAt: null, items: [clearedItem('Q22', 'Shorter names?', 'closed', 'stale'), clearedItem('Q23', 'Which spade?', 'closed', 'stale'), clearedItem('X2', 'A watch rule fired', 'closed', 'false alarm', 'open'), clearedItem('Q99', 'Gone', 'closed', 'stale')] }
  assert.equal((await writeAutopilotClearedFile(dir, record, undefined, { expected: null })).ok, true)
  const undone = await person(dir, { action: 'autopilot-undo' }, NOW + MIN)
  assert.equal(undone.ok, true, undone.why)
  assert.deepEqual(undone.result.undone, [])
  assert.deepEqual(undone.result.skipped, [{ id: 'Q22', why: 'its step is done' }, { id: 'Q23', why: 'it is open now' }, { id: 'X2', why: 'it is fix now' }, { id: 'Q99', why: 'it is not in the store any more' }])
})
