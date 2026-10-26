// Checks what the page sends before it is kept for delivery. What passes here will be typed into a chat as the
// person's own words, so it must be addressed to a chat on the board and, when it answers a request, fit that
// request: a verdict for work to verify, "done" for something only the person can do, words for a question.

import { refinedKey } from './backlog.mjs'
import { brainstormFixWords, leftOutKey } from './brainstorm.mjs'
export { brainstormFixWords }
import { SWITCH_MODES, partnerEffortWords } from './partnerEffort.mjs'
import { RECHECK_HEAD } from './rounds.mjs'
import { stoppedOf } from './stopped.mjs'
import { SYNC_BOARD, lastSyncAnswer } from './sync.mjs'
import { isTalkPicture } from './talkPicture.mjs'
import { isHolding } from './work/pause.mjs'
import { warningLines } from './work/resultCheck.mjs'

const refuse = (status, why) => ({ ok: false, status, why })

/** B124: why the board asks the main chat for workers, in the words it types. */
// Redesign Part 2: `board`, the board's own ask when ready tasks wait and no worker is free (work/handOut.mjs).
const SPAWN_WHY = { alone: 'no worker is in the list', button: 'asked with the button', board: 'ready tasks wait and no worker is free' }

/** B124: the word that asks the main chat for `count` workers. The main chat names, briefs and starts them. */
export const spawnWords = (to, count, why) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'spawn', count, why,
  text: `spawn workers\nCount: ${count}\nWhy: ${SPAWN_WHY[why]}`,
})

const pad = value => String(value).padStart(2, '0')
const timeOfDay = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
/** A name or a title from a file a chat wrote: one short plain line without quotes. */
const plainLine = value => String(value ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * B143: what a worker's lane says it is doing, in one line for the main chat ("working on B140 "Sheet", step 2 of
 * 4; 1 step queued for it: B141"), and whether it is free: free, and nothing queued for it. A worker the board
 * cannot read is not free either.
 */
export function workerState(lane) {
  const task = lane.task ?? null
  const what = task === null ? null : [task.stepId ?? null, task.text ? `"${plainLine(task.text)}"` : null].filter(Boolean).join(' ') || null
  const on = what === null ? '' : Number.isInteger(task.step) && Number.isInteger(task.steps) ? `${what}, step ${task.step} of ${task.steps}` : what
  const until = Number.isFinite(lane.suspended?.until) ? ` until ${timeOfDay(lane.suspended.until)}` : ''
  const words = {
    free: 'free',
    working: on === '' ? 'working' : `working on ${on}`,
    waiting: on === '' ? 'waiting for you' : `waiting for you, on ${on}`,
    suspended: `${lane.suspended?.by === 'parked' ? `suspended on purpose until ${lane.suspended.on.join(' and ')} done` : `suspended for the limit${until}`}${on === '' ? '' : `, on ${on}`}`,
    // The review of chat-reports: a chat that reported idle with its task open says that, not more.
    interrupted: `${lane.report?.state === 'idle' ? 'idle with its task open' : 'cut off in the middle of its turn'}${on === '' ? '' : `, on ${on}`}`,
    // B315: its card was left "working" by a quit app; its process does not run. A reporting chat says why.
    off: `not running${typeof lane.offWhy === 'string' ? ` (${lane.offWhy})` : ''}${on === '' ? '' : `, on ${on}`}`,
  }[lane.state] ?? 'unknown to the board'
  const queue = (lane.queue ?? []).map(step => step.id ?? `"${plainLine(step.title)}"`)
  const queued = queue.length === 0 ? '' : `; ${queue.length} ${queue.length === 1 ? 'step' : 'steps'} queued for it: ${queue.join(', ')}`
  return { words: `${words}${queued}`, isFree: lane.state === 'free' && queue.length === 0 }
}

/** B143: the word that asks the main chat to remove a worker: stop it at a safe point, take it out, hand its queue on. */
const removeWords = (to, name, state) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'remove', about: name,
  text: `remove worker\nName: ${name}\nState: ${state}\nWhy: removed with the button`,
})

/** B83: a step's id and title as the words name it: one plain line. */
const stepLine = step => `${step.id} ${String(step.title ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)}`

/**
 * B83: the words that ask the main chat to stop a worker's task, to move a queued step to another worker, or to take
 * it out of its queue. The person, 2026-10-14: stop "A" (the worker reaches a safe point: work committed and pushed,
 * nothing new started) and "A" (the main chat makes the change: it writes the backlog and tells the worker).
 */
const stopWords = (to, name, task) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'stop', about: name,
  text: `stop task\nName: ${name}\nTask: ${task}\nWhy: stopped with the button`,
})
/** B438: why a queued step waits, as the board shows it (state.mjs `whyNot`), in a few words for the main chat. */
const WAITS = {
  limit: why => `the ${why.limit === 'week' ? 'weekly' : '5-hour'} limit is full`,
  suspended: () => 'its worker is suspended',
  after: why => `after ${(why.steps ?? []).length > 0 ? why.steps.join(', ') : plainLine(why.words)}`,
  nobody: () => 'no worker',
  busy: () => 'its worker is busy',
  you: () => 'its worker waits for you',
  cut: () => 'its worker was cut off',
  off: () => 'its worker does not run',
  // Redesign Part 2: given to its free worker, which takes it now; or pinned to it, which the board gives it.
  ready: why => (why.isPinned === true ? 'pinned to its worker, given once nothing holds it' : 'given, its worker takes it now'),
}
/** Redesign Part 2: the board's ready list (state.mjs `readyList`) for the main chat: each task, and whom it is kept for. */
const readyWords = list => ((list?.ready ?? []).length === 0 ? 'none' : list.ready.map(one => `${one.id}${one.pinned !== null ? ` (pinned to ${plainLine(one.pinned)})` : one.keptFor !== null ? ` (kept for ${plainLine(one.keptFor)})` : ''}`).join(', '))
const stepsWords = steps => ((steps ?? []).length === 0 ? 'none' : steps.map(step => {
  const wait = step.why === null || step.why === undefined ? null : WAITS[step.why.reason]?.(step.why) ?? plainLine(step.why.reason)
  return `${step.id ?? `"${plainLine(step.title)}"`}${wait === null ? '' : ` (${wait})`}`
}).join(', '))
/**
 * B438: a chat's open asks as the board shows them: for the person (one asked with the app's question form is answered
 * in its chat only), and with the partner.
 */
