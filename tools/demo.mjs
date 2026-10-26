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

import { existsSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PICTURE_BYTES } from '../src/pictures.mjs'
import { checkList, orderedPictures } from '../src/demo.mjs'

const TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

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

/** Checks the list file and writes demo.json (beside the list as demo.json without `out`); answers where and how many pictures. */
export async function writeDemo({ listFile, out }) {
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
  writeDemo({ listFile: args.list, out: args.out })
    .then(done => console.log(`saved ${done.out} (${done.pictures} pictures, each at its own size)`))
    .catch(error => { console.error(error.message); process.exit(1) })
}
