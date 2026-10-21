// B468: every step gets an effort level at its refine, and the worker that takes it runs at that level. The person,
// 2026-10-21 (I52): "in order to save tokens, i need a task, before it's picked up to evaluate what effort level it
// needs. the worker will adjust to this new effort level". The partner gives the level with a one-line reason at the
// refine (roles/partner.md); a step without one counts as medium. A chat cannot set its own effort (the app refuses
// that), so the board asks the main chat, which sets the worker's chat with the app's set_session_effort
// (roles/main.md), as for the partner's high effort mode (src/partnerEffort.mjs). The app keeps each chat's effort in
// its own file of the chat, so the board sees when it is set. The app applies a new effort from the chat's next turn
// on, so the step's line to the worker waits until it is set, a few minutes at most.

import { blockersOpen } from './guards.mjs'
import { fixFirst, valueOf } from './item.mjs'

/** The levels, lowest first, as the app names them. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
/** A step refined without an effort counts as this one. */
export const DEFAULT_EFFORT = 'medium'
/** A worker's usual level when the board never saw it (the app's file of the chat says it otherwise). */
export const USUAL_EFFORT = 'xhigh'
/** How long a step's line to its worker waits for the worker's effort to be set. */
export const HOLD_MS = 3 * 60_000
/** A word to the main chat for the same level of the same chat goes once in this time, also when it went untaken. */
export const AGAIN_MS = 30 * 60_000
/** The words the page says a level with. */
export const EFFORT_WORDS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max' }

const REASON_MAX = 200
const LEVEL = /^\s*(low|medium|high|xhigh|x-high|extra[\s-]high|max)(?![\w-])/i
const HOLDS = ['taken', 'in progress', 'waiting on you']
const LOST = ['expired', 'failed', 'dropped']

const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const levelOf = word => (/^(?:x-?high|extra[\s-]high)$/i.test(word) ? 'xhigh' : word.toLowerCase())
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}

/**
 * The effort given at a refine, "medium: a board fix in one hook, with tests" (also "medium · ...", "medium (...)"):
 * `{ ok: true, level, why, line }`, `line` as the store keeps it ("medium · a board fix ..."); a refusal `{ ok: false,
 * why }` without a level of the app's or without a reason; null when none was given.
 */
export function parseEffort(given) {
  if (given === undefined || given === null) return null
  const words = String(given).replace(/\s+/g, ' ').trim()
  if (words === '') return null
  const found = words.match(LEVEL)
  if (found === null) return { ok: false, why: `An effort starts with its level, ${EFFORTS.join(', ')}, then its reason in one line ("medium: a board fix in one hook, with tests").` }
  const level = levelOf(found[1])
  const why = words.slice(found[0].length).replace(/^[\s:·,;—–-]+/, '').replace(/^\((.*)\)\.?$/, '$1').trim()
  if (why === '') return { ok: false, why: `Give the effort's reason after its level, in one line ("${level}: a board fix in one hook, with tests").` }
  if (why.length > REASON_MAX) return { ok: false, why: `Keep the effort's reason to one short line: at most ${REASON_MAX} characters, this one has ${why.length}.` }
  return { ok: true, level, why, line: `${level} · ${why}` }
}

/**
 * A step's effort: `{ level, why, isSet }`, from its Effort section, else its refine block's Effort line; a step without
 * one (or with one the board cannot read) counts as medium, `isSet` false.
 */
export function effortOf(item) {
  const own = (item?.sections?.get('Effort') ?? []).map(one => one.trim()).find(Boolean)
  const inBlock = (item?.sections?.get('Refined') ?? []).map(one => one.trim()).find(one => /^Effort:\s*\S/.test(one))
  const read = parseEffort(own ?? inBlock?.replace(/^Effort:\s*/, '') ?? null)
  return read?.ok === true ? { level: read.level, why: read.why, isSet: true } : { level: DEFAULT_EFFORT, why: null, isSet: false }
}

/**
 * The effort out of a call: its `effort`, else (a chat whose work tool has no field effort yet) a line of `what` or of
 * `questions` (a list, or lines in one text) that starts with "Effort:", taken out of that list. The call as it is when
 * it gives none.
 */
export function withEffort(body) {
  if (body.effort !== undefined) return body
  for (const key of ['what', 'questions']) {
    const all = Array.isArray(body[key]) ? body[key] : typeof body[key] === 'string' ? body[key].split('\n') : null
    if (all === null) continue
    const at = all.findIndex(one => /^(?:[-*]\s+)?Effort:\s*\S/i.test(String(one ?? '').trim()))
    if (at < 0) continue
    return { ...body, effort: String(all[at]).trim().replace(/^(?:[-*]\s+)?Effort:\s*/i, ''), [key]: all.filter((one, index) => index !== at) }
  }
  return body
}

/** The newest word that set `chat`'s effort, or undefined. */
export const lastWord = (sent, chat, prefix = '') => sent.findLast(message => message.command === 'worker-effort' && plain(message.about, prefix) === plain(chat, prefix))

