// B507: the places on the board an ask's words name: a goal (G33), a step (B12), an ask (Q7), a tab ("the Focus tab"),
// a part of the Focus tab named after it ("the Focus tab, then Goals"). Each place has an address that opens exactly
// there (`#advice/goals/G33`, `#advice/focus`, `#details=B12`). The page keeps its own copy of the word rules in
// public/board.js ("askplaces:start"); test/places.test.mjs holds both to the same samples.

/** The tabs by the words the board shows on them; the address of each is the tab's own. */
export const TAB_WORDS = { Vision: '#vision', Focus: '#advice', Backlog: '#backlog', Design: '#design', Spending: '#spending' }
/** The parts of the Focus tab by the words the board shows on them. */
export const PART_WORDS = { Focus: 'focus', Goals: 'goals', Brainstorm: 'brainstorm' }

/** "the Focus tab", "Backlog tab", "Focus tab, then Goals": the tab, and the part after it when one is named. */
const TAB_PHRASE = new RegExp(`(?<![\\w-])(${Object.keys(TAB_WORDS).join('|')}) tab(?:,? then (${Object.keys(PART_WORDS).join('|')})(?![\\w-]))?`, 'g')
/** A goal, step or ask id standing on its own: not part of a word, a path, a file name or an address. */
const PLACE_ID = /(?<![\w/.:#=-])([GQB]\d+)(?![\w/-]|\.\w)/g

/** The address (after the board's own) of a tab, or of a part of the Focus tab. */
export function tabAddress(tab, part = null) {
  if (part !== null && tab === 'Focus') return `#advice/${PART_WORDS[part]}`
  if (tab === 'Focus') return '#advice/focus'
  return TAB_WORDS[tab]
}

/**
 * The places `text` names, in the order of the words, each once: `{ words, label, hash }`. `known` says which ids the
 * board holds: `{ isGoal, isStep, isAsk }`; an id it does not know is no place.
 */
export function placesIn(text, known) {
  const found = []
  const all = String(text ?? '')
  for (const one of all.matchAll(TAB_PHRASE)) {
    const address = tabAddress(one[1], one[2] ?? null)
    found.push({ at: one.index, words: one[0], label: `Open the ${one[0]}`, hash: address })
  }
  for (const one of all.matchAll(PLACE_ID)) {
    const id = one[1]
    if (id[0] === 'G' && known.isGoal(id)) found.push({ at: one.index, words: id, label: `Open ${id} on Goals`, hash: `#advice/goals/${id}` })
    else if (id[0] === 'B' && known.isStep(id)) found.push({ at: one.index, words: id, label: `Open ${id}`, hash: `#details=${id}` })
    else if (id[0] === 'Q' && known.isAsk(id)) found.push({ at: one.index, words: id, label: `Open ${id}`, hash: `#details=${id}` })
  }
  const seen = new Set()
  return found.sort((a, b) => a.at - b.at).filter(one => !seen.has(one.hash) && seen.add(one.hash)).map(({ at, ...place }) => place)
}
