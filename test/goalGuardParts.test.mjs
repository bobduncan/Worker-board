// B669: the goal guard counts failed checks per part, not per goal (the person, 2026-10-26: "yes" to counting per part, after
// G60 and G15 failed three times while most of their parts passed). A part is one 'Part:' line of the goal's how with the
// steps it names and every fix made from them; a goal without parts, or a step in no part, counts per chain. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { focusMove, guardGoal } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { attemptsOfGroup, evaluateWords, evaluationCovers, evaluationFor, fableAskOf, goalAttempts, guardOf, guardStep, needsEvaluation } from '../src/goalGuard.mjs'
import { workApi } from '../src/work/api.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const step = (id, goal, failedAt, more = {}) => ({
  head: new Map([['Id', id], ['Kind', 'step'], ['Title', `Step ${id}`], ['State', 'in progress'], ['Goal', goal], ...Object.entries(more)]),
  sections: new Map([['History', failedAt.map(at => `- 2026-10-25 ${at} Partner: result check failed: 0 of 1 points pass; fix B999 for W1`)], ['Checked', []]]),
})

// Ten parts, as G60 of 2026-10-25 had them; each part's first step is B200 + its place, its fix B300 + its place.
const TITLES = ['Cliffs', 'Edges', 'Round shapes', 'Water', 'Ridges', 'Slopes', 'Caves', 'Bridges', 'Vents', 'Banks']
const MAP = [
  '# Goals', 'Last id: G60', 'Focus: G60', '',
  '- [~] G60 Terrain that reads as one world',
  '  Done when: ten kinds of ground read at a glance',
  ...TITLES.map((title, place) => `  Part: ${title} · 2 h · steps B${200 + place}`),
  '  How agreed: 2026-10-25 08:00',
  '',
].join('\n')
const goal = (text = MAP) => parseGoals(text).byId.get('G60')

// 18 failed checks over the parts: Cliffs 3 (its third at 12:00), Edges 3 (its third at 12:30), six parts with 2, two with none.
// A fix step carries `Fix of` its part's step. The 3rd failed check of the whole goal came at 09:20, long before.
const SPREAD = [
  ...[2, 3, 4, 5, 6, 7].flatMap(place => [step(`B${200 + place}`, 'G60', [`09:${place}0`, `13:${place}0`])]),
  step('B200', 'G60', ['10:00', '11:00']), step('B300', 'G60', ['12:00'], { 'Fix of': 'B200' }),
  step('B201', 'G60', ['10:30', '11:30']), step('B301', 'G60', ['12:30'], { 'Fix of': 'B201' }),
]
const without = (items, ids) => items.filter(item => !ids.includes(item.head.get('Id')))

test('G60: eighteen failed checks over ten parts trip the part that reached three first, and only its steps', () => {
  const counted = goalAttempts(goal(), SPREAD)
  assert.equal(counted.count, 18)
  assert.equal(counted.tripped.title, 'Cliffs')
  assert.deepEqual(counted.tripped.steps.toSorted(), ['B200', 'B300'], 'the part\'s step and its fix, no other')
  assert.deepEqual(counted.tripped.failures.map(one => one.id), ['B200', 'B200', 'B300'])
  // Worst first; Edges has three too but reached them later; the parts with two follow.
  assert.deepEqual(counted.groups.map(group => [group.title, group.count]).slice(0, 4), [['Cliffs', 3], ['Edges', 3], ['Round shapes', 2], ['Water', 2]])
  assert.equal(needsEvaluation(goal(), SPREAD), true)
  // The 3rd failure of the whole goal came at 09:20: a count per goal would have tripped three hours earlier and on no part.
  assert.ok(counted.failures[2].at < '2026-10-25 10:00')
})

test('failures spread one or two per part do not trip the guard, however many there are', () => {
  const spread = without(SPREAD, ['B300', 'B301'])
  const counted = goalAttempts(goal(), spread)
  assert.equal(counted.count, 16)
  assert.equal(counted.tripped, null)
  assert.equal(needsEvaluation(goal(), spread), false)
  assert.equal(guardStep(goal(), spread), null)
  assert.deepEqual(guardOf(goal(), spread, []).parts.map(one => one.count), [2, 2, 2, 2, 2, 2, 2, 2])
  assert.equal(guardOf(goal(), spread, []).attempts, 2)
})

test('a fix of a step counts in the part of the step it fixes, also through a chain of fixes; a fix whose step is gone still does', () => {
  const chain = [step('B200', 'G60', ['10:00']), step('B300', 'G60', ['11:00'], { 'Fix of': 'B200' }), step('B400', 'G60', ['12:00'], { 'Fix of': 'B300' })]
  assert.equal(goalAttempts(goal(), chain).tripped.title, 'Cliffs')
  const orphan = [step('B300', 'G60', ['10:00', '11:00', '12:00'], { 'Fix of': 'B200' })]
  assert.equal(goalAttempts(goal(), orphan).tripped.title, 'Cliffs')
})

