// T9.4 (the person, 2026-10-26: "yes, build the follow-up for refines and incidents (ask again every 30 min, after 3 tries
// to me)"): work the board hands the Advisor, that the Advisor takes and then stops on (cut off, crash, clear, forgot), is
// not lost. The repair rule `refine-again` asks again about a step still new whose refine word arrived and whose block was
// never written, the rule `incident-again` about an incident that stays "with the advisor" without a fix: every 30 minutes,
// three times, then one note to the person for that wait. The watch rule repair-repeats does not count these wakes, and the
// Advisor's waiting list on the page keeps such a refine until the block is written. Made-up steps and chats only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { overview, refinedKey } from '../../src/backlog.mjs'
import { ASKS_AGAIN, ASK_AGAIN_MS, BOUNDED_RULES, REPAIR_RULES, findStuck } from '../../src/supervisor/rules/repair.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { applySync, syncRunner } from '../../src/supervisor/loop.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { buildState } from '../../src/state.mjs'
import { advisorWorkOf } from '../../src/work/advisorWork.mjs'
import { workApi } from '../../src/work/api.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { storeBacklog, storeFromText } from '../../src/work/read.mjs'
import { refinedOfItem, refineWaitOf } from '../../src/work/refineWait.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { workLineWhy } from '../../src/work/workLines.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 26, 21, 0).getTime()
/** When the Advisor took the word (or the incident was handed to it): the waits below are counted from here. */
const WORD = NOW - 600 * MIN
const ago = minutes => NOW - minutes * MIN
const at = minutes => WORD + minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(900)), ...more }, sections)
const incident = (id, state, minutes, more = {}) => item({ Id: id, Kind: 'incident', Title: `Lamps stay dark ${id}`, State: state, Since: stamp(at(minutes)), ...more })
const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PARTNER = { name: 'Partner', state: 'working', isRunning: true }

/** The board's refine word for a step, which the Advisor took at `taken`. */
const refineWord = (about, more = {}) => ({
  id: `r-${about}`, command: 'refine', about, to: 'Partner', at: WORD - MIN, takenAt: WORD, deliveredAt: WORD, state: 'delivered',
  round: 1, board: true, before: null, text: `refine step\nStep: ${about} Step ${about}\nRound: 1\nThe answers and feedback are written in the step's refine block.`, ...more,
})
const incidentWord = (about, more = {}) => ({
  id: `i-${about}`, command: 'incident', about, to: 'Partner', at: WORD - MIN, takenAt: WORD, state: 'delivered',
  text: `incident: ${about} Lamps stay dark ${about}\nState: new\nCount: 1 (seen once)\nSource: the rule helper\nSubject: Lead\nEvidence: the lamps\nYour job: roles/partner.md, "Incidents"`, ...more,
})
/** What the board typed to the Advisor for a finding (the wake sends it once per key). */
const sentFor = (finding, more = {}) => ({ id: `s-${finding.key}`, command: 'work', kind: 'sync', syncKey: finding.key, about: finding.fix.id, to: 'Partner', at: NOW, state: 'taken', text: finding.fix.text, ...more })

/** The words of the rule's three asks again, as the board sent them at 30, 60 and 90 minutes, taken by the Advisor. */
const asks = (rule, id, more = {}) => [1, 2, 3].map(period => ({
  id: `a${period}-${id}`, command: 'work', kind: 'sync', syncKey: `${rule} ${id} ${period} 2026-10-26 11:00`, about: id, to: 'Partner', at: at(30 * period), takenAt: at(30 * period), state: 'delivered', text: 'x', ...more,
}))

const world = (more = {}) => ({
  items: items(step('B712', 'new')), lanes: [LEAD], partner: PARTNER, helper: null, prefix: '', now: at(30),
  outbox: [refineWord('B712')], limits: {}, pause: null, refused: [], ...more,
})
const of = (found, check) => found.filter(one => one.check === check)
const refines = more => of(findStuck(world(more)), 'refine-again')
const incidents = more => of(findStuck(world({ items: items(incident('X80', 'with the advisor', 0)), outbox: [incidentWord('X80')], ...more })), 'incident-again')

test('the list: both rules stand in the repair rules, each with its words', () => {
  const ids = REPAIR_RULES.map(rule => rule.id)
  assert.ok(ids.includes('refine-again') && ids.includes('incident-again'))
  for (const id of ['refine-again', 'incident-again']) {
    const rule = REPAIR_RULES.find(one => one.id === id)
    assert.equal(rule.kind, 'repair')
    assert.ok(typeof rule.says === 'string' && rule.says.length > 0)
  }
  assert.equal(ASK_AGAIN_MS, 30 * MIN)
  assert.equal(ASKS_AGAIN, 3)
})

