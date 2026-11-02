// A new look waits for the goal's recap (the person, 2026-11-02, seeing Worker 1's look "Does the wizard's move range on the Terraces look
// right?" under Needs your attention with Autopilot on: "Why is he asking me for it. this is autopilot is turned on correct?"; their
// choice "A": with Autopilot on, a new look on a step of the focus goal waits for that goal's recap instead of reaching them mid-goal).
// The live Q590 was a worker's look under no step, its picture of a done step of the focus goal that no recap row names; the partner
// handed it to the person because its Detail questions always hand over "a new look". The rule (src/work/autopilot.mjs `focusLookOf`),
// the partner's hand-over kept for the recap (work API `escalate`), the pass that moves such a hand-over (`autopilot`), the safety net
// that keeps the look on the recap, and the person's answer in its window. Made-up garden project in a temporary folder.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FOCUS_LOOK_WHY, HANDED_KEPT_WORDS, autopilotRoute, focusLookOf, isExplicitPerson, isKeptLook, partnerHandOverOf, recapGoneWords, standsForPerson } from '../src/work/autopilot.mjs'
import { workApi } from '../src/work/api.mjs'
import { routedAwayOf, storeNeeds } from '../src/work/lists.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readAutopilotClearedFile, readStore, share } from '../src/work/store.mjs'

// B917: these tests edit store files by hand and read at once; on the board a hand edit shows within share.ms.
share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 12, 39).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** An item file's text from its head fields and its sections. */
function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
/** A worker's look of the wizard's move range, Q590's shape: under no step, its picture of the focus goal's done step B55, no advice route yet. */
const look = (id, fields = {}, { words = null, route = [], history = [] } = {}) => text(
  { Id: id, Kind: 'ask', Title: 'Does the wizard\'s move range on the terraces look right?', State: 'open', Owner: 'Painter', Since: at(80), Filed: String(NOW - 80 * MIN), Pictures: 'pictures/B55/after.jpg', Asks: 'look', Blocking: 'no', Advice: 'yes', Via: 'chat', ...fields },
  { Text: [words ?? 'Does the wizard\'s move range on the terraces look right? I advise yes.'], ...(route.length === 0 ? {} : { Route: route }), History: [`- ${at(80)} ${fields.Owner ?? 'Painter'}: asked (look, from its "For you" block)`, ...history] },
)
const step = (id, fields, sections = {}) => text({ Id: id, Kind: 'step', Activity: 'Garden', Since: at(300), ...fields }, { ...sections, History: [`- ${at(300)} Lead: made`] })
/** B55 is done (as the live B855 was), a step of the focus goal G29; B70 a step of another goal. */
const steps = () => ({
  B55: step('B55', { Title: 'Whole move squares', State: 'done', Owner: 'Painter', Goal: 'G29' }),
  B56: step('B56', { Title: 'Round the pond', State: 'in progress', Owner: 'Painter', Goal: 'G29' }),
  B70: step('B70', { Title: 'Trim the hedge', State: 'in progress', Owner: 'Painter', Goal: 'G30' }),
})
const handedHistory = why => [`- ${at(79)} server: autopilot: routed to partner`, `- ${at(75)} Partner: to the person: ${why}`]
const WHY = 'A new look on a map (the move range on the raised terraces) is yours to approve; Painter advises yes.'
/** The partner's hand-over as `escalate` writes it: Route person, the partner's line on the card, "to the person" in History. */
const handed = (id, fields = {}, why = WHY, more = {}) => look(id, { Route: 'person', ...fields }, { route: [`Your partner hands this to you: ${why}`], history: handedHistory(why), ...more })

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'autopilot-looks-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}

