// Autopilot (the person, 2026-10-31: "i kind of want to have an option to autoapprove and only get bothered by real issues
// and the product owner. so it will finish everything untill a goal is ready, the PO bothers me and only then i interact";
// on the plan: "yes to the plan go build"). From Go until a goal is ready everything runs by itself: mid-goal choices take
// the advised option and show later as "decided for you" with Undo; the person is asked only when a goal starts (its
// definition and work blocks), when it is ready (the Product owner brings the recap: approve or send back each work block),
// and for real issues (what no chat can do: accounts, money, permissions, an app restart; a goal stuck after its retries;
// the weekly limit). Mid-goal looks below their target wait for the goal's recap (the person's "A").
//
// It extends Partner answers (partnerAnswers.mjs, 2026-10-19): the setting `autopilot` (config.json, the ⚙ panel) is off
// unless the person switched it on. PURE: where an ask goes (`autopilotRoute`), whether it stands in Needs your attention
// (`standsForPerson`), and the words the board writes. The work API writes the routes (api.mjs `autopilot`), the server
// wakes the chats (server.mjs).
//
// Routes, kept in the ask's `Route` field:
// - `partner`: the partner answers it (or hands it on), as for Partner answers; the board's wake and 30-minute rule.
// - `advice`: the partner's or the Product owner's own ask with advice: the board answers it with the advice (`Answered by:
//   autopilot`), listed in the partner's daily note under "Decided for you" with Undo.
// - `recap`: a look the step's checker asks, a look of a step below its target, and the board's "Accept or send back" card: it
//   waits for the goal's recap (the Focus page lists it); the recap's answer closes it.
// - `main`: an action (a do ask): the main chat does it if a chat can, else hands it to the person (`escalate`).
// - `person`: everything goal level and what only the person can do; and an ask the partner or the main chat handed on.

import { askFiledMs, sinceMs, valueOf } from './item.mjs'
import { checkedOf } from './resultCheck.mjs'
import { standardOf } from './standard.mjs'

export const ROUTES = ['partner', 'advice', 'recap', 'main', 'person']
/** The routes that take an ask away from Needs your attention while it is open. */
export const ROUTED_AWAY = ['partner', 'advice', 'recap', 'main']

/** The settings panel's line under Autopilot, as the person agreed it (2026-10-31). */
export const AUTOPILOT_ON_WORDS = 'The work runs until a goal is ready. You are asked when a goal starts, when it is ready, and for what no chat can do. Everything else is decided for you, with Undo.'
export const AUTOPILOT_OFF_WORDS = 'Questions come to you as before.'
/** The one History line a route writes, once. */
export const routedWords = to => `autopilot: routed to ${to}`
/** The History line (and the daily note's why) of an answer the board took from the advice. */
export const TOOK_ADVICE = 'autopilot: took the advice'
/** The board's word to the main chat for an ask routed to it. */
export const mainAskWords = id => `autopilot: do ${id} if a chat can, else escalate it with one line why`
/** The feedback a refine question without advice goes back to the Advisor with, once per step. */
export const REFINE_BACK_WORDS = 'autopilot is on: decide it yourself and refine'
/** The step's History line of that send-back (the "once" is read from it). */
export const SENT_BACK = 'autopilot: sent back to the Advisor'
/** An ask the board has not routed yet stays out of Needs your attention this long (the board's next refresh routes it). */
export const ROUTE_GRACE_MS = 10 * 60_000
/** A refine question sent back to the Advisor stays out of Needs your attention this long, for its next round. */
export const SENT_BACK_MS = 30 * 60_000

const GOAL = /^G\d+$/
const text = item => (item?.sections?.get('Text') ?? []).join(' ').replace(/\s+/g, ' ').trim()
const title = item => String(valueOf(item, 'Title') ?? '').trim()
const historyOf = item => (item?.sections?.get('History') ?? []).map(String)

/** Whether the History holds the route's line already: the board routes an ask once. */
export const isAutopilotRouted = item => historyOf(item).some(one => / autopilot: routed to \w+$/.test(one))

/**
 * Whether an ask's `Route: person` is somebody's word: a line on its card (the partner or the main chat handed it on, the
 * board's timeout, the person took an answer back) or the board's own route. A bare `Route: person` is the default, which the
 * board may route again.
 */
export const isExplicitPerson = item => valueOf(item, 'Route') === 'person' && ((item?.sections?.get('Route') ?? []).some(one => one.trim() !== '') || isAutopilotRouted(item))

