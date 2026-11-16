// T5 (save/load between PCs), B2: what travels. Reading only: it lists the files, it never copies or writes.
import * as nodeFs from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ASSET_ID, REQUEST_FILE, assetsFolderOf } from '../assets.mjs'

/** A text over this many bytes is not carried. */
export const MAX_BYTES = 10 * 1024 * 1024

/** The store's files that are rebuilt per PC, or leftovers of writes. */
const STORE_OUT = /^(?:names\.json|delivered\.json|view\.json)$|\.claim$|\.tmp$|\.broken-|\.bak-|\.before-/
/** `.claude`'s top-level files that are runtime files of this PC (board.json holds the bridge key). */
const CLAUDE_OUT = /^(?:board\.json|launch\.json.*|limit-readings\.json|board-errors\.log)$|^sync|^supervisor|^backlog|\.lock$|^scratch-|\.before-/
/** `.claude` folders that travel whole. */
const CLAUDE_FOLDERS = ['plans', 'specs', 'handover', 'hooks']
/** The board data files that travel, each when it exists. */
const BOARD_DATA = ['finished.json', 'refine-gate.json', 'task-times.json', 'ideas.json', 'recaps.json', 'rounds.json', 'plan-writes.json']
/** The demo, feedback and list files of a picture root: exactly these names, up to 3 folders below the root. */
const DEMO_FILES = ['demo.json', 'feedback.json', 'list.json']
/** The settings that never travel. */
const LOCAL_SETTINGS = ['appSessions', 'usageHistory', 'transcripts', 'picturesHome']

