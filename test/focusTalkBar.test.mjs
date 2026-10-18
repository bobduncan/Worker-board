// Focus 4 (spec 2026-10-18, sections 4 and 6): the run's talk bar. The person's words go to the partner as the focus
// goal's brainstorm talk sends them, in the goal's thread (the one that runs, else one reopened or started), marked as
// the person's word: the answer to the partner's open question; while the partner has the turn, `talk: <words>`; in a
// thread started for them, its opening (`brainstorm`). On a fake file system; made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { messageText } from '../src/bridge.mjs'
import { parseThread } from '../src/brainstorm.mjs'
import { FOCUS_MOVES, focusMove } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { wakeFor } from '../src/say.mjs'

function fakeFs(files) {
  return {
    files,
    readFile: async path => {
      if (!(path in files)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return Buffer.from(files[path], 'latin1')
    },
    writeFile: async (path, bytes, options) => {
      if (options?.flag === 'wx' && path in files) throw Object.assign(new Error('there'), { code: 'EEXIST' })
      files[path] = Buffer.from(bytes).toString('latin1')
    },
    rename: async (from, to) => {
      files[to] = files[from]
      delete files[from]
    },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async dir => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1)),
  }
}
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const utf8 = text => Buffer.from(text, 'latin1').toString('utf8')

const MAP = 'C:/p/goals.md'
const DIR = 'C:/p/talks'
const GOALS = ['# Goals', 'Last id: G4', '', '- [ ] G2 Benches that feel like home', '  Done when: five visitors sit down unasked', '- [ ] G4 Lanterns', '  Done when: every path is lit after dark', ''].join('\n')
const NOW = new Date(2026, 9, 18, 15, 0).getTime()
const ctx = fs => ({
  canWrite: true, goalsFile: MAP, historyDir: 'C:/p/history', brainstormDir: DIR, brainstormFolder: 'talks', now: NOW, fs,
  partner: { name: 'Partner', isRunning: true }, job: 'C:/board/roles/partner.md',
})
const fileOf = path => `${DIR}/${path.split('/').pop()}`

async function picked() {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const pick = await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  return { fs, path: pick.result.thread }
}

test('talk is a move of the Focus page', () => {
  assert.ok(FOCUS_MOVES.includes('talk'))
})

test('while the partner has the turn: talk: with the words, the goal and the thread; the thread stays as it is', async () => {
  const { fs, path } = await picked()
  const before = fs.files[fileOf(path)]
  const said = await focusMove({ command: 'talk', id: 'G2', text: '  the benches   feel too far apart ' }, ctx(fs))
  assert.equal(said.ok, true, said.why)
  assert.equal(said.words.to, 'Partner')
  assert.equal(said.words.command, 'talk')
  assert.equal(said.words.text, `talk: the benches feel too far apart\nGoal: G2 Benches that feel like home\nThread: ${path}`)
  assert.equal(fs.files[fileOf(path)], before)
  assert.deepEqual(said.result, { id: 'G2', thread: path })
  // Typed as the person's word, and a partner not running is woken through the main chat.
  assert.match(messageText({ id: 'm', at: NOW, ...said.words }, () => '15:00'), /\n\(typed on the worker board, 15:00\)$/)
  const state = { restart: { main: 'Main' }, chats: [{ name: 'Main', isRunning: true }], advisor: { name: 'Partner', isRunning: false, appSession: 'local_x' } }
  assert.equal(wakeFor({ id: 'm', at: NOW, ...said.words, state: 'waiting' }, state, [], NOW, 4000)?.command, 'start')
})

test('the partner\'s question open: the words are its answer in the thread, and brainstorm answer is typed', async () => {
  const { fs, path } = await picked()
  fs.files[fileOf(path)] += latin('## Q1 (14:50)\nHow close should the benches stand?\n- A: in pairs (advised)\n- B: one by one\n')
  const said = await focusMove({ command: 'talk', id: 'G2', text: 'pairs, but facing the pond' }, ctx(fs))
  assert.equal(said.ok, true, said.why)
  assert.equal(said.words.command, 'brainstorm-answer')
  assert.equal(said.words.about, path)
  assert.equal(said.words.text, `brainstorm answer\nThread: ${path}\nQ1: Other — pairs, but facing the pond`)
  const thread = parseThread(utf8(fs.files[fileOf(path)]))
  assert.deepEqual([thread.questions[0].answer.key, thread.questions[0].answer.words], ['Other', 'pairs, but facing the pond'])
})

