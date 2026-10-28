import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import type { ChatFile, ChatTask } from '../types'
import { LEFT_TEXT, chatText, parseChat } from './chats'
import { forYouItems } from './foryou'
import { MOD_VERSION, WORK_ACTIONS } from './board'

const TOOL = 'mcp__folder-branches__chat'
const ROOT = 'D:\\Work\\project'
const CHATS = 'D:/Work/project/.claude/chats'
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
  /** B463: the board's next answers to a take, before it hands out what waits (a refusal of the chat's name). */
  takeAnswers: { status: number; text: string }[]
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
  /** B299: what the person picks in the app's question form, by question; the board's answers to the work tool, in turn. */
  formAnswers: Record<string, string>
  workAnswers: { status: number; text: string }[]
  /** Review of B298: what the app's form answers besides its choices, whether it was closed unanswered, whether the
   * board hangs, and what went in beside each prompt for the model. */
  formResponse: string | null
  formCloses: boolean
  hangs: boolean
  /** B566: the board's take never answers while this is set. */
  takeHangs: boolean
  contexts: string[][]
  /** B319: the folder the session was opened in (the project's, unless set), and where each work call went, with its key. */
  root?: string
  workedAt: string[]
  /** Pause 2: what the board answers the mod's pause-state (null: it refuses, as an old board does), and how often it was asked. */
  pauseAnswer: Record<string, unknown> | null
  pauseReads: number
  /** The description each tool was registered with, by its name. */
  descriptions: Record<string, string>
  /** B412: each work call's request id (its X-Work-Request header); the next calls whose answer is cut off, by why; an
   * answer the board holds until the test lets it go. */
  requests: string[]
  cuts: string[]
  held: Promise<void> | null
  /** The review of Pause 2: the mod's own store ($.store), across its processes. */
  stored: Record<string, unknown>
  /** Clear after each step: the board's answer to a work call by its action, before any other; one action held until a promise. */
  byAction: Record<string, { status: number; text: string }>
  holdAction: { action: string; until: Promise<void> } | null
  /** Clear after each step: what went out, in order: each work call's action, and each /clear. */
  sequence: string[]
  /** Review 3: a /compact the test holds until it lets it go; every file the mod wrote, in order. */
  holdCompact: Promise<void> | null
  writes: string[]
  /** The supervisor: the version each call to the board said in its X-Workers-Mod header. */
  modHeaders: string[]
  /** Redesign Part 1: each report call's body (POST /api/bridge/report), in order; a form the person answers once this is let go. */
  reports: string[]
  formHold: Promise<void> | null
  /** How many reports had gone out each time a /clear ran. */
  reportsAtClear: number[]
  /** 2026-10-28: each question to the board's whoami (POST /api/bridge/whoami): its body; what the board answers (the
   * name, role and card it gives the session; none: a session of no chat), or an answer that is no answer. */
  whoamis: string[]
  whoami: Record<string, unknown>
  whoamiAnswer: { status: number; text: string } | null
  /** The headers each whoami call carried. */
  whoamiHeaders: Record<string, string>[]
  /** True when the board holds a whoami call and never answers it. */
  whoamiHangs: boolean
}

/** The review of chat-reports: a report as the board reads what it says, without its order (`run`, `seq`). */
function said(report: Record<string, unknown>): Record<string, unknown> {
  const { run: _run, seq: _seq, ...rest } = report
  return rest
}
/** A body the mod sent, its report without its order. */
function saidBody(text: string): Record<string, unknown> {
  const body = JSON.parse(text) as Record<string, unknown>
  return { ...body, report: said(body.report as Record<string, unknown>) }
}

/** Pause 2: the board's pause-state answer while nobody paused. */
const RUNNING = { text: "The board's pause state: running.", state: 'running', since: null, forChat: { holds: [], mustStop: false }, resumeList: [] }

/** B412: lets the mod's waiting calls run to their end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

function world(id: string, files: Record<string, string> = {}): World {
  return { id, files, agents: [], tools: [], opened: [], sent: [], whileAsked: null, waiting: [], takeAnswers: [], fetched: [], typedIn: [], reported: [], refusesTyping: false, up: null, spawned: [], comesUp: true, tokens: 50_000, refusesCompact: false, isHeadless: false, commanded: [], compactions: [], toasts: [], worked: [], workAnswer: { status: 200, text: '{"text":"Yours, Units:"}' }, formAnswers: {}, workAnswers: [], formResponse: null, formCloses: false, hangs: false, takeHangs: false, contexts: [], workedAt: [], pauseAnswer: RUNNING, pauseReads: 0, descriptions: {}, stored: {}, requests: [], cuts: [], held: null, byAction: {}, holdAction: null, sequence: [], holdCompact: null, writes: [], modHeaders: [], reports: [], formHold: null, reportsAtClear: [], whoamis: [], whoami: { name: null, role: null, card: null }, whoamiAnswer: null, whoamiHeaders: [], whoamiHangs: false }
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
/**
 * A chat's card as the mod wrote it. B570: every write names the mod's version (`mod`, checked here and left out, so the
 * cards below read as before; the test 'B570: ...' looks at it).
 */
function fileOf(w: World, id = w.id): ChatFile | null {
  const text = w.files[`${CHATS}/${id}.json`]
  const card = text === undefined ? null : parseChat(text)
  if (card === null || card.mod === undefined) return card
  if (card.mod !== MOD_VERSION) throw new Error(`the card names mod ${card.mod}, not ${MOD_VERSION}`)
  const { mod: _mod, ...rest } = card
  return rest
}

/** The engine beneath the mod: a folder of files, a clock the test moves, and the session's own answers. */
function stand(on: On, w: World): void {
  on('session.root', () => ({ value: w.root ?? ROOT }))
  on('session.id', () => ({ value: w.id }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => {
    w.tools.push(`${e.name}:${String(e.isDeferred)}`)
    w.descriptions[e.name] = e.description

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
  on('command.run', { command: 'clear' }, (_$, e) => {
    w.commanded.push(`/clear by ${e.origin.kind}${e.origin.kind === 'plugin' ? ` ${e.origin.name}` : ''}`)
    w.sequence.push('/clear')
    w.reportsAtClear.push(w.reports.length)
    return { text: '' }
  })
  on('command.run', { command: 'compact' }, async (_$, e) => {
    w.commanded.push(e.args)
    if (w.holdCompact !== null) await w.holdCompact
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
  on('classic.Stop', () => ({}))
  on('session.send', (_$, e) => {
    w.sent.push(e.origin.kind)

    return { isDelivered: true as const }
  })
  // The one tool beneath the mod: a question to the person, answered at once.
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    w.whileAsked = fileOf(w)
    if (w.formHold !== null) await w.formHold

    if (w.formCloses) throw new Error('the person closed the form')

    return { result: { answers: w.formAnswers, ...(w.formResponse === null ? {} : { response: w.formResponse }) } }
  })
  on('fs.exists', (_$, e) => {
    const path = slashed(e.path)

    return { value: Object.keys(w.files).some(known => known === path || known.startsWith(`${path}/`)) }
  })
  on('store.get', (_$, e) => ({ value: w.stored[e.key] }))
  on('store.set', (_$, e) => {
    w.stored[e.key] = e.value

    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = w.files[slashed(e.path)]

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', (_$, e) => {
    w.writes.push(slashed(e.path))
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
    if (e.url.includes('/api/bridge/')) w.modHeaders.push(e.init?.headers?.['X-Workers-Mod'] ?? '')
    if (e.url.endsWith('/api/bridge/work') && /"action":"pause-state"/.test(e.init?.body ?? '')) {
      // Pause 2: the mod's own reading of the pause, apart from the work calls the tests count.
      w.pauseReads += 1
      if (w.hangs) return new Promise<never>(() => {})
      return { value: w.pauseAnswer === null ? { status: 400, ok: false, headers: {}, text: 'Unknown action.' } : { status: 200, ok: true, headers: {}, text: JSON.stringify(w.pauseAnswer) } }
    }
    if (e.url.endsWith('/api/bridge/work')) {
      const action = String((JSON.parse(e.init?.body ?? '{}') as { action?: unknown }).action)
      w.sequence.push(action)
      const own = w.byAction[action]
      if (own !== undefined) {
        w.worked.push(e.init?.body ?? '')
        w.requests.push(e.init?.headers?.['X-Work-Request'] ?? '')
        const cut = w.cuts.shift()
        if (cut !== undefined) return { deny: cut }
        const value = { status: own.status, ok: own.status === 200, headers: {}, text: own.text }
        const hold = w.holdAction?.action === action ? w.holdAction.until : null
        return hold === null ? { value } : hold.then(() => ({ value }))
      }
      w.worked.push(e.init?.body ?? '')
      w.workedAt.push(`${e.url} ${e.init?.headers?.['X-Board-Key'] ?? ''}`)
      w.requests.push(e.init?.headers?.['X-Work-Request'] ?? '')
      if (w.hangs) return new Promise<never>(() => {})
      const cut = w.cuts.shift()
      if (cut !== undefined) return { deny: cut }
      const answer = w.workAnswers.shift() ?? w.workAnswer
      const value = { status: answer.status, ok: answer.status === 200, headers: {}, text: answer.text }
      if (w.held === null) return { value }
      const held = w.held
      w.held = null

      return held.then(() => ({ value }))
    }
    // 2026-10-28: the board names a session; kept apart from the takes and work calls the tests count.
    if (e.url.endsWith('/api/bridge/whoami')) {
      w.whoamis.push(e.init?.body ?? '')
      w.whoamiHeaders.push({ ...(e.init?.headers ?? {}) })
      if (w.whoamiHangs) return new Promise<never>(() => {})
      const answer = w.whoamiAnswer ?? { status: 200, text: JSON.stringify(w.whoami) }

      return { value: { status: answer.status, ok: answer.status === 200, headers: {}, text: answer.text } }
    }
    if (e.url.endsWith('/api/bridge/report')) {
      w.reports.push(e.init?.body ?? '')

      return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
    }
    if (e.url.endsWith('/api/bridge/typed')) {
      w.reported.push(e.init?.body ?? '')

      return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
    }
    w.fetched.push({ url: e.url, key: e.init?.headers?.['X-Board-Key'] ?? '', body: e.init?.body ?? '' })
    if (w.takeHangs && e.url.endsWith('/api/bridge/take')) return new Promise<never>(() => {})
    const refused = e.url.endsWith('/api/bridge/take') ? w.takeAnswers.shift() : undefined
    if (refused !== undefined) return { value: { status: refused.status, ok: refused.status === 200, headers: {}, text: refused.text } }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ messages: w.waiting.splice(0) }) } }
  })
  on('prompt.submit', (_$, e) => {
    if (w.refusesTyping) return { drop: 'no prompt is taken now' }
    w.typedIn.push(`${e.origin.kind}:${e.origin.kind === 'plugin' && e.origin.asUser === true ? 'as the person' : 'framed'}:${e.text}`)
    w.contexts.push([...(e.context ?? [])])

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
/** B297: where the worker board says it is, with its key, and the work tool the mod registers. */
const BOARD = 'D:/Work/project/.claude/board.json'
const board = JSON.stringify({ url: 'http://127.0.0.1:4311', key: 'ab'.repeat(32), startedAt: 1 })
const WORK = 'mcp__folder-branches__work'

/** B301: the chat reports its step with the work tool, and the board takes it, naming the chat's next step (`more`) or none. */
async function reported($: { tool: { call(input: never): Promise<unknown> } }, w: World, more: string | null = null): Promise<void> {
  w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12 is in review: the board checks it.', more }) }
  await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
}
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

  test('the task clears by itself when the chat reports its step (work report) and its turn ends', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 5, 5, 3), at: 0 } }), [BOARD]: board })
    w.agents = [{ id: 'a1b2-judge', name: 'judge' }]
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'finish', turnId: 't1' })

    // A message is no report: to one of its own agents, or (B301) to the main chat.
    await $.session.send({ to: 'judge', text: 'look again', ...BY_MODEL })
    await $.session.send({ to: 'a1b2-judge [3fa9c1]', text: 'and again', ...BY_MODEL })
    // Nor is one to an agent that finished and is listed no more: its id says what it is.
    await $.session.send({ to: 'a99695cdbace47f46', text: 'once more', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 's9', agentId: 'helper-7' })
    await $.session.send({ to: 'helper-7', text: 'thanks', ...BY_MODEL })
    await $.session.send({ to: 'Game - Main', text: 'The archer is merged.', ...BY_MODEL })
    expect(fileOf(w)?.task?.isReported).toBe(false)
    await reported($, w)
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

  test('after a /clear the chat goes on under its new session id with its card, and its old file names the new one', async ($, on) => {
    mock.clock(on, { now: 5000 })
    const w = world('s1', { [`${CHATS}/list.json`]: '{}\n', [`${CHATS}/s1.json`]: chatText({ ...ARCHER, state: 'waiting' }) })
    stand(on, w)
    await $.session.start(START)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    w.id = 's2'
    // No start of the new conversation was heard: its first turn moves the card.
    await $.turn.start({ text: 'next', turnId: 't1' })
    expect(fileOf(w, 's1')).toBeNull()
    expect(JSON.parse(w.files[`${CHATS}/s1.json`] ?? '{}')).toEqual({ movedTo: 's2', at: 5000 })
    expect(fileOf(w, 's2')).toEqual({ name: 'Units', role: 'worker', state: 'working', task: ARCHER.task, at: 5000 })
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('● Units  Skeleton Archer · 2 of 5 · ~20 min')
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
  const BOARD = 'D:/Work/project/.claude/board.json'
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
    // Redesign Part 1: every take carries the chat's report of its turn state (idle since the session started).
    expect(w.fetched[0]).toEqual({ url: 'http://127.0.0.1:4311/api/bridge/take', key: KEY, body: '{"chat":"Units","session":"units","report":{"state":"idle","since":0,"background":false,"run":0,"seq":1}}' })
    expect(w.reported).toEqual(['{"chat":"Units","session":"units","typed":["m1"],"failed":[]}'])
    expect(w.typedIn).toEqual(['plugin:as the person:(answered on the worker board, 16:02) B14 "The walk": approved. Tick this step in the backlog.'])

    // A board that hands the same message out again does not get it typed twice.
    w.waiting.push({ id: 'm1', text: 'again' }, { id: 'm2', text: 'Sheet B' })
    await clock.advance(5000)
    await settle()
    expect(w.typedIn.map(line => line.split(':').pop())).toEqual([' approved. Tick this step in the backlog.', 'Sheet B'])
  })

  test('B738: a chat the board names as not running reads "Not running" in the Workers pane; a board that does not answer leaves the files\' words', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const w = world('units', { ...listed({
      units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 },
      cleanup: { name: 'Cleanup', role: 'worker', state: 'waiting', task: null, at: 0 },
    }), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'desktop', ...PANE })
    const cleanup = async (): Promise<string | undefined> => {
      for (let i = 0; i < 10; i++) await settle()
      return (await ui.find(lineOf('Cleanup')))?.text
    }
    expect(await cleanup()).toBe('○ Cleanup  free')
    w.takeAnswers.push({ status: 200, text: JSON.stringify({ messages: [], off: ['Cleanup'] }) })
    await clock.advance(5000)
    expect(await cleanup()).toBe('○ Cleanup  Not running')
    // The board went down: its last verdict is not kept.
    w.takeAnswers.push({ status: 503, text: 'The board restarts: try again in a moment.' })
    await clock.advance(5000)
    expect(await cleanup()).toBe('○ Cleanup  free')
  })

  test('B566 (X21): a take the board never answers gives up after 15 s; the next take hands the chat its word', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.takeHangs = true
    await clock.advance(5000)
    await settle()
    const asked = w.fetched.length
    expect(asked).toBeGreaterThan(0)
    // While it hangs no second take goes out; 15 s on the take is given up.
    await clock.advance(5000)
    await settle()
    expect(w.fetched.length).toBe(asked)
    w.takeHangs = false
    w.waiting.push({ id: 'm1', text: 'Sheet B' })
    await clock.advance(15000)
    await settle()
    await clock.advance(5000)
    await settle()
    expect(w.typedIn).toEqual(['plugin:as the person:Sheet B'])
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
    // B532: a word too long is refused for good, one a hook dropped failed; each with why.
    const said = w.reported.map(body => JSON.parse(body))
    expect(said.flatMap(body => body.failed ?? [])).toEqual(['m1'])
    expect(said.flatMap(body => body.refused ?? [])).toEqual(['m2'])
    expect(Object.assign({}, ...said.map(body => body.why))).toEqual({ m1: 'a hook dropped it: no prompt is taken now', m2: 'too long: 5000 > 3000 characters' })
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
  const LAUNCH = 'D:/Work/project/.claude/launch.json'
  const launch = JSON.stringify({ configurations: [{ name: 'worker-board', runtimeExecutable: 'node', runtimeArgs: ['D:/Work/project/worker-board/server.mjs'], port: 4310 }] })
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
    expect(w.spawned).toEqual(['node D:/Work/project/worker-board/server.mjs'])
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

  test('B301: a worker whose step the board took as reported (work report) is done, whatever step its card stands on', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 } }), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    // All three steps done without a word to the card, then the report.
    await reported($, w)
    expect(fileOf(w)?.task?.isReported).toBe(true)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(fileOf(w)?.task).toBeNull()
  })

  test('B301: a report message to the main chat ends nothing; nor does a report the board refused', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 } }), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Report from Game - Units: the archer is merged and pushed.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
    // Review: whatever its words, a message to another chat is no report: the card says the chat waits for that chat.
    expect(fileOf(w)?.task?.asked).toBe(true)
    await $.turn.start({ text: 'go on', turnId: 't2' })
    w.workAnswer = { status: 409, text: 'B12 waits on Q4: withdraw it (work withdraw Q4) or wait for the answer.' }
    expect((await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'the archer' })).result).toBe('B12 waits on Q4: withdraw it (work withdraw Q4) or wait for the answer. (HTTP 409)')
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect([fileOf(w)?.task?.text, fileOf(w)?.task?.isReported]).toEqual(['Skeleton Archer', false])
  })

  test('a report in a turn that was cut short does not clear the card at the end of a later turn', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 2, 3, 30), at: 0 } }), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    await reported($, w)
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
    // B301: also one that says it is a report, to an address that names nobody: a message ends no step.
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.session.send({ to: 'local_84e3310d-5c34', text: 'Report from Game - Units: the archer is merged.', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
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

describe('a large worker is compacted after it reported its step', () => {
  const HAND = 'Another Claude session sent a message:\n<cross-session-message from="local_84e3" name="Game - Main">\nTask from Game - Main: the knight\n</cross-session-message>'
  const PEER = { origin: { kind: 'peer', name: 'Game - Main' } } as const
  const REPORT = { to: 'Game - Main', text: 'Report from Game - Units: it is in.', ...BY_MODEL } as const

  test('a large chat is compacted when the turn in which it reported its task has ended, and told what to keep', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
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
    await reported($, w)
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
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    w.refusesCompact = true
    await $.turn.start({ text: 'go', turnId: 't1' })
    await reported($, w)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.toasts).toEqual(['Not compacted after this task: another hook keeps the conversation'])
    expect(fileOf(w)?.compacted).toBeUndefined()
    // B227: the card says why, for the board and the main chat.
    expect(fileOf(w)?.compactNote?.why).toBe('another hook keeps the conversation')
  })

  test('B227: a question to the person at the end of the report does not keep a large chat from being compacted', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await reported($, w)
    await $.turn.complete({ ...ENDED, turnId: 't1', answer: 'Done.\n\n> **For you**\n> 1. **Answer:** sheet A or B? I advise A.' } as never)
    expect(w.compactions.length).toBe(1)
    expect(fileOf(w)?.compactNote).toBeUndefined()
  })

  test('B227: where the engine compacts only by /compact, the chat runs /compact once it is idle, and its card keeps the sizes', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    w.isHeadless = true
    await $.turn.start({ text: 'go', turnId: 't1' })
    await reported($, w)
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
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 40_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await reported($, w)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
    expect(w.toasts).toEqual([])
    expect(fileOf(w)?.compactNote?.why).toBe('it is small enough')
  })

  test('not after a note or a question to the main chat, and not after a turn that was cut short', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'Game - Main', text: 'Question from Game - Units: which knight?', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await reported($, w)
    await $.turn.complete({ ...ENDED, turnId: 't2', isAborted: true, reason: 'aborted' })
    expect(w.compactions).toEqual([])
  })

  test('the main chat is compacted while it rests above the threshold, with what its role needs, once per turn', async ($, on) => {
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
    expect(w.compactions.length).toBe(1)
    expect(w.compactions[0]).toContain('the main chat of a project')
    expect(w.toasts).toEqual(['Compacted while it rests: 400,000 tokens before, 90,000 after.'])
    // The same turn ends once more: nothing again.
    w.tokens = 400_000
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions.length).toBe(1)
  })

  test('B301: not when the board names the next step of the chat in its answer to the report, and not after a turn without a report', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.turn.start({ text: 'part one', turnId: 't1' })
    await reported($, w, 'B13')
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
    // A hand-over message says nothing to it, and a turn that ends without a report compacts nothing.
    await $.prompt.submit({ text: HAND, ...PEER } as never)
    await $.turn.start({ text: 'part two', turnId: 't2' })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(w.compactions).toEqual([])
  })

  test('B301: the next step holds for one report: a later report without one ends in a compaction', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    await $.turn.start({ text: 'part one', turnId: 't1' })
    await reported($, w, 'B13')
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
    await $.turn.start({ text: 'part two', turnId: 't2' })
    await reported($, w)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(w.compactions.length).toBe(1)
    // A report message to the main chat compacts nothing: it is no report.
    await $.turn.start({ text: 'part three', turnId: 't3' })
    await $.session.send(REPORT)
    await $.turn.complete({ ...ENDED, turnId: 't3' })
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
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 400_000
    // B227: a question to the person in the answer no longer keeps it (it did until 0.8.0).
    await $.turn.start({ text: 'A', turnId: 't2' })
    await reported($, w)
    await $.turn.complete({ ...ENDED, answer: 'The knight is in.\n\n> **For you**\n> 1. **Answer:** sheet A or B? I advise A.', turnId: 't2' })
    expect(w.compactions.length).toBe(1)
    // The same turn ends once more, and the size the engine names is still the old one.
    w.tokens = 400_000
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(w.compactions.length).toBe(1)
  })

  test('a small chat is left as it is', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.tokens = 100_000
    await $.turn.start({ text: 'go', turnId: 't1' })
    await reported($, w)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
  })
})

