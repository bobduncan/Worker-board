// B569 (I92): a report's Context and Change, the plain words a card is made of, and an old recap read in the new form.

import assert from 'node:assert/strict'
import test from 'node:test'

import { recapsOf, rewriteRecap } from '../../src/work/recap.mjs'
import { goalParts, headingOf, insiderWords, isBeforeAfter, isWordingOnly, partsWarnings, plainSentences, recapParts, reportParts, technicalWords } from '../../src/work/recapWords.mjs'

const stepOf = ({ summary = [], context = [], checked = [], history = [] }) => ({
  head: new Map([['Id', 'B7'], ['Kind', 'step'], ['State', 'done']]),
  sections: new Map([['Summary', summary], ['Context', context], ['Checked', checked], ['History', history]]),
})

test('a report reads as its Context, its Change and the rest; the Change ends at Details or a Tests bite line', () => {
  assert.deepEqual(reportParts('Context: The lamps were dark. Change: They glow now. Details: lamps.mjs, Tests bite: x -> y'), { context: 'The lamps were dark.', change: 'They glow now.', rest: 'Details: lamps.mjs, Tests bite: x -> y' })
  assert.deepEqual(reportParts('Context: Dark. Change: Glow. Tests bite: x -> y'), { context: 'Dark.', change: 'Glow.', rest: 'Tests bite: x -> y' })
  assert.deepEqual(reportParts('Lamps glow; merged abc1234.'), { context: '', change: '', rest: 'Lamps glow; merged abc1234.' })
  assert.deepEqual(partsWarnings('Context: Dark. Change: Glow. Details: lamps.mjs'), [])
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
  // Goal definition (2026-10-31): the words people and chats read say "goal definition" where they said "vibe".
  assert.equal(goalParts({ why: null, doneWhen: null, checked: null }).change, 'A helper re-checked it against its Done when and its goal definition.')
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
  // B591: a recap made since B569 from a check with a points picture shows no picture either.
  assert.deepEqual(words(cards.N3), ['A free worker gets the step', 'Steps waited.', 'They move.', '3 of 3', 'none', '#details=B7'])
})

test('B591: ids and placeholders are refused in a report\'s Context and Change; an old sentence with ids, times, placeholders or half a quote is dropped', () => {
  assert.deepEqual(insiderWords('B531 waited behind <busy worker>; Q352 said so'), { ids: ['B531', 'Q352'], placeholders: ['<busy worker>'] })
  assert.deepEqual(insiderWords('A step waited behind a busy worker for 20 min.'), { ids: [], placeholders: [] })
  // 2026-10-25: these are warnings now (the board tidies the card), no longer a refusal.
  assert.deepEqual(partsWarnings('Context: B531 sat queued. Change: Main hands <n> on. Details: x').slice(0, 2), [
    'the Context holds ids (B531): the card leaves those words out',
    'the Change holds placeholders (<n>): the card leaves those words out',
  ])
  assert.deepEqual(technicalWords('say yes/how/cost, and a/b/c, but not src/content/arenas/dev or a/b.c/d or a\\b\\c').files, ['src/content/arenas/dev', 'a/b.c/d', 'a\\b\\c'])
  // B639: a drive, a leading slash or a game folder first also makes a path.
  assert.deepEqual(technicalWords('C:/Users/anna/Desktop, /d/Work/foo/bar, content/arenas/dev, render/a/b, art/units/lava, but not yes/how/cost or and/or/maybe').files, [
    'C:/Users/anna/Desktop', '/d/Work/foo/bar', 'content/arenas/dev', 'render/a/b', 'art/units/lava'])
  assert.equal(plainSentences('B531 sat queued. A step could wait behind a busy worker. It waited 3 h 43 min. Main says "Requeue <n>". Both boards have it. One that does not answer never counts" failed. Suite 2312 pass.', 300), 'A step could wait behind a busy worker. Both boards have it.')
})

