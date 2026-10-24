// The supervisor's Task 6: the sweep (spec 2026-10-24, "The supervisor chat"). Every `supervisorSweepMinutes` (10 to
// start) while work runs, and at once on "Check now", the board wakes the chat of role supervisor with one word: run work
// health, file each oddity with work incident, end the turn. Its Workers mod clears it after every turn, without a log.
// Review Focus 3, quiet nights: no sweep while nothing works, while the person pauses, at a full limit, or while the last
// sweep runs. Review Focus 4: with the supervisor's chat missing, "Check now" still runs the rules and says plainly why
// no sweep ran. Each sweep's tokens come from its chat's transcript of that turn. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { line } from '../../fixtures/lines.mjs'
import { clearRefusal, messageText } from '../../src/bridge.mjs'
import { configProblem, parseConfig } from '../../src/config.mjs'
import { sweepWords, wakeFor } from '../../src/say.mjs'
import { SWEEP_MOD, createSupervisor, tokensOfTurn } from '../../src/supervisor/index.mjs'
import { SWEEP_SETTLE_MS, TOKENS_AFTER_MS, sweepRunner, whyNoSweep } from '../../src/supervisor/sweep.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIN = 60_000
const START = new Date(2026, 9, 24, 12, 0).getTime()

const item = head => ({ head: new Map(Object.entries(head)), sections: new Map() })
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })
const WATCHER = { name: 'Watcher', state: 'free', isRunning: true, session: 'cli-watcher' }

/**
 * A board with a supervisor: its clock, its state (a worker working unless set), the outbox the sweep words go into, the
 * timers the supervisor starts (run by hand), and the supervisor's chat as the board sees it.
 */
function board({ working = true, pause = null, limits = {}, chat = { named: 'Watcher', title: 'Game - Watcher', card: WATCHER, withoutMod: false, mod: '0.16.0' }, steps = [], every } = {}) {
  let now = START
  const outbox = []
  const told = []
  const intervals = []
  const memory = { value: null }
  const state = { chats: [lane('Lead', { isMain: true }), lane('Digger', { state: working ? 'working' : 'free' })], chatPrefix: 'Game - ', pause, limits }
  const ports = {
    state: async () => state,
    items: async () => new Map(steps.map(one => [one.head.get('Id'), one])),
    outbox: () => outbox,
    refused: () => [],
    apply: async body => ({ ok: true, result: { id: 'X1', opened: true }, body }),
    wake: async () => null,
    noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} },
    now: () => now,
    loops: { run: async (_name, fn) => fn(), failed: () => {} },
    settings: every === undefined ? {} : { supervisorSweepMinutes: every },
    timers: { setInterval: (fn, ms) => intervals.push({ fn, ms }), clearInterval: () => {} },
    tell: async words => {
      const message = { id: `w${outbox.length + 1}`, at: now, ...words, state: 'waiting' }
      outbox.push(message)
      told.push(message)
      return { ok: true, started: chat.card?.isRunning === false, copied: false }
    },
    sweep: {
      chat: async () => chat,
      job: 'C:/board/roles/supervisor.md',
      tokens: async ({ session, from }) => (session === 'cli-watcher' && from >= START ? { total: 31_200, input: 400, cacheWrite: 2_800, cacheRead: 27_000, output: 1_000 } : null),
      memory: { load: async () => memory.value, save: async value => { memory.value = JSON.parse(JSON.stringify(value)) } },
    },
  }
  const supervisor = createSupervisor(ports)
  supervisor.start()
  /** The minute's look whether a sweep is due (the timer of SWEEP_TICK_MS). */
  const tick = async () => {
    const minute = intervals.find(one => one.ms === MIN)
    await minute.fn()
  }
  return {
    supervisor, state, outbox, told, memory, chat,
    at: minutes => { now = START + minutes * MIN },
    tick,
    sweeps: () => told.filter(one => one.command === 'sweep'),
    view: () => supervisor.view(now),
  }
}

