// Worktree clean-up. The person, 2026-10-24: "cleanup leftover working tree's please. ensure this is part of the
// cleanup step." Git removed the worktrees of finished steps, but on Windows their empty folders stayed in the project
// folder, and the result checks' worktrees (check-<id>, check-<id>-before) stayed whole. Three places see to it now:
// - the board's report check (check.mjs): no worktree of the step's repository is on the step's branch, and no folder
//   of a worktree named for the step is left; a line per leftover says how to remove it (`stepLeftovers`);
// - the result check (api.mjs `checked`): the check's own check-<id> worktrees are gone before it is filed (the same,
//   `which: 'check'`); they hold a link to the game's packages, so the board cannot remove them safely itself;
// - the board's sync list (sync.mjs, check `worktrees`): what is safe it removes itself, the rest it lists with the
//   reason (`findLeftovers`, `cleanLeftover`).
//
// Windows safety: `git worktree remove --force` follows junctions and deletes what they point to. Nothing here uses
// --force or removes a folder recursively: a worktree is removed only when nothing in it is a link (a junction or a
// symlink), by `git worktree remove` without --force, and a folder only by rmdir, which fails when it is not empty.

import { execFile } from 'node:child_process'
import { lstat, readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'

import { valueOf } from './item.mjs'

const MIN = 60_000
/** The states in which a step still holds its worktree. */
export const OPEN_STATES = ['queued', 'taken', 'in progress', 'review', 'waiting on you']
/** A worktree made or used this lately, or a folder made this lately, is left for now: a chat may be setting it up. */
export const RECENT_MS = 20 * MIN
/** A folder with more entries than this is not looked through to its end: it is left, never removed unseen. */
const WALK_LIMIT = 100_000
const REMOVE_SECONDS = 60
/** Waits (ms) before each try at removing an empty folder a worktree left: Windows lets go of it within seconds. */
export const EMPTY_WAITS = [0, 1000, 2000, 4000]
/** The words of a line for an empty folder a program still holds: the report check reads them to try again by itself. */
export const HELD_WORDS = 'a program still uses it'
export const isHeldLine = line => String(line).includes(HELD_WORDS)

/** The file system as this module uses it; tests may give another. */
export const FILES = {
  entries: path => readdir(path, { withFileTypes: true }),
  lstat: path => lstat(path),
  rmdir: path => rmdir(path),
}

/** Runs `job` after the caller has answered; a failure of it is its own (the folder just stays for the next check). */
const inBackground = job => { job().catch(() => {}) }

/** A path written with "/", without its end "/". */
const slashed = path => String(path).replace(/\\/g, '/').replace(/\/+$/, '')
/** A path for comparing: with "/", and in any case on Windows. */
const keyOf = (path, platform) => (platform === 'win32' ? slashed(path).toLowerCase() : slashed(path))
const nameOf = path => slashed(path).split('/').pop()
const native = (path, platform) => (platform === 'win32' ? slashed(path).replace(/\//g, '\\') : slashed(path))
const firstLine = text => String(text ?? '').split('\n').map(one => one.trim()).find(one => one !== '') ?? ''
const ownBranch = value => {
  const branch = String(value ?? '').trim()
  return branch === '' || branch === '-' || branch.toLowerCase() === 'none' ? null : branch
}

/** Whether a folder's name names step `id` as a whole: B410 in "game-b410" and "check-b410-before", not in "game-b4100". */
export function namesStep(name, id) {
  const plain = String(id ?? '').trim().toLowerCase()
  if (!/^[a-z]\d+$/.test(plain)) return false
  return new RegExp(`(?:^|[^a-z0-9])${plain}(?![0-9])`).test(String(name).toLowerCase())
}

/** The blocks of `git worktree list --porcelain`, the main checkout first; `branch` null when detached. */
export function worktreeBlocks(text) {
  const list = []
  let one = null
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('worktree ')) {
      one = { path: line.slice('worktree '.length), head: null, branch: null, isBare: false, isLocked: false, isPrunable: false }
      list.push(one)
    } else if (one === null) continue
    else if (line.startsWith('HEAD ')) one.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) one.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    else if (line === 'bare') one.isBare = true
    else if (line === 'locked' || line.startsWith('locked ')) one.isLocked = true
    else if (line === 'prunable' || line.startsWith('prunable ')) one.isPrunable = true
  }
  return list
}

/** Each repository's worktrees, `{ repo, list }`: `list` null when git did not answer. */
async function readWorktrees(repos, run) {
  return Promise.all(repos.map(async repo => {
    const text = await run(['-C', repo.dir, 'worktree', 'list', '--porcelain'])
    return { repo, list: typeof text === 'string' ? worktreeBlocks(text) : null }
  }))
}

