// B1240 (F31, the person's "1. yes", 2026-11-16, after their screenshot of "recap stuff" they could not see): only finished work waits
// for the goal's recap. The live case: Worker 3 sat parked 44 h on B1149 (in progress) with Q789 (decide, Route recap): the lane parked
// for the recap (waitsOn.mjs `keptRecapWaitOf`), while the recap counts a step toward the goal demo only in review (autopilot.mjs
// `recapWaitOf`), so neither moved. Now an ask of a step at work is routed by the other rules (`recapOr`), one routed to the recap before
// is routed anew at the next pass with one History line (api.mjs `autopilot`), a kept look parks no lane, and a step in review whose only
// open asks are kept looks counts for the demo once its checks stand (chat 1's other door). A step in review in a work block keeps the
// recap route; one in no work block of the goal (the live Q817 on B1205: no G95 block lists it) is routed as one at work, as no recap
// judges it (chat 1's review). Trimmed from the live records; made-up paths and chats only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { autopilotRoute, isInNoBlock, recapWaitOf, waitsForKeptLooksOnly } from '../src/work/autopilot.mjs'
import { reroutedAtWorkWords, reroutedNoBlockWords, workApi } from '../src/work/api.mjs'
import { parseGoals } from '../src/goals.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, share } from '../src/work/store.mjs'
import { keptRecapWaitOf } from '../src/work/waitsOn.mjs'

share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 16, 10, 30).getTime()
const at = minutes => stamp(NOW - minutes * MIN)
const KEPT = "Autopilot keeps this look for the goal's recap"

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const step = (id, fields, sections = {}) => text({ Id: id, Kind: 'step', Activity: 'Art', Since: at(90), Goal: 'G95', ...fields }, { ...sections, History: [`- ${at(90)} Lead: made`] })
const ask = (id, fields, sections = {}) => text({ Id: id, Kind: 'ask', State: 'open', Since: at(50), Filed: String(NOW - 50 * MIN), Blocking: 'no', ...fields }, { Text: [fields.Title], ...sections, History: [`- ${at(50)} ${fields.Owner ?? 'server'}: asked (${fields.Asks ?? 'decide'})`, `- ${at(50)} server: autopilot: routed to ${fields.Route ?? 'person'}`] })

/** B1149 as it stood: the Red Mage in progress, its Context marked for the recap. */
const B1149 = (state = 'in progress') => step('B1149', { Title: 'Redraw the Red Mage to the Knight\'s sheet', State: state, Owner: 'Painter' }, { Context: ['  Redraw the Red Mage.', '  Recap verdict: waits (Q789)'] })
/** Q789 as it stood open: Worker 3's verdict question, routed to the recap. */
const Q789 = (more = {}) => ask('Q789', { Title: 'Red Mage scores 62 of 75: redraw or accept?', Owner: 'Painter', Pictures: 'art/G95/B1149/demo-closeup.png', Asks: 'decide', Of: 'B1149', Options: 'A Redraw the model sheet and all sheets | B Merge as it is, fix step later', Advice: 'A', Route: 'recap', ...more })
/** B1205 as it stands: the Archer in review, its check done, below its bar. */
const B1205 = () => step('B1205', { Title: 'An own move per ability: the Archer\'s shot', State: 'review', Owner: 'Builder' }, { Context: ['  The shot.', '  Recap verdict: waits (Q817)'] })
const QA1205 = () => step('B1230', { Title: 'Quality Assurance: B1205', State: 'done', Owner: 'Checker', Checks: 'B1205' })
/** Q817: the board's Accept card on B1205, routed to the recap. */
const Q817 = () => ask('Q817', { Title: 'Accept B1205 at 58 of 75, or send it back?', Pictures: 'art/B1205/evidence.png', Asks: 'decide', Of: 'B1205', Options: 'A Accept: done as it is | B Send back: the partner makes another try from your note', Via: 'accept', Route: 'recap' })
/** B1206: a step of a G95 work block in review with the board's Accept card Q818 on the recap (the good case Q817 was meant to be). */
const B1206 = () => step('B1206', { Title: 'The Knight\'s cleave', State: 'review', Owner: 'Builder' }, { Context: ['  The cleave.', '  Recap verdict: waits (Q818)'] })
const QA1206 = () => step('B1231', { Title: 'Quality Assurance: B1206', State: 'done', Owner: 'Checker', Checks: 'B1206' })
const Q818 = () => Q817().replace(/Q817/g, 'Q818').replace(/B1205/g, 'B1206')
/** The steps G95's work blocks list (server.mjs `focusSteps`): B1205 is in none, as live. */
const BLOCK_STEPS = ['B1149', 'B1206']
/** A worker's look with a picture of a G95 step, kept for the recap. */
const keptLook = (id, of, more = {}) => ask(id, { Title: 'Does the mage read at play size?', Owner: 'Painter', Pictures: `art/G95/${of}/demo.png`, Asks: 'look', Of: of, Advice: 'yes', Route: 'recap', ...more }, { Route: [KEPT] })

