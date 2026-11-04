// Autopilot v2, the last two odd cards (T20.1, the person's "Yes, fold them", 2026-11-04). After the one-count recap Needs your attention
// still held two odd kinds of card: a line of Main's "For you" block that asks nothing ("Nothing is required. The board's debug port ...",
// the live Q626, filed as a do and routed to the person after the main chat did not do it in 30 minutes), and the app's popup that the
// Workers mod files as an ask of its chat ("A popup in its chat may wait for you: it has tried to use ccd directory (change directory) ...",
// the live Q629 and Q632, 46 minutes apart). An ask that asks nothing closes at its filing and at every pass, its words go to the
// Information list; the app's form stands in the "Needs your hands" line, once per chat. Made-up items in a temporary folder.

import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { ASKS_NOTHING_WHY, asksNothingOf, autopilotRoute, formHandsOf } from '../src/work/autopilot.mjs'
import { workApi } from '../src/work/api.mjs'
import { informationOf, storeNeeds } from '../src/work/lists.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, share } from '../src/work/store.mjs'

share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 4, 12, 30).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
/** An open ask `minutes` old; `history` the routes the board wrote on it. */
const askText = (id, fields, { words = null, history = [], minutes = 50 } = {}) => text(
  { Id: id, Kind: 'ask', Title: fields.Title, State: 'open', Since: at(minutes), Filed: String(NOW - minutes * MIN), Blocking: 'no', ...fields },
  { Text: [words ?? fields.Title], History: [`- ${at(minutes)} ${fields.Owner ?? 'server'}: asked (${fields.Asks ?? 'decide'})`, ...history.map(to => `- ${at(minutes)} server: autopilot: routed to ${to}`)] })
const ask = (...args) => parseItem(askText(...args))

// Twins of the live asks.
const Q626_WORDS = 'Nothing is required. The board\'s debug port 9229 stays open on this PC only (not reachable from outside) until the board restarts.'
const Q626 = (fields = {}, more = {}) => ask('Q626', { Title: 'Nothing is required.', Owner: 'Main', Asks: 'do', Via: 'chat', Route: 'person', ...fields }, { words: Q626_WORDS, history: ['main'], ...more })
const POPUP_WORDS = 'A popup in its chat may wait for you: it has tried to use ccd directory (change directory) (garden) for over a minute. Open its chat and look.'
const POPUP_TITLE = 'A popup in its chat may wait for you: it has tried to use ccd directory (change directory) (garden) for over a minute.'
const Q629 = (fields = {}, more = {}) => ask('Q629', { Title: POPUP_TITLE, Owner: 'Worker 5', Asks: 'do', Of: 'B966', Via: 'form', Route: 'person', ...fields }, { words: POPUP_WORDS, history: ['person'], ...more })

const ROLES = { Main: 'main', 'Worker 5': 'worker', 'Worker 6': 'worker', Advisor: 'advisor' }
const roleOf = name => ROLES[name] ?? null

