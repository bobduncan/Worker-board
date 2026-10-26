// B695: measures the Focus page's part cards beside option B of the agreed design (its mockup.html) and prints the two side
// by side: each distance within 2 px and each text size, weight and line height equal, or it says so and exits 1.
//
//   node tools/step-probe.mjs --board http://127.0.0.1:4320 --mockup path/to/mockup.html [--out-dir <picture folder>]
//
// Both pages are laid out at 1280x720 in a headless Edge or Chrome with a temporary profile, closed in the same run
// (tools/evidence.mjs shootPage). On the board the probe takes the first part card that shows a stopped and a waiting
// step with its list open; in the mockup, the second card of option B. It measures the same boxes in both: the head to
// the bar, the bar to the line of counts, the counts to the toggle, the toggle to the opened steps, the block heights, the dot
// sizes, the dot to the id and the row's padding, and the font size, weight and line height of the part title, count line, toggle, step title and step line. It knows nothing of the project's work.

import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { shootPage } from './evidence.mjs'

const TOLERANCE = 2
const TEXT_TOLERANCE = 0.5 // a text size, weight or line height must be equal
const isText = name => /font size|weight|line height/.test(name)

// Runs in the page: `sel` names the boxes of this page; answers the distances and the sizes in px.
const MEASURE = sel => `(async () => {
  const sel = ${JSON.stringify(sel)}
  const sleep = ms => new Promise(done => setTimeout(done, ms))
  let card = null
  for (let i = 0; i < 60 && card === null; i++) {
    card = [...document.querySelectorAll(sel.cards)].find(one => one.querySelector(sel.stopBlock) && one.querySelector(sel.waitBlock) && one.querySelector(sel.row)) ?? null
    if (card === null) await sleep(250)
  }
  if (card === null) return { width: 1280, height: 720, error: 'no card with a stopped and a waiting step, opened' }
  card.scrollIntoView({ block: 'center' })
  await sleep(200)
  const box = (parent, selector) => { const el = parent.querySelector(selector); return el === null ? null : el.getBoundingClientRect() }
  const head = box(card, sel.head), bar = box(card, sel.bar), count = box(card, sel.count), toggle = box(card, sel.toggle), list = box(card, sel.list)
  const done = box(card, sel.doneBlock), stop = box(card, sel.stopBlock), wait = box(card, sel.waitBlock)
  const row = card.querySelector(sel.row)
  const stopRow = card.querySelector(sel.stopBlock) && [...card.querySelectorAll(sel.row)].find(one => one.querySelector(sel.stopDot))
  const waitRow = [...card.querySelectorAll(sel.row)].find(one => one.querySelector(sel.waitDot))
  const stopDot = stopRow.querySelector(sel.stopDot).getBoundingClientRect()
  const waitDot = waitRow.querySelector(sel.waitDot).getBoundingClientRect()
  const id = stopRow.querySelector(sel.id).getBoundingClientRect()
  const what = stopRow.querySelector(sel.what).getBoundingClientRect()
  const r = n => Math.round(n * 10) / 10
  const text = (parent, selector, name) => {
    const el = parent.querySelector(selector)
    if (el === null) return {}
    const style = getComputedStyle(el), size = parseFloat(style.fontSize), line = parseFloat(style.lineHeight)
    return { [name + ' font size']: r(size), [name + ' weight']: Number(style.fontWeight), [name + ' line height']: r(Number.isNaN(line) ? size * 1.2 : line) }
  }
  return {
    width: 1280, height: 720,
    measures: {
      'head to bar': r(bar.top - head.bottom), 'bar to count': r(count.top - bar.bottom), 'count to toggle': r(toggle.top - count.bottom),
      'toggle to steps': r(list.top - toggle.bottom),
      'done block height': done === null ? null : r(done.height), 'stopped block height': r(stop.height), 'waiting block height': r(wait.height),
      'stop dot width': r(stopDot.width), 'stop dot height': r(stopDot.height), 'wait dot width': r(waitDot.width), 'wait dot height': r(waitDot.height),
      'dot to id': r(id.left - stopDot.right), 'row padding top': r(what.top - stopRow.getBoundingClientRect().top),
      'row padding bottom': r(stopRow.getBoundingClientRect().bottom - what.bottom),
      ...text(card, sel.title, 'part title'), ...text(card, sel.count, 'count line'), ...text(card, sel.toggle, 'toggle'),
      ...text(stopRow, sel.what, 'step title'), ...text(stopRow, sel.whatLine, 'step line'),
    },
  }
})()`

