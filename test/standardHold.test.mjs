// The guard (the user, 2026-10-21): a step of a kind goes into a queue only once its kind's standard is confirmed and
// its foundation is built; the foundation's own steps go first. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parsePlan } from '../src/plan.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { parseStandard } from '../src/work/standard.mjs'
import { isFoundationLine, standardHold } from '../src/work/standardHold.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const step = (id, standard) => parseItem(`Id: ${id}\nKind: step\nTitle: A step\nState: refined\n${standard === null ? '' : `\n## Standard\n${standard}\n`}`)
const BENCHES = { id: 'K1', title: 'Benches', kind: 'bench', state: 'confirmed', foundation: 'one bench drawing all are cut from', foundationBuilt: false }

test('the guard: a step of a kind waits for its standard\'s confirm, then for its foundation, unless it builds it', () => {
  const plain = step('B1', 'bench · art/bench.png · target 75')
  assert.match(standardHold(plain, [{ ...BENCHES, state: 'proposed' }]), /^B1 is a bench step, and the bench standard \(K1 Benches\) is not confirmed yet: it goes into a queue once it is confirmed on the Vision tab, step Standards\.$/)
  assert.match(standardHold(plain, [BENCHES]), /^B1 is a bench step, and the foundation of the bench standard \(K1 Benches\) is not built yet: only the foundation's own steps/)
  assert.equal(standardHold(step('B2', 'Bench · art/bench.png · target 75 · foundation'), [BENCHES]), null)
  assert.equal(standardHold(plain, [{ ...BENCHES, foundationBuilt: true }]), null)
  assert.equal(standardHold(plain, [{ ...BENCHES, foundation: '' }]), null)
  // Nothing holds a step without a standard, with none, or of a kind no standard names.
  assert.equal(standardHold(step('B3', null), [BENCHES]), null)
  assert.equal(standardHold(step('B4', 'none (a fix of the board)'), [BENCHES]), null)
  assert.equal(standardHold(step('B5', 'path · art/path.png · target 75'), [BENCHES]), null)
  assert.equal(standardHold(plain, []), null)
  assert.equal(isFoundationLine('bench · art/bench.png · target 75 · foundation'), true)
  assert.equal(isFoundationLine('bench · art/foundation.png · target 75'), false)
})

test('a step that builds its kind\'s foundation ends its standard in " · foundation"; nothing else may follow', () => {
  const kinds = [{ kind: 'bench', done: 'd.md', reference: 'r' }]
  assert.deepEqual(parseStandard('Bench · art/b.png · target 75 · Foundation', kinds), { ok: true, kind: 'bench', line: 'bench · art/b.png · target 75 · foundation' })
  assert.match(parseStandard('bench · art/b.png · target 75 · later', kinds).why, /foundation/)
})

test('the plan reads a standard\'s "Foundation built: yes" line', () => {
  const page = '# Plan\n\n## Standards\n\n### K1 · Benches\n\n- State: confirmed (you, 2026-10-21)\n- Kind: bench\n- Foundation: one bench drawing · about 4 h\n- Foundation built: yes (B9, 2026-10-21)\n\n### K2 · Paths\n\n- Kind: path\n- Foundation: a gravel kit\n'
  const { standards } = parsePlan(page)
  assert.deepEqual(standards.map(one => [one.id, one.state, one.foundationBuilt]), [['K1', 'confirmed', true], ['K2', 'proposed', false]])
})

test('the board\'s give refuses a held step with the reason; once nothing holds it, it goes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-guard-'))
  try {
    const now = new Date(2026, 9, 21, 10, 0).getTime()
    const backlog = '# Backlog\n\n## World work\n- [ ] B1 Draw the bench\n  Refined (2026-10-21 09:00; ready):\n  Summary: A bench.\n  Standard: bench · art/bench.png · target 75\n  What we build:\n  - the bench\n'
    await writeStore(dir, migrateBacklog(backlog, { now }), undefined, { now })
    const roles = { Main: 'main', Board: 'worker' }
    const ctx = { dir, now: now + 60_000, prefix: '', roleOf: chat => roles[chat] ?? null, freeChats: new Set(['Board']), standardHold: item => standardHold(item, [{ ...BENCHES, state: 'proposed' }]), as: 'server' }
    const held = await workApi({ action: 'advance', id: 'B1', to: 'queued', for: 'Board' }, ctx)
    assert.equal(held.status, 409)
    assert.match(held.why, /^B1 is a bench step, and the bench standard \(K1 Benches\) is not confirmed yet/)
    assert.equal(valueOf((await readStore(dir)).items.get('B1'), 'State'), 'refined')
    // Once nothing holds it, the same give goes.
    const free = await workApi({ action: 'advance', id: 'B1', to: 'queued', for: 'Board' }, { ...ctx, standardHold: () => null })
    assert.equal(free.ok, true, free.why)
    assert.equal(valueOf((await readStore(dir)).items.get('B1'), 'State'), 'queued')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
