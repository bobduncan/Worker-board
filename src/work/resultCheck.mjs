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

const numberOf = item => Number(String(valueOf(item, 'Id')).slice(1))
const isOpenStep = item => !['done', 'dropped'].includes(valueOf(item, 'State'))

/**
 * B543 (the fix of X8: steps sat in review for days behind a dropped fix): what a step in review waits for, or null
 * (not in review, its board check not passed, no result check needed, or its check passed). `{ kind, fix, since, text }`:
 * kind 'check', its result check (never filed, "waits for its first check"; or to be filed again once its ask point is
 * answered or its fix is done, "waits for its check again"); 'answer', the person's answer to an ask point of its check;
 * 'fix', its open fix `fix` ("waits for its fix B<n>"), also while that fix waits in review for one of its own; 'dropped',
 * its check failed and no fix of it is open or done ("its fix B<n> was dropped"). `since`: when the wait began (ms).
 * `items` is the store's items by id.
 */
export function reviewWaitOf(item, items) {
  if (valueOf(item, 'State') !== 'review' || !gitCheckPassed(item) || !needsResultCheck(item)) return null
  const id = valueOf(item, 'Id')
  const result = resultCheckOf(item)
  if (result === 'passed') return null
  if (result === null) return { kind: 'check', fix: null, since: sinceMs(valueOf(item, 'Since')), text: 'waits for its first check' }
  if (result === 'waits') {
    const open = [...(items?.values() ?? [])].some(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === id && valueOf(one, 'State') === 'open')
    return open ? { kind: 'answer', fix: null, since: resultCheckAtMs(item), text: 'waits for your answer to its check' }
      : { kind: 'check', fix: null, since: resultCheckAtMs(item), text: 'waits for its check again' }
  }
  const fixes = fixesOf(id, items).sort((a, b) => numberOf(a) - numberOf(b))
  const open = fixes.filter(isOpenStep).at(-1)
  if (open !== undefined) return { kind: 'fix', fix: valueOf(open, 'Id'), since: resultCheckAtMs(item), text: `waits for its fix ${valueOf(open, 'Id')}` }
  const done = fixes.filter(one => valueOf(one, 'State') === 'done').at(-1)
  if (done !== undefined) return { kind: 'check', fix: valueOf(done, 'Id'), since: sinceMs(valueOf(done, 'Since')), text: 'waits for its check again' }
  const named = lastResult(item).match(/; fix (B\d+) for\b/)?.[1] ?? fixes.at(-1)?.head.get('Id') ?? null
  const gone = named === null ? undefined : items?.get(named)
  const since = gone === undefined ? resultCheckAtMs(item) : sinceMs(valueOf(gone, 'Since'))
  return { kind: 'dropped', fix: named, since, text: named === null ? 'its check failed and made no fix' : `its fix ${named} was dropped` }
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

/**
 * B504: where the fixes of a step's failed check stand, for the Focus page: the chain of its fix steps followed to the
 * last one (a fix of a fix, over any number of rounds; of several fixes of one step the newest counts; a dropped one
 * is no fix), and what the last one says. null: no fix (yet). Otherwise `{ by, isFixed, passed, total, evidence, note }`:
 * isFixed when the last fix is done with none of its points failed; else `note` says what goes on, "its fix B501 is
 * being checked", "its fix B499 failed too, B501 fixes it". `items` is the store's steps by id.
 */
export function fixOutcomeOf(id, items) {
  const chain = []
  for (let from = id; chain.length < 20;) {
    const next = fixesOf(from, items).filter(one => valueOf(one, 'State') !== 'dropped')
      .sort((a, b) => Number(valueOf(a, 'Id').slice(1)) - Number(valueOf(b, 'Id').slice(1))).at(-1)
    if (next === undefined || chain.includes(next)) break
    chain.push(next)
    from = valueOf(next, 'Id')
  }
  const last = chain.at(-1)
  if (last === undefined) return null
  const by = valueOf(last, 'Id')
  const check = checkedOf(last)
  const state = valueOf(last, 'State')
  const base = { by, passed: check?.passed ?? null, total: check?.total ?? null, evidence: check?.evidence ?? null }
  if ((state === 'done' || state === 'closed') && !(check?.points ?? []).some(one => one.verdict !== 'pass')) return { ...base, isFixed: true, note: null }
  const finished = state === 'done' || state === 'closed'
  const going = state === 'review' ? 'is being checked' : ['queued', 'new', 'refined'].includes(state) ? 'is waiting to start' : 'is being worked on'
  const before = chain.length > 1 ? valueOf(chain.at(-2), 'Id') : null
  const note = finished ? `its fix ${by} failed too`
    : before === null ? `its fix ${by} ${going}`
      : `its fix ${before} failed too, ${by} ${going === 'is being worked on' ? 'fixes it' : going}`
  return { ...base, isFixed: false, note }
}

const BULLET = /^\s*[-*]\s+/
const MAKES_PASS = /^Makes pass:\s*/i
// Words too common to tie a checked point to an agreed one.
const COMMON = new Set(['with', 'that', 'this', 'from', 'when', 'each', 'every', 'they', 'them', 'their', 'have', 'into', 'only', 'once', 'then', 'than', 'what', 'which', 'does', 'there', 'step', 'still', 'stays', 'more'])
const wordsIn = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(one => !COMMON.has(one)))

