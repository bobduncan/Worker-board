// B354: the project names its kinds of work in the board's settings (`kinds`: each kind, its definition of done and its
// reference folder), and a refined step that makes a thing of a named kind carries its Standard line: the kind, the
// reference picture, the target score. The board knows no kind of its own. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { refinedOf, refinedSpan } from '../src/backlog.mjs'
import { configProblem, parseConfig } from '../src/config.mjs'
import { parseGoals } from '../src/goals.mjs'
import { focusState } from '../src/state.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { kindsNamed, parseStandard, standardOf } from '../src/work/standard.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const KINDS = [
  { kind: 'creature', done: 'docs/done/creature.md', reference: 'art/creatures' },
  { kind: 'level', done: 'docs/done/level.md', reference: 'art/levels' },
  { kind: 'menu piece', done: 'docs/done/menu-piece.md', reference: 'art/menus' },
]

test('the settings name the kinds: each with its definition of done and reference folder, inside the project', () => {
  assert.deepEqual(parseConfig('{}', {}).kinds, [])
  const config = parseConfig(JSON.stringify({ kinds: [{ kind: ' creature ', done: 'docs/done/creature.md', reference: 'art/creatures' }, { kind: 'level', done: '../out.md', reference: 'art' }, 'menu'] }), {})
  assert.deepEqual(config.kinds, [{ kind: 'creature', done: 'docs/done/creature.md', reference: 'art/creatures' }])
  assert.equal(configProblem(JSON.stringify({ kinds: KINDS })), null)
  const wants = '"kinds" must be a list of { "kind", "done", "reference" }: a kind\'s name, its definition of done and its reference folder, paths inside the project written with /'
  assert.ok(configProblem(JSON.stringify({ kinds: 'creature' })).startsWith(wants))
  assert.ok(configProblem(JSON.stringify({ kinds: [{ kind: 'creature', done: 'C:/x.md', reference: 'art' }] })).startsWith(wants))
  assert.ok(configProblem(JSON.stringify({ kinds: [{ kind: '', done: 'a.md', reference: 'art' }] })).startsWith(wants))
  assert.ok(configProblem(JSON.stringify({ kinds: [KINDS[0], { ...KINDS[1], kind: 'Creature' }] })).startsWith(wants))
})

test('a text names a kind by its name or its plural, as whole words in any case', () => {
  assert.deepEqual(kindsNamed('Draw five forest levels as pictures', KINDS).map(one => one.kind), ['level'])
  assert.deepEqual(kindsNamed('A Creature that flies, and two menu pieces', KINDS).map(one => one.kind), ['creature', 'menu piece'])
  assert.deepEqual(kindsNamed('Level up the leveling of creatures-to-be', KINDS).map(one => one.kind), ['creature', 'level'])
  assert.deepEqual(kindsNamed('The board\'s levelled menu', KINDS), [])
  assert.deepEqual(kindsNamed('Anything', []), [])
})

test('a standard is "<kind> · <reference picture> · target <score>" with a kind of the list, or "none (<why>)"', () => {
  assert.deepEqual(parseStandard('Creature · art/creatures/wolf.png · target 8 of 10', KINDS), { ok: true, kind: 'creature', line: 'creature · art/creatures/wolf.png · target 8 of 10' })
  assert.deepEqual(parseStandard('  none (a fix of the board, it makes no level) ', KINDS), { ok: true, kind: null, line: 'none (a fix of the board, it makes no level)' })
  assert.match(parseStandard('dragon · art/x.png · target 8', KINDS).why, /^"dragon" is no kind of the settings: creature, level, menu piece\./)
  assert.match(parseStandard('creature · art/x.png', KINDS).why, /target/)
  assert.match(parseStandard('creature ·  · target 8', KINDS).why, /reference picture/)
  assert.match(parseStandard('none', KINDS).why, /why/)
  assert.equal(parseStandard('', KINDS).ok, false)
  // With no kinds in the settings any kind's name is taken as written.
  assert.equal(parseStandard('poster · art/p.png · target 7', []).line, 'poster · art/p.png · target 7')
})

const NOW = new Date(2026, 9, 18, 22, 0).getTime()
const BACKLOG = '# Backlog\n\n## World work\n- [ ] B1 Draw three forest levels\n- [ ] B2 Speed up the page\n'
const ROLES = { Main: 'main', Board: 'worker', Advisor: 'advisor' }

