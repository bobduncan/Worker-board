// What a chat needs from the person, in a fixed form: one JSON file per ask in `<project>\.claude\asks\`. A chat
// writes its own asks (through the Workers mod) and closes them; the board only reads them. The form:
//
//   { id, from, kind, title, text, at, state,
//     options:  [ { label, picture, isRecommended } ],   a choice to make
//     pictures: [ "<picture folder>/..." ],                      what to look at
//     run:      { url, branch, entry },                   where the work runs on this PC
//     checks:   [ "..." ],                                what to check when verifying
//     tried:    [ "..." ] }                               what was tried before calling for help
//
// kind: "input" (a question that needs the person's words), "verify" (look at finished work and approve or
// reject it), "intervene" (the chat is stuck and says what it needs).

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { readHead } from './files.mjs'

const KINDS = new Set(['input', 'verify', 'intervene'])
const PICTURE = /\.(png|webp|jpe?g|gif)$/i
const ASK_BYTES = 64 * 1024
const MOST_ASKS = 200

const cut = (value, length) => (typeof value === 'string' ? value.trim().slice(0, length) : '')
const texts = (value, most, length) =>
  (Array.isArray(value) ? value : []).map(item => cut(item, length)).filter(item => item !== '').slice(0, most)

/**
 * A picture's path as the board accepts it: relative, inside a folder of the project, a picture by its ending.
 * Whether it lies in a folder the board may show is checked again when it is asked for (see pictures.mjs).
 */
export function picturePath(value) {
  if (typeof value !== 'string') return null
  const path = value.replace(/\\/g, '/')
  if (!PICTURE.test(path) || /[\0:*?"<>|]/.test(path)) return null
  const parts = path.split('/')
  if (parts.length < 2 || parts.some(part => part === '' || part === '.' || part === '..')) return null
  return path
}

/** A link is only made to a page served on this machine: a branch's own game, never a website. */
function localUrl(value) {
  if (typeof value !== 'string') return null
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const isLocal = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.username === '' && url.password === ''
  return isLocal ? url.href : null
}

/** An open ask in the board's shape, or null when the text is not one. */
export function parseAsk(fileText) {
  let raw
  try {
    raw = JSON.parse(fileText)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.state !== undefined && raw.state !== 'open') return null
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.id)) return null
  if (!KINDS.has(raw.kind) || typeof raw.from !== 'string' || raw.from.trim() === '') return null
  const title = cut(raw.title, 160)
  if (title === '') return null

  const run = raw.run !== null && typeof raw.run === 'object'
    ? { url: localUrl(raw.run.url), branch: cut(raw.run.branch, 120) || null, entry: cut(raw.run.entry, 60) || null }
    : null
  return {
    id: raw.id,
    from: raw.from.trim(),
    kind: raw.kind,
    title,
    text: cut(raw.text, 4000),
    at: Number.isFinite(raw.at) ? raw.at : null,
    options: (Array.isArray(raw.options) ? raw.options : [])
      .filter(option => option !== null && typeof option === 'object' && cut(option.label, 120) !== '')
      .slice(0, 6)
      .map(option => ({ label: cut(option.label, 120), picture: picturePath(option.picture), isRecommended: option.isRecommended === true })),
    pictures: (Array.isArray(raw.pictures) ? raw.pictures : []).map(picturePath).filter(path => path !== null).slice(0, 8),
    run,
    checks: texts(raw.checks, 12, 200),
    tried: texts(raw.tried, 8, 300),
  }
}

/** The texts of the ask files in `dir`. A missing folder gives none. */
export async function readAsks(dir) {
  let names
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json')).slice(0, MOST_ASKS)
  } catch {
    return []
  }
  const heads = await Promise.all(names.map(name => readHead(join(dir, name), ASK_BYTES)))
  return heads.filter(head => head !== null && head.isWhole).map(head => head.text)
}
