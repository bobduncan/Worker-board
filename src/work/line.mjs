// B296: a step's backlog line and its item's fields, both ways. `lineFields` reads what a line says; `stepRest` writes
// the line back from an item, using the backlog's own words (`Queue note`, `Line`) only while they still say what
// the fields say, so a field that changed always wins.

import { minutesOf, parseStep } from '../backlog.mjs'
import { valueOf } from './item.mjs'

const NO_NAMES = { prefix: '', names: [] }
export const ASKS_TO = { verify: 'look', decide: 'decide', provide: 'provide', do: 'do' }
export const ASKS_FROM = { look: 'Verify', decide: 'Decide', provide: 'Provide', do: 'Do' }
/** A step without an id on the backlog gets one of these in the store; it stands on no backlog line. */
export const isLegacyId = id => /^L\d+$/.test(id ?? '')

/**
 * What a step's line (after its tick) says, as fields: `{ id, asks, title, isYou, owner, after, estimate, branch,
 * note }`. `note` is the words inside "(for ...)", `owner` its "for" part as written, `estimate` its first "about" part
 * without "about", as `parseStep` reads them.
 */
export function lineFields(rest) {
  const step = parseStep(false, rest, NO_NAMES)
  const own = step.text.match(/\s*\(branch\s+([\w./-]+)\)\s*$/)
  const body = own === null ? step.text : step.text.slice(0, own.index)
  const spec = body.match(/\s*\((for (?:[^()]|\([^()]*\))*)\)\s*$/)
  let owner = null
  let after = null
  let estimate = null
  if (spec !== null) {
    for (const part of spec[1].split(';').map(piece => piece.trim())) {
      if (/^for\s+/i.test(part)) owner = part.replace(/^for\s+/i, '').trim()
      else if (/^after\s+/i.test(part)) after = part.replace(/^after\s+/i, '').trim()
      else if (estimate === null && minutesOf(part) !== null) estimate = part.replace(/^about\s+/i, '')
    }
  }
  return { id: step.id, asks: step.asks, title: step.title, isYou: step.isYou, owner, after, estimate, branch: step.ownBranch, note: spec?.[1] ?? null }
}

/** What an item's head says its line holds, in `lineFields`' terms. */
export function itemFields(item) {
  const id = valueOf(item, 'Id')
  const asks = valueOf(item, 'Asks')
  return {
    id: isLegacyId(id) ? null : id,
    asks: asks === null ? null : ASKS_FROM[asks]?.toLowerCase() ?? null,
    title: item.head.get('Title') ?? '',
    isYou: valueOf(item, 'Kind') === 'ask',
    owner: valueOf(item, 'Owner'),
    after: valueOf(item, 'Waits for') ?? valueOf(item, 'Blocked by'),
    estimate: valueOf(item, 'Estimate'),
    branch: valueOf(item, 'Branch'),
  }
}

const KEYS = ['id', 'asks', 'title', 'isYou', 'owner', 'after', 'estimate', 'branch']
const agrees = (read, fields, { anyId = false } = {}) => KEYS.every(key => (key === 'id' && anyId) || read[key] === fields[key])

/** A step's line after its tick, from its item: "B12 Verify: Title (for W; after B9; about 1 h) (branch x) @you". */
export function stepRest(item) {
  const fields = itemFields(item)
  const line = valueOf(item, 'Line')
  if (line !== null && agrees(lineFields(line), fields, { anyId: fields.id === null })) return line
  let note = null
  if (fields.owner !== null) {
    const kept = valueOf(item, 'Queue note')
    const read = kept === null ? null : lineFields(`x (${kept})`)
    note = read !== null && read.owner === fields.owner && read.after === fields.after && read.estimate === fields.estimate ? kept
      : [`for ${fields.owner}`, fields.after === null ? null : `after ${fields.after}`, fields.estimate === null ? null : `about ${fields.estimate}`].filter(Boolean).join('; ')
  }
  return [
    fields.id,
    fields.asks === null ? null : `${ASKS_FROM[valueOf(item, 'Asks')]}:`,
    fields.title,
    note === null ? null : `(${note})`,
    fields.branch === null ? null : `(branch ${fields.branch})`,
    fields.isYou ? '@you' : null,
  ].filter(part => part !== null && part !== '').join(' ')
}

/** Whether two lines after the tick read as the same step. */
export function sameStep(a, b) {
  return JSON.stringify(parseStep(false, a, NO_NAMES)) === JSON.stringify(parseStep(false, b, NO_NAMES))
}
