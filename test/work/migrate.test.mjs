import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseBacklog } from '../../src/backlog.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { REFINED_MARK, migrateBacklog } from '../../src/work/migrate.mjs'

const TEXT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'backlog-small.md'), 'utf8')
const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const RULES = { prefix: 'Team - ', names: ['Board', 'Support', 'Units', 'Levels / Environment'] }
const migrated = migrateBacklog(TEXT, { ...RULES, now: NOW })
const get = (id, key) => valueOf(migrated.items.get(id), key)

test('migrateBacklog keeps every step: counts.steps equals the number of "- [" lines', () => {
  const lines = TEXT.split('\n').filter(line => /^- \[/.test(line)).length
  assert.equal(migrated.counts.steps, lines)
  assert.equal(migrated.items.size, lines)
  assert.deepEqual(migrated.counts, { steps: 19, open: 14, done: 5, you: 4 })
  assert.deepEqual(migrated.problems, [])
  assert.deepEqual(migrated.activities.map(one => [one.name, one.isFocus, one.steps.length]), [['Board work', true, 15], ['Done earlier', false, 4]])
  assert.deepEqual(migrated.preamble, ['# Backlog', '', 'A made-up backlog for the tests: every form of line the migration must carry.', 'A second line of the preamble.'])
})

test('a queued step gets State queued, Owner, Blocked by and Estimate', () => {
  assert.deepEqual(['Kind', 'Title', 'State', 'Owner', 'Blocked by', 'Waits for', 'Estimate', 'Activity', 'Since'].map(key => get('B10', key)),
    ['step', 'Draw the strip of states', 'queued', 'Board', 'B9', null, '1 h', 'Board work', '2026-10-17 11:05'])
  assert.equal(get('B24', 'Blocked by'), 'B10 and B11')
  assert.equal(get('B24', 'Owner'), 'Team - Board')
  assert.equal(get('B24', 'Pictures'), 'pictures/ideas/menu')
  assert.equal(get('B10', 'Queue note'), null)
})

test('a textual condition is kept as Waits for, Blocked by stays -', () => {
  assert.equal(get('B11', 'State'), 'queued')
  assert.equal(get('B11', 'Waits for'), "today's board work")
  assert.equal(get('B11', 'Blocked by'), null)
  assert.equal(get('B12', 'Waits for'), 'B13 says keep it')
  assert.equal(get('B12', 'Blocked by'), null)
})

test('an open @you Verify step becomes an ask of kind look with its B id', () => {
  assert.deepEqual(['Id', 'Kind', 'Asks', 'State', 'Title'].map(key => get('B13', key)), ['B13', 'ask', 'look', 'open', 'Is the golem the boss you meant (picture pictures/golem.png; Team - Units)'])
  assert.deepEqual(['B14', 'B15', 'B16'].map(id => [get(id, 'Asks'), get(id, 'State')]), [['decide', 'open'], ['provide', 'open'], ['do', 'answered']])
})

test('a branch, a held-back step, a step without an id and an odd line keep what they say', () => {
  assert.deepEqual([get('B17', 'State'), get('B17', 'Branch')], ['in progress', 'feature/shop'])
  assert.equal(get('B18', 'State'), 'new')
  assert.deepEqual([get('B19', 'State'), get('B19', 'Branch')], ['in progress', 'feature/walls'])
  assert.equal(get('B20', 'Queue note'), 'for Board; with B19; about 30 min')
  assert.equal(get('B05', 'Queue note'), 'for Board; now; about 30 min')
  assert.equal(get('B23', 'Line'), 'B23 verify: a lower-case ask  with two spaces @you')
  assert.deepEqual([get('L1', 'Title'), get('L1', 'State')], ['Get a review of the architecture', 'done'])
  assert.deepEqual([get('L2', 'Kind'), get('L2', 'Asks'), get('L2', 'State')], ['ask', 'decide', 'answered'])
})

test('a ready refine block fills Summary, Picture and What we build; an open one sets Refined: open', () => {
  const ready = migrated.items.get('B22')
  assert.equal(get('B22', 'Refined'), 'ready')
  assert.equal(get('B22', 'State'), 'queued')
  assert.deepEqual(ready.sections.get('Summary'), ['One compact description.'])
  assert.deepEqual(ready.sections.get('Picture'), ['pictures/refine/ready.png'])
  assert.deepEqual(ready.sections.get('What we build'), ['- the strip', '- the window'])
  assert.equal(ready.sections.get('Refined').length, 8)
  assert.equal(get('B21', 'Refined'), 'open')
  assert.deepEqual(migrated.items.get('B21').sections.get('Context'), ['  Was: An older title', REFINED_MARK, '  (First piece done on 2026-10-16 at 00:10 by Team - Support.)'])
})

test('every indented line is found again under Context or History, in order', () => {
  const backlog = parseBacklog(TEXT, RULES)
  const steps = backlog.activities.flatMap(activity => activity.steps)
  const ids = migrated.activities.flatMap(activity => activity.steps)
  assert.equal(ids.length, steps.length)
  steps.forEach((step, index) => {
    const item = migrated.items.get(ids[index])
    const notes = (item.sections.get('Context') ?? []).flatMap(line => (line === REFINED_MARK ? item.sections.get('Refined') : [line])).map(line => line.trim())
    assert.deepEqual(notes, step.notes, ids[index])
  })
  assert.deepEqual(migrated.items.get('B05').sections.get('History'), ['- 2026-10-14 Team - Board: done', '- 2026-10-17 11:05 server: migrated from the backlog'])
  assert.deepEqual(migrated.items.get('B16').sections.get('History'), ['- 2026-10-16 10:00 the person: done', '- 2026-10-17 11:05 server: migrated from the backlog'])
})

test('the activity notes and the lines between steps are kept with their place', () => {
  assert.deepEqual(migrated.activities[0].notes, ['  Queued on 2026-10-15 at 22:17: the whole chain, one after another.', '  A second activity note.'])
  assert.deepEqual(migrated.activities[1].loose, [{ after: 'B05', line: 'Found by B04 in a trial; part of B03.' }, { after: 'B05', line: '  An indented line after the prose.' }])
})

test('an id that stands twice is kept under a name of its own and named as a problem', () => {
  const twice = migrateBacklog('## A\n- [ ] B1 One\n- [ ] B1 Two\n', { now: NOW })
  assert.equal(twice.items.size, 2)
  assert.equal(valueOf(twice.items.get('L1'), 'Line'), 'B1 Two')
  assert.deepEqual(twice.problems, ['B1 stands twice on the backlog (line 3): the second is kept as L1'])
})
