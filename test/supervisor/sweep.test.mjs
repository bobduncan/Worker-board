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
import { oddLinesOf } from '../../src/supervisor/health.mjs'
import { SWEEP_MOD, createSupervisor, tokensOfTurn } from '../../src/supervisor/index.mjs'
import { NOTHING_ODD, SWEEP_LONGEST_MS, SWEEP_SETTLE_MS, TOKENS_AFTER_MS, sweepRunner, whyNoSweep } from '../../src/supervisor/sweep.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIN = 60_000
const START = new Date(2026, 9, 24, 12, 0).getTime()

const item = head => ({ head: new Map(Object.entries(head)), sections: new Map() })
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })
const WATCHER = { name: 'Watcher', state: 'free', isRunning: true, session: 'cli-watcher' }
/** A board with nothing odd and no rule tripped: what the sweep's facts port answers (sweep.mjs `sweepRunner`). */
const QUIET = { odd: [], tripped: [] }

/**
 * A board with a supervisor: its clock, its state (a worker working unless set), the outbox the sweep words go into, the
 * timers the supervisor starts (run by hand), and the supervisor's chat as the board sees it. `facts` is what the board
 * looks like for the skip of a sweep with nothing odd and unseen (`{ odd, tripped }`, sweep.mjs): a new odd line at
 * every look unless a test sets `b.facts.value`; `ownFacts` leaves the port out, so the supervisor makes its own from the
 * health summary and its rules. `atLeast` is the setting supervisorSweepAtLeastHours.
 */
