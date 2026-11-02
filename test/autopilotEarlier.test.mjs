// The person, 2026-11-02, on the board's card "Accept B91, or send it back?" (Via accept), filed 28 minutes after they had answered
// an ask for B90 and B91 by name, "C Stop here and hand it over (no build)": "autopilot is on, so isn't this supposed to
// auto-accept?"; their choice of three ways, "B: partner judges": the partner reads their earlier answer and answers the card only
// when it clearly covers it, with an Undo. Pure (src/work/autopilot.mjs `earlierAnswerOf`, `autopilotRoute`) and on the board (the
// pass, the partner's answer and hand-over, the partner's word). Made-up names only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { messageText } from '../src/bridge.mjs'
import { memoryStore } from '../src/store.mjs'
import { findStuck } from '../src/supervisor/rules/repair.mjs'
import { EARLIER_MS, autopilotRoute, earlierAnswerOf, earlierCardWords, earlierOfCard, shortAnswer } from '../src/work/autopilot.mjs'
import { workApi } from '../src/work/api.mjs'
import { deliverWork, partnerAskWords } from '../src/work/deliver.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeNeeds } from '../src/work/lists.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { reconcile } from '../src/work/reconcile.mjs'
import { readStore, share } from '../src/work/store.mjs'

// B917: these tests edit store files by hand and read at once; on the board a hand edit shows within share.ms.
share.ms = 0

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 10, 2, 22, 0).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** An item file's text from its head fields and its sections. */
function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const item = (head, sections = {}) => parseItem(text(head, sections))

const ANSWER = 'C Stop here and hand it over (no build): keep what is built, close the alarm, and the rest goes on the board chat\'s list'
/** The person's earlier answer: an ask of goal G15 whose words name B90 and B91, answered 28 minutes ago. */
const earlierFields = (more = {}) => ({ Id: 'Q50', Kind: 'ask', Title: 'Rebuild G15: leave the stuck-message fix to the waking change?', State: 'answered', Since: at(28), Filed: String(NOW - 90 * MIN), Asks: 'decide', Blocking: 'no', Of: 'G15', Route: 'person', ...more })
const earlierSections = (answer = ANSWER, words = 'Two tries (B90, B91) failed their checks, and the third waits for your choice.') => ({ Text: ['Rebuild G15: leave the stuck-message fix to the waking change?', words], Answer: [answer], History: [`- ${at(90)} Partner: asked (decide)`, `- ${at(28)} person: answered: ${answer}`] })
const EARLIER = item(earlierFields(), earlierSections())
/** The board's card for B91, as the live one was: filed by no chat, routed to the person by the board. */
const cardFields = (more = {}) => ({ Id: 'Q51', Kind: 'ask', Title: 'Accept B91, or send it back?', State: 'open', Since: at(0), Filed: String(NOW), Asks: 'decide', Blocking: 'no', Of: 'B91', Options: 'A Accept: done as it is | B Send back: the partner makes another try from your note', Via: 'accept', Route: 'person', ...more })
const cardSections = (more = {}) => ({ Text: ['B91 stays in review: its fix was dropped by Lead, and only you close a result below its bar.', 'Its check: no score, 2 of 4 points pass.'], History: [`- ${at(0)} server: asked (decide)`, `- ${at(0)} server: autopilot: routed to person`], ...more })
const CARD = item(cardFields(), cardSections())
const STEP91 = item({ Id: 'B91', Kind: 'step', Title: 'Fix: a send that has not answered', State: 'review', Owner: 'Painter', Goal: 'G15' })
const STEP92 = item({ Id: 'B92', Kind: 'step', Title: 'Another step', State: 'review', Owner: 'Painter', Goal: 'G15' })
const of = (...list) => new Map(list.map(one => [one.head.get('Id'), one]))

// ---- earlierAnswerOf (pure) ----

test('earlierAnswerOf: the card of B91 finds the person\'s answer on the ask that names B91', () => {
  assert.deepEqual(earlierAnswerOf(CARD, of(EARLIER, CARD), NOW), { id: 'Q50', answer: ANSWER })
})

