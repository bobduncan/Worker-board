// B287: the refine questions that wait for the person stand under Needs your attention, one line per step ("B31:
// 2 questions"), opening the step's window, where they are answered with Yes / No (B293). Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')
const page = {}
vm.runInNewContext(`${script.slice(script.indexOf('// refinelines:start'), script.indexOf('// refinelines:end'))}\nObject.assign(this, { refineLines, isRefineQuestion })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const ask = (id, of, at, more = {}) => ({ id: `work:${id}`, workId: id, isRefine: true, of, ofTitle: of === 'B31' ? 'Fence the meadow' : 'Build the barn', at, answer: null, isClosed: false, ...more })

test('the open refine questions are one line per step, the oldest step first, with how many wait', () => {
  const needs = [
    ask('Q7', 'B32', 300),
    ask('Q3', 'B31', 100),
    ask('Q4', 'B31', 200),
    // Answered, or not a refine question: not counted here.
    ask('Q5', 'B31', 150, { answer: { text: 'yes', state: 'delivered' } }),
    { id: 'work:Q9', workId: 'Q9', isRefine: false, of: 'B31', at: 50, answer: null, isClosed: false },
  ]
  assert.deepEqual(plain(page.refineLines(needs)), [
    { step: 'B31', title: 'Fence the meadow', count: 2, at: 100, ids: ['Q3', 'Q4'] },
    { step: 'B32', title: 'Build the barn', count: 1, at: 300, ids: ['Q7'] },
  ])
  // A refine question has no card of its own, answered or not: its step's line says it.
  assert.equal(page.isRefineQuestion(needs[1]), true)
  assert.equal(page.isRefineQuestion(needs[3]), true)
  assert.equal(page.isRefineQuestion(needs[4]), false)
  assert.equal(page.isRefineQuestion({ ...needs[1], of: null }), false)
  assert.deepEqual(plain(page.refineLines([])), [])
})

test('Needs your attention draws them as one line each, not a card per question, and counts a line once', () => {
  // The cards leave the refine questions out; the lines stand above them.
  assert.match(script, /const cards = ordered\(\(showsClosed\(\) \? state\.forYou : open\)\.filter\(need => !isRefineQuestion\(need\)\)\)/)
  assert.match(script, /drawRefineNeeds\(state\), \.\.\.cards/)
  assert.match(script, /const unanswered = open\.filter\(need => !isAnswered\(need\) && !isRefineQuestion\(need\)\)\.length \+ refineLines\(open\)\.length/)
  // A line opens the step's window, where the questions are answered.
  const draw = script.slice(script.indexOf('function drawRefineNeeds('), script.indexOf('// refinelines:end'))
  assert.ok(draw.includes('dataset.refineOpen'), 'opens by the step')
  assert.ok(draw.includes("question${line.count === 1 ? '' : 's'}"))
  assert.match(script, /closest\('\[data-refine-open\]'\)/)
  assert.match(script, /openDetails\(\{ step: step\.key \}\)/)
  assert.ok(style.includes('.refine-needs'))
})

test('the Advisor\'s job says its refine questions stand under Needs your attention, one line per step', async () => {
  const advisor = await readFile(join(HERE, '..', 'roles', 'advisor.md'), 'utf8')
  assert.match(advisor, /refine\s+questions stand under Needs your attention, one line per step/)
  assert.doesNotMatch(advisor, /A refine, a\s+suggestion, a recommendation and an ask on the goal map keep their own places/)
})

const advisorPage = {}
vm.runInNewContext(`${script.slice(script.indexOf('// advisorrefine:start'), script.indexOf('// advisorrefine:end'))}\nObject.assign(this, { advisorRefine })`, advisorPage)

test('the Advisor\'s refine state: the step it refines, or the answers that wait for it', () => {
  const step = (id, more = {}) => ({ id, refineAsk: null, refineState: 'none', ...more })
  const backlog = steps => [{ name: 'Meadow', steps }]
  assert.equal(advisorPage.advisorRefine(backlog([step('B30'), step('B31', { refineState: 'answers' })])), null)
  assert.deepEqual(plain(advisorPage.advisorRefine(backlog([step('B30', { refineState: 'answered' }), step('B31', { refineAsk: { isOpen: true, round: 2, state: 'delivered' } })]))), { step: 'B31', text: 'Refining B31, round 2', tone: 'working' })
  assert.deepEqual(plain(advisorPage.advisorRefine(backlog([step('B31', { refineAsk: { isOpen: true, round: 1, state: 'waiting' } })]))), { step: 'B31', text: 'B31 to refine, on its way', tone: 'working' })
  assert.deepEqual(plain(advisorPage.advisorRefine(backlog([step('B30', { refineState: 'answered' })]))), { step: 'B30', text: 'Your answers on B30 wait for it', tone: 'waiting' })
  assert.equal(advisorPage.advisorRefine(undefined), null)
  // Shown beside the Advisor's state on its tab.
  assert.match(script, /const refine = advisorRefine\(state\.backlog\)/)
  // A change of it draws the tab anew.
  assert.match(script, /once\('talk', \[state\.advisor, advisorRefine\(state\.backlog\), /)
  assert.ok(style.includes('.advisor-refine'))
})
