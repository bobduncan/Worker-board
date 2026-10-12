// The worker board's server: one page, `GET /api/state` and `POST /api/say`, on this machine only.
//
//   node server.mjs          real data
//   node server.mjs --demo   made-up data from fixtures/, to judge the page without the real files
//
// It never prints or logs what a chat said. What is typed in the chat box will later be typed into a chat that can
// change files, so sending is refused unless it comes from the board's own page (see `mayUse` and `maySend`).

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './src/config.mjs'
import { cached, gitRunner, readFolders } from './src/folders.mjs'
import { readSources } from './src/sources.mjs'
import { buildState } from './src/state.mjs'
import { fileStore, memoryStore, tick } from './src/store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Never 0.0.0.0: the board shows private chats and can type into one. */
const HOST = '127.0.0.1'
const BODY_BYTES = 16 * 1024
const FOLDERS_MS = 60_000
const STATE_MS = 2_000
const TICK_MS = 60_000

const FILES = {
  '/board.css': ['board.css', 'text/css; charset=utf-8'],
  '/board.js': ['board.js', 'text/javascript; charset=utf-8'],
}

// The page may load its own script and style sheet and talk to its own server. Nothing else, so words from a chat
// that end up on the page can never run as code or call out.
const PAGE_RULES = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "img-src 'self' data:",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ')

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  })
  res.end(body)
}

const refuse = (res, status, why) => send(res, status, 'text/plain; charset=utf-8', `${why}\n`)
const json = (res, value) => send(res, 200, 'application/json; charset=utf-8', JSON.stringify(value))

function sameText(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

/** The body as text, or null when it is larger than the board accepts. */
function readBody(req) {
  return new Promise(done => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size <= BODY_BYTES) chunks.push(chunk)
      else if (size > 64 * BODY_BYTES) req.destroy()
    })
    req.on('end', () => done(size > BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('close', () => done(null))
  })
}

/**
 * The server, not yet listening. `getState()` answers the `/api/state` object and `say(text)` keeps a typed
 * message and answers its record; both are handed in so the tests need no real files.
 */
export function createBoard({ token, getState, say, maxMessageChars = 2000, publicDir = join(HERE, 'public') }) {
  async function handle(req, res) {
    const self = `${HOST}:${req.socket.localPort}`
    const { pathname } = new URL(req.url, `http://${self}`)

    // A page of another website can be made to reach this server under that website's name. The name the browser
    // asked for gives it away.
    if (req.headers.host !== self) {
      req.resume()
      if (req.method === 'GET' && pathname === '/' && req.headers.host === `localhost:${req.socket.localPort}`) {
        return send(res, 307, 'text/plain; charset=utf-8', '', { Location: `http://${self}/` })
      }
      return refuse(res, 403, `Open the board at http://${self}/`)
    }

    const mayUse = sameText(req.headers['x-board-token'] ?? '', token)

    if (pathname === '/api/say') {
      // Three things another website's page cannot do: know the token, carry this origin, and send JSON unasked.
      const maySend = mayUse && req.headers.origin === `http://${self}`
      const isJson = /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')
      if (req.method !== 'POST' || !maySend || !isJson) {
        req.resume()
        if (req.method !== 'POST') return refuse(res, 405, 'Only POST.')
        return maySend ? refuse(res, 415, 'Send JSON.') : refuse(res, 403, 'Only the board\'s own page may send.')
      }
      const body = await readBody(req)
      if (body === null) return refuse(res, 413, 'Too large.')
      let text
      try {
        text = JSON.parse(body)?.text
      } catch {
        return refuse(res, 400, 'Not JSON.')
      }
      if (typeof text !== 'string' || text.trim() === '') return refuse(res, 400, 'No text.')
      if (text.trim().length > maxMessageChars) return refuse(res, 413, `At most ${maxMessageChars} characters.`)
      return json(res, await say(text.trim()))
    }

    req.resume()
    if (req.method !== 'GET') return refuse(res, 405, 'Only GET.')

    if (pathname === '/api/state') {
      if (!mayUse) return refuse(res, 403, 'Only the board\'s own page may read.')
      return json(res, await getState())
    }
    if (pathname === '/' || pathname === '/index.html') {
      const page = await readFile(join(publicDir, 'index.html'), 'utf8')
      return send(res, 200, 'text/html; charset=utf-8', page.replaceAll('{{token}}', token), {
        'Content-Security-Policy': PAGE_RULES,
        'X-Frame-Options': 'DENY',
      })
    }
    const file = FILES[pathname]
    if (file === undefined) return refuse(res, 404, 'Not here.')
    return send(res, 200, file[1], await readFile(join(publicDir, file[0])))
  }

  return createServer((req, res) => {
    handle(req, res).catch(() => {
      // No details: the error may quote a chat.
      if (!res.headersSent) refuse(res, 500, 'The board could not answer.')
      else res.destroy()
    })
  })
}

async function main(args) {
  const isDemo = args.includes('--demo')
  const config = await loadConfig(join(HERE, 'config.json'))
  const clock = Date.now

  let store
  let readRaw
  if (isDemo) {
    const { demoSources } = await import('./fixtures/demo.mjs')
    store = memoryStore()
    readRaw = () => demoSources(clock())
  } else {
    store = await fileStore(join(HERE, 'data'), clock())
    const folders = cached(() => readFolders(config.gameRepo, gitRunner()), FOLDERS_MS)
    readRaw = () => readSources(config, folders)
  }

  const readState = cached(async () => {
    const raw = await readRaw()
    const state = buildState(raw, {
      lines: raw.historyLines ?? store.lines(),
      now: clock(),
      config: { ...config, project: raw.project ?? config.project },
    })
    return { ...state, isDemo }
  }, STATE_MS)

  const server = createBoard({
    token: randomBytes(32).toString('hex'),
    maxMessageChars: config.maxMessageChars,
    // What was typed shows at once, so the outbox is not part of the cached state.
    getState: async () => ({ ...await readState(), outbox: store.outbox().filter(message => message.state === 'waiting') }),
    say: async text => {
      const message = { id: randomBytes(8).toString('hex'), at: clock(), text, state: 'waiting' }
      await store.say(message)
      return message
    },
  })

  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${config.port} is in use: the board may be running already.`
      : `The board could not start (${error.code ?? 'unknown error'}).`)
    process.exit(1)
  })
  server.listen(config.port, HOST, () => {
    console.log(`Worker board: http://${HOST}:${config.port}/${isDemo ? '  (demo data)' : ''}`)
  })

  if (!isDemo) {
    const look = () => readState().then(state => tick(store, state, clock())).catch(() => {})
    look()
    setInterval(look, TICK_MS)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
