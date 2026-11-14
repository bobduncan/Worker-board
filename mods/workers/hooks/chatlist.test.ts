import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import type { ChatFile, ChatTask } from '../types'
import { LEFT_TEXT, chatText, parseChat } from './chats'
import { forYouItems } from './foryou'
import { MOD_VERSION, WORK_ACTIONS } from './board'

const TOOL = 'mcp__workers__chat'
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
  /** 0.31.1: each file's time, moved on by every write (the mod's card cache reads size and time). */
  mtimes: Record<string, number>
  /** 0.31.1 (F4): a hold on every card write (the chain stuck behind a slow write), released by the test. */
  writeHold: Promise<void> | null
  /** Chat 1's verifier (14): a hold on the chats folder's listing (a reading of the cards in flight). */
  listHold: Promise<void> | null
  /** Chat 1's verifier (9): every card text written, in order (what a write said before a later one). */
  cardTexts: string[]
  /** 0.31.1 (F4): every file read, in order (the card scan's cache is judged by what it reads again). */
  reads: string[]
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
  /** 5c (0.30.0): each start of a board through the launcher: the log its output goes to and its folder. */
  launched: { log: string; cwd: string }[]
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
  /** Goal definition (2026-10-31): the input schema each tool was registered with, by its name. */
  schemas: Record<string, unknown>
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
  /** The review of 0.30.0: what the app does before a typed prompt's submit resolves (its turn starting, the clock moving). */
  beforeTyped?: ($: Engine, text: string) => Promise<void>
  /** T8.5: everything that went out, in one order: each work call's action, each /clear, each prompt typed in ("prompt"), each typed report ("typed"). */
  order: string[]
  /** The lazy clear (the Task 2 review): the mod's store refuses to delete; a /clear the test holds; the store at each /clear. */
  storeDeleteFails?: boolean
  holdClear?: Promise<void> | null
  storedAtClear?: Record<string, unknown>[]
  /** The whole-branch review: the next call of `$.session.id()` (only that one) resolves once this does, then it is taken out. */
  holdNextId?: Promise<void> | null
}