const asksWords = (name, state) => [
  ...(state.forYou ?? []).filter(need => need.from === name && (need.canAnswer === true || need.isForm === true))
    .map(need => `${need.workId ?? need.id} ${need.isForm === true ? 'in its chat' : 'for you'}`),
  ...[...new Set([...(state.withPartner ?? []).filter(one => one.from === name).map(one => one.id)])].map(id => `${id} with the partner`),
].join(', ') || 'none'
/** B438, the review: the steps the store holds for the chat (state.mjs `storeSteps`), whatever its card says. */
const storeWords = steps => ((steps ?? []).length === 0 ? 'none' : steps.map(step => `${step.id} ${plainLine(step.title)} (${step.state})`).join('; '))
/** B438, the review: the reconciler's flags on the lane (stuck, not taken, card, waits), the board's own sync signals. */
const flagsWords = flags => (flags ?? []).map(flag => String(flag.text ?? flag.kind ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ') || 'none'
const cardWords = lane => {
  const task = lane.task ?? null
  if (task === null) return 'empty'
  const parts = [[task.stepId ?? null, `"${plainLine(task.text)}"`].filter(Boolean).join(' ')]
  if (Number.isInteger(task.step) && Number.isInteger(task.steps)) parts.push(`step ${task.step} of ${task.steps}`)
  if (lane.eta?.isOver === true) parts.push('over its time')
  else if (Number.isFinite(lane.eta?.leftMs)) parts.push(`about ${Math.round(lane.eta.leftMs / 60_000)} min left`)
  return parts.join(', ')
}
const PAUSES = { pausing: 'the board pauses all chats', resuming: 'the board resumes all chats' }
const pauseWords = (lane, state) => [
  lane?.state === 'suspended' && lane.suspended?.by === 'parked' ? `suspended on purpose until ${lane.suspended.on.join(' and ')} done`
    : lane?.state === 'suspended' ? `suspended for the limit${Number.isFinite(lane.suspended?.until) ? ` until ${timeOfDay(lane.suspended.until)}` : ''}${lane.suspended?.isBack === true ? ', the limit is back' : ''}` : null,
  Object.hasOwn(PAUSES, state.pause?.state ?? '') ? `${PAUSES[state.pause.state]}${Number.isFinite(state.pause.since) ? ` (since ${timeOfDay(state.pause.since)})` : ''}` : null,
].filter(Boolean).join('; ') || 'none'
const limitsWords = limits => [['fiveHour', '5-hour'], ['week', 'week']]
  .map(([key, name]) => (Number.isFinite(limits?.[key]?.used) ? `${name} ${Math.round(limits[key].used)}%${limits[key].level === 'full' ? ' (full)' : ''}` : `${name} unknown`)).join(', ')
const RUNNING = new Map([[true, 'yes'], [false, 'no']])

/**
 * B438: the word that asks the main chat to check whether the board and a worker (`lane`), or the whole board (`lane`
 * null), are in sync, with what the board shows: the worker's state, whether its process runs, the steps the store
 * holds for it, its card, its queue with why each step waits, its open asks, the board's flags on its row, a pause, and
 * the limits. The main chat compares it, fixes what it can and answers with a note `Sync check of <name>: ...`
 * (roles/main.md, "Check sync").
 */
/**
 * B465: what the board's own list (src/supervisor) found and did when the button was pressed, for the main chat,
 * which checks what the list does not know: one line, each finding with its status, at most twelve.
 */
const boardCheckWords = list => {
  if (list === null || list === undefined || !Array.isArray(list.rows)) return []
  // Worktree clean-up: what the board only lists (Left, a worktree a step holds) is no news for the main chat.
  const told = list.rows.filter(row => row.status !== 'Left')
  const rows = told.slice(0, 12).map(row => `${row.status}: ${plainLine(row.text)}`)
  const more = told.length > 12 ? [`and ${told.length - 12} more`] : []
  return [`Board's own check (${timeOfDay(list.at)}): ${[...rows, ...more].join(' · ') || 'nothing stuck'}; ${list.fine} checks fine`]
}

const syncWords = (to, lane, state) => {
  const lines = lane !== null ? [
    `check sync ${plainLine(lane.name)}`,
    `State: ${workerState({ ...lane, queue: [] }).words}`,
    `Running: ${RUNNING.get(lane.isRunning) ?? 'unknown'}`,
    `Steps in the store: ${storeWords(lane.storeSteps)}`,
    `Card: ${cardWords(lane)}`,
    `Queue: ${stepsWords(lane.queue)}`,
    `Open asks: ${asksWords(lane.name, state)}`,
    `Flags: ${flagsWords(lane.flags)}`,
    `Pause: ${pauseWords(lane, state)}`,
  ] : [
    `check sync ${SYNC_BOARD}`,
    ...(state.chats ?? []).filter(one => !one.isMain && !one.isLeftover)
      .map(one => [
        `${plainLine(one.name)}: ${workerState({ ...one, queue: [] }).words}`, `store ${(one.storeSteps ?? []).map(step => `${step.id} (${step.state})`).join(', ') || 'none'}`,
        `queue ${stepsWords(one.queue)}`, `asks ${asksWords(one.name, state)}`, ...((one.flags ?? []).length === 0 ? [] : [`flags ${flagsWords(one.flags)}`]),
      ].join('; ')),
    // Redesign Part 2: the board's ready list, in its order, and why each waits.
    `Ready for a worker: ${readyWords(state.readyList)}`,
    `Board flags: ${(state.workFlags ?? []).map(flag => String(flag).replace(/\s+/g, ' ').trim()).join(' · ') || 'none'}`,
    `Pause: ${pauseWords(null, state)}`,
  ]
  const about = lane === null ? SYNC_BOARD : lane.name
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'sync', about,
    // B438, the review: the newest answer there was when it was asked; only a newer one answers this check.
    seen: lastSyncAnswer(state.information, about, state.restart?.main ?? null),
    text: [...lines, `Limits: ${limitsWords(state.limits)}`, ...boardCheckWords(state.syncList), 'Why: the person pressed "Check now" on the worker board'].join('\n'),
  }
}
/** Focus 2: the first line of each word of the Focus page to the partner (spec 2026-10-18, section 6). */
const FOCUS_HEADS = { 'vibe-agreed': 'vibe: agreed', 'vibe-not-yet': 'vibe: not yet', 'how-go': 'how: go', 'how-not-yet': 'how: not yet', 'vibe-there-yes': 'vibe there: yes', 'vibe-there-no': 'vibe there: no', undo: 'undo:', talk: 'talk:', 'done-when': 'done when:', 'goal-recheck': 'goal re-check:', 'goal-demo': 'goal demo:' }
export const FOCUS_COMMANDS = ['focus', ...Object.keys(FOCUS_HEADS)]

/**
 * Focus 2 (spec 2026-10-18, sections 3 and 6): the person's word from the Focus page to the partner (the chat the
 * setting `advisor` names), typed as the person's own. `focus: G<n> <title>` with the talk's thread, the stage it stands
 * at and the partner's job; `vibe: agreed`, `vibe: not yet`, `how: go`, `how: not yet` with the goal and the thread,
 * the not-yets with the person's words. The board made the change in goals.md before (src/focus.mjs). Focus 3:
 * `vibe there: yes` and `vibe there: no` (with the words) likewise; `undo: <line>` with the goal and the daily note.
 * Focus 4: `talk: <words>` with the goal and the thread, from the run's talk bar while the partner has the turn.
 * B354: `done when: G<n> <title>` with the partner's job (and the person's `Words:` for a goal they just wrote): write
 * the goal's Done when line, so it can become the focus and get its tick.
 */
export function focusWords(command, { to, goal, thread, stage = null, words = null, job = null, note = null }) {
  const about = `${goal.id} ${plainLine(goal.title)}`
  const lines = command === 'focus'
    ? [`focus: ${about}`, `Thread: ${thread}`, `Stage: ${stage}`, `Your job: ${job}, "The focus"`]
    // Focus 3: the person's Undo of a line of the partner's daily note `note`.
    : command === 'undo' ? [`undo: ${String(words).replace(/\s+/g, ' ').trim()}`, `Goal: ${about}`, `Note: ${note}`]
    // Focus 4: the person's words from the run's talk bar while the partner has the turn.
    : command === 'talk' ? [`talk: ${String(words).replace(/\s+/g, ' ').trim()}`, `Goal: ${about}`, `Thread: ${thread}`]
    : command === 'done-when' ? [`done when: ${about}`, ...(words === null ? [] : [`Words: ${String(words).replace(/\s+/g, ' ').trim()}`]), `Your job: ${job}, "Done when"`]
    // B358: the goal's re-check before its tick, against its Done when and its vibe.
    : command === 'goal-recheck' ? [`goal re-check: ${about}`, `Done when: ${String(goal.doneWhen ?? '').replace(/\s+/g, ' ').trim()}`, ...((goal.vibe ?? []).length === 0 ? [] : [`Vibe: ${goal.vibe.map(one => String(one).replace(/\s+/g, ' ').trim()).join(' · ')}`]), `Your job: ${job}, "The goal re-check"`]
    // B677: the goal demo before "Did we reach the goal?": the list and the picture, then its Demo line (`again` the number of the word).
    : command === 'goal-demo' ? [`goal demo: ${about}${words === null ? '' : ` (again: ${words === 'by you' ? 'you asked' : `word ${words}`})`}`, `Done when: ${String(goal.doneWhen ?? '').replace(/s+/g, ' ').trim()}`, `Your job: ${job}, "The goal demo"`]
    : [FOCUS_HEADS[command], `Goal: ${about}`, `Thread: ${thread}`, ...(words === null ? [] : [`Words: ${String(words).replace(/\s+/g, ' ').trim()}`])]
  return { to, ask: null, step: null, title: null, version: null, verdict: null, command, about: goal.id, text: lines.join('\n') }
}

/**
 * Plan (2026-10-19): the Plan part's word to the partner about an answer of the product plan: `plan: P5 confirmed`
 * (the answer is the person's decision now) or `plan: P5 change` with their words (the partner rewrites the answer).
 * The partner writes the page (roles/partner.md, "The plan interview"); the board writes nothing.
 */
export function planWords(command, { to, id, words = null, job }) {
  const said = String(words ?? '').replace(/\s+/g, ' ').trim()
  const head = {
    // The trial's gap 1 (2026-10-24): the empty Vision tab's start slide, what the person builds and their words: the
    // interview begins, with P1 partly answered.
    'plan-start': said === '' ? ['plan interview'] : ['plan interview', `Start: ${said}`],
    'plan-confirm': [`plan: ${id} confirmed`],
    // Vision: an open answer the partner has not asked yet: the person wants its options, as a question to pick from.
    'plan-ask': [`plan: ${id} ask`],
    'plan-change': [`plan: ${id} change`, `Words: ${said}`],
    // Vision (2026-10-19): Go deeper on a vision card; the feature marks and the goal confirms, each sent in one word;
    // a feature the person misses; their words on the whole goal preset; the goals into the goal map.
    'plan-deeper': [`plan: ${id} deeper`],
    'plan-marks': ['plan: features marked', `Marks: ${said}`],
    'plan-feature-add': ['plan: feature add', `Words: ${said}`],
    'plan-goals-confirm': ['plan: goals confirmed', `Goals: ${said}`],
    'plan-goals-change': ['plan: goals change', `Words: ${said}`],
    'plan-goals-agree': ['plan: goals agreed'],
    // Standards (2026-10-20): "Good enough" on a vision card; the standards step proposed, the confirms in one word,
    // the person's words on the whole, a kind measured against its bar, the gaps into goals.
    'plan-settled': [`plan: ${id} settled`],
    'plan-standards': ['plan: standards'],
    'plan-standards-confirm': ['plan: standards confirmed', `Standards: ${said}`],
    'plan-standards-change': ['plan: standards change', `Words: ${said}`],
    'plan-standards-agree': ['plan: standards agreed'],
    'plan-measure': [`plan: ${id} measure`],
    // The new order (2026-10-21): check the whole plan for what is missing; propose the next focus (with the person's
    // words when they want another).
    'plan-check': ['plan: check'],
    'plan-focus': said === '' ? ['plan: focus'] : ['plan: focus', `Words: ${said}`],
    // Tradeoffs (2026-10-21): weigh every complex feature later or not sure; the person's choice for one.
    'plan-tradeoffs': ['plan: tradeoffs'],
    'plan-tradeoff': [`plan: ${id} tradeoff`, `Choice: ${said}`],
    // 2026-10-24: lay the plan in the strategy the person chose; a goal or milestone they set aside for now.
    'plan-strategy': ['plan: strategy', `Strategy: ${said}`],
    'plan-not-now': [`plan: ${id} not now`],
  }[command]
  return { to, ask: null, step: null, title: null, version: null, verdict: null, command, about: id === '' ? 'plan' : id, text: [...head, `Your job: ${job}, "The plan interview"`].join('\n') }
}

/**
 * B233: the word that asks the Advisor to refine a step of the backlog: say the problem the step solves or its goal,
 * and ask what it needs to know, as the step's refine block (roles/partner.md, "Refine a step"). `round` is the round
 * it writes; from round 2 on, the person's answers and feedback stand in the block already.
 */
export const refineWords = (to, step, round) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'refine', about: step.id, round,
  // B293: a ready step refined again holds no new answers: it is checked again. B309: answers to the asks under the
  // step stand in the asks, not in the block: the words name them.
  text: `refine step\nStep: ${stepLine(step)}\nRound: ${round}${round === 1 ? '' : answeredAsks(step).length > 0
    ? `\nThe person answered ${answeredAsks(step).join(', ')} under the step: fold the answers in${step.refined?.ready === true ? '' : ', with what the refine block holds'}.`
    : step.refined?.ready === true
      ? '\nThe step is ready: check it again against the backlog and the goals.'
      : '\nThe answers and feedback are written in the step\'s refine block.'}${anotherWayWords(step)}`,
})

