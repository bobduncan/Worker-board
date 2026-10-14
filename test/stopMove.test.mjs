// B83: the person stops a worker's task, moves a queued step to another worker, or takes it out of its queue, from
// the board. The board only asks: it types the order into the main chat, which has the worker stop at a safe point,
// writes the backlog and tells the workers (the person, 2026-10-14: "1. A", "2. A"). Made-up samples only.

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

test('move: a step some worker\'s queue holds, to another worker on the board; unqueue: the same step out of its queue', () => {
  const moved = say({ command: 'move', step: 'B202', target: 'Worker 2' })
  assert.deepEqual([moved.message.command, moved.message.about, moved.message.text], ['move', 'B202', 'move step\nStep: B202 The quokkaberry maps\nFrom: Worker 1\nTo: Worker 2'])
  const out = say({ command: 'unqueue', step: 'B202' })
  assert.deepEqual([out.message.command, out.message.text], ['unqueue', 'unqueue step\nStep: B202 The quokkaberry maps\nFrom: Worker 1'])
  for (const [body, why] of [
    [{ command: 'move', step: 'B202', target: 'Worker 1' }, 'to itself'],
    [{ command: 'move', step: 'B202', target: 'Lead' }, 'to the main chat'],
    [{ command: 'move', step: 'B999', target: 'Worker 2' }, 'in no queue'],
    [{ command: 'unqueue', step: null }, 'no id'],
  ]) assert.equal(say(body).status, 409, why)
  assert.equal(say({ command: 'unqueue', step: 'B202' }, board({ stop: {}, steps: { B202: { isOpen: true } } })).status, 409, 'asked already')
  assert.equal(say({ command: 'unqueue', step: 'B202', text: 'more words' }).status, 400, 'a command carries nothing else')
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
  assert.match(script, /send\(\{ to: main, command: 'unqueue', step: id \}, `change:\$\{id\}`\)/)
  assert.match(script, /send\(\{ to: main, command: 'move', step: id, target \}, `change:\$\{id\}`\)/)
})

test('the main chat\'s role and the protocol know the three new words', () => {
  for (const word of ['`stop task`', '`move step`', '`unqueue step`']) {
    assert.ok(protocol.includes(word), `protocol: ${word}`)
    assert.ok(main.includes(word), `main: ${word}`)
  }
})
