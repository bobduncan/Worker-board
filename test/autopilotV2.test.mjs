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

import { KEPT_LOOK_WHY, KEPT_LOOK_WORDS, REBUILD_IS_PERSONS, adviceAnswerOf, autopilotRoute, isBoardRoutedPerson, isKeptLook, refineStaysPersonsOf } from '../src/work/autopilot.mjs'
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
  // Q601, a worker's decide with advice under a step: the review's ruling (2026-11-04, on purpose: the cache exemption sent it to
  // advice) makes every delete the person's hands, a cache's too: the hands line.
  assert.deepEqual(autopilotRoute(Q601, again), { to: 'person', why: 'only the person\'s hands: a permanent delete ("delete")', hands: 'a permanent delete' })
  const folder = ask('Q609', { Title: 'May I delete the old save folder of the game?', Owner: 'Worker 5', Asks: 'decide', Of: 'B821', Advice: 'yes', Via: 'chat' }, { history: [] })
  assert.deepEqual(autopilotRoute(folder, ctx()), { to: 'person', why: 'only the person\'s hands: a permanent delete ("delete")', hands: 'a permanent delete' })
  // Q605, the partner's rebuild of the focus goal with advice A: the person's decision of 2026-11-04 (REBUILD_IS_PERSONS, on purpose:
  // the advice was taken): a rebuild is theirs, of any goal.
  assert.deepEqual(autopilotRoute(Q605, again), { to: 'person', why: 'a rebuild of a goal ("Rebuild G60")' })
  assert.equal(adviceAnswerOf(Q605), 'A: A thick ring, the round pool kept (about 3 h)')
  assert.deepEqual(autopilotRoute(Q605, ctx({ again: true, focusGoal: 'G29' })), { to: 'person', why: 'a rebuild of a goal ("Rebuild G60")' })
  // "Accept B944 as it is?", Main's decide with advice yes: an accept never takes the advice (the review's ruling, on purpose).
  assert.deepEqual(autopilotRoute(Q612, again), { to: 'partner', why: 'a verdict on a result ("Accept"): the partner decides it' })
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
    // The review's ruling (2026-11-04): a pass never answers with the advice an ask that stood for the person; the sweep may.
    Q622: askText('Q622', { Title: 'Icons or words on the shop bar?', Owner: 'Worker 5', Asks: 'decide', Of: 'B821', Options: 'A icons | B words', Advice: 'A', Via: 'chat', Route: 'person' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const pass = await workApi({ action: 'autopilot', on: true }, apiCtx(dir, NOW))
  assert.equal(pass.ok, true, pass.why)
  // An accept goes to the partner, never to the advice (the review's ruling, on purpose: Q612 took the advice).
  assert.deepEqual(pass.result.routed, [{ id: 'Q593', to: 'partner' }, { id: 'Q612', to: 'partner' }])
  assert.deepEqual(pass.result.answered, [])
  let store = (await readStore(dir)).items
  assert.deepEqual(['Q593', 'Q594', 'Q612', 'Q621', 'Q622'].map(id => store.get(id).head.get('Route')), ['partner', 'person', 'partner', 'person', 'person'])
  assert.deepEqual(store.get('Q594').sections.get('Route'), ['The main chat hands this to you: opening the game in your browser is yours'], 'the hand-over stands')
  assert.equal((store.get('Q593').sections.get('History') ?? []).filter(line => line.includes('autopilot: routed to partner')).length, 1)
  // The next pass routes nothing again.
  const next = await workApi({ action: 'autopilot', on: true }, apiCtx(dir, NOW + 5 * MIN))
  assert.deepEqual(next.result.routed, [])
  // The switch-on's sweep takes the advice of what stood for the person.
  const swept = await workApi({ action: 'autopilot', on: true, sweep: true }, apiCtx(dir, NOW + 6 * MIN))
  assert.deepEqual([swept.result.routed, swept.result.answered], [[{ id: 'Q622', to: 'advice' }], ['Q622']])
  store = (await readStore(dir)).items
  assert.equal(store.get('Q622').head.get('Answered by'), 'autopilot')
  // Off: nothing is judged anew.
  const offDir = await storeWith({ Q593: askText('Q593', { Title: 'Look at the whole ring in the game.', Owner: 'Worker 5', Asks: 'do', Via: 'chat', Route: 'person' }) })
  t.after(() => rm(offDir, { recursive: true, force: true }))
  assert.deepEqual((await workApi({ action: 'autopilot', on: false }, apiCtx(offDir, NOW))).result.routed, [])
})

