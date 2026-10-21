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
import { waitIds } from './guards.mjs'
import { PARTNER_AGAIN_MS, isRoutedToPartner, partnerAskWords } from './partnerAnswers.mjs'
import { isHolding } from './pause.mjs'
import { resultCheckOf } from './resultCheck.mjs'
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
 * `outbox` (the board's messages), `limits` (state.mjs), `pause` (the store's), `refused` (`[{ name, session, at }]`,
 * the names the board refused a chat under), `prefix`, `now`.
 */
export function findStuck({ items = new Map(), lanes = [], partner = null, helper = null, prefix = '', now, outbox = [], limits = {}, pause = null, refused = [] }) {
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

  // A step blocked by one in review (its work is merged; only its result check is open), or by one the store lacks.
  for (const item of steps.filter(one => !CLOSED.includes(stateOf(one)) && stateOf(one) !== 'review')) {
    const id = idOf(item)
    for (const on of idsIn(valueOf(item, 'Blocked by'))) {
      const other = items.get(on)
      if (other === undefined) {
        const text = `${id} is blocked by ${on}, which the store does not hold`
        found.push({ check: 'blocked', key: `blocked ${id} ${on}`, text, fix: { do: 'main', text: `${text}: unblock it or make ${on}` } })
      } else if (stateOf(other) === 'review') {
        found.push({ check: 'blocked', key: `blocked ${id} ${on}`, text: `${id} waited on ${on}, which is in review`, fix: { do: 'unblock', id, on } })
      }
    }
    // A `Waits for` is the main chat's or the person's to clear: the board says so.
    for (const on of waitIds(item).filter(one => /^B\d+$/.test(one))) {
      const other = items.get(on)
      if (other !== undefined && stateOf(other) !== 'review') continue
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
  if (workers.length > 0) {
    const known = name => laneOf(name) !== undefined || [partner, helper].some(card => card !== null && plain(card.name, prefix) === plain(name, prefix))
    const given = new Map()
    const queuedFor = name => steps.filter(item => stateOf(item) === 'queued' && plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)).length + (given.get(name) ?? 0)
    for (const item of steps.filter(one => ['queued', ...HOLDS].includes(stateOf(one)) && valueOf(one, 'Owner') !== null)) {
      const id = idOf(item)
      const owner = valueOf(item, 'Owner')
      const since = sinceMs(valueOf(item, 'Since'))
      if (known(owner) || !(now - since >= OWNER_GONE_MS)) continue
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
  for (const one of refused.filter(at => now - at.at < REFUSED_MS)) {
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
      if (message.command === 'refine' && !CLOSED.includes(stateOf(item)) && valueOf(item, 'Refined') !== 'ready') waits.add(idOf(item))
      if (message.command === 'result-check' && stateOf(item) === 'review' && resultCheckOf(item) === null) waits.add(idOf(item))
    }
    const ids = [...waits].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    if (ids.length > 0) {
      const key = `helper ${helper.name} ${ids.join(',')}`
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
        tell(one, text)
      }
    } else if (fix.do === 'wake') {
      const sent = await ports.wake({ chat: fix.chat, id: fix.id, text: fix.text, key: one.key })
      if (sent !== null && sent !== undefined) row(one, 'Woke', one.text)
      else {
        const text = `${one.text}: woken before, still stuck`
        row(one, 'For Main', text)
        tell(one, text)
      }
    } else if (fix.do === 'woken') {
      row(one, 'Woke', `${one.text} (woken at ${clockOf(fix.at)})`)
    } else if (fix.do === 'send') {
      row(one, 'Sent', `${one.text}: to Main as a note`)
      tell(one, fix.text)
    } else if (fix.do === 'hand') {
      await ports.wake({ chat: fix.chat, id: fix.id, text: fix.text, key: `${one.key} hand` })
      const text = `${one.text}: its work went to ${fix.chat}`
      row(one, 'For Main', text)
      tell(one, `${text}; start it`)
    } else {
      row(one, 'For Main', one.text)
      tell(one, fix.text ?? one.text)
    }
  }
  return { rows, note, keys, fine: CHECKS.length - new Set(findings.map(one => one.check)).size }
}
