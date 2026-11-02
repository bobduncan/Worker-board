// A new look waits for the goal's recap (the person, 2026-11-02, seeing Worker 1's look "Does the wizard's move range on the Terraces look
// right?" under Needs your attention with Autopilot on: "Why is he asking me for it. this is autopilot is turned on correct?"; their
// choice "A": with Autopilot on, a new look on a step of the focus goal waits for that goal's recap instead of reaching them mid-goal;
// the coordinator's ruling the same day: only a look the partner hands to the person, never a worker's look at filing, since the
// partner answers those with the worker's advice and Autopilot never asks the person more than Off does).
// The live Q590 was a worker's look under no step, its picture of a done step of the focus goal that no recap row names; the partner
// handed it to the person because its Detail questions always hand over "a new look". The rule (src/work/autopilot.mjs `focusLookOf`),
// the partner's hand-over kept for the recap (work API `escalate`), the pass that moves such a hand-over (`autopilot`), the safety net
// that keeps the look on the recap, and the person's answer in its window. Made-up garden project in a temporary folder.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FOCUS_LOOK_WHY, HANDED_KEPT_WORDS, autopilotRoute, focusLookOf, isExplicitPerson, isKeptLook, partnerHandOverOf, recapGoneWords, recapWaitIds, recapWaitOf, standsForPerson } from '../src/work/autopilot.mjs'
import { openAsksOf } from '../src/work/stepAsks.mjs'
import { GUARDS } from '../src/work/guards.mjs'
import { REST_GUARD, openAskIds } from '../src/work/parked.mjs'
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
  B70: step('B70', { Title: 'Trim the hedge', State: 'in progress', Owner: 'Checker', Goal: 'G30' }),
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