/**
 * The word that asks the main chat (`to`) to set `chat`'s effort (its app session `session` when the board knows it)
 * to `level`, for `step` (null: back to its usual level, `usual`), and `why`. One message of the outbox.
 */
export function effortWords({ to, chat, session, level, usual, step, why }) {
  const id = typeof session === 'string' && /^[\w-]{1,80}$/.test(session) ? [`Session: ${session}`] : []
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'worker-effort', about: chat, effort: level, usual, forStep: step,
    text: ['set effort', `Chat: ${chat}`, `Effort: ${level}`, ...id, ...(step === null ? [] : [`Step: ${step}`]), `Why: ${why}`].join('\n'),
  }
}

/**
 * What each worker should run at, and the words to the main chat that set it. `items` the store's items, `lanes` the
 * board's chats (`name`, `isMain`, `isLeftover`, `appSession`, and `effort`: what the app's file of the chat says, or
 * null), `deliveries` the reconciler's lines to free workers, `sent` the outbox, `main` the main chat's name (null: none
 * on the board, so no word), `skip` the names that are no workers (the partner and its helper).
 *
 * A worker runs at the effort of the step it holds, else of the step it gets next (so a report followed by the next
 * step asks once), else at its usual level once a word of the board changed it. The usual level is the one the chat
 * ran at before the board's first word, kept on each word as `usual`, and kept while the chat does not run at it (a
 * word back to it not applied yet, or lost, changes nothing; one lost is sent again). A word goes when the chat does not run at its level and
 * the newest word for the chat is not one for that level of the last half hour; the line of its next step to a worker
 * waits (`held`, also its own pull) while that step's effort is not set and the word for it went less than HOLD_MS
 * ago. A chat whose effort the app's file does not say gets no word: the board could not see it set.
 *
 * `{ words: [{ to, chat, session, level, usual, step, why }], held: Set<step id>, runs: Map<chat, run> }`, `run` for the
 * page: `{ level, usual, step, why, isSet, asked: { at, state } | null }`.
 */
export function effortPlan({ items, lanes = [], deliveries = [], sent = [], now, main = null, prefix = '', skip = [] }) {
  const words = []
  const held = new Set()
  const runs = new Map()
  const steps = [...(items?.values() ?? [])].filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step')
  const owned = (item, name) => plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)
  const others = new Set(skip.map(name => plain(name, prefix)))
  for (const lane of lanes) {
    if (lane.isMain || lane.isLeftover || others.has(plain(lane.name, prefix))) continue
    const holding = steps.find(item => owned(item, lane.name) && HOLDS.includes(valueOf(item, 'State')))
    const delivery = deliveries.find(one => one.chat === lane.name)
    // The step it gets next, in the order its own pull takes them (fix first, then by id).
    const next = holding ?? (delivery === undefined ? undefined : items.get(delivery.id))
      ?? steps.filter(item => owned(item, lane.name) && valueOf(item, 'State') === 'queued' && blockersOpen(item, { store: { items } }).length === 0)
        .sort((a, b) => fixFirst(a, b) || byId(valueOf(a, 'Id'), valueOf(b, 'Id')))[0]
    const last = lastWord(sent, lane.name, prefix)
    const current = typeof lane.effort === 'string' && EFFORTS.includes(lane.effort) ? lane.effort : null
    // The usual level of the board's last word holds while the chat does not run at it; else what it runs at is usual.
    const usual = (last !== undefined && current !== last.usual ? last.usual : current ?? last?.usual) ?? USUAL_EFFORT
    const step = next === undefined ? null : valueOf(next, 'Id')
    const effort = next === undefined ? null : effortOf(next)
    const level = effort?.level ?? usual
    // Back to the usual level only after a word of the board changed it (its last word was for a step, or the word back
    // was lost), and only when it does not run at it: a level the person set by hand later is left alone.
    if (effort === null && (last === undefined || current === null || current === usual || (last.effort === last.usual && !LOST.includes(last.state)))) continue
    const isSet = current === level
    const asked = last !== undefined && last.effort === level && now - last.at < AGAIN_MS ? last : null
    const why = step === null ? `${lane.name} holds no step now: back to its usual level`
      : `${step} is ${holding === undefined ? `${lane.name}'s next step` : `${lane.name}'s step`}; ${effort.isSet ? `its refine says ${level} (${effort.why})` : `its refine gives no effort, so ${level}`}`
    runs.set(lane.name, { level, usual, step, why: effort?.why ?? null, isSet, asked: asked === null ? null : { at: asked.at, state: asked.state } })
    if (isSet || main === null || current === null) continue
    if (asked === null) words.push({ to: main, chat: lane.name, session: lane.appSession ?? null, level, usual, step, why })
    const isWaiting = asked === null || (now - asked.at < HOLD_MS && !LOST.includes(asked.state))
    if (holding === undefined && step !== null && isWaiting) held.add(step)
  }
  return { words, held, runs }
}
