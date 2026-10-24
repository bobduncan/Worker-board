// B113: what the page says about the limits, about a worker held by the limit, and about why a queued step is not
// started. The page's own code is run here, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('limits')}\n${cut('lanetime')}\nObject.assign(this, { clock, span, limitsView, whyText, heldText, timeOf })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const MIN = 60_000
const at = (hour, minute = 0, day = 12) => new Date(2026, 9, day, hour, minute).getTime()
const NOW = at(22, 48)
const limit = (used, more = {}) => ({ used, at: NOW - 3 * MIN, resetsAt: null, resetAt: null, level: 'ok', ...more })
const view = limits => plain(page.limitsView(limits, NOW))

// The bar in the head

test('the head shows the 5-hour limit with its reset and how long that is, the week smaller, and the figure\'s age', () => {
  const shown = view({ fiveHour: limit(86, { resetsAt: at(23, 40), level: 'warn' }), week: limit(64, { resetsAt: at(21, 0, 15) }) })
  assert.deepEqual(shown.five, { name: '5-hour limit', value: '86% used', width: 86, tone: 'warn', under: 'resets 23:40 · in 52 min' })
  assert.deepEqual(shown.week, { name: 'Week', value: '64%', width: 64, tone: 'ok', under: 'resets Thu 21:00' })
  assert.deepEqual(shown.age, { text: 'read 3 min ago', isOld: false })
})

test('a limit that is reached says so plainly, with when work goes on', () => {
  const shown = view({ fiveHour: limit(100, { resetsAt: at(23), level: 'full' }), week: limit(100, { resetsAt: at(21, 0, 15), level: 'full' }) })
  assert.deepEqual([shown.five.value, shown.five.under, shown.five.tone, shown.five.width], ['Limit reached', 'work goes on at 23:00 · in 12 min', 'full', 100])
  assert.deepEqual([shown.week.value, shown.week.under], ['Reached', 'until Thu 21:00'])
  // The app stopped a chat while the last sample said less: the bar is full all the same.
  assert.equal(view({ fiveHour: limit(97, { level: 'full' }), week: null }).five.width, 100)
})

test('a reset nobody read is said to be unknown, and a week that resets today names only the time', () => {
  const shown = view({ fiveHour: limit(13), week: limit(66, { resetsAt: at(23, 30) }) })
  assert.deepEqual([shown.five.under, shown.week.under], ['reset time not known yet', 'resets 23:30'])
  assert.equal(view({ fiveHour: limit(100, { level: 'full' }), week: null }).five.under, 'reset time not known yet')
  assert.equal(view({ fiveHour: null, week: limit(66) }).week.under, 'reset not known')
})

test('after a reset with no figure since, the bar is empty and says since when', () => {
  const shown = view({ fiveHour: { used: 0, at: at(22, 40), resetsAt: null, resetAt: at(22, 40), level: 'ok' }, week: limit(65) })
  assert.deepEqual([shown.five.value, shown.five.under, shown.five.width], ['0% used', 'reset at 22:40', 0])
  // The age is that of the figure the app's file gave last.
  assert.deepEqual(shown.age, { text: 'read 3 min ago', isOld: false })
})

test('a figure the app has not renewed for a while is marked as old', () => {
  const old = view({ fiveHour: limit(50, { at: NOW - 42 * MIN }), week: limit(60, { at: NOW - 42 * MIN }) })
  assert.deepEqual(old.age, { text: 'read 42 min ago', isOld: true })
  assert.deepEqual(view({ fiveHour: limit(50, { at: NOW - 20 * MIN }), week: null }).age, { text: 'read 20 min ago', isOld: false })
  assert.equal(view({ fiveHour: limit(50, { at: NOW - 10_000 }), week: null }).age.text, 'read just now')
})

test('with nothing known there is nothing to draw, and one limit can stand without the other', () => {
  assert.equal(page.limitsView({ fiveHour: null, week: null }, NOW), null)
  assert.equal(page.limitsView(undefined, NOW), null)
  const only = view({ fiveHour: limit(40), week: null })
  assert.deepEqual([only.five.value, only.week], ['40% used', null])
})

// Why a queued step is not started

