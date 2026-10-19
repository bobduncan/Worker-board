// B358: no goal is ticked on a feeling. Ticking a goal on the Goals part, and Yes to "Is the vibe there?", first ask the
// partner for the goal's re-check against its Done when and its vibe; a passed re-check ticks the goal and gives the
// person a recap, a failed one keeps it open with its gap named (an attempt), and the person may still tick it after a
// failed one (an overturn, written under it). Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { goalChecked, focusMove } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { FOCUS_COMMANDS, wakeFor } from '../src/say.mjs'
import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

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
const GOALS = [
  '# Goals',
  'Last id: G3',
  'Focus: G2',
  '',
  '- [~] G1 A garden people visit',
  '  Done when: ten visitors walk every path in a day',
  '  - [~] G2 Benches that feel like home',
  '    Done when: five visitors sit on a bench for a minute unasked',
  '    Vibe: you sit down without thinking',
  '- [ ] G3 Lanterns',
  '',
].join('\n')
const NOW = new Date(2026, 9, 19, 9, 0).getTime()
const ctx = (fs, extra = {}) => ({ canWrite: true, goalsFile: MAP, historyDir: 'D:/Work/p/history', brainstormDir: 'D:/Work/p/talks', brainstormFolder: 'talks', now: NOW, fs, partner: { name: 'Partner', isRunning: true }, job: 'D:/Work/board/roles/partner.md', ...extra })
const mapOf = fs => parseGoals(utf8(fs.files[MAP]))

test('the goal map reads a re-check asked, its outcomes and an overturn', () => {
  const map = parseGoals([
    '- [ ] G1 Lanterns',
    '  Done when: every path is lit',
    '  Recheck asked: 2026-10-19 09:00',
    '  Rechecked (2026-10-19 08:00, Partner): failed · 1 of 2 points pass · gap: the gate path is dark · evidence pictures/g1/evidence.png',
    '  Rechecked (2026-10-19 08:30, Partner): waits for you · 1 of 2 points pass · for you: warm enough? · evidence none (nothing to see)',
    '  Overturned (2026-10-19 08:40): ticked by you after the re-check failed',
    '',
  ].join('\n')).byId.get('G1')
  assert.equal(map.recheckAsked, '2026-10-19 09:00')
  assert.deepEqual(map.rechecks, [
    { at: '2026-10-19 08:00', by: 'Partner', verdict: 'failed', summary: '1 of 2 points pass', gap: 'the gate path is dark', evidence: 'pictures/g1/evidence.png' },
    { at: '2026-10-19 08:30', by: 'Partner', verdict: 'waits for you', summary: '1 of 2 points pass', gap: 'warm enough?', evidence: 'none (nothing to see)' },
  ])
  assert.deepEqual(map.overturned, ['ticked by you after the re-check failed'])
  assert.deepEqual(map.notes, [])
})

test('a tick on the Goals part asks the partner for the re-check, once; without a Done when it is refused', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  assert.match((await focusMove({ command: 'goal-done', id: 'G3' }, ctx(fs))).why, /^G3 gets its tick only with a Done when/)
  const asked = await focusMove({ command: 'goal-done', id: 'G1' }, ctx(fs))
  assert.equal(asked.ok, true, asked.why)
  assert.deepEqual(asked.result, { id: 'G1', recheck: 'asked' })
  assert.equal(asked.words.text, 'goal re-check: G1 A garden people visit\nDone when: ten visitors walk every path in a day\nYour job: D:/Work/board/roles/partner.md, "The goal re-check"')
  assert.equal(asked.words.command, 'goal-recheck')
  assert.ok(FOCUS_COMMANDS.includes('goal-recheck'))
  assert.deepEqual([mapOf(fs).byId.get('G1').state, mapOf(fs).byId.get('G1').recheckAsked], ['now', '2026-10-19 09:00'])
  const again = await focusMove({ command: 'goal-done', id: 'G1' }, ctx(fs))
  assert.deepEqual([again.words, again.result.unchanged], [null, true])
  // A partner that does not run is woken for it through the main chat.
  const state = { restart: { main: 'Main' }, chats: [{ name: 'Main', isRunning: true }], advisor: { name: 'Partner', isRunning: false } }
  assert.equal(wakeFor({ id: 'm1', at: NOW, ...asked.words, state: 'waiting' }, state, [], NOW, 4000)?.command, 'start')
})

