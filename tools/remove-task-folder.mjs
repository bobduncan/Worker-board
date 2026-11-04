// B947 (2026-11-02): removing a task folder must never follow a link in it into what it points to. A
// worktree's `node_modules` is a junction to the main checkout's packages; `git worktree remove` (and `rm -rf`) on a
// folder that still held it emptied the person's own node_modules four times. This is the one way to take a task folder
// away: it refuses while a program stands in the folder, takes every link away alone (the link, never its target), then
// removes the worktree (never --force) and the empty folder, and checks each link's target kept its entries.
//
//   node tools/remove-task-folder.mjs <folder>
//
// It is a thin command on src/work/worktrees.mjs (findLink, unlinkLink, cleanLeftover) and holders.mjs (folderHolders,
// holderWords): no second copy of that code. A folder that is no worktree gets its links taken away and is left for the
// caller to remove (it holds none now, so rm -rf is safe).

import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { folderHolders, holderWords } from '../src/work/holders.mjs'
import { cleanLeftover, FILES, findLink, gitWrite, unlinkLink } from '../src/work/worktrees.mjs'

/** Most links taken from one folder before the command gives up (a runaway walk, never a real task folder). */
const LINKS_MAX = 50

/** The text git printed for `args`, or null when it failed. */
const gitRead = args => new Promise(done => {
  execFile('git', args, { timeout: 30_000, windowsHide: true }, (error, stdout) => done(error === null ? stdout.trim() : null))
})

/** Where a link points (its real path), or null when that is not known (a dangling link, no access). */
const targetOf = async (at, real) => real(at).catch(() => null)

/** How many entries the folder `target` holds now, or null when that is not known. */
const countIn = async (target, fs) => (target === null ? null : fs.entries(target).then(list => list.length, () => null))

/** The main repository's folder of the worktree `folder`, or null when `folder` is no worktree. */
async function repoOf(folder, git) {
  const common = await git(['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (common === null || common === '') return null
  const slashed = common.replace(/\\/g, '/').replace(/\/+$/, '')
  return slashed.endsWith('/.git') ? slashed.slice(0, -'/.git'.length) : null
}

/**
 * Takes the task folder `folder` away. `{ ok, lines }`: `lines` say what happened, one each; `ok` false when it stopped
 * (and nothing past that point was done).
 */
export async function removeTaskFolder(folder, { fs = FILES, git = gitWrite, read = gitRead, holders = folderHolders, real = realpath, platform = process.platform } = {}) {
  const lines = []
  const stop = why => ({ ok: false, lines: [...lines, why] })
  const path = resolve(folder)
  const self = await fs.lstat(path).catch(() => null)
  if (self === null) return { ok: true, lines: [`${path} is already gone.`] }
  if (self.isSymbolicLink() || !self.isDirectory()) return stop(`${path} is a link or no folder: nothing was removed. Take a link away alone (cmd /c rmdir "${path}").`)

  const standing = await holders(path, { platform })
  if (Array.isArray(standing) && standing.length > 0) return stop(`A program stands in ${path}${holderWords(standing)}: nothing was removed.`)

  const kept = []
  for (let n = 0; n <= LINKS_MAX; n += 1) {
    const { link, isUnknown } = await findLink(path, fs)
    if (isUnknown) return stop(`${path} could not be looked through to its end: nothing more was removed.`)
    if (link === null) break
    if (n === LINKS_MAX) return stop(`${path} holds more than ${LINKS_MAX} links: nothing more was removed.`)
    const at = join(path, ...link.split('/'))
    const target = await targetOf(at, real)
    const before = await countIn(target, fs)
    const taken = await unlinkLink(at, fs)
    if (!taken.ok) return stop(`${at}: ${taken.why}: nothing more was removed.`)
    kept.push({ at, target, before })
    lines.push(`Took the link ${link} away (its target was not touched).`)
  }

  const repo = await repoOf(path, read)
  if (repo === null) {
    lines.push(`${path} is no git worktree: it holds no link now, remove it yourself.`)
    return { ok: true, lines }
  }
  const removed = await cleanLeftover({ kind: 'worktree', clean: true, path, repo }, { git, fs, platform })
  if (!removed.ok) return stop(`The worktree ${path} was not removed: ${removed.why}.`)
  await git(['-C', repo, 'worktree', 'prune'])
  lines.push(`Removed the worktree ${path}.`)

  for (const { at, target, before } of kept) {
    const after = await countIn(target, fs)
    if (before !== null && after !== before) return stop(`The target of ${at} held ${before} entries before and ${after} now: look at it at once.`)
  }
  return { ok: true, lines }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [folder, ...extra] = process.argv.slice(2)
  if (folder === undefined || extra.length > 0) {
    console.error(`Usage: node ${join(dirname(fileURLToPath(import.meta.url)), 'remove-task-folder.mjs')} <folder>`)
    process.exit(2)
  }
  const { ok, lines } = await removeTaskFolder(folder)
  console.log(lines.join('\n'))
  process.exit(ok ? 0 : 1)
}
