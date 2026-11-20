// B1282 (X207): a held step's setting read back on its worker and lost since gets one set word at once, and effort-mismatch says what
// happened, counted from the loss. The real case: Worker 3 got B1279 (opus · high) at 23:50; Main set it (its word delivered 23:50:46)
// and the hand-over pass read it back (the envelope `setByMain`, taken 23:50:57); Worker 3 answered on Opus till 00:00, when an account
// move brought the other record of the chat back, sonnet · medium. Nothing asked again: the sequence drops the plan's words, the refusal
// asks none and the half hour's hold kept the delivered word; the rule said "switch asked 23:50, not read back". Made-up names beside the
// case's own times and ids; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { WATCH_RULES, switchOf } from '../../src/supervisor/rules/watch.mjs'
import { isEffortWordHeld } from '../../src/work/deliver.mjs'
import { effortPlan, effortWords, planWordsFor, readBackMarkOf, readBackOf } from '../../src/work/effort.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const at = (d, h, m, s = 0) => new Date(2026, 10, d, h, m, s).getTime()
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const MODELS = { sonnet: SONNET, opus: OPUS }
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
const REFUSAL = "Not run: in auto mode Claude Desktop doesn't run this tool when a plugin's own code calls it. Have Claude make the call."
const SESSION = 'local_0981b01c'

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
/** B1279 as the store held it: taken 23:51, opus · high. */
const b1279 = ({ effort = 'high', model = 'opus' } = {}) => item(
  { Id: 'B1279', Kind: 'step', Title: 'Fix of X205: a start word to an idle Main', State: 'in progress', Owner: 'Worker 3', Since: stamp(at(19, 23, 51)) },
  {
    History: [`- ${stamp(at(19, 23, 49))} server: refined → queued (given by the board to Worker 3)`, `- ${stamp(at(19, 23, 51))} Worker 3: queued → taken`, `- ${stamp(at(19, 23, 51))} Worker 3: taken → in progress`],
    Model: [`${model} · the board's core`], Effort: [`${effort} · a start that never comes`],
  },
)
const items = step => new Map([['B1279', step]])
/** Worker 3 after the account move: sonnet · medium. */
const lane = (more = {}) => ({ name: 'Worker 3', model: SONNET, effort: 'medium', appSession: SESSION, onSequence: true, ...more })
const refused = { id: 'r1', at: at(19, 22, 0), to: 'Lead', command: 'worker-effort', about: 'Worker 9', effort: 'low', model: SONNET, state: 'dropped', refused: true, failedAt: at(19, 22, 0), why: REFUSAL }
/** The case's outbox: the hand-over's word for Main's model and its envelope, read back by the hand-over pass (`setByMain`). */
const setWord = { id: 'ec9a0a63f83ece9d', at: at(19, 23, 50, 43), to: 'Lead', command: 'worker-effort', about: 'Worker 3', effort: 'high', model: OPUS, forStep: 'B1279', session: SESSION, forModel: true, envelope: '6ceb6ae00f52bc77', state: 'delivered', takenAt: at(19, 23, 50, 45), deliveredAt: at(19, 23, 50, 46) }
const envelope = { wants: { model: OPUS, effort: 'high' }, id: '6ceb6ae00f52bc77', at: at(19, 23, 50, 43), to: 'Worker 3', command: 'handover', kind: 'task', step: 'B1279', set: null, asked: null, setByMain: true, state: 'delivered', takenAt: at(19, 23, 50, 57), deliveredAt: at(19, 23, 51, 7) }
const CASE = [refused, setWord, envelope]
const plan = (step, now, sent = CASE, more = {}) => effortPlan({ items: items(step), lanes: [lane(more.lane)], sent, now, main: 'Lead', models: MODELS, known: sent, ...more.plan })
const view = now => ({ now, settings: { switchMinutes: 10 }, gaps: [], pause: null, limits: {} })
const ruleAt = (step, now, sent, more = {}) => switchOf({ ...lane(more.lane), effortRun: { step: 'B1279', ...plan(step, now, sent, more).runs.get('Worker 3') } }, step, view(now))
const lostWordOf = (now, state = 'waiting', more = {}) => ({ id: 'lw', at: now, ...effortWords(plan(b1279(), now).words[0]), state, ...more })

test('X207 real case: the read-back is the envelope Main set, at its take (23:50:57)', () => {
  assert.deepEqual(readBackOf({ envelope, handed: envelope.wants, words: CASE, step: 'B1279', level: 'high', model: OPUS }), { at: at(19, 23, 50, 57), how: 'its hand-over' })
  assert.equal(readBackOf({ envelope: { ...envelope, setByMain: undefined }, handed: envelope.wants, words: CASE, step: 'B1279', level: 'high', model: OPUS }), null, 'a delivered word alone is no read-back')
})

