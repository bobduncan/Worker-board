// Drop asks go to the person (chat 1's brief "drop-asks-to-person", 2026-11-11). The live Q733 "Drop B1011, B978 and B934 now?" (a
// decide with no options or pictures) was routed to its advice and Autopilot took "yes" within a second: the person never saw it and
// the main chat dropped three steps on it. The matcher (src/work/dropAsk.mjs), Autopilot's route on the first pass and every pass
// after, and the main chat's own bookkeeping drop (no ask, its answer says the rule). Q733's words are the live ones; the rest is made up.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { autopilotRoute } from '../../src/work/autopilot.mjs'
import { DROP_ROUTE_WHY, BOOKKEEPING_DROP_WORDS, dropAskOf, dropAskOfItem } from '../../src/work/dropAsk.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 11, 18, 0).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** The live ask, as filed: a decide with its advice, no options, no pictures. */
const Q733 = { title: 'Drop B1011, B978 and B934 now?', text: 'I advise yes.', options: [], advice: 'yes', kind: 'decide' }
/** Asks that drop a step or goal, in the ways a chat says it. */
const DROPS = {
  Q733,
  one: { title: 'Should we drop it?', text: 'The bridge sheet never reached 60.', options: [], advice: 'yes', kind: 'decide' },
  goal: { title: 'Remove goal G41 from the plan?', text: 'Its steps moved to G29.', options: [], advice: 'yes', kind: 'decide' },
  words: { title: 'Drop the step B40 or keep it for later?', text: '', options: [], advice: 'drop', kind: 'decide' },
  option: { title: 'What happens to the old bridge sheet?', text: 'Both are cheap.', options: ['A drop B978', 'B keep it as a fallback'], advice: 'A', kind: 'decide' },
  these: { title: 'Remove these steps now?', text: 'B12 and B13 are covered by the new shop.', options: [], advice: 'yes', kind: 'decide' },
}
/** Asks with "drop" or "remove" in the game's words, or a drop as a fact: none asks to drop a step or goal. */
const GAME = {
  lava: { title: 'Should the drops of lava fall faster on the crater map?', text: 'Each drop now takes two turns to land.', options: ['A faster', 'B as now'], advice: 'A', kind: 'decide' },
  zone: { title: 'Where does the drop zone go: A north or B south?', text: 'The units drop in at the start of the fight.', options: ['A north', 'B south'], advice: 'A', kind: 'decide' },
  shadow: { title: 'Remove the drop shadow from the units on B40\'s map?', text: 'It reads as a hole in the floor.', options: [], advice: 'yes', kind: 'decide' },
  item: { title: 'Should a beaten slime drop a coin?', text: 'Players asked for loot.', options: [], advice: 'yes', kind: 'decide' },
  fact: { title: 'Is the shop button gold enough now?', text: 'Main dropped B970 last week, so this is the only shop step left.', options: [], advice: 'yes', kind: 'look' },
}
const wordsOf = one => [one.title, one.text, one.options.join(' | ')].join(' ')

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const filed = (id, one, fields = {}) => parseItem(text(
  { Id: id, Kind: 'ask', Title: one.title, State: 'open', Owner: 'Main', Since: at(5), Filed: String(NOW - 5 * MIN), Asks: one.kind, Blocking: 'no', Of: 'B40', ...(one.options.length === 0 ? {} : { Options: one.options.join(' | ') }), ...(one.advice === '' ? {} : { Advice: one.advice }), ...fields },
  { Text: [one.title, ...(one.text === '' ? [] : [one.text])], History: [`- ${at(5)} Main: asked (${one.kind})`] }))

test('the matcher: Q733 and the other ways to ask a drop of a step or goal are drop asks; the game\'s words and a drop as a fact are not', () => {
  for (const [id, one] of Object.entries(DROPS)) assert.notEqual(dropAskOf(wordsOf(one)), null, `${id}: ${one.title}`)
  for (const [id, one] of Object.entries(GAME)) assert.equal(dropAskOf(wordsOf(one)), null, `${id}: ${one.title}`)
  assert.equal(dropAskOf(wordsOf(Q733)), 'Drop B1011, B978 and B934 now?', 'the sentence that asks is named')
  assert.notEqual(dropAskOfItem(filed('Q1', DROPS.option)), null, 'the options alone ask it')
  assert.equal(dropAskOf(''), null)
  assert.equal(dropAskOf(null), null)
})

const ROLES = { Main: 'main', 'Worker 5': 'worker', Advisor: 'advisor' }
const roleOf = name => ROLES[name] ?? null
const route = (item, more = {}) => autopilotRoute(item, { roleOf, items: new Map([['B40', parseItem(text({ Id: 'B40', Kind: 'step', Title: 'Paint the bridge sheet', State: 'open', Owner: 'Main', Goal: 'G61' }))]]), focusGoal: 'G60', prefix: '', ...more })

test('Autopilot never answers a drop ask: Q733 goes to the person, whatever its advice, on the first pass and every pass after; the game\'s asks keep their ways', () => {
  assert.deepEqual(route(filed('Q733', Q733)), { to: 'person', why: DROP_ROUTE_WHY })
  for (const [id, one] of Object.entries(DROPS)) {
    assert.deepEqual(route(filed(id, one)), { to: 'person', why: DROP_ROUTE_WHY }, id)
    assert.equal(route(filed(id, one, { Via: 'chat' })).to, 'person', `${id} via chat`)
    assert.equal(route(filed(id, one, { Route: 'person' }), { again: true }).to, 'person', `${id} again`)
  }
  for (const [id, one] of Object.entries(GAME)) assert.notEqual(route(filed(id, one)).why, DROP_ROUTE_WHY, id)
  assert.equal(route(filed('lava', GAME.lava)).to, 'advice', 'a game decide with advice keeps its old way')
})

async function storeWith() {
  const dir = await mkdtemp(join(tmpdir(), 'drop-ask-'))
  const step = (id, title) => writeFile(join(dir, `${id}.md`), text({ Id: id, Kind: 'step', Title: title, State: 'open', Activity: 'Garden', Since: at(90) }, { History: [`- ${at(90)} Main: made`] }))
  await Promise.all([step('B934', 'Paint the old bridge sheet'), step('B40', 'Paint the bridge sheet')])
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: ['B934', 'B40'] }] }, null, 1)}\n`)
  return dir
}
const ctx = (dir, more = {}) => ({ dir, now: NOW, prefix: '', roleOf, chats: Object.keys(ROLES), focusGoal: 'G60', pictureProblem: async () => null, autopilot: true, ...more })

test('the main chat drops a superseded step itself with a why: no ask is filed, and the answer says the bookkeeping rule', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const made = await workApi({ action: 'drop', chat: 'Main', id: 'B934', why: 'superseded by B40 (the new bridge sheet the person picked)' }, ctx(dir))
  assert.equal(made.ok, true, made.why)
  assert.ok(made.result.text.startsWith(`${BOOKKEEPING_DROP_WORDS}\n\n`), made.result.text)
  const items = [...(await readStore(dir)).items.values()]
  assert.equal(valueOf(items.find(one => valueOf(one, 'Id') === 'B934'), 'State'), 'dropped')
  assert.deepEqual(items.filter(one => valueOf(one, 'Kind') === 'ask').map(one => valueOf(one, 'Id')), [], 'no ask')
})
