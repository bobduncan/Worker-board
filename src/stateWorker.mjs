// B1535: the thread that builds the board's state (src/stateThread.mjs). One message in, `{ id, raw, options }`, one out:
// `{ id, state }`, or `{ id, error }` when the build threw, or `{ id, error, copyFailed: true }` when its state could not be sent
// back (the board then builds in the loop). The builds come one at a time and are taken in order.

import { parentPort } from 'node:worker_threads'

import { buildState } from './state.mjs'
import { holdBuild } from './stateThread.mjs'

const errorOf = error => ({ message: String(error?.message ?? error), stack: typeof error?.stack === 'string' ? error.stack : '' })

parentPort.on('message', ({ id, raw, options }) => {
  let state
  try {
    holdBuild()
    state = buildState(raw, options)
  } catch (error) {
    parentPort.postMessage({ id, error: errorOf(error) })
    return
  }
  try {
    parentPort.postMessage({ id, state })
  } catch (error) {
    parentPort.postMessage({ id, error: errorOf(error), copyFailed: true })
  }
})
