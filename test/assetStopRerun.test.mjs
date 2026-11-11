// The asset-stop rerun (chat 1's brief of 2026-11-11, the live A245): Worker 1 (B1125) asked A242-A245; A245 was running when the
// last-lines landing restarted the board at about 13:50, so it failed with "The board stopped while it was being made: ask again,
// with follows", and NO failure word reached Worker 1 (the outbox had the ready words for A242-A244 and nothing for A245): Worker 1
// sat in a background wait from 13:50 until the person told it at 17:12, its lane reading "Working · background" all that time. Now
// (1) a job cut by a board stop runs again by itself after the restart, counting toward the same cap as the usage-limit waits; (2)
// every final failure's word reaches the asking chat, also on the restart path (the queue tells again until it went; the sweep tells
// once more when no word ever reached the chat); (3) a background-only lane with no turn for over 30 running minutes while its asset
// requests are all final reads "background task since 13:50, no news", attention after 60 min. Trimmed from the live records; a
// stand-in provider, nothing reaches Codex.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import test from 'node:test'

import { STOPPED_WHY, assetQueue } from '../src/assetQueue.mjs'
import { newAsset, readAsset } from '../src/assets.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { LIMIT_TRIES } from '../src/work/providerLimit.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { ASSET_WORD_AFTER_MS, assetResends } from '../src/work/workLines.mjs'
import { NO_NEWS_ATTENTION_MS, NO_NEWS_MS, backgroundNoNewsOf } from '../src/work/assetWait.mjs'
import { tempDir } from './tempDir.mjs'
import { buildState } from './withStore.mjs'
import { openPage } from './pageHarness.mjs'

const MIN = 60_000
const at = (hour, minute) => new Date(2026, 10, 4, hour, minute).getTime()
const CUT_AT = at(13, 50)
const PREFIX = 'Garden · '
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Worker 1', 'Worker 2', 'Advisor']

const file = head => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)
const B1125 = (more = {}) => file({ Id: 'B1125', Kind: 'step', Title: "Give each of the Knight's six abilities its own move", State: 'in progress', Owner: 'Worker 1', Activity: 'Garden', Goal: 'G68', Since: stamp(at(12, 21)), ...more })
const request = (id, state, { who = 'Worker 1', of = 'B1125', asked = at(13, 40), started = at(13, 45), ended = at(13, 50), why = '' } = {}) =>
  ({ id, who, of, kind: 'visual', provider: 'codex', mode: 'auto', text: 'The Knight', pictures: [], follows: null, state, why, files: state === 'ready' ? ['1.png'] : [], ask: null, pick: null, times: { asked, started, ended } })
/** The live records: A242-A244 ready, A245 failed by the stop at 13:50. */
const LIVE = () => [request('A242', 'ready', { ended: at(13, 44) }), request('A243', 'ready', { ended: at(13, 46) }), request('A244', 'ready', { ended: at(13, 48) }), request('A245', 'failed', { why: `${STOPPED_WHY}: ask again, with follows` })]

/** A provider that draws every request; `made` the ids it was asked. */
function standIn() {
  const made = []
  const provider = {
    name: 'codex', mode: 'auto', kinds: ['visual'], card: { title: 'Codex' },
    check: () => ({ ok: true, state: 'works', why: 'ok' }),
    provide: async request => { made.push(request.id); await writeFile(join(request.folder, '1.png'), 'png'); return { files: ['1.png'] } },
  }
  return { provider, made }
}