test('B591: a recap\'s card words written anew: plain, within the limits, its Points pass kept or taken from its step', () => {
  const note = (extra = []) => ({
    head: new Map([['Id', 'N5'], ['Kind', 'note'], ['State', 'read'], ['Since', '2026-10-24 20:00'], ['Recap', 'seen'], ['Evidence', 'art-inbox/B7/evidence.png'], ['Text', 'old']]),
    sections: new Map([['Text', ['B7 Fix of X15: a free worker gets the step waiting longest is done', 'A long technical line.']], ...extra, ['About', ['B7']], ['History', ['- 2026-10-24 20:00 Partner: recap made']]]),
  })
  const step = stepOf({ checked: ['- pass: a', '- pass: b'], history: ['- 2026-10-24 19:30 Partner: result check passed: 2 of 2 points pass'] })
  const words = { title: 'A free worker now gets the step that waited longest', context: 'A step could sit queued behind a busy worker.', change: 'Main hands it to the free worker.' }
  const done = rewriteRecap(note(), words, step)
  assert.equal(done.ok, true)
  assert.deepEqual([...done.item.sections.keys()], ['Text', 'Context', 'Change', 'Points pass', 'About', 'History'])
  assert.deepEqual([done.item.sections.get('Text'), done.item.sections.get('Points pass')], [['B7 A free worker now gets the step that waited longest is done', 'Main hands it to the free worker.'], ['2 of 2']])
  const card = recapsOf({ ok: true, items: new Map([['B7', step], ['N5', done.item]]) }, Date.parse('2026-10-24T21:00'))[0]
  assert.deepEqual([card.heading, card.context, card.change, card.checked, card.evidence], [words.title, words.context, words.change, '2 of 2', 'none'])
  assert.deepEqual(rewriteRecap(note([['Points pass', ['5 of 5']]]), { context: 'Dark.', change: 'Glow.' }, step).item.sections.get('Points pass'), ['5 of 5'])
  assert.equal(rewriteRecap(note(), { context: 'B531 sat queued.', change: 'Glow.' }, step).why, 'N5: the Context holds ids (B531): say it in plain words, for someone who forgot, and put those after "Details:"')
  assert.equal(rewriteRecap(note(), { context: '', change: 'x'.repeat(501) }, step).why, 'N5: no Context; the Change is over 500 characters')
})

// 2026-10-25 (the person: "check the work, not the wording"): the board no longer sends a worker back for the words of a
// card; it builds the card's Context and Change itself.
const reportOf = text => `  Reported by Worker 2 on 2026-10-25 at 20:00: ${text} (merged 3f9a1c2)`

test('2026-10-25: a card\'s Context and Change that read plain stay as written; too long ones are cut at a word', () => {
  const plain = stepOf({ context: [reportOf('Context: Steps sat queued. Change: A free worker gets them. Details: x')] })
  assert.deepEqual(recapParts(plain), { context: 'Steps sat queued.', change: 'A free worker gets them.', checked: null })
  const words = 'dark lamps '.repeat(40)
  const long = recapParts(stepOf({ context: [reportOf(`Context: ${words}Change: ${words.repeat(3)}Details: x`)] }))
  assert.equal(long.context.length <= 300 && long.context.endsWith('…'), true)
  assert.equal(long.change.length <= 500 && long.change.endsWith('…'), true)
  assert.match(long.context, /lamps…$/, 'cut at a word, not inside one')
})

// The re-check of 2026-10-25: taking the technical words out of a sentence left broken ones ("Lamps stay off set to
// true."). Simple over clever: a sentence that holds a file name, code word, hash, id or placeholder is dropped whole;
// with nothing plain left the step's summary or title stands in, never the Details.
test('2026-10-25: a card sentence with a file name, code word, hash, id or placeholder is dropped whole, never left broken', () => {
  const step = stepOf({ summary: ['Lamps stayed dark along the paths at night.'], context: [reportOf('Context: The lampPost rule in src/lamps.mjs was wrong. Paths were dark at night. Change: Every lamp in lamps.mjs glows after sunset (see 3f9a1c2). Merged 3f9a1c2. Main hands <n> on. Every lamp glows after sunset. Details: Something else entirely.')] })
  assert.deepEqual(recapParts(step), { context: 'Paths were dark at night.', change: 'Every lamp glows after sunset.', checked: null })
  // The three sentences the re-check found broken: each is dropped, and the summary stands in for the Change.
  const broken = ['Lamps stay off with useNight set to true.', 'Nothing breaks anymore with lamp_mode on.', 'Prices show, except in shop.ts.']
  for (const sentence of broken) {
    const card = recapParts(stepOf({ summary: ['Lamps work again.'], context: [reportOf(`Context: Dark. Change: ${sentence} Details: Something else entirely.`)] }))
    assert.equal(card.change, 'Lamps work again.', sentence)
  }
  // Among plain ones they are left out, the plain ones stay.
  assert.equal(recapParts(stepOf({ context: [reportOf(`Context: Dark paths. ${broken[0]} Lamps glow. Change: Lamps glow. Details: x`)] })).context, 'Dark paths. Lamps glow.')
  // A technical word as the object of a verb, or a stump like "For it.": the sentence goes, as every such sentence.
  assert.equal(recapParts(stepOf({ context: [reportOf('Context: The board calls draw() and the helper too often. Paths were dark. Change: Lamps glow. Details: x')] })).context, 'Paths were dark.')
  assert.equal(recapParts(stepOf({ context: [reportOf('Context: Dark paths. See verdict.md for it. Change: Lamps glow. Details: x')] })).context, 'Dark paths.')
})

