// B256: every change to goals.md as text → text, by id, every other line untouched (spec 2026-10-15, sections 1 and
// 3); the handler that writes the file anew, with a daily copy and undo. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseGoals } from '../src/goals.mjs'
import { addGoal, addGoalLink, addGoalNote, deleteGoal, dissolveGoal, editGoals, groupGoals, historyCopy, moveGoal, removeGoalLink, renameGoal, setGoalLine, setGoalState, setGoalSteps } from '../src/goalsWrite.mjs'
import { GOALS } from './fixtures-goals.mjs'

const lines = text => text.split('\n')
/** The lines that differ between two texts of the same length. */
const changed = (before, after) => lines(after).filter((line, index) => line !== lines(before)[index])

test('a goal is added as the last child of its parent, one level deeper; after a sibling; or at the end', () => {
  const done = addGoal(GOALS, { parent: 'G5', after: null, title: 'Lanterns at dusk', id: 'G10' })
  assert.equal(done.ok, true)
  const at = lines(done.text).indexOf('    - [ ] G10 Lanterns at dusk')
  assert.ok(at > 0)
  assert.equal(lines(done.text)[at - 1], '      Ask (A1, 2026-10-15 18:40): what differs most from the picture?')
  assert.deepEqual(parseGoals(done.text).byId.get('G5').children, ['G6', 'G10'])
  assert.equal(addGoal(GOALS, { parent: 'G99', after: null, title: 'x', id: 'G10' }).why, 'gone')
  assert.equal(addGoal(GOALS, { parent: 'G5', after: null, title: 'x', id: 'G6' }).why, 'twice')
  const after = addGoal(GOALS, { parent: null, after: 'G3', title: 'Gravel', id: 'G10' })
  assert.deepEqual(parseGoals(after.text).byId.get('G2').children, ['G3', 'G10', 'G4'])
  const top = addGoal(GOALS, { parent: null, after: null, title: 'A pond', id: 'G10' })
  assert.deepEqual(parseGoals(top.text).roots, ['G1', 'G7', 'G10'])
  assert.ok(top.text.endsWith('- [ ] G10 A pond\n'))
})

test('rename and state change touch one line', () => {
  const renamed = renameGoal(GOALS, 'G4', 'Let both fountains sing')
  assert.deepEqual(changed(GOALS, renamed.text), ['    - [~] G4 Let both fountains sing'])
  assert.equal(parseGoals(setGoalState(GOALS, 'G5', 'now').text).byId.get('G5').state, 'now')
  assert.deepEqual(changed(GOALS, setGoalState(GOALS, 'G3', 'open').text), ['    - [ ] G3 Lay the first path'])
  assert.equal(setGoalState(GOALS, 'G5', 'later').why, 'form')
  assert.equal(renameGoal(GOALS, 'G4', '  ').why, 'form')
})

test('a named line is replaced, added first under the goal, or removed when empty', () => {
  const set = setGoalLine(GOALS, 'G5', 'Done when', 'the gate is open on Sundays')
  assert.equal(lines(set.text)[lines(set.text).indexOf('  - [ ] G5 M2 · The garden is open') + 1], '    Done when: the gate is open on Sundays')
  const changedLine = setGoalLine(GOALS, 'G1', 'Done when', 'anyone finds the fountain')
  assert.equal(parseGoals(changedLine.text).byId.get('G1').doneWhen, 'anyone finds the fountain')
  assert.deepEqual(changed(GOALS, changedLine.text), ['  Done when: anyone finds the fountain'])
  assert.equal(parseGoals(setGoalLine(GOALS, 'G1', 'Done when', '').text).byId.get('G1').doneWhen, null)
  // A note goes after the goal's own lines, before its children.
  const noted = addGoalNote(GOALS, 'G2', 'the signposts are wood')
  assert.deepEqual(parseGoals(noted.text).byId.get('G2').notes, ['Note: the signposts are wood'])
  assert.equal(lines(noted.text)[lines(noted.text).indexOf('    Note: the signposts are wood') + 1], '    - [x] G3 Lay the first path')
  // The steps line keeps backlog ids only.
  assert.deepEqual(parseGoals(setGoalSteps(GOALS, 'G6', ['B05', 'x', 'B08']).text).byId.get('G6').steps, ['B05', 'B08'])
})

