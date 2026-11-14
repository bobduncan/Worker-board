// Popup asks (2026-11-13, "waiting for you is not visible and/or has no link"): Q742 (20:47) and Q744 (21:01) were the Workers mod's popup
// asks "A popup in its chat may wait for you: it has tried to use workers (chat) for over a minute." There was no popup: the Advisor's own
// call to the board was slow, and both asks were withdrawn a minute or two later ("the call went on"). The person saw "1 waits for you",
// "Waiting for you" on the Advisor's row and "Needs your hands: Advisor's chat waits on a popup" with nothing to do. 1. A popup ask about
// the board's own tools is never the person's: no need, no hands entry, the chat's row says Working ("its call to the board is slow"),
// and the Supervisor counts it as a slow board. 2. A real popup ask links straight to its chat in the app (the hands line, the row's
// "Waiting for you", the ask's window). The two live asks are copied below (open, as they stood while the call was slow).

import assert from 'node:assert/strict'
import test from 'node:test'

import { STATUSES } from '../src/chatStatus.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { parseItem } from '../src/work/item.mjs'
import { boardCallPopups, storeNeeds, storeWaits } from '../src/work/lists.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { isBoardCallPopup, isPopupAsk } from '../src/work/yourWords.mjs'

const MIN = 60_000
const SEC = 1000
export const Q742_FILED = 1794599270471
export const Q744_FILED = 1794600108063
export const NOW = Q744_FILED + 40 * SEC
export const NAMES = ['Lead', 'Worker 1', 'Advisor']
export const APP_ID = 'local_5b7a1c1e-2d3f-4a5b-8c9d-0e1f2a3b4c5d'
const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: name === 'Advisor' ? APP_ID : `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1',
})
const config = { ...parseConfig('{"advisor":"Advisor"}', {}), project: 'C:\\game' }

/** A popup ask of the Workers mod as its file reads, for the call the title names (`tried`). */
export const popup = (id, tried, { filed, state = 'open', owner = 'Advisor' } = {}) => parseItem([
  `Id: ${id}`, 'Kind: ask', `Title: A popup in its chat may wait for you: it has tried to ${tried} for over a minute.`, `State: ${state}`, `Owner: ${owner}`,
  'Since: 2026-11-13 20:47', `Filed: ${filed}`, 'Asks: do', 'Blocking: no', 'Via: form', 'Route: person', '',
  '## Text', `A popup in its chat may wait for you: it has tried to ${tried} for over a minute. Open its chat and look.`, '',
  '## History', `- 2026-11-13 20:47 ${owner}: asked (do, with the app's question form)`, '- 2026-11-13 20:47 server: autopilot: routed to person', '',
].join('\n'))
/** The two live asks, and a real popup (a change of directory). */
export const Q742 = () => popup('Q742', 'use workers (chat)', { filed: Q742_FILED })
export const Q744 = () => popup('Q744', 'use workers (chat)', { filed: Q744_FILED })
export const REAL = () => popup('Q750', 'use ccd directory (change directory)', { filed: Q744_FILED + 5 * SEC })

/** The board's own state pass with a main chat, a worker and the Advisor; `reports` the mods' reports (the Advisor asks). */
export function build(items = [], { reports = [['Advisor', 'asking']], autopilot = true, tails = {}, appStartedAt = NOW - 5 * 60 * MIN } = {}) {
  const work = storeFromText('## Work\n', { now: NOW - 60 * MIN })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  const raw = {
    listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: NAMES.map(app), tails, planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config: { ...config, autopilot }, seen: { shown: Object.fromEntries(NAMES.map(name => [name, NOW - 5 * SEC])), other: {} }, board: { startedAt: NOW - 30 * MIN, offSince: null },
    // A report is `[name, state]`, or `[name, state, since, at]` for an asking spell that began at `since`, reported at `at`.
    reports: new Map(reports.map(([name, state, since = NOW - 40 * SEC, at = NOW - 2 * SEC]) => [name, { state, since, background: false, at, session: `cli-${name}`, mod: '0.27.0' }])),
    mods: { Lead: '0.27.0', Advisor: '0.27.0', 'Worker 1': '0.27.0' },
  })
}