test('a passed re-check ticks the goal, clears the focus and takes the asked line away; a failed one keeps it open as an attempt', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await focusMove({ command: 'goal-done', id: 'G2' }, ctx(fs))
  const failed = await goalChecked({ id: 'G2', verdict: 'failed', line: 'failed · 1 of 2 points pass · gap: nobody sat down unasked · evidence pictures/g2/evidence.png', by: 'Partner' }, ctx(fs))
  assert.deepEqual(failed.result, { id: 'G2', title: 'Benches that feel like home', ticked: false, attempts: 1 })
  let goal = mapOf(fs).byId.get('G2')
  assert.deepEqual([goal.state, goal.recheckAsked, goal.rechecks.at(-1).verdict, mapOf(fs).focus], ['now', null, 'failed', 'G2'])
  await focusMove({ command: 'goal-done', id: 'G2' }, ctx(fs))
  const passed = await goalChecked({ id: 'G2', verdict: 'passed', line: 'passed · 2 of 2 points pass · evidence pictures/g2/evidence.png', by: 'Partner' }, ctx(fs))
  assert.deepEqual(passed.result, { id: 'G2', title: 'Benches that feel like home', ticked: true, attempts: 1 })
  goal = mapOf(fs).byId.get('G2')
  assert.deepEqual([goal.state, goal.recheckAsked, mapOf(fs).focus, goal.rechecks.length], ['done', null, null, 2])
  assert.match(utf8(fs.files[MAP]), /^ {4}Rechecked \(2026-10-19 09:00, Partner\): passed · 2 of 2 points pass · evidence pictures\/g2\/evidence\.png$/m)
  assert.equal((await goalChecked({ id: 'G2', verdict: 'passed', line: 'passed', by: 'Partner' }, ctx(fs))).status, 409)
})

test('the review: a tick after a failed re-check asks a new one; the person\'s tick without it is their second click, an overturn', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await focusMove({ command: 'goal-done', id: 'G1' }, ctx(fs))
  await goalChecked({ id: 'G1', verdict: 'failed', line: 'failed · 0 of 1 points pass · gap: few visitors', by: 'Partner' }, ctx(fs))
  const overturned = await focusMove({ command: 'goal-done', id: 'G1', overturn: true }, ctx(fs))
  assert.deepEqual([overturned.ok, overturned.words, overturned.result], [true, null, { id: 'G1', overturned: true }])
  const goal = mapOf(fs).byId.get('G1')
  assert.deepEqual([goal.state, goal.overturned], ['done', ['ticked by you after the re-check failed']])
  // Another goal: after a failed re-check a plain tick asks a new one; while it is open a tick asks again (once a
  // minute), and the second click ticks it before the re-check came.
  const other = fakeFs({ [MAP]: latin(GOALS) })
  await focusMove({ command: 'goal-done', id: 'G1' }, ctx(other))
  await goalChecked({ id: 'G1', verdict: 'failed', line: 'failed · 0 of 1 points pass · gap: few visitors', by: 'Partner' }, ctx(other))
  const anew = await focusMove({ command: 'goal-done', id: 'G1' }, ctx(other))
  assert.deepEqual([anew.result, anew.words.command], [{ id: 'G1', recheck: 'asked' }, 'goal-recheck'])
  const same = await focusMove({ command: 'goal-done', id: 'G1' }, ctx(other))
  assert.deepEqual([same.result, same.words], [{ id: 'G1', recheck: 'asked again', unchanged: true }, null])
  const later = await focusMove({ command: 'goal-done', id: 'G1' }, ctx(other, { now: NOW + 5 * 60_000 }))
  assert.deepEqual([later.result, later.words.command], [{ id: 'G1', recheck: 'asked again' }, 'goal-recheck'])
  await focusMove({ command: 'goal-done', id: 'G1', overturn: true }, ctx(other))
  const ticked = mapOf(other).byId.get('G1')
  assert.deepEqual([ticked.state, ticked.overturned, ticked.recheckAsked], ['done', ['ticked by you before its re-check came'], null])
})

