// B1535: the thread that builds the board's state (src/stateThread.mjs). One message in, `{ id, raw, options }`, one out:
// `{ id, bytes }` (the state serialized, its buffer moved to the loop: B1579), or `{ id, error }` when the build threw, or
// `{ id, error, copyFailed: true }` when its state could not be sent back (the board then builds in the loop). The builds come one
// at a time and are taken in order (each awaits the one before it).
// B1579 (X93, the rest): `raw` is what the loop hands in (src/stateBuild.mjs): on a real board `{ facts }`, and the thread reads the
// sources itself (the work store, the chats' files, the transcripts) with its own caches (the chat files' stamps, appChats.mjs; the
// transcripts' starts and look-backs, sources.mjs), so a new thread reads all once, then only what changed; the demo's raw as it is.
// The thread keeps its own read of the work store (work/read.mjs `storeKeeper`), read anew whenever the loop's store read was reset
// since (`facts.gen`), so a write shows in the next state.

import { serialize } from 'node:v8'
import { parentPort } from 'node:worker_threads'

import { buildFrom } from './stateBuild.mjs'
import { BUILD_BLOCK_MS, holdBuild, THREAD_BLOCK_MS } from './stateThread.mjs'
import { storeKeeper } from './work/read.mjs'
import { forgetListing } from './work/store.mjs'

const errorOf = error => ({ message: String(error?.message ?? error), stack: typeof error?.stack === 'string' ? error.stack : '' })

/**
 * The thread's read of the work store: `readWorkFor(facts)` answers the reader of `facts.workDir` (undefined without one), its keeper
 * made anew for another folder and reset whenever `facts.gen` (the loop's count of its resets) changed.
 */
export function workReader({ keeperOf = dir => storeKeeper({ dir }), forget = forgetListing } = {}) {
  let dir = null
  let gen = null
  let keeper = null
  return facts => {
    const want = typeof facts?.workDir === 'string' && facts.workDir !== '' ? facts.workDir : null
    if (want === null) return async () => undefined
    if (keeper === null || want !== dir) {
      keeper = keeperOf(want)
      dir = want
      gen = facts.gen ?? null
    } else if ((facts.gen ?? null) !== gen) {
      // The loop wrote: this thread's read and its shared listing (work/store.mjs, 1.5 s) go, so the write shows in this build.
      keeper.reset()
      forget(want)
      gen = facts.gen ?? null
    }
    const kept = keeper
    return () => kept()
  }
}

const threadWork = workReader()

/** The state's bytes, their buffer alone (moved to the loop, never copied again). */
function bytesOf(state) {
  const bytes = serialize(state)
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/** One build's answer, sent with `post(message, moved)` (the port's postMessage; the tests give their own). */
export async function answer({ id, raw, options }, { build, post, hold = () => holdBuild(BUILD_BLOCK_MS + THREAD_BLOCK_MS), readWorkFor = threadWork }) {
  let state
  try {
    state = await buildFrom(raw, options, { readWork: readWorkFor(raw?.facts), hold, ...(build === undefined ? {} : { build }) })
  } catch (error) {
    post({ id, error: errorOf(error) })
    return
  }
  try {
    const buffer = bytesOf(state)
    post({ id, bytes: buffer }, [buffer])
  } catch (error) {
    post({ id, error: errorOf(error), copyFailed: true })
  }
}

if (parentPort !== null) {
  let turn = Promise.resolve()
  parentPort.on('message', message => {
    turn = turn.then(() => answer(message, { post: (one, moved) => parentPort.postMessage(one, moved) })).catch(() => {})
  })
}
