// B110: the person's approval of a step whose work is merged ticks the step, by the board itself; no chat is woken.
// B301: the board ticks it in the work store, through its API, and backlog.md follows as the store's view; it never
// edits the backlog file's lines. Made-up backlog samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { approvalLine, approvalRoute, nextWords, waitingOn } from '../src/tick.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const BACKLOG = [
  '# Backlog',
  '',
  '## Art #focus',
  '- [ ] B5 Verify: Say whether the bow is right @you',
  '- [ ] B55 Verify: Say whether the archer is right (pictures in art-inbox/archer; Game - Units) @you',
  '  Requirements:',
  '  - the bow bends',
  '',
  '  A line after a gap is not under it.',
  '- [ ] B56 The portraits (for Units; after B55; about 20 min)',
  '- [x] B57 Verify: An old one @you',
  '- [ ] B58 A step for later (for Levels; after B55 and B56)',
  '- [ ] B59 Not waiting (for Units; after B550)',
  '',
].join('\n')
const UNDER = 'Approved by you on the worker board on 2026-10-12 at 22:40.'

test('the line under the step says when, and keeps the person\'s note to one line', () => {
  const at = new Date(2026, 9, 12, 22, 40).getTime()
  assert.equal(approvalLine(at), UNDER)
  assert.equal(approvalLine(at, '  looks right,\n  thank you  '), 'Approved by you on the worker board on 2026-10-12 at 22:40: looks right, thank you')
  assert.equal(approvalLine(at, 'x'.repeat(900)).length, 'Approved by you on the worker board on 2026-10-12 at 22:40: '.length + 400)
  assert.equal(approvalLine(at, null), UNDER)
  // A note cannot become a step or a line of its own.
  assert.ok(!approvalLine(at, 'ok\n- [ ] B77 A step of my own').includes('\n'))
})

test('an approval is the board\'s to tick when the work is merged, and the worker\'s when its branch is still there', () => {
  const branches = ['main', 'feature/archer']
  assert.equal(approvalRoute(null, branches), 'tick')
  assert.equal(approvalRoute('main', branches), 'tick')
  assert.equal(approvalRoute('feature/archer', branches), 'worker')
  // Its branch is gone: merged and deleted.
  assert.equal(approvalRoute('feature/knight', branches), 'tick')
  // Git did not answer: the board cannot tell, and the approval goes to the worker as before.
  assert.equal(approvalRoute('feature/knight', null), 'worker')
  assert.equal(approvalRoute(null, null), 'tick')
})

test('the open steps of the store that waited for the approved one are named to the main chat in one line', () => {
  const { items } = storeFromText(BACKLOG)
  assert.deepEqual(waitingOn(items, 'B55'), [{ id: 'B56', worker: 'Units' }, { id: 'B58', worker: 'Levels' }])
  assert.deepEqual(waitingOn(items, 'B5'), [])
  assert.equal(nextWords('B55', waitingOn(items, 'B55')), 'B55 is approved and ticked on the worker board; no worker was woken for it. Open steps that waited for it: B56 (for Units), B58 (for Levels).')
})

// Where an approval goes, as the board's state and its page say it

const { parseConfig } = await import('../src/config.mjs')
const { buildState } = await import('./withStore.mjs')
const { readBranches } = await import('../src/folders.mjs')

test('a step for the person says where its approval goes: ticked by the board, or to its worker', () => {
  const backlogText = [
    '## Art',
    '- [ ] B60 Verify: Say whether the knight is right (Game - Units) @you',
    '- [ ] B61 Verify: Look at the archer on branch feature/archer (Game - Units) @you',
    '- [ ] B62 Verify: Look at the mage on branch feature/mage (Game - Units) @you',
    '- [ ] B63 Decide: Which bow (Game - Units) @you',
    '- [ ] B65 Do: Record the sound yourself (Game - Units) @you',
    '- [ ] B66 Do: Try the build on branch feature/archer (Game - Units) @you',
    '- [x] B64 Verify: An old one @you',
    '',
  ].join('\n')
  const build = branches => buildState({ listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [], tails: {}, planLineTexts: {}, backlogText, adviceText: null, folders: null, askTexts: [], pictureLists: {}, branches },
    { lines: [], outbox: [], runs: [], now: 1, config: { ...parseConfig('{}', {}), project: 'C:\game' } })
  const routes = state => Object.fromEntries([...state.backlogForYou, ...state.backlogClosed].map(need => [need.step, need.approval]))
  // The knight names no branch; the archer's branch is still there; the mage's is gone: merged.
  assert.deepEqual(routes(build(['main', 'feature/archer'])), { B60: 'tick', B61: 'worker', B62: 'tick', B63: null, B65: 'tick', B66: 'worker', B64: null })
  // Git did not answer: a step that names a branch goes to its worker, as before.
  assert.deepEqual(routes(build(null)), { B60: 'tick', B61: 'worker', B62: 'worker', B63: null, B65: 'tick', B66: 'worker', B64: null })
})

