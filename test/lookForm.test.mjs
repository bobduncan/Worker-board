// A look kept for the recap says Context, Problem and what each button does (the person, 2026-11-08, about Q692: "i also dont understand
// what its asking me ... not too much text either, context, problem"). The reader, the refusal of a look without the four lines (fixable in
// one retry), the Supervisor's silence on it, and the board's line to the chat. Made-up garden project in a temporary folder.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { LOOK_FORM_WHY, isLookForm, lookFormOf } from '../src/work/lookForm.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { REPAIR_RULES } from '../src/supervisor/rules/repair.mjs'
import { workApi } from '../src/work/api.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, share } from '../src/work/store.mjs'

share.ms = 0
const MIN = 60_000
const NOW = new Date(2026, 10, 8, 23, 50).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

const FORM = ["Context: The new one-way stairs rule (B1072) changed World 1's Cavern 2", 'Problem: 3 squares of its west corridor can no longer be reached; nothing starts there', 'Approve: keep it as it is for now', 'Send back: a later step makes the corridor reachable again']

test('lookFormOf: all four lines, any case and spacing, bold labels; the other lines stay in rest', () => {
  const form = lookFormOf(['Is that fine?', ...FORM.slice(0, 2), '  APPROVE :   keep it ', '**Send back:** a later step', 'See the second picture.'])
  assert.deepEqual(form, { context: "The new one-way stairs rule (B1072) changed World 1's Cavern 2", problem: '3 squares of its west corridor can no longer be reached; nothing starts there', approve: 'keep it', sendBack: 'a later step', rest: ['Is that fine?', 'See the second picture.'] })
  assert.equal(isLookForm(form), true)
  assert.deepEqual(lookFormOf(FORM.join('\n')).rest, [], 'a text of lines reads the same')
})

test('lookFormOf: missing or empty lines are null and the form is not complete', () => {
  const form = lookFormOf(['Context: here', 'Problem: ', 'Approve: yes'])
  assert.deepEqual([form.context, form.problem, form.approve, form.sendBack], ['here', '', 'yes', null])
  assert.equal(isLookForm(form), false)
  assert.equal(isLookForm(lookFormOf('')), false)
  assert.equal(isLookForm(null), false)
})

