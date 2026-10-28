import { describe, expect, test } from 'claude-code/testing'

import { MOD_VERSION, MOST_CHARS, WHOAMI_PATH, WORK_ACTIONS, WORK_FIELDS, boardStarts, isPaused, parseBoard, parsePause, parseTaken, parseWhoami, pauseContexts, typedWhy } from './board'

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
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310', key: KEY, startedAt: 5 }))).toEqual({ url: 'http://127.0.0.1:4310', key: KEY, hands: false })
    // B753: a board that hands out jobs says so in its note.
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310', key: KEY, startedAt: 5, hands: true }))?.hands).toBe(true)
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
    // B532: with why, so the board does not try it again and names the reason.
    expect(parseTaken(answer)).toEqual({ messages: [{ id: 'm1', text: 'Sheet B' }], refused: ['m2', 'm3', 'm4'],
      why: { m2: `too long: ${MOST_CHARS + 1} > ${MOST_CHARS} characters`, m3: 'no text', m4: 'no text' }, clear: null, off: [] })
    expect(parseTaken('{"messages":"x"}')).toEqual({ messages: [], refused: [], why: {}, clear: null, off: [] })
    expect(parseTaken('')).toEqual({ messages: [], refused: [], why: {}, clear: null, off: [] })
    // B738: the chats the board shows as not running; anything that is no name is left out.
    expect(parseTaken('{"messages":[],"off":["Worker 5",3,""]}').off).toEqual(['Worker 5'])
    expect(parseTaken('{"messages":[],"off":"x"}').off).toEqual([])
    // B547: the clear the board names for a worker that owes one; a step id that is no id is left out, no time is no clear.
    expect(parseTaken('{"messages":[],"clear":{"step":"B12","reportedAt":5}}').clear).toEqual({ step: 'B12', reportedAt: 5 })
    expect(parseTaken('{"messages":[],"clear":{"step":"../x","reportedAt":5}}').clear).toEqual({ step: null, reportedAt: 5 })
    expect(parseTaken('{"messages":[],"clear":{"step":"B12"}}').clear).toBeNull()
    // B532: why a word the chat did not take failed, in one short line.
    expect(typedWhy(new Error('engine  busy\nnow'), 'the chat did not take it')).toBe('the chat did not take it: engine busy now')
    expect(typedWhy('no prompt is taken now', 'a hook dropped it')).toBe('a hook dropped it: no prompt is taken now')
    expect(typedWhy(undefined, 'a hook dropped it')).toBe('a hook dropped it')
    expect(typedWhy('x'.repeat(400), 'f').length).toBe(203)
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
  test('partner-answer and escalate are actions of the tool, after rename, with id, text and why', () => {
    const at = WORK_ACTIONS.indexOf('rename')
    expect(WORK_ACTIONS.slice(at + 1, at + 3)).toEqual(['partner-answer', 'escalate'])
    for (const field of ['id', 'text', 'why']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })
})