/**
 * B526: a step's agreed points as its "What we build" holds them, a "Not in it" line too: one per bullet, a line
 * without a bullet joined to the one before, the bullet taken off.
 */
export function agreedPoints(item) {
  const points = []
  for (const one of item?.sections?.get('What we build') ?? []) {
    if (BULLET.test(one)) points.push(one.replace(BULLET, '').trim())
    else if (one.trim() !== '' && points.length > 0) points[points.length - 1] += ` ${one.trim()}`
  }
  return points.filter(Boolean)
}

/**
 * B526: for each failed point of a check (`failed`, each with its `index` in the checked list `points`), the agreed
 * point of the checked step (`origin`) it must make pass, or null. By the list's order when the checker ticked one
 * point per agreed point ("Not in it" ticked or not); otherwise, as checkers add points ("harm: ...", "extra: ...")
 * and split others, the agreed point that shares the most words with it. A step without agreed points, or a failed
 * point that shares too few words with any: its Standard line, else its Summary.
 * A fix of a fix names the first step's point, not the words of an earlier fail: a fix's fail text stands with its
 * "Makes pass" line, which counts; a fix made before B526 has none, and its fail text is followed up the chain of
 * `Fix of` through the checks that made it (`items`, the store's steps by id).
 */
export function parentPointsOf(origin, points, failed, items = null, depth = 0) {
  const raw = agreedPoints(origin)
  const all = raw.map(one => one.replace(MAKES_PASS, ''))
  const kept = all.map((text, place) => ({ text, place })).filter(one => !/^Not in it\b/i.test(one.text)).map(one => one.place)
  const standard = standardOf(origin)
  const summary = (origin?.sections?.get('Summary') ?? []).join(' ').trim()
  const fallback = standard !== null && !/^none\b/i.test(standard) ? `Standard: ${standard}` : summary === '' ? null : summary
  if (all.length === 0) return failed.map(() => fallback)
  const inOrder = points.length === all.length ? all.map((_, place) => place) : points.length === kept.length ? kept : null
  const placeOf = one => {
    if (inOrder !== null && inOrder[one.index] !== undefined) return inOrder[one.index]
    // A checker's "not in it held: ..." is the Not in it line.
    if (/^not in it\b/i.test(one.text)) {
      const notInIt = all.findIndex(text => /^Not in it\b/i.test(text))
      if (notInIt >= 0) return notInIt
    }
    const said = wordsIn(one.text)
    const scored = all.map((text, place) => {
      const words = wordsIn(text)
      const shared = [...words].filter(word => said.has(word)).length
      // Checkers mostly keep the agreed order and add their own points after: the same place counts for a little.
      return { place, shared, score: shared / Math.max(1, words.size) + (place === one.index ? 0.15 : 0) - Math.abs(place - one.index) * 0.02 }
    }).filter(each => each.shared >= 2)
    scored.sort((a, b) => b.score - a.score || b.shared - a.shared)
    return scored[0]?.place ?? -1
  }
  const isFix = valueOf(origin, 'Fix of') !== null
  const hasPasses = raw.some(one => MAKES_PASS.test(one))
  return failed.map(one => {
    const place = placeOf(one)
    if (place < 0) return fallback
    if (!isFix) return all[place]
    if (MAKES_PASS.test(raw[place])) return all[place]
    if (MAKES_PASS.test(raw[place + 1] ?? '')) return all[place + 1]
    // A fix made before B526: its fail text was a failed point of the check that made it.
    const parent = hasPasses || items === null || depth >= 10 ? undefined : items.get(valueOf(origin, 'Fix of'))
    const check = parent === undefined ? null : checkedOf(parent)
    const index = check === null ? -1 : check.points.findIndex(point => point.verdict === 'fail' && point.text === raw[place])
    if (index < 0) return all[place]
    return parentPointsOf(parent, check.points, [{ ...check.points[index], index }], items, depth + 1)[0] ?? all[place]
  })
}

/** A fix step's title: "Fix: <the failed points in a few words>", no brackets at its end, at most about 100 characters. */
export function fixTitle(failed) {
  const words = failed.map(one => one.text.replace(/\s*\([^()]*\)\s*$/, '').trim()).filter(Boolean).join('; ')
  const cut = words.length <= 100 ? words : `${words.slice(0, 100).replace(/\s+\S*$/, '')}…`
  return `Fix: ${cut.replace(/[\s.;,:]+$/, '')}`
}
