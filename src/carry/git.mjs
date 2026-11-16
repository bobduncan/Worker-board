// T5 B1 (2026-11-16): the one git runner of the carry commands (tools/carry.mjs save|load), and the data clone. Every call runs
// with `--no-optional-locks`, `-c gc.auto=0`, no prompts (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never), hidden, and a time
// limit: 20 s for a local call, 60 s for fetch, push and ls-remote (a push gets more with its bytes). Content is compared by
// git blob id (`blobOf`: the same sha1 git computes, so no git call per file), never by raw bytes. Nothing here forces a push.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const LOCAL_MS = 20_000
export const REMOTE_MS = 60_000
/** A push gets a second more per 100 KB (a 20 MB push: 200 s more). */
export const PUSH_MS_PER_100KB = 1000
/** The first `git add` of a set writes one object per file, about 5 ms each on this PC (5,200 files: 25 s): 20 ms of room per path. */
export const ADD_MS_PER_PATH = 20

/** The blob id git gives `bytes` (`git hash-object`): sha1 of "blob <length>\0" and the bytes. */
export function blobOf(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'utf8')
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
}

/** The blob id of a file on disk, or null when it cannot be read. */
export async function blobOfFile(file, fs = { readFile }) {
  try {
    return blobOf(await fs.readFile(file))
  } catch {
    return null
  }
}

/**
 * The runner: `git(cwd, args, { timeoutMs, input })` resolves to `{ code, out, err }`; a call past its time is killed and answers
 * code null with "took longer than". `env` is what every call gets over the process's; `spawnImpl` for tests.
 */
export function gitRunner({ env = process.env, spawnImpl = spawn, program = 'git' } = {}) {
  const base = { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: env.GIT_ASKPASS ?? '' }
  return (cwd, args, { timeoutMs = LOCAL_MS, input = undefined, extraEnv = {} } = {}) => new Promise(resolve => {
    let child
    try {
      child = spawnImpl(program, ['--no-optional-locks', '-c', 'gc.auto=0', ...args], { cwd, env: { ...base, ...extraEnv }, windowsHide: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: 127, out: '', err: error?.message ?? String(error) })
      return
    }
    let out = ''
    let err = ''
    let late = false
    const timer = setTimeout(() => { late = true; child.kill() }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk })
    child.on('error', error => { clearTimeout(timer); resolve({ code: 127, out, err: error?.message ?? String(error) }) })
    child.on('exit', code => { clearTimeout(timer); resolve({ code: late ? null : code ?? 1, out, err: late ? `git ${args[0]} took longer than ${timeoutMs / 1000} s` : err }) })
    if (input !== undefined) { child.stdin.end(input) }
  })
}

/** One line of a call's output, trimmed; '' for none. */
export const line = result => String(result?.out ?? '').trim().split(/\r?\n/)[0] ?? ''
/** The lines of a call's output, trimmed, without empty ones. */
export const lines = result => String(result?.out ?? '').split(/\r?\n/).map(one => one.trim()).filter(one => one !== '')

