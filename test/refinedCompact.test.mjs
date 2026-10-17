// B293: a refined step is one compact description. While the Advisor refines it, its block holds a summary, a picture,
// its goal and its size, with one-line questions the person answers Yes or No, or takes the advice for. Once ready
// ("Refined (<date time>; ready):"), it holds the description only: "What we build", no questions and no rounds.
// Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { overview, parseBacklog, queue, refinedOf, withoutRefined } from '../src/backlog.mjs'
import { checkSay } from '../src/say.mjs'
import { refineAsk } from '../src/state.mjs'
import { answerRefine } from '../src/tick.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')
const between = (from, to) => script.slice(script.indexOf(from), script.indexOf(to))

const REFINING = [
  '## Zebracorns\n',
  '- [ ] B21 Give the zebracorn a stable (for Units; about 3 h)\n',
  '  Refined (round 2, by Oracle, 2026-10-17 10:05):\n',
  '  Summary: The zebracorn sleeps in a stable of its own,\n',
  '  so the herd stops waking it.\n',
  '  Picture: art-inbox/stable/v1.png (the stable beside the meadow; the roof is open)\n',
  '  Part of: G4 M2 · A herd that rests\n',
  '  Size: about 3-4 hours\n',
  '  Questions:\n',
  '  - A roof of straw, not of stone? Advised: yes, straw is quicker to draw\n',
  '  - One stable for the whole herd? Advised: no\n',
  '  - Which colour for the door?\n',
  '  Context: asked by the herd.\n',
  '- [ ] B22 Paint the narwhal bridge (for Units; about 1 h)\n',
  '  Refined (2026-10-17 10:20; ready):\n',
  '  Summary: The narwhal crosses the bay on a painted bridge.\n',
  '  Picture: none (a colour change only; nothing new to see)\n',
  '  Part of: G4 M2 · A herd that rests\n',
  '  Size: about 1 hour\n',
  '  What we build:\n',
  '  - The bridge in the herd\'s blue,\n',
  '    with a white rail.\n',
  '  - Not in it: a second bridge; it waits for the bay\'s map.\n',
  '  (branch feature/bridge)\n',
].join('')

test('the new lines are read into the block: summary, picture, goal, size, and questions with their advice', () => {
  const step = parseBacklog(REFINING).activities[0].steps[0]
  const refined = refinedOf(step.notes)
  assert.equal(refined.ready, false)
  assert.equal(refined.round, 2)
  assert.equal(refined.summary, 'The zebracorn sleeps in a stable of its own, so the herd stops waking it.')
  assert.deepEqual(refined.picture, { path: 'art-inbox/stable/v1.png', caption: 'the stable beside the meadow; the roof is open' })
  assert.equal(refined.pictureNote, '')
  assert.equal(refined.partOf, 'G4 M2 · A herd that rests')
  assert.equal(refined.size, 'about 3-4 hours')
  assert.deepEqual(refined.build, [])
  assert.deepEqual(refined.questions, [
    { text: 'A roof of straw, not of stone?', answer: null, advice: 'yes', why: 'straw is quicker to draw' },
    { text: 'One stable for the whole herd?', answer: null, advice: 'no', why: '' },
    { text: 'Which colour for the door?', answer: null, advice: null, why: '' },
  ])
  // The block ends at the step's next named line, as before.
  assert.deepEqual(withoutRefined(step.notes), ['Context: asked by the herd.'])
})

test('a ready block is the description only: "What we build", no questions, no round', () => {
  const step = parseBacklog(REFINING).activities[0].steps[1]
  const refined = refinedOf(step.notes)
  assert.equal(refined.ready, true)
  assert.equal(refined.at, '2026-10-17 10:20')
  assert.equal(refined.by, null)
  assert.equal(refined.picture, null)
  assert.equal(refined.pictureNote, 'a colour change only; nothing new to see')
  assert.equal(refined.size, 'about 1 hour')
  assert.deepEqual(refined.build, ['The bridge in the herd\'s blue, with a white rail.', 'Not in it: a second bridge; it waits for the bay\'s map.'])
  assert.deepEqual(refined.questions, [])
  // The closing line in brackets still ends it.
  assert.deepEqual(withoutRefined(step.notes), ['(branch feature/bridge)'])
  assert.equal(overview(parseBacklog(REFINING))[0].steps[1].refined.ready, true)
})

