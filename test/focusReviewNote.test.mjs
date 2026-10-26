// Focus 3, the review's finding 5: the daily note is read by the name the API takes it from.
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { NOW, ROLES, fresh, item, questionsOf, state } from './focusReviewKit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('5: the daily note is read by the name of the chat the API takes it from: the board\'s partner chat', async () => {
  const source = await readFile(join(ROOT, 'src', 'state.mjs'), 'utf8')
  assert.match(source, /focusState\(goalMap, itemsOf\(raw\.work\), brainstorms\.threads, prefix, advisorChat\?\.name \?\? null, now\)/)
})

