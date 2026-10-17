import { describe, expect, mock, test } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import type { ChatFile, ChatTask } from '../types'
import { chatText, parseChat } from './chats'

const TOOL = 'mcp__folder-branches__chat'
const ROOT = 'C:\\Web\\project'
const CHATS = 'C:/Web/project/.claude/chats'
const MIN = 60000

/** A path as a hook is handed it, with forward slashes. */
const slashed = (path: string): string => path.replaceAll('\\', '/')

/** What the test's hooks answer from: the files of the project, by path, and what the session did. */
type World = {
  /** The id of the session the test plays. */
  id: string
  files: Record<string, string>
  /** This session's own agents, as `$.agent.list()` names them. */
  agents: { id: string; name?: string }[]
  /** The tools registered, each as `name:isDeferred`. */
  tools: string[]
  opened: string[]
  /** Who sent each message that left the session. */
  sent: string[]
  /** What the file of the session said while a question to the person was open. */
  whileAsked: ChatFile | null
  /** What the worker board holds for this chat, handed out at the next take. */
  waiting: { id: string; text: string }[]
  /** Each question to the board: its address, its key and its body. */
  fetched: { url: string; key: string; body: string }[]
  /** What the mod typed into the chat: who it says typed it, and the words. */
  typedIn: string[]
  /** What the mod told the board became of what it took. */
  reported: string[]
  /** True when the chat refuses what is typed into it. */
  refusesTyping: boolean
  /** The addresses that answer; a board at any other address is down. Null: everything answers. */
  up: string[] | null
  /** The commands the mod started, each as one line. */
  spawned: string[]
  /** False for a board that never answers, whatever is started. */
  comesUp: boolean
  /** How large the conversation is, the instructions of each compaction asked for, and the lines shown about it. */
  tokens: number
  /** True when something else keeps the conversation from being compacted. */
  refusesCompact: boolean
  /** B227: the engine compacts only by /compact, as in the desktop app's SDK sessions. */
  isHeadless: boolean
  commanded: string[]
  compactions: string[]
  toasts: string[]
  /** B297: each call of the work tool that reached the board, and what the board answers it. */
  worked: string[]
  workAnswer: { status: number; text: string }
}

function world(id: string, files: Record<string, string> = {}): World {
  return { id, files, agents: [], tools: [], opened: [], sent: [], whileAsked: null, waiting: [], fetched: [], typedIn: [], reported: [], refusesTyping: false, up: null, spawned: [], comesUp: true, tokens: 50_000, refusesCompact: false, isHeadless: false, commanded: [], compactions: [], toasts: [], worked: [], workAnswer: { status: 200, text: '{"text":"Yours, Units:"}' } }
}

/** The project's list of chats, with the titles that join by themselves. */
function listed(chats: Record<string, ChatFile> = {}): Record<string, string> {
  const files: Record<string, string> = { [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main" }\n' }
  for (const [id, chat] of Object.entries(chats)) files[`${CHATS}/${id}.json`] = chatText(chat)
  return files
}

const task = (text: string, step = 0, steps = 0, minutes: number | null = null): ChatTask => (
  { text, step, steps, left: minutes === null ? null : minutes * MIN, isReported: false }
)

/** The chat a session keeps in the project's folder; null when it keeps none. */
function fileOf(w: World, id = w.id): ChatFile | null {
  const text = w.files[`${CHATS}/${id}.json`]
  return text === undefined ? null : parseChat(text)
}

/** The engine beneath the mod: a folder of files, a clock the test moves, and the session's own answers. */
function stand(on: On, w: World): void {
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: w.id }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => {
    w.tools.push(`${e.name}:${String(e.isDeferred)}`)

    return { value: { tool: `mcp__folder-branches__${e.name}` } }
  })
  on('agent.list', () => ({ value: w.agents.map(a => ({ ...a, description: '', type: 'general-purpose', status: 'running' as const })) }))
  on('ui.open', (_$, e) => {
    w.opened.push(`${e.id}:${e.title}`)

    return { value: { isPlaced: true } }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PostToolBatch', () => ({}))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: w.tokens, window: 1_000_000, percent: Math.round(w.tokens / 10_000) }, rateLimits: [] } }))
  on('command.run', { command: 'compact' }, (_$, e) => {
    w.commanded.push(e.args)
    w.tokens = 90_000
    return { text: 'Compacted.' }
  })
  on('session.compact', (_$, e) => {
    if (w.isHeadless) return { skip: '$.session.compact: not available in a headless (-p / SDK) session yet: compaction here runs inside a turn (a /compact prompt); catch it and carry on' }
    w.compactions.push(e.instructions ?? '')
    if (w.refusesCompact) return { skip: 'another hook keeps the conversation' }
    const tokensBefore = w.tokens
    w.tokens = 90_000

    return { messages: [{ role: 'user' as const, text: 'A summary of the work so far.', toolUses: [] }], tokensBefore, tokensAfter: 90_000 }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('classic.SessionStart', () => ({}))
  on('session.send', (_$, e) => {
    w.sent.push(e.origin.kind)

    return { isDelivered: true as const }
  })
  // The one tool beneath the mod: a question to the person, answered at once.
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    w.whileAsked = fileOf(w)

    return { result: { answers: {} } }
  })
  on('fs.exists', (_$, e) => {
    const path = slashed(e.path)

    return { value: Object.keys(w.files).some(known => known === path || known.startsWith(`${path}/`)) }
  })
  on('fs.read', (_$, e) => {
    const text = w.files[slashed(e.path)]

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', (_$, e) => {
    w.files[slashed(e.path)] = e.text

    return { value: undefined }
  })
  on('fs.list', (_$, e) => {
    const path = slashed(e.path)
    if (path === slashed(ROOT)) return { value: [] }
    const names = Object.keys(w.files).filter(known => known.startsWith(`${path}/`)).map(known => known.slice(path.length + 1))
    const entries: FsEntry[] = names.filter(name => !name.includes('/')).map(name => ({ name, kind: 'file', size: (w.files[`${path}/${name}`] ?? '').length, mtimeMs: 1, isLink: false }))

    return names.length === 0 ? { deny: 'no such folder' } : { value: entries }
  })
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  // The worker board: it hands out what waits, once.
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e.argv.join(' '))
    // A started board answers from now on.
    if (w.comesUp) w.up?.push('http://127.0.0.1:4310/')
    yield { stream: 'stdout' as const, text: 'Worker board: http://127.0.0.1:4310/\n' }

    return { value: { code: w.comesUp ? 0 : 1, signal: null } }
  })
  on('http.fetch', (_$, e) => {
    if (w.up !== null && !w.up.some(address => e.url.startsWith(address))) return { deny: 'ECONNREFUSED' }
    if (e.url.endsWith('/api/bridge/work')) {
      w.worked.push(e.init?.body ?? '')

      return { value: { status: w.workAnswer.status, ok: w.workAnswer.status === 200, headers: {}, text: w.workAnswer.text } }
    }
    if (e.url.endsWith('/api/bridge/typed')) {
      w.reported.push(e.init?.body ?? '')

      return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
    }
    w.fetched.push({ url: e.url, key: e.init?.headers?.['X-Board-Key'] ?? '', body: e.init?.body ?? '' })

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ messages: w.waiting.splice(0) }) } }
  })
  on('prompt.submit', (_$, e) => {
    if (w.refusesTyping) return { drop: 'no prompt is taken now' }
    w.typedIn.push(`${e.origin.kind}:${e.origin.kind === 'plugin' && e.origin.asUser === true ? 'as the person' : 'framed'}:${e.text}`)

    return { text: e.text }
  })
}

