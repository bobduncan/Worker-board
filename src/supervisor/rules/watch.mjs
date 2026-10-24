// The supervisor's watch rules (spec 2026-10-24, "What it checks"): report only. The person, 2026-10-24: "its goal is to
// periodically check if, e.g. the board is out of sync, if workers are correctly suspended or not, if the system is
// working like intended". That morning the workers stood still for hours (a cleared worker counted as "unknown" and got
// no next step; three workers stayed "suspended" on a limit stop of days before) and the self-check, which only knows
// its own patterns, did not see it. Each rule here is one such pattern, with its threshold in the settings
// (config.mjs SUPERVISOR_DEFAULTS); what it finds becomes an incident (incidents.mjs), never a repair. A new incident no
// rule caught gets a fix step that adds its rule here, so it is caught for free next time.
//
// A rule is `{ id, kind: 'watch', says, check(view, ctx) }`; `check` reads the view (view.mjs) and answers its findings,
// `{ rule, key, subject, text, evidence }`: `key` names the finding for counting (the same key while it lasts, so one
// incident counts up), `subject` the chat or step it is about, `text` one plain line, `evidence` what it saw. `ctx`
// holds the supervisor's own watch: `seen` (since when it first saw what only counts once it lasts) and `observed`
// (what it sees now; the loop keeps those and forgets the rest). PURE.

import { sinceMs, valueOf } from '../../work/item.mjs'
import { blockersOpen, waitWords } from '../../work/guards.mjs'
import { checkpointOf, heldMs, isHolding } from '../../work/pause.mjs'
import { whyClosed } from '../../work/outboxSweep.mjs'
import { FIRST_SAYING, chatsByRole, oldModFinding } from '../../oldMods.mjs'
import { EFFORTS, chatEffort, effortSaid } from '../../work/effort.mjs'
import { reviewWaitOf } from '../../work/resultCheck.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** How far back a word that expired or failed still counts as undelivered. */
const UNDELIVERED_LOOK_MS = 2 * HOUR
/** The window of each limit: a pause older than its limit's window has outlived any stop of it. */
const WINDOW_MS = { fiveHour: 5 * HOUR, week: 7 * DAY }
const LIMIT_WORDS = { fiveHour: 'the 5-hour limit', week: 'the weekly limit' }
/**
 * Reasons a compaction is skipped by design, not by a fault: a small chat, compaction switched off, or more of the same
 * work following (the Workers mod keeps the history for it on purpose).
 */
const BY_DESIGN = ['it is small enough', 'switched off in the list of chats', 'more of the same work follows']
/** The states in which a step is its Owner's work now, and those of a worker with nothing running. */
const HOLDS = ['taken', 'in progress']
const IDLE = ['free', 'unknown', 'off']

const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')
const byId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const minutes = ms => Math.max(0, Math.floor(ms / MIN))
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const workersOf = view => view.lanes.filter(lane => !lane.isLeftover && lane.isMain !== true)
const stepsOf = view => [...view.items.values()].filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step' && typeof idOf(item) === 'string')
const isFull = view => ['fiveHour', 'week'].some(limit => view.limits?.[limit]?.level === 'full')
/**
 * The person's Pause all, and the resume after it: the chats stop at the person's word and the board hands out nothing
 * (the resume wakes them itself), so the rules about chats that do not run or words that wait say nothing meanwhile.
 */
const isPaused = view => isHolding(view.pause) || view.pause?.state === 'resuming'
/** When the last pause ended (the store's pause record, running again since then); -Infinity for none. */
const pauseEndOf = view => (view.pause?.state === 'running' && Number.isFinite(view.pause?.since) ? view.pause.since : -Infinity)
/** A time something began, counted from the end of the last pause at the earliest: the pause's time does not count. */
const afterPause = (view, since) => (Number.isFinite(since) ? Math.max(since, pauseEndOf(view)) : since)

/**
 * How long a thing has lasted: since `since` (what the board's data says), or since the supervisor first saw it (`key`
 * in its watch), whichever is earlier. The key is watched from now on, so a lasting thing is timed across runs. The
 * review: never from before the end of the person's last pause (the chats stood still at the person's word then).
 */
