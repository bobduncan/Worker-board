// B356: the result check before "done". A step with agreed points (its "What we build") or a Standard line is done
// only after a helper that did not build it checked the result: the partner files it with the work tool's `checked`
// (the evidence picture, every agreed point pass, fail or ask, the score). It reads only the step's own points and its
// standard; nothing of the project's work is named here.

import { askFiledMs, sinceMs, valueOf } from './item.mjs'
import { standardOf } from './standard.mjs'

const VERDICTS = ['pass', 'fail', 'ask']
/** B701: the plain lines of a check the person's task window shows (what was tried, why it fell short, the one-line conclusion). */
export const NOTES = ['tried', 'why', 'conclusion']
const NOTE_MAX = 400
/**
 * B449, T9.1.1: how long after a result check that waits for the person the worker that checked is given to file its ask point
 * (`reviewWaitOf`): until then the step waits for the person, not for a check again. After it, with still no ask of the step
 * filed since the check line, it waits for a check again, so a checker that never asked wedges nothing. The repair `unchecked`
 * (repair.mjs) shares it.
 */
export const UNCHECKED_MS = 30 * 60_000
const HISTORY_TIME = /^-\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+/

/**
 * Whether a step needs the result check: it has agreed points ("What we build", "Not in it" lines left out) or a
 * Standard line that is not "none (...)". T9.1.1: never a Quality Assurance task (its head `Checks` names the step it
 * checks): it is the result check itself, ended by the holder's `work checked` on that step, and has no check of its own.
 */
export function needsResultCheck(item) {
  if (item?.head !== undefined && valueOf(item, 'Checks') !== null) return false
  const points = (item?.sections?.get('What we build') ?? []).map(one => one.replace(/^\s*[-*]\s+/, '').trim()).filter(one => one !== '' && !/^Not in it\b/i.test(one))
  const standard = standardOf(item)
  return points.length > 0 || (standard !== null && !/^none\b/i.test(standard))
}

/**
 * The points of a `checked`: each "pass: <point>", "fail: <point>" or "ask: <point>" (a point only the person can
 * judge). `{ ok: true, points: [{ verdict, text }], notes }`, or `{ ok: false, why }`. B701, B706: among them stand the
 * plain lines the person's task window reads, "tried: <the way>", "why: <why it fell short>" and, from the second failed
 * try, "conclusion: <one line>": no points (never counted as pass or fail), kept apart in `notes`.
 */
export function parsePoints(value) {
  const all = (Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : []).filter(one => typeof one === 'string' && one.trim() !== '')
  if (all.length === 0) return { ok: false, why: 'Give every agreed point in "points", each "pass: <point>", "fail: <point>" or "ask: <point>".' }
  const points = []
  const notes = {}
  for (const one of all.slice(0, 40)) {
    const found = one.trim().replace(/^[-*]\s+/, '').match(/^(\w+)\s*[:–-]\s*(.+)$/)
    const verdict = found?.[1].toLowerCase()
    // B701: the lines the person's task window reads (`tried`, `why`, `conclusion`) are no points: kept apart, never counted.
    if (found !== null && NOTES.includes(verdict)) {
      notes[verdict] = found[2].replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX)
      continue
    }
    if (found === null || !VERDICTS.includes(verdict)) return { ok: false, why: `"${one.trim().slice(0, 60)}" is no point: write "pass: <point>", "fail: <point>" or "ask: <point>" (or "tried: <the way>", "why: <why it fell short>", "conclusion: <one line>").` }
    // B381: a point is kept whole (a long one up to 4000 characters), so its fix step carries all of it.
    points.push({ verdict, text: found[2].replace(/\s+/g, ' ').trim().slice(0, 4000) })
  }
  if (points.length === 0) return { ok: false, why: 'Give every agreed point in "points", each "pass: <point>", "fail: <point>" or "ask: <point>": the lines "tried:", "why:" and "conclusion:" are no points.' }
  return { ok: true, points, notes }
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

/**
 * T9.1.1: the words of the step's last result check line without its verdict, up to the first ";" ("2 of 2 points pass, score
 * 82 of 75"), or null when it has none: what the QA task's History says it checked, when the board ends the task itself.
 */
