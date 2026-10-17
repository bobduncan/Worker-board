// B297: the actions of the work tool and of the page on the store (spec 2026-10-17, section 5), validated by the
// flow, one History line per change. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseBacklog } from '../../src/backlog.mjs'
import { NOT_TRUTH, workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore, writeTruth } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const BACKLOG = [
  '# Backlog',
  '',
  '## Board work #focus',
  '- [ ] B1 Draw the strip (for Board; about 1 h)',
  '- [ ] B2 Keep the cards apart (for Board; after B1; about 30 min)',
  '- [ ] B3 A new idea (later; not handed out)',
  '- [ ] B4 Build the menu (for Team - Support; about 2 h) (branch feature/menu)',
  '- [ ] B5 A ready step',
  '  Refined (2026-10-17 10:00; ready):',
  '  Summary: One description.',
  '  What we build:',
  '  - the strip',
  '- [ ] B6 Verify: Is the strip right @you',
  '- [ ] B7 An unrefined step',
  '  Touches: public/board.js',
  '',
].join('\n')
const ROLES = { Main: 'main', Board: 'worker', Support: 'worker', Advisor: 'advisor' }

/** A store of the backlog above in a folder of its own; the truth unless `truth` says shadow. */
async function fresh(truth = 'store') {
  const dir = await mkdtemp(join(tmpdir(), 'work-api-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  await writeTruth(dir, { truth, since: '2026-10-17 11:05' })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board', 'Support']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, ctx, main: as('Main'), board: as('Board'), support: as('Support'), advisor: as('Advisor'), person: body => workApi(body, { ...ctx, as: 'person' }), server: body => workApi(body, { ...ctx, as: 'server' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const state = async (dir, id) => valueOf(await item(dir, id), 'State')
const history = async (dir, id) => (await item(dir, id)).sections.get('History')

test('while the store is a shadow, every change is refused and the reads answer', async () => {
  const { dir, board } = await fresh('shadow')
  try {
    assert.deepEqual(await board({ action: 'take', id: 'B1' }), { ok: false, status: 409, why: NOT_TRUTH })
    assert.equal(NOT_TRUTH, 'The store is not the truth yet: the cutover has not run')
    const next = await board({ action: 'next' })
    assert.equal(next.ok, true)
    assert.match(next.result.text, /^Yours, Board:\n- B1 queued: Draw the strip\n- B2 queued \(after B1\): Keep the cards apart\n\nId: B1\n/)
    assert.equal((await board({ action: 'list' })).result.items.length, 7)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a chat that is not in the list, and an unknown action, are refused', async () => {
  const { dir, ctx } = await fresh()
  try {
    assert.deepEqual(await workApi({ action: 'next', chat: 'Stranger' }, ctx), { ok: false, status: 403, why: 'Stranger is no chat of the list.' })
    assert.equal((await workApi({ action: 'fly', chat: 'Board' }, ctx)).status, 400)
    assert.equal((await workApi({ action: 'answer', chat: 'Board', id: 'B6', text: 'yes' }, ctx)).status, 403)
    assert.equal((await workApi({ action: 'check', chat: 'Board', id: 'B1', passed: true }, ctx)).status, 403)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('take: the board moves a queued step to taken for its chat, the chat to in progress, with the branch', async () => {
  const { dir, board } = await fresh()
  try {
    const taken = await board({ action: 'take', id: 'B1', branch: 'b1-strip' })
    assert.equal(taken.ok, true, taken.why)
    assert.equal(taken.result.title, 'Draw the strip')
    assert.equal(await state(dir, 'B1'), 'in progress')
    assert.equal(valueOf(await item(dir, 'B1'), 'Branch'), 'b1-strip')
    assert.deepEqual((await history(dir, 'B1')).slice(-2), ['- 2026-10-17 11:06 server: queued → taken (for Board)', '- 2026-10-17 11:06 Board: taken → in progress'])
    // Its step waits for B1: the flow's guard says no.
    assert.deepEqual(await board({ action: 'take', id: 'B2' }), { ok: false, status: 409, why: 'B2: "Blocked by all done and Owner free" does not hold (flow.json)' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('take twice refuses the second with the holder\'s name', async () => {
  const { dir, board, support } = await fresh()
  try {
    assert.deepEqual(await support({ action: 'take', id: 'B1' }), { ok: false, status: 409, why: 'B1 is queued for Board, not for Support.' })
    // Two takes at once: one wins, the other is told who holds it.
    const both = await Promise.all([board({ action: 'take', id: 'B1' }), support({ action: 'take', id: 'B1' })])
    assert.equal(both[0].ok, true)
    assert.deepEqual(both[1], { ok: false, status: 409, why: 'B1: Board holds it (in progress).' })
    // A step the chat holds already is no change.
    assert.equal(await support({ action: 'take', id: 'B4' }).then(done => done.result.changed), false)
    assert.deepEqual(await board({ action: 'take', id: 'B4' }), { ok: false, status: 409, why: 'B4: Team - Support holds it (in progress).' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('step writes one History line on the step the chat holds', async () => {
  const { dir, board, support } = await fresh()
  try {
    assert.equal((await board({ action: 'step', id: 'B1', step: 2 })).status, 409)
    await board({ action: 'take', id: 'B1' })
    const stepped = await board({ action: 'step', id: 'B1', step: 2, names: ['Read', 'Draw', 'Test'], minutes: 40 })
    assert.equal(stepped.result.text, 'B1: step 2/3, Draw, about 40 min left.')
    assert.equal((await history(dir, 'B1')).at(-1), '- 2026-10-17 11:06 Board: step 2/3, Draw, about 40 min left')
    assert.equal((await support({ action: 'step', id: 'B1', step: 3 })).why, 'B1 is not in progress for Support: take it first.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ask with Blocking yes moves the step to waiting on you; answer moves it back', async () => {
  const { dir, board, person } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    const asked = await board({ action: 'ask', of: 'B1', kind: 'look', blocking: 'yes', text: 'Is the strip readable at a glance?', options: ['A thin', 'B thick (I advise B)'], pictures: 'pictures/strip.png' })
    assert.equal(asked.ok, true, asked.why)
    assert.equal(asked.result.id, 'Q1')
    assert.equal(asked.result.text, [
      '> **For you**',
      '> 1. **Answer:** Is the strip readable at a glance? A thin; B thick (I advise B) (Q1, look, blocks B1)',
      '>    See the picture: pictures/strip.png',
    ].join('\n'))
    const q = await item(dir, 'Q1')
    assert.deepEqual(['Kind', 'State', 'Asks', 'Blocking', 'Of', 'Owner', 'Options'].map(key => valueOf(q, key)), ['ask', 'open', 'look', 'yes', 'B1', 'Board', 'A thin | B thick (I advise B)'])
    assert.equal(await state(dir, 'B1'), 'waiting on you')
    assert.equal((await board({ action: 'answer', id: 'Q1', text: 'B' })).status, 403)
    const answered = await person({ action: 'answer', id: 'Q1', text: 'B, thick' })
    assert.equal(answered.ok, true, answered.why)
    assert.equal(await state(dir, 'Q1'), 'answered')
    assert.equal(await state(dir, 'B1'), 'in progress')
    assert.equal((await history(dir, 'B1')).at(-1), '- 2026-10-17 11:06 server: waiting on you → in progress (Q1 answered)')
    assert.deepEqual((await item(dir, 'B1')).sections.get('Context'), ['  Asked Q1 (look, blocking): Is the strip readable at a glance?', '  Q1 answered by you on 2026-10-17 at 11:06: B, thick'])
    assert.equal((await person({ action: 'answer', id: 'Q1', text: 'again' })).why, 'Q1 is answered already.')
    // An ask that blocks nothing leaves the step where it is; a board address makes the picture a link.
    const link = await workApi({ action: 'ask', chat: 'Board', of: 'B1', kind: 'do', text: 'Restart the app' }, { dir, now: NOW, prefix: 'Team - ', roleOf: () => 'worker', boardUrl: 'http://127.0.0.1:4310' })
    assert.equal(link.result.text, '> **For you**\n> 1. **Do:** Restart the app (Q2, do on B1)')
    assert.equal(await state(dir, 'B1'), 'in progress')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('report moves to review and records "check pending"; the board\'s check closes it; the main chat gets a note', async () => {
  const { dir, board, server } = await fresh()
  try {
    await board({ action: 'take', id: 'B1', branch: 'b1-strip' })
    assert.equal((await board({ action: 'report', id: 'B1' })).status, 400)
    const reported = await board({ action: 'report', id: 'B1', result: 'The strip shows on the board.', merged: 'abc1234' })
    assert.equal(reported.ok, true, reported.why)
    assert.deepEqual(reported.result.check, { id: 'B1', branch: 'b1-strip', result: 'The strip shows on the board.' })
    assert.equal(await state(dir, 'B1'), 'review')
    assert.equal((await history(dir, 'B1')).at(-1), '- 2026-10-17 11:06 server: check pending')
    assert.equal((await item(dir, 'B1')).sections.get('Context').at(-1), '  Reported by Board on 2026-10-17 at 11:06: The strip shows on the board. (merged abc1234)')
    const note = await item(dir, 'N1')
    assert.deepEqual(['From', 'To', 'State', 'Text'].map(key => valueOf(note, key)), ['Board', 'main', 'unread', 'B1 reported by Board: The strip shows on the board.'])
    const failed = await server({ action: 'check', id: 'B1', passed: false, lines: ['the branch b1-strip is still there'] })
    assert.equal(failed.ok, true)
    assert.equal(await state(dir, 'B1'), 'review')
    await server({ action: 'check', id: 'B1', passed: true, lines: ['base equals remote', 'branch gone', 'result named'] })
    assert.equal(await state(dir, 'B1'), 'done')
    assert.deepEqual((await history(dir, 'B1')).slice(-3), [
      '- 2026-10-17 11:06 server: check failed: the branch b1-strip is still there',
      '- 2026-10-17 11:06 server: check passed: base equals remote; branch gone; result named',
      '- 2026-10-17 11:06 server: review → done',
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('queue by a worker is refused by the flow; Main queues a refined step, not a new one', async () => {
  const { dir, board, main } = await fresh()
  try {
    assert.deepEqual(await board({ action: 'queue', id: 'B5', for: 'Support' }), { ok: false, status: 409, why: 'B5: only main queues a step (flow.json)' })
    assert.equal((await main({ action: 'queue', id: 'B7', for: 'Support' })).why, 'B7: no move from new to queued (flow.json)')
    const queued = await main({ action: 'queue', id: 'B5', for: 'Support', after: 'B4', about: '1 h' })
    assert.equal(queued.ok, true, queued.why)
    const five = await item(dir, 'B5')
    assert.deepEqual(['State', 'Owner', 'Blocked by', 'Waits for', 'Estimate'].map(key => valueOf(five, key)), ['queued', 'Support', 'B4', null, '1 h'])
    assert.equal((await history(dir, 'B5')).at(-1), '- 2026-10-17 11:06 Main: queued for Support; after B4; about 1 h')
    // Overlapping work is the flow's guard too.
    const { ctx } = await fresh()
    const busy = await workApi({ action: 'queue', chat: 'Main', id: 'B5', for: 'Board' }, { ...ctx, overlaps: () => 'B4' })
    assert.equal(busy.why, 'B5: "Touches overlaps no taken step" does not hold (flow.json)')
    await rm(ctx.dir, { recursive: true, force: true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('new makes a step at the end of its activity; block and unblock set Blocked by', async () => {
  const { dir, main, board, advisor } = await fresh()
  try {
    assert.match((await main({ action: 'new', title: 'A step', activity: 'Elsewhere' })).why, /^Name its activity in "activity": Board work\.$/)
    assert.equal((await main({ action: 'new', title: 'A step (for Board)', activity: 'Board work' })).status, 400)
    const made = await advisor({ action: 'new', title: 'Show the flow strip', activity: 'board work', goal: 'G4', text: 'Plan: plans/flow.md\n\nThe person\'s words.' })
    assert.equal(made.ok, true, made.why)
    assert.equal(made.result.id, 'B8')
    const eight = await item(dir, 'B8')
    assert.deepEqual(['Kind', 'State', 'Activity', 'Goal'].map(key => valueOf(eight, key)), ['step', 'new', 'Board work', 'G4'])
    assert.deepEqual(eight.sections.get('Context'), ['  Plan: plans/flow.md', '  The person\'s words.'])
    assert.deepEqual((await readStore(dir)).activities[0].steps.at(-1), 'B8')
    assert.equal((await advisor({ action: 'block', id: 'B8', on: 'B1' })).status, 403)
    await board({ action: 'block', id: 'B8', on: 'B1' })
    await main({ action: 'block', id: 'B8', on: 'B7' })
    assert.equal(valueOf(await item(dir, 'B8'), 'Blocked by'), 'B1 and B7')
    await main({ action: 'unblock', id: 'B8', on: 'B1' })
    assert.equal(valueOf(await item(dir, 'B8'), 'Blocked by'), 'B7')
    assert.equal((await main({ action: 'block', id: 'B8', on: 'B99' })).status, 404)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refine writes today\'s block and Refined: open; refined makes it ready and moves the step to refined', async () => {
  const { dir, advisor, board, person } = await fresh()
  try {
    assert.equal((await board({ action: 'refine', id: 'B7', summary: 'x' })).status, 403)
    assert.equal((await advisor({ action: 'refined', id: 'B7', what: ['x'] })).why, 'B7 has no refine block yet: refine it first.')
    const refined = await advisor({ action: 'refine', id: 'B7', summary: 'One strip per step.', goal: 'G4', size: '1 h', questions: ['Thin or thick? I advise thick.'] })
    assert.equal(refined.ok, true, refined.why)
    let seven = await item(dir, 'B7')
    assert.equal(valueOf(seven, 'Refined'), 'open')
    assert.deepEqual(seven.sections.get('Refined'), ['  Refined (round 1, by Advisor, 2026-10-17 11:06):', '  Summary: One strip per step.', '  Part of: G4', '  Size: about 1 h', '  Questions:', '  - Thin or thick? I advise thick.'])
    // The person answers on the page, as the backlog's refine block takes it.
    const answered = await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 0, answer: 'thick' }], feedback: '' })
    assert.equal(answered.ok, true, answered.why)
    assert.equal((await item(dir, 'B7')).sections.get('Refined').at(-1), '  - Thin or thick? I advise thick. Answer: thick')
    const ready = await advisor({ action: 'refined', id: 'B7', what: ['the strip', 'its window'] })
    assert.equal(ready.ok, true, ready.why)
    seven = await item(dir, 'B7')
    assert.deepEqual(['State', 'Refined', 'Goal'].map(key => valueOf(seven, key)), ['refined', 'ready', 'G4'])
    assert.deepEqual(seven.sections.get('What we build'), ['- the strip', '- its window'])
    assert.equal(seven.sections.get('Refined')[0], '  Refined (round 1, by Advisor, 2026-10-17 11:06; ready):')
    // The ready form: the questions and their answers are folded in and go.
    assert.deepEqual(seven.sections.get('Refined').slice(1), ['  Summary: One strip per step.', '  Part of: G4', '  Size: about 1 h', '  What we build:', '  - the strip', '  - its window'])
    // The backlog reads it as refined and ready, as before.
    const view = await readFile(join(dir, 'B7.md'), 'utf8')
    assert.match(view, /^Refined: ready$/m)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('drop, close, tick and delete', async () => {
  const { dir, main, board, person } = await fresh()
  try {
    assert.equal((await board({ action: 'drop', id: 'B3', why: 'no' })).why, 'B3: only person or main drops a step (flow.json)')
    const dropped = await main({ action: 'drop', id: 'B3', why: 'the person said no' })
    assert.equal(dropped.ok, true, dropped.why)
    assert.equal(await state(dir, 'B3'), 'dropped')
    assert.equal((await item(dir, 'B3')).sections.get('Context').at(-1), '  Dropped by Main on 2026-10-17 at 11:06: the person said no')
    // An instruction is closed with what came of it.
    await writeFile(join(dir, 'I1.md'), 'Id: I1\nKind: instruction\nChat: Board\nState: open\nSince: 2026-10-17 11:00\nText: Make the strip blue\n')
    assert.match((await board({ action: 'next' })).result.text, /^Yours, Board:\n- I1 open: Make the strip blue\n/)
    const closed = await board({ action: 'close', id: 'I1', as: 'made step B8' })
    assert.equal(closed.ok, true, closed.why)
    const one = await item(dir, 'I1')
    assert.deepEqual(['State', 'Closed as'].map(key => valueOf(one, key)), ['closed', 'made step B8'])
    assert.equal((await history(dir, 'I1')).at(-1), '- 2026-10-17 11:06 Board: closed: made step B8')
    // The person ticks: an ask is answered, a step in progress is dropped (only review → done is theirs).
    await person({ action: 'tick', id: 'B6', line: 'Approved by you on the worker board on 2026-10-17 at 11:06.' })
    assert.equal(await state(dir, 'B6'), 'answered')
    await person({ action: 'tick', id: 'B4', line: 'Closed by you on the worker board on 2026-10-17 at 11:06.' })
    assert.equal(await state(dir, 'B4'), 'dropped')
    assert.equal((await person({ action: 'tick', id: 'B4', line: '' })).why, 'B4 is ticked already.')
    assert.equal((await person({ action: 'delete', id: 'B7' })).ok, true)
    assert.ok(!(await readdir(dir)).includes('B7.md'))
    assert.ok(!(await readStore(dir)).activities[0].steps.includes('B7'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a hand-edited file with a broken head is refused, not moved', async () => {
  const { dir, board } = await fresh()
  try {
    const text = await readFile(join(dir, 'B1.md'), 'utf8')
    await writeFile(join(dir, 'B1.md'), text.replace('Owner: Board', 'Owner Board'))
    assert.deepEqual(await board({ action: 'take', id: 'B1' }), { ok: false, status: 409, why: 'B1: its file is broken (line 5 is no head line: "Owner Board"); fix it by hand first.' })
    assert.equal((await readFile(join(dir, 'B1.md'), 'utf8')).includes('Owner Board'), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('after a change the view is written, and it reads back as the store', async () => {
  const { dir, ctx, main } = await fresh()
  try {
    const file = join(dir, '..', `${dir.split(/[\\/]/).at(-1)}-backlog.md`)
    const viewed = { ...ctx, viewFile: file }
    await workApi({ action: 'take', chat: 'Board', id: 'B1' }, viewed)
    await main({ action: 'new', title: 'Another step', activity: 'Board work' })
    await workApi({ action: 'drop', chat: 'Main', id: 'B3', why: 'not now' }, viewed)
    const view = await readFile(file, 'utf8')
    assert.match(view.split('\n')[0], /^<!-- generated by the worker board from .*; edit nothing here -->$/)
    assert.match(view, /^- \[ \] B1 Draw the strip \(for Board; about 1 h\)\n {2}\[store\] State: in progress$/m)
    assert.match(view, /^- \[x\] B3 A new idea/m)
    assert.match(view, /^- \[ \] B8 Another step$/m)
    const store = await readStore(dir)
    const back = migrateBacklog(view, { now: NOW })
    for (const [id, one] of store.items) {
      const plain = it => ({ head: Object.fromEntries([...it.head].filter(([key]) => key !== 'Since')), sections: Object.fromEntries([...it.sections].filter(([name]) => name !== 'History')) })
      assert.deepEqual(plain(back.items.get(id)), plain(one), id)
    }
    assert.equal(parseBacklog(view).activities[0].steps.length, 8)
    await rm(file, { force: true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('overlapsIn names a taken step whose Touches overlap, a folder covering its files', async () => {
  const { overlapsIn } = await import('../../src/work/api.mjs')
  const store = migrateBacklog('## A\n- [ ] B1 One (branch b1)\n  Touches: src/state.mjs, public/\n- [ ] B2 Two\n  Touches: public/board.js\n- [ ] B3 Three\n  Touches: README.md\n- [ ] B4 Four\n', { now: NOW })
  const overlaps = overlapsIn(store.items)
  assert.equal(overlaps(store.items.get('B2')), 'B1')
  assert.equal(overlaps(store.items.get('B3')), null)
  assert.equal(overlaps(store.items.get('B4')), null)
})