test('an answer goes behind the advice, and is read as the answer', () => {
  const done = answerRefine(REFINING, 'B21', [{ index: 0, answer: 'yes' }, { index: 1, answer: 'yes' }], '')
  assert.equal(done.ok, true)
  assert.match(done.text, /- A roof of straw, not of stone\? Advised: yes, straw is quicker to draw Answer: yes\n/)
  const refined = refinedOf(parseBacklog(done.text).activities[0].steps[0].notes)
  assert.deepEqual(refined.questions.slice(0, 2), [
    { text: 'A roof of straw, not of stone?', answer: 'yes', advice: 'yes', why: 'straw is quicker to draw' },
    { text: 'One stable for the whole herd?', answer: 'yes', advice: 'no', why: '' },
  ])
})

test('the Advisor is no longer shown as refining once a ready block is written after the ask, which names no round', () => {
  const at = new Date(2026, 9, 17, 10, 12, 30).getTime()
  const sent = [{ command: 'refine', about: 'B22', round: 2, at, state: 'delivered', deliveredAt: at }]
  const now = at + 5 * 60_000
  const step = refined => ({ id: 'B22', refined })
  // Its round 1 block, written before the ask: still refining.
  assert.equal(refineAsk(step({ round: 1, at: '2026-10-17 10:05', ready: false }), sent, now).isOpen, true)
  // The ready block, written after: done, though its head has no round.
  assert.equal(refineAsk(step({ round: 1, at: '2026-10-17 10:20', ready: true }), sent, now).isOpen, false)
  // A block of the round asked for: done, as before.
  assert.equal(refineAsk(step({ round: 2, at: null, ready: false }), sent, now).isOpen, false)
})

// The page's own code, cut out of board.js between its marks.
const page = {}
vm.runInNewContext(`${between('// window:start', '// window:end')}\n${between('// refine:start', '// refine:end')}\nObject.assign(this, { windowOf, refineView, adviceAnswers, sizeText })`, page)
const names = { ask: () => 'Step', kind: kind => kind }
const plain = value => JSON.parse(JSON.stringify(value))

test('the window\'s head shows the goal, the size, and the questions waiting or Ready, in place of "Step"', () => {
  const steps = overview(parseBacklog(REFINING))[0].steps
  const chips = step => plain(page.windowOf({ step }, names).chips)
  assert.deepEqual(chips(steps[0]), [
    { text: 'G4 M2 · A herd that rests', tone: 'goal' },
    { text: 'about 3–4 h', tone: 'plain' },
    { text: '3 questions for you', tone: 'wait' },
  ])
  assert.deepEqual(chips(steps[1]), [
    { text: 'G4 M2 · A herd that rests', tone: 'goal' },
    { text: 'about 1 h', tone: 'plain' },
    { text: 'Ready', tone: 'ready' },
  ])
  // A step refined in the older form, or not at all, keeps its "Step" chip.
  assert.deepEqual(chips({ id: 'B23', title: 'Old', status: 'open', notes: [], refined: { problem: 'x', summary: '', partOf: '', size: '', ready: false, questions: [] } }), [{ text: 'Step', tone: 'kind' }])
  assert.deepEqual(chips({ id: 'B24', title: 'New', status: 'open', notes: [], refined: null }), [{ text: 'Step', tone: 'kind' }])
  assert.equal(page.sizeText('about 2 hours'), 'about 2 h')
  assert.equal(page.sizeText('about 30 minutes'), 'about 30 min')
})

