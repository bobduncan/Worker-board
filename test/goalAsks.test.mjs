// B258: an ask to the Advisor under a goal (spec 2026-10-15, section 4): the Ask line the board writes, the words it
// types into the Advisor's chat, the Read mark after the answer, and what the state gives the page. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseBacklog } from '../src/backlog.mjs'

import { goalAskNeeds, goalAskList, goalCounts, parseGoals } from '../src/goals.mjs'
import { addGoalAsk, editGoals, markAskRead } from '../src/goalsWrite.mjs'
import { checkSay, wakeFor } from '../src/say.mjs'
import { BACKLOG, GOALS } from './fixtures-goals.mjs'

const ANSWERED = GOALS.replace('      Ask (A1, 2026-10-15 18:40): what differs most from the picture?\n', [
  '      Ask (A1, 2026-10-15 18:40): what differs most from the picture?',
  '      Answer (2026-10-15 19:20, Advisor): the shading: three tones there, one here.',
  '      More: .claude/goal-asks/2026-10-15-benches.md',
  '',
].join('\n'))

test('an ask is written under the goal with its id and time, and marked read after its answer', () => {
  const asked = addGoalAsk(GOALS, 'G4', { askId: 'A2', at: '2026-10-15 20:00', question: 'which fountain first?' })
  assert.ok(asked.text.includes('      Missing: a second fountain by the gate\n      Ask (A2, 2026-10-15 20:00): which fountain first?\n'))
  assert.equal(markAskRead(asked.text, 'G4', 'A2', '2026-10-15 20:30').why, 'none')
  const answered = asked.text.replace('      Ask (A2, 2026-10-15 20:00): which fountain first?\n', '      Ask (A2, 2026-10-15 20:00): which fountain first?\n      Answer (2026-10-15 20:20, Advisor): the one by the gate.\n')
  const read = markAskRead(answered, 'G4', 'A2', '2026-10-15 20:30')
  assert.ok(read.text.includes('      Answer (2026-10-15 20:20, Advisor): the one by the gate.\n      Read: 2026-10-15 20:30\n'))
  assert.equal(parseGoals(read.text).byId.get('G4').asks[0].readAt, '2026-10-15 20:30')
})

test('the Read mark goes after the answer\'s More line, once; an ask that is not under the goal is refused', () => {
  const read = markAskRead(ANSWERED, 'G6', 'A1', '2026-10-15 19:40')
  assert.ok(read.text.includes('      More: .claude/goal-asks/2026-10-15-benches.md\n      Read: 2026-10-15 19:40\n'))
  assert.equal(parseGoals(read.text).byId.get('G6').asks[0].readAt, '2026-10-15 19:40')
  // Read already: the file stays as it is.
  assert.equal(markAskRead(read.text, 'G6', 'A1', '2026-10-15 19:50').text, read.text)
  assert.equal(markAskRead(ANSWERED, 'G4', 'A1', '2026-10-15 19:40').why, 'none')
  assert.equal(markAskRead(ANSWERED, 'G99', 'A1', '2026-10-15 19:40').why, 'gone')
  // A second ask under the same goal comes after the first one's answer, and its own Read mark after its own lines.
  const second = addGoalAsk(ANSWERED, 'G6', { askId: 'A2', at: '2026-10-15 20:00', question: 'and the colours?' })
  assert.ok(second.text.includes('      More: .claude/goal-asks/2026-10-15-benches.md\n      Ask (A2, 2026-10-15 20:00): and the colours?\n'))
  assert.deepEqual(parseGoals(second.text).byId.get('G6').asks.map(ask => [ask.id, ask.answer === null]), [['A1', false], ['A2', true]])
  // The question is one line, as every line of the map.
  assert.ok(addGoalAsk(GOALS, 'G4', { askId: 'A2', at: '2026-10-15 20:00', question: 'which\nfountain  first?' }).text.includes('Ask (A2, 2026-10-15 20:00): which fountain first?\n'))
  assert.equal(addGoalAsk(GOALS, 'G4', { askId: 'A2', at: '2026-10-15 20:00', question: '  ' }).why, 'form')
})