const ROLES = { Lead: 'main', Partner: 'advisor', Painter: 'worker', Builder: 'worker', Checker: 'worker' }
const roleOf = chat => ROLES[chat] ?? null
const ctx = (dir, now, as, more = {}) => ({ dir, now, prefix: '', roleOf, chats: Object.keys(ROLES), focusGoal: 'G95', focusSteps: BLOCK_STEPS, pictureProblem: async () => null, ...(as === undefined ? {} : { as }), ...more })
const sweep = (dir, on = true) => workApi({ action: 'autopilot', on }, ctx(dir, NOW, 'server'))
const read = async dir => (await readStore(dir)).items
const field = (items, id, key) => items.get(id).head.get(key)
const history = (items, id) => items.get(id).sections.get('History') ?? []
const mapOf = texts => new Map(texts.map(one => parseItem(one)).map(one => [one.head.get('Id'), one]))

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'recap-at-work-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Art', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}

const GOALS = ['Last id: G95', 'Focus: G95', '', '- [~] G95 One family', '    Done when: every unit drawn by one hand', '    Goal definition: one family', '    Goal definition agreed: 2026-11-11 10:00',
  '    Part: The Red Mage · about 3 h · steps B1149', '    Part: The Knight · about 3 h · steps B1206', '    How agreed: 2026-11-11 11:00', ''].join('\n')

test('rule 1 at filing: an ask of a step at work is never routed to the recap; the same ask of a step in review is', () => {
  const route = (askText, stepText) => {
    const items = mapOf([askText, stepText])
    return autopilotRoute(items.get(parseItem(askText).head.get('Id')), { roleOf, items, focusGoal: 'G95' })
  }
  for (const state of ['taken', 'in progress', 'waiting on you']) {
    const atWork = route(Q789({ Route: null }), B1149(state))
    assert.notEqual(atWork.to, 'recap', `B1149 ${state}`)
    assert.equal(atWork.to, 'partner', 'a verdict with pictures and options: the partner decides it')
    assert.match(atWork.why, new RegExp(`its step is still at work \\(${state}\\)`))
  }
  assert.equal(route(Q789({ Route: null }), B1149('review')).to, 'recap', 'finished work waits for the recap as before')
  // The board's Accept card: in review, in a work block, it waits for the recap (Q818); were its step at work, the partner's.
  const routeIn = (askText, stepText) => {
    const items = mapOf([askText, stepText])
    return autopilotRoute(items.get(parseItem(askText).head.get('Id')), { roleOf, items, focusGoal: 'G95', focusSteps: BLOCK_STEPS })
  }
  assert.equal(routeIn(Q818(), B1206()).to, 'recap')
  assert.equal(routeIn(Q818(), B1206().replace('State: review', 'State: in progress')).to, 'partner')
  // Chat 1's review: Q817's B1205 is in no G95 work block, so no recap judges it: the partner's, with its why.
  const none = routeIn(Q817(), B1205())
  assert.equal(none.to, 'partner')
  assert.match(none.why, /its step is in no work block of G95/)
  // Blocks not known (no focusSteps): judged as before.
  assert.equal(route(Q817(), B1205()).to, 'recap')
  assert.deepEqual([isInNoBlock('B1205', new Map(), BLOCK_STEPS), isInNoBlock('B1206', new Map(), BLOCK_STEPS), isInNoBlock('B1205', new Map(), []), isInNoBlock('B1205', new Map(), null)], [true, false, false, false])
  // Chat 1's re-check (M6): a fix of a block step counts as in its block by its chain's root, so its in-review card keeps the recap.
  const fix = step('B1241', { Title: 'Fix: the cleave\'s hold', State: 'review', Owner: 'Builder', 'Fix of': 'B1206' })
  const chain = mapOf([fix, step('B1242', { Title: 'Fix: the cleave again', State: 'review', Owner: 'Builder', 'Fix of': 'B1241' }), B1206()])
  assert.deepEqual([isInNoBlock('B1241', chain, BLOCK_STEPS), isInNoBlock('B1242', chain, BLOCK_STEPS)], [false, false])
  assert.equal(routeIn(Q818().replace(/Of: B1206/, 'Of: B1241'), fix).to, 'partner', 'without its root in the store it reads as in no block')
  const onFix = mapOf([Q818().replace(/Of: B1206/, 'Of: B1241'), fix, B1206()])
  assert.equal(autopilotRoute(onFix.get('Q818'), { roleOf, items: onFix, focusGoal: 'G95', focusSteps: BLOCK_STEPS }).to, 'recap', 'the fix\'s card keeps the recap')
  // Settled in the refine: the last-action look (a worker's look with pictures of a focus-goal step, at work) still reaches the recap, kept.
  const look = route(keptLook('Q900', 'B1149', { Route: null }), B1149())
  assert.deepEqual([look.to, look.kept], ['recap', true])
})

