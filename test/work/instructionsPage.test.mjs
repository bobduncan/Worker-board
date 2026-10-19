// B298: the part "Open instructions" under Needs your attention: per chat, missed ones first and red, closed ones grey
// with what came of them. The page's own code, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const page = {}
vm.runInNewContext(`${script.slice(script.indexOf('// instructions:start'), script.indexOf('// instructions:end'))}\nthis.instructionGroups = instructionGroups`, page)
const groups = list => JSON.parse(JSON.stringify(page.instructionGroups(list)))

const one = (id, chat, more = {}) => ({ id, chat, text: `Words ${id}`, since: 5, via: 'chat', turns: 0, isMissed: false, closedAs: null, ...more })

test('per chat, the missed ones first and named as missed, the closed ones last with what came of them', () => {
  const shown = groups([
    one('I1', 'Main', { closedAs: 'made step B300' }), one('I2', 'Main'), one('I3', 'Main', { turns: 2, isMissed: true }), one('I4', 'Board', { via: 'board' }),
  ])
  assert.deepEqual(shown.map(group => [group.chat, group.missed, group.open]), [['Main', 1, 2], ['Board', 0, 1]])
  assert.deepEqual(shown[0].rows.map(row => [row.id, row.tone, row.note]), [['I3', 'missed', 'missed 2 turns'], ['I2', 'open', 'new'], ['I1', 'closed', '→ made step B300']])
  assert.equal(shown[1].rows[0].via, 'board')
  assert.deepEqual(groups([]), [])
  assert.deepEqual(groups(undefined), [])
})

test('the part sits in the log under Needs your attention, missed red and closed grey', () => {
  // Focus 4: the partner's questions first; B258: then the answers to the person's asks on the goal map; B287: the
  // refine lines before the cards. Partner answers: "With your partner" and "Decided for you" after the partner's.
  // Calm panel (2026-10-19): the instructions left the list for the log; a missed one is a line after the partner's.
  assert.match(script, /fill\(box, \[none, drawPartnerNeeds\(partnerCards, [^\n]*?\.length\), drawMissed\(missed\), drawWithPartner\(state\), drawDecidedForYou\(state\), drawGoalAskNeeds\(state\), drawBrainstormNeeds\(state\), \.\.\.oldCards, drawRefineNeeds\(state\), \.\.\.cards, \.\.\.recaps\]\)/)
  // B307: Information in its own box under the asks, as high as the person drags it; since the calm panel the log's
  // box, with Open instructions above Information.
  assert.match(script, /refocus\(box, focused\)\n  \/\/ B307[^\n]*\n  drawInformation\(state\)/)
  assert.match(script, /fill\(box, \[drawInstructions\(state\), information, empty\]\)/)
  assert.match(style, /\.instruction\.is-missed \.instruction-id, \.instruction\.is-missed \.instruction-note \{ color: var\(--warn\); \}/)
  assert.match(style, /\.instruction\.is-closed \{ opacity: \.6; \}/)
})
