// Warnings (2026-10-19): the two warnings of Needs your attention see the asks a chat filed. Seen live at 08:24: the
// person answered Q153 (Worker 2, decide on B356, not blocking, filed 00:02) and Q154 (Worker 4, look on B333, not
// blocking, filed 00:28) on the board, and the board showed at once "Worker 2 holds B356 but is not working and asked
// you nothing" and "Worker 4 wrote questions in its chat but filed no ask", 7 h 54 and 7 h 56 ago. Worker 4's warning
// judged its answer of 00:28 by the start of the turn the person's answer had just opened (08:24), which the board
// still counted as ended (the app's summary of the answer before stays current until the chat answers again).
// Worker 2's hint counted the answer to its only ask as "asked you nothing" before the answer had reached it. The two
// cases with their own times; their words shortened.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, modCompaction, step, toolResult, user } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { workApi } from '../src/work/api.mjs'
import { askFiledMs, parseItem, valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 9, 19, h, m, s).getTime()
const PROJECT = 'C:\\game'
// B301 (2026-10-26): a warning goes after `unfiledAskHours` (2); these cases look 8 h on, as the night's, so they set a day.
const config = { ...parseConfig('{"unfiledAskHours":24}', {}), project: PROJECT }

/** The person's answer as the board types it into the chat (the Workers mod, as the person). */
const byBoard = (time, words) => user(time, words, { origin: { kind: 'plugin', name: 'folder-branches', asUser: true } })
/** A helper's report coming back: it goes on with the turn before (transcript.mjs). */
const handBack = time => user(time, 'Another Claude session sent a message:\n<agent-message from="a99b">\n[Subagent hand-back] The review found nothing.\n</agent-message>', {
  isMeta: true, origin: { kind: 'peer', from: 'a99b', senderTaskId: 'a99b', name: 'general-purpose', body: '[Subagent hand-back] The review found nothing.', handback: true },
})
const closing = (prompt, done) => `---\n\n\`\`\`diff\n  Prompt: ${prompt}\n  Who:    Game - Worker\n${done}\n\`\`\``

const W2_ANSWER = `B356's board side is finished and reviewed twice. I'm holding the merge for your answer on Q153.

> **For you**
> 1. **Answer:** B356 adds one action, checked, to the work tool in the mod. May I change the mod A Yes or B No; I advise A (Q153, decide on B356)

${closing('B356', '- Done:   partly, waits for your answer on Q153')}`
const W4_ANSWER = `**Task:** B333: let each fight of a run draw one of the five maps.
**What I did:** Every fight of a new run takes place on one of your five maps.

> **For you**
> 1. **Answer:** Every fight of a new run now draws one of your five maps. Start a run, (Q154, look on B333)
>    [Play it: run](http://127.0.0.1:4310/#play=main&run)

${closing('B333 is yours', '+ Done:   yes')}`

/** Worker 2: took B356 at 00:00, asked Q153 at 00:02, ended its last turn at 00:30:56 with Q153 in its "For you" block. */
const WORKER_2 = [
  byBoard(at(0, 0, 54), 'work: B356 is yours; run work next'),
  step(at(0, 0, 57), 'Take B356', 'mcp__folder-branches__work'), toolResult(at(0, 0, 58)),
  step(at(0, 2, 44), 'Ask Q153', 'mcp__folder-branches__work'), toolResult(at(0, 2, 45)),
  answer(at(0, 11, 26), 'B356 is not finished yet: the review runs.'),
  handBack(at(0, 16, 15)), step(at(0, 16, 46), 'Fix the findings'), toolResult(at(0, 16, 47)),
  answer(at(0, 19, 16), 'The findings are fixed; a second review runs.'),
  handBack(at(0, 23, 11)), step(at(0, 30, 47), 'Commit'), toolResult(at(0, 30, 48)),
  answer(at(0, 30, 56), W2_ANSWER),
]
/** Worker 4: its turn began 00:02:06, it asked Q154 at 00:28:34 and answered 00:28:52; the mod compacted it then. */
const WORKER_4_NIGHT = [
  byBoard(at(0, 2, 6), '(answered on the worker board, 00:00) Q149 "The boss after the Bat fix": A'),
  step(at(0, 2, 27), 'Take B333', 'mcp__folder-branches__work'), toolResult(at(0, 2, 28)),
  step(at(0, 17, 39), 'Review B333', 'Agent'), toolResult(at(0, 17, 40)),
  answer(at(0, 22, 54), 'The review runs; I go on once it reports.'),
  handBack(at(0, 25, 17)),
  step(at(0, 28, 34), 'Ask Q154', 'mcp__folder-branches__work'), toolResult(at(0, 28, 35)),
  answer(at(0, 28, 52), W4_ANSWER),
  ...modCompaction(at(0, 29, 42)),
]
/** 08:24:33: the board typed the person's answer to Q154 into Worker 4; it has not answered yet. */
const WORKER_4_MORNING = [...WORKER_4_NIGHT, byBoard(at(8, 24, 33), '(answered on the worker board, 08:24) Q154 "Every fight of a new run now draws one of your five maps": Approved.')]