test('earlierAnswerOf: only the person\'s own answer counts, never the partner\'s, Autopilot\'s or the main chat\'s', () => {
  for (const by of ['partner', 'autopilot', 'main']) {
    assert.equal(earlierAnswerOf(CARD, of(item(earlierFields({ 'Answered by': by }), earlierSections()), CARD), NOW), null, by)
  }
  assert.deepEqual(earlierAnswerOf(CARD, of(item(earlierFields({ 'Answered by': 'person' }), earlierSections()), CARD), NOW), { id: 'Q50', answer: ANSWER })
})

test('earlierAnswerOf: within the last 24 hours of its answer (its Since)', () => {
  const answeredAgo = minutes => of(item(earlierFields({ Since: at(minutes) }), earlierSections()), CARD)
  assert.notEqual(earlierAnswerOf(CARD, answeredAgo(EARLIER_MS / MIN - 1), NOW), null)
  assert.equal(earlierAnswerOf(CARD, answeredAgo(EARLIER_MS / MIN + 5), NOW), null)
  assert.equal(earlierAnswerOf(CARD, of(item(earlierFields({ Since: '-' }), earlierSections()), CARD), NOW), null, 'no time, no answer')
  assert.equal(earlierAnswerOf(CARD, of(EARLIER, CARD), Number.NaN), null, 'no clock, no answer')
})

test('earlierAnswerOf: it names this step, as its Of, or as a whole word in its title, text or answer; B8910 is no B891', () => {
  const another = words => of(item(earlierFields(), earlierSections(ANSWER, words)), CARD)
  assert.equal(earlierAnswerOf(CARD, another('Two tries (B90, B92) failed.'), NOW), null, 'names other steps')
  assert.equal(earlierAnswerOf(CARD, another('Two tries (B910, B9100) failed.'), NOW), null, 'B91 inside a longer id')
  assert.equal(earlierAnswerOf(CARD, another('Two tries (XB91, B91x) failed.'), NOW), null, 'B91 inside a longer word')
  assert.notEqual(earlierAnswerOf(CARD, another('Two tries (B90,B91) failed.'), NOW), null)
  // The answer or the title can name it too; the ask's own Of does.
  assert.notEqual(earlierAnswerOf(CARD, of(item(earlierFields(), earlierSections('B91: send it back')), CARD), NOW), null, 'its answer')
  assert.notEqual(earlierAnswerOf(CARD, of(item(earlierFields({ Title: 'Is B91 ready?' }), { ...earlierSections(ANSWER, 'Words.'), Text: ['Words.'] }), CARD), NOW), null, 'its title')
  assert.notEqual(earlierAnswerOf(CARD, of(item(earlierFields({ Of: 'B91' }), earlierSections(ANSWER, 'Nothing named.')), CARD), NOW), null, 'its Of')
  assert.equal(earlierAnswerOf(CARD, of(item(earlierFields({ Of: 'B92' }), earlierSections(ANSWER, 'Nothing named.')), CARD), NOW), null, 'its Of is another step')
})

test('earlierAnswerOf: an ask about a step, the newest answered ask other than itself, answered with words', () => {
  // Not about a step: a goal's ask, or none.
  assert.equal(earlierAnswerOf(item(cardFields({ Of: 'G15' }), cardSections()), of(EARLIER), NOW), null)
  assert.equal(earlierAnswerOf(item(cardFields({ Of: '-' }), cardSections()), of(EARLIER), NOW), null)
  // Open, withdrawn and unanswered asks, and steps, are no answers.
  for (const more of [{ State: 'open' }, { State: 'withdrawn' }]) assert.equal(earlierAnswerOf(CARD, of(item(earlierFields(more), earlierSections()), CARD), NOW), null)
  assert.equal(earlierAnswerOf(CARD, of(item(earlierFields(), { ...earlierSections(), Answer: [] }), CARD), NOW), null, 'no words')
  assert.equal(earlierAnswerOf(CARD, of(STEP91, CARD), NOW), null)
  // Never the ask itself, even answered.
  const itself = item(cardFields({ State: 'answered', Since: at(1) }), { ...cardSections(), Answer: ['A Accept: done as it is'] })
  assert.equal(earlierAnswerOf(itself, of(itself), NOW), null)
  // The newest of two.
  const newer = item(earlierFields({ Id: 'Q52', Since: at(10) }), earlierSections('A Build it'))
  const older = item(earlierFields({ Id: 'Q49', Since: at(200) }), earlierSections('B Ask the app'))
  assert.deepEqual(earlierAnswerOf(CARD, of(older, EARLIER, newer), NOW), { id: 'Q52', answer: 'A Build it' })
})

