// B359: the goal guard. The person, 2026-10-18 21:18: "after a couple of attempts and it keeps failing the goal it
// will fundamentally evaluate with a higher model if the current approach is right, and might require a big rebuild to
// reach the goal. this will normally require an approval from the user, but can be automatically approved."
//
// A goal's attempts are its failed checks, counted from its Go (How agreed) or, without a how, from its first refined
// step (B450): every failed result check of its steps (a fix step carries its goal too), every failed re-check of the
// goal itself, and every look of one of its steps that the person answered no or rejected. The third fires the guard
// once. Since 2026-10-24 the board first asks the person (the person: "on 3 failed attempts is important context. i want
// to be asked. hey this task failed 3 times, we would like to evaluate strategy using fable. yes, or no use opus."): one
// ask of the goal, A Yes: Fable 5.1 at max for this evaluation only, B No: Opus 5.5 at max, and "Fable asked: Q<n>" under it.
// On the answer the board writes "Evaluation asked: <date time>", switches the partner to that mode (B352; Fable only on
// the person's yes) and types `evaluate G<n>` to it, with the word that the goal's next steps are refined on Model: opus and Effort: high.
// The partner's answer is a how-draft (src/focus.mjs): a corrected or rebuilt how, or the same how again ("keep
// going"); it counts as Go, so the count starts anew. A rebuild is the person's to approve (an ask of the goal whose
// title begins "Rebuild G<n>") unless "Approve rebuilds by itself" (config `approveRebuilds`) is on.
// Work-agnostic: it reads the store's steps and the goal map, nothing of the project's work.

import { sinceMs } from './work/item.mjs'
import { checkedOf } from './work/resultCheck.mjs'

/** The failed checks since Go that fire the guard. */
export const GUARD_ATTEMPTS = 3

const FAILED = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) [^:]+: result check failed: ([^;]*)/
const lineOf = text => String(text ?? '').replace(/\s+/g, ' ').trim()

const STAMPED = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (.*)$/
const historyOf = item => (item.sections.get('History') ?? []).map(one => one.replace(/^[-*]\s+/, '').match(STAMPED)).filter(one => one !== null)
/** The first line of an answer that says no: "B no, say what to change ...", "Rejected. ...", "No". */
const SAID_NO = /^(?:[A-Z]\s+)?(?:rejected|no)\b/i

/** The time the goal's first step was refined: its earliest "refined" history line, else its earliest line; '' with no steps. */
function firstRefinedAt(node, items) {
  const own = []
  for (const item of items ?? []) {
    if (item.head.get('Kind') !== 'step' || item.head.get('Goal') !== node.id) continue
    const lines = historyOf(item)
    own.push((lines.find(one => /refined/i.test(one[2])) ?? lines[0])?.[1])
  }
  return own.filter(one => one !== undefined).sort()[0] ?? ''
}

/**
 * The goal's failed checks, oldest first: `{ count, since, failures: [{ at, id, text, by }] }`. `since` is the goal's
 * Go, else its first refined step. A step's last failure carries the failed points its last check keeps; an earlier one,
 * its summary. A look the person answered no (`by: 'you'`) is an attempt of the goal its step belongs to.
 */
export function goalAttempts(node, items) {
  // An evaluation that ended starts the count anew, also for a goal whose how waits for the person's Go.
  const ended = [...(node?.evaluatedAt ?? [])].sort().at(-1) ?? ''
  const since = [node?.howAgreed ?? firstRefinedAt(node ?? {}, items), ended].sort().at(-1)
  const failures = []
  const steps = new Set()
  for (const item of items ?? []) {
    if (item.head.get('Kind') !== 'step' || item.head.get('Goal') !== node.id) continue
    const id = item.head.get('Id')
    steps.add(id)
    const failed = (item.sections.get('History') ?? []).map(one => one.replace(/^[-*]\s+/, '').match(FAILED)).filter(one => one !== null && one[1] > since)
    const points = (checkedOf(item)?.points ?? []).filter(one => one.verdict === 'fail').map(one => one.text)
    failed.forEach((found, place) => {
      const isLast = place === failed.length - 1
      failures.push({ at: found[1], id, text: lineOf(isLast && points.length > 0 ? points.join('; ') : found[2]), by: 'check' })
    })
  }
  for (const item of items ?? []) {
    if (item.head.get('Kind') !== 'ask' || item.head.get('Asks') !== 'look' || String(item.head.get('State') ?? '').toLowerCase() !== 'answered') continue
    const of = item.head.get('Of')
    if (of !== node.id && !steps.has(of)) continue
    const answer = (item.sections.get('Answer') ?? []).map(lineOf).filter(one => one !== '')
    if (answer.length === 0 || !SAID_NO.test(answer[0])) continue
    const at = historyOf(item).filter(one => /^person: answered/.test(one[2])).at(-1)?.[1]
    if (at === undefined || at <= since) continue
    failures.push({ at, id: item.head.get('Id'), text: lineOf(answer.join(' ')), by: 'you' })
  }
  for (const recheck of node.rechecks ?? []) {
    if (recheck.verdict === 'failed' && recheck.at > since) failures.push({ at: recheck.at, id: node.id, text: lineOf(recheck.gap ?? recheck.summary), by: 'check' })
  }
  failures.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return { count: failures.length, since: since === '' ? null : since, failures }
}

