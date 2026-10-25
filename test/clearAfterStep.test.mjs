// Clear after each step (2026-10-23): the Workers mod clears a worker after its reported step, and the board keeps the
// conversation as a log. Here the board's side: it follows the chat to its new session (no lane lost, none doubled, no
// "not the chat the board shows"), shows "cleared after B<n> · log", tells the mod who is a worker, and a clear never
// makes an instruction count as missed. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

import { answer, typed } from '../fixtures/lines.mjs'
import { checkTake, clearRefusal, isUnknownSession, laneRole } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { readGameFile } from '../src/gameFile.mjs'
import { movedTo, parsePlanLine } from '../src/planLines.mjs'
import { readSources } from '../src/sources.mjs'
import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog, stamp } from '../src/work/migrate.mjs'
import { storeKeeper } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const NOW = Date.UTC(2026, 9, 23, 12, 5)
const MIN = 60_000
const LOG = '.claude/chat-logs/Units/2026-10-23 1405 B12.txt'
const BACKLOG = ['# Backlog', '', '## Art', '- [ ] B13 Draw the knight (for Units; about 1 h)', ''].join('\n')

/** A project whose worker Units was cleared: the app still names its old session, its old card names the new one. */
async function clearedProject(t, { appNames = 'units-old' } = {}) {
  await mkdir(DATA, { recursive: true })
  const root = await mkdtemp(join(DATA, 'test-clear-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const put = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  const chat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: join(root, 'project'), isArchived: false, createdAt: name.length, lastActivityAt: NOW })
  await put('project/.claude/chats/list.json', '{"prefix":"Game - ","main":"Main","afterStep":"clear"}')
  await put('project/.claude/chats/main-id.json', JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
  await put('project/.claude/chats/units-old.json', JSON.stringify({ movedTo: 'units-new', at: NOW - MIN }))
  await put('project/.claude/chats/units-new.json', JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW - MIN, cleared: { at: NOW - MIN, step: 'B12', log: LOG } }))
  await put('app/a/b/local_main.json', chat('Main', 'main-id'))
  await put('app/a/b/local_units.json', chat('Units', appNames))
  await put('transcripts/main-id.jsonl', [typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n'))
  await put('transcripts/units-old.jsonl', [typed(NOW - 30 * MIN, 'the old conversation'), answer(NOW - 20 * MIN, 'B12 is in.')].join('\n'))
  await put('transcripts/units-new.jsonl', '')
  const work = join(root, 'project', '.claude', 'work')
  await writeStore(work, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  // The person's words to Units, still open, filed before the clear.
  const filed = await workApi({ action: 'instruction', chat: 'Units', text: 'Use the red cape' }, { dir: work, now: NOW - 40 * MIN, prefix: 'Game - ', roleOf: name => ({ Main: 'main', Units: 'worker' })[name] ?? null })
  assert.equal(filed.ok, true, filed.why)
  const config = { ...parseConfig('{}', {}), project: join(root, 'project'), appSessions: join(root, 'app'), transcripts: join(root, 'transcripts') }
  return { root, config, work }
}

test('a card that says its chat moved names its new session; anything else names no move', () => {
  assert.equal(movedTo('{"movedTo":"units-new","at":1}'), 'units-new')
  for (const text of [null, '', '{"name":"Units"}', '{"movedTo":"../x"}', '{"movedTo":3}', '{ "movedTo": "a"']) assert.equal(movedTo(text), null)
})

test('the card of a cleared worker says so, with its step and its log; why a clear did not run stands beside a compaction', () => {
  const card = extra => JSON.stringify({ name: 'Units', state: 'waiting', task: null, at: NOW, ...extra })
  assert.deepEqual(parsePlanLine(card({ cleared: { at: NOW, step: 'B12', log: LOG }, compacted: { at: NOW - MIN, before: 1, after: 2 } })).compaction, { kind: 'cleared', at: NOW, step: 'B12', log: LOG, lastCleared: { at: NOW, step: 'B12' } })
  // A log outside the chat logs, or a path that climbs out, is not named.
  for (const log of ['../secret.txt', '.claude/chat-logs/../../x.txt', 'C:/x.txt', '.claude/chat-logs/U/a.jsonl']) {
    assert.equal(parsePlanLine(card({ cleared: { at: NOW, step: 'B12', log } })).compaction.log, null)
  }
  // A compaction after a clear that did not run: the compaction, and why not cleared.
  assert.deepEqual(parsePlanLine(card({ compacted: { at: NOW, before: 400_000, after: 90_000 }, clearNote: { at: NOW - 10, why: 'the person pauses the chats' } })).compaction,
    { kind: 'compacted', at: NOW, before: 400_000, after: 90_000, notCleared: { at: NOW - 10, why: 'the person pauses the chats' } })
  // A later compaction outweighs an older clear.
  assert.equal(parsePlanLine(card({ cleared: { at: NOW - MIN, step: 'B12', log: LOG }, compacted: { at: NOW, before: 1, after: 2 } })).compaction.kind, 'compacted')
  // B547: why a clear did not run, newer than the last clear and every compaction, is shown, not hidden behind the clear;
  // the last clear stays named beside it.
  assert.deepEqual(parsePlanLine(card({ cleared: { at: NOW - 2 * MIN, step: 'B12', log: LOG }, compacted: { at: NOW - 3 * MIN, before: 1, after: 2 }, clearNote: { at: NOW, why: 'a subagent it started still runs (1)' } })).compaction,
    { kind: 'not-cleared', at: NOW, why: 'a subagent it started still runs (1)', notCleared: { at: NOW, why: 'a subagent it started still runs (1)' }, lastCleared: { at: NOW - 2 * MIN, step: 'B12' } })
  // Alone on a card it is shown too.
  assert.equal(parsePlanLine(card({ clearNote: { at: NOW, why: 'the person pauses the chats' } })).compaction.kind, 'not-cleared')
})

for (const appNames of ['units-old', 'units-new']) {
  test(`a cleared worker is one lane under its new session, ${appNames === 'units-old' ? 'while the app still names the old one' : 'once the app names the new one'}: its card, its queue and its open instructions stay`, async t => {
    const { config, work } = await clearedProject(t, { appNames })
    const raw = await readSources(config, async () => [], NOW, undefined, storeKeeper({ dir: work }))
    assert.deepEqual(raw.moved, appNames === 'units-old' ? [['units-old', 'units-new']] : [])
    assert.deepEqual(Object.keys(raw.tails).sort(), ['main-id', 'units-new'])
    const state = buildState(raw, { now: NOW, config })
    const lanes = state.chats.filter(chat => chat.name === 'Units')
    assert.equal(lanes.length, 1)
    const [units] = lanes
    assert.equal(units.session, 'units-new')
    assert.equal(units.removedAt, null)
    assert.deepEqual(units.compaction, { kind: 'cleared', at: NOW - MIN, step: 'B12', log: LOG, lastCleared: { at: NOW - MIN, step: 'B12' } })
    assert.deepEqual(units.queue.map(step => step.id), ['B13'])
    // Review 2: the session it went on from, while the app still names it, is read on to its end.
    assert.deepEqual(state.movedFrom, appNames === 'units-old' ? [{ session: 'units-old', name: 'Units' }] : [])
    assert.deepEqual(state.instructions.filter(one => one.chat === 'Units').map(one => [one.id, one.text, one.turns]), [['I1', 'Use the red cape', 0]])
    // The bridge serves the new session under the chat's name, and the old one no longer.
    assert.deepEqual(checkTake({ chat: 'Units', session: 'units-new' }, state), { ok: true, chat: 'Units' })
    assert.equal(checkTake({ chat: 'Units', session: 'units-old' }, state).status, 409)
  })
}

// X61 (2026-10-25, Worker 1: B620 reported 20:19, cleared 20:21, B657 taken 20:29; the PC crashed at 20:38): after the
// crash its card was written anew without the clear, and the board held its step and filed "took B657 on the
// conversation of B620". The conversation it is on began with the clear, after the report: nothing is owed.
for (const began of ['after', 'before']) {
  test(`a worker whose card lost its clear in a crash owes ${began === 'after' ? 'no clear: its conversation began after its report' : 'one still when its conversation began before its report'}`, async t => {
    await mkdir(DATA, { recursive: true })
    const root = await mkdtemp(join(DATA, 'test-crash-'))
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    const put = async (path, text) => {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), text)
    }
    const at = minutes => new Date(NOW - minutes * MIN).toISOString()
    const chat = (name, cliSessionId) => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: join(root, 'project'), isArchived: false, createdAt: name.length, lastActivityAt: NOW })
    await put('project/.claude/chats/list.json', '{"prefix":"Game - ","main":"Main","afterStep":"clear"}')
    await put('project/.claude/chats/main-id.json', JSON.stringify({ name: 'Main', role: 'main', state: 'waiting', task: null, at: NOW }))
    await put('project/.claude/chats/units-old.json', JSON.stringify({ movedTo: 'units-new', at: NOW - 8 * MIN }))
    // The card as the Workers mod wrote it anew after the crash: no clear, no compaction carried over.
    await put('project/.claude/chats/units-new.json', JSON.stringify({ name: 'Units', role: 'worker', state: 'working', task: { text: 'B13 Draw the shield', step: 1, steps: 2, left: 600_000, isReported: false }, at: NOW, mod: '0.20.0' }))
    await put('app/a/b/local_main.json', chat('Main', 'main-id'))
    await put('app/a/b/local_units.json', chat('Units', 'units-new'))
    await put('transcripts/main-id.jsonl', [typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n'))
    // Its transcript: the /clear at its head, the step's line, then the crash's zeros and the turn after the restart.
    const clearAt = began === 'after' ? 8 : 12
    await put('transcripts/units-new.jsonl', `${[
      JSON.stringify({ type: 'custom-title', customTitle: 'Game - Units', sessionId: 'units-new' }),
      JSON.stringify({ type: 'user', timestamp: at(clearAt), message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
      typed(NOW - 6 * MIN, 'work: B13 is yours; run work next'),
    ].join('\n')}\n${'\u0000'.repeat(4096)}${answer(NOW - MIN, 'Back after the restart.')}\n`)
    const work = join(root, 'project', '.claude', 'work')
    await writeStore(work, migrateBacklog('## Art\n- [ ] B14 Draw the cape (for Units; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
    await put('project/.claude/work/B12.md', ['Id: B12', 'Kind: step', 'Title: Draw the knight', 'State: review', 'Owner: Units', 'Activity: Art', `Since: ${stamp(NOW - 10 * MIN)}`, '',
      '## History', `- ${stamp(NOW - 30 * MIN)} Units: queued → taken`, `- ${stamp(NOW - 10 * MIN)} Units: in progress → review`, ''].join('\n'))
    await put('project/.claude/work/B13.md', ['Id: B13', 'Kind: step', 'Title: Draw the shield', 'State: in progress', 'Owner: Units', 'Activity: Art', `Since: ${stamp(NOW - 6 * MIN)}`, '',
      '## History', `- ${stamp(NOW - 7 * MIN)} server: refined → queued (given by the board to Units)`, `- ${stamp(NOW - 6 * MIN)} Units: queued → taken`, `- ${stamp(NOW - 6 * MIN)} Units: taken → in progress`, ''].join('\n'))
    const config = { ...parseConfig('{}', {}), project: join(root, 'project'), appSessions: join(root, 'app'), transcripts: join(root, 'transcripts') }
    const raw = await readSources(config, async () => [], NOW, undefined, storeKeeper({ dir: work }))
    const units = buildState(raw, { now: NOW, config, mods: { Units: '0.20.0' } }).chats.find(one => one.name === 'Units')
    assert.equal(units.session, 'units-new')
    assert.equal(units.compaction, null, 'the card holds no clear')
    if (began === 'after') assert.equal(units.clearOwed, null)
    else assert.deepEqual(units.clearOwed, { step: 'B12', reportedAt: NOW - 10 * MIN, clearedAt: null, why: null, canClear: true })
  })
}

test('a session the board shows under no name is read anew once; the board\'s roles; only a worker\'s conversation is kept and cleared', () => {
  const state = {
    chats: [{ name: 'Main', isMain: true, session: 'm' }, { name: 'Units', isMain: false, session: 'u' }, { name: 'Advisor', isMain: false, session: 'a' }, { name: 'Old', isLeftover: true, session: 'o' }],
    advisor: { name: 'Advisor', session: 'a' }, advisorHelper: { name: 'Advisor 2', session: 'h' },
  }
  assert.equal(isUnknownSession({ session: 'u-new' }, state), true)
  assert.equal(isUnknownSession({ session: 'u' }, state), false)
  assert.equal(isUnknownSession({ session: 'o' }, state), true)
  assert.deepEqual(['Main', 'Units', 'Advisor', 'Advisor 2', 'Old', 'Nobody'].map(name => laneRole(state, name)), ['main', 'worker', 'advisor', 'helper', null, null])
  assert.equal(clearRefusal(state, 'Units', 0), null)
  assert.equal(clearRefusal(state, 'Units', 1).why, 'Background work it started is still running: its answer would come into a cleared conversation.')
  assert.equal(clearRefusal(state, 'Main', 0).why, 'Main is the main chat: only a worker\'s conversation is cleared.')
  assert.equal(clearRefusal(state, 'Advisor', 0).why, 'Advisor is the partner: only a worker\'s conversation is cleared.')
  assert.equal(clearRefusal(state, 'Advisor 2', 0).why, 'Advisor 2 is the partner\'s helper: only a worker\'s conversation is cleared.')
  assert.equal(clearRefusal(state, 'Old', 0).status, 409)
})

test('the board answers a turn\'s end with the chat\'s role, and with how many questions of its block it could not file', async t => {
  const dir = await mkdtemp(join(DATA, 'test-clear-role-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const roles = { Main: 'main', Units: 'worker', Advisor: 'advisor', 'Advisor 2': 'helper' }
  const end = (chat, extra = {}) => workApi({ action: 'turn-ended', chat, since: NOW, ...extra }, { dir, now: NOW + MIN, prefix: 'Game - ', roleOf: name => roles[name] ?? null })
  for (const [chat, role] of Object.entries(roles)) assert.equal((await end(chat)).result.role, role)
  const filed = await end('Units', { forYou: [{ n: 1, kind: 'decide', text: ['Sheet A or B?'], options: ['A', 'B'], advice: 'A', pictures: [], play: '', ref: null }] })
  assert.equal(filed.ok, true, filed.why)
  assert.equal(filed.result.asked.length, 1)
  assert.equal(filed.result.unfiled, undefined)
  // Review 8: past the nine items the board files, the rest count as unfiled.
  const many = Array.from({ length: 11 }, (_one, i) => ({ n: i + 1, kind: 'do', text: [`Look at sheet number ${i + 1} of the knight in the game`], options: [], advice: '', pictures: [], play: '', ref: null }))
  const lots = await end('Units', { since: NOW + 2 * MIN, forYou: many })
  assert.equal(lots.ok, true, lots.why)
  assert.equal(lots.result.unfiled, 2)
})

test('a clear is no turn: an open instruction is not missed for it; the next real turn that ends without closing it is', async t => {
  const dir = await mkdtemp(join(DATA, 'test-clear-missed-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = at => ({ dir, now: at, prefix: 'Game - ', roleOf: name => ({ Main: 'main', Units: 'worker' })[name] ?? null })
  const units = (body, at) => workApi({ chat: 'Units', ...body }, ctx(at))
  assert.equal((await units({ action: 'instruction', text: 'Use the red cape' }, NOW)).result.id, 'I1')
  // The turn that reported the step began after the words came: it ends without closing them (missed once, as today).
  assert.deepEqual((await units({ action: 'turn-ended', since: NOW + MIN }, NOW + 5 * MIN)).result.missed, ['I1'])
  const missed = async () => valueOf((await readStore(dir)).items.get('I1'), 'Missed')
  assert.equal(await missed(), '1')
  // The clear and the start after it: the mod only asks for the next work, which marks nothing.
  const next = await units({ action: 'next' }, NOW + 6 * MIN)
  assert.equal(next.ok, true, next.why)
  assert.deepEqual(next.result.open.map(one => [one.id, one.turns, one.text]), [['I1', 1, 'Use the red cape']])
  assert.equal(await missed(), '1')
  // The fresh conversation's first turn ends without closing it: missed once more, as for any turn.
  assert.deepEqual((await units({ action: 'turn-ended', since: NOW + 7 * MIN }, NOW + 9 * MIN)).result.missed, ['I1'])
  assert.equal(await missed(), '2')
})

test('the lane says "cleared after B12 · log", the log opening in the file viewer; a compaction says why it was not cleared', async () => {
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const part = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// lanewindow:start'), script.indexOf('function laneWindowOf'))}\nObject.assign(this, { compactionLine, clearOwedLine })`, part)
  const line = part.compactionLine({ kind: 'cleared', at: 1, step: 'B12', log: LOG }, () => '14:05')
  assert.deepEqual({ ...line }, { text: 'cleared after B12', title: `Workers mod at 14:05: cleared after B12; the conversation before is kept in ${LOG}`, isWarning: false, log: LOG })
  assert.equal(part.compactionLine({ kind: 'cleared', at: 1, step: null, log: null }, () => '14:05').title, 'Workers mod at 14:05: cleared after its step; its log was not named')
  const compacted = part.compactionLine({ kind: 'compacted', at: 1, before: 400_000, after: 90_000, notCleared: { at: 1, why: 'the person pauses the chats' } }, () => '14:05')
  assert.equal(compacted.title, 'compacted at 14:05, from 400k to 90k tokens Not cleared at 14:05: the person pauses the chats.')
  // B547: the mod's newest word is why it did not clear: a warning on the row, its words in the tooltip.
  assert.deepEqual({ ...part.compactionLine({ kind: 'not-cleared', at: 1, why: 'a subagent it started still runs (1)' }, () => '14:05') },
    { text: 'not cleared after its step', title: 'Workers mod at 14:05: not cleared: a subagent it started still runs (1)', isWarning: true })
  // B547: a clear owed says so, with what happens next: the mod clears it, or an older one needs the restart.
  const owed = { step: 'B12', reportedAt: 1, clearedAt: null, why: null, canClear: true }
  assert.deepEqual({ ...part.clearOwedLine(owed, () => '14:05') }, { text: 'not cleared after B12', title: 'Reported B12 at 14:05, no clear known: its next step waits until its Workers mod clears it, as soon as the chat is idle.' })
  assert.match(part.clearOwedLine({ ...owed, canClear: false, clearedAt: 0, why: 'no answer' }, () => '14:05').title, /its last clear at 14:05: its Workers mod is too old to clear it now: restart its chat \(Pause all, restart the app, Resume all\)\. Why not cleared: no answer\.$/)
  assert.equal(part.clearOwedLine(null, () => '14:05'), null)
  // The row and the lane's window put the line with its "log" button where the compaction's line stands.
  assert.ok(script.includes("} else if (compacted !== null && compacted.log !== undefined) names.append(clearedNote(compacted))"))
  assert.ok(script.includes('open.dataset.gameFile = line.log'))
  assert.equal(script.split('\nfunction clearedNote(').length, 2)
})

test('a chat log larger than the file viewer\'s limit shows its last part, under the place of the whole', async t => {
  const root = await mkdtemp(join(DATA, 'test-clear-view-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const path = '.claude/chat-logs/Units/2026-10-23 1405 B12.txt'
  await mkdir(join(root, '.claude', 'chat-logs', 'Units'), { recursive: true })
  await writeFile(join(root, ...path.split('/')), `${'first line\n'.repeat(400_000)}the last words\n`)
  const shown = await readGameFile(root, path)
  const text = shown.body.toString('utf8')
  assert.match(text, /^\(The log is 4 MB: here its last 2048 KB\. The whole log: .*2026-10-23 1405 B12\.txt\)\n\nfirst line\n/)
  assert.ok(text.endsWith('the last words\n'))
  // Any other large file is still not shown.
  await writeFile(join(root, 'big.txt'), 'x'.repeat(2_000_000))
  assert.equal(await readGameFile(root, 'big.txt'), null)
})
