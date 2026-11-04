// B993 (the person, 2026-11-04, on Q616 in the recap: "I do not know what Q600 is about when i only look at the recap/demo. also the link
// doesnt work."): (1) a kept look's card says on its own what it is about (the step, and the ask its words link, by title); (2) a link to
// an ask opens its window whatever its state (Q600 is answered and stands on no list), also `#details=Q600`; (3) a `#play=` tab says
// "Starting the game…" at once and, when the game does not start, "Not started: <why>" with a way back, never a silent board.
// Made-up garden names; the real case (Q616 and Q600) is built from today's store lines.

import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'

import { createBoard } from '../server.mjs'
import { roundPage, withRound } from '../src/demoFeedback.mjs'
import { demoPage } from '../src/demo.mjs'
import { keptLooksOf } from '../src/recapRound.mjs'
import { parseItem } from '../src/work/item.mjs'
import { askCardOf, routedAwayOf } from '../src/work/lists.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

/** An item of the store as its file holds it. */
const item = (head, sections = {}) => parseItem([
  ...Object.entries(head).map(([key, value]) => `${key}: ${value}`),
  ...Object.entries(sections).flatMap(([name, lines]) => ['', `## ${name}`, ...lines]),
  '',
].join('\n'))
const NOW = Date.now()
const Q600 = item(
  { Id: 'Q600', Kind: 'ask', Title: 'Check the stairs in the game, west and east, in all sizes (advice: yes).', State: 'answered', Owner: 'Painter', Since: '2026-11-02 21:27', Filed: String(NOW - 1000), Asks: 'look', Of: 'B924', Route: 'person' },
  { Text: ['Check the stairs in the game, west and east, in all sizes (advice: yes).'], Play: ['main&arena=g60-stairs-side'], Answer: ['Rejected. The game does not start.'] },
)
const Q616 = item(
  { Id: 'Q616', Kind: 'ask', Title: 'After the step in Q600, reopen the Q600 play link. [Q600](http://127.0.0.1:4310/#details=Q600)', State: 'open', Owner: 'Main', Since: '2026-11-04 12:00', Filed: String(NOW - 1000), Asks: 'do', Of: 'B924', Route: 'recap' },
  { Text: ['After the step in Q600, reopen the Q600 play link. [Q600](http://127.0.0.1:4310/#details=Q600)'] },
)
const Q617 = item(
  { Id: 'Q617', Kind: 'ask', Title: 'Does the new hedge look right?', State: 'open', Owner: 'Painter', Since: '2026-11-04 12:00', Filed: String(NOW - 1000), Asks: 'look', Of: 'B924', Route: 'recap' },
  { Text: ['Does the new hedge look right? See [Q999](http://127.0.0.1:4310/#details=Q999).'] },
)
const B924 = item({ Id: 'B924', Kind: 'step', Title: 'Draw the side stairs of the Terraces', State: 'review', Owner: 'Painter', Goal: 'G60' })
const store = { ok: true, items: new Map([Q600, Q616, Q617, B924].map(one => [one.head.get('Id'), one])) }

test('a kept look that links an ask says what it is about: that ask\'s title and step, not its id alone (the real case, Q616 and Q600)', () => {
  const [q616] = routedAwayOf(store).filter(one => one.id === 'Q616')
  assert.equal(q616.about, 'About Q600: Check the stairs in the game, west and east, in all sizes (B924)')
  assert.equal(q616.play, 'main&arena=g60-stairs-side', 'the Play link of the ask it links, as before')
})

test('a look that links no known ask says its step and the step\'s title; one that names no step says nothing', () => {
  const [, q617] = routedAwayOf(store)
  assert.equal(q617.about, 'About B924: Draw the side stairs of the Terraces', 'Q999 is no ask of the store: the step line')
  const loose = item({ Id: 'Q618', Kind: 'ask', Title: 'Is it round?', State: 'open', Owner: 'Painter', Since: '2026-11-04 12:00', Filed: String(NOW), Asks: 'look', Route: 'recap' }, { Text: ['Is it round?'] })
  assert.equal(routedAwayOf({ ok: true, items: new Map([['Q618', loose]]) })[0].about, '')
})

