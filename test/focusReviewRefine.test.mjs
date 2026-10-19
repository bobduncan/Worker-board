// Focus 3, the review's finding 4: refine answers match their asks for equal questions and for one holding " Answer: ".
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { NOW, ROLES, fresh, item, questionsOf, state } from './focusReviewKit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('4: two equal refine questions each match their own ask, by their place', async () => {
  const { dir, partner, person } = await fresh()
  try {
    await partner({ action: 'refine', id: 'B7', summary: 'Two of the same.', questions: ['Is it red?', 'Is it red?'] })
    await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 1, answer: 'no' }], feedback: '' })
    assert.deepEqual([await state(dir, 'Q1'), await state(dir, 'Q2')], ['open', 'answered'])
    await person({ action: 'answer', id: 'Q1', text: 'yes' })
    assert.deepEqual((await questionsOf(dir, 'B7')).map(one => one.answer), ['yes', 'no'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('4: a refine question that holds " Answer: " still matches its ask, before and after it is answered', async () => {
  const { dir, partner, person } = await fresh()
  try {
    await partner({ action: 'refine', id: 'B7', summary: 'A label.', questions: ['Should the tip under the button read Answer: soon?', 'Blue?'] })
    await person({ action: 'answer', id: 'Q2', text: 'yes' })
    await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 0, answer: 'no' }], feedback: '' })
    assert.equal(await state(dir, 'Q1'), 'answered')
    assert.deepEqual((await item(dir, 'Q1')).sections.get('Answer'), ['no'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

