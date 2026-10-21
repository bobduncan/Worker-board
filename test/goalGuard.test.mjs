// B359: the goal guard. The person, 2026-10-18 21:18: "after a couple of attempts and it keeps failing the goal it
// will fundamentally evaluate with a higher model if the current approach is right, and might require a big rebuild to
// reach the goal. this will normally require an approval from the user, but can be automatically approved." A goal's
// failed checks since Go are counted (its steps' result checks, its re-checks); the third asks the partner, on high
// effort, for a fundamental evaluation; a rebuild is the person's to approve unless the board approves it by itself
// (off at first, Q130). Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluationsRunning, focusMove, guardGoal } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { GUARD_ATTEMPTS, evaluateWords, goalAttempts, guardOf, needsEvaluation } from '../src/goalGuard.mjs'
import { parseConfig } from '../src/config.mjs'

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
  step('B1', 'G2', ['2026-10-19 07:40 Partner: result check failed: 1 of 3 points pass; fix B3 for W1', '2026-10-19 08:20 Partner: result check failed: 2 of 3 points pass; fix B4 for W1'], ['Evidence: none (no picture)', '- pass: Oak', '- fail: The seat is too high']),
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
  // Before its how is agreed nothing is counted: there is nothing to evaluate yet.
  assert.equal(goalAttempts(goal(MAP.replace('  How agreed: 2026-10-19 08:00\n', '')), ITEMS).count, 0)
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
  // No how agreed yet: nothing to show.
  assert.equal(guardOf(goal(MAP.replace('  How agreed: 2026-10-19 08:00\n', '')), ITEMS, []), null)
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
    'Rebuilds: ask the person first (decide); "Approve rebuilds by itself" is off',
    'Your job: D:/b/roles/partner.md, "The fundamental evaluation"',
  ].join('\n'))
  assert.match(evaluateWords({ to: 'Partner', goal: goal(), attempts: counted, approveRebuilds: true, job: 'j' }).text, /\nRebuilds: approved by the board \("Approve rebuilds by itself" is on\): make its steps at once and give the person a recap\n/)
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