/**
 * B518, B525: where the goal's evaluation stands for the work tool: 'running' while the partner evaluates, 'ended' from its
 * marked draft until the next Go (a Go after the evaluation ended; the draft of a goal with an agreed how counts as Go
 * itself, at the same time), else null. A goal that is done has none.
 */
export function evaluationState(node) {
  if (node === undefined || node === null || node.state === 'done') return null
  if ((node.evaluationAsked ?? null) !== null) return 'running'
  const ended = [...(node.evaluatedAt ?? [])].sort().at(-1)
  if (ended === undefined) return null
  return node.howAgreed === null || node.howAgreed <= ended ? 'ended' : null
}

/** Whether the guard trips now: an open goal at its third failed attempt, no ask of the board's and no evaluation running. */
export function needsEvaluation(node, items) {
  if (node === undefined || node === null || node.state === 'done') return false
  if ((node.evaluationAsked ?? null) !== null || (node.fableAsked ?? null) !== null) return false
  return goalAttempts(node, items).count >= GUARD_ATTEMPTS
}

const isOpenAsk = item => !['answered', 'withdrawn', 'dropped', 'closed', 'done'].includes(String(item.head.get('State') ?? '').toLowerCase())

/**
 * 2026-10-24: the two answers of the board's ask before an evaluation, in the person's framing ("we would like to evaluate
 * strategy using fable. yes, or no use opus"); no advice: it is the person's call.
 */
export const FABLE_OPTIONS = ['A Yes: Fable 5.1 (max), only for this evaluation', 'B No: Opus 5.5 (max)']
/** The board's ask by its title, "G<n> failed <n> times: evaluate the strategy with Fable?". */
const FABLE_TITLE = /^G\d+ failed \d+ times: evaluate the strategy with Fable\?$/
const cutTo = (text, chars) => (text.length > chars ? `${text.slice(0, chars - 1).trimEnd()}…` : text)

/**
 * 2026-10-24: the ask the board files (as the board, through the work API) when the guard trips: kind decide, blocking,
 * of the goal, its title the question, two plain lines (what failed; what Fable costs), A Fable and B Opus, no advice.
 */
export function fableAskOf({ goal, attempts }) {
  const last = attempts.failures.at(-1)
  const who = last === undefined ? '' : last.by === 'you' ? `your no to ${last.id}` : last.id === goal.id ? `${goal.id}'s re-check` : last.id
  const latest = last === undefined ? '' : `; the latest, ${who}: ${cutTo(last.text, 160)}`
  const since = attempts.since !== null && attempts.since === goal.howAgreed ? 'Go' : 'its first refined step'
  return {
    action: 'ask', of: goal.id, kind: 'decide', blocking: true,
    title: `${goal.id} failed ${attempts.count} times: evaluate the strategy with Fable?`,
    text: [
      `${goal.id} ${lineOf(goal.title)}: ${attempts.count} checks failed since ${since}${latest}${/[.!?…]$/.test(latest) ? '' : '.'}`,
      'Your partner now evaluates whether the approach is right. Fable 5.1 is the strongest model but uses far more tokens than Opus 5.5; nothing starts before your answer.',
    ].join('\n'),
    options: [...FABLE_OPTIONS],
  }
}

const wordsOf = text => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
/** The words of option A after its letter: yes, fable, 5, 1, max, only, for, this, evaluation. */
const YES_WORDS = wordsOf(FABLE_OPTIONS[0].replace(/^A\s+/, ''))

/**
 * 2026-10-24: the partner's mode for the evaluation the person answered: 'fable' only for the person's yes: an answer
 * that is A alone (any case, its punctuation), A followed by its option's words ("A Yes: Fable 5.1 (max), ...", "A: yes"),
 * or whose first word is yes. Everything else (B, a no, "a bit pricey, use opus", other words, no answer, withdrawn, an
 * answer by the partner) is Opus at max, 'high'.
 */
