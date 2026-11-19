// B1270 (F34, the person, 2026-11-19: "i need a agree or disagree button if u want my verdict, where am i supposed to do anything?"): the
// live case on G95's Focus tab: "For your recap (2)" held Q817 (the board's Accept card on B1205, 58 of 75) and Q829 (Worker 4's look on
// B1255, "is 60 of 75 good enough?"), both routed to the goal's recap, as links with no buttons, while the recap opened only once 6 work
// blocks were done (4 then); the blocks' amber "Waits for your verdict" chip led there, where nothing could be done. Now every ask held for
// the recap under a step is answered at once, in its window and on its row, and closes as the recap's answer would (its step's `Recap
// verdict` line, its Accept card's done or next try, the chat that asked woken); the chip stays calm until the recap opens. Trimmed from
// the live records; made-up chats and paths only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'

import { focusState, recapHeldOf } from '../src/state.mjs'
import { recapEarlyVerdict, workApi } from '../src/work/api.mjs'
import { recapWaitIds } from '../src/work/autopilot.mjs'
import { parseGoals } from '../src/goals.mjs'
import { routedAwayOf } from '../src/work/lists.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, share } from '../src/work/store.mjs'

share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 19, 20, 30).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const step = (id, fields, sections = {}) => text({ Id: id, Kind: 'step', Activity: 'Art', Since: at(600), Goal: 'G95', ...fields }, { ...sections, History: [`- ${at(600)} Lead: made`] })
const ask = (id, fields, sections = {}) => text({ Id: id, Kind: 'ask', State: 'open', Since: at(500), Filed: String(NOW - 500 * MIN), Blocking: 'no', ...fields }, { Text: [fields.Title], ...sections, History: [`- ${at(500)} ${fields.Owner ?? 'server'}: asked (${fields.Asks ?? 'decide'})`, `- ${at(500)} server: autopilot: routed to ${fields.Route ?? 'person'}`] })

/** B1205 as it stood: the Archer's shot in review, checked at 58 of 75, its fix dropped, waiting for the recap's verdict on Q817. */
const B1205 = () => step('B1205', { Title: 'An own move per ability: the Archer\'s shot', State: 'review', Owner: 'Builder', Branch: 'b1205' }, {
  Context: ['  The shot.', '  Reported by Builder on 2026-11-15 at 20:00: Context: The shot was one frame. Change: The shot is redrawn key pose first. Details: merged abc1234.', '  Recap verdict: waits (Q817)'],
  'What we build': ['- the shot redrawn key pose first'],
  Checked: ['Evidence: art/B1205/evidence.png', 'Score: 58 of 75', '- pass: the shot redrawn key pose first', '- fail: judged at play size, target 75'],
})
/** Q817: the board's Accept card on B1205, routed to the recap (Via accept, no owner). */
const Q817 = () => ask('Q817', { Title: 'Accept B1205 at 58 of 75, or send it back?', Pictures: 'art/B1205/evidence.png', Asks: 'decide', Of: 'B1205', Options: 'A Accept: done as it is | B Send back: the partner makes another try from your note', Via: 'accept', Route: 'recap' })
/** B1255 as it stood: the Small Slime's slap in review, its look Q829 routed to the recap. */
const B1255 = () => step('B1255', { Title: 'The Small Slime\'s slap, your pick B', State: 'review', Owner: 'Painter' }, { Context: ['  The slap.', '  Recap verdict: waits (Q829)'] })
/** Q829: Worker 4's look, its options the verdict itself. */
const Q829 = () => ask('Q829', { Title: 'Built your pick: is 60 of 75 good enough?', Owner: 'Painter', Pictures: 'art/G95/B1259/evidence.png', Asks: 'look', Of: 'B1255', Options: 'A Good enough | B Under target, send back', Advice: 'A', Route: 'recap' })
/** A decide held for the recap whose options are no verdict (Q789's shape), of a step in review. */
const B1149 = () => step('B1149', { Title: 'Redraw the Red Mage', State: 'review', Owner: 'Painter' }, { Context: ['  The mage.', '  Recap verdict: waits (Q789)'] })
const Q789 = () => ask('Q789', { Title: 'Red Mage scores 62 of 75: redraw or accept?', Owner: 'Painter', Asks: 'decide', Of: 'B1149', Options: 'A Redraw the model sheet and all sheets | B Merge as it is, fix step later', Advice: 'A', Route: 'recap' })
/** The goal's own recap ask: no step, its words link the recap. */
const Q900 = () => ask('Q900', { Title: 'Open the recap and try it', Asks: 'look', Route: 'recap' })

