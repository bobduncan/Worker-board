// B259: a brainstorm on the board (spec 2026-10-15, section 5): the thread file the Advisor writes questions and a
// proposal into and the board writes the person's answers into, read and written line by line. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { answerQuestion, markCreated, newThread, parseThread, setThreadState, threadSlug } from '../src/brainstorm.mjs'

const THREAD = [
  '# Brainstorm: The reference look on every map',
  'Goal: G6 Benches that match the picture',
  'Started: 2026-10-15 19:38 · State: running',
  'Opening: I want the benches to feel like the picture, not just look like it.',
  '',
  '## Q1 (19:39)',
  'Which benches count?',
  'Why: it decides how many steps there are.',
  '- A: all of them (advised)',
  '- B: the ones by the gate',
  'Answer (19:41): A — the gate ones first, though',
  '',
  '## Q2 (19:43)',
  'What should "matches the picture" mean?',
  'Why: it decides what the steps measure.',
  '- A: the judges\' score, 75 or more (advised)',
  '- B: your own look',
  'Picture: pictures/brainstorm/q2-options.png',
  '',
].join('\n')

const PROPOSAL = THREAD + ['## Proposal (19:55)', 'Decided:', '- the gate benches first, judged at 75', 'Goals:', '- [ ] Benches by the gate like the picture — under G6 — Done when: the judges give 75', 'Steps:', '- [ ] Carve the gate benches after the picture — Units — about 2 h', '- [ ] Score the benches against the picture — Advisor — about 1 h', 'Note: why 75: the same bar as the units.', ''].join('\n')

test('a thread is read: head, questions with options, answers, the picture; the last question is open', () => {
  const thread = parseThread(THREAD)
  assert.equal(thread.title, 'The reference look on every map')
  assert.deepEqual(thread.goal, { id: 'G6', title: 'Benches that match the picture' })
  assert.equal(thread.state, 'running')
  assert.equal(thread.started, '2026-10-15 19:38')
  assert.equal(thread.opening, 'I want the benches to feel like the picture, not just look like it.')
  assert.equal(thread.questions.length, 2)
  assert.equal(thread.questions[0].text, 'Which benches count?')
  assert.equal(thread.questions[0].why, 'it decides how many steps there are.')
  assert.deepEqual(thread.questions[0].options, [{ key: 'A', text: 'all of them', isAdvised: true }, { key: 'B', text: 'the ones by the gate', isAdvised: false }])
  assert.deepEqual(thread.questions[0].answer, { at: '19:41', key: 'A', words: 'the gate ones first, though' })
  assert.equal(thread.questions[1].answer, null)
  assert.equal(thread.questions[1].picture, 'pictures/brainstorm/q2-options.png')
  assert.equal(thread.proposal, null)
  assert.deepEqual(thread.problems, [])
})

test('an answer is written under the open question only; skip and back are answers too', () => {
  const answered = answerQuestion(THREAD, 2, { at: '19:45', key: 'B', words: '' })
  assert.ok(answered.text.endsWith('Picture: pictures/brainstorm/q2-options.png\nAnswer (19:45): B\n\n'))
  assert.equal(answerQuestion(THREAD, 1, { at: '19:45', key: 'B', words: '' }).why, 'answered')
  assert.equal(answerQuestion(THREAD, 3, { at: '19:45', key: 'B', words: '' }).why, 'none')
  assert.deepEqual(parseThread(answerQuestion(THREAD, 2, { at: '19:45', skipped: true }).text).questions[1].answer, { at: '19:45', skipped: true })
  assert.deepEqual(parseThread(answerQuestion(THREAD, 2, { at: '19:45', back: 1 }).text).questions[1].answer, { at: '19:45', back: 1 })
})

test('the person\'s own words are an answer of their own, one line; a key the question has not is refused', () => {
  const other = answerQuestion(THREAD, 2, { at: '19:46', key: 'Other', words: 'a mix:\nthe judges, then my look' })
  assert.ok(other.text.includes('Answer (19:46): Other — a mix: the judges, then my look\n'))
  assert.deepEqual(parseThread(other.text).questions[1].answer, { at: '19:46', key: 'Other', words: 'a mix: the judges, then my look' })
  assert.equal(answerQuestion(THREAD, 2, { at: '19:46', key: 'C', words: '' }).why, 'form')
  assert.equal(answerQuestion(THREAD, 2, { at: '19:46', key: 'Other', words: ' ' }).why, 'form')
  assert.equal(answerQuestion(THREAD, 2, { at: '19:46', back: 2 }).why, 'form')
  // Once a proposal stands, no question takes an answer any more.
  assert.equal(answerQuestion(PROPOSAL, 2, { at: '19:56', key: 'A', words: '' }).why, 'none')
  // The file's own line ends are kept.
  const crlf = answerQuestion(THREAD.replace(/\n/g, '\r\n'), 2, { at: '19:45', key: 'B', words: '' })
  assert.ok(crlf.text.endsWith('q2-options.png\r\nAnswer (19:45): B\r\n\r\n'))
})