test('refine-again: a refine the Advisor took and did not write is asked again every 30 minutes, three times, each period once', () => {
  assert.deepEqual(refines({ now: at(29) }), [], 'not before 30 minutes')
  const keys = []
  const texts = []
  let outbox = [refineWord('B712')]
  for (const [period, minutes] of [[1, 30], [2, 60], [3, 90]]) {
    const found = refines({ now: at(minutes), outbox })
    assert.equal(found.length, 1, `period ${period}`)
    assert.equal(found[0].subject, 'B712')
    assert.deepEqual([found[0].fix.do, found[0].fix.chat, found[0].fix.id], ['wake', 'Partner', 'B712'])
    assert.match(found[0].key, new RegExp(`^refine-again B712 ${period} \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d$`))
    // The words are the board's first word for the refine, with the line that says it is asked again.
    assert.ok(found[0].fix.text.startsWith('refine step\nStep: B712 Step B712\nRound: 1\n'))
    assert.match(found[0].fix.text, new RegExp(`\\nAsked again \\(${period} of 3\\): no refine block was written for B712 yet; refine it now`))
    keys.push(found[0].key)
    texts.push(found[0].fix.text)
    // Sent once: with its word in the outbox, the rest of the period (runs every 3 minutes) says nothing.
    outbox = [...outbox, sentFor(found[0], { at: at(minutes) })]
    for (const later of [minutes + 3, minutes + 20, minutes + 29]) assert.deepEqual(refines({ now: at(later), outbox }), [], `${later} min`)
  }
  assert.equal(new Set(keys).size, 3, 'a key per period')
  assert.equal(new Set(texts).size, 3)
  // A word of this rule that still waits for the Advisor's chat holds the next one back: nothing stacks up behind it.
  const waiting = { ...sentFor(refines({ now: at(30) })[0]), state: 'waiting' }
  assert.deepEqual(refines({ now: at(60), outbox: [refineWord('B712'), waiting] }), [])
})

test('refine-again: after the third ask the person is told once, with the words and the link', () => {
  const outbox = [refineWord('B712'), ...asks('refine-again', 'B712')]
  assert.equal(refines({ now: at(119), outbox }).length, 0, 'not before the fourth period')
  const found = refines({ now: at(120), outbox })
  assert.equal(found.length, 1)
  assert.deepEqual([found[0].fix.do, found[0].fix.id], ['person', 'B712'])
  assert.deepEqual(found[0].fix.text, ['The Advisor has not refined B712 "Step B712" after 3 asks in 2 hours: refine it on the Backlog, or drop it.', 'Open it: #details=B712'])
  assert.match(found[0].key, /^refine-again B712 person \d{4}-/)
  // No wake any more after the person is told of it; later periods repeat nothing.
  assert.equal(refines({ now: at(150), outbox }).every(one => one.fix.do === 'person'), true)
  // A note of the board's about it for this wait (written before a restart, found in the store) stops it.
  const note = item({ Id: 'N1', Kind: 'note', Via: 'supervisor', From: 'board', To: 'you', State: 'unread', Since: stamp(at(121)), Text: found[0].fix.text[0] }, { About: ['B712'], Text: found[0].fix.text })
  assert.deepEqual(refines({ now: at(150), outbox, items: items(step('B712', 'new'), note) }), [])
  // A note from an earlier wait, another item's, or another kind of note about it does not.
  const old = item({ ...Object.fromEntries(note.head), Since: stamp(WORD - 5 * MIN) }, { About: ['B712'] })
  const other = item({ ...Object.fromEntries(note.head), Id: 'N2' }, { About: ['B713'] })
  const line = item({ ...Object.fromEntries(note.head), Id: 'N3', Text: 'Supervisor: B712 something else' }, { About: ['B712'] })
  assert.equal(refines({ now: at(150), outbox, items: items(step('B712', 'new'), old, other, line) }).length, 1)
})