/** Whether `remote` holds `branch`: its commit, or null. `git ls-remote` with the remote limit. */
export async function remoteBranch(git, cwd, remote, branch) {
  const asked = await git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`], { timeoutMs: REMOTE_MS })
  if (asked.code !== 0) throw new Error(`ls-remote ${remote} failed: ${asked.err.trim() || `code ${asked.code}`}`)
  const found = /^([0-9a-f]{40})\s/.exec(line(asked))
  return found ? found[1] : null
}

/**
 * Whether the remote answers an ANONYMOUS read (then it is public, and the data must not go there): `ls-remote` with every credential
 * helper off and prompts off. A local path remote is "anonymous" by nature and is taken as private (a test's bare repository).
 */
export async function isAnonymouslyReadable(git, cwd, remote) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(remote) && !/^[\w.-]+@[\w.-]+:/.test(remote)) return false
  const asked = await git(cwd, ['-c', 'credential.helper=', 'ls-remote', '--heads', remote], { timeoutMs: REMOTE_MS, extraEnv: { GIT_CONFIG_PARAMETERS: "'credential.helper='" } })
  return asked.code === 0
}

/**
 * The data clone in `dir`: a nested, single-branch clone of `remote`'s `branch`, `core.autocrlf=false` in its own config, its first
 * commit `.gitattributes` with `* -text` when the branch is new (an orphan init then). Answers `{ made: 'cloned' | 'init' | 'kept',
 * head }`; `head` is the branch's commit or null for a fresh orphan.
 */
export async function ensureDataClone({ git, dir, remote, branch, fs = { access, mkdir, readFile, writeFile }, identity = { name: 'worker board', email: 'board@localhost' } }) {
  const isRepo = await fs.access(join(dir, '.git')).then(() => true, () => false)
  if (isRepo) {
    const onBranch = line(await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']))
    await ownExcludesOnly(git, dir, fs)
    if (onBranch !== branch) {
      // The other kind of save lives here (a practice save, then the final one, in the one default folder): switch to this kind's branch,
      // from origin when it is there, else as a fresh orphan. The folder is the commands' own: its files are the branch's alone.
      const changed = await git(dir, ['status', '--porcelain'])
      if (lines(changed).length > 0) throw new Error(`the data folder ${dir} is on ${onBranch} and has changes of its own: move it away, or use --data for a folder of its own`)
      const upstream = await remoteBranch(git, dir, 'origin', branch)
      if (upstream !== null) {
        const fetched = await git(dir, ['fetch', '-q', 'origin', branch], { timeoutMs: REMOTE_MS * 3 })
        if (fetched.code !== 0) throw new Error(`fetch of ${branch} failed: ${fetched.err.trim()}`)
        const switched = await git(dir, ['checkout', '-q', '-B', branch, 'FETCH_HEAD'])
        if (switched.code !== 0) throw new Error(`checkout of ${branch} failed: ${switched.err.trim()}`)
        return { made: 'switched', head: upstream }
      }
      // A local branch of this kind is here already (an earlier save of this kind, not pushed yet): switch to it; else a fresh orphan.
      if ((await git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0) {
        const switched = await git(dir, ['checkout', '-q', branch])
        if (switched.code !== 0) throw new Error(`checkout of ${branch} failed: ${switched.err.trim()}`)
        return { made: 'switched', head: line(await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])) || null }
      }
      for (const args of [['checkout', '-q', '--orphan', branch], ['rm', '-rfq', '--cached', '.']]) {
        const done = await git(dir, args)
        if (done.code !== 0) throw new Error(`${args.join(' ')} failed in ${dir}: ${done.err.trim() || `code ${done.code}`}`)
      }
      await emptyButGit(dir, fs)
      await firstCommit(git, dir, fs)
      return { made: 'init', head: null }
    }
    const head = line(await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])) || null
    return { made: 'kept', head }
  }
  const upstream = await remoteBranch(git, process.cwd(), remote, branch)
  if (upstream !== null) {
    const cloned = await git(process.cwd(), ['clone', '-c', 'core.autocrlf=false', '--single-branch', '--branch', branch, remote, dir], { timeoutMs: REMOTE_MS * 5 })
    if (cloned.code !== 0) throw new Error(`clone of ${branch} failed: ${cloned.err.trim() || `code ${cloned.code}`}`)
    await ownExcludesOnly(git, dir, fs)
    await setIdentity(git, dir, identity)
    return { made: 'cloned', head: upstream }
  }
  await fs.mkdir(dir, { recursive: true })
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', remote], ['checkout', '-q', '--orphan', branch]]) {
    const done = await git(dir, args)
    if (done.code !== 0) throw new Error(`${args.join(' ')} failed in ${dir}: ${done.err.trim() || `code ${done.code}`}`)
  }
  await ownExcludesOnly(git, dir, fs)
  await setIdentity(git, dir, identity)
  await firstCommit(git, dir, fs)
  return { made: 'init', head: null }
}

/**
 * A look at the data folder without a write (a dry run): `{ made: 'none' | 'peeked', exists, onBranch, head }`; `head` only when the
 * folder is on `branch`.
 */
export async function peekDataClone({ git, dir, branch, fs = { access } }) {
  const isRepo = await fs.access(join(dir, '.git')).then(() => true, () => false)
  if (!isRepo) return { made: 'none', exists: false, onBranch: false, head: null }
  const onBranch = line(await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])) === branch
  return { made: 'peeked', exists: true, onBranch, head: onBranch ? line(await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])) || null : null }
}

/**
 * The data clone's own config: `core.autocrlf=false`, and `core.excludesFile` pointed at its own `.git/info/exclude` (made empty when
 * missing), so the USER'S global ignore (`~/.config/git/ignore`, which on this PC lists `**\/.claude/settings.local.json`) does not
 * thin the set: `git add -A` by folder follows every exclude, and only the clone's own may apply.
 */
async function ownExcludesOnly(git, dir, fs) {
  const own = join(dir, '.git', 'info', 'exclude')
  if (!await fs.access(own).then(() => true, () => false)) { await fs.mkdir(join(dir, '.git', 'info'), { recursive: true }); await fs.writeFile(own, '') }
  await git(dir, ['config', 'core.autocrlf', 'false'])
  await git(dir, ['config', 'core.excludesFile', own])
}

/** The orphan branch's first commit: `.gitattributes` with `* -text` and the README. */
async function firstCommit(git, dir, fs) {
  await fs.writeFile(join(dir, '.gitattributes'), '* -text\n')
  await fs.writeFile(join(dir, 'README.md'), [
    '# Worker board data', '',
    'The board\'s travelling data (plan, focus, goals, steps, settings, memory, the record of the pictures), written by',
    '`npm run save` in the worker-board folder and read back by `npm run load`. Never edit by hand: the next save replaces it.', '',
  ].join('\n'))
  for (const args of [['add', '--', '.gitattributes', 'README.md'], ['commit', '-q', '-m', 'Board data: first commit']]) {
    const done = await git(dir, args)
    if (done.code !== 0) throw new Error(`${args.join(' ')} failed in ${dir}: ${done.err.trim() || `code ${done.code}`}`)
  }
}

/** Empties the data folder but for `.git` (a branch switch to a fresh orphan: the other kind's files go). */
async function emptyButGit(dir, fs) {
  const { readdir, rm } = await import('node:fs/promises')
  for (const name of await readdir(dir)) {
    if (name === '.git') continue
    await (fs.rm ?? rm)(join(dir, name), { recursive: true, force: true })
  }
}

/** A commit identity in the clone's own config when the PC has none (a PC without one refuses every commit). */
async function setIdentity(git, dir, identity) {
  const name = line(await git(dir, ['config', 'user.name']))
  const email = line(await git(dir, ['config', 'user.email']))
  if (name === '') await git(dir, ['config', 'user.name', identity.name])
  if (email === '') await git(dir, ['config', 'user.email', identity.email])
}

/** Whether the PC has a git identity (name and email) for `cwd`. */
export async function hasIdentity(git, cwd) {
  return line(await git(cwd, ['config', 'user.name'])) !== '' && line(await git(cwd, ['config', 'user.email'])) !== ''
}

/**
 * The top-level folders and files of `paths` (home, board, memory, settings, saved.json, ...): what `git add -A` is pointed at. The live
 * set is 5,600+ paths, about 160 KB: too long for a Windows command line (32 KB), and 5,000 literal pathspecs over stdin take git
 * past 20 s; a handful of folder pathspecs is instant.
 */
export const rootsOfPaths = paths => [...new Set(paths.map(path => String(path).split('/')[0]).filter(root => root !== '' && root !== '.' && root !== '..'))].sort()

/**
 * Stages the set's roots in the data clone (`git add -A -- <roots>`: every file under them as it is on disk, the files save removed
 * as deletions; the folder is the commands' own), commits with the FIXED message and pushes the branch, never forced. Answers
 * `{ committed, pushed, commit }`; nothing to commit is `committed: false` with the head as `commit`.
 */
export async function commitAndPush({ git, dir, branch, paths, removed = [], message, bytes = 0, dryRun = false }) {
  const roots = rootsOfPaths([...paths, ...removed])
  if (roots.length > 0) {
    const added = await git(dir, ['add', '-A', '--', ...roots], { timeoutMs: LOCAL_MS + (paths.length + removed.length) * ADD_MS_PER_PATH })
    if (added.code !== 0) throw new Error(`git add failed: ${added.err.trim()}`)
  }
  const staged = lines(await git(dir, ['diff', '--cached', '--name-only']))
  const head = line(await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])) || null
  if (staged.length === 0) return { committed: false, pushed: false, commit: head, staged }
  if (dryRun) {
    await git(dir, ['reset', '-q'])
    return { committed: false, pushed: false, commit: head, staged, dryRun: true }
  }
  const committed = await git(dir, ['commit', '-q', '-m', message])
  if (committed.code !== 0) throw new Error(`git commit failed: ${committed.err.trim()}`)
  const commit = line(await git(dir, ['rev-parse', 'HEAD']))
  const pushed = await git(dir, ['push', '-q', 'origin', `${branch}:${branch}`], { timeoutMs: REMOTE_MS + Math.ceil(bytes / 102_400) * PUSH_MS_PER_100KB })
  if (pushed.code !== 0) throw new Error(`git push of ${branch} failed: ${pushed.err.trim() || `code ${pushed.code}`}`)
  return { committed: true, pushed: true, commit, staged }
}

/** Fetches the data clone's branch and fast-forwards to it; never a merge, never a reset over local commits. `{ before, after }`. */
export async function fastForward({ git, dir, branch }) {
  const before = line(await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])) || null
  const fetched = await git(dir, ['fetch', '-q', 'origin', branch], { timeoutMs: REMOTE_MS * 3 })
  if (fetched.code !== 0) throw new Error(`fetch of ${branch} failed: ${fetched.err.trim() || `code ${fetched.code}`}`)
  const moved = await git(dir, ['merge', '-q', '--ff-only', 'FETCH_HEAD'])
  if (moved.code !== 0) throw new Error(`the data folder ${dir} is not behind ${branch} in a straight line (${moved.err.trim().split('\n')[0]}): it was changed here; move it away and load again`)
  const after = line(await git(dir, ['rev-parse', 'HEAD']))
  return { before, after }
}

/**
 * The local branches of a repository with their commits: `[{ branch, commit, upstream }]` (`upstream` the commit of origin/<branch>
 * when fetched, else null).
 */
export async function localBranches(git, repo) {
  const refs = lines(await git(repo, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/']))
  const out = []
  for (const one of refs) {
    const [branch, commit] = one.split(' ')
    const upstream = line(await git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])) || null
    out.push({ branch, commit, upstream })
  }
  return out
}

/** How many commits `branch` has that `base` has not (0 when none or unknown). */
export async function aheadOf(git, repo, branch, base) {
  const counted = await git(repo, ['rev-list', '--count', `${base}..${branch}`])
  return counted.code === 0 ? Number(line(counted)) || 0 : 0
}

/** Whether a push of `branch` to origin would be a fast-forward: origin's copy is absent or an ancestor of the local commit. */
export async function pushIsFastForward(git, repo, branch, upstream) {
  if (upstream === null) return true
  const asked = await git(repo, ['merge-base', '--is-ancestor', upstream, branch])
  return asked.code === 0
}

/** Pushes `branch` to origin, never forced. */
export async function pushBranch(git, repo, branch) {
  const pushed = await git(repo, ['push', '-q', 'origin', `${branch}:${branch}`], { timeoutMs: REMOTE_MS * 3 })
  if (pushed.code !== 0) throw new Error(`push of ${branch} failed: ${pushed.err.trim() || `code ${pushed.code}`}`)
  return line(await git(repo, ['rev-parse', branch]))
}

/** `git status --porcelain` of tracked files only (untracked ones are fine): the changed paths. */
export async function trackedChanges(git, repo) {
  const status = await git(repo, ['status', '--porcelain', '--untracked-files=no'])
  if (status.code !== 0) throw new Error(`git status in ${repo} failed: ${status.err.trim()}`)
  // The two status letters, a space, the path (never trimmed first: a leading space is a letter's place).
  return String(status.out).split(/\r?\n/).filter(one => one.length > 3).map(one => one.slice(3).trim())
}

/** The commits of `repo`'s HEAD that origin's main does not have (its own HEAD when origin/main is unknown). */
export async function commitsNotOnOrigin(git, repo) {
  const upstream = line(await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']))
  if (upstream === '') return { upstream: null, count: 0 }
  return { upstream, count: await aheadOf(git, repo, 'HEAD', upstream) }
}