/** The review of chat-reports: a report as the board reads what it says, without its order (`run`, `seq`); 8c's `word` and `turn` are tested apart. */
function said(report: Record<string, unknown>): Record<string, unknown> {
  const { run: _run, seq: _seq, word: _word, turn: _turn, ...rest } = report
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
/** Chat 1's verifier (2): the form's bookkeeping runs detached from the tool's result: a real moment for it (the kit's host ops take macrotasks). */
const afterForm = (ms = 20): Promise<void> => new Promise(resolve => { (globalThis as unknown as { setTimeout: (done: () => void, ms: number) => void }).setTimeout(resolve, ms) })

function world(id: string, files: Record<string, string> = {}): World {
  return { id, files, mtimes: {}, writeHold: null, listHold: null, cardTexts: [], reads: [], agents: [], tools: [], opened: [], sent: [], whileAsked: null, waiting: [], takeAnswers: [], fetched: [], typedIn: [], reported: [], refusesTyping: false, up: null, spawned: [], launched: [], comesUp: true, tokens: 50_000, refusesCompact: false, isHeadless: false, commanded: [], compactions: [], toasts: [], worked: [], workAnswer: { status: 200, text: '{"text":"Yours, Units:"}' }, formAnswers: {}, workAnswers: [], formResponse: null, formCloses: false, hangs: false, takeHangs: false, contexts: [], workedAt: [], pauseAnswer: RUNNING, pauseReads: 0, descriptions: {}, schemas: {}, stored: {}, requests: [], cuts: [], held: null, byAction: {}, holdAction: null, sequence: [], holdCompact: null, writes: [], modHeaders: [], reports: [], formHold: null, reportsAtClear: [], whoamis: [], whoami: { name: null, role: null, card: null }, whoamiAnswer: null, whoamiHeaders: [], whoamiHangs: false, order: [] }
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
  on('session.id', async () => {
    const hold = w.holdNextId
    if (hold !== undefined && hold !== null) {
      w.holdNextId = null
      await hold
    }
    return { value: w.id }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => {
    w.tools.push(`${e.name}:${String(e.isDeferred)}`)
    w.descriptions[e.name] = e.description
    w.schemas[e.name] = (e as { inputSchema?: unknown }).inputSchema

    return { value: { tool: `mcp__workers__${e.name}` } }
  })
  on('agent.list', () => ({ value: w.agents.map(a => ({ ...a, description: '', type: 'general-purpose', status: 'running' as const })) }))
  on('ui.open', (_$, e) => {
    w.opened.push(`${e.id}:${e.title}`)

    return { value: { isPlaced: true } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: w.tokens, window: 1_000_000, percent: Math.round(w.tokens / 10_000) }, rateLimits: [] } }))
  on('command.run', { command: 'clear' }, async (_$, e) => {
    w.commanded.push(`/clear by ${e.origin.kind}${e.origin.kind === 'plugin' ? ` ${e.origin.name}` : ''}`)
    w.sequence.push('/clear')
    w.order.push('/clear')
    w.reportsAtClear.push(w.reports.length)
    ;(w.storedAtClear ??= []).push(JSON.parse(JSON.stringify(w.stored)) as Record<string, unknown>)
    if (w.holdClear !== undefined && w.holdClear !== null) await w.holdClear
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
  on('store.delete', (_$, e) => {
    if (w.storeDeleteFails === true) throw new Error('the store could not be written')
    delete w.stored[e.key]

    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    w.reads.push(slashed(e.path))
    const text = w.files[slashed(e.path)]

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', async (_$, e) => {
    if (w.writeHold !== null && slashed(e.path).startsWith(`${CHATS}/`)) await w.writeHold
    w.writes.push(slashed(e.path))
    if (slashed(e.path).startsWith(`${CHATS}/`)) w.cardTexts.push(e.text)
    w.files[slashed(e.path)] = e.text
    w.mtimes[slashed(e.path)] = (w.mtimes[slashed(e.path)] ?? 1) + 1

    return { value: undefined }
  })
  on('fs.list', async (_$, e) => {
    const path = slashed(e.path)
    if (path === slashed(ROOT)) return { value: [] }
    if (w.listHold !== null && path === CHATS) await w.listHold
    const names = Object.keys(w.files).filter(known => known.startsWith(`${path}/`)).map(known => known.slice(path.length + 1))
    const entries: FsEntry[] = names.filter(name => !name.includes('/')).map(name => ({ name, kind: 'file', size: (w.files[`${path}/${name}`] ?? '').length, mtimeMs: w.mtimes[`${path}/${name}`] ?? 1, isLink: false }))

    return names.length === 0 ? { deny: 'no such folder' } : { value: entries }
  })
  on('process.run', (_$, e) => {
    // 5c (0.30.0): the board's launcher (node -e, `--`, then the log, the folder and the board's own command): it starts the board
    // detached, its output to the log, and exits at once.
    if (e.argv[1] === '-e') {
      w.spawned.push(e.argv.slice(6).join(' '))
      w.launched.push({ log: e.argv[4] ?? '', cwd: e.argv[5] ?? '' })
      if (w.comesUp) w.up?.push('http://127.0.0.1:4310/')
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
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
      const pauseValue = w.pauseAnswer === null ? { status: 400, ok: false, headers: {}, text: 'Unknown action.' } : { status: 200, ok: true, headers: {}, text: JSON.stringify(w.pauseAnswer) }
      // Chat 1's verifier (4): a pause reading held by the test, as a work action is.
      const pauseHold = w.holdAction?.action === 'pause-state' ? w.holdAction.until : null
      return pauseHold === null ? { value: pauseValue } : pauseHold.then(() => ({ value: pauseValue }))
    }
    if (e.url.endsWith('/api/bridge/work')) {
      const action = String((JSON.parse(e.init?.body ?? '{}') as { action?: unknown }).action)
      w.sequence.push(action)
      w.order.push(action)
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
      // The lazy clear (0.31.0): a post of a clear's stages alone (no outcome) is told apart: `stage:<its stages>`.
      const posted = JSON.parse(e.init?.body ?? '{}') as { outcome?: unknown; stages?: { stage: string }[] }
      w.order.push(posted.outcome === undefined && Array.isArray(posted.stages) ? `stage:${posted.stages.map(one => one.stage).join(',')}` : 'typed')

      return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
    }
    w.fetched.push({ url: e.url, key: e.init?.headers?.['X-Board-Key'] ?? '', body: e.init?.body ?? '' })
    if (w.takeHangs && e.url.endsWith('/api/bridge/take')) return new Promise<never>(() => {})
    const refused = e.url.endsWith('/api/bridge/take') ? w.takeAnswers.shift() : undefined
    if (refused !== undefined) return { value: { status: refused.status, ok: refused.status === 200, headers: {}, text: refused.text } }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ messages: w.waiting.splice(0) }) } }
  })
  on('prompt.submit', async ($$, e) => {
    if (w.refusesTyping) return { drop: 'no prompt is taken now' }
    if (w.beforeTyped !== undefined) await w.beforeTyped($$ as never, e.text)
    w.order.push('prompt')
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
const GIT = { ...PANE, requestId: 'git', props: { ...PANE.props, title: 'Git' } } as const

const START = { cwd: ROOT, surface: 'desktop', isInteractive: true } as const
const ASKED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
/** What finds the line of the chat with this name in the pane: its mark, its name, then the rest. */
const lineOf = (name: string) => ({ type: 'Text', text: new RegExp(`^. ${name}  `) }) as const

const ENDED = { answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' } as const
const BY_MODEL = { origin: { kind: 'model' } } as const
/** B297: where the worker board says it is, with its key, and the work tool the mod registers. */
const BOARD = 'D:/Work/project/.claude/board.json'
const board = JSON.stringify({ url: 'http://127.0.0.1:4311', key: 'ab'.repeat(32), startedAt: 1 })
const WORK = 'mcp__workers__work'

/** B301: the chat reports its step with the work tool, and the board takes it, naming the chat's next step (`more`) or none. */
async function reported($: { tool: { call(input: never): Promise<unknown> } }, w: World, more: string | null = null): Promise<void> {
  w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12 is in review: the board checks it.', more }) }
  await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
}

/**
 * The chat starts as one of the project's: the board names its session (`w.whoami`, the kit's whoami answer; a null name is a
 * session of no chat), and the start joins it under that name, as on every login (the mod has no title and no classic hook).
 * The board's file is put in for the start only when the test keeps none (the board is asked who the chat is), and what the
 * start itself asked of the board (its "next") is left out of what the test counts afterwards.
 */
async function startedAs($: Engine, w: World, name: string | null): Promise<void> {
  w.whoami = { name, role: null, card: null }
  const lent = w.root === undefined && w.files[BOARD] === undefined
  if (lent) w.files[BOARD] = board
  await $.session.start(START)
  await settle()
  if (lent) delete w.files[BOARD]
  w.worked = []
  w.workedAt = []
  w.requests = []
  w.sequence = []
}

/** A Bash tool beneath the mod that runs whatever it is given; the commands it ran are listed in the array it returns. */
function bash(on: On, ran: string[] = []): string[] {
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push(String((e as { command?: unknown }).command))
    return { result: 'done' } as never
  })
  return ran
}

/** The chat's standing note as the work tool's description carries it (from "This chat is"), or undefined while it has none. */
function noteOf(w: World): string | undefined {
  const text = w.descriptions.work ?? ''
  const at = text.indexOf('This chat is "')
  return at < 0 ? undefined : text.slice(at)
}

describe('a chat keeps its own line in the list', () => {
  test('it joins as the board names its session, and its task, step and time show while it works', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    // The project keeps a list: the tool is in reach from the start, and nothing is listed yet (the board names no chat).
    expect(w.tools).toEqual(['chat:false', 'work:false'])
    expect(fileOf(w)).toBeNull()

    // The board names the session now: the chat joins at its next prompt.
    w.whoami = { name: 'Units', role: null, card: null }
    await $.prompt.submit({ text: 'the archer', ...ASKED } as never)
    expect(fileOf(w)).toEqual({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: clock.now() })
    await $.turn.start({ text: 'the archer', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
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
    // Chat 1's verifier (2): the card's working after the form runs detached from the tool's result.
    await settle()
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
      const ui = await $.ui.mount({ plugin: 'workers', surface, ...PANE })
      const drawn: string[] = []
      for (const name of ['Main', 'Cleanup', 'Features', 'Levels', 'Units']) drawn.push((await ui.find(lineOf(name)))?.text ?? '')
      expect(drawn).toEqual(LINES)
      expect(await ui.find({ type: 'Text', text: /folder/ })).toBeUndefined()
      await ui.unmount()
      const git = await $.ui.mount({ plugin: 'workers', surface, ...GIT })
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
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
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
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
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
    const clock = mock.clock(on, { now: 5000 })
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
    // The standing note is in the work tool's description (the next tick registers it).
    await clock.advance(5000)
    await settle()
    expect(noteOf(w)).toContain('This chat is "Units"')
  })

  test('of two files under one name the list shows the chat written last, and neither puts the other out', async ($, on) => {
    mock.clock(on, { now: 5000 })
    const w = world('new', { ...listed({ old: { ...ARCHER, state: 'waiting' }, main: { name: 'Main', role: 'main', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    // The older chat's open task counts while it is the one in the list.
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('◆ Main  waiting for 1 worker\n◐ Units  your turn · Skeleton Archer · 2 of 5')
    // The board names this session Units: it joins at its next prompt, beside the older file of that name.
    w.whoami = { name: 'Units', role: null, card: null }
    await $.prompt.submit({ text: 'hi', ...ASKED } as never)
    expect(fileOf(w, 'old')?.task?.text).toBe('Skeleton Archer')
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('◆ Main  free\n○ Units  free')
    // Taking the name out takes every file under it out.
    expect((await $.tool.call({ tool: TOOL, action: 'leave', name: 'Units' })).result).toBe('"Units" is out of the list.')
    expect(fileOf(w, 'old')).toBeNull()
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('◆ Main  free')
  })

  test('the note in the work tool\'s description reads the same through a task, and goes when the chat leaves', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', listed({ units: { ...ARCHER, state: 'waiting', task: null } }))
    stand(on, w)
    await $.session.start(START)
    // The tick registers the description once the chat knows who it is; each look lets one tick pass.
    const note = async (): Promise<string | undefined> => {
      await clock.advance(5000)
      await settle()
      return noteOf(w)
    }
    const first = await note()
    expect(first).toContain('This chat is "Units"')
    const registered = w.tools.length
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer', steps: 5, minutes: 40 })
    expect(await note()).toBe(first)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    await $.tool.call({ tool: TOOL, action: 'step' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(await note()).toBe(first)
    // The same words are not registered again: the tool's description stays as it was, so the conversation stays cached.
    expect(w.tools.length).toBe(registered)
    await $.tool.call({ tool: TOOL, action: 'leave' })
    expect(await note()).toBeUndefined()
  })
})

describe('who is in the list', () => {
  test('a chat in the list is told how the list is kept, in its work tool\'s description; any other chat is told nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await $.session.start(START)
    expect(noteOf(w)).toBeUndefined()
    // A session the board names no chat of the project is none of the project's.
    await $.prompt.submit({ text: 'hi', ...ASKED } as never)
    expect(fileOf(w)).toBeNull()
    expect(noteOf(w)).toBeUndefined()
    // The board names it Units now: its next prompt joins it, and the description carries the note.
    w.whoami = { name: 'Units', role: null, card: null }
    await $.prompt.submit({ text: 'hi', ...ASKED } as never)
    expect(noteOf(w)).toContain('This chat is "Units"')
    expect(noteOf(w)).toContain(TOOL)
    // Renamed by the person: a minute on the list follows, and the main chat is the one the project names.
    w.whoami = { name: 'Main', role: 'main', card: null }
    await clock.advance(60_000)
    await settle()
    await $.prompt.submit({ text: 'hi', ...ASKED } as never)
    expect(fileOf(w)?.name).toBe('Main')
    expect(fileOf(w)?.role).toBe('main')
    expect(noteOf(w)).toContain('You are the main chat')
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
    const w = world('units', { ...listed({ old: { name: 'Sound', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('○ Sound  free\n○ Units  free')
    expect((await $.tool.call({ tool: TOOL, action: 'leave', name: 'sound' })).result).toBe('"Sound" is out of the list.')
    expect((await $.tool.call({ tool: TOOL, action: 'leave', name: 'Music' })).result).toBe('No chat in the list is named "Music".')
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('○ Units  free')
    expect((await $.tool.call({ tool: TOOL, action: 'leave' })).result).toBe('This chat is out of the list.')
    // The board still names its session one of the project's chats: it stays out all the same.
    await $.prompt.submit({ text: 'hi', ...ASKED } as never)
    expect(w.whoamis.length).toBe(2)
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
    await $.prompt.submit({ text: 'hi', ...ASKED } as never)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.session.send({ to: 'someone', text: 'hi', ...BY_MODEL })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    expect(w.files).toEqual({})
    expect(noteOf(w)).toBeUndefined()
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'terminal', ...GIT })
    expect(await ui.find({ type: 'Text', text: 'This folder holds no folders.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /free|working|your turn/ })).toBeUndefined()
    await ui.unmount()
    const workers = await $.ui.mount({ plugin: 'workers', surface: 'terminal', ...PANE })
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
    await startedAs($, w, 'Units')
    w.waiting.push({ id: 'm1', text: '(answered on the worker board, 16:02) B14 "The walk": approved. Tick this step in the backlog.' })
    await clock.advance(5000)
    await settle()

    // It says who asks: the chat's name and its session, so the board serves only the chat it shows under that name.
    // Redesign Part 1: every take carries the chat's report of its turn state (idle since the session started).
    expect(w.fetched[0]).toEqual({ url: 'http://127.0.0.1:4311/api/bridge/take', key: KEY, body: '{"chat":"Units","session":"units","report":{"state":"idle","since":0,"background":false,"run":0,"seq":1,"word":null,"turn":null}}' })
    expect(w.reported).toEqual(['{"chat":"Units","session":"units","typed":["m1"],"failed":[]}'])
    expect(w.typedIn).toEqual(['plugin:as the person:(answered on the worker board, 16:02) B14 "The walk": approved. Tick this step in the backlog.'])

    // A board that hands the same message out again does not get it typed twice.
    w.waiting.push({ id: 'm1', text: 'again' }, { id: 'm2', text: 'Sheet B' })
    await clock.advance(5000)
    await settle()
    expect(w.typedIn.map(line => line.split(':').pop())).toEqual([' approved. Tick this step in the backlog.', 'Sheet B'])
  })

  test('2c (0.30.0): the take\'s `off` draws nothing any more (the board\'s status says "Not running"); a board that does not answer leaves the files\' words', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const w = world('units', { ...listed({
      units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 },
      cleanup: { name: 'Cleanup', role: 'worker', state: 'waiting', task: null, at: 0 },
    }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
    const cleanup = async (): Promise<string | undefined> => {
      for (let i = 0; i < 10; i++) await settle()
      return (await ui.find(lineOf('Cleanup')))?.text
    }
    expect(await cleanup()).toBe('○ Cleanup  free')
    w.takeAnswers.push({ status: 200, text: JSON.stringify({ messages: [], off: ['Cleanup'] }) })
    await clock.advance(5000)
    // Mutant "read off again": the line would read "Not running" from `off` alone.
    expect(await cleanup()).toBe('○ Cleanup  free')
    // The board went down: its last verdict is not kept.
    w.takeAnswers.push({ status: 503, text: 'The board restarts: try again in a moment.' })
    await clock.advance(5000)
    expect(await cleanup()).toBe('○ Cleanup  free')
  })

  /** 2c (0.28.0): the pane with `listed()` chats Units (this chat) and Cleanup, the board's take answers by hand. */
  async function paneWorld($: Engine, on: On, now = 1000): Promise<{ w: World; clock: ReturnType<typeof mock.clock>; ui: Awaited<ReturnType<Engine['ui']['mount']>>; text: (name: string) => Promise<string | undefined> }> {
    const clock = mock.clock(on, { now })
    const w = world('units', { ...listed({
      units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 },
      cleanup: { name: 'Cleanup', role: 'worker', state: 'waiting', task: null, at: 0 },
    }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
    const text = async (name: string): Promise<string | undefined> => {
      for (let i = 0; i < 10; i++) await settle()
      return (await ui.find(lineOf(name)))?.text
    }
    return { w, clock, ui, text }
  }
  const answer = (statuses: unknown[] | null): { status: number; text: string } => ({ status: 200, text: JSON.stringify(statuses === null ? { messages: [] } : { messages: [], statuses }) })
  const status = (name: string, statusName: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ name, status: statusName, why: null, tone: 'quiet', since: null, reportAt: 0, ...more })

  test('2c: the pane shows the board\'s status per chat, the tone bold, and the chat tool\'s list says the same', async ($, on) => {
    const { w, clock, ui, text } = await paneWorld($, on, 100_000)
    expect(await text('Cleanup')).toBe('○ Cleanup  free')
    w.takeAnswers.push(answer([status('Units', 'Working', { reportAt: 80_000 }), status('Cleanup', 'Not running', { tone: 'attention', why: 'its chat is closed', reportAt: 80_000 })]))
    await clock.advance(5000)
    expect(await text('Cleanup')).toBe('○ Cleanup  Not running · its chat is closed · 25 s ago')
    expect(await text('Units')).toBe('● Units  Working · 25 s ago')
    // The attention line is bold; the quiet one is plain.
    const boldOf = async (name: string): Promise<unknown> => {
      const line = await ui.find(lineOf(name)) as { children?: Array<{ props?: { bold?: boolean } } | string> } | undefined
      return line?.children?.filter((child): child is { props?: { bold?: boolean } } => typeof child !== 'string').at(-1)?.props?.bold
    }
    expect(await boldOf('Cleanup')).toBe(true)
    expect(await boldOf('Units')).toBe(false)
    // The models read the same words.
    const listed = (await $.tool.call({ tool: 'mcp__workers__chat', action: 'list' } as never)).result as string
    expect(listed).toContain('○ Cleanup  Not running · its chat is closed')
    expect(listed).toContain('● Units  Working')
  })

  test('2c: after 120 s with no statuses the pane reads its own files again and marks the line; a fresh process is not marked', async ($, on) => {
    const { w, clock, ui, text } = await paneWorld($, on)
    // The board answers nothing for a while (down): a fresh process (under 120 s) shows today's line, no mark.
    for (let i = 0; i < 10; i++) w.takeAnswers.push({ status: 503, text: 'down' })
    await clock.advance(30000)
    expect(await text('Cleanup')).toBe('○ Cleanup  free')
    // A board that comes back with statuses is shown; then it goes down: the statuses stand 120 s, then the pane's own reading, marked.
    w.takeAnswers.length = 0
    w.takeAnswers.push(answer([status('Cleanup', 'Asleep', { since: new Date(2026, 10, 1, 9, 5).getTime() })]))
    await clock.advance(5000)
    expect(await text('Cleanup')).toBe('○ Cleanup  Asleep · since 09:05')
    for (let i = 0; i < 40; i++) w.takeAnswers.push({ status: 503, text: 'down' })
    await clock.advance(100000)
    expect(await text('Cleanup')).toBe('○ Cleanup  Asleep · since 09:05')
    await clock.advance(30000)
    expect(await text('Cleanup')).toBe('○ Cleanup  free  (board not reached)')
    expect(await ui.find({ type: 'Text', text: /\(board not reached\)/ })).toBeDefined()
    // The board answers again: the mark goes.
    w.takeAnswers.length = 0
    w.takeAnswers.push(answer([status('Cleanup', 'Free', { reportAt: 1_000_000 })]))
    await clock.advance(10000)
    expect((await text('Cleanup'))?.includes('board not reached')).toBe(false)
  })

  test('2c: a board that answers without statuses (an older board) gives today\'s line with no mark, however long', async ($, on) => {
    const { clock, text } = await paneWorld($, on)
    await clock.advance(200000)
    expect(await text('Cleanup')).toBe('○ Cleanup  free')
    expect(await text('Units')).not.toContain('board not reached')
  })

  test('2c: a chat outside the list takes nothing and its pane has no mark', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const w = world('other', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, null)
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
    await clock.advance(300000)
    for (let i = 0; i < 10; i++) await settle()
    expect(w.fetched).toEqual([])
    expect((await ui.find(lineOf('Units')))?.text).toBe('○ Units  free')
  })

  test('2c: while a clear runs no take goes out and the statuses stand for 120 s', async ($, on) => {
    const { w, clock, text } = await paneWorld($, on)
    w.takeAnswers.push(answer([status('Cleanup', 'Held', { tone: 'attention', why: 'its clear did not run', reportAt: 80_000 })]))
    await clock.advance(5000)
    expect(await text('Cleanup')).toContain('Held · its clear did not run')
    // The board is not asked for 100 s (a clear on its way takes only reports): the statuses are still the board's.
    for (let i = 0; i < 40; i++) w.takeAnswers.push({ status: 503, text: 'down' })
    await clock.advance(100000)
    expect(await text('Cleanup')).toContain('Held · its clear did not run')
  })

  test('B566 (X21): a take the board never answers gives up after 15 s; the next take hands the chat its word', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, none, 'Units')
    await clock.advance(5000)
    await settle()
    expect(none.fetched).toEqual([])
  })

  test('a board file that points elsewhere is not followed', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: JSON.stringify({ url: 'http://example.com:80', key: KEY }) })
    stand(on, w)
    await startedAs($, w, 'Units')
    await clock.advance(5000)
    await settle()
    expect(w.fetched).toEqual([])
  })

  test('a chat that is not one of the project\'s takes nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('other', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, null)
    await clock.advance(5000)
    await settle()
    expect(w.fetched).toEqual([])
  })

  test('every chat in the list is told what the board\'s mark means, and never to send through the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', listed())
    stand(on, w)
    await startedAs($, w, 'Units')
    const note = noteOf(w) ?? ''
    expect(note).toContain('(answered on the worker board, HH:MM)')
    expect(note).toContain('Never send anything to the board yourself')
  })
})

describe('the worker board is kept running by the chats', () => {
  const LAUNCH = 'D:/Work/project/.claude/launch.json'
  const launch = JSON.stringify({ configurations: [{ name: 'worker-board', runtimeExecutable: 'node', runtimeArgs: ['D:/Work/project/worker-board/server.mjs'], port: 4310 }] })
  // A board that is down names no chat (the whoami goes unanswered): the chat that starts it is one that has its card in the
  // list already, as every chat of the project has when the app opens again.
  const withBoards = (): Record<string, string> => ({
    ...listed({ main: { name: 'Main', role: 'main', state: 'waiting', task: null, at: 0 } }),
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
    await clock.advance(5000)
    await settle()
    // 5c (0.30.0): one look with no answer only notes it (a landing's restart: the keeper holds the port again within
    // milliseconds); the second look, 15 s on, starts it.
    expect(w.spawned).toEqual([])
    await clock.advance(15000)
    await settle()
    expect(w.spawned).toEqual(['node D:/Work/project/worker-board/server.mjs'])
    // 5c: through the launcher, detached, its output appended to the board's own log: no pipe the chat must read.
    expect(w.launched.map(one => ({ ...one, cwd: slashed(one.cwd) }))).toEqual([{ log: 'D:/Work/project/worker-board/data/board.log', cwd: 'D:/Work/project' }])
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
    await clock.advance(50000)
    await settle()
    expect(w.spawned.length).toBe(1)
    await clock.advance(45000)
    await settle()
    expect(w.spawned.length).toBe(2)
  })

  test('a chat that is not one of the project\'s starts nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('other', withBoards())
    w.up = []
    stand(on, w)
    await startedAs($, w, null)
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Main')
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

describe('a reported step ends the task on the card', () => {
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Main')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
  const WORK = 'mcp__workers__work'

  test('a call reaches the board with the chat, its session and the fields, and answers the text of the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
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

  test('B412 as 0.31.1 (F4) has it: an answer cut off is said at once as "not known whether it was recorded", and the call is asked again in the background with the same request id; the board records a request id once', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.worked = []
    w.requests = []
    w.cuts = ['socket hang up']
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'B30', text: 'B30 is made.' }) }
    // The tool's hook sleeps no more (its sleeps were 6 s of its 10 s budget): it answers as soon as the first call was cut.
    const made = String((await $.tool.call({ tool: WORK, action: 'new', title: 'Paint the gate' })).result)
    expect(made).toContain('not known whether it was recorded')
    expect(made).toContain('asked again in the background with the same request id')
    expect(w.worked.length).toBe(1)
    // The repeat, 2 s later, with the same request id; answered, no third.
    await clock.advance(2000)
    expect(w.worked.length).toBe(2)
    expect(w.requests[0]).toMatch(/^units-\d+-\d+$/)
    expect(w.requests[1]).toBe(w.requests[0])
    await clock.advance(6000)
    expect(w.worked.length).toBe(2)
    // The next call is a call of its own.
    await $.tool.call({ tool: WORK, action: 'next' })
    expect(new Set(w.requests).size).toBe(2)
  })

  test('B412: still no answer: the repeats stop after three; a board that took no connection at all has recorded nothing and is said so at once, not asked again', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.worked = []
    w.cuts = ['socket hang up', 'socket hang up', 'socket hang up', 'socket hang up', 'socket hang up']
    const text = String((await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'done', merged: 'abc1234' })).result)
    expect(text).toContain('not known whether it was recorded')
    expect(text).toContain('work next')
    // 2026-10-31: a board that gave no answer is reported to the Supervisor, never to the person.
    expect(text).toContain('tell the Supervisor with mcp__ccd_session_mgmt__send_message')
    expect(text).toContain('never ask the person to start the board')
    expect(w.worked.length).toBe(1)
    for (let i = 0; i < 5; i++) await clock.advance(2000)
    expect(w.worked.length).toBe(4, 'three repeats at most')
    // A board that took no connection at all has recorded nothing: it says so at once, and is not asked again.
    w.worked = []
    w.cuts = ['ECONNREFUSED']
    expect((await $.tool.call({ tool: WORK, action: 'note', to: 'main', text: 'hello' })).result).toMatch(/^The worker board did not answer \(.*ECONNREFUSED.*\): nothing was recorded\. Try again in a moment\. If it still does not answer/)
    await clock.advance(8000)
    expect(w.worked.length).toBe(1)
  })

  // Goal definition (2026-10-31): the draft of the goal definition is `definition-draft`, the board's answer says "goal definition";
  // the old name `vibe-draft` is still an action of the tool and is sent to the board as it was given (the board maps it).
  test('Focus 2: the partner keeps its drafts with definition-draft (once vibe-draft) and how-draft, their fields sent to the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'The board keeps the goal definition of G6.' }) }
    const definition = await $.tool.call({ tool: WORK, action: 'definition-draft', goal: 'G6', lines: ['hits feel heavy'], picture: 'pictures/hit.png' } as never)
    expect((definition as { result: string }).result).toBe('The board keeps the goal definition of G6.')
    expect(JSON.parse(w.worked[0] ?? '{}')).toEqual({ action: 'definition-draft', goal: 'G6', lines: ['hits feel heavy'], picture: 'pictures/hit.png', chat: 'Units', session: 'units' })
    await $.tool.call({ tool: WORK, action: 'how-draft', goal: 'G6', parts: ['Hit effects · about 2 h · done when: the hit shows · steps B20'], partnerDecides: ['the colours'], youDecide: ['the sounds'] } as never)
    expect(JSON.parse(w.worked[1] ?? '{}')).toEqual({ action: 'how-draft', goal: 'G6', parts: ['Hit effects · about 2 h · done when: the hit shows · steps B20'], partnerDecides: ['the colours'], youDecide: ['the sounds'], chat: 'Units', session: 'units' })
    // The old name still works: it reaches the board as it was given.
    const old = await $.tool.call({ tool: WORK, action: 'vibe-draft', goal: 'G6', lines: ['hits feel heavy'] } as never)
    expect((old as { result: string }).result).toBe('The board keeps the goal definition of G6.')
    expect(JSON.parse(w.worked[2] ?? '{}')).toEqual({ action: 'vibe-draft', goal: 'G6', lines: ['hits feel heavy'], chat: 'Units', session: 'units' })
  })

  // Goal definition (2026-10-31): the tool's text and its fields say "goal definition" (the old action name apart), and the
  // how-draft's parts are work blocks with a done-when line.
  test('the work tool names the goal definition in its description and fields, and its parts are work blocks', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    const description = w.descriptions.work ?? ''
    expect(description).toContain('"definition-draft" ("goal", "lines", "picture"; its old name "vibe-draft" still works)')
    expect(description).toContain("keeps its draft of the focus goal's goal definition and how on the board")
    const fields = (w.schemas.work as { properties: Record<string, { description?: string; enum?: string[] }> }).properties
    expect(fields.action?.enum).toContain('definition-draft')
    expect(fields.action?.enum).toContain('vibe-draft')
    expect(fields.goal?.description).toContain('definition-draft, how-draft: the focus goal.')
    expect(fields.picture?.description).toContain("definition-draft: the goal definition's picture.")
    expect(fields.lines?.description).toContain('definition-draft: three to five short lines of the goal definition')
    expect(fields.parts?.description).toBe('how-draft: the work blocks, each `<title> · about <N> h · done when: <line>`, with ` · steps B1, B2` once made.')
    // No other word "vibe" is left in what a chat reads, but the old action name.
    expect(JSON.stringify([description, fields]).replaceAll('vibe-draft', '').toLowerCase()).not.toContain('vibe')
  })

  test('the supervisor: its chat reads the health summary and files an incident, with its fields sent to the board', async ($, on) => {
    mock.clock(on)
    const w = world('watcher', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Watcher')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'N7: the note on G6 for the person.' }) }
    await $.tool.call({ tool: WORK, action: 'note', to: 'you', of: 'G6', decided: ['Damage numbers in yellow'], needs: ['Q3'] } as never)
    expect(JSON.parse(w.worked[0] ?? '{}')).toEqual({ action: 'note', to: 'you', of: 'G6', decided: ['Damage numbers in yellow'], needs: ['Q3'], chat: 'Units', session: 'units' })
  })

  test('Partner answers: the partner answers a routed ask, or hands it to the person, with its fields sent to the board', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Q12 answered for the person: B. It stands in your daily note N7 with an Undo.' }) }
    expect((await $.tool.call({ tool: WORK, action: 'partner-answer', id: 'Q12', text: 'B', why: 'the advice fits the goal definition' } as never)).result).toBe('Q12 answered for the person: B. It stands in your daily note N7 with an Undo.')
    expect(JSON.parse(w.worked[0] ?? '{}')).toEqual({ action: 'partner-answer', id: 'Q12', text: 'B', why: 'the advice fits the goal definition', chat: 'Units', session: 'units' })
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Q13 goes to the person: a new screen.' }) }
    await $.tool.call({ tool: WORK, action: 'escalate', id: 'Q13', why: 'a new screen' } as never)
    expect(JSON.parse(w.worked[1] ?? '{}')).toEqual({ action: 'escalate', id: 'Q13', why: 'a new screen', chat: 'Units', session: 'units' })
  })

  test('a board that is down answers with one line and no throw', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    w.up = []
    stand(on, w)
    await $.session.start(START)
    expect((await $.tool.call({ tool: WORK, action: 'next' })).result).toMatch(/^The worker board did not answer \(.+\): nothing was recorded\. Try again in a moment\. If it still does not answer in a minute, tell the Supervisor with mcp__ccd_session_mgmt__send_message \(its session id is in the list of chats, mcp__workers__chat action list\) and go on with your step; never ask the person to start the board\.$/)
  })

  test('B445: a board that holds the call is a time-out with its seconds; a refusal shows the HTTP status beside the board\'s words', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
    w.workAnswer = { status: 200, text: FILED }
    await $.prompt.submit({ text: 'Make the strip blue', ...ASKED } as never)
    expect(sent(w)).toEqual([{ action: 'instruction', text: 'Make the strip blue', chat: 'Units', session: 'units' }])
    // The prompt itself goes on unchanged; beside it, for the model: its id and the ones still open.
    expect(w.typedIn).toEqual(['composer:framed:Make the strip blue'])
    expect(w.contexts[0]?.join('\n')).toContain('Recorded as I17; close it with work close I17 --as "what came of it" once it is done.')
    expect(w.contexts[0]?.join('\n')).toContain('Open instructions: I15 (2 turns), I17 (new).')
    // Review of B298: nothing of it goes into the work tool's description, which stays the same words, so it stays cached.
    expect(w.descriptions.work ?? '').not.toContain('I17')
    expect(w.descriptions.work ?? '').not.toContain('Open instructions')
  })

  test('what the person sends by Remote Control is filed; a line the board typed, the same pasted by hand and a slash command are not', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
      await startedAs($, w, 'Main')
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
      await startedAs($, w, 'Main')
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
    await startedAs($, w, 'Main')
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
    await startedAs($, w, 'Main')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    expect(sent(w).map(one => [one.action, one.pull ?? null])).toEqual([['turn-ended', null]])
  })

  test('a free worker whose pull brings nothing takes nothing', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
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
  /** A chat the board names at its start, so what it asked the board by then is not counted: the test's own calls are. */
  const begin = async ($: Engine, w: World): Promise<void> => {
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
  }

  test('it is filed as a decide ask under the card\u2019s step, and the answer given in the form follows', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(working), [BOARD]: board })
    w.workAnswer = { status: 409, text: 'not yet' }
    stand(on, w)
    await begin($, w)
    w.worked = []
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'Q4', text: '> **For you**' }) }
    w.formAnswers = { 'Which port?': '4320' }
    await $.tool.call(FORM as never)
    await afterForm()
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
    await begin($, w)
    // The 409 above is remembered for five minutes: past them the board is asked again.
    await clock.advance(5 * 60_000)
    w.worked = []
    w.workAnswers = [{ status: 409, text: 'B12 is Board\u2019s' }, { status: 200, text: JSON.stringify({ id: 'Q5' }) }, { status: 200, text: '{}' }]
    w.formResponse = 'neither, use 4340'
    await $.tool.call(FORM as never)
    await afterForm()
    expect(sent(w).map(one => [one.action, one.of ?? null, one.id ?? null, one.text ?? null])).toEqual([
      ['ask', 'B12', null, 'Which port?'], ['ask', null, null, 'Which port?'], ['answered-in-chat', null, 'Q5', 'neither, use 4340'],
    ])
    w.worked = []
    w.workAnswers = [{ status: 200, text: JSON.stringify({ id: 'Q6' }) }]
    w.formCloses = true
    await $.tool.call(FORM as never).catch(() => null)
    await afterForm()
    expect(sent(w).map(one => [one.action, one.id ?? null])).toEqual([['ask', null], ['withdraw', 'Q6']])
  })

  test('B412: a board slow to file it under the step is not asked again without the step; its late answer is closed', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(working), [BOARD]: board })
    w.workAnswer = { status: 409, text: 'not yet' }
    stand(on, w)
    await begin($, w)
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
    await begin($, w)
    const asked = await $.tool.call(FORM as never)
    await afterForm()
    expect(asked.result).toEqual({ answers: {} })
    expect(sent(w).map(one => one.action)).toEqual(['ask'])
    expect(w.whileAsked?.state).toBe('asking')
  })

  test('the chat closes its own ask with the person\u2019s words from the chat, through the work tool', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await begin($, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ id: 'Q7', text: 'Q7 answered in the chat.' }) }
    expect((await $.tool.call({ tool: 'mcp__workers__work', action: 'answered-in-chat', id: 'Q7', text: 'yes, B' } as never)).result).toBe('Q7 answered in the chat.')
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
      w.whoami = { name: 'Worker 1', role: 'worker', card: null }
      stand(on, w)
      await $.session.start({ ...START, cwd: own.root })
      await settle()
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.tool.call({ tool: 'mcp__workers__work', action: 'next' })
      // Its start asked its own board which chat it is and for its open instructions, and its call went there too.
      expect(w.whoamis.length).toBe(1)
      expect(w.workedAt).toEqual(Array(2).fill(`${own.url}/api/bridge/work ${own.key}`))
      // Its card is in its own project's list, under the same name a chat of the other project may have.
      expect(Object.keys(w.files).filter(path => path.endsWith(`/${name}-1.json`))).toEqual([`${slashed(own.root)}/.claude/chats/${name}-1.json`])
      // Whatever else it asked a board, it asked its own.
      for (const asked of w.fetched) expect(`${asked.url.startsWith(own.url)} ${asked.key}`).toBe(`true ${own.key}`)
    })
  }
})

