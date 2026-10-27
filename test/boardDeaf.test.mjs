// B736 (X73, X87, X89 on 2026-10-27): from 21:12 to 21:21 the board heard no chat while every chat worked; each lane read
// unknown, then off, and working-not-running opened for chats that were fine; work health timed out twice. A stretch in
// which the board hears no chat is the board's own: the lanes keep their state, the age rules leave it out, and past 10
// minutes one incident says the board is stuck. Made-up names; the times are that evening's.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open as openFile, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { DEAF_KEEP_MS, deafSpans, hearingLog, sentAtOf } from '../src/hearing.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem } from '../src/work/item.mjs'
import { migrateBacklog, stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 9, 27, h, m, s).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Digger', 'Weeder', 'Partner', 'Watcher']
/** The last moment the board heard any chat that evening, and when it heard them again. */
const DEAF_FROM = at(21, 12, 44)
const HEARD_AGAIN = at(21, 21, 20)

const app = (name, now) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: now - 2 * MIN, lastAssistantUuid: 'u-1',
})
const report = (name, state, { since, heard, ...more }) => [name, { state, since, background: false, at: heard, session: `cli-${name}`, mod: '0.19.0', ...more }]
const stepItem = (id, owner, state, now) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${stamp(now - 40 * MIN)}\n`)

/** The board's state at `now`: every chat's conversation written at `written`, the reports and the board's hearing given. */
function build({ now, reports = [], hearing = null, items = [], written = now - 20_000, appStartedAt = at(9, 0), startedAt = at(20, 59) }) {
  const work = storeFromText('## Garden\n', { now: now - 60 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead","advisor":"Partner","supervisor":"Watcher"}',
    appChatTexts: NAMES.map(name => app(name, now)),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, { text: [typed(now - 30 * MIN, 'Go on.'), step(written, 'Build')].join('\n'), isCut: false, modifiedAt: written }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now, config, seen: { shown: {}, other: {} },
    board: { startedAt, offSince: null }, reports: new Map(reports), hearing,
  })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const rule = id => WATCH_RULES.find(one => one.id === id)
const check = (id, state, now, seen = [], items = []) => rule(id).check(buildView({ state, items: new Map(items.map(item => [item.head.get('Id'), item])), now }), { seen: new Map(seen), observed: [] })
const subjects = findings => findings.map(one => one.subject).sort()

/** That evening's reports as the board kept them when it last heard the chats (the lead idle, both workers busy). */
const EVENING = [
  report('Lead', 'idle', { since: at(21, 9, 53), heard: DEAF_FROM }),
  report('Digger', 'busy', { since: at(21, 9, 53), heard: DEAF_FROM - 2_000 }),
  report('Weeder', 'busy', { since: at(21, 6, 49), heard: DEAF_FROM - 4_000 }),
]

test('the real case (21:09 to 21:25): while the board hears no chat, no worker is read off and no working-not-running opens; the lead reads as before', () => {
  const now = at(21, 20)
  const deaf = { deaf: [], open: { from: DEAF_FROM }, lateCalls: [] }
  const kept = build({ now, reports: EVENING, hearing: deaf })
  assert.deepEqual(['Lead', 'Digger', 'Weeder'].map(name => lane(kept, name).state), ['free', 'working', 'working'])
  assert.deepEqual(['Digger', 'Weeder'].map(name => lane(kept, name).isRunning), [true, true])
  assert.deepEqual(check('working-not-running', kept, now), [])
  // Before B736 (no hearing): both workers read off since the board's last report of them, and both opened the incident.
  const before = build({ now, reports: EVENING })
  assert.deepEqual(['Digger', 'Weeder'].map(name => lane(before, name).state), ['off', 'off'])
  assert.deepEqual(subjects(check('working-not-running', before, now)), ['Digger', 'Weeder'])
  // 21:22: the board heard them again at 21:21:20; the 8 minutes it heard nobody count for no rule.
  const later = at(21, 22)
  const again = EVENING.map(([name, entry]) => [name, { ...entry, at: later - 3_000 }])
  const heard = build({ now: later, reports: again, hearing: { deaf: [{ from: DEAF_FROM, to: HEARD_AGAIN }], open: null, lateCalls: [] } })
  assert.deepEqual(check('working-not-running', heard, later, [['working-not-running Weeder', at(21, 13)]]), [])
})

test('one chat silent alone (the board hears the others) is read off and opens working-not-running after 5 min of running time', () => {
  const now = at(21, 40)
  const log = hearingLog({ startedAt: at(20, 59), quietMs: 30_000 })
  for (let t = at(21, 0); t <= now - 3_000; t += 5_000) log.heard(t)
  const reports = [
    report('Lead', 'idle', { since: at(21, 9), heard: now - 3_000 }),
    report('Digger', 'busy', { since: at(21, 9), heard: now - 4_000 }),
    report('Weeder', 'busy', { since: at(21, 9), heard: at(21, 31) }),
  ]
  const state = build({ now, reports, hearing: log.view(now) })
  assert.deepEqual([lane(state, 'Digger').state, lane(state, 'Weeder').state], ['working', 'off'])
  assert.deepEqual(subjects(check('working-not-running', state, now)), ['Weeder'])
})

test('a chat still silent after the board heard the others again opens it 5 min later, not counting the time the board heard nobody', () => {
  const deafFrom = at(21, 26)
  const heardAgain = at(21, 34)
  const hearing = { deaf: [{ from: deafFrom, to: heardAgain }], open: null, lateCalls: [] }
  const reports = now => [
    report('Lead', 'idle', { since: at(21, 9), heard: now - 3_000 }),
    report('Digger', 'busy', { since: at(21, 9), heard: now - 4_000 }),
    report('Weeder', 'busy', { since: at(21, 9), heard: deafFrom }),
  ]
  const early = at(21, 38)
  const shown = build({ now: early, reports: reports(early), hearing })
  assert.equal(lane(shown, 'Weeder').state, 'off')
  assert.deepEqual(check('working-not-running', shown, early), [])
  const late = at(21, 39, 30)
  assert.deepEqual(subjects(check('working-not-running', build({ now: late, reports: reports(late), hearing }), late)), ['Weeder'])
})

test('holder-not-running and not-cleared leave the time the board heard nobody out too; a dropped step\'s worker is no holder', () => {
  const now = at(22, 10)
  const reports = [report('Lead', 'idle', { since: at(21, 9), heard: now - 3_000 }), report('Digger', 'busy', { since: at(21, 9), heard: at(21, 30) })]
  const items = [stepItem('B12', 'Digger', 'in progress', now)]
  const hearing = deaf => ({ deaf, open: null, lateCalls: [] })
  // Off since 21:30 (40 min); 30 is the threshold: with 15 of them the board's own, 25 remain.
  const held = build({ now, reports, items, hearing: hearing([{ from: at(21, 30), to: at(21, 45) }]) })
  assert.deepEqual(check('holder-not-running', held, now, [], items), [])
  assert.deepEqual(subjects(check('holder-not-running', build({ now, reports, items, hearing: hearing([]) }), now, [], items)), ['B12'])
  const gone = [stepItem('B12', 'Digger', 'dropped', now)]
  assert.deepEqual(check('holder-not-running', build({ now, reports, items: gone, hearing: hearing([]) }), now, [], gone), [])
  // Not cleared 14 min after its report: over 10; 6 of them the board heard nobody: 8 remain.
  const owed = deaf => ({ chats: [{ name: 'Lead', isMain: true }, { name: 'Digger', state: 'free', clearOwed: { step: 'B11', reportedAt: now - 14 * MIN, canClear: true } }], deaf })
  assert.deepEqual(subjects(check('not-cleared', owed([]), now)), ['Digger'])
  assert.deepEqual(check('not-cleared', owed([{ from: now - 12 * MIN, to: now - 6 * MIN }]), now), [])
})

test('a pause counts as today: the time is counted from the pause\'s end, and the board\'s deaf time after it is left out', () => {
  const now = at(21, 50)
  const reports = [report('Lead', 'idle', { since: at(21, 9), heard: now - 3_000 }), report('Digger', 'busy', { since: at(21, 9), heard: at(21, 20) })]
  const ended = { state: 'running', since: at(21, 44), pausedAt: at(21, 30) }
  const state = deaf => ({ ...build({ now, reports, hearing: { deaf, open: null, lateCalls: [] } }), pause: ended })
  // 6 min since the pause ended: over 5.
  assert.deepEqual(subjects(check('working-not-running', state([]), now)), ['Digger'])
  // 2 of them the board heard nobody: 4 remain.
  assert.deepEqual(check('working-not-running', state([{ from: at(21, 46), to: at(21, 48) }]), now), [])
})

test('the limit: past 10 minutes of hearing nobody the lanes read as before, and one board-deaf incident says the board is stuck', () => {
  const short = at(21, 20)
  const deaf = now => build({ now, reports: EVENING, hearing: { deaf: [], open: { from: DEAF_FROM }, lateCalls: [] } })
  assert.deepEqual(check('board-deaf', deaf(short), short), [])
  const long = DEAF_FROM + DEAF_KEEP_MS + MIN
  const stuck = deaf(long)
  assert.equal(lane(stuck, 'Digger').state, 'off')
  const found = check('board-deaf', stuck, long)
  assert.equal(found.length, 1)
  assert.equal(found[0].key, 'board-deaf board')
  assert.match(found[0].text, /^the board heard no chat for 11 min \(since 21:12\)/)
  // Every chat closed (no conversation written since): no fault of the board, the lanes read off as before.
  const closed = build({ now: short, reports: EVENING, hearing: { deaf: [], open: { from: DEAF_FROM }, lateCalls: [] }, written: DEAF_FROM - MIN })
  assert.equal(lane(closed, 'Digger').state, 'off')
  assert.deepEqual(check('board-deaf', closed, short), [])
})

test('the hearing log: the start up to the first report and a quiet stretch between two are deaf; one in which the app started is not', () => {
  const log = hearingLog({ startedAt: at(21, 0), quietMs: 30_000 })
  log.heard(at(21, 2))
  log.heard(at(21, 2, 5))
  log.heard(at(21, 9))
  assert.deepEqual(log.view(at(21, 9, 10)), { deaf: [{ from: at(21, 0), to: at(21, 2) }, { from: at(21, 2, 5), to: at(21, 9) }], open: null, lateCalls: [] })
  assert.deepEqual(log.view(at(21, 10)).open, { from: at(21, 9) })
  const view = log.view(at(21, 10))
  assert.deepEqual(deafSpans(view, { now: at(21, 10) }).map(one => one.to), [at(21, 2), at(21, 9), at(21, 10)])
  assert.deepEqual(deafSpans(view, { now: at(21, 10), appStartedAt: at(21, 5) }).map(one => one.from), [at(21, 0), at(21, 9)])
  assert.deepEqual(deafSpans(view, { now: at(21, 10), ranSince: () => false }).length, 2)
  // A board that heard a chat within 30 s of its start has no deaf start.
  const quick = hearingLog({ startedAt: at(21, 0), quietMs: 30_000 })
  quick.heard(at(21, 0, 20))
  assert.deepEqual(quick.view(at(21, 0, 25)).deaf, [])
})

test('board-slow: two work calls within 2 min answered after the chat gave up are one finding; one, or two far apart, are none', () => {
  assert.equal(sentAtOf(`cli-Digger-${at(21, 11, 4)}-17`), at(21, 11, 4))
  assert.equal(sentAtOf('no id'), null)
  const log = hearingLog({ startedAt: at(21, 0), quietMs: 30_000 })
  log.answered(`cli-Watcher-${at(21, 27, 30)}-1`, at(21, 27, 35))
  log.answered(`cli-Watcher-${at(21, 27, 50)}-2`, at(21, 28, 10))
  const now = at(21, 30)
  const slow = calls => check('board-slow', { ...build({ now }), lateCalls: calls }, now)
  assert.deepEqual(log.view(now).lateCalls, [{ at: at(21, 28, 10), ms: 20_000 }])
  assert.deepEqual(slow(log.view(now).lateCalls), [])
  log.answered(`cli-Partner-${at(21, 28, 30)}-3`, at(21, 29, 15))
  const found = slow(log.view(now).lateCalls)
  assert.equal(found.length, 1)
  assert.deepEqual([found[0].key, found[0].text], ['board-slow board', 'the board did not answer for 45 s: 2 work calls in 10 min answered after the chat gave up'])
  assert.deepEqual(slow([{ at: at(21, 22), ms: 15_000 }, { at: at(21, 25), ms: 15_000 }]), [])
})

test('work health answers while a change waits in the store\'s queue', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'deaf-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const now = at(21, 28)
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 Plant the beds (for Digger; about 1 h)\n', { now }), undefined, { now })
  const roles = { Lead: 'main', Digger: 'worker', Watcher: 'supervisor' }
  let open = () => {}
  const held = new Promise(done => { open = done })
  // A change whose read of the store waits until it is let go holds the store's queue (as a slow check did that evening).
  const fs = { readFile, writeFile, rename, rm, mkdir, open: openFile, readdir: async (...args) => { await held; return readdir(...args) } }
  const slow = workApi({ chat: 'Digger', action: 'note', to: 'main', text: 'hello' }, { dir, fs, now, prefix: '', roleOf: chat => roles[chat] ?? null })
  const health = workApi({ chat: 'Watcher', action: 'health' }, { dir, now, prefix: '', roleOf: chat => roles[chat] ?? null, health: async () => 'The board\'s health at 21:28.' })
  const first = await Promise.race([health.then(answer => answer.result?.text), new Promise(done => setTimeout(() => done('still waiting'), 1000))])
  open()
  assert.equal((await slow).ok, true)
  assert.equal(first, 'The board\'s health at 21:28.')
})
