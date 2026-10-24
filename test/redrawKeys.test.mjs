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
const plain = value => JSON.parse(JSON.stringify(value))

/**
 * The page's own code: its click table, the views and what of the person's they hold (needsUi, focusPageUi), run as
 * the page runs them, over the page's sets of what is picked, sent and refused, with a document that keeps its click
 * handler. `view.needs` and `view.focus` are what once() is keyed on.
 */
function loadPage() {
  const page = {
    listeners: [],
    sent: [],
    redrawn: [],
    chosen: new Map(),
    problems: new Map(),
    sending: new Set(),
    openForms: new Set(),
    starting: new Set(),
    focusUi: { busy: false, note: null, notYet: null, picked: null, picking: false, asked: [], words: { talk: '', notYet: '', new: '', bar: '' } },
  }
  page.document = { addEventListener: (type, handler) => page.listeners.push({ type, handler }) }
  page.sendWork = (body, sendKey) => page.sent.push(plain([body, sendKey]))
  page.redrawNeeds = () => page.redrawn.push('needs')
  page.$ = id => (id === 'needs-order' ? { value: 'newest' } : null)
  page.showsClosed = () => false
  vm.runInNewContext(`const MIN = ${MIN}\nconst HOUR = 60 * MIN\n${cut('recaps')}\n${cut('clicks')}\n${cut('redraw')}
Object.assign(this, { view: { needs: state => needsView(state, needsUi()), focus: state => focusPageView(state, focusPageUi()) } })`, page)
  page.click = target => page.listeners.filter(one => one.type === 'click').forEach(one => one.handler({ target }))
  return page
}

/** The redraw key once() compares: the view's JSON. */
const key = view => JSON.stringify(view)

/** A button drawn anywhere on the page, with these data attributes; `closest` finds it by them, as the browser does. */
const button = (attributes, dataset, disabled = false) => ({ dataset, disabled, closest: selector => (attributes.some(name => selector === `[data-${name}]`) ? button(attributes, dataset, disabled) : null) })

