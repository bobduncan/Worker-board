// X76 (B705): a worker the board cleared after its report kept a stuck "busy" report and showed as working on no step
// for 23 minutes, so its next queued step waited behind it. A busy report whose conversation holds only the /clear's own
// entries (the command and its caveat) has no turn: the chat is free, or holds its step as before. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { line, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 26, 16, 30).getTime()
const PROJECT = 'C:\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const iso = at => new Date(at).toISOString()

const app = name => JSON.stringify({
  title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1',
})
/** What the Workers mod's /clear leaves in the new conversation: the app's caveat and the command, both written by the mod. */
const cleared = at => [
  line({ type: 'user', timestamp: iso(at), isMeta: true, origin: { kind: 'plugin', name: 'folder-branches' }, message: { role: 'user', content: '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>' } }),
  line({ type: 'user', timestamp: iso(at), origin: { kind: 'plugin', name: 'folder-branches' }, message: { role: 'user', content: '<command-name>/clear</command-name>\n <command-message>clear</command-message>' } }),
]
const stepItem = (id, owner, state) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${stamp(NOW - 40 * MIN)}\n`)
/** A busy report as the server keeps it: pinging every 5 s, the turn heard to start `busyFor` ago. */
const busy = busyFor => ({ state: 'busy', since: NOW - busyFor, busyAt: NOW - busyFor, background: false, at: NOW - 5_000, session: 'cli-Digger', mod: '0.20.0' })

function build({ lines, busyFor = 19 * MIN, items = [] }) {
  const work = storeFromText('## Board\n', { now: NOW - 60 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const raw = {
    listText: '{"prefix":"Team - ","main":"Lead"}', appChatTexts: ['Lead', 'Digger'].map(app),
    tails: { 'cli-Lead': { text: '', isCut: false, modifiedAt: NOW - MIN }, 'cli-Digger': { text: lines.join('\n'), isCut: false, modifiedAt: NOW - 19 * MIN } },
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 3 * 60 * MIN,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: { Lead: NOW - 5_000 }, other: {} },
    board: { startedAt: NOW - 30 * MIN, offSince: null }, reports: new Map([['Digger', busy(busyFor)]]),
  })
}
const digger = state => state.chats.find(chat => chat.name === 'Digger')

test('a busy report over a conversation that holds only the /clear is free, not working on no step', () => {
  assert.deepEqual([digger(build({ lines: cleared(NOW - 19 * MIN) })).state, digger(build({ lines: cleared(NOW - 19 * MIN) })).isRunning], ['free', true])
})

test('a turn that really runs after the clear is working; a turn heard to start seconds ago is given time to write its first line', () => {
  const running = build({ lines: [...cleared(NOW - 19 * MIN), typed(NOW - 2 * MIN, 'work: B1 is yours; run work next'), step(NOW - 20_000, 'Build')] })
  assert.equal(digger(running).state, 'working')
  assert.equal(digger(build({ lines: cleared(NOW - 19 * MIN), busyFor: 10_000 })).state, 'working')
})

test('a cleared chat that holds a step is interrupted as before, never free; a step in review holds none', () => {
  assert.equal(digger(build({ lines: cleared(NOW - 19 * MIN), items: [stepItem('B1', 'Digger', 'in progress')] })).state, 'interrupted')
  assert.equal(digger(build({ lines: cleared(NOW - 19 * MIN), items: [stepItem('B1', 'Digger', 'review')] })).state, 'free')
})
