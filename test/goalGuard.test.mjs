// B359: the goal guard. The person, 2026-10-18 21:18: "after a couple of attempts and it keeps failing the goal it
// will fundamentally evaluate with a higher model if the current approach is right, and might require a big rebuild to
// reach the goal. this will normally require an approval from the user, but can be automatically approved." A goal's
// failed checks since Go are counted (its steps' result checks, its re-checks); the third asks the partner, on high
// effort, for a fundamental evaluation; a rebuild is the person's to approve unless the board approves it by itself
// (off at first, Q130). Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { evaluationsAgain, evaluationsRunning, focusMove, guardGoal } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { GUARD_ATTEMPTS, evaluateWords, evaluationState, evaluationsDue, goalAttempts, guardOf, needsEvaluation } from '../src/goalGuard.mjs'
import { parseConfig } from '../src/config.mjs'
import { workApi } from '../src/work/api.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const step = (id, goal, history, checked = [], more = {}) => ({
  head: new Map([['Id', id], ['Kind', 'step'], ['Title', `Step ${id}`], ['State', 'in progress'], ['Goal', goal], ...Object.entries(more)]),
  sections: new Map([['History', history.map(line => `- ${line}`)], ['Checked', checked]]),
})
const ask = (id, of, title, state = 'open') => ({ head: new Map([['Id', id], ['Kind', 'ask'], ['Title', title], ['State', state], ['Of', of]]), sections: new Map() })

const MAP = [
  '# Goals',
  'Last id: G3',
  'Focus: G2',
  '',
  '- [~] G2 Benches that feel like home',
  '  Done when: five visitors sit on a bench for a minute unasked',
  '  Vibe: you sit down without thinking',
  '  Vibe agreed: 2026-10-19 07:00',
  '  Part: Wooden benches · 2 h · steps B1, B2',
  '  How agreed: 2026-10-19 08:00',
  '  Rechecked (2026-10-19 07:30, Partner): failed · 1 of 2 points pass · gap: too hard to sit on · evidence none (no picture)',
  '  Rechecked (2026-10-19 09:30, Partner): failed · 1 of 2 points pass · gap: nobody sits · evidence pictures/g2/e.png',
  '- [ ] G3 Lanterns',
  '',
].join('\n')
const goal = (text = MAP) => parseGoals(text).byId.get('G2')

const ITEMS = [
  // Before Go: not counted. After Go: two failed result checks of B1 and one of its fix B4; one of another goal's step.
  step('B1', 'G2', ['2026-10-19 07:00 Advisor: new → refined', '2026-10-19 07:40 Partner: result check failed: 1 of 3 points pass; fix B3 for W1', '2026-10-19 08:20 Partner: result check failed: 2 of 3 points pass; fix B4 for W1'], ['Evidence: none (no picture)', '- pass: Oak', '- fail: The seat is too high']),
  step('B4', 'G2', ['2026-10-19 08:50 Partner: result check failed: 0 of 1 points pass; fix B5 for W1', '2026-10-19 09:10 Partner: result check passed: 1 of 1 points pass'], ['Evidence: none', '- pass: The seat is lower']),
  step('B7', 'G3', ['2026-10-19 08:30 Partner: result check failed: 0 of 1 points pass; fix B8 for W2']),
]

test('a goal\'s attempts are its failed checks since Go: its steps\' result checks and its own re-checks', () => {
  const counted = goalAttempts(goal(), ITEMS)
  assert.equal(GUARD_ATTEMPTS, 3)
  assert.equal(counted.count, 3)
  assert.deepEqual(counted.failures.map(one => [one.at, one.id]), [['2026-10-19 08:20', 'B1'], ['2026-10-19 08:50', 'B4'], ['2026-10-19 09:30', 'G2']])
  // What failed, for the partner: the step's failed points as its last check keeps them, a re-check's gap.
  assert.deepEqual(counted.failures.map(one => one.text), ['The seat is too high', '0 of 1 points pass', 'nobody sits'])
  // Go again (a new How agreed) starts the count anew.
  assert.equal(goalAttempts(goal(MAP.replace('How agreed: 2026-10-19 08:00', 'How agreed: 2026-10-19 09:00')), ITEMS).count, 1)
  // B450: before its how is agreed the count starts at the goal's first refined step.
  const noHow = goalAttempts(goal(MAP.replace('  How agreed: 2026-10-19 08:00\n', '')), ITEMS)
  assert.deepEqual([noHow.count, noHow.since], [5, '2026-10-19 07:00'])
})

test('the third attempt fires the guard once: not for a goal done, not twice while the evaluation runs', () => {
  assert.equal(needsEvaluation(goal(), ITEMS), true)
  assert.equal(needsEvaluation(goal(), ITEMS.slice(1)), false, 'two attempts')
  const asked = MAP.replace('  How agreed: 2026-10-19 08:00\n', '  How agreed: 2026-10-19 08:00\n  Evaluation asked: 2026-10-19 09:31\n')
  assert.equal(goal(asked).evaluationAsked, '2026-10-19 09:31')
  assert.equal(needsEvaluation(goal(asked), ITEMS), false)
  assert.equal(needsEvaluation(goal(MAP.replace('- [~] G2', '- [x] G2')), ITEMS), false)
})