test('"Take the advice" answers every open question with its advice, keeping what the person picked', () => {
  const refined = refinedOf(parseBacklog(REFINING).activities[0].steps[0].notes)
  // The third question has no advice: it needs the person's own answer.
  assert.deepEqual(plain(page.adviceAnswers(refined, {})), { answers: [{ index: 0, answer: 'yes' }, { index: 1, answer: 'no' }], missing: [3] })
  assert.deepEqual(plain(page.adviceAnswers(refined, { 1: 'yes', 2: ' green ' })), { answers: [{ index: 0, answer: 'yes' }, { index: 1, answer: 'yes' }, { index: 2, answer: 'green' }], missing: [] })
  // An answered question is left as it is, unless the person picked anew.
  const answered = { ...refined, questions: refined.questions.map(one => ({ ...one, answer: 'no' })) }
  assert.deepEqual(plain(page.adviceAnswers(answered, {})), { answers: [], missing: [] })
  assert.deepEqual(plain(page.adviceAnswers(answered, { 0: 'yes' })), { answers: [{ index: 0, answer: 'yes' }], missing: [] })
})

test('the Refine part: the advice can be taken while questions are open with advice; a ready step is refined again', () => {
  const steps = overview(parseBacklog(REFINING))[0].steps
  const refining = page.refineView({ ...steps[0], refineAsk: null }, 'Oracle')
  assert.equal(refining.open, 3)
  assert.equal(refining.isReady, false)
  assert.equal(refining.isNewForm, true)
  assert.equal(refining.canTakeAdvice, true)
  const ready = page.refineView({ ...steps[1], refineAsk: null }, 'Oracle')
  assert.equal(ready.isReady, true)
  assert.equal(ready.canTakeAdvice, false)
  assert.equal(ready.canAsk, true)
  // While the Advisor works on it, nothing more is sent.
  assert.equal(page.refineView({ ...steps[0], refineAsk: { isOpen: true, at: 0, round: 3, state: 'delivered' } }, 'Oracle').canTakeAdvice, false)
})

test('the page draws the stages as in the picture, and replaces "Accept as refined" by "Take the advice"', () => {
  const draw = between('function refinePart(', '$(\'details\').addEventListener(\'input\', event => {\n  const name = event.target.dataset?.refineField')
  assert.ok(draw.length > 1000)
  for (const words of ['Send answers', 'Take the advice', 'Refine again', 'Open the picture ↗', 'What we build', 'advised: ']) assert.ok(draw.includes(words), words)
  // No button says the old words any more (comments may).
  assert.ok(!script.includes("'Accept as refined'"))
  assert.ok(!script.includes("'Send answers · refine again'"))
  assert.ok(!script.includes("action: 'refine-accept'"))
  // A ready step's description comes first, in place of the step's own lines, which follow as its notes.
  assert.match(script, /if \(isReady\) left\.append\(refine\)/)
  assert.match(script, /section\(isReady \? 'Notes' : 'Description', described\)/)
  for (const rule of ['.details-chips .chip.is-goal', '.details-chips .chip.is-wait', '.details-chips .chip.is-ready', '.refine-pick[aria-pressed="true"]', '.refined-build li.is-not', '.refined-picture']) assert.ok(style.includes(rule), rule)
})

test('the review\'s findings: a step in a worker\'s queue carries its block apart, as on the Backlog tab', async () => {
  const step = queue(parseBacklog(REFINING))[1]
  assert.equal(step.refined.ready, true)
  assert.deepEqual(plain(step.notes), [{ title: null, lines: ['(branch feature/bridge)'], points: [] }])
  assert.deepEqual(plain(page.windowOf({ step, lane: 'Units' }, names).chips).map(chip => chip.text), ['G4 M2 · A herd that rests', 'about 1 h', 'Ready', 'For: Units'])
  // The lane's queue in the board's state carries it to the page, where the window draws it to read.
  const stateSource = await readFile(join(HERE, '..', 'src', 'state.mjs'), 'utf8')
  assert.match(stateSource, /notes: step\.notes, refined: step\.refined \?\? null, pictures:/)
  assert.match(script, /: refined !== null \? refineToRead\(refined\) : null/)
})