export function resultCheckSummary(item) {
  const last = historyOf(item).map(wordsOf).filter(one => RESULT.test(one)).at(-1)
  return last === undefined ? null : last.replace(/^result check (?:passed|failed|waits for you|waits)\s*:?\s*/, '').split(';')[0].trim() || null
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

const BOARD_CHECK_LINE = /^check (?:passed|failed|pending)\b/
const WARNED = /^check passed with warnings:\s*(.*)$/
/** Between a pass's lines and its warnings in the History line ("check passed with warnings: <lines> | warnings: <warnings>"). */
export const WARNINGS_MARK = ' | warnings: '

/**
 * 2026-10-25: the warnings the step's newest board check passed with, as one text, or null: its newest check line in the
 * History is "check passed with warnings: <the pass lines> | warnings: <the warnings>" (a line without the pass lines is
 * all warnings). A report since has its check pending again, or failed, so the warnings are gone then.
 */
export function boardWarningsOf(item) {
  const words = historyOf(item).map(wordsOf)
  const at = words.findLastIndex(one => BOARD_CHECK_LINE.test(one))
  const found = at < 0 ? null : WARNED.exec(words[at])
  if (found === null) return null
  const mark = found[1].indexOf(WARNINGS_MARK)
  const text = (mark < 0 ? found[1] : found[1].slice(mark + WARNINGS_MARK.length)).trim()
  return text === '' ? null : text
}

/**
 * 2026-10-25: the board's warning for a change that touches tests and a report that names no mutant (check.mjs
 * `noMutantWords`) stands in the warnings text: the result check then demands a mutant of the checker.
 */
export const hasNoMutantWarning = warnings => /the change touches tests \(.*?\) but the result names no mutant/.test(String(warnings ?? ''))

/** 2026-10-25: what the result check demands when the report names no mutant for a change that touches tests (roles/partner.md, "The check"). */
const NO_MUTANT_DEMAND = 'the report names no mutant for a change that touches tests: the helper makes one in a scratch copy (never on the branch), undoing the fix and running the new tests, and a test that still passes is a fail point; it files the mutant it made'

/**
 * 2026-10-25: the lines a word asking the partner for a step's result check carries for the warnings its board check
 * passed with (`warnings`, `boardWarningsOf`): "Board warnings: ..." and, for a report that names no mutant for a change
 * touching tests, "Demand: ...". [] for none.
 */
export function warningLines(warnings) {
  const text = String(warnings ?? '').replace(/\s+/g, ' ').trim()
  return text === '' ? [] : [`Board warnings: ${text.slice(0, 700)}`, ...(hasNoMutantWarning(text) ? [`Demand: ${NO_MUTANT_DEMAND}`] : [])]
}

/**
 * B585 (X33: B522 read as waiting 39 min for its first check, counted from its move to review at 21:41, while its
 * board check passed only at 22:04, when the check word went to the partner): when the board's own check last passed
 * (ms), or NaN: the History line's own minute.
 */
export function gitCheckAtMs(item) {
  const line = historyOf(item).filter(one => wordsOf(one).startsWith('check passed')).at(-1)
  return line === undefined ? Number.NaN : sinceMs(line.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1])
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

/** B665: when a step left the open steps (ms): its last move to done or dropped in its History, else its Since; NaN while it is open. */
const LEFT = /→ (?:done|dropped)$/
function leftAtMs(item) {
  if (isOpenStep(item)) return Number.NaN
  const line = historyOf(item).filter(one => LEFT.test(wordsOf(one))).at(-1)
  return sinceMs(line?.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1] ?? valueOf(item, 'Since'))
}

/**
 * B878 (X116: B821's block by B674 ended at 12:54, B574 took B674 out of its Blocked by at once, so B665 found no blocker
 * and counted from the drop 96 min before): the newest "no longer blocked by B<n>" line in a step's History, `{ id, at }`
 * (ms), or undefined.
 */
const UNBLOCKED = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) [^:]+: no longer blocked by (B\d+)\b/
export function unblockedOf(item) {
  const found = historyOf(item).map(one => one.match(UNBLOCKED)).filter(Boolean).at(-1)
  return found === undefined ? undefined : { id: found[2], at: sinceMs(found[1]) }
}

/**
 * B878: the recap part a step waits in (src/recaps.mjs `recapWaitsOf`: `[{ step, goal, path, key, title, verdict, at }]`,
 * verdict null while the person has not judged the part, 'sent-back' after their Send back at `at`), or null.
 */
export function recapPartOf(recaps, id) {
  const parts = (Array.isArray(recaps) ? recaps : []).filter(one => one?.step === id)
  return parts.find(one => one.verdict === null) ?? parts.find(one => one.verdict === 'sent-back') ?? null
}

/**
 * B656 (X8 again: B603 sat in review behind its fix B614, which the ready list held, while its line said only "waits for
 * its fix B614"): the open fixes under the step `id`, followed down: its newest open fix, that one's newest open fix, and
 * so on (a loop ends it). [] when it has none.
 */
export function openFixChain(id, items) {
  const chain = []
  for (let from = id; chain.length < 20;) {
    const next = fixesOf(from, items).filter(isOpenStep).sort((a, b) => numberOf(a) - numberOf(b)).at(-1)
    const at = next === undefined ? null : valueOf(next, 'Id')
    if (at === null || at === id || chain.includes(at)) break
    chain.push(at)
    from = at
  }
  return chain
}

/** B664: the first step of the chain of fixes the step `id` is in: its `Fix of` followed up (a loop ends it). */
export function chainRootOf(id, items) {
  const seen = new Set()
  let at = id
  for (let up = valueOf(items?.get(at), 'Fix of'); up !== null && items?.has(up) && !seen.has(up); up = valueOf(items.get(at), 'Fix of')) {
    seen.add(at)
    at = up
  }
  return at
}