test('point 1: a job cut by a board stop runs again after the restart; past the cap it fails with why and the chat is told', async t => {
  const dir = join(await tempDir(t), 'assets')
  const told = []
  const { provider, made } = standIn()
  let clock = CUT_AT
  const queue = assetQueue({ dir, providers: { codex: provider }, now: () => clock, tell: async record => { told.push(`${record.id} ${record.state}${record.why === '' ? '' : `: ${record.why}`}`); return true } })
  await newAsset(dir, { who: 'Worker 1', of: 'B1125', kind: 'visual', provider: 'codex', mode: 'auto', text: 'shield throw' }, at(13, 40))
  // The board stopped while A1 ran: at the next start it goes back to waiting (no fault of the request), nobody is told, and the next pass draws it.
  await queue.pass(); await queue.idle()
  assert.equal((await readAsset(dir, 'A1')).state, 'ready')
  await newAsset(dir, { who: 'Worker 1', of: 'B1125', kind: 'visual', provider: 'codex', mode: 'auto', text: 'guard' }, at(13, 41))
  const { changeAsset } = await import('../src/assets.mjs')
  await changeAsset(dir, 'A2', { state: 'running' }, at(13, 49))
  await queue.recover()
  const back = await readAsset(dir, 'A2')
  assert.deepEqual([back.state, back.why, back.limit.why, back.limit.tries, back.limit.until <= clock, back.times.started], ['waiting', '', STOPPED_WHY, 1, true, null])
  assert.deepEqual(told, ['A1 ready'])
  await queue.pass(); await queue.idle()
  assert.deepEqual([(await readAsset(dir, 'A2')).state, made], ['ready', ['A1', 'A2']])
  assert.deepEqual(told, ['A1 ready', 'A2 ready'])
  // The mutant of point 1 (what happened to A245): a cut job failed at once. Now only the cap fails it: cut LIMIT_TRIES times running, the
  // fourth start fails it with why and the chat is told.
  await newAsset(dir, { who: 'Worker 1', of: 'B1125', kind: 'visual', provider: 'codex', mode: 'auto', text: 'rally' }, at(13, 42))
  for (let cut = 1; cut <= LIMIT_TRIES; cut++) {
    await changeAsset(dir, 'A3', current => ({ state: 'running', limit: null, limitTries: Number.isInteger(current.limit?.tries) ? current.limit.tries : current.limitTries ?? 0 }), clock)
    await queue.recover()
    assert.deepEqual([(await readAsset(dir, 'A3')).state, (await readAsset(dir, 'A3')).limit.tries], ['waiting', cut], `cut ${cut}`)
  }
  await changeAsset(dir, 'A3', current => ({ state: 'running', limit: null, limitTries: current.limit.tries }), clock)
  await queue.recover()
  const failed = await readAsset(dir, 'A3')
  assert.deepEqual([failed.state, failed.limit], ['failed', null])
  assert.equal(failed.why, `${STOPPED_WHY} (the board tried it ${LIMIT_TRIES} times)`)
  assert.equal(told.at(-1), `A3 failed: ${STOPPED_WHY} (the board tried it ${LIMIT_TRIES} times)`)
})

test('point 2: a word nobody could be told (the chat not shown yet after a start) is told again at the next pass; the sweep tells a lost one', async t => {
  const dir = join(await tempDir(t), 'assets')
  const told = []
  let shown = false
  const { provider } = standIn()
  const queue = assetQueue({ dir, providers: { codex: provider }, now: () => CUT_AT, tell: async record => { if (!shown) return false; told.push(`${record.id} ${record.state}`); return true } })
  await newAsset(dir, { who: 'Worker 1', of: 'B1125', kind: 'visual', provider: 'codex', mode: 'auto', text: 'a' }, at(13, 40))
  await queue.pass(); await queue.idle()
  assert.deepEqual([(await readAsset(dir, 'A1')).state, told], ['ready', []])
  // Still not shown: nothing; shown at the third pass: told once, and never again.
  await queue.pass(); await queue.idle()
  assert.deepEqual(told, [])
  shown = true
  await queue.pass(); await queue.idle()
  await queue.pass(); await queue.idle()
  assert.deepEqual(told, ['A1 ready'])
  // The sweep's resends: a final request older than a minute whose chat got no word at all (ready or failed), while its step is still
  // that chat's and in progress; not one with a word (also a failed word), not one younger than a minute, not another chat's step.
  const items = new Map([['B1125', B1125()]])
  const assets = new Map(LIVE().map(one => [one.id, one]))
  const word = (id, text, more = {}) => ({ id: `w-${id}`, command: 'work', kind: 'asset', to: 'Worker 1', about: id, text, state: 'delivered', at: at(13, 49), ...more })
  const words = [word('A242', 'asset A242 ready: x'), word('A243', 'asset A243 ready: x'), word('A244', 'asset A244 ready: x')]
  const now = at(14, 25)
  const found = assetResends(words, items, assets, { prefix: PREFIX, now })
  assert.deepEqual(found.map(one => [one.chat, one.id, one.state, one.key]), [['Worker 1', 'A245', 'failed', 'asset-again A245 Worker 1']])
  assert.match(found[0].why, /^The board stopped while it was being made/)
  assert.deepEqual(assetResends([...words, word('A245', 'asset A245 failed: x')], items, assets, { prefix: PREFIX, now }), [])
  assert.deepEqual(assetResends(words, items, assets, { prefix: PREFIX, now: at(13, 50) + ASSET_WORD_AFTER_MS - 1 }), [])
  assert.deepEqual(assetResends(words, new Map([['B1125', B1125({ Owner: 'Worker 2' })]]), assets, { prefix: PREFIX, now }), [])
  assert.deepEqual(assetResends(words, new Map([['B1125', B1125({ State: 'review' })]]), assets, { prefix: PREFIX, now }), [])
  // Without `now` (the mutant: the older call) only the dropped-as-gone ready words are sent again, as before.
  assert.deepEqual(assetResends(words, items, assets, { prefix: PREFIX }), [])
})

