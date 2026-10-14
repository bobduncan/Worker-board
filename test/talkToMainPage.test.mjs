// B161: the right side's two tabs, and how the main chat's answers read in "Talk to Main": its closing block and its
// "For you" block are shown as such, not as raw marks. The page's own code is run here, cut out of board.js between
// its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`${cut('talkmain')}\nObject.assign(this, { talkParts, mainTalkView })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const ANSWER = [
  'B12 is handed to Game - Levels.',
  '',
  '> **For you**',
  '> 1. **Answer:** Snow first? I advise yes.',
  '',
  '---',
  '',
  '```diff',
  '  Prompt: a snowy mountain area',
  '  Who:    Game - Main',
  '+ Done:   yes',
  '```',
].join('\n')

test('an answer of the main chat reads in parts: its words, its "For you" block, a rule, and its closing block line by line', () => {
  assert.deepEqual(plain(page.talkParts(ANSWER)), [
    { kind: 'text', text: 'B12 is handed to Game - Levels.' },
    { kind: 'quote', text: '**For you**\n1. **Answer:** Snow first? I advise yes.' },
    { kind: 'rule' },
    { kind: 'code', lang: 'diff', lines: [{ text: '  Prompt: a snowy mountain area', tone: 'plain' }, { text: '  Who:    Game - Main', tone: 'plain' }, { text: '+ Done:   yes', tone: 'good' }] },
  ])
  assert.equal(page.talkParts('```diff\n- Done:   no, the board did not answer\n```')[0].lines[0].tone, 'bad')
  // A block that is never closed keeps its lines; words alone are one part.
  assert.deepEqual(plain(page.talkParts('```\nhalf')), [{ kind: 'code', lang: '', lines: [{ text: 'half', tone: 'plain' }] }])
  assert.deepEqual(plain(page.talkParts('Just words.\nTwo lines.')), [{ kind: 'text', text: 'Just words.\nTwo lines.' }])
})

test('the head says whom the talk is with, and whether its chat runs', () => {
  const talk = more => ({ name: 'Main', state: 'free', doingNow: null, isRunning: true, messages: [], pending: [], ...more })
  assert.deepEqual(plain(page.mainTalkView(talk())), { title: 'Talk to Main', tab: 'Talk to Main', status: { text: 'Main is online', tone: 'on' } })
  assert.deepEqual(plain(page.mainTalkView(talk({ state: 'working', doingNow: 'Reading the backlog' }))).status, { text: 'Main is working: Reading the backlog', tone: 'on' })
  assert.deepEqual(plain(page.mainTalkView(talk({ isRunning: false }))).status, { text: 'Main\'s chat is not running: what you type waits until it runs', tone: 'off' })
  assert.deepEqual(plain(page.mainTalkView(talk({ isRunning: null }))).status, { text: 'Main', tone: 'unknown' })
  assert.deepEqual(plain(page.mainTalkView(null)), { title: 'Talk to the main chat', tab: 'Talk to Main', status: { text: 'No main chat is open', tone: 'off' } })
})

test('the right side has two tabs, "For you" with its count and "Talk to Main", and the chat\'s form', () => {
  const side = html.slice(html.indexOf('<aside class="inbox"'), html.indexOf('</aside>'))
  assert.match(side, /data-side="needs"[^>]*>For you <span class="count" id="needs-count"><\/span><\/button>/)
  assert.match(side, /data-side="main"[^>]*>Talk to Main<\/button>/)
  for (const id of ['side-needs', 'needs', 'side-main', 'main-messages', 'main-say', 'main-text', 'main-send', 'main-note']) assert.ok(side.includes(`id="${id}"`), id)
  // "For you" keeps everything it has today.
  for (const id of ['needs-closed', 'needs-order']) assert.ok(side.includes(`id="${id}"`), id)
  for (const rule of ['.side-tab', '.side-tab.is-active', '.talk-message', '.talk-quote', '.talk-code .is-good', '.talk-code .is-bad']) assert.ok(style.includes(rule), rule)
})
