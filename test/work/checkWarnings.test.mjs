// 2026-10-25 (the person: "check the work, not the wording"; the supervisor's X45, X50, X57, X67): the board's check
// refuses a report only for facts about the work. What is wording passes with a warning: it goes into the step's History
// ("check passed with warnings: ..."), is told once in its owner's `work next`, never sends the step back; a result the
// board cut passes with a warning too; the recap card's words are the board's own. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { queueFor } from '../queueFor.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { boardWarningsOf, hasNoMutantWarning } from '../../src/work/resultCheck.mjs'
import { RESULT_CHARS } from '../../src/work/recapWords.mjs'
import { checkStepWords } from '../../src/say.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 26, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Trim the wicks (for Lamplighter; about 1 h)', '- [ ] B3 Sweep the paths (for Sweeper; about 1 h)', ''].join('\n')
const ROLES = { Keeper: 'main', Lamplighter: 'worker', Sweeper: 'worker', Partner: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-check-warnings-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), freeChats: new Set(['Lamplighter', 'Sweeper']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return {
    dir, ctx, lamplighter: as('Lamplighter'), sweeper: as('Sweeper'), keeper: as('Keeper'), partner: as('Partner'),
    person: body => workApi(body, { ...ctx, as: 'person' }),
    server: body => workApi(body, { ...ctx, as: 'server' }),
  }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const history = async (dir, id) => (await item(dir, id)).sections.get('History')
const LAMP = { action: 'new', title: 'Light the garden lamps', activity: 'Lamps', goal: 'G3', text: 'Warm light on every path.', summary: 'Every path has a warm lamp.', size: '1 h', what: ['a lamp at every bench', 'warm yellow light, never white', 'Not in it: new paths'] }
const WARNINGS = ["the result names no Context: the card's Context is made from the step's summary", "the result names no Change: the card's Change is made from the report"]

/** B1 reported by the Lamplighter with a result that has a wording problem, and the board's check passed with warnings. */
async function warned(one, warnings = WARNINGS) {
  assert.equal((await one.lamplighter({ action: 'take', id: 'B1', branch: 'b1-wicks' })).ok, true)
  assert.equal((await one.lamplighter({ action: 'report', id: 'B1', result: 'The wicks are trimmed.', merged: 'abc1234' })).ok, true)
  const checked = await one.server({ action: 'check', id: 'B1', passed: true, lines: ['work in garden', 'branch gone'], warnings })
  assert.equal(checked.ok, true, checked.why)
  return checked
}

test('a check that passed with warnings closes the step as a pass does; its History says the warnings, not the lines', async () => {
  const one = await fresh()
  try {
    await warned(one)
    assert.equal(valueOf(await item(one.dir, 'B1'), 'State'), 'done')
    assert.deepEqual((await history(one.dir, 'B1')).slice(-2), [`- 2026-10-26 09:01 server: check passed with warnings: ${WARNINGS.join('; ')}`, '- 2026-10-26 09:01 server: review → done'])
    assert.deepEqual(boardWarningsOf(await item(one.dir, 'B1')), { text: WARNINGS.join('; '), isTold: false })
    // A check that failed names its faults only; warnings given to it are not kept.
    await one.sweeper({ action: 'take', id: 'B3', branch: 'b3-paths' })
    await one.sweeper({ action: 'report', id: 'B3', result: 'x', merged: 'abc1235' })
    await one.server({ action: 'check', id: 'B3', passed: false, lines: ['the branch b3-paths is still there'], warnings: ['no Context'] })
    assert.equal((await history(one.dir, 'B3')).at(-1), '- 2026-10-26 09:01 server: check failed: the branch b3-paths is still there')
    assert.equal(boardWarningsOf(await item(one.dir, 'B3')), null)
  } finally {
    await rm(one.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('work next tells the owner the warnings once, also for a step that is done; nobody else, and not the page\'s look', async () => {
  const one = await fresh()
  try {
    await warned(one)
    // Not the other worker's, not the person's look at that chat's next.
    assert.doesNotMatch((await one.sweeper({ action: 'next' })).result.text, /warnings/)
    const look = await one.person({ action: 'next', chat: 'Lamplighter' })
    assert.doesNotMatch(look.result.text, /warnings/)
    assert.equal(boardWarningsOf(await item(one.dir, 'B1')).isTold, false)
    const told = await one.lamplighter({ action: 'next' })
    assert.equal(told.ok, true, told.why)
    assert.match(told.result.text, /^Nothing is yours, Lamplighter/)
    assert.match(told.result.text, /The board's check passed these with warnings \(nothing to redo; said once\):\n- B1: the result names no Context/)
    assert.deepEqual([told.result.warned, told.result.changed], [['B1'], true])
    assert.equal((await history(one.dir, 'B1')).at(-1), '- 2026-10-26 09:01 server: check warnings told to Lamplighter (work next)')
    assert.equal(boardWarningsOf(await item(one.dir, 'B1')).isTold, true)
    // Once: the next call says nothing about it.
    const again = await one.lamplighter({ action: 'next' })
    assert.doesNotMatch(again.result.text, /warnings/)
    assert.deepEqual([again.result.warned, again.result.changed], [undefined, false])
  } finally {
    await rm(one.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a board that only shows tells nothing and marks nothing; a new report takes the old warnings away', async () => {
  const one = await fresh()
  try {
    await warned(one)
    const shown = await workApi({ action: 'next', chat: 'Lamplighter' }, { ...one.ctx, onlyShows: true })
    assert.doesNotMatch(shown.result.text, /warnings/)
    assert.equal(boardWarningsOf(await item(one.dir, 'B1')).isTold, false)
    // A step reported again has its check pending again (or failed): the earlier warnings are no longer its own.
    const stepOf = lines => ({ head: new Map([['Id', 'B9'], ['Kind', 'step']]), sections: new Map([['History', lines.map(one => `- 2026-10-26 09:0${lines.indexOf(one)} ${one}`)]]) })
    const passed = 'server: check passed with warnings: a; b'
    assert.deepEqual(boardWarningsOf(stepOf(['Worker: in progress → review', 'server: check pending', passed])), { text: 'a; b', isTold: false })
    assert.deepEqual(boardWarningsOf(stepOf([passed, 'server: check warnings told to Worker (work next)'])), { text: 'a; b', isTold: true })
    assert.equal(boardWarningsOf(stepOf([passed, 'server: check warnings told to Worker (work next)', 'Worker: reported again', 'server: check pending'])), null)
    assert.equal(boardWarningsOf(stepOf([passed, 'server: check failed: the branch b is still there'])), null)
    assert.equal(boardWarningsOf(stepOf(['server: check passed: work in garden; branch gone'])), null)
    assert.equal(boardWarningsOf(stepOf([])), null)
  } finally {
    await rm(one.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a step in review that passed with warnings stays in review for its result check; the word to the partner carries them', async () => {
  const one = await fresh()
  try {
    const made = await one.partner(LAMP)
    assert.equal(made.ok, true, made.why)
    const id = made.result.id
    assert.equal((await queueFor(one.dir, id, 'Lamplighter', { now: NOW + 60_000 })).ok, true)
    assert.equal((await one.lamplighter({ action: 'take', id, branch: 'b2-lamps' })).ok, true)
    assert.equal((await one.lamplighter({ action: 'report', id, result: 'Every path has a warm lamp.', merged: 'c0ffee1' })).ok, true)
    const noMutant = 'the change touches tests (test/lamps.test.mjs) but the result names no mutant: the result check asks for one (next time add "Tests bite: <what was undone in a copy> → <the assertion that failed>")'
    const git = await one.server({ action: 'check', id, passed: true, lines: ['work in garden'], warnings: [noMutant] })
    assert.equal(valueOf(await item(one.dir, id), 'State'), 'review')
    assert.deepEqual(git.result.resultCheck, { id, title: 'Light the garden lamps', owner: 'Lamplighter', warnings: noMutant })
    // The result check's word: the warnings, and the demand for a mutant.
    const words = checkStepWords('Partner', git.result.resultCheck, 'roles/partner.md').text
    assert.match(words, /\nBoard warnings: the change touches tests \(test\/lamps\.test\.mjs\) but the result names no mutant/)
    assert.match(words, /\nDemand: the report names no mutant for a change that touches tests: the helper makes one in a scratch copy \(never on the branch\)/)
    // Warnings of another kind add no demand; a step without warnings neither.
    const other = checkStepWords('Partner', { id, title: 'x', owner: 'y', warnings: WARNINGS.join('; ') }, 'roles/partner.md').text
    assert.match(other, /\nBoard warnings: the result names no Context/)
    assert.doesNotMatch(other, /Demand:/)
    assert.doesNotMatch(checkStepWords('Partner', { id, title: 'x', owner: 'y' }, 'roles/partner.md').text, /Board warnings|Demand:/)
    assert.equal(hasNoMutantWarning(noMutant), true)
    assert.equal(hasNoMutantWarning(WARNINGS.join('; ')), false)
  } finally {
    await rm(one.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a result over the limit is cut and the check is told how long it was; a recheck keeps it, a shorter report takes it away', async () => {
  const one = await fresh()
  try {
    await one.lamplighter({ action: 'take', id: 'B1', branch: 'b1-wicks' })
    const long = `Context: The wicks were long. Change: They are trimmed. Details: ${'word '.repeat(500)}`
    const reported = await one.lamplighter({ action: 'report', id: 'B1', result: long, merged: 'abc1234' })
    assert.equal(reported.ok, true, reported.why)
    assert.equal(reported.result.check.result.length, RESULT_CHARS)
    assert.equal(reported.result.check.cut, long.trim().length)
    assert.ok((await history(one.dir, 'B1')).some(one => one.endsWith(`server: result cut: ${long.trim().length} characters, the first ${RESULT_CHARS} kept`)))
    // The person's Check again runs the check with the same cut.
    await one.server({ action: 'check', id: 'B1', passed: false, lines: ['the branch b1-wicks is still there'] })
    const again = await one.person({ action: 'recheck', id: 'B1' })
    assert.equal(again.result.check.cut, long.trim().length)
    // A shorter report: no cut.
    const short = await one.lamplighter({ action: 'report', id: 'B1', result: 'Context: Long wicks. Change: Trimmed. Details: x', merged: 'abc1234' })
    assert.equal(short.result.check.cut, undefined)
    // Within the limit nothing is said, and nothing is cut.
    assert.equal(Object.hasOwn(short.result.check, 'cut'), false)
  } finally {
    await rm(one.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the recap card of a step is the board\'s own words: a report with files, ids and a long Context is tidied and cut', async () => {
  const one = await fresh()
  try {
    const made = await one.partner(LAMP)
    const id = made.result.id
    assert.equal((await queueFor(one.dir, id, 'Lamplighter', { now: NOW + 60_000 })).ok, true)
    await one.lamplighter({ action: 'take', id, branch: 'b2-lamps' })
    const result = `Context: The lampPost rule in src/lamps.mjs was wrong. The garden paths were dark at night. Change: Every path has a warm lamp now, see B1. Details: lamps.mjs`
    assert.equal((await one.lamplighter({ action: 'report', id, result, merged: 'c0ffee1' })).ok, true)
    const git = await one.server({ action: 'check', id, passed: true, lines: ['branch gone'], warnings: ['the Context holds file names (src/lamps.mjs), code words (lampPost): the card leaves those words out'] })
    assert.equal(git.ok, true, git.why)
    const checked = await one.partner({ action: 'checked', id, evidence: 'none (nothing on screen)', points: ['pass: a lamp at every bench', 'pass: warm yellow light, never white'] })
    assert.equal(checked.ok, true, checked.why)
    const notes = [...(await readStore(one.dir)).items.values()].filter(note => valueOf(note, 'Recap') !== null)
    assert.equal(notes.length, 1)
    assert.deepEqual([notes[0].sections.get('Context'), notes[0].sections.get('Change')], [['The garden paths were dark at night.'], ['Every path has a warm lamp now, see "Trim the wicks".']])
  } finally {
    await rm(one.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the server carries the cut and the warnings from the API to the check and back (the same way the other fields travel)', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const \{ id, branch, result, merged, touches, cut \} = done\.result\.check/)
  assert.match(server, /void runCheck\(\{ id, branch, result, merged, touches, cut, repos: knownRepos\(\) \}\)/)
  assert.match(server, /function runCheck\(\{ id, branch, result, merged, touches, cut = null, repos = knownRepos\(\) \}\)/)
  assert.match(server, /reportCheck\(\{ id, branch, result, merged, repos, run: gitRunner\(\), project: config\.project, touches, exists, fs: WORKTREE_FILES, cut \}\)/)
  // The check's outcome, warnings and all, is what the work API's `check` is given.
  assert.match(server, /workApi\(\{ action: 'check', id, \.\.\.outcome \}/)
})
