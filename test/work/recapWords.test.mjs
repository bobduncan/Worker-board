// B569 (I92): a report's Context and Change, the plain words a card is made of, and an old recap read in the new form.

import assert from 'node:assert/strict'
import test from 'node:test'

import { recapsOf } from '../../src/work/recap.mjs'
import { goalParts, headingOf, isBeforeAfter, partsFaults, plainSentences, recapParts, reportParts, technicalWords } from '../../src/work/recapWords.mjs'

const stepOf = ({ summary = [], context = [], checked = [], history = [] }) => ({
  head: new Map([['Id', 'B7'], ['Kind', 'step'], ['State', 'done']]),
  sections: new Map([['Summary', summary], ['Context', context], ['Checked', checked], ['History', history]]),
})

test('a report reads as its Context, its Change and the rest; the Change ends at Details or a Tests bite line', () => {
  assert.deepEqual(reportParts('Context: The lamps were dark. Change: They glow now. Details: lamps.mjs, Tests bite: x -> y'), { context: 'The lamps were dark.', change: 'They glow now.', rest: 'Details: lamps.mjs, Tests bite: x -> y' })
  assert.deepEqual(reportParts('Context: Dark. Change: Glow. Tests bite: x -> y'), { context: 'Dark.', change: 'Glow.', rest: 'Tests bite: x -> y' })
  assert.deepEqual(reportParts('Lamps glow; merged abc1234.'), { context: '', change: '', rest: 'Lamps glow; merged abc1234.' })
  assert.deepEqual(partsFaults('Context: Dark. Change: Glow. Details: lamps.mjs'), [])
})

test('the words a person should not need: file names and paths, code words, commit hashes; ids and plain words pass', () => {
  assert.deepEqual(technicalWords('see board.js and art-inbox/B5/a and recapsOf, make_card, draw() and `x`, merged 3f9a1c2'), {
    files: ['board.js', 'art-inbox/B5/a'], code: ['recapsOf', 'make_card', 'draw()', '`x`'], hashes: ['3f9a1c2'],
  })
  assert.deepEqual(technicalWords('B550 and Q341 show a before/after picture after 20 min, at 1600 px; deadline 2026-10-24'), { files: [], code: [], hashes: [] })
})

test('plain sentences: asides and the instruction lead left out, technical or check sentences dropped, cut at a sentence', () => {
  assert.equal(plainSentences('I92 (the person, 2026-10-24 21:13): the cards are not readable. They use board.js. Tests added.', 300), 'The cards are not readable.')
  assert.equal(plainSentences('One. Two. Three.', 9), 'One. Two.')
  assert.equal(plainSentences('A very long first sentence here.', 12), 'A very long…')
  assert.equal(plainSentences('', 300), '')
})

test('a step\'s recap: the Context and Change of its last report, or from before B569 plain words from its record; its Checked count', () => {
  const report = text => `  Reported by Worker 2 on 2026-10-24 at 20:00: ${text} (merged 3f9a1c2)`
  const now = stepOf({ context: [report('Context: Steps sat queued. Change: A free worker gets them. Details: rule.mjs')], checked: ['Evidence: none', '- pass: a', '- pass: b'], history: ['- 2026-10-24 21:00 Partner: result check passed: 2 of 2 points pass'] })
  assert.deepEqual(recapParts(now), { context: 'Steps sat queued.', change: 'A free worker gets them.', checked: '2 of 2' })
  const old = stepOf({
    summary: ['X15 (the board, 2026-10-24): a queued step sat behind a busy worker while another was free. It used rule.mjs.'],
    context: [report('A supervisor rule spots the step and tells the main chat. Tests added for X15. Merged 3f9a1c2.')],
    checked: ['- pass: a', '- fail: b'], history: ['- 2026-10-24 21:00 Partner: result check failed: 1 of 2 points pass; fix B9 for b'],
  })
  // A step closed through its fix: every point passes.
  assert.deepEqual(recapParts(old), { context: 'A queued step sat behind a busy worker while another was free.', change: 'A supervisor rule spots the step and tells the main chat.', checked: '2 of 2' })
  assert.deepEqual(recapParts(stepOf({})), { context: '', change: '', checked: null })
})

test('the card\'s title, a goal\'s parts, and the only old picture a card keeps', () => {
  assert.equal(headingOf('B550 Fix of X15: a free worker gets the step is done', 'B550'), 'A free worker gets the step')
  assert.equal(headingOf('G3 Lanterns is done', 'G3'), 'Lanterns')
  assert.deepEqual(goalParts({ why: 'Paths are dark (I3).', doneWhen: 'every path is lit', checked: '3 of 3' }), { context: 'Paths are dark.', change: 'Every path is lit', checked: '3 of 3' })
  assert.equal(goalParts({ why: null, doneWhen: null, checked: null }).change, 'A helper re-checked it against its Done when and its vibe.')
  assert.equal(isBeforeAfter('art-inbox/B5/before-after.png'), true)
  assert.equal(isBeforeAfter('art-inbox/B5/evidence.png'), false)
})

test('an old recap reads in the new form from its step; its points picture is dropped, a Before | After kept; a new one is read as made', () => {
  const note = (id, about, evidence, extra = []) => ({
    head: new Map([['Id', id], ['Kind', 'note'], ['State', 'unread'], ['Since', '2026-10-24 20:00'], ['Recap', 'open'], ['Evidence', evidence]]),
    sections: new Map([['Text', [`${about} Fix of X15: a free worker gets the step is done`, 'A long technical line.']], ['About', [about]], ...extra]),
  })
  const step = stepOf({
    summary: ['A queued step sat behind a busy worker while another was free.'],
    context: ['  Reported by Worker 2 on 2026-10-24 at 19:00: A supervisor rule tells the main chat to hand it on. Merged 3f9a1c2.'],
    checked: ['- pass: a', '- pass: b', '- pass: c'], history: ['- 2026-10-24 19:30 Partner: result check passed: 3 of 3 points pass'],
  })
  const made = note('N3', 'B7', 'art-inbox/B7/evidence.png', [['Context', ['Steps waited.']], ['Change', ['They move.']], ['Points pass', ['3 of 3']]])
  const work = { ok: true, items: new Map([['B7', step], ['N1', note('N1', 'B7', 'art-inbox/B7/evidence.png')], ['N2', note('N2', 'B7', 'art-inbox/B7/before-after.png')], ['N3', made]]) }
  const cards = Object.fromEntries(recapsOf(work, Date.parse('2026-10-24T21:00')).map(one => [one.workId, one]))
  const words = one => [one.heading, one.context, one.change, one.checked, one.evidence, one.checkedLink]
  assert.deepEqual(words(cards.N1), ['A free worker gets the step', 'A queued step sat behind a busy worker while another was free.', 'A supervisor rule tells the main chat to hand it on.', '3 of 3', 'none', '#details=B7'])
  assert.equal(cards.N2.evidence, 'art-inbox/B7/before-after.png')
  assert.deepEqual(words(cards.N3), ['A free worker gets the step', 'Steps waited.', 'They move.', '3 of 3', 'art-inbox/B7/evidence.png', '#details=B7'])
})