test('refine-again: the person is told after three asks that reached the Advisor, not after a board or a PC that was off', () => {
  // The PC slept: the word is hours old and nothing was asked yet. The board asks first, three times, and only then tells.
  const outbox = [refineWord('B712')]
  const first = refines({ now: at(400), outbox })
  assert.deepEqual([first.length, first[0].fix.do], [1, 'wake'])
  assert.match(first[0].fix.text, /Asked again \(1 of 3\)/)
  const sent = []
  for (const minutes of [400, 430, 460]) {
    const found = refines({ now: at(minutes), outbox: [...outbox, ...sent] })
    assert.deepEqual([found.length, found[0].fix.do], [1, 'wake'], `${minutes} min`)
    assert.match(found[0].fix.text, new RegExp(`Asked again \\(${sent.length + 1} of 3\\)`))
    sent.push(sentFor(found[0], { at: at(minutes) }))
    assert.deepEqual(refines({ now: at(minutes + 3), outbox: [...outbox, ...sent] }), [], 'once per period')
  }
  assert.equal(new Set(sent.map(one => one.syncKey)).size, 3)
  assert.deepEqual(refines({ now: at(480), outbox: [...outbox, ...sent] }), [], 'the third ask has its period')
  assert.equal(refines({ now: at(490), outbox: [...outbox, ...sent] })[0].fix.do, 'person')
  // A word that never reached the Advisor (it waited and was withdrawn, failed or expired) is no ask.
  for (const state of ['dropped', 'failed', 'expired']) assert.equal(refines({ now: at(150), outbox: [refineWord('B712'), ...asks('refine-again', 'B712', { state, takenAt: undefined })] })[0].fix.do, 'wake', state)
  // Copied for the person to paste (no mod takes the board's words) is an ask; so is a word taken and never reported typed.
  for (const state of ['copied', 'taken']) assert.equal(refines({ now: at(150), outbox: [refineWord('B712'), ...asks('refine-again', 'B712', { state })] })[0].fix.do, 'person', state)
  // Words of an earlier wait (before this word arrived), of another step, or of the other rule are no asks of this wait.
  const strangers = [...asks('refine-again', 'B712').map(one => ({ ...one, at: WORD - 90 * MIN })), ...asks('refine-again', 'B713'), ...asks('incident-again', 'B712')]
  assert.equal(refines({ now: at(150), outbox: [refineWord('B712'), ...strangers] })[0].fix.do, 'wake')
})

test('the person\'s note is filed through the work API, once, and not again by a runner that starts anew', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ask-again-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B712 Draw the strip\n', { now: WORD - 60 * MIN }), undefined, { now: WORD - 60 * MIN })
  let clock = at(121)
  const outbox = [refineWord('B712', { text: 'refine step\nStep: B712 Draw the strip\nRound: 1' }), ...asks('refine-again', 'B712')]
  const woke = []
  const make = () => syncRunner({
    state: async () => ({ chats: [LEAD], advisor: PARTNER, chatPrefix: '', limits: {}, pause: null }),
    items: async () => (await readStore(dir)).items,
    outbox: () => outbox, refused: () => [],
    apply: body => workApi(body, { dir, now: clock, prefix: '', as: 'server' }),
    wake: async one => (woke.push(one), { id: 'w' }),
    noted: { load: async () => [], save: async () => {} },
    now: () => clock,
  })
  const notes = async () => [...(await readStore(dir)).items.values()].filter(one => one.head.get('Kind') === 'note')
  const first = await make().run()
  assert.deepEqual(first.rows.filter(row => row.check === 'refine-again').map(row => row.status), ['Sent'])
  const [note] = await notes()
  assert.deepEqual([note.head.get('Via'), note.head.get('To'), note.sections.get('About')], ['supervisor', 'you', ['B712']])
  assert.match(note.head.get('Text'), /^The Advisor has not refined B712 "Draw the strip" after 3 asks in 2 hours: refine it on the Backlog, or drop it\./)
  // The same runner, a later run; and a new runner with no memory (a board restart): the store says it was told.
  clock += 3 * MIN
  assert.deepEqual((await make().run()).rows.filter(row => row.check === 'refine-again'), [])
  const again = make()
  assert.deepEqual((await again.run()).rows.filter(row => row.check === 'refine-again'), [])
  clock += 40 * MIN
  assert.deepEqual((await again.run()).rows.filter(row => row.check === 'refine-again'), [])
  assert.equal((await notes()).length, 1)
  assert.deepEqual(woke, [])
})

