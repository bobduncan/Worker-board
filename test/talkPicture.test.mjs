// B167: a picture pasted into "Talk to Main" goes with the words to the main chat. The board keeps it under
// pictures/talk with a plain name, the line typed into the main chat names its full path, and the talk shows the
// picture again. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, user } from '../fixtures/lines.mjs'
import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from './withStore.mjs'
import { isTalkPicture, keepTalkPicture, splitPicture, talkPictureName } from '../src/talkPicture.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 14, 10, 30)
const PATH = 'pictures/talk/2026-10-14-1144.png'

test('a pasted picture is kept under a plain name of the day and the minute, a second one in that minute after it', () => {
  const at = new Date(2026, 9, 14, 11, 44, 30).getTime()
  assert.equal(talkPictureName(at, 'png'), '2026-10-14-1144.png')
  assert.equal(talkPictureName(at, 'jpg', 2), '2026-10-14-1144-2.jpg')
  assert.equal(talkPictureName(new Date(2026, 0, 5, 9, 3).getTime(), 'webp'), '2026-01-05-0903.webp')
  for (const path of [PATH, 'pictures/talk/2026-10-14-1144-2.jpg', 'pictures/talk/2026-10-14-1144.webp']) assert.ok(isTalkPicture(path, 'pictures'), path)
  // Only a name the board gives, in the talk's own folder.
  for (const path of ['pictures/talk/../x.png', 'pictures/ideas/2026-10-14-1144.png', 'pictures/talk/mine.png', 'pictures/talk/2026-10-14-1144.gif', `C:/${PATH}`, `/${PATH}`]) {
    assert.ok(!isTalkPicture(path, 'pictures'), path)
  }
})

