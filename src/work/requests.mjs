// B412: a work call recorded once, also when its answer is slow or cut off. The Workers mod sends each call of the work
// tool with a request id of its own; the board keeps the answer under the chat's session and that id, in memory and in a small
// file, and gives the same answer to a repeat of the id, also after a restart. A repeat that comes while the first is
// still being worked on waits for that one: the call is made once. An answer that says the store could not be reached
// (a status of 500 or more) or asks to come back later (408, 423, 429) is not kept: a repeat tries again.

import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/** How many answers are kept, and for how long: long enough for a repeat after a restart. */
export const MOST_KEPT = 300
export const KEEP_MS = 24 * 60 * 60 * 1000

/** A request id as the mod makes it: letters, digits, `-`, `_`, `.` and `:`, 8 to 100 of them. */
export const isRequestId = value => typeof value === 'string' && /^[\w.:-]{8,100}$/.test(value)

const FILES = { readFile, writeFile, rename, mkdir }
/** Refusals that ask to come back later: not the call's answer. */
const LATER = new Set([408, 423, 429])

/**
 * The keeper of the answers by request: `answer(chat, request, run)` gives the kept answer of that chat's request, or
 * runs `run()` once and keeps what it answers. Without a request id (an older mod) it only runs. `file` null keeps them
 * in memory only.
 */
export function requestKeeper({ file = null, clock = Date.now, fs = FILES, most = MOST_KEPT, keepMs = KEEP_MS } = {}) {
  const kept = new Map()
  const running = new Map()
  let loaded = null
  let saving = Promise.resolve()

  const load = () => {
    loaded ??= (async () => {
      if (file === null) return
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'))
        for (const one of Array.isArray(raw?.answers) ? raw.answers : []) {
          if (typeof one?.key === 'string' && Number.isFinite(one.at) && one.answer !== undefined) kept.set(one.key, { at: one.at, answer: one.answer })
        }
      } catch {
        // no file yet, or a torn one: nothing is kept, and the calls are made as they come
      }
      prune(clock())
    })()
    return loaded
  }

  const prune = now => {
    for (const [key, one] of kept) if (now - one.at > keepMs) kept.delete(key)
    while (kept.size > most) kept.delete(kept.keys().next().value)
  }

  const save = () => {
    if (file === null) return saving
    const answers = [...kept].map(([key, one]) => ({ key, ...one }))
    saving = saving.then(async () => {
      try {
        await fs.mkdir(dirname(file), { recursive: true })
        await fs.writeFile(`${file}.new`, JSON.stringify({ answers }), 'utf8')
        await fs.rename(`${file}.new`, file)
      } catch {
        // kept in memory all the same; a restart forgets it
      }
    })
    return saving
  }

  /** The kept answer of that request, or the one still being made; undefined when there is none. */
  async function known(chat, request) {
    if (!isRequestId(request)) return undefined
    await load()
    const key = `${chat}\n${request}`
    return kept.get(key)?.answer ?? running.get(key)
  }

  async function answer(chat, request, run) {
    if (!isRequestId(request)) return run()
    const key = `${chat}\n${request}`
    const before = await known(chat, request)
    if (before !== undefined) return before
    // Looked at again after the wait: a repeat that came at the same moment may have started it meanwhile.
    if (running.has(key)) return running.get(key)
    if (kept.has(key)) return kept.get(key).answer
    const first = (async () => {
      const done = await run()
      if (done?.ok === true || (Number.isFinite(done?.status) && done.status < 500 && !LATER.has(done.status))) {
        kept.set(key, { at: clock(), answer: done })
        prune(clock())
        await save()
      }
      return done
    })()
    running.set(key, first)
    try {
      return await first
    } finally {
      running.delete(key)
    }
  }

  return { answer, known, saved: () => saving }
}
