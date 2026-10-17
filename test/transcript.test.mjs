import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, autoCompaction, fromChat, line, modCompaction, slashCommand, step, text, tool, toolResult, typed, user } from '../fixtures/lines.mjs'
import { conversation, doingNow, markedIn, parseTail, turnEnded, turnStart, turnState, unanswered } from '../src/transcript.mjs'

const T = Date.UTC(2026, 9, 12, 8, 0)
const min = n => T + n * 60_000
const entries = lines => parseTail(lines.join('\n'), false)

test('parseTail keeps the user and assistant entries and skips every other type', () => {
  const parsed = entries([
    line({ type: 'custom-title', title: 'x' }),
    typed(min(0), 'Start'),
    line({ type: 'system', subtype: 'stop_hook_summary' }),
    answer(min(1), 'Done'),
  ])
  assert.deepEqual(parsed.map(e => e.type), ['user', 'assistant'])
  assert.equal(parsed[0].at, min(0))
})

test('parseTail drops the first line of a cut piece', () => {
  const cut = `e":"user","message":{"content":"half a line"}}\n${answer(min(1), 'Done')}`
  assert.equal(parseTail(cut, true).length, 1)
  assert.equal(parseTail(`${typed(min(0), 'whole')}\n${answer(min(1), 'Done')}`, true).length, 1)
})

test('parseTail skips a line that does not parse, and reads Windows line ends', () => {
  const parsed = parseTail([typed(min(0), 'Start'), '{ broken', answer(min(1), 'Done')].join('\r\n'), false)
  assert.equal(parsed.length, 2)
})

