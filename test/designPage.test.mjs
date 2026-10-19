// B99: the Design tab's page: from an idea to a picture by Codex to a step on the backlog. The page reads
// `state.design` and writes through POST /api/design (the board's side is B101). The page's own code is run here,
// cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const markup = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = script.slice(script.indexOf('// design:start'), script.indexOf('// design:end'))
const page = {}
vm.runInNewContext(`${cut}\nObject.assign(this, { limitsOf, ideaName, ideaBadge, designView, timeTyped, makeBody, againBody, retryBody, missingOf, sendBody, firstForm, blankForm, bareSentWords, sentWords, pastedReference })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const MIN = 60_000
const NOW = 1_000_000 * MIN
const version = (n, state = 'done', more = {}) => ({ n, at: NOW - (10 - n) * MIN, change: n === 1 ? null : `change ${n}`, state, picture: state === 'done' ? `art-inbox/ideas/shop/v${n}.png` : null, why: null, seconds: 50, ...more })
const idea = (more = {}) => ({ id: 'i1', name: 'shop-screen', kind: 'screen', text: 'a shop screen where gold is spent\non one of three items', createdAt: NOW - 20 * MIN, folder: 'art-inbox/ideas/shop', references: [], versions: [version(1), version(2)], agreed: null, sent: null, status: 'look', ...more })
const design = (ideas = [idea()], more = {}) => ({ canMake: true, why: null, busy: null, seconds: 60, kinds: [{ id: 'screen', name: 'Game screen' }, { id: 'art', name: 'Unit or art' }], ideas, ...more })
const view = (board, chosen = { idea: 'i1', version: null }) => page.designView(board, chosen, NOW)

test('the page has the Design tab after the person\'s layout: three parts side by side, the ideas along the bottom', () => {
  assert.match(markup, /<button class="tab" type="button" data-tab="design">Design<\/button>/)
  const tab = markup.slice(markup.indexOf('id="view-design"'), markup.indexOf('<dialog class="details"'))
  const at = words => tab.indexOf(words)
  const order = ['New idea', 'id="design-text"', 'What is it about?', 'id="design-kinds"', 'id="design-make"', 'The picture', 'id="design-stage"', 'id="design-versions"', 'id="design-change"', 'id="design-agree"',
    'Add what you want', 'id="design-title"', 'id="design-description"', 'id="design-requirements"', 'id="design-worker"', 'id="design-time"', 'id="design-backlog"', 'id="design-queue"', 'Ideas so far', 'id="design-strip"']
  for (const [place, words] of order.entries()) assert.ok(at(words) >= 0 && (place === 0 || at(words) > at(order[place - 1])), `"${words}" is missing or out of place`)
  // "What is it about?" stands over the row of choices, not over the idea's box.
  assert.ok(at('What is it about?') > at('id="design-text"'))
  assert.match(style, /\.design-parts\s*\{[^}]*grid-template-columns:\s*minmax\([^;]+minmax\([^;]+minmax\(/)
  // The tab opens by its address, and is drawn with every reading of the state.
  assert.match(script, /if \(hash === '#design'\) return 'design'/)
  assert.match(script, /\$\('view-design'\)\.hidden = tab !== 'design'/)
  assert.match(script, /\n {2}drawDesign\(\)\n\}/)
})

test('a new idea: nothing is chosen, a picture can be made unless one is being made or the board cannot', () => {
  const fresh = view(design(), { idea: null, version: null })
  assert.deepEqual([fresh.idea, fresh.version, fresh.canMake, fresh.canAgain, fresh.canAgree, fresh.form], [null, null, true, false, false, 'open'])
  assert.equal(view(design([], { canMake: false, why: 'Codex was not found.' }), { idea: null, version: null }).canMake, false)
  const busy = view(design([idea()], { busy: { idea: 'i9', version: 1, since: NOW - 32_000 } }), { idea: null, version: null })
  assert.deepEqual([busy.canMake, busy.making.idea, busy.making.line], [false, 'i9', '0:32 of about 1:00'])
  // A board without the Design part: nothing can be done, and nothing breaks.
  const none = page.designView(null, { idea: null, version: null }, NOW)
  assert.deepEqual([none.canMake, none.making, none.form], [false, null, 'locked'])
})

test('the picture looked at: the one chosen, else the agreed one, else the newest that was made', () => {
  assert.equal(view(design()).version.n, 2)
  assert.equal(view(design(), { idea: 'i1', version: 1 }).version.n, 1)
  assert.equal(view(design([idea({ agreed: 1, status: 'agreed' })])).version.n, 1)
  // A new version in the making does not take the picture away; one that never got a picture is shown as it is.
  assert.equal(view(design([idea({ versions: [version(1), version(2, 'making')], status: 'making' })])).version.n, 1)
  assert.equal(view(design([idea({ versions: [version(1, 'making')], status: 'making' })])).version.state, 'making')
  // An idea that is no longer there is not looked at.
  assert.equal(view(design(), { idea: 'gone', version: 2 }).idea, null)
})

test('what the buttons under the picture do: again, try again, agree, take it back', () => {
  const look = view(design())
  assert.deepEqual([look.canAgain, look.canRetry, look.canAgree, look.canTakeBack, look.form], [true, false, true, false, 'open'])
  const agreed = view(design([idea({ agreed: 2, status: 'agreed' })]))
  assert.deepEqual([agreed.canAgree, agreed.canTakeBack, agreed.canAgain, agreed.form], [false, true, true, 'open'])
  // Looking at another version than the agreed one: that one can be agreed to instead.
  assert.deepEqual(plain([view(design([idea({ agreed: 2 })]), { idea: 'i1', version: 1 })].map(one => [one.canAgree, one.canTakeBack])), [[true, false]])
  const failed = view(design([idea({ versions: [version(1, 'failed', { why: 'Codex gave no picture.' })], status: 'failed' })]))
  assert.deepEqual([failed.canAgain, failed.canRetry, failed.canAgree], [false, true, false])
  // While a picture is being made, no other is asked for; agreeing with one that is there stays possible.
  const busy = view(design([idea()], { busy: { idea: 'i2', version: 1, since: NOW } }))
  assert.deepEqual([busy.canAgain, busy.canAgree], [false, true])
})

test('part 3 is locked until a picture is agreed, open to fill in, and closed once the step was asked for', () => {
  const sent = state => ({ at: NOW - MIN, where: 'queue', worker: 'Units', title: 'Shop screen', state, step: null })
  for (const state of ['waiting', 'taken', 'delivered']) {
    const asked = view(design([idea({ agreed: 2, sent: sent(state), status: 'asked' })]))
    assert.deepEqual([asked.form, asked.canAgain, asked.canAgree, asked.canTakeBack], ['sent', false, false, false], state)
  }
  // An asking that did not arrive opens the form again, and says so.
  for (const state of ['expired', 'failed']) {
    const lost = view(design([idea({ agreed: 2, sent: sent(state), status: 'agreed' })]))
    assert.deepEqual([lost.form, lost.isLost, lost.canTakeBack], ['open', true, true], state)
  }
})

test('"Ideas so far" says where each idea stands', () => {
  const badge = more => plain(page.ideaBadge(idea(more), 'Main'))
  assert.deepEqual(badge({ status: 'making' }), { text: 'Picture being made', tone: 'busy' })
  assert.deepEqual(badge({ status: 'failed' }), { text: 'Picture failed', tone: 'bad' })
  assert.deepEqual(badge({ status: 'look' }), { text: 'Waiting for your look', tone: 'you' })
  assert.deepEqual(badge({ status: 'agreed' }), { text: 'Agreed', tone: 'good' })
  assert.deepEqual(badge({ status: 'asked', sent: { where: 'backlog', worker: null, step: null } }), { text: 'Asked of Main', tone: 'plain' })
  assert.deepEqual(badge({ status: 'backlog', sent: { where: 'backlog', worker: null, step: { id: 'B103', worker: null, isDone: false } } }), { text: 'On the backlog · B103', tone: 'plain' })
  assert.deepEqual(badge({ status: 'queued', sent: { where: 'queue', worker: 'Units', step: { id: 'B104', worker: 'Units', isDone: false } } }), { text: 'Queued for Units · B104', tone: 'plain' })
  assert.deepEqual(badge({ status: 'queued', sent: { where: 'queue', worker: null, step: { id: 'B104', worker: 'Units', isDone: true } } }), { text: 'Done · B104', tone: 'good' })
  assert.equal(badge({ status: 'something new' }).text, 'Unknown')
  assert.deepEqual([page.ideaName({ name: 'shop-screen' }), page.ideaName({ name: '' }), page.ideaName({})], ['Shop screen', 'An idea', 'An idea'])
})

test('"Make a picture" sends the idea, what it is about and the reference pictures, or says what is missing', () => {
  const draft = { text: '  a shop screen  ', kind: 'screen', references: ['art-inbox/ideas/r1.png'] }
  assert.deepEqual(plain(page.makeBody(draft, design())), { body: { action: 'make', kind: 'screen', text: 'a shop screen', references: ['art-inbox/ideas/r1.png'] } })
  assert.equal(page.makeBody({ ...draft, text: '  ' }, design()).problem, 'Type the idea first.')
  assert.equal(page.makeBody({ ...draft, kind: null }, design()).problem, 'Choose what it is about.')
  assert.equal(page.makeBody({ ...draft, kind: 'level' }, design()).problem, 'Choose what it is about.')
  assert.match(page.makeBody({ ...draft, text: 'x'.repeat(1501) }, design()).problem, /too long: 1500 characters at most, it has 1501/)
  assert.equal(page.makeBody({ ...draft, references: ['a', 'b', 'c', 'd'] }, design()).problem, 'At most 3 reference pictures.')
  // The limits are the board's own, as its state names them.
  assert.equal(page.makeBody({ ...draft, text: 'x'.repeat(1501) }, design([], { limits: { idea: 2000 } })).problem, undefined)
  assert.deepEqual(plain(page.limitsOf(null)), { idea: 1500, change: 600, title: 160, description: 1200, requirement: 200, requirements: 12, references: 3, referenceBytes: 8 * 1024 * 1024 })
  // A board that cannot ask the main chat (a copy, the demo) says why in its own words, before the click.
  assert.match(script, /cannotSend \? design\.whyNot \?\? /)
  // A kind whose own reference pictures are not there says so under the button.
  const kinds = [{ id: 'screen', name: 'Game screen', missing: [] }, { id: 'art', name: 'Unit or art', missing: ['a.png', 'b.png'] }]
  assert.deepEqual([page.missingOf({ kinds }, 'screen'), page.missingOf({ kinds }, null), page.missingOf(null, 'art')], ['', '', ''])
  assert.match(page.missingOf({ kinds }, 'art'), /misses 2 reference pictures for this kind/)
})

test('"Make it again" sends what should change and the version it was said of', () => {
  assert.deepEqual(plain(page.againBody(idea(), version(1), ' darker, please ', design())), { body: { action: 'again', idea: 'i1', change: 'darker, please', from: 1 } })
  assert.equal(page.againBody(idea(), version(1), ' ', design()).problem, 'Say what should change.')
  assert.match(page.againBody(idea(), version(1), 'x'.repeat(601), design()).problem, /600 characters at most/)
  // A picture that was not made is tried again: the same change, or with no picture yet simply the idea.
  assert.deepEqual(plain(page.retryBody(idea(), version(3, 'failed'))), { body: { action: 'again', idea: 'i1', change: 'change 3' } })
  assert.deepEqual(plain(page.retryBody(idea(), version(1, 'failed'))), { body: { action: 'again', idea: 'i1' } })
})

test('a time is read as it is typed: "about 1 h", "45 min", "1 h 30", "90"', () => {
  const times = { 'about 1 h': 60, '45 min': 45, '1 h 30': 90, '90': 90, '1.5 h': 90, '1,5 hours': 90, '2h': 120, '~ 20 minutes': 20, '': null, '   ': null }
  for (const [typed, minutes] of Object.entries(times)) assert.equal(page.timeTyped(typed), minutes, typed)
  for (const typed of ['soon', 'h', '0', '1 h 30 x', '2000 h']) assert.ok(Number.isNaN(page.timeTyped(typed)), typed)
})

test('"Put on the backlog" and "Put in a queue" send the form, or say what is wrong with it', () => {
  const form = { title: ' Shop screen ', description: ' Spend gold. ', requirements: ['Three items', '  ', ' Gold is spent '], worker: 'Units', time: 'about 1 h' }
  assert.deepEqual(plain(page.sendBody(idea(), form, 'queue', design())), { body: { action: 'send', idea: 'i1', where: 'queue', title: 'Shop screen', description: 'Spend gold.', requirements: ['Three items', 'Gold is spent'], worker: 'Units', minutes: 60 } })
  // "Let Game - Main decide" and no time are sent as nothing.
  const open = plain(page.sendBody(idea(), { ...form, worker: '', time: '' }, 'backlog', design())).body
  assert.deepEqual([open.where, open.worker, open.minutes], ['backlog', null, null])
  assert.equal(page.sendBody(idea(), { ...form, title: ' ' }, 'backlog', design()).problem, 'Give it a title.')
  assert.match(page.sendBody(idea(), { ...form, title: 'x'.repeat(161) }, 'backlog', design()).problem, /title is too long: 160/)
  assert.match(page.sendBody(idea(), { ...form, description: 'x'.repeat(1201) }, 'backlog', design()).problem, /description is too long: 1200/)
  assert.match(page.sendBody(idea(), { ...form, requirements: Array.from({ length: 13 }, (_, i) => `r${i}`) }, 'backlog', design()).problem, /At most 12 requirements/)
  assert.match(page.sendBody(idea(), { ...form, requirements: ['x'.repeat(201)] }, 'backlog', design()).problem, /requirement is too long: 200/)
  assert.match(page.sendBody(idea(), { ...form, time: 'soon' }, 'backlog', design()).problem, /cannot read that time/)
})

test('the form of an agreed idea starts from the idea: its first line as the title', () => {
  assert.deepEqual(plain(page.firstForm(idea())), { title: 'A shop screen where gold is spent', description: 'a shop screen where gold is spent\non one of three items', requirements: [''], worker: '', time: '' })
  const long = page.firstForm(idea({ text: 'x'.repeat(200) }))
  assert.deepEqual([long.title.length, long.title.endsWith('…')], [80, true])
})

test('once asked for, part 3 says where the asking is and which step it became', () => {
  const sent = more => ({ at: NOW, where: 'queue', worker: 'Units', title: 'Shop screen', state: 'waiting', step: null, ...more })
  assert.deepEqual(plain(page.sentWords(sent(), 'Main')), ['You asked Main to have "Shop screen" put in the queue of Units: waits for Main to take it.'])
  assert.match(page.sentWords(sent({ where: 'backlog', worker: null, state: 'taken' }), 'Main')[0], /put on the backlog: handed to Main/)
  assert.match(page.sentWords(sent({ worker: null, state: 'delivered' }), 'Main')[0], /put in a queue: typed into Main's chat\.$/)
  assert.deepEqual(plain(page.sentWords(sent({ state: 'delivered', step: { id: 'B103', worker: 'Units', isDone: false } }), 'Main')).at(-1), 'It is step B103 on the backlog, for Units.')
  assert.match(page.sentWords(sent({ state: 'expired' }), null)[0], /did not reach the main chat\.$/)
})

test('the page writes only through the board\'s Design calls, and nothing into the backlog', () => {
  const tab = script.slice(script.indexOf('// Design (B99)'), script.indexOf('// Tabs\n'))
  assert.deepEqual([...new Set([...tab.matchAll(/fetch\('([^']+)'/g)].map(found => found[1]))].sort(), ['/api/design', '/api/design/reference'])
  assert.deepEqual([...new Set([...tab.matchAll(/action: '([a-z]+)'/g)].map(found => found[1]))].sort(), ['again', 'agree', 'drop', 'make', 'send'])
  for (const word of ['/api/say', 'backlog.md', 'localStorage']) assert.ok(!tab.includes(word), `the tab's code has "${word}"`)
  // What the person typed is kept by the page while it is open; a redraw does not put it back into the boxes.
  assert.ok(!/\$\('design-text'\)\.value = designDraft/.test(tab))
})

