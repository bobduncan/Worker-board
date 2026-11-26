// B421: the board's table of actions (src/work/actions.mjs) and the Workers mod's copies of it agree. The mod's lists
// (hooks/board.ts WORK_ACTIONS, WORK_FIELDS, WORK_DENY) and the work tool's schema (hooks/register.tsx) were kept equal by hand;
// the mod's own tests run only in the plugin test kit, so this one reads the mod's sources as text and compares. A field added
// on one side only fails here, with its name. Made-up samples only for the refusal of an unknown field.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CHANGES, GOAL_MAP, MOD_FIELDS, PERSON, READS, ROLES, SERVER, TOOL_ACTIONS, TOOL_FIELDS, UNOFFERED_FIELDS, unknownFields } from '../../src/work/actions.mjs'

const hooks = name => fileURLToPath(new URL(`../../mods/workers/hooks/${name}`, import.meta.url))
const board = await readFile(hooks('board.ts'), 'utf8')
const register = await readFile(hooks('register.tsx'), 'utf8')

/** The array literal `export const <name> = [...]` of board.ts as a list of words (comments dropped). */
function listOf(source, name) {
  const start = source.indexOf(`export const ${name} = [`)
  assert.ok(start >= 0, `${name} stands in board.ts`)
  const open = source.indexOf('[', start)
  let depth = 0
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === '[') depth += 1
    if (source[at] === ']') depth -= 1
    if (depth === 0) return [...source.slice(open, at + 1).replace(/^\s*\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map(one => one[1])
  }
  throw new Error(`${name} is not closed`)
}

