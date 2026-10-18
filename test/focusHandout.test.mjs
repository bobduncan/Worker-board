// Focus 4, seen live: the partner made the focus goal's steps and asked the main chat to queue them, and the person sat
// on the Focus page with every part "Next". A part whose steps are made but none handed out yet (new or refined, none
// queued or under way) now says "Waiting for the main chat to hand it out"; once such steps have waited longer than the
// grace time, a hint stands under Needs your attention with the way to the main chat. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { GRACE_MS } from '../src/config.mjs'
import { parseGoals } from '../src/goals.mjs'
import { focusState, handoutNeeds } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const focusView = (...args) => JSON.parse(JSON.stringify(made.focusView(...args)))

const GOALS = [
  'Last id: G2', 'Focus: G2', '',
  '- [~] G2 Fights you can read',
  '    Vibe: you see the damage before you click',
  '    Vibe agreed: 2026-10-18 10:00',
  '    Part: Show the damage · about 1 h · steps B1, B2',
  '    Part: Heavier hits · 2 h · steps B3',
  '    Part: The run map · 1 h · steps B4',
  '    Part: Not made yet · 1 h',
  '    How agreed: 2026-10-18 11:00', '',
].join('\n')
const step = (id, state, since = '2026-10-18 11:10', owner = null) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\n${owner === null ? '' : `Owner: ${owner}\n`}Since: ${since}\n`)
const run = items => focusState(parseGoals(GOALS), items, [], 'Game - ')
const AT = since => new Date(`${since.replace(' ', 'T')}:00`).getTime()

test('a part whose steps are made but not handed out waits for the main chat; queued or under way it does not', () => {
  const state = run([step('B1', 'refined'), step('B2', 'new', '2026-10-18 11:20'), step('B3', 'queued', '2026-10-18 11:15', 'Game - Units'), step('B4', 'in progress', '2026-10-18 11:15', 'Game - Map')])
  assert.deepEqual(state.parts.map(part => part.state), ['handout', 'next', 'now', 'next'])
  // Since when the part waits: the newest of its steps not handed out.
  assert.equal(state.parts[0].waitsSince, AT('2026-10-18 11:20'))
  assert.equal(state.parts[1].waitsSince, undefined)
})

test('the run shows "Waiting for the main chat to hand it out" in place of Next', () => {
  const state = run([step('B1', 'refined'), step('B2', 'done')])
  const view = focusView(state, { nodes: [] }, { canWrite: true })
  assert.deepEqual([view.run.parts[0].chip, view.run.parts[0].tone], ['Waiting for the main chat to hand it out', 'handout'])
  assert.equal(view.run.parts[1].chip, 'Next')
  const style = readFile(join(ROOT, 'public', 'board.css'), 'utf8')
  return style.then(text => assert.match(text, /\.focus-chip\.is-handout \{/))
})

test('steps waiting longer than the grace time: one hint under Needs your attention, with the way to the main chat', () => {
  const state = run([step('B1', 'refined', '2026-10-18 11:10'), step('B3', 'new', '2026-10-18 11:12')])
  const now = AT('2026-10-18 11:12') + GRACE_MS + 1
  const hints = handoutNeeds(state, 'Main', now)
  assert.equal(hints.length, 1)
  assert.deepEqual(
    [hints[0].kind, hints[0].from, hints[0].talk, hints[0].canAnswer, hints[0].at],
    ['handout', 'Main', 'main', false, AT('2026-10-18 11:12')],
  )
  assert.equal(hints[0].title, 'The steps of G2 wait for the main chat to hand them out')
  assert.match(hints[0].text, /Show the damage, Heavier hits/)
  // Within the grace time, without a focus, a part handed out, or no main chat: none.
  assert.deepEqual(handoutNeeds(state, 'Main', AT('2026-10-18 11:10') + GRACE_MS - 1), [])
  assert.deepEqual(handoutNeeds(null, 'Main', now), [])
  assert.deepEqual(handoutNeeds(run([step('B1', 'queued', '2026-10-18 11:10', 'Game - Units')]), 'Main', now), [])
  assert.deepEqual(handoutNeeds(state, null, now), [])
  // The page knows the kind, and its button opens the talk with the main chat.
  assert.match(script, /handout: \{ sign: '!', tag: 'Waits for the main chat' \}/)
  assert.match(script, /need\.kind === 'unfiled' \|\| need\.kind === 'idle' \|\| need\.kind === 'handout'/)
  const stateFile = readFile(join(ROOT, 'src', 'state.mjs'), 'utf8')
  return stateFile.then(text => assert.match(text, /\.\.\.handoutNeeds\(focus, /))
})

test('the review\'s findings: a step the main chat queued before its refine waits for its refine, and no hint is for the person', () => {
  const asked = parseItem('Id: B1\nKind: step\nTitle: Step B1\nState: new\nSince: 2026-10-18 11:10\nQueue when refined: for Units; about 1 h\n')
  const state = run([asked, step('B3', 'refined', '2026-10-18 11:10')])
  assert.deepEqual(state.parts.map(part => part.state), ['refining', 'handout', 'next', 'next'])
  assert.equal(state.parts[0].waitsSince, undefined)
  const view = focusView(state, { nodes: [] }, { canWrite: true })
  assert.deepEqual([view.run.parts[0].chip, view.run.parts[0].tone], ['Waiting for its refine, then the board queues it', 'refining'])
  const later = AT('2026-10-18 11:10') + GRACE_MS + 1
  assert.deepEqual(handoutNeeds(run([asked]), 'Main', later), [])
  assert.match(handoutNeeds(state, 'Main', later)[0].text, /steps of Heavier hits,/)
})
