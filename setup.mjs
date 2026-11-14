// B251: `npm run setup` installs the Workers mod from this folder (`mods/`) for the person, with the Claude app's own
// command-line program; a copy installed already is recognised and left as it is. The parts are in src/setup.mjs.
// 2026-11-05: it also brings the project's flow.json (the work folder of config.json) up to date with the moves the board's code
// needs (src/flowSetup.mjs): it shows them, asks y/n (without a keyboard only `--flow yes` writes), keeps the person's own moves
// and copies the old file to flow.json.bak-<time> first. The two parts are independent. `npm run setup -- --check` only says what
// it would do, for both parts, and writes nothing.
// F10 (2026-11-14): a third part, the boards' watcher: a Windows scheduled task (src/watcherSetup.mjs) that starts a board again when
// an app update or a crash ended it; `--watcher off` removes it; `--check` says its state.

import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'

import { loadConfig, workFolder } from './src/config.mjs'
import { describeFlow, setupFlow } from './src/flowSetup.mjs'
import { findClaude, runSetup } from './src/setup.mjs'
import { setupWatcher } from './src/watcherSetup.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const isCheck = args.includes('--check')
const given = name => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
let good = true

// The mod part.
const claude = await findClaude()
if (claude === null) {
  console.log('Setup could not find the Claude app\'s command-line program. Install the Claude desktop app and open it once '
    + '(or install `claude` apart, on the PATH), then run setup again.')
  good = false
} else {
  console.log(`The Claude app's program: ${claude}`)
  const { ok, lines } = await runSetup({ command: [claude], modsDir: join(here, 'mods'), isCheck })
  for (const line of lines) console.log(line)
  if (!ok) good = false
}

// The flow part.
let file = null
try {
  file = join(workFolder(await loadConfig(join(here, 'config.json'))), 'flow.json')
} catch (error) {
  console.log(`The flow part is skipped: ${error.message}`)
}
if (file !== null) {
  const lines = await describeFlow({ file })
  for (const line of lines) console.log(line)
  const missing = lines.some(line => /would be added:$/.test(line))
  if (isCheck) {
    console.log('Nothing is written: this is what your y would add.')
  } else if (missing) {
    const flag = given('flow')
    let answer = flag ?? 'y'
    if (flag === undefined && process.stdin.isTTY) {
      const asking = createInterface({ input: process.stdin, output: process.stdout })
      const typed = (await asking.question('Add them to your project\'s flow.json? Your own moves stay as they are; the old file is kept as a backup. y/n [y]: ')).trim()
      asking.close()
      answer = typed === '' ? 'y' : typed
    }
    const done = await setupFlow({ answer, flag, isTty: Boolean(process.stdin.isTTY), file })
    if (!done.wrote) console.log(flag === undefined && !process.stdin.isTTY ? 'No keyboard here: nothing changed (say --flow yes to add them).' : 'Nothing changed.')
    else if (!done.ok) {
      console.log(`Nothing changed: ${done.why}`)
      good = false
    } else if (done.backup === null) console.log('Nothing changed.')
    else console.log(`Added ${done.added.length} move${done.added.length === 1 ? '' : 's'}${done.states.length === 0 ? '' : ` and ${done.states.length} state${done.states.length === 1 ? '' : 's'}`} to ${done.file}; the old file is kept as ${done.backup}`)
  }
}
// F10: the watcher part (Windows only): the scheduled task that brings a dead board back.
if (process.platform === 'win32') {
  const runProgram = (program, programArgs) => new Promise(resolve => {
    const child = spawn(program, programArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk })
    child.on('error', error => resolve({ code: 1, out, err: error.message }))
    child.on('exit', code => resolve({ code: code ?? 1, out, err }))
  })
  let project = here
  try {
    project = (await loadConfig(join(here, 'config.json'))).project || here
  } catch {
    // the folder's own name then
  }
  const user = `${process.env.USERDOMAIN ?? ''}${process.env.USERDOMAIN ? '\\' : ''}${userInfo().username}`
  const watcher = await setupWatcher({
    mode: isCheck ? 'check' : given('watcher') === 'off' ? 'off' : 'on', isExplicit: given('watcher') === 'on',
    home: process.env.WORKER_BOARD_HOME || join(homedir(), '.worker-board'), node: process.execPath, script: join(here, 'tools', 'watch-boards.mjs'), user,
    run: runProgram, write: async (file, bytes) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes) },
    exists: async file => { try { await access(file); return true } catch { return false } }, remove: file => rm(file, { force: true }), read: file => readFile(file, 'utf8').catch(() => null),
  })
  for (const line of watcher.lines) console.log(line)
  if (!watcher.ok) good = false
} else console.log('The watcher part is for Windows alone: skipped.')

process.exitCode = good ? 0 : 1
