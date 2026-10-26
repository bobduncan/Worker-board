// The supervisor's Task 2: the watch rules (spec 2026-10-24, "What it checks"). Report only: each looks at one read-only
// view of the board (view.mjs `buildView`) and names what does not look right for longer than its threshold (the
// settings' `supervisor`). One test per rule from a small made-up board, plus Review Focus 1: a rule that throws is
// one finding "rule <id> failed" and the other rules still run. No word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { SUPERVISOR_DEFAULTS, configProblem, parseConfig } from '../../src/config.mjs'
import { runRules } from '../../src/supervisor/loop.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { COUNTS_BY_KEY, REPAIR_RULES } from '../../src/supervisor/rules/repair.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 9, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(60)), ...more }, sections)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const clockOf = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })
const LEAD = lane('Lead', { isMain: true, state: 'working' })
/** The timeline as state.mjs gives it: a chat's spans of state up to now. */
const span = (chat, state, fromMinutesAgo) => ({ chat, spans: [{ from: ago(fromMinutesAgo), to: NOW, state, task: null }] })

const view = (more = {}) => buildView({
  state: { chats: more.chats ?? [LEAD], today: more.today ?? [], limits: more.limits ?? {}, pause: more.pause ?? null, chatPrefix: '', readyList: more.readyList ?? null },
  items: more.items ?? new Map(), outbox: more.outbox ?? [], repairs: more.repairs ?? [], mods: more.mods ?? null,
  settings: more.settings ?? {}, now: more.now ?? NOW,
})
const rule = id => WATCH_RULES.find(one => one.id === id)
const check = (id, board, seen = new Map()) => {
  const observed = []
  const found = rule(id).check(board, { seen, observed })
  // what the rule watches now, beside its findings (not one of them)
  return Object.defineProperty(found, 'observed', { value: observed, enumerable: false })
}

test('the watch rules: eighteen, report only, each with what it says', () => {
  assert.deepEqual(WATCH_RULES.map(one => one.id), ['unknown-lane', 'stale-suspended', 'ready-while-free', 'holder-not-running', 'working-not-running', 'opus-wait', 'skip-repeats', 'repair-repeats', 'undelivered', 'report-check-twice', 'old-mod', 'odd-effort', 'review-stuck', 'dropped-fix', 'review-held', 'chain-long', 'open-fix', 'stale-checkpoint', 'effort-mismatch', 'not-cleared', 'not-taking', 'old-limit-reading'])
  // Redesign Part 2: the rules of Main's queues are gone.
  for (const gone of ['idle-while-waiting', 'queued-not-running']) assert.equal(WATCH_RULES.some(one => one.id === gone), false, gone)
  assert.ok(WATCH_RULES.every(one => one.kind === 'watch' && typeof one.says === 'string' && one.says.length > 0 && typeof one.check === 'function'))
})

test('the settings: the thresholds of the spec by default; config.json\'s supervisor sets any of them, and a wrong one stops the board', () => {
  assert.deepEqual({ ...SUPERVISOR_DEFAULTS }, { unknownMinutes: 10, suspendedMinutes: 10, idleMinutes: 10, notRunningMinutes: 30, opusWaitMinutes: 15, undeliveredMinutes: 10, repairsPerDay: 3, reviewMinutes: 60, checkWordMinutes: 30, openFixMinutes: 60, reportCheckMinutes: 10, checkpointMinutes: 120, reportMinutes: 30, switchMinutes: 10, notClearedMinutes: 10, oldReadingMinutes: 30, oldReadingIncidentMinutes: 60 })
  assert.deepEqual({ ...parseConfig('{}', {}).supervisor }, { ...SUPERVISOR_DEFAULTS })
  assert.equal(parseConfig('{ "supervisor": { "unknownMinutes": 20, "idleMinutes": -1 } }', {}).supervisor.unknownMinutes, 20)
  assert.equal(parseConfig('{ "supervisor": { "unknownMinutes": 20, "idleMinutes": -1 } }', {}).supervisor.idleMinutes, 10)
  assert.match(configProblem('{ "supervisor": { "idleMinutes": "ten" } }'), /"supervisor\.idleMinutes" must be a number above 0/)
  assert.match(configProblem('{ "supervisor": [] }'), /"supervisor" must be an object/)
  assert.equal(configProblem('{ "supervisor": { "repairsPerDay": 5 } }'), null)
})

test('unknown-lane: a worker unknown for 11 min trips, 9 min does not; never the main chat or a leftover', () => {
  const board = minutes => view({ chats: [LEAD, lane('Painter', { state: 'unknown', queue: [{ id: 'B482' }] })], today: [span('Painter', 'unknown', minutes)] })
  const found = check('unknown-lane', board(11))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['unknown-lane', 'unknown-lane Painter', 'Painter']])
  assert.equal(found[0].text, 'Painter unknown for 11 min, B482 waits')
  assert.match(found[0].evidence, /unknown since 08:49/)
  assert.equal(found[0].fix, undefined, 'report only')
  assert.deepEqual(check('unknown-lane', board(9)), [])
  assert.deepEqual(check('unknown-lane', view({ chats: [lane('Lead', { isMain: true, state: 'unknown' }), lane('Old', { isLeftover: true, state: 'unknown' })], today: [span('Lead', 'unknown', 60), span('Old', 'unknown', 60)] })), [])
  // A step the store queues for it waits on it too, also when the lane's queue does not show it.
  const queued = check('unknown-lane', view({ chats: [LEAD, lane('Painter', { state: 'unknown' })], today: [span('Painter', 'unknown', 12)], items: items(step('B9', 'queued', { Owner: 'Painter' }), step('B3', 'done', { Owner: 'Painter' })) }))
  assert.equal(queued[0].text, 'Painter unknown for 12 min, B9 waits')
  // Without a timeline, the runner's own watch: seen unknown since 11 min ago.
  const watched = check('unknown-lane', view({ chats: [LEAD, lane('Painter', { state: 'unknown' })] }), new Map([['unknown-lane Painter', ago(11)]]))
  assert.equal(watched.length, 1)
  assert.deepEqual(watched.observed, ['unknown-lane Painter'])
  // A threshold of its own in the settings.
  assert.deepEqual(check('unknown-lane', view({ chats: [LEAD, lane('Painter', { state: 'unknown' })], today: [span('Painter', 'unknown', 11)], settings: { unknownMinutes: 20 } })), [])
})

