// The person's "1 yes" of 2026-11-11 (the live B1094 and Q715, 9 Nov): a worker whose step has an open ask kept for the goal's recap read
// "Stopped (interrupted)" and the day bar drew it in the warn colour. The lead's ruling of 2026-11-11: it is never Working either (the
// chat does nothing while it waits): its lane is parked, P1's shape, kind recap, and reads quiet "Paused · waits for your recap of G60
// (Q715)", linked to the goal's recap; Resume all leaves it. Trimmed from the live records, made-up paths only. No hand-over, wake or
// timer logic is touched.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { toneOf } from '../src/chatStatus.mjs'
import { changes, today } from '../src/history.mjs'
import { keptRecapWaitOf, stepStatusOf } from '../src/stepStatus.mjs'
import { holderTimers } from '../src/work/holderTimers.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { pauseAnswer, pauseFacts } from '../src/work/pause.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'
import { openPage } from './pageHarness.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 9, 17, 30).getTime()
const ago = minutes => NOW - minutes * MIN
const PREFIX = 'Garden · '
const PROJECT = 'C:\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Worker 1', 'Worker 2', 'Advisor']
const WORDS = 'waits for your recap of G60 (Q715)'

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const B1094 = (state = 'in progress') => file({ Id: 'B1094', Kind: 'step', Title: 'Bridges test map painted whole', State: state, Owner: 'Worker 1', Activity: 'Garden', Goal: 'G60', Since: stamp(ago(20)) })
const B1095 = () => file({ Id: 'B1095', Kind: 'step', Title: 'Lava rim shader', State: 'in progress', Owner: 'Worker 2', Activity: 'Garden', Goal: 'G60', Since: stamp(ago(30)) })
/** Q715 as it stood open: a kept look routed to the recap, not blocking (the step went on); `blocking: 'yes'` is the older shape. */
const Q715 = (more = {}) => file({ Id: 'Q715', Kind: 'ask', Title: 'Do the nine painted bridges read as bridges over lava?', State: 'open', Owner: 'Worker 1', Since: stamp(ago(20)), Filed: String(ago(20)), Asks: 'look', Blocking: 'no', Of: 'B1094', Route: 'recap', ...more },
  { Text: ['Do the nine painted bridges read as bridges over lava?'], Route: ["Autopilot keeps this look for the goal's recap"] })
const Q716 = (more = {}) => file({ Id: 'Q716', Kind: 'ask', Title: 'Which colour for the lava rim?', State: 'open', Owner: 'Worker 1', Since: stamp(ago(10)), Filed: String(ago(10)), Asks: 'decide', Blocking: 'yes', Of: 'B1094', Route: 'person', ...more }, { Text: ['Which colour for the lava rim?'] })

function build(items, { state = 'idle', lines = [] } = {}) {
  const work = storeFromText('## Garden\n', { now: ago(300) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    if (item.head.get('Kind') === 'step') work.activities[0].steps.push(item.head.get('Id'))
  }
  const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: ago(40), lastAssistantUuid: 'u-1' })
  const tail = { text: '', isCut: false, modifiedAt: ago(40) }
  const report = (name, since) => [name, { state, since, background: false, run: 1, seq: 1, at: NOW - 5_000, session: `cli-${name}`, mod: '0.31.0', busyAt: null }]
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(300),
  }
  return buildState(raw, { lines, outbox: [], runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: ago(300), offSince: null }, reports: new Map([report('Lead', ago(60)), report('Worker 1', ago(20)), report('Worker 2', ago(25)), report('Advisor', ago(60))]) })
}
const laneOf = (state, name = 'Worker 1') => state.chats.find(one => one.name === name)
const storeOf = items => new Map(items.map(one => [one.head.get('Id'), one]))

test('B1094 and Q715: the worker is parked for the recap, Paused · "waits for your recap of G60 (Q715)", quiet, never Working nor Stopped', () => {
  for (const blocking of ['no', 'yes']) {
    const lane = laneOf(build([B1094(), Q715({ Blocking: blocking })]))
    assert.equal(lane.status, 'Paused', `Blocking ${blocking}`)
    assert.equal(lane.why, WORDS)
    assert.equal(toneOf(lane.status), 'quiet')
    assert.equal(lane.state, 'suspended')
    // P1's parked shape, kind recap: no limit, no named time; heldUntil keeps it safe (no until, never "the limit is back").
    const { since, ...shape } = lane.suspended
    assert.deepEqual(shape, { by: 'parked', kind: 'recap', on: ['the person'], what: 'your recap of G60 (Q715)', limit: null, link: '#advice/goals/G60', until: null, isBack: false })
    assert.equal(Math.floor(since / MIN), Math.floor(ago(20) / MIN))
  }
  const state = build([B1094(), Q715()])
  const status = state.stepStatus.B1094
  assert.deepEqual([status.kind, status.tone, status.words, status.link], ['recap', 'quiet', WORDS, '#advice/goals/G60'])
  // The day bar draws the lane's state as the history records it: the quiet suspended colour, never interrupted or working.
  const spans = today(changes(new Map(), state.chats, ago(10)), { from: ago(60), to: NOW, names: ['Worker 1'] })[0].spans
  assert.deepEqual(spans.map(one => one.state), ['suspended'])
  // No holder timer: no "go on" line and no give-back for a parked lane.
  assert.equal(holderTimers({ worker: laneOf(state), holding: B1094(), items: storeOf([B1094(), Q715()]), prefix: PREFIX, runningMs: () => 600 * MIN }), null)
})

