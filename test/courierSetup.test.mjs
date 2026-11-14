// F17 (chat 1, 2026-11-14): setup says on every PC how the wake courier's scheduled task is made, since only a model can make it.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { COURIER_PROMPT, COURIER_TASK, courierLines } from '../src/courierSetup.mjs'

test('setup names the courier task, its prompt file, every 10 minutes, the cheapest model, Auto mode, and that a model makes it with create_scheduled_task', async () => {
  const text = courierLines().join('\n')
  for (const part of [`"${COURIER_TASK}"`, COURIER_PROMPT, 'every 10 minutes', 'cheapest model', 'Auto mode', 'create_scheduled_task', 'code cannot create a scheduled task']) assert.ok(text.includes(part), part)
  assert.match(await readFile(new URL('../setup.mjs', import.meta.url), 'utf8'), /for \(const line of courierLines\(courierProject\)\) console\.log\(line\)/)
  assert.match(await readFile(new URL('../README.md', import.meta.url), 'utf8'), /Worker board wake courier[\s\S]{0,400}create_scheduled_task/)
  assert.match(await readFile(new URL(`../${COURIER_PROMPT}`, import.meta.url), 'utf8'), /a 404 means this board has no courier route yet\), stop at once/)
})

test('F17, chat 1: the prompt names no PC\'s path (the any-project rule); setup prints the board file of this PC\'s project to put in its place', async () => {
  assert.doesNotMatch(await readFile(new URL(`../${COURIER_PROMPT}`, import.meta.url), 'utf8'), /[A-Z]:\\/)
  assert.ok(courierLines('C:\\garden\\').some(line => line.endsWith(': C:\\garden\\.claude\\board.json')))
  assert.equal(courierLines(null).some(line => line.includes('board.json:')), false)
})
