import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, fromChat, line, slashCommand, step, text, tool, toolResult, typed, user } from '../fixtures/lines.mjs'
import { conversation, doingNow, lastFinish, markedIn, parseTail, taskStart, turnStart, turnState } from '../src/transcript.mjs'

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

test('doingNow: the description of the last tool call, else its name', () => {
  assert.equal(doingNow(entries([step(min(0), 'Install'), toolResult(min(1)), step(min(2), 'Run the tests')])), 'Run the tests')
  assert.equal(doingNow(entries([assistant(min(0), 'tool_use', [tool('Grep', { pattern: 'x' })])])), 'Grep')
  assert.equal(doingNow(entries([assistant(min(0), 'tool_use', [tool('Edit', { file_path: 'C:\\game\\src\\app.ts' })])])), 'Edit app.ts')
  assert.equal(doingNow(entries([typed(min(0), 'Go')])), null)
})

const MAIN = { mainTitle: 'Game - Main', mainSession: 'local_main' }
const handed = (minute, task) => fromChat(min(minute), 'Game - Main', `Task from Game - Main: ${task}`)
const reported = minute => assistant(min(minute), 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Finished.' })])

test('taskStart: a task handed over by the main chat gives the start, the sender and a title', () => {
  const start = taskStart(entries([
    answer(min(0), 'Done'),
    fromChat(min(4), 'Game - Main', 'Task from Game - Main: build the archer at 4x. Time box: 45 minutes.\n\nBackground: ...'),
    step(min(5), 'Read the brief'),
  ]), MAIN)
  assert.deepEqual(start, { at: min(4), from: 'Game - Main', title: 'Build the archer at 4x', steps: [] })
  for (const opening of ['Next task from the main chat: build the archer at 4x.', 'Two tasks from the main chat: build the archer at 4x. Then the knight.']) {
    assert.equal(taskStart(entries([fromChat(min(4), 'Game - Main', opening)]), MAIN).title, 'Build the archer at 4x')
  }
})

test('taskStart: reads the tag when the entry carries no plain text of the message, and knows the main chat by its id', () => {
  const tagged = from => user(min(2), `Another session sent a message:\n<cross-session-message from="${from}">\nTask from the main chat: fix the bridge level\nMore words.\n</cross-session-message>`, {
    isMeta: true,
    origin: { kind: 'peer', from, hostInjected: true },
  })
  assert.deepEqual(taskStart(entries([tagged('local_main')]), MAIN), { at: min(2), from: 'local_main', title: 'Fix the bridge level', steps: [] })
  assert.equal(taskStart(entries([tagged('local_units')]), MAIN), null)
})

test('taskStart: a note from the main chat, or a message from another worker, starts no task and ends none', () => {
  const thanks = fromChat(min(20), 'Game - Main', 'From the main chat, for your information: main moved to e1e61d9.')
  const worker = fromChat(min(21), 'Game - Units', 'Task idea: could you look at the archer?')
  assert.equal(taskStart(entries([thanks, worker]), MAIN), null)
  assert.equal(taskStart(entries([handed(4, 'build the archer.'), step(min(5), 'Read'), thanks, worker]), MAIN).title, 'Build the archer')
})

test('taskStart: the report of a helper the chat started itself is not a task', () => {
  const handBack = user(min(2), 'A message:\n<agent-message from="a1b2">\n[Subagent hand-back] ...\n</agent-message>', {
    isMeta: true,
    origin: { kind: 'peer', from: 'a1b2', senderTaskId: 'a1b2', name: 'general-purpose', body: 'report', handback: true },
  })
  assert.equal(taskStart(entries([handBack]), MAIN), null)
})

test('taskStart: a report to the main chat ends the task once the turn has ended after it', () => {
  const done = [handed(4, 'build the archer'), reported(9), toolResult(min(10)), answer(min(11), 'Reported.')]
  assert.equal(taskStart(entries(done), MAIN), null)
  assert.equal(lastFinish(entries(done), MAIN), min(9))
  assert.equal(taskStart(entries([reported(2), answer(min(3), 'Reported.'), handed(4, 'build the archer')]), MAIN).title, 'Build the archer')
})

test('taskStart: a question sent to the main chat in the middle of the work does not end the task', () => {
  const asking = [handed(4, 'build the archer'), reported(9), toolResult(min(10)), step(min(11), 'Go on with the sheet')]
  assert.equal(taskStart(entries(asking), MAIN).title, 'Build the archer')
  assert.equal(lastFinish(entries(asking), MAIN), null)
  // Stopped by the person after the message: the turn has ended, so that counts as the report.
  const stopped = user(min(12), [{ type: 'text', text: '[Request interrupted by user]' }])
  assert.equal(taskStart(entries([...asking, stopped]), MAIN), null)
})

test('taskStart: no hand-over in the tail is null', () => {
  assert.equal(taskStart(entries([typed(min(0), 'Go'), answer(min(1), 'Done')]), MAIN), null)
  assert.equal(lastFinish(entries([typed(min(0), 'Go'), answer(min(1), 'Done')]), MAIN), null)
})

test('turnStart: the first thing typed since the last turn ended, not a remark made later in the turn', () => {
  const start = turnStart(entries([
    answer(min(0), 'Done'),
    ...slashCommand(min(1), '/reload-plugins'),
    typed(min(5), 'Make the lava glow more. It looks flat.'),
    step(min(6), 'Read the shader'),
    toolResult(min(7)),
    typed(min(9), 'How far are you?'),
  ]), { prefix: 'Game - ' })
  assert.deepEqual(start, { at: min(5), by: 'you', title: 'Make the lava glow more', isSure: true, isOpen: true })
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
    { at: min(0), by: 'you', title: 'Go', isSure: false, isOpen: false })
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
    assert.deepEqual(start, { at: min(1), by: 'you', title: 'Build the board', isSure: true, isOpen: true })
  }
  // Slash commands and the app's notes do not open anything.
  const idle = turnStart(entries([typed(min(1), 'Build the board.'), answer(min(2), 'Done'), ...slashCommand(min(3), '/git')]), { prefix: 'Game - ' })
  assert.equal(idle.isOpen, false)
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
