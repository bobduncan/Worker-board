// One question per task (the person, 2026-10-31: "why did i get asked the same question twice"). The live case: Q550 (the
// chat that built B674, asking from its "For you" block) and Q551 (the chat that checked it, a Quality Assurance task) were
// one decision about the same step, filed as two cards under no step. Now an ask that names no step finds its step (the id
// its words name, its goal or title words, the card's step, the held step), a quality checker never asks the person about the
// step it checks (its question joins the builder's open ask, else it is kept as an ask: point of its check), and a second
// question on a step that has the person's open ask joins that ask. The board's API on a made-up store; made-up names only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { stepOfAsk } from '../../src/work/askPlace.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { queueFor } from '../queueFor.mjs'
import { LAMP, NOW, fresh, item, items, qaOf, remove, reported, takeQa } from '../qaKit.mjs'

const MIN = 60_000
const RECAP = { ...LAMP, title: 'Show the recap page of the maps goal', goal: 'G60', text: 'A recap of the maps goal.' }
const BUILDER_Q = 'Is the recap page what you wanted to see before approving G60?'
const CHECKER_Q = 'Does the recap read well enough to approve the maps goal?'
const asksOf = async dir => [...(await items(dir)).values()].filter(one => valueOf(one, 'Kind') === 'ask')
const textOf = one => (one.sections.get('Text') ?? []).join('\n')

/** The builder holds two steps in review (the first about lamps, the second the recap of G60). */
async function twoHeld(store) {
  const lamps = (await reported(store)).id
  const recap = (await reported(store, { lamp: RECAP })).id
  assert.equal(valueOf(await item(store.dir, lamps), 'State'), 'review')
  assert.equal(valueOf(await item(store.dir, recap), 'State'), 'review')
  return { lamps, recap }
}

test('an ask with no step finds its step: the id its words name, then its goal or title words, the card, the held step', async () => {
  const card = { step: null }
  const store = await fresh({ cardStepOf: chat => (chat === 'Lamplighter' ? card.step : null) })
  try {
    const { lamps, recap } = await twoHeld(store)
    const where = async body => {
      const made = await store.lamplighter({ action: 'ask', kind: 'decide', ...body })
      assert.equal(made.ok, true, made.why)
      return valueOf(await item(store.dir, made.result.id), 'Of')
    }
    // Two held steps and nothing to tell them apart: none is picked, the ask stands alone.
    assert.equal(await where({ title: 'Should the garden open on Sunday?' }), null)
    // (a) the id the words name wins, also over a goal that names the other step, also as a link.
    assert.equal(await where({ title: `Is ${recap} what you wanted?`, text: 'It shows the lamps too, see G3.' }), recap)
    assert.equal(await where({ title: 'Is the first page right?', text: `See [the step](http://127.0.0.1:4310/#details=${lamps})` }), lamps)
    // (b) the goal the title names, or two of the title's words, when only one held step matches.
    assert.equal(await where({ title: BUILDER_Q }), recap)
    assert.equal(await where({ title: CHECKER_Q }), recap)
    // Both held steps named: no pick by words.
    assert.equal(await where({ title: `Are ${lamps} and ${recap} one decision?` }), null)
    // (c) the card's step at that moment, for words that name nothing.
    card.step = lamps
    assert.equal(await where({ title: 'Should the garden open on Monday?' }), lamps)
    // A card step the chat does not hold is no pick.
    card.step = 'B1'
    assert.equal(await where({ title: 'Should the garden open on Tuesday?' }), null)
  } finally {
    await remove(store.dir)
  }
})

test('stepOfAsk: the order a to d, a Quality Assurance task standing for the step it checks', () => {
  const step = (id, extra = {}) => ({ head: new Map(Object.entries({ Id: id, Kind: 'step', State: 'review', Title: 'Show the wick lengths', ...extra })), sections: new Map() })
  const items = new Map([['B1', step('B1')], ['B2', step('B2', { Title: 'Heavier hits', Goal: 'G9' })], ['B3', step('B3', { State: 'in progress', Title: 'Quality Assurance: B1 Show the wick lengths', Checks: 'B1' })]])
  const mine = ids => ids.map(id => items.get(id))
  assert.equal(stepOfAsk({ items, mine: mine(['B1', 'B2']), words: 'Is B2 fine?' }), 'B2')
  assert.equal(stepOfAsk({ items, mine: mine(['B1', 'B2']), words: 'Is it fine for G9?' }), 'B2')
  assert.equal(stepOfAsk({ items, mine: mine(['B1', 'B2']), words: 'Are the wick lengths shown?' }), 'B1')
  assert.equal(stepOfAsk({ items, mine: mine(['B1', 'B2']), words: 'Fine?', cardStep: 'B2' }), 'B2')
  assert.equal(stepOfAsk({ items, mine: mine(['B1', 'B2']), words: 'Fine?' }), null)
  // The QA task B3 stands for B1; the one in progress is the pick when nothing else tells.
  assert.equal(stepOfAsk({ items, mine: mine(['B2', 'B3']), words: 'Fine?' }), 'B1')
  assert.equal(stepOfAsk({ items, mine: mine(['B2', 'B3']), words: 'Is B3 fine?' }), 'B1')
  assert.equal(stepOfAsk({ items, mine: mine(['B2', 'B3']), words: 'Is B2 fine?' }), 'B2')
  assert.equal(stepOfAsk({ items, mine: [], words: 'Is B2 fine?' }), null)
})

