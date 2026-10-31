// B737 (X86, 2026-10-27): Worker 3 reported B727 at 21:02, the board's check failed at 21:03 (a folder it could not
// remove) and Worker 3 rightly stayed in its turn to fix it. The rule not-cleared counted from 21:02 and filed X86, and
// the board gave Worker 3 B729 at 21:28 while B727's check still stood failed. A report whose check failed is handed
// back: no clear is owed for it and no new step is given, until the worker reports again and that check passes. These
// tests run B727's History lines through buildState (the server's own pass), then the `work next` words. (T8.5 step 6:
// the give and the words to the worker are the hand-over's, test/work/handover.test.mjs; the rule not-cleared is gone.)
// Made-up names.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { handedBackOf, lastReportOf } from '../src/clearOwed.mjs'
import { parseConfig } from '../src/config.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem, serializeItem } from '../src/work/item.mjs'
import { migrateBacklog, stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 27, 21, 30).getTime()
const ago = minutes => NOW - minutes * MIN
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const line = (minutes, who, what) => `- ${stamp(ago(minutes))} ${who}: ${what}`
const FAILED = 'check failed: a worktree of the step is left: C:/game-b1'
/** A step as the store holds it, with its History lines. */
const stepItem = (id, state, history, more = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: Digger\nSince: ${stamp(ago(60))}\n${more}\n## History\n${history.join('\n')}\n`)
/** The step the worker reported at 21:02 (28 minutes before) and whose check failed a minute later. */
const reportedAndFailed = (...after) => stepItem('B1', 'review', [line(40, 'Digger', 'queued → taken'), line(35, 'Digger', 'taken → in progress'), line(28, 'Digger', 'in progress → review'), line(28, 'server', 'check pending'), line(27, 'server', FAILED), ...after])
/** B2, the next task of the list: ready for any idle worker. */
const NEXT = () => parseItem(`Id: B2\nKind: step\nTitle: Step B2\nState: refined\nRefined: ready\nPriority: fix\nSince: ${stamp(ago(90))}\n`)

const app = name => JSON.stringify({
  title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: ago(2), lastAssistantUuid: 'u-1',
})
/** The report of a chat whose turn ended: idle and running. */
const idle = { state: 'idle', since: ago(20), busyAt: ago(28), background: false, at: ago(0.1), session: 'cli-Digger', mod: '0.20.0' }

function build(items, { afterStep = 'clear' } = {}) {
  const work = storeFromText('## Board\n', { now: ago(120) })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const raw = {
    listText: `{"prefix":"Team - ","main":"Lead"${afterStep === null ? '' : `,"afterStep":"${afterStep}"`}}`, appChatTexts: ['Lead', 'Digger'].map(app),
    tails: { 'cli-Lead': { text: '', isCut: false, modifiedAt: ago(1) }, 'cli-Digger': { text: '', isCut: false, modifiedAt: ago(20) } },
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(180),
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: { Lead: NOW - 5_000 }, other: {} },
    board: { startedAt: ago(60), offSince: null }, reports: new Map([['Digger', idle]]),
  })
}
const digger = state => state.chats.find(chat => chat.name === 'Digger')

test('B727\'s lines (report, check failed, no report again): no clear is owed and no new step is given', () => {
  const state = build([reportedAndFailed(), NEXT()])
  assert.equal(digger(state).state, 'free')
  assert.equal(digger(state).clearOwed, null)
  assert.deepEqual(state.reconciled.handedBack, ['Digger'])
})

test('the same lines with a check that passed: the clear is owed from the report and nothing holds the worker back', () => {
  const state = build([stepItem('B1', 'review', [line(28, 'Digger', 'in progress → review'), line(28, 'server', 'check pending'), line(27, 'server', 'check passed')]), NEXT()])
  assert.equal(digger(state).clearOwed.step, 'B1')
  assert.deepEqual(state.reconciled.handedBack, [])
})