test('B156: a picture pasted on the Design tab is taken as a reference; text pasted into a field stays text', () => {
  const file = type => ({ kind: 'file', type, getAsFile: () => ({ type }) })
  const words = { kind: 'string', type: 'text/plain' }
  // A screenshot, or a picture copied from a page (which brings its HTML along): the picture is taken.
  assert.equal(page.pastedReference([file('image/png')], false).take.type, 'image/png')
  assert.equal(page.pastedReference([{ kind: 'string', type: 'text/html' }, file('image/webp')], true).take.type, 'image/webp')
  // Pasted into the idea's box, a picture is still a reference: the box takes no pictures.
  assert.equal(page.pastedReference([file('image/jpeg')], true).take.type, 'image/jpeg')
  // A kind of picture the board does not take, something that is no picture, or nothing: a short line says so.
  assert.equal(page.pastedReference([file('image/gif')], false).problem, 'A reference is a PNG, JPEG or WebP picture.')
  assert.equal(page.pastedReference([file('application/pdf')], false).problem, 'Only a picture can be pasted as a reference.')
  assert.equal(page.pastedReference([words], false).problem, 'The clipboard holds no picture: copy one, or add one from disk.')
  assert.equal(page.pastedReference(undefined, false).problem, 'The clipboard holds no picture: copy one, or add one from disk.')
  // Text pasted into a field is left to the field, also when the document it came from added a picture of it.
  assert.deepEqual(plain(page.pastedReference([words], true)), { ignore: true })
  assert.deepEqual(plain(page.pastedReference([words, { kind: 'string', type: 'text/html' }, file('image/png')], true)), { ignore: true })
  // Outside a field the picture is what was meant.
  assert.equal(page.pastedReference([words, file('image/png')], false).take.type, 'image/png')
  // A list the browser gives is no array: it has a length and numbered entries.
  assert.equal(page.pastedReference({ length: 1, 0: file('image/png') }, false).take.type, 'image/png')
})

