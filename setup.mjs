// B251: `npm run setup` installs the Workers mod from this folder (`mods/`) for the person, with the Claude app's own
// command-line program; a copy installed already is recognised and left as it is. The parts are in src/setup.mjs.
// 2026-11-05: it also brings the project's flow.json (the work folder of config.json) up to date with the moves the board's code
// needs (src/flowSetup.mjs): it shows them, asks y/n (without a keyboard only `--flow yes` writes), keeps the person's own moves
// and copies the old file to flow.json.bak-<time> first. The two parts are independent. `npm run setup -- --check` only says what
// it would do, for both parts, and writes nothing.

import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import { loadConfig, workFolder } from './src/config.mjs'
import { describeFlow, setupFlow } from './src/flowSetup.mjs'
import { findClaude, runSetup } from './src/setup.mjs'

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
process.exitCode = good ? 0 : 1
