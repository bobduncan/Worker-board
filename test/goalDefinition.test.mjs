// Goal definition (the person, 2026-10-31: "i want to fundamentally replace all places that say 'vibe' with 'goal
// (definition)'"). The goal map's lines are named `Goal definition`, `Goal definition picture` and `Goal definition agreed`;
// the old `Vibe`, `Vibe picture` and `Vibe agreed` of a goals.md written before are read alike (the same fields), and the
// writers write the new names. `tools/migrate-vibe-lines.mjs` renames the old ones in one go. The work tool's draft is
// `definition-draft`, its old name `vibe-draft` works too. The page and the words the board types say no "vibe". The
// identifiers (`vibe`, `vibeAgreed`, the stage `vibe`, the act names) keep their names. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { focusStage, parseGoals } from '../src/goals.mjs'
import { agreeVibe, setVibe } from '../src/goalsWrite.mjs'
import { FOCUS_COMMANDS, focusWords } from '../src/say.mjs'
import { workApi } from '../src/work/api.mjs'
import { RENAMED, migrateVibeLines, run } from '../tools/migrate-vibe-lines.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

/** A goals.md with the old names, and the same with the new ones. */
const OLD = ['# Goals', 'Last id: G2', 'Focus: G1', '', '- [~] G1 Garden', '  Done when: ten visitors in a week', '  Vibe: calm', '  Vibe: slow',
  '  Vibe picture: pictures/garden.png', '  Vibe agreed: 2026-10-18 10:00', '  - [ ] G2 Pond', ''].join('\n')
const NEW = OLD.replaceAll('Vibe', 'Goal definition')

// ---------------------------------------------------------------------------------------------------------------------
// The parser reads both names; the writers write the new ones

test('the parser reads the new Goal definition lines and the old Vibe lines into the same fields', () => {
  const fields = text => {
    const goal = parseGoals(text).byId.get('G1')
    return [goal.vibe, goal.vibePicture, goal.vibeAgreed, goal.notes, focusStage(goal)]
  }
  assert.deepEqual(fields(NEW), [['calm', 'slow'], 'pictures/garden.png', '2026-10-18 10:00', [], 'how'])
  assert.deepEqual(fields(OLD), fields(NEW))
  // A file in between (a new line beside an old one) reads as well, and the stage follows from either agreed line.
  const mixed = OLD.replace('  Vibe: calm', '  Goal definition: calm').replace('  Vibe agreed', '  Goal definition agreed')
  assert.deepEqual(fields(mixed), fields(NEW))
  assert.equal(focusStage(parseGoals('- [~] G1 A\n  Goal definition: calm\n').byId.get('G1')), 'vibe')
  assert.equal(focusStage(parseGoals('- [~] G1 A\n  Goal definition agreed: 2026-10-18 10:00\n').byId.get('G1')), 'how')
  assert.equal(focusStage(parseGoals('- [~] G1 A\n  Vibe agreed: 2026-10-18 10:00\n').byId.get('G1')), 'how')
})

test('setVibe writes Goal definition lines; the old Vibe lines it replaces are gone, the agreed line stays where it was', () => {
  const fresh = setVibe('- [~] G1 A\n  Done when: x\n', 'G1', ['busy and green', ' '], 'pictures/g.png')
  assert.equal(fresh.text, '- [~] G1 A\n  Done when: x\n  Goal definition: busy and green\n  Goal definition picture: pictures/g.png\n')
  const replaced = setVibe(OLD, 'G1', ['loud'], null)
  assert.equal(replaced.text, ['# Goals', 'Last id: G2', 'Focus: G1', '', '- [~] G1 Garden', '  Done when: ten visitors in a week', '  Goal definition: loud',
    '  Vibe agreed: 2026-10-18 10:00', '  - [ ] G2 Pond', ''].join('\n'))
  // Read back, the old agreed line still counts, and nothing of the old lines is left as a note.
  const goal = parseGoals(replaced.text).byId.get('G1')
  assert.deepEqual([goal.vibe, goal.vibePicture, goal.vibeAgreed, goal.notes], [['loud'], null, '2026-10-18 10:00', []])
  // The new names replace the new names, too.
  assert.equal(setVibe(NEW, 'G1', ['loud'], null).text.includes('Goal definition: calm'), false)
})