test('the review\'s findings: a caption on its own line, a path in backticks, a dash before the reason, a lone "Not in it:"', () => {
  const text = [
    '- [ ] B31 Fence the meadow (for Units; about 2 h)\n',
    '  Refined (round 1, by Oracle, 2026-10-17 11:00):\n',
    '  Summary: A fence keeps the herd in.\n',
    '  Picture: `art-inbox/fence/v1.png`\n',
    '  (the fence around the meadow)\n',
    '  Size: about 2 hours\n',
    '  Questions:\n',
    '  - Wood, not stone? Advised: yes — wood is quicker\n',
    '  A gate on the east side? Advised: no\n',
    '  - Paint it white? Advised: yes\n',
    '  What we build:\n',
    '  - A fence of wood.\n',
    '  Not in it:\n',
    '  - a second gate\n',
    '  (branch feature/fence)\n',
  ].join('')
  const notes = parseBacklog(`## Meadow\n${text}`).activities[0].steps[0].notes
  const refined = refinedOf(notes)
  assert.deepEqual(refined.picture, { path: 'art-inbox/fence/v1.png', caption: 'the fence around the meadow' })
  assert.equal(refined.size, 'about 2 hours')
  assert.deepEqual(refined.questions.map(one => [one.text, one.advice, one.why]), [['Wood, not stone?', 'yes', 'wood is quicker'], ['A gate on the east side?', 'no', ''], ['Paint it white?', 'yes', '']])
  assert.deepEqual(refined.build, ['A fence of wood.', 'Not in it: a second gate'])
  assert.deepEqual(withoutRefined(notes), ['(branch feature/fence)'])
  // The board writes an answer to the question it shows at that place, also one written without its point.
  const done = answerRefine(`## Meadow\n${text}`, 'B31', [{ index: 1, answer: 'yes' }, { index: 2, answer: 'no' }], '')
  assert.match(done.text, /\n {2}A gate on the east side\? Advised: no Answer: yes\n {2}- Paint it white\? Advised: yes Answer: no\n/)
})

test('the review\'s findings: refining a ready step again, and a finished step\'s block', () => {
  const steps = overview(parseBacklog(REFINING))[0].steps
  const state = { advisor: { name: 'Oracle' }, backlog: [{ name: 'Zebracorns', steps: steps.map(step => ({ ...step, refineAsk: null })) }] }
  assert.match(checkSay({ to: 'Oracle', command: 'refine', step: 'B22' }, state, 4000).message.text, /^refine step\nStep: B22 Paint the narwhal bridge\nRound: 2\nThe step is ready: check it again against the backlog and the goals\.$/)
  assert.match(checkSay({ to: 'Oracle', command: 'refine', step: 'B21' }, state, 4000).message.text, /\nThe answers and feedback are written in the step's refine block\.$/)
  // A finished step asks nothing: no "questions for you" in its head.
  assert.deepEqual(plain(page.windowOf({ step: { ...steps[0], status: 'done' } }, names).chips).map(chip => chip.text), ['G4 M2 · A herd that rests', 'about 3–4 h', 'Finished'])
  // Its window shows the description; while refining again a ready step says so.
  assert.match(script, /const isDescribed = step\.refined\?\.ready === true \|\| \(step\.status === 'done' && hasNewForm\(step\.refined\)\)/)
  assert.match(script, /if \(working !== null\) box\.append\(working\)\n {4}return box/)
  assert.match(script, /Questions \$\{taken\.missing\.join\(' and '\)\} have no advice: answer them first\./)
})

test('the Advisor\'s job and the protocol name the new form', async () => {
  const roles = join(HERE, '..', 'roles')
  const advisor = await readFile(join(roles, 'advisor.md'), 'utf8')
  for (const words of ['Refined (<YYYY-MM-DD HH:MM>; ready):', 'Summary:', 'Picture:', 'Part of:', 'Size:', 'What we build:', 'Advised: yes', 'Not in it:']) assert.ok(advisor.includes(words), words)
  const protocol = await readFile(join(roles, 'protocol.md'), 'utf8')
  assert.match(protocol, /B293/)
  assert.match(protocol, /; ready\):/)
})
