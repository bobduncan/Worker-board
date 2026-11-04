// 2026-11-04 (the person, in the building chat: "Yes, write them"): what the board's setup may write so that a chat of a new project can
// put a board change live with tools/land.ps1 on its own. Claude Code's auto mode refuses a landing (a push of main, a restart) as a
// "production deploy" unless it is told the board is a local development tool, and it reads that only from the user's own settings
// (`autoMode` in ~/.claude/settings.json); the project's `permissions.allow` lets the one command run with no question. A new project
// gets both on the person's y. Nothing here reads or writes a folder it was not given: `home` is always the caller's (the tests give a
// temporary one), and a settings file that is no JSON is left as it is.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { FORCE_PUSH_DENY, allowCodeJobs, withAllowRules, withDenyRules } from './codeJobs.mjs'

/** The word that stands for Claude Code's own autoMode lines in a list. */
export const DEFAULTS_WORD = '$defaults'

const FILES = { readFile, writeFile, mkdir }
const slashes = path => String(path).replace(/\\/g, '/')
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const plural = (count, one) => `${count} ${one}${count === 1 ? '' : 's'}`

/** The allow rules of the landing script of a board folder, for the Bash and the PowerShell tool: the one command, any branch. */
export const landAllowRules = board => ['Bash', 'PowerShell'].map(tool => `${tool}(powershell -NoProfile -ExecutionPolicy Bypass -File "${slashes(board)}/tools/land.ps1" *)`)

/**
 * The autoMode lines for a project's board, in the words the person uses on their own PC: one for `environment` (the board is a
 * local development tool, its remote is the user's own, pushing main after the tests is how board work lands) and two for `allow`
 * (the landing script, and a restart). `trial` is `{ dir, port }` of a trial copy when there is one; a port not known yet is said so.
 */
export function autoModeLines({ project, board, port = null, trial = null }) {
  const at = port === null ? '<its port>' : String(port)
  const both = word => (trial === null ? `127.0.0.1:${at}` : `127.0.0.1:${at} ${word} ${trial.port}`)
  return {
    environment: [`${project} is the user's personal hobby project. Its worker board (a Node server on 127.0.0.1:${at} in ${board}${trial === null ? '' : `, and a trial copy in ${trial.dir} on 127.0.0.1:${trial.port}`}) is a local development tool on this PC, not a production system. Its git remote is the user's own repository; pushing its main branch after the tests pass is the normal way board work lands.`],
    allow: [
      `Putting a worker-board change live with the board's landing script land.ps1 (fast-forward a tested branch into worker-board main, push main to the user's own repository${trial === null ? '' : ', update the trial copy'}, restart the local boards on ${both('and')}) is routine local development, not a production deploy.`,
      `Restarting the local worker board (node server.mjs or node start-board.mjs in ${board}${trial === null ? '' : ` or ${trial.dir}`}, or POST /api/restart on ${both('or')}) is allowed.`,
    ],
  }
}

/**
 * The settings text with `lines` (`autoMode.environment` and `autoMode.allow`, see `autoModeLines`) added: `{ ok, text, added, changed }`.
 * A line that is there already is not added again; no line is changed or removed; every other key stays, in its place. A list that
 * gets a line also gets "$defaults" first when it has none. A text that is no JSON object is left alone (`ok` false, with why).
 */
export function withAutoMode(text, lines) {
  let read = {}
  const clean = typeof text === 'string' ? text.replace(/^﻿/, '') : ''
  if (clean.trim() !== '') {
    try {
      read = JSON.parse(clean)
    } catch {
      return { ok: false, why: 'your Claude settings.json is no JSON: fix it first' }
    }
    if (!isRecord(read)) return { ok: false, why: 'your Claude settings.json is no JSON object: fix it first' }
  }
  const auto = isRecord(read.autoMode) ? { ...read.autoMode } : {}
  const added = { environment: [], allow: [] }
  for (const key of ['environment', 'allow']) {
    const list = Array.isArray(auto[key]) ? [...auto[key]] : []
    added[key] = lines[key].filter(line => !list.includes(line))
    if (added[key].length === 0) continue
    auto[key] = list.includes(DEFAULTS_WORD) ? [...list, ...added[key]] : [DEFAULTS_WORD, ...list, ...added[key]]
  }
  const changed = added.environment.length + added.allow.length > 0
  return { ok: true, text: changed ? `${JSON.stringify({ ...read, autoMode: auto }, null, 2)}\n` : text, added, changed }
}

const pad = number => String(number).padStart(2, '0')
const stamp = at => `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`

/**
 * Writes the autoMode lines into `<home>/.claude/settings.json`: `{ ok, added, backup, file }`. The old file is copied to
 * `settings.json.bak-<time>` first, byte for byte (`backup` says where); nothing is written, and no backup made, when every line is
 * there already. `home` has no default here: a caller says whose home it is.
 */
