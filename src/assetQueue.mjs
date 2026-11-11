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
// - A request still running when the board stopped (`recover`, at the next start) is no fault of the request (the live A245 of
//   2026-11-11 13:50, cut by a landing's restart, failed with "ask again, with follows" and its chat never heard of it): it goes
//   back to waiting and runs again by itself, counting toward the same cap as the usage-limit waits (`LIMIT_TRIES`); past the
//   cap it fails with why and the chat is told.
// - A word nobody could be told (`tell` answered false: the board's state did not show the chat yet, right after a start) is
//   told again at every pass until it went (`untold`); the delivery sweep's resends (workLines.mjs `assetResends`) cover a
//   restart in between.
// - The asset-limit wait (2026-11-11, the live B1125 case: A230-A234 failed on Codex's usage limit "try again at 1:23 PM"): a
//   failure on the provider's usage limit with a known reset time (src/work/providerLimit.mjs `limitResetOf`) is no failure: the
//   request goes back to waiting with `limit: { until, why, at }`, nobody is told, the provider's requests are left alone until
//   the reset has passed, and the oldest runs again by itself then. Without a reset time it fails as before; after LIMIT_TRIES waits
//   for one request (a limit that never lifts, a model's own "try again" words) the failure stands and the chat is told.
//
// Principle 5: the passes never overlap; a provider runs one request at a time, as the board knows in its memory.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assetFolder, changeAsset, droppedFiles, listAssets, readAsset } from './assets.mjs'
import { PROVIDERS, runCheck } from './providers/index.mjs'
import { LIMIT_TRIES, limitOf, limitResetOf, triedWhy, waitsForLimit } from './work/providerLimit.mjs'
import { writeAtomic } from './write.mjs'

/** The file beside the requests that names the open ask of each provider whose check failed. */
export const PROVIDER_ASKS_FILE = 'provider-asks.json'
/** Why a request still running at the board's start is made again (and, past the cap, why it failed). */
export const STOPPED_WHY = 'The board stopped while it was being made'

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
 *   tell(record) the word to the chat that asked, for a request that turned ready or failed; false when nobody could be told now
 *                (the chat not shown yet): the queue tells again at its next pass
 *   now()        the clock
 *   providers    the providers by name (PROVIDERS; the tests' own)
 */
export function assetQueue({ dir, tools = () => ({}), fileAsk = async () => null, closeAsk = async () => {}, askOpen = async () => null, tell = async () => {}, now = Date.now, providers = PROVIDERS }) {
  /** The providers that run a request now, by name, with the promise of its end. */
  const busy = new Map()
  /** The requests that ended whose word nobody could be told yet (`tell` false): told again at the next pass. */
  const untold = new Set()
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
    if (record !== null && (await tell(record)) === false) untold.add(id)
    return record
  }
  /** The words nobody could be told yet, once more; a request that is not final after all is let go. */
  async function tellAgain() {
    for (const id of [...untold]) {
      const record = await readAsset(dir, id)
      if (record === null || !(record.state === 'ready' || record.state === 'failed')) untold.delete(id)
      else if ((await tell(record)) !== false) untold.delete(id)
    }
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
      // The request keeps how often it waited for a reset (`limitTries`) across the runs; `limit` itself is cleared while it runs.
      const started = await changeAsset(dir, record.id, current => (current.state === 'waiting' ? { state: 'running', limit: null, limitTries: Number.isInteger(current.limit?.tries) ? current.limit.tries : current.limitTries ?? 0 } : null), now())
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
      const why = typeof given?.failed === 'string' && given.failed !== '' ? given.failed : `${provider.card?.title ?? provider.name} made nothing`
      const until = files.length > 0 ? null : limitResetOf(why, now())
      const tries = (Number.isInteger(started.limitTries) ? started.limitTries : 0) + 1
      if (files.length > 0) await end(record.id, { state: 'ready', why: '', files, limitTries: null })
      // The asset-limit wait: the provider's limit with a known reset is no failure; the request waits for the reset, told to nobody,
      // up to LIMIT_TRIES times; then the failure stands (a limit that never lifts would run, and pay, for ever).
      else if (until !== null && tries <= LIMIT_TRIES) await changeAsset(dir, record.id, current => (current.state === 'running' ? { state: 'waiting', why: '', limit: limitOf(why, until, now(), tries) } : null), now())
      else await end(record.id, { state: 'failed', why: until !== null ? triedWhy(why, tries - 1) : why, limitTries: null })
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
    await tellAgain()
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
      // The asset-limit wait: a provider at its usage limit (any of its waiting requests says so) is left alone until the reset has passed.
      if (waiting.some(one => one.provider === name && waitsForLimit(one, now()))) continue
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
    /**
     * At the board's start: a request still running was cut off by the stop. It goes back to waiting and runs again by itself
     * (its `limit` names the stop, with no time to wait, and counts the try toward LIMIT_TRIES); past the cap it fails with why
     * and its chat is told.
     */
    async recover() {
      for (const record of await listAssets(dir)) {
        if (record.state !== 'running') continue
        const tries = (Number.isInteger(record.limitTries) ? record.limitTries : 0) + 1
        if (tries <= LIMIT_TRIES) await changeAsset(dir, record.id, current => (current.state === 'running' ? { state: 'waiting', why: '', limit: limitOf(STOPPED_WHY, now(), now(), tries) } : null), now())
        else await end(record.id, { state: 'failed', why: triedWhy(STOPPED_WHY, tries - 1), limitTries: null })
      }
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
