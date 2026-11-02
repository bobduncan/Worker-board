// What the three ElevenLabs providers share (elevenlabs, elevenlabs-music, elevenlabs-images): where the key lives, how it
// is read and saved, and the one question they all ask, the plan (GET /v1/user/subscription, which costs no credits).
// The key is only read here: it goes to api.elevenlabs.io in one header and is in no answer, line of text, file, log or error.

import { execFile } from 'node:child_process'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { writeAtomic } from '../write.mjs'

/** The environment variable the key lives in (on Windows the user variable; never a file or a chat). */
export const KEY_VARIABLE = 'ELEVENLABS_API_KEY'
/** What the check asks: the plan, which costs no credits. */
const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription'
/** How long the check waits for ElevenLabs. */
export const ANSWER_MS = 10_000
/** The longest key the board takes from the page. */
export const KEY_MAX = 200

/** The key of the user variable of Windows, for a board started before the variable was set; '' when there is none. */
function userVariable() {
  return new Promise(resolve => {
    execFile('reg', ['query', 'HKCU\\Environment', '/v', KEY_VARIABLE], { windowsHide: true, timeout: 5000 }, (error, out) => {
      if (error) return resolve('')
      const found = String(out).match(new RegExp(`${KEY_VARIABLE}\\s+REG_(?:EXPAND_)?SZ\\s+(\\S+)`))
      resolve(found === null ? '' : found[1])
    })
  })
}

/** The key: `tools.key` (the tests'; a text or a function), else the board's environment, else on Windows the user variable. */
export async function readKey(tools = {}) {
  try {
    const given = typeof tools.key === 'function' ? await tools.key() : tools.key
    if (given !== undefined) return typeof given === 'string' ? given.trim() : ''
    const own = (process.env[KEY_VARIABLE] ?? '').trim()
    if (own !== '') return own
    return process.platform === 'win32' ? (await userVariable()).trim() : ''
  } catch {
    return ''
  }
}

/**
 * Whether `key` is a key the board takes from the page: { ok: true, key } (trimmed), or { ok: false, why }. Not empty,
 * at most KEY_MAX characters, no white space inside. The refusal never repeats the key.
 */
export function keyChecked(key) {
  const text = typeof key === 'string' ? key.trim() : ''
  if (text === '') return { ok: false, why: 'The key is empty.' }
  if (text.length > KEY_MAX) return { ok: false, why: `The key is longer than ${KEY_MAX} characters.` }
  if (/\s/.test(text)) return { ok: false, why: 'The key holds white space.' }
  return { ok: true, key: text }
}

/**
 * Keeps `key` for the next starts of the board (on Windows the user variable, with `reg add`, no shell) and for this one
 * (`process.env`): { ok: true } or { ok: false, why }. The key is in no error: `reg` failing says so in general words.
 * `tools.run` stands in for `execFile` (the tests'); `tools.platform` for `process.platform`.
 */
export function saveKey(key, { run = execFile, platform = process.platform } = {}) {
  return new Promise(resolve => {
    const done = () => { process.env[KEY_VARIABLE] = key; resolve({ ok: true }) }
    if (platform !== 'win32') return done()
    run('reg', ['add', 'HKCU\\Environment', '/v', KEY_VARIABLE, '/t', 'REG_SZ', '/d', key, '/f'], { windowsHide: true, timeout: 5000 }, error => {
      if (error) return resolve({ ok: false, why: 'The key could not be saved in the user variables of Windows.' })
      done()
    })
  })
}

/** The credits left as text ("9,950 credits left"); '' when the plan does not say. */
function creditsText(plan) {
  const left = Number.isFinite(plan?.character_limit) && Number.isFinite(plan?.character_count) ? Math.max(0, plan.character_limit - plan.character_count) : null
  return left === null ? '' : `${left.toLocaleString('en-US')} credits left`
}

/**
 * Asks ElevenLabs for the plan with the key from `readKey`. `tools.key` and `tools.fetch` stand in for the key and `fetch`
 * (the tests'). It never throws, waits at most ANSWER_MS (`tools.answerMs`) and never puts the key in what it answers:
 *   { key: false }                                  no key is set
 *   { key: true, ok: false, why }                   refused, or no answer
 *   { key: true, ok: true, tier, credits, text }    `tier` lower case ('' when unknown), `credits` as text ('' when unknown),
 *                                                   `text` the plan as one phrase for `why` ('' when nothing is known)
 */
export async function askPlan(tools = {}) {
  const key = await readKey(tools)
  if (key === '') return { key: false }
  const ask = typeof tools.fetch === 'function' ? tools.fetch : fetch
  const stop = new AbortController()
  let timer
  const late = new Promise((_, reject) => { timer = setTimeout(() => { stop.abort(); reject(new Error('late')) }, tools.answerMs ?? ANSWER_MS) })
  try {
    const answer = await Promise.race([ask(SUBSCRIPTION_URL, { headers: { 'xi-api-key': key }, redirect: 'error', signal: stop.signal }), late])
    if (answer.status === 401 || answer.status === 403) {
      // A key that may not read the plan still works for what it was made for; any other refusal is a key ElevenLabs does not take.
      const body = await Promise.race([answer.json().catch(() => null), late])
      return body?.detail?.status === 'missing_permissions' ? { key: true, ok: true, tier: '', credits: '', text: '' } : { key: true, ok: false, why: 'ElevenLabs refused the key' }
    }
    if (!answer.ok) return { key: true, ok: false, why: 'ElevenLabs did not answer' }
    const plan = await Promise.race([answer.json().catch(() => null), late])
    const tier = typeof plan?.tier === 'string' ? plan.tier.trim().toLowerCase() : ''
    const credits = creditsText(plan)
    const text = tier === 'free' ? ['free plan: for testing only', credits].filter(Boolean).join(', ') : credits
    return { key: true, ok: true, tier, credits, text }
  } catch {
    return { key: true, ok: false, why: 'ElevenLabs did not answer' }
  } finally {
    clearTimeout(timer)
  }
}

