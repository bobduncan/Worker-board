// Goal definition (2026-10-31): the goal map's lines about a goal's definition were named `Vibe`, `Vibe picture` and
// `Vibe agreed`; the board writes `Goal definition`, `Goal definition picture` and `Goal definition agreed` now, and
// reads both (src/goals.mjs). This renames the old names in a goals.md in one go, so the file reads the same everywhere.
//
//   node tools/migrate-vibe-lines.mjs <goals.md path> [--dry-run]
//
// Only an indented line that begins with one of the three old names and a colon is changed (the lines under a goal);
// every other byte stays, the line endings and a byte order mark too (the file is read and written byte for byte). It
// prints how many lines it changed, and writes the file only when there is one. --dry-run counts and writes nothing.
// Run it when the board is not changing the file (stop the board first), and keep a copy.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The old name of each line, and the name that replaces it. */
export const RENAMED = { 'Vibe picture': 'Goal definition picture', 'Vibe agreed': 'Goal definition agreed', Vibe: 'Goal definition' }

const OLD_LINE = /^([ \t]+)(Vibe picture|Vibe agreed|Vibe)(?=:)/gm

/** The text with the three names renamed, and how many lines that changed: `{ text, changed }`. */
export function migrateVibeLines(text) {
  let changed = 0
  const migrated = text.replace(OLD_LINE, (_all, lead, name) => {
    changed += 1
    return `${lead}${RENAMED[name]}`
  })
  return { text: migrated, changed }
}

/** The command: arguments in, an exit code out (0 done or nothing to do, 1 a file that cannot be read or written, 2 the usage). */
export async function run(args, { log = console.log } = {}) {
  const dry = args.includes('--dry-run')
  const paths = args.filter(one => one !== '--dry-run')
  if (paths.length !== 1) {
    log('Usage: node tools/migrate-vibe-lines.mjs <goals.md path> [--dry-run]')
    return 2
  }
  const file = resolve(paths[0])
  // Latin-1 reads and writes every byte as it is (the names it looks for are plain ASCII), so no other byte can change.
  let text
  try {
    text = await readFile(file, 'latin1')
  } catch (error) {
    log(`Cannot read ${file}: ${error.code ?? error.message}`)
    return 1
  }
  const { text: migrated, changed } = migrateVibeLines(text)
  if (changed > 0 && !dry) {
    try {
      await writeFile(file, migrated, 'latin1')
    } catch (error) {
      log(`Cannot write ${file}: ${error.code ?? error.message}`)
      return 1
    }
  }
  log(`${dry ? 'Would change' : 'Changed'} ${changed} line${changed === 1 ? '' : 's'} in ${file}.`)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2))
}
