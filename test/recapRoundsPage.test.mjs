// T17.1, the page's side (the person, 2026-11-02, after sending round 1 of G60's recap: "the new recap, after round 1 is not finetuned to
// my feedback. the same pictures are provided and i see no evidence of what i asked it to fix/change. i need this before i can evaluate
// and preferably also have a link to open the game so i can see it myself"): the popup while round 2 is being made (the words they sent
// back, "being reworked", no old pictures, nothing to send), the round-2 row in its order (your words, what changed, the new pictures,
// Play it, Approve / Send back), and the quiet cards in Needs your attention and on the Focus page that never say "verdict waits".
// Made-up garden names only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { demoPage } from '../src/demo.mjs'
import { roundPage, withRound } from '../src/demoFeedback.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const script = readFileSync(new URL('../public/board.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/board.css', import.meta.url), 'utf8')
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const PATH = 'pictures/g6/recap/demo.json'
const SENT = new Date(2026, 10, 2, 16, 17)
const SENT_MS = SENT.getTime()
const AT = '2026-11-02 16:17'
/** T17.2: a checker's word on a row's close-up, written after the Send (16:17): "this shows what you asked". */
const OK = { verdict: 'yes', by: 'Checker', at: '2026-11-02 16:30', why: 'the tall props fade behind the wizard' }

const row = (title, more = {}) => ({ title, note: `${title} note`, pictures: [{ kind: 'final', caption: 'in the game', path: `${title.split('. ')[1].slice(0, 1)}.png` }], ...more })
const list = (more = {}) => ({
  goal: 'G6', title: 'The polish', step: 'B7',
  sections: [
    { kind: 'reached', rows: [row('1. Lava'), row('2. Cliffs')] },
    { kind: 'not-reached', rows: [row('3. Props', more.props), row('4. Ring', more.ring), row('5. Bridges')] },
  ],
})
/** Round 1 at 16:17: Lava approved, Props and Ring sent back, Cliffs and Bridges not decided. */
const round1 = () => withRound(null, 1, [
  { key: '1. Lava', verdict: 'approved', comment: '' },
  { key: '3. Props', verdict: 'sent-back', comment: 'keep the limit for tall props' },
  { key: '4. Ring', verdict: 'sent-back', comment: 'not round enough' },
], AT)
/** What the board answers to GET /api/demo: the page of the round, with what the server adds (whether the person may send). */
const shown = (more, changedAt) => {
  const page = roundPage(demoPage(list(more), 'pictures/g6/recap'), round1(), { changedAt })
  return { ...page, feedback: { ...page.feedback, canSend: page.feedback.making === null && page.feedback.answerable > 0 && !page.feedback.done, whyNot: null } }
}
const opened = async (give, state = asSent(build([], undefined))) => {
  const page = await openPage({ state, hash: `demo=${PATH}`, answers: request => (request.url.startsWith('/api/demo?') ? reply(give) : reply({})) })
  await settle(10)
  return page
}
const classesOf = node => [...node.children].map(child => child.className.split(' ')[0])

test('round 2 is being made: one line at the top, each part sent back with the person\'s words and "being reworked", no old picture, nothing to send', async () => {
  const page = await opened(shown({}, SENT_MS - 4 * 60 * MIN))
  try {
    assert.equal(words(page.find('.demo-making')), 'Round 2 is being made: your partner is building the next tries')
    assert.equal(page.all('.demo-round').length, 1, 'that line instead of the usual round line')
    assert.deepEqual(page.all('.demo-row').map(one => one.dataset.demoRow), ['3. Props', '4. Ring'])
    const [props] = page.all('.demo-row')
    assert.deepEqual(classesOf(props), ['demo-row-title', 'demo-said', 'demo-reworking'], 'the title, their words, "being reworked": no note, no picture')
    assert.match(words(props.querySelector('.demo-row-title')), /3\. Props/)
    assert.equal(words(props.querySelector('.demo-said')), 'Your words: "keep the limit for tall props"')
    assert.equal(words(props.querySelector('.demo-reworking')), 'Being reworked')
    assert.deepEqual([page.all('.demo-figure').length, page.all('.demo-picture').length, page.all('.demo-feedback').length, page.all('[data-demo-verdict]').length], [0, 0, 0, 0])
    assert.deepEqual([page.all('.demo-send').length, page.all('.demo-answers').length], [0, 0], 'no Send and no list of answers')
    assert.match(words(page.find('.demo-side')), /Nothing to send until your partner has built the next tries\./)
    assert.deepEqual(page.sent('/api/demo-feedback'), [])
  } finally { await page.close() }
})