function lasted(view, ctx, key, since = null) {
  if (!ctx.observed.includes(key)) ctx.observed.push(key)
  const first = Math.min(Number.isFinite(since) ? since : Infinity, ctx.seen.get(key) ?? view.now)
  return view.now - Math.max(first, pauseEndOf(view))
}

/** 1. A worker "unknown" for longer than `unknownMinutes`. */
function unknownLane(view, ctx) {
  const found = []
  for (const lane of workersOf(view).filter(one => one.state === 'unknown')) {
    const key = `unknown-lane ${lane.name}`
    const ms = lasted(view, ctx, key, view.since.get(lane.name))
    if (ms <= view.settings.unknownMinutes * MIN) continue
    // What waits on it: its queue as the board shows it, and the steps the store holds or queues for it.
    const owned = stepsOf(view).filter(item => [...HOLDS, 'queued'].includes(stateOf(item)) && plain(valueOf(item, 'Owner'), view.prefix) === plain(lane.name, view.prefix))
    const waits = [...new Set([...(lane.queue ?? []).map(one => one?.id), ...owned.map(idOf)].filter(id => typeof id === 'string'))].sort(byId)
    const first = waits[0]
    found.push({
      rule: 'unknown-lane', key, subject: lane.name,
      text: `${lane.name} unknown for ${minutes(ms)} min${first === undefined ? '' : `, ${first} waits`}`,
      evidence: `state unknown since ${clockOf(view.now - ms)}; running: ${lane.isRunning === true ? 'yes' : lane.isRunning === false ? 'no' : 'not known'}; its steps: ${waits.length === 0 ? 'none' : waits.join(', ')}`,
    })
  }
  return found
}

/**
 * 2. A worker "suspended" after its limit came back: its reset time passed (`isBack`), the app stopped it at the limit
 * and a reading since shows room, or its pause is older than its limit's window. Counted from when it came back.
 */
function staleSuspended(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  for (const lane of workersOf(view).filter(one => one.state === 'suspended' && one.suspended !== null && typeof one.suspended === 'object')) {
    const held = lane.suspended
    const limit = view.limits?.[held.limit] ?? null
    const window = WINDOW_MS[held.limit] ?? null
    const isFull = limit?.level === 'full'
    let why = null
    let since = null
    if (held.isBack === true) {
      why = Number.isFinite(held.until) ? `its reset at ${clockOf(held.until)} has passed` : 'its limit is back'
      since = Number.isFinite(held.until) ? held.until : null
    } else if (Number.isFinite(held.since) && window !== null && view.now - held.since > window) {
      why = `its pause began ${Math.floor((view.now - held.since) / HOUR)} h ago, longer than ${LIMIT_WORDS[held.limit]} lasts`
      since = held.since + window
    } else if (held.by === 'app' && limit !== null && !isFull && Number.isFinite(limit.used) && limit.used < 100 && Number.isFinite(limit.at) && limit.at > (held.since ?? Infinity)) {
      why = `${LIMIT_WORDS[held.limit] ?? held.limit} shows ${Math.round(limit.used)}% used`
    }
    if (why === null || isFull) continue
    const key = `stale-suspended ${lane.name}`
    const ms = lasted(view, ctx, key, afterPause(view, since))
    if (ms <= view.settings.suspendedMinutes * MIN) continue
    found.push({
      rule: 'stale-suspended', key, subject: lane.name,
      text: `${lane.name} suspended for the limit, but ${why}`,
      evidence: `suspended by ${held.by ?? 'not known'} for ${held.limit ?? 'a limit'} since ${Number.isFinite(held.since) ? clockOf(held.since) : 'not known'}; until ${Number.isFinite(held.until) ? clockOf(held.until) : 'not known'}; ${held.limit} ${Number.isFinite(limit?.used) ? `${Math.round(limit.used)}%` : 'not read'}`,
    })
  }
  return found
}