/**
 * B664: the open fix of a chain with two tries behind it: the word says to refine it another way (roles/partner.md, "Two
 * rounds, then another way"), its what starting with "Tried before:".
 */
const anotherWayWords = step => ((step.item?.what ?? []).some(one => /^Two rounds, then another way\b/.test(one))
  ? '\nTwo rounds, then another way: this fix\'s chain failed its check twice. Refine it another way, and start its what with "Tried before: <each way, its score, why it fell short>".'
  : '')

/** B309: the ids of the asks under a step answered since its refine block was written (backlog.mjs `withAsks`). */
const answeredAsks = step => (step.refined?.asks ?? []).filter(ask => ask.answer !== null).map(ask => ask.id)

/**
 * B356: the word that asks the partner for a step's result check, once the board's own check passed: a helper that
 * did not build it checks the result against the step's agreed points and its standard, and the partner files it with
 * `work checked` (roles/partner.md, "The check"). `step` is `{ id, title, owner }`.
 */
export const checkStepWords = (to, step, job) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'result-check', about: step.id,
  // B565: `step.why` (resultCheck.mjs `checkWhy`), when the check is asked again, stands in a `Why:` line.
  // 2026-10-25: `step.warnings`, what the board's check passed the report with, stands in a `Board warnings:` line; a
  // report that names no mutant for a change that touches tests adds the `Demand:` line (the check no longer sends the
  // worker back for it: this check asks for the mutant).
  text: `check step\nStep: ${step.id} ${plainLine(step.title ?? '')}\nBuilt by: ${plainLine(step.owner ?? 'its worker')}${step.why ? `\nWhy: ${plainLine(step.why)}` : ''}${warningLines(step.warnings).map(one => `\n${one}`).join('')}\nYour job: ${job}, "The check"`,
})

/** B233: the Advisor refines a step that is not finished; one ask at a time per step. */
function refineCheck(body, state) {
  const advisor = state.advisor?.name ?? null
  if (advisor === null || body.to !== advisor) return refuse(400, 'A step is refined by the Advisor.')
  if ((body.text ?? '') !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
  const step = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).find(one => typeof one.id === 'string' && one.id === body.step)
  if (step === undefined || step.status === 'done') return refuse(409, 'That step is not on the backlog, or it is finished.')
  if (step.refineAsk?.isOpen === true) return refuse(409, 'The Advisor is refining this step already.')
  // B285: the ask remembers the block it is about, so a block that changed since answers it (state.mjs `refineAsk`).
  return { ok: true, message: { ...refineWords(body.to, step, (step.refined?.round ?? 0) + 1), before: refinedKey(step.refined) } }
}

/**
 * B258: the person's ask about a goal of the map, to the Advisor only (spec 2026-10-15, section 4). The page wrote the
 * Ask line under the goal first and names its id: only an ask that stands under that goal, not answered yet, is typed,
 * in the map's own words; the goal's title is read from the board's own state too. Pictures are the ones the board kept
 * from a paste, by their paths in the project; anything else is left out.
 */
function goalAskCheck(body, state) {
  const advisor = state.advisor?.name ?? null
  if (advisor === null || body.to !== advisor) return refuse(400, 'An ask from the goal map goes to the Advisor.')
  const goal = (state.goals?.nodes ?? []).find(one => one.id === body.goal)
  if (goal === undefined) return refuse(409, 'That goal is not in the map.')
  if (typeof body.ask !== 'string' || !/^A\d+$/.test(body.ask)) return refuse(400, 'No ask id.')
  const ask = (goal.asks ?? []).find(one => one.id === body.ask)
  if (ask === undefined) return refuse(409, 'That ask is not under this goal.')
  if ((ask.answer ?? null) !== null) return refuse(409, 'The Advisor answered this ask already.')
  const question = String(ask.text ?? '').replace(/\s+/g, ' ').trim()
  if (question === '') return refuse(409, 'That ask has no question.')
  if ((body.verdict ?? null) !== null) return refuse(400, 'An ask carries no verdict.')
  const pictures = Array.isArray(body.pictures) ? [...new Set(body.pictures.filter(path => isTalkPicture(path, state.pictures ?? 'pictures')))] : []
  const lines = ['ask from the goal map', `Goal: ${goal.id} ${plainLine(goal.title)}`, `Ask (${body.ask}): ${question}`]
  if (pictures.length > 0) lines.push(`Pictures: ${pictures.join(', ')}`)
  return { ok: true, message: { to: body.to, ask: null, step: null, title: null, version: null, verdict: null, command: 'goal-ask', goal: goal.id, about: body.ask, pictures, text: lines.join('\n') } }
}

