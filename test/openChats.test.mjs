// B322: a new project's first chats, its main chat and its Advisor, opened with their names. The person, 2026-10-18
// 15:23: "also starting a new project feels like 1 click, the board setsup the folder and chat and the work stores
// itself as well." What the Claude desktop app allows from outside (found in B322): its link
// `claude://code/new?q=<first words>&folder=<folder>` opens a new chat of the Code tab in that folder with its first
// words ready; nothing from outside sends them or names the chat. So the board shows, for each chat the project lacks,
// a button that opens it so; the first words ask the chat to name itself, join the list and read its job, and the
// person presses Enter. The board notices the chat once it has its name. Made-up projects only.

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
vm.runInNewContext(`${cut('openchats')}\nObject.assign(this, { openChatLink, firstWords, chatsToOpen })`, page)

const project = 'D:\\Work\\My garden'
const board = 'D:\\Work\\My garden\\worker-board'
const state = (more = {}) => ({
  chatPrefix: 'Garden - ',
  workers: { main: null, mainTitle: 'Garden - Main', project },
  advisor: null,
  openChats: { board, name: 'My garden', advisor: 'Advisor' },
  ...more,
})

test('openChatLink: the app\'s link for a new chat in a folder, its first words ready', () => {
  const link = page.openChatLink(project, 'Hello & welcome: 50% done?')
  assert.ok(link.startsWith('claude://code/new?'), link)
  const asked = new URL(link)
  assert.deepEqual([asked.searchParams.get('q'), asked.searchParams.get('folder')], ['Hello & welcome: 50% done?', project])
})

test('firstWords: the chat names itself with its exact title, joins the list, and reads its job and the project\'s facts', () => {
  const main = page.firstWords({ kind: 'main', title: 'Garden - Main', name: 'Main', projectName: 'My garden', project, board })
  for (const words of ['"Garden - Main"', 'set_session_title', '"self"', 'mcp__folder-branches__chat', 'join', '"Main"', 'role "main"',
    `${board}\\roles\\main.md`, `${board}\\roles\\protocol.md`, `${project}\\.claude\\main-briefing.md`, `${project}\\CLAUDE.md`, 'My garden']) {
    assert.ok(main.includes(words), words)
  }
  const advisor = page.firstWords({ kind: 'advisor', title: 'Garden - Advisor', name: 'Advisor', projectName: 'My garden', project, board })
  for (const words of ['"Garden - Advisor"', 'role "worker"', `${board}\\roles\\partner.md`, `${board}\\roles\\protocol.md`, `${project}\\CLAUDE.md`]) {
    assert.ok(advisor.includes(words), words)
  }
  // Within what the app's link carries, with room to spare.
  assert.ok(main.length < 3000 && advisor.length < 3000)
})

test('chatsToOpen: the main chat and the Advisor while the project has none, each with its link; none on the demo', () => {
  const both = page.chatsToOpen(state())
  assert.deepEqual([...both.map(one => one.title)], ['Garden - Main', 'Garden - Advisor'])
  for (const one of both) {
    const asked = new URL(one.link)
    assert.equal(asked.searchParams.get('folder'), project)
    assert.equal(asked.searchParams.get('q'), one.words)
  }
  // Once a chat has its name, it is no longer offered.
  assert.deepEqual([...page.chatsToOpen(state({ workers: { main: 'Main', mainTitle: 'Garden - Main', project } })).map(one => one.title)], ['Garden - Advisor'])
  assert.equal(page.chatsToOpen(state({ workers: { main: 'Main', mainTitle: 'Garden - Main', project }, advisor: { name: 'Advisor' } })).length, 0)
  // No Advisor in the settings: only the main chat. The demo, a board that only shows, or no list of chats: nothing.
  assert.deepEqual([...page.chatsToOpen(state({ openChats: { board, name: 'My garden', advisor: null } })).map(one => one.title)], ['Garden - Main'])
  for (const none of [state({ openChats: null }), state({ workers: null }), state({ workers: { main: null, mainTitle: null, project } }), state({ workers: { main: null, mainTitle: 'Garden - Main', project: '' } })]) {
    assert.equal(page.chatsToOpen(none).length, 0)
  }
})

test('the box is drawn on the Overview with each chat\'s button and a copy of its first words', () => {
  assert.match(script, /function drawOpenChats\(state\)/)
  assert.match(script, /drawOpenChats\(state\), drawWorkers\(state\)/)
  assert.match(style, /\.open-chats \{/)
})
