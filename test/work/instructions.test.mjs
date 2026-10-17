// B298: every word of the person's is filed as an instruction `I<n>` (spec 2026-10-17, section 6, hooks 1 and 2): open
// until its chat closes it; a turn of that chat that ends with it still open marks it missed. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { NOT_TRUTH, workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { instructionsOf } from '../../src/work/lists.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore, writeTruth } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5, 20).getTime()
const SEC = 1000
const BACKLOG = ['# Backlog', '', '## Board work', '- [ ] B1 Draw the strip (for Board; about 1 h)', ''].join('\n')
const ROLES = { Main: 'main', Board: 'worker' }

async function fresh(truth = 'store') {
  const dir = await mkdtemp(join(tmpdir(), 'work-instructions-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  await writeTruth(dir, { truth, since: '2026-10-17 11:05' })
  const ctx = at => ({ dir, now: at, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null })
  const as = chat => (body, at = NOW) => workApi({ chat, ...body }, ctx(at))
  return { dir, main: as('Main'), board: as('Board'), person: (body, at = NOW) => workApi(body, { ...ctx(at), as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)

test('two instructions filed within one minute both stand, each with its own id, and the chat is told how to close it', async () => {
  const { dir, main } = await fresh()
  try {
    const first = await main({ action: 'instruction', text: 'Make the strip blue' })
    const second = await main({ action: 'instruction', text: 'And queue the menu\nfor Board' }, NOW + 20 * SEC)
    assert.equal(first.ok, true, first.why)
    assert.equal(second.ok, true, second.why)
    assert.deepEqual([first.result.id, second.result.id], ['I1', 'I2'])
    assert.equal(first.result.text, 'Recorded as I1; close it with work close I1 --as "what came of it" once it is done.')
    const one = await item(dir, 'I1')
    assert.deepEqual(['Kind', 'Chat', 'State', 'Since', 'Via', 'Text'].map(key => valueOf(one, key)), ['instruction', 'Main', 'open', '2026-10-17 11:05:20', 'chat', 'Make the strip blue'])
    assert.deepEqual((await item(dir, 'I2')).sections.get('Text'), ['And queue the menu', 'for Board'])
    assert.equal(valueOf(await item(dir, 'I2'), 'Text'), 'And queue the menu for Board')
    assert.deepEqual(second.result.open, [{ id: 'I1', turns: 0, text: 'Make the strip blue' }, { id: 'I2', turns: 0, text: 'And queue the menu for Board' }])
    assert.deepEqual((await item(dir, 'I1')).sections.get('History'), ['- 2026-10-17 11:05 Main: filed'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the board files a line typed to a chat as the person\'s, naming the chat; an empty line or an unknown chat is refused', async () => {
  const { dir, person } = await fresh()
  try {
    const filed = await person({ action: 'instruction', chat: 'Board', text: 'Look at the strip' })
    assert.equal(filed.ok, true, filed.why)
    const one = await item(dir, filed.result.id)
    assert.deepEqual(['Chat', 'Via'].map(key => valueOf(one, key)), ['Board', 'board'])
    assert.equal((await person({ action: 'instruction', chat: 'Stranger', text: 'x' })).status, 404)
    assert.equal((await person({ action: 'instruction', chat: 'Board', text: '  ' })).status, 400)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('turn-ended marks only the instructions filed before the turn started, and counts the turns', async () => {
  const { dir, main, board } = await fresh()
  try {
    await main({ action: 'instruction', text: 'Make the strip blue' })
    // The turn its prompt opens starts a moment after it was filed; a second line comes in while that turn runs.
    const turn = NOW + 2 * SEC
    await main({ action: 'instruction', text: 'And the menu' }, NOW + 30 * SEC)
    await board({ action: 'instruction', text: 'Not Main\'s' })
    const ended = await main({ action: 'turn-ended', since: turn }, NOW + 60 * SEC)
    assert.equal(ended.ok, true, ended.why)
    assert.deepEqual(ended.result.missed, ['I1'])
    assert.deepEqual(ended.result.open.map(one => [one.id, one.turns]), [['I1', 1], ['I2', 0]])
    assert.equal(valueOf(await item(dir, 'I1'), 'Missed'), '1')
    assert.equal((await item(dir, 'I1')).sections.get('History').at(-1), '- 2026-10-17 11:06 server: missed: a turn of Main ended without closing it')
    assert.equal(valueOf(await item(dir, 'I2'), 'Missed'), null)
    assert.equal(valueOf(await item(dir, 'I3'), 'Missed'), null)
    // The next turn ends with both still open: both are missed, the first a second time.
    const again = await main({ action: 'turn-ended', since: NOW + 90 * SEC }, NOW + 120 * SEC)
    assert.deepEqual(again.result.missed, ['I1', 'I2'])
    assert.equal(valueOf(await item(dir, 'I1'), 'Missed'), '2')
    // A turn that ends with nothing open changes nothing.
    await main({ action: 'close', id: 'I1', as: 'made the strip blue' })
    const closed = await main({ action: 'close', id: 'I2', as: 'queued B1 for Board' })
    assert.deepEqual(closed.result.open, [])
    const none = await main({ action: 'turn-ended', since: NOW + 150 * SEC }, NOW + 180 * SEC)
    assert.deepEqual([none.result.missed, none.result.changed], [[], false])
    assert.equal((await main({ action: 'turn-ended' })).status, 400)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('while the store is a shadow, filing is refused with 409 and nothing is written', async () => {
  const { dir, main } = await fresh('shadow')
  try {
    assert.deepEqual(await main({ action: 'instruction', text: 'Make the strip blue' }), { ok: false, status: 409, why: NOT_TRUTH })
    assert.deepEqual(await main({ action: 'turn-ended', since: NOW }), { ok: false, status: 409, why: NOT_TRUTH })
    assert.equal((await readStore(dir)).items.has('I1'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('next lists the open instructions first, a missed one with its turns', async () => {
  const { main } = await fresh()
  await main({ action: 'instruction', text: 'Make the strip blue' })
  await main({ action: 'turn-ended', since: NOW + SEC }, NOW + 60 * SEC)
  const next = await main({ action: 'next' }, NOW + 60 * SEC)
  assert.match(next.result.text, /^Yours, Main:\n- I1 open, missed 1 turn: Make the strip blue\n/)
})

test('instructionsOf: per chat, open first and the missed ones on top, closed ones after with what came of them', async () => {
  const { dir, main, board } = await fresh()
  try {
    await main({ action: 'instruction', text: 'Make the strip blue' })
    await main({ action: 'instruction', text: 'And the menu' }, NOW + 30 * SEC)
    await board({ action: 'instruction', text: 'Draw it' })
    await main({ action: 'turn-ended', since: NOW + 10 * SEC }, NOW + 60 * SEC)
    await board({ action: 'close', id: 'I3', as: 'made step B2' })
    const work = { ok: true, ...(await readStore(dir)) }
    const list = instructionsOf(work, NOW + 120 * SEC)
    assert.deepEqual(list.map(one => [one.id, one.chat, one.isMissed, one.turns, one.closedAs]), [
      ['I1', 'Main', true, 1, null], ['I2', 'Main', false, 0, null], ['I3', 'Board', false, 0, 'made step B2'],
    ])
    assert.deepEqual([list[0].text, list[0].since, list[0].via], ['Make the strip blue', NOW, 'chat'])
    // A store that is no truth yet, or none, shows none.
    assert.deepEqual(instructionsOf({ ...work, truth: 'shadow' }, NOW), [])
    assert.deepEqual(instructionsOf(undefined, NOW), [])
    // A closed one shows for a day after it was filed.
    assert.deepEqual(instructionsOf(work, NOW + 25 * 60 * 60_000).map(one => one.id), ['I1', 'I2'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the state carries the instructions once the store is the truth, and none while it is a shadow', async () => {
  const { buildState } = await import('../../src/state.mjs')
  const { parseConfig } = await import('../../src/config.mjs')
  const { dir, main } = await fresh()
  try {
    await main({ action: 'instruction', text: 'Make the strip blue' })
    const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\game', isArchived: false, createdAt: 1, lastActivityAt: 1, lastAssistantUuid: 'u' })
    const raw = { listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: ['Main', 'Board'].map(app), tails: {}, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {} }
    const options = { lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\game' } }
    const work = { ok: true, dir, ...(await readStore(dir)) }
    assert.deepEqual(buildState({ ...raw, work }, options).instructions.map(one => one.id), ['I1'])
    assert.deepEqual(buildState({ ...raw, work: { ...work, truth: 'shadow' } }, options).instructions, [])
    assert.deepEqual(buildState(raw, options).instructions, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('review: the turn\'s start is compared to the millisecond: a line filed in the same second after it is not missed', async () => {
  const { dir, main } = await fresh()
  try {
    await main({ action: 'instruction', text: 'Before the turn' }, NOW + 100)
    await main({ action: 'instruction', text: 'Typed while it runs' }, NOW + 800)
    assert.equal(valueOf(await item(dir, 'I1'), 'Filed'), String(NOW + 100))
    const ended = await main({ action: 'turn-ended', since: NOW + 500 }, NOW + 900)
    assert.deepEqual(ended.result.missed, ['I1'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