function board({ working = true, pause = null, limits = {}, chat = { named: 'Watcher', title: 'Game - Watcher', card: WATCHER, withoutMod: false, mod: '0.16.0' }, steps = [], every, atLeast, oldAfter, tokens = null, ownFacts = false, stopAt } = {}) {
  let now = START
  const facts = { value: null, looks: 0 }
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
    settings: { ...(every === undefined ? {} : { supervisorSweepMinutes: every }), ...(atLeast === undefined ? {} : { supervisorSweepAtLeastHours: atLeast }), ...(oldAfter === undefined && stopAt === undefined ? {} : { supervisor: { ...(oldAfter === undefined ? {} : { oldReadingMinutes: oldAfter }), ...(stopAt ?? {}) } }) },
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
      tokens: tokens ?? (async ({ session, from }) => (session === 'cli-watcher' && from >= START ? { total: 31_200, input: 400, cacheWrite: 2_800, cacheRead: 27_000, output: 1_000 } : null)),
      memory: { load: async () => memory.value, save: async value => { memory.value = JSON.parse(JSON.stringify(value)) } },
      ...(ownFacts ? {} : { facts: async () => facts.value ?? { odd: [`odd line ${(facts.looks += 1)}`], tripped: [] } }),
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
    supervisor, state, outbox, told, memory, chat, facts,
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
  // Its word still waits, within its time: it still runs, and nothing is asked again.
  b.at(5)
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

test('B640, B645: a limit near a stop read over 30 min ago is no "nothing changed" for the sweep while work runs; a pause and a quiet board stay quiet', async () => {
  // X47, X55, X56: only a reading near a stop (5-hour 80%, weekly 90%) is worth a lookup, so these are near one; the low ones are below.
  const old = (five, week, used = [85, 92]) => ({ fiveHour: { used: used[0], level: 'warn', at: START - five * MIN }, week: { used: used[1], level: 'warn', at: START - week * MIN } })
  const pause = { state: 'pausing', since: START - MIN }
  // B645: a pause holds the sweep word until the resume and nothing spends in it, so an old reading starts no sweep then.
  for (const limits of [old(40, 5), old(10, 5)]) {
    const paused = board({ pause, limits })
    await paused.tick()
    assert.equal(paused.sweeps().length, 0)
  }
  // Nobody works and nobody pauses (the quiet night): an old reading is no reason to sweep.
  const night = board({ working: false, limits: old(300, 300) })
  await night.tick()
  assert.equal(night.sweeps().length, 0)
  // A full limit still holds the sweep, old or not.
  const full = board({ limits: { ...old(40, 5), fiveHour: { used: 100, level: 'full', at: START - 40 * MIN } } })
  await full.tick()
  assert.equal(full.sweeps().length, 0)
  // Work runs and the board looks as at the last sweep: skipped as before, but not while a reading is old (the lookup is what changes it).
  const again = async (limits, oldAfter, stopAt) => {
    const b = board({ limits, oldAfter, stopAt })
    b.facts.value = QUIET
    await b.tick()
    b.outbox[0].state = 'delivered'
    await b.supervisor.heard({ action: 'health', ok: true })
    await b.supervisor.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START })
    b.at(11)
    await b.tick()
    return b.sweeps().length
  }
  assert.equal(await again(old(10, 5)), 1)
  assert.equal(await again(old(40, 5)), 2)
  // B645: the age counts from the supervisor settings' oldReadingMinutes (config.json "supervisor"), not from a key beside it.
  assert.equal(await again(old(10, 5), 5), 2, 'a reading 10 min old is old when the setting says 5')
  assert.equal(await again(old(40, 5), 90), 1, 'a reading 40 min old is fresh when the setting says 90')
  // X47, X55, X56 (false alarms): an old reading far from a stop changes no decision, so it no longer wakes the supervisor chat (the sweep is skipped as before).
  assert.equal(await again(old(40, 5, [11, 58])), 1, 'both limits low: no lookup for nothing')
  assert.equal(await again(old(40, 40, [2, 64])), 1, 'the readings of X55 and X56')
  assert.equal(await again(old(40, 40, [79, 89])), 1, 'just under the stop levels')
  assert.equal(await again(old(40, 5, [80, 11])), 2, 'the 5-hour limit at its level')
  assert.equal(await again(old(5, 40, [11, 90])), 2, 'the weekly limit at its level')
  assert.equal(await again(old(40, 5, [85, 11]), undefined, { oldReadingFiveHourPercent: 90 }), 1, 'the level is a setting of the supervisor')
  assert.equal(await again(old(40, 5, [60, 11]), undefined, { oldReadingFiveHourPercent: 50 }), 2)
  // Check now while the person pauses says why no sweep runs, old reading or not.
  assert.equal((await board({ pause, limits: old(40, 5) }).supervisor.checkNow({})).sweep.why, 'the person pauses all chats')
  assert.equal((await board({ pause, limits: old(10, 5) }).supervisor.checkNow({})).sweep.why, 'the person pauses all chats')
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
  // The review: the rule old-mod and the sweep go by what a chat's mod said in the last 2 minutes only; a mod that asked
  // without the header is kept as null (older than 0.16.0: test/supervisor/watch.test.mjs).
  assert.ok(server.includes('chats: Object.fromEntries([...modOf].filter(([, one]) => clock() - one.at < 2 * 60_000).map(([name, one]) => [name, one.version]))'))
  assert.ok(server.includes('const mod = said !== undefined && clock() - said.at < 2 * 60_000 ? said : undefined'))
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

test('the review: a word left "taken" (its typing never reported) or "waiting" past its time holds no later sweep, nor Check now', async () => {
  // Taken, its typing never reported; the turn ended: the next sweep comes when due, and Check now sweeps.
  const taken = board()
  await taken.tick()
  Object.assign(taken.outbox[0], { state: 'taken', takenAt: START })
  await taken.supervisor.heard({ action: 'health', ok: true })
  await taken.supervisor.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START + MIN })
  taken.at(11)
  await taken.tick()
  assert.equal(taken.sweeps().length, 2)
  taken.outbox[1].state = 'delivered'
  await taken.supervisor.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START + 11 * MIN })
  taken.at(13)
  assert.deepEqual((await taken.supervisor.checkNow({})).sweep, { started: true, why: null, note: null })
  // Never taken (its chat did not run): after its time the word is lost, the sweep ended, and the next one is asked.
  const lost = board()
  await lost.tick()
  lost.at(11)
  await lost.tick()
  assert.equal(lost.sweeps().length, 2)
  assert.deepEqual([lost.view().lastSweep.ended, lost.view().sweepsToday.count], [null, 1], 'the first one ended and kept; the second runs')
  // A sweep open for 30 minutes has ended, whatever its chat says (a chat stuck "working").
  const stuck = board()
  assert.equal((await stuck.supervisor.checkNow({})).sweep.started, true)
  stuck.outbox[0].state = 'delivered'
  stuck.chat.card = { ...WATCHER, state: 'working' }
  stuck.at(29)
  await stuck.tick()
  assert.equal(stuck.view().lastSweep.ended, null)
  stuck.at(SWEEP_LONGEST_MS / MIN)
  await stuck.tick()
  assert.equal(stuck.view().lastSweep.ended, START + SWEEP_LONGEST_MS)
  assert.match(stuck.view().lastSweep.note, /ran over 30 minutes/)
})

