// B306: a step's `Waits for` holds it as `Blocked by` does. The ids it names (B<n>, Q<n>) hold it until resolved (a step
// done or dropped, an ask answered or withdrawn); words without an id hold it until the main chat or the person clears
// them (`work unblock <id>` without "on"). The board does not deliver it, the worker's take refuses it, `next` shows it
// waiting, and the reconciler names a step whose only wait is words once its Owner has been free past the grace time.
// Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ASK_MS, GRACE_MS } from '../../src/config.mjs'
import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW, mayMove } from '../../src/work/flow.mjs'
import { GUARDS } from '../../src/work/guards.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 12, 0).getTime()
const MIN = 60_000
const TIMES = { graceMs: GRACE_MS, askMs: ASK_MS }

const text = (head, sections = {}) => `${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`
const step = (id, state, more = {}) => text({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: '2026-10-17 11:00', ...more })
const ask = (id, state) => text({ Id: id, Kind: 'ask', Title: `Ask ${id}`, State: state, Owner: 'Kites', Since: '2026-10-17 11:00', Asks: 'decide', Blocking: 'no' })
const storeOf = texts => ({ items: new Map(texts.map(one => parseItem(one)).map(item => [valueOf(item, 'Id'), item])), flow: DEFAULT_FLOW, problems: [] })
const lane = (name, more = {}) => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, lastActivityAt: NOW - 30 * MIN, task: null, ...more })
const run = (texts, lanes, now = NOW) => reconcile({ store: storeOf(texts), flow: DEFAULT_FLOW, lanes, now, times: TIMES, prefix: 'Crew - ' })

test('B306: the ids Waits for names hold a step until each is resolved: a step done or dropped, an ask answered or withdrawn', () => {
  const waiting = step('B76', 'queued', { Owner: 'Kites', 'Waits for': 'B77 says keep it' })
  assert.deepEqual(run([ask('B77', 'open'), waiting], [lane('Kites')]).deliveries, [])
  for (const state of ['answered', 'withdrawn']) assert.deepEqual(run([ask('B77', state), waiting], [lane('Kites')]).deliveries.map(one => one.id), ['B76'])
  const onStep = step('B76', 'queued', { Owner: 'Kites', 'Waits for': 'after B89' })
  assert.deepEqual(run([step('B89', 'in progress', { Owner: 'Sails' }), onStep], [lane('Kites')]).deliveries, [])
  for (const state of ['done', 'dropped']) assert.deepEqual(run([step('B89', state), onStep], [lane('Kites')]).deliveries.map(one => one.id), ['B76'])
  // A Q id, and one the store does not hold, count as open.
  assert.deepEqual(run([ask('Q4', 'open'), step('B76', 'queued', { Owner: 'Kites', 'Waits for': 'Q4 answered' })], [lane('Kites')]).deliveries, [])
  assert.deepEqual(run([step('B76', 'queued', { Owner: 'Kites', 'Waits for': 'B404 lands' })], [lane('Kites')]).deliveries, [])
  // The worker's own take: the same guard.
  const store = storeOf([ask('B77', 'open'), waiting]).items
  assert.equal(GUARDS['Blocked by all done'](parseItem(waiting), { store: { items: store } }), false)
})

test('B306: Waits for words without an id hold the step: no delivery; the guard of the worker\'s take does not hold either', () => {
  const words = step('B43', 'queued', { Owner: 'Kites', 'Waits for': "today's crew work" })
  assert.deepEqual(run([words], [lane('Kites')]).deliveries, [])
  const item = parseItem(words)
  assert.equal(mayMove(DEFAULT_FLOW, item, 'taken', 'worker', { store: storeOf([words]) }).ok, false)
  assert.equal(mayMove(DEFAULT_FLOW, item, 'taken', 'server', { store: storeOf([words]), freeChats: new Set(['Kites']) }).ok, false)
  // A step with no Waits for still goes.
  assert.deepEqual(run([step('B44', 'queued', { Owner: 'Kites' })], [lane('Kites')]).deliveries.map(one => one.id), ['B44'])
})

