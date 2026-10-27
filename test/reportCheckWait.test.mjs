// B740 (X92, 2026-10-27): B727's report check failed at 21:03 (a folder it could not remove, gone since) and its worker
// never reported it again, so it sat in review an hour while health's line said nothing of what it waits for. A step in
// review whose board check failed, with no report after it, waits for its worker to report again; once that wait passes
// 30 minutes of running time the worker is told once per failed check, and past an hour the rule review-stuck opens.
// These tests run B727's History lines through buildState (the server's own pass), the health summary, the rule and the
// delivery. Made-up names.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { memoryStore } from '../src/store.mjs'
import { healthSummary } from '../src/supervisor/health.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { deliverWork } from '../src/work/deliver.mjs'
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
const reportAgain = state => state.reconciled.says.filter(one => /report check failed/.test(one.say))
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

test('the word: 30 min of running time after the failed check, once per failed check, B727\'s 21:33', async () => {
  // Failed at 21:03, now 21:33: the word is due.
  const due = await build([failedAt(31)])
  const [word] = reportAgain(due)
  assert.equal(word.id, 'B1')
  assert.equal(word.chat, 'Digger')
  assert.equal(word.say, `work: B1's report check failed at ${clockOf(30)}: fix what it names and report it again`)
  assert.equal(word.key, `B1 Digger report-again ${stamp(ago(30))}`)
  // 29 min after the check: not yet.
  assert.deepEqual(reportAgain(await build([failedAt(29)])), [])
  // The board was off for 20 of the 30 minutes: 10 min of running time, not yet.
  assert.deepEqual(reportAgain(await build([failedAt(31)], { lines: [{ at: ago(26), gap: true }, { at: ago(6) }] })), [])
  // The person pauses: no word goes out (the delivery holds every line then).
  const outbox = memoryStore()
  await deliverWork({ state: { ...due, pause: { state: 'pausing', since: ago(5) } }, dir: 'C:\\nowhere', outbox, apply: async () => ({ ok: false }), now: NOW, maxChars: 2000, newId: () => 'm1' })
  assert.deepEqual(outbox.outbox(), [])
  // A new report ends it.
  assert.deepEqual(reportAgain(await build([failedAt(31, line(2, 'Digger', 'reported again'), line(2, 'server', 'check pending'))])), [])
})

test('the word goes once: the same failed check on the next refresh is not typed again; a second failed check is another word', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'report-again-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const outbox = memoryStore()
  let id = 0
  const deliver = state => deliverWork({ state, dir, outbox, apply: async () => ({ ok: false }), now: NOW, maxChars: 2000, newId: () => `m${id += 1}` })
  const state = await build([failedAt(31)])
  await deliver(state)
  await deliver(await build([failedAt(31)]))
  const words = outbox.outbox().filter(one => /report check failed/.test(one.text ?? one.pasteText ?? JSON.stringify(one)))
  assert.equal(words.length, 1)
  assert.equal(words[0].to, 'Digger')
  assert.match(JSON.stringify(words[0]), /B1's report check failed at \d\d:\d\d: fix what it names and report it again/)
  // The worker reports again, the check fails again: that is another failed check, so another word.
  const second = await build([failedAt(60, line(40, 'Digger', 'reported again'), line(40, 'server', 'check pending'), line(39, 'server', 'check failed: a branch of the step is left'))])
  assert.equal(reportAgain(second)[0].key, `B1 Digger report-again ${stamp(ago(39))}`)
})

test('review-stuck counts the wait: an hour of running time on, it opens; not before', async () => {
  const wordAt = minutes => ({ id: `w${minutes}`, to: 'Digger', command: 'work', about: 'B1', kind: 'check', at: ago(minutes), state: 'delivered', text: 'work: B1\'s report check failed' })
  for (const [report, outbox, opens] of [
    [40, [], false], // 40 min: under the hour
    [75, [wordAt(45)], true], // over the hour, the word typed 45 min ago and no report since
    [75, [wordAt(10)], true], // an hour of running time is late, whatever the word
    [75, [], true], // over the hour and no word at all (the worker's chat gone): worth naming
  ]) {
    const all = items(failedAt(report))
    const state = await build([...all.values()])
    const found = stuck(state, all, outbox)
    assert.equal(found.length, opens ? 1 : 0, `${report} min, ${outbox.length} words`)
    if (opens) {
      assert.equal(found[0].subject, 'B1')
      assert.match(found[0].text, /^B1 in review \d+ min: waits for Digger to report again: its report check failed at /)
    }
  }
})