test('isBoardCallPopup: the live Q742 and Q744 yes, the Workers mod by its old name yes; another tool, a directory change and a question of the form no', () => {
  assert.equal(isBoardCallPopup(Q742()), true)
  assert.equal(isBoardCallPopup(Q744()), true)
  assert.equal(isBoardCallPopup(popup('Q1', 'use folder branches (work)', { filed: 1 })), true)
  for (const tried of ['start a preview in its browser (map-dev)', 'change directory', 'use goalmap (goalmap)', 'use ccd directory (change directory)']) {
    assert.equal(isPopupAsk(popup('Q2', tried, { filed: 1 })), true, tried)
    assert.equal(isBoardCallPopup(popup('Q2', tried, { filed: 1 })), false, tried)
  }
  const question = parseItem('Id: Q3\nKind: ask\nTitle: Hedge before the pond?\nState: open\nOwner: Advisor\nVia: form\nAsks: decide\n')
  assert.equal(isBoardCallPopup(question), false)
})

test('the real case: Q742 and Q744 open give no need and no hands entry, and the Advisor works with its slow call; a real popup beside them waits for the person as before', () => {
  const state = build([Q742(), Q744()])
  assert.deepEqual(state.forYou.filter(need => ['Q742', 'Q744'].includes(need.workId)), [], 'no card and no hands entry for a call to the board')
  assert.equal(state.forYou.some(need => need.kind === 'unfiled' || need.title === 'Asked you a question in its chat'), false, 'no card of the board\'s own either')
  assert.equal(state.advisor.state, 'working')
  assert.deepEqual(state.advisor.boardCall, { since: Q744_FILED, ask: 'Q744' })
  assert.deepEqual([state.advisor.status, state.advisor.why, state.advisor.since], [STATUSES.WORKING, 'its call to the board is slow', Q744_FILED])
  assert.equal(state.advisor.asksYou, false)
  assert.deepEqual(state.advisor.asking, [])

  const real = build([Q742(), Q744(), REAL()])
  assert.deepEqual(real.forYou.filter(need => need.workId !== undefined).map(need => need.workId), ['Q750'])
  assert.equal(real.advisor.state, 'waiting')
  assert.equal(real.advisor.boardCall, null)
  assert.equal(real.advisor.status, STATUSES.WAITING)
  assert.equal(real.advisor.asksYou, true)
  // The real popup alone: as it was before this change.
  const alone = build([REAL()])
  assert.equal(alone.advisor.status, STATUSES.WAITING)
  assert.equal(alone.forYou.find(need => need.workId === 'Q750').isForm, true)
})

test('a board-call popup is a call to the board only while the chat\'s open form asks are all of that kind and no blocking ask is open', () => {
  const blocking = parseItem('Id: Q9\nKind: ask\nTitle: Which hedge?\nState: open\nOwner: Advisor\nSince: 2026-11-13 21:00\nFiled: 1\nAsks: decide\nBlocking: yes\nVia: chat\n')
  assert.equal(build([Q744(), blocking]).advisor.state, 'waiting')
  // A chat that no longer asks (its call went on) is what its report says; the ask is withdrawn.
  const done = build([popup('Q744', 'use workers (chat)', { filed: Q744_FILED, state: 'withdrawn' })], { reports: [['Advisor', 'busy']] })
  assert.equal(done.advisor.boardCall, null)
  assert.equal(done.advisor.status, STATUSES.WORKING)
  assert.equal(done.advisor.why, null)
  // The store's own readers.
  const work = storeFromText('## Work\n', { now: NOW })
  for (const one of [Q742(), Q744()]) work.items.set(one.head.get('Id'), one)
  assert.deepEqual(storeNeeds(work, { now: NOW, names: NAMES, autopilot: false }), [])
  assert.deepEqual([...storeWaits(work).boardCall], [['advisor', { since: Q744_FILED, ask: 'Q744' }]])
  // F9's review, round 3: a board-call popup is no filed form ask (the lane's boardCall keeps the board's own card away instead).
  assert.equal(storeWaits(work).form.has('advisor'), false)
  assert.equal(storeWaits(work).filed.has('advisor'), false, 'nor a filing of the chat\'s questions')
  assert.deepEqual(boardCallPopups(work), [{ at: Q742_FILED, ms: 60_000, popup: 'Q742' }, { at: Q744_FILED, ms: 60_000, popup: 'Q744' }])
})

