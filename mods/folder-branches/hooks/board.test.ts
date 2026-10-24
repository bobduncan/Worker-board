import { describe, expect, test } from 'claude-code/testing'

import { MOST_CHARS, WORK_ACTIONS, WORK_FIELDS, boardStarts, isPaused, parseBoard, parsePause, parseTaken, pauseContexts } from './board'

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

describe('B356: the partner files a result check with the work tool', () => {
  test('checked is an action of the tool, with evidence, points and score', () => {
    expect(WORK_ACTIONS.includes('checked')).toBe(true)
    for (const field of ['evidence', 'points', 'score']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })
})

describe('B354: a step\'s standard with the work tool', () => {
  test('standard is a field of the tool, sent to the board', () => {
    expect(WORK_FIELDS.includes('standard')).toBe(true)
  })
})

describe('B468: a step\'s effort with the work tool', () => {
  test('effort is a field of the tool, sent to the board', () => {
    expect(WORK_FIELDS.includes('effort')).toBe(true)
  })
})

describe('Model per step: a step\'s model with the work tool', () => {
  test('model is a field of the tool, sent to the board', () => {
    expect(WORK_FIELDS.includes('model')).toBe(true)
  })
})

describe('Partner answers: the partner answers a routed ask for the person, or hands it to them', () => {
  test('partner-answer and escalate are actions of the tool, at its end, with id, text and why', () => {
    expect(WORK_ACTIONS.slice(-2)).toEqual(['partner-answer', 'escalate'])
    for (const field of ['id', 'text', 'why']) expect(WORK_FIELDS.includes(field)).toBe(true)
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
  const STOP = 'The person pauses all chats: commit your work, write your checkpoint (work step B12 --commit <hash> --next "<next action>"; the same for B13), stop or wait for your background agents, then end your turn and start nothing new.'
  const FREE = 'The person pauses all chats: stop or wait for your background agents, then end your turn and start nothing new.'
  const HISTORY = ['2026-10-18 22:00 Units: taken → in progress', '2026-10-18 22:10 Units: step 2/4, the strip']

  test('a checkpoint is written with work step: commit and next go to the board', () => {
    for (const field of ['commit', 'next']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })

  test('parsePause takes the board\'s answer, and nothing that is not one', () => {
    expect(parsePause(answer('pausing', [{ id: 'B12', checkpoint: null }]))).toEqual({ state: 'pausing', since: at, holds: [{ id: 'B12', checkpoint: null, branch: null, history: [] }], mustStop: true, resumeList: [] })
    expect(parsePause(answer('running', [{ id: 'B12', checkpoint: null, branch: 'b12-strip', history: [...HISTORY, 7] }]))?.holds).toEqual([{ id: 'B12', checkpoint: null, branch: 'b12-strip', history: HISTORY }])
    expect(parsePause(answer('running'))?.state).toBe('running')
    for (const wrong of [null, 'x', [], { state: 'later' }, { text: 'no state' }]) expect(parsePause(wrong)).toBeNull()
    // A hold without an id, or a wake without a chat or a step, is left out.
    expect(parsePause(answer('resuming', [{ checkpoint: null }], [{ chat: 'Worker 1' }]))).toEqual({ state: 'resuming', since: at, holds: [], mustStop: false, resumeList: [] })
  })

  test('while pausing: the stop line names each step to checkpoint and the background agents, once per turn', () => {
    const holding = parsePause(answer('pausing', [{ id: 'B12', checkpoint: null }, { id: 'B13', checkpoint: point }]))
    const given = new Set<string>()
    expect(pauseContexts(holding, { role: 'worker', where: 'batch', given, turn: 1 })).toEqual([STOP])
    expect(pauseContexts(holding, { role: 'worker', where: 'batch', given, turn: 1 })).toEqual([])
    // The review of Pause 2: a new turn while the person still pauses is told again, at its first batch.
    expect(pauseContexts(holding, { role: 'worker', where: 'batch', given, turn: 2 })).toEqual([STOP])
    expect(pauseContexts(parsePause(answer('pausing')), { role: 'main', where: 'batch', given: new Set(), turn: 1 })).toEqual([FREE])
    // Not at a prompt or a start: the next tool batch says it; and never "go on" while pausing.
    expect(pauseContexts(holding, { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toEqual([])
    expect(pauseContexts(holding, { role: 'worker', where: 'start', given: new Set() })).toEqual([])
  })

  test('while resuming: the main chat gets whom to wake by app session id only; a holder its checkpoint; once each', () => {
    const wakes = [
      { chat: 'Worker 1', session: 'local_aaa', cliSession: 'cli-a', step: 'B12', checkpoint: point, branch: 'b12-strip', hasStarted: false },
      { chat: 'Worker 2', session: null, cliSession: 'cli-b', step: 'B14', checkpoint: null, branch: 'b14-shop', hasStarted: false },
      { chat: 'Worker 3', session: 'local_ccc', cliSession: 'cli-c', step: 'B15', checkpoint: point, branch: null, hasStarted: true },
      { chat: 'Worker 4', session: 'cli-d', cliSession: 'cli-d', step: 'B16', checkpoint: null, branch: null, hasStarted: false },
    ]
    const given = new Set<string>()
    const main = pauseContexts(parsePause(answer('resuming', [], wakes)), { role: 'main', where: 'start', given })
    expect(main).toEqual([[
      "Resume: wake each chat below that has not started, by its session id with SendMessage, one line each: 'resume your step B<id> from your checkpoint'",
      "- Worker 1, session local_aaa: 'resume your step B12 from your checkpoint' (checkpoint 1a2b3c4 · write the tests)",
      "- Worker 2, session not known (start it from the board): 'resume your step B14 from your checkpoint' (no checkpoint: it goes on from its branch b14-shop and History)",
      "- Worker 4, session not known (start it from the board): 'resume your step B16 from your checkpoint' (no checkpoint: it goes on from its History)",
    ].join('\n')])
    expect(pauseContexts(parsePause(answer('resuming', [], wakes)), { role: 'main', where: 'prompt', given })).toEqual([])
    // Everyone has started: nothing to wake.
    expect(pauseContexts(parsePause(answer('resuming', [], [wakes[2]])), { role: 'main', where: 'prompt', given: new Set() })).toEqual([])
    // A worker is not the main chat: no list for it.
    const holds = [{ id: 'B12', checkpoint: point }, { id: 'B16', checkpoint: null, branch: 'b16-sound', history: HISTORY }]
    const worker = new Set<string>()
    expect(pauseContexts(parsePause(answer('resuming', holds, wakes)), { role: 'worker', where: 'prompt', given: worker })).toEqual([
      'You hold B12: checkpoint 1a2b3c4 · write the tests; go on from there. You hold B16: no checkpoint since the pause; go on from its branch b16-sound and its History: 2026-10-18 22:00 Units: taken → in progress / 2026-10-18 22:10 Units: step 2/4, the strip.',
    ])
    expect(pauseContexts(parsePause(answer('resuming', holds)), { role: 'worker', where: 'prompt', given: worker })).toEqual([])
    // A checkpoint from before the pause is no checkpoint of it: the branch and History go first.
    const old = [{ id: 'B12', checkpoint: { ...point, isSincePause: false }, branch: 'b12-strip', history: [] }]
    expect(pauseContexts(parsePause(answer('resuming', old)), { role: 'worker', where: 'prompt', given: new Set() })).toEqual(['You hold B12: no checkpoint since the pause; go on from its branch b12-strip.'])
  })

  test('at a session start (or a process\'s first prompt) a chat that holds a step is told its checkpoint, once', () => {
    const holds = [{ id: 'B12', checkpoint: { ...point, isSincePause: false } }]
    const given = new Set<string>()
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'start', given })).toEqual(['You hold B12: checkpoint 1a2b3c4 · write the tests; go on from there.'])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given, isFirst: true })).toEqual([])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toHaveLength(1)
    expect(pauseContexts(parsePause(answer('running', [{ id: 'B12', checkpoint: null }])), { role: 'worker', where: 'start', given: new Set() })).toEqual(['You hold B12: no checkpoint; go on from its record (work next).'])
    // A later prompt, a tool batch, or a chat that holds nothing: nothing.
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given: new Set() })).toEqual([])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'batch', given: new Set() })).toEqual([])
    expect(pauseContexts(parsePause(answer('running')), { role: 'worker', where: 'start', given: new Set() })).toEqual([])
    expect(pauseContexts(null, { role: 'worker', where: 'start', given: new Set() })).toEqual([])
  })

  test('isPaused: pausing and resuming hold what starts a turn; running and no reading do not', () => {
    expect(isPaused(parsePause(answer('pausing')))).toBe(true)
    expect(isPaused(parsePause(answer('resuming')))).toBe(true)
    expect(isPaused(parsePause(answer('running')))).toBe(false)
    expect(isPaused(null)).toBe(false)
  })
})
