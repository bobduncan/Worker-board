// B110: the one thing the board writes outside its own data folder: the backlog. A tick, when the person approves
// a step whose work is merged already; B221: a step the person closes or deletes on the Backlog tab. No chat has to be woken for that. Everything else stays with the chats: a
// rejection, an approval of work whose branch is still open, an answer to a question.
//
// Only the board that delivers writes (the one in the repository's main folder); a copy and the demo never do.

import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'

import { parseBacklog, refinedSpan } from './backlog.mjs'

const STEP = /^- \[( |x|X)\]\s+(B\d+)\b/
const NOTE_CHARS = 400

/** A text in its lines, each with its own line end: put together again they are the same text. */
const linesOf = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
const endOf = line => (line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '')

/**
 * The backlog's text with the open step `id` ticked and the line `under` added below it, or why nothing changes:
 * `gone` (no such step), `ticked` (it is ticked already), `twice` (two steps have that id: the board does not
 * guess). Only the step's own line changes ("- [ ]" becomes "- [x]") and one line is added after the lines that
 * stand indented under it; every other character stays as it is, the line ends included.
 */
export function tickStep(text, id, under) {
  const lines = linesOf(text)
  const found = lines.map((line, index) => ({ index, step: line.match(STEP) })).filter(one => one.step !== null && one.step[2] === id)
  if (found.length === 0) return { ok: false, why: 'gone' }
  if (found.length > 1) return { ok: false, why: 'twice' }
  const { index, step } = found[0]
  if (step[1] !== ' ') return { ok: false, why: 'ticked' }
  // Its own lines stand indented under it: the new line goes after the last of them.
  let last = index
  while (last + 1 < lines.length && /^[ \t]+\S/.test(lines[last + 1])) last += 1
  const out = [...lines]
  out[index] = lines[index].replace('- [ ]', '- [x]')
  const end = endOf(out[last])
  // A file whose last line has no line end keeps none.
  if (end === '') out[last] = `${out[last]}${text.includes('\r\n') ? '\r\n' : '\n'}  ${under}`
  else out.splice(last + 1, 0, `  ${under}${end}`)
  return { ok: true, text: out.join('') }
}

/**
 * B221: the backlog's text without the step `id` and the lines that stand indented under it, or why nothing changes:
 * `gone` (no such step) or `twice` (two steps have that id). Every other character stays as it is, the line ends
 * included; a ticked step may be deleted too.
 */
export function deleteStep(text, id) {
  const lines = linesOf(text)
  const found = lines.map((line, index) => ({ index, step: line.match(STEP) })).filter(one => one.step !== null && one.step[2] === id)
  if (found.length === 0) return { ok: false, why: 'gone' }
  if (found.length > 1) return { ok: false, why: 'twice' }
  const { index } = found[0]
  let last = index
  while (last + 1 < lines.length && /^[ \t]+\S/.test(lines[last + 1])) last += 1
  const out = [...lines.slice(0, index), ...lines.slice(last + 1)]
  // When the deleted lines ended the file, the line before them keeps its line end as it was: a file that ended
  // without one now ends with one, which changes nothing a reader sees.
  return { ok: true, text: out.join('') }
}

const pad = value => String(value).padStart(2, '0')