test('what asks nothing: Q626\'s words, "No action needed", "FYI" and the like; never with a question, "please" or "can you" after it, options, advice, the app\'s form or a take-back', () => {
  assert.equal(asksNothingOf(Q626()), 'Nothing is required')
  const saying = (title, words = null, fields = {}) => asksNothingOf(ask('Q1', { Title: title, Owner: 'Main', Asks: 'do', Via: 'chat', ...fields }, { words: words ?? title }))
  for (const said of ['Nothing is required.', 'Nothing required from you.', 'No action needed.', 'No action is required from you.', 'Nothing to do.', 'Nothing for you.', 'No need to do anything.', 'No need for you to do anything.', 'FYI: the board restarted.', 'For your information, the port stays open.', '**Nothing is required.**']) {
    assert.notEqual(saying(said), null, said)
  }
  // The first sentence of the words counts when the title is cut or differs.
  assert.equal(saying('The board restarted.', 'No action needed. The board restarted at noon.'), 'No action needed')
  // Never when the words ask something after it.
  assert.equal(saying('Nothing is required.', 'Nothing is required. Can you restart the board?'), null)
  assert.equal(saying('Nothing is required.', 'Nothing is required. Please restart the board when you can.'), null)
  assert.equal(saying('Nothing is required, but should I stop the game?'), null)
  assert.equal(saying('FYI: do you want the port closed again?'), null)
  // Other words are no such thing.
  for (const said of ['Restart the board?', 'Is nothing required here?', 'Which colour for the bar?', 'Nothing yet: waiting for the picture.']) assert.equal(saying(said), null, said)
  // Options, advice, the app's form, a refine question, the board's own card, one the person took back, one no longer open.
  assert.equal(saying('Nothing is required.', null, { Options: 'A yes | B no' }), null)
  assert.equal(saying('Nothing is required.', null, { Advice: 'yes' }), null)
  for (const via of ['form', 'refine', 'accept']) assert.equal(saying('Nothing is required.', null, { Via: via }), null, via)
  const taken = Q626()
  taken.sections.set('Route', ['The person took it back from Autopilot (Undo)'])
  assert.equal(asksNothingOf(taken), null)
  assert.equal(saying('Nothing is required.', null, { State: 'answered' }), null)
})

test('the app\'s form is the person\'s hands: Q629\'s words give "Worker 5\'s chat waits on a popup: change directory"; a question of the form gets its own words', () => {
  assert.deepEqual(formHandsOf(Q629(), 'Worker 5'), { name: 'a popup in its chat', words: 'Worker 5\'s chat waits on a popup: change directory' })
  const plainAction = ask('Q640', { Title: 'A popup in its chat may wait for you: it has tried to change a file (board.js) for over a minute.', Owner: 'Worker 6', Asks: 'do', Via: 'form' },
    { words: 'A popup in its chat may wait for you: it has tried to change a file (board.js) for over a minute. Open its chat and look.' })
  assert.equal(formHandsOf(plainAction, 'Worker 6').words, 'Worker 6\'s chat waits on a popup: change a file')
  const question = ask('Q641', { Title: 'Which colour for the bar, red or blue, as the long title it is?', Owner: 'Worker 6', Asks: 'decide', Via: 'form', Options: 'A red | B blue' })
  assert.deepEqual(formHandsOf(question, 'Worker 6'), { name: 'a question in its chat', words: 'Worker 6 asks in its chat: Which colour for the bar, red or blue,…' })
  assert.equal(formHandsOf(Q626(), 'Main'), null, 'an ask of the chat\'s own words is no form')
  // The route says the same: the person's, with these hands (the pass and the filing leave the route as it was).
  const route = autopilotRoute(Q629(), { roleOf, items: new Map(), focusGoal: 'G60', now: NOW, again: true })
  assert.deepEqual(route, { to: 'person', why: 'the app\'s question form is answered in its chat', hands: 'a popup in its chat' })
})

// ---------------------------------------------------------------------------------------------------------------------
// The board: filing and the pass.

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'autopilot-fold-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}
const ctx = (dir, now, as, more = {}) => ({ dir, now, prefix: '', roleOf, chats: Object.keys(ROLES), focusGoal: 'G60', pictureProblem: async () => null, ...(as === undefined ? {} : { as }), ...more })
const sweep = (dir, on = true, now = NOW) => workApi({ action: 'autopilot', on }, ctx(dir, now, 'server'))
const chat = (dir, who, body, now = NOW + MIN, more = {}) => workApi({ ...body, chat: who }, ctx(dir, now, undefined, more))
const read = async dir => (await readStore(dir)).items
const field = (items, id, key) => items.get(id).head.get(key)
const history = (items, id) => items.get(id).sections.get('History') ?? []
const notes = items => [...items.values()].filter(one => one.head.get('Kind') === 'note')

