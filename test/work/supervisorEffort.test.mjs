// T7.5 (the person, 2026-10-28: "do B", and "A": Sonnet, low): the board holds the Supervisor's chat at its own model and
// effort by code, with the word it gives a worker (`worker-effort`), a running chat's Workers mod setting it first. Made-up
// chats; the model ids are the app's form, as the settings name them.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, typed } from '../../fixtures/lines.mjs'
import { shownChats } from '../../src/bridge.mjs'
import { parseConfig } from '../../src/config.mjs'
import { handJobs, isHandWord } from '../../src/hands.mjs'
import { memoryStore } from '../../src/store.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { AGAIN_MS, effortWords } from '../../src/work/effort.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { storeFromText } from '../../src/work/read.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { SUPERVISOR_EFFORT, SUPERVISOR_MODEL, supervisorEffortWord, supervisorRun, supervisorSetting } from '../../src/work/supervisorEffort.mjs'
import { buildState } from '../withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 28, 12, 0).getTime()
const PROJECT = 'C:\\garden'
const IDS = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }
const SONNET_LOW = { model: 'sonnet', effort: 'low' }

const lane = (more = {}) => ({ name: 'Watcher', appSession: 'local_Watcher', model: IDS.opus, effort: 'high', ...more })
const wordFor = (more = {}) => supervisorEffortWord({ lane: lane(), setting: SONNET_LOW, models: IDS, sent: [], now: NOW, main: 'Lead', prefix: 'Team - ', ...more })
/** A word of the outbox that set the Supervisor's chat, as `effortWords` makes it. */
const sentWord = (more = {}) => ({ id: 'w1', at: NOW - 10 * MIN, to: 'Lead', command: 'worker-effort', about: 'Watcher', effort: 'low', model: IDS.sonnet, state: 'delivered', ...more })

test('the setting comes from the settings: a family of models and a level, Sonnet and low where they say none or something else', () => {
  assert.deepEqual([SUPERVISOR_MODEL, SUPERVISOR_EFFORT], ['sonnet', 'low'])
  assert.deepEqual(supervisorSetting({}), SONNET_LOW)
  assert.deepEqual(supervisorSetting(), SONNET_LOW)
  assert.deepEqual(supervisorSetting({ supervisorModel: 'opus', supervisorEffort: 'xhigh' }), { model: 'opus', effort: 'xhigh' })
  assert.deepEqual(supervisorSetting({ supervisorModel: 'sonnet', supervisorEffort: 'max' }), { model: 'sonnet', effort: 'max' })
  // Never Fable, nor any family or level the app does not name.
  for (const bad of ['fable', 'claude-fable-5-1', 'haiku', 'OPUS', '', null, 7, undefined]) assert.equal(supervisorSetting({ supervisorModel: bad }).model, 'sonnet', String(bad))
  for (const bad of ['ultra', 'LOW', '', null, 7, undefined]) assert.equal(supervisorSetting({ supervisorEffort: bad }).effort, 'low', String(bad))
  // The settings' own file: parsed and checked with the other keys.
  assert.deepEqual(supervisorSetting(parseConfig('{}', {})), SONNET_LOW)
  assert.deepEqual(supervisorSetting(parseConfig('{"supervisorModel":" Opus ","supervisorEffort":"High"}', {})), { model: 'opus', effort: 'high' })
  assert.deepEqual(supervisorSetting(parseConfig('{"supervisorModel":"fable","supervisorEffort":"ultra"}', {})), SONNET_LOW)
})

test('a word when the chat runs another effort, with the shape of a worker\'s word and the setting named in its reason', () => {
  assert.deepEqual(wordFor(), {
    to: 'Lead', chat: 'Watcher', session: 'local_Watcher', level: 'low', model: IDS.sonnet, usual: 'low', usualModel: IDS.sonnet, step: null,
    why: 'the Supervisor\'s setting on the board: Sonnet, low',
  })
  assert.equal(wordFor({ lane: lane({ model: IDS.sonnet }) })?.level, 'low')
  assert.equal(wordFor({ lane: lane({ model: IDS.sonnet, effort: 'medium' }), setting: { model: 'sonnet', effort: 'xhigh' } })?.why, 'the Supervisor\'s setting on the board: Sonnet, extra high')
  assert.equal(wordFor({ setting: { model: 'opus', effort: 'high' }, lane: lane({ model: IDS.sonnet, effort: 'low' }) })?.model, IDS.opus)
  // Its words are the delivery's: the same lines as a worker's, no step.
  assert.equal(effortWords(wordFor()).text, ['set model and effort', 'Chat: Watcher', 'Session: local_Watcher', `Model: ${IDS.sonnet}`, 'Effort: low', 'Why: the Supervisor\'s setting on the board: Sonnet, low'].join('\n'))
})

