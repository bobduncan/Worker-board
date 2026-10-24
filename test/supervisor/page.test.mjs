// The supervisor's Task 4: its section on the page, "Check now" and the person's line (spec 2026-10-24, "To you and to
// the Advisor"). The section stands where "Out of sync?" opened its list: when it checked itself, the incidents and
// their states, the last check, the rules (fine or tripped, how often) and the last sweep. "Check now" carries a wrench
// in the button's own colour. Each new or returning incident gives the person one quiet line; nothing of it is in the
// person's attention colours. The page's parts are cut out of board.js and run on their own. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { demoSupervisor } from '../../fixtures/demo.mjs'
import { SUPERVISOR_RULES } from '../../src/supervisor/index.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')

const MIN = 60_000
const at = (h, m) => new Date(2026, 9, 24, h, m).getTime()
const NOW = at(10, 42)

const page = { clock: ms => new Date(ms).toTimeString().slice(0, 5) }
vm.runInNewContext(`${script.slice(script.indexOf('// supervisor:start'), script.indexOf('// supervisor:end'))}
this.supervisorOf = supervisorOf; this.isSupervisorShown = isSupervisorShown; this.supervisorLines = supervisorLines`, page)
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
  lastSweep: null,
}

test('the section: when it checked itself, the incidents and their states, the last check, the rules that tripped, and "No sweep yet"', () => {
  const shown = plain(page.supervisorOf(VIEW))
  assert.equal(shown.title, 'Supervisor · checked itself at 10:40')
  assert.deepEqual(shown.incidents.map(one => [one.id, one.state, one.tone, one.text, one.seen]), [
    ['X3', 'open', 'open', 'Worker 2 unknown for 15 min, B482 waits', 'seen 5 times, since 10:27, last 10:40'],
    ['X2', 'fix B490', 'fix', 'All 4 workers idle for 12 min', 'seen once, since 09:10'],
    ['X1', 'fixed', 'fixed', 'Painter: its clear was skipped twice in a row', 'seen 2 times, since 07:12, last 07:42'],
  ])
  assert.deepEqual([shown.check.head, shown.check.rows.map(row => [row.status, row.tone, row.text])], ['Last check at 10:40, asked about Worker 2', [
    ['Fixed', 'done', 'B21 waited on B20, which is in review: unblocked'], ['Fine', 'fine', '8 other checks: nothing stuck'],
  ]])
  // The rules that tripped now or today, or failed, first, with how often; the others counted, shown on a click.
  assert.equal(shown.rules.head, 'Rules · 5 · 2 tripped · 1 failed')
  assert.deepEqual(shown.rules.shown.map(one => [one.id, one.tone, one.often, one.why]), [
    ['blocked', 'tripped', '2× today', null], ['limit-back', 'fine', '1× today', null], ['old-name', 'failed', 'fine today', 'rule old-name failed: a torn list'], ['unknown-lane', 'tripped', '5× today', null],
  ])
  assert.deepEqual(shown.rules.rest.map(one => [one.id, one.tone, one.often]), [['old-mod', 'fine', 'fine today']])
  assert.equal(shown.sweep, 'No sweep yet.')
  // Before its first run, and on a board without a supervisor.
  const fresh = plain(page.supervisorOf({ run: null, checkedAt: null, rules: [rule('blocked', 'repair', 'x', null)], incidents: [], lastSweep: null }))
  assert.deepEqual([fresh.title, fresh.check, fresh.incidents, fresh.rules.rest[0].often], ['Supervisor · not checked yet', null, [], 'not checked yet'])
  assert.equal(page.supervisorOf(null), null)
})

test('the section shows when something is new: a check, or an incident that opened or changed; closed, it shows again only for something newer', () => {
  const ui = (more = {}) => ({ isOpen: false, closedAt: null, showsRules: false, ...more })
  assert.equal(page.isSupervisorShown(VIEW, ui()), true)
  assert.equal(page.isSupervisorShown(VIEW, ui({ closedAt: at(10, 41) })), false, 'closed after the newest')
  assert.equal(page.isSupervisorShown({ ...VIEW, run: { ...VIEW.run, at: at(10, 45) } }, ui({ closedAt: at(10, 41) })), true, 'a newer check')
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
  // The server runs the supervisor at once, about that worker (null for the whole board).
  assert.match(server, /const subject = typeof body\?\.chat === 'string' && body\.chat !== 'board' \? body\.chat\.slice\(0, 80\) : null/)
  assert.match(server, /await supervisor\.run\(\{ asked: true, subject \}\)/)
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

test('the demo shows the section: every rule of the supervisor, three tripped today, its incidents and a check asked a moment ago', () => {
  const view = demoSupervisor(NOW, SUPERVISOR_RULES)
  assert.equal(view.rules.length, SUPERVISOR_RULES.length)
  assert.deepEqual(view.rules.filter(one => one.state === 'tripped').map(one => one.id).sort(), ['blocked', 'limit-back', 'unknown-lane'])
  assert.deepEqual(view.incidents.map(one => [one.id, one.state]), [['X3', 'open'], ['X2', 'fix'], ['X1', 'fixed']])
  assert.equal(view.checkedAt, NOW - 2 * MIN)
  assert.equal(page.isSupervisorShown(view, { isOpen: false, closedAt: null }), true)
  assert.match(server, /supervisor: supervisor !== null \? supervisor\.view\(clock\(\)\) : isDemo \? demoSupervisor\(clock\(\), SUPERVISOR_RULES\) : null,/)
})