test('round 2 once the try is in: the row reads your words, what changed, the new pictures, Play it, then Approve / Send back; a pending row stays being reworked', async () => {
  const more = { props: { changed: 'tall props -> the limit stays, see-through behind a unit', play: 'ring', shows: OK }, ring: { pending: 'B925 not started', play: 'ring' } }
  const page = await opened(shown(more, SENT_MS + 90 * MIN))
  try {
    assert.equal(page.all('.demo-making').length, 0)
    assert.equal(words(page.find('.demo-round')), 'Round 2 · 3 to judge: only what you sent back or did not decide yet.')
    assert.deepEqual(page.all('.demo-row').map(one => one.dataset.demoRow), ['2. Cliffs', '3. Props', '4. Ring', '5. Bridges'])
    const props = page.all('.demo-row')[1]
    assert.deepEqual(classesOf(props), ['demo-row-title', 'demo-row-note', 'demo-said', 'demo-changed', 'demo-checked', 'demo-pictures', 'demo-play', 'demo-feedback'])
    assert.equal(words(props.querySelector('.demo-checked')), 'Checked by Checker: the tall props fade behind the wizard', 'a row with no close-up (an answer in words) draws the checker line and its pictures as before')
    assert.equal(words(props.querySelector('.demo-said')), 'Your words: "keep the limit for tall props"')
    assert.equal(words(props.querySelector('.demo-changed')), 'What changed: tall props -> the limit stays, see-through behind a unit')
    assert.equal(props.querySelectorAll('.demo-picture').length, 1)
    const play = props.querySelector('.demo-play')
    assert.equal(words(play), 'Play it ↗')
    assert.equal(play.getAttribute('href'), '/#play=main&arena=ring', 'the way the board\'s #play= links start the game on a map, on the main branch')
    assert.equal(play.getAttribute('target'), '_blank')
    assert.deepEqual([...props.querySelectorAll('.demo-feedback button')].map(words), ['Approve', 'Send back'])
    // The pending row: their words and why, no picture, no Play link, no buttons; it is no part of the side panel's list.
    const ring = page.all('.demo-row')[2]
    assert.deepEqual(classesOf(ring), ['demo-row-title', 'demo-said', 'demo-reworking'])
    assert.equal(words(ring.querySelector('.demo-reworking')), 'Being reworked: B925 not started')
    assert.deepEqual(page.all('.demo-answer-jump').map(words), ['2. Cliffs', '3. Props', '5. Bridges'])
    // A row not sent back has no "What changed" line and no Play link without a map.
    const cliffs = page.all('.demo-row')[0]
    assert.deepEqual(classesOf(cliffs), ['demo-row-title', 'demo-row-note', 'demo-pictures', 'demo-feedback'])
    // Send goes out with the parts answered only.
    await page.click('[data-demo-verdict="approved"][data-demo-key="3. Props"]')
    await page.click('[data-demo-send]')
    await settle(10)
    assert.deepEqual(page.sent('/api/demo-feedback').map(one => one.body.parts), [[{ key: '3. Props', verdict: 'approved', comment: '' }]])
  } finally { await page.close() }
})

