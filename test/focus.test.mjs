// Focus 1 (spec 2026-10-18, section 5): the focus in goals.md's head, and a goal's goal definition and how as lines under it,
// read by src/goals.mjs and written by id through src/goalsWrite.mjs. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { focusStage, parseGoals } from '../src/goals.mjs'
import { agreeHow, agreeVibe, setFocus, setHow, setVibe } from '../src/goalsWrite.mjs'

const MAP = [
  '# Goals',
  'Last id: G4',
  'Focus: G2',
  '',
  'Rules: a goal is one line.',
  '',
  '- [~] G1 A garden people visit',
  '  Done when: ten visitors in a week',
  '  - [~] G2 Benches that feel like home',
  '    Brainstorm: talks/2026-10-18-benches.md (running)',
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  '    Goal definition: you sit down without thinking',
  '    Goal definition: warm wood, never metal',
  '    Goal definition picture: pictures/bench.png',
  '    Goal definition agreed: 2026-10-18 10:00',
  '    Part: Draw the bench · about 1 h · steps B10, B11',
  '    Part: Place them by the path · 30 min',
  '    Part: One look at the whole garden',
  '    Partner decides: the wood\'s colour',
  '    You decide: how many benches',
  '    How agreed: 2026-10-18 11:00',
  '    Odd line the map does not know',
  '    - [ ] G3 A bench by the pond',
  '- [ ] G4 Lanterns',
  '',
].join('\n')

test('the focus is read from the head, and each new line kind under its goal', () => {
  const goals = parseGoals(MAP)
  assert.equal(goals.focus, 'G2')
  const two = goals.byId.get('G2')
  assert.deepEqual(two.vibe, ['you sit down without thinking', 'warm wood, never metal'])
  assert.equal(two.vibePicture, 'pictures/bench.png')
  assert.equal(two.vibeAgreed, '2026-10-18 10:00')
  // Work blocks (2026-10-31): each part (a work block) has its done-when line, null without one.
  assert.deepEqual(two.parts, [
    { title: 'Draw the bench', size: 'about 1 h', steps: ['B10', 'B11'], doneWhen: null },
    { title: 'Place them by the path', size: '30 min', steps: [], doneWhen: null },
    { title: 'One look at the whole garden', size: null, steps: [], doneWhen: null },
  ])
  assert.deepEqual(two.partnerDecides, ['the wood\'s colour'])
  assert.deepEqual(two.youDecide, ['how many benches'])
  assert.equal(two.howAgreed, '2026-10-18 11:00')
  // An unknown line is kept as a note; a goal without the lines has them empty.
  assert.deepEqual(two.notes, ['Odd line the map does not know'])
  const four = goals.byId.get('G4')
  assert.deepEqual([four.vibe, four.vibePicture, four.vibeAgreed, four.parts, four.partnerDecides, four.youDecide, four.howAgreed], [[], null, null, [], [], [], null])
  // A part line with the steps but no size.
  assert.deepEqual(parseGoals('- [ ] G1 A\n  Part: Paint · steps B3\n').byId.get('G1').parts, [{ title: 'Paint', size: null, steps: ['B3'], doneWhen: null }])
})

test('Review Focus 1: no Focus line, an empty one, or one naming a goal that is gone is no focus: the page picks', () => {
  assert.equal(parseGoals(MAP.replace('Focus: G2\n', '')).focus, null)
  assert.equal(parseGoals(MAP.replace('Focus: G2', 'Focus:')).focus, null)
  const gone = parseGoals(MAP.replace('Focus: G2', 'Focus: G9'))
  assert.equal(gone.focus, 'G9')
  assert.equal(focusStage(gone.byId.get(gone.focus) ?? null), 'pick')
  assert.deepEqual(gone.problems, [])
  // A Focus line among the goals is no head line: it is a goal's own line, kept as a note.
  const low = parseGoals('- [ ] G1 A\n  Focus: G1\n')
  assert.equal(low.focus, null)
})

// Goal definition (2026-10-31): the words people and chats read say "goal definition" where they said "vibe".
test('the stage follows from the lines: goal definition (the stage `vibe`), how, run, done; pick without a goal', () => {
  const node = lines => parseGoals(`- [~] G1 A\n${lines.map(one => `  ${one}\n`).join('')}`).byId.get('G1')
  assert.equal(focusStage(null), 'pick')
  assert.equal(focusStage(node([])), 'vibe')
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  assert.equal(focusStage(node(['Goal definition: calm'])), 'vibe')
  assert.equal(focusStage(node(['Goal definition: calm', 'Goal definition agreed: 2026-10-18 10:00'])), 'how')
  // Review Focus 2: agreed by hand without its words is still the how.
  assert.equal(focusStage(node(['Goal definition agreed: 2026-10-18 10:00'])), 'how')
  assert.equal(focusStage(node(['Goal definition agreed: 2026-10-18 10:00', 'Part: X', 'How agreed: 2026-10-18 11:00'])), 'run')
  assert.equal(focusStage(parseGoals('- [x] G1 A\n  Goal definition agreed: 1\n  How agreed: 2\n').byId.get('G1')), 'done')
  assert.equal(focusStage(parseGoals('- [x] G1 A\n').byId.get('G1')), 'done')
})

const linesOf = text => text.split('\n')
/** The lines of `after` that are not in `before`, and those gone, in order. */
const diff = (before, after) => ({
  added: linesOf(after).filter(line => !linesOf(before).includes(line)),
  gone: linesOf(before).filter(line => !linesOf(after).includes(line)),
})