export async function addAutoMode({ home, lines, now = new Date(), fs = FILES }) {
  if (typeof home !== 'string' || home === '') throw new Error('addAutoMode needs the home folder it writes into (it never takes the real one by itself)')
  const file = join(home, '.claude', 'settings.json')
  const raw = await fs.readFile(file).catch(error => (error?.code === 'ENOENT' ? null : undefined))
  if (raw === undefined) return { ok: false, why: 'your Claude settings.json cannot be read' }
  const next = withAutoMode(raw === null ? '' : raw.toString('utf8'), lines)
  if (!next.ok) return next
  if (!next.changed) return { ok: true, added: next.added, backup: null, file }
  let backup = null
  if (raw !== null) {
    backup = `${file}.bak-${stamp(now)}`
    await fs.writeFile(backup, raw)
  }
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, next.text, 'utf8')
  return { ok: true, added: next.added, backup, file }
}

/** What is in a settings file (a missing one is empty): its text, or null when it cannot be read. */
const textOf = async (file, fs) => (await fs.readFile(file, 'utf8').catch(error => (error?.code === 'ENOENT' ? '' : null)))

/**
 * What setup would write, as lines to show, reading the files and writing none: the project's allow rules for the board's
 * routine jobs (`codeTools`), the deny rules, the landing script's allow rules, and the autoMode lines of `home`'s Claude settings.
 */
export async function describeSetup({ project, board, port = null, trial = null, home, codeTools = [], fs = FILES }) {
  if (typeof home !== 'string' || home === '') throw new Error('describeSetup needs the home folder it reads')
  const local = join(project, '.claude', 'settings.local.json')
  const settings = join(home, '.claude', 'settings.json')
  const lines = [`The project's settings, ${local}:`]
  const localText = await textOf(local, fs)
  const part = (rules, withRules, what) => {
    const result = localText === null ? null : withRules(localText, rules)
    if (result === null || !result.ok) return `  ${what}: could not be read, nothing would be added`
    const there = rules.length - result.added.length
    return result.added.length === 0 ? `  ${what}: nothing to add (all ${rules.length} are there)` : `  ${plural(result.added.length, 'rule')} would be added: ${what}${there > 0 ? ` (${there} already there)` : ''}`
  }
  if (codeTools.length > 0) lines.push(part(codeTools, withAllowRules, `allow rules for the board's routine jobs`).replace(/^(\s+)(\d+) rule[s]? would be added: allow rules/, '$1$2 allow rules'))
  lines.push(part(FORCE_PUSH_DENY, withDenyRules, 'deny rules for force-pushes, mirror pushes and pushes that force or delete with a refspec').replace(/^(\s+)(\d+) rules? would be added: deny rules/, '$1$2 deny rules'))
  lines.push(part(landAllowRules(board), withAllowRules, 'allow rules for the landing script').replace(/^(\s+)(\d+) rules? would be added: allow rules/, '$1$2 allow rules'))
  lines.push(`Your Claude settings, ${settings} (autoMode is read from there only):`)
  const settingsText = await textOf(settings, fs)
  const planned = settingsText === null ? { ok: false } : withAutoMode(settingsText, autoModeLines({ project, board, port, trial }))
  if (!planned.ok) {
    lines.push('  could not be read as JSON, nothing would be added')
  } else {
    for (const key of ['environment', 'allow']) lines.push(`  autoMode.${key}: ${planned.added[key].length === 0 ? 'nothing to add' : `${plural(planned.added[key].length, 'line')} would be added`}`)
    if (planned.changed) lines.push(`  "${DEFAULTS_WORD}" first in both lists where it is missing; the old file is copied to settings.json.bak-<time> first`)
  }
  return lines
}

/**
 * The landing rules of a new project, on the person's word: `answer` (their reply to the question, or its default), `flag` (the
 * value of --allow-landing, undefined when not given) and `isTty` (a keyboard is there). Without a keyboard only the flag allows it.
 * `check`: says what would be written (`lines`) and writes nothing. Gives `{ wrote: false }` for a no, `{ wrote: true, allowed, auto }`
 * for a yes (`allowed`: the project's rules, `auto`: the Claude settings, each `{ ok, added, ... }` or why not).
 */
export async function setupLanding({ answer, flag, isTty, check = false, project, board, port = null, trial = null, home, now = new Date(), fs = FILES }) {
  if (check) return { wrote: false, check: true, lines: await describeSetup({ project, board, port, trial, home, fs }) }
  const wanted = /^y/i.test(String(answer ?? '').trim()) && (isTty === true || flag !== undefined)
  if (!wanted) return { wrote: false }
  const allowed = await allowCodeJobs({ project, tools: landAllowRules(board), fs })
  const auto = await addAutoMode({ home, lines: autoModeLines({ project, board, port, trial }), now, fs })
  return { wrote: true, allowed, auto }
}
