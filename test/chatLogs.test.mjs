import assert from 'node:assert/strict'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { once } from 'node:events'

import { chatLogKeeper, entryText, isReadOut, leftSubjects, logBase, logFolderName, writeTextLog } from '../src/chatLogs.mjs'

const AT = Date.parse('2026-10-23T14:05:00')
const iso = ms => new Date(ms).toISOString()

/** A transcript in the shape the app writes it: the kinds of line a worker's conversation holds. */
function transcriptLines() {
  return [
    { type: 'queue-operation', operation: 'enqueue', content: 'the task' },
    { type: 'user', timestamp: iso(AT), origin: { kind: 'human' }, message: { role: 'user', content: 'Build the knight.' } },
    { type: 'attachment', timestamp: iso(AT), attachment: { type: 'total_tokens_reminder', text: 'many' } },
    { type: 'assistant', timestamp: iso(AT + 1000), message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Where is the sheet?' }] } },
    { type: 'assistant', timestamp: iso(AT + 2000), message: { role: 'assistant', content: [{ type: 'text', text: 'Reading the sheet first.' }] } },
    { type: 'assistant', timestamp: iso(AT + 3000), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls art', description: 'List the art' } }] } },
    { type: 'user', timestamp: iso(AT + 4000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'knight.png\nsheet.png' }] } },
    { type: 'user', timestamp: iso(AT + 5000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: [{ type: 'text', text: 'not found' }, { type: 'image', source: { media_type: 'image/png', data: 'A'.repeat(4096) } }] }] } },
    { type: 'user', timestamp: iso(AT + 6000), isMeta: true, origin: { kind: 'peer', name: 'Game - Main' }, message: { role: 'user', content: 'Another Claude session sent a message:\n<cross-session-message from="local_1" name="Game - Main">\nQueue B13 next.\n</cross-session-message>' } },
    { type: 'user', timestamp: iso(AT + 7000), origin: { kind: 'plugin', name: 'folder-branches', asUser: true }, message: { role: 'user', content: 'Use the red cape.\n(typed on the worker board, 14:05)' } },
    { type: 'user', timestamp: iso(AT + 7500), origin: { kind: 'plugin', name: 'folder-branches', asUser: true }, message: { role: 'user', content: 'work: B13 is yours; run work next' } },
    { type: 'attachment', timestamp: iso(AT + 8000), attachment: { type: 'queued_command', prompt: '<task-notification>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' } } },
    { type: 'system', subtype: 'compact_boundary', timestamp: iso(AT + 9000), compactMetadata: { trigger: 'manual' } },
    { type: 'user', timestamp: iso(AT + 9100), isCompactSummary: true, message: { role: 'user', content: 'Summary: the knight is drawn.' } },
    { type: 'user', timestamp: iso(AT + 9200), isMeta: true, message: { role: 'user', content: '<local-command-caveat>The command below was run directly.</local-command-caveat>' } },
    { type: 'user', timestamp: iso(AT + 9300), origin: { kind: 'plugin', name: 'folder-branches' }, message: { role: 'user', content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep the knight</command-args>' } },
    { type: 'assistant', timestamp: iso(AT + 10_000), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'The knight is in.' }] } },
  ].map(line => JSON.stringify(line))
}

async function folder() {
  return mkdtemp(join(tmpdir(), 'chat-logs-'))
}

test('a log\'s name: the chat as a folder the file viewer opens, the minute and the step', () => {
  assert.equal(logFolderName('Worker 2'), 'Worker 2')
  assert.equal(logFolderName('Levels / Environment'), 'Levels - Environment')
  assert.equal(logFolderName('..'), 'chat')
  assert.equal(logBase(AT, 'B482'), '2026-10-23 1405 B482')
  assert.equal(logBase(AT, 'not an id'), '2026-10-23 1405 no step')
})