const entriesOr = async (fs, path) => {
  try {
    return await fs.entries(path)
  } catch {
    return null
  }
}
const lstatOr = async (fs, path) => {
  try {
    return await fs.lstat(path)
  } catch (error) {
    return error?.code === 'ENOENT' ? 'gone' : null
  }
}
/** An entry that is no plain file and no plain folder (a junction, a symlink, or a kind not known) counts as a link. */
const isLinkLike = entry => entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())

/**
 * The first link in a folder, breadth first, by its path inside it ("." when the folder is one itself): `{ link,
 * isUnknown }`; `isUnknown` when the folder could not be looked through to its end.
 */
export async function findLink(path, fs = FILES, limit = WALK_LIMIT) {
  const self = await lstatOr(fs, path)
  if (self === null || self === 'gone') return { link: null, isUnknown: true }
  if (self.isSymbolicLink() || !self.isDirectory()) return { link: '.', isUnknown: false }
  const queue = ['']
  let seen = 0
  for (let at = 0; at < queue.length; at += 1) {
    const inner = queue[at]
    const entries = await entriesOr(fs, inner === '' ? path : join(path, ...inner.split('/')))
    if (entries === null) return { link: null, isUnknown: true }
    for (const entry of entries) {
      seen += 1
      if (seen > limit) return { link: null, isUnknown: true }
      const where = inner === '' ? entry.name : `${inner}/${entry.name}`
      if (isLinkLike(entry)) return { link: where, isUnknown: false }
      if (entry.isDirectory()) queue.push(where)
    }
  }
  return { link: null, isUnknown: false }
}

/** The first link right in a folder, by its name, or null. */
async function topLink(path, fs) {
  const entries = await entriesOr(fs, path)
  return entries?.find(isLinkLike)?.name ?? null
}

/** The folders right in the project folder (never a link), or null when it cannot be read. */
async function projectFolders(project, fs) {
  const entries = await entriesOr(fs, project)
  return entries === null ? null : entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => ({ name: entry.name, path: join(project, entry.name) }))
}

/** Whether a folder holds a ".git" file: the mark of a worktree (a repository of its own has a ".git" folder). */
async function hasGitFile(path, fs) {
  const found = await lstatOr(fs, join(path, '.git'))
  return found !== null && found !== 'gone' && found.isFile()
}

/** The starts of a worktree folder's name: "<repository's folder>-" for each repository, and a result check's "check-". */
function prefixesOf(lists) {
  const names = lists.flatMap(({ repo, list }) => [nameOf(repo.dir), ...(list?.[0] ? [nameOf(list[0].path)] : [])])
  return [...new Set([...names.map(name => `${name.toLowerCase()}-`), 'check-'])]
}
const looksLikeWorktree = (name, prefixes) => prefixes.some(prefix => name.toLowerCase().startsWith(prefix))
const isCheckFolder = name => name.toLowerCase().startsWith('check-')

/**
 * Removes an empty folder a worktree left (rmdir, never recursive): one try now. A program that stood in the worktree
 * (a chat's shell) lets go within seconds, so when the folder is held the tries after each of `waits` (past the first)
 * run in the background, outside the work store's queue (Principle 5): the next check finds it gone. `null` when it is
 * gone now, else why it stayed. `inline` (the report check's): all the tries run here, one after another.
 */
async function removeEmptyFolder(path, fs, waits, later, inline = false) {
  const [now, ...rest] = waits
  const attempt = async () => {
    try {
      await fs.rmdir(path)
      return null
    } catch (error) {
      return error?.code === 'ENOENT' ? null : error?.code ?? error?.message ?? 'no answer'
    }
  }
  if (now > 0) await new Promise(resolve => setTimeout(resolve, now))
  let why = await attempt()
  // The report check runs in the board's background loop, where nobody waits: it tries through all the waits itself.
  if (inline) {
    for (const ms of rest) {
      if (why === null) break
      await new Promise(resolve => setTimeout(resolve, ms))
      why = await attempt()
    }
    return why
  }
  if (why !== null && rest.length > 0) later(async () => { for (const ms of rest) { await new Promise(resolve => setTimeout(resolve, ms)); if (await attempt() === null) return } })
  return why
}

/** How to take a link away alone, never what it points to. */
const unlinkCommand = (path, platform) => (platform === 'win32' ? `cmd /c rmdir "${native(path, platform)}"` : `rm "${slashed(path)}"`)

