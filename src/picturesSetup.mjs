// T5.2 P4 (the design of 2026-11-16, section 7): where a project's pictures live. The split: the project's choice travels in its settings
// (`pictures: { where, folder }`: which kind of place and the folder's name there, the same on every PC), and this PC's own path to that
// folder stays in config.json (`picturesHome`, a PC key). The keep set stays in the carry tool's record (data/carry.json). Setup asks once,
// with a keyboard, when the project has no `pictures` setting and no `--pictures` flag was given. Pure parts only; setup.mjs asks.

import { isAbsolute, join } from 'node:path'

export const PICTURE_PLACES = Object.freeze(['Google Drive', 'OneDrive', 'Dropbox', 'elsewhere', 'this PC'])
export const DEFAULT_PICTURES_FOLDER = 'Worker board'

/** A valid `pictures` setting: `{ where, folder }`, where one of PICTURE_PLACES, folder a name (no path) unless where is "this PC". */
export function isPictures(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (!PICTURE_PLACES.includes(value.where)) return false
  if (value.where === 'this PC') return value.folder === undefined || value.folder === ''
  return typeof value.folder === 'string' && value.folder.trim() !== '' && !/[\\/]/.test(value.folder) && value.folder !== '..'
}

/**
 * The choices setup shows, numbered from 1: each cloud folder found (`cloudFolders()`: `[{ kind, path }]`), then "somewhere else" and
 * "this PC only". `[{ key, where, path, label }]`.
 */
export function picturesChoices(clouds = []) {
  const found = (Array.isArray(clouds) ? clouds : []).filter(one => PICTURE_PLACES.includes(one?.kind) && typeof one.path === 'string' && one.path !== '')
  const list = [
    ...found.map(one => ({ where: one.kind, path: one.path, label: `${one.kind} (${one.path})` })),
    { where: 'elsewhere', path: null, label: 'Somewhere else (you type the folder)' },
    { where: 'this PC', path: null, label: 'This PC only (the pictures stay in the project)' },
  ]
  return list.map((one, at) => ({ key: String(at + 1), ...one }))
}

/**
 * The answer to the question: `{ ok, pictures, picturesHome }` or `{ ok: false, why }`. `typed`: the number picked ('' for the first);
 * `folder`: the folder's name in a cloud folder ('' for DEFAULT_PICTURES_FOLDER); `path`: the whole folder for "somewhere else".
 */
export function picturesAnswer(choices, { typed = '', folder = '', path = '' } = {}) {
  const picked = choices.find(one => one.key === (String(typed).trim() || '1'))
  if (picked === undefined) return { ok: false, why: `Pick one of 1 to ${choices.length}.` }
  if (picked.where === 'this PC') return { ok: true, pictures: { where: 'this PC' }, picturesHome: '' }
  if (picked.where === 'elsewhere') {
    const home = String(path).trim()
    if (home === '' || !isAbsolute(home)) return { ok: false, why: 'Type the whole folder, from the drive letter (C:\\...).' }
    const name = home.split(/[\\/]/).filter(Boolean).pop()
    return { ok: true, pictures: { where: 'elsewhere', folder: name }, picturesHome: home }
  }
  const name = String(folder).trim() || DEFAULT_PICTURES_FOLDER
  const pictures = { where: picked.where, folder: name }
  if (!isPictures(pictures)) return { ok: false, why: 'A folder name only, without \\ or /.' }
  return { ok: true, pictures, picturesHome: join(picked.path, name) }
}

/**
 * On a PC that has the project's `pictures` setting but no `picturesHome` yet (the second PC): this PC's path to the same folder, from
 * the cloud folders found, or null (none of that kind here, "elsewhere" or "this PC": nothing to guess).
 */
export function homeFor(pictures, clouds = []) {
  if (!isPictures(pictures) || pictures.where === 'elsewhere' || pictures.where === 'this PC') return null
  const found = (Array.isArray(clouds) ? clouds : []).find(one => one?.kind === pictures.where && typeof one.path === 'string' && one.path !== '')
  return found === undefined ? null : join(found.path, pictures.folder)
}

/** The `--pictures` flag's answer: "none" (this PC only) or a whole folder (somewhere else). */
export const picturesFlag = flag => String(flag).trim().toLowerCase() === 'none'
  ? { ok: true, pictures: { where: 'this PC' }, picturesHome: '' }
  : picturesAnswer([{ key: '1', where: 'elsewhere', path: null }], { typed: '1', path: flag })

/** Whether setup asks: no `pictures` setting yet, no `--pictures` flag, a keyboard, and not `--check`. */
export const picturesAsked = ({ pictures, flag, isTty, isCheck }) => !isPictures(pictures) && flag === undefined && isTty === true && isCheck !== true

/** `text` (a JSON settings file, or null for none) with `key` set to `value`, keeping its indent and line ends; null when it is no object. */
export function withSetting(text, key, value) {
  const body = String(text ?? '{}').replace(/^\uFEFF/, '') || '{}'
  let raw
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  raw[key] = value
  const indent = /\n([ \t]+)"/.exec(body)?.[1] ?? '  '
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  return `${JSON.stringify(raw, null, indent).replace(/\n/g, eol)}${eol}`
}
