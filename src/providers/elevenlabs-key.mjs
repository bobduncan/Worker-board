// What the three ElevenLabs providers share (elevenlabs, elevenlabs-music, elevenlabs-images): where the key lives, how it
// is read and saved, and the one question they all ask, the plan (GET /v1/user/subscription, which costs no credits).
// The key is only read here: it goes to api.elevenlabs.io in one header and is in no answer, line of text, file, log or error.

import { execFile } from 'node:child_process'

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