/** The Workers pane as a surface draws it. */
const PANE = {
  component: 'Pane',
  requestId: 'workers',
  props: { title: 'Workers', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
/** The Git pane: the folders and their branches. */
const GIT = { ...PANE, requestId: 'folder-branches', props: { ...PANE.props, title: 'Git' } } as const

const START = { cwd: ROOT, surface: 'desktop', isInteractive: true } as const
const ASKED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
/** What finds the line of the chat with this name in the pane: its mark, its name, then the rest. */
const lineOf = (name: string) => ({ type: 'Text', text: new RegExp(`^. ${name}  `) }) as const

const ENDED = { answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' } as const
const BY_MODEL = { origin: { kind: 'model' } } as const
/** A request for the system prompt, as the engine makes one. */
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] } as const

describe('a chat keeps its own line in the list', () => {
  test('it joins by its title, and its task, step and time show while it works', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    // The project keeps a list: the tool is in reach from the start, and nothing is listed yet.
    expect(w.tools).toEqual(['chat:false', 'work:false'])
    expect(fileOf(w)).toBeNull()

    await $.classic.UserPromptSubmit({ prompt: 'the archer', session_title: 'Game - Units' })
    expect(fileOf(w)).toEqual({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: clock.now() })
    await $.turn.start({ text: 'the archer', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'desktop', ...PANE })
    const line = async (): Promise<string | undefined> => (await ui.find(lineOf('Units')))?.text
    expect(await line()).toBe('● Units  working')

    const named = await $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer' })
    expect(named.result).toBe('Recorded. The list shows: Skeleton Archer')
    expect(await line()).toBe('● Units  Skeleton Archer')
    await $.tool.call({ tool: TOOL, action: 'plan', steps: 5, minutes: 40 })
    expect(await line()).toBe('● Units  Skeleton Archer · 1 of 5 · ~40 min')

    // Ten minutes of work: the time counts down, and the chat is still seen as working.
    await clock.advance(10 * MIN)
    for (let i = 0; i < 50 && (await line()) !== '● Units  Skeleton Archer · 1 of 5 · ~30 min'; i++) await Promise.resolve()
    expect(await line()).toBe('● Units  Skeleton Archer · 1 of 5 · ~30 min')
    const stepped = await $.tool.call({ tool: TOOL, action: 'step' })
    expect(stepped.result).toBe('Recorded. The list shows: Skeleton Archer · 2 of 5 · ~30 min')
    await $.tool.call({ tool: TOOL, action: 'step', step: '4', minutes: 12 })
    expect(await line()).toBe('● Units  Skeleton Archer · 4 of 5 · ~10 min')

    // The turn ends with the task open: the person's move.
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(await line()).toBe('◐ Units  your turn · Skeleton Archer · 4 of 5')
    // Waiting costs none of the expected time.
    await clock.advance(30 * MIN)
    await $.turn.start({ text: 'go on', turnId: 't2' })
    expect(await line()).toBe('● Units  Skeleton Archer · 4 of 5 · ~10 min')
    await ui.unmount()
  })

  test('the task clears by itself when the chat reports and its turn ends', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 5, 5, 3), at: 0 } }))
    w.agents = [{ id: 'a1b2-judge', name: 'judge' }]
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'finish', turnId: 't1' })

    // A message to one of its own agents is no report.
    await $.session.send({ to: 'judge', text: 'look again', ...BY_MODEL })
    await $.session.send({ to: 'a1b2-judge [3fa9c1]', text: 'and again', ...BY_MODEL })
    // Nor is one to an agent that finished and is listed no more: its id says what it is.
    await $.session.send({ to: 'a99695cdbace47f46', text: 'once more', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 's9', agentId: 'helper-7' })
    await $.session.send({ to: 'helper-7', text: 'thanks', ...BY_MODEL })
    expect(fileOf(w)?.task?.isReported).toBe(false)
    await $.session.send({ to: 'Game - Main', text: 'The archer is merged.', ...BY_MODEL })
    // Its last step, noted after the report, does not take the report back.
    await $.tool.call({ tool: TOOL, action: 'step' })
    expect(w.sent).toHaveLength(5)
    expect(fileOf(w)?.task?.isReported).toBe(true)
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(fileOf(w)?.task).toBeNull()
    expect(fileOf(w)?.state).toBe('waiting')
    const listing = await $.tool.call({ tool: TOOL, action: 'list' })
    expect(listing.result).toBe('○ Units  free')
  })

  test('a question to the person is their turn while it is open; done drops a task', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 2, 5, 20), at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    expect(w.whileAsked?.state).toBe('asking')
    expect(fileOf(w)?.state).toBe('working')
    const dropped = await $.tool.call({ tool: TOOL, action: 'done' })
    expect(dropped.result).toBe('Recorded. The list shows: working')
    expect(fileOf(w)?.task).toBeNull()
  })

  test('a subagent neither changes the line nor ends the chat\'s turn', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 2, 5, 20), at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const refused = await $.tool.call({ tool: TOOL, action: 'done', agentId: 'a1' })
    expect(String(refused.result)).toContain('main conversation')
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
    await $.turn.complete({ ...ENDED, turnId: 's1', agentId: 'a1' })
    expect(fileOf(w)?.state).toBe('working')
  })
})

