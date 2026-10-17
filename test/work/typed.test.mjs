// B298: a line typed on the board to a chat is filed as an instruction first and carries its id; an answer to a request
// is not one. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { messageText } from '../../src/bridge.mjs'
import { withInstruction } from '../../src/say.mjs'
import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { readStore, writeTruth } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5).getTime()

test('a plain line is filed for its chat and ends with its id; the typed words carry it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-typed-'))
  try {
    await writeTruth(dir, { truth: 'store', since: '2026-10-17 11:00' })
    const file = body => workApi(body, { dir, now: NOW, roleOf: chat => (chat === 'Main' ? 'main' : null), as: 'person' })
    const message = await withInstruction({ to: 'Main', ask: null, step: null, title: null, verdict: null, text: 'Queue the menu' }, file)
    assert.deepEqual([message.text, message.instruction], ['Queue the menu [I1]', 'I1'])
    const filed = (await readStore(dir)).items.get('I1')
    assert.deepEqual(['Chat', 'Via', 'Text'].map(key => valueOf(filed, key)), ['Main', 'board', 'Queue the menu'])
    assert.equal(messageText({ ...message, at: NOW }, () => '11:05'), 'Queue the menu [I1]\n(typed on the worker board, 11:05)')
    // A picture without words is filed by its path.
    const picture = await withInstruction({ to: 'Main', ask: null, text: '', picture: 'pictures/talk/a.png' }, file)
    assert.equal(picture.text, '[I2]')
    assert.equal(valueOf((await readStore(dir)).items.get('I2'), 'Text'), '(a picture: pictures/talk/a.png)')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an answer, a command, and a store that is no truth file nothing: the line goes as it is', async () => {
  let calls = 0
  const file = async () => {
    calls += 1
    return { ok: false, status: 409, why: 'The store is not the truth yet: the cutover has not run' }
  }
  const answer = { to: 'Main', ask: 'chat:Main:5', text: 'yes' }
  assert.equal(await withInstruction(answer, file), answer)
  const command = { to: 'Main', ask: null, command: 'resume', text: 'resume' }
  assert.equal(await withInstruction(command, file), command)
  assert.equal(calls, 0)
  const plain = { to: 'Main', ask: null, text: 'Queue the menu' }
  assert.equal(await withInstruction(plain, file), plain)
  assert.equal(calls, 1)
  // A board whose work API throws sends the line all the same.
  assert.equal(await withInstruction(plain, () => { throw new Error('down') }), plain)
})