test('links are added to one line and removed with it; a goal links to no part of its own home or itself', () => {
  const linked = addGoalLink(GOALS, 'G6', 'Enables', 'G7')
  assert.deepEqual(parseGoals(linked.text).byId.get('G6').enables, ['G7'])
  const twice = addGoalLink(linked.text, 'G6', 'Enables', 'G2')
  assert.ok(twice.text.includes('      Enables: G7, G2'))
  const removed = removeGoalLink(twice.text, 'G6', 'Enables', 'G7')
  assert.ok(removed.text.includes('      Enables: G2'))
  assert.equal(removeGoalLink(removed.text, 'G6', 'Enables', 'G2').text, GOALS)
  assert.equal(addGoalLink(GOALS, 'G6', 'Enables', 'G6').why, 'target')
  assert.equal(addGoalLink(GOALS, 'G6', 'Enables', 'G99').why, 'target')
  assert.equal(addGoalLink(GOALS, 'G6', 'Also part of', 'G5').why, 'target')
  assert.equal(addGoalLink(GOALS, 'G2', 'Also part of', 'G4').why, 'target')
  assert.deepEqual(parseGoals(addGoalLink(GOALS, 'G6', 'Also part of', 'G2').text).byId.get('G6').alsoPartOf, ['G2'])
})

test('a move takes the whole block, re-indents it and refuses a cycle (Review Focus 3)', () => {
  const moved = moveGoal(GOALS, 'G4', { parent: 'G5', index: 0 })
  const goals = parseGoals(moved.text)
  assert.deepEqual(goals.byId.get('G5').children, ['G4', 'G6'])
  assert.deepEqual(goals.byId.get('G2').children, ['G3'])
  assert.ok(moved.text.includes('    - [~] G4 Let the fountains sing\n      Steps: B03, B04\n      Missing: a second fountain by the gate\n'))
  assert.equal(moveGoal(GOALS, 'G1', { parent: 'G2', index: 0 }).why, 'cycle')
  assert.equal(moveGoal(GOALS, 'G1', { parent: 'G1', index: 0 }).why, 'cycle')
  const top = moveGoal(GOALS, 'G6', { parent: null, index: 2 })
  assert.deepEqual(parseGoals(top.text).roots, ['G1', 'G7', 'G6'])
  assert.ok(top.text.includes('\n- [ ] G6 Benches that match the picture\n  Steps: B04, B05\n'))
  // Among its own siblings, by place: G4 before G3.
  assert.deepEqual(parseGoals(moveGoal(GOALS, 'G4', { parent: 'G2', index: 0 }).text).byId.get('G2').children, ['G4', 'G3'])
  assert.equal(moveGoal(GOALS, 'G4', { parent: 'G99', index: 0 }).why, 'gone')
})

test('group puts the chosen nodes under a new one where the first stood; dissolve lifts the children and drops the references', () => {
  const grouped = groupGoals(GOALS, ['G3', 'G4'], { title: 'The first season', id: 'G10' })
  const goals = parseGoals(grouped.text)
  assert.deepEqual(goals.byId.get('G2').children, ['G10'])
  assert.deepEqual(goals.byId.get('G10').children, ['G3', 'G4'])
  assert.deepEqual(goals.problems, [])
  const dissolved = dissolveGoal(grouped.text, 'G10')
  assert.deepEqual(parseGoals(dissolved.text).byId.get('G2').children, ['G3', 'G4'])
  const noRef = dissolveGoal(GOALS, 'G5')
  assert.deepEqual(parseGoals(noRef.text).byId.get('G9').alsoPartOf, [])
  assert.deepEqual(parseGoals(noRef.text).byId.get('G1').children, ['G2', 'G6'])
  assert.deepEqual(parseGoals(noRef.text).problems, [])
  // Top-level goals group at the top level.
  assert.deepEqual(parseGoals(groupGoals(GOALS, ['G7'], { title: 'Tools', id: 'G10' }).text).roots, ['G1', 'G10'])
})

test('dissolve drops the goal\'s own lines wherever they stand, also after its children', () => {
  const text = '- [ ] G1 Top\n  - [ ] G2 Middle\n    Done when: never\n    - [ ] G3 Low\n      Steps: B01\n    Steps: B02\n'
  const done = dissolveGoal(text, 'G2')
  assert.equal(done.text, '- [ ] G1 Top\n  - [ ] G3 Low\n    Steps: B01\n')
})

test('delete removes a childless node and the references to it; a parent is refused', () => {
  const gone = deleteGoal(GOALS, 'G8')
  assert.equal(parseGoals(gone.text).byId.has('G8'), false)
  assert.equal(deleteGoal(GOALS, 'G2').why, 'children')
  const lone = deleteGoal(GOALS, 'G9')
  assert.equal(lone.text.includes('G9'), false)
  const referred = deleteGoal(addGoalLink(GOALS, 'G6', 'Enables', 'G8').text, 'G8')
  assert.deepEqual(parseGoals(referred.text).byId.get('G6').enables, [])
})