/** 3. All workers idle (free, unknown, off) while a step that may be taken waits, for longer than `idleMinutes`. */
function idleWhileWaiting(view, ctx) {
  const workers = workersOf(view)
  if (workers.length === 0 || isHolding(view.pause) || isFull(view)) return []
  if (!workers.every(lane => IDLE.includes(lane.state))) return []
  const ctxStore = { store: { items: view.items } }
  // Only a step queued for a worker of the list (not the main chat's, the partner's or a gone chat's) whose line the
  // board does not hold for its model or effort (opus-wait says that one).
  const isWorkers = item => workers.some(lane => plain(lane.name, view.prefix) === plain(valueOf(item, 'Owner'), view.prefix))
  const held = new Set(workers.filter(lane => typeof lane.effortRun?.step === 'string' && ((lane.effortRun.waitsFor ?? null) !== null || lane.effortRun.isSet === false))
    .map(lane => lane.effortRun.step))
  const waiting = stepsOf(view).filter(item => stateOf(item) === 'queued' && isWorkers(item) && !held.has(idOf(item)) && blockersOpen(item, ctxStore).length === 0 && waitWords(item) === null)
  if (waiting.length === 0) return []
  // Since the last worker went idle, and since the first of the steps that wait was queued.
  const idleSince = Math.max(...workers.map(lane => view.since.get(lane.name) ?? NaN))
  const queuedSince = Math.min(...waiting.map(item => sinceMs(valueOf(item, 'Since'))).filter(Number.isFinite))
  const since = Number.isFinite(idleSince) && Number.isFinite(queuedSince) ? Math.max(idleSince, queuedSince) : null
  const key = 'idle-while-waiting'
  const ms = lasted(view, ctx, key, since)
  if (ms <= view.settings.idleMinutes * MIN) return []
  const ids = waiting.map(idOf).sort(byId)
  return [{
    rule: 'idle-while-waiting', key, subject: 'board',
    text: `${workers.length === 1 ? `The one worker, ${workers[0].name}, idle` : `All ${workers.length} workers idle`} for ${minutes(ms)} min while ${ids.length} ${ids.length === 1 ? 'step waits' : 'steps wait'} (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', ...' : ''})`,
    evidence: `${workers.map(lane => `${lane.name} ${lane.state}`).join(', ')}; queued: ${waiting.map(item => `${idOf(item)} for ${valueOf(item, 'Owner') ?? 'nobody'}`).join(', ')}`,
  }]
}

/** 4. A step in progress whose worker has not run for longer than `notRunningMinutes`. */
function holderNotRunning(view, ctx) {
  const found = []
  // The person pauses, or a limit is full: the chats are meant to stand still.
  if (isPaused(view) || isFull(view)) return found
  for (const item of stepsOf(view).filter(one => HOLDS.includes(stateOf(one)))) {
    const owner = valueOf(item, 'Owner')
    const lane = workersOf(view).find(one => plain(one.name, view.prefix) === plain(owner, view.prefix))
    // A worker paused for the limit stands still on purpose (stale-suspended says when that is wrong).
    if (lane === undefined || lane.state === 'suspended' || !(lane.isRunning === false || lane.state === 'off')) continue
    const id = idOf(item)
    const key = `holder-not-running ${id}`
    const ms = lasted(view, ctx, key, afterPause(view, Number.isFinite(lane.offSince) ? lane.offSince : lane.state === 'off' ? view.since.get(lane.name) : null))
    if (ms <= view.settings.notRunningMinutes * MIN) continue
    found.push({
      rule: 'holder-not-running', key, subject: id,
      text: `${id} is ${stateOf(item)} for ${lane.name}, whose chat has not run for ${minutes(ms)} min`,
      evidence: `${lane.name}: state ${lane.state}, running ${lane.isRunning === false ? 'no' : 'not known'}, since ${clockOf(view.now - ms)}`,
    })
  }
  return found
}

