// The model chip (the person, 2026-10-24: "Can we make it visual on the board which model/effort level its running?"):
// beside the state of every chat on the Overview's worker list, a small chip says the model and effort the chat runs at
// now, as the app's own file of the chat says them, and, while the board waits for the main chat to switch a worker for
// its step, the change ("Sonnet · medium → Opus · high"). The page's own code, cut out of board.js between its marks;
// made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { demoSources } from '../fixtures/demo.mjs'
import { answer } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { EFFORT_WORDS } from '../src/work/effort.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const css = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('runchip')}\nObject.assign(this, { runChipOf, modelFacts, effortWord, EFFORT_WORDS })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const AT = new Date(2026, 9, 24, 9, 12).getTime()
const lane = (model, effort, more = {}) => ({ name: 'Units', model, effort, ...more })
const run = (more = {}) => ({ level: 'high', model: 'opus', usual: 'medium', usualModel: 'sonnet', step: 'B12', why: null, modelWhy: null, isSet: false, asked: { at: AT, state: 'delivered' }, waitsFor: null, ...more })

test('a chip says the model and the effort in words, in the colour of its model, with the setting in its tooltip', () => {
  assert.deepEqual(plain(page.runChipOf(lane('claude-opus-5-5', 'xhigh'))), {
    text: 'Opus · extra high', now: 'Opus · extra high', tone: 'opus', next: null,
    title: "Runs on Claude Opus 5.5 at extra high effort (the app's setting for this chat)",
  })
  assert.deepEqual(plain(page.runChipOf(lane('claude-sonnet-5-5', 'medium'))), {
    text: 'Sonnet · medium', now: 'Sonnet · medium', tone: 'sonnet', next: null,
    title: "Runs on Claude Sonnet 5.5 at medium effort (the app's setting for this chat)",
  })
  // Fable is the partner's rescue mode: max effort.
  const fable = page.runChipOf(lane('claude-fable-5-1', 'max'))
  assert.deepEqual([fable.text, fable.tone], ['Fable · max', 'fable'])
  assert.equal(fable.title, "Runs on Claude Fable 5.1 at max effort (the app's setting for this chat)")
  // Every level has its words, the same as the server's.
  assert.deepEqual(plain(page.EFFORT_WORDS), EFFORT_WORDS)
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max'].map(level => page.runChipOf(lane('claude-sonnet-5-5', level)).now), ['Sonnet · low', 'Sonnet · medium', 'Sonnet · high', 'Sonnet · extra high', 'Sonnet · max'])
})

test('a model id is read in its other forms; one that is not a Claude family shows its short name and is quiet', () => {
  // a date after the version, and the app's "[1m]" after it
  assert.equal(page.modelFacts('claude-opus-5-5[1m]').full, 'Claude Opus 5.5')
  assert.equal(page.modelFacts('claude-sonnet-4-5-20250929').full, 'Claude Sonnet 4.5')
  assert.equal(page.modelFacts('claude-sonnet-4-20250514').full, 'Claude Sonnet 4')
  // the older form, the version first
  assert.deepEqual(plain(page.modelFacts('claude-3-5-sonnet-20241022')), { family: 'sonnet', short: 'Sonnet', full: 'Claude Sonnet 3.5', tone: 'sonnet' })
  // another family of Claude: its own name, no colour of its own
  assert.deepEqual(plain(page.modelFacts('claude-haiku-4-5')), { family: 'haiku', short: 'Haiku', full: 'Claude Haiku 4.5', tone: 'other' })
  // not an id of that form: what follows "claude-" (cut when long), and the id whole in the tooltip
  assert.deepEqual(plain(page.modelFacts('claude-mystery')), { family: null, short: 'mystery', full: 'claude-mystery', tone: 'other' })
  const odd = plain(page.modelFacts('some-other-model-with-a-very-long-name'))
  assert.deepEqual([odd.short, odd.full, odd.tone], ['some-other-model-…', 'some-other-model-with-a-very-long-name', 'other'])
  const chip = page.runChipOf(lane('claude-mystery', 'low'))
  assert.deepEqual([chip.text, chip.tone, chip.title], ['mystery · low', 'other', "Runs on claude-mystery at low effort (the app's setting for this chat)"])
  assert.equal(page.modelFacts(null), null)
  assert.equal(page.modelFacts('  '), null)
  assert.equal(page.modelFacts(42), null)
})

