// The board's queue of asset requests (spec 2026-10-25-asset-providers-design.md, part 2; spec 2026-11-01, part 4): the
// board, not a chat, asks the provider. The requests are kept by src/assets.mjs; this is the loop that works them off.
// The server runs `pass()` from its loop (`loops.run('assets', ...)`) and after every `work asset`.
//
// - An `auto` request (codex, elevenlabs, elevenlabs-music, elevenlabs-images) runs one at a time per provider, oldest
//   first. Before it runs, the provider's `check` is asked: one that fails leaves its requests waiting, and the person
//   gets one ask "<provider> does not work for <kind>: <why>" linking the Settings tab: one per provider (kept in
//   `provider-asks.json` beside the requests), not one per request and not again while it stands. Once the provider works
//   again the ask is taken back and a later failure may ask anew.
// - A `person` request (person-suno, manual) is ready once a file lands in its folder: the person's ask is taken back.
//   An ask the person closed without a file fails the request, with why (the board never waits for ever).
// - A `pick` request is the work API's alone (the chat names its pick); the queue leaves it.
// - A request that turns ready or failed is told to the chat that asked (`tell`), once.
// - A request still running when the board stopped is failed at the next start (`recover`): it is never made twice by
//   itself, as a second making could cost credits; the chat asks again, with `follows`.
//
// Principle 5: the passes never overlap; a provider runs one request at a time, as the board knows in its memory.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assetFolder, changeAsset, droppedFiles, listAssets, readAsset } from './assets.mjs'
import { PROVIDERS, runCheck } from './providers/index.mjs'
import { writeAtomic } from './write.mjs'

/** The file beside the requests that names the open ask of each provider whose check failed. */
export const PROVIDER_ASKS_FILE = 'provider-asks.json'
/** Why a request still running at the board's start failed. */
export const STOPPED_WHY = 'The board stopped while it was being made: ask again, with follows'

/** The words of the person's ask for a provider whose check failed. */
export const providerAskTitle = (title, kind, why) => `${title} does not work for ${kind}: ${String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)}`

/**
 * The queue. `deps`:
 *   dir          the folder of the requests (src/assets.mjs `assetsFolderOf`)
 *   tools()      what the providers check and provide with (`project`, `codexPath`, `seconds`; the tests' stand-ins)
 *   fileAsk({ provider, title, kind, why })  files the person's ask for a failing provider (`title` the provider's card
 *                title; its words: `providerAskTitle`); answers its id (Q<n>) or null
 *   closeAsk(id, why)                         takes an ask back
 *   askOpen(id)  whether the ask stands open: true, false, or null when the board cannot tell (it then waits)
 *   tell(record) the word to the chat that asked, for a request that turned ready or failed
 *   now()        the clock
 *   providers    the providers by name (PROVIDERS; the tests' own)
 */