/** 5. An opus step whose line waits for its worker to run on Opus, for longer than `opusWaitMinutes`. */
function opusWait(view, ctx) {
  const found = []
  if (isPaused(view) || isFull(view)) return found
  for (const lane of workersOf(view)) {
    const waits = lane.effortRun?.waitsFor
    if (waits?.model !== 'opus' || typeof lane.effortRun?.step !== 'string') continue
    const step = lane.effortRun.step
    const key = `opus-wait ${step}`
    const ms = lasted(view, ctx, key, afterPause(view, waits.since))
    if (ms <= view.settings.opusWaitMinutes * MIN) continue
    found.push({ rule: 'opus-wait', key, subject: step, text: `${step} waits for Opus for ${minutes(ms)} min (${lane.name})`, evidence: String(waits.text ?? '') })
  }
  return found
}

/**
 * 6. A clear or a compaction skipped for the same reason twice in a row (the chat's card keeps only the last one: the
 * supervisor keeps the one before in its watch). A compaction skipped by design (a small chat) is no case.
 */
function skipRepeats(view, ctx) {
  const found = []
  for (const lane of view.lanes.filter(one => !one.isLeftover)) {
    const compaction = lane.compaction ?? null
    const skips = [
      ...(compaction?.kind === 'skipped' && !BY_DESIGN.includes(compaction.why) ? [{ kind: 'compact', at: compaction.at, why: compaction.why }] : []),
      ...(compaction?.notCleared ? [{ kind: 'clear', at: compaction.notCleared.at, why: compaction.notCleared.why }] : []),
    ].filter(one => Number.isFinite(one.at) && typeof one.why === 'string' && one.why !== '')
    for (const skip of skips) {
      const head = `skip|${lane.name}|${skip.kind}|`
      const key = `${head}${skip.at}|${skip.why}`
      ctx.observed.push(key)
      const before = [...ctx.seen.keys()].filter(one => one.startsWith(head) && one !== key)
        .map(one => ({ key: one, at: Number(one.slice(head.length).split('|')[0]), why: one.slice(head.length).split('|').slice(1).join('|') }))
        .filter(one => Number.isFinite(one.at) && one.at < skip.at)
        .sort((a, b) => b.at - a.at)[0]
      if (before === undefined || before.why !== skip.why) continue
      // Both stay watched while it stands, so the next run finds it again.
      ctx.observed.push(before.key)
      const what = skip.kind === 'clear' ? 'clear' : 'compaction'
      found.push({
        rule: 'skip-repeats', key: `skip-repeats ${lane.name} ${skip.kind} ${skip.why}`, subject: lane.name,
        text: `${lane.name}: its ${what} was skipped twice in a row: ${skip.why}`,
        evidence: `skipped at ${clockOf(before.at)} and at ${clockOf(skip.at)}, both: ${skip.why}`,
      })
    }
  }
  return found
}

const DONE_LINE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s+[^:]+: \S+ → done\b/
const FIX_LINE = /^-\s+\S+ \S+ [^:]+: fix (B\d+)\s*$/

/**
 * B551 (X11): when the incident a finding's key files was last fixed: the latest time one of the steps named as its fix
 * (its Fix, and every "fix B<n>" of its History) went done, at the end of that minute; -Infinity for none. A repair
 * before it is one that fix was made for: it never counts again.
 */
function fixedAtOf(view, key) {
  const incident = [...view.items.values()].find(item => valueOf(item, 'Kind') === 'incident' && valueOf(item, 'Key') === key)
  if (incident === undefined) return -Infinity
  const named = (incident.sections?.get('History') ?? []).map(line => FIX_LINE.exec(line)?.[1]).filter(Boolean)
  let at = -Infinity
  for (const id of new Set([valueOf(incident, 'Fix'), ...named].filter(Boolean))) {
    const fix = view.items.get(id)
    if (fix === undefined || stateOf(fix) !== 'done') continue
    const done = (fix.sections?.get('History') ?? []).map(line => DONE_LINE.exec(line)?.[1]).filter(Boolean).at(-1) ?? valueOf(fix, 'Since')
    const ms = sinceMs(done)
    if (Number.isFinite(ms)) at = Math.max(at, ms + (/:\d\d:\d\d$/.test(done) ? 1000 : MIN) - 1)
  }
  return at
}

