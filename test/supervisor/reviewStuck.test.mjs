// B543, the fix of X8: steps piled up in review (one for 3 days behind a dropped fix, four for hours behind a chain of
// fixes, checks stopped by the pause). A step in review says what it waits for (its first check, its check again, the
// person's answer, its open fix B<n>); the watch rule `review-stuck` names one stuck (no check for over an hour), the
// rule `dropped-fix` one whose fix was dropped (B630), never one that waits for an open fix or is blocked; the repair `fix-dropped` gives the main chat one word for a step
// whose fix was dropped. Made-up items; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { SUPERVISOR_DEFAULTS } from '../../src/config.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { reviewWaitOf } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { workApi } from '../../src/work/api.mjs'
import { reviewWaitOfStep } from '../../src/work/read.mjs'
import { writeStore } from '../../src/work/store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 19, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const passed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const failed = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 1 of 2 points pass; fix ${fix} for Painter`
/** A step in review whose board check passed `minutes` ago, with agreed points (so it needs a result check). */
const reviewed = (id, minutes, more = [], head = {}) => item(
  { Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(minutes)), ...head },
  { 'What we build': ['- a lamp at every bench'], History: [passed(minutes), ...more] },
)
const fixStep = (id, of, state, minutes = 30) => item({ Id: id, Kind: 'step', Title: `Fix: ${of}`, State: state, Owner: 'Painter', Since: stamp(ago(minutes)), 'Fix of': of })
const ask = (id, of, state) => item({ Id: id, Kind: 'ask', Title: `Ask ${id}`, State: state, Of: of, Since: stamp(ago(50)) })

const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PARTNER = { name: 'Partner', state: 'working', isRunning: true }
const view = (store, more = {}) => buildView({
  state: { chats: [LEAD], today: [], limits: {}, pause: more.pause ?? null, chatPrefix: '' },
  items: store, outbox: more.outbox ?? [], settings: more.settings ?? {}, now: more.now ?? NOW,
})
const watch = (board, seen = new Map()) => WATCH_RULES.find(one => one.id === 'review-stuck').check(board, { seen, observed: [] })
const dropWatch = (board, seen = new Map()) => WATCH_RULES.find(one => one.id === 'dropped-fix').check(board, { seen, observed: [] })
const repairs = (store, more = {}) => findStuck({ items: store, lanes: [LEAD], partner: PARTNER, now: NOW, ...more }).filter(one => one.check === 'fix-dropped')

/** The fix chain of X8: each step's check failed and made the next its fix; the last fix is still queued. */
const CHAIN = items(
  reviewed('B454', 300, [failed(290, 'B512')]),
  reviewed('B512', 240, [failed(230, 'B519')], { 'Fix of': 'B454' }),
  reviewed('B519', 200, [failed(190, 'B524')], { 'Fix of': 'B512' }),
  reviewed('B524', 160, [failed(150, 'B536')], { 'Fix of': 'B519' }),
  fixStep('B536', 'B524', 'queued', 150),
)