// ---------------------------------------------------------------------------------------------------------------------
// The review of v2 (2026-11-04): its probes' cases, each routed so before.

test('the review\'s probes: the person\'s hands in the whole list before any advice, the goal\'s start and a focus switch and the recap\'s words under a step too, the focus goal\'s own verdict, a rebuild, an accept never advice', () => {
  const review = new Map([B821, B891, ...[['B900', 'G60', 'in progress'], ['B901', 'G29', 'in progress'], ['B921', 'G60', 'done']].map(([id, goal, state]) => parseItem(stepText(id, { Title: `Step ${id}`, State: state, Owner: 'Worker 1', Goal: goal })))].map(one => [one.head.get('Id'), one]))
  const roles = { ...ROLES, 'Worker 1': 'worker' }
  const rctx = (more = {}) => ({ roleOf: name => roles[name] ?? null, items: review, focusGoal: 'G60', focusHasDemo: true, recapSteps: [], now: NOW, ...more })
  const probe = ({ owner = 'Worker 1', kind = 'decide', of = 'B900', title, advice = 'yes', pictures = null }) => ask('Q700', { Title: title, Owner: owner, Asks: kind, Of: of ?? undefined, Advice: advice ?? undefined, Pictures: pictures ?? undefined, Via: 'chat' }, { history: [] })
  const route = shape => autopilotRoute(probe(shape), rctx())
  // 4: advice is a yes now, so the whole list of the person's hands is read first, with the words that were missing.
  for (const [title, hands] of [['May I add the permission for set_session_model to settings.local.json?', 'a permission'], ['May I add an allow rule for set_session_model to the project settings?', 'a permission'],
    ['Should I click "Allow" on the prompt in Worker 2?', 'a click'], ['Switch on extra usage so B900 can finish tonight?', 'money'], ['Buy the sound pack for $12 so the map has its ambience?', 'money'],
    ['Remove the old b944 branch and its worktree for good?', 'a permanent delete'], ['Run git branch -D b944 to clean up?', 'a permanent delete'], ['Upload the build to itch.io so testers can play it?', 'a publish'],
    ['Log into the asset store with the shared login?', 'a sign-in'], ['Put the game on Steam next week?', 'a publish']]) {
    assert.equal(route({ title }).hands, hands, title)
  }
  assert.equal(route({ title: 'Buy the sound pack for $12?', of: null }).hands, 'money', 'under no step too')
  assert.equal(route({ title: 'Take the old lava into account?' }).to, 'advice', 'into account is no account')
  assert.equal(route({ title: 'Add steam above the lava vents?' }).to, 'advice', 'steam in a lava game is no Steam')
  assert.equal(route({ title: 'Should I make drawNeeds public so the test can import it?' }).to, 'advice', 'a function made public in the code is no publish')
  // 5: a delete of a cache is a delete too (the exemption is gone): the hands line.
  assert.equal(route({ title: 'May I delete the old wt-* worktrees and the board\'s game cache?' }).hands, 'a permanent delete')
  assert.equal(autopilotRoute(Q601, ctx({ again: true })).hands, 'a permanent delete', 'the live Q601 reaches the hands line')
  // 4: a goal's start and a focus switch under a step too.
  assert.equal(route({ owner: 'Advisor', title: 'Switch to G29 as the focus once B900 lands?' }).to, 'person')
  assert.equal(route({ owner: 'Advisor', title: 'Switch the focus to G29 once B900 lands?' }).to, 'person')
  assert.equal(route({ owner: 'Advisor', title: 'Approve G29\'s new work blocks?' }).to, 'person')
  assert.equal(route({ owner: 'Main', of: null, title: 'Approve G60\'s new how with 3 parts?' }).to, 'person')
  assert.equal(route({ title: 'Switch the focus ring to gold?' }).to, 'advice', 'the focus ring is no focus switch')
  // 2: a recap row's verdict under a step (the live Q595, a do linking the step's window): the recap's when it takes it, else the person's.
  const q595 = { kind: 'do', of: 'B921', advice: null, title: 'Look at the three pictures and give your verdict on row 9 in G60\'s recap: [B921](http://127.0.0.1:4310/#details=B921)' }
  assert.equal(route(q595).to, 'person')
  assert.equal(autopilotRoute(probe(q595), rctx({ focusHasDemo: false })).to, 'recap')
  assert.equal(route({ title: 'Approve row 4 of G60\'s recap?' }).to, 'person')
  // 1: the focus goal's own verdict: a look of it, or words asking whether it is reached; never advice or the partner.
  const recheck = (title, advice = null, kind = 'look') => route({ owner: 'Advisor', kind, of: 'G60', title, advice, pictures: 'pictures/g60/recheck.png' })
  assert.deepEqual(recheck('G60\'s re-check: does the Ring read as round in the game?'), { to: 'person', why: 'the focus goal\'s own verdict ("a look of G60")' })
  assert.equal(recheck('G60\'s re-check: does the Ring read as round in the game?', 'yes').to, 'person')
  assert.equal(recheck('Is G60 reached now?', 'yes', 'decide').to, 'person')
  assert.equal(recheck('Which part of G60 first?', 'A', 'decide').to, 'advice', 'a detail of the focus goal mid-goal')
  // 6: a rebuild of a goal is the person's (REBUILD_IS_PERSONS), the focus goal's too.
  assert.equal(REBUILD_IS_PERSONS, true)
  assert.deepEqual(autopilotRoute(Q605, ctx({ again: true })), { to: 'person', why: 'a rebuild of a goal ("Rebuild G60")' })
  // 3: an accept, a mark done or a send back never takes the advice: the partner judges it.
  assert.deepEqual(autopilotRoute(Q612, ctx({ again: true })), { to: 'partner', why: 'a verdict on a result ("Accept"): the partner decides it' })
  assert.equal(route({ kind: 'do', title: 'Mark B900 done on the board.', advice: 'yes' }).to, 'partner')
  // 8: a look with pictures never takes the advice: of another goal the partner judges it (it hands art to the person).
  assert.equal(route({ kind: 'look', of: 'B901', title: 'Approve the Causeway painting as final?', pictures: 'pictures/B901/final.png' }).to, 'partner')
  // What the person meant or said: the partner reads their words.
  assert.equal(route({ owner: 'Main', of: null, title: 'Did you mean the north ring or the south ring?', advice: 'the north ring' }).to, 'partner')
  assert.equal(route({ title: 'Do you mean the shop bar or the map bar?', advice: 'the shop bar' }).to, 'partner')
})

