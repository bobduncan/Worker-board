// The Workers mod release 0.32.0, point 5: the Supervisor's turn-ended names the word its turn ran on (the mod's 8c `word`), so the
// board ends THAT judge word, not the newest in flight: two sweeps' judge words in flight, and the older turn's end used to close the
// newer word. An older mod names none: the newest in flight as before.

import assert from 'node:assert/strict'
import test from 'node:test'

import { JUDGE, judgeWordNamed, judgeWordOf } from '../src/work/judgeWord.mjs'

const word = (id, at, more = {}) => ({ id, to: 'Watcher', command: JUDGE, at, state: 'delivered', ...more })
const outbox = [word('j1', 1000), { id: 'w1', to: 'Watcher', command: 'work', at: 1500 }, word('j2', 2000), word('j3', 3000, { to: 'Other' })]

test('the named word: the judge word to the chat with that id; a work word, another chat\'s, an unknown id or none: null', () => {
  assert.equal(judgeWordNamed(outbox, 'Watcher', 'j1')?.id, 'j1')
  assert.equal(judgeWordNamed(outbox, 'Watcher', 'j2')?.id, 'j2')
  assert.equal(judgeWordNamed(outbox, 'Watcher', 'w1'), null)
  assert.equal(judgeWordNamed(outbox, 'Watcher', 'j3'), null)
  assert.equal(judgeWordNamed(outbox, 'Watcher', 'nope'), null)
  assert.equal(judgeWordNamed(outbox, 'Watcher', null), null)
  assert.equal(judgeWordNamed(outbox, 'Watcher', undefined), null)
  // The fallback the Supervisor uses for an older mod: the newest judge word to the chat.
  assert.equal((judgeWordNamed(outbox, 'Watcher', null) ?? judgeWordOf(outbox, 'Watcher')).id, 'j2')
  // With two in flight, the older turn's end names j1: j1 ends, j2 stays in flight (the mutant "newest" would end j2).
  assert.equal((judgeWordNamed(outbox, 'Watcher', 'j1') ?? judgeWordOf(outbox, 'Watcher')).id, 'j1')
})