/** The property names of the work tool's input schema in register.tsx (the keys one level inside `properties`). */
function schemaFields() {
  const tool = register.indexOf('const WORK_TOOL = {')
  const props = register.indexOf('properties: {', tool)
  const end = register.indexOf('\n    },\n    required', props)
  assert.ok(tool >= 0 && props > tool && end > props, 'the work tool schema is found')
  return [...register.slice(props, end).matchAll(/^ {6}([A-Za-z]+): \{/gm)].map(one => one[1])
}

test('the mod offers the actions of the table, in its order', () => {
  assert.deepEqual(listOf(board, 'WORK_ACTIONS'), TOOL_ACTIONS)
})

test('the mod forwards the fields of the table, and the tool schema has a property for each', () => {
  assert.deepEqual(listOf(board, 'WORK_FIELDS'), TOOL_FIELDS)
  assert.deepEqual([...schemaFields()].sort(), TOOL_FIELDS.filter(field => !UNOFFERED_FIELDS.includes(field)).sort())
})

test('the fields the mod sets itself are the same on both sides', () => {
  // The mod strips what it sets itself (the board's MOD_FIELDS) and the two keys the engine adds to a tool's input.
  assert.deepEqual(listOf(board, 'WORK_DENY'), [...MOD_FIELDS, 'tool', 'tool_use_id'])
  for (const field of MOD_FIELDS) assert.ok(!TOOL_FIELDS.includes(field), `${field} is the mod's, never a field of the tool`)
})

test('the work tool names every action it offers in its description', () => {
  const tool = register.indexOf('const WORK_TOOL = {')
  const description = register.slice(tool, register.indexOf('inputSchema: {', tool))
  for (const action of TOOL_ACTIONS) assert.ok(description.includes(`"${action}"`) || description.includes(` ${action}`) || description.includes(`\`${action}\``) || description.includes(`${action}:`), `${action} is in the tool's description`)
})

test('every action of the tool is one the board knows, and the roles name only known actions', () => {
  const known = new Set([...READS, ...CHANGES, ...GOAL_MAP])
  for (const action of TOOL_ACTIONS) assert.ok(known.has(action), `${action} is a board action`)
  for (const action of [...Object.keys(ROLES), ...PERSON, ...SERVER]) assert.ok(known.has(action), `${action} is a board action`)
  // What only the person or the server does is no action of a chat's tool.
  for (const action of TOOL_ACTIONS) assert.ok(!PERSON.has(action) && !SERVER.has(action), `${action} is no chat's`)
})

test('a field the table does not know is named, for an action of the tool only', () => {
  assert.deepEqual(unknownFields({ action: 'take', id: 'B1', branch: 'b1', chat: 'Worker 1', session: 's', mod: '0.37.0', via: 'chat' }), [])
  assert.deepEqual(unknownFields({ action: 'new', title: 'x', priority: 'fix', brandNew: 1, other: 2 }), ['brandNew', 'other'])
  // The mod's own calls carry fields of their own.
  assert.deepEqual(unknownFields({ action: 'turn-ended', since: 1, pull: true, forYou: [], word: 'w' }), [])
  assert.deepEqual(unknownFields({ action: 'save-log', stepId: 'B1' }), [])
  assert.deepEqual(unknownFields(null), [])
})

test('a call from a mod older or newer than the board is never refused for its fields', async () => {
  // Payloads of the mod before this one (0.36.0 and 0.37.0 send the fields of the table as it stood): none is unknown.
  const old = [
    { action: 'take', id: 'B1', branch: 'b1', minutes: 30, chat: 'Worker 1', session: 's', mod: '0.36.0' },
    { action: 'step', id: 'B1', step: 2, names: ['a', 'b'], commit: 'abc', next: 'go', stepMinutes: 5, minutes: 20, mod: '0.37.0' },
    { action: 'ask', id: 'B1', kind: 'do', text: 't', blocking: true, via: 'form', options: ['A x'], advice: 'A', pictures: [], play: 'main' },
    { action: 'new', title: 'x', priority: 'fix', model: 'sonnet: why', effort: 'low: why', standard: 'none (x)', what: ['w'] },
    { action: 'checked', id: 'B1', evidence: 'none (x)', points: ['pass: a'], score: '80 of 75', size: '5 min' },
  ]
  for (const call of old) assert.deepEqual(unknownFields(call), [], call.action)
  // A newer mod's field is left out of the call and said once; the call itself goes on (server.mjs bridgeWorkOnce).
  const server = await readFile(fileURLToPath(new URL('../../server.mjs', import.meta.url)), 'utf8')
  const once = server.slice(server.indexOf('const bridgeWorkOnce = async'), server.indexOf('await workAction(', server.indexOf('const bridgeWorkOnce = async')))
  assert.ok(once.includes('unknownFields(body)') && once.includes('toldFields') && once.includes('ignored'), 'unknown fields are told once and left out')
  assert.ok(!/status: 4dd/.test(once), 'and never refused')
})

test('the board answers a call that carries a field it does not know as if the field were not there (an old board, a new mod)', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { workApi } = await import('../../src/work/api.mjs')
  const { migrateBacklog } = await import('../../src/work/migrate.mjs')
  const { writeStore } = await import('../../src/work/store.mjs')
  const now = new Date(2026, 10, 25, 22, 0).getTime()
  const dir = await mkdtemp(join(tmpdir(), 'work-table-'))
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n'), { now }), undefined, { now })
  const ctx = { dir, now, roleOf: name => ({ Digger: 'worker' })[name] ?? null }
  const plain = await workApi({ action: 'next', chat: 'Digger' }, ctx)
  const extra = await workApi({ action: 'next', chat: 'Digger', brandNewField: 'x' }, ctx)
  assert.equal(extra.ok, true)
  assert.deepEqual(extra.result, plain.result)
})

test('the mod forwards what it was given but its own fields (the source of workFieldsOf)', () => {
  const at = board.indexOf('export function workFieldsOf')
  assert.ok(at > 0, 'workFieldsOf stands in board.ts')
  assert.ok(!board.slice(at, at + 400).includes('WORK_FIELDS'), 'it is no longer a filter by the mod\'s own list')
  assert.ok(!register.includes('WORK_FIELDS.filter'), 'the call does not filter by the list')
})