/** The sweep at `index` of the outbox has been typed, its health read and its turn ended (at `minutes` after START), so the next can come. */
async function endSweep(b, index, minutes = 0) {
  b.outbox[index].state = 'delivered'
  await b.supervisor.heard({ action: 'health', ok: true })
  await b.supervisor.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START + minutes * MIN })
}

test('cheaper sweeps: by the clock a sweep runs only for an odd line or a tripped rule it has not seen; else it is skipped with the note', async () => {
  const b = board()
  const stuck = 'Digger (worker): interrupted since #; runs sonnet · medium; on no step'
  const second = 'Weeder (worker): interrupted since #; runs sonnet · medium; on no step'
  b.facts.value = { odd: [stuck], tripped: [] }
  await b.tick()
  assert.equal(b.sweeps().length, 1, 'the first sweep has nothing before it')
  await endSweep(b, 0)
  // The board looks different all day, but its odd lines are the same: one sweep in over three hours.
  for (const minutes of [10, 20, 60, 200]) {
    b.at(minutes)
    await b.tick()
  }
  assert.equal(b.sweeps().length, 1, 'the same odd line')
  assert.deepEqual({ ...b.view().sweepNote, at: 0 }, { at: 0, why: NOTHING_ODD, asked: false })
  assert.equal(NOTHING_ODD, 'nothing odd since the last sweep')
  b.facts.value = QUIET
  b.at(201)
  await b.tick()
  assert.equal(b.sweeps().length, 1, 'an odd line that went is no news')
  // A new odd line: the next tick sweeps.
  b.facts.value = { odd: [stuck, second], tripped: [] }
  b.at(202)
  await b.tick()
  assert.equal(b.sweeps().length, 2, 'a new odd line')
  assert.equal(b.view().sweepNote, null, 'the note is of the sweep that did not run')
  // Kept over a restart: the sweep's file holds what it saw.
  assert.deepEqual(b.memory.value.last.facts, { odd: [stuck, second], tripped: [] })
  // Check now sweeps also while the board looks the same.
  await endSweep(b, 1, 202)
  b.at(204)
  assert.equal((await b.supervisor.checkNow({})).sweep.started, true)
})

test('cheaper sweeps: a rule tripped now that was not tripped at the last sweep wakes the next one; one that stood tripped, or tripped and mended, does not', async () => {
  const b = board()
  b.facts.value = { odd: [], tripped: ['undelivered'] }
  await b.tick()
  await endSweep(b, 0)
  // It still trips at every run of the rules (3 minutes): the sweep saw it, so no news. A rule that went is none either.
  b.at(31)
  await b.tick()
  assert.equal(b.sweeps().length, 1, 'a rule that stood tripped at the last sweep')
  b.facts.value = QUIET
  b.at(32)
  await b.tick()
  assert.equal(b.sweeps().length, 1, 'a rule that mended')
  assert.deepEqual({ ...b.view().sweepNote, at: 0 }, { at: 0, why: NOTHING_ODD, asked: false })
  // A rule tripped now that the last sweep did not see.
  b.facts.value = { odd: [], tripped: ['undelivered', 'stale-checkpoint'] }
  b.at(33)
  await b.tick()
  assert.equal(b.sweeps().length, 2, 'a newly tripped rule')
  assert.deepEqual(b.memory.value.last.facts, { odd: [], tripped: ['undelivered', 'stale-checkpoint'] })
  // What the sweep filed is seen at its turn's end: its incident is an odd line of the board now, and no sweep follows for it.
  b.facts.value = { odd: ['X9 open, from sweep, #, first #, last #: A word is lost [key: lost word]'], tripped: ['undelivered', 'stale-checkpoint'] }
  await endSweep(b, 1, 33)
  b.at(70)
  await b.tick()
  assert.equal(b.sweeps().length, 2, 'the incident the sweep itself filed')
  assert.equal(b.memory.value.last.facts.odd.length, 1)
})

