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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')

const MIN = 60_000
const at = (h, m) => new Date(2026, 9, 24, h, m).getTime()
const NOW = at(10, 42)

const page = { clock: ms => new Date(ms).toTimeString().slice(0, 5) }
vm.runInNewContext(`${script.slice(script.indexOf('// supervisor:start'), script.indexOf('// supervisor:end'))}
this.supervisorOf = supervisorOf; this.isSupervisorShown = isSupervisorShown; this.supervisorLines = supervisorLines; this.gistOf = gistOf; this.incidentCardOf = incidentCardOf`, page)
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
  const shown = plain(page.supervisorOf(VIEW))
  assert.equal(shown.title, 'Supervisor · checked itself at 10:40')
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
  const fresh = plain(page.supervisorOf({ run: null, checkedAt: null, rules: [rule('blocked', 'repair', 'x', null)], incidents: [], lastSweep: null }))
  assert.deepEqual([fresh.title, fresh.check, fresh.cards, fresh.rules.rest[0].often], ['Supervisor · not checked yet', null, [], 'not checked yet'])
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
  assert.equal(of({ lastSweep: null }).note, 'It checks every 3 min and sweeps every 10 min while work runs; Check now does both.')
  assert.equal(of({ lastSweep: null, sweepEvery: 0 }).note, 'It checks every 3 min; Check now checks and sweeps at once.')
  // Check now no longer asks the main chat: its titles say so.
  assert.doesNotMatch(script.slice(script.indexOf('function syncPart('), script.indexOf('// syncline:start')), /asks \$\{state\.workers\.mainTitle/)
})

test('the section shows when something is new: a check, or an incident that opened or changed; closed, it shows again only for something newer', () => {
  const ui = (more = {}) => ({ isOpen: false, closedAt: null, showsRules: false, ...more })
  assert.equal(page.isSupervisorShown(VIEW, ui()), true)
  assert.equal(page.isSupervisorShown(VIEW, ui({ closedAt: at(10, 41) })), false, 'closed after the newest')
  // The review: a check that finds the same again every 3 minutes is nothing new; a new repair finding is.
  assert.equal(page.isSupervisorShown({ ...VIEW, run: { ...VIEW.run, at: at(10, 45), newAt: at(10, 40) } }, ui({ closedAt: at(10, 41) })), false, 'the same finding, checked again')
  assert.equal(page.isSupervisorShown({ ...VIEW, run: { ...VIEW.run, at: at(10, 45), newAt: at(10, 45) } }, ui({ closedAt: at(10, 41) })), true, 'a new repair finding')
  assert.equal(page.isSupervisorShown({ ...VIEW, run: { ...VIEW.run, at: at(10, 45) } }, ui({ closedAt: at(10, 41) })), false, 'a check alone')
  // A count that grows is nothing new; a fixed incident is nothing new either.
  const quiet = { ...VIEW, run: null, incidents: [{ ...VIEW.incidents[0], count: 9, lastSeen: at(10, 50) }, VIEW.incidents[2]] }
  assert.equal(page.isSupervisorShown(quiet, ui({ closedAt: at(10, 41) })), false)
  assert.equal(page.isSupervisorShown({ run: null, incidents: [VIEW.incidents[2]], rules: [] }, ui()), false)
  assert.equal(page.isSupervisorShown({ run: null, incidents: [], rules: [] }, ui({ isOpen: true })), true, 'opened by the person')
  assert.equal(page.isSupervisorShown(null, ui({ isOpen: true })), false, 'no supervisor on this board')
})

test('a new or returning incident gives one quiet line (its note, Via supervisor, not read yet); a counted one gives none', () => {
  const information = [
    { id: 'N7', via: 'supervisor', isRead: false, about: 'X3', text: 'Supervisor: Worker 2 unknown for 15 min, B482 waits' },
    { id: 'N6', via: 'supervisor', isRead: true, about: 'X2', text: 'Supervisor: All 4 workers idle for 12 min' },
    { id: 'N5', via: null, isRead: false, about: 'B12', text: 'A report' },
  ]
  assert.deepEqual(plain(page.supervisorLines(information)), [{ id: 'N7', incident: 'X3', text: 'Supervisor: Worker 2 unknown for 15 min, B482 waits' }])
  assert.deepEqual(plain(page.supervisorLines([])), [])
  // Drawn under Needs your attention after the missed lines, never counted; a click opens the section and reads it.
  assert.match(script, /const supervised = supervisorLines\(state\.information\)/)
  assert.match(script, /drawMissed\(missed\), drawSupervisorLines\(supervised\)/)
  assert.doesNotMatch(script.match(/const unanswered = [^\n]*/)[0], /supervised/)
  assert.match(script, /'supervisor-line': button => \{\n\s+openSupervisor\(\)\n\s+sendWork\(\{ action: 'read', id: button\.dataset\.supervisorLine \}/)
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
    ['B532', 'Worker 5 \u00b7 building', 'X1 X2 X3'], ['B541', 'refined \u00b7 waits for Main', 'X4 X5 X6'], ['B542', 'refined \u00b7 waits for Main', 'X7'],
    ['B543', 'refined \u00b7 waits for Main', 'X8'], ['B544', 'refined \u00b7 waits for Main', 'X9'], ['nofix', 'sending to the Advisor\u2026', 'X10'],
  ])
  assert.equal(view.checkedAt, NOW - 2 * MIN)
  assert.equal(page.isSupervisorShown(view, { isOpen: false, closedAt: null }), true)
  assert.match(server, /supervisor: supervised \?\? \(isDemo \? demoSupervisor\(clock\(\), SUPERVISOR_RULES, incidentCards\) : null\),/)
  // The page's cards of that view, as the picture shows them.
  const drawn = plain(page.supervisorOf(view))
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
  const card = { key: 'B541', step: 'B541', title: 'One clear way to update an old mod', state: { text: 'refined \u00b7 waits for Main', tone: 'wait' }, incidents: [{ id: 'X4', word: null }, { id: 'X5', word: null }] }
  const one = plain(page.incidentCardOf(card, byId))
  assert.deepEqual([one.key, one.step, one.href, one.title, one.state, one.tone], ['B541', 'B541', '#details=B541', 'One clear way to update an old mod', 'refined \u00b7 waits for Main', 'wait'])
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
  const draw = script.slice(script.indexOf('function drawSupervisor('), script.indexOf('/** The supervisor\'s lines under Needs your attention'))
  assert.match(draw, /once\('supervisor', \[view, shown, supervisorUi\.showsRules, supervisorUi\.showsOlder, \[\.\.\.supervisorUi\.openCards\],/)
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
