import { describe, expect, test } from 'claude-code/testing'

import { MOD_VERSION, MOST_CHARS, NO_OUTCOME, NO_TURN_WORDS, WHOAMI_PATH, WORK_ACTIONS, WORK_FIELDS, BOARD_LAUNCHER, backgroundStartOf, boardLogOf, boardLook, clearTicket, launchArgv, monitorEndsAt, parsePendingClear, boardStarts, isPaused, parseBoard, parseEnvelope, parseHandover, parseHeld, parsePause, parseTaken, parseWhoami, pauseContexts, reportBody, stopLine, turnBegan, typedWhy, wordSettled, wordTyping, wordsCleared } from './board'
import type { TurnReport, TurnWords } from './board'

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

describe('8c (0.30.0): every report says the word its turn runs on and the turn\'s own start', () => {
  const BUSY: TurnReport = { state: 'busy', since: 1000, background: false }
  /** The report's word and turn after these steps, as the board reads them. */
  const said = (words: TurnWords): { word: string | null; turn: number | null } => ({ word: words.word, turn: words.turn })

  test('idle -> busy with a word of ours: the word and the turn are set; asking -> busy keeps both; busy -> idle keeps both', () => {
    let words = wordTyping(NO_TURN_WORDS, 'w1', 'B13: approved')
    words = wordSettled(words, 'w1', true)
    words = turnBegan(words, 'B13: approved', 1000)
    expect(said(words)).toEqual({ word: 'w1', turn: 1000 })
    // An ask that opens and closes is no turn start (the mod does not call turnBegan): the state's since moves, the turn not.
    const asked = reportBody({ ...BUSY, since: 4000 }, words, 7, 3)
    expect(asked).toEqual({ state: 'busy', since: 4000, background: false, run: 7, seq: 3, word: 'w1', turn: 1000 })
    expect(reportBody({ state: 'idle', since: 9000, background: false }, words, 7, 4)).toMatchObject({ word: 'w1', turn: 1000 })
  })

  test('a new turn with no word of ours (a line the person typed, a hand\'s message): word null, the turn its own', () => {
    let words = turnBegan(wordSettled(wordTyping(NO_TURN_WORDS, 'w1', 'yes'), 'w1', true), 'yes', 1000)
    words = turnBegan(words, 'what about the lava?', 5000)
    expect(said(words)).toEqual({ word: null, turn: 5000 })
  })

  test('two words of one take run one per turn, in outbox order, whatever order their submits resolve in', () => {
    let words = wordTyping(wordTyping(NO_TURN_WORDS, 'w1', 'first'), 'w2', 'second')
    words = wordSettled(words, 'w2', true)
    // The app may start a turn before the submit's promise resolved: the text decides.
    words = turnBegan(words, 'first', 1000)
    expect(said(words)).toEqual({ word: 'w1', turn: 1000 })
    words = turnBegan(words, 'second', 2000)
    expect(said(words)).toEqual({ word: 'w2', turn: 2000 })
    expect(words.typed).toEqual([])
    // A word typed while the person's own line waits: the person's turn is not the word's.
    words = wordTyping(words, 'w3', 'third')
    words = turnBegan(words, 'my own line', 3000)
    expect(said(words)).toEqual({ word: null, turn: 3000 })
    words = turnBegan(wordSettled(words, 'w3', true), 'third', 4000)
    expect(said(words)).toEqual({ word: 'w3', turn: 4000 })
  })

  test('a turn whose text is none of ours is no word\'s, also with one of ours entered (no guess); a dropped word never runs', () => {
    let words = wordSettled(wordTyping(NO_TURN_WORDS, 'w1', 'go'), 'w1', true)
    // Mutant "the queue's head": a task notification's turn would be given w1.
    words = turnBegan(words, '<task-notification>done</task-notification>', 1000)
    expect(said(words)).toEqual({ word: null, turn: 1000 })
    words = turnBegan(words, 'go', 1500)
    expect(words.word).toBe('w1')
    expect(turnBegan(words, undefined as never, 1600).word).toBeNull()
    words = wordSettled(wordTyping(words, 'w2', 'more'), 'w2', false)
    words = turnBegan(words, 'more', 2000)
    expect(said(words)).toEqual({ word: null, turn: 2000 })
  })

  test('a /clear empties the queue: the word is null, the new conversation\'s first turn is no word\'s', () => {
    let words = turnBegan(wordTyping(NO_TURN_WORDS, 'w1', 'go'), 'go', 1000)
    words = wordTyping(words, 'w2', 'next')
    words = wordsCleared(words)
    expect(words).toEqual({ typed: [], word: null, turn: 1000 })
    expect(turnBegan(words, 'next', 2000).word).toBeNull()
  })
})

