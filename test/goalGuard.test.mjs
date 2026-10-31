// B359: the goal guard. The person, 2026-10-18 21:18: "after a couple of attempts and it keeps failing the goal it
// will fundamentally evaluate with a higher model if the current approach is right, and might require a big rebuild to
// reach the goal. this will normally require an approval from the user, but can be automatically approved." A goal's
// failed checks since Go are counted (its steps' result checks, its re-checks); B752: a part's second failed check
// without real progress, else its third, asks the partner at once for a fundamental evaluation with what was tried, and
// it brings the person 2 or 3 other ways to pick, unless the board approves its advised way by itself (off at first,
// Q130). No model question (test/fableAsk.test.mjs). Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { evaluationsAgain, evaluationsRunning, focusMove, guardGoal } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { GUARD_ATTEMPTS, GUARD_NO_PROGRESS, evaluateWords, evaluationState, evaluationsDue, goalAttempts, guardOf, isRealProgress, needsEvaluation } from '../src/goalGuard.mjs'
import { parseConfig } from '../src/config.mjs'
import { workApi } from '../src/work/api.mjs'
import { queueFor } from './queueFor.mjs'
import { checkedBy } from './qaKit.mjs'
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
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  '  Goal definition: you sit down without thinking',
  '  Goal definition agreed: 2026-10-19 07:00',
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
  // B752: each check of the part is real progress over the one before (fewer points fail), so only the third trips.
  step('B1', 'G2', ['2026-10-19 07:00 Advisor: new → refined', '2026-10-19 07:40 Partner: result check failed: 1 of 3 points pass; fix B3 for W1', '2026-10-19 08:20 Partner: result check failed: 1 of 4 points pass; fix B4 for W1'], ['Evidence: none (no picture)', '- pass: Oak', '- fail: The seat is too high']),
  step('B4', 'G2', ['2026-10-19 08:50 Partner: result check failed: 2 of 4 points pass; fix B5 for W1', '2026-10-19 09:10 Partner: result check passed: 1 of 1 points pass'], ['Evidence: none', '- pass: The seat is lower'], { 'Fix of': 'B1' }),
  step('B7', 'G3', ['2026-10-19 08:30 Partner: result check failed: 0 of 1 points pass; fix B8 for W2']),
  // B669: the third failed check of the part Wooden benches (B1, B2 and the fix B4 of B1): the guard counts per part.
  step('B2', 'G2', ['2026-10-19 09:40 Partner: result check failed: 3 of 4 points pass; fix B6 for W1']),
]

test('a goal\'s attempts are its failed checks since Go: its steps\' result checks and its own re-checks', () => {
  const counted = goalAttempts(goal(), ITEMS)
  assert.equal(GUARD_ATTEMPTS, 3)
  assert.equal(counted.count, 4)
  assert.deepEqual(counted.failures.map(one => [one.at, one.id]), [['2026-10-19 08:20', 'B1'], ['2026-10-19 08:50', 'B4'], ['2026-10-19 09:30', 'G2'], ['2026-10-19 09:40', 'B2']])
  // What failed, for the partner: the step's failed points as its last check keeps them, a re-check's gap.
  assert.deepEqual(counted.failures.map(one => one.text), ['The seat is too high', '2 of 4 points pass', 'nobody sits', '3 of 4 points pass'])
  // B752: what each tried, for the word to the partner: the step's title and its check's line.
  assert.deepEqual(counted.failures.map(one => one.title ?? null), ['Step B1', 'Step B4', null, 'Step B2'])
  assert.equal(counted.failures[1].summary, '2 of 4 points pass')
  // Go again (a new How agreed) starts the count anew.
  assert.equal(goalAttempts(goal(MAP.replace('How agreed: 2026-10-19 08:00', 'How agreed: 2026-10-19 09:00')), ITEMS).count, 2)
  // B450: before its how is agreed the count starts at the goal's first refined step.
  const noHow = goalAttempts(goal(MAP.replace('  How agreed: 2026-10-19 08:00\n', '')), ITEMS)
  assert.deepEqual([noHow.count, noHow.since], [6, '2026-10-19 07:00'])
})