/**
 * B664 (X8 a third time: map steps patched four and five times the same way, 46 to 71 of 75): the tries of the chain the
 * step `id` is in, ids in order: its first step and every fix under it, a fix of a fix too; a dropped fix (and what
 * hangs under it) was no try.
 */
export function chainTries(id, items) {
  const root = chainRootOf(id, items)
  const tries = [root]
  for (let at = 0; at < tries.length && tries.length < 50; at += 1) {
    for (const fix of fixesOf(tries[at], items).filter(one => valueOf(one, 'State') !== 'dropped')) {
      if (!tries.includes(valueOf(fix, 'Id'))) tries.push(valueOf(fix, 'Id'))
    }
  }
  return tries.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

/** B664: a chain that had this many tries gets no patch of the same way: its next fix waits for the partner's other way. */
export const TRIES_BEFORE_ANOTHER_WAY = 2
/** B664: the line an open fix of a long chain carries, and the line the partner's other way starts its what with. */
export const ANOTHER_WAY = 'Two rounds, then another way: the partner refines it another way'
const TRIED_BEFORE = /\bTried before:/i

/** B664: whether a step's what (its What we build, or its refine block) names the ways tried before ("Tried before: ..."). */
export const hasTriedBefore = item => ['What we build', 'Refined'].some(name => (item?.sections?.get(name) ?? []).some(one => TRIED_BEFORE.test(one)))

/** B667: a History line of a refine round written (as refineGate.mjs reads it): "refined, round 2", "refined is ready". */
const ROUND_WRITTEN = /:\s+refined(?:, round \d+| is ready)\s*$/
/**
 * B667 (B664's result check: an open fix the partner never refines had no follow-up, probed at +3 h and +2 d): a fix that
 * waits for the partner's refine: new, with no refine round written since it was made (a round with questions waits for
 * the person, not the partner). `{ since }`, when it was made (ms), or null.
 */
export function unrefinedFixOf(item) {
  if (valueOf(item, 'State') !== 'new' || valueOf(item, 'Fix of') === null) return null
  if (historyOf(item).some(one => ROUND_WRITTEN.test(one))) return null
  const since = sinceMs(valueOf(item, 'Since'))
  return Number.isFinite(since) ? { since } : null
}

/** 2026-10-31 (B689): how many characters of a step's title the wait words carry beside its id. */
const WAIT_TITLE_CHARS = 60
/** 2026-10-31 (B689): a step as the wait words name it: its id and its title, cut to WAIT_TITLE_CHARS at a word. */
function namedStep(id, items) {
  const found = items?.get(id)
  const title = found === undefined ? '' : String(valueOf(found, 'Title') ?? '').replace(/\s+/g, ' ').trim()
  if (title === '') return id
  return `${id} ${title.length <= WAIT_TITLE_CHARS ? title : `${title.slice(0, WAIT_TITLE_CHARS).replace(/\s+\S*$/, '')}…`}`
}
/** 2026-10-31 (B689): the open steps a step is blocked by (its `Blocked by` and `Waits for`), each once, itself left out. */
function openBlockersOf(item, items) {
  const id = valueOf(item, 'Id')
  return [...new Set(`${valueOf(item, 'Blocked by') ?? ''} ${valueOf(item, 'Waits for') ?? ''}`.match(/\bB\d+\b/g) ?? [])]
    .filter(one => one !== id && items?.has(one) && isOpenStep(items.get(one)))
}
/** 2026-10-31 (B689): the open Quality Assurance task that checks the step `id` (its head `Checks`), the oldest of two, or null. */
function openCheckOf(id, items) {
  const open = [...(items?.values() ?? [])].filter(one => valueOf(one, 'Checks') === id && isOpenStep(one))
  return open.sort((a, b) => numberOf(a) - numberOf(b))[0] ?? null
}
/** 2026-10-31 (B689): the states in which a link of a chain is with a worker that took it or was given it. */
const WITH_A_WORKER = ['queued', 'taken', 'in progress']

/**
 * 2026-10-31 (B689: its part read "Worker 1 is on it" and "its fix B821 is being checked" while B821 waited for the recap B674
 * and nobody worked on it): what the last link of a chain of open fixes waits for itself, `{ kind, text, ... }`, or null when
 * the board cannot tell. `text` is a verb phrase for the wait words ("waits for B674 <its title>"), null where the old words
 * stay true. Kinds: 'checking', a Quality Assurance task of it is in progress (`qa`, `who` its owner: "is being checked by
 * <who>"); 'qa-queued', one is open and not taken up yet (`qa`, `who` the worker it was given to, or null); 'blocked', it is
 * blocked by open steps (`blockers`); for a link in review its own wait (`reviewWaitOf`): 'dropped' (its own check failed and
 * its fix was dropped, `fix`), 'check', 'answer' (the person), 'report' (back with its worker), 'board' (the board's check of
 * its report); 'you', its worker waits on the person; 'worker', it is queued, taken or in progress (`who` its owner, `state`;
 * no text: the store names no card, so the words name no worker).
 */
function lastLinkWaitOf(link, items, held, now, recaps = null) {
  if (link === undefined) return null
  const id = valueOf(link, 'Id')
  const state = valueOf(link, 'State')
  const qa = openCheckOf(id, items)
  if (qa !== null) {
    const qaId = valueOf(qa, 'Id')
    const who = valueOf(qa, 'Owner')
    if (valueOf(qa, 'State') === 'in progress' && who !== null) return { kind: 'checking', qa: qaId, who, text: `is being checked by ${who}` }
    return { kind: 'qa-queued', qa: qaId, who, text: `waits for its check ${qaId}${who === null ? '' : `, given to ${who}`}` }
  }
  const blockers = openBlockersOf(link, items)
  if (blockers.length > 0) return { kind: 'blocked', blockers, text: `waits for ${blockers.map(one => namedStep(one, items)).join(' and ')}` }
  if (state === 'review') {
    if (!gitCheckPassed(link) && reportCheckFailedOf(link) === null) return { kind: 'board', text: 'waits for the board\'s check of its report' }
    const own = waitOf(link, items, held, now, 1, recaps)
    if (own === null || own.kind === 'fix' || own.kind === 'blocked') return null
    if (own.kind === 'dropped') return { kind: 'dropped', fix: own.fix, text: `stopped: ${own.text}` }
    if (own.kind === 'report') return { kind: 'report', text: own.text.startsWith('waits for ') ? own.text : `is ${own.text}` }
    return { kind: own.kind, text: own.text }
  }
  if (state === 'waiting on you') return { kind: 'you', text: 'waits for your answer' }
  if (WITH_A_WORKER.includes(state)) return { kind: 'worker', who: valueOf(link, 'Owner'), state, text: null }
  return null
}

/**
 * 2026-10-31 (B689): where the chain of open fixes under the step `id` stands: `{ fix, chain, end, last }` (`fix` its newest
 * open fix, `chain` the open fixes followed down, B656 `openFixChain`, `end` the last, `last` what that one waits for itself,
 * `lastLinkWaitOf`), or null when it has no open fix. `atWork`: some link is with a worker (queued, taken, in progress) or its
 * last is being checked or queued for its check: only then is the step being fixed; otherwise its chain waits.
 */
export function chainWaitOf(id, items, held = null, now = null, recaps = null) {
  const chain = openFixChain(id, items)
  if (chain.length === 0) return null
  const end = chain.at(-1)
  const last = lastLinkWaitOf(items?.get(end), items, held, now, recaps)
  const atWork = chain.some(link => WITH_A_WORKER.includes(valueOf(items.get(link), 'State'))) || ['checking', 'qa-queued'].includes(last?.kind)
  return { fix: chain[0], chain, end, last, atWork }
}

/** B656: the ready list's held steps (handOut.mjs `readyList`'s `held`, `[{ id, why }]`, or a Map of id to why) as a Map. */
const heldMapOf = held => (held instanceof Map ? held : new Map((Array.isArray(held) ? held : []).map(one => [one.id, one.why])))
/** B656: a held why in a few words: the person's choice outside the focus goal without its how ("waits until you add it ..."). */
const heldWords = why => String(why).replace(/^(outside the focus goal):.*$/, '$1')

/** The clauses of a board check line that name what the report passed: a failed check's reason is the first clause that is none. */
const PASS_CLAUSE = /^(?:work (?:in|outside git)\b|no change made\b)/
/** 2026-10-31 (B799): a failed check's reason begins so when the work is on a branch that is not merged: the step is back with its worker. */
export const NOT_MERGED = 'not merged: '
/**
 * T8, 2026-10-31 (what counts as finished, check.mjs `finishedVerdict`): a failed check's reason begins so when what is short
 * is a mismatch its worker can fix (a branch or worktree left, a file not there, no reason for a step with no change): the
 * step is back with its worker, as for NOT_MERGED, never a failure for the person.
 */
export const BACK = 'back: '

/**
 * T8: whether the words of a failed check line (after "check failed:") hand the step back to its worker: `{ notMerged, words }`
 * (`words` the words for the worker, from the first clause that is no pass line on, its mark left off), or null.
 */
export function backWordsOf(detail) {
  const clauses = String(detail ?? '').split(';').map(one => one.trim())
  const from = clauses.findIndex(one => one !== '' && !PASS_CLAUSE.test(one))
  if (from < 0) return null
  if (clauses[from].startsWith(NOT_MERGED)) return { notMerged: true, words: clauses[from].slice(NOT_MERGED.length).trim() }
  if (clauses[from].startsWith(BACK)) return { notMerged: false, words: [clauses[from].slice(BACK.length), ...clauses.slice(from + 1)].join('; ').trim() }
  return null
}
/** B740: how long a failed check's reason may be on the wait line. */
const WHY_CHARS = 80

/**
 * B740 (X92: B727's report check failed at 21:03 and its worker never reported it again; the step sat in review an hour
 * while health's line said nothing of what it waits for): a step in review whose board check of its report failed, with
 * no report after it. `{ at, stamp, clock, why, notMerged }`: when the check line was written (ms, to the minute), its "YYYY-MM-DD HH:MM" and "HH:MM", and the
 * refusal in a few words (the first clause that is no pass line, cut before its detail; "no reason given" for none). null
 * for any other step. `notMerged` (2026-10-31, B799): the words that went back to the worker when the work sits on a branch not
 * merged (NOT_MERGED, check.mjs `notMergedWords`), else null. `back` (T8): the words that went back to the worker for any
 * reason it can fix (NOT_MERGED or BACK, `backWordsOf`), else null.
 */
export function reportCheckFailedOf(item) {
  if (valueOf(item, 'State') !== 'review') return null
  const lines = historyOf(item)
  const words = lines.map(wordsOf)
  const at = words.findLastIndex(one => BOARD_CHECK_LINE.test(one))
  if (at < 0 || !words[at].startsWith('check failed') || words.slice(at + 1).some(one => REPORTED.test(one))) return null
  const when = lines[at].match(/^-\s+(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}))/)
  const detail = words[at].replace(/^check failed:?\s*/, '')
  const reason = detail.split(';').map(one => one.trim()).find(one => one !== '' && !PASS_CLAUSE.test(one)) ?? ''
  const handed = backWordsOf(detail)
  const short = (reason.startsWith(BACK) ? reason.slice(BACK.length) : reason).split(/ \(|: /)[0].trim()
  const notMerged = handed?.notMerged === true ? handed.words : null
  const back = handed === null ? null : handed.words
  return { at: sinceMs(when?.[1]), stamp: when?.[1] ?? '', clock: when?.[2] ?? '', notMerged, back, why: short === '' ? 'no reason given' : short.length > WHY_CHARS ? `${short.slice(0, WHY_CHARS).trim()}…` : short }
}

