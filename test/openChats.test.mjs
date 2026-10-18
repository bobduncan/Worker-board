// B322, B335: a new project's chats set up with one button. What the Claude desktop app allows from outside (found in
// B322): its link `claude://code/new?q=<first words>&folder=<folder>` opens a new chat of the Code tab in that folder
// with its first words ready; nothing from outside sends them or names the chat. The person on B322's box of two
// buttons, Q71 (2026-10-18 17:44): "Rejected. its not clear what im looking at. if i need to create chats for a new
// project then just 1 button saying initialise or something is sufficient". So one button, Initialise, opens the main
// chat; its first words have it name itself, join, read its job and start the Advisor by a chip. Made-up projects only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('openchats')}\nObject.assign(this, { openChatLink, firstWords, setupChat, initLabel })`, page)

const project = 'D:\\Work\\My garden'
const board = 'D:\\Work\\My garden\\worker-board'
const state = (more = {}) => ({
  chatPrefix: 'Garden - ',
  workers: { main: null, mainTitle: 'Garden - Main', project },
  advisor: null,
  openChats: { board, name: 'My garden', advisor: 'Advisor' },
  ...more,
})

test('the page\'s script as a whole has no syntax error (the tests here run parts of it only)', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'board.js' }))
})

test('openChatLink: the app\'s link for a new chat in a folder, its first words ready', () => {
  const asked = new URL(page.openChatLink(project, 'Hello & welcome: 50% done?'))
  assert.equal(`${asked.protocol}//${asked.host}${asked.pathname}`, 'claude://code/new')
  assert.deepEqual([asked.searchParams.get('q'), asked.searchParams.get('folder')], ['Hello & welcome: 50% done?', project])
})

test('setupChat: one chat to open, the main chat, while the project has none; its words start the Advisor', () => {
  const chat = page.setupChat(state())
  assert.equal(chat.title, 'Garden - Main')
  const asked = new URL(chat.link)
  assert.deepEqual([asked.searchParams.get('folder'), asked.searchParams.get('q')], [project, chat.words])
  for (const words of ['"Garden - Main"', 'set_session_title', '"self"', 'mcp__folder-branches__chat', '"join"', 'name "Main"', 'role "main"',
    `${board}\\roles\\main.md`, `${board}\\roles\\protocol.md`, `${project}\\.claude\\main-briefing.md`, `${project}\\CLAUDE.md`, 'My garden',
    'mcp__ccd_session__spawn_task', '"Garden - Advisor"', `${board}\\roles\\partner.md`, 'click it']) {
    assert.ok(chat.words.includes(words), words)
  }
  assert.ok(chat.words.length < 3000)
  // Once the main chat has its name, there is nothing to set up.
  assert.equal(page.setupChat(state({ workers: { main: 'Main', mainTitle: 'Garden - Main', project } })), null)
})

test('setupChat: the Advisor is left out when there is one already, none is set, or it would be named as the main chat', () => {
  for (const without of [state({ advisor: { name: 'Advisor' } }), state({ openChats: { board, name: 'My garden', advisor: null } }), state({ openChats: { board, name: 'My garden', advisor: 'main' } })]) {
    const words = page.setupChat(without).words
    assert.ok(!words.includes('spawn_task'), words)
  }
})

test('setupChat: nothing on the demo, a board that only shows, without a list of chats or without its prefix', () => {
  for (const none of [state({ openChats: null }), state({ workers: null }), state({ workers: { main: null, mainTitle: null, project } }),
    state({ workers: { main: null, mainTitle: 'Garden - Main', project: '' } }), state({ chatPrefix: '', workers: { main: null, mainTitle: 'Main', project } })]) {
    assert.equal(page.setupChat(none), null)
  }
})

test('firstWords: paths as the board\'s folder writes them, on Windows and on a Mac', () => {
  const mac = page.firstWords({ title: 'Garden - Main', name: 'Main', projectName: 'Garden', project: '/Users/x/garden', board: '/Users/x/garden/worker-board' })
  assert.ok(mac.includes('/Users/x/garden/worker-board/roles/main.md') && mac.includes('/Users/x/garden/.claude/main-briefing.md') && !mac.includes('\\'), mac)
})

test('the button says Initialise, and for a while after its click that the main chat was opened', () => {
  assert.equal(page.initLabel(null, 0, () => ''), 'Initialise the chats')
  assert.equal(page.initLabel(1000, 1000 + 60_000, () => '17:01'), 'Opened 17:01: press Enter in the Claude app')
  assert.equal(page.initLabel(1000, 1000 + 6 * 60_000, () => ''), 'Initialise the chats')
})

test('one box, one button: in the workers part and under the simple view\'s bar; no copy buttons, no second box', () => {
  const box = script.slice(script.indexOf('function setupBox(chat)'), script.indexOf('$(\'lanes\').addEventListener(\'click\', event => {\n  const button'))
  assert.equal((box.match(/el\('a'/g) ?? []).length, 1)
  assert.ok(!script.includes('Copy its first words') && !script.includes('drawOpenChats'))
  const simple = script.slice(script.indexOf('function drawSimpleOverview(state)'), script.indexOf('fill($(\'simple-bar\'), parts)'))
  assert.match(simple, /setupChat\(state\)/)
  assert.match(script, /if \(setup !== null\) return setupBox\(setup\)/)
  assert.match(style, /\.open-chats-button \{/)
})
