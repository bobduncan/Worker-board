// A made-up worker board for test/landScript.test.mjs: it answers what tools/land.ps1 asks of a board and nothing else. It
// lives in the made-up checkout as `server.mjs` (the script finds a board's processes by that name), reports the commit its
// folder is on, and "restarts" on POST /api/restart without leaving its process: after 250 ms its `since` is new and its
// commit is the folder's head again. `--stale-once` makes the first restart come back with the OLD commit, as a board does
// whose restart did not take.
//   node server.mjs --port 4500 [--stale-once] [--no-keeper] [--repo <folder>]
//     (without --port: the number in data/port.txt, as start-board.mjs gives it; --no-keeper: a board started without its keeper
//     says version.canRestart false and refuses /api/restart; --repo: the folder whose commit it reports, this folder's by default)
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const at = process.argv.indexOf('--port')
const PORT = Number(at >= 0 ? process.argv[at + 1] : readFileSync(join(HERE, 'data', 'port.txt'), 'utf8'))
const repoAt = process.argv.indexOf('--repo')
const REPO = repoAt >= 0 ? process.argv[repoAt + 1] : HERE
const head = () => execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const NO_KEEPER = process.argv.includes('--no-keeper')
const TOKEN = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
const state = { commit: head(), since: Date.now() }
let stale = process.argv.includes('--stale-once') ? 1 : 0

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type })
    res.end(body)
  }
  req.resume()
  if (req.headers.host !== `127.0.0.1:${PORT}`) return send(403, 'text/plain', 'host')
  if (req.method === 'GET' && pathname === '/') {
    return send(200, 'text/html', `<!doctype html><html><head><meta name="board-token" content="${TOKEN}"><title>Worker board</title></head><body>a made-up board</body></html>`)
  }
  if (req.headers['x-board-token'] !== TOKEN) return send(403, 'text/plain', 'token')
  if (req.method === 'GET' && pathname === '/api/state') return send(200, 'application/json', JSON.stringify({ version: { commit: state.commit, since: state.since, canRestart: !NO_KEEPER } }))
  if (req.method === 'POST' && pathname === '/api/restart') {
    if (req.headers.origin !== `http://127.0.0.1:${PORT}`) return send(403, 'text/plain', 'origin')
    if (NO_KEEPER) return send(409, 'application/json', JSON.stringify({ why: 'This board was started without its keeper: start it once from where it was started.' }))
    try {
      appendFileSync(join(HERE, 'data', 'restarts.log'), String(Date.now()) + '\n')
    } catch {
      // A log that cannot be written is no reason not to restart.
    }
    send(200, 'application/json', JSON.stringify({ at: Date.now() }))
    setTimeout(() => {
      state.since = Date.now()
      if (stale > 0) stale -= 1
      else state.commit = head()
    }, 250)
    return undefined
  }
  return send(404, 'text/plain', 'no')
})

// A board that starts while the old one still holds the port tries again for a few seconds (src/keeper.mjs's holdPort).
let tries = 0
server.on('error', error => {
  if (error.code !== 'EADDRINUSE' || tries > 60) throw error
  tries += 1
  setTimeout(() => server.listen(PORT, '127.0.0.1'), 200)
})
server.listen(PORT, '127.0.0.1', () => {
  mkdirSync(join(HERE, 'data'), { recursive: true })
  writeFileSync(join(HERE, 'data', 'pid.txt'), String(process.pid))
  // Said on stdout as the real board does (a cold start appends it to data/board.log through cmd, which holds that file open
  // for itself: opening it here as well would fail with EBUSY); written to the file too when nothing holds it.
  const said = `a made-up board listens on ${PORT} at ${state.commit}`
  console.log(said)
  try {
    appendFileSync(join(HERE, 'data', 'board.log'), `${said}\n`)
  } catch {
    // Held by the redirect: the line is in the file already.
  }
})
