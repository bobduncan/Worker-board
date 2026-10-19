// B408 (place 3 of docs/robustness-2026-10.md): Needs your attention and the Focus page are keyed on their views, plain
// data of what they draw, and the page's clicks go through one table on the document. The three bugs it fixes: the
// "With your partner" line did not open at once, a refused change of the Partner answers switch never showed, and
// Undo under the daily note did nothing. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const cut = name => {
  const from = script.indexOf(`// ${name}:start`)
  const to = script.indexOf(`// ${name}:end`)
  return from === -1 || to === -1 ? '' : script.slice(from, to)
}
const MIN = 60_000

const page = {}
vm.runInNewContext(`const MIN = ${MIN}\n${cut('redraw')}\nObject.assign(this, { needsView: typeof needsView === 'function' ? needsView : null, focusPageView: typeof focusPageView === 'function' ? focusPageView : null })`, page)

/** The redraw key once() compares: the view's JSON. */
const key = view => JSON.stringify(view)

const NEEDS_UI = { showsClosed: false, order: 'newest', withPartnerOpen: false, chosen: [], problems: [], sending: [], openForms: [], starting: [] }

function state(extra = {}) {
  return {
    readAt: Date.UTC(2026, 9, 19, 23, 30, 5),
    forYou: [{ id: 'work:Q7', workId: 'Q7', from: 'Digger', title: 'Number or bar?', answer: null }],
    backlogForYou: [],
    backlogClosed: [],
    recaps: [],
    recapsShow: 'cards',
    focus: { id: 'G2', title: 'A calm board', vibe: ['quiet'], needs: [{ id: 'Q7', text: 'Number or bar?' }] },
    goals: { goals: [{ id: 'G2' }] },
    brainstorms: { threads: [] },
    instructions: [],
    information: [],
    goalAskNeeds: [],
    brainstormNeeds: [],
    goalsEdit: { canWrite: true, whyNot: null },
    withPartner: [{ id: 'Q8', from: 'Lead', title: 'Icons?' }],
    partnerDecided: [],
    partnerAnswers: { on: true },
    chats: [{ name: 'Digger', isRunning: true, state: 'working', doingNow: 'Reading', session: 's1' }],
    advisor: { name: 'Guide', isRunning: true, state: 'free', effort: { mode: 'high', isSet: true } },
    workers: { main: 'Lead' },
    restart: { main: 'Lead', starting: [] },
    backlog: [{ name: 'Store', steps: [{ key: 'B1', id: 'B1', title: 'A step', state: 'queued' }] }],
    maxMessageChars: 4000,
    ...extra,
  }
}

test('bug a: the "With your partner" toggle changes what Needs your attention draws, so it opens at once', () => {
  assert.equal(typeof page.needsView, 'function', 'Needs your attention has a view')
  const closed = page.needsView(state(), NEEDS_UI)
  const open = page.needsView(state(), { ...NEEDS_UI, withPartnerOpen: true })
  assert.notEqual(key(open), key(closed), 'the click is part of the key: the part is drawn again at once')
  assert.equal(open.ui.withPartnerOpen, true, 'and drawn from the view')
  // The list it opens, and the partner's decided lines, are drawn from the view too: a new one shows at once.
  assert.notEqual(key(page.needsView(state({ withPartner: [] }), NEEDS_UI)), key(closed))
  assert.deepEqual(closed.withPartner, state().withPartner)
  const decided = state({ partnerDecided: [{ ask: 'Q9', line: 'Q9: A (your advice)' }] })
  assert.notEqual(key(page.needsView(decided, NEEDS_UI)), key(closed))
})

test('bug b: the Partner answers switch shows what the store holds, its change on its way, and a refused change', () => {
  assert.equal(typeof page.focusPageView, 'function', 'the Focus page has a view')
  const ui = { busy: false, note: null, notYet: null, picked: null, picking: false, asked: [], chosen: [], problems: [], sending: [], openForms: [], starting: [] }
  const on = page.focusPageView(state(), ui)
  assert.deepEqual(on.partnerAnswers, { on: true }, 'drawn from the view')
  assert.notEqual(key(page.focusPageView(state({ partnerAnswers: { on: false } }), ui)), key(on), 'the store switched it off')
  const asking = page.focusPageView(state(), { ...ui, sending: ['partner-answers'] })
  assert.notEqual(key(asking), key(on), 'a change on its way turns the box off')
  const refused = page.focusPageView(state(), { ...ui, problems: [['partner-answers', 'Not done: refused (409)']] })
  assert.notEqual(key(refused), key(asking), 'the refusal shows, and the box shows the store again')
  assert.notEqual(key(refused), key(on))
})

