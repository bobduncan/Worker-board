// B297: the board's own check after a step is reported (spec 2026-10-17, section 4: "check: base equals remote,
// branch gone, result named"). Made-up repositories: git is a stand-in.

import assert from 'node:assert/strict'
import test from 'node:test'

import { reportCheck } from '../../src/work/check.mjs'

/** A git that answers from a table of "<repo> <args>" lines; null where it has none. */
const git = table => async args => table[`${args[1]} ${args.slice(2).join(' ')}`] ?? null
const heads = 'for-each-ref --format=%(refname:short) refs/heads'

test('a merged step: base equals remote, its branch is gone, a result is named', async () => {
  const run = git({ [`/game ${heads}`]: 'main\nb2-other\n', '/game rev-parse main': 'abc\n', '/game rev-parse origin/main': 'abc\n' })
  assert.deepEqual(await reportCheck({ branch: 'b1-strip', result: 'The strip shows.', repos: [{ dir: '/game', base: 'main' }], run }), { passed: true, lines: ['base equals remote', 'branch gone', 'result named'] })
})

test('each failing part is named; a repository without a remote is no failure', async () => {
  const run = git({ [`/game ${heads}`]: 'main\nb1-strip\n', [`/board ${heads}`]: 'main\n', '/game rev-parse main': 'abc\n', '/game rev-parse origin/main': 'def\n', '/board rev-parse main': 'abc\n' })
  const done = await reportCheck({ branch: 'b1-strip', result: '', repos: [{ dir: '/game', base: 'main' }, { dir: '/board', base: 'main' }], run })
  assert.deepEqual(done, { passed: false, lines: ['main of game is not the same as origin/main', 'the branch b1-strip is still there', 'no result named'] })
  const silent = await reportCheck({ branch: 'b1-strip', result: 'x', repos: [{ dir: '/game', base: 'main' }], run: async () => null })
  assert.deepEqual(silent, { passed: false, lines: ['git did not answer for game', 'git did not answer: the branches are not known'] })
  assert.deepEqual(await reportCheck({ branch: null, result: 'x', repos: [], run }), { passed: true, lines: ['base equals remote', 'branch gone', 'result named'] })
})
