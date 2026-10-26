// B360: recaps. Every step that passes its result check (B356, directly or through its fix) and every goal that passes
// its re-check (B358) gives the person a recap: a note to them marked `Recap`, About the step or goal, with one line of
// what they get and its evidence picture (`Evidence`). It shows in Needs your attention as information, never as a
// question, and blocks nothing: the step or goal is done already. The person may overturn it (their words go to the
// partner, who makes a fix step from them; a goal is reopened) or mark it seen (B390: approved at once, no words); left
// alone, the board approves it RECAP_WINDOW_MS after it showed (the person, Q129, 2026-10-18: "24 hours after it
// shows, whether you looked or not"), and it moves to the closed items.

import { sinceMs, valueOf } from './item.mjs'
import { itemsOf } from './read.mjs'
import { CHANGE_CHARS, CONTEXT_CHARS, checkedCount, headingOf, isBeforeAfter, plainFaults, recapParts } from './recapWords.mjs'

export const RECAP_WINDOW_MS = 24 * 60 * 60 * 1000
/**
 * What became of a recap: open (it waits out its window), approved (by itself), seen (approved by the person, B390),
 * overturned, or feedback given (the person's second answer before B390, still read on older recaps).
 */
export const RECAP_STATES = ['open', 'approved', 'seen', 'overturned', 'feedback']
/** How long a closed recap stays among the closed items. */
const CLOSED_SHOWN_MS = 24 * 60 * 60 * 1000

export const isRecap = item => valueOf(item, 'Kind') === 'note' && valueOf(item, 'Recap') !== null

/** The person's two answers to a recap, and the state each leaves it in (B390: Overturn with words, OK, seen without). */
export const RECAP_ANSWERS = { overturn: 'overturned', seen: 'seen' }

const textOf = item => (item.sections.get('Text') ?? []).filter(one => one.trim() !== '')

/**
 * B569: a recap's card words: `heading` (the step's or goal's title), `context`, `change` and `checked` ("5 of 5" or
 * null), and its picture. A recap made before B569 (no `Points pass` section) is read in the same form from its step's
 * record (recapWords.mjs `recapParts`), its points picture dropped: only a Before | After stays.
 */
function cardOf(item, title, about, items) {
  const heading = headingOf(title, about)
  // B591: only a Before | After picture shows, also on a recap made since B569 from a check with a points picture.
  const evidence = isBeforeAfter(valueOf(item, 'Evidence')) ? valueOf(item, 'Evidence') : 'none'
  const said = name => (item.sections.get(name) ?? []).join(' ').trim()
  if (item.sections.has('Points pass')) {
    const checked = said('Points pass')
    return { heading, context: said('Context'), change: said('Change'), checked: checked === '' || checked === 'none' ? null : checked, evidence }
  }
  const step = about === null ? undefined : items.get(about)
  const old = step === undefined || valueOf(step, 'Kind') !== 'step' ? { context: '', change: '', checked: null } : recapParts(step, items)
  // An old goal's recap: its count stands in its line ("..., 5 of 6 points pass").
  const counted = textOf(item).join(' ').match(/\b(\d+) of (\d+) points pass\b/)
  return { heading, ...old, checked: old.checked ?? (counted === null ? null : `${counted[1]} of ${counted[2]}`), evidence }
}

/**
 * The recaps for the page: the open ones, and those closed within a day (Show closed), newest first. `title` is the
 * recap's first line ("B12 <title> is done"), `line` what the person gets, `approvesAt` when an open one approves itself.
 * B569: the card's words (`cardOf`), and `checkedLink`, the place its points stand on the board.
 */
