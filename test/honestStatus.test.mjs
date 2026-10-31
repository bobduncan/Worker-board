// 2026-10-31 (B689, the person: "B689 status is not correct somewhere. how was this caused, how do we prevent it?"; agreed:
// the board must never say someone is working on a task when nobody is). A step whose result check failed waited for its fix,
// whose own check failed too, whose fix was dropped, and which was blocked by the goal's recap: its part said "1 being fixed
// · <its builder> is on it" and its row "its fix is being checked", while its builder's card showed another task. The board
// now follows the chain to its last open link and says what that one waits for, and names a worker as on it only where its
// card shows the step, a fix in its chain or the check of one of them. Made-up ids and names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseGoals } from '../src/goals.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { reviewWaitOfStep } from '../src/work/read.mjs'
import { chainWaitOf, reviewWaitOf } from '../src/work/resultCheck.mjs'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\n${cut('calmoverview')}\n${cut('focus')}\n${cut('runchip')}\n${cut('simpleoverview')}\nObject.assign(this, { focusView, simpleSteps })`, page)
const backlogPage = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('coordinate')}\nObject.assign(this, { backlogBlocks, checkStandWords })`, backlogPage)
const plain = value => JSON.parse(JSON.stringify(value))

const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const ago = minutes => NOW - minutes * 60_000
const line = (minutes, who, words) => `- ${stamp(ago(minutes))} ${who}: ${words}`
/** A step of the store from its head fields and its sections ({ name: [lines] }). */
const item = (head, sections = {}) => parseItem([
  ...Object.entries({ Kind: 'step', Since: stamp(ago(600)), ...head }).map(([key, value]) => `${key}: ${value}`),
  ...Object.entries(sections).flatMap(([name, lines]) => ['', `## ${name}`, ...lines]),
  '',
].join('\n'))
const checked = (passed, total) => ['Evidence: pictures/check.png', ...Array.from({ length: total }, (_, at) => `- ${at < passed ? 'pass' : 'fail'}: point ${at + 1}`)]
const POINTS = ['- the pool reads round', '- the shore reads as stone', '- units stand on its cells']

const RECAP_TITLE = 'A recap of the goal: every part beside its target'
/**
 * The real case rebuilt: B40 (built by Digger) failed its check and made its fix B41 (built by Painter); B41's own check
 * (QA task B43, done) failed and made B42, which the lead dropped, blocking B41 by the recap B44 instead. B39, the part's
 * first try, was dropped. Digger works on B45, another task; Checker's card shows the recap.
 */
function realCase(edit = () => {}) {
  const all = [
    item({ Id: 'B39', Title: 'Round shapes from drawn pieces', State: 'dropped', Owner: 'Digger' }),
    item({ Id: 'B40', Title: 'Round shapes from a painted layout', State: 'review', Owner: 'Digger', Goal: 'G7' }, {
      'What we build': POINTS,
      Checked: checked(3, 6),
      History: [line(720, 'Digger', 'in progress → review'), line(719, 'server', 'check passed: merged'), line(700, 'Tester', 'result check failed: 3 of 6 points pass, score 61 of 75; fix B41 for Digger')],
    }),
    item({ Id: 'B41', Title: 'Fix: the pool reads round', State: 'review', Owner: 'Painter', 'Fix of': 'B40', 'Blocked by': 'B44', Goal: 'G7' }, {
      'What we build': POINTS,
      Checked: checked(4, 6),
      History: [line(120, 'Painter', 'in progress → review'), line(115, 'server', 'check passed: merged'), line(80, 'Checker', 'result check failed: 4 of 6 points pass, score 64 of 75; fix B42 for Painter'), line(50, 'Lead', 'blocked by B44')],
    }),
    item({ Id: 'B42', Title: 'Fix: the shore reads as stone', State: 'dropped', 'Fix of': 'B41', Since: stamp(ago(50)) }),
    item({ Id: 'B43', Title: 'Quality Assurance: B41 Fix: the pool reads round', State: 'done', Owner: 'Checker', Checks: 'B41' }),
    item({ Id: 'B44', Title: RECAP_TITLE, State: 'review', Owner: 'Checker', Goal: 'G7' }),
    item({ Id: 'B45', Title: 'Break up the wall banding', State: 'in progress', Owner: 'Digger' }),
  ]
  const byId = new Map(all.map(one => [one.head.get('Id'), one]))
  edit(byId)
  return byId
}
const card = (name, stepId) => ({ name, isLeftover: false, state: 'working', task: { stepId } })
const CARDS = [card('Digger', 'B45'), card('Checker', 'B44')]

