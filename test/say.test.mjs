import assert from 'node:assert/strict'
import test from 'node:test'

import { checkSay } from '../src/say.mjs'

const state = {
  chats: [{ name: 'Main', isLeftover: false }, { name: 'Units', isLeftover: false }, { name: 'Main (fork)', isLeftover: true }],
  advisor: { name: 'Advisor' },
  forYou: [
    { id: 'units-path', from: 'Units', kind: 'input', title: 'Choose pathfinding approach', canAnswer: true },
    { id: 'main-move', from: 'Main', kind: 'verify', title: 'Test player movement', canAnswer: true },
    { id: 'quiet:Units', from: 'Units', kind: 'intervene', title: 'Quiet', canAnswer: false },
  ],
}
const check = body => checkSay(body, state, 50)

test('a message to the advisor or to a chat on the board is kept as typed', () => {
  assert.deepEqual(check({ to: 'Advisor', text: '  What next?  ' }), { ok: true, message: { to: 'Advisor', ask: null, title: null, verdict: null, text: 'What next?' } })
  assert.equal(check({ to: 'Units', text: 'Hello' }).ok, true)
})

test('a message must name a chat that is on the board', () => {
  for (const to of ['Nobody', 'Main (fork)', '', undefined, 5]) assert.deepEqual([check({ to, text: 'Hello' }).ok, check({ to, text: 'Hello' }).status], [false, 400])
})

test('a message needs words, and not too many', () => {
  assert.equal(check({ to: 'Advisor', text: '   ' }).status, 400)
  assert.equal(check({ to: 'Advisor' }).status, 400)
  assert.equal(check({ to: 'Advisor', text: 5 }).status, 400)
  assert.equal(check({ to: 'Advisor', text: 'x'.repeat(51) }).status, 413)
  assert.equal(check(['Advisor', 'Hello']).status, 400)
  assert.equal(check(null).status, 400)
})

test('an answer to a question needs words and takes no verdict', () => {
  assert.deepEqual(check({ to: 'Units', ask: 'units-path', text: 'Take A.' }).message, { to: 'Units', ask: 'units-path', title: 'Choose pathfinding approach', verdict: null, text: 'Take A.' })
  assert.equal(check({ to: 'Units', ask: 'units-path', text: '' }).status, 400)
  assert.equal(check({ to: 'Units', ask: 'units-path', text: 'A', verdict: 'approve' }).status, 400)
})

test('work to verify is approved, with or without words, or rejected with the reason', () => {
  assert.deepEqual(check({ to: 'Main', ask: 'main-move', verdict: 'approve' }).message, { to: 'Main', ask: 'main-move', title: 'Test player movement', verdict: 'approve', text: '' })
  assert.equal(check({ to: 'Main', ask: 'main-move', verdict: 'approve', text: 'Nice.' }).message.text, 'Nice.')
  assert.equal(check({ to: 'Main', ask: 'main-move', verdict: 'reject', text: 'It jitters on slopes.' }).ok, true)
  assert.equal(check({ to: 'Main', ask: 'main-move', verdict: 'reject' }).status, 400)
  assert.equal(check({ to: 'Main', ask: 'main-move', text: 'Fine' }).status, 400)
  assert.equal(check({ to: 'Main', ask: 'main-move', verdict: 'maybe', text: 'Fine' }).status, 400)
})

test('an answer goes only to the chat that asked, and only while the request is open and can be answered here', () => {
  assert.equal(check({ to: 'Main', ask: 'units-path', text: 'Take A.' }).status, 409)
  assert.equal(check({ to: 'Units', ask: 'gone', text: 'Take A.' }).status, 409)
  assert.equal(check({ to: 'Units', ask: 'quiet:Units', text: 'Wake up' }).status, 409)
  assert.equal(check({ to: 'Advisor', text: 'Hi', verdict: 'approve' }).status, 400)
})
