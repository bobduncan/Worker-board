// T5 B1: the refusals and warnings of save and load, as PURE decisions over facts the commands gather (save.mjs, load.mjs). Each
// refusal names who acts. With --practice every check marked final below is a warning instead (the board's own pause rule:
// `unsaved` and `offBoard` block nothing). The held words and the board steps are read here too (pure, from texts).

import { RESUMED } from '../work/pause.mjs'
import { valueOf } from '../work/item.mjs'

export const LOCK_FRESH_MS = 15 * 60_000
export const TEXT_MOST_BYTES = 10 * 1024 * 1024

const refusal = (code, text, who) => ({ code, text, who })

/**
 * Save's guards. `facts`:
 * - `pause` (pause.json's record or null), `boardAnswers` ([{ port, project }] of boards of this project that answer), `keepers`
 *   ([{ pid }] of this board folder), `lockAgeMs` (null for none);
 * - `dirtySteps` ([{ id, chat, folder, files }]: held steps (RESUMED) with uncommitted tracked changes), `notFastForward`
 *   ([{ branch, repo }]), `mainsDirty` ([{ repo, files, ahead }]);
 * - `originAhead` (origin's data branch is past this PC's last sync: { origin, last }), `lastLoadWasPractice`;
 * - `secrets` ([{ path, kind }]), `oversized` ([{ path, bytes }]), `remotePublic`, `driveShort` ({ need, free } or null);
 * - warnings: `reviewSteps` ([ids]), `noCheckpointSince` ([{ id, chat }]), `branchesGone` ([{ id, branch, why }]).
 * `options`: `{ practice, anyway: [ids] }`. Answers `{ refusals: [{ code, text, who }], warnings: [text] }`.
 */
export function saveGuards(facts, { practice = false, anyway = [] } = {}) {
  const refusals = []
  const warnings = []
  const final = (code, text, who) => (practice ? warnings.push(`${text} (a practice save goes on)`) : refusals.push(refusal(code, text, who)))
  if (facts.pause?.state !== 'pausing') final('not-paused', 'the board is not paused: press Pause all first, so every chat commits and stops', 'you')
  for (const board of facts.boardAnswers ?? []) final('board-runs', `a board of this project answers on port ${board.port}: quit the Claude app from the tray, then \`node start-board.mjs --stop\``, 'you')
  for (const keeper of facts.keepers ?? []) final('keeper-runs', `a keeper of this board folder runs (process ${keeper.pid}): \`node start-board.mjs --stop\``, 'you')
  if (Number.isFinite(facts.lockAgeMs) && facts.lockAgeMs < LOCK_FRESH_MS) refusals.push(refusal('landing', `a landing runs (data/landing.lock, ${Math.round(facts.lockAgeMs / 60_000)} min old): wait for it`, 'the landing'))
  for (const step of facts.dirtySteps ?? []) {
    if (anyway.includes(step.id)) warnings.push(`${step.id}: uncommitted work in ${step.folder} stays on this PC (--anyway)`)
    else final('dirty-step', `${step.id} has uncommitted changes in ${step.folder} (${step.files.slice(0, 3).join(', ')}${step.files.length > 3 ? ', ...' : ''}): ${step.chat} commits ${step.id}, or say --anyway ${step.id}`, step.chat)
  }
  for (const one of facts.notFastForward ?? []) final('not-ff', `the push of ${one.branch} (${one.repo}) would not be a fast-forward: origin's copy is ahead or diverged; merge or rebase it first`, 'the branch\'s owner')
  for (const one of facts.mainsDirty ?? []) {
    if (one.files.length > 0) final('main-dirty', `${one.repo} has tracked changes (${one.files.slice(0, 3).join(', ')}${one.files.length > 3 ? ', ...' : ''}): commit or put them back`, 'you')
    if (one.ahead > 0) final('main-ahead', `${one.repo} has ${one.ahead} commit(s) not on origin: push them`, 'you')
  }
  if (facts.originAhead) refusals.push(refusal('load-first', `origin's ${facts.originAhead.branch} is past this PC's last sync (${facts.originAhead.origin.slice(0, 7)} vs ${String(facts.originAhead.last ?? 'none').slice(0, 7)}): load first, or you overwrite another PC's save`, 'you'))
  if (facts.lastLoadWasPractice) final('practice-loaded', 'this PC\'s last load was a practice load: a final save would send practice data as the real thing; load the final data first', 'you')
  for (const one of facts.secrets ?? []) refusals.push(refusal('secret', `${one.path} holds the ${one.kind} by value: it never travels; take it out`, 'you'))
  for (const one of facts.oversized ?? []) refusals.push(refusal('too-big', `${one.path} is ${Math.round(one.bytes / 1048576)} MB: over 10 MB, it does not travel in git`, 'you'))
  if (facts.remotePublic) refusals.push(refusal('public-remote', 'the data remote answers an anonymous read: it must be private', 'you'))
  if (facts.driveShort) refusals.push(refusal('drive-full', `the Drive folder lacks the space: ${Math.ceil(facts.driveShort.need / 1048576)} MB needed, ${Math.floor(facts.driveShort.free / 1048576)} MB free`, 'you'))
  for (const id of facts.reviewSteps ?? []) warnings.push(`${id} is in review: it travels as it is (its check goes on here or there)`)
  for (const one of facts.noCheckpointSince ?? []) warnings.push(`${one.id} (${one.chat}) has no checkpoint since the pause began: it goes on from its branch and History`)
  for (const one of facts.branchesGone ?? []) warnings.push(`${one.id}: its branch ${one.branch} is ${one.why}; nothing to push`)
  return { refusals, warnings }
}

