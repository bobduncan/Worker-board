// Autopilot v2: the last three kinds of noise (the person's "Yes, clear them", 2026-11-04). After v2 went live Needs your attention held,
// besides the recap card and "Rebuild G60" (both the person's): Main's Q616 "After the step in Q600, reopen the Q600 play link" (a do the main
// chat handed on: "Opening a play link is the person's own action; no chat can do it"), Worker 1's Q595 "give your verdict on row 9 in
// G60's recap" (row 9 was approved in the recap's round 2), and two "Answered" slim cards of asks others answered still showing their
// wait line. 1. A slim "Answered" card is the person's own answer only. 2. An own-senses do or look that the main chat or the partner hands
// on, of a step of the focus goal, waits for the recap like a kept look. 3. A question the recap has answered closes. Made-up garden
// project in a temporary folder; the live shapes are twins with other words.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { recapVerdictsOf } from '../src/recaps.mjs'
import { HANDED_KEPT_WORDS, HANDED_ON_WHY, autopilotRoute, handOverOf, handedOnKeptWords, handedOnOf, isKeptLook, isOwnSenses, recapClosesAsk, recapRowNumberOf, rowNumberOfTitle } from '../src/work/autopilot.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem } from '../src/work/item.mjs'
import { routedAwayOf, storeNeeds } from '../src/work/lists.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, share } from '../src/work/store.mjs'
import { openPage, settle } from './pageHarness.mjs'
import { MIN as PAGE_MIN, NOW as PAGE_NOW, app, asSent, build, sinceOf, tail } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

// B917: these tests edit store files by hand and read at once; on the board a hand edit shows within share.ms.
share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 4, 10, 0).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** An item file's text from its head fields and its sections. */
function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const step = (id, fields) => text({ Id: id, Kind: 'step', Activity: 'Garden', Since: at(300), ...fields }, { History: [`- ${at(300)} Lead: made`] })
const askText = (id, fields, { words = null, route = [], history = [] } = {}) => text(
  { Id: id, Kind: 'ask', Title: fields.Title, State: 'open', Owner: 'Lead', Since: at(80), Filed: String(NOW - 80 * MIN), Blocking: 'no', Via: 'chat', ...fields },
  { Text: [words ?? fields.Title], ...(route.length === 0 ? {} : { Route: route }), History: [`- ${at(80)} ${fields.Owner ?? 'Lead'}: asked (${fields.Asks ?? 'decide'})`, ...history] },
)
const item = (head, sections = {}) => parseItem(text(head, sections))

const ROLES = { Lead: 'main', Partner: 'advisor', Keeper: 'owner', Painter: 'worker', Checker: 'worker' }
const PATH = 'pictures/g29/recap/demo.json'
/** G29 is the focus goal; B56 a step of it (its recap part names it), B57 another step of it, B70 a step of G30. */
const steps = () => ({
  B55: step('B55', { Title: 'Whole move squares', State: 'done', Owner: 'Painter', Goal: 'G29' }),
  B56: step('B56', { Title: 'Round the pond', State: 'review', Owner: 'Painter', Goal: 'G29' }),
  B70: step('B70', { Title: 'Trim the hedge', State: 'in progress', Owner: 'Checker', Goal: 'G30' }),
})
const RECAPS = [{ step: 'B56', goal: 'G29', path: PATH, key: 'Pond', title: 'The pond', verdict: null, at: null }]
/** The live Q600: a look of Worker 5's about a step of the focus goal; the play link Main was asked to reopen links it. */
const Q10 = askText('Q10', { Title: 'Check the stairs in the game, west and east, in all sizes (advice: yes).', Owner: 'Painter', Asks: 'look', Of: 'B56', State: 'answered' })
/** The live Q616's shape: Main's do under no step, its play link naming the ask whose Of is a step of the focus goal. */
const Q616 = 'After the step in Q10, reopen the Q10 play link. [Q10](http://127.0.0.1:4310/#details=Q10)'
const MAINS_WHY = 'Opening a play link is the person\'s own action; no chat can do it.'
const main = (id, fields = {}, { title = Q616, words = null } = {}) => askText(id, { Title: title, Asks: 'do', Route: 'main', ...fields }, { words, history: [`- ${at(79)} server: autopilot: routed to main`] })
/** The same, as `escalate` leaves it: Route person, the main chat's line on the card, "to the person" in History. */
const handedByMain = (id, fields = {}, { title = Q616, ...options } = {}, why = MAINS_WHY) => askText(id, { Title: title, Asks: 'do', Route: 'person', ...fields }, {
  ...options, route: [`The main chat hands this to you: ${why}`], history: [`- ${at(79)} server: autopilot: routed to main`, `- ${at(75)} Lead: to the person: ${why}`],
})

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'autopilot-noise-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}
const ctx = (dir, now, as, more = {}) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G29', focusHasDemo: true, recaps: RECAPS, pictureProblem: async () => null, ...(as === undefined ? {} : { as }), ...more })
const pass = (dir, body = {}, now = NOW, more = {}) => workApi({ action: 'autopilot', on: true, ...body }, ctx(dir, now, 'server', more))
const chat = (dir, who, body, now = NOW, more = {}) => workApi({ ...body, chat: who }, ctx(dir, now, undefined, more))
const read = async dir => (await readStore(dir)).items
const field = (items, id, key) => items.get(id).head.get(key)
const history = (items, id) => (items.get(id).sections.get('History') ?? []).map(line => line.replace(/^- [\d: -]+ /, ''))

// ---------------------------------------------------------------------------------------------------------------------
// 1. A slim "Answered" card is the person's own answer only

