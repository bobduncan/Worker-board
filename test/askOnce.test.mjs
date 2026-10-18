// B261: whoever asks the user asks once. The user, 2026-10-15: "i get notified twice if a worker has a question.
// worker once, then again due to the main chat. how do we prevent this?", and "yes" to the worker asking and the main
// chat staying quiet. The job texts say it for any project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const worker = (await readFile(join(ROOT, 'roles', 'worker.md'), 'utf8')).replace(/\s+/g, ' ')
const main = (await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')).replace(/\s+/g, ' ')

test('a worker asks the user with an ask of the work store and says in its report what it asked', () => {
  assert.match(worker, /Whoever asks the user asks once/)
  assert.match(worker, /file it with `work ask` under your step/)
  assert.match(worker, /say in your report in one line what you asked/)
  assert.match(worker, /With nothing to ask, report only: the main chat puts the check to the user itself/)
  // B317: a "For you" item without an ask is filed for it at the turn's end; one answered in the chat it closes.
  assert.match(worker, /filed for you when your turn ends/)
  assert.match(worker, /close it in that turn with `work answered-in-chat Q<id>`/)
})

test('the main chat repeats nothing a worker asked; its "For you" holds its own questions and the checks of a worker that reported only to it', () => {
  assert.match(main, /Whoever asks the user asks once/)
  assert.match(main, /is not repeated in your "For you"/)
  assert.match(main, /holds only your own questions and the checks of a worker that reported only to you, each an ask filed with `work ask`/)
})