/**
 * 7. The same repair (a repair rule, on the same chat or step) `repairsPerDay` times or more in a day. B546: a repair
 * the app's restart caused (`cause: 'restart'`, a chat stopped because the app started anew) does not count. B551: nor
 * does one from before its incident's fix was done (`fixedAtOf`): X11 came back on the very wakes B546 was made for,
 * recorded before it and so without their cause.
 */
function repairRepeats(view) {
  const counts = new Map()
  for (const one of view.repairs.filter(repair => view.now - repair.at < DAY && repair.cause !== 'restart')) {
    const id = `${one.rule} ${one.subject}`
    counts.set(id, [...(counts.get(id) ?? []), one])
  }
  for (const [id, all] of counts) {
    const after = fixedAtOf(view, `repair-repeats ${id}`)
    counts.set(id, all.filter(one => one.at > after))
  }
  const found = []
  for (const [id, all] of [...counts].sort(([a], [b]) => byId(a, b))) {
    if (all.length < view.settings.repairsPerDay) continue
    const { rule, subject } = all[0]
    found.push({
      rule: 'repair-repeats', key: `repair-repeats ${id}`, subject,
      text: `The board repaired the same ${all.length} times in a day: ${rule} for ${subject}`,
      evidence: `at ${all.map(one => clockOf(one.at)).join(', ')}: ${all.at(-1).key}`,
    })
  }
  return found
}

/**
 * 8. A word to a chat not delivered for longer than `undeliveredMinutes`: still waiting, or expired or failed in the
 * last two hours. One finding per chat. A word the person's pause held counts from its release. B532: the repair of a
 * waiting word is the outbox's own: at every refresh its sweep (src/work/outboxSweep.mjs) closes what no longer matters,
 * with the reason, and a chat's next take hands it the rest however old, with its age (the main chat's start word, kept
 * as long, opens a chat that is not running). So the rule names only what still waits after that: a word the sweep would
 * drop is not named, nor a person's answer past its keep, which waits for its chat on purpose (a step that comes back).
 */
function undelivered(view) {
  // The person pauses: the bridge holds every word until Resume all.
  if (isPaused(view)) return []
  const limit = view.settings.undeliveredMinutes * MIN
  const runs = new Map(view.lanes.filter(chat => !chat.isLeftover).map(chat => [chat.name, chat.isRunning === true]))
  const ctx = { all: view.outbox, items: view.items, runs, goals: view.goals ?? [], now: view.now, keep: view.keep, closing: new Map() }
  // A word that waited too long still counts (the sweep marks it expired, and so does this rule); one that no longer
  // matters (dropped: superseded, its step moved on) does not.
  // B548: an answer waits for its chat however old (store.mjs isLate); past answerMs it is not named here.
  const stillWaits = message => whyClosed(message, ctx)?.state !== 'dropped'
    && !((message.ask ?? null) !== null && view.now - message.at - heldMs(message, view.now, view.pause) > view.keep.answerMs)
  const late = view.outbox.filter(message => typeof message?.to === 'string' && Number.isFinite(message.at)).filter(message => {
    // The time the person's pause held it does not count (as for the outbox's own expiry, store.mjs isLate), nor a
    // hold before its release (B285).
    const held = message.at + heldMs(message, view.now, view.pause)
    const since = afterPause(view, Number.isFinite(message.releasedAt) ? Math.max(held, message.releasedAt) : held)
    if (message.state === 'waiting') return view.now - since > limit && stillWaits(message)
    return (message.state === 'expired' || message.state === 'failed') && view.now - message.at < UNDELIVERED_LOOK_MS && view.now - since > limit
  })
  const byChat = new Map()
  for (const message of late) byChat.set(message.to, [...(byChat.get(message.to) ?? []), message])
  return [...byChat].sort(([a], [b]) => byId(a, b)).map(([chat, words]) => {
    const oldest = words.reduce((a, b) => (b.at < a.at ? b : a))
    return {
      rule: 'undelivered', key: `undelivered ${chat}`, subject: chat,
      text: `${words.length} ${words.length === 1 ? 'word' : 'words'} to ${chat} not delivered, the oldest for ${minutes(view.now - oldest.at)} min`,
      evidence: words.map(one => `${clockOf(one.at)} ${one.command ?? 'answer'}${one.about ? ` ${one.about}` : ''} (${one.state})`).join('; '),
    }
  })
}