test('the re-review\'s probes (2026-11-04): the hands words narrowed to what the person\'s hands do, the Accept card judged by its title, a mark done or an art choice never advice, the focus goal\'s verdict and a rebuild by its id anywhere', () => {
  const review = new Map([...[['B900', 'G60', 'in progress'], ['B901', 'G29', 'review']].map(([id, goal, state]) => parseItem(stepText(id, { Title: `Step ${id}`, State: state, Owner: 'Worker 1', Goal: goal })))].map(one => [one.head.get('Id'), one]))
  const roles = { ...ROLES, 'Worker 1': 'worker' }
  const rctx = (more = {}) => ({ roleOf: name => roles[name] ?? null, items: review, focusGoal: 'G60', focusHasDemo: true, recapSteps: [], now: NOW, ...more })
  const probe = ({ owner = 'Worker 1', kind = 'decide', of = 'B900', title, advice = 'yes', options = null, pictures = null }) => ask('Q710', { Title: title, Owner: owner, Asks: kind, Of: of ?? undefined, Advice: advice ?? undefined, Options: options ?? undefined, Pictures: pictures ?? undefined, Via: 'chat' }, { history: [] })
  const route = shape => autopilotRoute(probe(shape), rctx())
  // 2: the game's and the board's own words are no hands (they went to the person before).
  for (const title of ['Should the shop\'s Buy button stay off when the gold is short?', 'Should a purchase in the shop leave the grid at once?', 'Should the credits line sit on the About tab?',
    'Add the music credits to the menu?', 'Should clicking a hero choose it?', 'Should Enter press Buy once it has the focus?', 'Should a tap on a tile move the hero?',
    'Which file permissions does the save folder need?', 'Should I upload the evidence picture to the step?', 'Should Tab switch the focus to the next hero?', 'May I npm install vitest as a dev dependency?',
    'Should the damage account for the armor of the target?', 'Should the Steam from the vents fade?', 'Should a won fight pay more gold on the Terraces?', 'Should a hero with the paid flag show a coin?',
    'Is the damage from lava permanently applied to the tile?', 'Should the game log into the console when a move is refused?', 'Do we log in the history each move?']) {
    assert.equal(route({ title }).to, 'advice', title)
  }
  // ... while the person's hands still are.
  for (const [title, hands] of [['Buy the sound pack for $12 so the map has its ambience?', 'money'], ['Buy 500 credits for the image service?', 'money'], ['Switch to the paid plan for the asset service?', 'money'],
    ['Upload the build to itch.io so testers can play it?', 'a publish'], ['May I add the permission for set_session_model to settings.local.json?', 'a permission'], ['Should I click "Allow" on the prompt in Worker 2?', 'a click'],
    ['May I delete the unused test fixture file?', 'a permanent delete'], ['Should the hero be removed permanently when it dies?', 'a permanent delete'], ['Install the paint app on this PC?', 'an install'],
    ['Reinstall the Workers mod now?', 'an install'], ['Log into the asset store with the shared login?', 'a sign-in'], ['Use your account for the pack?', 'an account'], ['Pay the hosting bill this month?', 'money']]) {
    assert.equal(route({ title }).hands, hands, title)
  }
  // 1: the board's Accept card is judged by its title only: its body's words of what the step gives are no hands, no goal.
  const card = gives => ask('Q711', { Title: 'Accept B901 at 72 of 75, or send it back?', Asks: 'decide', Of: 'B901', Options: 'A Accept: done as it is | B Send back', Via: 'accept', Route: 'person' },
    { words: `B901 stays in review: its fix B875 was dropped, and only you close a result below its bar. What it gives: ${gives}` })
  for (const gives of ['the shop shows its Buy button off when the gold is short', 'a purchase leaves the grid at once', 'the board uploads the picture to the step', 'the goal demo gets a row for each part and the recap row shows the picture',
    'the Goals page draws the goal map with the focus goal first', 'the Goals page lists the work blocks of a goal', 'the board says which goal each step belongs to', 'a focus switch shows its banner',
    'a lost hero is removed permanently', 'the old save slot can be deleted']) {
    assert.equal(autopilotRoute(card(gives), rctx({ again: true })).to, 'partner', gives)
  }
  // 5: a decide or yes/no that marks a step done or finishes it is a verdict: the partner's, never the advice.
  for (const shape of [{ title: 'Mark B901 done, or keep it open?', of: 'B901', advice: 'A', options: 'A Mark it done | B Keep it open' }, { title: 'Tick B901 as finished?', of: 'B901' },
    { title: 'Is B901 good enough to finish now?', of: 'B901' }, { title: 'Is the ring good enough to call it done?', of: 'B901' }]) {
    assert.equal(route(shape).to, 'partner', shape.title)
  }
  assert.equal(route({ title: 'Should I finish the shop first or the map?', of: 'B901', advice: 'the shop' }).to, 'advice', 'finishing other work first is no verdict')
  // 5: a rebuild of a goal, "rebuild" in any case anywhere in the title with a goal's id; a rebuild of a thing under a step is none.
  assert.equal(route({ owner: 'Advisor', of: null, title: 'rebuild G60: which way?', advice: 'A', options: 'A x | B y' }).to, 'person')
  assert.equal(route({ owner: 'Advisor', of: 'G60', title: 'Which way to rebuild the Ring of G60?', advice: 'A', options: 'A x | B y' }).to, 'person')
  assert.equal(route({ title: 'Rebuild the ring pool from scratch, or patch it?', advice: 'B', options: 'A rebuild | B patch' }).to, 'advice')
  // 6: verdict words naming the focus goal's id anywhere are its verdict; an art choice and "did you want" never take the advice.
  for (const shape of [{ owner: 'Advisor', of: null, title: 'Is G60 reached now?' }, { owner: 'Advisor', of: 'G60', title: 'Is G60 reached now?' }, { title: 'Is G60 reached now, with this ring?' }]) {
    assert.equal(route(shape).to, 'person', `${shape.of}: ${shape.title}`)
  }
  assert.equal(route({ title: 'Which ring variant: A thin or B thick?', of: 'B901', advice: 'A', options: 'A thin | B thick', pictures: 'pictures/B901/ring.png' }).to, 'partner', 'an art choice')
  assert.equal(route({ title: 'Did you want the ring thicker?', of: 'B901' }).to, 'partner')
})