test('a goal without parts counts per chain: a step and its fixes', () => {
  const plain = parseGoals(['# Goals', 'Last id: G7', 'Focus: G7', '', '- [~] G7 Lanterns', '  How agreed: 2026-10-25 08:00', ''].join('\n')).byId.get('G7')
  const items = [
    step('B1', 'G7', ['09:00', '10:00']), step('B2', 'G7', ['11:00'], { 'Fix of': 'B1' }),
    step('B5', 'G7', ['09:10', '10:10']), step('B6', 'G7', ['09:20']),
  ]
  const counted = goalAttempts(plain, items)
  assert.equal(counted.count, 6)
  assert.deepEqual(counted.groups.map(group => [group.title.split(' ')[0], group.count]), [['B1', 3], ['B5', 2], ['B6', 1]])
  assert.equal(counted.tripped.title.split(' ')[0], 'B1')
  assert.equal(needsEvaluation(plain, items), true)
  assert.equal(needsEvaluation(plain, without(items, ['B2'])), false, 'two in the chain, two in another: none three')
  // A step of a goal with parts that no part names counts per chain too.
  assert.equal(goalAttempts(goal(), [step('B900', 'G60', ['09:00', '10:00']), step('B901', 'G60', ['09:10', '10:10'])]).tripped, null)
})

test('the goal\'s own re-checks and its looks are one group of their own: three failed re-checks trip it, with no part named', () => {
  const rechecked = goal(MAP.replace('  How agreed: 2026-10-25 08:00', ['  How agreed: 2026-10-25 08:00', ...[9, 10, 11].map(hour => `  Rechecked (2026-10-25 ${String(hour).padStart(2, '0')}:00, Partner): failed · 1 of 2 points pass · gap: water is flat · evidence none`)].join('\n')))
  const counted = goalAttempts(rechecked, [])
  assert.deepEqual([counted.tripped.title, counted.tripped.count], ['Whole goal', 3])
  const body = fableAskOf({ goal: rechecked, attempts: counted })
  assert.equal(body.title, 'G60 failed 3 times: evaluate the strategy with Fable?')
})

