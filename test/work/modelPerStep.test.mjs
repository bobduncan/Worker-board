// Model per step (the token-saving plan, step 2). The person, 2026-10-23: "workers Sonnet by default, Opus only for
// steps the Advisor marks hard (architecture, the board's core, unclear bugs)". A step names its model family at the
// refine with its effort; the main chat sets both before the step's line goes to its worker; between steps a worker
// runs at the settings' usual setting, Sonnet and medium. Made-up samples and model ids only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { configProblem, parseConfig } from '../../src/config.mjs'
import { AGAIN_MS, HOLD_MS, effortPlan, effortWords, modelOf, parseModel, runSettings, sameModel, withModel } from '../../src/work/effort.mjs'

const NOW = new Date(2026, 9, 23, 9, 0).getTime()
const MODELS = { sonnet: 'claude-sonnet-test', opus: 'claude-opus-test' }

const step = (id, head = {}, sections = {}) => ({
  head: new Map(Object.entries({ Id: id, Kind: 'step', Title: `Step ${id}`, State: 'queued', ...head })),
  sections: new Map(Object.entries(sections)),
})
const itemsOf = (...steps) => new Map(steps.map(one => [one.head.get('Id'), one]))
/** A worker as the board reads it: the app's file says it runs on Opus at extra high unless told otherwise. */
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, appSession: `local_${name.toLowerCase()}`, effort: 'xhigh', model: MODELS.opus, lastAnswer: null, ...more })
const word = (chat, effort, model, at, state = 'delivered', forStep = 'B7') => ({ id: `${chat}-${effort}-${at}`, command: 'worker-effort', about: chat, effort, model, usual: 'medium', usualModel: MODELS.sonnet, forStep, at, state, text: 'set model and effort' })
const plan = more => effortPlan({ now: NOW, main: 'Main', models: MODELS, sent: [], ...more })

test('a model is sonnet or opus with a reason in one line', () => {
  assert.deepEqual(parseModel('opus: a guard of the work store'), { ok: true, family: 'opus', why: 'a guard of the work store', line: 'opus · a guard of the work store' })
  assert.equal(parseModel('Sonnet · a text fix').line, 'sonnet · a text fix')
  assert.equal(parseModel('OPUS (an unclear bug, seen twice)').line, 'opus · an unclear bug, seen twice')
  assert.equal(parseModel(undefined), null)
  assert.equal(parseModel(' '), null)
  assert.match(parseModel('haiku: cheap').why, /starts with its family, sonnet or opus/)
  assert.match(parseModel('sonnets: no family').why, /starts with its family/)
  assert.match(parseModel('opus').why, /reason after its family/)
  assert.match(parseModel(`opus: ${'x'.repeat(201)}`).why, /at most 200 characters, this one has 201/)
})

test('a step without a model counts as sonnet; its section goes before its refine line', () => {
  assert.deepEqual(modelOf(step('B1')), { family: 'sonnet', why: null, isSet: false })
  assert.deepEqual(modelOf(step('B1', {}, { Model: ['opus · the flow file'] })), { family: 'opus', why: 'the flow file', isSet: true })
  assert.deepEqual(modelOf(step('B1', {}, { Refined: ['  Refined (round 1, by Advisor, 2026-10-23 09:00):', '  Model: opus · art direction'] })), { family: 'opus', why: 'art direction', isSet: true })
  assert.equal(modelOf(step('B1', {}, { Model: ['sonnet · a text fix'], Refined: ['  Model: opus · old'] })).family, 'sonnet')
  // One the board cannot read counts as none.
  assert.deepEqual(modelOf(step('B1', {}, { Model: ['gpt · x'] })), { family: 'sonnet', why: null, isSet: false })
})

test('a work tool without the field gives the model as a line of what or of the questions; a line that names no family stays', () => {
  assert.deepEqual(withModel({ what: ['- A field', 'Model: opus: a guard', 'Not in it: art'] }), { what: ['- A field', 'Not in it: art'], model: 'opus: a guard' })
  assert.deepEqual(withModel({ questions: 'Model: sonnet · a text fix\nShould it fold? Advised: yes' }), { questions: ['Should it fold? Advised: yes'], model: 'sonnet · a text fix' })
  assert.deepEqual(withModel({ what: ['Model: the unit\'s new 3D model, rigged'] }), { what: ['Model: the unit\'s new 3D model, rigged'] })
  const given = { model: 'opus: x', what: ['Model: sonnet: y'] }
  assert.equal(withModel(given), given)
})