test('agreeVibe writes Goal definition agreed once; a goal agreed under the old name is not agreed a second time', () => {
  const plain = '- [ ] G1 A\n  Done when: x\n  Goal definition: calm\n  - [ ] G2 B\n'
  const once = agreeVibe(plain, 'G1', '2026-10-18 12:00')
  assert.equal(once.text, '- [ ] G1 A\n  Done when: x\n  Goal definition: calm\n  Goal definition agreed: 2026-10-18 12:00\n  - [ ] G2 B\n')
  assert.equal(agreeVibe(once.text, 'G1', '2026-10-18 12:05').text, once.text)
  // Old lines: the new agreed line goes after the last of them; an old agreed line is the agreement.
  const old = '- [ ] G1 A\n  Vibe: calm\n  Vibe picture: pictures/a.png\n  - [ ] G2 B\n'
  assert.equal(agreeVibe(old, 'G1', '2026-10-18 12:00').text, '- [ ] G1 A\n  Vibe: calm\n  Vibe picture: pictures/a.png\n  Goal definition agreed: 2026-10-18 12:00\n  - [ ] G2 B\n')
  assert.equal(agreeVibe(OLD, 'G1', '2026-10-19 08:00').text, OLD)
})

// ---------------------------------------------------------------------------------------------------------------------
// The migration script

test('the migration renames the three old names and nothing else, the line endings kept', () => {
  const text = ['# Goals\r', 'Vibe: a line at the margin is the file\'s own words\r', '- [~] G1 Garden\r', '  Done when: x\r', '  Vibe: calm\r', '    Vibe picture: pictures/g.png\r',
    '  Vibe agreed: 2026-10-18 10:00\r', '  Vibes: not a name of the map\r', '  Your vibe: said in passing\r', '  Not in it: Vibe: inside a line\r', '  Vibe agreed 2026: not the form\r', ''].join('\n')
  const done = migrateVibeLines(text)
  assert.equal(done.changed, 3)
  assert.equal(done.text, text.replace('  Vibe: calm', '  Goal definition: calm').replace('    Vibe picture', '    Goal definition picture').replace('  Vibe agreed: 2026-10-18', '  Goal definition agreed: 2026-10-18'))
  assert.deepEqual(RENAMED, { 'Vibe picture': 'Goal definition picture', 'Vibe agreed': 'Goal definition agreed', Vibe: 'Goal definition' })
  // The result is read by the board as the same map.
  const before = parseGoals(OLD).byId.get('G1')
  const after = parseGoals(migrateVibeLines(OLD).text).byId.get('G1')
  assert.deepEqual([after.vibe, after.vibePicture, after.vibeAgreed], [before.vibe, before.vibePicture, before.vibeAgreed])
  assert.equal(migrateVibeLines(OLD).text, NEW)
  // Nothing to rename: the text as it was, and a count of none.
  assert.deepEqual(migrateVibeLines(NEW), { text: NEW, changed: 0 })
})

