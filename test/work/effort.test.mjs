// B468: a step's effort level, given at its refine, and the words that have the main chat set a worker's chat to it.
// The person, 2026-10-21 (I52): "in order to save tokens, i need a task, before it's picked up to evaluate what effort
// level it needs. the worker will adjust to this new effort level". Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { AGAIN_MS, HOLD_MS, effortOf, effortPlan, effortWords, parseEffort, withEffort } from '../../src/work/effort.mjs'

const NOW = new Date(2026, 9, 21, 9, 0).getTime()

/** A step as the store reads it: head fields and sections. */
const step = (id, head = {}, sections = {}) => ({
  head: new Map(Object.entries({ Id: id, Kind: 'step', Title: `Step ${id}`, State: 'queued', ...head })),
  sections: new Map(Object.entries(sections)),
})
const itemsOf = (...steps) => new Map(steps.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, appSession: `local_${name.toLowerCase()}`, effort: 'xhigh', ...more })
const word = (chat, effort, usual, at, state = 'delivered') => ({ id: `${chat}-${effort}-${at}`, command: 'worker-effort', about: chat, effort, usual, at, state, text: 'set effort' })

test('an effort is a level of the app with a reason in one line', () => {
  assert.deepEqual(parseEffort('medium: a board fix in one hook, with tests'), { ok: true, level: 'medium', why: 'a board fix in one hook, with tests', line: 'medium · a board fix in one hook, with tests' })
  assert.equal(parseEffort('high · new art for a unit').line, 'high · new art for a unit')
  assert.equal(parseEffort('Low (a text fix)').line, 'low · a text fix')
  assert.equal(parseEffort('extra high: a rebuild of the store').level, 'xhigh')
  assert.equal(parseEffort('x-high - an unclear design').level, 'xhigh')
  assert.equal(parseEffort('MAX — the person asked for it').level, 'max')
  assert.equal(parseEffort(undefined), null)
  assert.equal(parseEffort('  '), null)
  assert.match(parseEffort('huge: a lot').why, /starts with its level, low, medium, high, xhigh, max/)
  assert.match(parseEffort('mediums: no level').why, /starts with its level/)
  assert.match(parseEffort('medium').why, /reason after its level/)
  assert.match(parseEffort(`low: ${'x'.repeat(201)}`).why, /at most 200 characters, this one has 201/)
})

test('a step without an effort counts as medium; its section goes before its refine line', () => {
  assert.deepEqual(effortOf(step('B1')), { level: 'medium', why: null, isSet: false })
  assert.deepEqual(effortOf(step('B1', {}, { Effort: ['low · a text fix'] })), { level: 'low', why: 'a text fix', isSet: true })
  assert.deepEqual(effortOf(step('B1', {}, { Refined: ['  Refined (round 1, by Advisor, 2026-10-21 09:00):', '  Effort: high · new art'] })), { level: 'high', why: 'new art', isSet: true })
  assert.equal(effortOf(step('B1', {}, { Effort: ['xhigh · a rebuild'], Refined: ['  Effort: low · old'] })).level, 'xhigh')
  // One the board cannot read counts as none.
  assert.deepEqual(effortOf(step('B1', {}, { Effort: ['quick · fast'] })), { level: 'medium', why: null, isSet: false })
})

test('a work tool without the field gives the effort as a line of what or of the questions', () => {
  assert.deepEqual(withEffort({ what: ['- A field', 'Effort: low: a text fix', 'Not in it: art'] }), { what: ['- A field', 'Not in it: art'], effort: 'low: a text fix' })
  assert.deepEqual(withEffort({ questions: ['- Effort: medium · a board fix', 'Should it fold? Advised: yes'] }), { questions: ['Should it fold? Advised: yes'], effort: 'medium · a board fix' })
  const given = { effort: 'high: art', what: ['Effort: low: a text fix'] }
  assert.equal(withEffort(given), given)
  assert.deepEqual(withEffort({ what: ['- A field'] }), { what: ['- A field'] })
})

