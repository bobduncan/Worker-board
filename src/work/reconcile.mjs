// B300: the reconciler (spec 2026-10-17, section 7). Every refresh the server holds the store's files against the board's
// lanes, one rule per row of the spec's table, and answers what to do: the moves the flow lets the server make, the
// steps to deliver (a wake: the chat's own `take` moves queued → taken), and the flags the board shows. It moves
// nothing itself and never invents a move the flow does not allow; a file it cannot read is named, not moved.

import { mayMove, statesOf } from './flow.mjs'
import { overlapsIn } from './guards.mjs'
import { sinceMs, valueOf } from './item.mjs'

/** The states in which a step is its Owner's work now. */
const HOLDS = ['taken', 'in progress', 'waiting on you']
const MIN = 60_000

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stateOf = item => valueOf(item, 'State')
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })
/** A chat's name without the title's prefix, for comparing. */
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const whose = name => (/s$/i.test(name) ? `${name}'` : `${name}'s`)
const span = ms => {
  const minutes = Math.floor(ms / MIN)
  const hours = Math.floor(minutes / 60)
  return hours === 0 ? `${minutes} min` : `${hours} h${minutes % 60 === 0 ? '' : ` ${minutes % 60} min`}`
}

/**
 * `{ store, flow, lanes, now, times, prefix }` → `{ moves, deliveries, flags }`. `store` is readStore's answer (`items`,
 * `problems`), `flow` its flow, `lanes` the board's chats (`name`, `state`, `isRunning`, `isLeftover`, `lastActivityAt`,
 * `task`), `times` `{ graceMs, askMs }` (src/config.mjs). `moves`: `[{ id, to, why }]`; `deliveries`: `[{ id, chat,
 * why }]`, one per chat; `flags`: `[{ kind, id, chat, text, button }]`, a lane's when `chat` is set, else a line on top;
 * a flag with `say` tells its chat that once (`key`).
 */