/** The line for a worktree that is left: its path, and how to remove it (its link alone first, when it holds one). */
async function worktreeLine(path, state, fs, platform) {
  const link = fs === null ? null : await topLink(path, fs)
  const first = `first leave it (cd to the main checkout, in a command of its own), then ` + (link === null ? '' : `remove its link ${link} alone (${unlinkCommand(join(path, link), platform)}), then `)
  return `the worktree ${slashed(path)} ${state}: ${first}git worktree remove ${slashed(path)}, then delete the empty folder Windows may leave`
}

/**
 * The report check's and the result check's part (check.mjs, api.mjs `checked`): a line for each leftover of the step's
 * worktrees, naming its path and how to remove it; none when nothing is left. `which` 'report' (the worker's: a
 * worktree of the step's repository `repo` on its `branch`, and a worktree or a folder of one named for the step, not a
 * result check's) or 'check' (a result check's own, check-<id>). `repos` the repositories the board knows; `fs` null
 * leaves the project folder unread. `run` runs git (folders.mjs `gitRunner`).
 */
export async function stepLeftovers({ id, branch = null, repo = null, repos = [], project = '', run, fs = FILES, which = 'report', platform = process.platform, waits = EMPTY_WAITS, later = inBackground, inline = false }) {
  const lines = []
  const told = new Set()
  const known = repo === null || repos.some(one => keyOf(one.dir, platform) === keyOf(repo.dir, platform)) ? repos : [...repos, repo]
  const lists = await readWorktrees(known, run)
  const isMine = name => namesStep(name, id) && (which === 'check') === isCheckFolder(name)
  const own = ownBranch(branch)
  if (which === 'report' && repo !== null && own !== null) {
    const list = lists.find(one => keyOf(one.repo.dir, platform) === keyOf(repo.dir, platform))?.list ?? null
    if (list === null) lines.push(`git did not answer: the worktrees of ${nameOf(repo.dir)} are not known`)
    for (const one of (list ?? []).slice(1).filter(entry => entry.branch === own)) {
      told.add(keyOf(one.path, platform))
      lines.push(await worktreeLine(one.path, `is still on ${own}`, fs, platform))
    }
  }
  // A worktree of any repository the board knows, named for the step, wherever its folder is.
  const listed = new Map(lists.flatMap(({ list }) => (list ?? []).slice(1).map(one => [keyOf(one.path, platform), one])))
  for (const [key, one] of listed) {
    if (told.has(key) || !isMine(nameOf(one.path))) continue
    told.add(key)
    lines.push(await worktreeLine(one.path, 'is still there', fs, platform))
  }
  // What a worktree left in the project folder: an empty folder, or one that is not empty and no repository lists.
  if (fs !== null && project !== '') {
    const folders = await projectFolders(project, fs)
    if (folders === null) lines.push(`the project folder ${slashed(project)} could not be read`)
    const prefixes = prefixesOf(lists)
    for (const folder of folders ?? []) {
      if (!isMine(folder.name) || told.has(keyOf(folder.path, platform))) continue
      const entries = await entriesOr(fs, folder.path)
      if (entries === null) continue
      if (entries.length === 0) {
        // Whether a repository lists it must be known before it goes (Principle 3): git silent, it is left and said.
        if (lists.some(({ list }) => list === null)) {
          lines.push(`the empty folder ${slashed(folder.path)} of a worktree is still there: git did not answer, so it is not known whether a repository lists it; left as it is`)
          continue
        }
        // The board removes it itself (a minute after a worker's `git worktree remove` the rmdir works); no chore for the person.
        const why = typeof fs.rmdir === 'function' ? await removeEmptyFolder(folder.path, fs, waits, later, inline) : 'no way to remove it here'
        if (why !== null) lines.push(`the empty folder ${slashed(folder.path)} of a worktree is still there and could not be removed (${why}): ${HELD_WORDS}, the board keeps trying in the background and again at the next check`)
      }
      else if (looksLikeWorktree(folder.name, prefixes) || await hasGitFile(folder.path, fs)) {
        lines.push(`the folder ${slashed(folder.path)} of a worktree is still there, and no repository lists it: look what is in it, then delete it`)
      }
    }
  }
  return lines
}

/** Whether a commit is in `ref` of the repository: true, false, or null when git did not answer. */
async function isIn(dir, head, ref, run) {
  const count = await run(['-C', dir, 'rev-list', '--count', `${ref}..${head}`])
  return count === null ? null : count.trim() === '0'
}

