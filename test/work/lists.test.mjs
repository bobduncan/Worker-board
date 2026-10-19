// B299: Needs your attention and Information from the store (spec 2026-10-17, section 8): an ask stands until answered,
// whatever the chat said since; a note is information, never a question; an answer wakes the chat that asked; a chat
// waits only on an open blocking ask or the app's question form. B301: a "For you" block a chat wrote without filing an
// ask is a warning with the way to its chat, never a question. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { messageText } from '../../src/bridge.mjs'
import { parseConfig } from '../../src/config.mjs'
import { answerWords } from '../../src/say.mjs'
import { buildState } from '../withStore.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n')
const ASKS = 'The hedge is half planted.\n\n> **For you**\n> 1. **Answer:** Box or yew? I advise yew.\n\n---\n\n```diff\n  Prompt: the hedge\n  Who:    Garden · Digger\n- Done:   partly, waiting for your answer\n```'
const PLAIN = 'Still planting. Nothing for you.'

const app = name => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
  postTurnSummary: { status_category: 'blocked', status_detail: 'asked', needs_action: 'Answer it', summarizes_uuid: 'u-1' },
})
const tail = words => ({ text: [typed(NOW - 30 * MIN, 'Plant it'), answer(NOW - 20 * MIN, words)].join('\n'), isCut: false, modifiedAt: NOW - 20 * MIN })

async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'work-lists-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, freeChats: new Set(['Digger']), boardUrl: 'http://127.0.0.1:4310' })
  const digger = (body, at = NOW - 40 * MIN) => workApi({ chat: 'Digger', ...body }, ctx(at))
  const person = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'person' })
  const build = async (words, outbox = [], diggerTail = tail(words)) => {
    const work = { ok: true, dir, ...(await readStore(dir)) }
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger')],
      tails: { 'cli-Digger': diggerTail }, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {},
      work,
    }
    return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config })
  }
  return { dir, digger, person, build }
}
const digger = state => state.chats.find(one => one.name === 'Digger')