// refinewrite:start
/** One line of the person's words, as it stands in the backlog: no line ends, at most `max` characters. */
const oneLine = (words, max) => String(words ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * B233: the step `id`'s refine block in the backlog's lines: where its head stands and the lines of its parts, as
 * indexes of `lines`; or why not: `gone`, `twice`, or `none` (the step has no refine block yet).
 */
function refineBlock(lines, id) {
  const found = lines.map((line, index) => ({ index, step: line.match(STEP) })).filter(one => one.step !== null && one.step[2] === id)
  if (found.length === 0) return { ok: false, why: 'gone' }
  if (found.length > 1) return { ok: false, why: 'twice' }
  let last = found[0].index
  while (last + 1 < lines.length && /^[ \t]+\S/.test(lines[last + 1])) last += 1
  const under = lines.slice(found[0].index + 1, last + 1).map(line => line.replace(/\r?\n$/, ''))
  const span = refinedSpan(under)
  if (span === null) return { ok: false, why: 'none' }
  const first = found[0].index + 1
  const block = { head: first + span[0], end: first + span[1], questions: [], feedback: null, isDone: found[0].step[1] !== ' ' }
  let part = null
  for (let index = block.head + 1; index < block.end; index += 1) {
    const line = lines[index].trim()
    const named = line.match(/^(Problem|Goal|Questions|Feedback):/)
    if (named !== null) {
      part = named[1]
      if (part === 'Feedback') block.feedback = index
      continue
    }
    // Counted as `refinedOf` counts them: "None: ..." is no question.
    if (part === 'Questions' && /^[-*]\s+/.test(line) && !/^[-*]\s+None\b/i.test(line)) block.questions.push(index)
    if (part === 'Feedback') block.feedback = index
  }
  return { ok: true, block }
}

/**
 * B233: the backlog's text with the person's answers to a step's refine questions and their feedback written into
 * its refine block. `answers` are `{ index, answer }` (the question's place in the block, from 0); an answer that is
 * there already is replaced. The feedback becomes the point "Round <the block's round>: ..." under "Feedback:", which is added
 * at the block's end when it is not there. Every other character stays as it is.
 */
export function answerRefine(text, id, answers, feedback) {
  const lines = linesOf(text)
  const found = refineBlock(lines, id)
  if (!found.ok) return found
  const { block } = found
  const round = Number(lines[block.head].match(/\bround\s+(\d+)/i)?.[1] ?? 1)
  const out = [...lines]
  const indent = lines[block.head].match(/^[ \t]*/)[0]
  for (const { index, answer } of answers) {
    const at = block.questions[index]
    if (at === undefined) return { ok: false, why: 'question' }
    const end = endOf(lines[at])
    const question = lines[at].slice(0, lines[at].length - end.length).replace(/\s+Answer:\s.*$/, '').replace(/\s+$/, '')
    out[at] = `${question} Answer: ${answer}${end}`
  }
  if (feedback !== '') {
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    const add = block.feedback === null ? [`${indent}Feedback:`, `${indent}- Round ${round}: ${feedback}`] : [`${indent}- Round ${round}: ${feedback}`]
    const after = block.feedback ?? block.end - 1
    // A file whose last line has no line end keeps none.
    if (endOf(out[after]) === '') out[after] = `${out[after]}${newline}${add.join(newline)}`
    else out.splice(after + 1, 0, ...add.map(line => `${line}${endOf(out[after])}`))
  }
  return { ok: true, text: out.join('') }
}

/** B233: the backlog's text with the step's refine block marked accepted ("accepted <when>" in its head's brackets). */
export function acceptRefine(text, id, when) {
  const lines = linesOf(text)
  const found = refineBlock(lines, id)
  if (!found.ok) return found
  const at = found.block.head
  const end = endOf(lines[at])
  const head = lines[at].slice(0, lines[at].length - end.length)
  const bracket = head.match(REFINED_HEAD_RAW)
  const inside = bracket[2] === undefined ? '' : bracket[2].replace(/;\s*accepted\b[^;]*/i, '').trim()
  const out = [...lines]
  out[at] = `${bracket[1]}Refined (${inside === '' ? '' : `${inside}; `}accepted ${when}):${end}`
  return { ok: true, text: out.join('') }
}
const REFINED_HEAD_RAW = /^([ \t]*)Refined\s*(?:\(([^)]*)\))?\s*:\s*$/
// refinewrite:end

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

