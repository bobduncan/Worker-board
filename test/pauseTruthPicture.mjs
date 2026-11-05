// Pause truth (2026-11-05): the picture of the page during the real pause, before and after. NOT a test (no .test.mjs).
//
//   node test/pauseTruthPicture.mjs <public-dir> <out.png>
//
// It serves a public/ folder (the branch's, or main's extracted from git) from a tiny static server on 127.0.0.1 with a random
// port and answers /api/state with the real case's state (test/fixtures/pause-2026-11-05/state-4310-trimmed.json, the live
// board's /api/state of 2026-11-05 14:22 thinned). Nothing else is answered: no second board, no live data, no chat is typed
// to. The page's own code draws it, in a headless Edge with a temporary profile (tools/evidence.mjs `shootPage`).
// The fixture is read as it is; a note that the fixed board adds (`inReview`) is added to the state when `--fixed` is the third
// argument, as the fixed board's own state builder would send it (every step of the real notes was in review).

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { shootPage } from '../tools/evidence.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const [publicDir, out, mode] = process.argv.slice(2)
if (publicDir === undefined || out === undefined) throw new Error('node test/pauseTruthPicture.mjs <public-dir> <out.png> [--fixed]')
const root = resolve(publicDir)
const state = JSON.parse(await readFile(join(HERE, 'fixtures', 'pause-2026-11-05', 'state-4310-trimmed.json'), 'utf8'))
if (mode === '--fixed') state.pause = { ...state.pause, unsaved: state.pause.unsaved.map(one => ({ ...one, inReview: true })) }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml' }

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1')
  if (pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ...state, readAt: state.readAt }))
  }
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    return res.end('{}')
  }
  const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname))
  if (!file.startsWith(root)) { res.writeHead(403); return res.end() }
  try {
    let body = await readFile(file)
    if (pathname === '/') body = Buffer.from(body.toString('utf8').replaceAll('{{token}}', 'picture').replaceAll('{{page}}', 'picture'))
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const { port } = server.address()
try {
  // The page draws from its first answer; Main's details are opened (the "Last" line), and the pause's notes too.
  const layoutScript = `(async () => {
    await new Promise(done => setTimeout(done, 2500))
    document.querySelector('#overview-mode [data-overview-mode="details"]')?.click()
    await new Promise(done => setTimeout(done, 600))
    document.querySelector('.lane-menu[data-lane="Main"]')?.click()
    await new Promise(done => setTimeout(done, 600))
    // For the picture only: the chats that were free (and the advisor) are left out and the page drawn at three quarters, so the page fits one picture.
    for (const lane of document.querySelectorAll('#lanes .lane')) if (!['Main', 'Worker 1', 'Worker 2', 'Worker 5'].some(name => (lane.querySelector('.who')?.textContent ?? '').includes(name))) lane.style.display = 'none'
    document.querySelector('.workers-panel .advisor, #advisor-lane')?.remove?.()
    document.body.style.zoom = '0.75'
    await new Promise(done => setTimeout(done, 400))
    return { width: 1400, height: 1500 }
  })()`
  const done = await shootPage({ url: `http://127.0.0.1:${port}/`, layoutScript, viewport: { width: 1400, height: 1000 }, out: resolve(out) })
  console.log(`${out}: ${done.layout.width} x ${done.layout.height}`)
} finally {
  server.close()
}
