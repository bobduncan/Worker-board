// B307: a calmer Overview with less text, in six cuts. The person, 2026-10-18 13:43: "I want to see if i can make this
// overview slightly easier and have less text/details. what would you recommend to cut?" They kept the refresh icon,
// the limits' reset times, "Estimates lately" and what is next in each queue, and asked for a handle to make the
// Information part smaller or bigger. Nothing is lost: what goes is a click or a hover away. Made-up samples only.

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
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('limits')}\n${cut('lanetime')}\n${cut('calmoverview')}
Object.assign(this, { clock, span, leftView, freeShort, nextInQueue, infoLine, shownCounts, infoHeightFit })`, page)

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 18, 13, 43)

// 1 Information

test('1: a note is one line: the step it is about, who sent it, and its words without the "Report from" in front', () => {
  const row = (text, more = {}) => page.infoLine({ id: 'N48', text, from: 'Features', to: 'main', about: 'B276', since: NOW, isRead: false, ...more })
  assert.deepEqual({ ...row('Report from Features: the Lava Slam has its own icon.') }, { about: 'B276', from: 'Features', words: 'the Lava Slam has its own icon.' })
  assert.equal(row('Note from Game - Units: back from the limit pause.').words, 'back from the limit pause.')
  assert.equal(row('Question from Board: may I merge?').words, 'may I merge?')
  // Words that do not start so stay whole; a note about no step has no step.
  assert.equal(row('B305 reported by Units: the shop works.').words, 'B305 reported by Units: the shop works.')
  assert.equal(row('x', { about: null }).about, null)
  assert.equal(row('x', { from: null }).from, null)
  // The rows the page draws carry who sent it and what it is about to that line.
  const store = {}
  vm.runInNewContext(`${cut('storeasks')}\nthis.informationRows = informationRows`, store)
  const [drawn] = store.informationRows([{ id: 'N48', from: 'Features', to: 'main', about: 'B276', text: 'Report from Features: done.', since: NOW, isRead: false }])
  assert.deepEqual({ ...page.infoLine(drawn) }, { about: 'B276', from: 'Features', words: 'done.' })
})

test('1: the Information part has its own box under a handle you drag, and the board keeps its height', () => {
  const side = html.slice(html.indexOf('id="side-needs"'), html.indexOf('id="side-main"'))
  assert.ok(side.indexOf('id="needs"') < side.indexOf('id="info-resizer"') && side.indexOf('id="info-resizer"') < side.indexOf('id="information"'))
  assert.match(side, /id="info-resizer" role="separator" aria-orientation="horizontal"[^>]*tabindex="0"/)
  assert.match(side, /title="Drag to make Information smaller or bigger; double-click for the usual height"/)
  // A height that fits: never under the least, never so high that the asks above lose their room.
  assert.equal(page.infoHeightFit(250, 800), 250)
  assert.equal(page.infoHeightFit(20, 800), 90)
  assert.equal(page.infoHeightFit(790, 800), 680)
  assert.equal(page.infoHeightFit(300, 150), 90)
  assert.ok(script.includes("localStorage.setItem('information-height'"))
  assert.match(style, /\.info-box \{[^}]*height: var\(--info-height/)
  assert.match(style, /\.info-resizer \{[^}]*cursor: row-resize/)
})

test('1: a note opens on click with all its words and its Read button; "Mark all read" reads every new one', () => {
  const part = script.slice(script.indexOf('function drawInformation'), script.indexOf('function drawGoalAskNeeds'))
  for (const words of ['data-info-open', "'aria-expanded'", 'openInfos.has(row.id)', 'read.dataset.read = row.id', "'Mark all read'", 'data-read-all']) assert.ok(part.includes(words), words)
  // The Information part is no longer drawn inside the list of asks.
  const needs = script.slice(script.indexOf('function drawNeeds'), script.indexOf('function redrawNeeds'))
  assert.ok(!needs.includes('drawInformation(state), drawInstructions(state)'))
  assert.ok(needs.includes('drawInformation(state)'))
  assert.match(style, /\.info-line \{[^}]*white-space: nowrap/)
  // Review of B307: a refusal of "Mark all read" goes once all is read; a note gone is no longer open.
  assert.ok(part.includes("if (unread.length === 0) problems.delete('read:all')"))
  assert.ok(part.includes('for (const id of openInfos) if (!(state.information ?? []).some(one => one.id === id)) openInfos.delete(id)'))
})

test('1: the chosen height outlives a window made narrow and wide again; only the main button drags', () => {
  const handle = script.slice(script.indexOf('function resizableInformation'), script.indexOf("resizableInformation($('info-resizer')"))
  assert.ok(handle.includes("window.addEventListener('resize', () => set(wanted, false))"))
  assert.ok(handle.includes("const flows = window.matchMedia('(max-width: 1250px)')"))
  assert.ok(handle.includes('if (event.button !== 0) return'))
  assert.ok(handle.includes("handle.setAttribute('aria-valuemin', '90')"))
})

// 2 Worker rows

test('2: a free worker says since when it is free, in one line; the rest of what it said is in its tooltip', () => {
  const clockOf = at => page.clock(at)
  const at = NOW - 42 * MIN
  assert.equal(page.freeShort({ state: 'free', idle: { since: at, from: 'app', isSilent: false } }, clockOf), `free since ${page.clock(at)}`)
  assert.equal(page.freeShort({ state: 'free', idle: null }, clockOf), null)
  assert.equal(page.freeShort({ state: 'free', idle: { since: at } }), null)
  assert.equal(page.freeShort({ state: 'working', idle: { since: at } }, clockOf), null)
  const lane = script.slice(script.indexOf('function drawLane('), script.indexOf("$('lanes').addEventListener('click'"))
  assert.ok(!lane.includes("'No active task'"), 'no "No active task" on a free row')
  assert.ok(lane.includes('freeShort(lane, clock)'))
  // "Now:" and "Between turns" go into the task's tooltip and the unfolded details, not on the row.
  assert.ok(!lane.includes('what.append(...betweenTurns(lane))'))
  assert.ok(!/el\('b', '', 'Now: '\)/.test(lane))
})

test('2: the compaction note shows only when something is wrong; else it is the name\'s tooltip', () => {
  const lane = script.slice(script.indexOf('function drawLane('), script.indexOf("$('lanes').addEventListener('click'"))
  assert.ok(lane.includes('if (compacted !== null && compacted.isWarning)'))
  // The mod's own words, with the time, as B248 gave them.
  assert.ok(lane.includes('names.title = compacted.title'))
  // Unfolded, the details still say it all.
  const more = script.slice(script.indexOf('function drawMore'), script.indexOf('function folderLine'))
  for (const words of ['freeLine(lane, clock)', 'compactionLine(lane.compaction ?? null, clock)', 'Now: ${lane.doingNow}', 'lane.between']) assert.ok(more.includes(words), words)
})

// 3 Time left

test('3: the time left once, in the column Left: "1 h 34", its end time and where it is from in the tooltip', () => {
  const working = { state: 'working', task: { startedAt: NOW - 30 * MIN, stepId: 'B32' }, eta: { leftMs: 94 * MIN, at: NOW + 94 * MIN, isOverdue: false, isOver: false, isOwn: true } }
  const left = page.leftView(working, NOW)
  assert.equal(left.main, '1 h 34')
  assert.equal(left.tone, 'time')
  assert.equal(left.label, '')
  assert.deepEqual([...left.small], [])
  assert.equal(left.title, `1 h 34 left, until ${page.clock(NOW + 94 * MIN)}`)
  // A time its step names says so in the tooltip.
  const fromStep = page.leftView({ ...working, eta: { ...working.eta, isOwn: false } }, NOW)
  assert.match(fromStep.title, /\nfrom B32: /)
  assert.equal(fromStep.from, null)
  // Over its time: one line too, the time it was in the tooltip.
  const over = page.leftView({ ...working, eta: { ...working.eta, leftMs: -12 * MIN, at: NOW - 12 * MIN, isOver: true } }, NOW)
  assert.deepEqual([over.main, over.title], ['12 min over', `was ${page.clock(NOW - 12 * MIN)}`])
  const overdue = page.leftView({ ...working, eta: { ...working.eta, leftMs: -40 * MIN, at: NOW - 40 * MIN, isOverdue: true } }, NOW)
  assert.deepEqual([overdue.main, overdue.tone, overdue.title], ['40 min over', 'bad', `Overdue: was ${page.clock(NOW - 40 * MIN)}`])
  // A free worker has nothing there; one held or cut off says so as before.
  assert.equal(page.leftView({ state: 'free', task: null, eta: null }, NOW), null)
  assert.equal(page.leftView({ state: 'interrupted', task: null, eta: null, cutOffAt: null }, NOW).label, 'Cut off')
})

test('3: the step line keeps its time for the list that opens on hover, not on the row', () => {
  const draw = script.slice(script.indexOf('function drawStepLine'), script.indexOf('function betweenTurns'))
  assert.ok(!draw.includes("now.append(el('span', 'step-count', line.count), el('span', 'step-name', line.name), el('span', `step-time"))
  assert.ok(draw.includes("item.append(el('small', '', 'now'), el('span', `step-time step-list-time is-${line.tone}`, line.time))"))
  assert.ok(draw.includes('now.title = line.label'))
  assert.deepEqual([...html.slice(html.indexOf('id="workers-columns"'), html.indexOf('id="lanes"')).matchAll(/<span>([^<]*)<\/span>/g)].map(found => found[1]),
    ['Worker', 'Task', 'Progress', 'Left', 'Next in queue', ''])
})

