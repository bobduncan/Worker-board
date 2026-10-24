// B465: the board's own list of the ways work got stuck, each with its fix. The person, 2026-10-21 (I50): "i want a
// structural fix for preventing this it gets stuck, of the out of sync button verifies this as well". Every way the
// person found by hand that day is a check here: a step blocked by one in review, a queued step its free owner did not
// take, a step owned by a chat no longer in the list, a yes to dropping a step in its refine, a worker paused for the
// limit after its time, a chat asking under an old name, the partner's helper not running while work waits for it, and
// an ask routed to the partner left unanswered. The board runs the list every few minutes (server.mjs) and makes the
// safe fixes itself; "Out of sync?" runs it at once. What it cannot fix goes to the main chat as one note, never twice
// for the same thing. A new way of getting stuck is added here, with its test, not fixed by hand (roles/main.md). PURE:
// `findStuck` reads, `applySync` acts through the ports it is given.

import { askFiledMs, sinceMs, valueOf } from './item.mjs'
import { stamp } from './migrate.mjs'
import { waitIds } from './guards.mjs'
import { PARTNER_AGAIN_MS, isRoutedToPartner, partnerAskWords } from './partnerAnswers.mjs'
import { isHolding } from './pause.mjs'
import { gitCheckPassed, needsResultCheck, resultCheckOf } from './resultCheck.mjs'
import { asksOfStep } from './stepAsks.mjs'

const MIN = 60_000

/** How often the board runs the list by itself. */
export const SYNC_EVERY_MS = 3 * MIN
/** A queued step its free owner was told of this long ago and did not take is woken again. */
export const NOT_TAKEN_MS = 10 * MIN
/** A step queued this long for a chat the list no longer shows goes to another (a chat about to join has this long). */
export const OWNER_GONE_MS = 30 * MIN
/** A wake of the board's own that changed nothing in this time goes to the main chat. */
export const AGAIN_MS = 10 * MIN
/** A refusal of an old name this recent says the chat still asks under it. */
export const REFUSED_MS = 10 * MIN
/** Refusals of an old name over this long say the chat's mod does not follow the shown name by itself. */
export const REFUSED_LASTS_MS = 2 * MIN
/** The lines to the partner about refines and result checks the helper may be waited on for, this far back. */
const HELPER_LOOK_MS = 6 * 60 * MIN

/** Every check of the list, in the order the answer shows them. */
export const CHECKS = [
  { key: 'blocked', words: 'a step blocked by one in review, or by one the store does not hold' },
  { key: 'not-taken', words: 'a queued step its free owner was told of and did not take' },
  { key: 'owner-gone', words: 'a step owned by a chat no longer in the list' },
  { key: 'refine-drop', words: 'a yes to dropping a step in its refine, which only the main chat carries out' },
  { key: 'limit-back', words: 'a worker paused for the limit after its time' },
  { key: 'old-name', words: 'a chat that asks under an old name' },
  { key: 'helper', words: 'the partner\'s helper not running while refines or result checks wait' },
  { key: 'partner-ask', words: 'an ask routed to the partner left unanswered' },
]

/** The states in which a step is its Owner's work now. */
const HOLDS = ['taken', 'in progress', 'waiting on you']
const CLOSED = ['done', 'dropped']

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')
const byId = (a, b) => idOf(a).localeCompare(idOf(b), 'en', { numeric: true })
const idsIn = value => (value ?? '').match(/\bB\d+\b/g) ?? []
/** A chat's name without the list's prefix, for comparing. */
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const minutes = ms => Math.max(1, Math.round(ms / MIN))
const answerOf = ask => (ask.sections?.get('Answer') ?? []).join(' ').trim()

/**
 * What is stuck now: `[{ check, key, text, fix }]`, in the order of `CHECKS`. `key` names the finding (one note to the
 * main chat per key, ever; the board's wake for it carries it as `syncKey`); `text` says what stands; `fix` what to do:
 * `{ do: 'unblock', id, on }`, `{ do: 'requeue', id, to }`, `{ do: 'wake', chat, id, text }` (a line typed to the
 * chat), `{ do: 'woken', at }` (woken a moment ago: it waits for that), `{ do: 'send', text }` (a note to the main chat
 * is the fix), `{ do: 'hand', chat, id, text }` (the helper's work to the partner, and the main chat told), or
 * `{ do: 'main', text }` (the board cannot fix it: the main chat is told).
 * The input: `items` (the store), `lanes` (the board's chats, state.mjs), `partner` and `helper` (their cards, or null),
 * `outbox` (the board's messages), `limits` (state.mjs), `pause` (the store's), `refused` (`[{ name, session, first,
 * at }]`, the names the board refused a chat under), `prefix`, `now`. The review: `seen` (a Map) holds since when the
 * runner has seen what only counts once it has lasted (an owner missing from the list, the helper not running); what
 * is seen now is added to `observed` (an array), so the runner keeps it and forgets the rest.
 */