test('the Focus page reads the guard: attempts so far, evaluating, a rebuild that waits for the person', () => {
  assert.deepEqual(guardOf(goal(), ITEMS.slice(1), []), { attempts: 2, of: 3, state: 'counting', ask: null })
  const asked = goal(MAP.replace('  How agreed: 2026-10-19 08:00\n', '  How agreed: 2026-10-19 08:00\n  Evaluation asked: 2026-10-19 09:31\n'))
  assert.deepEqual(guardOf(asked, ITEMS, []), { attempts: 3, of: 3, state: 'evaluating', ask: null })
  assert.deepEqual(guardOf(asked, ITEMS, [ask('Q9', 'G2', 'Rebuild G2: benches of stone instead of wood?')]), { attempts: 3, of: 3, state: 'rebuild', ask: 'Q9' })
  // Another ask, an answered one, or one of another goal is no rebuild waiting.
  assert.equal(guardOf(asked, ITEMS, [ask('Q8', 'G2', 'Which oak?'), ask('Q9', 'G2', 'Rebuild G2: stone?', 'answered'), ask('Q10', 'G3', 'Rebuild G3: lamps?')]).state, 'evaluating')
  // B450: no how agreed yet: the goal's failed checks count all the same.
  assert.deepEqual(guardOf(goal(MAP.replace('  How agreed: 2026-10-19 08:00\n', '')), ITEMS, []), { attempts: 5, of: 3, state: 'counting', ask: null })
})

test('the word to the partner: evaluate the goal, with what failed and whether a rebuild needs the person\'s yes', () => {
  const counted = goalAttempts(goal(), ITEMS)
  const words = evaluateWords({ to: 'Partner', goal: goal(), attempts: counted, approveRebuilds: false, job: 'D:/b/roles/partner.md' })
  assert.deepEqual([words.to, words.command, words.about], ['Partner', 'evaluate', 'G2'])
  assert.equal(words.text, [
    'evaluate G2 Benches that feel like home',
    'Attempts: 3 failed checks since Go (2026-10-19 08:00)',
    '- B1 (2026-10-19 08:20): The seat is too high',
    '- B4 (2026-10-19 08:50): 0 of 1 points pass',
    '- G2 re-check (2026-10-19 09:30): nobody sits',
    'Next steps: refine every next step of G2 with Model: opus and Effort: high until the evaluation ends',
    'Rebuilds: ask the person first (decide); "Approve rebuilds by itself" is off',
    'Your job: D:/b/roles/partner.md, "The fundamental evaluation"',
  ].join('\n'))
  assert.match(evaluateWords({ to: 'Partner', goal: goal(), attempts: counted, approveRebuilds: true, job: 'j' }).text, /\nRebuilds: approved by the board \("Approve rebuilds by itself" is on\): make its steps at once and give the person a recap\n/)
})

test('B528: a goal with many long failed checks gets a word that fits the limit: the newest kept, the rest counted', () => {
  const failures = Array.from({ length: 22 }, (_, n) => ({ at: `2026-10-19 ${String(10 + Math.floor(n / 6)).padStart(2, '0')}:${String((n % 6) * 10).padStart(2, '0')}`, id: `B${100 + n}`, text: `point ${n} `.repeat(60).trim(), by: 'check' }))
  const words = evaluateWords({ to: 'Partner', goal: goal(), attempts: { count: 22, since: '2026-10-19 08:00', failures }, approveRebuilds: false, job: 'j', maxChars: 2000 })
  assert.ok(words.text.length <= 2000, `${words.text.length} characters`)
  const lines = words.text.split('\n')
  assert.equal(lines[0], 'evaluate G2 Benches that feel like home')
  assert.equal(lines[1], 'Attempts: 22 failed checks since Go (2026-10-19 08:00)')
  assert.match(lines[2], /^- and \d+ earlier failed checks: the goal's steps' History holds them$/)
  // The newest is kept, each line cut short; the job's line closes it.
  assert.match(words.text, /\n- B121 \(2026-10-19 13:30\): point 21 [^\n]*…\nNext steps: /)
  assert.ok(lines.filter(line => line.startsWith('- B')).every(line => line.length <= 240))
  assert.equal(lines.at(-1), 'Your job: j, "The fundamental evaluation"')
  // Without a limit given, the board's own (2000).
  assert.ok(evaluateWords({ to: 'Partner', goal: goal(), attempts: { count: 22, since: null, failures }, approveRebuilds: false, job: 'j' }).text.length <= 2000)
})

test('"Approve rebuilds by itself" is off unless the settings turn it on', () => {
  assert.equal(parseConfig('{}', {}).approveRebuilds, false)
  assert.equal(parseConfig('{"approveRebuilds": true}', {}).approveRebuilds, true)
})