/** 9. A step whose board check failed twice or more in a row since its last pass, and is not done. */
function reportCheckTwice(view) {
  const found = []
  for (const item of stepsOf(view).filter(one => !['done', 'dropped'].includes(stateOf(one)))) {
    const checks = (item.sections?.get('History') ?? []).filter(line => /\bserver: check (?:passed|failed)\b/.test(line))
    const lastPass = checks.findLastIndex(line => /\bserver: check passed\b/.test(line))
    const failed = checks.slice(lastPass + 1)
    if (failed.length < 2) continue
    const id = idOf(item)
    const detail = failed.at(-1).match(/server: check failed(?::\s*(.*))?$/)?.[1]?.trim() || 'no reason given'
    found.push({
      rule: 'report-check-twice', key: `report-check-twice ${id}`, subject: id,
      text: `${id}: the board's check failed ${failed.length} times in a row (${valueOf(item, 'Owner') ?? 'nobody'}): ${detail}`,
      evidence: failed.map(line => line.replace(/^-\s+/, '')).join(' | '),
    })
  }
  return found
}

export { FIRST_SAYING }

/**
 * 10. Chats on an older Workers mod than the one installed: they get the new one only when their chats start anew, and
 * the one way to that is the same for all (pause all, restart the app, resume all). B541: so one finding for all of
 * them, keyed by the installed version and naming each with what it misses: the main chat, the workers, the partner,
 * its helper and the supervisor's chat (oldMods.mjs). A chat whose version the board does not know (its mod did not ask
 * lately) is no case; one whose mod asked without saying its version (null) runs one older than FIRST_SAYING, a case
 * once that one or a newer one is installed (the review).
 */
function oldMod(view) {
  const found = oldModFinding(view.mods, chatsByRole({ chats: view.lanes, advisor: view.partner, advisorHelper: view.helper, supervisorChat: view.supervisor }))
  return found === null ? [] : [found]
}

/**
 * 11. B544 (the rule X9's sweep wanted): a chat whose card says an effort that is not a level (low ... max), as
 * "[object Object]" stood in the health summary. One finding per chat and what it says, so it is an incident once. A
 * chat whose card says no effort is no case.
 */
function oddEffort(view) {
  const chats = [...view.lanes.filter(lane => !lane.isLeftover), view.partner, view.helper, view.supervisor].filter(chat => typeof chat?.name === 'string')
  const found = []
  for (const chat of chats) {
    const said = effortSaid(chat)
    if (said === null || chatEffort(chat) !== null) continue
    const words = typeof said === 'string' ? said : JSON.stringify(said) ?? String(said)
    found.push({
      rule: 'odd-effort', key: `odd-effort ${chat.name} ${words.slice(0, 60)}`, subject: chat.name,
      text: `${chat.name}'s effort reads "${words.slice(0, 60)}", not a level`,
      evidence: `its card says ${words.slice(0, 200)}; a level is one of ${EFFORTS.join(', ')}`,
    })
  }
  return found
}

/**
 * 12. B543 (the fix of X8: a step sat in review for 3 days behind a dropped fix, four more for hours behind a chain of
 * fixes): a step in review says what it waits for (resultCheck.mjs `reviewWaitOf`). Waiting for an open fix, or for the
 * person's answer, is no case. Stuck: no result check filed for longer than `reviewMinutes` (its first, or again after
 * its fix was done or its ask point answered; the repair `unchecked` types the check word meanwhile), or its fix dropped
 * with none open (the repair `fix-dropped` tells the main chat). Counted from the end of the person's last pause.
 */