describe('Pause 2: each chat reads the person\'s pause in its own calls to the board', () => {
  const SINCE = Date.UTC(2026, 9, 18, 20, 30)
  const POINT = { commit: '1a2b3c4', next: 'write the tests', at: SINCE + 60_000, line: '1a2b3c4 · write the tests · 2026-10-18 22:31:00', isSincePause: true }
  const state = (name: string, holds: unknown[] = [], resumeList: unknown[] = []) => ({ text: 'x', state: name, since: SINCE, forChat: { holds, mustStop: name === 'pausing' }, resumeList })
  /** The chat's next tool call (a Bash call beneath the mod): the words the mod refuses it with, '' when it ran. */
  const told = async ($: Engine, more: Record<string, unknown> = {}): Promise<string> => {
    const out = await $.tool.call({ tool: 'Bash', command: 'npm test', ...more } as never) as unknown as { deny?: unknown }
    return typeof out.deny === 'string' ? out.deny : ''
  }
  const STOP = 'The person pauses all chats: commit your work, write your checkpoint (work step B12 --commit <hash> --next "<next action>"), stop or wait for your background agents, then end your turn and start nothing new.'
  const units = (): Record<string, string> => ({ ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 } }), [BOARD]: board })
  const free = (): Record<string, string> => ({ ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
  const mainChat = (): Record<string, string> => ({ ...listed({ main: { name: 'Main', role: 'main', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)

  // 2026-10-28: the app's guard skips the classic hooks on a work login, so the pause comes at the next tool call, on every login.
  test('a working chat is told at its next tool call: that call does not run, the next one does', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    stand(on, w)
    const ran = bash(on)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.pauseAnswer = state('pausing', [{ id: 'B12', checkpoint: null }])
    const held = await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    expect(JSON.stringify(held)).toContain('pauses all chats')
    expect(ran).toEqual([])
    // Told once: the next call runs, so the chat can commit its work and write its checkpoint.
    const next = await $.tool.call({ tool: 'Bash', command: 'git commit' } as never)
    expect(JSON.stringify(next)).not.toContain('pauses all chats')
    expect(ran).toEqual(['git commit'])
  })

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

  test('while the person pauses, a working chat is told at the first tool call of every turn to checkpoint and end it; one board call per 20 s', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', units())
    stand(on, w)
    bash(on)
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
    // A subagent's tool call is not the chat's.
    await clock.advance(21_000)
    const before = w.pauseReads
    expect(await told($, { agentId: 'a1b2c3d4e5' })).not.toContain('pauses all chats')
    expect(w.pauseReads).toBe(before)
    // The review of Pause 2: the next turn drops the reading and is told again, at its first tool call.
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
    bash(on)
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

  test('after Resume all the main chat is told whom to wake, by app session id, at its first prompt; once per resume, also in a new process', async ($, on) => {
    mock.clock(on)
    const w = world('main', mainChat())
    w.pauseAnswer = state('resuming', [], [
      { chat: 'Units', session: 'local_units', cliSession: 'units', step: 'B12', checkpoint: POINT, hasStarted: false },
      { chat: 'Support', session: 'local_support', cliSession: 'support', step: 'B13', checkpoint: POINT, hasStarted: true },
    ])
    stand(on, w)
    await $.session.start(START)
    await $.prompt.submit({ text: 'hello', ...ASKED } as never)
    const said = w.contexts[0]?.join('\n') ?? ''
    expect(said).toContain("Resume: wake each chat below that has not started, by its session id with SendMessage, one line each: 'resume your step B<id> from your checkpoint'")
    expect(said).toContain("- Units, session local_units: 'resume your step B12 from your checkpoint' (checkpoint 1a2b3c4 · write the tests)")
    expect(said).not.toContain('Support')
    await $.prompt.submit({ text: 'resume', origin: { kind: 'plugin', asUser: true } } as never)
    expect(w.contexts[1]?.join('\n') ?? '').not.toContain('Resume: wake')
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
    await $.prompt.submit({ text: 'hello', ...ASKED } as never)
    expect(w.contexts[0]?.join('\n') ?? '').not.toContain('Resume: wake')
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

  test('a worker woken after the resume is told its checkpoint at its first turn, reading the pause once; at its first prompt too, unless the person pauses', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    stand(on, w)
    bash(on)
    await $.session.start(START)
    w.pauseAnswer = state('pausing', [{ id: 'B12', checkpoint: POINT }])
    await $.prompt.submit({ text: 'hello', ...ASKED } as never)
    expect(w.contexts.at(-1)?.join('\n') ?? '').not.toContain('You hold B12')
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

  test('a chat that starts while it holds a step goes on from its checkpoint, told at its first prompt', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    w.pauseAnswer = state('running', [{ id: 'B12', checkpoint: POINT }])
    stand(on, w)
    await $.session.start(START)
    await $.prompt.submit({ text: 'hello', ...ASKED } as never)
    expect(w.contexts.at(-1)?.filter(line => line.startsWith('You hold'))).toEqual(['You hold B12: checkpoint 1a2b3c4 · write the tests; go on from there.'])
    await $.prompt.submit({ text: 'go on', ...ASKED } as never)
    expect(w.contexts.at(-1)?.join('\n') ?? '').not.toContain('You hold B12')
  })

  test('an old board that does not know pause-state changes nothing for the chat', async ($, on) => {
    mock.clock(on)
    const w = world('units', units())
    w.pauseAnswer = null
    stand(on, w)
    bash(on)
    await $.session.start(START)
    await $.prompt.submit({ text: 'hello', ...ASKED } as never)
    expect(w.contexts.at(-1)?.filter(line => line.startsWith('You hold') || line.includes('pauses all chats'))).toEqual([])
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
    await startedAs($, w, 'Units')
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
const CLEAR_ARGS = { command: 'clear', args: '', origin: { kind: 'plugin', name: 'workers' }, presentation: { isFullscreen: false, columns: 100 } }
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
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
    return w
  }
  /**
   * The /clear runs: the old conversation ends and the new one starts under another session id, and the clear's own command
   * hook then moves the card and makes the start's words. The stand-in's record of this command is taken out again: it is no
   * /clear of the mod's.
   */
  async function cleared($: Engine, w: World, to = 'units-2'): Promise<void> {
    await $.session.end({ reason: 'clear', sessionId: w.id, resume: { id: w.id } })
    w.id = to
    await $.command.run({ ...CLEAR_ARGS, origin: { kind: 'composer' } } as never)
    w.commanded.pop()
    w.sequence.pop()
    w.reportsAtClear.pop()
  }
  /** The first prompt of the new conversation: the lines of context it carries (the start's words come with it). */
  async function firstPrompt($: Engine, w: World): Promise<string[]> {
    await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
    return w.contexts.at(-1) ?? []
  }
  /** The start's words among the lines of a prompt's context; none when the chat was told nothing of a worker's start. */
  const wordsOf = (context: string[]): string[] => context.filter(line => line.startsWith('This chat is'))

  test('a reported step clears the worker even when more follows: the board keeps its log first, then /clear runs', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.sequence).toEqual(['report', 'turn-ended', 'save-log', '/clear'])
    expect(sent(w).find(one => one.action === 'save-log')).toEqual({ action: 'save-log', stepId: 'B12', chat: 'Units', session: 'units' })
    expect(w.commanded).toEqual(['/clear by plugin workers'])
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
    await cleared($, w)
    // The old session's file names the new one; the new card is the same chat, with the clear on it.
    expect(fileOf(w, 'units')).toBeNull()
    expect(JSON.parse(w.files[`${CHATS}/units.json`] ?? '{}').movedTo).toBe('units-2')
    expect(fileOf(w, 'units-2')).toEqual({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: clock.now(), cleared: { at: clock.now(), step: 'B12', log: LOG } })
    // The board was asked as the chat under its new session id, and the work tool answers for it.
    expect(sent(w).at(-1)).toEqual({ action: 'next', chat: 'Units', session: 'units-2' })
    const answered = await $.tool.call({ tool: WORK, action: 'next' } as never)
    expect(answered.result).toBe('Yours, Units: B13 (queued).')
    expect(sent(w).at(-1)).toEqual({ action: 'next', chat: 'Units', session: 'units-2' })
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).toBe('○ Units  free')
    // Its start, with its first prompt: who it is, its rules, the log, the open instructions as work next lists them, and work next.
    const words = wordsOf(await firstPrompt($, w))
    expect(words.length).toBe(1)
    expect(words[0]).toContain('This chat is "Game - Units", a worker')
    expect(words[0]).toContain(`after your step B12 was reported, so this conversation starts empty. It is kept word for word in ${FILE}`)
    expect(words[0]).toContain('.claude/worker-briefing.md')
    expect(words[0]).toContain('I7 (missed 1 turn): "Use the red cape"')
    expect(words[0]).toContain('action "next" now')
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
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    await cleared($, w)
    // The next tick takes it, into the new conversation.
    await clock.advance(5000)
    for (let i = 0; i < 50 && w.typedIn.length === 0; i++) await settle()
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
  })

  for (const [why, set, words] of [
    // B763: the decision reads the pause anew, as the board says it now.
    ['the person pauses', (w: World) => { w.pauseAnswer = { ...RUNNING, state: 'pausing', since: 1 }; w.byAction['turn-ended'] = ok({ missed: [], open: [], role: 'worker', pause: w.pauseAnswer }) }, 'the person pauses the chats'],
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

  // The lazy clear (Workers mod 0.31.0, D5): the clear a board named at a take (B547, and B763's pause read anew for it)
  // is gone with that path: a clear never runs alone; the one a worker owes comes with its next task's envelope, whose
  // clear reads the pause anew as before (the T8.5 tests below).

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
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    // As if the queued /clear came only after a new turn had started: the turn drops the clear, its /clear is refused.
    await $.turn.start({ text: 'one more thing', turnId: 't2' })
    expect(fileOf(w)?.clearNote?.why).toBe('a new turn started before the clear ran')
    expect(fileOf(w)?.clearing).toBeUndefined()
    const ran = await $.command.run(CLEAR_BY_MOD)
    expect(ran.text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    expect(w.commanded).toEqual(['/clear by plugin workers'])
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
    expect(w.commanded).toEqual(['/clear by plugin workers', '/clear by composer'])
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

  test('a new session id seen before the old conversation\'s end moves the card once', async ($, on) => {
    const clock = mock.clock(on)
    const w = await worker($, on)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    w.id = 'units-2'
    await clock.advance(5000)
    for (let i = 0; i < 50 && fileOf(w, 'units-2') === null; i++) await settle()
    expect(fileOf(w, 'units-2')?.cleared?.step).toBe('B12')
    w.writes = []
    await $.session.end({ reason: 'clear', sessionId: 'units', resume: { id: 'units' } })
    await $.turn.start({ text: 'go on', turnId: 't2' })
    expect(JSON.parse(w.files[`${CHATS}/units.json`] ?? '{}').movedTo).toBe('units-2')
    expect(fileOf(w, 'units-2')?.cleared?.step).toBe('B12')
    // The old conversation's end moved nothing a second time.
    expect(w.writes.filter(path => path === `${CHATS}/units.json`)).toEqual([])
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
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await cleared($, w)
    expect(fileOf(w, 'units-2')?.task?.text).toBe('B12 Give the golem')
    expect(fileOf(w, 'units-2')?.cleared).toBeUndefined()
    const words = wordsOf(await firstPrompt($, w))
    expect(words[0]).toContain('Your earlier conversation was cleared, so this conversation starts empty.')
    expect(words[0]).not.toContain('kept word for word')
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
    expect(w.commanded).toEqual(['/clear by plugin workers'])
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
    expect(w.commanded).toEqual(['/clear by plugin workers'])
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
    await startedAs($, w, 'Advisor')
    await $.turn.start({ text: 'refine', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await cleared($, w, 'advisor-2')
    expect(fileOf(w, 'advisor-2')?.name).toBe('Advisor')
    expect(JSON.parse(w.files[`${CHATS}/advisor.json`] ?? '{}').movedTo).toBe('advisor-2')
    expect(wordsOf(await firstPrompt($, w))).toEqual([])
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
    await cleared($, w)
    const words = wordsOf(await firstPrompt($, w))
    expect(words[0]).toContain('after your step B12 was reported')
    expect(words[0]).toContain('2026-10-23 1405 B12.txt')
    expect(fileOf(w, 'units-2')?.cleared).toEqual({ at: clock.now(), step: 'B12', log: LOG })
  })

  test('B944, the real shape: a /clear that reaches no hook of the mod (its ticket was left in the old list); the next clear, at a turn\'s end, runs whatever the order of the queue', async ($, on) => {
    mock.clock(on)
    const w = await worker($, on, null)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    // The /clear is queued; the kit's stand-in runs no hook for it, as the live case's /clear reached none of the mod's.
    // (The lazy clear, D5: no longer from a take's named clear, which is gone.)
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    await cleared($, w)
    // The next step, reported in the fresh conversation; its turn's end queues a fresh /clear 9-25 ms later in the live case:
    // it runs whatever the order of the mod's queue (0.29.1's clearRun; before it, "let go before it ran").
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    for (let i = 0; i < 100 && w.commanded.length < 2; i++) await wait(5)
    expect(w.commanded).toEqual(['/clear by plugin workers', '/clear by plugin workers'])
    expect(fileOf(w, 'units-2')?.clearNote).toBeUndefined()
  })

  test('B944 (0.30.0): the clear on its way is kept in the store; a new process runs its /clear by the card\'s mark and the envelope\'s line follows and is settled', async ($, on) => {
    const clock = mock.clock(on, { now: 50 * MIN })
    const marked: ChatFile = { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 49 * MIN, clearing: { at: 49 * MIN, step: 'B12', log: LOG } }
    const w = world('units', { ...listed({ units: marked }), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [] }) }
    const env = { id: 'e944', kind: 'task', step: 'B13', clear: { step: 'B12', reportedAt: 5 }, restart: false, set: null, line: 'work: B13 is yours; run work next', version: null }
    // What the earlier process kept before it was loaded anew: its clear's ticket, the envelope and its outcome so far.
    w.stored['clear-pending:units'] = { ticket: 'clear-7-2', from: 'units', step: 'B12', at: 49 * MIN, envelope: env, outcome: { cleared: null, set: null, typed: null, restarted: null, background: false, why: null } }
    await $.session.start(START)
    // Its /clear, queued by the earlier process, comes now: it runs (the card's fresh mark), and the store forgets it.
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('')
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    await settle()
    expect(w.stored['clear-pending:units']).toBeUndefined()
    await cleared($, w)
    await clock.advance(5000)
    for (let i = 0; i < 50 && !w.reported.some(body => body.includes('e944') && body.includes('"outcome"')); i++) await settle()
    expect(w.typedIn.some(one => one.endsWith('work: B13 is yours; run work next'))).toBe(true)
    const told = w.reported.map(body => JSON.parse(body) as { handover?: string; outcome?: Record<string, unknown> }).find(body => body.handover === 'e944' && body.outcome !== undefined)
    // Mutant "no store": the line would never be typed and the envelope never settled (left to the board's net).
    expect([told?.outcome?.cleared, told?.outcome?.typed]).toEqual([true, true])
  })

  test('B944 with the lazy clear (D2, D9): a kept clear whose /clear never comes to the new process: at 20 s the clear is dropped, its line goes once, the envelope settled cleared:false with its why; the late /clear finds nothing', async ($, on) => {
    const at = 50 * MIN
    const clock = mock.clock(on, { now: at + 5000 })
    const marked: ChatFile = { name: 'Units', role: 'worker', state: 'waiting', task: null, at, clearing: { at, step: 'B12', log: LOG } }
    const w = world('units', { ...listed({ units: marked }), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [] }) }
    const env = { id: 'e945', kind: 'task', step: 'B13', clear: { step: 'B12', reportedAt: 5 }, restart: false, set: null, line: 'work: B13 is yours; run work next', version: null }
    w.stored['clear-pending:units'] = { ticket: 'clear-7-2', from: 'units', step: 'B12', at, envelope: env, outcome: null }
    // The round-2 review: another chat's record, as old, in the same store (one file for every chat of the plugin).
    const foreign = { ticket: 'clear-9-1', from: 'main', step: null, at: 40 * MIN, envelope: { ...env, id: 'e999' }, outcome: null }
    w.stored['clear-pending:main'] = foreign
    await $.session.start(START)
    await clock.advance(5000)
    await settle()
    expect(w.reported.some(body => body.includes('e945'))).toBe(false)
    // 20 s after the clear was queued: dropped completely, then the line, once.
    await clock.advance(15_000)
    for (let i = 0; i < 50 && !w.reported.some(body => body.includes('e945') && body.includes('"outcome"')); i++) await settle()
    const told = w.reported.map(body => JSON.parse(body) as { handover?: string; outcome?: Record<string, unknown> }).find(body => body.handover === 'e945' && body.outcome !== undefined)
    expect([told?.outcome?.cleared, told?.outcome?.clearWhy, told?.outcome?.typed]).toEqual([false, 'not run in 20 s', true])
    expect(w.typedIn.filter(one => one.endsWith('work: B13 is yours; run work next')).length).toBe(1)
    expect(w.stored['clear-pending:units']).toBeUndefined()
    expect(fileOf(w)?.clearing).toBeUndefined()
    // Its /clear comes late: no mark, no record: nothing runs (review focus 1).
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    await clock.advance(3 * MIN)
    for (let i = 0; i < 20; i++) await settle()
    expect(w.typedIn.filter(one => one.endsWith('work: B13 is yours; run work next')).length).toBe(1)
    // Mutant "one key for every chat": this chat would read, settle or delete the Main chat's record.
    expect(w.stored['clear-pending:main']).toEqual(foreign)
    expect(w.reported.some(body => body.includes('e999'))).toBe(false)
  })

  test('the round-2 review, B944: a record of the same session that is not the clear the card\'s mark stands for (another time or step) brings no envelope back', async ($, on) => {
    const clock = mock.clock(on, { now: 50 * MIN })
    const marked: ChatFile = { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 49 * MIN, clearing: { at: 49 * MIN, step: 'B12', log: LOG } }
    const w = world('units', { ...listed({ units: marked }), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [] }) }
    const env = { id: 'e946', kind: 'task', step: 'B9', clear: { step: 'B8', reportedAt: 5 }, restart: false, set: null, line: 'work: B9 is yours; run work next', version: null }
    // An older clear of this session (B8, 20 minutes ago), left in the store.
    w.stored['clear-pending:units'] = { ticket: 'clear-7-1', from: 'units', step: 'B8', at: 30 * MIN, envelope: env, outcome: null }
    await $.session.start(START)
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('')
    await cleared($, w)
    await clock.advance(5000)
    for (let i = 0; i < 20; i++) await settle()
    // Mutant "the session alone": B9's line would be typed into the fresh conversation.
    expect(w.typedIn.some(one => one.includes('work: B9 is yours'))).toBe(false)
    expect(w.reported.some(body => body.includes('e946'))).toBe(false)
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
    await startedAs($, w, 'Main')
    w.tokens = 400_000
    for (const turnId of ['t1', 't2', 't3']) {
      await $.turn.start({ text: 'go', turnId })
      await $.turn.complete({ ...ENDED, turnId })
      await afterForm()
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
    await startedAs($, w, 'Advisor')
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
    expect(w.commanded).toEqual(['/clear by plugin workers'])
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

  test('2c: while a clear runs no take goes out; the pane keeps the board\'s status it had (up to 120 s), unmarked', async ($, on) => {
    const clock = mock.clock(on, { now: 100_000 })
    const w = await worker($, on)
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
    w.takeAnswers.push({ status: 200, text: JSON.stringify({ messages: [], statuses: [{ name: 'Units', status: 'Handing', why: null, tone: 'quiet', since: null, reportAt: 100_000 }] }) })
    await clock.advance(5000)
    for (let i = 0; i < 10; i++) await settle()
    expect((await ui.find(lineOf('Units')))?.text).toContain('Handing')
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    const takes = w.fetched.filter(one => one.url.endsWith('/api/bridge/take')).length
    for (let i = 0; i < 12; i++) {
      await clock.advance(5000)
      await settle()
    }
    expect(w.fetched.filter(one => one.url.endsWith('/api/bridge/take')).length).toBe(takes)
    // A minute on, with no take: still the board's status of a moment ago, no mark.
    const text = (await ui.find(lineOf('Units')))?.text ?? ''
    expect(text).toContain('Handing')
    expect(text).not.toContain('board not reached')
  })

  describe('0.28.0: the Product owner is never treated as a worker at a turn\'s end', () => {
    const OWNER_LIST = '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear", "compactAbove": 150000, "owner": "Product owner" }'
    /** The Product owner's chat at the end of a turn in which it reported a step; the board's answer names no role (an older board). */
    async function owner($: Engine, on: On, list: string, ended: Record<string, unknown>): Promise<World> {
      mock.clock(on)
      const w = world('owner', { [`${CHATS}/list.json`]: `${list}\n`, [BOARD]: board })
      stand(on, w)
      w.tokens = 400_000
      w.byAction = { 'turn-ended': ok(ended), report: ok({ id: 'B12', text: 'in', more: null }), 'save-log': ok({ text: `Saving the conversation to ${FILE}.`, log: LOG, file: FILE }) }
      await startedAs($, w, 'Product owner')
      await $.turn.start({ text: 'the talk', turnId: 't1' })
      await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
      await $.turn.complete({ ...ENDED, turnId: 't1' })
      await wait(50)
      return w
    }

    test('the list names it: with no role in the board\'s answer it is compacted at rest with its own keep text, never cleared, no log', async ($, on) => {
      const w = await owner($, on, OWNER_LIST, { missed: [], open: [], pause: RUNNING })
      expect(w.commanded).toEqual([])
      expect(w.sequence).not.toContain('save-log')
      expect(w.compactions.length).toBe(1)
      expect(w.compactions[0]).toContain('the person\'s Product owner on the worker board')
    })

    test('the board named it before: a later answer with no role still does not make it a worker', async ($, on) => {
      mock.clock(on)
      const w = world('owner', { [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear", "compactAbove": 150000 }\n', [BOARD]: board })
      stand(on, w)
      w.tokens = 400_000
      w.byAction = { 'turn-ended': ok({ missed: [], open: [], role: 'owner', pause: RUNNING }), report: ok({ id: 'B12', text: 'in', more: null }) }
      await startedAs($, w, 'Product owner')
      await $.turn.start({ text: 'the talk', turnId: 't1' })
      await $.turn.complete({ ...ENDED, turnId: 't1' })
      await wait(50)
      expect(w.commanded).toEqual([])
      w.byAction['turn-ended'] = ok({ missed: [], open: [], pause: RUNNING })
      w.tokens = 400_000
      await $.turn.start({ text: 'the next talk', turnId: 't2' })
      await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
      await $.turn.complete({ ...ENDED, turnId: 't2' })
      await wait(50)
      expect(w.commanded).toEqual([])
      expect(w.sequence).not.toContain('save-log')
    })

    test('a worker stays a worker: no role from the board and no "owner" in the list clears it after its step, as before', async ($, on) => {
      const w = await owner($, on, '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear" }', { missed: [], open: [], pause: RUNNING })
      // The board did not say this chat is a worker: not cleared (compacted instead), exactly as 0.27.x did.
      expect(w.commanded).toEqual([])
      expect(w.compactions.length).toBe(1)
      expect(w.compactions[0]).not.toContain('Product owner on the worker board')
    })
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
    await startedAs($, w, 'Watcher')
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
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    expect(w.compactions).toEqual([])
    expect(w.toasts).toEqual([])
    expect(fileOf(w)?.clearing).toEqual({ at: clock.now(), step: null, log: null })
    await cleared($, w, 'watcher-2')
    expect(fileOf(w, 'watcher-2')).toEqual({ name: 'Watcher', role: 'worker', state: 'waiting', task: null, at: clock.now(), cleared: { at: clock.now(), step: null, log: null } })
    expect(wordsOf(await firstPrompt($, w))).toEqual([])
    // Every call to the board says the mod's version.
    expect(w.modHeaders.length).toBeGreaterThan(0)
    expect(w.modHeaders.every(one => one === MOD_VERSION)).toBe(true)
  })

  test('the supervisor: when the board does not answer its turn\'s end, the list of chats names it, and it is cleared all the same', async ($, on) => {
    mock.clock(on)
    const w = await watcher($, on, { status: 503, text: 'The board restarts: try again in a moment.' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin workers'])
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
    await startedAs($, w, 'Main')
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
  async function joined($: Engine, on: On, beneath: (() => void) | null = null): Promise<{ w: World; clock: ReturnType<typeof mock.clock> }> {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    beneath?.()
    w.workAnswer = { status: 503, text: 'No work store.' }
    await startedAs($, w, 'Units')
    return { w, clock }
  }
  /** A Bash tool beneath the mod that starts a background shell, as the app's answer says it. */
  const background = (on: On): void => {
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'Command running in background with ID: b4zduzypn. Output is being written to: x' } }) as never)
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
    await afterForm()
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
    // The first tool call of the turn reads the pause from the board before the form is asked (the mod's own call, a moment).
    for (let i = 0; i < 5; i++) await settle()
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

  // 2026-10-28: the app's guard skips classic.Stop on a work login, so the mod uses none: the chat keeps the list of its background work itself.
  test('a background shell started in the turn reports idle with background, and its end plain idle', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.whoami = { name: 'Units', role: 'worker', card: null }
    stand(on, w)
    w.workAnswer = { status: 503, text: 'No work store.' }
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'Command running in background with ID: b4zduzypn. Output is being written to: x' } }) as never)
    await $.session.start(START)
    await settle()
    expect(fileOf(w)?.name).toBe('Units')
    await clock.advance(1000)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true } as never)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background'])
    // The app's note that it ended starts a turn of its own; that turn's end, with nothing left running, is plain idle.
    await $.prompt.submit({ text: '<task-notification>\n<task-id>b4zduzypn</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' } } as never)
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background', 'busy', 'idle'])
  })

  // F (0.30.0, the lead's live check: Worker 5 read "Stopped" while its gate ran in a background command): the app's own result
  // carries the id (`backgroundTaskId`, a Monitor's `taskId`), not the words "running in background with ID".
  for (const [what, tool, input, result] of [
    ['a background command', 'Bash', { command: 'npm test', run_in_background: true }, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bgate1' }],
    ['a command the app moved to the background at its timeout', 'PowerShell', { command: 'npm test' }, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bgate1', timedOutAfterMs: 120000 }],
    ['a Monitor', 'Monitor', { description: 'the gate', timeout_ms: 300000, command: 'tail -f x' }, { taskId: 'bgate1', timeoutMs: 300000 }],
  ] as const) {
    test(`F: ${what} the chat started reports idle with background until the app's note that it ended`, async ($, on) => {
      const { w } = await joined($, on, () => {
        on('tool.call', { tool }, () => ({ result }) as never)
      })
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.tool.call({ tool, ...input } as never)
      await $.turn.complete({ ...ENDED, turnId: 't1' })
      await settle()
      expect(states(w)).toEqual(['busy', 'idle+background'])
      await $.prompt.submit({ text: '<task-notification>\n<task-id>bgate1</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' } } as never)
      await $.turn.start({ text: '', turnId: 't2' })
      await $.turn.complete({ ...ENDED, turnId: 't2' })
      await settle()
      expect(states(w)).toEqual(['busy', 'idle+background', 'busy', 'idle'])
    })
  }

  test('the review of 0.30.0, F: a Monitor whose end note carries no status leaves the list at its deadline; a persistent one stays', async ($, on) => {
    const { w, clock } = await joined($, on, () => {
      on('tool.call', { tool: 'Monitor' }, (_$, e) => ({ result: (e as { description?: string }).description === 'forever' ? { taskId: 'mkeep', timeoutMs: 0, persistent: true } : { taskId: 'mgate', timeoutMs: 60000 } }) as never)
    })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Monitor', description: 'the gate', timeout_ms: 60000, command: 'tail -f x' } as never)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background'])
    // Its deadline passes: the next ping reads plain idle (mutant "keep a Monitor's id until its note": idle+background stays).
    await clock.advance(70000)
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background', 'idle'])
    await $.turn.start({ text: 'watch', turnId: 't2' })
    await $.tool.call({ tool: 'Monitor', description: 'forever', timeout_ms: 0, command: 'tail -f y' } as never)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await clock.advance(40 * MIN)
    await settle()
    expect(states(w).at(-1)).toBe('idle+background')
  })

  test('8c: a word typed from a take runs its own turn: busy and idle carry its id and the turn\'s start, an ask keeps both, a line the person types after is no word\'s', async ($, on) => {
    const { w, clock } = await joined($, on)
    const wordOf = (body: string): string => {
      const report = (JSON.parse(body) as { report: { state: string; since: number; word: string | null; turn: number | null } }).report
      return `${report.state} ${report.since} ${report.word} ${report.turn}`
    }
    w.waiting.push({ id: '75bc2b9b', text: 'B920: approved' })
    await clock.advance(5000)
    await settle()
    expect(w.typedIn).toEqual(['plugin:as the person:B920: approved'])
    await clock.advance(1000)
    await $.turn.start({ text: 'B920: approved', turnId: 't1' })
    await settle()
    await clock.advance(1000)
    w.formAnswers = { 'Which port?': '4320' }
    await $.tool.call(FORM as never)
    await afterForm()
    await settle()
    await clock.advance(1000)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    await clock.advance(1000)
    await $.turn.start({ text: 'and the lava?', turnId: 't2' })
    await settle()
    // Mutant "turn moves on an ask": the busy after the answer would carry turn 7000.
    expect(w.reports.map(wordOf)).toEqual(['busy 6000 75bc2b9b 6000', 'asking 7000 75bc2b9b 6000', 'busy 7000 75bc2b9b 6000', 'idle 8000 75bc2b9b 6000', 'busy 9000 null 9000'])
  })

  test('8c: two words of one take run one per turn, in order; a turn with no word of ours says null', async ($, on) => {
    const { w, clock } = await joined($, on)
    const words = (): string[] => w.reports.map(body => (JSON.parse(body) as { report: { state: string; word: string | null } }).report).map(one => `${one.state} ${one.word}`)
    w.waiting.push({ id: 'm1', text: 'first' }, { id: 'm2', text: 'second' })
    await clock.advance(5000)
    await settle()
    for (const [text, id] of [['first', 't1'], ['second', 't2'], ['', 't3']]) {
      await $.turn.start({ text, turnId: id })
      await $.turn.complete({ ...ENDED, turnId: id })
      await settle()
    }
    expect(words()).toEqual(['busy m1', 'idle m1', 'busy m2', 'idle m2', 'busy null', 'idle null'])
  })

  test('a subagent still running at the turn\'s end reports idle with background, and its end plain idle', async ($, on) => {
    const { w } = await joined($, on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.agents = [{ id: 'a1b2-judge', name: 'judge' }]
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background'])
    // Its end wakes the chat with a turn of its own; that turn's end, with nothing left running, is plain idle.
    w.agents = []
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background', 'busy', 'idle'])
  })

  test('the review of chat-reports, 5a: a turn cut short keeps the background shell the chat started until the app says it ended', async ($, on) => {
    const { w } = await joined($, on, () => background(on))
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true } as never)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.turn.start({ text: 'more', turnId: 't2' })
    await $.turn.complete({ ...ENDED, reason: 'aborted', isAborted: true, turnId: 't2' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle+background', 'busy', 'idle+background'])
    // The app's note that it ended takes it off the list: the next turn's end is plain idle.
    await $.prompt.submit({ text: '<task-notification>\n<task-id>b4zduzypn</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' } } as never)
    await $.turn.start({ text: '', turnId: 't3' })
    await $.turn.complete({ ...ENDED, turnId: 't3' })
    await settle()
    expect(states(w).at(-1)).toBe('idle')
  })

  test('a background shell the chat stops itself (TaskStop) is off the list, with no note of the app\'s', async ($, on) => {
    const { w } = await joined($, on, () => {
      background(on)
      on('tool.call', { tool: 'TaskStop' }, () => ({ result: 'stopped' }) as never)
    })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true } as never)
    await $.tool.call({ tool: 'TaskStop', task_id: 'b4zduzypn' } as never)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(states(w)).toEqual(['busy', 'idle'])
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
    await startedAs($, w, null)
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
    await $.prompt.submit({ text: '(answered on the worker board, 11:05) Q2 "Box or yew?": yew', origin: { kind: 'plugin', name: 'workers', asUser: true } } as never)
    expect(w.whoamis.length).toBe(before)
    expect(w.typedIn.at(-1)).toContain('Q2 "Box or yew?": yew')
    // The person's own prompt a minute on does ask.
    await prompt($)
    expect(w.whoamis.length).toBe(before + 1)
  })

  test('2026-10-31: the list names the Supervisor and its session id, as the board told it, so a chat can tell it the board is down', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    // The board named no Supervisor at the start: the list says none.
    expect((await $.tool.call({ tool: TOOL, action: 'list' })).result).not.toContain('The Supervisor')
    // A chat of the same process hears it with its next whoami answer (a minute on at the latest), and the list names it.
    w.whoami = { name: 'Units', role: 'worker', card: null, supervisor: { name: 'Supervisor', session: 'local_9f2c-11' } }
    await clock.advance(60_000)
    await settled()
    await prompt($, 'a minute on')
    const listing = String((await $.tool.call({ tool: TOOL, action: 'list' })).result)
    expect(listing).toContain('\nThe Supervisor: Supervisor, session id local_9f2c-11 (the id for mcp__ccd_session_mgmt__send_message)')
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
    // A prompt a minute on is held the same way, and goes in unnamed. Meanwhile the unnamed chat asked again on its own
    // (the tick's `whoamiAgain`, 2026-10-28), each ask held the same way.
    await clock.advance(60_000)
    await settled()
    const before = held.whoamis.length
    expect(before).toBeGreaterThan(1)
    const submitted = prompt($, 'hello')
    for (let i = 0; i < 100 && held.whoamis.length <= before; i++) await real(5)
    expect(held.whoamis.length).toBe(before + 1)
    expect(held.typedIn).toEqual([])
    await clock.advance(1500)
    await submitted
    expect(held.typedIn).toEqual(['composer:framed:hello'])
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

  // 2026-10-28 (the person: "Yes, move it"): the mod has no prompt.compose hook (the app's guard skips it on a work login): the
  // standing note is in the work tool, on every login.
  test('named by the board, the work tool\'s description carries the chat\'s standing note', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.whoami = { name: 'Units', role: 'worker', card: null }
    stand(on, w)
    await $.session.start(START)
    expect(w.descriptions.work).toContain('This chat is "Units" in the person\'s list of chats')
    expect(w.descriptions.work).toContain('(answered on the worker board, HH:MM)')
  })

  // 2026-10-28, the person's test on the work login: Worker 5 was named and its card moved, but its start's words were made
  // about 4 s after the first prompt had gone to the model. Now they are made when the clear runs.
  test('a person\'s /clear: the card moves and the start\'s words are made when the clear runs, before any prompt', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.whoami = { name: 'Units', role: 'worker', card: null }
    w.byAction = { next: { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [] }) } }
    stand(on, w)
    await $.session.start(START)
    expect(fileOf(w)?.name).toBe('Units')
    // The clear: the old conversation ends, the app's new one has another id, and the command answers.
    await $.session.end({ reason: 'clear', sessionId: 'units', resume: { id: 'units' } } as never)
    w.id = 'units-2'
    await $.command.run({ command: 'clear', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
    // Before any prompt: the card is under the new session already.
    expect((JSON.parse(w.files[`${CHATS}/units.json`] ?? '{}') as { movedTo?: unknown }).movedTo).toBe('units-2')
    expect(fileOf(w, 'units-2')?.name).toBe('Units')
    // The first prompt only adds the words made at the clear.
    await prompt($)
    expect(startsWith(w, 0, 'This chat is')).toBe(true)
  })

  // The second test that day: the card moved at the clear, the prompt came 2 s later, and the words still waited for the
  // board's answer to "next". They stand ready at once now.
  test('the start\'s words do not wait for the board: a prompt while its answer is still on the way carries them', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.whoami = { name: 'Units', role: 'worker', card: null }
    w.byAction = { next: { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [] }) } }
    stand(on, w)
    await $.session.start(START)
    let release: () => void = () => {}
    w.holdAction = { action: 'next', until: new Promise<void>(done => { release = done }) }
    await $.session.end({ reason: 'clear', sessionId: 'units', resume: { id: 'units' } } as never)
    w.id = 'units-2'
    // The clear answers while the board still holds "next"; the prompt comes before it answers.
    void $.command.run({ command: 'clear', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
    await real(50)
    // The prompt does not wait for the board: it goes on within about a second, with the words.
    const asked = prompt($).then(() => 'went')
    await real(50)
    await clock.advance(1_100)
    const went = await Promise.race([asked, real(3_000).then(() => 'held')])
    release()
    expect(went).toBe('went')
    expect(startsWith(w, 0, 'This chat is')).toBe(true)
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

    // 2026-10-28, the person's choice A: the app lists a new conversation only after its first answer.
    test('unnamed at its start, it asks again on its own: named seconds later, its card moves, and its next prompt carries the words', async ($, on) => {
      const clock = mock.clock(on)
      const w = fresh(cardOf('Units'), { name: null, role: null, card: null })
      stand(on, w)
      await $.session.start(START)
      expect(movedTo(w)).toBeUndefined()
      // The app has listed the conversation now: the tick's next ask names it.
      w.whoami = { name: 'Units', role: 'worker', card: 'units' }
      await clock.advance(5_000)
      for (let i = 0; i < 100 && movedTo(w) === undefined; i++) await real(5)
      expect(movedTo(w)).toBe('units-2')
      await prompt($)
      expect(startsWith(w, 0, 'This chat is')).toBe(true)
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

    for (const [role, name, kind] of [['main', 'Main', 'main'], ['advisor', 'Advisor', 'worker'], ['owner', 'Product owner', 'worker'], ['helper', 'Advisor 2', 'worker'], ['supervisor', 'Supervisor', 'worker']] as const) {
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

// T14 (the person, 2026-10-30: "B", fix A for X1 / X103): the claim of the board's hands says 'send' only where the app's
// check allows this chat's code the send-message tool with no question; an ask (in Auto mode the classifier) says nothing.
describe('the hands say whether this chat may send by code', () => {
  test('the claim names send only while the check of the send-message tool answers allow', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: JSON.stringify({ url: 'http://127.0.0.1:4311', key: 'ab'.repeat(32), startedAt: 1, hands: true }) })
    let send = 'ask'
    const asked: unknown[] = []
    on('tool.check', (_$, e) => {
      if (e.tool !== 'mcp__ccd_session_mgmt__send_message') return { decision: 'ask' as const }
      asked.push(e.tool_use_id)
      return { decision: send as 'allow' | 'ask' }
    })
    stand(on, w)
    await startedAs($, w, 'Units')
    const claims = (): unknown[] => w.fetched.filter(one => one.url.endsWith('/api/bridge/hands')).map(one => (JSON.parse(one.body) as { can?: unknown }).can ?? [])
    await clock.advance(20_000)
    await settle()
    expect(claims()).toEqual([[]])
    // A query: no call id, so the popup watch notes nothing.
    expect(asked).toEqual([undefined])
    // The rule is added: the chat asks the app again after 10 minutes and says it may send.
    send = 'allow'
    await clock.advance(10 * MIN)
    await settle()
    expect(claims().at(-1)).toEqual(['send'])
  })
})

describe('T8.5: the board\'s hand-over as one envelope (Workers mod 0.27.0)', () => {
  /** Real time passing, for the work the engine queues (a command run once the chat is idle). */
  const wait = (ms: number): Promise<void> => new Promise(resolve => { (globalThis as unknown as { setTimeout: (done: () => void, ms: number) => void }).setTimeout(resolve, ms) })
  const sent = (w: World): Record<string, unknown>[] => w.worked.map(body => JSON.parse(body) as Record<string, unknown>)
  const ok = (fields: Record<string, unknown>): { status: number; text: string } => ({ status: 200, text: JSON.stringify(fields) })
  const LOG = '.claude/chat-logs/Units/2026-10-31 1405 B12.txt'
  const FILE = 'D:/Work/project/.claude/chat-logs/Units/2026-10-31 1405 B12.txt'
  const LINE = 'work: B13 is yours; run work next'
  const ID = '0123456789abcdef'
  /** The board's envelope as DESIGN.md's contract has it: a task with the clear its worker owes, unless `more` says otherwise. */
  const envelope = (more: Record<string, unknown> = {}): Record<string, unknown> => ({ id: ID, kind: 'task', step: 'B13', clear: { step: 'B12', reportedAt: 5 }, restart: false, set: null, line: LINE, ...more })
  /** The board's `handover` in its answer to a turn's end. */
  const handover = (env: Record<string, unknown> | null, state = 'handing'): Record<string, unknown> => ({ state, why: null, step: (env?.step as string | undefined) ?? null, envelope: env, waits: null })
  /** The outcomes the mod told the board (`typed` with `handover`), in order. */
  const outcomes = (w: World): Record<string, unknown>[] => w.reported.map(body => JSON.parse(body) as Record<string, unknown>)
    .filter(body => body.handover !== undefined && body.outcome !== undefined)
    .map(({ stages: _stages, ...body }) => body)
  /** The lazy clear (0.31.0): the stages the final outcome carried, by name, and every stage told alone, in order. */
  const finalStages = (w: World): string[] => ((w.reported.map(body => JSON.parse(body) as { outcome?: unknown; stages?: { stage: string }[] }).find(body => body.outcome !== undefined)?.stages) ?? []).map(one => one.stage)
  const stagesAlone = (w: World): { stage: string; at: number; why?: string; log?: string; ticket?: string; session?: string }[] => w.reported
    .map(body => JSON.parse(body) as { outcome?: unknown; stages?: { stage: string; at: number }[] })
    .filter(body => body.outcome === undefined && Array.isArray(body.stages)).flatMap(body => body.stages ?? [])
  /** What the hand-over did, with the stages told alone in their place. */
  const flow = (w: World): string[] => w.order.filter(one => ['save-log', '/clear', 'prompt', 'typed'].includes(one) || one.startsWith('stage:'))
  const DONE = { cleared: null, set: null, typed: null, restarted: null, background: false, why: null }
  /** 4c: the outcomes without their typed times (tested by `timesOf`). */
  const untimed = (told: Record<string, unknown>[]): Record<string, unknown>[] => told.map(one => {
    const { typedAt: _typed, enteredAt: _entered, ...outcome } = one.outcome as Record<string, unknown>
    return { ...one, outcome }
  })
  /** 4c: whether an outcome carries both times, finite, typed at or before entered. */
  const timesOf = (one: Record<string, unknown> | undefined): Record<string, boolean> => {
    const outcome = (one?.outcome ?? {}) as { typedAt?: unknown; enteredAt?: unknown }
    const [typed, entered] = [outcome.typedAt, outcome.enteredAt]
    return { isTyped: Number.isFinite(typed), isEntered: Number.isFinite(entered), isInOrder: Number(typed) <= Number(entered) }
  }
  /** What the hand-over did, in order: the log, the /clear, a prompt typed in, the outcome told. */
  const steps = (w: World): string[] => w.order.filter(one => ['save-log', '/clear', 'prompt', 'typed'].includes(one))

  /** A worker Units of a list that clears after a step, its step B12 reported in its turn; the board answers its turn's end with `answer` as `handover` (null: none). */
  async function worker($: Engine, on: On, answer: Record<string, unknown> | null): Promise<{ w: World; clock: ReturnType<typeof mock.clock> }> {
    const clock = mock.clock(on)
    const w = world('units', { [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear" }\n', [BOARD]: board })
    stand(on, w)
    w.tokens = 400_000
    w.byAction = {
      report: ok({ id: 'B12', text: 'B12 is in review.', more: null }),
      'turn-ended': ok({ text: 'No instruction was left open.', missed: [], open: [], role: 'worker', pause: RUNNING, ...(answer === null ? {} : { handover: answer }) }),
      'save-log': ok({ text: `Saving the conversation to ${FILE}.`, log: LOG, file: FILE }),
      next: ok({ text: 'Yours, Units: B13 (queued).', open: [] }),
    }
    await startedAs($, w, 'Units')
    w.order = []
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
    return { w, clock }
  }
  /** The /clear runs: the old conversation ends, the new one starts under another id; the stand-in's record of this /clear is taken out. */
  async function cleared($: Engine, w: World, clock: ReturnType<typeof mock.clock>, to = 'units-2'): Promise<void> {
    const at = w.order.length
    await $.session.end({ reason: 'clear', sessionId: w.id, resume: { id: w.id } } as never)
    w.id = to
    await $.command.run({ ...CLEAR_ARGS, origin: { kind: 'composer' } } as never)
    w.commanded.pop()
    w.reportsAtClear.pop()
    const index = w.order.indexOf('/clear', at)
    if (index >= 0) w.order.splice(index, 1)
    // The line goes at the next ping after the clear.
    await settle()
    expect(w.typedIn).toEqual([])
    await clock.advance(5000)
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
  }
  /** A take at the next ping, the board answering `answer`. */
  async function take(clock: ReturnType<typeof mock.clock>, w: World, answer: Record<string, unknown>): Promise<void> {
    w.takeAnswers.push({ status: 200, text: JSON.stringify({ messages: [], ...answer }) })
    await clock.advance(5000)
    for (let i = 0; i < 50 && w.takeAnswers.length > 0; i++) await settle()
    for (let i = 0; i < 20; i++) await settle()
  }

  test('change 1, 2, 3: an envelope with a clear: no clear of its own; the log, the mark, /clear, then the line with the start\'s words as one prompt, then the outcome once', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(steps(w)).toEqual(['save-log', '/clear'])
    expect(sent(w).filter(one => one.action === 'save-log')).toEqual([{ action: 'save-log', stepId: 'B12', chat: 'Units', session: 'units' }])
    expect(fileOf(w)?.clearing?.step).toBe('B12')
    expect(fileOf(w)?.clearing?.log).toBe(LOG)
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    expect(w.compactions).toEqual([])
    // Mutant "settle before the line is typed": nothing is typed or told before the /clear has run.
    expect(w.typedIn).toEqual([])
    expect(outcomes(w)).toEqual([])
    // The lazy clear (D1): each stage told alone the moment it happened (mutant: a stage posted only with the outcome).
    expect(stagesAlone(w).map(one => [one.stage, one.log ?? one.ticket ?? null])).toEqual([['log-saved', LOG], ['clear-queued', expect.stringMatching(/^clear-\d+-1$/)]])
    await cleared($, w, clock)
    expect(stagesAlone(w).at(-1)).toEqual({ stage: 'cleared', at: expect.any(Number), session: 'units-2', ticket: stagesAlone(w)[1]?.ticket })
    expect(finalStages(w)).toEqual(['log-saved', 'clear-queued', 'cleared'])
    // One prompt: the words a cleared worker gets (who it is, its rules, its log), then the line. The app hands a mod's own
    // prompt to none of its hooks, so they stand in its text.
    expect(w.typedIn.length).toBe(1)
    const typed = w.typedIn[0] ?? ''
    expect(typed.startsWith('plugin:as the person:This chat is "Game - Units", a worker')).toBe(true)
    expect(typed).toContain('after your step B12 was reported')
    expect(typed).toContain(FILE)
    expect(typed).toContain('.claude/worker-briefing.md')
    expect(typed.endsWith(`\n\n${LINE}`)).toBe(true)
    expect(typed.split('This chat is').length).toBe(2)
    // The set is the board's hands' (done before): null. Told once, after the line was typed.
    expect(untimed(outcomes(w))).toEqual([{ chat: 'Units', session: 'units-2', handover: ID, outcome: { ...DONE, cleared: true, typed: true } }])
    expect(timesOf(outcomes(w)[0])).toEqual({ isTyped: true, isEntered: true, isInOrder: true })
    expect(steps(w)).toEqual(['save-log', '/clear', 'prompt', 'typed'])
    expect(fileOf(w, 'units-2')?.cleared?.step).toBe('B12')
  })

  test('mutant "carry an envelope twice": the same id again at a take or a later turn\'s end does nothing', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    await cleared($, w, clock)
    expect(outcomes(w).length).toBe(1)
    await take(clock, w, { handover: envelope() })
    await $.turn.start({ text: LINE, turnId: 't2' })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await wait(50)
    for (let i = 0; i < 20; i++) await settle()
    expect(steps(w)).toEqual(['save-log', '/clear', 'prompt', 'typed'])
    expect(w.typedIn.map(one => one.endsWith(`\n\n${LINE}`))).toEqual([true])
    expect(outcomes(w).length).toBe(1)
    // Kept for the next process of the mod too.
    expect(w.stored['handover-carried']).toEqual([ID])
  })

  test('the review of 0.30.0, 4c: the line\'s submit resolving after its own turn began (a clock that moves) gives enteredAt at that turn\'s start, not after it', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    let turnAt = -1
    let enter = (): void => {}
    const entering = new Promise<void>(done => { enter = done })
    // The submit is held by the app until the line's turn has started and the clock moved on.
    w.beforeTyped = async (_$$, text) => {
      if (text === LINE) await entering
    }
    stand(on, w)
    await startedAs($, w, 'Units')
    // A free worker's turn's end answered with an envelope with no clear: its line is typed at once (outside any tick).
    w.byAction['turn-ended'] = ok({ missed: [], open: [], role: 'worker', pause: RUNNING, handover: handover(envelope({ clear: null })) })
    await clock.advance(1000)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    for (let i = 0; i < 20; i++) await settle()
    turnAt = clock.now()
    await $.turn.start({ text: LINE, turnId: 't2' })
    await clock.advance(7)
    enter()
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    const outcome = outcomes(w)[0]?.outcome as { typedAt: number; enteredAt: number }
    expect(turnAt).toBe(1000)
    expect(clock.now()).toBeGreaterThanOrEqual(1007)
    // Mutant "enteredAt is the clock after the submit": 1007, after the turn began, so the board never counts that turn.
    expect([outcome.typedAt, outcome.enteredAt]).toEqual([1000, 1000])
  })

  test('change 2 at a take: an envelope with no clear: the line typed at once, then the outcome; no log, no /clear', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    w.order = []
    // Change 3: a set the board's hands made before: the mod sets nothing and says null.
    await take(clock, w, { handover: envelope({ clear: null, set: { model: 'claude-opus-4-1', effort: 'high' } }) })
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
    expect((w.contexts.at(-1) ?? []).some(line => line.startsWith('This chat is'))).toBe(false)
    // 4c (0.30.0): the exact times: typed just before the submit, entered when it resolved (the take ran at 5 s).
    expect(outcomes(w)).toEqual([{ chat: 'Units', session: 'units', handover: ID, outcome: { ...DONE, typed: true, typedAt: 5000, enteredAt: 5000 } }])
    expect(steps(w)).toEqual(['prompt', 'typed'])
  })

  test('change 4, mutant "clear before restart": a restart keeps the log and marks the card, and nothing else: no /clear, no line', async ($, on) => {
    const { w } = await worker($, on, handover(envelope({ kind: 'restart', restart: true, version: '0.27.1' }), 'restarting'))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    for (let i = 0; i < 20; i++) await settle()
    expect(steps(w)).toEqual(['save-log', 'typed'])
    expect(w.commanded).toEqual([])
    expect(w.typedIn).toEqual([])
    expect(w.compactions).toEqual([])
    expect(fileOf(w)?.clearing?.log).toBe(LOG)
    expect(w.toasts).toContain(`Restarting for the Workers mod 0.27.1: its conversation is kept in ${FILE}.`)
    expect(outcomes(w)).toEqual([{ chat: 'Units', session: 'units', handover: ID, outcome: { ...DONE, restarted: true } }])
  })

  for (const [why, set, words, isBackground] of [
    ['the board refuses the log while background work runs', (w: World) => { w.byAction['save-log'] = { status: 409, text: 'Background work it started is still running: its answer would come into a cleared conversation.' } }, 'Background work it started is still running', true],
    ['a subagent it started still runs', (w: World) => { w.agents = [{ id: 'a1b2c3d4e5', name: 'judge' }] }, 'a subagent it started still runs (1)', true],
    ['the person pauses', (w: World) => { w.pauseAnswer = { ...RUNNING, state: 'pausing', since: 1 } }, 'the person pauses the chats', false],
    ['it sent another chat a message in this turn', (_w: World) => {}, 'waits for its answer', false],
  ] as const) {
    test(`the lazy clear, a clear with every guard of today's: not run when ${why}: told at once, the line typed anyway into the old conversation (but not in the person's pause), nothing compacted`, async ($, on) => {
      const { w } = await worker($, on, handover(envelope()))
      set(w)
      if (why === 'it sent another chat a message in this turn') await $.session.send({ to: 'local_main', text: 'B12?', origin: { kind: 'model' } } as never)
      await $.turn.complete({ ...ENDED, turnId: 't1' })
      await wait(50)
      for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
      expect(w.commanded).toEqual([])
      expect(w.compactions).toEqual([])
      expect(fileOf(w)?.clearNote?.why).toContain(words)
      const isPause = why === 'the person pauses'
      // R2: the line goes at once (the same turn's end), as one prompt with no start's words; D3: none in the pause.
      expect(w.typedIn).toEqual(isPause ? [] : [`plugin:as the person:${LINE}`])
      const told = outcomes(w)
      expect(told.length).toBe(1)
      const outcome = told[0]?.outcome as Record<string, unknown>
      const { typedAt: _typed, enteredAt: _entered, clearWhy: _why, ...rest } = outcome
      expect(rest).toEqual({ ...DONE, cleared: false, typed: isPause ? null : true, background: isBackground })
      // Every cleared:false carries its words (the board tells 0.31.0 from 0.30.0 by them).
      expect(String(outcome.clearWhy)).toContain(words)
      // D3 with the board's Task 3 review: the pause's words exactly as the board's PAUSED_WHY (its release reads them).
      if (isPause) expect(outcome.clearWhy).toBe('the person pauses the chats')
      expect(stagesAlone(w).map(one => one.stage)).toEqual(['clear-refused'])
      expect(stagesAlone(w)[0]?.why).toBe(outcome.clearWhy)
    })
  }

  test('the lazy clear: a /clear clearrun.ts refuses (a prompt came first): clear-refused told at once, no 2 minutes, and the line typed at the next ping', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    await $.prompt.submit({ text: 'one more thing', origin: { kind: 'composer' } } as never)
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('Not cleared: a new prompt came in before the clear ran.')
    for (let i = 0; i < 20; i++) await settle()
    expect(stagesAlone(w).at(-1)?.stage).toBe('clear-refused')
    expect(stagesAlone(w).at(-1)?.why).toBe('a new prompt came in before the clear ran')
    await clock.advance(5000)
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    expect(w.typedIn).toEqual(['composer:framed:one more thing', `plugin:as the person:${LINE}`])
    expect(untimed(outcomes(w)).map(one => one.outcome)).toEqual([{ ...DONE, cleared: false, typed: true, clearWhy: 'a new prompt came in before the clear ran' }])
  })

  test('the lazy clear, D5: a worker on the sequence whose report\'s turn\'s end the board does not answer is not cleared by the mod alone (mutant: the no-answer fallback clear)', async ($, on) => {
    const { w } = await worker($, on, handover(null, 'free'))
    // An earlier turn's end put it on the sequence.
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(steps(w)).toEqual([])
    // The next step is reported, and the board refuses its turn's end (it restarts): no lone clear, no compaction.
    w.byAction['turn-ended'] = { status: 503, text: 'The board restarts: try again in a moment.' }
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await wait(50)
    for (let i = 0; i < 20; i++) await settle()
    expect(steps(w)).toEqual([])
    expect(w.commanded).toEqual([])
    expect(w.compactions).toEqual([])
  })

  test('the lazy clear: the board does not answer the save-log in 5 s: "the board did not answer in 5 s" told at once, the line typed in the same turn\'s end, the outcome cleared:false (mutant: the line waiting for the net)', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    let release = (): void => {}
    w.holdAction = { action: 'save-log', until: new Promise<void>(done => { release = done }) }
    const ending = $.turn.complete({ ...ENDED, turnId: 't1' })
    for (let i = 0; i < 20; i++) await settle()
    await clock.advance(5000)
    await ending
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    // Before any tick of the 20 s net: the line is in.
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
    expect(w.commanded).toEqual([])
    expect(stagesAlone(w).map(one => [one.stage, one.why])).toEqual([['clear-refused', 'the board did not answer in 5 s']])
    expect(untimed(outcomes(w)).map(one => one.outcome)).toEqual([{ ...DONE, cleared: false, typed: true, clearWhy: 'the board did not answer in 5 s' }])
    release()
  })

  test('the lazy clear, D2 and review focus 1: a /clear the app has not run in 20 s: dropped completely (no mark, no record), then the line; the late /clear is refused and never clears mid-task (mutant: the line typed with the clear still on its way)', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    // The Task 2 review (m4): what stood when the line was submitted: the card's mark and the stored record.
    const atLine: { mark: unknown; record: unknown }[] = []
    w.beforeTyped = async () => { atLine.push({ mark: fileOf(w)?.clearing, record: w.stored['clear-pending:units'] }) }
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    // The Task 2 review (m2): the clear was kept in the store, with its envelope, before its /clear went (mutant: no store).
    const kept = w.storedAtClear?.[0]?.['clear-pending:units'] as { envelope?: { id?: string }; lineTyped?: boolean } | undefined
    expect([kept?.envelope?.id, kept?.lineTyped]).toEqual([ID, false])
    // 15 s on, nothing yet.
    await clock.advance(15_000)
    for (let i = 0; i < 20; i++) await settle()
    expect(w.typedIn).toEqual([])
    await clock.advance(5000)
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    // D2's order: the card's mark was off and the record marked (or gone) before the line (mutant m4: the line first).
    expect(atLine.length).toBe(1)
    expect(atLine[0]?.mark).toBeUndefined()
    expect((atLine[0]?.record as { lineTyped?: boolean } | undefined)?.lineTyped ?? true).toBe(true)
    expect(fileOf(w)?.clearing).toBeUndefined()
    expect(fileOf(w)?.clearNote?.why).toBe('not run in 20 s')
    for (let i = 0; i < 20 && w.stored['clear-pending:units'] !== undefined; i++) await settle()
    expect(w.stored['clear-pending:units']).toBeUndefined()
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
    expect(untimed(outcomes(w)).map(one => one.outcome)).toEqual([{ ...DONE, cleared: false, typed: true, clearWhy: 'not run in 20 s' }])
    expect(finalStages(w)).toEqual(['log-saved', 'clear-queued', 'clear-refused'])
    // Review focus 1: the line was typed between the /clear's queue and its run; the app runs that late /clear before the
    // line's turn has started (no prompt the mod's hooks saw): refused, nothing cleared (mutant: the clear kept on its way).
    const late = await $.command.run(CLEAR_BY_MOD)
    expect(late.text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    // And once the line's turn runs: the same.
    await $.turn.start({ text: LINE, turnId: 't2' })
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    expect(untimed(outcomes(w)).length).toBe(1)
  })

  test('the whole-branch review, D2: a late /clear whose session id comes only after the 20 s net fired reads the clear on its way after that await: it was dropped meanwhile, so it finds nothing to run (mutant: the clear read before the await)', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    // The app runs another /clear of the mod's late; the hook waits for the session's id, which comes slowly.
    let release = (): void => {}
    w.holdNextId = new Promise<void>(done => { release = done })
    const late = $.command.run(CLEAR_BY_MOD)
    await settle()
    expect(w.holdNextId).toBeNull()
    // Meanwhile the 20 s net comes due: the clear is dropped completely and the line goes, once.
    await clock.advance(20_000)
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
    expect(finalStages(w)).toEqual(['log-saved', 'clear-queued', 'clear-refused'])
    // The id comes: the hook reads the clear on its way now, and finds none (mutant: it read it before the await, found the clear
    // and ran it into the conversation that has the task: a second /clear, a 'cleared' stage).
    release()
    expect((await late).text).toBe('Not cleared: this /clear of the Workers mod was let go before it ran.')
    for (let i = 0; i < 20; i++) await settle()
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    expect(finalStages(w)).not.toContain('cleared')
    expect(stagesAlone(w).map(one => one.stage)).not.toContain('cleared')
    expect(w.typedIn.length).toBe(1)
  })

  test('the Task 2 review (1, D3): the person pauses while the /clear waits: at 20 s no line, settled typed null with exactly the board\'s PAUSED_WHY; the net\'s own words stay in the stage', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    w.pauseAnswer = { ...RUNNING, state: 'pausing', since: 1 }
    await clock.advance(20_000)
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    expect(w.typedIn).toEqual([])
    expect(untimed(outcomes(w)).map(one => one.outcome)).toEqual([{ ...DONE, cleared: false, clearWhy: 'the person pauses the chats' }])
    expect(stagesAlone(w).at(-1)).toEqual({ stage: 'clear-refused', at: expect.any(Number), why: 'not run in 20 s' })
  })

  test('the Task 2 review (3): a /clear that runs while the 20 s net comes due: no line into the conversation being cleared; it ran, so the line follows the clear and the stage says cleared', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    // The app runs the queued /clear now, and it takes its time.
    let release = (): void => {}
    w.holdClear = new Promise<void>(done => { release = done })
    const running = $.command.run(CLEAR_BY_MOD)
    await settle()
    await clock.advance(25_000)
    for (let i = 0; i < 20; i++) await settle()
    expect(w.typedIn).toEqual([])
    expect(outcomes(w)).toEqual([])
    // It ends: the conversation after it gets the line, and the clear is told as run.
    await $.session.end({ reason: 'clear', sessionId: w.id, resume: { id: w.id } } as never)
    w.id = 'units-2'
    release()
    await running
    await clock.advance(5000)
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    expect(untimed(outcomes(w)).map(one => [one.session, (one.outcome as { cleared: unknown }).cleared])).toEqual([['units-2', true]])
    expect(finalStages(w)).toContain('cleared')
    expect(w.typedIn.length).toBe(1)
  })

  test('the Task 2 review (2, 6): a kept clear in a new process whose store cannot forget it: its line goes once, after the card\'s mark is off', async ($, on) => {
    const at = 50 * MIN
    const clock = mock.clock(on, { now: at + 5000 })
    const marked: ChatFile = { name: 'Units', role: 'worker', state: 'waiting', task: null, at, clearing: { at, step: 'B12', log: LOG } }
    const w = world('units', { ...listed({ units: marked }), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'Yours, Units:', open: [] }) }
    w.stored['clear-pending:units'] = { ticket: 'clear-7-2', from: 'units', step: 'B12', at, envelope: envelope(), outcome: null }
    w.storeDeleteFails = true
    const marks: unknown[] = []
    w.beforeTyped = async () => { marks.push([fileOf(w)?.clearing, (w.stored['clear-pending:units'] as { lineTyped?: boolean } | undefined)?.lineTyped]) }
    await $.session.start(START)
    // Two and a half minutes of ticks: the 20 s net and the 2-minute net both pass.
    for (let s = 0; s < 150; s += 5) {
      await clock.advance(5000)
      for (let i = 0; i < 5; i++) await settle()
    }
    expect(w.typedIn.filter(one => one.endsWith(LINE)).length).toBe(1)
    // D2's order (m4, 6): the card's mark off and the record marked lineTyped before the line.
    expect(marks).toEqual([[undefined, true]])
    expect(untimed(outcomes(w)).length).toBe(1)
  })

  test('the Task 2 review (7, D5): a new process of a worker on the sequence (kept in the store) whose report\'s turn\'s end the board refuses makes no lone clear', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear" }\n', [BOARD]: board })
    stand(on, w)
    w.stored['handover-sequence'] = { units: 1 }
    w.byAction = {
      report: ok({ id: 'B12', text: 'B12 is in review.', more: null }),
      'turn-ended': { status: 503, text: 'The board restarts: try again in a moment.' },
      'save-log': ok({ text: `Saving the conversation to ${FILE}.`, log: LOG, file: FILE }),
    }
    await startedAs($, w, 'Units')
    w.order = []
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'it is in' } as never)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    for (let i = 0; i < 20; i++) await settle()
    await clock.advance(5000)
    expect(steps(w)).toEqual([])
    expect(w.commanded).toEqual([])
    expect(w.compactions).toEqual([])
  })

  test('the lazy clear, R5: a turn that starts before the envelope\'s /clear ran drops it: told at once, and its line goes anyway at the next ping (never from inside the prompt\'s hook)', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(w.commanded).toEqual(['/clear by plugin workers'])
    await $.turn.start({ text: 'one more thing', turnId: 't2' })
    for (let i = 0; i < 20; i++) await settle()
    expect(stagesAlone(w).map(one => [one.stage, one.why ?? null]).at(-1)).toEqual(['clear-refused', 'a new turn started before the clear ran'])
    expect(w.typedIn).toEqual([])
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await clock.advance(5000)
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
    expect(untimed(outcomes(w))).toEqual([{ chat: 'Units', session: 'units', handover: ID, outcome: { ...DONE, cleared: false, typed: true, clearWhy: 'a new turn started before the clear ran' } }])
    // Its late /clear finds no clear on its way.
    expect((await $.command.run(CLEAR_BY_MOD)).text).not.toBe('')
  })

  // B944 (X134, X135): the clear-only envelope of an idle worker ("free"), as Worker 3 and Worker 4 got it on 2026-11-02.
  const CLEAR_ONLY = { kind: 'clear', step: null, line: null }

  test('B944, the real case: an idle worker\'s clear whose /clear comes with the mod\'s queue out of step runs, never the two-minute let-go', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope(CLEAR_ONLY), 'free'))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    // The kit ran the queued /clear at once on the same session: the clear is still on its way, and the mod's queue holds no
    // ticket for the /clear the engine runs now, as in the real chats (each refused it as "let go" within 8 to 19 ms).
    expect(fileOf(w)?.clearing?.step).toBe('B12')
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('')
    expect(w.commanded).toEqual(['/clear by plugin workers', '/clear by plugin workers'])
    await $.session.end({ reason: 'clear', sessionId: w.id, resume: { id: w.id } } as never)
    w.id = 'units-2'
    await clock.advance(5000)
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    expect(outcomes(w)).toEqual([{ chat: 'Units', session: 'units-2', handover: ID, outcome: { ...DONE, cleared: true } }])
    expect(fileOf(w, 'units-2')?.cleared?.step).toBe('B12')
    await clock.advance(3 * MIN)
    for (let i = 0; i < 20; i++) await settle()
    expect(fileOf(w, 'units-2')?.clearNote).toBeUndefined()
  })

  test('B944: a /clear of the mod after a prompt came in still drops the clear at once, its why told, never a wait', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope(CLEAR_ONLY), 'free'))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    await $.prompt.submit({ text: 'one more thing', origin: { kind: 'composer' } } as never)
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('Not cleared: a new prompt came in before the clear ran.')
    for (let i = 0; i < 20; i++) await settle()
    // The lazy clear: told at once with its clearWhy; an old board's clear-only envelope has no line to type.
    expect(outcomes(w)).toEqual([{ chat: 'Units', session: 'units', handover: ID, outcome: { ...DONE, cleared: false, clearWhy: 'a new prompt came in before the clear ran' } }])
    expect(fileOf(w)?.clearing).toBeUndefined()
    await clock.advance(3 * MIN)
    for (let i = 0; i < 20; i++) await settle()
    expect(fileOf(w)?.clearNote?.why).toBe('a new prompt came in before the clear ran')
  })

  test('B944: a /clear of the mod after the chat was cleared already never clears the fresh conversation', async ($, on) => {
    const { w } = await worker($, on, handover(envelope(CLEAR_ONLY), 'free'))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    await $.session.end({ reason: 'clear', sessionId: w.id, resume: { id: w.id } } as never)
    w.id = 'units-2'
    expect((await $.command.run(CLEAR_BY_MOD)).text).toBe('Not cleared: this chat was cleared already; this /clear of the Workers mod was let go.')
    expect(w.commanded).toEqual(['/clear by plugin workers'])
  })

  test('change 1: a `handover` with no envelope (the board checks the report): no clear of its own, no compaction, nothing told', async ($, on) => {
    const { w } = await worker($, on, handover(null, 'checking'))
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(steps(w)).toEqual([])
    expect(w.compactions).toEqual([])
    expect(fileOf(w)?.clearNote).toBeUndefined()
    expect(outcomes(w)).toEqual([])
  })

  test('no `handover` in the answer (an older board, the setting "timers"): as 0.26.10, its own clear after the report', async ($, on) => {
    const { w } = await worker($, on, null)
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await wait(50)
    expect(steps(w)).toEqual(['save-log', '/clear'])
    expect(sent(w).find(one => one.action === 'turn-ended')?.pull).toBe(true)
    expect(outcomes(w)).toEqual([])
  })

  test('change 5: every answered turn\'s end is told, also while it holds a step; on the sequence it pulls nothing', async ($, on) => {
    mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    w.workAnswer = ok({ missed: [], open: [], role: 'worker', pause: RUNNING, handover: handover(null, 'free') })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    // It takes a step: its card holds it, and its turns' ends are told all the same.
    w.workAnswer = ok({ id: 'B13', title: 'Plant the hedge', text: 'B13 is yours.' })
    await $.turn.start({ text: LINE, turnId: 't2' })
    await $.tool.call({ tool: WORK, action: 'take', id: 'B13', branch: 'b13' } as never)
    w.workAnswer = ok({ missed: [], open: [], role: 'worker', pause: RUNNING, handover: handover(null, 'working') })
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await $.turn.start({ text: 'more', turnId: 't3' })
    await $.turn.complete({ ...ENDED, turnId: 't3' })
    const ends = sent(w).filter(one => one.action === 'turn-ended')
    expect(ends.length).toBe(3)
    // The first, before the board said it is on the sequence, pulled as before; none after.
    expect(ends.map(one => one.pull ?? null)).toEqual([true, null, null])
  })

  test('change 6: while idle the background work is read anew at each 5-second ping: its end reaches the board without a turn', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    w.workAnswer = { status: 503, text: 'No work store.' }
    await startedAs($, w, 'Units')
    const states = (): string[] => w.reports.map(body => {
      const report = (JSON.parse(body) as { report: { state: string; background: boolean } }).report
      return report.background ? `${report.state}+background` : report.state
    })
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.agents = [{ id: 'a1b2-judge', name: 'judge' }]
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(states()).toEqual(['busy', 'idle+background'])
    await clock.advance(5000)
    await settle()
    expect(states()).toEqual(['busy', 'idle+background'])
    // The subagent ends with no turn of the chat's: the next ping tells the board.
    w.agents = []
    await clock.advance(5000)
    for (let i = 0; i < 20; i++) await settle()
    expect(states()).toEqual(['busy', 'idle+background', 'idle'])
  })

  test('a reported step\'s turn\'s end answered late with an envelope: its clear, never the mod\'s own as well', async ($, on) => {
    const { w, clock } = await worker($, on, handover(envelope()))
    let release = (): void => {}
    w.holdAction = { action: 'turn-ended', until: new Promise<void>(done => { release = done }) }
    const ending = $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    await clock.advance(2000)
    await ending
    expect(steps(w)).toEqual([])
    release()
    for (let i = 0; i < 100 && !w.commanded.includes('/clear by plugin workers'); i++) await wait(5)
    await wait(50)
    expect(steps(w)).toEqual(['save-log', '/clear'])
    expect(w.compactions).toEqual([])
    await cleared($, w, clock)
    expect(w.typedIn.map(one => one.startsWith('plugin:as the person:This chat is') && one.endsWith(`\n\n${LINE}`))).toEqual([true])
    expect(untimed(outcomes(w)).map(one => one.outcome)).toEqual([{ ...DONE, cleared: true, typed: true }])
  })

  test('a free worker\'s turn\'s end answered late with an envelope: carried out when the answer comes', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    w.order = []
    w.byAction['turn-ended'] = ok({ missed: [], open: [], role: 'worker', pause: RUNNING, handover: handover(envelope({ clear: null })) })
    let release = (): void => {}
    w.holdAction = { action: 'turn-ended', until: new Promise<void>(done => { release = done }) }
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ending = $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    await clock.advance(2000)
    await ending
    expect(w.typedIn).toEqual([])
    release()
    for (let i = 0; i < 50 && outcomes(w).length === 0; i++) await settle()
    expect(w.typedIn).toEqual([`plugin:as the person:${LINE}`])
    expect(outcomes(w).map(one => one.outcome)).toEqual([{ ...DONE, typed: true, typedAt: 2000, enteredAt: 2000 }])
  })

  test('8c: the envelope\'s line is a word too: the turn it starts reports the envelope\'s id (its outbox id)', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    await take(clock, w, { handover: envelope({ clear: null }) })
    await clock.advance(1000)
    await $.turn.start({ text: LINE, turnId: 't1' })
    for (let i = 0; i < 5; i++) await settle()
    const busy = w.reports.map(body => (JSON.parse(body) as { report: { state: string; word: unknown; turn: unknown } }).report).filter(one => one.state === 'busy')
    expect(busy.map(one => [one.word, one.turn])).toEqual([[ID, 6000]])
  })

  test('Task 6 (0.31.0): a merged prompt that holds the envelope\'s line and a taken word confirms the word only: the envelope\'s outcome is its own', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    // The app holds both submits (it queued them behind a turn): neither resolves.
    w.beforeTyped = async () => new Promise<never>(() => {})
    stand(on, w)
    await startedAs($, w, 'Units')
    await take(clock, w, { handover: envelope({ clear: null }) })
    await take(clock, w, { messages: [{ id: 'm9', text: 'B13: approved, go on with the next part' }] })
    await clock.advance(1000)
    await $.turn.start({ text: `${LINE}\n\nB13: approved, go on with the next part`, turnId: 't1' })
    for (let i = 0; i < 5; i++) await settle()
    const typed = w.reported.map(body => JSON.parse(body) as { typed?: string[]; handover?: string }).flatMap(body => body.typed ?? [])
    // Mutant "the envelope's line is confirmed too": the envelope's id would be told typed (its outcome comes from its own submit).
    expect(typed).toEqual(['m9'])
    expect(outcomes(w)).toEqual([])
    // The turn is named by the first word in outbox order: the envelope's line was typed first.
    const busy = w.reports.map(body => (JSON.parse(body) as { report: { state: string; word: unknown } }).report).filter(one => one.state === 'busy')
    expect(busy.map(one => one.word)).toEqual([ID])
  })
})

