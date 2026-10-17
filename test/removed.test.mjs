// B152: a worker that left the list of chats leaves the board, also when its chat stays open in the app (one with
// Remote Control on cannot be closed). Its card then says {"left": true}. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 14, 10, 30)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Studio · ","main":"Lead"}'

const app = ({ name, id = `cli-${name}`, active = NOW - 5 * MIN }) => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${id}`, cliSessionId: id, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: active, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

/** The board with these chats (each `{ name, id?, active? }`), their cards and when each card was written. */
function build({ chats, cards = {}, cardsAt = {} }) {
  const all = chats.map(chat => ({ id: `cli-${chat.name}`, ...chat }))
  const raw = {
    listText: LIST,
    appChatTexts: all.map(app),
    tails: Object.fromEntries(all.map(chat => [chat.id, rested])),
    planLineTexts: cards, planLineAt: cardsAt, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: { startedAt: NOW - 10 * MIN, offSince: null }, seen: null, now: NOW, config })
}
const LEFT = '{"left":true}'
const names = state => state.chats.map(chat => chat.name)

test('a worker whose card says it left has no lane, and is no worker for the ask for workers', () => {
  const state = build({ chats: [{ name: 'Lead' }, { name: 'Worker 1' }, { name: 'Worker 2' }], cards: { 'cli-Worker 2': LEFT } })
  assert.deepEqual(names(state), ['Lead', 'Worker 1'])
  assert.equal(state.workers.count, 1)
  const alone = build({ chats: [{ name: 'Lead' }, { name: 'Worker 1' }], cards: { 'cli-Worker 1': LEFT } })
  assert.deepEqual([names(alone), alone.workers.count], [['Lead'], 0])
})

test('for two minutes after its card said so, the lane stays and says it was removed; then it goes', () => {
  const at = NOW - MIN
  const state = build({ chats: [{ name: 'Lead' }, { name: 'Worker 1' }], cards: { 'cli-Worker 1': LEFT }, cardsAt: { 'cli-Worker 1': at } })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.removedAt]), [['Lead', null], ['Worker 1', at]])
  assert.equal(state.workers.count, 0)
  const later = build({ chats: [{ name: 'Lead' }, { name: 'Worker 1' }], cards: { 'cli-Worker 1': LEFT }, cardsAt: { 'cli-Worker 1': NOW - 3 * MIN } })
  assert.deepEqual(names(later), ['Lead'])
})

test('a chat that joins again shows again, and a new chat of a removed worker\'s name is no leftover', () => {
  const card = JSON.stringify({ name: 'Worker 1', role: 'worker', state: 'waiting', task: null, at: NOW - MIN })
  assert.deepEqual(names(build({ chats: [{ name: 'Lead' }, { name: 'Worker 1' }], cards: { 'cli-Worker 1': card } })), ['Lead', 'Worker 1'])
  // The removed chat is newer by its activity, yet the new one of the same name is the lane.
  const state = build({
    chats: [{ name: 'Lead' }, { name: 'Worker 1', id: 'cli-old', active: NOW - MIN }, { name: 'Worker 1', id: 'cli-new', active: NOW - 9 * MIN }],
    cards: { 'cli-old': LEFT },
  })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.session, chat.isLeftover]), [['Lead', 'cli-Lead', false], ['Worker 1', 'cli-new', false]])
})

test('a card that is no JSON, or says nothing of leaving, keeps the lane', () => {
  const state = build({ chats: [{ name: 'Lead' }, { name: 'Worker 1' }, { name: 'Worker 2' }], cards: { 'cli-Worker 1': 'not json', 'cli-Worker 2': '{"left":false}' } })
  assert.deepEqual(names(state), ['Lead', 'Worker 1', 'Worker 2'])
})

// The lane's line, cut out of board.js between its marks

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('remove')}\nObject.assign(this, { clock, removalView })`, page)

test('a removed worker\'s lane says it was removed, and its control waits', () => {
  const at = new Date(2026, 9, 14, 10, 29).getTime()
  const lane = { name: 'Worker 1', isMain: false, isLeftover: false, state: 'free', task: null, queue: [], removal: { at: at - 5 * MIN, state: 'delivered', isOpen: true }, removedAt: at }
  assert.deepEqual(JSON.parse(JSON.stringify(page.removalView(lane, 'Studio · Lead', at + MIN))), {
    canRemove: true, reasons: [], isDisabled: true,
    line: { tone: 'asked', text: `Removed at ${page.clock(at)}: it left the list of chats, and this lane goes in a moment.` },
  })
})
