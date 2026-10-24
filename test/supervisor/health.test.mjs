// The supervisor's Task 5: the health summary and the work tool's `health` (spec 2026-10-24, "The AI sweep" and "The
// supervisor chat"). The supervisor chat reads `work health`, a plain summary of at most 8000 characters: each chat's
// state and since when, its model and effort beside its step's, its last report and last clear; the steps under way;
// the queues; the repairs and incidents of the last day; the words not delivered; the limits. Only the chat of role
// supervisor (the list of chats' "supervisor") may read it. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer } from '../../fixtures/lines.mjs'
import { parseList } from '../../src/appChats.mjs'
import { checkTake, laneRole } from '../../src/bridge.mjs'
import { parseConfig } from '../../src/config.mjs'
import { checkSay } from '../../src/say.mjs'
import { buildState } from '../../src/state.mjs'
import { createSupervisor } from '../../src/supervisor/index.mjs'
import { HEALTH_CHARS, healthSummary } from '../../src/supervisor/health.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 24, 11, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id} of the garden`, State: state, Since: stamp(ago(30)), ...more }, sections)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, model: 'claude-sonnet-5-5', effort: 'medium', queue: [], compaction: null, task: null, ...more })

/** A board of made-up chats, steps, words and limits, with something odd in each section. */
function fixture() {
  const state = {
    chats: [
      lane('Lead', { isMain: true, state: 'working' }),
      lane('Digger', {
        state: 'working', task: { stepId: 'B12', text: 'B12 Plant the beds' },
        compaction: { kind: 'skipped', at: ago(50), why: 'it is small enough', notCleared: { at: ago(50), why: 'a subagent it started still runs (1)' } },
        queue: [{ id: 'B14', why: { reason: 'busy' } }, { id: 'B15', why: null }],
      }),
      lane('Weeder', { state: 'unknown', isRunning: false, compaction: { kind: 'cleared', at: ago(90), step: 'B10' } }),
    ],
    advisor: lane('Partner', { state: 'free' }),
    advisorHelper: null,
    chatPrefix: '',
    today: [{ chat: 'Weeder', spans: [{ from: ago(25), to: NOW, state: 'unknown' }] }],
  }
  const store = items(
    step('B10', 'review', { Owner: 'Weeder', Since: stamp(ago(95)) }, { History: [`- ${stamp(ago(95))} Weeder: in progress → review`] }),
    step('B12', 'in progress', { Owner: 'Digger', Since: stamp(ago(200)) }, { Model: ['opus: the beds\' layout is a design call'], Effort: ['high: the layout'] }),
    step('B13', 'taken', { Owner: 'Weeder', Since: stamp(ago(40)) }),
    step('B14', 'queued', { Owner: 'Digger' }),
    step('B15', 'queued', { Owner: 'Digger' }),
    step('B20', 'refined'),
    step('B21', 'new'),
    step('B9', 'done', { Owner: 'Digger' }),
    item({ Id: 'X1', Kind: 'incident', Title: 'Weeder unknown for 25 min, B13 waits', State: 'open', Source: 'unknown-lane', Subject: 'Weeder', Key: 'unknown-lane Weeder', Since: stamp(ago(15)), 'First seen': stamp(ago(15)), 'Last seen': stamp(ago(3)), Count: '5', Evidence: 'state unknown since 10:35' }),
  )
  const outbox = [
    { id: 'w1', at: ago(14), to: 'Weeder', command: 'work', about: 'B13', state: 'waiting' },
    { id: 'w2', at: ago(2), to: 'Digger', command: 'work', about: 'B12', state: 'delivered' },
  ]
  const limits = { fiveHour: { used: 64, level: 'ok', at: ago(5), resetsAt: NOW + 2 * HOUR }, week: { used: 41, level: 'ok', at: ago(5), resetsAt: null } }
  const repairs = [{ at: ago(30), rule: 'limit-back', subject: 'Weeder', key: 'limit-back Weeder' }]
  return buildView({ state, items: store, outbox, limits, pause: { state: 'running', since: ago(600) }, repairs, now: NOW })
}