test('Windows line ends and a byte-order mark stay as they were', () => {
  const crlf = GOALS.replace(/\n/g, '\r\n')
  const done = renameGoal(crlf, 'G3', 'Lay the path')
  assert.ok(!/[^\r]\n/.test(done.text))
  assert.ok(done.text.includes('G3 Lay the path\r\n'))
  const bom = renameGoal('\uFEFF- [ ] G1 First\n', 'G1', 'One')
  assert.equal(bom.text, '\uFEFF- [ ] G1 One\n')
})

/** A fake file system over one map of path → text. */
function fakeFs(files) {
  return {
    files,
    readFile: async path => { if (!(path in files)) throw new Error('gone'); return Buffer.from(files[path], 'latin1') },
    writeFile: async (path, bytes) => { files[path] = Buffer.from(bytes).toString('latin1') },
    rename: async (from, to) => { files[to] = files[from]; delete files[from] },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
  }
}
const at = (fs, extra = {}) => ({ canWrite: true, file: 'C:/p/goals.md', historyDir: 'C:/p/history', now: new Date(2026, 9, 15, 10).getTime(), fs, ...extra })
const latin = text => Buffer.from(text, 'utf8').toString('latin1')

test('the handler applies one change by rereading the file, and refuses where it may not write', async () => {
  const fs = fakeFs({ 'C:/p/goals.md': latin(GOALS) })
  const ok = await editGoals({ command: 'rename', id: 'G3', title: 'Lay the path' }, at(fs))
  assert.equal(ok.ok, true)
  assert.ok(fs.files['C:/p/goals.md'].includes('- [x] G3 Lay the path'))
  assert.equal(fs.files['C:/p/history/2026-10-15.md'], latin(GOALS), 'the copy before the first change of the day')
  // Words beyond plain letters go in as the file's UTF-8, and the rest of the file keeps its own.
  await editGoals({ command: 'rename', id: 'G3', title: 'Läy the path · twice' }, at(fs))
  assert.ok(Buffer.from(fs.files['C:/p/goals.md'], 'latin1').toString('utf8').includes('- [x] G3 Läy the path · twice\n'))
  assert.ok(Buffer.from(fs.files['C:/p/goals.md'], 'latin1').toString('utf8').includes('G2 M1 · The paths are fun'))
  const demo = await editGoals({ command: 'rename', id: 'G3', title: 'x' }, at(fs, { canWrite: false }))
  assert.deepEqual([demo.ok, demo.status], [false, 403])
  const gone = await editGoals({ command: 'rename', id: 'G99', title: 'x' }, at(fs))
  assert.deepEqual([gone.ok, gone.status], [false, 404])
  assert.equal((await editGoals({ command: 'fly' }, at(fs))).status, 400)
  assert.equal((await editGoals(null, at(fs))).status, 400)
  assert.equal((await editGoals({ command: 'line', id: 'G3', name: 'Steps', value: 'B01' }, at(fs))).status, 400)
})

test('add and group give the new id back, and the file is reread right before the change (Review Focus 2)', async () => {
  const fs = fakeFs({ 'C:/p/goals.md': latin(GOALS) })
  const added = await editGoals({ command: 'add', parent: 'G5', title: 'Lanterns' }, at(fs))
  assert.equal(added.result.id, 'G10')
  // Somebody else writes in between: the change lands on their text.
  fs.files['C:/p/goals.md'] = fs.files['C:/p/goals.md'].replace('- [ ] G5 M2', '- [~] G5 M2')
  const renamed = await editGoals({ command: 'rename', id: 'G10', title: 'Lanterns at dusk' }, at(fs))
  assert.equal(renamed.ok, true)
  assert.ok(fs.files['C:/p/goals.md'].includes('- [~] G5 M2'))
  assert.ok(fs.files['C:/p/goals.md'].includes('G10 Lanterns at dusk'))
  const grouped = await editGoals({ command: 'group', ids: ['G3', 'G4'], title: 'Season' }, at(fs))
  assert.equal(grouped.result.id, 'G11')
  assert.equal((await editGoals({ command: 'group', ids: [], title: 'x' }, at(fs))).status, 400)
})

