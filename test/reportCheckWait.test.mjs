// B740 (X92, 2026-10-27): B727's report check failed at 21:03 (a folder it could not remove, gone since) and its worker
// never reported it again, so it sat in review an hour while health's line said nothing of what it waits for. A step in
// review whose board check failed, with no report after it, waits for its worker to report again. T8.5 step 6: the
// worker is told by its hand-over at its first turn's end without that report (handover.mjs `decide`, rule 3, tested in
// test/work/handover.test.mjs); the 30-minute word of the old pass and the report part of review-stuck are gone. These
// tests run B727's History lines through buildState (the server's own pass), the health summary and the rule. Made-up
// names.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { healthSummary } from '../src/supervisor/health.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { reviewWaitOf } from '../src/work/resultCheck.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 27, 21, 33).getTime()
const ago = minutes => NOW - minutes * MIN
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const clockOf = minutes => stamp(ago(minutes)).slice(11)

const line = (minutes, who, what) => `- ${stamp(ago(minutes))} ${who}: ${what}`
const FAILED = 'check failed: work in worker-board; the empty folder C:/game-b1 of a worktree is still there and could not be removed (EBUSY): a program still uses it'
const POINTS = '## What we build\n- one wait line in health\n'
const stepItem = (id, state, history, more = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: Digger\nActivity: Garden\nSince: ${stamp(ago(80))}\n${more}\n## History\n${history.join('\n')}\n\n${POINTS}`)
/** B727: reported `report` minutes ago, its check failed a minute later, nothing after. */
const failedAt = (report, ...after) => stepItem('B1', 'review', [line(report + 10, 'Digger', 'queued → taken'), line(report + 9, 'Digger', 'taken → in progress'), line(report, 'Digger', 'in progress → review'), line(report, 'server', 'check pending'), line(report - 1, 'server', FAILED), ...after])
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))

const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: ago(2), lastAssistantUuid: 'u-1' })
const idle = { state: 'idle', since: ago(20), busyAt: ago(28), background: false, at: ago(0.1), session: 'cli-Digger', mod: '0.20.0' }
function build(all, { lines = [], pause = null, outbox = [] } = {}) {
  const work = storeFromText('## Garden\n', { now: ago(240) })
  for (const item of all) {
    work.items.set(item.head.get('Id'), item)
    work.activities[0].steps.push(item.head.get('Id'))
  }
  if (pause !== null) work.pause = pause
  const raw = {
    listText: '{"prefix":"Team - ","main":"Lead","afterStep":"clear"}', appChatTexts: ['Lead', 'Digger'].map(app),
    tails: { 'cli-Lead': { text: '', isCut: false, modifiedAt: ago(1) }, 'cli-Digger': { text: '', isCut: false, modifiedAt: ago(20) } },
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(300),
  }
  return buildState(raw, { lines, outbox, runs: [], now: NOW, config, seen: { shown: { Lead: NOW - 5_000 }, other: {} }, board: { startedAt: ago(200), offSince: null }, reports: new Map([['Digger', idle]]) })
}
const viewOf = (state, all, more = {}) => buildView({ state, items: all, outbox: more.outbox ?? [], settings: {}, seen: null, now: NOW })
const healthLine = (state, all, id = 'B1') => healthSummary(viewOf(state, all), NOW).split('\n').find(one => one.includes(`${id} review`)) ?? ''
const stuck = (state, all, outbox = []) => WATCH_RULES.find(one => one.id === 'review-stuck').check(viewOf(state, all, { outbox }), { seen: new Map(), observed: [] })

test('B727\'s lines (report, check failed, nothing after): the step waits for its worker to report again, with when and why', () => {
  const wait = reviewWaitOf(failedAt(30), items(failedAt(30)))
  assert.equal(wait.kind, 'report')
  // The first clause that is no pass line, cut before its detail and at 80 characters.
  assert.equal(wait.text, `waits for Digger to report again: its report check failed at ${clockOf(29)} (the empty folder C:/game-b1 of a worktree is still there and could not be remove…)`)
  assert.equal(wait.since, ago(29) - (ago(29) % MIN))
  // The reason of an old check line that holds only the pass lines and one refusal, and a line with no reason at all.
  assert.match(reviewWaitOf(stepItem('B1', 'review', [line(30, 'Digger', 'in progress → review'), line(29, 'server', 'check failed: a worktree of the step is left: C:/game-b1')]), items()).text, /\(a worktree of the step is left\)$/)
  assert.match(reviewWaitOf(stepItem('B1', 'review', [line(30, 'Digger', 'in progress → review'), line(29, 'server', 'check failed')]), items()).text, /\(no reason given\)$/)
})

test('cases: a passed report check waits for its first check; a re-report waits for the new check; a dropped step says nothing', () => {
  const passed = stepItem('B1', 'review', [line(30, 'Digger', 'in progress → review'), line(29, 'server', 'check passed')])
  assert.equal(reviewWaitOf(passed, items(passed)).text, 'waits for its first check')
  const again = failedAt(30, line(10, 'Digger', 'reported again'), line(10, 'server', 'check pending'))
  assert.equal(reviewWaitOf(again, items(again)), null)
  const againPassed = failedAt(30, line(10, 'Digger', 'reported again'), line(10, 'server', 'check pending'), line(9, 'server', 'check passed'))
  assert.equal(reviewWaitOf(againPassed, items(againPassed)).text, 'waits for its first check')
  const failedTwice = failedAt(30, line(10, 'Digger', 'reported again'), line(9, 'server', 'check failed: a branch of the step is left'))
  assert.equal(reviewWaitOf(failedTwice, items(failedTwice)).text, `waits for Digger to report again: its report check failed at ${clockOf(9)} (a branch of the step is left)`)
  const dropped = failedAt(30, line(5, 'Lead', 'review → dropped'))
  dropped.head.set('State', 'dropped')
  assert.equal(reviewWaitOf(dropped, items(dropped)), null)
})

test('the server\'s own pass: health names the wait on the step\'s line and the step\'s card shows it', async () => {
  const all = items(failedAt(30))
  const state = await build([...all.values()])
  assert.match(healthLine(state, all), new RegExp(`waits for Digger to report again: its report check failed at ${clockOf(29)}`))
  assert.match(state.backlog.flatMap(activity => activity.steps).find(step => step.id === 'B1')?.reviewWait ?? '', new RegExp(`^waits for Digger to report again: its report check failed at ${clockOf(29)}`))
})

test('step 6: no word of the old pass, however long the wait, and review-stuck opens nothing for it: the hand-over tells the worker', async () => {
  for (const report of [31, 75, 240]) {
    const all = items(failedAt(report))
    const state = await build([...all.values()])
    assert.deepEqual(state.reconciled.says, undefined)
    // Its lane still says the check failed (a quiet line), with no word behind it.
    assert.deepEqual(state.chats.find(lane => lane.name === 'Digger').flags.map(flag => [flag.kind, flag.id]), [['check failed', 'B1']])
    assert.deepEqual(stuck(state, all), [], `${report} min`)
  }
})
