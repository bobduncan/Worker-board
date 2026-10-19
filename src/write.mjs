// B406: how the board writes its files. A file is written beside, flushed to disk and put in place by a rename, so a
// write cut off by a restart or a power cut leaves the old file whole; Windows may hold a file for a moment (a virus
// scanner, the search indexer), so a rename, a delete or an append is tried again on EPERM, EBUSY and EACCES. An
// appended record starts on a line of its own, also after a line torn by a power cut. A kept file that does not parse
// is set aside at the board's start instead of stopping it.

import { randomBytes } from 'node:crypto'
import { appendFile, open, readFile, rename, rm, writeFile } from 'node:fs/promises'

const files = { open, writeFile, rename, rm, readFile, appendFile }

/** The codes with which Windows refuses a file it holds for a moment. */
export const BUSY = ['EPERM', 'EBUSY', 'EACCES']

/**
 * `work()`, tried again while Windows holds the file: five tries in all, waiting `waitMs` times the try in between.
 * Any other error (a file that is not there) is no reason to try again.
 */
export async function again(work, { tries = 5, waitMs = 40 } = {}) {
  for (let at = 1; ; at += 1) {
    try {
      return await work()
    } catch (error) {
      if (at >= tries || !BUSY.includes(error?.code)) throw error
      await new Promise(done => setTimeout(done, waitMs * at))
    }
  }
}

/** A new name beside `file`, for the text that will take its place. */
export const besideOf = file => `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`

/**
 * Writes `data` to `beside`, a file that must not be there yet, and flushes it to disk. Without `fs.open` (a test's
 * files in memory) it is written plainly.
 */
export async function writeNew(beside, data, fs = files) {
  if (typeof fs.open !== 'function') return fs.writeFile(beside, data, { flag: 'wx' })
  const handle = await fs.open(beside, 'wx')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Puts `beside` in the place of `file`: a rename, tried again while Windows holds either. */
export const moveInPlace = (beside, file, fs = files) => again(() => fs.rename(beside, file))

/** Takes a file away, tried again while Windows holds it. */
export const removeFile = (file, fs = files, options = undefined) => again(() => fs.rm(file, options))

/**
 * `data` as the whole of `file`, or the file as it was: written beside, flushed, put in place. Throws when it could
 * not be written, and leaves nothing beside it.
 */
export async function writeAtomic(file, data, fs = files) {
  const beside = besideOf(file)
  try {
    await writeNew(beside, data, fs)
    await moveInPlace(beside, file, fs)
  } catch (error) {
    await removeFile(beside, fs, { force: true }).catch(() => {})
    throw error
  }
}

/** Whether `file` ends a line: not there, empty, or its last byte a line end. */
async function endsLine(file, fs) {
  if (typeof fs.open !== 'function') {
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    return text === '' || text.endsWith('\n')
  }
  let handle
  try {
    handle = await again(() => fs.open(file, 'r'))
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    throw error
  }
  try {
    const { size } = await handle.stat()
    if (size === 0) return true
    const last = Buffer.alloc(1)
    await handle.read(last, 0, 1, size - 1)
    return last[0] === 0x0a
  } finally {
    await handle.close()
  }
}

/**
 * Appends `text` (one or more lines) to `file`, ending its last line first when a restart or a power cut tore it, so
 * the next record is never swallowed by the torn one. Nothing to append writes nothing.
 */
export async function appendLines(file, text, fs = files) {
  if (text === '') return
  const lines = text.endsWith('\n') ? text : `${text}\n`
  const start = await endsLine(file, fs) ? '' : '\n'
  await again(() => fs.appendFile(file, `${start}${lines}`))
}

const pad = value => String(value).padStart(2, '0')
/** This machine's time as a file name takes it: `20261019-230509`. */
const stampOf = ms => {
  const at = new Date(ms)
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
}

/**
 * A JSON file the board keeps and reads at its start: `{ value, setAside, unread }`. Not there: value null, nothing
 * else. One that does not parse (torn by a restart or a power cut) is kept aside as `<file>.broken-<time>` and the
 * board starts without it: `setAside` names that file. One that is there but could not be read, or not kept aside, is
 * `unread` (why, in a few words): the board starts without it too, and its next write replaces it.
 */
export async function readKept(file, now, fs = files) {
  let text
  try {
    text = await again(() => fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null, setAside: null, unread: null }
    return { value: null, setAside: null, unread: `not readable: ${error?.code ?? error?.message}` }
  }
  try {
    return { value: JSON.parse(text.replace(/^FEFF/, '')), setAside: null, unread: null }
  } catch {
    const aside = `${file}.broken-${stampOf(now)}`
    try {
      await moveInPlace(file, aside, fs)
      return { value: null, setAside: aside, unread: null }
    } catch (error) {
      return { value: null, setAside: null, unread: `torn, and not kept aside: ${error?.code ?? error?.message}` }
    }
  }
}
