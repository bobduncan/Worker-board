// B354: a goal becomes the focus and gets its tick only with a checkable "Done when" line. Without one the board says so,
// and the person's button asks the partner to write it (`done when:`). Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { messageText } from '../src/bridge.mjs'
import { FOCUS_MOVES, focusMove } from '../src/focus.mjs'
import { hasDoneWhen, parseGoals } from '../src/goals.mjs'
import { editGoals } from '../src/goalsWrite.mjs'
import { FOCUS_COMMANDS, wakeFor } from '../src/say.mjs'

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

const MAP = 'D:/Work/p/goals.md'
const DIR = 'D:/Work/p/talks'
const GOALS = [
  '# Goals',
  'Last id: G4',
  '',
  '- [~] G1 A garden people visit',
  '  - [ ] G2 Benches that feel like home',
  '    Done when: five visitors sit on a bench for a minute without being asked',
  '    Steps: B16',
  '  - [x] G3 The gate',
  '- [ ] G4 Lanterns',
  '  Done when:   ',
  '',
].join('\n')
const NOW = new Date(2026, 9, 18, 22, 5).getTime()
const PARTNER = { name: 'Partner', isRunning: true }
const JOB = 'D:/Work/board/roles/partner.md'
const ctx = (fs, extra = {}) => ({
  canWrite: true, goalsFile: MAP, historyDir: 'D:/Work/p/history', brainstormDir: DIR, brainstormFolder: 'talks', now: NOW, fs,
  partner: PARTNER, job: JOB, ...extra,
})
const goalsAt = (fs, extra = {}) => ({ canWrite: true, file: MAP, historyDir: 'D:/Work/p/history', now: NOW, fs, ...extra })
const mapOf = fs => parseGoals(utf8(fs.files[MAP]))

test('a Done when line counts only with words in it', () => {
  const map = parseGoals(GOALS)
  assert.equal(hasDoneWhen(map.byId.get('G2')), true)
  assert.equal(hasDoneWhen(map.byId.get('G4')), false)
  assert.equal(hasDoneWhen(map.byId.get('G1')), false)
  assert.equal(hasDoneWhen(undefined), false)
})

test('a goal without a Done when is not ticked on the Goals part; with one it is, and the other states stay free', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const refused = await editGoals({ command: 'state', id: 'G4', state: 'done' }, goalsAt(fs))
  assert.equal(refused.ok, false)
  assert.equal(refused.status, 409)
  assert.match(refused.why, /Done when/)
  assert.match(refused.why, /partner/)
  assert.equal(mapOf(fs).byId.get('G4').state, 'open')
  assert.equal((await editGoals({ command: 'state', id: 'G4', state: 'now' }, goalsAt(fs))).ok, true)
  assert.equal((await editGoals({ command: 'state', id: 'G4', state: 'open' }, goalsAt(fs))).ok, true)
  assert.equal((await editGoals({ command: 'state', id: 'G2', state: 'done' }, goalsAt(fs))).ok, true)
  assert.equal(mapOf(fs).byId.get('G2').state, 'done')
  // A goal done already is opened again freely.
  assert.equal((await editGoals({ command: 'state', id: 'G3', state: 'open' }, goalsAt(fs))).ok, true)
})

test('a goal without a Done when does not become the focus: the board says so, writes nothing and types nothing', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const refused = await focusMove({ command: 'focus', id: 'G4' }, ctx(fs))
  assert.equal(refused.ok, false)
  assert.equal(refused.status, 409)
  assert.match(refused.why, /^G4 has no Done when yet/)
  assert.equal(mapOf(fs).focus, null)
  assert.equal(Object.keys(fs.files).some(path => path.startsWith(`${DIR}/`)), false)
  const picked = await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  assert.equal(picked.ok, true)
  assert.equal(mapOf(fs).focus, 'G2')
})