test('a word when the chat runs another model family at the setting\'s effort; none at both; a file that names no model is not set', () => {
  assert.equal(wordFor({ lane: lane({ effort: 'low' }) })?.level, 'low')
  assert.equal(wordFor({ lane: lane({ model: IDS.sonnet, effort: 'low' }) }), null)
  // The app's id in another form of the same family ("[1m]") is the same family.
  assert.equal(wordFor({ lane: lane({ model: `${IDS.sonnet}[1m]`, effort: 'low' }) }), null)
  assert.equal(wordFor({ lane: lane({ model: null, effort: 'low' }) })?.model, IDS.sonnet)
  assert.equal(wordFor({ lane: lane({ model: undefined, effort: 'low' }) })?.model, IDS.sonnet)
})

test('without model ids in the settings the word is the effort alone, and the model is not judged', () => {
  const alone = wordFor({ models: {} })
  assert.deepEqual([alone.level, alone.model, alone.usualModel], ['low', null, null])
  assert.equal(effortWords(alone).text.split('\n')[0], 'set effort')
  assert.equal(wordFor({ models: {}, lane: lane({ effort: 'low' }) }), null)
  assert.equal(wordFor({ models: undefined, lane: lane({ effort: 'low' }) }), null)
  // Never Fable: an id of the settings that names it is no id.
  assert.equal(wordFor({ models: { sonnet: 'claude-fable-5-1', opus: IDS.opus } })?.model, null)
  assert.equal(wordFor({ models: { sonnet: 'claude-fable-5-1', opus: IDS.opus }, lane: lane({ effort: 'low' }) }), null)
  // And an id comes only for a family of the app's that a step may name, whatever the settings list besides.
  assert.equal(wordFor({ setting: { model: 'haiku', effort: 'low' }, models: { ...IDS, haiku: 'claude-haiku-5-1' }, lane: lane({ effort: 'high' }) })?.model, null)
})

test('no word without the chat, without its effort in the app\'s file, or without a main chat', () => {
  assert.equal(wordFor({ lane: null }), null)
  assert.equal(wordFor({ lane: undefined }), null)
  assert.equal(wordFor({ lane: lane({ effort: null }) }), null)
  assert.equal(wordFor({ lane: lane({ effort: undefined }) }), null)
  assert.equal(wordFor({ lane: lane({ effort: '' }) }), null)
  assert.equal(wordFor({ main: null }), null)
  assert.equal(wordFor({ main: undefined }), null)
})

test('the same word goes once in half an hour, also when it went untaken; again after; a new target at once', () => {
  for (const state of ['waiting', 'taken', 'delivered', 'failed', 'expired']) assert.equal(wordFor({ sent: [sentWord({ state })] }), null, state)
  // After AGAIN_MS it goes again (a word that never took).
  assert.equal(wordFor({ sent: [sentWord({ at: NOW - AGAIN_MS + 1 })] }), null)
  assert.equal(wordFor({ sent: [sentWord({ at: NOW - AGAIN_MS })] })?.chat, 'Watcher')
  // A word for another target within the half hour does not hold this one: the person changed the setting.
  assert.equal(wordFor({ sent: [sentWord({ effort: 'high', model: IDS.opus })] })?.level, 'low')
  assert.equal(wordFor({ sent: [sentWord({ model: IDS.opus })] })?.model, IDS.sonnet)
  assert.equal(wordFor({ sent: [sentWord({ model: null })] })?.model, IDS.sonnet)
  assert.equal(wordFor({ setting: { model: 'opus', effort: 'high' }, lane: lane({ model: IDS.sonnet, effort: 'low' }), sent: [sentWord()] })?.level, 'high')
  // Only the newest word for the chat counts, and only words about this chat, by its title or its name.
  assert.equal(wordFor({ sent: [sentWord(), sentWord({ id: 'w2', at: NOW - MIN, effort: 'high', model: IDS.opus })] })?.level, 'low')
  assert.equal(wordFor({ sent: [sentWord({ about: 'Worker 1' })] })?.chat, 'Watcher')
  assert.equal(wordFor({ sent: [sentWord({ about: 'Team - Watcher' })] }), null)
  assert.equal(wordFor({ sent: [{ ...sentWord(), command: 'partner-effort' }] })?.chat, 'Watcher')
})