describe('B297: the work tool asks the worker board', () => {
  const BOARD = 'D:/Work/project/.claude/board.json'
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
    expect((await $.tool.call({ tool: WORK, action: 'take', id: 'B12' })).result).toBe('B12: Board holds it (in progress). (HTTP 409)')
    // A subagent reads, and changes nothing.
    expect((await $.tool.call({ tool: WORK, action: 'take', id: 'B12', agentId: 'a1' })).result).toBe("Only the chat's main conversation changes the work: nothing was changed.")
    expect(w.worked.length).toBe(3)
  })

  test('B412: an answer cut off is asked again with the same request id; the board\u2019s answer is the tool\u2019s', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.worked = []
    w.requests = []
    w.cuts = ['socket hang up']
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B30', text: 'B30 is made.' }) }
    const made = $.tool.call({ tool: WORK, action: 'new', title: 'Paint the gate' })
    await settle()
    await clock.advance(2000)
    expect((await made).result).toBe('B30 is made.')
    expect(w.worked.length).toBe(2)
    expect(w.requests[0]).toMatch(/^units-\d+-\d+$/)
    expect(w.requests[1]).toBe(w.requests[0])
    // The next call is a call of its own.
    await $.tool.call({ tool: WORK, action: 'next' })
    expect(new Set(w.requests).size).toBe(2)
  })

  test('B412: still no answer after asking again: not known whether it was recorded, never "nothing was recorded"', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.worked = []
    w.cuts = ['socket hang up', 'ECONNREFUSED', 'ECONNREFUSED', 'ECONNREFUSED']
    const reported = $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'done', merged: 'abc1234' })
    for (let i = 0; i < 3; i++) {
      await settle()
      await clock.advance(2000)
    }
    const text = String((await reported).result)
    expect(text).toContain('not known whether it was recorded')
    expect(text).toContain('work next')
    expect(w.worked.length).toBe(4)
    // Cut, then refused: the refusal does not say the first was not recorded.
    w.cuts = ['socket hang up']
    w.workAnswers = [{ status: 403, text: 'Units is no chat of the list.' }]
    const refused = $.tool.call({ tool: WORK, action: 'new', title: 'Paint the gate' })
    await settle()
    await clock.advance(2000)
    const said = String((await refused).result)
    expect(said).toContain('not known whether it was recorded')
    expect(said).toContain('Units is no chat of the list.')
    // A board that took no connection at all has recorded nothing: it says so at once, and is not asked again.
    w.worked = []
    w.cuts = ['ECONNREFUSED']
    expect((await $.tool.call({ tool: WORK, action: 'note', to: 'main', text: 'hello' })).result).toMatch(/^The worker board did not answer \(.*ECONNREFUSED.*\): nothing was recorded\. Try again in a moment\.$/)
    expect(w.worked.length).toBe(1)
  })

  test('Focus 2: the partner keeps its drafts with vibe-draft and how-draft, their fields sent to the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'The board keeps the vibe of G6.' }) }
    const vibe = await $.tool.call({ tool: WORK, action: 'vibe-draft', goal: 'G6', lines: ['hits feel heavy'], picture: 'pictures/hit.png' } as never)
    expect((vibe as { result: string }).result).toBe('The board keeps the vibe of G6.')
    expect(JSON.parse(w.worked[0] ?? '{}')).toEqual({ action: 'vibe-draft', goal: 'G6', lines: ['hits feel heavy'], picture: 'pictures/hit.png', chat: 'Units', session: 'units' })
    await $.tool.call({ tool: WORK, action: 'how-draft', goal: 'G6', parts: ['Hit effects · about 2 h · steps B20'], partnerDecides: ['the colours'], youDecide: ['the sounds'] } as never)
    expect(JSON.parse(w.worked[1] ?? '{}')).toEqual({ action: 'how-draft', goal: 'G6', parts: ['Hit effects · about 2 h · steps B20'], partnerDecides: ['the colours'], youDecide: ['the sounds'], chat: 'Units', session: 'units' })
  })

  test('the supervisor: its chat reads the health summary and files an incident, with its fields sent to the board', async ($, on) => {
    mock.clock(on)
    const w = world('watcher', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'sweep', session_title: 'Game - Watcher' })
    await $.turn.start({ text: 'sweep', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'The board\'s health at 11:00.', changed: false }) }
    expect((await $.tool.call({ tool: WORK, action: 'health' } as never) as { result: string }).result).toBe('The board\'s health at 11:00.')
    expect(JSON.parse(w.worked[0] ?? '{}')).toEqual({ action: 'health', chat: 'Watcher', session: 'watcher' })
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'X4', text: 'X4: opened: Units works with no step for an hour', opened: true }) }
    const filed = await $.tool.call({ tool: WORK, action: 'incident', title: 'Units works with no step for an hour', subject: 'Units', evidence: 'working since 10:00, card empty', rule: 'a worker working with no step for 30 min', key: 'working-without-step Units' } as never)
    expect((filed as { result: string }).result).toBe('X4: opened: Units works with no step for an hour')
    expect(JSON.parse(w.worked[1] ?? '{}')).toEqual({ action: 'incident', title: 'Units works with no step for an hour', subject: 'Units', evidence: 'working since 10:00, card empty', rule: 'a worker working with no step for 30 min', key: 'working-without-step Units', chat: 'Watcher', session: 'watcher' })
    // Both are the tool's actions, and its description says what they are for.
    expect(w.descriptions.work).toContain('"health": the supervisor chat reads the board\'s health summary')
    expect(w.descriptions.work).toContain('"incident" ("title", "subject", "evidence", "rule", "key")')
    // The partner names the step that fixes an incident.
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'X4: fix B490; the board marks it fixed once B490 is done.' }) }
    await $.tool.call({ tool: WORK, action: 'incident-fix', id: 'X4', fix: 'B490' } as never)
    expect(JSON.parse(w.worked[2] ?? '{}')).toEqual({ action: 'incident-fix', id: 'X4', fix: 'B490', chat: 'Watcher', session: 'watcher' })
    expect(w.descriptions.work).toContain('"incident-fix" ("id" X<n>, "fix" B<n>)')
  })

  test('Fix first: new carries priority fix to the board; the queue actions are gone (redesign Part 2)', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'B331 made.' }) }
    await $.tool.call({ tool: WORK, action: 'new', title: 'Fix the lane', activity: 'Board', priority: 'fix' } as never)
    expect(JSON.parse(w.worked[0] ?? '{}')).toEqual({ action: 'new', title: 'Fix the lane', activity: 'Board', priority: 'fix', chat: 'Units', session: 'units' })
    for (const gone of ['queue', 'requeue', 'unqueue']) expect(WORK_ACTIONS.includes(gone)).toBe(false)
    expect(w.descriptions.work).not.toContain('"requeue"')
  })

  test('Focus 3: the partner writes its daily note with decided and needs, sent to the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'N7: the note on G6 for the person.' }) }
    await $.tool.call({ tool: WORK, action: 'note', to: 'you', of: 'G6', decided: ['Damage numbers in yellow'], needs: ['Q3'] } as never)
    expect(JSON.parse(w.worked[0] ?? '{}')).toEqual({ action: 'note', to: 'you', of: 'G6', decided: ['Damage numbers in yellow'], needs: ['Q3'], chat: 'Units', session: 'units' })
  })

  test('Partner answers: the partner answers a routed ask, or hands it to the person, with its fields sent to the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Q12 answered for the person: B. It stands in your daily note N7 with an Undo.' }) }
    expect((await $.tool.call({ tool: WORK, action: 'partner-answer', id: 'Q12', text: 'B', why: 'the advice fits the vibe' } as never)).result).toBe('Q12 answered for the person: B. It stands in your daily note N7 with an Undo.')
    expect(JSON.parse(w.worked[0] ?? '{}')).toEqual({ action: 'partner-answer', id: 'Q12', text: 'B', why: 'the advice fits the vibe', chat: 'Units', session: 'units' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Q13 goes to the person: a new screen.' }) }
    await $.tool.call({ tool: WORK, action: 'escalate', id: 'Q13', why: 'a new screen' } as never)
    expect(JSON.parse(w.worked[1] ?? '{}')).toEqual({ action: 'escalate', id: 'Q13', why: 'a new screen', chat: 'Units', session: 'units' })
  })

  test('a board that is down answers with one line and no throw', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.up = []
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toMatch(/^The worker board did not answer \(.+\): nothing was recorded\. Try again in a moment\.$/)
  })

  test('B445: a board that holds the call is a time-out with its seconds; a refusal shows the HTTP status beside the board\'s words', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    w.hangs = true
    const asked = $.tool.call({ tool: WORK, action: 'next' })
    // The first call and its three repeats each wait 10 s; 2 s between them.
    for (let i = 0; i < 4; i++) {
      await settle()
      await clock.advance(10_000)
      await settle()
      await clock.advance(2_000)
    }
    const said = String((await asked).result)
    expect(said).toContain('not known whether it was recorded')
    expect(said).toContain('(timed out after 10 s)')
    w.hangs = false
    w.workAnswer = { status: 500, text: '' }
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toBe('The worker board refused it (HTTP 500).')
    w.workAnswer = { status: 403, text: 'Only the Workers mod may take.' }
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toBe('Only the Workers mod may take. (HTTP 403)')
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
    expect((await $.tool.call({ tool: WORK, action: 'step', id: 'B12', step: 3 })).result).toBe('B12 is not in progress for Units: take it first. (HTTP 409)')
    expect(fileOf(w)?.task?.step).toBe(2)
  })
})


