// The supervisor's health summary (spec 2026-10-24, "The AI sweep"): what the supervisor chat reads with `work health`
// before it judges whether anything looks wrong for how the board should work. One plain text of at most HEALTH_CHARS
// characters, from the supervisor's one read-only view (view.mjs): each chat's state and for how long, its model and
// effort beside its step's, its last report and its last clear and why; each open step's state, age and owner; the
// queues; the repairs and incidents of the last day; the words not delivered; the limits and the pause. When it must cut,
// the newest and oddest lines stay, and so do the steps every chat holds. PURE.

import { effortOf, modelOf } from '../work/effort.mjs'
import { sinceMs, valueOf } from '../work/item.mjs'
import { isHolding } from '../work/pause.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** The longest summary `work health` answers. */
export const HEALTH_CHARS = 8000
/** The longest line of it; a chat's line may be longer. */
const LINE_CHARS = 240
const CHAT_CHARS = 400
/** A step that stands this long in a state of work counts as odd. */
const LONG_MS = { taken: 30 * MIN, 'in progress': 3 * HOUR, 'waiting on you': 6 * HOUR, review: HOUR, queued: 2 * HOUR }
/** The states of a step that are under way: queued for a chat, held by it, or waiting for its check. */
const UNDER_WAY = ['queued', 'taken', 'in progress', 'waiting on you', 'review']
const HELD = ['taken', 'in progress', 'waiting on you', 'review']
const ODD_STATES = ['unknown', 'off', 'interrupted', 'suspended']
const REPORTED = / → review\b|: reported again\b/

const pad = n => String(n).padStart(2, '0')
const clockOf = ms => (Number.isFinite(ms) ? `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}` : 'not known')
/** A span in words: "45 min", "2 h 10 min", "3 d". */
function lasting(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'not known'
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min`
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)} h${Math.floor((ms % HOUR) / MIN) > 0 ? ` ${Math.floor((ms % HOUR) / MIN)} min` : ''}`
  return `${Math.floor(ms / DAY)} d`
}
/** One line of words, no line ends, at most `max` characters. */
const oneLine = (value, max = LINE_CHARS) => {
  const words = String(value ?? '').replace(/\s+/g, ' ').trim()
  return words.length <= max ? words : `${words.slice(0, max - 1)}…`
}
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const byId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
/** A model as the app names it ("claude-sonnet-5-5"), in its family's word. */
const familyOf = model => (typeof model !== 'string' || model === '' ? null : /opus/i.test(model) ? 'opus' : /sonnet/i.test(model) ? 'sonnet' : /haiku/i.test(model) ? 'haiku' : model)

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stepsOf = view => [...view.items.values()].filter(item => kindOf(item) === 'step' && typeof valueOf(item, 'Id') === 'string')
/** When a History line was written: "- 2026-10-24 09:00 who: what". */
const historyAt = line => sinceMs(String(line).replace(/^-\s+/, '').slice(0, 16))

/** A line of the summary: its words, how much it must stay (0 always, 1 before the rest, 2 the rest), odd or not, and when. */
const lineOf = (text, { tier = 2, odd = false, at = -Infinity, max = LINE_CHARS } = {}) => ({ text: `- ${oneLine(text, max)}`, tier, odd, at: Number.isFinite(at) ? at : -Infinity })

/** Each chat: the main chat and the workers, then the partner and its helper. */
function chatLines(view, now) {
  const chats = [
    ...view.lanes.filter(lane => !lane.isLeftover).map(lane => ({ lane, role: lane.isMain ? 'main' : 'worker' })),
    ...(view.partner === null ? [] : [{ lane: view.partner, role: 'partner' }]),
    ...(view.helper === null ? [] : [{ lane: view.helper, role: "partner's helper" }]),
  ]
  const steps = stepsOf(view)
  return chats.map(({ lane, role }) => {
    const mine = steps.filter(item => plain(valueOf(item, 'Owner'), view.prefix) === plain(lane.name, view.prefix))
    const since = view.since.get(lane.name)
    const state = `${lane.state ?? 'not known'}${Number.isFinite(since) ? ` since ${clockOf(since)} (${lasting(now - since)})` : ''}`
    const running = lane.isRunning === false ? ', its chat does not run' : ''
    const runs = `runs ${familyOf(lane.model) ?? 'a model not known'} · ${lane.effort ?? 'effort not known'}`
    // The step it is on: its card's, else the one the store holds for it.
    const onId = lane.task?.stepId ?? mine.find(item => HELD.slice(0, 3).includes(valueOf(item, 'State')))?.head.get('Id') ?? null
    const on = onId === null ? null : view.items.get(onId) ?? null
    const wants = on === null ? '' : `; its step ${onId} wants ${modelOf(on).family} · ${effortOf(on).level}`
    const onWords = onId === null ? '; on no step' : `; on ${onId}${on === null ? '' : ` "${oneLine(valueOf(on, 'Title'), 60)}" (${valueOf(on, 'State')})`}`
    const reports = mine.flatMap(item => (item.sections?.get('History') ?? []).filter(line => REPORTED.test(line)).map(line => ({ id: valueOf(item, 'Id'), at: historyAt(line) })))
      .filter(one => Number.isFinite(one.at)).sort((a, b) => b.at - a.at)
    const report = reports.length === 0 ? '; no report known' : `; last report ${reports[0].id} at ${clockOf(reports[0].at)}`
    const suspended = lane.state === 'suspended' && lane.suspended !== null && typeof lane.suspended === 'object'
      ? ` (for ${lane.suspended.limit ?? 'a limit'}${Number.isFinite(lane.suspended.until) ? ` until ${clockOf(lane.suspended.until)}` : ''}${lane.suspended.isBack === true ? ', the limit is back' : ''})` : ''
    const odd = ODD_STATES.includes(lane.state) || (lane.isRunning === false && onId !== null) || (lane.state === 'working' && onId === null && role === 'worker')
    return lineOf(`${lane.name} (${role}): ${state}${suspended}${running}; ${runs}${wants}${onWords}${report}; ${clearWords(lane.compaction)}`, { tier: 0, odd, at: since, max: CHAT_CHARS })
  })
}

