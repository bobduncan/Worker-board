// B775, the page's part: "Find obsolete items" under Needs your attention. The button starts the check, reads "The Advisor
// is checking" while the partner judges and "Try again" when it did not answer in 15 minutes; the answer is a list (verdict,
// why, evidence, a tick, obsolete ones ticked) and "Close the N ticked" sends exactly the ticked ids. The page is only
// read and clicked through the DOM harness (test/README-page-tests.md). Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const ROWS = [
  { id: 'Q1', kind: 'refine', title: 'Number or bar?', of: 'B12', verdict: 'obsolete', why: 'B12 was built since', evidence: 'commit abc1234 names B12', ticked: true },
  { id: 'Q5', kind: 'do', title: 'Restart the board', of: null, verdict: 'obsolete', why: 'the outage ended', evidence: 'the board restarted since', ticked: true },
  { id: 'Q4', kind: 'refine', title: 'Which icons?', of: 'B13', verdict: 'unsure', why: 'B13 is at work', evidence: 'its worker wrote an hour ago', ticked: false },
  { id: 'Q6', kind: 'ask', title: 'Thick or thin?', of: 'B14', verdict: 'open', why: 'its worker still waits', evidence: 'B14 is waiting on you', ticked: false },
]
const view = (more = {}) => ({ state: 'none', at: null, openCount: 4, rows: [], last: null, canCheck: true, whyNot: null, ...more })
const garden = obsolete => ({ ...asSent(build([], undefined)), obsolete })
const POST = { ok: true }

test('with open items and no check the button reads "Find obsolete items"; a click asks the board to start the check', async () => {
  const page = await openPage({ state: garden(view()) })
  try {
    const button = page.find('[data-obsolete="check"]')
    assert.equal(button.textContent, 'Find obsolete items')
    assert.equal(button.disabled, false)
    assert.match(page.text('.obsolete-head small'), /4 open items here/)
    await page.click('[data-obsolete="check"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'obsolete-check' }])
    assert.equal(page.all('.obsolete-row').length, 0)
  } finally { await page.close() }
})

test('with nothing open and no check there is no part; a board with no partner shows the button off, saying why', async () => {
  const none = await openPage({ state: garden(view({ openCount: 0 })) })
  try { assert.equal(none.all('.obsolete-check').length, 0) } finally { await none.close() }
  const off = await openPage({ state: garden(view({ canCheck: false, whyNot: 'No partner chat is on the board to judge the items.' })) })
  try {
    assert.equal(off.find('[data-obsolete="check"]').disabled, true)
    assert.equal(off.find('[data-obsolete="check"]').getAttribute('title'), 'No partner chat is on the board to judge the items.')
  } finally { await off.close() }
})

test('while the Advisor checks the button says so and is off; late, it says the Advisor did not answer in 15 minutes and offers Try again', async () => {
  const checking = await openPage({ state: garden(view({ state: 'checking', at: 1 })) })
  try {
    assert.equal(checking.find('[data-obsolete="check"]').textContent, 'The Advisor is checking')
    assert.equal(checking.find('[data-obsolete="check"]').disabled, true)
  } finally { await checking.close() }
  const late = await openPage({ state: garden(view({ state: 'late', at: 1 })) })
  try {
    assert.equal(late.find('[data-obsolete="check"]').textContent, 'Try again')
    assert.equal(late.find('[data-obsolete="check"]').disabled, false)
    assert.match(late.text('.obsolete-head small'), /did not answer in 15 minutes/)
    await late.click('[data-obsolete="check"]')
    assert.deepEqual(late.sent('/api/work').map(one => one.body), [{ action: 'obsolete-check' }])
  } finally { await late.close() }
})

test('the answer is a list: verdict, why, evidence, a tick (obsolete ticked, unsure and open not), and Close the N ticked sends the ticked ids only', async () => {
  const page = await openPage({ state: garden(view({ state: 'done', at: 1, rows: ROWS })), answers: () => ({ status: 200, body: JSON.stringify(POST), headers: { 'Content-Type': 'application/json' } }) })
  try {
    const rows = page.all('.obsolete-row')
    assert.equal(rows.length, 4)
    assert.deepEqual(rows.map(row => row.querySelector('.task-code').textContent), ['Q1', 'Q5', 'Q4', 'Q6'])
    assert.deepEqual(rows.map(row => row.querySelector('.obsolete-verdict').textContent), ['Obsolete', 'Obsolete', 'Unsure', 'Still open'])
    assert.deepEqual(rows.map(row => row.querySelector('input').checked), [true, true, false, false])
    assert.equal(rows[0].querySelector('.obsolete-why').textContent, 'B12 was built since')
    assert.equal(rows[0].querySelector('.obsolete-evidence').textContent, 'commit abc1234 names B12')
    assert.equal(page.find('.obsolete-close').textContent, 'Close the 2 ticked')
    // The person unticks one and ticks an unsure one: the close names exactly those ticked.
    await page.click('[data-obsolete-tick="Q5"]')
    await page.click('[data-obsolete-tick="Q4"]')
    assert.equal(page.find('.obsolete-close').textContent, 'Close the 2 ticked')
    assert.deepEqual(page.all('.obsolete-row').map(row => row.querySelector('input').checked), [true, false, true, false])
    await page.click('[data-obsolete="close"]')
    assert.deepEqual(page.sent('/api/work').map(one => one.body), [{ action: 'obsolete-close', ids: ['Q1', 'Q4'] }])
  } finally { await page.close() }
})

test('with nothing ticked Close is off and sends nothing', async () => {
  const page = await openPage({ state: garden(view({ state: 'done', at: 1, rows: ROWS.filter(row => row.verdict !== 'obsolete') })) })
  try {
    assert.equal(page.find('.obsolete-close').textContent, 'Close the 0 ticked')
    assert.equal(page.find('.obsolete-close').disabled, true)
    await page.click('[data-obsolete="close"]')
    assert.deepEqual(page.sent('/api/work'), [])
  } finally { await page.close() }
})

test('after a close nothing is left: the part says how many were closed', async () => {
  const page = await openPage({ state: garden(view({ state: 'done', at: 1, openCount: 0, rows: [], last: { at: 2, closed: 7 } })) })
  try {
    assert.match(page.text('.obsolete-none'), /Closed 7\. Nothing is left to look at\./)
    assert.equal(page.find('[data-obsolete="check"]').textContent, 'Check again')
  } finally { await page.close() }
})

test('a refused close shows its problem under the list and keeps the ticks', async () => {
  const page = await openPage({ state: garden(view({ state: 'done', at: 1, rows: ROWS })), answers: () => reply('Q1: not in the check; nothing was closed.', 400) })
  try {
    await page.click('[data-obsolete="close"]')
    assert.match(page.text('.obsolete-check .problem'), /Not sent: Q1: not in the check; nothing was closed\./)
    assert.equal(page.all('.obsolete-row input').filter(box => box.checked).length, 2)
  } finally { await page.close() }
})