describe('the list in the Workers pane', () => {
  const chats: Record<string, ChatFile> = {
    main: { name: 'Main', role: 'main', state: 'waiting', task: null, at: 0 },
    units: { name: 'Units', role: 'worker', state: 'working', task: task('Skeleton Archer', 3, 5, 40), at: 1 },
    features: { name: 'Features', role: 'worker', state: 'waiting', task: task('Logging', 1, 4, 30), at: 0 },
    levels: { name: 'Levels', role: 'worker', state: 'working', task: null, at: 1 },
    cleanup: { name: 'Cleanup', role: 'worker', state: 'waiting', task: null, at: 0 },
  }
  const LINES = [
    '◆ Main  waiting for 3 workers', '○ Cleanup  free', '◐ Features  your turn · Logging · 1 of 4', '● Levels  working',
    '● Units  Skeleton Archer · 3 of 5 · ~40 min',
  ]

  test('every chat of the project has its line in the Workers pane, on every surface; the Git pane keeps to the folders', async ($, on) => {
    mock.clock(on, { now: 1000 })
    const w = world('cleanup', listed(chats))
    stand(on, w)
    await $.session.start(START)
    // There are chats to show and no branch: the Workers pane opens by itself, the Git pane does not.
    expect(w.opened).toEqual(['workers:Workers'])
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'folder-branches', surface, ...PANE })
      const drawn: string[] = []
      for (const name of ['Main', 'Cleanup', 'Features', 'Levels', 'Units']) drawn.push((await ui.find(lineOf(name)))?.text ?? '')
      expect(drawn).toEqual(LINES)
      expect(await ui.find({ type: 'Text', text: /folder/ })).toBeUndefined()
      await ui.unmount()
      const git = await $.ui.mount({ plugin: 'folder-branches', surface, ...GIT })
      expect(await git.find({ type: 'Text', text: 'This folder holds no folders.' })).toBeDefined()
      expect(await git.find(lineOf('Units'))).toBeUndefined()
      await git.unmount()
    }
    const answer = await $.command.run({ command: 'workers', args: '', ...ASKED })
    expect(answer.text).toBe([...LINES, 'The Workers pane is open.'].join('\n'))
    expect(w.opened).toEqual(['workers:Workers', 'workers:Workers'])
    const git = await $.command.run({ command: 'git', args: '', ...ASKED })
    expect(git.text).toBe('This folder holds no folders.\nThe Git pane is open.')
    const listing = await $.tool.call({ tool: TOOL, action: 'list' })
    expect(listing.result).toBe(LINES.join('\n'))
  })

  test('another chat\'s change shows within seconds, and a chat that stopped writing is not shown as working', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const w = world('cleanup', listed(chats))
    stand(on, w)
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'desktop', ...PANE })
    w.files[`${CHATS}/levels.json`] = chatText({ name: 'Levels', role: 'worker', state: 'working', task: task('Torches', 1, 3, 15), at: 4000 })
    await clock.advance(5000)
    for (let i = 0; i < 50 && (await ui.find(lineOf('Levels')))?.text === '● Levels  working'; i++) await Promise.resolve()
    expect((await ui.find(lineOf('Levels')))?.text).toBe('● Levels  Torches · 1 of 3 · ~15 min')
    // Nobody writes the files of Units and Levels any more: their app was closed in the middle of a turn.
    await clock.advance(3 * MIN)
    for (let i = 0; i < 50 && (await ui.find(lineOf('Units')))?.text?.startsWith('●') === true; i++) await Promise.resolve()
    expect((await ui.find(lineOf('Units')))?.text).toBe('◐ Units  your turn · Skeleton Archer · 3 of 5')
    expect((await ui.find(lineOf('Levels')))?.text).toBe('◐ Levels  your turn · Torches · 1 of 3')
    await ui.unmount()
  })
})

describe('a line that stays true when a session ends badly or changes its id', () => {
  const ARCHER: ChatFile = { name: 'Units', role: 'worker', state: 'working', task: task('Skeleton Archer', 2, 5, 20), at: 1000 }

  test('a file left "working" by a closed app is set right at the next start, and is not kept alive', async ($, on) => {
    const clock = mock.clock(on, { now: 60 * MIN })
    const w = world('units', listed({ units: ARCHER }))
    stand(on, w)
    await $.session.start(START)
    expect(fileOf(w)?.state).toBe('waiting')
    // The turn that died worked two minutes at most since its file was written.
    expect(fileOf(w)?.task?.left).toBe(18 * MIN)
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'desktop', ...PANE })
    expect((await ui.find(lineOf('Units')))?.text).toBe('◐ Units  your turn · Skeleton Archer · 2 of 5')
    await clock.advance(5 * MIN)
    expect(fileOf(w)?.state).toBe('waiting')
    expect(fileOf(w)?.at).toBe(60 * MIN)
    await ui.unmount()
  })

  test('a turn in which the line is changed every few seconds is still seen as working', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const w = world('units', listed({ units: { ...ARCHER, state: 'waiting', task: task('Skeleton Archer', 1, 20, 60) } }))
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    for (let i = 0; i < 12; i++) {
      await clock.advance(20000)
      await $.tool.call({ tool: TOOL, action: 'step' })
    }
    // Four minutes on: the file was written within the last seconds, and the time went down with the work.
    expect(clock.now() - (fileOf(w)?.at ?? 0)).toBeLessThan(30000)
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('● Units  Skeleton Archer · 13 of 20 · ~55 min')
  })

  test('after a /clear the chat goes on under its new session id, and its old file leaves', async ($, on) => {
    mock.clock(on, { now: 5000 })
    const w = world('s1', { [`${CHATS}/list.json`]: '{}\n', [`${CHATS}/s1.json`]: chatText({ ...ARCHER, state: 'waiting' }) })
    stand(on, w)
    await $.session.start(START)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    w.id = 's2'
    expect(fileOf(w, 's1')).toBeNull()
    await $.turn.start({ text: 'next', turnId: 't1' })
    expect(fileOf(w, 's2')).toEqual({ name: 'Units', role: 'worker', state: 'working', task: null, at: 5000 })
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('● Units  working')
    expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toContain('This chat is "Units"')
  })

  test('of two files under one name the list shows the chat written last, and neither puts the other out', async ($, on) => {
    mock.clock(on, { now: 5000 })
    const w = world('new', listed({ old: { ...ARCHER, state: 'waiting' }, main: { name: 'Main', role: 'main', state: 'waiting', task: null, at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    // The older chat's open task counts while it is the one in the list.
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('◆ Main  waiting for 1 worker\n◐ Units  your turn · Skeleton Archer · 2 of 5')
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Game - Units' })
    expect(fileOf(w, 'old')?.task?.text).toBe('Skeleton Archer')
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('◆ Main  free\n○ Units  free')
    // Taking the name out takes every file under it out.
    expect((await $.tool.call({ tool: TOOL, action: 'leave', name: 'Units' })).result).toBe('"Units" is out of the list.')
    expect(fileOf(w, 'old')).toBeNull()
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('◆ Main  free')
  })

  test('the note in the system prompt reads the same through a task, and goes when the chat leaves', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { ...ARCHER, state: 'waiting', task: null } }))
    stand(on, w)
    await $.session.start(START)
    const note = async (): Promise<string | undefined> => (
      (await $.prompt.compose(COMPOSE)).sections.find(section => section.id === 'folder-branches:chat')?.text
    )
    const first = await note()
    expect(first).toContain('This chat is "Units"')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer', steps: 5, minutes: 40 })
    expect(await note()).toBe(first)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    await $.tool.call({ tool: TOOL, action: 'step' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(await note()).toBe(first)
    await $.tool.call({ tool: TOOL, action: 'leave' })
    expect(await note()).toBeUndefined()
  })
})