test('stale-suspended: suspended with its reset passed, or with usage under full after the stop, or past its limit\'s window', () => {
  const held = suspended => view({ chats: [LEAD, lane('Painter', { state: 'suspended', suspended })], limits: { fiveHour: { used: 40, level: 'ok', at: ago(1) }, week: { used: 20, level: 'ok', at: ago(1) } } })
  // Its reset passed 15 minutes ago, and it still stands suspended.
  const back = check('stale-suspended', held({ by: 'note', limit: 'fiveHour', since: ago(200), until: ago(15), isBack: true }))
  assert.deepEqual(back.map(one => [one.key, one.subject]), [['stale-suspended Painter', 'Painter']])
  assert.match(back[0].text, /^Painter suspended for the limit, but its reset at 08:45 has passed/)
  assert.deepEqual(check('stale-suspended', held({ by: 'note', limit: 'fiveHour', since: ago(200), until: ago(5), isBack: true })), [], 'a moment ago: the repair rule wakes it first')
  // The app stopped it at the limit, and a reading since shows room: 40% of the 5-hour limit, for 11 minutes now.
  const app = { by: 'app', limit: 'fiveHour', since: ago(60), until: null, isBack: false }
  const room = check('stale-suspended', held(app), new Map([['stale-suspended Painter', ago(11)]]))
  assert.equal(room.length, 1)
  assert.match(room[0].text, /the 5-hour limit shows 40% used/)
  assert.deepEqual(check('stale-suspended', held(app)), [], 'first seen now')
  // A stop older than its limit's window (three days for the 5-hour limit).
  const old = check('stale-suspended', held({ by: 'note', limit: 'fiveHour', since: ago(3 * 24 * 60), until: null, isBack: false }))
  assert.match(old[0].text, /its pause began \d+ h ago/)
  // A worker the limit still holds (the app's stop, its limit full) is no case.
  const full = view({ chats: [LEAD, lane('Painter', { state: 'suspended', suspended: app })], limits: { fiveHour: { used: 100, level: 'full', at: ago(1) } } })
  assert.deepEqual(check('stale-suspended', full, new Map([['stale-suspended Painter', ago(30)]])), [])
})

test('ready-while-free: a ready task kept for nobody waits 11 min while a worker whose report says free stands idle; 9 min, a kept task or a busy worker do not', () => {
  const free = (name, since = ago(40)) => lane(name, { state: 'free', report: { state: 'idle', since, background: false, at: ago(0) } })
  const ready = (...rows) => ({ ready: rows.map(row => ({ rank: 2, keptFor: null, keptUntil: null, pinned: null, ...row })), held: [] })
  const board = (more = {}) => view({ chats: [LEAD, free('Painter'), lane('Mason', { state: 'working' })], items: items(step('B5', 'refined', { Refined: 'ready' })), readyList: ready({ id: 'B5' }), ...more })
  const seen = minutes => new Map([['ready-while-free B5', ago(minutes)]])
  const found = check('ready-while-free', board(), seen(11))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['ready-while-free', 'ready-while-free B5', 'B5']])
  assert.equal(found[0].text, 'B5 ready for 11 min while Painter is free')
  assert.equal(found[0].fix, undefined, 'report only')
  assert.deepEqual(check('ready-while-free', board(), seen(9)), [])
  // The worker only just went free: counted from its report.
  assert.deepEqual(check('ready-while-free', board({ chats: [LEAD, free('Painter', ago(5))] }), seen(30)), [])
  // Kept for a busy worker (its pin or its follow-up): it waits for that one by design.
  assert.deepEqual(check('ready-while-free', board({ readyList: ready({ id: 'B5', keptFor: 'Mason' }) }), seen(30)), [])
  // No worker free by its own report: free by the board's older reading, busy, or stuck (the rule not-taking's).
  assert.deepEqual(check('ready-while-free', board({ chats: [LEAD, lane('Painter', { state: 'free' })] }), seen(30)), [])
  assert.deepEqual(check('ready-while-free', board({ chats: [LEAD, lane('Mason', { state: 'working' })] }), seen(30)), [])
  const stuck = lane('Painter', { state: 'free', report: { state: 'idle', since: ago(40), at: ago(0) }, flags: [{ kind: 'not taking', id: 'B4', text: 'x', button: null }] })
  assert.deepEqual(check('ready-while-free', board({ chats: [LEAD, stuck] }), seen(30)), [])
  // The review: a worker that holds a task given to it (its line may wait for its model) is no free worker.
  const holding = items(step('B5', 'refined', { Refined: 'ready' }), step('B7', 'queued', { Owner: 'Painter' }))
  assert.deepEqual(check('ready-while-free', board({ items: holding }), seen(30)), [])
  // Its Touches overlap a task under way: it waits by design.
  const touching = items(step('B5', 'refined', { Refined: 'ready' }, { Context: ['  Touches: src/a.mjs'] }), step('B6', 'in progress', { Owner: 'Mason' }, { Context: ['  Touches: src'] }))
  assert.deepEqual(check('ready-while-free', board({ items: touching }), seen(30)), [])
  // Not while the person pauses or a limit is full.
  assert.deepEqual(check('ready-while-free', board({ pause: { state: 'pausing', since: ago(5) } }), seen(30)), [])
  assert.deepEqual(check('ready-while-free', board({ limits: { week: { level: 'full' } } }), seen(30)), [])
})

