import assert from 'node:assert/strict'
import test from 'node:test'

import { HEAD_KEYS, parseItem, serializeItem, validateHead } from '../../src/work/item.mjs'

// The item of the spec's section 3, made up.
const ITEM = `Id: B285
Kind: step
Title: Refine every step before it goes into a queue
State: in progress
Owner: Support
Activity: A board for any project
Goal: G17
Blocked by: B281
Since: 2026-10-17 09:58
Estimate: 2 h
Branch: b285-refine-before-queue
Pictures: pictures/refine/final-form.png
Refined: ready

## Summary
One compact description per step.

## What we build
- the strip
- the window

## History
- 2026-10-17 09:58 Main: queued for Support, after B281
- 2026-10-17 10:02 server: delivered to Support (B281 done, Support free)
- 2026-10-17 10:03 Support: taken
`

test('parseItem reads the head up to the first blank line and the ## sections verbatim', () => {
  const item = parseItem(ITEM.replace(/\n/g, '\r\n'))
  assert.equal(item.problem, null)
  assert.equal(item.head.get('Owner'), 'Support')
  assert.equal(item.head.get('Since'), '2026-10-17 09:58')
  assert.deepEqual([...item.sections.keys()], ['Summary', 'What we build', 'History'])
  assert.equal(item.sections.get('History').length, 3)
  assert.deepEqual(item.sections.get('What we build'), ['- the strip', '- the window'])
})

test('serializeItem(parseItem(text)) gives back the same text', () => {
  assert.equal(serializeItem(parseItem(ITEM)), ITEM)
  const bare = 'Id: N4\nKind: note\nState: unread\nSince: 2026-10-17 10:00\n'
  assert.equal(serializeItem(parseItem(bare)), bare)
})

test('validateHead refuses an unknown key and a missing Id with one line naming it', () => {
  assert.equal(validateHead(parseItem(ITEM).head, 'step'), null)
  const note = parseItem('Id: N4\nKind: note\nState: unread\nSince: -\nOwner: Support\n').head
  assert.equal(validateHead(note, 'note'), 'Owner is no key of a note')
  const noId = parseItem('Kind: step\nState: new\nSince: -\n').head
  assert.equal(validateHead(noId, 'step'), 'Id is missing')
  assert.equal(validateHead(parseItem('Id: B1\nKind: step\nState: new\nSince: yesterday\n').head, 'step'), 'Since is no date: yesterday')
  assert.equal(validateHead(parseItem('Id: Q2\nKind: ask\nState: open\nSince: -\nAsks: guess\n').head, 'ask'), 'Asks is not decide, look, provide or do: guess')
  assert.ok(HEAD_KEYS.ask.includes('Of') && HEAD_KEYS.step.includes('Waits for'))
})

test('a line "Key:value" without a space and a key with a digit are no head lines: the head ends there', () => {
  const noSpace = parseItem('Id: B3\nKind:step\nState: new\n')
  assert.deepEqual([...noSpace.head.keys()], ['Id'])
  assert.match(noSpace.problem, /line 2 is no head line/)
  const digit = parseItem('Id: B3\nKey2: x\n')
  assert.deepEqual([...digit.head.keys()], ['Id'])
  assert.match(digit.problem, /line 2/)
})