/**
 * B482: a step in review that no longer holds what waits on it: the board's check passed, and so did its result check
 * when it needs one (a pending, missing or failed one holds it, as a fix may follow).
 */
// (A failed result check holds it until the step is checked again, also when its fix is done: the fix's own report
// asks the check anew.)
const isMergedAndChecked = item => stateOf(item) === 'review' && gitCheckPassed(item) && (!needsResultCheck(item) || resultCheckOf(item) === 'passed')

/** B482: how long the loop's lock (`mayRunLoop`) holds without a run of its owner. */
export const LOOP_LOCK_MS = 2 * SYNC_EVERY_MS + MIN

/**
 * B482: one loop per project. `lock` is what the project's lock file holds (`{ pid, port, at }`, or null): this board
 * process (`me`) may run the list when there is none, it is its own, or its owner has not run for LOOP_LOCK_MS (gone).
 */
export function mayRunLoop(lock, me, now) {
  if (lock === null || typeof lock !== 'object' || !Number.isFinite(lock.at)) return true
  return lock.pid === me || now - lock.at > LOOP_LOCK_MS
}

/**
 * B487: what the project's lock file holds, read through `read` (a function giving its text). None, or one cut off
 * mid-write (not JSON), is null: taken over like a dead one. Any other failure is thrown, for the loop record.
 */