test('holder-not-running: a step in progress whose worker has not run for 31 min trips; 29 min, or a running one, does not', () => {
  const board = (minutes, more = {}) => view({
    chats: [LEAD, lane('Painter', { state: 'off', isRunning: false, offSince: ago(minutes), ...more })],
    items: items(step('B7', 'in progress', { Owner: 'Painter' })),
  })
  const found = check('holder-not-running', board(31))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['holder-not-running B7', 'B7']])
  assert.equal(found[0].text, 'B7 is in progress for Painter, whose chat has not run for 31 min')
  assert.deepEqual(check('holder-not-running', board(29)), [])
  assert.deepEqual(check('holder-not-running', board(60, { state: 'working', isRunning: true, offSince: null })), [])
})

test('opus-wait: an opus step held for Opus for 16 min trips; 14 min does not', () => {
  const board = minutes => view({ chats: [LEAD, lane('Painter', { effortRun: { step: 'B9', waitsFor: { model: 'opus', since: ago(minutes), text: 'B9 waits for Opus' } } })] })
  const found = check('opus-wait', board(16))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['opus-wait B9', 'B9']])
  assert.equal(found[0].text, 'B9 waits for Opus for 16 min (Painter)')
  assert.deepEqual(check('opus-wait', board(14)), [])
})

test('skip-repeats: the same clear or compaction skipped for the same reason twice in a row trips; another reason, a first one or a reason by design does not', () => {
  const why = 'its conversation could not be saved as a log'
  const board = (at, reason = why) => view({ chats: [LEAD, lane('Painter', { compaction: { kind: 'skipped', at: ago(1), why: 'its last task is not reported yet', notCleared: { at, why: reason } } })] })
  const before = new Map([[`skip|Painter|clear|${ago(40)}|${why}`, ago(40)]])
  const found = check('skip-repeats', board(ago(2)), before)
  assert.deepEqual(found.map(one => [one.key, one.subject]), [[`skip-repeats Painter clear ${why}`, 'Painter']])
  assert.equal(found[0].text, `Painter: its clear was skipped twice in a row: ${why}`)
  // Both skips stay watched while it stands, so the next run finds it again.
  assert.ok(found.observed.includes(`skip|Painter|clear|${ago(40)}|${why}`) && found.observed.includes(`skip|Painter|clear|${ago(2)}|${why}`))
  assert.deepEqual(check('skip-repeats', board(ago(2), 'a subagent of it still runs'), before), [])
  const first = check('skip-repeats', board(ago(2)))
  assert.deepEqual(first, [])
  assert.ok(first.observed.includes(`skip|Painter|clear|${ago(2)}|${why}`), 'the first is kept for the next run')
  // The same skip seen again (the same time) is not a second one.
  assert.deepEqual(check('skip-repeats', board(ago(40)), before), [])
  // A compaction skipped because the chat is small is how it should be.
  const small = view({ chats: [lane('Lead', { isMain: true, compaction: { kind: 'skipped', at: ago(2), why: 'it is small enough' } })] })
  assert.deepEqual(check('skip-repeats', small, new Map([[`skip|Lead|compact|${ago(30)}|it is small enough`, ago(30)]])), [])
})

test('repair-repeats: the same repair three times in a day trips; twice, or once of them over a day ago, does not', () => {
  const repair = (minutes, subject = 'Painter') => ({ at: ago(minutes), rule: 'limit-back', subject, key: `limit-back ${subject} ${minutes}` })
  const found = check('repair-repeats', view({ repairs: [repair(300), repair(200), repair(10), repair(5, 'Mason')] }))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['repair-repeats limit-back Painter', 'Painter']])
  assert.equal(found[0].text, 'The board repaired the same 3 times in a day: limit-back for Painter')
  assert.deepEqual(check('repair-repeats', view({ repairs: [repair(200), repair(10)] })), [])
  assert.deepEqual(check('repair-repeats', view({ repairs: [repair(25 * 60), repair(200), repair(10)] })), [])
  assert.equal(check('repair-repeats', view({ repairs: [repair(200), repair(10)], settings: { repairsPerDay: 2 } })).length, 1)
})

test('repair-repeats (B551, X11): repairs from before its incident\'s fix was done never count again; three after it do, a restart one after it does not', () => {
  const wake = (minutes, more = {}) => ({ at: ago(minutes), rule: 'helper', subject: 'Helper', key: `helper Helper ${minutes}`, ...more })
  const history = lines => ({ History: lines.map(([minutes, words]) => `- ${stamp(ago(minutes))} ${words}`) })
  // X11: three wakes, the incident's first fix done 40 min ago, a second fix under way.
  const first = step('B546', 'done', { Since: stamp(ago(40)) }, history([[90, 'Lead: refined → queued'], [40, 'server: review → done']]))
  const second = step('B551', 'in progress')
  const incident = item({ Id: 'X11', Kind: 'incident', State: 'fix', Key: 'repair-repeats helper Helper', Fix: 'B551' },
    history([[180, 'server: opened by the rule repair-repeats'], [175, 'Advisor: fix B546'], [38, 'server: fixed: B546 is done'], [20, 'server: came back (seen 9 times)'], [19, 'Advisor: fix B551']]))
  const board = repairs => view({ repairs, items: items(first, second, incident) })
  const before = [wake(200), wake(130), wake(70)]
  assert.deepEqual(check('repair-repeats', board(before)), [], 'the three wakes the fix was made for')
  // The same minute as the fix's done line counts as before it.
  assert.deepEqual(check('repair-repeats', board([...before, wake(39.5), wake(30), wake(10)])), [])
  // Three new wakes after the fix, none after a restart: it trips again, on those three only.
  const again = check('repair-repeats', board([...before, wake(30), wake(20), wake(10)]))
  assert.deepEqual(again.map(one => one.key), ['repair-repeats helper Helper'])
  assert.equal(again[0].text, 'The board repaired the same 3 times in a day: helper for Helper')
  assert.match(again[0].evidence, /^at 08:30, 08:40, 08:50: /)
  // A wake after the fix that the app's restart caused is not counted.
  assert.deepEqual(check('repair-repeats', board([...before, wake(30, { cause: 'restart' }), wake(20), wake(10)])), [])
  // No fix done yet (only the one under way): the old wakes count as before.
  const unfixed = view({ repairs: before, items: items(second, item({ Id: 'X11', Kind: 'incident', State: 'fix', Key: 'repair-repeats helper Helper', Fix: 'B551' })) })
  assert.equal(check('repair-repeats', unfixed).length, 1)
  // Another incident's fix does not hide this one's repairs.
  const other = item({ Id: 'X12', Kind: 'incident', State: 'fixed', Key: 'repair-repeats helper Other', Fix: 'B546' })
  assert.equal(check('repair-repeats', view({ repairs: before, items: items(first, other) })).length, 1)
})

