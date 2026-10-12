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
export async function readFolders(gameRepo, run) {
  const list = await run(['-C', gameRepo, 'worktree', 'list', '--porcelain'])
  if (list === null) return null
  const folders = parseWorktrees(list)
  // The first folder is the repository itself. The others are usually named after it ("game-units"): the part
  // after its name says which one it is.
  const prefix = folders.length === 0 ? '' : `${baseName(folders[0].path)}-`
  return Promise.all(folders.map(async ({ path, branch }) => {
    const [status, ahead, last] = await Promise.all([
      run(['-C', path, 'status', '--porcelain']),
      branch === null ? null : branch === 'main' ? '0' : run(['-C', gameRepo, 'rev-list', '--count', `main..${branch}`]),
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

/** Runs git without a shell. `--no-optional-locks` keeps `status` from taking the index lock a chat may need. */
export function gitRunner() {
  return args => new Promise(resolve => {
    execFile('git', ['--no-optional-locks', ...args], { timeout: GIT_SECONDS * 1000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(error === null ? stdout : null))
  })
}

/** Keeps an answer for `ttlMs`, so the page's refresh does not start git again each time. */
export function cached(read, ttlMs, now = Date.now) {
  let value
  let readAt = -Infinity
  let pending = null
  let round = 0
  const fresh = () => {
    if (now() - readAt < ttlMs) return Promise.resolve(value)
    if (pending !== null) return pending
    const mine = round
    const reading = read().then(answer => {
      // An answer that was asked for before `reset` is given to who waited for it, but not kept.
      if (mine === round) {
        value = answer
        readAt = now()
      }
      return answer
    }).finally(() => {
      if (pending === reading) pending = null
    })
    pending = reading
    return reading
  }
  /** Forgets the kept answer and a read that is under way: the next call reads again. */
  fresh.reset = () => {
    round += 1
    readAt = -Infinity
    pending = null
  }
  return fresh
}