test('the settings: the model ids of the app, and the usual setting between steps, Sonnet and medium unless set', () => {
  assert.deepEqual(runSettings({}), { models: {}, usual: { model: 'sonnet', effort: 'medium' } })
  assert.deepEqual(runSettings(parseConfig('{}', {})), { models: {}, usual: { model: 'sonnet', effort: 'medium' } })
  const config = parseConfig(JSON.stringify({ models: { sonnet: ' claude-sonnet-test ', opus: 'claude-opus-test[1m]' }, usualModel: 'Opus', usualEffort: 'low' }), {})
  assert.deepEqual([config.models, config.usualModel, config.usualEffort], [{ sonnet: 'claude-sonnet-test', opus: 'claude-opus-test[1m]' }, 'opus', 'low'])
  assert.deepEqual(runSettings(config).usual, { model: 'opus', effort: 'low' })
  // A setting of the wrong kind is named, and left out.
  assert.match(configProblem('{"models":{"haiku":"claude-haiku-test"}}'), /"models" must be an object of the model families sonnet and opus/)
  assert.match(configProblem('{"models":{"opus":"two words"}}'), /"models"/)
  assert.match(configProblem('{"usualModel":"haiku"}'), /"usualModel" must be "sonnet" or "opus"/)
  assert.match(configProblem('{"usualEffort":"loud"}'), /"usualEffort" must be one of "low"/)
  assert.equal(configProblem(JSON.stringify({ models: MODELS, usualModel: 'sonnet', usualEffort: 'medium' })), null)
  assert.deepEqual(parseConfig('{"models":{"haiku":"x"},"usualEffort":"loud"}', {}).models, {})
  assert.equal(sameModel('claude-opus-test', 'claude-opus-test[1m]'), true)
  assert.equal(sameModel('claude-opus-test', null), false)
})

test('the word to the main chat names the chat, its session, the step, the model, the effort and why', () => {
  const words = effortWords({ to: 'Main', chat: 'Units', session: 'local_abc-1', level: 'medium', model: 'claude-opus-test', usual: 'medium', usualModel: 'claude-sonnet-test', step: 'B7', why: 'B7 is Units\'s next step' })
  assert.equal(words.text, ['set model and effort', 'Chat: Units', 'Session: local_abc-1', 'Step: B7', 'Model: claude-opus-test', 'Effort: medium', "Why: B7 is Units's next step"].join('\n'))
  assert.deepEqual([words.command, words.about, words.model, words.effort, words.usualModel, words.forStep], ['worker-effort', 'Units', 'claude-opus-test', 'medium', 'claude-sonnet-test', 'B7'])
  // Without a model id, B468's word: the effort alone.
  assert.equal(effortWords({ to: 'Main', chat: 'Units', session: null, level: 'low', usual: 'medium', step: 'B7', why: 'x' }).text, ['set effort', 'Chat: Units', 'Effort: low', 'Step: B7', 'Why: x'].join('\n'))
})

test('a step without a model counts as sonnet: a worker on Opus is asked onto Sonnet before the step goes to it', () => {
  const items = itemsOf(step('B7', { Owner: 'Units' }, { Effort: ['medium · a board fix'] }))
  const done = plan({ items, lanes: [lane('Units')], deliveries: [{ id: 'B7', chat: 'Units' }] })
  assert.deepEqual(done.words, [{ to: 'Main', chat: 'Units', session: 'local_units', level: 'medium', model: MODELS.sonnet, usual: 'medium', usualModel: MODELS.sonnet, step: 'B7', why: "B7 is Units's next step; model sonnet (its refine gives none), effort medium (a board fix)" }])
  assert.deepEqual([...done.held], ['B7'])
  assert.deepEqual(done.runs.get('Units'), { level: 'medium', model: 'sonnet', usual: 'medium', usualModel: 'sonnet', step: 'B7', why: 'a board fix', modelWhy: null, isSet: false, asked: null })
})

