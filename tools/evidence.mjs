// B357: the evidence picture every check shows the person: the reference left, the result right at the same height,
// the step's id and title on top, the agreed points ticked green (pass), red (fail) or blue "for you" (ask, B369: a
// point only the person can judge) and the score beside its target
// below. Without a reference (work with nothing to see) it is the ticked list alone. It knows nothing of the project's
// work: the pictures, the points and the numbers come from the helper that checked it.
//
//   node tools/evidence.mjs --step B314 --title "Fight Bats" [--reference ref.png] [--result shot.png]
//                           --points points.json|'[{"text":"...","result":"pass|fail|ask"}]' [--score 63 --target 75]
//                           [--height 720] [--out picture.png]
//
// Both pictures are shown at one height: the result's own height, at most --height (play size, 720 unless given), so a
// result is never enlarged; the reference is scaled to it. Without --out the picture lands in the project's picture
// folder (the first of config.json's pictureRoots) under the step: <picture folder>/<step>/evidence.png, where the
// board shows it. It is drawn by a headless Edge or Chrome over the DevTools protocol, with a temporary profile, and
// that browser is closed in the same run, also when it fails (B266).
//
// B569 (I92: the picture "always shows 3 points pass"): a visible change is shown as the person sees it, Before | After,
// labelled, with no points (the recap card has one Checked line for them). The worker shoots <step>/before.png and
// after.png; the helper sets them side by side, landing at <picture folder>/<step>/before-after.png:
//
//   node tools/evidence.mjs --step B569 --title "Short cards" --before before.png --after after.png [--out picture.png]
//
// The ticked list alone (work with nothing to see) is no picture any more: such a check files its evidence as
// "none (nothing on screen)".

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const BOARD = join(dirname(fileURLToPath(import.meta.url)), '..')
const VALUED = ['reference', 'result', 'before', 'after', 'points', 'score', 'target', 'step', 'title', 'out', 'height']
const NUMBERS = ['score', 'target', 'height']
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

/** The command's arguments; it throws with the reason on a wrong one. */
export function parseArgs(argv) {
  const args = { height: 720 }
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '')
    if (!argv[i].startsWith('--') || !VALUED.includes(name)) throw new Error(`Unknown argument ${argv[i]}.`)
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`--${name} needs a value.`)
    if (NUMBERS.includes(name)) {
      const number = Number(value)
      if (!Number.isFinite(number) || number < 0) throw new Error(`--${name} is a number.`)
      args[name] = number
    } else args[name] = value
  }
  if (args.step === undefined) throw new Error('--step is needed: the step the picture is for.')
  // B569: Before | After, both or neither, and never beside a reference.
  const isBeforeAfter = args.before !== undefined || args.after !== undefined
  if (isBeforeAfter && (args.before === undefined || args.after === undefined)) throw new Error('--before and --after go together: what the person saw, and what they see now.')
  if (isBeforeAfter && (args.reference !== undefined || args.result !== undefined)) throw new Error('A Before | After picture has no --reference or --result.')
  if (!isBeforeAfter && args.reference === undefined && args.result === undefined) throw new Error('Nothing to see: with no picture, file the evidence as "none (nothing on screen)".')
  if (!isBeforeAfter && args.points === undefined) throw new Error('--points is needed: the agreed points, each passed or failed.')
  return { title: '', ...args }
}

const VERDICTS = ['pass', 'fail', 'ask']

/**
 * The points from JSON text or a file of it, each { text, verdict: 'pass'|'fail'|'ask' }. A point is given as
 * { text, result } or { text, verdict } (pass, fail or ask: B369, a point only the person can judge), { text, pass:
 * true|false }, or as a result check keeps it, the line "pass: <text>".
 */