function build(items, { assets = [], now, background = true, since = CUT_AT, state = 'idle' } = {}) {
  const work = storeFromText('## Garden\n', { now: at(8, 0) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    if (item.head.get('Kind') === 'step') work.activities[0].steps.push(item.head.get('Id'))
  }
  const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(12, 0), lastAssistantUuid: 'u-1' })
  const tail = { text: '', isCut: false, modifiedAt: at(12, 0) }
  const report = (name, mine, bg) => [name, { state: mine, since: name === 'Worker 1' ? since : at(12, 0), background: bg, run: 1, seq: 1, at: now - 5_000, session: `cli-${name}`, mod: '0.31.0', busyAt: null }]
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(8, 0), assets, assetSeconds: 240,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(8, 0), offSince: null }, reports: new Map([report('Lead', 'idle', false), report('Worker 1', state, background), report('Worker 2', 'idle', false), report('Advisor', 'idle', false)]) })
}
const laneOf = (state, name = 'Worker 1') => state.chats.find(one => one.name === name)

test('point 3: the live lane reads "Working · background task since 13:50, no news" after 30 running minutes, attention after 60', async () => {
  const quiet = laneOf(build([B1125()], { assets: LIVE(), now: at(14, 25) }))
  assert.deepEqual([quiet.status, quiet.why, quiet.heldBy, quiet.attention], ['Working', 'background task since 13:50, no news', 'background', false])
  assert.deepEqual([quiet.backgroundNoNews.minutes, quiet.backgroundNoNews.attention], [35, false])
  const loud = laneOf(build([B1125()], { assets: LIVE(), now: at(14, 55) }))
  assert.deepEqual([loud.status, loud.why, loud.attention], ['Working', 'background task since 13:50, no news', true])
  // The mutant (what the person saw): under 30 minutes, or with no request at all, the plain "background"; with a request still open, the asset work.
  assert.deepEqual([laneOf(build([B1125()], { assets: LIVE(), now: at(14, 10) })).why, laneOf(build([B1125()], { assets: [], now: at(14, 55) })).why], ['background', 'background'])
  const open = [...LIVE().slice(0, 3), request('A245', 'running', { ended: null })]
  assert.match(laneOf(build([B1125()], { assets: open, now: at(14, 55) })).why, /^Codex draws/)
  // A chat busy in a turn, or whose turn ended without background work, is not this.
  assert.equal(laneOf(build([B1125()], { assets: LIVE(), now: at(14, 55), state: 'busy' })).why, null)
  assert.notEqual(laneOf(build([B1125()], { assets: LIVE(), now: at(14, 55), background: false })).status, 'Working')
  // The helper on its own: the thresholds, and the running time (an off spell of the board is no waiting).
  const lane = { name: 'Worker 1', state: 'working', heldBy: 'background', report: { since: CUT_AT } }
  const facts = ms => backgroundNoNewsOf({ lane, steps: [B1125()], assets: LIVE(), runningMs: () => ms })
  assert.equal(facts(NO_NEWS_MS - 1), null)
  assert.deepEqual([facts(NO_NEWS_MS).attention, facts(NO_NEWS_ATTENTION_MS - 1).attention, facts(NO_NEWS_ATTENTION_MS).attention], [false, false, true])
  assert.equal(backgroundNoNewsOf({ lane: { ...lane, heldBy: 'partner' }, steps: [B1125()], assets: LIVE(), runningMs: () => NO_NEWS_MS }), null)
  // The page: the pill reads Working with the words, quiet at 35 min, the warn colour at 65.
  for (const [now, late] of [[at(14, 25), false], [at(14, 55), true]]) {
    const state = JSON.parse(JSON.stringify(build([B1125()], { assets: LIVE(), now })))
    const page = await openPage({ state, now })
    try {
      const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Worker 1')
      const pill = row.querySelector('.pill')
      assert.equal(pill.dataset.status, 'Working')
      assert.equal(pill.classList.contains('is-late'), late, `late at ${new Date(now).getHours()}:${new Date(now).getMinutes()}`)
      assert.equal(row.querySelector('.status-why').textContent, 'background task since 13:50, no news')
    } finally { await page.close() }
  }
})
