// B751: the person, 2026-10-28: "i want also a rule to remove leftover working trees", after Main removed four by hand
// that the board's clean-up had left: one held a worker's node_modules link, one changed only line endings, one was a
// parked branch not merged, one lay in a chat's own folder named for a finished step, and one stray folder had files
// and no git. Real, temporary git repositories; links are made and never followed. Made-up names only.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { gitRunner } from '../../src/folders.mjs'
import { NO_STEP_IDLE_MS, STALE_MS, cleanLeftover, findLeftovers } from '../../src/work/worktrees.mjs'

const HOUR = 60 * 60_000
const isWindows = process.platform === 'win32'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const slashed = path => path.replace(/\\/g, '/')
const run = gitRunner()

function link(path, target) {
  if (isWindows) execFileSync('cmd', ['/c', 'mklink', '/J', path, target], { stdio: 'ignore' })
  else symlinkSync(target, path, 'dir')
}
function canLink() {
  const root = mkdtempSync(join(tmpdir(), 'sweep-link-'))
  try {
    mkdirSync(join(root, 'target'))
    link(join(root, 'link'), join(root, 'target'))
    rmdirSync(join(root, 'link'))
    return false
  } catch {
    return 'no link could be made here'
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const NO_LINK = canLink()
const step = (id, state, branch = null) => ({ head: new Map([['Id', id], ['Kind', 'step'], ['State', state], ...(branch === null ? [] : [['Branch', branch]])]), sections: new Map() })

/**
 * The project folder with the repository "garden" (its own node_modules, ignored) and beside it: garden-b14 (merged,
 * clean, a worker's node_modules link to garden's), garden-b17 (merged, a link to a folder elsewhere), garden-b15
 * (merged, README.md with other line endings only), garden-b18 (merged, a real change), garden-b6 (on b6-paths, a commit
 * main lacks, clean), garden-b19 (detached, a commit main lacks), garden-tools (merged, clean, names no step), and the
 * folder garden-keep (files, no git). Outside it: scratch/b16-wt (merged, clean, named for B16).
 */
function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sweep-')))
  const project = join(root, 'project')
  const repo = join(project, 'garden')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'gardener@example.com')
  git(repo, 'config', 'user.name', 'Gardener')
  // The line endings as the test writes them, whatever this PC's git does by default.
  git(repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'README.md'), 'A garden.\nWith paths.\n')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  mkdirSync(join(repo, 'node_modules'))
  writeFileSync(join(repo, 'node_modules', 'keep.txt'), 'never deleted\n')
  const add = (where, branch) => git(repo, 'worktree', 'add', '-q', ...(branch === null ? ['--detach'] : ['-b', branch]), where, 'main')
  add(join(project, 'garden-b14'), 'b14-gate')
  if (NO_LINK === false) link(join(project, 'garden-b14', 'node_modules'), join(repo, 'node_modules'))
  add(join(project, 'garden-b17'), 'b17-shed')
  mkdirSync(join(root, 'elsewhere'))
  writeFileSync(join(root, 'elsewhere', 'keep.txt'), 'never deleted\n')
  if (NO_LINK === false) link(join(project, 'garden-b17', 'node_modules'), join(root, 'elsewhere'))
  add(join(project, 'garden-b15'), 'b15-sign')
  writeFileSync(join(project, 'garden-b15', 'README.md'), 'A garden.\r\nWith paths.\r\n')
  add(join(project, 'garden-b18'), 'b18-well')
  writeFileSync(join(project, 'garden-b18', 'README.md'), 'A garden.\nWith a well.\n')
  add(join(project, 'garden-b6'), 'b6-paths')
  writeFileSync(join(project, 'garden-b6', 'paths.txt'), 'gravel\n')
  git(join(project, 'garden-b6'), 'add', '.')
  git(join(project, 'garden-b6'), 'commit', '-q', '-m', 'paths')
  add(join(project, 'garden-b19'), null)
  writeFileSync(join(project, 'garden-b19', 'loose.txt'), 'loose\n')
  git(join(project, 'garden-b19'), 'add', '.')
  git(join(project, 'garden-b19'), 'commit', '-q', '-m', 'loose')
  add(join(project, 'garden-tools'), 'tools')
  add(join(root, 'scratch', 'b16-wt'), 'b16-fence')
  mkdirSync(join(project, 'garden-keep'))
  writeFileSync(join(project, 'garden-keep', 'seeds.txt'), 'kept\n')
  return { root, project, repo, repos: [{ dir: repo, base: 'main' }] }
}

