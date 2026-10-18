// Focus 2: the partner's draft of a focus's vibe and how, sent to the board's POST /api/goals with the key the board
// wrote into the project's .claude/board.json (tools/focus-draft.mjs). Made-up names only.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { draftBody, sendDraft } from '../tools/focus-draft.mjs'

test('the words of the tool become the draft the board takes', () => {
  assert.deepEqual(draftBody(['vibe', 'G6', '--line', 'you read every fight at a glance', '--line', 'hits feel heavy', '--picture', 'pictures/hit.png']), {
    ok: true, body: { command: 'vibe-draft', id: 'G6', lines: ['you read every fight at a glance', 'hits feel heavy'], picture: 'pictures/hit.png' },
  })
  assert.deepEqual(draftBody(['how', 'G6', '--part', 'Hit effects · about 2 h', '--part', 'Danger marks · 3 h · steps B20, B21', '--partner', 'the colours', '--you', 'the sounds']), {
    ok: true, body: { command: 'how-draft', id: 'G6', parts: [{ title: 'Hit effects', size: 'about 2 h', steps: [] }, { title: 'Danger marks', size: '3 h', steps: ['B20', 'B21'] }], partnerDecides: ['the colours'], youDecide: ['the sounds'] },
  })
  assert.equal(draftBody(['vibe', 'six', '--line', 'x']).ok, false)
  assert.equal(draftBody(['look', 'G6']).ok, false)
  assert.equal(draftBody(['vibe', 'G6', '--colour', 'x']).ok, false)
  assert.equal(draftBody(['how', 'G6', '--part']).ok, false)
})

test('it reads where the board is and its key from the project, and says what the board answered', async t => {
  const seen = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      seen.push({ path: req.url, key: req.headers['x-board-key'], type: req.headers['content-type'], body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      const body = seen.at(-1).body
      if (body.id === 'G9') {
        res.writeHead(409)
        return res.end('The vibe is agreed: talk about the how now.')
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const project = await mkdtemp(join(tmpdir(), 'focus-draft-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  assert.match((await sendDraft(['vibe', 'G6', '--line', 'x'], project)).text, /no worker board runs for this project/i)
  await mkdir(join(project, '.claude'))
  await writeFile(join(project, '.claude', 'board.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, key: 'k'.repeat(64) }))
  const sent = await sendDraft(['vibe', 'G6', '--line', 'warm wood'], project)
  assert.deepEqual(sent, { ok: true, text: 'The board keeps the vibe of G6.' })
  assert.deepEqual(seen[0], { path: '/api/goals', key: 'k'.repeat(64), type: 'application/json', body: { command: 'vibe-draft', id: 'G6', lines: ['warm wood'], picture: null } })
  assert.deepEqual(await sendDraft(['vibe', 'G9', '--line', 'x'], project), { ok: false, text: 'The board refused it (409): The vibe is agreed: talk about the how now.' })
})