test('reported again: a check that passed counts from the re-report; one still pending counts as a report; one that failed again hands it back', () => {
  const again = (...checks) => reportedAndFailed(line(10, 'Digger', 'reported again'), line(10, 'server', 'check pending'), ...checks)
  const passed = again(line(9, 'server', 'check passed'))
  assert.deepEqual(lastReportOf(new Map([['B1', passed]]), 'Digger'), { id: 'B1', at: ago(10) })
  assert.equal(handedBackOf(new Map([['B1', passed]]), 'Digger'), null)
  const state = build([passed, NEXT()])
  assert.deepEqual([digger(state).clearOwed.step, digger(state).clearOwed.reportedAt], ['B1', ago(10)])
  assert.deepEqual(state.reconciled.handedBack, [])
  assert.equal(handedBackOf(new Map([['B1', again()]]), 'Digger'), null)
  assert.equal(lastReportOf(new Map([['B1', again()]]), 'Digger').at, ago(10))
  const failedAgain = again(line(9, 'server', FAILED))
  assert.deepEqual(handedBackOf(new Map([['B1', failedAgain]]), 'Digger'), { id: 'B1', at: ago(10) })
  assert.equal(lastReportOf(new Map([['B1', failedAgain]]), 'Digger'), null)
})

test('a report whose check passed is the last report even when a newer step failed; the failed one is the one handed back', () => {
  const passed = stepItem('B0', 'done', [line(120, 'Digger', 'in progress → review'), line(119, 'server', 'check passed'), line(118, 'server', 'review → done')])
  const items = new Map([['B0', passed], ['B1', reportedAndFailed()]])
  assert.deepEqual(lastReportOf(items, 'Digger'), { id: 'B0', at: ago(120) })
  assert.deepEqual(handedBackOf(items, 'Digger'), { id: 'B1', at: ago(28) })
  // The result check's own lines are not the board's check of the report.
  const resultFailed = stepItem('B5', 'review', [line(28, 'Digger', 'in progress → review'), line(27, 'server', 'check passed'), line(20, 'Advisor', 'result check failed: 1 point')])
  assert.equal(handedBackOf(new Map([['B5', resultFailed]]), 'Digger'), null)
  assert.deepEqual(lastReportOf(new Map([['B5', resultFailed]]), 'Digger'), { id: 'B5', at: ago(28) })
})

test('a step taken on the old conversation after a report that passed: the clear is still owed for that report; a dropped step holds no hand-out', () => {
  const passed = stepItem('B1', 'done', [line(28, 'Digger', 'in progress → review'), line(27, 'server', 'check passed')])
  const taken = stepItem('B4', 'in progress', [line(5, 'Digger', 'queued → taken')])
  assert.deepEqual(build([passed, taken]).chats.find(chat => chat.name === 'Digger').clearOwed.step, 'B1')
  const dropped = reportedAndFailed(line(3, 'Lead', 'review → dropped'))
  dropped.head.set('State', 'dropped')
  assert.equal(handedBackOf(new Map([['B1', dropped]]), 'Digger'), null)
  assert.deepEqual(build([dropped, NEXT()]).reconciled.handedBack, [])
})

test('work next tells the worker to report the step again first; a passed check or a report again takes the words away', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hand-back-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('## Art\n', { now: ago(120) }), undefined, { now: ago(120) })
  const next = async item => {
    await writeFile(join(dir, 'B1.md'), serializeItem(item))
    return (await workApi({ action: 'next', chat: 'Digger' }, { dir, now: NOW, prefix: 'Team - ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, as: 'Digger' })).result?.text ?? ''
  }
  assert.match(await next(reportedAndFailed()), /The board's check of your report B1 failed: fix what it names and report B1 again first; the board gives you no new step/)
  assert.doesNotMatch(await next(stepItem('B1', 'review', [line(28, 'Digger', 'in progress → review'), line(27, 'server', 'check passed')])), /check of your report B1 failed/)
  assert.doesNotMatch(await next(reportedAndFailed(line(10, 'Digger', 'reported again'), line(10, 'server', 'check pending'))), /check of your report B1 failed/)
  assert.deepEqual((await readStore(dir)).items.has('B1'), true)
})
