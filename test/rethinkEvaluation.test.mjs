// Stop and rethink (docs/stop-and-rethink.md, T13.2.1), the evaluation the person starts: `startEvaluation` writes "Evaluation asked" and
// "Evaluation part" under the goal without the guard's trip test, and the word to the partner is the evaluate word with the person's
// block under its first line; a second one finds the first running and sends the words as "more"; the marked how-draft ends it as
// ever (the holds are freed by the board's tick, server.mjs). Made-up names only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { focusMove, rethinkTalkWords, startEvaluation } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'

const MAP = [
  '# Goals', 'Last id: G60', 'Focus: G60', '',
  '- [~] G60 Terrain that reads as one world',
  '  Done when: ten kinds of ground read at a glance',
  '  Part: Side stairs · 2 h · steps B200',
  '  Part: Walls · 2 h · steps B201',
  '  How agreed: 2026-10-25 08:00',
  '',
].join('\n')
const FILE = 'D:/Work/p/goals.md'
const NOW = new Date(2026, 10, 7, 11, 30).getTime()

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
    rename: async (from, to) => { files[to] = files[from]; delete files[from] },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async dir => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1)),
  }
}
const fresh = (map = MAP) => fakeFs({ [FILE]: Buffer.from(map, 'utf8').toString('latin1') })
const read = fs => parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8')).byId.get('G60')
const base = fs => ({
  canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Advisor' }, job: 'roles/partner.md', items: [], approveRebuilds: false, maxChars: 2000,
  part: 'Side stairs', topic: 'Side stairs', held: ['B200', 'B201'],
  asked: { text: 'all wrong, look at this', pictures: ['art-inbox/stairs/ref.png'], earlier: 'The person\'s earlier words on this part (its earlier tries; 1 in all, newest first): ...\n- 2026-11-05 10:55 · B200, a note: "no stairs like that"' },
})

