// The asset provider for sound effects: a folder of sounds in the project, from which a chat picks a file (mode
// "pick"). Part 2 answers a request with the folder; the chat names its pick.

import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

/** The files that count as a sound. */
export const SOUND_FILES = /\.(wav|mp3|ogg|flac)$/i
/** How deep into the library's folders a sound is looked for. */
const DEPTH = 4
/** The count stops here: a library this big is "10,000+ sounds" and counting on would only make the check slow. */
export const COUNT_STOP = 10_000

/**
 * How many sound files `folder` holds, in itself and in the folders inside it (at most DEPTH deep), counted up to `stop`.
 * `seen.count` is the running count, so the folders below add to it.
 */
async function countSounds(folder, seen, depth = 0) {
  const entries = await readdir(folder, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && SOUND_FILES.test(entry.name) && ++seen.count >= COUNT_STOP) return
  }
  if (depth >= DEPTH) return
  for (const entry of entries) {
    if (seen.count >= COUNT_STOP) return
    if (entry.isDirectory()) await countSounds(join(folder, entry.name), seen, depth + 1)
  }
}

/** The count as the card's words: "347 sounds found", "10,000+ sounds found". */
const found = count => (count >= COUNT_STOP ? `${COUNT_STOP.toLocaleString('en-US')}+ sounds found` : `${count.toLocaleString('en-US')} ${count === 1 ? 'sound' : 'sounds'} found`)

export const soundLibrary = {
  name: 'sound-library',
  mode: 'pick',
  kinds: ['sound effect'],
  /** The library's folder inside the project, written with /, when the settings name none. Only this provider has one. */
  folder: 'sound-library',
  card: { title: 'Free library', line: 'Sonniss game-audio bundles on this PC', facts: ['Free · commercial use', 'You pick on the sound board'], icon: 'library' },
  /**
   * Whether the library's folder (`tools.folder`, inside `tools.project`) is there and holds a sound file; `detail` counts
   * the sound files (up to COUNT_STOP). It makes nothing and never throws.
   */
  async check({ project = '', folder = soundLibrary.folder } = {}) {
    if (typeof project !== 'string' || project === '') return { ok: false, state: 'needs', why: 'config.json names no project', detail: 'No project set' }
    const path = join(project, ...String(folder).split('/'))
    const out = relative(project, path)
    if (out === '' || out.startsWith('..') || isAbsolute(out)) return { ok: false, state: 'needs', why: `The sound library folder "${folder}" is not inside the project`, detail: 'Folder is outside the project' }
    try {
      const seen = { count: 0 }
      await countSounds(path, seen)
      return seen.count > 0
        ? { ok: true, state: 'works', why: `The sound library folder "${folder}" holds sounds`, detail: found(seen.count) }
        : { ok: false, state: 'needs', why: `The sound library folder "${folder}" holds no sound file (.wav, .mp3, .ogg, .flac)`, detail: 'No sounds found' }
    } catch (error) {
      return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
        ? { ok: false, state: 'needs', why: `The sound library folder "${folder}" is not there`, detail: 'Folder not found' }
        : { ok: false, state: 'needs', why: `The sound library folder "${folder}" could not be read`, detail: 'Folder not readable' }
    }
  },
}