export async function readLoopLock(read) {
  let text
  try {
    text = await read()
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export function findStuck({ items = new Map(), lanes = [], partner = null, helper = null, prefix = '', now, outbox = [], limits = {}, pause = null, refused = [], seen = new Map(), observed = [] }) {
  const all = [...items.values()]
  const steps = all.filter(item => kindOf(item) === 'step' && typeof idOf(item) === 'string').sort(byId)
  const live = lanes.filter(lane => !lane.isLeftover)
  const workers = live.filter(lane => lane.isMain !== true)
  const laneOf = name => live.find(lane => plain(lane.name, prefix) === plain(name, prefix))
  const isHeld = isHolding(pause)
  const holds = name => steps.some(item => HOLDS.includes(stateOf(item)) && plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix))
  const isFull = ['fiveHour', 'week'].some(limit => limits?.[limit]?.level === 'full')
  // The board's own wake for a finding: woken a moment ago, it waits for that; longer ago and still stuck, `late`.
  const wakeOr = (key, wake, late) => {
    const at = outbox.findLast(message => message.syncKey === key)?.at ?? null
    if (at === null) return wake
    return now - at < AGAIN_MS ? { do: 'woken', at } : late
  }
  const found = []

  // A step blocked by one in review whose board check passed (its work is merged; only its result check is open), or
  // by one the store lacks. The review: in review with a check pending or failed is not merged: it holds.
  for (const item of steps.filter(one => !CLOSED.includes(stateOf(one)) && stateOf(one) !== 'review')) {
    const id = idOf(item)
    for (const on of idsIn(valueOf(item, 'Blocked by'))) {
      const other = items.get(on)
      if (other === undefined) {
        const text = `${id} is blocked by ${on}, which the store does not hold`
        found.push({ check: 'blocked', key: `blocked ${id} ${on}`, text, fix: { do: 'main', text: `${text}: unblock it or make ${on}` } })
      } else if (isMergedAndChecked(other)) {
        found.push({ check: 'blocked', key: `blocked ${id} ${on}`, text: `${id} waited on ${on}, which is in review`, fix: { do: 'unblock', id, on } })
      }
    }
    // A `Waits for` is the main chat's or the person's to clear: the board says so.
    for (const on of waitIds(item).filter(one => /^B\d+$/.test(one))) {
      const other = items.get(on)
      if (other !== undefined && !isMergedAndChecked(other)) continue
      const what = other === undefined ? 'which the store does not hold' : 'in review'
      const text = `${id} waits for ${on} (${what}) in its Waits for words`
      found.push({ check: 'blocked', key: `blocked ${id} ${on}`, text, fix: { do: 'main', text: `${text}: clear it (work unblock ${id})` } })
    }
  }

  // A queued step its free owner was told of a while ago and did not take: woken again, once; then the main chat.
  if (!isHeld) {
    const done = new Set()
    for (const item of steps.filter(one => stateOf(one) === 'queued')) {
      const id = idOf(item)
      const lane = laneOf(valueOf(item, 'Owner'))
      if (lane === undefined || lane.isMain === true || lane.state !== 'free' || holds(lane.name) || done.has(lane.name)) continue
      const queuedAt = sinceMs(valueOf(item, 'Since'))
      const told = outbox.findLast(message => message.command === 'work' && message.about === id && plain(message.to, prefix) === plain(lane.name, prefix)
        && message.syncKey === undefined && ['delivered', 'taken'].includes(message.state) && !(message.at < queuedAt - MIN))
      if (told === undefined || now - told.at < NOT_TAKEN_MS) continue
      done.add(lane.name)
      const key = `not-taken ${id} ${lane.name} ${valueOf(item, 'Since') ?? ''}`.trim()
      const text = `${lane.name}: its queued ${id} waited ${minutes(now - told.at)} min while it was free`
      const fix = wakeOr(key, { do: 'wake', chat: lane.name, id, text: `work: ${id} is yours; run work next (the board's check: it waited ${minutes(now - told.at)} min)` },
        { do: 'main', text: `${lane.name} did not take ${id} after the board woke it again: look why` })
      found.push({ check: 'not-taken', key, text, fix })
    }
  }

  // A step owned by a chat the list no longer shows: a queued one goes to a free worker; one it held is the main chat's.
  // The review: only once the owner has been missing for OWNER_GONE_MS by the runner's own watch (a chat file the app
  // rewrites is skipped for one read, an account switch drops chats for a while), and never while the person pauses.
  if (workers.length > 0 && !isHeld) {
    const known = name => laneOf(name) !== undefined || [partner, helper].some(card => card !== null && plain(card.name, prefix) === plain(name, prefix))
    const given = new Map()
    const queuedFor = name => steps.filter(item => stateOf(item) === 'queued' && plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)).length + (given.get(name) ?? 0)
    for (const item of steps.filter(one => ['queued', ...HOLDS].includes(stateOf(one)) && valueOf(one, 'Owner') !== null)) {
      const id = idOf(item)
      const owner = valueOf(item, 'Owner')
      if (known(owner)) continue
      const watch = `missing ${plain(owner, prefix)}`
      if (!observed.includes(watch)) observed.push(watch)
      if (!(now - (seen.get(watch) ?? now) >= OWNER_GONE_MS)) continue
      const key = `owner-gone ${id} ${owner}`
      if (stateOf(item) !== 'queued') {
        const text = `${id} is ${stateOf(item)} for ${owner}, no longer in the list`
        found.push({ check: 'owner-gone', key, text, fix: { do: 'main', text: `${text}: hand it on (its work may stand on a branch)` } })
        continue
      }
      const free = workers.filter(lane => lane.state === 'free' && !holds(lane.name))
        .sort((a, b) => Number(b.isRunning !== false) - Number(a.isRunning !== false) || queuedFor(a.name) - queuedFor(b.name))
      const text = `${id} was queued for ${owner}, no longer in the list`
      if (free.length === 0) {
        found.push({ check: 'owner-gone', key, text, fix: { do: 'main', text: `${text}, and no worker is free: queue it for another` } })
        continue
      }
      given.set(free[0].name, (given.get(free[0].name) ?? 0) + 1)
      found.push({ check: 'owner-gone', key, text, fix: { do: 'requeue', id, to: free[0].name } })
    }
  }

  // A yes to dropping a step in its refine: the partner cannot drop, the main chat does.
  for (const item of steps.filter(one => !CLOSED.includes(stateOf(one)))) {
    const id = idOf(item)
    for (const ask of asksOfStep(items, id)) {
      if (stateOf(ask) !== 'answered' || !/^\s*drop\b/i.test(valueOf(ask, 'Title') ?? '')) continue
      const owner = valueOf(ask, 'Owner')
      const isPartners = valueOf(ask, 'Via') === 'refine' || [partner, helper].some(card => card !== null && plain(card.name, prefix) === plain(owner, prefix))
      if (!isPartners || !/^\s*(?:yes|y|ja|drop)\b/i.test(answerOf(ask))) continue
      const askId = idOf(ask)
      found.push({
        check: 'refine-drop', key: `refine-drop ${id} ${askId}`, text: `${id}: the person's yes to dropping it (${askId})`,
        fix: { do: 'send', text: `${id}: the person answered yes to dropping it (${askId}): drop it (work drop ${id})` },
      })
    }
  }

  // A worker paused for the limit whose time has passed: nothing starts it by itself. Never while a limit is full.
  if (!isHeld && !isFull) {
    for (const lane of workers.filter(one => one.state === 'suspended' && one.suspended?.isBack === true)) {
      const held = steps.find(item => HOLDS.includes(stateOf(item)) && plain(valueOf(item, 'Owner'), prefix) === plain(lane.name, prefix))
      if (held === undefined) continue
      const id = idOf(held)
      const until = Number.isFinite(lane.suspended.until) ? ` until ${clockOf(lane.suspended.until)}` : ''
      const key = `limit-back ${lane.name} ${lane.suspended.since ?? ''}`.trim()
      const fix = wakeOr(key, { do: 'wake', chat: lane.name, id, text: `work: the limit is back: go on with ${id} from its checkpoint; run work next` },
        { do: 'main', text: `${lane.name} did not go on with ${id} after the limit came back: start it` })
      found.push({ check: 'limit-back', key, text: `${lane.name}: paused for the limit${until}, the limit is back`, fix })
    }
  }

  // A chat that asks under an old name: the board cannot reach it (its words go by name), the main chat can.
  const cards = [...live, ...[partner, helper].filter(card => card !== null)]
  const told = new Set()
  // The review: the Workers mod since B463 joins under the shown name at its next take, so one refusal is no case;
  // refusals over two minutes are (a mod from before that).
  for (const one of refused.filter(at => now - at.at < REFUSED_MS && at.at - (at.first ?? at.at) >= REFUSED_LASTS_MS)) {
    const shown = cards.find(card => typeof card.session === 'string' && card.session === one.session)
    if (shown === undefined || plain(shown.name, prefix) === plain(one.name, prefix)) continue
    const key = `old-name ${one.name} ${shown.name}`
    if (told.has(key)) continue
    told.add(key)
    const text = `${shown.name} asks under its old name ${one.name}`
    found.push({ check: 'old-name', key, text, fix: { do: 'send', text: `${text}: ask it to join as "${shown.name}" (chat join)` } })
  }

  // The partner's helper not running while refines or result checks wait for the partner: woken (the main chat starts
  // it); still not running a while later, the partner is told to do them itself, and the main chat to start it.
  if (helper !== null && (helper.isRunning === false || helper.state === 'off') && !isHeld) {
    const recent = outbox.filter(message => now - message.at < HELPER_LOOK_MS && (partner === null || plain(message.to, prefix) === plain(partner.name, prefix)))
    const waits = new Set()
    for (const message of recent) {
      const item = items.get(message.about)
      if (item === undefined) continue
      // The review: a refine block that is "open" waits for the person's answers, not for the partner.
      if (message.command === 'refine' && !CLOSED.includes(stateOf(item)) && valueOf(item, 'Refined') === null) waits.add(idOf(item))
      if (message.command === 'result-check' && stateOf(item) === 'review' && resultCheckOf(item) === null) waits.add(idOf(item))
    }
    const ids = [...waits].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    if (ids.length > 0) {
      // The review: one key per time it stops running (since the runner first saw it so), not per set of waiting ids,
      // so the main chat is told once for it and the helper woken once.
      const watch = `helper off ${plain(helper.name, prefix)}`
      observed.push(watch)
      const key = `helper ${helper.name} ${stamp(seen.get(watch) ?? now)}`
      const text = `${helper.name} is not running: ${ids.length} refines and checks wait`
      const late = partner === null
        ? { do: 'main', text: `${text} (${ids.join(', ')}), and it did not start when woken: start it` }
        : { do: 'hand', chat: partner.name, id: ids[0], text: `work: ${helper.name} is not running: do the waiting refines and result checks yourself (${ids.join(', ')}); run work next` }
      const fix = wakeOr(key, { do: 'wake', chat: helper.name, id: ids[0], text: `work: the board woke you: ${ids.length} refines and result checks wait for ${partner?.name ?? 'the partner'} (${ids.join(', ')}); ask it which are yours` }, late)
      found.push({ check: 'helper', key, text, fix })
    }
  }

  // An ask routed to the partner, open ten minutes with no line about it lately (the partner was busy when the
  // reconciler would have woken it): it is woken now, busy or not; its line waits for the end of its turn.
  if (partner !== null && !isHeld) {
    for (const ask of all.filter(isRoutedToPartner).sort(byId)) {
      const id = idOf(ask)
      const filed = askFiledMs(ask)
      if (!(now - filed >= PARTNER_AGAIN_MS)) continue
      const lately = outbox.some(message => message.about === id && (message.kind === 'partner-ask' || String(message.syncKey ?? '').startsWith('partner-ask '))
        && (message.state === 'waiting' || message.state === 'taken' || now - message.at < PARTNER_AGAIN_MS))
      if (lately) continue
      const key = `partner-ask ${id} ${Math.floor((now - filed) / PARTNER_AGAIN_MS)}`
      found.push({ check: 'partner-ask', key, text: `${id} routed to ${partner.name}, unanswered for ${minutes(now - filed)} min`, fix: { do: 'wake', chat: partner.name, id, text: partnerAskWords(id) } })
    }
  }

  const order = new Map(CHECKS.map((one, index) => [one.key, index]))
  return found.map((one, index) => ({ one, index })).sort((a, b) => order.get(a.one.check) - order.get(b.one.check) || a.index - b.index).map(({ one }) => one)
}