test('the Q550 and Q551 case: the builder\'s For you item stands under the recap; the checker\'s item joins it, no second card', async () => {
  const store = await fresh()
  try {
    const { recap } = await twoHeld(store)
    const qa = await qaOf(store, recap)
    await takeQa(store, qa)
    // The checker also has a step of its own, as Worker 2 had B847.
    assert.equal((await queueFor(store.dir, 'B1', 'Checker', { now: NOW + 60_000 })).ok, true)
    assert.equal((await store.checker({ action: 'take', minutes: 30, id: 'B1', branch: 'b-own' })).ok, true)
    const built = await store.later(2 * MIN, 'Lamplighter')({ action: 'turn-ended', since: NOW + 90_000, forYou: [{ kind: 'look', text: [BUILDER_Q] }] })
    assert.equal(built.ok, true, built.why)
    assert.equal(built.result.asked.length, 1)
    const q = built.result.asked[0]
    assert.equal(valueOf(await item(store.dir, q), 'Of'), recap)
    const before = (await asksOf(store.dir)).length
    const checked = await store.later(6 * MIN, 'Checker')({ action: 'turn-ended', since: NOW + 5 * MIN, forYou: [{ kind: 'look', text: [CHECKER_Q] }] })
    assert.equal(checked.ok, true, checked.why)
    assert.deepEqual(checked.result.asked, [q])
    assert.equal((await asksOf(store.dir)).length, before)
    const joined = await item(store.dir, q)
    assert.ok(textOf(joined).includes(`Also from the quality check (Checker): ${CHECKER_Q}`), textOf(joined))
    assert.equal(valueOf(joined, 'Owner'), 'Lamplighter')
  } finally {
    await remove(store.dir)
  }
})

test('a quality checker never asks the person about the step it checks: with no builder ask open its question is kept as an ask point of its check', async () => {
  const store = await fresh()
  try {
    const { recap } = await twoHeld(store)
    const qa = await qaOf(store, recap)
    await takeQa(store, qa)
    const before = (await asksOf(store.dir)).length
    const kept = await store.checker({ action: 'ask', of: recap, kind: 'look', title: CHECKER_Q, pictures: ['art-inbox/recap/shot.png'] })
    assert.equal(kept.ok, true, kept.why)
    assert.equal(kept.result.kept, qa)
    assert.match(kept.result.text, /^Not filed for the person: you check B\d+/)
    assert.equal((await asksOf(store.dir)).length, before)
    const task = await item(store.dir, qa)
    assert.deepEqual(task.sections.get('Ask points'), [`- ${CHECKER_Q}`])
    assert.ok(task.sections.get('History').some(one => one.includes(`ask point kept for the check of ${recap}`)))
    // With no `of`, the words find the step; the same way through the For you block.
    const named = await store.checker({ action: 'ask', kind: 'decide', title: `Should ${recap} show the date?` })
    assert.equal(named.result.kept, qa)
    const ended = await store.later(3 * MIN, 'Checker')({ action: 'turn-ended', since: NOW + 2 * MIN, forYou: [{ kind: 'decide', text: [`Is the page of ${recap} wide enough?`] }] })
    assert.deepEqual([ended.result.asked, ended.result.kept.length], [[], 1])
    assert.match(ended.result.text, /Not filed for the person, as you check that step/)
    assert.equal((await asksOf(store.dir)).length, before)
    // The check carries them, with the ones the checker names itself once.
    const filed = await store.checker({ action: 'checked', size: '30 min', id: recap, evidence: 'none (a look)', points: ['pass: a lamp at every bench', `ask: ${CHECKER_Q}`] })
    assert.equal(filed.ok, true, filed.why)
    assert.deepEqual((await item(store.dir, recap)).sections.get('Checked').filter(one => one.startsWith('- ask: ')),
      [`- ask: ${CHECKER_Q}`, `- ask: Should ${recap} show the date?`, `- ask: Is the page of ${recap} wide enough?`])
    // Once its task has ended the checker asks as any worker (the ask point's own ask), under the step.
    const after = await store.checker({ action: 'ask', of: recap, kind: 'look', title: 'Is the recap warm enough in the evening?' })
    assert.equal(after.ok, true, after.why)
    assert.equal(after.result.kept, undefined)
  } finally {
    await remove(store.dir)
  }
})