test('the wakes of one wait, run by the runner: three words, then the note; the watch rule repair-repeats files nothing', async () => {
  let clock = at(0)
  const outbox = [refineWord('B712')]
  const applied = []
  const woke = []
  // The store in memory: a note filed stays in it, as in the real one.
  const store = items(step('B712', 'new'))
  const runner = syncRunner({
    state: async () => ({ chats: [LEAD], advisor: PARTNER, chatPrefix: '', limits: {}, pause: null }),
    items: async () => store,
    outbox: () => outbox, refused: () => [],
    apply: async body => {
      applied.push(body)
      if (body.action === 'note') store.set(`N${applied.length}`, item({ Id: `N${applied.length}`, Kind: 'note', Via: body.via, To: body.to, State: 'unread', Since: stamp(clock), Text: body.text.join(' ') }, { About: [body.of] }))
      return { ok: true }
    },
    wake: async one => {
      woke.push(one)
      outbox.push({ id: `s${woke.length}`, command: 'work', kind: 'sync', syncKey: one.key, about: one.id, to: one.chat, at: clock, state: 'taken', text: one.text })
      return { id: `s${woke.length}` }
    },
    noted: { load: async () => [], save: async () => {} },
    now: () => clock,
  }, REPAIR_RULES, WATCH_RULES)
  const findings = []
  for (let minutes = 0; minutes <= 150; minutes += 3) {
    clock = at(minutes)
    findings.push(...(await runner.run()).findings)
  }
  assert.equal(woke.length, 3, 'a word per period, three in all')
  assert.deepEqual(woke.map(one => [one.chat, one.id]), [['Partner', 'B712'], ['Partner', 'B712'], ['Partner', 'B712']])
  assert.equal(new Set(woke.map(one => one.key)).size, 3)
  assert.equal(applied.filter(one => one.action === 'note' && one.to === 'you').length, 1)
  assert.deepEqual(findings.filter(one => one.rule === 'repair-repeats'), [])
  // Four repairs of one rule on one step in a day are a repeat for any other rule, so the exemption is what holds it back.
  const view = buildView({
    state: { chats: [LEAD], today: [], limits: {}, pause: null, chatPrefix: '' }, items: new Map(), now: NOW, settings: { repairsPerDay: 3 },
    repairs: ['refine-again', 'refine-again', 'refine-again', 'incident-again', 'incident-again', 'incident-again', 'unchecked', 'unchecked', 'unchecked']
      .map((rule, index) => ({ at: NOW - index * MIN, rule, subject: rule === 'incident-again' ? 'X80' : 'B712', key: `${rule} ${index}` })),
  })
  const repeats = WATCH_RULES.find(rule => rule.id === 'repair-repeats').check(view, { seen: new Map(), observed: [] })
  assert.deepEqual(repeats.map(one => one.subject), ['B712'])
  assert.match(repeats[0].text, /unchecked for B712/)
  assert.deepEqual([...BOUNDED_RULES].sort(), ['incident-again', 'refine-again'])
})

test('refine-again: the time the person paused does not count, and nothing is said while they pause', () => {
  // The word arrived at 0; the pause ended at 100: the wait counts from there, the first ask is 30 minutes after it.
  const paused = { state: 'running', since: at(100) }
  assert.deepEqual(refines({ now: at(120), pause: paused }), [])
  assert.deepEqual(refines({ now: at(129), pause: paused }), [])
  const found = refines({ now: at(130), pause: paused })
  assert.equal(found.length, 1)
  assert.equal(found[0].fix.do, 'wake')
  assert.match(found[0].fix.text, /Asked again \(1 of 3\)/)
  // Its key is not the key of an unpaused wait's first ask, so the word goes (sendOnce sends a key once).
  assert.notEqual(found[0].key, refines({ now: at(30) })[0].key)
  // A pause that ended before the word does not change the wait.
  assert.equal(refines({ now: at(30), pause: { state: 'running', since: at(-50) } })[0].key, refines({ now: at(30) })[0].key)
  // While the person pauses: nothing, whatever the wait.
  for (const now of [at(30), at(90), at(300)]) assert.deepEqual(refines({ now, pause: { state: 'pausing', since: stamp(ago(5)) } }), [])
})

