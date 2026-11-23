// T5.2 A6b (the design of 2026-11-16, section 3 "Rules files"; chat 1's switch-on plan, A6): the chat home's rules files once the
// board's data lives in `<data>`. The chats keep running in the chat home, so the files they read there become pointers to the copies
// kept with the data (`<data>/home/...`): CLAUDE.md one @import line, the two briefings one line each (the Workers mod names their old
// place, mods/workers/hooks/chats.ts, so the files stay where they were). A few files are one-way copies of a template in `<data>/home`.
// A file that differs from what it should be is shown in one amber line with two buttons: "Write again" (what it should be, into the
// chat home) and "Copy this PC's into the template" (the chat home's own text into `<data>/home`). Only on the person's click; the
// board never writes either way by itself. With `data` unset there are no home files: today's files, untouched.

import { access, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { loadConfig } from './config.mjs'
import { chatFile, chatHomeOf, dataOf, wordsPath } from './projectPaths.mjs'
import { writeAtomic } from './write.mjs'

/**
 * The pointer files: where each lies in the chat home (`top` at its top, `chat` in its chats' settings folder, through chatFile) and
 * the words that point a chat at its copy in `<data>/home`.
 */
const POINTERS = Object.freeze([
  { top: 'CLAUDE.md', words: to => `@${to}\n` },
  { chat: ['main-briefing.md'], words: to => `Your briefing as the main chat is in ${to}: read it there.\n` },
  { chat: ['worker-briefing.md'], words: to => `Your briefing as a worker is in ${to}: read it there.\n` },
])
/** The one-way copies: the chat home's file is the same path under `<data>/home` as it is (the person and Main may edit the chat home's). */
const COPIES = Object.freeze([{ top: 'AGENTS.md' }, { chat: ['chats', 'list.json'] }, { chat: ['start.json'] }])

const slashes = path => String(path).replace(/\\/g, '/')
const same = (a, b) => String(a).replace(/\r\n/g, '\n').replace(/\s+$/, '') === String(b).replace(/\r\n/g, '\n').replace(/\s+$/, '')

/**
 * The home files of `config`: `[{ name, kind: 'pointer'|'copy', file, template }]`, or [] with `data` unset (today's layout) or no chat
 * home. `file` the chat home's, `template` the one in `<data>/home`. PURE.
 */
export function homeFilesOf(config) {
  const data = dataOf(config)
  const home = chatHomeOf(config)
  if (data === null || home === '') return []
  const placed = (one, kind) => {
    const file = one.top === undefined ? chatFile(config, ...one.chat) : join(home, one.top)
    const path = relative(home, file)
    return { name: slashes(path), kind, file, template: join(data, 'home', path), words: one.words ?? null }
  }
  return [...POINTERS.map(one => placed(one, 'pointer')), ...COPIES.map(one => placed(one, 'copy'))]
}

/** What the chat home's file should hold: the pointer's line, or the template's text (null: no template). PURE. */
export function wanted(entry, home, templateText) {
  if (entry.kind === 'pointer') return entry.words(wordsPath({ chatHome: home }, entry.template))
  return templateText
}

/**
 * The state of one home file from what is on disk (null: not there): 'same', 'differs', 'missing' (no chat-home file) or 'no template'
 * (nothing in `<data>/home` to point at or copy: setup and the move make it, nothing to show). PURE.
 */
export function homeFileState(entry, home, { text, templateText }) {
  if (templateText === null) return 'no template'
  if (text === null) return 'missing'
  return same(text, wanted(entry, home, templateText)) ? 'same' : 'differs'
}

const readOr = file => readFile(file, 'utf8').catch(error => (error?.code === 'ENOENT' ? null : Promise.reject(error)))

/** Every home file with its state: `[{ name, kind, state }]` ([] with `data` unset). A file it cannot read is 'unreadable'. */
export async function homeFilesNow(config) {
  const home = chatHomeOf(config)
  const out = []
  for (const entry of homeFilesOf(config)) {
    try {
      const [text, templateText] = [await readOr(entry.file), await readOr(entry.template)]
      out.push({ name: entry.name, kind: entry.kind, state: homeFileState(entry, home, { text, templateText }) })
    } catch {
      out.push({ name: entry.name, kind: entry.kind, state: 'unreadable' })
    }
  }
  return out
}

/** Setup: writes each missing pointer whose template is there; never a file that is there. `{ written: [name], lines }`. */
export async function writeMissingPointers(config) {
  const home = chatHomeOf(config)
  const written = []
  for (const entry of homeFilesOf(config).filter(one => one.kind === 'pointer')) {
    const [text, templateText] = [await readOr(entry.file), await readOr(entry.template)]
    if (text !== null || templateText === null) continue
    await mkdir(dirname(entry.file), { recursive: true })
    await writeAtomic(entry.file, wanted(entry, home, templateText))
    written.push(entry.name)
  }
  return { written, lines: written.map(name => `Wrote ${name} in the chat home: it points at its copy with the board's data.`) }
}

/**
 * The person's click on a home file's amber line: `action` 'write' (what it should be, into the chat home) or 'adopt' (the chat
 * home's text into the template; a pointer file then gets its pointer back). `{ ok, result }` or `{ ok: false, status, why }`.
 */
export async function fixHomeFile(config, { name, action } = {}) {
  const entry = homeFilesOf(config).find(one => one.name === name)
  if (entry === undefined) return { ok: false, status: 400, why: `${name} is no home file of this board.` }
  if (action !== 'write' && action !== 'adopt') return { ok: false, status: 400, why: 'The action is "write" or "adopt".' }
  const home = chatHomeOf(config)
  const [text, templateText] = [await readOr(entry.file), await readOr(entry.template)]
  if (action === 'write') {
    if (templateText === null) return { ok: false, status: 409, why: `There is no template ${slashes(entry.template)} to write ${name} from.` }
    await mkdir(dirname(entry.file), { recursive: true })
    await writeAtomic(entry.file, wanted(entry, home, templateText))
    return { ok: true, result: { name, action, state: 'same' } }
  }
  if (text === null) return { ok: false, status: 409, why: `The chat home has no ${name} to copy into the template.` }
  await mkdir(dirname(entry.template), { recursive: true })
  await writeAtomic(entry.template, text)
  if (entry.kind === 'pointer') await writeAtomic(entry.file, wanted(entry, home, text))
  return { ok: true, result: { name, action, state: 'same' } }
}

/**
 * Setup's home-files part: with `data` set, the pointers the chat home lacks (never one that is there); `--check` only names them. It
 * never makes config.json (no file: nothing to do yet). `{ ok, lines }`.
 */
export async function homeFilesPart({ boardDir, isCheck, env = process.env }) {
  const configFile = join(boardDir, 'config.json')
  if (!(await access(configFile).then(() => true, () => false))) return { ok: true, lines: [] }
  let config
  try {
    config = await loadConfig(configFile, env)
  } catch (error) {
    return { ok: true, lines: [`The home files part is skipped: ${error.message}`] }
  }
  if (dataOf(config) === null) return { ok: true, lines: [] }
  if (isCheck) {
    const now = await homeFilesNow(config)
    const missing = now.filter(one => one.kind === 'pointer' && one.state === 'missing').map(one => one.name)
    return { ok: true, lines: missing.length === 0 ? [] : [`Setup would write ${missing.join(', ')} in the chat home (pointers at their copies with the board's data).`] }
  }
  try {
    return { ok: true, lines: (await writeMissingPointers(config)).lines }
  } catch (error) {
    return { ok: false, lines: [`The home files were not written: ${error instanceof Error ? error.message : 'unknown'}`] }
  }
}