test('the words for an ask go to the Advisor only, with the goal, the ask and the pictures', () => {
  const state = { chats: [{ name: 'Main', isMain: true }], advisor: { name: 'Oracle' }, restart: { main: 'Main' }, pictures: 'pictures',
    goals: { roots: ['G6'], problems: [], nodes: [{ id: 'G6', title: 'Benches that match the picture', asks: [] }] } }
  const ok = checkSay({ to: 'Oracle', command: 'goal-ask', goal: 'G6', ask: 'A2', text: 'what differs most?', pictures: [] }, state, 2000)
  assert.equal(ok.ok, true)
  assert.equal(ok.message.text, 'ask from the goal map\nGoal: G6 Benches that match the picture\nAsk (A2): what differs most?')
  assert.equal(checkSay({ to: 'Main', command: 'goal-ask', goal: 'G6', ask: 'A2', text: 'x' }, state, 2000).status, 400)
  assert.equal(checkSay({ to: 'Oracle', command: 'goal-ask', goal: 'G99', ask: 'A2', text: 'x' }, state, 2000).status, 409)
  assert.equal(checkSay({ to: 'Oracle', command: 'goal-ask', goal: 'G6', ask: 'x', text: 'x' }, state, 2000).status, 400)
  assert.equal(checkSay({ to: 'Oracle', command: 'goal-ask', goal: 'G6', ask: 'A2', text: '  ' }, state, 2000).status, 400)
  // Pictures the board kept, by their paths; anything else is left out.
  const pictured = checkSay({ to: 'Oracle', command: 'goal-ask', goal: 'G6', ask: 'A2', text: 'this one?', pictures: ['pictures/talk/2026-10-15-2000.png', '../secret.png', 'pictures/talk/2026-10-15-2000-2.webp'] }, state, 2000)
  assert.equal(pictured.message.text, 'ask from the goal map\nGoal: G6 Benches that match the picture\nAsk (A2): this one?\nPictures: pictures/talk/2026-10-15-2000.png, pictures/talk/2026-10-15-2000-2.webp')
  assert.deepEqual(pictured.message.pictures, ['pictures/talk/2026-10-15-2000.png', 'pictures/talk/2026-10-15-2000-2.webp'])
  // The person's words stay one line, also when typed over several.
  assert.equal(checkSay({ to: 'Oracle', command: 'goal-ask', goal: 'G6', ask: 'A2', text: 'one\ntwo' }, state, 2000).message.text.split('\n')[2], 'Ask (A2): one two')
})