describe('who is in the list', () => {
  test('a chat in the list is told how the list is kept; any other chat is told nothing', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    const ids = async (): Promise<string[]> => (await $.prompt.compose(COMPOSE)).sections.map(section => section.id)
    expect(await ids()).toEqual(['intro'])
    // A chat with another title is none of the project's.
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Fix the launch file' })
    expect(fileOf(w)).toBeNull()
    await $.classic.SessionStart({ source: 'resume', session_title: 'Game - Units' })
    expect(await ids()).toEqual(['intro', 'folder-branches:chat'])
    const note = (await $.prompt.compose(COMPOSE)).sections.find(section => section.id === 'folder-branches:chat')
    expect(note?.scope).toBe('session')
    expect(note?.text).toContain('This chat is "Units"')
    expect(note?.text).toContain(TOOL)
    // Renamed by the person: the list follows, and the main chat is the one the project names.
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Game - Main' })
    expect(fileOf(w)?.name).toBe('Main')
    expect(fileOf(w)?.role).toBe('main')
    expect((await $.prompt.compose(COMPOSE)).sections.at(-1)?.text).toContain('You are the main chat')
  })

  test('a chat joins and leaves through the tool when asked, keeping its task', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('s1', { [`${CHATS}/list.json`]: '{}\n' })
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'join', turnId: 't1' })
    const joined = await $.tool.call({ tool: TOOL, action: 'join', name: ' Units ' })
    expect(joined.result).toBe('This chat is in the list as "Units" (a worker).')
    expect(fileOf(w, 's1')?.state).toBe('working')
    await $.tool.call({ tool: TOOL, action: 'plan', text: 'Wizard', steps: 3, minutes: 20 })
    await $.tool.call({ tool: TOOL, action: 'join', name: 'Units 2', role: 'main' })
    expect(fileOf(w, 's1')).toEqual({ name: 'Units 2', role: 'main', state: 'working', task: task('Wizard', 1, 3, 20), at: clock.now() })
    expect((await $.tool.call({ tool: TOOL, action: 'join' })).result).toBe('Give the chat a name in "name".')
    expect((await $.tool.call({ tool: TOOL, action: 'leave' })).result).toBe('This chat is out of the list.')
    expect(fileOf(w, 's1')).toBeNull()
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('No chat is in the list yet.')
    expect((await $.tool.call({ tool: TOOL, action: 'plan', text: 'x' })).result).toBe('This chat is not in the list: nothing was recorded.')
    expect((await $.tool.call({ tool: TOOL, action: 'leave' })).result).toBe('This chat is not in the list.')
  })

  test('a chat that was taken out stays out until it is asked back; a closed chat is taken out by its name', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ old: { name: 'Sound', role: 'worker', state: 'waiting', task: null, at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Game - Units' })
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('○ Sound  free\n○ Units  free')
    expect((await $.tool.call({ tool: TOOL, action: 'leave', name: 'sound' })).result).toBe('"Sound" is out of the list.')
    expect((await $.tool.call({ tool: TOOL, action: 'leave', name: 'Music' })).result).toBe('No chat in the list is named "Music".')
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('○ Units  free')
    expect((await $.tool.call({ tool: TOOL, action: 'leave' })).result).toBe('This chat is out of the list.')
    // Its title still says it is one of the project's chats: it stays out all the same.
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Game - Units' })
    expect(fileOf(w)).toBeNull()
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('No chat is in the list yet.')
    await $.tool.call({ tool: TOOL, action: 'join', name: 'Units' })
    expect(fileOf(w)?.name).toBe('Units')
  })

  test('a project without a list: nothing is written, and the tool waits behind tool search', async ($, on) => {
    mock.clock(on)
    const w = world('s1')
    stand(on, w)
    await $.session.start(START)
    expect(w.tools).toEqual(['chat:true', 'work:true'])
    expect(w.opened).toEqual([])
    await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Game - Units' })
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.session.send({ to: 'someone', text: 'hi', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    expect(w.files).toEqual({})
    expect((await $.prompt.compose(COMPOSE)).sections.map(section => section.id)).toEqual(['intro'])
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'terminal', ...GIT })
    expect(await ui.find({ type: 'Text', text: 'This folder holds no folders.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /free|working|your turn/ })).toBeUndefined()
    await ui.unmount()
    const workers = await $.ui.mount({ plugin: 'folder-branches', surface: 'terminal', ...PANE })
    expect(await workers.find({ type: 'Text', text: 'No chat is in the list yet.' })).toBeDefined()
    await workers.unmount()
    expect((await $.command.run({ command: 'workers', args: '', ...ASKED })).text).toBe('No chat is in the list yet.\nThe Workers pane is open.')
    expect(w.files).toEqual({})
  })
})

describe('what the person answers on the worker board reaches the chat it is for', () => {
  const BOARD = 'C:/Web/project/.claude/board.json'
  const KEY = 'ab'.repeat(32)
  const board = JSON.stringify({ url: 'http://127.0.0.1:4311', key: KEY, startedAt: 1 })
  /** Lets the timer's reading and typing run to their end. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) await Promise.resolve()
  }

  test('a chat in the list takes what waits for it and types it as the person\'s own words, once', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.waiting.push({ id: 'm1', text: '(answered on the worker board, 16:02) B14 "The walk": approved. Tick this step in the backlog.' })
    await clock.advance(5000)
    await settle()

    // It says who asks: the chat's name and its session, so the board serves only the chat it shows under that name.
    expect(w.fetched[0]).toEqual({ url: 'http://127.0.0.1:4311/api/bridge/take', key: KEY, body: '{"chat":"Units","session":"units"}' })
    expect(w.reported).toEqual(['{"chat":"Units","session":"units","typed":["m1"],"failed":[]}'])
    expect(w.typedIn).toEqual(['plugin:as the person:(answered on the worker board, 16:02) B14 "The walk": approved. Tick this step in the backlog.'])

    // A board that hands the same message out again does not get it typed twice.
    w.waiting.push({ id: 'm1', text: 'again' }, { id: 'm2', text: 'Sheet B' })
    await clock.advance(5000)
    await settle()
    expect(w.typedIn.map(line => line.split(':').pop())).toEqual([' approved. Tick this step in the backlog.', 'Sheet B'])
  })

  test('a busy chat takes too: the engine runs what was typed once the chat is idle', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await $.turn.start({ text: 'hello', turnId: 't1' })
    w.waiting.push({ id: 'm1', text: 'Sheet B' })
    await clock.advance(5000)
    await settle()
    expect(w.typedIn).toEqual(['plugin:as the person:Sheet B'])
  })

  test('what could not be typed is reported, so the board shows that it did not arrive', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.refusesTyping = true
    w.waiting.push({ id: 'm1', text: 'Sheet B' }, { id: 'm2', text: 'x'.repeat(5000) })
    await clock.advance(5000)
    await settle()
    expect(w.typedIn).toEqual([])
    expect(w.reported.map(body => JSON.parse(body).failed).flat().sort()).toEqual(['m1', 'm2'])
  })

  test('no board is asked without its file, by a chat that is not in the list, or anywhere but on this machine', async ($, on) => {
    const clock = mock.clock(on)
    const none = world('units', listed())
    stand(on, none)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await clock.advance(5000)
    await settle()
    expect(none.fetched).toEqual([])
  })

  test('a board file that points elsewhere is not followed', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: JSON.stringify({ url: 'http://example.com:80', key: KEY }) })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await clock.advance(5000)
    await settle()
    expect(w.fetched).toEqual([])
  })

  test('a chat that is not one of the project\'s takes nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('other', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Shopping list' })
    await clock.advance(5000)
    await settle()
    expect(w.fetched).toEqual([])
  })

  test('every chat in the list is told what the board\'s mark means, and never to send through the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    const composed = await $.prompt.compose(COMPOSE)
    const note = composed.sections.find(section => section.id === 'folder-branches:chat')?.text ?? ''
    expect(note).toContain('(answered on the worker board, HH:MM)')
    expect(note).toContain('Never send anything to the board yourself')
  })
})

describe('the worker board is kept running by the chats', () => {
  const LAUNCH = 'C:/Web/project/.claude/launch.json'
  const launch = JSON.stringify({ configurations: [{ name: 'worker-board', runtimeExecutable: 'node', runtimeArgs: ['C:/Web/project/worker-board/server.mjs'], port: 4310 }] })
  const withBoards = (): Record<string, string> => ({
    ...listed(),
    [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main", "boards": ["worker-board"] }\n',
    [LAUNCH]: launch,
  })
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) await Promise.resolve()
  }

  test('the first chat of the project that finds the board down starts it, once', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('main', withBoards())
    w.up = []
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Main' })
    await clock.advance(5000)
    await settle()
    expect(w.spawned).toEqual(['node C:/Web/project/worker-board/server.mjs'])
    // It answers now: nothing more is started, however long the chat lives.
    await clock.advance(5 * MIN)
    await settle()
    expect(w.spawned.length).toBe(1)
  })

  test('a board that answers is left alone, and one that does not come up is not started over and over', async ($, on) => {
    const clock = mock.clock(on)
    const running = world('main', withBoards())
    stand(on, running)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Main' })
    await clock.advance(60000)
    await settle()
    expect(running.spawned).toEqual([])
  })

  test('a board that does not come up is tried again a minute later, not at every tick', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('main', withBoards())
    w.up = []
    w.comesUp = false
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Main' })
    await clock.advance(50000)
    await settle()
    expect(w.spawned.length).toBe(1)
    await clock.advance(30000)
    await settle()
    expect(w.spawned.length).toBe(2)
  })

  test('a chat that is not one of the project\'s starts nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('other', withBoards())
    w.up = []
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Shopping list' })
    await clock.advance(60000)
    await settle()
    expect(w.spawned).toEqual([])
  })
})

describe('every chat keeps a card of its task', () => {
  test('a worker names its steps with the plan, and the card says which step it is on', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'the archer', session_title: 'Game - Units' })
    await $.turn.start({ text: 'the archer', turnId: 't1' })
    const planned = await $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer', names: ['Cut the sheet', 'Wire the walk', 'Check in game'], minutes: 40 })
    expect(planned.result).toBe('Recorded. The list shows: Skeleton Archer · 1 of 3 · ~40 min')
    await $.tool.call({ tool: TOOL, action: 'plan', stepMinutes: 15 })
    expect(fileOf(w)?.task?.stepLeft).toBe(15 * MIN)
    expect(fileOf(w)?.task?.names).toEqual(['Cut the sheet', 'Wire the walk', 'Check in game'])
    await $.tool.call({ tool: TOOL, action: 'step', minutes: 25 })
    expect(fileOf(w)?.task).toEqual({ text: 'Skeleton Archer', step: 2, steps: 3, left: 25 * MIN, isReported: false, names: ['Cut the sheet', 'Wire the walk', 'Check in game'] })
  })

  test('the main chat keeps a card too: handing a task to a worker does not clear it, "done" does', async ($, on) => {
    mock.clock(on)
    const w = world('main', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hand out the knight', session_title: 'Game - Main' })
    await $.turn.start({ text: 'hand out the knight', turnId: 't1' })
    await $.tool.call({ tool: TOOL, action: 'plan', text: 'Hand out the knight', names: ['Write the step', 'Message Units'], minutes: 5 })
    await $.session.send({ to: 'Game - Units', message: 'Task from Game - Main: the knight', ...BY_MODEL })
    await $.turn.complete({ turnId: 't1', ...ENDED })
    // Its turn ended after a message to a worker: for a worker that would be its report, for the main chat it is not.
    expect(fileOf(w)?.task?.text).toBe('Hand out the knight')
    expect(fileOf(w)?.task?.isReported).toBe(false)
    await $.turn.start({ text: 'thanks', turnId: 't2' })
    await $.tool.call({ tool: TOOL, action: 'done' })
    expect(fileOf(w)?.task).toBeNull()
  })
})

describe('a working chat never stays without a time on its card', () => {
  const BATCH = { hook_event_name: 'PostToolBatch', session_id: 'units', transcript_path: 'x', cwd: ROOT, tool_calls: [] } as const
  /** What the chat is told after its next batch of tool calls; null when nothing. */
  const told = async ($: Parameters<Parameters<typeof test>[1]>[0], more: Record<string, unknown> = {}): Promise<string | null> => {
    const result = await $.classic.PostToolBatch({ ...BATCH, ...more } as never)
    return result.additionalContext?.join('\n') ?? null
  }

  test('after two batches of tool calls without a card it is told to record one, with its next tool call', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'the archer', session_title: 'Game - Units' })
    await $.turn.start({ text: 'the archer', turnId: 't1' })
    expect(await told($)).toBeNull()
    const first = await told($)
    expect(first).toContain('"plan"')
    expect(first).toContain('next tool call')
    // Not at every batch: it is said again a while later, and a few times at most.
    expect(await told($)).toBeNull()
  })

  test('a card with a topic and a time gets no word; a subagent\'s tool calls are not the chat\'s', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'the archer', session_title: 'Game - Units' })
    await $.turn.start({ text: 'the archer', turnId: 't1' })
    for (let i = 0; i < 5; i++) expect(await told($, { agent_id: 'a1b2c3d4e5' })).toBeNull()
    await $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer', names: ['Cut', 'Wire', 'Check'], minutes: 40 })
    await $.tool.call({ tool: TOOL, action: 'plan', stepMinutes: 10 })
    for (let i = 0; i < 12; i++) expect(await told($)).toBeNull()
  })

  test('a worker that reports to the main chat is done, whatever step its card stands on', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    // All three steps done without a word to the card, then the report.
    await $.session.send({ to: 'Game - Main', text: 'The archer is merged and pushed.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(fileOf(w)?.task).toBeNull()
  })

  test('a report in a turn that was cut short does not clear the card at the end of a later turn', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 2, 3, 30), at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: nearly there.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, reason: 'aborted', isAborted: true, turnId: 't1' })
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
    await $.turn.start({ text: 'one more thing', turnId: 't2' })
    expect(fileOf(w)?.task?.isReported).toBe(false)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
  })

  test('a message to another worker is no report: the card stays as it is, also during the turn', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 2, 3, 30), at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    await $.session.send({ to: 'local_27aa2346-7fd6-4aa8', text: 'B92 is ready to merge.', ...BY_MODEL })
    expect(fileOf(w)?.task?.isReported).toBe(false)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
    // The same by its first word, also to the main chat: a report by address that names nobody.
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.session.send({ to: 'local_84e3310d-5c34', text: 'Report from Game - Units: the archer is merged.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(fileOf(w)?.task).toBeNull()
  })

  test('a card left from the request before is asked about once, when the new request has not touched it', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: { ...task('Skeleton Archer', 2, 5, 30), stepLeft: 5 * MIN }, at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'now the mage', turnId: 't1' })
    expect(await told($)).toBeNull()
    const asked = await told($)
    expect(asked).toContain('"Skeleton Archer"')
    for (let i = 0; i < 12; i++) expect(await told($)).toBeNull()
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    // A request in which the chat keeps its card says nothing.
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.tool.call({ tool: TOOL, action: 'plan', minutes: 25 })
    for (let i = 0; i < 4; i++) expect(await told($)).toBeNull()
  })

  test('a note to the main chat in the middle of a task leaves the card on the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 2, 5, 30), at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Question from Game - Units: sheet A or B?', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
    expect(fileOf(w)?.task?.isReported).toBe(false)
  })
})

