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
// - `advice`: the partner's or the Product owner's own ask with advice, under a step: the board answers it with the advice
//   (`Answered by: autopilot`), listed in the partner's daily note under "Decided for you" with Undo.
// - `recap`: a look the step's checker asks, a look of a step below its target, and the board's "Accept or send back" card, of
//   a step of the focus goal whose recap will name it: it waits for the goal's recap (the Focus page lists it; its step reads
//   `Recap verdict: waits (Q<n>)`, so the goal demo is asked with the step in review and gives it its own row); the person's
//   verdict on that row closes it. With Autopilot off it stands in Needs your attention again. So does an ask the focus goal's
//   recap asks already (2026-11-02): the goal's "open the recap and try it" (a Do, or a look with no options or advice, with a
//   `#demo=` link to that recap; closed by the person's Send), and a look of a worker's about a step that the recap names (its
//   pictures name the step: it is put under that step first, `recapAskOf`). And (2026-11-02, the person's "A") every new look of
//   a step of the focus goal, whatever the recap names (`focusLookOf`): the partner's hand-over of one is kept there too.
// - `main`: an action (a do ask) a chat can do: the main chat does it, else hands it to the person (`escalate`).
// - `person`: everything goal level (a stuck goal's rebuild too: Autopilot approves no rebuild), what only the person's hands
//   can do (PERSONS_HANDS), what marks a step done, accepts it or sends it back, an ask under no step from the partner, and
//   an ask the partner or the main chat handed on.

import { askFiledMs, sinceMs, valueOf } from './item.mjs'
import { chainWaitOf, checkedOf, fixesOf } from './resultCheck.mjs'
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
const STEP = /^B\d+$/
const text = item => (item?.sections?.get('Text') ?? []).join(' ').replace(/\s+/g, ' ').trim()
const title = item => String(valueOf(item, 'Title') ?? '').trim()
const historyOf = item => (item?.sections?.get('History') ?? []).map(String)

/** Whether the History holds the route's line already: the board routes an ask once. */
export const isAutopilotRouted = item => historyOf(item).some(one => / autopilot: routed to \w+$/.test(one))

/**
 * Whether an ask's `Route: person` is only the board's own route: its History says "autopilot: routed to person" and nothing
 * is written on its card (no chat handed it on, the person took no answer back). The switch-on's sweep judges such an ask anew
 * (the person, 2026-11-02: "if autopilot is turned on, the outstanding, needing for attentions get reevaluated and possible
 * resolved if autopilot would answer them"); an ask somebody handed to the person is never judged again.
 */
export const isBoardRoutedPerson = item => valueOf(item, 'Route') === 'person' && isAutopilotRouted(item) && !(item?.sections?.get('Route') ?? []).some(one => one.trim() !== '')

/**
 * Whether an ask's `Route: person` is somebody's word: a line on its card (the partner or the main chat handed it on, the
 * board's timeout, the person took an answer back) or the board's own route. A bare `Route: person` is the default, which the
 * board may route again.
 */
export const isExplicitPerson = item => valueOf(item, 'Route') === 'person' && ((item?.sections?.get('Route') ?? []).some(one => one.trim() !== '') || isAutopilotRouted(item))

/** The focus goal's recap file: the path of a row of its recap (src/recaps.mjs `recapWaitsOf`), or null for none. */
export const focusRecapPathOf = (recapSteps, focusGoal) => (focusGoal === null || focusGoal === undefined ? null
  : (recapSteps ?? []).find(one => one.goal === focusGoal && typeof one.path === 'string' && one.path !== '')?.path ?? null)
const slashed = path => String(path ?? '').replace(/\\/g, '/').toLowerCase()
/** Whether words link a recap file: they hold `demo=<its path>` (the link the board's page opens the recap with). */
export const linksRecap = (words, path) => typeof path === 'string' && path !== '' && slashed(words).includes(`demo=${slashed(path)}`)
/** The step ids a picture list names: `B<n>`, not inside a longer word ("pictures/B889/evidence.png, pictures/B890/a.png"). */
const stepIdsIn = pictures => String(pictures ?? '').match(/(?<!\w)B\d+(?!\w)/g) ?? []