/**
 * Load's guards. `facts`: `boardAnswers` (boards of the TARGET project that answer), `keepers` (of this board folder), `lockAgeMs`,
 * `changed` ([{ path, target }] this PC changed since its last sync), `fromPractice` (the state here came from a practice load and this
 * is a final load), `practiceData` (the data loaded is a practice save while no --practice was given). `options`: `{ park }`.
 */
export function loadGuards(facts, { park = false } = {}) {
  const refusals = []
  const warnings = []
  for (const board of facts.boardAnswers ?? []) refusals.push(refusal('board-runs', `a board of the target project answers on port ${board.port}: quit the Claude app from the tray, then \`node start-board.mjs --stop\``, 'you'))
  for (const keeper of facts.keepers ?? []) refusals.push(refusal('keeper-runs', `a keeper of this board folder runs (process ${keeper.pid}): \`node start-board.mjs --stop\``, 'you'))
  if (Number.isFinite(facts.lockAgeMs) && facts.lockAgeMs < LOCK_FRESH_MS) refusals.push(refusal('landing', `a landing runs (data/landing.lock, ${Math.round(facts.lockAgeMs / 60_000)} min old): wait for it`, 'the landing'))
  if (facts.practiceData) refusals.push(refusal('practice-data', 'the data is a practice save: say --practice to load it, or load the final data', 'you'))
  const changed = facts.changed ?? []
  if (changed.length > 0) {
    if (park || facts.fromPractice) warnings.push(`${changed.length} file(s) this PC changed since its last sync are backed up and replaced (${facts.fromPractice && !park ? 'a final load over a practice state parks it by itself' : '--park'}): ${changed.slice(0, 5).map(one => one.path).join(', ')}${changed.length > 5 ? ', ...' : ''}`)
    else refusals.push(refusal('changed-here', `${changed.length} file(s) changed on this PC since its last sync: ${changed.slice(0, 5).map(one => one.path).join(', ')}${changed.length > 5 ? ', ...' : ''}; save them first, or say --park to back them up and go on`, 'you'))
  }
  return { refusals, warnings }
}