test('the summary holds every section: the chats with state, since, model and effort beside the step\'s, last report and clear', () => {
  const text = healthSummary(fixture(), NOW)
  assert.ok(text.length <= HEALTH_CHARS)
  for (const title of ['Chats (', 'Steps under way (', 'Queues:', 'Incidents and repairs of the last day:', 'Words not delivered:', 'Limits and pause:']) assert.ok(text.includes(title), title)
  const line = name => text.split('\n').find(one => one.includes(`${name} (`)) ?? ''
  // A worker on a step: what it runs at beside what its step wants, its clear that did not happen, and why.
  assert.match(line('Digger'), /Digger \(worker\): working; runs sonnet · medium; its step B12 wants opus · high; on B12 "Step B12 of the garden" \(in progress\)/)
  assert.match(line('Digger'), /not cleared at 10:10: a subagent it started still runs \(1\); compaction skipped at 10:10: it is small enough$/)
  // A worker unknown since the timeline says, its chat not running: odd, with its last report and its last clear.
  assert.match(line('Weeder'), /^- ! Weeder \(worker\): unknown since 10:35 \(25 min\), its chat does not run; .*on B13 .*; last report B10 at 09:25; cleared at 09:30 after B10$/)
  assert.match(line('Lead'), /Lead \(main\): working/)
  assert.match(line('Partner'), /Partner \(partner\): free/)
  // The steps under way with state, age and owner; an old one in progress is odd; new and refined only counted.
  assert.match(text, /- ! B12 in progress for 3 h 20 min, Digger: Step B12 of the garden/)
  assert.match(text, /- ! B13 taken for 40 min, Weeder/)
  assert.match(text, /- backlog, not queued: 1 new, 1 refined/)
  assert.ok(!text.includes('B9 '), 'a done step is no step under way')
  assert.match(text, /- Digger: B14, B15 \(the first waits: busy\)/)
  // The incident with its key and evidence; the repair of the day.
  assert.match(text, /- ! X1 open, from unknown-lane, seen 5 times, first 10:45, last 10:57: Weeder unknown for 25 min, B13 waits \[key: unknown-lane Weeder\] \(evidence: state unknown since 10:35\)/)
  assert.match(text, /- 10:30 repair limit-back on Weeder \(limit-back Weeder\)/)
  // The word that waits for 14 minutes is odd; a delivered one is not listed.
  assert.match(text, /- ! 10:46 work B13 to Weeder: waiting for 14 min/)
  assert.ok(!text.includes('to Digger:'))
  assert.match(text, /- 5-hour limit: 64% used \(ok\), read at 10:55, resets at 13:00; weekly limit: 41% used \(ok\), read at 10:55/)
  assert.match(text, /- pause: running since 01:00/)
})

test('with 900 items it stays under 8000 characters and keeps the steps every chat holds; it says what it left out', () => {
  const lanes = Array.from({ length: 8 }, (_, i) => lane(`Worker ${i + 1}`, { state: 'working', task: { stepId: `B${1000 + i}`, text: 'x' } }))
  const all = []
  lanes.forEach((one, i) => {
    all.push(step(`B${1000 + i}`, 'in progress', { Owner: one.name, Title: `A long title for the step that worker ${i + 1} is on, with many words in it to fill the line` }))
    all.push(step(`B${1100 + i}`, 'review', { Owner: one.name }))
  })
  for (let i = 0; i < 300; i += 1) all.push(step(`B${2000 + i}`, 'queued', { Owner: 'Somebody gone', Title: `A queued step for a chat that left, number ${i}, with a title long enough to matter` }))
  for (let i = 0; i < 584; i += 1) all.push(step(`B${3000 + i}`, 'done', { Owner: 'Worker 1' }))
  assert.equal(all.length, 900)
  const view = buildView({ state: { chats: [lane('Lead', { isMain: true }), ...lanes], chatPrefix: '' }, items: items(...all), now: NOW })
  const text = healthSummary(view, NOW)
  assert.ok(text.length <= HEALTH_CHARS, `${text.length} characters`)
  for (const i of lanes.keys()) {
    assert.ok(text.includes(`B${1000 + i} in progress`), `B${1000 + i}`)
    assert.ok(text.includes(`B${1100 + i} review`), `B${1100 + i}`)
    assert.ok(text.includes(`Worker ${i + 1} (worker)`), `Worker ${i + 1}`)
  }
  assert.match(text, /- \(\d+ more left out: the oldest and least odd\)/)
})