const head = lines => parseItem(`${lines.join('\n')}\n`)
const B356 = head(['Id: B356', 'Kind: step', 'Title: Let a step become done only after a check', 'State: in progress', 'Owner: Worker 2', 'Since: 2026-10-19 00:00'])
const B333 = state => head(['Id: B333', 'Kind: step', 'Title: Let each fight of a run draw one of the five maps', `State: ${state}`, 'Owner: Worker 4', `Since: 2026-10-19 ${state === 'done' ? '08:24' : '00:28'}`])
/** An ask as the store held it then: no `Filed` yet, its time in its History line, to the minute. */
const asked = (id, owner, of, kind, filed, answered = null) => parseItem([
  `Id: ${id}`, 'Kind: ask', `Title: ${id} of ${owner}`, `State: ${answered === null ? 'open' : 'answered'}`, `Owner: ${owner}`, `Since: 2026-10-19 ${answered ?? filed}`,
  `Asks: ${kind}`, 'Blocking: no', `Of: ${of}`, '', '## Text', `${id} of ${owner}`, '', '## History', `- 2026-10-19 ${filed} ${owner}: asked (${kind})`,
  ...(answered === null ? [] : [`- 2026-10-19 ${answered} person: answered: A`]), '',
].join('\n'))

/** A chat's app file; its summary of the chat's last answer stays current until the chat answers again. */
const app = (name, lastActivityAt) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt,
  lastAssistantUuid: 'u-1', postTurnSummary: { status_category: 'completed', status_detail: 'done', needs_action: '', summarizes_uuid: 'u-1' },
})

function board({ now, tails, items }) {
  const work = storeFromText('## Work\n', { now: at(0, 0) })
  for (const item of items) work.items.set(valueOf(item, 'Id'), item)
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main', at(0, 0)), app('Worker 2', tails['Worker 2'].modifiedAt), app('Worker 4', tails['Worker 4'].modifiedAt)],
    tails: { 'cli-Main': { text: answer(at(0, 0), 'ok'), isCut: false, modifiedAt: at(0, 0) }, ...Object.fromEntries(Object.entries(tails).map(([name, tail]) => [`cli-${name}`, tail])) },
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now, config })
}
const tail = (lines, modifiedAt) => ({ text: lines.join('\n'), isCut: false, modifiedAt })
const warnings = state => state.forYou.filter(need => need.kind === 'unfiled' || need.kind === 'idle').map(need => need.title)

test('the night: both asks open, so neither warning, and both asks stand under Needs your attention', () => {
  const state = board({
    now: at(8, 20),
    tails: { 'Worker 2': tail(WORKER_2, at(0, 31)), 'Worker 4': tail(WORKER_4_NIGHT, at(0, 29, 43)) },
    items: [B356, B333('review'), asked('Q153', 'Worker 2', 'B356', 'decide', '00:02'), asked('Q154', 'Worker 4', 'B333', 'look', '00:28')],
  })
  assert.deepEqual(warnings(state), [])
  assert.deepEqual(state.forYou.map(need => need.workId).sort(), ['Q153', 'Q154'])
})

test('08:24:40, the person has just answered both: the answers are on their way, neither chat is warned about', () => {
  const state = board({
    now: at(8, 24, 40),
    tails: { 'Worker 2': tail(WORKER_2, at(0, 31)), 'Worker 4': tail(WORKER_4_MORNING, at(8, 24, 34)) },
    items: [B356, B333('done'), asked('Q153', 'Worker 2', 'B356', 'decide', '00:02', '08:24'), asked('Q154', 'Worker 4', 'B333', 'look', '00:28', '08:24')],
  })
  assert.deepEqual(warnings(state), [])
})

test('Worker 2, answered and still not going on five minutes later: the hint stands again', () => {
  const state = board({
    now: at(8, 30, 30),
    tails: { 'Worker 2': tail(WORKER_2, at(0, 31)), 'Worker 4': tail(WORKER_4_NIGHT, at(0, 29, 43)) },
    items: [B356, B333('done'), asked('Q153', 'Worker 2', 'B356', 'decide', '00:02', '08:24'), asked('Q154', 'Worker 4', 'B333', 'look', '00:28', '08:24')],
  })
  assert.deepEqual(warnings(state), ['Worker 2 holds B356 but is not working and asked you nothing: it may wait for you'])
})

