// B856: the Bugs tab, as far as it is data and the filing of a report: the checks of what the page sends, the words of
// the step, where it is filed, the pictures moved into the step's own folder, and the list of reports with their state.
// A real store and real files in a temporary folder; made-up samples only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile, copyFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BUG_LIMITS, BUG_MARK, bugPlace, bugStateOf, bugTitle, bugsList, bugsState, checkBug, fileBug, isWaitingPicture } from '../src/bugs.mjs'
import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const NOW = new Date(2026, 9, 31, 13, 0).getTime()
const WAITING = 'art-inbox/bugs/_new/0123456789abcdef.png'
const WAITING_2 = 'art-inbox/bugs/_new/fedcba9876543210.jpg'
const ctx = { canSend: true, pictures: 'art-inbox', game: 'Lava Tactics' }
const report = (more = {}) => ({ action: 'report', wrong: 'The move squares are cut in half', expected: 'Whole squares', where: 'game', pictures: [WAITING], ...more })

test('a report: the person\'s words, where, the pictures under the step\'s own id, and the mark the list finds it by', () => {
  const checked = checkBug(report(), ctx)
  assert.equal(checked.ok, true)
  assert.equal(checked.title, 'Bug: The move squares are cut in half')
  assert.deepEqual(checked.lines, [
    'What is wrong: The move squares are cut in half',
    'What was expected: Whole squares',
    "The person's bug report, in their own words.",
    'Where: the game (Lava Tactics)',
    'Pictures: art-inbox/bugs/{step-id}/picture-1.png',
    'Reproduce it first, before any change: see it happen as the person did, then fix it.',
    BUG_MARK,
  ])
  assert.equal(checked.picture, 'art-inbox/bugs/{step-id}/picture-1.png')
  assert.deepEqual(checked.from, [WAITING])
  // A board bug is a fix; a game bug is not. Two pictures keep their order and their kind.
  assert.equal(checked.isFix, false)
  const two = checkBug(report({ where: 'board', pictures: [WAITING, WAITING_2], expected: '' }), ctx)
  assert.equal(two.isFix, true)
  assert.deepEqual(two.targets, ['art-inbox/bugs/{step-id}/picture-1.png', 'art-inbox/bugs/{step-id}/picture-2.jpg'])
  assert.ok(two.lines.includes('Where: the worker board'))
  assert.ok(!two.lines.some(line => line.startsWith('What was expected')))
  assert.equal(checkBug(report({ pictures: [] }), ctx).picture, null)
  assert.ok(checkBug(report({ pictures: [] }), ctx).lines.includes('Pictures: none'))
})

test('a report that cannot be filed is refused with one plain line', () => {
  const why = (body, more = ctx) => { const done = checkBug(body, more); return done.ok ? null : [done.status, done.why] }
  assert.deepEqual(why(report({ wrong: '   ' })), [400, 'Say what is wrong, in one line.'])
  assert.deepEqual(why(report({ wrong: undefined })), [400, 'Say what is wrong, in one line.'])
  assert.deepEqual(why(report({ wrong: 'x'.repeat(BUG_LIMITS.wrong + 1) }))[0], 400)
  assert.deepEqual(why(report({ expected: 'x'.repeat(BUG_LIMITS.expected + 1) }))[0], 400)
  assert.deepEqual(why(report({ where: 'moon' })), [400, 'Say where it is wrong: the game or the board.'])
  assert.deepEqual(why(report({ where: undefined }))[0], 400)
  assert.deepEqual(why(report({ pictures: [WAITING, WAITING] })), [400, 'A picture is named once.'])
  assert.deepEqual(why(report({ pictures: Array.from({ length: BUG_LIMITS.pictures + 1 }, (_, n) => `art-inbox/bugs/_new/${String(n).padStart(16, '0')}.png`) })), [400, `At most ${BUG_LIMITS.pictures} pictures.`])
  assert.deepEqual(why({ action: 'nope' }), [400, 'Not a report of a bug.'])
  assert.deepEqual(why(null), [400, 'Not a report of a bug.'])
  assert.deepEqual(why(report(), { ...ctx, canSend: false, whyNot: 'This is the demo: it files nothing.' }), [409, 'This is the demo: it files nothing.'])
  // Only a picture this tab's upload kept counts: no path of the sender's own reaches the step.
  for (const path of ['C:/secret.png', '../outside.png', 'art-inbox/bugs/_new/../../x.png', 'art-inbox/ideas/_references/0123456789abcdef.png', 'art-inbox/bugs/_new/short.png', 'art-inbox/bugs/_new/0123456789abcdef.gif']) {
    assert.deepEqual(why(report({ pictures: [path] })), [400, 'A picture was not added here: add it again.'], path)
  }
  assert.deepEqual(why(report({ pictures: 'a.png' }))[0], 400)
  assert.equal(isWaitingPicture(WAITING, 'art-inbox'), true)
  assert.equal(isWaitingPicture(WAITING, 'other'), false)
})