test('repair-repeats (B574, X25): a step unblocked once per finished blocker is no repeat; the same blocker three times is', () => {
  const unblock = (minutes, on) => ({ at: ago(minutes), rule: 'blocked', subject: 'B531', key: `blocked B531 ${on}` })
  // X25: B531 unblocked at 21:09, 21:43 and 21:46, from B549, B554 and B552.
  assert.deepEqual(check('repair-repeats', view({ repairs: [unblock(37, 'B549'), unblock(3, 'B554'), unblock(0, 'B552')] })), [])
  const same = check('repair-repeats', view({ repairs: [unblock(37, 'B549'), unblock(20, 'B549'), unblock(3, 'B549')] }))
  assert.deepEqual(same.map(one => [one.key, one.subject]), [['repair-repeats blocked B531 B549', 'B531']])
  assert.equal(same[0].text, 'The board repaired the same 3 times in a day: blocked for B531')
})

test('repair-repeats (B590, X37): a step waiting on several checks in turn is no repeat; the same pair three times is', () => {
  const wait = (minutes, on) => ({ at: ago(minutes), rule: 'review-wait', subject: 'B531', key: `review-wait B531 ${on}` })
  // X37: B531 waited at 22:07 behind B549 and B552, at 23:02 behind B555, each in review in turn.
  assert.deepEqual(check('repair-repeats', view({ repairs: [wait(55, 'B549'), wait(55, 'B552'), wait(0, 'B555')] })), [])
  const same = check('repair-repeats', view({ repairs: [wait(55, 'B555'), wait(30, 'B555'), wait(0, 'B555')] }))
  assert.deepEqual(same.map(one => [one.key, one.subject]), [['repair-repeats review-wait B531 B555', 'B531']])
  assert.equal(same[0].text, 'The board repaired the same 3 times in a day: review-wait for B531')
})

test('repair-repeats (B590): a rule whose key carries an hour still counts by its step', () => {
  const ready = (minutes, hour) => ({ at: ago(minutes), rule: 'focus-ready', subject: 'B12', key: `focus-ready B12 ${hour}` })
  const found = check('repair-repeats', view({ repairs: [ready(130, 0), ready(70, 1), ready(10, 2)] }))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['repair-repeats focus-ready B12', 'B12']])
})

test('repair-repeats (B590): the rules\' tables say which count by key, also a rule that is gone', () => {
  assert.deepEqual([...COUNTS_BY_KEY].sort(), ['blocked', 'review-wait'])
  assert.equal(REPAIR_RULES.find(rule => rule.id === 'blocked').countsBy, 'key')
  assert.equal(REPAIR_RULES.some(rule => rule.id === 'review-wait'), false)
})

test('undelivered: a word to a chat waiting 11 min trips, 9 min not; one that expired is undelivered too; held or delivered is not', () => {
  const word = (minutes, state = 'waiting', more = {}) => ({ id: `m${minutes}`, to: 'Painter', command: 'work', about: 'B5', at: ago(minutes), state, ...more })
  // B589: a work line's step is the store's (workLines.mjs): B5 stands queued for Painter, so a line about it matters.
  const board = outbox => view({ outbox, items: items(step('B5', 'queued', { Owner: 'Painter' })) })
  const found = check('undelivered', board([word(11), word(3)]))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['undelivered Painter', 'Painter']])
  assert.equal(found[0].text, '1 word to Painter not delivered, the oldest for 11 min')
  assert.deepEqual(check('undelivered', board([word(9)])), [])
  assert.equal(check('undelivered', board([word(30, 'expired')])).length, 1)
  assert.deepEqual(check('undelivered', board([word(30, 'held'), word(30, 'delivered'), word(300, 'expired')])), [], 'an expired one of hours ago is history')
  // A word held by the person's pause counts from its release.
  assert.deepEqual(check('undelivered', board([word(40, 'waiting', { releasedAt: ago(4) })])), [])
})

test('B532 undelivered: a word the outbox sweep drops is not named, nor an answer past its keep; a word still needed is', () => {
  const at = ago(30)
  const outbox = [
    { id: 'r1', to: 'Painter', command: 'refine', about: 'B5', at, state: 'waiting' },
    { id: 'r2', to: 'Painter', command: 'refine', about: 'B5', at: ago(20), state: 'delivered' },
    { id: 'c1', to: 'Painter', command: 'result-check', about: 'B6', at, state: 'waiting' },
    { id: 'a1', to: 'Painter', ask: 'work:Q3', step: 'Q3', at: ago(3 * 24 * 60), state: 'waiting' },
  ]
  const board = more => view({ items: items(step('B5', 'new'), step('B6', 'done')), outbox, ...more })
  assert.deepEqual(check('undelivered', board()), [], 'superseded, its step done, an old answer')
  const needed = { id: 'c2', to: 'Painter', command: 'result-check', about: 'B7', at, state: 'waiting' }
  const found = check('undelivered', view({ items: items(step('B7', 'review')), outbox: [...outbox, needed] }))
  assert.deepEqual(found.map(one => one.evidence), [`${clockOf(at)} result-check B7 (waiting)`])
})