/**
 * The findings carried out, in their order. `ports`: `unblock(id, on, why)` and `requeue(id, to, why)` (the work API as
 * the board: `{ ok, why }`), `wake({ chat, id, text, key })` (the line sent once per key: the message, or null when it
 * went before). `noted` the keys the main chat was told of before. Answers `{ rows, note, keys, fine }`: a row per
 * finding (`{ check, status, text }`, status Fixed, Woke, Sent or For Main), the lines of the one note to the main
 * chat (what it was not told before), their keys, and how many checks found nothing.
 */
/** A wake through its port: `{ message, why }`, the message or null (sent before), and why it failed when it threw. */
const wakeBy = (ports, one) => Promise.resolve().then(() => ports.wake(one))
  .then(message => ({ message: message ?? null, why: null }), error => ({ message: null, why: error instanceof Error ? error.message : String(error) }))

export async function applySync(findings, ports, noted = new Set()) {
  const rows = []
  const note = []
  const keys = []
  const tell = (one, line) => {
    if (noted.has(one.key) || keys.includes(one.key)) return
    keys.push(one.key)
    note.push(line)
  }
  const row = (one, status, text) => rows.push({ check: one.check, status, text })
  for (const one of findings) {
    const fix = one.fix
    if (fix.do === 'unblock' || fix.do === 'requeue') {
      const done = await Promise.resolve()
        .then(() => (fix.do === 'unblock' ? ports.unblock(fix.id, fix.on, one.text) : ports.requeue(fix.id, fix.to, one.text)))
        .catch(error => ({ ok: false, why: error instanceof Error ? error.message : String(error) }))
      if (done?.ok === true) row(one, 'Fixed', `${one.text}: ${fix.do === 'unblock' ? 'unblocked' : `queued for ${fix.to}`}`)
      else {
        const text = `${one.text}: not fixed (${done?.why ?? 'no answer'})`
        row(one, 'For Main', text)
        // The review: a file changed while it was written is tried again at the next run; nothing for the main chat.
        if (!/changed in the meantime/.test(done?.why ?? '')) tell(one, text)
      }
    } else if (fix.do === 'wake') {
      // The review: a wake that throws is one finding not carried out, not the end of the run.
      const sent = await wakeBy(ports, { chat: fix.chat, id: fix.id, text: fix.text, key: one.key })
      if (sent.message !== null) row(one, 'Woke', one.text)
      else {
        const text = `${one.text}: ${sent.why === null ? 'woken before, still stuck' : `not woken (${sent.why})`}`
        row(one, 'For Main', text)
        tell(one, text)
      }
    } else if (fix.do === 'woken') {
      row(one, 'Woke', `${one.text} (woken at ${clockOf(fix.at)})`)
    } else if (fix.do === 'send') {
      row(one, 'Sent', `${one.text}: to Main as a note`)
      tell(one, fix.text)
    } else if (fix.do === 'hand') {
      const sent = await wakeBy(ports, { chat: fix.chat, id: fix.id, text: fix.text, key: `${one.key} hand` })
      const text = `${one.text}: ${sent.why === null ? `its work went to ${fix.chat}` : `${fix.chat} could not be told (${sent.why})`}`
      row(one, 'For Main', text)
      tell(one, `${text}; start it`)
    } else {
      row(one, 'For Main', one.text)
      tell(one, fix.text ?? one.text)
    }
  }
  return { rows, note, keys, fine: CHECKS.length - new Set(findings.map(one => one.check)).size }
}

