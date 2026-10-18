// B282: a picture pasted into the Advisor tab's chat box goes with the words, as in Talk to Main: shown small,
// removable, kept by the board, and named by its path so the Advisor can open it. One paste helper for both boxes.
// The person, 2026-10-17: "I want to be able to post picturures in this chat. when talking via the board to you. from
// the clip board." Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, user } from '../fixtures/lines.mjs'
import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 17, 10, 0)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const PICTURE = 'pictures/talk/2026-10-17-0955.png'

const app = name => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
const viaBoard = (at, text) => user(at, text, { origin: { kind: 'plugin', name: 'folder-branches', asUser: true } })

function build(advisor = [answer(NOW - 30 * MIN, 'ok')], outbox = []) {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}',
    appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail(advisor) },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config })
}

test('a picture the board kept goes with a line to the Advisor, as to the main chat; to a worker it does not', () => {
  const state = build()
  const said = checkSay({ to: 'Advisor', text: 'Is this the pond you mean?', picture: PICTURE }, state, 4000)
  assert.equal(said.ok, true)
  assert.equal(said.message.picture, PICTURE)
  // The words typed into its chat name the picture by its path, under the line.
  assert.equal(messageText({ ...said.message, at: NOW }, () => '10:00', path => `C:\\garden\\${path.replace(/\//g, '\\')}`),
    'Is this the pond you mean?\nPicture: C:\\garden\\pictures\\talk\\2026-10-17-0955.png\n(typed on the worker board, 10:00)')
  assert.equal(checkSay({ to: 'Advisor', picture: PICTURE }, state, 4000).ok, true, 'a picture alone is enough')
  assert.equal(checkSay({ to: 'Digger', text: 'Look', picture: PICTURE }, state, 4000).ok, false)
  assert.equal(checkSay({ to: 'Advisor', text: 'Look', picture: '../secret.png' }, state, 4000).ok, false, 'only a picture the board kept')
})

test('in the Advisor\'s chat a line typed on the board shows its words and its picture apart, without the board\'s mark', () => {
  const state = build([viaBoard(NOW - 5 * MIN, 'Is this the pond?\nPicture: C:\\garden\\pictures\\talk\\2026-10-17-0955.png\n(typed on the worker board, 09:55)'), answer(NOW - 4 * MIN, 'Yes.')])
  const typed = state.advisor.messages.find(one => one.from === 'you')
  assert.deepEqual([typed.text, typed.picture, typed.via], ['Is this the pond?', PICTURE, 'board'])
  // What it typed itself, or a line without a picture, is shown as it is.
  const plain = build([viaBoard(NOW - 5 * MIN, 'Hello\n(typed on the worker board, 09:55)')]).advisor.messages[0]
  assert.deepEqual([plain.text, plain.picture], ['Hello', null])
})

// The page

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8')
const style = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')

test('the Advisor\'s box has a place for the picture above the words and says Ctrl+V adds one', () => {
  assert.match(html, /<form class="say" id="say">\s*<div class="main-picture" id="say-picture" hidden><\/div>\s*<textarea id="say-text" rows="2" placeholder="Ask the advisor… Ctrl\+V adds a picture\."/)
  assert.match(style, /\.say \{[^}]*flex-wrap: wrap/)
  assert.match(style, /\.say \.main-picture-remove \{/)
})

test('one paste helper serves both boxes, not a copy: a slot per box, the same code to show, keep and take it away', () => {
  assert.match(script, /main: \{ box: 'main-picture', text: 'main-text', key: 'main-talk'/)
  assert.match(script, /advisor: \{ box: 'say-picture', text: 'say-text', key: 'talk'/)
  for (const name of ['function setSlotPicture(slot, file)', 'async function keepSlotPicture(slot)', 'function pasteInto(slot, event)', 'function wirePictureSlot(slot, form)']) {
    assert.equal(script.split(name).length, 2, `${name} once`)
  }
  assert.match(script, /wirePictureSlot\(pictureSlots\.main, 'main-say'\)/)
  assert.match(script, /wirePictureSlot\(pictureSlots\.advisor, 'say'\)/)
  // The old one-box code is gone.
  for (const old of ['let talkPicture', 'let talkPasteProblem', 'function setTalkPicture', 'async function keepTalkPicture']) assert.ok(!script.includes(old), old)
  // The same limits: the board's types and size, read in one place.
  assert.equal(script.split('file.size > TALK_BYTES').length, 2)
  assert.equal(script.split("fetch('/api/talk/picture'").length, 2)
})

test('the Advisor\'s chat sends the picture with the words and shows it in the message, small', () => {
  const submit = script.slice(script.indexOf("$('say').addEventListener('submit'"), script.indexOf("$('say-text').addEventListener('keydown'"))
  assert.ok(submit.includes('await keepSlotPicture(slot)'))
  assert.ok(submit.includes('...(picture === null ? {} : { picture })'))
  const message = script.slice(script.indexOf('function drawMessage('), script.indexOf('function drawTalk('))
  assert.ok(message.includes("frame.classList.add('talk-picture')"))
  assert.match(script, /picture: message\.picture \?\? null,\n\s+note: message\.via === 'board'/)
  assert.match(script, /picture: typed\.picture \?\? null/)
  // The review's findings: Send is off while the picture is kept; a picture changed meanwhile is neither sent nor
  // taken away; a click on a picture does not fold the message; a message's picture is shown whole.
  assert.ok(submit.includes("$('say-send').disabled = true\n  const pending = slot.picture"))
  assert.ok(submit.includes('if (slot.picture !== pending || (pending !== null && picture === null)) return slot.redraw()'))
  assert.match(script, /if \(slot\.picture !== pending\) return drawMainTalk\(board\)/)
  assert.match(script, /\$\('messages'\)\.addEventListener\('click'[^]*?event\.target\.closest\('\[data-zoom\]'\) !== null\) return/)
  assert.match(style, /\.picture\.talk-picture img \{[^}]*object-fit: contain/)
})
