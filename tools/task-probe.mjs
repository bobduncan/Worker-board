// B701: a picture of a step's window on a board, and what its Summary shows, to judge it beside the agreed mockup.
//
//   node tools/task-probe.mjs --board http://127.0.0.1:4320 --step B14 --out <picture file> [--tab summary]
//
// The window is opened by its address (`#details=<step>`) at 1280x720 in a headless Edge or Chrome with a temporary profile,
// closed in the same run (tools/evidence.mjs shootPage), and its whole body is laid out so one picture holds it all. It prints
// the parts the Summary shows, how many pictures loaded, and the lines of the Summary that hold what the person never wants
// there (a file name, code, a step or ask id), and exits 1 on one. It knows nothing of the project's work.

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { shootPage } from './evidence.mjs'

// Runs in the page: opens the step's window, shows the tab, and answers the layout and what it holds.
const MEASURE = tab => `(async () => {
  const sleep = ms => new Promise(done => setTimeout(done, ms))
  const box = document.getElementById('details')
  for (let i = 0; i < 80 && !(box.open && box.querySelector('.task-window')); i++) await sleep(250)
  if (!box.open || box.querySelector('.task-window') === null) return { width: 1280, height: 720, error: 'the step has no Summary window (not taken yet, or not on this board)' }
  const tab = ${JSON.stringify(tab)}
  if (tab !== 'summary') { box.querySelector('[data-task-tab="' + tab + '"]')?.click(); await sleep(400) }
  for (let i = 0; i < 40; i++) { if ([...box.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0)) break; await sleep(250) }
  // Everything in one picture: the dialog grows to hold its body.
  box.style.maxHeight = 'none'; box.style.height = 'auto'
  const body = box.querySelector('.details-body'); body.style.overflow = 'visible'; body.style.flex = 'none'
  await sleep(300)
  // A dialog fixed to the window grows with the window: the picture is as tall as its content.
  const text = box.querySelector('.task-body').innerText
  const parts = [...box.querySelectorAll('.task-body h3')].map(one => one.textContent.trim())
  const images = [...box.querySelectorAll('.task-body img')]
  const bad = text.split('\\n').filter(line => /\`|\\b[\\w-]+\\.(?:m?js|ts|css|html|md|json|png|jpe?g)\\b|[\\w.-]+[\\\\/][\\w.-]+[\\\\/]?|\\b[BQGX]\\d{1,4}\\b/.test(line))
  return { width: 1280, height: Math.ceil(Math.max(720, box.scrollHeight + 48)), parts, pictures: images.length, loaded: images.filter(image => image.naturalWidth > 0).length, tabs: [...box.querySelectorAll('.task-tab')].map(one => one.textContent), bad: tab === 'summary' ? bad : [] }
})()`

/** What the probe found, as the lines it prints. */
export function report(step, found) {
  const lines = [`${step}: ${found.parts.length > 0 ? found.parts.join(' · ') : 'no parts'}`, `pictures: ${found.loaded} of ${found.pictures} loaded`, `tabs: ${found.tabs.join(' · ')}`]
  for (const one of found.bad) lines.push(`not for the person: ${one}`)
  return lines
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, i, all) => (word.startsWith('--') ? [...pairs, [word.slice(2), all[i + 1]]] : pairs), []))
  if (args.board === undefined || args.step === undefined || args.out === undefined) throw new Error('Usage: node tools/task-probe.mjs --board <address> --step B<id> --out <picture file> [--tab summary|checks|history|settings]')
  const url = `${args.board.replace(/\/$/, '')}/#details=${encodeURIComponent(args.step)}`
  const done = await shootPage({ url, layoutScript: MEASURE(args.tab ?? 'summary'), viewport: { width: 1280, height: 720 }, out: resolve(args.out) })
  if (done.layout.error !== undefined) throw new Error(done.layout.error)
  console.log(report(args.step, done.layout).join('\n'))
  console.log(`picture: ${done.out}`)
  if (done.layout.bad.length > 0 || done.layout.loaded < done.layout.pictures) process.exit(1)
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exit(1) })
}