/** Whether the worktree's HEAD is in its repository's base (origin/<base> or <base>): true, false or null. */
async function isMerged(repo, head, run) {
  if (typeof head !== 'string' || head === '') return null
  const answers = []
  for (const ref of [`origin/${repo.base}`, repo.base]) {
    const answer = await isIn(repo.dir, head, ref, run)
    if (answer === true) return true
    answers.push(answer)
  }
  return answers.includes(false) ? false : null
}

/** The newest change of a worktree: its folder, and its HEAD, index and log in git's own folder for it. */
async function lastUsed(path, run, fs) {
  const own = await run(['-C', path, 'rev-parse', '--absolute-git-dir'])
  const paths = [path, ...(own === null ? [] : ['HEAD', 'index', join('logs', 'HEAD')].map(one => join(own.trim(), one)))]
  let newest = -Infinity
  for (const one of paths) {
    const found = await lstatOr(fs, one)
    if (found !== null && found !== 'gone') newest = Math.max(newest, found.mtimeMs)
  }
  return newest
}

/**
 * The sync list's check `worktrees`: every worktree of the repositories the board knows (`repos`, `{ dir, base }`) but
 * their main checkouts and the folders of `keep`, and every folder right in the project folder that looks like a
 * worktree's (named "<repository's folder>-..." or "check-...", or holding a ".git" file) and that no repository
 * lists. Each is `{ path, kind ('worktree', 'folder' or 'repository'), repo, what, clean, why }`: `clean` true when the
 * board may remove it, else `why` it stays. Safe is: a worktree with no changes and no untracked files, whose HEAD is
 * in its repository's base, that no open step holds (by its branch, or its id in the folder's name), named as the
 * steps and checks name theirs ("<repository's folder>-..." or "check-..."), not made or used in the last RECENT_MS
 * and with no link in it; and an empty folder that is no link, not made in the last RECENT_MS, that no open step names.
 * `items` the store's items, `run` git (folders.mjs `gitRunner`), `now` the time.
 */
export async function findLeftovers({ repos, project = '', items = [], run, fs = FILES, now = Date.now(), keep = [], platform = process.platform }) {
  const steps = [...(items instanceof Map ? items.values() : items)]
    .filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step' && OPEN_STATES.includes(valueOf(item, 'State')) && typeof valueOf(item, 'Id') === 'string')
  const holder = (path, branch) => steps.find(item => namesStep(nameOf(path), valueOf(item, 'Id')) || (branch !== null && ownBranch(valueOf(item, 'Branch')) === branch))
  const lists = await readWorktrees(repos, run)
  const kept = new Set([...keep, ...repos.map(repo => repo.dir)].filter(path => typeof path === 'string' && path !== '').map(path => keyOf(path, platform)))
  for (const { list } of lists) if (list?.[0]) kept.add(keyOf(list[0].path, platform))
  const listed = new Set(lists.flatMap(({ list }) => (list ?? []).map(one => keyOf(one.path, platform))))
  const prefixes = prefixesOf(lists)
  const found = []
  for (const { repo, list } of lists) {
    if (list === null) {
      found.push({ path: repo.dir, kind: 'repository', repo: repo.dir, what: `the repository ${nameOf(repo.dir)}`, clean: false, why: 'git did not answer: its worktrees are not known' })
      continue
    }
    for (const one of list.slice(1)) {
      if (one.isBare || kept.has(keyOf(one.path, platform))) continue
      const what = `a worktree of ${nameOf(repo.dir)} ${one.branch !== null ? `on ${one.branch}` : `detached at ${String(one.head ?? '').slice(0, 7)}`}`
      const leave = why => found.push({ path: one.path, kind: 'worktree', repo: repo.dir, branch: one.branch, what, clean: false, why })
      const self = await lstatOr(fs, one.path)
      if (self === 'gone') {
        leave('its folder is gone (git worktree prune clears it)')
        continue
      }
      if (self === null || self.isSymbolicLink() || !self.isDirectory()) {
        leave('its folder is a link, or could not be read')
        continue
      }
      if (one.isLocked) {
        leave('locked')
        continue
      }
      const held = holder(one.path, one.branch)
      if (held !== undefined) {
        leave(`held by ${valueOf(held, 'Id')}`)
        continue
      }
      // Only a worktree named as the steps and checks name theirs; another (a chat's own, say) may be in use.
      if (!looksLikeWorktree(nameOf(one.path), prefixes)) {
        leave('not named as a step\'s or a check\'s worktree')
        continue
      }
      if ((await entriesOr(fs, one.path))?.length === 0) {
        leave('empty, and git still lists it (git worktree prune, then delete the folder)')
        continue
      }
      const status = await run(['-C', one.path, 'status', '--porcelain'])
      if (status === null) {
        leave('git did not answer for it')
        continue
      }
      if (status.trim() !== '') {
        leave('has changes')
        continue
      }
      const merged = await isMerged(repo, one.head, run)
      if (merged !== true) {
        leave(merged === false ? `not merged into ${repo.base}` : 'git did not answer whether it is merged')
        continue
      }
      if (now - await lastUsed(one.path, run, fs) < RECENT_MS) {
        leave('made or used in the last 20 min')
        continue
      }
      const { link, isUnknown } = await findLink(one.path, fs)
      if (link !== null) {
        leave(`holds a link (${link}): remove the link alone first`)
        continue
      }
      if (isUnknown) {
        leave('could not be looked through')
        continue
      }
      found.push({ path: one.path, kind: 'worktree', repo: repo.dir, branch: one.branch, what, clean: true, why: null })
    }
  }
  if (project !== '') {
    for (const folder of await projectFolders(project, fs) ?? []) {
      const key = keyOf(folder.path, platform)
      if (kept.has(key) || listed.has(key)) continue
      const hasGit = await hasGitFile(folder.path, fs)
      if (!looksLikeWorktree(folder.name, prefixes) && !hasGit) continue
      const entries = await entriesOr(fs, folder.path)
      if (entries === null) continue
      if (entries.length > 0) {
        if (hasGit) found.push({ path: folder.path, kind: 'folder', repo: null, what: 'a folder of a worktree', clean: false, why: 'not empty, and no repository the board knows lists it' })
        continue
      }
      const what = 'an empty folder'
      const held = holder(folder.path, null)
      const self = await lstatOr(fs, folder.path)
      if (held !== undefined) found.push({ path: folder.path, kind: 'folder', repo: null, what, clean: false, why: `held by ${valueOf(held, 'Id')}` })
      else if (self === null || self === 'gone') continue
      else if (now - self.mtimeMs < RECENT_MS) found.push({ path: folder.path, kind: 'folder', repo: null, what, clean: false, why: 'made in the last 20 min' })
      else found.push({ path: folder.path, kind: 'folder', repo: null, what, clean: true, why: null })
    }
  }
  return found.sort((a, b) => slashed(a.path).localeCompare(slashed(b.path), 'en', { numeric: true }))
}

