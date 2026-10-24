// B536 (a fix of B524): what the person typed, noted, picked and left open survives every reload of the page. The page's
// own functions run here on stub storage and stub boxes: emptying `keepForReload`, `restoreKept` or `finishRestore`
// must turn a test red (the helpers `keptState` and `keptBack` are tested in selfUpdate.test.mjs). Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const functions = script.slice(script.indexOf("/** B524: the words in the page's own boxes"), script.indexOf('/** The note on top (see `updateView`)'))
assert.ok(functions.includes('function keepForReload()') && functions.includes('function finishRestore()'), 'the keep and restore functions are cut out')

/** A box of the page: text boxes match the text selector, the others (a checkbox) do not. */
const box = (id, value = '', isText = true) => ({
  id, value, isText, heard: 0,
  matches() { return this.isText },
  dispatchEvent(event) { if (event.type === 'input' && event.bubbles) this.heard += 1 },
})

/** The page's own state around the functions (as board.js declares it), over stub storage and boxes. */
function makePage({ stored = null, boxes = [], popup = { open: false, childNodes: [1] }, storage = {} } = {}) {
  const shown = []
  const store = new Map(stored === null ? [] : [['kept-state', stored]])
  const sessionStorage = {
    getItem: key => store.get(key) ?? null,
    removeItem: key => store.delete(key),
    setItem: (key, text) => {
      if (storage.isFull) throw new Error('QuotaExceededError')
      store.set(key, text)
    },
  }
  const document = {
    querySelectorAll: () => boxes,
    getElementById: id => (id === 'details' ? popup : boxes.find(one => one.id === id) ?? null),
  }
  popup.showModal = () => { popup.open = true; shown.push('showModal') }
  const context = { sessionStorage, document, Event: class { constructor(type, init = {}) { this.type = type; this.bubbles = init.bubbles === true } } }
  vm.runInNewContext(`
const MIN = 60000
const KEPT_KEY = 'kept-state'
let keptText = null
let kept = null
let restoredBoxes = []
const drafts = new Map()
const calmWords = new Map()
const calmPicks = new Map()
const chosen = new Map()
const openForms = new Set()
const focusUi = { words: { talk: '', notYet: '', new: '', bar: '' } }
let detailsOf = null
const $ = id => document.getElementById(id)
${cut('times')}
${cut('update')}
${functions}
try {
  keptText = sessionStorage.getItem(KEPT_KEY)
  kept = keptBack(keptText)
  sessionStorage.removeItem(KEPT_KEY)
} catch { /* nothing was kept */ }
Object.assign(this, {
  keepForReload, restoreKept, finishRestore,
  state: () => ({ drafts, calmWords, calmPicks, chosen, openForms, focusWords: focusUi.words, details: detailsOf }),
  set: (what, put) => { put({ drafts, calmWords, calmPicks, chosen, openForms, focusUi, setDetails: value => { detailsOf = value } }) },
  isPending: () => kept !== null,
})
`, context)
  return { ...context, popup, boxes, store, shown }
}

/** What the person did on a page before it reloads. */
function doThings(page) {
  page.set('things', ({ drafts, calmWords, calmPicks, chosen, openForms, focusUi, setDetails }) => {
    drafts.set('Q12', 'yes, A')
    drafts.set('refine:B7:feedback', 'shorter')
    calmWords.set('Q20', 'a note')
    calmPicks.set('Q20', 'B')
    chosen.set('Q12', 'A')
    openForms.add('Q30')
    focusUi.words.talk = 'hello'
    setDetails({ need: 'Q20' })
  })
}
const plain = value => JSON.parse(JSON.stringify(value))

test('keepForReload writes the drafts, notes, picks, open forms, boxes and the open popup into sessionStorage', () => {
  const before = makePage({ boxes: [box('main-text', 'do it'), box('say-text', '   '), box('goals-ask-text', 'why?'), box('tick', 'on', false)] })
  doThings(before)
  assert.equal(before.store.size, 0)
  before.keepForReload()
  const written = JSON.parse(before.store.get('kept-state'))
  assert.deepEqual(written.drafts, [['Q12', 'yes, A'], ['refine:B7:feedback', 'shorter']])
  assert.deepEqual(written.words, [['Q20', 'a note']])
  assert.deepEqual(written.picks, [['Q20', 'B']])
  assert.deepEqual(written.chosen, [['Q12', 'A']])
  assert.deepEqual(written.forms, ['Q30'])
  // Only the text boxes with words in them: not the blank one, not the checkbox.
  assert.deepEqual(written.fields, { 'main-text': 'do it', 'goals-ask-text': 'why?' })
  assert.deepEqual(written.focusWords, { talk: 'hello' })
  assert.deepEqual(written.details, { need: 'Q20' })
})