test('no talk runs: one is started with the words as its opening, linked under the goal, and brainstorm is typed', async () => {
  const { fs, path } = await picked()
  fs.files[fileOf(path)] = fs.files[fileOf(path)].replace('State: running', 'State: done')
  const said = await focusMove({ command: 'talk', id: 'G2', text: 'can we add shade?' }, ctx(fs))
  assert.equal(said.ok, true, said.why)
  assert.notEqual(said.result.thread, path)
  const fresh = parseThread(utf8(fs.files[fileOf(said.result.thread)]))
  assert.equal(fresh.opening, 'can we add shade?')
  assert.deepEqual(fresh.goal, { id: 'G2', title: 'Benches that feel like home' })
  assert.deepEqual(parseGoals(utf8(fs.files[MAP])).byId.get('G2').brainstorm, { path: said.result.thread, state: 'running' })
  assert.equal(said.words.command, 'brainstorm')
  assert.equal(said.words.text, `brainstorm\nThread: ${said.result.thread}\nGoal: G2 Benches that feel like home\nOpening: can we add shade?`)
})

test('a talk wrapped up is reopened for the words; one holding a proposal is named; no words, or not the focus, are refused', async () => {
  const { fs, path } = await picked()
  fs.files[fileOf(path)] = fs.files[fileOf(path)].replace('State: running', 'State: wrapping up')
  const reopened = await focusMove({ command: 'talk', id: 'G2', text: 'one more thing' }, ctx(fs))
  assert.equal(reopened.result.thread, path)
  assert.equal(parseThread(utf8(fs.files[fileOf(path)])).state, 'running')
  assert.equal(reopened.words.command, 'talk')
  fs.files[fileOf(path)] += latin('## Proposal (15:01)\nDecided:\n- benches\n')
  const held = await focusMove({ command: 'talk', id: 'G2', text: 'x' }, ctx(fs))
  assert.deepEqual([held.status, held.why], [409, 'The talk about this goal holds a proposal: create or discard it on the Brainstorm part first.'])
  assert.deepEqual((await focusMove({ command: 'talk', id: 'G2', text: '   ' }, ctx(fs))).status, 400)
  const other = await focusMove({ command: 'talk', id: 'G4', text: 'lanterns?' }, ctx(fs))
  assert.deepEqual([other.status, other.why], [409, 'That goal is not your focus any more.'])
})

// ---- the page: the bar works, and says no more that it comes later ----

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const RUN = {
  id: 'G2', title: 'Benches that feel like home', stage: 'run', vibe: ['warm wood'], vibePicture: null, vibeAgreed: '2026-10-18 10:00',
  parts: [{ title: 'Draw the bench', size: 'about 1 h', state: 'now', owner: 'Worker 1', done: 0, total: 1 }], partnerDecides: [], youDecide: [],
  howAgreed: '2026-10-18 11:00', progress: { done: 0, total: 1, minutesLeft: 60 }, thread: 'talks/x.md', note: null, needs: [],
}

test('the run\'s talk bar sends where the page may write, and says why not where it may not', () => {
  const view = JSON.parse(JSON.stringify(made.focusView(RUN, { nodes: [] }, { canWrite: true, whyNot: null })))
  assert.deepEqual(view.talkBar, { placeholder: 'Talk to your partner about this goal…', act: 'talk-bar', isEnabled: true, title: 'Your words go to your partner, in the talk about this goal' })
  const off = JSON.parse(JSON.stringify(made.focusView(RUN, { nodes: [] }, { canWrite: false, whyNot: 'This board only shows.' })))
  assert.deepEqual([off.talkBar.isEnabled, off.talkBar.title], [false, 'This board only shows.'])
  assert.equal(made.focusView({ ...RUN, stage: 'vibe' }, { nodes: [] }, { canWrite: true }).talkBar, undefined)
  assert.ok(!/comes in the next part|comes in a later part|FOCUS_LATER/.test(script))
  assert.match(script, /'focus-bar-words': 'bar'/)
  assert.match(script, /act === 'talk-bar' && focus !== null/)
})