test('2026-10-25: plain sentences check plainness before the capital letter: a hash or camelCase word at the start does not survive', () => {
  assert.equal(plainSentences('lampPost broke the glow. The lamps glow now.', 300), 'The lamps glow now.')
  assert.equal(plainSentences('abc1234 broke it. The lamps glow now.', 300), 'The lamps glow now.')
  assert.equal(plainSentences('the lamps glow now. then they dim.', 300), 'The lamps glow now. Then they dim.')
})

test('2026-10-25: a missing Context or Change, or nothing plain left of one, comes from the step\'s summary or title, never from the Details', () => {
  const titled = parts => {
    const step = stepOf(parts)
    step.head.set('Title', 'Light the garden lamps')
    return step
  }
  const summary = ['Every path has a warm lamp. It used lamps.mjs.']
  // No Context at all: the summary.
  assert.deepEqual(recapParts(titled({ summary, context: [reportOf('Change: Every lamp glows after sunset. Details: x')] })), { context: 'Every path has a warm lamp.', change: 'Every lamp glows after sunset.', checked: null })
  // No Change, with Details: the summary, not the Details.
  assert.deepEqual(recapParts(titled({ summary, context: [reportOf('Context: Paths were dark. Details: Something else entirely.')] })), { context: 'Paths were dark.', change: 'Every path has a warm lamp.', checked: null })
  // A Change with nothing plain in it: the summary; with no summary the step's title.
  assert.equal(recapParts(titled({ summary, context: [reportOf('Context: Paths were dark. Change: See lamps.mjs. Details: Something else entirely.')] })).change, 'Every path has a warm lamp.')
  assert.equal(recapParts(titled({ context: [reportOf('Context: Paths were dark. Change: See lamps.mjs. Details: Something else entirely.')] })).change, 'Light the garden lamps')
  // A Context that is nothing but file names and ids: the summary stands in.
  assert.equal(recapParts(titled({ summary, context: [reportOf('Context: See B531 in src/lamps.mjs. Change: Lamps glow. Details: x')] })).context, 'Every path has a warm lamp.')
  // Both from the summary: said once, as the Change.
  assert.deepEqual(recapParts(titled({ summary, context: [reportOf('Change: See lamps.mjs. Details: x')] })), { context: '', change: 'Every path has a warm lamp.', checked: null })
  // A report with no Context or Change at all (before B569): its own prose is read, as before.
  assert.equal(recapParts(titled({ summary, context: [reportOf('The garden lamps glow after sunset. Tests added.')] })).change, 'The garden lamps glow after sunset.')
})

test('2026-10-25: an item id in the card\'s words becomes that item\'s title when the store is given and the title reads plain', () => {
  const item = (id, title) => ({ head: new Map([['Id', id], ['Kind', 'step'], ['Title', title]]), sections: new Map() })
  const items = new Map([['B531', item('B531', 'Hand queued steps to free workers')], ['B532', item('B532', 'Fix of X15: rewrite lamps.mjs')]])
  const step = stepOf({ context: [reportOf('Context: Step B531 sat queued. Change: B532 is done. Details: lamps.mjs')] })
  assert.deepEqual(recapParts(step, items), { context: 'Step "Hand queued steps to free workers" sat queued.', change: '', checked: null })
  // Without the store, or with a title that is no plainer, the id stays and the sentence is left out.
  assert.equal(recapParts(step).context, '')
})

test('2026-10-25: isWordingOnly tells the refusals for wording the board made before from a refusal for a fact', () => {
  const old = [
    'work in board; the result names no Context: open it with "Context: <1-3 short lines: what was wrong or missing, for someone who forgot> Change: <what the person gets now> Details: <the rest, for the check>"; the result names no Change: after the Context, "Change: <what the person gets now>", then "Details:" and the rest; the Context and the Change are in plain words, for someone who forgot: no file names, code words, ids, commit hashes or placeholders; those go after "Details:"; the Context is at most 300 characters and the Change at most 500',
    'work in board; the Context is 304 characters: at most 300, the rest goes after "Details:"; the Change holds file names (a.mjs), ids (B1): say it in plain words, for someone who forgot, and put those after "Details:"; the Context is at most 300 characters and the Change at most 500',
    'work in board; the change touches tests (test/a.test.mjs) but the result names no mutant: add "Tests bite: <what was undone in a copy> → <the assertion that failed>" and report again',
    'work outside git; the result names no Context: open it with "x"',
  ]
  for (const detail of old) assert.equal(isWordingOnly(detail), true, detail.slice(0, 60))
  // One fact among them, or nothing known: not wording only.
  assert.equal(isWordingOnly(`${old[1]}; main of board is not the same as origin/main`), false)
  assert.equal(isWordingOnly('work in board; the branch b5 is still there'), false)
  assert.equal(isWordingOnly('work in board; the worktree /p/board-b5 is still on b5: git worktree remove /p/board-b5'), false)
  assert.equal(isWordingOnly('not there: art-inbox/a.png'), false)
  assert.equal(isWordingOnly(''), false)
  assert.equal(isWordingOnly(undefined), false)
})