export function recapsOf(work, now) {
  const items = work?.items instanceof Map ? work.items : new Map()
  return itemsOf(work).filter(isRecap).map(item => {
    const id = valueOf(item, 'Id')
    const state = valueOf(item, 'Recap')
    const at = sinceMs(valueOf(item, 'Since'))
    const [title = '', ...rest] = textOf(item)
    const about = (item.sections.get('About') ?? [])[0] ?? null
    const isGoal = /^G\d+$/.test(about ?? '')
    return {
      id: `recap:${id}`, workId: id, about, isGoal, title, line: rest.join(' '), ...cardOf(item, title, about, items),
      checkedLink: about === null ? null : isGoal ? `#advice/goals/${about}` : `#details=${about}`, state, at: Number.isFinite(at) ? at : null,
      approvesAt: state === 'open' && Number.isFinite(at) ? at + RECAP_WINDOW_MS : null,
      words: (item.sections.get('Answer') ?? []).join(' '), isClosed: state !== 'open',
    }
  }).filter(one => !one.isClosed || (one.at !== null && now - one.at < CLOSED_SHOWN_MS))
    .sort((a, b) => Number(a.isClosed) - Number(b.isClosed) || (b.at ?? 0) - (a.at ?? 0) || b.workId.localeCompare(a.workId, 'en', { numeric: true }))
}

/**
 * B591: a recap with its card words written anew (tools/recap-words.mjs), for a card whose words were cut from an old
 * report: `context`, `change` and, when the step's title reads as jargon, a plain `title`. The words must read as a
 * worker's report must (plain, no ids, within the limits); its `Points pass` stays, or comes from its step. Returns
 * `{ ok, item }` or `{ ok: false, why }`.
 */
export function rewriteRecap(note, { title = null, context, change }, step) {
  if (!isRecap(note)) return { ok: false, why: `${valueOf(note, 'Id')} is no recap` }
  const faults = [
    ...[['Context', context, CONTEXT_CHARS], ['Change', change, CHANGE_CHARS]].flatMap(([name, words, most]) => [
      ...(typeof words !== 'string' || words.trim() === '' ? [`no ${name}`] : []),
      ...(String(words ?? '').length > most ? [`the ${name} is over ${most} characters`] : []),
      ...plainFaults(name, String(words ?? '')),
    ]),
    ...(title === null ? [] : plainFaults('title', String(title))),
  ]
  if (faults.length > 0) return { ok: false, why: `${valueOf(note, 'Id')}: ${faults.join('; ')}` }
  const about = (note.sections.get('About') ?? [])[0] ?? ''
  const [first = '', ...rest] = textOf(note)
  const heading = title === null ? first : `${about} ${title.trim()} is done`
  const counted = rest.join(' ').match(/\b(\d+) of (\d+) points pass\b/)
  const checked = (note.sections.get('Points pass') ?? [])[0] ?? (step === undefined ? null : checkedCount(step)) ?? (counted === null ? null : `${counted[1]} of ${counted[2]}`) ?? 'none'
  const text = [heading, change.trim()]
  const sections = new Map([['Text', text], ['Context', [context.trim()]], ['Change', [change.trim()]], ['Points pass', [checked]]])
  for (const [name, lines] of note.sections) if (!sections.has(name)) sections.set(name, lines)
  const head = new Map(note.head)
  head.set('Text', text.join(': ').slice(0, 300))
  return { ok: true, item: { ...note, head, sections } }
}

const STAMP = /^- (\d{4}-\d\d-\d\d \d\d:\d\d)/
const stampMs = line => {
  const found = STAMP.exec(line ?? '')
  return found === null ? Number.NaN : sinceMs(found[1])
}
/** When the step was last reported (its last move to review, or "reported again"), NaN if never. */
const reportedAt = step => stampMs((step.sections.get('History') ?? []).findLast(line => / → review\b|: reported again\b/.test(line)))

/** The review: whether a recap of step `step` was made since its last report (it gets one recap per report). */
export function recapMadeSince(items, step) {
  const id = valueOf(step, 'Id')
  const since = reportedAt(step)
  return [...items.values()].some(item => isRecap(item) && (item.sections.get('About') ?? [])[0] === id
    && !(stampMs((item.sections.get('History') ?? [])[0]) < since))
}

/** The open recaps among `items` whose window has passed at `now`: the board approves them. */
export function dueRecaps(items, now) {
  return [...items].filter(item => isRecap(item) && valueOf(item, 'Recap') === 'open' && now - sinceMs(valueOf(item, 'Since')) >= RECAP_WINDOW_MS)
}