test('setFocus writes the head line by id, replaces it, and null takes it out; a goal that is gone is refused', () => {
  const none = MAP.replace('Focus: G2\n', '')
  const set = setFocus(none, 'G4')
  assert.equal(set.ok, true)
  assert.deepEqual(linesOf(set.text).slice(0, 4), ['# Goals', 'Last id: G4', 'Focus: G4', ''])
  assert.deepEqual(diff(none, set.text), { added: ['Focus: G4'], gone: [] })
  assert.deepEqual(diff(MAP, setFocus(MAP, 'G3').text), { added: ['Focus: G3'], gone: ['Focus: G2'] })
  assert.deepEqual(diff(MAP, setFocus(MAP, null).text), { added: [], gone: ['Focus: G2'] })
  assert.equal(setFocus(none, null).text, none)
  assert.deepEqual(setFocus(MAP, 'G9'), { ok: false, why: 'gone' })
  // A file without a head: on top, under its heading when it has one.
  assert.equal(setFocus('- [ ] G1 A\n', 'G1').text, 'Focus: G1\n- [ ] G1 A\n')
  assert.equal(setFocus('# Goals\n- [ ] G1 A\n', 'G1').text, '# Goals\nFocus: G1\n- [ ] G1 A\n')
  // The file's own line ends stay.
  assert.equal(setFocus('# Goals\r\n- [ ] G1 A\r\n', 'G1').text, '# Goals\r\nFocus: G1\r\n- [ ] G1 A\r\n')
})

// Goal definition (2026-10-31): the words people and chats read say "goal definition" where they said "vibe".
test('setVibe replaces only its goal\'s goal definition lines and picture, where they stood; other lines and goals stay', () => {
  const done = setVibe(MAP, 'G2', ['calm and slow', '  ', 'no metal'], null)
  assert.equal(done.ok, true)
  assert.deepEqual(diff(MAP, done.text), {
    // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
    added: ['    Goal definition: calm and slow', '    Goal definition: no metal'],
    gone: ['    Goal definition: you sit down without thinking', '    Goal definition: warm wood, never metal', '    Goal definition picture: pictures/bench.png'],
  })
  const lines = linesOf(done.text)
  assert.equal(lines.indexOf('    Goal definition: calm and slow'), linesOf(MAP).indexOf('    Goal definition: you sit down without thinking'))
  // A goal without them: after its own lines at its top, before its goals inside.
  const first = setVibe(MAP, 'G1', ['busy and green'], 'pictures/g.png')
  assert.deepEqual(linesOf(first.text).slice(7, 11), ['  Done when: ten visitors in a week', '  Goal definition: busy and green', '  Goal definition picture: pictures/g.png', '  - [~] G2 Benches that feel like home'])
  // The G2 lines inside G1 are not G1's own: untouched.
  assert.ok(first.text.includes('    Goal definition: you sit down without thinking'))
  assert.deepEqual(setVibe(MAP, 'G9', ['x'], null), { ok: false, why: 'gone' })
})

test('agreeVibe and agreeHow write their line once; a second agree keeps the first', () => {
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  const plain = '- [ ] G1 A\n  Done when: x\n  Goal definition: calm\n  - [ ] G2 B\n'
  const once = agreeVibe(plain, 'G1', '2026-10-18 12:00')
  assert.equal(once.text, '- [ ] G1 A\n  Done when: x\n  Goal definition: calm\n  Goal definition agreed: 2026-10-18 12:00\n  - [ ] G2 B\n')
  assert.equal(agreeVibe(once.text, 'G1', '2026-10-18 12:05').text, once.text)
  const how = setHow(once.text, 'G1', { parts: [{ title: 'Paint', size: 'about 1 h', steps: ['B3', 'x'] }, { title: 'Look', size: '', steps: [] }], partnerDecides: ['the colour'], youDecide: ['the size'] })
  assert.equal(how.text, '- [ ] G1 A\n  Done when: x\n  Goal definition: calm\n  Goal definition agreed: 2026-10-18 12:00\n  Part: Paint · about 1 h · steps B3\n  Part: Look\n  Partner decides: the colour\n  You decide: the size\n  - [ ] G2 B\n')
  const agreed = agreeHow(how.text, 'G1', '2026-10-18 13:00')
  assert.equal(agreed.text, how.text.replace('  You decide: the size\n', '  You decide: the size\n  How agreed: 2026-10-18 13:00\n'))
  assert.equal(agreeHow(agreed.text, 'G1', '2026-10-18 14:00').text, agreed.text)
  assert.equal(focusStage(parseGoals(agreed.text).byId.get('G1')), 'run')
  assert.deepEqual(agreeVibe(plain, 'G9', 'x'), { ok: false, why: 'gone' })
})

test('setHow replaces its goal\'s parts and decide lines where they stood, keeping the rest', () => {
  const done = setHow(MAP, 'G2', { parts: [{ title: 'Only part', size: null, steps: [] }], partnerDecides: [], youDecide: ['the count'] })
  assert.deepEqual(diff(MAP, done.text), {
    added: ['    Part: Only part', '    You decide: the count'],
    gone: ['    Part: Draw the bench · about 1 h · steps B10, B11', '    Part: Place them by the path · 30 min', '    Part: One look at the whole garden', '    Partner decides: the wood\'s colour', '    You decide: how many benches'],
  })
  assert.ok(linesOf(done.text).indexOf('    Part: Only part') < linesOf(done.text).indexOf('    How agreed: 2026-10-18 11:00'))
  const back = parseGoals(done.text).byId.get('G2')
  assert.deepEqual([back.parts, back.partnerDecides, back.youDecide, back.howAgreed], [[{ title: 'Only part', size: null, steps: [], doneWhen: null }], [], ['the count'], '2026-10-18 11:00'])
  assert.deepEqual(setHow(MAP, 'G2', null), { ok: false, why: 'form' })
})