test('undo puts the previous text back only while the file still reads as the change left it', async () => {
  const fs = fakeFs({ 'C:/p/undo.md': latin(GOALS) })
  const options = at(fs, { file: 'C:/p/undo.md' })
  await editGoals({ command: 'rename', id: 'G3', title: 'One' }, options)
  await editGoals({ command: 'rename', id: 'G3', title: 'Two' }, options)
  assert.equal((await editGoals({ command: 'undo' }, options)).ok, true)
  assert.ok(fs.files['C:/p/undo.md'].includes('G3 One'))
  fs.files['C:/p/undo.md'] = fs.files['C:/p/undo.md'].replace('G3 One', 'G3 Other hand')
  assert.equal((await editGoals({ command: 'undo' }, options)).status, 409)
  assert.equal((await editGoals({ command: 'undo' }, at(fs, { file: 'C:/p/never.md' }))).status, 409)
})

test('the daily copy is made once a day, and a missing file makes none', async () => {
  const fs = fakeFs({ 'C:/p/goals.md': GOALS })
  await historyCopy('C:/p/goals.md', 'C:/p/h', '2026-10-15', fs)
  fs.files['C:/p/goals.md'] = 'changed'
  await historyCopy('C:/p/goals.md', 'C:/p/h', '2026-10-15', fs)
  assert.equal(fs.files['C:/p/h/2026-10-15.md'], GOALS)
  await historyCopy('C:/p/none.md', 'C:/p/h', '2026-10-16', fs)
  assert.equal('C:/p/h/2026-10-16.md' in fs.files, false)
})

