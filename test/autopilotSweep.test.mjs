// Autopilot (the person, 2026-10-31: "so it will finish everything untill a goal is ready, the PO bothers me and only then i
// interact"): the board's pass over the store (the work API's `autopilot`, src/work/autopilot.mjs) routes each open ask once,
// with one History line, never one handed on, and nothing while it is off; the advice it takes stands in the partner's daily
// note with an Undo that gives the ask back; an ask that waits for the goal's recap stands in no list and is closed by the
// recap's answer; the main chat does or hands on the asks routed to it; refine questions are answered with their advice or
// sent back to the Advisor once. Made-up items in a temporary folder; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { REFINE_BACK_WORDS, SENT_BACK, recapGoneWords, recapWaitIds } from '../src/work/autopilot.mjs'
import { rebuildsApproved } from '../src/boardSettings.mjs'
import { focusAllDone } from '../src/focus.mjs'
import { evaluateWords } from '../src/goalGuard.mjs'
import { parseGoals } from '../src/goals.mjs'
import { focusWords } from '../src/say.mjs'
import { focusState } from '../src/state.mjs'
import { workApi } from '../src/work/api.mjs'
import { decidedTodayOf, partnerDecidedOf, routedAwayOf, storeNeeds, storeWaits } from '../src/work/lists.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, share } from '../src/work/store.mjs'

// B917: these tests edit store files by hand and read at once; on the board a hand edit shows within share.ms.
share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 9, 31, 16, 0).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** An item file's text from its head fields and its sections. */
function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const ask = (id, fields, words = null, more = {}) => text({ Id: id, Kind: 'ask', Title: fields.Title, State: 'open', Since: at(fields.age ?? 50), Filed: String(NOW - (fields.age ?? 50) * MIN), Blocking: 'no', ...fields, age: undefined },
  { Text: [words ?? fields.Title], ...more, History: [`- ${at(fields.age ?? 50)} ${fields.Owner ?? 'server'}: asked (${fields.Asks ?? 'decide'})`] })
const step = (id, fields, sections = {}) => text({ Id: id, Kind: 'step', Activity: 'Garden', Since: at(90), ...fields }, { ...sections, History: [`- ${at(90)} Lead: made`, ...(sections.History ?? [])] })

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'autopilot-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}

const ROLES = { Lead: 'main', Partner: 'advisor', Keeper: 'owner', Painter: 'worker', Checker: 'worker' }
const ctx = (dir, now, as, more = {}) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G29', pictureProblem: async () => null, ...(as === undefined ? {} : { as }), ...more })
const sweep = (dir, on = true, now = NOW, more = {}) => workApi({ action: 'autopilot', on }, ctx(dir, now, 'server', more))
const person = (dir, body, now = NOW + MIN) => workApi(body, ctx(dir, now, 'person'))
const chat = (dir, who, body, now = NOW + MIN, more = {}) => workApi({ ...body, chat: who }, ctx(dir, now, undefined, more))
const read = async dir => (await readStore(dir)).items
const field = (items, id, key) => items.get(id).head.get(key)
const history = (items, id) => items.get(id).sections.get('History') ?? []
const needsIds = (work, autopilot = true, now = NOW + 2 * MIN) => storeNeeds(work, { now, autopilot, roleOf: chat => ROLES[chat] ?? null, focusGoal: 'G29' }).filter(one => one.answer === null).map(one => one.workId)

const B21 = step('B21', { Title: 'Round the pool', State: 'review', Owner: 'Painter', Goal: 'G29' }, { Standard: ['pool look · pictures/pool.png · target 75'], Checked: ['Score: 64 of 75', '- fail: judged beside the painting'] })
const B22 = step('B22', { Title: 'Quality Assurance: B21 Round the pool', State: 'done', Owner: 'Checker', Goal: 'G29', Checks: 'B21' })