const ROLES = { Lead: 'main', Partner: 'advisor', Keeper: 'owner', Painter: 'worker', Checker: 'worker' }
/** No recap row names B55 (the recap names B56 only), and the goal's demo exists already: the live G60's shape. */
const RECAPS = [{ step: 'B56', goal: 'G29', path: 'pictures/g29/recap/demo.json', key: 'Pond', title: 'The pond', verdict: null, at: null }]
const ctx = (dir, now, as, more = {}) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G29', focusHasDemo: true, recaps: RECAPS, pictureProblem: async () => null, ...(as === undefined ? {} : { as }), ...more })
const pass = (dir, body = {}, now = NOW, more = {}) => workApi({ action: 'autopilot', on: true, ...body }, ctx(dir, now, 'server', more))
const person = (dir, body, now = NOW + MIN) => workApi(body, ctx(dir, now, 'person'))
const chat = (dir, who, body, now = NOW, more = {}) => workApi({ ...body, chat: who }, ctx(dir, now, undefined, more))
const read = async dir => (await readStore(dir)).items
const field = (items, id, key) => items.get(id).head.get(key)
const history = (items, id) => (items.get(id).sections.get('History') ?? []).map(line => line.replace(/^- [\d: -]+ /, ''))
const ids = list => list.map(one => one.workId)
const needsOf = (items, now = NOW + 2 * MIN, more = {}) => ids(storeNeeds({ ok: true, items }, { now, autopilot: true, roleOf: name => ROLES[name] ?? null, focusGoal: 'G29', focusHasDemo: true, recapSteps: RECAPS, ...more }).filter(one => one.answer === null))

// ---------------------------------------------------------------------------------------------------------------------
// The rule, pure

const item = (head, sections = {}) => parseItem(text(head, sections))
const ask = (id, fields, words = null, more = {}) => item({ Id: id, Kind: 'ask', Title: fields.Title, State: 'open', Since: at(60), Filed: String(NOW - 60 * MIN), Blocking: 'no', ...fields }, { Text: [words ?? fields.Title], ...more, History: [`- ${at(60)} ${fields.Owner ?? 'server'}: asked`] })
const B24 = item({ Id: 'B24', Kind: 'step', Title: 'Moat walls', State: 'review', Owner: 'Painter', Goal: 'G29' })
const B25 = item({ Id: 'B25', Kind: 'step', Title: 'Hedge trim', State: 'in progress', Owner: 'Painter', Goal: 'G7' })
const pure = { roleOf: name => ROLES[name] ?? null, items: new Map([['B24', B24], ['B25', B25]]), focusGoal: 'G29', prefix: '' }
/** Q590's shape: a worker's look under no step, its picture of a step of the focus goal that no row of any recap names. */
const Q590 = (fields = {}, words = null) => ask('Q590', { Title: 'Does the moat\'s move range look right?', Owner: 'Painter', Asks: 'look', Advice: 'yes', Via: 'chat', Pictures: 'pictures/B24/after.jpg', ...fields }, words ?? 'Does the moat\'s move range look right? I advise yes.')

