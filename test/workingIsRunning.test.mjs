// B566, the fix of X22 and X21: at 20:56 Workers 1, 2 and 4 showed "its chat does not run" while they ran, and Worker 3,
// idle, was shown off, so the words to take its queued steps could not reach it. The board knew a chat runs only by its
// takes, which must come within 30 seconds of each other. Now every accepted call of a chat (a take, a work call, a
// typed report) and a conversation written in the last minute say it runs, and the watch rule working-not-running names
// a worker whose card says it works while its chat does none of that for over 5 minutes. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { readFile } from 'node:fs/promises'

import { noteCall } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { wakeNeeds } from '../src/wake.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 20, 56).getTime()
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Main', 'Board', 'Support']

const app = name => JSON.stringify({
  title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1',
})
/** A card its process wrote: working on a step not reported yet. */
const card = id => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: { text: `${id} the flags`, step: 2, steps: 4, isReported: false }, at: NOW - 3 * MIN })
const held = (id, owner) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: in progress\nOwner: ${owner}\nSince: ${stamp(NOW - 40 * MIN)}\n`)
/** A turn under way: its conversation last written `ago` seconds before now. */
const working = ago => ({ lines: [typed(NOW - 20 * MIN, 'Go on.'), step(NOW - ago * 1000, 'Build')], at: NOW - ago * 1000 })
const quiet = { lines: [typed(NOW - 40 * MIN, 'Go on.'), answer(NOW - 30 * MIN, 'Done.')], at: NOW - 30 * MIN }

/** The board started 30 minutes ago; `seen` is what its bridge heard (the mods' takes and calls). */
function build({ tails = {}, seen = { shown: {}, other: {} }, appStartedAt = NOW - 3 * 60 * MIN } = {}) {
  const work = storeFromText('## Board\n', { now: NOW - 60 * MIN })
  for (const item of [held('B12', 'Board'), held('B13', 'Support')]) work.items.set(item.head.get('Id'), item)
  const turns = { Main: quiet, Board: working(20), Support: working(20), ...tails }
  const raw = {
    listText: '{"prefix":"Team - ","main":"Main"}',
    appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, { text: turns[name].lines.join('\n'), isCut: false, modifiedAt: turns[name].at }])),
    planLineTexts: { 'cli-Board': card('B12'), 'cli-Support': card('B13') },
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, seen, board: { startedAt: NOW - 30 * MIN, offSince: null } })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
/** Main's mod took lately, so the board knows a mod asks: without that it tells nothing. */
const MAIN_TAKES = { shown: { Main: NOW - 5_000 }, other: {} }

test('X22: a working chat whose takes are quiet but whose conversation was written 20 s ago runs; no start is asked for it', () => {
  const state = build({ seen: MAIN_TAKES })
  assert.deepEqual([lane(state, 'Board').state, lane(state, 'Board').isRunning], ['working', true])
  assert.deepEqual(state.restart.notRunning, [])
  // A word for it asks the main chat to start nothing: the chat runs.
  const word = { id: 'w1', at: NOW, to: 'Board', ask: 'work:Q3', step: 'Q3', text: 'Yes', state: 'waiting' }
  assert.deepEqual(wakeNeeds(state, [word]), [])
  // Written two minutes ago and no take: it is not known to run, as before.
  const still = build({ seen: MAIN_TAKES, tails: { Board: working(120) } })
  assert.equal(lane(still, 'Board').isRunning, false)
  assert.ok(still.restart.notRunning.includes('Board'))
  // Signals change 4: the wake procedure's need for it (src/wake.mjs), no start word.
  assert.equal(wakeNeeds(still, [word]).find(one => one.chat === 'Board')?.why, 'words', 'a chat that does not run is woken')
  // A write from before the app started is its old process's: it does not say the chat runs now.
  assert.equal(lane(build({ seen: MAIN_TAKES, appStartedAt: NOW - 10_000 }), 'Board').isRunning, false)
})

test('the server notes every accepted call: its bridge routes all go through noteMod, which calls noteCall', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const note = server.slice(server.indexOf('  const noteMod = (body, checked) => {'), server.indexOf('  const modsNow = '))
  assert.ok(note.includes('noteCall(seen, body, checked, clock())'), 'noteMod notes the call')
  for (const route of ['    bridgeWork: counted(', '    take: counted(', '    typed: counted(']) {
    const from = server.indexOf(route)
    assert.ok(from > 0, route)
    assert.ok(server.slice(from, from + 900).includes('noteMod(body, checked)'), route)
  }
})

test('X22: a work call or a typed report of a chat says it runs, as a take does; a refused call does not', () => {
  const seen = { shown: { Main: NOW - 5_000 }, other: {} }
  noteCall(seen, { chat: 'Support', action: 'next' }, { ok: true, chat: 'Support' }, NOW - 10_000)
  noteCall(seen, { chat: 'Board' }, { ok: false, status: 409 }, NOW - 10_000)
  assert.deepEqual(Object.keys(seen.shown).sort(), ['Main', 'Support'])
  const state = build({ seen, tails: { Board: working(120), Support: working(120) } })
  assert.deepEqual([lane(state, 'Support').isRunning, lane(state, 'Board').isRunning], [true, false])
  // Without a bridge nothing is noted.
  assert.doesNotThrow(() => noteCall(null, { chat: 'Board' }, { ok: true, chat: 'Board' }, NOW))
})

const MIN_AGO = minutes => NOW - minutes * MIN
const watchLane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: false, session: `s-${name}`, ...more })
const LEAD = watchLane('Lead', { isMain: true, isRunning: true })
const viewOf = (chats, items = new Map(), more = {}) => buildView({ state: { chats: [LEAD, ...chats], today: [], limits: more.limits ?? {}, pause: more.pause ?? null, chatPrefix: '' }, items, now: NOW })
const rule = WATCH_RULES.find(one => one.id === 'working-not-running')
const check = (board, firstSeen) => rule.check(board, { seen: new Map(firstSeen === undefined ? [] : [[firstSeen.key, firstSeen.at]]), observed: [] })

test('working-not-running: a worker whose card works while its chat does nothing for over 5 min trips once; 4 min does not', () => {
  const key = 'working-not-running Painter'
  const found = check(viewOf([watchLane('Painter')]), { key, at: MIN_AGO(6) })
  assert.deepEqual(found.map(one => [one.key, one.subject]), [[key, 'Painter']])
  assert.equal(found[0].text, 'Painter\'s card says it works, but its chat made no call, took nothing and wrote nothing for 6 min')
  assert.deepEqual(check(viewOf([watchLane('Painter')]), { key, at: MIN_AGO(4) }), [])
  // A card left working that the board shows off counts from when its chat was last written.
  assert.equal(check(viewOf([watchLane('Painter', { state: 'off', offSince: MIN_AGO(7) })])).length, 1)
})

test('working-not-running: not for a chat that runs or that cannot be told, nor for one on a step in progress (holder-not-running\'s)', () => {
  const key = 'working-not-running Painter'
  const long = { key, at: MIN_AGO(20) }
  assert.deepEqual(check(viewOf([watchLane('Painter', { isRunning: true })]), long), [])
  assert.deepEqual(check(viewOf([watchLane('Painter', { isRunning: null })]), long), [])
  assert.deepEqual(check(viewOf([watchLane('Painter', { state: 'free' })]), long), [])
  const holding = new Map([['B7', { head: new Map([['Id', 'B7'], ['Kind', 'step'], ['State', 'in progress'], ['Owner', 'Painter'], ['Since', stamp(MIN_AGO(30))]]), sections: new Map() }]])
  assert.deepEqual(check(viewOf([watchLane('Painter')], holding), long), [])
  // While the person pauses the chats are meant to stand still.
  assert.deepEqual(check(viewOf([watchLane('Painter')], new Map(), { pause: { state: 'pausing', since: stamp(MIN_AGO(30)) } }), long), [])
})

// B1168 (X72 came back 3 times after its close, 21:35, 21:44, 21:45): Worker 1 stopped mid-turn at 21:20, the hand-over's timers gave its
// step B423 back at 21:23 (their line), and the card read off, so the rule opened again and again. A worker the board gave a step back
// from since its stop began is answered for, and a stop that began before the incident's last close is answered for by that close.
test('B1168: working-not-running leaves out a worker whose step the board gave back since its stop began, and a stop its incident\'s close answered', () => {
  const key = 'working-not-running Painter'
  const stepOf = (id, history) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: queued\nSince: ${stamp(MIN_AGO(60))}\n\n## History\n${history.join('\n')}\n`)
  const given = (id, ago) => stepOf(id, [`- ${stamp(MIN_AGO(ago))} server: in progress → queued (given back by the board: Painter did not resume it)`])
  const incident = (closes) => parseItem(`Id: X72\nKind: incident\nTitle: Painter's card works\nState: done\nKey: ${key}\nSince: ${stamp(MIN_AGO(60))}\n\n## History\n${closes.map(ago => `- ${stamp(MIN_AGO(ago))} Supervisor: closed: no fault`).join('\n')}\n`)
  const items = (...list) => new Map(list.map(one => [one.head.get('Id'), one]))
  const off = ago => watchLane('Painter', { state: 'off', offSince: MIN_AGO(ago) })
  const seen = { key, at: MIN_AGO(30) }
  // The real case: busy, off since 21:20, B423 given back at 21:23: the timers acted, nothing opens.
  assert.deepEqual(check(viewOf([off(40)], items(given('B423', 37))), seen), [], 'given back since its stop began')
  // Nothing given back (B736's lone silent chat), or a give-back from before the stop: it opens as before.
  assert.equal(check(viewOf([off(40)]), seen).length, 1, 'nothing given back')
  assert.equal(check(viewOf([off(40)], items(given('B423', 50))), seen).length, 1, 'a give-back from before its stop began answers nothing')
  // A close of the incident after the stop began answers for it, at 21:35 and again at 21:44; a stop that began after the close counts.
  assert.deepEqual(check(viewOf([off(40)], items(incident([25]))), seen), [], 'closed after the stop began')
  assert.deepEqual(check(viewOf([off(40)], items(incident([25, 16]))), seen), [], 'closed twice')
  assert.equal(check(viewOf([off(10)], items(incident([25]))), seen).length, 1, 'a new stop after the close opens it')
  // X172's real case: Worker 4 off since 22:35, its step given back at 22:48, the incident closed at 22:59, checked at 23:03 (now): none.
  assert.deepEqual(check(viewOf([off(28)], items(given('B1150', 15), incident([4]))), { key, at: MIN_AGO(28) }), [], 'X172: given back and closed')
  assert.deepEqual(check(viewOf([off(28)], items(incident([4]))), { key, at: MIN_AGO(28) }), [], 'X172: the close alone answers for the stop')
  // A card that works (no offSince): the stop began when the board first saw it.
  assert.deepEqual(check(viewOf([watchLane('Painter')], items(incident([25]))), { key, at: MIN_AGO(30) }), [], 'seen before the close')
  assert.equal(check(viewOf([watchLane('Painter')], items(incident([25]))), { key, at: MIN_AGO(10) }).length, 1, 'seen after the close')
})
