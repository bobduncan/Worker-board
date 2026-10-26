// B218: a file a link in the game plan names, shown read-only in a window of the board: a text file or a picture,
// inside the game's folder only, and a small one. The person, 2026-10-14: "advisor game plan has links that dont work
// i want to be able to click them in the UI".

import { open, readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'

const TEXT = 'text/plain; charset=utf-8'
/** What the window shows, by the file's ending. Anything else is refused. */
const TYPES = {
  '.md': TEXT, '.txt': TEXT, '.json': TEXT, '.csv': TEXT, '.ts': TEXT, '.js': TEXT, '.mjs': TEXT, '.css': TEXT,
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}
const MOST_BYTES = 1_000_000
/** B426: a picture may be as large as the picture popup allows (src/pictures.mjs): a page's picture links open it here. */
const MOST_PICTURE_BYTES = 32 * 1024 * 1024

/**
 * Clear after each step: a chat's log (`.claude/chat-logs/<chat>/<time> <step>.txt`) may be far larger: its last
 * part is shown, under a line that says where the whole of it is.
 */
const LOG_FOLDER = '.claude/chat-logs/'
const MOST_LOG_BYTES = 2 * 1024 * 1024

/** The last `bytes` of a file as text, from the start of a line, under a line that names the whole file. */
async function logTail(file, size, bytes) {
  const handle = await open(file, 'r')
  try {
    const length = Math.min(bytes, size)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const shown = length === size ? buffer : buffer.subarray(buffer.indexOf(10) + 1)
    const note = `(The log is ${Math.round(size / (1024 * 1024))} MB: here its last ${Math.round(shown.length / 1024)} KB. The whole log: ${file})\n\n`
    return Buffer.concat([Buffer.from(note), shown])
  } finally {
    await handle.close()
  }
}

/** A path inside a folder, written with /: no root, no drive, no "." or "..", no backslash, no empty part. */
export const insidePath = path => typeof path === 'string' && path.length <= 300
  && /^[\w@+ .-]+(?:\/[\w@+ .-]+)*$/.test(path) && !path.split('/').some(part => part === '.' || part === '..')

/**
 * The file a link names: at `path` in the game's folder, else at `path` or `alt` in the project's folder (a plan may
 * write its links from there, and a file found there reads its own links from there): `{ type, body, where }`,
 * `where` saying which it was; null when none is one to show.
 */
export async function findGameFile({ gameRepo, project }, path, alt) {
  for (const [root, where] of [[gameRepo, path], [project, path], [project, alt]]) {
    if (typeof where !== 'string') continue
    const found = await readGameFile(root, where)
    if (found !== null) return { ...found, where }
  }
  return null
}

/**
 * The file at `path` in the folder `root`: `{ type, body }`, or null when it is not one to show. Its real place is
 * checked too, so a link in the folder that points out of it shows nothing.
 */
export async function readGameFile(root, path) {
  if (typeof root !== 'string' || root === '' || !insidePath(path)) return null
  const type = TYPES[extname(path).toLowerCase()]
  if (type === undefined) return null
  try {
    const base = await realpath(root)
    const file = await realpath(join(base, ...path.split('/')))
    const inside = relative(base, file)
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null
    const info = await stat(file)
    if (!info.isFile()) return null
    if (path.startsWith(LOG_FOLDER) && path.endsWith('.txt') && info.size > MOST_BYTES) return { type, body: await logTail(file, info.size, MOST_LOG_BYTES) }
    if (info.size > (type.startsWith('image/') ? MOST_PICTURE_BYTES : MOST_BYTES)) return null
    return { type, body: await readFile(file) }
  } catch {
    return null
  }
}
