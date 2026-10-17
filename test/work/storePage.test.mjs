// B299: the page once the store is the truth: an ask's card says its kind and what it blocks and is answered through
// POST /api/work; Information lists notes with "Read"; a step's window shows its item in the agreed order; a lane names
// its step by the store's title. The page's own code, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { itemOfStep } from '../../src/work/shadow.mjs'
import { parseItem } from '../../src/work/item.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = (start, end) => script.slice(script.indexOf(start), script.indexOf(end))
const page = {}
vm.runInNewContext(`${cut('// storeasks:start', '// storeasks:end')}\n${cut('// item:start', '// item:end')}\n${cut('function laneTaskOf', 'const SHORT_TASK_CHARS')}
this.storeAskParts = storeAskParts; this.informationRows = informationRows; this.itemPartsOf = itemPartsOf; this.laneTaskOf = laneTaskOf`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const ask = { id: 'work:Q4', workId: 'Q4', asks: 'look', of: 'B1', ofTitle: 'Draw the strip', blocking: true, blocks: [{ step: 'B1', owner: 'Board' }], isForm: false, isRefine: false, play: 'b1-strip&screen=shop' }

test('a store ask\'s card: its own kind, what it blocks and who waits, its play link', () => {
  assert.deepEqual(plain(page.storeAskParts(ask)), { id: 'Q4', tag: 'Look', blocks: 'blocks B1 · Board waits', play: '/#play=b1-strip&screen=shop', withdraw: false })
  assert.deepEqual(plain(page.storeAskParts({ ...ask, asks: 'decide', blocking: false, blocks: [], isRefine: true, play: null })), { id: 'Q4', tag: 'Decide · refine', blocks: 'on B1 Draw the strip', play: null, withdraw: false })
  assert.equal(page.storeAskParts({ ...ask, of: null, blocks: [], isForm: true }).blocks, null)
  assert.equal(page.storeAskParts({ id: 'chat:Board:5' }), null)
})

test('the answer to a store ask goes to POST /api/work as "answer"; Read goes there too', () => {
  assert.match(script, /if \(need\.workId !== undefined\) return sendWork\(\{ action: 'answer', id: need\.workId, verdict, text \}, id\)/)
  assert.match(script, /sendWork\(\{ action: 'read', id: read\.dataset\.read \}/)
  assert.match(script, /await fetch\('\/api\/work', \{\n\s+method: 'POST',\n\s+headers: \{ 'Content-Type': 'application\/json', 'X-Board-Token': TOKEN \}/)
})

test('Information: one line per note, who said it and about what', () => {
  assert.deepEqual(plain(page.informationRows([{ id: 'N2', from: 'Board', to: 'main', text: 'B1 reported', about: 'B1', since: 5, isRead: false }])), [{ id: 'N2', text: 'B1 reported', isRead: false, head: 'Board → Main · B1', at: 5 }])
  assert.deepEqual(plain(page.informationRows(undefined)), [])
})

const ITEM = [
  'Id: B1', 'Kind: step', 'Title: Draw the strip', 'State: in progress', 'Owner: Board', 'Goal: G4', 'Since: 2026-10-17 11:05', '',
  '## Summary', 'One strip per step.', '', '## Picture', 'art-inbox/strip/strip.png', '', '## What we build', '- the strip', '- its window', '',
  '## Requirements', '- readable when small', '', '## Context', '  Touches: public/board.js, src/state.mjs', '', '## History', '- 2026-10-17 11:05 Board: taken',
].join('\n')
const work = { ok: true, truth: 'store', items: new Map([['B1', parseItem(ITEM)]]), activities: [{ name: 'Board', steps: ['B1'] }] }

test('a step\'s window: Summary, picture, goal, the strip, What we build, Requirements and Touches folded, History last', () => {
  const item = itemOfStep(work, 'B1')
  assert.deepEqual(item, {
    id: 'B1', title: 'Draw the strip', summary: ['One strip per step.'], picture: 'art-inbox/strip/strip.png', goal: 'G4', what: ['the strip', 'its window'],
    requirements: ['readable when small'], touches: ['public/board.js, src/state.mjs'], history: ['2026-10-17 11:05 Board: taken'],
  })
  assert.deepEqual(plain(page.itemPartsOf(item, true)).map(part => [part.key, part.isFolded]), [
    ['summary', false], ['picture', false], ['goal', false], ['flow', false], ['what', false], ['requirements', true], ['touches', true], ['history', false],
  ])
  assert.deepEqual(plain(page.itemPartsOf(null, true)), [])
  // While the store is a shadow the window is as before.
  assert.equal(itemOfStep({ ...work, truth: 'shadow' }, 'B1'), null)
  assert.equal(itemOfStep(work, '0:0').id, 'B1')
})

test('a lane names its step by the store\'s title, not by the card\'s short topic', () => {
  assert.deepEqual(plain(page.laneTaskOf({ task: { text: 'B1 Draw the', stepId: 'B1', title: 'Draw the strip' } })), { code: 'B1', text: 'Draw the strip' })
  assert.deepEqual(plain(page.laneTaskOf({ task: { text: 'B1 Draw the', stepId: 'B1' } })), { code: 'B1', text: 'Draw the' })
})

test('review: a question of the app\'s form whose chat does not run can be withdrawn on the board', () => {
  const form = { ...ask, of: null, blocks: [], blocking: false, isForm: true, answer: null }
  assert.equal(page.storeAskParts(form, false).withdraw, true)
  assert.equal(page.storeAskParts(form, true).withdraw, false)
  assert.equal(page.storeAskParts(form, null).withdraw, false)
  assert.equal(page.storeAskParts({ ...ask, answer: null }, false).withdraw, false)
  assert.match(script, /sendWork\(\{ action: 'withdraw', id: withdraw\.dataset\.withdraw, why: 'its chat does not run' \}/)
})