const text = (head, sections = {}) => `${[...Object.entries(head).map(([key, value]) => `${key}: ${value}`), ...Object.entries(sections).flatMap(([name, body]) => ['', `## ${name}`, ...body])].join('\n')}\n`
const step = (id, fields) => text({ Id: id, Kind: 'step', Activity: 'Garden', Since: at(300), ...fields }, { History: [`- ${at(300)} Lead: made`] })
const ROLES = { Lead: 'main', Partner: 'advisor', Painter: 'worker' }
async function storeWith() {
  const dir = await mkdtemp(join(tmpdir(), 'look-form-'))
  const files = { B56: step('B56', { Title: 'Round the pond', State: 'in progress', Owner: 'Painter', Goal: 'G29' }), B70: step('B70', { Title: 'Trim the hedge', State: 'in progress', Owner: 'Painter', Goal: 'G30' }) }
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files) }] }, null, 1)}\n`)
  return dir
}
const ctx = (dir, more = {}) => ({ dir, now: NOW, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G29', focusHasDemo: true, recaps: [], pictureProblem: async () => null, autopilot: true, ...more })
const ask = (dir, body, more) => workApi({ action: 'ask', chat: 'Painter', ...body }, ctx(dir, more))
const LOOK = { of: 'B56', kind: 'look', title: 'Does the pond corridor look right?', pictures: ['pictures/B56/after.jpg'] }
const askCount = async dir => [...(await readStore(dir)).items.values()].filter(one => one.head.get('Kind') === 'ask').length

test('the refusal: a worker\'s look with pictures on a focus step without the form is a 409 with the why and the form to copy; nothing is stored', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const refused = await ask(dir, { ...LOOK, text: ['The corridor in the west can not be reached.'] })
  assert.equal(refused.ok, false)
  assert.equal(refused.status, 409)
  assert.ok(refused.why.startsWith(LOOK_FORM_WHY), refused.why)
  assert.match(refused.why, /Context: B56 Round the pond\nProblem: The corridor in the west can not be reached\.\nApprove: keep it as it is\nSend back: a later step changes it/)
  assert.equal(await askCount(dir), 0)
})

test('one retry fixes it: the suggested block with the pictures kept is kept for the recap on the first try', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const refused = await ask(dir, { ...LOOK, text: ['The corridor in the west can not be reached.'] })
  const block = refused.why.split('\n').filter(one => /^(Context|Problem|Approve|Send back): /.test(one))
  assert.equal(block.length, 4)
  const again = await ask(dir, { ...LOOK, text: block })
  assert.equal(again.ok, true, again.why)
  const items = (await readStore(dir)).items
  assert.deepEqual([items.get(again.result.id).head.get('Route'), items.get(again.result.id).head.get('Blocking')], ['recap', 'no'])
})

test('with the form written by the chat itself it is kept as today', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const kept = await ask(dir, { ...LOOK, text: FORM })
  assert.equal(kept.ok, true, kept.why)
  assert.equal((await readStore(dir)).items.get(kept.result.id).head.get('Route'), 'recap')
})

test('looks not kept for the recap are unchanged: no pictures, a step of another goal, Autopilot off', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const plain = await ask(dir, { of: 'B56', kind: 'look', title: 'Is the lantern bright enough?', text: ['The lantern glows.'] })
  assert.equal(plain.ok, true, plain.why)
  const other = await ask(dir, { ...LOOK, of: 'B70', title: 'Is the hedge trimmed evenly?', text: ['It is trimmed.'], pictures: ['pictures/B70/after.jpg'] })
  assert.equal(other.ok, true, other.why)
  const off = await ask(dir, { ...LOOK, title: 'Are the stepping stones spaced well?', text: ['They are spaced.'] }, { autopilot: false })
  assert.equal(off.ok, true, off.why)
  const items = (await readStore(dir)).items
  assert.deepEqual([plain, other, off].map(one => items.get(one.result.id).head.get('Route') === 'recap'), [false, false, false])
})

test('from the For you block (Via: chat): the refused look is told to the chat with the form to copy, never filed alone instead, and the chat is held', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const one = { kind: 'look', text: ['Does the pond corridor look right?', 'The corridor in the west can not be reached.'], pictures: ['pictures/B56/after.jpg'], play: 'main&arena=ring', options: [], advice: '' }
  const ended = await workApi({ action: 'turn-ended', chat: 'Painter', since: NOW - 5 * MIN, forYou: [one] }, ctx(dir))
  assert.equal(ended.ok, true, ended.why)
  assert.equal(await askCount(dir), 0)
  assert.equal(ended.result.left.length, 1)
  assert.match(ended.result.left[0], /was refused: A look for the recap needs four short lines/)
  assert.match(ended.result.left[0], /Send back: a later step changes it/)
  assert.equal(ended.result.unfiled, 1)
  // The resubmit with the suggested block is filed at the next turn's end.
  const block = ended.result.left[0].split('\n').filter(line => /^(Context|Problem|Approve|Send back): /.test(line))
  const second = await workApi({ action: 'turn-ended', chat: 'Painter', since: NOW - 4 * MIN, forYou: [{ ...one, text: [one.text[0], ...block] }] }, ctx(dir))
  assert.equal(second.result.asked.length, 1)
  assert.equal(await askCount(dir), 1)
})

test('the Supervisor has no rule over a refused ask: only old-name (a refused name) and clear-owed-repeat (three hand-overs in a row, never one) read refusals', () => {
  const rules = [...(WATCH_RULES ?? []), ...(REPAIR_RULES ?? [])]
  assert.ok(rules.length > 10, 'the rule lists are found')
  const says = rules.map(rule => `${rule.id} ${rule.says}`).filter(one => /refus|unfiled/i.test(one))
  assert.deepEqual(says.map(one => one.split(' ')[0]).filter(id => !['old-name', 'clear-owed-repeat'].includes(id)), [], says.join(' | '))
})