test('after the reload restoreKept puts everything back once, and finishRestore tells the boxes and opens the popup again', () => {
  const before = makePage({ boxes: [box('main-text', 'do it'), box('goals-ask-text', 'why?')] })
  doThings(before)
  before.keepForReload()
  // The new page: its boxes are empty (one already holds words and is left alone), the popup is shut.
  const filled = box('goals-ask-text', 'typed already')
  const after = makePage({ stored: before.store.get('kept-state'), boxes: [box('main-text'), filled, box('other')] })
  assert.equal(after.store.has('kept-state'), false, 'what was kept is taken out of the storage when read')
  assert.equal(after.isPending(), true)
  after.restoreKept()
  assert.equal(after.isPending(), false)
  const state = after.state()
  assert.deepEqual(plain([...state.drafts]), [['Q12', 'yes, A'], ['refine:B7:feedback', 'shorter']])
  assert.deepEqual(plain([...state.calmWords]), [['Q20', 'a note']])
  assert.deepEqual(plain([...state.calmPicks]), [['Q20', 'B']])
  assert.deepEqual(plain([...state.chosen]), [['Q12', 'A']])
  assert.deepEqual(plain([...state.openForms]), ['Q30'])
  assert.equal(state.focusWords.talk, 'hello')
  assert.deepEqual(plain(state.details), { need: 'Q20' })
  assert.deepEqual(after.boxes.map(one => one.value), ['do it', 'typed already', ''])
  // Not yet told: the first draw comes first.
  assert.deepEqual(after.boxes.map(one => one.heard), [0, 0, 0])
  assert.deepEqual(after.shown, [])
  after.finishRestore()
  assert.deepEqual(after.boxes.map(one => one.heard), [1, 0, 0])
  assert.equal(after.popup.open, true)
  assert.deepEqual(after.shown, ['showModal'])
  // Once only: a second go changes nothing.
  after.finishRestore()
  assert.deepEqual(after.boxes.map(one => one.heard), [1, 0, 0])
  assert.deepEqual(after.shown, ['showModal'])
  after.set('again', ({ drafts }) => drafts.clear())
  after.restoreKept()
  assert.equal(after.state().drafts.size, 0)
})

test('the popup is not opened again when it is open already or has nothing drawn in it; a Focus key the page does not know is left out', () => {
  const stored = JSON.stringify({ drafts: [], words: [], picks: [], chosen: [], forms: [], fields: [], focusWords: { talk: 'hi', gone: 'x' }, details: { need: 'Q1' } })
  const open = makePage({ stored, popup: { open: true, childNodes: [1] } })
  open.restoreKept()
  open.finishRestore()
  assert.deepEqual(open.shown, [])
  const empty = makePage({ stored, popup: { open: false, childNodes: [] } })
  empty.restoreKept()
  empty.finishRestore()
  assert.deepEqual(empty.shown, [])
  assert.equal(empty.state().focusWords.talk, 'hi')
  assert.equal('gone' in empty.state().focusWords, false)
  // Nothing kept: nothing opens.
  const none = makePage()
  none.restoreKept()
  none.finishRestore()
  assert.deepEqual(none.shown, [])
})

test('a reload before the first draw keeps what the last one kept; storage that is full or blocked does not stop the page', () => {
  const first = makePage({ boxes: [box('main-text', 'do it')] })
  doThings(first)
  first.keepForReload()
  const text = first.store.get('kept-state')
  // The new page loads, reloads again before it has drawn: its own state is empty, what was kept stays kept.
  const second = makePage({ stored: text, boxes: [box('main-text')] })
  second.keepForReload()
  assert.equal(second.store.get('kept-state'), text)
  // After the draw it keeps what the person has then.
  second.restoreKept()
  second.keepForReload()
  assert.equal(JSON.parse(second.store.get('kept-state')).words[0][1], 'a note')
  // Full: no throw, and nothing is written.
  const full = makePage({ boxes: [box('main-text', 'do it')], storage: { isFull: true } })
  assert.doesNotThrow(() => full.keepForReload())
  assert.equal(full.store.size, 0)
})