// 4 Next in queue

test('4: the next step in the queue by its id and title, and why it waits; nothing when nothing is queued', () => {
  assert.equal(page.nextInQueue([]), null)
  assert.equal(page.nextInQueue(undefined), null)
  const step = { id: 'B276', title: 'Give the Lava Golem its full art', text: 'Give the Lava Golem its full art', minutes: 180, after: 'B277', why: { reason: 'after', steps: ['B277'] } }
  const next = page.nextInQueue([step, { ...step, id: 'B278' }])
  assert.deepEqual([next.id, next.title, next.more], ['B276', 'Give the Lava Golem its full art', 1])
  assert.deepEqual({ ...next.why }, { tone: 'wait', text: 'waits for B277' })
  assert.equal(page.nextInQueue([{ ...step, why: null }]).why, null)
  const lane = script.slice(script.indexOf('function drawLane('), script.indexOf("$('lanes').addEventListener('click'"))
  assert.ok(!lane.includes("'Queue (0)'"))
  // Two lines at most, cut on the words' own box (a button ignores it); why it waits wraps with them.
  assert.match(style, /\.queue-next \.queue-text \{[^}]*-webkit-line-clamp: 2/)
  assert.match(style, /\.queue-next \.why \{[^}]*white-space: normal/)
})

// 5 Header