test('reviewWaitOf: what a step in review waits for, in words', () => {
  assert.deepEqual(reviewWaitOf(reviewed('B7', 20), items()), { kind: 'check', fix: null, since: ago(20), text: 'waits for its first check' })
  // Its check failed and made a fix: it waits for that fix while it is open, whatever the fix's own state.
  for (const state of ['queued', 'in progress', 'review']) {
    const store = items(reviewed('B7', 90, [failed(80, 'B8')]), fixStep('B8', 'B7', state))
    assert.equal(reviewWaitOf(store.get('B7'), store).text, 'waits for its fix B8')
    assert.equal(reviewWaitOf(store.get('B7'), store).kind, 'fix')
  }
  // The fix was dropped: nothing will close it.
  const dropped = items(reviewed('B7', 90, [failed(80, 'B8')]), fixStep('B8', 'B7', 'dropped', 40))
  assert.deepEqual(reviewWaitOf(dropped.get('B7'), dropped), { kind: 'dropped', fix: 'B8', since: ago(40), text: 'its fix B8 was dropped' })
  // A newer fix is open beside a dropped one: it waits for that one.
  const again = items(reviewed('B7', 90, [failed(80, 'B8'), failed(30, 'B9')]), fixStep('B8', 'B7', 'dropped'), fixStep('B9', 'B7', 'queued'))
  assert.equal(reviewWaitOf(again.get('B7'), again).text, 'waits for its fix B9')
  // Its fix is done but the step is not through: the partner checks it again.
  const fixed = items(reviewed('B7', 90, [failed(80, 'B8')]), fixStep('B8', 'B7', 'done', 25))
  assert.deepEqual(reviewWaitOf(fixed.get('B7'), fixed), { kind: 'check', fix: 'B8', since: ago(25), text: 'waits for its check again' })
  // A point for the person: their answer while the ask is open, the check again once it is answered.
  const waits = `- ${stamp(ago(40))} Checker: result check waits for you: 1 of 2 points pass; 1 for you to judge`
  assert.equal(reviewWaitOf(reviewed('B7', 90, [waits]), items(ask('Q1', 'B7', 'open'))).text, 'waits for your answer to its check')
  assert.deepEqual(reviewWaitOf(reviewed('B7', 90, [waits]), items(ask('Q1', 'B7', 'answered'))), { kind: 'check', fix: null, since: ago(40), text: 'waits for its check again' })
  // Nothing to say: not in review, its board check not passed, no result check needed, or its check passed.
  assert.equal(reviewWaitOf(fixStep('B7', 'B1', 'queued'), items()), null)
  assert.equal(reviewWaitOf(item({ Id: 'B7', Kind: 'step', State: 'review' }, { 'What we build': ['- a lamp'], History: [`- ${stamp(ago(5))} server: check pending`] }), items()), null)
  assert.equal(reviewWaitOf(item({ Id: 'B7', Kind: 'step', State: 'review' }, { History: [passed(90)] }), items()), null)
  assert.equal(reviewWaitOf(reviewed('B7', 90, [`- ${stamp(ago(5))} Checker: result check passed: 2 of 2 points pass`]), items()), null)
})

test('the fix chain of X8 waits for its fixes: every step says which, and none of them is stuck', () => {
  assert.deepEqual(['B454', 'B512', 'B519', 'B524'].map(id => reviewWaitOf(CHAIN.get(id), CHAIN).text),
    ['waits for its fix B512', 'waits for its fix B519', 'waits for its fix B524', 'waits for its fix B536'])
  assert.deepEqual(watch(view(CHAIN)), [])
  assert.deepEqual(repairs(CHAIN), [])
})

test('review-stuck: a step with no result check for over an hour is stuck, one under an hour is not', () => {
  assert.equal(SUPERVISOR_DEFAULTS.reviewMinutes, 60)
  assert.deepEqual(watch(view(items(reviewed('B7', 55)))), [])
  const found = watch(view(items(reviewed('B7', 75))), new Map())
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['review-stuck', 'review-stuck B7 check', 'B7']])
  assert.equal(found[0].text, 'B7 in review 75 min with no result check filed (waits for its first check)')
  // The check words the partner was sent and did not answer stand in the evidence.
  const outbox = [{ command: 'result-check', about: 'B7', to: 'Partner', at: ago(74), state: 'taken' }, { syncKey: 'unchecked B7 1', about: 'B7', to: 'Partner', at: ago(40), state: 'taken' }]
  assert.match(watch(view(items(reviewed('B7', 75)), { outbox }))[0].evidence, /2 check words to Partner, the last at \d\d:\d\d/)
  // A check again after its fix was done counts from when the fix was done; the setting moves the threshold.
  const fixed = items(reviewed('B7', 300, [failed(280, 'B8')]), fixStep('B8', 'B7', 'done', 70))
  assert.equal(watch(view(fixed))[0].text, 'B7 in review 70 min with no result check filed (waits for its check again)')
  assert.deepEqual(watch(view(fixed, { settings: { reviewMinutes: 90 } })), [])
  // While the person pauses, nothing.
  assert.deepEqual(watch(view(items(reviewed('B7', 75)), { pause: { state: 'pausing', since: stamp(ago(10)) } })), [])
})

