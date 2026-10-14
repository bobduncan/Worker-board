// B124: the board asks the main chat for workers: three, once, when the main chat is alone in the list; one more on
// the person's click. The board only asks; the main chat names, briefs and starts the chats. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay, spawnWhenAlone } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 14, 9, 12)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Game - ","main":"Main"}'

const app = (name, createdAt) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

/** The board with these chats (`made`: when each was made), what was sent, and whose mod asked the board lately. */
function build({ chats = ['Main'], made = {}, outbox = [], running = ['Main'], listText = LIST, now = NOW } = {}) {
  const raw = {
    listText,
    appChatTexts: chats.map(name => app(name, made[name] ?? NOW - 2 * HOUR)),
    tails: Object.fromEntries(chats.map(name => [`cli-${name}`, rested])),
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(running.map(name => [name, now - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: now - 10 * MIN, offSince: null }, seen, now, config })
}

const WORDS = { to: 'Main', ask: null, step: null, title: null, version: null, verdict: null, command: 'spawn' }
const sent = (at, more = {}) => ({ id: `m${at}`, at, ...WORDS, count: 3, why: 'alone', text: 'spawn workers\nCount: 3\nWhy: no worker is in the list', state: 'delivered', deliveredAt: at + 5000, ...more })

// What the state says

test('the state names the main chat, counts the workers, and gives what a new project needs to make its main chat', () => {
  assert.deepEqual(build().workers, { main: 'Main', mainTitle: 'Game - Main', project: PROJECT, count: 0, ask: null, lookFor: [] })
  assert.equal(build({ chats: ['Main', 'Units', 'Worker 1'] }).workers.count, 2)
  // The advisor is talked with on its own tab: it is no worker.
  assert.equal(build({ chats: ['Main', 'Advisor'] }).workers.count, 0)
  assert.deepEqual(build({ chats: ['Units'] }).workers, { main: null, mainTitle: 'Game - Main', project: PROJECT, count: 1, ask: null, lookFor: [] })
  // The names come from the list of chats, whatever the project calls its chats.
  assert.equal(build({ chats: [], listText: '{"prefix":"Studio · ","main":"Lead"}' }).workers.mainTitle, 'Studio · Lead')
})

test('an ask is open while it is on its way, and after it arrived until the workers came, for 15 minutes at most', () => {
  const ask = (outbox, chats = ['Main'], made = {}) => build({ outbox, chats, made }).workers.ask
  assert.deepEqual(ask([sent(NOW - MIN, { state: 'waiting', deliveredAt: undefined })]), { at: NOW - MIN, count: 3, why: 'alone', state: 'waiting', arrived: 0, isOpen: true })
  assert.equal(ask([sent(NOW - MIN, { state: 'taken', deliveredAt: undefined })]).isOpen, true)
  assert.deepEqual(ask([sent(NOW - 5 * MIN)]), { at: NOW - 5 * MIN, count: 3, why: 'alone', state: 'delivered', arrived: 0, isOpen: true })
  // Workers made after the ask have come; one made before it was there already.
  const one = ask([sent(NOW - 5 * MIN)], ['Main', 'Units', 'Worker 1'], { 'Worker 1': NOW - 2 * MIN })
  assert.deepEqual([one.arrived, one.isOpen], [1, true])
  const all = ask([sent(NOW - 5 * MIN, { count: 1, why: 'button' })], ['Main', 'Worker 1'], { 'Worker 1': NOW - 2 * MIN })
  assert.deepEqual([all.arrived, all.isOpen], [1, false])
  assert.equal(ask([sent(NOW - 16 * MIN)]).isOpen, false)
  for (const state of ['expired', 'failed']) assert.equal(ask([sent(NOW - MIN, { state, deliveredAt: undefined })]).isOpen, false, state)
  // The newest ask is the one shown; other words to the main chat are not asks for workers.
  assert.equal(ask([sent(NOW - 30 * MIN), sent(NOW - 2 * MIN, { count: 1, why: 'button' }), { ...sent(NOW - MIN), command: 'resume' }]).count, 1)
})

// By itself, once

test('the main chat alone is asked once for three workers, in the board\'s own words', () => {
  assert.deepEqual(spawnWhenAlone(build(), [], [], NOW), { ...WORDS, count: 3, why: 'alone', text: 'spawn workers\nCount: 3\nWhy: no worker is in the list' })
  // Asked: not again, also long after the board stopped showing that ask.
  const asked = sent(NOW - MIN, { state: 'waiting', deliveredAt: undefined })
  assert.equal(spawnWhenAlone(build({ outbox: [asked] }), [asked], [], NOW), null)
  const old = sent(NOW - 6 * HOUR)
  assert.equal(spawnWhenAlone(build(), [old], [{ at: NOW - 10 * MIN, chat: 'Main', state: 'free' }], NOW), null)
  // An ask that did not arrive is asked again by the button, not by the board.
  const lost = sent(NOW - 30 * MIN, { state: 'expired', deliveredAt: undefined })
  assert.equal(spawnWhenAlone(build({ outbox: [lost] }), [lost], [], NOW), null)
})

test('the board asks again only after workers came and all went', () => {
  const old = sent(NOW - 6 * HOUR)
  const came = [{ at: NOW - 5 * HOUR, chat: 'Worker 1', state: 'working' }, { at: NOW - 2 * HOUR, chat: 'Worker 1', state: 'free' }]
  assert.equal(spawnWhenAlone(build(), [old], came, NOW).count, 3)
  // A gap in the history is nobody.
  assert.equal(spawnWhenAlone(build(), [old], [{ at: NOW - HOUR, gap: true }], NOW), null)
})

test('the board does not ask while the main chat\'s chat is not open, when a worker exists, or without a main chat', () => {
  assert.equal(spawnWhenAlone(build({ running: [] }), [], [], NOW), null)
  assert.equal(spawnWhenAlone(build({ chats: ['Main', 'Units'] }), [], [], NOW), null)
  assert.equal(spawnWhenAlone(build({ chats: ['Units'], running: ['Units'] }), [], [], NOW), null)
  // An ask from the button that is still open stands for it.
  const pressed = sent(NOW - MIN, { why: 'button' })
  assert.equal(spawnWhenAlone(build({ outbox: [pressed] }), [pressed], [], NOW), null)
})

// On the person's click

test('the button asks the main chat for one more worker, or for three when there is none', () => {
  const more = checkSay({ to: 'Main', command: 'spawn' }, build({ chats: ['Main', 'Units'] }), 2000)
  assert.deepEqual(more, { ok: true, message: { ...WORDS, count: 1, why: 'button', text: 'spawn workers\nCount: 1\nWhy: asked with the button' } })
  assert.deepEqual(checkSay({ to: 'Main', command: 'spawn' }, build(), 2000).message.count, 3)
})

test('the button asks only the main chat, carries nothing else, and waits while an earlier ask is open', () => {
  const state = build({ chats: ['Main', 'Units'] })
  assert.deepEqual(checkSay({ to: 'Units', command: 'spawn' }, state, 2000).status, 400)
  assert.deepEqual(checkSay({ to: 'Main', command: 'spawn', text: 'ten workers please' }, state, 2000).status, 400)
  const open = build({ chats: ['Main', 'Units'], outbox: [sent(NOW - MIN, { count: 1, why: 'button', state: 'taken', deliveredAt: undefined })] })
  assert.deepEqual(checkSay({ to: 'Main', command: 'spawn' }, open, 2000), { ok: false, status: 409, why: 'An earlier ask for workers is still open.' })
  const lost = build({ chats: ['Main', 'Units'], outbox: [sent(NOW - 20 * MIN, { count: 1, why: 'button', state: 'expired', deliveredAt: undefined })] })
  assert.equal(checkSay({ to: 'Main', command: 'spawn' }, lost, 2000).ok, true)
})

test('B131, B137: an empty board says what it looks for and where, from the settings; a full one says nothing', async () => {
  const { lookingFor } = await import('../src/state.mjs')
  const { join } = await import('node:path')
  const settings = { project: 'C:/p', backlog: '.claude/backlog.md' }
  const ok = { prefix: 'Team - ', main: 'Lead', problem: null }
  const listFile = join('C:/p', '.claude', 'chats', 'list.json')
  assert.deepEqual(lookingFor({ list: ok, prefix: 'Team - ', config: settings, chats: 2, hasBacklog: true }), [])
  assert.deepEqual(lookingFor({ list: { prefix: null, main: null, problem: 'missing' }, prefix: '', config: settings, chats: 0, hasBacklog: false }), [
    `No list of chats: the board looks for ${listFile}. Copy examples/list.json there and set "prefix" (how the project's chat titles start) and "main" (the main chat's name).`,
    `No backlog yet: the board reads ${join('C:/p', '.claude', 'backlog.md')}.`,
  ])
  assert.deepEqual(lookingFor({ list: { prefix: null, main: null, problem: 'broken' }, prefix: '', config: settings, chats: 0, hasBacklog: true }), [`The list of chats ${listFile} is not valid JSON.`])
  assert.deepEqual(lookingFor({ list: ok, prefix: 'Team - ', config: settings, chats: 0, hasBacklog: true }), ['No chat of this project yet: the board shows the open chats in C:/p whose titles start with "Team - ".'])
  assert.deepEqual(lookingFor({ list: ok, prefix: '', config: { ...settings, project: '' }, chats: 0, hasBacklog: false }), ['The settings name no "project": the board looks for everything in that folder.'])
  // Without a list the state has no main chat and no main chat's title to guess.
  const empty = build({ chats: ['Main'], listText: null })
  assert.deepEqual([empty.workers.main, empty.workers.mainTitle, empty.chats.length], [null, null, 0])
  assert.match(empty.workers.lookFor[0], /^No list of chats: the board looks for /)
})
