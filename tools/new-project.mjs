// B320: `npm run new` makes a new project, as the board's New project button does (src/newProject.mjs): it asks the
// project's name, its folder and the chats' prefix once, then makes the folder, its own copy of the board, its work
// store, its icon on the desktop and in the Start menu, and starts its board. Windows only.
//
//   npm run new
//   npm run new -- --name "My garden" --folder "D:\Work\My garden" --prefix "Garden - "
//   npm run new -- ... --allow-code yes     B767: the board's code does the main chat's routine jobs (asked otherwise)

import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { CODE_JOBS, allowCodeJobs } from '../src/codeJobs.mjs'
import { loadConfig } from '../src/config.mjs'
import { checkNewProject, makeProject } from '../src/newProject.mjs'

const BOARD = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const given = name => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined)

if (process.platform !== 'win32') {
  console.error('A new project is made on Windows only.')
  process.exit(1)
}

// A new project's folder is suggested beside this board's project, else in the person's Projects folder.
const config = await loadConfig(join(BOARD, 'config.json')).catch(() => null)
const parent = config?.project ? dirname(resolve(BOARD, config.project)) : join(homedir(), 'Projects')

const asking = createInterface({ input: process.stdin, output: process.stdout })
// An answer as typed; only an empty one takes the suggestion. A prefix keeps its last space ("Garden - ").
const ask = async (question, fallback, keepEnd = false) => {
  if (!process.stdin.isTTY) return fallback
  const answer = await asking.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)
  const typed = keepEnd ? answer.replace(/^\s+/, '') : answer.trim()
  return typed.trim() === '' ? fallback : typed
}
let name = given('name') ?? ''
for (;;) {
  const checked = checkNewProject({ name, folder: join(parent, 'x') })
  if (checked.ok) break
  if (name !== '') console.error(checked.why)
  if (!process.stdin.isTTY) {
    console.error('Give the project\'s name with --name.')
    process.exit(1)
  }
  name = await ask('The project\'s name', '')
}
const folder = given('folder') ?? await ask('Its folder (new or empty)', join(parent, name.trim()))
const prefix = given('prefix') ?? await ask('The chats\' titles start with', `${name.trim()} - `, true)
// B767: the app lets a chat's code do the main chat's routine jobs only with allow rules in the project's settings,
// so it is asked once here; without a keyboard only --allow-code yes allows them. T14: send_message among them, which a
// chat in Auto mode (the worker routines) needs to wake, start and resume other chats by code.
const CODE_TOOLS = CODE_JOBS.flatMap(job => job.tools)
const allowCode = /^y/i.test((given('allow-code') ?? await ask(`May the board start, wake and restart its chats and set their model by itself? It adds ${CODE_TOOLS.length} tool permissions to the new project's own settings. y/n`, 'y')).trim())
  && (process.stdin.isTTY || given('allow-code') !== undefined)
asking.close()

console.log('Making the project: its folder, its copy of the board, its icon (this takes a few seconds)…')
const made = await makeProject({ name, folder, prefix, here: BOARD })
if (!made.ok) {
  console.error(made.why)
  process.exit(1)
}
for (const line of made.lines) console.log(line)
if (allowCode) {
  const allowed = await allowCodeJobs({ project: folder, tools: CODE_TOOLS })
  console.log(allowed.ok ? `The board's code may do the main chat's routine jobs: ${allowed.added.length} tools allowed in the project's .claude\\settings.local.json.` : `The routine jobs stay the main chat's: ${allowed.why}`)
}
