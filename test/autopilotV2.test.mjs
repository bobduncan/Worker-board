// Autopilot v2 (the person, 2026-11-02 ~22:30, in the Supervisor chat: "you can auto approve and manage my needs attention.
// everything except the goal recap/verdict. autopilot doesnt help me enough i still get way too many signels"; their choice "B"):
// only a goal's recap and its verdicts, a goal's start (its definition, work blocks and Go) and a switch of focus reach them as
// cards; what only their hands can do stands as one quiet line; everything else is decided for them with Undo. The route of each
// live example of that night (twins of their shapes, made-up words where they named the project), the board's pass that judges
// anew what it routed to the person itself, and Needs your attention as the page draws it.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { adviceAnswerOf, autopilotRoute, isBoardRoutedPerson } from '../src/work/autopilot.mjs'
import { parseConfig } from '../src/config.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, share } from '../src/work/store.mjs'
import { answer, typed } from '../fixtures/lines.mjs'
import { openPage } from './pageHarness.mjs'
import { MIN as PAGE_MIN, NOW as PAGE_NOW, RUN_GOALS, app, asSent, sinceOf, tail } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 22, 30).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** An item file's text from its head fields and its sections. */
function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
/** An open ask the board routed to the person itself (its History's line, no card line), `minutes` ago. */
const askText = (id, fields, { words = null, history = ['person'], card = null, minutes = 50 } = {}) => text(
  { Id: id, Kind: 'ask', Title: fields.Title, State: 'open', Since: at(minutes), Filed: String(NOW - minutes * MIN), Blocking: 'no', ...fields },
  { Text: [words ?? fields.Title], ...(card === null ? {} : { Route: [card] }), History: [`- ${at(minutes)} ${fields.Owner ?? 'server'}: asked (${fields.Asks ?? 'decide'})`, ...history.map(to => `- ${at(minutes)} server: autopilot: routed to ${to}`)] })
const ask = (...args) => parseItem(askText(...args))
const stepText = (id, fields) => text({ Id: id, Kind: 'step', Activity: 'Board', Since: at(90), ...fields }, { History: [`- ${at(90)} Main: made`] })

// The night's chats: Worker 5 a worker, the Advisor the partner, Main the main chat; G60 the focus goal, B821 a step of it, B891 a
// step of G15 (not the focus) in review whose fix was dropped; Q588 the person's answer of 21:20 that named B891.
const ROLES = { 'Worker 5': 'worker', Advisor: 'advisor', Main: 'main' }
const B821 = parseItem(stepText('B821', { Title: 'Fix: the ring reads round', State: 'review', Owner: 'Worker 5', Goal: 'G60' }))
const B891 = parseItem(stepText('B891', { Title: 'A word in doubt waits 5 minutes', State: 'review', Owner: 'Worker 2', Goal: 'G15' }))
const Q588 = parseItem(text({ Id: 'Q588', Kind: 'ask', Title: 'Rebuild G15: leave the stuck-message fix to the board\'s waking change?', State: 'answered', Owner: 'Advisor', Since: at(70), Asks: 'decide', Of: 'G15' },
  { Text: ['Rebuild G15: B880 and B891 ...'], Answer: ['C Stop here and hand it over (no build): keep what is built for B880 and B891'] }))
const items = (...more) => new Map([B821, B891, ...more].map(one => [one.head.get('Id'), one]))
const ctx = (more = {}) => ({ roleOf: name => ROLES[name] ?? null, items: items(Q588), focusGoal: 'G60', now: NOW, ...more })

// Twins of the live asks of 22:30.
const Q593 = ask('Q593', { Title: 'Look at the whole ring in the game; scroll with the right mouse button.', Owner: 'Worker 5', Asks: 'do', Via: 'chat', Route: 'person' })
const Q602 = ask('Q602', { Title: 'After that, reopen the Q600 play link.', Owner: 'Worker 5', Asks: 'do', Via: 'chat' }, { history: [] })
const Q601 = ask('Q601', { Title: 'May I stop the game on port 5300 and delete the board\'s old game cache (`worker-board/data/game-cache/lava-tactics`)?', Owner: 'Worker 5', Asks: 'decide', Of: 'B821', Advice: 'yes', Via: 'chat', Route: 'person' },
  { words: 'May I stop the game on port 5300 and delete the board\'s old game cache (`worker-board/data/game-cache/lava-tactics`)? It rebuilds by itself, so I advise yes. Or run the two commands below yourself: ```bash taskkill //PID 31484 //F ``` ```bash rm -rf /c/Web/game/worker-board/data/game-cache/lava-tactics ```' })