async function fresh(kinds = KINDS) {
  const dir = await mkdtemp(join(tmpdir(), 'kinds-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board']), kinds }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, advisor: as('Advisor'), main: as('Main'), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const itemOf = async (dir, id) => (await readStore(dir)).items.get(id)
const REFINE = { action: 'refine', summary: 'Three forest levels to walk.', goal: 'G6', size: '2 h' }

test('refine writes the Standard line into the block, after the size, and keeps it as the step\'s standard', async () => {
  const { dir, advisor } = await fresh()
  const done = await advisor({ ...REFINE, id: 'B1', standard: 'level · art/levels/forest.png · target 8', questions: ['Fog at night? Advised: yes, it reads as forest'] })
  assert.equal(done.ok, true, done.why)
  const step = await itemOf(dir, 'B1')
  const block = step.sections.get('Refined').map(one => one.trim())
  assert.deepEqual(block.slice(1, 6), ['Summary: Three forest levels to walk.', 'Part of: G6', 'Size: about 2 h', 'Standard: level · art/levels/forest.png · target 8', 'Questions:'])
  assert.equal(standardOf(step), 'level · art/levels/forest.png · target 8')
  assert.equal(refinedOf(block).standard, 'level · art/levels/forest.png · target 8')
  // A block read back from the backlog's lines ends after its questions, not at the Standard line.
  assert.deepEqual(refinedSpan(block), [0, block.length])
  assert.equal((await advisor({ ...REFINE, id: 'B1', standard: 'dragon · a.png · target 8' })).status, 400)
  // A next round without "standard" keeps the one it had.
  await advisor({ ...REFINE, id: 'B1' })
  assert.equal(standardOf(await itemOf(dir, 'B1')), 'level · art/levels/forest.png · target 8')
})

test('refined is refused for a step that names a kind of the settings and has no standard; given one, or none with why, it is ready', async () => {
  const { dir, advisor } = await fresh()
  await advisor({ ...REFINE, id: 'B1' })
  const refused = await advisor({ action: 'refined', id: 'B1', what: ['three forest levels'] })
  assert.equal(refused.status, 409)
  assert.equal(refused.why, 'B1 names the kind of work "level": give its standard in "standard", as "level · <a reference picture from art/levels> · target <score>" (checked against docs/done/level.md), or "none (<why>)" when it makes no level.')
  assert.equal(valueOf(await itemOf(dir, 'B1'), 'Refined'), 'open')
  const ready = await advisor({ action: 'refined', id: 'B1', what: ['three forest levels'], standard: 'level · art/levels/forest.png · target 8' })
  assert.equal(ready.ok, true, ready.why)
  const step = await itemOf(dir, 'B1')
  const block = step.sections.get('Refined').map(one => one.trim())
  assert.deepEqual(block.slice(-3), ['Standard: level · art/levels/forest.png · target 8', 'What we build:', '- three forest levels'])
  assert.equal(valueOf(step, 'Refined'), 'ready')
  // A step that names no kind needs none; one that names a kind by chance says why it has none.
  await advisor({ ...REFINE, id: 'B2', summary: 'The page draws faster.' })
  assert.equal((await advisor({ action: 'refined', id: 'B2', what: ['half the time'] })).ok, true)
  const { advisor: other, dir: there } = await fresh()
  await other({ ...REFINE, id: 'B1' })
  assert.equal((await other({ action: 'refined', id: 'B1', what: ['a level test'], standard: 'none (it tests the loader, no level is drawn)' })).ok, true)
  assert.equal(standardOf(await itemOf(there, 'B1')), 'none (it tests the loader, no level is drawn)')
  // Without kinds in the settings nothing is asked.
  const { advisor: free } = await fresh([])
  await free({ ...REFINE, id: 'B1' })
  assert.equal((await free({ action: 'refined', id: 'B1', what: ['three forest levels'] })).ok, true)
})

test('the person\'s answers to the refine keep the Standard line in the block', async () => {
  const { dir, advisor, person } = await fresh()
  await advisor({ ...REFINE, id: 'B1', standard: 'level · art/levels/forest.png · target 8', questions: ['Fog at night? Advised: yes, it reads as forest'] })
  const answered = await person({ action: 'refine-answer', id: 'B1', answers: [{ index: 0, answer: 'yes' }], feedback: '' })
  assert.equal(answered.ok, true, answered.why)
  const block = (await itemOf(dir, 'B1')).sections.get('Refined').map(one => one.trim())
  assert.ok(block.includes('Standard: level · art/levels/forest.png · target 8'))
  assert.ok(block.some(one => one.endsWith('Answer: yes')))
})

