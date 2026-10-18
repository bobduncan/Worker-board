// B317: a chat's "For you" block that it ended its answer with, and filed no `work ask` for: the Workers mod hands its
// items to the board with the turn's end (`turn-ended`, `forYou`), and the board files the missing ones as asks
// (`Via: chat`), so they stand on the board with an answer box. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../../src/state.mjs'
import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const BACKLOG = ['# Backlog', '', '## Board work', '- [ ] B1 Draw the strip (for Board; about 1 h)', '- [ ] B2 Keep the cards apart (for Board; about 30 min)', ''].join('\n')
const ROLES = { Main: 'main', Board: 'worker' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-foryou-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = at => ({ dir, now: at, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board']), boardUrl: 'http://127.0.0.1:4310' })
  const as = chat => (body, at = NOW + 10 * MIN) => workApi({ chat, ...body }, ctx(at))
  return { dir, main: as('Main'), board: as('Board'), person: (body, at = NOW + 20 * MIN) => workApi(body, { ...ctx(at), as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const head = (one, keys) => keys.map(key => valueOf(one, key))

const LOOK = { n: 1, kind: 'look', text: ['Is the strip readable now? I advise yes.'], options: [], advice: 'yes', pictures: ['art-inbox/strip/thin.png'], play: 'b1-strip&screen=shop', ref: null }
const DECIDE = { n: 2, kind: 'decide', text: ['Which strip: A thin or B thick? I advise B.'], options: ['A thin', 'B thick'], advice: 'B', pictures: [], play: '', ref: null }

test('the items without an ask are filed as asks Via chat, under the one step the chat holds in progress, not blocking', async () => {
  const { dir, board } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' }, NOW + MIN)
    const ended = await board({ action: 'turn-ended', since: NOW + 2 * MIN, forYou: [LOOK, DECIDE] })
    assert.equal(ended.ok, true, ended.why)
    assert.deepEqual(ended.result.asked, ['Q1', 'Q2'])
    const look = await item(dir, 'Q1')
    assert.deepEqual(head(look, ['Asks', 'Of', 'Owner', 'Blocking', 'Via', 'Advice', 'Pictures', 'State']), ['look', 'B1', 'Board', 'no', 'chat', 'yes', 'art-inbox/strip/thin.png', 'open'])
    assert.deepEqual(look.sections.get('Play'), ['b1-strip&screen=shop'])
    assert.match(look.sections.get('History').join('\n'), /from its "For you" block/)
    assert.deepEqual(head(await item(dir, 'Q2'), ['Asks', 'Options', 'Advice']), ['decide', 'A thin | B thick', 'B'])
    // Not blocking: the step goes on.
    assert.equal(valueOf(await item(dir, 'B1'), 'State'), 'in progress')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an item the chat filed this turn, one it still holds open, or one naming an ask of the store is not filed again', async () => {
  const { dir, board } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' }, NOW + MIN)
    await board({ action: 'ask', of: 'B1', kind: 'look', text: 'Is the strip readable now?' }, NOW + 3 * MIN)
    const first = await board({ action: 'turn-ended', since: NOW + 2 * MIN, forYou: [LOOK, { ...DECIDE, ref: 'Q1' }] })
    assert.deepEqual(first.result.asked, [])
    // The next turn repeats a question that is still open, in other markdown: still nothing new.
    const again = await board({ action: 'turn-ended', since: NOW + 30 * MIN, forYou: [{ ...LOOK, text: ['**Is the strip readable now?**'] }] }, NOW + 31 * MIN)
    assert.deepEqual(again.result.asked, [])
    // Twice the same item in one block is filed once.
    const twice = await board({ action: 'turn-ended', since: NOW + 40 * MIN, forYou: [DECIDE, DECIDE] }, NOW + 41 * MIN)
    assert.deepEqual(twice.result.asked, ['Q2'])
    assert.equal((await readStore(dir)).items.has('Q3'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('B362: an item in the chat\'s own words that names an open ask by its Q id, in any form, files nothing new', async () => {
  const { dir, board, person } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' }, NOW + MIN)
    await board({ action: 'ask', of: 'B1', kind: 'decide', text: 'Which strip do you want?', options: ['A thin', 'B thick'], advice: 'B' }, NOW + 3 * MIN)
    const worded = text => ({ ...DECIDE, text: [text], ref: null })
    const forms = [
      'Thin or thick strip for the lanes? I advise B (Q1, under B1)',
      'Thin or thick: I advise B (Q1)',
      'Q1: pick the strip, A thin or B thick',
      'Pick the strip, see Q1 under B1.',
    ]
    const ended = await board({ action: 'turn-ended', since: NOW + 4 * MIN, forYou: forms.map(worded) }, NOW + 5 * MIN)
    assert.deepEqual(ended.result.asked, [])
    // A Q id named on a later line of the item counts too.
    const later = await board({ action: 'turn-ended', since: NOW + 6 * MIN, forYou: [{ ...DECIDE, text: ['Thin or thick?', 'It is Q1 again.'], ref: null }] }, NOW + 7 * MIN)
    assert.deepEqual(later.result.asked, [])
    assert.equal((await readStore(dir)).items.has('Q2'), false)
    // An id that is no open ask (unknown, or answered) does not hold a new question back; nor does a word like Q10x.
    await person({ action: 'answer', id: 'Q1', text: 'B' })
    const fresher = await board({ action: 'turn-ended', since: NOW + 30 * MIN, forYou: [worded('After Q1, which colour for the strip, A red or B blue? (Q9)'), worded('Is the Q1x mark clear?')] }, NOW + 31 * MIN)
    assert.deepEqual(fresher.result.asked, ['Q2', 'Q3'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('with no step or two in progress the ask stands alone; a do is a do; nothing filed without items', async () => {
  const { dir, board, main } = await fresh()
  try {
    const alone = await main({ action: 'turn-ended', since: NOW, forYou: [{ ...DECIDE, kind: 'do', text: ['Restart the app.'], options: [], advice: '' }] })
    assert.deepEqual(alone.result.asked, ['Q1'])
    assert.deepEqual(head(await item(dir, 'Q1'), ['Asks', 'Of', 'Owner', 'Via']), ['do', null, 'Main', 'chat'])
    await board({ action: 'take', id: 'B1' }, NOW + MIN)
    await board({ action: 'take', id: 'B2' }, NOW + MIN)
    const two = await board({ action: 'turn-ended', since: NOW + 2 * MIN, forYou: [DECIDE] })
    assert.equal(valueOf(await item(dir, two.result.asked[0]), 'Of'), null)
    const none = await board({ action: 'turn-ended', since: NOW + 2 * MIN })
    assert.equal(none.result.asked, undefined)
    // A malformed item is left out, the others filed.
    const odd = await main({ action: 'turn-ended', since: NOW + 50 * MIN, forYou: [{ kind: 'sing', text: ['x'] }, { kind: 'decide', text: [] }, 'x', { kind: 'decide', text: ['Pond next?'] }] }, NOW + 51 * MIN)
    assert.equal(odd.result.asked.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an auto-filed ask answered on the board wakes the chat; answered in the chat, the chat closes it', async () => {
  const { dir, board, person } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' }, NOW + MIN)
    await board({ action: 'turn-ended', since: NOW + 2 * MIN, forYou: [DECIDE, LOOK] })
    const answered = await person({ action: 'answer', id: 'Q1', text: 'B' })
    assert.equal(answered.ok, true, answered.why)
    assert.equal(answered.result.wake.to, 'Board')
    const closed = await board({ action: 'answered-in-chat', id: 'Q2', text: 'yes, readable (2026-10-17)' })
    assert.equal(closed.ok, true, closed.why)
    assert.equal(valueOf(await item(dir, 'Q2'), 'State'), 'answered')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the board\'s warning "filed no ask" goes once the turn\'s end filed the block\'s asks', async () => {
  const { dir, main } = await fresh()
  try {
    const PROJECT = 'C:\\garden'
    const config = { ...parseConfig('{}', {}), project: PROJECT }
    const at = NOW + 10 * MIN
    const words = 'Closed B1.\n\n> **For you**\n> 1. **Answer:** Keep the golem as it is? I advise yes.\n\n---\n\n```diff\n  Prompt: x\n  Who:    Team - Main\n- Done:   partly\n```'
    const app = JSON.stringify({ title: 'Team - Main', sessionId: 'local_main', cliSessionId: 'cli-main', cwd: PROJECT, isArchived: false, createdAt: 1, lastActivityAt: at, lastAssistantUuid: 'u-1' })
    const build = async () => buildState({
      listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: [app],
      tails: { 'cli-main': { text: [typed(at - 2 * MIN, 'Close B1'), answer(at - MIN, words)].join('\n'), isCut: false, modifiedAt: at } },
      planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work: { ok: true, dir, exists: true, ...(await readStore(dir)) },
    }, { lines: [], outbox: [], runs: [], board: null, seen: null, now: at, config })
    const warned = state => state.forYou.filter(one => one.kind === 'unfiled').map(one => one.from)
    assert.deepEqual(warned(await build()), ['Main'])
    const ended = await main({ action: 'turn-ended', since: at - 2 * MIN, forYou: [{ kind: 'decide', text: ['Keep the golem as it is? I advise yes.'], advice: 'yes' }] }, at)
    assert.deepEqual(ended.result.asked, ['Q1'])
    const after = await build()
    assert.deepEqual(warned(after), [])
    const card = after.forYou.find(one => one.workId === 'Q1')
    assert.deepEqual([card.canAnswer, card.advice], [true, 'yes'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