test('5: the commit line is in Run game\'s tooltip; a running game keeps its link', () => {
  const game = script.slice(script.indexOf('function drawMainGame'), script.indexOf('function gameParts'))
  assert.ok(game.includes('run.title = [run.title, facts.join'))
  assert.ok(game.includes('if (game.url !== null)'))
  assert.ok(!/el\('small', 'run-note', facts\.join/.test(game))
})

test('5: "waiting for you" is counted only when something waits; working and free always', () => {
  assert.deepEqual([...page.shownCounts({ working: 2, waiting: 0, free: 3, suspended: 0, interrupted: 0, unknown: 0 })], ['working', 'free'])
  assert.deepEqual([...page.shownCounts({ working: 0, waiting: 1, free: 0, suspended: 1, interrupted: 0, unknown: 2 })], ['working', 'waiting', 'free', 'suspended', 'unknown'])
  assert.ok(cut('calmoverview').length > 0)
  assert.ok(script.includes('fill($(\'counts\'), shownCounts(state.counts)'))
})

test('5: how old the limits\' figure is shows only when it is old; else it is in their tooltip', () => {
  const draw = script.slice(script.indexOf('function drawLimits'), script.indexOf('// A restart of the app'))
  assert.ok(draw.includes('shown.age.isOld ?'))
  assert.ok(draw.includes('box.title = `${LIMITS_TIP}\\n${shown.age.text}`'))
  // The refresh icon by the project's name and the reset times stay.
  assert.match(html, /<h1><span id="project-name">Worker board<\/span> <button class="icon-button" id="refresh-title"/)
})

// 6 Top bar

test('6: CPU for the chats, its processes and the board\'s version sit behind a ⚙ button; Prepare restart and the time stay', () => {
  const bar = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf('</nav>', html.indexOf('<nav class="tabs"')))
  const settings = bar.slice(bar.indexOf('<details class="settings" id="settings"'), bar.indexOf('</details>'))
  assert.ok(settings.includes('<summary class="icon-button settings-button"'))
  assert.ok(settings.includes('id="cpu"') && settings.includes('id="cpu-count"') && settings.includes('id="version"'))
  assert.ok(!settings.includes('id="prepare-restart"') && !settings.includes('id="updated"'))
  assert.ok(bar.indexOf('id="prepare-restart"') < bar.indexOf('id="settings"') && bar.indexOf('id="settings"') < bar.indexOf('id="updated"'))
  // It closes on a click elsewhere and on Escape; it hides when it has nothing to show.
  assert.ok(script.includes("$('settings').open = false"))
  assert.match(style, /\.settings-pop \{[^}]*position: absolute/)
})