/** The Workers mod's last word on a clear or a compaction of the chat, with why it did not clear. */
function clearWords(compaction) {
  if (compaction === null || compaction === undefined) return 'no clear known'
  if (compaction.kind === 'cleared') return `cleared at ${clockOf(compaction.at)}${compaction.step ? ` after ${compaction.step}` : ''}`
  const not = compaction.notCleared ? `not cleared at ${clockOf(compaction.notCleared.at)}: ${compaction.notCleared.why}; ` : ''
  if (compaction.kind === 'compacted') return `${not}compacted at ${clockOf(compaction.at)}`
  return `${not}compaction skipped at ${clockOf(compaction.at)}: ${compaction.why ?? 'no reason given'}`
}

/** Each step under way: its state, for how long, its owner; the backlog's new and refined steps counted in one line. */
function stepLines(view, now) {
  const chats = new Set(view.lanes.filter(lane => !lane.isLeftover).map(lane => plain(lane.name, view.prefix)))
  const lines = []
  const backlog = { new: 0, refined: 0 }
  for (const item of stepsOf(view)) {
    const state = valueOf(item, 'State')
    if (state === 'new' || state === 'refined') {
      backlog[state] += 1
      continue
    }
    if (!UNDER_WAY.includes(state)) continue
    const id = valueOf(item, 'Id')
    const owner = valueOf(item, 'Owner')
    const since = sinceMs(valueOf(item, 'Since'))
    const age = now - since
    const blocked = [valueOf(item, 'Blocked by'), valueOf(item, 'Waits for')].filter(one => one !== null && one !== '-' && one !== '')
    const fix = valueOf(item, 'Priority') === 'fix' ? ', board fix' : ''
    const isChats = owner !== null && chats.has(plain(owner, view.prefix))
    // The steps every chat holds stay whatever is cut; a chat's queue before the rest.
    const tier = isChats && HELD.includes(state) ? 0 : isChats ? 1 : 2
    const odd = (Number.isFinite(age) && age > (LONG_MS[state] ?? Infinity)) || (owner !== null && !isChats)
    lines.push(lineOf(`${id} ${state} for ${lasting(age)}, ${owner === null ? 'no owner' : owner}${fix}${blocked.length > 0 ? ` (waits for ${blocked.join('; ')})` : ''}: ${oneLine(valueOf(item, 'Title'), 80)}`, { tier, odd, at: since }))
  }
  if (backlog.new + backlog.refined > 0) lines.push(lineOf(`backlog, not queued: ${backlog.new} new, ${backlog.refined} refined`, { tier: 1 }))
  return lines
}

/** Each chat's queue as the board shows it, in its order, with why the first step waits. */
function queueLines(view) {
  return view.lanes.filter(lane => !lane.isLeftover && Array.isArray(lane.queue) && lane.queue.length > 0).map(lane => {
    const ids = lane.queue.map(step => step?.id ?? `"${oneLine(step?.title, 30)}"`)
    const why = lane.queue[0]?.why?.reason ?? null
    return lineOf(`${lane.name}: ${ids.join(', ')}${why === null ? '' : ` (the first waits: ${why})`}`, { tier: 1, odd: lane.queue.length >= 3 && IDLE_STATES.includes(lane.state) })
  })
}
const IDLE_STATES = ['free', 'unknown', 'off']