const ROLES = { Lead: 'main', Partner: 'advisor', Painter: 'worker', Builder: 'worker', Checker: 'worker' }
const ctx = (dir, now, as) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G95', autopilot: true, pictureProblem: async () => null, recaps: [], ...(as === undefined ? {} : { as }) })
const person = (dir, body, now = NOW + MIN) => workApi(body, ctx(dir, now, 'person'))
const read = async dir => (await readStore(dir)).items
const contextOf = (items, id) => (items.get(id).sections.get('Context') ?? []).map(line => line.trim())

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'recap-answer-now-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Art', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}

// ---------------------------------------------------------------------------------------------------------------------
// The answer closes it as the recap's answer would

test('Q817 (the Accept card held for the recap) answered now with Accept: closed, B1205 done, its step reads Recap verdict: approved, the recap no longer waits for it', async t => {
  const dir = await storeWith({ B1205: B1205(), Q817: Q817() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual(recapWaitIds(parseItem(B1205()), new Map([['Q817', parseItem(Q817())]])), ['Q817'])
  const done = await person(dir, { action: 'answer', id: 'Q817', text: 'A Accept: done as it is' })
  assert.equal(done.ok, true, done.why)
  assert.equal(done.result.accepted, 'B1205')
  const items = await read(dir)
  assert.equal(items.get('Q817').head.get('State'), 'answered')
  assert.equal(items.get('B1205').head.get('State'), 'done')
  assert.ok(contextOf(items, 'B1205').includes('Recap verdict: approved (Q817)'), contextOf(items, 'B1205').join('\n'))
  // Not asked again: the step waits for no recap ask, and no open ask of it stands on the recap.
  assert.deepEqual(recapWaitIds(items.get('B1205'), items), [])
  assert.deepEqual(routedAwayOf({ ok: true, items }).map(one => one.id), [])
})

test('Q817 answered now with Send back: the note goes to the partner as the next try, the step reads Recap verdict: sent back', async t => {
  const dir = await storeWith({ B1205: B1205(), Q817: Q817() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bare = await person(dir, { action: 'answer', id: 'Q817', text: 'B Send back: the partner makes another try from your note' })
  assert.equal(bare.ok, false, 'a Send back needs the note')
  const sent = await person(dir, { action: 'answer', id: 'Q817', text: 'B Send back: the partner makes another try from your note\nthe draw is too stiff' })
  assert.equal(sent.ok, true, sent.why)
  const items = await read(dir)
  const fix = items.get(sent.result.fix)
  assert.deepEqual([fix.head.get('Fix of'), fix.head.get('Title')], ['B1205', 'Fix: the draw is too stiff'])
  assert.ok(contextOf(items, 'B1205').includes('Recap verdict: sent back (Q817)'))
  assert.equal(items.get('Q817').head.get('State'), 'answered')
})

test('Q829 (a look held for the recap) answered now with Looks right: closed, its step reads approved, Painter (the chat that asked) is woken', async t => {
  const dir = await storeWith({ B1255: B1255(), Q829: Q829() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await person(dir, { action: 'answer', id: 'Q829', verdict: 'approve', text: 'A Good enough' })
  assert.equal(done.ok, true, done.why)
  assert.deepEqual([done.result.wake?.to, done.result.wake?.id], ['Painter', 'Q829'])
  const items = await read(dir)
  assert.deepEqual(items.get('Q829').sections.get('Answer'), ['Approved. A Good enough'])
  assert.ok(contextOf(items, 'B1255').includes('Recap verdict: approved (Q829)'))
  assert.equal(items.get('B1255').head.get('State'), 'review', 'its step is not moved: its check closes it')
  assert.deepEqual(recapWaitIds(items.get('B1255'), items), [])
  // Send back needs the note, and then reads sent back.
  const back = await storeWith({ B1255: B1255(), Q829: Q829() })
  t.after(() => rm(back, { recursive: true, force: true }))
  assert.equal((await person(back, { action: 'answer', id: 'Q829', verdict: 'reject', text: '' })).ok, false)
  assert.equal((await person(back, { action: 'answer', id: 'Q829', verdict: 'reject', text: 'B Under target, send back\nthe flash hides the hit' })).ok, true)
  assert.ok(contextOf(await read(back), 'B1255').includes('Recap verdict: sent back (Q829)'))
})

test('a decide held for the recap is answered by its options: closed, its step reads the verdict its words give', async t => {
  const dir = await storeWith({ B1149: B1149(), Q789: Q789() })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await person(dir, { action: 'answer', id: 'Q789', text: 'A Redraw the model sheet and all sheets' })
  assert.equal(done.ok, true, done.why)
  const items = await read(dir)
  assert.equal(items.get('Q789').head.get('State'), 'answered')
  assert.ok(contextOf(items, 'B1149').includes('Recap verdict: approved (Q789)'))
  assert.deepEqual(recapWaitIds(items.get('B1149'), items), [])
})

test('which answers write a Recap verdict: only an ask routed to the recap under a step; a decide reads its words', () => {
  const held = parseItem(Q829())
  assert.equal(recapEarlyVerdict(held, 'approve', ['Approved.']), 'approved')
  assert.equal(recapEarlyVerdict(held, 'reject', ['Rejected. no']), 'sent back')
  assert.equal(recapEarlyVerdict(held, 'done', ['Done.']), 'approved')
  assert.equal(recapEarlyVerdict(parseItem(Q817()), undefined, ['A Accept: done as it is']), 'approved')
  assert.equal(recapEarlyVerdict(parseItem(Q817()), undefined, ['B Send back: x', 'a note']), 'sent back')
  assert.equal(recapEarlyVerdict(parseItem(Q789()), undefined, ['no, merge it later']), 'sent back')
  // The goal's own recap ask has no step; an ask routed elsewhere writes none.
  assert.equal(recapEarlyVerdict(parseItem(Q900()), 'approve', ['Approved.']), null)
  assert.equal(recapEarlyVerdict(parseItem(Q829().replace('Route: recap', 'Route: person')), 'approve', ['Approved.']), null)
})

// ---------------------------------------------------------------------------------------------------------------------
// The state: which blocks wait only for asks the recap holds

const GOALS = ['Last id: G95', 'Focus: G95', '', '- [~] G95 One family', '    Done when: every unit drawn by one hand', '    Goal definition: one family', '    Goal definition agreed: 2026-11-11 10:00',
  '    Part: The skeletons · about 3 h · steps B1205', '    Part: The slimes · about 3 h · steps B1255', '    Part: The mage · about 3 h · steps B1149', '    How agreed: 2026-11-11 11:00', ''].join('\n')

test('G95 live: a block whose verdict is only an ask the recap holds says which (part.recapHeld); one whose ask stands with the person says none', () => {
  const items = new Map([B1205(), Q817(), B1255(), Q829(), B1149(), Q789().replace('Route: recap', 'Route: person')].map(one => parseItem(one)).map(one => [one.head.get('Id'), one]))
  const goals = parseGoals(GOALS)
  const focus = focusState(goals, [...items.values()], [], '', 'Partner', NOW, null, null, null, { autopilot: true })
  const byTitle = title => focus.parts.find(part => part.title === title)
  assert.deepEqual([byTitle('The skeletons').state, byTitle('The skeletons').recapHeld], ['verdict', ['Q817']])
  assert.deepEqual([byTitle('The slimes').state, byTitle('The slimes').recapHeld], ['verdict', ['Q829']])
  // Q789 routed to the person: the person can answer it where it stands; nothing the recap holds.
  assert.equal(byTitle('The mage').recapHeld, undefined)
})

test('recapHeldOf: [] when a recap part waits, when an ask of the step stands with the person, or when its Accept card is not held', () => {
  const items = new Map([B1205(), Q817()].map(one => parseItem(one)).map(one => [one.head.get('Id'), one]))
  const asked = new Map()
  assert.deepEqual(recapHeldOf('B1205', items, 'accept', { asked }), ['Q817'])
  assert.deepEqual(recapHeldOf('B1205', items, 'recap', { asked }), [])
  assert.deepEqual(recapHeldOf('B1205', items, undefined, { asked: new Map([['B1205', [{ id: 'Q1', route: 'person' }]]]) }), [])
  const person = new Map([B1205(), Q817().replace('Route: recap', 'Route: person')].map(one => parseItem(one)).map(one => [one.head.get('Id'), one]))
  assert.deepEqual(recapHeldOf('B1205', person, 'accept', { asked }), [])
})

// ---------------------------------------------------------------------------------------------------------------------
// The page: the buttons and the calm chip

async function page() {
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const pick = start => {
    const from = script.indexOf(start)
    assert.ok(from >= 0, `board.js has ${start}`)
    return script.slice(from, script.indexOf('\n}\n', from) + 3)
  }
  const names = ['function lookAnswerOf(', 'function verdictOptionsOf(', 'function lookAnswerBody(', 'function recapOpensWords(', 'function recapOpensShort(', 'function partnerAskWindowOf(', 'function blockChipOf(', 'function verdictLinkOf(']
  const box = {}
  vm.runInNewContext(`const clock = at => String(at); const standWords = () => 'elsewhere'\nconst ROUTE_CHIPS = {}\nconst FOCUS_CHIPS = { verdict: 'Waits for your verdict →', now: 'In progress' }\n${names.map(pick).join('\n')}\nObject.assign(this, { lookAnswerOf, lookAnswerBody, partnerAskWindowOf, blockChipOf })`, box)
  return box
}
const option = (label, isRecommended = false) => ({ label, isRecommended })
const Q817card = { id: 'Q817', route: 'recap', asks: 'decide', via: 'accept', goal: 'G95', of: 'B1205', title: 'Accept B1205 at 58 of 75, or send it back?', options: [option('A Accept: done as it is'), option('B Send back: the partner makes another try from your note')] }
const Q829card = { id: 'Q829', route: 'recap', asks: 'look', via: null, goal: 'G95', of: 'B1255', title: 'Built your pick: is 60 of 75 good enough?', options: [option('A Good enough', true), option('B Under target, send back')], advice: 'A' }
const Q789card = { id: 'Q789', route: 'recap', asks: 'decide', via: null, goal: 'G95', of: 'B1149', title: 'Redraw or accept?', options: [option('A Redraw the model sheet and all sheets', true), option('B Merge as it is, fix step later')] }
const FOCUS = { id: 'G95', progress: { done: 2, forDemo: 4, total: 6 } }

test('the page: every ask held for the recap under a step has its answer form; the goal\'s own recap ask, a form ask and one routed elsewhere have none', async () => {
  const { lookAnswerOf } = await page()
  const accept = lookAnswerOf(Q817card)
  assert.deepEqual([accept.kind, accept.options.length, accept.choices.length, accept.verdict.approve, accept.verdict.back], ['accept', 0, 0, 'A Accept: done as it is', 'B Send back: the partner makes another try from your note'])
  const look = lookAnswerOf(Q829card)
  // Options that are the verdict are the two buttons, never picks beside them.
  assert.deepEqual([look.kind, look.options.length, look.verdict.approve, look.verdict.back], ['look', 0, 'A Good enough', 'B Under target, send back'])
  const decide = lookAnswerOf(Q789card)
  assert.deepEqual([decide.kind, decide.choices.map(one => one.label)], ['decide', ['A Redraw the model sheet and all sheets', 'B Merge as it is, fix step later']])
  assert.equal(lookAnswerOf({ id: 'Q900', route: 'recap', asks: 'look', of: null, title: 'Open the recap and try it' }), null)
  assert.equal(lookAnswerOf({ ...Q829card, via: 'form' }), null)
  assert.equal(lookAnswerOf({ ...Q829card, route: 'main' }), null)
  // A kept look keeps its picks (G95's Q740).
  const kept = lookAnswerOf({ id: 'Q740', route: 'recap', asks: 'look', isKept: true, of: null, options: [option('A Thin'), option('B Wide'), option('C Both')] })
  assert.deepEqual([kept.kind, kept.options.map(one => one.label)], ['look', ['A Thin', 'B Wide', 'C Both']])
})

test('the page: what the buttons send closes it on the server as above', async () => {
  const { lookAnswerOf, lookAnswerBody } = await page()
  const accept = lookAnswerOf(Q817card)
  assert.deepEqual(JSON.parse(JSON.stringify(lookAnswerBody(accept, 'approve', null, ''))), { text: 'A Accept: done as it is' })
  assert.deepEqual(JSON.parse(JSON.stringify(lookAnswerBody(accept, 'reject', null, 'too stiff'))), { text: 'B Send back: the partner makes another try from your note\ntoo stiff' })
  assert.ok(lookAnswerBody(accept, 'reject', null, '').problem)
  const look = lookAnswerOf(Q829card)
  assert.deepEqual(JSON.parse(JSON.stringify(lookAnswerBody(look, 'approve', null, ''))), { verdict: 'approve', text: 'A Good enough' })
  assert.deepEqual(JSON.parse(JSON.stringify(lookAnswerBody(look, 'reject', null, 'the flash'))), { verdict: 'reject', text: 'B Under target, send back\nthe flash' })
  assert.deepEqual(JSON.parse(JSON.stringify(lookAnswerBody(lookAnswerOf(Q789card), 'choice', 'B Merge as it is, fix step later', ''))), { text: 'B Merge as it is, fix step later' })
})

test('the page: the window says it can be answered now; the block chip is calm while the recap is not open, amber once it is', async () => {
  const { partnerAskWindowOf, blockChipOf } = await page()
  assert.equal(partnerAskWindowOf(Q817card, FOCUS).stand, "waits for the goal's recap (your recap of G95 opens when its 6 work blocks are done, 4 of 6 now): you can answer it here now")
  const skeletons = { title: 'The skeletons', state: 'verdict', verdictAt: { step: 'B1205' }, recapHeld: ['Q817'] }
  const plain = value => JSON.parse(JSON.stringify(value))
  const one = plain(blockChipOf(skeletons, null, null, false, FOCUS))
  assert.deepEqual([one.chip, one.tone, one.link, one.isVerdict], ['1 for your recap · opens when 6 blocks are done, 4 now · or answer now →', 'recap-held', { ask: 'Q817' }, true])
  const two = plain(blockChipOf({ ...skeletons, recapHeld: ['Q817', 'Q829'] }, null, null, false, FOCUS))
  assert.deepEqual([two.chip, two.link], ['2 for your recap · opens when 6 blocks are done, 4 now · or answer now →', { recapAsks: true }])
  // The recap is open (every block counted): the attention colour, as before.
  assert.equal(blockChipOf(skeletons, null, null, false, { id: 'G95', progress: { done: 2, forDemo: 6, total: 6 } }).tone, 'verdict')
  // A block whose verdict stands with the person (no recapHeld) stays the attention colour.
  assert.equal(blockChipOf({ ...skeletons, recapHeld: undefined }, null, null, false, FOCUS).tone, 'verdict')
})
