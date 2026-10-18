// B83: the person stops a worker's task, moves a queued step to another worker, or takes it out of its queue, from
// the board. A stop is typed into the main chat, which has the worker stop at a safe point (the person, 2026-10-14:
// "1. A"). B301, the review: a move and a take-out change the work store at once through the work API (requeue,
// unqueue); no words go to the main chat for them. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkSay } from '../src/say.mjs'

const lanes = [
  { name: 'Lead', isMain: true, isLeftover: false, state: 'working', task: null, queue: [] },
  { name: 'Worker 1', isMain: false, isLeftover: false, state: 'working', task: { stepId: 'B201', text: 'The zebracorn sings' }, queue: [{ id: 'B202', title: 'The quokkaberry "maps"' }, { id: null, title: 'No id' }] },
  { name: 'Worker 2', isMain: false, isLeftover: false, state: 'free', task: null, queue: [] },
]
const board = (changeAsks = { stop: {}, steps: {} }) => ({ restart: { main: 'Lead' }, chats: lanes, changeAsks })
const say = (body, state = board()) => checkSay({ to: 'Lead', ...body }, state, 2000)

test('stop: only a worker on a task, only after the person confirmed once, and the main chat stops it at a safe point', () => {
  const ok = say({ command: 'stop', chat: 'Worker 1', sure: true })
  assert.equal(ok.ok, true)
  assert.deepEqual([ok.message.command, ok.message.about, ok.message.text], ['stop', 'Worker 1', 'stop task\nName: Worker 1\nTask: B201 "The zebracorn sings"\nWhy: stopped with the button'])
  assert.equal(say({ command: 'stop', chat: 'Worker 1' }).status, 409, 'not confirmed')
  assert.equal(say({ command: 'stop', chat: 'Worker 2', sure: true }).status, 409, 'nothing to stop')
  assert.equal(say({ command: 'stop', chat: 'Lead', sure: true }).status, 409, 'the main chat')
  assert.equal(say({ command: 'stop', chat: 'Worker 1', sure: true }, board({ stop: { 'Worker 1': { isOpen: true } }, steps: {} })).status, 409, 'asked already')
})

test('B301: move and unqueue are no words to the main chat any more', () => {
  for (const command of ['move', 'unqueue']) assert.deepEqual(say({ command, step: 'B202', target: 'Worker 2' }), { ok: false, status: 400, why: 'No such command.' })
})

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const protocol = await readFile(join(ROOT, 'roles', 'protocol.md'), 'utf8')
const main = await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')

test('the page: "Stop its task" asks once in the worker\'s menu; a queued step\'s window moves it or takes it out', () => {
  assert.match(script, /const stop = stopPart\(lane, state\)\n\s+if \(stop !== null\) tools\.push\(stop\)/)
  assert.match(script, /'Stop its task\? It finishes what runs, saves and shares its work, and starts nothing new\.'/)
  assert.match(script, /send\(\{ to: main, command: 'stop', chat: stopSure, sure: true \}, `stop:\$\{stopSure\}`\)/)
  assert.match(script, /const change = need === null && subject\.step === undefined && lane !== null && lane !== undefined \? queueChangePart\(lane, step, state\) : null/)
  assert.match(script, /sendWork\(\{ action: 'unqueue', id \}, `change:\$\{id\}`\)/)
  assert.match(script, /sendWork\(\{ action: 'requeue', id, for: target \}, `change:\$\{id\}`\)/)
})

test('the main chat\'s role and the protocol know the stop word and the work actions that move or take out a step', () => {
  for (const word of ['`stop task`', 'work requeue B<id>', 'work unqueue B<id>']) {
    assert.ok(protocol.includes(word), `protocol: ${word}`)
    assert.ok(main.replace(/\s+/g, ' ').includes(word.replace(/\s+/g, ' ')), `main: ${word}`)
  }
  for (const gone of ['`move step`', '`unqueue step`']) assert.ok(!protocol.includes(gone) && !main.includes(gone), gone)
})
