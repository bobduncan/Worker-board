// B269: the window where a chat needs the person's answer is calm and spacious: the step in one line on top, one
// question at a time as its title, its choices as large cards with the advised one marked, everything else folded
// behind one line, an optional note, and one Send. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseHandover } from '../src/handover.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('calm')}\nObject.assign(this, { isCalm, splitAsk, advisedOf, cardsOf, wordsMissing, standingOf })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const ANSWER = [
  'The orchard is planted; the quokkaberries ripen in a week.',
  '',
  '> **For you**',
  '> 1. **Answer:** Pick the berries by hand? A machine is faster but bruises them. I advise yes.',
  '>    [See the picture: both baskets side by side](http://127.0.0.1:4310/#picture=art-inbox/orchard/baskets.png)',
  '> 2. **Answer:** which path to the barn?',
  '>    - **A:** Along the river: the long way, dry in winter.',
  '>    - **B:** Over the hill (advised)',
  '> 3. **Do:** open the gate before Tuesday.',
  '',
  '---',
  '',
  '```diff',
  '  Prompt: plant the orchard',
  '  Who:    Studio · Lead',
  '+ Done:   yes, planted on the south field',
  '```',
].join('\n')
const items = parseHandover(ANSWER).items

test('a chat that asks in the agreed form gets the calm window while its answer can be given here', () => {
  const handover = parseHandover(ANSWER)
  assert.equal(page.isCalm({ where: 'here', handover }), true)
  assert.equal(page.isCalm({ where: 'answered', handover }), false, 'an answered one shows what was sent, as before')
  assert.equal(page.isCalm({ where: 'chat', handover }), false)
  assert.equal(page.isCalm({ where: 'here', handover: parseHandover('Only words.\n\n```diff\n  Prompt: x\n+ Done:   yes\n```') }), false, 'no question: as before')
  assert.equal(page.isCalm({ where: 'here', handover: null }), false)
  assert.equal(page.isCalm(null), false)
})

test('the question is the title; the advice and the why stand under it', () => {
  assert.deepEqual(plain(page.splitAsk(items[0].ask)), { question: 'Pick the berries by hand?', rest: 'A machine is faster but bruises them. I advise yes.' })
  assert.deepEqual(plain(page.splitAsk('which path to the barn?')), { question: 'which path to the barn?', rest: '' })
  // Without a question mark: its first sentence; a long one stays whole.
  assert.deepEqual(plain(page.splitAsk('open the gate before Tuesday. The cows wait.')), { question: 'open the gate before Tuesday.', rest: 'The cows wait.' })
  assert.deepEqual(plain(page.splitAsk(`${'very '.repeat(80)}long?`)).rest, '')
})

test('the advised answer is the one the chat names ("I advise yes", "I advise B") or marks "(advised)"', () => {
  assert.equal(page.advisedOf(items[0]), 'yes')
  assert.equal(page.advisedOf(items[1]), 'B')
  assert.equal(page.advisedOf(items[2]), null)
  assert.equal(page.advisedOf({ ask: 'Snow first? I advise no.', note: '', options: [] }), 'no')
  assert.equal(page.advisedOf({ ask: 'A or B?', note: 'I advise A, since it is quick.', options: [] }), 'A')
  assert.equal(page.advisedOf({ ask: 'Go on? I advise a short break first.', note: '', options: [] }), null, 'a word is not a choice')
})

test('the cards: the choices it lists with their words, else Yes and No, else Done', () => {
  const [yesNo, choices, todo] = items.map(item => plain(page.cardsOf(item)))
  assert.deepEqual(yesNo.map(card => [card.verdict, card.title, card.isAdvised]), [['yes', 'Yes', true], ['no', 'No', false]])
  assert.match(yesNo[1].text, /note/, 'No asks for words')
  assert.deepEqual(choices, [
    { verdict: 'A', key: 'A', title: 'Along the river', text: 'the long way, dry in winter.', isAdvised: false },
    { verdict: 'B', key: 'B', title: 'Over the hill', text: '', isAdvised: true },
  ])
  assert.deepEqual(todo.map(card => card.verdict), ['done'])
  // Choices its words only name ("A, B or C?") are cards with their letter alone.
  const named = parseHandover('> **For you**\n> 1. **Answer:** A, B or C? I advise C.').items[0]
  assert.deepEqual(plain(page.cardsOf(named)).map(card => [card.title, card.isAdvised]), [['A', false], ['B', false], ['C', true]])
})

