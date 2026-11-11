// 2026-11-09 (reactive board, brief A): the person's own decisions on the Vision tab (Yes mine / Confirm, the goals' and
// standards' confirms, the feature marks, Prepare now or Wait, Not now, Good enough) are written into the product plan by
// the board at once, in the plan's own line format with "(you, <date>)"; the word to the partner then says so. Every test
// works on a COPY of a plan file in a temp folder; made-up names, except the real-case test, which copies the game's plan.
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { copyFile, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'
import { parsePlan, planState, withPlanWork } from '../src/plan.mjs'
import { partnerPageAt } from '../src/planWrite.mjs'
import { NO_PARTNER_NOTE, PLAN_DECISIONS, planDecide } from '../src/planMoves.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// vision:start'), script.indexOf('// vision:end'))}
Object.assign(this, { visionView })`, made)
const visionView = (...args) => JSON.parse(JSON.stringify(made.visionView(...args)))

const NOW = new Date(2026, 10, 9, 12, 0).getTime()
const DAY = '2026-11-09'
// A snapshot of the game's own plan (2026-11-09), bytes as they are: CRLF, UTF-8 dots and one lone latin1 dot. The live file is never read.
const REAL = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'product-plan-2026-11-09.md')

const PAGE = `# Garden: the product plan

Pitch: A garden you can sit in.

## P1 · What it is

- State: decided (from vision.md, 2026-10-10)
- Point: **A garden** with benches

## P2 · Look

- State: decided (you, 2026-10-19)
- Answer: warm wood

## P5 · Who comes

- State: open
- Known: friends, at least.

## P7 · The road

- State: assumed (partner, 2026-10-18) · revisit after the first bench
- Point: **First** a bench

## Features

### F1 · Benches

- Mark: must (from vision.md, 2026-10-10)
- Complex: no
- Built: yes

### F2 · A pond

- Mark: later (package A, 2026-10-19)
- Complex: yes · water changes every path
- Prepare: now · a water layer · now: 2 days · later: every path again
- Built: no

### F3 · Lamps

- Mark: ?
- Complex: no
- Built: partly

## Goals preset

### M1 · A first corner

#### S1 · Two benches by the path

- State: proposed
- Done when: two benches stand by the path and you sat on both
- Serves: P1, P2

#### S2 · Light on the path

- State: agreed (you, 2026-10-19; in the goal map)
- Done when: the path is lit at night

### M2 · The whole garden

#### S3 · A pond with fish

- State: proposed
- Done when: fish swim

## Standards

### K1 · Benches

- State: confirmed (you, 2026-10-20)
- Bar: oak, never metal

### K2 · Paths