const HOW = { action: 'new', title: 'Draw the first creature', activity: 'World work', goal: 'G6', text: 'A wolf for the forest.', summary: 'A wolf that walks the forest.', size: '3 h', what: ['a wolf in four directions'] }

test('a step made from the agreed how names its standard when it makes a thing of a kind', async () => {
  const { dir, advisor } = await fresh()
  const refused = await advisor(HOW)
  assert.equal(refused.status, 409)
  assert.match(refused.why, /^This step names the kind of work "creature": give its standard in "standard"/)
  const made = await advisor({ ...HOW, standard: 'creature · art/creatures/wolf.png · target 8' })
  assert.equal(made.ok, true, made.why)
  const step = await itemOf(dir, made.result.id)
  assert.equal(valueOf(step, 'Refined'), 'ready')
  assert.ok(step.sections.get('Refined').some(one => one.trim() === 'Standard: creature · art/creatures/wolf.png · target 8'))
  assert.equal(standardOf(step), 'creature · art/creatures/wolf.png · target 8')
  // An ordinary new step keeps a standard given, and is not refused without one: it is refined later.
  const plain = await advisor({ action: 'new', title: 'Draw a second creature', activity: 'World work' })
  assert.equal(plain.ok, true, plain.why)
  assert.equal((await advisor({ action: 'new', title: 'Draw a bird', activity: 'World work', standard: 'dragon · x.png · target 2' })).status, 400)
})

const GOALS = [
  'Last id: G6',
  'Focus: G6',
  '',
  '- [~] G6 A forest to walk',
  '    Done when: a player crosses the forest in five minutes',
  '    Vibe: quiet and green',
  '    Vibe agreed: 2026-10-18 10:00',
  '    Part: The levels · about 2 h · steps B1, B2',
  '    Part: The wolf · 3 h · steps B3',
  '    How agreed: 2026-10-18 11:00',
  '',
].join('\n')
const step = (id, standard) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: queued\nSince: 2026-10-18 09:00\n${standard === null ? '' : `\n## Standard\n${standard}\n`}`)

test('the Focus page gets each part\'s standards from its steps, each once, none left out', () => {
  const state = focusState(parseGoals(GOALS), [step('B1', 'level · art/levels/forest.png · target 8'), step('B2', 'level · art/levels/forest.png · target 8'), step('B3', 'none (the wolf is bought)')], [], '')
  assert.deepEqual(state.parts.map(part => part.standards), [['level · art/levels/forest.png · target 8'], []])
})

test('the partner\'s rounds name the kinds of work with their definitions of done and reference folders', async () => {
  const { recheckText } = await import('../src/rounds.mjs')
  const config = parseConfig(JSON.stringify({ project: 'D:/Work/garden', kinds: KINDS.slice(0, 2) }), {})
  assert.ok(recheckText({ board: 'D:/Work/board', config }).split('\n').includes('Kinds of work, paths in the project: creature (done: docs/done/creature.md; references: art/creatures); level (done: docs/done/level.md; references: art/levels)'))
  assert.ok(!recheckText({ board: 'D:/Work/board', config: parseConfig('{}', {}) }).includes('Kinds of work'))
})

test('a chat whose work tool has no "standard" yet gives it as a line of "what" that starts with Standard:', async () => {
  const { dir, advisor } = await fresh()
  await advisor({ ...REFINE, id: 'B1' })
  const ready = await advisor({ action: 'refined', id: 'B1', what: ['Standard: level · art/levels/forest.png · target 8', 'three forest levels'] })
  assert.equal(ready.ok, true, ready.why)
  const step = await itemOf(dir, 'B1')
  assert.equal(standardOf(step), 'level · art/levels/forest.png · target 8')
  assert.deepEqual(step.sections.get('What we build'), ['- three forest levels'])
  const made = await advisor({ ...HOW, what: ['a wolf in four directions', '- Standard: none (the wolf is bought, not drawn)'] })
  assert.equal(made.ok, true, made.why)
  assert.equal(standardOf(await itemOf(dir, made.result.id)), 'none (the wolf is bought, not drawn)')
})