test('markedIn keeps only the lines that can start or end a task, in order, and drops a cut first line', () => {
  const handOver = fromChat(min(1), 'Game - Main', 'Build the archer: “4x”, with é and 日本')
  const report = assistant(min(9), 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Done.' })])
  const asked = typed(min(11), 'One more thing')
  const end = answer(min(10), 'Reported.')
  const piece = [handOver, step(min(2), 'Run the tests'), toolResult(min(3)), report, toolResult(min(9)), end, asked, ...slashCommand(min(12), '/git')]
  const marked = lines => markedIn(Buffer.from(lines.join('\n')), false)
  assert.equal(marked(piece), [handOver, report, end, asked].join('\n'))
  assert.equal(markedIn(Buffer.from(piece.join('\r\n')), false).replace(/\r/g, ''), [handOver, report, end, asked].join('\n'))
  assert.equal(markedIn(Buffer.from(`${handOver}\n${report}`), true), report)
  assert.equal(markedIn(Buffer.from(handOver), true), '')
  assert.equal(markedIn(Buffer.from(''), false), '')
  // A line that holds two marks is kept once.
  const both = fromChat(min(1), 'Game - Main', 'Use "SendMessage" when done')
  assert.equal(marked([both, both]), `${both}\n${both}`)
})

test('turnState: a turn that ended', () => {
  assert.equal(turnState(entries([typed(min(0), 'Go'), step(min(1), 'Run the tests'), toolResult(min(2)), answer(min(3), 'Done')])), 'ended')
})

test('turnState: a turn running after a tool result', () => {
  assert.equal(turnState(entries([typed(min(0), 'Go'), step(min(1), 'Run the tests'), toolResult(min(2))])), 'running')
})

test('turnState: a turn running right after something was typed, or sent by another chat', () => {
  assert.equal(turnState(entries([answer(min(0), 'Done'), typed(min(1), 'One more thing')])), 'running')
  assert.equal(turnState(entries([answer(min(0), 'Done'), fromChat(min(1), 'Game - Main', 'Task: the archer')])), 'running')
})

test('turnState: a slash command after the end of a turn starts no turn', () => {
  assert.equal(turnState(entries([answer(min(0), 'Done'), ...slashCommand(min(5), '/reload-plugins')])), 'ended')
})

test('B247: turnState: a /compact a mod ran after the end of a turn starts no turn', () => {
  assert.equal(turnState(entries([typed(min(0), 'Go'), answer(min(1), 'Done'), ...modCompaction(min(2))])), 'ended')
})

// B262: a worker that reported, recorded its card and wrapped up, whose last answer never reached the board's piece:
// after a /compact the app writes an older stretch of the chat again just before its mark, so the piece ends in the
// tools' answers, then the compaction.
const reportedAndCompacted = [
  assistant(min(26), 'tool_use', [tool('SendMessage', { to: 'Main', message: 'Report from Worker: a made-up step done.' })]),
  assistant(min(26), 'tool_use', [tool('mcp__a-mod__chat', { action: 'done' })]),
  assistant(min(26), 'tool_use', [tool('mcp__an-app__wrap_up', { recap: 'A made-up recap.' })]),
  toolResult(min(27)), toolResult(min(27)), toolResult(min(27)),
  ...modCompaction(min(53)),
]

test('B262: turnState: a compaction ends the turn before it, also one that ends in a tool\'s answer', () => {
  assert.equal(turnState(entries(reportedAndCompacted)), 'ended')
  assert.deepEqual(turnEnded(entries(reportedAndCompacted)), { at: min(53), how: 'compaction' })
})

test('B262: turnState: the app\'s own compaction in the middle of a turn ends nothing: the turn goes on after it', () => {
  const going = [typed(min(0), 'Go'), step(min(1), 'Run the tests'), toolResult(min(2)), ...autoCompaction(min(3)), step(min(4), 'Run the tests again')]
  assert.equal(turnState(entries(going)), 'running')
  assert.equal(turnState(entries([...going, toolResult(min(5))])), 'running')
  assert.equal(turnEnded(entries(going)), null)
  // What opened the turn still holds it.
  assert.equal(turnStart(entries(going)).isOpen, true)
})

test('B262: turnEnded: a closing answer after a wrap-up ends the turn; a tool\'s last answer may have ended it without one', () => {
  const wrapUp = [typed(min(0), 'Go'), assistant(min(1), 'tool_use', [tool('mcp__an-app__wrap_up', { recap: 'A made-up recap.' })]), toolResult(min(2))]
  assert.equal(turnState(entries([...wrapUp, answer(min(3), 'Done')])), 'ended')
  assert.deepEqual(turnEnded(entries([...wrapUp, answer(min(3), 'Done')])), { at: min(3), how: 'answer' })
  // Without the closing answer the transcript cannot tell: the turn may go on, or have ended without a word.
  assert.equal(turnState(entries(wrapUp)), 'running')
  assert.deepEqual(turnEnded(entries(wrapUp)), { at: min(2), how: 'silent' })
  // A step still without its answer is a turn that runs.
  assert.equal(turnEnded(entries([typed(min(0), 'Go'), step(min(1), 'Run the tests')])), null)
  assert.equal(turnEnded(entries([typed(min(0), 'Go')])), null)
})

test('turnState: a turn the person interrupted has ended', () => {
  const interrupted = user(min(3), [{ type: 'text', text: '[Request interrupted by user]' }])
  assert.equal(turnState(entries([typed(min(0), 'Go'), step(min(1), 'Run the tests'), interrupted])), 'ended')
})

test('turnState: a turn that waits for an answer to its question is asking', () => {
  const question = assistant(min(1), 'tool_use', [tool('AskUserQuestion', { questions: [] })])
  assert.equal(turnState(entries([typed(min(0), 'Go'), question])), 'asking')
  assert.equal(turnState(entries([typed(min(0), 'Go'), question, toolResult(min(2))])), 'running')
})

test('turnState: nothing to go by is unknown', () => {
  assert.equal(turnState([]), 'unknown')
  assert.equal(turnState(entries(slashCommand(min(0), '/compact'))), 'unknown')
})

test('doingNow: what the last tool call says it is for, else what that kind of call is in plain words', () => {
  assert.equal(doingNow(entries([step(min(0), 'Install'), toolResult(min(1)), step(min(2), 'Run the tests')])), 'Run the tests')
  assert.equal(doingNow(entries([assistant(min(0), 'tool_use', [tool('Grep', { pattern: 'x' })])])), 'Searching the files')
  assert.equal(doingNow(entries([assistant(min(0), 'tool_use', [tool('Edit', { file_path: 'C:\\game\\src\\app.ts' })])])), 'Editing app.ts')
  assert.equal(doingNow(entries([typed(min(0), 'Go')])), null)
})

const MAIN = { mainTitle: 'Game - Main', mainSession: 'local_main' }
const handed = (minute, task) => fromChat(min(minute), 'Game - Main', `Task from Game - Main: ${task}`)
const reported = minute => assistant(min(minute), 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Finished.' })])

test('turnStart: the first thing typed since the last turn ended, not a remark made later in the turn', () => {
  const start = turnStart(entries([
    answer(min(0), 'Done'),
    ...slashCommand(min(1), '/reload-plugins'),
    typed(min(5), 'Make the lava glow more. It looks flat.'),
    step(min(6), 'Read the shader'),
    toolResult(min(7)),
    typed(min(9), 'How far are you?'),
  ]), { prefix: 'Game - ' })
  assert.deepEqual(start, { at: min(5), by: 'you', title: 'Make the lava glow more', words: 'Make the lava glow more. It looks flat.', isSure: true, isOpen: true })
})

test('turnStart: a turn another chat started names that chat, and a tail without the turn before is not sure', () => {
  const start = turnStart(entries([toolResult(min(0)), fromChat(min(4), 'Game - Units', 'The archer is merged.\nDetails.')]), { prefix: 'Game - ' })
  assert.deepEqual(start, { at: min(4), by: 'Units', title: 'The archer is merged', isSure: false, isOpen: true })
  assert.equal(turnStart(entries([step(min(0), 'Run the tests'), toolResult(min(1))]), { prefix: 'Game - ' }), null)
})

test('turnStart: a message that starts with a picture is named after its words', () => {
  const withPicture = words => user(min(1), [{ type: 'image', source: {} }, ...words.map(text => ({ type: 'text', text }))], { origin: { kind: 'human' } })
  assert.equal(turnStart(entries([withPicture(['Make it like this. Darker.'])]), { prefix: 'Game - ' }).title, 'Make it like this')
  assert.equal(turnStart(entries([withPicture([])]), { prefix: 'Game - ' }).title, 'A picture')
})

test('turnStart: after the turn ended, the opening is still known but no longer open', () => {
  assert.deepEqual(turnStart(entries([typed(min(0), 'Go'), answer(min(1), 'Done')]), { prefix: 'Game - ' }),
    { at: min(0), by: 'you', title: 'Go', words: 'Go', isSure: false, isOpen: false })
})

test('turnStart: what was typed after the person stopped a turn opens a new one', () => {
  const stopped = user(min(3), [{ type: 'text', text: '[Request interrupted by user]' }])
  const start = turnStart(entries([answer(min(0), 'Done'), typed(min(1), 'Do A.'), step(min(2), 'Start on A'), stopped, typed(min(4), 'Do B instead.'), step(min(5), 'Start on B')]), { prefix: 'Game - ' })
  assert.deepEqual([start.title, start.at, start.isOpen], ['Do B instead', min(4), true])
})

test('turnStart: a turn the chat\'s own work started goes on with what the turn before was about', () => {
  const notice = user(min(5), '<task-notification>a background task finished</task-notification>', { origin: { kind: 'task-notification' } })
  const handBack = user(min(5), 'A message:\n<agent-message from="a1">\nThe review found two things.\n</agent-message>', {
    isMeta: true,
    origin: { kind: 'peer', from: 'a1', senderTaskId: 'a1', name: 'general-purpose', body: 'report', handback: true },
  })
  for (const wake of [notice, handBack]) {
    const start = turnStart(entries([answer(min(0), 'Done'), typed(min(1), 'Build the board.'), answer(min(2), 'A helper reviews it.'), wake, step(min(6), 'Read the result')]), { prefix: 'Game - ' })
    assert.deepEqual(start, { at: min(1), by: 'you', title: 'Build the board', words: 'Build the board.', isSure: true, isOpen: true })
  }
  // Slash commands and the app's notes do not open anything.
  const idle = turnStart(entries([typed(min(1), 'Build the board.'), answer(min(2), 'Done'), ...slashCommand(min(3), '/git')]), { prefix: 'Game - ' })
  assert.equal(idle.isOpen, false)
  // B247: nor does a /compact a mod ran after the turn.
  const compacted = turnStart(entries([typed(min(1), 'Build the board.'), answer(min(2), 'Done'), ...modCompaction(min(3))]), { prefix: 'Game - ' })
  assert.equal(compacted.isOpen, false)
})

test('B247: unanswered: the oldest tool call of the running turn still without its answer, in plain words', () => {
  const call = (minute, id, name, input = {}) => assistant(min(minute), 'tool_use', [{ type: 'tool_use', id, name, input }])
  const result = (minute, id) => user(min(minute), [{ type: 'tool_result', tool_use_id: id, content: 'ok' }])
  // Two calls at once: the first got its answer, the second never did.
  const hung = [typed(min(0), 'Go'), call(1, 'a', 'Bash', { description: 'Add a launch entry' }), call(1, 'b', 'mcp__Claude_Browser__preview_start', { name: 'demo' }), result(2, 'a')]
  assert.deepEqual(unanswered(entries(hung)), { doing: 'Working in the browser', since: min(1) })
  assert.equal(unanswered(entries([...hung, result(30, 'b')])), null)
  // A turn that ended has nothing open, whatever an earlier turn left.
  assert.equal(unanswered(entries([...hung, answer(min(31), 'Stopped.')])), null)
  assert.equal(unanswered(entries([typed(min(0), 'Go'), answer(min(1), 'Done')])), null)
  // A helper's own calls are its own.
  const helper = line({ type: 'assistant', isSidechain: true, timestamp: new Date(min(3)).toISOString(), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c', name: 'Read', input: {} }] } })
  assert.equal(unanswered(entries([typed(min(0), 'Go'), helper])), null)
})

test('conversation: what was typed, the answers, and reports; tool calls and commands are left out', () => {
  const messages = conversation(entries([
    typed(min(0), 'Focus on the archer today.'),
    assistant(min(1), 'tool_use', [text('Let me look.')]),
    step(min(1), 'Read the backlog'),
    toolResult(min(2)),
    assistant(min(3), 'end_turn', [{ type: 'thinking', thinking: 'hidden' }]),
    answer(min(3), 'Handed to Units.'),
    ...slashCommand(min(4), '/reload-plugins'),
    fromChat(min(9), 'Game - Units', 'Archer finished and merged.'),
    answer(min(10), 'Units reports the archer is in.'),
  ]), { prefix: 'Game - ' })
  assert.deepEqual(messages, [
    { at: min(0), from: 'you', who: 'You', via: null, text: 'Focus on the archer today.' },
    { at: min(3), from: 'chat', who: 'Main', via: null, text: 'Handed to Units.' },
    { at: min(9), from: 'report', who: 'Units', via: null, text: 'Archer finished and merged.' },
    { at: min(10), from: 'chat', who: 'Main', via: null, text: 'Units reports the archer is in.' },
  ])
})

test('conversation: a line typed on the board is yours and says where it came from', () => {
  const viaBoard = user(min(1), 'Hello (typed on the worker board, 10:01)', { origin: { kind: 'plugin', name: 'folder-branches', asUser: true } })
  assert.deepEqual(conversation(entries([viaBoard]), { prefix: 'Game - ' }), [
    { at: min(1), from: 'you', who: 'You', via: 'board', text: 'Hello (typed on the worker board, 10:01)' },
  ])
})

test('conversation: a picture becomes a marker and the app\'s own notes are stripped', () => {
  const withPicture = user(min(1), [
    { type: 'image', source: { type: 'base64', data: 'AAAA' } },
    { type: 'text', text: 'Like this picture.' },
    { type: 'text', text: '<system-reminder>internal note</system-reminder>' },
  ], { origin: { kind: 'human' } })
  assert.equal(conversation(entries([withPicture]), { prefix: 'Game - ' })[0].text, '[picture]\nLike this picture.')
})

test('conversation: a report without a name is looked up by the sending chat, and helpers and notices are left out', () => {
  const unnamed = user(min(1), 'A message:\n<cross-session-message from="local_77">\nLevels done.\n</cross-session-message>', {
    isMeta: true,
    origin: { kind: 'peer', from: 'local_77', hostInjected: true },
  })
  const handBack = user(min(2), 'x', { isMeta: true, origin: { kind: 'peer', from: 'a1', senderTaskId: 'a1', handback: true, body: 'helper' } })
  const notice = user(min(3), '<task-notification>done</task-notification>', { origin: { kind: 'task-notification' } })
  const messages = conversation(entries([unnamed, handBack, notice]), { prefix: 'Game - ', titles: new Map([['local_77', 'Game - Levels']]) })
  assert.deepEqual(messages.map(m => [m.from, m.who, m.text]), [['report', 'Levels', 'Levels done.']])
})

test('conversation: only the last 30', () => {
  const many = []
  for (let i = 0; i < 40; i += 1) many.push(typed(min(i), `message ${i}`))
  const messages = conversation(entries(many), { prefix: 'Game - ' })
  assert.equal(messages.length, 30)
  assert.equal(messages[0].text, 'message 10')
})