test('something new is written into the map, and the partner is asked for its Done when; the person picks it once it stands', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const made = await focusMove({ command: 'focus', text: '  A pond with fish   people feed ' }, ctx(fs))
  assert.equal(made.ok, true)
  assert.deepEqual(made.result, { id: 'G5', isFocus: false })
  const map = mapOf(fs)
  assert.deepEqual([map.focus, map.byId.get('G5').title, map.lastGoal], [null, 'A pond with fish people feed', 5])
  assert.equal(Object.keys(fs.files).some(path => path.startsWith(`${DIR}/`)), false)
  assert.equal(made.words.to, 'Partner')
  assert.equal(made.words.command, 'done-when')
  assert.equal(made.words.about, 'G5')
  assert.equal(made.words.text, `done when: G5 A pond with fish people feed\nWords: A pond with fish people feed\nYour job: ${JOB}, "Done when"`)
})

test('the button asks the partner for a goal\'s Done when, as the person\'s word; a goal with one, done or unknown is refused', async () => {
  assert.ok(FOCUS_MOVES.includes('done-when'))
  assert.ok(FOCUS_COMMANDS.includes('done-when'))
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const before = fs.files[MAP]
  const asked = await focusMove({ command: 'done-when', id: 'G4' }, ctx(fs))
  assert.equal(asked.ok, true)
  assert.deepEqual(asked.result, { id: 'G4' })
  assert.equal(asked.words.text, `done when: G4 Lanterns\nYour job: ${JOB}, "Done when"`)
  assert.match(messageText({ id: 'm1', at: NOW, ...asked.words, state: 'waiting' }, () => '22:05'), /^done when: G4 Lanterns\nYour job: .+\n\(typed on the worker board, 22:05\)$/)
  assert.equal(fs.files[MAP], before)
  const has = await focusMove({ command: 'done-when', id: 'G2' }, ctx(fs))
  assert.deepEqual([has.status, has.why], [409, 'G2 has a Done when already: change it on the Goals part.'])
  assert.equal((await focusMove({ command: 'done-when', id: 'G3' }, ctx(fs))).status, 409)
  assert.equal((await focusMove({ command: 'done-when', id: 'G9' }, ctx(fs))).status, 409)
  assert.equal((await focusMove({ command: 'done-when', id: 'x' }, ctx(fs))).status, 400)
  assert.equal((await focusMove({ command: 'done-when', id: 'G4' }, ctx(fs, { partner: null }))).status, 409)
  // A partner that does not run is woken through the main chat, as for every word of the Focus page.
  const state = { restart: { main: 'Main' }, chats: [{ name: 'Main', isRunning: true }], advisor: { name: 'Partner', isRunning: false, appSession: 'local_abc' } }
  assert.equal(wakeFor({ id: 'm1', at: NOW, ...asked.words, state: 'waiting' }, state, [], NOW, 4000)?.command, 'start')
})

test('"Is the vibe there?" Yes ticks the goal only with a Done when: an older focus without one is asked for it first', async () => {
  const older = GOALS.replace('# Goals\n', '# Goals\nFocus: G4\n')
    .replace('  Done when:   \n', '  Vibe: warm light\n  Vibe agreed: 2026-10-18 10:00\n  Part: Hang them · about 1 h · steps B20\n  How agreed: 2026-10-18 10:30\n')
  const fs = fakeFs({ [MAP]: latin(older) })
  const refused = await focusMove({ command: 'vibe-there-yes', id: 'G4' }, ctx(fs, { allDone: true }))
  assert.equal(refused.status, 409)
  assert.match(refused.why, /Done when/)
  assert.equal(mapOf(fs).byId.get('G4').state, 'open')
  assert.equal(mapOf(fs).focus, 'G4')
  const written = utf8(fs.files[MAP]).replace('  Vibe: warm light\n', '  Done when: every path is lit after dark\n  Vibe: warm light\n')
  fs.files[MAP] = latin(written)
  const ticked = await focusMove({ command: 'vibe-there-yes', id: 'G4' }, ctx(fs, { allDone: true }))
  assert.equal(ticked.ok, true)
  assert.equal(mapOf(fs).byId.get('G4').state, 'done')
})

test('something new that waits for its Done when changes no focus, so the partner\'s high effort mode stays as it is', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const isSameFocus = body\.command === 'focus' && \(body\.id === state\.focus\?\.id \|\| done\.result\?\.isFocus === false\)/)
  assert.match(server, /const back = isSameFocus \? null : effortBack\(body\.command, state\.advisor\?\.effort\)/)
})
