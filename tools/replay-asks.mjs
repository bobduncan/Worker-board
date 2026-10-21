// B474: replays the store's asks of a period through the board's checks for a question asked twice, as they were before
// B474 and as they are now: which asks each would have left out, and why. Reads the store, writes nothing.
// Usage: node tools/replay-asks.mjs <work folder> [since, e.g. 2026-10-18]

import { askIdsIn, askKey, sameAsk } from '../src/work/askWords.mjs'
import { JUST_ANSWERED_MS, askTextOf, forYouRepeat, openRepeat } from '../src/work/askRepeat.mjs'
import { askFiledMs, sinceMs, valueOf } from '../src/work/item.mjs'
import { readStore } from '../src/work/store.mjs'

const [dir, since = '2026-10-18'] = process.argv.slice(2)
const TURN_MS = 10 * 60_000
const store = await readStore(dir)
const asks = [...store.items.values()].filter(item => valueOf(item, 'Kind') === 'ask')
const historyOf = item => item.sections.get('History') ?? []
const closedAt = item => {
  const line = historyOf(item).find(one => /: (answered|withdrawn|answered by the partner|answered in the chat)\b/.test(one))
  const found = /^- (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(line ?? '')
  return found === null ? Infinity : sinceMs(found[1])
}
const facts = asks.map(item => ({ item, id: valueOf(item, 'Id'), owner: valueOf(item, 'Owner'), of: valueOf(item, 'Of'), via: valueOf(item, 'Via'),
  at: askFiledMs(item), closed: valueOf(item, 'State') === 'open' ? Infinity : Number.isFinite(closedAt(item)) ? closedAt(item) : askFiledMs(item), withdrawn: historyOf(item).some(one => /: withdrawn\b/.test(one)), words: askTextOf(item), kind: valueOf(item, 'Asks') }))
const from = sinceMs(`${since} 00:00`)
const rows = []
for (const one of facts.filter(f => f.at >= from).sort((a, b) => a.at - b.at)) {
  // Asks of one minute without their millisecond (before Warnings, 2026-10-19) come in the order of their ids.
  const num = f => Number(f.id.slice(1)) || 0
  const before = facts.filter(f => f.at < one.at || (f.at === one.at && num(f) < num(one)))
  const open = before.filter(f => f.closed >= one.at)
  const own = open.filter(f => f.owner === one.owner)
  // An ask filed from a "For you" block came at the end of an earlier turn.
  const turn = before.filter(f => f.owner === one.owner && f.via !== 'chat' && f.at >= one.at - TURN_MS && !(f.withdrawn && f.closed <= one.at))
  const text = one.item.sections.get('Text') ?? []
  let old = null
  let now = null
  if (one.via === 'chat') {
    const key = askKey(text[0] ?? '')
    const known = [...own, ...turn].map(f => askKey((f.item.sections.get('Text') ?? [])[0] ?? valueOf(f.item, 'Title') ?? ''))
    if (known.some(k => sameAsk(k, key))) old = 'same words'
    else if (text.some(w => askIdsIn(w).some(id => own.some(f => f.id === id)))) old = 'names its own open ask (B362)'
    now = old ?? forYouRepeat({ text, kind: one.kind }, { turn, own, others: open.filter(f => f.owner !== one.owner) })
  } else if (one.via === null) {
    const answered = before.filter(f => f.owner === one.owner && f.via === null && !f.withdrawn && f.closed < one.at && one.at - f.closed <= JUST_ANSWERED_MS)
    const same = openRepeat(one.words, one.of, [...own.filter(f => f.via === null), ...answered])
    now = same === undefined ? null : `asks what ${same.id} asks (open)`
  }
  rows.push({ ...one, old, now })
}
const left = rows.filter(r => r.now !== null)
for (const r of left) console.log(`${r.id} ${new Date(r.at).toISOString().slice(5, 16)} ${r.owner} via=${r.via ?? '-'} of=${r.of ?? '-'} | before: ${r.old ?? 'filed'} | now: ${r.now} | ${r.words.slice(0, 90)}`)
console.log(`asks ${rows.length}; left out before B474 ${rows.filter(r => r.old !== null).length}; left out now ${left.length}`)
