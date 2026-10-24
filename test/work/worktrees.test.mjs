// Worktree clean-up (the person, 2026-10-24: "cleanup leftover working tree's please. ensure this is part of the cleanup
// step."). Git removed the worktrees of finished steps, but Windows left their empty folders in the project folder, and
// the result checks' worktrees stayed. Real, temporary git repositories: a project folder with a repository ("garden")
// and its remote, worktrees of finished and unfinished work, an empty leftover folder and a junction (a symlink off
// Windows), which must never be followed. Made-up names only.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { gitRunner } from '../../src/folders.mjs'
import { cleanLeftover, findLeftovers, findLink, namesStep, stepLeftovers, worktreeBlocks } from '../../src/work/worktrees.mjs'

const HOUR = 60 * 60_000
const isWindows = process.platform === 'win32'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const slashed = path => path.replace(/\\/g, '/')
const run = gitRunner()

/** A link from `path` to the folder `target`: a junction made with mklink /J on Windows, a symlink elsewhere. */
function link(path, target) {
  if (isWindows) execFileSync('cmd', ['/c', 'mklink', '/J', path, target], { stdio: 'ignore' })
  else symlinkSync(target, path, 'dir')
}

/** Whether a link can be made here; the tests that need one are skipped, with the reason, when it cannot. */
function canLink() {
  const root = mkdtempSync(join(tmpdir(), 'worktrees-link-'))
  try {
    mkdirSync(join(root, 'target'))
    link(join(root, 'link'), join(root, 'target'))
    rmdirSync(join(root, 'link'))
    return false
  } catch {
    return isWindows ? 'no junction could be made here (cmd /c mklink /J failed)' : 'no symlink could be made here'
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const NO_LINK = canLink()

/** A step of the store as findLeftovers reads it. */
const step = (id, state, branch = null) => ({ head: new Map([['Id', id], ['Kind', 'step'], ['State', state], ...(branch === null ? [] : [['Branch', branch]])]), sections: new Map() })

/**
 * The project folder with the repository "garden" (its remote beside it, outside the project) and, beside it:
 * garden-b5 (on b5-lamps, merged, clean), garden-b6 (on b6-paths, a commit main lacks), garden-b7 (merged, an untracked
 * file), garden-b8 (merged, clean; B8 is in progress), garden-b10 (merged, clean, a junction node_modules into a folder
 * outside it), check-b12 (detached at main), garden-b3 (an empty folder a removed worktree left), garden-b11 (a junction
 * itself), notes (an empty folder that never held a worktree) and garden-keep (a folder with files and no .git). Outside
 * the project folder: check-b13 (detached at main) and review-space (on review, at main).
 */
function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worktrees-')))
  const project = join(root, 'project')
  try {
    return build(root, project)
  } catch (error) {
    done({ root, project })
    throw error
  }
}

function build(root, project) {
  const repo = join(project, 'garden')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'gardener@example.com')
  git(repo, 'config', 'user.name', 'Gardener')
  writeFileSync(join(repo, 'README.md'), 'A garden.\n')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  git(root, 'init', '-q', '--bare', join(root, 'remote.git'))
  git(repo, 'remote', 'add', 'origin', join(root, 'remote.git'))
  git(repo, 'push', '-q', 'origin', 'main')
  const add = (name, branch) => git(repo, 'worktree', 'add', '-q', ...(branch === null ? ['--detach'] : ['-b', branch]), join(project, name), 'main')
  add('garden-b5', 'b5-lamps')
  add('garden-b6', 'b6-paths')
  writeFileSync(join(project, 'garden-b6', 'paths.txt'), 'gravel\n')
  git(join(project, 'garden-b6'), 'add', '.')
  git(join(project, 'garden-b6'), 'commit', '-q', '-m', 'paths')
  add('garden-b7', 'b7-pond')
  writeFileSync(join(project, 'garden-b7', 'pond.txt'), 'not added\n')
  add('garden-b8', 'b8-bench')
  add('garden-b10', 'b10-shed')
  const modules = join(root, 'modules')
  mkdirSync(modules)
  writeFileSync(join(modules, 'keep.txt'), 'never deleted\n')
  if (NO_LINK === false) link(join(project, 'garden-b10', 'node_modules'), modules)
  add('check-b12', null)
  // Outside the project folder: a result check's worktree of a finished step, and one not named as a step's or a check's.
  git(repo, 'worktree', 'add', '-q', '--detach', join(root, 'scratch', 'check-b13'), 'main')
  git(repo, 'worktree', 'add', '-q', '-b', 'review', join(root, 'scratch', 'review-space'), 'main')
  mkdirSync(join(project, 'garden-b3'))
  mkdirSync(join(root, 'elsewhere'))
  writeFileSync(join(root, 'elsewhere', 'keep.txt'), 'never deleted\n')
  if (NO_LINK === false) link(join(project, 'garden-b11'), join(root, 'elsewhere'))
  mkdirSync(join(project, 'notes'))
  mkdirSync(join(project, 'garden-keep'))
  writeFileSync(join(project, 'garden-keep', 'seeds.txt'), 'kept\n')
  return { root, project, repo, repos: [{ dir: repo, base: 'main' }], modules }
}