/**
 * An ask the focus goal's recap asks already (the person, 2026-11-02, on a 47-hour-old Do card "Open the recap and try it": "if
 * autopilot is turned on, the outstanding, needing for attentions get reevaluated and possible resolved if autopilot would
 * answer them"), for an ask under no step: `{ to: 'recap', why }`, or null. The whole goal (the live Q569): a Do, or a look with no
 * options and no advice, whose words link the recap (`demo=<the recap's path>`); the person's Send in the recap closes it. Any
 * other ask that links the recap (a decide, a look with options or advice: "Is the recap page what you wanted to see before
 * approving G60?", the live Q550) is a question the Send does not answer: it keeps its old route, the person's. Its step (the live
 * Q578, a look with the picture `pictures/B889/evidence.png`): a worker's look or decide whose `Pictures` name (never its title or
 * words) a step of the focus goal that a part of the recap names; the ask is put under that step (`step`, the first such id) and
 * waits for the recap as any ask of a step does. The partner's and the Product owner's asks under no step stay the person's
 * (they answer for the goal), as does any ask of a recap of a goal that is not the focus. `recapSteps`: src/recaps.mjs
 * `recapWaitsOf`; `items`: the store's, for the step's goal (a step of another goal is left to the person, so the pass never
 * moves an ask and hands it back in one go).
 */
export function recapAskOf(item, { focusGoal = null, recapSteps = [], items = new Map() } = {}, role = null) {
  const path = focusRecapPathOf(recapSteps, focusGoal)
  if (path === null || valueOf(item, 'Of') !== null) return null
  const kind = valueOf(item, 'Asks') ?? 'decide'
  if (linksRecap(`${title(item)} ${text(item)}`, path)) {
    const isTry = kind === 'do' || (kind === 'look' && optionsOf(item).length === 0 && adviceOf(item) === null)
    return isTry ? { to: 'recap', why: 'the goal\'s recap asks it already' } : null
  }
  if (!['look', 'decide'].includes(kind) || !['worker', 'main'].includes(role)) return null
  const named = new Set((recapSteps ?? []).filter(one => one.goal === focusGoal).map(one => one.step))
  const step = stepIdsIn(valueOf(item, 'Pictures')).find(id => named.has(id) && items?.get?.(id) !== undefined && valueOf(items.get(id), 'Goal') === focusGoal) ?? null
  return step === null ? null : { to: 'recap', why: 'its step\'s part of the goal\'s recap asks it already', step }
}

/** The why of an ask a new look of the focus goal puts on the recap (`focusLookOf`). */
export const FOCUS_LOOK_WHY = 'a new look of the focus goal waits for its recap'
/** The Route line of a partner's hand-over of a look that Autopilot keeps for the goal's recap instead (the person's "A", 2026-11-02). */
export const HANDED_KEPT_WORDS = 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap'
/** The askers whose looks are not a worker's detail: the Product owner's (it answers for the goal) and the board's own cards. */
const NOT_LOOKERS = ['owner', 'board']
const PARTNER_HANDS_LINE = /^Your partner hands this to you: (.*)$/

/**
 * A new look of the focus goal (the person, 2026-11-02, seeing Worker 1's look "Does the wizard's move range on the Terraces look
 * right?" under Needs your attention with Autopilot on: "Why is he asking me for it. this is autopilot is turned on correct?"; their
 * choice "A": a new look on a step of the focus goal waits for that goal's recap instead of reaching them mid-goal): `{ step,
 * isInferred }`, or null. A look (any role but the Product owner's, which answers for the goal) of a step of the focus goal in the
 * store: its `Of`, else (an ask under no step) the first step its `Pictures` name (never its title or words) that is one, the
 * ask put under it (`isInferred`, as `recapAskOf` does). No recap row has to name the step, and the goal's demo may exist
 * already: the person judges the look in its window, and the recap card lists it as a tile of its own. A look of another goal
 * keeps its route. `items`: the store's, for each step's goal.
 */
export function focusLookOf(item, { focusGoal = null, items = new Map() } = {}, role = null) {
  if (focusGoal === null || focusGoal === undefined || (valueOf(item, 'Asks') ?? 'decide') !== 'look' || NOT_LOOKERS.includes(role)) return null
  const isFocusStep = id => STEP.test(id ?? '') && items?.get?.(id) !== undefined && valueOf(items.get(id), 'Goal') === focusGoal
  const of = valueOf(item, 'Of')
  if (of !== null) return isFocusStep(of) ? { step: of, isInferred: false } : null
  const step = stepIdsIn(valueOf(item, 'Pictures')).find(isFocusStep) ?? null
  return step === null ? null : { step, isInferred: true }
}