/** How long the answer of a run that was asked, or that found something, stands on the page. */
export const SYNC_SHOWN_MS = 60 * MIN
/** The keys the main chat was told of, kept at most this many (the newest). */
const NOTED_KEPT = 500

/**
 * The board's runner of the list: one run at a time, in turn (a click while a run goes waits for it, then runs). `ports`:
 * `state()` the board's state (state.mjs), `items()` the store's items, `outbox()` the board's messages, `refused()` the
 * names a chat was refused under lately, `apply(body)` the work API as the board, `wake({ chat, id, text, key })` a
 * line sent once per key (the message, or null), `noted` `{ load(), save(keys) }` the keys the main chat was told of,
 * `now()`. `run({ asked })` answers `{ at, asked, rows, fine }`; `shown(now)` is what the page shows: the newest run
 * that was asked or found something, for an hour, else null.
 */
export function syncRunner(ports) {
  let turn = Promise.resolve()
  let shownRun = null
  let noted = null
  // The review: since when each thing that counts only once it lasts has been seen (findStuck's `seen`).
  let seen = new Map()
  async function once(asked) {
    const now = ports.now()
    const state = await ports.state()
    // B482: what was noted and seen is kept with the project (sync.json) and read at every run, so a restart, or a
    // board that takes the loop over from another, neither tells the main chat again nor starts a wait anew
    const kept = await ports.noted.load()
    noted = new Set(Array.isArray(kept) ? kept : kept?.noted ?? [])
    if (!Array.isArray(kept) && kept?.seen !== null && typeof kept?.seen === 'object') {
      seen = new Map(Object.entries(kept.seen).filter(([, at]) => Number.isFinite(at)))
    }
    const observed = []
    const findings = findStuck({
      items: await ports.items(), lanes: state.chats ?? [], partner: state.advisor ?? null, helper: state.advisorHelper ?? null,
      prefix: state.chatPrefix ?? '', now, outbox: ports.outbox(), limits: state.limits ?? {}, pause: state.pause ?? null, refused: ports.refused(),
      seen, observed,
    })
    const seenBefore = JSON.stringify([...seen])
    seen = new Map(observed.map(key => [key, seen.get(key) ?? now]))
    let changed = JSON.stringify([...seen]) !== seenBefore
    const done = await applySync(findings, {
      unblock: (id, on, why) => ports.apply({ action: 'unblock', id, on, why }),
      requeue: (id, to, why) => ports.apply({ action: 'requeue', id, for: to, why }),
      wake: ports.wake,
    }, noted)
    if (done.note.length > 0) {
      const sent = await ports.apply({ action: 'note', to: 'main', text: [`The board's sync check at ${clockOf(now)}: what it could not fix itself`, ...done.note.map(line => `- ${line}`)] })
      // Not filed: told at the next run. Filed: never again for these keys.
      if (sent?.ok === true) {
        for (const key of done.keys) noted.add(key)
        noted = new Set([...noted].slice(-NOTED_KEPT))
        changed = true
      }
    }
    if (changed) await ports.noted.save({ noted: [...noted], seen: Object.fromEntries(seen) })
    const answer = { at: now, asked, rows: done.rows, fine: done.fine }
    // The review: a later run that finds nothing clears what the board found by itself; the button's answer stays.
    if (asked || answer.rows.length > 0) shownRun = answer
    else if (shownRun !== null && !shownRun.asked) shownRun = null
    return answer
  }
  return {
    run: ({ asked = false } = {}) => {
      const run = turn.then(() => once(asked))
      turn = run.catch(error => ports.failed?.(error))
      return run
    },
    shown: now => (shownRun !== null && now - shownRun.at < SYNC_SHOWN_MS ? shownRun : null),
  }
}

/**
 * B489: the loop's own check, as the server runs it before every list: `read` and `write` (the lock file's text, in and
 * out), `alive(pid)`. Gives true when this process (`pid`) holds the lock after it, with the lock written then.
 */
export function loopOwner({ read, write, alive, pid, port, now }) {
  return async () => {
    const held = await readLoopLock(read)
    // a lock whose process is gone (a board killed without its exit) is taken over at once
    const lock = held !== null && Number.isInteger(held.pid) && held.pid !== pid && !alive(held.pid) ? null : held
    if (!mayRunLoop(lock, pid, now())) return false
    await write(JSON.stringify({ pid, port, at: now() }))
    return true
  }
}