test('a proposal is read and marked created once (Review Focus 5)', () => {
  const thread = parseThread(PROPOSAL)
  assert.deepEqual(thread.proposal.decided, ['the gate benches first, judged at 75'])
  assert.deepEqual(thread.proposal.goals, [{ title: 'Benches by the gate like the picture', under: 'G6', doneWhen: 'the judges give 75' }])
  assert.deepEqual(thread.proposal.steps[1], { title: 'Score the benches against the picture', worker: 'Advisor', cost: 'about 1 h' })
  assert.equal(thread.proposal.note, 'why 75: the same bar as the units.')
  assert.equal(thread.proposal.created, null)
  const created = markCreated(PROPOSAL, { at: '20:01', goals: ['G10'], steps: ['B61'], leftOut: ['Score the benches against the picture'] })
  assert.ok(created.text.endsWith('Note: why 75: the same bar as the units.\nCreated (20:01): G10; B61; left out: Score the benches against the picture\n'))
  assert.equal(markCreated(created.text, { at: '20:02', goals: [], steps: [], leftOut: [] }).why, 'twice')
  assert.equal(parseThread(setThreadState(created.text, 'done').text).state, 'done')
  assert.deepEqual(parseThread(created.text).proposal.created, { at: '20:01', goals: ['G10'], steps: ['B61'], asked: 1, leftOut: ['Score the benches against the picture'] })
  assert.equal(markCreated(THREAD, { at: '20:02', goals: [], steps: [], leftOut: [] }).why, 'none')
})

test('the steps the main chat was asked for are counted when their ids are not known yet; nothing left out says so', () => {
  const created = markCreated(PROPOSAL, { at: '20:01', goals: ['G10', 'G11'], steps: [], asked: 2, leftOut: [] })
  assert.ok(created.text.endsWith('Created (20:01): G10, G11; 2 steps asked of the main chat; left out: nothing\n'))
  assert.deepEqual(parseThread(created.text).proposal.created, { at: '20:01', goals: ['G10', 'G11'], steps: [], asked: 2, leftOut: [] })
  const none = markCreated(PROPOSAL, { at: '20:01', goals: [], steps: [], asked: 0, leftOut: ['A', 'B'] })
  assert.ok(none.text.endsWith('Created (20:01): no goals; no steps; left out: A · B\n'))
})

test('a changed proposal stands under a new heading: the last one counts', () => {
  const changed = `${PROPOSAL}\n## Proposal (20:05)\nDecided:\n- all benches at once\nGoals:\n- [ ] Every bench like the picture — under top — Done when: all judged\nSteps:\nNote: changed: all at once.\n`
  const thread = parseThread(changed)
  assert.deepEqual(thread.proposal.goals, [{ title: 'Every bench like the picture', under: null, doneWhen: 'all judged' }])
  assert.deepEqual(thread.proposal.steps, [])
  assert.equal(thread.proposal.at, '20:05')
})

test('a new thread has the head the Advisor reads, and a slug from the date and the title', () => {
  const text = newThread({ title: 'Lanterns', goal: { id: 'G5', title: 'M2 · The garden is open' }, started: '2026-10-15 21:00', opening: 'Where do lanterns go?' })
  assert.equal(text, '# Brainstorm: Lanterns\nGoal: G5 M2 · The garden is open\nStarted: 2026-10-15 21:00 · State: running\nOpening: Where do lanterns go?\n\n')
  assert.equal(newThread({ title: 'Free', goal: null, started: '2026-10-15 21:00', opening: 'x' }).split('\n')[1], 'Goal: new')
  assert.equal(threadSlug('The reference look on every map', '2026-10-15'), '2026-10-15-the-reference-look-on-every-map')
  assert.equal(threadSlug('What\'s next? Lanterns, bridges & more…', '2026-10-15'), '2026-10-15-what-s-next-lanterns-bridges-more')
  assert.ok(threadSlug('a'.repeat(30) + ' ' + 'b'.repeat(30), '2026-10-15').length <= 51)
  assert.equal(threadSlug('???', '2026-10-15'), '2026-10-15-brainstorm')
  assert.deepEqual(parseThread(text).questions, [])
  assert.equal(parseThread(text).state, 'running')
})

test('a thread with a line the form does not know names it as a problem and keeps the rest', () => {
  const odd = THREAD.replace('Why: it decides how many steps there are.', 'Why: it decides how many steps there are.\nMaybe: a line of its own')
  const thread = parseThread(odd)
  assert.equal(thread.questions.length, 2)
  assert.equal(thread.problems.length, 1)
  assert.match(thread.problems[0], /^line 9: /)
  assert.equal(parseThread('').title, null)
})