test('X207 real case: while it runs Opus · high, no word and no loss', () => {
  const { words, runs } = plan(b1279(), at(19, 23, 55), CASE, { lane: { model: OPUS, effort: 'high' } })
  assert.deepEqual([words, runs.get('Worker 3').isSet, runs.get('Worker 3').lost], [[], true, undefined])
})

test('X207 real case: sonnet · medium from 00:00, one set word for B1279 at once, for Main\'s model, through the sequence', () => {
  const now = at(20, 0, 0, 30)
  const { words, runs } = plan(b1279(), now)
  assert.equal(words.length, 1)
  const [word] = words
  assert.deepEqual([word.to, word.chat, word.level, word.model, word.step, word.lost, word.forModel, word.changed], ['Lead', 'Worker 3', 'high', OPUS, 'B1279', true, true, undefined])
  assert.equal(word.why, "B1279 was set to opus · high at 23:50 (read back) and Worker 3 runs sonnet · medium again; the app no longer lets the board's code set it, so set it yourself")
  assert.deepEqual(planWordsFor(words, [lane()]), words, 'a lost word goes for a worker on the sequence')
  assert.deepEqual(runs.get('Worker 3').lost, { setAt: at(19, 23, 50, 57), at: now, runs: 'sonnet · medium', asking: true, word: null })
  assert.deepEqual([effortWords(word).lost, effortWords(word).forStep], [true, 'B1279'])
  // The delivery's half hour's hold does not keep it back behind the word that set it 10 minutes before.
  assert.equal(isEffortWordHeld({ ...word }, setWord, () => CASE, now), false)
  // Without the refusal, for the hands.
  assert.deepEqual(plan(b1279(), now, [setWord, envelope]).words.map(one => [one.lost, one.forModel]), [[true, undefined]])
})

test('X207: once per loss: no second word on the next pass, nor at the delivery should two passes plan it', () => {
  const first = lostWordOf(at(20, 0, 0, 30))
  for (const now of [at(20, 0, 1), at(20, 0, 20), at(20, 1, 0)]) assert.deepEqual(plan(b1279(), now, [...CASE, { ...first, state: 'delivered', deliveredAt: at(20, 0, 0, 40) }]).words, [])
  assert.deepEqual(plan(b1279(), at(20, 0, 1), [...CASE, first]).words, [])
  assert.equal(isEffortWordHeld(plan(b1279(), at(20, 0, 0, 30)).words[0], first, () => [...CASE, first], at(20, 0, 1)), true)
})

test('X207, effort-mismatch: quiet while the word is open; then "lost 00:00" with the minutes since the loss, never from the take', () => {
  const step = b1279()
  const first = lostWordOf(at(20, 0, 0, 30))
  const asking = ruleAt(step, at(20, 0, 0, 30), CASE)
  assert.deepEqual([asking.state, asking.late], ['lost', false], 'the pass that writes it')
  const open = ruleAt(step, at(20, 0, 20), [...CASE, { ...first, state: 'taken' }])
  assert.deepEqual([open.state, open.late, open.lostAt], ['lost', false, at(20, 0, 0, 30)])
  const delivered = [...CASE, { ...first, state: 'delivered', deliveredAt: at(20, 0, 0, 40) }]
  const early = ruleAt(step, at(20, 0, 9), delivered)
  assert.deepEqual([early.late, Math.round(early.since / MIN)], [false, 9], 'counted from the loss: 9 min, not 18 from the take')
  const late = ruleAt(step, at(20, 0, 11), delivered)
  assert.deepEqual([late.state, late.late, late.setAt, late.lostAt, Math.round(late.since / MIN)], ['lost', true, at(19, 23, 50, 57), at(20, 0, 0, 30), 11])
})

test('X207, the rule\'s words: "switched at 23:50 (read back), runs sonnet · medium again since 00:00"', async () => {
  const { default: rules } = await import('../../src/supervisor/rules/watch.mjs').then(m => ({ default: m.RULES ?? m.rules ?? null }))
  const delivered = [...CASE, { ...lostWordOf(at(20, 0, 0, 30)), state: 'delivered', deliveredAt: at(20, 0, 0, 40) }]
  const now = at(20, 0, 11, 30)
  const run = plan(b1279(), now, delivered).runs.get('Worker 3')
  const rule = WATCH_RULES.find(one => one.id === 'effort-mismatch')
  assert.ok(rule, 'the rule is listed')
  const found = rule.check({ ...view(now), lanes: [{ ...lane(), effortRun: { step: 'B1279', ...run } }], items: items(b1279()), prefix: '' })
  assert.equal(found.length, 1)
  assert.equal(found[0].text, 'Worker 3 runs sonnet · medium again since 00:00 (11 min): B1279 was switched to opus · high at 23:50 (read back)')
  assert.match(found[0].evidence, /switched to opus · high at 23:50 \(read back\), runs sonnet · medium again since 00:00; set word for the loss asked 00:00 \(delivered\)/)
  assert.doesNotMatch(found[0].evidence, /not read back/)
})