export function modeOfAnswer(item) {
  if (item === undefined || item === null || String(item.head.get('State') ?? '').toLowerCase() !== 'answered') return 'high'
  if (item.head.get('Answered by') === 'partner') return 'high'
  const first = (item.sections.get('Answer') ?? []).map(lineOf).find(one => one !== '') ?? ''
  if (/^a[.!:)]*$/i.test(first) || /^yes\b/i.test(first)) return 'fable'
  const lettered = first.match(/^a(?:\s+|\s*[:.)]\s*)(.+)$/i)
  if (lettered === null) return 'high'
  const said = wordsOf(lettered[1])
  const isPrefix = (short, long) => short.length > 0 && short.length <= long.length && short.every((word, at) => word === long[at])
  // The recheck: "A Fable" and "A fable 5.1" are option A's words without its yes.
  const fableWords = YES_WORDS.slice(YES_WORDS.indexOf('fable'))
  return isPrefix(said, YES_WORDS) || isPrefix(YES_WORDS, said) || isPrefix(said, fableWords) ? 'fable' : 'high'
}

const itemOf = (items, id) => [...(items ?? [])].find(item => item.head.get('Id') === id)

/**
 * 2026-10-24: what the guard does now for the goal: `{ do: 'ask' }` (it trips: ask the person), `{ do: 'wait', ask }`
 * (the ask stands open), `{ do: 'start', ask, mode, gone }` (answered or no longer open: the evaluation starts on that
 * mode; an ask the store no longer holds, `gone`, starts it on Opus and its line goes), or null (calm, running, done).
 * The guard reads the store's items fresh, after the ask was filed and its line written, so a missing ask is a deleted one.
 */
export function guardStep(node, items) {
  if (node === undefined || node === null || node.state === 'done' || (node.evaluationAsked ?? null) !== null) return null
  const asked = node.fableAsked ?? null
  if (asked === null) return needsEvaluation(node, items) ? { do: 'ask' } : null
  const ask = itemOf(items, asked)
  if (ask === undefined) return { do: 'start', ask: asked, mode: 'high', gone: true }
  if (isOpenAsk(ask)) return { do: 'wait', ask: asked }
  return { do: 'start', ask: asked, mode: modeOfAnswer(ask), gone: false }
}

/** The board's ask a goal's trip still waits on (`Fable asked` with no evaluation running), else null: withdrawn when the trip ends. */
export const askingOf = node => ((node?.evaluationAsked ?? null) === null ? node?.fableAsked ?? null : null)

/** An open ask of the board's before an evaluation of the goal, if one stands (its line lost): used again, never filed twice. */
export function openFableAsk(goalId, items) {
  return [...(items ?? [])].find(item => item.head.get('Kind') === 'ask' && item.head.get('Owner') === 'server' && item.head.get('Of') === goalId
    && isOpenAsk(item) && FABLE_TITLE.test(String(item.head.get('Title') ?? ''))) ?? null
}

/** The mode a running evaluation needs: 'fable' only when the ask under it was answered yes, else 'high' (Opus at max). */
export function evaluationMode(node, items) {
  const asked = node?.fableAsked ?? null
  return asked === null ? 'high' : modeOfAnswer(itemOf(items, asked))
}

/**
 * The partner's mode while evaluations run (`nodes` the goal map's): 'usual' when none runs, 'fable' when every one that
 * runs had the person's yes (`yes` its ask), else 'high'. So Fable never stays on for an evaluation without a yes.
 */
export function partnerModeFor(nodes, items) {
  const running = (nodes ?? []).filter(node => node.state !== 'done' && (node.evaluationAsked ?? null) !== null)
  if (running.length === 0) return { mode: 'usual', yes: null }
  const isFable = running.every(node => /^Q\d+$/.test(node.fableAsked ?? '') && evaluationMode(node, items) === 'fable')
  return isFable ? { mode: 'fable', yes: running[0].fableAsked } : { mode: 'high', yes: null }
}

/**
 * The guard as the Focus page shows it: `{ attempts, of, state, ask }`, state `counting` (attempts so far), `asking` (the
 * board asks the person, Fable or Opus: the ask `ask`), `evaluating` (the partner evaluates) or `rebuild` (a rebuild waits
 * for the person: the open ask `ask`).
 */