test('the board takes a change to the goal map from its own page only: the token, its origin and JSON', async t => {
  const { createBoard } = await import('../server.mjs')
  const TOKEN = 'a'.repeat(64)
  const asked = []
  const server = createBoard({
    token: TOKEN,
    getState: async () => ({}),
    say: async () => ({ ok: false, status: 400, why: 'No.' }),
    goals: async body => { asked.push(body); return { ok: true, result: { id: 'G10' } } },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const good = { 'X-Board-Token': TOKEN, Origin: origin, 'Content-Type': 'application/json' }
  const post = headers => fetch(`${origin}/api/goals`, { method: 'POST', headers, body: JSON.stringify({ command: 'add', parent: null, title: 'A pond' }) })
  assert.equal((await post({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await post({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal((await post({ ...good, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal(asked.length, 0)
  const answer = await post(good)
  assert.equal(answer.status, 200)
  assert.deepEqual(await answer.json(), { id: 'G10' })
  assert.deepEqual(asked, [{ command: 'add', parent: null, title: 'A pond' }])
})

// B256, the independent review's findings.

test('review: a delete or dissolve changes only the link lines that name the goal, and keeps their other words', () => {
  const text = GOALS.replace("  Enables: G1\n", "  Enables: G1 because the tools come first\n").replace('    Also part of: G5\n', '    Also part of: G5\n    Enables: nothing yet\n')
  const gone = deleteGoal(text, 'G8')
  assert.equal(gone.text, text.replace('  - [x] G8 A sharper spade\n    Steps: B06\n', ''))
  const dissolved = dissolveGoal(text, 'G5')
  assert.ok(dissolved.text.includes('    Enables: nothing yet\n'))
  assert.ok(dissolved.text.includes('  Enables: G1 because the tools come first\n'))
  assert.equal(parseGoals(dissolved.text).byId.get('G9').alsoPartOf.length, 0)
  const unlinked = removeGoalLink(text, 'G7', 'Enables', 'G1')
  assert.ok(unlinked.text.includes('  Enables: because the tools come first\n'))
  assert.ok(addGoalLink(text, 'G7', 'Enables', 'G2').text.includes('  Enables: G1 because the tools come first, G2\n'))
})

test('review: a state is one of the three, never a word the object knows', () => {
  for (const state of ['constructor', 'toString', '__proto__']) assert.equal(setGoalState(GOALS, 'G5', state).why, 'form')
})

test('review: grouping a goal with one inside it keeps the inner one where it is', () => {
  const grouped = groupGoals(GOALS, ['G2', 'G3'], { title: 'Season', id: 'G10' })
  const goals = parseGoals(grouped.text)
  assert.deepEqual(goals.byId.get('G10').children, ['G2'])
  assert.deepEqual(goals.byId.get('G2').children, ['G3', 'G4'])
  assert.deepEqual(parseGoals(groupGoals(GOALS, ['G3', 'G2'], { title: 'Season', id: 'G10' }).text).byId.get('G10').children, ['G2'])
})

test('review: the handler refuses a file that is not UTF-8 or indented with tabs, and the plan\'s own lines', async () => {
  const bytes = Buffer.concat([Buffer.from(GOALS.replace('Benches', 'Bench'), 'utf8'), Buffer.from([0x0a, 0xe9, 0x0a])]).toString('latin1')
  const fs = fakeFs({ 'C:/p/goals.md': bytes })
  const odd = await editGoals({ command: 'rename', id: 'G3', title: 'x' }, at(fs))
  assert.deepEqual([odd.ok, odd.status], [false, 409])
  assert.equal(fs.files['C:/p/goals.md'], bytes)
  const tabs = fakeFs({ 'C:/p/goals.md': latin(GOALS.replace('    - [ ] G6', '\t\t- [ ] G6')) })
  assert.equal((await editGoals({ command: 'rename', id: 'G3', title: 'x' }, at(tabs))).status, 409)
  const plan = fakeFs({ 'C:/p/goals.md': latin(GOALS) })
  for (const body of [{ command: 'rename', id: 'G2', title: 'x' }, { command: 'delete', id: 'G5' }, { command: 'dissolve', id: 'G2' }, { command: 'line', id: 'G2', name: 'Done when', value: 'x' }]) {
    assert.equal((await editGoals(body, at(plan))).status, 409, body.command)
  }
  assert.equal(plan.files['C:/p/goals.md'], latin(GOALS))
  assert.equal((await editGoals({ command: 'line', id: 'G2', name: 'Why', value: 'the plan says so' }, at(plan))).ok, true)
})

test('review: a change that changes nothing is no change: the file stays, and undo goes to the change before', async () => {
  const fs = fakeFs({ 'C:/p/same.md': latin(GOALS) })
  const options = at(fs, { file: 'C:/p/same.md' })
  await editGoals({ command: 'rename', id: 'G3', title: 'One', page: 'pagea1' }, options)
  const same = await editGoals({ command: 'rename', id: 'G3', title: 'One', page: 'pagea1' }, options)
  assert.deepEqual([same.ok, same.result], [true, { unchanged: true }])
  assert.equal((await editGoals({ command: 'undo', page: 'pagea1' }, options)).ok, true)
  assert.equal(fs.files['C:/p/same.md'], latin(GOALS))
})

test('review: undo is the page\'s own: another page\'s changes are not undone from here', async () => {
  const fs = fakeFs({ 'C:/p/pages.md': latin(GOALS) })
  const options = at(fs, { file: 'C:/p/pages.md' })
  await editGoals({ command: 'rename', id: 'G3', title: 'Mine', page: 'pagea1' }, options)
  await editGoals({ command: 'rename', id: 'G4', title: 'Theirs', page: 'pageb2' }, options)
  assert.equal((await editGoals({ command: 'undo', page: 'pagea1' }, options)).status, 409, 'the other page changed the file since')
  assert.equal((await editGoals({ command: 'undo', page: 'pageb2' }, options)).ok, true)
  assert.equal((await editGoals({ command: 'undo', page: 'pagea1' }, options)).ok, true)
  assert.equal(fs.files['C:/p/pages.md'], latin(GOALS))
  assert.equal((await editGoals({ command: 'undo', page: 'pagec3' }, options)).status, 409)
})

test('B257: every new goal raises the head line, so a deleted goal\'s id never comes back', async () => {
  const fs = fakeFs({ 'C:/p/ids.md': latin(GOALS) })
  const options = at(fs, { file: 'C:/p/ids.md' })
  assert.deepEqual((await editGoals({ command: 'add', parent: 'G5', title: 'Lanterns' }, options)).result, { id: 'G10' })
  assert.ok(fs.files['C:/p/ids.md'].startsWith('# Goals\nLast id: G10\n\n- [~] G1 Zebracorn Garden'))
  await editGoals({ command: 'delete', id: 'G10' }, options)
  assert.deepEqual((await editGoals({ command: 'add', parent: null, title: 'A pond' }, options)).result, { id: 'G11' })
  assert.deepEqual((await editGoals({ command: 'group', ids: ['G3'], title: 'Paths' }, options)).result, { id: 'G12' })
  assert.equal(fs.files['C:/p/ids.md'].split('\n').filter(line => line.startsWith('Last id:')).join(), 'Last id: G12')
  // A file without a heading gets the line on top.
  const bare = fakeFs({ 'C:/p/bare.md': latin('- [ ] G1 One\n') })
  await editGoals({ command: 'add', parent: null, title: 'Two' }, at(bare, { file: 'C:/p/bare.md' }))
  assert.equal(bare.files['C:/p/bare.md'], 'Last id: G2\n- [ ] G1 One\n- [ ] G2 Two\n')
})