/**
 * B543 (the fix of X8: steps sat in review for days behind a dropped fix): what a step in review waits for, or null
 * (not in review, its board check not passed, no result check needed, or its check passed). `{ kind, fix, since, text }`:
 * kind 'check', its result check (never filed, "waits for its first check"; or to be filed again once its ask point is
 * answered or its fix is done, "waits for its check again"); 'answer', the person's answer to an ask point of its check;
 * 'fix', its open fix `fix` ("waits for its fix B<n>"), also while that fix waits in review for one of its own; 'dropped',
 * its check failed and no fix of it is open or done ("its fix B<n> was dropped"); 'report' (B740), the board's check of its
 * report failed and it was not reported again (`reportCheckFailedOf`; `since` the failed check, `clock`, `why`); 'blocked' (B630), the same but the step
 * is blocked by open steps `blockers`, so the drop is a plan. `since`: when the wait began (ms); B665: for 'dropped' the
 * later of the drop and the end of the block (`blockEnded`, `{ id, at }`: the last blocker to leave, dropped or done).
 * `items` is the store's items by id. B656: kind 'fix' also names its chain of open fixes followed down (`chain`, its
 * fix first; `end`, the last) and, when `held` (the ready list's held steps) holds that last one, why (`held`, else null):
 * "waits for its fix B614, held: outside the focus goal". T9.1.1: `now` (ms), for a caller with a clock: a result check that waits
 * for the person with no ask of the step filed since its line is not yet kind 'check' (UNCHECKED_MS): the checker is filing it.
 * 2026-10-31 (B689): kind 'fix' also says what the chain's last link waits for itself (`last`, `chainWaitOf`), unless a hold or
 * a missing refine says it already: "waits for its fix B821, which waits for B674 <its title>", "waits for its fix B821: being
 * checked by <the owner of its QA task>", "waits for its fix B8, whose fix B9 waits for its first check".
 * B878: `recaps` (src/recaps.mjs `recapWaitsOf`): a step whose fix was dropped while its part waits for the person's verdict
 * in a goal's recap is kind 'recap' (`goal`, `path`, `part`), "waits for your verdict in the recap of G<n>"; a part sent back
 * counts the dropped wait from the Send back (`sentBack`); a "no longer blocked by" line ends a block as B665's blocker does.
 */
