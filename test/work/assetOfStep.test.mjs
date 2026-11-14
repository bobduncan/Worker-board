// F21 (chat 1, 2026-11-14): Worker 5 filed its picture requests A330-A332 and A345/A346 without `of` ("of": null in their request.json),
// so the board tied them to no step: its lane read "Stopped · task open" (red "Idle with its task open") while Codex drew for it, and
// their delivery woke nobody. Now a `work asset` call without `of`, from a chat that holds exactly one step at work (taken or in
// progress), is filed under that step, and the answer says "Filed under B1150." With no such step, or two, it is filed as before.

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { readAsset } from '../../src/assets.mjs'
import { PROVIDERS } from '../../src/providers/index.mjs'
import { workApi } from '../../src/work/api.mjs'
import { assetWorkOf } from '../../src/work/assetWait.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { tempDir } from '../tempDir.mjs'

const NOW = new Date(2026, 10, 14, 11, 20).getTime()
const MIN = 60_000
const ROLES = { Main: 'main', 'Worker 5': 'worker', 'Worker 2': 'worker' }

function text(head, sections = {}) {
  const lines = Object.entries(head).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const step = (id, state, owner, title = 'Draw the Mage animations') => ({ id, body: text({ Id: id, Kind: 'step', Title: title, State: state, Owner: owner, Activity: 'Garden', Since: stamp(NOW - 30 * MIN) }, { History: [`- ${stamp(NOW - 30 * MIN)} Main: made`] }) })

async function board(t, steps) {
  const project = await tempDir(t)
  const dir = join(project, '.claude', 'work')
  await mkdir(dir, { recursive: true })
  for (const one of steps) await writeFile(join(dir, `${one.id}.md`), one.body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: steps.map(one => one.id) }] }, null, 1)}\n`)
  const assetsDir = join(project, '.claude', 'assets')
  const assets = { dir: assetsDir, project, providerOf: () => ({ provider: PROVIDERS.codex, folder: null }), tools: () => ({ project }) }
  const ctx = { dir, now: NOW, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), freeChats: new Set(), assets }
  const ask = (chat, body) => workApi({ chat, action: 'asset', kind: 'visual', ...body }, ctx)
  return { ask, assetsDir, steps }
}

test('the real case: Worker 5 holds B1150 and asks without "of": the request is filed under B1150, the answer says so, the lane reads Codex draws', async t => {
  const b1150 = step('B1150', 'in progress', 'Worker 5')
  // Its next step only queued, and another worker's step at work: neither counts.
  const { ask, assetsDir } = await board(t, [b1150, step('B1151', 'queued', 'Worker 5', 'Next'), step('B1140', 'in progress', 'Worker 2', 'Other')])
  const done = await ask('Worker 5', { text: 'the Mage cast animation, 6 frames' })
  assert.equal(done.ok, true, done.why)
  assert.match(done.result.text, / Filed under B1150\.$/)
  const kept = await readAsset(assetsDir, done.result.id)
  assert.deepEqual([kept.who, kept.of, kept.state], ['Worker 5', 'B1150', 'waiting'])
  // The asset wait now ties it to the step: the lane's line is Codex's work, not "Stopped · task open".
  const work = assetWorkOf(parseItem(b1150.body), [kept], { chat: 'Worker 5', now: NOW })
  assert.notEqual(work, null)
  assert.match(work.words, /^Codex draws 1 picture for it · 0 of 1 done · since /)
})

test('with no step at work, or two, the request is filed as before (no step, no "Filed under"); a given "of" stays as it is', async t => {
  const none = await board(t, [step('B1151', 'queued', 'Worker 5', 'Next')])
  const alone = await none.ask('Worker 5', { text: 'a stone stair' })
  assert.equal(alone.ok, true, alone.why)
  assert.equal((await readAsset(none.assetsDir, alone.result.id)).of, null)
  assert.doesNotMatch(alone.result.text, /Filed under/)

  const two = await board(t, [step('B1150', 'in progress', 'Worker 5'), step('B1152', 'taken', 'Worker 5', 'Second')])
  const unsure = await two.ask('Worker 5', { text: 'a stone stair' })
  assert.equal((await readAsset(two.assetsDir, unsure.result.id)).of, null)
  assert.doesNotMatch(unsure.result.text, /Filed under/)

  const given = await board(t, [step('B1150', 'in progress', 'Worker 5')])
  const named = await given.ask('Worker 5', { text: 'a stone stair', of: 'B1149' })
  assert.equal((await readAsset(given.assetsDir, named.result.id)).of, 'B1149')
  assert.doesNotMatch(named.result.text, /Filed under/)
  // A taken step counts as at work too.
  const taken = await board(t, [step('B1153', 'taken', 'Worker 5')])
  const filed = await taken.ask('Worker 5', { text: 'a stone stair' })
  assert.equal((await readAsset(taken.assetsDir, filed.result.id)).of, 'B1153')
})
