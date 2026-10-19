// B360: recaps. Every step that passes its result check (B356, directly or through its fix) and every goal that passes
// its re-check (B358) gives the person a recap: a note to them marked `Recap`, About the step or goal, with one line of
// what they get and its evidence picture (`Evidence`). It shows in Needs your attention as information, never as a
// question, and blocks nothing: the step or goal is done already. The person may overturn it (their words go to the
// partner, who makes a fix step from them; a goal is reopened) or give feedback (their words go to the partner); left
// alone, the board approves it RECAP_WINDOW_MS after it showed (the person, Q129, 2026-10-18: "24 hours after it
// shows, whether you looked or not"), and it moves to the closed items.

import { sinceMs, valueOf } from './item.mjs'
import { itemsOf } from './read.mjs'

export const RECAP_WINDOW_MS = 24 * 60 * 60 * 1000
/** What became of a recap: open (it waits out its window), approved (by itself), overturned, or feedback given. */
export const RECAP_STATES = ['open', 'approved', 'overturned', 'feedback']
/** How long a closed recap stays among the closed items. */
const CLOSED_SHOWN_MS = 24 * 60 * 60 * 1000

export const isRecap = item => valueOf(item, 'Kind') === 'note' && valueOf(item, 'Recap') !== null

/** The person's two answers to a recap, and the state each leaves it in. */
export const RECAP_ANSWERS = { overturn: 'overturned', feedback: 'feedback' }

const textOf = item => (item.sections.get('Text') ?? []).filter(one => one.trim() !== '')

/**
 * The recaps for the page: the open ones, and those closed within a day (Show closed), newest first. `title` is the
 * recap's first line ("B12 <title> is done"), `line` what the person gets, `approvesAt` when an open one approves itself.
 */
export function recapsOf(work, now) {
  return itemsOf(work).filter(isRecap).map(item => {
    const id = valueOf(item, 'Id')
    const state = valueOf(item, 'Recap')
    const at = sinceMs(valueOf(item, 'Since'))
    const [title = '', ...rest] = textOf(item)
    const about = (item.sections.get('About') ?? [])[0] ?? null
    return {
      id: `recap:${id}`, workId: id, about, isGoal: /^G\d+$/.test(about ?? ''), title, line: rest.join(' '),
      evidence: valueOf(item, 'Evidence') ?? 'none', state, at: Number.isFinite(at) ? at : null,
      approvesAt: state === 'open' && Number.isFinite(at) ? at + RECAP_WINDOW_MS : null,
      words: (item.sections.get('Answer') ?? []).join(' '), isClosed: state !== 'open',
    }
  }).filter(one => !one.isClosed || (one.at !== null && now - one.at < CLOSED_SHOWN_MS))
    .sort((a, b) => Number(a.isClosed) - Number(b.isClosed) || (b.at ?? 0) - (a.at ?? 0) || b.workId.localeCompare(a.workId, 'en', { numeric: true }))
}

/** The open recaps among `items` whose window has passed at `now`: the board approves them. */
export function dueRecaps(items, now) {
  return [...items].filter(item => isRecap(item) && valueOf(item, 'Recap') === 'open' && now - sinceMs(valueOf(item, 'Since')) >= RECAP_WINDOW_MS)
}
