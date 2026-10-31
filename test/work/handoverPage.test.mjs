// T8.5, step 2: the page's words for the sequence. A worker on it (the setting "sequence" and its mod 0.27.0) carries
// `onSequence` and where its hand-over stands (`handover`), and its lane a quiet line: "held: <why>", "handing over B12",
// "offered B12, not taken yet", "did not answer its hand-over (B12)". On the timers, or on an older mod, nothing of it.
// The setting itself: "timers" unless set. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../../src/state.mjs'
import { HANDOVER_COMMAND, STATES, laneWords } from '../../src/work/handover.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { storeFromText } from '../../src/work/read.mjs'

const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const MIN = 60_000

function build({ handover, mod, outbox = [] }) {
  const work = storeFromText('## Work\n', { now: NOW - 60 * MIN })
  const add = text => { const one = parseItem(text); work.items.set(one.head.get('Id'), one); work.activities[0].steps.push(one.head.get('Id')) }
  add(`Id: B13\nKind: step\nTitle: Paint the gate\nState: refined\nRefined: ready\nSince: ${stamp(NOW - 60 * MIN)}\n`)
  const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: NOW - 60_000, lastAssistantUuid: 'u' })
  return buildState({ listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: ['Lead', 'Worker 1'].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work },
    { lines: [], outbox, runs: [], now: NOW, mods: { 'Worker 1': mod }, config: { ...parseConfig(JSON.stringify(handover === undefined ? {} : { handover }), {}), project: 'C:\\game' } })
}
const failed = { id: 'e1', at: NOW - 2 * MIN, to: 'Worker 1', command: HANDOVER_COMMAND, text: 'hand-over', state: 'failed', kind: 'clear', step: null, clear: { step: 'B12', reportedAt: NOW - 3 * MIN }, restart: false, set: null, line: null, settledAt: NOW - MIN, outcome: { cleared: false, background: true, why: 'background work it started still runs' } }

test('the setting: "timers" unless set; "sequence" when set; anything else keeps the timers', () => {
  assert.equal(parseConfig('{}', {}).handover, 'timers')
  assert.equal(parseConfig('{"handover":"sequence"}', {}).handover, 'sequence')
  assert.equal(parseConfig('{"handover":"clocks"}', {}).handover, 'timers')
})

test('a worker on the sequence carries its state and a quiet line on its lane; on the timers or an older mod, none', () => {
  const lane = state => state.chats.find(one => one.name === 'Worker 1')
  const on = lane(build({ handover: 'sequence', mod: '0.27.0', outbox: [failed] }))
  assert.equal(on.onSequence, true)
  assert.equal(on.handover.state, STATES.HELD)
  assert.deepEqual(on.flags.filter(flag => flag.kind === 'handover').map(flag => flag.text), ['held: its clear did not run: background work it started still runs'])
  for (const off of [build({ mod: '0.27.0', outbox: [failed] }), build({ handover: 'sequence', mod: '0.26.10', outbox: [failed] })]) {
    assert.equal(lane(off).onSequence, false)
    assert.equal(lane(off).handover, null)
    assert.deepEqual(lane(off).flags.filter(flag => flag.kind === 'handover'), [])
  }
})

test('the words of each state, and the page shows them quiet (no amber, no button)', async () => {
  assert.equal(laneWords({ state: STATES.HANDING, step: 'B12', why: null }), 'handing over B12')
  assert.equal(laneWords({ state: STATES.HANDING, step: null, why: null }), 'handing over: its clear')
  assert.equal(laneWords({ state: STATES.OFFERED, step: 'B12', why: null }), 'offered B12, not taken yet')
  assert.equal(laneWords({ state: STATES.UNKNOWN, step: 'B12', why: 'did not answer its hand-over (B12)' }), 'did not answer its hand-over (B12)')
  assert.equal(laneWords({ state: STATES.UNKNOWN, step: null, why: 'its turn runs' }), null)
  assert.equal(laneWords({ state: STATES.FREE, step: null, why: null }), null)
  const script = await readFile(new URL('../../public/board.js', import.meta.url), 'utf8')
  const part = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// laneflags:start'), script.indexOf('// laneflags:end'))}\nObject.assign(this, { laneFlags })`, part)
  const shown = part.laneFlags({ name: 'Worker 1', flags: [{ kind: 'handover', id: 'B12', text: 'held: its clear did not run', button: null }] }, { main: 'Lead' })
  assert.deepEqual(JSON.parse(JSON.stringify(shown)), [{ text: 'held: its clear did not run', tone: 'quiet', button: null }])
})