test('No needs the person\'s words: the first question that lacks them is found before anything is sent', () => {
  assert.equal(page.wordsMissing(items, new Map([[1, { verdict: 'yes', words: '' }]])), -1)
  assert.equal(page.wordsMissing(items, new Map([[1, { verdict: 'no', words: '  ' }]])), 0)
  assert.equal(page.wordsMissing(items, new Map([[1, { verdict: 'no', words: 'too slow' }], [2, { verdict: 'A', words: '' }]])), -1)
})

test('where it stands, in a few words: what was asked and how far it is', () => {
  const main = page.standingOf({ isMain: true, handover: parseHandover(ANSWER), given: null, task: [] }, null)
  assert.deepEqual(plain(main), { line: 'Plant the orchard', more: 'Planted on the south field', tone: 'good' })
  const partly = page.standingOf({ isMain: true, handover: parseHandover('```diff\n  Prompt: the songs\n- Done:   partly, at part 2 of 3\n```'), given: null, task: [] }, null)
  assert.deepEqual(plain(partly), { line: 'The songs', more: 'Partly, at part 2 of 3', tone: 'bad' })
  const done = page.standingOf({ isMain: true, handover: parseHandover('```diff\n  Prompt: the songs\n+ Done:   yes\n```'), given: null, task: [] }, null)
  assert.equal(done.more, 'Done')
})

test('the window: the step on top, one question at a time, cards, the rest folded, a note, one Send', () => {
  assert.match(script, /if \(isCalm\(waiting\)\) return drawCalm\(box, need, waiting, view, now\)/)
  const calm = script.slice(script.indexOf('// calmwindow:start'), script.indexOf('// calmwindow:end'))
  for (const words of [
    "el('button', 'calm-step'", "`Question ${at + 1} of ${items.length}`", "el('h3', 'calm-question'",
    "pick.setAttribute('role', 'radio')", "el('span', 'calm-advised', 'Recommended')",
    "el('summary', '', 'View context and the whole answer')", 'calmContext(waiting)', 'linkButtons(item)',
    "'Add a note (optional)'", "'Add a note (needed for No)'", "dataset.calmGo", "'Cancel'", "node.dataset.send = ''",
  ]) assert.ok(calm.includes(words), words)
  // The chat's whole answer is folded, with its closing block; nothing of it is lost.
  const context = script.slice(script.indexOf('function calmContext('), script.indexOf('function drawCalm('))
  for (const words of ['drawTalkText(', '...closingParts(', "'Its task as it was given'", "'What I did'", 'Its whole answer'])assert.ok(context.includes(words), words)
  // A No without words is not sent: the window shows that question and says why.
  assert.match(script, /const lacking = verdict === null \? calmLacking\(id\) : -1/)
  // Sent: the window closes; the card on the right says where the answer is.
  assert.match(script, /if \(isCalmSend && !problems\.has\(id\) && detailsOf\?\.need === id\) closeDetails\(\)/)
})

test('the style: a narrower window with room around everything, large cards, and a phone layout', () => {
  assert.match(style, /\.details\.is-calm \{[^}]*width: min\(760px, calc\(100vw - 32px\)\)/)
  assert.match(style, /\.calm-card \{[^}]*padding: 18px 20px/)
  assert.match(style, /\.calm-card\.is-chosen \{[^}]*border-color: var\(--free\)/)
  assert.match(style, /@media \(max-width: 600px\) \{\n\s+\.details\.is-calm \{ width: 100vw;/)
})
