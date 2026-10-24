// The supervisor's Task 2: the watch rules (spec 2026-10-24, "What it checks"). Report only: each looks at one read-only
// view of the board (view.mjs `buildView`) and names what does not look right for longer than its threshold (the
// settings' `supervisor`). One test per rule from a small made-up board, plus Review Focus 1: a rule that throws is
// one finding "rule <id> failed" and the other rules still run. No word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { SUPERVISOR_DEFAULTS, configProblem, parseConfig } from '../../src/config.mjs'
import { runRules } from '../../src/supervisor/loop.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 9, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(60)), ...more }, sections)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })
const LEAD = lane('Lead', { isMain: true, state: 'working' })
/** The timeline as state.mjs gives it: a chat's spans of state up to now. */
const span = (chat, state, fromMinutesAgo) => ({ chat, spans: [{ from: ago(fromMinutesAgo), to: NOW, state, task: null }] })

const view = (more = {}) => buildView({
  state: { chats: more.chats ?? [LEAD], today: more.today ?? [], limits: more.limits ?? {}, pause: more.pause ?? null, chatPrefix: '' },
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

test('the watch rules: ten, report only, each with what it says', () => {
  assert.deepEqual(WATCH_RULES.map(one => one.id), ['unknown-lane', 'stale-suspended', 'idle-while-waiting', 'holder-not-running', 'opus-wait', 'skip-repeats', 'repair-repeats', 'undelivered', 'report-check-twice', 'old-mod'])
  assert.ok(WATCH_RULES.every(one => one.kind === 'watch' && typeof one.says === 'string' && one.says.length > 0 && typeof one.check === 'function'))
})

test('the settings: the thresholds of the spec by default; config.json\'s supervisor sets any of them, and a wrong one stops the board', () => {
  assert.deepEqual({ ...SUPERVISOR_DEFAULTS }, { unknownMinutes: 10, suspendedMinutes: 10, idleMinutes: 10, notRunningMinutes: 30, opusWaitMinutes: 15, undeliveredMinutes: 10, repairsPerDay: 3 })
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

test('idle-while-waiting: all workers free, unknown or off while a step is queued for 11 min trips; 9 min, one working, a blocked step or a pause do not', () => {
  const board = (more = {}) => view({
    chats: [LEAD, lane('Painter', { state: 'free' }), lane('Mason', { state: 'unknown' }), lane('Sleeper', { state: 'off' })],
    today: [span('Painter', 'free', 40), span('Mason', 'unknown', 40), span('Sleeper', 'off', 40)],
    items: items(step('B5', 'queued', { Owner: 'Painter', Since: stamp(ago(11)) })),
    ...more,
  })
  const found = check('idle-while-waiting', board())
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['idle-while-waiting', 'board']])
  assert.equal(found[0].text, 'All 3 workers idle for 11 min while 1 step waits (B5)')
  assert.deepEqual(check('idle-while-waiting', board({ items: items(step('B5', 'queued', { Owner: 'Painter', Since: stamp(ago(9)) })) })), [])
  // One worker alone is named.
  const alone = check('idle-while-waiting', board({ chats: [LEAD, lane('Painter', { state: 'free' })], today: [span('Painter', 'free', 40)] }))
  assert.equal(alone[0].text, 'The one worker, Painter, idle for 11 min while 1 step waits (B5)')
  assert.deepEqual(check('idle-while-waiting', board({ chats: [LEAD, lane('Painter', { state: 'working' }), lane('Mason', { state: 'unknown' })] })), [])
  assert.deepEqual(check('idle-while-waiting', board({ items: items(step('B4', 'review'), step('B5', 'queued', { Owner: 'Painter', 'Blocked by': 'B4', Since: stamp(ago(30)) })) })), [])
  assert.deepEqual(check('idle-while-waiting', board({ pause: { state: 'pausing', since: stamp(ago(5)) } })), [])
  // The workers only just went idle: the time counts from the last of them.
  assert.deepEqual(check('idle-while-waiting', board({ today: [span('Painter', 'free', 5), span('Mason', 'unknown', 40), span('Sleeper', 'off', 40)] })), [])
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

test('undelivered: a word to a chat waiting 11 min trips, 9 min not; one that expired is undelivered too; held or delivered is not', () => {
  const word = (minutes, state = 'waiting', more = {}) => ({ id: `m${minutes}`, to: 'Painter', command: 'work', about: 'B5', at: ago(minutes), state, ...more })
  const found = check('undelivered', view({ outbox: [word(11), word(3)] }))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['undelivered Painter', 'Painter']])
  assert.equal(found[0].text, '1 word to Painter not delivered, the oldest for 11 min')
  assert.deepEqual(check('undelivered', view({ outbox: [word(9)] })), [])
  assert.equal(check('undelivered', view({ outbox: [word(30, 'expired')] })).length, 1)
  assert.deepEqual(check('undelivered', view({ outbox: [word(30, 'held'), word(30, 'delivered'), word(300, 'expired')] })), [], 'an expired one of hours ago is history')
  // A word held by the person's pause counts from its release.
  assert.deepEqual(check('undelivered', view({ outbox: [word(40, 'waiting', { releasedAt: ago(4) })] })), [])
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

test('old-mod: a chat on a Workers mod older than the one installed trips; the same, or one not known, does not', () => {
  const board = chats => view({ chats: [LEAD, lane('Painter'), lane('Mason')], mods: { installed: '0.15.0', chats } })
  const found = check('old-mod', board({ Painter: '0.14.2', Mason: '0.15.0' }))
  assert.deepEqual(found.map(one => [one.key, one.subject]), [['old-mod Painter 0.14.2', 'Painter']])
  assert.equal(found[0].text, 'Painter runs the Workers mod 0.14.2; 0.15.0 is installed')
  assert.deepEqual(check('old-mod', board({ Painter: '0.15.0' })), [])
  assert.deepEqual(check('old-mod', view({ chats: [LEAD, lane('Painter')], mods: null })), [])
  assert.equal(check('old-mod', board({ Painter: '0.9.9' }))[0].subject, 'Painter', 'compared as numbers, not as text')
  assert.deepEqual(check('old-mod', board({ Painter: '0.15.1' })), [])
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

test('the review: idle-while-waiting counts only steps queued for a worker of the list, and not one whose line waits for its model or effort', () => {
  const board = (queued, more = {}) => view({
    chats: [LEAD, lane('Painter', { state: 'free', ...more })], today: [span('Painter', 'free', 40)],
    partner: null, items: items(...queued),
  })
  const queuedFor = (id, owner) => step(id, 'queued', { Owner: owner, Since: stamp(ago(20)) })
  // The main chat's, a gone chat's: no worker could take them.
  assert.deepEqual(check('idle-while-waiting', board([queuedFor('B5', 'Lead'), queuedFor('B6', 'Ghost')])), [])
  // Held for Opus (opus-wait says that one), or for its effort to be set.
  assert.deepEqual(check('idle-while-waiting', board([queuedFor('B5', 'Painter')], { effortRun: { step: 'B5', waitsFor: { model: 'opus', since: ago(20), text: '' } } })), [])
  assert.deepEqual(check('idle-while-waiting', board([queuedFor('B5', 'Painter')], { effortRun: { step: 'B5', waitsFor: null, isSet: false } })), [])
  assert.equal(check('idle-while-waiting', board([queuedFor('B5', 'Painter')], { effortRun: { step: 'B5', waitsFor: null, isSet: true } })).length, 1)
})

test('the review: a compaction skipped because more of the same work follows is by design, as the Workers mod means it', () => {
  const why = 'more of the same work follows'
  const board = view({ chats: [LEAD, lane('Painter', { compaction: { kind: 'skipped', at: ago(2), why } })] })
  assert.deepEqual(check('skip-repeats', board, new Map([[`skip|Painter|compact|${ago(40)}|${why}`, ago(40)]])), [])
})
