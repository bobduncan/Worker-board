import { describe, expect, test } from 'claude-code/testing'

import { MOST_CHARS, WORK_ACTIONS, WORK_FIELDS, boardStarts, parseBoard, parsePause, parseTaken, pauseContexts } from './board'

const KEY = 'ab'.repeat(32)

describe('the boards the mod keeps running', () => {
  const launch = JSON.stringify({ configurations: [
    { name: 'worker-board', runtimeExecutable: 'node', runtimeArgs: ['C:/p/worker-board/server.mjs'], port: 4310, url: 'http://127.0.0.1:4310' },
    { name: 'game', runtimeExecutable: 'node', runtimeArgs: ['vite.js'], port: 5173 },
    { name: 'no-port', runtimeExecutable: 'node', runtimeArgs: [] },
    { name: 'no-command', port: 4400 },
  ] })

  test('only the launch entries the list names under "boards" are started, each where its port says', () => {
    expect(boardStarts('{"prefix":"Game - ","main":"Main","boards":["worker-board","no-port","no-command","missing"]}', launch)).toEqual([
      { name: 'worker-board', argv: ['node', 'C:/p/worker-board/server.mjs'], url: 'http://127.0.0.1:4310/' },
    ])
    expect(boardStarts('{"prefix":"Game - ","main":"Main"}', launch)).toEqual([])
    expect(boardStarts('{"boards":"worker-board"}', launch)).toEqual([])
    expect(boardStarts('{"boards":["worker-board"]}', 'not json')).toEqual([])
  })
})

describe('the worker board, as the mod reads it', () => {
  test('the board is asked only on this machine, and only with a key', () => {
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310', key: KEY, startedAt: 5 }))).toEqual({ url: 'http://127.0.0.1:4310', key: KEY })
    expect(parseBoard(JSON.stringify({ url: 'http://example.com:4310', key: KEY }))).toBeNull()
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310/elsewhere', key: KEY }))).toBeNull()
    expect(parseBoard(JSON.stringify({ url: 'https://127.0.0.1:4310', key: KEY }))).toBeNull()
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310@evil.example', key: KEY }))).toBeNull()
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310', key: 'short' }))).toBeNull()
    expect(parseBoard('not json')).toBeNull()
    expect(parseBoard('[]')).toBeNull()
  })

  test('what the board hands out is typed only when it is text of a sane length', () => {
    const answer = JSON.stringify({ messages: [
      { id: 'm1', text: ' Sheet B ' },
      { id: 'm2', text: 'x'.repeat(MOST_CHARS + 1) },
      { id: 'm3', text: '' },
      { id: '', text: 'no id' },
      { id: 'm4', text: 7 },
      'stray',
    ] })
    // What cannot be typed is named, so the board can say it did not arrive.
    expect(parseTaken(answer)).toEqual({ messages: [{ id: 'm1', text: 'Sheet B' }], refused: ['m2', 'm3', 'm4'] })
    expect(parseTaken('{"messages":"x"}')).toEqual({ messages: [], refused: [] })
    expect(parseTaken('')).toEqual({ messages: [], refused: [] })
  })
})