test('refine-again: nothing without a partner chat, a word that arrived, a step that is new, or a refine that is the Advisor\'s to write', () => {
  assert.deepEqual(refines({ partner: null, now: at(45) }), [])
  assert.equal(refines({ now: at(45) }).length, 1)
  // The word did not arrive: waiting, failed, expired, or copied for the person to paste; or there is none.
  for (const state of ['waiting', 'failed', 'expired', 'copied', 'held']) assert.deepEqual(refines({ now: at(45), outbox: [refineWord('B712', { state, takenAt: undefined, deliveredAt: undefined })] }), [], state)
  assert.deepEqual(refines({ now: at(45), outbox: [] }), [])
  // A taken word that was never reported typed counts as arrived at its taking.
  assert.equal(refines({ now: at(45), outbox: [refineWord('B712', { state: 'taken', deliveredAt: undefined })] }).length, 1)
  // The step left new, or is not a step.
  for (const state of ['refined', 'queued', 'taken', 'in progress', 'review', 'done', 'dropped']) assert.deepEqual(refines({ now: at(45), items: items(step('B712', state)) }), [], state)
  // A fix has its own follow-up (refineGate FIX_RETRY_MS, the watch rule open-fix).
  assert.deepEqual(refines({ now: at(45), items: items(step('B712', 'new', { 'Fix of': 'B700' })) }), [])
  // The Advisor wrote the block since (its round, or a block that changed), so nothing is owed.
  const block = (when, more = '') => ({ Refined: [`  Refined (${when}${more}):`, '  Summary: A strip.', '  Questions:', '  - Which colour? Answer: blue'] })
  assert.deepEqual(refines({ now: at(45), items: items(step('B712', 'new', { Refined: 'open' }, block(stamp(at(10))))), outbox: [refineWord('B712')] }), [], 'a block of its round')
  const key = refinedKey(refinedOfItem(items(), step('B712', 'new', { Refined: 'open' }, block(stamp(WORD - 60 * MIN)))))
  assert.deepEqual(refines({ now: at(45), items: items(step('B712', 'new', { Refined: 'open' }, block(stamp(WORD - 60 * MIN)))), outbox: [refineWord('B712', { round: 1, before: key })] }), [], 'a round-1 block the word saw is round 1 already')
  // A block with an answered question from before the word, asked for its next round, is still owed: asked again.
  assert.equal(refines({ now: at(45), items: items(step('B712', 'new', { Refined: 'open' }, block(stamp(WORD - 60 * MIN)))), outbox: [refineWord('B712', { round: 2, before: key })] }).length, 1)
  // Its questions wait for the person's answers: not the Advisor's.
  const open = { Refined: [`  Refined (${stamp(WORD - 60 * MIN)}):`, '  Goal: A strip.', '  Questions:', '  - Which colour?'] }
  assert.deepEqual(refines({ now: at(45), items: items(step('B712', 'new', { Refined: 'open' }, open)), outbox: [refineWord('B712', { round: 2, before: refinedKey(refinedOfItem(items(), step('B712', 'new', { Refined: 'open' }, open))) })] }), [])
  // The board stopped on it: three of its words arrived since the person last answered.
  const three = [1, 2, 3].map(index => refineWord('B712', { id: `r${index}`, at: WORD - (4 - index) * 40 * MIN, takenAt: WORD - (4 - index) * 40 * MIN + MIN }))
  assert.deepEqual(refines({ now: at(45), outbox: three }), [])
  assert.equal(refineWaitOf(items(step('B712', 'new')), step('B712', 'new'), three), null)
  assert.notEqual(refineWaitOf(items(step('B712', 'new')), step('B712', 'new'), three.slice(0, 2)), null)
})

test('the rule reads a step\'s refine block as the page does: the same key, the asks under the step folded in', () => {
  // The board's word remembers the block's key as the page reads it (`before`); the rule must get the same key, or it would
  // take a block nobody wrote for a written one.
  const text = ['## Work', '- [ ] B20 Plant the garden', '  Refined (round 1, by Oracle, 2026-10-26 10:00):', '  Goal: The garden grows.', '  Questions:', '  - Which seed? Answer: beans', '  - How deep? Answer: a hand', ''].join('\n')
  const store = storeFromText(text, { now: ago(900) })
  store.items.set('Q9', parseItem('Id: Q9\nKind: ask\nTitle: Is it fun?\nState: open\nOwner: Lead\nSince: 2026-10-26 11:00\nAsks: look\nOf: B20\n\n## History\n- 2026-10-26 11:00 Lead: asked\n'))
  const shown = overview(storeBacklog(store, { prefix: '', names: [] }).backlog).flatMap(activity => activity.steps).find(one => one.id === 'B20')
  assert.equal(shown.refined.asks.length, 1, 'the open ask is one of the block\'s questions')
  assert.equal(refinedKey(refinedOfItem(store.items, store.items.get('B20'))), refinedKey(shown.refined))
  store.items.delete('Q9')
  const plain = overview(storeBacklog(store, { prefix: '', names: [] }).backlog).flatMap(activity => activity.steps).find(one => one.id === 'B20')
  assert.equal(refinedKey(refinedOfItem(store.items, store.items.get('B20'))), refinedKey(plain.refined))
})

