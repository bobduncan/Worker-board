// Fix 0.31.0, part 1 (the double give after a lazy clear, 2026-11-04 21:22): a typed call never erases a known mod. The Workers
// mod says its version in the X-Workers-Mod header of every call; the server merged it into the body for every bridge route
// but typed, and noteMod stored null for a call that said none, so the one typed post of the clear's `cleared` stage turned
// Worker 1's 0.31.0 into "unknown". The header now goes into every body, and a call without a version keeps the one known.
// Made-up chats; the real case is test/lazyClearReplay.test.mjs.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { modSaid, withModHeader } from '../src/bridge.mjs'

const NOW = new Date(2026, 10, 4, 21, 22).getTime()
const ok = chat => ({ ok: true, chat })

test('withModHeader: the header is merged on every route (the typed body too), a body\'s own mod is never taken, a header that is no version says none', () => {
  const typed = { chat: 'Worker 1', session: 's1', handover: 'b24b992a', stages: [{ stage: 'cleared', at: NOW }] }
  assert.deepEqual(withModHeader(typed, '0.31.0'), { ...typed, mod: '0.31.0' })
  assert.deepEqual(withModHeader({ chat: 'Worker 1', mod: '9.9.9' }, '0.31.0'), { chat: 'Worker 1', mod: '0.31.0' })
  assert.deepEqual(withModHeader({ chat: 'Worker 1', mod: '9.9.9' }, undefined), { chat: 'Worker 1' })
  for (const bad of ['', 'latest', '1.2.3.4.5', '0.31.0; drop', undefined, 31, ['0.31.0']]) assert.deepEqual(withModHeader({ chat: 'W' }, bad), { chat: 'W' }, String(bad))
  assert.deepEqual(withModHeader({ chat: 'W' }, ' 0.27.0 '), { chat: 'W', mod: '0.27.0' })
  // What is no object is left to the route's own refusal.
  for (const odd of [null, [], 'text', 7]) assert.deepEqual(withModHeader(odd, '0.31.0'), odd)
})

test('modSaid: a typed call without a version keeps the one the board knows, and only moves when the chat called; the first call without one is null', () => {
  const modOf = new Map()
  // The first call says none: unknown (a mod older than 0.16.0 stays so).
  modSaid(modOf, { chat: 'Old' }, ok('Old'), NOW)
  assert.deepEqual(modOf.get('Old'), { version: null, at: NOW })
  modSaid(modOf, { chat: 'Old' }, ok('Old'), NOW + 5000)
  assert.deepEqual(modOf.get('Old'), { version: null, at: NOW + 5000 })
  // A header call, then a typed call without a version: the version stays, `at` moves.
  modSaid(modOf, withModHeader({ chat: 'Worker 1' }, '0.31.0'), ok('Worker 1'), NOW)
  modSaid(modOf, { chat: 'Worker 1', handover: 'x', stages: [] }, ok('Worker 1'), NOW + 4000)
  assert.deepEqual(modOf.get('Worker 1'), { version: '0.31.0', at: NOW + 4000 })
  // A new version said later replaces it (the chat's mod was restarted on a newer one).
  modSaid(modOf, { chat: 'Worker 1', mod: '0.32.0' }, ok('Worker 1'), NOW + 9000)
  assert.deepEqual(modOf.get('Worker 1'), { version: '0.32.0', at: NOW + 9000 })
  // A refused call, or one with no chat, notes nothing.
  modSaid(modOf, { chat: 'Worker 2', mod: '0.31.0' }, { ok: false, status: 409 }, NOW)
  modSaid(modOf, { mod: '0.31.0' }, { ok: true }, NOW)
  assert.deepEqual([...modOf.keys()].sort(), ['Old', 'Worker 1'])
})

test('mutant "noteMod writing null": a call without a version erases nothing (killed by the version staying after a typed call)', () => {
  const modOf = new Map([['Worker 1', { version: '0.31.0', at: NOW }]])
  modSaid(modOf, { chat: 'Worker 1' }, ok('Worker 1'), NOW + 1000)
  assert.notEqual(modOf.get('Worker 1').version, null)
})

test('mutant "the header merge removed for typed": the server passes every bridge body through withModHeader, never skipping the typed route', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.ok(server.includes("parsed = withModHeader(parsed, req.headers['x-workers-mod'])"))
  // No route is left out of the merge: the call is a statement of its own, under no condition on the route (neither on its line nor the one before).
  const rows = server.split('\n')
  const at = rows.findIndex(row => row.includes("withModHeader(parsed, req.headers['x-workers-mod'])"))
  assert.ok(rows[at].trim().startsWith('parsed = withModHeader('), rows[at])
  assert.ok(rows[at - 1].trim().startsWith('//'), rows[at - 1])
  assert.ok(server.includes('modSaid(modOf, body, checked, clock())'))
  // The typed route's own call still notes the mod and hands it to the decision.
  const typed = server.slice(server.indexOf('    typed: counted('), server.indexOf('    game: async body'))
  assert.ok(typed.includes('noteMod(body, checked)') && typed.includes('decideFor(checked.chat, body?.mod ?? null'))
})
