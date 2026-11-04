// B860: the person's feedback on a goal demo, inside its popup. Each part (a row of the demo) gets Approve or Send back with a
// comment; one Send keeps the round beside the demo (`feedback.json` next to its demo.json), writes the words on the demo's
// step and tells the partner which parts came back. The next round of the popup shows only the parts that were sent back (with
// the person's comment beside the new try) or not decided yet; approved parts fold into one line. PURE: the files are read and
// written by src/pictures.mjs, the words are sent by server.mjs.
//
// T17.1 (the person, 2026-11-02, after sending round 1 of G60's recap: "the new recap, after round 1 is not finetuned to my feedback.
// the same pictures are provided and i see no evidence of what i asked it to fix/change"): after a Send that sent rows back, the
// next round is "being made" until demo.json was written again (`makingOf`); in it every row sent back shows what changed
// (`changed`) beside pictures newer than the Send, or says it is still being reworked (`pending`); a row may carry a map to play.
//
//   feedback.json: { "rounds": [ { "n": 1, "at": "2026-10-31 12:40", "parts": [ { "key": "5. Round shapes", "verdict": "sent-back", "comment": "still stepped" } ] } ] }

import { sinceMs } from './work/item.mjs'

/** The file beside a demo.json that keeps the person's rounds. */
export const FEEDBACK_FILE = 'feedback.json'
export const VERDICTS = ['approved', 'sent-back']
/** The most characters of one comment. */
export const COMMENT_CHARS = 1000
/** The most a feedback.json may weigh. */
export const FEEDBACK_BYTES = 256 * 1024
/** A Send is stamped to its minute: a file written in a later minute holds what was made after it. */
export const SEND_MINUTE_MS = 60_000

const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** The rounds of a feedback.json as read; anything else is no feedback yet. */
export function roundsOf(input) {
  if (input === null || typeof input !== 'object' || !Array.isArray(input.rounds)) return []
  return input.rounds
    .filter(round => round !== null && typeof round === 'object' && Array.isArray(round.parts))
    .map((round, at) => ({
      n: at + 1,
      at: oneLine(round.at, 20),
      parts: round.parts
        .filter(part => typeof part?.key === 'string' && VERDICTS.includes(part.verdict))
        .map(part => ({ key: part.key, verdict: part.verdict, comment: oneLine(part.comment, COMMENT_CHARS) })),
    }))
}

/** What the person said last about each part: `Map(key → { verdict, comment, round })`; a later round wins. */
export function standOf(rounds) {
  const stand = new Map()
  for (const round of rounds) for (const part of round.parts) stand.set(part.key, { verdict: part.verdict, comment: part.comment, round: round.n })
  return stand
}

/** Whether a file written at `writtenAt` (ms) holds what was made after the Send at `sentAt` (ms): written in a later minute than the Send. */
export const isAfterSend = (writtenAt, sentAt) => Number.isFinite(writtenAt) && Number.isFinite(sentAt) && writtenAt >= sentAt + SEND_MINUTE_MS

/**
 * T17.1: round N+1 is being made after a Send that sent rows back, until the demo was written again in a later minute than that Send
 * (`changedAt`, ms: when demo.json was last written; not a number: not written since). `{ round, at }` (`at`: the Send, ms) or null: the
 * last round sent nothing back (no new try is owed), or its time cannot be read.
 */
export function makingOf(rounds, changedAt) {
  const last = Array.isArray(rounds) ? rounds.at(-1) : undefined
  if (last === undefined || !last.parts.some(part => part.verdict === 'sent-back')) return null
  const at = sinceMs(last.at)
  return Number.isFinite(at) && !isAfterSend(changedAt, at) ? { round: last.n + 1, at } : null
}

/** Whether a row (of the page model) says what changed for the person's words. */
export const hasChanged = row => typeof row?.changed === 'string' && row.changed.trim() !== ''
/** Whether a row (of the page model) says its new try is not in yet. */
export const isPending = row => typeof row?.pending === 'string' && row.pending.trim() !== ''

/** Every row of a page, in order: `{ key, title, section, steps, reworking }` (B878: the steps the part shows, [] for none; T17.1: whether its new try is not in yet). */
export const rowsOf = page => page.sections.flatMap((section, at) => section.rows.map(row => ({ key: row.key, title: row.title, section: at, steps: row.steps ?? [], reworking: row.reworking === true })))

/** One look kept for the recap as the popup draws it (T20.1): `looks` of `roundPage`'s options, cleaned: its key, title, words, pictures and play link. */
const lookOf = look => ({
  key: String(look.key), ask: String(look.ask ?? ''), title: oneLine(look.title, 300), text: String(look.text ?? '').trim(),
  pictures: (Array.isArray(look.pictures) ? look.pictures : []).filter(path => typeof path === 'string' && path !== '').map(path => ({ path, caption: path.split('/').at(-1) })),
  play: typeof look.play === 'string' && look.play !== '' ? look.play : null,
})