test('incident-again: an incident with the Advisor and no fix is asked again every 30 minutes, three times, then told to the person', () => {
  assert.deepEqual(incidents({ now: at(29) }), [])
  const keys = []
  let outbox = [incidentWord('X80')]
  for (const [period, minutes] of [[1, 30], [2, 60], [3, 90]]) {
    const found = incidents({ now: at(minutes), outbox })
    assert.equal(found.length, 1, `period ${period}`)
    assert.equal(found[0].subject, 'X80')
    assert.deepEqual([found[0].fix.do, found[0].fix.chat, found[0].fix.id], ['wake', 'Partner', 'X80'])
    assert.match(found[0].key, new RegExp(`^incident-again X80 ${period} \\d{4}-`))
    // The incident's word as the board typed it first (its evidence and job), with the line that says it is asked again.
    assert.ok(found[0].fix.text.startsWith('incident: X80 Lamps stay dark X80\nState: new\n'))
    assert.match(found[0].fix.text, new RegExp(`\\nAsked again \\(${period} of 3\\): it still has no fix step; name its fix \\(work incident-fix X80\\) or, if no fault is left, close it \\(work drop X80\\)\\.$`))
    keys.push(found[0].key)
    outbox = [...outbox, sentFor(found[0], { at: at(minutes) })]
    assert.deepEqual(incidents({ now: at(minutes + 3), outbox }), [], 'once per period')
  }
  assert.equal(new Set(keys).size, 3)
  // Without its word in the outbox the words still say what to do.
  assert.match(incidents({ now: at(30), outbox: [] })[0].fix.text, /^incident: X80 Lamps stay dark X80\nYour job: roles\/partner\.md, "Incidents"\nAsked again \(1 of 3\)/)
  // Then the person, once.
  const told = incidents({ now: at(120), outbox })
  assert.deepEqual([told[0].fix.do, told[0].fix.id], ['person', 'X80'])
  assert.deepEqual(told[0].fix.text, ['Incident X80 "Lamps stay dark X80" has been with the Advisor for 2 hours without a fix, after 3 asks: look at it under Supervisor.', 'Open it: #supervisor'])
  const note = item({ Id: 'N1', Kind: 'note', Via: 'supervisor', To: 'you', State: 'unread', Since: stamp(at(125)), Text: told[0].fix.text[0] }, { About: ['X80'] })
  assert.deepEqual(incidents({ now: at(160), outbox, items: items(incident('X80', 'with the advisor', 0), note) }), [])
  // The incident's own line to the person ("Supervisor: ...", filed when it opened) is no such note.
  const own = item({ Id: 'N2', Kind: 'note', Via: 'supervisor', To: 'you', State: 'unread', Since: stamp(at(0)), Text: 'Supervisor: Lamps stay dark X80' }, { About: ['X80'] })
  assert.equal(incidents({ now: at(160), outbox, items: items(incident('X80', 'with the advisor', 0), own) }).length, 1)
})

test('incident-again: it stops by itself when the incident gets a fix, is fixed or closed, or is not with the Advisor', () => {
  const at45 = state => incidents({ now: at(45), items: items(incident('X80', state, 0, state === 'fix' ? { Fix: 'B9' } : {})) })
  assert.equal(at45('with the advisor').length, 1)
  for (const state of ['fix', 'fixed', 'closed', 'open', 'came back']) assert.deepEqual(at45(state), [], state)
  // A fix named while the state still reads "with the advisor" stops it too.
  assert.deepEqual(incidents({ now: at(45), items: items(incident('X80', 'with the advisor', 0, { Fix: 'B9' })) }), [])
  // Counted from when it got that state: a returning incident (a new Since) is a new wait.
  assert.deepEqual(incidents({ now: at(45), items: items(incident('X80', 'with the advisor', 30)) }), [])
  assert.equal(incidents({ now: at(60), items: items(incident('X80', 'with the advisor', 30)) }).length, 1)
  // No partner, or the person pauses: nothing. The time they paused does not count.
  assert.deepEqual(incidents({ now: at(45), partner: null }), [])
  assert.deepEqual(incidents({ now: at(45), pause: { state: 'pausing', since: stamp(ago(5)) } }), [])
  assert.deepEqual(incidents({ now: at(130), pause: { state: 'running', since: at(110) } }), [])
  assert.equal(incidents({ now: at(140), pause: { state: 'running', since: at(110) } })[0].fix.do, 'wake')
})

