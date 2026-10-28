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
// the person's yes) and types `evaluate G<n>` to it, with the word that the goal's next steps are refined with Effort: high (their model as for any step, 2026-10-25).
// The partner's answer is a how-draft (src/focus.mjs): a corrected or rebuilt how, or the same how again ("keep
// going"); it counts as Go, so the count starts anew. A rebuild is the person's to approve (an ask of the goal whose
// title begins "Rebuild G<n>") unless "Approve rebuilds by itself" (config `approveRebuilds`) is on.
// B669 (the person, 2026-10-26: "yes" to counting per part): the third failure is counted per part, not per goal. A part
// is one 'Part:' line of the goal's how with the steps it names and every fix made from them (their `Fix of` chain); a goal
// without parts, or a step in no part, counts per chain (a step and its fixes). The guard trips when one part reaches the
// third failure, names that part, and its higher effort applies to that part's steps only; the other parts go on.
// B752 (the person, 2026-10-28, on the Fable ask: "I really hate this message ... after 2 attempts without significantly
// improvements it goes back to the person who managed the goals and redesigns a new approach instead of asking for
// opus/fable. give it the information what it tried and see what other options we have and present that to me"): no
// model question any more. A part trips at its second failed check when that one shows no real progress over the one
// before (`isRealProgress`), and always at its third; the evaluation starts at once on Opus at max, and the word to the
// partner carries what was tried (each step, its check, its evidence) and asks for 2 or 3 other ways for the person to
// pick. A "Fable asked" line from before still reads: an open ask under it is taken back and the evaluation starts.
// Work-agnostic: it reads the store's steps and the goal map, nothing of the project's work.

import { sinceMs } from './work/item.mjs'
import { checkedOf } from './work/resultCheck.mjs'

/** The failed checks since Go that fire the guard whatever they show. */
export const GUARD_ATTEMPTS = 3
/** B752: the failed checks that fire it already when the newest shows no real progress over the one before. */
export const GUARD_NO_PROGRESS = 2
/** B752: the rise of a check's score (a standard's, "score X of T" with T at least 50) that counts as real progress. */
export const PROGRESS_SCORE = 5

const SCORED = /\bscore (\d+) of (\d+)/
const PASSING = /\b(\d+) of (\d+) points? pass/
const COUNTED = /^(\d+) of (\d+)\b/

/**
 * B752: whether the failed check `after` is real progress over `before` (two failures of goalAttempts, their `summary`
 * the check's History line): its score rose by at least `PROGRESS_SCORE`, or fewer of its points fail while the share
 * that passes did not drop. A failure without numbers (a no to a look, a re-check) is no progress.
 */
export function isRealProgress(before, after) {
  const scoreOf = failure => {
    const found = String(failure?.summary ?? '').match(SCORED)
    return found === null || Number(found[2]) < 50 ? null : Number(found[1])
  }
  const [s0, s1] = [scoreOf(before), scoreOf(after)]
  if (s0 !== null && s1 !== null && s1 - s0 >= PROGRESS_SCORE) return true
  const pointsOf = failure => {
    const text = String(failure?.summary ?? '')
    const found = text.match(PASSING) ?? text.match(COUNTED)
    return found === null || Number(found[2]) === 0 ? null : { passed: Number(found[1]), total: Number(found[2]) }
  }
  const [p0, p1] = [pointsOf(before), pointsOf(after)]
  if (p0 === null || p1 === null) return false
  return p1.total - p1.passed < p0.total - p0.passed && p1.passed / p1.total >= p0.passed / p0.total
}

/**
 * B752: the place in `failures` (oldest first) where the guard trips: the second when it shows no real progress over the
 * first, else the third; -1 while it does not trip.
 */
export function tripIndexOf(failures) {
  for (let at = GUARD_NO_PROGRESS - 1; at < failures.length; at++) {
    if (at + 1 >= GUARD_ATTEMPTS || !isRealProgress(failures[at - 1], failures[at])) return at
  }
  return -1
}

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

const GOAL_GROUP = 'goal'
const cutWords = (text, chars) => (text.length > chars ? `${text.slice(0, chars - 1).trimEnd()}…` : text)