export function reconcile({ store, flow = store.flow, lanes = [], now, times, prefix = '' }) {
  const items = store.items ?? new Map()
  const broken = new Set((store.problems ?? []).map(problem => problem.file?.match(/^([A-Z]\d+|L-[0-9a-f]{8})\.md$/)?.[1]).filter(Boolean))
  const live = lanes.filter(lane => !lane.isLeftover)
  const laneOf = owner => (owner === null ? undefined : live.find(lane => plain(lane.name, prefix) === plain(owner, prefix)))
  const steps = [...items.values()].filter(item => kindOf(item) === 'step' && !broken.has(valueOf(item, 'Id'))).sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))
  const known = item => statesOf(flow, kindOf(item)).includes(stateOf(item))
  const moves = []
  const deliveries = []
  const flags = []

  // A file whose head is broken, an id twice, a state the flow does not know: one line on top each, nothing moved.
  for (const problem of store.problems ?? []) flags.push({ kind: 'broken', id: null, chat: null, text: problem.line, button: null })
  for (const item of [...items.values()].filter(one => !known(one) && !broken.has(valueOf(one, 'Id')))) {
    flags.push({ kind: 'broken', id: valueOf(item, 'Id'), chat: null, text: `${valueOf(item, 'Id')}: its state "${stateOf(item)}" is not in flow.json; it is shown as it is, not moved`, button: null })
  }
  const ok = steps.filter(known)
  const overlaps = overlapsIn(items)

  // A step queued whose guards hold and whose Owner is free: the Owner is woken (its `take` moves it to taken).
  const holding = new Set(ok.filter(item => HOLDS.includes(stateOf(item)) && valueOf(item, 'Owner') !== null).map(item => plain(valueOf(item, 'Owner'), prefix)))
  for (const item of ok.filter(one => stateOf(one) === 'queued')) {
    const owner = valueOf(item, 'Owner')
    const lane = laneOf(owner)
    if (lane === undefined || lane.state !== 'free' || holding.has(plain(owner, prefix)) || deliveries.some(one => one.chat === lane.name)) continue
    const ctx = { store: { items }, freeChats: new Set([owner]), now, overlaps }
    if (!mayMove(flow, item, 'taken', 'server', ctx).ok) continue
    const id = valueOf(item, 'Id')
    deliveries.push({ id, chat: lane.name, why: `deliver ${id} to ${lane.name}` })
  }

  // A step taken or in progress whose Owner is not running and not held by the limit: flagged after the grace time.
  for (const item of ok.filter(one => ['taken', 'in progress'].includes(stateOf(one)))) {
    const lane = laneOf(valueOf(item, 'Owner'))
    if (lane === undefined || lane.isRunning !== false || lane.state === 'suspended') continue
    const since = Math.max(Number.isFinite(sinceMs(valueOf(item, 'Since'))) ? sinceMs(valueOf(item, 'Since')) : 0, Number.isFinite(lane.lastActivityAt) ? lane.lastActivityAt : 0)
    if (now - since < times.graceMs) continue
    const id = valueOf(item, 'Id')
    flags.push({ kind: 'stuck', id, chat: lane.name, text: `${id}: ${lane.name} holds it but is not running`, button: `Start ${lane.name}` })
  }

  // An ask open with Blocking yes for longer than the ask time: it stands first under Needs your attention; nothing is
  // sent again.
  const asks = [...items.values()].filter(item => kindOf(item) === 'ask' && stateOf(item) === 'open' && valueOf(item, 'Blocking') === 'yes')
  for (const item of asks.sort((a, b) => byId(valueOf(a, 'Id'), valueOf(b, 'Id')))) {
    const waited = now - sinceMs(valueOf(item, 'Since'))
    if (!(waited > times.askMs)) continue
    const owner = valueOf(item, 'Owner')
    flags.push({ kind: 'old ask', id: valueOf(item, 'Id'), chat: laneOf(owner)?.name ?? owner, text: `${valueOf(item, 'Id')} has waited for your answer for ${span(waited)}`, button: null })
  }

  // An instruction open for more than one turn of its chat: the Open instructions list shows it with its age and chat
  // (B298, work/lists.mjs); nothing here.

  // A step in review whose check failed: flagged on its Owner's lane, and the Owner is told once.
  for (const item of ok.filter(one => stateOf(one) === 'review')) {
    const checks = (item.sections.get('History') ?? []).filter(line => /\bserver: check (?:passed|failed)\b/.test(line))
    const failed = checks.at(-1)?.match(/^- (\S+ \S+) server: check failed(?::\s*(.*))?$/)
    if (failed === undefined || failed === null) continue
    const id = valueOf(item, 'Id')
    const lane = laneOf(valueOf(item, 'Owner'))
    const chat = lane?.name ?? valueOf(item, 'Owner')
    const detail = failed[2]?.trim() || 'no reason given'
    flags.push({
      kind: 'check failed', id, chat, text: `${id}: the board's check failed: ${detail}`, button: null,
      ...(chat === null ? {} : { say: `work: the board's check of ${id} failed (${detail}); see work next`, key: `${id} ${chat} check ${failed[1]}` }),
    })
  }

  // A card that names a step the store does not hold in progress for that chat.
  for (const lane of live) {
    const task = lane.task ?? null
    if (task === null || task.source !== 'plan') continue
    const id = task.stepId ?? String(task.text ?? '').match(/\bB\d+\b/)?.[0] ?? null
    if (id === null) continue
    const item = items.get(id)
    const owner = item === undefined ? null : valueOf(item, 'Owner')
    const isMine = owner !== null && plain(owner, prefix) === plain(lane.name, prefix)
    if (item !== undefined && kindOf(item) === 'step' && HOLDS.includes(stateOf(item)) && isMine) continue
    const what = item === undefined ? `the store has no ${id}` : `${id} is ${stateOf(item)}${owner !== null && !isMine ? ` for ${laneOf(owner)?.name ?? owner}` : ''}`
    flags.push({ kind: 'card', id, chat: lane.name, text: `${whose(lane.name)} card says ${id} but ${what}`, button: null })
  }

  // The flow's own moves by the server whose guard holds (the move to taken is the chat's take, delivered above).
  for (const item of ok) {
    const from = stateOf(item)
    const kind = kindOf(item)
    for (const move of flow[kind]?.moves ?? []) {
      const by = Array.isArray(move.by) ? move.by : [move.by]
      if (!by.includes('server') || move.to === 'taken' || move.to === from || (move.from !== from && move.from !== '*')) continue
      if (!mayMove(flow, item, move.to, 'server', { store: { items }, freeChats: new Set(), now, overlaps }).ok) continue
      moves.push({ id: valueOf(item, 'Id'), to: move.to, why: `${from} → ${move.to}${move.when === undefined ? '' : ` (${move.when})`}` })
      break
    }
  }
  return { moves, deliveries, flags }
}
