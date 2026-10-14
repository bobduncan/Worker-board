// B191: the board works for any project. The user, 2026-10-14: "first ensure that its clear to all future work that
// this is the constraint if i develop something the worker board". The names of the first project, its chats, its
// folders and its PC may not appear in the board's code, page, job texts or examples, apart from the ties known
// today. Each known tie names the part of ANY-PROJECT-PLAN.md that removes it, and this list only shrinks: a new tie
// fails here, and so does a removed one until its count is lowered.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The kinds of tie: the project's name, its chats' title prefix, this PC's folders and user, the project's picture folder. */
const KINDS = {
  project: /lava[ -]?tactics/gi,
  chat: /Game - /g,
  pc: /C:[\\/]+Web\b|lava-tactics-project|\bbobdu\b/gi,
  folder: /art-inbox/g,
}

/** What the board is made of: its code, its page, its job texts, its examples and settings. Tests and samples are not. */
const IN_SCOPE = /^(?:server\.mjs|run-game\.mjs|config\.json|design\.json|src\/|public\/|roles\/|examples\/)/

/** The ties known on 2026-10-14 (main a8ea248): file, kind, how many, and the plan's part that removes them. */
const KNOWN = [
  ['public/index.html', 'project', 1, 2], ['public/index.html', 'chat', 1, 2],
  ['public/board.js', 'chat', 3, 2],
  ['public/board.css', 'folder', 2, 2],
  ['server.mjs', 'folder', 1, 2],
  ['src/asks.mjs', 'folder', 1, 2],
  ['src/config.mjs', 'folder', 1, 2],
  ['src/finished.mjs', 'chat', 1, 2],
  ['src/handover.mjs', 'folder', 1, 2],
  ['src/pictures.mjs', 'folder', 3, 2],
  ['src/talkPicture.mjs', 'folder', 5, 2],
  ['design.json', 'project', 3, 3], ['design.json', 'folder', 6, 3],
  ['src/design.mjs', 'chat', 1, 3], ['src/design.mjs', 'folder', 2, 3],
  ['examples/main-briefing.md', 'folder', 2, 4],
  ['examples/worker-briefing.md', 'folder', 1, 4],
]

function tiesNow() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter(file => IN_SCOPE.test(file) && !/\.(?:png|webp|jpe?g)$/i.test(file))
  const found = new Map()
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    for (const [kind, pattern] of Object.entries(KINDS)) {
      const count = (text.match(pattern) ?? []).length
      if (count > 0) found.set(`${file} ${kind}`, count)
    }
  }
  return found
}

test('no new tie to the first project, its chats, folders or PC in the board: names come from the settings', () => {
  const known = new Map(KNOWN.map(([file, kind, count, part]) => [`${file} ${kind}`, { count, part }]))
  const problems = []
  for (const [key, count] of tiesNow()) {
    const allowed = known.get(key)
    if (allowed === undefined) problems.push(`${key}: ${count} new; take the name, path or word from the settings or the project's files (ANY-PROJECT-PLAN.md)`)
    else if (count > allowed.count) problems.push(`${key}: ${count}, more than the ${allowed.count} known (part ${allowed.part} removes them); add none`)
  }
  assert.deepEqual(problems, [])
})

test('the list of known ties only shrinks: a tie that is gone is taken off the list', () => {
  const now = tiesNow()
  const stale = KNOWN.filter(([file, kind, count]) => (now.get(`${file} ${kind}`) ?? 0) < count)
    .map(([file, kind, count, part]) => `${file} ${kind}: now ${now.get(`${file} ${kind}`) ?? 0}, listed ${count} (part ${part}): lower it in test/anyProject.test.mjs`)
  assert.deepEqual(stale, [])
  for (const [, , , part] of KNOWN) assert.ok(part >= 1 && part <= 8, 'each tie names a part of the plan')
})
