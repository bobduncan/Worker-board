// B113: the plan's limits as the board reads them, without a chat: the percentages from the app's own file, the
// time a limit resets from what a transcript holds (a chat looked its limits up, or the app stopped it), and the
// two ways a chat is held by a limit. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, fromChat, hitLimit, step, tool, toolResult, typed, usageResult, user } from '../fixtures/lines.mjs'
import { limitStop, limitsOf, parseUsageHistory, pauseNote, usageReadings } from '../src/limits.mjs'
import { parseTail } from '../src/transcript.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** A time of this machine's own clock: the app names a reset by the clock. */
const at = (hour, minute = 0, day = 12) => new Date(2026, 9, day, hour, minute).getTime()
const entries = lines => parseTail(lines.join('\n'), false)
const MAIN = 'Game - Main'
const toMain = (when, message, to = MAIN) => [assistant(when, 'tool_use', [tool('SendMessage', { to, message })]), toolResult(when + 1000)]

const sample = (t, fh, sd) => `{"t":${t},"org":"org-1","u":{"fh":${fh},"sd":${sd}}}`
const history = samples => `{"version":2,"samples":[${samples.join(',')}]}`

// The app's own file

test('the app\'s usage file gives its newest sample: when, the 5-hour limit and the week', () => {
  const text = history([sample(1000, 10, 40), '{"t":2000,"org":"org-1","u":{"fh":0,"sd":0,"xu":24.3}}', sample(3000, 95, 65)])
  assert.deepEqual(parseUsageHistory(text), { at: 3000, fiveHour: 95, week: 65 })
})

test('a piece of that file that starts in the middle of a sample still gives the newest one', () => {
  const text = history([sample(1000, 10, 40), sample(2000, 50, 41), sample(3000, 86, 64)])
  assert.deepEqual(parseUsageHistory(text.slice(40)), { at: 3000, fiveHour: 86, week: 64 })
})

test('a file without samples, or one that is something else, gives nothing', () => {
  for (const none of ['', '{"version":2,"samples":[]}', 'not the file', '{"t":"soon","u":{"fh":"much"}}']) assert.equal(parseUsageHistory(none), null, none)
  assert.equal(parseUsageHistory(null), null)
})

// What a chat looked up

test('a chat that looked its limits up left both windows in its transcript, each with the time it resets', () => {
  const lines = [typed(at(18, 45), 'Zebracorn please'), step(at(18, 46), 'Look the limits up'), usageResult(at(18, 50), { fiveHour: { used: 6, resetsAt: at(23, 40) }, week: { used: 53, resetsAt: at(21, 0, 15) } })]
  assert.deepEqual(usageReadings(entries(lines)), [{ at: at(18, 50), fiveHour: { used: 6, resetsAt: at(23, 40) }, week: { used: 53, resetsAt: at(21, 0, 15) } }])
  const blocks = usageReadings(entries([usageResult(at(19, 0), { fiveHour: { used: 11, resetsAt: null }, asBlocks: true })]))
  assert.deepEqual(blocks, [{ at: at(19, 0), fiveHour: { used: 11, resetsAt: null }, week: null }])
})

test('a reset is kept to the minute the app means, and the week is the one of all models', () => {
  // The app names a reset to the millisecond, a little before or after the minute.
  const windows = [
    { label: '5-hour limit', percentUsed: 6, resetsAt: new Date(at(23, 40) - 188).toISOString() },
    { label: 'Weekly · Fable', percentUsed: 1, resetsAt: null },
    { label: 'Weekly · all models', percentUsed: 53, resetsAt: new Date(at(21, 0, 15) + 125).toISOString() },
  ]
  const lines = [user(at(19), [{ type: 'tool_result', tool_use_id: 't', content: JSON.stringify({ plan: { status: 'ok', windows } }) }])]
  assert.deepEqual(usageReadings(entries(lines)), [{ at: at(19), fiveHour: { used: 6, resetsAt: at(23, 40) }, week: { used: 53, resetsAt: at(21, 0, 15) } }])
})

test('what merely holds the words of a reading is none: a search result, a chat\'s own words, something typed', () => {
  const words = '{"plan":{"windows":[{"label":"5-hour limit","percentUsed":99,"resetsAt":"2026-10-12T21:40:00Z"}]}}'
  const lines = [
    typed(at(10), words),
    answer(at(10, 1), words),
    user(at(10, 2), [{ type: 'tool_result', tool_use_id: 't', content: `backlog.md:12: the 5-hour limit, resetsAt and so on\n${words}` }]),
    user(at(10, 3), [{ type: 'tool_result', tool_use_id: 't', content: '{"plan":{"status":"unavailable"}}' }]),
  ]
  assert.deepEqual(usageReadings(entries(lines)), [])
})

// Stopped by the app