test('the third attempt fires the guard once: not for a goal done, not twice while the evaluation runs', () => {
  assert.equal(needsEvaluation(goal(), ITEMS), true)
  assert.equal(goalAttempts(goal(), ITEMS).tripped.trip.reason, 'third')
  assert.equal(needsEvaluation(goal(), ITEMS.slice(1)), false, 'two attempts, the second real progress')
  const asked = MAP.replace('  How agreed: 2026-10-19 08:00\n', '  How agreed: 2026-10-19 08:00\n  Evaluation asked: 2026-10-19 09:31\n')
  assert.equal(goal(asked).evaluationAsked, '2026-10-19 09:31')
  assert.equal(needsEvaluation(goal(asked), ITEMS), false)
  assert.equal(needsEvaluation(goal(MAP.replace('- [~] G2', '- [x] G2')), ITEMS), false)
})

// B752 (the person, 2026-10-28: "after 2 attempts without significantly improvements it goes back to the person who
// managed the goals"): the second failed check of a part trips the guard when it is no real progress over the first.
test('B752: two failed checks without real progress trip the guard; with real progress it waits for the third', () => {
  assert.equal(GUARD_NO_PROGRESS, 2)
  const fail = (at, line) => `2026-10-19 ${at} Partner: result check failed: ${line}`
  const two = (first, second) => [step('B1', 'G2', [fail('08:20', first)]), step('B2', 'G2', [fail('08:50', second)])]
  const tripOf = items => goalAttempts(goal(MAP.replace(/  Rechecked[^\n]*\n/g, '')), items).tripped?.trip ?? null
  // The same points fail again, or more of them: no progress.
  assert.deepEqual(tripOf(two('2 of 4 points pass; fix B3', '2 of 4 points pass; fix B4')), { at: '2026-10-19 08:50', reason: 'no progress' })
  assert.deepEqual(tripOf(two('3 of 4 points pass', '1 of 4 points pass')), { at: '2026-10-19 08:50', reason: 'no progress' })
  // Fewer fail while the share that passes holds: progress, so the guard waits.
  assert.equal(tripOf(two('1 of 4 points pass', '3 of 4 points pass')), null)
  assert.equal(tripOf(two('7 of 9 points pass', '9 of 10 points pass')), null)
  // Fewer fail but the share drops (a smaller fix with its own points): no progress.
  assert.notEqual(tripOf(two('3 of 5 points pass', '1 of 3 points pass')), null)
  // A standard's score that rose by 5 or more is progress, by less it is not.
  assert.equal(isRealProgress({ summary: '6 of 9 points pass, score 61 of 75' }, { summary: '6 of 9 points pass, score 66 of 75' }), true)
  assert.equal(isRealProgress({ summary: '6 of 9 points pass, score 61 of 75' }, { summary: '6 of 9 points pass, score 64 of 75' }), false)
  // A no to a look, or a line without numbers, is no progress.
  assert.equal(isRealProgress({ summary: '1 of 3 points pass' }, { summary: '' }), false)
  assert.equal(isRealProgress(undefined, { summary: '3 of 3 points pass' }), false)
  // One failed check alone never trips.
  assert.equal(tripOf([step('B1', 'G2', [fail('08:20', '0 of 4 points pass')])]), null)
})