test('B156: the page listens for a paste on the Design tab, and the box to add a picture says so', () => {
  assert.equal(script.split("document.addEventListener('paste', event => {").length, 2)
  // A picked file and a pasted picture take the same way to the board.
  assert.equal(script.split('async function addReference(file)').length, 2)
  assert.match(script, /if \(file !== undefined\) addReference\(file\)/)
  assert.match(script, /if \(file !== null\) return addReference\(file\)/)
  assert.match(script, /'Add a reference picture \(optional\), or paste one with Ctrl\+V'/)
  // Not while a window is open over the tab; and pictures still on their way count against the limit.
  assert.match(script, /if \(\$\('view-design'\)\.hidden \|\| document\.querySelector\('dialog\[open\]'\) !== null\) return/)
  assert.match(script, /designDraft\.references\.length \+ referencesOnTheWay >= limits\.references/)
  assert.match(script, /\} finally \{\n      referencesOnTheWay -= 1/)
})

test('B368: part 3 is open without a picture: for a new idea, and for an idea not agreed to; a step goes without one', () => {
  const fresh = view(design(), { idea: null, version: null })
  assert.equal(fresh.form, 'open')
  assert.equal(view(design()).form, 'open')
  assert.equal(view(design([idea({ versions: [] })])).form, 'open')
  // A board without the Design part has nothing to fill in.
  assert.equal(page.designView(null, { idea: null, version: null }, NOW).form, 'locked')
  const form = { title: 'Sort the backlog', description: '', requirements: [''], worker: '', time: '' }
  assert.deepEqual(plain(page.sendBody(null, form, 'backlog', design())), { body: { action: 'send', where: 'backlog', title: 'Sort the backlog', description: '', requirements: [], worker: null, minutes: null } })
  assert.deepEqual(plain(page.blankForm()), { title: '', description: '', requirements: [''], worker: '', time: '' })
  assert.equal(page.bareSentWords({ where: 'queue', worker: 'Units', title: 'Sort it' }, 'Main'), 'Sent: you asked Main to have "Sort it" put in the queue of Units. It shows on the backlog once Main wrote it.')
  assert.match(script, /\$\('design-fields'\)\.disabled = !isOpen \|\| isDesignSending/)
  // With a picture everything is as it was: agree, take it back, and the idea's id in the step.
  assert.equal(page.sendBody(idea(), form, 'queue', design()).body.idea, 'i1')
  const agreed = view(design([idea({ agreed: 2, status: 'agreed' })]))
  assert.deepEqual([agreed.form, agreed.canTakeBack], ['open', true])
  assert.deepEqual([view(design()).canAgree], [true])
  // The click sends without an idea, and the note says no picture is needed.
  assert.doesNotMatch(script, /view\.idea === null \|\| form === null \|\| view\.form !== 'open'/)
  assert.doesNotMatch(script, /Agree with a picture first/)
})
