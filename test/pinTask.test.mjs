// Redesign Part 2 (2026-10-25): the board hands out every task; "Add to queue" and Main's queue are gone. The person
// keeps control with a pin: "Pin to <worker>" on a new or refined task's row on the Backlog tab and in its window; a
// pinned task says "Pinned to <worker>" with "Unpin" (and "Move to" in its window). It goes through the work API as the
// person (`pin`). The Workers panel lists the ready tasks in the board's order. The page's own code is run here, cut out
// of board.js. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const html = await readFile(join(HERE, '..', 'public', 'index.html'), 'utf8')

/** A function of board.js, cut out from its start to the next top-level function. */
const fn = name => {
  const from = script.indexOf(`function ${name}(`)
  assert.ok(from >= 0, `board.js has no function ${name}`)
  const to = script.indexOf('\n}\n', from)
  return script.slice(from, to + 3)
}

/** A small stand-in for the page's document: enough for `el` and what the pin's parts do with it. */
class Node {
  constructor(tag) { Object.assign(this, { tag, className: '', textContent: '', children: [], dataset: {}, attrs: {}, disabled: false, title: '', type: '', value: '' }) }
  append(...items) { for (const one of items) this.children.push(typeof one === 'string' ? { tag: '#text', textContent: one, children: [] } : one) }
  setAttribute(name, value) { this.attrs[name] = value }
}
const text = node => [node.textContent, ...(node.children ?? []).map(text)].join('')
const all = (node, test) => [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(one => all(one, test))]
const page = { document: { createElement: tag => new Node(tag) }, problems: new Map(), sending: new Set() }
vm.runInNewContext(`${fn('el')}\n${fn('pinPart')}\n${fn('pinChangePart')}\nObject.assign(this, { pinPart, pinChangePart })`, page)

const STATE = { chats: [{ name: 'Lead', isMain: true, isLeftover: false }, { name: 'Worker 1', isMain: false, isLeftover: false }, { name: 'Worker 3', isMain: false, isLeftover: false }, { name: 'Old', isMain: false, isLeftover: true }] }
const step = (more = {}) => ({ id: 'B12', title: 'Build the shop', status: 'open', item: { pinned: null }, ...more })

test('a refined task\'s window has "Pin to" with the workers beside it; a pinned one says so, with Unpin and Move to', () => {
  const free = page.pinPart(step(), STATE, true)
  const buttons = all(free, node => node.tag === 'button')
  assert.deepEqual(buttons.map(one => [one.textContent, one.dataset.pinStep]), [['Pin to', 'B12']])
  const pick = all(free, node => node.tag === 'select')[0]
  assert.equal(pick.dataset.pinTarget, 'B12')
  assert.deepEqual(pick.children.map(one => one.value), ['Worker 1', 'Worker 3'], 'the workers of the list, no main chat, no leftover')
  const pinned = page.pinPart(step({ item: { pinned: 'Worker 3' } }), STATE, true)
  assert.match(text(pinned), /^Pinned to Worker 3/)
  assert.deepEqual(all(pinned, node => node.tag === 'button').map(one => [one.textContent, one.dataset.unpinStep ?? one.dataset.pinStep]), [['Unpin', 'B12'], ['Move to', 'B12']])
  assert.deepEqual(all(pinned, node => node.tag === 'select')[0].children.map(one => one.value), ['Worker 1'])
  // The row: the same, without Move to.
  assert.deepEqual(all(page.pinPart(step({ item: { pinned: 'Worker 3' } }), STATE, false), node => node.tag === 'button').map(one => one.textContent), ['Unpin'])
  // A task given, under way, done or the person's: no pin.
  for (const status of ['queued', 'progress', 'done', 'you']) assert.equal(page.pinPart(step({ status }), STATE, true), null, status)
})

test('a task in a worker\'s queue: pinned, it moves to another worker or is unpinned; given by the board, it says so', () => {
  const lane = { name: 'Worker 1' }
  const pinned = page.pinChangePart(lane, { id: 'B12', isPinned: true }, STATE)
  assert.deepEqual(all(pinned, node => node.tag === 'button').map(one => one.textContent), ['Move to', 'Unpin'])
  assert.deepEqual(all(pinned, node => node.tag === 'select')[0].children.map(one => one.value), ['Worker 3'])
  const given = page.pinChangePart(lane, { id: 'B13' }, STATE)
  assert.deepEqual(all(given, node => node.tag === 'button'), [])
  assert.match(text(given), /The board gave it to Worker 1/)
})

