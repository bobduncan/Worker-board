// B327: the Overview opens on a simple view (the person's four answers of 2026-10-18, brainstorm "Board easier day to
// day"; picture art-inbox/board-highover/simple-view.png): one bar for the focus goal, how many workers are busy, the
// 5-hour limit with its reset, and Needs your attention; today's Overview stays one click away under Details. The
// page's model runs here without the page; made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const css = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const region = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${region('times')}\n${region('focus')}\n${region('simpleoverview')}\nObject.assign(this, { simpleView, overviewMode, clock })`, page)

const plain = value => JSON.parse(JSON.stringify(value))
const AT = new Date(2026, 9, 18, 17, 0).getTime()
const at = (h, m) => new Date(2026, 9, 18, h, m).getTime()
const FOCUS = { id: 'G12', title: 'The loop is fun', stage: 'run', progress: { done: 1, total: 6, minutesLeft: 14 * 60 } }

test('the bar: the focus goal, its steps done and the time left, as the Focus page counts them', () => {
  const view = page.simpleView({ focus: FOCUS, counts: {}, limits: null }, AT)
  // B343: with the goal's title
  assert.equal(view.bar.text, 'Focus G12 · The loop is fun · 1 of 6 steps done · about 14 h left')
  assert.equal(view.bar.percent, 17)
  assert.equal(view.bar.title, 'G12 · The loop is fun')
  // a goal done has no time left; a goal without steps is at 0
  assert.equal(page.simpleView({ focus: { ...FOCUS, stage: 'done', progress: { done: 6, total: 6, minutesLeft: 0 } } }, AT).bar.text, 'Focus G12 · The loop is fun · 6 of 6 steps done')
  assert.equal(page.simpleView({ focus: { ...FOCUS, progress: { done: 0, total: 0, minutesLeft: null } } }, AT).bar.percent, 0)
  // before the run the Focus page shows no progress: the bar says the stage, without a count
  assert.deepEqual(plain(page.simpleView({ focus: { ...FOCUS, stage: 'vibe', progress: { done: 0, total: 0, minutesLeft: null } } }, AT).bar), { text: 'Focus G12 · The loop is fun · agreeing the vibe', percent: null, title: 'G12 · The loop is fun' })
  assert.equal(page.simpleView({ focus: { ...FOCUS, stage: 'how' } }, AT).bar.text, 'Focus G12 · The loop is fun · agreeing the how')
  // no focus: no bar (B328 counts the next milestone then)
  assert.equal(page.simpleView({ focus: null }, AT).bar, null)
})

test('the workers: how many of how many are busy', () => {
  assert.deepEqual(plain(page.simpleView({ counts: { working: 4, free: 1 } }, AT).busy), { text: '4 of 5 workers busy', isBusy: true })
  assert.deepEqual(plain(page.simpleView({ counts: { working: 0, waiting: 1, free: 2, off: 1 } }, AT).busy), { text: '0 of 4 workers busy', isBusy: false })
})

test('the 5-hour limit: its use and when it resets; reached, when work goes on; unknown, nothing', () => {
  const five = (more) => ({ fiveHour: { used: 31.2, level: 'ok', resetsAt: at(18, 0), resetAt: null, at: AT, ...more }, week: null })
  assert.deepEqual(plain(page.simpleView({ limits: five({}) }, AT).limit), { text: `5-hour 31% · resets ${page.clock(at(18, 0))}`, tone: 'ok' })
  assert.deepEqual(plain(page.simpleView({ limits: five({ used: 100, level: 'full' }) }, AT).limit), { text: `5-hour limit reached · work goes on at ${page.clock(at(18, 0))}`, tone: 'full' })
  assert.deepEqual(plain(page.simpleView({ limits: five({ resetsAt: null }) }, AT).limit), { text: '5-hour 31%', tone: 'ok' })
  assert.deepEqual(plain(page.simpleView({ limits: five({ used: 0, resetsAt: null, resetAt: at(16, 0) }) }, AT).limit), { text: `5-hour 0% · reset at ${page.clock(at(16, 0))}`, tone: 'ok' })
  assert.equal(page.simpleView({ limits: null }, AT).limit, null)
})

test('the board opens on Simple, and keeps Details once chosen', () => {
  assert.equal(page.overviewMode(null), 'simple')
  assert.equal(page.overviewMode('nonsense'), 'simple')
  assert.equal(page.overviewMode('simple'), 'simple')
  assert.equal(page.overviewMode('details'), 'details')
})

test('the page has the switch, the bar, and styles that show only the simple parts in Simple', () => {
  assert.match(html, /id="overview-mode"/)
  assert.match(html, /data-overview-mode="simple"/)
  assert.match(html, /data-overview-mode="details"/)
  assert.match(html, /id="simple-bar"/)
  // in Simple: no Run game, limits bar, counts, workers, timeline, folders or Information; in Details, no simple bar
  for (const id of ['main-game', 'limits', 'counts', 'workers-panel', 'today', 'folders', 'information']) {
    assert.match(css, new RegExp(`#view-overview\\[data-mode="simple"\\][^{]*#${id}`), id)
  }
  assert.match(css, /#view-overview\[data-mode="details"\] #simple-bar/)
  assert.match(script, /localStorage[^\n]*overview-mode|overview-mode[^\n]*localStorage/)
  // the width does not follow the Needs list (B343: the full width, in a grid); a click holds without storage; the view
  // is set before the first read
  assert.match(css, /#view-overview\[data-mode="simple"\]:not\(\[hidden\]\) \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(script, /overviewChosen = overviewMode\(button\.dataset\.overviewMode\)/)
  assert.match(script, /\n\/\/ The chosen view from the start, before the board is first read\.\nshowOverviewMode\(\)/)
})
