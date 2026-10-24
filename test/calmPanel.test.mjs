// Calm panel (2026-10-19): Needs your attention without what is no question for the person. The person, about the
// "Open instructions" part and the "Information" list: "can we hide these two away somewhere? i rather not see this
// information by default. Also the 'from the backlog' can be removed." Both lists now wait in the Log, a fold at the
// bottom of the panel behind one quiet line; an instruction a chat missed still shows in Needs, as one line. The page's
// own code, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('closed')}\n${cut('calmpanel')}
Object.assign(this, { clock, shownNeeds, logCounts, logLineText, missedLines, panelNeeds })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const note = (id, isRead = false) => ({ id, from: 'Units', to: 'main', text: `Report from Units: ${id} done.`, about: 'B12', since: 1, isRead })
const instruction = (id, more = {}) => ({ id, chat: 'Main', text: `Words ${id}`, since: Date.UTC(2026, 9, 19, 12, 2), via: 'chat', turns: 0, isMissed: false, closedAs: null, ...more })

test('the log line counts the unread notes and the open instructions, "nothing new" when both are 0', () => {
  const notes = [note('N1'), note('N2'), note('N3', true)]
  const instructions = [instruction('I1'), instruction('I2', { turns: 2, isMissed: true }), instruction('I3', { closedAs: 'made step B300' })]
  assert.deepEqual(plain(page.logCounts(notes, instructions)), { reports: 2, instructions: 2 })
  assert.equal(page.logLineText(page.logCounts(notes, instructions)), 'Log: 2 reports · 2 instructions')
  // One of each in the singular; a part with none is left out.
  assert.equal(page.logLineText(page.logCounts([note('N1')], [])), 'Log: 1 report')
  assert.equal(page.logLineText(page.logCounts([], [instruction('I1')])), 'Log: 1 instruction')
  assert.equal(page.logLineText(page.logCounts([note('N1', true)], [instruction('I3', { closedAs: 'done' })])), 'Log: nothing new')
  assert.equal(page.logLineText(page.logCounts(undefined, undefined)), 'Log: nothing new')
})

test('an instruction a chat missed is one line in Needs your attention: who missed the words of when, open the log', () => {
  const lines = plain(page.missedLines([
    instruction('I1'), instruction('I2', { turns: 2, isMissed: true }), instruction('I3', { chat: 'Units', turns: 1, isMissed: true, since: null }),
    instruction('I4', { closedAs: 'done', isMissed: false, turns: 3 }),
  ], page.clock))
  assert.deepEqual(lines, [
    { id: 'I2', text: `Main missed your words of ${page.clock(Date.UTC(2026, 9, 19, 12, 2))}: open the log` },
    { id: 'I3', text: 'Units missed your words: open the log' },
  ])
  assert.deepEqual(plain(page.missedLines(undefined, page.clock)), [])
})

test('"From the backlog" goes: its open asks are cards among the others, its closed ones only with "Show closed"', () => {
  const ask = { id: 'work:Q7', answer: null, isClosed: false }
  const open = { id: 'backlog:B40', step: 'B40', activity: 'Units', answer: null, isClosed: false }
  const ticked = { id: 'backlog:B03', step: 'B03', activity: 'Units', answer: null, isClosed: true }
  const needs = page.panelNeeds({ forYou: [ask], backlogForYou: [open], backlogClosed: [ticked] })
  assert.deepEqual(plain(needs.map(need => need.id)), ['work:Q7', 'backlog:B40', 'backlog:B03'])
  assert.deepEqual(plain(page.shownNeeds(needs, false).map(need => need.id)), ['work:Q7', 'backlog:B40'])
  assert.deepEqual(plain(page.shownNeeds(needs, true).map(need => need.id)), ['work:Q7', 'backlog:B40', 'backlog:B03'])
  // A board without them (an older server) draws its own asks.
  assert.deepEqual(plain(page.panelNeeds({ forYou: [ask] }).map(need => need.id)), ['work:Q7'])
  // Nothing of the fold is left: no part, no flag, no look.
  assert.ok(!script.includes('From the backlog ('))
  assert.ok(!script.includes('drawLegacy'))
  assert.ok(!script.includes('isLegacyOpen'))
  assert.doesNotMatch(style, /\.legacy\b/)
})