test('the person fix: a note of the board\'s Via supervisor about the item, one row Sent; one the store refuses goes to Main once', async () => {
  const finding = { check: 'refine-again', key: 'refine-again B712 person 2026-10-26 18:00', text: 'B712 still waits for the Advisor after 3 asks: told to you', fix: { do: 'person', id: 'B712', text: ['The Advisor has not refined B712 "A" after 3 asks in 2 hours: refine it on the Backlog, or drop it.', 'Open it: #details=B712'] } }
  const filed = []
  const done = await applySync([finding], { person: async body => (filed.push(body), { ok: true }) }, new Set())
  assert.deepEqual(filed, [{ of: 'B712', text: finding.fix.text }])
  assert.deepEqual(done.rows, [{ check: 'refine-again', status: 'Sent', text: 'B712 still waits for the Advisor after 3 asks: told to you: to you as a note' }])
  assert.deepEqual(done.note, [])
  // Refused (or thrown): For Main, told once per key.
  const refused = await applySync([finding], { person: async () => ({ ok: false, why: 'B712 is gone' }) }, new Set())
  assert.deepEqual(refused.rows.map(row => row.status), ['For Main'])
  assert.match(refused.rows[0].text, /the note to you was not filed \(B712 is gone\)/)
  assert.equal(refused.note.length, 1)
  const thrown = await applySync([finding], { person: async () => { throw new Error('EBUSY') } }, new Set([finding.key]))
  assert.deepEqual([thrown.rows.map(row => row.status), thrown.note], [['For Main'], []])
  // The runner files it as one of the supervisor's own notes, to the person.
  const applied = []
  const runner = syncRunner({
    state: async () => ({ chats: [LEAD], advisor: PARTNER, chatPrefix: '', limits: {}, pause: null }),
    items: async () => items(step('B712', 'new')), outbox: () => [refineWord('B712'), ...asks('refine-again', 'B712')], refused: () => [],
    apply: async body => (applied.push(body), { ok: true }), wake: async () => ({ id: 'w' }),
    noted: { load: async () => [], save: async () => {} }, now: () => at(121),
  })
  await runner.run()
  const note = applied.find(one => one.action === 'note')
  assert.deepEqual([note.to, note.of, note.via], ['you', 'B712', 'supervisor'])
  assert.equal(note.text.length, 2)
})

test('the board\'s words that ask again hold while their item is open, and are withdrawn once it is not', () => {
  const word = (key, about, at = NOW - MIN) => ({ id: key, command: 'work', kind: 'sync', syncKey: key, about, to: 'Partner', at, state: 'waiting' })
  const why = (message, ...all) => workLineWhy(message, items(...all), { now: NOW })
  // A refine: while the step is new; gone once it left new.
  assert.equal(why(word('refine-again B712 1 2026-10-26 11:00', 'B712'), step('B712', 'new')), null)
  assert.equal(why(word('refine-again B712 1 2026-10-26 11:00', 'B712'), step('B712', 'refined')), 'B712 is refined')
  assert.equal(why(word('refine-again B712 1 2026-10-26 11:00', 'B712')), 'B712 is gone')
  // An incident: while it is with the Advisor (the sync lines of other checks keep their reading: an incident is not "open" for them).
  assert.equal(why(word('incident-again X80 1 2026-10-26 11:00', 'X80'), incident('X80', 'with the advisor', 0)), null)
  assert.equal(why(word('incident-again X80 1 2026-10-26 11:00', 'X80'), incident('X80', 'fix', 0)), 'X80 is fix')
  assert.equal(why(word('incident-again X80 1 2026-10-26 11:00', 'X80'), incident('X80', 'closed', 0)), 'X80 is closed')
  // Like every word of the sync check: the check decides anew after half an hour.
  assert.match(why(word('refine-again B712 1 2026-10-26 11:00', 'B712', NOW - 31 * MIN), step('B712', 'new')), /decides anew after 30 min/)
})

