// T2.1 part B: the Settings tab's part "Asset providers". The page's own logic (the API answer turned into the cards it
// draws) is cut out of board.js between its marks and run here. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const markup = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const cut = script.slice(script.indexOf('// providerCards:start'), script.indexOf('// providerCards:end'))
const page = {}
vm.runInNewContext(`${cut}\nObject.assign(this, { providerCardModels })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const card = (name, extra = {}) => ({ name, mode: 'auto', selectable: true, last: null, card: { title: name.toUpperCase(), line: `${name} line`, facts: ['a', 'b'], icon: 'manual' }, ...extra })
const check = (state, detail, why = '') => ({ state, ok: state === 'works', why, detail, at: '2026-11-02T10:00:00Z' })
const kinds = [
  { kind: 'visual', inUse: 'codex', cards: [
    card('codex', { last: check('works', 'Works · signed in') }),
    card('elevenlabs-images', { last: check('needs', 'Needs the Pro plan', 'Plan is free') }),
    card('claude', { selectable: false }),
  ] },
  { kind: 'music', inUse: 'person-suno', cards: [
    card('person-suno', { last: check('works', '') }),
    card('elevenlabs-music', { last: check('needs', 'Paste your key first', 'No ElevenLabs key (X)') }),
  ] },
  { kind: 'sound effect', inUse: 'sound-library', cards: [card('sound-library', { last: check('off', '', 'Switched off') })] },
]
const models = (ui) => plain(page.providerCardModels(kinds, ui))

test('the row of a kind: heading, the card in use first with its badge and "Verify", the room for more providers', () => {
  const [visual, music, sound] = models()
  assert.deepEqual([visual.title, visual.about, visual.hasRoom, music.hasRoom, sound.hasRoom], ['Art and visuals', 'units, maps, props, effects', false, true, true])
  const [inUse, other] = visual.cards
  assert.deepEqual([inUse.badge, inUse.inUse, inUse.buttonLabel, inUse.buttonDisabled, inUse.resultText, inUse.tone], ['In use', true, 'Verify', false, '✓ Works · signed in', 'ok'])
  assert.deepEqual([other.badge, other.inUse, other.buttonLabel], [null, false, 'Verify & use'])
})

test('needs shows the warning in the attention tone; works without a detail says "Works"; off is quiet', () => {
  const [visual, music, sound] = models()
  assert.deepEqual([visual.cards[1].resultText, visual.cards[1].tone, visual.cards[1].takesKey], ['⚠ Needs the Pro plan', 'attention', false])
  assert.deepEqual([music.cards[0].resultText, music.cards[0].tone], ['✓ Works', 'ok'])
  assert.deepEqual([sound.cards[0].resultText, sound.cards[0].tone], ['Switched off', 'quiet'])
})

test('a card that is not for the kind is greyed with a disabled "Not for this kind" and no result', () => {
  const grey = models().at(0).cards[2]
  assert.deepEqual([grey.greyed, grey.buttonLabel, grey.buttonDisabled, grey.resultText, grey.takesKey], [true, 'Not for this kind', true, '', false])
})

test('a provider never checked says "Not checked yet" in the quiet tone', () => {
  const rows = plain(page.providerCardModels([{ kind: 'music', inUse: null, cards: [card('manual')] }]))
  assert.deepEqual([rows[0].cards[0].resultText, rows[0].cards[0].tone, rows[0].cards[0].badge], ['Not checked yet', 'quiet', null])
})

test('a card that waits for a key shows the key field; once it works it does not', () => {
  const [, music] = models()
  assert.equal(music.cards[1].takesKey, true)
  const byWhy = plain(page.providerCardModels([{ kind: 'music', inUse: null, cards: [card('x', { last: check('needs', 'Not set', 'The API key was refused') })] }]))
  assert.equal(byWhy[0].cards[0].takesKey, true)
  const works = plain(page.providerCardModels([{ kind: 'music', inUse: null, cards: [card('x', { last: check('works', 'Key found') })] }]))
  assert.equal(works[0].cards[0].takesKey, false)
})

test('while a check runs the button says "Checking…" and is disabled; a refusal stays on the card', () => {
  const ui = { busy: new Set(['visual|elevenlabs-images']), problems: new Map([['visual|codex', 'No fresh passing check']]) }
  const [visual] = models(ui)
  assert.deepEqual([visual.cards[1].buttonLabel, visual.cards[1].buttonDisabled, visual.cards[1].busy], ['Checking…', true, true])
  assert.equal(visual.cards[0].problem, 'No fresh passing check')
  for (const none of [undefined, null, 'nonsense', []]) assert.deepEqual(plain(page.providerCardModels(none)), [], String(none))
})

test('the Settings tab has the part "Who makes your assets?"; the Design tab no longer has "Asset providers"', () => {
  assert.match(markup, /data-tab="settings">Settings</)
  const settings = markup.slice(markup.indexOf('id="view-settings"'), markup.indexOf('<dialog class="details"'))
  assert.match(settings, /<h2 id="settings-providers-title">Who makes your assets\?<\/h2>/)
  assert.match(settings, /One provider per kind\. Workers, the Advisor and the board ask the chosen one\. A choice saves once Verify passes\./)
  assert.match(settings, /id="providers-rows"/)
  const design = markup.slice(markup.indexOf('id="view-design"'), markup.indexOf('id="view-bugs"'))
  assert.ok(!design.includes('Asset providers') && !design.includes('design-providers'))
  assert.ok(!script.includes('drawProviders') && !script.includes('providerLines'))
})