test('the title reads back as written: no id first, no brackets at its end, cut at a word', () => {
  assert.equal(bugTitle('B855 half squares'), 'Bug: B855 half squares')
  assert.equal(bugTitle('The lane flickers (see the picture)'), 'Bug: The lane flickers')
  assert.equal(bugTitle('Thanks @you for the fix'), 'Bug: Thanks you for the fix')
  const long = bugTitle(`${'word '.repeat(60)}end`)
  assert.ok(long.length <= 'Bug: '.length + 111 && long.endsWith('…') && !long.includes(' …'))
})

test('where a report is filed: a board bug where the fixes go, a game bug where the other steps go and with no goal', () => {
  const item = (activity, more = {}) => ({ head: new Map([['Kind', 'step'], ['Activity', activity], ...Object.entries(more)]), sections: new Map() })
  const items = new Map([
    ['B1', item('Look', {})], ['B2', item('Look', {})], ['B3', item('Look', {})],
    ['B4', item('Board work', { Priority: 'fix', Goal: 'G15' })], ['B5', item('Board work', { Priority: 'fix', Goal: 'G15' })], ['B6', item('Board work', {})],
    ['B7', item('Ideas', { Priority: 'fix', Goal: 'G2' })],
  ])
  const activities = [{ name: 'Ideas' }, { name: 'Board work' }, { name: 'Look' }]
  assert.deepEqual(bugPlace('board', items, activities), { activity: 'Board work', goal: 'G15' })
  assert.deepEqual(bugPlace('game', items, activities), { activity: 'Look', goal: null })
  // Nothing to go by: the first activity; none at all: none.
  assert.deepEqual(bugPlace('board', new Map(), activities), { activity: 'Ideas', goal: null })
  assert.deepEqual(bugPlace('game', new Map(), activities), { activity: 'Ideas', goal: null })
  assert.deepEqual(bugPlace('game', new Map(), []), { activity: null, goal: null })
})

test('a step\'s state in the person\'s words: waiting, being fixed, fixed, dropped', () => {
  const states = { new: 'waiting', refined: 'waiting', queued: 'waiting', taken: 'fixing', 'in progress': 'fixing', 'waiting on you': 'fixing', review: 'fixing', done: 'fixed', dropped: 'dropped' }
  for (const [state, word] of Object.entries(states)) assert.equal(bugStateOf(state), word, state)
  assert.equal(bugStateOf('something else'), 'waiting')
})

/** A real store with one activity, and the folders of a project. */
async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'bugs-'))
  const work = join(dir, 'work')
  await writeStore(work, migrateBacklog(['# Backlog', '', '## Board work', '- [ ] B1 An old board fix', '', '## Look', '- [ ] B2 A look step', ''].join('\n'), { now: NOW }), undefined, { now: NOW })
  await mkdir(join(dir, 'art-inbox', 'bugs', '_new'), { recursive: true })
  const put = async (path, text = 'png') => { await writeFile(join(dir, ...path.split('/')), text); return path }
  const files = { stat, mkdir, rename, copyFile, rm }
  const send = (body, more = {}) => fileBug(body, {
    ctx, read: () => readStore(work), abs: path => join(dir, ...path.split('/')), files,
    make: call => workApi(call, { dir: work, now: NOW + 60_000, as: 'person' }), ...more,
  })
  return { dir, work, put, send, item: async id => (await readStore(work)).items.get(id), exists: path => stat(join(dir, ...path.split('/'))).then(() => true, () => false) }
}