const BOARD_BOXES = { cards: '.focus-part', head: '.focus-part-top', bar: '.focus-bar', count: '.focus-count', toggle: '.focus-toggle', row: '.focus-step', doneBlock: '.focus-block.is-done', stopBlock: '.focus-block.is-stop', waitBlock: '.focus-block.is-wait', stopDot: '.focus-step-dot', waitDot: '.focus-step-dot', id: '.focus-step-id', what: '.focus-step-what', title: '.focus-part-top b', whatLine: '.focus-step-what small', list: '.focus-step-list' }
const MOCKUP_BOXES = { cards: '.option:nth-of-type(2) .card', head: '.head', bar: '.bar', count: '.count', toggle: '.toggle', row: '.steps li', doneBlock: '.seg.done', stopBlock: '.seg.stop', waitBlock: '.seg.wait', stopDot: '.dot.stop', waitDot: '.dot.wait', id: '.id', what: '.what', title: '.title', whatLine: '.what small', list: '.steps' }

/** The two pages measured: `{ mockup, board }`, each a map of name → px; pictures land in `outDir`. */
export async function probe({ board, mockup, outDir }) {
  await mkdir(outDir, { recursive: true })
  const run = async (url, boxes, name) => {
    // The board's step dots share one class: tell the stopped and the waiting row apart by their row.
    const boxed = name === 'board' ? { ...boxes, stopDot: '.focus-step.is-stop .focus-step-dot', waitDot: '.focus-step.is-wait .focus-step-dot' } : boxes
    const done = await shootPage({ url, layoutScript: MEASURE(boxed), viewport: { width: 1280, height: 720 }, out: join(outDir, `${name}.png`) })
    if (done.layout.error !== undefined) throw new Error(`${name}: ${done.layout.error}`)
    return done.layout.measures
  }
  const mockupUrl = `${pathToFileURL(resolve(mockup)).href}`
  return { mockup: await run(mockupUrl, MOCKUP_BOXES, 'mockup'), board: await run(`${board.replace(/\/$/, '')}/#advice/focus`, BOARD_BOXES, 'board') }
}

/** The names whose two values differ by more than the tolerance (a value missing on one side counts). */
export function differences(mockup, board) {
  return Object.keys(mockup).filter(name => (mockup[name] === null) !== (board[name] === null) || (mockup[name] !== null && Math.abs(mockup[name] - board[name]) > (isText(name) ? TEXT_TOLERANCE : TOLERANCE)))
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => (word.startsWith('--') ? [...pairs, [word.slice(2), all[i + 1]]] : pairs), []))
  if (args.board === undefined || args.mockup === undefined) throw new Error('Use: node tools/step-probe.mjs --board <address> --mockup <mockup.html> [--out-dir <folder>]')
  const { mockup, board } = await probe({ board: args.board, mockup: args.mockup, outDir: resolve(args['out-dir'] ?? 'step-probe') })
  const off = differences(mockup, board)
  console.log(`${'measure'.padEnd(24)}${'option B'.padStart(10)}${'board'.padStart(10)}`)
  for (const name of Object.keys(mockup)) console.log(`${name.padEnd(24)}${String(mockup[name]).padStart(10)}${String(board[name]).padStart(10)}${off.includes(name) ? '   <- differs' : ''}`)
  if (off.length > 0) { console.log(`${off.length} measure(s) differ.`); process.exit(1) }
  console.log('All measures match option B (distances within 2 px, text equal).')
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exit(1) })
}