test('B662 (X60): a check word typed again gets its 30 minutes before a step in review is stuck', () => {
  assert.equal(SUPERVISOR_DEFAULTS.checkWordMinutes, 30)
  const word = minutes => [{ syncKey: 'unchecked B655 1', about: 'B655', to: 'Partner', at: ago(minutes), state: 'taken' }]
  // B655: 97 min in review, the repair typed the check word a minute ago: no case yet.
  assert.deepEqual(watch(view(items(reviewed('B655', 97)), { outbox: word(1) })), [])
  assert.deepEqual(watch(view(items(reviewed('B655', 97)), { outbox: word(30) })), [])
  // The same step half an hour later, the word unanswered for 31 minutes: a case, the evidence names the word.
  const late = watch(view(items(reviewed('B655', 97)), { outbox: word(31) }))
  assert.deepEqual(late.map(one => one.key), ['review-stuck B655 check'])
  assert.match(late[0].evidence, /1 check word to Partner/)
  // A word typed again restarts the 30 minutes: the older one does not count.
  const again = [...word(80), { ...word(5)[0], syncKey: 'unchecked B655 2' }]
  assert.deepEqual(watch(view(items(reviewed('B655', 97)), { outbox: again })), [])
  // No word at all is a case as before; the setting moves the age.
  assert.equal(watch(view(items(reviewed('B655', 97)))).length, 1)
  assert.equal(watch(view(items(reviewed('B655', 97)), { outbox: word(31), settings: { checkWordMinutes: 45 } })).length, 0)
})

test('B585 (X33): a first check counts from the board check that asked it, not from the move to review', () => {
  // B522: to review at 21:41 (75 min ago), its board check failed and passed at 22:04 (52 min ago), after its report again.
  const b522 = (review, asked) => item(
    { Id: 'B522', Kind: 'step', Title: 'Step B522', State: 'review', Owner: 'Painter', Since: stamp(ago(review)) },
    { 'What we build': ['- a lamp at every bench'], History: [`- ${stamp(ago(review))} Painter: in progress → review`, `- ${stamp(ago(review - 1))} server: check failed: no tests bite`, `- ${stamp(ago(asked + 1))} Painter: reported again`, passed(asked)] },
  )
  assert.deepEqual(reviewWaitOf(b522(75, 52), items()), { kind: 'check', fix: null, since: ago(52), text: 'waits for its first check' })
  // Under the review minutes from the check word: no finding, though over an hour in review.
  assert.deepEqual(watch(view(items(b522(75, 52)), { outbox: [{ command: 'result-check', about: 'B522', to: 'Partner', at: ago(52), state: 'delivered' }] })), [])
  // Past them from the check word: still one.
  const late = watch(view(items(b522(100, 65))))
  assert.deepEqual(late.map(one => [one.key, one.text]), [['review-stuck B522 check', 'B522 in review 65 min with no result check filed (waits for its first check)']])
  // The repair's wake counts from it too: under 30 minutes from the check word, no wake.
  const wakes = minutes => findStuck({ items: items(b522(75, minutes)), lanes: [LEAD], partner: PARTNER, now: NOW }).filter(one => one.check === 'unchecked')
  assert.deepEqual(wakes(20), [])
  assert.equal(wakes(35).length, 1)
})

test('review-stuck: a step waiting for an open fix or for the person\'s answer is not stuck; a dropped fix is the rule dropped-fix\'s', () => {
  const dropped = items(reviewed('B472', 4000, [failed(1200, 'B485')]), fixStep('B485', 'B472', 'dropped', 450))
  assert.deepEqual(watch(view(dropped)), [])
  const open = items(reviewed('B472', 4000, [failed(1200, 'B485')]), fixStep('B485', 'B472', 'queued', 450))
  assert.deepEqual(watch(view(open)), [])
  const waits = `- ${stamp(ago(400))} Checker: result check waits for you: 1 of 2 points pass; 1 for you to judge`
  assert.deepEqual(watch(view(items(reviewed('B7', 500, [waits]), ask('Q1', 'B7', 'open')))), [])
})

