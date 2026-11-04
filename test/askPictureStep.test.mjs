// An ask is filed of the step its pictures belong to (the board's signals lead, 2026-11-04, the live Q621): Worker 5 asked a look at B966's
// picture ("<pictures folder>/B966/first-look.png") but the ask was filed Of B942, another step it held, so the person's "no" counted
// against B942 and tripped a goal part on a fail that was B966's. When a worker's pictures all sit under one step's folder of the
// project's picture folder (the settings' first shown folder, never a name in the code) that differs from its Of, the ask is filed of the
// picture's step when the chat holds or held it, and refused when the chat holds neither step; mixed pictures or none leave Of as given.
// Made-up items in a temporary folder.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../src/work/api.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, share } from '../src/work/store.mjs'

share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 4, 12, 0).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
/** A step as the store keeps it; `took` the chat whose take its History records. */
const step = (id, fields, took = null) => text({ Id: id, Kind: 'step', Title: `Step ${id}`, State: 'in progress', Activity: 'Garden', Since: at(90), ...fields },
  { History: [`- ${at(90)} Lead: made`, ...(took === null ? [] : [`- ${at(80)} ${took}: queued → taken`, `- ${at(70)} ${took}: taken → in progress`])] })

// The night's steps: Worker 5 holds B942 (in review) and B966; B950 is Worker 6's; B901 was given back by Worker 5 (nobody owns it now).
const STEPS = {
  B942: step('B942', { State: 'review', Owner: 'Worker 5' }, 'Worker 5'),
  B966: step('B966', { Owner: 'Worker 5' }, 'Worker 5'),
  B950: step('B950', { Owner: 'Worker 6' }, 'Worker 6'),
  B901: step('B901', { State: 'queued' }, 'Worker 5'),
}
const ROLES = { Lead: 'main', 'Worker 5': 'worker', 'Worker 6': 'worker' }

async function storeWith(files = STEPS) {
  const dir = await mkdtemp(join(tmpdir(), 'ask-picture-step-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files) }] }, null, 1)}\n`)
  return dir
}
// The settings' picture folder comes in the context, as the server gives it; the tests use two names to show it is never a name in the code.
const ctx = (dir, more = {}) => ({ dir, now: NOW, prefix: '', roleOf: name => ROLES[name] ?? null, chats: Object.keys(ROLES), pictureProblem: async () => null, shownFolders: ['shots', 'refs'], ...more })
const chat = (dir, who, body, more = {}) => workApi({ ...body, chat: who }, ctx(dir, more))
const read = async dir => (await readStore(dir)).items
const look = (of, pictures, more = {}) => ({ action: 'ask', of, kind: 'look', title: 'Accept 73 of 75, or send it back?', text: ['Three rounds gave 73, 69 and one worse.'], advice: 'accepting it for now', pictures, ...more })

test('Q621\'s shape: a worker\'s look at B966\'s picture filed of B942 is filed of B966, which it holds; its History and answer say so', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const done = await chat(dir, 'Worker 5', look('B942', ['shots/B966/first-look.png']))
  assert.equal(done.ok, true, done.why)
  assert.deepEqual(done.result.placed, { from: 'B942', to: 'B966' })
  assert.match(done.result.text, /its pictures are B966's, so it is filed of B966, not B942/)
  const items = await read(dir)
  const id = done.result.id
  assert.equal(items.get(id).head.get('Of'), 'B966')
  assert.match(items.get(id).sections.get('History').at(-1), / server: filed of B966, the step its pictures name \(B942 was given\)$/)
  // The step it stands under is B966's: B942 knows nothing of it.
  assert.ok(items.get('B966').sections.get('Context').some(line => line.includes(`Asked ${id}`)))
  assert.equal((items.get('B942').sections.get('Context') ?? []).some(line => line.includes(`Asked ${id}`)), false)
  // The step the ask was meant for is also found by its pictures when the chat gives none: the folder is the settings', any name, any case.
  const other = await chat(dir, 'Worker 5', look('B942', ['refs\\b966\\second.png'], { title: 'Does the shore look right now?' }), { shownFolders: ['refs'] })
  assert.equal(other.ok, true, other.why)
  assert.equal((await read(dir)).get(other.result.id).head.get('Of'), 'B966')
})

test('through the chat\'s "For you" block: the item the card\'s step took (B942) is filed of the picture\'s step', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const ended = await chat(dir, 'Worker 5', { action: 'turn-ended', since: NOW - 5 * MIN, forYou: [{ kind: 'look', text: ['Accept 73 of 75 on the recap, or send the shore and foot glow back? I advise accepting it for now.'], pictures: ['shots/B966/first-look.png'], advice: 'accepting it for now' }] }, { cardStepOf: () => 'B942' })
  assert.equal(ended.ok, true, ended.why)
  assert.equal(ended.result.asked.length, 1)
  assert.equal((await read(dir)).get(ended.result.asked[0]).head.get('Of'), 'B966')
})

test('the step a chat held (its History took it) and nobody owns now counts as held; a step another chat owns does not', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const given = await chat(dir, 'Worker 5', look('B942', ['shots/B901/old.png']))
  assert.equal(given.ok, true, given.why)
  assert.equal((await read(dir)).get(given.result.id).head.get('Of'), 'B901')
  // B950 is Worker 6's: Worker 5 holds B942, so the ask stays as given (it shows another step's picture for comparison).
  const kept = await chat(dir, 'Worker 5', look('B942', ['shots/B950/theirs.png'], { title: 'Does it match B950\'s look?' }))
  assert.equal(kept.ok, true, kept.why)
  assert.equal((await read(dir)).get(kept.result.id).head.get('Of'), 'B942')
  assert.equal(kept.result.placed, undefined)
})