describe('Task 6 (0.31.0): the app merges the words queued while the chat is busy into one prompt, and only the last submit resolves', () => {
  /** The three real batches of 2026-11-04 (the Advisor's chat); in each only the last submit went `delivered`. */
  const BATCHES: [string, string[]][] = [
    ['09:31:48', ['7a972772', 'cf04b25b']],
    ['10:06:48', ['e2c84352', '45ac6f71', '77955933']],
    ['11:19:40', ['e747d01f', '9cf89a1b', '626c45f7']],
  ]
  const textOf = (id: string): string => `(answered on the worker board, 09:3x) Q${id} "Go on": approved.`
  /** The ids each typed report of the mod named, in the order told. */
  const typedOf = (w: World): string[] => w.reported.map(body => JSON.parse(body) as { typed?: string[] }).flatMap(body => body.typed ?? [])
  /** Each busy and idle report's word and turn. */
  const wordsOf = (w: World): string[] => w.reports.map(body => (JSON.parse(body) as { report: { state: string; word: string | null; turn: number | null } }).report).map(one => `${one.state} ${one.word} ${one.turn}`)

  /** A worker whose board hands out the batch at one take; the app holds every submit but the last, which resolves when `release` is called. */
  async function queued($: Engine, on: On, ids: string[]): Promise<{ w: World; clock: ReturnType<typeof mock.clock>; texts: string[]; release: () => void }> {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    const texts = ids.map(textOf)
    let release = (): void => {}
    const resolving = new Promise<void>(done => { release = done })
    w.beforeTyped = async (_$$, text) => {
      if (text === texts.at(-1)) await resolving
      else await new Promise<never>(() => {})
    }
    stand(on, w)
    w.workAnswer = { status: 503, text: 'No work store.' }
    await startedAs($, w, 'Units')
    w.waiting.push(...ids.map(id => ({ id, text: textOf(id) })))
    await clock.advance(5000)
    await settle()
    return { w, clock, texts, release }
  }

  for (const [at, ids] of BATCHES) {
    test(`the batch of ${at} (${ids.join(' + ')}): the turn that runs the merged prompt reports every word typed once, named by the first; the last submit resolving later reports nothing again`, async ($, on) => {
      const { w, clock, texts, release } = await queued($, on, ids)
      // The app queued them: no submit has resolved, so nothing is told yet.
      expect(w.reported).toEqual([])
      await clock.advance(1000)
      await $.turn.start({ text: texts.join('\n\n'), turnId: 't1' })
      await settle()
      // Mutant "only the exact text matches": the joined prompt equals none of the words: nothing reported, the turn no word's.
      expect(typedOf(w)).toEqual(ids)
      expect(w.reported.length).toBe(1)
      expect(wordsOf(w)).toEqual([`busy ${ids[0]} 6000`])
      // The last submit resolves now: its word was told at the turn's start, so nothing again (mutant "told on every resolve").
      release()
      await settle()
      expect(typedOf(w)).toEqual(ids)
      expect(w.reported.length).toBe(1)
      await clock.advance(1000)
      await $.turn.complete({ ...ENDED, turnId: 't1' })
      await settle()
      expect(wordsOf(w)).toEqual([`busy ${ids[0]} 6000`, `idle ${ids[0]} 6000`])
    })
  }

  test('the last submit resolving before the merged turn starts: it is told then, the others at the turn\'s start, none twice', async ($, on) => {
    const { w, clock, texts, release } = await queued($, on, ['e2c84352', '45ac6f71', '77955933'])
    release()
    await settle()
    expect(typedOf(w)).toEqual(['77955933'])
    await clock.advance(1000)
    await $.turn.start({ text: texts.join('\n\n'), turnId: 't1' })
    await settle()
    expect(typedOf(w)).toEqual(['77955933', 'e2c84352', '45ac6f71'])
    expect(wordsOf(w)).toEqual(['busy e2c84352 6000'])
  })

  test('a turn whose prompt is the person\'s own line reports none and names no word; the words stay on their way until their own prompt starts', async ($, on) => {
    const { w, clock, texts } = await queued($, on, ['7a972772', 'cf04b25b'])
    await clock.advance(1000)
    await $.turn.start({ text: 'what about the lava?', turnId: 't1' })
    await settle()
    expect(w.reported).toEqual([])
    expect(wordsOf(w)).toEqual(['busy null 6000'])
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await settle()
    expect(w.reported).toEqual([])
    await clock.advance(1000)
    await $.turn.start({ text: texts.join('\n\n'), turnId: 't2' })
    await settle()
    expect(typedOf(w)).toEqual(['7a972772', 'cf04b25b'])
    expect(wordsOf(w).at(-1)).toBe('busy 7a972772 7000')
  })

  test('a word the app refused or a hook dropped is never told typed by a turn: it left the queue', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed(), [BOARD]: board })
    w.refusesTyping = true
    stand(on, w)
    w.workAnswer = { status: 503, text: 'No work store.' }
    await startedAs($, w, 'Units')
    w.waiting.push({ id: 'd1', text: textOf('d1') })
    await clock.advance(5000)
    await settle()
    expect(w.reported.map(body => JSON.parse(body))).toEqual([{ chat: 'Units', session: 'units', typed: [], failed: ['d1'], why: { d1: expect.any(String) } }])
    await $.turn.start({ text: textOf('d1'), turnId: 't1' })
    await settle()
    // Told failed once; the turn that happens to hold its text does not tell it typed.
    expect(typedOf(w)).toEqual([])
    expect(w.reported.length).toBe(1)
  })
})