test('the branches are those of every repository the board knows, or nothing when git did not answer for one', async () => {
  const run = answers => async args => answers[args[1]] ?? null
  assert.deepEqual(await readBranches(['game', 'board'], run({ game: 'main\nfeature/archer\n', board: 'main\r\nfeature/tab\n' })), ['main', 'feature/archer', 'feature/tab'])
  assert.equal(await readBranches(['game', 'board'], run({ game: 'main\n' })), null)
})

test('the page says before the click where an approval or a "Done" goes', async () => {
  const { readFile: read } = await import('node:fs/promises')
  const vm = (await import('node:vm')).default
  const script = await read(new URL('../public/board.js', import.meta.url), 'utf8')
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// approve:start'), script.indexOf('// approve:end'))}\nthis.approveHint = approveHint`, page)
  assert.match(page.approveHint({ kind: 'verify', approval: 'tick', from: 'Units', branch: null }), /Approve ticks it on the backlog; nobody is woken\.$/)
  assert.match(page.approveHint({ kind: 'verify', approval: 'worker', from: 'Units', branch: 'feature/archer' }), /Approve goes to Units: its branch feature\/archer is still open\.$/)
  assert.equal(page.approveHint({ kind: 'verify', approval: null, from: 'Units' }), 'Feedback (optional when you approve)…')
  assert.match(page.approveHint({ kind: 'do', approval: 'tick', from: 'Units', branch: null }), /Done ticks it on the backlog; nobody is woken\.$/)
  assert.equal(page.approveHint({ kind: 'do', approval: 'worker', from: 'Units', branch: null }), 'A note (optional)… Done goes to Units.')
  assert.match(script, /text\.placeholder = need\.kind === 'verify' \|\| need\.kind === 'do' \? approveHint\(need\)/)
})

// The server's own path, end to end, against a made-up project folder

const { settleByBoard } = await import('../src/tick.mjs')
const { checkSay } = await import('../src/say.mjs')

const PROJECT_BACKLOG = [
  '## Art',
  '- [ ] B60 Verify: Say whether the knight is right (Game - Units) @you',
  '  Requirements:',
  '  - the helmet shines',
  '- [ ] B61 Verify: Look at the archer on branch feature/archer (Game - Units) @you',
  '- [ ] B63 Decide: Which bow (Game - Units) @you',
  '- [ ] B65 Do: Record the sound yourself (Game - Units) @you',
  '- [ ] B70 The portraits (for Units; after B60; about 20 min)',
  '- [ ] B71 The level (for Levels; after B61)',
  '',
].join('\r\n')
const AT = new Date(2026, 9, 12, 22, 40).getTime()

/** A project folder with a work store and its view, the board's state of it, and what the server hands to `settleByBoard`. */
async function project({ branches = ['main', 'feature/archer'], fresh = branches, canWrite = true, fs } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'board-project-'))
  const file = join(folder, 'backlog.md')
  const work = join(folder, 'work')
  await writeFile(file, PROJECT_BACKLOG)
  await writeStore(work, migrateBacklog(PROJECT_BACKLOG, { now: AT }), undefined, { now: AT })
  const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: AT, lastAssistantUuid: 'u' })
  const state = buildState({ listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [app('Main'), app('Units'), app('Levels')], tails: {}, planLineTexts: {}, backlogText: PROJECT_BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, branches },
    { lines: [], outbox: [], runs: [], now: AT, config: { ...parseConfig('{}', {}), project: 'C:\\game' } })
  const said = []
  const asked = { git: 0 }
  const deps = { work: canWrite ? { dir: work, viewFile: file, fs } : null, branchesNow: async () => { asked.git += 1; return fresh }, now: AT, say: async message => { said.push(message) }, newId: () => 'id-1' }
  /** What the page sends, through the same check the server runs first. */
  const answer = async body => {
    const checked = checkSay(body, state, 4000)
    assert.equal(checked.ok, true, JSON.stringify(checked))
    return settleByBoard({ id: 'm-1', at: AT, ...checked.message, state: 'waiting' }, state, deps)
  }
  return { folder, file, said, asked, answer, text: async () => (await readFile(file)).toString('utf8'), stateOf: async id => valueOf((await readStore(work)).items.get(id), 'State') }
}

