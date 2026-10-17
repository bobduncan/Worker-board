import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseBacklog } from '../../src/backlog.mjs'
import { storeAsBacklog } from '../../src/work/adapter.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'

const TEXT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'backlog-small.md'), 'utf8')
const RULES = { prefix: 'Team - ', names: ['Board', 'Support', 'Units', 'Levels / Environment'] }

test('parity: storeAsBacklog(migrateBacklog(text)) deep-equals parseBacklog(text) on the fixture', () => {
  for (const text of [TEXT, TEXT.replace(/\n/g, '\r\n')]) {
    const { items, activities } = migrateBacklog(text, { ...RULES, now: 0 })
    assert.deepEqual(storeAsBacklog(items, activities, RULES), parseBacklog(text, RULES))
    assert.deepEqual(storeAsBacklog(items, activities), parseBacklog(text))
  }
})

// The real backlog holds the chats' words, so it never comes into the repository: the test reads the file the
// environment names (BOARD_PARITY_BACKLOG), and is skipped without it. BOARD_PARITY_NAMES may add the chat prefix
// and names, "<prefix>|<name>,<name>", for the workers the steps name.
const REAL = process.env.BOARD_PARITY_BACKLOG ?? ''
const [prefix = '', names = ''] = (process.env.BOARD_PARITY_NAMES ?? '').split('|')
test('parity on the real backlog when the configured file exists (skipped otherwise)', { skip: REAL === '' || !existsSync(REAL) ? 'BOARD_PARITY_BACKLOG names no file' : false }, () => {
  const text = readFileSync(REAL, 'utf8')
  const rules = { prefix, names: names.split(',').map(one => one.trim()).filter(Boolean) }
  const migrated = migrateBacklog(text, { ...rules, now: Date.now() })
  assert.equal(migrated.counts.steps, text.split('\n').filter(line => /^- \[( |x|X)\]\s/.test(line)).length)
  assert.deepEqual(storeAsBacklog(migrated.items, migrated.activities, rules), parseBacklog(text, rules))
})
