// B218: a file a link in the game plan names, shown read-only in a window of the board: a text file or a picture,
// inside the game's folder only, and a small one. The person, 2026-10-14: "advisor game plan has links that dont work
// i want to be able to click them in the UI".

import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'

const TEXT = 'text/plain; charset=utf-8'
/** What the window shows, by the file's ending. Anything else is refused. */
const TYPES = {
  '.md': TEXT, '.txt': TEXT, '.json': TEXT, '.csv': TEXT, '.ts': TEXT, '.js': TEXT, '.mjs': TEXT, '.css': TEXT,
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}
const MOST_BYTES = 1_000_000

/** A path inside a folder, written with /: no root, no drive, no "." or "..", no backslash, no empty part. */
export const insidePath = path => typeof path === 'string' && path.length <= 300
  && /^[\w@+ .-]+(?:\/[\w@+ .-]+)*$/.test(path) && !path.split('/').some(part => part === '.' || part === '..')

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
    if (!info.isFile() || info.size > MOST_BYTES) return null
    return { type, body: await readFile(file) }
  } catch {
    return null
  }
}