/** B259: the brainstorm a word is about, as the board reads it (state.brainstorms); the page names its path only. */
const threadIn = (state, path) => (state.brainstorms?.threads ?? []).find(one => one.path === path)
const sayLine = value => String(value ?? '').replace(/\s+/g, ' ').trim()

/**
 * B259: the words of a brainstorm to the Advisor (spec 2026-10-15, section 5), each made from the thread as the board
 * read it after its own write, so one is typed only when the thread is where it says: `brainstorm` for a thread the
 * Advisor has not taken yet (no question, no proposal: no second word for the same thread, Review Focus 4);
 * `brainstorm answer` for the last question once the board wrote its answer; `brainstorm wrap up` once marked so;
 * `brainstorm change` for a proposal not created yet, with the person's words.
 */
function brainstormCheck(body, state) {
  const advisor = state.advisor?.name ?? null
  if (advisor === null || body.to !== advisor) return refuse(400, 'A brainstorm goes to the Advisor.')
  if ((body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
  const thread = threadIn(state, body.thread)
  if (thread === undefined) return refuse(409, 'That brainstorm is not on the board.')
  const isOver = thread.state === 'done' || thread.state === 'discarded'
  const words = text => ({ ok: true, message: { to: advisor, ask: null, step: null, title: null, version: null, verdict: null, command: body.command, about: thread.path, text } })
  const head = `Thread: ${thread.path}`
  if (body.command === 'brainstorm') {
    if (thread.state !== 'running' || thread.questions > 0 || thread.proposal !== null) return refuse(409, 'The Advisor has this brainstorm already.')
    return words(`brainstorm\n${head}\nGoal: ${thread.goal === null ? 'new' : `${thread.goal.id} ${plainLine(thread.goal.title)}`}\nOpening: ${sayLine(thread.opening)}`)
  }
  if (body.command === 'brainstorm-answer') {
    const latest = thread.latest
    if (isOver || thread.proposal !== null || latest === null || latest.n !== body.n || latest.answer === null) return refuse(409, 'That is not the answer the brainstorm waits for.')
    const answer = latest.answer
    const value = answer.skipped === true ? 'skipped' : Number.isInteger(answer.back) ? `back to Q${answer.back}` : answer.words === '' ? answer.key : `${answer.key} — ${answer.words}`
    return words(`brainstorm answer\n${head}\nQ${latest.n}: ${value}`)
  }
  if (body.command === 'brainstorm-wrap') {
    if (thread.state !== 'wrapping up') return refuse(409, 'Wrap the brainstorm up on the board first.')
    return words(`brainstorm wrap up\n${head}`)
  }
  if (isOver || thread.proposal === null || thread.proposal.created !== null) return refuse(409, 'No proposal of this brainstorm waits for a change.')
  const change = sayLine(body.text)
  if (change === '') return refuse(400, 'Say what to change.')
  return words(`brainstorm change\n${head}\nChange: ${change}`)
}

/**
 * B259: a step of a created proposal, to the main chat in the Design tab's form (one message per step): the goal it
 * serves is the first goal the brainstorm made, else the goal it was about. Only a ticked step of a created proposal.
 */
function goalStepCheck(body, state, text) {
  if (body.to !== state.restart?.main) return refuse(400, 'A step from the goal map goes to the main chat.')
  if (text !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
  const thread = threadIn(state, body.thread)
  const created = thread?.proposal?.created ?? null
  if (created === null) return refuse(409, 'Only a created proposal asks for its steps.')
  const step = Number.isInteger(body.step) ? thread.proposal.steps[body.step] : undefined
  if (step === undefined || created.leftOut.includes(leftOutKey(step.title))) return refuse(409, 'That step is not one the proposal created.')
  const note = thread.proposal.note ? `: ${sayLine(thread.proposal.note)}` : ''
  return { ok: true, message: {
    to: body.to, ask: null, step: null, title: null, version: null, verdict: null, command: 'goal-step', about: `${thread.path}#${body.step}`,
    text: ['backlog step from the goal map', `Title: ${sayLine(step.title)}`, `Goal: ${created.goals[0] ?? thread.goal?.id ?? 'none'}`, `Description: from the brainstorm "${plainLine(thread.title)}" (${thread.path})${note}`, `Time: ${sayLine(step.cost)}`, `Worker: ${sayLine(step.worker)}`].join('\n'),
  } }
}

/**
 * B195: the person's answer to the Advisor's recommendation on the way to the next milestone. Yes goes to the main
 * chat, which puts the step on the backlog when it is not there and hands it out; no goes to the Advisor with the
 * person's reason. What was recommended is read from the board's own state: the page sends the answer and a reason.
 */
function recommendWords(body, state) {
  const rec = state.milestone?.recommendation ?? null
  if (rec === null || body.about !== rec.id) return refuse(409, 'That is no longer the Advisor\'s recommendation.')
  if ((rec.answer ?? null) !== null) return refuse(409, 'This recommendation is answered already.')
  if ((body.text ?? '') !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
  const base = { ask: null, step: null, title: null, version: null, verdict: null, command: 'recommend', about: rec.id, answer: body.answer }
  const step = rec.step === null ? '' : `\nStep: ${rec.step}`
  if (body.answer === 'yes') {
    if (body.to !== (state.restart?.main ?? null)) return refuse(400, 'A yes goes to the main chat.')
    return { ok: true, message: { ...base, to: body.to, text: `advisor recommendation: yes\nRecommended: ${rec.title}${step}${rec.why === '' ? '' : `\nWhy: ${rec.why}`}` } }
  }
  if (body.answer === 'no') {
    if (body.to !== (state.advisor?.name ?? null)) return refuse(400, 'A no goes to the Advisor.')
    const reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim() : ''
    if (reason === '' || reason.length > 1000) return refuse(400, 'Say why, in at most 1000 characters.')
    return { ok: true, message: { ...base, to: body.to, text: `advisor recommendation: no\nRecommended: ${rec.title}${step}\nReason: ${reason}` } }
  }
  return refuse(400, 'Yes or no.')
}

/**
 * `body` is what the page posted; `state` is the board's state (its lanes, its advisor, its For you list).
 * Answers `{ ok: true, message }` with the parts to keep, or `{ ok: false, status, why }`.
 */
export function checkSay(body, state, maxChars) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'Not a message.')
  if (body.text !== undefined && typeof body.text !== 'string') return refuse(400, 'No text.')
  const text = (body.text ?? '').trim()
  if (text.length > maxChars) return refuse(413, `At most ${maxChars} characters.`)

  const names = (state.chats ?? []).filter(chat => !chat.isLeftover).map(chat => chat.name)
  if (state.advisor?.name) names.push(state.advisor.name)
  // B424: and the partner's helper, which an answer to its ask goes to.
  if (state.advisorHelper?.name) names.push(state.advisorHelper.name)
  // The supervisor (spec 2026-10-24): and the supervisor's chat, which the board wakes for a sweep.
  if (state.supervisorChat?.name) names.push(state.supervisorChat.name)
  if (typeof body.to !== 'string' || !names.includes(body.to)) return refuse(400, 'No such chat on the board.')
  // B167: a picture pasted into Talk to Main, which the board kept beforehand: one of its own names, to the main chat,
  // with a plain message. B282: the same into the Advisor's chat.
  const picture = body.picture ?? null
  if (picture !== null) {
    if (!isTalkPicture(picture, state.pictures ?? 'pictures')) return refuse(400, 'That is no picture the board kept.')
    if (body.to !== state.restart?.main && body.to !== (state.advisor?.name ?? null)) return refuse(400, 'A picture goes to the main chat or the Advisor only.')
    if ((body.ask ?? null) !== null || (body.command ?? null) !== null) return refuse(400, 'A picture goes with a plain message only.')
  }

  if (body.command !== undefined && body.command !== null) {
    // The board's words, never the page's. Pause 2: a pause is pause.json, no word; "resume" is typed after Resume all
    // into a main chat that runs, and its Workers mod gives it whom to wake.
    if (!['resume', 'start', 'spawn', 'remove', 'recommend', 'stop', 'refine', 'recheck', 'goal-ask', 'brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-change', 'goal-step', 'partner-effort', 'sync'].includes(body.command)) return refuse(400, 'No such command.')
    // B195: the one answer that may go to the Advisor as well as to the main chat.
    if (body.command === 'recommend') return recommendWords(body, state)
    // B233, B258: the commands that go to the Advisor only.
    if (body.command === 'refine') return refineCheck(body, state)
    if (body.command === 'goal-ask') return goalAskCheck(body, state)
    // B259: the words of a brainstorm (to the Advisor), and a step it created (to the main chat).
    if (body.command.startsWith('brainstorm')) return brainstormCheck(body, state)
    if (body.command === 'goal-step') return goalStepCheck(body, state, text)
    // B288: the person asks the Advisor for a round now, off while one runs. The server writes its words
    // (rounds.mjs recheckText), which need the board's folder and the project's settings.
    if (body.command === 'recheck') {
      const advisor = state.advisor?.name ?? null
      if (advisor === null || body.to !== advisor) return refuse(400, 'A re-check of the goals goes to the Advisor.')
      if (text !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
      if (state.advisor.roundRuns === true) return refuse(409, 'A round runs: wait until the Advisor has finished it.')
      return { ok: true, message: { to: advisor, ask: null, step: null, title: null, version: null, verdict: null, command: 'recheck', text: RECHECK_HEAD } }
    }
    // T9.4: the word to start a chat that is not running goes to the main chat or to any chat that runs.
    if (body.command === 'start') return startCheck(body, state, text)
    if (body.to !== state.restart?.main) return refuse(400, 'Only the main chat prepares, resumes and is asked for workers.')
    if (text !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
    // B352: the partner's high effort mode, switched on the Focus page: the main chat sets the partner's chat.
    if (body.command === 'partner-effort') {
      // 2026-10-24: the person's switch sets high effort (Opus at max) or the usual partner, never Fable.
      if (!SWITCH_MODES.includes(body.mode)) return refuse(400, 'High effort or the usual partner.')
      if (!state.advisor?.name) return refuse(409, 'No partner chat is on the board.')
      return { ok: true, message: partnerEffortWords({ to: body.to, partner: state.advisor.name, session: state.advisor.appSession ?? null, mode: body.mode, why: 'switched on the Focus page' }) }
    }
    // B438: the person thinks the board and a worker, or the whole board (`board`), are out of sync: the main chat
    // checks and fixes. What the board shows is read here, from its own state: the page names the worker only. Not the
    // main chat itself (the board's check covers it), not a leftover; one open check at a time for each.
    if (body.command === 'sync') {
      const lane = body.chat === SYNC_BOARD ? null : (state.chats ?? []).find(chat => chat.name === body.chat && !chat.isLeftover && !chat.isMain)
      if (lane === undefined) return refuse(409, 'That is no worker on the board.')
      if (state.changeAsks?.sync?.[body.chat]?.isOpen === true) return refuse(409, 'An earlier check of it is still open: the main chat answers on the board.')
      return { ok: true, message: syncWords(body.to, lane, state) }
    }
    // B83: the person stops a worker's task (after confirming once, `sure`). What the worker does is read here, from the
    // board's own state: the page names the worker only. One ask at a time. (B301: moving a queued step and taking it out
    // of its queue are the work API's `requeue` and `unqueue`, no words to the main chat.)
    if (body.command === 'stop') {
      const lane = (state.chats ?? []).find(chat => chat.name === body.chat && !chat.isLeftover && !chat.isMain)
      if (lane === undefined) return refuse(409, 'That is no worker on the board.')
      if (lane.task === null || lane.task === undefined || lane.state === 'free') return refuse(409, 'This worker has no task to stop.')
      if (state.changeAsks?.stop?.[lane.name]?.isOpen === true) return refuse(409, 'An earlier ask to stop this task is still open.')
      if (body.sure !== true) return refuse(409, 'Confirm first: the worker stops at a safe point.')
      const task = [lane.task.stepId ?? null, lane.task.text ? `"${plainLine(lane.task.text)}"` : null].filter(Boolean).join(' ') || 'its task'
      return { ok: true, message: stopWords(body.to, plainLine(lane.name), task) }
    }
    // B124: the person asks for one more worker, or for three when there is none. One ask at a time.
    if (body.command === 'spawn') {
      if (state.workers?.ask?.isOpen === true) return refuse(409, 'An earlier ask for workers is still open.')
      return { ok: true, message: spawnWords(body.to, (state.workers?.count ?? 0) === 0 ? 3 : 1, 'button') }
    }
    // B143: the person removes a worker; the main chat is never removed this way. One ask at a time per worker,
    // and a worker that is not free only once the person confirmed the warning (`sure`). What it is doing is read
    // here, from the board's own state: the page names the worker only.
    if (body.command === 'remove') {
      const lane = (state.chats ?? []).find(chat => chat.name === body.chat && !chat.isLeftover && !chat.isMain)
      if (lane === undefined) return refuse(409, 'That is no worker on the board.')
      if (lane.removal?.isOpen === true) return refuse(409, 'An earlier ask to remove this worker is still open.')
      const now = workerState(lane)
      if (!now.isFree && body.sure !== true) return refuse(409, `This worker is not free (${now.words}): confirm the warning first.`)
      return { ok: true, message: removeWords(body.to, plainLine(lane.name), now.words) }
    }
    // A name comes from a chat's title: it is kept to one short plain line.
    const plain = names => (names ?? []).map(name => String(name).replace(/\s+/g, ' ').trim().slice(0, 80))
    const blank = { to: body.to, ask: null, step: null, title: null, version: null, verdict: null }
    const cut = plain(state.restart?.interrupted)
    // A chat that is not running cannot be reached by its name: the main chat has to start it. Itself it knows.
    const down = plain((state.restart?.notRunning ?? []).filter(name => name !== body.to))
    const words = body.command !== 'resume' ? body.command : [
      'resume',
      cut.length > 0 ? `Cut off in the middle of a turn, as the worker board reads it: ${cut.join(', ')}.` : null,
      down.length > 0 ? `Not running, as the worker board reads it: ${down.join(', ')}.` : null,
    ].filter(line => line !== null).join('\n')
    return { ok: true, message: { ...blank, command: body.command, text: words } }
  }

  if (body.ask === undefined || body.ask === null) {
    if (body.verdict !== undefined && body.verdict !== null) return refuse(400, 'A verdict needs the request it is about.')
    if (text === '' && picture === null) return refuse(400, 'No text.')
    return { ok: true, message: { to: body.to, ask: null, step: null, title: null, verdict: null, text, ...(picture === null ? {} : { picture }) } }
  }

  const item = [...(state.forYou ?? []), ...(state.backlogForYou ?? [])].find(need => need.id === body.ask && need.from === body.to)
  if (item === undefined || !item.canAnswer) return refuse(409, 'That request is no longer open.')
  // The request as it stood when it was answered: a step that changes later asks again.
  const about = { to: body.to, ask: item.id, step: item.step ?? null, title: item.title, version: item.version ?? null }
  if (item.kind === 'do') {
    // Something only the person can do: all there is to say is that it is done.
    if (body.verdict !== 'done') return refuse(400, 'Say that it is done.')
    return { ok: true, message: { ...about, verdict: 'done', text } }
  }
  if (item.kind === 'verify') {
    if (body.verdict !== 'approve' && body.verdict !== 'reject') return refuse(400, 'Approve or reject.')
    if (body.verdict === 'reject' && text === '') return refuse(400, 'Say why you reject it.')
    return { ok: true, message: { ...about, verdict: body.verdict, text } }
  }
  if (body.verdict !== undefined && body.verdict !== null) return refuse(400, 'Only work to verify is approved or rejected.')
  if (text === '') return refuse(400, 'This needs your words.')
  return { ok: true, message: { ...about, verdict: null, text } }
}

/**
 * Every chat the board knows by name: the main chat and the workers (not a leftover), the partner, its helper and the
 * supervisor's chat, each as the state gives it (`name`, `isRunning`, `state`, `appSession`).
 */
const boardLanes = state => [
  ...(state.chats ?? []).filter(chat => !chat.isLeftover),
  ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : []), ...(state.supervisorChat ? [state.supervisorChat] : []),
]

/**
 * T9.4: the board's word that a chat which is not running has to be started. The main chat is its usual addressee (the
 * word waits there, running or not); any other chat takes it only while it runs, because only a running chat can start
 * another (the app's session tools; the board cannot). The first line stays `start "<chat>"`; the rest is for any chat that
 * gets it. A chat that runs, one the board cannot tell about, and the chat itself are left alone. The partner's helper does only
 * what the partner hands it: it never carries the word (review of 2026-10-25).
 */
function startCheck(body, state, text) {
  if (text !== '' || (body.ask ?? null) !== null || (body.verdict ?? null) !== null) return refuse(400, 'A command carries nothing else.')
  const lanes = boardLanes(state)
  if (body.to !== (state.restart?.main ?? null) && body.to === state.advisorHelper?.name) return refuse(409, 'The partner\'s helper does only what the partner hands it.')
  if (body.to !== (state.restart?.main ?? null) && lanes.find(chat => chat.name === body.to)?.isRunning !== true) return refuse(409, 'That chat does not run, so it cannot start another.')
  const target = lanes.find(chat => chat.name === body.chat)
  if (target === undefined || target.name === body.to || target.isRunning !== false) return refuse(409, 'That chat runs, or is not on the board.')
  const hasId = typeof target.appSession === 'string' && /^[\w-]{1,80}$/.test(target.appSession)
  const id = hasId ? `Its session id: ${target.appSession}.` : 'The board does not know its session id: find its session by the chat\'s name in the app\'s list of sessions.'
  const words = [
    `start "${plainLine(target.name)}"`,
    'Its chat is not running, and words from the worker board wait for it. Start it now: send it one line with SendMessage to its session id (load it with ToolSearch when it is deferred): "The worker board holds something for you." Nothing else, no reply needed; then go on with your own work.',
  ].join('\n')
  return { ok: true, message: { to: body.to, ask: null, step: null, title: null, version: null, verdict: null, command: 'start', about: target.name, text: `${words} ${id}` } }
}

/**
 * B124: what the board asks by itself when the main chat is alone in the list: three workers. It asks once per
 * empty list: again only after a worker was there (the history, `lines`, holds one since that ask) and all went.
 * Only while the main chat's chat is open, so the word is taken and not lost; an ask that is still open, also
 * the person's, stands for it. `outbox` is everything sent, also long ago. Null when nothing is to be asked.
 */
export function spawnWhenAlone(state, outbox, lines) {
  const workers = state.workers ?? null
  const main = workers?.main ?? null
  if (main === null || workers.count > 0 || workers.ask?.isOpen === true) return null
  if ((state.chats ?? []).find(chat => chat.name === main)?.isRunning !== true) return null
  const asked = outbox.findLast(sent => sent.command === 'spawn' && sent.why === 'alone')
  if (asked !== undefined && !lines.some(line => line.gap !== true && line.chat !== main && line.at > asked.at)) return null
  return spawnWords(main, 3, 'alone')
}

/** A chat is asked to be started at most this often (T9.4: by the main chat, or by the chat that carries the word instead). */
const WAKE_AGAIN_MS = 2 * 60_000
const WAKE_PENDING_MS = 10 * 60_000

/** The commands the board puts to a chat other than the main one: a word the chat's work stands on (wakeFor). */
// B570: and the board's word that asks the partner to restart the main chat on a new Workers mod.
const PARTNER_WORDS = ['recommend', 'refine', 'result-check', 'evaluate', 'work', 'recheck', 'goal-ask', 'brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-change', 'brainstorm-fix', 'incident', 'mod-restart', ...FOCUS_COMMANDS]
export const isPartnerWord = command => typeof command === 'string' && (command.startsWith('plan-') || PARTNER_WORDS.includes(command))

/**
 * B532: a word that waits for a busy or closed chat for as long as its purpose stands (store.mjs isLate): a partner word,
 * a round of the board's clock, and the main chat's start of a closed chat. The rest (a pause's resume, a line typed in
 * a talk) is stale in minutes.
 */
export const waitsLong = command => command === 'start' || command === 'wake' || command === 'round' || isPartnerWord(command)

/**
 * T9.4: whether the board wakes a chat for this word when the chat is not running. Every word to the main chat is an
 * order of the board. Of the words to another chat: a line typed on the board, and the commands that go to a chat other
 * than the main one (B195, B233: the answer to the Advisor's recommendation, a refine and (B300) the work store's line;
 * B288: a re-check of the goals; B258: an ask from the goal map; B259: the words of a brainstorm; Focus 2: the words of
 * the Focus page; B359: the goal guard's evaluate; 2026-10-24: the Vision tab's words on the product plan (`plan-*`),
 * which waited for a stopped partner unseen; the supervisor (spec 2026-10-24): its sweep word to the supervisor's chat,
 * and an incident's word to the partner). The sweep wakes too, but goes stale in minutes (src/supervisor/sweep.mjs), so it
 * is no partner word.
 */
const isWakeWord = (message, state) => {
  const main = state.restart?.main ?? null
  const command = message.command ?? null
  return (main !== null && message.to === main) || command === null || isPartnerWord(command) || command === 'sweep'
}

/**
 * T9.4: the chats that could carry the start word for `target`, best first: the main chat, the partner, then the workers
 * (the ones that are free first, then the busy ones, each in the list's order), the supervisor's chat last. Never `target`
 * itself, never a leftover, never the partner's helper (it does only what the partner hands it). Review of 2026-10-25: nor a
 * chat that cannot carry a word now: its turn was stopped (src/stopped.mjs: the app drops what it is sent until it gets
 * input; read from `outbox`, so for every chat), its card says Suspended (paused for the limit; every chat's card has it) or
 * it was removed in the last minutes (`removedAt`: its lane stays two; only the lanes carry it, not the partner, its helper
 * or the supervisor's chat). `outbox` is what was sent.
 */
function wakerOrder(state, target, outbox) {
  const main = state.restart?.main ?? null
  const canCarry = chat => chat !== null && chat !== undefined && chat.name !== target && chat.isLeftover !== true
    && chat.state !== 'suspended' && !Number.isFinite(chat.removedAt) && stoppedOf(outbox, chat) === null
  const lanes = (state.chats ?? []).filter(canCarry)
  const workers = lanes.filter(chat => chat.name !== main)
  const free = chat => chat.state === 'free'
  return [
    lanes.find(chat => chat.name === main), canCarry(state.advisor) ? state.advisor : undefined,
    ...workers.filter(free), ...workers.filter(chat => !free(chat)),
    canCarry(state.supervisorChat) ? state.supervisorChat : undefined,
  ].filter(chat => chat !== undefined)
}

/** T9.4: a chat asked this recently to start a target is passed over when the target has to be asked for again. */
const WAKER_AGAIN_MS = 30 * 60_000

/**
 * T9.4: the chat that carries the start word for `target` (a chat that is not running): the main chat when it runs, else
 * the partner when it runs, else another running chat of the board (`wakerOrder`). Only a running chat can start another
 * (the app's session tools; the board cannot). Without `since` (a word that has just been sent): a chat asked to start this
 * target in the last half hour (its word still waits, or it took it and the target did not start; a word closed because the
 * target runs does not count) is passed over, so a retry goes to the next one; when every running chat was asked, the first
 * is asked again: a repeat is better than a word that waits for nobody. With `since` (the clock's retry, review of
 * 2026-10-25: retries must stop): a chat asked at any time since then, whatever became of its word, is not asked again, and
 * when every running chat was asked there is none. Its name, or null when no chat can be asked. `outbox` is what was sent.
 */
export function wakerFor(state, target, outbox, now, since = null) {
  const running = wakerOrder(state, target, outbox).filter(chat => chat.isRunning === true)
  const isOnce = since !== null
  const askedBefore = chat => outbox.some(sent => sent.command === 'start' && sent.to === chat.name && sent.about === target && Number.isFinite(sent.at)
    && (isOnce ? sent.at >= since : sent.state !== 'dropped' && now - sent.at < WAKER_AGAIN_MS))
  return (running.find(chat => !askedBefore(chat)) ?? (isOnce ? undefined : running[0]))?.name ?? null
}

/** A round is the board's own word to the Advisor (B173); it wakes its chat as a message does. */
const wakeWordOf = message => (message.command === 'round' ? { ...message, command: null } : message)

/**
 * T9.4: the words that say nobody can wake the chats that wait for it, or null: some word that the board wakes a chat for
 * (`isWakeWord`) waits for a chat of the board, and no chat that could carry the start word (`wakerOrder`) may run. Not
 * guessed: one that may run (`isRunning` unknown) says nothing, except on a board no mod has called since it started
 * (`bridge.isMissing`: nothing can tell any chat's state then, so an unknown one counts as not running). `{ since, chats }`:
 * the oldest of those words' times and the chats they wait for, as they first appear in `outbox` (everything sent; a word
 * the person's pause holds, `isHeld`, does not count).
 */
export function nobodyRunsOf(state, outbox) {
  const lanes = boardLanes(state)
  if (lanes.length === 0) return null
  const isOff = chat => chat.isRunning === false || (state.bridge?.isMissing === true && chat.isRunning !== true)
  if (wakerOrder(state, null, outbox).some(chat => !isOff(chat))) return null
  const since = new Map()
  for (const message of outbox) {
    const target = lanes.find(chat => chat.name === message.to)
    if (message.state !== 'waiting' || message.isHeld === true || target === undefined || !isOff(target) || !isWakeWord(wakeWordOf(message), state)) continue
    since.set(message.to, Math.min(since.get(message.to) ?? Infinity, Number.isFinite(message.at) ? message.at : Infinity))
  }
  if (since.size === 0) return null
  const times = [...since.values()].filter(Number.isFinite)
  return { since: times.length === 0 ? null : Math.min(...times), chats: [...since.keys()] }
}

/**
 * T9.4 (review of 2026-10-25): when a start word began to be on its way: when it was sent; a word that the person's pause
 * held (sent before the pause ended, still waiting) from the end of the pause, since it is delivered then.
 */
const onItsWaySince = (sent, state) => {
  const pause = state.pause ?? null
  return sent.state === 'waiting' && pause !== null && pause.state !== 'pausing' && Number.isFinite(pause.since) && pause.since > sent.at ? pause.since : sent.at
}
/** Whether a start word was sent, or its pause ended, in the last ten minutes: whatever became of it. */
const isRecentStart = (sent, state, now) => now - onItsWaySince(sent, state) < WAKE_PENDING_MS
/** Whether an earlier start word is still on its way: waiting or taken for under ten minutes; one the pause holds, however old. */
const isOnItsWay = (sent, state, now) => (sent.state === 'waiting' && isHolding(state.pause)) || ((sent.state === 'waiting' || sent.state === 'taken') && isRecentStart(sent, state, now))

/**
 * What the board adds when something was sent to a chat that is not running: the word to a running chat to start it
 * (`wakerFor`: the main chat, else the partner, else another), so nothing waits for a closed chat without a word. A word
 * to the main chat that waits while it does not run wakes it the same way. Null when nothing is to be asked: the chat
 * runs, or is not known to, no chat runs to carry the word, or it was asked a moment ago. `outbox` is what was sent before.
 * `since` (the clock's retry, `wakesDue`) is passed on to `wakerFor`.
 */
export function wakeFor(message, state, outbox, now, maxChars, since = null) {
  if (!isWakeWord(message, state)) return null
  const main = state.restart?.main ?? null
  // Every word to the main chat wakes it, but only while it is known not to run.
  if (message.to === main && (state.chats ?? []).find(chat => chat.name === main)?.isRunning !== false) return null
  // Not again within two minutes; and while an earlier word still waits for its waker (or the pause holds it), not for ten.
  if (outbox.some(sent => sent.command === 'start' && sent.about === message.to && (now - sent.at < WAKE_AGAIN_MS || isOnItsWay(sent, state, now)))) return null
  // The re-check of the review: retries stop for a word that has just been sent too (a pinned start sent anew each start
  // window asked Main 37 times in 6 h): at most MAX_WAKE_TRIES start words for one wait, each of a chat not asked in it.
  const pending = outbox.some(one => one.id !== undefined && one.id === message.id) ? outbox : [...outbox, { ...message, state: 'waiting' }]
  const progress = wakeProgress(state, message.to, pending)
  if (progress !== null && progress.asks.length >= MAX_WAKE_TRIES) return null
  const waker = wakerFor(state, message.to, outbox, now, since ?? progress?.since ?? null)
  if (waker === null) return null
  const checked = checkSay({ to: waker, command: 'start', chat: message.to }, state, maxChars)
  return checked.ok ? checked.message : null
}

/** The start words are asked at most this many times for one wait (review of 2026-10-25: retries must stop), each of another chat. */
export const MAX_WAKE_TRIES = 3

/**
 * T9.4: how the wake-up of `target` stands, or null when no word waits for it that the board wakes it for: `since`, the
 * oldest of those words, and `asks`, the start words about it since then that a chat could carry: taken, delivered or
 * failed, or waiting for a chat that may run. Not a word the sweep closed, nor one that waits for a chat known not to run
 * (the hand-out's start handed to a main chat that is off asks nobody yet; re-check of the review). A wait that ended (the
 * words were taken) starts a new count.
 */
function wakeProgress(state, target, outbox) {
  const times = outbox.filter(one => one.state === 'waiting' && one.to === target && Number.isFinite(one.at) && isWakeWord(wakeWordOf(one), state)).map(one => one.at)
  if (times.length === 0) return null
  const since = Math.min(...times)
  const isOff = name => boardLanes(state).find(chat => chat.name === name)?.isRunning === false
  const isTry = one => one.state !== 'dropped' && !(one.state === 'waiting' && isOff(one.to))
  return { since, asks: outbox.filter(one => one.command === 'start' && one.about === target && Number.isFinite(one.at) && one.at >= since && isTry(one)) }
}

/**
 * What the board asks on its clock for words that wait for a chat that is not running and for which no chat was ever
 * asked: they were sent while no chat could carry the start word (`wakeFor` asks nothing then), so they waited unseen
 * until a chat was opened by hand (2026-10-21: three words to the Advisor waited 09:46 to 10:57; T9.4, 2026-10-25: words
 * to the main chat and a start of Worker 3 waited 15 minutes). One start word per chat, through `wakeFor`, for the words
 * that wake it (`isWakeWord`: a start word held by an off chat hides no later word); none for a chat asked to be started in
 * the last ten minutes. Requests never get lost (2026-10-25), and retries stop (review): an ask that did not wake the chat
 * in ten minutes is asked again, of a running chat not asked since the oldest word that waits; at most `MAX_WAKE_TRIES`
 * start words for one wait, and then nothing more (`wakeFailedOf` says so). Nothing while the person's pause holds.
 * `outbox` is everything sent, in order, with what waited too long marked "expired".
 */
export function wakesDue(state, outbox, now, maxChars) {
  if (isHolding(state.pause)) return []
  const seen = new Set()
  const starts = []
  for (const message of outbox) {
    if (message.state !== 'waiting' || seen.has(message.to)) continue
    const word = wakeWordOf(message)
    if (!isWakeWord(word, state)) continue
    seen.add(message.to)
    const progress = wakeProgress(state, message.to, outbox)
    if (progress === null || progress.asks.length >= MAX_WAKE_TRIES || progress.asks.some(ask => isRecentStart(ask, state, now))) continue
    const start = wakeFor(word, state, outbox, now, maxChars, progress.since)
    if (start !== null) starts.push(start)
  }
  return starts
}

/**
 * T9.4 (review of 2026-10-25): the chats nobody could wake, `[{ chat, tries, since }]`: words wait for a chat known not to
 * run, the board asked at least once, the last ask is no longer on its way (ten minutes), and the clock asks no more
 * (`wakesDue`: `MAX_WAKE_TRIES` asks, or every running chat was asked). The page says so, and that the person opens it
 * themselves. It goes once the chat runs, its words no longer wait, or another chat runs that can still be asked. Nothing
 * while the person's pause holds. `outbox` is everything sent.
 */
export function wakeFailedOf(state, outbox, now) {
  if (isHolding(state.pause)) return []
  const lanes = boardLanes(state)
  const failed = []
  for (const target of new Set(outbox.filter(one => one.state === 'waiting').map(one => one.to))) {
    if (lanes.find(chat => chat.name === target)?.isRunning !== false) continue
    const progress = wakeProgress(state, target, outbox)
    if (progress === null || progress.asks.length === 0 || progress.asks.some(ask => isRecentStart(ask, state, now))) continue
    const next = progress.asks.length < MAX_WAKE_TRIES ? wakerFor(state, target, outbox, now, progress.since) : null
    if (next === null) failed.push({ chat: target, tries: progress.asks.length, since: progress.since })
  }
  return failed
}

/**
 * B577: the main chat's word to wake a chat whose session was stopped (its turn cut by a stop, the main chat's or the
 * person's): the app drops every word to it until it gets input, and a message by its session id is input. `stop` is
 * the chat's stop (src/stopped.mjs `stoppedOf`), `clock` says a time as "21:40".
 */
export const wakeStoppedWords = (main, lane, stop, clock) => {
  const id = typeof lane.appSession === 'string' && /^[\w-]{1,80}$/.test(lane.appSession) ? ` Its session id: ${lane.appSession}.` : ''
  const count = `${stop.words} ${stop.words === 1 ? 'word' : 'words'}`
  return {
    to: main, ask: null, step: null, title: null, version: null, verdict: null, command: 'wake', about: lane.name, stoppedAt: stop.since,
    text: `wake "${plainLine(lane.name)}"
Its turn was stopped at ${clock(stop.since)} and the app drops every word to it until it gets input: ${count} from the worker board wait for it. Send it one line by its session id: "The worker board holds words for you; they come in now." If you stopped it, say who and why in a work note.${id}`,
  }
}

/**
 * B577: the words to the main chat to wake each stopped chat, once per stop (the stop's first time, `stoppedAt`): none
 * for the main chat itself, and none when the board knows no main chat. `outbox` is everything sent.
 */
export function wakesStopped(state, stopped, outbox, clock) {
  const main = state.restart?.main ?? null
  if (main === null) return []
  const lanes = [...(state.chats ?? []).filter(chat => !chat.isLeftover), ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : []), ...(state.supervisorChat ? [state.supervisorChat] : [])]
  return lanes.filter(lane => lane.name !== main && (stopped.get(lane.name) ?? null) !== null)
    .filter(lane => !outbox.some(sent => sent.command === 'wake' && sent.about === lane.name && sent.stoppedAt === stopped.get(lane.name).since))
    .map(lane => wakeStoppedWords(main, lane, stopped.get(lane.name), clock))
}

/**
 * B298: a line the person typed on the board to a chat is filed as an instruction before it is kept for delivery, and
 * carries its id at its end ("Make it blue [I17]"), so the chat closes the one it was given. `file(body)` is the work
 * API as the person. An answer to a request and the board's own words are no instruction; when nothing is filed (no
 * store, or the board only shows: the page says so on top), the line goes as it is, without an id.
 */
export async function withInstruction(message, file) {
  if ((message.ask ?? null) !== null || (message.command ?? null) !== null) return message
  const words = String(message.text ?? '').trim()
  const text = words !== '' ? words : typeof message.picture === 'string' ? `(a picture: ${message.picture})` : ''
  if (text === '') return message
  const filed = await Promise.resolve().then(() => file({ action: 'instruction', chat: message.to, text })).catch(() => null)
  if (filed?.ok !== true || typeof filed.result?.id !== 'string') return message
  return { ...message, text: `${words}${words === '' ? '' : ' '}[${filed.result.id}]`, instruction: filed.result.id }
}

/**
 * B299: the words that wake the chat whose ask the person answered on the board (the work API's `wake`): typed into
 * its chat as `(answered on the worker board, HH:MM) Q12 "<title>": <answer>` (bridge.mjs, messageText). The answer
 * names the ask's own id, so it answers that ask whatever the chat did since.
 */
/**
 * B300: the board's one line to a chat that a step is its own now (the work store's reconciler, or the chat's own pull
 * at the end of a turn): the chat runs `work next` and takes it. Typed as it is: it is the board's word, not the
 * person's (bridge.mjs, messageText). `text` for another line of the reconciler's to the step's Owner.
 */
export const workWords = (to, id, text = `work: ${id} is yours; run work next`) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'work', about: id, text,
})