describe('a large worker is compacted after it reported its task', () => {
  const HAND = 'Another Claude session sent a message:\n<cross-session-message from="local_84e3" name="Game - Main">\nTask from Game - Main: the knight\n</cross-session-message>'
  const PEER = { origin: { kind: 'peer', name: 'Game - Main' } } as const
  const FOLLOWS = HAND.replace('Task from Game - Main:', 'Task from Game - Main (more follows):')
  const REPORT = { to: 'Game - Main', text: 'Report from Game - Units: it is in.', ...BY_MODEL } as const

  test('a large chat is compacted when the turn in which it reported its task has ended, and told what to keep', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    // The task arrives: nothing is compacted under the turn that starts.
    const entered = await $.prompt.submit({ text: HAND, ...PEER } as never)
    expect(entered.text).toBe(HAND)
    expect(w.compactions).toEqual([])
    await $.turn.start({ text: HAND, turnId: 't1' })
    await $.tool.call({ tool: TOOL, action: 'plan', text: 'The knight', names: ['Draw', 'Wire'], minutes: 20 })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: the knight is merged.', ...BY_MODEL })
    expect(w.compactions).toEqual([])
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions.length).toBe(1)
    expect(w.compactions[0]).toContain('Game - Units')
    expect(w.compactions[0]).toContain('not built yet')
    expect(w.compactions[0]).toContain('"1 yes, 2 no"')
    // One line says what happened, and the chat's file keeps the sizes; its card is cleared as after any report.
    expect(w.toasts).toEqual(['Compacted after the reported task: 400,000 tokens before, 90,000 after.'])
    expect([fileOf(w)?.task, fileOf(w)?.compacted?.before, fileOf(w)?.compacted?.after]).toEqual([null, 400_000, 90_000])
  })

  test('a compaction that something else refuses leaves the chat as it is and says why', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    w.refusesCompact = true
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: done.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.toasts).toEqual(['Not compacted after this task: another hook keeps the conversation'])
    expect(fileOf(w)?.compacted).toBeUndefined()
    // B227: the card says why, for the board and the main chat.
    expect(fileOf(w)?.compactNote?.why).toBe('another hook keeps the conversation')
  })

  test('B227: a question to the person at the end of the report does not keep a large chat from being compacted', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: done.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1', answer: 'Done.\n\n> **For you**\n> 1. **Answer:** sheet A or B? I advise A.' } as never)
    expect(w.compactions.length).toBe(1)
    expect(fileOf(w)?.compactNote).toBeUndefined()
  })

  test('B227: where the engine compacts only by /compact, the chat runs /compact once it is idle, and its card keeps the sizes', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    w.isHeadless = true
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: done.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    // The command is queued; once it has run, the card holds the sizes and no note.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(w.commanded.length).toBe(1)
    expect(w.commanded[0]).toContain('Game - Units')
    expect(w.toasts).toEqual(['Compacted after the reported task: 400,000 tokens before, 90,000 after.'])
    expect([fileOf(w)?.compacted?.before, fileOf(w)?.compacted?.after, fileOf(w)?.compactNote]).toEqual([400_000, 90_000, undefined])
  })

  test('B227: a small chat is left as it is without a word on the screen, and its card says why', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 40_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: done.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
    expect(w.toasts).toEqual([])
    expect(fileOf(w)?.compactNote?.why).toBe('it is small enough')
  })

  test('not after a note or a question to the main chat, and not after a turn that was cut short', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Question from Game - Units: which knight?', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: done.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't2', isAborted: true, reason: 'aborted' })
    expect(w.compactions).toEqual([])
  })

  test('the main chat is never compacted this way, whatever it sends', async ($, on) => {
    mock.clock(on)
    const w = world('main', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Main' })
    expect(fileOf(w)?.role).toBe('main')
    w.tokens = 400_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'Game - Units', text: 'Report of the day: the knight is yours.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
  })

  test('not when the hand-over said that more of the same work follows, and not after a turn without a report', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.prompt.submit({ text: HAND.replace('Task from Game - Main:', 'Task from Game - Main (more follows):'), ...PEER } as never)
    await $.turn.start({ text: 'part one', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: part one is in.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
    // The next hand-over says nothing of the kind, but its turn ends without a report.
    await $.prompt.submit({ text: HAND, ...PEER } as never)
    await $.turn.start({ text: 'part two', turnId: 't2' })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(w.compactions).toEqual([])
  })

  test('a hand-over that comes in while a turn runs counts once that turn has ended', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.prompt.submit({ text: FOLLOWS, ...PEER } as never)
    await $.turn.start({ text: 'part one', turnId: 't1' })
    await $.session.send(REPORT)
    // The main chat is quick: part two is there before the turn has ended.
    await $.prompt.submit({ text: HAND, ...PEER, turnId: 't1' } as never)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
    await $.turn.start({ text: 'part two', turnId: 't2' })
    await $.session.send(REPORT)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(w.compactions.length).toBe(1)
  })

  test('"(more follows)" holds for one report: a task the person types after it ends in a compaction', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.prompt.submit({ text: FOLLOWS, ...PEER } as never)
    await $.turn.start({ text: 'part one', turnId: 't1' })
    await $.session.send(REPORT)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
    await $.prompt.submit({ text: 'and now the sheet', ...ASKED } as never)
    await $.turn.start({ text: 'and now the sheet', turnId: 't2' })
    await $.session.send(REPORT)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(w.compactions.length).toBe(1)
  })

  test('a message to another worker is no report, whatever its first word: the card stays and nothing is compacted', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed({ support: { name: 'Support', role: 'worker', state: 'waiting', task: null, at: 0 } }))
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: TOOL, action: 'plan', text: 'The knight', names: ['Draw', 'Wire'], minutes: 20 })
    await $.session.send({ to: 'Game - Support', text: 'Report on the sheet: it is ready to merge.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect([w.compactions, fileOf(w)?.task?.text]).toEqual([[], 'The knight'])
  })

  test('not a second time for the same turn', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    // B227: a question to the person in the answer no longer keeps it (it did until 0.8.0).
    await $.turn.start({ text: 'A', turnId: 't2' })
    await $.session.send(REPORT)
    await $.turn.complete({ ...ENDED, answer: 'The knight is in.\n\n> **For you**\n> 1. **Answer:** sheet A or B? I advise A.', turnId: 't2' })
    expect(w.compactions.length).toBe(1)
    // The same turn ends once more, and the size the engine names is still the old one.
    w.tokens = 400_000
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(w.compactions.length).toBe(1)
  })

  test('a small chat is left as it is', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 100_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: done.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
  })
})