describe('Focus 2: the partner keeps its drafts of the focus with the work tool', () => {
  test('vibe-draft and how-draft are actions of the tool, with the fields they need', () => {
    expect(WORK_ACTIONS.includes('vibe-draft')).toBe(true)
    expect(WORK_ACTIONS.includes('how-draft')).toBe(true)
    for (const field of ['goal', 'lines', 'picture', 'parts', 'partnerDecides', 'youDecide']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })
})

describe('Focus 3: the daily note of the partner on the focus', () => {
  test('a note carries what it decided and the asks that need the person', () => {
    for (const field of ['decided', 'needs']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })
})

describe('Fix first: a step marked as a board fix with the work tool', () => {
  test('priority is a field of the tool, sent to the board', () => {
    expect(WORK_FIELDS.includes('priority')).toBe(true)
  })
})

describe("B313: the main chat moves a renamed chat's work with the work tool", () => {
  test('rename is an action of the tool, with from and to', () => {
    expect(WORK_ACTIONS.includes('rename')).toBe(true)
    for (const field of ['from', 'to']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })
})

describe('Pause 2: the pause state as the mod reads it, and the contexts it gives', () => {
  const at = Date.UTC(2026, 9, 18, 20, 30)
  const point = { commit: '1a2b3c4', next: 'write the tests', at, line: '1a2b3c4 · write the tests · 2026-10-18 22:30:00', isSincePause: true }
  const answer = (state: string, holds: unknown[] = [], resumeList: unknown[] = []) => ({ text: 'x', state, since: at, forChat: { holds, mustStop: state === 'pausing' }, resumeList })

  test('a checkpoint is written with work step: commit and next go to the board', () => {
    for (const field of ['commit', 'next']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })

  test('parsePause takes the board\'s answer, and nothing that is not one', () => {
    expect(parsePause(answer('pausing', [{ id: 'B12', checkpoint: null }]))).toEqual({ state: 'pausing', since: at, holds: [{ id: 'B12', checkpoint: null }], mustStop: true, resumeList: [] })
    expect(parsePause(answer('running'))?.state).toBe('running')
    for (const wrong of [null, 'x', [], { state: 'later' }, { text: 'no state' }]) expect(parsePause(wrong)).toBeNull()
    // A hold without an id, or a wake without a chat or a step, is left out.
    expect(parsePause(answer('resuming', [{ checkpoint: null }], [{ chat: 'Worker 1' }]))).toEqual({ state: 'resuming', since: at, holds: [], mustStop: false, resumeList: [] })
  })

  test('while pausing: the stop line names each step to checkpoint, or only says to end the turn; once per pause', () => {
    const holding = parsePause(answer('pausing', [{ id: 'B12', checkpoint: null }, { id: 'B13', checkpoint: point }]))
    const given = new Set<string>()
    const first = pauseContexts(holding, { role: 'worker', where: 'batch', given })
    expect(first).toEqual(['The person pauses all chats: commit your work, write your checkpoint (work step B12 --commit <hash> --next "<next action>"; the same for B13), then end your turn and start nothing new.'])
    expect(pauseContexts(holding, { role: 'worker', where: 'batch', given })).toEqual([])
    const free = parsePause(answer('pausing'))
    expect(pauseContexts(free, { role: 'main', where: 'batch', given: new Set() })).toEqual(['The person pauses all chats: end your turn and start nothing new.'])
    // Not at a prompt or a start: the next tool batch says it; and never "go on" while pausing.
    expect(pauseContexts(holding, { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toEqual([])
    expect(pauseContexts(holding, { role: 'worker', where: 'start', given: new Set() })).toEqual([])
  })

  test('while resuming: the main chat gets whom to wake, by session id; a holder its checkpoint; once each', () => {
    const wakes = [
      { chat: 'Worker 1', session: 'local_aaa', cliSession: 'cli-a', step: 'B12', checkpoint: point, hasStarted: false },
      { chat: 'Worker 2', session: null, cliSession: 'cli-b', step: 'B14', checkpoint: null, hasStarted: false },
      { chat: 'Worker 3', session: 'local_ccc', cliSession: 'cli-c', step: 'B15', checkpoint: point, hasStarted: true },
    ]
    const given = new Set<string>()
    const main = pauseContexts(parsePause(answer('resuming', [], wakes)), { role: 'main', where: 'start', given })
    expect(main).toEqual([[
      "Resume: wake each chat below that has not started, by its session id with SendMessage, one line each: 'resume your step B<id> from your checkpoint'",
      "- Worker 1, session local_aaa: 'resume your step B12 from your checkpoint' (checkpoint 1a2b3c4 · write the tests)",
      "- Worker 2, session cli-b: 'resume your step B14 from your checkpoint' (no checkpoint)",
    ].join('\n')])
    expect(pauseContexts(parsePause(answer('resuming', [], wakes)), { role: 'main', where: 'prompt', given })).toEqual([])
    // Everyone has started: nothing to wake.
    expect(pauseContexts(parsePause(answer('resuming', [], [wakes[2]])), { role: 'main', where: 'prompt', given: new Set() })).toEqual([])
    // A worker is not the main chat: no list for it.
    const holds = [{ id: 'B12', checkpoint: point }, { id: 'B16', checkpoint: null }]
    const worker = new Set<string>()
    expect(pauseContexts(parsePause(answer('resuming', holds, wakes)), { role: 'worker', where: 'prompt', given: worker })).toEqual([
      'You hold B12: checkpoint 1a2b3c4 · write the tests; go on from there. You hold B16: no checkpoint; run work next and go on from its record.',
    ])
    expect(pauseContexts(parsePause(answer('resuming', holds)), { role: 'worker', where: 'prompt', given: worker })).toEqual([])
  })

  test('at a session start (or a process\'s first prompt) a chat that holds a step is told its checkpoint, once', () => {
    const holds = [{ id: 'B12', checkpoint: point }]
    const given = new Set<string>()
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'start', given })).toEqual(['You hold B12: checkpoint 1a2b3c4 · write the tests; go on from there.'])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given, isFirst: true })).toEqual([])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toHaveLength(1)
    // A later prompt, a tool batch, or a chat that holds nothing: nothing.
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given: new Set() })).toEqual([])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'batch', given: new Set() })).toEqual([])
    expect(pauseContexts(parsePause(answer('running')), { role: 'worker', where: 'start', given: new Set() })).toEqual([])
    expect(pauseContexts(null, { role: 'worker', where: 'start', given: new Set() })).toEqual([])
  })
})
