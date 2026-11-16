// B1207 (X26 back after B576, Count 4): a step whose model or effort changes after its hand-over gets its own set word to the main
// chat, and effort-mismatch counts its 10 minutes from that change. The real case: Worker 5 got B1196 at 15:50 asked at sonnet ·
// medium (Main's model set it, 15:51, while the app refused the hands); at 16:12 the step's Effort became high (the goal guard), no
// word went (the sequence drops the plan's words, the refusal asks none) and the rule fired at 16:13, 22 min after the take, saying
// "no switch asked". Made-up names beside the case's own times and ids; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { switchOf } from '../../src/supervisor/rules/watch.mjs'
import { effortPlan, effortWords, handedSettingOf, planWordsFor } from '../../src/work/effort.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 10, 14, h, m, s).getTime()
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const MODELS = { sonnet: SONNET, opus: OPUS }
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
const REFUSAL = "Not run: in auto mode Claude Desktop doesn't run this tool when a plugin's own code calls it. Have Claude make the call."

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
/** B1196 as the store held it: taken 15:51, refined again at 16:12 with Effort high (`effort`), Model sonnet unless told. */
const b1196 = ({ effort = 'high', model = 'sonnet', refinedAt = at(16, 12) } = {}) => item(
  { Id: 'B1196', Kind: 'step', Title: 'Fix: an own move per ability', State: 'in progress', Owner: 'Worker 5', Since: stamp(at(15, 51)) },
  {
    History: [`- ${stamp(at(15, 48))} Checker: made by the result check of B1155`, `- ${stamp(at(15, 50))} server: refined → queued (given by the board to Worker 5)`,
      `- ${stamp(at(15, 51))} Worker 5: queued → taken`, `- ${stamp(at(15, 51))} Worker 5: taken → in progress`, ...(refinedAt === null ? [] : [`- ${stamp(refinedAt)} Partner: refined is ready`])],
    Model: [`${model} · the pipeline is proven`], Effort: [`${effort} · the goal guard: its goal is in its fundamental evaluation`],
  },
)
const items = step => new Map([['B1196', step]])
const lane = (more = {}) => ({ name: 'Worker 5', model: SONNET, effort: 'medium', appSession: 'local_88208666', onSequence: true, ...more })
/** The case's outbox: the hand-over's word for Main's model (delivered 15:51) and its envelope, set by Main (set and asked cleared). */
const handedWord = { id: '44d86f776aec70e7', at: at(15, 50, 43), to: 'Lead', command: 'worker-effort', about: 'Worker 5', effort: 'medium', model: SONNET, forStep: 'B1196', session: 'local_88208666', forModel: true, envelope: 'b755a812c8b0caf4', state: 'delivered', takenAt: at(15, 50, 54), deliveredAt: at(15, 51) }
const envelope = { id: 'b755a812c8b0caf4', at: at(15, 50, 43), to: 'Worker 5', command: 'handover', kind: 'task', step: 'B1196', set: null, asked: null, setByMain: true, state: 'delivered', deliveredAt: at(15, 51, 29) }
/** The refusal that stood: a hand's set word the app refused. */
const refused = { id: 'r1', at: at(14, 0), to: 'Lead', command: 'worker-effort', about: 'Worker 9', effort: 'low', model: SONNET, state: 'dropped', refused: true, failedAt: at(14, 0), why: REFUSAL }
const CASE = [refused, handedWord, envelope]
const plan = (step, now, sent = CASE, more = {}) => effortPlan({ items: items(step), lanes: [lane(more.lane)], sent, now, main: 'Lead', models: MODELS, known: sent, ...more.plan })
const view = now => ({ now, settings: { switchMinutes: 10 }, gaps: [], pause: null, limits: {} })

test('X26 real case, the pin: the envelope Main set holds no set or asked; the setting it asked is read from its own word (sonnet · medium)', () => {
  assert.deepEqual(handedSettingOf(envelope, CASE), { model: SONNET, effort: 'medium' })
  assert.deepEqual(handedSettingOf({ ...envelope, wants: { model: SONNET, effort: 'low' } }, CASE), { model: SONNET, effort: 'low' }, 'its wants first')
  assert.equal(handedSettingOf({ ...envelope, id: 'other' }, CASE), null)
})