export function reviewWaitOf(item, items, held = null, now = null, recaps = null) {
  return waitOf(item, items, held, now, 0, recaps)
}

/** `reviewWaitOf`, with how deep it was asked: the last link's own wait (depth 1) says nothing of its last link again. */
function waitOf(item, items, held, now, depth, recaps = null) {
  // B740: the board's check of the report failed and the worker has not reported again: the step waits for the worker.
  const refused = reportCheckFailedOf(item)
  if (refused !== null) {
    if (refused.notMerged !== null) return { kind: 'report', fix: null, since: refused.at, clock: refused.clock, why: refused.why, text: `not merged yet: back with ${valueOf(item, 'Owner') ?? 'its worker'}` }
    // T8: a mismatch the worker can fix: back with it, never a failure for the person.
    if (refused.back !== null) return { kind: 'report', fix: null, since: refused.at, clock: refused.clock, why: refused.why, text: `back with ${valueOf(item, 'Owner') ?? 'its worker'}: ${refused.why}` }
    return { kind: 'report', fix: null, since: refused.at, clock: refused.clock, why: refused.why, text: `waits for ${valueOf(item, 'Owner') ?? 'its worker'} to report again: its report check failed at ${refused.clock} (${refused.why})` }
  }
  if (valueOf(item, 'State') !== 'review' || !gitCheckPassed(item) || !needsResultCheck(item)) return null
  const id = valueOf(item, 'Id')
  const result = resultCheckOf(item)
  if (result === 'passed') return null
  // B585: the first check is asked when the board's own check passes, not when the step went to review.
  if (result === null) {
    const asked = gitCheckAtMs(item)
    return { kind: 'check', fix: null, since: Number.isFinite(asked) ? asked : sinceMs(valueOf(item, 'Since')), text: 'waits for its first check' }
  }
  if (result === 'waits') {
    const asks = [...(items?.values() ?? [])].filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === id)
    const at = resultCheckAtMs(item)
    const answer = { kind: 'answer', fix: null, since: at, text: 'waits for your answer to its check' }
    if (asks.some(one => valueOf(one, 'State') === 'open')) return answer
    // T9.1.1 (a second Quality Assurance task right after `checked`): the worker that checked files its ask point after the check
    // line. Until it has (an ask of the step filed since the line, answered or withdrawn by now), and for UNCHECKED_MS after the
    // line, the step still waits for the person; later it waits for a check again, so a checker that never asked wedges nothing.
    const hasAsked = asks.some(one => askFiledMs(one) >= at)
    if (!hasAsked && Number.isFinite(now) && Number.isFinite(at) && now - at < UNCHECKED_MS) return answer
    return { kind: 'check', fix: null, since: at, text: 'waits for its check again' }
  }
  const fixes = fixesOf(id, items).sort((a, b) => numberOf(a) - numberOf(b))
  const open = fixes.filter(isOpenStep).at(-1)
  if (open !== undefined) {
    const fix = valueOf(open, 'Id')
    const chain = openFixChain(id, items)
    const end = chain.at(-1) ?? fix
    // B656: a fix the board does not hand out (the ready list holds a refined one) leaves the whole chain waiting.
    const why = valueOf(items?.get(end), 'State') === 'refined' ? heldMapOf(held).get(end) ?? null : null
    // B667: a last fix that waits for the partner's refine (`unrefinedFixOf`).
    const unrefined = unrefinedFixOf(items?.get(end))
    const hold = why !== null ? (end === fix ? `, held: ${heldWords(why)}` : `, whose fix ${end} is held: ${heldWords(why)}`)
      : unrefined !== null ? (end === fix ? ', not refined yet' : `, whose fix ${end} is not refined yet`) : ''
    // 2026-10-31 (B689): what the last link waits for itself, where a hold or a missing refine does not say it already.
    const last = depth > 0 || hold !== '' ? null : chainWaitOf(id, items, held, now, recaps)?.last ?? null
    const tail = typeof last?.text !== 'string' ? ''
      : end !== fix ? `, whose fix ${end} ${last.text}`
        : last.kind === 'checking' ? `: being checked by ${last.who}` : `, which ${last.text}`
    return { kind: 'fix', fix, chain, end, held: why, unrefined, last, since: resultCheckAtMs(item), text: `waits for its fix ${fix}${hold}${tail}` }
  }
  const done = fixes.filter(one => valueOf(one, 'State') === 'done').at(-1)
  if (done !== undefined) return { kind: 'check', fix: valueOf(done, 'Id'), since: sinceMs(valueOf(done, 'Since')), text: 'waits for its check again' }
  const named = lastResult(item).match(/; fix (B\d+) for\b/)?.[1] ?? fixes.at(-1)?.head.get('Id') ?? null
  const gone = named === null ? undefined : items?.get(named)
  const since = gone === undefined ? resultCheckAtMs(item) : sinceMs(valueOf(gone, 'Since'))
  // B630 (X54): a dropped fix with the step blocked by an open step is a plan (the fix is made again after that step).
  const blocking = [...new Set(`${valueOf(item, 'Blocked by') ?? ''} ${valueOf(item, 'Waits for') ?? ''}`.match(/\bB\d+\b/g) ?? [])]
    .filter(one => one !== id && items?.has(one))
  const blockers = blocking.filter(one => isOpenStep(items.get(one)))
  if (blockers.length > 0) {
    return { kind: 'blocked', fix: named, blockers, since, text: `${named === null ? 'its check failed and made no fix' : `its fix ${named} was dropped`}, waits for ${blockers.join(' and ')}` }
  }
  const text = named === null ? 'its check failed and made no fix' : `its fix ${named} was dropped`
  // B878: the step's part waits for the person's verdict in a goal's recap: a plan, which their Approve or Send back ends.
  const part = recapPartOf(recaps, id)
  if (part?.verdict === null) return { kind: 'recap', fix: named, goal: part.goal, path: part.path, part: part.key, since, text: `waits for your verdict in the recap of ${part.goal}` }
  // B665 (X70, X71: B608 and B609 raised one minute after the steps that blocked them were dropped, counted from their
  // fix's drop hours before): the wait counts from when the last blocker left (dropped or done), when that is later.
  // B878 (X116): also from the step's own "no longer blocked by B<n>" line, as the blocker leaves its Blocked by when done
  // (B574); and from the person's Send back in a recap (the partner makes the next try from then).
  const ended = [...blocking.map(one => ({ id: one, at: leftAtMs(items.get(one)) })), unblockedOf(item)]
    .filter(one => one !== undefined && Number.isFinite(one.at)).sort((a, b) => a.at - b.at).at(-1)
  const back = part?.verdict === 'sent-back' && Number.isFinite(part.at) ? part : null
  // B883 (X117): the person's card for a step nothing else closes: open, it is a plan; sent back, the partner's next try counts from then.
  const card = acceptStandOf(id, items)
  if (card?.state === 'open') return { kind: 'accept', fix: named, ask: card.id, since: card.at, text: `waits for your Accept in ${card.id}` }
  const sent = card?.state === 'back' && Number.isFinite(card.at) && !(card.at <= since) && !(card.at <= (ended?.at ?? Number.NaN)) && !(card.at <= (back?.at ?? Number.NaN)) ? card : null
  if (sent !== null) return { kind: 'dropped', fix: named, since: sent.at, acceptBack: { ask: sent.id, at: sent.at }, text: `${text}; sent back by you in ${sent.id}: the partner makes its next try` }
  const words = back === null ? text : `${text}; sent back in the recap of ${back.goal}: the partner makes its next try`
  if (back !== null && !(back.at <= since) && !(back.at <= (ended?.at ?? Number.NaN))) return { kind: 'dropped', fix: named, since: back.at, sentBack: { goal: back.goal, at: back.at }, text: words }
  return ended !== undefined && !(ended.at <= since) ? { kind: 'dropped', fix: named, since: ended.at, blockEnded: ended, text: words } : { kind: 'dropped', fix: named, since, text: words }
}