test('B630 (X54): a dropped fix with the step blocked by an open step is a plan; without a block the partner hears of it after 30 min', () => {
  const store = (minutes, head = {}, blocker = null) => items(reviewed('B472', 4000, [failed(1200, 'B485')], head), fixStep('B485', 'B472', 'dropped', minutes), ...(blocker === null ? [] : [blocker]))
  const moving = item({ Id: 'B623', Kind: 'step', Title: 'Step B623', State: 'in progress', Owner: 'Painter', Since: stamp(ago(30)) })
  // reviewWaitOf: 'blocked' while an open step blocks it ("Blocked by" or "Waits for"), else 'dropped'.
  const blocked = store(150, { 'Blocked by': 'B623' }, moving)
  assert.deepEqual(reviewWaitOf(blocked.get('B472'), blocked), { kind: 'blocked', fix: 'B485', blockers: ['B623'], since: ago(150), text: 'its fix B485 was dropped, waits for B623' })
  const words = store(150, { 'Waits for': 'after B623' }, moving)
  assert.equal(reviewWaitOf(words.get('B472'), words).kind, 'blocked')
  const ended = store(150, { 'Blocked by': 'B623' }, item({ Id: 'B623', Kind: 'step', State: 'done' }))
  assert.equal(reviewWaitOf(ended.get('B472'), ended).kind, 'dropped')
  // The watch rule: 45 min after the drop one incident; a block, 10 min, or the pause: none.
  const found = dropWatch(view(store(45)))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['dropped-fix', 'fix-dropped B472', 'B472']])
  assert.equal(found[0].text, 'B472 in review, but its fix B485 was dropped: nothing will close it')
  assert.deepEqual(dropWatch(view(store(10))), [])
  assert.deepEqual(dropWatch(view(blocked)), [])
  assert.deepEqual(dropWatch(view(store(45), { pause: { state: 'pausing', since: stamp(ago(5)) } })), [])
  // X54: B609's fix dropped 2 h ago while B623 blocks it: quiet; once B623 is done, raised.
  assert.deepEqual(dropWatch(view(store(120, { 'Blocked by': 'B623' }, moving))), [])
  assert.equal(dropWatch(view(ended)).length, 1)
  // The repair that tells the main chat stays quiet under a block too.
  assert.deepEqual(repairs(blocked), [])
})

test('fix-dropped: the main chat gets one word, close it or check it again, half an hour after the drop', () => {
  const store = minutes => items(reviewed('B472', 4000, [failed(1200, 'B485')]), fixStep('B485', 'B472', 'dropped', minutes))
  const found = repairs(store(45))
  assert.deepEqual(found.map(one => [one.key, one.subject, one.fix.do]), [['fix-dropped B472 B485', 'B472', 'send']])
  assert.match(found[0].fix.text, /^B472 waits in review, but its fix B485 was dropped: close it .*or have it checked again/)
  assert.deepEqual(repairs(store(10)), [])
  assert.deepEqual(repairs(store(45), { pause: { state: 'pausing', since: stamp(ago(5)) } }), [])
})

test('the Backlog line says what a step in review waits for: on the Backlog tab and in the work tool list', async t => {
  const store = items(reviewed('B7', 90, [failed(80, 'B8')]), fixStep('B8', 'B7', 'queued'), reviewed('B9', 20))
  const work = { ok: true, items: store, activities: [{ name: 'Work', steps: ['B7', 'B8', 'B9'] }] }
  assert.deepEqual(['B7', 'B8', 'B9'].map(id => reviewWaitOfStep(work, id)), ['waits for its fix B8', null, 'waits for its first check'])
  // The row on the Backlog tab shows it beside the title, and the state hands it to the page.
  const page = await readFile(join(HERE, '..', '..', 'public', 'board.js'), 'utf8')
  const row = page.slice(page.indexOf('function blockLine('), page.indexOf('function blockLine(') + 1600)
  assert.match(row, /step\.reviewWait/)
  const state = await readFile(join(HERE, '..', '..', 'src', 'state.mjs'), 'utf8')
  assert.match(state, /reviewWait: reviewWaitOfStep\(raw\.work, step\.key, reconciled\?\.ready\?\.held \?\? null\)/)
  // The work tool's one line per step.
  const dir = await mkdtemp(join(tmpdir(), 'b543-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeStore(dir, { items: store, activities: [{ name: 'Work', steps: ['B7', 'B8', 'B9'] }] }, undefined, { now: NOW })
  const mine = await workApi({ action: 'next', chat: 'Painter' }, { dir, now: NOW, roleOf: () => 'person' })
  assert.equal(mine.ok, true, mine.why)
  assert.match(mine.result.text, /- B7 review \(waits for its fix B8\): Step B7/)
  assert.match(mine.result.text, /- B9 review \(waits for its first check\): Step B9/)
  const listed = await workApi({ action: 'list', chat: 'Lead' }, { dir, now: NOW, roleOf: () => 'main' })
  assert.match(listed.result.text, /^B7 · step · review \(waits for its fix B8\) · Painter/m)
  assert.match(listed.result.text, /^B8 · step · queued · Painter/m)
})