test('a Play link needs a map name: none, none drawn; round 1 draws it beside the pictures too', async () => {
  const first = { ...roundPage(demoPage(list({ ring: { play: 'moat-keep' } }), 'pictures/g6/recap'), null), }
  const page = await opened({ ...first, feedback: { ...first.feedback, canSend: true, whyNot: null } })
  try {
    assert.deepEqual(page.all('.demo-play').map(one => one.getAttribute('href')), ['/#play=main&arena=moat-keep'])
    assert.deepEqual(classesOf(page.all('.demo-row')[3]), ['demo-row-title', 'demo-row-note', 'demo-pictures', 'demo-play', 'demo-feedback'], 'in round 1 there are no words of theirs yet')
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The cards

const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const goals = ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm',
  '    Goal definition agreed: 2026-10-18 10:00', '    Part: Block 1 · about 1 h · steps B1', '    Part: Block 2 · about 1 h · steps B2', '    How agreed: 2026-10-18 11:00', ''].join('\n')
const step = (id, state, minutes) => parseItem(`Id: ${id}\nKind: step\nTitle: Task ${id}\nState: ${state}\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - minutes * MIN)}\n`)
const rounds = [{ n: 1, at: sinceOf(NOW - 60 * MIN), parts: [{ key: 'Block 1', verdict: 'sent-back', comment: 'still stepped' }] }]
/** The garden: Block 1 sent back an hour ago; `changedAt` is when the recap was last written. */
const garden = changedAt => asSent(build(
  [step('B1', 'review', 300), step('B2', 'review', 300), step('B5', 'done', 30), step('B6', 'queued', 20), step('B7', 'dropped', 10)], undefined, goals,
  { recaps: [{ path: PATH, goal: 'G6', changedAt, rounds, parts: ['Block 1', 'Block 2'].map((key, at) => ({ key, title: key, steps: [`B${at + 1}`], pending: false, changed: true, shows: { verdict: 'yes', by: 'Checker', at: sinceOf(NOW - 30 * MIN), why: 'it reads round' } })) }], goalRecap: { goal: 'G6', path: PATH, pictures: {}, changedAt, rounds }, config: ON },
))

test('Needs your attention while round 2 is being made: the Product owner\'s card says so in quiet colours, with "2 of 3 next tries done" and a link; no verdict, not counted', async () => {
  const page = await openPage({ state: garden(NOW - 200 * MIN), answers: request => reply(request.url.startsWith('/api/demo?') ? shown({}, SENT_MS - 4 * 60 * MIN) : {}) })
  await settle(10)
  try {
    const card = page.find('#needs .need.is-recap-making')
    assert.equal(words(card.querySelector('h4')), 'G6 · Garden: round 2 of your recap is being made')
    assert.equal(words(card.querySelector('.recap-making-line')), '2 of 3 next tries done')
    assert.doesNotMatch(words(card), /verdict/i)
    assert.deepEqual([page.all('#needs .is-recap-ready').length, page.find('#needs-count').textContent], [0, ''], 'no attention card, and the count stays empty')
    assert.equal(page.all('#needs .need.is-recap-making').length, 1)
    // It stays a link: the click opens the recap, which shows the being-made state.
    const link = card.querySelector('.recap-making-open')
    assert.equal(link.dataset.demo, PATH)
    await page.click('#needs .recap-making-open')
    await settle(10)
    assert.equal(page.find('#demo-page').open, true)
    assert.match(words(page.find('.demo-making')), /Round 2 is being made/)
  } finally { await page.close() }
})

test('the Focus page while round 2 is being made: a quiet card with the same words and the link; never the recap card\'s "verdict waits"; the verdict card comes back once the recap is written', async () => {
  const page = await openPage({ state: garden(NOW - 200 * MIN) })
  try {
    await page.click('[data-tab="advice"]')
    const card = page.find('#advisor-focus .focus-recap-making')
    assert.equal(words(card.querySelector('h3')), 'G6 · Garden: round 2 of your recap is being made')
    assert.equal(words(card.querySelector('p')), '2 of 3 next tries done')
    assert.equal(card.querySelector('a').dataset.demo, PATH)
    assert.equal(page.all('#advisor-focus .focus-recap-ready').length, 0)
    assert.doesNotMatch(words(page.find('#advisor-focus')), /verdicts? waits?/i)
  } finally { await page.close() }
  const written = await openPage({ state: garden(NOW - 20 * MIN) })
  try {
    await written.click('[data-tab="advice"]')
    assert.equal(written.all('#advisor-focus .focus-recap-making').length, 0)
    assert.match(words(written.find('#advisor-focus .focus-recap-ready h3')), /Your recap so far · 2 to judge/)
    assert.match(words(written.find('#needs .is-recap-ready h4')), /your recap so far/)
    assert.equal(written.all('#needs .is-recap-making').length, 0)
  } finally { await written.close() }
})

test('an open popup that says "being made" is drawn anew once the state says the recap was written; a ready one is left alone', async () => {
  let current = garden(NOW - 200 * MIN)
  let give = shown({}, SENT_MS - 4 * 60 * MIN)
  const page = await openPage({ state: () => current, hash: `demo=${PATH}`, answers: request => reply(request.url.startsWith('/api/demo?') ? give : {}) })
  await settle(10)
  try {
    assert.equal(page.all('.demo-making').length, 1)
    const asked = () => page.requests.filter(one => one.url.startsWith('/api/demo?')).length
    await page.reread()
    assert.equal(asked(), 1, 'still being made: not asked again')
    current = garden(NOW - 20 * MIN)
    give = shown({ props: { changed: 'tall props -> the limit stays', shows: OK } }, SENT_MS + 90 * MIN)
    await page.reread()
    await settle(10)
    assert.equal(asked(), 2)
    assert.equal(page.all('.demo-making').length, 0)
    assert.deepEqual(page.all('.demo-row').map(one => one.dataset.demoRow), ['2. Cliffs', '3. Props', '4. Ring', '5. Bridges'])
    await page.reread()
    assert.equal(asked(), 2, 'a ready round is not drawn again by every read')
  } finally { await page.close() }
})

test('the ruling on the page: a state that carries both the verdict card and the round being made draws the quiet card only, in Needs your attention and on the Focus page', async () => {
  const both = { ...garden(NOW - 20 * MIN), recapMaking: garden(NOW - 200 * MIN).recapMaking }
  assert.ok(both.recapCard.count > 0, 'the fixture has verdicts waiting too')
  const page = await openPage({ state: both })
  await settle(10)
  try {
    assert.deepEqual([page.all('#needs .is-recap-making').length, page.all('#needs .is-recap-ready').length, page.find('#needs-count').textContent], [1, 0, ''])
    await page.click('[data-tab="advice"]')
    assert.deepEqual([page.all('#advisor-focus .focus-recap-making').length, page.all('#advisor-focus .focus-recap-ready').length], [1, 0])
    assert.doesNotMatch(words(page.find('#advisor-focus')), /verdicts? waits? for you/i, 'the strip and the progress line say nothing of verdicts either')
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The view, as the page runs it (the marked region of board.js, with the page's own cutWords)

const cutLine = script.split('\n').find(line => line.startsWith('const cutWords = '))
const { recapMakingView } = vm.runInNewContext(`const HOUR = ${60 * MIN}\n${cutLine}\n${script.slice(script.indexOf('// recapready:start'), script.indexOf('// recapready:end'))}\n;({ recapMakingView })`, {})
const plain = value => JSON.parse(JSON.stringify(value))

test('the view: the goal\'s words, "k of m next tries done" (singular for one, calm for none), the link that opens the recap; none for no round to make', () => {
  const making = (more = {}) => ({ goal: 'G60', path: PATH, round: 2, done: 3, total: 5, ...more })
  assert.deepEqual(plain(recapMakingView(making(), { id: 'G60', title: 'How we build good maps' })), {
    goal: 'G60', round: 2, heading: 'G60 · How we build good maps: round 2 of your recap is being made', line: '3 of 5 next tries done', open: { label: 'Open the recap →', target: { path: PATH } },
  })
  assert.equal(recapMakingView(making({ round: 3, done: 0, total: 1 }), { id: 'G60', title: 'Maps' }).line, '0 of 1 next try done')
  assert.equal(recapMakingView(making({ done: 0, total: 0 }), null).line, 'No next tries yet')
  assert.equal(recapMakingView(making({ done: 9, total: 4 }), null).line, '4 of 4 next tries done', 'never more done than made')
  assert.equal(recapMakingView(making(), { id: 'G7', title: 'Not this goal' }).heading, 'G60: round 2 of your recap is being made')
  assert.equal(recapMakingView(making({ goal: null }), null).heading, 'Round 2 of your recap is being made')
  assert.equal(recapMakingView(making({ path: null }), null).open, null, 'never a dead arrow')
  for (const none of [null, undefined, {}, making({ round: 1 })]) assert.equal(recapMakingView(none, null), null)
})

test('amber is for what asks the person: the being-made cards use none of it', () => {
  const blocks = [...css.matchAll(/^([^{}\n]*(?:is-recap-making|recap-making|focus-recap-making|demo-making|demo-reworking|demo-changed|demo-play)[^{}\n]*)\{([^}]*)\}/gm)]
  assert.ok(blocks.length >= 6, 'the styles are there')
  for (const [, selector, body] of blocks) assert.doesNotMatch(body, /--attn|#e3a52b|#c99a2e|#f4c35a|#1d1a10|#f0b53a/i, selector)
})
