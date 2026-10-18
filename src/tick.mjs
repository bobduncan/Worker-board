// B110: the person's word on a step that the board settles itself: a tick, when the person approves a step whose work is
// merged already; B221: a step the person closes or deletes on the Backlog tab; B233: their answers to a step's refine.
// No chat has to be woken for that. Everything else stays with the chats: a rejection, an approval of work whose branch
// is still open, an answer to a question.
//
// B301: every change goes through the work store's API (work/api.mjs) as the person; the API writes backlog.md anew as
// the store's view. The board never writes the backlog file otherwise. Only the board that writes the store does this
// (`work` is `{ dir, viewFile, prefix }`); a copy without a store of its own and the demo never do.

import { workApi } from './work/api.mjs'
import { valueOf } from './work/item.mjs'
import { readStore } from './work/store.mjs'

const NOTE_CHARS = 400
const pad = value => String(value).padStart(2, '0')

/** One line of the person's words: no line ends, at most `max` characters. */
const oneLine = (words, max) => String(words ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * The line written under a step the person approved, or marked done (`verdict`): when, and their note when they
 * gave one. The note is kept to one line; it is sent to nobody.
 */
export function approvalLine(now, note = '', verdict = 'approve') {
  const at = new Date(now)
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} at ${pad(at.getHours())}:${pad(at.getMinutes())}`
  const words = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_CHARS)
  return `${{ done: 'Done', close: 'Closed' }[verdict] ?? 'Approved'} by you on the worker board on ${when}${words === '' ? '.' : `: ${words}`}`
}

/**
 * Where the person's approval of a backlog step goes (and their "Done" on a step only they could do). `tick`: the board ticks it, because its work is merged: the
 * step names no branch, or the base branch (`base`, the setting baseBranch), or a branch that is in none of the repositories any more. `worker`: its branch is
 * still there, so the worker merges; or the board cannot tell (`branches` is null: git did not answer), and then
 * the approval goes to the worker as before, never lost. `branches` are the local branches of the repositories
 * the board knows.
 */
export function approvalRoute(branch, branches, base = 'main') {
  if (branch === null || branch === undefined || branch === base) return 'tick'
  if (!Array.isArray(branches)) return 'worker'
  return branches.includes(branch) ? 'worker' : 'tick'
}

/**
 * The open steps of the store that wait for the step `id` (its `Blocked by` or `Waits for` names it), for the one line
 * the main chat gets about them. `items` is the store's items.
 */
export function waitingOn(items, id) {
  const names = new RegExp(`\\b${id}\\b`)
  return [...items.values()]
    .filter(item => valueOf(item, 'Kind') === 'step' && !['done', 'dropped'].includes(valueOf(item, 'State')) && valueOf(item, 'Id') !== id
      && names.test(`${valueOf(item, 'Blocked by') ?? ''} ${valueOf(item, 'Waits for') ?? ''}`))
    .map(item => ({ id: valueOf(item, 'Id'), worker: valueOf(item, 'Owner') ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/** The board's own line to the main chat when steps waited for the one that was approved. One short plain line. */
export function nextWords(id, waiting) {
  const steps = waiting.map(step => `${step.id}${step.worker === null ? '' : ` (for ${String(step.worker).replace(/\s+/g, ' ').slice(0, 60)})`}`).join(', ')
  return `${id} is approved and ticked on the worker board; no worker was woken for it. Open steps that waited for it: ${steps}.`
}

const STEP_ID = /^B\d+$/
/** B301: what this board cannot change without a store of its own. */
const NO_STORE = { ok: false, status: 409, why: 'This board only shows: change the work on the board that delivers.' }

/** One change to the store as the person, its view written to `work.viewFile`. */
function asPerson(work, now, body) {
  return workApi(body, { dir: work.dir, fs: work.fs, now, as: 'person', viewFile: work.viewFile ?? null, prefix: work.prefix ?? '' })
}

/**
 * B221: the person closes or deletes a step from the Backlog tab (`body`: `{ action: 'close' | 'delete', step:
 * 'B12', reason }`), or answers its refine (`refine-answer`, `refine-accept`). Close ticks it as done and writes
 * "Closed by you on the worker board on <date at time>" under it, with their reason when they gave one. Delete takes
 * its item out. That a worker is on the step or it is queued is said by the page before the person confirms: the
 * board does not refuse it. Answers `{ ok: true, result }` or `{ ok: false, status, why }`.
 */
export async function editStep(body, { now, work = null }) {
  if (work === null || work === undefined || typeof work.dir !== 'string') return NO_STORE
  const step = typeof body?.step === 'string' ? body.step : ''
  if (!STEP_ID.test(step)) return { ok: false, status: 400, why: 'Name the step by its number (B12).' }
  const action = body?.action
  if (action === 'refine-answer' || action === 'refine-accept') return refineStep(body, step, { now, work })
  if (action !== 'close' && action !== 'delete') return { ok: false, status: 400, why: 'Close or delete.' }
  const done = await asPerson(work, now, action === 'close' ? { action: 'tick', id: step, line: approvalLine(now, body?.reason ?? '', 'close') } : { action: 'delete', id: step })
  return done.ok ? { ok: true, result: { step, action } } : done
}

/** B233: at most this many characters per answer, and for the feedback. */
export const REFINE_CHARS = 1000

/**
 * B233: the person's answers and feedback on a step's refine block (`refine-answer`: `answers` as `[{ index, answer
 * }]`, `feedback`), or their "accepted" (`refine-accept`), written into the block under the step through the API.
 * Empty answers are left out; one answer or the feedback is needed.
 */
async function refineStep(body, step, { now, work }) {
  if (body.action === 'refine-accept') {
    const done = await asPerson(work, now, { action: 'refine-accept', id: step })
    return done.ok ? { ok: true, result: { step, action: body.action } } : done
  }
  if (!Array.isArray(body.answers) || body.answers.length > 20) return { ok: false, status: 400, why: 'No answers.' }
  const answers = []
  for (const one of body.answers) {
    if (!Number.isInteger(one?.index) || one.index < 0 || typeof one.answer !== 'string') return { ok: false, status: 400, why: 'An answer names its question by its place.' }
    if (one.answer.length > REFINE_CHARS) return { ok: false, status: 413, why: `At most ${REFINE_CHARS} characters per answer.` }
    const answer = oneLine(one.answer, REFINE_CHARS)
    if (answer !== '') answers.push({ index: one.index, answer })
  }
  if (typeof (body.feedback ?? '') !== 'string' || (body.feedback ?? '').length > REFINE_CHARS) return { ok: false, status: 413, why: `At most ${REFINE_CHARS} characters of feedback.` }
  const feedback = oneLine(body.feedback, REFINE_CHARS)
  if (answers.length === 0 && feedback === '') return { ok: false, status: 400, why: 'Answer a question or give feedback first.' }
  const done = await asPerson(work, now, { action: 'refine-answer', id: step, answers, feedback })
  return done.ok ? { ok: true, result: { step, action: body.action } } : done
}

/** What the person's word on a step is called in the line under it: an approval of work, or "done" for what only they could do. */
const WORDS = { approve: 'Approved', done: 'Done' }

/**
 * B110: settles what the person answered to a backlog step when that is the board's own to do: an approval of a
 * Verify step, or "Done" on a Do step, whose work is merged, so nothing is left for a worker. The board ticks the
 * step in the store and writes the word with its time under it; no chat is woken. When open steps waited for it, the
 * main chat gets one line of the board's own (`say`).
 *
 * `message` is what `checkSay` let through, `state` the board's state. `work` is the store this board writes (null:
 * it writes none, as a copy or the demo). `branchesNow` asks git anew at the click, so a branch made a moment ago
 * counts. Answers `{ ok: true, message }` when the step is ticked, `{ ok: false, status, why }` when the step is ticked
 * already or gone, and null when it is not the board's to settle or could not be written: the answer then goes to its
 * worker as before, never lost.
 */
export async function settleByBoard(message, state, { branchesNow, now, say, newId, work = null }) {
  if (work === null || work === undefined || WORDS[message.verdict] === undefined || typeof message.step !== 'string') return null
  const item = (state.backlogForYou ?? []).find(need => need.id === message.ask)
  if (item === undefined || item.approval !== 'tick' || item.kind !== (message.verdict === 'done' ? 'do' : 'verify')) return null
  if (approvalRoute(item.branch, await branchesNow().catch(() => null), state.baseBranch) !== 'tick') return null
  const ticked = await asPerson(work, now, { action: 'tick', id: message.step, line: approvalLine(now, message.text, message.verdict) })
  if (!ticked.ok) return ticked.status === 409 || ticked.status === 404 ? { ok: false, status: 409, why: 'That step is ticked already, or no longer on the backlog.' } : null
  const items = await readStore(work.dir, work.fs).then(read => read.items, () => new Map())
  const waiting = waitingOn(items, message.step)
  const main = state.restart?.main ?? null
  if (waiting.length > 0 && main !== null) {
    await say({ id: newId(), at: now, to: main, ask: null, step: message.step, title: null, version: null, verdict: null, command: 'next', text: nextWords(message.step, waiting), state: 'waiting' })
  }
  return { ok: true, message: { ...message, to: null, state: 'ticked' } }
}