// ---- autopilotRoute ----

const ROLES = { Lead: 'main', Partner: 'advisor', Painter: 'worker' }
const ctxOf = (more = {}) => ({ roleOf: name => ROLES[name] ?? null, items: of(STEP91, EARLIER, CARD), focusGoal: 'G7', prefix: '', now: NOW, ...more })

test('the route: the card of Q608\'s shape, with the earlier answer, goes to the partner, with the why and the earlier ask; without it, to the person as before', () => {
  assert.deepEqual(autopilotRoute(CARD, { ...ctxOf(), again: true }), { to: 'partner', why: 'the person\'s earlier answer on Q50 names B91', earlier: 'Q50' })
  const without = autopilotRoute(CARD, { ...ctxOf({ items: of(STEP91, CARD) }), again: true })
  assert.equal(without.to, 'person')
  assert.match(without.why, /its step is of no focus goal/)
  // Without a clock the earlier answer is not looked for.
  assert.equal(autopilotRoute(CARD, { ...ctxOf({ now: undefined }), again: true }).to, 'person')
  // The board's card the board has not routed yet (no History line) is routed the same, with no `again`.
  const fresh = item(cardFields({ Route: '-' }), cardSections({ History: [`- ${at(0)} server: asked (decide)`] }))
  assert.equal(autopilotRoute(fresh, ctxOf({ items: of(STEP91, EARLIER, fresh) })).earlier, 'Q50')
})

test('the route: a verdict a worker files (a look or decide that accepts, an action that marks done) goes the same way', () => {
  const look = item({ Id: 'Q53', Kind: 'ask', Title: 'Do you accept B91 as it is?', State: 'open', Owner: 'Painter', Asks: 'look', Of: 'B91', Options: 'A yes | B no', Advice: 'A', Via: 'chat', Since: at(0), Filed: String(NOW) }, { Text: ['Do you accept B91 as it is?'], History: [`- ${at(0)} Painter: asked (look)`] })
  assert.deepEqual(autopilotRoute(look, ctxOf()), { to: 'partner', why: 'the person\'s earlier answer on Q50 names B91', earlier: 'Q50' })
  const mark = item({ Id: 'Q54', Kind: 'ask', Title: 'Mark B91 done on the board.', State: 'open', Owner: 'Lead', Asks: 'do', Of: 'B91', Via: 'chat', Since: at(0), Filed: String(NOW) }, { Text: ['Mark B91 done on the board.'], History: [`- ${at(0)} Lead: asked (do)`] })
  assert.equal(autopilotRoute(mark, ctxOf()).earlier, 'Q50')
  // Not a verdict: a detail question keeps going to the partner for its own reason, with no earlier answer named.
  const detail = item({ Id: 'Q55', Kind: 'ask', Title: 'Icons or words on the bar?', State: 'open', Owner: 'Painter', Asks: 'decide', Of: 'B91', Options: 'A icons | B words', Advice: 'A', Via: 'chat', Since: at(0), Filed: String(NOW) }, { Text: ['Icons or words on the bar?'], History: [`- ${at(0)} Painter: asked (decide)`] })
  assert.deepEqual(autopilotRoute(detail, ctxOf()), { to: 'partner', why: 'a detail question' })
})