test('X26 real case: at 16:12 one set word to Main for high, for Main\'s model while the refusal stands; the sequence lets it through', () => {
  const now = at(16, 12, 30)
  const { words, runs } = plan(b1196(), now)
  assert.equal(words.length, 1)
  const [word] = words
  assert.deepEqual([word.to, word.chat, word.level, word.model, word.step, word.changed, word.forModel], ['Lead', 'Worker 5', 'high', SONNET, 'B1196', true, true])
  assert.match(word.why, /^B1196 changed after its hand-over \(asked sonnet · medium at 15:50, now sonnet · high\); the app no longer lets the board's code set it, so set it yourself$/)
  assert.deepEqual(planWordsFor(words, [lane()]), words, 'a changed word goes for a worker on the sequence')
  assert.deepEqual(planWordsFor([{ ...word, changed: undefined }], [lane()]), [], 'any other plan word for it does not (T8.5)')
  const run = runs.get('Worker 5')
  assert.deepEqual([run.isSet, run.refused, run.changed.at, run.changed.fromWords], [false, undefined, at(16, 12), 'sonnet · medium'])
  // The word as it goes into the outbox keeps both marks.
  const message = effortWords(word)
  assert.deepEqual([message.changed, message.forModel, message.forStep], [true, true, 'B1196'])
})

test('X26 real case: without the refusal the word goes for the hands (no forModel)', () => {
  const { words } = plan(b1196(), at(16, 12, 30), [handedWord, envelope])
  assert.deepEqual(words.map(one => [one.level, one.changed, one.forModel]), [['high', true, undefined]])
})

test('X26 real case: once written, the word is not written again within the half hour', () => {
  const now = at(16, 13)
  const first = effortWords(plan(b1196(), at(16, 12, 30)).words[0])
  const sent = [...CASE, { id: 'w2', at: at(16, 12, 30), ...first, state: 'waiting' }]
  const { words, runs } = plan(b1196(), now, sent)
  assert.deepEqual(words, [])
  assert.deepEqual([runs.get('Worker 5').asked.at, runs.get('Worker 5').changed.at], [at(16, 12, 30), at(16, 12, 30)])
})

test('X26 real case, effort-mismatch: no finding at 16:13; one at 16:23 if not read back, counted from the change and saying it', () => {
  const step = b1196()
  const sent = [...CASE, { id: 'w2', at: at(16, 12, 30), ...effortWords(plan(step, at(16, 12, 30)).words[0]), state: 'delivered', deliveredAt: at(16, 12, 40) }]
  const runAt = now => ({ ...lane(), effortRun: { step: 'B1196', ...plan(step, now, sent).runs.get('Worker 5') } })
  const early = switchOf(runAt(at(16, 13)), step, view(at(16, 13)))
  assert.deepEqual([early.mismatch, early.state, early.late], [true, 'asked', false])
  const late = switchOf(runAt(at(16, 23)), step, view(at(16, 23)))
  assert.deepEqual([late.late, late.changedAt, late.handedAs, Math.round(late.since / MIN)], [true, at(16, 12, 30), 'sonnet · medium', 11])
  // Read back (the app's file says high): no finding.
  const set = switchOf({ ...lane({ effort: 'high' }), effortRun: { step: 'B1196', ...plan(step, at(16, 23), sent, { lane: { effort: 'high' } }).runs.get('Worker 5') } }, step, view(at(16, 23)))
  assert.equal(set.mismatch, false)
})

test('X26: a step unchanged since its hand-over still counts from the take (B576 as before)', () => {
  const step = b1196({ effort: 'medium', refinedAt: null })
  const { words, runs } = plan(step, at(16, 0))
  assert.deepEqual([words, runs.get('Worker 5').changed, runs.get('Worker 5').isSet], [[], undefined, true])
  const found = switchOf({ ...lane({ effort: 'low' }), effortRun: { step: 'B1196', ...runs.get('Worker 5'), isSet: false } }, step, view(at(16, 2)))
  assert.deepEqual([found.changedAt, found.late, Math.round(found.since / MIN)], [null, true, 11])
})

test('a model change after the take (sonnet to opus): one word for Opus with its effort', () => {
  const { words, runs } = plan(b1196({ model: 'opus', effort: 'medium' }), at(16, 12, 30))
  assert.deepEqual(words.map(one => [one.model, one.level, one.changed]), [[OPUS, 'medium', true]])
  assert.match(words[0].why, /now opus · medium/)
  assert.equal(runs.get('Worker 5').changed.fromWords, 'sonnet · medium')
})

test('a setting changed back before the 10 minutes: no word, no finding, and the waiting word for high is dropped', () => {
  const back = b1196({ effort: 'medium', refinedAt: at(16, 15) })
  const waiting = { id: 'w2', at: at(16, 12, 30), ...effortWords(plan(b1196(), at(16, 12, 30)).words[0]), state: 'waiting' }
  const sent = [...CASE, waiting]
  const ctx = { all: sent, items: items(back), now: at(16, 16), keep: KEEP, lanes: [lane()] }
  const closed = whyClosed(waiting, ctx)
  assert.deepEqual(closed, { state: 'dropped', moot: true, why: 'B1196 no longer wants sonnet · high' })
  // While the step still wants high, the word stays.
  assert.equal(whyClosed(waiting, { ...ctx, items: items(b1196()) }), null)
  // After the sweep: set, no new word, no mismatch.
  const { words, runs } = plan(back, at(16, 16), [...CASE, { ...waiting, ...closed }])
  // Still a changed step (a word went for it), but set: nothing to ask.
  assert.deepEqual([words, runs.get('Worker 5').isSet, runs.get('Worker 5').changed.then], [[], true, 'sonnet · high'])
  assert.equal(switchOf({ ...lane(), effortRun: { step: 'B1196', ...runs.get('Worker 5') } }, back, view(at(16, 30))).mismatch, false)
})

test('the quiet gap covers only the setting its envelope asked: asked opus · high and still wanted, quiet; changed to medium, a word', () => {
  const unset = { ...envelope, set: null, asked: { model: OPUS, effort: 'high' }, setByMain: undefined }
  const sent = [refused, unset]
  const kept = plan(b1196({ model: 'opus', effort: 'high' }), at(16, 20), sent)
  assert.deepEqual([kept.words, kept.runs.get('Worker 5').refused], [[], true])
  const changed = plan(b1196({ model: 'opus', effort: 'medium' }), at(16, 20), sent)
  assert.deepEqual(changed.words.map(one => [one.model, one.level, one.forModel]), [[OPUS, 'medium', true]])
  assert.equal(changed.runs.get('Worker 5').refused, undefined)
})

test('an envelope still on its way is no hand-over yet: no changed word', () => {
  const { words } = plan(b1196(), at(15, 50, 50), [refused, handedWord, { ...envelope, state: 'waiting', deliveredAt: undefined }])
  assert.deepEqual(words.filter(one => one.changed === true), [])
})

test('review 1 (both lenses): back to the hand-over\'s medium after Main set high: one word for medium, counted from the change back', () => {
  const high = { id: 'w2', at: at(16, 12, 30), ...effortWords(plan(b1196(), at(16, 12, 30)).words[0]), state: 'delivered', deliveredAt: at(16, 12, 40) }
  const back = item({ ...Object.fromEntries(b1196().head) }, { ...Object.fromEntries(b1196().sections), Effort: ['medium · the evaluation ended'], History: [...b1196().sections.get('History'), `- ${stamp(at(16, 40))} Partner: refined is ready`] })
  const { words, runs } = plan(back, at(16, 40, 30), [...CASE, high], { lane: { effort: 'high' } })
  assert.deepEqual(words.map(one => [one.level, one.changed, one.forModel]), [['medium', true, true]])
  assert.match(words[0].why, /asked sonnet · medium at 15:50, then sonnet · high at 16:12, now sonnet · medium/)
  assert.equal(runs.get('Worker 5').changed.at, at(16, 40))
  const found = switchOf({ ...lane({ effort: 'high' }), effortRun: { step: 'B1196', ...runs.get('Worker 5') } }, back, view(at(16, 45)))
  assert.deepEqual([found.mismatch, found.late, found.changedAt], [true, false, at(16, 40)])
  // Verifier 1: the medium word delivered at 16:40:40, Main not done yet at 16:41: still changed, asked, counted from the change back.
  const mediumWord = { id: 'w3', at: at(16, 40, 30), ...effortWords(words[0]), state: 'delivered', deliveredAt: at(16, 40, 40) }
  const after = plan(back, at(16, 41), [...CASE, high, mediumWord], { lane: { effort: 'high' } })
  assert.deepEqual([after.words, after.runs.get('Worker 5').changed.at, after.runs.get('Worker 5').asked.at], [[], at(16, 40, 30), at(16, 40, 30)])
  const still = switchOf({ ...lane({ effort: 'high' }), effortRun: { step: 'B1196', ...after.runs.get('Worker 5') } }, back, view(at(16, 41)))
  assert.deepEqual([still.state, still.late, still.changedAt], ['asked', false, at(16, 40, 30)])
})

test('review 3: with no word and no refine line (no main chat) the change counts from its hand-over, never from now', () => {
  const step = b1196({ refinedAt: null })
  const first = plan(step, at(16, 20), CASE, { plan: { main: null } }).runs.get('Worker 5').changed.at
  const later = plan(step, at(16, 30), CASE, { plan: { main: null } }).runs.get('Worker 5').changed.at
  assert.deepEqual([first, later], [at(15, 50, 43), at(15, 50, 43)])
  // Verifier 3: an earlier refine that changed nothing (15:55) never starts the clock early: the newest refine line counts (16:12).
  const early = item({ ...Object.fromEntries(b1196().head) }, { ...Object.fromEntries(b1196().sections), History: [...b1196().sections.get('History').slice(0, 4), `- ${stamp(at(15, 55))} Partner: refined, round 2`, `- ${stamp(at(16, 12))} Partner: refined is ready`] })
  assert.equal(plan(early, at(16, 13), CASE, { plan: { main: null } }).runs.get('Worker 5').changed.at, at(16, 12))
  // Once a word went, a later refine that changes nothing does not move it: the first word's time counts.
  const word = { id: 'w2', at: at(16, 12, 30), ...effortWords(plan(b1196(), at(16, 12, 30)).words[0]), state: 'delivered', deliveredAt: at(16, 12, 40) }
  const twice = item({ ...Object.fromEntries(b1196().head) }, { ...Object.fromEntries(b1196().sections), History: [...b1196().sections.get('History'), `- ${stamp(at(16, 30))} Partner: refined, round 2`] })
  assert.equal(plan(twice, at(16, 31), [...CASE, word]).runs.get('Worker 5').changed.at, at(16, 12, 30))
})

test('review 5 (both lenses): a changed word the app refused asks again at once, for Main\'s model', () => {
  const word = plan(b1196(), at(16, 12, 30), [handedWord, envelope]).words[0]
  const refusedWord = { id: 'w2', at: at(16, 12, 30), ...effortWords(word), state: 'dropped', refused: true, failedAt: at(16, 12, 50), why: REFUSAL, takenBy: 'hand', takenAt: at(16, 12, 40), handTakenAt: at(16, 12, 40) }
  const { words } = plan(b1196(), at(16, 13), [handedWord, envelope, refusedWord])
  assert.deepEqual(words.map(one => [one.level, one.forModel]), [['high', true]])
})

test('review 2 (lens 2): a waiting changed word is dropped once its step is no longer the worker\'s', () => {
  const waiting = { id: 'w2', at: at(16, 12, 30), ...effortWords(plan(b1196(), at(16, 12, 30)).words[0]), state: 'waiting' }
  const reported = item({ ...Object.fromEntries(b1196().head), State: 'review' }, Object.fromEntries(b1196().sections))
  const ctx = step => ({ all: [waiting], items: step === null ? new Map() : items(step), now: at(16, 20), keep: KEEP, lanes: [lane()] })
  assert.deepEqual(whyClosed(waiting, ctx(reported)), { state: 'dropped', moot: true, why: "B1196 is no longer Worker 5's" })
  assert.deepEqual(whyClosed(waiting, ctx(null)), { state: 'dropped', moot: true, why: "B1196 is no longer Worker 5's" })
})

test('chat 1\'s check (both lenses): change, back, change again within the half hour: the dropped word counts for nothing, a word goes at once', () => {
  const step = (effort, refines) => item({ ...Object.fromEntries(b1196().head) }, { ...Object.fromEntries(b1196().sections), Effort: [`${effort} · the goal guard`], History: [...b1196().sections.get('History').slice(0, 4), ...refines.map(one => `- ${stamp(one)} Partner: refined is ready`)] })
  const high = step('high', [at(16, 12)])
  const waiting = { id: 'w2', at: at(16, 12, 30), ...effortWords(plan(high, at(16, 12, 30)).words[0]), state: 'waiting' }
  const back = step('medium', [at(16, 12), at(16, 15)])
  const closed = whyClosed(waiting, { all: [...CASE, waiting], items: items(back), now: at(16, 15, 10), keep: KEEP, lanes: [lane()] })
  const dropped = { ...waiting, ...closed }
  assert.equal(dropped.moot, true)
  const again = step('high', [at(16, 12), at(16, 15), at(16, 25)])
  const { words, runs } = plan(again, at(16, 25, 30), [...CASE, dropped])
  assert.deepEqual(words.map(one => [one.level, one.changed, one.forModel]), [['high', true, true]])
  assert.deepEqual([runs.get('Worker 5').asked, runs.get('Worker 5').changed.at], [null, at(16, 25)])
  const found = switchOf({ ...lane(), effortRun: { step: 'B1196', ...runs.get('Worker 5') } }, again, view(at(16, 25, 30)))
  assert.deepEqual([found.state, found.late], ['none', false])
})

test('chat 1\'s check: a held step waiting on the person keeps its change: its word goes and the clock counts from the change', () => {
  const waitingOnYou = item({ ...Object.fromEntries(b1196().head), State: 'waiting on you' }, Object.fromEntries(b1196().sections))
  const { words, runs } = plan(waitingOnYou, at(16, 14))
  assert.deepEqual(words.map(one => [one.level, one.changed]), [['high', true]])
  const found = switchOf({ ...lane(), effortRun: { step: 'B1196', ...runs.get('Worker 5') } }, waitingOnYou, view(at(16, 14)))
  assert.deepEqual([found.changedAt, found.late], [at(16, 12), false])
})

test('chat 1\'s check (nit): a changed word whose chat runs its model but whose effort the app\'s file does not show is not met', () => {
  const word = { id: 'w4', at: at(17, 0), ...effortWords({ to: 'Lead', chat: 'Worker 5', session: 'local_88208666', level: 'high', model: OPUS, usual: 'medium', usualModel: SONNET, step: 'B1196', why: 'x', changed: true }), state: 'waiting' }
  const opusStep = b1196({ model: 'opus' })
  const ctx = { all: [word], items: items(opusStep), now: at(17, 1), keep: KEEP, lanes: [lane({ model: OPUS, effort: null })] }
  assert.equal(whyClosed(word, ctx), null)
})

test('chat 1\'s re-check, probe B: a changed word a hand failed for good is no moot word: no new word every pass, the half hour holds', () => {
  const word = plan(b1196(), at(16, 12, 30), [handedWord, envelope]).words[0]
  const failed = { id: 'w2', at: at(16, 12, 30), ...effortWords(word), state: 'failed', failedAt: at(16, 12, 40), why: 'Session local_88208666 not found', tries: 3 }
  for (const now of [at(16, 13), at(16, 20), at(16, 40)]) assert.deepEqual(plan(b1196(), now, [handedWord, envelope, failed]).words, [], `no word at ${new Date(now).toTimeString().slice(0, 5)}`)
})

test('chat 1\'s re-check, probe A: an expired changed word keeps the half hour and the change\'s clock', () => {
  const word = plan(b1196(), at(16, 12, 30)).words[0]
  const expired = { id: 'w2', at: at(16, 12, 30), ...effortWords(word), state: 'expired', closedAt: at(16, 22, 30), why: 'not taken in time' }
  const { words, runs } = plan(b1196(), at(16, 23), [...CASE, expired])
  assert.deepEqual([words, runs.get('Worker 5').changed.at], [[], at(16, 12, 30)])
})

test('chat 1\'s re-check, probe D: a failed word\'s retry copy dropped as superseded is no moot word: no second word beside the taken one', () => {
  const word = effortWords(plan(b1196(), at(16, 12, 30)).words[0])
  const sent = [...CASE,
    { id: 'w2', at: at(16, 12, 30), ...word, state: 'failed', failedAt: at(16, 12, 40), retriedAs: 'w2r', why: 'the app has not reported its model list yet' },
    { id: 'w3', at: at(16, 20), ...word, state: 'taken', takenAt: at(16, 20, 10) },
    { id: 'w2r', at: at(16, 12, 30), ...word, state: 'dropped', why: 'superseded by a newer word for Worker 5\'s setting (16:20)' }]
  assert.deepEqual(plan(b1196(), at(16, 21), sent).words, [])
})

test('chat 1\'s re-check: the sweep keeps the moot mark on the word it closes', async () => {
  const { memoryStore } = await import('../../src/store.mjs')
  const { sweepOutbox } = await import('../../src/work/outboxSweep.mjs')
  const { writeStore } = await import('../../src/work/store.mjs')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'effort-changed-'))
  try {
    const back = b1196({ effort: 'medium', refinedAt: at(16, 15) })
    await writeStore(dir, { items: items(back), activities: [{ name: 'Garden', isFocus: false, steps: ['B1196'], notes: [], loose: [] }] }, undefined, { now: at(16, 0) })
    const outbox = memoryStore()
    await outbox.say({ id: 'w2', at: at(16, 12, 30), ...effortWords(plan(b1196(), at(16, 12, 30)).words[0]), state: 'waiting' })
    await sweepOutbox({ dir, outbox, state: { chats: [lane({ isMain: false, isLeftover: false, isRunning: true })], chatPrefix: '' }, now: at(16, 16), keep: KEEP })
    const closed = outbox.outbox().find(one => one.id === 'w2')
    assert.deepEqual([closed.state, closed.moot], ['dropped', true])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