test('the Focus page reads the guard: attempts so far, evaluating, a rebuild that waits for the person', () => {
  assert.deepEqual(guardOf(goal(), ITEMS.slice(1), []), { attempts: 2, parts: [{ title: 'Wooden benches', count: 2 }, { title: 'Whole goal', count: 1 }], of: 3, state: 'counting', ask: null })
  const asked = goal(MAP.replace('  How agreed: 2026-10-19 08:00\n', '  How agreed: 2026-10-19 08:00\n  Evaluation asked: 2026-10-19 09:31\n'))
  assert.deepEqual(guardOf(asked, ITEMS, []), { attempts: 3, parts: [{ title: 'Wooden benches', count: 3 }, { title: 'Whole goal', count: 1 }], of: 3, state: 'evaluating', ask: null })
  assert.deepEqual(guardOf(asked, ITEMS, [ask('Q9', 'G2', 'Rebuild G2: benches of stone instead of wood?')]), { attempts: 3, parts: [{ title: 'Wooden benches', count: 3 }, { title: 'Whole goal', count: 1 }], of: 3, state: 'rebuild', ask: 'Q9' })
  // Another ask, an answered one, or one of another goal is no rebuild waiting.
  assert.equal(guardOf(asked, ITEMS, [ask('Q8', 'G2', 'Which oak?'), ask('Q9', 'G2', 'Rebuild G2: stone?', 'answered'), ask('Q10', 'G3', 'Rebuild G3: lamps?')]).state, 'evaluating')
  // B450: no how agreed yet: the goal's failed checks count all the same.
  assert.deepEqual(guardOf(goal(MAP.replace('  How agreed: 2026-10-19 08:00\n', '')), ITEMS, []), { attempts: 4, parts: [{ title: 'Wooden benches', count: 4 }, { title: 'Whole goal', count: 2 }], of: 3, state: 'counting', ask: null })
})