test('a chat whose last word is the app\'s stop at the limit is held until the clock time that line names', () => {
  const lines = [typed(at(23, 30), 'Zebracorn please'), step(at(23, 31), 'Build'), toolResult(at(23, 32)), hitLimit(at(23, 37), 'You\'ve hit your session limit · resets 1:40am (Europe/Berlin)')]
  assert.deepEqual(limitStop(entries(lines)), { at: at(23, 37), limit: 'fiveHour', resetsAt: at(1, 40, 13) })
  const noon = [hitLimit(at(12, 29), 'You\'ve hit your session limit · resets 1:10pm (Europe/Berlin)')]
  assert.equal(limitStop(entries(noon)).resetsAt, at(13, 10))
  assert.equal(limitStop(entries([hitLimit(at(20, 5), 'You\'ve hit your session limit · resets 11pm')])).resetsAt, at(23, 0))
  assert.equal(limitStop(entries([hitLimit(at(12, 5), 'You\'ve hit your session limit · resets 12:30pm')])).resetsAt, at(12, 30))
  assert.equal(limitStop(entries([hitLimit(at(23, 50), 'You\'ve hit your session limit · resets 12:10am')])).resetsAt, at(0, 10, 13))
})

test('a stop whose time the board cannot read is still a stop; one of the week is told from one of the session', () => {
  const week = limitStop(entries([hitLimit(at(9), 'You\'ve hit your weekly limit · resets Oct 15 at 9pm (Europe/Berlin)')]))
  assert.deepEqual(week, { at: at(9), limit: 'week', resetsAt: null })
  assert.deepEqual(limitStop(entries([hitLimit(at(9), 'You\'ve hit your session limit')])), { at: at(9), limit: 'fiveHour', resetsAt: null })
})

test('a chat that went on after the stop is not held, and a stop of another kind is none', () => {
  const stop = hitLimit(at(12, 29), 'You\'ve hit your session limit · resets 1:10pm')
  assert.equal(limitStop(entries([stop, typed(at(13, 15), 'continue'), step(at(13, 16), 'Build')])), null)
  assert.equal(limitStop(entries([stop, typed(at(13, 15), 'continue')])), null)
  assert.equal(limitStop(entries([answer(at(12), 'You\'ve hit your session limit · resets 1:10pm')])), null)
  assert.equal(limitStop(entries([])), null)
  // A note of the app's own after it opened nothing: it is still held.
  assert.notEqual(limitStop(entries([stop, user(at(12, 40), 'a note of the app', { isMeta: true })])), null)
})

// Paused by itself

test('a worker that told the main chat "paused for the limit" and ended its turn is held, until the time it named', () => {
  const lines = [fromChat(at(21), MAIN, 'Task from Game - Main: the zebracorn.'), step(at(21, 1), 'Build'), toolResult(at(21, 2)),
    ...toMain(at(22, 40), 'Note from Game - Units: paused for the limit until 23:40.\nThe work is committed and pushed.'), answer(at(22, 41), 'I stop here.')]
  assert.deepEqual(pauseNote(entries(lines), MAIN), { at: at(22, 40), until: at(23, 40), limit: 'fiveHour', percent: null })
  const tomorrow = [...toMain(at(22, 40), 'Note from Game - Units: Paused for the 5-hour limit until 1:40am'), answer(at(22, 41), 'I stop here.')]
  assert.deepEqual(pauseNote(entries(tomorrow), MAIN), { at: at(22, 40), until: at(1, 40, 13), limit: 'fiveHour', percent: null })
  const noTime = [...toMain(at(22, 40), 'Note from Game - Units: paused for the session limit, at 86%.'), answer(at(22, 41), 'I stop here.')]
  assert.deepEqual(pauseNote(entries(noTime), MAIN), { at: at(22, 40), until: null, limit: 'fiveHour', percent: 86 })
})

test('the pause is over once the worker works again, and a later word to the main chat replaces it', () => {
  const paused = [...toMain(at(22, 40), 'Note from Game - Units: paused for the limit until 23:40.'), answer(at(22, 41), 'I stop here.')]
  assert.equal(pauseNote(entries([...paused, fromChat(at(23, 41), MAIN, 'Go on.'), step(at(23, 42), 'Build')]), MAIN), null)
  assert.equal(pauseNote(entries([...paused.slice(0, 2), ...toMain(at(22, 50), 'Report from Game - Units: done after all.'), answer(at(22, 51), 'Done.')]), MAIN), null)
  // Still in the turn that sent it: the note stands, and whether the chat rests is the turn's to say.
  assert.notEqual(pauseNote(entries(paused.slice(0, 2)), MAIN), null)
})