test('B306: a queued step whose only wait is words is named once its Owner has been free longer than the grace time', () => {
  const words = step('B43', 'queued', { Owner: 'Crew - Kites', 'Waits for': "today's crew work" })
  const flag = { kind: 'waits', id: 'B43', chat: 'Kites', text: "B43 waits for 'today's crew work': clear it or keep it", button: null }
  assert.deepEqual(run([words], [lane('Kites', { idle: { since: NOW - 11 * MIN } })]).flags, [flag])
  // Not before the grace time, not while the Owner works or holds a step, nor when an id still holds the step too.
  assert.deepEqual(run([words], [lane('Kites', { idle: { since: NOW - 5 * MIN } })]).flags, [])
  assert.deepEqual(run([words], [lane('Kites', { state: 'working', idle: { since: NOW - 11 * MIN } })]).flags, [])
  assert.deepEqual(run([words, step('B12', 'in progress', { Owner: 'Kites' })], [lane('Kites', { idle: { since: NOW - 11 * MIN } })]).flags.filter(one => one.kind === 'waits'), [])
  const both = step('B43', 'queued', { Owner: 'Kites', 'Waits for': "today's crew work", 'Blocked by': 'B12' })
  assert.deepEqual(run([both, step('B12', 'in progress', { Owner: 'Sails' })], [lane('Kites', { idle: { since: NOW - 11 * MIN } })]).flags, [])
  // A step it is delivered with instead: the Owner is not idle then.
  assert.deepEqual(run([words, step('B44', 'queued', { Owner: 'Kites' })], [lane('Kites', { idle: { since: NOW - 11 * MIN } })]).flags.filter(one => one.kind === 'waits'), [])
})

const ROLES = { Main: 'main', Kites: 'worker', Sails: 'worker' }

/** A store of made-up items in a folder of its own, and the work API as each chat. */
async function fresh(texts) {
  const dir = await mkdtemp(join(tmpdir(), 'work-waits-'))
  await writeStore(dir, { items: new Map(), activities: [{ name: 'Crew work', steps: [] }] }, undefined, { now: NOW })
  for (const one of texts) await writeFile(join(dir, `${valueOf(parseItem(one), 'Id')}.md`), one)
  const ctx = { dir, now: NOW, prefix: 'Crew - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Kites', 'Sails']) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, main: as('Main'), kites: as('Kites'), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const itemOf = async (dir, id) => (await readStore(dir)).items.get(id)