describe('B297: the work tool asks the worker board', () => {
  const BOARD = 'C:/Web/project/.claude/board.json'
  const KEY = 'ab'.repeat(32)
  const board = JSON.stringify({ url: 'http://127.0.0.1:4311', key: KEY, startedAt: 1 })
  const WORK = 'mcp__folder-branches__work'

  test('a call reaches the board with the chat, its session and the fields, and answers the text of the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const next = await $.tool.call({ tool: WORK, action: 'next' })
    expect(next.result).toBe('Yours, Units:')
    expect(w.worked).toEqual(['{"action":"next","chat":"Units","session":"units"}'])
    // What the chat gives as its name or session is never sent: the mod says who asks.
    await $.tool.call({ tool: WORK, action: 'note', to: 'main', text: 'Found a bug', chat: 'Main', session: 'x', colour: 'red' })
    expect(JSON.parse(w.worked[1] ?? '{}')).toEqual({ action: 'note', to: 'main', text: 'Found a bug', chat: 'Units', session: 'units' })
    // A refusal is the board's own line.
    w.workAnswer = { status: 409, text: 'B12: Board holds it (in progress).\n' }
    expect((await $.tool.call({ tool: WORK, action: 'take', id: 'B12' })).result).toBe('B12: Board holds it (in progress).')
    // A subagent reads, and changes nothing.
    expect((await $.tool.call({ tool: WORK, action: 'take', id: 'B12', agentId: 'a1' })).result).toBe("Only the chat's main conversation changes the work: nothing was changed.")
    expect(w.worked.length).toBe(3)
  })

  test('a board that is down answers with one line and no throw', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.up = []
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toBe('The worker board did not answer: nothing was recorded. Try again in a moment.')
  })

  test('take writes the card from the title of the step, and step moves it', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B12', title: 'Give the golem its art', text: 'Id: B12' }) }
    expect((await $.tool.call({ tool: WORK, action: 'take', id: 'B12' })).result).toBe('Id: B12')
    expect(fileOf(w)?.task?.text).toBe('B12 Give the golem its art')
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12: step 1/3.' }) }
    await $.tool.call({ tool: WORK, action: 'step', id: 'B12', names: ['Read', 'Draw', 'Test'], minutes: 40 })
    expect([fileOf(w)?.task?.step, fileOf(w)?.task?.steps]).toEqual([1, 3])
    await $.tool.call({ tool: WORK, action: 'step', id: 'B12', step: 2 })
    expect(fileOf(w)?.task?.step).toBe(2)
    // A step the board refused leaves the card as it is.
    w.workAnswer = { status: 409, text: 'B12 is not in progress for Units: take it first.' }
    expect((await $.tool.call({ tool: WORK, action: 'step', id: 'B12', step: 3 })).result).toBe('B12 is not in progress for Units: take it first.')
    expect(fileOf(w)?.task?.step).toBe(2)
  })
})