test('only the first line of a word to the main chat counts as a pause', () => {
  const told = (message, to = MAIN) => pauseNote(entries([...toMain(at(22, 40), message, to), answer(at(22, 41), 'I stop here.')]), MAIN)
  assert.equal(told('Report from Game - Units: B12 is merged.\nGame - Levels paused for the limit until 23:40.'), null)
  assert.equal(told('Note from Game - Units: paused for the limit until 23:40.', 'Game - Support'), null)
  assert.equal(told('Note from Game - Units: the limit is at 86%.'), null)
})

// The figures together

const reading = (when, used, resetsAt, week = null) => ({ at: when, fiveHour: { used, resetsAt }, week })

test('the newest figure is shown, and the reset comes from what a chat read while that window runs', () => {
  const limits = limitsOf({
    sample: { at: at(22, 48), fiveHour: 86, week: 64 },
    readings: [reading(at(18, 50), 6, at(23, 40), { used: 53, resetsAt: at(21, 0, 15) })],
    now: at(22, 51),
  })
  assert.deepEqual(limits.fiveHour, { used: 86, at: at(22, 48), resetsAt: at(23, 40), resetAt: null, level: 'warn', stopAt: 100 })
  assert.deepEqual(limits.week, { used: 64, at: at(22, 48), resetsAt: at(21, 0, 15), resetAt: null, level: 'ok', stopAt: 98 })
  // A reading newer than the file's sample is the figure.
  const newer = limitsOf({ sample: { at: at(22, 48), fiveHour: 86, week: 64 }, readings: [reading(at(22, 50), 93, at(23, 40))], now: at(22, 51) })
  assert.deepEqual([newer.fiveHour.used, newer.fiveHour.at, newer.week.used], [93, at(22, 50), 64])
})

test('the bar is calm below 80%, warns from there, and is full at 100% or while a stop\'s reset is still ahead', () => {
  const level = (used, more = {}) => limitsOf({ sample: { at: at(22), fiveHour: used, week: 10 }, now: at(22, 5), ...more }).fiveHour.level
  assert.deepEqual([level(0), level(79), level(80), level(99), level(100)], ['ok', 'ok', 'warn', 'warn', 'full'])
  assert.equal(level(60, { warnAt: 50 }), 'warn')
  const stopped = limitsOf({ sample: { at: at(22), fiveHour: 97, week: 10 }, stops: [{ at: at(22, 3), limit: 'fiveHour', resetsAt: at(23, 40) }], now: at(22, 5) })
  assert.deepEqual(stopped.fiveHour, { used: 100, at: at(22, 3), resetsAt: at(23, 40), resetAt: null, level: 'full', stopAt: 100 })
  assert.equal(stopped.week.level, 'ok')
})

test('once the known reset has passed and no figure is newer, the limit is empty again and says since when', () => {
  const limits = limitsOf({ sample: { at: at(23, 37), fiveHour: 95, week: 65 }, readings: [reading(at(18, 50), 6, at(23, 40))], now: at(23, 45) })
  assert.deepEqual(limits.fiveHour, { used: 0, at: at(23, 40), resetsAt: null, resetAt: at(23, 40), level: 'ok', stopAt: 100 })
  // A figure from after the reset is that window's own; when it resets is not known until a chat looks.
  const after = limitsOf({ sample: { at: at(23, 52), fiveHour: 13, week: 66 }, readings: [reading(at(18, 50), 6, at(23, 40))], now: at(23, 55) })
  assert.deepEqual(after.fiveHour, { used: 13, at: at(23, 52), resetsAt: null, resetAt: null, level: 'ok', stopAt: 100 })
  // A stop that is over holds nothing any more.
  const over = limitsOf({ sample: { at: at(23, 52), fiveHour: 13, week: 66 }, stops: [{ at: at(23, 37), limit: 'fiveHour', resetsAt: at(23, 40) }], now: at(23, 55) })
  assert.equal(over.fiveHour.level, 'ok')
})

test('with nothing to go by there is no figure, and one window can be known without the other', () => {
  assert.deepEqual(limitsOf({ now: at(12) }), { fiveHour: null, week: null })
  const only = limitsOf({ readings: [reading(at(11), 40, at(15))], now: at(12) })
  assert.deepEqual([only.fiveHour.used, only.week], [40, null])
  assert.equal(limitsOf({ sample: { at: at(11), fiveHour: 40, week: 12 }, now: at(11) + 3 * DAY }).week.used, 12)
})

test('B291: a pause sent to the main chat by the app\'s id for it counts as by its title', () => {
  const byId = [...toMain(at(22, 40), 'Note from Game - Units: paused for the limit until 23:40.', 'local_main-1'), answer(at(22, 41), 'I stop here.')]
  assert.deepEqual(pauseNote(entries(byId), [MAIN, 'local_main-1']), { at: at(22, 40), until: at(23, 40), limit: 'fiveHour', percent: null })
  assert.equal(pauseNote(entries(byId), MAIN), null)
})
