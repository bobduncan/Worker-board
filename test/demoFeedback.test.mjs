// B860: the person's feedback inside a goal demo's popup: Approve or Send back with a comment per part, one Send, and a next round
// that shows only what was sent back. The rounds (src/demoFeedback.mjs), the files beside the demo (src/pictures.mjs) and the
// popup (public/board.js, drawn over a made-up document). Made-up names only.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { demoPage } from '../src/demo.mjs'
import { checkSend, roundPage, roundsOf, rowsOf, stampOf, withRound, wordsOfRound } from '../src/demoFeedback.mjs'
import { findDemo, readDemo, writeFeedback } from '../src/pictures.mjs'
import { recapFeedbackWords } from '../src/say.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')

const list = () => ({
  goal: 'G6', title: 'The polish', step: 'B7',
  sections: [
    { kind: 'reached', rows: [{ title: '1. Lava', pictures: [{ kind: 'target', caption: 'target', path: 'a.png' }] }, { title: '2. Cliffs', pictures: [{ kind: 'target', caption: 'target', path: 'b.png' }] }] },
    { kind: 'not-reached', intro: ['What went wrong:'], rows: [{ title: '3. Round shapes', note: '64 of 75', pictures: [{ kind: 'final-not', caption: 'last try', path: 'c.png' }] }] },
    { kind: 'open', items: ['Bridges are not made yet.'], rows: [{ title: '4. Ground', pictures: [{ kind: 'target', caption: 'target', path: 'd.png' }] }] },
  ],
  followUp: { backlog: ['Round shapes: B9.'] },
})
const page = () => demoPage(list(), 'art/g6')
const titles = shown => rowsOf(shown).map(row => row.title)

test('round 1 is the whole demo; every part has a key (its title, a repeat gets a number)', () => {
  const shown = roundPage(page(), null)
  assert.deepEqual(titles(shown), ['1. Lava', '2. Cliffs', '3. Round shapes', '4. Ground'])
  assert.deepEqual(rowsOf(shown).map(row => row.key), ['1. Lava', '2. Cliffs', '3. Round shapes', '4. Ground'])
  assert.deepEqual([shown.feedback.round, shown.feedback.done, shown.feedback.parts, shown.feedback.folded], [1, false, 4, []])
  assert.ok(shown.followUp !== null)
  const twin = list()
  twin.sections[1].rows[0].title = '1. Lava'
  assert.deepEqual(rowsOf(demoPage(twin)).map(row => row.key), ['1. Lava', '2. Cliffs', '1. Lava (2)', '4. Ground'])
  assert.equal(page().step, 'B7')
  assert.equal(demoPage({ ...list(), step: undefined }).step, null)
})

test('round 2 shows only the parts sent back (with the person\'s comment) and the ones not decided; approved parts fold into one line', () => {
  const feedback = withRound(null, 1, [
    { key: '1. Lava', verdict: 'approved', comment: '' }, { key: '2. Cliffs', verdict: 'approved', comment: 'good' },
    { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' },
  ], '2026-10-31 12:40')
  const shown = roundPage(page(), feedback)
  assert.deepEqual(titles(shown), ['3. Round shapes', '4. Ground'])
  assert.deepEqual(shown.sections.map(section => section.kind), ['not-reached', 'open'])
  assert.deepEqual(shown.sections[0].rows[0].said, { comment: 'still stepped', round: 1 })
  assert.equal(shown.sections[1].rows[0].said, undefined)
  assert.deepEqual(shown.feedback.folded.map(one => one.title), ['1. Lava', '2. Cliffs'])
  assert.deepEqual([shown.feedback.round, shown.feedback.done, shown.followUp], [2, false, null])
})

test('a later round wins: a part approved in round 2 leaves round 3; when every part is approved the demo says it is done', () => {
  let feedback = withRound(null, 1, [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'rounder' }], 'x')
  feedback = withRound(feedback, 2, [{ key: '3. Round shapes', verdict: 'approved', comment: '' }, { key: '2. Cliffs', verdict: 'sent-back', comment: 'sharper' }], 'y')
  assert.deepEqual(titles(roundPage(page(), feedback)), ['2. Cliffs', '4. Ground'])
  feedback = withRound(feedback, 3, [{ key: '2. Cliffs', verdict: 'approved', comment: '' }, { key: '4. Ground', verdict: 'approved', comment: '' }], 'z')
  const done = roundPage(page(), feedback)
  assert.deepEqual([titles(done), done.sections, done.feedback.done, done.feedback.round], [[], [], true, 3])
})