test('cheaper sweeps: at least every supervisorSweepAtLeastHours (4) of work a sweep runs, whatever the board looks like; a pause, a full limit or a quiet night still hold it', async () => {
  assert.equal(parseConfig('{}', {}).supervisorSweepAtLeastHours, 4)
  assert.equal(parseConfig('{"supervisorSweepAtLeastHours":2.5}', {}).supervisorSweepAtLeastHours, 2.5)
  assert.match(configProblem('{"supervisorSweepAtLeastHours":0}'), /"supervisorSweepAtLeastHours" must be a number of hours above 0/)
  /** A board that looks quiet, one sweep done, and a tick at each of `minutes`. */
  const quiet = async (options, minutes) => {
    const b = board(options)
    b.facts.value = QUIET
    await b.tick()
    await endSweep(b, 0)
    for (const at of minutes) {
      b.at(at)
      await b.tick()
    }
    return b
  }
  const day = await quiet({}, [30, 120, 239])
  assert.equal(day.sweeps().length, 1, 'quiet, and under 4 hours')
  day.at(240)
  await day.tick()
  assert.equal(day.sweeps().length, 2, 'the safety net: 4 hours without a sweep while work runs')
  assert.equal((await quiet({ atLeast: 1 }, [59])).sweeps().length, 1)
  assert.equal((await quiet({ atLeast: 1 }, [59, 60])).sweeps().length, 2, 'the setting is in hours')
  // A pause holds it, a full limit too, and nobody working means no work: the net catches nothing then.
  const paused = await quiet({}, [30])
  paused.state.pause = { state: 'pausing', since: START + 30 * MIN }
  paused.at(300)
  await paused.tick()
  assert.equal(paused.sweeps().length, 1, 'held by the pause')
  const full = await quiet({}, [30])
  full.state.limits = { fiveHour: { used: 100, level: 'full' } }
  full.at(300)
  await full.tick()
  assert.equal(full.sweeps().length, 1, 'held by a full limit')
  const night = await quiet({}, [30])
  night.state.chats[1] = lane('Digger', { state: 'free' })
  night.at(600)
  await night.tick()
  assert.equal(night.sweeps().length, 1, 'no work runs')
})

test('cheaper sweeps: the near-stop limit exception sweeps although nothing odd is new; a fresh reading does not; Check now does', async () => {
  const old = { fiveHour: { used: 85, level: 'warn', at: START - 40 * MIN }, week: { used: 10, level: 'ok', at: START - 5 * MIN } }
  const b = board({ limits: old })
  b.facts.value = QUIET
  await b.tick()
  await endSweep(b, 0)
  b.at(11)
  await b.tick()
  assert.equal(b.sweeps().length, 2, 'the 5-hour limit is near its stop and its reading is old')
  const fresh = board({ limits: { ...old, fiveHour: { ...old.fiveHour, at: START - MIN } } })
  fresh.facts.value = QUIET
  await fresh.tick()
  await endSweep(fresh, 0)
  fresh.at(11)
  await fresh.tick()
  assert.equal(fresh.sweeps().length, 1, 'a fresh reading is no reason')
  assert.equal((await fresh.supervisor.checkNow({})).sweep.started, true)
})