export async function readPoints(value) {
  const text = value.trimStart().startsWith('[') ? value : await readFile(value, 'utf8')
  const list = JSON.parse(text)
  if (!Array.isArray(list)) throw new Error('The points are a list.')
  return list.map((point, i) => {
    if (typeof point === 'string') {
      const line = point.match(/^\s*(\w+):\s*(.+)$/)
      if (line === null || !VERDICTS.includes(line[1].toLowerCase())) throw new Error(`Point ${i + 1} is not marked pass, fail or ask.`)
      return { text: line[2].trim(), verdict: line[1].toLowerCase() }
    }
    if (typeof point?.text !== 'string' || point.text.trim() === '') throw new Error(`Point ${i + 1} has no text.`)
    const verdict = typeof point.pass === 'boolean' ? (point.pass ? 'pass' : 'fail') : String(point.verdict ?? point.result ?? '').toLowerCase()
    if (!VERDICTS.includes(verdict)) throw new Error(`Point ${i + 1} is not marked pass, fail or ask.`)
    return { text: point.text, verdict }
  })
}

/** Where the picture goes: --out, or <project>/<first picture folder>/<step>/evidence.png (before-after.png, B569). */
export function outPath(config, { step, out, before }) {
  if (out !== undefined) return out
  if (!/^[\w-]+$/.test(step)) throw new Error(`The step "${step}" is no plain id.`)
  return join(config.project, config.pictureRoots[0], step, before === undefined ? 'evidence.png' : 'before-after.png')
}

/** A PNG's width and height, from its header. */
export function pngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The page that is drawn; `reference` and `result` are picture addresses (data: URLs), either may be missing. B569:
 * `before` and `after` instead stand in their places, labelled Before and After, with no points below.
 */
