// B356: the result check before "done". A step with agreed points (its "What we build") or a Standard line is done
// only after a helper that did not build it checked the result: the partner files it with the work tool's `checked`
// (the evidence picture, every agreed point pass, fail or ask, the score). It reads only the step's own points and its
// standard; nothing of the project's work is named here.

import { valueOf } from './item.mjs'
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
    points.push({ verdict, text: found[2].replace(/\s+/g, ' ').trim().slice(0, 300) })
  }
  return { ok: true, points }
}

/**
 * The words that follow who wrote a History line ("- <date time> <who>: <words>"), found by what they say, so a
 * chat whose name holds a ":" is read right (the review).
 */
const said = (line, pattern) => line.replace(HISTORY_TIME, '').match(new RegExp(`(?:^|:\\s)(${pattern.source})`))?.[1] ?? null
const historyOf = item => item?.sections?.get('History') ?? []
const RESULT = /result check (?:passed|failed|waits)\b/
/** A report's History line: its move to review, or "reported again". */
const REPORTED = /(?:^|:\s)(?:in progress → review|reported again)\s*$/

/**
 * Where the step's last result check since its last report stands: 'passed', 'failed', 'waits' (for the person), or
 * null (none yet). The review: a report anew asks for a check anew.
 */
export function resultCheckOf(item) {
  const lines = historyOf(item)
  const from = lines.findLastIndex(one => REPORTED.test(one.replace(HISTORY_TIME, '')))
  const last = lines.slice(Math.max(0, from)).map(one => said(one, RESULT)).filter(Boolean).at(-1)
  return last === undefined ? null : last.startsWith('result check passed') ? 'passed' : last.startsWith('result check failed') ? 'failed' : 'waits'
}

/** Whether the board's own check (git) passed last: its History's last "check passed", "failed" or "pending". */
export function gitCheckPassed(item) {
  const last = historyOf(item).map(one => said(one, /check (?:passed|failed|pending)\b/)).filter(Boolean).at(-1)
  return last !== undefined && last.startsWith('check passed')
}

/** The steps of the store (`items`) made as fixes of the step `id`. */
export const fixesOf = (id, items) => [...(items?.values() ?? [])].filter(one => valueOf(one, 'Kind') === 'step' && valueOf(one, 'Fix of') === id)

/**
 * The review of B356: a step whose result check failed counts as checked once its fixes are through: every fix of it
 * done or dropped, one at least done, and no point of its last check waiting for the person.
 */
export function fixesThrough(item, items) {
  if (resultCheckOf(item) !== 'failed' || (checkedOf(item)?.points ?? []).some(one => one.verdict === 'ask')) return false
  const fixes = fixesOf(valueOf(item, 'Id'), items)
  return fixes.length > 0 && fixes.every(one => ['done', 'dropped'].includes(valueOf(one, 'State'))) && fixes.some(one => valueOf(one, 'State') === 'done')
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