/**
 * The supervisor's Part 2 (spec 2026-10-24, "The supervisor chat"): the board's word that starts a sweep of the supervisor's
 * chat, typed as it is (the board's own line, bridge.mjs `messageText`): read the health summary, file each oddity, end
 * the turn. `subject` the worker "Check now" was pressed for in its menu, or null; `job` where its job is written.
 */
export const sweepWords = (to, { subject = null, job }) => ({
  to, ask: null, step: null, title: null, version: null, verdict: null, command: 'sweep', about: subject ?? 'board',
  text: [
    `sweep: run work health, file each oddity with work incident (evidence and the rule that could catch it), then end your turn${subject === null ? '' : ` (about ${plainLine(subject)})`}`,
    `Your job: ${job}`,
  ].join('\n'),
})

/** One line of a chat's or the board's words, at most `max` characters. */
const wordsLine = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * The supervisor's Part 2 (Task 7, spec 2026-10-24, "To you and to the Advisor"): the board's word to the partner about an
 * incident that opened or came back (`incident`, as supervisor/incidents.mjs `incidentsOf` gives it): its id and what
 * was found, whether it is new or came back, its count, where it came from (a rule's id, or the sweep), what it is
 * about, its evidence and the rule that could catch it; the partner decides a tweak or a structural fix and files the
 * fix step (roles/partner.md, "Incidents"). It goes through the outbox like every board word, and waits there for a
 * partner that does not run (the main chat is asked to start it, `wakeFor`).
 */
export function incidentWords(to, incident, job) {
  const count = Number.isFinite(incident.count) && incident.count > 0 ? incident.count : 1
  const isBack = incident.state === 'came back'
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'incident', about: incident.id,
    text: [
      `incident: ${incident.id} ${wordsLine(incident.title, 200)}`,
      `State: ${isBack ? `came back after its fix${incident.fix ? ` ${incident.fix}` : ''}` : 'new'}`,
      `Count: ${count} (${count === 1 ? 'seen once' : `seen ${count} times`})`,
      `Source: ${incident.source === 'sweep' ? 'sweep (the supervisor\'s chat)' : `the rule ${wordsLine(incident.source, 60)}`}`,
      `Subject: ${wordsLine(incident.subject, 80) || 'the board'}`,
      `Evidence: ${wordsLine(incident.evidence) || 'none given'}`,
      ...(incident.ruleWanted ? [`Rule wanted: ${wordsLine(incident.ruleWanted)}`] : []),
      `Your job: ${job}, "Incidents"`,
    ].join('\n'),
  }
}

export const answerWords = wake => ({
  to: wake.to, ask: `work:${wake.id}`, step: wake.id, title: String(wake.title ?? '').slice(0, 200), version: null, verdict: null, text: String(wake.text ?? ''),
})