test('at its filing an ask that asks nothing is closed at once: withdrawn with its why, its words one note in the Information list; while Autopilot is off, and with a question after it, it is filed as before', async t => {
  const dir = await storeWith({ B966: text({ Id: 'B966', Kind: 'step', Title: 'Make the game compare', State: 'in progress', Owner: 'Worker 5', Activity: 'Garden', Since: at(90) }, { History: [`- ${at(90)} Main: made`] }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const block = { action: 'ask', kind: 'do', via: 'chat', text: [Q626_WORDS] }
  const done = await chat(dir, 'Main', block, NOW, { autopilot: true })
  assert.equal(done.ok, true, done.why)
  assert.equal(done.result.informed, true)
  let items = await read(dir)
  const id = done.result.id
  assert.deepEqual([field(items, id, 'State'), field(items, id, 'Title'), field(items, id, 'Blocking'), field(items, id, 'Route')], ['withdrawn', 'Nothing is required.', 'no', undefined])
  assert.match(history(items, id).at(-1), / server: withdrawn: it asks nothing: information only$/)
  assert.equal(ASKS_NOTHING_WHY, 'it asks nothing: information only')
  assert.equal(notes(items).length, 1)
  const [note] = notes(items)
  assert.deepEqual([note.head.get('From'), note.head.get('To'), note.head.get('State'), note.sections.get('About')], ['Main', 'you', 'unread', [id]])
  assert.equal(note.sections.get('Text').join(' '), Q626_WORDS, 'its words, as it said them')
  const info = informationOf({ ok: true, items }, NOW)
  assert.deepEqual(info.map(one => [one.from, one.to, one.about, one.isRead]), [['Main', 'you', id, false]])
  // It stands in no card of Needs your attention.
  assert.deepEqual(storeNeeds({ ok: true, items }, { now: NOW + MIN, autopilot: true, roleOf }).map(one => one.workId), [])
  // With a question after it: an ask, filed and routed as any.
  const asked = await chat(dir, 'Main', { action: 'ask', kind: 'do', via: 'chat', text: ['Nothing is required. Can you restart the board?'] }, NOW + 2 * MIN, { autopilot: true })
  assert.equal(asked.ok, true, asked.why)
  assert.equal(asked.result.informed, undefined)
  items = await read(dir)
  assert.equal(field(items, asked.result.id, 'State'), 'open')
  assert.equal(notes(items).length, 1, 'no second note')
  // Autopilot off: as today, an open ask.
  const off = await chat(dir, 'Main', { action: 'ask', kind: 'do', via: 'chat', text: ['No action needed. The board stays up.'] }, NOW + 3 * MIN, { autopilot: false })
  assert.equal(off.ok, true, off.why)
  assert.equal(field(await read(dir), off.result.id, 'State'), 'open')
  // Under a step, blocking: filed closed all the same, the step never waits on it.
  const under = await chat(dir, 'Worker 5', { action: 'ask', of: 'B966', kind: 'decide', blocking: true, title: 'FYI, nothing to answer.', text: ['The port stays open until the board restarts.'] }, NOW + 4 * MIN, { autopilot: true })
  assert.equal(under.ok, true, under.why)
  items = await read(dir)
  assert.deepEqual([field(items, under.result.id, 'State'), field(items, under.result.id, 'Blocking'), field(items, 'B966', 'State')], ['withdrawn', 'no', 'in progress'])
})

test('at every pass an open ask that asks nothing closes the same way, once: Q626 routed to the main chat; "Nothing is required. Can you restart the board?" stays; Autopilot off, nothing', async t => {
  const dir = await storeWith({
    Q626: askText('Q626', { Title: 'Nothing is required.', Owner: 'Main', Asks: 'do', Via: 'chat', Route: 'main' }, { words: Q626_WORDS, history: ['main'], minutes: 20 }),
    Q627: askText('Q627', { Title: 'Nothing is required.', Owner: 'Main', Asks: 'do', Via: 'chat' }, { words: 'Nothing is required. Can you restart the board?', minutes: 5 }),
    Q628: askText('Q628', { Title: 'Nothing is required.', Owner: 'Worker 5', Asks: 'do', Via: 'chat', Route: 'person' }, { words: 'Nothing is required. The port stays open.', history: ['person'], minutes: 60 }),
  })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const before = await read(dir)
  const off = await sweep(dir, false)
  assert.equal(off.ok, true, off.why)
  assert.equal(off.result.changed, false)
  assert.deepEqual([...(await read(dir)).keys()].sort(), [...before.keys()].sort())
  assert.equal(field(await read(dir), 'Q626', 'State'), 'open', 'off: nothing is closed')
  const on = await sweep(dir)
  assert.equal(on.ok, true, on.why)
  assert.deepEqual(on.result.informed, ['Q626', 'Q628'])
  assert.equal(on.result.changed, true)
  assert.match(on.result.text, /closed as information only: Q626, Q628/)
  let items = await read(dir)
  assert.deepEqual(['Q626', 'Q627', 'Q628'].map(id => field(items, id, 'State')), ['withdrawn', 'open', 'withdrawn'])
  assert.match(history(items, 'Q626').at(-1), / server: withdrawn: it asks nothing: information only$/)
  assert.deepEqual(notes(items).map(one => [one.head.get('From'), one.sections.get('About'), one.sections.get('Text').join(' ')]), [['Main', ['Q626'], Q626_WORDS], ['Worker 5', ['Q628'], 'Nothing is required. The port stays open.']])
  // The question after it is routed as any ask (a do: the main chat), never closed.
  assert.equal(field(items, 'Q627', 'Route'), 'main')
  // Once: the next pass closes nothing again and files no second note.
  const again = await sweep(dir, true, NOW + 5 * MIN)
  assert.deepEqual(again.result.informed, [])
  items = await read(dir)
  assert.equal(notes(items).length, 2)
  assert.equal(history(items, 'Q626').filter(line => line.includes('withdrawn')).length, 1)
})

// ---------------------------------------------------------------------------------------------------------------------
// The app's form, once per chat.

test('the app\'s form with Autopilot on stands in the hands line, not as a card; with it off, as today', () => {
  const work = { ok: true, items: new Map([Q629(), ask('Q630', { Title: 'Sign in to the seed shop account', Owner: 'Worker 6', Asks: 'do', Via: 'chat' }, { history: ['person'] })].map(one => [one.head.get('Id'), one])) }
  const needs = autopilot => storeNeeds(work, { now: NOW, autopilot, roleOf, names: ['Worker 5', 'Worker 6'], focusGoal: 'G60' })
  const on = needs(true)
  assert.deepEqual(on.map(one => [one.workId, one.hands, one.handsWords]), [['Q629', 'a popup in its chat', 'Worker 5\'s chat waits on a popup: change directory'], ['Q630', 'a sign-in', null]])
  assert.deepEqual(needs(false).map(one => [one.workId, one.hands, one.handsWords]), [['Q629', null, null], ['Q630', null, null]])
})

test('the same form of the same chat while its ask stands open is not filed again: the first is kept, its History notes "asked again"; another chat, Autopilot off or a closed first ask file their own', async t => {
  const dir = await storeWith({ Q629: askText('Q629', { Title: POPUP_TITLE, Owner: 'Worker 5', Asks: 'do', Via: 'form', Route: 'person' }, { words: POPUP_WORDS, history: ['person'], minutes: 46 }) })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const popup = { action: 'ask', kind: 'do', via: 'form', text: POPUP_WORDS }
  const ids = async () => (await readdir(dir)).filter(name => /^Q\d+\.md$/.test(name)).sort()
  // The mod files it again, 46 minutes later: no new item; the first is named in the answer, and its History notes it.
  const again = await chat(dir, 'Worker 5', popup, NOW, { autopilot: true })
  assert.equal(again.ok, true, again.why)
  assert.equal(again.result.id, 'Q629')
  assert.deepEqual(await ids(), ['Q629.md'])
  let items = await read(dir)
  assert.match(history(items, 'Q629').at(-1), /^- \S+ \S+ Worker 5: asked again 12:30$/)
  assert.equal(field(items, 'Q629', 'State'), 'open')
  // Again: one more line, still one item.
  assert.equal((await chat(dir, 'Worker 5', popup, NOW + 7 * MIN, { autopilot: true })).result.id, 'Q629')
  assert.deepEqual(await ids(), ['Q629.md'])
  assert.equal(history(await read(dir), 'Q629').filter(line => line.includes('asked again')).length, 2)
  // Other words of the same chat, or the same words of another chat: filed.
  const other = await chat(dir, 'Worker 5', { ...popup, text: POPUP_WORDS.replace('ccd directory (change directory) (garden)', 'change a file (board.js)') }, NOW + 8 * MIN, { autopilot: true })
  assert.equal(other.result.id, 'Q630')
  const another = await chat(dir, 'Worker 6', popup, NOW + 9 * MIN, { autopilot: true })
  assert.equal(another.result.id, 'Q631')
  // Autopilot off: as today, a new ask.
  const off = await chat(dir, 'Worker 5', popup, NOW + 10 * MIN, { autopilot: false })
  assert.equal(off.result.id, 'Q632')
  // Once the first is closed (the mod withdraws it when the call goes on), the same words are filed anew.
  assert.equal((await chat(dir, 'Worker 5', { action: 'withdraw', id: 'Q629', why: 'the call went on' }, NOW + 11 * MIN)).ok, true)
  assert.equal((await chat(dir, 'Worker 5', { action: 'withdraw', id: 'Q632', why: 'the call went on' }, NOW + 11 * MIN)).ok, true)
  const fresh = await chat(dir, 'Worker 5', popup, NOW + 12 * MIN, { autopilot: true })
  assert.equal(fresh.result.id, 'Q633')
  items = await read(dir)
  assert.equal(field(items, 'Q633', 'State'), 'open')
  assert.equal(history(items, 'Q633').some(line => line.includes('asked again')), false)
})

// ---------------------------------------------------------------------------------------------------------------------
// The page: the hands line's view.

const script = readFileSync(new URL('../public/board.js', import.meta.url), 'utf8')
const cutLine = script.split('\n').find(line => line.startsWith('const cutWords = '))
const views = vm.runInNewContext(`${cutLine}\n${script.slice(script.indexOf('// handsline:start'), script.indexOf('// handsline:end'))}\n;({ handsNeedsOf, handsLineView })`, {})
const plain = value => JSON.parse(JSON.stringify(value))

test('the hands line\'s view: the form\'s own words, not cut; the same words of one chat stand once (Q629 and Q632 filed before the fold); another chat has its own entry', () => {
  const need = (id, more = {}) => ({ id: `work:${id}`, workId: id, title: POPUP_TITLE, hands: 'a popup in its chat', handsWords: 'Worker 5\'s chat waits on a popup: change directory', answer: null, isClosed: false, blocking: false, ...more })
  const list = [need('Q629'), need('Q630', { handsWords: 'Worker 6\'s chat waits on a popup: change directory' }), need('Q632'), need('Q633', { title: 'Sign in to the seed shop account', hands: 'a sign-in', handsWords: null })]
  const view = plain(views.handsLineView(views.handsNeedsOf(list, true)))
  assert.deepEqual(view.items.map(one => [one.id, one.words, one.href]), [
    ['Q629', 'Worker 5\'s chat waits on a popup: change directory', '#details=Q629'],
    ['Q630', 'Worker 6\'s chat waits on a popup: change directory', '#details=Q630'],
    ['Q633', 'Sign in to the seed shop account', '#details=Q633'],
  ])
  assert.equal(view.items[0].title, `Open Q629: ${POPUP_TITLE} (only you can: a popup in its chat)`)
})