describe('B298: the person\'s words are filed on the worker board as instructions', () => {
  const BOARD = 'D:/Work/project/.claude/board.json'
  const board = JSON.stringify({ url: 'http://127.0.0.1:4311', key: 'ab'.repeat(32), startedAt: 1 })
  const FILED = JSON.stringify({ id: 'I17', text: 'Recorded as I17', open: [{ id: 'I15', turns: 2 }, { id: 'I17', turns: 0 }] })
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) await Promise.resolve()
  }

  test('a prompt typed in the chat is filed before the turn sees it and goes in with its id and the open ones beside it', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.workAnswer = { status: 200, text: FILED }
    await $.prompt.submit({ text: 'Make the strip blue', ...ASKED } as never)
    expect(sent(w)).toEqual([{ action: 'instruction', text: 'Make the strip blue', chat: 'Units', session: 'units' }])
    // The prompt itself goes on unchanged; beside it, for the model: its id and the ones still open.
    expect(w.typedIn).toEqual(['composer:framed:Make the strip blue'])
    expect(w.contexts[0]?.join('\n')).toContain('Recorded as I17; close it with work close I17 --as "what came of it" once it is done.')
    expect(w.contexts[0]?.join('\n')).toContain('Open instructions: I15 (2 turns), I17 (new).')
    // Review of B298: the system prompt stays the same words, so it stays cached.
    const composed = await $.prompt.compose(COMPOSE)
    expect(composed.sections.some(section => section.id === 'folder-branches:instructions')).toBe(false)
  })

  test('what the person sends by Remote Control is filed; a line the board typed, the same pasted by hand and a slash command are not', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.workAnswer = { status: 200, text: FILED }
    await $.prompt.submit({ text: 'From my phone: the menu too', origin: { kind: 'bridge' } } as never)
    await $.prompt.submit({ text: 'Queue the menu [I18]\n(typed on the worker board, 11:05)', origin: { kind: 'plugin', asUser: true } } as never)
    await $.prompt.submit({ text: 'Queue the menu [I18]', ...ASKED } as never)
    await $.prompt.submit({ text: '(answered on the worker board, 11:05) Q2 "Box or yew?": yew', ...ASKED } as never)
    await $.prompt.submit({ text: '/compact', ...ASKED } as never)
    expect(sent(w).map(one => one.text)).toEqual(['From my phone: the menu too'])
    // A board line that starts a turn still carries the open ones beside it.
    expect(w.contexts[1]?.join('\n')).toContain('Open instructions: I15 (2 turns), I17 (new).')
  })

  test('B1: the app\'s own notes file nothing; beside the person\'s words only those words are filed, the prompt unchanged', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.workAnswer = { status: 200, text: FILED }
    const reminder = '<system-reminder>\nThe session "Game - Map" you started (local_x) finished a turn.\n</system-reminder>'
    const peer = '<cross-session-message from="local_y" name="Game - Main">\nNote from Game - Main: run work next.\n</cross-session-message>'
    await $.prompt.submit({ text: `${reminder}\n<side-sessions-event>None of the sessions you started is working now.</side-sessions-event>`, origin: { kind: 'sdk' } } as never)
    await $.prompt.submit({ text: `${reminder}\n${peer}`, origin: { kind: 'sdk' } } as never)
    await $.prompt.submit({ text: `${reminder}\nMake the strip blue`, origin: { kind: 'sdk' } } as never)
    expect(sent(w).filter(one => one.action === 'instruction').map(one => one.text)).toEqual(['Make the strip blue'])
  })

  test('a prompt held during a turn is filed on submit and goes in with its id', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'I18', open: [{ id: 'I18', turns: 0 }] }) }
    await $.prompt.submit({ text: 'And the menu too', ...ASKED, turnId: 't1' } as never)
    expect(sent(w).map(one => one.action)).toEqual(['instruction'])
    expect(w.contexts[0]?.join('\n')).toContain('Recorded as I18;')
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
    // B300: a free worker pulls its next step with the same call, once.
    expect(sent(w)).toEqual([{ action: 'turn-ended', since: started, pull: true, chat: 'Units', session: 'units' }])
    // The next prompt names it as missed.
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'I16', open: [{ id: 'I15', turns: 3 }, { id: 'I16', turns: 0 }] }) }
    await $.prompt.submit({ text: 'go on', ...ASKED } as never)
    expect(w.contexts[0]?.join('\n')).toContain('I15 (3 turns)')
  })

  test('B301: a board without a work store refuses (503): nothing changes for the chat, and the next prompt asks again', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.workAnswer = { status: 503, text: 'No work store in D:/Work/project/.claude/work: the board shows no work.' }
    await $.prompt.submit({ text: 'Make the strip blue', ...ASKED } as never)
    expect([w.typedIn, w.contexts]).toEqual([['composer:framed:Make the strip blue'], [[]]])
    await $.turn.start({ text: 'Make the strip blue', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.prompt.submit({ text: 'And the menu', ...ASKED } as never)
    // Nothing is remembered: each word of the person's is offered to the board, which says on its page what is wrong.
    expect(sent(w).map(one => one.action)).toEqual(['instruction', 'turn-ended', 'instruction'])
    expect(w.toasts).toEqual([])
  })

  test('a board that hangs holds the prompt at most a moment and a half: the prompt goes in without it', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.hangs = true
    const submitted = $.prompt.submit({ text: 'Make the strip blue', ...ASKED } as never)
    await settle()
    expect(w.typedIn).toEqual([])
    await clock.advance(1500)
    await submitted
    expect(w.typedIn).toEqual(['composer:framed:Make the strip blue'])
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ended = $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    // B300: the turn's end with the free worker's pull is one call, held a moment and a half at most in all.
    await clock.advance(1500)
    await ended
    expect(sent(w).map(one => one.action)).toEqual(['instruction', 'turn-ended'])
  })

  test('a chat started anew asks once for its open instructions, so its first turn names them', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [{ id: 'I9', turns: 1 }] }) }
    await $.session.start(START)
    await settle()
    expect(sent(w).map(one => one.action)).toEqual(['next'])
    await $.prompt.submit({ text: 'Queue the menu [I10]\n(typed on the worker board, 11:05)', origin: { kind: 'plugin', asUser: true } } as never)
    expect(w.contexts[0]?.join('\n')).toContain('Open instructions: I9 (1 turn).')
    expect(w.worked.length).toBe(1)
  })
})

describe('B300: a free worker pulls its next step at the end of its turn', () => {
  const BOARD = 'D:/Work/project/.claude/board.json'
  const board = JSON.stringify({ url: 'http://127.0.0.1:4311', key: 'ab'.repeat(32), startedAt: 1 })
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)
  const LINE = 'work: B286 is yours; run work next'

  test('a free worker’s turn end pulls, and the line the board puts out for it is typed at once', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ missed: [], open: [], pull: { text: LINE, id: 'B286', wake: { to: 'Units', id: 'B286' } } }) }
    w.waiting = [{ id: 'w1', text: LINE }]
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(sent(w).map(one => [one.action, one.pull ?? null])).toEqual([['turn-ended', true]])
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
  })

  test('a worker whose card holds a task does not pull, nor does an interrupted turn', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'working', task: task('B12 Give the golem', 1, 3, 20), at: 0 } }), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.turn.start({ text: 'go', turnId: 't2' })
    await $.turn.complete({ ...ENDED, turnId: 't2', reason: 'aborted', isAborted: true })
    // A chat in the list at its start asks once for its open instructions ("next"); no pull follows either turn.
    expect(sent(w).map(one => [one.action, one.pull ?? null])).toEqual([['next', null], ['turn-ended', null]])
  })

  test('B301: a board that refuses the turn\'s end takes nothing in; the next turn\'s end asks again', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.workAnswer = { status: 503, text: 'No work store in D:/Work/project/.claude/work: the board shows no work.' }
    for (const turn of ['t1', 't2', 't3']) {
      await $.turn.start({ text: 'go', turnId: turn })
      await clock.advance(60_000)
      await $.turn.complete({ ...ENDED, turnId: turn })
    }
    expect(w.worked.length).toBe(3)
    expect(w.typedIn).toEqual([])
  })

  describe('B484: the board answers the turn\'s end with a "For you" block slowly', () => {
    const block = 'Closed B277.\n\n> **For you**\n> 1. **Answer:** Keep the golem as it is? I advise yes.\n\n---\n\n```diff\n  Prompt: x\n  Who:    Game - Main\n- Done:   partly\n```'
    const answer = JSON.stringify({ missed: [], open: [], role: 'main', pause: RUNNING, asked: ['Q7'], left: ['"Plant the hedge?" asks what Q5 asks'] })
    const told = (w: World): boolean[] => w.contexts.map(one => one.join(' ').includes('from your last "For you" block: Q7') && one.join(' ').includes('as asked already: "Plant the hedge?"'))

    async function slow($: Engine, on: On, afterMs: number, before?: (w: World) => void): Promise<World> {
      const clock = mock.clock(on)
      const w = world('main', { ...listed(), [BOARD]: board })
      stand(on, w)
      await $.session.start(START)
      await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Main' })
      await $.turn.start({ text: 'go', turnId: 't1' })
      let release = (): void => {}
      w.byAction['turn-ended'] = { status: 200, text: answer }
      w.holdAction = { action: 'turn-ended', until: new Promise<void>(done => { release = done }) }
      const ending = $.turn.complete({ ...ENDED, answer: block, turnId: 't1' })
      await settle()
      await clock.advance(afterMs)
      before?.(w)
      release()
      await settle()
      await clock.advance(10_000)
      await ending
      await settle()
      return w
    }

    test('a board that answers after 1.5 s but within the wait still tells the chat what it filed and left out', async ($, on) => {
      const w = await slow($, on, 3000)
      await $.prompt.submit({ text: 'yes', ...ASKED } as never)
      expect(told(w)).toEqual([true])
    })

    test('the turn\'s end is held for the board past 1.5 s, and let go with its answer in hand (not left to the late path)', async ($, on) => {
      const clock = mock.clock(on)
      const w = world('main', { ...listed(), [BOARD]: board })
      stand(on, w)
      await $.session.start(START)
      await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Main' })
      await $.turn.start({ text: 'go', turnId: 't1' })
      let release = (): void => {}
      w.byAction['turn-ended'] = { status: 200, text: answer }
      w.holdAction = { action: 'turn-ended', until: new Promise<void>(done => { release = done }) }
      let isEnded = false
      const ending = $.turn.complete({ ...ENDED, answer: block, turnId: 't1' }).then(() => { isEnded = true })
      await settle()
      await clock.advance(3000)
      await settle()
      expect(isEnded).toBe(false)
      release()
      await settle()
      await ending
      expect(isEnded).toBe(true)
      // taken in the turn itself: the late path would drop this answer once the chat is cleared
      w.id = 'fresh-session'
      await $.prompt.submit({ text: 'yes', ...ASKED } as never)
      expect(told(w)).toEqual([true])
      expect(w.toasts.join(' ')).not.toContain('answered after this chat was cleared')
    })

    test('a board that answers after the wait is over tells the chat at its next prompt, while it is the same chat', async ($, on) => {
      const w = await slow($, on, 8000)
      await $.prompt.submit({ text: 'yes', ...ASKED } as never)
      expect(told(w)).toEqual([true])
    })

    test('an answer that comes after the chat was cleared is dropped and said, not given to the fresh chat', async ($, on) => {
      const w = await slow($, on, 8000, world => { world.id = 'fresh-session' })
      await $.prompt.submit({ text: 'yes', ...ASKED } as never)
      expect(told(w)).toEqual([false])
      expect(w.toasts.join(' ')).toContain('answered after this chat was cleared')
    })
  })

  test('B317: an answer that ends with a "For you" block hands its items to the board with the turn\'s end, in the same call', async ($, on) => {
    mock.clock(on)
    const w = world('main', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Main' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const words = 'Closed B277.\n\n> **For you**\n> 1. **Answer:** Keep the golem as it is? I advise yes.\n\n---\n\n```diff\n  Prompt: x\n  Who:    Game - Main\n- Done:   partly\n```'
    w.workAnswer = { status: 200, text: JSON.stringify({ missed: [], open: [], asked: ['Q7'], left: ['"Plant the hedge?" asks what Q5 asks'] }) }
    await $.turn.complete({ ...ENDED, answer: words, turnId: 't1' })
    // The next prompt names what was filed, once, so the chat can close one the person answers in the chat.
    await $.prompt.submit({ text: 'yes, keep it', ...ASKED } as never)
    await $.prompt.submit({ text: 'and go on', ...ASKED } as never)
    expect(w.contexts.map(one => one.join(' ').includes('from your last "For you" block: Q7'))).toEqual([true, false])
    // B480: and, once, what the board left out as asked already.
    expect(w.contexts.map(one => one.join(' ').includes('as asked already: "Plant the hedge?" asks what Q5 asks'))).toEqual([true, false])
    await $.turn.start({ text: 'go', turnId: 't2' })
    // A subagent's answer with such a block is not the chat's.
    await $.turn.complete({ ...ENDED, answer: words, turnId: 's1', agentId: 'a1' })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(sent(w).filter(one => one.action === 'turn-ended').map(one => [one.action, one.forYou ?? null])).toEqual([
      ['turn-ended', [{ n: 1, kind: 'decide', text: ['Keep the golem as it is? I advise yes.'], options: [], advice: 'yes', pictures: [], play: '', ref: null }]],
      ['turn-ended', null],
    ])
  })

  test('the main chat does not pull', async ($, on) => {
    mock.clock(on)
    const w = world('main', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Main' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(sent(w).map(one => [one.action, one.pull ?? null])).toEqual([['turn-ended', null]])
  })

  test('a free worker whose pull brings nothing takes nothing', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ missed: [], open: [], pull: { text: '', id: null, wake: null } }) }
    const takes = w.fetched.length
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(sent(w).map(one => [one.action, one.pull ?? null])).toEqual([['turn-ended', true]])
    expect(w.fetched.length).toBe(takes)
    expect(w.typedIn).toEqual([])
  })
})

