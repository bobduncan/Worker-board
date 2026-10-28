// B361: the settings the board's ⚙ panel changes in its own settings file (config.json): when the person is
// bothered (`botherMe`: "now", or "daily", gathered under the partner's daily note) and whether a rebuild the goal
// guard calls for goes ahead without their yes (`approveRebuilds`). Asks that block a chat always reach the person at
// once, whatever `botherMe` says. B-max (the person, 2026-10-28: "make the worker limit configurable in the settings
// default is 5."): `maxWorkers`, how many workers the board starts at most, a whole number from 1 to 10.

import { DEFAULTS } from './config.mjs'

/** B-max: the panel's range for `maxWorkers` (the page's stepper in public/board.js stops at the same ends). */
export const MAX_WORKERS_RANGE = Object.freeze([1, 10])
const isWorkerCount = value => Number.isInteger(value) && value >= MAX_WORKERS_RANGE[0] && value <= MAX_WORKERS_RANGE[1]

/** The settings the panel may change, each with the values it takes (`maxWorkers`: its range, a whole number between the ends). */
export const PANEL_SETTINGS = { botherMe: ['now', 'daily'], approveRebuilds: [false, true], routingMode: ['off', 'observe'], maxWorkers: MAX_WORKERS_RANGE }

/** The panel's settings as the page shows them, and whether this board may change them (`canSet`, `whyNot`). */
export function panelSettings(config, { canSet = true, whyNot = null } = {}) {
  const maxWorkers = Number.isInteger(config.maxWorkers) && config.maxWorkers >= 1 ? config.maxWorkers : DEFAULTS.maxWorkers
  return { botherMe: config.botherMe === 'daily' ? 'daily' : 'now', approveRebuilds: config.approveRebuilds === true, maxWorkers, canSet, whyNot: canSet ? null : whyNot }
}

const refused = (status, why) => ({ ok: false, status, why })

/** A setting the panel sends checked: { ok, key, value } or { ok: false, status, why }. */
export function checkSetting(body) {
  const key = body?.key
  if (typeof key !== 'string' || !Object.hasOwn(PANEL_SETTINGS, key)) return refused(400, 'Send key "botherMe", "approveRebuilds", "routingMode" or "maxWorkers".')
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
  if (key === 'routingMode') {
    if (raw.routing !== undefined && (raw.routing === null || typeof raw.routing !== 'object' || Array.isArray(raw.routing))) return refused(409, 'Routing policy is unreadable; correct it before changing mode.')
    raw.routing = { ...raw.routing, mode: value }
  } else raw[key] = value
  const indent = /\n([ \t]+)"/.exec(body)?.[1] ?? '  '
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  return { ok: true, text: `${JSON.stringify(raw, null, indent).replace(/\n/g, eol)}${eol}` }
}
