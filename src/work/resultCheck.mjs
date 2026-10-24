// B356: the result check before "done". A step with agreed points (its "What we build") or a Standard line is done
// only after a helper that did not build it checked the result: the partner files it with the work tool's `checked`
// (the evidence picture, every agreed point pass, fail or ask, the score). It reads only the step's own points and its
// standard; nothing of the project's work is named here.

import { sinceMs, valueOf } from './item.mjs'
import { standardOf } from './standard.mjs'

const VERDICTS = ['pass', 'fail', 'ask']
const HISTORY_TIME = /^-\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+/

/**
 * Whether a step needs the result check: it has agreed points ("What we build", "Not in it" lines left out) or a
 * Standard line that is not "none (...)".
 */
export function needsResultCheck(item) {
  const points = (item?.sections?.get('What we build') ?? []).map(one => one.replace(/^\s*[-*]\s+/, '').trim()).filter(one => one !== '' && !/^Not in it\b/i.test(one))
  const standard = standardOf(item)
  return points.length > 0 || (standard !== null && !/^none\b/i.test(standard))
}

/**
 * The points of a `checked`: each "pass: <point>", "fail: <point>" or "ask: <point>" (a point only the person can
 * judge). `{ ok: true, points: [{ verdict, text }] }`, or `{ ok: false, why }`.
 */
export function parsePoints(value) {
  const all = (Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : []).filter(one => typeof one === 'string' && one.trim() !== '')
  if (all.length === 0) return { ok: false, why: 'Give every agreed point in "points", each "pass: <point>", "fail: <point>" or "ask: <point>".' }
  const points = []
  for (const one of all.slice(0, 30)) {
    const found = one.trim().replace(/^[-*]\s+/, '').match(/^(\w+)\s*[:–-]\s*(.+)$/)
    const verdict = found?.[1].toLowerCase()
    if (found === null || !VERDICTS.includes(verdict)) return { ok: false, why: `"${one.trim().slice(0, 60)}" is no point: write "pass: <point>", "fail: <point>" or "ask: <point>".` }
    // B381: a point is kept whole (a long one up to 4000 characters), so its fix step carries all of it.
    points.push({ verdict, text: found[2].replace(/\s+/g, ' ').trim().slice(0, 4000) })
  }
  return { ok: true, points }
}

/**
 * The words of a History line ("- <date time> <who>: <words>"): what follows the first ": " after the time. The
 * second review: only there, so free words further on ("no longer waits for: result check passed") never count; a
 * chat whose name holds a ":" is not read, which fails safe (its step waits).
 */
const wordsOf = line => line.replace(HISTORY_TIME, '').match(/^.*?:\s(.*)$/)?.[1] ?? ''
const historyOf = item => item?.sections?.get('History') ?? []
const RESULT = /^result check (?:passed|failed|waits)\b/
/** A report's History line: a move to review, or "reported again". */
const REPORTED = /^(?:\S[^:]* → review\b|reported again\b)/

/** The words of the step's History since its last report: a report anew asks for a check anew (the review). */
function sinceReport(item) {
  const words = historyOf(item).map(wordsOf)
  return words.slice(Math.max(0, words.findLastIndex(one => REPORTED.test(one))))
}

/** The step's last result check line since its last report, or undefined. */
const lastResult = item => sinceReport(item).filter(one => RESULT.test(one)).at(-1)

/**
 * Where the step's last result check since its last report stands: 'passed', 'failed', 'waits' (for the person), or
 * null (none yet).
 */
export function resultCheckOf(item) {
  const last = lastResult(item)
  return last === undefined ? null : last.startsWith('result check passed') ? 'passed' : last.startsWith('result check failed') ? 'failed' : 'waits'
}

/** When the step's last result check line was written (ms), or NaN: the History line's own minute. */
export function resultCheckAtMs(item) {
  const line = historyOf(item).filter(one => RESULT.test(wordsOf(one))).at(-1)
  return line === undefined ? Number.NaN : sinceMs(line.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1])
}

/**
 * B449: how the person's answer to a check's ask point reads: 'yes' (Approved, Done, yes, keep it ...), 'no' (Rejected,
 * no, redo ...), or null when the board cannot tell: their own words, or a yes with a "but" in it. `text` is the
 * answer's lines as the store keeps them ("Approved. words", or the words alone).
 */
export function answerReading(text) {
  const words = String(Array.isArray(text) ? text.join(' ') : text ?? '').trim()
  if (/^(?:rejected|reject|no|nope|redo|not good)\b/i.test(words)) return 'no'
  if (/^(?:approved|done|yes|yep|ok|okay|keep(?: it)?|accepted|accept|agreed|good|fine)\b/i.test(words)) return /\b(?:but|however|except|although)\b/i.test(words) ? null : 'yes'
  return null
}

/** Whether the board's own check (git) passed last: its History's last "check passed", "failed" or "pending". */
export function gitCheckPassed(item) {
  const last = historyOf(item).map(wordsOf).filter(one => /^check (?:passed|failed|pending)\b/.test(one)).at(-1)
  return last !== undefined && last.startsWith('check passed')
}

/** The steps of the store (`items`) made as fixes of the step `id`. */
export const fixesOf = (id, items) => [...(items?.values() ?? [])].filter(one => valueOf(one, 'Kind') === 'step' && valueOf(one, 'Fix of') === id)

/**
 * The review of B356: a step whose result check failed counts as checked once the fix that check made is done, and no
 * point of the check waits for the person. The second review: only that fix, named in the check's own line ("fix B<n>
 * for ..."), so a fix of an earlier round counts for nothing; a dropped one counts for nothing either.
 */
export function fixesThrough(item, items) {
  if (resultCheckOf(item) !== 'failed' || (checkedOf(item)?.points ?? []).some(one => one.verdict === 'ask')) return false
  const fix = lastResult(item).match(/; fix (B\d+) for\b/)?.[1]
  const made = fix === undefined ? undefined : items?.get(fix)
  return made !== undefined && valueOf(made, 'Fix of') === valueOf(item, 'Id') && valueOf(made, 'State') === 'done'
}

/**
 * The step's last result check as its "## Checked" section keeps it: `{ evidence, score, points: [{ verdict, text }],
 * passed, total }`, or null when it has none.
 */
export function checkedOf(item) {
  const lines = (item?.sections?.get('Checked') ?? []).map(one => one.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const named = name => lines.find(one => one.startsWith(`${name}: `))?.slice(name.length + 2) ?? null
  const points = lines.flatMap(one => {
    const found = one.match(/^-\s+(pass|fail|ask):\s+(.+)$/)
    return found === null ? [] : [{ verdict: found[1], text: found[2] }]
  })
  return { evidence: named('Evidence'), score: named('Score'), points, passed: points.filter(one => one.verdict === 'pass').length, total: points.length }
}

/** A fix step's title: "Fix: <the failed points in a few words>", no brackets at its end, at most about 100 characters. */
export function fixTitle(failed) {
  const words = failed.map(one => one.text.replace(/\s*\([^()]*\)\s*$/, '').trim()).filter(Boolean).join('; ')
  const cut = words.length <= 100 ? words : `${words.slice(0, 100).replace(/\s+\S*$/, '')}…`
  return `Fix: ${cut.replace(/[\s.;,:]+$/, '')}`
}