function state(extra = {}) {
  return {
    readAt: Date.UTC(2026, 9, 19, 23, 30, 5),
    forYou: [{ id: 'work:Q7', workId: 'Q7', from: 'Digger', title: 'Number or bar?', answer: null, blocking: false }],
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

test('bug a: the "With your partner" line opens at once: the click redraws Needs your attention with a new key', () => {
  const page = loadPage()
  const closed = key(page.view.needs(state()))
  page.click(button(['with-partner'], { withPartner: 'toggle' }))
  assert.deepEqual(page.redrawn, ['needs'], 'Needs your attention is drawn again')
  const open = page.view.needs(state())
  assert.notEqual(key(open), closed, 'with a key that changed, so once() draws it')
  assert.equal(open.ui.withPartnerOpen, true, 'and the line is drawn open, from the view')
  page.click(button(['with-partner'], { withPartner: 'toggle' }))
  assert.equal(key(page.view.needs(state())), closed, 'a second click closes it')
  // The list it opens, and the partner's decided lines, are drawn from the view too: a new one shows at once.
  assert.notEqual(key(page.view.needs(state({ withPartner: [] }))), closed)
  assert.notEqual(key(page.view.needs(state({ partnerDecided: [{ ask: 'Q9', line: 'Q9: A (your advice)' }] }))), closed)
})

test('bug b: the Partner answers switch shows what the store holds, its change on its way, and a refused change', () => {
  const page = loadPage()
  const on = page.view.focus(state())
  assert.deepEqual(plain(on.partnerAnswers), { on: true }, 'drawn from the view')
  assert.notEqual(key(page.view.focus(state({ partnerAnswers: { on: false } }))), key(on), 'the store switched it off')
  page.sending.add('partner-answers')
  const asking = key(page.view.focus(state()))
  assert.notEqual(asking, key(on), 'a change on its way turns the box off')
  page.sending.delete('partner-answers')
  page.problems.set('partner-answers', 'Not sent: refused (409)')
  const refused = key(page.view.focus(state()))
  assert.notEqual(refused, asking, 'the refusal shows, and the box shows the store again')
  assert.notEqual(refused, key(on))
})

test('bug c: Undo of a partner\'s answer works wherever it is drawn, the daily note on the Focus page too', () => {
  const page = loadPage()
  assert.equal(page.listeners.filter(one => one.type === 'click').length, 1, 'one click handler on the document')
  // A button under the daily note: in no box of Needs your attention or the details.
  page.click(button(['take-back'], { takeBack: 'Q7' }))
  assert.deepEqual(page.sent, [[{ action: 'undo', id: 'Q7' }, 'work:Q7']], 'the board\'s undo of the ask, by its id')
  page.click(button(['take-back'], { takeBack: 'Q7' }, true))
  assert.equal(page.sent.length, 1, 'an Undo on its way is not sent twice')
  page.click({ closest: () => null })
  assert.equal(page.sent.length, 1, 'a click on nothing of the table does nothing')
  // No box binds it any more, so a click is never handled twice.
  assert.doesNotMatch(script, /addEventListener\('click', takeBackClick\)/)
})

test('the key is what is drawn: what the parts do not show leaves them alone, so typing and scrolling stay', () => {
  const page = loadPage()
  const before = key(page.view.needs(state()))
  const busy = state({ readAt: state().readAt + 20_000, chats: [{ name: 'Digger', isRunning: true, state: 'waiting', doingNow: 'Testing', session: 's2' }] })
  assert.equal(key(page.view.needs(busy)), before, 'a chat\'s work and the seconds are not drawn there')
  // What is drawn: whether a chat runs (a card asks to start it), the next minute (how long ago), a step's id (a link).
  assert.notEqual(key(page.view.needs(state({ chats: [{ name: 'Digger', isRunning: false }] }))), before)
  assert.notEqual(key(page.view.needs(state({ readAt: state().readAt + MIN }))), before)
  assert.notEqual(key(page.view.needs(state({ backlog: [{ name: 'Store', steps: [{ key: 'B2' }] }] }))), before)
  assert.equal(key(page.view.needs(state({ workers: { main: 'Other' } }))), before, 'the main chat of the effort switch is the Focus page\'s')
})

test('the review of B408: the Focus page is drawn anew each minute and for every ask only while the daily note gathers', () => {
  const page = loadPage()
  const quiet = key(page.view.focus(state()))
  assert.equal(key(page.view.focus(state({ readAt: state().readAt + 3 * MIN }))), quiet, 'no new minute drawn: the talk stays where it is read')
  assert.equal(key(page.view.focus(state({ chats: [{ name: 'Digger', isRunning: false }] }))), quiet, 'nor who runs')
  // But whether the main chat runs: the talk's line says who can start a partner that does not run.
  const withMain = { chats: [{ name: 'Lead', isRunning: true }, { name: 'Digger', isRunning: true }], restart: { main: 'Lead' } }
  const leadRuns = key(page.view.focus(state(withMain)))
  assert.notEqual(key(page.view.focus(state({ ...withMain, chats: [{ name: 'Lead', isRunning: false }, { name: 'Digger', isRunning: true }] }))), leadRuns)
  assert.equal(key(page.view.focus(state({ ...withMain, chats: [{ name: 'Lead', isRunning: true }, { name: 'Digger', isRunning: false }] }))), leadRuns)
  const answered = state({ forYou: [{ ...state().forYou[0], answer: { by: 'person', text: 'A', at: 1 } }] })
  assert.equal(key(page.view.focus(answered)), quiet, 'nor an answer to an ask')
  assert.notEqual(key(page.view.focus(state({ forYou: [...state().forYou, { id: 'work:Q9', workId: 'Q9' }] }))), quiet, 'a new ask: the note may link it')
  assert.notEqual(key(page.view.focus(state({ advisor: { name: 'Guide', isRunning: true, effort: { mode: 'low', isSet: true } } }))), quiet, 'the partner\'s effort switch')
  // "Bother me: once a day": the ask is gathered under the note, drawn as a card: its minute and who runs count.
  const daily = state({ recapsShow: 'daily' })
  const gathered = key(page.view.focus(daily))
  assert.notEqual(key(page.view.focus({ ...daily, readAt: daily.readAt + MIN })), gathered)
  assert.notEqual(key(page.view.focus({ ...daily, chats: [{ name: 'Digger', isRunning: false }] })), gathered)
  assert.notEqual(key(page.view.focus({ ...daily, forYou: [{ ...daily.forYou[0], answer: { by: 'partner', text: 'A', at: 1 } }] })), gathered)
})

/**
 * What a drawing reads of the state passed to it (`state.<field>`) and of the page's own `board`, in its function and
 * every function it calls or passes on, followed through the page's own functions, but not into what a click does
 * (`ACTS`) or `skip`. A view
 * must hold each field, or the part draws it from nothing. Only a field's name is checked: a part of a field the view
 * slims (a chat as its name and whether it runs) is kept by the view's own helpers (runnerOf, stepKeysOf, linkable).
 */
function readsOf(start, skip = []) {
  const names = new Set([...script.matchAll(/\n(?:async )?function (\w+)\(|\nconst (\w+) = /g)].map(m => m[1] ?? m[2]))
  const body = name => {
    const fn = script.search(new RegExp(`\\n(?:async )?function ${name}\\(`))
    if (fn !== -1) return script.slice(fn, script.indexOf('\n}\n', fn))
    const arrow = script.indexOf(`\nconst ${name} = `)
    if (arrow === -1) return ''
    // An arrow ends at the first line that starts at the margin, not with a closing bracket.
    const rest = script.slice(arrow + 1)
    return rest.slice(0, rest.search(/\n(?![\s)\]}])/))
  }
  const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  // What a button does on a click, and the page drawn anew: not part of the drawing.
  const ACTS = ['send', 'sendWork', 'sendFocus', 'sendGoals', 'read', 'redrawNeeds', 'redrawFocus', 'focusAct', 'game', 'draw', 'once']
  const seen = new Set([...ACTS, ...skip])
  const reads = { state: new Set(), board: new Set() }
  const walk = name => {
    if (seen.has(name)) return
    seen.add(name)
    const text = strip(body(name))
    for (const m of text.matchAll(/\b(state|board)\??\.(\w+)/g)) reads[m[1]].add(m[2])
    // A call (not of a method), or a function handed on as an argument.
    for (const m of text.matchAll(/(?<![.\w])(\w+)\s*\(|[(,]\s*(\w+)\s*(?=[),])/g)) {
      const called = m[1] ?? m[2]
      if (names.has(called)) walk(called)
    }
  }
  walk(start)
  return reads
}

function assertHeld(part, view, reads) {
  const fields = Object.keys(view)
  for (const field of reads.state) assert.ok(fields.includes(field), `${part} reads state.${field}: its view must hold it`)
  // board.<field> in a drawing is drawn from the whole state, outside the view: its view must hold that field too.
  for (const field of reads.board) assert.ok(fields.includes(field), `${part} reads board.${field}: its view must hold it`)
}

test('each field Needs your attention and the Focus page read is in their views', () => {
  const page = loadPage()
  assertHeld('Needs your attention', page.view.needs(state()), readsOf('drawNeeds'))
  // The Focus page with the daily note's cards, and without them (then its view holds no cards' fields).
  assertHeld('The Focus page', page.view.focus(state({ recapsShow: 'daily' })), readsOf('drawFocus'))
  assertHeld('The Focus page without gathered cards', page.view.focus(state()), readsOf('drawFocus', ['gatheredCards', 'focusRecapCard', 'focusAsksCard']))
})
