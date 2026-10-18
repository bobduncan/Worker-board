// B314: a worker may file its safe-point line for a restart as a work note to the main chat (`work note --to main`),
// as the job texts allow. Seen live on 2026-10-18 at 16:19: Workers 3 and 4 filed theirs that way and the restart
// banner still listed them as "still working". A note counts as the message does: the newest of the two decides, and
// work after the line ends it. Also B314: one chat shows once, though the app kept an old account's copy of the list
// of chats. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, assistant, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { readAppChats } from '../src/appChats.mjs'
import { parseConfig } from '../src/config.mjs'
import { storeSafePoint } from '../src/limits.mjs'
import { parseTail } from '../src/transcript.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (hour, minute = 0, second = 0) => new Date(2026, 9, 18, hour, minute, second).getTime()
const MAINS = ['Game - Main', 'local_main-1']
const LINE = 'Note from Game - Worker 3: Safe point: B312, implement Charge in the rules\nStep B312, step 2 of 5; WIP commit 6850877.'
const entries = lines => parseTail(lines.join('\n'), false)
const call = (when, name, input = {}) => [assistant(when, 'tool_use', [tool(name, input)]), toolResult(when + 1000)]
const filing = (when, text = LINE) => call(when, 'mcp__folder-branches__work', { action: 'note', to: 'main', of: 'B312', text })
// The note as the store holds it: its Since to the minute.
const minuteOf = when => Math.floor(when / MIN) * MIN
const SINCE = at(16, 18, 20)

test('a safe-point line filed as a note to the main chat after the prepare word stops the chat, as the message does', () => {
  const turn = [typed(at(16, 0), 'Go on with B312.'), step(at(16, 1), 'Build'), toolResult(at(16, 2)), ...filing(at(16, 19, 28)), answer(at(16, 19, 31), 'Stopped.')]
  const notes = [{ at: minuteOf(at(16, 19, 28)), text: LINE }]
  assert.deepEqual(storeSafePoint(notes, entries(turn), MAINS, SINCE), { at: at(16, 19, 28), isSafe: true })
  // The transcript does not show the filing (cut short, or filed by the command line): the note's minute stands.
  assert.deepEqual(storeSafePoint(notes, [], MAINS, SINCE), { at: minuteOf(at(16, 19, 28)), isSafe: true })
  // Filed in the minute of the prepare word: it counts, though its Since is the start of that minute.
  assert.deepEqual(storeSafePoint([{ at: minuteOf(SINCE), text: LINE }], [], MAINS, SINCE), { at: minuteOf(SINCE), isSafe: true })
  // Before the prepare word, without one, or not in the first line: no safe point.
  assert.equal(storeSafePoint([{ at: at(16, 10), text: LINE }], [], MAINS, SINCE), null)
  assert.equal(storeSafePoint(notes, [], MAINS, null), null)
  assert.deepEqual(storeSafePoint([{ at: at(16, 19), text: 'B312 reported.\nSafe point: merged.' }], [], MAINS, SINCE), { at: at(16, 19), isSafe: false })
  assert.equal(storeSafePoint([], [], MAINS, SINCE), null)
})

test('the newest note decides; work after the line, also within its minute, or a message to the main chat ends it', () => {
  const notes = [{ at: at(16, 19), text: LINE }, { at: at(16, 25), text: 'Note from Game - Worker 3: the user answered Q60.' }]
  assert.deepEqual(storeSafePoint(notes, [], MAINS, SINCE), { at: at(16, 25), isSafe: false })
  // Worker 1 on 2026-10-18: filed its line at 16:19:27, then wrote a file at 16:19:53 and went on; then a new line at 16:22.
  const first = { at: at(16, 19), text: 'Note from Game - Worker 1: Safe point: write projectileArt.ts' }
  const goneOn = [...filing(at(16, 19, 27), first.text), ...call(at(16, 19, 38), 'mcp__folder-branches__work', { action: 'next' }), ...call(at(16, 19, 53), 'Write', { file_path: 'x.ts' })]
  assert.equal(storeSafePoint([first], entries(goneOn), MAINS, SINCE), null)
  const second = { at: at(16, 22), text: 'Note from Game - Worker 1: Safe point: look at the bolt' }
  const again = [...goneOn, ...filing(at(16, 22, 24), second.text), answer(at(16, 22, 40), 'Stopped.')]
  assert.deepEqual(storeSafePoint([first, second], entries(again), MAINS, SINCE), { at: at(16, 22, 24), isSafe: true })
  // Its card and the app's recap after the line are no work; a message to the main chat after it is the message's say.
  const card = [...filing(at(16, 19, 28)), ...call(at(16, 19, 29), 'mcp__folder-branches__chat', { action: 'done' }), ...call(at(16, 19, 31), 'mcp__ccd_turn__wrap_up', { recap: 'Stopped.' })]
  assert.deepEqual(storeSafePoint([{ at: at(16, 19), text: LINE }], entries(card), MAINS, SINCE), { at: at(16, 19, 28), isSafe: true })
  const told = [...filing(at(16, 19, 28)), ...call(at(16, 30), 'SendMessage', { to: MAINS[1], message: 'Note from Game - Worker 3: back at work.' })]
  assert.equal(storeSafePoint([{ at: at(16, 19), text: LINE }], entries(told), MAINS, SINCE), null)
})