test('no model and no effort is no chip; one of them says only that one', () => {
  for (const none of [lane(null, null), lane(undefined, undefined), lane('', ''), lane('  ', ' '), lane(7, {}), {}, null, undefined]) assert.equal(page.runChipOf(none), null)
  const modelOnly = page.runChipOf(lane('claude-opus-5-5', null))
  assert.deepEqual([modelOnly.text, modelOnly.tone, modelOnly.title], ['Opus', 'opus', "Runs on Claude Opus 5.5 (the app's setting for this chat; it does not say the effort)"])
  const effortOnly = page.runChipOf(lane(null, 'high'))
  assert.deepEqual([effortOnly.text, effortOnly.tone, effortOnly.title], ['high', 'other', "Runs at high effort (the app's setting for this chat; it does not say the model)"])
  // a level the page does not know stays as the app wrote it; a word of the object's own chain is no level
  assert.equal(page.runChipOf(lane('claude-sonnet-5-5', 'turbo')).text, 'Sonnet · turbo')
  assert.equal(page.runChipOf(lane('claude-sonnet-5-5', 'constructor')).text, 'Sonnet · constructor')
})

test('the Advisor\'s own effort is its high effort mode (an object): its app setting is appEffort', () => {
  const advisor = { name: 'Advisor', model: 'claude-opus-5-5', appEffort: 'xhigh', effort: { mode: 'usual', isSet: true } }
  assert.equal(page.runChipOf(advisor).text, 'Opus · extra high')
  // without the app's setting only the model is known
  assert.equal(page.runChipOf({ ...advisor, appEffort: null }).text, 'Opus')
  // a lane's effort is a string and wins
  assert.equal(page.runChipOf({ ...advisor, effort: 'low' }).text, 'Opus · low')
})

test('while the board waits for a switch the chip shows the change, with who was asked and when', () => {
  const pending = page.runChipOf(lane('claude-sonnet-5-5', 'medium', { effortRun: run() }))
  assert.deepEqual(plain(pending), {
    text: 'Sonnet · medium → Opus · high', now: 'Sonnet · medium', tone: 'sonnet', next: { text: 'Opus · high', tone: 'opus' },
    title: "Runs on Claude Sonnet 5.5 at medium effort (the app's setting for this chat)\nSwitching to Opus · high for B12: the main chat was asked to switch it at 09:12.",
  })
  // the switch from Opus down, and the effort alone (the settings name no model ids: `model` null)
  assert.equal(page.runChipOf(lane('claude-opus-5-5', 'xhigh', { effortRun: run({ level: 'medium', model: 'sonnet' }) })).text, 'Opus · extra high → Sonnet · medium')
  const effortOnly = page.runChipOf(lane('claude-opus-5-5', 'xhigh', { effortRun: run({ level: 'medium', model: null }) }))
  assert.deepEqual([effortOnly.text, effortOnly.next.tone], ['Opus · extra high → Opus · medium', 'opus'])
  // no word sent yet; a word that did not arrive; back to the usual setting (no step)
  assert.match(page.runChipOf(lane('claude-sonnet-5-5', 'medium', { effortRun: run({ asked: null }) })).title, /Switching to Opus · high for B12: the board has not asked the main chat to switch it yet\.$/)
  assert.match(page.runChipOf(lane('claude-sonnet-5-5', 'medium', { effortRun: run({ asked: { at: AT, state: 'expired' } }) })).title, /the main chat was asked to switch it at 09:12, but the word did not arrive\.$/)
  assert.match(page.runChipOf(lane('claude-opus-5-5', 'xhigh', { effortRun: run({ step: null, level: 'medium', model: 'sonnet' }) })).title, /Switching to Sonnet · medium, its usual setting: the main chat was asked/)
  // a family the page has no colour for is quiet
  assert.equal(page.runChipOf(lane('claude-sonnet-5-5', 'medium', { effortRun: run({ model: 'haiku' }) })).next.tone, 'other')
})