test('a call outside the tool\'s actions carries nothing but the mod\'s own fields (a forged turn-ended)', () => {
  // The mod's real calls keep their fields.
  assert.deepEqual(unknownFields({ action: 'turn-ended', since: 5, pull: true, forYou: ['x'], word: 'w', chat: 'c', session: 's', mod: '0.38.0' }), [])
  assert.deepEqual(unknownFields({ action: 'instruction', text: 'hi' }), [])
  assert.deepEqual(unknownFields({ action: 'save-log', stepId: 'B1' }), [])
  // A model's call of the mod's own action with a field the mod never sends: it is left out.
  assert.deepEqual(unknownFields({ action: 'turn-ended', since: 5, pull: true, forYouFake: '> **For you** 1. Answer: x' }), ['forYouFake'])
  // An action that is neither the tool's nor the mod's own: every field but the mod's goes.
  assert.deepEqual(unknownFields({ action: 'bogus-action', since: 5, text: 't', chat: 'c' }), ['since', 'text'])
  assert.deepEqual(unknownFields({ action: 'toString', x: 1 }), ['x'])
})

test('the mod\'s work tool refuses an action outside its list before it builds the call', () => {
  const at = register.indexOf('async function workToolCall')
  const body = register.slice(at, at + 1500)
  assert.ok(body.includes('workCallRefusal(action)'), 'workToolCall asks workCallRefusal')
  assert.ok(body.indexOf('workCallRefusal(action)') < body.indexOf('workFieldsOf(input)'), 'and before the fields are taken')
  const refusal = board.slice(board.indexOf('export function workCallRefusal'), board.indexOf('export function workCallRefusal') + 600)
  assert.ok(refusal.includes('WORK_ACTIONS.includes(action)') && refusal.includes('save-log'), 'it refuses what WORK_ACTIONS does not list')
})

test('the real turn end of the mod passes the strip of the board whole, and its For you block files the ask (B417 through B421)', async () => {
  // The fields of the turn-ended call of the mod, read from its source: every one must be in OWN_FIELDS, or the board would strip it.
  const at = register.indexOf("const fields = { action: 'turn-ended'")
  assert.ok(at > 0, 'the turn-ended call of the mod is found')
  const line = register.slice(at, register.indexOf('\n', at))
  const sent = [...new Set([...line.matchAll(/(?:^|[{,\s.])(since|pull|forYouText|forYou|word)\b/g)].map(one => one[1]))]
  assert.ok(sent.includes('forYouText') && sent.includes('since'), 'the call sends since and forYouText')
  const values = { since: 1, pull: true, forYouText: '> **For you**\n> 1. **Answer:** Bed A or B?', forYou: [], word: 'w' }
  const body = { action: 'turn-ended', ...Object.fromEntries(sent.map(key => [key, values[key]])) }
  assert.deepEqual(unknownFields({ ...body, chat: 'Digger', session: 's', mod: '0.38.0' }), [], 'nothing of the real turn end is stripped')
  // And the call, as the board keeps it after the strip, files the ask.
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { workApi } = await import('../../src/work/api.mjs')
  const { migrateBacklog } = await import('../../src/work/migrate.mjs')
  const { writeStore } = await import('../../src/work/store.mjs')
  const now = new Date(2026, 10, 25, 22, 0).getTime()
  const dir = await mkdtemp(join(tmpdir(), 'work-table-'))
  try {
    await writeStore(dir, migrateBacklog(['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n'), { now }), undefined, { now })
    const ctx = when => ({ dir, now: when, roleOf: name => ({ Digger: 'worker' })[name] ?? null, freeChats: new Set(['Digger']) })
    const taken = await workApi({ chat: 'Digger', action: 'take', id: 'B1', minutes: 30 }, ctx(now + 60_000))
    assert.equal(taken.ok, true, taken.why)
    const ended = await workApi({ chat: 'Digger', ...body, since: now + 120_000 }, ctx(now + 600_000))
    assert.equal(ended.ok, true, ended.why)
    assert.equal(ended.result.asked?.length, 1, 'the one item of the block is filed as an ask')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