test('the review: a re-check taken back is not filed; one that waits for the person stays asked', async () => {
  const { editGoals } = await import('../src/goalsWrite.mjs')
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await focusMove({ command: 'goal-done', id: 'G1' }, ctx(fs))
  await goalChecked({ id: 'G1', verdict: 'waits for you', line: 'waits for you · 0 of 1 points pass · for you: is it busy enough?', by: 'Partner' }, ctx(fs))
  assert.equal(mapOf(fs).byId.get('G1').recheckAsked, '2026-10-19 09:00')
  const back = await editGoals({ command: 'line', id: 'G1', name: 'Recheck asked', value: '' }, { canWrite: true, file: MAP, historyDir: 'D:/Work/p/history', now: NOW, fs })
  assert.equal(back.ok, true, back.why)
  assert.equal(mapOf(fs).byId.get('G1').recheckAsked, null)
  assert.equal((await editGoals({ command: 'line', id: 'G1', name: 'Recheck asked', value: 'now' }, { canWrite: true, file: MAP, historyDir: 'D:/Work/p/history', now: NOW, fs })).status, 400)
  const late = await goalChecked({ id: 'G1', verdict: 'passed', line: 'passed · 1 of 1 points pass', by: 'Partner' }, ctx(fs))
  assert.deepEqual([late.status, mapOf(fs).byId.get('G1').state], [409, 'now'])
})

const ROLES = { Keeper: 'main', Partner: 'advisor', Lamplighter: 'worker' }