/** A temporary store and the work API with a health port, as the server gives it. */
async function store(t, health = async () => 'The board\'s health at 11:00.') {
  const dir = await mkdtemp(join(tmpdir(), 'health-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 Plant the beds (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const roles = { Lead: 'main', Digger: 'worker', Partner: 'advisor', Second: 'helper', Watcher: 'supervisor' }
  const ctx = { dir, now: NOW, prefix: '', roleOf: chat => roles[chat] ?? null, ...(health === null ? {} : { health }) }
  return {
    chat: (chat, body) => workApi({ chat, ...body }, ctx),
    as: (as, body) => workApi(body, { ...ctx, as }),
  }
}

test('work health answers the summary to the supervisor chat, and refuses every other role', async t => {
  const s = await store(t)
  const read = await s.chat('Watcher', { action: 'health' })
  assert.equal(read.ok, true, read.why)
  assert.deepEqual(read.result, { text: 'The board\'s health at 11:00.', changed: false })
  for (const chat of ['Lead', 'Digger', 'Partner', 'Second']) {
    const refused = await s.chat(chat, { action: 'health' })
    assert.equal(refused.ok, false, chat)
    assert.equal(refused.status, 403, chat)
  }
  assert.equal((await s.as('person', { action: 'health' })).status, 403)
  // The supervisor chat reads and files incidents; it changes nothing else.
  assert.equal((await s.chat('Watcher', { action: 'note', to: 'main', text: 'hello' })).status, 403)
  assert.equal((await s.chat('Watcher', { action: 'incident', title: 'Digger works with no step for an hour', subject: 'Digger', evidence: 'working since 10:00, card empty', rule: 'a worker working with no step for 30 min' })).ok, true)
})

test('work health on a board without a supervisor, or one whose summary fails, says so', async t => {
  assert.equal((await (await store(t, null)).chat('Watcher', { action: 'health' })).status, 409)
  const failing = await store(t, async () => { throw new Error('the store is torn') })
  const refused = await failing.chat('Watcher', { action: 'health' })
  assert.deepEqual([refused.status, refused.why], [503, 'The health summary could not be made: the store is torn'])
})

test('the supervisor builds the summary from its ports: the board, the store, the outbox and the repairs of its memory', async () => {
  const supervisor = createSupervisor({
    state: async () => ({ chats: [lane('Lead', { isMain: true }), lane('Digger', { state: 'working' })], chatPrefix: '' }),
    items: async () => items(step('B12', 'in progress', { Owner: 'Digger' })),
    outbox: () => [{ id: 'w1', at: ago(20), to: 'Digger', command: 'work', about: 'B14', state: 'waiting' }],
    refused: () => [],
    apply: async () => ({ ok: true }),
    wake: async () => null,
    noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} },
    memory: { load: async () => ({ repairs: [{ at: ago(10), rule: 'blocked', subject: 'B12', key: 'blocked B12 B11' }] }), save: async () => {} },
    now: () => NOW,
    loops: { run: async (_name, fn) => fn(), failed: () => {} },
  })
  const text = await supervisor.health()
  assert.match(text, /^The board's health at 11:00/)
  assert.match(text, /- B12 in progress for 30 min, Digger/)
  assert.match(text, /- 10:50 repair blocked on B12 \(blocked B12 B11\)/)
  assert.match(text, /- ! 10:40 work B14 to Digger: waiting for 20 min/)
})

// The supervisor's chat: the list of chats' "supervisor", shown by its own card, never a worker.
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = name => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
function build(list = '{"prefix":"Garden · ","main":"Lead","supervisor":"watcher"}') {
  const chats = ['Lead', 'Digger', 'Watcher']
  const raw = {
    listText: list, appChatTexts: chats.map(app), tails: Object.fromEntries(chats.map(name => [`cli-${name}`, tail([answer(NOW - 30 * MIN, 'ok')])])),
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}

test('the list of chats names the supervisor\'s chat with "supervisor": no lane, no worker; it takes its words and has its role', () => {
  assert.deepEqual(parseList('{"prefix":"Team - ","main":"Lead","supervisor":" Watcher "}'), { prefix: 'Team - ', main: 'Lead', problem: null, supervisor: 'Watcher' })
  assert.equal(parseList('{"prefix":"Team - ","main":"Lead","supervisor":""}').supervisor, undefined)
  const state = build()
  assert.deepEqual(state.chats.map(one => one.name), ['Lead', 'Digger'])
  assert.equal(state.workers.count, 1)
  assert.equal(state.supervisorName, 'watcher')
  assert.deepEqual([state.supervisorChat.name, state.supervisorChat.session, state.supervisorChat.appSession], ['Watcher', 'cli-Watcher', 'local_Watcher'])
  assert.equal(state.spendingSubjects.find(one => one.name === 'Watcher').role, 'supervisor')
  assert.equal(laneRole(state, 'Watcher'), 'supervisor')
  assert.deepEqual(checkTake({ chat: 'Watcher', session: 'cli-Watcher' }, state), { ok: true, chat: 'Watcher' })
  // The main chat may be asked to start it, as any chat the board shows.
  assert.equal(checkSay({ to: 'Lead', command: 'start', chat: 'Watcher' }, { ...state, supervisorChat: { ...state.supervisorChat, isRunning: false } }, 3000).ok, true)
  // Without the entry it is a worker as before.
  const without = build('{"prefix":"Garden · ","main":"Lead"}')
  assert.equal(without.supervisorChat, null)
  assert.deepEqual(without.chats.map(one => one.name), ['Lead', 'Digger', 'Watcher'])
})