test('an opus step asks the main chat for Opus, with its effort, in one word', () => {
  const items = itemsOf(step('B8', { Owner: 'Units' }, { Model: ['opus · a guard of the work store'], Effort: ['high · many parts'] }))
  const done = plan({ items, lanes: [lane('Units', { model: MODELS.sonnet, effort: 'medium' })], deliveries: [{ id: 'B8', chat: 'Units' }] })
  assert.deepEqual(done.words.map(one => [one.model, one.level, one.step]), [[MODELS.opus, 'high', 'B8']])
  assert.equal(done.words[0].why, "B8 is Units's next step; model opus (a guard of the work store), effort high (many parts)")
  assert.equal(effortWords(done.words[0]).text.split('\n')[0], 'set model and effort')
  assert.equal(done.runs.get('Units').modelWhy, 'a guard of the work store')
})

test('the step\'s line waits until both model and effort are read back', () => {
  const items = itemsOf(step('B8', { Owner: 'Units' }, { Model: ['opus · a guard'], Effort: ['high · many parts'] }))
  const deliveries = [{ id: 'B8', chat: 'Units' }]
  const sent = [word('Units', 'high', MODELS.opus, NOW - 60_000, 'taken', 'B8')]
  // Asked a minute ago: the effort set, the model not yet: it waits, and no second word goes.
  const effortOnly = plan({ items, lanes: [lane('Units', { model: MODELS.sonnet, effort: 'high' })], deliveries, sent })
  assert.deepEqual([effortOnly.words, [...effortOnly.held], effortOnly.runs.get('Units').isSet], [[], ['B8'], false])
  // The model set, the effort not yet: it waits.
  const modelOnly = plan({ items, lanes: [lane('Units', { model: MODELS.opus, effort: 'medium' })], deliveries, sent })
  assert.deepEqual([[...modelOnly.held], modelOnly.runs.get('Units').isSet], [['B8'], false])
  // Both, as the app's file of the chat says: the line goes.
  const both = plan({ items, lanes: [lane('Units', { model: MODELS.opus, effort: 'high' })], deliveries, sent })
  assert.deepEqual([both.words, [...both.held], both.runs.get('Units').isSet], [[], [], true])
  // The model also counts as read back from the chat's answer after the word, as its transcript names it (B352's way).
  const answered = plan({ items, lanes: [lane('Units', { model: MODELS.sonnet, effort: 'high', lastAnswer: { model: MODELS.opus, at: NOW - 30_000 } })], deliveries, sent })
  assert.deepEqual([...answered.held], [])
  // An answer from before the word says nothing about it.
  const before = plan({ items, lanes: [lane('Units', { model: MODELS.sonnet, effort: 'high', lastAnswer: { model: MODELS.opus, at: NOW - 120_000 } })], deliveries, sent })
  assert.deepEqual([...before.held], ['B8'])
  // An answer after a word of more than half an hour ago still counts: no word again for a setting it runs on.
  const old = [word('Units', 'high', MODELS.opus, NOW - AGAIN_MS - 60_000, 'delivered', 'B8')]
  const kept = plan({ items, lanes: [lane('Units', { model: MODELS.sonnet, effort: 'high', lastAnswer: { model: MODELS.opus, at: NOW - AGAIN_MS } })], deliveries, sent: old })
  assert.deepEqual([kept.words, [...kept.held], kept.runs.get('Units').isSet], [[], [], true])
  // A file that names no model: the chat's last answer says it.
  const noFile = plan({ items, lanes: [lane('Units', { model: null, effort: 'high', lastAnswer: { model: `${MODELS.opus}[1m]`, at: NOW - 120_000 } })], deliveries, sent })
  assert.deepEqual([...noFile.held], [])
})

test('not read back within a few minutes, the line goes anyway, and the word goes again only after half an hour (B468)', () => {
  const items = itemsOf(step('B8', { Owner: 'Units' }, { Model: ['opus · a guard'], Effort: ['high · many parts'] }))
  const deliveries = [{ id: 'B8', chat: 'Units' }]
  const lanes = [lane('Units', { model: MODELS.sonnet, effort: 'medium' })]
  const late = plan({ items, lanes, deliveries, sent: [word('Units', 'high', MODELS.opus, NOW - HOLD_MS, 'delivered', 'B8')] })
  assert.deepEqual([late.words, [...late.held]], [[], []])
  assert.equal(late.runs.get('Units').asked.at, NOW - HOLD_MS)
  // A lost word frees the line too, and goes once more after half an hour.
  const lost = word('Units', 'high', MODELS.opus, NOW - 60_000, 'expired', 'B8')
  assert.deepEqual([...plan({ items, lanes, deliveries, sent: [lost] }).held], [])
  assert.equal(plan({ items, lanes, deliveries, sent: [{ ...lost, at: NOW - AGAIN_MS }] }).words.length, 1)
  // A word for the same effort but another model is no word for this setting: it is asked anew.
  assert.deepEqual(plan({ items, lanes, deliveries, sent: [word('Units', 'high', MODELS.sonnet, NOW - 60_000, 'taken', 'B8')] }).words.map(one => one.model), [MODELS.opus])
})

