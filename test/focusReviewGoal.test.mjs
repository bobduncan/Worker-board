// Focus 3, the review's finding 2: only the partner asks of a goal or writes its note, and only of a goal in the map.
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { NOW, ROLES, fresh, item, questionsOf, state } from './focusReviewKit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('2: only the partner asks of a goal or writes its note, and only of a goal in the map', async () => {
  const { partner, main, features } = await fresh()
  assert.equal((await features({ action: 'ask', of: 'G6', text: 'Mine?' })).status, 403)
  assert.equal((await main({ action: 'ask', of: 'G6', text: 'Mine?' })).status, 403)
  assert.equal((await partner({ action: 'ask', of: 'G9', text: 'Which?' })).status, 409)
  assert.equal((await partner({ action: 'ask', of: 'G6', text: 'Which?' })).ok, true)
  assert.equal((await partner({ action: 'note', to: 'you', of: 'G9', decided: ['x'] })).status, 409)
  // Without a goal map to look in, no goal is known.
  const { dir } = await fresh()
  const blind = await workApi({ chat: 'Partner', action: 'ask', of: 'G6', text: 'Which?' }, { dir, now: NOW, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set() })
  assert.equal(blind.status, 409)
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