test('an ask stands under Needs your attention after the chat\'s next answer without it, and holds the chat as waiting', async () => {
  const { dir, digger: asks, build } = await garden()
  try {
    // Partner answers (2026-10-19) off: the person answers it, as before.
    await writeFile(join(dir, 'partner-answers.json'), '{"on":false}\n')
    await asks({ action: 'take', id: 'B1' })
    await asks({ action: 'ask', of: 'B1', kind: 'decide', blocking: true, text: 'Box or yew?', options: ['A box', 'B yew'], advice: 'B' })
    const state = await build(PLAIN)
    const need = state.forYou.find(one => one.id === 'work:Q1')
    assert.deepEqual([need.workId, need.from, need.kind, need.asks, need.title, need.canAnswer], ['Q1', 'Digger', 'input', 'decide', 'Box or yew?', true])
    assert.deepEqual(need.options, [{ label: 'A box', picture: null, isRecommended: false }, { label: 'B yew', picture: null, isRecommended: true }])
    assert.deepEqual(need.blocks, [{ step: 'B1', owner: 'Digger' }])
    assert.equal(digger(state).state, 'waiting')
    // The chat's own answer is read for nothing: no card of its words beside the ask.
    assert.equal(state.forYou.some(one => one.id.startsWith('chat:Digger:')), false)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B269: an ask carries its whole first line as its question, also when its title is cut at a double quote', async () => {
  const { dir, digger: asks, build } = await garden()
  try {
    await asks({ action: 'take', id: 'B1' })
    await asks({ action: 'ask', of: 'B1', kind: 'look', blocking: false, text: 'Does the "low" hedge read right? I advise yes.\nIt stands by the gate.' })
    const need = (await build(PLAIN)).forYou.find(one => one.id === 'work:Q1')
    assert.equal(need.question, 'Does the "low" hedge read right? I advise yes.')
    assert.equal(need.text, 'It stands by the gate.')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B301: a "For you" block without an ask makes the chat wait no more, and stands as a warning with the way to its chat', async () => {
  const { dir, build } = await garden()
  try {
    const state = await build(ASKS)
    assert.equal(digger(state).state, 'free')
    assert.equal(state.forYou.some(one => one.id.startsWith('chat:Digger:')), false)
    const warnings = state.forYou.filter(one => one.kind === 'unfiled')
    assert.deepEqual(warnings.map(one => [one.id, one.from, one.title, one.canAnswer, one.talk]), [
      [`unfiled:Digger:${NOW - 20 * MIN}`, 'Digger', 'Digger wrote questions in its chat but filed no ask', false, 'window'],
    ])
    // Its window shows its answer, as its words, not as questions to answer on the board.
    assert.match(warnings[0].waits.words, /Box or yew\?/)
    // A plain answer asks nothing: no warning.
    assert.equal((await build(PLAIN)).forYou.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B301: an ask filed in the turn that wrote the block leaves no warning; one filed before that turn, open or closed, does not count', async () => {
  const before = await garden()
  const within = await garden()
  const stale = await garden()
  try {
    // Filed and withdrawn before the turn that wrote the block began (it began 30 minutes ago).
    await before.digger({ action: 'ask', kind: 'decide', text: 'Box or yew?' }, NOW - 40 * MIN)
    await before.digger({ action: 'withdraw', id: 'Q1', why: 'not needed' }, NOW - 35 * MIN)
    assert.equal((await before.build(ASKS)).forYou.filter(one => one.kind === 'unfiled').length, 1)
    // Review: an ask of an earlier turn, still open, does not keep the warning quiet.
    await stale.digger({ action: 'ask', kind: 'look', text: 'Is the old hedge right?' }, NOW - 90 * MIN)
    assert.equal((await stale.build(ASKS)).forYou.filter(one => one.kind === 'unfiled').length, 1)
    // Filed in that turn and answered since: it was filed.
    await within.digger({ action: 'ask', kind: 'decide', text: 'Box or yew?' }, NOW - 25 * MIN)
    await within.person({ action: 'answer', id: 'Q1', text: 'yew' }, NOW - 22 * MIN)
    assert.equal((await within.build(ASKS)).forYou.filter(one => one.kind === 'unfiled').length, 0)
  } finally {
    await rm(before.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    await rm(within.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    await rm(stale.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('review: the turn\'s start is found in the longer look back; when it cannot be found the board warns and says so', async () => {
  const garden1 = await garden()
  try {
    await garden1.digger({ action: 'ask', kind: 'decide', text: 'Box or yew?' }, NOW - 90 * MIN)
    // The turn began two hours ago, before the tail: the longer look back holds its opening.
    const long = { text: answer(NOW - 20 * MIN, ASKS), isCut: false, modifiedAt: NOW - 20 * MIN, earlier: typed(NOW - 120 * MIN, 'Plant it') }
    assert.equal((await garden1.build(ASKS, [], long)).forYou.filter(one => one.kind === 'unfiled').length, 0, 'the ask was filed in that turn')
    // Nothing tells when the turn began: the board does not guess quiet, it warns and says why.
    const unknown = { text: answer(NOW - 20 * MIN, ASKS), isCut: false, modifiedAt: NOW - 20 * MIN }
    const [warning] = (await garden1.build(ASKS, [], unknown)).forYou.filter(one => one.kind === 'unfiled')
    assert.match(warning.text, /could not tell when this turn began/)
  } finally {
    await rm(garden1.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a note lands under Information and never under Needs your attention; read, it goes down the list', async () => {
  const { dir, digger: says, person, build } = await garden()
  try {
    await says({ action: 'note', to: 'you', text: 'The hedge is planted.', of: 'B1' })
    let state = await build(PLAIN)
    assert.deepEqual(state.information.map(one => [one.id, one.from, one.to, one.text, one.about, one.isRead]), [['N1', 'Digger', 'you', 'The hedge is planted.', 'B1', false]])
    assert.equal(state.forYou.length, 0)
    await person({ action: 'read', id: 'N1' })
    state = await build(PLAIN)
    assert.equal(state.information[0].isRead, true)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('an answered ask wakes its chat with its id and title, and the chat waits no more', async () => {
  const { dir, digger: asks, person, build } = await garden()
  try {
    await asks({ action: 'take', id: 'B1' })
    await asks({ action: 'ask', of: 'B1', kind: 'decide', blocking: true, text: 'Box or yew?' })
    const done = await person({ action: 'answer', id: 'Q1', text: 'Yew' })
    const words = answerWords(done.result.wake)
    assert.equal(messageText({ ...words, at: NOW }, () => '11:05'), '(answered on the worker board, 11:05) Q1 "Box or yew?": Yew')
    const state = await build(PLAIN, [{ id: 'm1', at: NOW, ...words, state: 'waiting' }])
    // B300: it waits for the person no more; it holds B1 in progress again, so it is between two turns of its work.
    assert.deepEqual([digger(state).state, digger(state).between], ['working', 'Its turn has ended; its step B1 is in progress.'])
    const need = state.forYou.find(one => one.id === 'work:Q1')
    assert.deepEqual([need.canAnswer, need.answer.state, need.answer.text], [false, 'waiting', 'Yew'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a question of the app\'s form stands as a card that is answered in its chat, and no second card of the chat', async () => {
  const { dir, digger: asks, build } = await garden()
  try {
    await asks({ action: 'ask', kind: 'decide', via: 'form', text: 'Which spade?' })
    const state = await build(PLAIN)
    const cards = state.forYou.filter(one => one.from === 'Digger')
    assert.deepEqual(cards.map(one => [one.id, one.isForm, one.canAnswer]), [['work:Q1', true, false]])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a lane on a step of the store carries the step\'s title as the store holds it', async () => {
  const { dir, digger: takes, build } = await garden()
  try {
    await takes({ action: 'take', id: 'B1', branch: 'b1-hedge' })
    const lane = digger(await build(PLAIN))
    assert.deepEqual([lane.task?.stepId, lane.task?.title], ['B1', 'Plant the hedge'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