- State: proposed
- Count: 3, from S2
- Bar: gravel, lit at night
`

/** The page and the file settle after real file I/O: wait (at most about 2 s) until the check holds. */
async function until(check) {
  for (let turn = 0; turn < 100; turn += 1) {
    if (await check()) return true
    await settle(2)
    await new Promise(done => setTimeout(done, 20))
  }
  return false
}

const WROTE = " The board wrote the lines: do not write them again, and commit and push the page as the game's repository says."
const CRLF = text => text.replace(/\n/g, '\r\n')
const swap = (text, from, to) => {
  assert.ok(text.includes(from), from)
  return text.replace(from, to)
}

async function planFile(text = PAGE, encoding = 'latin1') {
  const dir = await mkdtemp(join(tmpdir(), 'plan-decide-'))
  const file = join(dir, 'product-plan.md')
  await writeFile(file, text, encoding)
  return { dir, file, text: async () => (await readFile(file)).toString('latin1') }
}
const ctxOf = file => ({ canWrite: true, partner: { name: 'Garden - Partner' }, job: 'J', file, now: NOW })
const wordOf = done => done.words.text.split('\n')

// One row per decision: the move, what the file must read afterwards, and a move naming something that is not in the plan.
const CASES = [
  { name: 'plan-confirm (Yes, mine / Confirm on an answer)', body: { command: 'plan-confirm', id: 'P7' }, bad: { command: 'plan-confirm', id: 'P9' },
    after: text => swap(text, '- State: assumed (partner, 2026-10-18) · revisit after the first bench', `- State: decided (you, ${DAY})`),
    said: 'The person confirmed P7; it is written in the plan. Go on from it.' + WROTE },
  { name: 'plan-settled (Good enough)', body: { command: 'plan-settled', id: 'P2' }, bad: { command: 'plan-settled', id: 'P9' },
    after: text => swap(text, '- State: decided (you, 2026-10-19)\n- Answer: warm wood', `- State: decided (you, 2026-10-19)\n- Settled: (you, ${DAY})\n- Answer: warm wood`),
    said: 'The person marked P2 good enough; it is written in the plan. Go on from it.' + WROTE },
  { name: 'plan-marks (Must, Later, No and a milestone)', body: { command: 'plan-marks', text: 'F3 must; F2 M1; F1 no' }, bad: { command: 'plan-marks', text: 'F3 must; F9 no' },
    after: text => swap(swap(swap(text, '- Mark: ?\n', `- Mark: must (you, ${DAY})\n`), '- Mark: later (package A, 2026-10-19)\n', `- Mark: must (you, ${DAY})\n- Milestone: M1 (you, ${DAY})\n`),
      '- Mark: must (from vision.md, 2026-10-10)\n', `- Mark: no (you, ${DAY})\n`),
    said: 'The person marked these features; the marks are written in the plan. Go on from them: run your "Plan changes" check for each marked feature and place it again (a changed mark moves its Milestone).' + WROTE },
  { name: 'plan-goals-confirm (Confirm goal now and Send)', body: { command: 'plan-goals-confirm', text: 'S1, S2' }, bad: { command: 'plan-goals-confirm', text: 'S1, S9' },
    // S2 is agreed by the partner already: it stays as it is.
    after: text => swap(text, '#### S1 · Two benches by the path\n\n- State: proposed', `#### S1 · Two benches by the path\n\n- State: confirmed (you, ${DAY})`),
    said: 'The person confirmed these goals; they are written in the plan. Go on from them.' + WROTE },
  { name: 'plan-standards-confirm (Confirm standard now and Send)', body: { command: 'plan-standards-confirm', text: 'K2' }, bad: { command: 'plan-standards-confirm', text: 'K9' },
    after: text => swap(text, '### K2 · Paths\n\n- State: proposed', `### K2 · Paths\n\n- State: confirmed (you, ${DAY})`),
    said: 'The person confirmed these standards; they are written in the plan. Go on from them.' + WROTE },
  { name: 'plan-tradeoff (Prepare now or Wait)', body: { command: 'plan-tradeoff', id: 'F2', text: 'prepare' }, bad: { command: 'plan-tradeoff', id: 'F9', text: 'wait' },
    after: text => swap(text, '- Prepare: now · a water layer · now: 2 days · later: every path again\n', `- Prepare: now · a water layer · now: 2 days · later: every path again\n- Tradeoff: prepare (you, ${DAY})\n`),
    said: 'The person chose prepare for F2; it is written in the plan. Go on from it.' + WROTE },
  { name: 'plan-not-now (a goal)', body: { command: 'plan-not-now', id: 'S3' }, bad: { command: 'plan-not-now', id: 'S9' },
    after: text => swap(text, '#### S3 · A pond with fish\n\n- State: proposed', `#### S3 · A pond with fish\n\n- State: not now (you, ${DAY})`),
    said: 'The person put S3 on not now; it is written in the plan. Go on from it.' + WROTE },
]

