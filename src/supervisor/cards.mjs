// The supervisor's incident cards (2026-10-24, the person's choice of layout B): the section shows one card per fix step,
// not one row per incident. The person asked: "i want to clearly see what the supervisor is doing with these incidents
// that it found (semi) real-time": is it busy sending this to the Advisor, which step is there, and what is the follow up.
// This is the pure part (no clock, no store of its own): the incidents as `incidentsOf` gives them, the store's items, the
// board's chats and what became of each incident's word to the partner go in; the cards come out, each with the state
// the person reads in its small chip. The page draws them (public/board.js, supervisorOf).

import { incidentsNamedBy } from '../work/incidentFix.mjs'
import { sinceMs, valueOf } from '../work/item.mjs'
import { parkedAfter } from '../work/parked.mjs'

const numeric = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
/** A History line's stamp: "- 2026-10-24 18:38 Worker 5: ...". */
const STAMP = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s/
// "Fix of X4: ...": the incidents a fix step's title names (incidentFix.mjs, where the board's own queue of a fix reads it too).
export { incidentsNamedBy }

/** When a step last moved: its newest History line, else its Since; NaN when nothing says. */
function activityOf(item) {
  const lines = item.sections?.get('History') ?? []
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const found = lines[at].match(STAMP)
    const time = found === null ? Number.NaN : sinceMs(found[1])
    if (Number.isFinite(time)) return time
  }
  return sinceMs(valueOf(item, 'Since'))
}

/** What a chat's state says of a step it holds: the word after "Worker 5 · ", and whether it is busy. */
function laneWord(stepState, lane) {
  if (lane === undefined) return { text: 'has it', tone: 'idle' }
  switch (lane.state) {
    case 'working': return { text: stepState === 'taken' ? 'starting' : 'building', tone: 'busy' }
    case 'waiting': return { text: 'waits for you', tone: 'idle' }
    case 'suspended': return { text: lane.suspended?.by === 'parked' ? 'suspended on purpose' : 'paused for the limit', tone: 'idle' }
    case 'off': return { text: 'chat is off', tone: 'idle' }
    case 'free': return { text: 'idle', tone: 'idle' }
    case 'interrupted': return { text: 'interrupted', tone: 'idle' }
    default: return { text: 'state unknown', tone: 'idle' }
  }
}

/** The open steps a queued step waits for (its Blocked by, those not done or dropped), as "after B529, B530". */
function afterWords(step, steps) {
  const ids = [...new Set((valueOf(step, 'Blocked by') ?? '').match(/\bB\d+\b/g) ?? [])]
  const open = ids.filter(id => {
    const state = steps.has(id) ? valueOf(steps.get(id), 'State') : null
    return state !== null && state !== 'done' && state !== 'dropped'
  })
  if (open.length === 0) return ''
  return ` · after ${open.slice(0, 2).join(', ')}${open.length > 2 ? ` +${open.length - 2}` : ''}`
}

/**
 * The state of a fix step in the words of its chip, from the step's record and its worker's lane: `{ text, tone }`, tone
 * wait (nobody has it yet), busy (its worker builds), idle (its worker has it and is not at work), review, done, dropped.
 * Redesign Part 2 (2026-10-25): the board hands out every task, so a refined one is on its list for a worker and a
 * queued one is given to its worker. `items` the store's items (`steps` when left out).
 */
export function stepState(step, { lanes = [], steps = new Map(), items = steps } = {}) {
  const state = valueOf(step, 'State')
  const id = valueOf(step, 'Id')
  const owner = valueOf(step, 'Owner') ?? lanes.find(one => one.task?.stepId === id)?.name ?? null
  switch (state) {
    case 'new': return { text: 'new · waits for the Advisor', tone: 'wait' }
    case 'refined': return { text: 'refined · on the list', tone: 'wait' }
    case 'queued': return { text: `${owner === null ? 'queued' : `queued for ${owner}`}${afterWords(step, steps)}`, tone: 'wait' }
    case 'taken':
    case 'in progress': {
      const word = laneWord(state, lanes.find(one => one.name === owner && one.isLeftover !== true))
      return { text: owner === null ? (state === 'taken' ? 'taken' : 'in progress') : `${owner} · ${word.text}`, tone: owner === null ? 'idle' : word.tone }
    }
    case 'waiting on you': {
      // B567: a parked step, its answers come, goes on after the step its worker is on.
      const after = parkedAfter(step, items)
      if (after !== null) return { text: `${owner === null ? '' : `${owner} · `}parked until ${after} is reported`, tone: 'idle' }
      return { text: owner === null ? 'waits for you' : `${owner} · waits for you`, tone: 'idle' }
    }
    case 'review': return { text: 'in review', tone: 'review' }
    case 'done': return { text: 'done · fixed', tone: 'done' }
    case 'dropped': return { text: 'dropped', tone: 'dropped' }
    default: return { text: state ?? 'no state', tone: 'idle' }
  }
}

/**
 * What an incident with no fix step yet is doing, `{ text, tone }`, from its state and what became of its word to the
 * partner (`word`: arrived, on its way, lost, or undefined for none yet; supervisor/index.mjs wordsOf):
 * "sending to the Advisor…" while the word waits or was just taken, "with the Advisor" once it arrived (typed, copied,
 * or taken long ago, which is also the store's state "with the advisor"), "came back" for a fixed one seen again (with
 * "· sending…" while its word is on its way), "no Advisor on the board" when nobody could take the word.
 */
