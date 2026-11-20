// T5.2 P2 (2026-11-16, the design `.claude/plans/2026-11-16-workerboard-design.md`, §3 and §4): the ONE place that says where the
// project's things live. Two PC-only settings decide it: `chatHome`, the folder the chats run in (memory, trust, settings.local.json,
// hooks, routines, the port, the Workers mod's board file, chat logs, task worktrees: '' means the project folder, as today), and
// `data`, the board's data home (`<project>/.workerboard` once the data moves; '' means today's layout, everything in the project
// folder). With both empty every answer here is exactly today's path, so the live board changes nothing when this lands
// (test/projectPaths.test.mjs proves it). P3 moves the store and the pictures through `dataOf`, `picturesOf` and `resolveStored`.
// PURE: no file is read here.

import { basename, isAbsolute, join, relative, resolve } from 'node:path'

import { workFolder } from './config.mjs'

const parts = path => String(path).split('/').filter(part => part !== '')
const slashes = path => String(path).replace(/\\/g, '/')
const isSet = value => typeof value === 'string' && value !== ''

/** The folder the chats run in: `chatHome`, else the project folder. '' when neither is set. */
export function chatHomeOf(config) {
  if (isSet(config.chatHome)) return config.chatHome
  return isSet(config.project) ? config.project : ''
}

/** The board's data home: `data`, or null for today's layout (everything in the project folder). */
export function dataOf(config) {
  return isSet(config.data) ? config.data : null
}

/** The folder the picture roots (`pictureRoots`) stand in: `<data>/pictures`, else the project folder. */
export function picturesOf(config) {
  const data = dataOf(config)
  return data === null ? config.project : join(data, 'pictures')
}

/** The asset requests' folder: `<data>/pictures/assets`, else `assets` beside the work store (`.claude/work` → `.claude/assets`). */
export function assetsOf(config) {
  const data = dataOf(config)
  return data === null ? join(workFolder(config), '..', 'assets') : join(data, 'pictures', 'assets')
}

/** The asset requests' stored prefix (`.claude/assets/`), from the work setting; null for a work folder of its own. */
export function assetsPrefixOf(config) {
  return isSet(config.work) && !isAbsolute(config.work) ? `${slashes(join(config.work, '..', 'assets'))}/` : null
}

/** A file of the chats' home under `.claude` (`board.json`, `launch.json`, `chats`, `chat-logs`, `settings.local.json`): the full path. */
export function chatFile(config, ...rest) {
  const home = chatHomeOf(config)
  return home === '' ? '' : join(home, '.claude', ...rest)
}

/** The folder of the chats' cards (`<chat home>/.claude/chats`), or '' without a home. */
export const chatsFolderOf = config => chatFile(config, 'chats')

/** The folder name the chats' routines are named after (the chat home's), or ''. */
export const routineFolderOf = config => (chatHomeOf(config) === '' ? '' : basename(resolve(chatHomeOf(config))))

/** The store's and the goal map's settings whose stored paths move under the data home, their names kept. */
const STORE_KEYS = ['work', 'goals', 'goalsHistory', 'brainstorms', 'goalAsks', 'designKinds']
/** The `.claude` folders that go under `<data>/docs`. */
const DOC_FOLDERS = ['plans', 'specs', 'handover']

/**
 * Where a stored path lives now (§4 Links): the store, the goal map, the plans and the records write paths relative to the project
 * folder as it was. With `data` empty this is `join(project, path)`, today's `inProject`, for every path. With `data` set: a picture
 * root or `.claude/assets/` under `<data>/pictures`; the store's and the goal map's paths under `<data>` with their stored names;
 * `.claude/plans|specs|handover` under `<data>/docs`; `logs/` under the chat home; `<project folder name>/...` in the game repo and
 * `<board folder name>/...` in the board folder (a path written from the wrapper, design.json); anything else stays under the
 * project folder. An absolute path is itself.
 */
export function resolveStored(config, stored, { boardDir = null } = {}) {
  const path = String(stored ?? '')
  if (path === '' || isAbsolute(path)) return path
  const data = dataOf(config)
  if (data === null) return join(config.project, ...parts(path))
  const game = isSet(config.gameRepo) ? config.gameRepo : config.project
  if (isSet(config.project) && path.startsWith(`${basename(resolve(config.project))}/`)) return join(game, ...parts(path).slice(1))
  if (isSet(boardDir) && path.startsWith(`${basename(resolve(boardDir))}/`)) return join(boardDir, ...parts(path).slice(1))
  for (const root of config.pictureRoots ?? []) if (path.startsWith(`${root}/`)) return join(picturesOf(config), ...parts(path))
  const assets = assetsPrefixOf(config)
  if (assets !== null && path.startsWith(assets)) return join(assetsOf(config), ...parts(path.slice(assets.length)))
  for (const name of DOC_FOLDERS) if (path.startsWith(`.claude/${name}/`)) return join(data, 'docs', ...parts(path.slice('.claude/'.length)))
  if (path.startsWith('logs/')) return join(chatHomeOf(config), ...parts(path))
  for (const key of STORE_KEYS) {
    const value = config[key]
    if (isSet(value) && !isAbsolute(value) && (path === value || path.startsWith(`${value}/`))) return join(data, ...parts(path))
  }
  return join(config.project, ...parts(path))
}

/**
 * A real path in the words to a chat: relative to the chat home, written with / (`.claude/work/B12.md` today); a path outside the
 * chat home, or one that is not absolute, stays as it is (with /).
 */
export function wordsPath(config, fullPath) {
  const home = chatHomeOf(config)
  const path = String(fullPath ?? '')
  if (home === '' || !isAbsolute(path)) return slashes(path)
  const rel = relative(resolve(home), resolve(path))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return slashes(path)
  return slashes(rel)
}