/** The step a fix chain starts from: `Fix of` followed up while the store holds the step it names. */
function rootOf(id, byId) {
  let at = id
  const seen = new Set()
  while (!seen.has(at)) {
    seen.add(at)
    const up = byId.get(at)?.head.get('Fix of')
    if (up === undefined || up === null || up === '') break
    at = up
  }
  return at
}

const byIdOf = items => (items instanceof Map ? items : new Map((items ?? []).map(item => [item.head.get('Id'), item])))

/**
 * B669: the group a step's failed checks are counted in: the goal's part that names the step or the step its fix chain
 * starts from (`key` part:<place>, `title` the part's), else the chain itself (`key` chain:<root>, `title` its first
 * step's id and title). `byId` the store's items by id.
 */
export function groupOfStep(node, byId, stepId) {
  const root = rootOf(stepId, byId)
  const place = (node?.parts ?? []).findIndex(part => part.steps.includes(stepId) || part.steps.includes(root))
  if (place >= 0) return { key: `part:${place}`, title: node.parts[place].title, isPart: true }
  const title = lineOf(byId.get(root)?.head.get('Title') ?? '')
  return { key: `chain:${root}`, title: title === '' ? root : cutWords(`${root} ${title}`, 40), isPart: false }
}

/**
 * The goal's failed checks, oldest first: `{ count, since, failures: [{ at, id, text, by, group }], groups, tripped }`.
 * `since` is the goal's Go, else its first refined step. A step's last failure carries the failed points its last check keeps; an earlier one,
 * its summary. A look the person answered no (`by: 'you'`) is an attempt of the goal its step belongs to.
 * B669: `groups` are the counts per part (or per chain) with failures, worst first: `{ key, title, isPart, steps, count, failures }`
 * (the goal's own re-checks and the looks at the goal itself, `key` 'goal', are one group of their own); `tripped` is the
 * group that tripped first (B752: its `trip`, `{ at, reason }`: the second failure without real progress, else the third),
 * else null. `count` stays the goal's total. A check's failure also carries its History line (`summary`), its step's
 * `title` and, on its last, the `evidence` picture.
 */