describe('B299: a question asked with the app\u2019s form stands on the worker board too', () => {
  const BOARD = 'D:/Work/project/.claude/board.json'
  const board = JSON.stringify({ url: 'http://127.0.0.1:4311', key: 'ab'.repeat(32), startedAt: 1 })
  const FORM = { tool: 'AskUserQuestion', questions: [{ question: 'Which port?', header: 'Port', multiSelect: false, options: [{ label: '4320', description: 'free' }, { label: '4330', description: 'taken' }] }] }
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)
  const working = { units: { name: 'Units', role: 'worker' as const, state: 'waiting' as const, task: task('B12 Give the golem', 1, 3, 20), at: 0 } }
  /** A chat that joins by its title, so it has asked the board nothing before the test's own calls. */
  const begin = async ($: { session: { start: (e: never) => Promise<unknown> }; classic: { UserPromptSubmit: (e: never) => Promise<unknown> }; turn: { start: (e: never) => Promise<unknown> } }): Promise<void> => {
    await $.session.start(START as never)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Units' } as never)
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
  }

  test('it is filed as a decide ask under the card\u2019s step, and the answer given in the form follows', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(working), [BOARD]: board })
    w.workAnswer = { status: 409, text: 'not yet' }
    stand(on, w)
    await begin($)
    w.worked = []
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'Q4', text: '> **For you**' }) }
    w.formAnswers = { 'Which port?': '4320' }
    await $.tool.call(FORM as never)
    expect(sent(w)).toEqual([
      { action: 'ask', kind: 'decide', via: 'form', text: 'Which port?', options: ['4320', '4330'], of: 'B12', chat: 'Units', session: 'units' },
      { action: 'answered-in-chat', id: 'Q4', text: '4320', chat: 'Units', session: 'units' },
    ])
  })

  test('refused under the step it stands alone; answered in free text it is answered; closed unanswered it is withdrawn', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(working), [BOARD]: board })
    w.workAnswer = { status: 409, text: 'not yet' }
    stand(on, w)
    await begin($)
    // The 409 above is remembered for five minutes: past them the board is asked again.
    await clock.advance(5 * 60_000)
    w.worked = []
    w.workAnswers = [{ status: 409, text: 'B12 is Board\u2019s' }, { status: 200, text: JSON.stringify({ id: 'Q5' }) }, { status: 200, text: '{}' }]
    w.formResponse = 'neither, use 4340'
    await $.tool.call(FORM as never)
    expect(sent(w).map(one => [one.action, one.of ?? null, one.id ?? null, one.text ?? null])).toEqual([
      ['ask', 'B12', null, 'Which port?'], ['ask', null, null, 'Which port?'], ['answered-in-chat', null, 'Q5', 'neither, use 4340'],
    ])
    w.worked = []
    w.workAnswers = [{ status: 200, text: JSON.stringify({ id: 'Q6' }) }]
    w.formCloses = true
    await $.tool.call(FORM as never).catch(() => null)
    expect(sent(w).map(one => [one.action, one.id ?? null])).toEqual([['ask', null], ['withdraw', 'Q6']])
  })

  test('B412: a board slow to file it under the step is not asked again without the step; its late answer is closed', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(working), [BOARD]: board })
    w.workAnswer = { status: 409, text: 'not yet' }
    stand(on, w)
    await begin($)
    w.worked = []
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'Q8' }) }
    let release = (): void => {}
    w.held = new Promise<void>(resolve => {
      release = resolve
    })
    w.formAnswers = { 'Which port?': '4320' }
    const asked = $.tool.call(FORM as never)
    await settle()
    // The board takes longer than the mod may hold the form: the form is asked, and nothing is filed a second time.
    await clock.advance(1500)
    await settle()
    release()
    await settle()
    await asked
    expect(sent(w).map(one => [one.action, one.of ?? null, one.id ?? null])).toEqual([['ask', 'B12', null], ['answered-in-chat', null, 'Q8']])
  })

  test('B301: a board without a work store files nothing, and the form is asked as before', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 503, text: 'No work store in D:/Work/project/.claude/work: the board shows no work.' }
    await begin($)
    const asked = await $.tool.call(FORM as never)
    expect(asked.result).toEqual({ answers: {} })
    expect(sent(w).map(one => one.action)).toEqual(['ask'])
    expect(w.whileAsked?.state).toBe('asking')
  })

  test('the chat closes its own ask with the person\u2019s words from the chat, through the work tool', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await begin($)
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'Q7', text: 'Q7 answered in the chat.' }) }
    expect((await $.tool.call({ tool: 'mcp__folder-branches__work', action: 'answered-in-chat', id: 'Q7', text: 'yes, B' } as never)).result).toBe('Q7 answered in the chat.')
    expect(sent(w).at(-1)).toEqual({ action: 'answered-in-chat', id: 'Q7', text: 'yes, B', chat: 'Units', session: 'units' })
  })
})

describe('B319: two projects on one PC, each with its own board', () => {
  // Two project folders, each with its list of chats and the note its own board wrote: another port, another key.
  const projects = {
    alpha: { root: 'C:\\Work\\alpha', url: 'http://127.0.0.1:4310', key: 'aa'.repeat(32) },
    beta: { root: 'D:\\Work\\beta', url: 'http://127.0.0.1:4311', key: 'bb'.repeat(32) },
  }
  const files: Record<string, string> = {}
  for (const one of Object.values(projects)) {
    const at = slashed(one.root)
    files[`${at}/.claude/chats/list.json`] = '{ "prefix": "Game - ", "main": "Main" }\n'
    files[`${at}/.claude/board.json`] = JSON.stringify({ url: one.url, key: one.key, startedAt: 1 })
  }

  for (const [name, own] of Object.entries(projects)) {
    test(`a chat of ${name} keeps its card in ${name}'s folder and works with ${name}'s board, never the other`, async ($, on) => {
      mock.clock(on)
      const w = world(`${name}-1`, { ...files })
      w.root = own.root
      stand(on, w)
      await $.session.start({ ...START, cwd: own.root })
      await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Worker 1' })
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.tool.call({ tool: 'mcp__folder-branches__work', action: 'next' })
      expect(w.workedAt).toEqual([`${own.url}/api/bridge/work ${own.key}`])
      // Its card is in its own project's list, under the same name a chat of the other project may have.
      expect(Object.keys(w.files).filter(path => path.endsWith(`/${name}-1.json`))).toEqual([`${slashed(own.root)}/.claude/chats/${name}-1.json`])
      // Whatever else it asked a board, it asked its own.
      for (const asked of w.fetched) expect(`${asked.url.startsWith(own.url)} ${asked.key}`).toBe(`true ${own.key}`)
    })
  }
})

describe('Pause 2: each chat reads the person\'s pause in its own calls to the board', () => {
  const BATCH = { hook_event_name: 'PostToolBatch', session_id: 'units', transcript_path: 'x', cwd: ROOT, tool_calls: [] } as const
  const SINCE = Date.UTC(2026, 9, 18, 20, 30)
  const POINT = { commit: '1a2b3c4', next: 'write the tests', at: SINCE + 60_000, line: '1a2b3c4 · write the tests · 2026-10-18 22:31:00', isSincePause: true }
  const state = (name: string, holds: unknown[] = [], resumeList: unknown[] = []) => ({ text: 'x', state: name, since: SINCE, forChat: { holds, mustStop: name === 'pausing' }, resumeList })
  const told = async ($: Parameters<Parameters<typeof test>[1]>[0], more: Record<string, unknown> = {}): Promise<string> => {
    const result = await $.classic.PostToolBatch({ ...BATCH, ...more } as never)
    return result.additionalContext?.join('\n') ?? ''
  }
  const STOP = 'The person pauses all chats: commit your work, write your checkpoint (work step B12 --commit <hash> --next "<next action>"), stop or wait for your background agents, then end your turn and start nothing new.'
  const units = (): Record<string, string> => ({ ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 } }), [BOARD]: board })
  const free = (): Record<string, string> => ({ ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
  const mainChat = (): Record<string, string> => ({ ...listed({ main: { name: 'Main', role: 'main', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)

  test('the work tool writes a checkpoint: its description says when, and commit and next reach the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    stand(on, w)
    await $.session.start(START)
    expect(w.descriptions.work).toContain('"commit"')
    expect(w.descriptions.work).toContain('checkpoint with every commit and when the person pauses')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12: checkpoint 1a2b3c4 · write the tests.' }) }
    await $.tool.call({ tool: WORK, action: 'step', id: 'B12', commit: '1a2b3c4', next: 'write the tests' } as never)
    expect(sent(w).filter(one => one.action === 'step')).toEqual([{ action: 'step', id: 'B12', commit: '1a2b3c4', next: 'write the tests', chat: 'Units', session: 'units' }])
  })

  test('while the person pauses, a working chat is told at the first tool batch of every turn to checkpoint and end it; one board call per 20 s', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', units())
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    // Nobody pauses: nothing is said, and the reading is kept a while.
    expect(await told($)).not.toContain('pauses all chats')
    const reads = w.pauseReads
    w.pauseAnswer = state('pausing', [{ id: 'B12', checkpoint: null }])
    expect(await told($)).not.toContain('pauses all chats')
    expect(w.pauseReads).toBe(reads)
    await clock.advance(21_000)
    expect(await told($)).toContain(STOP)
    expect(w.pauseReads).toBe(reads + 1)
    await clock.advance(21_000)
    expect(await told($)).not.toContain('pauses all chats')
    // A subagent's batch is not the chat's.
    await clock.advance(21_000)
    const before = w.pauseReads
    expect(await told($, { agent_id: 'a1b2c3d4e5' })).not.toContain('pauses all chats')
    expect(w.pauseReads).toBe(before)
    // The review of Pause 2: the next turn drops the reading and is told again, at its first batch.
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.turn.start({ text: 'one more thing', turnId: 't2' })
    const atStart = w.pauseReads
    expect(await told($)).toContain(STOP)
    expect(w.pauseReads).toBe(atStart + 1)
    expect(await told($)).not.toContain('pauses all chats')
  })

  test('a chat that holds nothing is told to end its turn; a free worker does not pull while the person pauses', async ($, on) => {
    mock.clock(on)
    const w = world('units', free())
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.pauseAnswer = state('pausing')
    expect(await told($)).toContain('The person pauses all chats: stop or wait for your background agents, then end your turn and start nothing new.')
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    const ended = sent(w).find(one => one.action === 'turn-ended')
    expect(ended?.pull).toBeUndefined()
    // Running again: it pulls as before.
    w.pauseAnswer = state('running')
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'No instruction was left open.', missed: [], open: [], pause: state('running') }) }
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await told($)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(sent(w).filter(one => one.action === 'turn-ended').at(-1)?.pull).toBe(true)
  })

  test('after Resume all the main chat is told whom to wake, by app session id, when it starts; once per resume, also in a new process', async ($, on) => {
    mock.clock(on)
    const w = world('main', mainChat())
    w.pauseAnswer = state('resuming', [], [
      { chat: 'Units', session: 'local_units', cliSession: 'units', step: 'B12', checkpoint: POINT, hasStarted: false },
      { chat: 'Support', session: 'local_support', cliSession: 'support', step: 'B13', checkpoint: POINT, hasStarted: true },
    ])
    stand(on, w)
    await $.session.start(START)
    const started = await $.classic.SessionStart({ source: 'startup', session_title: 'Game - Main' } as never)
    const said = started.additionalContext?.join('\n') ?? ''
    expect(said).toContain("Resume: wake each chat below that has not started, by its session id with SendMessage, one line each: 'resume your step B<id> from your checkpoint'")
    expect(said).toContain("- Units, session local_units: 'resume your step B12 from your checkpoint' (checkpoint 1a2b3c4 · write the tests)")
    expect(said).not.toContain('Support')
    await $.prompt.submit({ text: 'resume', origin: { kind: 'plugin', asUser: true } } as never)
    expect(w.contexts[0]?.join('\n') ?? '').not.toContain('Resume: wake')
    // The review of Pause 2: kept in the mod's store, so a process started anew in the same resume says it no more.
    expect(w.stored['pause-resume-given:main']).toBe(SINCE)
  })

  test('a main chat already told of this resume in an earlier process is not told again; a new resume is told', async ($, on) => {
    mock.clock(on)
    const w = world('main', mainChat())
    w.stored = { 'pause-resume-given:main': SINCE }
    w.pauseAnswer = state('resuming', [], [{ chat: 'Units', session: 'local_units', cliSession: 'units', step: 'B12', checkpoint: POINT, hasStarted: false }])
    stand(on, w)
    await $.session.start(START)
    const started = await $.classic.SessionStart({ source: 'startup', session_title: 'Game - Main' } as never)
    expect(started.additionalContext?.join('\n') ?? '').not.toContain('Resume: wake')
    w.pauseAnswer = { ...state('resuming', [], [{ chat: 'Units', session: 'local_units', cliSession: 'units', step: 'B12', checkpoint: POINT, hasStarted: false }]), since: SINCE + 3_600_000 }
    await $.prompt.submit({ text: 'resume\n(typed on the worker board, 23:40)', origin: { kind: 'plugin', asUser: true } } as never)
    expect(w.contexts.at(-1)?.join('\n') ?? '').toContain('Resume: wake')
  })

  test('a main chat that runs gets the list with the board\'s "resume"', async ($, on) => {
    mock.clock(on)
    const w = world('main', mainChat())
    stand(on, w)
    await $.session.start(START)
    await $.prompt.submit({ text: 'hello', ...ASKED } as never)
    w.pauseAnswer = state('resuming', [], [{ chat: 'Units', session: 'local_units', cliSession: 'units', step: 'B12', checkpoint: null, branch: 'b12-strip', hasStarted: false }])
    await $.prompt.submit({ text: 'resume\n(typed on the worker board, 22:40)', origin: { kind: 'plugin', asUser: true } } as never)
    expect(w.contexts[1]?.join('\n') ?? '').toContain("- Units, session local_units: 'resume your step B12 from your checkpoint' (no checkpoint: it goes on from its branch b12-strip and History)")
  })

  test('a worker woken after the resume is told its checkpoint at its first turn, reading the pause once; at a session start too, unless the person pauses', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    stand(on, w)
    await $.session.start(START)
    w.pauseAnswer = state('pausing', [{ id: 'B12', checkpoint: POINT }])
    const paused = await $.classic.SessionStart({ source: 'startup', session_title: 'Game - Units' } as never)
    expect(paused.additionalContext ?? []).toEqual([])
    w.pauseAnswer = state('resuming', [{ id: 'B12', checkpoint: POINT }])
    const before = w.pauseReads
    await $.prompt.submit({ text: 'resume your step B12 from your checkpoint', origin: { kind: 'peer' } } as never)
    expect(w.contexts.at(-1)?.join('\n') ?? '').toContain('You hold B12: checkpoint 1a2b3c4 · write the tests; go on from there.')
    // The review of Pause 2: the turn the words start reads the pause no second time at its first batch.
    await $.turn.start({ text: 'resume your step B12 from your checkpoint', turnId: 't1' })
    await told($)
    expect(w.pauseReads).toBe(before + 1)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.prompt.submit({ text: 'and resume the next', origin: { kind: 'peer' } } as never)
    expect(w.contexts.at(-1)?.join('\n') ?? '').not.toContain('You hold B12')
  })

  test('a held step with no checkpoint resumes from its branch and History', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    stand(on, w)
    await $.session.start(START)
    w.pauseAnswer = { ...state('resuming', [{ id: 'B12', checkpoint: null, branch: 'b12-strip', history: ['2026-10-18 22:10 Units: step 2/4, the strip'] }]), pausedSince: SINCE - 60_000 }
    await $.prompt.submit({ text: 'resume your step B12 from your checkpoint', origin: { kind: 'peer' } } as never)
    expect(w.contexts.at(-1)?.join('\n') ?? '').toContain('You hold B12: no checkpoint since the pause; go on from its branch b12-strip and its History: 2026-10-18 22:10 Units: step 2/4, the strip.')
  })

  test('a chat that starts while it holds a step goes on from its checkpoint', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    w.pauseAnswer = state('running', [{ id: 'B12', checkpoint: POINT }])
    stand(on, w)
    await $.session.start(START)
    const started = await $.classic.SessionStart({ source: 'startup', session_title: 'Game - Units' } as never)
    expect(started.additionalContext).toEqual(['You hold B12: checkpoint 1a2b3c4 · write the tests; go on from there.'])
    await $.prompt.submit({ text: 'go on', ...ASKED } as never)
    expect(w.contexts.at(-1)?.join('\n') ?? '').not.toContain('You hold B12')
  })

  test('an old board that does not know pause-state changes nothing for the chat', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    w.pauseAnswer = null
    stand(on, w)
    await $.session.start(START)
    const started = await $.classic.SessionStart({ source: 'startup', session_title: 'Game - Units' } as never)
    expect(started.additionalContext ?? []).toEqual([])
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(await told($)).not.toContain('pauses all chats')
  })
})