test('the kept look carries that line to the popup\'s page, cleaned to one line', () => {
  const routed = routedAwayOf(store).map(one => ({ ...one, isKept: true, goal: 'G60', of: 'B924' }))
  const looks = keptLooksOf(routed, 'G60')
  assert.equal(looks.find(one => one.ask === 'Q616').about, 'About Q600: Check the stairs in the game, west and east, in all sizes (B924)')
  const page = roundPage(demoPage({ goal: 'G60', title: 'Stairs', step: 'B924', sections: [{ kind: 'reached', rows: [{ title: '1. Front', note: 'n', pictures: [{ kind: 'final', caption: 'in the game', path: 'f.png' }] }] }] }, 'pictures/g60/recap'), null, { looks })
  assert.equal(page.looks.find(one => one.ask === 'Q616').about, 'About Q600: Check the stairs in the game, west and east, in all sizes (B924)')
})

test('an ask of the store opens as a card whatever its state: an answered one with its answer and map, an open one, an unknown id and a step none', () => {
  const answered = askCardOf(store, 'Q600')
  assert.deepEqual([answered.id, answered.state, answered.title, answered.of, answered.ofTitle, answered.play], ['Q600', 'answered', 'Check the stairs in the game, west and east, in all sizes', 'B924', 'Draw the side stairs of the Terraces', 'main&arena=g60-stairs-side'])
  assert.match(answered.text, /The answer: Rejected\. The game does not start\./)
  assert.equal(askCardOf(store, 'Q616').state, 'open')
  assert.equal(askCardOf(store, 'Q404'), null)
  assert.equal(askCardOf(store, 'B924'), null, 'a step is no ask')
  assert.equal(askCardOf({ ok: false }, 'Q600'), null)
})

// ---------------------------------------------------------------------------------------------------------------------
// The server

const TOKEN = 'a'.repeat(64)
async function board(t, askCard) {
  const server = createBoard({ token: TOKEN, getState: async () => ({ readAt: 1, chats: [] }), askCard })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const { port } = server.address()
  return (path, headers = {}) => new Promise((done, fail) => {
    const call = request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    call.on('error', fail)
    call.end()
  })
}

test('/api/ask gives the card to the board\'s own page only; an id the store lacks is 404', async t => {
  const get = await board(t, async id => askCardOf(store, id))
  assert.equal((await get('/api/ask?id=Q600')).status, 403)
  const found = await get('/api/ask?id=Q600', { 'X-Board-Token': TOKEN })
  assert.equal(found.status, 200)
  assert.equal(JSON.parse(found.text).state, 'answered')
  assert.equal((await get('/api/ask?id=Q404', { 'X-Board-Token': TOKEN })).status, 404)
  assert.equal((await get('/api/ask', { 'X-Board-Token': TOKEN })).status, 404)
})

// ---------------------------------------------------------------------------------------------------------------------
// The page

const state = () => asSent(build([], undefined))
const never = new Promise(() => {})
const card = askCardOf(store, 'Q600')

test('#details=Q600 opens the answered ask: at once "Opening it…", then its question, its answer and its step', async () => {
  let give = never
  const page = await openPage({ state: state(), hash: 'details=Q600', answers: request => (request.url.startsWith('/api/ask?') ? give : reply({})) })
  try {
    await settle(10)
    assert.equal(page.document.getElementById('details').open, true)
    assert.match(page.text('#details'), /Opening it…/)
    assert.deepEqual(page.requests.filter(one => one.url.startsWith('/api/ask?')).map(one => one.url), ['/api/ask?id=Q600'])
  } finally { await page.close() }
  give = reply(card)
  const done = await openPage({ state: state(), hash: 'details=Q600', answers: request => (request.url.startsWith('/api/ask?') ? give : reply({})) })
  try {
    await settle(10)
    const text = done.text('#details')
    assert.match(text, /Check the stairs in the game, west and east, in all sizes/)
    assert.match(text, /The answer: Rejected\. The game does not start\./)
    assert.match(text, /B924 Draw the side stairs of the Terraces/)
    assert.doesNotMatch(text, /Opening it…/)
  } finally { await done.close() }
})