/** The open steps that wait for the step `id` ("after B55"), for the one line the main chat gets about them. */
export function waitingOn(backlog, id) {
  const names = new RegExp(`\\b${id}\\b`)
  return backlog.activities.flatMap(activity => activity.steps)
    .filter(step => !step.isDone && step.id !== null && step.id !== id && typeof step.after === 'string' && names.test(step.after))
    .map(step => ({ id: step.id, worker: step.worker ?? null }))
}

/** The board's own line to the main chat when steps waited for the one that was approved. One short plain line. */
export function nextWords(id, waiting) {
  const steps = waiting.map(step => `${step.id}${step.worker === null ? '' : ` (for ${String(step.worker).replace(/\s+/g, ' ').slice(0, 60)})`}`).join(', ')
  return `${id} is approved and ticked on the worker board; no worker was woken for it. Open steps that waited for it: ${steps}.`
}

const files = { readFile, writeFile, rename, rm }

/**
 * Ticks the step in the backlog file. The file is read anew right before; the new text is written beside the file
 * and put in its place in one move, so a half-written backlog is never left behind; and when somebody else wrote
 * the backlog in between, theirs stands and this starts again from it. The bytes are handled one to one (not as
 * text of some encoding), so every byte that is not the tick or the new line stays what it was.
 * Answers `{ ok: true }`, or `{ ok: false, why }`: `gone`, `ticked`, `twice`, or `write` (it could not be written).
 */
export async function writeTick(file, id, under, fs = files) {
  const added = Buffer.from(under, 'utf8').toString('latin1')
  return rewrite(file, before => tickStep(before, id, added), fs)
}

/**
 * B221: the backlog's file with one change made to it (`change`: the text before, as latin1, to `{ ok, text }` or
 * `{ ok: false, why }`), read anew right before and put in its place in one move, as `writeTick` describes.
 */
export async function rewrite(file, change, fs) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let before
    try {
      before = (await fs.readFile(file)).toString('latin1')
    } catch {
      return { ok: false, why: 'gone' }
    }
    const ticked = change(before)
    if (!ticked.ok) return ticked
    const beside = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await fs.writeFile(beside, Buffer.from(ticked.text, 'latin1'), { flag: 'wx' })
      if ((await fs.readFile(file)).toString('latin1') !== before) {
        await fs.rm(beside, { force: true })
        continue
      }
      await fs.rename(beside, file)
      return { ok: true }
    } catch {
      await fs.rm(beside, { force: true }).catch(() => {})
      return { ok: false, why: 'write' }
    }
  }
  return { ok: false, why: 'write' }
}

const STEP_ID = /^B\d+$/
const EDIT_WHY = {
  none: [409, 'That step has not been refined yet.'],
  question: [409, 'The questions changed in the meantime: open the step again.'],
  gone: [404, 'That step is no longer on the backlog.'],
  ticked: [409, 'That step is closed already.'],
  twice: [409, 'Two steps have that number: change the backlog by hand.'],
  write: [500, 'The backlog could not be written.'],
}

/**
 * B221: the person closes or deletes a step from the Backlog tab (`body`: `{ action: 'close' | 'delete', step:
 * 'B12', reason }`). Close ticks it and writes "Closed by you on the worker board on <date at time>" under it, with
 * their reason when they gave one: it stays in the file as history. Delete takes the step and its lines out. Only
 * the board that delivers writes (`canWrite`). That a worker is on the step or it is queued is said by the page
 * before the person confirms: the board does not refuse it. Answers `{ ok: true, result }` or `{ ok: false, status, why }`.
 */
export async function editStep(body, { canWrite, file, now, fs = files }) {
  if (canWrite !== true) return { ok: false, status: 409, why: 'This board only shows: change the backlog on the board that delivers.' }
  const step = typeof body?.step === 'string' ? body.step : ''
  if (!STEP_ID.test(step)) return { ok: false, status: 400, why: 'Name the step by its number (B12).' }
  const action = body?.action
  if (action === 'refine-answer' || action === 'refine-accept') return refineStep(body, step, { file, now, fs })
  if (action !== 'close' && action !== 'delete') return { ok: false, status: 400, why: 'Close or delete.' }
  const done = action === 'close'
    ? await writeTick(file, step, approvalLine(now, body?.reason ?? '', 'close'), fs)
    : await rewrite(file, before => deleteStep(before, step), fs)
  if (done.ok) return { ok: true, result: { step, action } }
  const [status, why] = EDIT_WHY[done.why] ?? EDIT_WHY.write
  return { ok: false, status, why }
}