test('a new look of the focus goal (Q590\'s shape) waits for the recap: no Of, a picture of a focus-goal step no row names, any role but the Product owner\'s', () => {
  assert.deepEqual(autopilotRoute(Q590(), pure), { to: 'recap', why: FOCUS_LOOK_WHY, step: 'B24' }, 'put under the step its picture names')
  assert.equal(FOCUS_LOOK_WHY, 'a new look of the focus goal waits for its recap')
  assert.deepEqual(focusLookOf(Q590(), pure, 'worker'), { step: 'B24', isInferred: true })
  // Under its step already: the step is its own, nothing is inferred.
  assert.deepEqual(autopilotRoute(Q590({ Of: 'B24' }), pure), { to: 'recap', why: FOCUS_LOOK_WHY })
  assert.deepEqual(focusLookOf(Q590({ Of: 'B24' }), pure, 'worker'), { step: 'B24', isInferred: false })
  // The first picture step that is a step of the focus goal; a step of another goal, a longer id and a step the store lacks are none.
  assert.equal(autopilotRoute(Q590({ Pictures: 'pictures/B25/a.png, pictures/B99/b.png, pictures/B24/c.png' }), pure).step, 'B24', 'B25 is G7\'s, B99 is not in the store')
  assert.equal(autopilotRoute(Q590({ Pictures: 'pictures/B25/a.png' }), pure).to, 'partner', 'a look of another goal\'s step keeps its route')
  assert.equal(autopilotRoute(Q590({ Pictures: 'pictures/B240/a.png' }), pure).to, 'partner')
  assert.equal(autopilotRoute(Q590({ Pictures: undefined }), pure).to, 'partner', 'no picture of a step: a detail question for the partner')
  assert.equal(autopilotRoute(Q590({ Of: 'B25' }), pure).to, 'partner', 'under a step of another goal')
  // Its words name the step: not enough (only its Pictures do).
  assert.equal(autopilotRoute(Q590({ Pictures: undefined, Title: 'Does B24 look right?' }, 'Does B24 look right?'), pure).to, 'partner')
  // Any role but the Product owner's: the main chat, the checker, the partner; the board's own card never.
  for (const owner of ['Lead', 'Checker', 'Partner']) assert.equal(autopilotRoute(Q590({ Owner: owner }), pure).to, 'recap', owner)
  assert.equal(autopilotRoute(Q590({ Owner: 'Keeper' }), pure).to, 'person', 'the Product owner answers for the goal')
  assert.equal(autopilotRoute(Q590({ Owner: 'server' }), pure).to, 'person', 'the board\'s own card')
  // Only a look, and only with a focus goal.
  assert.notEqual(autopilotRoute(Q590({ Asks: 'decide' }), pure).why, FOCUS_LOOK_WHY)
  assert.equal(autopilotRoute(Q590(), { ...pure, focusGoal: null }).to, 'partner')
  // The person's hands and goal level come first.
  assert.equal(autopilotRoute(Q590({ Title: 'Click the wizard: does the move range look right?' }), pure).to, 'person', 'a click is the person\'s hands')
  assert.equal(autopilotRoute(Q590({ Title: 'Is the goal\'s recap what you wanted?' }), pure).to, 'person', 'goal level')
  assert.equal(autopilotRoute(Q590({ Of: 'G29' }), pure).to, 'person', 'a look of a goal')
  // A bare default Route: person is the board's to route; it stands for the person only until the pass has moved it.
  assert.equal(autopilotRoute(Q590({ Route: 'person' }), pure).to, 'recap')
  assert.equal(standsForPerson(Q590({ Route: 'recap' }), { ...pure, autopilot: true, now: NOW }), false)
  assert.equal(standsForPerson(Q590({ Filed: String(NOW - MIN) }), { ...pure, autopilot: true, now: NOW }), false, 'not routed yet (young), but the board will route it to the recap')
  assert.equal(standsForPerson(Q590(), { ...pure, autopilot: true, now: NOW }), true, 'older than the grace: nothing is lost if the board could not route it')
})