describe('B463: a chat renamed while it runs', () => {
  /** The board's refusal of a name it does not show this session under, with the name it does show. */
  const notShown = (name: string | null): string => `Not the chat the board shows under that name.${name === null ? '' : ` The board shows this session as ${JSON.stringify(name)}.`}`
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) await Promise.resolve()
  }

  test('takes the name the board shows from its refusal, whatever wakes it: its next take asks under that name', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    expect(fileOf(w)?.name).toBe('Units')
    // The person renamed the chat in the app to "Game - Sound": no prompt of theirs comes, only the board's refusal.
    w.takeAnswers.push({ status: 409, text: notShown('Sound') })
    await clock.advance(5000)
    await settled()
    expect([fileOf(w)?.name, fileOf(w)?.role]).toEqual(['Sound', 'worker'])
    w.waiting.push({ id: 'm1', text: '(answered on the worker board, 00:31) Q9 "The card": A' })
    await clock.advance(5000)
    await settled()
    expect(saidBody(w.fetched.at(-1)?.body ?? '{}')).toEqual({ chat: 'Sound', session: 'units', report: { state: 'idle', since: 0, background: false } })
    expect(w.typedIn).toEqual(['plugin:as the person:(answered on the worker board, 00:31) Q9 "The card": A'])
  })

  test('a work call refused under the old name joins under the shown name and is asked once more, with the same request id', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    // Woken by another chat's message, not by the person: no title comes with the turn.
    await $.turn.start({ text: 'Another Claude session sent a message: run work next', turnId: 't1' })
    w.worked = []
    w.requests = []
    w.workAnswers = [{ status: 409, text: notShown('Sound') }, { status: 200, text: '{"text":"Yours, Sound:"}' }]
    const next = await $.tool.call({ tool: WORK, action: 'next' })
    expect(next.result).toBe('Yours, Sound:')
    expect(w.worked.map(body => JSON.parse(body).chat)).toEqual(['Units', 'Sound'])
    expect(new Set(w.requests).size).toBe(1)
    expect(fileOf(w)?.name).toBe('Sound')
  })

  test('it asks once more at most, and not at all when the board shows the session under no name or under its own', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.worked = []
    w.workAnswers = [{ status: 409, text: notShown('Sound') }, { status: 409, text: notShown('Music') }]
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toBe(`${notShown('Music')} (HTTP 409)`)
    expect(w.worked.length).toBe(2)
    w.worked = []
    w.workAnswers = [{ status: 409, text: notShown(null) }]
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toBe(`${notShown(null)} (HTTP 409)`)
    w.workAnswers = [{ status: 409, text: notShown('Sound') }]
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toBe(`${notShown('Sound')} (HTTP 409)`)
    expect(w.worked.length).toBe(2)
    expect(fileOf(w)?.name).toBe('Sound')
  })

  test('only the refusal\'s own words name the chat, a name with quotes exactly, and a rename keeps what the card says', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    w.worked = []
    // Words the board echoes from elsewhere name nobody.
    w.workAnswers = [{ status: 409, text: `B12 decided no such thing: "x". ${notShown('Sound')}` }]
    await $.tool.call({ tool: WORK, action: 'next' })
    expect([w.worked.length, fileOf(w)?.name]).toEqual([1, 'Units'])
    w.workAnswers = [{ status: 409, text: notShown('The "new" one') }, { status: 200, text: '{"text":"Yours:"}' }]
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toBe('Yours:')
    expect([fileOf(w)?.name, fileOf(w)?.state]).toEqual(['The "new" one', 'waiting'])
  })

  test('a chat that was taken out stays out, whatever name the board shows it under', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    expect((await $.tool.call({ tool: TOOL, action: 'leave' })).result).toBe('This chat is out of the list.')
    w.takeAnswers.push({ status: 409, text: notShown('Sound') })
    w.workAnswers = [{ status: 409, text: notShown('Sound') }]
    await clock.advance(5000)
    await settled()
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toBe('This chat is not in the list of chats: the work tool is for the chats of the list.')
    expect(fileOf(w)).toBeNull()
  })
})