/** Runs git to change something (a worktree's removal): `{ ok, why }`, `why` git's first line when it failed. */
export function gitWrite(args) {
  return new Promise(resolve => {
    execFile('git', args, { timeout: REMOVE_SECONDS * 1000, windowsHide: true }, (error, stdout, stderr) => {
      resolve(error === null ? { ok: true, why: null } : { ok: false, why: firstLine(stderr) || firstLine(error.message) || 'git failed' })
    })
  })
}

/**
 * Removes one safe leftover of `findLeftovers`: a worktree by `git worktree remove` (never --force), then the empty
 * folder Windows may leave by rmdir (never recursive: it fails on one that is not empty); a folder by rmdir alone.
 * `{ ok: true }`, or `{ ok: false, why }`.
 */
export async function cleanLeftover(one, { git = gitWrite, fs = FILES } = {}) {
  if (one?.clean !== true || !['worktree', 'folder'].includes(one.kind)) return { ok: false, why: 'it is not one the board may remove' }
  if (one.kind === 'worktree') {
    // The review: looked at again right before, as its folder may have changed since it was found.
    const { link, isUnknown } = await findLink(one.path, fs)
    if (link !== null || isUnknown) return { ok: false, why: link !== null ? `it holds a link now (${link})` : 'it could not be looked through' }
    const removed = await git(['-C', one.repo, 'worktree', 'remove', one.path])
    if (!removed.ok) return { ok: false, why: removed.why }
  }
  const self = await lstatOr(fs, one.path)
  if (self === 'gone') return { ok: true }
  if (self === null || self.isSymbolicLink() || !self.isDirectory()) return { ok: false, why: 'its folder is a link, or could not be read' }
  const entries = await entriesOr(fs, one.path)
  if (entries === null || entries.length > 0) return { ok: false, why: one.kind === 'worktree' ? 'git removed the worktree; its folder is left, not empty' : 'it is not empty' }
  try {
    await fs.rmdir(one.path)
    return { ok: true }
  } catch (error) {
    return { ok: false, why: `its folder could not be removed (${error?.code ?? error?.message ?? 'no answer'})` }
  }
}
