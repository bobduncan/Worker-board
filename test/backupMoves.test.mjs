// The backup focus (the person, 2026-11-24): the Focus page's moves on it (POST /api/goals `backup`, and the goal definition
// and the how of the backup up to Go), the partner's drafts of it, and when it becomes the focus. Fake file system; made-up names.
import assert from 'node:assert/strict'
import test from 'node:test'

import { backupDue, focusMove } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'

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
const GOALS = [
  '# Goals',
  'Last id: G4',
  '',
  '- [~] G1 A garden people visit',
  '  - [ ] G2 Benches that feel like home',
  '    Done when: five visitors sit down unasked',
  '    Steps: B16',
  '  - [x] G3 The gate',
  '- [ ] G4 Lanterns',
  '  Done when: every path is lit after dark',
  '',
].join('\n')
const NOW = new Date(2026, 9, 18, 14, 5).getTime()
const PARTNER = { name: 'Partner', isRunning: true }
const ctx = (fs, extra = {}) => ({
  canWrite: true, goalsFile: MAP, historyDir: 'C:/p/history', brainstormDir: DIR, brainstormFolder: 'talks', now: NOW, fs,
  partner: PARTNER, job: 'C:/board/roles/partner.md', ...extra,
})
const mapOf = fs => parseGoals(utf8(fs.files[MAP]))

const withFocus = fs => focusMove({ command: 'focus', id: 'G2' }, ctx(fs))

test('Set as backup writes the Backup line and types "backup focus:" to the partner once; again types nothing', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await withFocus(fs)
  const done = await focusMove({ command: 'backup', id: 'G4' }, ctx(fs))
  assert.equal(done.ok, true)
  assert.equal(mapOf(fs).backup, 'G4')
  assert.equal(done.words.command, 'backup')
  assert.equal(done.words.to, 'Partner')
  assert.match(done.words.text, /^backup focus: G4 Lanterns\nDone when: every path is lit after dark\nYour job: C:\/board\/roles\/partner\.md, "The backup focus"$/)
  const again = await focusMove({ command: 'backup', id: 'G4' }, ctx(fs))
  assert.deepEqual([again.ok, again.words, again.result.unchanged], [true, null, true])
})

test('a backup is refused without a focus, for the focus itself, a done goal, one without a Done when, one not in the map', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  assert.equal((await focusMove({ command: 'backup', id: 'G4' }, ctx(fs))).status, 409)
  await withFocus(fs)
  for (const id of ['G2', 'G3', 'G1', 'G9']) assert.equal((await focusMove({ command: 'backup', id }, ctx(fs))).status, 409, id)
  assert.equal((await focusMove({ command: 'backup', id: 'x' }, ctx(fs))).status, 400)
  assert.equal(mapOf(fs).backup, null)
})

test('Remove takes the Backup line out and types nothing', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await withFocus(fs)
  await focusMove({ command: 'backup', id: 'G4' }, ctx(fs))
  const done = await focusMove({ command: 'backup', id: null }, ctx(fs))
  assert.deepEqual([done.ok, done.words], [true, null])
  assert.equal(mapOf(fs).backup, null)
})

test('the backup is drafted and agreed as the focus is, up to Go; another goal still is not', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await withFocus(fs)
  await focusMove({ command: 'backup', id: 'G4' }, ctx(fs))
  assert.equal((await focusMove({ command: 'vibe-draft', id: 'G4', lines: ['every path glows'] }, ctx(fs))).ok, true)
  const notYet = await focusMove({ command: 'vibe-not-yet', id: 'G4', text: 'warmer light' }, ctx(fs))
  assert.equal(notYet.words.command, 'vibe-not-yet')
  assert.equal((await focusMove({ command: 'vibe-agree', id: 'G4' }, ctx(fs))).ok, true)
  assert.notEqual(mapOf(fs).byId.get('G4').vibeAgreed, null)
  assert.equal((await focusMove({ command: 'how-draft', id: 'G4', parts: ['Lamps · about 2 h · done when: every path has a lamp'] }, ctx(fs))).ok, true)
  const go = await focusMove({ command: 'how-go', id: 'G4' }, ctx(fs))
  assert.equal(go.words.command, 'how-go')
  assert.notEqual(mapOf(fs).byId.get('G4').howAgreed, null)
  assert.equal(mapOf(fs).focus, 'G2')
  // The talk words stay the focus's: a goal that is neither focus nor backup is refused.
  assert.equal((await focusMove({ command: 'talk', id: 'G4', text: 'hi' }, ctx(fs))).status, 409)
  await focusMove({ command: 'backup', id: null }, ctx(fs))
  assert.equal((await focusMove({ command: 'vibe-draft', id: 'G4', lines: ['x'] }, ctx(fs))).status, 409)
})

test('a backup whose how is agreed already is set without a word to the partner', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS.replace('  Done when: every path is lit after dark', '  Done when: every path is lit after dark\n  Goal definition agreed: 2026-10-18 13:00\n  How agreed: 2026-10-18 13:30')) })
  await withFocus(fs)
  const done = await focusMove({ command: 'backup', id: 'G4' }, ctx(fs))
  assert.deepEqual([done.ok, done.words], [true, null])
})

test('backupDue: picks the backup once the focus is done or gone, clears a done or gone backup, waits otherwise', () => {
  const map = text => parseGoals(text)
  const base = GOALS.replace('Last id: G4', 'Last id: G4\nFocus: G2\nBackup: G4')
  assert.equal(backupDue(map(base)), null)
  assert.deepEqual(backupDue(map(base.replace('- [ ] G2 Benches', '- [x] G2 Benches'))), { pick: 'G4' })
  assert.deepEqual(backupDue(map(base.replace('Focus: G2', 'Focus:'))), { pick: 'G4' })
  assert.deepEqual(backupDue(map(base.replace('Focus: G2', 'Focus: G9'))), { pick: 'G4' })
  assert.deepEqual(backupDue(map(base.replace('- [ ] G4 Lanterns', '- [x] G4 Lanterns'))), { clear: true })
  assert.deepEqual(backupDue(map(base.replace('Backup: G4', 'Backup: G9'))), { clear: true })
  assert.equal(backupDue(map(base.replace('Focus: G2', 'Focus:').replace('  Done when: every path is lit after dark\n', ''))), null)
  assert.equal(backupDue(map(GOALS)), null)
})

test('the backup picked as the focus loses its Backup line, and the partner gets the focus word', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await withFocus(fs)
  await focusMove({ command: 'backup', id: 'G4' }, ctx(fs))
  const picked = await focusMove({ command: 'focus', id: 'G4' }, ctx(fs))
  assert.equal(picked.words.command, 'focus')
  assert.deepEqual([mapOf(fs).focus, mapOf(fs).backup], ['G4', null])
})