test('with the builder\'s ask open, the checker\'s ask joins it as a line with its options, advice and pictures', async () => {
  const store = await fresh()
  try {
    const { recap } = await twoHeld(store)
    await takeQa(store, await qaOf(store, recap))
    const built = await store.lamplighter({ action: 'ask', of: recap, kind: 'look', title: BUILDER_Q, pictures: ['art-inbox/recap/first.png'] })
    assert.equal(built.ok, true, built.why)
    const before = (await asksOf(store.dir)).length
    const joined = await store.checker({ action: 'ask', of: recap, kind: 'decide', title: 'Should the recap name the unfinished maps?', options: ['A yes', 'B no'], advice: 'A', pictures: ['art-inbox/recap/second.png'] })
    assert.equal(joined.ok, true, joined.why)
    assert.equal(joined.result.merged, built.result.id)
    assert.match(joined.result.text, new RegExp(`^${built.result.id} is open for the person already, under ${recap} \\(asked by Lamplighter\\)`))
    assert.equal((await asksOf(store.dir)).length, before)
    const one = await item(store.dir, built.result.id)
    assert.deepEqual(one.sections.get('Text').slice(-3), ['Also from the quality check (Checker): Should the recap name the unfinished maps?', '  Options: A yes | B no', '  Advised: A'])
    assert.equal(valueOf(one, 'Pictures'), 'art-inbox/recap/first.png, art-inbox/recap/second.png')
    assert.ok(one.sections.get('History').some(row => row.includes('also from the quality check (Checker)')))
    // The same question again adds nothing.
    const again = await store.checker({ action: 'ask', of: recap, kind: 'look', title: BUILDER_Q })
    assert.match(again.result.text, /asks this already/)
    assert.equal((await item(store.dir, built.result.id)).sections.get('Text').length, one.sections.get('Text').length)
  } finally {
    await remove(store.dir)
  }
})

test('a second question on a step with the person\'s ask open joins it, from any chat; not a do beside a question, not a blocking one, not the same chat\'s', async () => {
  const store = await fresh()
  try {
    const { recap } = await twoHeld(store)
    const first = await store.lamplighter({ action: 'ask', of: recap, kind: 'look', title: BUILDER_Q })
    assert.equal(first.ok, true, first.why)
    const count = async () => (await asksOf(store.dir)).length
    const base = await count()
    // The main chat's question joins; it is no quality check, so its line says who.
    const main = await store.keeper({ action: 'ask', of: recap, kind: 'decide', title: 'Should the recap come before the next goal?' })
    assert.equal(main.result.merged, first.result.id)
    assert.ok(textOf(await item(store.dir, first.result.id)).includes('Also from Keeper: Should the recap come before the next goal?'))
    assert.equal(await count(), base)
    // A do is an action to tick, not a line in a question: it stands as its own card.
    const todo = await store.keeper({ action: 'ask', of: recap, kind: 'do', title: 'Restart the board', text: 'So the recap shows.' })
    assert.equal(todo.ok, true, todo.why)
    assert.equal(todo.result.merged, undefined)
    assert.equal(await count(), base + 1)
    // A blocking question holds its step: its own card.
    const blocking = await store.lamplighter({ action: 'ask', of: recap, kind: 'provide', title: 'Which font for the recap heading?', blocking: true })
    assert.equal(blocking.result.merged, undefined)
    // The same chat's second question is its own card, as before.
    const own = await store.lamplighter({ action: 'ask', of: recap, kind: 'decide', title: 'Should the lamps wait for the weekend?' })
    assert.equal(own.ok, true, own.why)
    assert.equal(own.result.merged, undefined)
  } finally {
    await remove(store.dir)
  }
})

test('answeredBefore bites with the found step: the builder\'s question the person answered is refused with their answer, with no step given', async () => {
  const store = await fresh()
  try {
    const { recap } = await twoHeld(store)
    const first = await store.lamplighter({ action: 'ask', kind: 'look', title: BUILDER_Q })
    assert.equal(valueOf(await item(store.dir, first.result.id), 'Of'), recap)
    assert.equal((await store.person({ action: 'answer', id: first.result.id, verdict: 'reject', text: 'Too crowded, fewer maps.' })).ok, true)
    const again = await store.later(30 * MIN, 'Lamplighter')({ action: 'ask', kind: 'look', title: 'Is this recap page what you wanted to see before approving G60?' })
    assert.equal(again.ok, false)
    assert.equal(again.status, 409)
    assert.match(again.why, new RegExp(`^${recap}: the person answered this already on .* \\(${first.result.id}\\): "Rejected\\. Too crowded, fewer maps\\."`))
  } finally {
    await remove(store.dir)
  }
})