test('cheaper sweeps: the odd lines of the health summary, without times and minute counts: 12 min and 13 min are the same line', () => {
  const at = (clock, span, seen, used) => [
    `The board's health at ${clock}, for the supervisor's sweep. Odd lines are marked with "!".`,
    '',
    'Chats (state and since):',
    `- ! Worker 2 (worker): working since 10:35 (${span}); runs sonnet · medium; on no step; no report known`,
    '- Worker 3 (worker): free since 10:00 (60 min); runs sonnet · medium; on no step',
    '',
    'Incidents and repairs of the last day:',
    `- ! X7 open, from sweep, seen ${seen} times, first 09:00, last ${clock}: A word is lost [key: lost word] (evidence: 5 min late)`,
    '- 10:50 repair unblock on B4 (blocked B4)',
    '- (2 more left out: the oldest and least odd)',
    '',
    'Limits and pause:',
    `- 5-hour limit: ${used}% used (ok), read at ${clock}; weekly limit: 40% used (ok), read at ${clock}`,
  ].join('\n')
  const one = oddLinesOf(at('11:00', '12 min', 2, 64))
  assert.deepEqual(one, [
    'Worker 2 (worker): working since # (#); runs sonnet · medium; on no step; no report known',
    'X7 open, from sweep, #, first #, last #: A word is lost [key: lost word] (evidence: # late)',
  ])
  assert.deepEqual(oddLinesOf(at('11:01', '13 min', 3, 70)), one, 'the minutes, the clock, how often seen and the percent do not count')
  assert.deepEqual(oddLinesOf(at('11:00', '1 h 5 min', 2, 64)), one, 'nor a span of hours')
  assert.notDeepEqual(oddLinesOf(at('11:00', '12 min', 2, 64).replace('working', 'interrupted')), one, 'a state that changed does')
  assert.deepEqual(oddLinesOf(at('11:00', '12 min', 2, 64).replace(/- ! /g, '- ')), [], 'no odd mark, no odd line')
  assert.deepEqual(oddLinesOf(''), [])
})

test('cheaper sweeps: the supervisor makes its facts itself from its summary: a changed summary with no new odd line is skipped, a new odd line sweeps', async () => {
  const b = board({ ownFacts: true })
  // One chat stands interrupted from the start: odd, and the first sweep sees it.
  b.state.chats.push(lane('Weeder', { state: 'interrupted' }))
  b.state.today = [{ chat: 'Weeder', spans: [{ from: START - 25 * MIN, to: START, state: 'interrupted' }] }]
  await b.tick()
  assert.equal(b.sweeps().length, 1)
  await endSweep(b, 0)
  // 40 minutes on, the summary reads other minutes and another worker is there, free: nothing odd is new.
  b.state.chats.push(lane('Planter', { state: 'free' }))
  b.at(40)
  await b.tick()
  assert.equal(b.sweeps().length, 1, 'the same odd line with other minute counts')
  assert.equal(b.view().sweepNote?.why, NOTHING_ODD)
  // A second chat that stands interrupted is a new odd line.
  b.state.chats.push(lane('Sower', { state: 'interrupted' }))
  b.state.today.push({ chat: 'Sower', spans: [{ from: START + 35 * MIN, to: START + 41 * MIN, state: 'interrupted' }] })
  b.at(41)
  await b.tick()
  assert.equal(b.sweeps().length, 2)
})

test('the review: a Check now right after a sweep ended keeps that sweep with its tokens', async () => {
  const reads = []
  const b = board({ tokens: async one => (reads.push(one.session), { total: 100, input: 1, cacheWrite: 2, cacheRead: 90, output: 7 }) })
  await b.tick()
  b.outbox[0].state = 'delivered'
  await b.supervisor.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START })
  // Within the 20 seconds before its tokens are read, the person presses Check now.
  assert.equal((await b.supervisor.checkNow({})).sweep.started, true)
  assert.deepEqual(reads, ['cli-watcher'])
  assert.deepEqual(b.view().sweepsToday, { count: 1, tokens: 100 })
})

test('the review: a turn\'s end told while the board asks whether the sweep still runs stays told, never "quiet"', async () => {
  let release = () => {}
  let asking = false
  const runner = sweepRunner({
    every: 10 * MIN, workRuns: async () => true, paused: async () => false, atLimit: async () => false,
    chat: async () => ({ named: 'Watcher', card: WATCHER, withoutMod: false, mod: '0.16.0' }),
    sweeping: () => (asking ? new Promise(done => { release = () => done(false) }) : Promise.resolve(false)),
    wake: async () => ({ ok: true, session: 'cli-watcher', note: null }), tokens: async () => null,
  })
  await runner.tick(START)
  asking = true
  const ticking = runner.tick(START + 3 * MIN)
  await new Promise(done => setImmediate(done))
  await runner.heard({ action: 'health', ok: true, at: START + 3 * MIN })
  await runner.heard({ action: 'turn-ended', ok: true, session: 'cli-watcher', since: START, at: START + 3 * MIN })
  release()
  await ticking
  assert.equal(runner.view().last.how, 'told')
})