test('each reason reads as one plain line', () => {
  const said = why => page.whyText(why).text
  assert.equal(said({ reason: 'limit', limit: 'fiveHour', until: at(23, 40) }), 'Not started: the session limit is reached, work goes on at 23:40')
  assert.equal(said({ reason: 'limit', limit: 'fiveHour', until: null }), 'Not started: the session limit is reached')
  assert.equal(said({ reason: 'limit', limit: 'week', until: null }), 'Not started: the weekly limit is reached')
  assert.equal(said({ reason: 'suspended', worker: 'Features', until: at(23, 40), isBack: false }), 'Not started: Features is suspended until 23:40')
  assert.equal(said({ reason: 'suspended', worker: 'Features', until: null, isBack: false }), 'Not started: Features is suspended')
  assert.equal(said({ reason: 'suspended', worker: 'Features', until: at(22, 40), isBack: true }), 'Not started: Features has not gone on since the limit came back')
  assert.equal(said({ reason: 'after', steps: ['B110'] }), 'Not started: waits for B110')
  assert.equal(said({ reason: 'after', steps: ['B110', 'B55', 'B63'] }), 'Not started: waits for B110, B55 and B63')
  assert.equal(said({ reason: 'after', words: 'the art is agreed' }), 'Not started: after the art is agreed')
  // B542: a step in review is waited on for its check.
  assert.equal(said({ reason: 'after', steps: ['B110', 'B55'], checks: ['B55'] }), 'Not started: waits for B110 and the check of B55')
  assert.equal(said({ reason: 'busy', worker: 'Units', leftMs: 48 * MIN }), 'Not started: Units is busy, about 48 min left')
  assert.equal(said({ reason: 'busy', worker: 'Units', leftMs: null }), 'Not started: Units is busy')
  assert.equal(said({ reason: 'you', worker: 'Units' }), 'Not started: Units waits for you')
  assert.equal(said({ reason: 'cut', worker: 'Units' }), 'Not started: Units was cut off')
  assert.equal(said({ reason: 'handout', main: 'Game - Main', isOwn: false }), 'Not started: waits for Game - Main to hand it out')
  assert.equal(said({ reason: 'handout', main: 'Game - Main', isOwn: true }), 'Not started: Game - Main has not started it')
  assert.equal(said({ reason: 'nobody' }), 'Not started: no worker is named for it')
  assert.equal(said({ reason: 'unknown', worker: 'Units' }), 'Not started: the state of Units is not known')
})

test('a reason of the limit is told apart from the others, and a step without a reason says nothing', () => {
  assert.deepEqual([page.whyText({ reason: 'limit', limit: 'fiveHour', until: null }).tone, page.whyText({ reason: 'suspended', worker: 'x', until: null, isBack: false }).tone], ['limit', 'limit'])
  assert.deepEqual([page.whyText({ reason: 'after', steps: ['B1'] }).tone, page.whyText({ reason: 'handout', main: 'm', isOwn: false }).tone], ['wait', 'plain'])
  assert.equal(page.whyText(undefined), null)
  assert.equal(page.whyText(null), null)
})

// A worker held by the limit

const held = (more = {}) => ({ by: 'note', limit: 'fiveHour', since: at(22, 40), until: at(23, 40), isBack: false, ...more })
const laneOf = suspended => ({ state: 'suspended', isLeftover: false, suspended, task: null, eta: null })

test('a suspended lane says who held it and when it goes on, and its time column shows that time', () => {
  assert.equal(page.heldText(held()), 'Paused for the session limit · goes on at 23:40')
  assert.equal(page.heldText(held({ by: 'app' })), 'Stopped by the app at the session limit · goes on at 23:40')
  assert.equal(page.heldText(held({ by: 'app', limit: 'week', until: null })), 'Stopped by the app at the weekly limit · no time known yet')
  assert.deepEqual(plain(page.timeOf(laneOf(held()), NOW)), { label: 'Goes on', main: '23:40', tone: 'time', small: ['in 52 min'], from: null })
  assert.deepEqual(plain(page.timeOf(laneOf(held({ until: null })), NOW)), { label: '', main: 'Suspended', tone: 'muted', small: [], from: null })
})

test('once the limit is back the lane says so, as something that needs a hand', () => {
  const back = held({ until: at(22, 45), isBack: true })
  assert.equal(page.heldText(back), 'Paused for the session limit · the limit is back since 22:45, and it has not gone on yet')
  assert.equal(page.heldText(held({ until: null, isBack: true })), 'Paused for the session limit · the limit is back, and it has not gone on yet')
  assert.deepEqual(plain(page.timeOf(laneOf(back), NOW)), { label: 'Limit is back', main: 'since 22:45', tone: 'bad', small: [], from: null })
  assert.deepEqual(plain(page.timeOf(laneOf(held({ until: null, isBack: true })), NOW)), { label: 'Limit is back', main: 'Not gone on', tone: 'bad', small: [], from: null })
})

// The page itself

test('the page has one place for the limits, in the head beside the title, and knows the new state', () => {
  assert.equal(html.match(/id="limits"/g).length, 1)
  const head = html.slice(html.indexOf('<header class="head">'), html.indexOf('</header>'))
  assert.ok(head.indexOf('<h1>') < head.indexOf('id="limits"') && head.indexOf('id="limits"') < head.indexOf('id="counts"'))
  assert.match(script, /suspended: 'Suspended'/)
  for (const rule of ['.pill.is-suspended', '.lane.is-suspended', '.span.is-suspended', '.count-pill.is-suspended', '.limit.is-warn', '.limit.is-full', '.queue-item .why']) assert.ok(style.includes(rule), rule)
})