test('an ask gets its filing time to the millisecond (Filed); an older one counts at the end of its minute', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'warnings-'))
  try {
    await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B1 Plant the hedge (for Digger; about 1 h)\n', { now: at(7, 0) }), undefined, { now: at(7, 0) })
    const ctx = now => ({ dir, now, prefix: 'Game - ', roleOf: chat => ({ Main: 'main', Digger: 'worker' })[chat] ?? null, freeChats: new Set(['Digger']), boardUrl: 'http://127.0.0.1:4310' })
    await workApi({ chat: 'Digger', action: 'take', id: 'B1' }, ctx(at(7, 1)))
    const filed = await workApi({ chat: 'Digger', action: 'ask', of: 'B1', kind: 'decide', text: 'Box or yew?' }, ctx(at(7, 2, 13) + 456))
    assert.equal(filed.ok, true, filed.why)
    const q1 = (await readStore(dir)).items.get('Q1')
    assert.equal(valueOf(q1, 'Filed'), String(at(7, 2, 13) + 456))
    assert.equal(askFiledMs(q1), at(7, 2, 13) + 456)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  assert.equal(askFiledMs(asked('Q154', 'Worker 4', 'B333', 'look', '00:28')), at(0, 29) - 1)
  assert.equal(askFiledMs(head(['Id: Q9', 'Kind: ask', 'Title: Old', 'State: open', 'Owner: Worker 4', 'Since: 2026-10-19 00:28'])), at(0, 29) - 1)
})

/** Worker 4 alone, with the asks given, its turn (and the block) as the night left it. */
const worker4 = (items, lines = WORKER_4_NIGHT, now = at(8, 20)) => board({
  now, tails: { 'Worker 2': tail([answer(at(0, 0), 'ok')], at(0, 0)), 'Worker 4': tail(lines, at(0, 29, 43)) }, items: [B333('review'), ...items],
})
const withFiled = (item, filed) => ({ ...item, head: new Map([...item.head, ['Filed', String(filed)]]) })

test('the turn\'s start is compared with an ask\'s time to the millisecond, also within one minute', () => {
  // Its turn began 00:02:06. An ask answered since, filed 00:02:30: in that turn. One filed 00:02:01: before it.
  const answered = (filed, minute) => withFiled(asked('Q5', 'Worker 4', 'B333', 'decide', minute, '00:10'), filed)
  assert.deepEqual(warnings(worker4([answered(at(0, 2, 30), '00:02')])), [])
  assert.deepEqual(warnings(worker4([answered(at(0, 2, 1), '00:02')])), ['Worker 4 wrote questions in its chat but filed no ask'])
  // Without Filed, an ask of the turn's own minute counts as filed in it.
  assert.deepEqual(warnings(worker4([asked('Q5', 'Worker 4', 'B333', 'decide', '00:02', '00:10')])), [])
  assert.deepEqual(warnings(worker4([asked('Q5', 'Worker 4', 'B333', 'decide', '00:01', '00:10')])), ['Worker 4 wrote questions in its chat but filed no ask'])
})

test('an open ask of the chat that an item of its block asks keeps the warning away, also one filed in an earlier turn', () => {
  // Filed at 23:50 the evening before, still open: the block names it by its id.
  const earlier = parseItem(['Id: Q154', 'Kind: ask', 'Title: Every fight of a new run now draws one of your five maps', 'State: open', 'Owner: Worker 4', 'Since: 2026-10-18 23:50',
    'Asks: look', 'Blocking: no', 'Of: B333', '', '## Text', 'Every fight of a new run now draws one of your five maps. Start a run, or two, and look at the map.', '',
    '## History', '- 2026-10-18 23:50 Worker 4: asked (look)', ''].join('\n'))
  assert.deepEqual(warnings(worker4([earlier])), [])
  // In its own words, without the id: the same question.
  const words = WORKER_4_NIGHT.map(one => one.replace(' (Q154, look on B333)', ''))
  assert.deepEqual(warnings(worker4([earlier], words)), [])
  // Another question, open since an earlier turn: the block's question was not filed.
  const other = parseItem(['Id: Q150', 'Kind: ask', 'Title: Is the old map right?', 'State: open', 'Owner: Worker 4', 'Since: 2026-10-18 23:50', 'Asks: look', 'Blocking: no', '',
    '## Text', 'Is the old map right?', '', '## History', '- 2026-10-18 23:50 Worker 4: asked (look)', ''].join('\n'))
  assert.deepEqual(warnings(worker4([other], words)), ['Worker 4 wrote questions in its chat but filed no ask'])
})

test('an open ask under a step the worker holds, another chat\'s too, keeps the idle hint away; blocking or not', () => {
  const night = items => board({ now: at(8, 20), tails: { 'Worker 2': tail(WORKER_2.slice(0, 6), at(0, 11, 30)), 'Worker 4': tail([answer(at(0, 0), 'ok')], at(0, 0)) }, items: [B356, ...items] })
  assert.deepEqual(warnings(night([])), ['Worker 2 holds B356 but is not working and asked you nothing: it may wait for you'])
  assert.deepEqual(warnings(night([asked('Q153', 'Worker 2', 'B356', 'decide', '00:02')])), [])
  assert.deepEqual(warnings(night([asked('Q160', 'Advisor', 'B356', 'decide', '00:05')])), [])
  // Standalone, of its own.
  assert.deepEqual(warnings(night([asked('Q161', 'Worker 2', '-', 'do', '00:05')])), [])
  // Another chat's ask under another step: not this chat's.
  assert.deepEqual(warnings(night([asked('Q162', 'Advisor', 'B9', 'decide', '00:05')])), ['Worker 2 holds B356 but is not working and asked you nothing: it may wait for you'])
})
