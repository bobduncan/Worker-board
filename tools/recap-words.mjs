// B591: writes plain card words into recaps whose words were cut from an old report (made before B569, or from a report
// that had no Context and Change), so every card the board shows reads as the agreed one (Q352). The words come from a
// JSON file outside the repository: { "N598": { "title": "...", "context": "...", "change": "..." }, ... } ("title" only
// where the step's title reads as jargon). Each recap is checked as a report's words are (recap.mjs `rewriteRecap`) and
// written only while its file is as it was read; a History line says who rewrote it.
// Usage: node tools/recap-words.mjs <work folder> <words.json> [--who <name>] [--dry]

import { readFile } from 'node:fs/promises'

import { rewriteRecap } from '../src/work/recap.mjs'
import { appendHistory, readItemFile, writeItem } from '../src/work/store.mjs'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const [dir, wordsFile] = args.filter((one, at) => !one.startsWith('--') && args[at - 1] !== '--who')
if (!dir || !wordsFile) {
  console.error('Usage: node tools/recap-words.mjs <work folder> <words.json> [--who <name>] [--dry]')
  process.exit(2)
}
const who = option('--who') ?? 'board'
const words = JSON.parse((await readFile(wordsFile, 'utf8')).replace(/^﻿/, ''))
let failed = 0
for (const [id, said] of Object.entries(words)) {
  const file = await readItemFile(dir, id)
  if (file === null) {
    console.log(`${id}: no such item`)
    failed += 1
    continue
  }
  const about = (file.item.sections.get('About') ?? [])[0]
  const step = about === undefined ? null : await readItemFile(dir, about)
  const done = rewriteRecap(file.item, said, step?.item)
  if (!done.ok) {
    console.log(done.why)
    failed += 1
    continue
  }
  if (flag('--dry')) {
    console.log(`${id}: ok`)
    continue
  }
  const written = await writeItem(dir, appendHistory(done.item, who, 'card words rewritten in the short form', Date.now()), undefined, { expected: file.text })
  console.log(written.ok === false ? `${id}: not written (${written.why ?? 'its file changed'})` : `${id}: rewritten`)
  if (written.ok === false) failed += 1
}
process.exit(failed === 0 ? 0 : 1)
