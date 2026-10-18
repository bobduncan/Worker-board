// Focus 3, the review's finding 1: a blocking ask by a chat that does not hold the step never strands it; an answer
// that frees a step wakes its owner too.
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { NOW, ROLES, fresh, item, questionsOf, state } from './focusReviewKit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('1: a blocking ask by the partner or the main chat under a worker\'s step leaves the step in progress; the worker reports it', async () => {
  const { dir, partner, main, features } = await fresh()
  try {
    assert.equal((await features({ action: 'take', id: 'B1' })).ok, true)
    const asked = await partner({ action: 'ask', of: 'B1', kind: 'decide', text: 'A number or a bar?', blocking: true })
    assert.equal(asked.ok, true, asked.why)
    assert.equal(await state(dir, 'B1'), 'in progress')
    assert.equal(valueOf(await item(dir, 'Q1'), 'Blocking'), 'no')
    assert.doesNotMatch(asked.result.text, /blocks B1/)
    await main({ action: 'ask', of: 'B1', kind: 'look', text: 'Is it readable?', blocking: true })
    assert.equal(await state(dir, 'B1'), 'in progress')
    const reported = await features({ action: 'report', id: 'B1', result: 'The damage shows.' })
    assert.equal(reported.ok, true, reported.why)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('1: an answer that frees a step waiting on the person wakes the step\'s owner too, when another chat asked', async () => {
  const { dir, features, person } = await fresh()
  try {
    await features({ action: 'take', id: 'B1' })
    await features({ action: 'ask', of: 'B1', kind: 'decide', text: 'Yellow or white?', blocking: true })
    assert.equal(await state(dir, 'B1'), 'waiting on you')
    // The worker's own ask: the asker is the owner, one wake.
    const own = await person({ action: 'answer', id: 'Q1', text: 'yellow' })
    assert.deepEqual([own.result.wake.to, own.result.wakeOwner], ['Features', null])
    // An ask made before this fix by another chat that blocked the step: the owner is woken as well.
    await features({ action: 'ask', of: 'B1', kind: 'decide', text: 'Big or small?', blocking: true })
    const file = join(dir, 'Q2.md')
    await writeFile(file, (await readFile(file, 'utf8')).replace('Owner: Features', 'Owner: Partner'))
    const other = await person({ action: 'answer', id: 'Q2', text: 'big' })
    assert.equal(other.ok, true, other.why)
    assert.equal(await state(dir, 'B1'), 'in progress')
    assert.equal(other.result.wake.to, 'Partner')
    assert.deepEqual(other.result.wakeOwner, { to: 'Features', id: 'Q2', title: 'Big or small?', text: 'big' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