test('report-check-twice: a step whose board check failed twice since its last pass trips; once, or passed after, does not', () => {
  const line = (minutes, words) => `- ${stamp(ago(minutes))} server: ${words}`
  const board = (...history) => view({ items: items(step('B12', 'review', { Owner: 'Painter' }, { History: history })) })
  const found = check('report-check-twice', board(line(90, 'check passed: merged'), line(60, 'check failed: the branch b12 is still there'), line(20, 'check failed: the worktree is left')))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['report-check-twice B12', 'B12']])
  assert.equal(found[0].text, 'B12: the board\'s check failed 2 times in a row (Painter): the worktree is left')
  assert.deepEqual(check('report-check-twice', board(line(60, 'check failed: x'))), [])
  assert.deepEqual(check('report-check-twice', board(line(60, 'check failed: x'), line(40, 'check failed: y'), line(20, 'check passed: merged'))), [])
  assert.deepEqual(check('report-check-twice', view({ items: items(step('B12', 'done', {}, { History: [line(60, 'check failed: x'), line(40, 'check failed: y')] })) })), [])
})

test('B663 (X67): report-check-twice waits reportCheckMinutes after the second failure and is quiet once a check passed', () => {
  // B614: failed 22:31 and 22:32, passed 22:34.
  const at = (hour, minute) => new Date(2026, 9, 24, hour, minute).getTime()
  const line = (when, words) => `- ${stamp(when)} server: ${words}`
  const history = [line(at(22, 31), 'check failed: a'), line(at(22, 32), 'check failed: b')]
  const board = (now, ...more) => view({ now, items: items(step('B614', 'review', { Owner: 'Painter' }, { History: [...history, ...more] })) })
  assert.deepEqual(check('report-check-twice', board(at(22, 33))), [], 'one minute after the second failure: the worker is correcting its report')
  assert.deepEqual(check('report-check-twice', board(at(22, 42))), [], 'exactly the wait: not over it')
  assert.deepEqual(check('report-check-twice', board(at(22, 43), line(at(22, 34), 'check passed: merged'))), [], 'a pass ends the case')
  const found = check('report-check-twice', board(at(22, 43)))
  assert.deepEqual(found.map(one => [one.key, one.since]), [['report-check-twice B614', at(22, 32)]], 'no pass, over the wait: a case since the second failure')
  const longer = view({ now: at(22, 43), settings: { reportCheckMinutes: 30 }, items: items(step('B614', 'review', {}, { History: history })) })
  assert.deepEqual(check('report-check-twice', longer), [], 'the wait is a setting')
})

// B570: idle since 45 minutes, past the half hour in which the board has an idle chat restarted.
const IDLE = { idle: { since: ago(45) } }
/** B570: the board's first word to restart each chat, 40 minutes ago, for an installed version. */
const asked = (version, ...names) => names.map(name => ({ id: `r-${name}`, command: 'mod-restart', about: name, version, at: ago(40), state: 'taken', text: 'restart for mod' }))

test('old-mod: a chat on a Workers mod older than the one installed trips; the same, or one not known, does not', () => {
  const board = chats => view({ chats: [LEAD, lane('Painter', IDLE), lane('Mason', IDLE)], mods: { installed: '0.15.0', chats }, outbox: asked('0.15.0', 'Painter', 'Mason') })
  const found = check('old-mod', board({ Painter: '0.14.2', Mason: '0.15.0' }))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['old-mod 0.15.0', 'board']])
  assert.equal(found[0].text, 'Painter runs an older Workers mod, idle over 30 min after the board asked to restart it; 0.15.0 is installed')
  assert.equal(found[0].evidence, 'installed 0.15.0; Painter 0.14.2 (it misses what came after 0.14.2)')
  assert.deepEqual(check('old-mod', board({ Painter: '0.15.0' })), [])
  assert.deepEqual(check('old-mod', view({ chats: [LEAD, lane('Painter')], mods: null })), [])
  assert.match(check('old-mod', board({ Painter: '0.9.9' }))[0].text, /^Painter runs/, 'compared as numbers, not as text')
  assert.deepEqual(check('old-mod', board({ Painter: '0.15.1' })), [])
})

test('B570: old-mod trips only for a chat idle on the older mod over 30 min: one busy, or idle less long, the board restarts', () => {
  const board = (more, outbox = asked('0.17.0', 'Painter')) => view({ chats: [LEAD, lane('Painter', more)], mods: { installed: '0.17.0', chats: { Painter: '0.16.1' } }, outbox })
  assert.equal(check('old-mod', board(IDLE)).length, 1)
  assert.deepEqual(check('old-mod', board(IDLE, [])), [], 'not asked yet (right after an install): its word goes first')
  assert.deepEqual(check('old-mod', board({ idle: { since: ago(20) } })), [], 'idle 20 min: its restart is on its way')
  assert.deepEqual(check('old-mod', board({ ...IDLE, state: 'working' })), [], 'busy: restarted after its step')
  assert.deepEqual(check('old-mod', board({ ...IDLE, isRunning: false })), [], 'not running: it starts on the installed mod')
  assert.deepEqual(check('old-mod', board({})), [], 'no idle time known')
})

test('the review: old-mod counts a chat whose mod asked without saying its version (null) as older than 0.16.0, once that is installed', () => {
  const board = (installed, chats) => view({ chats: [LEAD, lane('Painter', IDLE), lane('Mason', IDLE)], mods: { installed, chats }, outbox: asked(installed, 'Painter', 'Mason') })
  const found = check('old-mod', board('0.16.0', { Painter: null, Mason: '0.16.0' }))
  assert.deepEqual(found.map(one => [one.key, one.subject, one.text]), [['old-mod 0.16.0', 'board', 'Painter runs an older Workers mod, idle over 30 min after the board asked to restart it; 0.16.0 is installed']])
  // While an older mod is installed, no chat says its version: nothing to report.
  assert.deepEqual(check('old-mod', board('0.15.0', { Painter: null, Mason: null })), [])
})