describe('F (0.30.0): the background work a call of the chat\'s own started, by the result\'s own id', () => {
  test('a background command, one the app moved there itself, and a Monitor count; a plain command does not', () => {
    expect(backgroundStartOf('Bash', { run_in_background: true }, { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bx1' } })).toBe('bx1')
    expect(backgroundStartOf('PowerShell', {}, { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'px2', timedOutAfterMs: 120000 } })).toBe('px2')
    expect(backgroundStartOf('Monitor', { description: 'gate' } as never, { result: { taskId: 'mon3', timeoutMs: 0, persistent: true } })).toBe('mon3')
    expect(backgroundStartOf('Bash', { run_in_background: true }, { result: { stdout: 'Command running in background with ID: b4zduzypn. Output is being written to: x' } })).toBe('b4zduzypn')
    expect(backgroundStartOf('Bash', {}, { result: { stdout: 'ok', stderr: '', interrupted: false } })).toBeNull()
    expect(backgroundStartOf('Bash', {}, { result: { stdout: 'Command running in background with ID: b4zduzypn' } })).toBeNull()
    expect(backgroundStartOf('Read', { run_in_background: true }, { result: { backgroundTaskId: 'r1' } })).toBeNull()
  })

  test('the review: a Monitor ends by its deadline (capped at 30 min); a persistent one has none', () => {
    expect(monitorEndsAt({ result: { taskId: 'm1', timeoutMs: 300000 } }, 1000)).toBe(301000)
    expect(monitorEndsAt({ result: { taskId: 'm1', timeoutMs: 9_000_000 } }, 0)).toBe(1_800_000)
    expect(monitorEndsAt({ result: { taskId: 'm1', timeoutMs: 0 } }, 0)).toBeNull()
    expect(monitorEndsAt({ result: { taskId: 'm1', timeoutMs: 300000, persistent: true } }, 0)).toBeNull()
    expect(monitorEndsAt({ result: { stdout: '' } }, 0)).toBeNull()
  })
})

describe('B944 (0.30.0): the clear on its way, kept in the mod\'s store', () => {
  test('its key is unique across the chat\'s processes', () => {
    expect(clearTicket(1730000000000.4, 3)).toBe('clear-1730000000000-3')
  })

  test('the pending clear the store keeps, read safely', () => {
    const env = { id: 'e1', kind: 'task', step: 'B13', clear: null, restart: false, set: null, line: 'go', version: null }
    expect(parsePendingClear({ ticket: 'clear-7-2', from: 'units', step: 'B12', at: 5, envelope: env, outcome: { typed: null } })).toEqual({ ticket: 'clear-7-2', from: 'units', step: 'B12', at: 5, envelope: parseEnvelope(env), outcome: { ...NO_OUTCOME } })
    expect(parsePendingClear({ ticket: 'clear-7-2', from: 'units', step: '../x', at: 5, envelope: null, outcome: null })).toEqual({ ticket: 'clear-7-2', from: 'units', step: null, at: 5, envelope: null, outcome: null })
    expect(parsePendingClear({ ticket: '7', from: 'units', at: 5 })).toBeNull()
    expect(parsePendingClear(null)).toBeNull()
  })
})

describe('5c (0.30.0): a kept board starts through a launcher, detached, its output to its log', () => {
  test('the launcher runs on the node of the board, names the log beside its script, then the command of the board', () => {
    const board = { name: 'worker-board', argv: ['D:/Tools/node/node.exe', 'D:/Work/project/worker-board/server.mjs'], url: 'http://127.0.0.1:4310/' }
    const argv = launchArgv(board, 'D:/Work/project')
    expect(argv.slice(0, 2)).toEqual(['D:/Tools/node/node.exe', '-e'])
    expect(argv.slice(3)).toEqual(['D:/Work/project/worker-board/data/board.log', 'D:/Work/project', 'D:/Tools/node/node.exe', 'D:/Work/project/worker-board/server.mjs'])
    expect(argv[2]).toContain("detached: true, stdio: ['ignore', out, out]")
    expect(argv[2]).toContain('unref()')
    expect(launchArgv({ ...board, argv: ['deno', 'run', 'x.ts'] }, 'D:/Work/project').slice(0, 5)).toEqual(['node', '-e', BOARD_LAUNCHER, '', 'D:/Work/project'])
    expect(boardLogOf(['node', 'server.mjs'])).toBeNull()
    expect(boardLogOf(['node', 'D:\\b\\server.mjs'])).toBe('D:\\b/data/board.log')
  })
})

describe('5c (0.30.0): a kept board is started only at its second missed look in a row', () => {
  const RETRY = 60000
  test('one miss starts nothing; two do; an answer between resets; the retry waits a minute after the last try', () => {
    const first = boardLook({ missed: 0, isUp: false, triedAt: -Infinity, now: 15000, retryMs: RETRY })
    expect(first).toEqual({ missed: 1, isStart: false })
    expect(boardLook({ missed: 1, isUp: false, triedAt: -Infinity, now: 30000, retryMs: RETRY })).toEqual({ missed: 2, isStart: true })
    expect(boardLook({ missed: 1, isUp: true, triedAt: -Infinity, now: 30000, retryMs: RETRY })).toEqual({ missed: 0, isStart: false })
    expect(boardLook({ missed: 0, isUp: false, triedAt: -Infinity, now: 45000, retryMs: RETRY }).isStart).toBe(false)
    expect(boardLook({ missed: 2, isUp: false, triedAt: 30000, now: 45000, retryMs: RETRY })).toEqual({ missed: 3, isStart: false })
    expect(boardLook({ missed: 5, isUp: false, triedAt: 30000, now: 90000, retryMs: RETRY })).toEqual({ missed: 6, isStart: true })
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
      why: { m2: `too long: ${MOST_CHARS + 1} > ${MOST_CHARS} characters`, m3: 'no text', m4: 'no text' }, clear: null, off: [], stop: null, handover: null, statuses: null, isAnswer: true })
    expect(parseTaken('{"messages":"x"}')).toEqual({ messages: [], refused: [], why: {}, clear: null, off: [], stop: null, handover: null, statuses: null, isAnswer: true })
    expect(parseTaken('')).toEqual({ messages: [], refused: [], why: {}, clear: null, off: [], stop: null, handover: null, statuses: null, isAnswer: false })
    // B738: the chats the board shows as not running; anything that is no name is left out.
    expect(parseTaken('{"messages":[],"off":["Worker 5",3,""]}').off).toEqual(['Worker 5'])
    expect(parseTaken('{"messages":[],"off":"x"}').off).toEqual([])
    // B547: the clear the board names for a worker that owes one; a step id that is no id is left out, no time is no clear.
    expect(parseTaken('{"messages":[],"clear":{"step":"B12","reportedAt":5}}').clear).toEqual({ step: 'B12', reportedAt: 5 })
    expect(parseTaken('{"messages":[],"clear":{"step":"../x","reportedAt":5}}').clear).toEqual({ step: null, reportedAt: 5 })
    expect(parseTaken('{"messages":[],"clear":{"step":"B12"}}').clear).toBeNull()
    // B769: the person's stop or remove for this worker, read safely, with the line it is told.
    const stop = parseTaken('{"messages":[],"stop":{"id":"m9","kind":"stop","task":"B12 \\"Lava\\""}}').stop
    expect(stop).toEqual({ id: 'm9', kind: 'stop', task: 'B12 "Lava"' })
    expect(stopLine(stop!)).toContain('The person stops your task B12 "Lava" (Stop task on the board): reach a safe point now')
    expect(stopLine({ id: 'm9', kind: 'remove', task: '' })).toContain('The board then takes you off the list and closes this chat.')
    expect(parseTaken('{"messages":[],"stop":{"id":"m9","kind":"delete"}}').stop).toBeNull()
    expect(parseTaken('{"messages":[],"stop":{"id":"../x","kind":"stop"}}').stop).toBeNull()
    // 2c (0.28.0): the board's statuses, kept with their caps; an older board's answer (none) is told apart from no answer.
    const entry = { name: 'Worker 1', status: 'Working', why: 'waits for the partner', tone: 'quiet', since: 5, reportAt: 9 }
    expect(parseTaken(JSON.stringify({ messages: [], statuses: [entry] })).statuses).toEqual([{ ...entry, held: null }])
    expect(parseTaken(JSON.stringify({ messages: [] })).statuses).toBeNull()
    expect(parseTaken('{"messages":[],"statuses":"x"}').statuses).toBeNull()
    expect(parseTaken('{"messages":[]}').isAnswer).toBe(true)
    expect(parseTaken('<html>not the board</html>').isAnswer).toBe(false)
  })

  test('2c: statuses keep the caps (50 entries, name 80, status 40, why 120), a tone that is quiet or attention, finite times or null', () => {
    const many = Array.from({ length: 60 }, (_, n) => ({ name: `Worker ${n}`, status: 'Free' }))
    expect(parseTaken(JSON.stringify({ messages: [], statuses: many })).statuses).toHaveLength(50)
    const odd = [
      { name: 'x'.repeat(81), status: 'Free' }, { name: 'A', status: 'y'.repeat(41) }, { name: '', status: 'Free' }, { name: 'B' }, 'stray', null,
      { name: 'C', status: 'Held', why: 'w'.repeat(300), tone: 'loud', since: 'soon', reportAt: Infinity, extra: 'ignored' },
      { name: 'D', status: 'Not running', tone: 'attention', since: 1, reportAt: 2 },
    ]
    expect(parseTaken(JSON.stringify({ messages: [], statuses: odd })).statuses).toEqual([
      { name: 'C', status: 'Held', why: 'w'.repeat(120), tone: 'quiet', since: null, reportAt: null, held: null },
      { name: 'D', status: 'Not running', why: null, tone: 'attention', since: 1, reportAt: 2, held: null },
    ])
  })

  test('7c: a status entry\'s held step: a step id, a title up to 60, the row\'s time up to 40 or null; anything else null', () => {
    const held = { id: 'B855', title: 'The walk', time: '1 h 56 of its 2 h' }
    expect(parseTaken(JSON.stringify({ messages: [], statuses: [{ name: 'Worker 5', status: 'Working', held }] })).statuses?.[0]?.held).toEqual(held)
    expect(parseHeld({ ...held, time: null })).toEqual({ ...held, time: null })
    expect(parseHeld({ ...held, time: 't'.repeat(41) })).toEqual({ ...held, time: null })
    expect(parseHeld({ ...held, time: ' 1 h 56\n of its   2 h ' })).toEqual(held)
    expect(parseHeld({ ...held, title: '  The   walk ' })).toEqual(held)
    expect(parseHeld({ ...held, title: 'x'.repeat(61) })).toBeNull()
    expect(parseHeld({ ...held, id: '../B1' })).toBeNull()
    expect(parseHeld({ ...held, title: 3 })).toBeNull()
    expect(parseHeld('B855')).toBeNull()
    expect(parseHeld(null)).toBeNull()
  })

  test('why a word was not typed is one short line', () => {
    // B532: why a word the chat did not take failed, in one short line.
    expect(typedWhy(new Error('engine  busy\nnow'), 'the chat did not take it')).toBe('the chat did not take it: engine busy now')
    expect(typedWhy('no prompt is taken now', 'a hook dropped it')).toBe('a hook dropped it: no prompt is taken now')
    expect(typedWhy(undefined, 'a hook dropped it')).toBe('a hook dropped it')
    expect(typedWhy('x'.repeat(400), 'f').length).toBe(203)
  })
})