test('the re-review\'s refine rule: the board takes no refine advice the person\'s hands, a goal\'s start, a focus switch, a rebuild, a goal\'s verdict or what they meant would answer', () => {
  assert.match(refineStaysPersonsOf('Buy the sound pack for $12? A: yes B: no. Advised: A', 'B900', 'G60'), /^only the person's hands: money/)
  assert.match(refineStaysPersonsOf('Switch the focus to G29 after this step? Advised: yes', 'B900', 'G60'), /^goal level \(start\)/)
  assert.match(refineStaysPersonsOf('Rebuild G29 instead of patching it? Advised: yes', 'B900', 'G60'), /^goal level \(rebuild\)/)
  assert.match(refineStaysPersonsOf('Is G60 reached once this lands? Advised: yes', 'B900', 'G60'), /^goal level \(verdict\)/)
  assert.equal(refineStaysPersonsOf('Did you want the ring thicker? Advised: yes', 'B900', 'G60'), 'what the person meant or said')
  assert.equal(refineStaysPersonsOf('Two rows or three? A: two rows B: three rows. Advised: A — fits the screen', 'B900', 'G60'), null)
})

test('the Undo of the partner\'s Accept puts the step back in review and the card stays for the person; a flow that lets nobody move it back refuses the Undo and changes nothing', async t => {
  const stepFile = [
    'Id: B851', 'Kind: step', 'Title: Break up the cliff walls\' stripes', 'State: review', 'Owner: Worker 5', 'Activity: Board', 'Goal: G29', `Since: ${at(49)}`, 'Branch: b851-walls', '',
    '## Context', '  The walls show even stripes.', '',
    '## Standard', 'ground look · pictures/walls.png · target 75', '',
    '## What we build', '- uneven rock walls', '- judged beside the painting, target 75', '',
    '## Checked', 'Evidence: pictures/B851/evidence.png', 'Score: 72 of 75', '- pass: uneven rock walls', '- fail: judged beside the painting, target 75', '',
    '## History', `- ${at(49)} Worker 5: in progress → review`, `- ${at(49)} server: check passed: work in garden; result named`, `- ${at(44)} Checker: result check failed: 1 of 2 points pass, score 72 of 75; fix B875 for Worker 5`, '',
  ].join('\n')
  const fixFile = [
    'Id: B875', 'Kind: step', 'Title: Fix: judged beside the painting', 'State: dropped', 'Owner: Worker 5', 'Activity: Board', 'Goal: G29', `Since: ${at(42)}`, 'Fix of: B851', '',
    '## Context', '  Fix of B851: the result check failed on one point.', '  Dropped by Main: the partner accepts B851 at 74', '',
    '## History', `- ${at(44)} Checker: made by the result check of B851`, `- ${at(42)} Main: in progress → dropped`, '',
  ].join('\n')
  const flowless = JSON.stringify({ ...JSON.parse(readFileSync(new URL('../examples/work/flow.json', import.meta.url), 'utf8')) }, (key, value) => (Array.isArray(value) ? value.filter(one => !(one?.from === 'done' && one?.to === 'review')) : value), 1)
  const run = async files => {
    const dir = await storeWith({ B851: stepFile, B875: fixFile })
    t.after(() => rm(dir, { recursive: true, force: true }))
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body)
    const as = (role, now) => ({ ...apiCtx(dir, now), as: role })
    const cards = await workApi({ action: 'accept-cards' }, as('server', NOW))
    const card = cards.result.filed[0]
    assert.equal(typeof card, 'string', JSON.stringify(cards))
    assert.deepEqual((await workApi({ action: 'autopilot', on: true }, as('server', NOW + MIN))).result.routed, [{ id: card, to: 'partner' }])
    const answered = await workApi({ action: 'partner-answer', chat: 'Advisor', id: card, text: 'A Accept: done as it is', why: 'judged by its check' }, { ...apiCtx(dir, NOW + 2 * MIN), as: undefined })
    assert.equal(answered.ok, true, answered.why)
    assert.equal((await readStore(dir)).items.get('B851').head.get('State'), 'done')
    return { dir, card, as }
  }
  // The flow lets the person move a done step back to review (examples/work/flow.json): the Undo does, and the card stays.
  const { dir, card, as } = await run({})
  const undone = await workApi({ action: 'undo', id: card }, as('person', NOW + 3 * MIN))
  assert.equal(undone.ok, true, undone.why)
  let store = (await readStore(dir)).items
  assert.deepEqual([store.get(card).head.get('State'), store.get(card).head.get('Route'), store.get('B851').head.get('State')], ['open', 'person', 'review'])
  await workApi({ action: 'accept-cards' }, as('server', NOW + 4 * MIN))
  assert.equal((await readStore(dir)).items.get(card).head.get('State'), 'open', 'the board\'s pass leaves the card for the person')
  const back = await workApi({ action: 'answer', id: card, text: ['B Send back', 'round the edge'] }, as('person', NOW + 5 * MIN))
  assert.equal(back.ok, true, back.why)
  // A project's flow without that move: the Undo refuses with one line, and nothing changes.
  const old = await run({ 'flow.json': flowless })
  const refused = await workApi({ action: 'undo', id: old.card }, old.as('person', NOW + 3 * MIN))
  assert.equal(refused.ok, false)
  assert.match(refused.why, /cannot be taken back: its Accept closed B851, and the flow lets nobody move a done step back to review/)
  store = (await readStore(old.dir)).items
  assert.deepEqual([store.get(old.card).head.get('State'), store.get('B851').head.get('State')], ['answered', 'done'])
})

