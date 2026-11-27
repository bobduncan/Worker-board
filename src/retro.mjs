// The Retrospective tab (chat 1's brief, 2026-11-27; the person: "try this retrospective page on the board? after spending. and i
// want to see previous weeks reports as well. with a button to say execute retrospective"). The pages are the weekly
// retrospective's files (<project>/.claude/plans/retro/YYYY-MM-DD.md, written by the app's scheduled task); the board lists them
// and shows one on a click. Its button asks the main chat, with one board word in the outbox, to run the retrospective now: the
// main chat starts one subagent with the task's prompt and does nothing else itself (chat 1: it keeps Main's history short).
// What the board knows of a run is kept in data/retro-run.json; the button's state comes from it, the word and the pages.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** A page's date, and its file name. */
export const RETRO_DATE = /^\d{4}-\d{2}-\d{2}$/
const RETRO_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/

/** A run with no page this long after the main chat took the word did not finish. */
export const RUN_STALE_MS = 3 * 60 * 60 * 1000

/** The pages' folder of a project. */
export const retroFolderOf = project => join(project, '.claude', 'plans', 'retro')

/** A page's "In one line" sentence: the text under that heading (or after "In one line:" on its own line), or null. */
export function oneLineOf(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (!/in one line/i.test(lines[i])) continue
    const after = lines[i].replace(/^#+\s*/, '').replace(/^\d+\.\s*/, '').replace(/^\*\*|\*\*$/g, '').split(/in one line\**\s*[:.]?\s*\**/i)[1]?.trim()
    if (after) return clean(after)
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '') continue
      if (/^#/.test(lines[j])) break
      return clean(lines[j])
    }
  }
  return null
}
const clean = line => line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim()

/** The pages, newest first: `[{ date, oneLine, at }]` (`at`: when its file was written, ms). A missing folder has none. */
export async function listRetros(folder) {
  let names
  try {
    names = await readdir(folder)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
  const pages = []
  for (const name of names) {
    const match = RETRO_FILE.exec(name)
    if (match === null) continue
    const file = join(folder, name)
    const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)])
    pages.push({ date: match[1], oneLine: oneLineOf(text), at: info.mtimeMs })
  }
  return pages.sort((a, b) => (a.date === b.date ? b.at - a.at : a.date < b.date ? 1 : -1))
}

/** One page's text, by its date only (no path from the page); null when there is none. */
export async function readRetro(folder, date) {
  if (typeof date !== 'string' || !RETRO_DATE.test(date)) return null
  try {
    return await readFile(join(folder, `${date}.md`), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** The board's word to the main chat (chat 1's words, 2026-11-27): one subagent runs the task's prompt on demand. */
export function retroWords(to, skill) {
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'retro-run', about: 'retrospective',
    text: [
      'Run the weekly retrospective now, ON DEMAND (the person\'s button on the board\'s Retrospective tab):',
      `start ONE subagent with a fresh context and give it the prompt in ${skill}, telling it to skip that prompt's FIRST check (this run is on demand).`,
      'Do nothing else yourself; when it ends, say done.',
    ].join('\n'),
  }
}

/**
 * The button's state: `idle` (with when the last page was written), `requested` (the word waits for the main chat),
 * `running` (the main chat took it), `unfinished` (taken, and no page RUN_STALE_MS later; or the word was dropped). A page
 * written after the request ends the run. `run`: data/retro-run.json ({ requestedAt, by, to, wordId, takenAt? }).
 */
export function runView({ run = null, pages = [], outbox = [], now = Date.now() } = {}) {
  const lastRanAt = pages.length === 0 ? null : Math.max(...pages.map(page => page.at))
  if (run === null || !Number.isFinite(run.requestedAt)) return { state: 'idle', lastRanAt }
  if (pages.some(page => page.at >= run.requestedAt)) return { state: 'idle', lastRanAt, done: true }
  const word = outbox.find(one => one.id === run.wordId) ?? null
  const base = { by: run.by ?? null, to: run.to ?? null, requestedAt: run.requestedAt, lastRanAt }
  if (word !== null && word.state === 'waiting') return { ...base, state: 'requested', since: run.requestedAt }
  if (word !== null && ['dropped', 'failed', 'refused'].includes(word.state)) return { ...base, state: 'unfinished', since: run.requestedAt, why: word.why ?? `the word to ${run.to ?? 'the main chat'} was not delivered` }
  const since = word?.takenAt ?? run.takenAt ?? run.requestedAt
  if (now - since > RUN_STALE_MS) return { ...base, state: 'unfinished', since, why: `no page ${Math.round(RUN_STALE_MS / 3_600_000)} h after ${run.to ?? 'the main chat'} took it` }
  return { ...base, state: 'running', since }
}

/** Whether a new run may be asked for now: never while one is asked for or runs. */
export const mayRun = view => view.state !== 'requested' && view.state !== 'running'