test('the Supervisor: two board-call popups within 2 minutes fire board-slow and name them; one alone does not', () => {
  const rule = WATCH_RULES.find(one => one.id === 'board-slow')
  const check = (items, now) => rule.check(buildView({ state: build(items), items: new Map(), now }), { seen: new Map(), observed: [] })
  const second = popup('Q744', 'use workers (chat)', { filed: Q742_FILED + 90 * SEC })
  const found = check([Q742(), second], Q742_FILED + 3 * MIN)
  assert.deepEqual(found.map(one => one.key), ['board-slow board'])
  assert.match(found[0].evidence, /a popup ask for a slow board call \(Q742\) at .*a popup ask for a slow board call \(Q744\)/)
  assert.deepEqual(check([Q742()], Q742_FILED + 3 * MIN), [])
  // Withdrawn ones count as well (a popup ask is withdrawn once its call went on).
  const gone = [popup('Q742', 'use workers (chat)', { filed: Q742_FILED, state: 'withdrawn' }), popup('Q744', 'use workers (chat)', { filed: Q742_FILED + 90 * SEC, state: 'withdrawn' })]
  assert.equal(check(gone, Q742_FILED + 3 * MIN).length, 1)
  // Two real popups (another tool) are no slow board.
  assert.deepEqual(check([popup('Q1', 'use ccd directory (change directory)', { filed: Q742_FILED }), popup('Q2', 'use ccd directory (change directory)', { filed: Q742_FILED + 90 * SEC })], Q742_FILED + 3 * MIN), [])
})

// The page: the Needs list, the Advisor's card, a worker's row and the Simple view, from the board's own state of the same case.

const { openPage } = await import('./pageHarness.mjs')
const sent = state => JSON.parse(JSON.stringify(state))
/** A worker's row of the Details view; the Advisor's own card is `.lane.is-advisor` (it opens the Advisor tab on a click). */
const rowOf = (page, name) => page.all('[data-lane]').find(one => one.dataset.lane === name)
const advisorCard = page => page.find('.lane.is-advisor[data-open-advisor]')
/** A row of the Simple view (the default Overview), the workers' and the Advisor's, by its chat's name. */
const simpleRowOf = (page, name) => page.all('#simple-workers .simple-worker').find(one => one.querySelector('.simple-name')?.textContent === name)
const APP_LINK = `claude://claude.ai/epitaxy/${APP_ID}`
const WORKER_ID = 'local_00000000-0000-4000-8000-000000000001'
const WORKER_LINK = `claude://claude.ai/epitaxy/${WORKER_ID}`
/** The state with Worker 1's app id (`local_` and a uuid), so its row can open its chat. */
const withWorkerId = state => ({ ...state, chats: state.chats.map(lane => (lane.name === 'Worker 1' ? { ...lane, appSession: WORKER_ID } : lane)) })

test('the page: a board-call popup shows nothing in Needs your attention, and the Advisor\'s card says Working with its slow call and no link into a chat', async () => {
  const page = await openPage({ state: sent(build([Q742(), Q744()])) })
  try {
    assert.equal(page.all('#needs .hands-line').length, 0, 'no hands line')
    assert.equal(page.text('#waits-for-you'), '', 'nothing waits for you')
    assert.equal(page.all('#needs [data-id^="work:"]').length, 0)
    const card = advisorCard(page)
    assert.equal(card.querySelector('.pill').textContent, 'Working')
    assert.equal(card.querySelector('.status-why').textContent, 'its call to the board is slow')
    assert.equal(card.querySelectorAll('.chat-link').length, 0)
    assert.equal(simpleRowOf(page, 'Advisor').querySelectorAll('.chat-link').length, 0)
  } finally { await page.close() }
})

