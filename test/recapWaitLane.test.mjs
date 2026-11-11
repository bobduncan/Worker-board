// The person's "1 yes" of 2026-11-11 (the live B1094 and Q715, 9 Nov): a worker whose step has an open ask kept for the goal's recap read
// "Stopped (interrupted)" and the day bar drew it in the warn colour. It reads quiet "waits for your recap of G60 (Q715)", linked to the
// goal's recap. Trimmed from the live records, made-up paths only. Read only: no hand-over, wake or timer is touched.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { laneFromReport } from '../src/chatReport.mjs'
import { toneOf } from '../src/chatStatus.mjs'
import { keptRecapWaitOf, stepStatusOf } from '../src/stepStatus.mjs'
import { DEFAULT_FLOW } from '../src/work/flow.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'
import { openPage } from './pageHarness.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 9, 17, 30).getTime()
const ago = minutes => NOW - minutes * MIN
const PREFIX = 'Garden · '
const PROJECT = 'C:\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Worker 1', 'Advisor']

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const B1094 = (state = 'in progress') => file({ Id: 'B1094', Kind: 'step', Title: 'Bridges test map painted whole', State: state, Owner: 'Worker 1', Activity: 'Garden', Goal: 'G60', Since: stamp(ago(20)) })
/** Q715 as it stood open: a kept look routed to the recap, not blocking (the step went on); `blocking: 'yes'` is the older shape. */
const Q715 = (more = {}) => file({ Id: 'Q715', Kind: 'ask', Title: 'Do the nine painted bridges read as bridges over lava?', State: 'open', Owner: 'Worker 1', Since: stamp(ago(20)), Filed: String(ago(20)), Asks: 'look', Blocking: 'no', Of: 'B1094', Route: 'recap', ...more },
  { Text: ['Do the nine painted bridges read as bridges over lava?'], Route: ["Autopilot keeps this look for the goal's recap"] })
const Q716 = (more = {}) => file({ Id: 'Q716', Kind: 'ask', Title: 'Which colour for the lava rim?', State: 'open', Owner: 'Worker 1', Since: stamp(ago(10)), Filed: String(ago(10)), Asks: 'decide', Blocking: 'yes', Of: 'B1094', Route: 'person', ...more }, { Text: ['Which colour for the lava rim?'] })

function build(items, { state = 'idle' } = {}) {
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
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: ago(300), offSince: null }, reports: new Map([report('Lead', ago(60)), report('Worker 1', ago(20)), report('Advisor', ago(60))]) })
}
const laneOf = (state, name = 'Worker 1') => state.chats.find(one => one.name === name)

test('B1094 and Q715: the worker reads quiet "waits for your recap of G60 (Q715)", Working, not Stopped, no warn tone, linked to the recap', () => {
  for (const blocking of ['no', 'yes']) {
    const lane = laneOf(build([B1094(), Q715({ Blocking: blocking })]))
    assert.equal(lane.status, 'Working', `Blocking ${blocking}`)
    assert.equal(lane.why, 'waits for your recap of G60 (Q715)')
    assert.equal(toneOf(lane.status), 'quiet')
    // The day bar draws the lane's state: working, never the interrupted state its warn colour belongs to.
    assert.equal(lane.state, 'working')
    assert.deepEqual(lane.recapWait.ids, ['Q715'])
  }
  const state = build([B1094(), Q715()])
  const status = state.stepStatus.B1094
  assert.deepEqual([status.kind, status.tone, status.words, status.link], ['recap', 'quiet', 'waits for your recap of G60 (Q715)', '#advice/goals/G60'])
})

test('an ordinary open blocking ask to the person still reads as before', () => {
  const plain = build([B1094('waiting on you'), Q716()])
  assert.equal(laneOf(plain).status, 'Waiting for you')
  assert.equal(stepStatusOf(B1094('waiting on you'), { items: new Map([['Q716', Q716()]]) }).kind, 'you')
  // Beside a recap ask it still stands: the step waits for the person.
  const both = build([B1094(), Q715(), Q716()])
  assert.equal(laneOf(both).status, 'Waiting for you')
  assert.equal(laneOf(both).recapWait, null)
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
})

test('the pure lane: waitsForRecap is working why recap, after the person\'s and the partner\'s waits', () => {
  const entry = { state: 'idle', since: NOW - MIN, at: NOW, busyAt: null }
  const base = { now: NOW, unknownAfterMs: 30_000, holdsTask: true, hasBlockingAsk: false, appRuns: null }
  assert.deepEqual(laneFromReport(entry, { ...base, waitsForRecap: true }), { state: 'working', isRunning: true, why: 'recap' })
  assert.equal(laneFromReport(entry, { ...base, waitsForRecap: true, hasBlockingAsk: true }).state, 'waiting')
  assert.equal(laneFromReport(entry, { ...base, waitsForRecap: true, waitsForPartner: true }).why, 'partner')
  assert.equal(laneFromReport(entry, base).state, 'interrupted')
})

test('the row says it quiet and links the recap: the lane card in the Working colours, the words a link to the goal', async () => {
  const state = JSON.parse(JSON.stringify(build([B1094(), Q715()])))
  const page = await openPage({ state, now: NOW })
  try {
    const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Worker 1')
    assert.ok(row !== undefined, 'Worker 1 has its row')
    const task = row.querySelector('.held-task')
    assert.match(task.textContent.replace(/\s+/g, ' ').trim(), /^B1094 Bridges test map painted whole · waits for your recap of G60 \(Q715\)$/)
    const link = task.querySelector('a.recap-wait')
    assert.equal(link.getAttribute('href'), '#advice/goals/G60')
    assert.ok(!row.classList.contains('is-interrupted'), 'not the warn lane')
    assert.ok(!row.querySelector('.is-interrupted, .pill.is-interrupted'), 'no warn pill or bar')
    assert.match(row.textContent, /Working/)
  } finally { await page.close() }
})