export function assetQueue({ dir, tools = () => ({}), fileAsk = async () => null, closeAsk = async () => {}, askOpen = async () => null, tell = async () => {}, now = Date.now, providers = PROVIDERS }) {
  /** The providers that run a request now, by name, with the promise of its end. */
  const busy = new Map()
  let passing = null

  const asksFile = join(dir, PROVIDER_ASKS_FILE)
  const readAsks = async () => {
    try {
      const kept = JSON.parse(await readFile(asksFile, 'utf8'))
      return kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}
    } catch {
      return {}
    }
  }
  const writeAsks = asks => writeAtomic(asksFile, `${JSON.stringify(asks, null, 2)}\n`)

  /** A request that ended: written, then its chat told (a word not sent is the server's loop failure, not a lost end). */
  async function end(id, fields) {
    const record = await changeAsset(dir, id, current => (current.state === 'ready' || current.state === 'failed' ? null : fields), now())
    if (record !== null) await tell(record)
    return record
  }

  /** The request as its provider gets it: whole paths; a follow-up of a picture starts from the last picture it follows. */
  async function requestOf(record) {
    const folder = assetFolder(dir, record.id)
    let pictures = record.pictures ?? []
    let edits = false
    if (record.follows !== null && record.kind === 'visual') {
      const before = await readAsset(dir, record.follows)
      const last = (before?.files ?? []).filter(name => /\.(png|jpe?g|webp)$/i.test(name)).at(-1)
      if (last !== undefined) {
        pictures = [join(assetFolder(dir, before.id), last), ...pictures]
        edits = true
      }
    }
    return { id: record.id, kind: record.kind, text: record.text, pictures, folder, edits }
  }

  /**
   * Runs one request of an auto provider; the provider is busy until it ends. Answers once the provider was asked (or the
   * request was no longer waiting), so a look ends with what it started under way; the making goes on after it.
   */
  function run(provider, record) {
    let asked
    const isAsked = new Promise(resolve => { asked = resolve })
    const ran = (async () => {
      const started = await changeAsset(dir, record.id, current => (current.state === 'waiting' ? { state: 'running' } : null), now())
      if (started === null) return
      const request = await requestOf(started)
      let given
      try {
        const making = provider.provide(request, tools())
        asked()
        given = await making
      } catch {
        given = { failed: `${provider.card?.title ?? provider.name} could not make it` }
      }
      const files = Array.isArray(given?.files) ? given.files.filter(name => typeof name === 'string' && name !== '') : []
      if (files.length > 0) await end(record.id, { state: 'ready', why: '', files })
      else await end(record.id, { state: 'failed', why: typeof given?.failed === 'string' && given.failed !== '' ? given.failed : `${provider.card?.title ?? provider.name} made nothing` })
    })().finally(() => {
      asked()
      busy.delete(provider.name)
    })
    busy.set(provider.name, ran)
    return isAsked
  }

  /** A person request: ready once a file is there; failed once its ask was closed without one. */
  async function lookAtPerson(record) {
    const files = await droppedFiles(dir, record.id)
    if (files.length > 0) {
      const ended = await end(record.id, { state: 'ready', why: '', files })
      if (ended !== null && record.ask !== null && (await askOpen(record.ask)) === true) await closeAsk(record.ask, `the file arrived in ${record.id}`)
      return
    }
    if (record.ask !== null && (await askOpen(record.ask)) === false) await end(record.id, { state: 'failed', why: `${record.ask} was closed without a file in the folder` })
  }

  /** One look at every request; a pass while another runs gets that one. */
  async function lookOnce() {
    const all = await listAssets(dir)
    for (const record of all.filter(one => one.state === 'waiting' && one.mode === 'person')) await lookAtPerson(record)
    const waiting = all.filter(one => one.state === 'waiting' && one.mode === 'auto')
    const names = [...new Set(waiting.map(one => one.provider))]
    if (names.length === 0) return
    const asks = await readAsks()
    let asksChanged = false
    for (const name of names) {
      if (busy.has(name)) continue
      const provider = providers[name]
      const oldest = waiting.find(one => one.provider === name)
      if (provider === undefined || typeof provider.provide !== 'function') {
        await end(oldest.id, { state: 'failed', why: `The board has no provider ${String(name).slice(0, 40)} that makes ${oldest.kind}` })
        continue
      }
      const checked = await runCheck(provider, tools())
      if (!checked.ok) {
        // One ask per provider while it does not work: kept until it works again, also once the person closed it.
        if (asks[name] === undefined) {
          const id = await fileAsk({ provider: name, title: provider.card?.title ?? name, kind: oldest.kind, why: checked.why })
          asks[name] = { ask: id ?? null, kind: oldest.kind, at: now() }
          asksChanged = true
        }
        continue
      }
      if (asks[name] !== undefined) {
        const { ask } = asks[name]
        delete asks[name]
        asksChanged = true
        if (ask !== null && (await askOpen(ask)) === true) await closeAsk(ask, `${provider.card?.title ?? name} works again`)
      }
      await run(provider, oldest)
    }
    if (asksChanged) await writeAsks(asks)
  }

  return {
    /** One look: starts what may start, readies what arrived. Never two at once. */
    pass() {
      passing ??= lookOnce().finally(() => { passing = null })
      return passing
    },
    /** At the board's start: a request still running was cut off; it fails with why and its chat is told. */
    async recover() {
      for (const record of await listAssets(dir)) if (record.state === 'running') await end(record.id, { state: 'failed', why: STOPPED_WHY })
    },
    /** Waits for the look and every request that runs now (the tests'). */
    async idle() {
      await passing
      await Promise.all([...busy.values()])
    },
    /** The providers running a request now. */
    busy: () => [...busy.keys()],
  }
}