export function goalAttempts(node, items) {
  // An evaluation that ended starts the count anew, also for a goal whose how waits for the person's Go.
  const ended = [...(node?.evaluatedAt ?? [])].sort().at(-1) ?? ''
  const since = [node?.howAgreed ?? firstRefinedAt(node ?? {}, items), ended].sort().at(-1)
  const byId = byIdOf(items)
  const failures = []
  const steps = new Set()
  const grouped = new Map()
  const put = (group, failure) => {
    failures.push({ ...failure, group: group.key })
    if (!grouped.has(group.key)) grouped.set(group.key, { ...group, steps: new Set() })
    if (/^B\d+$/.test(failure.id)) grouped.get(group.key).steps.add(failure.id)
  }
  for (const item of items ?? []) {
    if (item.head.get('Kind') !== 'step' || item.head.get('Goal') !== node.id) continue
    const id = item.head.get('Id')
    steps.add(id)
    // The person, 2026-10-25 (G15's question, "yes"): a failed check whose fix passed counts no more; the step is done
    // once its fix passed. A fix that fails again counts while its chain is open.
    if (String(item.head.get('State') ?? '').toLowerCase() === 'done') continue
    const failed = (item.sections.get('History') ?? []).map(one => one.replace(/^[-*]\s+/, '').match(FAILED)).filter(one => one !== null && one[1] > since)
    const checked = checkedOf(item)
    const points = (checked?.points ?? []).filter(one => one.verdict === 'fail').map(one => one.text)
    const group = groupOfStep(node, byId, id)
    // B752: what was tried, for the word to the partner: the step's title, and the evidence of its last check.
    const title = lineOf(item.head.get('Title') ?? '')
    const evidence = lineOf(checked?.evidence ?? '')
    failed.forEach((found, place) => {
      const isLast = place === failed.length - 1
      put(group, {
        at: found[1], id, text: lineOf(isLast && points.length > 0 ? points.join('; ') : found[2]), by: 'check', summary: lineOf(found[2]), title,
        ...(isLast && /\.(?:png|jpe?g|gif|webp)$/i.test(evidence) ? { evidence } : {}),
      })
    })
  }
  const goalGroup = { key: GOAL_GROUP, title: 'Whole goal', isPart: false }
  for (const item of items ?? []) {
    if (item.head.get('Kind') !== 'ask' || item.head.get('Asks') !== 'look' || String(item.head.get('State') ?? '').toLowerCase() !== 'answered') continue
    const of = item.head.get('Of')
    if (of !== node.id && !steps.has(of)) continue
    const answer = (item.sections.get('Answer') ?? []).map(lineOf).filter(one => one !== '')
    if (answer.length === 0 || !SAID_NO.test(answer[0])) continue
    const at = historyOf(item).filter(one => /^person: answered/.test(one[2])).at(-1)?.[1]
    if (at === undefined || at <= since) continue
    put(of === node.id ? goalGroup : groupOfStep(node, byId, of), { at, id: item.head.get('Id'), text: lineOf(answer.join(' ')), by: 'you' })
  }
  for (const recheck of node.rechecks ?? []) {
    if (recheck.verdict === 'failed' && recheck.at > since) put(goalGroup, { at: recheck.at, id: node.id, text: lineOf(recheck.gap ?? recheck.summary), by: 'check' })
  }
  failures.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const groups = [...grouped.values()].map(group => {
    const own = failures.filter(one => one.group === group.key)
    // B752: where it trips: the second failure without real progress, else the third.
    const at = tripIndexOf(own)
    const trip = at < 0 ? null : { at: own[at].at, reason: at + 1 >= GUARD_ATTEMPTS ? 'third' : 'no progress' }
    return { key: group.key, title: group.title, isPart: group.isPart, steps: [...group.steps], count: own.length, failures: own, trip }
  })
  // Worst first; equal counts keep the order their first failures came in.
  const first = group => failures.findIndex(one => one.group === group.key)
  groups.sort((a, b) => b.count - a.count || first(a) - first(b))
  const tripAt = group => group.trip.at
  const tripped = groups.filter(group => group.trip !== null).sort((a, b) => (tripAt(a) < tripAt(b) ? -1 : tripAt(a) > tripAt(b) ? 1 : first(a) - first(b)))[0] ?? null
  return { count: failures.length, since: since === '' ? null : since, failures, groups, tripped }
}

/** B669: one group's attempts alone, in the shape the ask and the word to the partner read (`count`, `since`, `failures`). */
export const attemptsOfGroup = (attempts, group) => ({ count: group.count, since: attempts.since, failures: group.failures })

/**
 * B669: whether the evaluation of `node` covers the step `stepId`: every step when the evaluation is of the goal as a whole
 * (no part named in "Evaluation part:"), a step the goal's parts and the store do not know, and the steps of the named part.
 * `items` the store's, as a Map or an array.
 */