test('the partner files the re-check with checked of a goal; a pass gives the person a recap note; a failed one names the attempt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'goal-recheck-'))
  try {
    await writeStore(dir, migrateBacklog('# Backlog\n\n## Lamps\n- [ ] B1 Trim the wicks\n', { now: NOW }), undefined, { now: NOW })
    const calls = []
    const goalChecked = async body => {
      calls.push(body)
      return { ok: true, result: { id: body.id, title: 'Lanterns', ticked: body.verdict === 'passed', attempts: body.verdict === 'failed' ? 1 : 0 } }
    }
    const as = (chat, extra = {}) => body => workApi({ chat, ...body }, { dir, now: NOW, prefix: '', roleOf: name => ROLES[name] ?? null, goalChecked, ...extra })
    const partner = as('Partner')
    const failed = await partner({ action: 'checked', id: 'G3', evidence: 'pictures/g3/evidence.png', points: ['pass: the main path is lit', 'fail: the gate path is dark'] })
    assert.equal(failed.ok, true, failed.why)
    assert.equal(calls[0].line, 'failed · 1 of 2 points pass · gap: the gate path is dark · evidence pictures/g3/evidence.png')
    assert.equal(failed.result.text, 'G3 stays open (attempt 1): make its follow-up steps from the gap, into its how.')
    const passed = await partner({ action: 'checked', id: 'G3', evidence: 'pictures/g3/evidence.png', points: ['pass: the main path is lit', 'pass: the gate path is lit'], score: '80 of 75' })
    assert.equal(passed.result.ticked, true)
    const note = [...(await readStore(dir)).items.values()].find(one => valueOf(one, 'Kind') === 'note')
    assert.deepEqual([valueOf(note, 'To'), valueOf(note, 'From')], ['you', 'Partner'])
    assert.deepEqual(note.sections.get('Text'), ['G3 Lanterns is done: a helper re-checked it against its Done when and its vibe, 2 of 2 points pass, score 80 of 75.', 'The evidence: pictures/g3/evidence.png'])
    // Only the partner files it, and only on a board that keeps a goal map.
    assert.equal((await as('Lamplighter')({ action: 'checked', id: 'G3', evidence: 'x.png', points: ['pass: lit'] })).status, 403)
    assert.equal((await as('Partner', { goalChecked: undefined })({ action: 'checked', id: 'G3', evidence: 'x.png', points: ['pass: lit'] })).status, 409)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the board routes a tick on the Goals part through the re-check while a partner is on it, and the work tool\'s goal check into the map', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /if \(body\?\.command === 'state' && body\?\.state === 'done' && \(\(await readState\(\)\)\.advisor \?\? null\) !== null\) return focusNow\(\{ command: 'goal-done', id: body\.id, overturn: body\.overturn === true \}\)/)
  assert.match(server, /goalChecked: async body => \{\n\s+const done = await goalChecked\(body, \{/)
})

test('the pages: the Goals part names the re-check and every outcome under a goal; the Focus run shows it in place of the question', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join: joinPath } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const vm = await import('node:vm')
  const script = await readFile(joinPath(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const cut = (from, to) => script.slice(script.indexOf(from), script.indexOf(to))
  const page = {}
  vm.runInNewContext(`${cut('// goals:start', '// goals:end')}\n${cut('// focus:start', '// focus:end')}\nthis.goalFrameLine = goalFrameLine; this.goalFrameLines = goalFrameLines; this.focusView = focusView`, page)
  const node = parseGoals([
    '- [ ] G1 Lanterns',
    '  Done when: every path is lit',
    '  Rechecked (2026-10-19 08:00, Partner): failed · 1 of 2 points pass · gap: the gate path is dark · evidence pictures/g1/e.png',
    '  Overturned (2026-10-19 08:40): ticked by you after the re-check failed',
    '',
  ].join('\n')).byId.get('G1')
  assert.equal(page.goalFrameLine(node), 'Done when: every path is lit · re-check failed (attempt 1): the gate path is dark')
  const lines = page.goalFrameLines({ nodes: [node] }, node)
  assert.ok(lines.includes('Re-checked 2026-10-19 08:00 by Partner: failed · 1 of 2 points pass · gap: the gate path is dark · evidence pictures/g1/e.png'))
  assert.ok(lines.includes('Overturned: ticked by you after the re-check failed'))
  assert.equal(page.goalFrameLine({ ...node, recheckAsked: '2026-10-19 09:00' }).endsWith('your partner re-checks it'), true)
  const focus = { id: 'G1', title: 'Lanterns', stage: 'run', doneWhen: 'every path is lit', vibe: [], vibePicture: null, vibeAgreed: 'x', parts: [{ title: 'Hang them', size: '1 h', state: 'done', owner: null, done: 1, total: 1 }], partnerDecides: [], youDecide: [], howAgreed: 'y', progress: { done: 1, total: 1, minutesLeft: null }, note: null, needs: [], recheckAsked: '2026-10-19 09:00', lastRecheck: null, attempts: 0 }
  const asked = JSON.parse(JSON.stringify(page.focusView(focus, null, { canWrite: true, whyNot: null })))
  assert.deepEqual([asked.vibeThere, asked.recheck.tone, asked.recheck.title], [null, 'asked', 'Your partner re-checks it'])
  const gap = JSON.parse(JSON.stringify(page.focusView({ ...focus, recheckAsked: null, lastRecheck: { verdict: 'failed', summary: '1 of 2 points pass', gap: 'the gate path is dark' }, attempts: 1 }, null, { canWrite: true, whyNot: null })))
  assert.deepEqual(gap.recheck, { tone: 'failed', title: 'The re-check found a gap (attempt 1)', text: '1 of 2 points pass; the gap: the gate path is dark. Your partner makes the steps that close it.' })
  assert.notEqual(gap.vibeThere, null)
  // The tick goes through goalTick: a second click while the re-check is open ticks it without (an overturn).
  assert.match(script, /if \(next === 'done'\) return goalTick\(id\)/)
  assert.match(script, /if \(isOpen && isConfirmed\('overturn', id\)\) \{\n\s+goalsUi\.confirm = null\n\s+return goalTickSaid\(await sendGoals\(\{ command: 'state', id, state: 'done', overturn: true \}\)\)/)
  assert.match(script, /if \(tool === 'recheck-back'\) return sendGoals\(\{ command: 'line', id: focus, name: 'Recheck asked', value: '' \}\)/)
})