test('the sweep routes each open ask once, with one History line; one handed on stays; while off it routes nothing', async t => {
  const dir = await storeWith({
    B21, B22,
    // Autopilot v2, on purpose: Q1 carries no advice (with it the board takes it), and Q3 rebuilds a goal that is not the focus (a
    // rebuild of the focus goal with advice is taken too).
    Q1: ask('Q1', { Title: 'Icons or words on the bar?', Owner: 'Painter', Asks: 'decide', Options: 'A icons | B words', Via: 'chat' }),
    Q2: ask('Q2', { Title: 'Merge B21 into main', Owner: 'Painter', Asks: 'do', Via: 'chat' }),
    Q3: ask('Q3', { Title: 'Rebuild G7: which way?', Owner: 'Partner', Asks: 'decide', Of: 'G7', Options: 'A walls | B pool', Advice: 'A' }),
    Q4: ask('Q4', { Title: 'Icons or words on the map?', Owner: 'Painter', Asks: 'decide', Options: 'A icons | B words', Advice: 'A', Route: 'person' }, null, { Route: ['Your partner hands this to you: a new look is yours'] }),
    Q5: ask('Q5', { Title: 'Which bar colour?', Owner: 'Painter', Asks: 'decide', Advice: 'blue', Route: 'partner' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const before = await readFile(join(dir, 'Q1.md'), 'utf8')
  const off = await sweep(dir, false)
  assert.equal(off.ok, true, off.why)
  assert.deepEqual(off.result.routed, [])
  assert.equal(off.result.changed, false)
  assert.equal(await readFile(join(dir, 'Q1.md'), 'utf8'), before, 'off: nothing is written')
  // Off, the person sees the asks as before.
  assert.deepEqual(needsIds({ ok: true, items: await read(dir) }, false).sort(), ['Q1', 'Q2', 'Q3', 'Q4'])
  const on = await sweep(dir)
  assert.equal(on.ok, true, on.why)
  assert.deepEqual(on.result.routed, [{ id: 'Q1', to: 'partner' }, { id: 'Q2', to: 'main' }, { id: 'Q3', to: 'person' }])
  assert.deepEqual(on.result.mainAsks, ['Q2'])
  let items = await read(dir)
  assert.deepEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map(id => field(items, id, 'Route')), ['partner', 'main', 'person', 'person', 'partner'])
  for (const id of ['Q1', 'Q2', 'Q3']) assert.equal(history(items, id).filter(line => line.includes('autopilot: routed to')).length, 1, id)
  assert.match(history(items, 'Q1').at(-1), / server: autopilot: routed to partner$/)
  // The partner's 30 minutes start at the route: an older ask is not handed on at once.
  assert.equal(field(items, 'Q1', 'Filed'), String(NOW))
  // Never one handed on, nor one routed already.
  assert.equal(history(items, 'Q4').some(line => line.includes('autopilot')), false)
  assert.equal(history(items, 'Q5').some(line => line.includes('autopilot')), false)
  // Once: the next pass routes nothing again.
  const again = await sweep(dir, true, NOW + 5 * MIN)
  assert.deepEqual(again.result.routed, [])
  items = await read(dir)
  for (const id of ['Q1', 'Q2', 'Q3']) assert.equal(history(items, id).filter(line => line.includes('autopilot: routed to')).length, 1, id)
  // Needs your attention shows only what goes to the person.
  assert.deepEqual(needsIds({ ok: true, items }).sort(), ['Q3', 'Q4'])
})

test('advice: the board answers with the advice as the person\'s pick, lists it in the partner\'s daily note, and Undo gives it back', async t => {
  const dir = await storeWith({
    B33: step('B33', { Title: 'Calm the lava', State: 'in progress', Owner: 'Painter', Goal: 'G29' }),
    // The ruling of 2026-10-31: advice is taken only for an ask under a step.
    Q10: ask('Q10', { Title: 'for B33, which do you want?', Owner: 'Partner', Asks: 'decide', Advice: 'A', Via: 'chat', Of: 'B33' },
      'for B33, which do you want? A: keep the lava as the rules say (about 1 h). B: try a darker lava (about 2 h). I advise A.'),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await sweep(dir)
  assert.equal(done.ok, true, done.why)
  assert.deepEqual(done.result.routed, [{ id: 'Q10', to: 'advice' }])
  assert.deepEqual(done.result.answered, ['Q10'])
  let items = await read(dir)
  assert.equal(field(items, 'Q10', 'State'), 'answered')
  assert.equal(field(items, 'Q10', 'Answered by'), 'autopilot')
  assert.deepEqual(items.get('Q10').sections.get('Answer'), ['A: keep the lava as the rules say (about 1 h).'])
  assert.ok(history(items, 'Q10').some(line => line.includes('autopilot: took the advice')))
  // The partner's daily note of today, written in its name, with the line under "Decided for you".
  const noteId = field(items, 'Q10', 'Daily note')
  const note = items.get(noteId)
  assert.equal(note.head.get('From'), 'Partner')
  assert.equal(note.head.get('Of'), 'G29')
  assert.deepEqual(note.sections.get('Decided for you'), ['- Q10 (Partner, B33): for B33, which do you want? → A: keep the lava as the rules say (about 1 h). (autopilot: took the advice)'])
  assert.equal(decidedTodayOf({ ok: true, items }, NOW + MIN), 1)
  // Its card: decided for the person, with the Undo, for 7 days.
  const [card] = storeNeeds({ ok: true, items }, { now: NOW + MIN, autopilot: true }).filter(one => one.workId === 'Q10')
  assert.deepEqual([card.answer.by, card.canTakeBack], ['autopilot', true])
  assert.deepEqual(partnerDecidedOf({ ok: true, items }, { now: NOW + MIN }).map(one => [one.ask, one.by]), [['Q10', 'autopilot']])
  // The Undo gives it back to the person, and the board never routes it again.
  const undo = await person(dir, { action: 'undo', id: 'Q10' })
  assert.equal(undo.ok, true, undo.why)
  items = await read(dir)
  assert.deepEqual([field(items, 'Q10', 'State'), field(items, 'Q10', 'Route'), field(items, 'Q10', 'Answered by')], ['open', 'person', undefined])
  assert.deepEqual(items.get('Q10').sections.get('Route'), ['Decided for you (Autopilot): A: keep the lava as the rules say (about 1 h).; you took it back'])
  assert.equal(items.get(noteId).sections.get('Undo asked').length, 1)
  assert.equal(decidedTodayOf({ ok: true, items }, NOW + 2 * MIN), 0)
  const after = await sweep(dir, true, NOW + 3 * MIN)
  assert.deepEqual([after.result.routed, after.result.answered], [[], []])
  assert.deepEqual(needsIds({ ok: true, items: await read(dir) }), ['Q10'])
})

test('recap: an ask that waits for the goal\'s recap stands in no list, is listed for the Focus page, and the recap\'s answer closes it', async t => {
  const dir = await storeWith({
    B21, B22,
    Q20: ask('Q20', { Title: 'Approve the pool\'s look at 64 of 75?', Owner: 'Checker', Asks: 'look', Of: 'B21', Options: 'A yes | B no', Advice: 'A', Pictures: 'pictures/B21/check.png' }),
    Q21: ask('Q21', { Title: 'Accept B21 at 64 of 75, or send it back?', Asks: 'decide', Of: 'B21', Options: 'A Accept: done as it is | B Send back: the partner makes another try', Via: 'accept' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await sweep(dir)
  assert.deepEqual(done.result.routed, [{ id: 'Q20', to: 'recap' }, { id: 'Q21', to: 'recap' }])
  let items = await read(dir)
  assert.deepEqual(needsIds({ ok: true, items }), [], 'in no list of Needs your attention')
  // The coordinator's ruling (2026-10-31): with Autopilot off they stand for the person again.
  assert.deepEqual(needsIds({ ok: true, items }, false), ['Q20', 'Q21'])
  // Its step reads that it waits for the goal's recap, once per ask.
  assert.deepEqual(items.get('B21').sections.get('Context').filter(one => /Recap verdict/.test(one)).map(one => one.trim()), ['Recap verdict: waits (Q20)', 'Recap verdict: waits (Q21)'])
  const listed = routedAwayOf({ ok: true, items })
  assert.deepEqual(listed.map(one => [one.id, one.route, one.goal, one.of]), [['Q20', 'recap', 'G29', 'B21'], ['Q21', 'recap', 'G29', 'B21']])
  assert.deepEqual(listed[0].pictures, ['pictures/B21/check.png'])
  // The step stays as it is.
  assert.equal(field(items, 'B21', 'State'), 'review')
  // The recap's answer: the part that shows B21 sent back with the person's words.
  const answered = await workApi({ action: 'recap-answered', goal: 'G29', round: 1, parts: [{ verdict: 'sent-back', steps: ['B21'], comment: 'rounder at the top', title: 'The pool' }] }, ctx(dir, NOW + 10 * MIN, 'server'))
  assert.equal(answered.ok, true, answered.why)
  assert.deepEqual(answered.result.closed, ['Q20', 'Q21'])
  assert.deepEqual(answered.result.wakes.map(one => one.to), ['Checker'], 'the board\'s own card has no chat to tell')
  items = await read(dir)
  assert.deepEqual(items.get('Q20').sections.get('Answer'), ['Sent back in the recap of G29, round 1: The pool: "rounder at the top"'])
  assert.equal(field(items, 'Q21', 'State'), 'answered')
  assert.ok(history(items, 'Q20').some(line => line.includes('closed by the goal\'s recap')))
  assert.deepEqual(routedAwayOf({ ok: true, items }), [])
  assert.ok(items.get('B21').sections.get('Context').some(one => one.trim() === 'Recap verdict: sent back (Q20)'))
})

test('recap: without a focus goal for its step, a waiting ask goes to the person', async t => {
  const dir = await storeWith({
    B21, B22,
    Q22: ask('Q22', { Title: 'Approve the pool\'s look at 64 of 75?', Owner: 'Checker', Asks: 'look', Of: 'B21', Advice: 'yes' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual((await sweep(dir)).result.routed, [{ id: 'Q22', to: 'recap' }])
  // The focus moved on: the recap of G29 will not come.
  const moved = await sweep(dir, false, NOW + 5 * MIN, { focusGoal: 'G30' })
  assert.deepEqual(moved.result.escalated, ['Q22'])
  const items = await read(dir)
  assert.equal(field(items, 'Q22', 'Route'), 'person')
  assert.deepEqual(items.get('Q22').sections.get('Route'), [recapGoneWords])
  assert.deepEqual(needsIds({ ok: true, items }, false), ['Q22'])
})

test('main: the main chat\'s work next lists its asks; it answers one or hands it on; after 30 minutes the board hands it to the person', async t => {
  const dir = await storeWith({
    Q30: ask('Q30', { Title: 'Merge B21 into main', Owner: 'Painter', Asks: 'do', Via: 'chat' }),
    Q31: ask('Q31', { Title: 'Restart the main board so it shows the popup?', Owner: 'Painter', Asks: 'decide', Advice: 'yes', Via: 'chat' }),
    Q32: ask('Q32', { Title: 'Reset the test map', Owner: 'Partner', Asks: 'do' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await sweep(dir)
  assert.deepEqual(done.result.routed.map(one => one.to), ['main', 'main', 'main'])
  assert.deepEqual(done.result.mainAsks, ['Q30', 'Q31', 'Q32'])
  const next = await chat(dir, 'Lead', { action: 'next' })
  assert.equal(next.ok, true, next.why)
  assert.match(next.result.text, /^Asks you do for the person \(Autopilot; roles\/main\.md, "Autopilot"\):\n- Q30 do from Painter: Merge B21 into main\n- Q31 decide from Painter: Restart the main board so it shows the popup\? · advised: yes\n- Q32 do from Partner: Reset the test map/)
  // Only the main chat answers an ask routed to it; the partner answers only its own.
  assert.equal((await chat(dir, 'Partner', { action: 'partner-answer', id: 'Q30', text: 'done', why: 'merged' })).status, 409)
  const did = await chat(dir, 'Lead', { action: 'partner-answer', id: 'Q30', text: 'Merged B21 into main.', why: 'a chat can merge' })
  assert.equal(did.ok, true, did.why)
  assert.equal(did.result.wake.to, 'Painter')
  const handed = await chat(dir, 'Lead', { action: 'escalate', id: 'Q31', why: 'the board on that port is the person\'s own to restart' })
  assert.equal(handed.ok, true, handed.why)
  let items = await read(dir)
  assert.deepEqual([field(items, 'Q30', 'State'), field(items, 'Q30', 'Answered by')], ['answered', 'main'])
  assert.deepEqual([field(items, 'Q31', 'Route'), items.get('Q31').sections.get('Route')], ['person', ['The main chat hands this to you: the board on that port is the person\'s own to restart']])
  // Q32: the board hands it on after the partner's 30 minutes from its route.
  assert.deepEqual((await sweep(dir, true, NOW + 20 * MIN)).result.mainAsks, ['Q32'])
  const late = await sweep(dir, true, NOW + 31 * MIN)
  assert.deepEqual([late.result.escalated, late.result.mainAsks], [['Q32'], []])
  items = await read(dir)
  assert.deepEqual(items.get('Q32').sections.get('Route'), ['The main chat did not do it in 30 min: it is yours'])
  assert.deepEqual(needsIds({ ok: true, items }, true, NOW + 32 * MIN).sort(), ['Q31', 'Q32'])
})

/** A step whose refine block holds `questions`, one line each. */
const refining = (id, questions, history = []) => step(id, { Title: 'Raised maps', State: 'new', Refined: 'open' }, {
  Refined: ['  Refined (round 1, by Partner, 2026-10-31 10:00):', '  Summary: The raised maps are painted.', '  Size: about 2 hours', '  Questions:', ...questions.map(one => `  - ${one}`)],
  History: ['- 2026-10-31 10:00 Partner: refined, round 1', ...history],
})
const refineAsk = (id, of, words) => ask(id, { Title: words.split('?')[0], Owner: 'Partner', Asks: 'decide', Of: of, Via: 'refine', age: 3 }, words)

test('refine questions under Autopilot: with advice answered as "Take the advice" does; without advice back to the Advisor once', async t => {
  const Q1 = 'Two rows or three? A: two rows B: three rows. Advised: A — fits the screen'
  const Q2 = 'Keep the old bar? Advised: no, nobody reads it'
  const Q3 = 'Which edge first?'
  const dir = await storeWith({
    B30: refining('B30', [Q1, Q2]), Q40: refineAsk('Q40', 'B30', Q1), Q41: refineAsk('Q41', 'B30', Q2),
    B31: refining('B31', [Q3]), Q42: refineAsk('Q42', 'B31', Q3),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // While they wait for the board's pass, the Refine questions part shows none of them.
  assert.deepEqual(needsIds({ ok: true, items: await read(dir) }), [])
  const done = await sweep(dir)
  assert.equal(done.ok, true, done.why)
  assert.deepEqual(done.result.refines, [{ step: 'B30', took: ['Q40', 'Q41'], back: false }, { step: 'B31', took: [], back: true }])
  assert.deepEqual(done.result.routed, [], 'a refine question gets no route: its step\'s refine goes on')
  let items = await read(dir)
  assert.deepEqual(['Q40', 'Q41'].map(id => [field(items, id, 'State'), items.get(id).sections.get('Answer')[0]]), [['answered', 'A: two rows'], ['answered', 'no']])
  assert.ok(history(items, 'Q40').at(-1).includes('autopilot: took the advice'))
  // The answers stand with their questions in the step's block, as the person's answers would.
  const block = items.get('B30').sections.get('Refined').join('\n')
  assert.match(block, /- Two rows or three\? A: two rows B: three rows\. Advised: A — fits the screen Answer: A: two rows/)
  assert.match(block, /- Keep the old bar\? Advised: no, nobody reads it Answer: no/)
  assert.ok(history(items, 'B30').some(line => line.includes('autopilot: took the advice: Q40, Q41')))
  // B31: back to the Advisor with the words, once; its question waits for the next round, in no list.
  assert.ok(history(items, 'B31').some(line => line.includes(`${SENT_BACK}: ${REFINE_BACK_WORDS}`)))
  assert.match(items.get('B31').sections.get('Refined').join('\n'), new RegExp(REFINE_BACK_WORDS))
  assert.equal(field(items, 'Q42', 'State'), 'open')
  assert.deepEqual(needsIds({ ok: true, items }), [])
  assert.equal(decidedTodayOf({ ok: true, items }, NOW + MIN), 2)
  const again = await sweep(dir, true, NOW + 2 * MIN)
  assert.deepEqual(again.result.refines, [], 'sent back once only')
  items = await read(dir)
  assert.equal(history(items, 'B31').filter(line => line.includes(SENT_BACK)).length, 1)
  // Off: refine questions are the person's, as before.
  const off = await storeWith({ B30: refining('B30', [Q1]), Q40: refineAsk('Q40', 'B30', Q1) })
  t.after(() => rm(off, { recursive: true, force: true }))
  assert.deepEqual((await sweep(off, false)).result.refines, [])
  assert.deepEqual(needsIds({ ok: true, items: await read(off) }, false), ['Q40'])
})

test('the re-review of v2 (2026-11-04): a refine question whose advice names the person\'s hands, a focus switch or what they meant stays with them; the board takes the rest', async t => {
  const Q1 = 'Two rows or three? A: two rows B: three rows. Advised: A — fits the screen'
  const Q2 = 'Buy the sound pack for $12? A: yes B: no. Advised: A — the map needs it'
  const Q3 = 'Switch the focus to G7 once this lands? Advised: yes'
  const Q4 = 'Did you want the bar thinner? Advised: yes'
  const dir = await storeWith({ B32: refining('B32', [Q1, Q2, Q3, Q4]), Q50: refineAsk('Q50', 'B32', Q1), Q51: refineAsk('Q51', 'B32', Q2), Q52: refineAsk('Q52', 'B32', Q3), Q53: refineAsk('Q53', 'B32', Q4) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // While young, the three the board leaves stand for the person at once; the one it answers stands nowhere.
  assert.deepEqual(needsIds({ ok: true, items: await read(dir) }).sort(), ['Q51', 'Q52', 'Q53'])
  const done = await sweep(dir)
  assert.deepEqual(done.result.refines, [{ step: 'B32', took: ['Q50'], back: false }])
  const items = await read(dir)
  assert.deepEqual(['Q50', 'Q51', 'Q52', 'Q53'].map(id => field(items, id, 'State')), ['answered', 'open', 'open', 'open'])
  assert.deepEqual(needsIds({ ok: true, items }).sort(), ['Q51', 'Q52', 'Q53'])
})

test('a chat\'s new ask is routed at once while Autopilot is on, and its chat is told where it went', async t => {
  const dir = await storeWith({ B21, B22, B40: step('B40', { Title: 'Plant the hedge', State: 'in progress', Owner: 'Painter', Goal: 'G29' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const on = { autopilot: true }
  const asked = await chat(dir, 'Painter', { action: 'ask', of: 'B40', kind: 'do', title: 'Merge B40 into main', text: 'Merge B40 into main when the check passed.' }, NOW, on)
  assert.equal(asked.ok, true, asked.why)
  assert.match(asked.result.text, /goes to the main chat \(Autopilot\)/)
  const partner = await chat(dir, 'Partner', { action: 'ask', of: 'B40', kind: 'decide', title: 'Shorter names in the shop?', text: 'Shorter names fit the cards.', advice: 'yes' }, NOW, on)
  assert.equal(partner.ok, true, partner.why)
  assert.match(partner.result.text, /Autopilot is on, so the board takes your advice/)
  const checker = await chat(dir, 'Checker', { action: 'ask', of: 'B21', kind: 'look', title: 'Approve the pool at 64 of 75?', text: 'The outline stays boxy.', advice: 'yes' }, NOW, on)
  assert.equal(checker.ok, true, checker.why)
  assert.match(checker.result.text, /waits for the goal's recap/)
  const items = await read(dir)
  const routes = [...items.values()].filter(one => one.head.get('Kind') === 'ask').map(one => [one.head.get('Owner'), one.head.get('Route'), (one.sections.get('History') ?? []).filter(line => line.includes('autopilot: routed to')).length])
  assert.deepEqual(routes.sort(), [['Checker', 'recap', 1], ['Painter', 'main', 1], ['Partner', 'advice', 1]])
  // Off, a new ask is filed as before (no route of Autopilot's).
  const before = await chat(dir, 'Painter', { action: 'ask', of: 'B40', kind: 'do', title: 'Water the hedge', text: 'Water the hedge once planted.' }, NOW)
  assert.equal(before.ok, true, before.why)
  assert.equal((await read(dir)).get(before.result.id).head.get('Route'), undefined)
})

test('the review\'s deadlock (2026-10-31): a card routed to the recap makes its step count as done for the goal demo, the demo asks its own row, and that row\'s verdict closes it', async t => {
  const goals = ['Last id: G29', 'Focus: G29', '', '- [~] G29 Pools', '    Done when: the pool reads round', '    Goal definition: round pools', '    Goal definition agreed: 2026-10-30 10:00',
    '    Part: The pool · about 1 h · steps B21', '    Part: The ring · about 1 h · steps B25', '    How agreed: 2026-10-30 11:00', ''].join('\n')
  // B21 as the live B821 was: its result check failed below its bar and its fix was dropped, so the board filed the person's card.
  const reviewed = step('B21', { Title: 'Round the pool', State: 'review', Owner: 'Painter', Goal: 'G29' }, {
    Context: ['  The pool reads as a stepped stadium.'], Standard: ['pool look · pictures/pool.png · target 75'], Checked: ['Score: 64 of 75', '- pass: the pool is an oval', '- fail: judged beside the painting'],
    History: [`- ${at(49)} Painter: in progress → review`, `- ${at(49)} server: check passed: work in garden; result named`, `- ${at(44)} Checker: result check failed: 1 of 2 points pass, score 64 of 75; fix B75 for Painter`],
  })
  const dropped = step('B75', { Title: 'Fix: judged beside the painting', State: 'dropped', Owner: 'Painter', Goal: 'G29', 'Fix of': 'B21' }, { Context: ['  Fix of B21: the result check by Checker failed on one point.', '  Dropped by Lead on 2026-10-31 at 12:48: the partner accepts B21 at 64'] })
  const dir = await storeWith({
    B21: reviewed, B22, B75: dropped, B25: step('B25', { Title: 'Round the ring', State: 'done', Owner: 'Painter', Goal: 'G29' }),
    Q1: ask('Q1', { Title: 'Accept B21 at 64 of 75, or send it back?', Asks: 'decide', Of: 'B21', Options: 'A Accept: done as it is | B Send back: the partner makes another try from your note', Via: 'accept' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual((await sweep(dir)).result.routed, [{ id: 'Q1', to: 'recap' }])
  let items = await read(dir)
  assert.deepEqual(recapWaitIds(items.get('B21'), items), ['Q1'])
  // The focus: B21 stays in review, yet its part counts as done for asking the goal demo, and the demo's words ask its own row.
  const focus = focusState(parseGoals(goals), [...items.values()], [], '', 'Partner', NOW)
  assert.deepEqual([focus.progress.done, focus.progress.forDemo, focus.progress.total], [1, 2, 2])
  assert.deepEqual(focus.recapRows, [{ step: 'B21', asks: ['Q1'] }])
  assert.equal(focusAllDone(focus, 'G29'), false, '"Did we reach the goal?" still waits for the verdict')
  assert.equal(focusAllDone(focus, 'G29', { forDemo: true }), true)
  const words = focusWords('goal-demo', { to: 'Partner', goal: { id: 'G29', title: 'Pools', doneWhen: 'the pool reads round' }, job: 'roles/partner.md', rows: focus.recapRows })
  assert.match(words.text, /\nOwn rows: give each of these steps a row of its own, its id in "steps", so the person's verdict on it closes what waits for the recap: B21 \(Q1\)\n/)
  // The demo names B21 now: the board's accept pass keeps the card open for it (it withdrew it before).
  const named = await workApi({ action: 'accept-cards' }, ctx(dir, NOW + 5 * MIN, 'server', { recaps: [{ step: 'B21', goal: 'G29', path: 'pictures/g29/demo.json', key: '1. The pool', title: '1. The pool', verdict: null, at: null }] }))
  assert.equal(named.ok, true, named.why)
  assert.equal(field(await read(dir), 'Q1', 'State'), 'open')
  // The person approves that row: the card closes with their verdict (the Send then closes B21 as approved, as before).
  const answered = await workApi({ action: 'recap-answered', goal: 'G29', round: 1, parts: [{ verdict: 'approved', steps: ['B21'], title: '1. The pool' }] }, ctx(dir, NOW + 10 * MIN, 'server'))
  assert.deepEqual(answered.result.closed, ['Q1'])
  items = await read(dir)
  assert.deepEqual(items.get('Q1').sections.get('Answer'), ['Approved in the recap of G29, round 1: 1. The pool.'])
  assert.deepEqual(recapWaitIds(items.get('B21'), items), [])
})

test('the recap\'s net: a goal demo made without the step\'s row hands the waiting ask to the person; Autopilot off shows it again', async t => {
  const dir = await storeWith({ B21, B22, Q2: ask('Q2', { Title: 'Approve the pool at 64 of 75?', Owner: 'Checker', Asks: 'look', Of: 'B21', Advice: 'yes' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual((await sweep(dir)).result.routed, [{ id: 'Q2', to: 'recap' }])
  // The demo came (its Demo line), and no recap row names B21.
  const net = await sweep(dir, false, NOW + 5 * MIN, { focusHasDemo: true, recaps: [{ step: 'B99', goal: 'G29' }] })
  assert.deepEqual(net.result.escalated, ['Q2'])
  const items = await read(dir)
  assert.deepEqual(items.get('Q2').sections.get('Route'), ['The goal demo came without its step, so the recap will not answer it: it is yours'])
  assert.deepEqual(needsIds({ ok: true, items }), ['Q2'])
})

test('a blocking ask routed to the recap is blocking no more: its worker goes on (as filed, and as the sweep routes it)', async t => {
  const dir = await storeWith({ B21, B22, Q3: ask('Q3', { Title: 'Does the pool read round at 64?', Owner: 'Painter', Asks: 'look', Of: 'B21', Advice: 'yes', Blocking: 'yes' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual((await sweep(dir)).result.routed, [{ id: 'Q3', to: 'recap' }])
  let items = await read(dir)
  assert.equal(field(items, 'Q3', 'Blocking'), 'no')
  assert.ok(history(items, 'Q3').some(line => line.endsWith("server: autopilot: the step goes on; judged at the goal's recap")))
  assert.equal(storeWaits({ ok: true, items }).blocking.has('painter'), false)
  // As filed: the holder's blocking look of its step below target.
  const filed = await chat(dir, 'Painter', { action: 'ask', of: 'B21', kind: 'look', blocking: true, title: 'Does the ring read round at 64?', text: 'The ring stays boxy.', advice: 'yes' }, NOW + MIN, { autopilot: true })
  assert.equal(filed.ok, true, filed.why)
  items = await read(dir)
  const id = filed.result.id
  assert.deepEqual([field(items, id, 'Route'), field(items, id, 'Blocking')], ['recap', 'no'])
  assert.ok(history(items, id).some(line => line.endsWith("server: autopilot: the step goes on; judged at the goal's recap")))
  assert.ok(items.get('B21').sections.get('Context').some(one => one.trim() === `Recap verdict: waits (${id})`))
  assert.equal(storeWaits({ ok: true, items }).blocking.has('painter'), false)
  assert.equal(field(items, 'B21', 'State'), 'review')
})

test('the advice route\'s net: an answer the board cannot write goes to the person at once', async t => {
  // The partner's ask with advice under a step whose file is gone (the review's probe).
  const dir = await storeWith({ Q5: ask('Q5', { Title: 'Keep the darker lava?', Owner: 'Partner', Asks: 'decide', Of: 'B77', Advice: 'yes' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await sweep(dir)
  assert.equal(done.ok, true, done.why)
  assert.deepEqual([done.result.routed, done.result.answered, done.result.escalated], [[{ id: 'Q5', to: 'advice' }], [], ['Q5']])
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q5', 'State'), field(items, 'Q5', 'Route')], ['open', 'person'])
  assert.match(items.get('Q5').sections.get('Route')[0], /^Autopilot could not write its answer \(.+\): it is yours$/)
  assert.deepEqual(needsIds({ ok: true, items }), ['Q5'])
})

test('a goal stuck after the guard\'s tries is the person\'s: Autopilot approves no rebuild, the partner files "Rebuild G<n>:"', () => {
  assert.equal(rebuildsApproved({ autopilot: true, approveRebuilds: false }), false)
  assert.equal(rebuildsApproved({ autopilot: true, approveRebuilds: true }), false, 'hidden while Autopilot is on, it acts as off')
  assert.equal(rebuildsApproved({ autopilot: false, approveRebuilds: true }), true)
  const words = evaluateWords({ to: 'Partner', goal: { id: 'G29', title: 'Pools', howAgreed: null }, attempts: { count: 3, since: null, failures: [], groups: [], tripped: null }, approveRebuilds: rebuildsApproved({ autopilot: true }), job: 'roles/partner.md' })
  assert.match(words.text, /one work ask of G29 \(decide, its title beginning "Rebuild G29:"/)
  assert.doesNotMatch(words.text, /Approve rebuilds by itself" is on/)
})

test('the re-review\'s B21/B30 case (2026-10-31): the goal demo is not asked while a fix of the step is being built; once it is done, it is', async t => {
  const goals = ['Last id: G29', 'Focus: G29', '', '- [~] G29 Pools', '    Done when: the pool reads round', '    Goal definition: round pools', '    Goal definition agreed: 2026-10-30 10:00',
    '    Part: The pool · about 1 h · steps B21', '    Part: The ring · about 1 h · steps B25', '    How agreed: 2026-10-30 11:00', ''].join('\n')
  const reviewed = step('B21', { Title: 'Round the pool', State: 'review', Owner: 'Painter', Goal: 'G29' }, { Standard: ['pool look · pictures/pool.png · target 75'], Checked: ['Score: 64 of 75', '- fail: judged beside the painting'],
    History: [`- ${at(49)} server: check passed: work in garden; result named`, `- ${at(44)} Checker: result check failed: 1 of 2 points pass, score 64 of 75; fix B30 for Painter`] })
  const fix = state => step('B30', { Title: 'Fix: judged beside the painting', State: state, Owner: 'Painter', Goal: 'G29', 'Fix of': 'B21' }, { Context: ['  Fix of B21: the result check by Checker failed on one point.'] })
  const dir = await storeWith({ B21: reviewed, B30: fix('in progress'), B25: step('B25', { Title: 'Round the ring', State: 'done', Owner: 'Painter', Goal: 'G29' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // The builder's look on B21 below its target goes to the recap (the review's probe3).
  const filed = await chat(dir, 'Painter', { action: 'ask', of: 'B21', kind: 'look', title: 'Does the pool read round enough at 64?', text: 'The rim stays boxy.', advice: 'yes' }, NOW, { autopilot: true })
  assert.equal(filed.ok, true, filed.why)
  assert.equal(filed.result.route, 'recap')
  const focusOf = async () => focusState(parseGoals(goals), [...(await read(dir)).values()], [], '', 'Partner', NOW)
  let focus = await focusOf()
  assert.deepEqual([focus.progress.done, focus.progress.forDemo ?? focus.progress.done, focus.progress.total], [1, 1, 2], 'B30 is still being built')
  assert.equal(focusAllDone(focus, 'G29', { forDemo: true }), false)
  // B30 done: B21 now waits only for the recap, and the goal demo may be asked with its own row.
  await writeFile(join(dir, 'B30.md'), fix('done'))
  focus = await focusOf()
  assert.deepEqual([focus.progress.done, focus.progress.forDemo, focus.progress.total], [1, 2, 2])
  assert.deepEqual(focus.recapRows, [{ step: 'B21', asks: [filed.result.id] }])
  assert.equal(focusAllDone(focus, 'G29', { forDemo: true }), true)
})

test('the re-review\'s live G60, made up (2026-10-31): a part whose step waits for its fix, which waits for the recap, counts for the goal demo', () => {
  const goals = ['Last id: G60', 'Focus: G60', '', '- [~] G60 Good maps', '    Done when: a map reads well', '    Goal definition: good maps', '    Goal definition agreed: 2026-10-30 10:00',
    '    Part: Round shapes · about 1 h · steps B18, B89, B21', '    Part: The test map · about 1 h · steps B71, B88', '    How agreed: 2026-10-30 11:00', ''].join('\n')
  const items = [
    step('B18', { Title: 'Round cells', State: 'dropped', Goal: 'G60' }),
    step('B89', { Title: 'Round the ring', State: 'review', Owner: 'Painter', Goal: 'G60' }),
    step('B21', { Title: 'Fix: the pool reads round', State: 'review', Owner: 'Painter', Goal: 'G60', 'Fix of': 'B89' }, { Context: ['  Recap verdict: waits (Q71)', '  Recap verdict: waits (Q86)'] }),
    step('B71', { Title: 'The guide\'s test map', State: 'review', Owner: 'Pruner', Goal: 'G60' }),
    step('B88', { Title: 'Fix: the moat keep', State: 'review', Owner: 'Pruner', Goal: 'G60', 'Fix of': 'B71' }, { Context: ['  Recap verdict: waits (Q87)'] }),
    ask('Q71', { Title: 'B37 asks for the edge shape said no to', Owner: 'Painter', Asks: 'look', Of: 'B21', Route: 'recap' }),
    ask('Q86', { Title: 'Accept B21 at 64 of 75, or send it back?', Asks: 'decide', Of: 'B21', Via: 'accept', Route: 'recap' }),
    ask('Q87', { Title: 'Approve the moat keep at 68 of 75?', Owner: 'Checker', Asks: 'look', Of: 'B88', Route: 'recap' }),
  ].map(parseItem)
  const focus = focusState(parseGoals(goals), items, [], '', 'Partner', NOW)
  // Before the re-review only B21 and B88 counted: the parts held B89 and B71 back, and the demo never came.
  assert.deepEqual([focus.progress.done, focus.progress.forDemo, focus.progress.total], [0, 2, 2])
  assert.deepEqual(focus.recapRows, [{ step: 'B21', asks: ['Q71', 'Q86'] }, { step: 'B88', asks: ['Q87'] }])
  assert.equal(focusAllDone(focus, 'G60', { forDemo: true }), true)
  assert.equal(focusAllDone(focus, 'G60'), false, '"Did we reach the goal?" Yes still waits for the verdicts')
})