export function evaluationCovers(node, items, stepId) {
  const part = node?.evaluationPart ?? null
  if (part === null || stepId === undefined || stepId === null || stepId === '') return true
  const byId = byIdOf(items)
  if (!byId.has(stepId) && !(node.parts ?? []).some(one => one.steps.includes(stepId))) return true
  return groupOfStep(node, byId, stepId).title === part
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

/**
 * B669: where the evaluation stands for one step of the goal (`evaluationState`'s answer): a running evaluation of one part
 * covers that part's steps only, so the others stay null; an ended one and an evaluation of the goal as a whole are as they are.
 */
export function evaluationFor(node, items, stepId) {
  const state = evaluationState(node)
  return state === 'running' && !evaluationCovers(node, items, stepId) ? null : state
}

/** Whether the guard trips now: an open goal with one part tripped (`goalAttempts`), no ask of the board's and no evaluation running. */
export function needsEvaluation(node, items) {
  if (node === undefined || node === null || node.state === 'done') return false
  if ((node.evaluationAsked ?? null) !== null || (node.fableAsked ?? null) !== null) return false
  return goalAttempts(node, items).tripped !== null
}

const isOpenAsk = item => !['answered', 'withdrawn', 'dropped', 'closed', 'done'].includes(String(item.head.get('State') ?? '').toLowerCase())

/**
 * 2026-10-24 to 2026-10-28: the two answers of the board's ask before an evaluation ("Fable or Opus"). B752 ended that
 * ask; the answers are still read for an ask answered before (`modeOfAnswer`).
 */
export const FABLE_OPTIONS = ['A Yes: Fable 5.1 (max), only for this evaluation', 'B No: Opus 5.5 (max)']

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
 * What the guard does now for the goal: `{ do: 'start', ask, mode, gone, withdraw }` (the evaluation starts on `mode`), or
 * null (calm, running, done). B752: a trip starts it at once on Opus at max (`ask` null): no model question. A "Fable
 * asked" line from before: its answered ask keeps the mode it gave; an ask the store no longer holds (`gone`) starts it on
 * Opus and its line goes; an open one is taken back (`withdraw`) and it starts on Opus.
 */
export function guardStep(node, items) {
  if (node === undefined || node === null || node.state === 'done' || (node.evaluationAsked ?? null) !== null) return null
  const asked = node.fableAsked ?? null
  if (asked === null) return needsEvaluation(node, items) ? { do: 'start', ask: null, mode: 'high', gone: false, withdraw: false } : null
  const ask = itemOf(items, asked)
  if (ask === undefined) return { do: 'start', ask: asked, mode: 'high', gone: true, withdraw: false }
  if (isOpenAsk(ask)) return { do: 'start', ask: asked, mode: 'high', gone: false, withdraw: true }
  return { do: 'start', ask: asked, mode: modeOfAnswer(ask), gone: false, withdraw: false }
}

/** The board's ask a goal's trip still waits on (`Fable asked` from before B752, no evaluation running), else null: withdrawn when the trip ends. */
export const askingOf = node => ((node?.evaluationAsked ?? null) === null ? node?.fableAsked ?? null : null)

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

/** B669: the group of `attempts` the goal's evaluation is of ("Evaluation part:"), else null (the goal as a whole, or no failure of it left). */
export const evaluationPartOf = (node, attempts) => ((node?.evaluationPart ?? null) === null ? null : attempts.groups.find(group => group.title === node.evaluationPart) ?? null)

/**
 * The guard as the Focus page shows it: `{ attempts, parts, of, state, ask }` (`attempts` the worst part's failed checks, or
 * those of the part under evaluation; `parts` every part's, `{ title, count }`, worst first), state `counting` (attempts
 * so far), `asking` (the board asks the person, Fable or Opus: the ask `ask`), `evaluating` (the partner evaluates) or
 * `rebuild` (a rebuild waits for the person: the open ask `ask`).
 */
export function guardOf(node, items, asks) {
  if (node === undefined || node === null) return null
  const found = goalAttempts(node, items)
  const under = evaluationPartOf(node, found)
  const attempts = (under ?? found.groups[0])?.count ?? 0
  const parts = found.groups.map(group => ({ title: group.title, count: group.count }))
  // The part under evaluation, when the guard named one.
  const part = under === null ? {} : { part: under.title }
  // B701, B706: the first step of the chain the part's newest failed check is in (B691, not its fix B697), for the card
  // that opens its window ("what was tried"): the window of that step is the one the question is about.
  const newest = [...((under ?? found.groups[0])?.failures ?? [])].reverse().find(one => /^B\d+$/.test(one.id))?.id ?? null
  const stepId = newest === null ? null : rootOf(newest, byIdOf(items))
  const step = stepId === null ? {} : { step: stepId }
  if ((node.evaluationAsked ?? null) === null && (node.fableAsked ?? null) !== null) return { attempts, parts, ...part, ...step, of: GUARD_ATTEMPTS, state: 'asking', ask: node.fableAsked }
  if ((node.evaluationAsked ?? null) === null) return { attempts, parts, of: GUARD_ATTEMPTS, state: 'counting', ask: null }
  const rebuild = new RegExp(`^Rebuild ${node.id}\\b`, 'i')
  const waiting = (asks ?? []).find(one => one.head.get('Kind') === 'ask' && one.head.get('Of') === node.id && isOpenAsk(one) && rebuild.test(String(one.head.get('Title') ?? '')))
  return { attempts, parts, ...part, of: GUARD_ATTEMPTS, state: waiting === undefined ? 'evaluating' : 'rebuild', ask: waiting?.head.get('Id') ?? null }
}

/** B528: the longest a failed check's line runs in the word to the partner; its whole text stands in the step's History. */
const FAILURE_CHARS = 240
/** B528: the word fits the board's limit for a typed line (config `maxMessageChars`) unless the caller names another. */
const EVALUATE_CHARS = 2000

/**
 * The word to the partner: `evaluate G<n> <title>`, the failed checks since Go with what each tried (B752: the step's
 * title and its evidence), the answer it brings (2 or 3 other ways for the person to pick, or with "Approve rebuilds by
 * itself" its advised way at once), and where its job says how ("The fundamental evaluation", roles/partner.md). One
 * message of the outbox.
 * B528: it fits `maxChars` (the Workers mod refuses a longer line, and G15's 22 failed checks made 9459 characters that
 * never arrived): each failed check cut to one short line, the newest kept, the older ones counted. `again` (the time
 * "Evaluation asked" says) makes it the repeat of a word the evaluation has not ended yet.
 */
export function evaluateWords({ to, goal, attempts: all, part = null, approveRebuilds, job, maxChars = EVALUATE_CHARS, again = null }) {
  const cut = text => (text.length > FAILURE_CHARS ? `${text.slice(0, FAILURE_CHARS - 1).trimEnd()}…` : text)
  // B669: of a part the words are about that part alone (`part`, a group of goalAttempts); the other parts go on.
  const attempts = part === null ? all : attemptsOfGroup(all, part)
  const ofPart = part === null || part.key === GOAL_GROUP ? null : lineOf(part.title)
  const others = ofPart === null ? [] : all.groups.filter(group => group.key !== part.key)
  // B752: why it tripped: the second failed check without real progress, or the third.
  const trip = (part ?? all.tripped)?.trip ?? null
  const why = trip === null ? '' : trip.reason === 'no progress' ? ', the newest without real progress over the one before' : ''
  const head = [
    `evaluate ${goal.id} ${lineOf(goal.title)}${again === null ? '' : ` (again: asked ${again}, not evaluated yet)`}`,
    ...(ofPart === null ? [] : [`Part: ${ofPart}${part.steps.length > 0 ? ` (steps ${part.steps.join(', ')})` : ''}: the evaluation is of this part, the other parts go on`]),
    `Attempts: ${attempts.count} failed checks${ofPart === null ? '' : ' of this part'} since ${goal.howAgreed === attempts.since ? 'Go' : 'its first refined step'} (${attempts.since ?? 'the start'})${why}; what each tried:`,
    ...(others.length === 0 ? [] : [`Other parts: ${others.map(group => `${lineOf(group.title)} ${group.count}`).join(', ')}`]),
  ]
  // B752 (the person, 2026-10-28: "see what other options we have and present that to me"): other ways, never the same
  // way again and never a stronger model as the answer.
  const tail = [
    `Next steps: refine every next step of ${ofPart === null ? goal.id : `${goal.id}'s part ${ofPart}`} with Effort: high until the evaluation ends; its model as for any step (sonnet unless the step is hard)`,
    approveRebuilds === true
      ? 'Your answer: 2 or 3 different ways, not this way again, each with what it changes, why it may work and its cost; "Approve rebuilds by itself" is on: send your advised way\'s how-draft, marked, make its steps, and give the person a recap of the ways and your pick'
      : `Your answer: 2 or 3 different ways, not this way again, each with what it changes, why it may work and its cost; one work ask of ${goal.id} (decide, its title beginning "Rebuild ${goal.id}:", your advice, a picture per option where they differ in look); on the person's pick, its how-draft, marked`,
    `Your job: ${job}, "The fundamental evaluation"`,
  ]
  const tried = one => {
    if (one.by === 'you') return `${one.id}, your no to a look`
    if (one.id === goal.id) return `${one.id} re-check`
    const title = lineOf(one.title ?? '')
    return `${one.id}${title === '' ? '' : ` ${title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title}`}`
  }
  const failures = attempts.failures.map(one => cut(`- ${tried(one)} (${one.at})${one.evidence ? `, evidence ${one.evidence}` : ''}: ${one.text}`))
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