function reviewStuck(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  const partner = view.partner?.name ?? 'the partner'
  for (const item of stepsOf(view).filter(one => stateOf(one) === 'review').sort((a, b) => byId(idOf(a), idOf(b)))) {
    const wait = reviewWaitOf(item, view.items)
    if (wait === null || !['check', 'dropped'].includes(wait.kind)) continue
    const id = idOf(item)
    const key = wait.kind === 'check' ? `review-stuck ${id} check` : `review-stuck ${id} dropped ${wait.fix ?? 'none'}`
    const ms = lasted(view, ctx, key, afterPause(view, wait.since))
    if (ms <= view.settings.reviewMinutes * MIN) continue
    if (wait.kind === 'dropped') {
      found.push({
        rule: 'review-stuck', key, subject: id,
        text: `${id} in review, but ${wait.text}: nothing will close it`,
        evidence: `${id} owned by ${valueOf(item, 'Owner') ?? 'nobody'}; ${wait.text} ${minutes(ms)} min ago; no other fix of it is open`,
      })
      continue
    }
    // The check words the partner was sent about it (the board's ask for its check, the repair's wakes).
    const words = view.outbox.filter(message => message?.about === id && Number.isFinite(message.at) && message.at >= wait.since
      && (message.command === 'result-check' || String(message.syncKey ?? '').startsWith('unchecked ')))
    const last = words.reduce((a, b) => (a === null || b.at > a.at ? b : a), null)
    found.push({
      rule: 'review-stuck', key, subject: id,
      text: `${id} in review ${minutes(ms)} min with no result check filed (${wait.text})`,
      evidence: `since ${clockOf(view.now - ms)}; ${words.length === 0 ? `no check word to ${partner}` : `${words.length} check ${words.length === 1 ? 'word' : 'words'} to ${words[0].to ?? partner}, the last at ${clockOf(last.at)} (${last.state ?? 'not known'})`}`,
    })
  }
  return found
}

/** A span in words: "45 min", "2 h 10 min". */
const lasting = ms => (ms < HOUR ? `${minutes(ms)} min` : `${Math.floor(ms / HOUR)} h${minutes(ms % HOUR) > 0 ? ` ${minutes(ms % HOUR)} min` : ''}`)
/** A checkpoint's next action that is the report itself ("report B522", "work report B7 ..."). */
const REPORT_NEXT = /^\s*(?:work\s+)?report\b/i

/**
 * B572 (the fix of X24: B522 sat in progress 2 h 36 min, its last checkpoint "report B522" of 19:07 never followed by a
 * report): whether a step in progress has a stale checkpoint, as the rule stale-checkpoint and the health summary read it.
 * 'report': its last checkpoint's next action is to report, written over `reportMinutes` ago; 'old': in progress over
 * `checkpointMinutes` with no checkpoint within them (`checkpoint` null: none at all). Times count from the end of the
 * person's last pause at the earliest, less the time its worker stood suspended for the limit (the review: it cannot
 * write a checkpoint meanwhile). A checkpoint from before the step's current stretch in progress (it waited on you
 * since) counts as none: the stretch counts from its start. Null when it is not late, not in progress, the person
 * pauses, a limit is full, or its worker is paused for the limit now (it stands still on purpose). `{ kind, step,
 * checkpoint, quiet }`: `step` how long it has been in progress, `quiet` how long since its last checkpoint (or since
 * the stretch began, without one).
 */
export function checkpointLate(item, view) {
  if (stateOf(item) !== 'in progress' || isPaused(view) || isFull(view)) return null
  const owner = workersOf(view).find(lane => plain(lane.name, view.prefix) === plain(valueOf(item, 'Owner'), view.prefix))
  if (owner?.state === 'suspended') return null
  const began = sinceMs(valueOf(item, 'Since'))
  if (!Number.isFinite(began)) return null
  const checkpoint = checkpointOf(item)
  const written = Number.isFinite(checkpoint?.at) && checkpoint.at >= began ? checkpoint.at : null
  const counted = from => view.now - afterPause(view, from) - (owner === undefined ? 0 : suspendedMs(view, owner.name, afterPause(view, from)))
  const quiet = counted(written ?? began)
  const late = { step: view.now - began, checkpoint, quiet }
  if (written !== null && REPORT_NEXT.test(checkpoint.next) && quiet > view.settings.reportMinutes * MIN) return { kind: 'report', ...late }
  return counted(began) > view.settings.checkpointMinutes * MIN && quiet > view.settings.checkpointMinutes * MIN ? { kind: 'old', ...late } : null
}