/** The answer of a check when no key is set. */
export const NO_KEY = Object.freeze({ ok: false, state: 'needs', why: `No ElevenLabs key (${KEY_VARIABLE})`, detail: 'Paste your key first' })

/**
 * A check's answer from `askPlan`'s: the part the three providers share. `refusePlan(plan)` may return a line for a plan
 * the provider cannot use (elevenlabs-images wants Pro), else null.
 */
export function planAnswer(plan, refusePlan = () => null) {
  if (!plan.key) return { ...NO_KEY }
  if (!plan.ok) return { ok: false, state: 'needs', why: plan.why, detail: plan.why === 'ElevenLabs refused the key' ? 'Key refused' : 'No answer' }
  const refused = refusePlan(plan)
  if (refused !== null) return { ok: false, state: 'needs', why: refused, detail: refused }
  return { ok: true, state: 'works', why: plan.text === '' ? 'works' : `works (${plan.text})`, detail: plan.credits === '' ? 'Key works' : plan.credits }
}

/** How long the board waits for ElevenLabs to make a sound or a track (part C): a whole track takes a while. */
export const MAKE_MS = 5 * 60_000
/** The biggest file the board keeps from ElevenLabs: a sound or a track of a few minutes is far below it. */
const MAKE_MAX_BYTES = 50 * 1024 * 1024

/**
 * Part C: asks ElevenLabs to make something (POST `url` with the JSON `body`) and answers the bytes it sends back:
 * `{ ok: true, bytes }` or `{ ok: false, why }`. The key from `readKey` goes in one header and is in no answer, line of
 * text or error. `tools.key` and `tools.fetch` stand in for the key and `fetch` (the tests'); it waits at most MAKE_MS
 * (`tools.makeMs`) and never throws. A refusal says ElevenLabs' own short reason when it gives one (`detail.message`),
 * cut to one line; that reason is ElevenLabs', never the key.
 */
export async function makeAudio(url, body, tools = {}) {
  const key = await readKey(tools)
  if (key === '') return { ok: false, why: `No ElevenLabs key (${KEY_VARIABLE})` }
  const ask = typeof tools.fetch === 'function' ? tools.fetch : fetch
  const stop = new AbortController()
  let timer
  const late = new Promise((_, reject) => { timer = setTimeout(() => { stop.abort(); reject(new Error('late')) }, tools.makeMs ?? MAKE_MS) })
  try {
    const answer = await Promise.race([ask(url, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify(body), redirect: 'error', signal: stop.signal }), late])
    if (answer.status === 401 || answer.status === 403) return { ok: false, why: 'ElevenLabs refused the key' }
    if (!answer.ok) {
      const said = await Promise.race([answer.json().catch(() => null), late]).catch(() => null)
      const reason = typeof said?.detail?.message === 'string' ? said.detail.message : typeof said?.detail === 'string' ? said.detail : ''
      const words = reason.split(key).join('').replace(/\s+/g, ' ').trim().slice(0, 200)
      return { ok: false, why: `ElevenLabs made nothing (${answer.status})${words === '' ? '' : `: ${words}`}` }
    }
    const bytes = Buffer.from(await Promise.race([answer.arrayBuffer(), late]))
    if (bytes.length === 0) return { ok: false, why: 'ElevenLabs sent an empty file' }
    if (bytes.length > MAKE_MAX_BYTES) return { ok: false, why: 'ElevenLabs sent a file too big to keep' }
    return { ok: true, bytes }
  } catch (error) {
    return { ok: false, why: error?.message === 'late' ? `ElevenLabs took longer than ${Math.round((tools.makeMs ?? MAKE_MS) / 1000)} seconds` : 'ElevenLabs did not answer' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Part C: what the ElevenLabs providers do with `makeAudio`'s answer: the bytes as `<n>.mp3` in the request's folder
 * (the first number not taken), `{ files: ['1.mp3'] }`, or `{ failed: why }`. It never throws.
 */
export async function keepAudio(made, folder) {
  if (!made.ok) return { failed: made.why }
  try {
    const name = await freeName(folder, 'mp3')
    await mkdir(folder, { recursive: true })
    await writeAtomic(join(folder, name), made.bytes)
    return { files: [name] }
  } catch {
    return { failed: 'The file could not be kept in the request\'s folder' }
  }
}

/** The first `<n>.<extension>` (1, 2, ...) that `folder` does not hold yet. */
export async function freeName(folder, extension) {
  const taken = new Set(await readdir(folder).catch(() => []))
  let n = 1
  while (taken.has(`${n}.${extension}`)) n += 1
  return `${n}.${extension}`
}
