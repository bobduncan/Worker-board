// B173: the board's clock for the Advisor's rounds, as the design asks ("How we know it works"): the morning round at
// 09:00; the weekly one after the weekly reset and not that morning; a round missed while the board was off comes
// once at its next start; the morning round is left out above 80%; the clock's line is marked as the clock's.

import assert from 'node:assert/strict'
import test from 'node:test'

import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { isClockLine, roundText, roundsNow } from '../src/rounds.mjs'

const at = (day, hours, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime()
const RESET = at(15, 21)
const kept = (more = {}) => ({ morning: at(13, 9), weekly: at(8, 21), nextWeekly: null, skipped: null, ...more })
const run = (now, before, more = {}) => roundsNow({ now, kept: before, morningRound: '09:00', weeklyRound: true, weekReset: null, fiveHour: 40, skipPercent: 80, ...more })

test('the morning round comes at 09:00, once a day', () => {
  assert.equal(run(at(14, 8, 59), kept()).round, null)
  const nine = run(at(14, 9), kept())
  assert.equal(nine.round, 'morning')
  assert.equal(nine.kept.morning, at(14, 9))
  assert.equal(run(at(14, 9, 30), nine.kept).round, null)
  assert.equal(run(at(15, 9), { ...nine.kept, nextWeekly: null }).round, 'morning')
  // No morning time in the settings: no morning round.
  assert.equal(run(at(14, 9), kept(), { morningRound: '' }).round, null)
})

test('the weekly round comes right after the weekly limit resets, and that day\'s morning round is left out', () => {
  const morning = run(at(15, 9), kept({ morning: at(14, 9), nextWeekly: RESET }))
  assert.equal(morning.round, null)
  assert.deepEqual(morning.skipped, { round: 'morning', at: at(15, 9), why: 'the weekly round comes today' })
  assert.equal(run(at(15, 20, 59), morning.kept).round, null)
  const weekly = run(at(15, 21, 1), morning.kept)
  assert.equal(weekly.round, 'weekly')
  assert.equal(run(at(15, 21, 2), weekly.kept).round, null)
  // The board read the reset while it waited: it keeps the time; after the round, the next reset takes its place.
  assert.equal(run(at(14, 12), kept({ morning: at(14, 9) }), { weekReset: RESET }).kept.nextWeekly, RESET)
  assert.equal(run(at(16, 8), weekly.kept, { weekReset: at(22, 21) }).kept.nextWeekly, at(22, 21))
  // Weekly rounds switched off in the settings: only the mornings.
  assert.equal(run(at(15, 21, 1), morning.kept, { weeklyRound: false }).round, null)
})

test('a round missed while the board was off comes once at its next start', () => {
  const late = run(at(16, 14), kept({ morning: at(13, 9) }))
  assert.equal(late.round, 'morning')
  assert.equal(run(at(16, 14, 1), late.kept).round, null)
  // A weekly round missed: it comes at the start, and takes the day's morning round with it.
  const missed = run(at(16, 10), kept({ morning: at(15, 9), nextWeekly: RESET }))
  assert.equal(missed.round, 'weekly')
  assert.equal(run(at(16, 10, 1), missed.kept).round, null)
})

test('the morning round is left out while the 5-hour limit is above 80%, with one line saying so; the weekly always runs', () => {
  const full = run(at(14, 9), kept(), { fiveHour: 87 })
  assert.equal(full.round, null)
  assert.deepEqual(full.skipped, { round: 'morning', at: at(14, 9), why: 'the 5-hour limit is at 87%' })
  assert.deepEqual(full.kept.skipped, full.skipped)
  // Left out is left out: it does not come later that day.
  assert.equal(run(at(14, 9, 30), full.kept, { fiveHour: 20 }).round, null)
  assert.equal(run(at(14, 9), kept(), { fiveHour: 80 }).round, 'morning')
  assert.equal(run(at(15, 21, 1), kept({ morning: at(15, 9), nextWeekly: RESET }), { fiveHour: 95 }).round, 'weekly')
})

test('at its very first start the clock only writes down: a new board starts no round at once', () => {
  const first = run(at(14, 15), null, { weekReset: RESET })
  assert.deepEqual([first.round, first.kept.morning, first.kept.nextWeekly], [null, at(14, 15), RESET])
  assert.equal(run(at(15, 21, 1), first.kept).round, 'weekly')
})

test('the clock\'s line says it is the clock\'s, names the job and the project\'s settings, and carries no mark of the person', () => {
  const config = { ...parseConfig(JSON.stringify({ advisorReadFirst: ['docs/vision.md'] }), {}), project: 'C:\\game', gameRepo: 'C:\\game\\repo' }
  const text = roundText('morning', { board: 'C:\\board', config })
  const lines = text.split('\n')
  assert.equal(lines[0], 'Round from the board\'s clock: morning')
  assert.match(lines[1], /^Your job: C:\\board[\\/]roles[\\/]partner\.md$/)
  assert.match(text, /Read first: docs\/vision\.md/)
  assert.match(text, /under "Advisor suggestions"/)
  assert.match(text, /not the user's word/)
  assert.ok(isClockLine(text) && !isClockLine('Round two, please'))
  const typed = messageText({ at: 2, ask: null, command: 'round', text }, () => '09:00')
  assert.equal(typed, text)
  assert.doesNotMatch(typed, /typed on the worker board/)
})