test('the migration command: renames in the file byte for byte, counts, and writes nothing when it has nothing to do or is asked to count', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'goal-definition-'))
  try {
    const file = join(dir, 'goals.md')
    // A byte order mark, CRLF and a byte that is no UTF-8 (a latin-1 é) all stay.
    const bytes = Buffer.from('\u00ef\u00bb\u00bf# Goals\r\n- [~] G1 Gard\u00e9n\r\n  Vibe: calm\r\n  Vibe agreed: 2026-10-18 10:00\r\n', 'latin1')
    await writeFile(file, bytes)
    const said = []
    const log = line => said.push(line)
    assert.equal(await run([file, '--dry-run'], { log }), 0)
    assert.deepEqual(await readFile(file), bytes)
    assert.match(said.at(-1), /^Would change 2 lines in /)
    assert.equal(await run([file], { log }), 0)
    assert.match(said.at(-1), /^Changed 2 lines in /)
    assert.deepEqual(await readFile(file), Buffer.from(bytes.toString('latin1').replace('Vibe:', 'Goal definition:').replace('Vibe agreed', 'Goal definition agreed'), 'latin1'))
    // A second run has nothing to do.
    const migrated = await readFile(file)
    assert.equal(await run([file], { log }), 0)
    assert.match(said.at(-1), /^Changed 0 lines in /)
    assert.deepEqual(await readFile(file), migrated)
    // The usage and a file that is not there.
    assert.equal(await run([], { log }), 2)
    assert.match(said.at(-1), /^Usage: /)
    assert.equal(await run([join(dir, 'missing.md')], { log }), 1)
    assert.match(said.at(-1), /^Cannot read /)
    assert.deepEqual(await readdir(dir), ['goals.md'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// The work tool's action

test('definition-draft and vibe-draft both keep the goal definition of the focus goal, for the partner (and the Product owner) only', async () => {
  const drafted = []
  const ctx = {
    dir: 'D:/nowhere',
    roleOf: chat => ({ Advisor: 'advisor', Owner: 'owner', Units: 'worker', Main: 'main' })[chat] ?? null,
    goalDraft: async body => {
      drafted.push(body)
      return body.id === 'G9' ? { ok: false, status: 409, why: 'The goal definition is agreed: talk about the how now.' } : { ok: true, result: {} }
    },
  }
  for (const action of ['definition-draft', 'vibe-draft']) {
    const done = await workApi({ action, chat: 'Advisor', goal: 'G6', lines: ['warm wood'], picture: 'pictures/bench.png' }, ctx)
    assert.deepEqual(done, { ok: true, result: { text: 'The board keeps the goal definition of G6 in the goal map.', changed: false } }, action)
    // Both reach the goal map as the same draft.
    assert.deepEqual(drafted.at(-1), { command: 'vibe-draft', id: 'G6', lines: ['warm wood'], picture: 'pictures/bench.png' }, action)
    const owner = await workApi({ action, chat: 'Owner', goal: 'G6', lines: ['warm wood'] }, ctx)
    assert.equal(owner.ok, true, action)
    for (const chat of ['Units', 'Main']) assert.equal((await workApi({ action, chat, goal: 'G6', lines: ['x'] }, ctx)).status, 403, `${action} ${chat}`)
    assert.equal((await workApi({ action, chat: 'Advisor', lines: ['x'] }, ctx)).status, 400, action)
    const late = await workApi({ action, chat: 'Advisor', goal: 'G9', lines: ['x'] }, ctx)
    assert.deepEqual([late.status, late.why], [409, 'The goal definition is agreed: talk about the how now.'], action)
    assert.equal((await workApi({ action, chat: 'Advisor', goal: 'G6', lines: ['x'] }, { ...ctx, goalDraft: undefined })).status, 409, action)
  }
  assert.equal(drafted.length, 6)
  // The board names both in its refusal of an action it does not know.
  const unknown = await workApi({ action: 'nonsense', chat: 'Advisor' }, ctx)
  assert.match(unknown.why, /definition-draft, vibe-draft, how-draft/)
})

// ---------------------------------------------------------------------------------------------------------------------
// The words: no "vibe" on the page, in the pictures or in what the board types

const task = id => parseItem([`Id: ${id}`, 'Kind: step', `Title: Task ${id}`, 'State: done', 'Since: 2026-10-16 12:00', '', '## History', '- 2026-10-15 10:00 Advisor: new', ''].join('\n'))
const STAGES = {
  pick: ['Last id: G6', '', '- [ ] G6 Garden', '    Done when: x', '- [ ] G7 Pond', ''],
  'goal definition, nothing written': ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', ''],
  'goal definition, a draft': ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition picture: pictures/garden.png', ''],
  'goal definition, written under the old names': ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Vibe: calm', '    Vibe picture: pictures/garden.png', ''],
  how: ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-10-18 10:00', ''],
  'how, agreed under the old name': ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Vibe: calm', '    Vibe agreed: 2026-10-18 10:00', ''],
  run: ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-10-18 10:00',
    '    Part: Paths · about 1 h · steps B1 · done when: every bench is on a path', '    How agreed: 2026-10-18 11:00', ''],
  'run, every part done, a goal demo made': ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-10-18 10:00',
    '    Part: Paths · about 1 h · steps B1 · done when: every bench is on a path', '    How agreed: 2026-10-18 11:00', '    Demo: art/g6/demo.png · what G6 made', ''],
  'run, every part done, no goal demo yet': ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-10-18 10:00',
    '    Part: Paths · about 1 h · steps B1 · done when: every bench is on a path', '    How agreed: 2026-10-18 11:00', ''],
  'run, the re-check asked': ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-10-18 10:00',
    '    Part: Paths · about 1 h · steps B1 · done when: every bench is on a path', '    How agreed: 2026-10-18 11:00', '    Demo: art/g6/demo.png · what G6 made',
    '    Recheck asked: 2026-10-19 09:00', ''],
  done: ['Last id: G6', '', '- [x] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-10-18 10:00', ''],
}
const pageState = (lines, items) => asSent({ ...build(items, undefined, lines.join('\n')), goalsEdit: { canWrite: true } })
/** What a person can read on the page: its text, and the title, label, alt and placeholder of every element. */
function readable(document) {
  const words = [document.title, document.body.textContent]
  for (const node of document.querySelectorAll('*')) {
    for (const name of ['title', 'aria-label', 'alt', 'placeholder']) {
      const value = node.getAttribute(name)
      if (value) words.push(value)
    }
  }
  return words.join('\n')
}

