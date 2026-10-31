// The Product owner (the person, 2026-10-31: "these brainstorms are ones the user is waiting for, so they are more important
// then refineing backlog items, so i dont want a bottleneck that we are waiting for something, i want a chat to give it
// immediate priority? maybe a different role from the advisor", then "B": a chat of its own; roles/product-owner.md). The
// list of chats may name one chat `"owner"`, shown as "Product owner": the person's talks go to it (the brainstorm, "Change
// this goal", the Focus page's talk), nothing else does, and it is woken at once. While the list names none, or its chat is
// not on the board, every talk stays with the partner (the Advisor), as before. Pure: it reads what it is given.

import { MODELS, EFFORTS } from './work/effort.mjs'

/** The list's role key and what the page calls it. */
export const OWNER_ROLE = 'owner'
export const OWNER_LABEL = 'Product owner'

/**
 * The Product owner's setting, held by the board by code as the Supervisor's is (src/work/supervisorEffort.mjs, T7.5): Opus,
 * medium (the charter: the talk shapes the goals, and it must be quick). Never Fable.
 */
export const OWNER_SETTING = Object.freeze({ model: 'opus', effort: 'medium' })
if (!MODELS.includes(OWNER_SETTING.model) || !EFFORTS.includes(OWNER_SETTING.effort)) throw new Error('The Product owner\'s setting is no model and effort of the board\'s.')

/** The owner's job text in the board's roles folder, and its part every talk word names. */
export const OWNER_JOB = 'product-owner.md'
export const TALK_PART = 'How a talk goes'

/**
 * The board's words that belong to a talk with the person: every word of a brainstorm (also "Change this goal", whose start
 * is a `brainstorm` with `Kind: change`, and the board's own fix and stranded words about a talk's question), and of the Focus
 * page's talk: the goal picked as the focus (`focus:`), the talk bar (`talk:`), the person's "not yet" on the vibe, the vibe
 * agreed and the "not yet" on the how (the how is talked through in the same thread), and the ask for a goal's Done when.
 * Go on the how (the steps made refined), "Is the vibe there?", the re-check, the demo and an Undo of the daily note are no
 * talk: they stay with the partner, with the refines, the result checks, the incidents and the recaps.
 */
export const TALK_COMMANDS = Object.freeze([
  'brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-change', 'brainstorm-understood', 'brainstorm-not-quite', 'brainstorm-fix', 'brainstorm-stranded',
  'focus', 'talk', 'vibe-not-yet', 'vibe-agreed', 'how-not-yet', 'done-when',
])
export const isTalkWord = command => typeof command === 'string' && TALK_COMMANDS.includes(command)

/** The words the page says the talk partner with, after "your": "Product owner" or "partner". */
export const partnerWord = role => (role === OWNER_ROLE ? OWNER_LABEL : 'partner')

/** When a lane took the word it is on, else when its turn began while it works; null when neither is known. */
const sinceOf = lane => {
  if (Number.isFinite(lane?.on?.since)) return lane.on.since
  return lane?.state === 'working' && Number.isFinite(lane?.turnAt) ? lane.turnAt : null
}

/** One lane of the state as the talk partner: `{ name, role, label, state, isRunning, doingNow, turnAt, on, next, since }`. */
const asPartner = (lane, role) => ({
  name: lane.name,
  role,
  label: partnerWord(role),
  state: lane.state ?? 'unknown',
  isRunning: lane.isRunning ?? null,
  doingNow: lane.doingNow ?? null,
  turnAt: Number.isFinite(lane.turnAt) ? lane.turnAt : null,
  on: lane.on ?? null,
  next: Array.isArray(lane.next) ? lane.next : [],
  since: sinceOf(lane),
})