const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const two = n => String(n).padStart(2, '0')
const sinceOf = when => {
  const date = new Date(when)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
const note = (id, from, when, words) =>
  parseItem(`Id: ${id}\nKind: note\nFrom: ${from}\nTo: main\nState: unread\nSince: ${sinceOf(when)}\nText: ${words.split('\n').join(' ')}\n\n## Text\n${words}\n\n## History\n- ${sinceOf(when)} ${from}: noted\n`)
const app = (name, lastActivityAt) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt, lastAssistantUuid: 'u-1',
})
const NOW = at(16, 21)

function build({ items, turns }) {
  const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const names = ['Main', ...Object.keys(turns)]
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: names.map(name => app(name, NOW - MIN)),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, { text: (turns[name] ?? [answer(at(15, 0), 'ok')]).join('\n'), isCut: false, modifiedAt: NOW - 30_000 }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, usageText: null,
  }
  const outbox = [{ id: 'p', at: SINCE, ask: null, command: 'prepare restart', text: 'prepare restart', state: 'delivered' }]
  return buildState(raw, { lines: [], outbox, runs: [], now: NOW, config })
}

test('the banner: a worker that filed its line as a note is stopped for the restart, not still working', () => {
  // Its turn was cut by the restart right after the note, and the tail still looks as if it runs.
  const running = text => [typed(at(16, 0), 'Go on.'), step(at(16, 1), 'Build'), toolResult(at(16, 2)), ...filing(at(16, 19, 28), text)]
  const worker3 = LINE
  const worker4 = 'Note from Game - Worker 4: Safe point: B326 step 1, paint the shop'
  const state = build({
    items: [note('N80', 'Worker 3', at(16, 19), worker3), note('N81', 'Worker 4', at(16, 19), worker4)],
    turns: { 'Worker 3': running(worker3), 'Worker 4': running(worker4), 'Worker 2': [typed(at(16, 0), 'Go on.'), step(at(16, 20, 30), 'Build')] },
  })
  const lane = name => state.chats.find(chat => chat.name === name)
  assert.equal(lane('Worker 3').state, 'suspended')
  assert.equal(lane('Worker 3').suspended.by, 'restart')
  assert.equal(lane('Worker 4').state, 'suspended')
  assert.deepEqual(state.restart.preparing.working, ['Worker 2'])
  assert.equal(state.restart.preparing.lastLine, at(16, 19, 28))
})

test('one chat shows once: only the chats of the account the app uses now are read, not an old account\'s copies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'b314-'))
  try {
    const now = join(dir, 'account-new', 'org-1')
    const old = join(dir, 'account-old', 'org-1')
    await mkdir(now, { recursive: true })
    await mkdir(old, { recursive: true })
    // 2026-10-18: the old account's folder still held an open "Game - Worker 1" of 14 October, beside today's.
    await writeFile(join(now, 'local_a.json'), JSON.stringify({ title: 'Game - Worker 1', cliSessionId: 'today', cwd: PROJECT, lastActivityAt: at(16, 22) }))
    await writeFile(join(now, 'local_b.json'), JSON.stringify({ title: 'Game - Main', cliSessionId: 'main', cwd: PROJECT, lastActivityAt: at(16, 20) }))
    await writeFile(join(old, 'local_c.json'), JSON.stringify({ title: 'Game - Worker 1', cliSessionId: 'old', cwd: PROJECT, lastActivityAt: at(16, 0) - 4 * 24 * 60 * MIN }))
    await writeFile(join(old, 'local_b.json'), JSON.stringify({ title: 'Game - Main', cliSessionId: 'main', cwd: PROJECT, lastActivityAt: at(16, 0) - 3 * 24 * 60 * MIN }))
    const texts = await readAppChats(dir)
    assert.deepEqual(texts.map(one => JSON.parse(one).cliSessionId).sort(), ['main', 'today'])
    // One account only: all of it.
    await rm(join(dir, 'account-new'), { recursive: true })
    assert.deepEqual((await readAppChats(dir)).map(one => JSON.parse(one).cliSessionId).sort(), ['main', 'old'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