test('the word to the main chat names the chat, the level, its session, the step and why', () => {
  const words = effortWords({ to: 'Main', chat: 'Units', session: 'local_abc-1', level: 'low', usual: 'xhigh', step: 'B7', why: 'B7 is Units\'s next step' })
  assert.equal(words.text, ['set effort', 'Chat: Units', 'Effort: low', 'Session: local_abc-1', 'Step: B7', "Why: B7 is Units's next step"].join('\n'))
  assert.equal(words.command, 'worker-effort')
  assert.deepEqual([words.to, words.about, words.effort, words.usual, words.forStep], ['Main', 'Units', 'low', 'xhigh', 'B7'])
  // Back to the usual level, without a step; a session id the board cannot trust is left out.
  const back = effortWords({ to: 'Main', chat: 'Units', session: 'a b', level: 'xhigh', usual: 'xhigh', step: null, why: 'back' })
  assert.equal(back.text, ['set effort', 'Chat: Units', 'Effort: xhigh', 'Why: back'].join('\n'))
})

test('a worker given a step asks the main chat for its level, and the line of the step waits until it is set', () => {
  const items = itemsOf(step('B7', { Owner: 'Units' }, { Effort: ['low · a text fix'] }))
  const deliveries = [{ id: 'B7', chat: 'Units' }]
  const plan = effortPlan({ items, lanes: [lane('Units'), lane('Main', { isMain: true })], deliveries, sent: [], now: NOW, main: 'Main' })
  // Without model ids in the settings, the word sets the effort alone (model per step).
  assert.deepEqual(plan.words, [{ to: 'Main', chat: 'Units', session: 'local_units', level: 'low', model: null, usual: 'medium', usualModel: null, step: 'B7', why: "B7 is Units's next step; its refine says low (a text fix)" }])
  assert.deepEqual([...plan.held], ['B7'])
  assert.deepEqual(plan.runs.get('Units'), { level: 'low', model: null, usual: 'medium', usualModel: null, step: 'B7', why: 'a text fix', modelWhy: null, isSet: false, asked: null, waitsFor: null })
  // Asked a minute ago: no second word, the line still waits.
  const asked = effortPlan({ items, lanes: [lane('Units')], deliveries, sent: [word('Units', 'low', 'xhigh', NOW - 60_000, 'taken')], now: NOW, main: 'Main' })
  assert.deepEqual(asked.words, [])
  assert.deepEqual([...asked.held], ['B7'])
  // Set: the line goes.
  const set = effortPlan({ items, lanes: [lane('Units', { effort: 'low' })], deliveries, sent: [word('Units', 'low', 'xhigh', NOW - 60_000)], now: NOW, main: 'Main' })
  assert.deepEqual([set.words, [...set.held]], [[], []])
  assert.equal(set.runs.get('Units').isSet, true)
  // Not set after a few minutes (the main chat busy, or the app asked the person): the line goes anyway.
  const late = effortPlan({ items, lanes: [lane('Units')], deliveries, sent: [word('Units', 'low', 'xhigh', NOW - HOLD_MS)], now: NOW, main: 'Main' })
  assert.deepEqual([late.words, [...late.held]], [[], []])
  // A word that went untaken goes once more only after half an hour.
  const lost = word('Units', 'low', 'xhigh', NOW - 10 * 60_000, 'expired')
  assert.deepEqual(effortPlan({ items, lanes: [lane('Units')], deliveries, sent: [lost], now: NOW, main: 'Main' }).words, [])
  assert.equal(effortPlan({ items, lanes: [lane('Units')], deliveries, sent: [{ ...lost, at: NOW - AGAIN_MS }], now: NOW, main: 'Main' }).words.length, 1)
})