export function guardOf(node, items, asks) {
  if (node === undefined || node === null) return null
  const attempts = goalAttempts(node, items).count
  if ((node.evaluationAsked ?? null) === null && (node.fableAsked ?? null) !== null) return { attempts, of: GUARD_ATTEMPTS, state: 'asking', ask: node.fableAsked }
  if ((node.evaluationAsked ?? null) === null) return { attempts, of: GUARD_ATTEMPTS, state: 'counting', ask: null }
  const rebuild = new RegExp(`^Rebuild ${node.id}\\b`, 'i')
  const waiting = (asks ?? []).find(one => one.head.get('Kind') === 'ask' && one.head.get('Of') === node.id && isOpenAsk(one) && rebuild.test(String(one.head.get('Title') ?? '')))
  return { attempts, of: GUARD_ATTEMPTS, state: waiting === undefined ? 'evaluating' : 'rebuild', ask: waiting?.head.get('Id') ?? null }
}

/** B528: the longest a failed check's line runs in the word to the partner; its whole text stands in the step's History. */
const FAILURE_CHARS = 240
/** B528: the word fits the board's limit for a typed line (config `maxMessageChars`) unless the caller names another. */
const EVALUATE_CHARS = 2000

/**
 * The word to the partner: `evaluate G<n> <title>`, the failed checks since Go, whether a rebuild needs the person's
 * yes, and where its job says how ("The fundamental evaluation", roles/partner.md). One message of the outbox.
 * B528: it fits `maxChars` (the Workers mod refuses a longer line, and G15's 22 failed checks made 9459 characters that
 * never arrived): each failed check cut to one short line, the newest kept, the older ones counted. `again` (the time
 * "Evaluation asked" says) makes it the repeat of a word the evaluation has not ended yet.
 */
export function evaluateWords({ to, goal, attempts, approveRebuilds, job, maxChars = EVALUATE_CHARS, again = null }) {
  const cut = text => (text.length > FAILURE_CHARS ? `${text.slice(0, FAILURE_CHARS - 1).trimEnd()}…` : text)
  const head = [
    `evaluate ${goal.id} ${lineOf(goal.title)}${again === null ? '' : ` (again: asked ${again}, not evaluated yet)`}`,
    `Attempts: ${attempts.count} failed checks since ${goal.howAgreed === attempts.since ? 'Go' : 'its first refined step'} (${attempts.since ?? 'the start'})`,
  ]
  const tail = [
    `Next steps: refine every next step of ${goal.id} with Model: opus and Effort: high until the evaluation ends`,
    approveRebuilds === true
      ? 'Rebuilds: approved by the board ("Approve rebuilds by itself" is on): make its steps at once and give the person a recap'
      : 'Rebuilds: ask the person first (decide); "Approve rebuilds by itself" is off',
    `Your job: ${job}, "The fundamental evaluation"`,
  ]
  const failures = attempts.failures.map(one => cut(`- ${one.by === 'you' ? `${one.id}, your no to a look` : one.id === goal.id ? `${one.id} re-check` : one.id} (${one.at}): ${one.text}`))
  // The newest failed checks that fit, oldest first; the room for the line that counts the rest is kept.
  const earlier = n => `- and ${n} earlier failed ${n === 1 ? 'check' : 'checks'}: the goal's steps' History holds them`
  let room = maxChars - [...head, ...tail].join('\n').length - earlier(failures.length).length - 2
  const kept = []
  for (const line of failures.toReversed()) {
    if (line.length + 1 > room) break
    room -= line.length + 1
    kept.unshift(line)
  }
  const left = failures.length - kept.length
  const lines = [...head, ...(left > 0 ? [earlier(left)] : []), ...kept, ...tail]
  return { to, ask: null, step: null, title: null, version: null, verdict: null, command: 'evaluate', about: goal.id, text: lines.join('\n') }
}

/** B528: while a goal's evaluation runs and has not ended, its word goes to the partner again this often. */
export const EVALUATE_AGAIN_MS = 30 * 60_000

/**
 * B528: the goals whose word goes to the partner again now: an open goal with "Evaluation asked" whose last `evaluate`
 * word about it in the outbox (else the time "Evaluation asked" says) is `EVALUATE_AGAIN_MS` old. A word the chat could
 * not type (failed, expired) counts as sent then: the ask is kept, and the next word goes at the same pace.
 */
export function evaluationsDue(nodes, outbox, now) {
  const due = []
  for (const node of nodes ?? []) {
    if (node.state === 'done' || (node.evaluationAsked ?? null) === null) continue
    const last = (outbox ?? []).findLast(message => message.command === 'evaluate' && message.about === node.id)
    const since = last?.at ?? sinceMs(node.evaluationAsked)
    if (Number.isFinite(since) && now - since >= EVALUATE_AGAIN_MS) due.push(node)
  }
  return due
}
