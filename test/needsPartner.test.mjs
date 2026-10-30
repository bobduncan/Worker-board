// Focus 4 (spec 2026-10-18, sections 2 and 4): Needs your attention shows the partner's open questions first, under
// "From your partner": its asks of the focus goal and its steps (in the order the focus shows them), then any other
// ask whose Owner is the partner's chat; the workers' asks follow as before. The server marks a card the partner's
// (`isPartner`, from the setting advisor); the page groups (`partnerFirst`, cut out of board.js). Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { markPartner } from '../src/state.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const cut = script.slice(script.indexOf('// partner-needs:start'), script.indexOf('// partner-needs:end'))
const made = {}
vm.runInNewContext(`${cut}\nObject.assign(this, { partnerFirst, PARTNER_GROUP })`, made)
const ids = list => Array.from(list, need => need.id)

const NEEDS = [
  { id: 'work:Q9', workId: 'Q9', from: 'Worker 2', at: 9 },
  { id: 'work:Q7', workId: 'Q7', from: 'Partner', at: 8 },
  { id: 'work:Q3', workId: 'Q3', from: 'Partner', at: 7 },
  { id: 'chat:Worker 1:5', from: 'Worker 1', at: 6 },
  { id: 'work:Q5', workId: 'Q5', from: 'Partner', at: 5 },
  { id: 'work:Q2', workId: 'Q2', from: 'Main', at: 4 },
]

test('the server marks the partner\'s cards by the chat the setting advisor names, with or without the prefix', () => {
  const marked = markPartner([...NEEDS, { id: 'work:Q8', from: 'Game - Partner' }, { id: 'quiet:x', from: null }], 'Partner', 'Game - ')
  assert.deepEqual(marked.filter(need => need.isPartner).map(need => need.id), ['work:Q7', 'work:Q3', 'work:Q5', 'work:Q8'])
  assert.ok(marked.filter(need => !need.isPartner).every(need => need.isPartner === false))
  // No partner on the board: nobody's card is the partner's.
  assert.ok(markPartner(NEEDS, null, 'Game - ').every(need => need.isPartner === false))
  assert.ok(markPartner(NEEDS, '', 'Game - ').every(need => need.isPartner === false))
})

test('the partner\'s asks stand first under their own group; the focus\'s asks first among them, in the focus\'s order', () => {
  const marked = markPartner(NEEDS, 'Partner', '')
  // The focus names Q5 and Q3 (Q5 first: its daily note names it first); Q7 is the partner's ask of another goal.
  const { partner, rest } = made.partnerFirst(marked, ['Q5', 'Q3'])
  assert.deepEqual(ids(partner), ['work:Q5', 'work:Q3', 'work:Q7'])
  // The rest keep the order they came in (the order the person chose).
  assert.deepEqual(ids(rest), ['work:Q9', 'chat:Worker 1:5', 'work:Q2'])
  assert.equal(made.PARTNER_GROUP, 'From your partner')
})

test('no focus: the partner\'s asks in the order they came; none of the partner\'s: no group', () => {
  const marked = markPartner(NEEDS, 'Partner', '')
  assert.deepEqual(ids(made.partnerFirst(marked, []).partner), ['work:Q7', 'work:Q3', 'work:Q5'])
  assert.deepEqual(ids(made.partnerFirst(marked, null).partner), ['work:Q7', 'work:Q3', 'work:Q5'])
  const none = made.partnerFirst(markPartner(NEEDS, null, ''), ['Q5'])
  assert.deepEqual(ids(none.partner), [])
  assert.deepEqual(ids(none.rest), ids(NEEDS))
})

test('the inbox draws the partner\'s group first, before every other part, and the state marks its cards', async () => {
  const draw = script.slice(script.indexOf('function drawNeeds(state)'), script.indexOf('/** Who runs and who was asked'))
  assert.match(draw, /partnerFirst\(/)
  // B775: only the quiet "Find obsolete items" line stands above it (the person's own tool, not a question).
  assert.match(draw, /fill\(box, \[none, drawObsolete\(state\), drawPartnerNeeds\(/)
  const state = await readFile(join(ROOT, 'src', 'state.mjs'), 'utf8')
  assert.match(state, /forYou: markPartner\(\[/)
})