export function evidenceHtml({ step, title, reference, result, before, after, points = [], score, target, height }) {
  const isBeforeAfter = before !== undefined && after !== undefined
  const figure = (id, caption, src) => (src === undefined ? '' : `<figure><figcaption>${caption}</figcaption><img id="${id}" alt="${caption}" src="${src}"></figure>`)
  if (isBeforeAfter) [reference, result] = [before, after]
  const [left, right] = isBeforeAfter ? ['Before', 'After'] : ['Reference', 'Result']
  const hasScore = score !== undefined
  const below = hasScore && target !== undefined && score < target
  const scoreLine = !hasScore ? '' : `<p class="score${below ? ' below' : ''}">Score ${escape(score)}${target === undefined ? '' : ` of target ${escape(target)}`}</p>`
  const count = verdict => points.filter(point => point.verdict === verdict).length
  // B369: with points for the person the line counts the three apart.
  const counted = count('ask') === 0 ? `${count('pass')} of ${points.length} agreed points pass`
    : `${count('pass')} pass · ${count('fail')} fail · ${count('ask')} for you, of ${points.length} agreed points`
  const MARKS = { pass: '✓', fail: '✗', ask: '?' }
  const ticks = points.map(point => `<li class="point ${point.verdict}"><span class="mark">${MARKS[point.verdict]}</span><span>${escape(point.text)}${point.verdict === 'ask' ? ' <span class="for-you">for you</span>' : ''}</span></li>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(step)} evidence</title><style>
  html, body { margin: 0; background: #12141a; color: #e8e8ee; font: 18px/1.45 "Segoe UI", system-ui, sans-serif; }
  #sheet { display: inline-block; padding: 24px 28px 28px; min-width: 760px; box-sizing: border-box; }
  h1 { margin: 0 0 16px; font-size: 26px; } h1 .id { color: #8fb4ff; margin-right: 10px; }
  #pictures { display: flex; gap: 24px; align-items: flex-start; margin-bottom: 20px; }
  figure { margin: 0; } figcaption { color: #a0a5b0; font-size: 16px; margin-bottom: 6px; }
  img { display: block; image-rendering: auto; }
  .score { margin: 0 0 10px; font-size: 22px; font-weight: 700; color: #4caf73; } .score.below { color: #e05a4f; }
  .count { color: #a0a5b0; margin: 0 0 6px; }
  ul { list-style: none; margin: 0; padding: 0; } .point { display: flex; gap: 10px; margin: 4px 0; max-width: 1400px; }
  .mark { font-weight: 700; width: 18px; flex: none; } .pass .mark { color: #4caf73; } .fail .mark { color: #e05a4f; } .fail { color: #ffb3ab; }
  .ask .mark { color: #6fa8ff; } .ask { color: #c9dcff; } .for-you { color: #6fa8ff; font-size: 14px; font-weight: 700; margin-left: 6px; text-transform: uppercase; letter-spacing: .04em; }
</style></head><body><div id="sheet" data-height="${Number(height)}">
<h1><span class="id">${escape(step)}</span>${escape(title)}</h1>
${reference === undefined && result === undefined ? '' : `<div id="pictures">${figure('reference', left, reference)}${figure('result', right, result)}</div>`}
${isBeforeAfter ? '' : `<div id="points">${scoreLine}<p class="count">${counted}</p><ul>${ticks}</ul></div>`}
</div></body></html>`
}

/** In the page: both pictures at one height (the result's own, at most the play height), then where everything stands. */
const LAYOUT = `(async () => {
  const sheet = document.getElementById('sheet')
  const reference = document.getElementById('reference'), result = document.getElementById('result')
  const pictures = [reference, result].filter(Boolean)
  await Promise.all(pictures.map(img => img.decode()))
  const most = Number(sheet.dataset.height)
  const lead = result ?? reference
  const height = lead ? Math.min(lead.naturalHeight, most) : 0
  for (const img of pictures) {
    img.style.height = height + 'px'
    img.style.width = Math.round(img.naturalWidth * height / img.naturalHeight) + 'px'
  }
  await document.fonts.ready
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } }
  const all = sheet.getBoundingClientRect()
  return { width: Math.ceil(all.width), height: Math.ceil(all.height), reference: box(reference), result: box(result), points: box(document.getElementById('points')), ticks: document.querySelectorAll('.point').length, asks: document.querySelectorAll('.point.ask').length }
})()`

/** A headless Edge or Chrome on this PC, or null; EVIDENCE_BROWSER names another. */
export function findBrowser(env = process.env, platform = process.platform, exists = existsSync) {
  if (env.EVIDENCE_BROWSER) return env.EVIDENCE_BROWSER
  const places = platform === 'win32'
    ? [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean).flatMap(root => [join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')])
    : platform === 'darwin'
      ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return places.find(place => exists(place)) ?? null
}

const sleep = ms => new Promise(done => setTimeout(done, ms))

async function dataUrl(file) {
  const type = TYPES[extname(file).toLowerCase()]
  if (type === undefined) throw new Error(`${file}: a picture is a .png, .jpg, .webp or .gif.`)
  return `data:${type};base64,${(await readFile(file)).toString('base64')}`
}

/** Ends what is left of the browser started with this profile: the first process's tree, then any by its profile. */
function closeLeft(child, profile) {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  }
  if (process.platform !== 'win32') return
  // Never this PowerShell itself, whose own command line holds the profile's path too.
  const query = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('user-data-dir=${profile.replace(/'/g, "''")}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], { stdio: 'ignore' })
}

/**
 * Draws `html` (a page of its own) into the picture `out` over a headless browser with a temporary profile, closed in the
 * same run also when it fails (B266). `layoutScript` runs in the page and answers { width, height }: the size of the
 * picture; `viewport` is the size the page is laid out in first. B677: the goal demo draws through it too.
 */
