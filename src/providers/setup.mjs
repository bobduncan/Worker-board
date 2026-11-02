// Asset providers, part D (spec 2026-11-01-asset-providers-screens-design.md, "New board · Setup"): the first-run setup of a
// new board, one step per kind of asset. The state is `data/setup.json`: `{ done: [kinds], finished }`. A board is new only
// when that file is absent and its settings never named a `providers` key; every other board counts as finished, so the
// live board never sees the setup. A kind is marked done only when the provider in use for it passes `mayUse` (verified a
// few minutes ago); the setup is finished only when every kind is done.

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { ASSET_KINDS, providerFor } from './index.mjs'
import { mayUse } from './choose.mjs'
import { writeAtomic } from '../write.mjs'

/** The state of a board that never sees the setup. */
export const FINISHED = Object.freeze({ done: [...ASSET_KINDS], finished: true })

const clean = value => {
  const done = Array.isArray(value?.done) ? ASSET_KINDS.filter(kind => value.done.includes(kind)) : []
  return { done, finished: value?.finished === true && done.length === ASSET_KINDS.length }
}

/** The setup's state from `file`: the file's when it holds one, else finished (an existing board). Never throws. */
export async function readSetup(file) {
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return { ...FINISHED, done: [...FINISHED.done] }
  try { return clean(JSON.parse(text)) } catch { return { done: [], finished: false } }
}

/** Starts the setup of a new board: writes the empty state when `file` is absent and the settings never named providers. */
export async function startSetup(file, { hasProvidersKey }) {
  if (hasProvidersKey) return false
  const there = await readFile(file, 'utf8').then(() => true, () => false)
  if (there) return false
  await mkdir(dirname(file), { recursive: true })
  await writeAtomic(file, `${JSON.stringify({ done: [], finished: false }, null, 2)}\n`)
  return true
}

/**
 * Applies `body` ({ action: 'done', kind } or { action: 'finish' }) to the state in `file`. `config` and `checks` are the
 * board's settings and kept checks. Returns `{ ok, result }` (the new state) or `{ ok: false, status, why }`.
 */
export async function setupAction(file, body, { config, checks, now = Date.now() }) {
  const state = await readSetup(file)
  if (state.finished) return { ok: false, status: 409, why: 'The setup is finished already.' }
  if (body?.action === 'done') {
    const kind = body.kind
    if (!ASSET_KINDS.includes(kind)) return { ok: false, status: 400, why: `Send a kind: ${ASSET_KINDS.join(', ')}.` }
    const name = providerFor(config, kind)?.provider.name
    const may = name === undefined ? { ok: false, why: 'No provider is set for this kind.' } : mayUse(checks, kind, name, now)
    if (!may.ok) return { ok: false, status: 409, why: may.why }
    const done = ASSET_KINDS.filter(one => one === kind || state.done.includes(one))
    await writeAtomic(file, `${JSON.stringify({ done, finished: false }, null, 2)}\n`)
    return { ok: true, result: { done, finished: false } }
  }
  if (body?.action === 'finish') {
    if (ASSET_KINDS.some(kind => !state.done.includes(kind))) return { ok: false, status: 409, why: 'Finish every step first.' }
    await writeAtomic(file, `${JSON.stringify({ done: [...ASSET_KINDS], finished: true }, null, 2)}\n`)
    return { ok: true, result: { done: [...ASSET_KINDS], finished: true } }
  }
  return { ok: false, status: 400, why: 'Send action "done" or "finish".' }
}