// ---------------------------------------------------------------------------------------------------------------------
// The coordinator's ruling on v2 (2026-11-02): an art or map look waits for the recap, never decided by advice or the partner.

test('a worker\'s or the main chat\'s look with pictures of a step of the focus goal is kept for the recap, with or without advice; without pictures, or of another goal, it is decided as any look', () => {
  const map = more => ask('Q640', { Title: 'Does the ring map read round now?', Owner: 'Worker 5', Asks: 'look', Of: 'B821', Advice: 'yes', Pictures: 'pictures/B821/ring.png', Via: 'chat', ...more }, { history: [] })
  assert.deepEqual(autopilotRoute(map(), ctx()), { to: 'recap', why: KEPT_LOOK_WHY, kept: true }, 'with pictures and advice under a step of the focus goal')
  assert.equal(autopilotRoute(map({ Advice: undefined }), ctx()).kept, true, 'without advice too')
  assert.equal(autopilotRoute(map({ Owner: 'Main' }), ctx()).kept, true, 'the main chat\'s')
  assert.deepEqual(autopilotRoute(map({ Of: undefined }), ctx()), { to: 'recap', why: KEPT_LOOK_WHY, kept: true, step: 'B821' }, 'under no step: put under the step its picture names')
  assert.equal(autopilotRoute(map({ Pictures: undefined }), ctx()).to, 'advice', 'without pictures: its advice is taken')
  // A look with pictures never takes the advice (the review's ruling of 2026-11-04, on purpose: these took it): of another goal, or
  // the partner's own, the partner judges it.
  assert.equal(autopilotRoute(map({ Of: 'B891', Pictures: 'pictures/B891/ring.png' }), ctx()).to, 'partner', 'of another goal: the partner judges it')
  assert.equal(autopilotRoute(map({ Owner: 'Advisor' }), ctx()).to, 'partner', 'the partner\'s own look is no worker\'s')
  // The person's hands still come first.
  assert.equal(autopilotRoute(map({ Title: 'Sign in to the map site: does the ring read round now?' }), ctx()).to, 'person')
})