test('bug c: Undo of a partner\'s answer works wherever it is drawn, the daily note on the Focus page too', () => {
  const sent = []
  const redrawn = []
  const listeners = []
  const context = {
    document: { addEventListener: (type, handler) => listeners.push({ type, handler }) },
    sendWork: (body, sendKey) => sent.push([body, sendKey]),
    redrawNeeds: () => redrawn.push('needs'),
  }
  vm.runInNewContext(`${cut('clicks')}\nthis.withPartnerUi = typeof withPartnerUi === 'object' ? withPartnerUi : null`, context)
  const clicks = listeners.filter(one => one.type === 'click')
  assert.equal(clicks.length, 1, 'one click handler on the document')
  // A button under the daily note: in no box of Needs your attention or the details.
  const button = (attributes, dataset, disabled = false) => ({ dataset, disabled, closest: selector => (attributes.some(name => selector === `[data-${name}]`) ? button(attributes, dataset, disabled) : null) })
  const click = target => clicks[0].handler({ target })
  click(button(['take-back'], { takeBack: 'Q7' }))
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [[{ action: 'undo', id: 'Q7' }, 'work:Q7']], 'the board\'s undo of the ask, by its id')
  click(button(['take-back'], { takeBack: 'Q7' }, true))
  assert.equal(sent.length, 1, 'an Undo on its way is not sent twice')
  click({ closest: () => null })
  assert.equal(sent.length, 1, 'a click on nothing of the table does nothing')
  // Bug a's click goes through the same table: the line opens, and Needs your attention is drawn again.
  assert.equal(context.withPartnerUi.isOpen, false)
  click(button(['with-partner'], { withPartner: 'toggle' }))
  assert.equal(context.withPartnerUi.isOpen, true)
  assert.deepEqual(redrawn, ['needs'])
  // No box binds it any more, so a click is never handled twice.
  assert.doesNotMatch(script, /addEventListener\('click', takeBackClick\)/)
})

test('the key is what is drawn: what the parts do not show leaves them alone, so typing and scrolling stay', () => {
  const before = page.needsView(state(), NEEDS_UI)
  const busy = state({ readAt: state().readAt + 20_000, chats: [{ name: 'Digger', isRunning: true, state: 'waiting', doingNow: 'Testing', session: 's2' }] })
  assert.equal(key(page.needsView(busy, NEEDS_UI)), key(before), 'a chat\'s work and the seconds are not drawn there')
  const focusUi = { busy: false, note: null, notYet: null, picked: null, picking: false, asked: [], chosen: [], problems: [], sending: [], openForms: [], starting: [] }
  assert.equal(key(page.focusPageView(busy, focusUi)), key(page.focusPageView(state(), focusUi)))
  // What is drawn: whether a chat runs (a card asks to start it), the next minute (how long ago), a step's id (a link).
  assert.notEqual(key(page.needsView(state({ chats: [{ name: 'Digger', isRunning: false }] }), NEEDS_UI)), key(before))
  assert.notEqual(key(page.needsView(state({ readAt: state().readAt + MIN }), NEEDS_UI)), key(before))
  assert.notEqual(key(page.needsView(state({ backlog: [{ name: 'Store', steps: [{ key: 'B2' }] }] }), NEEDS_UI)), key(before))
  // The partner's effort switch and the main chat it asks are on the Focus page only.
  assert.notEqual(key(page.focusPageView(state({ advisor: { name: 'Guide', isRunning: true, effort: { mode: 'low', isSet: true } } }), focusUi)), key(page.focusPageView(state(), focusUi)))
  assert.equal(key(page.needsView(state({ workers: { main: 'Other' } }), NEEDS_UI)), key(before))
})

/**
 * What a drawing reads of the state passed to it: `state.<field>` in its function and in every function it calls,
 * followed through the page's own functions. A view must hold each, or the part draws it from nothing.
 */
function readsOf(start) {
  const names = new Set([...script.matchAll(/\n(?:async )?function (\w+)\(|\nconst (\w+) = /g)].map(m => m[1] ?? m[2]))
  const body = name => {
    const fn = script.indexOf(`\nfunction ${name}(`)
    if (fn !== -1) return script.slice(fn, script.indexOf('\n}\n', fn))
    const arrow = script.indexOf(`\nconst ${name} = `)
    if (arrow === -1) return ''
    // An arrow ends at the first line that starts at the margin, not with a closing bracket.
    const rest = script.slice(arrow + 1)
    return rest.slice(0, rest.search(/\n(?![\s)\]}])/))
  }
  const seen = new Set()
  const reads = new Set()
  const walk = name => {
    if (seen.has(name)) return
    seen.add(name)
    const text = body(name)
    for (const m of text.matchAll(/\bstate\??\.(\w+)/g)) reads.add(m[1])
    for (const m of text.matchAll(/\b(\w+)\(/g)) if (names.has(m[1])) walk(m[1])
  }
  walk(start)
  return reads
}

test('each field Needs your attention and the Focus page read is in their views', () => {
  const needs = Object.keys(page.needsView(state(), NEEDS_UI))
  for (const field of readsOf('drawNeeds')) assert.ok(needs.includes(field), `Needs your attention reads state.${field}: its view must hold it`)
  const focus = Object.keys(page.focusPageView(state(), {}))
  for (const field of readsOf('drawFocus')) assert.ok(focus.includes(field), `the Focus page reads state.${field}: its view must hold it`)
})
