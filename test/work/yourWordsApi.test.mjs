// "Your words" on every step (the person, 2026-10-30: "retain the feedback i gave it so when i tries to suggest new ways
// to accomplish what i want it can verify what i originally asked"). The real case: an ask filed from a worker's "For
// you" block while its one step was in review stood under no step, so the person's rejection never reached that step; its
// check failed, the fix was made without their words, and the checker asked the same question again. Here the answer
// lands on the step with its question, the checker and the fix read it, and the question is not asked again. The board's
// API on a made-up store; made-up names only.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { valueOf } from '../../src/work/item.mjs'
import { refineWaitOf } from '../../src/work/refineWait.mjs'
import { YOUR_WORDS, yourWordsOf } from '../../src/work/yourWords.mjs'
import { NOW, fileCheck, fresh, item, qaOf, remove, reported, takeQa } from '../qaKit.mjs'

const MIN = 60_000
const QUESTION = 'Do you accept the crumbling look for now and leave the rest as a later step?'
const REJECTED = 'the look is okay but it feels a bit square, make it more of a crater, round. Also it lags the moment it happens.'
const FOR_YOU = { n: 1, kind: 'look', text: [QUESTION], options: ['yes', 'no'], advice: 'yes', pictures: ['art-inbox/lamps/evidence.png'], play: '', ref: null }
const words = async (dir, id) => yourWordsOf(await item(dir, id))
/** Words as a pattern that matches them as written. */
const lit = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A step reported by the Lamplighter, in review (its QA task made), and its For you item filed as an ask; the step's and the ask's ids. */
async function askedInReview(store) {
  const { id } = await reported(store)
  assert.equal(valueOf(await item(store.dir, id), 'State'), 'review')
  const ended = await store.later(2 * MIN, 'Lamplighter')({ action: 'turn-ended', since: NOW + 90_000, forYou: [FOR_YOU] })
  assert.equal(ended.ok, true, ended.why)
  assert.equal(ended.result.asked.length, 1)
  return { id, q: ended.result.asked[0] }
}

test('the Q520 case: a For you ask of a worker whose one step is in review stands under that step, and the rejection lands on it with its question', async () => {
  const store = await fresh()
  try {
    const { id, q } = await askedInReview(store)
    assert.equal(valueOf(await item(store.dir, q), 'Of'), id)
    const done = await store.person({ action: 'answer', id: q, verdict: 'reject', text: REJECTED })
    assert.equal(done.ok, true, done.why)
    const [point] = await words(store.dir, id)
    assert.deepEqual([point.n, point.how, point.ask, point.by, point.question, point.options, point.advice, point.shown, point.answer],
      [1, `answer to ${q}`, q, 'Lamplighter', QUESTION, ['yes', 'no'], 'yes', ['art-inbox/lamps/evidence.png'], `Rejected. ${REJECTED}`])
    // The step file holds it as plain text that stands on its own.
    const file = await readFile(join(store.dir, `${id}.md`), 'utf8')
    assert.match(file, new RegExp(`## ${YOUR_WORDS}\\n1\\. \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d · answer to ${q} \\(Lamplighter asked: "${lit(QUESTION)}"; options: yes / no; advised: yes; shown: art-inbox/lamps/evidence\\.png\\)\\n {3}You: Rejected\\. the look is okay`))
  } finally {
    await remove(store.dir)
  }
})

