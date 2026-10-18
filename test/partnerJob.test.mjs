// Focus 2 (spec 2026-10-18, sections 2 and 3): the Advisor's chat works as the partner, from roles/partner.md; the
// board names that file wherever it names the chat's job, and roles/advisor.md only points there.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../src/config.mjs'
import { recheckText, roundText } from '../src/rounds.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const plain = async name => (await readFile(join(ROOT, 'roles', name), 'utf8')).replace(/\s+/g, ' ')
const partner = await plain('partner.md')
const main = await plain('main.md')
const protocol = await plain('protocol.md')

test('roles/advisor.md only points to partner.md, so a running chat that reads the old path finds the new one', async () => {
  const old = await readFile(join(ROOT, 'roles', 'advisor.md'), 'utf8')
  assert.ok(old.trim().split('\n').length <= 3)
  assert.match(old, /`partner\.md` beside this file/)
})

test('the board names partner.md as the chat\'s job in its rounds, and nowhere names advisor.md any more', async () => {
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  assert.match(roundText('morning', { board: 'C:\\board', config }), /\nYour job: C:\\board[\\/]roles[\\/]partner\.md\n/)
  assert.match(recheckText({ board: 'C:\\board', config }), /\nYour job: C:\\board[\\/]roles[\\/]partner\.md\n/)
  const named = []
  for (const dir of ['src', 'src/work', 'public']) {
    for (const name of (await readdir(join(ROOT, dir))).filter(one => /\.(?:mjs|js|html)$/.test(one))) {
      if ((await readFile(join(ROOT, dir, name), 'utf8')).includes('advisor.md')) named.push(`${dir}/${name}`)
    }
  }
  if ((await readFile(join(ROOT, 'server.mjs'), 'utf8')).includes('advisor.md')) named.push('server.mjs')
  assert.deepEqual(named, [])
})

test('the partner keeps the Advisor\'s refining, goal linking and rounds, and adds the focus\'s three moves', () => {
  for (const kept of ['## Refine a step', '## Steps under no goal', '## Your rounds', '## A brainstorm', '## Asks from the goal map', 'Whoever asks the user asks once']) assert.ok(partner.includes(kept), kept)
  assert.match(partner, /## The focus/)
  assert.match(partner, /`work vibe-draft` \(`goal` G<n>, `lines`, `picture`\)/)
  assert.match(partner, /`work how-draft` \(`goal` G<n>, `parts`, `partnerDecides`, `youDecide`\)/)
  // The partner, as every chat, never reads or uses the board's own file.
  assert.doesNotMatch(partner, /board\.json|focus-draft/)
  assert.match(partner, /\*\*Nothing is built in this move\*\*/)
  assert.match(partner, /`vibe: agreed`/)
  assert.match(partner, /`vibe: not yet` with `Words: \.\.\.`/)
  assert.match(partner, /`how: go`/)
  assert.match(partner, /`work new` with a title/)
  assert.match(partner, /`goal` G<n>/)
  assert.match(partner, /each is made refined at once: give `work new` also `summary`, `what`/)
  assert.match(partner, /each part with ` · steps B<id>, B<id>` added/)
  assert.match(partner, /`work note --to main` "Queue for G<n>/)
  assert.match(partner, /Never write `Focus:`, `Vibe agreed:` or `How agreed:` yourself/)
})

test('the main chat sends planning questions to the partner and queues the steps it makes', () => {
  assert.match(main, /## The partner \(its job: `partner\.md` beside this file/)
  assert.match(main, /Planning questions go to the partner, not to the user/)
  assert.match(main, /"Queue for G<n>/)
  assert.match(main, /A step the partner made from a how\s+the user agreed is refined when made/)
  assert.doesNotMatch(main, /advisor\.md/)
})

test('the protocol lists the focus\'s lines in the goal map and the words the board types to the partner', () => {
  for (const words of ['`Focus: G<n>`', '`Vibe: <one line>`', '`Vibe picture: <path>`', '`Vibe agreed: <date time>`', '`Part: <title> · <size> · steps B<n>, B<n>`', '`Partner decides: <one line>`', '`You decide: <one line>`', '`How agreed: <date time>`']) assert.ok(protocol.includes(words), words)
  for (const words of ['`focus: G<n> <title>`', '`vibe: agreed`', '`vibe: not yet`', '`how: go`', '`how: not yet`', '`Queue for G<n>']) assert.ok(protocol.includes(words), words)
  assert.match(protocol, /`work vibe-draft` \(`goal`, `lines`, `picture`\), `work how-draft` \(`goal`, `parts`, `partnerDecides`, `youDecide`\)/)
  assert.doesNotMatch(protocol, /focus-draft/)
  assert.doesNotMatch(protocol, /advisor\.md/)
})