for (const one of CASES) {
  // The file as latin1 bytes (the dots are the lone latin1 byte), CRLF, and as UTF-8 (the dots are two bytes, as the real plan has them).
  for (const [label, wrap, enc] of [['LF', text => text, 'latin1'], ['CRLF', CRLF, 'latin1'], ['UTF-8', text => text, 'utf8']]) {
    test(`${one.name}: the right line is written, every other byte stays (${label}), the word says it is written`, async () => {
      const plan = await planFile(wrap(PAGE), enc)
      try {
        const done = await planDecide(one.body, ctxOf(plan.file))
        assert.equal(done.ok, true)
        assert.equal(await plan.text(), Buffer.from(wrap(one.after(PAGE)), enc).toString('latin1'))
        // The word to the partner still goes out: its first line as before, then that the decision is written.
        const lines = wordOf(done)
        assert.equal(lines[0].startsWith('plan: '), true)
        assert.equal(lines.at(-2), one.said)
        assert.equal(lines.at(-1), 'Your job: J, "The plan interview"')
        assert.equal(done.words.command, one.body.command)
        assert.equal(done.words.to, 'Garden - Partner')
      } finally {
        await rm(plan.dir, { recursive: true, force: true })
      }
    })
  }
  test(`${one.name}: an id that is not in the plan is refused with why, and nothing is written`, async () => {
    const plan = await planFile()
    try {
      const done = await planDecide(one.bad, ctxOf(plan.file))
      assert.equal(done.ok, false)
      assert.equal(done.status, 404)
      assert.match(done.why, /^(P|F|S|K)9 is not in the plan\.$/)
      assert.equal(await plan.text(), PAGE)
    } finally {
      await rm(plan.dir, { recursive: true, force: true })
    }
  })
}

