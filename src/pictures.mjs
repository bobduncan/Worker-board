// Pictures the board may show: the ones in the folders named in config.json (`pictureRoots`, by default the
// project's picture folder). A chat or the backlog only gives a path; whether it may be shown is decided here, on the
// real file, so nothing outside those folders can be asked for through the board.

import { readdir, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { picturePath } from './asks.mjs'
import { IDEAS_FOLDER } from './design.mjs'

/** An idea's reference picture in its folder (B156). */
const IDEA_REFERENCE = /^reference-[1-9]\.(png|jpg|webp)$/

const TYPES = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }
const PICTURE_BYTES = 12 * 1024 * 1024

const isShown = (path, roots) => roots.some(root => path === root || path.startsWith(`${root}/`))

/** A real path inside the project's shown folder it claims to be in, also after links are followed. Or null. */
async function inside(project, roots, path) {
  if (!isShown(path, roots)) return null
  try {
    const root = await realpath(join(project, path.split('/')[0]))
    const real = await realpath(join(project, path))
    return real === root || real.toLowerCase().startsWith(`${root.toLowerCase()}${sep}`) ? real : null
  } catch {
    return null
  }
}

/** The file to send for a picture's path, with its type and size, or null when the board may not show it. */
export async function findPicture(project, roots, value) {
  const path = picturePath(value)
  if (path === null) return null
  const file = await inside(project, roots, path)
  if (file === null) return null
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > PICTURE_BYTES) return null
    return { file, type: TYPES[path.split('.').pop().toLowerCase()], size: info.size }
  } catch {
    return null
  }
}

/** A folder's path as the backlog writes it ("pictures/red-mage"), cleaned, or null. */
function folderPath(value) {
  if (typeof value !== 'string' || /[\0:*?"<>|]/.test(value)) return null
  const parts = value.replace(/\\/g, '/').replace(/[/.]+$/, '').split('/')
  return parts.some(part => part === '' || part === '.' || part === '..') ? null : parts.join('/')
}

/**
 * The pictures a backlog step points to: the picture itself, or the newest pictures in the folder it names.
 * Paths are relative to the project, as `findPicture` takes them.
 */
export async function listPictures(project, roots, value, most = 6) {
  const single = picturePath(value)
  if (single !== null) return (await findPicture(project, roots, single)) === null ? [] : [single]
  const folder = folderPath(value)
  if (folder === null) return []
  const real = await inside(project, roots, folder)
  if (real === null) return []
  try {
    const names = (await readdir(real, { withFileTypes: true }))
      .filter(entry => entry.isFile() && picturePath(`${folder}/${entry.name}`) !== null)
      // B156: an idea's reference pictures are the person's own input, not what was made from it.
      .filter(entry => !(folder.startsWith(`${IDEAS_FOLDER}/`) && IDEA_REFERENCE.test(entry.name)))
      .map(entry => entry.name)
    const dated = await Promise.all(names.slice(0, 200).map(async name => ({ name, at: (await stat(join(real, name))).mtimeMs })))
    return dated.sort((a, b) => b.at - a.at).slice(0, most).map(({ name }) => `${folder}/${name}`)
  } catch {
    return []
  }
}

/** The paths into the shown folders that a text mentions, as the backlog does: "(pictures in pictures/red-mage)". */
export function mentionedPaths(text, roots) {
  const found = []
  for (const root of roots) {
    const pattern = new RegExp(`(?:^|[\\s("'])(${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[\\w./-]+)`, 'g')
    for (const match of text.matchAll(pattern)) {
      const path = match[1].replace(/[/.]+$/, '')
      if (!found.includes(path)) found.push(path)
    }
  }
  return found
}