test('a worker\'s look is routed as before (the partner answers it); only the partner\'s hand-over of a new look of the focus goal (Q590\'s shape) waits for the recap, in a role other than the Product owner\'s', () => {
  const handedOver = { ...pure, handedWhy: WHY }
  // The coordinator's ruling (2026-11-02): Autopilot never asks the person more than Off does, and a look the partner answers with the
  // worker's advice is not the person's: a worker's look goes to the partner at filing, whatever step its picture is of.
  assert.equal(autopilotRoute(Q590(), pure).to, 'partner', 'Q590\'s shape, filed: a detail question for the partner')
  assert.equal(autopilotRoute(Q590({ Of: 'B24' }), pure).to, 'partner')
  assert.equal(autopilotRoute(Q590({ Pictures: undefined }), pure).to, 'partner')
  // Handed to the person by the partner: it waits for the recap, put under the step its picture names.
  assert.deepEqual(autopilotRoute(Q590(), handedOver), { to: 'recap', why: FOCUS_LOOK_WHY, step: 'B24' }, 'put under the step its picture names')
  assert.equal(FOCUS_LOOK_WHY, 'a new look of the focus goal waits for its recap')
  assert.deepEqual(focusLookOf(Q590(), pure, 'worker'), { step: 'B24', isInferred: true })
  // Under its step already: the step is its own, nothing is inferred.
  assert.deepEqual(autopilotRoute(Q590({ Of: 'B24' }), handedOver), { to: 'recap', why: FOCUS_LOOK_WHY })
  assert.deepEqual(focusLookOf(Q590({ Of: 'B24' }), pure, 'worker'), { step: 'B24', isInferred: false })
  // The first picture step that is a step of the focus goal; a step of another goal, a longer id and a step the store lacks are none.
  assert.equal(autopilotRoute(Q590({ Pictures: 'pictures/B25/a.png, pictures/B99/b.png, pictures/B24/c.png' }), handedOver).step, 'B24', 'B25 is G7\'s, B99 is not in the store')
  for (const pictures of ['pictures/B25/a.png', 'pictures/B240/a.png', undefined]) assert.notEqual(autopilotRoute(Q590({ Pictures: pictures }), handedOver).to, 'recap', `${pictures}`)
  assert.notEqual(autopilotRoute(Q590({ Of: 'B25' }), handedOver).to, 'recap', 'under a step of another goal')
  // Its words name the step: not enough (only its Pictures do).
  assert.notEqual(autopilotRoute(Q590({ Pictures: undefined, Title: 'Does B24 look right?' }, 'Does B24 look right?'), handedOver).to, 'recap')
  // Any role but the Product owner's: the main chat, the checker, the partner; the board's own card never.
  for (const owner of ['Lead', 'Checker', 'Partner']) assert.equal(autopilotRoute(Q590({ Owner: owner }), handedOver).to, 'recap', owner)
  assert.equal(autopilotRoute(Q590({ Owner: 'Keeper' }), handedOver).to, 'person', 'the Product owner answers for the goal')
  assert.equal(autopilotRoute(Q590({ Owner: 'server' }), handedOver).to, 'person', 'the board\'s own card')
  // Only a look, and only with a focus goal.
  assert.notEqual(autopilotRoute(Q590({ Asks: 'decide' }), handedOver).why, FOCUS_LOOK_WHY)
  assert.notEqual(autopilotRoute(Q590(), { ...handedOver, focusGoal: null }).to, 'recap')
  // The person's hands and goal level come first.
  assert.equal(autopilotRoute(Q590({ Title: 'Click the wizard: does the move range look right?' }), handedOver).to, 'person', 'a click is the person\'s hands')
  assert.equal(autopilotRoute(Q590({ Title: 'Is the goal\'s recap what you wanted?' }), handedOver).to, 'person', 'goal level')
  assert.equal(autopilotRoute(Q590({ Of: 'G29' }), handedOver).to, 'person', 'a look of a goal')
  // Stands in Needs your attention: not while the board holds it for the recap or the partner; a young one is the board's to route.
  assert.equal(standsForPerson(Q590({ Route: 'recap' }), { ...pure, autopilot: true, now: NOW }), false)
  assert.equal(standsForPerson(Q590({ Filed: String(NOW - MIN) }), { ...pure, autopilot: true, now: NOW }), false, 'not routed yet (young): the partner\'s')
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

test('only the partner\'s hand-over that Autopilot kept is a kept look (its Route line); a worker\'s or checker\'s look on the recap, a blocking ask and a decide are not', () => {
  const kept = more => ask('Q590', { Title: 'Does the moat look right?', Owner: 'Painter', Asks: 'look', Of: 'B24', Route: 'recap', Blocking: 'no', ...more }, null, { Route: [HANDED_KEPT_WORDS] })
  assert.equal(isKeptLook(kept({})), true)
  assert.equal(isKeptLook(kept({ Owner: 'Checker' })), true, 'whoever asked it')
  assert.equal(isKeptLook(ask('Q591', { Title: 'A checker\'s look', Owner: 'Checker', Asks: 'look', Of: 'B24', Route: 'recap' })), false, 'a recap wait of the old routes: no kept line')
  assert.equal(isKeptLook(kept({ Route: 'person' })), false, 'handed back to the person')
  assert.equal(isKeptLook(kept({ Route: 'partner' })), false)
  assert.equal(isKeptLook(kept({ Blocking: 'yes' })), false, 'a blocking ask holds its worker')
  assert.equal(isKeptLook(kept({ Asks: 'decide' })), false)
  assert.equal(isKeptLook(ask('Q592', { Title: 'x', Owner: 'Painter', Asks: 'look', Route: 'recap' }, null, { Route: ['Some other line'] })), false)
  assert.equal(isKeptLook(undefined), false)
})

// ---------------------------------------------------------------------------------------------------------------------
// The board

test('Q590 end to end: the worker\'s look goes to the partner as before; the partner hands it over; it waits for the recap, though no row names its step and the goal\'s demo exists; a look of another goal goes to the person', async t => {
  const dir = await storeWith({ ...steps(), Q1: look('Q1'), Q2: look('Q2', { Pictures: 'pictures/B70/after.jpg' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // The coordinator's ruling: Autopilot never asks the person more than Off does, so the pass routes both looks to the partner.
  const done = await pass(dir)
  const before = await read(dir)
  assert.deepEqual(done.result.routed, [{ id: 'Q1', to: 'partner' }, { id: 'Q2', to: 'partner' }])
  assert.deepEqual(['Q1', 'Q2'].map(id => field(before, id, 'Route')), ['partner', 'partner'])
  // The partner hands both to the person, as roles/partner.md says it does for a new look: the one of the focus goal waits for the recap.
  for (const id of ['Q1', 'Q2']) assert.equal((await chat(dir, 'Partner', { action: 'escalate', id, why: WHY }, NOW + MIN, { autopilot: true })).ok, true, id)
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Route'), field(items, 'Q1', 'Of')], ['recap', 'B55'])
  assert.deepEqual(history(items, 'Q1').slice(-3), [`Partner: to the person: ${WHY}`, 'server: autopilot: routed to recap', 'server: autopilot: put under B55, the step its picture names'])
  assert.ok(items.get('B55').sections.get('Context').some(line => line.trim() === 'Recap verdict: waits (Q1)'))
  assert.equal(field(items, 'B55', 'State'), 'done', 'the step stays as it is')
  assert.deepEqual([field(items, 'Q2', 'Route'), field(items, 'Q2', 'Of')], ['person', undefined], 'a look of another goal is the person\'s, as before')
  // Out of Needs your attention; in the recap's list, and the net keeps it there at the next pass.
  assert.deepEqual(needsOf(items), ['Q2'])
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

test('the switch-on\'s sweep keeps the partner\'s hand-overs it moved for the Undo; after the Undo no pass takes a look back into the recap; a look the board routed to the person goes to the partner, as before', async t => {
  const dir = await storeWith({ ...steps(), Q1: handed('Q1'), Q2: look('Q2', { Route: 'person' }, { history: [`- ${at(70)} server: autopilot: routed to person`] }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const swept = await pass(dir, { sweep: true })
  assert.deepEqual(swept.result.routed, [{ id: 'Q2', to: 'partner' }, { id: 'Q1', to: 'recap' }])
  const record = (await readAutopilotClearedFile(dir)).record
  assert.deepEqual(record.items.map(one => [one.id, one.how]), [['Q1', 'recap']], 'only what moved into the recap is kept for the Undo')
  const undone = await person(dir, { action: 'autopilot-undo' }, NOW + 5 * MIN)
  assert.equal(undone.ok, true, undone.why)
  assert.deepEqual(undone.result.undone, ['Q1'])
  let items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Route'), items.get('Q1').sections.get('Route')], ['person', ['The person took it back from Autopilot (Undo)']])
  // Neither the plain pass nor a new switch-on moves it again.
  assert.deepEqual((await pass(dir, {}, NOW + 6 * MIN)).result.routed, [])
  assert.deepEqual((await pass(dir, { sweep: true }, NOW + 7 * MIN)).result.routed, [])
  items = await read(dir)
  assert.deepEqual(needsOf(items, NOW + 8 * MIN), ['Q1'])
})

/** A look the partner handed over that Autopilot kept for the recap: Route recap, not blocking, the kept line on its card. */
const kept = (id, fields = {}, more = {}) => look(id, { Route: 'recap', Of: 'B55', Blocking: 'no', ...fields }, { route: [HANDED_KEPT_WORDS], history: handedHistory(WHY), ...more })

test('the safety net: only a look the partner handed over stays on the recap when no row names its step; every other recap wait is handed back as before; the person has it once the focus moves', async t => {
  const dir = await storeWith({
    ...steps(),
    B57: step('B57', { Title: 'Label the pond', State: 'review', Owner: 'Painter', Goal: 'G29' }),
    Q1: kept('Q1'),
    // The old routes: a checker's look and the Product owner's look on the recap (no kept line), a decide (the Accept card).
    Q2: look('Q2', { Route: 'recap', Of: 'B57', Owner: 'Checker' }),
    Q3: look('Q3', { Route: 'recap', Of: 'B57', Asks: 'decide', Options: 'A accept | B send back', Via: 'accept' }),
    // Named by the recap's row: stays by the old rule.
    Q4: look('Q4', { Route: 'recap', Of: 'B56' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // The demo exists, and its only row names B56: Q4 (named) and Q1 (kept) stay; the checker's look and the decide go back to the person.
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

test('S1: a blocking look the partner hands over frees its step: the step goes on, its worker is woken with one line; a kept look holds no worker', async t => {
  const dir = await storeWith({ ...steps() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // The worker's blocking look under its step in progress: at filing it goes to the partner and the step waits on the person.
  const asked = await chat(dir, 'Painter', { action: 'ask', of: 'B56', kind: 'look', blocking: true, title: 'Does the pond look right?', text: ['The pond is round now.'], options: ['yes', 'no'], advice: 'yes', pictures: [] }, NOW, { autopilot: true })
  assert.equal(asked.ok, true, asked.why)
  const id = asked.result.id
  let items = await read(dir)
  assert.deepEqual([field(items, id, 'Route'), field(items, id, 'Blocking'), field(items, 'B56', 'State')], ['partner', 'yes', 'waiting on you'])
  // The partner hands it over: the ask is kept for the recap, non-blocking; the step goes on and its worker is told.
  const escalated = await chat(dir, 'Partner', { action: 'escalate', id, why: WHY }, NOW + MIN, { autopilot: true })
  assert.equal(escalated.ok, true, escalated.why)
  items = await read(dir)
  assert.deepEqual([field(items, id, 'Route'), field(items, id, 'Blocking'), field(items, 'B56', 'State')], ['recap', 'no', 'in progress'])
  assert.ok(history(items, 'B56').some(line => line.endsWith(`server: waiting on you → in progress (${id} waits for the goal's recap)`)), history(items, 'B56').join(' | '))
  assert.deepEqual(escalated.result.wake, { to: 'Painter', id, kind: 'recap-kept', line: `${id} waits for the goal's recap: go on` })
  // The step\'s done still waits for the look: the rule "no open look" stays (the recap gives the answer).
  assert.equal(field(items, 'B56', 'State'), 'in progress')
})

test('S1: a step that another blocking ask holds stays waiting; with its worker on another step it is parked; neither is woken', async t => {
  const dir = await storeWith({
    ...steps(),
    Q5: look('Q5', { Of: 'B56', Blocking: 'yes', Asks: 'decide', Route: 'person', Pictures: undefined }, { history: [`- ${at(70)} Painter: asked (decide)`] }),
    B58: step('B58', { Title: 'Plant the hedge', State: 'waiting on you', Owner: 'Painter', Goal: 'G29' }),
    B59: step('B59', { Title: 'Water the hedge', State: 'in progress', Owner: 'Painter', Goal: 'G29' }),
    Q6: look('Q6', { Of: 'B58', Blocking: 'yes', Route: 'partner' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // B56 waits on you for Q5 (a plain blocking decide) as well as the look Q7 the partner hands over: it stays.
  await writeFile(join(dir, 'B56.md'), step('B56', { Title: 'Round the pond', State: 'waiting on you', Owner: 'Painter', Goal: 'G29' }))
  await writeFile(join(dir, 'Q7.md'), look('Q7', { Of: 'B56', Blocking: 'yes', Route: 'partner' }))
  const first = await chat(dir, 'Partner', { action: 'escalate', id: 'Q7', why: WHY }, NOW, { autopilot: true })
  assert.equal(first.ok, true, first.why)
  assert.equal(first.result.wake, undefined, 'nobody is woken: the step still waits for Q5')
  let items = await read(dir)
  assert.deepEqual([field(items, 'Q7', 'Route'), field(items, 'B56', 'State')], ['recap', 'waiting on you'])
  // B58 waits only for Q6, but Painter works on B59 (in progress): the step is parked, no wake.
  const second = await chat(dir, 'Partner', { action: 'escalate', id: 'Q6', why: WHY }, NOW + MIN, { autopilot: true })
  assert.equal(second.ok, true, second.why)
  assert.equal(second.result.wake, undefined)
  items = await read(dir)
  assert.equal(field(items, 'B58', 'State'), 'waiting on you')
  assert.ok(history(items, 'B58').some(line => line.endsWith('server: parked (resumes after B59)')), history(items, 'B58').join(' | '))
})

test('the pass wakes the worker of a step a handed-over blocking look frees, at every pass', async t => {
  const dir = await storeWith({
    ...steps(),
    B56: step('B56', { Title: 'Round the pond', State: 'waiting on you', Owner: 'Painter', Goal: 'G29' }),
    Q1: handed('Q1', { Of: 'B56', Blocking: 'yes' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await pass(dir)
  assert.deepEqual(done.result.routed, [{ id: 'Q1', to: 'recap' }])
  assert.deepEqual(done.result.wakes, [{ to: 'Painter', id: 'Q1', kind: 'recap-kept', line: 'Q1 waits for the goal\'s recap: go on' }])
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Blocking'), field(items, 'B56', 'State')], ['no', 'in progress'])
})

test('a kept look parks no step and counts in no guard for moving on: the rest rule, the "asks are answered" move and the park', () => {
  const items = new Map(['B56', 'Q1', 'Q2'].map(id => [id, parseItem(text(
    id === 'B56' ? { Id: 'B56', Kind: 'step', State: 'waiting on you', Owner: 'Painter', Goal: 'G29', Since: at(30) }
      : { Id: id, Kind: 'ask', Title: `Look ${id}`, State: 'open', Owner: 'Painter', Asks: 'look', Of: 'B56', Route: 'recap', Blocking: 'no', Since: at(30) },
    id === 'Q1' ? { Route: [HANDED_KEPT_WORDS] } : {}))]))
  const stepItem = items.get('B56')
  const ctx = onlyItems => ({ store: { items: new Map([...items].filter(([id]) => id === 'B56' || onlyItems.includes(id))) }, prefix: '' })
  // Only the kept look Q1 is open: neither guard holds, the step may go on.
  assert.equal(GUARDS['its asks are answered'](stepItem, ctx(['Q1'])), true)
  assert.equal(GUARDS[REST_GUARD](stepItem, ctx(['Q1'])), false)
  assert.deepEqual(openAskIds(ctx(['Q1']).store.items, 'B56'), [])
  // The old recap wait Q2 (no kept line) is an open ask like any other.
  assert.equal(GUARDS['its asks are answered'](stepItem, ctx(['Q1', 'Q2'])), false)
  assert.equal(GUARDS[REST_GUARD](stepItem, ctx(['Q1', 'Q2'])), true)
  assert.deepEqual(openAskIds(ctx(['Q1', 'Q2']).store.items, 'B56'), ['Q2'])
})

test('the person answers the look in its window as any ask: it closes with their words, its step is not moved and reads approved or sent back, and the asking chat is woken', async t => {
  const dir = await storeWith({ ...steps(), Q1: kept('Q1') })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const answered = await person(dir, { action: 'answer', id: 'Q1', verdict: 'approve', text: 'The squares look whole now.' }, NOW + 10 * MIN)
  assert.equal(answered.ok, true, answered.why)
  assert.deepEqual(answered.result.wake && [answered.result.wake.to, answered.result.wake.id], ['Painter', 'Q1'])
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'State'), items.get('Q1').sections.get('Answer')], ['answered', ['Approved. The squares look whole now.']])
  assert.equal(field(items, 'B55', 'State'), 'done', 'a done step stays done')
  assert.ok(items.get('B55').sections.get('Context').some(line => line.trim() === 'Recap verdict: approved (Q1)'), 'the step reads what the recap\'s answer writes')
  assert.deepEqual(routedAwayOf({ ok: true, items }), [])
  // Rejecting it needs the person's words, as for any look; the step reads "sent back".
  const second = await storeWith({ ...steps(), Q1: kept('Q1') })
  t.after(() => rm(second, { recursive: true, force: true }))
  assert.equal((await person(second, { action: 'answer', id: 'Q1', verdict: 'reject', text: '' }, NOW + MIN)).ok, false)
  const sent = await person(second, { action: 'answer', id: 'Q1', verdict: 'reject', text: 'The top row is still cut.' }, NOW + 2 * MIN)
  assert.equal(sent.ok, true, sent.why)
  const back = await read(second)
  assert.deepEqual(back.get('Q1').sections.get('Answer'), ['Rejected. The top row is still cut.'])
  assert.ok(back.get('B55').sections.get('Context').some(line => line.trim() === 'Recap verdict: sent back (Q1)'))
  // A look that is no kept one (a checker's) writes no such line.
  const plain = await storeWith({ ...steps(), Q1: look('Q1', { Route: 'recap', Of: 'B55' }) })
  t.after(() => rm(plain, { recursive: true, force: true }))
  assert.equal((await person(plain, { action: 'answer', id: 'Q1', verdict: 'approve', text: '' }, NOW + MIN)).ok, true)
  assert.equal((await read(plain)).get('B55').sections.get('Context')?.some(line => /Recap verdict/.test(line)) ?? false, false)
})

test('every pass that moves a hand-over to the recap keeps it for the Undo ("kept for your recap"), not only the switch-on; the Undo gives it back', async t => {
  const dir = await storeWith({ ...steps(), Q1: handed('Q1'), Q2: handed('Q2', { Pictures: 'pictures/B56/after.jpg' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  // A plain refresh: Q1 is kept for the recap and recorded.
  const first = await pass(dir)
  assert.deepEqual(first.result.routed.map(one => one.id), ['Q1', 'Q2'])
  let record = (await readAutopilotClearedFile(dir)).record
  assert.deepEqual(record.items.map(one => [one.id, one.how, one.why]), [['Q1', 'recap', 'kept for your recap'], ['Q2', 'recap', 'kept for your recap']])
  assert.equal(record.at, NOW)
  assert.equal(record.undoneAt, null)
  // A later one adds its own to the same record, from the newest, each once.
  await writeFile(join(dir, 'Q3.md'), handed('Q3'))
  await pass(dir, {}, NOW + 3 * MIN)
  record = (await readAutopilotClearedFile(dir)).record
  assert.deepEqual(record.items.map(one => one.id), ['Q1', 'Q2', 'Q3'])
  assert.equal(record.at, NOW + 3 * MIN)
  const undone = await person(dir, { action: 'autopilot-undo' }, NOW + 5 * MIN)
  assert.equal(undone.ok, true, undone.why)
  assert.deepEqual(undone.result.undone, ['Q1', 'Q2', 'Q3'])
  assert.deepEqual(needsOf(await read(dir), NOW + 6 * MIN), ['Q1', 'Q2', 'Q3'])
  // Nothing moved, nothing recorded.
  const idle = await storeWith({ ...steps(), Q1: look('Q1') })
  t.after(() => rm(idle, { recursive: true, force: true }))
  await pass(idle)
  assert.equal(await readAutopilotClearedFile(idle).then(file => file.record), null)
})

test('two blocking hand-overs of one step in one pass: the store is read anew between them, so the last one frees the step and wakes its worker once', async t => {
  const dir = await storeWith({
    ...steps(),
    B56: step('B56', { Title: 'Round the pond', State: 'waiting on you', Owner: 'Painter', Goal: 'G29' }),
    Q1: handed('Q1', { Of: 'B56', Blocking: 'yes' }),
    Q2: handed('Q2', { Of: 'B56', Blocking: 'yes' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await pass(dir)
  assert.deepEqual(done.result.routed, [{ id: 'Q1', to: 'recap' }, { id: 'Q2', to: 'recap' }])
  assert.deepEqual(done.result.wakes, [{ to: 'Painter', id: 'Q2', kind: 'recap-kept', line: 'Q2 waits for the goal\'s recap: go on' }], 'one word, from the hand-over that left nothing holding the step')
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Blocking'), field(items, 'Q2', 'Blocking'), field(items, 'B56', 'State')], ['no', 'no', 'in progress'])
  // Nothing is left to do at the next pass.
  const again = await pass(dir, {}, NOW + MIN)
  assert.deepEqual([again.result.routed, again.result.wakes], [[], []])
})

test('a kept look makes no step wait for the recap only: its Recap verdict line counts for nothing; a real recap wait beside it still counts', () => {
  const review = text => item({ Id: 'B1', Kind: 'step', Title: 'Round the pool', State: 'review', Owner: 'Painter', Goal: 'G29' }, { Context: text })
  const keptAsk = id => item({ Id: id, Kind: 'ask', Title: 'Look', State: 'open', Owner: 'Painter', Asks: 'look', Of: 'B1', Route: 'recap', Blocking: 'no' }, { Route: [HANDED_KEPT_WORDS] })
  const plainAsk = id => item({ Id: id, Kind: 'ask', Title: 'Accept?', State: 'open', Owner: 'Painter', Asks: 'look', Of: 'B1', Route: 'recap', Blocking: 'no' })
  const itemsOf = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
  const onlyKept = review(['  Recap verdict: waits (Q590)'])
  assert.deepEqual(recapWaitIds(onlyKept, itemsOf(onlyKept, keptAsk('Q590'))), [])
  assert.equal(recapWaitOf(onlyKept, itemsOf(onlyKept, keptAsk('Q590'))), null)
  const both = review(['  Recap verdict: waits (Q7)', '  Recap verdict: waits (Q590)'])
  assert.deepEqual(recapWaitOf(both, itemsOf(both, plainAsk('Q7'), keptAsk('Q590'))), [{ step: 'B1', asks: ['Q7'] }], 'the kept look is no "other open ask" that stops the real wait')
  assert.equal(recapWaitOf(both, itemsOf(both, plainAsk('Q7'), plainAsk('Q590'))).length, 1, 'a look of the old routes counts as before')
})

test('openAsksUnder ignores a kept look: the refine of its step is not held back by it, a plain open ask still holds it', async t => {
  const one = (open) => storeWith({ ...steps(), B80: step('B80', { Title: 'Plant the hedge', State: 'new', Goal: 'G29' }, { Summary: ['Plant the hedge.'] }), Q9: open })
  const dir = await one(look('Q9', { Of: 'B80', Route: 'recap', Blocking: 'no' }, { route: [HANDED_KEPT_WORDS] }))
  const held = await one(look('Q9', { Of: 'B80', Route: 'recap', Blocking: 'no' }))
  t.after(() => Promise.all([dir, held].map(path => rm(path, { recursive: true, force: true }))))
  for (const where of [dir, held]) assert.equal((await chat(where, 'Partner', { action: 'refine', id: 'B80', summary: 'Plant the hedge.' })).ok, true)
  const free = await chat(dir, 'Partner', { action: 'refined', id: 'B80', size: '30 min', what: ['a hedge along the wall'] })
  assert.equal(free.ok, true, free.why)
  const refused = await chat(held, 'Partner', { action: 'refined', id: 'B80', size: '30 min', what: ['a hedge along the wall'] })
  assert.equal(refused.ok, false)
  assert.match(refused.why, /Q9 .* still open/)
  // Pure: the step's open asks, by the one function the API reads them with.
  const items = new Map([['Q1', item({ Id: 'Q1', Kind: 'ask', State: 'open', Asks: 'look', Of: 'B1', Route: 'recap' }, { Route: [HANDED_KEPT_WORDS] })], ['Q2', item({ Id: 'Q2', Kind: 'ask', State: 'open', Asks: 'look', Of: 'B1', Route: 'recap' })]])
  assert.deepEqual(openAsksOf(items, 'B1').map(ask => ask.head.get('Id')), ['Q2'])
})
