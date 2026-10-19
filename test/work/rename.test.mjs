// B313: a chat that is renamed keeps its work. The store names chats by their short name (Owner on steps and asks,
// Chat on instructions, From and To on notes, "for" in a queue asked before the refine); the board follows a rename of
// a session by itself, once, and the main chat or the person moves the rest with `rename`. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { followRenames } from '../../src/work/rename.mjs'
import { readStore, writeItem } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 18, 15, 0).getTime()
const head = lines => parseItem(`${lines.join('\n')}\n\n## History\n- 2026-10-18 14:00 Main: made\n`)
const ITEMS = [
  ['Id: B1', 'Kind: step', 'Title: Draw the strip', 'State: in progress', 'Owner: Units', 'Since: 2026-10-18 14:00', 'Branch: b1-strip'],
  ['Id: B2', 'Kind: step', 'Title: Keep the cards apart', 'State: queued', 'Owner: Units', 'Since: 2026-10-18 14:00'],
  ['Id: B3', 'Kind: step', 'Title: An old step', 'State: done', 'Owner: Units', 'Since: 2026-10-18 14:00'],
  ['Id: B4', 'Kind: step', 'Title: A step of another chat', 'State: in progress', 'Owner: Board', 'Since: 2026-10-18 14:00'],
  ['Id: B5', 'Kind: step', 'Title: A step queued once refined', 'State: new', 'Since: 2026-10-18 14:00', 'Queue when refined: for Units; after B4; about 1 h'],
  ['Id: B6', 'Kind: step', 'Title: A dropped step', 'State: dropped', 'Owner: Team - Units', 'Since: 2026-10-18 14:00'],
  ['Id: B7', 'Kind: step', 'Title: Units two', 'State: queued', 'Owner: Units 2', 'Since: 2026-10-18 14:00'],
  ['Id: Q1', 'Kind: ask', 'Title: Which look?', 'State: open', 'Owner: Team - Units', 'Since: 2026-10-18 14:00', 'Asks: decide', 'Blocking: no', 'Of: B1'],
  ['Id: Q2', 'Kind: ask', 'Title: Answered one', 'State: answered', 'Owner: Units', 'Since: 2026-10-18 14:00', 'Asks: decide', 'Blocking: no', 'Of: B1'],
  ['Id: I1', 'Kind: instruction', 'Chat: Units', 'State: open', 'Since: 2026-10-18 14:00:00', 'Via: chat', 'Text: Do it'],
  ['Id: I2', 'Kind: instruction', 'Chat: Units', 'State: closed', 'Since: 2026-10-18 14:00:00', 'Via: chat', 'Text: Done it', 'Closed as: made B1'],
  ['Id: N1', 'Kind: note', 'From: Units', 'To: main', 'State: unread', 'Since: 2026-10-18 14:00', 'Text: B1 reported'],
  ['Id: N2', 'Kind: note', 'From: Main', 'To: Units', 'State: unread', 'Since: 2026-10-18 14:00', 'Text: For you'],
  ['Id: N3', 'Kind: note', 'From: Units', 'To: you', 'State: read', 'Since: 2026-10-18 14:00', 'Text: Read already'],
]
const ROLES = { Main: 'main', Units: 'worker', 'Worker 4': 'worker', Board: 'worker' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-rename-'))
  for (const lines of ITEMS) await writeItem(dir, head(lines))
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Board work', steps: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'] }] })}\n`)
  const ctx = { dir, now: NOW, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Worker 4']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, ctx, main: as('Main'), units: as('Units'), worker4: as('Worker 4'), person: body => workApi(body, { ...ctx, as: 'person' }), server: body => workApi(body, { ...ctx, as: 'server' }) }
}
const items = async dir => (await readStore(dir)).items
const field = async (dir, id, key) => valueOf((await items(dir)).get(id), key)
const lastHistory = async (dir, id) => (await items(dir)).get(id).sections.get('History').at(-1)

test('B313: rename moves every open item naming the old name, with one History line each; closed ones stay', async () => {
  const { dir, main } = await fresh()
  try {
    const done = await main({ action: 'rename', from: 'Units', to: 'Worker 4' })
    assert.equal(done.ok, true, done.why)
    assert.deepEqual(done.result.moved, ['B1', 'B2', 'B5', 'Q1', 'I1', 'N1', 'N2'])
    assert.equal(done.result.text, 'Units renamed to Worker 4: B1, B2, B5, Q1, I1, N1, N2 moved.')
    for (const [id, key] of [['B1', 'Owner'], ['B2', 'Owner'], ['Q1', 'Owner'], ['I1', 'Chat'], ['N1', 'From'], ['N2', 'To']]) assert.equal(await field(dir, id, key), 'Worker 4', `${id} ${key}`)
    assert.equal(await field(dir, 'B5', 'Queue when refined'), 'for Worker 4; after B4; about 1 h')
    assert.equal(await field(dir, 'N1', 'To'), 'main')
    assert.equal(await lastHistory(dir, 'B1'), '- 2026-10-18 15:00 Main: Units renamed to Worker 4')
    // Done, dropped, answered, closed and read items keep the name they were done under; another chat's stays.
    for (const [id, key, name] of [['B3', 'Owner', 'Units'], ['B6', 'Owner', 'Team - Units'], ['B7', 'Owner', 'Units 2'], ['B4', 'Owner', 'Board'], ['Q2', 'Owner', 'Units'], ['I2', 'Chat', 'Units'], ['N3', 'From', 'Units']]) {
      assert.equal(await field(dir, id, key), name, `${id} ${key}`)
    }
    assert.equal(await lastHistory(dir, 'B3'), '- 2026-10-18 14:00 Main: made')
    // Once: nothing more moves the second time.
    const again = await main({ action: 'rename', from: 'Units', to: 'Worker 4' })
    assert.deepEqual([again.result.changed, again.result.text], [false, 'Nothing open names Units.'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B313: after the rename the chat takes and reports its step under its new name', async () => {
  const { dir, main, worker4, units } = await fresh()
  try {
    assert.equal((await worker4({ action: 'report', id: 'B1', result: 'the strip' })).status, 409)
    await main({ action: 'rename', from: 'Units', to: 'Worker 4' })
    const reported = await worker4({ action: 'report', id: 'B1', result: 'the strip' })
    assert.equal(reported.ok, true, reported.why)
    assert.equal(await field(dir, 'B1', 'State'), 'review')
    assert.equal((await units({ action: 'take', id: 'B2' })).status, 409)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B313: only the main chat, the person and the board rename; both names are needed', async () => {
  const { dir, units, person, server, main } = await fresh()
  try {
    assert.deepEqual(await units({ action: 'rename', from: 'Units', to: 'Worker 4' }), { ok: false, status: 403, why: 'Only main or person or server may rename.' })
    assert.equal((await main({ action: 'rename', from: 'Units' })).status, 400)
    assert.equal((await main({ action: 'rename', from: 'Units', to: 'units' })).status, 400)
    const byPerson = await person({ action: 'rename', from: 'Units', to: 'Worker 4' })
    assert.equal(byPerson.ok, true)
    assert.equal(await lastHistory(dir, 'B1'), '- 2026-10-18 15:00 person: Units renamed to Worker 4')
    const byBoard = await server({ action: 'rename', from: 'Worker 4', to: 'Units', same: true })
    assert.equal(byBoard.ok, true)
    assert.equal(await lastHistory(dir, 'B1'), '- 2026-10-18 15:00 server: Worker 4 renamed to Units (same chat)')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const NAMES = 'names.json'
const apply = ctx => body => workApi(body, { ...ctx, as: 'server' })

test('B313: the board follows a session\'s new name once, also across a restart; a first sight only records', async () => {
  const { dir, ctx } = await fresh()
  try {
    const first = await followRenames({ dir, chats: [{ session: 's-units', name: 'Units' }, { session: 's-main', name: 'Main' }], apply: apply(ctx), now: NOW })
    assert.deepEqual(first.moved, [])
    assert.deepEqual(JSON.parse(await readFile(join(dir, NAMES), 'utf8')).sessions, { 's-units': 'Units', 's-main': 'Main' })
    assert.equal(await field(dir, 'B1', 'Owner'), 'Units')
    // The board restarts (a new call reads names.json anew) and sees the session under its new name.
    const renamed = await followRenames({ dir, chats: [{ session: 's-units', name: 'Worker 4' }, { session: 's-main', name: 'Main' }], apply: apply(ctx), now: NOW })
    assert.deepEqual(renamed.moved, [{ from: 'Units', to: 'Worker 4', ids: ['B1', 'B2', 'B5', 'Q1', 'I1', 'N1', 'N2'] }])
    assert.equal(await field(dir, 'B1', 'Owner'), 'Worker 4')
    assert.equal(await lastHistory(dir, 'Q1'), '- 2026-10-18 15:00 server: Units renamed to Worker 4 (same chat)')
    assert.equal(JSON.parse(await readFile(join(dir, NAMES), 'utf8')).sessions['s-units'], 'Worker 4')
    const once = await followRenames({ dir, chats: [{ session: 's-units', name: 'Worker 4' }], apply: apply(ctx), now: NOW })
    assert.deepEqual(once.moved, [])
    assert.equal((await items(dir)).get('Q1').sections.get('History').filter(one => /renamed/.test(one)).length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B313: a name two sessions had is not moved; a line on top says so until the main chat moves it', async () => {
  const { dir, ctx, main } = await fresh()
  try {
    await followRenames({ dir, chats: [{ session: 's-a', name: 'Units' }, { session: 's-b', name: 'Units' }], apply: apply(ctx), now: NOW, prefix: 'Team - ' })
    const seen = await followRenames({ dir, chats: [{ session: 's-a', name: 'Worker 4' }, { session: 's-b', name: 'Units' }], apply: apply(ctx), now: NOW, prefix: 'Team - ' })
    assert.deepEqual(seen.moved, [])
    assert.deepEqual(seen.held, [{ from: 'Units', to: 'Worker 4', why: 'two chats had the name Units' }])
    assert.equal(await field(dir, 'B1', 'Owner'), 'Units')
    const line = 'names.json: the board did not move the open items of Units (B1, B2, B5, Q1, I1, N1, N2) to Worker 4, as two chats had the name Units: the main chat moves them with work rename --from "Units" --to "<its name now>".'
    assert.ok((await readStore(dir)).problems.some(one => one.file === NAMES && one.line === line), JSON.stringify((await readStore(dir)).problems))
    // Seen once: the next refresh holds nothing anew.
    const later = await followRenames({ dir, chats: [{ session: 's-a', name: 'Worker 4' }, { session: 's-b', name: 'Units' }], apply: apply(ctx), now: NOW, prefix: 'Team - ' })
    assert.deepEqual([later.moved, later.held], [[], []])
    // The main chat moves them by hand: the line goes.
    assert.equal((await main({ action: 'rename', from: 'Units', to: 'Worker 4' })).ok, true)
    assert.equal((await readStore(dir)).problems.some(one => one.file === NAMES), false)
    assert.deepEqual(JSON.parse(await readFile(join(dir, NAMES), 'utf8')).held, [])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B313: two sessions renamed from one name in the same refresh, or onto a name another chat has, are held too', async () => {
  const { dir, ctx } = await fresh()
  try {
    await followRenames({ dir, chats: [{ session: 's-a', name: 'Units' }, { session: 's-b', name: 'Board' }], apply: apply(ctx), now: NOW })
    const onto = await followRenames({ dir, chats: [{ session: 's-a', name: 'Board' }, { session: 's-b', name: 'Board' }], apply: apply(ctx), now: NOW })
    assert.deepEqual(onto.moved, [])
    assert.deepEqual(onto.held, [{ from: 'Units', to: 'Board', why: 'two chats have the name Board now' }])
    assert.equal(await field(dir, 'B1', 'Owner'), 'Units')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
