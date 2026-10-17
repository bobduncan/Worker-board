// B233: the person refines a backlog step with the Advisor: the board asks the Advisor ("refine step"), the Advisor
// writes the step's refine block (problem, goal, questions), and the person's answers, feedback and "accepted" are
// written into that block by the board. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { overview, parseBacklog, refinedOf, withoutRefined } from '../src/backlog.mjs'
import { checkSay, wakeFor } from '../src/say.mjs'
import { acceptRefine, answerRefine, editStep } from '../src/tick.mjs'

const BACKLOG = [
  '## Zebracorns #focus\n',
  '- [ ] B11 Teach the zebracorn to sing (for Units; now; about 1 h)\n',
  '  Requirements:\n',
  '  - a song at dawn\n',
  '  Refined (round 1, by Oracle, 2026-10-14 18:52):\n',
  '  Problem: The zebracorn hums, but nobody can tell the tune.\n',
  '  Goal: One song the herd knows by heart.\n',
  '  Questions:\n',
  '  - Which song?\n',
  '  - At dawn only? Answer: yes\n',
  '  Context: asked by the herd.\n',
  '- [ ] B13 Paint the narwhal bridge\n',
].join('')

function memoryFile(text) {
  const files = new Map([['backlog.md', Buffer.from(text, 'latin1')]])
  return {
    files,
    fs: {
      readFile: async name => {
        if (!files.has(name)) throw new Error('gone')
        return files.get(name)
      },
      writeFile: async (name, bytes) => { files.set(name, Buffer.from(bytes)) },
      rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from) },
      rm: async name => { files.delete(name) },
    },
  }
}

test('the refine block is read apart from the step\'s other lines, which end it', () => {
  const step = parseBacklog(BACKLOG).activities[0].steps[0]
  assert.deepEqual(refinedOf(step.notes), {
    round: 1, by: 'Oracle', at: '2026-10-14 18:52', accepted: null, ready: false,
    problem: 'The zebracorn hums, but nobody can tell the tune.',
    goal: 'One song the herd knows by heart.',
    questions: [{ text: 'Which song?', answer: null }, { text: 'At dawn only?', answer: 'yes' }],
    feedback: [],
  })
  assert.deepEqual(withoutRefined(step.notes), ['Requirements:', '- a song at dawn', 'Context: asked by the herd.'])
  const listed = overview(parseBacklog(BACKLOG))[0].steps
  assert.equal(listed[0].refined.round, 1)
  assert.deepEqual(listed[0].notes.map(part => part.title), ['Requirements', 'Context'])
  assert.equal(listed[1].refined, null)
})

test('answers go behind their questions, feedback under its round; nothing else changes', () => {
  const done = answerRefine(BACKLOG, 'B11', [{ index: 0, answer: 'The dawn chorus' }, { index: 1, answer: 'and at dusk' }], 'the goal is too broad')
  assert.equal(done.ok, true)
  assert.equal(done.text, BACKLOG
    .replace('  - Which song?\n', '  - Which song? Answer: The dawn chorus\n')
    .replace('  - At dawn only? Answer: yes\n', '  - At dawn only? Answer: and at dusk\n  Feedback:\n  - Round 1: the goal is too broad\n'))
  // A second round's feedback goes under the first.
  const again = answerRefine(done.text.replace('round 1,', 'round 2,'), 'B11', [], 'better')
  assert.match(again.text, /- Round 1: the goal is too broad\n {2}- Round 2: better\n {2}Context:/)
  assert.deepEqual(answerRefine(BACKLOG, 'B11', [{ index: 5, answer: 'x' }], ''), { ok: false, why: 'question' })
  assert.deepEqual(answerRefine(BACKLOG, 'B13', [], 'x'), { ok: false, why: 'none' })
  assert.deepEqual(answerRefine(BACKLOG, 'B99', [], 'x'), { ok: false, why: 'gone' })
})

test('accepting marks the head of the block, once', () => {
  const done = acceptRefine(BACKLOG, 'B11', '2026-10-14 19:02')
  assert.equal(done.text, BACKLOG.replace('(round 1, by Oracle, 2026-10-14 18:52):', '(round 1, by Oracle, 2026-10-14 18:52; accepted 2026-10-14 19:02):'))
  assert.equal(acceptRefine(done.text, 'B11', '2026-10-14 19:05').text, done.text.replace('19:02', '19:05'))
  assert.equal(refinedOf(parseBacklog(done.text).activities[0].steps[0].notes).accepted, '2026-10-14 19:02')
})

