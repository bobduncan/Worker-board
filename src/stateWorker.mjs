// B1535: the thread that builds the board's state (src/stateThread.mjs). One message in, `{ id, raw, options }`, one out:
// `{ id, state }`, or `{ id, error }` when the build threw, or `{ id, error, copyFailed: true }` when its state could not be sent
// back (the board then builds in the loop). The builds come one at a time and are taken in order.

import { parentPort } from 'node:worker_threads'

import { buildState } from './state.mjs'
import { BUILD_BLOCK_MS, holdBuild, THREAD_BLOCK_MS } from './stateThread.mjs'

const errorOf = error => ({ message: String(error?.message ?? error), stack: typeof error?.stack === 'string' ? error.stack : '' })

/** One build's answer, sent with `post` (the port's postMessage; the tests give their own). */
export function answer({ id, raw, options }, { build = buildState, post, hold = () => holdBuild(BUILD_BLOCK_MS + THREAD_BLOCK_MS) }) {
  let state
  try {
    hold()
    state = build(raw, options)
  } catch (error) {
    post({ id, error: errorOf(error) })
    return
  }
  try {
    post({ id, state })
  } catch (error) {
    post({ id, error: errorOf(error), copyFailed: true })
  }
}

if (parentPort !== null) parentPort.on('message', message => answer(message, { post: one => parentPort.postMessage(one) }))