test('rule 2, the repair: B1149 in progress + Q789 and B1205 (no block) + Q817 on the recap are routed anew with one History line each; B1206 + Q818 stays and counts for the demo', async t => {
  const dir = await storeWith({ B1149: B1149(), Q789: Q789(), B1205: B1205(), B1230: QA1205(), Q817: Q817(), B1206: B1206(), B1231: QA1206(), Q818: Q818() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  let items = await read(dir)
  // Before the pass: the lane parks (the live 44 hours).
  assert.deepEqual(keptRecapWaitOf(items.get('B1149'), [items.get('Q789')])?.ids, ['Q789'])
  const done = await sweep(dir)
  assert.equal(done.ok, true, done.why)
  assert.deepEqual(done.result.routed.sort((a, b) => a.id.localeCompare(b.id)), [{ id: 'Q789', to: 'partner' }, { id: 'Q817', to: 'partner' }])
  items = await read(dir)
  assert.equal(field(items, 'Q789', 'Route'), 'partner')
  const lines = history(items, 'Q789')
  assert.equal(lines.filter(line => line.endsWith(reroutedAtWorkWords('in progress'))).length, 1)
  assert.ok(lines.at(-1).endsWith('autopilot: routed to partner'), lines.at(-1))
  assert.equal(reroutedAtWorkWords('in progress'), 'autopilot: re-routed: its step is still at work (in progress); only finished work waits for the recap')
  // The lane no longer parks for the recap.
  assert.equal(keptRecapWaitOf(items.get('B1149'), [items.get('Q789')]), null)
  // Q817: B1205 is in no work block, so no recap judges it: the partner's now, with its line.
  assert.equal(field(items, 'Q817', 'Route'), 'partner')
  assert.equal(history(items, 'Q817').filter(line => line.endsWith(reroutedNoBlockWords('G95'))).length, 1)
  assert.equal(reroutedNoBlockWords('G95'), 'autopilot: re-routed: its step is in no work block of G95, so no recap judges it')
  // B1206 in review, in its block, keeps its card on the recap, and counts for asking the goal demo.
  assert.equal(field(items, 'Q818', 'Route'), 'recap')
  assert.equal(history(items, 'Q818').some(line => line.includes('re-routed')), false)
  assert.deepEqual(recapWaitOf(items.get('B1206'), items), [{ step: 'B1206', asks: ['Q818'] }])
  const focus = focusState(parseGoals(GOALS), [...items.values()], [], '', 'Partner', NOW)
  assert.deepEqual([focus.progress.done, focus.progress.forDemo, focus.progress.total], [0, 1, 2])
  // A second pass changes nothing more.
  assert.deepEqual((await sweep(dir)).result.routed, [])
})

test('the repair with Autopilot off gives the ask to the person; a blocking look not yet kept becomes a kept look and frees its step', async t => {
  const dir = await storeWith({ B1149: B1149(), Q789: Q789(), B1150: step('B1150', { Title: 'Redraw the Archer', State: 'waiting on you', Owner: 'Builder' }), Q901: keptLook('Q901', 'B1150', { Owner: 'Builder', Blocking: 'yes' }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual((await sweep(dir, false)).result.routed.find(one => one.id === 'Q789'), { id: 'Q789', to: 'person' })
  let items = await read(dir)
  assert.equal(field(items, 'Q789', 'Route'), 'person')
  assert.equal(history(items, 'Q789').filter(line => line.includes('re-routed: its step is still at work')).length, 1)
  // Off, the blocking look went to the person too; on (its next filing shape), a fresh store keeps it for the recap and frees B1150.
  const on = await storeWith({ B1150: step('B1150', { Title: 'Redraw the Archer', State: 'waiting on you', Owner: 'Builder' }), Q901: keptLook('Q901', 'B1150', { Owner: 'Builder', Blocking: 'yes' }) })
  t.after(() => rm(on, { recursive: true, force: true }))
  const done = await sweep(on)
  assert.deepEqual(done.result.routed, [{ id: 'Q901', to: 'recap' }])
  items = await read(on)
  assert.deepEqual([field(items, 'Q901', 'Route'), field(items, 'Q901', 'Blocking')], ['recap', 'no'])
  assert.deepEqual(items.get('Q901').sections.get('Route'), [KEPT])
  assert.notEqual(field(items, 'B1150', 'State'), 'waiting on you')
  assert.equal(keptRecapWaitOf(items.get('B1150'), [items.get('Q901')]), null)
})

test('rule 3, the words: the ask\'s "Where it stands" and the Focus card say when the recap opens, from the goal\'s count of its blocks', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const pick = start => script.slice(script.indexOf(start), script.indexOf('\n}\n', script.indexOf(start)) + 3)
  const page = {}
  vm.runInNewContext(`const clock = at => String(at); const standWords = () => 'elsewhere'\nconst ROUTE_CHIPS = {}\n${['function recapOpensWords(', 'function lookAnswerOf(', 'function verdictOptionsOf(', 'function partnerAskWindowOf('].map(pick).join('\n')}\nObject.assign(this, { recapOpensWords, partnerAskWindowOf })`, page)
  const focus = { id: 'G95', progress: { done: 0, total: 6 } }
  assert.equal(page.recapOpensWords(focus, 'G95'), 'your recap of G95 opens when its 6 work blocks are done, 0 of 6 now')
  // The demo's count (blocks waiting only for the recap) is the one that opens it.
  assert.equal(page.recapOpensWords({ id: 'G95', progress: { done: 1, forDemo: 4, total: 6 } }, 'G95'), 'your recap of G95 opens when its 6 work blocks are done, 4 of 6 now')
  assert.equal(page.recapOpensWords({ id: 'G95', progress: { done: 0, total: 1 } }, 'G95'), 'your recap of G95 opens when its 1 work block is done, 0 of 1 now')
  // Every block counted (the recap is open or being made), another goal, no blocks: no words, the old line stands.
  assert.equal(page.recapOpensWords({ id: 'G95', progress: { done: 2, forDemo: 6, total: 6 } }, 'G95'), null)
  assert.equal(page.recapOpensWords(focus, 'G60'), null)
  assert.equal(page.recapOpensWords({ id: 'G95', progress: { done: 0, total: 0 } }, 'G95'), null)
  const Q817card = { id: 'Q817', route: 'recap', asks: 'decide', goal: 'G95', of: 'B1205', title: 'Accept B1205 at 58 of 75, or send it back?' }
  // B1270 (F34): an ask held for the recap under a step is answered here now, before the recap opens.
  assert.equal(page.partnerAskWindowOf(Q817card, focus).stand, "waits for the goal's recap (your recap of G95 opens when its 6 work blocks are done, 0 of 6 now): you can answer it here now")
  assert.equal(page.partnerAskWindowOf(Q817card, null).stand, "waits for the goal's recap: you can answer it here now")
  // The goal's own recap ask (no step) has no answer form: the recap is what it asks.
  const own = { ...Q817card, id: 'Q903', of: null }
  assert.equal(page.partnerAskWindowOf(own, focus).stand, "waits for the goal's recap: your recap of G95 opens when its 6 work blocks are done, 0 of 6 now")
  assert.equal(page.partnerAskWindowOf(own, null).stand, "waits for the goal's recap: you judge it there")
  const kept = { ...Q817card, id: 'Q902', asks: 'look', isKept: true }
  assert.equal(page.partnerAskWindowOf(kept, focus).stand, "waits for the goal's recap (your recap of G95 opens when its 6 work blocks are done, 0 of 6 now): you can answer it here now")
  // The Focus card's line carries the same words.
  assert.match(pick('function focusRecapAsksCard('), /Autopilot keeps these for the goal's recap: \$\{opens === null \? 'you judge them there, with the rest of the work' : opens\}/)
})

test('chat 1\'s other door: a step at work with only a kept look parks no lane; in review it counts for the demo only once its checks stand', async () => {
  const working = mapOf([B1149(), keptLook('Q902', 'B1149')])
  assert.equal(keptRecapWaitOf(working.get('B1149'), [working.get('Q902')]), null)
  assert.equal(waitsForKeptLooksOnly(working.get('B1149'), working), false, 'at work it counts for nothing yet')
  // B1149 in review with its Standard (a result check is owed), its History as the board writes it after the report.
  const reviewed = more => step('B1149', { Title: 'Redraw the Red Mage to the Knight\'s sheet', State: 'review', Owner: 'Painter' }, { Standard: ['unit · art/lineup.png · target 75'], Context: ['  Redraw the Red Mage.'] })
    .replace(/(## History\n- .*\n)/, `$1- ${at(30)} Painter: in progress → review\n${more.map(one => `- ${one}\n`).join('')}`)
  const countsWith = (more, extra = []) => {
    const items = mapOf([reviewed(more), keptLook('Q902', 'B1149'), B1206(), QA1206(), Q818(), ...extra])
    return { items, counts: waitsForKeptLooksOnly(items.get('B1149'), items) }
  }
  const PASSED = `${at(29)} server: check passed: work in garden; result named`
  const WAITS = `${at(20)} Checker: result check waits for you: 3 of 4 points pass, 1 for you to judge`
  // Just reported, the board's check still to come or pending: not yet.
  assert.equal(countsWith([]).counts, false, 'just reported')
  assert.equal(countsWith([`${at(29)} server: check pending`]).counts, false, 'check pending')
  // The board's check failed: back with its worker, never counted.
  assert.equal(countsWith([`${at(29)} server: check failed: tests fail`]).counts, false, 'check failed')
  // Passed, its result check still to run: not yet.
  assert.equal(countsWith([PASSED]).counts, false, 'result check still to run')
  // Passed, and the result check waits for nothing but the person's answer on the kept look (B1103): it counts, with no row of its own.
  const asked = countsWith([PASSED, WAITS])
  assert.equal(asked.counts, true, 'waits for the answer on the kept look')
  assert.equal(recapWaitOf(asked.items.get('B1149'), asked.items), null, 'a kept look gives no row of its own')
  const focus = focusState(parseGoals(GOALS), [...asked.items.values()], [], '', 'Partner', NOW)
  assert.deepEqual([focus.progress.done, focus.progress.forDemo, focus.progress.total], [0, 2, 2])
  assert.deepEqual(focus.recapRows, [{ step: 'B1206', asks: ['Q818'] }])
  // Its result check passed: it counts too. A check task still running, or another open ask of the person's, keeps it out.
  assert.equal(countsWith([PASSED, `${at(20)} Checker: result check passed: 4 of 4 points pass`]).counts, true, 'result check passed')
  assert.equal(countsWith([PASSED, WAITS], [step('B1240', { Title: 'Quality Assurance: B1149', State: 'in progress', Owner: 'Checker', Checks: 'B1149' })]).counts, false, 'a check task runs')
  assert.equal(countsWith([PASSED, WAITS], [ask('Q903', { Title: 'Which hat?', Owner: 'Painter', Asks: 'decide', Of: 'B1149', Route: 'person' })]).counts, false, 'another open ask')
})