test('approving a step whose work is merged ticks it in the store, its view follows, and nobody is woken; steps that waited are named to the main chat', async () => {
  const board = await project()
  try {
    const done = await board.answer({ to: 'Units', ask: 'backlog:B60', verdict: 'approve', text: ' looks right ' })
    assert.deepEqual([done.ok, done.message.state, done.message.to], [true, 'ticked', null])
    assert.equal(await board.stateOf('B60'), 'answered')
    const view = await board.text()
    assert.match(view, /^<!-- generated by the worker board from /)
    assert.match(view, /^- \[x\] B60 Verify: Say whether the knight is right \(Game - Units\) @you\n(?: {2}.*\n)*? {2}Approved by you on the worker board on 2026-10-12 at 22:40: looks right$/m)
    // One line of the board's own to the main chat, and nothing to the step's worker.
    assert.deepEqual(board.said.map(sent => [sent.to, sent.command, sent.text, sent.state, sent.verdict]), [['Main', 'next', 'B60 is approved and ticked on the worker board; no worker was woken for it. Open steps that waited for it: B70 (for Units).', 'waiting', null]])
    // Approved again from a page that had not read yet: refused, and the file stays.
    const after = await board.text()
    const again = await board.answer({ to: 'Units', ask: 'backlog:B60', verdict: 'approve', text: '' })
    assert.deepEqual([again.ok, again.status], [false, 409])
    assert.equal(await board.text(), after)
  } finally {
    await rm(board.folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('"Done" on a step only the person could do is ticked the same way, with its own word', async () => {
  const board = await project()
  try {
    const done = await board.answer({ to: 'Units', ask: 'backlog:B65', verdict: 'done', text: '' })
    assert.deepEqual([done.ok, done.message.state], [true, 'ticked'])
    assert.equal(await board.stateOf('B65'), 'answered')
    assert.match(await board.text(), /^- \[x\] B65 Do: Record the sound yourself \(Game - Units\) @you\n {2}Done by you on the worker board on 2026-10-12 at 22:40\.$/m)
    // Nobody waited for it: the main chat hears nothing.
    assert.deepEqual(board.said, [])
  } finally {
    await rm(board.folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('what is not the board\'s to settle goes to its worker as before, and neither the store nor the file is touched', async () => {
  const cases = [
    ['a step whose branch is still there', {}, { to: 'Units', ask: 'backlog:B61', verdict: 'approve', text: '' }],
    ['a rejection', {}, { to: 'Units', ask: 'backlog:B60', verdict: 'reject', text: 'the helmet is dull' }],
    ['an answer to a Decide step', {}, { to: 'Units', ask: 'backlog:B63', text: 'the long bow' }],
    ['a branch made a moment ago, which only git knows', { branches: ['main'], fresh: ['main', 'feature/archer'] }, { to: 'Units', ask: 'backlog:B61', verdict: 'approve', text: '' }],
    ['git not answering at the click, for a step that names a branch', { branches: ['main'], fresh: null }, { to: 'Units', ask: 'backlog:B61', verdict: 'approve', text: '' }],
    ['a copy of the board, or the demo', { canWrite: false }, { to: 'Units', ask: 'backlog:B60', verdict: 'approve', text: '' }],
  ]
  for (const [name, setup, body] of cases) {
    const board = await project(setup)
    try {
      assert.equal(await board.answer(body), null, name)
      assert.equal(await board.text(), PROJECT_BACKLOG, name)
      assert.deepEqual([await board.stateOf('B60'), await board.stateOf('B61')], ['open', 'open'], name)
      assert.deepEqual(board.said, [], name)
      // A copy does not even ask git: it returns before anything is read.
      if (setup.canWrite === false) assert.equal(board.asked.git, 0)
    } finally {
      await rm(board.folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
})

test('a store that cannot be written sends the approval to the worker, so it is not lost', async () => {
  const real = await import('node:fs/promises')
  const stuck = { ...real, rename: async () => { throw new Error('in use') } }
  const board = await project({ fs: stuck })
  try {
    const checked = checkSay({ to: 'Units', ask: 'backlog:B60', verdict: 'approve', text: '' }, buildState({ listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [], tails: {}, planLineTexts: {}, backlogText: PROJECT_BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, branches: ['main'] },
      { lines: [], outbox: [], runs: [], now: AT, config: { ...parseConfig('{}', {}), project: 'C:\\game' } }), 4000)
    // No chat is on that made-up board, so the check has nobody to send to: the step itself is what matters here.
    assert.equal(checked.ok, false)
    const state = { backlogForYou: [{ id: 'backlog:B60', kind: 'verify', approval: 'tick', branch: null }], restart: { main: 'Main' } }
    const done = await settleByBoard({ ask: 'backlog:B60', step: 'B60', verdict: 'approve', text: '' }, state, { work: { dir: join(board.folder, 'work'), viewFile: board.file, fs: stuck }, branchesNow: async () => ['main'], now: AT, say: async () => {}, newId: () => 'x' })
    assert.equal(done, null)
    assert.equal(await board.text(), PROJECT_BACKLOG)
    assert.equal(await board.stateOf('B60'), 'open')
    assert.deepEqual(await readdir(board.folder), ['backlog.md', 'work'])
  } finally {
    await rm(board.folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