describe('the supervisor: its chat reads the health summary and files incidents with the work tool', () => {
  test('health and incident are actions of the tool, with the title, subject, evidence, rule and key of an incident', () => {
    expect(WORK_ACTIONS.includes('health')).toBe(true)
    expect(WORK_ACTIONS.includes('incident')).toBe(true)
    for (const field of ['title', 'subject', 'evidence', 'rule', 'key']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })

  test('incident-fix is an action of the tool, with the incident\'s id and the step that fixes it', () => {
    expect(WORK_ACTIONS.includes('incident-fix')).toBe(true)
    for (const field of ['id', 'fix']) expect(WORK_FIELDS.includes(field)).toBe(true)
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
    // Not at a prompt: the next tool call says it; and never "go on" while pausing.
    expect(pauseContexts(holding, { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toEqual([])
  })

  test('while resuming: the main chat gets whom to wake by app session id only; a holder its checkpoint; once each', () => {
    const wakes = [
      { chat: 'Worker 1', session: 'local_aaa', cliSession: 'cli-a', step: 'B12', checkpoint: point, branch: 'b12-strip', hasStarted: false },
      { chat: 'Worker 2', session: null, cliSession: 'cli-b', step: 'B14', checkpoint: null, branch: 'b14-shop', hasStarted: false },
      { chat: 'Worker 3', session: 'local_ccc', cliSession: 'cli-c', step: 'B15', checkpoint: point, branch: null, hasStarted: true },
      { chat: 'Worker 4', session: 'cli-d', cliSession: 'cli-d', step: 'B16', checkpoint: null, branch: null, hasStarted: false },
    ]
    const given = new Set<string>()
    const main = pauseContexts(parsePause(answer('resuming', [], wakes)), { role: 'main', where: 'prompt', given })
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

  test('at a process\'s first prompt a chat that holds a step is told its checkpoint, once', () => {
    const holds = [{ id: 'B12', checkpoint: { ...point, isSincePause: false } }]
    const given = new Set<string>()
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given, isFirst: true })).toEqual(['You hold B12: checkpoint 1a2b3c4 · write the tests; go on from there.'])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given, isFirst: true })).toEqual([])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toHaveLength(1)
    expect(pauseContexts(parsePause(answer('running', [{ id: 'B12', checkpoint: null }])), { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toEqual(['You hold B12: no checkpoint; go on from its record (work next).'])
    // A later prompt, a tool batch, or a chat that holds nothing: nothing.
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'prompt', given: new Set() })).toEqual([])
    expect(pauseContexts(parsePause(answer('running', holds)), { role: 'worker', where: 'batch', given: new Set() })).toEqual([])
    expect(pauseContexts(parsePause(answer('running')), { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toEqual([])
    expect(pauseContexts(null, { role: 'worker', where: 'prompt', given: new Set(), isFirst: true })).toEqual([])
  })

  test('isPaused: pausing and resuming hold what starts a turn; running and no reading do not', () => {
    expect(isPaused(parsePause(answer('pausing')))).toBe(true)
    expect(isPaused(parsePause(answer('resuming')))).toBe(true)
    expect(isPaused(parsePause(answer('running')))).toBe(false)
    expect(isPaused(null)).toBe(false)
  })
})

describe('2026-10-28: the board names this chat by its session id', () => {
  test('the route, and the version the plugin states', () => {
    expect(WHOAMI_PATH).toBe('/api/bridge/whoami')
    expect(MOD_VERSION).toBe('0.25.3')
  })

  test('the answer: a name, the role the board gives it and the session its card is filed under', () => {
    expect(parseWhoami('{"name":"Worker 5","role":"worker","card":"53d8e277-aaaa-4bbb-8ccc-0123456789ab"}')).toEqual({ name: 'Worker 5', role: 'worker', card: '53d8e277-aaaa-4bbb-8ccc-0123456789ab' })
    expect(parseWhoami('{"name":" Main ","role":"main","card":null}')).toEqual({ name: 'Main', role: 'main', card: null })
    for (const role of ['main', 'worker', 'advisor', 'helper', 'supervisor']) expect(parseWhoami(JSON.stringify({ name: 'A', role, card: null }))?.role).toBe(role)
    // An older board says no role and no card: the name still counts.
    expect(parseWhoami('{"name":"Units"}')).toEqual({ name: 'Units', role: null, card: null })
    // A role the board does not know, and a card that is no session id, are left out.
    expect(parseWhoami('{"name":"Units","role":"boss","card":"../etc/passwd"}')).toEqual({ name: 'Units', role: null, card: null })
    expect(parseWhoami(JSON.stringify({ name: 'Units', card: 'x'.repeat(121) }))?.card).toBeNull()
  })

  test('no name, no chat: a session of no chat, a name that is empty, no text or too long, and what is no JSON', () => {
    expect(parseWhoami('{"name":null,"role":null,"card":null}')).toBeNull()
    expect(parseWhoami('{"name":"   "}')).toBeNull()
    expect(parseWhoami('{"name":7}')).toBeNull()
    expect(parseWhoami(JSON.stringify({ name: 'N'.repeat(81) }))).toBeNull()
    expect(parseWhoami(JSON.stringify({ name: 'N'.repeat(80) }))?.name).toBe('N'.repeat(80))
    for (const text of ['', 'Not here.', '[]', 'null', '"Units"', '<html>']) expect(parseWhoami(text)).toBeNull()
  })
})