test('the page: a real popup\'s hands entry, the Advisor\'s card, a worker\'s row, the Simple view and the ask\'s window each open its chat in the app', async () => {
  const state = sent(build([Q742(), Q744(), REAL()]))
  const page = await openPage({ state })
  try {
    const entry = page.find('#needs .hands-line a')
    assert.equal(entry.getAttribute('href'), APP_LINK)
    assert.match(entry.getAttribute('title'), /^Opens Advisor's chat in the app: its question or popup waits there/)
    assert.match(page.text('#needs .hands-line'), /Advisor's chat waits on a popup: change directory/)
    const card = advisorCard(page)
    assert.equal(card.querySelector('.pill').textContent, 'Waiting for you')
    assert.equal(card.querySelector('a.chat-link').getAttribute('href'), APP_LINK)
    assert.equal(simpleRowOf(page, 'Advisor').querySelector('a.chat-link').getAttribute('href'), APP_LINK)
  } finally { await page.close() }
  const window = await openPage({ state, hash: 'details=Q750' })
  try {
    const link = window.all('#details a.chat-link').find(one => one.textContent === 'Open its chat')
    assert.equal(link?.getAttribute('href'), APP_LINK, 'the ask\'s window has "Open its chat"')
  } finally { await window.close() }
  // A worker with a real popup: its row of the Details view and of the Simple view, and its hands entry.
  const worker = withWorkerId(sent(build([popup('Q751', 'use ccd directory (change directory)', { filed: Q744_FILED, owner: 'Worker 1' })], { reports: [['Worker 1', 'asking']] })))
  const rows = await openPage({ state: worker })
  try {
    const row = rowOf(rows, 'Worker 1')
    assert.equal(row.querySelector('.pill').textContent, 'Waiting for you')
    assert.equal(row.querySelector('a.chat-link').getAttribute('href'), WORKER_LINK)
    assert.equal(simpleRowOf(rows, 'Worker 1').querySelector('a.chat-link').getAttribute('href'), WORKER_LINK)
    assert.equal(rows.find('#needs .hands-line a').getAttribute('href'), WORKER_LINK)
    // The main chat asks nothing: no link on its row.
    assert.equal(rowOf(rows, 'Lead').querySelectorAll('.chat-link').length, 0)
  } finally { await rows.close() }
})

test('the page: the Advisor\'s "Open its chat" opens only the chat; a click elsewhere on its card opens the Advisor tab as before', async () => {
  const page = await openPage({ state: sent(build([REAL()])) })
  try {
    const link = advisorCard(page).querySelector('a.chat-link')
    // The test stops the browser's own follow of the claude:// link; the page's handlers still see the click.
    link.addEventListener('click', event => event.preventDefault())
    link.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    assert.equal(page.find('#view-overview').hidden, false, 'still on the Overview')
    advisorCard(page).querySelector('.what').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    assert.equal(page.find('#view-overview').hidden, true, 'the card itself opens the Advisor tab')
  } finally { await page.close() }
})

test('the hands line: a form ask of a chat with an app id opens that chat; a sign-in, or a chat without an app id, keeps the ask\'s window', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const fn = name => script.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, 'm'))[0]
  // A top-level const up to the blank line or the comment after it.
  const constant = name => script.match(new RegExp(`^const ${name} = [\\s\\S]*?(?=\\n\\n|\\n/)`, 'm'))[0]
  const views = vm.runInNewContext(`${[constant('APP_SESSION_PATTERN'), fn('openChatHref'), fn('waitLaneOf'), constant('chatHrefOf'), constant('cutWords')].join('\n')}
${script.slice(script.indexOf('// handsline:start'), script.indexOf('// handsline:end'))}\n;({ handsLineView, chatHrefOf })`, {})
  const lane = (name, appSession) => ({ name, appSession, isLeftover: false, state: 'waiting' })
  const state = { chats: [lane('Worker 1', WORKER_ID), lane('Worker 2', null)], advisor: lane('Advisor', APP_ID) }
  const need = (id, from, more = {}) => ({ id: `work:${id}`, workId: id, from, title: `${id} title`, hands: 'a popup in its chat', isForm: true, ...more })
  const view = views.handsLineView([
    need('Q1', 'Worker 1', { handsWords: 'Worker 1\'s chat waits on a popup: change directory' }),
    need('Q2', 'Worker 1', { isForm: false, hands: 'a sign-in', title: 'Sign in to the store' }),
    need('Q3', 'Worker 2', { handsWords: 'Worker 2\'s chat waits on a popup: change directory' }),
    need('Q4', 'Advisor', { handsWords: 'Advisor\'s chat waits on a popup: change directory' }),
  ], chat => views.chatHrefOf(state, chat))
  assert.deepEqual(view.items.map(one => one.href), [WORKER_LINK, '#details=Q2', '#details=Q3', APP_LINK])
  // A slim part (Needs your attention's view) gives the app ids by name: the same links; a name that is no app id gives none.
  assert.equal(views.chatHrefOf({ chats: [{ name: 'Worker 1', isRunning: true }], chatApps: { 'Worker 1': WORKER_ID } }, 'Worker 1'), WORKER_LINK)
  assert.equal(views.chatHrefOf({ chatApps: { 'Worker 1': 'local_Worker 1' } }, 'Worker 1'), null)
})