test('filing a board bug: a step marked a fix, the person\'s words, the first picture as its picture, the pictures moved to the step\'s folder', async () => {
  const p = await project()
  try {
    await p.put(WAITING, 'first')
    await p.put(WAITING_2, 'second')
    const done = await p.send(report({ where: 'board', pictures: [WAITING, WAITING_2] }))
    assert.equal(done.ok, true, done.why)
    const id = done.result.step
    const step = await p.item(id)
    assert.equal(valueOf(step, 'Priority'), 'fix')
    assert.equal(valueOf(step, 'Title'), 'Bug: The move squares are cut in half')
    assert.equal(valueOf(step, 'State'), 'new')
    const context = step.sections.get('Context').map(line => line.trim())
    assert.ok(context.includes('What is wrong: The move squares are cut in half'))
    assert.ok(context.includes(`Pictures: art-inbox/bugs/${id}/picture-1.png, art-inbox/bugs/${id}/picture-2.jpg`))
    assert.ok(context.includes('Where: the worker board'))
    assert.deepEqual(step.sections.get('Picture'), [`art-inbox/bugs/${id}/picture-1.png`])
    // The files are where the step says; nothing waits in the waiting folder any more.
    assert.equal(await readFile(join(p.dir, 'art-inbox', 'bugs', id, 'picture-1.png'), 'utf8'), 'first')
    assert.equal(await readFile(join(p.dir, 'art-inbox', 'bugs', id, 'picture-2.jpg'), 'utf8'), 'second')
    assert.deepEqual(await readdir(join(p.dir, 'art-inbox', 'bugs', '_new')), [])
    // And the list finds it, waiting, with its picture.
    const listed = bugsList((await readStore(p.work)).items)
    assert.deepEqual(listed.map(one => [one.id, one.wrong, one.expected, one.where, one.state, one.picture]), [[id, 'The move squares are cut in half', 'Whole squares', 'board', 'waiting', `art-inbox/bugs/${id}/picture-1.png`]])
    assert.deepEqual(listed[0].pictures, [`art-inbox/bugs/${id}/picture-1.png`, `art-inbox/bugs/${id}/picture-2.jpg`])
  } finally {
    await rm(p.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('filing a game bug: a normal step with no fix mark and no goal', async () => {
  const p = await project()
  try {
    const done = await p.send(report({ pictures: [], expected: '' }))
    assert.equal(done.ok, true, done.why)
    const step = await p.item(done.result.step)
    assert.equal(valueOf(step, 'Priority'), null)
    assert.equal(valueOf(step, 'Goal'), null)
    assert.equal(step.sections.get('Picture'), undefined)
    assert.ok(step.sections.get('Context').some(line => line.trim() === 'Where: the game (Lava Tactics)'))
    assert.deepEqual(bugsList((await readStore(p.work)).items).map(one => [one.where, one.picture]), [['game', null]])
  } finally {
    await rm(p.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a board bug goes where the earlier board fixes went, with their goal', async () => {
  const p = await project()
  try {
    const old = (await readStore(p.work)).items.get('B1')
    old.head.set('Priority', 'fix')
    old.head.set('Goal', 'G15')
    const { writeItem } = await import('../src/work/store.mjs')
    assert.equal((await writeItem(p.work, old)).ok, true)
    const done = await p.send(report({ where: 'board', pictures: [] }))
    assert.equal(done.ok, true, done.why)
    const step = await p.item(done.result.step)
    assert.deepEqual([valueOf(step, 'Activity'), valueOf(step, 'Goal'), valueOf(step, 'Priority')], ['Board work', 'G15', 'fix'])
  } finally {
    await rm(p.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('nothing is filed for an empty "what is wrong", a picture that is gone, or a board that cannot write; no step is made', async () => {
  const p = await project()
  try {
    const before = (await readStore(p.work)).items.size
    assert.equal((await p.send(report({ wrong: '' }))).status, 400)
    // A picture the board no longer holds: the person adds it again.
    const gone = await p.send(report())
    assert.deepEqual([gone.ok, gone.status, gone.why], [false, 409, 'A picture is not there any more: take it away and add it again.'])
    assert.equal((await p.send(report(), { ctx: { ...ctx, canSend: false, whyNot: 'This board only shows.' } })).status, 409)
    assert.equal((await readStore(p.work)).items.size, before)
  } finally {
    await rm(p.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a picture that cannot be moved leaves the step filed and says where the picture is', async () => {
  const p = await project()
  try {
    await p.put(WAITING)
    const broken = { stat, mkdir, rename: async () => { throw new Error('locked') }, copyFile: async () => { throw new Error('locked') }, rm }
    const done = await p.send(report(), { files: broken })
    assert.equal(done.ok, false)
    assert.equal(done.status, 500)
    assert.match(done.why, /^The step B\d+ was filed, but its pictures could not be moved into art-inbox\/bugs\/B\d+: look for them in art-inbox\/bugs\/_new\.$/)
    assert.ok(await p.exists(WAITING))
  } finally {
    await rm(p.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the work API: a new step keeps a picture of its own and fills in its own id where the token stands', async () => {
  const p = await project()
  try {
    const as = (body, more = {}) => workApi(body, { dir: p.work, now: NOW + 60_000, as: 'person', ...more })
    const made = await as({ action: 'new', title: 'With a picture', activity: 'Look', text: 'Pictures: art-inbox/bugs/{step-id}/a.png', picture: 'art-inbox/bugs/{step-id}/a.png' })
    assert.equal(made.ok, true, made.why)
    const id = made.result.id
    const step = await p.item(id)
    assert.deepEqual(step.sections.get('Picture'), [`art-inbox/bugs/${id}/a.png`])
    assert.deepEqual(step.sections.get('Context'), [`  Pictures: art-inbox/bugs/${id}/a.png`])
    const plain = await as({ action: 'new', title: 'Without', activity: 'Look' })
    assert.equal((await p.item(plain.result.id)).sections.get('Picture'), undefined)
  } finally {
    await rm(p.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the state the page draws from: the limits, the two places named for the project, the reports newest first; cannot-write says why', () => {
  const step = (id, state, wrong, where = 'the game') => ({ head: new Map([['Id', id], ['Kind', 'step'], ['State', state]]), sections: new Map([['Context', [`  What is wrong: ${wrong}`, `  Where: ${where}`, '  Pictures: none', `  ${BUG_MARK}`]]]) })
  const items = new Map([['B9', step('B9', 'done', 'old')], ['B10', step('B10', 'in progress', 'newer', 'the worker board')], ['B11', { head: new Map([['Id', 'B11'], ['Kind', 'step'], ['State', 'new']]), sections: new Map([['Context', ['  Not from the tab.']]]) }]])
  const state = bugsState({ items, canSend: true, game: 'Lava Tactics' })
  assert.deepEqual(state.places, [{ id: 'game', name: 'Lava Tactics' }, { id: 'board', name: 'Worker board' }])
  assert.deepEqual(state.limits, BUG_LIMITS)
  assert.deepEqual(state.reports.map(one => [one.id, one.state, one.where]), [['B10', 'fixing', 'board'], ['B9', 'fixed', 'game']])
  assert.deepEqual([state.canSend, state.why], [true, null])
  const cannot = bugsState({ items: undefined, canSend: false, whyNot: 'This is the demo: it files nothing.', game: '' })
  assert.deepEqual([cannot.canSend, cannot.why, cannot.reports, cannot.places[0].name], [false, 'This is the demo: it files nothing.', [], 'The game'])
})