/**
 * The partner's own hand-over of an ask to the person (the work API's `escalate`, 2026-10-19): the why it gave, or null. Its
 * History holds "to the person: <why>" by a chat (never the board's: the board's timeout and the main chat's hand-over are other
 * reasons), and its Route section is the partner's one line, "Your partner hands this to you: <why>". Never an ask the person took
 * back (the Undo writes its own line there) nor one the board handed back (its own words).
 */
export function partnerHandOverOf(item) {
  if (valueOf(item, 'Route') !== 'person') return null
  const card = (item?.sections?.get('Route') ?? []).map(one => one.trim()).filter(Boolean)
  const why = card.length === 1 ? card[0].match(PARTNER_HANDS_LINE)?.[1] ?? null : null
  if (why === null) return null
  return historyOf(item).some(one => /^-\s+[\d: -]+? (?!server:)[^:]+: to the person: /.test(one)) ? why : null
}

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
 * G<n>"), the goal guard's own words, and the goal's recap or demo (its `#demo=` link or demo.json). The coordinator's ruling
 * (2026-10-31, "Autopilot On must never ask the person more than Off for asks under a step"): the goal-level words apply only
 * to an ask under no step: "the goal's recap", a title about a goal, the focus, an approach, a setting, a standard or a
 * licence (ABOUT_GOAL), and the partner's and the Product owner's words about a goal's definition, its work blocks or a change
 * of the goal. The phrase that made it goal level, or null.
 */