test('a tick after 10 minutes while a worker works wakes the supervisor once; not again while its sweep runs', async () => {
  const b = board()
  await b.tick()
  assert.equal(b.sweeps().length, 1, 'the first sweep comes at once when work runs')
  assert.deepEqual(b.sweeps()[0].text.split('\n'), [
    'sweep: run work health, file each oddity with work incident (evidence and the rule that could catch it), then end your turn',
    'Your job: C:/board/roles/supervisor.md',
  ])
  assert.deepEqual([b.sweeps()[0].to, b.sweeps()[0].about], ['Watcher', 'board'])
  // Its word still waits: it still runs, and nothing is asked again, also after its time.
  b.at(12)
  await b.tick()
  assert.equal(b.sweeps().length, 1)
  // Its chat takes it and runs the turn, then ends it: the next one comes 10 minutes after the first.
  b.outbox[0].state = 'delivered'
  b.chat.card = { ...WATCHER, state: 'working' }
  await b.supervisor.heard({ action: 'health', ok: true })
  await b.supervisor.heard({ action: 'incident', ok: true })
  b.chat.card = WATCHER
  await b.supervisor.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START + 13 * MIN })
  b.at(13)
  await b.tick()
  assert.equal(b.sweeps().length, 2, 'the last one ended 13 minutes after the first: the next is due')
  b.at(14)
  await b.tick()
  assert.equal(b.sweeps().length, 2)
})

test('Review Focus 3, quiet nights: no sweep when nothing works, while the person pauses, at a full limit, or while the last runs', async () => {
  const idle = board({ working: false })
  await idle.tick()
  assert.equal(idle.sweeps().length, 0, 'no chat works and no step is under way')
  // A step in progress is work that runs, also while every chat is free.
  const held = board({ working: false, steps: [item({ Id: 'B12', Kind: 'step', State: 'in progress', Owner: 'Digger', Since: stamp(START) })] })
  await held.tick()
  assert.equal(held.sweeps().length, 1)
  for (const pause of [{ state: 'pausing', since: START - MIN }, { state: 'resuming', since: START - MIN }]) {
    const paused = board({ pause })
    await paused.tick()
    assert.equal(paused.sweeps().length, 0, pause.state)
  }
  const full = board({ limits: { fiveHour: { used: 100, level: 'full' } } })
  await full.tick()
  assert.equal(full.sweeps().length, 0)
  // Its chat runs a turn (another board process asked it, or the person): no second word.
  const busy = board({ chat: { named: 'Watcher', title: 'Game - Watcher', card: { ...WATCHER, state: 'working' }, withoutMod: false, mod: '0.16.0' } })
  await busy.tick()
  assert.equal(busy.sweeps().length, 0)
  // 0 minutes: no sweep by the clock; Check now still sweeps.
  const off = board({ every: 0 })
  await off.tick()
  assert.equal(off.sweeps().length, 0)
  assert.equal((await off.supervisor.checkNow({})).sweep.started, true)
})

test('Check now runs the rules and sweeps at once, about the worker of its menu; while one runs, it says so', async () => {
  const b = board({ working: false })
  const done = await b.supervisor.checkNow({ subject: 'Digger' })
  assert.equal(done.run.asked, true)
  assert.equal(done.run.subject, 'Digger')
  assert.deepEqual(done.sweep, { started: true, why: null, note: null })
  assert.match(b.sweeps()[0].text, /then end your turn \(about Digger\)\n/)
  assert.equal(b.sweeps()[0].about, 'Digger')
  assert.deepEqual({ ...b.view().lastSweep, at: 0 }, { at: 0, asked: true, subject: 'Digger', ended: null, found: 0, read: false, tokens: null, tokenParts: null, note: null })
  const again = await b.supervisor.checkNow({})
  assert.deepEqual([again.sweep.started, again.sweep.why], [false, 'the sweep asked at 12:00 still runs'])
  assert.ok(again.run !== null, 'the rules ran all the same')
  assert.equal(b.sweeps().length, 1)
})

