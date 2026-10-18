// B356: the result check before "done". A step with agreed points (its "What we build") or a Standard line is done
// only after a helper that did not build it checked the result: the partner files it with the work tool's `checked`
// (the evidence picture, every agreed point pass, fail or ask, the score). It reads only the step's own points and its
// standard; nothing of the project's work is named here.

import { valueOf } from './item.mjs'
import { standardOf } from './standard.mjs'

const VERDICTS = ['pass', 'fail', 'ask']
const HISTORY_TIME = /^-\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+/

/** Whether a step needs the result check: it has agreed points ("What we build") or a Standard line. */
export function needsResultCheck(item) {
  const points = (item?.sections?.get('What we build') ?? []).map(one => one.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean)
  return points.length > 0 || standardOf(item) !== null
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

/** The words of a History line, without its time and who wrote it ("server: check passed: ..." → "check passed: ..."). */
const wordsOf = line => line.replace(HISTORY_TIME, '').replace(/^[^:]{1,80}:\s+/, '')

/** Where the step's last result check stands: 'passed', 'failed', 'waits' (for the person), or null (none yet). */
export function resultCheckOf(item) {
  const last = (item?.sections?.get('History') ?? []).map(wordsOf).filter(one => /^result check (?:passed|failed|waits)\b/.test(one)).at(-1)
  return last === undefined ? null : last.startsWith('result check passed') ? 'passed' : last.startsWith('result check failed') ? 'failed' : 'waits'
}

/** Whether the board's own check (git) passed last: its History's last "check passed", "failed" or "pending". */
export function gitCheckPassed(item) {
  const last = (item?.sections?.get('History') ?? []).map(wordsOf).filter(one => /^check (?:passed|failed|pending)\b/.test(one)).at(-1)
  return last !== undefined && last.startsWith('check passed')
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
