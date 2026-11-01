// B361: the settings the board's ⚙ panel changes in its own settings file (config.json): whether a rebuild the goal
// guard calls for goes ahead without the person's yes (`approveRebuilds`). B-max (the person, 2026-10-28: "make the worker
// limit configurable in the settings default is 5."): `maxWorkers`, how many workers the board starts at most, a whole
// number from 1 to 10. Autopilot (the person, 2026-10-31, src/work/autopilot.mjs): `autopilot`, on or off. While it is on,
// "Approve rebuilds by itself" is hidden: a goal stuck after the guard's tries is the person's (the coordinator's ruling,
// 2026-10-31): no rebuild approves itself, so it acts as off. Every reader of `approveRebuilds` reads it through
// `rebuildsApproved`. The recaps of finished work (B360) go where Autopilot says (`recapsShowOf`).

import { DEFAULTS } from './config.mjs'
import { ASSET_KINDS, PROVIDERS } from './providers/index.mjs'

/** B-max: the panel's range for `maxWorkers` (the page's stepper in public/board.js stops at the same ends). */
export const MAX_WORKERS_RANGE = Object.freeze([1, 10])
const isWorkerCount = value => Number.isInteger(value) && value >= MAX_WORKERS_RANGE[0] && value <= MAX_WORKERS_RANGE[1]

/** The settings the panel may change, each with the values it takes (`maxWorkers`: its range, a whole number between the ends). */
export const PANEL_SETTINGS = { approveRebuilds: [false, true], routingMode: ['off', 'observe'], maxWorkers: MAX_WORKERS_RANGE, autopilot: [false, true] }

/**
 * Whether a rebuild the goal guard calls for goes ahead without the person's yes: the person's own "Approve rebuilds by
 * itself", which acts as off while Autopilot is on (a stuck goal's "Rebuild G<n>:" ask is the person's).
 */
export const rebuildsApproved = config => config?.autopilot !== true && config?.approveRebuilds === true
/**
 * 2026-11-01 (the person: "so bother me is obsolete, i think"): where the recaps of finished work (B360) reach the person: with
 * Autopilot on, gathered under the partner's daily note ("daily"); with it off, each in Needs your attention as it comes ("now").
 */
export const recapsShowOf = config => (config?.autopilot === true ? 'daily' : 'now')
/** What a POST naming the removed setting "Bother me" is refused with. */
export const BOTHER_ME_REMOVED = 'Bother me was removed: questions come at once; Autopilot keeps them few'

/**
 * The panel's settings as the page shows them, and whether this board may change them (`canSet`, `whyNot`). `approveRebuilds`
 * as the person set it (the panel hides it while `autopilot` is on).
 */
export function panelSettings(config, { canSet = true, whyNot = null } = {}) {
  const maxWorkers = Number.isInteger(config.maxWorkers) && config.maxWorkers >= 1 ? config.maxWorkers : DEFAULTS.maxWorkers
  return { approveRebuilds: config.approveRebuilds === true, maxWorkers, autopilot: config.autopilot === true, canSet, whyNot: canSet ? null : whyNot }
}

const refused = (status, why) => ({ ok: false, status, why })

/**
 * Asset providers (spec 2026-11-01, part A): the value of the setting "providers" is `{ kind, provider }`, one kind switched
 * to a provider that serves it. { ok, key: 'providers', value } or { ok: false, status, why }.
 */
function checkProvider(value) {
  const kind = value?.kind
  const name = value?.provider
  if (typeof kind !== 'string' || !ASSET_KINDS.includes(kind)) return refused(400, `providers takes a kind: ${ASSET_KINDS.join(', ')}.`)
  if (typeof name !== 'string' || PROVIDERS[name] === undefined) return refused(400, 'providers takes a provider the board knows.')
  if (!PROVIDERS[name].kinds.includes(kind)) return refused(400, `${name} does not serve ${kind}.`)
  return { ok: true, key: 'providers', value: { kind, provider: name } }
}

/** A setting the panel sends checked: { ok, key, value } or { ok: false, status, why }. */
export function checkSetting(body) {
  const key = body?.key
  if (key === 'botherMe') return refused(400, BOTHER_ME_REMOVED)
  if (key === 'providers') return checkProvider(body?.value)
  if (typeof key !== 'string' || !Object.hasOwn(PANEL_SETTINGS, key)) return refused(400, 'Send key "approveRebuilds", "routingMode", "maxWorkers" or "autopilot".')
  const value = body?.value
  if (key === 'maxWorkers') return isWorkerCount(value) ? { ok: true, key, value } : refused(400, `maxWorkers takes a whole number from ${MAX_WORKERS_RANGE[0]} to ${MAX_WORKERS_RANGE[1]}.`)
  if (!PANEL_SETTINGS[key].includes(value)) return refused(400, `${key} takes ${PANEL_SETTINGS[key].map(one => JSON.stringify(one)).join(' or ')}.`)
  return { ok: true, key, value }
}

/**
 * The settings file's text with one setting changed and every other setting kept: { ok, text } or { ok: false,
 * status, why }. It keeps the file's indent and line ends; a file that is no JSON object is left alone.
 */
export function settingChanged(text, key, value) {
  const checked = checkSetting({ key, value })
  if (!checked.ok) return checked
  const body = String(text ?? '').replace(/^\uFEFF/, '')
  let raw
  try {
    raw = JSON.parse(body)
  } catch {
    return refused(409, 'The settings file config.json is broken: fix it first.')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return refused(409, 'The settings file config.json holds no settings object: fix it first.')
  if (key === 'providers') {
    if (raw.providers !== undefined && (raw.providers === null || typeof raw.providers !== 'object' || Array.isArray(raw.providers))) return refused(409, 'The "providers" setting is unreadable; correct it before switching a provider.')
    const before = raw.providers?.[value.kind]
    const was = typeof before === 'string' ? { provider: before } : before
    // The folder of the kind stays when the provider stays and has one (the sound library's); a new provider starts at its own default.
    const folder = was?.provider === value.provider && typeof was.folder === 'string' && PROVIDERS[value.provider].folder !== undefined ? was.folder : undefined
    raw.providers = { ...raw.providers, [value.kind]: folder === undefined ? value.provider : { provider: value.provider, folder } }
  } else if (key === 'routingMode') {
    if (raw.routing !== undefined && (raw.routing === null || typeof raw.routing !== 'object' || Array.isArray(raw.routing))) return refused(409, 'Routing policy is unreadable; correct it before changing mode.')
    raw.routing = { ...raw.routing, mode: value }
  } else raw[key] = value
  const indent = /\n([ \t]+)"/.exec(body)?.[1] ?? '  '
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  return { ok: true, text: `${JSON.stringify(raw, null, indent).replace(/\n/g, eol)}${eol}` }
}