test('the setting for the page: the setting\'s family and level, and whether the chat\'s file shows them', () => {
  assert.deepEqual(supervisorRun({ lane: lane({ model: IDS.sonnet, effort: 'low' }), setting: SONNET_LOW }), { model: 'sonnet', effort: 'low', isSet: true })
  assert.deepEqual(supervisorRun({ lane: lane(), setting: SONNET_LOW }), { model: 'sonnet', effort: 'low', isSet: false })
  assert.equal(supervisorRun({ lane: lane({ model: IDS.sonnet, effort: 'high' }), setting: SONNET_LOW }).isSet, false)
  assert.equal(supervisorRun({ lane: lane({ model: IDS.opus, effort: 'low' }), setting: SONNET_LOW }).isSet, false)
  assert.equal(supervisorRun({ lane: lane({ model: null, effort: 'low' }), setting: SONNET_LOW }).isSet, false)
  assert.equal(supervisorRun({ lane: lane({ effort: null }), setting: SONNET_LOW }).isSet, false)
  assert.deepEqual(supervisorRun({ lane: null, setting: SONNET_LOW }), { model: 'sonnet', effort: 'low', isSet: false })
  // Where the settings name no id for the family, the board sets the effort alone: so it judges that alone.
  assert.equal(supervisorRun({ lane: lane({ effort: 'low' }), setting: SONNET_LOW, models: {} }).isSet, true)
  assert.equal(supervisorRun({ lane: lane({ effort: 'low' }), setting: SONNET_LOW, models: IDS }).isSet, false)
})