test('B541: three chats on an old mod (the main chat and the partner too) are one finding naming all three, keyed by the installed version', () => {
  const board = chats => buildView({
    state: { chats: [{ ...LEAD, state: 'free', ...IDLE }, lane('Painter', IDLE), lane('Mason', IDLE)], advisor: { name: 'Guide', state: 'free', ...IDLE }, chatPrefix: '' },
    mods: { installed: '0.16.0', chats }, outbox: asked('0.16.0', 'Lead', 'Painter', 'Mason', 'Guide'), now: NOW,
  })
  const found = check('old-mod', board({ Lead: null, Painter: '0.15.2', Mason: '0.16.0', Guide: null }))
  // One per chat would be three findings here: the fix of X4-X6 is one.
  assert.equal(found.length, 1)
  assert.deepEqual([found[0].key, found[0].subject, found[0].text], ['old-mod 0.16.0', 'board', 'Lead, Painter and Guide run an older Workers mod, idle over 30 min after the board asked to restart it; 0.16.0 is installed'])
  assert.equal(found[0].evidence, 'installed 0.16.0; Lead older than 0.16.0 (it says no version and misses the newer work calls); Painter 0.15.2 (it misses what came after 0.15.2); Guide older than 0.16.0 (it cannot name the fix of an incident)')
  // The same key while it lasts, whoever is on it: one incident counts up.
  assert.equal(check('old-mod', board({ Painter: '0.15.2' }))[0].key, 'old-mod 0.16.0')
  assert.deepEqual(check('old-mod', board({ Lead: '0.16.0', Painter: '0.16.0', Mason: '0.16.0', Guide: '0.16.0' })), [])
})

test('B544: odd-effort names a chat whose effort is not a level, once; the partner\'s mode object beside its level is no case', () => {
  const board = (more = {}) => buildView({
    state: { chats: [LEAD, lane('Painter', { effort: more.painter ?? 'high' })], advisor: { name: 'Guide', appEffort: more.guide ?? 'xhigh', effort: { mode: 'usual', runsOn: null } }, chatPrefix: '' },
    now: NOW,
  })
  assert.deepEqual(check('odd-effort', board()), [], 'levels, the partner\'s mode object, and a chat that says none (Lead)')
  const found = check('odd-effort', board({ painter: 'ultra', guide: { mode: 'high' } }))
  assert.deepEqual(found.map(one => [one.key, one.subject, one.text]), [
    ['odd-effort Painter ultra', 'Painter', 'Painter\'s effort reads "ultra", not a level'],
    ['odd-effort Guide {"mode":"high"}', 'Guide', 'Guide\'s effort reads "{"mode":"high"}", not a level'],
  ])
  // An object with its level, as effortOf gives one, is that level.
  assert.deepEqual(check('odd-effort', board({ painter: { level: 'max', why: null, isSet: true } })), [])
})

test('Review Focus 1: a rule that throws is one finding "rule <id> failed" and the other rules still run', () => {
  const boom = { id: 'boom', kind: 'watch', says: 'a rule with bad data', check: () => { throw new Error('cannot read the file') } }
  const board = view({ chats: [LEAD, lane('Painter', { state: 'unknown' })], today: [span('Painter', 'unknown', 30)] })
  const done = runRules([boom, ...WATCH_RULES], board, { seen: new Map(), observed: [] })
  assert.deepEqual(done.failed.map(one => [one.rule, one.key, one.text]), [['boom', 'rule-failed boom', 'rule boom failed: cannot read the file']])
  assert.deepEqual(done.findings.map(one => one.rule), ['unknown-lane'])
})

test('the view is read only: a rule cannot change it', () => {
  const board = view({ chats: [LEAD] })
  assert.ok(Object.isFrozen(board))
  assert.throws(() => { 'use strict'; board.lanes = [] })
})

// The review of Part 1 (2026-10-24).

test('the review: during Pause all, and the resume after it, no rule speaks of chats that stand still or words held (rules 2, 4, 5, 8)', () => {
  const board = pause => view({
    chats: [
      lane('Lead', { isMain: true, state: 'free', isRunning: false }),
      lane('Painter', { state: 'off', isRunning: false, offSince: ago(70) }),
      lane('Mason', { state: 'free', effortRun: { step: 'B8', waitsFor: { model: 'opus', since: ago(60), text: 'B8 waits for Opus' } } }),
      lane('Sleeper', { state: 'suspended', suspended: { by: 'note', limit: 'fiveHour', since: ago(300), until: ago(40), isBack: true } }),
    ],
    items: items(step('B7', 'in progress', { Owner: 'Painter' })),
    outbox: [{ id: 'm1', to: 'Lead', command: 'note', at: ago(50), state: 'waiting' }],
    pause,
  })
  const seen = new Map([['holder-not-running B7', ago(60)], ['opus-wait B8', ago(60)], ['stale-suspended Sleeper', ago(60)]])
  for (const pause of [{ state: 'pausing', since: ago(60) }, { state: 'resuming', since: ago(5) }]) {
    for (const rule of WATCH_RULES) assert.deepEqual(rule.check(board(pause), { seen, observed: [] }), [], `${rule.id} while ${pause.state}`)
  }
  // Running again since 5 minutes: the pause's time does not count; the same board says nothing yet.
  const after = board({ state: 'running', since: ago(5) })
  for (const id of ['holder-not-running', 'opus-wait', 'stale-suspended', 'undelivered']) assert.deepEqual(check(id, after, seen), [], id)
  // ... and once the thresholds have passed since the resume, it speaks again.
  const later = board({ state: 'running', since: ago(45) })
  assert.deepEqual(['holder-not-running', 'opus-wait', 'stale-suspended', 'undelivered'].map(id => check(id, later, seen).length), [1, 1, 1, 1])
})