test('once the setting matches the chip is plain again, and a switch to the very setting it has shows nothing', () => {
  const set = page.runChipOf(lane('claude-opus-5-5', 'high', { effortRun: run({ isSet: true }) }))
  assert.deepEqual([set.text, set.next], ['Opus · high', null])
  assert.doesNotMatch(set.title, /Switching/)
  // the board's reading can lag the file by a moment: not set, yet the same words
  assert.equal(page.runChipOf(lane('claude-opus-5-5', 'high', { effortRun: run() })).text, 'Opus · high')
  assert.equal(page.runChipOf(lane('claude-sonnet-5-5', 'medium', { effortRun: null })).next, null)
  // a chat that tells nothing of itself has no chip, switch or not
  assert.equal(page.runChipOf(lane(null, null, { effortRun: run() })), null)
})

test('the page draws the chip beside the pill of every row, in Details and in Simple, and none on a leftover', () => {
  // Details: a lane's pill, the Advisor's and its helper's
  const lanes = script.slice(script.indexOf('function drawLane(lane, state)'), script.indexOf("$('lanes').addEventListener('click'"))
  assert.ok(lanes.includes("const runChip = lane.isLeftover ? null : drawRunChip(runChipOf(lane))"))
  assert.ok(lanes.indexOf('names.append(runChip)') > lanes.indexOf("laneStateText(lane)))"))
  const advisor = script.slice(script.indexOf('function drawAdvisorLane'), script.indexOf('function advisorProgress'))
  assert.ok(advisor.includes('const runChip = drawRunChip(runChipOf(advisor))'))
  const helper = script.slice(script.indexOf('function drawHelperCard'), script.indexOf("$('lanes').addEventListener('click', event => {\n  // B312"))
  assert.ok(helper.includes('const runChip = drawRunChip(runChipOf(helper))'))
  // Simple: the third cell, the time with the chip under it
  assert.ok(script.includes("const end = el('div', 'simple-end')"))
  assert.ok(script.includes('const chip = drawRunChip(row.run ?? null)'))
  // one name each: a second function of one name would silently shadow the first
  for (const name of ['runChipOf', 'drawRunChip', 'modelFacts', 'effortWord', 'runsLine', 'askedLine']) {
    assert.equal(script.split(new RegExp(`^(?:async )?function ${name}\\(`, 'm')).length, 2, name)
  }
  for (const name of ['EFFORT_WORDS', 'CHIP_TONES', 'chipWords']) assert.equal(script.split(new RegExp(`^const ${name} =`, 'm')).length, 2, name)
})