/**
 * The page the popup draws for the round the person answers now: round 1 is the whole demo; after that only the rows sent back or not
 * decided yet, each sent-back row with the person's comment (`said`), no follow-up and no section left without a row. `feedback`
 * holds the round to answer (`round`), the folded approved parts, whether every part is approved (`done`), how many rows can be
 * answered now (`answerable`) and whether the round is being made (`making`, T17.1). `options.changedAt` is when demo.json was last
 * written (ms); without it the page does not know (a test, a caller with no file) and never says "being made".
 *
 * T17.1: while the round is being made the page holds only the rows the last Send sent back, each as `reworking` with no picture, no
 * note and no controls to answer; after the partner wrote the demo again a sent-back row that carries `pending`, or that has no `changed`
 * line, is `reworking` too (its new try is not in, whatever the file's time says), one that has is the new try (its `changed` line and
 * pictures). Pure.
 *
 * T20.1 (the person, 2026-11-04: "These numbers are all over the place and non consistent"): `options.rework`, `Map(row key → { step,
 * worker })` (src/recapRound.mjs): a row whose steps, or a fix in their chains, are under way is `reworking` with that `rework` and asks
 * nothing, in any round. `options.looks`: the kept looks of the goal (src/recapRound.mjs `keptLooksOf`), the page's `looks`, rows of the
 * round in a section of their own (none while the round is being made). `feedback.toJudge`: the rows that can be answered plus the
 * looks, the one number the popup's head and the cards carry.
 */
export function roundPage(page, input, options = {}) {
  const rounds = roundsOf(input)
  const all = rowsOf(page)
  const stand = standOf(rounds)
  const approved = all.filter(row => stand.get(row.key)?.verdict === 'approved')
  const folded = approved.map(row => ({ key: row.key, title: row.title }))
  const done = all.length > 0 && approved.length === all.length
  const rework = options.rework instanceof Map ? options.rework : new Map()
  const reworked = row => ({ ...row, note: '', pictures: [], changed: null, play: null, reworking: true })
  // A row a step of which is under way in the store is being reworked, whatever the file says: nothing more is done on it yet.
  const underWay = row => (rework.has(row.key) ? { ...reworked(row), rework: rework.get(row.key) } : row)
  const looksOf = making => (making === null && Array.isArray(options.looks) ? options.looks.filter(look => typeof look?.key === 'string').map(lookOf) : [])
  const countOf = (sections, looks) => {
    const answerable = sections.flatMap(section => section.rows).filter(row => row.reworking !== true).length
    return { answerable, looks: looks.length, toJudge: answerable + looks.length }
  }
  if (rounds.length === 0) {
    const sections = page.sections.map(section => ({ ...section, rows: section.rows.map(underWay) }))
    const looks = looksOf(null)
    return { ...page, sections, looks, feedback: { round: 1, folded, done: false, parts: all.length, ...countOf(sections, looks), making: null, sent: [] } }
  }
  const making = options.changedAt === undefined ? null : makingOf(rounds, options.changedAt)
  const last = rounds.at(-1)
  const sections = page.sections
    .map(section => ({
      ...section,
      rows: section.rows.flatMap(row => {
        const said = stand.get(row.key)
        if (said?.verdict === 'approved') return []
        if (said?.verdict !== 'sent-back') return making === null ? [underWay(row)] : []
        // Being made: only what the last Send sent back, without the old try.
        if (making !== null) return said.round === last.n ? [{ ...reworked(row), pending: null, said: { comment: said.comment, round: said.round } }] : []
        const kept = { ...row, said: { comment: said.comment, round: said.round } }
        // A row sent back is the new try only when its row says what changed (and is not pending): a demo.json written by hand, with the old
        // pictures and no `changed` line, never passes for one, whatever the file's time (the coordinator's review of 6f197a4).
        return [rework.has(row.key) ? { ...reworked(kept), rework: rework.get(row.key) } : hasChanged(row) && !isPending(row) ? kept : reworked(kept)]
      }),
    }))
    .filter(section => section.rows.length > 0)
  const looks = looksOf(making)
  return {
    ...page, sections, looks, followUp: null,
    feedback: { round: done ? rounds.length : rounds.length + 1, folded, done, parts: all.length, ...countOf(sections, looks), making: making === null ? null : { round: making.round }, sent: rounds.map(round => ({ n: round.n, at: round.at })) },
  }
}