test('an ask to an Advisor whose chat is not running asks the main chat to start it', () => {
  const state = { chats: [{ name: 'Main', isMain: true, isRunning: true }], advisor: { name: 'Oracle', isRunning: false }, restart: { main: 'Main' } }
  const wake = wakeFor({ to: 'Oracle', command: 'goal-ask' }, state, [], 1_000_000, 2000)
  assert.equal(wake.command, 'start')
  assert.equal(wake.about, 'Oracle')
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
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const at = (fs, extra = {}) => ({ canWrite: true, file: 'C:/p/asks.md', historyDir: 'C:/p/history', now: new Date(2026, 9, 15, 20, 5).getTime(), fs, ...extra })

test('the handler writes an ask with the next id and the time, and marks an answered one read; neither is undone', async () => {
  const fs = fakeFs({ 'C:/p/asks.md': latin(ANSWERED) })
  const asked = await editGoals({ command: 'ask', id: 'G4', text: 'which fountain first?', page: 'askpage1' }, at(fs))
  assert.deepEqual(asked, { ok: true, result: { id: 'A2' } })
  assert.ok(fs.files['C:/p/asks.md'].includes('      Ask (A2, 2026-10-15 20:05): which fountain first?\n'))
  // The id is kept from coming back, as a goal's is.
  assert.ok(fs.files['C:/p/asks.md'].includes('Last ask: A2'))
  assert.equal((await editGoals({ command: 'ask', id: 'G4', text: 'and then?' }, at(fs))).result.id, 'A3')
  assert.equal((await editGoals({ command: 'ask', id: 'G4', text: ' ' }, at(fs))).status, 400)
  assert.equal((await editGoals({ command: 'ask', id: 'G99', text: 'x' }, at(fs))).status, 404)
  // Unanswered: nothing to mark.
  const early = await editGoals({ command: 'read', id: 'G4', ask: 'A2' }, at(fs))
  assert.deepEqual([early.ok, early.status], [false, 409])
  const read = await editGoals({ command: 'read', id: 'G6', ask: 'A1', page: 'askpage1' }, at(fs))
  assert.equal(read.ok, true)
  assert.ok(fs.files['C:/p/asks.md'].includes('      More: .claude/goal-asks/2026-10-15-benches.md\n      Read: 2026-10-15 20:05\n'))
  assert.equal((await editGoals({ command: 'read', id: 'G6', ask: 'nope' }, at(fs))).status, 400)
  // An ask was typed into the Advisor's chat, and a read answer is read: the page's undo leaves both alone.
  assert.equal((await editGoals({ command: 'undo', page: 'askpage1' }, at(fs))).status, 409)
  // A goal of the game plan takes asks too.
  assert.equal((await editGoals({ command: 'ask', id: 'G2', text: 'is M1 near?' }, at(fs))).ok, true)
})

test('the state lists every ask under its goal, and an answered one not yet read as a need of the person', () => {
  const goals = parseGoals(ANSWERED)
  assert.deepEqual(goalAskList(goals).map(one => [one.goal, one.goalTitle, one.ask.id, one.ask.answer?.by ?? null]), [['G6', 'Benches that match the picture', 'A1', 'Advisor']])
  assert.deepEqual(goalAskNeeds(goals), [{ kind: 'goal-ask', id: 'A1', goal: 'G6', goalTitle: 'Benches that match the picture', title: 'The Advisor answered your ask on G6 Benches that match the picture', question: 'what differs most from the picture?', at: '2026-10-15 19:20', approval: 'read' }])
  // Pending, or read: nothing for the person.
  assert.deepEqual(goalAskNeeds(parseGoals(GOALS)), [])
  assert.deepEqual(goalAskNeeds(parseGoals(markAskRead(ANSWERED, 'G6', 'A1', '2026-10-15 19:40').text)), [])
})

// The page's parts, run here without the page.
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// goals:start'), script.indexOf('// goals:end'))}
Object.assign(this, { goalAskBlocks, goalAskPictures, goalFrameLine, goalOutlineRows, goalStepWords, goalTreeDrop, goalTreeLayout })`, made)
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const page = Object.fromEntries(Object.entries(made).map(([name, made]) => [name, (...args) => plain(made(...args))]))
const stateGoals = text => {
  const goals = parseGoals(text)
  const counts = goalCounts(goals, parseBacklog(BACKLOG))
  return { roots: goals.roots, problems: goals.problems, nodes: goals.nodes.map(one => ({ ...one, counts: counts.get(one.id) ?? null })) }
}
const WITH_PICTURE = ANSWERED.replace('the shading: three tones there, one here.', 'the shading: three tones there, one here (pictures/benches/side-by-side.png).')

test('the frame shows each ask as a block: pending, answered with its pictures, read only with the lines open', () => {
  const g6 = goals => goals.nodes.find(one => one.id === 'G6')
  assert.deepEqual(page.goalAskBlocks(g6(stateGoals(GOALS)), false), [{ id: 'A1', at: '2026-10-15 18:40', question: 'what differs most from the picture?', state: 'pending', answer: null, pictures: [] }])
  const answered = page.goalAskBlocks(g6(stateGoals(WITH_PICTURE)), false)[0]
  assert.equal(answered.state, 'answered')
  assert.equal(answered.answer.more, '.claude/goal-asks/2026-10-15-benches.md')
  assert.deepEqual(answered.pictures, ['pictures/benches/side-by-side.png'])
  assert.equal(page.goalFrameLine(g6(stateGoals(WITH_PICTURE))), '1 answer to read')
  const read = stateGoals(markAskRead(ANSWERED, 'G6', 'A1', '2026-10-15 19:40').text)
  assert.deepEqual(page.goalAskBlocks(g6(read), false), [])
  assert.equal(page.goalAskBlocks(g6(read), true)[0].state, 'read')
  assert.deepEqual(page.goalAskPictures({ text: 'see ./art/a.webp and art/b.JPG, and art/a.webp again', more: 'art/c.png' }), ['art/a.webp', 'art/b.JPG', 'art/c.png'])
})

test('the outline tags a goal with its pending asks and an answer to read; a step from an answer names the goal and the ask', () => {
  const tags = text => page.goalOutlineRows(stateGoals(text), 'G5', new Set()).find(row => row.id === 'G6').tags
  assert.deepEqual(tags(GOALS), ['1 ask pending'])
  assert.deepEqual(tags(ANSWERED), ['answer to read'])
  assert.deepEqual(tags(markAskRead(ANSWERED, 'G6', 'A1', '2026-10-15 19:40').text), [])
  const goals = stateGoals(ANSWERED)
  const node = goals.nodes.find(one => one.id === 'G6')
  assert.equal(page.goalStepWords(node, page.goalAskBlocks(node, true)[0]),
    'Make a backlog step from the goal map, for G6 Benches that match the picture, from my ask A1: what differs most from the picture? The Advisor\'s answer: the shading: three tones there, one here. (more in .claude/goal-asks/2026-10-15-benches.md)')
})

test('in the tree an ask stands as a violet box after the goals inside, and nothing can be dropped on it', () => {
  const asked = addGoalAsk(GOALS, 'G5', { askId: 'A2', at: '2026-10-15 20:00', question: 'when does it open?' }).text
  const out = page.goalTreeLayout(stateGoals(asked), 'G5', 540)
  assert.deepEqual(out.boxes.map(box => [box.id, box.kind]), [['G6', 'child'], ['G9', 'ref'], ['A2', 'ask']])
  const box = out.boxes[2]
  assert.equal(page.goalTreeDrop(stateGoals(asked), out, 'G3', box.x + box.w / 2, box.y + box.h / 2).target, null)
  // Read, it stands in the frame's lines only.
  const read = page.goalTreeLayout(stateGoals(markAskRead(ANSWERED, 'G6', 'A1', '2026-10-15 19:40').text), 'G6', 540)
  assert.deepEqual(read.boxes, [])
  assert.deepEqual(page.goalTreeLayout(stateGoals(ANSWERED), 'G6', 540).boxes.map(one => one.kind), ['ask'])
})

test('the page has the box to ask in under the frame: words, pictures, Send; and the part for answers to read', () => {
  assert.ok(html.indexOf('id="goals-frame"') < html.indexOf('id="goals-ask"'))
  for (const id of ['goals-ask-head', 'goals-ask-text', 'goals-ask-pictures', 'goals-ask-pick', 'goals-ask-file', 'goals-ask-note', 'goals-ask-cancel', 'goals-ask-send']) assert.ok(html.includes(`id="${id}"`), id)
  assert.match(html, /id="goals-ask-text" maxlength="2000"/)
  // The words go to the Advisor with the id the map gave the ask; Done marks it read.
  assert.match(script, /send\(\{ to: advisor, command: 'goal-ask', goal, ask: written\.id, text, pictures \}/)
  assert.match(script, /sendGoals\(\{ command: 'read', id: goal, ask: askId \}\)/)
  assert.match(script, /'Answers to your asks'/)
})