/**
 * B883 (X117: B851 sat in review after its fix B875 was dropped on the partner's accept at 74 of 75; only the person's done
 * closes a step below its bar, nobody told them, and the rule dropped-fix raised it again and again): the board's card for
 * the person on a step in review that nothing else closes, an ask with `Via` ACCEPT_VIA under it. Accept marks the step done,
 * Send back gives the person's words to the partner, who makes its next try.
 */
export const ACCEPT_VIA = 'accept'
/** B883: how long after the drop (or the end of what held it) the card waits for a new fix, check or block first. */
export const ACCEPT_GRACE_MS = 10 * 60_000
/** B883: the options of the card, as the store keeps them; the first is the Accept. */
export const ACCEPT_OPTIONS = ['A Accept: done as it is', 'B Send back: the partner makes another try from your note']

/** B883: how the person's answer to a card reads: 'accept' (A, Accept, yes ...) or 'back' (B, Send back, or any other words). */
export function acceptReading(text) {
  const words = String(Array.isArray(text) ? text.join('\n') : text ?? '').trim()
  if (/^(?:A\b|Accept)/i.test(words)) return 'accept'
  if (/^(?:B\b|Send back)/i.test(words)) return 'back'
  return answerReading(words) === 'yes' ? 'accept' : 'back'
}