/**
 * The person's Send, checked against the page of the round: `{ ok: true, round, parts, looks }` or `{ ok: false, status, why }`. `body`:
 * `{ round, parts: [{ key, verdict, comment }] }`. A part the demo does not show, a verdict that is neither, a part sent back without
 * a comment (the partner needs to know what to change), the same part twice, nothing at all, a round that was sent already: all refused.
 * T20.1: a part keyed `look:<ask>` is a look kept for the recap (the page's `looks`): it is answered the same way (approved or sent back
 * with a comment) and comes back in `looks` (`[{ ask, verdict, comment }]`), not in `parts`: the rounds of feedback.json hold the rows only.
 */
export function checkSend(page, body) {
  const refuse = (status, why) => ({ ok: false, status, why })
  const now = page.feedback?.round
  const looks = Array.isArray(page.looks) ? page.looks : []
  if (page.feedback?.done === true && looks.length === 0) return refuse(409, 'Every part of this demo is approved already: nothing more to send.')
  if (page.feedback?.making) return refuse(409, `Round ${now} is being made: your partner is building the next tries. There is nothing to send until they are in.`)
  if (!Number.isInteger(body?.round) || body.round !== now) return refuse(409, `This round was sent already or is out of date (the demo is at round ${now}): reload the demo.`)
  if (!Array.isArray(body.parts) || body.parts.length === 0) return refuse(400, 'Say something about at least one part: Approve or Send back.')
  const shown = new Map([...rowsOf(page).map(row => [row.key, row.title]), ...looks.map(look => [look.key, look.title])])
  // T17.1: a part whose new try is not in yet (`pending`) is shown, but is no part of this Send.
  const reworking = new Set(rowsOf(page).filter(row => row.reworking).map(row => row.key))
  const isLook = new Set(looks.map(look => look.key))
  const seen = new Set()
  const parts = []
  const answered = []
  for (const part of body.parts) {
    const key = typeof part?.key === 'string' ? part.key : ''
    if (!shown.has(key)) return refuse(400, `The demo shows no part "${oneLine(key, 80)}" in this round.`)
    if (reworking.has(key)) return refuse(400, `The part "${shown.get(key)}" is being reworked: there is nothing to answer yet.`)
    if (seen.has(key)) return refuse(400, `The part "${shown.get(key)}" is in the answer twice.`)
    if (!VERDICTS.includes(part.verdict)) return refuse(400, `The part "${shown.get(key)}": the answer is approved or sent-back.`)
    const comment = oneLine(part.comment, COMMENT_CHARS)
    if (part.verdict === 'sent-back' && comment === '') return refuse(400, `The part "${shown.get(key)}" is sent back without a comment: say what to change.`)
    seen.add(key)
    if (isLook.has(key)) answered.push({ ask: looks.find(look => look.key === key).ask, verdict: part.verdict, comment })
    else parts.push({ key, verdict: part.verdict, comment })
  }
  return { ok: true, round: now, parts, looks: answered }
}

/** The feedback file's content with one more round (`at`: "YYYY-MM-DD HH:MM"). */
export const withRound = (input, round, parts, at) => ({ rounds: [...roundsOf(input), { n: round, at, parts }] })

/**
 * The parts of a round as lines of the person's words (one line per part) and the titles sent back, for the step and the partner.
 * B878: each part sent back with the steps it shows (`steps`), and the steps of every part approved (`closes`).
 */
export function wordsOfRound(page, round, parts) {
  const title = new Map(rowsOf(page).map(row => [row.key, row.title]))
  const steps = new Map(rowsOf(page).map(row => [row.key, row.steps]))
  const named = key => (steps.get(key)?.length > 0 ? ` (${steps.get(key).join(', ')})` : '')
  const approved = parts.filter(part => part.verdict === 'approved')
  const back = parts.filter(part => part.verdict === 'sent-back')
  const left = rowsOf(page).filter(row => !parts.some(part => part.key === row.key)).length
  return {
    approved: approved.map(part => title.get(part.key)),
    back: back.map(part => ({ title: title.get(part.key), comment: part.comment, steps: steps.get(part.key) ?? [] })),
    closes: [...new Set(approved.flatMap(part => steps.get(part.key) ?? []))],
    lines: [
      `Recap feedback, round ${round}: ${approved.length} approved, ${back.length} sent back${left > 0 ? `, ${left} not decided yet` : ''}.`,
      ...(approved.length === 0 ? [] : [`Approved: ${approved.map(part => title.get(part.key)).join('; ')}.`]),
      ...back.map(part => `Sent back: ${title.get(part.key)}${named(part.key)}: "${part.comment}"`),
    ],
  }
}

/** A moment as the store writes it: "YYYY-MM-DD HH:MM" in the PC's time. */
export function stampOf(at) {
  const day = new Date(at)
  const two = value => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())} ${two(day.getHours())}:${two(day.getMinutes())}`
}