describe('B298: the person\'s words are filed on the worker board as instructions', () => {
  const BOARD = 'C:/Web/project/.claude/board.json'
  const board = JSON.stringify({ url: 'http://127.0.0.1:4311', key: 'ab'.repeat(32), startedAt: 1 })
  const BATCH = { hook_event_name: 'PostToolBatch', session_id: 'units', transcript_path: 'x', cwd: ROOT, tool_calls: [] } as const
  const FILED = JSON.stringify({ id: 'I17', text: 'Recorded as I17', open: [{ id: 'I15', turns: 2 }, { id: 'I17', turns: 0 }] })
  type Batches = { classic: { PostToolBatch: (e: never) => Promise<{ additionalContext?: string[] }> } }
  const told = async ($: Batches): Promise<string> => ((await $.classic.PostToolBatch(BATCH as never)).additionalContext ?? []).join('\n')
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)

  test('a prompt typed in the chat is filed before the turn sees it; a line the board typed and a slash command are not', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.workAnswer = { status: 200, text: FILED }
    await $.prompt.submit({ text: 'Make the strip blue', ...ASKED } as never)
    expect(sent(w)).toEqual([{ action: 'instruction', text: 'Make the strip blue', chat: 'Units', session: 'units' }])
    // The prompt itself goes on unchanged.
    expect(w.typedIn).toEqual(['composer:framed:Make the strip blue'])
    await $.prompt.submit({ text: 'Queue the menu [I18]\n(typed on the worker board, 11:05)', origin: { kind: 'plugin', asUser: true } } as never)
    await $.prompt.submit({ text: '/compact', ...ASKED } as never)
    expect(w.worked.length).toBe(1)
    // The composed prompt names the open ones; the first batch of the turn names the new id and the ones left open.
    const composed = await $.prompt.compose(COMPOSE)
    expect(composed.sections.find(section => section.id === 'folder-branches:instructions')?.text ?? '').toContain('Open instructions: I15 (2 turns), I17 (new).')
    await $.turn.start({ text: 'Make the strip blue', turnId: 't1' })
    expect(await told($)).toContain('Recorded as I17; close it with work close I17 --as "what came of it" once it is done. Still open from earlier turns: I15 (missed 2 turns).')
    expect(await told($)).not.toContain('Recorded as')
  })

  test('a prompt held during a turn is filed on submit, and the next batch names it', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await told($)
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'I18', open: [{ id: 'I18', turns: 0 }] }) }
    await $.prompt.submit({ text: 'And the menu too', ...ASKED, turnId: 't1' } as never)
    expect(sent(w).map(one => one.action)).toEqual(['instruction'])
    expect(await told($)).toContain('Recorded as I18;')
  })

  test('the end of a turn that answered is told once, with when the turn started; a subagent\'s end is not', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await clock.advance(5000)
    const started = await clock.now()
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(60_000)
    await $.turn.complete({ ...ENDED, turnId: 's1', agentId: 'a1' })
    expect(w.worked).toEqual([])
    w.workAnswer = { status: 200, text: JSON.stringify({ missed: ['I15'], open: [{ id: 'I15', turns: 3 }] }) }
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(sent(w)).toEqual([{ action: 'turn-ended', since: started, chat: 'Units', session: 'units' }])
    // The next request names it as missed.
    const composed = await $.prompt.compose(COMPOSE)
    expect(composed.sections.find(section => section.id === 'folder-branches:instructions')?.text ?? '').toContain('I15 (3 turns)')
  })

  test('while the board\'s store is not the truth, the refusal is swallowed and nothing changes for the chat', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.workAnswer = { status: 409, text: 'The store is not the truth yet: the cutover has not run' }
    await $.prompt.submit({ text: 'Make the strip blue', ...ASKED } as never)
    expect(w.typedIn).toEqual(['composer:framed:Make the strip blue'])
    await $.turn.start({ text: 'Make the strip blue', turnId: 't1' })
    expect(await told($)).toBe('')
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    const composed = await $.prompt.compose(COMPOSE)
    expect(composed.sections.some(section => section.id === 'folder-branches:instructions')).toBe(false)
    expect(w.toasts).toEqual([])
  })
})