/**
 * B883: the newest card of the step `id` (an ask with `Via` ACCEPT_VIA), `{ id, state, at }`: state 'open', 'accept' or 'back'
 * (answered, as `acceptReading` reads it), or 'withdrawn'; `at` when it was filed (open) or answered (ms). undefined for none.
 */
export function acceptStandOf(id, items) {
  const cards = [...(items?.values() ?? [])].filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === id && valueOf(one, 'Via') === ACCEPT_VIA)
  const card = cards.sort((a, b) => numberOf(a) - numberOf(b)).at(-1)
  if (card === undefined) return undefined
  const state = valueOf(card, 'State')
  if (state === 'open') return { id: valueOf(card, 'Id'), state, at: askFiledMs(card) }
  const at = sinceMs(valueOf(card, 'Since'))
  if (state !== 'answered') return { id: valueOf(card, 'Id'), state: 'withdrawn', at }
  return { id: valueOf(card, 'Id'), state: acceptReading(card.sections?.get('Answer') ?? []), at }
}

/**
 * B883: whether the board files the person's card for a step now: it waits in review with its fix dropped (or its check made
 * none) and nothing planned (`reviewWaitOf` kind 'dropped': no open fix, check, block or recap verdict), for ACCEPT_GRACE_MS
 * since then, not sent back by the person or in a recap since, and no card of it was filed since the drop (one answered Accept
 * that did not close it, or withdrawn, is not filed again: the rule dropped-fix raises that).
 */
export function acceptCardDue(item, items, now, recaps = null) {
  const wait = reviewWaitOf(item, items, null, now, recaps)
  if (wait?.kind !== 'dropped' || wait.acceptBack !== undefined || wait.sentBack !== undefined) return false
  if (!(now - wait.since >= ACCEPT_GRACE_MS)) return false
  const card = acceptStandOf(valueOf(item, 'Id'), items)
  if (card === undefined) return true
  const filed = askFiledMs(items.get(card.id))
  return !(filed >= wait.since - 60_000)
}

