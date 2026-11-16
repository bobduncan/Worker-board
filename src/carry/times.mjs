// T5 B1: the files' times. Git keeps no mtime, and the board reads some by time (sources.mjs reads the two plan docs; the keep
// set's `made` time bounds the pictures), so save writes `times.json` (relative path, mtimeMs, blob id) and load restores each
// file's mtime where its blob id still matches: a file that changed keeps its own time.

import { utimes } from 'node:fs/promises'

/** The times entry of each carried file: `{ path, mtimeMs, blob }` (paths with forward slashes). */
export function timesOf(files) {
  return files.filter(one => typeof one?.to === 'string' && Number.isFinite(one.mtimeMs) && typeof one.blob === 'string')
    .map(one => ({ path: one.to.replace(/\\/g, '/'), mtimeMs: one.mtimeMs, blob: one.blob }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** `times.json` read: the entries, or [] for anything else. */
export function parseTimes(text) {
  try {
    const raw = JSON.parse(String(text ?? ''))
    const list = Array.isArray(raw?.files) ? raw.files : Array.isArray(raw) ? raw : []
    return list.filter(one => typeof one?.path === 'string' && Number.isFinite(one.mtimeMs) && typeof one.blob === 'string')
  } catch {
    return []
  }
}

/**
 * Restores the mtime of each entry whose target (`targetOf(path)`, absolute or null to skip) holds the same blob: `{ restored, kept,
 * missing }` as counts and paths. `blobOfFile(file)` and `fs.utimes` for tests. A CRLF checkout changes a text file's blob: then the
 * time is kept, never set on content that is not the saved one.
 */
export async function restoreTimes(entries, { targetOf, blobOfFile, fs = { utimes }, journal = () => {} }) {
  const restored = []
  const kept = []
  const missing = []
  for (const entry of entries) {
    const target = targetOf(entry.path)
    if (target === null || target === undefined) continue
    const blob = await blobOfFile(target)
    if (blob === null) { missing.push(entry.path); continue }
    if (blob !== entry.blob) { kept.push(entry.path); continue }
    const when = new Date(entry.mtimeMs)
    await fs.utimes(target, when, when)
    journal(target)
    restored.push(entry.path)
  }
  return { restored, kept, missing }
}