// The state: the Supervisor's chat among the board's chats, as the app's files of the chats say them.
const config = { ...parseConfig(JSON.stringify({ models: IDS }), {}), project: PROJECT }
const app = (name, effort, model) => JSON.stringify({
  title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', effort, model,
})
const quiet = { text: [typed(NOW - 20 * MIN, 'Sweep.'), answer(NOW - 5 * MIN, 'Nothing looks wrong.')].join('\n'), isCut: false, modifiedAt: NOW - 5 * MIN }
function build({ effort = 'high', model = IDS.opus, outbox = [], settings = config, now = NOW, list = '{"prefix":"Team - ","main":"Lead","supervisor":"Watcher"}' } = {}) {
  const raw = {
    listText: list,
    appChatTexts: [app('Lead', 'medium', IDS.sonnet), app('Digger', 'medium', IDS.sonnet), app('Watcher', effort, model)],
    tails: { 'cli-Lead': quiet, 'cli-Digger': quiet, 'cli-Watcher': quiet },
    planLineTexts: {}, work: storeFromText('## Board\n', { now: NOW - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: NOW - 3 * 60 * MIN,
  }
  return buildState(raw, {
    lines: [], outbox, runs: [], now, config: settings, seen: { shown: { Lead: now - 5_000, Digger: now - 5_000, Watcher: now - 5_000 }, other: {} },
    board: { startedAt: NOW - 60 * MIN, offSince: null },
  })
}
const wordsOf = state => state.reconciled.efforts.map(one => [one.to, one.chat, one.level, one.model, one.step, one.session])

test('the state: the Supervisor on Opus at high gets one worker-effort word about it, to the main chat, back to Sonnet at low', () => {
  const state = build()
  assert.deepEqual(wordsOf(state), [['Lead', 'Watcher', 'low', IDS.sonnet, null, 'local_Watcher']])
  assert.equal(state.reconciled.efforts[0].why, 'the Supervisor\'s setting on the board: Sonnet, low')
  assert.deepEqual(state.supervisorChat.setting, { model: 'sonnet', effort: 'low', isSet: false })
  // The chat's own card says what it runs on, as before.
  assert.deepEqual([state.supervisorChat.model, state.supervisorChat.effort], [IDS.opus, 'high'])
})

test('the state: at the setting there is no word; the word of ten minutes ago holds it; the settings may name another setting', () => {
  const set = build({ effort: 'low', model: IDS.sonnet })
  assert.deepEqual(wordsOf(set), [])
  assert.deepEqual(set.supervisorChat.setting, { model: 'sonnet', effort: 'low', isSet: true })
  // The same word went ten minutes ago: no second word, however often the state is made.
  const sent = [{ ...effortWords({ to: 'Lead', chat: 'Watcher', session: 'local_Watcher', level: 'low', model: IDS.sonnet, usual: 'low', usualModel: IDS.sonnet, step: null, why: 'x' }), id: 'w1', at: NOW - 10 * MIN, state: 'delivered' }]
  assert.deepEqual(wordsOf(build({ outbox: sent })), [])
  assert.deepEqual(wordsOf(build({ outbox: sent, now: NOW + AGAIN_MS })), [['Lead', 'Watcher', 'low', IDS.sonnet, null, 'local_Watcher']])
  // Another setting in the settings: a word for it at once.
  const other = build({ outbox: sent, settings: { ...config, supervisorModel: 'opus', supervisorEffort: 'high' }, effort: 'low', model: IDS.sonnet })
  assert.deepEqual(wordsOf(other), [['Lead', 'Watcher', 'high', IDS.opus, null, 'local_Watcher']])
  assert.deepEqual(other.supervisorChat.setting, { model: 'opus', effort: 'high', isSet: false })
})

test('the state: no word without a Supervisor on the list, with no model ids in the settings the effort alone, and none about a worker that is set', () => {
  const none = build({ list: '{"prefix":"Team - ","main":"Lead"}' })
  assert.equal(none.supervisorChat, null)
  assert.deepEqual(wordsOf(none), [])
  const alone = build({ settings: { ...config, models: {} }, model: IDS.sonnet })
  assert.deepEqual(wordsOf(alone), [['Lead', 'Watcher', 'low', null, null, 'local_Watcher']])
  // Workers keep their own plan: Digger runs at the usual setting and gets no word.
  assert.deepEqual(build().reconciled.efforts.map(one => one.chat), ['Watcher'])
})

test('hands: a hand claims the word as a set job for the Supervisor\'s chat; the Supervisor itself gets it back for the main chat', () => {
  const state = build()
  const message = { id: 's1', at: NOW, ...effortWords(state.reconciled.efforts[0]), state: 'waiting' }
  const lanes = shownChats(state)
  assert.ok(lanes.some(one => one.name === 'Watcher' && one.appSession === 'local_Watcher'))
  assert.equal(isHandWord(message, { canSet: true }), true)
  assert.equal(isHandWord(message), false)
  assert.deepEqual(handJobs({ caller: 'Digger', taken: [message], lanes, now: NOW }), {
    jobs: [{ id: 's1', to: 'local_Watcher', chat: 'Watcher', set: { model: IDS.sonnet, effort: 'low' } }], back: [],
  })
  assert.deepEqual(handJobs({ caller: 'Watcher', taken: [message], lanes, now: NOW }), { jobs: [], back: ['s1'] })
})

test('the delivery sends the word once to the main chat, as it does a worker\'s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supervisor-effort-'))
  try {
    await writeStore(dir, migrateBacklog('# Backlog\n\n## Garden\n', { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
    const outbox = memoryStore()
    let n = 0
    const state = build()
    const work = { ok: true, dir, ...(await readStore(dir)) }
    assert.equal(work.ok, true)
    const deliver = at => deliverWork({ state, dir, outbox, apply: async () => ({ ok: true }), now: at, maxChars: 2000, newId: () => `m${(n += 1)}` })
    const done = await deliver(NOW)
    assert.deepEqual(done.sent.map(one => [one.to, one.command, one.about, one.effort, one.model]), [['Lead', 'worker-effort', 'Watcher', 'low', IDS.sonnet]])
    assert.equal(done.sent[0].text.includes('Step:'), false)
    // Planned again before the state shows it: the delivery's own dedupe holds it.
    assert.deepEqual((await deliver(NOW + MIN)).sent, [])
    assert.equal(outbox.outbox().filter(one => one.command === 'worker-effort').length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
