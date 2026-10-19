// Focus 3, the review's finding 3: an Undo is typed to the partner first and marked after, once.
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { undoLine } from '../src/focus.mjs'
import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { NOW, ROLES, fresh, item, questionsOf, state } from './focusReviewKit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('3: an Undo is typed to the partner first and marked after; a failed word leaves it unmarked; two at once type once', async () => {
  const { dir, ctx, partner } = await fresh()
  try {
    await partner({ action: 'note', to: 'you', of: 'G6', decided: ['Kept the old map icons'] })
    const work = body => workApi(body, { ...ctx, as: 'person' })
    const typed = []
    const failing = await undoLine({ note: 'N1', line: 'Kept the old map icons' }, { work, type: async () => { throw new Error('the outbox is gone') } })
    assert.deepEqual([failing.ok, failing.status], [false, 500])
    assert.equal((await item(dir, 'N1')).sections.has('Undo asked'), false)
    const type = async undo => {
      typed.push(undo.line)
      return { ok: true, result: { said: 'm1' } }
    }
    const both = await Promise.all([undoLine({ note: 'N1', line: 'Kept the old map icons' }, { work, type }), undoLine({ note: 'N1', line: 'Kept the old map icons' }, { work, type })])
    assert.deepEqual(typed, ['Kept the old map icons'])
    assert.deepEqual(both.map(one => one.result.unchanged === true).sort(), [false, true])
    assert.deepEqual((await item(dir, 'N1')).sections.get('Undo asked').length, 1)
    // The store's own undo is only a check and a mark; the page's /api/work undo goes the same way in the server.
    const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
    assert.match(server, /body\?\.action === 'undo'\) return undoNow\(/)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