test('Pause all: a chat in its slow call to the board is no chat that asks you; the sweep still keeps its popup ask open', async () => {
  const { chatsAsking, pauseFacts } = await import('../src/work/pause.mjs')
  const lanes = [
    { name: 'Advisor', isAsking: true, state: 'working', boardCall: { since: Q744_FILED, ask: 'Q744' } },
    { name: 'Worker 1', isAsking: true, state: 'waiting', boardCall: null },
  ]
  const facts = pauseFacts({ pause: { state: 'pausing', since: NOW - 60_000 }, items: new Map(), lanes })
  assert.deepEqual(facts.asking, ['Worker 1'])
  assert.deepEqual(chatsAsking(lanes), ['Advisor', 'Worker 1'])
})

test('board-call popups: only the store\'s popup asks of the app\'s form count, and a popup whose call the board answered late counts once', () => {
  const work = storeFromText('## Work\n', { now: NOW })
  const chatAsk = parseItem([
    'Id: Q745', 'Kind: ask', 'Title: A popup in its chat may wait for you: it has tried to use workers (chat) for over a minute.', 'State: open', 'Owner: Advisor',
    `Filed: ${Q744_FILED}`, 'Asks: do', 'Blocking: no', 'Via: chat', '',
  ].join('\n'))
  for (const one of [Q742(), chatAsk]) work.items.set(one.head.get('Id'), one)
  assert.deepEqual(boardCallPopups(work).map(one => one.popup), ['Q742'], 'Via chat is no popup of the form')
  // The Supervisor: two popups 90 s apart. Alone they are two slow calls, in words that say they were stuck.
  const rule = WATCH_RULES.find(one => one.id === 'board-slow')
  const check = lateCalls => rule.check(buildView({ state: { lateCalls }, items: new Map(), now: Q742_FILED + 3 * MIN }), { seen: new Map(), observed: [] })
  const popups = [{ at: Q742_FILED, ms: 60_000, popup: 'Q742' }, { at: Q742_FILED + 90 * SEC, ms: 60_000, popup: 'Q744' }]
  assert.match(check(popups)[0].text, /: 2 work calls in 10 min stuck over a minute or answered after the chat gave up$/)
  // The call they stood for was answered late 50 s after the second one's filing: that one late call, never three (one alone fires nothing).
  assert.deepEqual(check([...popups, { at: Q742_FILED + 140 * SEC, ms: 200_000 }]), [])
  // From a minute before a popup's filing on, a late answer is its call too.
  assert.deepEqual(check([...popups, { at: Q742_FILED - 50 * SEC, ms: 70_000 }]), [])
  // A late answer before that is another call: all three count, and the words say some were stuck.
  const three = check([...popups, { at: Q742_FILED - 2 * MIN, ms: 70_000 }])
  assert.match(three[0].text, /: 3 work calls in 10 min stuck over a minute or answered after the chat gave up$/)
  assert.match(three[0].evidence, /\(Q742\).*\(Q744\)/)
  // Late answers alone: the words as before.
  assert.match(check([{ at: Q742_FILED, ms: 70_000 }, { at: Q742_FILED + 60 * SEC, ms: 70_000 }])[0].text, /: 2 work calls in 10 min answered after the chat gave up$/)
})