export async function shootPage({ browser = findBrowser(), html, layoutScript, viewport = { width: 1600, height: 900 }, out, timeoutMs = 60_000 }) {
  if (browser === null) throw new Error('No Edge or Chrome found; name one in EVIDENCE_BROWSER.')
  const work = await mkdtemp(join(tmpdir(), 'board-evidence-'))
  const profile = join(work, 'profile')
  const page = join(work, 'evidence.html')
  await writeFile(page, html)
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' })
  let socket
  const deadline = setTimeout(() => socket?.close(), timeoutMs)
  try {
    let port
    for (let i = 0; i < 80 && port === undefined; i++) {
      await sleep(250)
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim() } catch { /* not up yet */ }
    }
    if (port === undefined) throw new Error('The browser did not start.')
    let target
    for (let i = 0; i < 40 && target === undefined; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(one => one.type === 'page') } catch { /* not yet */ }
      if (target === undefined) await sleep(250)
    }
    if (target === undefined) throw new Error('The browser has no page.')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((open, fail) => { socket.addEventListener('open', open); socket.addEventListener('error', () => fail(new Error('No DevTools connection.'))) })
    let id = 0
    const waiting = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id) }
    })
    socket.addEventListener('close', () => { for (const [, answer] of waiting) answer({ error: { message: 'The browser went away or took too long.' } }); waiting.clear() })
    const send = (method, params = {}) => new Promise(answer => { const n = ++id; waiting.set(n, answer); socket.send(JSON.stringify({ id: n, method, params })) })
    const loaded = new Promise((done, fail) => {
      socket.addEventListener('message', event => { if (JSON.parse(event.data).method === 'Page.loadEventFired') done() })
      socket.addEventListener('close', () => fail(new Error('The browser went away or took too long.')))
    })
    loaded.catch(() => {})
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: pathToFileURL(page).href })
    await loaded
    const measured = await send('Runtime.evaluate', { expression: layoutScript, awaitPromise: true, returnByValue: true })
    const layout = measured.result?.exceptionDetails === undefined ? measured.result?.result?.value : undefined
    if (layout === undefined) throw new Error(`The page could not be laid out: ${measured.error?.message ?? measured.result?.exceptionDetails?.exception?.description ?? 'no answer'}`)
    await send('Emulation.setDeviceMetricsOverride', { width: layout.width, height: layout.height, deviceScaleFactor: 1, mobile: false })
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: layout.width, height: layout.height, scale: 1 }, captureBeyondViewport: true })
    if (shot.result?.data === undefined) throw new Error(`No picture: ${shot.error?.message ?? 'the browser sent none'}`)
    await mkdir(dirname(resolve(out)), { recursive: true })
    await writeFile(out, Buffer.from(shot.result.data, 'base64'))
    await send('Browser.close')
    return { out, layout }
  } finally {
    clearTimeout(deadline)
    socket?.close()
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await sleep(100)
    closeLeft(child, profile)
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

/** Draws the evidence picture into `out` and says where everything stands on it. */
export async function renderEvidence({ browser = findBrowser(), step, title = '', reference, result, before, after, points, score, target, height = 720, out, timeoutMs = 60_000 }) {
  if (browser === null) throw new Error('No Edge or Chrome found; name one in EVIDENCE_BROWSER.')
  if ([reference, result, before, after].every(file => file === undefined)) throw new Error('Nothing to see: with no picture, file the evidence as "none (nothing on screen)".')
  const address = async file => (file === undefined ? undefined : await dataUrl(file))
  const html = evidenceHtml({
    step, title, points, score, target, height,
    reference: await address(reference), result: await address(result), before: await address(before), after: await address(after),
  })
  return shootPage({ browser, html, layoutScript: LAYOUT, out, timeoutMs })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let out = args.out
  if (out === undefined) {
    const { loadConfig } = await import('../src/config.mjs')
    out = outPath(await loadConfig(join(BOARD, 'config.json')), args)
  }
  const done = await renderEvidence({ ...args, points: args.points === undefined ? [] : await readPoints(args.points), out })
  console.log(`saved ${done.out} (${done.layout.width}x${done.layout.height})`)
}

/** Whether this file is the command that was run: the same file, whatever path or letter case named it. */
function isCommand() {
  if (process.argv[1] === undefined) return false
  const same = path => { const real = realpathSync(resolve(path)); return process.platform === 'win32' ? real.toLowerCase() : real }
  try { return same(process.argv[1]) === same(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isCommand()) {
  main().catch(error => { console.error(error.message); process.exit(1) })
}