test('the Send is checked against the round the demo shows: unknown part, no comment on a sent-back part, twice, nothing, a stale round', () => {
  const shown = roundPage(page(), null)
  const send = parts => checkSend(shown, { round: 1, parts })
  assert.deepEqual(send([{ key: '1. Lava', verdict: 'approved', comment: '  fine  ' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still   stepped' }]),
    { ok: true, round: 1, parts: [{ key: '1. Lava', verdict: 'approved', comment: 'fine' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }] })
  assert.match(send([{ key: '9. Nothing', verdict: 'approved' }]).why, /no part "9\. Nothing"/)
  assert.match(send([{ key: '3. Round shapes', verdict: 'sent-back', comment: ' ' }]).why, /without a comment/)
  assert.match(send([{ key: '1. Lava', verdict: 'approved' }, { key: '1. Lava', verdict: 'approved' }]).why, /twice/)
  assert.match(send([{ key: '1. Lava', verdict: 'maybe' }]).why, /approved or sent-back/)
  assert.equal(send([]).status, 400)
  assert.equal(checkSend(shown, { round: 2, parts: [{ key: '1. Lava', verdict: 'approved' }] }).status, 409)
  // Round 2 knows only the parts it shows: an approved part of round 1 is no part of round 2.
  const after = roundPage(page(), withRound(null, 1, [{ key: '1. Lava', verdict: 'approved', comment: '' }], 'x'))
  assert.match(checkSend(after, { round: 2, parts: [{ key: '1. Lava', verdict: 'approved' }] }).why, /no part "1\. Lava"/)
  const finished = roundPage(page(), withRound(null, 1, rowsOf(shown).map(row => ({ key: row.key, verdict: 'approved', comment: '' })), 'x'))
  assert.equal(checkSend(finished, { round: 1, parts: [{ key: '1. Lava', verdict: 'approved' }] }).status, 409)
})

test('the words of a round name each part: approved ones, sent back ones with their comments, and what is not decided', () => {
  const parts = [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }]
  const said = wordsOfRound(page(), 1, parts)
  assert.deepEqual(said.lines, ['Recap feedback, round 1: 1 approved, 1 sent back, 2 not decided yet.', 'Approved: 1. Lava.', 'Sent back: 3. Round shapes: "still stepped"'])
  assert.deepEqual(said.back, [{ title: '3. Round shapes', comment: 'still stepped', steps: [] }])
  const word = recapFeedbackWords('Advisor', { goal: 'G6', title: 'The polish', step: 'B7', round: 1, approved: said.approved, back: said.back, done: false, left: 2, path: 'art/g6/demo.json', job: 'roles/partner.md' })
  assert.equal(word.command, 'recap-feedback')
  assert.equal(word.text, ['recap feedback: G6 The polish, round 1: 1 part sent back', 'Step: B7', 'Demo: art/g6/demo.json', 'Sent back:', '- 3. Round shapes: "still stepped"', 'Approved: 1. Lava', 'Not decided yet: 2', 'Your job: roles/partner.md, "Recap feedback"'].join('\n'))
  assert.match(stampOf(new Date(2026, 9, 31, 12, 40).getTime()), /^2026-10-31 12:40$/)
  assert.deepEqual(roundsOf({ rounds: [{ at: 'x', parts: [{ key: 'k', verdict: 'approved' }, { key: 'j', verdict: 'nope' }, 7] }, 'junk'] }), [{ n: 1, at: 'x', parts: [{ key: 'k', verdict: 'approved', comment: '' }] }])
  assert.deepEqual(roundsOf('nothing'), [])
})

async function withProject(run) {
  const project = await mkdtemp(join(tmpdir(), 'board-recap-'))
  try {
    await mkdir(join(project, 'art', 'g6'), { recursive: true })
    await writeFile(join(project, 'art', 'g6', 'demo.json'), JSON.stringify(list()))
    await run(project)
  } finally {
    await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

test('feedback.json stands beside the demo: the board reads it back as the next round, and a file that is not JSON is no feedback', async () => {
  await withProject(async project => {
    const roots = ['art']
    const first = await readDemo(project, roots, 'art/g6/demo.json')
    assert.equal(first.feedback, null)
    assert.equal((await findDemo(project, roots, 'art/g6/demo.json')).page.feedback.round, 1)
    await writeFeedback(first.file, withRound(first.feedback, 1, [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'rounder' }], 'x'))
    const kept = JSON.parse(await readFile(join(project, 'art', 'g6', 'feedback.json'), 'utf8'))
    assert.deepEqual(kept.rounds[0], { n: 1, at: 'x', parts: [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'rounder' }] })
    const next = (await findDemo(project, roots, 'art/g6/demo.json')).page
    assert.deepEqual([next.feedback.round, titles(next)], [2, ['2. Cliffs', '3. Round shapes', '4. Ground']])
    await writeFile(join(project, 'art', 'g6', 'feedback.json'), '{ broken')
    assert.equal((await findDemo(project, roots, 'art/g6/demo.json')).page.feedback.round, 1)
  })
})

// ---- the popup: the draw is run over a made-up document (every node is { tag, className, text, children, dataset }) ----
const node = (tag, className = '', text = null) => ({ tag, className, text, children: [], dataset: {}, append(...more) { this.children.push(...more) } })
const drawn = {}
vm.runInNewContext(`${script.slice(script.indexOf('// demo:start'), script.indexOf('// demo:end'))}
Object.assign(this, { demoBody, demoSide })`, Object.assign(drawn, { el: node, picture: (path, caption) => Object.assign(node('button', 'picture'), { path, caption }) }))
const flat = (one, found = []) => { found.push(one); for (const child of one.children) flat(child, found); return found }
const withClass = (one, className) => flat(one).filter(each => each.className.split(' ').includes(className))
const wordsOf = one => flat(one).map(each => each.text).filter(text => text !== null).join(' ')
const draft = (parts = [], extra = {}) => ({ parts: new Map(parts), problem: '', notice: '', sending: false, ...extra })
const canSend = shown => ({ ...shown, feedback: { ...shown.feedback, canSend: true, whyNot: null } })

test('the popup gives each part Approve, Send back and a comment; the side panel lists the answers and one Send; nothing without feedback', () => {
  const shown = canSend(roundPage(page(), null))
  const body = drawn.demoBody(shown, draft([['3. Round shapes', { verdict: 'sent-back', comment: 'rounder' }]]))
  assert.equal(withClass(body, 'demo-feedback').length, 4)
  assert.deepEqual(withClass(body, 'demo-approve').map(wordsOf), ['Approve', 'Approve', 'Approve', 'Approve'])
  const rows = withClass(body, 'demo-row')
  assert.deepEqual(rows.map(row => row.dataset.demoRow), ['1. Lava', '2. Cliffs', '3. Round shapes', '4. Ground'])
  assert.deepEqual(withClass(rows[2], 'demo-send-back').map(one => one.className), ['demo-send-back is-on'])
  assert.deepEqual(withClass(rows[0], 'demo-send-back').map(one => one.className), ['demo-send-back'])
  assert.equal(withClass(rows[2], 'demo-comment')[0].value, 'rounder')
  const side = drawn.demoSide(shown, draft([['1. Lava', { verdict: 'approved', comment: '' }], ['3. Round shapes', { verdict: 'sent-back', comment: 'rounder' }]]))
  assert.deepEqual(withClass(side, 'demo-answer').map(one => one.className), ['demo-answer is-approved', 'demo-answer is-open', 'demo-answer is-sent-back', 'demo-answer is-open'])
  assert.deepEqual(withClass(side, 'demo-answer-words').map(wordsOf), ['approved', 'not decided yet', 'sent back: "rounder"', 'not decided yet'])
  assert.deepEqual(withClass(side, 'demo-send').map(wordsOf), ['Send feedback'])
  // A demo the board takes no feedback on (no feedback in the page, or a board that only shows) draws no buttons.
  assert.equal(withClass(drawn.demoBody(page()), 'demo-feedback').length, 0)
  const only = drawn.demoSide({ ...shown, feedback: { ...shown.feedback, canSend: false, whyNot: 'This board only shows.' } }, draft())
  assert.deepEqual([withClass(only, 'demo-send').length, wordsOf(withClass(only, 'demo-muted')[0])], [0, 'This board only shows.'])
})

test('round 2 of the popup: the round line, the folded approved parts, the person\'s words beside the part, no follow-up', () => {
  const feedback = withRound(null, 1, [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '2. Cliffs', verdict: 'approved', comment: '' }, { key: '3. Round shapes', verdict: 'sent-back', comment: 'still stepped' }], 'x')
  const shown = canSend(roundPage(page(), feedback))
  const body = drawn.demoBody(shown, draft())
  assert.equal(wordsOf(withClass(body, 'demo-round')[0]), 'Round 2: only what you sent back or did not decide yet.')
  assert.equal(wordsOf(withClass(body, 'demo-folded')[0]), 'Approved, folded away: 1. Lava · 2. Cliffs')
  assert.deepEqual(withClass(body, 'demo-row').map(row => row.dataset.demoRow), ['3. Round shapes', '4. Ground'])
  assert.equal(wordsOf(withClass(body, 'demo-said')[0]), 'You said (round 1): "still stepped"')
  assert.equal(withClass(body, 'demo-section').filter(one => one.className.includes('is-follow-up')).length, 0)
  const all = roundPage(page(), withRound(feedback, 2, [{ key: '3. Round shapes', verdict: 'approved', comment: '' }, { key: '4. Ground', verdict: 'approved', comment: '' }], 'y'))
  const done = drawn.demoSide(canSend(all), draft())
  assert.equal(wordsOf(withClass(done, 'demo-done')[0]), 'Every part is approved: the recap is done.')
  assert.equal(withClass(done, 'demo-send').length, 0)
})