test('the pass and the filing keep such a look as the partner\'s hand-over is: its kept line, under its step, the step marked and going on, its worker woken', async t => {
  const dir = await storeWith({
    B821: stepText('B821', { Title: 'Fix: the ring reads round', State: 'waiting on you', Owner: 'Worker 5', Goal: 'G60', Branch: 'b821' }),
    Q641: askText('Q641', { Title: 'Does the ring map read round now?', Owner: 'Worker 5', Asks: 'look', Of: 'B821', Advice: 'yes', Blocking: 'yes', Pictures: 'pictures/B821/ring.png', Via: 'chat', Route: 'person' }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const pass = await workApi({ action: 'autopilot', on: true }, apiCtx(dir, NOW))
  assert.equal(pass.ok, true, pass.why)
  assert.deepEqual(pass.result.routed, [{ id: 'Q641', to: 'recap' }])
  assert.deepEqual(pass.result.wakes.map(one => [one.to, one.kind]), [['Worker 5', 'recap-kept']])
  let store = (await readStore(dir)).items
  assert.deepEqual([store.get('Q641').head.get('Route'), store.get('Q641').head.get('Blocking'), store.get('Q641').sections.get('Route')], ['recap', 'no', [KEPT_LOOK_WORDS]])
  assert.equal(isKeptLook(store.get('Q641')), true)
  assert.ok(store.get('B821').sections.get('Context').some(line => line.trim() === 'Recap verdict: waits (Q641)'))
  assert.equal(store.get('B821').head.get('State'), 'in progress', 'the step it held goes on')
  // Filed while Autopilot is on: kept at once, with its line.
  const filed = await workApi({ action: 'ask', chat: 'Worker 5', of: 'B821', kind: 'look', text: ['Is the lava shore\'s colour right beside the painting?', 'Context: The shore colour changed in B821', 'Problem: it may sit too dark beside the painting', 'Approve: keep it', 'Send back: a later step lightens it'], advice: 'yes', pictures: ['pictures/B821/shore.png'] }, { ...apiCtx(dir, NOW + MIN), as: undefined, autopilot: true })
  assert.equal(filed.ok, true, filed.why)
  assert.equal(filed.result.route, 'recap')
  store = (await readStore(dir)).items
  assert.deepEqual(store.get(filed.result.id).sections.get('Route'), [KEPT_LOOK_WORDS])
  assert.equal(isKeptLook(store.get(filed.result.id)), true)
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
    gardenAsk('Q5', { Title: 'Export the map of B12', Asks: 'do', Route: 'main' }),
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

test('T20.1, the app\'s popup: with Autopilot on it stands in the hands line with its own words, once per chat (the live Q629 and Q632 as one entry), another chat on its own, no card; off, each is a card', async () => {
  const POPUP = 'A popup in its chat may wait for you: it has tried to use ccd directory (change directory) (garden) for over a minute. Open its chat and look.'
  const popup = (id, owner, minutes) => gardenAsk(id, { Title: POPUP.split('. ')[0] + '.', Owner: owner, Asks: 'do', Via: 'form', Route: 'person', Since: sinceOf(PAGE_NOW - minutes * PAGE_MIN), Filed: String(PAGE_NOW - minutes * PAGE_MIN) })
  const withText = (item, words) => { item.sections.set('Text', [words]); item.sections.set('History', [`- ${sinceOf(PAGE_NOW - 40 * PAGE_MIN)} server: autopilot: routed to person`]); return item }
  const items = [
    gardenAsk('Q1', { Title: 'Give G9\'s new plan your Go on the Goals page', Owner: 'Advisor', Asks: 'do' }),
    gardenAsk('Q2', { Title: 'Sign in to the seed shop account', Asks: 'do' }),
    withText(popup('Q3', 'Digger', 90), POPUP),
    withText(popup('Q4', 'Digger', 44), POPUP),
    withText(popup('Q5', 'Lead', 30), POPUP),
  ]
  const state = asSent(garden(items))
  const cards = state.forYou.filter(one => one.workId !== undefined).sort((a, b) => a.workId.localeCompare(b.workId))
  assert.deepEqual(cards.map(one => [one.workId, one.hands, one.handsWords]), [['Q1', null, null], ['Q2', 'a sign-in', null], ['Q3', 'a popup in its chat', 'Digger\'s chat waits on a popup: change directory'], ['Q4', 'a popup in its chat', 'Digger\'s chat waits on a popup: change directory'], ['Q5', 'a popup in its chat', 'Lead\'s chat waits on a popup: change directory']])
  const page = await openPage({ state: { ...state, autopilot: { on: true, decidedToday: 3 } } })
  try {
    assert.deepEqual(page.all('#needs [data-id^="work:"]').filter(card => !card.classList.contains('is-closed')).map(card => card.dataset.id), ['work:Q1'], 'one card: the goal\'s start')
    assert.equal(words(page.find('#needs .hands-line')), "Needs your hands: Lead's chat waits on a popup: change directory · Sign in to the seed shop account · Digger's chat waits on a popup: change directory →", "the newest first; Digger's two as one")
    assert.deepEqual(page.all('#needs .hands-line a').map(link => link.getAttribute('href')), ['#details=Q5', '#details=Q2', '#details=Q4'])
    assert.equal(page.text('#needs-count'), '2', 'the line counts as one')
  } finally { await page.close() }
  // Off: every popup is a card again, as before.
  const off = await openPage({ state: asSent(garden(items, false)) })
  try {
    assert.equal(off.all('#needs .hands-line').length, 0)
    assert.deepEqual(off.all('#needs [data-id^="work:"]').filter(card => !card.classList.contains('is-closed')).map(card => card.dataset.id).sort(), ['work:Q1', 'work:Q2', 'work:Q3', 'work:Q4', 'work:Q5'])
  } finally { await off.close() }
})
