// B182: a worker's task in the Workers panel starts with the backlog step it is on ("B173 Build the new Advisor's job
// and clock", the person, 2026-10-14). The page's own code is run here, cut out of board.js between its marks.
// Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\nObject.assign(this, { laneTaskOf })`, page)

const lane = (task, givenTask = null) => ({ name: 'Zebracorns', state: 'working', task, givenTask })

test('the number is the step the chat was handed, else the step its card is on', () => {
  assert.deepEqual({ ...page.laneTaskOf(lane({ text: 'Teach the zebracorn to sing', stepId: 'B44' })) }, { code: 'B44', text: 'Teach the zebracorn to sing' })
  // the hand-over names its step: that wins over the step the card's branch points at
  const given = { step: { id: 'B173', title: 'the zebracorn' } }
  assert.equal(page.laneTaskOf(lane({ text: 'Teach the zebracorn to sing', stepId: 'B44' }, given)).code, 'B173')
})

test('a topic that already starts with its number does not say it twice', () => {
  for (const text of ['B173 Teach the zebracorn to sing', 'B173: Teach the zebracorn to sing', 'B173, Teach the zebracorn to sing']) {
    assert.equal(page.laneTaskOf(lane({ text, stepId: 'B173' })).text, 'Teach the zebracorn to sing', text)
  }
  // another number, or one inside the words, stays where it is
  assert.equal(page.laneTaskOf(lane({ text: 'B12 and B13: the quokkaberry maps', stepId: 'B173' })).text, 'B12 and B13: the quokkaberry maps')
  assert.equal(page.laneTaskOf(lane({ text: 'B1730 is another step', stepId: 'B173' })).text, 'B1730 is another step')
})

test('a task without a step shows as before, and a chat without a topic has no words', () => {
  assert.deepEqual({ ...page.laneTaskOf(lane({ text: 'Tidy the narwhal bridge', stepId: null })) }, { code: null, text: 'Tidy the narwhal bridge' })
  assert.equal(page.laneTaskOf(lane({ text: '', stepId: 'B44' })).text, null)
  assert.equal(page.laneTaskOf(lane(null)).text, null)
})

test('the Workers panel draws the number in front of the topic, in its own quieter colour, and its window uses the same words', () => {
  const title = script.slice(script.indexOf('function taskTitle('), script.indexOf('// stepline:start'))
  assert.match(title, /laneTaskOf\(lane\)/)
  assert.match(title, /el\('span', 'task-code', code\)/)
  // B307: the row's task line, with what it does now in its tooltip.
  assert.match(script, /const title = taskTitle\(lane\)/)
  assert.match(script, /what\.append\(title\)/)
  assert.match(cut('lanewindow'), /code: laneTaskOf\(lane\)\.code/)
  assert.match(style, /\.task \.task-code \{[^}]*color:/)
})