// The evaluation's outcome is the partner's how-draft: the agreed how may change while it runs, and the draft is the
// new agreed how, so the count starts anew; the same how again means "keep going".
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
const FILE = 'D:/Work/p/goals.md'
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const NOW = new Date(2026, 9, 19, 10, 0).getTime()
const ctx = fs => ({ canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', brainstormDir: 'D:/Work/p/talks', brainstormFolder: 'talks', now: NOW, fs, partner: { name: 'Partner', isRunning: true }, job: 'D:/b/roles/partner.md' })
const evaluating = MAP.replace('  How agreed: 2026-10-19 08:00\n', '  How agreed: 2026-10-19 08:00\n  Evaluation asked: 2026-10-19 09:31\n')
const read = fs => parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8')).byId.get('G2')

test('while the evaluation runs the partner\'s how-draft replaces the agreed how and counts as Go', async () => {
  const fs = fakeFs({ [FILE]: latin(evaluating) })
  const done = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h', 'Cushions · 1 h'], partnerDecides: ['the stone', 'Evaluation: wood caps the comfort: stone with cushions'], youDecide: [] }, ctx(fs))
  assert.equal(done.ok, true, done.why)
  assert.equal(done.result.evaluated, true)
  const now = read(fs)
  assert.deepEqual(now.parts.map(part => part.title), ['Stone benches', 'Cushions'])
  assert.equal(now.howAgreed, '2026-10-19 10:00')
  assert.equal(now.evaluationAsked, null)
  assert.match(Buffer.from(fs.files[FILE], 'latin1').toString('utf8'), /\n {2}Evaluated \(2026-10-19 10:00\): a new how \(2 parts\) · wood caps the comfort: stone with cushions\n/)
  // The marker is not kept as a line of the how.
  assert.deepEqual(now.partnerDecides, ['the stone'])
  assert.equal(goalAttempts(now, ITEMS).count, 0)
})

test('the same how again ends the evaluation as "keep going"; without one running an agreed how stays as it is', async () => {
  const fs = fakeFs({ [FILE]: latin(evaluating) })
  const same = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Wooden benches · 2 h · steps B1, B2'], partnerDecides: ['Evaluation: the approach is right, keep going'], youDecide: [] }, ctx(fs))
  assert.equal(same.ok, true, same.why)
  assert.match(Buffer.from(fs.files[FILE], 'latin1').toString('utf8'), /\n {2}Evaluated \(2026-10-19 10:00\): the how stays/)
  assert.equal(read(fs).evaluationAsked, null)
  const calm = fakeFs({ [FILE]: latin(MAP) })
  const refused = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h'], partnerDecides: [], youDecide: [] }, ctx(calm))
  assert.equal(refused.ok, false)
  assert.equal(read(calm).howAgreed, '2026-10-19 08:00')
})

test('the board fires the guard once: "Evaluation asked" under the goal and the word to the partner; not again', async () => {
  const fs = fakeFs({ [FILE]: latin(MAP) })
  const guard = (items, extra = {}) => guardGoal('G2', { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items, approveRebuilds: false, ...extra })
  const calm = await guard(ITEMS.slice(1))
  assert.deepEqual([calm.ok, calm.result.fired, calm.words], [true, false, null])
  const fired = await guard(ITEMS)
  assert.deepEqual([fired.ok, fired.result.fired, fired.words.command, fired.words.to], [true, true, 'evaluate', 'Partner'])
  assert.equal(read(fs).evaluationAsked, '2026-10-19 10:00')
  assert.equal((await guard(ITEMS)).result.fired, false, 'once')
  // Not on a board that only shows, nor without a partner.
  const other = fakeFs({ [FILE]: latin(MAP) })
  assert.equal((await guardGoal('G2', { canWrite: false, goalsFile: FILE, now: NOW, fs: other, partner: { name: 'Partner' }, items: ITEMS })).result.fired, false)
  assert.equal((await guardGoal('G2', { canWrite: true, goalsFile: FILE, now: NOW, fs: other, partner: null, items: ITEMS })).result.fired, false)
})

test('Go on a reopened how ends an evaluation left from before', async () => {
  const reopened = evaluating.replace('  How agreed: 2026-10-19 08:00\n', '')
  const fs = fakeFs({ [FILE]: latin(reopened) })
  const done = await focusMove({ command: 'how-go', id: 'G2' }, ctx(fs))
  assert.equal(done.ok, true, done.why)
  assert.deepEqual([read(fs).howAgreed, read(fs).evaluationAsked], ['2026-10-19 10:00', null])
})

test('review: a routine draft while the evaluation runs keeps the usual rule and does not end it', async () => {
  const fs = fakeFs({ [FILE]: latin(evaluating) })
  // Follow-up steps added to the part: kept, the evaluation runs on.
  const steps = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Wooden benches · 2 h · steps B1, B2, B9'], partnerDecides: [], youDecide: [] }, ctx(fs))
  assert.equal(steps.ok, true, steps.why)
  assert.equal(steps.result.evaluated, undefined)
  assert.deepEqual([read(fs).evaluationAsked, read(fs).howAgreed], ['2026-10-19 09:31', '2026-10-19 08:00'])
  // Another how without the marker is refused, as for any agreed how.
  assert.equal((await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h'], partnerDecides: [], youDecide: [] }, ctx(fs))).ok, false)
})

test('B382: the guard fires for a goal with an agreed how after the focus moved on, and a failure in the minute of Go is not counted', async () => {
  const fs = fakeFs({ [FILE]: latin(MAP.replace('Focus: G2', 'Focus: G3')) })
  const fired = await guardGoal('G2', { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: ITEMS })
  assert.equal(fired.result.fired, true)
  assert.match(fired.words.text, /^evaluate G2 /)
  assert.equal(read(fs).evaluationAsked, '2026-10-19 10:00')
  const atGo = [step('B9', 'G2', ['2026-10-19 08:00 Partner: result check failed: 0 of 1 points pass; fix B10 for W1'])]
  assert.deepEqual(goalAttempts(goal(), atGo).failures.map(one => one.id), ['G2'], 'only the re-check after Go')
})

test('B382: a goal that is not the focus ends its evaluation with its own marked how-draft, and gets its steps', async () => {
  const fs = fakeFs({ [FILE]: latin(evaluating.replace('Focus: G2', 'Focus: G3')) })
  const done = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h'], partnerDecides: ['Evaluation: wood caps the comfort'], youDecide: [] }, ctx(fs))
  assert.equal(done.ok, true, done.why)
  assert.equal(done.result.evaluated, true)
  assert.deepEqual([read(fs).evaluationAsked, read(fs).howAgreed], [null, '2026-10-19 10:00'])
  // The changed part's steps, as at Go.
  const steps = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h · steps B11'], partnerDecides: [], youDecide: [] }, ctx(fs))
  assert.equal(steps.ok, true, steps.why)
  assert.deepEqual(read(fs).parts[0].steps, ['B11'])
  // Another how without the marker is refused, as for the focus goal.
  assert.equal((await focusMove({ command: 'how-draft', id: 'G2', parts: ['Glass benches · 3 h'], partnerDecides: [], youDecide: [] }, ctx(fs))).ok, false)
})

test('B382: a goal that is not the focus and has no agreed how is not drafted', async () => {
  const fs = fakeFs({ [FILE]: latin(MAP.replace('Focus: G2', 'Focus: G3').replace('  How agreed: 2026-10-19 08:00\n', '')) })
  const how = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h'], partnerDecides: [], youDecide: [] }, ctx(fs))
  assert.deepEqual([how.ok, how.why], [false, 'That goal is not the focus: draft only the focus goal.'])
  const vibe = await focusMove({ command: 'vibe-draft', id: 'G2', lines: ['a', 'b', 'c'] }, ctx(fs))
  assert.deepEqual([vibe.ok, vibe.why], [false, 'That goal is not the focus: draft only the focus goal.'])
})

test('B382: the evaluations that run, the focus or not, keep the partner on high effort', async () => {
  const fs = fakeFs({ [FILE]: latin(evaluating.replace('Focus: G2', 'Focus: G3')) })
  assert.deepEqual(await evaluationsRunning({ fs, goalsFile: FILE }), ['G2'])
  assert.deepEqual(await evaluationsRunning({ fs: fakeFs({ [FILE]: latin(MAP) }), goalsFile: FILE }), [])
  assert.deepEqual(await evaluationsRunning({ fs: fakeFs({}), goalsFile: FILE }), [])
})

test('B467: a goal map that cannot be read is not "none running": the error goes to the caller', async () => {
  const busy = { readFile: async () => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }) } }
  await assert.rejects(evaluationsRunning({ fs: busy, goalsFile: FILE }), /EBUSY/)
  // A move on the Focus page is not told "there is no goal map" either: the error goes on (the page gets an error).
  await assert.rejects(focusMove({ command: 'vibe-draft', id: 'G2', lines: ['a', 'b', 'c'] }, ctx(busy)), /EBUSY/)
  assert.equal((await focusMove({ command: 'vibe-draft', id: 'G2', lines: ['a', 'b', 'c'] }, ctx(fakeFs({})))).why, 'There is no goal map to write into.')
})

// B450: the crumbling tiles (G30 of the real project): a failed result check, then the person's no twice to a look of the
// same step. No how was agreed; the guard fires at the third, the partner is told to use opus and high for the next steps.
const TILES = [
  '# Goals', 'Last id: G5', 'Focus: G3', '',
  '- [ ] G5 Ground that changes', '  Done when: tiles fall and vents erupt', '',
].join('\n')
const tilesGoal = (text = TILES) => parseGoals(text).byId.get('G5')
const look = (id, of, answer, history) => ({
  head: new Map([['Id', id], ['Kind', 'ask'], ['Asks', 'look'], ['State', 'answered'], ['Of', of]]),
  sections: new Map([['Answer', answer], ['History', history.map(line => `- ${line}`)]]),
})
const TILE_ITEMS = [
  step('B395', 'G5', ['2026-10-18 10:00 Advisor: new → refined', '2026-10-18 15:00 Advisor 2: result check failed: 1 of 3 points pass; fix B396 for W5'], ['Evidence: none', '- fail: the tiles do not read']),
  look('Q214', 'B395', ['B no, say what to change', 'They dont look good'], ['2026-10-18 16:22 Worker 5: asked (look)', '2026-10-18 16:38 person: answered: B no, say what to change']),
  look('Q230', 'B395', ['Rejected. not close to the reference'], ['2026-10-18 23:10 person: answered: Rejected. not close to the reference']),
]

test('B450: a goal without a how counts its failed checks and your no to a look, and the guard fires at the third', () => {
  const counted = goalAttempts(tilesGoal(), TILE_ITEMS)
  assert.deepEqual(counted.failures.map(one => [one.at, one.id, one.by]), [['2026-10-18 15:00', 'B395', 'check'], ['2026-10-18 16:38', 'Q214', 'you'], ['2026-10-18 23:10', 'Q230', 'you']])
  assert.equal(needsEvaluation(tilesGoal(), TILE_ITEMS), true)
  assert.equal(needsEvaluation(tilesGoal(), TILE_ITEMS.slice(0, 2)), false, 'two attempts')
  const words = evaluateWords({ to: 'Partner', goal: tilesGoal(), attempts: counted, approveRebuilds: false, job: 'j' })
  assert.match(words.text, /Attempts: 3 failed checks since its first refined step \(2026-10-18 10:00\)\n- B395 \(2026-10-18 15:00\): the tiles do not read\n- Q214, your no to a look \(2026-10-18 16:38\): B no, say what to change They dont look good\n- Q230, your no to a look/)
  assert.match(words.text, /\nNext steps: refine every next step of G5 with Model: opus and Effort: high/)
})

test('B450: a yes, a look of a step of another goal or an answer by the partner is no attempt', () => {
  const yes = look('Q1', 'B395', ['A yes'], ['2026-10-18 17:00 person: answered: A yes'])
  const other = look('Q2', 'B7', ['No'], ['2026-10-18 17:00 person: answered: No'])
  const partner = look('Q3', 'B395', ['No'], ['2026-10-18 17:00 Advisor: answered: No'])
  const notNo = look('Q4', 'B395', ['Not now, later'], ['2026-10-18 17:00 person: answered: Not now'])
  assert.equal(goalAttempts(tilesGoal(), [TILE_ITEMS[0], yes, other, partner, notNo, step('B7', 'G3', [])]).count, 1)
})

test('B450: the guard fires for a goal that is not the focus and has no how, and its marked draft ends the evaluation', async () => {
  const fs = fakeFs({ [FILE]: latin(TILES) })
  const base = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: TILE_ITEMS }
  const fired = await guardGoal('G5', base)
  assert.equal(fired.result.fired, true)
  assert.equal(parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8')).byId.get('G5').evaluationAsked, '2026-10-19 10:00')
  // The partner's marked draft: no focus, no vibe, no how needed; it ends the evaluation and waits for Go.
  const drafted = await focusMove({ command: 'how-draft', id: 'G5', parts: ['Sprites from a reference · 2 h'], partnerDecides: ['Evaluation: draw them from a Codex reference'], youDecide: [] }, ctx(fs))
  assert.equal(drafted.ok, true, drafted.why)
  const now = parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8')).byId.get('G5')
  assert.deepEqual([now.evaluationAsked, now.howAgreed, now.parts.map(part => part.title)], [null, null, ['Sprites from a reference']])
  assert.match(Buffer.from(fs.files[FILE], 'latin1').toString('utf8'), /\n {2}Evaluated \(2026-10-19 10:00\): a how drafted for your Go \(1 part\) · draw them from a Codex reference\n/)
  // The count starts anew, and the guard does not fire again on the old attempts.
  assert.equal(goalAttempts(now, TILE_ITEMS).count, 0)
  assert.equal((await guardGoal('G5', base)).result.fired, false)
  // Without a running evaluation a goal that is not the focus and has no how is still not drafted.
  const calm = await focusMove({ command: 'how-draft', id: 'G5', parts: ['Other · 1 h'], partnerDecides: [], youDecide: [] }, ctx(fakeFs({ [FILE]: latin(TILES) })))
  assert.equal(calm.ok, false)
})

// B518: the words alone set nothing; the work tool gives the next steps of a goal in its evaluation Model: opus and Effort: high.
test('B518: after the guard fires, a step of the goal is refined and made on opus and high; a goal not in evaluation stays as it was', async () => {
  const fs = fakeFs({ [FILE]: latin(TILES) })
  const base = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: TILE_ITEMS }
  const mapOf = () => parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8'))
  const dir = await mkdtemp(join(tmpdir(), 'guard-'))
  const at = new Date(2026, 9, 19, 12, 0).getTime()
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Tiles', '- [ ] B1 Redraw the tiles', '- [ ] B2 Sort the crates', ''].join('\n'), { now: at }), undefined, { now: at })
  const ctx = () => ({
    dir, now: at + 60_000, prefix: '', roleOf: chat => ({ Partner: 'advisor' })[chat] ?? null, freeChats: new Set(),
    evaluationOf: id => evaluationState(mapOf().byId.get(id)),
  })
  const partner = body => workApi({ chat: 'Partner', ...body }, ctx())
  const read = async id => (await readStore(dir)).items.get(id)
  // Before the third failed attempt: no model, no effort.
  const calm = await partner({ action: 'refine', id: 'B2', summary: 'Sort the crates.', goal: 'G5' })
  assert.equal(calm.ok, true, calm.why)
  assert.deepEqual([(await read('B2')).sections.get('Model')?.[0] ?? null, (await read('B2')).sections.get('Effort')?.[0] ?? null], [null, null])
  assert.equal((await guardGoal('G5', base)).result.fired, true)
  const refined = await partner({ action: 'refine', id: 'B1', summary: 'Redraw the tiles.', goal: 'G5' })
  assert.equal(refined.ok, true, refined.why)
  assert.match((await read('B1')).sections.get('Model')?.[0] ?? null, /^opus · the goal guard: G5 is in its fundamental evaluation$/)
  assert.match((await read('B1')).sections.get('Effort')?.[0] ?? null, /^high · the goal guard: G5 /)
  const made = await partner({ action: 'new', title: 'Draw the tiles from a reference', activity: 'Tiles', goal: 'G5' })
  assert.equal(made.ok, true, made.why)
  assert.match((await read(made.result.id)).sections.get('Model')?.[0] ?? null, /^opus · /)
  assert.match((await read(made.result.id)).sections.get('Effort')?.[0] ?? null, /^high · /)
  // B525: a model below opus and an effort below high, given or earlier, are lifted; opus and xhigh stay.
  const given = await partner({ action: 'new', title: 'Sweep the floor', activity: 'Tiles', goal: 'G5', model: 'sonnet: a chore', effort: 'low: a chore' })
  assert.match((await read(given.result.id)).sections.get('Model')?.[0] ?? null, /^opus · the goal guard: G5 is in its fundamental evaluation$/)
  assert.match((await read(given.result.id)).sections.get('Effort')?.[0] ?? null, /^high · the goal guard: G5 /)
  const above = await partner({ action: 'new', title: 'Paint the walls', activity: 'Tiles', goal: 'G5', model: 'opus: the walls are hard', effort: 'xhigh: the walls are hard' })
  assert.deepEqual([(await read(above.result.id)).sections.get('Model')?.[0], (await read(above.result.id)).sections.get('Effort')?.[0]], ['opus · the walls are hard', 'xhigh · the walls are hard'])
  const other = await partner({ action: 'new', title: 'Hang a lantern', activity: 'Tiles', goal: 'G3' })
  assert.equal((await read(other.result.id)).sections.get('Model')?.[0] ?? null, null)
  // The marked draft ends the evaluation; the steps made from that how are still on opus and high, a plain step is not.
  const drafted = await focusMove({ command: 'how-draft', id: 'G5', parts: ['Sprites from a reference · 2 h'], partnerDecides: ['Evaluation: draw them from a Codex reference'], youDecide: [] }, { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: TILE_ITEMS, isKnown: true })
  assert.equal(drafted.ok, true, drafted.why)
  const fromHow = await partner({ action: 'new', title: 'Draw the sprites', activity: 'Tiles', goal: 'G5', summary: 'Sprites.', size: '2 h', what: ['four sprites'] })
  assert.equal(fromHow.ok, true, fromHow.why)
  assert.match((await read(fromHow.result.id)).sections.get('Model')?.[0] ?? null, /^opus · the goal guard: G5's evaluation just ended/)
  const plain = await partner({ action: 'new', title: 'Add a crate', activity: 'Tiles', goal: 'G5' })
  assert.deepEqual([(await read(plain.result.id)).sections.get('Model')?.[0] ?? null, (await read(plain.result.id)).sections.get('Effort')?.[0] ?? null], [null, null])
  // B525: it ends at the next Go. A Go after the evaluation: a how agreed later, and the next steps are plain again.
  const evaluated = mapOf().byId.get('G5')
  assert.equal(evaluationState(evaluated), 'ended')
  assert.equal(evaluationState({ ...evaluated, howAgreed: evaluated.evaluatedAt.at(-1) }), 'ended', 'the draft of an agreed how counts as Go at the same time')
  assert.equal(evaluationState({ ...evaluated, howAgreed: '2099-01-01 00:00' }), null)
  assert.equal(evaluationState({ ...evaluated, state: 'done' }), null)
})

test('B525: a step already on sonnet and medium is lifted at its refine in a goal in evaluation, and its fix step runs on opus and high', async () => {
  const fs = fakeFs({ [FILE]: latin(TILES) })
  const base = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: TILE_ITEMS }
  const mapOf = () => parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8'))
  const dir = await mkdtemp(join(tmpdir(), 'guard-'))
  const at = new Date(2026, 9, 19, 12, 0).getTime()
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Tiles', '- [ ] B1 Redraw the tiles', '- [ ] B2 Sort the crates', '- [ ] B3 Mop the floor', '- [ ] B4 Hang a lantern', ''].join('\n'), { now: at }), undefined, { now: at })
  const ctx = { dir, now: at + 60_000, prefix: '', roleOf: chat => ({ Partner: 'advisor', Keeper: 'main', Painter: 'worker' })[chat] ?? null, freeChats: new Set(['Painter']), chats: ['Partner', 'Keeper', 'Painter'], evaluationOf: id => evaluationState(mapOf().byId.get(id)) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  const read = async id => (await readStore(dir)).items.get(id)
  const line = async (id, key) => (await read(id)).sections.get(key)?.[0] ?? null
  // Refined before the evaluation, on sonnet and medium; the evaluation then runs.
  assert.equal((await as('Partner')({ action: 'refine', id: 'B1', summary: 'Redraw the tiles.', goal: 'G5', model: 'sonnet: a plain redraw', effort: 'medium: a plain redraw' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', id: 'B1', what: ['four tiles'] })).ok, true)
  assert.equal((await as('Partner')({ action: 'refine', id: 'B2', summary: 'Sort the crates.', goal: 'G5', model: 'sonnet: a plain chore', effort: 'medium: a plain chore' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refine', id: 'B3', summary: 'Mop the floor.', goal: 'G5', model: 'sonnet: a plain chore', effort: 'medium: a plain chore' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', id: 'B3', what: ['a clean floor'] })).ok, true)
  assert.equal((await as('Partner')({ action: 'refine', id: 'B4', summary: 'Hang a lantern.', goal: 'G3', model: 'sonnet: a plain chore', effort: 'medium: a plain chore' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', id: 'B4', what: ['a lantern'] })).ok, true)
  assert.match(await line('B1', 'Model') ?? '', /^sonnet · /)
  assert.match(await line('B3', 'Model') ?? '', /^sonnet · /)
  assert.equal((await guardGoal('G5', base)).result.fired, true)
  // The refined call alone lifts a step still on sonnet and medium (B3 had no refine since the evaluation began).
  assert.equal((await as('Partner')({ action: 'refined', id: 'B3', what: ['a clean floor'] })).ok, true)
  assert.match(await line('B3', 'Model') ?? '', /^opus · the goal guard: G5 /)
  assert.match(await line('B3', 'Effort') ?? '', /^high · the goal guard: G5 /)
  // A refine that gives sonnet and medium is lifted too, not obeyed.
  assert.equal((await as('Partner')({ action: 'refine', id: 'B3', summary: 'Mop the floor, twice.', model: 'sonnet: a plain chore', effort: 'medium: a plain chore' })).ok, true)
  assert.match(await line('B3', 'Model') ?? '', /^opus · the goal guard: G5 /)
  assert.match(await line('B3', 'Effort') ?? '', /^high · the goal guard: G5 /)
  // The refine of a step that was on sonnet and medium lifts it.
  const lifted = await as('Partner')({ action: 'refine', id: 'B2', summary: 'Sort the crates, again.' })
  assert.equal(lifted.ok, true, lifted.why)
  assert.match(await line('B2', 'Model') ?? '', /^opus · the goal guard: G5 is in its fundamental evaluation$/)
  assert.match(await line('B2', 'Effort') ?? '', /^high · the goal guard: G5 /)
  // The refined of a step on sonnet lifts it too.
  assert.equal((await as('Partner')({ action: 'refined', id: 'B2', what: ['crates in rows'] })).ok, true)
  assert.match(await line('B2', 'Model') ?? '', /^opus · /)
  // The failed result check of B1, still on sonnet, makes a fix step that runs on opus and high.
  assert.equal((await as('Keeper')({ action: 'queue', id: 'B1', for: 'Painter', about: '1 h' })).ok, true)
  assert.equal((await as('Painter')({ action: 'take', id: 'B1', branch: 'b1-tiles' })).ok, true)
  assert.equal((await as('Painter')({ action: 'report', id: 'B1', result: 'Four tiles.', merged: 'c0ffee1' })).ok, true)
  assert.equal((await workApi({ action: 'check', id: 'B1', passed: true, lines: ['branch gone'] }, { ...ctx, as: 'server' })).ok, true)
  const checked = await as('Partner')({ action: 'checked', id: 'B1', evidence: 'none (x)', points: ['fail: the tiles do not read'] })
  assert.equal(checked.ok, true, checked.why)
  const fixId = checked.result.fix ?? (await readStore(dir)).items.keys().toArray().filter(id => id !== 'B1').at(-1)
  assert.match(await line(fixId, 'Model') ?? '', /^opus · /)
  assert.match(await line(fixId, 'Effort') ?? '', /^high · /)
  // A goal that is not in evaluation: the fix step of its failed check keeps the step's sonnet and medium.
  assert.equal((await as('Keeper')({ action: 'queue', id: 'B4', for: 'Painter', about: '1 h' })).ok, true)
  assert.equal((await as('Painter')({ action: 'take', id: 'B4', branch: 'b4-lantern' })).ok, true)
  assert.equal((await as('Painter')({ action: 'report', id: 'B4', result: 'A lantern.', merged: 'c0ffee2' })).ok, true)
  assert.equal((await workApi({ action: 'check', id: 'B4', passed: true, lines: ['branch gone'] }, { ...ctx, as: 'server' })).ok, true)
  const calmChecked = await as('Partner')({ action: 'checked', id: 'B4', evidence: 'none (x)', points: ['fail: the lantern is dark'] })
  assert.equal(calmChecked.ok, true, calmChecked.why)
  const calmFix = calmChecked.result.fix ?? (await readStore(dir)).items.keys().toArray().filter(id => id !== 'B4').at(-1)
  assert.match(await line(calmFix, 'Model') ?? '', /^sonnet · /)
  assert.match(await line(calmFix, 'Effort') ?? '', /^medium · /)
})

test('B528: an evaluation that has not ended is asked again 30 minutes after its last word, a lost word included', () => {
  const asked = parseGoals(evaluating).nodes
  const at = minutes => new Date(2026, 9, 19, 9, 31).getTime() + minutes * 60_000
  // No word in the outbox (the board was restarted, or it was never kept): counted from "Evaluation asked".
  assert.deepEqual(evaluationsDue(asked, [], at(29)).map(node => node.id), [])
  assert.deepEqual(evaluationsDue(asked, [], at(30)).map(node => node.id), ['G2'])
  // The first word was refused by the chat's mod (too long, as G15's of 2026-10-24): the ask stays, the word goes again.
  const failed = [{ id: 'm1', at: at(0), command: 'evaluate', about: 'G2', state: 'failed' }]
  assert.deepEqual(evaluationsDue(asked, failed, at(10)).map(node => node.id), [])
  assert.deepEqual(evaluationsDue(asked, failed, at(31)).map(node => node.id), ['G2'])
  // A word again 5 minutes ago holds the next for 30 minutes; another goal's word does not.
  assert.deepEqual(evaluationsDue(asked, [...failed, { id: 'm2', at: at(31), command: 'evaluate', about: 'G2', state: 'delivered' }], at(36)).map(node => node.id), [])
  assert.deepEqual(evaluationsDue(asked, [...failed, { id: 'm3', at: at(31), command: 'evaluate', about: 'G3', state: 'delivered' }], at(36)).map(node => node.id), ['G2'])
  // Evaluated (no "Evaluation asked" left), or done: none.
  assert.deepEqual(evaluationsDue(parseGoals(MAP).nodes, failed, at(90)), [])
  assert.deepEqual(evaluationsDue(parseGoals(evaluating.replace('- [~] G2', '- [x] G2')).nodes, failed, at(90)), [])
})

test('B528: the board asks the partner again with "again" in the word, until the marked how-draft ends the evaluation', async () => {
  const fs = fakeFs({ [FILE]: latin(MAP) })
  const base = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', fs, partner: { name: 'Partner' }, job: 'j', approveRebuilds: false }
  const fired = await guardGoal('G2', { ...base, now: NOW, items: ITEMS })
  assert.equal(fired.result.fired, true)
  // The first word never reached the partner's chat.
  const outbox = [{ id: 'm1', at: NOW, ...fired.words, state: 'failed' }]
  let reads = 0
  const items = async () => { reads += 1; return ITEMS }
  const again = ctx => evaluationsAgain({ ...base, outbox, items, ...ctx })
  assert.deepEqual(await again({ now: NOW + 29 * 60_000 }), [])
  assert.equal(reads, 0, 'the store is read only when a word is due')
  const words = await again({ now: NOW + 30 * 60_000 })
  assert.equal(words.length, 1)
  assert.deepEqual([words[0].to, words[0].command, words[0].about], ['Partner', 'evaluate', 'G2'])
  assert.match(words[0].text, /^evaluate G2 Benches that feel like home \(again: asked 2026-10-19 10:00, not evaluated yet\)\nAttempts: 3 failed checks since Go/)
  // Not on a board that only shows, nor without a partner.
  assert.deepEqual(await again({ now: NOW + 30 * 60_000, canWrite: false }), [])
  assert.deepEqual(await again({ now: NOW + 30 * 60_000, partner: null }), [])
  // The partner's marked how-draft ends it: no word again.
  const drafted = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h'], partnerDecides: ['Evaluation: wood caps the comfort'], youDecide: [] }, ctx(fs))
  assert.equal(drafted.ok, true, drafted.why)
  assert.deepEqual(await again({ now: NOW + 90 * 60_000 }), [])
})