test('B306: take refuses a step that waits for words, naming them and how the main chat clears them; pull wakes nobody for it', async () => {
  const { dir, kites } = await fresh([step('B43', 'queued', { Owner: 'Kites', 'Waits for': "today's crew work" })])
  try {
    const took = await kites({ action: 'take', id: 'B43', branch: 'b43-x' })
    assert.equal(took.status, 409)
    assert.equal(took.why, "B43 waits for: today's crew work; the main chat clears it with work unblock B43")
    assert.equal(valueOf(await itemOf(dir, 'B43'), 'State'), 'queued')
    const pulled = await kites({ action: 'pull' })
    assert.equal(pulled.result.wake, null)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B306: take refuses a step whose Waits for names an open ask, naming it; once answered it is taken', async () => {
  const { dir, kites } = await fresh([ask('B77', 'open'), step('B76', 'queued', { Owner: 'Kites', 'Waits for': 'B77 says keep it' })])
  try {
    const took = await kites({ action: 'take', id: 'B76' })
    assert.equal(took.status, 409)
    assert.equal(took.why, 'B76: "Blocked by all done" does not hold (flow.json): B77 is open')
    await writeFile(join(dir, 'B77.md'), ask('B77', 'answered'))
    const again = await kites({ action: 'take', id: 'B76' })
    assert.equal(again.ok, true, again.why)
    assert.equal(valueOf(await itemOf(dir, 'B76'), 'State'), 'in progress')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B306: next shows a step that waits as waiting: the words with who clears them, or the ids still open', async () => {
  const { dir, kites } = await fresh([
    ask('B77', 'open'),
    step('B43', 'queued', { Owner: 'Kites', 'Waits for': "today's crew work" }),
    step('B76', 'queued', { Owner: 'Kites', 'Waits for': 'B77 says keep it' }),
    step('B78', 'queued', { Owner: 'Kites', 'Waits for': 'B79 lands' }),
    step('B79', 'done'),
  ])
  try {
    const lines = (await kites({ action: 'next' })).result.text.split('\n')
    assert.ok(lines.includes("- B43 queued (waiting: today's crew work, until the main chat clears it): Step B43"), lines.join('\n'))
    assert.ok(lines.includes('- B76 queued (waiting: B77 says keep it; B77 is open): Step B76'), lines.join('\n'))
    assert.ok(lines.includes('- B78 queued: Step B78'), lines.join('\n'))
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B306: unblock without "on" clears Waits for: the main chat or the person, with a History line; a worker may not', async () => {
  const { dir, main, kites, person } = await fresh([
    step('B43', 'queued', { Owner: 'Kites', 'Waits for': "today's crew work" }),
    step('B45', 'queued', { Owner: 'Sails', 'Waits for': 'the new sails' }),
    step('B46', 'queued', { Owner: 'Sails' }),
  ])
  try {
    const worker = await kites({ action: 'unblock', id: 'B43' })
    assert.equal(worker.status, 403)
    assert.equal(worker.why, 'Only the main chat or the person clears what B43 waits for.')
    const cleared = await main({ action: 'unblock', id: 'B43' })
    assert.equal(cleared.ok, true, cleared.why)
    const item = await itemOf(dir, 'B43')
    assert.equal(valueOf(item, 'Waits for'), null)
    assert.equal(item.sections.get('History').at(-1), "- 2026-10-17 12:00 Main: no longer waits for: today's crew work")
    assert.equal((await kites({ action: 'take', id: 'B43' })).ok, true)
    assert.equal((await person({ action: 'unblock', id: 'B45' })).ok, true)
    assert.equal((await itemOf(dir, 'B45')).sections.get('History').at(-1), '- 2026-10-17 12:00 person: no longer waits for: the new sails')
    // Nothing to clear: nothing changes.
    const none = await main({ action: 'unblock', id: 'B46' })
    assert.equal(none.ok, true)
    assert.equal(none.result.changed, false)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B306: the board shows the words-only wait on its Owner\'s lane', async () => {
  const { answer, step: did, toolResult, typed } = await import('../../fixtures/lines.mjs')
  const { parseConfig } = await import('../../src/config.mjs')
  const { storeFromText } = await import('../../src/work/read.mjs')
  const { buildState } = await import('../withStore.mjs')
  const at = NOW + 60 * MIN
  const app = name => JSON.stringify({ title: `Crew - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\crew', isArchived: false, createdAt: name.length, lastActivityAt: at - 40 * MIN, lastAssistantUuid: 'u-1' })
  const closing = ['Done.', '', '---', '', '```diff', '  Prompt: the sails', '  Who:    Crew - Kites', '+ Done:   yes', '```'].join('\n')
  const lines = [typed(at - 45 * MIN, 'The sails, please.'), did(at - 44 * MIN, 'Sew'), toolResult(at - 43 * MIN), answer(at - 30 * MIN, closing)]
  const raw = {
    listText: '{"prefix":"Crew - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Kites')],
    tails: { 'cli-Kites': { text: lines.join('\n'), isCut: false, modifiedAt: at - 30 * MIN } },
    planLineTexts: {},
    work: storeFromText("## Crew work\n- [ ] B43 The new sails (for Kites; after today's crew work)\n", { now: at - 60 * MIN }),
    adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const kites = buildState(raw, { lines: [], outbox: [], runs: [], now: at, config: { ...parseConfig('{}', {}), project: 'C:\crew' } }).chats.find(chat => chat.name === 'Kites')
  assert.equal(kites.state, 'free')
  assert.deepEqual(kites.flags.map(flag => [flag.kind, flag.text]), [['waits', "B43 waits for 'today's crew work': clear it or keep it"]])
})