/**
 * B565 (X19: B510's fix B558 passed, the partner read B510 as waiting only for the person's answer Q339 and answered the
 * board's "check step B510" with no new check): why a step in review is to be checked again, for the board's check word
 * and its repair `unchecked`, from `reviewWaitOf`: "its fix B<n> is done: file its check again" or "its ask point is
 * answered: file its check again", with "; keep Q<n> as an ask point" for each ask of it still open. null when the step
 * waits for no check again (its first check, an open fix, the person's answer).
 */
export function checkWhy(item, items) {
  const wait = reviewWaitOf(item, items)
  if (wait?.kind !== 'check') return null
  const why = wait.fix !== null ? `its fix ${wait.fix} is done: file its check again`
    : resultCheckOf(item) === 'waits' ? 'its ask point is answered: file its check again' : null
  if (why === null) return null
  const id = valueOf(item, 'Id')
  const asks = [...(items?.values() ?? [])].filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === id && valueOf(one, 'State') === 'open')
    .map(one => valueOf(one, 'Id')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  return asks.length === 0 ? why : `${why}; keep ${asks.join(' and ')} as ${asks.length === 1 ? 'an ask point' : 'ask points'}`
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
  // B701: the plain lines of the check ("Tried:", "Why:", "Conclusion:"), only the ones it has.
  const notes = Object.fromEntries(NOTES.map(name => [name, named(name[0].toUpperCase() + name.slice(1))]).filter(([, text]) => text !== null && text !== ''))
  return { evidence: named('Evidence'), score: named('Score'), points, passed: points.filter(one => one.verdict === 'pass').length, total: points.length, ...notes }
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
  if (last === undefined) {
    // B690: a fix that was dropped says so ("its fix B657 stopped"); the newest one named.
    const stopped = fixesOf(id, items).sort((a, b) => Number(valueOf(a, 'Id').slice(1)) - Number(valueOf(b, 'Id').slice(1))).at(-1)
    if (stopped === undefined) return null
    const by = valueOf(stopped, 'Id')
    return { by, passed: null, total: null, evidence: null, isFixed: false, isOpen: false, note: `its fix ${by} stopped` }
  }
  const by = valueOf(last, 'Id')
  const check = checkedOf(last)
  const state = valueOf(last, 'State')
  const base = { by, passed: check?.passed ?? null, total: check?.total ?? null, evidence: check?.evidence ?? null }
  if ((state === 'done' || state === 'closed') && !(check?.points ?? []).some(one => one.verdict !== 'pass')) return { ...base, isFixed: true, isOpen: false, note: null }
  const finished = state === 'done' || state === 'closed'
  const going = state === 'review' ? 'is being checked' : ['queued', 'new', 'refined'].includes(state) ? 'is waiting to start' : 'is being worked on'
  const before = chain.length > 1 ? valueOf(chain.at(-2), 'Id') : null
  const note = finished ? `its fix ${by} failed too`
    : before === null ? `its fix ${by} ${going}`
      : `its fix ${before} failed too, ${by} ${going === 'is being worked on' ? 'fixes it' : going}`
  return { ...base, isFixed: false, isOpen: !finished, note }
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

/**
 * B701: the tries of the chain a step is in, for the person's task window: each step of the chain (its first step and
 * every fix under it, a fix of a fix too), oldest first, as `{ id, title, state, check }`, `check` the step's own last
 * result check (`checkedOf`) cut to what the window shows: `{ passed, total, failed: [the failed points' words], evidence,
 * score, tried, why, conclusion }`, or null when it has none yet. A step with no fix is a chain of one.
 * B706: a dropped fix that was checked is a try too (B670's B683, 72 of 75: dropped by the person, but tried); a dropped
 * one that never was checked is not (`chainTries` leaves every dropped fix out: it counts the attempts, this the story).
 */
export function triesOf(id, items) {
  const root = chainRootOf(id, items)
  const chain = [root]
  for (let at = 0; at < chain.length && chain.length < 50; at += 1) {
    for (const fix of fixesOf(chain[at], items)) {
      const fixId = valueOf(fix, 'Id')
      if (!chain.includes(fixId) && (valueOf(fix, 'State') !== 'dropped' || checkedOf(fix) !== null)) chain.push(fixId)
    }
  }
  return chain.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(at => {
    const one = items?.get(at)
    const check = checkedOf(one)
    return {
      id: at, title: valueOf(one, 'Title') ?? '', state: valueOf(one, 'State') ?? '',
      check: check === null ? null : {
        passed: check.passed, total: check.total, points: check.points, failed: check.points.filter(point => point.verdict === 'fail').map(point => point.text),
        evidence: check.evidence, score: check.score, tried: check.tried ?? null, why: check.why ?? null, conclusion: check.conclusion ?? null,
      },
    }
  })
}