test('the Q530 case: the checker reads the person\'s words, its question they answered is refused with their answer, a new one is asked; ask points are not refused', async () => {
  const store = await fresh()
  try {
    const { id, q } = await askedInReview(store)
    assert.equal((await store.person({ action: 'answer', id: q, verdict: 'reject', text: REJECTED })).ok, true)
    const qa = await qaOf(store, id)
    await takeQa(store, qa)
    // The QA task's next carries the checked step's words, each point with what it answered.
    const next = await store.checker({ action: 'next' })
    assert.match(next.result.text, new RegExp(`The person's words on ${id} \\(check each point too, met or not met; never ask the person what they answered there\\):\\n1\\. .* · answer to ${q} \\(Lamplighter asked: "${lit(QUESTION)}"`))
    assert.match(next.result.text, /You: Rejected\. the look is okay but it feels a bit square/)
    // The same question again, in other words: refused, with the person's answer quoted.
    const again = await store.checker({ action: 'ask', of: id, kind: 'look', title: 'Accept the crumbling look now and leave the rest for later?' })
    assert.equal(again.status, 409)
    assert.match(again.why, new RegExp(`^${id}: the person answered this already on \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d \\(${q}\\): "Rejected\\. the look is okay but it feels a bit square, make it more of a crater, round\\. Also it lags the moment it happens\\."\\. Act on their answer; ask only what is new, and quote their answer\\.$`))
    // A different question of the checker is no card for the person (it checks the step): it is kept as an ask point of the check,
    // and its answer says the step holds the person's words.
    const other = await store.checker({ action: 'ask', of: id, kind: 'decide', title: 'Should the crater edge glow at night?' })
    assert.equal(other.ok, true, other.why)
    assert.match(other.result.text, new RegExp(`\\nThe person's words on ${id}: 1 point, see its "Your words"\\.$`))
    // A new question whose context quotes the earlier one, as the refusal tells the chat to: asked.
    const quoting = await store.checker({ action: 'ask', of: id, kind: 'decide', title: 'How deep should the crater be?', text: `Asked before: "${QUESTION}" You answered: "Rejected. ${REJECTED}"` })
    assert.equal(quoting.ok, true, quoting.why)
    // The check's own ask point (a look only the person can judge) is filed as it was: never refused for their words.
    const checked = await store.checker({ action: 'checked', size: '30 min', id, evidence: 'none (a look)', points: ['pass: a lamp at every bench', `ask: ${QUESTION}`] })
    assert.equal(checked.ok, true, checked.why)
    // The two questions it kept while it checked are ask points of the check too.
    assert.deepEqual((await item(store.dir, id)).sections.get('Checked').filter(one => one.startsWith('- ask: ')), [`- ask: ${QUESTION}`, '- ask: Should the crater edge glow at night?', '- ask: How deep should the crater be?'])
  } finally {
    await remove(store.dir)
  }
})

