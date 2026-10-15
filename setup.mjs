// B251: `npm run setup` installs the Workers mod from this folder (`mods/`) for the person, with the Claude app's own
// command-line program; a copy installed already is recognised and left as it is. `npm run setup -- --check` only
// says what it would do. The parts are in src/setup.mjs.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findClaude, runSetup } from './src/setup.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const claude = await findClaude()
if (claude === null) {
  console.log('Setup could not find the Claude app\'s command-line program. Install the Claude desktop app and open it once '
    + '(or install `claude` apart, on the PATH), then run setup again.')
  process.exit(1)
}
console.log(`The Claude app's program: ${claude}`)
const { ok, lines } = await runSetup({ command: [claude], modsDir: join(here, 'mods'), isCheck: process.argv.includes('--check') })
for (const line of lines) console.log(line)
process.exitCode = ok ? 0 : 1