test('the route: never when the person\'s hands are needed, never goal level, never once the partner handed it on', () => {
  const signIn = item(cardFields(), cardSections({ Text: ['Sign in to the store first; only then can B91 be accepted.'] }))
  const hands = autopilotRoute(signIn, { ...ctxOf({ items: of(STEP91, EARLIER, signIn) }), again: true })
  assert.equal(hands.to, 'person')
  assert.match(hands.why, /only the person's hands: a sign-in/)
  // An action the person's hands do, even when it marks a step done.
  const restart = item({ Id: 'Q58', Kind: 'ask', Title: 'Restart the Claude app, then mark B91 done.', State: 'open', Owner: 'Lead', Asks: 'do', Of: 'B91', Via: 'chat', Since: at(0), Filed: String(NOW) }, { Text: ['Restart the Claude app, then mark B91 done.'], History: [`- ${at(0)} Lead: asked (do)`] })
  assert.deepEqual([autopilotRoute(restart, ctxOf()).to, autopilotRoute(restart, ctxOf()).earlier], ['person', undefined])
  const recap = item(cardFields(), cardSections({ Text: ['B91 in the goal recap: [Open the recap](http://127.0.0.1:4310/#demo=pictures/g15/recap/demo.json).'] }))
  const goal = autopilotRoute(recap, { ...ctxOf({ items: of(STEP91, EARLIER, recap) }), again: true })
  assert.deepEqual([goal.to, goal.earlier], ['person', undefined])
  assert.match(goal.why, /goal level/)
  // The partner's hand-over is its judgement already: not routed back to it.
  const handed = autopilotRoute(CARD, { ...ctxOf(), again: true, handedWhy: 'it is not clear' })
  assert.deepEqual([handed.to, handed.earlier], ['person', undefined])
})

test('the route: a focus goal\'s accept that waits for its recap keeps the recap', () => {
  const inFocus = item({ Id: 'B91', Kind: 'step', Title: 'Fix: a send', State: 'review', Owner: 'Painter', Goal: 'G7' })
  const route = autopilotRoute(CARD, { ...ctxOf({ items: of(inFocus, EARLIER, CARD), focusGoal: 'G7', recapSteps: [{ step: 'B91', goal: 'G7' }], focusHasDemo: true }), again: true })
  assert.deepEqual([route.to, route.earlier], ['recap', undefined])
  // The goal's demo still to come: the recap as well.
  assert.equal(autopilotRoute(CARD, { ...ctxOf({ items: of(inFocus, EARLIER, CARD), focusGoal: 'G7' }), again: true }).to, 'recap')
})

test('the card line: it names the earlier ask, and is read back from a card routed to the partner only', () => {
  assert.equal(earlierCardWords('Q50'), 'Your earlier answer on Q50 may cover this: your partner checks it')
  const routed = item(cardFields({ Route: 'partner' }), cardSections({ Route: [earlierCardWords('Q50')] }))
  assert.deepEqual(earlierOfCard(routed, of(EARLIER, routed)), { id: 'Q50', answer: ANSWER })
  assert.deepEqual(earlierOfCard(routed, [EARLIER, routed]), { id: 'Q50', answer: ANSWER }, 'a list too')
  assert.equal(earlierOfCard(routed, of(routed)), null, 'the earlier ask is gone')
  assert.equal(earlierOfCard(item(cardFields({ Route: 'person' }), cardSections({ Route: [earlierCardWords('Q50')] })), of(EARLIER)), null, 'handed to the person')
  assert.equal(earlierOfCard(item(cardFields({ Route: 'partner' }), cardSections()), of(EARLIER)), null, 'a partner ask with no such card')
  assert.equal(shortAnswer(`  ${'word '.repeat(60)} `, 40).length, 40)
  assert.equal(shortAnswer(' A  yes '), 'A yes')
})

// ---- on the board ----

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'autopilot-earlier-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}
const step = (id, fields = {}) => text({ Id: id, Kind: 'step', Title: 'Fix: a send that has not answered', State: 'review', Owner: 'Painter', Activity: 'Garden', Goal: 'G15', Since: at(300), ...fields }, { History: [`- ${at(300)} Lead: made`, `- ${at(200)} Painter: in progress → review`] })
const earlierText = (more = {}, answer = ANSWER) => text(earlierFields(more), earlierSections(answer))
const cardText = (fields = {}, sections = {}) => text(cardFields(fields), cardSections(sections))
const ctx = (dir, now, as, more = {}) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G7', pictureProblem: async () => null, ...(as === undefined ? {} : { as }), ...more })
const pass = (dir, now = NOW, more = {}) => workApi({ action: 'autopilot', on: true }, ctx(dir, now, 'server', more))
const person = (dir, body, now = NOW + MIN) => workApi(body, ctx(dir, now, 'person'))
const chat = (dir, who, body, now = NOW + MIN, more = {}) => workApi({ ...body, chat: who }, ctx(dir, now, undefined, more))
const read = async dir => (await readStore(dir)).items
const field = (items, id, key) => items.get(id).head.get(key)
const history = (items, id) => items.get(id).sections.get('History') ?? []
const needsIds = (items, now = NOW + 2 * MIN) => storeNeeds({ ok: true, items }, { now, autopilot: true, roleOf: name => ROLES[name] ?? null, focusGoal: 'G7' }).filter(one => one.answer === null).map(one => one.workId)

test('the pass: the card the board routed to the person goes to the partner when the person\'s earlier answer exists now; one a chat handed on, or with no such answer, stays', async t => {
  const dir = await storeWith({ B91: step('B91'), B92: step('B92'), Q51: cardText() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // No earlier answer yet: the card stays the person's, and the next pass does not touch it.
  const none = await pass(dir)
  assert.deepEqual(none.result.routed, [])
  assert.deepEqual(needsIds(await read(dir)), ['Q51'])
  // The person's answer, then the next pass: routed to the partner, once, with the card line and the partner's 30 minutes from now.
  await writeFile(join(dir, 'Q50.md'), earlierText())
  const moved = await pass(dir, NOW + 5 * MIN)
  assert.equal(moved.ok, true, moved.why)
  assert.deepEqual(moved.result.routed, [{ id: 'Q51', to: 'partner' }])
  let items = await read(dir)
  assert.equal(field(items, 'Q51', 'Route'), 'partner')
  assert.equal(field(items, 'Q51', 'Filed'), String(NOW + 5 * MIN))
  assert.deepEqual(items.get('Q51').sections.get('Route'), ['Your earlier answer on Q50 may cover this: your partner checks it'])
  assert.deepEqual(history(items, 'Q51').filter(line => line.includes('autopilot: routed to')).map(line => line.replace(/^- [\d: -]+ /, '')), ['server: autopilot: routed to person', 'server: autopilot: routed to partner'])
  // It stands for the partner now, not the person; a pass again changes nothing.
  assert.deepEqual(needsIds(items, NOW + 6 * MIN), [])
  assert.deepEqual((await pass(dir, NOW + 6 * MIN)).result.routed, [])
  // A card the partner handed on, whose step has an earlier answer too, is the person's: never routed back.
  await writeFile(join(dir, 'Q57.md'), earlierText({ Id: 'Q57' }, 'A Accept').replace('(B90, B91)', '(B90, B92)'))
  await writeFile(join(dir, 'Q56.md'), cardText({ Id: 'Q56', Of: 'B92', Title: 'Accept B92, or send it back?' }, { Route: ['Your partner hands this to you: it is not clear'], History: [`- ${at(0)} server: asked (decide)`, `- ${at(0)} Partner: to the person: it is not clear`] }))
  const last = await pass(dir, NOW + 7 * MIN)
  assert.deepEqual(last.result.routed, [])
  assert.equal(field(await read(dir), 'Q56', 'Route'), 'person')
})

test('the pass: a card filed after the earlier answer goes to the partner at once, the first time the board routes it', async t => {
  const dir = await storeWith({ B91: step('B91'), Q50: earlierText(), Q51: cardText({ Route: '-' }, { History: [`- ${at(0)} server: asked (decide)`] }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await pass(dir)
  assert.deepEqual(done.result.routed, [{ id: 'Q51', to: 'partner' }])
  const items = await read(dir)
  assert.deepEqual(items.get('Q51').sections.get('Route'), ['Your earlier answer on Q50 may cover this: your partner checks it'])
  assert.equal(history(items, 'Q51').filter(line => line.includes('autopilot: routed to')).length, 1)
})

test('a chat files its own verdict ask: it goes to the partner at once with its card line; a day later the answer is too old and it is the person\'s', async t => {
  const dir = await storeWith({ B91: step('B91', { State: 'in progress', Branch: 'b91' }), Q50: earlierText() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const asked = { action: 'ask', of: 'B91', kind: 'look', text: 'Do you accept B91 as it is?', options: ['A yes', 'B no'], advice: 'A' }
  const filed = await chat(dir, 'Painter', asked, NOW, { autopilot: true })
  assert.equal(filed.ok, true, filed.why)
  assert.equal(filed.result.route, 'partner')
  const items = await read(dir)
  assert.deepEqual([field(items, filed.result.id, 'Route'), items.get(filed.result.id).sections.get('Route')], ['partner', ['Your earlier answer on Q50 may cover this: your partner checks it']])
  const late = await chat(dir, 'Painter', { ...asked, text: 'Do you accept B91 now, after a day?' }, NOW + 25 * HOUR, { autopilot: true })
  assert.equal(late.ok, true, late.why)
  assert.notEqual(late.result.route, 'partner')
})

test('the partner answers the card on the person\'s earlier answer: Accept closes the step as the partner\'s, with the why in the daily note and the Undo', async t => {
  const dir = await storeWith({ B91: step('B91'), Q50: earlierText(), Q51: cardText() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir, NOW + MIN)
  assert.equal(field(await read(dir), 'Q51', 'Route'), 'partner')
  // A Send back without its note is refused before anything is written.
  const bare = await chat(dir, 'Partner', { action: 'partner-answer', id: 'Q51', text: 'B Send back', why: 'x' })
  assert.equal(bare.ok, false)
  assert.equal(field(await read(dir), 'Q51', 'State'), 'open')
  const why = 'your earlier choice on Q50: C Stop here and hand it over (no build)'
  const done = await chat(dir, 'Partner', { action: 'partner-answer', id: 'Q51', text: 'A Accept: done as it is', why }, NOW + 2 * MIN)
  assert.equal(done.ok, true, done.why)
  assert.equal(done.result.accepted, 'B91')
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q51', 'State'), field(items, 'Q51', 'Answered by')], ['answered', 'partner'])
  assert.deepEqual(items.get('Q51').sections.get('Answer'), ['A Accept: done as it is'])
  assert.deepEqual(items.get('Q51').sections.get('Why'), [why])
  assert.equal(field(items, 'B91', 'State'), 'done')
  assert.match(history(items, 'B91').join('\n'), /person: accepted for you by your partner in Q51: A Accept: done as it is/)
  // The daily note lists it with the why, and the person's Undo gives the ask back (the step stays as it is).
  const noteId = field(items, 'Q51', 'Daily note')
  assert.match(items.get(noteId).sections.get('Decided for you').join('\n'), /Q51 .*→ A Accept: done as it is \(your earlier choice on Q50/)
  const [card] = storeNeeds({ ok: true, items }, { now: NOW + 3 * MIN, autopilot: true }).filter(one => one.workId === 'Q51')
  assert.deepEqual([card.answer.by, card.canTakeBack], ['partner', true])
  const undo = await person(dir, { action: 'undo', id: 'Q51' })
  assert.equal(undo.ok, true, undo.why)
  assert.deepEqual([field(await read(dir), 'Q51', 'State'), field(await read(dir), 'Q51', 'Route')], ['open', 'person'])
})

test('the partner hands the card to the person when the earlier answer does not clearly cover it: Route person with its why, and the pass does not route it back', async t => {
  const dir = await storeWith({ B91: step('B91'), Q50: earlierText(), Q51: cardText() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir, NOW + MIN)
  const handed = await chat(dir, 'Partner', { action: 'escalate', id: 'Q51', why: 'Q50 was about the build, not about closing B91' })
  assert.equal(handed.ok, true, handed.why)
  let items = await read(dir)
  assert.deepEqual([field(items, 'Q51', 'Route'), field(items, 'Q51', 'State')], ['person', 'open'])
  assert.deepEqual(items.get('Q51').sections.get('Route'), ['Your partner hands this to you: Q50 was about the build, not about closing B91'])
  assert.deepEqual(needsIds(items, NOW + 3 * MIN), ['Q51'])
  assert.deepEqual((await pass(dir, NOW + 4 * MIN)).result.routed, [])
  items = await read(dir)
  assert.equal(field(items, 'Q51', 'Route'), 'person')
  // The person answers it as ever: Accept closes the step.
  const accepted = await person(dir, { action: 'answer', id: 'Q51', text: 'A Accept: done as it is' })
  assert.equal(accepted.ok, true, accepted.why)
  assert.equal(field(await read(dir), 'B91', 'State'), 'done')
})

test('the partner\'s word names the earlier answer: the reconciler, the supervisor\'s repeat and `work next`', async t => {
  const dir = await storeWith({ B91: step('B91'), Q50: earlierText(), Q51: cardText() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir, NOW + MIN)
  const store = await readStore(dir)
  const partner = { name: 'Partner', state: 'free', isRunning: true, idle: { since: NOW - 20 * MIN } }
  const times = { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN, partnerMs: 30 * MIN }
  const plan = (now = NOW + MIN) => reconcile({ store, lanes: [{ name: 'Lead', isMain: true, state: 'free', isRunning: true }], partner, now, times, prefix: '' })
  const [first] = (await plan()).partnerAsks
  assert.deepEqual(first, { id: 'Q51', chat: 'Partner', since: field(store.items, 'Q51', 'Since'), earlier: { id: 'Q50', answer: shortAnswer(ANSWER) } })
  assert.equal(partnerAskWords('Q51', first.earlier), `work: Q51 is yours to answer for the person; run work next (the person's earlier answer on Q50: "${shortAnswer(ANSWER)}")`)
  assert.equal(partnerAskWords('Q51'), 'work: Q51 is yours to answer for the person; run work next')
  // Its 30 minutes count from the route, as for any ask routed to the partner.
  assert.deepEqual((await plan(NOW + 29 * MIN)).escalations, [])
  assert.deepEqual((await plan(NOW + 32 * MIN)).escalations, [{ id: 'Q51', why: 'the partner did not answer in 30 min' }])
  // `work next` lists it with the answer and what to do.
  const next = await chat(dir, 'Partner', { action: 'next' })
  assert.equal(next.ok, true, next.why)
  assert.match(next.result.text, /- Q51 decide from nobody on B91: Accept B91, or send it back\? · .* · the person's earlier answer on Q50: "C Stop here and hand it over/)
  assert.match(next.result.text, /answer it only if that clearly covers it, else escalate/)
})

test('the pass judges nothing else anew: a card the recap would take now stays the person\'s until the switch-on\'s sweep, the earlier answer or not', async t => {
  const dir = await storeWith({ B91: step('B91', { Goal: 'G7' }), Q50: earlierText(), Q51: cardText() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const recap = { focusHasDemo: true, recaps: [{ step: 'B91', goal: 'G7', path: 'pictures/g7/recap/demo.json' }] }
  const quiet = await pass(dir, NOW + MIN, recap)
  assert.deepEqual(quiet.result.routed, [])
  assert.equal(field(await read(dir), 'Q51', 'Route'), 'person')
  // The switch-on's sweep does: the step's recap names it, so the card waits there.
  const swept = await workApi({ action: 'autopilot', on: true, sweep: true }, ctx(dir, NOW + 2 * MIN, 'server', recap))
  assert.deepEqual(swept.result.routed, [{ id: 'Q51', to: 'recap' }])
})

test('the board\'s line to the partner names the earlier answer too: the delivery and the supervisor\'s repeat', async t => {
  const dir = await storeWith({ B91: step('B91'), Q50: earlierText(), Q51: cardText() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir, NOW + MIN)
  const earlier = { id: 'Q50', answer: shortAnswer(ANSWER) }
  const outbox = memoryStore()
  let n = 0
  const reconciled = { moves: [], deliveries: [], says: [], notes: [], partnerAsks: [{ id: 'Q51', chat: 'Partner', since: at(0), earlier }], escalations: [] }
  await deliverWork({ state: { reconciled, chats: [], pause: null }, dir, outbox, apply: body => workApi(body, ctx(dir, NOW, 'server')), now: NOW, maxChars: 2000, newId: () => `m${(n += 1)}` })
  assert.deepEqual(outbox.outbox().map(one => [one.to, one.kind, one.about, messageText(one, () => '22:00')]), [['Partner', 'partner-ask', 'Q51', partnerAskWords('Q51', earlier)]])
  assert.match(outbox.outbox()[0].text, /\(the person's earlier answer on Q50: "C Stop here and hand it over/)
  // Ten minutes on, with no line about it lately, the supervisor wakes the partner again with the same words.
  const items = await read(dir)
  const found = findStuck({ items, lanes: [{ name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }], partner: { name: 'Partner', state: 'working', isRunning: true }, now: NOW + 20 * MIN }).filter(one => one.check === 'partner-ask')
  assert.equal(found.length, 1)
  assert.equal(found[0].fix.text, partnerAskWords('Q51', earlier))
})