test('startEvaluation: the lines under the goal, no trip needed, and the evaluate word with the person\'s block under its first line', async () => {
  const fs = fresh()
  const started = await startEvaluation('G60', base(fs))
  assert.deepEqual([started.ok, started.result.started, started.result.running], [true, true, false], JSON.stringify(started))
  assert.deepEqual([read(fs).evaluationAsked, read(fs).evaluationPart], ['2026-11-07 11:30', 'Side stairs'])
  const lines = started.words.text.split('\n')
  assert.deepEqual([started.words.to, started.words.command, started.words.about], ['Advisor', 'evaluate', 'G60'])
  assert.equal(lines[0], 'evaluate G60 Terrain that reads as one world')
  assert.equal(lines[1], 'Asked by the person (2026-11-07 11:30): "all wrong, look at this"')
  assert.equal(lines[2], 'Pictures: art-inbox/stairs/ref.png')
  assert.equal(lines[3], 'Topic: Side stairs; held until your how-draft ends the evaluation: B200, B201')
  assert.match(lines[4], /^The person's earlier words on this part/)
  assert.match(lines[5], /^- 2026-11-05 10:55 · B200, a note: "no stairs like that"/)
  // The rest is the evaluate word as the guard sends it.
  assert.ok(lines.some(one => one.startsWith('Attempts: ')))
  assert.ok(lines.some(one => one.startsWith('Next steps: refine every next step of G60')))
  assert.equal(lines.at(-1), 'Your job: roles/partner.md, "The fundamental evaluation"')
})

test('the word fits the board\'s limit with the block in it: the earlier words are cut from the end, the person\'s own words stay', async () => {
  const lines = Array.from({ length: 30 }, (_, n) => `- 2026-11-0${(n % 9) + 1} 10:00 · B200, a note: "${'no '.repeat(60)}"`)
  const long = { ...base(fresh()), asked: { text: 'all wrong', pictures: ['art-inbox/a.png'], earlier: `The person's earlier words on this part (30 in all):\n${lines.join('\n')}` } }
  for (const maxChars of [1500, 2000, 2500]) {
    const started = await startEvaluation('G60', { ...long, maxChars, fs: fresh() })
    assert.ok(started.words.text.length <= maxChars, `${started.words.text.length} characters of ${maxChars}`)
    assert.match(started.words.text, /Asked by the person \(2026-11-07 11:30\): "all wrong"\nPictures: art-inbox\/a.png\nTopic: Side stairs/)
    assert.match(started.words.text, /Your job: roles\/partner.md, "The fundamental evaluation"$/)
  }
  // A long word of the person's is cut, and says where all of it stands.
  const cut = await startEvaluation('G60', { ...base(fresh()), asked: { text: 'x '.repeat(600), pictures: [], earlier: '' } })
  assert.match(cut.words.text, /Asked by the person \(2026-11-07 11:30\): "(?:x )+x…" \(all of it in the Your words of the held steps\)/)
  assert.ok(cut.words.text.length <= 2000)
})

test('a goal whose evaluation runs has no second one: nothing is written, and the words go to the partner as "more"', async () => {
  const fs = fresh()
  await startEvaluation('G60', base(fs))
  const before = fs.files[FILE]
  const second = await startEvaluation('G60', { ...base(fs), now: NOW + 5 * 60_000, asked: { text: 'and the rail is too thin', pictures: [], earlier: '' } })
  assert.deepEqual([second.ok, second.result.started, second.result.running], [true, false, true])
  assert.equal(fs.files[FILE], before, 'the map is as it was')
  assert.equal(second.words.command, 'evaluate')
  assert.equal(second.words.text, 'evaluate G60 Terrain that reads as one world (more from the person, 2026-11-07 11:35)\nMore from the person: "and the rail is too thin"')
})

test('refusals: a board that only shows, no partner, no goal; a goal that is done is calm', async () => {
  assert.equal((await startEvaluation('G60', { ...base(fresh()), canWrite: false })).status, 403)
  assert.equal((await startEvaluation('G60', { ...base(fresh()), partner: null })).status, 409)
  assert.equal((await startEvaluation('G99', base(fresh()))).ok, false)
  const done = await startEvaluation('G60', base(fresh(MAP.replace('[~]', '[x]'))))
  assert.deepEqual([done.ok, done.result.started, done.words], [true, false, null])
})

test('the end: the partner\'s marked how-draft takes the evaluation lines away, as for the guard\'s', async () => {
  const fs = fresh()
  await startEvaluation('G60', base(fs))
  const drafted = await focusMove({ command: 'how-draft', id: 'G60', parts: ['Side stairs from a reference · 2 h', 'Walls · 2 h'], partnerDecides: ['Evaluation: stairs from a reference'], youDecide: [] }, base(fs))
  assert.equal(drafted.ok, true, drafted.why)
  assert.equal(drafted.result.evaluated, true, 'the server frees the holds on this')
  assert.deepEqual([read(fs).evaluationAsked, read(fs).evaluationPart], [null, null])
})

test('the talk word: one line, what was held and stopped, their words and pictures, and the ask to confirm it', () => {
  const word = rethinkTalkWords({ to: 'Owner', goal: { id: 'G60' }, topic: 'Side stairs', held: ['B1068'], stopped: [{ id: 'B1068', owner: 'Worker 5' }], text: 'all wrong', pictures: ['art-inbox/a.png'] })
  assert.deepEqual([word.to, word.command, word.about], ['Owner', 'talk', 'G60'])
  assert.equal(word.text, 'rethink started by the person: G60 "Side stairs"; held: B1068; stopped: B1068 (Worker 5); their words: "all wrong"; pictures: art-inbox/a.png. Confirm it in the talk in one line.')
  assert.equal(rethinkTalkWords({ to: 'Owner', goal: { id: 'G60' }, topic: 'x', text: 'y' }).text, 'rethink started by the person: G60 "x"; held: none; stopped: none; their words: "y"; pictures: none. Confirm it in the talk in one line.')
})

test('the state: focus.rethinkTopics lists the focus goal\'s parts with their open steps, and the open fix chains under no part', async () => {
  const { parseItem } = await import('../src/work/item.mjs')
  const { focusState } = await import('../src/state.mjs')
  const step = (id, state, more = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Try ${id}\nState: ${state}\nGoal: G60\nOwner: Team - Worker 5\n${more}\n## History\n- 2026-11-07 09:00 Main: made\n`)
  const items = [step('B200', 'in progress'), step('B210', 'refined', 'Fix of: B200\n'), step('B201', 'done'), step('B300', 'refined'), step('B301', 'new', 'Fix of: B300\n')]
  const focus = focusState(parseGoals(MAP), items, [], 'Team - ', 'Advisor', NOW)
  assert.deepEqual(focus.rethinkTopics.map(one => [one.title, one.kind, one.steps.map(row => [row.id, row.state, row.owner])]), [
    ['Side stairs', 'part', [['B200', 'in progress', 'Worker 5'], ['B210', 'refined', 'Worker 5']]],
    ['the tries of B300', 'chain', [['B300', 'refined', 'Worker 5'], ['B301', 'new', 'Worker 5']]],
  ])
})
