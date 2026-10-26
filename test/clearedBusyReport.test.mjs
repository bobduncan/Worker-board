// X76 (B705, B708, B712): the board cleared a worker after its report and the health check showed it working on no step.
// The case was not real: its lane log has the worker free for 23 minutes, and the '!' came in the seconds between a
// step's hand-out and its take (the step now counts as the worker's). The 30 s override of the chat's own busy report
// that B705 added is out, and so is the rule that watched for such a report: both read a real turn whose last line is
// over 1 MiB as no turn. These tests write the transcripts to disk and read them with the board's own tail reader.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { line, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { readTail } from '../src/transcript.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 26, 16, 30).getTime()
const PROJECT = 'C:\game'
const DIR = mkdtempSync(join(tmpdir(), 'cleared-busy-'))
after(() => rmSync(DIR, { recursive: true, force: true }))
const config = { ...parseConfig('{}', {}), project: PROJECT }
const iso = at => new Date(at).toISOString()

const app = name => JSON.stringify({
  title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1',
})
/** What the Workers mod's /clear leaves in the new conversation: the app's caveat and the command, both written by the mod. */
const cleared = at => [
  line({ type: 'user', timestamp: iso(at), isMeta: true, origin: { kind: 'plugin', name: 'folder-branches' }, message: { role: 'user', content: '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>' } }),
  line({ type: 'user', timestamp: iso(at), origin: { kind: 'plugin', name: 'folder-branches' }, message: { role: 'user', content: '<command-name>/clear</command-name>\n <command-message>clear</command-message>' } }),
]
/**
 * The tail of a worker the mod cleared, in the shape the app wrote it (X76: Worker 1 at 16:11:43): the session-start hook's
 * two attachments, the caveat, the command stamped two seconds before them, and the system line with the command's output.
 */
const clearedAsWritten = at => [
  line({ type: 'attachment', timestamp: iso(at), attachment: { type: 'hook_success', hookName: 'SessionStart:clear', hookEvent: 'SessionStart', content: '', stdout: '{}', stderr: '', exitCode: 0 } }),
  line({ type: 'attachment', timestamp: iso(at), attachment: { type: 'hook_additional_context', content: ['Made-up context.'], hookName: 'SessionStart', hookEvent: 'SessionStart' }, renderedRole: 'system' }),
  line({ type: 'user', timestamp: iso(at), isMeta: true, origin: { kind: 'plugin', name: 'folder-branches' }, message: { role: 'user', content: '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>' } }),
  line({ type: 'user', timestamp: iso(at - 2_000), origin: { kind: 'plugin', name: 'folder-branches' }, message: { role: 'user', content: '<command-name>/clear</command-name>\n    <command-message>clear</command-message>' } }),
  line({ type: 'system', subtype: 'local_command', timestamp: iso(at), level: 'info', isMeta: false, commandRun: { command: 'clear', args: '' }, content: '<local-command-stdout></local-command-stdout>' }),
]
const stepItem = (id, owner, state) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${stamp(NOW - 40 * MIN)}\n`)
/** A busy report as the server keeps it: pinging every 5 s, the turn heard to start `busyFor` ago. */
const busy = busyFor => ({ state: 'busy', since: NOW - busyFor, busyAt: NOW - busyFor, background: false, at: NOW - 5_000, session: 'cli-Digger', mod: '0.20.0' })
/** The report of a chat whose turn ended (its step reported) before the mod cleared it: idle, still pinging. */
const idle = { state: 'idle', since: NOW - 19 * MIN, busyAt: NOW - 20 * MIN, background: false, at: NOW - 5_000, session: 'cli-Digger', mod: '0.20.0' }

let files = 0
/** The transcript on disk, read the way the board reads it. */
async function tailOf(lines) {
  const file = join(DIR, `chat-${files++}.jsonl`)
  writeFileSync(file, `${lines.join('\n')}\n`)
  return { ...(await readTail(file)), modifiedAt: NOW - 19 * MIN }
}

async function build({ lines, busyFor = 19 * MIN, items = [], reported = busy(busyFor) }) {
  const tail = await tailOf(lines)
  const work = storeFromText('## Board\n', { now: NOW - 60 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const raw = {
    listText: '{"prefix":"Team - ","main":"Lead"}', appChatTexts: ['Lead', 'Digger'].map(app),
    tails: { 'cli-Lead': { text: '', isCut: false, modifiedAt: NOW - MIN }, 'cli-Digger': tail },
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 3 * 60 * MIN,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: { Lead: NOW - 5_000 }, other: {} },
    board: { startedAt: NOW - 30 * MIN, offSince: null }, reports: new Map([['Digger', reported]]),
  })
}
const digger = state => state.chats.find(chat => chat.name === 'Digger')

test('a chat that reported its step and was cleared is free, never working on no step: the tail as the app wrote it, and the short one', async () => {
  for (const lines of [clearedAsWritten(NOW - 19 * MIN), cleared(NOW - 19 * MIN)]) {
    const lane = digger(await build({ lines, reported: idle }))
    assert.deepEqual([lane.state, lane.isRunning], ['free', true])
  }
})

test('a turn whose last line is a tool result over 1 MiB holds no whole entry in the tail window and still reads working, as the chat reports', async () => {
  const lines = [typed(NOW - 19 * MIN, 'work: B1 is yours; run work next'), line({ type: 'user', timestamp: iso(NOW - 18 * MIN), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'x'.repeat(1_100_000) }] } })]
  const tail = await tailOf(lines)
  assert.equal(tail.isCut, true)
  assert.equal(digger(await build({ lines })).state, 'working')
  assert.equal(digger(await build({ lines, busyFor: 6 * 60 * MIN })).state, 'working')
})

test('a turn that really runs after the clear is working, also one heard to start seconds ago', async () => {
  const running = await build({ lines: [...cleared(NOW - 19 * MIN), typed(NOW - 2 * MIN, 'work: B1 is yours; run work next'), step(NOW - 20_000, 'Build')] })
  assert.equal(digger(running).state, 'working')
  assert.equal(digger(await build({ lines: cleared(NOW - 19 * MIN), busyFor: 10_000 })).state, 'working')
})

test('a cleared chat that holds a step is interrupted as before, never free; a step in review holds none', async () => {
  const lines = clearedAsWritten(NOW - 19 * MIN)
  assert.equal(digger(await build({ lines, reported: idle, items: [stepItem('B1', 'Digger', 'in progress')] })).state, 'interrupted')
  assert.equal(digger(await build({ lines, reported: idle, items: [stepItem('B1', 'Digger', 'review')] })).state, 'free')
})

test("the chat's own busy report is never overridden by a guess from its transcript: a report of a turn is working, whatever the tail holds", async () => {
  assert.equal(digger(await build({ lines: clearedAsWritten(NOW - 19 * MIN) })).state, 'working')
})