export function goalLevelOf(item, role = null) {
  if (GOAL.test(valueOf(item, 'Of') ?? '')) return `of ${valueOf(item, 'Of')}`
  const words = `${title(item)} ${text(item)}`
  const guard = title(item).match(/^Rebuild G\d+\b|\bG\d+\b[^.?!]*\bfailed \d+ times\b/)?.[0] ?? words.match(/#demo=|\bdemo\.json\b/i)?.[0] ?? null
  if (guard !== null) return guard
  if (STEP.test(valueOf(item, 'Of') ?? '')) return null
  const said = words.match(/\bgoal(?:'s)? (?:recap|demo)\b/i)?.[0] ?? title(item).match(ABOUT_GOAL)?.[0] ?? null
  if (said !== null) return said
  return ['advisor', 'owner'].includes(role) ? words.match(/\bgoal definition\b|\bwork blocks?\b|\bChange this goal\b|\bDid we reach the goal\b/i)?.[0] ?? null : null
}
/** Whether an ask is goal level (`goalLevelOf`). */
export const isGoalLevel = (item, role = null) => goalLevelOf(item, role) !== null

/**
 * A question about a goal, the focus, the goal map, an approach, a setting, a standard (the person's map bar) or a licence
 * (its title), for an ask under no step: the person's. Whole phrases (the re-review of 2026-10-31: "the settings page's
 * previews" of the game, "the new goal steps panel" of the board and "levels-g28" are no goal questions): a goal by its id,
 * "the goal", "the focus", "goal map", an approach, "a setting" of the board, a standard, the map bar, a licence.
 */
export const ABOUT_GOAL = /(?<![-\w])G\d+\b|\b(?:the|this|that|a|your|next|new|maps?|focus) goal\b(?!\s+steps)|\bgoal map\b|\b(?:the|next) focus\b|\bapproach\b|\b(?:a|the|this|that|your|board's|board) setting\b|\bstandards?\b|\bmap bar\b|\blicen[cs]es?\b/i

/** The pattern of a permanent delete: a chat, a file or folder, a launch.json entry, a branch. */
const DELETES = /\bdelet(?:e|es|ed|ing|ion)\b|\berase[sd]?\b|\bwipe[sd]?\b|\brmdir\b|\brm -r/i

/**
 * What only the person's own hands can do, one list (the review of 2026-10-31: Q104, Q559, Q345, Q113, Q539 went to the main
 * chat), for a do ask and an ask under no step: quit, reopen or restart the Claude app; a click or a press (Allow, a chip, a
 * button, a prompt); a button of the board that only the person presses (add to the queue, pin); sign in or log in; an
 * account; money; an install; a change of a mod (the person's own word, roles/worker.md "Not yours"); a permission; a
 * password or key; the week's limit; and (the coordinator's ruling, 2026-10-31) anything that deletes for good: a chat, a file
 * or folder, a launch.json entry, a branch (archiving a chat stays the main chat's). `[name, pattern]`; never routed to a chat.
 */
export const PERSONS_HANDS = [
  ['the Claude app', /\b(?:quit|re-?open|restart|relaunch|close)\b[^.?!]*\b(?:Claude(?: app| desktop)?|the app)\b|\b(?:Claude|the) app\b[^.?!]*\b(?:quit|re-?open|restart|relaunch)/i],
  ['a click', /\bclick(?:s|ed|ing)?\b|\bchips?\b|\b(?:press|tap)(?:es|ed|ing|s)?\b/i],
  // "Allow" as the app's button (quoted, or on a prompt), never the verb ("Allow the outline to cut a cell?", the live Q401).
  ['a click', /["“']Allow["”']|\bAllow\b[^.?!]*\b(?:prompt|popup|dialog)\b/],
  ['a button of the board', /\badd (?:it |them )?to the queue\b|\bpin(?:s|ned)?\b[^.?!]*\bto\b|\bthe Backlog tab\b/i],
  ['a sign-in', /\bsign(?:ed|ing)?[- ]?(?:in|up)\b|\blog(?:ged|ging)?[- ]?in\b/i],
  ['an account', /\baccounts?\b/i],
  ['money', /\bpay(?:s|ing|ment|ments)?\b|\bpaid\b|\bbilling\b|\bmoney\b|\bpurchase\b|\bsubscription\b/i],
  ['an install', /\b(?:re-?)?install(?:s|ed|ing|ation)?\b/i],
  ['a change of a mod', /\b(?:update|change|upgrade)\b[^.?!]*\bmods?\b/i],
  ['a permission', /\bpermissions?\b/i],
  ['a password', /\bpasswords?\b|\bAPI keys?\b/i],
  ['the week\'s limit', /\bweekly limit\b|\bweek's limit\b/i],
  ['a permanent delete', DELETES],
]
/**
 * The coordinator's ruling (2026-10-31): for a decide or a look under a step, only these whole phrases make it the person's
 * (Autopilot never asks the person more than the partner's answers do): quit, reopen or restart the Claude app; sign in or
 * log in; an account; a password; pay or money; a permanent delete; install or reinstall a mod or an app.
 */
export const UNDER_STEP_HANDS = [
  ['the Claude app', /\b(?:quit|re-?open|restart)\b[^.?!]*\bClaude(?: app)?\b|\bClaude app\b[^.?!]*\b(?:quit|re-?open|restart)\b/i],
  ['a sign-in', /\bsign(?:ed|ing)? in\b|\blog(?:ged|ging)? in\b/i],
  ['an account', /\b(?:an?|your|the|my|our|their|this|that)\s+accounts?\b/i],
  ['a password', /\bpasswords?\b/i],
  ['money', /\bpay(?:s|ing|ment|ments)?\b(?!\s+attention)|\bmoney\b/i],
  ['a permanent delete', DELETES],
  ['an install', /\b(?:re-?)?install(?:s|ed|ing)?\b[^.?!]*\b(?:mod|app)\b/i],
]
/**
 * A do that only the person's own eyes, ears or words can carry out (its title: "Look at the picture.", "Play the painted
 * map.", "Pick the sound by ear", "Check the result", "If you want it the other way, tell me ..."): never the main chat's.
 */
export const OWN_SENSES = /^(?:if [^,]*,\s*)?(?:look|play|listen|watch|try|pick|check|tell me|type|say)\b|\bby ear\b/i
/** What of a list of the person's hands an ask's words need: `{ name, phrase }` (the words that matched), or null. */
export function handsMatchOf(item, list = PERSONS_HANDS) {
  const words = `${title(item)} ${text(item)}`
  for (const [name, pattern] of list) {
    const found = words.match(pattern)
    if (found !== null) return { name, phrase: found[0] }
  }
  return null
}
/** What of PERSONS_HANDS an ask's words need (its name), or null. */
export const handsOf = (item, list = PERSONS_HANDS) => handsMatchOf(item, list)?.name ?? null

/** An ask that marks a step done, accepts it, approves it or sends it back (its title): never the main chat's to do. */
export const STEP_VERDICT = /\b(?:mark|tick|set)\b[^.?!]*\bdone\b|\baccept(?:s|ed|ing)?\b|\bapprove(?:s|d)?\b|\bsen[dt]\b[^.?!]*\bback\b|\bclose\b[^.?!]*\bB\d+\b|\bleave the (?:rest of the )?gap\b/i
/**
 * The last re-check (2026-10-31, the live Q520 "Do you accept this look for now and leave the rest of the gap as a later
 * step?"): a look or a decide that is the person's verdict on a result: it accepts it, leaves its gap, sends it back, or
 * approves it below its bar (its step below its target, or its title's score below its target). The phrase, or null.
 */
export function stepVerdictOf(item, step) {
  const words = title(item)
  const said = words.match(/\baccept(?:s|ed|ing)?\b|\bleave the (?:rest of the )?gap\b|\bsen[dt]\b[^.?!]*\bback\b/i)?.[0] ?? null
  if (said !== null) return said
  const approve = words.match(/\bapprove(?:s|d)?\b/i)?.[0] ?? null
  const score = words.match(/\b(\d+) of (\d+)\b/)
  return approve !== null && (belowTarget(step) || (score !== null && Number(score[1]) < Number(score[2]))) ? approve : null
}
/** A score beside a target in a question's title ("68 of 75", "the 75 target"). */
// A score, not a target picture (the re-review: "beside the target" of Q393 is a look, Q578's "the 75 target" a score).
const TARGET_WORDS = /\b\d+ of \d+\b|\b\d+\b[^.?!]*\btarget\b|\btarget\b[^.?!]*\b\d+\b/i

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
 * Where an open ask goes while Autopilot is on: `{ to, why }`, `to` one of ROUTES, `why` with the phrase that decided it where
 * one did. `ctx`: `roleOf(owner)` the asking chat's role ('main', 'worker', 'advisor', 'helper', 'owner', 'supervisor', or null
 * for none or one no longer on the list), `items` the store's items by id, `focusGoal` the focus goal's id (or null),
 * `focusHasDemo` whether it has its Demo line already, `recapSteps` the steps an undecided part of a recap names
 * (src/recaps.mjs `recapWaitsOf`: `[{ step, goal, path }]`), `prefix` the chats' title start, `again` that the switch-on's
 * sweep judges an ask the board itself routed to the person anew, `handedWhy` the why of the partner's hand-over of a look (the
 * work API's `escalate`, `partnerHandOverOf`), which is judged as if nobody had handed it on: a new look of the focus goal
 * waits for its recap all the same, as long as the ask's words and that why name nothing only the person's hands can do.
 * `step` in the answer: the step a recap ask is put under.
 * A recap wait (the person's "A", 2026-10-31) only for a step of the focus goal whose recap will name it: the goal demo is
 * still to be asked (its words then ask for the step's own row), or a recap of the goal names the step already.
 */
export function autopilotRoute(item, { roleOf = () => null, items = new Map(), focusGoal = null, focusHasDemo = false, recapSteps = [], prefix = '', again = false, handedWhy = null } = {}) {
  const owner = valueOf(item, 'Owner')
  const role = owner === null || plain(owner) === 'server' ? 'board' : roleOf(owner) ?? 'worker'
  const kind = valueOf(item, 'Asks') ?? 'decide'
  const via = valueOf(item, 'Via')
  const of = valueOf(item, 'Of')
  const isUnderStep = STEP.test(of ?? '')
  const step = isUnderStep ? items.get(of) : undefined
  const advice = adviceOf(item)
  const hasOptions = optionsOf(item).length > 0
  const recapOr = why => {
    if (step === undefined || focusGoal === null || valueOf(step, 'Goal') !== focusGoal) return { to: 'person', why: `${why}, and its step is of no focus goal` }
    const named = (recapSteps ?? []).some(one => one.step === of && (one.goal ?? focusGoal) === focusGoal)
    return !focusHasDemo || named ? { to: 'recap', why } : { to: 'person', why: `${why}, and the goal's demo is made without its step` }
  }
  // `again`: the switch-on's sweep judges the asks the board itself routed to the person anew (isBoardRoutedPerson).
  if (isExplicitPerson(item) && !(again && isBoardRoutedPerson(item)) && handedWhy === null) return { to: 'person', why: 'handed to the person' }
  if (via === 'form') return { to: 'person', why: 'the app\'s question form is answered in its chat' }
  // An action: a do, or a yes/no chore the main chat would carry out.
  const isAction = kind === 'do' || (isChore(item) && role !== 'owner')
  // The person's hands: the whole list for an action (the last re-check: a chore under a step too, Q556) and an ask under no
  // step; for a detail decide or look under a step only its phrases.
  const list = isAction || !isUnderStep ? PERSONS_HANDS : UNDER_STEP_HANDS
  const hands = handsMatchOf(item, list) ?? (handedWhy === null ? null : handsMatchOf({ head: new Map([['Title', handedWhy]]), sections: new Map() }, list))
  if (hands !== null) return { to: 'person', why: `only the person's hands: ${hands.name} ("${hands.phrase}")` }
  // The focus goal's recap asks it already: the ask waits for the recap (before the goal-level words: its `#demo=` link is one).
  const recapAsk = recapAskOf(item, { focusGoal, recapSteps, items }, role)
  if (recapAsk !== null) return recapAsk
  const goal = goalLevelOf(item, role)
  if (goal !== null) return { to: 'person', why: `goal level ("${goal}")` }
  // A new look of the focus goal waits for its recap, whatever the recap names (the person's "A", 2026-11-02): before the rules of a look.
  const look = focusLookOf(item, { focusGoal, items }, role)
  if (look !== null) return { to: 'recap', why: FOCUS_LOOK_WHY, ...(look.isInferred ? { step: look.step } : {}) }
  if (via === 'accept') return recapOr('an accept or send back below its target')
  if (kind === 'look' && isByChecker(item, items, prefix)) return recapOr('a look of the step\'s checker')
  if (kind === 'look' && belowTarget(step)) return recapOr('a look below its target')
  if (role === 'board') return { to: 'person', why: 'the board\'s own card' }
  if (!isUnderStep && ['look', 'decide'].includes(kind) && TARGET_WORDS.test(title(item))) return { to: 'person', why: 'a score below its target, under no step' }
  // Never the main chat's: an action that marks a step done, accepts it or sends it back.
  if (isAction && STEP_VERDICT.test(title(item))) return { to: 'person', why: 'it marks a step done, accepts it or sends it back' }
  // Never the partner's: a look or decide that accepts a result, leaves its gap, approves it below its bar or sends it back
  // (the last re-check, Q520): the person's, under a step of the focus goal at its recap.
  const verdict = isAction || !['look', 'decide'].includes(kind) ? null : stepVerdictOf(item, step)
  if (verdict !== null) {
    const why = `the person's verdict on a result ("${verdict}")`
    return isUnderStep ? recapOr(why) : { to: 'person', why }
  }
  if (kind === 'do' && OWN_SENSES.test(title(item))) return { to: 'person', why: 'the person\'s own eyes, ears or words' }
  if (kind === 'do') return role === 'owner' ? { to: 'person', why: 'the Product owner\'s' } : { to: 'main', why: 'an action' }
  if (isAction) return { to: 'main', why: 'an action asked as a question' }
  if (kind === 'provide') return { to: 'person', why: 'only the person provides it' }
  if (['advisor', 'helper', 'owner'].includes(role)) {
    // A refine question without advice goes back to the Advisor (`partner`); one with advice under a step is answered with it.
    if (advice !== null && isUnderStep) return { to: 'advice', why: 'the partner\'s own advice on a step' }
    if (via === 'refine' && advice === null) return { to: 'partner', why: 'the Advisor decides it' }
    return { to: 'person', why: advice === null ? 'the partner gave no advice' : 'the partner\'s ask under no step' }
  }
  if (kind === 'decide' || (kind === 'look' && (hasOptions || advice !== null))) return { to: 'partner', why: 'a detail question' }
  return { to: 'person', why: 'a look only the person judges' }
}

/**
 * Whether an open ask stands in Needs your attention: not while it is routed away (partner, advice, recap, main); one that
 * waits for the goal's recap stands there again while Autopilot is off. While Autopilot is on (`ctx.autopilot`), an ask the
 * board has not routed yet stands only when it goes to the person, or when it waited longer than ROUTE_GRACE_MS (nothing is
 * lost when the board could not route it). A refine question: while the board answers it with its advice, or it went back
 * to the Advisor (SENT_BACK_MS), it stands nowhere. `now` is the time.
 */
export function standsForPerson(item, ctx = {}) {
  const route = valueOf(item, 'Route')
  if (route === 'recap' && ctx.autopilot !== true) return true
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

/**
 * The person's "A" (2026-10-31), the coordinator's ruling: an ask routed to the recap writes on its step
 * `Recap verdict: waits (Q<n>)`, so the goal's demo is asked with that step in review (src/focus.mjs) and gives it a row of its
 * own; the recap's answer writes `approved` or `sent back` beside it.
 */
export const recapVerdictWords = (verdict, id) => `Recap verdict: ${verdict} (${id})`
const RECAP_VERDICT = /^\s*Recap verdict: waits \((Q\d+)\)\s*$/
/** The asks a step waits for the goal's recap for: its `Recap verdict: waits (Q<n>)` lines whose ask is open and routed to the recap. */
export function recapWaitIds(step, items) {
  const named = (step?.sections?.get('Context') ?? []).map(one => one.match(RECAP_VERDICT)?.[1]).filter(Boolean)
  return [...new Set(named)].filter(id => {
    const ask = items?.get?.(id)
    return ask !== undefined && valueOf(ask, 'State') === 'open' && valueOf(ask, 'Route') === 'recap'
  })
}
/** The states of a fix still to be built (the re-review of 2026-10-31): while one is, the step does not wait for the recap only. */
const FIX_UNDER_WAY = ['new', 'refined', 'queued', 'taken', 'in progress', 'waiting on you']

/**
 * What a step in review waits for the goal's recap for, when that is all it waits for: `[{ step, asks }]`, the steps whose own
 * asks wait (`Recap verdict: waits (Q<n>)` with the ask still open on the recap: itself, or the last link of its chain of open
 * fixes, resultCheck.mjs `chainWaitOf`, read only, which must hold such an ask), or null. Only when nothing else of it is open (the re-review of 2026-10-31,
 * the coordinator's rulings): no fix of it, nor of its chain, still to be built (new, refined, queued, taken, in progress,
 * waiting on you), no check of it or of its chain still to run (the last re-check: an open Quality Assurance task, `Checks:`
 * naming a link, in any state but done, closed or dropped), and no other open ask of it or of its chain. B689 waiting for its
 * fix B821, which waits for the recap, waits for the recap too.
 */
export function recapWaitOf(step, items) {
  if (valueOf(step, 'State') !== 'review') return null
  const id = valueOf(step, 'Id')
  const chain = chainWaitOf(id, items)?.chain ?? []
  const links = [id, ...chain]
  const fixes = links.flatMap(one => fixesOf(one, items))
  if (fixes.some(one => FIX_UNDER_WAY.includes(valueOf(one, 'State')))) return null
  const checks = [...(items?.values?.() ?? [])].filter(one => valueOf(one, 'Kind') === 'step' && links.includes(valueOf(one, 'Checks')))
  if (checks.some(one => !['done', 'closed', 'dropped'].includes(valueOf(one, 'State')))) return null
  if (chain.some(one => valueOf(items.get(one), 'State') !== 'review')) return null
  const linkOf = one => (one === id ? step : items.get(one))
  if (recapWaitIds(linkOf(links.at(-1)), items).length === 0) return null
  const rows = links.map(one => ({ step: one, asks: recapWaitIds(linkOf(one), items) })).filter(one => one.asks.length > 0)
  const waiting = new Set(rows.flatMap(one => one.asks))
  const others = [...(items?.values?.() ?? [])].filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'State') === 'open' && links.includes(valueOf(one, 'Of')) && !waiting.has(valueOf(one, 'Id')))
  return others.length > 0 ? null : rows
}
/** Whether a step in review waits for the goal's recap only (`recapWaitOf`): it counts as done for asking the goal demo. */
export const waitsForRecap = (step, items) => recapWaitOf(step, items) !== null
/** The History line of a blocking ask routed to the recap: its worker goes on. */
export const RECAP_GOES_ON = 'autopilot: the step goes on; judged at the goal\'s recap'
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

/**
 * Whether an ask routed to the recap stays there when no row of the recap names its step (the person's "A", 2026-11-02): a look
 * (any role but the Product owner's) of a step of the focus goal. The board's safety net hands every other recap wait back to the
 * person once the goal's demo is made without its step ("The goal demo came without its step"); a look is answered in its own
 * window and listed on the recap card, so no row has to close it.
 */
export const isKeptLook = (item, role = null) => (valueOf(item, 'Asks') ?? 'decide') === 'look' && !NOT_LOOKERS.includes(role)

/** The card line of an ask the board routed back to the person (its step's goal is no longer the focus). */
export const recapGoneWords = 'Its goal is not the focus now, so its recap will not come: it is yours'