test('Needs your attention draws the cards and the missed lines, and the log no longer stands in it', () => {
  const needs = script.slice(script.indexOf('function drawNeeds(state)'), script.indexOf('/** Who runs and who was asked'))
  assert.match(needs, /const needs = panelNeeds\(\{ \.\.\.state, forYou \}\)\n  const open = needs\.filter/)
  assert.match(needs, /shownNeeds\(needs, showsClosed\(\)\)/)
  assert.ok(!needs.includes('drawInstructions(state)'))
  assert.ok(!needs.includes('drawLegacy(state)'))
  // B466: the partner's lines come after what needs the person.
  assert.match(needs, /drawPartnerNeeds\([^\n]*\), drawMissed\(missed\), drawSupervisorLine\(supervised\), drawGoalAskNeeds\(state\)/)
  // The count: what waits for the person, the missed lines among it; never the log's notes or instructions.
  const count = needs.slice(needs.indexOf('const unanswered ='), needs.indexOf("$('needs-count')"))
  assert.match(count, /\+ missed\.length/)
  assert.doesNotMatch(count, /information|logCounts|instructions/)
  // "1 answered, hidden" counts the answers of this board, not the backlog's old ticked asks.
  assert.match(needs, /const answered = forYou\.filter\(need => isClosed\(need\) && !isRefineQuestion\(need\)\)\.length/)
})

test('the log: one quiet line at the very bottom of the panel, the two lists folded under it, open or closed as kept', () => {
  const side = html.slice(html.indexOf('id="side-needs"'), html.indexOf('id="side-main"'))
  // The asks, the handle, the line, then the log's box: the line is last but the box, which shows only when open.
  assert.ok(side.indexOf('id="needs"') < side.indexOf('id="info-resizer"'))
  assert.ok(side.indexOf('id="info-resizer"') < side.indexOf('id="log-line"') && side.indexOf('id="log-line"') < side.indexOf('id="information"'))
  assert.match(side, /<button class="log-line" id="log-line" type="button" aria-expanded="false" aria-controls="information"/)
  // The box holds Open instructions and Information as they were, and draws nothing while folded.
  const log = script.slice(script.indexOf('function drawInformation'), script.indexOf('function drawGoalAskNeeds'))
  assert.match(log, /logLineText\(logCounts\(state\.information, state\.instructions\)\)/)
  assert.match(log, /box\.hidden = !isLogOpen/)
  assert.match(log, /fill\(box, \[drawInstructions\(state\), information, empty\]\)/)
  // Kept in this browser, in try/catch like the board's other kept choices.
  assert.match(script, /try \{\s+isLogOpen = localStorage\.getItem\('log-open'\) === 'yes'\s+\} catch \{/)
  assert.match(script, /try \{\s+localStorage\.setItem\('log-open', isLogOpen \? 'yes' : 'no'\)\s+\} catch \{/)
  // The main chat's name in the log opens the talk; a missed line opens the log at its instruction (Details first).
  assert.match(script, /\$\('information'\)\.addEventListener\('click', event => \{[\s\S]*?closest\('\.instructions \[data-show-side\]'\)/)
  assert.match(script, /closest\('\[data-open-log\]'\)/)
  assert.match(script, /function openLog\(instruction = null\) \{/)
  // Quiet: muted, small, across the panel; a phone gets a line that is easy to tap. Simple leaves the log out.
  assert.match(style, /\.log-line \{[^}]*color: var\(--muted\)/)
  assert.match(style, /\.log-line \{[^}]*min-height: 40px/)
  assert.match(style, /\.log-missed-line \{[^}]*color: var\(--warn\)/)
  assert.match(style, /#view-overview\[data-mode="simple"\] #log-line,/)
})
