// F9, chat 1's fix item 7 (2026-11-13, .claude/plans/2026-11-13-workers-mod-unload-cause.md): the CLI inside a chat unloaded the Workers
// mod mid-session (Worker 4 at 21:12:00Z, restored 21:30:38Z, gone again 21:36:27Z; Worker 1 at 20:22:15Z; Main at 20:25:19Z). The chat
// lives on but sends no report, takes no wake and files no ask. The board reads the two deltas from its transcript and says
// "its board link is gone: restart this chat" on its row, sends it no wake, and its "No ask filed" card names the cause.
import assert from 'node:assert/strict'
import test from 'node:test'

import { STATUSES, statusOf } from '../src/chatStatus.mjs'
import { MOD_GONE_AFTER_MS, MOD_GONE_WHY, modGoneOf, modUnloadedAt } from '../src/modGone.mjs'
import { markedIn } from '../src/transcript.mjs'
import { wakeNeeds } from '../src/wake.mjs'
import { mayWake } from '../src/work/deliver.mjs'

const MIN = 60_000
// The lines as Worker 4's transcript holds them (ddde6d5e-...jsonl lines 629, 630 and 745), cut to the fields that matter.
const retract = at => JSON.stringify({ parentUuid: 'a', isSidechain: false, attachment: { type: 'deferred_tools_delta', addedNames: [], removedNames: [], readdedNames: [], retractedTools: [{ name: 'mcp__workers__chat', cause: 'not_configured' }, { name: 'mcp__workers__work', cause: 'not_configured' }] }, type: 'attachment', uuid: 'e82b', timestamp: at })
const removed = at => JSON.stringify({ parentUuid: 'e82b', isSidechain: false, attachment: { type: 'mcp_instructions_delta', addedNames: [], addedBlocks: [], removedNames: ['workers'] }, type: 'attachment', uuid: '5a6e', timestamp: at })
const restored = at => JSON.stringify({ parentUuid: 'd5ed', isSidechain: false, attachment: { type: 'deferred_tools_delta', addedNames: [], removedNames: [], readdedNames: [], restoredNames: ['mcp__workers__chat', 'mcp__workers__work'] }, type: 'attachment', uuid: 'c5e9', timestamp: at })
const LOST = Date.parse('2026-11-13T21:12:00.500Z')
const BACK = Date.parse('2026-11-13T21:30:38.259Z')
const AGAIN = Date.parse('2026-11-13T21:36:27.000Z')
const worker4 = [retract('2026-11-13T21:12:00.500Z'), removed('2026-11-13T21:12:01.020Z'), restored('2026-11-13T21:30:38.259Z'),
  retract('2026-11-13T21:36:27.000Z'), removed('2026-11-13T21:36:27.400Z')]

test('the unload is read from the two deltas, the last one counts, and a restore takes it back', () => {
  assert.equal(modUnloadedAt(worker4.slice(0, 2).join('\n')), LOST)
  assert.equal(modUnloadedAt(worker4.slice(0, 3).join('\n')), null, 'restored at 21:30:38')
  assert.equal(modUnloadedAt(worker4.join('\n')), AGAIN, 'gone again at 21:36:27')
  // Only both deltas: the tools retracted alone, or the instructions removed alone, are no unload.
  assert.equal(modUnloadedAt(worker4[0]), null)
  assert.equal(modUnloadedAt(worker4[1]), null)
  // Another cause, or another mod's tools, is not this.
  assert.equal(modUnloadedAt([worker4[0].replaceAll('not_configured', 'failed'), worker4[1]].join('\n')), null)
  assert.equal(modUnloadedAt([worker4[0].replaceAll('mcp__workers__', 'mcp__goalmap__'), worker4[1].replace('"workers"', '"goalmap"')].join('\n')), null)
  // A line that does not parse, and nothing at all.
  assert.equal(modUnloadedAt(['{"attachment": broken', ...worker4.slice(0, 2)].join('\n')), LOST)
  assert.equal(modUnloadedAt(''), null)
  assert.equal(modUnloadedAt(null), null)
})