test('the ask and the word to the partner name the part that tripped, and count and list its failures alone', () => {
  const node = goal()
  const counted = goalAttempts(node, SPREAD)
  const ask = fableAskOf({ goal: node, attempts: counted })
  assert.equal(ask.title, 'G60 · Cliffs failed 3 times: evaluate the strategy with Fable?')
  assert.match(ask.text.split('\n')[0], /^G60 Terrain that reads as one world \(Cliffs\): 3 checks failed since Go; the latest, B300: /)
  // A long part name still leaves the title at 12 words or fewer.
  const long = { ...counted.tripped, title: 'The long ridges of the northern mountains' }
  const longAsk = fableAskOf({ goal: node, attempts: counted, part: long })
  assert.equal(longAsk.title.split(/\s+/).length <= 12, true, longAsk.title)
  assert.match(longAsk.text.split('\n')[0], /\(The long ridges of the northern mountains\)/)

  const words = evaluateWords({ to: 'Partner', goal: node, attempts: counted, part: counted.tripped, approveRebuilds: false, job: 'j' }).text.split('\n')
  assert.equal(words[1], 'Part: Cliffs (steps B200, B300): the evaluation is of this part, the other parts go on')
  assert.equal(words[2], 'Attempts: 3 failed checks of this part since Go (2026-10-25 08:00)')
  assert.match(words[3], /^Other parts: Edges 3, Round shapes 2, Water 2, /)
  assert.deepEqual(words.filter(line => line.startsWith('- ')).map(line => line.slice(0, 7)), ['- B200 ', '- B200 ', '- B300 '], 'only the part\'s failed checks')
  assert.match(words.find(line => line.startsWith('Next steps')), /^Next steps: refine every next step of G60's part Cliffs with Effort: high/)
  assert.deepEqual(attemptsOfGroup(counted, counted.tripped).count, 3)
})

test('the Focus page gets the count per part, worst first, and the part under evaluation', () => {
  const guard = guardOf(goal(), SPREAD, [])
  assert.deepEqual(guard.parts.slice(0, 3), [{ title: 'Cliffs', count: 3 }, { title: 'Edges', count: 3 }, { title: 'Round shapes', count: 2 }])
  assert.deepEqual([guard.attempts, guard.state], [3, 'counting'])
  assert.equal(guard.part, undefined)
  const evaluating = goal(MAP.replace('  How agreed: 2026-10-25 08:00', '  How agreed: 2026-10-25 08:00\n  Evaluation asked: 2026-10-25 13:00\n  Evaluation part: Edges'))
  const under = guardOf(evaluating, SPREAD, [])
  assert.deepEqual([under.state, under.part, under.attempts], ['evaluating', 'Edges', 3])
})

test('the evaluation of one part covers the steps of that part and those no part claims; the other parts go on', () => {
  const evaluating = goal(MAP.replace('  How agreed: 2026-10-25 08:00', '  How agreed: 2026-10-25 08:00\n  Evaluation asked: 2026-10-25 13:00\n  Evaluation part: Cliffs'))
  assert.equal(evaluating.evaluationPart, 'Cliffs')
  const store = new Map(SPREAD.map(item => [item.head.get('Id'), item]))
  assert.equal(evaluationCovers(evaluating, store, 'B200'), true)
  assert.equal(evaluationCovers(evaluating, store, 'B300'), true, 'the fix of a step of the part')
  assert.equal(evaluationCovers(evaluating, store, 'B201'), false, 'another part')
  assert.equal(evaluationCovers(evaluating, store, 'B301'), false, 'the fix of another part\'s step')
  assert.equal(evaluationCovers(evaluating, store, 'B777'), true, 'a step the goal and the store do not know')
  assert.equal(evaluationFor(evaluating, store, 'B200'), 'running')
  assert.equal(evaluationFor(evaluating, store, 'B201'), null)
  // An evaluation of the goal as a whole covers every step.
  const whole = goal(MAP.replace('  How agreed: 2026-10-25 08:00', '  How agreed: 2026-10-25 08:00\n  Evaluation asked: 2026-10-25 13:00'))
  assert.equal(evaluationFor(whole, store, 'B201'), 'running')
})

// The guard end to end: the line it writes, the effort it lifts, the line it takes away.
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
const FILE = 'D:/Work/p/goals.md'
const NOW = new Date(2026, 9, 25, 14, 0).getTime()
const read = fs => parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8')).byId.get('G60')

test('the guard writes the part that tripped, lifts the effort of that part\'s steps only, and the end of the trip takes the line away', async () => {
  const fs = fakeFs({ [FILE]: Buffer.from(MAP, 'utf8').toString('latin1') })
  const dir = await mkdtemp(join(tmpdir(), 'parts-'))
  const at = new Date(2026, 9, 25, 14, 0).getTime()
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Terrain', '- [ ] B200 Draw the cliffs', '- [ ] B201 Draw the edges', ''].join('\n'), { now: at }), undefined, { now: at })
  const base = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: SPREAD, approveRebuilds: false }
  const filed = []
  const asked = await guardGoal('G60', { ...base, fileAsk: async body => { filed.push(body); return { ok: true, result: { id: 'Q90' } } } })
  assert.deepEqual([asked.ok, asked.result.asked, asked.words], [true, 'Q90', null])
  assert.equal(filed[0].title, 'G60 · Cliffs failed 3 times: evaluate the strategy with Fable?')
  assert.deepEqual([read(fs).fableAsked, read(fs).evaluationPart], ['Q90', 'Cliffs'])
  const answer = { head: new Map([['Id', 'Q90'], ['Kind', 'ask'], ['Title', filed[0].title], ['State', 'answered'], ['Owner', 'server'], ['Asks', 'decide'], ['Of', 'G60']]), sections: new Map([['Answer', ['B Opus 5.5 (max)']]]) }
  const fired = await guardGoal('G60', { ...base, items: [...SPREAD, answer] })
  assert.equal(fired.result.fired, true)
  assert.match(fired.words.text, /\nPart: Cliffs \(steps B200, B300\): the evaluation is of this part/)
  assert.equal(read(fs).evaluationPart, 'Cliffs', 'kept while the evaluation runs')
  // The effort: the step of the part is lifted to high, the step of another part is left as it was.
  const ctx = { dir, now: at + 60_000, prefix: '', roleOf: chat => ({ Partner: 'advisor' })[chat] ?? null, freeChats: new Set(), evaluationOf: (id, stepId, items) => evaluationFor(read(fs), items, stepId) }
  const partner = body => workApi({ chat: 'Partner', ...body }, ctx)
  const lifted = await partner({ action: 'refine', id: 'B200', summary: 'Draw the cliffs.', goal: 'G60' })
  assert.equal(lifted.ok, true, lifted.why)
  const other = await partner({ action: 'refine', id: 'B201', summary: 'Draw the edges.', goal: 'G60' })
  assert.equal(other.ok, true, other.why)
  const items = (await readStore(dir)).items
  assert.match(items.get('B200').sections.get('Effort')?.[0] ?? '', /^high · the goal guard: G60 is in its fundamental evaluation/)
  assert.equal(items.get('B201').sections.get('Effort')?.[0] ?? null, null, 'another part goes on as it was')
  // The partner's marked how-draft ends the trip: the line goes with "Evaluation asked".
  const drafted = await focusMove({ command: 'how-draft', id: 'G60', parts: ['Cliffs from a reference · 2 h'], partnerDecides: ['Evaluation: draw the cliffs from a reference'], youDecide: [] }, { ...base, isKnown: true })
  assert.equal(drafted.ok, true, drafted.why)
  assert.deepEqual([read(fs).evaluationAsked, read(fs).fableAsked, read(fs).evaluationPart], [null, null, null])
})
