// B269: the window where a chat needs the person's answer is calm and spacious: the step in one line on top, one
// question at a time as its title, its answers as large cards with the advised one marked, everything else folded
// behind one line, a note, and one Send. Since B299 what waits for the person is the work store's asks: the window
// shows those. Made-up samples only; no word names a project.

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
vm.runInNewContext(`${cut('calm')}\nObject.assign(this, { isCalm, calmGroup, splitAsk, cardsOf, calmAnswer, calmPlan, isGoneAlready, noteLabel, sendLabel, standingOf, pictureWords })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

/** A made-up ask of the work store as the board's state gives it. */
const ask = (id, more = {}) => ({
  id: `work:${id}`, workId: id, from: 'Digger', kind: 'input', asks: 'decide', title: 'Box or yew?', question: 'Box or yew?', text: '',
  at: 1000, options: [], advice: null, pictures: [], play: null, of: 'B1', ofTitle: 'Plant the hedge', blocking: true,
  blocks: [{ step: 'B1', owner: 'Digger' }], isForm: false, isRefine: false, canAnswer: true, answer: null, ...more,
})

test('an ask of the work store the board can answer gets the calm window; others keep the window they have', () => {
  assert.equal(page.isCalm(ask('Q1')), true)
  assert.equal(page.isCalm(ask('Q1', { answer: { at: 1, verdict: null, text: 'Yew', state: 'delivered' } })), false, 'answered: it shows what was sent')
  assert.equal(page.isCalm(ask('Q1', { isForm: true, canAnswer: false })), false, 'the app\'s question form: answered in its chat')
  assert.equal(page.isCalm(ask('Q1', { isRefine: true })), false, 'a refine question is answered in its step\'s refine part')
  assert.equal(page.isCalm({ id: 'chat:Digger:1', kind: 'input', canAnswer: false }), false, 'not an ask of the store')
  assert.equal(page.isCalm(null), false)
})

test('one question at a time: the open asks of the same chat on the same step, oldest first', () => {
  const needs = [
    ask('Q3', { at: 3000 }), ask('Q1', { at: 1000 }), ask('Q2', { at: 2000, from: 'Pruner' }),
    ask('Q4', { at: 500, of: 'B2' }), ask('Q5', { at: 900, answer: { at: 1, text: 'x', state: 'delivered' } }), ask('Q10', { at: 1000 }),
  ]
  assert.deepEqual(page.calmGroup(needs[0], needs).map(one => one.workId), ['Q1', 'Q10', 'Q3'])
  assert.deepEqual(page.calmGroup(needs[2], needs).map(one => one.workId), ['Q2'], 'another chat: its own window')
  assert.deepEqual(page.calmGroup(needs[3], needs).map(one => one.workId), ['Q4'], 'another step: its own window')
  // An ask of no step goes with its chat's other asks of no step.
  const loose = [ask('Q7', { of: null }), ask('Q8', { of: null, at: 1100 })]
  assert.deepEqual(page.calmGroup(loose[1], loose).map(one => one.workId), ['Q7', 'Q8'])
})

test('the question is the title; the why and the advice stand under it', () => {
  assert.deepEqual(plain(page.splitAsk('Pick the berries by hand? A machine is faster but bruises them. I advise yes.')),
    { question: 'Pick the berries by hand?', rest: 'A machine is faster but bruises them. I advise yes.' })
  assert.deepEqual(plain(page.splitAsk('which path to the barn?')), { question: 'which path to the barn?', rest: '' })
  // Without a question mark: its first sentence; a long one stays whole.
  assert.deepEqual(plain(page.splitAsk('open the gate before Tuesday. The cows wait.')), { question: 'open the gate before Tuesday.', rest: 'The cows wait.' })
  assert.deepEqual(plain(page.splitAsk(`${'very '.repeat(80)}long?`)).rest, '')
  // An abbreviation ends no sentence.
  assert.deepEqual(plain(page.splitAsk('Plant a hedge, e.g. Yew. It grows slowly.')), { question: 'Plant a hedge, e.g. Yew.', rest: 'It grows slowly.' })
})

test('B452: a question mark far down the words makes no title: the first sentence does, the rest stands under it', () => {
  const numbers = 'Of 65 plants that reached the garden in two days, 39 were yew and 26 were weeds. '
  const long = `${numbers}${'That was 11 nettles, 4 thistles and 11 brambles, all pulled by hand along the path. '.repeat(3)}Does that weeding belong to the hedge?`
  assert.deepEqual(plain(page.splitAsk(long)), { question: numbers.trim(), rest: long.slice(numbers.length) })
  // The store's ask brings its title apart: the window shows it whole, its context (the need's text) under it.
  assert.deepEqual(plain(page.splitAsk('Yew or box for the hedge?')), { question: 'Yew or box for the hedge?', rest: '' })
})

test('the cards: its options with their letter and words, Yes and No for a look or a decide, Done for a do', () => {
  const options = page.cardsOf(ask('Q1', { options: [
    { label: 'A Along the river: the long way, dry in winter', picture: null, isRecommended: false },
    { label: 'B Over the hill', picture: null, isRecommended: true },
    { label: 'Neither', picture: null, isRecommended: false },
  ] }))
  assert.deepEqual(plain(options), [
    { verdict: 'A Along the river: the long way, dry in winter', key: 'A', title: 'Along the river', text: 'the long way, dry in winter', isAdvised: false },
    { verdict: 'B Over the hill', key: 'B', title: 'Over the hill', text: '', isAdvised: true },
    { verdict: 'Neither', key: null, title: 'Neither', text: '', isAdvised: false },
  ])
  const look = plain(page.cardsOf(ask('Q2', { kind: 'verify', asks: 'look', advice: 'yes' })))
  assert.deepEqual(look.map(card => [card.verdict, card.title, card.isAdvised]), [['approve', 'Yes', true], ['reject', 'No', false]])
  assert.match(look[1].text, /note/, 'No asks for words')
  const decide = plain(page.cardsOf(ask('Q3', { advice: 'No, not yet' })))
  assert.deepEqual(decide.map(card => [card.verdict, card.title, card.isAdvised]), [['yes', 'Yes', false], ['no', 'No', true]])
  assert.deepEqual(plain(page.cardsOf(ask('Q4', { kind: 'do', asks: 'do' }))).map(card => card.verdict), ['done'])
  assert.deepEqual(plain(page.cardsOf(ask('Q5', { asks: 'provide' }))), [], 'a provide takes the person\'s words alone')
  // The advice names a letter: its card is marked, whatever the form of the letter.
  const marked = plain(page.cardsOf(ask('Q6', { advice: 'B', options: [{ label: 'A: thin', picture: null, isRecommended: false }, { label: 'B. thick', picture: null, isRecommended: false }] })))
  assert.deepEqual(marked.map(card => [card.key, card.title, card.isAdvised]), [['A', 'thin', false], ['B', 'thick', true]])
  // A leading "A " is a letter only when every option has one: else it is the word "A".
  const words = plain(page.cardsOf(ask('Q7', { options: [{ label: 'A new tab', picture: null, isRecommended: false }, { label: 'Keep it', picture: null, isRecommended: false }] })))
  assert.deepEqual(words.map(card => [card.key, card.title]), [[null, 'A new tab'], [null, 'Keep it']])
})

test('the send plan: the answers given go in order; a No without words or a look without a pick holds them all back', () => {
  const look = ask('Q2', { kind: 'verify', asks: 'look' })
  const group = [ask('Q1'), look, ask('Q3', { asks: 'provide' })]
  const plan = (picks, words = {}) => plain(page.calmPlan(group, id => picks[id] ?? null, id => words[id] ?? ''))
  assert.deepEqual(plan({}), { none: 'work:Q1' }, 'nothing given: the first question says to pick')
  assert.deepEqual(plan({ 'work:Q1': 'yes' }).send.map(one => [one.id, one.answer.text]), [['work:Q1', 'Yes']], 'the rest stay open')
  assert.deepEqual(plan({ 'work:Q1': 'yes', 'work:Q2': 'reject' }), { lacks: 'work:Q2', what: 'words' })
  assert.deepEqual(plan({ 'work:Q1': 'yes' }, { 'work:Q2': 'hm' }), { lacks: 'work:Q2', what: 'pick' })
  const all = plan({ 'work:Q1': 'no', 'work:Q2': 'approve' }, { 'work:Q1': 'too tall', 'work:Q3': 'the key' })
  assert.deepEqual(all.send.map(one => [one.id, one.answer.verdict, one.answer.text]), [['work:Q1', null, 'No\ntoo tall'], ['work:Q2', 'approve', ''], ['work:Q3', null, 'the key']])
})

test('an ask answered or withdrawn meanwhile is passed over, not a failure', () => {
  assert.equal(page.isGoneAlready('Not sent: Q3 is answered already.'), true)
  assert.equal(page.isGoneAlready('Not sent: Q3 is withdrawn already.'), true)
  assert.equal(page.isGoneAlready('Not sent: the board\'s server does not answer'), false)
  assert.equal(page.isGoneAlready(undefined), false)
})

test('what is sent: the store\'s verdict and words; a No needs words; a look or a do needs a pick', () => {
  const look = ask('Q2', { kind: 'verify', asks: 'look' })
  assert.deepEqual(plain(page.calmAnswer(look, 'approve', '')), { verdict: 'approve', text: '' })
  assert.deepEqual(plain(page.calmAnswer(look, 'reject', '  ')), { lacks: 'words' })
  assert.deepEqual(plain(page.calmAnswer(look, 'reject', 'too dark')), { verdict: 'reject', text: 'too dark' })
  assert.deepEqual(plain(page.calmAnswer(look, null, 'hm')), { lacks: 'pick' })
  assert.equal(page.calmAnswer(look, null, ''), null, 'nothing given: it stays open')
  const decide = ask('Q3')
  assert.deepEqual(plain(page.calmAnswer(decide, 'yes', '')), { verdict: null, text: 'Yes' })
  assert.deepEqual(plain(page.calmAnswer(decide, 'yes', 'and soon')), { verdict: null, text: 'Yes\nand soon' })
  assert.deepEqual(plain(page.calmAnswer(decide, 'no', '')), { lacks: 'words' })
  assert.deepEqual(plain(page.calmAnswer(decide, null, 'Neither: a beech hedge')), { verdict: null, text: 'Neither: a beech hedge' }, 'words alone answer a decide')
  assert.deepEqual(plain(page.calmAnswer(ask('Q4', { options: [{ label: 'B yew', picture: null, isRecommended: true }] }), 'B yew', '')), { verdict: null, text: 'B yew' })
  assert.deepEqual(plain(page.calmAnswer(ask('Q5', { kind: 'do', asks: 'do' }), 'done', '')), { verdict: 'done', text: '' })
  assert.deepEqual(plain(page.calmAnswer(ask('Q6', { asks: 'provide' }), null, 'the key is under the mat')), { verdict: null, text: 'the key is under the mat' })
})

test('the note says when it is needed, and Send says how many answers go', () => {
  assert.equal(page.noteLabel(ask('Q1'), null), 'Add a note (optional)')
  assert.equal(page.noteLabel(ask('Q1'), 'no'), 'Add a note (needed for No)')
  assert.equal(page.noteLabel(ask('Q1', { kind: 'verify', asks: 'look' }), 'reject'), 'Add a note (needed for No)')
  assert.equal(page.noteLabel(ask('Q1', { asks: 'provide' }), null), 'Your answer')
  assert.equal(page.sendLabel(1, 1), 'Send answer')
  assert.equal(page.sendLabel(3, 3), 'Send 3 answers')
  assert.equal(page.sendLabel(3, 1), 'Send 1 of 3 answers')
  assert.equal(page.sendLabel(3, 0), 'Send answers')
})

test('where it stands, in one line: the step it is about, and whether the chat waits for the answer', () => {
  assert.deepEqual(plain(page.standingOf(ask('Q1'))), { line: 'B1 Plant the hedge', more: 'Digger waits for your answer' })
  assert.deepEqual(plain(page.standingOf(ask('Q1', { blocking: false, blocks: [] }))), { line: 'B1 Plant the hedge', more: 'Digger goes on meanwhile' })
  assert.deepEqual(plain(page.standingOf(ask('Q1', { of: null, ofTitle: null, blocking: false, blocks: [] }))), { line: '', more: 'Digger goes on meanwhile' })
})

test('a picture\'s link names it by its file, without its folder, date and ending', () => {
  assert.equal(page.pictureWords('art-inbox/orchard/2026-10-17-b12-two-baskets.png'), 'b12 two baskets')
  assert.equal(page.pictureWords('plain_name.JPG'), 'plain name')
})

test('the window: the step on top, one question at a time, cards, the rest folded, a note, one Send', () => {
  assert.match(script, /if \(isCalm\(need\)\) return drawCalm\(box, need, state\)/)
  const calm = cut('calmwindow')
  for (const words of [
    "el('button', 'calm-step'", "`Question ${at + 1} of ${group.length}`", "el('h3', 'calm-question'",
    "button.setAttribute('aria-pressed', String(pick === card.verdict))", "el('span', 'calm-advised', 'Recommended')", "el('span', 'calm-key', card.key)",
    "el('summary', '', 'View context')", 'calmContext(need, state)', 'askLinks(need)',
    'noteLabel(need, pick)', 'dataset.calmGo', "'Cancel'", 'dataset.calmSend', 'calmSendText(group)',
  ]) assert.ok(calm.includes(words), words)
  // The context: the step as the store holds it, who asked and what waits on it, the pictures large.
  const context = script.slice(script.indexOf('function calmContext('), script.indexOf('function drawCalm('))
  for (const words of ["section('The step'", "section('Asked'", "section('References', drawReferences("]) assert.ok(context.includes(words), words)
  // Sending: every answer given goes to the store; a No without words, or a look without a pick, is not sent: the
  // window shows that question and says why. Sent without a problem, the window closes.
  const send = script.slice(script.indexOf('async function sendCalm('), script.indexOf('// calmsend:end'))
  for (const words of ["sendWork({ action: 'answer', id: need.workId, ...answer }, need.id, { reread: false })", 'calmPlan(group,', "'Say in the note why No: the chat needs to know what to change.'", "'Pick an answer first.'", 'closeDetails()', 'isGoneAlready(', 'isShowing()']) assert.ok(send.includes(words), words)
  // The other windows leave nothing of the calm one behind: a worker's task, a step, and (2026-10-26) a question with the partner.
  assert.equal((script.match(/box\.classList\.remove\('is-calm'\)\n\s+delete box\.dataset\.calmAt/g) ?? []).length, 3)
})

test('the style: a narrower window with room around everything, large cards, and a phone layout', () => {
  assert.match(style, /\.details\.is-calm \{[^}]*width: min\(760px, calc\(100vw - 32px\)\)/)
  assert.match(style, /\.calm-card \{[^}]*padding: 18px 20px/)
  assert.match(style, /\.calm-card\.is-chosen \{[^}]*border-color: var\(--free\)/)
  assert.match(style, /\.calm-key \{/)
  assert.match(style, /@media \(max-width: 600px\) \{\n\s+\.details\.is-calm \{ width: 100vw;/)
})
