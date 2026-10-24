// B359: the goal guard. The person, 2026-10-18 21:18: "after a couple of attempts and it keeps failing the goal it
// will fundamentally evaluate with a higher model if the current approach is right, and might require a big rebuild to
// reach the goal. this will normally require an approval from the user, but can be automatically approved."
//
// A goal's attempts are its failed checks, counted from its Go (How agreed) or, without a how, from its first refined
// step (B450): every failed result check of its steps (a fix step carries its goal too), every failed re-check of the
// goal itself, and every look of one of its steps that the person answered no or rejected. The third fires the guard
// once: the board writes "Evaluation asked: <date time>" under the goal, switches the partner to high effort (B352) and
// types `evaluate G<n>` to it, with the word that the goal's next steps are refined on Model: opus and Effort: high.
// The partner's answer is a how-draft (src/focus.mjs): a corrected or rebuilt how, or the same how again ("keep
// going"); it counts as Go, so the count starts anew. A rebuild is the person's to approve (an ask of the goal whose
// title begins "Rebuild G<n>") unless "Approve rebuilds by itself" (config `approveRebuilds`) is on.
// Work-agnostic: it reads the store's steps and the goal map, nothing of the project's work.

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

/** Whether the guard fires now: an open goal at its third failed attempt, no evaluation running. */
export function needsEvaluation(node, items) {
  if (node === undefined || node === null || node.state === 'done') return false
  if ((node.evaluationAsked ?? null) !== null) return false
  return goalAttempts(node, items).count >= GUARD_ATTEMPTS
}

const isOpenAsk = item => !['answered', 'withdrawn', 'dropped', 'closed', 'done'].includes(String(item.head.get('State') ?? '').toLowerCase())

/**
 * The guard as the Focus page shows it: `{ attempts, of, state, ask }`, state `counting` (attempts so far), `evaluating`
 * (the partner evaluates) or `rebuild` (a rebuild waits for the person: the open ask `ask`).
 */
export function guardOf(node, items, asks) {
  if (node === undefined || node === null) return null
  const attempts = goalAttempts(node, items).count
  if ((node.evaluationAsked ?? null) === null) return { attempts, of: GUARD_ATTEMPTS, state: 'counting', ask: null }
  const rebuild = new RegExp(`^Rebuild ${node.id}\\b`, 'i')
  const waiting = (asks ?? []).find(one => one.head.get('Kind') === 'ask' && one.head.get('Of') === node.id && isOpenAsk(one) && rebuild.test(String(one.head.get('Title') ?? '')))
  return { attempts, of: GUARD_ATTEMPTS, state: waiting === undefined ? 'evaluating' : 'rebuild', ask: waiting?.head.get('Id') ?? null }
}

/**
 * The word to the partner: `evaluate G<n> <title>`, the failed checks since Go, whether a rebuild needs the person's
 * yes, and where its job says how ("The fundamental evaluation", roles/partner.md). One message of the outbox.
 */
export function evaluateWords({ to, goal, attempts, approveRebuilds, job }) {
  const lines = [
    `evaluate ${goal.id} ${lineOf(goal.title)}`,
    `Attempts: ${attempts.count} failed checks since ${goal.howAgreed === attempts.since ? 'Go' : 'its first refined step'} (${attempts.since ?? 'the start'})`,
    ...attempts.failures.map(one => `- ${one.by === 'you' ? `${one.id}, your no to a look` : one.id === goal.id ? `${one.id} re-check` : one.id} (${one.at}): ${one.text}`),
    `Next steps: refine every next step of ${goal.id} with Model: opus and Effort: high until the evaluation ends`,
    approveRebuilds === true
      ? 'Rebuilds: approved by the board ("Approve rebuilds by itself" is on): make its steps at once and give the person a recap'
      : 'Rebuilds: ask the person first (decide); "Approve rebuilds by itself" is off',
    `Your job: ${job}, "The fundamental evaluation"`,
  ]
  return { to, ask: null, step: null, title: null, version: null, verdict: null, command: 'evaluate', about: goal.id, text: lines.join('\n') }
}