test('a chat that holds neither step is refused with one line naming both; mixed pictures, none, a picture elsewhere and a chat that holds no steps leave Of as given', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true }))
  // Worker 6 holds B950 only: B942 is Worker 5's and the picture is B966's.
  const refused = await chat(dir, 'Worker 6', look('B942', ['shots/B966/first-look.png']))
  assert.equal(refused.ok, false)
  assert.equal(refused.status, 409)
  assert.equal(refused.why, 'Its pictures are B966\'s but you ask under B942, and you hold neither: ask under the step you hold, with its own pictures.')
  assert.equal(refused.why.includes('\n'), false, 'one line')
  // Left as given.
  const asOf = async (who, of, pictures, title) => {
    const done = await chat(dir, who, look(of, pictures, { title, text: ['Reason: ' + title.split('').reverse().join('')] }))
    assert.equal(done.ok, true, `${title}: ${done.why}`)
    assert.equal(done.result.placed, undefined, title)
    return (await read(dir)).get(done.result.id).head.get('Of')
  }
  assert.equal(await asOf('Worker 5', 'B942', ['shots/B966/a.png', 'shots/B942/b.png'], 'Is the moat painted yet?'), 'B942')
  assert.equal(await asOf('Worker 5', 'B942', [], 'Does the pool show lava?'), 'B942')
  assert.equal(await asOf('Worker 5', 'B942', ['shots/b966/a.png', 'shots/g60/demo/b.png'], 'Should the bar be wider?'), 'B942')
  assert.equal(await asOf('Worker 5', 'B942', ['shots/B942/a.png'], 'Its own step\'s picture?'), 'B942')
  assert.equal(await asOf('Worker 5', 'B942', ['elsewhere/B966/a.png'], 'Do the cliffs read round?'), 'B942')
  assert.equal(await asOf('Lead', 'B942', ['shots/B966/a.png'], 'The main chat\'s look at B966?'), 'B942')
  // Without the settings' folder in its context the rule is off: nothing is guessed.
  const bare = await chat(dir, 'Worker 5', look('B942', ['shots/B966/c.png'], { title: 'Is the shore too bright?' }), { shownFolders: undefined })
  assert.equal((await read(dir)).get(bare.result.id).head.get('Of'), 'B942')
})