test('what the file says afterwards is what planOf reads: decided, marked, confirmed, later, settled, chosen', async () => {
  const plan = await planFile()
  try {
    for (const body of [{ command: 'plan-confirm', id: 'P7' }, { command: 'plan-settled', id: 'P2' }, { command: 'plan-marks', text: 'F3 later; F2 M3+; F1 M2' },
      { command: 'plan-goals-confirm', text: 'S1' }, { command: 'plan-standards-confirm', text: 'K2' }, { command: 'plan-tradeoff', id: 'F2', text: 'wait' }, { command: 'plan-not-now', id: 'S3' }]) {
      assert.equal((await planDecide(body, ctxOf(plan.file))).ok, true)
    }
    const read = parsePlan(await plan.text())
    const answer = id => read.answers.find(one => one.id === id)
    const feature = id => read.features.find(one => one.id === id)
    const goals = read.milestones.flatMap(one => one.goals)
    assert.deepEqual([answer('P7').state, answer('P7').by, answer('P7').at], ['decided', 'you', DAY])
    assert.deepEqual(answer('P2').settled, { by: 'you', at: DAY })
    assert.deepEqual([feature('F3').mark, feature('F3').by, feature('F3').at], ['later', 'you', DAY])
    assert.deepEqual([feature('F2').mark, feature('F2').milestone], ['later', 'M3+'])
    assert.deepEqual([feature('F1').mark, feature('F1').milestone], ['must', 'M2'])
    assert.deepEqual([feature('F2').tradeoff, feature('F2').tradeoffAt], ['wait', DAY])
    assert.deepEqual(goals.find(one => one.id === 'S1').state, 'confirmed')
    assert.deepEqual(goals.find(one => one.id === 'S3').state, 'later')
    assert.deepEqual(goals.find(one => one.id === 'S2').state, 'confirmed')
    assert.deepEqual(read.standards.find(one => one.id === 'K2').state, 'confirmed')
  } finally {
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('a Confirm on an answer the partner later re-reads stays decided', async () => {
  const plan = await planFile()
  try {
    assert.equal((await planDecide({ command: 'plan-confirm', id: 'P7' }, ctxOf(plan.file))).ok, true)
    const first = await plan.text()
    // The partner goes on from the word and adds its own lines; the same Confirm again changes no byte.
    await writeFile(plan.file, swap(first, '- Point: **First** a bench', '- Point: **First** a bench\n- Advice: solid.'), 'latin1')
    const again = await planDecide({ command: 'plan-confirm', id: 'P7' }, { ...ctxOf(plan.file), now: NOW + 3 * 86_400_000 })
    assert.equal(again.ok, true)
    assert.equal(await plan.text(), swap(first, '- Point: **First** a bench', '- Point: **First** a bench\n- Advice: solid.'))
    const answer = planState(await plan.text(), [], 'p.md').answers.find(one => one.id === 'P7')
    assert.deepEqual([answer.state, answer.by, answer.at, answer.advice], ['decided', 'you', DAY, 'solid.'])
    // An open answer has nothing to confirm: refused, nothing written.
    const open = await planDecide({ command: 'plan-confirm', id: 'P5' }, ctxOf(plan.file))
    assert.equal(open.ok, false)
    assert.match(open.why, /^P5 has no answer yet/)
  } finally {
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('the judgment words stay words: nothing is written, the word does not claim it was', async () => {
  const plan = await planFile()
  try {
    for (const body of [{ command: 'plan-deeper', id: 'P1' }, { command: 'plan-change', id: 'P7', text: 'only at night' }, { command: 'plan-ask', id: 'P5' }, { command: 'plan-check' }]) {
      const done = await planDecide(body, ctxOf(plan.file))
      assert.equal(done.ok, true)
      assert.equal(done.words.text.includes('written in the plan'), false)
    }
    assert.equal(await plan.text(), PAGE)
    assert.deepEqual(PLAN_DECISIONS.length, 7)
    // Refusals before any write: a board that only shows, no partner.
    assert.equal((await planDecide({ command: 'plan-confirm', id: 'P7' }, { ...ctxOf(plan.file), canWrite: false })).status, 403)
    assert.equal((await planDecide({ command: 'plan-deeper', id: 'P7' }, { ...ctxOf(plan.file), partner: null })).status, 409)
    assert.equal((await planDecide({ command: 'plan-confirm', id: 'P7' }, { ...ctxOf(null) })).status, 409)
    assert.equal((await planDecide({ command: 'plan-confirm', id: 'P7' }, ctxOf(join(plan.dir, 'gone.md')))).status, 409)
    assert.equal(await plan.text(), PAGE)
  } finally {
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('the page: after a decision the slide is gone from the state the server gives, on a fresh load too, and no "preparing" line stands for it', async () => {
  const plan = await planFile()
  try {
    const open = planState(PAGE, [], 'p.md')
    const before = visionView(open, { page: 'interview', at: 0, picked: {}, change: null, asked: [], marks: {}, confirms: [] })
    const ids = view => view.slides.filter(slide => slide.kind === 'decide').map(slide => slide.id)
    // F2 (later, complex, no choice yet), P7 (assumed), K2 and S1 and S3 (proposed) wait on the person.
    assert.deepEqual(['P7', 'F2', 'K2', 'S1', 'S3'].filter(id => !ids(before).includes(id)), [])
    const words = []
    for (const body of [{ command: 'plan-confirm', id: 'P7' }, { command: 'plan-tradeoff', id: 'F2', text: 'wait' }, { command: 'plan-standards-confirm', text: 'K2' },
      { command: 'plan-goals-confirm', text: 'S1' }, { command: 'plan-not-now', id: 'S3' }]) {
      const done = await planDecide(body, ctxOf(plan.file))
      assert.equal(done.ok, true)
      // As the board's outbox holds it, delivered, a little after the file was written.
      words.push({ command: body.command, about: done.words.about, at: NOW + 1000, state: 'delivered' })
    }
    // The file was written just before the words were typed: it is older than they are, so nothing marks them done by a later write.
    const pageAt = NOW
    // What the server gives on any load: the plan read from the file, with the outbox's words. No page memory (ui.sent) is involved.
    for (const now of [NOW + 5000, NOW + 120_000]) {
      const given = withPlanWork(planState(await plan.text(), [], 'p.md'), words, pageAt, now)
      assert.deepEqual(given.working, [])
      const fresh = visionView(given, { page: 'interview', at: 0, picked: {}, change: null, asked: [], marks: {}, confirms: [] })
      assert.deepEqual(ids(fresh), [])
      assert.equal(fresh.working, undefined, 'P4c: the view keeps no guessed working list: the lines come from the server')
      assert.equal(Object.values(fresh.busy).some(Boolean), false)
    }
  } finally {
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('the route: POST /api/plan writes the decision first, then the word goes to the partner, and the file already says so', async t => {
  const plan = await planFile()
  t.after(() => rm(plan.dir, { recursive: true, force: true }))
  const typed = []
  // The route's own handler as server.mjs builds it: planDecide, then the word into the outbox.
  const server = createBoard({
    token: 'a'.repeat(64), getState: async () => ({ readAt: 1, chats: [] }),
    plan: async body => {
      const done = await planDecide(body, ctxOf(plan.file))
      if (!done.ok) return done
      typed.push({ words: done.words, fileThen: await plan.text() })
      return { ok: true, result: { ...done.result, said: 'm1' } }
    },
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const { port } = server.address()
  const post = body => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/plan', headers: { 'X-Board-Token': 'a'.repeat(64), Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
  const refused = await post({ command: 'plan-confirm', id: 'P9' })
  assert.equal(refused.status, 404)
  assert.match(refused.text, /P9 is not in the plan/)
  assert.deepEqual(typed, [])
  assert.equal(await plan.text(), PAGE)
  const done = await post({ command: 'plan-confirm', id: 'P7' })
  assert.equal(done.status, 200)
  assert.equal(typed.length, 1)
  assert.match(typed[0].fileThen, /- State: decided \(you, 2026-11-09\)/)
  assert.equal(typed[0].words.text.split(String.fromCharCode(10))[0], 'plan: P7 confirmed')
})

test('the real case: a snapshot of the game own plan, copied: a Confirm, a mark and a Not now are written and read back as decided, marked and later', async () => {
  const snapshot = await readFile(REAL)
  assert.equal(snapshot.includes(Buffer.from([0x0d, 0x0a])), true)
  assert.equal(snapshot.includes(Buffer.from([0xc2, 0xb7])), true)
  // The lone latin1 dot: a 0xB7 that no 0xC2 precedes.
  assert.equal(snapshot.some((byte, at) => byte === 0xb7 && snapshot[at - 1] !== 0xc2), true)
  const dir = await mkdtemp(join(tmpdir(), 'plan-real-'))
  const file = join(dir, 'product-plan.md')
  try {
    await copyFile(REAL, file)
    const original = (await readFile(file)).toString('latin1')
    const utf8 = bytes => Buffer.from(bytes, 'latin1').toString('utf8')
    const parsed = parsePlan(utf8(original))
    // A feature that is not marked later yet, a goal not set aside yet, and an answer to confirm: the first the copy offers.
    const feature = parsed.features.find(one => one.mark === 'must')
    const goal = parsed.milestones.flatMap(one => one.goals)[0]
    const answers = parsed.answers.filter(one => one.state === 'decided')
    assert.ok(feature && goal && answers.length > 0)
    // The copy is made to hold an assumed answer, as the page does while the person confirms it.
    const assumed = answers.at(-1)
    const seeded = original.replace(new RegExp(`(## ${assumed.id} [^\\n]*\\r?\\n(?:\\r?\\n)?- State: )[^\\r\\n]*`), '$1assumed (partner, 2026-11-01)')
    assert.notEqual(seeded, original)
    await writeFile(file, seeded, 'latin1')
    const ctx = ctxOf(file)
    assert.equal((await planDecide({ command: 'plan-confirm', id: assumed.id }, ctx)).ok, true)
    assert.equal((await planDecide({ command: 'plan-marks', text: `${feature.id} later` }, ctx)).ok, true)
    assert.equal((await planDecide({ command: 'plan-not-now', id: goal.id }, ctx)).ok, true)
    const after = (await readFile(file)).toString('latin1')
    const read = planState(utf8(after), [], 'docs/product-plan.md')
    assert.deepEqual([read.answers.find(one => one.id === assumed.id).state, read.answers.find(one => one.id === assumed.id).by], ['decided', 'you'])
    assert.deepEqual([read.features.find(one => one.id === feature.id).mark, read.features.find(one => one.id === feature.id).by], ['later', 'you'])
    assert.equal(read.milestones.flatMap(one => one.goals).find(one => one.id === goal.id).state, 'later')
    // Every other byte: only the three items' lines differ, the file is still CRLF as it was, and the stray latin1 byte stays.
    const lines = (text, split) => text.split(split)
    const was = lines(seeded, '\r\n')
    const now = lines(after, '\r\n')
    const changed = now.filter(line => !was.includes(line))
    assert.ok(changed.length <= 3 + 1 && changed.length >= 3, changed.join(' | '))
    assert.equal(after.includes('\r\n'), seeded.includes('\r\n'))
    assert.equal(after.split('\n').every(line => line.endsWith('\r') || line === ''), true)
    assert.equal(Buffer.from(after, 'latin1').includes(0xb7), Buffer.from(seeded, 'latin1').includes(0xb7))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the page keeps no memory of these decisions: their clicks do not mark a slide as sent, the plan file does', () => {
  const acts = script.slice(script.indexOf('async function visionAct('))
  const clickOf = act => {
    const at = acts.indexOf(`act === '${act}'`)
    assert.ok(at > 0, act)
    return acts.slice(at, acts.indexOf('} else if (', at + 10))
  }
  // The decisions the page test above clicks are checked there; these need slides or cards that test does not open.
  for (const act of ['not-now', 'send-marks', 'send-confirms', 'send-standard-confirms', 'settle']) {
    assert.equal(clickOf(act).includes('visionUi.sent'), false, act)
    assert.equal(clickOf(act).includes('visionUi.notNow'), false, act)
  }
  // mark-now, confirm-standard-now and confirm-goal-now share one branch.
  const now = acts.slice(acts.indexOf("['mark-now', 'confirm-standard-now', 'confirm-goal-now']"))
  assert.equal(now.slice(0, now.indexOf('} else if (')).includes('visionUi.sent'), false)
})

test('no partner chat on the board: the decision is written, no word goes out, the result says so quietly; a board that only shows still refuses', async () => {
  const plan = await planFile()
  try {
    const done = await planDecide({ command: 'plan-confirm', id: 'P7' }, { ...ctxOf(plan.file), partner: null })
    assert.equal(done.ok, true)
    assert.equal(done.words, null)
    assert.equal(done.result.note, NO_PARTNER_NOTE)
    assert.equal(NO_PARTNER_NOTE, 'Written. No partner chat on the board: it reads it when one starts.')
    assert.equal(await plan.text(), swap(PAGE, '- State: assumed (partner, 2026-10-18) · revisit after the first bench', `- State: decided (you, ${DAY})`))
    // A word to the partner has nobody to go to: still refused, as before.
    assert.equal((await planDecide({ command: 'plan-change', id: 'P7', text: 'x' }, { ...ctxOf(plan.file), partner: null })).status, 409)
    // Only showing refuses before writing.
    const before = await plan.text()
    assert.equal((await planDecide({ command: 'plan-goals-confirm', text: 'S1' }, { ...ctxOf(plan.file), partner: null, canWrite: false })).status, 403)
    assert.equal(await plan.text(), before)
    // An id that is not there is refused with nothing written, alone or not.
    assert.equal((await planDecide({ command: 'plan-goals-confirm', text: 'S9' }, { ...ctxOf(plan.file), partner: null })).status, 404)
    assert.equal(await plan.text(), before)
  } finally {
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('the page, clicked: Confirm writes the answer, the slide stays gone with no "preparing" text after a fresh state and a fresh load', async () => {
  // P5 (open) left out, so the Interview opens on the decision itself.
  const text = PAGE.replace(/## P5 [^]*?(?=## P7)/, '')
  const plan = await planFile(text)
  const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join(String.fromCharCode(10))
  const base = asSent({ ...build([], undefined, GOALS), goalsEdit: { canWrite: true } })
  const typed = []
  // What the server gives: the plan read from the file now, with the words the board has typed (the outbox).
  const state = async () => ({ ...base, plan: withPlanWork(planState(await plan.text(), [], 'docs/product-plan.md'), typed, NOW - 60_000, NOW + 5000) })
  const answers = async request => {
    if (request.url !== '/api/plan') return reply({})
    const done = await planDecide(request.body, ctxOf(plan.file))
    if (!done.ok) return reply(done.why, done.status)
    typed.push({ command: request.body.command, about: done.words.about, at: NOW + 1000, state: 'waiting' })
    return reply({ ...done.result, said: 'm1' })
  }
  const opened = []
  try {
    for (const round of [1, 2]) {
      const page = await openPage({ state, answers, now: NOW + 5000 })
      opened.push(page)
      await page.click('[data-tab="vision"]')
      const confirm = '[data-vision-act="confirm"][data-vision-id="P7"]'
      if (round === 1) {
        assert.equal(page.all(confirm).length, 1)
        await page.click(confirm)
        await until(() => page.all(confirm).length === 0)
        assert.deepEqual(page.sent('/api/plan').map(one => one.body), [{ command: 'plan-confirm', id: 'P7' }])
        assert.match(await plan.text(), /- State: decided \(you, 2026-11-09\)/)
        // The Interview goes on to the next decisions; each click is written, and its button is gone at once.
        for (const [act, id, line] of [['tradeoff-now', 'F2:wait', /- Tradeoff: wait \(you, 2026-11-09\)/], ['confirm-standard-now', 'K2', /### K2 · Paths[^\x00]*?- State: confirmed/], ['confirm-goal-now', 'S1', /#### S1 [^\x00]*?- State: confirmed \(you, 2026-11-09\)/]]) {
          const button = `[data-vision-act="${act}"][data-vision-id="${id}"]`
          await page.click('[data-vision-act="page"][data-vision-id="interview"]')
          assert.equal(page.all(button).length, 1, `${button}: ${page.text('#view-vision').slice(0, 600)}`)
          await page.click(button)
          await until(async () => line.test(await plan.text()) && page.all(button).length === 0)
          assert.match(await plan.text(), line)
          assert.equal(page.all(button).length, 0, button)
        }
      }
      // Gone after the state the server gives now, and on a fresh load of the page (round 2): no page memory is kept.
      assert.equal(page.all(confirm).length, 0)
      assert.equal(/preparing/i.test(page.text('#view-vision')), false)
      assert.equal(page.all('.vision-working-line').length, 0)
    }
  } finally {
    await settle(10)
    for (const page of opened) await page.close()
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('the page, clicked, with no partner chat: Confirm is enabled, writes the answer and says so quietly', async () => {
  const plan = await planFile(PAGE.replace(/## P5 [^]*?(?=## P7)/, ''))
  const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join(String.fromCharCode(10))
  const base = asSent({ ...build([], undefined, GOALS), goalsEdit: { canWrite: true } })
  const state = async () => ({ ...base, advisor: null, plan: planState(await plan.text(), [], 'docs/product-plan.md') })
  const answers = async request => {
    const done = await planDecide(request.body, { ...ctxOf(plan.file), partner: null })
    return done.ok ? reply(done.result) : reply(done.why, done.status)
  }
  const page = await openPage({ state, answers, now: NOW + 5000 })
  try {
    await page.click('[data-tab="vision"]')
    await page.click('[data-vision-act="confirm"][data-vision-id="P7"]')
    await until(() => page.text('#view-vision').includes(NO_PARTNER_NOTE))
    assert.match(await plan.text(), /- State: decided \(you, 2026-11-09\)/)
    assert.equal(page.all('[data-vision-act="confirm"][data-vision-id="P7"]').length, 0)
    assert.equal(page.text('#view-vision').includes(NO_PARTNER_NOTE), true)
    // The judgment buttons need a partner and are off; Good enough is a decision and is on.
    await page.click('[data-vision-act="page"][data-vision-id="vision"]')
    assert.equal(page.all('[data-vision-act="deeper"]').length > 0 && page.all('[data-vision-act="deeper"]').every(one => one.disabled), true)
    assert.equal(page.all('[data-vision-act="settle"]').length > 0 && page.all('[data-vision-act="settle"]').every(one => !one.disabled), true)
  } finally {
    await settle(10)
    await page.close()
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('the board own write is not the partner answer: a pending word stays pending after a decision; a later write of the partner answers it', async () => {
  const plan = await planFile()
  const log = join(plan.dir, 'plan-writes.json')
  const ctx = { ...ctxOf(plan.file), writesFile: log }
  try {
    const old = new Date(Date.now() - 3_600_000)
    await utimes(plan.file, old, old)
    const wordAt = Date.now() - 1_800_000
    const sent = [{ command: 'plan-change', about: 'P7', at: wordAt, state: 'delivered', pickedUpAt: wordAt + 1000 }, { command: 'plan-check', about: 'plan', at: wordAt, state: 'delivered', pickedUpAt: wordAt + 1000 }]
    const pending = async () => {
      const at = (await stat(plan.file)).mtimeMs
      const given = withPlanWork(planState(await plan.text(), [], 'p.md'), sent, await partnerPageAt(at, log, plan.file), Date.now())
      return given.working.map(one => one.command).sort()
    }
    assert.deepEqual(await pending(), ['plan-change', 'plan-check'])
    // Two decisions: the file is newer than the words, and still no answer of the partner.
    assert.equal((await planDecide({ command: 'plan-confirm', id: 'P7' }, ctx)).ok, true)
    assert.equal((await planDecide({ command: 'plan-goals-confirm', text: 'S1' }, ctx)).ok, true)
    assert.equal((await stat(plan.file)).mtimeMs > wordAt, true)
    assert.deepEqual(await pending(), ['plan-change', 'plan-check'])
    const kept = JSON.parse(await readFile(log, 'utf8'))[plan.file]
    assert.deepEqual(kept.ids, ['S1'])
    assert.equal(kept.partnerAt, old.getTime())
    // The partner writes the page later: the words are answered, and a decision after that does not bring them back.
    await writeFile(plan.file, `${await plan.text()}- Advice: solid.
`, 'latin1')
    const later = new Date(Date.now() + 60_000)
    await utimes(plan.file, later, later)
    assert.deepEqual(await pending(), [])
    assert.equal((await planDecide({ command: 'plan-standards-confirm', text: 'K2' }, ctx)).ok, true)
    assert.deepEqual(await pending(), [])
  } finally {
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('an item ends where plan.mjs ends it: a heading inside an answer or a goal that is not an item stays inside it', async () => {
  const text = [
    '# G', '', '## P7 · The road', '', '### Notes', '', '- State: assumed (partner, 2026-10-18)', '- Point: **First** a bench', '',
    '## Goals preset', '', '### M1 · A corner', '', '#### S1 · Benches', '', '##### Notes', '', '- State: proposed', '- Done when: x', '',
  ].join(String.fromCharCode(10))
  const plan = await planFile(text)
  try {
    const before = parsePlan(text)
    assert.deepEqual([before.answers[0].state, before.milestones[0].goals[0].state], ['assumed', 'proposed'])
    assert.equal((await planDecide({ command: 'plan-confirm', id: 'P7' }, ctxOf(plan.file))).ok, true)
    assert.equal((await planDecide({ command: 'plan-goals-confirm', text: 'S1' }, ctxOf(plan.file))).ok, true)
    const after = await plan.text()
    const read = parsePlan(after)
    assert.deepEqual([read.answers[0].state, read.milestones[0].goals[0].state], ['decided', 'confirmed'])
    assert.equal(after.split('- State:').length - 1, 2)
  } finally {
    await rm(plan.dir, { recursive: true, force: true })
  }
})

test('the page, clicked: a server that says ok but did not write leaves the slide where it is (the plan decides, not page memory)', async () => {
  const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join(String.fromCharCode(10))
  const base = asSent({ ...build([], undefined, GOALS), goalsEdit: { canWrite: true } })
  const noP5 = PAGE.replace(/## P5 [^]*?(?=## P7)/, '')
  const opened = []
  const plans = []
  try {
    // The confirm of an assumed answer, then the tradeoff (the answer decided already).
    for (const [text, first, button] of [[noP5, 'interview', '[data-vision-act="confirm"][data-vision-id="P7"]'],
      [noP5.replace('- State: assumed (partner, 2026-10-18) · revisit after the first bench', '- State: decided (you, 2026-10-18)'), 'interview', '[data-vision-act="tradeoff-now"][data-vision-id="F2:wait"]']]) {
      const plan = await planFile(text)
      plans.push(plan)
      const page = await openPage({ state: async () => ({ ...base, plan: planState(await plan.text(), [], 'docs/product-plan.md') }), answers: async () => reply({ said: 'm1' }), now: NOW + 5000 })
      opened.push(page)
      await page.click('[data-tab="vision"]')
      if (first !== null) await page.click(`[data-vision-act="page"][data-vision-id="${first}"]`)
      assert.equal(page.all(button).length, 1, button)
      await page.click(button)
      assert.equal(page.sent('/api/plan').length, 1)
      await settle(20)
      if (first !== null) await page.click(`[data-vision-act="page"][data-vision-id="${first}"]`)
      assert.equal(page.all(button).length, 1, `${button} stays: the plan was not written`)
    }
  } finally {
    await settle(10)
    for (const page of opened) await page.close()
    for (const plan of plans) await rm(plan.dir, { recursive: true, force: true })
  }
})
