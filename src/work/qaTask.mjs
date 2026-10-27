// T9.1.1 (the person, 2026-10-27: "feels like the current advisor is a bottleneck ... maybe we can create a queue system
// similar to the workers", and "as long as its a worker who didnt build the task and the task title is clear. e.g.
// B123 Quality Assurance ..."): a result check is a task of the store, made by the board like a fix step, handed out
// like any task (first on the ready list) to a worker that did not build the step it checks, and ended by that worker's
// `work checked`. PURE: the helpers the API, the hand-out, the supervisor and the page share. It reads only the items'
// own fields; nothing of the project's work is named here.

import { modelOf } from './effort.mjs'
import { valueOf } from './item.mjs'
import { standardOf } from './standard.mjs'

/** The start of a QA task's title: "Quality Assurance: B701 Show the damage". */
export const QA_PREFIX = 'Quality Assurance: '
/** The most characters of a QA task's title (the store's title limit, api.mjs `make`). */
export const QA_TITLE_CHARS = 200
const CLOSED = ['done', 'dropped']
/** A History line: `- <date time> <who>: <words>`. */
const HISTORY_LINE = /^-\s+\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?\s+(.+?): (.*)$/
/** The words of a History line that say a chat took the step: queued → taken, taken → in progress, claimed (in progress). */
const TOOK = /(?:→ (?:taken|in progress)\b|^claimed \(in progress\))/
/** The board's own take for a chat: "queued → taken (for Worker 3)". */
const TAKEN_FOR = /→ taken \(for (.+?)\)/

/** Whether the item is a Quality Assurance task: its head `Checks` names the step it checks. */
export const isQaTask = item => valueOf(item, 'Checks') !== null

/** The id of the step a QA task checks, or null. */
export const checkedIdOf = item => valueOf(item, 'Checks')

/** The title of the QA task for a step: the form is exact, cut to the store's title limit. */
export const qaTitle = (id, title) => `${QA_PREFIX}${id} ${String(title ?? '').replace(/\s+/g, ' ').trim()}`.slice(0, QA_TITLE_CHARS).trim()

/**
 * The QA task of the step `stepId` that is open (not done, not dropped), or null: the oldest when there are two. `items` is
 * the store's items by id.
 */
export function openQaTaskOf(items, stepId) {
  const open = [...(items?.values() ?? [])].filter(one => isQaTask(one) && valueOf(one, 'Checks') === stepId && !CLOSED.includes(valueOf(one, 'State')))
  return open.sort((a, b) => String(valueOf(a, 'Id')).localeCompare(String(valueOf(b, 'Id')), 'en', { numeric: true }))[0] ?? null
}

/**
 * The chats that built a step: its Owner first, then every chat its History says took it (a move to taken or in progress
 * by the chat itself, the board's take "(for <chat>)", a claim), in the order they did; each once. A chat the step was only
 * given to and taken back from built nothing.
 */
export function buildersOf(item) {
  const names = []
  const add = name => {
    const words = String(name ?? '').trim()
    if (words !== '' && words !== 'server' && words !== 'person' && !names.some(one => one.toLowerCase() === words.toLowerCase())) names.push(words)
  }
  add(valueOf(item, 'Owner'))
  for (const line of item?.sections?.get('History') ?? []) {
    const found = HISTORY_LINE.exec(String(line).trim())
    if (found === null || !TOOK.test(found[2])) continue
    const forChat = TAKEN_FOR.exec(found[2])?.[1]
    add(found[1] === 'server' ? forChat : found[1])
  }
  return names
}

/** The names a QA task is never given to (its `Not by`, names joined with ", "); [] for none. */
export const notByOf = item => String(valueOf(item, 'Not by') ?? '').split(/\s*,\s*/).map(one => one.trim()).filter(Boolean)

/**
 * Whether the checked step's standard judges art against a reference: it names a kind with a reference picture or a target
 * score ("<kind> · <reference picture> · target <score>"); "none (...)" and no standard do not.
 */
function judgesAgainstReference(checked) {
  const standard = standardOf(checked)
  if (standard === null || /^none\b/i.test(standard)) return false
  const [, picture = '', target = ''] = standard.split(/\s*·\s*/).map(part => part.trim())
  return /^target\s+\S/i.test(target) || /^target\s+\S/i.test(picture) || (picture !== '' && !/^target\b/i.test(picture))
}

/**
 * The model and effort of a QA task, as the work tool writes them ("<family>: <why>"): Opus, high when the checked step's
 * standard judges art against a reference or the checked step runs on Opus; else Sonnet, medium.
 */
export function qaModelEffort(checked) {
  const why = judgesAgainstReference(checked) ? 'judges art against its reference' : modelOf(checked).family === 'opus' ? 'checks an Opus step' : null
  return why === null
    ? { model: 'sonnet: a check of routine work', effort: 'medium: a check of routine work' }
    : { model: `opus: ${why}`, effort: `high: ${why}` }
}