/**
 * The held words: the outbox lines the pause holds back, folded by id (the newest line of an id wins, as the board does); held means
 * state `waiting` and command not `resume` (B442). `[{ id, chat, step, words, at }]`, oldest first.
 */
export function heldWordsOf(outboxText) {
  const byId = new Map()
  for (const raw of String(outboxText ?? '').split(/\r?\n/)) {
    if (raw.trim() === '') continue
    try {
      const one = JSON.parse(raw)
      if (typeof one?.id === 'string') byId.set(one.id, one)
    } catch {
      // a torn line is no word
    }
  }
  return [...byId.values()].filter(one => one.state === 'waiting' && one.command !== 'resume' && typeof one.to === 'string')
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .map(one => ({ id: one.id, chat: one.to, step: typeof one.step === 'string' ? one.step : null, words: String(one.text ?? ''), at: Number.isFinite(one.at) ? one.at : null }))
}

/**
 * The board steps: every step not done or dropped with `Priority: fix`, or whose branch is a branch of the board repository
 * (`boardBranches`): they cannot land on the other PC. `[{ id, title, state, branch, why }]`.
 */
export function boardStepsOf(items, boardBranches = []) {
  const out = []
  for (const item of items.values()) {
    if (valueOf(item, 'Kind') !== 'step') continue
    const state = valueOf(item, 'State')
    if (state === null || ['done', 'dropped'].includes(state)) continue
    const branch = valueOf(item, 'Branch')
    const isFix = valueOf(item, 'Priority') === 'fix'
    const onBoard = branch !== null && branch !== 'none' && boardBranches.includes(branch)
    if (!isFix && !onBoard) continue
    out.push({ id: valueOf(item, 'Id'), title: valueOf(item, 'Title') ?? '', state, branch: branch ?? 'none', why: isFix ? 'Priority: fix' : 'its branch is in the board repository' })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/** The held steps (RESUMED: taken, in progress, waiting on you) with their chat and branch, for the dirty-worktree check. */
export function heldStepsOf(items) {
  const out = []
  for (const item of items.values()) {
    if (valueOf(item, 'Kind') !== 'step' || !RESUMED.includes(valueOf(item, 'State'))) continue
    out.push({ id: valueOf(item, 'Id'), chat: valueOf(item, 'Owner') ?? 'its chat', branch: valueOf(item, 'Branch'), state: valueOf(item, 'State') })
  }
  return out
}

/** The steps in review, by id. */
export const REVIEW_STATES = ['review', 'in review']
export const reviewStepsOf = items => [...items.values()].filter(item => valueOf(item, 'Kind') === 'step' && REVIEW_STATES.includes(valueOf(item, 'State'))).map(item => valueOf(item, 'Id'))

/** The secret values that must never travel: every string of 16+ characters in the texts given (`.claude/board.json`, Codex's auth.json) and the keys given. */
export function secretValuesOf({ texts = [], keys = [] }) {
  const values = new Set()
  for (const text of texts) {
    try {
      walk(JSON.parse(String(text ?? '')), value => { if (typeof value === 'string' && value.length >= 16 && !/\s/.test(value) && !/^https?:\/\//.test(value)) values.add(value) })
    } catch {
      // not JSON: nothing to take
    }
  }
  for (const key of keys) if (typeof key === 'string' && key.trim().length >= 8) values.add(key.trim())
  return [...values]
}

function walk(value, see) {
  if (Array.isArray(value)) for (const one of value) walk(one, see)
  else if (value !== null && typeof value === 'object') for (const one of Object.values(value)) walk(one, see)
  else see(value)
}

/** The staged texts that hold a secret by value: `[{ path, kind }]`; the value itself is never in the answer. */
export function secretsIn(files, secrets) {
  const found = []
  for (const file of files) {
    const text = typeof file.text === 'string' ? file.text : null
    if (text === null) continue
    for (const secret of secrets) {
      if (text.includes(secret.value)) { found.push({ path: file.to, kind: secret.kind }); break }
    }
  }
  return found
}