test('Simple\'s rows carry the chip\'s view only for a chat that has one', () => {
  const simple = {}
  vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\n${cut('calmoverview')}\n${cut('focus')}\n${cut('runchip')}\n${cut('simpleoverview')}\nObject.assign(this, { simpleWorkers })`, simple)
  const base = { isMain: false, isLeftover: false, task: null, eta: null, state: 'free' }
  const view = plain(simple.simpleWorkers([
    { ...base, name: 'Main', model: 'claude-opus-5-5', effort: 'xhigh' },
    { ...base, name: 'Audio' },
    { ...base, name: 'Features', model: 'claude-sonnet-5-5', effort: 'medium', effortRun: run() },
  ], { free: 3 }, AT, [{ ...base, name: 'Advisor', model: 'claude-fable-5-1', appEffort: 'max', effort: { mode: 'high' } }]))
  assert.deepEqual(view.rows.map(row => [row.name, row.run?.text ?? null]), [['Main', 'Opus · extra high'], ['Audio', null], ['Features', 'Sonnet · medium → Opus · high']])
  assert.equal('run' in view.rows[1], false)
  assert.deepEqual(view.partner.map(row => [row.name, row.run.text, row.run.tone]), [['Advisor', 'Fable · max', 'fable']])
})

test('the styles: three tones from tokens, a dashed edge while pending, wrapping at phone width', () => {
  assert.match(css, /:root \{ --chip-opus: #[0-9a-f]{6}; --chip-sonnet: #[0-9a-f]{6}; --chip-fable: var\(--ask\);/)
  for (const tone of ['opus', 'fable']) assert.match(css, new RegExp(`\\.run-chip\\.is-${tone} \\{ --chip: var\\(--chip-${tone}\\)`))
  assert.match(css, /\.run-chip \{ --chip: var\(--chip-sonnet\);/)
  // the tint, edge and text all come from the token
  const chip = css.match(/\.run-chip \{[^}]*\}/)[0]
  for (const part of ['border: 1px solid color-mix(in srgb, var(--chip) 38%', 'background: color-mix(in srgb, var(--chip) 11%', 'color: var(--chip)', 'font-size: 11.5px', 'max-width: 100%', 'flex-wrap: wrap']) assert.ok(chip.includes(part), part)
  assert.match(css, /\.run-chip\.is-pending \{ border-style: dashed; \}/)
  // the arrow and the setting after it never part; the chip wraps before them
  assert.match(css, /\.run-now, \.run-to \{ white-space: nowrap; \}/)
  // the setting that follows is as readable on the gold chip as on the others
  assert.match(css, /\.run-chip\.is-opus \.run-arrow, \.run-chip\.is-opus \.run-next \{ color: var\(--chip-ink\); \}/)
  // Simple: under the time, and under the task on a phone
  assert.match(css, /\.simple-end \{[^}]*flex-direction: column;[^}]*max-width: 150px;/)
  assert.match(css, /@media \(max-width: 600px\) \{\s*\.simple-end \{ display: contents; \}\s*\.simple-end \.run-chip \{ grid-column: 2 \/ -1;/)
})

// ---- what the server gives the page

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 24, 9, 30)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = (name, more = {}) => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...more,
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })

test('the state gives every chat its model and effort from the app\'s file: the main chat, workers, the Advisor and its helper', () => {
  const quiet = tail([answer(NOW - 30 * MIN, 'ok')])
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead","helper":"Second"}',
    appChatTexts: [
      app('Lead', { model: 'claude-opus-5-5', effort: 'xhigh' }),
      app('Digger', { model: 'claude-sonnet-5-5', effort: 'medium' }),
      app('Gardener'),
      app('Advisor', { model: 'claude-fable-5-1', effort: 'max' }),
      app('Second', { model: 'claude-sonnet-5-5', effort: 'low' }),
    ],
    tails: { 'cli-Lead': quiet, 'cli-Digger': quiet, 'cli-Gardener': quiet, 'cli-Advisor': quiet, 'cli-Second': quiet },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const state = buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
  assert.deepEqual(state.chats.map(one => [one.name, one.model ?? null, one.effort ?? null]), [
    ['Lead', 'claude-opus-5-5', 'xhigh'], ['Digger', 'claude-sonnet-5-5', 'medium'], ['Gardener', null, null],
  ])
  // The Advisor's own `effort` is B352's high effort mode: the app's setting is beside it.
  assert.deepEqual([state.advisor.model, state.advisor.appEffort, typeof state.advisor.effort.mode], ['claude-fable-5-1', 'max', 'string'])
  assert.deepEqual([state.advisorHelper.model, state.advisorHelper.effort], ['claude-sonnet-5-5', 'low'])
  // and the chips the page draws from them
  assert.equal(page.runChipOf(state.advisor).text, 'Fable · max')
  assert.equal(page.runChipOf(state.advisorHelper).text, 'Sonnet · low')
  assert.equal(page.runChipOf(state.chats[2]), null)
})

test('a chat whose file names neither has null for both', () => {
  const quiet = tail([answer(NOW - 30 * MIN, 'ok')])
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead","helper":"Second"}',
    appChatTexts: ['Lead', 'Advisor', 'Second'].map(name => app(name)),
    tails: { 'cli-Lead': quiet, 'cli-Advisor': quiet, 'cli-Second': quiet },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const state = buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
  assert.deepEqual([state.advisor.model, state.advisor.appEffort, state.advisorHelper.model, state.advisorHelper.effort], [null, null, null, null])
})

test('the demo board shows chips: workers on Opus and Sonnet, the Advisor and its helper, and one chat without a setting', async () => {
  const demo = await demoSources(NOW)
  const state = buildState(demo, { lines: demo.historyLines, now: NOW, config: { ...config, project: demo.project } })
  const words = Object.fromEntries(state.chats.map(one => [one.name, page.runChipOf(one)?.text ?? null]))
  assert.equal(words.Main, 'Opus · extra high')
  assert.equal(words.Features, 'Sonnet · medium')
  assert.equal(words.Audio, null)
  assert.equal(page.runChipOf(state.advisor).text, 'Opus · extra high')
  assert.equal(page.runChipOf(state.advisorHelper).text, 'Sonnet · medium')
  // and a worker whose next step needs another setting shows the switch
  assert.ok(state.chats.some(one => page.runChipOf(one)?.next !== null && page.runChipOf(one)?.next !== undefined))
})
