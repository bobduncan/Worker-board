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
export function build(items = [], { reports = [['Advisor', 'asking']], autopilot = true } = {}) {
  const work = storeFromText('## Work\n', { now: NOW - 60 * MIN })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  const raw = {
    listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: NAMES.map(app), tails: {}, planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: NOW - 5 * 60 * MIN,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config: { ...config, autopilot }, seen: { shown: Object.fromEntries(NAMES.map(name => [name, NOW - 5 * SEC])), other: {} }, board: { startedAt: NOW - 30 * MIN, offSince: null },
    reports: new Map(reports.map(([name, state]) => [name, { state, since: NOW - 40 * SEC, background: false, at: NOW - 2 * SEC, session: `cli-${name}`, mod: '0.27.0' }])),
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
  assert.equal(storeWaits(work).form.has('advisor'), true, 'the board still files no card of its own for it')
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

// The page: the Needs list and the Advisor's row, from the board's own state of the same case.

const { openPage } = await import('./pageHarness.mjs')
const sent = state => JSON.parse(JSON.stringify(state))
const rowOf = (page, name) => page.all('[data-lane]').find(one => one.dataset.lane === name)
const APP_LINK = `claude://claude.ai/epitaxy/${APP_ID}`

test('the page: a board-call popup shows nothing in Needs your attention, and the Advisor\'s row says Working with its slow call and no link into a chat', async () => {
  const page = await openPage({ state: sent(build([Q742(), Q744()])) })
  try {
    assert.equal(page.all('#needs .hands-line').length, 0, 'no hands line')
    assert.equal(page.text('#waits-for-you'), '', 'nothing waits for you')
    assert.equal(page.all('#needs [data-id^="work:"]').length, 0)
    const row = rowOf(page, 'Advisor')
    assert.equal(row.querySelector('.pill').textContent, 'Working')
    assert.equal(row.querySelector('.status-why').textContent, 'its call to the board is slow')
    assert.equal(row.querySelectorAll('.chat-link').length, 0)
  } finally { await page.close() }
})

test('the page: a real popup\'s entry in the hands line, the row\'s Waiting for you and the ask\'s window each open its chat in the app', async () => {
  const state = sent(build([Q742(), Q744(), REAL()]))
  const page = await openPage({ state })
  try {
    const entry = page.find('#needs .hands-line a')
    assert.equal(entry.getAttribute('href'), APP_LINK)
    assert.match(entry.getAttribute('title'), /^Opens Advisor's chat in the app: its question or popup waits there/)
    assert.match(page.text('#needs .hands-line'), /Advisor's chat waits on a popup: change directory/)
    const row = rowOf(page, 'Advisor')
    assert.equal(row.querySelector('.pill').textContent, 'Waiting for you')
    assert.equal(row.querySelector('a.chat-link').getAttribute('href'), APP_LINK)
  } finally { await page.close() }
  const window = await openPage({ state, hash: 'details=Q750' })
  try {
    const link = window.all('a.chat-link').find(one => one.textContent === 'Open its chat' && !one.closest('[data-lane]'))
    assert.equal(link?.getAttribute('href'), APP_LINK, 'the ask\'s window has "Open its chat"')
  } finally { await window.close() }
  // A chat the board has no app id for keeps the old entry: the ask's own window.
  const other = sent(build([popup('Q751', 'use ccd directory (change directory)', { filed: Q744_FILED, owner: 'Worker 1' })], { reports: [['Worker 1', 'asking']] }))
  const bare = await openPage({ state: { ...other, chats: other.chats.map(lane => ({ ...lane, appSession: null })) } })
  try {
    assert.equal(bare.find('#needs .hands-line a').getAttribute('href'), '#details=Q751')
  } finally { await bare.close() }
})