const GARDEN = { ...parseConfig('{}', {}), project: 'C:\\garden' }
const PILOT = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const answeredAsk = (id, by) => parseItem(text(
  { Id: id, Kind: 'ask', Title: `Number or bar? (${id})`, State: 'answered', Owner: 'Digger', Since: sinceOf(PAGE_NOW - 2 * PAGE_MIN), Filed: String(PAGE_NOW - 20 * PAGE_MIN), Asks: 'decide', Blocking: 'no', Options: 'A number | B bar', ...(by === null ? {} : { Route: 'partner', 'Answered by': by, 'Daily note': 'N1' }) },
  { Answer: ['A'], ...(by === null ? {} : { Why: ['your advice'], 'Note line': [`${id} (Digger): Number or bar? → A (your advice)`] }) },
))
const wordOf = (id, more = {}) => ({ id: `w-${id}`, to: 'Digger', ask: `work:${id}`, step: null, title: `Number or bar? (${id})`, version: null, verdict: null, text: 'A', at: PAGE_NOW - 3 * PAGE_MIN, state: 'waiting', ...more })
const sentLine = id => ({ state: 'sent', lead: `Sent`, rest: 'waits for Digger to pick it up', at: PAGE_NOW - 3 * PAGE_MIN, chat: 'Digger', canSendAgain: false, link: null, command: 'answer', about: null, ask: `work:${id}`, sentAt: PAGE_NOW - 3 * PAGE_MIN, title: 'A' })
/** The state buildState makes for the two answers, with the words in the outbox (build() has none) and the lines the server would judge. */
async function twoAnswers(config, by) {
  const { storeFromText } = await import('../src/work/read.mjs')
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: PAGE_NOW - 60 * PAGE_MIN })
  work.items.set('Q5', answeredAsk('Q5', by))
  work.items.set('Q6', answeredAsk('Q6', null))
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(PAGE_NOW - 30 * PAGE_MIN, 'ok')]), 'cli-Digger': tail([answer(PAGE_NOW - 30 * PAGE_MIN, 'ok')]), 'cli-Advisor': tail([typed(PAGE_NOW - 20 * PAGE_MIN, 'hi'), answer(PAGE_NOW - 12 * PAGE_MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  const state = asSent(buildState(raw, { lines: [], outbox: [wordOf('Q5'), wordOf('Q6')], runs: [], board: null, seen: null, now: PAGE_NOW, config }))
  return { ...state, waits: { 'w-Q5': sentLine('Q5'), 'w-Q6': sentLine('Q6') } }
}

test('an answer the partner, Autopilot or the main chat gave carries its word\'s id (its line stays reachable from the ask\'s window) but is never a slim "Answered" card; the person\'s own answer is one', async () => {
  for (const by of ['partner', 'autopilot', 'main']) {
    const state = await twoAnswers(GARDEN, by)
    const needs = Object.fromEntries(state.forYou.filter(one => one.workId !== undefined).map(one => [one.workId, one]))
    assert.deepEqual([needs.Q5.answer.by, needs.Q5.answer.id], [by, 'w-Q5'], `${by}: decided, with its word`)
    assert.deepEqual([needs.Q6.answer.by ?? null, needs.Q6.answer.id], [null, 'w-Q6'], 'the person\'s own answer')
    // Autopilot off and on: only the person's answer is a slim card with its wait line.
    for (const config of [GARDEN, PILOT]) {
      const page = await openPage({ state: await twoAnswers(config, by) })
      try {
        assert.deepEqual(page.all('#needs .need.is-slim').map(node => node.dataset.id), ['work:Q6'], `${by}, autopilot ${config.autopilot === true}`)
        assert.equal(page.all('#needs .need.is-slim .wait-line').length, 1)
        // "Show closed": the decided ask's card carries its own wait line, so it stays reachable from the ask itself.
        await page.change('#needs-closed', true)
        assert.equal(page.all('#needs .need[data-id="work:Q5"] .wait-line').length, 1, 'the decided card keeps its wait line')
      } finally { await page.close() }
    }
  }
})

test('the person\'s answer typed as "Answered by: person" is theirs too; one with no word keeps no slim card', async () => {
  const state = await twoAnswers(GARDEN, 'partner')
  const needs = storeNeeds({ ok: true, items: new Map([['Q6', parseItem(text({ Id: 'Q6', Kind: 'ask', Title: 'x', State: 'answered', Owner: 'Digger', Since: sinceOf(PAGE_NOW - 2 * PAGE_MIN), 'Answered by': 'person' }, { Answer: ['A'] }))]]) }, { now: PAGE_NOW, answerOf: () => ({ answer: { id: 'w9', at: PAGE_NOW - MIN, state: 'waiting', text: 'A' }, earlier: null }) })
  assert.deepEqual(needs.map(one => [one.workId, one.answer.id, one.answer.by ?? null]), [['Q6', 'w9', null]])
  assert.ok(state.forYou.length > 0)
})

// ---------------------------------------------------------------------------------------------------------------------
// 2. A play or look handed to the person waits for the recap

const world = new Map([
  ['B55', parseItem(step('B55', { Title: 'Whole move squares', State: 'done', Owner: 'Painter', Goal: 'G29' }))],
  ['B56', parseItem(step('B56', { Title: 'Round the pond', State: 'review', Owner: 'Painter', Goal: 'G29' }))],
  ['B70', parseItem(step('B70', { Title: 'Trim the hedge', State: 'in progress', Owner: 'Checker', Goal: 'G30' }))],
  ['Q10', parseItem(Q10)],
  ['Q11', parseItem(askText('Q11', { Title: 'Check the hedge', Owner: 'Checker', Asks: 'look', Of: 'B70', State: 'answered' }))],
  ['Q12', parseItem(askText('Q12', { Title: 'A question of no step', Owner: 'Checker', Asks: 'decide', State: 'answered' }))],
])
const pure = { roleOf: name => ROLES[name] ?? null, items: world, focusGoal: 'G29', prefix: '' }
const handed = { ...pure, handedWhy: MAINS_WHY, handedBy: 'main' }

test('Q616\'s shape: Main\'s do under no step, its play link naming Q10 whose Of is a step of the focus goal, is kept for the recap, put under that step; the same of another goal stays the person\'s', () => {
  const Q = parseItem(main('Q616'))
  assert.deepEqual(autopilotRoute(Q, handed), { to: 'recap', why: HANDED_ON_WHY, handedOn: 'main', step: 'B56', placedBy: 'link' })
  assert.deepEqual(handedOnOf(Q, pure), { step: 'B56', isInferred: true, by: 'link' })
  // Another goal: the ask it links is of B70 (G30).
  const other = parseItem(main('Q617', {}, { title: 'After the step in Q11, reopen the Q11 play link. [Q11](http://127.0.0.1:4310/#details=Q11)' }))
  assert.equal(autopilotRoute(other, handed).to, 'person', 'a step of another goal')
  // No step found: no link, a link to an ask of no step, a link to an ask the store lacks, the words alone naming it.
  for (const title of ['After the step, reopen the play link.', 'After the step in Q12, reopen the Q12 play link. [Q12](http://127.0.0.1:4310/#details=Q12)', 'Reopen the Q99 play link. [Q99](http://127.0.0.1:4310/#details=Q99)', 'After the step in Q10, reopen the Q10 play link.']) {
    assert.equal(autopilotRoute(parseItem(main('Q618', {}, { title })), handed).to, 'person', title)
  }
  // Its own step first (a step of the focus goal; one of another goal or a goal is none), then the step its picture names.
  assert.deepEqual(autopilotRoute(parseItem(main('Q619', { Of: 'B55' })), handed), { to: 'recap', why: HANDED_ON_WHY, handedOn: 'main' }, 'its Of, nothing inferred')
  assert.equal(autopilotRoute(parseItem(main('Q620', { Of: 'B70' })), handed).to, 'person')
  assert.equal(autopilotRoute(parseItem(main('Q621', { Of: 'G29' })), handed).to, 'person', 'an ask of a goal')
  assert.deepEqual(autopilotRoute(parseItem(main('Q622', { Pictures: 'pictures/B70/a.png, pictures/B55/b.png' }, { title: 'Look at the pond in the game.' })), handed), { to: 'recap', why: HANDED_ON_WHY, handedOn: 'main', step: 'B55', placedBy: 'picture' })
  // Only an own-senses ask: a look, a do that looks, plays, tries, checks or opens a play link; a chore is not.
  for (const title of ['Look at the pond.', 'Play the pond map.', 'Try the stairs.', 'Check the result in the game.', 'Reopen the Q10 play link.', 'After the step in Q10, look at the pond.']) {
    assert.equal(isOwnSenses(parseItem(main('Q630', { Of: 'B56' }, { title }))), true, title)
  }
  for (const title of ['Merge the pond branch.', 'Mark B56 done on the board.', 'Restart the board.']) assert.equal(isOwnSenses(parseItem(main('Q631', { Of: 'B56' }, { title }))), false, title)
  assert.equal(autopilotRoute(parseItem(main('Q632', { Of: 'B56' }, { title: 'Merge the pond branch.' })), handed).to, 'person', 'a chore the main chat could not do stays the person\'s')
  // What only the person's hands can do, and a goal's level, come first; the Product owner's and the board's own card never.
  assert.equal(autopilotRoute(Q, { ...handed, handedWhy: 'It needs a sign-in to the art shop.' }).to, 'person')
  assert.equal(autopilotRoute(parseItem(main('Q633', { Owner: 'Keeper' })), handed).to, 'person')
  assert.equal(autopilotRoute(parseItem(main('Q634', { Owner: 'server' })), handed).to, 'person')
  assert.equal(autopilotRoute(Q, { ...handed, focusGoal: null }).to, 'person', 'no focus goal')
  // Without who handed it on, the rule is the partner\'s look rule as before: a do is the person\'s.
  assert.equal(autopilotRoute(Q, { ...pure, handedWhy: MAINS_WHY }).to, 'person')
})

test('who hands a look on: the main chat\'s look carries the hand-on line, the partner\'s keeps its own line (a partner\'s do the hand-on line); a worker\'s look and a decide are no hand-on', () => {
  const look = parseItem(askText('Q640', { Title: 'Does the pond look right?', Owner: 'Painter', Asks: 'look', Of: 'B56', Route: 'person' }, { route: ['Your partner hands this to you: x'], history: [`- ${at(70)} Partner: to the person: x`] }))
  assert.deepEqual(autopilotRoute(look, { ...pure, handedWhy: 'x', handedBy: 'partner' }).why, 'a new look of the focus goal waits for its recap')
  assert.equal(autopilotRoute(look, { ...pure, handedWhy: 'x', handedBy: 'partner' }).handedOn, undefined, 'the partner\'s look: the old line')
  assert.equal(autopilotRoute(look, { ...pure, handedWhy: 'x', handedBy: 'main' }).handedOn, 'main', 'the main chat\'s look: the hand-on line')
  const doIt = parseItem(askText('Q641', { Title: 'Play the pond map.', Owner: 'Painter', Asks: 'do', Of: 'B56', Route: 'person' }))
  assert.equal(autopilotRoute(doIt, { ...pure, handedWhy: 'x', handedBy: 'partner' }).handedOn, 'partner')
  assert.equal(autopilotRoute(parseItem(askText('Q642', { Title: 'Number or bar?', Asks: 'decide', Of: 'B56', Options: 'A number | B bar' })), { ...pure, handedWhy: 'x', handedBy: 'main' }).to, 'person')
  assert.equal(handedOnKeptWords('main'), 'Kept for the goal\'s recap: the main chat handed it on')
  assert.equal(handedOnKeptWords('partner'), 'Kept for the goal\'s recap: your partner handed it on')
  // The Route lines tell who handed it on.
  const byMain = parseItem(handedByMain('Q643'))
  assert.deepEqual(handOverOf(byMain), { by: 'main', why: MAINS_WHY })
  assert.equal(handOverOf(parseItem(handedByMain('Q644', { Route: 'recap' }))), null, 'not the person\'s any more')
  assert.equal(handOverOf(parseItem(askText('Q645', { Title: Q616, Asks: 'do', Route: 'person' }, { route: ['The person took it back from Autopilot (Undo)'], history: [`- ${at(70)} Lead: to the person: x`] }))), null, 'a take-back')
})

test('a kept do is a kept look for every reader of one: open, routed to the recap, non-blocking, with the hand-on line; not a decide, not blocking, not another line', () => {
  const kept = (fields = {}, line = handedOnKeptWords('main')) => parseItem(askText('Q650', { Title: Q616, Asks: 'do', Route: 'recap', ...fields }, { route: [line] }))
  assert.equal(isKeptLook(kept()), true)
  assert.equal(isKeptLook(kept({ Asks: 'look' })), true)
  assert.equal(isKeptLook(kept({ Asks: 'decide' })), false)
  assert.equal(isKeptLook(kept({ Blocking: 'yes' })), false)
  assert.equal(isKeptLook(kept({ Route: 'person' })), false)
  assert.equal(isKeptLook(kept({}, 'Autopilot keeps this look for the goal\'s recap')), false, 'a do with a look\'s kept line is none')
  assert.equal(isKeptLook(kept({ Asks: 'look' }, HANDED_KEPT_WORDS)), true, 'the partner\'s look as before')
})

test('Q616 end to end: Main\'s escalate of the do keeps it for the recap (Route recap, Of set, its step marked, the hand-on line), out of Needs your attention; with Autopilot off, or of another goal, it is the person\'s', async t => {
  const files = () => ({ ...steps(), Q10, Q11: askText('Q11', { Title: 'Check the hedge', Owner: 'Checker', Asks: 'look', Of: 'B70', State: 'answered' }), Q1: main('Q1'), Q2: main('Q2', {}, { title: 'After the step in Q11, reopen the Q11 play link. [Q11](http://127.0.0.1:4310/#details=Q11)' }) })
  const dir = await storeWith(files())
  const off = await storeWith(files())
  t.after(() => Promise.all([dir, off].map(one => rm(one, { recursive: true, force: true }))))
  const kept = await chat(dir, 'Lead', { action: 'escalate', id: 'Q1', why: MAINS_WHY }, NOW, { autopilot: true })
  assert.equal(kept.ok, true, kept.why)
  assert.match(kept.result.text, /^Q1 waits for the goal's recap: Autopilot is on/)
  let items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Route'), field(items, 'Q1', 'Of'), field(items, 'Q1', 'Blocking')], ['recap', 'B56', 'no'])
  assert.deepEqual(items.get('Q1').sections.get('Route'), ['Kept for the goal\'s recap: the main chat handed it on'])
  assert.deepEqual(history(items, 'Q1').slice(-3), [`Lead: to the person: ${MAINS_WHY}`, 'server: autopilot: routed to recap', 'server: autopilot: put under B56, the step of the ask it links'])
  assert.ok(items.get('B56').sections.get('Context').some(line => line.trim() === 'Recap verdict: waits (Q1)'), 'its step is marked, as for any recap wait')
  assert.equal(isKeptLook(items.get('Q1')), true)
  // Out of Needs your attention; in the recap's list as a kept ask.
  const needsOf = list => storeNeeds({ ok: true, items: list }, { now: NOW + MIN, autopilot: true, roleOf: name => ROLES[name] ?? null, focusGoal: 'G29', focusHasDemo: true, recapSteps: RECAPS }).filter(one => one.answer === null).map(one => one.workId)
  assert.deepEqual(needsOf(items), [], 'Q1 waits for the recap, Q2 for the main chat')
  assert.deepEqual(routedAwayOf({ ok: true, items }).map(one => [one.id, one.route, one.of, one.goal, one.asks, one.isKept]).filter(one => one[0] === 'Q1'), [['Q1', 'recap', 'B56', 'G29', 'do', true]])
  // Another goal: the ask it links is of B70 (G30): handed on, the person's as always.
  const other = await chat(dir, 'Lead', { action: 'escalate', id: 'Q2', why: MAINS_WHY }, NOW, { autopilot: true })
  assert.equal(other.ok, true, other.why)
  items = await read(dir)
  assert.deepEqual([field(items, 'Q2', 'Route'), field(items, 'Q2', 'Of')], ['person', undefined])
  assert.deepEqual(needsOf(items), ['Q2'], 'a card for the person')
  assert.deepEqual(items.get('Q2').sections.get('Route'), [`The main chat hands this to you: ${MAINS_WHY}`])
  // Autopilot off: the person's, with the main chat's line, as always.
  const gone = await chat(off, 'Lead', { action: 'escalate', id: 'Q1', why: MAINS_WHY }, NOW)
  assert.equal(gone.ok, true, gone.why)
  const plain = await read(off)
  assert.deepEqual([field(plain, 'Q1', 'Route'), field(plain, 'Q1', 'Of')], ['person', undefined])
})

test('escalate stays the person\'s for a do that is no own-senses ask, words or a why that name the person\'s hands, the board\'s timeout and a Product owner\'s ask; the partner\'s do and the main chat\'s look are kept', async t => {
  const dir = await storeWith({
    ...steps(), Q10,
    Q1: main('Q1', { Of: 'B56' }, { title: 'Merge the pond branch.' }),
    Q2: main('Q2', { Of: 'B56' }, { title: 'Reopen the Q10 play link.' }),
    Q3: main('Q3', { Of: 'B56', Owner: 'Keeper' }, { title: 'Reopen the Q10 play link.' }),
    Q4: askText('Q4', { Title: 'Play the pond map.', Owner: 'Painter', Asks: 'do', Of: 'B56', Route: 'partner' }),
    Q5: askText('Q5', { Title: 'Does the pond look right?', Owner: 'Painter', Asks: 'look', Of: 'B56', Pictures: 'pictures/B56/a.png', Route: 'main' }),
    Q6: main('Q6', { Of: 'B56' }, { title: 'Reopen the Q10 play link.' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const esc = (who, id, why = MAINS_WHY) => chat(dir, who, { action: 'escalate', id, why }, NOW, { autopilot: true })
  for (const id of ['Q1', 'Q2', 'Q3', 'Q5']) assert.equal((await esc('Lead', id)).ok, true, id)
  assert.equal((await esc('Lead', 'Q6', 'Restart the Claude app, then reopen the play link.')).ok, true)
  assert.equal((await esc('Partner', 'Q4', 'Painter wants you to play the map.')).ok, true)
  const items = await read(dir)
  assert.deepEqual(['Q1', 'Q3', 'Q6'].map(id => field(items, id, 'Route')), ['person', 'person', 'person'], 'a chore, the Product owner\'s ask, the person\'s hands')
  assert.deepEqual(['Q2', 'Q4', 'Q5'].map(id => [field(items, id, 'Route'), items.get(id).sections.get('Route')[0]]), [
    ['recap', 'Kept for the goal\'s recap: the main chat handed it on'], ['recap', 'Kept for the goal\'s recap: your partner handed it on'], ['recap', 'Kept for the goal\'s recap: the main chat handed it on'],
  ])
  // The board's own timeout hands nothing on for the recap.
  const timeout = await storeWith({ ...steps(), Q10, Q7: main('Q7', { Of: 'B56' }, { title: 'Reopen the Q10 play link.' }) })
  t.after(() => rm(timeout, { recursive: true, force: true }))
  const late = await workApi({ action: 'escalate', id: 'Q7', why: 'the main chat did not do it in 30 min' }, ctx(timeout, NOW, 'server', { autopilot: true }))
  assert.equal(late.ok, true, late.why)
  assert.equal(field(await read(timeout), 'Q7', 'Route'), 'person')
})

test('the pass moves a do already escalated by the main chat or the partner (they carry the hand-on line), at every pass; never another goal\'s, one taken back, a chore, one of the hands', async t => {
  const dir = await storeWith({
    ...steps(), Q10, Q11: askText('Q11', { Title: 'Check the hedge', Owner: 'Checker', Asks: 'look', Of: 'B70', State: 'answered' }),
    Q1: handedByMain('Q1'),
    Q2: handedByMain('Q2', {}, { title: 'After the step in Q11, reopen the Q11 play link. [Q11](http://127.0.0.1:4310/#details=Q11)' }),
    Q3: askText('Q3', { Title: Q616, Asks: 'do', Route: 'person' }, { route: ['The person took it back from Autopilot (Undo)'], history: [`- ${at(70)} Lead: to the person: x`] }),
    Q4: handedByMain('Q4', { Of: 'B56' }, { title: 'Merge the pond branch.' }),
    Q5: handedByMain('Q5', {}, {}, 'It needs a sign-in to the art shop.'),
    Q6: askText('Q6', { Title: 'Play the pond map.', Owner: 'Painter', Asks: 'do', Of: 'B56', Route: 'person' }, { route: ['Your partner hands this to you: it needs your eyes'], history: [`- ${at(70)} Partner: to the person: it needs your eyes`] }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const before = Object.fromEntries(await Promise.all(['Q2', 'Q3', 'Q4', 'Q5'].map(async id => [id, await readFile(join(dir, `${id}.md`), 'utf8')])))
  const done = await pass(dir)
  assert.deepEqual(done.result.routed.map(one => one.id).sort(), ['Q1', 'Q6'])
  const items = await read(dir)
  assert.deepEqual([field(items, 'Q1', 'Route'), field(items, 'Q1', 'Of')], ['recap', 'B56'])
  assert.deepEqual(items.get('Q1').sections.get('Route'), ['Kept for the goal\'s recap: the main chat handed it on'])
  assert.deepEqual(items.get('Q6').sections.get('Route'), ['Kept for the goal\'s recap: your partner handed it on'])
  assert.deepEqual(history(items, 'Q1').slice(-3), [`Lead: to the person: ${MAINS_WHY}`, 'server: autopilot: routed to recap', 'server: autopilot: put under B56, the step of the ask it links'])
  assert.ok(items.get('B56').sections.get('Context').some(line => line.trim() === 'Recap verdict: waits (Q1)'))
  for (const [id, body] of Object.entries(before)) assert.equal(await readFile(join(dir, `${id}.md`), 'utf8'), body, `${id} is as it was`)
  assert.equal((await pass(dir, {}, NOW + 5 * MIN)).result.routed.length, 0, 'once')
  // Autopilot off: the pass moves nothing.
  const dir2 = await storeWith({ ...steps(), Q10, Q1: handedByMain('Q1') })
  t.after(() => rm(dir2, { recursive: true, force: true }))
  assert.deepEqual((await workApi({ action: 'autopilot', on: false }, ctx(dir2, NOW, 'server'))).result.routed, [])
})

// The recap card and the page: a kept do is a tile ("Also a look") and is answered in its window.
const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const HOUR = 60 * PAGE_MIN
const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm', '    Goal definition agreed: 2026-10-18 10:00',
  '    Part: Block 1 · about 1 h · steps B1 · done when: line 1', '    How agreed: 2026-10-18 11:00', ''].join('\n')
const GARDEN_PATH = 'pictures/g6/recap/demo.json'
const gardenTask = parseItem(`Id: B1\nKind: step\nTitle: Task B1\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(PAGE_NOW - 90 * PAGE_MIN)}\n\n## Context\n  Recap verdict: waits (Q1)\n`)
const gardenAsk = parseItem(`Id: Q1\nKind: ask\nTitle: Approve block 1 at 64 of 75?\nState: open\nOwner: Digger\nSince: ${sinceOf(PAGE_NOW - 40 * PAGE_MIN)}\nFiled: ${PAGE_NOW - 40 * PAGE_MIN}\nAsks: look\nBlocking: no\nOf: B1\nRoute: recap\n`)
const gardenDone = parseItem(`Id: B9\nKind: step\nTitle: Whole move squares\nState: done\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(PAGE_NOW - 9 * HOUR)}\n`)
const keptDo = parseItem(`Id: Q616\nKind: ask\nTitle: After the step in Q600, reopen the Q600 play link.\nState: open\nOwner: Lead\nSince: ${sinceOf(PAGE_NOW - 40 * PAGE_MIN)}\nFiled: ${PAGE_NOW - 40 * PAGE_MIN}\nAsks: do\nBlocking: no\nOf: B9\nRoute: recap\n\n## Text\nAfter the step in Q600, reopen the Q600 play link.\n\n## Route\nKept for the goal's recap: the main chat handed it on\n`)
const gardenState = () => asSent(build([gardenTask, gardenAsk, gardenDone, keptDo], undefined, GOALS, {
  recaps: [{ path: GARDEN_PATH, goal: 'G6', parts: [{ key: 'Block 1', title: 'Block 1', steps: ['B1'] }], rounds: [], changedAt: null }], goalRecap: { goal: 'G6', path: GARDEN_PATH, pictures: {} }, config: ON,
}))

test('the recap card lists the kept do as a tile ("Also a look: <its title> →") beside the recap\'s verdicts; its window holds Done and Send back, and Done answers it as a do is answered', async () => {
  const state = gardenState()
  assert.deepEqual(state.routedAway.filter(one => one.id === 'Q616').map(one => [one.route, one.asks, one.isKept]), [['recap', 'do', true]])
  assert.equal(state.recapCard.count, 2, 'the part, and the kept do')
  assert.deepEqual(state.recapCard.looks.map(one => [one.title, one.target]), [['After the step in Q600, reopen the Q600 play link.', { ask: 'Q616' }]])
  const page = await openPage({ state })
  try {
    assert.deepEqual(page.all('#needs .recap-attention-look').map(link => link.textContent), ['Also a look: After the step in Q600, reopen the Q600 play link. →'])
    assert.equal(page.text('#needs-count'), '1', 'the recap card counts as one; the kept do is no second card')
    await page.click('#needs .recap-attention-look')
    assert.equal(page.find('#details').open, true)
    assert.match(page.text('#details'), /Q616/)
    assert.deepEqual(page.all('#details .look-answer-note, #details [data-look-answer]').map(node => node.dataset.lookAnswer ?? node.tagName), ['TEXTAREA', 'reject', 'done'])
    await page.click('#details [data-look-answer="done"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'answer', id: 'Q616', verdict: 'done', text: '' }])
  } finally { await page.close() }
  // Mid-goal (nothing else waits): the kept do waits quietly, its window still answers it.
  const quiet = asSent(build([gardenDone, keptDo], undefined, GOALS, { recaps: [], goalRecap: { goal: 'G6', path: GARDEN_PATH, pictures: {} }, config: ON }))
  assert.equal(quiet.recapCard, null)
  const window = await openPage({ state: quiet, hash: 'details=Q616' })
  try {
    await settle(10)
    assert.deepEqual(window.all('#details [data-look-answer]').map(node => node.dataset.lookAnswer), ['reject', 'done'])
  } finally { await window.close() }
})

test('the person\'s Done on a kept do closes it with their words and marks its step approved, like a look\'s Looks right', async t => {
  const dir = await storeWith({ ...steps(), Q10, Q1: askText('Q1', { Title: Q616, Asks: 'do', Of: 'B56', Route: 'recap' }, { route: [handedOnKeptWords('main')] }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await workApi({ action: 'answer', id: 'Q1', verdict: 'done', text: 'Opened it.' }, ctx(dir, NOW + MIN, 'person'))
  assert.equal(done.ok, true, done.why)
  const items = await read(dir)
  assert.equal(field(items, 'Q1', 'State'), 'answered')
  assert.deepEqual(items.get('Q1').sections.get('Answer'), ['Done. Opened it.'])
  assert.ok(items.get('B56').sections.get('Context').some(line => line.trim() === 'Recap verdict: approved (Q1)'))
})

// ---------------------------------------------------------------------------------------------------------------------
// 3. A question the recap has answered closes

const ROW9 = '9. Tall props in front of units (Terraces)'
const ROW10 = '10. Bridges over lava: the Shrine\'s four stone walkways'
/** The recap's rows as the board keeps them: row 9 approved in round 2 (sent back in round 1, no step shown), row 10 sent back in round 1 and not yet reworked, row 11 not judged. */
const ROWS = [
  { goal: 'G29', path: PATH, key: ROW9, title: ROW9, steps: [], verdict: 'approved', round: 2 },
  { goal: 'G29', path: PATH, key: ROW10, title: ROW10, steps: ['B923'], verdict: 'sent-back', round: 1 },
  { goal: 'G29', path: PATH, key: '11. Round shapes', title: '11. Round shapes', steps: ['B56'], verdict: null, round: null },
  { goal: 'G29', path: PATH, key: '12. Cliffs', title: '12. Cliffs', steps: ['B57'], verdict: 'approved', round: 2 },
]
/** The live Q595's shape: Worker 1's do under B921, its words naming row 9 in the focus goal's recap; routed to the person by the board itself. */
const Q595 = (id = 'Q595', fields = {}, words = null) => askText(id, {
  Title: 'Look at the three pictures and give your verdict on row 9 in G29\'s recap: [pictures](http://127.0.0.1:4310/#details=B921)', Owner: 'Painter', Asks: 'do', Of: 'B921', Route: 'person', ...fields,
}, { words, history: [`- ${at(70)} server: autopilot: routed to person`] })
const world3 = () => ({ ...steps(), B921: step('B921', { Title: 'Tall props, three tries', State: 'review', Owner: 'Painter', Goal: 'G29' }), B57: step('B57', { Title: 'Cliffs', State: 'review', Owner: 'Painter', Goal: 'G29' }) })
const APPROVED_WORDS = `Approved in the recap of G29, round 2: ${ROW9}.`

test('the recap rows: every row with its standing verdict, also one that shows no step; the number a title and the words of an ask name', () => {
  const recaps = [{
    goal: 'G29', path: PATH, parts: [{ key: ROW10, title: ROW10, steps: ['B923'] }], rows: [{ key: ROW9, title: ROW9, steps: [] }, { key: ROW10, title: ROW10, steps: ['B923'] }, { key: '11. Round shapes', title: '11. Round shapes', steps: ['B56'] }],
    rounds: [
      { n: 1, at: '2026-11-02 16:17', parts: [{ key: ROW9, verdict: 'sent-back', comment: 'x' }, { key: ROW10, verdict: 'sent-back', comment: 'y' }] },
      { n: 2, at: '2026-11-02 23:20', parts: [{ key: ROW9, verdict: 'approved', comment: '' }] },
    ],
  }]
  assert.deepEqual(recapVerdictsOf(recaps).map(one => [one.key, one.verdict, one.round]), [[ROW9, 'approved', 2], [ROW10, 'sent-back', 1], ['11. Round shapes', null, null]])
  assert.deepEqual(recapVerdictsOf([{ goal: 'G7', path: 'p', parts: [{ key: 'a', title: 'a', steps: ['B1'] }], rounds: [] }]).map(one => [one.key, one.verdict]), [['a', null]], 'a recap with parts only')
  assert.deepEqual(recapVerdictsOf(null), [])
  assert.equal(rowNumberOfTitle(ROW9), 9)
  assert.equal(rowNumberOfTitle('Round shapes'), null)
  const words = 'Look at the three pictures and give your verdict on row 9 in G60\'s recap: [pictures](http://127.0.0.1:4310/#details=B921)'
  assert.equal(recapRowNumberOf(words, 'G60'), 9)
  assert.equal(recapRowNumberOf(words, 'G29'), null, 'it names the recap of another goal')
  assert.equal(recapRowNumberOf('Row 9 of the recap: is it right?', 'G60'), 9, 'no goal named: the focus goal\'s')
  assert.equal(recapRowNumberOf('Give your verdict on rows 9 and 10 in the recap.', 'G60'), null, 'two rows')
  assert.equal(recapRowNumberOf('Look at row 9 in the pond map.', 'G60'), null, 'no recap')
  assert.equal(recapRowNumberOf('G60\'s recap, row 12: right? Row 12 is the cliffs.', 'G60'), 12)
})

test('Q595\'s shape (a do under B921 naming "row 9 in G29\'s recap", row 9 approved in round 2): the pass closes it with the recap\'s words and wakes its chat; a row sent back or not judged stays', async t => {
  const dir = await storeWith({
    ...world3(),
    Q1: Q595('Q1'),
    // Row 10 is sent back and not reworked; row 11 is not judged yet; a recap of another goal; a row nobody has.
    Q2: Q595('Q2', { Title: 'Give your verdict on row 10 in G29\'s recap.' }),
    Q3: Q595('Q3', { Title: 'Give your verdict on row 11 in G29\'s recap.' }),
    Q4: Q595('Q4', { Title: 'Give your verdict on row 9 in G7\'s recap.' }),
    Q5: Q595('Q5', { Title: 'Give your verdict on row 99 in G29\'s recap.' }),
    // The person took it back; the app's form; a decide; a question about the row that is no verdict.
    Q6: askText('Q6', { Title: 'Give your verdict on row 9 in G29\'s recap.', Owner: 'Painter', Asks: 'do', Route: 'person' }, { route: ['The person took it back from Autopilot (Undo)'], history: [`- ${at(70)} Painter: asked`] }),
    Q7: Q595('Q7', { Via: 'form' }),
    Q8: Q595('Q8', { Asks: 'decide', Options: 'A round | B square', Title: 'Row 9 in G29\'s recap: round or square props?' }),
    Q9: Q595('Q9', { Asks: 'provide', Title: 'Provide the picture for row 9 in G29\'s recap.' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const before = Object.fromEntries(await Promise.all(['Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].map(async id => [id, await readFile(join(dir, `${id}.md`), 'utf8')])))
  const done = await pass(dir, {}, NOW, { recapRows: ROWS })
  assert.equal(done.ok, true, done.why)
  assert.deepEqual(done.result.recapClosed, ['Q1'])
  assert.match(done.result.text, /closed by the recap: Q1/)
  assert.deepEqual(done.result.wakes.map(one => [one.to, one.id, one.text]), [['Painter', 'Q1', `The person answered this in the goal's recap: ${APPROVED_WORDS}`]])
  const items = await read(dir)
  assert.equal(field(items, 'Q1', 'State'), 'answered')
  assert.deepEqual(items.get('Q1').sections.get('Answer'), [APPROVED_WORDS])
  assert.ok(history(items, 'Q1').includes(`server: closed by the goal's recap: ${APPROVED_WORDS}`))
  assert.ok(items.get('B921').sections.get('Context').some(line => line.includes('Q1 closed by the recap of G29')), 'its step is told in one line')
  assert.ok(!items.get('B921').sections.get('Context').some(line => line.includes('Recap verdict')), 'no verdict line for an ask that was not routed to the recap')
  for (const [id, body] of Object.entries(before)) assert.equal(await readFile(join(dir, `${id}.md`), 'utf8'), body, `${id} stays as it was`)
  assert.deepEqual((await pass(dir, {}, NOW + 5 * MIN, { recapRows: ROWS })).result.recapClosed, [], 'once')
})

test('the pass closes only for the focus goal\'s recap, while Autopilot is on; without rows nothing closes', async t => {
  const make = () => storeWith({ ...world3(), Q1: Q595('Q1') })
  const [a, b, c, d] = await Promise.all([make(), make(), make(), make()])
  t.after(() => Promise.all([a, b, c, d].map(one => rm(one, { recursive: true, force: true }))))
  assert.deepEqual((await workApi({ action: 'autopilot', on: false }, ctx(a, NOW, 'server', { recapRows: ROWS }))).result.recapClosed ?? [], [], 'Autopilot off')
  assert.deepEqual((await pass(b, {}, NOW, { recapRows: ROWS, focusGoal: 'G30' })).result.recapClosed, [], 'the recap of G29 is not the focus goal\'s now')
  assert.deepEqual((await pass(c, {}, NOW, { recapRows: [] })).result.recapClosed, [])
  assert.deepEqual((await pass(d, {}, NOW, { recapRows: undefined })).result.recapClosed, [])
  for (const dir of [a, b, c, d]) assert.equal(field(await read(dir), 'Q1', 'State'), 'open')
})

test('a question waiting in the recap under a step closes at the pass when every row naming the step is approved; one row not approved keeps it', async t => {
  const dir = await storeWith({
    ...world3(),
    // B57 is shown by row 12 (approved); B56 by row 11 (not judged); B923 by row 10 (sent back).
    Q1: askText('Q1', { Title: 'Does the cliff read right?', Owner: 'Painter', Asks: 'look', Of: 'B57', Route: 'recap' }, { route: [handedOnKeptWords('partner')] }),
    Q2: askText('Q2', { Title: 'Does the pond read right?', Owner: 'Painter', Asks: 'look', Of: 'B56', Route: 'recap' }),
    Q3: askText('Q3', { Title: 'Do the bridges read right?', Owner: 'Painter', Asks: 'look', Of: 'B57', Route: 'person' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const two = [...ROWS, { goal: 'G29', path: PATH, key: '13. Cliffs again', title: '13. Cliffs again', steps: ['B57'], verdict: 'sent-back', round: 2 }]
  assert.deepEqual((await pass(dir, {}, NOW, { recapRows: two })).result.recapClosed, [], 'a second row naming B57 is sent back')
  const done = await pass(dir, {}, NOW + MIN, { recapRows: ROWS })
  assert.deepEqual(done.result.recapClosed, ['Q1'], 'only the ask waiting in the recap, of an approved row')
  const items = await read(dir)
  assert.deepEqual(items.get('Q1').sections.get('Answer'), ['Approved in the recap of G29, round 2: 12. Cliffs.'])
  assert.ok(items.get('B57').sections.get('Context').some(line => line.trim() === 'Recap verdict: approved (Q1)'))
  assert.equal(field(items, 'Q2', 'State'), 'open')
  assert.equal(field(items, 'Q3', 'State'), 'open', 'a person\'s ask under the step is not a recap wait')
})

test('the recap\'s Send closes the question that names a judged row, approved or sent back, with the recap\'s words, and wakes its chat; only for the focus goal\'s recap, while Autopilot is on', async t => {
  const dir = await storeWith({ ...world3(), Q1: Q595('Q1'), Q2: Q595('Q2', { Title: 'Give your verdict on row 10 in G29\'s recap.' }), Q3: Q595('Q3', { Title: 'Give your verdict on row 11 in G29\'s recap.' }) })
  const off = await storeWith({ ...world3(), Q1: Q595('Q1') })
  const other = await storeWith({ ...world3(), Q1: Q595('Q1') })
  t.after(() => Promise.all([dir, off, other].map(one => rm(one, { recursive: true, force: true }))))
  const parts = [{ key: ROW9, title: ROW9, verdict: 'approved', steps: [] }, { key: ROW10, title: ROW10, verdict: 'sent-back', comment: 'not a square map', steps: ['B923'] }]
  const sent = await workApi({ action: 'recap-answered', goal: 'G29', round: 3, path: PATH, parts }, ctx(dir, NOW + MIN, 'server', { autopilot: true }))
  assert.equal(sent.ok, true, sent.why)
  assert.deepEqual(sent.result.closed, ['Q1', 'Q2'])
  assert.deepEqual(sent.result.wakes.map(one => [one.to, one.id, one.text]), [
    ['Painter', 'Q1', `The person answered this in the goal's recap: Approved in the recap of G29, round 3: ${ROW9}.`],
    ['Painter', 'Q2', `The person answered this in the goal's recap: Sent back in the recap of G29, round 3: ${ROW10}: "not a square map"`],
  ])
  const items = await read(dir)
  assert.deepEqual(items.get('Q1').sections.get('Answer'), [`Approved in the recap of G29, round 3: ${ROW9}.`])
  assert.deepEqual(items.get('Q2').sections.get('Answer'), [`Sent back in the recap of G29, round 3: ${ROW10}: "not a square map"`])
  assert.equal(field(items, 'Q3', 'State'), 'open', 'row 11 was not judged')
  // Autopilot off, or the recap of another goal: nothing closes.
  assert.deepEqual((await workApi({ action: 'recap-answered', goal: 'G29', round: 3, path: PATH, parts }, ctx(off, NOW + MIN, 'server'))).result.closed, [])
  assert.deepEqual((await workApi({ action: 'recap-answered', goal: 'G29', round: 3, path: PATH, parts }, ctx(other, NOW + MIN, 'server', { autopilot: true, focusGoal: 'G30' }))).result.closed, [])
  assert.equal(field(await read(off), 'Q1', 'State'), 'open')
})

test('recapClosesAsk: pure rules; an ask the person took back, a form, a refine question and a goal that is no focus close nothing', () => {
  const rows = ROWS
  const ask = (fields = {}, route = []) => parseItem(Q595('Q1', fields, null).replace('## History', route.length === 0 ? '## History' : `## Route\n${route.join('\n')}\n\n## History`))
  assert.equal(recapClosesAsk(ask(), { focusGoal: 'G29', rows })?.key, ROW9)
  assert.equal(recapClosesAsk(ask(), { focusGoal: 'G30', rows }), null)
  assert.equal(recapClosesAsk(ask(), { focusGoal: null, rows }), null)
  assert.equal(recapClosesAsk(ask({ State: 'answered' }), { focusGoal: 'G29', rows }), null)
  assert.equal(recapClosesAsk(ask({ Via: 'refine' }), { focusGoal: 'G29', rows }), null)
  assert.equal(recapClosesAsk(ask({}, ['Your partner had answered: x; you took it back']), { focusGoal: 'G29', rows }), null)
  assert.equal(recapClosesAsk(ask({ Asks: 'look' }), { focusGoal: 'G29', rows })?.key, ROW9)
  assert.equal(recapClosesAsk(ask({ Via: 'accept', Asks: 'decide' }), { focusGoal: 'G29', rows })?.key, ROW9, 'the board\'s Accept card names the row too')
  assert.equal(recapClosesAsk(ask({ Title: 'Give your verdict on row 10 in G29\'s recap.' }), { focusGoal: 'G29', rows }), null, 'sent back: judged anew')
  assert.equal(recapClosesAsk(ask(), { focusGoal: 'G29', rows: [...rows, { ...rows[0], key: 'x', path: 'p2' }] }), null, 'two recaps with a row 9: not sure which')
})
