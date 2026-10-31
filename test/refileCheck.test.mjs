// B449: G11's re-check found B364, B383 and B376 left in review for 31 to 35 hours after the person answered the one
// point of their result check that was theirs, because nothing filed the check again or woke the partner. The person's
// answer to the last open ask under a step whose result check waits for them now files the check by itself: a yes passes
// the ask points and closes the step, a no fails them and makes a fix step, words the board cannot read make the step's
// Quality Assurance task (T9.1.1), whose worker files the check. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../src/work/api.mjs'
import { queueFor } from './queueFor.mjs'
import { checkedBy } from './qaKit.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { answerReading } from '../src/work/resultCheck.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const MIN = 60_000
const STAMP = new Date(2026, 9, 19, 9, 0).getTime()
const ROLES = { Keeper: 'main', Lamplighter: 'worker', Checker: 'worker', Partner: 'advisor' }
const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Trim the wicks (for Lamplighter; about 1 h)', ''].join('\n')

/** A step in review whose result check waits for the person: one point passes, one is theirs, and its ask is open. */
async function waiting() {
  const dir = await mkdtemp(join(tmpdir(), 'work-refile-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: STAMP }), undefined, { now: STAMP })
  let clock = STAMP + MIN
  const ctx = () => ({ dir, now: (clock += MIN), prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Lamplighter']), chats: Object.keys(ROLES) })
  const as = chat => body => workApi({ chat, ...body }, ctx())
  const server = body => workApi(body, { ...ctx(), as: 'server' })
  const store = { dir, keeper: as('Keeper'), lamplighter: as('Lamplighter'), checker: as('Checker'), partner: as('Partner'), server, person: body => workApi(body, { ...ctx(), as: 'person' }) }
  const made = await store.partner({ action: 'new', title: 'Light the lamps', activity: 'Lamps', goal: 'G3', text: 'Warm light.', summary: 'A warm lamp on every path.', size: '1 h', what: ['a lamp at every bench', 'the glow feels warm'] })
  const id = made.result.id
  assert.equal((await queueFor(dir, id, 'Lamplighter', { now: clock })).ok, true)
  assert.equal((await store.lamplighter({ action: 'take', minutes: 30, id, branch: 'b3-lamps' })).ok, true)
  assert.equal((await store.lamplighter({ action: 'report', id, result: 'Every bench has a lamp.', merged: 'c0ffee1' })).ok, true)
  assert.equal((await store.server({ action: 'check', id, passed: true, lines: ['branch gone'] })).ok, true)
  const checked = await checkedBy({ as, server, dir, now: clock }, id, { evidence: 'pictures/b3/evidence.png', points: ['pass: a lamp at every bench', 'ask: the glow feels warm'] })
  assert.equal(checked.ok, true, checked.why)
  const asked = await store.checker({ action: 'ask', of: id, kind: 'look', blocking: false, title: 'Does the glow feel warm?', text: 'Look at the picture.' })
  assert.equal(asked.ok, true, asked.why)
  return { ...store, id, ask: asked.result.id, close: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const history = one => one.sections.get('History').join('\n')

test('a yes to the ask point passes it and closes the step; nobody needs waking', async () => {
  const store = await waiting()
  try {
    assert.equal(valueOf(await item(store.dir, store.id), 'State'), 'review')
    const done = await store.person({ action: 'answer', id: store.ask, verdict: 'approve', text: 'Looks right' })
    assert.equal(done.ok, true, done.why)
    assert.equal(done.result.wakePartner, undefined)
    const step = await item(store.dir, store.id)
    assert.equal(valueOf(step, 'State'), 'done')
    assert.match(history(step), /result check passed: 2 of 2 points pass/)
    assert.ok(step.sections.get('Checked').includes('- pass: the glow feels warm'), step.sections.get('Checked').join('\n'))
  } finally {
    await store.close()
  }
})

test('a no fails the ask point with their words and makes a fix step for the worker; the step waits in review', async () => {
  const store = await waiting()
  try {
    const done = await store.person({ action: 'answer', id: store.ask, verdict: 'reject', text: 'Too cold' })
    assert.equal(done.ok, true, done.why)
    assert.match(done.result.fix, /^B\d+$/)
    const step = await item(store.dir, store.id)
    assert.equal(valueOf(step, 'State'), 'review')
    assert.match(history(step), new RegExp(`result check failed: 1 of 2 points pass; fix ${done.result.fix} for Lamplighter`))
    const fix = await item(store.dir, done.result.fix)
    // Redesign Part 2: on the ready list for nobody yet; a follow-up of its builder for a while (work/handOut.mjs).
    assert.deepEqual([valueOf(fix, 'State'), valueOf(fix, 'Owner'), valueOf(fix, 'Fix of')], ['refined', null, store.id])
    assert.match(fix.sections.get('Summary').join(' '), /the glow feels warm \(the person said: Rejected\. Too cold\)/)
  } finally {
    await store.close()
  }
})

test('words the board cannot read make a Quality Assurance task for the step, with their words; the check is left to its worker', async () => {
  const store = await waiting()
  try {
    const done = await store.person({ action: 'answer', id: store.ask, text: 'Warm, but make it a bit more orange' })
    assert.equal(done.ok, true, done.why)
    assert.equal(done.result.fix, undefined)
    assert.equal(done.result.wakePartner, undefined)
    const qa = await item(store.dir, done.result.qa)
    assert.equal(valueOf(qa, 'Checks'), store.id)
    assert.equal(valueOf(await item(store.dir, store.id), 'State'), 'review')
    // The first task ended with the first check: this is a task of its own, with the person's words and why it comes.
    assert.equal(valueOf(qa, 'State'), 'refined')
    assert.ok(qa.sections.get('Context').some(line => line.trim() === 'The person said: Warm, but make it a bit more orange'))
    assert.ok(qa.sections.get('Context').some(line => line.trim() === 'Why: its ask point is answered: file its check again'))
  } finally {
    await store.close()
  }
})

test('a step with another ask still open waits for it', async () => {
  const store = await waiting()
  try {
    const second = await store.partner({ action: 'ask', of: store.id, kind: 'look', blocking: false, title: 'And the shade?', text: 'Look again.' })
    assert.equal(second.ok, true, second.why)
    const first = await store.person({ action: 'answer', id: store.ask, verdict: 'approve' })
    assert.equal(first.ok, true, first.why)
    assert.deepEqual([first.result.fix, first.result.wakePartner, first.result.qa], [undefined, undefined, undefined])
    assert.equal(valueOf(await item(store.dir, store.id), 'State'), 'review')
  } finally {
    await store.close()
  }
})

test('the answer reads as yes, no, or neither', () => {
  for (const words of ['Approved.', 'Approved. Looks right', 'Done.', 'yes', 'Keep it', 'ok']) assert.equal(answerReading(words), 'yes', words)
  for (const words of ['Rejected. Too cold', 'no', 'No, redo it']) assert.equal(answerReading(words), 'no', words)
  for (const words of ['Approved. but darker', 'Nothing to add', 'B', '', 'Make the lamps bigger']) assert.equal(answerReading(words), null, words)
  assert.equal(answerReading(['Approved.', 'Fine']), 'yes')
})