test('the Focus page shows no "vibe" in any stage, also the boxes of "Not yet" and "No"', async () => {
  for (const [name, lines] of Object.entries(STAGES)) {
    const items = name.startsWith('run, every part done') || name === 'run, the re-check asked' ? [task('B1')] : []
    const page = await openPage({ state: pageState(lines, items) })
    try {
      await page.click('[data-tab="advice"]')
      assert.ok(page.find('#advisor-focus').textContent.length > 0, name)
      // The stages that ask "Did we reach the goal?" really draw its card; the one that waits for the re-check draws its note instead.
      assert.equal(page.all('.focus-there').length, name.startsWith('run, every part done') ? 1 : 0, name)
      if (name === 'run, the re-check asked') assert.match(page.find('#advisor-focus').textContent, /Against its Done when and its goal definition/)
      assert.doesNotMatch(readable(page.document), /vibe/i, name)
      // The boxes that ask what is missing, where the stage has them.
      for (const act of ['vibe-not-yet', 'vibe-there-no']) {
        if (page.all(`[data-focus-act="${act}"]`).length === 0) continue
        await page.click(`[data-focus-act="${act}"]`)
        assert.doesNotMatch(readable(page.document), /vibe/i, `${name}: ${act}`)
      }
    } finally {
      await page.close()
    }
  }
})

test('the Focus page names the goal definition where it asked for the vibe', async () => {
  const page = await openPage({ state: pageState(STAGES['goal definition, a draft'], []) })
  try {
    await page.click('[data-tab="advice"]')
    assert.equal(page.text('.focus-draft h3'), 'The goal definition so far')
    assert.deepEqual(page.all('.focus-buttons button').map(one => one.textContent), ['This is the goal definition', 'Not yet'])
    const bare = await openPage({ state: pageState(STAGES['goal definition, nothing written'], []) })
    try {
      await bare.click('[data-tab="advice"]')
      assert.match(bare.find('#advisor-focus').textContent, /Your partner writes the goal definition here while you talk\./)
    } finally {
      await bare.close()
    }
  } finally {
    await page.close()
  }
})

test('the help pictures and the words the board types say no "vibe"', async () => {
  const folder = fileURLToPath(new URL('../public/help/', import.meta.url))
  for (const file of (await readdir(folder)).filter(one => one.endsWith('.svg'))) assert.doesNotMatch(await readFile(join(folder, file), 'utf8'), /vibe/i, file)
  const goal = parseGoals('- [~] G2 Benches\n  Done when: every bench is on a path\n  Goal definition: you sit down without thinking\n').byId.get('G2')
  assert.deepEqual(FOCUS_COMMANDS.filter(command => /vibe/i.test(focusWords(command, { to: 'Partner', goal, thread: 'talks/benches.md', stage: 'the goal definition', words: 'by you', job: 'roles/partner.md', note: 'N1' }).text)), [])
  assert.match(focusWords('vibe-agreed', { to: 'Partner', goal, thread: 'talks/benches.md' }).text, /^goal definition: agreed\nGoal: G2 Benches\nThread: talks\/benches\.md$/)
  assert.match(focusWords('vibe-there-yes', { to: 'Partner', goal, thread: 'talks/benches.md' }).text, /^goal definition there: yes\n/)
  // The re-check names the goal definition's lines under their new name.
  assert.match(focusWords('goal-recheck', { to: 'Partner', goal, thread: 'talks/benches.md', job: 'roles/partner.md' }).text, /\nGoal definition: you sit down without thinking\nYour job: /)
})
