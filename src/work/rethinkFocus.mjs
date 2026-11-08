// Stop and rethink, what the Focus page shows while a rethink runs (docs/stop-and-rethink.md): `focus.rethink`. PURE and DERIVED:
// worked out again on every state build from the goal's `Evaluation asked` line and the `Waits for` holds of its steps, never stored,
// so it is gone the moment the evaluation ends or the holds clear.

import { valueOf } from './item.mjs'
import { plainTitle } from './rethink.mjs'
import { yourWordsOf } from './yourWords.mjs'

const HOLD_OF = goal => new RegExp(String.raw`the rethink of ${goal} "([^"]*)" \((\d{4}-\d\d-\d\d \d\d:\d\d)\)`, 'g')
const STOPPED = /stopped for the rethink of/
const TAKEN = /→ taken\b|^taken → in progress\b|^claimed\b/
const LINE = /^-\s+\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)? ([^:]{1,80}):\s*(.*)$/
const WORDS_CHARS = 400

const plain = (name, prefix) => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim()
}

/** The worker that held a stopped step: the newest take line (`→ taken`, `taken → in progress`, `claimed`) before the stop line; null when none. */
function formerWorker(item, prefix) {
  const history = item?.sections?.get('History') ?? []
  const stopAt = history.findLastIndex(one => STOPPED.test(one))
  for (let at = stopAt - 1; at >= 0; at -= 1) {
    const found = LINE.exec(history[at])
    if (found === null || !TAKEN.test(found[2])) continue
    const server = /→ taken \(for ([^)]+)\)/.exec(found[2])
    return plain(server !== null ? server[1] : found[1], prefix) || null
  }
  return null
}

/**
 * `focus.rethink` for the goal `node`: null unless it has `Evaluation asked` and a step holds its rethink. `items` are all store items
 * (an array), `lanes` the worker lanes, `partnerLane` the partner's lane, `titleOf` a step's title.
 */
export function rethinkFocusOf({ node, items, prefix = '', lanes = null, partnerLane = null, titleOf = item => valueOf(item, 'Title') ?? '' }) {
  if ((node?.evaluationAsked ?? null) === null) return null
  const holds = []
  for (const item of items ?? []) {
    if (valueOf(item, 'Kind') !== 'step') continue
    const found = [...String(valueOf(item, 'Waits for') ?? '').matchAll(HOLD_OF(node.id))]
    if (found.length > 0) holds.push({ item, part: found[0][1], minute: found.map(one => one[2]).sort()[0] })
  }
  if (holds.length === 0) return null
  const first = [...holds].sort((a, b) => a.minute.localeCompare(b.minute))[0]
  const mine = holds.filter(one => one.part === first.part)
  const at = first.minute
  const free = worker => (lanes ?? []).some(lane => lane?.isLeftover !== true && plain(lane.name, prefix).toLowerCase() === worker.toLowerCase() && lane.state === 'free' && (lane.task ?? null) === null)
  const freed = mine.filter(one => (one.item.sections?.get('History') ?? []).some(line => STOPPED.test(line)))
    .map(one => {
      const worker = formerWorker(one.item, prefix)
      return { id: valueOf(one.item, 'Id'), worker, isFree: worker !== null && free(worker) }
    })
  const point = mine.flatMap(one => yourWordsOf(one.item)).find(one => one.how === `note (rethink, ${at})`)
  const words = point === undefined ? null : point.answer.replace(/\s+/g, ' ').trim().slice(0, WORDS_CHARS) || null
  const ask = (items ?? []).find(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'State') === 'open' && String(valueOf(one, 'Title') ?? '').startsWith(`Rebuild ${node.id}`))
  const steps = partnerLane?.task?.steps
  const step = partnerLane?.task?.step
  const partner = partnerLane === null ? null : {
    name: plain(partnerLane.name, prefix),
    state: partnerLane.state ?? null,
    doingNow: partnerLane.doingNow ?? null,
    progress: Number.isInteger(step) && Number.isInteger(steps) && steps > 0 ? `${step} of ${steps}` : null,
    minutesLeft: Number.isFinite(partnerLane.eta?.leftMs) ? Math.ceil(partnerLane.eta.leftMs / 60_000) : null,
  }
  const title = (node.parts ?? []).find(part => plainTitle(part.title) === first.part)?.title ?? first.part
  return {
    part: first.part,
    partTitle: title,
    at,
    held: mine.map(one => ({ id: valueOf(one.item, 'Id'), title: titleOf(one.item), state: valueOf(one.item, 'State') })),
    freed,
    words,
    partner,
    ask: ask === undefined ? null : { id: valueOf(ask, 'Id'), title: titleOf(ask) },
  }
}