describe('B468: the Advisor gives a step its effort with the work tool', () => {
  const advisor = (): Record<string, string> => ({ ...listed({ advisor: { name: 'Advisor', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)

  test('the description names effort on refine, refined and new, and the effort reaches the board', async ($, on) => {
    mock.clock(on)
    const w = world('advisor', advisor())
    stand(on, w)
    await $.session.start(START)
    expect(w.descriptions.work).toContain('"standard", "model", "effort", "questions"')
    expect(w.descriptions.work).toContain('"refined" ("id", "what", "standard", "model", "effort")')
    expect(w.descriptions.work).toContain('"priority", "standard", "model", "effort"): a new step')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12: refined, round 1.' }) }
    await $.tool.call({ tool: WORK, action: 'refine', id: 'B12', summary: 'A fix.', effort: 'low: a text fix' } as never)
    expect(sent(w).filter(one => one.action === 'refine')).toEqual([{ action: 'refine', id: 'B12', summary: 'A fix.', effort: 'low: a text fix', chat: 'Advisor', session: 'advisor' }])
  })

  test('model per step: the model goes with the effort on refine, refined and new, and reaches the board', async ($, on) => {
    mock.clock(on)
    const w = world('advisor', advisor())
    stand(on, w)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12: refined, round 1.' }) }
    await $.tool.call({ tool: WORK, action: 'refine', id: 'B12', summary: 'A fix.', model: 'opus: a guard of the work store', effort: 'medium: one rule' } as never)
    await $.tool.call({ tool: WORK, action: 'refined', id: 'B12', what: ['A guard'], model: 'opus: a guard of the work store' } as never)
    await $.tool.call({ tool: WORK, action: 'new', title: 'Fix the gate words', activity: 'Board', model: 'sonnet: a text fix' } as never)
    expect(sent(w).filter(one => ['refine', 'refined', 'new'].includes(String(one.action))).map(one => [one.action, one.model])).toEqual([
      ['refine', 'opus: a guard of the work store'], ['refined', 'opus: a guard of the work store'], ['new', 'sonnet: a text fix'],
    ])
  })
})

/** A /clear as the mod runs it: from the plugin, by its name. */
const CLEAR_ARGS = { command: 'clear', args: '', origin: { kind: 'plugin', name: 'folder-branches' }, presentation: { isFullscreen: false, columns: 100 } }
const CLEAR_BY_MOD = CLEAR_ARGS as never

describe('clear after each step', () => {
  /** Real time passing, for the work the engine queues (a command run once the chat is idle). */
  const wait = (ms: number): Promise<void> => new Promise(resolve => { (globalThis as unknown as { setTimeout: (done: () => void, ms: number) => void }).setTimeout(resolve, ms) })
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)
  const ok = (fields: Record<string, unknown>): { status: number; text: string } => ({ status: 200, text: JSON.stringify(fields) })
  const LOG = '.claude/chat-logs/Units/2026-10-23 1405 B12.txt'
  const FILE = 'D:/Work/project/.claude/chat-logs/Units/2026-10-23 1405 B12.txt'
  const OPEN = [{ id: 'I7', turns: 0, text: 'Use the red cape' }]
  /** A project whose list clears its workers after a step, a board, and the worker Units at the start of a turn. */
  async function worker($: Engine, on: On, more: string | null = 'B13', list = '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear" }'): Promise<World> {
    const w = world('units', { [`${CHATS}/list.json`]: `${list}\n`, [BOARD]: board })
    stand(on, w)
    w.tokens = 400_000
    w.byAction = {
      report: ok({ id: 'B12', text: 'B12 is in review.', more }),
      'turn-ended': ok({ text: 'No instruction was left open.', missed: [], open: OPEN, role: 'worker', pause: RUNNING }),
      'save-log': ok({ text: `Saving the conversation to ${FILE}.`, log: LOG, file: FILE }),
      next: ok({ text: 'Yours, Units: B13 (queued).', open: [{ id: 'I7', turns: 1, text: 'Use the red cape' }] }),
    }
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
    return w
  }
  /** The /clear runs: the old conversation ends and the new one starts under another session id. */
  async function cleared($: Engine, w: World, to = 'units-2'): Promise<string[]> {
    await $.session.end({ reason: 'clear', sessionId: w.id, resume: { id: w.id } })
    w.id = to
    const started = await $.classic.SessionStart({ source: 'clear', session_title: 'Game - Units' })
    return [...(started.additionalContext ?? [])]
  }

  test('a reported step clears the worker even when more follows: the board keeps its log first, then /clear runs', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.sequence).toEqual(['report', 'turn-ended', 'save-log', '/clear'])
    expect(sent(w).find(one => one.action === 'save-log')).toEqual({ action: 'save-log', stepId: 'B12', chat: 'Units', session: 'units' })
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
    expect(w.compactions).toEqual([])
    // The mark on the card, just before /clear.
    expect(fileOf(w)?.clearing).toEqual({ at: fileOf(w)?.clearing?.at, step: 'B12', log: LOG })
    expect(w.toasts).toEqual([`Clearing this chat after B12: its conversation is kept in ${FILE}.`])
  })

  test('the card moves to the new session id, the work tool answers for it, and the fresh conversation is told where it stands', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    const context = await cleared($, w)
    // The old session's file names the new one; the new card is the same chat, with the clear on it.
    expect(fileOf(w, 'units')).toBeNull()
    expect(JSON.parse(w.files[`${CHATS}/units.json`] ?? '{}').movedTo).toBe('units-2')
    expect(fileOf(w, 'units-2')).toEqual({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: clock.now(), cleared: { at: clock.now(), step: 'B12', log: LOG } })
    // Its start: who it is, its rules, the log, the open instructions as work next lists them, and work next.
    expect(context.length).toBe(1)
    expect(context[0]).toContain('This chat is "Game - Units", a worker')
    expect(context[0]).toContain(`after your step B12 was reported, so this conversation starts empty. It is kept word for word in ${FILE}`)
    expect(context[0]).toContain('.claude/worker-briefing.md')
    expect(context[0]).toContain('I7 (missed 1 turn): "Use the red cape"')
    expect(context[0]).toContain('action "next" now')
    // The board was asked as the chat under its new session id, and the work tool answers for it.
    expect(sent(w).at(-1)).toEqual({ action: 'next', chat: 'Units', session: 'units-2' })
    const answered = await $.tool.call({ tool: WORK, action: 'next' } as never)
    expect(answered.result).toBe('Yours, Units: B13 (queued).')
    expect(sent(w).at(-1)).toEqual({ action: 'next', chat: 'Units', session: 'units-2' })
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('○ Units  free')
  })

  test('neither the clear nor the start after it is a turn that ends: only the next real turn tells the board its end', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    await cleared($, w)
    await settle()
    expect(sent(w).filter(one => one.action === 'turn-ended').length).toBe(1)
    // The fresh conversation's first turn ends without closing I7: its end is told, as for any turn.
    await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    const ends = sent(w).filter(one => one.action === 'turn-ended')
    expect(ends.length).toBe(2)
    expect(ends[1]?.session).toBe('units-2')
  })

  test('a line the board puts out at the turn\'s end waits for the conversation after the clear', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    const LINE = 'work: B13 is yours; run work next'
    w.byAction['turn-ended'] = ok({ missed: [], open: [], role: 'worker', pause: RUNNING, pull: { text: LINE, id: 'B13', wake: { to: 'Units', id: 'B13' } } })
    w.waiting = [{ id: 'w1', text: LINE }]
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.typedIn).toEqual([])
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
    await cleared($, w)
    // The next tick takes it, into the new conversation.
    await clock.advance(5000)
    for (let i = 0; i < 50 && w.typedIn.length === 0; i++) await settle()
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
  })

  for (const [why, set, words] of [
    ['the person pauses', (w: World) => { w.byAction['turn-ended'] = ok({ missed: [], open: [], role: 'worker', pause: { ...RUNNING, state: 'pausing', since: 1 } }) }, 'the person pauses the chats'],
    ['a question the board did not file', (w: World) => { w.byAction['turn-ended'] = ok({ missed: [], open: [], role: 'worker', pause: RUNNING, unfiled: 1 }) }, 'did not file as an ask'],
    ['the log could not be saved', (w: World) => { w.byAction['save-log'] = { status: 409, text: 'Background work it started is still running: its answer would come into a cleared conversation.' } }, 'could not be saved as a log (Background work it started is still running'],
    ['a subagent still runs', (w: World) => { w.agents = [{ id: 'a1b2c3d4e5', name: 'judge' }] }, 'a subagent it started still runs (1)'],
    ['the board does not say it is a worker', (w: World) => { w.byAction['turn-ended'] = { status: 503, text: 'No store.' } }, 'did not say this chat is a worker'],
  ] as const) {
    test(`not cleared when ${why}: compacted as before, and the card says why`, async ($, on) => {
      mock.clock(on)
      const w = await worker($, on, null)
      set(w)
      const answer = why === 'a question the board did not file' ? 'In.\n\n> **For you**\n> 1. **Answer:** sheet A or B? I advise A.' : 'ok'
      await $.turn.complete({ ...ENDED, answer, turnId: 't1' })
      await wait(50)
      expect(w.commanded).toEqual([])
      expect(w.compactions.length).toBe(1)
      expect(w.compactions[0]).toContain('Its step is reported')
      expect(fileOf(w)?.clearNote?.why).toContain(words)
      expect(fileOf(w)?.clearing).toBeUndefined()
      expect(fileOf(w)?.compacted?.before).toBe(400_000)
    })
  }

  test('B547: a clear the board names at a take runs once the chat is idle: the log refused at the report (409) is asked again, then /clear', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on, null)
    w.byAction['save-log'] = { status: 409, text: 'Background work it started is still running: its answer would come into a cleared conversation.' }
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect([w.commanded, w.compactions.length]).toEqual([[], 1])
    expect(fileOf(w)?.clearNote?.why).toContain('Background work it started is still running')
    // The board names the clear while the work still runs: refused again, the card says so, and nothing is compacted.
    const named = (): void => { w.takeAnswers.push({ status: 200, text: JSON.stringify({ messages: [], clear: { step: 'B12', reportedAt: 1 } }) }) }
    named()
    await clock.advance(5000)
    for (let i = 0; i < 50 && w.sequence.filter(one => one === 'save-log').length < 2; i++) await settle()
    expect(w.sequence.filter(one => one === 'save-log').length).toBe(2)
    expect([w.commanded, w.compactions.length]).toEqual([[], 1])
    // Named again within the minute: not asked again.
    named()
    await clock.advance(5000)
    await settle()
    expect(w.sequence.filter(one => one === 'save-log').length).toBe(2)
    // The work has ended: a minute on, the log is kept and the chat cleared, its card marked for the conversation after.
    w.byAction['save-log'] = ok({ text: `Saving the conversation to ${FILE}.`, log: LOG, file: FILE })
    await clock.advance(60_000)
    named()
    await clock.advance(5000)
    for (let i = 0; i < 50 && w.commanded.length === 0; i++) await settle()
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
    expect(w.sequence.slice(-2)).toEqual(['save-log', '/clear'])
    expect(sent(w).filter(one => one.action === 'save-log').at(-1)).toEqual({ action: 'save-log', stepId: 'B12', chat: 'Units', session: 'units' })
    expect(fileOf(w)?.clearing?.step).toBe('B12')
    expect(w.compactions.length).toBe(1)
  })

  test('B547: a clear the board names is not run while a turn runs, nor when the card was cleared since the report', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on, null)
    // The turn of the report still runs: the board's word is not acted on.
    w.takeAnswers.push({ status: 200, text: JSON.stringify({ messages: [], clear: { step: 'B12', reportedAt: 1 } }) })
    await clock.advance(5000)
    await settle()
    expect(w.sequence).toEqual(['report'])
    // A card cleared after the report (the board read it before): nothing is run twice.
    w.files[`${CHATS}/units.json`] = chatText({ ...(fileOf(w) as ChatFile), cleared: { at: 10, step: 'B12', log: LOG } })
    w.byAction['turn-ended'] = { status: 503, text: 'The board restarts: try again in a moment.' }
    await $.turn.complete({ ...ENDED, answer: 'ok', turnId: 't1', reason: 'aborted' } as never)
    w.takeAnswers.push({ status: 200, text: JSON.stringify({ messages: [], clear: { step: 'B12', reportedAt: 5 } }) })
    await clock.advance(5000)
    await settle()
    expect(w.sequence.includes('save-log')).toBe(false)
    expect(w.commanded).toEqual([])
  })

  test('not cleared when more of the same work follows and it may not be cleared: then not compacted either, as before', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    w.byAction['save-log'] = { status: 503, text: 'This board keeps no chat logs.' }
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect([w.commanded, w.compactions]).toEqual([[], []])
    expect(fileOf(w)?.clearNote?.why).toContain('This board keeps no chat logs.')
    expect(fileOf(w)?.compactNote?.why).toBe('more of the same work follows')
  })

  test('a prompt that comes in while the log is asked for stops the clear', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    let release = (): void => {}
    w.holdAction = { action: 'save-log', until: new Promise<void>(done => { release = done }) }
    const ending = $.turn.complete({ ...ENDED, turnId: 't1' })
    for (let i = 0; i < 100 && !w.sequence.includes('save-log'); i++) await wait(5)
    expect(w.sequence).toContain('save-log')
    await $.prompt.submit({ text: 'one more thing', origin: { kind: 'composer' } } as never)
    release()
    await ending
    await wait(50)
    expect(w.commanded).toEqual([])
    expect(fileOf(w)?.clearNote?.why).toBe('a new prompt came in before the clear')
  })

  test('the /clear the mod queued runs only while nothing came in since: a turn that started first keeps its conversation', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
    // As if the queued /clear came only after a new turn had started: the turn drops the clear, its /clear is refused.
    await $.turn.start({ text: 'one more thing', turnId: 't2' })
    expect(fileOf(w)?.clearNote?.why).toBe('a new turn started before the clear ran')
    expect(fileOf(w)?.clearing).toBeUndefined()
    const ran = await $.command.run(CLEAR_BY_MOD)
    expect(ran.text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
  })

  test('review 1: a clear dropped while a turn runs long: the turn is told to the board, and the late /clear is refused, then and later', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    // The test kit runs the queued /clear at once (its new conversation never comes); a late one is run by hand below.
    w.commanded = []
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    const ends = (): number => sent(w).filter(one => one.action === 'turn-ended').length
    expect(ends()).toBe(1)
    // A prompt and its turn on the same session, running past the two minutes of the let-go.
    await $.prompt.submit({ text: 'one more thing', origin: { kind: 'composer' } } as never)
    await $.turn.start({ text: 'one more thing', turnId: 't2' })
    await clock.advance(3 * MIN)
    await settle()
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    // The real turn's end is told, also though a clear was on its way when it started.
    expect(ends()).toBe(2)
    // The /clear that was queued comes now, after the turn: refused; and the person's own /clear still runs.
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    await $.command.run({ ...CLEAR_ARGS, origin: { kind: 'composer' } } as never)
    expect(w.commanded).toEqual(['/clear by plugin folder-branches', '/clear by composer'])
  })

  test('review 1: should the engine run the mod\'s /clear as a turn, that turn is no turn of the chat\'s', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(fileOf(w)?.clearing?.step).toBe('B12')
    await $.turn.start({ text: '/clear', turnId: 'c1' })
    await $.turn.complete({ ...ENDED, turnId: 'c1' })
    // Nothing told, the clear still on its way.
    expect(sent(w).filter(one => one.action === 'turn-ended').length).toBe(1)
    expect(fileOf(w)?.clearing?.step).toBe('B12')
  })

  test('a mod that lost its word of the clear (a reload) finds the card by the mark it wrote; an old mark is not followed', async ($, on) => {
    const clock = mock.clock(on, { now: 50 * MIN })
    const marked: ChatFile = { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 40 * MIN, clearing: { at: 45 * MIN, step: 'B12', log: LOG } }
    const w = world('units-2', { ...listed({ units: marked, old: { ...marked, name: 'Archer', clearing: { at: 30 * MIN, step: 'B9', log: LOG } } }), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [] }) }
    await $.session.start(START)
    const started = await $.classic.SessionStart({ source: 'clear', session_title: 'Game - Units' })
    expect(started.additionalContext?.[0]).toContain('after your step B12 was reported, so this conversation starts empty. It is kept word for word in D:\\Work\\project\\.claude\\chat-logs\\Units\\2026-10-23 1405 B12.txt')
    expect(fileOf(w, 'units-2')).toEqual({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: clock.now(), cleared: { at: clock.now(), step: 'B12', log: LOG } })
    expect(JSON.parse(w.files[`${CHATS}/units.json`] ?? '{}').movedTo).toBe('units-2')
    // A mark twenty minutes old moves nothing.
    w.id = 'archer-2'
    expect((await $.classic.SessionStart({ source: 'clear', session_title: 'Game - Archer' })).additionalContext).toBeUndefined()
    expect(fileOf(w, 'old')?.name).toBe('Archer')
  })

  test('a start heard before the old conversation\'s end moves the card once', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    w.id = 'units-2'
    const started = await $.classic.SessionStart({ source: 'clear', session_title: 'Game - Units' })
    expect(started.additionalContext?.[0]).toContain('after your step B12 was reported')
    await $.session.end({ reason: 'clear', sessionId: 'units', resume: { id: 'units' } })
    await $.turn.start({ text: 'go on', turnId: 't2' })
    expect(JSON.parse(w.files[`${CHATS}/units.json`] ?? '{}').movedTo).toBe('units-2')
    expect(fileOf(w, 'units-2')?.cleared?.step).toBe('B12')
  })

  test('a new conversation no hook announced: the next tick moves the card, and its first prompt carries the words of its start', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    w.id = 'units-2'
    await clock.advance(5000)
    for (let i = 0; i < 50 && fileOf(w, 'units-2') === null; i++) await settle()
    expect(fileOf(w, 'units-2')?.cleared?.step).toBe('B12')
    await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
    expect(w.contexts.at(-1)?.join('\n')).toContain('after your step B12 was reported, so this conversation starts empty')
    await $.prompt.submit({ text: 'and more', origin: { kind: 'composer' } } as never)
    expect(w.contexts.at(-1)?.join('\n')).not.toContain('starts empty')
  })

  test('a /clear that neither ran nor was stopped is let go after two minutes: the card says so, and lines are typed in again', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(fileOf(w)?.clearing?.step).toBe('B12')
    w.waiting = [{ id: 'w1', text: 'work: B13 is yours; run work next' }]
    await clock.advance(5000)
    await settle()
    expect(w.typedIn).toEqual([])
    await clock.advance(2 * MIN)
    for (let i = 0; i < 50 && w.typedIn.length === 0; i++) await settle()
    expect(fileOf(w)?.clearing).toBeUndefined()
    expect(fileOf(w)?.clearNote?.why).toBe('/clear did not run within two minutes')
    expect(w.typedIn).toEqual(['plugin:as the person:work: B13 is yours; run work next'])
  })

  test('a /clear the person runs moves the card with its task; the start says so, without a log', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('B12 Give the golem', 1, 3, 20), at: 0 } }), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [], role: 'worker', missed: [] }) }
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    const context = await cleared($, w)
    expect(fileOf(w, 'units-2')?.task?.text).toBe('B12 Give the golem')
    expect(fileOf(w, 'units-2')?.cleared).toBeUndefined()
    expect(context[0]).toContain('Your earlier conversation was cleared, so this conversation starts empty.')
    expect(context[0]).not.toContain('kept word for word')
  })

  /** The report's turn's end, as the board answers it late: the turn's end is not held past a moment and a half. */
  async function endsSlowly($: Engine, clock: { advance: (ms: number) => Promise<void> }, w: World): Promise<() => void> {
    let release = (): void => {}
    w.holdAction = { action: 'turn-ended', until: new Promise<void>(done => { release = done }) }
    const ending = $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    await clock.advance(1500)
    await ending
    return release
  }
  const turnEnds = (w: World): number => w.sequence.filter(one => one === 'turn-ended').length

  test('slow answer: the board answers the report\'s turn\'s end after the turn\'s end: the decision waits for it, and the worker is cleared', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    const release = await endsSlowly($, clock, w)
    expect([w.commanded, fileOf(w)?.clearNote]).toEqual([[], undefined])
    // Meanwhile nothing is typed in: the line the board put out waits.
    w.waiting = [{ id: 'w1', text: 'work: B13 is yours; run work next' }]
    await clock.advance(1000)
    await settle()
    expect(w.typedIn).toEqual([])
    // The board answers (its report check took a few seconds).
    release()
    for (let i = 0; i < 50 && w.commanded.length === 0; i++) await settle()
    expect(w.sequence).toEqual(['report', 'turn-ended', 'save-log', '/clear'])
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
    expect(w.typedIn).toEqual([])
  })

  test('slow answer: the first call cut off, the second ask with the same request id answers: the worker is cleared', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    w.cuts = ['socket hang up']
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    for (let i = 0; i < 50 && w.commanded.length === 0; i++) await settle()
    expect(w.sequence).toEqual(['report', 'turn-ended', 'turn-ended', 'save-log', '/clear'])
    const ids = w.requests.slice(-3, -1)
    expect(ids[0]).toBe(ids[1])
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
  })

  test('slow answer: no answer at all within the 15 s: compacted as before, the card saying why', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on, null)
    w.cuts = Array.from({ length: 30 }, () => 'socket hang up')
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    for (let i = 0; i < 20 && w.compactions.length === 0; i++) {
      await clock.advance(1000)
      await settle()
    }
    expect(w.compactions.length).toBe(1)
    expect(fileOf(w)?.clearNote?.why).toBe('the board did not say this chat is a worker')
    expect(w.commanded).toEqual([])
    // Asked a few times in the 15 s, always under the same request id.
    expect(turnEnds(w)).toBeGreaterThan(2)
    expect(turnEnds(w)).toBeLessThan(10)
    expect(new Set(w.requests.slice(-turnEnds(w))).size).toBe(1)
  })

  test('slow answer: a prompt that comes in while the decision waits means no clear, and no compaction', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on, null)
    const release = await endsSlowly($, clock, w)
    await $.prompt.submit({ text: 'one more thing', origin: { kind: 'composer' } } as never)
    release()
    for (let i = 0; i < 50 && fileOf(w)?.clearNote === undefined; i++) await settle()
    expect(fileOf(w)?.clearNote?.why).toBe('a new prompt came in before the clear')
    expect([w.commanded, w.compactions, w.sequence.includes('save-log')]).toEqual([[], [], false])
  })

  test('review 4: the person\'s own /clear of a partner moves its card and tells it nothing of a worker', async ($, on) => {
    mock.clock(on)
    const w = world('advisor', { ...listed({ advisor: { name: 'Advisor', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    w.byAction = { 'turn-ended': ok({ missed: [], open: [], role: 'advisor', pause: RUNNING }), next: ok({ text: 'Yours:', open: [] }) }
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Advisor' })
    await $.turn.start({ text: 'refine', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.session.end({ reason: 'clear', sessionId: 'advisor', resume: { id: 'advisor' } })
    w.id = 'advisor-2'
    const started = await $.classic.SessionStart({ source: 'clear', session_title: 'Game - Advisor' })
    expect(started.additionalContext).toBeUndefined()
    expect(fileOf(w, 'advisor-2')?.name).toBe('Advisor')
    expect(JSON.parse(w.files[`${CHATS}/advisor.json`] ?? '{}').movedTo).toBe('advisor-2')
  })

  test('review 5: a new process of the mod before the /clear runs: the card\'s mark lets it run, and the start names the step and the log', async ($, on) => {
    const clock = mock.clock(on, { now: 50 * MIN })
    const marked: ChatFile = { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 49 * MIN, clearing: { at: 49 * MIN, step: 'B12', log: LOG } }
    const w = world('units', { ...listed({ units: marked }), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [] }) }
    await $.session.start(START)
    // The /clear the mod queued before it was loaded anew comes now: nothing came in since, the mark is a minute old.
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('')
    const context = await cleared($, w)
    expect(context[0]).toContain('after your step B12 was reported')
    expect(context[0]).toContain('2026-10-23 1405 B12.txt')
    expect(fileOf(w, 'units-2')?.cleared).toEqual({ at: clock.now(), step: 'B12', log: LOG })
  })

  test('review 5: a /clear of the mod with only a mark older than two minutes, or after a prompt, does not run', async ($, on) => {
    mock.clock(on, { now: 50 * MIN })
    const marked: ChatFile = { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 40 * MIN, clearing: { at: 47 * MIN, step: 'B12', log: LOG } }
    const w = world('units', { ...listed({ units: marked }), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    w.files[`${CHATS}/units.json`] = chatText({ ...marked, clearing: { at: 49 * MIN, step: 'B12', log: LOG } })
    await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    expect(w.commanded).toEqual([])
  })

  test('review 6: a prompt and the tick at once after a clear no hook announced: the card moves once, and the turn keeps its marks', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    w.id = 'units-2'
    w.writes = []
    const ticking = clock.advance(5000)
    const prompted = $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
    await Promise.all([ticking, prompted])
    for (let i = 0; i < 50 && fileOf(w, 'units-2') === null; i++) await settle()
    expect(w.writes.filter(path => path === `${CHATS}/units.json`).length).toBe(1)
    expect(w.contexts.at(-1)?.join(' ')).toContain('starts empty')
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await clock.advance(5000)
    await settle()
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(sent(w).filter(one => one.action === 'turn-ended').length).toBe(2)
  })

  test('review 7: a message to the main chat in the report\'s turn keeps the worker from being cleared', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on, null)
    await $.session.send({ to: 'Game - Main', text: 'Question from Game - Units: which shield?', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual([])
    expect(fileOf(w)?.clearNote?.why).toBe('it sent another chat a message in this turn and waits for its answer')
    expect(w.compactions.length).toBe(1)
  })

  test('review 8: a "For you" block of more items than the board is handed keeps the worker from being cleared', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on, null)
    const items = Array.from({ length: 10 }, (_one, i) => `> ${i + 1}. **Do:** look at sheet ${i + 1}.`).join('\n')
    w.byAction['turn-ended'] = ok({ missed: [], open: [], role: 'worker', pause: RUNNING, asked: [] })
    await $.turn.complete({ ...ENDED, answer: `In.\n\n> **For you**\n${items}`, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual([])
    expect(fileOf(w)?.clearNote?.why).toContain('did not file as an ask')
  })

  test('review 3 and 10: one /compact at rest on its way at a time; "compactAtRest": false stops it', async ($, on) => {
    mock.clock(on)
    const w = world('main', listed())
    stand(on, w)
    w.isHeadless = true
    let release = (): void => {}
    w.holdCompact = new Promise<void>(done => { release = done })
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Main' })
    w.tokens = 400_000
    for (const turnId of ['t1', 't2', 't3']) {
      await $.turn.start({ text: 'go', turnId })
      await $.turn.complete({ ...ENDED, turnId })
      await wait(20)
    }
    expect(w.commanded.length).toBe(1)
    release()
    await wait(50)
    w.holdCompact = null
    w.tokens = 400_000
    await $.turn.start({ text: 'go', turnId: 't4' })
    await $.turn.complete({ ...ENDED, turnId: 't4' })
    await wait(50)
    expect(w.commanded.length).toBe(2)
    // The list switches it off: no more, whatever the size.
    w.files[`${CHATS}/list.json`] = '{ "prefix": "Game - ", "main": "Main", "compactAtRest": false }\n'
    w.tokens = 400_000
    await $.turn.start({ text: 'go', turnId: 't5' })
    await $.turn.complete({ ...ENDED, turnId: 't5' })
    await wait(50)
    expect(w.commanded.length).toBe(2)
  })

  test('Main and the partners are never cleared; they are compacted at rest at the list\'s threshold', async ($, on) => {
    mock.clock(on)
    const list = '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear", "compactAbove": 150000 }'
    const w = world('advisor', { [`${CHATS}/list.json`]: `${list}\n`, [BOARD]: board })
    stand(on, w)
    w.byAction = { 'turn-ended': ok({ missed: [], open: [], role: 'advisor', pause: RUNNING }), report: ok({ id: 'B12', text: 'in', more: null }) }
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Advisor' })
    w.tokens = 140_000
    await $.turn.start({ text: 'refine', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(w.compactions).toEqual([])
    expect(fileOf(w)?.compactNote?.why).toBe('it is small enough')
    w.tokens = 160_000
    await $.turn.start({ text: 'refine more', turnId: 't2' })
    await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'checked' } as never)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    expect(w.compactions.length).toBe(1)
    expect(w.compactions[0]).toContain('the person\'s partner on the worker board (the Advisor)')
    expect(w.sequence).not.toContain('save-log')
    expect(w.commanded).toEqual([])
  })

  test('Redesign Part 1, Review Focus 1: the idle report goes out before the clear; while the clear runs the take is skipped, the report still goes every ping', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    w.reports = []
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
    expect(w.reports.map(body => JSON.parse(body).report.state)).toEqual(['idle'])
    expect(w.reportsAtClear).toEqual([1])
    // The clear is on its way until the conversation after it starts: no take, a report at every ping.
    const takes = w.fetched.filter(one => one.url.endsWith('/api/bridge/take')).length
    for (let i = 0; i < 3; i++) {
      await clock.advance(5000)
      await settle()
    }
    expect(w.fetched.filter(one => one.url.endsWith('/api/bridge/take')).length).toBe(takes)
    expect(w.reports.length).toBe(4)
    expect(w.reports.slice(1).map(saidBody)).toEqual(Array(3).fill({ chat: 'Units', session: 'units', report: { state: 'idle', since: 0, background: false } }))
  })

  test('the model cannot ask for the log itself', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    const before = w.worked.length
    expect((await $.tool.call({ tool: WORK, action: 'save-log' } as never)).result).toContain('the Workers mod\'s own call')
    expect(w.worked.length).toBe(before)
  })

  /** The supervisor's chat (the list's "supervisor"), at the start of a sweep's turn; the board answers its turn's end with `ended`. */
  async function watcher($: Engine, on: On, ended: { status: number; text: string }): Promise<World> {
    const w = world('watcher', { [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear", "supervisor": "Watcher" }\n', [BOARD]: board })
    stand(on, w)
    w.tokens = 400_000
    w.byAction = { 'turn-ended': ended }
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'sweep', session_title: 'Game - Watcher' })
    await $.turn.start({ text: 'sweep: run work health', turnId: 't1' })
    return w
  }

  test('the supervisor: its chat is cleared after every turn, without a log; its turn\'s end reaches the board first; the next conversation is told nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = await watcher($, on, ok({ text: 'No instruction was left open.', missed: [], open: [], role: 'supervisor', pause: RUNNING }))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    // No report and no step: the turn's end goes to the board, then /clear; no log is asked for, nothing is compacted.
    expect(w.sequence).toEqual(['turn-ended', '/clear'])
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
    expect(w.compactions).toEqual([])
    expect(w.toasts).toEqual([])
    expect(fileOf(w)?.clearing).toEqual({ at: clock.now(), step: null, log: null })
    await $.session.end({ reason: 'clear', sessionId: w.id, resume: { id: w.id } })
    w.id = 'watcher-2'
    const started = await $.classic.SessionStart({ source: 'clear', session_title: 'Game - Watcher' })
    expect([...(started.additionalContext ?? [])]).toEqual([])
    expect(fileOf(w, 'watcher-2')).toEqual({ name: 'Watcher', role: 'worker', state: 'waiting', task: null, at: clock.now(), cleared: { at: clock.now(), step: null, log: null } })
    // Every call to the board says the mod's version.
    expect(w.modHeaders.length).toBeGreaterThan(0)
    expect(w.modHeaders.every(one => one === MOD_VERSION)).toBe(true)
  })

  test('the supervisor: when the board does not answer its turn\'s end, the list of chats names it, and it is cleared all the same', async ($, on) => {
    mock.clock(on)
    const w = await watcher($, on, { status: 503, text: 'The board restarts: try again in a moment.' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin folder-branches'])
    expect(w.sequence.filter(one => one === 'save-log')).toEqual([])
  })

  test('the review: the supervisor\'s chat hands the board no "For you" block at its turn\'s end, also before the board named its role', async ($, on) => {
    mock.clock(on)
    const w = await watcher($, on, ok({ missed: [], open: [], role: 'supervisor', pause: RUNNING }))
    const answer = 'Filed X4.\n\n> **For you**\n> 1. **Answer:** Should the board wake Units now? I advise yes.'
    await $.turn.complete({ ...ENDED, answer, turnId: 't1' })
    await wait(50)
    const ended = sent(w).find(one => one.action === 'turn-ended')
    expect(ended?.forYou).toBeUndefined()
    // A worker's answer of the same words hands one item over (the block is one the mod reads).
    expect(forYouItems(answer).length).toBe(1)
  })

  test('the review: the list naming the main chat its supervisor never has the main chat cleared', async ($, on) => {
    mock.clock(on)
    const w = world('main', { [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main", "supervisor": "Main" }\n', [BOARD]: board })
    stand(on, w)
    w.byAction = { 'turn-ended': { status: 503, text: 'The board restarts: try again in a moment.' } }
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Game - Main' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded.filter(one => one.startsWith('/clear'))).toEqual([])
  })

  test('the supervisor: a subagent of it still running keeps it from being cleared, and its card says why', async ($, on) => {
    mock.clock(on)
    const w = await watcher($, on, ok({ missed: [], open: [], role: 'supervisor', pause: RUNNING }))
    w.agents = [{ id: 'a1', name: 'look' }]
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual([])
    expect(w.compactions).toEqual([])
    expect(fileOf(w)?.clearNote?.why).toBe('a subagent it started still runs (1)')
  })
})

describe('Redesign Part 1: the chat reports its turn state to the board', () => {
  const states = (w: World): string[] => w.reports.map(body => {
    const report = (JSON.parse(body) as { report: { state: string; background: boolean } }).report
    return report.background ? `${report.state}+background` : report.state
  })
  const FORM = { tool: 'AskUserQuestion', questions: [{ question: 'Which port?', header: 'Port', multiSelect: false, options: [{ label: '4320', description: 'free' }, { label: '4330', description: 'taken' }] }] }
  async function joined($: Engine, on: On): Promise<{ w: World; clock: ReturnType<typeof mock.clock> }> {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 503, text: 'No work store.' }
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Game - Units' })
    await settle()
    return { w, clock }
  }

  test("a turn's start reports busy at once, its end idle, each once, as the chat and its session, with the mod's version", async ($, on) => {
    const { w, clock } = await joined($, on)
    expect(w.reports).toEqual([])
    await clock.advance(1000)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await settle()
    expect(w.reports.map(saidBody)).toEqual([{ chat: 'Units', session: 'units', report: { state: 'busy', since: 1000, background: false } }])
    // A subagent's turn inside the chat's own changes nothing.
    await $.turn.start({ text: 'look', turnId: 't2', agentId: 'a1' })
    await $.turn.complete({ ...ENDED, turnId: 't2', agentId: 'a1' })
    await settle()
    expect(states(w)).toEqual(['busy'])
    await clock.advance(2000)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(w.reports.map(body => saidBody(body).report)).toEqual([{ state: 'busy', since: 1000, background: false }, { state: 'idle', since: 3000, background: false }])
    expect(w.modHeaders.every(one => one === MOD_VERSION)).toBe(true)
  })

  test('every take carries the report as it stands', async ($, on) => {
    const { w, clock } = await joined($, on)
    await clock.advance(5000)
    await settle()
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(5000)
    await settle()
    const takes = w.fetched.filter(one => one.url.endsWith('/api/bridge/take')).map(one => saidBody(one.body).report)
    expect(takes).toEqual([{ state: 'idle', since: 0, background: false }, { state: 'busy', since: 5000, background: false }])
  })

  test('the review of chat-reports, 6: every report and take counts up (seq) within its process (run), so the board orders them by no clock', async ($, on) => {
    const { w, clock } = await joined($, on)
    await clock.advance(1000)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await settle()
    await clock.advance(4000)
    await settle()
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    const order = (text: string): string => {
      const report = (JSON.parse(text) as { report: { state: string; run: number; seq: number } }).report
      return `${report.state} ${report.run} ${report.seq}`
    }
    // The session started at 0: its run. busy (1), the take at 5 s (2), idle (3).
    expect(w.reports.map(order)).toEqual(['busy 0 1', 'idle 0 3'])
    expect(w.fetched.filter(one => one.url.endsWith('/api/bridge/take')).map(one => order(one.body))).toEqual(['busy 0 2'])
  })

  test("a question to the person reports asking; the person's answer, busy again", async ($, on) => {
    const { w } = await joined($, on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.formAnswers = { 'Which port?': '4320' }
    await $.tool.call(FORM as never)
    await settle()
    expect(states(w)).toEqual(['busy', 'asking', 'busy'])
  })

  test('Review Focus 4: a turn that ends while the question is open stays asking until the answer', async ($, on) => {
    const { w } = await joined($, on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    let answer = (): void => {}
    w.formHold = new Promise<void>(resolve => {
      answer = resolve
    })
    const asked = $.tool.call(FORM as never)
    await settle()
    expect(states(w)).toEqual(['busy', 'asking'])
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(states(w)).toEqual(['busy', 'asking'])
    // The answer comes with no turn running: the chat is idle.
    answer()
    await asked
    await settle()
    expect(states(w)).toEqual(['busy', 'asking', 'idle'])
  })

  test("background work still running at the turn's end (the Stop hook's list) reports idle with background", async ($, on) => {
    const { w } = await joined($, on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'npm test' }] } as never)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background'])
    // Its end wakes the chat with a turn of its own; that turn's end, with nothing left running, is plain idle.
    await $.turn.start({ text: '', turnId: 't2' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background', 'busy', 'idle'])
  })

  test('the review of chat-reports, 5a: a turn cut short (no Stop hook runs) keeps the background work the last Stop listed', async ($, on) => {
    const { w } = await joined($, on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'npm test' }] } as never)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.turn.start({ text: 'more', turnId: 't2' })
    await $.turn.complete({ ...ENDED, reason: 'aborted', isAborted: true, turnId: 't2' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background', 'busy', 'idle+background'])
    // The next Stop that lists nothing ends it.
    await $.turn.start({ text: '', turnId: 't3' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
    await $.turn.complete({ ...ENDED, turnId: 't3' })
    await settle()
    expect(states(w).at(-1)).toBe('idle')
  })

  test('the review of chat-reports, 3a: a /clear is no end of the chat: it reports no ended', async ($, on) => {
    const { w } = await joined($, on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.session.end({ reason: 'clear', sessionId: w.id, resume: { id: w.id } } as never)
    await settle()
    expect(states(w)).toEqual(['busy', 'idle'])
  })

  test("the review of chat-reports, 3a: the session's end tells the board the chat ended, so it shows it not running at once", async ($, on) => {
    const { w } = await joined($, on)
    await $.session.end({ reason: 'other', sessionId: w.id, resume: { id: w.id } } as never)
    await settle()
    expect(w.reports.map(saidBody)).toEqual([{ chat: 'Units', session: 'units', report: { state: 'ended', since: 0, background: false } }])
  })

  test('a chat that is not in the list reports nothing', async ($, on) => {
    mock.clock(on)
    const w = world('other', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    await $.classic.UserPromptSubmit({ prompt: 'hello', session_title: 'Shopping list' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(w.reports).toEqual([])
  })
})

describe('2026-10-28: a chat learns which chat it is from the board, by its session id', () => {
  const KEY = 'ab'.repeat(32)
  const LOG = '.claude/chat-logs/Units/2026-10-28 0830 B12.txt'
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) await Promise.resolve()
  }
  /** Real time passing, for what the kit runs on its own timers. */
  const real = (ms: number): Promise<void> => new Promise(resolve => { (globalThis as unknown as { setTimeout: (done: () => void, ms: number) => void }).setTimeout(resolve, ms) })
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)
  const prompt = ($: Engine, text = 'who are you?'): Promise<unknown> => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
  const cardOf = (name: string, role: 'main' | 'worker' = 'worker', more: Partial<ChatFile> = {}): ChatFile => ({ name, role, state: 'waiting', task: null, at: 0, ...more })
  const startsWith = (w: World, index: number, words: string): boolean => w.contexts[index]?.some(line => line.startsWith(words)) ?? false

  test('it joins with no title at all: the board names its session, and every call carries the key and the mod\'s version', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.whoami = { name: 'Units', role: 'worker', card: null }
    stand(on, w)
    await $.session.start(START)
    // Asked while the chat is in no list yet, by its session's id alone.
    expect(w.whoamis).toEqual(['{"session":"units"}'])
    expect(w.whoamiHeaders).toEqual([{ 'Content-Type': 'application/json', 'X-Board-Key': KEY, 'X-Workers-Mod': MOD_VERSION }])
    expect(fileOf(w)).toEqual({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: clock.now() })
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('○ Units  free')
    // The mod then works as a chat of the list: the board is asked as it, by its name.
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.worked = []
    await $.tool.call({ tool: WORK, action: 'next' } as never)
    expect(sent(w)).toEqual([{ action: 'next', chat: 'Units', session: 'units' }])
  })

  test('the main chat of the list joins as the main chat', async ($, on) => {
    mock.clock(on)
    const w = world('main-id', { ...listed(), [BOARD]: board })
    w.whoami = { name: 'Main', role: 'main', card: null }
    stand(on, w)
    await $.session.start(START)
    expect(fileOf(w)?.role).toBe('main')
  })

  for (const [why, set] of [
      ['a session of no chat', (x: World) => { x.whoami = { name: null, role: null, card: null } }],
      ['an empty name', (x: World) => { x.whoami = { name: '  ', role: 'worker', card: null } }],
      ['a name that is no text', (x: World) => { x.whoami = { name: 7, role: 'worker', card: null } }],
      ['a name too long', (x: World) => { x.whoami = { name: 'N'.repeat(81), role: 'worker', card: null } }],
      ['an answer that is no JSON', (x: World) => { x.whoamiAnswer = { status: 200, text: '<html>' } }],
      ['a refusal', (x: World) => { x.whoamiAnswer = { status: 409, text: 'Another board process of this project runs the loops.' } }],
      ['a board that does not know the route', (x: World) => { x.whoamiAnswer = { status: 404, text: 'Not here.' } }],
  ] as const) {
    test(`${why}: the board was asked, and the chat joins nothing`, async ($, on) => {
      mock.clock(on)
      const w = world('other', { ...listed(), [BOARD]: board })
      set(w)
      stand(on, w)
      await $.session.start(START)
      expect(fileOf(w)).toBeNull()
      expect(w.whoamis.length).toBe(1)
    })
  }

  test('a name change is followed within a minute of the next prompt, and the board is asked once a minute at most per process', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.whoami = { name: 'Units', role: 'worker', card: null }
    stand(on, w)
    await $.session.start(START)
    expect(w.whoamis.length).toBe(1)
    // The person renamed the chat in the app: the next prompt, within the minute, asks nothing and keeps the name.
    w.whoami = { name: 'Sound', role: 'worker', card: null }
    await prompt($)
    await prompt($, 'and again')
    expect(w.whoamis.length).toBe(1)
    expect(fileOf(w)?.name).toBe('Units')
    expect(w.typedIn).toEqual(['composer:framed:who are you?', 'composer:framed:and again'])
    // A minute after the first question the next prompt asks again, and the chat goes on under the new name before its turn.
    await clock.advance(60_000)
    await settled()
    await prompt($, 'a minute on')
    expect(w.whoamis.length).toBe(2)
    expect([fileOf(w)?.name, fileOf(w)?.role, fileOf(w)?.state]).toEqual(['Sound', 'worker', 'waiting'])
    // And once more within the next minute: no question.
    await prompt($, 'right after')
    expect(w.whoamis.length).toBe(2)
    expect(w.typedIn.at(-1)).toBe('composer:framed:right after')
  })

  test('a word the mod types itself (the board\'s) asks nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.whoami = { name: 'Units', role: 'worker', card: null }
    stand(on, w)
    await $.session.start(START)
    await clock.advance(60_000)
    await settled()
    const before = w.whoamis.length
    await $.prompt.submit({ text: '(answered on the worker board, 11:05) Q2 "Box or yew?": yew', origin: { kind: 'plugin', name: 'folder-branches', asUser: true } } as never)
    expect(w.whoamis.length).toBe(before)
    expect(w.typedIn.at(-1)).toContain('Q2 "Box or yew?": yew')
    // The person's own prompt a minute on does ask.
    await prompt($)
    expect(w.whoamis.length).toBe(before + 1)
  })

  test('quiet when the board is down: nothing is joined, nothing throws, the prompt goes in', async ($, on) => {
    mock.clock(on)
    const down = world('units', { ...listed(), [BOARD]: board })
    down.up = []
    stand(on, down)
    await $.session.start(START)
    expect(fileOf(down)).toBeNull()
    await prompt($)
    expect(down.typedIn).toEqual(['composer:framed:who are you?'])
  })

  test('a board that holds the call holds the session start and a prompt a moment and a half at most', async ($, on) => {
    const clock = mock.clock(on)
    const held = world('units', { ...listed(), [BOARD]: board })
    held.whoamiHangs = true
    stand(on, held)
    const started = $.session.start(START)
    for (let i = 0; i < 100 && held.whoamis.length === 0; i++) await real(5)
    expect(held.whoamis.length).toBe(1)
    await clock.advance(1500)
    await started
    expect(fileOf(held)).toBeNull()
    // A prompt a minute on is held the same way, and goes in unnamed.
    await clock.advance(60_000)
    await settled()
    const submitted = prompt($, 'hello')
    for (let i = 0; i < 100 && held.whoamis.length < 2; i++) await real(5)
    expect(held.whoamis.length).toBe(2)
    expect(held.typedIn).toEqual([])
    await clock.advance(1500)
    await submitted
    expect(held.typedIn).toEqual(['composer:framed:hello'])
    expect(held.whoamis.length).toBe(2)
  })

  test('no board file: no question at all', async ($, on) => {
    mock.clock(on)
    const noBoard = world('units', listed())
    noBoard.whoami = { name: 'Units', role: 'worker', card: null }
    stand(on, noBoard)
    await $.session.start(START)
    await prompt($)
    expect(noBoard.whoamis).toEqual([])
  })

  test('no list of chats: no question at all', async ($, on) => {
    mock.clock(on)
    const noList = world('units', { [BOARD]: board })
    noList.whoami = { name: 'Units', role: 'worker', card: null }
    stand(on, noList)
    await $.session.start(START)
    await prompt($)
    expect(noList.whoamis).toEqual([])
  })

  test('a chat that was taken out stays out, whatever name the board gives its session', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board, [`${CHATS}/units.json`]: LEFT_TEXT })
    w.whoami = { name: 'Units', role: 'worker', card: null }
    stand(on, w)
    await $.session.start(START)
    await prompt($)
    expect(fileOf(w)).toBeNull()
    expect(w.files[`${CHATS}/units.json`]).toBe(LEFT_TEXT)
  })

  describe('a chat cleared in a process that knows nothing of it: its card is under the old session', () => {
    /** A new process: no clear in its memory, the app's new session, the card still under the old one, the board naming it. */
    function fresh(card: ChatFile, who: Record<string, unknown>, id = 'units-2', old = 'units'): World {
      const w = world(id, { ...listed({ [old]: card }), [BOARD]: board })
      w.whoami = who
      w.byAction = { next: { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [{ id: 'I7', turns: 1, text: 'Use the red cape' }] }) } }
      return w
    }
    const movedTo = (w: World, old = 'units'): unknown => (JSON.parse(w.files[`${CHATS}/${old}.json`] ?? '{}') as { movedTo?: unknown }).movedTo

    test('a worker the mod cleared: the card moves to its own session at the start, and its first prompt carries the start\'s words with the log', async ($, on) => {
      const clock = mock.clock(on)
      const w = fresh(cardOf('Units', 'worker', { clearing: { at: 0, step: 'B12', log: LOG } }), { name: 'Units', role: 'worker', card: 'units' })
      stand(on, w)
      await $.session.start(START)
      expect(movedTo(w)).toBe('units-2')
      expect(fileOf(w, 'units-2')).toEqual({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: clock.now(), cleared: { at: clock.now(), step: 'B12', log: LOG } })
      // The board is asked as the chat under its own session, and the work tool answers for it.
      expect(sent(w).at(-1)).toEqual({ action: 'next', chat: 'Units', session: 'units-2' })
      // The words wait for the first prompt: who it is, its rules, the log, the open instructions, and work next.
      await prompt($)
      const words = w.contexts[0]?.filter(line => line.startsWith('This chat is')) ?? []
      expect(words.length).toBe(1)
      expect(words[0]).toContain('This chat is "Game - Units", a worker')
      expect(words[0]).toContain('after your step B12 was reported, so this conversation starts empty')
      expect(slashed(words[0] ?? '')).toContain('D:/Work/project/.claude/chat-logs/Units/2026-10-28 0830 B12.txt')
      expect(words[0]).toContain('I7 (missed 1 turn): "Use the red cape"')
      expect(words[0]).toContain('action "next" now')
      // Said once.
      await prompt($, 'and again')
      expect(startsWith(w, 1, 'This chat is')).toBe(false)
      expect(movedTo(w)).toBe('units-2')
    })

    test('a worker the person cleared (no mark on the card) is told the same, without a log', async ($, on) => {
      mock.clock(on)
      const w = fresh(cardOf('Units'), { name: 'Units', role: 'worker', card: 'units' })
      stand(on, w)
      await $.session.start(START)
      expect(movedTo(w)).toBe('units-2')
      expect(fileOf(w, 'units-2')?.cleared).toBeUndefined()
      await prompt($)
      const words = w.contexts[0]?.find(line => line.startsWith('This chat is')) ?? ''
      expect(words).toContain('a worker in the person\'s list of chats, listed as "Units"')
      expect(words).toContain('Your earlier conversation was cleared, so this conversation starts empty.')
      expect(words).not.toContain('by the Workers mod')
      expect(words).not.toContain('chat-logs')
    })

    test('a board that names the chat only at a prompt a minute later: the move and the words come with that very prompt', async ($, on) => {
      const clock = mock.clock(on)
      const w = fresh(cardOf('Units'), { name: null, role: null, card: null })
      stand(on, w)
      await $.session.start(START)
      expect(fileOf(w, 'units-2')).toBeNull()
      await clock.advance(60_000)
      await settled()
      w.whoami = { name: 'Units', role: 'worker', card: 'units' }
      await prompt($)
      expect(movedTo(w)).toBe('units-2')
      expect(startsWith(w, 0, 'This chat is "Game - Units", a worker')).toBe(true)
    })

    for (const [role, name, kind] of [['main', 'Main', 'main'], ['advisor', 'Advisor', 'worker'], ['helper', 'Advisor 2', 'worker'], ['supervisor', 'Supervisor', 'worker']] as const) {
      test(`the ${role} chat: the card moves, and no start's words are given`, async ($, on) => {
        const clock = mock.clock(on)
        const w = fresh(cardOf(name, kind), { name, role, card: 'old-id' }, 'new-id', 'old-id')
        stand(on, w)
        await $.session.start(START)
        expect(movedTo(w, 'old-id')).toBe('new-id')
        expect(fileOf(w, 'new-id')).toEqual({ name, role: kind, state: 'waiting', task: null, at: clock.now() })
        await prompt($)
        expect(startsWith(w, 0, 'This chat is')).toBe(false)
        expect(w.typedIn[0]).toBe('composer:framed:who are you?')
      })
    }

    test('the board gives no role: the card of the main chat says it, and no words are given', async ($, on) => {
      mock.clock(on)
      const asMain = fresh(cardOf('Main', 'main'), { name: 'Main', card: 'units' })
      stand(on, asMain)
      await $.session.start(START)
      await prompt($)
      expect(startsWith(asMain, 0, 'This chat is')).toBe(false)
      expect(fileOf(asMain, 'units-2')?.role).toBe('main')
    })

    test('the board gives no role: the list names the supervisor, and no words are given', async ($, on) => {
      mock.clock(on)
      const asSupervisor = fresh(cardOf('Watcher'), { name: 'Watcher', card: 'units' })
      asSupervisor.files[`${CHATS}/list.json`] = '{ "prefix": "Game - ", "main": "Main", "supervisor": "Watcher" }\n'
      stand(on, asSupervisor)
      await $.session.start(START)
      await prompt($)
      expect(startsWith(asSupervisor, 0, 'This chat is')).toBe(false)
      expect(movedTo(asSupervisor)).toBe('units-2')
    })

    test('the board gives no role: any other card is a worker\'s, and gets the words', async ($, on) => {
      mock.clock(on)
      const asWorker = fresh(cardOf('Units'), { name: 'Units', card: 'units' })
      stand(on, asWorker)
      await $.session.start(START)
      await prompt($)
      expect(startsWith(asWorker, 0, 'This chat is "Game - Units", a worker')).toBe(true)
    })

    test('a chat whose card is already under its own session gets nothing: no move, no words, though an older card of its name stands beside it', async ($, on) => {
      const clock = mock.clock(on)
      const w = fresh(cardOf('Units', 'worker', { task: task('B12 Give the golem', 1, 3, 20) }), { name: 'Units', role: 'worker', card: null })
      w.files[`${CHATS}/units-2.json`] = chatText(cardOf('Units', 'worker', { task: task('B13 The cape', 2, 4, 30), at: 5 }))
      stand(on, w)
      await $.session.start(START)
      await prompt($)
      expect(movedTo(w)).toBeUndefined()
      expect(fileOf(w, 'units')?.task?.text).toBe('B12 Give the golem')
      expect(fileOf(w, 'units-2')?.task?.text).toBe('B13 The cape')
      expect(startsWith(w, 0, 'This chat is')).toBe(false)
      // Not even when a board that is behind still names the old session: the file of its own is never written over.
      w.whoami = { name: 'Units', role: 'worker', card: 'units' }
      await clock.advance(60_000)
      await settled()
      await prompt($, 'again')
      expect(w.whoamis.length).toBe(2)
      expect(movedTo(w)).toBeUndefined()
      expect(fileOf(w, 'units-2')?.task?.text).toBe('B13 The cape')
    })

    test('a card named under a session that holds none: nothing moves, the chat joins as it is named', async ($, on) => {
      mock.clock(on)
      const gone = fresh(cardOf('Units'), { name: 'Units', role: 'worker', card: 'nowhere' })
      stand(on, gone)
      await $.session.start(START)
      expect(fileOf(gone, 'units-2')?.name).toBe('Units')
      expect(movedTo(gone)).toBeUndefined()
    })

    test('a card of another name under the named session moves nothing', async ($, on) => {
      mock.clock(on)
      const other = fresh(cardOf('Sound'), { name: 'Units', role: 'worker', card: 'units' })
      stand(on, other)
      await $.session.start(START)
      expect(movedTo(other)).toBeUndefined()
      expect(fileOf(other, 'units')?.name).toBe('Sound')
    })
  })
})
