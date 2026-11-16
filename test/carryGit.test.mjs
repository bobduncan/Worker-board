// T5 B1 (2026-11-16, chat 1's review): the carry commands' git pieces at the live store's size and in the plan's order. The live set
// is 5,600+ files: staged by their roots (`git add -A -- home board ...`), never one by one on the command line (Windows caps it at
// 32 KB, so a save of the live store failed at `git add` before; 5,000 literal pathspecs over stdin took git past 20 s). The one default data folder meets a final dry run, a practice save, a final save and a
// practice save again: every switch finds or makes its branch. Git runs with a temp global config; nothing reaches a real remote.

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAndPush, ensureDataClone, gitRunner, line, lines, peekDataClone, rootsOfPaths } from '../src/carry/git.mjs'
import { DATA_BRANCH, PRACTICE_BRANCH } from '../src/carry/save.mjs'

const LONG = { timeout: 240_000 }
const MANY = 5200

async function world(root) {
  const home = join(root, 'home')
  await mkdir(home, { recursive: true })
  // As this PC: a global ignore that names a file of the set (the data clone must not follow it).
  await writeFile(join(home, 'ignore'), '**/.claude/settings.local.json\n')
  await writeFile(join(home, 'gitconfig'), `[user]\n\tname = Tester\n\temail = t@example.test\n[init]\n\tdefaultBranch = main\n[core]\n\texcludesFile = ${join(home, 'ignore').replace(/\\/g, '/')}\n`)
  const git = gitRunner({ env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), HOME: home, USERPROFILE: home } })
  const remote = join(root, 'remote.git')
  assert.equal((await git(root, ['init', '-q', '--bare', remote])).code, 0)
  return { git, remote }
}

test('a set of 5,200 files (about 160 KB of paths) is staged, committed and pushed in one save, and its removal too: by the roots, never path by path on the command line', LONG, async t => {
  const root = await mkdtemp(join(tmpdir(), 'carry-git-'))
  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}))
  const { git, remote } = await world(root)
  const dir = join(root, 'data')
  const made = await ensureDataClone({ git, dir, remote, branch: DATA_BRANCH })
  assert.equal(made.made, 'init')
  const paths = []
  for (let n = 0; n < MANY; n++) {
    const to = `home/.claude/work/B${1000 + n}-a-step-with-a-longer-name.md`
    paths.push(to)
    await mkdir(join(dir, 'home', '.claude', 'work'), { recursive: true })
    await writeFile(join(dir, ...to.split('/')), `Id: B${1000 + n}\n`)
  }
  paths.push('home/.claude/settings.local.json')
  await writeFile(join(dir, 'home', '.claude', 'settings.local.json'), '{}\n')
  assert.ok(paths.join(' ').length > 150_000, 'path by path this is far past a Windows command line')
  assert.deepEqual(rootsOfPaths([...paths, 'saved.json', 'settings/config.json', 'board/data/finished.json']), ['board', 'home', 'saved.json', 'settings'])
  const pushed = await commitAndPush({ git, dir, branch: DATA_BRANCH, paths, message: 'Board data: save', bytes: 60_000 })
  assert.deepEqual([pushed.committed, pushed.pushed, pushed.staged.length], [true, true, MANY + 1])
  assert.ok(pushed.staged.includes('home/.claude/settings.local.json'), 'the user\'s global ignore does not thin the set')
  assert.equal(lines(await git(dir, ['status', '--porcelain'])).length, 0, 'nothing left unstaged')
  assert.equal(lines(await git(dir, ['ls-files', '--', 'home'])).length, MANY + 1)
  assert.equal(line(await git(dir, ['ls-remote', '--heads', remote, DATA_BRANCH])).slice(0, 40), pushed.commit, 'origin holds the commit')
  // Every file leaves the set: removed from disk, then `rm --cached` over stdin.
  for (const to of paths) await rm(join(dir, ...to.split('/')))
  const gone = await commitAndPush({ git, dir, branch: DATA_BRANCH, paths: [], removed: paths, message: 'Board data: save' })
  assert.deepEqual([gone.committed, gone.pushed], [true, true])
  assert.equal(lines(await git(dir, ['ls-files', '--', 'home'])).length, 0)
  assert.equal(lines(await git(dir, ['status', '--porcelain'])).length, 0)
})

test('the one default folder in the plan\'s order: a dry run looks and makes nothing; practice then final then practice again switch to a branch that is here already instead of making it twice', LONG, async t => {
  const root = await mkdtemp(join(tmpdir(), 'carry-git-order-'))
  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}))
  const { git, remote } = await world(root)
  const dir = join(root, 'data')
  assert.deepEqual(await peekDataClone({ git, dir, branch: DATA_BRANCH }), { made: 'none', exists: false, onBranch: false, head: null })
  assert.equal(existsSync(dir), false, 'a peek makes no folder')
  const practice = await ensureDataClone({ git, dir, remote, branch: PRACTICE_BRANCH })
  assert.equal(practice.made, 'init')
  await writeFile(join(dir, 'saved.json'), '{"kind":"practice"}\n')
  await commitAndPush({ git, dir, branch: PRACTICE_BRANCH, paths: ['saved.json'], message: 'Board data: practice save' })
  const peeked = await peekDataClone({ git, dir, branch: DATA_BRANCH })
  assert.deepEqual([peeked.made, peeked.exists, peeked.onBranch, peeked.head], ['peeked', true, false, null])
  // The final kind: origin lacks it and no local branch holds it: a fresh orphan, the practice files gone from the folder.
  const final = await ensureDataClone({ git, dir, remote, branch: DATA_BRANCH })
  assert.deepEqual([final.made, final.head], ['init', null])
  assert.equal(existsSync(join(dir, 'saved.json')), false)
  assert.equal(line(await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])), DATA_BRANCH)
  // Back to the practice kind: the local branch is here (pushed too); it is switched to, with its files.
  const again = await ensureDataClone({ git, dir, remote, branch: PRACTICE_BRANCH })
  assert.equal(again.made, 'switched')
  assert.equal(existsSync(join(dir, 'saved.json')), true)
  // And the final kind once more, never pushed: the LOCAL branch exists, origin lacks it; it is switched to, not made again.
  const once = await ensureDataClone({ git, dir, remote, branch: DATA_BRANCH })
  assert.equal(once.made, 'switched', 'a local branch origin lacks is switched to (checkout --orphan would fail on it)')
  assert.equal(line(await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])), DATA_BRANCH)
  assert.deepEqual(lines(await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).sort(), [DATA_BRANCH, PRACTICE_BRANCH].sort())
  const peekedFinal = await peekDataClone({ git, dir, branch: DATA_BRANCH })
  assert.equal(peekedFinal.onBranch, true)
  assert.ok(peekedFinal.head)
})