/** B572: how long the chat stood suspended for the limit between `from` and now, by its timeline's spans. */
function suspendedMs(view, name, from) {
  const spans = view.timeline.find(one => plain(one.chat, view.prefix) === plain(name, view.prefix))?.spans ?? []
  return spans.filter(span => span.state === 'suspended')
    .reduce((sum, span) => sum + Math.max(0, Math.min(span.to ?? view.now, view.now) - Math.max(span.from, from)), 0)
}

/**
 * 13. B572: a step in progress with a stale checkpoint (checkpointLate): one finding for the main chat per step and
 * checkpoint, so a lasting one counts up as one incident and a newer stale checkpoint is a case of its own.
 */
function staleCheckpoint(view) {
  const found = []
  for (const item of stepsOf(view).sort((a, b) => byId(idOf(a), idOf(b)))) {
    const late = checkpointLate(item, view)
    if (late === null) continue
    const id = idOf(item)
    const { checkpoint } = late
    const who = `${id} in progress for ${lasting(late.step)} (${valueOf(item, 'Owner') ?? 'nobody'})`
    const text = late.kind === 'report' ? `${who}; its last checkpoint, "${checkpoint.next}" at ${clockOf(checkpoint.at)}, was never followed by a report`
      : checkpoint === null ? `${who} with no checkpoint` : `${who} with no checkpoint for ${lasting(late.quiet)}`
    found.push({
      rule: 'stale-checkpoint', key: `stale-checkpoint ${id} ${checkpoint?.line ?? 'none'}`, subject: id, text,
      evidence: `in progress since ${clockOf(sinceMs(valueOf(item, 'Since')))}; ${checkpoint === null ? 'no checkpoint in its record'
        : `checkpoint ${checkpoint.commit ?? 'none'} · ${checkpoint.next} at ${Number.isFinite(checkpoint.at) ? clockOf(checkpoint.at) : 'a time not known'}`}`,
    })
  }
  return found
}

/** Every watch rule, in the order the section shows them. */
export const WATCH_RULES = [
  { id: 'unknown-lane', kind: 'watch', says: 'a worker "unknown" for too long', check: unknownLane },
  { id: 'stale-suspended', kind: 'watch', says: 'a worker "suspended" after its limit came back', check: staleSuspended },
  { id: 'idle-while-waiting', kind: 'watch', says: 'all workers idle while steps wait', check: idleWhileWaiting },
  { id: 'holder-not-running', kind: 'watch', says: 'a step in progress whose worker does not run', check: holderNotRunning },
  { id: 'opus-wait', kind: 'watch', says: 'an Opus step waiting for Opus too long', check: opusWait },
  { id: 'skip-repeats', kind: 'watch', says: 'a clear or a compaction skipped for the same reason twice in a row', check: skipRepeats },
  { id: 'repair-repeats', kind: 'watch', says: 'the same repair three times or more in a day', check: repairRepeats },
  { id: 'undelivered', kind: 'watch', says: 'a word to a chat not delivered', check: undelivered },
  { id: 'report-check-twice', kind: 'watch', says: 'a step whose board check failed twice', check: reportCheckTwice },
  { id: 'old-mod', kind: 'watch', says: 'a chat on an older Workers mod than the one installed', check: oldMod },
  { id: 'odd-effort', kind: 'watch', says: 'a chat whose effort is not a level', check: oddEffort },
  { id: 'review-stuck', kind: 'watch', says: 'a step in review with no result check for too long, or whose fix was dropped', check: reviewStuck },
  { id: 'stale-checkpoint', kind: 'watch', says: 'a step in progress with no checkpoint for hours, or whose checkpoint said to report long ago', check: staleCheckpoint },
]