test('a worker never read back keeps today\'s text: "switch asked 23:50 (delivered), not read back", from the take', () => {
  const unread = [refused, setWord, { ...envelope, setByMain: undefined, asked: { model: OPUS, effort: 'high' } }]
  const { words, runs } = plan(b1279(), at(20, 0, 0, 30), unread)
  assert.deepEqual([words, runs.get('Worker 3').lost], [[], undefined])
  const found = ruleAt(b1279(), at(20, 0, 5), unread)
  assert.notEqual(found.state, 'lost')
  assert.equal(found.lostAt, null)
})

test('a second loss after the setting came back gets its own word: the lost word met (the sweep) is a new read-back', () => {
  const first = lostWordOf(at(20, 0, 0, 30), 'dropped', { met: true, closedAt: at(20, 0, 2) })
  const sent = [...CASE, first]
  assert.deepEqual(plan(b1279(), at(20, 1, 0), sent, { lane: { model: OPUS, effort: 'high' } }).words, [], 'set again: nothing')
  const again = plan(b1279(), at(20, 2, 0), sent)
  assert.deepEqual(again.words.map(one => [one.lost, one.level]), [[true, 'high']])
  assert.match(again.words[0].why, /at 00:02 \(read back\)/)
})

test('the hand-over pass marks the newest step word Main took once the app\'s file shows it; the mark is a read-back', () => {
  const taken = { ...lostWordOf(at(20, 0, 0, 30)), state: 'delivered', deliveredAt: at(20, 0, 0, 40) }
  assert.equal(readBackMarkOf(lane(), [...CASE, taken]), null, 'still sonnet · medium: no mark')
  assert.equal(readBackMarkOf(lane({ model: OPUS, effort: 'high' }), [...CASE, taken]), 'lw')
  assert.equal(readBackMarkOf(lane({ model: OPUS, effort: 'high' }), [...CASE, { ...taken, readBackAt: at(20, 0, 1) }]), null, 'once')
  assert.equal(readBackMarkOf(lane({ model: OPUS, effort: 'high', appSession: 'local_other' }), [...CASE, taken]), null, 'another session')
  assert.equal(readBackMarkOf(lane({ model: OPUS, effort: null }), [...CASE, taken]), null, 'an effort the file does not say')
  // Marked at 00:01, lost again at 00:05: a new word.
  const marked = [...CASE, { ...taken, readBackAt: at(20, 0, 1) }]
  assert.deepEqual(plan(b1279(), at(20, 0, 5), marked).words.map(one => one.lost), [true])
})

test('no loss on a reading that says nothing (effort not known), nor while a word for another setting is on its way, nor without a main chat a word', () => {
  assert.deepEqual(plan(b1279(), at(20, 0, 1), CASE, { lane: { model: OPUS, effort: null } }).words, [])
  const noMain = plan(b1279(), at(20, 0, 1), CASE, { plan: { main: null } })
  assert.deepEqual([noMain.words, noMain.runs.get('Worker 3').lost.at, noMain.runs.get('Worker 3').lost.asking], [[], at(19, 23, 50, 57), false])
})

test('a lost word waiting is moot once its step wants another setting or is no longer the worker\'s', () => {
  const waiting = lostWordOf(at(20, 0, 0, 30))
  const ctx = { all: [...CASE, waiting], items: items(b1279()), now: at(20, 0, 2), keep: KEEP, lanes: [lane()] }
  assert.equal(whyClosed(waiting, ctx), null)
  assert.deepEqual(whyClosed(waiting, { ...ctx, items: items(b1279({ effort: 'medium' })) }), { state: 'dropped', moot: true, why: 'B1279 no longer wants opus · high' })
  const reported = item({ ...Object.fromEntries(b1279().head), State: 'review' }, Object.fromEntries(b1279().sections))
  assert.deepEqual(whyClosed(waiting, { ...ctx, items: items(reported) }), { state: 'dropped', moot: true, why: 'B1279 is no longer Worker 3\'s' })
  // Met once the app's file shows it.
  assert.equal(whyClosed(waiting, { ...ctx, lanes: [lane({ model: OPUS, effort: 'high' })] }).met, true)
})