// Round 3 (the verifier's B, C e and D).

test('round 3 B: a stale board-call popup (its withdraw lost) hides no later real question: Waiting for you, the board\'s own card, the count', async () => {
  // The popup about workers (work) was filed 10 minutes ago; the chat asks again since 5 minutes ago and the mod could file nothing.
  const stale = popup('Q760', 'use workers (work)', { filed: NOW - 10 * MIN, owner: 'Worker 1' })
  const state = build([stale], { reports: [['Worker 1', 'asking', NOW - 5 * MIN]] })
  const lane = state.chats.find(one => one.name === 'Worker 1')
  assert.deepEqual([lane.state, lane.boardCall, lane.status], ['waiting', null, STATUSES.WAITING])
  assert.deepEqual(state.forYou.filter(need => need.from === 'Worker 1').map(need => need.title), ['Asked you a question in its chat'])
  const page = await openPage({ state: sent(state) })
  try {
    assert.match(page.text('#waits-for-you'), /^1 waits? for you$/)
    assert.match(page.text('#needs'), /Asked you a question in its chat/)
  } finally { await page.close() }
})

test('round 1 e: a board-call popup counts only in the asking spell it was filed in, never for an asleep chat, and its chat is no quiet chat', () => {
  // Filed 10 minutes before the chat began to ask (over 2 minutes before its spell): an old popup whose withdraw got lost: it waits.
  const old = build([popup('Q761', 'use workers (chat)', { filed: NOW - 10 * MIN })], { reports: [['Advisor', 'asking', NOW - 40 * SEC]] })
  assert.deepEqual([old.advisor.state, old.advisor.boardCall, old.advisor.status], ['waiting', null, STATUSES.WAITING])
  // Filed within 2 minutes before the spell began: its call.
  assert.equal(build([popup('Q762', 'use workers (chat)', { filed: NOW - 2 * MIN })], { reports: [['Advisor', 'asking', NOW - 40 * SEC]] }).advisor.state, 'working')
  // Its last report (asking since 11 minutes ago) is 10 minutes old and the app started after it: the chat is asleep, in no call.
  const asleep = build([Q744()], { reports: [['Advisor', 'asking', NOW - 11 * MIN, NOW - 10 * MIN]], appStartedAt: NOW - 5 * MIN })
  assert.equal(asleep.advisor.asleep, true)
  assert.equal(asleep.advisor.boardCall, null)
  assert.notEqual(asleep.advisor.status, STATUSES.WORKING)
  // A worker in its slow call whose transcript was last written 5 minutes ago is no quiet chat.
  const tails = { 'cli-Worker 1': { text: '', isCut: false, modifiedAt: NOW - 5 * MIN, earlier: null, usage: null } }
  const quiet = build([popup('Q763', 'use workers (work)', { filed: NOW - 30 * SEC, owner: 'Worker 1' })], { reports: [['Worker 1', 'asking']], tails }).chats.find(one => one.name === 'Worker 1')
  assert.deepEqual([quiet.state, quiet.boardCall?.ask, quiet.quietMs], ['working', 'Q763', null])
})

test('round 3 D: the old name of the Workers mod keeps its hyphen in a popup ask (popup.ts plainAction turns only _ into spaces)', () => {
  assert.equal(isBoardCallPopup(popup('Q1', 'use folder-branches (work)', { filed: 1 })), true)
  assert.equal(isBoardCallPopup(popup('Q1', 'use folder branches (work)', { filed: 1 })), true)
  assert.equal(isBoardCallPopup(popup('Q1', 'use folder-tools (work)', { filed: 1 })), false)
})