/** The repairs the board made in the last day, and its incidents (not fixed, or fixed in the last day), with their keys. */
function dayLines(view, now) {
  const repairs = view.repairs.filter(one => now - one.at < DAY).map(one => lineOf(`${clockOf(one.at)} repair ${one.rule} on ${one.subject ?? 'the board'} (${one.key})`, { at: one.at }))
  const incidents = [...view.items.values()].filter(item => kindOf(item) === 'incident').flatMap(item => {
    const state = valueOf(item, 'State')
    const last = sinceMs(valueOf(item, 'Last seen'))
    if (state === 'fixed' && !(now - last < DAY)) return []
    const fix = valueOf(item, 'Fix')
    const evidence = valueOf(item, 'Evidence')
    return [lineOf(`${valueOf(item, 'Id')} ${state === 'fix' && fix ? `fix ${fix}` : state}, from ${valueOf(item, 'Source') ?? 'not known'}, seen ${valueOf(item, 'Count') ?? '1'} times, first ${clockOf(sinceMs(valueOf(item, 'First seen')))}, last ${clockOf(last)}: ${valueOf(item, 'Title') ?? ''} [key: ${valueOf(item, 'Key') ?? ''}]${evidence === null ? '' : ` (evidence: ${oneLine(evidence, 80)})`}`,
      { tier: 1, odd: state === 'open' || state === 'came back', at: last })]
  })
  return [...incidents, ...repairs]
}

/** The words to a chat that wait, or expired or failed in the last day. */
function wordLines(view, now) {
  // The review: not the supervisor's own sweep words (a sweep word that waits would make every summary look new).
  return view.outbox.filter(message => typeof message?.to === 'string' && Number.isFinite(message.at) && message.command !== 'sweep')
    .filter(message => message.state === 'waiting' || message.state === 'held' || ((message.state === 'expired' || message.state === 'failed') && now - message.at < DAY))
    .map(message => lineOf(`${clockOf(message.at)} ${message.command ?? 'answer'}${message.about ? ` ${message.about}` : ''} to ${message.to}: ${message.state} for ${lasting(now - message.at)}`,
      { tier: 1, odd: message.state !== 'held' && now - message.at > (view.settings.undeliveredMinutes ?? 10) * MIN, at: message.at }))
}

/** The limits of the plan and the person's pause. */
function limitLines(view) {
  const limit = (name, value) => (value === null || value === undefined ? `${name}: not known`
    : `${name}: ${Math.round(value.used)}% used (${value.level}), read at ${clockOf(value.at)}${Number.isFinite(value.resetsAt) ? `, resets at ${clockOf(value.resetsAt)}` : ''}`)
  const pause = view.pause === null || view.pause === undefined ? 'pause: none known'
    : `pause: ${view.pause.state ?? 'not known'}${Number.isFinite(view.pause.since) ? ` since ${clockOf(view.pause.since)}` : ''}`
  return [
    lineOf(`${limit('5-hour limit', view.limits?.fiveHour)}; ${limit('weekly limit', view.limits?.week)}`, { tier: 0, odd: ['fiveHour', 'week'].some(key => view.limits?.[key]?.level === 'full') }),
    lineOf(pause, { tier: 0, odd: isHolding(view.pause) }),
  ]
}

/**
 * The summary the supervisor chat reads (`work health`), from the view (view.mjs `buildView`) at `now`: a head, then the
 * sections Chats, Steps under way, Queues, Incidents and repairs of the last day, Words not delivered, Limits and pause.
 * At most HEALTH_CHARS characters: when the whole does not fit, the lines that must stay come first (every chat, the
 * steps the chats hold, the limits), then the oddest and newest of the rest; a section says how many lines it left out.
 */
export function healthSummary(view, now = view.now) {
  const sections = [
    { title: 'Chats (state and since; model and effort beside the step\'s; last report; last clear and why)', lines: chatLines(view, now) },
    { title: 'Steps under way (state, for how long, owner)', lines: stepLines(view, now) },
    { title: 'Queues', lines: queueLines(view) },
    { title: 'Incidents and repairs of the last day', lines: dayLines(view, now) },
    { title: 'Words not delivered', lines: wordLines(view, now) },
    { title: 'Limits and pause', lines: limitLines(view) },
  ]
  const head = `The board's health at ${clockOf(now)}, for the supervisor's sweep. Odd lines are marked with "!".`
  const rank = (a, b) => a.tier - b.tier || Number(b.odd) - Number(a.odd) || b.at - a.at
  const all = sections.flatMap((section, at) => section.lines.map(line => ({ ...line, section: at, text: line.odd ? `${line.text.slice(0, 2)}! ${line.text.slice(2)}` : line.text })))
  // Room for the head, the sections' titles and a "left out" line for each.
  let room = HEALTH_CHARS - head.length - sections.reduce((sum, section) => sum + section.title.length + 60, 0)
  const kept = new Set()
  for (const line of [...all].sort(rank)) {
    if (line.text.length + 1 > room) continue
    kept.add(line)
    room -= line.text.length + 1
  }
  const parts = [head]
  sections.forEach((section, at) => {
    const mine = all.filter(line => line.section === at)
    const shown = mine.filter(line => kept.has(line)).sort((a, b) => Number(b.odd) - Number(a.odd) || b.at - a.at)
    const left = mine.length - shown.length
    parts.push('', `${section.title}:`, ...(mine.length === 0 ? ['- none'] : shown.map(line => line.text)), ...(left > 0 ? [`- (${left} more left out: the oldest and least odd)`] : []))
  })
  const text = parts.join('\n')
  return text.length <= HEALTH_CHARS ? text : `${text.slice(0, HEALTH_CHARS - 1)}…`
}
