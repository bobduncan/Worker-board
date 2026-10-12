// The worker board's server: one page, `GET /api/state`, `GET /api/picture`, `POST /api/say` and
// `POST /api/game`, on this machine only.
//
//   node server.mjs                       real data
//   node server.mjs --demo --port 4311    made-up data from fixtures/, to judge the page without the real files
//   node server.mjs --port 4311 --history-from ..\worker-board\data
//                                         a second board next to the running one: it shows that one's history
//                                         and records none of its own
//
// It never prints or logs what a chat said. What is sent from the page will be typed into a chat that can change
// files, and `/api/game` starts a branch's game, so both are refused unless they come from the board's own page
// (see `mayUse` and `maySend`).

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './src/config.mjs'
import { readHead } from './src/files.mjs'
import { cached, gitRunner, readFolders } from './src/folders.mjs'
import { checkGame, createGames, gameLauncher, pathKey } from './src/games.mjs'
import { parseHistory } from './src/history.mjs'
import { findPicture } from './src/pictures.mjs'
import { checkSay } from './src/say.mjs'
import { readSources } from './src/sources.mjs'
import { buildState } from './src/state.mjs'
import { fileStore, memoryStore, outboxNow, tick } from './src/store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Never 0.0.0.0: the board shows private chats and can type into one. */
const HOST = '127.0.0.1'
const BODY_BYTES = 16 * 1024
const FOLDERS_MS = 60_000
const STATE_MS = 2_000
const TICK_MS = 60_000
const HISTORY_BYTES = 8 * 1024 * 1024

const FILES = {
  '/board.css': ['board.css', 'text/css; charset=utf-8'],
  '/board.js': ['board.js', 'text/javascript; charset=utf-8'],
}

// The page may load its own script and style sheet, talk to its own server, and show pictures it fetched from
// that server. Nothing else, so words from a chat that end up on the page can never run as code or call out.
const PAGE_RULES = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "img-src 'self' blob:",
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
 * The server, not yet listening. Handed in, so the tests need no real files:
 *   `getState()`       the `/api/state` object
 *   `say(body)`        checks and keeps what the page sent: `{ ok: true, message }` or `{ ok: false, status, why }`
 *   `picture(path)`    a picture the board may show: `{ type, body }`, or null
 *   `game(body)`       starts or stops a branch's game: `{ ok: true, result }` or `{ ok: false, status, why }`
 */
