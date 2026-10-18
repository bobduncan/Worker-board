// B309: a step's asks count as its refine questions. Seen live on 2026-10-18: the board sent the Advisor a fold round
// for B306 while its asks Q27 and Q28 (filed by its worker, not by the refine) were still open, because only the
// questions inside the refine block counted. Every ask under a step (`Of: <step>`) counts as one of its refine
// questions: open, the step waits for the person; answered since the block was last written, its answer waits for the
// Advisor's next round, as an answered question in the block does. PURE.

import { valueOf } from './item.mjs'

/** A History line of the Advisor's write of the block: a round (`refine`) or the ready form (`refined`). */
const WRITTEN = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d)\s+[^:]+:\s+refined(?:, round \d+| is ready)\s*$/
const STAMP = /\d{4}-\d\d-\d\d[ T]\d\d:\d\d/
const msOf = text => {
  const at = typeof text === 'string' ? Date.parse(text.replace(' ', 'T')) : NaN
  return Number.isFinite(at) ? at : null
}
const numberOf = id => Number(String(id).replace(/\D/g, '')) || 0

/** The ask items under a step (`Of: <id>`), by id. */
export function asksOfStep(items, stepId) {
  return [...(items?.values() ?? [])]
    .filter(one => valueOf(one, 'Kind') === 'ask' && valueOf(one, 'Of') === stepId)
    .sort((a, b) => numberOf(valueOf(a, 'Id')) - numberOf(valueOf(b, 'Id')))
}

/**
 * The asks that count as the step's refine questions now, `[{ id, title, answer }]` (`answer` null while open): every
 * open ask under it, and every one answered since its refine block was last written (but the refine's own questions,
 * `Via: refine`, whose answers the block holds and counts itself). Which came last is read from the
 * step's History ("<id> answered" after "refined, round n" or "refined is ready"), else from the times (the ask's
 * Since, the block's head), an answer in the same minute counting as after. None while the step has no refine block:
 * its first round is no fold round.
 */
export function refineAsksOf(items, step) {
  const block = step?.sections?.get('Refined') ?? []
  if (block.length === 0) return []
  const history = (step.sections.get('History') ?? []).map(one => one.trim())
  const last = history.findLastIndex(one => WRITTEN.test(one))
  const writtenAt = last >= 0 ? msOf(history[last].match(WRITTEN)[1]) : msOf(block[0].match(STAMP)?.[0])
  return asksOfStep(items, valueOf(step, 'Id')).flatMap(ask => {
    const id = valueOf(ask, 'Id')
    const state = valueOf(ask, 'State')
    const shown = { id, title: valueOf(ask, 'Title') ?? '' }
    if (state === 'open') return [{ ...shown, answer: null }]
    // The refine's own question (`Via: refine`) stands in the block with its answer: answered, it counts there only.
    if (state !== 'answered' || valueOf(ask, 'Via') === 'refine') return []
    const said = history.findLastIndex(one => one.endsWith(`: ${id} answered`))
    let isAfter
    if (said >= 0 && last >= 0) isAfter = said > last
    else {
      const at = said >= 0 ? msOf(history[said].match(STAMP)?.[0]) : msOf(valueOf(ask, 'Since'))
      isAfter = writtenAt === null || at === null || at >= writtenAt
    }
    const words = (ask.sections.get('Answer') ?? []).join(' ').trim()
    return isAfter ? [{ ...shown, answer: words === '' ? 'answered' : words }] : []
  })
}

/** The open asks under a step: `refined` is refused while one is, and a queue asked before the refine waits for them. */
export const openAsksOf = (items, stepId) => asksOfStep(items, stepId).filter(ask => valueOf(ask, 'State') === 'open')