test('the board keeps the picture in the project\'s pictures/talk, and never writes over one kept in the same minute', async t => {
  const project = await mkdtemp(join(tmpdir(), 'worker-board-talk-'))
  t.after(() => rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const at = new Date(2026, 9, 14, 11, 44).getTime()
  assert.equal(await keepTalkPicture(project, Buffer.from('first'), 'png', at, 'pictures'), PATH)
  assert.equal(await keepTalkPicture(project, Buffer.from('second'), 'png', at + 20_000, 'pictures'), 'pictures/talk/2026-10-14-1144-2.png')
  const folder = join(project, 'pictures', 'talk')
  assert.deepEqual((await readdir(folder)).sort(), ['2026-10-14-1144-2.png', '2026-10-14-1144.png'])
  assert.equal(await readFile(join(folder, '2026-10-14-1144.png'), 'utf8'), 'first')
})

const state = {
  restart: { main: 'Main' },
  pictures: 'pictures',
  chats: [{ name: 'Main', isMain: true, isLeftover: false }, { name: 'Units', isLeftover: false }],
  advisor: null,
  forYou: [{ id: 'units-path', from: 'Main', kind: 'input', title: 'Choose', canAnswer: true }],
  backlogForYou: [],
}
const check = body => checkSay(body, state, 50)

test('a message to the main chat may carry a picture the board kept, with words or without', () => {
  assert.deepEqual(check({ to: 'Main', text: ' This button ', picture: PATH }), { ok: true, message: { to: 'Main', ask: null, step: null, title: null, verdict: null, text: 'This button', picture: PATH } })
  assert.deepEqual(check({ to: 'Main', text: '', picture: PATH }).message, { to: 'Main', ask: null, step: null, title: null, verdict: null, text: '', picture: PATH })
  // Without a picture a message is as before, and needs words.
  assert.deepEqual(check({ to: 'Main', text: 'Hello' }).message, { to: 'Main', ask: null, step: null, title: null, verdict: null, text: 'Hello' })
  assert.deepEqual([check({ to: 'Main', text: '' }).status, check({ to: 'Main', text: '', picture: null }).status], [400, 400])
})

test('a picture goes only to the main chat, only as one the board kept, and only with a plain message', () => {
  const refused = body => [check(body).ok, check(body).status]
  assert.deepEqual(refused({ to: 'Units', text: 'See', picture: PATH }), [false, 400])
  // B193: only in the project's own picture folder, the one the settings name first.
  assert.equal(checkSay({ to: 'Main', text: 'See', picture: PATH }, { ...state, pictures: 'shots' }, 50).status, 400)
  assert.equal(checkSay({ to: 'Main', text: 'See', picture: 'shots/talk/2026-10-14-1144.png' }, { ...state, pictures: 'shots' }, 50).ok, true)
  for (const picture of ['pictures/talk/../../secret.png', 'C:\\game\\pictures\\talk\\2026-10-14-1144.png', 'pictures/jump/jump-arc.png', 5, {}]) {
    assert.deepEqual(refused({ to: 'Main', text: 'See', picture }), [false, 400], String(picture))
  }
  assert.deepEqual(refused({ to: 'Main', ask: 'units-path', text: 'A', picture: PATH }), [false, 400])
  assert.deepEqual(refused({ to: 'Main', command: 'resume', picture: PATH }), [false, 400])
})

test('the line typed into the main chat names the picture by its full path, under the words and above the board\'s mark', () => {
  const clock = () => '16:02'
  const where = path => `C:\\game\\${path.split('/').join('\\')}`
  assert.equal(messageText({ at: 2, ask: null, text: 'This button looks off.', picture: PATH }, clock, where),
    'This button looks off.\nPicture: C:\\game\\pictures\\talk\\2026-10-14-1144.png\n(typed on the worker board, 16:02)')
  assert.equal(messageText({ at: 2, ask: null, text: '', picture: PATH }, clock, where),
    'Picture: C:\\game\\pictures\\talk\\2026-10-14-1144.png\n(typed on the worker board, 16:02)')
  // Without a picture nothing changes.
  assert.equal(messageText({ at: 2, ask: null, text: 'Hello' }, clock, where), 'Hello\n(typed on the worker board, 16:02)')
})

test('the talk reads the picture back from that line, and only one in the talk\'s folder', () => {
  assert.deepEqual(splitPicture('This button.\nPicture: C:\\game\\pictures\\talk\\2026-10-14-1144.png', 'pictures'), { text: 'This button.', picture: PATH })
  assert.deepEqual(splitPicture('Picture: /home/me/game/pictures/talk/2026-10-14-1144.png', 'pictures'), { text: '', picture: PATH })
  assert.deepEqual(splitPicture('Picture: C:\\game\\pictures\\jump\\jump-arc.png', 'pictures'), { text: 'Picture: C:\\game\\pictures\\jump\\jump-arc.png', picture: null })
  assert.deepEqual(splitPicture('No picture here.', 'pictures'), { text: 'No picture here.', picture: null })
})

test('the talk shows the picture in the person\'s message, also while it waits for the main chat', () => {
  const PROJECT = 'C:\\game'
  const config = { ...parseConfig('{}', {}), project: PROJECT }
  const app = name => JSON.stringify({
    title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
    createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
  })
  const viaBoard = (at, text) => user(at, text, { origin: { kind: 'plugin', name: 'folder-branches', asUser: true } })
  const tail = [
    viaBoard(NOW - 10 * MIN, 'This button looks off.\nPicture: C:\\game\\pictures\\talk\\2026-10-14-1144.png\n(typed on the worker board, 10:20)'),
    answer(NOW - 9 * MIN, 'I see it: the border is cut. Handed to Game - Units.'),
    viaBoard(NOW - 8 * MIN, 'Picture: C:\\game\\pictures\\talk\\2026-10-14-1144-2.png\n(typed on the worker board, 10:22)'),
  ]
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main')],
    tails: { 'cli-Main': { text: tail.join('\n'), isCut: false, modifiedAt: NOW - MIN } },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const outbox = [{ id: 'm1', at: NOW - MIN, to: 'Main', ask: null, step: null, title: null, verdict: null, text: 'And this one', picture: 'pictures/talk/2026-10-14-1029.png', state: 'waiting' }]
  const seen = { shown: { Main: NOW - 5000 }, other: {} }
  const talk = buildState(raw, { outbox, board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config }).mainTalk
  assert.deepEqual(talk.messages.map(one => [one.from, one.text, one.picture ?? null]), [
    ['you', 'This button looks off.', PATH],
    ['chat', 'I see it: the border is cut. Handed to Game - Units.', null],
    // A picture alone is a message too.
    ['you', '', 'pictures/talk/2026-10-14-1144-2.png'],
  ])
  assert.deepEqual(talk.pending.map(one => [one.text, one.picture]), [['And this one', 'pictures/talk/2026-10-14-1029.png']])
})
