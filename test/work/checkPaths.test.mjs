// T5.2 P3 (2026-11-16): the report check's paths once the data moves: a report may write a path from the project folder or from
// the chats' home (both whole paths are left off), a named file is placed by the table (`abs`), and the data home and the pictures
// lie inside the game repo's folder yet are work OUTSIDE git (`outside`), never "in a repository". Without the three, today's reading.

import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'

import { filesNamed, pathsIn } from '../../src/work/check.mjs'

const PROJECT = 'C:/wrap/game'
const HOME = 'C:/wrap'
const DATA = 'C:/wrap/game/.workerboard'

test('pathsIn leaves off the project\'s whole path and the chats\' home\'s, given as a list; one folder as before', () => {
  const words = `made C:\\wrap\\game\\docs\\a.md and C:/wrap/logs/scratch/x.txt, see pictures/B12/look.png`
  assert.deepEqual(pathsIn(words, [PROJECT, HOME]).map(one => one.path), ['docs/a.md', 'logs/scratch/x.txt', 'pictures/B12/look.png'])
  assert.deepEqual(pathsIn(words, PROJECT).map(one => one.path), ['docs/a.md', 'pictures/B12/look.png'], 'one home: a whole path from the other folder is no path of the project, as before')
})

test('filesNamed places a named file by the table and counts the data home and the pictures as work outside git; without them a file in the repo folder is "in a repository"', async () => {
  const there = new Set([join(DATA, 'pictures', 'pictures', 'B12', 'look.png').toLowerCase(), join(DATA, '.claude', 'work', 'B12.md').toLowerCase()])
  const exists = async path => there.has(String(path).replace(/\\/g, '/').toLowerCase().replace(/\//g, '/')) || there.has(String(path).toLowerCase())
  const abs = path => (path.startsWith('pictures/') ? join(DATA, 'pictures', ...path.split('/')) : join(DATA, ...path.split('/')))
  const moved = await filesNamed({ result: 'made pictures/B12/look.png and .claude/work/B12.md', touches: [], project: PROJECT, repoDirs: [PROJECT], exists, abs, homes: [PROJECT, HOME], outside: [DATA] })
  assert.deepEqual([moved.found, moved.inGit, moved.missing], [['pictures/B12/look.png', '.claude/work/B12.md'], [], []])
  const asRepo = await filesNamed({ result: 'made pictures/B12/look.png', touches: [], project: PROJECT, repoDirs: [PROJECT], exists, abs })
  assert.deepEqual([asRepo.found, asRepo.inGit], [[], ['pictures/B12/look.png']], 'inside the repo folder and not set apart: in a repository')
  const today = await filesNamed({ result: 'made pictures/B12/look.png', touches: [], project: PROJECT, repoDirs: ['C:/wrap/other'], exists: async () => true })
  assert.deepEqual(today.found, ['pictures/B12/look.png'], 'today\'s call: joined under the project')
})