export function noFixState(incident, word, hasPartner = true) {
  if (incident.state === 'with the advisor' || word === 'arrived') return { text: 'with the Advisor', tone: 'advisor' }
  const back = incident.state === 'came back'
  if (word === 'on its way') return back ? { text: 'came back · sending…', tone: 'back' } : { text: 'sending to the Advisor…', tone: 'sending' }
  if (back) return { text: 'came back', tone: 'back' }
  return hasPartner ? { text: 'sending to the Advisor…', tone: 'sending' } : { text: 'no Advisor on the board', tone: 'wait' }
}

/** Which incident's state the card's chip shows when they differ: what needs the most attention first. */
const CHIP_FIRST = ['back', 'sending', 'wait', 'advisor']

/**
 * The step an incident is handled by, or null. Its `Fix` while the incident is being fixed or fixed; one that came
 * back, or is open or with the advisor again, has a Fix that did not hold (or was dropped), so that one does not count.
 * Then, only when no Fix counts, a step whose title says "Fix of X<n>" for it: the newest of them that is still a
 * try (not dropped, and not done unless the incident is fixed).
 */
function fixStepOf(incident, named, steps) {
  if ((incident.state === 'fix' || incident.state === 'fixed') && incident.fix) return incident.fix
  const tries = (named.get(incident.id) ?? []).filter(id => {
    const state = valueOf(steps.get(id), 'State')
    return state !== 'dropped' && (state !== 'done' || incident.state === 'fixed')
  })
  return tries.sort((a, b) => numeric(b, a))[0] ?? null
}

/**
 * The cards: one per fix step, newest activity first (the step's last History line or Since, and when its incidents
 * got their state; not how often an incident is seen again, which would move the cards at every check), and last one
 * card "Open, no fix task yet" for the incidents with none (the page adds how many it lists to the title).
 * `incidents` as incidents.mjs `incidentsOf` gives them; `items` the store's items (a Map; null when it could not be read); `lanes` the board's chats; `words` a Map of an incident's id to
 * what became of its word to the partner; `hasPartner` whether the board has an Advisor to send to. Each card:
 * `{ key, step, title, state: { text, tone }, phase, incidents: [{ id, word }], at }`; `phase` the fix step's own State
 * (B573: what the section counts as in work; null without a step in the store), `word` the incident's own state, said
 * for the card without a fix step (the others carry null).
 */
export function incidentCards({ incidents = [], items = null, lanes = [], words = new Map(), hasPartner = true } = {}) {
  const steps = items instanceof Map ? items : new Map()
  const stepsOnly = new Map([...steps].filter(([, item]) => valueOf(item, 'Kind') === 'step'))
  const named = new Map()
  for (const [id, item] of stepsOnly) {
    for (const incident of incidentsNamedBy(valueOf(item, 'Title'))) named.set(incident, [...(named.get(incident) ?? []), id])
  }
  const groups = new Map()
  const loose = []
  // B685: an incident the partner closed (no fault left) has no fix step and needs none.
  const closed = []
  for (const incident of [...incidents].filter(one => typeof one?.id === 'string').sort((a, b) => numeric(a.id, b.id))) {
    const fix = fixStepOf(incident, named, stepsOnly)
    if (fix !== null) groups.set(fix, [...(groups.get(fix) ?? []), incident])
    else if (incident.state === 'closed') closed.push(incident)
    else loose.push(incident)
  }
  const latest = list => Math.max(...list.map(one => (Number.isFinite(one.since) ? one.since : -Infinity)))
  const cards = [...groups].map(([id, list]) => {
    const step = stepsOnly.get(id)
    const state = step !== undefined ? stepState(step, { lanes, steps: stepsOnly, items: steps })
      : { text: items instanceof Map ? 'task not in the store' : 'task not read yet', tone: 'idle' }
    const at = Math.max(step === undefined ? -Infinity : activityOf(step) || -Infinity, latest(list))
    return { key: id, step: id, title: step === undefined ? null : valueOf(step, 'Title'), state, phase: step === undefined ? null : valueOf(step, 'State'), incidents: list.map(one => ({ id: one.id, word: null })), at: Number.isFinite(at) ? at : 0 }
  }).sort((a, b) => b.at - a.at || numeric(a.step, b.step))
  if (loose.length > 0) {
    const each = loose.map(one => ({ id: one.id, ...noFixState(one, words.get(one.id), hasPartner) }))
    const chip = [...each].sort((a, b) => CHIP_FIRST.indexOf(a.tone) - CHIP_FIRST.indexOf(b.tone))[0]
    const at = latest(loose)
    cards.push({
      key: 'nofix', step: null, title: 'Open, no fix task yet', state: { text: chip.text, tone: chip.tone }, phase: null,
      incidents: each.map(one => ({ id: one.id, word: one.text })), at: Number.isFinite(at) ? at : 0,
    })
  }
  if (closed.length > 0) {
    const at = latest(closed)
    cards.push({ key: 'closed', step: null, title: 'Closed, no fix needed', state: { text: 'closed · no fix needed', tone: 'done' }, phase: 'done', incidents: closed.map(one => ({ id: one.id, word: null })), at: Number.isFinite(at) ? at : 0 })
  }
  return cards
}