test('the pin goes through the work API as the person; the old queue words are gone from the page', () => {
  assert.match(fn('pinClick'), /return sendWork\(\{ action: 'pin', id, for: target \}, `pin:\$\{id\}`\)/)
  for (const gone of ['Add to queue', 'Take out of the queue', 'to hand it out', 'Put in a queue', 'askQueue', "command: 'queue'"]) {
    assert.ok(!script.includes(gone), `board.js still says ${gone}`)
    assert.ok(!html.includes(gone), `index.html still says ${gone}`)
  }
  assert.match(html, /id="design-queue" type="button">Put on the list</)
  assert.ok(!html.includes('id="design-worker"'), 'the Design tab picks no worker')
  // The rows of the Backlog tab and the window both handle the pin's clicks.
  assert.match(script, /const pin = event\.target\.closest\('\[data-pin-step\], \[data-unpin-step\]'\)/)
  assert.match(script, /const button = event\.target\.closest\('\[data-pin-move\], \[data-pin-step\], \[data-unpin-step\]'\)/)
})

test('the main chat\'s queue word is refused: the board hands out all tasks', () => {
  const state = { chats: [{ name: 'Lead', isLeftover: false }], restart: { main: 'Lead' }, backlog: [{ steps: [{ id: 'B12', status: 'open' }] }] }
  assert.deepEqual(checkSay({ to: 'Lead', command: 'queue', step: 'B12' }, state, 2000), { ok: false, status: 400, why: 'No such command.' })
})

test('the Workers panel lists the ready tasks in the board\'s order, each with whom it is kept for; the held ones with why', () => {
  const NOW = new Date(2026, 9, 25, 12, 0).getTime()
  const work = storeFromText('## Work\n', { now: NOW - 60 * 60_000 })
  const add = text => { const one = parseItem(text); work.items.set(one.head.get('Id'), one); work.activities[0].steps.push(one.head.get('Id')) }
  const since = stamp(NOW - 60 * 60_000)
  add(`Id: B2\nKind: step\nTitle: Paint the gate\nState: refined\nRefined: ready\nSince: ${since}\n`)
  add(`Id: B5\nKind: step\nTitle: Mend the fence\nState: refined\nRefined: ready\nPinned: Worker 3\nSince: ${since}\n`)
  add(`Id: B9\nKind: step\nTitle: Fix the lamp\nPriority: fix\nState: refined\nRefined: ready\nSince: ${since}\n`)
  add(`Id: B7\nKind: step\nTitle: Hang the sign\nState: refined\nRefined: ready\nBlocked by: B8\nSince: ${since}\n`)
  add(`Id: B8\nKind: step\nTitle: Cut the sign\nState: in progress\nOwner: Worker 1\nSince: ${since}\n`)
  const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: NOW - 60_000, lastAssistantUuid: 'u' })
  const build = extra => buildState({ listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: ['Lead', 'Worker 1', 'Worker 3'].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work },
    { lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game', ...extra } })
  const state = build({})
  // Outside the focus goal and not pinned, B2 waits for the person's pick (the hand-out of 2026-10-25).
  assert.deepEqual(state.readyList.ready.map(one => [one.id, one.title, one.pinned]), [['B9', 'Fix the lamp', null], ['B5', 'Mend the fence', 'Worker 3']])
  assert.deepEqual(state.readyList.held, [{ id: 'B2', why: 'outside the focus goal: waits until you pin it or switch the focus', title: 'Paint the gate' }, { id: 'B7', why: 'blocked by B8 (in progress)', title: 'Hang the sign' }])
  // With handOutBeyondFocus on, the whole backlog is ready again.
  const beyond = build({ handOutBeyondFocus: true })
  assert.deepEqual(beyond.readyList.ready.map(one => one.id), ['B9', 'B2', 'B5'])
  assert.deepEqual(beyond.readyList.held.map(one => one.id), ['B7'])
  // A pinned task stands in its worker's queue.
  assert.deepEqual(state.chats.find(lane => lane.name === 'Worker 3').queue.map(one => [one.id, one.isPinned]), [['B5', true]])
  assert.match(html, /<section class="ready-list" id="ready-list" aria-label="Ready for a worker" hidden><\/section>/)
  assert.match(fn('drawReadyList'), /`Ready for a worker \(\$\{list\.ready\.length\}\)`/)
})

test('the worker\'s job says the board gives it its tasks, not the main chat', async () => {
  const worker = (await readFile(join(HERE, '..', 'roles', 'worker.md'), 'utf8')).replace(/\s+/g, ' ')
  assert.match(worker, /you take whatever task the board gives you/)
  assert.doesNotMatch(worker, /whatever task the main chat gives you/)
})