test('the partner\'s hand-over of a look: found by its History and its Route line, judged as if nobody had handed it on; the person\'s hands and every other hand-over stay', () => {
  const handedBy = (why = WHY, route = null, fields = {}) => item({ Id: 'Q590', Kind: 'ask', Title: 'Does the moat\'s move range look right?', State: 'open', Owner: 'Painter', Asks: 'look', Advice: 'yes', Via: 'chat', Pictures: 'pictures/B24/after.jpg', Route: 'person', Since: at(60), Filed: String(NOW - 60 * MIN), Blocking: 'no', ...fields },
    { Text: ['Does the moat\'s move range look right? I advise yes.'], Route: [route ?? `Your partner hands this to you: ${why}`], History: [`- ${at(60)} Painter: asked`, `- ${at(50)} server: autopilot: routed to partner`, `- ${at(40)} Partner: to the person: ${why}`] })
  const one = handedBy()
  assert.equal(partnerHandOverOf(one), WHY)
  assert.equal(isExplicitPerson(one), true)
  assert.equal(autopilotRoute(one, pure).to, 'person', 'handed on: the person\'s, as before')
  assert.deepEqual(autopilotRoute(one, { ...pure, handedWhy: partnerHandOverOf(one) }), { to: 'recap', why: FOCUS_LOOK_WHY, step: 'B24' })
  assert.equal(HANDED_KEPT_WORDS, 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap')
  // Not the partner's hand-over: the person took it back, the main chat or the board handed it on, Autopilot kept it already.
  assert.equal(partnerHandOverOf(handedBy('x', 'The person took it back from Autopilot (Undo)')), null, 'the person took it back (Undo)')
  assert.equal(partnerHandOverOf(handedBy('x', 'The main chat hands this to you: it needs a sign-in')), null)
  assert.equal(partnerHandOverOf(handedBy('x', 'Your partner did not answer in 30 min: it is yours')), null, 'the board\'s timeout')
  assert.equal(partnerHandOverOf(handedBy('x', recapGoneWords)), null)
  assert.equal(partnerHandOverOf(handedBy('x', HANDED_KEPT_WORDS)), null, 'Autopilot kept it already')
  assert.equal(partnerHandOverOf(Q590({ Route: 'person' })), null, 'a bare default')
  const byBoard = handedBy('the partner did not answer in 30 min')
  byBoard.sections.set('History', [`- ${at(60)} Painter: asked`, `- ${at(5)} server: to the person: the partner did not answer in 30 min`])
  assert.equal(partnerHandOverOf(byBoard), null, 'a History line of the board is no partner\'s')
  // The person's hands: in the partner's why, or in the ask's words; goal level too. All stay the person's.
  const hands = handedBy('Painter wants you to click the wizard and look at the range.')
  assert.equal(autopilotRoute(hands, { ...pure, handedWhy: partnerHandOverOf(hands) }).to, 'person', 'the why names a click')
  const signIn = handedBy()
  signIn.sections.set('Text', ['Sign in to the art shop, then does the range look right?'])
  assert.equal(autopilotRoute(signIn, { ...pure, handedWhy: partnerHandOverOf(signIn) }).to, 'person', 'its words name a sign-in')
  const goalLevel = handedBy(WHY, null, { Title: 'Does the goal\'s recap read right?' })
  assert.equal(autopilotRoute(goalLevel, { ...pure, handedWhy: partnerHandOverOf(goalLevel) }).to, 'person', 'goal level')
  // A look of another goal's step is no focus look: the route asked for is anything but the recap.
  const other = handedBy(WHY, null, { Pictures: 'pictures/B25/after.jpg' })
  assert.notEqual(autopilotRoute(other, { ...pure, handedWhy: partnerHandOverOf(other) }).to, 'recap')
})

test('a look of the focus goal stays on the recap when no row names its step (the safety net\'s rule); the Product owner\'s and a decide do not', () => {
  assert.equal(isKeptLook(Q590(), 'worker'), true)
  assert.equal(isKeptLook(Q590(), 'advisor'), true)
  assert.equal(isKeptLook(Q590(), 'owner'), false)
  assert.equal(isKeptLook(Q590(), 'board'), false)
  assert.equal(isKeptLook(Q590({ Asks: 'decide' }), 'worker'), false)
  assert.equal(isKeptLook(Q590({ Asks: undefined }), 'worker'), false, 'no Asks is a decide')
})

// ---------------------------------------------------------------------------------------------------------------------
// The board

test('the pass puts Q590\'s shape under its step on the recap, though no row names the step and the goal\'s demo exists; a look of another goal goes its old way', async t => {
  const dir = await storeWith({ ...steps(), Q1: look('Q1'), Q2: look('Q2', { Pictures: 'pictures/B70/after.jpg' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await pass(dir)
  assert.deepEqual(done.result.routed, [{ id: 'Q1', to: 'recap' }, { id: 'Q2', to: 'partner' }])
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Route'), field(items, 'Q1', 'Of')], ['recap', 'B55'])
  assert.deepEqual(history(items, 'Q1').slice(-2), ['server: autopilot: routed to recap', 'server: autopilot: put under B55, the step its picture names'])
  assert.ok(items.get('B55').sections.get('Context').some(line => line.trim() === 'Recap verdict: waits (Q1)'))
  assert.equal(field(items, 'B55', 'State'), 'done', 'the step stays as it is')
  assert.equal(field(items, 'Q2', 'Route'), 'partner')
  // Out of Needs your attention; in the recap's list, and the net keeps it there at the next pass.
  assert.deepEqual(needsOf(items), [])
  assert.deepEqual(routedAwayOf({ ok: true, items }).map(one => [one.id, one.route, one.of, one.goal, one.asks]), [['Q1', 'recap', 'B55', 'G29', 'look']])
  const again = await pass(dir, {}, NOW + 5 * MIN)
  assert.deepEqual([again.result.routed, again.result.escalated], [[], []])
  assert.equal(field(await read(dir), 'Q1', 'Route'), 'recap')
})

test('the partner\'s escalate of such a look with Autopilot on keeps it for the recap: Route recap, Of set, its step marked, its why in History; with Autopilot off it goes to the person as before', async t => {
  const files = () => ({ ...steps(), Q1: look('Q1', { Route: 'partner' }, { history: [`- ${at(79)} server: autopilot: routed to partner`] }) })
  const dir = await storeWith(files())
  const off = await storeWith(files())
  t.after(() => Promise.all([dir, off].map(one => rm(one, { recursive: true, force: true }))))
  const kept = await chat(dir, 'Partner', { action: 'escalate', id: 'Q1', why: WHY }, NOW, { autopilot: true })
  assert.equal(kept.ok, true, kept.why)
  assert.match(kept.result.text, /^Q1 waits for the goal's recap: Autopilot is on/)
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Route'), field(items, 'Q1', 'Of')], ['recap', 'B55'])
  assert.deepEqual(items.get('Q1').sections.get('Route'), ['Your partner hands this to you; Autopilot keeps it for the goal\'s recap'])
  assert.deepEqual(history(items, 'Q1').slice(-3), [`Partner: to the person: ${WHY}`, 'server: autopilot: routed to recap', 'server: autopilot: put under B55, the step its picture names'])
  assert.ok(items.get('B55').sections.get('Context').some(line => line.trim() === 'Recap verdict: waits (Q1)'), 'its step is marked, as for any recap wait')
  assert.deepEqual(needsOf(items), [])
  // Off: the person's, with the partner's line, as always.
  const gone = await chat(off, 'Partner', { action: 'escalate', id: 'Q1', why: WHY }, NOW)
  assert.equal(gone.ok, true, gone.why)
  const plain = await read(off)
  assert.deepEqual([field(plain, 'Q1', 'Route'), field(plain, 'Q1', 'Of')], ['person', undefined])
  assert.deepEqual(plain.get('Q1').sections.get('Route'), [`Your partner hands this to you: ${WHY}`])
  assert.deepEqual(needsOf(plain), ['Q1'])
})

test('the partner\'s escalate stays the person\'s for a look of another goal, a decide, a why or words that name the person\'s hands, and a look of the Product owner', async t => {
  const dir = await storeWith({
    ...steps(),
    Q1: look('Q1', { Route: 'partner', Pictures: 'pictures/B70/after.jpg' }),
    Q2: look('Q2', { Route: 'partner', Asks: 'decide', Options: 'A keep | B drop' }),
    Q3: look('Q3', { Route: 'partner' }),
    Q4: look('Q4', { Route: 'partner', Title: 'Sign in to the art shop: does the range look right?' }),
    Q5: look('Q5', { Route: 'partner', Owner: 'Keeper' }),
    Q6: look('Q6', { Route: 'partner', Of: 'G29' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const escalate = (id, why = WHY) => chat(dir, 'Partner', { action: 'escalate', id, why }, NOW, { autopilot: true })
  for (const id of ['Q1', 'Q2', 'Q4', 'Q5', 'Q6']) assert.equal((await escalate(id)).ok, true, id)
  assert.equal((await escalate('Q3', 'Painter asks you to click the wizard and look at the range.')).ok, true)
  const items = await read(dir)
  for (const id of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']) assert.equal(field(items, id, 'Route'), 'person', id)
  assert.equal(field(items, 'Q3', 'Of'), undefined, 'and is put under no step')
  // The main chat's hand-over and the board's timeout are no partner's: Autopilot keeps nothing for them.
  const main = await chat(dir, 'Lead', { action: 'escalate', id: 'Q1', why: 'x' }, NOW, { autopilot: true })
  assert.equal(main.ok, false, 'Q1 is not routed to the main chat')
})

test('the pass moves a look that stands for the person because the partner handed it over (Q590 live), at every pass; never one the person took back, one handed on for another reason, or one of the Product owner', async t => {
  const dir = await storeWith({
    ...steps(),
    Q1: handed('Q1'),
    // The person took it back from Autopilot's Undo: its card holds their line.
    Q2: look('Q2', { Route: 'person' }, { route: ['The person took it back from Autopilot (Undo)'], history: handedHistory(WHY) }),
    // Handed on by the main chat, or by the partner for what the person's hands do.
    Q3: look('Q3', { Route: 'person' }, { route: ['The main chat hands this to you: it needs a sign-in'], history: [`- ${at(75)} Lead: to the person: it needs a sign-in`] }),
    Q4: handed('Q4', {}, 'Painter wants you to click the wizard and look at the range.'),
    Q5: handed('Q5', { Title: 'Sign in to the art shop: does the range look right?' }),
    Q6: handed('Q6', { Of: 'G29' }),
    Q7: handed('Q7', { Owner: 'Keeper' }),
    // A decide the partner handed over, a look of another goal's step.
    Q8: handed('Q8', { Asks: 'decide', Options: 'A keep | B drop' }),
    Q9: handed('Q9', { Pictures: 'pictures/B70/after.jpg' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const before = Object.fromEntries(await Promise.all(['Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].map(async id => [id, await readFile(join(dir, `${id}.md`), 'utf8')])))
  // Not at the switch-on only: the plain refresh does it.
  const done = await pass(dir)
  assert.deepEqual(done.result.routed, [{ id: 'Q1', to: 'recap' }])
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Route'), field(items, 'Q1', 'Of')], ['recap', 'B55'])
  assert.deepEqual(items.get('Q1').sections.get('Route'), ['Your partner hands this to you; Autopilot keeps it for the goal\'s recap'])
  assert.deepEqual(history(items, 'Q1').slice(-3), [`Partner: to the person: ${WHY}`, 'server: autopilot: routed to recap', 'server: autopilot: put under B55, the step its picture names'], 'the partner\'s own line stays')
  assert.ok(items.get('B55').sections.get('Context').some(line => line.trim() === 'Recap verdict: waits (Q1)'))
  for (const [id, body] of Object.entries(before)) assert.equal(await readFile(join(dir, `${id}.md`), 'utf8'), body, `${id} is as it was`)
  assert.equal((await pass(dir, {}, NOW + 5 * MIN)).result.routed.length, 0, 'once')
  // Autopilot off: the pass moves nothing, and an ask kept for the recap stands for the person again.
  const idle = await workApi({ action: 'autopilot', on: false }, ctx(dir, NOW + 6 * MIN, 'server'))
  assert.deepEqual(idle.result.routed, [])
  assert.ok(needsOf(await read(dir), NOW + 7 * MIN, { autopilot: false }).includes('Q1'))
})

test('the switch-on\'s sweep keeps what it moved for the Undo, the partner\'s hand-overs too; after the Undo no pass takes a look back into the recap', async t => {
  const dir = await storeWith({ ...steps(), Q1: handed('Q1'), Q2: look('Q2', { Route: 'person' }, { history: [`- ${at(70)} server: autopilot: routed to person`] }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const swept = await pass(dir, { sweep: true })
  assert.deepEqual(swept.result.routed, [{ id: 'Q2', to: 'recap' }, { id: 'Q1', to: 'recap' }])
  const record = (await readAutopilotClearedFile(dir)).record
  assert.deepEqual(record.items.map(one => [one.id, one.how]).sort(), [['Q1', 'recap'], ['Q2', 'recap']])
  const undone = await person(dir, { action: 'autopilot-undo' }, NOW + 5 * MIN)
  assert.equal(undone.ok, true, undone.why)
  assert.deepEqual(undone.result.undone.sort(), ['Q1', 'Q2'])
  let items = await read(dir)
  for (const id of ['Q1', 'Q2']) assert.deepEqual([field(items, id, 'Route'), items.get(id).sections.get('Route')], ['person', ['The person took it back from Autopilot (Undo)']], id)
  // Neither the plain pass nor a new switch-on moves them again.
  assert.deepEqual((await pass(dir, {}, NOW + 6 * MIN)).result.routed, [])
  assert.deepEqual((await pass(dir, { sweep: true }, NOW + 7 * MIN)).result.routed, [])
  items = await read(dir)
  assert.deepEqual(needsOf(items, NOW + 8 * MIN), ['Q1', 'Q2'])
})

test('the safety net: a look of the focus goal stays on the recap when no row names its step; every other recap wait is handed back; the person has it once the focus moves', async t => {
  const dir = await storeWith({
    ...steps(),
    B57: step('B57', { Title: 'Label the pond', State: 'review', Owner: 'Painter', Goal: 'G29' }),
    Q1: look('Q1', { Route: 'recap', Of: 'B55' }),
    Q2: look('Q2', { Route: 'recap', Of: 'B57', Owner: 'Keeper' }),
    Q3: look('Q3', { Route: 'recap', Of: 'B57', Asks: 'decide', Options: 'A accept | B send back', Via: 'accept' }),
    Q4: look('Q4', { Route: 'recap', Of: 'B56' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // The demo exists, and its only row names B56: Q4 (named) and Q1 (a look) stay; the Product owner's look and the decide go back.
  const net = await pass(dir)
  assert.deepEqual(net.result.escalated.sort(), ['Q2', 'Q3'])
  let items = await read(dir)
  assert.deepEqual(['Q1', 'Q2', 'Q3', 'Q4'].map(id => field(items, id, 'Route')), ['recap', 'person', 'person', 'recap'])
  assert.deepEqual(items.get('Q3').sections.get('Route'), ['The goal demo came without its step, so the recap will not answer it: it is yours'])
  // The focus moved to another goal: its recap will not come, the look is the person's with the old words.
  const moved = await pass(dir, {}, NOW + 6 * MIN, { focusGoal: 'G30', recaps: [{ step: 'B70', goal: 'G30', path: 'pictures/g30/recap/demo.json' }] })
  assert.deepEqual(moved.result.escalated.sort(), ['Q1', 'Q4'])
  items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Route'), items.get('Q1').sections.get('Route')], ['person', [recapGoneWords]])
})

test('the person answers the look in its window as any ask: it closes with their words, its step is not moved, and the asking chat is woken', async t => {
  const dir = await storeWith({ ...steps(), Q1: look('Q1') })
  t.after(() => rm(dir, { recursive: true, force: true }))
  await pass(dir)
  const answered = await person(dir, { action: 'answer', id: 'Q1', verdict: 'approve', text: 'The squares look whole now.' }, NOW + 10 * MIN)
  assert.equal(answered.ok, true, answered.why)
  assert.deepEqual(answered.result.wake && [answered.result.wake.to, answered.result.wake.id], ['Painter', 'Q1'])
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'State'), items.get('Q1').sections.get('Answer')], ['answered', ['Approved. The squares look whole now.']])
  assert.equal(field(items, 'B55', 'State'), 'done', 'a done step stays done')
  assert.deepEqual(routedAwayOf({ ok: true, items }), [])
  // Rejecting it needs the person's words, as for any look.
  const second = await storeWith({ ...steps(), Q1: look('Q1') })
  t.after(() => rm(second, { recursive: true, force: true }))
  await pass(second)
  assert.equal((await person(second, { action: 'answer', id: 'Q1', verdict: 'reject', text: '' }, NOW + MIN)).ok, false)
  const sent = await person(second, { action: 'answer', id: 'Q1', verdict: 'reject', text: 'The top row is still cut.' }, NOW + 2 * MIN)
  assert.equal(sent.ok, true, sent.why)
  assert.deepEqual((await read(second)).get('Q1').sections.get('Answer'), ['Rejected. The top row is still cut.'])
})