test('the deep look keeps exactly these lines of a big transcript', () => {
  const other = JSON.stringify({ type: 'assistant', message: { content: 'deferred tools are fine' }, timestamp: '2026-11-13T21:13:00Z' })
  const text = [other, ...worker4, other].join('\n')
  const kept = markedIn(Buffer.from(text, 'utf8'), false, ['"deferred_tools_delta"', '"mcp_instructions_delta"'])
  assert.deepEqual(kept.split('\n'), worker4)
})

test('the link is gone only while the chat is silent since the unload for over 2 minutes, in the same run of the app, its session not ended', () => {
  const now = AGAIN + 5 * MIN
  const report = { state: 'busy', at: AGAIN - 10_000 }
  assert.deepEqual(modGoneOf({ unloadedAt: AGAIN, report, now }), { at: AGAIN })
  assert.deepEqual(modGoneOf({ unloadedAt: AGAIN, report: null, now }), { at: AGAIN }, 'never reported: the unload counts')
  assert.equal(modGoneOf({ unloadedAt: AGAIN, report, now: AGAIN + MOD_GONE_AFTER_MS }), null, 'under 2 minutes: maybe mid-call')
  assert.equal(modGoneOf({ unloadedAt: AGAIN, report: { state: 'busy', at: AGAIN + 30_000 }, now }), null, 'a report after the unload: the mod is back')
  assert.equal(modGoneOf({ unloadedAt: AGAIN, report, appStartedAt: AGAIN + MIN, now }), null, 'the app started again: every mod loads anew')
  assert.equal(modGoneOf({ unloadedAt: AGAIN, report: { state: 'ended', at: AGAIN - 10_000 }, now }), null, 'a closed chat')
  assert.equal(modGoneOf({ unloadedAt: null, report, now }), null)
})

test('its row: Link gone with the one way out, before the hand-over\'s Did not answer, Unknown and Not running', () => {
  const now = AGAIN + 5 * MIN
  for (const lane of [{ state: 'unknown' }, { state: 'off', isRunning: false, offWhy: 'silent since 22:36' }, { state: 'free', isRunning: false, asleep: true }]) {
    const found = statusOf({ lane: { ...lane, modGone: { at: AGAIN }, report: { state: 'busy', at: AGAIN - 10_000 } }, handover: { state: 'noanswer', why: 'did not answer' }, now })
    assert.deepEqual([found.status, found.why, found.since], [STATUSES.LINK_GONE, MOD_GONE_WHY, AGAIN], lane.state)
  }
  assert.equal(MOD_GONE_WHY, 'its board link is gone: restart this chat')
  // Without it, as before.
  assert.equal(statusOf({ lane: { state: 'unknown', modGone: null }, now }).status, STATUSES.UNKNOWN)
})

test('no wake and no line goes to it', () => {
  const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, isRunning: false, asleep: true, asleepSince: AGAIN - MIN, state: 'free', appSession: `local_${name.replace(/\s/g, '')}`,
    session: '00000004-aaaa-bbbb-cccc-ddddeeeeffff', removedAt: null, queue: [], storeSteps: [], onSequence: true, clearOwed: null, ...more })
  const stateOf = chats => ({ chats, restart: { main: 'Main' }, chatPrefix: '', pause: null })
  const envelope = { id: '83c1a7be1feab83b', at: AGAIN, to: 'Worker 4', command: 'handover', kind: 'task', step: 'B855', clear: null, line: 'work: B855 is yours; run work next', state: 'waiting' }
  const main = lane('Main', { isMain: true, isRunning: true, asleep: false })
  assert.equal(wakeNeeds(stateOf([main, lane('Worker 4')]), [envelope]).length, 1, 'an asleep worker without the unload is woken, as before')
  assert.deepEqual(wakeNeeds(stateOf([main, lane('Worker 4', { modGone: { at: AGAIN } })]), [envelope]), [])
  assert.equal(mayWake(stateOf([lane('Worker 4', { isRunning: true, asleep: false })]), 'Worker 4'), true)
  assert.equal(mayWake(stateOf([lane('Worker 4', { isRunning: true, asleep: false, modGone: { at: AGAIN } })]), 'Worker 4'), false)
})

// The real case through the board's own state pass: Worker 4 silent since its last report at 21:36:17, its deep look holding the
// unload of 21:36:27; the board at 21:41.
const { parseConfig } = await import('../src/config.mjs')
const { buildState } = await import('../src/state.mjs')
const { storeFromText } = await import('../src/work/read.mjs')