test('the board writes them only on the board that delivers, and in one line each', async () => {
  const { files, fs } = memoryFile(BACKLOG)
  const now = new Date(2026, 9, 14, 19, 2).getTime()
  assert.equal((await editStep({ action: 'refine-answer', step: 'B11', answers: [], feedback: 'x' }, { canWrite: false, file: 'backlog.md', now, fs })).status, 409)
  assert.equal((await editStep({ action: 'refine-answer', step: 'B11', answers: [{ index: 0, answer: '  ' }], feedback: '' }, { canWrite: true, file: 'backlog.md', now, fs })).status, 400)
  const done = await editStep({ action: 'refine-answer', step: 'B11', answers: [{ index: 0, answer: 'The dawn\nchorus' }], feedback: '' }, { canWrite: true, file: 'backlog.md', now, fs })
  assert.deepEqual(done, { ok: true, result: { step: 'B11', action: 'refine-answer' } })
  assert.match(files.get('backlog.md').toString('latin1'), /- Which song\? Answer: The dawn chorus\n/)
  await editStep({ action: 'refine-accept', step: 'B11' }, { canWrite: true, file: 'backlog.md', now, fs })
  assert.match(files.get('backlog.md').toString('latin1'), /; accepted 2026-10-14 19:02\):/)
  assert.equal((await editStep({ action: 'refine-accept', step: 'B13' }, { canWrite: true, file: 'backlog.md', now, fs })).status, 409)
})

const STATE = {
  advisor: { name: 'Oracle' },
  restart: { main: 'Main' },
  chats: [{ name: 'Main', isMain: true, isRunning: true }],
  backlog: [{ name: 'Zebracorns', steps: [
    { id: 'B11', title: 'Teach the zebracorn to sing', status: 'queued', refined: { round: 1 }, refineAsk: null },
    { id: 'B13', title: 'Paint the narwhal bridge', status: 'open', refined: null, refineAsk: null },
    { id: 'B14', title: 'Count the quokkas', status: 'done', refined: null, refineAsk: null },
    { id: 'B15', title: 'Wake the sloth', status: 'open', refined: null, refineAsk: { isOpen: true } },
  ] }],
}

test('"refine step" goes to the Advisor only, for a step that is not finished, once at a time', () => {
  const first = checkSay({ to: 'Oracle', command: 'refine', step: 'B13' }, STATE, 4000)
  assert.equal(first.ok, true)
  assert.equal(first.message.text, 'refine step\nStep: B13 Paint the narwhal bridge\nRound: 1')
  assert.equal(first.message.round, 1)
  const again = checkSay({ to: 'Oracle', command: 'refine', step: 'B11' }, STATE, 4000)
  assert.match(again.message.text, /^refine step\nStep: B11 Teach the zebracorn to sing\nRound: 2\nThe answers and feedback/)
  assert.equal(checkSay({ to: 'Main', command: 'refine', step: 'B13' }, STATE, 4000).status, 400)
  assert.equal(checkSay({ to: 'Oracle', command: 'refine', step: 'B14' }, STATE, 4000).status, 409)
  assert.equal(checkSay({ to: 'Oracle', command: 'refine', step: 'B15' }, STATE, 4000).status, 409)
  assert.equal(checkSay({ to: 'Oracle', command: 'refine', step: 'B13', text: 'more' }, STATE, 4000).status, 400)
  // An Advisor whose chat is not running is started by the main chat, as for the person's other words to it.
  const state = { ...STATE, chats: [...STATE.chats, { name: 'Oracle', isRunning: false }] }
  assert.equal(wakeFor({ ...first.message }, state, [], 0, 4000)?.command, 'start')
})

test('the window offers Refine for an open step and says while the Advisor works on it', async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// refine:start'), script.indexOf('// refine:end'))}\nObject.assign(this, { refineView })`, page)
  assert.equal(page.refineView({ id: 'B14', status: 'done' }, 'Oracle'), null)
  const fresh = page.refineView({ id: 'B13', status: 'open', refined: null, refineAsk: null }, 'Oracle')
  assert.equal(fresh.canAsk, true)
  assert.equal(page.refineView({ id: 'B13', status: 'open', refined: null, refineAsk: null }, null).canAsk, false)
  const working = page.refineView({ id: 'B11', status: 'queued', refined: { round: 1, by: 'Oracle', at: '2026-10-14 18:52', accepted: null, questions: [{ text: 'Which?', answer: null }], feedback: [] }, refineAsk: { isOpen: true, at: 0, round: 2, state: 'delivered' } }, 'Oracle')
  assert.equal(working.canAsk, false)
  assert.equal(working.open, 1)
  assert.equal(working.meta, 'round 1 · by Oracle · 2026-10-14 18:52')
  assert.equal(working.working.round, 2)
})