test('the review: at a full limit, a step held by a worker that does not run, or an opus step waiting, is no case; nor a holder suspended for the limit', () => {
  const board = (limits, holder = { state: 'off', isRunning: false, offSince: ago(70) }) => view({
    chats: [LEAD, lane('Painter', holder), lane('Mason', { state: 'free', effortRun: { step: 'B8', waitsFor: { model: 'opus', since: ago(60), text: '' } } })],
    items: items(step('B7', 'in progress', { Owner: 'Painter' })), limits,
  })
  const full = { fiveHour: { used: 100, level: 'full', at: ago(1) } }
  assert.deepEqual([check('holder-not-running', board(full)), check('opus-wait', board(full))], [[], []])
  assert.deepEqual([check('holder-not-running', board({})).length, check('opus-wait', board({})).length], [1, 1])
  const suspended = board({}, { state: 'suspended', isRunning: false, offSince: ago(70), suspended: { by: 'app', limit: 'fiveHour', since: ago(70), until: null, isBack: false } })
  assert.deepEqual(check('holder-not-running', suspended), [])
})

test('the review: a compaction skipped because more of the same work follows is by design, as the Workers mod means it', () => {
  const why = 'more of the same work follows'
  const board = view({ chats: [LEAD, lane('Painter', { compaction: { kind: 'skipped', at: ago(2), why } })] })
  assert.deepEqual(check('skip-repeats', board, new Map([[`skip|Painter|compact|${ago(40)}|${why}`, ago(40)]])), [])
})

test('B547: not-cleared names a worker whose last report is newer than its last clear, once per report: at once when it took a new step, else after 10 min', () => {
  const reported = (id, minutes, who = 'Painter') => `- ${stamp(ago(minutes))} ${who}: in progress → review`
  const taken = (minutes, who = 'Painter') => `- ${stamp(ago(minutes))} ${who}: queued → taken`
  const owed = more => ({ step: 'B12', reportedAt: ago(30), clearedAt: ago(90), why: null, canClear: true, ...more })
  const board = (clearOwed, more = {}) => view({
    chats: [LEAD, lane('Painter', { clearOwed })],
    items: items(step('B12', 'done', {}, { History: [reported('B12', 30)] }), step('B13', 'in progress', {}, { History: more.took ? [taken(20)] : [] })),
    settings: more.settings ?? {},
  })
  // Cleared since its report: nothing owed, no case.
  assert.deepEqual(check('not-cleared', board(null, { took: true })), [])
  // It took B13 on the old conversation: a finding at once, with the repair.
  const found = check('not-cleared', board(owed(), { took: true, settings: { notClearedMinutes: 600 } }))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject, one.text]), [['not-cleared', 'not-cleared Painter B12', 'Painter', 'Painter took B13 on the conversation of B12: not cleared after that report (no reason logged)']])
  assert.match(found[0].evidence, new RegExp(`^last report B12 at ${clockOf(ago(30))}; last clear at ${clockOf(ago(90))}; took B13 at ${clockOf(ago(20))}; repair: the board holds its next step`))
  // No new step: only after notClearedMinutes, with the mod's why; an older mod's repair is the restart.
  assert.deepEqual(check('not-cleared', board(owed(), { settings: { notClearedMinutes: 31 } })), [])
  const late = check('not-cleared', board(owed({ why: 'its conversation could not be saved as a log (Background work it started is still running)', canClear: false })))
  assert.deepEqual(late.map(one => one.text), ['Painter not cleared 30 min after it reported B12: its conversation could not be saved as a log (Background work it started is still running)'])
  assert.match(late[0].evidence, /older than 0\.17\.0 and cannot run a clear the board names: its chat needs a restart/)
  // The person pauses: the chats stand still on purpose.
  assert.deepEqual(check('not-cleared', view({ chats: [LEAD, lane('Painter', { clearOwed: owed() })], pause: { state: 'pausing', since: ago(5) } })), [])
})

test('B584: the findings name when their case began (since): not-cleared its take or its report, undelivered its oldest word, report-check-twice its second failure', () => {
  const owed = { step: 'B12', reportedAt: ago(30), clearedAt: ago(90), why: null, canClear: true }
  const took = view({
    chats: [LEAD, lane('Painter', { clearOwed: owed })],
    items: items(step('B12', 'done'), step('B13', 'in progress', {}, { History: [`- ${stamp(ago(20))} Painter: queued → taken`] })),
    settings: { notClearedMinutes: 600 },
  })
  assert.deepEqual(check('not-cleared', took).map(one => one.since), [ago(20)])
  const late = view({ chats: [LEAD, lane('Painter', { clearOwed: owed })], items: items(step('B12', 'done')) })
  assert.deepEqual(check('not-cleared', late).map(one => one.since), [ago(30)])
  const word = minutes => ({ id: `m${minutes}`, to: 'Painter', command: 'work', about: 'B5', at: ago(minutes), state: 'waiting' })
  assert.deepEqual(check('undelivered', view({ outbox: [word(12), word(40), word(20)], items: items(step('B5', 'queued', { Owner: 'Painter' })) })).map(one => one.since), [ago(40)])
  const line = (minutes, words) => `- ${stamp(ago(minutes))} server: ${words}`
  const twice = view({ items: items(step('B12', 'review', {}, { History: [line(90, 'check failed: a'), line(80, 'check passed: merged'), line(60, 'check failed: b'), line(40, 'check failed: c'), line(20, 'check failed: d')] })) })
  assert.deepEqual(check('report-check-twice', twice).map(one => one.since), [ago(40)])
})

test('not-taking: a worker the board took a task back from while it sat idle, once per take-back, about the worker', () => {
  const flagged = since => lane('Painter', { state: 'free', report: { state: 'idle', since, at: ago(0) }, flags: [{ kind: 'not taking', id: 'B4', text: 'Stuck: did not take B4 within 2 min; it went back on the list', button: null }] })
  const back = items(step('B4', 'refined', { Refined: 'ready' }, { History: [`- ${stamp(ago(3))} server: queued → refined (taken back from Painter: not taken within 2 min; stuck)`] }))
  const found = check('not-taking', view({ chats: [LEAD, flagged(ago(10))], items: back }))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['not-taking', `not-taking Painter ${stamp(ago(3))}`, 'Painter']])
  assert.equal(found[0].text, 'Painter did not take B4; it went back on the list')
  assert.match(found[0].evidence, /^Stuck: did not take B4 within 2 min; it went back on the list; taken back at /)
  // No flag (it reported anew since): nothing.
  assert.deepEqual(check('not-taking', view({ chats: [LEAD, lane('Painter', { state: 'free', report: { state: 'idle', since: ago(1), at: ago(0) }, flags: [] })], items: back })), [])
})