const Q605 = ask('Q605', { Title: 'Rebuild G60: which way for the Ring\'s thick, round ring?', Owner: 'Advisor', Asks: 'decide', Blocking: 'yes', Of: 'G60', Route: 'person',
  Options: 'A A thick ring, the round pool kept (about 3 h) | B Designed for its fight by the map guide (about 4.5 h) | C The round edge judged alone (about 1 h now)', Advice: 'A' },
{ words: 'Rebuild G60: which way for the Ring\'s thick, round ring? Both tries grew the lava pool, so the circle reads round now, but the ring stayed 2 cells at its narrowest.' })
const Q606 = ask('Q606', { Title: 'Give G29\'s new plan your Go on the Goals page', Owner: 'Advisor', Asks: 'do', Via: 'chat', Route: 'person' },
  { words: 'Give G29\'s new plan your Go on the Goals page [Open G29 on Goals](http://127.0.0.1:4310/#advice/goals/G29)' })
const Q608 = ask('Q608', { Title: 'Accept B891, or send it back?', Asks: 'decide', Of: 'B891', Options: 'A Accept: done as it is | B Send back: the partner makes another try from your note', Via: 'accept', Route: 'person' },
  { words: 'B891 stays in review: its fix B900 was dropped by Main, and only you close a result below its bar.' })
const Q612 = ask('Q612', { Title: 'Accept B944 as it is (branch unmerged, lands inside Workers mod 0.30.0)?', Owner: 'Main', Asks: 'decide', Advice: 'yes', Via: 'chat', Route: 'person' },
  { words: 'Accept B944 as it is (branch unmerged, lands inside Workers mod 0.30.0)? I advise yes; the board development chat asks for it.' })

test('the route of each live example of 2026-11-02 under v2: a look to the partner, a do to the main chat, advice taken, an accept to the partner, a goal\'s Go and the hands to the person, a recap verdict to the recap', () => {
  const again = ctx({ again: true })
  // Q593, a worker's do of the person's own eyes (it was the person's): the partner judges it by the evidence.
  assert.deepEqual(autopilotRoute(Q593, again), { to: 'partner', why: 'the person\'s own eyes, ears or words: the partner judges it by the evidence' })
  assert.equal(isBoardRoutedPerson(Q593), true)
  // Q602, a do a chat can carry out: the main chat, as before.
  assert.equal(autopilotRoute(Q602, ctx()).to, 'main')
  // Q601, a worker's decide with advice under a step (it was the person's: "delete" made it a permanent delete): a cache rebuilds
  // by itself, so it is no delete for good, and the board takes the advice. A delete for good stays the person's hands.
  assert.deepEqual(autopilotRoute(Q601, again), { to: 'advice', why: 'a detail question: its advice is taken' })
  const folder = ask('Q609', { Title: 'May I delete the old save folder of the game?', Owner: 'Worker 5', Asks: 'decide', Of: 'B821', Advice: 'yes', Via: 'chat' }, { history: [] })
  assert.deepEqual(autopilotRoute(folder, ctx()), { to: 'person', why: 'only the person\'s hands: a permanent delete ("delete")', hands: 'a permanent delete' })
  // Q605, the partner's rebuild of the focus goal with advice A (it was the person's: "Autopilot approves no rebuild"): taken.
  assert.deepEqual(autopilotRoute(Q605, again), { to: 'advice', why: 'a detail question: its advice is taken' })
  assert.equal(adviceAnswerOf(Q605), 'A: A thick ring, the round pool kept (about 3 h)')
  // ... while a rebuild of a goal that is not the focus is a goal's start: the person's.
  assert.deepEqual(autopilotRoute(Q605, ctx({ again: true, focusGoal: 'G29' })), { to: 'person', why: 'a goal\'s start or a focus switch ("of G60")' })
  // "Accept B944 as it is?", Main's decide with advice yes (it was the person's): the advice is taken.
  assert.deepEqual(autopilotRoute(Q612, again), { to: 'advice', why: 'a verdict on a result ("Accept"): its advice is taken' })
  // Q608, the board's Accept card of a step of a goal that is not the focus (it was the person's, unless an earlier answer named
  // it): the partner judges it; the person's earlier answer on Q588 is its hint, not its condition.
  assert.deepEqual(autopilotRoute(Q608, again), { to: 'partner', why: 'the person\'s earlier answer on Q588 names B891', earlier: 'Q588' })
  assert.deepEqual(autopilotRoute(Q608, { ...again, items: items() }), { to: 'partner', why: 'an accept or send back below its target, and its step is of no focus goal: the partner decides it' })
  // Q606, "Give G29's new plan your Go": a goal's start; with G29 the focus its Go and new plan still are.
  assert.deepEqual(autopilotRoute(Q606, again), { to: 'person', why: 'a goal\'s start or a focus switch ("G29")' })
  assert.deepEqual(autopilotRoute(Q606, { ...again, focusGoal: 'G29' }), { to: 'person', why: 'a goal\'s start or a focus switch ("new plan")' })
  assert.equal(autopilotRoute(ask('Q620', { Title: 'Switch the focus to G29 now?', Owner: 'Advisor', Asks: 'decide', Advice: 'yes' }, { history: [] }), ctx({ focusGoal: 'G29' })).to, 'person', 'a focus switch')
  // A "Sign in" do: the person's hands, drawn as one line (`hands`).
  assert.deepEqual(autopilotRoute(ask('Q621', { Title: 'Sign in the Claude command line once', Owner: 'Worker 5', Asks: 'do', Via: 'chat' }, { history: [] }), ctx()),
    { to: 'person', why: 'only the person\'s hands: a sign-in ("Sign in")', hands: 'a sign-in' })
  // A recap verdict: the Accept card of a step of the focus goal waits for the goal's recap, as before.
  const card = ask('Q622', { Title: 'Accept B821 at 69 of 75, or send it back?', Asks: 'decide', Of: 'B821', Options: 'A Accept: done as it is | B Send back', Via: 'accept' }, { history: [] })
  assert.deepEqual(autopilotRoute(card, ctx()), { to: 'recap', why: 'an accept or send back below its target' })
  // "Did we reach the goal?" is the recap's: the person's.
  assert.deepEqual(autopilotRoute(ask('Q623', { Title: 'Did we reach the goal?', Owner: 'Advisor', Asks: 'decide', Advice: 'yes' }, { history: [] }), ctx()), { to: 'person', why: 'the goal\'s recap ("Did we reach the goal")' })
})