describe('Focus 2: the partner keeps its drafts of the focus with the work tool', () => {
  // Goal definition (2026-10-31): the draft of the goal definition is `definition-draft` now; its old name `vibe-draft` stays an action.
  test('definition-draft (once vibe-draft) and how-draft are actions of the tool, with the fields they need', () => {
    expect(WORK_ACTIONS.includes('definition-draft')).toBe(true)
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

describe('B775: the partner judges the open items of Needs your attention with the work tool', () => {
  test('obsolete is an action of the tool, and its lines go in the points the result check uses (no new field)', () => {
    expect(WORK_ACTIONS.includes('obsolete')).toBe(true)
    expect(WORK_FIELDS.includes('points')).toBe(true)
  })
})

describe('0.29.0: every chat asks the board for an asset with the work tool', () => {
  test('asset is an action of the tool, with kind, text, pictures, of, follows and a library pick', () => {
    expect(WORK_ACTIONS.at(-1)).toBe('asset')
    for (const field of ['kind', 'text', 'pictures', 'of', 'follows', 'id', 'picked']) expect(WORK_FIELDS.includes(field)).toBe(true)
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
    // 0.27.3: the work tool says "goal definition" and takes definition-draft (this branch carried 0.27.1, the main branch is at 0.27.2).
    expect(MOD_VERSION).toBe('0.30.0')
  })

  test('the answer: a name, the role the board gives it and the session its card is filed under', () => {
    expect(parseWhoami('{"name":"Worker 5","role":"worker","card":"53d8e277-aaaa-4bbb-8ccc-0123456789ab"}')).toEqual({ name: 'Worker 5', role: 'worker', card: '53d8e277-aaaa-4bbb-8ccc-0123456789ab' })
    expect(parseWhoami('{"name":" Main ","role":"main","card":null}')).toEqual({ name: 'Main', role: 'main', card: null })
    for (const role of ['main', 'worker', 'advisor', 'owner', 'helper', 'supervisor']) expect(parseWhoami(JSON.stringify({ name: 'A', role, card: null }))?.role).toBe(role)
    // An older board says no role and no card: the name still counts.
    expect(parseWhoami('{"name":"Units"}')).toEqual({ name: 'Units', role: null, card: null })
    // 2026-10-31: the Supervisor chat as the board names it: a name and a plain app session id, else nothing.
    expect(parseWhoami('{"name":"Units","supervisor":{"name":" Supervisor ","session":"local_9f2c-11"}}')?.supervisor).toEqual({ name: 'Supervisor', session: 'local_9f2c-11' })
    for (const supervisor of ['{"name":"S","session":"cli-123"}', '{"name":"","session":"local_1"}', '{"session":"local_1"}', '"x"', 'null']) expect(parseWhoami('{"name":"Units","supervisor":' + supervisor + '}')).toEqual({ name: 'Units', role: null, card: null })
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

describe('T8.5: the board\'s hand-over envelope, as the mod reads it (DESIGN.md, "The envelope\'s contract for the Workers mod")', () => {
  const ENVELOPE = { id: '0123456789abcdef', kind: 'task', step: 'B12', clear: { step: 'B11', reportedAt: 5 }, restart: false, set: { model: 'claude-opus-4-1', effort: 'high' }, line: 'work: B12 is yours; run work next' }

  test('an envelope: its id, kind, step, clear, restart, set, line and version, read safely', () => {
    expect(parseEnvelope(ENVELOPE)).toEqual({ ...ENVELOPE, version: null })
    expect(parseEnvelope({ id: 'ab12', kind: 'restart', step: null, clear: null, restart: true, set: null, line: null, version: '0.27.1' })).toEqual({ id: 'ab12', kind: 'restart', step: null, clear: null, restart: true, set: null, line: null, version: '0.27.1' })
    // What is no id, no object or no step id is left out; an unknown kind is a task; a clear without its time is none.
    for (const raw of [null, 'x', [], {}, { id: '' }, { id: '../x' }, { id: 7 }]) expect(parseEnvelope(raw)).toBeNull()
    expect(parseEnvelope({ ...ENVELOPE, kind: 'boss', step: '../x', clear: { step: 'B11' }, line: '  ', version: 'next' })).toEqual({ ...ENVELOPE, kind: 'task', step: null, clear: null, line: null, version: null })
    expect(parseEnvelope({ ...ENVELOPE, clear: { step: 'x', reportedAt: 5 }, restart: 'yes' })?.clear).toEqual({ step: null, reportedAt: 5 })
    expect(parseEnvelope({ ...ENVELOPE, restart: 'yes' })?.restart).toBe(false)
  })

  test('the turn-ended answer: a `handover` object means the sequence (whatever its envelope); none, or no object, the old path', () => {
    expect(parseHandover({ handover: { state: 'handing', why: null, step: 'B12', envelope: ENVELOPE, waits: null } })).toEqual({ state: 'handing', why: null, step: 'B12', envelope: { ...ENVELOPE, version: null }, waits: null })
    expect(parseHandover({ handover: { state: 'held', why: 'its clear did not run: x', step: null, envelope: null, waits: 'set' } })).toEqual({ state: 'held', why: 'its clear did not run: x', step: null, envelope: null, waits: 'set' })
    expect(parseHandover({ handover: {} })).toEqual({ state: 'unknown', why: null, step: null, envelope: null, waits: null })
    for (const answer of [null, {}, { handover: null }, { handover: 'x' }, { pull: { text: 'work: B1 is yours; run work next' } }]) expect(parseHandover(answer)).toBeNull()
  })

  test('the take: the envelope that waited for the worker', () => {
    expect(parseTaken(JSON.stringify({ messages: [], handover: ENVELOPE })).handover).toEqual({ ...ENVELOPE, version: null })
    expect(parseTaken(JSON.stringify({ messages: [], handover: { id: '' } })).handover).toBeNull()
  })

  test('an outcome before anything was done: nothing asked, nothing failed', () => {
    expect(NO_OUTCOME).toEqual({ cleared: null, set: null, typed: null, restarted: null, background: false, why: null })
  })
})

describe("Your words: the main chat puts the person's words on a step (the person, 2026-10-31)", () => {
  test('words is an action of the tool and where one of its fields', () => {
    expect(WORK_ACTIONS.includes('words')).toBe(true)
    expect(WORK_FIELDS.includes('where')).toBe(true)
  })
})
