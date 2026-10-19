// B361: the two settings the board's ⚙ panel changes in its own settings file (config.json): when the person is
// bothered (`botherMe`: "now", or "daily", gathered under the partner's daily note) and whether a rebuild the goal
// guard calls for goes ahead without their yes (`approveRebuilds`). Asks that block a chat always reach the person at
// once, whatever `botherMe` says.

/** The settings the panel may change, each with the values it takes. */
export const PANEL_SETTINGS = { botherMe: ['now', 'daily'], approveRebuilds: [false, true] }

/** The panel's settings as the page shows them, and whether this board may change them (`canSet`, `whyNot`). */
export function panelSettings(config, { canSet = true, whyNot = null } = {}) {
  return { botherMe: config.botherMe === 'daily' ? 'daily' : 'now', approveRebuilds: config.approveRebuilds === true, canSet, whyNot: canSet ? null : whyNot }
}

const refused = (status, why) => ({ ok: false, status, why })

/** A setting the panel sends checked: { ok, key, value } or { ok: false, status, why }. */
export function checkSetting(body) {
  const key = body?.key
  if (typeof key !== 'string' || !Object.hasOwn(PANEL_SETTINGS, key)) return refused(400, 'Send key "botherMe" or "approveRebuilds".')
  const value = body?.value
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
  const body = String(text ?? '').replace(/^﻿/, '')
  let raw
  try {
    raw = JSON.parse(body)
  } catch {
    return refused(409, 'The settings file config.json is broken: fix it first.')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return refused(409, 'The settings file config.json holds no settings object: fix it first.')
  raw[key] = value
  const indent = /\n([ \t]+)"/.exec(body)?.[1] ?? '  '
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  return { ok: true, text: `${JSON.stringify(raw, null, indent).replace(/\n/g, eol)}${eol}` }
}
