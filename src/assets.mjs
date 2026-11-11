// Asset requests (spec 2026-10-25-asset-providers-design.md, part 2; spec 2026-11-01, part 4 "Roles use the chosen
// provider"): a chat asks the board for a picture, a track or a sound (the work tool's `asset`), and the board keeps each
// request in a folder of its own, `.claude/assets/A<n>/` of the project (beside the work store's `.claude/work`):
// `request.json` and every file the provider gave (`1.png`, `2.png`, ...). Not a backlog item: nothing on the Backlog tab.
//
// This module only keeps the requests: a new one, one read, the list, a change. Who provides and when is the work API's
// (`asset`) and the board's queue's (src/assetQueue.mjs). Every write is whole or not there (write.mjs `writeAtomic`), and
// the writes of one folder go one after the other, so two requests never get the same id and two changes of one request
// never cross.
//
// request.json:
//   { id, who, of, kind, provider, mode, text, pictures, follows, state, why, files, ask, pick, times: { asked, started, ended } }
//   who       the chat that asked (the board's own requests: "server")
//   of        its step (B<n>), or null
//   provider  the provider in use for the kind when it was asked (a later switch on the Settings tab leaves it as it is)
//   mode      that provider's mode: auto, person or pick
//   pictures  whole paths of the reference pictures, in order
//   follows   the earlier request (A<n>) this is the next iteration of, or null
//   state     waiting, running, ready or failed; `why` says why it failed ('' otherwise)
//   files     the names of the provider's files in the folder, once ready
//   ask       the person's ask (Q<n>) of a person provider, or null
//   pick      the library folder a pick provider named, or null
//   limit     `{ until, why, at }` while the request waits for its provider's usage limit to reset (the asset-limit wait,
//             2026-11-11, src/work/providerLimit.mjs), else absent or null; `limitTries` how often it waited so far while it runs

import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { writeAtomic } from './write.mjs'

/** The id of a request. */
export const ASSET_ID = /^A\d+$/
/** The states of a request, in the order it goes through them. */
export const ASSET_STATES = Object.freeze(['waiting', 'running', 'ready', 'failed'])
/** The file in a request's folder that holds the request itself. */
export const REQUEST_FILE = 'request.json'

/** The folder of the asset requests: `assets` beside the work store's folder (`.claude/work` → `.claude/assets`). */
export const assetsFolderOf = workDir => join(dirname(workDir), 'assets')

/** The folder of one request. */
export const assetFolder = (dir, id) => join(dir, id)

const numberOf = id => Number(String(id).slice(1))

/** One write after the other per folder of requests (as the work store's `serial`). */
const turns = new Map()
function inTurn(dir, run) {
  const turn = (turns.get(dir) ?? Promise.resolve()).then(run, run)
  turns.set(dir, turn.catch(() => {}))
  return turn
}

/** The ids of the requests in `dir`, oldest first; none when the folder is not there yet. */
async function idsIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  return entries.filter(entry => entry.isDirectory() && ASSET_ID.test(entry.name)).map(entry => entry.name).sort((a, b) => numberOf(a) - numberOf(b))
}

const write = (dir, record) => writeAtomic(join(assetFolder(dir, record.id), REQUEST_FILE), `${JSON.stringify(record, null, 2)}\n`)

/**
 * A new request in `dir`, `A<n>` with n one more than the highest there: its folder is made and its request.json written,
 * state waiting. `fields`: `who`, `of`, `kind`, `provider`, `mode`, `text`, `pictures`, `follows`. Answers the record.
 * Throws when it cannot be written (the work API answers that as its own refusal).
 */
export function newAsset(dir, fields, now = Date.now()) {
  return inTurn(dir, async () => {
    await mkdir(dir, { recursive: true })
    const ids = await idsIn(dir)
    const id = `A${ids.length === 0 ? 1 : numberOf(ids.at(-1)) + 1}`
    await mkdir(assetFolder(dir, id))
    const record = {
      id, who: fields.who ?? 'server', of: fields.of ?? null, kind: fields.kind, provider: fields.provider, mode: fields.mode,
      text: fields.text ?? '', pictures: fields.pictures ?? [], follows: fields.follows ?? null,
      state: 'waiting', why: '', files: [], ask: null, pick: null, times: { asked: now, started: null, ended: null },
    }
    await write(dir, record)
    return record
  })
}

/** The request `id` in `dir`, or null when it is not there or cannot be read. */
export async function readAsset(dir, id) {
  if (!ASSET_ID.test(String(id))) return null
  try {
    const record = JSON.parse(await readFile(join(assetFolder(dir, id), REQUEST_FILE), 'utf8'))
    return record?.id === id ? record : null
  } catch {
    return null
  }
}

/** Every request in `dir` that can be read, oldest first. */
export async function listAssets(dir) {
  const records = await Promise.all((await idsIn(dir)).map(id => readAsset(dir, id)))
  return records.filter(record => record !== null)
}

/**
 * A reader of every request in `dir` for a board that reads them at every state read (the asset wait, 2026-11-11): a request that is
 * ready or failed is final and is kept in memory, so each read opens only the folder and the open requests' files. Answers the list
 * as `listAssets` does, oldest first.
 */
export function assetReader(dir) {
  const final = new Map()
  return async () => {
    const ids = await idsIn(dir)
    const records = await Promise.all(ids.map(async id => {
      if (final.has(id)) return final.get(id)
      const record = await readAsset(dir, id)
      if (record !== null && (record.state === 'ready' || record.state === 'failed')) final.set(id, record)
      return record
    }))
    return records.filter(record => record !== null)
  }
}

/**
 * Changes the request `id`: `change(record)` answers the fields to set (or null to leave it as it is), and the record is
 * written with them. Answers the record as written, or null when there is no such request or nothing changed. A change to
 * running stamps `times.started`, one to ready or failed `times.ended`, at `now`; one back to waiting (the provider's limit,
 * src/assetQueue.mjs) clears `times.started`: the request has not been made yet.
 */
export function changeAsset(dir, id, change, now = Date.now()) {
  return inTurn(dir, async () => {
    const record = await readAsset(dir, id)
    if (record === null) return null
    const fields = typeof change === 'function' ? change(record) : change
    if (fields === null || fields === undefined) return null
    const times = { ...record.times }
    if (fields.state === 'running') times.started = now
    if (fields.state === 'waiting') times.started = null
    if (fields.state === 'ready' || fields.state === 'failed') times.ended = now
    const changed = { ...record, ...fields, times }
    await write(dir, changed)
    return changed
  })
}

/** What does not count as a file the person dropped: the request itself, a file being written, a hidden or a lock file. */
const NOT_DROPPED = name => name === REQUEST_FILE || name.startsWith('.') || name.startsWith('~$') || /\.(tmp|part|crdownload|download)$/i.test(name)

/** The files in the request's folder besides its request.json (and files still being written), by name. */
export async function droppedFiles(dir, id) {
  const entries = await readdir(assetFolder(dir, id), { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isFile() && !NOT_DROPPED(entry.name)).map(entry => entry.name).sort()
}