/**
 * Who the person talks with: the Product owner (`state.productOwner`: the chat the list names `"owner"`, on the board) when
 * there is one, else the partner (`state.advisor`), else null. `{ name, role: 'owner'|'advisor', label, state, isRunning,
 * doingNow, turnAt, on, next, since }`: `on` what it holds now (the word it took), `next` what waits for it in pick-up order,
 * `since` when it took what it is on (else when its turn began while it works), as the state's lanes give them.
 */
export function talkPartnerOf(state) {
  const owner = state?.productOwner ?? null
  if (owner !== null && typeof owner?.name === 'string' && owner.name !== '') return asPartner(owner, OWNER_ROLE)
  const advisor = state?.advisor ?? null
  return advisor !== null && typeof advisor?.name === 'string' && advisor.name !== '' ? asPartner(advisor, 'advisor') : null
}

/** The talk partner's name, or null. */
export const talkPartnerName = state => talkPartnerOf(state)?.name ?? null

/** Whether `name` is the Product owner of the state (a chat the board sends talk words only). */
export const isOwnerName = (state, name) => typeof name === 'string' && name !== '' && state?.productOwner?.name === name

/**
 * The words the hands carry first: the jobs about `first` (the talk partner when it is the Product owner) before the others,
 * the rest in their order, so a talk the person waits for is woken before anything else.
 */
export function ownerFirst(jobs, first) {
  if (typeof first !== 'string' || first === '') return jobs
  return [...jobs.filter(job => job.chat === first), ...jobs.filter(job => job.chat !== first)]
}

// ---- its own routine (T12) ----

/** How often the board asks again for the Product owner's chat to be started by its routine, when the list names one and no chat of it is there. */
export const OWNER_START_AGAIN_MS = 30 * 60_000

/**
 * The project's folder name as the stored routines' ids use it (src/hands.mjs keeps the same rule for the workers' ids).
 */
const routineBase = folder => String(folder ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The ids of the Product owner's own stored routine, `<folder>-product-owner`, and "-2" for a second login (as the workers'). */
export const ownerTaskIds = folder => {
  const base = routineBase(folder)
  return base === '' ? [] : [`${base}-product-owner`, `${base}-product-owner-2`]
}

/** The Product owner's chat title: the list's prefix and the name the list gives it. */
export const ownerTitle = (prefix, name) => `${prefix ?? ''}${name}`

/**
 * T12: the board's word that has a hand run the Product owner's own routine, when the list names an owner (`state.ownerName`)
 * and no chat of it is on the board (`state.productOwner` null): its chat starts with its title and joins by itself. One word
 * in OWNER_START_AGAIN_MS at most (`outbox`, everything sent), none while the person pauses (`isPaused`) or without a main chat
 * to take it when no hand does. A spawn word, as for a new worker (src/hands.mjs: the hand runs `routine` instead of the next
 * worker's), so the Workers mod needs no change. Null when none is due.
 */
export function ownerStartWords({ state, outbox = [], now, folder, isPaused = false }) {
  const name = state?.ownerName ?? null
  const main = state?.restart?.main ?? null
  if (typeof name !== 'string' || name === '' || (state?.productOwner ?? null) !== null || main === null || isPaused) return null
  const tasks = ownerTaskIds(folder)
  if (tasks.length === 0) return null
  if ((outbox ?? []).some(sent => sent.command === 'spawn' && sent.routine?.role === OWNER_ROLE && Number.isFinite(sent.at) && now - sent.at < OWNER_START_AGAIN_MS)) return null
  const title = ownerTitle(state.chatPrefix ?? '', name)
  return {
    to: main, ask: null, step: null, title: null, version: null, verdict: null, command: 'spawn', count: 1, why: 'owner', about: name,
    routine: { role: OWNER_ROLE, title, tasks },
    text: `start the ${OWNER_LABEL}\nIts chat "${title}" is not on the board, and the person's talks wait for it. Run its stored routine: mcp__scheduled-tasks__run_scheduled_task with taskId "${tasks[0]}" (a second login: "${tasks[1]}"). No routine of that id: say so in one line to the person; the board's settings panel gives the line that makes it.`,
  }
}
