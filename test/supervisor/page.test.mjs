// The supervisor's Task 4: its section on the page, "Check now" and the person's line (spec 2026-10-24, "To you and to
// the Advisor"). The section stands where "Out of sync?" opened its list: when it checked itself, the incident cards (one
// per fix step, the person's choice of layout B), the last check, the rules (one folded line) and the last sweep. "Check now" carries a wrench
// in the button's own colour. Each new or returning incident gives the person one quiet line; nothing of it is in the
// person's attention colours. The page's parts are cut out of board.js and run on their own. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { demoSupervisor } from '../../fixtures/demo.mjs'
import { SUPERVISOR_RULES, incidentCards } from '../../src/supervisor/index.mjs'
import { incidentsOf } from '../../src/supervisor/incidents.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')

const MIN = 60_000
const at = (h, m) => new Date(2026, 9, 24, h, m).getTime()
const NOW = at(10, 42)

const page = { clock: ms => new Date(ms).toTimeString().slice(0, 5) }
vm.runInNewContext(`${script.slice(script.indexOf('// supervisor:start'), script.indexOf('// supervisor:end'))}
this.supervisorOf = supervisorOf; this.isSupervisorShown = isSupervisorShown; this.supervisorLine = supervisorLine; this.gistOf = gistOf; this.incidentCardOf = incidentCardOf
this.supervisorCounts = supervisorCounts; this.isNewIncident = isNewIncident; this.supervisorKept = supervisorKept; this.foldSupervisor = foldSupervisor`, page)
/** The page's objects are of another realm (vm): compared as JSON. */
const plain = value => JSON.parse(JSON.stringify(value))

const rule = (id, kind, says, state, trips = 0, why = null) => ({ id, kind, says, state, trips, why })
const VIEW = {
  run: { at: at(10, 40), asked: true, subject: 'Worker 2', fine: 8, rows: [{ check: 'blocked', status: 'Fixed', text: 'B21 waited on B20, which is in review: unblocked' }], findings: [] },
  checkedAt: at(10, 40),
  rules: [
    rule('blocked', 'repair', 'a step blocked by one in review', 'tripped', 2),
    rule('limit-back', 'repair', 'a worker paused for the limit after its time', 'fine', 1),
    rule('old-name', 'repair', 'a chat that asks under an old name', 'failed', 0, 'rule old-name failed: a torn list'),
    rule('unknown-lane', 'watch', 'a worker "unknown" for too long', 'tripped', 5),
    rule('old-mod', 'watch', 'a chat on an older Workers mod than the one installed', 'fine', 0),
  ],
  incidents: [
    { id: 'X3', title: 'Worker 2 unknown for 15 min, B482 waits', state: 'open', fix: null, count: 5, firstSeen: at(10, 27), lastSeen: at(10, 40), since: at(10, 27) },
    { id: 'X2', title: 'All 4 workers idle for 12 min', state: 'fix', fix: 'B490', count: 1, firstSeen: at(9, 10), lastSeen: at(9, 10), since: at(9, 30) },
    { id: 'X1', title: 'Painter: its clear was skipped twice in a row', state: 'fixed', fix: 'B488', count: 2, firstSeen: at(7, 12), lastSeen: at(7, 42), since: at(8, 0) },
  ],
  cards: [
    { key: 'B490', step: 'B490', title: 'Wake a worker that stays unknown', state: { text: 'Worker 5 · building', tone: 'busy' }, incidents: [{ id: 'X2', word: null }], at: at(10, 30) },
    { key: 'nofix', step: null, title: 'No fix step yet', state: { text: 'sending to the Advisor…', tone: 'sending' }, incidents: [{ id: 'X3', word: 'sending to the Advisor…' }], at: at(10, 27) },
    { key: 'B488', step: 'B488', title: 'A clear that cannot be saved is not skipped', state: { text: 'done · fixed', tone: 'done' }, incidents: [{ id: 'X1', word: null }], at: at(8, 0) },
  ],
  lastSweep: null,
}

test('the section: when it checked itself, one card per fix step, the last check, the rules folded in one line, and "No sweep yet"', () => {
  const shown = plain(page.supervisorOf(VIEW, { now: NOW }))
  assert.match(shown.note, /^Checked itself at 10:40\. /)
  assert.deepEqual(shown.cards.map(card => [card.key, card.href, card.title, card.state, card.tone, card.line]), [
    ['B490', '#details=B490', 'Wake a worker that stays unknown', 'Worker 5 · building', 'busy', 'X2 · All 4 workers idle for 12 min'],
    ['nofix', null, 'No fix step yet', 'sending to the Advisor…', 'sending', 'X3 · Worker 2 unknown for 15 min (seen 5×)'],
    ['B488', '#details=B488', 'A clear that cannot be saved is not skipped', 'done · fixed', 'done', 'X1 · Painter: its clear was skipped twice in a row (seen 2×)'],
  ])
  assert.deepEqual([shown.check.head, shown.check.rows.map(row => [row.status, row.tone, row.text])], ['Last check at 10:40, asked about Worker 2', [
    ['Fixed', 'done', 'B21 waited on B20, which is in review: unblocked'], ['Fine', 'fine', '8 other checks: nothing stuck'],
  ]])
  // The rules that tripped now or today, or failed, first, with how often; the others counted, shown on a click.
  assert.equal(shown.rules.head, '5 rules · 2 tripped · 1 failed')
  assert.deepEqual(shown.rules.shown.map(one => [one.id, one.tone, one.often, one.why]), [
    ['blocked', 'tripped', '2× today', null], ['limit-back', 'fine', '1× today', null], ['old-name', 'failed', 'fine today', 'rule old-name failed: a torn list'], ['unknown-lane', 'tripped', '5× today', null],
  ])
  assert.deepEqual(shown.rules.rest.map(one => [one.id, one.tone, one.often]), [['old-mod', 'fine', 'fine today']])
  assert.equal(shown.sweep, 'No sweep yet.')
  // Before its first run, and on a board without a supervisor.
  const fresh = plain(page.supervisorOf({ run: null, checkedAt: null, rules: [rule('blocked', 'repair', 'x', null)], incidents: [], lastSweep: null }, { now: NOW, isOpen: false }))
  assert.deepEqual([fresh.head, fresh.note.split('.')[0], fresh.check, fresh.cards, fresh.rules.rest[0].often], ['Supervisor · 0 found today · 0 in work · 0 new', 'Not checked yet', null, [], 'not checked yet'])
  assert.equal(page.supervisorOf(null), null)
})