const GOALS = [
  'Last id: G7', 'Focus: G7', '',
  '- [~] G7 Maps that read round',
  '    Vibe: round, not boxy',
  '    Vibe agreed: 2026-10-30 10:00',
  '    Part: Round shapes made of square cells · 2 h · steps B39, B40',
  '    How agreed: 2026-10-30 11:00', '',
].join('\n')
const focusOf = (items, lanes) => focusState(parseGoals(GOALS), [...items.values()], [], 'Crew - ', null, NOW, lanes)
const partOf = (items, lanes = CARDS) => {
  const state = focusOf(items, lanes)
  return { state: state.parts[0], view: plain(page.focusView(state, null)).run.parts[0], steps: state.steps }
}
const rowOf = (part, id) => part.view.steps.find(one => one.id === id)

const WAIT = `waits for its fix B41, which waits for B44 ${RECAP_TITLE}`

test('the real case: the wait words follow the chain to the recap the last fix waits for', () => {
  const items = realCase()
  const wait = reviewWaitOf(items.get('B40'), items, null, NOW)
  assert.equal(wait.text, WAIT)
  assert.deepEqual([wait.kind, wait.fix, wait.end, wait.last.kind, wait.last.blockers], ['fix', 'B41', 'B41', 'blocked', ['B44']])
  assert.equal(chainWaitOf('B40', items, null, NOW).atWork, false)
  // The Backlog's line reads the same words (the work tool's too).
  assert.equal(reviewWaitOfStep({ ok: true, items, activities: [{ name: 'Work', steps: [...items.keys()] }] }, 'B40', null, NOW), WAIT)
  // A long title is cut at a word.
  const long = realCase(byId => byId.get('B44').head.set('Title', `${RECAP_TITLE} and the old tries beside the new ones, in one page`))
  assert.match(reviewWaitOf(long.get('B40'), long, null, NOW).text, /^waits for its fix B41, which waits for B44 A recap of the goal: every part beside its target and the…$/)
})

test('the real case: no worker is on it, and the part\'s head says waiting, not being fixed', () => {
  const part = partOf(realCase())
  assert.equal(part.view.count, '0 of 2 steps finished · 1 stopped · 1 waiting')
  assert.deepEqual([part.state.owner, part.view.owner, part.state.counts.fixing, part.state.counts.waiting], [null, null, 0, 1])
  assert.doesNotMatch(JSON.stringify(part.view), /is on it/)
  const row = rowOf(part, 'B40')
  assert.deepEqual([row.state, row.tone], ['Fix waiting', 'wait'])
  assert.equal(row.line, `Check failed: 3 of 6, its fix B41 waits for B44 ${RECAP_TITLE} · built by Digger`)
  assert.doesNotMatch(row.line, /being checked/)
  // The simple view's focus column names nobody beside it either.
  const simple = plain(page.simpleSteps({ id: 'G7', stage: 'run', steps: part.steps }, CARDS, NOW)).rows.find(one => one.id === 'B40')
  assert.equal(simple.who, null)
})

test('once the recap is done nothing blocks the last fix and its own fix stays dropped: the chain stopped, as a dropped fix', () => {
  const items = realCase(byId => byId.get('B44').head.set('State', 'done'))
  assert.equal(reviewWaitOf(items.get('B40'), items, null, NOW).text, 'waits for its fix B41, which stopped: its fix B42 was dropped')
  const part = partOf(items)
  assert.equal(part.view.count, '0 of 2 steps finished · 2 stopped')
  const row = rowOf(part, 'B40')
  assert.deepEqual([row.state, row.tone], ['Fix stopped', 'stop'])
  assert.equal(row.line, 'Check failed: 3 of 6, its fix B41 stopped: its fix B42 was dropped · built by Digger')
  assert.doesNotMatch(JSON.stringify(part.view), /is on it|being fixed/)
})

test('the real case on the Backlog: built by its worker (history), in review, never "on it"; the wait names the recap', () => {
  const items = realCase()
  const step = { key: 'B40', id: 'B40', title: 'Round shapes from a painted layout', status: 'open', reviewWait: reviewWaitOf(items.get('B40'), items, null, NOW).text, reviewStand: null, item: { state: 'review', owner: 'Digger', goal: 'G7', pinned: null, queuedBy: null } }
  const [row] = plain(backlogPage.backlogBlocks({ groups: [{ name: 'Work', steps: [step] }] }, null)).find(block => block.key === 'progress').rows
  assert.deepEqual([row.who, row.state, row.step.reviewWait], ['built by Digger', 'In review', WAIT])
  assert.doesNotMatch(JSON.stringify(row), /on it|is checking/)
})

