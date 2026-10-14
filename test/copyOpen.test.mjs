// B212: without a Workers mod nothing takes the board's words; the board keeps them as copied, the page puts them on
// the clipboard and says into which chat to paste them. With a mod nothing changes. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { outboxNow } from '../src/store.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 14, 16, 0)
const config = { ...parseConfig('{}', {}), project: 'C:\p' }
const raw = { listText: '{"prefix":"Team - ","main":"Lead"}', appChatTexts: [], tails: {}, planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {} }
const stateWith = (seen, startedAt = NOW - 5 * MIN) => buildState(raw, { outbox: [], board: { startedAt, offSince: null }, seen, now: NOW, config })

test('the board knows no Workers mod takes its words when none asked it since it started', () => {
  assert.deepEqual(stateWith({ shown: {}, other: {} }).bridge, { isMissing: true })
  assert.deepEqual(stateWith({ shown: { Lead: NOW - 5000 }, other: {} }).bridge, { isMissing: false })
  assert.deepEqual(stateWith({ shown: {}, other: { Lead: NOW - 5000 } }).bridge, { isMissing: false })
  // Just started: the mods have not asked yet.
  assert.deepEqual(stateWith({ shown: {}, other: {} }, NOW - 5000).bridge, { isMissing: false })
  // A board that does not deliver (a copy, the demo) copies nothing.
  assert.equal(stateWith(null).bridge, null)
  assert.equal(stateWith(null).chatPrefix, 'Team - ')
})

test('copied words stay known: an answer keeps its request closed, a plain line shows for a while', () => {
  const answer = { id: 'a', at: NOW - 60 * MIN, to: 'Lead', ask: 'q1', text: 'yes', state: 'copied' }
  const line = { id: 'b', at: NOW - 60 * MIN, to: 'Lead', ask: null, text: 'hello', state: 'copied' }
  const old = { ...line, id: 'c', at: NOW - 13 * 60 * MIN }
  assert.deepEqual(outboxNow([answer, line, old], NOW, 10 * MIN).map(one => [one.id, one.state]), [['a', 'copied'], ['b', 'copied']])
})

test('the line on top says where to paste, and what to do when the browser did not copy', async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// paste:start'), script.indexOf('// paste:end'))}\nObject.assign(this, { pasteLine })`, page)
  assert.match(page.pasteLine({ chat: 'Team - Lead' }, true), /^Copied for you: open the chat "Team - Lead" in the Claude app and paste it there \(Ctrl\+V\)\./)
  assert.match(page.pasteLine({ chat: 'Team - Lead' }, false), /^Not copied by itself: click Copy, then open the chat "Team - Lead"/)
})