test('Resume all does not wake it: neither the resume\'s waiting list nor the main chat\'s resume list names it; the other holder is', () => {
  const items = [B1094(), Q715(), B1095()]
  const state = build(items)
  const pause = { state: 'resuming', since: ago(1), pausedSince: ago(40) }
  const facts = pauseFacts({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX })
  assert.deepEqual(facts.waiting.map(one => one.chat), ['Worker 2'])
  const list = pauseAnswer({ pause, items: storeOf(items), lanes: state.chats, prefix: PREFIX, chat: 'Lead', role: 'main' }).resumeList
  assert.deepEqual(list.map(one => one.step), ['B1095'])
  // Without the recap ask it is resumed as every holder.
  assert.deepEqual(pauseFacts({ pause, items: storeOf([B1094(), B1095()]), lanes: state.chats, prefix: PREFIX }).waiting.map(one => one.chat), ['Worker 1', 'Worker 2'])
})

test('an ordinary open blocking ask to the person still reads "Waiting for you"', () => {
  const plain = build([B1094('waiting on you'), Q716()])
  assert.equal(laneOf(plain).status, 'Waiting for you')
  assert.equal(stepStatusOf(B1094('waiting on you'), { items: new Map([['Q716', Q716()]]) }).kind, 'you')
  // Beside a recap ask it still stands: the step waits for the person, and the lane is not parked.
  const both = build([B1094(), Q715(), Q716()])
  assert.equal(laneOf(both).status, 'Waiting for you')
  assert.equal(laneOf(both).suspended, null)
  assert.equal(keptRecapWaitOf(B1094(), [Q715(), Q716()]), null)
})

test('a worker really interrupted, with no such ask, still reads Stopped', () => {
  const none = laneOf(build([B1094()]))
  assert.equal(none.status, 'Stopped')
  assert.equal(none.state, 'interrupted')
  // A plain open ask of the person's non-blocking kind is no recap wait.
  assert.equal(laneOf(build([B1094(), Q715({ Route: 'person' })])).status, 'Stopped')
  // An answered recap ask waits for nothing.
  assert.equal(laneOf(build([B1094(), Q715({ State: 'answered' })])).status, 'Stopped')
  // A chat that is busy now is Working: the recap wait parks only a stopped chat.
  assert.equal(laneOf(build([B1094(), Q715()], { state: 'busy' })).status, 'Working')
})

test('the page: the pill reads Paused, its why links the recap, the row says it quiet, the day bar draws no warn colour', async () => {
  const first = build([B1094(), Q715()])
  const built = build([B1094(), Q715()], { lines: changes(new Map(), first.chats, ago(10)) })
  const state = JSON.parse(JSON.stringify(built))
  const page = await openPage({ state, now: NOW })
  try {
    const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Worker 1')
    assert.ok(row !== undefined, 'Worker 1 has its row')
    const pill = row.querySelector('.pill')
    assert.equal(pill.dataset.status, 'Paused')
    assert.ok(pill.classList.contains('is-paused'), 'the quiet paused pill')
    const why = row.querySelector('a.status-why.recap-wait')
    assert.ok(why !== null, 'the why is a link')
    assert.equal(why.getAttribute('href'), '#advice/goals/G60')
    assert.equal(`${pill.textContent} · ${why.textContent}`, `Paused · ${WORDS}`)
    const task = row.querySelector('.held-task')
    assert.match(task.textContent.replace(/\s+/g, ' ').trim(), /^B1094 Bridges test map painted whole · waits for your recap of G60 \(Q715\)$/)
    assert.equal(task.querySelector('a.recap-wait').getAttribute('href'), '#advice/goals/G60')
    assert.ok(!row.classList.contains('is-interrupted'), 'not the warn lane')
    assert.ok(!row.querySelector('.is-interrupted, .pill.is-working'), 'no warn pill, no Working pill')
    // The day bar: the quiet suspended colour, never the interrupted warn.
    assert.ok(page.all('.track .span.is-suspended').length > 0, 'a suspended span')
    assert.equal(page.all('.track .span.is-interrupted').length, 0)
  } finally { await page.close() }
})