test('Review Focus 4: with the supervisor\'s chat missing, Check now runs the rules and says plainly why no sweep ran', async () => {
  const cases = [
    [{ named: null, title: 'Game - ', card: null, withoutMod: false }, 'the list of chats names no supervisor chat ("supervisor" in .claude/chats/list.json)'],
    [{ named: 'Watcher', title: 'Game - Watcher', card: null, withoutMod: false }, 'no chat "Game - Watcher" is open in the app'],
    [{ named: 'Watcher', title: 'Game - Watcher', card: WATCHER, withoutMod: true }, 'no Workers mod takes the board\'s words'],
    [{ named: 'Watcher', title: 'Game - Watcher', card: WATCHER, withoutMod: false, mod: null }, `its Workers mod is older than ${SWEEP_MOD}, which knows work health: start its chat anew`],
    [{ named: 'Watcher', title: 'Game - Watcher', card: WATCHER, withoutMod: false, mod: '0.15.0' }, `its Workers mod is 0.15.0, older than ${SWEEP_MOD}, which knows work health: start its chat anew`],
  ]
  for (const [chat, why] of cases) {
    const b = board({ chat })
    const done = await b.supervisor.checkNow({})
    assert.ok(done.run !== null && done.run.asked === true, 'the rules ran')
    assert.deepEqual(done.sweep, { started: false, why, note: null })
    assert.equal(b.sweeps().length, 0)
    assert.deepEqual({ ...b.view().sweepNote, at: 0 }, { at: 0, why, asked: true })
    // The schedule says it once, too, and wakes nothing.
    await b.tick()
    assert.equal(b.sweeps().length, 0)
  }
  // A chat whose mod has not asked since the board started is not refused (its sweep says later whether it read health).
  assert.equal(whyNoSweep({ named: 'Watcher', card: WATCHER, withoutMod: false, mod: undefined }), null)
  // A chat that does not run is woken as any chat: the main chat is asked to start it, and the section says so.
  const stopped = board({ chat: { named: 'Watcher', title: 'Game - Watcher', card: { ...WATCHER, isRunning: false }, withoutMod: false, mod: undefined } })
  assert.deepEqual((await stopped.supervisor.checkNow({})).sweep, { started: true, why: null, note: 'its chat does not run: the main chat was asked to start it' })
  // The person pauses, or a limit is full: said too.
  assert.equal((await board({ pause: { state: 'pausing', since: START } }).supervisor.checkNow({})).sweep.why, 'the person pauses all chats')
  assert.equal((await board({ limits: { week: { used: 100, level: 'full' } } }).supervisor.checkNow({})).sweep.why, 'a limit of the plan is full')
})

test('a sweep\'s tokens show in the view, read from its turn a moment after it ended; what it found, and a day\'s sum', async () => {
  const b = board()
  await b.tick()
  b.outbox[0].state = 'delivered'
  await b.supervisor.heard({ action: 'health', ok: true })
  await b.supervisor.heard({ action: 'incident', ok: true })
  await b.supervisor.heard({ action: 'incident', ok: false })
  b.at(2)
  await b.supervisor.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START + 10_000 })
  assert.equal(b.view().lastSweep.tokens, null, 'read only a moment after the turn ended')
  b.at(3)
  assert.ok(3 * MIN - 2 * MIN >= TOKENS_AFTER_MS)
  await b.tick()
  const last = b.view().lastSweep
  assert.deepEqual([last.ended, last.found, last.read, last.tokens], [START + 2 * MIN, 1, true, 31_200])
  assert.deepEqual(last.tokenParts, { input: 400, cacheWrite: 2_800, cacheRead: 27_000, output: 1_000 })
  assert.deepEqual(b.view().sweepsToday, { count: 1, tokens: 31_200 })
  assert.equal(b.view().sweepEvery, 10)
  // Kept with the project: a board started anew neither sweeps at once nor forgets it.
  assert.equal(b.memory.value.last.tokens, 31_200)
})

test('a sweep whose chat went quiet without its turn\'s end is ended after a while; one that did not read health says so', async () => {
  const b = board()
  await b.tick()
  b.outbox[0].state = 'delivered'
  b.at(1)
  await b.tick()
  assert.equal(b.view().lastSweep.ended, null)
  b.at(SWEEP_SETTLE_MS / MIN + 1)
  await b.tick()
  assert.match(b.view().lastSweep.note, /no turn of its chat ended/)
  const unread = board()
  await unread.tick()
  await unread.supervisor.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START })
  assert.match(unread.view().lastSweep.note, new RegExp(`ended without reading work health \\(its Workers mod may be older than ${SWEEP_MOD.replace(/\./g, '\\.')}`))
})