test('the text log holds each message with its time and speaker, every tool call with its input and every result in full', async () => {
  const dir = await folder()
  try {
    const jsonl = join(dir, 'a.jsonl')
    // The last line was cut off while the app wrote it.
    await writeFile(jsonl, `${transcriptLines().join('\n')}\n{"type":"assistant","timestamp":"2026-10`)
    await writeTextLog(jsonl, join(dir, 'a.txt'), { chat: 'Worker 2', session: 's1', step: 'B12', at: AT })
    const text = await readFile(join(dir, 'a.txt'), 'utf8')
    assert.match(text, /^The conversation of Worker 2 \(session s1\), saved 2026-10-23 14:05:00 when it was cleared after its reported step B12\./)
    assert.match(text, /\[2026-10-23 14:05:00\] The person:\nBuild the knight\.\n/)
    assert.match(text, /\[2026-10-23 14:05:01\] Worker 2 \(thinking\):\nWhere is the sheet\?/)
    assert.match(text, /\[2026-10-23 14:05:02\] Worker 2:\nReading the sheet first\./)
    assert.match(text, /Worker 2 calls Bash:\n\{\n {2}"command": "ls art",\n {2}"description": "List the art"\n\}/)
    assert.match(text, /Result of Bash:\nknight\.png\nsheet\.png/)
    assert.match(text, /Result of a tool \(an error\):\nnot found\n\[a picture, image\/png, 3 KB: in the \.jsonl beside this log\]/)
    assert.match(text, /Message from Game - Main:\nQueue B13 next\./)
    assert.match(text, /The person, on the worker board:\nUse the red cape\./)
    assert.match(text, /The worker board:\nwork: B13 is yours; run work next/)
    assert.match(text, /Background notice \(arrived during the turn\):\n<task-notification>/)
    assert.match(text, /--- the conversation was compacted here \(manual\) ---/)
    assert.match(text, /Summary of the conversation before \(compaction\):\nSummary: the knight is drawn\./)
    assert.match(text, /Slash command:\n\/compact keep the knight/)
    assert.match(text, /Worker 2:\nThe knight is in\./)
    assert.match(text, /a line of the transcript that could not be read: 40 characters/)
    // The app's own bookkeeping is left out.
    assert.doesNotMatch(text, /total_tokens_reminder|queue-operation|local-command-caveat/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a large transcript is copied exactly and written as text line by line', async () => {
  const dir = await folder()
  try {
    const project = join(dir, 'project')
    const transcripts = join(dir, 'transcripts')
    await mkdir(transcripts, { recursive: true })
    // About 40 MB, one of its lines 5 MB long, and the last line torn.
    const out = createWriteStream(join(transcripts, 'big.jsonl'))
    const big = 'x'.repeat(5 * 1024 * 1024)
    const line = n => `${JSON.stringify({ type: 'assistant', timestamp: iso(AT + n), message: { role: 'assistant', content: [{ type: 'text', text: `answer ${n} ${'y'.repeat(4000)}` }] } })}\n`
    for (let n = 0; n < 9000; n += 1) if (!out.write(line(n))) await once(out, 'drain')
    out.write(`${JSON.stringify({ type: 'user', timestamp: iso(AT), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: big }] } })}\n`)
    out.write('{"type":"user","mess')
    out.end()
    await once(out, 'finish')
    const keeper = chatLogKeeper({ file: join(dir, 'data', 'chat-logs.json'), project, transcripts, clock: () => AT })
    const saved = await keeper.save({ chat: 'Worker 2', session: 'big', step: 'B482' })
    assert.equal(saved.ok, true)
    assert.equal(saved.result.log, '.claude/chat-logs/Worker 2/2026-10-23 1405 B482.txt')
    await keeper.idle()
    const source = await stat(join(transcripts, 'big.jsonl'))
    const copy = await stat(join(project, '.claude', 'chat-logs', 'Worker 2', '2026-10-23 1405 B482.jsonl'))
    assert.equal(copy.size, source.size)
    const [a, b] = await Promise.all([readFile(join(transcripts, 'big.jsonl')), readFile(join(project, '.claude', 'chat-logs', 'Worker 2', '2026-10-23 1405 B482.jsonl'))])
    assert.ok(a.equals(b))
    const text = await readFile(saved.result.file, 'utf8')
    assert.equal(text.match(/^\[2026-10-23 14:0\d:\d\d\] Worker 2:$/gm)?.length, 9000)
    assert.ok(text.includes(big))
    assert.match(text, /could not be read: 20 characters/)
    assert.deepEqual(await keeper.pending(), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a log the board did not finish is finished after a restart, from the copy once the transcript is gone', async () => {
  const dir = await folder()
  try {
    const project = join(dir, 'project')
    const transcripts = join(dir, 'transcripts')
    const logs = join(project, '.claude', 'chat-logs', 'Worker 1')
    await mkdir(transcripts, { recursive: true })
    await mkdir(logs, { recursive: true })
    await writeFile(join(transcripts, 's1.jsonl'), `${transcriptLines().join('\n')}\n`)
    // The board stopped in the middle of two logs: one not copied yet, one copied whose transcript is gone since.
    await writeFile(join(logs, 'old.jsonl'), `${transcriptLines().join('\n')}\n`)
    await writeFile(join(logs, 'old.txt.part'), 'half')
    const journal = join(dir, 'data', 'chat-logs.json')
    await mkdir(join(dir, 'data'))
    const job = (state, session, name) => ({ id: name, chat: 'Worker 1', session, step: 'B7', at: AT, state, source: join(transcripts, `${session}.jsonl`), jsonl: join(logs, `${name}.jsonl`), txt: join(logs, `${name}.txt`), log: `.claude/chat-logs/Worker 1/${name}.txt` })
    await writeFile(journal, JSON.stringify({ jobs: [job('copy', 's1', 'new'), job('text', 'gone', 'old')] }))
    const keeper = chatLogKeeper({ file: journal, project, transcripts, clock: () => AT })
    await keeper.resume()
    await keeper.idle()
    assert.match(await readFile(join(logs, 'new.txt'), 'utf8'), /Worker 1:\nThe knight is in\./)
    assert.match(await readFile(join(logs, 'old.txt'), 'utf8'), /Worker 1:\nThe knight is in\./)
    assert.equal((await readFile(join(logs, 'new.jsonl'), 'utf8')), `${transcriptLines().join('\n')}\n`)
    assert.deepEqual(JSON.parse(await readFile(journal, 'utf8')), { jobs: [], left: [] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a transcript gone before its copy is given up, said once; no transcript, no log; two logs in one minute get two names', async () => {
  const dir = await folder()
  try {
    const project = join(dir, 'project')
    const transcripts = join(dir, 'transcripts')
    await mkdir(transcripts, { recursive: true })
    const journal = join(dir, 'chat-logs.json')
    await writeFile(journal, JSON.stringify({ jobs: [{ id: 'x', chat: 'W', session: 'gone', step: null, at: AT, state: 'copy', source: join(transcripts, 'gone.jsonl'), jsonl: join(project, 'x.jsonl'), txt: join(project, 'x.txt'), log: 'x.txt' }, { broken: true }] }))
    const given = []
    const keeper = chatLogKeeper({ file: journal, project, transcripts, clock: () => AT, failed: one => given.push(one.id) })
    await keeper.resume()
    await keeper.idle()
    assert.deepEqual(given, ['x'])
    assert.deepEqual(JSON.parse(await readFile(journal, 'utf8')), { jobs: [], left: [] })
    assert.deepEqual(await keeper.save({ chat: 'W', session: 'none', step: 'B1' }), { ok: false, status: 404, why: 'No transcript of this session (none): nothing to keep.' })
    assert.equal((await keeper.save({ chat: 'W', session: '../x', step: 'B1' })).status, 400)
    await writeFile(join(transcripts, 's2.jsonl'), `${transcriptLines()[1]}\n`)
    const first = await keeper.save({ chat: 'W', session: 's2', step: 'B1' })
    const second = await keeper.save({ chat: 'W', session: 's2', step: 'B1' })
    assert.deepEqual([first.result.log, second.result.log], ['.claude/chat-logs/W/2026-10-23 1405 B1.txt', '.claude/chat-logs/W/2026-10-23 1405 B1-2.txt'])
    await keeper.idle()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('review 2: the session a cleared chat left is named until it is read to its end, also after a restart', async () => {
  const dir = await folder()
  try {
    const transcripts = join(dir, 'transcripts')
    await mkdir(transcripts, { recursive: true })
    await writeFile(join(transcripts, 'old.jsonl'), `${transcriptLines()[1]}\n`)
    const journal = join(dir, 'chat-logs.json')
    const keeper = chatLogKeeper({ file: journal, project: join(dir, 'project'), transcripts, clock: () => AT })
    await keeper.save({ chat: 'Worker 2', session: 'old', step: 'B12' })
    await keeper.save({ chat: 'Worker 2', session: 'old', step: 'B12' })
    await keeper.idle()
    assert.deepEqual(await keeper.leftSessions(), [{ session: 'old', chat: 'Worker 2', at: AT }])
    // A board started anew still names it, until it is read out.
    const again = chatLogKeeper({ file: journal, project: join(dir, 'project'), transcripts, clock: () => AT })
    assert.deepEqual((await again.leftSessions()).map(one => one.session), ['old'])
    await again.readOut('old')
    assert.deepEqual(await again.leftSessions(), [])
    assert.deepEqual(JSON.parse(await readFile(journal, 'utf8')).left, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('review 2: who is read on: the keeper\'s sessions and the state\'s moved ones, once each, never a lane\'s own; read out at the end', () => {
  const kept = [{ session: 'a-old', chat: 'Worker 1', at: 1 }, { session: 'b-old', chat: 'Worker 2', at: 2 }]
  const moved = [{ session: 'a-old', name: 'Worker 1' }, { session: 'c-old', name: 'Worker 3' }, { session: '../x', name: 'Bad' }]
  assert.deepEqual(leftSubjects(kept, moved, ['b-old']), [{ session: 'a-old', name: 'Worker 1' }, { session: 'c-old', name: 'Worker 3' }])
  assert.equal(isReadOut({ size: 100, taskOffset: 100, spendingOffset: 100 }), true)
  assert.equal(isReadOut({ size: 120, taskOffset: 100, spendingOffset: 120 }), false)
  assert.equal(isReadOut({ size: 120, taskOffset: 120, spendingOffset: 100 }), false)
  assert.equal(isReadOut({ size: null, taskOffset: 0, spendingOffset: 0 }), true)
})

test('review 9: two calls at the board\'s start share one reading of the journal: no log is lost from it', async () => {
  const dir = await folder()
  try {
    const project = join(dir, 'project')
    const transcripts = join(dir, 'transcripts')
    await mkdir(transcripts, { recursive: true })
    await writeFile(join(transcripts, 's1.jsonl'), `${transcriptLines()[1]}\n`)
    await writeFile(join(transcripts, 's2.jsonl'), `${transcriptLines()[1]}\n`)
    const journal = join(dir, 'chat-logs.json')
    const logs = join(project, 'logs')
    await writeFile(journal, JSON.stringify({ jobs: [{ id: 'old', chat: 'W', session: 's1', step: 'B1', at: AT, state: 'copy', source: join(transcripts, 's1.jsonl'), jsonl: join(logs, 'old.jsonl'), txt: join(logs, 'old.txt'), log: 'logs/old.txt' }] }))
    const keeper = chatLogKeeper({ file: journal, project, transcripts, clock: () => AT })
    // The journal's job and a new one, asked for at once: both are in the journal before either is written.
    const [, saved] = await Promise.all([keeper.pending(), keeper.save({ chat: 'W', session: 's2', step: 'B2' })])
    assert.equal(saved.ok, true)
    assert.deepEqual((await keeper.pending()).map(job => job.session).sort(), ['s1', 's2'])
    await keeper.resume()
    await keeper.idle()
    assert.deepEqual(JSON.parse(await readFile(journal, 'utf8')).jobs, [])
    assert.ok((await stat(join(logs, 'old.txt'))).size > 0)
    assert.ok((await stat(saved.result.file)).size > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('B529: a board process that gains the loops reads the journal again and finishes the log the holder left open', async () => {
  const dir = await folder()
  try {
    const project = join(dir, 'project')
    const transcripts = join(dir, 'transcripts')
    await mkdir(transcripts, { recursive: true })
    await writeFile(join(transcripts, 's1.jsonl'), `${transcriptLines().join('\n')}\n`)
    const journal = join(dir, 'chat-logs.json')
    const logs = join(project, 'logs')
    // The process without the lock read the journal (its page's self-update looks at it) while it was empty ...
    const other = chatLogKeeper({ file: journal, project, transcripts, clock: () => AT })
    assert.deepEqual(await other.pending(), [])
    // ... then the holder put a log in it and ended before it was written.
    await writeFile(journal, JSON.stringify({ jobs: [{ id: 'open', chat: 'W', session: 's1', step: 'B3', at: AT, state: 'copy', source: join(transcripts, 's1.jsonl'), jsonl: join(logs, 'open.jsonl'), txt: join(logs, 'open.txt'), log: 'logs/open.txt' }], left: [{ session: 's1', chat: 'W', at: AT }] }))
    await other.resume()
    await other.idle()
    await assert.rejects(stat(join(logs, 'open.txt')), 'without reading again, the old reading names no log')
    await other.reload()
    assert.deepEqual((await other.pending()).map(job => job.id), ['open'])
    assert.deepEqual((await other.leftSessions()).map(one => one.session), ['s1'])
    await other.resume()
    await other.idle()
    assert.match(await readFile(join(logs, 'open.txt'), 'utf8'), /W:\nThe knight is in\./)
    assert.deepEqual(JSON.parse(await readFile(journal, 'utf8')), { jobs: [], left: [{ session: 's1', chat: 'W', at: AT }] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a line that is no JSON says so; the app\'s bookkeeping writes nothing', () => {
  const ctx = { chat: 'W', tools: new Map() }
  assert.match(entryText('{"type":"user"', ctx), /could not be read/)
  assert.equal(entryText('{"type":"mode","mode":"normal"}', ctx), '')
  assert.equal(entryText('{"type":"system","subtype":"stop_hook_summary","content":"x"}', ctx), '')
})
