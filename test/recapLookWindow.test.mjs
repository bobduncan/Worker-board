// G95 (the person, 2026-11-12, on the Focus page: "why do i get asked for a recap now. the goal just started. and i dont even see
// pictures in the recap?"): the window of a look kept for the goal's recap (the live Q740, "Do the twelve character cards fit each
// unit?", options A, B and C) shows its pictures large and takes its options as choices; any routed ask with pictures shows them.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, settle } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm', '    Goal definition agreed: 2026-10-18 10:00',
  '    Part: Block 1 · about 1 h · steps B9 · done when: line 1', '    How agreed: 2026-10-18 11:00', ''].join('\n')
const CARDS = 'art-inbox/G6/B9/character-cards.png'
const OPTIONS = ['A The cards fit; Knight walk to 14 frames', 'B The cards fit; Knight keeps 8 frames', 'C Change a card (name it and what)']
const step = parseItem(`Id: B9\nKind: step\nTitle: Character cards\nState: in progress\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)
// Q740's shape, word for word where it matters: a worker's look with a picture and options, kept for the recap.
const kept = (more = '') => parseItem(`Id: Q740\nKind: ask\nTitle: Do the twelve character cards fit each unit?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 30 * MIN)}\nFiled: ${NOW - 30 * MIN}\nPictures: ${CARDS}\nAsks: look\nBlocking: no\nOf: B9\nOptions: ${OPTIONS.join(' | ')}\nAdvice: A\nRoute: recap\n${more}\n## Text\nDo the twelve character cards fit each unit?\nContext: one card per unit.\n\n## Route\nAutopilot keeps this look for the goal's recap\n`)
const stateOf = items => asSent(build(items, undefined, GOALS, { recaps: [], goalRecap: null, config: ON }))

async function windowOf(items, id = 'Q740') {
  const page = await openPage({ state: stateOf(items), hash: `details=${id}` })
  await settle(10)
  return page
}

test('the kept look\'s window shows its picture large, before the answer, and no second list of its options', async () => {
  const state = stateOf([step, kept()])
  assert.deepEqual(state.routedAway.map(one => [one.id, one.isKept, one.pictures]), [['Q740', true, [CARDS]]])
  const page = await windowOf([step, kept()])
  try {
    assert.equal(page.find('#details').open, true)
    assert.deepEqual(page.all('#details .references .picture').map(node => node.dataset.zoom), [CARDS], 'the picture, large (the window\'s references)')
    assert.match(page.text('#details'), /The picture/)
    assert.equal(page.all('#details .partner-ask-options').length, 0, 'the options stand once: as the answer\'s choices')
  } finally { await page.close() }
})

test('its options are choices: Looks right needs a pick and sends it with the verdict; Send back sends the pick and the note', async () => {
  const page = await windowOf([step, kept()])
  try {
    const picks = page.all('#details [data-look-pick]')
    assert.deepEqual(picks.map(node => node.value), OPTIONS)
    assert.deepEqual(page.all('#details .look-answer-pick').map(node => node.textContent), [`${OPTIONS[0]} (advised)`, OPTIONS[1], OPTIONS[2]])
    // Looks right without a pick: nothing is sent, the window says why.
    await page.click('#details [data-look-answer="approve"]')
    assert.deepEqual(page.sent('/api/work'), [])
    assert.match(page.text('#details'), /Pick one of the options first\./)
    // B: the cards fit, the Knight keeps 8 frames.
    await page.change('#details [data-look-pick][value^="B "]', true)
    assert.equal(page.find('#details [data-look-pick][value^="B "]').checked, true, 'the pick stays after the window is drawn again')
    await page.click('#details [data-look-answer="approve"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'answer', id: 'Q740', verdict: 'approve', text: OPTIONS[1] }])
  } finally { await page.close() }
  const back = await windowOf([step, kept()])
  try {
    await back.change('#details [data-look-pick][value^="C "]', true)
    await back.type('#details .look-answer-note', 'The Golem walks too slow.')
    await back.click('#details [data-look-answer="reject"]')
    assert.deepEqual(back.sent('/api/work').map(one => one.body), [{ action: 'answer', id: 'Q740', verdict: 'reject', text: `${OPTIONS[2]}\nThe Golem walks too slow.` }])
  } finally { await back.close() }
})

test('a kept look without options keeps its two buttons and needs no pick; a note goes as it did', async () => {
  const bare = parseItem(`Id: Q741\nKind: ask\nTitle: Does the walk read?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 30 * MIN)}\nFiled: ${NOW - 30 * MIN}\nPictures: ${CARDS}\nAsks: look\nBlocking: no\nOf: B9\nRoute: recap\n\n## Route\nAutopilot keeps this look for the goal's recap\n`)
  const page = await windowOf([step, bare], 'Q741')
  try {
    assert.equal(page.all('#details [data-look-pick]').length, 0)
    assert.deepEqual(page.all('#details .references .picture').map(node => node.dataset.zoom), [CARDS])
    await page.type('#details .look-answer-note', 'Fine.')
    await page.click('#details [data-look-answer="approve"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'answer', id: 'Q741', verdict: 'approve', text: 'Fine.' }])
  } finally { await page.close() }
})

test('every routed ask with pictures shows them in its window: one with the main chat too', async () => {
  const toMain = parseItem(`Id: Q742\nKind: ask\nTitle: Which card frame?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 30 * MIN)}\nFiled: ${NOW - 30 * MIN}\nPictures: ${CARDS}, art-inbox/G6/B9/frames.png\nAsks: decide\nBlocking: no\nOf: B9\nOptions: A thin | B thick\nAdvice: A\nRoute: main\n`)
  const page = await windowOf([step, toMain], 'Q742')
  try {
    assert.deepEqual(page.all('#details .references .picture').map(node => node.dataset.zoom), [CARDS, 'art-inbox/G6/B9/frames.png'])
    assert.match(page.text('#details'), /The pictures/)
    assert.equal(page.all('#details .partner-ask-options li').length, 2, 'a routed ask the person does not answer here keeps its options list')
  } finally { await page.close() }
})
