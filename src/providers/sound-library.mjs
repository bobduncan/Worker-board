// The asset provider for sound effects: a folder of sounds in the project, from which a chat picks a file (mode
// "pick"). Part 2 answers a request with the folder; the chat names its pick.

import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

/** The files that count as a sound. */
export const SOUND_FILES = /\.(wav|mp3|ogg|flac)$/i
/** How deep into the library's folders a sound is looked for. */
const DEPTH = 4

/** Whether `folder` holds a sound file, in itself or in a folder inside it (at most DEPTH deep). */
async function hasSound(folder, depth = 0) {
  const entries = await readdir(folder, { withFileTypes: true })
  if (entries.some(entry => entry.isFile() && SOUND_FILES.test(entry.name))) return true
  if (depth >= DEPTH) return false
  for (const entry of entries) if (entry.isDirectory() && await hasSound(join(folder, entry.name), depth + 1)) return true
  return false
}

export const soundLibrary = {
  name: 'sound-library',
  mode: 'pick',
  kinds: ['sound effect'],
  /** The library's folder inside the project, written with /, when the settings name none. Only this provider has one. */
  folder: 'sound-library',
  /**
   * Whether the library's folder (`tools.folder`, inside `tools.project`) is there and holds a sound file. It makes
   * nothing and never throws.
   */
  async check({ project = '', folder = soundLibrary.folder } = {}) {
    if (typeof project !== 'string' || project === '') return { ok: false, why: 'config.json names no project' }
    const path = join(project, ...String(folder).split('/'))
    const out = relative(project, path)
    if (out === '' || out.startsWith('..') || isAbsolute(out)) return { ok: false, why: `The sound library folder "${folder}" is not inside the project` }
    try {
      return (await hasSound(path))
        ? { ok: true, why: `The sound library folder "${folder}" holds sounds` }
        : { ok: false, why: `The sound library folder "${folder}" holds no sound file (.wav, .mp3, .ogg, .flac)` }
    } catch (error) {
      return { ok: false, why: error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? `The sound library folder "${folder}" is not there` : `The sound library folder "${folder}" could not be read` }
    }
  },
}
