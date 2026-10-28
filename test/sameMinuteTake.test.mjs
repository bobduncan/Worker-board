// B765 (X102, 2026-10-28): Worker 1 took B756 and reported it in the same minute (12:59, after a clear at 12:58). Times
// are kept to the minute, so the take counted as "at or after" the report and the rule not-cleared filed X102 at once.
// The reported step's own take, written before its report line, is no new step. These tests run those lines through
// buildState (the server's own pass) and the rule. Made-up names.

import assert from 'node:assert/strict'
import test from 'node:test'

import { takenSince } from '../src/clearOwed.mjs'
import { parseConfig } from '../src/config.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 28, 13, 2).getTime()
const ago = minutes => NOW - minutes * MIN
const PROJECT = 'C:\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const line = (minutes, who, what) => `- ${stamp(ago(minutes))} ${who}: ${what}`
const stepItem = (id, state, history) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: Digger\nSince: ${stamp(ago(60))}\n\n## History\n${history.join('\n')}\n`)
/** The real case: taken and reported in the same minute (3 minutes before), the check passed. */
const sameMinute = (...more) => stepItem('B1', 'review', [line(3, 'Digger', 'queued → taken'), line(3, 'Digger', 'taken → in progress'), line(3, 'Digger', 'in progress → review'), line(3, 'server', 'check passed'), ...more])

const app = name => JSON.stringify({
  title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: ago(2), lastAssistantUuid: 'u-1',
})
const idle = { state: 'idle', since: ago(1), busyAt: ago(3), background: false, at: ago(0.1), session: 'cli-Digger', mod: '0.20.0' }

function build(items) {
  const work = storeFromText('## Board\n', { now: ago(120) })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  const raw = {
    listText: '{"prefix":"Team - ","main":"Lead","afterStep":"clear"}', appChatTexts: ['Lead', 'Digger'].map(app),
    tails: { 'cli-Lead': { text: '', isCut: false, modifiedAt: ago(1) }, 'cli-Digger': { text: '', isCut: false, modifiedAt: ago(1) } },
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(180),
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: { Lead: NOW - 5_000 }, other: {} },
    board: { startedAt: ago(60), offSince: null }, reports: new Map([['Digger', idle]]),
  })
}
const notCleared = (state, items) => WATCH_RULES.find(one => one.id === 'not-cleared')
  .check(buildView({ state, items: new Map(items.map(one => [one.head.get('Id'), one])), settings: { notClearedMinutes: 10 }, now: NOW }), { seen: new Map(), observed: [] })

test('a step taken and reported in the same minute: its own take is no new step; the rule waits its minutes', () => {
  const items = [sameMinute()]
  const state = build(items)
  assert.equal(state.chats.find(chat => chat.name === 'Digger').clearOwed.step, 'B1')
  assert.deepEqual(takenSince(new Map([['B1', items[0]]]), 'Digger', ago(3), '', 'B1'), [])
  assert.deepEqual(notCleared(state, items), [])
})

test('another step taken in the report\'s minute still opens the rule at once', () => {
  const other = stepItem('B4', 'in progress', [line(3, 'Digger', 'queued → taken')])
  const items = [sameMinute(), other]
  assert.deepEqual(takenSince(new Map(items.map(one => [one.head.get('Id'), one])), 'Digger', ago(3), '', 'B1').map(one => one.id), ['B4'])
  assert.deepEqual(notCleared(build(items), items).map(one => one.key), ['not-cleared Digger B1'])
})

test('a take written after the report line, in the same step and minute, still counts (the order inside one History)', () => {
  const back = stepItem('B1', 'in progress', [line(3, 'Digger', 'in progress → review'), line(3, 'server', 'check passed'), line(3, 'Digger', 'queued → taken')])
  assert.deepEqual(takenSince(new Map([['B1', back]]), 'Digger', ago(3), '', 'B1').map(one => one.id), ['B1'])
})

test('without the reported step named, takenSince counts as before', () => {
  assert.deepEqual(takenSince(new Map([['B1', sameMinute()]]), 'Digger', ago(3)).map(one => one.id), ['B1'])
})