export function createBoard({ token, getState, say, picture = async () => null, game = async () => ({ ok: false, status: 404, why: 'Not here.' }), publicDir = join(HERE, 'public') }) {
  async function handle(req, res) {
    const self = `${HOST}:${req.socket.localPort}`
    const { pathname, searchParams } = new URL(req.url, `http://${self}`)

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

    if (pathname === '/api/say' || pathname === '/api/game') {
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
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        return refuse(res, 400, 'Not JSON.')
      }
      if (pathname === '/api/game') {
        const started = await game(parsed)
        return started.ok ? json(res, started.result) : refuse(res, started.status, started.why)
      }
      const answer = await say(parsed)
      return answer.ok ? json(res, answer.message) : refuse(res, answer.status, answer.why)
    }

    req.resume()
    if (req.method !== 'GET') return refuse(res, 405, 'Only GET.')

    if (pathname === '/api/state') {
      if (!mayUse) return refuse(res, 403, 'Only the board\'s own page may read.')
      return json(res, await getState())
    }
    if (pathname === '/api/picture') {
      if (!mayUse) return refuse(res, 403, 'Only the board\'s own page may read.')
      const found = await picture(searchParams.get('path') ?? '')
      return found === null ? refuse(res, 404, 'No such picture.') : send(res, 200, found.type, found.body)
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

const argAfter = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

async function main(args) {
  const isDemo = args.includes('--demo')
  const config = await loadConfig(join(HERE, 'config.json'))
  // `--port 4311` lets a second board run next to the real one.
  const port = Number(argAfter(args, '--port'))
  if (Number.isInteger(port) && port >= 1024 && port <= 65535) config.port = port
  const historyFrom = argAfter(args, '--history-from')
  const clock = Date.now

  // The games started for a look at a branch. Each ends by itself; the board also ends them when it is closed.
  const games = createGames({
    launch: gameLauncher({
      runner: join(HERE, 'run-game.mjs'),
      cacheDir: join(HERE, 'data', 'game-cache'),
      idleSeconds: config.gameIdleSeconds,
      graceSeconds: config.gameOpenSeconds,
    }),
    now: clock,
  })
  let folders = async () => null

  let store
  let readRaw
  let readLines = raw => raw.historyLines ?? store.lines()
  if (isDemo) {
    const { demoSources } = await import('./fixtures/demo.mjs')
    store = memoryStore()
    readRaw = () => demoSources(clock())
  } else {
    folders = cached(() => readFolders(config.gameRepo, gitRunner()), FOLDERS_MS)
    readRaw = () => readSources(config, folders)
    if (historyFrom === undefined) {
      store = await fileStore(join(HERE, 'data'), clock())
    } else {
      // The history of the board that is running; this one records nothing and keeps what is sent in memory.
      store = memoryStore()
      const shared = cached(async () => parseHistory((await readHead(join(resolve(historyFrom), 'history.jsonl'), HISTORY_BYTES))?.text ?? ''), TICK_MS / 2)
      const lines = { now: [] }
      readLines = () => lines.now
      readRaw = async () => {
        lines.now = await shared()
        return readSources(config, folders)
      }
    }
  }

  const readState = cached(async () => {
    const raw = await readRaw()
    const project = raw.project ?? config.project
    const state = buildState(raw, {
      lines: readLines(raw),
      outbox: outboxNow(store.outbox(), clock(), config.messageKeepMinutes * 60_000),
      runs: games.list(),
      now: clock(),
      config: { ...config, project },
    })
    return { ...state, isDemo, project }
  }, STATE_MS)

  const server = createBoard({
    token: randomBytes(32).toString('hex'),
    getState: async () => {
      const { project, ...state } = await readState()
      return state
    },
    say: async body => {
      const checked = checkSay(body, await readState(), config.maxMessageChars)
      if (!checked.ok) return checked
      const message = { id: randomBytes(8).toString('hex'), at: clock(), ...checked.message, state: 'waiting' }
      await store.say(message)
      // What was sent shows at once.
      readState.reset()
      return { ok: true, message }
    },
    picture: async path => {
      const { project } = await readState()
      const found = await findPicture(project, config.pictureRoots, path)
      return found === null ? null : { type: found.type, body: await readFile(found.file) }
    },
    game: async body => {
      const checked = checkGame(body, await readState())
      if (!checked.ok) return checked
      if (isDemo) return { ok: false, status: 409, why: 'This is the demo: it starts no game.' }
      if (checked.action === 'stop') {
        games.stop(checked.path)
        readState.reset()
        return { ok: true, result: { url: null } }
      }
      try {
        // A folder keeps its port from one start to the next, so the game finds what it saved in the browser.
        const place = ((await folders()) ?? []).findIndex(folder => pathKey(folder.path) === pathKey(checked.path))
        const url = await games.start({ path: checked.path, port: config.gamePort + Math.max(0, place) })
        readState.reset()
        return { ok: true, result: { url } }
      } catch (error) {
        // The reason is the board's own, or the last line of the game's own tools: never words from a chat.
        return { ok: false, status: 502, why: error instanceof Error ? error.message : 'The game did not start.' }
      }
    },
  })

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0))
  process.on('exit', () => games.stopAll())

  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${config.port} is in use: the board may be running already.`
      : `The board could not start (${error.code ?? 'unknown error'}).`)
    process.exit(1)
  })
  server.listen(config.port, HOST, () => {
    console.log(`Worker board: http://${HOST}:${config.port}/${isDemo ? '  (demo data)' : historyFrom === undefined ? '' : '  (shows another board\'s history, records none)'}`)
  })

  if (!isDemo && historyFrom === undefined) {
    const look = () => readState().then(state => tick(store, state, clock())).catch(() => {})
    look()
    setInterval(look, TICK_MS)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
