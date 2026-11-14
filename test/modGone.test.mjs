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
  // The review of F9 (rule 16): the pill says Link gone; its why is only the way out.
  assert.equal(MOD_GONE_WHY, 'restart this chat: archive it, then unarchive it')
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
  assert.match(gone.text, /its Workers mod was unloaded at \d\d:\d\d, so its board link is gone\. Restart this chat: archive it, then unarchive it\. Answer its questions in its chat\./)
  // The review of F9: the card knows the cause and the chat's app id (here none: `local_Digger` is no app id).
  assert.deepEqual([gone.modGone?.at, gone.chat], [Date.parse(lost), { name: 'Digger', session: null }])
  const plain = card(null)
  assert.match(plain.text, /The board does not read questions from a chat/)
  assert.doesNotMatch(plain.text, /unloaded/)
  assert.equal(Object.hasOwn(plain, 'modGone'), false, 'a card without the unload is as before')
})

// The review of F9 (lens 1): the card's ways, the reconciler's lines, the Supervisor's count and the deep look on a real file.

test('the "No ask filed" card of a gone link offers only the way into its chat, never "Ask it to file them as asks"', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
  const page = {}
  vm.runInNewContext(`${cut('cardways')}\nObject.assign(this, { cardWays })`, page)
  const ways = need => JSON.parse(JSON.stringify(page.cardWays(need, true)))
  const need = { id: 'unfiled:Worker 4:1', kind: 'unfiled', from: 'Worker 4', canAnswer: false, talk: 'window', modGone: { at: AGAIN } }
  const SESSION = 'local_00000000-0000-4000-8000-000000000004'
  assert.deepEqual(ways({ ...need, chat: { name: 'Worker 4', session: SESSION } }), [{ way: 'chat', to: 'Worker 4', href: `claude://claude.ai/epitaxy/${SESSION}`, label: 'Open Worker 4\'s chat' }])
  // Without its app id: where the board shows its chat, and still no nudge (it has no work tool).
  assert.deepEqual(ways({ ...need, chat: { name: 'Worker 4', session: null } }), [{ way: 'talk', to: 'unfiled:Worker 4:1', label: 'Open Worker 4\'s answer' }])
  // Without the unload, as before: the nudge too.
  const { modGone: _gone, ...plain } = need
  assert.deepEqual(ways(plain).map(way => way.way), ['talk', 'nudge'])
})

test('the reconciler types no step, note or partner ask to a chat whose Workers mod was unloaded', async () => {
  const { reconcile } = await import('../src/work/reconcile.mjs')
  const { parseItem } = await import('../src/work/item.mjs')
  const now = AGAIN + 5 * MIN
  const store = storeFromText('## Work\n', { now: now - 60 * MIN })
  const stamp = new Date(now - 20 * MIN)
  const since = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`
  for (const text of [
    `Id: N1\nKind: note\nTitle: For you\nState: open\nFrom: Worker 4\nTo: main\nSince: ${since}\n`,
    `Id: Q1\nKind: ask\nTitle: Which hedge?\nState: open\nOwner: Worker 4\nSince: ${since}\nFiled: ${now - 2 * MIN}\nAsks: decide\nBlocking: no\nVia: chat\nRoute: partner\n`,
  ]) store.items.set(text.match(/^Id: (\S+)/)[1], parseItem(text))
  const main = { name: 'Lead', isMain: true, isLeftover: false, state: 'free', isRunning: true, modGone: null }
  const run = ({ lead = main, partner = { name: 'Advisor', state: 'free', isRunning: true, modGone: null } } = {}) => reconcile({ store, lanes: [lead], now, times: { graceMs: 5 * MIN, askMs: 30 * MIN, idleMs: 30 * MIN }, partner })
  const before = run()
  assert.deepEqual([before.notes.map(one => one.id), before.partnerAsks.map(one => one.id)], [['N1'], ['Q1']], 'as before without the unload')
  assert.deepEqual(run({ lead: { ...main, modGone: { at: AGAIN } } }).notes, [])
  assert.deepEqual(run({ partner: { name: 'Advisor', state: 'free', isRunning: true, modGone: { at: AGAIN } } }).partnerAsks, [])
})

test('the deep look on a real transcript file keeps the two deltas among its other lines, and the board reads the unload from them', async t => {
  const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { readDeep } = await import('../src/transcript.mjs')
  // In the board's own git-ignored data folder, as test/sources.test.mjs makes its projects; removed after.
  const data = fileURLToPath(new URL('../data/', import.meta.url))
  await mkdir(data, { recursive: true })
  const root = await mkdtemp(join(data, 'modgone-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const other = at => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'deferred tools delta, said in words' }] }, timestamp: at })
  const file = join(root, 'ddde6d5e.jsonl')
  await writeFile(file, [other('2026-11-13T21:10:00Z'), ...worker4.slice(0, 2), other('2026-11-13T21:20:00Z'), ...worker4.slice(2), other('2026-11-13T21:40:00Z')].join('\n'))
  const deep = await readDeep(file)
  assert.deepEqual(deep.mods.split('\n'), worker4)
  assert.equal(modUnloadedAt(deep.mods), AGAIN)
})

test('the real case end to end: Worker 4\'s transcript on disk, read the way the board reads its sources, gives Link gone on its row', async t => {
  const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { readSources } = await import('../src/sources.mjs')
  const data = fileURLToPath(new URL('../data/', import.meta.url))
  await mkdir(data, { recursive: true })
  const root = await mkdtemp(join(data, 'modgone-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const put = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  const now = AGAIN + 5 * MIN
  const project = join(root, 'project')
  const chat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name.replace(/\s/g, '')}`, cliSessionId, cwd: project, isArchived: false, createdAt: name.length, lastActivityAt: now - 4 * MIN })
  await put('project/.claude/chats/list.json', '{"prefix":"Game - ","main":"Main"}')
  await put('app/a/b/local_main.json', chat('Main', 'main-id'))
  await put('app/a/b/local_worker4.json', chat('Worker 4', 'ddde6d5e-worker-4'))
  const said = at => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: 'Building the strip.' }] }, timestamp: at, uuid: `u-${at}` })
  await put('transcripts/main-id.jsonl', said(new Date(now - 3 * MIN).toISOString()))
  await put('transcripts/ddde6d5e-worker-4.jsonl', [said('2026-11-13T21:10:00Z'), ...worker4, said('2026-11-13T21:36:20Z')].join('\n'))
  const config = { ...parseConfig('{}', {}), project, appSessions: join(root, 'app'), transcripts: join(root, 'transcripts') }
  const raw = await readSources(config, async () => null, now)
  assert.equal(modUnloadedAt(raw.tails['ddde6d5e-worker-4'].mods), AGAIN, 'the deep look kept the deltas')
  const state = buildState({ ...raw, work: storeFromText('## Work\n', { now: now - 60 * MIN }) }, { lines: [], outbox: [], runs: [], now, config, seen: null, board: null })
  const lane = state.chats.find(one => one.name === 'Worker 4')
  assert.deepEqual(lane.modGone, { at: AGAIN })
  assert.deepEqual([lane.status, lane.why], [STATUSES.LINK_GONE, MOD_GONE_WHY])
  assert.equal(state.chats.find(one => one.name === 'Main').modGone, null)
})
