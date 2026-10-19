// B359: the goal guard. The person, 2026-10-18 21:18: "after a couple of attempts and it keeps failing the goal it
// will fundamentally evaluate with a higher model if the current approach is right, and might require a big rebuild to
// reach the goal. this will normally require an approval from the user, but can be automatically approved."
//
// A goal's attempts are its failed checks since Go (its How agreed): every failed result check of its steps (a fix
// step carries its goal too) and every failed re-check of the goal itself. The third fires the guard once: the board
// writes "Evaluation asked: <date time>" under the goal, switches the partner to high effort (B352) and types
// `evaluate G<n>` to it. The partner's answer is a how-draft (src/focus.mjs): a corrected or rebuilt how, or the same
// how again ("keep going"); it counts as Go, so the count starts anew. A rebuild is the person's to approve (an ask of
// the goal whose title begins "Rebuild G<n>") unless "Approve rebuilds by itself" (config `approveRebuilds`) is on.
// Work-agnostic: it reads the store's steps and the goal map, nothing of the project's work.

import { checkedOf } from './work/resultCheck.mjs'

/** The failed checks since Go that fire the guard. */
export const GUARD_ATTEMPTS = 3

const FAILED = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) [^:]+: result check failed: ([^;]*)/
const lineOf = text => String(text ?? '').replace(/\s+/g, ' ').trim()

/**
 * The goal's failed checks since its how was agreed, oldest first: `{ count, since, failures: [{ at, id, text }] }`.
 * A step's last failure carries the failed points its last check keeps; an earlier one, its summary. Nothing is
 * counted before a how is agreed.
 */
export function goalAttempts(node, items) {
  const since = node?.howAgreed ?? null
  if (since === null) return { count: 0, since: null, failures: [] }
  const failures = []
  for (const item of items ?? []) {
    if (item.head.get('Kind') !== 'step' || item.head.get('Goal') !== node.id) continue
    const id = item.head.get('Id')
    const failed = (item.sections.get('History') ?? []).map(one => one.replace(/^[-*]\s+/, '').match(FAILED)).filter(one => one !== null && one[1] > since)
    const points = (checkedOf(item)?.points ?? []).filter(one => one.verdict === 'fail').map(one => one.text)
    failed.forEach((found, place) => {
      const isLast = place === failed.length - 1
      failures.push({ at: found[1], id, text: lineOf(isLast && points.length > 0 ? points.join('; ') : found[2]) })
    })
  }
  for (const recheck of node.rechecks ?? []) {
    if (recheck.verdict === 'failed' && recheck.at > since) failures.push({ at: recheck.at, id: node.id, text: lineOf(recheck.gap ?? recheck.summary) })
  }
  failures.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return { count: failures.length, since, failures }
}

/** Whether the guard fires now: an open goal with an agreed how, at its third failed check, no evaluation running. */
export function needsEvaluation(node, items) {
  if (node === undefined || node === null || node.state === 'done') return false
  if ((node.evaluationAsked ?? null) !== null) return false
  return goalAttempts(node, items).count >= GUARD_ATTEMPTS
}

const isOpenAsk = item => !['answered', 'withdrawn', 'dropped', 'closed', 'done'].includes(String(item.head.get('State') ?? '').toLowerCase())

/**
 * The guard as the Focus page shows it: `{ attempts, of, state, ask }`, state `counting` (attempts so far), `evaluating`
 * (the partner evaluates) or `rebuild` (a rebuild waits for the person: the open ask `ask`). Null before a how is agreed.
 */
export function guardOf(node, items, asks) {
  if (node === undefined || node === null || (node.howAgreed ?? null) === null) return null
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
    `Attempts: ${attempts.count} failed checks since Go (${attempts.since})`,
    ...attempts.failures.map(one => `- ${one.id === goal.id ? `${one.id} re-check` : one.id} (${one.at}): ${one.text}`),
    approveRebuilds === true
      ? 'Rebuilds: approved by the board ("Approve rebuilds by itself" is on): make its steps at once and give the person a recap'
      : 'Rebuilds: ask the person first (decide); "Approve rebuilds by itself" is off',
    `Your job: ${job}, "The fundamental evaluation"`,
  ]
  return { to, ask: null, step: null, title: null, version: null, verdict: null, command: 'evaluate', about: goal.id, text: lines.join('\n') }
}