test('a step refined without an effort runs at medium', () => {
  const items = itemsOf(step('B8', { Owner: 'Units', State: 'in progress' }))
  const plan = effortPlan({ items, lanes: [lane('Units')], sent: [], now: NOW, main: 'Main' })
  assert.equal(plan.words[0].level, 'medium')
  assert.equal(plan.words[0].why, "B8 is Units's step; its refine gives no effort, so medium")
  // The step is no delivery: nothing waits.
  assert.deepEqual([...plan.held], [])
})

test('a worker that holds no step goes back to its usual level, only after a word of the board changed it', () => {
  const done = itemsOf(step('B7', { Owner: 'Units', State: 'review' }, { Effort: ['low · a text fix'] }))
  // Model per step: the usual level is the settings' (medium unless set), not what the chat ran at before the board's word.
  const back = effortPlan({ items: done, lanes: [lane('Units', { effort: 'low' })], sent: [word('Units', 'low', 'high', NOW - 3_600_000)], now: NOW, main: 'Main' })
  assert.deepEqual(back.words, [{ to: 'Main', chat: 'Units', session: 'local_units', level: 'medium', model: null, usual: 'medium', usualModel: null, step: null, why: 'Units holds no step now: back to its usual level' }])
  assert.equal(effortPlan({ items: done, lanes: [lane('Units', { effort: 'low' })], sent: [word('Units', 'low', 'high', NOW - 3_600_000)], now: NOW, main: 'Main', usual: { effort: 'high' } }).words[0].level, 'high')
  // Never changed by the board: what it runs at is its own.
  assert.deepEqual(effortPlan({ items: done, lanes: [lane('Units', { effort: 'low' })], sent: [], now: NOW, main: 'Main' }).words, [])
  // The board's last word set it to its usual level, and it runs at another now: the person's own.
  assert.deepEqual(effortPlan({ items: done, lanes: [lane('Units', { effort: 'low' })], sent: [word('Units', 'medium', 'medium', NOW - 3_600_000)], now: NOW, main: 'Main' }).words, [])
})

test('a report followed by the next step asks once, for the next step', () => {
  const items = itemsOf(
    step('B7', { Owner: 'Units', State: 'review' }, { Effort: ['low · a text fix'] }),
    step('B9', { Owner: 'Units', State: 'queued', 'Blocked by': 'B3' }, { Effort: ['max · blocked'] }),
    step('B3', { State: 'in progress' }),
    step('B10', { Owner: 'Units', State: 'queued' }, { Effort: ['high · new art'] }),
  )
  const plan = effortPlan({ items, lanes: [lane('Units', { effort: 'low' })], sent: [word('Units', 'low', 'xhigh', NOW - 3_600_000)], now: NOW, main: 'Main' })
  assert.deepEqual(plan.words.map(one => [one.level, one.step]), [['high', 'B10']])
})

test('no word without a main chat, for the main chat, the partner or a leftover, nor for a chat whose effort is unknown', () => {
  const items = itemsOf(step('B7', { Owner: 'Units' }, { Effort: ['low · a text fix'] }), step('B8', { Owner: 'Advisor', State: 'in progress' }, { Effort: ['low · x'] }))
  const deliveries = [{ id: 'B7', chat: 'Units' }]
  const none = effortPlan({ items, lanes: [lane('Units')], deliveries, sent: [], now: NOW, main: null })
  assert.deepEqual([none.words, [...none.held]], [[], []])
  assert.equal(none.runs.get('Units').level, 'low')
  const skipped = effortPlan({ items, lanes: [lane('Units', { isLeftover: true }), lane('Advisor')], deliveries, sent: [], now: NOW, main: 'Main', skip: ['Advisor'] })
  assert.deepEqual(skipped.words, [])
  const unknown = effortPlan({ items, lanes: [lane('Units', { effort: null })], deliveries, sent: [], now: NOW, main: 'Main' })
  assert.deepEqual([unknown.words, [...unknown.held]], [[], []])
  assert.equal(unknown.runs.get('Units').isSet, false)
})

