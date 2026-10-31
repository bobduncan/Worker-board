// B860: the person's feedback on a goal demo, inside its popup. Each part (a row of the demo) gets Approve or Send back with a
// comment; one Send keeps the round beside the demo (`feedback.json` next to its demo.json), writes the words on the demo's
// step and tells the partner which parts came back. The next round of the popup shows only the parts that were sent back (with
// the person's comment beside the new try) or not decided yet; approved parts fold into one line. PURE: the files are read and
// written by src/pictures.mjs, the words are sent by server.mjs.
//
//   feedback.json: { "rounds": [ { "n": 1, "at": "2026-10-31 12:40", "parts": [ { "key": "5. Round shapes", "verdict": "sent-back", "comment": "still stepped" } ] } ] }

/** The file beside a demo.json that keeps the person's rounds. */
export const FEEDBACK_FILE = 'feedback.json'
export const VERDICTS = ['approved', 'sent-back']
/** The most characters of one comment. */
export const COMMENT_CHARS = 1000
/** The most a feedback.json may weigh. */
export const FEEDBACK_BYTES = 256 * 1024

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

/** Every row of a page, in order: `{ key, title, section }`. */
export const rowsOf = page => page.sections.flatMap((section, at) => section.rows.map(row => ({ key: row.key, title: row.title, section: at })))

/**
 * The page the popup draws for the round the person answers now: round 1 is the whole demo; after that only the rows sent back or not
 * decided yet, each sent-back row with the person's comment (`said`), no follow-up and no section left without a row. `feedback`
 * holds the round to answer (`round`), the folded approved parts and whether every part is approved (`done`). Pure.
 */
export function roundPage(page, input) {
  const rounds = roundsOf(input)
  const all = rowsOf(page)
  const stand = standOf(rounds)
  const approved = all.filter(row => stand.get(row.key)?.verdict === 'approved')
  const folded = approved.map(row => ({ key: row.key, title: row.title }))
  const done = all.length > 0 && approved.length === all.length
  if (rounds.length === 0) return { ...page, feedback: { round: 1, folded, done: false, parts: all.length, sent: [] } }
  const sections = page.sections
    .map(section => ({ ...section, rows: section.rows.filter(row => stand.get(row.key)?.verdict !== 'approved').map(row => (stand.get(row.key)?.verdict === 'sent-back' ? { ...row, said: { comment: stand.get(row.key).comment, round: stand.get(row.key).round } } : row)) }))
    .filter(section => section.rows.length > 0)
  return { ...page, sections, followUp: null, feedback: { round: done ? rounds.length : rounds.length + 1, folded, done, parts: all.length, sent: rounds.map(round => ({ n: round.n, at: round.at })) } }
}

/**
 * The person's Send, checked against the page of the round: `{ ok: true, round, parts }` or `{ ok: false, status, why }`. `body`:
 * `{ round, parts: [{ key, verdict, comment }] }`. A part the demo does not show, a verdict that is neither, a part sent back without
 * a comment (the partner needs to know what to change), the same part twice, nothing at all, a round that was sent already: all refused.
 */
export function checkSend(page, body) {
  const refuse = (status, why) => ({ ok: false, status, why })
  const now = page.feedback?.round
  if (page.feedback?.done === true) return refuse(409, 'Every part of this demo is approved already: nothing more to send.')
  if (!Number.isInteger(body?.round) || body.round !== now) return refuse(409, `This round was sent already or is out of date (the demo is at round ${now}): reload the demo.`)
  if (!Array.isArray(body.parts) || body.parts.length === 0) return refuse(400, 'Say something about at least one part: Approve or Send back.')
  const shown = new Map(rowsOf(page).map(row => [row.key, row.title]))
  const seen = new Set()
  const parts = []
  for (const part of body.parts) {
    const key = typeof part?.key === 'string' ? part.key : ''
    if (!shown.has(key)) return refuse(400, `The demo shows no part "${oneLine(key, 80)}" in this round.`)
    if (seen.has(key)) return refuse(400, `The part "${shown.get(key)}" is in the answer twice.`)
    if (!VERDICTS.includes(part.verdict)) return refuse(400, `The part "${shown.get(key)}": the answer is approved or sent-back.`)
    const comment = oneLine(part.comment, COMMENT_CHARS)
    if (part.verdict === 'sent-back' && comment === '') return refuse(400, `The part "${shown.get(key)}" is sent back without a comment: say what to change.`)
    seen.add(key)
    parts.push({ key, verdict: part.verdict, comment })
  }
  return { ok: true, round: now, parts }
}

/** The feedback file's content with one more round (`at`: "YYYY-MM-DD HH:MM"). */
export const withRound = (input, round, parts, at) => ({ rounds: [...roundsOf(input), { n: round, at, parts }] })

/** The parts of a round as lines of the person's words (one line per part) and the titles sent back, for the step and the partner. */
export function wordsOfRound(page, round, parts) {
  const title = new Map(rowsOf(page).map(row => [row.key, row.title]))
  const approved = parts.filter(part => part.verdict === 'approved')
  const back = parts.filter(part => part.verdict === 'sent-back')
  const left = rowsOf(page).filter(row => !parts.some(part => part.key === row.key)).length
  return {
    approved: approved.map(part => title.get(part.key)),
    back: back.map(part => ({ title: title.get(part.key), comment: part.comment })),
    lines: [
      `Recap feedback, round ${round}: ${approved.length} approved, ${back.length} sent back${left > 0 ? `, ${left} not decided yet` : ''}.`,
      ...(approved.length === 0 ? [] : [`Approved: ${approved.map(part => title.get(part.key)).join('; ')}.`]),
      ...back.map(part => `Sent back: ${title.get(part.key)}: "${part.comment}"`),
    ],
  }
}

/** A moment as the store writes it: "YYYY-MM-DD HH:MM" in the PC's time. */
export function stampOf(at) {
  const day = new Date(at)
  const two = value => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())} ${two(day.getHours())}:${two(day.getMinutes())}`
}
