// B474 (I57, 2026-10-21): "I still often get asked the same thing twice, via different need your attentions." Each
// path by which the store's asks of 2026-10-18 to 2026-10-21 asked the person a question twice, made once here, and
// the person sees one ask. The questions are made up; each test names the real case it stands for.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../../src/state.mjs'
import { forYouRepeat, overlapOf } from '../../src/work/askRepeat.mjs'
import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 21, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Garden work', '- [ ] B1 Plant the hedge (for Board; about 1 h)', '- [ ] B2 Dig the pond (for Board; about 1 h)', ''].join('\n')
const ROLES = { Main: 'main', Board: 'worker', Advisor: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-twice-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = at => ({ dir, now: at, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board']), boardUrl: 'http://127.0.0.1:4310', hasGoal: () => true })
  const as = chat => (body, at) => workApi({ chat, ...body }, ctx(at))
  return { dir, main: as('Main'), board: as('Board'), advisor: as('Advisor'), person: (body, at) => workApi(body, { ...ctx(at), as: 'person' }) }
}
const asks = async dir => [...(await readStore(dir)).items.values()].filter(one => valueOf(one, 'Kind') === 'ask').map(one => valueOf(one, 'Id'))
const item = (text, kind = 'decide') => ({ kind, text: [text], options: [], advice: '', pictures: [], play: '', ref: null })
const cleanUp = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('a "For you" item that asks in other words what the chat asked this turn files nothing (Q96, then Q97)', async () => {
  const { dir, board } = await fresh()
  try {
    await board({ action: 'take', minutes: 30, id: 'B1' }, NOW)
    await board({ action: 'ask', of: 'B1', kind: 'decide', title: 'The hedge of yew and its gate: merge it?', text: 'Yew hedge along the west fence, an oak gate in the middle, lit by two lamps.' }, NOW + MIN)
    const ended = await board({ action: 'turn-ended', since: NOW + MIN - 1, forYou: [item('Merge the yew hedge with its oak gate? A yes, merge it, or B not yet, and say what to change.')] }, NOW + 2 * MIN)
    assert.deepEqual(ended.result.asked ?? [], [])
    assert.deepEqual(await asks(dir), ['Q1'])
  } finally {
    await cleanUp(dir)
  }
})

test('two items of one block in other words file one ask (Q174 and Q175)', async () => {
  const { dir, main } = await fresh()
  try {
    const ended = await main({ action: 'turn-ended', since: NOW, forYou: [
      item('Click the yellow banner "A new version of the garden board is available" so it restarts.', 'do'),
      item('Restart the garden board from the yellow "new version" banner on its page.', 'do'),
    ] }, NOW + MIN)
    assert.deepEqual(ended.result.asked, ['Q1'])
  } finally {
    await cleanUp(dir)
  }
})

test('B480: an item that asks again what the chat withdrew unanswered is a new ask (Q264 withdrawn, then Q274)', async () => {
  const { dir, advisor } = await fresh()
  try {
    await advisor({ action: 'ask', kind: 'decide', title: 'Should the garden first pick hold only the roses card?', text: 'Its tip: a flower joins your garden; the herbs come at the second pick.' }, NOW)
    const since = NOW + 30 * MIN
    await advisor({ action: 'withdraw', id: 'Q1', why: 'I fold the advice in: roses alone' }, since + MIN)
    const ended = await advisor({ action: 'turn-ended', since, forYou: [item('In the garden first pick, should the roses card stand alone? I built in yes; to change it, say so.')] }, since + 2 * MIN)
    assert.deepEqual(ended.result.asked, ['Q2'])
    // The review: also in the same words as the withdrawn one, filed in the same turn.
    await advisor({ action: 'ask', kind: 'decide', title: 'Should the pond get lilies?', text: 'Lilies shade the fish.' }, since + 3 * MIN)
    await advisor({ action: 'withdraw', id: 'Q3', why: 'asked anew in my answer' }, since + 4 * MIN)
    const same = await advisor({ action: 'turn-ended', since: since + 3 * MIN - 1, forYou: [item('Should the pond get lilies? I advise yes.')] }, since + 5 * MIN)
    assert.deepEqual(same.result.asked, ['Q4'])
  } finally {
    await cleanUp(dir)
  }
})

test('an item that leads with another chat\'s open ask, or asks what it asks, files nothing (Q202 then Q204; Q225 then Q227)', async () => {
  const { dir, main, board, advisor } = await fresh()
  try {
    await board({ action: 'take', minutes: 30, id: 'B1' }, NOW)
    await board({ action: 'ask', of: 'B1', kind: 'decide', title: 'Which of the ten pond proposals become steps?', text: 'The page lists ten weak places of the pond, each with its cost.' }, NOW + MIN)
    await advisor({ action: 'ask', kind: 'decide', title: 'Does a fall from two terraces do two damage?', text: 'One damage per terrace dropped, unless the gnome lands in the pond.' }, NOW + MIN)
    const pointer = await main({ action: 'turn-ended', since: NOW + 2 * MIN, forYou: [
      item('Q1, which pond proposals become steps: A the top three, B all ten; I advise A.'),
      item('Should a fall off two terraces do 1 damage per terrace dropped, unless the gnome lands in the pond?'),
    ] }, NOW + 3 * MIN)
    assert.deepEqual(pointer.result.asked ?? [], [])
    // Named for context in a new question, another chat's ask still lets it through (B362's review).
    const context = await main({ action: 'turn-ended', since: NOW + 4 * MIN, forYou: [item('If Q1 is all ten, should the lilies wait a week?')] }, NOW + 5 * MIN)
    assert.deepEqual(context.result.asked, ['Q3'])
  } finally {
    await cleanUp(dir)
  }
})

test('a do that sends the person to another chat\'s open questions under a step files nothing (Q223)', async () => {
  const { dir, main, advisor } = await fresh()
  try {
    await advisor({ action: 'ask', of: 'B2', kind: 'decide', title: 'Drop B2, since the pond is dug already?', text: 'Every part of it stands in B1 or is done.' }, NOW)
    const ended = await main({ action: 'turn-ended', since: NOW + MIN, forYou: [item('Answer the Advisor\'s questions on B2. Open it from the Advisor row on the board.', 'do')] }, NOW + 2 * MIN)
    assert.deepEqual(ended.result.asked ?? [], [])
    // The chat is told what was left out and why.
    assert.match(ended.result.text, /Not filed from your "For you" block, as asked already: "Answer the Advisor's questions on B2\. .*" points to Q1 under B2/)
    // B480: the answer names it apart too, for the Workers mod to tell the chat at its next prompt.
    assert.deepEqual(ended.result.left, [`"Answer the Advisor's questions on B2. Open it from the Advisor row on the board." points to Q1 under B2`])
    // A do that names the step for another reason is filed (the review).
    const restart = await main({ action: 'turn-ended', since: NOW + 2 * MIN + 1, forYou: [item('Restart the board so B2 takes effect.', 'do')] }, NOW + 3 * MIN)
    assert.deepEqual(restart.result.asked, ['Q2'])
    // A do about a step with no open question of another chat is filed.
    const other = await main({ action: 'turn-ended', since: NOW + 3 * MIN + 1, forYou: [item('Water the new hedge of B1 once tonight.', 'do')] }, NOW + 4 * MIN)
    assert.deepEqual(other.result.asked, ['Q3'])
  } finally {
    await cleanUp(dir)
  }
})

test('a different question on the same subject is still filed, also beside an ask of the same turn (Q232 and Q233)', async () => {
  const { dir, main } = await fresh()
  try {
    const water = 'With 2% of the water left before the stop, shall the idle gardeners stay idle until the Thursday refill? I advise yes.'
    const rule = 'Should the stop rule move from 85% to about 99% of the weekly water, so the 16% left can be used? I advise yes.'
    await main({ action: 'turn-ended', since: NOW, forYou: [item(water)] }, NOW + MIN)
    const next = await main({ action: 'turn-ended', since: NOW + 2 * MIN, forYou: [item(rule)] }, NOW + 3 * MIN)
    assert.deepEqual(next.result.asked, ['Q2'])
  } finally {
    await cleanUp(dir)
  }
  // B480: the first filed with work ask in the same turn holds the second back no more (they share half their words).
  const other = await fresh()
  try {
    const water = 'With 2% of the water left before the stop, shall the idle gardeners stay idle until the Thursday refill? I advise yes.'
    await other.main({ action: 'ask', kind: 'decide', title: 'Shall the idle gardeners stay idle until the Thursday refill?', text: water }, NOW + MIN)
    const rule = 'Should the stop rule move later, with the water left?'
    assert.equal(overlapOf(`Shall the idle gardeners stay idle until the Thursday refill? ${water}`, rule), 0.5)
    const same = await other.main({ action: 'turn-ended', since: NOW, forYou: [item(rule)] }, NOW + 2 * MIN)
    assert.deepEqual(same.result.asked, ['Q2'])
  } finally {
    await cleanUp(other.dir)
  }
})

test('work ask refuses a question the chat holds open under the same step or goal, naming it (Q236 to Q248)', async () => {
  const { dir, advisor } = await fresh()
  try {
    const camera = { kind: 'decide', of: 'G1', title: 'P3.1: How is the garden seen from the window?', text: 'Costly to change later: every bed is drawn for it.', options: ['A from above', 'B from the side'], advice: 'A' }
    const first = await advisor({ action: 'ask', ...camera }, NOW)
    assert.equal(first.ok, true, first.why)
    const again = await advisor({ action: 'ask', ...camera }, NOW + MIN)
    assert.equal(again.ok, false)
    assert.equal(again.status, 409)
    assert.match(again.why, /^Q1 asks this already and it stands open/)
    // Another question under the same goal, and the same question under another goal, are asks of their own.
    assert.equal((await advisor({ action: 'ask', ...camera, title: 'P3.2: One colour for the whole garden, or one per bed?', text: 'The roses are warm today.' }, NOW + 2 * MIN)).ok, true)
    assert.equal((await advisor({ action: 'ask', ...camera, of: 'G2' }, NOW + 3 * MIN)).ok, true)
    // Withdrawn, it may be asked anew.
    await advisor({ action: 'withdraw', id: 'Q1', why: 'asked anew with a picture' }, NOW + 4 * MIN)
    assert.equal((await advisor({ action: 'ask', ...camera }, NOW + 5 * MIN)).ok, true)
    assert.deepEqual(await asks(dir), ['Q1', 'Q2', 'Q3', 'Q4'])
  } finally {
    await cleanUp(dir)
  }
})

test('work ask refuses a question the person answered a moment ago, with the answer; later it is a new ask (Q160 then Q162; Q190 then Q192)', async () => {
  const { dir, board, advisor, person } = await fresh()
  try {
    await board({ action: 'take', minutes: 30, id: 'B1' }, NOW)
    const gate = { kind: 'decide', of: 'B1', title: 'Which gate do I build?', text: 'A: oak gate with two lamps beside the hedge; B: iron gate with a stone arch over the path.', options: ['A oak', 'B iron'] }
    await board({ action: 'ask', ...gate }, NOW + MIN)
    await person({ action: 'answer', id: 'Q1', text: 'A oak' }, NOW + 2 * MIN)
    const soon = await board({ action: 'ask', ...gate }, NOW + 2 * MIN + 30_000)
    assert.equal(soon.ok, false)
    assert.match(soon.why, /^Q1 asks this already and the person answered it: A oak/)
    // Your words (2026-10-30): under a step the answer stands in its "Your words", so the same question later is refused
    // with it too: the chat acts on the answer and asks only what is new.
    const later = await board({ action: 'ask', ...gate }, NOW + 9 * MIN)
    assert.equal(later.status, 409)
    assert.match(later.why, /^B1: the person answered this already on \d{4}-\d\d-\d\d \d\d:\d\d \(Q1\): "A oak"\. Act on their answer/)
    // A question of a goal stands on no step: there a moment ago is refused, later it is a new ask.
    const goal = { kind: 'decide', of: 'G2', title: 'Which gate do we build for the garden?', options: ['A oak', 'B iron'] }
    const first = await advisor({ action: 'ask', ...goal }, NOW + 10 * MIN)
    assert.equal(first.ok, true, first.why)
    await person({ action: 'answer', id: first.result.id, text: 'A oak' }, NOW + 11 * MIN)
    assert.match((await advisor({ action: 'ask', ...goal }, NOW + 11 * MIN + 30_000)).why, new RegExp(`^${first.result.id} asks this already and the person answered it: A oak`))
    const again = await advisor({ action: 'ask', ...goal }, NOW + 20 * MIN)
    assert.equal(again.ok, true, again.why)
  } finally {
    await cleanUp(dir)
  }
})

test('the measure of alike: one question in other words is alike, two questions of one subject are not', () => {
  assert.ok(overlapOf('The hedge of yew and its gate: merge it? Yew hedge along the west fence, an oak gate.', 'Merge the yew hedge with its oak gate? A yes, merge it.') >= 0.6)
  assert.ok(overlapOf('Does the tutorial\'s shop do what you intended? I advise yes.', 'Does the tutorial\'s shop walk you through your first buy?') < 0.5)
  assert.ok(overlapOf('With 2% of the water left, shall the idle gardeners stay idle until Thursday?', 'Should the stop rule move from 85% to 99% of the weekly water?') < 0.5)
  // Word forms count as one word: "teaches", "teaching".
  assert.ok(overlapOf('The second bed now teaches watering, then pruning, one tip at a time', 'Does the second bed\'s teaching of watering and pruning work?') >= 0.5)
  assert.equal(forYouRepeat({ text: ['Water the hedge tonight.'], kind: 'do' }, {}), null)
  // An open ask that went to the partner first is not the person's: an item like it still reaches them (the review).
  const pond = { id: 'Q7', words: 'Which of the ten pond proposals become steps? The page lists ten weak places of the pond.', of: 'B1' }
  const item = { text: ['Which pond proposals become steps: the ten weak places of the pond?'], kind: 'decide' }
  assert.equal(forYouRepeat(item, { others: [pond] }), 'asks what Q7 asks')
  assert.equal(forYouRepeat(item, { others: [{ ...pond, routed: true }] }), null)
})

test('the warning "filed no ask" stays away for an item the board left out as asked already by another chat (Q204)', async () => {
  const { dir, main, board } = await fresh()
  try {
    await board({ action: 'take', minutes: 30, id: 'B1' }, NOW)
    await board({ action: 'ask', of: 'B1', kind: 'decide', title: 'Which of the ten pond proposals become steps?', text: 'The page lists ten weak places of the pond, each with its cost.' }, NOW + MIN)
    const PROJECT = 'C:\\garden'
    const config = { ...parseConfig('{}', {}), project: PROJECT }
    const at = NOW + 10 * MIN
    const build = async said => {
      const words = `Done.\n\n> **For you**\n> 1. **Answer:** ${said}\n\n---\n\n\`\`\`diff\n  Prompt: x\n  Who:    Team - Main\n+ Done:   yes\n\`\`\``
      const app = JSON.stringify({ title: 'Team - Main', sessionId: 'local_main', cliSessionId: 'cli-main', cwd: PROJECT, isArchived: false, createdAt: 1, lastActivityAt: at, lastAssistantUuid: 'u-1' })
      return buildState({
        listText: '{"prefix":"Team - ","main":"Main","workers":["Board"]}', appChatTexts: [app],
        tails: { 'cli-main': { text: [typed(at - 2 * MIN, 'Go on'), answer(at - MIN, words)].join('\n'), isCut: false, modifiedAt: at } },
        planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work: { ok: true, dir, exists: true, ...(await readStore(dir)) },
      }, { lines: [], outbox: [], runs: [], board: null, seen: null, now: at, config })
    }
    const warned = state => state.forYou.filter(one => one.kind === 'unfiled').map(one => one.from)
    const ended = await main({ action: 'turn-ended', since: at - 2 * MIN, forYou: [item('Q1, which pond proposals become steps: A the top three, B all ten; I advise A.')] }, at)
    assert.deepEqual(ended.result.asked ?? [], [])
    assert.deepEqual(warned(await build('Q1, which pond proposals become steps: A the top three, B all ten; I advise A.')), [])
    // A new question of its own that it filed no ask for still warns.
    assert.deepEqual(warned(await build('Shall the lilies wait a week? I advise yes.')), ['Main'])
  } finally {
    await cleanUp(dir)
  }
})