test('between steps a worker goes back to Sonnet and medium, never to the Opus and extra high it ran at before', () => {
  const done = itemsOf(step('B8', { Owner: 'Units', State: 'review' }, { Model: ['opus · a guard'], Effort: ['high · many parts'] }))
  const back = plan({ items: done, lanes: [lane('Units', { model: MODELS.opus, effort: 'high' })], sent: [word('Units', 'high', MODELS.opus, NOW - 3_600_000, 'delivered', 'B8')] })
  assert.deepEqual(back.words, [{ to: 'Main', chat: 'Units', session: 'local_units', level: 'medium', model: MODELS.sonnet, usual: 'medium', usualModel: MODELS.sonnet, step: null, why: 'Units holds no step now: back to its usual setting' }])
  // A word of B468 that kept extra high as the chat's usual level: back to the settings' Sonnet and medium all the same.
  const old = { id: 'w1', command: 'worker-effort', about: 'Units', effort: 'xhigh', usual: 'xhigh', forStep: null, at: NOW - 3_600_000, state: 'delivered' }
  assert.deepEqual(plan({ items: done, lanes: [lane('Units')], sent: [old] }).words.map(one => [one.model, one.level]), [[MODELS.sonnet, 'medium']])
  // Already at Sonnet and medium: nothing to ask.
  assert.deepEqual(plan({ items: done, lanes: [lane('Units', { model: MODELS.sonnet, effort: 'medium' })], sent: [word('Units', 'high', MODELS.opus, NOW - 3_600_000)] }).words, [])
  // The word back arrived and the person moved the chat by hand since: left alone.
  const own = word('Units', 'medium', MODELS.sonnet, NOW - 3_600_000, 'delivered', null)
  assert.deepEqual(plan({ items: done, lanes: [lane('Units', { model: MODELS.opus, effort: 'xhigh' })], sent: [own] }).words, [])
  // Never changed by the board: its own, as before.
  assert.deepEqual(plan({ items: done, lanes: [lane('Units')], sent: [] }).words, [])
  // The next step's setting is asked for straight away, not the usual one first.
  const next = itemsOf(step('B8', { Owner: 'Units', State: 'review' }), step('B9', { Owner: 'Units' }, { Effort: ['low · a text fix'] }))
  assert.deepEqual(plan({ items: next, lanes: [lane('Units', { model: MODELS.opus, effort: 'high' })], sent: [word('Units', 'high', MODELS.opus, NOW - 3_600_000, 'delivered', 'B8')] }).words.map(one => [one.model, one.level, one.step]), [[MODELS.sonnet, 'low', 'B9']])
})

test('a family without a model id in the settings: the board sets the effort alone', () => {
  const items = itemsOf(step('B8', { Owner: 'Units' }, { Model: ['opus · a guard'], Effort: ['high · many parts'] }))
  const done = effortPlan({ items, lanes: [lane('Units', { model: MODELS.sonnet, effort: 'medium' })], deliveries: [{ id: 'B8', chat: 'Units' }], sent: [], now: NOW, main: 'Main', models: { sonnet: MODELS.sonnet } })
  assert.deepEqual(done.words.map(one => [one.model, one.level]), [[null, 'high']])
  assert.equal(effortWords(done.words[0]).text.split('\n')[0], 'set effort')
  // Set once the effort is: the model is not the board's to read back.
  const set = effortPlan({ items, lanes: [lane('Units', { model: MODELS.sonnet, effort: 'high' })], deliveries: [{ id: 'B8', chat: 'Units' }], sent: [], now: NOW, main: 'Main', models: { sonnet: MODELS.sonnet } })
  assert.equal(set.runs.get('Units').isSet, true)
})
