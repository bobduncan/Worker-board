// Source 5: the game's working folders, from git. Only commands that read: `worktree list`, `status`,
// `rev-list --count` and `log -1` (when the last commit was made, its short name and its first line). Nothing here commits, switches, merges, fetches or pushes.

import { execFile } from 'node:child_process'

const GIT_SECONDS = 5

/** The blocks of `git worktree list --porcelain`. A folder that is on no branch has `branch: null`. */
export function parseWorktrees(text) {
  const folders = []
  let folder = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('worktree ')) {
      folder = { path: line.slice('worktree '.length), head: null, branch: null }
      folders.push(folder)
    } else if (folder !== null && line.startsWith('HEAD ')) {
      folder.head = line.slice('HEAD '.length)
    } else if (folder !== null && line.startsWith('branch ')) {
      folder.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
  }
  return folders
}

const baseName = path => path.split(/[\\/]/).filter(part => part !== '').pop() ?? path

const count = text => (text === null ? null : text.split('\n').filter(line => line.trim() !== '').length)

function numberIn(text) {
  const value = text === null ? NaN : Number(text.trim())
  return Number.isFinite(value) ? value : null
}

/**
 * The working folders with what git says about each. `run(args)` answers git's output, or null when git failed or
 * took too long; a null shows on the page as unknown for that one fact.
 */
export async function readFolders(gameRepo, run, base = 'main') {
  const list = await run(['-C', gameRepo, 'worktree', 'list', '--porcelain'])
  if (list === null) return null
  const folders = parseWorktrees(list)
  // The first folder is the repository itself. The others are usually named after it ("game-units"): the part
  // after its name says which one it is.
  const prefix = folders.length === 0 ? '' : `${baseName(folders[0].path)}-`
  return Promise.all(folders.map(async ({ path, branch }) => {
    const [status, ahead, last] = await Promise.all([
      run(['-C', path, 'status', '--porcelain']),
      branch === null ? null : branch === base ? '0' : run(['-C', gameRepo, 'rev-list', '--count', `${base}..${branch}`]),
      run(['-C', path, 'log', '-1', '--format=%ct %h %s']),
    ])
    const [when = '', hash = '', ...subject] = (last ?? '').trim().split(' ')
    const seconds = numberIn(last === null ? null : when)
    return {
      path,
      name: baseName(path).startsWith(prefix) ? baseName(path).slice(prefix.length) : baseName(path),
      branch,
      ahead: numberIn(ahead),
      uncommitted: count(status),
      lastCommitAt: seconds === null ? null : seconds * 1000,
      lastCommit: seconds === null || hash === '' ? null : { hash, subject: subject.join(' ').slice(0, 120) },
    }
  }))
}

/**
 * B110: the local branches of the repositories the board knows (the game's, the board's own), as one list. Null
 * when git did not answer for one of them: the board then cannot tell whether a branch is still there.
 */
export async function readBranches(repos, run) {
  const lists = await Promise.all(repos.map(repo => run(['-C', repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'])))
  if (lists.some(list => typeof list !== 'string')) return null
  return [...new Set(lists.flatMap(list => list.split('\n').map(line => line.trim()).filter(line => line !== '')))]
}

/** Runs git without a shell. `--no-optional-locks` keeps `status` from taking the index lock a chat may need. */
export function gitRunner() {
  return args => new Promise(resolve => {
    execFile('git', ['--no-optional-locks', ...args], { timeout: GIT_SECONDS * 1000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(error === null ? stdout : null))
  })
}

/**
 * Keeps an answer for `ttlMs`, so the page's refresh does not start git again each time. B736 (X89: on 2026-10-27 the
 * board answered calls minutes late while every reset started a whole read beside the one under way): one read at a
 * time; a reset while one is under way has the next read wait for it, shared by every caller meanwhile.
 */
export function cached(read, ttlMs, now = Date.now) {
  let value
  let latest
  let readAt = -Infinity
  let running = null
  let queued = null
  let round = 0
  const start = () => {
    const mine = round
    const reading = read().then(answer => {
      latest = answer
      // An answer that was asked for before `reset` is given to who waited for it, but not kept.
      if (mine === round) {
        value = answer
        readAt = now()
      }
      return answer
    }).finally(() => {
      if (running?.reading === reading) running = null
    })
    running = { reading, round: mine }
    return reading
  }
  const fresh = () => {
    if (now() - readAt < ttlMs) return Promise.resolve(value)
    if (running === null) return start()
    if (running.round === round) return running.reading
    queued ??= running.reading.catch(() => {}).then(() => {
      queued = null
      return fresh()
    })
    return queued
  }
  /** Forgets the kept answer: the next call reads again, after the read under way (whose answer is not kept). */
  fresh.reset = () => {
    round += 1
    readAt = -Infinity
  }
  /** B736: the newest answer any read gave, however old, or undefined before the first: for what must not wait for a read. */
  fresh.last = () => latest
  return fresh
}
