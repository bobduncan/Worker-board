// B110: the one thing the board writes outside its own data folder: a tick in the backlog, when the person approves
// a step whose work is merged already. No chat has to be woken for that. Everything else stays with the chats: a
// rejection, an approval of work whose branch is still open, an answer to a question.
//
// Only the board that delivers writes (the one in the repository's main folder); a copy and the demo never do.

import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'

import { parseBacklog } from './backlog.mjs'

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

const pad = value => String(value).padStart(2, '0')

/**
 * The line written under a step the person approved, or marked done (`verdict`): when, and their note when they
 * gave one. The note is kept to one line; it is sent to nobody.
 */
export function approvalLine(now, note = '', verdict = 'approve') {
  const at = new Date(now)
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} at ${pad(at.getHours())}:${pad(at.getMinutes())}`
  const words = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_CHARS)
  return `${verdict === 'done' ? 'Done' : 'Approved'} by you on the worker board on ${when}${words === '' ? '.' : `: ${words}`}`
}

/**
 * Where the person's approval of a backlog step goes (and their "Done" on a step only they could do). `tick`: the board ticks it, because its work is merged: the
 * step names no branch, or main, or a branch that is in none of the repositories any more. `worker`: its branch is
 * still there, so the worker merges; or the board cannot tell (`branches` is null: git did not answer), and then
 * the approval goes to the worker as before, never lost. `branches` are the local branches of the repositories
 * the board knows.
 */
export function approvalRoute(branch, branches) {
  if (branch === null || branch === undefined || branch === 'main') return 'tick'
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let before
    try {
      before = (await fs.readFile(file)).toString('latin1')
    } catch {
      return { ok: false, why: 'gone' }
    }
    const ticked = tickStep(before, id, added)
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
  if (approvalRoute(item.branch, await branchesNow().catch(() => null)) !== 'tick') return null
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
