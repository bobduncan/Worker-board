// Worktree clean-up (the person, 2026-10-24): what the board's sync check "leftover worktrees" would do now, as a
// list only: nothing is removed. A line per leftover: "Would clean: ..." (what the board removes at its next run) or
// "Left: ..." (what it leaves, with why). The board's own run removes the safe ones (src/work/sync.mjs, `worktrees`).
//
//   node tools/leftover-worktrees.mjs [--config <the board's config.json>] [--board <the board's folder>]
//
// Without --config it reads this board's config.json; without --board it takes this board's folder as the board's own
// repository, as the running board does (give the folder of the board the person runs to see what that one does).

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig, workFolder } from '../src/config.mjs'
import { gitRunner } from '../src/folders.mjs'
import { readStore } from '../src/work/store.mjs'
import { findLeftovers } from '../src/work/worktrees.mjs'

const BOARD = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The command's arguments: `{ config, board }`; it throws with the reason on a wrong one. */
export function parseArgs(argv) {
  const args = { config: join(BOARD, 'config.json'), board: BOARD }
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '')
    if (!argv[i].startsWith('--') || !['config', 'board'].includes(name)) throw new Error(`Unknown argument ${argv[i]}.`)
    if (argv[i + 1] === undefined) throw new Error(`--${name} needs a value.`)
    args[name] = resolve(argv[i + 1])
  }
  return args
}

/** The lines of what `findLeftovers` found, in its order. */
export function leftoverLines(found) {
  const plain = path => String(path).replace(/\\/g, '/')
  return found.map(one => (one.clean === true ? `Would clean: ${plain(one.path)}: ${one.what}` : `Left: ${plain(one.path)} (${one.what}): ${one.why}`))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { config: file, board } = parseArgs(process.argv.slice(2))
    const config = await loadConfig(file)
    if (config.project === '') throw new Error(`${file} names no project folder.`)
    const hasGame = config.gameRepo !== ''
    const repos = [...(hasGame ? [{ dir: config.gameRepo, base: config.baseBranch }] : []), { dir: board, base: 'main' }]
    const { items } = await readStore(workFolder(config))
    const found = await findLeftovers({ repos, project: config.project, items, run: gitRunner(), keep: [board, config.project, ...(hasGame ? [config.gameRepo] : [])] })
    const lines = leftoverLines(found)
    console.log(lines.length === 0 ? 'No leftover worktree.' : lines.join('\n'))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
