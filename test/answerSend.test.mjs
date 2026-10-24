// B483: an answer on the board never stays "Sending…". The person, 2026-10-21: "approving on the board doesnt seem to
// work": a Yes sent while the board restarted span for good and never reached the store. Now the page waits a few
// seconds at most, a fault of the page itself is said too, and a board that restarts refuses the answer at once.
// Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))

/** The page's sendWork in a sandbox, waiting 30 ms instead of its seconds; `fetch` and `redrawNeeds` stand in. */
function pageWith({ fetch, redrawNeeds = () => {} }) {
  const page = {
    sending: new Set(), problems: new Map(), drafts: new Map([['k', 'words']]), chosen: new Map(), TOKEN: 't', reads: 0,
    fetch, redrawNeeds, redrawFocus: () => {}, showPaste: () => {}, read: async () => { page.reads += 1 },
    setTimeout, clearTimeout, AbortController, TypeError,
  }
  vm.runInNewContext(`${cut('sendwork').replace('const WORK_WAIT_MS = 15000', 'const WORK_WAIT_MS = 30')}\nthis.run = sendWork`, page)
  return page
}

const never = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))

test('no answer from the board within its time: the answer is not sent, says so, and the button is free', async () => {
  const page = pageWith({ fetch: never })
  const problem = await page.run({ action: 'answer', id: 'Q1', text: 'Yes' }, 'k', { reread: false })
  assert.match(problem, /^the board did not answer within 0\.03 s \(it may be restarting\); try again$/)
  assert.equal(page.problems.get('k'), `Not sent: ${problem}`)
  assert.equal(page.sending.has('k'), false)
  // What was written stays, to send again.
  assert.equal(page.drafts.get('k'), 'words')
})

test('a fault of the page itself before the send is said too, and never leaves it spinning', async () => {
  const page = pageWith({ fetch: async () => assert.fail('not sent'), redrawNeeds: () => { throw new Error('need.of is undefined') } })
  const problem = await page.run({ action: 'answer', id: 'Q1', text: 'Yes' }, 'k')
  assert.equal(problem, 'the page failed (need.of is undefined); reload it and try again')
  assert.equal(page.sending.has('k'), false)
})

test('a board that is gone, or refuses, is said; an answer that went clears the draft', async () => {
  const gone = pageWith({ fetch: async () => { throw new TypeError('Failed to fetch') } })
  assert.equal(await gone.run({ action: 'answer', id: 'Q1' }, 'k'), 'the board\'s server does not answer')
  const refused = pageWith({ fetch: async () => ({ ok: false, status: 503, text: async () => 'The board restarts: try again in a moment.\n' }) })
  assert.equal(await refused.run({ action: 'answer', id: 'Q1' }, 'k'), 'The board restarts: try again in a moment.')
  const went = pageWith({ fetch: async () => ({ ok: true, json: async () => ({}) }) })
  assert.equal(await went.run({ action: 'answer', id: 'Q1' }, 'k'), null)
  assert.equal(went.drafts.has('k'), false)
  assert.equal(went.reads, 1)
})

test('a board that restarts refuses the page\'s answer at once, before it reaches the store', async t => {
  const worked = []
  const server = createBoard({ token: 'a'.repeat(64), getState: async () => ({ readAt: 1, chats: [] }), isClosing: () => true, work: async body => { worked.push(body); return { ok: true, result: {} } } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()
  const answer = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/work', headers: { 'X-Board-Token': 'a'.repeat(64), Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(JSON.stringify({ action: 'answer', id: 'Q1', text: 'Yes' }))
  })
  assert.equal(answer.status, 503)
  assert.match(answer.text, /The board restarts: try again in a moment/)
  assert.deepEqual(worked, [])
})

test('I66: a card the server sends without an answer (a goal\'s hand-out card) gets an empty one, so no redraw throws and no Send hangs', () => {
  const page = {}
  vm.runInNewContext(`${cut('withanswers')}\nthis.run = withAnswers`, page)
  const state = page.run({ forYou: [{ id: 'handout:G1', kind: 'do' }, { id: 'work:Q1', answer: { text: 'Yes' } }, { id: 'work:Q2', answer: null }] })
  assert.deepEqual(state.forYou.map(need => need.answer), [null, { text: 'Yes' }, null])
  assert.deepEqual(page.run({}), {})
})