test('tokensOfTurn: each answer of the turn once (the largest of its lines), none before the turn', () => {
  const answer = (at, id, usage) => line({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage } })
  const text = [
    answer(START - MIN, 'm0', { input_tokens: 999, cache_read_input_tokens: 9999, output_tokens: 99 }),
    answer(START + 1000, 'm1', { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 12000, output_tokens: 50 }),
    answer(START + 1500, 'm1', { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 12000, output_tokens: 300 }),
    answer(START + 9000, 'm2', { input_tokens: 5, cache_read_input_tokens: 14000, output_tokens: 200 }),
  ].join('\n')
  assert.deepEqual(tokensOfTurn(text, false, START), { total: 10 + 2000 + 12000 + 300 + 5 + 14000 + 200, input: 15, cacheWrite: 2000, cacheRead: 26000, output: 500 })
  assert.equal(tokensOfTurn(text, false, START + 60 * MIN), null)
})

test('the sweep word is the board\'s own line, typed as it is; a stopped supervisor is started by the main chat', () => {
  const words = sweepWords('Watcher', { subject: null, job: 'C:/board/roles/supervisor.md' })
  assert.equal(messageText({ ...words, at: START }, () => '12:00'), words.text)
  const state = { restart: { main: 'Lead' }, chats: [lane('Lead', { isMain: true, isRunning: true })], supervisorChat: { ...WATCHER, isRunning: false, appSession: 'local_watcher' } }
  const start = wakeFor({ ...words, at: START }, state, [], START, 3000)
  assert.equal(start?.command, 'start')
  assert.equal(start?.about, 'Watcher')
  assert.match(start.text, /Its session id: local_watcher\./)
})

test('the supervisor\'s chat keeps no log: the board refuses save-log for it, as for every chat but a worker', () => {
  const refused = clearRefusal({ chats: [lane('Lead', { isMain: true })], supervisorChat: WATCHER }, 'Watcher', 0)
  assert.deepEqual([refused.status, refused.why], [409, 'Watcher is the supervisor\'s chat: only a worker\'s conversation is cleared.'])
})

test('the setting supervisorSweepMinutes: 10 unless set, 0 for none, never below 0', () => {
  assert.equal(parseConfig('{}', {}).supervisorSweepMinutes, 10)
  assert.equal(parseConfig('{"supervisorSweepMinutes":30}', {}).supervisorSweepMinutes, 30)
  assert.equal(parseConfig('{"supervisorSweepMinutes":0}', {}).supervisorSweepMinutes, 0)
  assert.match(configProblem('{"supervisorSweepMinutes":-5}'), /"supervisorSweepMinutes" must be a number of minutes, 0 or more/)
})

test('the Workers mod says its version with every call: the same as its plugin.json, and the one a sweep needs; the server keeps it per chat', async () => {
  const plugin = JSON.parse(await readFile(join(ROOT, 'mods', 'folder-branches', '.claude-plugin', 'plugin.json'), 'utf8'))
  const board = await readFile(join(ROOT, 'mods', 'folder-branches', 'hooks', 'board.ts'), 'utf8')
  assert.equal(board.match(/export const MOD_VERSION = '([\d.]+)'/)?.[1], plugin.version)
  assert.equal(SWEEP_MOD, '0.16.0')
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  assert.ok(server.includes("req.headers['x-workers-mod']"))
  assert.ok(server.includes('noteMod(body, checked)'))
  // Check now asks the main chat no more: the server's sync starts the supervisor's check, rules and sweep.
  assert.ok(server.includes('const done = await supervisor.checkNow({ subject })'))
  assert.ok(!server.includes('syncList: syncAnswer'))
})

test('sweepRunner alone: the plan\'s interface (every, workRuns, paused, atLimit, sweeping, wake), with tick and now', async () => {
  const woke = []
  const runner = sweepRunner({
    every: 10 * MIN, workRuns: async () => true, paused: async () => false, atLimit: async () => false,
    chat: async () => ({ named: 'Watcher', card: WATCHER, withoutMod: false, mod: '0.16.0' }), sweeping: async () => false,
    wake: async ({ subject }) => (woke.push(subject), { ok: true, session: 'cli-watcher', note: null }), tokens: async () => null,
  })
  assert.equal((await runner.tick(START)).started, true)
  assert.equal(await runner.tick(START + MIN), null)
  assert.deepEqual(await runner.now({ subject: 'Digger', at: START + MIN }), { started: false, why: 'the sweep asked at 12:00 still runs', note: null })
  await runner.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START, at: START + 3 * MIN })
  assert.equal((await runner.now({ subject: 'Digger', at: START + 4 * MIN })).started, true)
  assert.deepEqual(woke, [null, 'Digger'])
})