/** The links are taken away on their own first (never followed), then the rest. */
function done({ root, project }) {
  for (const one of [join(project, 'garden-b10', 'node_modules'), join(project, 'garden-b11')]) {
    if (existsSync(one)) rmdirSync(one)
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

const byName = found => Object.fromEntries(found.map(one => [slashed(one.path).split('/').pop(), one]))

test('a step is named in a folder by its id as a whole: B410 in game-b410 and check-b410-before, not in game-b4100', () => {
  assert.equal(namesStep('game-b410', 'B410'), true)
  assert.equal(namesStep('check-b410-before', 'B410'), true)
  assert.equal(namesStep('game-b4100', 'B410'), false)
  assert.equal(namesStep('game-xb410', 'B410'), false)
  assert.equal(namesStep('game-b410', ''), false)
})

test('git\'s list of worktrees: branch, detached, locked and prunable', () => {
  const text = 'worktree C:/p/game\nHEAD aaa\nbranch refs/heads/main\n\nworktree C:/p/check-b1\nHEAD bbb\ndetached\nlocked\n\nworktree C:/p/game-b2\nHEAD ccc\nbranch refs/heads/b2-x\nprunable gitdir file points to non-existent location\n'
  assert.deepEqual(worktreeBlocks(text).map(one => [one.path, one.branch, one.isLocked, one.isPrunable]), [
    ['C:/p/game', 'main', false, false], ['C:/p/check-b1', null, true, false], ['C:/p/game-b2', 'b2-x', false, true],
  ])
})

test('the self-check: a merged clean worktree and an empty leftover folder are safe; the rest is listed with its reason', { skip: NO_LINK }, async () => {
  const one = world()
  try {
    const items = [step('B8', 'in progress'), step('B12', 'review'), step('B6', 'done', 'b6-paths')]
    const found = await findLeftovers({ repos: one.repos, project: one.project, items, run, now: Date.now() + HOUR, keep: [one.repo, one.project] })
    const seen = byName(found)
    // Never the main checkout, never a folder that is a link itself, never one that held no worktree.
    for (const name of ['garden', 'garden-b11', 'notes', 'garden-keep']) assert.equal(seen[name], undefined, name)
    assert.deepEqual(Object.keys(seen).sort(), ['check-b12', 'check-b13', 'garden-b10', 'garden-b3', 'garden-b5', 'garden-b6', 'garden-b7', 'garden-b8', 'review-space'])
    assert.deepEqual([seen['garden-b5'].clean, seen['garden-b5'].kind, seen['garden-b5'].what], [true, 'worktree', 'a worktree of garden on b5-lamps'])
    // A result check's worktree of a finished step is safe wherever it is; one not named as a step's is never removed.
    assert.deepEqual([seen['check-b13'].clean, seen['check-b13'].what], [true, `a worktree of garden detached at ${git(one.repo, 'rev-parse', '--short=7', 'main').trim()}`])
    assert.deepEqual([seen['review-space'].clean, seen['review-space'].why], [false, 'not named as a step\'s or a check\'s worktree'])
    assert.deepEqual([seen['garden-b3'].clean, seen['garden-b3'].kind, seen['garden-b3'].what], [true, 'folder', 'an empty folder'])
    assert.deepEqual([seen['garden-b6'].clean, seen['garden-b6'].why], [false, 'not merged into main'])
    assert.deepEqual([seen['garden-b7'].clean, seen['garden-b7'].why], [false, 'has changes'])
    assert.deepEqual([seen['garden-b8'].clean, seen['garden-b8'].why], [false, 'held by B8'])
    assert.deepEqual([seen['check-b12'].clean, seen['check-b12'].why], [false, 'held by B12'])
    assert.deepEqual([seen['garden-b10'].clean, seen['garden-b10'].why], [false, 'holds a link (node_modules): remove the link alone first'])
  } finally {
    done(one)
  }
})

test('the self-check: a step holds a worktree by its branch too; one made or used lately waits', async () => {
  const one = world()
  try {
    const byBranch = byName(await findLeftovers({ repos: one.repos, project: one.project, items: [step('B40', 'queued', 'b5-lamps')], run, now: Date.now() + HOUR }))
    assert.equal(byBranch['garden-b5'].why, 'held by B40')
    const lately = byName(await findLeftovers({ repos: one.repos, project: one.project, items: [], run, now: Date.now() }))
    assert.equal(lately['garden-b5'].why, 'made or used in the last 20 min')
    assert.equal(lately['garden-b3'].why, 'made in the last 20 min')
  } finally {
    done(one)
  }
})

test('the clean-up removes the worktree with git (never --force) and the empty folder alone; a link is never followed', { skip: NO_LINK }, async () => {
  const one = world()
  try {
    const found = byName(await findLeftovers({ repos: one.repos, project: one.project, items: [], run, now: Date.now() + HOUR, keep: [one.repo, one.project] }))
    assert.deepEqual(await cleanLeftover(found['garden-b5']), { ok: true })
    assert.equal(existsSync(join(one.project, 'garden-b5')), false)
    assert.doesNotMatch(git(one.repo, 'worktree', 'list'), /garden-b5/)
    assert.deepEqual(await cleanLeftover(found['garden-b3']), { ok: true })
    assert.equal(existsSync(join(one.project, 'garden-b3')), false)
    // What is only listed is never removed, and what a link points to stays.
    assert.equal((await cleanLeftover(found['garden-b10'])).ok, false)
    assert.equal(existsSync(join(one.project, 'garden-b10', 'node_modules')), true)
    assert.deepEqual(readdirSync(one.modules), ['keep.txt'])
    assert.deepEqual(readdirSync(join(one.root, 'elsewhere')), ['keep.txt'])
    // A folder that was filled meanwhile is not removed: rmdir only takes an empty one.
    writeFileSync(join(one.project, 'notes', 'late.txt'), 'x\n')
    const late = await cleanLeftover({ clean: true, kind: 'folder', path: join(one.project, 'notes') })
    assert.equal(late.ok, false)
    assert.equal(existsSync(join(one.project, 'notes', 'late.txt')), true)
  } finally {
    done(one)
  }
})

test('a link is found anywhere in a folder, or the folder is one itself', { skip: NO_LINK }, async () => {
  const one = world()
  try {
    assert.deepEqual(await findLink(join(one.project, 'garden-b10')), { link: 'node_modules', isUnknown: false })
    assert.deepEqual(await findLink(join(one.project, 'garden-b11')), { link: '.', isUnknown: false })
    assert.deepEqual(await findLink(join(one.project, 'garden-b5')), { link: null, isUnknown: false })
    mkdirSync(join(one.project, 'garden-b5', 'deep', 'er'), { recursive: true })
    link(join(one.project, 'garden-b5', 'deep', 'er', 'cache'), one.modules)
    assert.deepEqual(await findLink(join(one.project, 'garden-b5')), { link: 'deep/er/cache', isUnknown: false })
    rmdirSync(join(one.project, 'garden-b5', 'deep', 'er', 'cache'))
  } finally {
    done(one)
  }
})

test('the report check\'s part: a worktree on the step\'s branch, and a folder of a worktree named for the step, each with how to remove it', { skip: NO_LINK }, async () => {
  const one = world()
  try {
    const repo = one.repos[0]
    const own = await stepLeftovers({ id: 'B5', branch: 'b5-lamps', repo, repos: one.repos, project: one.project, run })
    const at = slashed(join(one.project, 'garden-b5'))
    assert.deepEqual(own, [`the worktree ${at} is still on b5-lamps: git worktree remove ${at}, then delete the empty folder Windows may leave`])
    const empty = await stepLeftovers({ id: 'B3', branch: 'b3-gone', repo, repos: one.repos, project: one.project, run })
    assert.deepEqual(empty, [`the empty folder ${slashed(join(one.project, 'garden-b3'))} of a worktree is still there: delete it (rmdir "${slashed(join(one.project, 'garden-b3'))}")`])
    // A junction in it: its link is taken away alone first.
    const linked = await stepLeftovers({ id: 'B10', branch: 'b10-other', repo, repos: one.repos, project: one.project, run })
    const b10 = join(one.project, 'garden-b10')
    const unlink = isWindows ? `cmd /c rmdir "${join(b10, 'node_modules')}"` : `rm "${slashed(join(b10, 'node_modules'))}"`
    assert.deepEqual(linked, [`the worktree ${slashed(b10)} is still there: first remove its link node_modules alone (${unlink}), then git worktree remove ${slashed(b10)}, then delete the empty folder Windows may leave`])
    // A result check's own folder is the partner's, not the worker's; nothing left is no line.
    assert.deepEqual(await stepLeftovers({ id: 'B12', branch: 'b12-x', repo, repos: one.repos, project: one.project, run }), [])
    assert.deepEqual(await stepLeftovers({ id: 'B99', branch: 'b99-x', repo, repos: one.repos, project: one.project, run }), [])
  } finally {
    done(one)
  }
})

test('the result check\'s part: the check\'s own check-<id> worktrees are named, the worker\'s are not', async () => {
  const one = world()
  try {
    const at = slashed(join(one.project, 'check-b12'))
    assert.deepEqual(await stepLeftovers({ id: 'B12', which: 'check', repos: one.repos, project: one.project, run }),
      [`the worktree ${at} is still there: git worktree remove ${at}, then delete the empty folder Windows may leave`])
    assert.deepEqual(await stepLeftovers({ id: 'B5', which: 'check', repos: one.repos, project: one.project, run }), [])
  } finally {
    done(one)
  }
})

test('git that does not answer is named, never a pass', async () => {
  const lines = await stepLeftovers({ id: 'B5', branch: 'b5-lamps', repo: { dir: '/projects/garden', base: 'main' }, repos: [{ dir: '/projects/garden', base: 'main' }], run: async () => null, fs: null })
  assert.deepEqual(lines, ['git did not answer: the worktrees of garden are not known'])
  const found = await findLeftovers({ repos: [{ dir: '/projects/garden', base: 'main' }], project: '', items: [], run: async () => null })
  assert.deepEqual(found.map(one => [one.clean, one.why]), [[false, 'git did not answer: its worktrees are not known']])
})

test('the dry run lists what the board would clean and what it leaves, and removes nothing', async () => {
  const { leftoverLines, parseArgs } = await import('../../tools/leftover-worktrees.mjs')
  assert.deepEqual(leftoverLines([
    { path: 'C:\\projects\\game-b5', what: 'a worktree of game on b5-lamps', clean: true, why: null },
    { path: '/projects/game-b410', what: 'a worktree of game on b410-hero', clean: false, why: 'held by B410' },
  ]), ['Would clean: C:/projects/game-b5: a worktree of game on b5-lamps', 'Left: /projects/game-b410 (a worktree of game on b410-hero): held by B410'])
  assert.throws(() => parseArgs(['--clean', 'yes']), /Unknown argument --clean/)
  const tool = await import('node:fs').then(fs => fs.readFileSync(new URL('../../tools/leftover-worktrees.mjs', import.meta.url), 'utf8'))
  assert.doesNotMatch(tool, /cleanLeftover|rmdir|worktree', 'remove/)
})
