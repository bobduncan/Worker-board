// Live on 2026-10-24: a worker the Workers mod cleared after its step stayed "unknown" (its new conversation holds no
// turn yet), so the board never delivered its next step; and workers the app stopped at its weekly limit on 2026-10-21
// stayed "suspended · goes on at 20:00" for days. A cleared worker whose new conversation holds no turn is free; an app's
// stop is over once the reset it named has passed, or a newer reading shows the limit back under full. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, fromChat, hitLimit, step, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { memoryStore } from '../src/store.mjs'
import { workApi } from '../src/work/api.mjs'
import { deliverWork } from '../src/work/deliver.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 10, 5).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n')
const LOG = '.claude/chat-logs/Digger/2026-10-24 0947 B0.txt'

const app = (name, cli) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: cli, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW - 5 * MIN })
const card = extra => JSON.stringify({ name: 'Digger', role: 'worker', state: 'waiting', task: null, at: NOW - 18 * MIN, ...extra })

async function garden(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cleared-free-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const server = body => workApi(body, { dir, now: NOW, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, as: 'server' })
  /** The board's state: Digger's session `cli` (the app's file may name another, `appCli`), its card and its transcript. */
  const build = async ({ cli = 'cli-new', appCli = cli, plan = card({ cleared: { at: NOW - 18 * MIN, step: 'B0', log: LOG } }), digger = tail([]), moved = [] } = {}) => {
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', 'cli-lead'), app('Digger', appCli)], moved,
      tails: { 'cli-lead': tail([typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')]), ...(digger === null ? {} : { [cli]: digger }) },
      planLineTexts: plan === null ? {} : { [cli]: plan }, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {},
      work: { ok: true, dir, ...(await readStore(dir)) },
    }
    const seen = { shown: { Lead: NOW, Digger: NOW }, other: {} }
    return buildState(raw, { lines: [], outbox: [], runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen, now: NOW, config })
  }
  const deliver = (state, outbox) => deliverWork({ state, dir, outbox, apply: server, now: NOW, maxChars: 2000, newId: () => 'm1' })
  return { build, deliver }
}
const digger = state => state.chats.find(lane => lane.name === 'Digger')

test('a worker cleared into a conversation that holds no turn yet is free (T8.5 step 6: its next step comes by its hand-over, not by this pass)', async t => {
  const { build, deliver } = await garden(t)
  // Its card says it was cleared, and its new transcript holds nothing (or is not there yet).
  for (const transcript of [tail([]), null]) {
    const state = await build({ digger: transcript })
    assert.equal(digger(state).state, 'free')
    assert.deepEqual(state.reconciled.deliveries, [])
  }
  const outbox = memoryStore()
  await deliver(await build(), outbox)
  assert.deepEqual(outbox.outbox().filter(one => one.to === 'Digger'), [])
})

test('a chat the board followed to its new session (movedTo), with no turn there yet, is free too; its first turn decides from then on', async t => {
  const { build } = await garden(t)
  // A /clear the person ran: no "cleared" on its card, but the app still names the old session and the board followed it.
  const moved = await build({ cli: 'cli-new', appCli: 'cli-old', moved: [['cli-old', 'cli-new']], plan: card({}) })
  assert.equal(digger(moved).state, 'free')
  // Its new conversation's first turn runs: working, as any.
  const running = await build({ digger: tail([fromChat(NOW - 2 * MIN, 'Garden · Lead', 'Go on.'), step(NOW - MIN, 'Plant'), toolResult(NOW - MIN)]) })
  assert.equal(digger(running).state, 'working')
})

test('a transcript with no turn, of a chat no clear brought here, stays unknown', async t => {
  const { build } = await garden(t)
  assert.equal(digger(await build({ plan: card({}) })).state, 'unknown')
  assert.equal(digger(await build({ plan: null, digger: null })).state, 'unknown')
})

test('an app\'s limit stop whose named reset has passed is over: the lane is what its turn says', async t => {
  const { build, deliver } = await garden(t)
  // Stopped two days before at the weekly limit, "resets 8pm" of that day.
  const stopAt = new Date(2026, 9, 21, 15, 0).getTime()
  const stopped = tail([typed(stopAt - 20 * MIN, 'Plant it'), hitLimit(stopAt, 'You\'ve hit your weekly limit · resets 8pm (Europe/Berlin)')])
  const state = await build({ digger: stopped, plan: card({}) })
  assert.equal(digger(state).suspended, null)
  assert.equal(digger(state).state, 'free')
})

test('an app\'s limit stop is over once a reading after it shows that limit back under full; before, it is suspended', async t => {
  const { build } = await garden(t)
  const stopAt = NOW - 30 * MIN
  // Its reset is ahead (11:40pm today).
  const stop = [typed(stopAt - 20 * MIN, 'Plant it'), hitLimit(stopAt, 'You\'ve hit your session limit · resets 11:40pm (Europe/Berlin)')]
  assert.equal(digger(await build({ digger: tail(stop), plan: card({}) })).state, 'suspended')
  // The app's usage file read after the stop: the 5-hour window at 9%.
  const { build: withSample } = await gardenWithSample(t, `{"version":2,"samples":[{"t":${NOW - 5 * MIN},"org":"org-1","u":{"fh":9,"sd":9}}]}`)
  const back = await withSample({ digger: tail(stop), plan: card({}) })
  assert.equal(digger(back).suspended, null)
  assert.equal(digger(back).state, 'free')
  // A reading from before the stop changes nothing.
  const { build: older } = await gardenWithSample(t, `{"version":2,"samples":[{"t":${stopAt - 5 * MIN},"org":"org-1","u":{"fh":9,"sd":9}}]}`)
  assert.equal(digger(await older({ digger: tail(stop), plan: card({}) })).state, 'suspended')
})

/** The same garden, with the app's usage file as `usageText`. */
async function gardenWithSample(t, usageText) {
  const dir = await mkdtemp(join(tmpdir(), 'cleared-free-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const build = async ({ digger, plan }) => buildState({
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', 'cli-lead'), app('Digger', 'cli-new')],
    tails: { 'cli-lead': tail([typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')]), 'cli-new': digger },
    planLineTexts: { 'cli-new': plan }, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, usageText,
    work: { ok: true, dir, ...(await readStore(dir)) },
  }, { lines: [], outbox: [], runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen: { shown: { Lead: NOW, Digger: NOW }, other: {} }, now: NOW, config })
  return { build }
}