test('the word to the partner: evaluate the goal, with what failed and whether a rebuild needs the person\'s yes', () => {
  const counted = goalAttempts(goal(), ITEMS)
  const words = evaluateWords({ to: 'Partner', goal: goal(), attempts: counted, approveRebuilds: false, job: 'D:/b/roles/partner.md' })
  assert.deepEqual([words.to, words.command, words.about], ['Partner', 'evaluate', 'G2'])
  assert.equal(words.text, [
    'evaluate G2 Benches that feel like home',
    'Attempts: 4 failed checks since Go (2026-10-19 08:00); what each tried:',
    '- B1 Step B1 (2026-10-19 08:20): The seat is too high',
    '- B4 Step B4 (2026-10-19 08:50): 2 of 4 points pass',
    '- G2 re-check (2026-10-19 09:30): nobody sits',
    '- B2 Step B2 (2026-10-19 09:40): 3 of 4 points pass',
    'Next steps: refine every next step of G2 with Effort: high until the evaluation ends; its model as for any step (sonnet unless the step is hard)',
    'Your answer: 2 or 3 different ways, not this way again, each with what it changes, why it may work and its cost; one work ask of G2 (decide, its title beginning "Rebuild G2:", your advice, a picture per option where they differ in look); on the person\'s pick, its how-draft, marked',
    'Your job: D:/b/roles/partner.md, "The fundamental evaluation"',
  ].join('\n'))
  assert.match(evaluateWords({ to: 'Partner', goal: goal(), attempts: counted, approveRebuilds: true, job: 'j' }).text, /\nYour answer: 2 or 3 different ways, not this way again, [^\n]*"Approve rebuilds by itself" is on: send your advised way's how-draft, marked, make its steps, and give the person a recap of the ways and your pick\n/)
  // Never a stronger model as the answer.
  assert.doesNotMatch(words.text, /Fable|stronger model/)
  // B752: the evidence picture of a step's last check stands beside what it tried.
  const pictured = [step('B1', 'G2', ['2026-10-19 08:20 Partner: result check failed: 1 of 4 points pass; fix B4 for W1'], ['Evidence: art-inbox/b1/beside.png', '- fail: The seat is too high'])]
  assert.match(evaluateWords({ to: 'Partner', goal: goal(), attempts: goalAttempts(goal(), pictured), approveRebuilds: false, job: 'j' }).text, /\n- B1 Step B1 \(2026-10-19 08:20\), evidence art-inbox\/b1\/beside\.png: The seat is too high\n/)
})

test('B528: a goal with many long failed checks gets a word that fits the limit: the newest kept, the rest counted', () => {
  const failures = Array.from({ length: 22 }, (_, n) => ({ at: `2026-10-19 ${String(10 + Math.floor(n / 6)).padStart(2, '0')}:${String((n % 6) * 10).padStart(2, '0')}`, id: `B${100 + n}`, text: `point ${n} `.repeat(60).trim(), by: 'check' }))
  const words = evaluateWords({ to: 'Partner', goal: goal(), attempts: { count: 22, since: '2026-10-19 08:00', failures }, approveRebuilds: false, job: 'j', maxChars: 2000 })
  assert.ok(words.text.length <= 2000, `${words.text.length} characters`)
  const lines = words.text.split('\n')
  assert.equal(lines[0], 'evaluate G2 Benches that feel like home')
  assert.equal(lines[1], 'Attempts: 22 failed checks since Go (2026-10-19 08:00); what each tried:')
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

/** B752: the guard as it runs now: no ask to the person; it fires at once, on Opus at max. */
async function guardFired(id, base) {
  const fired = await guardGoal(id, base)
  assert.deepEqual([fired.ok, fired.result.fired, fired.result.mode], [true, true, 'high'], 'fired at once, no model question')
  return fired
}

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
  const base = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: ITEMS, approveRebuilds: false }
  const calm = await guardGoal('G2', { ...base, items: ITEMS.slice(1) })
  assert.deepEqual([calm.ok, calm.result.fired, calm.words], [true, false, null])
  const fired = await guardFired('G2', base)
  assert.deepEqual([fired.ok, fired.result.fired, fired.words.command, fired.words.to], [true, true, 'evaluate', 'Partner'])
  assert.equal(read(fs).evaluationAsked, '2026-10-19 10:00')
  // B752: the part that tripped is written with it, and no model line.
  assert.deepEqual([read(fs).evaluationPart, read(fs).fableAsked], ['Wooden benches', null])
  assert.equal((await guardGoal('G2', base)).result.fired, false, 'once')
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
  const fired = await guardFired('G2', { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: ITEMS })
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
// same step. No how was agreed; the guard fires at the third, the partner is told to use effort high for the next steps.
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

test('B450: a goal without a how counts its failed checks and your no to a look; B752: your no is no progress, so it fires at the second', () => {
  const counted = goalAttempts(tilesGoal(), TILE_ITEMS)
  assert.deepEqual(counted.failures.map(one => [one.at, one.id, one.by]), [['2026-10-18 15:00', 'B395', 'check'], ['2026-10-18 16:38', 'Q214', 'you'], ['2026-10-18 23:10', 'Q230', 'you']])
  assert.equal(needsEvaluation(tilesGoal(), TILE_ITEMS), true)
  assert.equal(needsEvaluation(tilesGoal(), TILE_ITEMS.slice(0, 1)), false, 'one attempt')
  assert.equal(needsEvaluation(tilesGoal(), TILE_ITEMS.slice(0, 2)), true, 'two attempts, the second your no')
  const words = evaluateWords({ to: 'Partner', goal: tilesGoal(), attempts: counted, approveRebuilds: false, job: 'j' })
  assert.match(words.text, /Attempts: 3 failed checks since its first refined step \(2026-10-18 10:00\), the newest without real progress over the one before; what each tried:\n- B395 Step B395 \(2026-10-18 15:00\): the tiles do not read\n- Q214, your no to a look \(2026-10-18 16:38\): B no, say what to change They dont look good\n- Q230, your no to a look/)
  assert.match(words.text, /\nNext steps: refine every next step of G5 with Effort: high until the evaluation ends; its model as for any step/)
  assert.doesNotMatch(words.text, /Model: opus/)
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
  const fired = await guardFired('G5', base)
  assert.equal(fired.result.fired, true)
  assert.equal(parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8')).byId.get('G5').evaluationAsked, '2026-10-19 10:00')
  // The partner's marked draft: no focus, no goal definition, no how needed; it ends the evaluation and waits for Go.
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

// B518: the words alone set nothing; the work tool gives the next steps of a goal in its evaluation Effort: high (2026-10-25: the model stays as given).
test('B518: after the guard fires, a step of the goal is refined and made on effort high with its model as given; a goal not in evaluation stays as it was', async () => {
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
  assert.equal((await guardFired('G5', base)).result.fired, true)
  const refined = await partner({ action: 'refine', id: 'B1', summary: 'Redraw the tiles.', goal: 'G5' })
  assert.equal(refined.ok, true, refined.why)
  assert.equal((await read('B1')).sections.get('Model')?.[0] ?? null, null, 'no model given: none is forced')
  assert.match((await read('B1')).sections.get('Effort')?.[0] ?? null, /^high · the goal guard: G5 /)
  const made = await partner({ action: 'new', title: 'Draw the tiles from a reference', activity: 'Tiles', goal: 'G5' })
  assert.equal(made.ok, true, made.why)
  assert.equal((await read(made.result.id)).sections.get('Model')?.[0] ?? null, null)
  assert.match((await read(made.result.id)).sections.get('Effort')?.[0] ?? null, /^high · /)
  // B525: an effort below high, given or earlier, is lifted; a model given stays (2026-10-25); high, xhigh and opus stay.
  const given = await partner({ action: 'new', title: 'Sweep the floor', activity: 'Tiles', goal: 'G5', model: 'sonnet: a chore', effort: 'low: a chore' })
  assert.equal((await read(given.result.id)).sections.get('Model')?.[0] ?? null, 'sonnet · a chore')
  assert.match((await read(given.result.id)).sections.get('Effort')?.[0] ?? null, /^high · the goal guard: G5 /)
  const above = await partner({ action: 'new', title: 'Paint the walls', activity: 'Tiles', goal: 'G5', model: 'opus: the walls are hard', effort: 'xhigh: the walls are hard' })
  assert.deepEqual([(await read(above.result.id)).sections.get('Model')?.[0], (await read(above.result.id)).sections.get('Effort')?.[0]], ['opus · the walls are hard', 'xhigh · the walls are hard'])
  const other = await partner({ action: 'new', title: 'Hang a lantern', activity: 'Tiles', goal: 'G3' })
  assert.equal((await read(other.result.id)).sections.get('Model')?.[0] ?? null, null)
  // The marked draft ends the evaluation; the steps made from that how are still on effort high, a plain step is not.
  const drafted = await focusMove({ command: 'how-draft', id: 'G5', parts: ['Sprites from a reference · 2 h'], partnerDecides: ['Evaluation: draw them from a Codex reference'], youDecide: [] }, { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: TILE_ITEMS, isKnown: true })
  assert.equal(drafted.ok, true, drafted.why)
  const fromHow = await partner({ action: 'new', title: 'Draw the sprites', activity: 'Tiles', goal: 'G5', summary: 'Sprites.', size: '2 h', what: ['four sprites'] })
  assert.equal(fromHow.ok, true, fromHow.why)
  assert.equal((await read(fromHow.result.id)).sections.get('Model')?.[0] ?? null, null)
  assert.match((await read(fromHow.result.id)).sections.get('Effort')?.[0] ?? null, /^high · the goal guard: G5's evaluation just ended/)
  const plain = await partner({ action: 'new', title: 'Add a crate', activity: 'Tiles', goal: 'G5' })
  assert.deepEqual([(await read(plain.result.id)).sections.get('Model')?.[0] ?? null, (await read(plain.result.id)).sections.get('Effort')?.[0] ?? null], [null, null])
  // B525: it ends at the next Go. A Go after the evaluation: a how agreed later, and the next steps are plain again.
  const evaluated = mapOf().byId.get('G5')
  assert.equal(evaluationState(evaluated), 'ended')
  assert.equal(evaluationState({ ...evaluated, howAgreed: evaluated.evaluatedAt.at(-1) }), 'ended', 'the draft of an agreed how counts as Go at the same time')
  assert.equal(evaluationState({ ...evaluated, howAgreed: '2099-01-01 00:00' }), null)
  assert.equal(evaluationState({ ...evaluated, state: 'done' }), null)
})

test('B525: a step already on sonnet and medium keeps sonnet but is lifted to effort high at its refine in a goal in evaluation, and so is its fix step', async () => {
  const fs = fakeFs({ [FILE]: latin(TILES) })
  const base = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: TILE_ITEMS }
  const mapOf = () => parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8'))
  const dir = await mkdtemp(join(tmpdir(), 'guard-'))
  const at = new Date(2026, 9, 19, 12, 0).getTime()
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Tiles', '- [ ] B1 Redraw the tiles', '- [ ] B2 Sort the crates', '- [ ] B3 Mop the floor', '- [ ] B4 Hang a lantern', ''].join('\n'), { now: at }), undefined, { now: at })
  const ctx = { dir, now: at + 60_000, prefix: '', roleOf: chat => ({ Partner: 'advisor', Keeper: 'main', Painter: 'worker', Checker: 'worker' })[chat] ?? null, freeChats: new Set(['Painter']), chats: ['Partner', 'Keeper', 'Painter', 'Checker'], evaluationOf: id => evaluationState(mapOf().byId.get(id)) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  // T9.1.1: the result check is filed by the worker that holds the step's QA task, a worker that did not build it.
  const checkedAs = (id, body) => checkedBy({ as, server: call => workApi(call, { ...ctx, as: 'server' }), dir, now: at + 60_000 }, id, body)
  const read = async id => (await readStore(dir)).items.get(id)
  const line = async (id, key) => (await read(id)).sections.get(key)?.[0] ?? null
  // Refined before the evaluation, on sonnet and medium; the evaluation then runs.
  assert.equal((await as('Partner')({ action: 'refine', id: 'B1', summary: 'Redraw the tiles.', goal: 'G5', model: 'sonnet: a plain redraw', effort: 'medium: a plain redraw' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', size: '30 min', id: 'B1', what: ['four tiles'] })).ok, true)
  assert.equal((await as('Partner')({ action: 'refine', id: 'B2', summary: 'Sort the crates.', goal: 'G5', model: 'sonnet: a plain chore', effort: 'medium: a plain chore' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refine', id: 'B3', summary: 'Mop the floor.', goal: 'G5', model: 'sonnet: a plain chore', effort: 'medium: a plain chore' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', size: '30 min', id: 'B3', what: ['a clean floor'] })).ok, true)
  assert.equal((await as('Partner')({ action: 'refine', id: 'B4', summary: 'Hang a lantern.', goal: 'G3', model: 'sonnet: a plain chore', effort: 'medium: a plain chore' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', size: '30 min', id: 'B4', what: ['a lantern'] })).ok, true)
  assert.match(await line('B1', 'Model') ?? '', /^sonnet · /)
  assert.match(await line('B3', 'Model') ?? '', /^sonnet · /)
  assert.equal((await guardFired('G5', base)).result.fired, true)
  // The refined call alone lifts the effort of a step still on sonnet and medium (B3 had no refine since the evaluation began); its model stays.
  assert.equal((await as('Partner')({ action: 'refined', size: '30 min', id: 'B3', what: ['a clean floor'] })).ok, true)
  assert.match(await line('B3', 'Model') ?? '', /^sonnet · a plain chore$/)
  assert.match(await line('B3', 'Effort') ?? '', /^high · the goal guard: G5 /)
  // A refine that gives sonnet and medium: the effort is lifted, not obeyed; the sonnet is obeyed.
  assert.equal((await as('Partner')({ action: 'refine', id: 'B3', summary: 'Mop the floor, twice.', model: 'sonnet: a plain chore', effort: 'medium: a plain chore' })).ok, true)
  assert.match(await line('B3', 'Model') ?? '', /^sonnet · a plain chore$/)
  assert.match(await line('B3', 'Effort') ?? '', /^high · the goal guard: G5 /)
  // The refine of a step that was on sonnet and medium lifts its effort, not its model.
  const lifted = await as('Partner')({ action: 'refine', id: 'B2', summary: 'Sort the crates, again.' })
  assert.equal(lifted.ok, true, lifted.why)
  assert.match(await line('B2', 'Model') ?? '', /^sonnet · a plain chore$/)
  assert.match(await line('B2', 'Effort') ?? '', /^high · the goal guard: G5 /)
  // The refined of a step on sonnet keeps sonnet too.
  assert.equal((await as('Partner')({ action: 'refined', size: '30 min', id: 'B2', what: ['crates in rows'] })).ok, true)
  assert.match(await line('B2', 'Model') ?? '', /^sonnet · /)
  // A step given opus in a goal in evaluation stays on opus (2026-10-25: opus only where the Advisor says so).
  assert.equal((await as('Partner')({ action: 'refine', id: 'B2', summary: 'Sort the crates, hard.', model: 'opus: a hard sort' })).ok, true)
  assert.match(await line('B2', 'Model') ?? '', /^opus · a hard sort$/)
  // The failed result check of B1, still on sonnet, makes a fix step that runs on sonnet and effort high.
  assert.equal((await queueFor(dir, 'B1', 'Painter', { now: at + 60_000 })).ok, true)
  assert.equal((await as('Painter')({ action: 'take', minutes: 30, id: 'B1', branch: 'b1-tiles' })).ok, true)
  assert.equal((await as('Painter')({ action: 'report', id: 'B1', result: 'Four tiles.', merged: 'c0ffee1' })).ok, true)
  assert.equal((await workApi({ action: 'check', id: 'B1', passed: true, lines: ['branch gone'] }, { ...ctx, as: 'server' })).ok, true)
  const checked = await checkedAs('B1', { evidence: 'none (x)', points: ['fail: the tiles do not read'] })
  assert.equal(checked.ok, true, checked.why)
  const fixId = checked.result.fix ?? (await readStore(dir)).items.keys().toArray().filter(id => id !== 'B1').at(-1)
  assert.match(await line(fixId, 'Model') ?? '', /^sonnet · /)
  assert.match(await line(fixId, 'Effort') ?? '', /^high · /)
  // A goal that is not in evaluation: the fix step of its failed check keeps the step's sonnet and medium.
  assert.equal((await queueFor(dir, 'B4', 'Painter', { now: at + 60_000 })).ok, true)
  assert.equal((await as('Painter')({ action: 'take', minutes: 30, id: 'B4', branch: 'b4-lantern' })).ok, true)
  assert.equal((await as('Painter')({ action: 'report', id: 'B4', result: 'A lantern.', merged: 'c0ffee2' })).ok, true)
  assert.equal((await workApi({ action: 'check', id: 'B4', passed: true, lines: ['branch gone'] }, { ...ctx, as: 'server' })).ok, true)
  const calmChecked = await checkedAs('B4', { evidence: 'none (x)', points: ['fail: the lantern is dark'] })
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
  const fired = await guardFired('G2', { ...base, now: NOW, items: ITEMS })
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
  assert.match(words[0].text, /^evaluate G2 Benches that feel like home \(again: asked 2026-10-19 10:00, not evaluated yet\)\nPart: Wooden benches \(steps B1, B4, B2\)[^\n]*\nAttempts: 3 failed checks of this part since Go/)
  // Not on a board that only shows, nor without a partner.
  assert.deepEqual(await again({ now: NOW + 30 * 60_000, canWrite: false }), [])
  assert.deepEqual(await again({ now: NOW + 30 * 60_000, partner: null }), [])
  // The partner's marked how-draft ends it: no word again.
  const drafted = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h'], partnerDecides: ['Evaluation: wood caps the comfort'], youDecide: [] }, ctx(fs))
  assert.equal(drafted.ok, true, drafted.why)
  assert.deepEqual(await again({ now: NOW + 90 * 60_000 }), [])
})

test('a failed check whose fix passed counts no more: a step done after its fix is no attempt (the person, 2026-10-25)', () => {
  const doneNow = ITEMS.map(item => (item.head.get('Id') === 'B4' ? { ...item, head: new Map([...item.head, ['State', 'done']]) } : item))
  const counted = goalAttempts(goal(), doneNow)
  assert.deepEqual(counted.failures.map(one => one.id), ['B1', 'G2', 'B2'])
  assert.equal(counted.count, 3)
})

/** B791: a goal's ask, as the store keeps it: open or closed, its history's last line the moment it closed. */
const rebuildAsk = (of, state, closedAt, title = `Rebuild ${of}: pick a way`) => ({
  head: new Map([['Id', 'Q9'], ['Kind', 'ask'], ['Title', title], ['State', state], ['Owner', 'Partner'], ['Asks', 'decide'], ['Of', of]]),
  sections: new Map([['History', [`- ${closedAt} person: ${state}`]]]),
})

test('B791: no word again while the goal\'s Rebuild ask waits for the person; 30 minutes after it closed, as before', () => {
  const asked = parseGoals(evaluating).nodes
  const at = minutes => new Date(2026, 9, 19, 9, 31).getTime() + minutes * 60_000
  const ids = (asks, now, outbox = []) => evaluationsDue(asked, outbox, now, asks).map(node => node.id)
  // No such ask: a word after 30 minutes (B528).
  assert.deepEqual(ids([], at(30)), ['G2'])
  // The open Rebuild ask of G2: none, however long it waits.
  assert.deepEqual(ids([rebuildAsk('G2', 'open', '2026-10-19 09:50')], at(30)), [])
  assert.deepEqual(ids([rebuildAsk('G2', 'open', '2026-10-19 09:50')], at(600)), [])
  // Answered at 10:10 (39 minutes in, so due at 69): the word goes 30 minutes after that, not before.
  const answered = [rebuildAsk('G2', 'answered', '2026-10-19 10:10')]
  assert.deepEqual(ids(answered, at(60)), [])
  assert.deepEqual(ids(answered, at(68)), [])
  assert.deepEqual(ids(answered, at(69)), ['G2'])
  // Withdrawn counts the same; a word after the answer holds the next for 30 minutes from that word.
  assert.deepEqual(ids([rebuildAsk('G2', 'withdrawn', '2026-10-19 10:10')], at(69)), ['G2'])
  assert.deepEqual(ids(answered, at(80), [{ id: 'm1', at: at(75), command: 'evaluate', about: 'G2', state: 'delivered' }]), [])
  // A Rebuild ask of another goal, one of G2 not titled Rebuild, or a closed one from before this evaluation: no effect.
  assert.deepEqual(ids([rebuildAsk('G3', 'open', '2026-10-19 09:50')], at(30)), ['G2'])
  assert.deepEqual(ids([{ ...rebuildAsk('G3', 'open', '2026-10-19 09:50', 'Rebuild G2: pick a way') }], at(30)), ['G2'])
  assert.deepEqual(ids([rebuildAsk('G2', 'open', '2026-10-19 09:50', 'Benches failed 3 times: evaluate?')], at(30)), ['G2'])
  assert.deepEqual(ids([rebuildAsk('G2', 'answered', '2026-10-18 10:10')], at(30)), ['G2'])
  // A done goal: none.
  assert.deepEqual(evaluationsDue(parseGoals(evaluating.replace('- [~] G2', '- [x] G2')).nodes, [], at(90), [rebuildAsk('G2', 'answered', '2026-10-19 10:10')]), [])
})

test('B791: evaluationsAgain reads the store, and sends nothing while a Rebuild ask is open; one word 30 minutes after it was answered', async () => {
  const fs = fakeFs({ [FILE]: latin(MAP) })
  const base = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', fs, partner: { name: 'Partner' }, job: 'j', approveRebuilds: false }
  const fired = await guardFired('G2', { ...base, now: NOW, items: ITEMS })
  const outbox = [{ id: 'm1', at: NOW + 17 * 60_000, ...fired.words, state: 'delivered' }]
  const again = (asks, now) => evaluationsAgain({ ...base, outbox, items: async () => [...ITEMS, ...asks], now })
  assert.deepEqual(await again([rebuildAsk('G2', 'open', '2026-10-19 10:05')], NOW + 60 * 60_000), [])
  const closed = [rebuildAsk('G2', 'answered', '2026-10-19 11:00')]
  assert.deepEqual(await again(closed, NOW + 89 * 60_000), [])
  assert.equal((await again(closed, NOW + 90 * 60_000)).length, 1)
})