function done({ root, project }) {
  for (const one of [join(project, 'garden-b14', 'node_modules'), join(project, 'garden-b17', 'node_modules')]) {
    if (existsSync(one)) rmdirSync(one)
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

const byName = found => Object.fromEntries(found.map(one => [slashed(one.path).split('/').pop(), one]))
const look = (one, hours, items = []) => findLeftovers({ repos: one.repos, project: one.project, items, run, now: Date.now() + hours * HOUR, keep: [one.repo, one.project] })

test('B751: a worker\'s node_modules link to the main checkout\'s is no bar: taken away alone, the worktree removed, the packages kept', { skip: NO_LINK }, async () => {
  const one = world()
  try {
    const seen = byName(await look(one, 1))
    assert.deepEqual([seen['garden-b14'].clean, seen['garden-b14'].unlink], [true, 'node_modules'])
    // A link to anything else still keeps it, listed.
    assert.deepEqual([seen['garden-b17'].clean, seen['garden-b17'].why], [false, 'holds a link (node_modules): remove the link alone first'])
    assert.deepEqual(await cleanLeftover(seen['garden-b14']), { ok: true })
    assert.equal(existsSync(join(one.project, 'garden-b14')), false)
    assert.doesNotMatch(git(one.repo, 'worktree', 'list'), /garden-b14/)
    assert.deepEqual(readdirSync(join(one.repo, 'node_modules')), ['keep.txt'])
    assert.deepEqual(readdirSync(join(one.root, 'elsewhere')), ['keep.txt'])
  } finally {
    done(one)
  }
})

test('B751: changes of line endings alone count as none and are put back first; a real change keeps the worktree', async () => {
  const one = world()
  try {
    const seen = byName(await look(one, 1))
    assert.deepEqual([seen['garden-b15'].clean, seen['garden-b15'].lineEndings], [true, true])
    assert.deepEqual([seen['garden-b18'].clean, seen['garden-b18'].why], [false, 'has changes'])
    assert.deepEqual(await cleanLeftover(seen['garden-b15']), { ok: true })
    assert.equal(existsSync(join(one.project, 'garden-b15')), false)
    // A real change is never put back: it is listed, never cleaned.
    assert.equal((await cleanLeftover(seen['garden-b18'])).ok, false)
    assert.match(String(execFileSync('git', ['-C', join(one.project, 'garden-b18'), 'diff'], { encoding: 'utf8' })), /With a well/)
  } finally {
    done(one)
  }
})

test('B751: a worktree not merged goes after a day unused and its branch stays; on no branch it never goes', async () => {
  const one = world()
  try {
    const soon = byName(await look(one, 1))
    assert.deepEqual([soon['garden-b6'].clean, soon['garden-b6'].why], [false, 'not merged into main'])
    assert.deepEqual([soon['garden-b19'].clean, soon['garden-b19'].why], [false, 'not merged into main, and on no branch that would keep it'])
    const later = byName(await look(one, STALE_MS / HOUR + 1))
    assert.deepEqual([later['garden-b6'].clean, later['garden-b6'].what], [true, 'a worktree of garden on b6-paths, not merged: its branch stays'])
    assert.equal(later['garden-b19'].clean, false)
    assert.deepEqual(await cleanLeftover(later['garden-b6']), { ok: true })
    assert.equal(existsSync(join(one.project, 'garden-b6')), false)
    assert.match(git(one.repo, 'log', '-1', '--format=%s', 'b6-paths'), /paths/)
  } finally {
    done(one)
  }
})

test('B751: a worktree named for a finished step counts wherever it lies; one that names no step waits 6 h unused', async () => {
  const one = world()
  try {
    const unknown = byName(await look(one, 1))
    assert.deepEqual([unknown['b16-wt'].clean, unknown['b16-wt'].why], [false, 'not named as a step\'s or a check\'s worktree'])
    const finished = byName(await look(one, 1, [step('B16', 'done')]))
    assert.equal(finished['b16-wt'].clean, true)
    // Still open, it is the step's.
    assert.equal(byName(await look(one, 1, [step('B16', 'in progress')]))['b16-wt'].why, 'held by B16')
    assert.deepEqual([unknown['garden-tools'].clean, unknown['garden-tools'].why], [false, 'names no step: left until unused for 6 h'])
    assert.equal(byName(await look(one, NO_STEP_IDLE_MS / HOUR + 1))['garden-tools'].clean, true)
    assert.deepEqual(await cleanLeftover(finished['b16-wt']), { ok: true })
    assert.equal(existsSync(join(one.root, 'scratch', 'b16-wt')), false)
  } finally {
    done(one)
  }
})

test('B751: a folder named as a worktree\'s with files and no git is moved into logs/scratch after a day, never deleted', async () => {
  const one = world()
  try {
    assert.equal(byName(await look(one, 1))['garden-keep'], undefined, 'touched within the day: left alone')
    const later = byName(await look(one, STALE_MS / HOUR + 1))
    assert.equal(later['garden-keep'].clean, true)
    assert.equal(slashed(later['garden-keep'].moveTo), slashed(join(one.project, 'logs', 'scratch', 'garden-keep')))
    // A name taken in logs/scratch gets a number.
    mkdirSync(join(one.project, 'logs', 'scratch', 'garden-keep'), { recursive: true })
    const moved = await cleanLeftover(later['garden-keep'])
    assert.equal(moved.ok, true, moved.why)
    assert.equal(slashed(moved.movedTo), slashed(join(one.project, 'logs', 'scratch', 'garden-keep-2')))
    assert.deepEqual(readdirSync(moved.movedTo), ['seeds.txt'])
    assert.equal(existsSync(join(one.project, 'garden-keep')), false)
    // The main checkout and a repository of its own are never moved.
    assert.equal(later.garden, undefined)
  } finally {
    done(one)
  }
})