test('the review: only the newest word counts as asked, so a level asked earlier is asked again after another', () => {
  const items = itemsOf(step('B12', { Owner: 'Units' }, { Effort: ['medium · a board fix'] }))
  // Medium at 10:00 for an earlier step, high at 10:12 for the next; now a medium step again.
  const sent = [word('Units', 'medium', 'xhigh', NOW - 25 * 60_000), word('Units', 'high', 'xhigh', NOW - 13 * 60_000)]
  const plan = effortPlan({ items, lanes: [lane('Units', { effort: 'high' })], deliveries: [{ id: 'B12', chat: 'Units' }], sent, now: NOW, main: 'Main' })
  assert.deepEqual(plan.words.map(one => [one.level, one.usual, one.step]), [['medium', 'medium', 'B12']])
  assert.deepEqual([...plan.held], ['B12'])
})

test('the review: the next step waits also while its worker is busy, so its own pull does not take it before it is set', () => {
  const items = itemsOf(step('B7', { Owner: 'Units', State: 'review' }, { Effort: ['low · x'] }), step('B13', { Owner: 'Units' }, { Effort: ['high · new art'] }))
  const plan = effortPlan({ items, lanes: [lane('Units', { effort: 'low' })], deliveries: [], sent: [word('Units', 'low', 'xhigh', NOW - 3_600_000)], now: NOW, main: 'Main' })
  assert.deepEqual([...plan.held], ['B13'])
  assert.deepEqual(plan.words.map(one => [one.level, one.usual]), [['high', 'medium']])
})

test('the review: the usual level is the settings\', also beside an older word that kept another, and a lost word back goes again', () => {
  const items = itemsOf(step('B14', { Owner: 'Units' }, { Effort: ['low · a text fix'] }))
  // An older word (B468) kept xhigh as the chat's usual level: the next step's word names the settings' medium.
  const pending = effortPlan({ items, lanes: [lane('Units', { effort: 'xhigh' })], sent: [word('Units', 'xhigh', 'xhigh', NOW - 60_000, 'taken')], now: NOW, main: 'Main' })
  assert.deepEqual(pending.words.map(one => [one.level, one.usual]), [['low', 'medium']])
  // No step any more and the word back was lost: it goes again once its half hour is over.
  const none = itemsOf(step('B14', { Owner: 'Units', State: 'done' }, { Effort: ['low · a text fix'] }))
  const lost = word('Units', 'medium', 'medium', NOW - 40 * 60_000, 'expired')
  assert.deepEqual(effortPlan({ items: none, lanes: [lane('Units', { effort: 'low' })], sent: [word('Units', 'low', 'medium', NOW - 3_600_000), lost], now: NOW, main: 'Main' }).words.map(one => one.level), ['medium'])
  // The word back arrived and the chat runs at another level now: the person's own, left alone.
  const own = word('Units', 'medium', 'medium', NOW - 40 * 60_000, 'delivered')
  assert.deepEqual(effortPlan({ items: none, lanes: [lane('Units', { effort: 'high' })], sent: [own], now: NOW, main: 'Main' }).words, [])
  // A word back of before (to xhigh, B468's usual) was no word back to the settings' level: the chat goes to medium.
  const old = word('Units', 'xhigh', 'xhigh', NOW - 40 * 60_000, 'delivered')
  assert.deepEqual(effortPlan({ items: none, lanes: [lane('Units', { effort: 'xhigh' })], sent: [old], now: NOW, main: 'Main' }).words.map(one => one.level), ['medium'])
})

test('the review: an effort line in questions or what given as one text', () => {
  assert.deepEqual(withEffort({ questions: 'Effort: low: a text fix\nShould it fold? Advised: yes' }), { questions: ['Should it fold? Advised: yes'], effort: 'low: a text fix' })
  assert.deepEqual(withEffort({ what: 'A field' }), { what: 'A field' })
})
