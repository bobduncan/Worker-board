// B699: the goal demo the person sees before they answer "Did we reach the goal?". This checks the partner's helper's list and
// writes `demo.json` beside the pictures; the board draws it as a page (src/demo.mjs): per part its verdict (Reached, Not
// reached, Still open) and its row of labelled pictures, the follow-up last. Every picture stays its own file at its own pixel
// size (B686: one tall picture was 68.5 MiB, over the board's picture limit, and did not open). It knows nothing of the
// project's work.
//
//   node tools/demo.mjs --list list.json [--out demo.json]
//
// The list's form is in the head of src/demo.mjs. A picture path is absolute or relative to the list's folder. The tool stops
// and names a picture that is not there, one that is not a .png, .jpg, .webp or .gif, and one over the board's picture limit
// (the board would answer "too big"). In demo.json the pictures of a row stand in the demo's order and their paths are relative
// to demo.json's own folder. Without --out the file lands beside the list as demo.json (never over the list itself).
//
// T17.1 (the person, 2026-11-02: "the same pictures are provided and i see no evidence of what i asked it to fix/change"): the tool
// also reads the `feedback.json` beside the demo.json it writes. Every row the person sent back must show a new try or say it is not
// in yet: a "changed" line and at least one picture file written after that Send (or, for an answer in words, a note that differs
// from the one in the demo.json it replaces), else a "pending" line saying why. The tool stops and names each row that does not
// (one line per row), so old pictures cannot pass for a new try; it also stops on a row the person sent back that the list no longer
// has (a renamed title: keep it, or give the row an "id"). A row's "play" is the name of an arena the game has (its arenas folder and
// the dev folder in it, from the board's config.json "gameRepo"): a name it has not is refused.

import { existsSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PICTURE_BYTES } from '../src/pictures.mjs'
import { checkList, orderedPictures } from '../src/demo.mjs'
import { FEEDBACK_BYTES, FEEDBACK_FILE } from '../src/demoFeedback.mjs'

const BOARD = join(dirname(fileURLToPath(import.meta.url)), '..')
const TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
/** The game's arenas, from its repository's top: the folder of the arenas and the dev folder in it (`arena=<name>` is a file there). */
export const ARENA_FOLDERS = ['src/content/arenas', 'src/content/arenas/dev']

/**
 * Whether the game has an arena of that name, as a function, from the board's `gameRepo`; undefined when it cannot be told (no
 * game repository set, or none of the arenas folders there): then no name is checked. `exists` is `existsSync`.
 */
export function arenaCheckOf(gameRepo, exists = existsSync) {
  if (typeof gameRepo !== 'string' || gameRepo.trim() === '') return undefined
  const folders = ARENA_FOLDERS.map(folder => join(gameRepo, ...folder.split('/'))).filter(folder => exists(folder))
  return folders.length === 0 ? undefined : name => folders.some(folder => exists(join(folder, `${name}.json`)))
}

/** Every picture file the list names, as a path (absolute, or from `base`). */
export function pictureFiles(list, base) {
  const at = path => (isAbsolute(path) ? path : resolve(base, path))
  return (list.sections ?? []).flatMap(section => (section.rows ?? []).flatMap(row => [...(row.pictures ?? []), ...(row.grid ?? [])].map(one => at(one.path))))
}

/** Pictures that are not there, by their paths: the demo shows only files that exist. */
export function missingPictures(list, base, exists = existsSync) {
  return [...new Set(pictureFiles(list, base))].filter(file => !exists(file))
}

/** Pictures over the board's limit, by their paths and sizes in bytes: `[{ file, bytes }]`. */
export function tooBigPictures(list, base, sizeOf = file => statSync(file).size, most = PICTURE_BYTES) {
  return [...new Set(pictureFiles(list, base))].map(file => ({ file, bytes: sizeOf(file) })).filter(one => one.bytes > most)
}

/** The feedback.json beside the demo that is written (the person's rounds), or null for none; one that is not JSON is none too. */
export async function feedbackBeside(target) {
  try {
    const file = join(dirname(target), FEEDBACK_FILE)
    if (statSync(file).size > FEEDBACK_BYTES) return null
    return JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''))
  } catch {
    return null
  }
}