test('what Autopilot v2 never decides for the person: an ask somebody handed on or the person took back, the app\'s form, Fable, a publish', () => {
  // The coordinator's ruling (2026-11-02): publishing stays the person's, as their hands, under a step or not, whatever the advice.
  const publish = more => ask('Q635', { Title: 'Publish the repository under the MIT license?', Owner: 'Advisor', Asks: 'decide', Advice: 'yes', ...more }, { history: [] })
  assert.deepEqual(autopilotRoute(publish(), ctx()), { to: 'person', why: 'only the person\'s hands: a publish ("Publish")', hands: 'a publish' })
  assert.equal(autopilotRoute(publish({ Owner: 'Worker 5', Of: 'B821' }), ctx()).hands, 'a publish', 'under a step too')
  for (const title of ['Make the game repository public?', 'Cut a new release of the game for itch.io?', 'Post the trailer on Reddit?', 'Which licence for the sound pack?', 'Share the build with the world?', 'Share the build publicly?']) {
    assert.equal(autopilotRoute(ask('Q636', { Title: title, Owner: 'Worker 5', Asks: 'decide', Of: 'B821', Advice: 'yes', Via: 'chat' }, { history: [] }), ctx()).hands, 'a publish', title)
  }
  // Not a publish: a lock released, a post of the board's, sharing inside the board.
  for (const title of ['Release the lock on the store and go on?', 'Share the picture with the partner?', 'Keep the public board settings as they are?']) {
    assert.equal(autopilotRoute(ask('Q637', { Title: title, Owner: 'Worker 5', Asks: 'decide', Of: 'B821', Advice: 'yes', Via: 'chat' }, { history: [] }), ctx()).to, 'advice', title)
  }
  const handed = ask('Q630', { Title: 'Icons or words on the bar?', Owner: 'Worker 5', Asks: 'decide', Options: 'A icons | B words', Advice: 'A', Route: 'person' }, { card: 'The main chat hands this to you: only you can open it' })
  assert.deepEqual(autopilotRoute(handed, ctx({ again: true })), { to: 'person', why: 'handed to the person' })
  const taken = ask('Q631', { Title: 'Icons or words on the bar?', Owner: 'Worker 5', Asks: 'decide', Options: 'A icons | B words', Advice: 'A', Route: 'person' }, { card: 'Decided for you (Autopilot): A; you took it back' })
  assert.equal(autopilotRoute(taken, ctx({ again: true })).to, 'person')
  assert.equal(autopilotRoute(ask('Q632', { Title: 'Icons or words?', Owner: 'Worker 5', Asks: 'decide', Advice: 'A', Via: 'form' }, { history: [] }), ctx()).to, 'person')
  // Never Fable without the person's yes (2026-10-24): whatever its advice.
  assert.deepEqual(autopilotRoute(ask('Q633', { Title: 'Evaluate G60 with Fable 5.1 at max?', Owner: 'Advisor', Asks: 'decide', Of: 'G60', Advice: 'yes' }, { history: [] }), ctx()), { to: 'person', why: 'only the person says yes to Fable' })
  assert.equal(autopilotRoute(ask('Q634', { Title: 'Which model for the evaluation?', Asks: 'decide', Of: 'G60', Options: 'A Yes: Fable 5.1 (max), only for this evaluation | B No: Opus 5.5 (max)' }, { history: [] }), ctx()).to, 'person')
})