describe('0.31.1 (F4): no hook of the mod outlives the engine\'s budget', () => {
  // The CLI's hooks worker unloads the plugin it blames for overrunning hooks (10 s of a hook's own time, 5 s of linger, two overruns
  // a runaway), and the mod's tools are gone until the process restarts. The hooks' waits on the mod's own card chain and its clock
  // sleeps count as that time (a board call does not). So every hook answers within HOOK_MS (5 s) whatever hangs: the board, and a
  // card write stuck behind a slow one. On 0.31.0 each of these waited for ever.
  const stuck = (w: World): (() => void) => {
    let release = (): void => {}
    w.writeHold = new Promise<void>(done => { release = done })
    w.hangs = true
    return () => { w.writeHold = null; w.hangs = false; release() }
  }

  test('a turn\'s start and its end answer within 5 s while the board hangs and the card chain is stuck; the card is written once the chain moves', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    const release = stuck(w)
    let started = false
    const start = $.turn.start({ text: 'go', turnId: 't1' }).then(() => { started = true })
    await settle()
    expect(started).toBe(false, 'the card write is stuck: the hook waits')
    // Within 5 s of the clock (the say gives its write 1.5 s, the hook the rest 5 s): the start answers; on 0.31.0 it waited for the chain for ever.
    await clock.advance(5000)
    await start
    expect(started).toBe(true)
    let ended = false
    const end = $.turn.complete({ ...ENDED, turnId: 't1' }).then(() => { ended = true })
    await settle()
    expect(ended).toBe(false)
    await clock.advance(5000)
    await end
    expect(ended).toBe(true)
    // The chain moves: the detached writes land in order (no half-written card: each is a whole card the test parses), the last state wins.
    const before = w.writes.filter(path => path === `${CHATS}/units.json`).length
    release()
    await settle()
    await clock.advance(0)
    const cards = w.writes.filter(path => path === `${CHATS}/units.json`).length
    expect(cards).toBeGreaterThan(before)
    expect(parseChat(w.files[`${CHATS}/units.json`])).not.toBeNull()
    expect(fileOf(w)?.state).toBe('waiting')
  })

  test('the prompt\'s hook, the chat tool and the work tool answer within their time too; the chat tool says the card is written in the background', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    const release = stuck(w)
    let submitted = false
    const submit = $.prompt.submit({ text: 'the archer', ...ASKED } as never).then(() => { submitted = true })
    await clock.advance(5000)
    await submit
    expect(submitted).toBe(true)
    // The chat tool: its card write is waited for 2 s, then left to the chain.
    let planned: string | null = null
    const plan = $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer' }).then(out => { planned = String(out.result) })
    await clock.advance(2000)
    await plan
    expect(planned).toBe('Pending: the card is written in the background and not yet confirmed.')
    // The work tool: a board that hangs is a time-out after its own limit (10 s, a board call that does not count), said at once, no sleeps.
    w.hangs = true
    let worked: string | null = null
    const work = $.tool.call({ tool: WORK, action: 'next' }).then(out => { worked = String(out.result) })
    await clock.advance(10_000)
    await work
    expect(worked).toContain('did not answer')
    release()
    await settle()
    await clock.advance(0)
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
  })

  test('a subagent\'s turn starts and ends nothing of the list\'s: no card write, no report, no refresh (three judges at once piled up on the chain before)', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    w.writes = []
    w.reported = []
    await $.turn.start({ text: 'judge the sheet', turnId: 'a1', agentId: 'judge-1' } as never)
    await $.turn.start({ text: 'judge the sheet', turnId: 'a2', agentId: 'judge-2' } as never)
    await $.turn.complete({ ...ENDED, turnId: 'a1', agentId: 'judge-1' })
    await settle()
    expect(w.writes.filter(path => path.startsWith(`${CHATS}/`))).toEqual([])
    expect(fileOf(w)?.state).toBe('waiting')
  })

  test('the card scan reads a file again only when its size or time changed, and skips cards not written for a week unless list.json names the chat (chat 1\'s guard: the Product owner asleep over a week stays)', async ($, on) => {
    const clock = mock.clock(on, { now: 10 * 24 * 60 * MIN })
    const old = { name: 'Old chat', role: 'worker' as const, state: 'free' as const, task: null, at: 0 }
    const owner = { name: 'Product owner', role: 'worker' as const, state: 'free' as const, task: null, at: 0 }
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 }, props: { name: 'Props', role: 'worker', state: 'working', task: null, at: 0 }, old, owner }), [BOARD]: board })
    w.files[`${CHATS}/list.json`] = '{ "prefix": "Game - ", "main": "Main", "owner": "Product owner" }\n'
    // Props was written an hour ago; Old chat and the Product owner eight days ago (the owner is the list's: it stays); Units (this chat) is read whatever its time.
    w.mtimes[`${CHATS}/props.json`] = clock.now() - 60 * MIN
    w.mtimes[`${CHATS}/old.json`] = clock.now() - 8 * 24 * 60 * MIN
    w.mtimes[`${CHATS}/owner.json`] = clock.now() - 8 * 24 * 60 * MIN
    w.mtimes[`${CHATS}/units.json`] = clock.now() - 8 * 24 * 60 * MIN
    stand(on, w)
    await startedAs($, w, 'Units')
    // The pane (the tick's reading) skips the week-old card of a chat the list does not name; the Product owner stays: its stale card is
    // read by the tick (chat 1's review, 13: no cold pass of 766 reads in a hook), so it shows after one.
    await clock.advance(5000)
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
    expect(await ui.find(lineOf('Product owner'))).toBeDefined()
    expect(await ui.find(lineOf('Old chat'))).toBeUndefined()
    expect(await ui.find(lineOf('Props'))).toBeDefined()
    // `chat list` (chat 1's review, 12) reads every card, the week-old ones too: a chat closed for good is still named, and `leave` finds it.
    const listed1 = String((await $.tool.call({ tool: TOOL, action: 'list' })).result)
    expect(listed1).toContain('Props')
    expect(listed1).toContain('Units')
    expect(listed1).toContain('Product owner')
    expect(listed1).toContain('Old chat')
    // A second reading reads no card again: the sizes and times stand.
    w.reads = []
    await $.tool.call({ tool: TOOL, action: 'list' })
    expect(w.reads.filter(path => path.startsWith(`${CHATS}/`) && !path.endsWith('/list.json'))).toEqual([], 'the list alone is read, no card')
    // Props written anew (its time moves): read again, the others not.
    w.files[`${CHATS}/props.json`] = chatText({ ...old, name: 'Props', state: 'waiting' })
    w.mtimes[`${CHATS}/props.json`] = clock.now()
    w.reads = []
    await $.tool.call({ tool: TOOL, action: 'list' })
    expect(w.reads.filter(path => path.startsWith(`${CHATS}/`) && !path.endsWith('/list.json'))).toEqual([`${CHATS}/props.json`])
  })
  test('chat 1\'s review (1, the blocker): a turn\'s end still telling the board when the next turn starts leaves that turn its own start: both ends reach the board, each with its own since and For you block', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('main', { ...listed(), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Main')
    const block = (n: number): string => `Closed B27${n}.\n\n> **For you**\n> 1. **Answer:** Keep the golem ${n} as it is? I advise yes.`
    const answer = JSON.stringify({ missed: [], open: [], role: 'main', pause: RUNNING, asked: [], left: [] })
    let release = (): void => {}
    w.byAction['turn-ended'] = { status: 200, text: answer }
    w.holdAction = { action: 'turn-ended', until: new Promise<void>(done => { release = done }) }
    await $.turn.start({ text: 'go', turnId: 't1' })
    const firstStart = clock.now()
    const firstEnd = $.turn.complete({ ...ENDED, answer: block(1), turnId: 't1' })
    // The board holds the answer past the hook's deadline: the hook returns at 5 s, the call goes on in the background.
    await clock.advance(5000)
    await firstEnd
    // The next turn starts at 5.1 s and ends at 5.2 s with its own block; the first call is still held.
    await clock.advance(100)
    await $.turn.start({ text: 'go on', turnId: 't2' })
    const secondStart = clock.now()
    expect(secondStart).toBeGreaterThan(firstStart)
    // Chat 1's verifier (6): the first end's answer comes while turn 2 runs, before turn 2 ends (the order that lost the second call).
    await clock.advance(300)
    release()
    await settle()
    await clock.advance(100)
    const secondEnd = $.turn.complete({ ...ENDED, answer: block(2), turnId: 't2' })
    await settle()
    await clock.advance(10_000)
    await secondEnd
    await settle()
    // Two turn-ended calls, each with its own since and its own For you item (the mutant: one call, the second turn's asks never filed).
    const ended = w.worked.map(body => JSON.parse(body) as Record<string, unknown>).filter(one => one.action === 'turn-ended')
    expect(ended.map(one => one.since)).toEqual([firstStart, secondStart])
    expect(ended.map(one => JSON.stringify(one.forYou ?? null).includes('golem 1'))).toEqual([true, false])
    expect(ended.map(one => JSON.stringify(one.forYou ?? null).includes('golem 2'))).toEqual([false, true])
  })

  test('chat 1\'s review (9 and 10): a cut work call\'s background repeat runs the call\'s follow-up (a report marks the card), and the same call again meanwhile reuses the request id', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go on', turnId: 't1' })
    w.worked = []
    w.requests = []
    w.cuts = ['socket hang up']
    w.workAnswer = { status: 200, text: JSON.stringify({ text: 'B12 is reported.' }) }
    const first = String((await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'done', merged: 'abc1234' })).result)
    expect(first).toContain('not known whether it was recorded')
    expect(fileOf(w)?.task?.isReported).toBe(false)
    // The model asks again before the repeat went: the same request id goes out (the board records it once).
    const again = String((await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'done', merged: 'abc1234' })).result)
    expect(again).toBe('B12 is reported.')
    expect(new Set(w.requests).size).toBe(1)
    expect(fileOf(w)?.task?.isReported).toBe(true)
    // A repeat that gets the answer first does the same: the card marked, the step reported for the turn's end.
    w.worked = []
    w.requests = []
    w.files[`${CHATS}/units.json`] = chatText({ name: 'Units', role: 'worker', state: 'working', task: task('Skeleton Archer', 2, 3, 30), at: clock.now() })
    w.cuts = ['socket hang up']
    await $.tool.call({ tool: WORK, action: 'report', id: 'B13', result: 'done', merged: 'abc1235' })
    expect(fileOf(w)?.task?.isReported).toBe(false)
    await clock.advance(2000)
    await settle()
    expect(fileOf(w)?.task?.isReported).toBe(true)
    expect(new Set(w.requests).size).toBe(1)
    await clock.advance(8000)
    expect(w.worked.length).toBe(2, 'the first call and one repeat; no more once answered')
  })

  test('chat 1\'s review (11): under a stuck card chain the chat tool says a change that cannot be made at once (no plan to step), and a pending write as pending, never "Recorded"', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    const release = stuck(w)
    // Chat 1's verifier (7): a write stands on the chain first (held), so the step's error is the pre-check's, not the write's.
    void $.tool.call({ tool: TOOL, action: 'done' })
    await settle()
    let stepped: string | null = null
    void $.tool.call({ tool: TOOL, action: 'step', step: 2 }).then(out => { stepped = String(out.result) })
    await settle()
    expect(stepped).toContain('No plan is recorded')
    let planned: string | null = null
    const plan = $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer' }).then(out => { planned = String(out.result) })
    await clock.advance(2000)
    await plan
    expect(planned).toBe('Pending: the card is written in the background and not yet confirmed.')
    expect(planned).not.toContain('Recorded')
    release()
    await settle()
    await clock.advance(0)
    expect(fileOf(w)?.task?.text).toBe('Skeleton Archer')
  })
  test('chat 1\'s verifier (10): under a stuck chain a plan said Pending is what the next step is judged against: the step is queued behind it, not refused for the card on disk', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    const release = stuck(w)
    let planned: string | null = null
    const plan = $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer', steps: 3 }).then(out => { planned = String(out.result) })
    await clock.advance(2000)
    await plan
    expect(planned).toContain('Pending')
    let stepped: string | null = null
    const step = $.tool.call({ tool: TOOL, action: 'step', step: 2 }).then(out => { stepped = String(out.result) })
    await clock.advance(2000)
    await step
    expect(stepped).toContain('Pending')
    expect(stepped).not.toContain('No plan is recorded')
    release()
    await settle()
    await clock.advance(0)
    expect([fileOf(w)?.task?.text, fileOf(w)?.task?.step]).toEqual(['Skeleton Archer', 2])
    await afterForm(30)
  })

  test('chat 1\'s verifier (8): a cut report whose background repeat answers in the next turn marks the card, but sets no report for that turn: its end clears and compacts nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear" }\n', [`${CHATS}/units.json`]: chatText({ name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 }), [BOARD]: board })
    stand(on, w)
    w.byAction = {
      report: { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12 is in review.', more: null }) },
      'turn-ended': { status: 200, text: JSON.stringify({ text: 'ok', missed: [], open: [], role: 'worker', pause: RUNNING }) },
      'save-log': { status: 200, text: JSON.stringify({ text: 'saved', log: 'x.txt', file: 'D:/x.txt' }) },
    }
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.cuts = ['socket hang up']
    const first = String((await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'done', merged: 'abc1234' })).result)
    expect(first).toContain('not known whether it was recorded')
    await $.turn.complete({ ...ENDED, turnId: 't1' })
    await $.turn.start({ text: 'go on', turnId: 't2' })
    // The repeat answers 2 s on, in turn 2: the card is marked (the step is done for this chat), the flags of turn 1 are not set for turn 2.
    await clock.advance(2000)
    await settle()
    expect(fileOf(w)?.task?.isReported).toBe(true)
    await $.turn.complete({ ...ENDED, turnId: 't2' })
    await afterForm(30)
    expect(w.sequence.filter(one => one === 'save-log' || one === '/clear')).toEqual([])
    expect(w.commanded).toEqual([])
    expect(w.compactions).toEqual([])
  })

  test('chat 1\'s verifier (11): a late turn-end tail decides the clear against the counts of its own turn: a prompt and turn that came in meanwhile stop the clear, although both had ended when the board answered', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { [`${CHATS}/list.json`]: '{ "prefix": "Game - ", "main": "Main", "afterStep": "clear" }\n', [`${CHATS}/units.json`]: chatText({ name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 }), [BOARD]: board })
    stand(on, w)
    let release = (): void => {}
    w.byAction = {
      report: { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12 is in review.', more: null }) },
      'turn-ended': { status: 200, text: JSON.stringify({ text: 'ok', missed: [], open: [], role: 'worker', pause: RUNNING }) },
      'save-log': { status: 200, text: JSON.stringify({ text: 'saved', log: 'x.txt', file: 'D:/x.txt' }) },
    }
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: WORK, action: 'report', id: 'B12', result: 'done', merged: 'abc1234' })
    w.holdAction = { action: 'turn-ended', until: new Promise<void>(done => { release = done }) }
    // The answer ends with a For you block: the board's answer is waited for 6 s (it files the items), past the hook's deadline of 5 s.
    const block = 'Done.\n\n> **For you**\n> 1. **Answer:** Keep the golem as it is? I advise yes.'
    const firstEnd = $.turn.complete({ ...ENDED, answer: block, turnId: 't1' })
    // The hook returns at 5 s; a prompt and turn 2 come at 5.1 s and turn 2 ends at 5.5 s; at 6 s the tail gives the board up and decides late.
    await clock.advance(5000)
    await firstEnd
    await clock.advance(100)
    await $.prompt.submit({ text: 'one more thing', ...ASKED } as never)
    const secondStart = $.turn.start({ text: 'one more thing', turnId: 't2' })
    await clock.advance(400)
    await secondStart
    const secondEnd = $.turn.complete({ ...ENDED, turnId: 't2' })
    await clock.advance(5000)
    await secondEnd
    await settle()
    // The board answers now, with no hand-over: the tail's clear decision sees that a prompt came in since its turn ended.
    release()
    await afterForm(30)
    await clock.advance(20_000)
    await afterForm(30)
    expect(w.sequence.filter(one => one === 'save-log' || one === '/clear')).toEqual([])
    expect(w.commanded).toEqual([])
    expect(fileOf(w)?.clearNote?.why).toBe('a new prompt came in before the clear')
  })

  test('chat 1\'s verifier (9): the turn\'s own "asked" goes into its card at the end, also when the write runs beside the next turn (which asked nothing)', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 } }), [BOARD]: board })
    stand(on, w)
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.session.send({ to: 'judge', text: 'look again', ...BY_MODEL })
    // The chain is stuck when the turn ends: the end's write (waiting, asked) runs once it moves, after turn 2 began.
    const release = stuck(w)
    w.hangs = false
    // A write ahead on the chain, held: the end's own change runs only once the chain moves.
    void $.tool.call({ tool: TOOL, action: 'plan', text: 'Skeleton Archer', steps: 3 })
    await settle()
    const ending = $.turn.complete({ ...ENDED, turnId: 't1' })
    await clock.advance(5000)
    await ending
    w.cardTexts = []
    const starting = $.turn.start({ text: 'go on', turnId: 't2' })
    await clock.advance(5000)
    await starting
    release()
    await settle()
    await clock.advance(0)
    // Among the writes once the chain moved: the end of turn 1 with its task asked (not turn 2's hasAsked, which is false).
    const asked = w.cardTexts.map(text => parseChat(text)).filter(card => card?.state === 'waiting').map(card => card?.task?.asked ?? false)
    expect(asked).toEqual([true])
    await afterForm(30)
  })

  test('chat 1\'s verifier (12): a cut call\'s follow-up runs once when the model asks again while the repeat is in flight and the board answers both', async ($, on) => {
    const clock = mock.clock(on)
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'working', task: task('Skeleton Archer', 2, 5, 30), at: 0 } }), [BOARD]: board })
    stand(on, w)
    let release = (): void => {}
    w.byAction = { step: { status: 200, text: JSON.stringify({ id: 'B12', text: 'B12: step noted.' }) } }
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.cuts = ['socket hang up']
    await $.tool.call({ tool: WORK, action: 'step', id: 'B12' })
    expect(fileOf(w)?.task?.step).toBe(2)
    // The repeat at +2 s is held by the board; the model sends the same call at +3 s (the same request id); the board answers both at +5 s.
    w.holdAction = { action: 'step', until: new Promise<void>(done => { release = done }) }
    await clock.advance(2000)
    await settle()
    await clock.advance(1000)
    const again = $.tool.call({ tool: WORK, action: 'step', id: 'B12' })
    await settle()
    await clock.advance(2000)
    release()
    await settle()
    await again
    await settle()
    expect(new Set(w.requests).size).toBe(1)
    expect(fileOf(w)?.task?.step).toBe(3)
    await afterForm(30)
  })

  test('chat 1\'s verifier (13): while a beat write hangs the tick still reads the clock, so a working chat\'s tool calls re-read the pause after 20 s and a Pause all reaches it', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: task('Skeleton Archer', 1, 3, 30), at: 0 } }), [BOARD]: board })
    stand(on, w)
    const ran = bash(on)
    const pause = (name: string, holds: unknown[] = []) => ({ text: 'x', state: name, since: 1, forChat: { holds, mustStop: name === 'pausing' }, resumeList: [] })
    w.pauseAnswer = pause('running')
    await startedAs($, w, 'Units')
    await $.turn.start({ text: 'go', turnId: 't1' })
    // The card chain is stuck (the beat's write hangs); the board answers.
    let release = (): void => {}
    w.writeHold = new Promise<void>(done => { release = done })
    // The beat (BEAT_MS 30 s) starts and hangs on the held write; the ticks go on.
    await clock.advance(35_000)
    const first = await $.tool.call({ tool: 'Bash', command: 'npm test' } as never) as unknown as { deny?: unknown }
    expect(first.deny).toBeUndefined()
    w.pauseAnswer = pause('pausing', [{ id: 'B12', checkpoint: null }])
    await clock.advance(25_000)
    const next = await $.tool.call({ tool: 'Bash', command: 'npm test' } as never) as unknown as { deny?: unknown }
    expect(String(next.deny ?? '')).toContain('pauses all chats')
    expect(ran).toEqual(['npm test'])
    release()
    await afterForm(30)
  })

  test('chat 1\'s verifier (14): `chat list` during the tick\'s reading waits for it and reads every card anew, so a week-old chat never drops out; the pane never shows an all reading', async ($, on) => {
    const clock = mock.clock(on, { now: 10 * 24 * 60 * MIN })
    const old = { name: 'Old chat', role: 'worker' as const, state: 'free' as const, task: null, at: 0 }
    const w = world('units', { ...listed({ units: { name: 'Units', role: 'worker', state: 'waiting', task: null, at: 0 }, old }), [BOARD]: board })
    w.mtimes[`${CHATS}/old.json`] = clock.now() - 8 * 24 * 60 * MIN
    stand(on, w)
    await startedAs($, w, 'Units')
    await clock.advance(5000)
    // The next tick's reading is held in the folder's listing; `chat list` arrives meanwhile.
    let release = (): void => {}
    w.listHold = new Promise<void>(done => { release = done })
    await clock.advance(5000)
    let listed1: string | null = null
    const list = $.tool.call({ tool: TOOL, action: 'list' }).then(out => { listed1 = String(out.result) })
    await settle()
    w.listHold = null
    release()
    await list
    expect(listed1).toContain('Old chat')
    expect(listed1).toContain('Units')
    const ui = await $.ui.mount({ plugin: 'workers', surface: 'desktop', ...PANE })
    expect(await ui.find(lineOf('Units'))).toBeDefined()
    expect(await ui.find(lineOf('Old chat'))).toBeUndefined()
    await afterForm(30)
  })
})
