// T5 B1: the PC-local record of the carry commands: `<board folder>/data/carry.json` for the default data folder (the board repo
// ignores data/), `<data folder>.carry.json` beside an explicit `--data` folder (a rehearsal on scratch roots never writes, or
// becomes, the live defaults). It remembers the Drive folder and the keep set from their last use, and the last sync: its kind
// (practice or final), time, branch, commit and the blob ids written, so the next save knows whether origin moved on and the next
// load knows what this PC changed since.

import { readFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'

import { writeAtomic } from '../write.mjs'

/** Where the record lives: beside an explicit data folder, else in the board folder's data. */
export function recordFileFor({ boardDir, dataDir, isExplicit }) {
  return isExplicit ? `${dataDir.replace(/[\\/]+$/, '')}.carry.json` : join(boardDir, 'data', 'carry.json')
}

/**
 * The record read: `{ picturesHome, keepSet, last, synced }`, each null (synced: `{}`) when not there; an unreadable file is an empty
 * record. `synced` is the commit this PC last saw on each data branch (`{ 'workerboard-data': <sha>, ... }`): a practice save after a
 * final load must not forget the final branch's sync.
 */
export async function readRecord(file, fs = { readFile }) {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    return parseRecord(raw)
  } catch {
    return parseRecord(null)
  }
}

export function parseRecord(raw) {
  const text = value => (typeof value === 'string' && value !== '' ? value : null)
  const last = raw?.last !== null && typeof raw?.last === 'object' ? raw.last : null
  return {
    picturesHome: text(raw?.picturesHome),
    keepSet: text(raw?.keepSet),
    synced: raw?.synced !== null && typeof raw?.synced === 'object' ? Object.fromEntries(Object.entries(raw.synced).filter(([, id]) => typeof id === 'string')) : {},
    last: last === null ? null : {
      kind: last.kind === 'practice' ? 'practice' : 'final',
      command: last.command === 'load' ? 'load' : 'save',
      at: Number.isFinite(last.at) ? last.at : null,
      branch: text(last.branch),
      commit: text(last.commit),
      blobs: last.blobs !== null && typeof last.blobs === 'object' ? Object.fromEntries(Object.entries(last.blobs).filter(([, id]) => typeof id === 'string')) : {},
    },
  }
}

/** Writes the record (writeAtomic: never a torn file). A `fs` without the atomic write's calls (rename, open) is a plain one: writeAtomic's own then. */
export async function writeRecord(file, record, fs = undefined) {
  const text = `${JSON.stringify(record, null, 2)}\n`
  await (fs?.mkdir ?? mkdir)(dirname(file), { recursive: true })
  if (fs === undefined || typeof fs.rename !== 'function') return writeAtomic(file, text)
  return writeAtomic(file, text, fs)
}