test('the Advisor\'s list: the word it took stands for the step on it, and the board\'s ask again counts as the same ask', () => {
  const list = (words, refinesOpen) => advisorWorkOf({ items: items(), outbox: words, refines: refinesOpen, titleOf: () => 'A strip' })
  const open = [{ id: 'B712', title: 'A strip', word: refineWord('B712') }]
  const asked = { ...sentFor({ key: 'refine-again B712 1 2026-10-26 11:00', fix: { id: 'B712', text: 'x' } }), state: 'delivered', takenAt: NOW - 2 * MIN }
  assert.equal(list([refineWord('B712')], open).on.kind, 'refine')
  const again = list([refineWord('B712', { takenAt: ago(300), deliveredAt: ago(300) }), asked], open)
  assert.deepEqual([again.on.kind, again.on.id, again.on.since], ['refine', 'B712', NOW - 2 * MIN])
  const incidentAsk = { ...asked, syncKey: 'incident-again X80 1 2026-10-26 11:00', about: 'X80' }
  assert.deepEqual([list([incidentAsk], []).on], [null], 'an incident that is not open is nothing it is on')
  const open80 = advisorWorkOf({ items: items(incident('X80', 'with the advisor', 0)), outbox: [incidentAsk], refines: [], titleOf: () => null })
  assert.deepEqual([open80.on.kind, open80.on.id], ['incident', 'X80'])
})

// ---- the state: the Advisor's waiting list ----

const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: ago(5), lastAssistantUuid: 'u-1' })
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })

/** The board's state with these store items (steps) and board words; the Advisor idle. */
function build({ steps, outbox = [] }) {
  const store = storeFromText('## Garden\n', { now: ago(900) })
  for (const one of steps) {
    store.items.set(one.head.get('Id'), one)
    store.activities[0].steps.push(one.head.get('Id'))
  }
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(ago(30), 'ok')]), 'cli-Digger': tail([answer(ago(30), 'ok')]), 'cli-Advisor': tail([typed(ago(200), 'Plan the pond'), answer(ago(199), 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work: store,
  }
  return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config })
}
const sent = (about, more = {}) => ({ id: `w-${about}`, at: ago(150), to: 'Advisor', ask: null, step: null, title: null, version: null, verdict: null, command: 'refine', about, round: 1, text: 'refine step', state: 'delivered', takenAt: ago(149), deliveredAt: ago(149), board: true, before: null, ...more })
/** A step of the store as its file reads, in `state`, with these lines of a refine block (none: no block). */
const stepFile = (id, state, block = []) => parseItem([
  `Id: ${id}`, 'Kind: step', `Title: Plant the ${id}`, `State: ${state}`, `Since: ${stamp(ago(900))}`, ...(block.length === 0 ? [] : ['Refined: open']), '',
  ...(block.length === 0 ? [] : ['## Refined', ...block, '']), '## History', `- ${stamp(ago(900))} Lead: made`, '',
].join('\n'))
const waitingRefines = state => state.advisor.waiting.filter(one => one.kind === 'refine').map(one => [one.id, one.stand.kind, one.stand.since])

test('the state: a refine the Advisor took stays in its list past half an hour, until the block is written or the step leaves new', () => {
  // Taken 149 minutes ago (the page used to drop it after 30), the Advisor idle: "took it".
  assert.deepEqual(waitingRefines(build({ steps: [stepFile('B20', 'new')], outbox: [sent('B20')] })), [['B20', 'taken', ago(149)]])
  // The block was written since (the round the word asked for): out of the list.
  const block = ['  Refined (round 1, by Oracle, 2026-10-26 19:00):', '  Summary: A plant.']
  assert.deepEqual(waitingRefines(build({ steps: [stepFile('B20', 'new', block)], outbox: [sent('B20')] })), [])
  // The step left new: out of the list at once, not after half an hour.
  for (const state of ['queued', 'in progress', 'done', 'dropped']) assert.deepEqual(waitingRefines(build({ steps: [stepFile('B20', state)], outbox: [sent('B20')] })), [], state)
  // A later round of a step that waits refined is still the Advisor's to write (outboxSweep reads it so too).
  assert.deepEqual(waitingRefines(build({ steps: [stepFile('B20', 'refined')], outbox: [sent('B20', { round: 2 })] })).map(one => one[0]), ['B20'])
  // A word that waits (the Advisor not running yet) is queued, as before; a failed one is no refine it took.
  assert.deepEqual(waitingRefines(build({ steps: [stepFile('B20', 'new')], outbox: [sent('B20', { state: 'waiting', at: ago(10), takenAt: undefined, deliveredAt: undefined })] })), [['B20', 'queued', ago(10)]])
  assert.deepEqual(waitingRefines(build({ steps: [stepFile('B20', 'new')], outbox: [sent('B20', { state: 'failed' })] })), [])
})