/** B233: at most this many characters per answer, and for the feedback. */
export const REFINE_CHARS = 1000

/**
 * B233: the person's answers and feedback on a step's refine block (`refine-answer`: `answers` as `[{ index, answer
 * }]`, `feedback`), or their "accepted" (`refine-accept`), written into the block under the step. Empty answers are
 * left out; one answer or the feedback is needed.
 */
async function refineStep(body, step, { file, now, fs }) {
  let change
  if (body.action === 'refine-accept') {
    const at = new Date(now)
    const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
    change = before => acceptRefine(before, step, when)
  } else {
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
    // The file is handled as latin1 bytes: the person's words go in as their UTF-8 bytes.
    const bytes = words => Buffer.from(words, 'utf8').toString('latin1')
    change = before => answerRefine(before, step, answers.map(one => ({ ...one, answer: bytes(one.answer) })), bytes(feedback))
  }
  const done = await rewrite(file, change, fs)
  if (done.ok) return { ok: true, result: { step, action: body.action } }
  const [status, why] = EDIT_WHY[done.why] ?? EDIT_WHY.write
  return { ok: false, status, why }
}

/** What the person's word on a step is called in the line under it: an approval of work, or "done" for what only they could do. */
const WORDS = { approve: 'Approved', done: 'Done' }

/**
 * B110: settles what the person answered to a backlog step when that is the board's own to do: an approval of a
 * Verify step, or "Done" on a Do step, whose work is merged, so nothing is left for a worker. The board ticks the
 * step in the backlog and writes the word with its time under it; no chat is woken. When open steps waited for
 * it, the main chat gets one line of the board's own (`say`).
 *
 * `message` is what `checkSay` let through, `state` the board's state. `canWrite` is true only on the board that
 * delivers: a copy and the demo never write. `branchesNow` asks git anew at the click, so a branch made a moment
 * ago counts. Answers `{ ok: true, message }` when the step is ticked, `{ ok: false, status, why }` when the step
 * is ticked already or gone, and null when it is not the board's to settle or could not be written: the answer
 * then goes to its worker as before, never lost.
 */
export async function settleByBoard(message, state, { canWrite, file, branchesNow, now, say, newId, fs = files }) {
  if (canWrite !== true || WORDS[message.verdict] === undefined || typeof message.step !== 'string') return null
  const item = (state.backlogForYou ?? []).find(need => need.id === message.ask)
  if (item === undefined || item.approval !== 'tick' || item.kind !== (message.verdict === 'done' ? 'do' : 'verify')) return null
  if (approvalRoute(item.branch, await branchesNow().catch(() => null), state.baseBranch) !== 'tick') return null
  const done = await writeTick(file, message.step, approvalLine(now, message.text, message.verdict), fs)
  if (!done.ok) return done.why === 'write' ? null : { ok: false, status: 409, why: 'That step is ticked already, or no longer on the backlog.' }
  const text = await fs.readFile(file).then(bytes => bytes.toString('utf8'), () => '')
  const waiting = waitingOn(parseBacklog(text), message.step)
  const main = state.restart?.main ?? null
  if (waiting.length > 0 && main !== null) {
    await say({ id: newId(), at: now, to: main, ask: null, step: message.step, title: null, version: null, verdict: null, command: 'next', text: nextWords(message.step, waiting), state: 'waiting' })
  }
  return { ok: true, message: { ...message, to: null, state: 'ticked' } }
}
