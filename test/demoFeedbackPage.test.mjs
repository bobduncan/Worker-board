// B860, the popup clicked through the DOM harness (test/README-page-tests.md): Approve and Send back per part, a comment typed in
// the part, the side panel's answers, one Send that goes out only on the click, the problem a refusal shows, and the next round.
// Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { demoPage } from '../src/demo.mjs'
import { roundPage, withRound } from '../src/demoFeedback.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const list = () => ({
  goal: 'G6', title: 'The polish', step: 'B7',
  sections: [
    { kind: 'reached', rows: [{ title: '1. Lava', pictures: [{ kind: 'target', caption: 'target', path: 'a.png' }] }, { title: '2. Cliffs', pictures: [{ kind: 'target', caption: 'target', path: 'b.png' }] }] },
    { kind: 'not-reached', rows: [{ title: '3. Round shapes', pictures: [{ kind: 'final-not', caption: 'last try', path: 'c.png' }] }] },
  ],
})
const PATH = 'pictures/g6/demo.json'
const shown = (feedback = null, may = {}) => {
  const page = roundPage(demoPage(list(), 'pictures/g6'), feedback)
  return { ...page, feedback: { ...page.feedback, canSend: true, whyNot: null, ...may } }
}
const state = () => asSent(build([], undefined))

/** The page with the demo open; `give` is the page the board answers to GET /api/demo (a function of the requests, to change it). */
async function opened(give, post = () => reply({ round: 1, approved: 1, sentBack: 1, done: false, notedOn: 'B7' })) {
  const answers = request => {
    if (request.url.startsWith('/api/demo?')) return reply(typeof give === 'function' ? give() : give)
    if (request.url === '/api/demo-feedback') return post(request)
    return reply({})
  }
  const page = await openPage({ state: state(), answers, hash: `demo=${PATH}` })
  await settle(10)
  return page
}
const side = page => page.all('.demo-answer-words').map(one => one.textContent)

test('each part gets Approve, Send back and a comment; the side panel follows every click; nothing is sent before Send', async () => {
  const page = await opened(shown())
  try {
    assert.equal(page.all('.demo-row').length, 3)
    assert.deepEqual(side(page), ['not decided yet', 'not decided yet', 'not decided yet'])
    await page.click('[data-demo-verdict="approved"][data-demo-key="1. Lava"]')
    await page.click('[data-demo-verdict="sent-back"][data-demo-key="3. Round shapes"]')
    assert.deepEqual(side(page), ['approved', 'not decided yet', 'sent back: needs a comment'])
    await page.type('[data-demo-comment="3. Round shapes"]', 'still stepped')
    assert.deepEqual(side(page), ['approved', 'not decided yet', 'sent back: "still stepped"'])
    assert.deepEqual(page.all('.demo-feedback .is-on').map(one => one.textContent), ['Approve', 'Send back'])
    // A second click on the chosen button takes the choice back.
    await page.click('[data-demo-verdict="approved"][data-demo-key="1. Lava"]')
    assert.deepEqual(side(page), ['not decided yet', 'not decided yet', 'sent back: "still stepped"'])
    assert.deepEqual(page.sent('/api/demo-feedback'), [])
  } finally { await page.close() }
})

test('Send goes out once with the round, the decided parts and their comments; the popup then shows the next round with the answer\'s words', async () => {
  let now = shown()
  const page = await opened(() => now)
  try {
    await page.click('[data-demo-verdict="approved"][data-demo-key="1. Lava"]')
    await page.click('[data-demo-verdict="sent-back"][data-demo-key="3. Round shapes"]')
    await page.type('[data-demo-comment="3. Round shapes"]', 'still stepped')
    now = shown(withRound(null, 1, [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }], 'x'))
    await page.click('[data-demo-send]')
    await settle(10)
    assert.deepEqual(page.sent('/api/demo-feedback').map(one => one.body), [{
      path: PATH, round: 1,
      parts: [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }],
    }])
    assert.deepEqual(page.all('.demo-row').map(one => one.dataset.demoRow), ['2. Cliffs', '3. Round shapes'])
    assert.match(page.text('.demo-round'), /Round 2/)
    assert.match(page.text('.demo-folded'), /1\. Lava/)
    assert.match(page.text('.demo-said'), /still stepped/)
    assert.match(page.text('.demo-notice'), /Sent: 1 approved, 1 sent back/)
    assert.deepEqual(side(page), ['not decided yet', 'not decided yet'], 'round 2 starts without the old answers')
  } finally { await page.close() }
})

test('Send with nothing decided, or a part sent back without a comment, says so and sends nothing; a refusal of the board is shown', async () => {
  const page = await opened(shown(), () => reply('This round was sent already or is out of date: reload the demo.', 409))
  try {
    await page.click('[data-demo-send]')
    assert.match(page.text('.demo-problem'), /at least one part/)
    await page.click('[data-demo-verdict="sent-back"][data-demo-key="2. Cliffs"]')
    await page.click('[data-demo-send]')
    assert.match(page.text('.demo-problem'), /Say what to change in "2\. Cliffs"/)
    assert.deepEqual(page.sent('/api/demo-feedback'), [])
    await page.type('[data-demo-comment="2. Cliffs"]', 'sharper')
    assert.equal(page.all('.demo-problem').length, 0, 'typing clears the problem')
    await page.click('[data-demo-send]')
    await settle(10)
    assert.equal(page.sent('/api/demo-feedback').length, 1)
    assert.match(page.text('.demo-problem'), /sent already or is out of date/)
    assert.deepEqual(side(page), ['not decided yet', 'sent back: "sharper"', 'not decided yet'], 'the answers stay for another try')
  } finally { await page.close() }
})

test('a board that takes no feedback shows the reason and no buttons; a demo with every part approved says the recap is done', async () => {
  const off = await opened(shown(null, { canSend: false, whyNot: 'This board only shows.' }))
  try {
    assert.equal(off.all('.demo-feedback').length, 0)
    assert.equal(off.all('.demo-send').length, 0)
    assert.match(off.text('.demo-side'), /This board only shows\./)
  } finally { await off.close() }
  const all = withRound(null, 1, [['1. Lava'], ['2. Cliffs'], ['3. Round shapes']].map(([key]) => ({ key, verdict: 'approved', comment: '' })), 'x')
  const done = await opened(shown(all, { canSend: false }))
  try {
    assert.match(done.text('.demo-side'), /Every part is approved: the recap is done\./)
    assert.equal(done.all('.demo-row').length, 0)
  } finally { await done.close() }
})
