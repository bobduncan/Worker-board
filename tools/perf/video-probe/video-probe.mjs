// S0 of the PC plan (.claude/plans/pc-lag-test-speed-plan.md, chat 1, 2026-11-25): does a video still play smoothly while
// heavy runs go? A server on this PC only (127.0.0.1) serves page.html and a 1080p60 clip; one Edge window, visible on the
// person's screen, with a fresh profile, plays the clip muted for the time asked and posts the frames it dropped and the gaps
// between the frames it showed. The window and the server then close. A visible window: chat 1 clears every video case with
// the person first.
//
//   node tools/perf/video-probe/video-probe.mjs --make-clip [--ffmpeg <path>]   (once: data/perf/clip.mp4, 30 s 1080p60)
//   node tools/perf/video-probe/video-probe.mjs [--seconds 180] [--label <case>] [--out <file.jsonl>]

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { dataFolder } from '../run-share.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PAGE = join(HERE, 'page.html')
/** A frame shown this much after the one before counts as a hitch (at 60 fps a frame is 16.7 ms; this is one and a half). */
export const GAP_MS = 25
export const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

export const clipPath = (data = dataFolder()) => join(data, 'perf', 'clip.mp4')

/** The numbers of a playback: `{ dropped, total, droppedPct, gapP99, gapMax, hitches }` (gaps in ms rounded to 0.1). */
export function frameStats({ dropped = 0, total = 0, gaps = [] } = {}) {
  const r = x => Math.round(x * 10) / 10
  const sorted = [...gaps].sort((a, b) => a - b)
  const at = q => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)])
  return {
    dropped, total,
    droppedPct: total > 0 ? r((100 * dropped) / total) : 0,
    gapP99: r(at(0.99)),
    gapMax: r(sorted.at(-1) ?? 0),
    hitches: gaps.filter(gap => gap > GAP_MS).length,
  }
}

/** The ffmpeg arguments that make the clip: 30 s of testsrc2 at 1920x1080 and 60 fps, H.264 as a browser plays it. */
export function clipArgs(out) {
  return ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-t', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-movflags', '+faststart', out]
}

/**
 * The server: GET / gives the page, GET /clip.mp4 the clip (with ranges), POST /result takes the page's numbers.
 * `{ url, result, close }`: `result` resolves to what the page posted.
 */
export async function serveProbe({ clip, page = PAGE } = {}) {
  let deliver
  const result = new Promise(resolveResult => (deliver = resolveResult))
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    if (req.method === 'GET' && (path === '/' || path === '/page.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(readFileSync(page))
      return
    }
    if (req.method === 'GET' && path === '/clip.mp4' && clip && existsSync(clip)) {
      const size = statSync(clip).size
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
      if (range) {
        const start = range[1] === '' ? 0 : Number(range[1])
        const end = range[2] === '' ? size - 1 : Math.min(size - 1, Number(range[2]))
        res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
        createReadStream(clip, { start, end }).pipe(res)
      } else {
        res.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': size })
        createReadStream(clip).pipe(res)
      }
      return
    }
    if (req.method === 'POST' && path === '/result') {
      let body = ''
      req.on('data', data => (body += data))
      req.on('end', () => {
        res.writeHead(204)
        res.end()
        try {
          deliver(JSON.parse(body))
        } catch {
          deliver(null)
        }
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise(ready => server.listen(0, '127.0.0.1', ready))
  return { url: `http://127.0.0.1:${server.address().port}/`, result, close: () => new Promise(done => server.close(() => done())) }
}

/** The Edge arguments for the probe's window: its own fresh profile, an app window, the clip allowed to play by itself. */
export function edgeArgs(url, profile, seconds) {
  return [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,760', `--app=${url}?seconds=${seconds}`]
}

/** One playback in a visible Edge window: `{ label, at, seconds, ...frameStats }`, or a line with `why` when none came. */
export async function videoProbe({ seconds = 180, label = 'video', clip = clipPath(), edge = EDGE } = {}) {
  if (!existsSync(clip)) throw new Error(`There is no clip at ${clip}: make it first with --make-clip.`)
  const at = new Date().toISOString()
  const served = await serveProbe({ clip })
  const profile = mkdtempSync(join(tmpdir(), 'video-probe-'))
  const browser = spawn(edge, edgeArgs(served.url, profile, seconds), { stdio: 'ignore', windowsHide: false })
  const late = new Promise(resolveLate => setTimeout(() => resolveLate(null), (seconds + 60) * 1000))
  const posted = await Promise.race([served.result, late])
  // The window's whole tree, then the server and the profile.
  if (browser.pid) spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true })
  await served.close()
  await new Promise(settle => setTimeout(settle, 1000))
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  if (posted === null) return { label, at, seconds, why: 'the page posted nothing in time' }
  return { label, at, seconds, playing: posted.playing === true, ...frameStats(posted) }
}

function argOf(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  if (argv.includes('--make-clip')) {
    const ffmpeg = argOf(argv, '--ffmpeg') ?? process.env.FFMPEG ?? 'ffmpeg'
    const out = clipPath()
    mkdirSync(dirname(out), { recursive: true })
    execFileSync(ffmpeg, clipArgs(out), { stdio: 'inherit', windowsHide: true })
    console.log(`The clip is at ${out}.`)
  } else {
    const result = await videoProbe({ seconds: Number(argOf(argv, '--seconds') ?? 180), label: argOf(argv, '--label') ?? 'video' })
    const line = JSON.stringify(result)
    const out = argOf(argv, '--out')
    if (out) {
      mkdirSync(dirname(out), { recursive: true })
      appendFileSync(out, `${line}\n`)
    }
    console.log(line)
  }
}