const slash = path => path.split(sep).join('/')
const absolute = (project, path) => (isAbsolute(path) ? resolve(path) : resolve(project, ...String(path).split('/')))
const inside = (base, path) => {
  const rel = relative(base, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** The entries of a folder, or none when it is not there. */
async function list(fs, dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
}

/** Every file below `dir` (down `depth` folders), absolute, sorted. */
async function walk(fs, dir, depth = Infinity) {
  const out = []
  for (const entry of (await list(fs, dir)).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { if (depth > 0) out.push(...(await walk(fs, full, depth - 1))) }
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/**
 * The files that travel: `{ files: [{ from, to, kind, size, mtimeMs }], skipped: [{ path, why }] }`. `from` is absolute on
 * this PC, `to` relative to the data folder (forward slashes). `kind`: store, goals, board, home, memory or record.
 */
export async function carrySet({ config, project = config.project, boardDir, memoryDir, fs = nodeFs } = {}) {
  const files = []
  const skipped = []
  const seen = new Set()

  /** Adds one file under `to`; the first kind to claim a `to` keeps it. A file that is not there is no error and no line. */
  async function add(from, to, kind) {
    if (seen.has(to)) return
    seen.add(to)
    let info
    try {
      info = await fs.stat(from)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return
      throw error
    }
    if (!info.isFile()) return
    if (info.size > MAX_BYTES) return void skipped.push({ path: slash(from), why: 'over 10 MB' })
    files.push({ from: slash(from), to, kind, size: info.size, mtimeMs: info.mtimeMs })
  }
  const addHome = (from, kind) => add(from, `home/${slash(relative(project, from))}`, kind)
  /** A path of the config: inside the project, else skipped with its why. Returns the absolute path or null. */
  function placed(key, value) {
    const path = absolute(project, value)
    if (inside(project, path)) return path
    skipped.push({ path: slash(path), why: `config ${key} lies outside the project` })
    return null
  }

  // the store
  const workDir = placed('work', config.work ?? '.claude/work')
  if (workDir) {
    for (const entry of await list(fs, workDir)) {
      if (entry.isFile() && !STORE_OUT.test(entry.name)) await addHome(join(workDir, entry.name), 'store')
    }
  }

  // the goal map
  for (const [key, fallback, folder] of [['goals', '.claude/goals.md', false], ['goalsHistory', '.claude/goals.history', true], ['brainstorms', '.claude/brainstorms', true], ['goalAsks', '.claude/goal-asks', true], ['designKinds', '.claude/design.json', false]]) {
    const path = placed(key, config[key] ?? fallback)
    if (!path) continue
    if (folder) for (const file of await walk(fs, path)) await addHome(file, 'goals')
    else await addHome(path, 'goals')
  }

  // board data
  if (boardDir) {
    for (const name of BOARD_DATA) await add(join(boardDir, 'data', name), `board/data/${name}`, 'board')
  }

  // home files, by rule
  const claudeDir = join(project, '.claude')
  for (const entry of await list(fs, project)) if (entry.isFile()) await addHome(join(project, entry.name), 'home')
  for (const entry of await list(fs, claudeDir)) {
    if (entry.isFile() && !CLAUDE_OUT.test(entry.name)) await addHome(join(claudeDir, entry.name), 'home')
  }
  for (const folder of CLAUDE_FOLDERS) for (const file of await walk(fs, join(claudeDir, folder))) await addHome(file, 'home')
  await addHome(join(claudeDir, 'chats', 'list.json'), 'home')
  for (const file of await walk(fs, join(project, '.codex'))) await addHome(file, 'home')

  // memory
  if (memoryDir) {
    for (const file of await walk(fs, memoryDir)) await add(file, `memory/${slash(relative(memoryDir, file))}`, 'memory')
  }

  // records: the asset requests and their prompts (a request without a prompt still travels), and the picture roots' demo, feedback and list files
  if (workDir) {
    const assets = assetsFolderOf(workDir)
    if (inside(project, assets)) {
      for (const folder of await list(fs, assets)) {
        if (!folder.isDirectory() || !ASSET_ID.test(folder.name)) continue
        for (const entry of await list(fs, join(assets, folder.name))) {
          if (entry.isFile() && (entry.name === REQUEST_FILE || entry.name.endsWith('.prompt.txt'))) await addHome(join(assets, folder.name, entry.name), 'record')
        }
      }
    } else skipped.push({ path: slash(assets), why: 'the asset folder lies outside the project' })
  }
  for (const root of config.pictureRoots ?? ['pictures']) {
    const rootDir = placed('pictureRoots', root)
    if (!rootDir) continue
    for (const file of await walk(fs, rootDir, 3)) {
      if (DEMO_FILES.includes(slash(file).split('/').pop())) await addHome(file, 'record')
    }
  }
  return { files, skipped }
}

/** The absolute path on this PC of a carried file, or null for `settings/*` (and for a path that leaves its folder). */
export function targetOf(to, { project, boardDir, memoryDir } = {}) {
  const [head, ...rest] = String(to).split('/')
  const base = { home: project, board: boardDir, memory: memoryDir }[head]
  if (!base || rest.length === 0 || rest.some(part => part === '' || part === '..')) return null
  return join(base, ...rest)
}

/** The object for `settings/config.json`: no appSessions, usageHistory, transcripts or picturesHome; project and gameRepo relative to the board folder. */
export function carriedSettings(config, { boardDir } = {}) {
  const carried = { ...config }
  for (const key of LOCAL_SETTINGS) delete carried[key]
  for (const key of ['project', 'gameRepo']) {
    if (typeof carried[key] === 'string') carried[key] = slash(relative(boardDir, carried[key])) || '.'
  }
  return carried
}

/** This PC's config object from the carried one: project and gameRepo resolved against this board folder; its own port, gamePort and local settings kept. */
export function settingsFromCarry(carried, { project, boardDir, current = {} } = {}) {
  const config = { ...carried }
  config.project = typeof carried.project === 'string' ? resolve(boardDir, carried.project) : project
  if (typeof carried.gameRepo === 'string') config.gameRepo = resolve(boardDir, carried.gameRepo)
  for (const key of ['port', 'gamePort']) if (current[key] !== undefined) config[key] = current[key]
  for (const key of LOCAL_SETTINGS) if (current[key] !== undefined) config[key] = current[key]
  return config
}

const lines = value => (Array.isArray(value) ? value.filter(line => typeof line === 'string') : [])

/** From the user's settings, only `{ defaultMode, allow, autoMode }` (autoMode: allow and environment). Never hooks, plugins or the rest. */
export function carriedUserSettings(userSettings = {}) {
  const carried = { allow: lines(userSettings.permissions?.allow) }
  if (typeof userSettings.permissions?.defaultMode === 'string') carried.defaultMode = userSettings.permissions.defaultMode
  if (userSettings.autoMode && typeof userSettings.autoMode === 'object') {
    carried.autoMode = { allow: lines(userSettings.autoMode.allow), environment: lines(userSettings.autoMode.environment) }
  }
  return carried
}

/** The other PC's settings plus the carried lines they lack (order kept, no duplicates): `{ merged, added }`, `added` the lines for load to print. */
export function mergeUserSettings(theirs = {}, carried = {}) {
  const merged = structuredClone(theirs)
  const added = []
  const addLines = (target, key, wanted, label) => {
    for (const line of lines(wanted)) {
      if (!Array.isArray(target[key])) target[key] = []
      if (target[key].includes(line)) continue
      target[key].push(line)
      added.push(`${label}: ${line}`)
    }
  }
  merged.permissions = { ...(merged.permissions ?? {}) }
  addLines(merged.permissions, 'allow', carried.allow, 'permissions.allow')
  if (carried.defaultMode && !merged.permissions.defaultMode) {
    merged.permissions.defaultMode = carried.defaultMode
    added.push(`permissions.defaultMode: ${carried.defaultMode}`)
  }
  if (carried.autoMode) {
    merged.autoMode = { ...(merged.autoMode ?? {}) }
    addLines(merged.autoMode, 'allow', carried.autoMode.allow, 'autoMode.allow')
    addLines(merged.autoMode, 'environment', carried.autoMode.environment, 'autoMode.environment')
  }
  return { merged, added }
}