test('gap 3: ready-while-free counts only what the board hands out: never a task held outside the focus goal; a task pinned to the free worker does', async () => {
  const free = (name, since = ago(40)) => lane(name, { state: 'free', report: { state: 'idle', since, background: false, at: ago(0) } })
  const list = (ready, held) => ({ ready: ready.map(row => ({ rank: 1, keptFor: null, keptUntil: null, pinned: null, ...row })), held })
  const OUTSIDE = 'outside the focus goal: waits until you pin it or switch the focus'
  const board = readyList => view({ chats: [LEAD, free('Painter')], items: items(step('B5', 'refined', { Refined: 'ready' }), step('B6', 'refined', { Refined: 'ready' })), readyList })
  const seen = new Map([['ready-while-free B5', ago(30)], ['ready-while-free B6', ago(30)]])
  // Refined tasks outside the focus goal wait for the person by design: no finding while a worker is free.
  assert.deepEqual(check('ready-while-free', board(list([], [{ id: 'B5', why: OUTSIDE }, { id: 'B6', why: OUTSIDE }])), seen), [])
  // A task pinned to the worker that stands free: the board failed to give it.
  const pinned = check('ready-while-free', board(list([{ id: 'B6', keptFor: 'Painter', pinned: 'Painter' }], [{ id: 'B5', why: OUTSIDE }])), seen)
  assert.deepEqual(pinned.map(one => one.subject), ['B6'])
  assert.equal(pinned[0].text, 'B6 ready for 30 min while Painter is free')
  // The sweep's instructions say the same: idle workers beside tasks outside the focus goal are no incident.
  const role = (await readFile(new URL('../../roles/supervisor.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ')
  assert.match(role, /Refined tasks outside the focus goal wait for the person's pin or a focus switch by design .* workers idle while only such tasks wait is no incident/)
})

test('old-limit-reading (X47, B632, B645): a limit still last read over 60 min ago (a lookup past 30 min comes first) while a worker works, not while the person pauses; one finding per limit; a newer reading clears it', async () => {
  const limits = (five, week) => ({ fiveHour: five === null ? null : { used: 11, level: 'ok', at: ago(five), resetsAt: null }, week: week === null ? null : { used: 58, level: 'ok', at: ago(week), resetsAt: null } })
  const working = lane('Painter', { state: 'working' })
  const works = more => view({ chats: [LEAD, working], ...more })
  // A worker works, both readings 67 minutes old: one finding for each, counted by key, about the board.
  const found = check('old-limit-reading', works({ limits: limits(67, 67) }))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['old-limit-reading', 'old-limit-reading fiveHour', 'board'], ['old-limit-reading', 'old-limit-reading week', 'board']])
  assert.match(found[0].text, /^the 5-hour limit was last read 67 min ago \(07:53\)/)
  assert.match(found[1].text, /^the weekly limit was last read 67 min ago/)
  assert.equal(found[0].fix, undefined, 'report only')
  // Between 30 and 60 minutes the supervisor looks it up; a chat lookup makes the reading new, so nothing is raised.
  assert.deepEqual(check('old-limit-reading', works({ limits: limits(57, 57) })), [])
  assert.deepEqual(check('old-limit-reading', works({ limits: limits(60, 60) })), [])
  assert.deepEqual(check('old-limit-reading', works({ limits: limits(2, 2) })), [])
  // A newer reading of one limit clears that one only.
  assert.deepEqual(check('old-limit-reading', works({ limits: limits(2, 67) })).map(one => one.key), ['old-limit-reading week'])
  // A limit nothing is known of is the summary's "not known", not this rule's.
  assert.deepEqual(check('old-limit-reading', works({ limits: limits(null, null) })), [])
  // B645: the person pauses: nothing spends, a reset is known by its time and the sweep word waits for the resume: quiet, also with a worker working.
  assert.deepEqual(check('old-limit-reading', view({ pause: { state: 'pausing', since: ago(70) }, chats: [LEAD, working], limits: limits(90, 90) })), [])
  assert.deepEqual(check('old-limit-reading', view({ pause: { state: 'pausing', since: ago(70) }, limits: limits(90, 90) })), [])
  // B649: right after the resume the age counts from the pause's end, not from the old reading: a 3 h pause files nothing before the lookup lands.
  const resumed = (since, more) => works({ pause: { state: 'running', since: ago(since) }, ...more })
  assert.deepEqual(check('old-limit-reading', resumed(2, { limits: limits(190, 190) })), [], 'a reading from before the pause is not old yet')
  assert.deepEqual(check('old-limit-reading', resumed(59, { limits: limits(190, 190) })), [])
  assert.deepEqual(check('old-limit-reading', resumed(67, { limits: limits(190, 190) })).map(one => one.key), ['old-limit-reading fiveHour', 'old-limit-reading week'], 'still old an hour after the resume')
  assert.match(check('old-limit-reading', resumed(67, { limits: limits(190, 190) }))[0].text, /was last read 190 min ago/)
  assert.deepEqual(check('old-limit-reading', resumed(190, { limits: limits(67, 67) })).length, 2, 'a pause that ended long ago changes nothing')
  // An idle board does not count either (the app writes its file only while in use).
  assert.deepEqual(check('old-limit-reading', view({ chats: [LEAD, lane('Painter', { state: 'free' })], limits: limits(90, 90) })), [])
  // A threshold of its own in the settings.
  assert.deepEqual(check('old-limit-reading', works({ limits: limits(67, 67), settings: { oldReadingIncidentMinutes: 90 } })), [])
  // The sweep's instructions say the same: look the limits up once past 30 min with get_usage.
  const role = (await readFile(new URL('../../roles/supervisor.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ')
  assert.match(role, /over 30 min old.*once.*get_usage.*still old, over 60 min/)
})