test('a worker whose card shows the fix is named as on it; without that card nobody is', () => {
  // B41 at work: in progress for Painter, its check not made yet, no block.
  const atWork = () => realCase(byId => {
    byId.delete('B42')
    byId.delete('B43')
    const fix = byId.get('B41')
    fix.head.set('State', 'in progress')
    fix.head.delete('Blocked by')
    fix.sections.delete('Checked')
    fix.sections.set('History', [line(200, 'Painter', 'taken → in progress')])
  })
  const shown = partOf(atWork(), [...CARDS, card('Painter', 'B41')])
  assert.equal(shown.view.count, '0 of 2 steps finished · 1 being fixed · 1 stopped · Painter is on it')
  assert.equal(shown.view.owner, 'Painter is on it')
  assert.equal(rowOf(shown, 'B40').line, 'Check failed: 3 of 6, its fix B41 is being worked on · Painter is on it')
  assert.equal(rowOf(shown, 'B40').state, 'Being fixed')
  // Painter's card on another task: the fix is still being fixed by the store, but nobody is named.
  const elsewhere = partOf(atWork(), [...CARDS, card('Painter', 'B99')])
  assert.equal(elsewhere.view.count, '0 of 2 steps finished · 1 being fixed · 1 stopped')
  assert.equal(rowOf(elsewhere, 'B40').line, 'Check failed: 3 of 6, its fix B41 is being worked on · built by Digger')
  // A card that shows a check of a link counts too: the worker checking the fix is on the step.
  const checking = realCase(byId => byId.set('B46', item({ Id: 'B46', Title: 'Quality Assurance: B41', State: 'in progress', Owner: 'Checker', Checks: 'B41' })))
  checking.get('B41').head.delete('Blocked by')
  assert.equal(partOf(checking, [card('Checker', 'B46')]).view.owner, 'Checker is on it')
})

test('a QA task open on the last link reads "being checked by <its owner>"; one not taken up yet is queued for its check', () => {
  const withQa = (state, owner) => realCase(byId => {
    byId.delete('B42')
    const fix = byId.get('B41')
    fix.head.delete('Blocked by')
    fix.sections.set('History', fix.sections.get('History').slice(0, 2))
    byId.set('B46', item({ Id: 'B46', Title: 'Quality Assurance: B41', State: state, Checks: 'B41', ...(owner === null ? {} : { Owner: owner }) }))
  })
  const checking = withQa('in progress', 'Checker')
  assert.equal(reviewWaitOf(checking.get('B40'), checking, null, NOW).text, 'waits for its fix B41: being checked by Checker')
  const part = partOf(checking)
  assert.equal(rowOf(part, 'B40').line, 'Check failed: 3 of 6, its fix B41 is being checked by Checker · built by Digger')
  assert.equal(rowOf(part, 'B40').state, 'Being fixed')
  assert.match(part.view.count, /1 being fixed/)
  // Given to a worker, not taken up yet: queued for its check, nobody checks it yet.
  const given = withQa('queued', 'Checker')
  assert.equal(reviewWaitOf(given.get('B40'), given, null, NOW).text, 'waits for its fix B41, which waits for its check B46, given to Checker')
  const made = withQa('refined', null)
  assert.equal(reviewWaitOf(made.get('B40'), made, null, NOW).text, 'waits for its fix B41, which waits for its check B46')
  // Done: no QA task is open, so it is not "being checked"; the fix waits for its first check.
  const done = withQa('done', 'Checker')
  done.get('B41').sections.set('History', done.get('B41').sections.get('History').slice(0, 2))
  assert.equal(reviewWaitOf(done.get('B40'), done, null, NOW).text, 'waits for its fix B41, which waits for its first check')
  assert.equal(rowOf(partOf(done), 'B40').state, 'Fix waiting')
})

test('the original builder is never "on it" unless its card shows the step', () => {
  const items = realCase()
  // Digger's card shows B45: B40 names Digger only as its builder.
  assert.match(rowOf(partOf(items), 'B40').line, / · built by Digger$/)
  // Digger's card shows B40 itself: then Digger is on it.
  const own = partOf(items, [card('Digger', 'B40')])
  assert.match(rowOf(own, 'B40').line, / · Digger is on it$/)
  assert.equal(own.view.owner, 'Digger is on it')
  // A card given the step (the board's line, not taken yet) shows it too.
  assert.equal(partOf(items, [{ name: 'Digger', isLeftover: false, givenTask: { step: { id: 'B40' } }, task: null }]).view.owner, 'Digger is on it')
  // A leftover card counts for nothing.
  assert.equal(partOf(items, [{ ...card('Digger', 'B40'), isLeftover: true }]).view.owner, null)
})

test('the Backlog: a QA task in progress that no card shows is taken, not "checking it"', () => {
  const since = new Date(2026, 9, 31, 11, 20).getTime()
  assert.equal(backlogPage.checkStandWords({ kind: 'held', since, qa: 'B46', who: 'Checker' }), 'waits for its check: B46, taken by Checker since 11:20, not on its card now')
  assert.equal(backlogPage.checkStandWords({ kind: 'working', since, qa: 'B46', who: 'Checker' }), 'B46: Checker is checking it since 11:20')
})
