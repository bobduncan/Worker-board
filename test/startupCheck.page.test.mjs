// The start-up check on the page (plan task 7): the Overview header's row. While the check runs: a loader and "Checking N chats…";
// done: the line with its time and a "Check everything" button, amber only when the line asks the person for something. During
// the check of a board start, no stale alarm: the wake notice is not drawn and a chat whose wake failed reads Checking. The
// button posts /api/check and stays off until the next state shows the check over. The state is the one the board sends
// (`state.check`, src/startupCheckRun.mjs); the tests read the drawn words and classes (test/README-page-tests.md).
import assert from 'node:assert/strict'
import test from 'node:test'

import { openPage, reply } from './pageHarness.mjs'
import { asSent, build, NOW } from './partnerState.mjs'

const BASE = asSent(build([]))
const check = (extra = {}) => ({ at: NOW - 5_000, trigger: 'start', running: false, total: 6, reachable: 6, line: 'All 6 chats reachable · checked 22:30', tone: 'quiet', fixed: [], elsewhere: [], restartNeeded: [], nowhere: [], tooSlow: false, ...extra })
const NOTICE = { tone: 'attention', text: 'could not wake Worker 1: the app did not start it; open its chat' }
const stateWith = (checkNow, more = {}) => ({ ...BASE, check: checkNow, ...more })
const row = page => page.find('#check-row')

test('running: a loader and "Checking 6 chats…", no button yet', async () => {
  const page = await openPage({ state: stateWith(check({ running: true })) })
  try {
    assert.equal(row(page).hidden, false)
    assert.equal(page.text('#check-row'), 'Checking 6 chats…')
    assert.ok(page.find('#check-row .check-spinner'))
    assert.equal(page.all('#check-row button').length, 0)
  } finally { await page.close() }
})

test('done: the line with its time and a Check everything button; quiet when nothing is asked of the person, amber when it is', async () => {
  const quiet = await openPage({ state: stateWith(check()) })
  try {
    assert.equal(quiet.text('#check-row .check-line'), 'All 6 chats reachable · checked 22:30')
    assert.equal(quiet.find('#check-row button').textContent, 'Check everything')
    assert.equal(row(quiet).classList.contains('is-attention'), false)
  } finally { await quiet.close() }
  const line = '4 of 6 chats reachable · checked 22:30 · Worker 1\'s and Worker 5\'s chats are in your other Claude account: run /reimport-chats, then restart the app'
  const amber = await openPage({ state: stateWith(check({ line, tone: 'attention', reachable: 4, elsewhere: ['Worker 1', 'Worker 5'] })) })
  try {
    assert.equal(amber.text('#check-row .check-line'), line)
    assert.equal(row(amber).classList.contains('is-attention'), true)
  } finally { await amber.close() }
})

test('no check yet (a demo, a board that only shows): the row is not there', async () => {
  const page = await openPage({ state: { ...BASE, check: null } })
  try { assert.equal(row(page).hidden, true) } finally { await page.close() }
})

test('during the check of a board start the wake notice is not drawn and a failed chat reads Checking; after it, or for a button check, the alarm is there', async () => {
  const base = stateWith(null, { wakeNotice: NOTICE })
  const running = await openPage({ state: { ...base, check: check({ running: true, trigger: 'start' }) } })
  try {
    assert.equal(running.all('.nobody-runs').length, 0, 'no stale alarm while the start check runs')
    assert.doesNotMatch(running.text('body'), /ould not wake Worker 1/)
  } finally { await running.close() }
  const done = await openPage({ state: { ...base, check: check() } })
  try { assert.match(done.text('.nobody-runs'), /ould not wake Worker 1/) } finally { await done.close() }
  const button = await openPage({ state: { ...base, check: check({ running: true, trigger: 'button' }) } })
  try { assert.match(button.text('.nobody-runs'), /ould not wake Worker 1/, 'the alarm stays for a check the person asked for') } finally { await button.close() }
})

test('the button posts /api/check with the page token and stays off until the next state shows the check over', async () => {
  let current = stateWith(check())
  const page = await openPage({ now: NOW, state: () => current, answers: request => (request.url === '/api/check' ? reply({ running: true, at: NOW }) : reply({})) })
  try {
    const button = () => page.find('#check-row button')
    assert.equal(button().disabled, false)
    await page.click('#check-row button')
    assert.equal(page.sent('/api/check').length, 1)
    assert.equal(page.sent('/api/check')[0].headers['X-Board-Token'], 'test-token')
    assert.equal(button().disabled, true, 'off at once, before the board has answered with running')
    current = stateWith(check({ running: true, trigger: 'button' }))
    await page.advance(31_000)
    assert.equal(page.text('#check-row'), 'Checking 6 chats…')
    current = stateWith(check({ trigger: 'button', at: NOW + 40_000 }))
    await page.advance(31_000)
    assert.equal(page.find('#check-row button').disabled, false, 'on again once the check is over')
  } finally { await page.close() }
})

test('during the check of a board start a chat whose wake failed reads Checking, not its failure; after the check its failure words are back', async () => {
  const failed = { kind: 'wake failed', id: null, text: 'could not wake: the app did not start it', button: null }
  const withFlag = checkNow => ({ ...BASE, check: checkNow, chats: BASE.chats.map(lane => (lane.name === 'Digger' ? { ...lane, flags: [failed, ...(lane.flags ?? [])] } : lane)) })
  const during = await openPage({ state: withFlag(check({ running: true, trigger: 'start' })) })
  try {
    assert.doesNotMatch(during.text('body'), /could not wake: the app did not start it/)
    assert.match(during.text('body'), /Checking/)
  } finally { await during.close() }
  const after = await openPage({ state: withFlag(check()) })
  try { assert.match(after.text('body'), /could not wake: the app did not start it/) } finally { await after.close() }
})