test('an ask the store does not hold says so in its window, never nothing; a server that does not answer says that', async () => {
  const lost = await openPage({ state: state(), hash: 'details=Q404', answers: request => (request.url.startsWith('/api/ask?') ? reply('No such ask.', 404) : reply({})) })
  try {
    await settle(10)
    assert.match(lost.text('#details'), /Q404 is not on the board any more\./)
  } finally { await lost.close() }
  const deaf = await openPage({ state: state(), hash: 'details=Q404', answers: request => { if (request.url.startsWith('/api/ask?')) throw new Error('down'); return reply({}) } })
  try {
    await settle(10)
    assert.match(deaf.text('#details'), /Q404 could not be opened/)
  } finally { await deaf.close() }
})

test('a #play= link says "Starting the game…" while the board starts it, and "Not started: <why>" with a way back when it did not', async () => {
  let give = never
  const page = await openPage({ state: state(), hash: 'play=main&arena=g60-stairs-side', answers: request => (request.url === '/api/game' ? give : reply({})) })
  try {
    await settle(10)
    assert.equal(page.text('#play-notice'), 'Starting the game…')
    assert.deepEqual(page.sent('/api/game').map(one => [one.body.branch, one.body.action]), [['main', 'start']])
  } finally { await page.close() }
  give = reply('the game of main does not start: WebGL failed', 409)
  const refused = await openPage({ state: state(), hash: 'play=main&arena=g60-stairs-side', answers: request => (request.url === '/api/game' ? give : reply({})) })
  try {
    await settle(10)
    assert.match(refused.text('#play-notice'), /Not started: the game of main does not start: WebGL failed/)
    await refused.click('#play-notice button')
    assert.equal(refused.document.getElementById('play-notice'), null, 'a click on Back to the board takes the words away')
  } finally { await refused.close() }
  const deaf = await openPage({ state: state(), hash: 'play=main', answers: request => { if (request.url === '/api/game') throw new Error('down'); return reply({}) } })
  try {
    await settle(10)
    assert.match(deaf.text('#play-notice'), /Not started: the board's server does not answer/)
  } finally { await deaf.close() }
})

test('a kept look\'s card opens with its About line', async () => {
  const looks = keptLooksOf(routedAwayOf(store).map(one => ({ ...one, isKept: true, goal: 'G60', of: 'B924' })), 'G60')
  const base = demoPage({ goal: 'G60', title: 'Stairs', step: 'B924', sections: [{ kind: 'reached', rows: [{ title: '1. Front', note: 'n', pictures: [{ kind: 'final', caption: 'in the game', path: 'f.png' }] }] }] }, 'pictures/g60/recap')
  const given = { ...roundPage(base, null, { looks }), feedback: { ...roundPage(base, null, { looks }).feedback, canSend: false, whyNot: null } }
  const page = await openPage({ state: state(), hash: 'demo=pictures/g60/recap/demo.json', answers: request => (request.url.startsWith('/api/demo?') ? reply(given) : reply({})) })
  try {
    await settle(10)
    const lines = page.all('.demo-look .demo-row-about').map(one => one.textContent)
    assert.deepEqual(lines, ['About Q600: Check the stairs in the game, west and east, in all sizes (B924)', 'About B924: Draw the side stairs of the Terraces'])
  } finally { await page.close() }
})

test('the [Q600] button in a kept look\'s words opens Q600\'s window although no list of the page holds it', async () => {
  const looks = keptLooksOf(routedAwayOf(store).map(one => ({ ...one, isKept: true, goal: 'G60', of: 'B924' })), 'G60')
  const base = demoPage({ goal: 'G60', title: 'Stairs', step: 'B924', sections: [{ kind: 'reached', rows: [{ title: '1. Front', note: 'n', pictures: [{ kind: 'final', caption: 'in the game', path: 'f.png' }] }] }] }, 'pictures/g60/recap')
  const given = { ...roundPage(base, null, { looks }), feedback: { ...roundPage(base, null, { looks }).feedback, canSend: false, whyNot: null } }
  const answers = request => (request.url.startsWith('/api/demo?') ? reply(given) : request.url.startsWith('/api/ask?') ? reply(card) : reply({}))
  const page = await openPage({ state: state(), hash: 'demo=pictures/g60/recap/demo.json', answers })
  try {
    await settle(10)
    await page.click('.demo-look .ask-link[data-ask-link="Q600"]')
    await settle(10)
    assert.deepEqual(page.requests.filter(one => one.url.startsWith('/api/ask?')).map(one => one.url), ['/api/ask?id=Q600'])
    assert.match(page.text('#details'), /The answer: Rejected\./)
  } finally { await page.close() }
})
