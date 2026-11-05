// The two pictures of the start-up check for the person (plan task 8): the loader ("Checking 7 chats…") and the result line
// (the account switch in one line, amber). The real board page is served by a small static server with the state the board
// would send (`state.check`), and drawn by a headless Edge or Chrome (tools/evidence.mjs `shootPage`). Not a test:
//   node test/startupCheckPicture.mjs [out-folder]
// The default folder is C:\Web\lava-tactics-project\art-inbox\board-startup-check (the lead's plan).
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { shootPage } from '../tools/evidence.mjs'
import { asSent, build, NOW } from './partnerState.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const OUT = process.argv[2] ?? 'C:\\Web\\lava-tactics-project\\art-inbox\\board-startup-check'
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.html': 'text/html' }

const base = asSent(build([]))
const check = (extra = {}) => ({ at: NOW - 5_000, trigger: 'start', running: false, total: 7, reachable: 7, line: 'All 7 chats reachable · checked 22:30', tone: 'quiet', fixed: [], elsewhere: [], restartNeeded: [], nowhere: [], tooSlow: false, ...extra })
const SHOTS = {
  loader: check({ running: true }),
  result: check({ reachable: 5, line: '5 of 7 chats reachable · checked 22:30 · Worker 1\'s and Worker 5\'s chats are in your other Claude account: run /reimport-chats, then restart the app', tone: 'attention', elsewhere: ['Worker 1', 'Worker 5'] }),
}

await mkdir(OUT, { recursive: true })
let current = SHOTS.loader
const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  if (pathname === '/api/state') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ...base, check: current, readAt: Date.now() })) }
  if (pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end('{}') }
  const name = pathname === '/' ? 'index.html' : pathname.slice(1)
  try {
    let body = await readFile(join(PUBLIC, name))
    if (name === 'index.html') body = Buffer.from(body.toString('utf8').replace('{{token}}', 'picture').replace('{{page}}', 'picture'))
    res.setHeader('Content-Type', TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream')
    res.end(body)
  } catch { res.statusCode = 404; res.end('no') }
}).listen(0, '127.0.0.1')
await new Promise(done => server.once('listening', done))
const { port } = server.address()
try {
  for (const [name, state] of Object.entries(SHOTS)) {
    current = state
    await shootPage({
      url: `http://127.0.0.1:${port}/`, viewport: { width: 1200, height: 700 }, out: join(OUT, `${name}.png`),
      // Wait for the page's own first read, then measure the header down to the check row.
      layoutScript: `new Promise(done => { const look = () => { document.getElementById('help')?.close?.(); const row = document.querySelector('#check-row'); if (row && !row.hidden && row.textContent.length > 0) done({ width: 1200, height: Math.ceil(row.getBoundingClientRect().bottom + 24) }); else setTimeout(look, 100) }; look() })`,
    })
    console.log(`wrote ${join(OUT, `${name}.png`)}`)
  }
} finally {
  server.close()
}