// ---------------------------------------------------------------------------------------------------------------------
// The pass.

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'autopilot-v2-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Board', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}
const apiCtx = (dir, now) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G60', pictureProblem: async () => null, as: 'server' })

test('every pass (not only the switch-on\'s sweep) judges anew a Q593-shaped ask the board routed to the person; one a chat handed on stays theirs', async t => {
  const dir = await storeWith({
    B821: stepText('B821', { Title: 'Fix: the ring reads round', State: 'in progress', Owner: 'Worker 5', Goal: 'G60' }),
    Q593: askText('Q593', { Title: 'Look at the whole ring in the game; scroll with the right mouse button.', Owner: 'Worker 5', Asks: 'do', Via: 'chat', Route: 'person' }),
    Q594: askText('Q594', { Title: 'Look at the whole ring in the game; scroll with the right mouse button.', Owner: 'Worker 5', Asks: 'do', Via: 'chat', Route: 'person' },
      { history: ['main'], card: 'The main chat hands this to you: opening the game in your browser is yours' }),
    Q612: askText('Q612', { Title: 'Accept B944 as it is (branch unmerged)?', Owner: 'Main', Asks: 'decide', Advice: 'yes', Via: 'chat', Route: 'person' }),
    Q621: askText('Q621', { Title: 'Sign in the Claude command line once', Owner: 'Worker 5', Asks: 'do', Via: 'chat', Route: 'person' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const pass = await workApi({ action: 'autopilot', on: true }, apiCtx(dir, NOW))
  assert.equal(pass.ok, true, pass.why)
  assert.deepEqual(pass.result.routed, [{ id: 'Q593', to: 'partner' }, { id: 'Q612', to: 'advice' }])
  assert.deepEqual(pass.result.answered, ['Q612'], 'the advice is taken in the same pass')
  const store = (await readStore(dir)).items
  assert.deepEqual(['Q593', 'Q594', 'Q612', 'Q621'].map(id => store.get(id).head.get('Route')), ['partner', 'person', 'advice', 'person'])
  assert.equal(store.get('Q612').head.get('Answered by'), 'autopilot')
  assert.deepEqual(store.get('Q594').sections.get('Route'), ['The main chat hands this to you: opening the game in your browser is yours'], 'the hand-over stands')
  assert.equal((store.get('Q593').sections.get('History') ?? []).filter(line => line.includes('autopilot: routed to partner')).length, 1)
  // The next pass routes nothing again.
  const next = await workApi({ action: 'autopilot', on: true }, apiCtx(dir, NOW + 5 * MIN))
  assert.deepEqual(next.result.routed, [])
  // Off: nothing is judged anew.
  const offDir = await storeWith({ Q593: askText('Q593', { Title: 'Look at the whole ring in the game.', Owner: 'Worker 5', Asks: 'do', Via: 'chat', Route: 'person' }) })
  t.after(() => rm(offDir, { recursive: true, force: true }))
  assert.deepEqual((await workApi({ action: 'autopilot', on: false }, apiCtx(offDir, NOW))).result.routed, [])
})

// ---------------------------------------------------------------------------------------------------------------------
// The page.

const script = readFileSync(new URL('../public/board.js', import.meta.url), 'utf8')
const cutLine = script.split('\n').find(line => line.startsWith('const cutWords = '))
const views = vm.runInNewContext(`${cutLine}\n${script.slice(script.indexOf('// handsline:start'), script.indexOf('// handsline:end'))}
${script.slice(script.indexOf('// supervisor:start'), script.indexOf('// supervisor:end'))}
;({ handsNeedsOf, handsLineView, attentionSupervisorLine, isHandedAlarm })`, {})
const plain = value => JSON.parse(JSON.stringify(value))

test('the hands line\'s view: only while Autopilot is on, open and unanswered; each title cut at 40 and opening its ask; amber only when one blocks a step', () => {
  const need = (id, title, more = {}) => ({ id: `work:${id}`, workId: id, title, hands: 'a sign-in', answer: null, isClosed: false, blocking: false, ...more })
  const list = [need('Q2', 'Sign in to the seed shop account'), need('Q3', 'Pay the hosting bill for the garden site before the end of the month', { hands: 'money' }), need('Q4', 'Icons or words?', { hands: null }), need('Q5', 'Log in', { answer: { at: 1 } })]
  assert.deepEqual(plain(views.handsNeedsOf(list, false)), [], 'off: every ask is a card')
  assert.deepEqual(plain(views.handsNeedsOf(list, true).map(one => one.workId)), ['Q2', 'Q3'])
  const view = plain(views.handsLineView(views.handsNeedsOf(list, true)))
  assert.deepEqual(view.items.map(one => [one.id, one.words, one.href]), [['Q2', 'Sign in to the seed shop account', '#details=Q2'], ['Q3', 'Pay the hosting bill for the garden…', '#details=Q3']])
  assert.equal(view.isBlocking, false)
  assert.equal(views.handsLineView([need('Q2', 'Sign in', { blocking: true })]).isBlocking, true)
  assert.equal(views.handsLineView([]), null)
})

test('the Supervisor\'s line under Autopilot: its findings leave Needs your attention; an alarm handed to the person stays as one line, counted', () => {
  const note = (id, words, more = {}) => ({ id, via: 'supervisor', text: words, isRead: false, ...more })
  const finding = note('N1', 'Supervisor: X12 came back: Worker 2 works with no step')
  const escalation = note('N2', 'Incident X13 "Worker 3 is quiet" has been with the Supervisor for over 2 hours without a close or a fix: look at it under Supervisor.')
  const hands = note('N3', 'Supervisor: X14 needs your hands: the Workers mod must be updated by you')
  // Off: as before, every unread finding, never counted.
  assert.deepEqual(plain(views.attentionSupervisorLine([finding, escalation], false)), { ids: ['N1', 'N2'], text: 'Supervisor: 2 new findings' })
  // On: no line for findings; the alarms handed to the person, counted (`isHanded`).
  assert.equal(views.attentionSupervisorLine([finding], true), null)
  assert.deepEqual(plain(views.attentionSupervisorLine([finding, escalation, hands], true)), { ids: ['N2', 'N3'], text: 'Supervisor: 2 alarms need you', isHanded: true })
  assert.equal(views.attentionSupervisorLine([escalation, note('N4', 'The Advisor has not refined B7 after 3 asks', { isRead: true })], true).text, 'Supervisor: one alarm needs you')
  assert.deepEqual([finding, escalation, hands].map(one => views.isHandedAlarm(one)), [false, true, true])
})

/** The garden's state as the board builds it with Autopilot on and the store's `items` (the made-up project of the page tests). */
function garden(items, on = true) {
  const config = { ...parseConfig(`{"autopilot":${on}}`, {}), project: 'D:\\garden' }
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: PAGE_NOW - 60 * PAGE_MIN })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(PAGE_NOW - 30 * PAGE_MIN, 'ok')]), 'cli-Digger': tail([answer(PAGE_NOW - 30 * PAGE_MIN, 'ok')]), 'cli-Advisor': tail([typed(PAGE_NOW - 20 * PAGE_MIN, 'hi'), answer(PAGE_NOW - 12 * PAGE_MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, goalsText: RUN_GOALS,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: PAGE_NOW, config })
}
const gardenAsk = (id, fields) => parseItem(`${Object.entries({ Id: id, Kind: 'ask', State: 'open', Owner: 'Digger', Since: sinceOf(PAGE_NOW - 40 * PAGE_MIN), Filed: String(PAGE_NOW - 40 * PAGE_MIN), Asks: 'decide', Blocking: 'no', ...fields }).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)
const gardenNote = (id, words) => parseItem(`Id: ${id}\nKind: note\nFrom: server\nTo: you\nState: unread\nSince: ${sinceOf(PAGE_NOW - 10 * PAGE_MIN)}\nVia: supervisor\nText: ${words}\n`)
const words = node => node.textContent.replace(/\s+/g, ' ').trim()

test('Needs your attention with Autopilot v2 on: one goal-start card, the two hands asks as one line, nothing of the five routed away, the decided line with today\'s count, no Supervisor finding; the top bar counts 2', async () => {
  const items = [
    gardenAsk('Q1', { Title: 'Give G9\'s new plan your Go on the Goals page', Owner: 'Advisor', Asks: 'do' }),
    gardenAsk('Q2', { Title: 'Sign in to the seed shop account', Asks: 'do' }),
    gardenAsk('Q3', { Title: 'Pay the hosting bill for the garden site before the end of the month', Asks: 'do', Of: 'B12', Blocking: 'yes' }),
    gardenAsk('Q4', { Title: 'Icons or words on the bar?', Route: 'partner' }),
    gardenAsk('Q5', { Title: 'Merge B12 into main', Asks: 'do', Route: 'main' }),
    gardenAsk('Q6', { Title: 'Approve the hedge at 64 of 75?', Asks: 'look', Of: 'B12', Route: 'recap' }),
    gardenAsk('Q7', { Title: 'Shorter names in the shop?', Advice: 'yes', Route: 'advice' }),
    gardenAsk('Q8', { Title: 'How tall should the bar be?', Route: 'partner' }),
    gardenNote('N1', 'Supervisor: X12 came back: Digger works with no step'),
  ]
  const state = asSent(garden(items))
  assert.deepEqual(state.forYou.filter(one => one.workId !== undefined).map(one => [one.workId, one.hands]), [['Q1', null], ['Q2', 'a sign-in'], ['Q3', 'money']])
  const page = await openPage({ state: { ...state, autopilot: { on: true, decidedToday: 12 } } })
  try {
    assert.deepEqual(page.all('#needs [data-id^="work:"]').filter(card => !card.classList.contains('is-closed')).map(card => card.dataset.id), ['work:Q1'])
    const line = page.find('#needs .hands-line')
    assert.equal(words(line), 'Needs your hands: Sign in to the seed shop account · Pay the hosting bill for the garden… →')
    assert.deepEqual(page.all('#needs .hands-line a').map(link => link.getAttribute('href')), ['#details=Q2', '#details=Q3'])
    assert.equal(line.classList.contains('is-blocking'), true, 'Q3 holds up B12: the attention colour')
    assert.equal(page.all('#needs .hands-line').length, 1)
    assert.equal(page.text('#needs .autopilot-line'), 'Autopilot decided 12 today →')
    assert.equal(page.find('#needs .autopilot-line a').getAttribute('href'), '#advice/focus')
    assert.deepEqual([page.all('#needs .supervisor-line').length, page.all('#needs .with-partner').length, page.all('#needs .decided-for-you').length], [0, 0, 0])
    assert.equal(page.text('#waits-for-you'), '2 wait for you')
    assert.equal(page.text('#needs-count'), '2')
  } finally { await page.close() }
  // An alarm the Supervisor hands to the person shows as one line and counts.
  const alarm = asSent(garden([...items, gardenNote('N2', 'Incident X13 "Digger is quiet" has been with the Supervisor for over 2 hours without a close or a fix: look at it under Supervisor.')]))
  const withAlarm = await openPage({ state: { ...alarm, autopilot: { on: true, decidedToday: 12 } } })
  try {
    assert.deepEqual(withAlarm.all('#needs .supervisor-line').map(words), ['Supervisor: one alarm needs you'])
    assert.equal(withAlarm.text('#waits-for-you'), '3 wait for you')
  } finally { await withAlarm.close() }
  // Off: the hands asks are cards again, and the finding's line is back, uncounted.
  const off = await openPage({ state: asSent(garden(items, false)) })
  try {
    assert.equal(off.all('#needs .hands-line').length, 0)
    assert.deepEqual(off.all('#needs [data-id^="work:"]').filter(card => !card.classList.contains('is-closed')).map(card => card.dataset.id).filter(id => ['work:Q1', 'work:Q2', 'work:Q3'].includes(id)).sort(), ['work:Q1', 'work:Q2', 'work:Q3'])
    assert.deepEqual(off.all('#needs .supervisor-line').map(words), ['Supervisor: one new finding'])
  } finally { await off.close() }
})