test('a failed check makes its fix with the person\'s words on it', async () => {
  const store = await fresh()
  try {
    const { id, q } = await askedInReview(store)
    assert.equal((await store.person({ action: 'answer', id: q, verdict: 'reject', text: REJECTED })).ok, true)
    const checked = await fileCheck(store, id, { evidence: 'none (a look)', points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white', 'tried: lit them by hand', 'why: the light came out white'] })
    assert.equal(checked.ok, true, checked.why)
    const fix = await item(store.dir, checked.result.fix)
    assert.equal(valueOf(fix, 'Fix of'), id)
    assert.deepEqual(fix.sections.get(YOUR_WORDS), (await item(store.dir, id)).sections.get(YOUR_WORDS))
    assert.deepEqual(yourWordsOf(fix).map(one => [one.ask, one.question, one.answer]), [[q, QUESTION, `Rejected. ${REJECTED}`]])
  } finally {
    await remove(store.dir)
  }
})

test('the person\'s answers land on the step with their question; a partner\'s answer and the mod\'s own closes do not', async () => {
  const store = await fresh()
  try {
    assert.equal((await store.lamplighter({ action: 'take', minutes: 30, id: 'B1' })).ok, true)
    // A detail question goes to the partner first: its answer is the partner's, not the person's.
    const routed = await store.lamplighter({ action: 'ask', of: 'B1', kind: 'decide', title: 'Cotton or linen wicks?', options: ['A cotton', 'B linen'], advice: 'A' })
    assert.equal(routed.result.route, 'partner')
    assert.equal((await store.partner({ action: 'partner-answer', id: routed.result.id, text: 'A', why: 'your advice' })).ok, true)
    assert.deepEqual(await words(store.dir, 'B1'), [])
    // The person's answer on the board.
    const look = await store.lamplighter({ action: 'ask', of: 'B1', kind: 'look', title: 'Is the flame tall enough?', pictures: ['art-inbox/lamps/flame.png'] })
    assert.equal((await store.person({ action: 'answer', id: look.result.id, verdict: 'approve', text: 'yes' })).ok, true)
    // The app's question form, closed by the mod with nothing typed, then answered in the person's own words.
    const form = await store.lamplighter({ action: 'ask', of: 'B1', kind: 'decide', via: 'form', text: 'Which port for the lamp test?', options: ['4320', '4330'] })
    assert.equal((await store.lamplighter({ action: 'answered-in-chat', id: form.result.id, text: 'answered in the chat' })).ok, true)
    // A popup's ask, closed once its call went on: the mod's words, not the person's.
    const popup = await store.lamplighter({ action: 'ask', of: 'B1', kind: 'do', via: 'form', text: 'A popup in its chat may wait for you: it has tried to run a command for over a minute. Open its chat and look.' })
    assert.equal((await store.lamplighter({ action: 'answered-in-chat', id: popup.result.id, text: 'the call went on' })).ok, true)
    assert.equal(valueOf(await item(store.dir, popup.result.id), 'State'), 'answered')
    const form2 = await store.lamplighter({ action: 'ask', of: 'B1', kind: 'decide', via: 'form', text: 'Which wick length?', options: ['short', 'long'] })
    assert.equal((await store.lamplighter({ action: 'answered-in-chat', id: form2.result.id, text: 'short, but not too short' })).ok, true)
    // A do ticked on the board with the person's line.
    const todo = await store.lamplighter({ action: 'ask', of: 'B1', kind: 'do', title: 'Put the oil in the shed' })
    assert.equal((await store.person({ action: 'tick', id: todo.result.id, line: 'Done: the oil is in the shed, the left shelf' })).ok, true)
    const points = await words(store.dir, 'B1')
    assert.deepEqual(points.map(one => [one.n, one.how, one.question, one.answer]), [
      [1, `answer to ${look.result.id}`, 'Is the flame tall enough?', 'Approved. yes'],
      [2, `answer to ${form2.result.id}, in Lamplighter's chat`, 'Which wick length?', 'short, but not too short'],
      [3, `answer to ${todo.result.id}, ticked on the board`, 'Put the oil in the shed', 'Done: the oil is in the shed, the left shelf'],
    ])
    assert.deepEqual([points[0].shown, points[1].options], [['art-inbox/lamps/flame.png'], ['short', 'long']])
    assert.equal(valueOf(await item(store.dir, todo.result.id), 'State'), 'answered')
  } finally {
    await remove(store.dir)
  }
})

test('the refine answers and the round\'s feedback land on the step, each with its question or the summary it answers', async () => {
  const store = await fresh()
  try {
    const refined = await store.partner({ action: 'refine', id: 'B1', summary: 'Trim every wick to one length.', questions: ['Thin or thick wicks? Advised: yes, thick burns longer', 'Brass or iron holders?'] })
    assert.equal(refined.ok, true, refined.why)
    const [first] = refined.result.asks
    const answered = await store.person({ action: 'refine-answer', id: 'B1', answers: [{ index: 0, answer: 'thick' }], feedback: 'Keep them short.' })
    assert.equal(answered.ok, true, answered.why)
    const points = await words(store.dir, 'B1')
    assert.deepEqual(points.map(one => [one.how, one.by, one.question, one.about, one.answer]), [
      [`answer to ${first}, a refine question of round 1`, 'Partner', 'Thin or thick wicks? Advised: yes, thick burns longer', null, 'thick'],
      ['feedback on the refine of round 1', null, null, 'Trim every wick to one length.', 'Keep them short.'],
    ])
    // A step that waits for its refine is asked again by the board's word to the partner, Your words or not.
    const wait = refineWaitOf(new Map(), { ...(await item(store.dir, 'B1')), head: new Map([...(await item(store.dir, 'B1')).head, ['State', 'new'], ['Refined', '-']]), sections: new Map([[YOUR_WORDS, (await item(store.dir, 'B1')).sections.get(YOUR_WORDS)]]) },
      [{ command: 'refine', about: 'B1', at: NOW, state: 'delivered', deliveredAt: NOW }])
    assert.notEqual(wait, null)
  } finally {
    await remove(store.dir)
  }
})

test('words: the person and the main chat put the person\'s words on a step; a worker or the partner may not', async () => {
  const store = await fresh()
  try {
    const mine = await store.person({ action: 'words', id: 'B1', text: 'Never white light, anywhere.' })
    assert.equal(mine.ok, true, mine.why)
    assert.equal(mine.result.text, 'B1: the person\'s words stand as point 1 of its "Your words".')
    const told = await store.keeper({ action: 'words', id: 'B1', text: 'The lamps may flicker a little.', where: 'in Keeper\'s chat, 2026-10-27 09:01' })
    assert.equal(told.ok, true, told.why)
    assert.deepEqual((await words(store.dir, 'B1')).map(one => [one.n, one.how, one.question, one.answer]), [
      [1, 'note (on the board)', null, 'Never white light, anywhere.'],
      [2, 'note (in Keeper\'s chat, 2026-10-27 09:01)', null, 'The lamps may flicker a little.'],
    ])
    assert.equal((await store.lamplighter({ action: 'words', id: 'B1', text: 'x' })).status, 403)
    assert.equal((await store.partner({ action: 'words', id: 'B1', text: 'x' })).status, 403)
    assert.equal((await store.person({ action: 'words', id: 'B1', text: '  ' })).status, 400)
    assert.equal((await store.person({ action: 'words', id: 'Q404', text: 'x' })).status, 404)
  } finally {
    await remove(store.dir)
  }
})

test('an ask with no step from a worker stands under its one held step, its one in progress first; with several, or none, it stands alone', async () => {
  const store = await fresh()
  try {
    await writeFile(join(store.dir, 'partner-answers.json'), '{"on":false}\n')
    const { id } = await reported(store)
    // Its one step, in review.
    const one = await store.lamplighter({ action: 'ask', kind: 'decide', title: 'Should the lamps dim at dawn?' })
    assert.equal(one.ok, true, one.why)
    assert.equal(valueOf(await item(store.dir, one.result.id), 'Of'), id)
    // A step in progress beside it is the one.
    assert.equal((await store.lamplighter({ action: 'take', minutes: 30, id: 'B1' })).ok, true)
    const working = await store.lamplighter({ action: 'ask', kind: 'decide', title: 'Should the wicks be trimmed at night?' })
    assert.equal(valueOf(await item(store.dir, working.result.id), 'Of'), 'B1')
    // The checker that holds only its QA task: the step it checks. It never asks the person about it (one question per task):
    // its question joins the builder's open ask under that step.
    await takeQa(store, await qaOf(store, id))
    const checking = await store.checker({ action: 'ask', kind: 'look', title: 'Is the warm light warm enough?' })
    assert.equal(checking.result.merged, one.result.id)
    assert.equal(valueOf(await item(store.dir, checking.result.id), 'Of'), id)
    // The main chat, which holds none, asks alone.
    const alone = await store.keeper({ action: 'ask', kind: 'decide', title: 'Should the garden open on Sunday?' })
    assert.equal(valueOf(await item(store.dir, alone.result.id), 'Of'), null)
  } finally {
    await remove(store.dir)
  }
})

test('a For you item the person answered on the step already is left out, with their answer for the chat', async () => {
  const store = await fresh()
  try {
    const { id, q } = await askedInReview(store)
    assert.equal((await store.person({ action: 'answer', id: q, verdict: 'reject', text: REJECTED })).ok, true)
    const ended = await store.later(30 * MIN, 'Lamplighter')({ action: 'turn-ended', since: NOW + 20 * MIN, forYou: [FOR_YOU] })
    assert.equal(ended.ok, true, ended.why)
    assert.deepEqual(ended.result.asked, [])
    assert.equal(ended.result.left.length, 1)
    assert.match(ended.result.left[0], new RegExp(`^"${lit(QUESTION)}" the person answered on ${id} already \\(\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d, ${q}\\): "Rejected\\. the look is okay`))
  } finally {
    await remove(store.dir)
  }
})