/** The options of an ask: its Options field, else the lettered options of its words ("A: ... B: ..."); `[{ letter, words }]`. */
export function optionsOf(item) {
  const own = String(valueOf(item, 'Options') ?? '').split(' | ').map(one => one.trim()).filter(Boolean)
  if (own.length > 0) {
    return own.map(label => {
      const found = label.match(/^([A-H])(?:[.:)]\s*|\s+[—–-]\s+|\s+)(.*)$/)
      return found === null ? { letter: null, words: label } : { letter: found[1], words: found[2].trim() }
    })
  }
  return letteredOptions(text(item))
}

/** The lettered options in a question's words ("Which? A: keep it, or B: drop it."), as the page reads them; [] for fewer than two. */
export function letteredOptions(words) {
  const body = String(words ?? '').replace(/\s+(?:Advised|Advice)\s*:\s*\S[\s\S]*$/i, '')
  const found = []
  for (const match of body.matchAll(/(?<=^|[\s(])([A-E])[:)](?=\s)/g)) {
    if (match[1] !== 'ABCDE'[found.length]) continue
    if (/\b(?:plan|option|step|part|type|variant|version|case|side|team|round|level|tier|grade)\s*$/i.test(body.slice(0, match.index))) continue
    found.push({ letter: match[1], at: match.index, end: match.index + match[0].length })
  }
  if (found.length < 2) return []
  return found.map((one, place) => {
    const isLast = place === found.length - 1
    let span = body.slice(one.end, isLast ? body.length : found[place + 1].at)
    // The last option ends before the question's own picture line and an "I advise" sentence.
    if (isLast) span = span.replace(/\s+(?:Picture|Pictures)\s*:\s[\s\S]*$/, '').replace(/\s+I(?:'d| would)? advise\b[\s\S]*$/i, '').replace(/\s+\[Open [^\]]*\]\([^)]*\)\s*$/, '')
    else span = span.replace(/[\s,;]*(?:\b(?:or|and)\b)?[\s,;]*$/i, '')
    return { letter: one.letter, words: span.replace(/\s+/g, ' ').trim().replace(/[\s,;]+$/, '') }
  })
}

/**
 * The advice an ask carries: its Advice field, else the advice in its words ("Advised: A", "I advise yes"); a letter
 * (upper case), "yes", "no", or the advice's own words. Null for none.
 */
export function adviceOf(item) {
  const field = String(valueOf(item, 'Advice') ?? '').trim()
  if (field !== '') return /^[a-e]$/i.test(field) ? field.toUpperCase() : /^(?:yes|no)$/i.test(field) ? field.toLowerCase() : field
  const words = [title(item), text(item)].join(' ')
  const found = words.match(/(?<![\w(])(?:Advised|Advice)\s*:\s*([A-E](?![\w'’])|yes\b|no\b)/i) ?? words.match(/\bI(?:'d| would)? advise\s+(?:option\s+)?([A-E](?![\w'’])|yes\b|no\b)/i)
  if (found === null) return null
  return /^[a-e]$/i.test(found[1]) ? found[1].toUpperCase() : found[1].toLowerCase()
}

/**
 * The answer the board writes for an ask's advice, as the person's pick would be: "<letter>: <option words>" for an advice
 * that names an option, else the advice as it is ("yes", "no", its words).
 */
export function adviceAnswerOf(item, advice = adviceOf(item)) {
  if (advice === null || advice === '') return null
  if (/^[A-H]$/.test(advice)) {
    const option = optionsOf(item).find(one => one.letter === advice)
    return option === undefined ? advice : option.words === '' ? advice : `${advice}: ${option.words}`
  }
  return advice
}

/**
 * A refine question as its step's block holds it ("<question> A: ... B: ... Advised: A — why"): `{ advice, answer }`, the
 * advice "yes", "no" or a letter, and the answer the board writes for it as "Take the advice" does ("yes", or "A: <words>");
 * both null without advice. As backlog.mjs reads a block's questions.
 */
export function refineAdviceOf(question) {
  const words = String(question ?? '').replace(/\s+Answer:\s[\s\S]*$/, '').trim()
  const yesNo = words.match(/^(.*?)\s+Advised:\s*(yes|no)\b/i)
  if (yesNo !== null) return { advice: yesNo[2].toLowerCase(), answer: yesNo[2].toLowerCase() }
  const lettered = words.match(/^(.*?)\s+[Aa]dvised:\s*([A-E])(?![\w'’])/)
  if (lettered === null) return { advice: null, answer: null }
  const option = letteredOptions(lettered[1]).find(one => one.letter === lettered[2])
  return { advice: lettered[2], answer: option === undefined || option.words === '' ? lettered[2] : `${lettered[2]}: ${option.words}` }
}

/** B810's words: a refine question that drops the step itself ("Drop B7?", "drop it"): never answered by the board. */
export const dropsStep = (question, stepId) => new RegExp(`\\bdrop (?:it|this step|${stepId})\\b`, 'i').test(String(question ?? '')) && !/\b(?:don'?t|not)\s+drop\b/i.test(String(question ?? ''))

/**
 * Goal level (the person's to answer): an ask of a goal (`Of: G<n>`: the partner's focus asks, the goal guard's, "Rebuild
 * G<n>"), the goal guard's own words, and the goal's recap or demo (its `#demo=` link or demo.json). The partner's and the
 * Product owner's asks about a goal's definition, its work blocks or a change of the goal too.
 */
export function isGoalLevel(item, role = null) {
  if (GOAL.test(valueOf(item, 'Of') ?? '')) return true
  const words = `${title(item)} ${text(item)}`
  if (/^Rebuild G\d+\b/.test(title(item)) || /\bG\d+\b[^.?!]*\bfailed \d+ times\b/.test(title(item))) return true
  if (/#demo=|\bdemo\.json\b|\bgoal(?:'s)? (?:recap|demo)\b/i.test(words)) return true
  return ['advisor', 'owner'].includes(role) && /\bgoal definition\b|\bwork blocks?\b|\bChange this goal\b|\bDid we reach the goal\b/i.test(words)
}

/** What no chat can do: the person's own accounts, money, permissions, the app itself, the week's limit. */
export const NEEDS_THE_PERSON = /\b(?:accounts?|passwords?|sign[- ]?in|log[- ]?in|billing|payments?|money|permissions?|weekly limit|week's limit|(?:Claude|the) app\b[^.?!]*\brestart|restart\b[^.?!]*\b(?:Claude|the) app\b)/i

/**
 * A chore asked as a yes/no question ("Restart the board on port 4310 so it shows the new popup? I advise yes"): no options,
 * the advice yes, and its question an action a chat can carry out. Routed as a do.
 */
export function isChore(item) {
  if ((valueOf(item, 'Asks') ?? 'decide') !== 'decide' || optionsOf(item).length > 0 || adviceOf(item) !== 'yes') return false
  return /^(?:please\s+)?(?:restart|reload|start|stop|merge|push|mark|tick|close|run|rerun|install|update|reset|clean)\b/i.test(title(item))
}

/** The step a look or card is of, when it is in review: whether its check stands below its target ("64 of 75"). */
export function belowTarget(step) {
  if (step === undefined || step === null || valueOf(step, 'State') !== 'review') return false
  const score = String(checkedOf(step)?.score ?? '').match(/(\d+)\s+of\s+(\d+)/)
  if (score === null) return false
  const target = Number(standardOf(step)?.match(/\btarget\s+(\d+)\b/i)?.[1] ?? score[2])
  return Number(score[1]) < target
}

const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}

/** Whether the ask's chat checks its step: it holds, or held, the step's Quality Assurance task. */
export function isByChecker(item, items, prefix = '') {
  const of = valueOf(item, 'Of')
  const owner = valueOf(item, 'Owner')
  if (of === null || owner === null) return false
  return [...(items?.values?.() ?? [])].some(one => valueOf(one, 'Checks') === of && plain(valueOf(one, 'Owner'), prefix) === plain(owner, prefix))
}

/**
 * Where an open ask goes while Autopilot is on: `{ to, why }`, `to` one of ROUTES. `ctx`: `roleOf(owner)` the asking chat's
 * role ('main', 'worker', 'advisor', 'helper', 'owner', 'supervisor', or null for none or one no longer on the list), `items`
 * the store's items by id, `focusGoal` the focus goal's id (or null), `prefix` the chats' title start.
 */
export function autopilotRoute(item, { roleOf = () => null, items = new Map(), focusGoal = null, prefix = '' } = {}) {
  const owner = valueOf(item, 'Owner')
  const role = owner === null || plain(owner) === 'server' ? 'board' : roleOf(owner) ?? 'worker'
  const kind = valueOf(item, 'Asks') ?? 'decide'
  const via = valueOf(item, 'Via')
  const of = valueOf(item, 'Of')
  const step = of === null || GOAL.test(of) ? undefined : items.get(of)
  const advice = adviceOf(item)
  const hasOptions = optionsOf(item).length > 0
  // A recap wait needs the focus goal's recap: a step of another goal (or none) is the person's.
  const recapOr = why => (step !== undefined && focusGoal !== null && valueOf(step, 'Goal') === focusGoal ? { to: 'recap', why } : { to: 'person', why: `${why}, and its step is of no focus goal` })
  if (isExplicitPerson(item)) return { to: 'person', why: 'handed to the person' }
  if (via === 'form') return { to: 'person', why: 'the app\'s question form is answered in its chat' }
  if (isGoalLevel(item, role)) return { to: 'person', why: 'goal level' }
  if (NEEDS_THE_PERSON.test(`${title(item)} ${text(item)}`)) return { to: 'person', why: 'no chat can do it' }
  if (via === 'accept') return recapOr('an accept or send back below its target')
  if (kind === 'look' && isByChecker(item, items, prefix)) return recapOr('a look of the step\'s checker')
  if (kind === 'look' && belowTarget(step)) return recapOr('a look below its target')
  if (role === 'board') return { to: 'person', why: 'the board\'s own card' }
  if (kind === 'do') return role === 'owner' ? { to: 'person', why: 'the Product owner\'s' } : { to: 'main', why: 'an action' }
  if (isChore(item) && role !== 'owner') return { to: 'main', why: 'an action asked as a question' }
  if (kind === 'provide') return { to: 'person', why: 'only the person provides it' }
  if (['advisor', 'helper', 'owner'].includes(role)) {
    // A refine question without advice goes back to the Advisor (`partner`); one with advice is answered with it.
    if (advice !== null) return { to: 'advice', why: 'the partner\'s own advice' }
    return via === 'refine' ? { to: 'partner', why: 'the Advisor decides it' } : { to: 'person', why: 'the partner gave no advice' }
  }
  if (kind === 'decide' || (kind === 'look' && (hasOptions || advice !== null))) return { to: 'partner', why: 'a detail question' }
  return { to: 'person', why: 'a look only the person judges' }
}

/**
 * Whether an open ask stands in Needs your attention: not while it is routed away (partner, advice, recap, main). While
 * Autopilot is on (`ctx.autopilot`), an ask the board has not routed yet stands only when it goes to the person, or when
 * it waited longer than ROUTE_GRACE_MS (nothing is lost when the board could not route it). A refine question: while the
 * board answers it with its advice, or it went back to the Advisor (SENT_BACK_MS), it stands nowhere. `now` is the time.
 */
export function standsForPerson(item, ctx = {}) {
  const route = valueOf(item, 'Route')
  if (ROUTED_AWAY.includes(route)) return false
  if (ctx.autopilot !== true || route === 'person') return true
  const filed = askFiledMs(item)
  const isYoung = Number.isFinite(filed) && Number.isFinite(ctx.now) && ctx.now - filed < ROUTE_GRACE_MS
  if (valueOf(item, 'Via') === 'refine') {
    const of = valueOf(item, 'Of')
    const step = of === null ? undefined : ctx.items?.get?.(of)
    const question = text(item)
    if (step !== undefined && dropsStep(question, of)) return true
    const sentAt = sentBackAt(step)
    if (refineAdviceOf(question).advice === null && Number.isFinite(sentAt)) {
      // Sent back for this question (after it was filed): its next round comes; sent back before it: once only, it is theirs.
      return !(Number.isFinite(filed) && sentAt >= filed - 60_000 && ctx.now - sentAt < SENT_BACK_MS)
    }
    return !isYoung
  }
  if (isYoung && autopilotRoute(item, ctx).to !== 'person') return false
  return true
}

/** When the board sent the step's refine back to the Advisor (ms), or NaN. */
export function sentBackAt(step) {
  const line = historyOf(step).findLast(one => one.includes(SENT_BACK))
  return line === undefined ? Number.NaN : sinceMs(line.match(/^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d)/)?.[1])
}

/** When the board routed the ask (ms, its History line's minute), or NaN. */
export function routedAt(item, to = null) {
  const line = historyOf(item).findLast(one => (to === null ? / autopilot: routed to \w+$/ : new RegExp(` autopilot: routed to ${to}$`)).test(one))
  return line === undefined ? Number.NaN : sinceMs(line.match(/^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d)/)?.[1])
}

/** The card line of an ask the board routed back to the person (its step's goal is no longer the focus). */
export const recapGoneWords = 'Its goal is not the focus now, so its recap will not come: it is yours'