test('Part 2, the last sweep: running, what it found and cost, why none ran (said plainly), the day\'s sweeps; the note names the schedule', () => {
  const sweep = (more = {}) => ({ at: at(10, 30), asked: false, subject: null, ended: at(10, 32), found: 2, read: true, tokens: 31200, tokenParts: null, note: null, ...more })
  const of = more => plain(page.supervisorOf({ ...VIEW, sweepEvery: 10, sweepNote: null, sweepsToday: { count: 1, tokens: 31200 }, ...more }))
  assert.equal(of({ lastSweep: sweep() }).sweep, 'Last sweep at 10:30 (by the clock): 2 findings, 31,200 tokens.')
  assert.equal(of({ lastSweep: sweep({ asked: true, subject: 'Worker 2', ended: null, found: 0, tokens: null, note: 'its chat does not run: the main chat was asked to start it' }) }).sweep,
    'Sweep at 10:30 (asked, about Worker 2): running; its chat does not run: the main chat was asked to start it.')
  assert.equal(of({ lastSweep: sweep({ found: 1, tokens: null }) }).sweep, 'Last sweep at 10:30 (by the clock): one finding, its tokens not read yet.')
  // Review Focus 4: why no sweep ran, before the last one that did.
  assert.equal(of({ lastSweep: sweep(), sweepNote: { at: at(10, 41), why: 'no chat "Game - Supervisor" is open in the app', asked: true } }).sweep,
    'No sweep at 10:41: no chat "Game - Supervisor" is open in the app. Last sweep at 10:30 (by the clock): 2 findings, 31,200 tokens.')
  assert.equal(of({ lastSweep: null, sweepNote: { at: at(10, 41), why: 'the list of chats names no supervisor chat ("supervisor" in .claude/chats/list.json)', asked: true } }).sweep,
    'No sweep at 10:41: the list of chats names no supervisor chat ("supervisor" in .claude/chats/list.json).')
  assert.equal(of({ lastSweep: sweep(), sweepsToday: { count: 6, tokens: 190000 } }).sweep, 'Last sweep at 10:30 (by the clock): 2 findings, 31,200 tokens. Today 6 sweeps, 190,000 tokens.')
  assert.equal(of({ lastSweep: null }).note, 'Checked itself at 10:40. It checks every 3 min and sweeps every 10 min while work runs; Check now does both.')
  assert.equal(of({ lastSweep: null, sweepEvery: 0 }).note, 'Checked itself at 10:40. It checks every 3 min; Check now checks and sweeps at once.')
  // Check now no longer asks the main chat: its titles say so.
  assert.doesNotMatch(script.slice(script.indexOf('function syncPart('), script.indexOf('// syncline:start')), /asks \$\{state\.workers\.mainTitle/)
})

// B573, the person (2026-10-24): "the supervisor notes take up too much space. i want it collapisble and understand how
// many things it found and is working on ... determine when it found something new". A store in memory, as the board
// reads it: X1 came back, X20 fixed, X21 with the Advisor since yesterday, X22 to X24 with fix steps.
const record = (head, history = []) => ({ head: new Map(Object.entries(head)), sections: new Map(history.length === 0 ? [] : [['History', history.map(([time, who, what]) => `- ${stamp(time)} ${who}: ${what}`)]]) })
const DAY = 24 * 60 * MIN
const incidentRecord = (id, state, found, more = {}, history = []) => record({ Id: id, Kind: 'incident', Title: `Finding ${id}`, State: state, 'First seen': stamp(found), 'Last seen': stamp(found), Since: stamp(found), Count: '1', ...more }, history)
const STORE = new Map([
  incidentRecord('X1', 'came back', at(10, 20) - 2 * DAY, { Since: stamp(at(10, 20)), 'Last seen': stamp(at(10, 20)), Count: '4' },
    [[at(10, 20) - 2 * DAY, 'board', 'opened by the rule blocked'], [at(10, 20) - DAY, 'board', 'fixed'], [at(10, 20), 'board', 'came back (seen 4 times)']]),
  incidentRecord('X20', 'fixed', at(8, 0), { Fix: 'B599' }),
  incidentRecord('X21', 'with the advisor', at(9, 0) - DAY),
  incidentRecord('X22', 'fix', at(9, 0), { Fix: 'B600' }),
  incidentRecord('X23', 'fix', at(9, 30), { Fix: 'B601' }),
  incidentRecord('X24', 'fix', at(10, 30), { Fix: 'B602' }),
  record({ Id: 'B599', Kind: 'step', Title: 'Fix of X20', State: 'done', Since: stamp(at(9, 0)) }),
  record({ Id: 'B600', Kind: 'step', Title: 'Fix of X22', State: 'queued', Owner: 'Worker 2', Since: stamp(at(9, 5)) }),
  record({ Id: 'B601', Kind: 'step', Title: 'Fix of X23', State: 'in progress', Owner: 'Worker 3', Since: stamp(at(9, 40)) }),
  record({ Id: 'B602', Kind: 'step', Title: 'Fix of X24', State: 'review', Owner: 'Worker 4', Since: stamp(at(10, 35)) }),
].map(item => [item.head.get('Id'), item]))
const viewOfStore = () => {
  const incidents = incidentsOf(STORE, NOW)
  return { run: null, checkedAt: at(10, 40), rules: [], incidents, cards: incidentCards({ incidents, items: STORE, lanes: [] }), lastSweep: null }
}

test('B573: the head counts from the store: found today (opened or came back), in work (a fix step queued to review), with the Advisor, fixed', () => {
  const view = viewOfStore()
  assert.deepEqual(plain(page.supervisorCounts(view, at(10, 0), NOW)), { found: 5, inWork: 3, withAdvisor: 2, fixed: 1, fresh: 2 })
  assert.equal(page.supervisorOf(view, { seenAt: at(10, 0), isOpen: false, now: NOW }).head, 'Supervisor · 5 found today · 3 in work · 2 new')
  assert.equal(page.supervisorOf(view, { seenAt: at(10, 0), isOpen: true, now: NOW }).head, 'Supervisor · 5 found today · 3 in work · 2 new · 2 with the Advisor · 1 fixed')
  // X1 counts as found today because it came back today, though it opened two days ago.
  assert.equal(view.incidents.find(one => one.id === 'X1').foundAt, at(10, 20))
  assert.equal(view.incidents.find(one => one.id === 'X22').foundAt, at(9, 0))
})

test('B573: New only for what was found since the person last opened the section; those cards come first; never for a fixed one', () => {
  const view = viewOfStore()
  const one = (found, more = {}) => ({ id: 'X9', state: 'open', foundAt: found, ...more })
  assert.equal(page.isNewIncident(one(at(10, 20)), at(10, 0), NOW), true)
  assert.equal(page.isNewIncident(one(at(10, 20)), at(10, 30), NOW), false, 'seen after it was found')
  assert.equal(page.isNewIncident(one(at(10, 20), { state: 'fixed' }), at(10, 0), NOW), false, 'fixed since')
  assert.equal(page.isNewIncident(one(at(10, 20)), null, NOW), true, 'never opened: what was found today')
  assert.equal(page.isNewIncident(one(NOW - 2 * DAY), null, NOW), false, 'never opened: not what was found days ago')
  // X1 (came back 10:20, no fix step) and X24 (10:30, B602) are new since 10:00; their cards first, each with New.
  const drawn = plain(page.supervisorOf(view, { seenAt: at(10, 0), now: NOW }))
  assert.deepEqual(drawn.cards.map(card => [card.key, card.isNew]), [['B602', true], ['nofix', true], ['B601', false], ['B600', false], ['B599', false]])
  const later = plain(page.supervisorOf(view, { seenAt: at(10, 25), now: NOW }))
  assert.deepEqual(later.cards.filter(card => card.isNew).map(card => card.key), ['B602'])
  // The open section's tags stand against the opening before, so opening does not wipe them at once.
  assert.match(script, /supervisorOf\(view, \{ seenAt: isOpen \? supervisorUi\.shownSince : supervisorUi\.seenAt, isOpen, now: Date\.now\(\) \}\)/)
  assert.match(script, /if \(card\.isNew\) top\.append\(el\('span', 'inc-new', 'New'\)\)/)
})

test('B573: folded by default; the fold and the last opening are kept across a reload; storage that fails leaves it folded', () => {
  const storage = () => {
    const kept = new Map()
    return { getItem: key => (kept.has(key) ? kept.get(key) : null), setItem: (key, value) => kept.set(key, String(value)), removeItem: key => kept.delete(key) }
  }
  const store = storage()
  assert.deepEqual(plain(page.supervisorKept(store)), { isOpen: false, seenAt: null, shownSince: null })
  const ui = page.supervisorKept(store)
  page.foldSupervisor(ui, true, store, at(10, 0))
  // A reload: the page reads what it kept.
  assert.deepEqual(plain(page.supervisorKept(store)), { isOpen: true, seenAt: at(10, 0), shownSince: null })
  page.foldSupervisor(ui, false, store, at(10, 5))
  assert.deepEqual(plain(page.supervisorKept(store)), { isOpen: false, seenAt: at(10, 0), shownSince: null }, 'folding is no opening')
  page.foldSupervisor(ui, true, store, at(10, 50))
  assert.deepEqual(plain(page.supervisorKept(store)), { isOpen: true, seenAt: at(10, 50), shownSince: at(10, 0) })
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
  assert.deepEqual(plain(page.supervisorKept(broken)), { isOpen: false, seenAt: null, shownSince: null })
  assert.equal(page.foldSupervisor({ isOpen: false, seenAt: null, shownSince: null }, true, broken, at(10, 0)).isOpen, true, 'kept for this visit')
  assert.deepEqual(plain(page.supervisorKept(null)), { isOpen: false, seenAt: null, shownSince: null })
  // The section stands folded on every board with a supervisor; the head's line opens and folds it.
  assert.equal(page.isSupervisorShown(VIEW), true)
  assert.equal(page.isSupervisorShown(null), false, 'no supervisor on this board')
  assert.match(script, /const supervisorUi = \{ \.\.\.supervisorKept\(supervisorStorage\), /)
  assert.match(script, /'supervisor-fold': \(\) => setSupervisorOpen\(!supervisorUi\.isOpen\)/)
  assert.match(script, /if \(!isOpen\) return fill\(box, \[head\]\)/)
})

test('B573: the supervisor\'s notes under Needs your attention are one line, "Supervisor: 3 new findings"; opening the section reads them', () => {
  const information = [
    { id: 'N7', via: 'supervisor', isRead: false, about: 'X3', text: 'Supervisor: Worker 2 unknown for 15 min, B482 waits' },
    { id: 'N8', via: 'supervisor', isRead: false, about: 'X4', text: 'Supervisor: a step waits' },
    { id: 'N9', via: 'supervisor', isRead: false, about: 'X5', text: 'Supervisor: a chat is off' },
    { id: 'N6', via: 'supervisor', isRead: true, about: 'X2', text: 'Supervisor: All 4 workers idle for 12 min' },
    { id: 'N5', via: null, isRead: false, about: 'B12', text: 'A report' },
  ]
  assert.deepEqual(plain(page.supervisorLine(information)), { ids: ['N7', 'N8', 'N9'], text: 'Supervisor: 3 new findings' })
  assert.deepEqual(plain(page.supervisorLine(information.slice(2))), { ids: ['N9'], text: 'Supervisor: one new finding' })
  assert.equal(page.supervisorLine(information.slice(3)), null)
  assert.equal(page.supervisorLine([]), null)
  // Drawn under Needs your attention after the missed lines, never counted; a click opens the section, which reads them.
  assert.match(script, /const supervised = supervisorLine\(state\.information, /)
  assert.match(script, /drawMissed\(missed\), drawSupervisorLine\(supervised\)/)
  assert.doesNotMatch(script.match(/const unanswered = [^\n]*/)[0], /supervised/)
  assert.match(script, /'supervisor-line': \(\) => openSupervisor\(\)/)
  assert.match(script, /function setSupervisorOpen\(isOpen\) \{\n\s+foldSupervisor\(supervisorUi, isOpen, supervisorStorage, Date\.now\(\)\)\n\s+if \(isOpen\) readSupervisorNotes\(\)/)
  assert.match(script, /function readSupervisorNotes\(ids = supervisorLine\(board\?\.information\)\?\.ids \?\? \[\]\) \{\n\s+for \(const id of ids\) \{\n\s+if \(!sending\.has\(`read:\$\{id\}`\)\) sendWork\(\{ action: 'read', id \}, `read:\$\{id\}`\)/)
})

test('B581: a small x closes the supervisor\'s line: its notes are read, the section stays folded, a new finding brings a line back', () => {
  const information = [
    { id: 'N7', via: 'supervisor', isRead: false, about: 'X3', text: 'Supervisor: Worker 2 unknown for 15 min, B482 waits' },
    { id: 'N8', via: 'supervisor', isRead: false, about: 'X4', text: 'Supervisor: a step waits' },
  ]
  // The x sends the reads; while they are on their way the line is gone at once.
  const closing = new Set(['N7', 'N8'])
  assert.equal(page.supervisorLine(information, id => closing.has(id)), null)
  assert.deepEqual(plain(page.supervisorLine(information, id => id === 'N7')), { ids: ['N8'], text: 'Supervisor: one new finding' })
  // Read (and so after a reload): closed; a new or returning incident is a new note, and a line again.
  const read = information.map(one => ({ ...one, isRead: true }))
  assert.equal(page.supervisorLine(read), null)
  assert.deepEqual(plain(page.supervisorLine([{ id: 'N9', via: 'supervisor', isRead: false, about: 'X3', text: 'Supervisor: came back' }, ...read])), { ids: ['N9'], text: 'Supervisor: one new finding' })
  assert.match(script, /const supervised = supervisorLine\(state\.information, id => sending\.has\(`read:\$\{id\}`\)\)/)
  // The x: quiet, beside the line (not inside its button, which opens the section), with its tooltip.
  const draw = script.slice(script.indexOf('function drawSupervisorLine('), script.indexOf('function setSupervisorOpen('))
  assert.match(draw, /const close = el\('button', 'icon-button supervisor-line-close', '×'\)/)
  assert.match(draw, /close\.dataset\.supervisorClose = line\.ids\.join\(' '\)/)
  assert.match(draw, /close\.title = 'Close this line; the incidents stay open'/)
  assert.match(draw, /row\.append\(button, close\)/)
  // Its act reads exactly the line's notes, and neither opens the section nor marks its New tags seen.
  const act = script.match(/'supervisor-close': [^\n]*/)[0]
  assert.match(act, /readSupervisorNotes\(button\.dataset\.supervisorClose\.split\(' '\)\.filter\(Boolean\)\)/)
  assert.doesNotMatch(act, /setSupervisorOpen|openSupervisor|foldSupervisor/)
  assert.match(css, /\.supervisor-line-close \{/)
})

test('"Check now" carries the wrench, in the button\'s own colour, and sends the sync command; from a worker\'s menu it names the worker', () => {
  assert.match(script, /wrench: 'M14\.7 6\.3/)
  const button = script.slice(script.indexOf('function checkNowButton('), script.indexOf('/** The supervisor\'s section under the Workers panel\'s head'))
  assert.match(button, /const wrench = icon\('wrench'\)/)
  assert.match(button, /button\.append\(wrench, el\('span', '', 'Check now'\)\)/)
  assert.match(button, /button\.dataset\.sync = about/)
  // icon() draws in currentColor: the button's own colour.
  assert.match(script.slice(script.indexOf('function icon(name)'), script.indexOf('function icon(name)') + 400), /stroke: 'currentColor'/)
  assert.match(script, /return checkNowButton\(lane\.name, state, /)
  assert.match(script, /send\(\{ to: main, command: 'sync', chat \}, `sync:\$\{chat\}`\)/)
  // The server runs the supervisor at once, about that worker (null for the whole board): since Part 2 the rules and a
  // sweep (`checkNow`), no word to the main chat.
  assert.match(server, /const subject = typeof body\?\.chat === 'string' && body\.chat !== 'board' \? body\.chat\.slice\(0, 80\) : null/)
  assert.match(server, /await supervisor\.checkNow\(\{ subject \}\)/)
  assert.doesNotMatch(script, /'Out of sync\?'\)/, 'no button says "Out of sync?" any more')
})

// The person's attention colours: amber, gold, orange, red, yellow. A colour is warm when its hue is from red to yellow.
const ROOT_TOKENS = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,8})\b/gi)].map(match => [match[1], match[2]]))
const hexOf = value => {
  const named = value.match(/var\(--([\w-]+)\)/)
  return named === null ? value : ROOT_TOKENS[named[1]] ?? null
}
function hueOf(hex) {
  let h = hex.replace('#', '')
  if (h.length <= 4) h = [...h].map(c => c + c).join('')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const saturation = max === 0 ? 0 : (max - min) / max
  if (max === min) return { hue: null, saturation }
  const hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  return { hue: (hue * 60 + 360) % 360, saturation }
}
const isWarm = hex => {
  const { hue, saturation } = hueOf(hex)
  return hue !== null && saturation > 0.25 && (hue < 70 || hue >= 330)
}

test('no colour of the section, its lines or the button is amber, gold, orange, red or yellow', () => {
  const block = css.slice(css.indexOf('/* supervisor:start */'), css.indexOf('/* supervisor:end */'))
  assert.ok(block.length > 500, 'the supervisor\'s styles stand between their marks')
  assert.doesNotMatch(block, /\b(?:amber|gold|orange|red|yellow)\b/i)
  assert.doesNotMatch(block, /var\(--(?:waiting|warn|partner)\)/, 'the attention tokens')
  const colours = [...block.matchAll(/(?:color|background|border(?:-left)?)\s*:\s*([^;]+);/g)].flatMap(match => match[1].match(/#[0-9a-f]{3,8}\b|var\(--[\w-]+\)/gi) ?? [])
  assert.ok(colours.length > 10)
  const warm = colours.map(hexOf).filter(hex => hex !== null && isWarm(hex))
  assert.deepEqual(warm, [])
  // The quiet button "Check now" takes the quiet button's own colours.
  const quiet = css.match(/\.quiet-button \{[^}]*\}/)[0]
  assert.deepEqual((quiet.match(/#[0-9a-f]{3,8}\b|var\(--[\w-]+\)/gi) ?? []).map(hexOf).filter(hex => hex !== null && isWarm(hex)), [])
  // the test itself tells warm from cool
  assert.equal(isWarm('#f6b93b'), true)
  assert.equal(isWarm('#ff7a59'), true)
  assert.equal(isWarm('#7cc4ff'), false)
})

test('the demo shows the section: every rule of the supervisor, three tripped today, the incidents of the day the cards were drawn on and their cards', () => {
  const view = demoSupervisor(NOW, SUPERVISOR_RULES, incidentCards)
  assert.equal(view.rules.length, SUPERVISOR_RULES.length)
  assert.deepEqual(view.rules.filter(one => one.state === 'tripped').map(one => one.id).sort(), ['blocked', 'limit-back', 'unknown-lane'])
  assert.deepEqual(view.incidents.map(one => [one.id, one.state, one.fix]).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })), [
    ['X1', 'fix', 'B532'], ['X2', 'fix', 'B532'], ['X3', 'fix', 'B532'], ['X4', 'fix', 'B541'], ['X5', 'fix', 'B541'], ['X6', 'fix', 'B541'],
    ['X7', 'fix', 'B542'], ['X8', 'fix', 'B543'], ['X9', 'fix', 'B544'], ['X10', 'open', null],
  ])
  // Five fix cards (the step being built first, as it moved last) and the new one still on its way to the Advisor.
  assert.deepEqual(view.cards.map(card => [card.key, card.state.text, card.incidents.map(one => one.id).join(' ')]), [
    ['B532', 'Worker 5 \u00b7 building', 'X1 X2 X3'], ['B541', 'refined \u00b7 on the list', 'X4 X5 X6'], ['B542', 'refined \u00b7 on the list', 'X7'],
    ['B543', 'refined \u00b7 on the list', 'X8'], ['B544', 'refined \u00b7 on the list', 'X9'], ['nofix', 'sending to the Advisor\u2026', 'X10'],
  ])
  assert.equal(view.checkedAt, NOW - 2 * MIN)
  assert.equal(page.isSupervisorShown(view), true)
  assert.match(server, /supervisor: supervised \?\? \(isDemo \? demoSupervisor\(clock\(\), SUPERVISOR_RULES, incidentCards\) : null\),/)
  // The page's cards of that view, as the picture shows them.
  const drawn = plain(page.supervisorOf(view, { seenAt: NOW, now: NOW }))
  assert.deepEqual(drawn.cards.map(card => [card.href, card.line]), [
    ['#details=B532', 'X1 X2 X3 \u00b7 21 words to Advisor not delivered (seen 18\u00d7)'],
    ['#details=B541', 'X4 X5 X6 \u00b7 Worker 1 runs the Workers mod older than 0.16.0 (seen 5\u00d7)'],
    ['#details=B542', 'X7 \u00b7 Queued steps wait 2 h 48 min on steps that sit in review\u2026'],
    ['#details=B543', 'X8 \u00b7 Steps pile up in review for hours'],
    ['#details=B544', 'X9 \u00b7 Effort shows "[object Object]" on a step in review'],
    [null, 'X10 \u00b7 Steps in progress still show "waits for" another step'],
  ])
})

test('a card: the step\'s id as a link and its short title, the live state in a chip, one quiet line; "seen N\u00d7" only when N > 1', () => {
  const byId = new Map([
    ['X4', { id: 'X4', title: 'Worker 1 runs the Workers mod older than 0.16.0; 0.16.0 is installed', state: 'fix', fix: 'B541', count: 1, firstSeen: at(10, 1), lastSeen: at(10, 1), evidence: null }],
    ['X5', { id: 'X5', title: 'Worker 2 runs the Workers mod older than 0.16.0; 0.16.0 is installed', state: 'fix', fix: 'B541', count: 3, firstSeen: at(10, 1), lastSeen: at(10, 30), evidence: null }],
  ])
  const card = { key: 'B541', step: 'B541', title: 'One clear way to update an old mod', state: { text: 'refined \u00b7 on the list', tone: 'wait' }, incidents: [{ id: 'X4', word: null }, { id: 'X5', word: null }] }
  const one = plain(page.incidentCardOf(card, byId))
  assert.deepEqual([one.key, one.step, one.href, one.title, one.state, one.tone], ['B541', 'B541', '#details=B541', 'One clear way to update an old mod', 'refined \u00b7 on the list', 'wait'])
  assert.equal(one.line, 'X4 X5 \u00b7 Worker 1 runs the Workers mod older than 0.16.0 (seen 3\u00d7)', 'the most it was seen, only above once')
  const once = plain(page.incidentCardOf({ ...card, incidents: [{ id: 'X4', word: null }] }, byId))
  assert.equal(once.line, 'X4 \u00b7 Worker 1 runs the Workers mod older than 0.16.0')
  // The words of a title: up to its first ";" or ", ", and a word near the limit; nothing for none.
  assert.equal(page.gistOf('Steps pile up in review for hours, one for 3 days'), 'Steps pile up in review for hours')
  assert.equal(page.gistOf('Queued steps wait 2 h 48 min on steps that sit in review while workers are free'), 'Queued steps wait 2 h 48 min on steps that sit in review\u2026')
  assert.equal(page.gistOf('Painter: its clear was skipped twice in a row'), 'Painter: its clear was skipped twice in a row')
  assert.equal(page.gistOf(null), '')
  // A step the store does not have still has a card.
  assert.equal(plain(page.incidentCardOf({ ...card, title: null }, byId)).title, '(this step is not in the store)')
})

test('the card without a fix step names each incident\'s own state when they differ, and one state once when they do not', () => {
  const byId = new Map([
    ['X8', { id: 'X8', title: 'Steps pile up in review for hours, one for 3 days', state: 'with the advisor', count: 4 }],
    ['X10', { id: 'X10', title: 'Steps in progress still show "waits for" another step', state: 'open', count: 1 }],
  ])
  const card = (...words) => ({ key: 'nofix', step: null, title: 'No fix step yet', state: { text: 'sending to the Advisor\u2026', tone: 'sending' }, incidents: [['X8', words[0]], ['X10', words[1]]].map(([id, word]) => ({ id, word })) })
  assert.equal(plain(page.incidentCardOf(card('with the Advisor', 'sending to the Advisor\u2026'), byId)).line,
    'X8 Steps pile up in review for hours (with the Advisor, seen 4\u00d7) \u00b7 X10 Steps in progress still show "waits for"\u2026 (sending to the Advisor\u2026)')
  assert.equal(plain(page.incidentCardOf(card('with the Advisor', 'with the Advisor'), byId)).line, 'X8 X10 \u00b7 Steps pile up in review for hours (seen 4\u00d7)')
  assert.equal(plain(page.incidentCardOf(card('with the Advisor', 'with the Advisor'), byId)).href, null)
})

test('the evidence, the times and the counts fold away: a card holds them for a click, one block per incident', () => {
  const evidence = `18:13 round (waiting); ${'x'.repeat(900)}`
  const byId = new Map([
    ['X1', { id: 'X1', title: '21 words to Advisor not delivered, the oldest for 12980 min', state: 'fix', fix: 'B532', count: 18, firstSeen: at(15, 23), lastSeen: at(18, 34), evidence, ruleWanted: 'a word waiting over an hour' }],
    ['X3', { id: 'X3', title: '1 word to Worker 5 not delivered', state: 'fixed', fix: 'B532', count: 1, firstSeen: at(15, 23), lastSeen: at(15, 23), evidence: '13:13 answer (waiting)' }],
  ])
  const card = page.incidentCardOf({ key: 'B532', step: 'B532', title: 'Outbox', state: { text: 'Worker 5 \u00b7 building', tone: 'busy' }, incidents: [{ id: 'X1', word: null }, { id: 'X3', word: null }] }, byId)
  // Nothing of it is in the line: no time, no evidence.
  assert.doesNotMatch(card.line, /\d\d:\d\d|round|waiting/)
  assert.deepEqual(plain(card.details.map(one => [one.id, one.title, one.state, one.seen, one.ruleWanted])), [
    ['X1', '21 words to Advisor not delivered, the oldest for 12980 min', 'fix B532', 'seen 18 times, since 15:23, last 18:34', 'a word waiting over an hour'],
    ['X3', '1 word to Worker 5 not delivered', 'fixed', 'seen once, since 15:23', null],
  ])
  assert.equal(card.details[0].evidence.length, 601, 'the evidence is cut where it is long: 600 and the dots')
  assert.match(card.details[0].evidence, /^18:13 round \(waiting\); x+\u2026$/)
  assert.equal(card.details[1].evidence, '13:13 answer (waiting)')
})

test('the fixed cards beyond the newest three fold under one button; the cards that are not fixed are all in sight', () => {
  const cards = [
    { key: 'B1', step: 'B1', title: 'one', state: { text: 'in review', tone: 'review' }, incidents: [{ id: 'X1', word: null }] },
    ...[2, 3, 4, 5, 6].map(n => ({ key: `B${n}`, step: `B${n}`, title: `fixed ${n}`, state: { text: 'done \u00b7 fixed', tone: 'done' }, incidents: [{ id: `X${n}`, word: null }] })),
    { key: 'nofix', step: null, title: 'No fix step yet', state: { text: 'with the Advisor', tone: 'advisor' }, incidents: [{ id: 'X9', word: 'with the Advisor' }] },
  ]
  const incidents = [1, 2, 3, 4, 5, 6, 9].map(n => ({ id: `X${n}`, title: `Incident ${n}`, state: n === 1 || n === 9 ? 'open' : 'fixed', count: 1 }))
  const drawn = plain(page.supervisorOf({ ...VIEW, incidents, cards }))
  assert.deepEqual(drawn.cards.map(card => card.key), ['B1', 'B2', 'B3', 'B4', 'nofix'])
  assert.deepEqual(drawn.older.map(card => card.key), ['B5', 'B6'])
  // Fewer than four fixed ones: nothing folds.
  assert.deepEqual(plain(page.supervisorOf({ ...VIEW, incidents, cards: cards.slice(0, 4) })).older, [])
})

// The page's drawing of a card, on a tiny stand-in for the document: each element keeps what the page gave it.
const fake = { clock: page.clock }
vm.runInNewContext(`
function el(tag, className = '', text = null) {
  const node = { tag, className, text, children: [], dataset: {}, attrs: {}, append(...more) { this.children.push(...more) }, setAttribute(name, value) { this.attrs[name] = value } }
  return node
}
${script.slice(script.indexOf('function drawIncidentCard('), script.indexOf('/** The supervisor\'s section under the Workers panel\'s head'))}
this.drawIncidentCard = drawIncidentCard`, fake)

test('the page draws a card: the id a link to its step, the chip in the state\'s tone, the line a button; the evidence only once opened', () => {
  const card = plain(page.incidentCardOf({ key: 'B532', step: 'B532', title: 'Outbox: messages that never arrive', state: { text: 'Worker 5 \u00b7 building', tone: 'busy' }, incidents: [{ id: 'X1', word: null }] },
    new Map([['X1', { id: 'X1', title: '21 words to Advisor not delivered', state: 'fix', fix: 'B532', count: 18, firstSeen: at(15, 23), lastSeen: at(18, 34), evidence: '18:13 round (waiting)' }]])))
  const closed = fake.drawIncidentCard(card, false)
  assert.deepEqual([closed.tag, closed.className, closed.dataset.supervisorCard], ['article', 'inc-card is-busy', 'B532'])
  const [top, line] = closed.children
  assert.equal(closed.children.length, 2, 'folded: the head and the line, no evidence')
  assert.deepEqual(plain(top.children.map(one => [one.tag, one.className, one.text])), [['a', 'inc-step', 'B532'], ['span', 'inc-title', 'Outbox: messages that never arrive'], ['span', 'inc-state is-busy', 'Worker 5 \u00b7 building']])
  assert.deepEqual([top.children[0].href, top.children[0].dataset.supervisorStep], ['#details=B532', 'B532'])
  assert.deepEqual([line.tag, line.className, line.text, line.type, line.attrs['aria-expanded']], ['button', 'inc-line', 'X1 \u00b7 21 words to Advisor not delivered (seen 18\u00d7)', 'button', 'false'])
  const open = fake.drawIncidentCard(card, true)
  assert.equal(open.className, 'inc-card is-busy is-open')
  assert.equal(open.children[1].attrs['aria-expanded'], 'true')
  const details = open.children[2]
  assert.equal(details.className, 'inc-details')
  assert.deepEqual(plain(details.children[0].children.map(one => [one.className, one.text])), [
    ['inc-detail-head', 'X1 \u00b7 21 words to Advisor not delivered'], ['inc-detail-meta', 'fix B532 \u00b7 seen 18 times, since 15:23, last 18:34'], ['inc-detail-evidence', 'Evidence: 18:13 round (waiting)'],
  ])
  // B573: a card with something new carries a quiet New tag first, and a class of its own.
  const fresh = fake.drawIncidentCard({ ...card, isNew: true }, false)
  assert.equal(fresh.className, 'inc-card is-busy is-new')
  assert.deepEqual(plain([fresh.children[0].children[0].className, fresh.children[0].children[0].text]), ['inc-new', 'New'])
  // The card without a fix step has no link, only its title.
  const none = fake.drawIncidentCard(plain(page.incidentCardOf({ key: 'nofix', step: null, title: 'No fix step yet', state: { text: 'sending to the Advisor\u2026', tone: 'sending' }, incidents: [{ id: 'X10', word: 'sending to the Advisor\u2026' }] }, new Map())), false)
  assert.deepEqual(plain(none.children[0].children.map(one => [one.tag, one.className])), [['span', 'inc-title'], ['span', 'inc-state is-sending']])
})

test('the page wires the cards: opened by a click on the card (its link opens the step instead), one folded line for the rules, the redraw knows what is open', () => {
  const clicks = script.slice(script.indexOf('const CLICK_ACTS = {'), script.indexOf('/** The act of a click:'))
  // The link's act stands before the card's: the table is read in order, so the id opens its step and does not also open the card.
  assert.ok(clicks.indexOf("'supervisor-step':") > 0 && clicks.indexOf("'supervisor-step':") < clicks.indexOf("'supervisor-card':"))
  assert.match(clicks, /'supervisor-step': \(\) => \{\n\s+setTimeout\(\(\) => \{\n\s+if \(board === null\) return\n\s+openFromAddress\(board\)\n\s+\/\/[^\n]*\n\s+if \(detailsOf === null && location\.hash\.startsWith\('#details='\)\) history\.replaceState\(null, '', location\.pathname\)/)
  assert.match(clicks, /'supervisor-card': button => \{\n\s+const key = button\.dataset\.supervisorCard\n\s+if \(!supervisorUi\.openCards\.delete\(key\)\) supervisorUi\.openCards\.add\(key\)/)
  assert.match(clicks, /'supervisor-older': \(\) => \{\n\s+supervisorUi\.showsOlder = !supervisorUi\.showsOlder/)
  const draw = script.slice(script.indexOf('function drawSupervisor('), script.indexOf('/** B573: the supervisor\'s one line under Needs your attention'))
  assert.match(draw, /once\('supervisor', \[view, shown, isOpen, supervisorUi\.seenAt, supervisorUi\.shownSince, supervisorUi\.showsRules, supervisorUi\.showsOlder, \[\.\.\.supervisorUi\.openCards\],/)
  // The rules are one folded line that opens the list; nothing of them is drawn while it is folded.
  assert.match(draw, /const fold = el\('button', 'quiet-button supervisor-more supervisor-rules-line'/)
  assert.match(draw, /if \(supervisorUi\.showsRules\) \{\n\s+const rules = el\('div', 'supervisor-rules'\)/)
  assert.doesNotMatch(draw, /Show the \$\{part\.rules\.rest\.length\} other rules/)
  // The old rows of incidents (with their long evidence lines and times) are gone.
  assert.doesNotMatch(draw, /incident-state|incident-words|supervisor-incidents/)
})

test('the cards\' styles are quiet blues and greys, nothing amber, gold, orange, red or yellow, and the chip wraps under the title on a phone', () => {
  const block = css.slice(css.indexOf('/* supervisor:start */'), css.indexOf('/* supervisor:end */'))
  for (const name of ['inc-card', 'inc-top', 'inc-step', 'inc-title', 'inc-state', 'inc-line', 'inc-details', 'inc-detail-evidence', 'supervisor-cards']) assert.match(block, new RegExp(`\\.${name}\\b`), name)
  for (const tone of ['wait', 'busy', 'idle', 'review', 'done', 'dropped', 'sending', 'advisor', 'back']) {
    if (tone !== 'wait') assert.match(block, new RegExp(`\\.inc-state\\.is-${tone}\\b`), `the chip of the tone ${tone}`)
  }
  const card = block.slice(block.indexOf('.supervisor-cards {'), block.indexOf('.sync-rows {'))
  const colours = [...card.matchAll(/(?:color|background|border(?:-color)?)\s*:\s*([^;]+);/g)].flatMap(match => match[1].match(/#[0-9a-f]{3,8}\b|var\(--[\w-]+\)/gi) ?? [])
  assert.ok(colours.length > 15)
  assert.deepEqual(colours.map(hexOf).filter(hex => hex !== null && isWarm(hex)), [])
  assert.match(block, /@media \(max-width: 600px\) \{[^]*\.inc-state \{ margin-left: 0; \}/)
  // The rows of the old list are not styled any more.
  assert.doesNotMatch(block, /\.incident-state|\.incident-words|\.supervisor-incidents/)
})

test('the server gives the view what the board knows at every refresh: the store as its keeper holds it, the chats, the Advisor\'s name', () => {
  const part = server.slice(server.indexOf('const stored = supervisor === null'), server.indexOf('return { ...state, design, goalsEdit'))
  assert.match(part, /const stored = supervisor === null \? undefined : await work\(\)/)
  assert.match(part, /supervisor\.view\(clock\(\), \{\n\s+items: stored\?\.ok === true \? stored\.items : null,/)
  assert.match(part, /lanes: \[\.\.\.\(state\.chats \?\? \[\]\), \.\.\.\(state\.advisor \? \[state\.advisor\] : \[\]\), \.\.\.\(state\.advisorHelper \? \[state\.advisorHelper\] : \[\]\)\],/)
  assert.match(part, /partner: state\.advisor\?\.name \?\? null,/)
})
