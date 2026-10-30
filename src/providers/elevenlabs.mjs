// The asset provider for sound effects made by ElevenLabs, which the board runs by itself (mode "auto"). Part 1 only knows
// whether it can work now; part 2 adds `provide` (POST /v1/sound-generation). The key is only read here: it goes to
// api.elevenlabs.io in one header and is in no answer, line of text, file or error. Music (Eleven Music) is a later kind.

import { execFile } from 'node:child_process'

/** The environment variable the key lives in (on Windows the user variable; never a file or a chat). */
export const KEY_VARIABLE = 'ELEVENLABS_API_KEY'
/** What the check asks: the plan, which costs no credits. */
const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription'
/** How long the check waits for ElevenLabs. */
export const ANSWER_MS = 10_000

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
async function readKey(tools) {
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

/** The plan as text: "free plan: for testing only, 9,950 credits left" or "paid plan, ... credits left"; '' when it is unreadable. */
function planText(plan) {
  const left = Number.isFinite(plan?.character_limit) && Number.isFinite(plan?.character_count) ? Math.max(0, plan.character_limit - plan.character_count) : null
  const tier = typeof plan?.tier === 'string' ? plan.tier.trim().toLowerCase() : ''
  const credits = left === null ? '' : `${left.toLocaleString('en-US')} credits left`
  if (tier === 'free') return ['free plan: for testing only', credits].filter(Boolean).join(', ')
  return credits
}

export const elevenlabs = {
  name: 'elevenlabs',
  mode: 'auto',
  kinds: ['sound effect'],
  /**
   * Whether the key is set and ElevenLabs answers it: GET /v1/user/subscription, which makes nothing and costs no
   * credits. `tools.key` and `tools.fetch` stand in for the key and `fetch` (the tests'). It never throws, waits at
   * most ANSWER_MS and never puts the key in what it answers.
   */
  async check(tools = {}) {
    const key = await readKey(tools)
    if (key === '') return { ok: false, why: `No ElevenLabs key (${KEY_VARIABLE})` }
    const ask = typeof tools.fetch === 'function' ? tools.fetch : fetch
    const stop = new AbortController()
    let timer
    const late = new Promise((_, reject) => { timer = setTimeout(() => { stop.abort(); reject(new Error('late')) }, tools.answerMs ?? ANSWER_MS) })
    try {
      const answer = await Promise.race([ask(SUBSCRIPTION_URL, { headers: { 'xi-api-key': key }, redirect: 'error', signal: stop.signal }), late])
      if (answer.status === 401 || answer.status === 403) {
        // A key that may not read the plan still works for sounds; any other refusal is a key ElevenLabs does not take.
        const body = await Promise.race([answer.json().catch(() => null), late])
        return body?.detail?.status === 'missing_permissions' ? { ok: true, why: 'works' } : { ok: false, why: 'ElevenLabs refused the key' }
      }
      if (!answer.ok) return { ok: false, why: 'ElevenLabs did not answer' }
      const plan = await Promise.race([answer.json().catch(() => null), late])
      const text = planText(plan)
      return { ok: true, why: text === '' ? 'works' : `works (${text})` }
    } catch {
      return { ok: false, why: 'ElevenLabs did not answer' }
    } finally {
      clearTimeout(timer)
    }
  },
}