/** The demo.json about to be replaced, as `{ list, writtenAt }` (what the person saw last), or null when there is none or it is no JSON. */
export async function previousBeside(target) {
  try {
    return { list: JSON.parse((await readFile(target, 'utf8')).replace(/^﻿/, '')), writtenAt: statSync(target).mtimeMs }
  } catch {
    return null
  }
}

/** When a picture file was written (ms), or null when it is not there. */
export function writtenAt(path, base, stat = file => statSync(file).mtimeMs) {
  try { return stat(isAbsolute(path) ? path : resolve(base, path)) } catch { return null }
}

/** The list as demo.json holds it: each row's pictures in the demo's order, every path relative to `outDir` (from `base`). Pure. */
export function demoFile(list, base, outDir) {
  const at = path => (isAbsolute(path) ? path : resolve(base, path))
  const keep = one => ({ ...one, path: relative(outDir, at(one.path)).replace(/\\/g, '/') })
  return {
    ...list,
    sections: list.sections.map(section => ({
      ...section,
      rows: (section.rows ?? []).map(row => ({
        ...row,
        ...(Array.isArray(row.pictures) ? { pictures: orderedPictures(row.pictures).map(keep) } : {}),
        ...(Array.isArray(row.grid) ? { grid: row.grid.map(keep) } : {}),
      })),
    })),
  }
}

/**
 * Checks the list file and writes demo.json (beside the list as demo.json without `out`); answers where and how many pictures.
 * `hasArena(name)` (`arenaCheckOf`) says whether the game has an arena; without it no `play` name is looked up.
 */
export async function writeDemo({ listFile, out, hasArena = undefined }) {
  const file = resolve(listFile)
  const input = checkList(JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')))
  const base = dirname(file)
  const target = out === undefined ? resolve(base, 'demo.json') : resolve(out)
  if (target === file) throw new Error('demo.json is written beside the list under another name: --out is not the list itself.')
  const gone = missingPictures(input, base)
  if (gone.length > 0) throw new Error(`These pictures are not there; the demo shows only files that exist:\n${gone.map(one => `  ${one}`).join('\n')}`)
  for (const picture of pictureFiles(input, base)) if (!TYPES.has(extname(picture).toLowerCase())) throw new Error(`${basename(picture)}: a picture is a .png, .jpg, .webp or .gif.`)
  const big = tooBigPictures(input, base)
  if (big.length > 0) throw new Error(`These pictures are over the board's limit of ${PICTURE_BYTES / 1048576} MB, so it would not open them:\n${big.map(one => `  ${one.file} (${(one.bytes / 1048576).toFixed(1)} MB)`).join('\n')}`)
  checkList(input, { feedback: await feedbackBeside(target), mtimeOf: path => writtenAt(path, base), previous: await previousBeside(target), hasArena })
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(demoFile(input, base, dirname(target)), null, 2)}\n`)
  return { out: target, pictures: new Set(pictureFiles(input, base)).size }
}

function argsOf(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '')
    if (!argv[i].startsWith('--') || !['list', 'out'].includes(name)) throw new Error(`Unknown argument ${argv[i]}.`)
    if (argv[i + 1] === undefined) throw new Error(`--${name} needs a value.`)
    args[name] = argv[i + 1]
  }
  if (args.list === undefined) throw new Error('--list is needed: the JSON list of the demo.')
  return args
}

function isCommand() {
  if (process.argv[1] === undefined) return false
  const same = path => { const real = realpathSync(resolve(path)); return process.platform === 'win32' ? real.toLowerCase() : real }
  try { return same(process.argv[1]) === same(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isCommand()) {
  const args = argsOf(process.argv.slice(2))
  const gameRepo = await import('../src/config.mjs').then(({ loadConfig }) => loadConfig(join(BOARD, 'config.json'))).then(config => config.gameRepo, () => '')
  writeDemo({ listFile: args.list, out: args.out, hasArena: arenaCheckOf(gameRepo) })
    .then(done => console.log(`saved ${done.out} (${done.pictures} pictures, each at its own size)`))
    .catch(error => { console.error(error.message); process.exit(1) })
}