function boardAt(now, { mods = worker4.join('\n'), reportAt = AGAIN - 10_000, appStartedAt = LOST - 60 * MIN } = {}) {
  const names = ['Lead', 'Worker 4']
  const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_0000000${name.length}-aaaa-bbbb-cccc-ddddeeeeffff`, cliSessionId: `cli-${name}`, cwd: 'C:\game', isArchived: false, createdAt: name.length, lastActivityAt: now - 2 * MIN, lastAssistantUuid: 'u-1' })
  const raw = {
    listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: names.map(app), planLineTexts: {}, work: storeFromText('## Work\n', { now: now - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {},
    tails: { 'cli-Worker 4': { text: '', isCut: false, modifiedAt: now - MIN, earlier: null, usage: null, mods } },
    appStartedAt,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now, config: { ...parseConfig('{}', {}), project: 'C:\game' }, seen: { shown: Object.fromEntries(names.map(name => [name, now - 5000])), other: {} },
    board: { startedAt: now - 30 * MIN, offSince: null },
    reports: new Map([['Lead', { state: 'idle', since: now - MIN, background: false, at: now - 2000, session: 'cli-Lead', mod: '0.31.0' }], ['Worker 4', { state: 'busy', since: reportAt - MIN, background: false, at: reportAt, session: 'cli-Worker 4', mod: '0.31.0' }]]),
    mods: { Lead: '0.31.0', 'Worker 4': '0.31.0' },
  })
}

test('the real case: Worker 4\'s row says Link gone 5 minutes after the unload; after a restore, or a report since, as before', () => {
  const now = AGAIN + 5 * MIN
  const lane = boardAt(now).chats.find(one => one.name === 'Worker 4')
  assert.deepEqual(lane.modGone, { at: AGAIN })
  assert.deepEqual([lane.status, lane.why], [STATUSES.LINK_GONE, MOD_GONE_WHY])
  const back = boardAt(now, { mods: worker4.slice(0, 3).join('\n') }).chats.find(one => one.name === 'Worker 4')
  assert.equal(back.modGone, null)
  assert.notEqual(back.status, STATUSES.LINK_GONE)
  const reporting = boardAt(now, { reportAt: now - 3000 }).chats.find(one => one.name === 'Worker 4')
  assert.equal(reporting.modGone, null)
})

test('its "No ask filed" card names the cause: the mod was unloaded, restart this chat; without the unload, as before', async () => {
  const { answer, typed } = await import('../fixtures/lines.mjs')
  const { buildState: withStore } = await import('./withStore.mjs')
  const NOW = Date.UTC(2026, 9, 26, 12, 0)
  const at = NOW - 30 * MIN
  const words = ['**Task:** dig the beds', '', '> **For you**', '> 1. **Answer:** Deep enough? I advise yes.', '', '---', '', '```diff', '  Prompt: dig the beds', '  Who:    Garden · Digger', '- Done:   partly, waiting for your answer', '```'].join('\n')
  const app = (name, lastActivityAt) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\garden', isArchived: false, createdAt: name.length, lastActivityAt, lastAssistantUuid: 'u-1',
    postTurnSummary: { status_category: 'completed', status_detail: 'done', needs_action: '', summarizes_uuid: 'u-1' } })
  const lost = new Date(at - 5 * MIN).toISOString()
  const card = mods => {
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', NOW - 5 * MIN), app('Digger', at)],
      tails: { 'cli-Lead': { text: [typed(NOW - 20 * MIN, 'Report'), answer(NOW - 10 * MIN, 'All quiet.')].join('\n'), isCut: false, modifiedAt: NOW },
        'cli-Digger': { text: [typed(at - 10 * MIN, 'Dig the beds'), answer(at, words)].join('\n'), isCut: false, modifiedAt: at, mods } },
      planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
    }
    return withStore(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\garden' } }).forYou.find(need => need.kind === 'unfiled')
  }
  const gone = card([retract(lost), removed(lost)].join('\n'))
  assert.match(gone.text, /its Workers mod was unloaded at \d\d:\d\d, so its board link is gone: restart this chat\./)
  const plain = card(null)
  assert.match(plain.text, /The board does not read questions from a chat/)
  assert.doesNotMatch(plain.text, /unloaded/)
})
