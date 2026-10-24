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
import { isHolding } from '../../work/pause.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** How far back a word that expired or failed still counts as undelivered. */
const UNDELIVERED_LOOK_MS = 2 * HOUR
/** The window of each limit: a pause older than its limit's window has outlived any stop of it. */
const WINDOW_MS = { fiveHour: 5 * HOUR, week: 7 * DAY }
const LIMIT_WORDS = { fiveHour: 'the 5-hour limit', week: 'the weekly limit' }
/** Reasons a compaction is skipped by design, not by a fault: a small chat, or compaction switched off. */
const BY_DESIGN = ['it is small enough', 'switched off in the list of chats']
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

/**
 * How long a thing has lasted: since `since` (what the board's data says), or since the supervisor first saw it (`key`
 * in its watch), whichever is earlier. The key is watched from now on, so a lasting thing is timed across runs.
 */
function lasted(view, ctx, key, since = null) {
  if (!ctx.observed.includes(key)) ctx.observed.push(key)
  const first = Math.min(Number.isFinite(since) ? since : Infinity, ctx.seen.get(key) ?? view.now)
  return view.now - first
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
    const ms = lasted(view, ctx, key, since)
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
  if (workers.length === 0 || isHolding(view.pause) || ['fiveHour', 'week'].some(limit => view.limits?.[limit]?.level === 'full')) return []
  if (!workers.every(lane => IDLE.includes(lane.state))) return []
  const ctxStore = { store: { items: view.items } }
  const waiting = stepsOf(view).filter(item => stateOf(item) === 'queued' && blockersOpen(item, ctxStore).length === 0 && waitWords(item) === null)
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
  for (const item of stepsOf(view).filter(one => HOLDS.includes(stateOf(one)))) {
    const owner = valueOf(item, 'Owner')
    const lane = workersOf(view).find(one => plain(one.name, view.prefix) === plain(owner, view.prefix))
    if (lane === undefined || !(lane.isRunning === false || lane.state === 'off')) continue
    const id = idOf(item)
    const key = `holder-not-running ${id}`
    const ms = lasted(view, ctx, key, Number.isFinite(lane.offSince) ? lane.offSince : lane.state === 'off' ? view.since.get(lane.name) : null)
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
  for (const lane of workersOf(view)) {
    const waits = lane.effortRun?.waitsFor
    if (waits?.model !== 'opus' || typeof lane.effortRun?.step !== 'string') continue
    const step = lane.effortRun.step
    const key = `opus-wait ${step}`
    const ms = lasted(view, ctx, key, waits.since)
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

/** 7. The same repair (a repair rule, on the same chat or step) `repairsPerDay` times or more in a day. */
function repairRepeats(view) {
  const counts = new Map()
  for (const one of view.repairs.filter(repair => view.now - repair.at < DAY)) {
    const id = `${one.rule} ${one.subject}`
    counts.set(id, [...(counts.get(id) ?? []), one])
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
 * last two hours. One finding per chat. A word the person's pause held counts from its release.
 */
function undelivered(view) {
  const limit = view.settings.undeliveredMinutes * MIN
  const late = view.outbox.filter(message => typeof message?.to === 'string' && Number.isFinite(message.at)).filter(message => {
    const since = Number.isFinite(message.releasedAt) ? Math.max(message.at, message.releasedAt) : message.at
    if (message.state === 'waiting') return view.now - since > limit
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

/** A version's numbers, "0.15.2" as [0, 15, 2]; null for none. */
const versionOf = text => (typeof text === 'string' && /^\d+(?:\.\d+)*$/.test(text.trim()) ? text.trim().split('.').map(Number) : null)
const isOlder = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
  return false
}

/**
 * 10. A chat on an older Workers mod than the one installed: it gets the new one only when its chat starts anew. A
 * chat whose version the board does not know is no case.
 */
function oldMod(view) {
  const installed = versionOf(view.mods.installed)
  if (installed === null) return []
  const found = []
  for (const lane of view.lanes.filter(one => !one.isLeftover)) {
    const version = view.mods.chats[lane.name]
    const runs = versionOf(version)
    if (runs === null || !isOlder(runs, installed)) continue
    found.push({
      rule: 'old-mod', key: `old-mod ${lane.name} ${version}`, subject: lane.name,
      text: `${lane.name} runs the Workers mod ${version}; ${view.mods.installed} is installed`,
      evidence: `installed ${view.mods.installed}, the chat's ${version}`,
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
]
