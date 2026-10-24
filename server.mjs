// The worker board's server: one page, `GET /api/state`, `GET /api/picture`, `POST /api/say`,
// `POST /api/game` and, for the Workers mod, `POST /api/bridge/take`; on this machine only. B297: the work store's API,
// `POST /api/work` for the page and `POST /api/bridge/work` for the Workers mod's work tool.
//
//   node server.mjs                       real data
//   node server.mjs --demo --port 4311    made-up data from fixtures/, to judge the page without the real files
//   node server.mjs --launch-entry        writes this folder's entry into <project>\.claude\launch.json and ends
//   node server.mjs --port 4311 --history-from ..\worker-board\data
//                                         a second board next to the running one: it shows that one's history
//                                         and records none of its own
//
// The port: the board in the repository's main folder has the one of config.json (4310). Started from another
// working folder, a copy takes a port of its own by itself, the same one every time, and says which
// (src/ports.mjs); `--port` still wins.
//
// The Design tab adds `POST /api/design` and `POST /api/design/reference`: an idea becomes a picture made by Codex
// (src/codex.mjs), only on the person's click on the board's own page.
//
// It never prints or logs what a chat said. What is sent from the page will be typed into a chat that can change
// files, and `/api/game` starts a branch's game, so both are refused unless they come from the board's own page
// (see `mayUse` and `maySend`).

import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'


import { minutesOf } from './src/backlog.mjs'
import { bridgeNote, checkTake, checkTyped, clearRefusal, isUnknownSession, messageText } from './src/bridge.mjs'
import { chatLogKeeper, isReadOut, leftSubjects } from './src/chatLogs.mjs'
import { findCodex, makePicture } from './src/codex.mjs'
import { checkSetting, panelSettings, settingChanged } from './src/boardSettings.mjs'
import { cpuLimiter, logicalCores, sessionsOfCards } from './src/cpu.mjs'
import { BrokenConfig, configProblem, firstStart, followApp, isOwnWork, loadConfig, ownMapNow, projectFile, workFolder } from './src/config.mjs'
import { REFERENCE_BYTES, ideasFolder, referencesFolder, checkDesign, designState, inTurn, parseDesignSettings, promptFor } from './src/design.mjs'
import { ideasFile, ideasOver, placeReferences } from './src/ideas.mjs'
import { START_ANEW, keep } from './src/keeper.mjs'
import { GAME_SPAN, boardsFile, launchEntry, registerHome, resolvePort, withEntry } from './src/ports.mjs'
import { marketsFile, modVersions, pluginsFile } from './src/setup.mjs'
import { makeProject } from './src/newProject.mjs'
import { readHead } from './src/files.mjs'
import { cached, gitRunner, readBranches, readFolders } from './src/folders.mjs'
import { checkGame, createGames, gameLauncher, pathKey } from './src/games.mjs'
import { parseHistory } from './src/history.mjs'
import { seenFromState } from './src/finished.mjs'
import { areaOf, freshScan, keptTasks, listText, readOn } from './src/taskTimes.mjs'
import { createSpendingCollector } from './src/work/routing/collector.mjs'
import { readRoutingRecord } from './src/work/routing/records.mjs'
import { parseRoutingPolicy } from './src/work/routing/policy.mjs'
import { adoptPicture, findPicture, pictureProblem, shownFolders, shownRoots } from './src/pictures.mjs'
import { answerWords, checkSay, checkStepWords, focusWords, spawnWhenAlone, wakeFor, wakesDue, withInstruction, workWords } from './src/say.mjs'
import { keepTalkPicture } from './src/talkPicture.mjs'
import { firstLook, refineWhenDue } from './src/refineGate.mjs'
import { recheckText, roundText, roundsNow } from './src/rounds.mjs'
import { editStep, settleByBoard } from './src/tick.mjs'
import { editThread, fixesToTell } from './src/brainstorm.mjs'
import { changeGoalsFile, editGoals } from './src/goalsWrite.mjs'
import { activityFor, missingToSteps } from './src/goalSteps.mjs'
import { FOCUS_DRAFTS, FOCUS_MOVES, evaluationsAgain, evaluationsRunning, focusMove, goalChecked, goalReopened, guardGoal, undoLine } from './src/focus.mjs'
import { effortBack, partnerEffortWords } from './src/partnerEffort.mjs'
import { GUARD_ATTEMPTS, evaluationState } from './src/goalGuard.mjs'
import { readSources } from './src/sources.mjs'
import { backgroundRunning, parseTail, readTail } from './src/transcript.mjs'
import { buildState } from './src/state.mjs'
import { isReadAction, workApi } from './src/work/api.mjs'
import { effortOf } from './src/work/effort.mjs'
import { isHolding, resumeEnds, resumeRetypeTo, resumeTypeTo } from './src/work/pause.mjs'
import { reportCheck } from './src/work/check.mjs'
import { deliverWork, pullFor, sendOnce } from './src/work/deliver.mjs'
import { REFUSED_MS, SUPERVISOR_RULES, createSupervisor, loopGate, loopOwner } from './src/supervisor/index.mjs'
import { FILES as WORKTREE_FILES, cleanLeftover, findLeftovers, stepLeftovers } from './src/work/worktrees.mjs'
import { followRenames } from './src/work/rename.mjs'
import { standardHold } from './src/work/standardHold.mjs'
import { itemsOf, storeKeeper } from './src/work/read.mjs'
import { requestKeeper } from './src/work/requests.mjs'
import { readStore } from './src/work/store.mjs'
import { sweepOutbox } from './src/work/outboxSweep.mjs'
import { dismissCopied, fileStore, isLate, memoryStore, outboxNow, tick } from './src/store.mjs'
import { loads, readVersion } from './src/version.mjs'
import { blockersOf, reportedNotLogged, selfUpdater } from './src/selfUpdate.mjs'
import { findGameFile } from './src/gameFile.mjs'
import { absentAs, readKept, writeAtomic } from './src/write.mjs'
import { aboutError, afterError, failingLine, fileLog, loopRecord, settleWithin } from './src/loops.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Never 0.0.0.0: the board shows private chats and can type into one. */
const HOST = '127.0.0.1'
const BODY_BYTES = 16 * 1024
const PICTURE_BYTES = REFERENCE_BYTES
const FOLDERS_MS = 60_000
const STATE_MS = 2_000
/** Clear after each step: a session the board shows under no name is read anew at most this often (src/bridge.mjs). */
const FRESH_MS = 30_000
const TICK_MS = 60_000
/** B142: how long the board's look at its folder's version is kept. */
const VERSION_MS = 30_000
const HISTORY_BYTES = 8 * 1024 * 1024

const FILES = {
  '/board.css': ['board.css', 'text/css; charset=utf-8'],
  '/board.js': ['board.js', 'text/javascript; charset=utf-8'],
  '/spending.js': ['spending.js', 'text/javascript; charset=utf-8'],
}
// B348: the help tour's six pictures, by name only. B375: drawings of the board (tools/help-pictures.mjs), as SVG.
for (const name of ['1-install', '2-initialise', '3-talk', '4-go', '5-workers', '6-check']) {
  FILES[`/help/${name}.svg`] = [join('help', `${name}.svg`), 'image/svg+xml']
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

/** The body as bytes, or null when it is larger than `most`. */
function readBytes(req, most) {
  return new Promise(done => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size <= most) chunks.push(chunk)
      else if (size > 4 * most) req.destroy()
    })
    req.on('end', () => done(size > most ? null : Buffer.concat(chunks)))
    req.on('close', () => done(null))
  })
}

/** The kind of picture some bytes are, by how they begin: never by what the sender calls them. */
export function pictureKind(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png'
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

/**
 * The server, not yet listening. Handed in, so the tests need no real files:
 *   `getState()`       the `/api/state` object
 *   `say(body)`        checks and keeps what the page sent: `{ ok: true, message }` or `{ ok: false, status, why }`
 *   `picture(path)`    a picture the board may show: `{ type, body }`, or null
 *   `game(body)`       starts or stops a branch's game: `{ ok: true, result }` or `{ ok: false, status, why }`
 *   `take(body)`       hands the mod what waits for its chat, the same shape; only with `bridgeKey`
 *   `typed(body)`      takes the mod's word on what it typed, the same shape; only with `bridgeKey`
 *   `design(body)`     the Design tab's calls (make a picture, change it, agree, ask for the step), the same shape
 *   `reference(bytes)` keeps a reference picture the person added to an idea, the same shape
 *   `talkPicture(bytes)` keeps a picture the person pasted into Talk to Main (B167), the same shape
 *   `goals(body)`      one change to the goal map (B256), the same shape; Focus 2: also a move of the Focus page
 *   `work(body)`       B297: one action of the page on the work store (work/api.mjs), the same shape
 *   `bridgeWork(body)` B297: one action of a chat's work tool, the same shape; only with `bridgeKey`
 *   `cpu(body)`        B311: the level of "CPU for the chats" ({ level }), the same shape
 *   `mayWrite()`       B529: null while this process may take the page's writes, else why not (refused with 409)
 */
export function createBoard({
  token, getState, say, picture = async () => null, gameFile = async () => null, publicDir = join(HERE, 'public'),
  game = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  bridgeKey = null, take = async () => ({ ok: false, status: 404, why: 'Not here.' }), typed = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  design = async () => ({ ok: false, status: 404, why: 'Not here.' }), reference = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  talkPicture = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  restart = async () => ({ ok: false, status: 404, why: 'Not here.' }), pageVersion = async () => '',
  onError = () => {}, onAnswered = () => {}, isClosing = () => false,
  backlog = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  goals = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  brainstorm = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  work = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  bridgeWork = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  cpu = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  settings = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  newProject = async () => ({ ok: false, status: 404, why: 'Not here.' }),
  project = '',
  mayWrite = async () => null,
}) {
  // B529: what the page writes into the project or sends to the chats is taken only by the board process that runs the
  // loops; another one on the project names where that one is. A game, a restart, the CPU level and a new project are
  // this process's own.
  const WRITES = new Set(['/api/say', '/api/design', '/api/backlog', '/api/goals', '/api/brainstorm', '/api/work', '/api/settings', '/api/design/reference', '/api/talk/picture'])
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

    if (pathname === '/api/bridge/take' || pathname === '/api/bridge/typed' || pathname === '/api/bridge/work') {
      // The mod is no page: it knows the key from the file the board wrote for it, and it can only take.
      const mayTake = bridgeKey !== null && sameText(req.headers['x-board-key'] ?? '', bridgeKey)
      const isJson = /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')
      if (req.method !== 'POST' || !mayTake || !isJson) {
        req.resume()
        if (req.method !== 'POST') return refuse(res, 405, 'Only POST.')
        return mayTake ? refuse(res, 415, 'Send JSON.') : refuse(res, 403, 'Only the Workers mod may take.')
      }
      // B404: a board that restarts takes no more work; the chat is told to try again in a moment.
      if (isClosing()) {
        req.resume()
        return refuse(res, 503, 'The board restarts: try again in a moment.')
      }
      const body = await readBody(req)
      if (body === null) return refuse(res, 413, 'Too large.')
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        return refuse(res, 400, 'Not JSON.')
      }
      // B412: a work call's request id comes in its header (the Workers mod's X-Work-Request); a body's own is not taken.
      if (pathname === '/api/bridge/work' && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const { request: _ignored, ...rest } = parsed
        parsed = { ...rest, ...(typeof req.headers['x-work-request'] === 'string' ? { request: req.headers['x-work-request'] } : {}) }
      }
      const taken = await (pathname === '/api/bridge/take' ? take : pathname === '/api/bridge/work' ? bridgeWork : typed)(parsed)
      return taken.ok ? json(res, taken.result) : refuse(res, taken.status, taken.why)
    }

    if (pathname === '/api/design/reference' || pathname === '/api/talk/picture') {
      // A picture, not JSON: the token and the origin are what another website's page cannot bring.
      const maySend = mayUse && req.headers.origin === `http://${self}`
      const isPicture = /^image\/(png|jpeg|webp)\s*(;|$)/i.test(req.headers['content-type'] ?? '')
      if (req.method !== 'POST' || !maySend || !isPicture) {
        req.resume()
        if (req.method !== 'POST') return refuse(res, 405, 'Only POST.')
        return maySend ? refuse(res, 415, 'Send a PNG, JPEG or WebP picture.') : refuse(res, 403, 'Only the board\'s own page may send.')
      }
      const notHere = await mayWrite()
      if (notHere !== null) {
        req.resume()
        return refuse(res, 409, notHere)
      }
      const bytes = await readBytes(req, PICTURE_BYTES)
      if (bytes === null) return refuse(res, 413, 'A picture of at most 8 MB.')
      const kept = await (pathname === '/api/talk/picture' ? talkPicture : reference)(bytes)
      return kept.ok ? json(res, kept.result) : refuse(res, kept.status, kept.why)
    }

    if (pathname === '/api/say' || pathname === '/api/game' || pathname === '/api/design' || pathname === '/api/restart' || pathname === '/api/backlog' || pathname === '/api/goals' || pathname === '/api/brainstorm' || pathname === '/api/work' || pathname === '/api/cpu' || pathname === '/api/settings' || pathname === '/api/new-project') {
      // Three things another website's page cannot do: know the token, carry this origin, and send JSON unasked.
      const maySend = mayUse && req.headers.origin === `http://${self}`
      const isJson = /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')
      if (req.method !== 'POST' || !maySend || !isJson) {
        req.resume()
        if (req.method !== 'POST') return refuse(res, 405, 'Only POST.')
        return maySend ? refuse(res, 415, 'Send JSON.') : refuse(res, 403, 'Only the board\'s own page may send.')
      }
      // B483: a board that restarts takes no answer of the page either: it says so at once, and the page offers Try
      // again, instead of an answer that may be cut off by the restart.
      if (pathname === '/api/work' && isClosing()) {
        req.resume()
        return refuse(res, 503, 'The board restarts: try again in a moment.')
      }
      const notHere = WRITES.has(pathname) ? await mayWrite() : null
      if (notHere !== null) {
        req.resume()
        return refuse(res, 409, notHere)
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
      if (pathname === '/api/backlog') {
        const done = await backlog(parsed)
        return done.ok ? json(res, done.result) : refuse(res, done.status, done.why)
      }
      if (pathname === '/api/work') {
        const done = await work(parsed)
        return done.ok ? json(res, done.result) : refuse(res, done.status, done.why)
      }
      if (pathname === '/api/cpu') {
        const done = await cpu(parsed)
        return done.ok ? json(res, done.result) : refuse(res, done.status, done.why)
      }
      if (pathname === '/api/settings') {
        const done = await settings(parsed)
        return done.ok ? json(res, done.result) : refuse(res, done.status, done.why)
      }
      if (pathname === '/api/new-project') {
        const done = await newProject(parsed)
        return done.ok ? json(res, done.result) : refuse(res, done.status, done.why)
      }
      if (pathname === '/api/goals') {
        const done = await goals(parsed)
        return done.ok ? json(res, done.result) : refuse(res, done.status, done.why)
      }
      if (pathname === '/api/brainstorm') {
        const done = await brainstorm(parsed)
        return done.ok ? json(res, done.result) : refuse(res, done.status, done.why)
      }
      if (pathname === '/api/design') {
        const done = await design(parsed)
        return done.ok ? json(res, done.result) : refuse(res, done.status, done.why)
      }
      if (pathname === '/api/restart') {
        const done = await restart(parsed)
        if (!done.ok) return refuse(res, done.status, done.why)
        // B142: the answer goes out first; then the board ends, and its keeper starts it anew.
        // B404: also when the page's connection drops before the answer is out, so a closing board always ends.
        let isAfter = false
        const after = () => {
          if (isAfter) return
          isAfter = true
          done.after?.()
        }
        res.on('finish', after)
        res.on('close', after)
        return json(res, done.result)
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
    // B319: whose board this is, for another board starting on this PC (src/ports.mjs, boardProject).
    if (pathname === '/api/board') return json(res, { board: 'worker-board', project })
    if (pathname === '/api/picture') {
      if (!mayUse) return refuse(res, 403, 'Only the board\'s own page may read.')
      const found = await picture(searchParams.get('path') ?? '')
      return found === null ? refuse(res, 404, 'No such picture.') : send(res, 200, found.type, found.body)
    }
    // B218: a file a link in the game plan names, read-only, from the game's folder only.
    if (pathname === '/api/game-file') {
      if (!mayUse) return refuse(res, 403, 'Only the board\'s own page may read.')
      const found = await gameFile(searchParams.get('path') ?? '', searchParams.get('alt'))
      return found === null ? refuse(res, 404, 'No such file in the game\'s or the project\'s folder, or not one the board shows.') : send(res, 200, found.type, found.body, { 'X-Board-File': found.where })
    }
    if (pathname === '/' || pathname === '/index.html') {
      const page = await readFile(join(publicDir, 'index.html'), 'utf8')
      return send(res, 200, 'text/html; charset=utf-8', page.replaceAll('{{token}}', token).replaceAll('{{page}}', await pageVersion()), {
        'Content-Security-Policy': PAGE_RULES,
        'X-Frame-Options': 'DENY',
      })
    }
    const file = FILES[pathname]
    if (file === undefined) return refuse(res, 404, 'Not here.')
    return send(res, 200, file[1], await readFile(join(publicDir, file[0])))
  }

  return createServer((req, res) => {
    handle(req, res).then(() => {
      try { onAnswered() } catch { /* the record is no reason to fail the answer */ }
    }, error => {
      // B404: the error goes to the board's log; the answer has no details, as the error may quote a chat.
      try { onError(error) } catch { /* the log is no reason to fail the answer */ }
      if (!res.headersSent) refuse(res, 500, 'The board could not answer.')
      else res.destroy()
    })
  })
}

/** B404: how long a restart waits for the reconciler's pass and the running checks before the board ends. */
const RESTART_WAIT_MS = 10_000

const argAfter = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
/** Whether `text` is valid JSON (after the byte-order mark a Windows editor may put first). */
const parses = text => {
  try {
    JSON.parse(text.replace(/^\uFEFF/, ''))
    return true
  } catch {
    return false
  }
}

async function main(args) {
  const isDemo = args.includes('--demo')
  // B127: a new copy of the board makes its settings file and stops, to have its paths filled in. The demo needs none.
  const made = isDemo ? null : await firstStart(join(HERE, 'config.json'), join(HERE, 'examples', 'config.json'))
  if (made !== null) {
    console.log(made)
    process.exit(1)
  }
  // B128: a broken settings file stops the board with one line, instead of a board on the wrong defaults.
  const config = await loadConfig(join(HERE, 'config.json')).catch(error => {
    if (!(error instanceof BrokenConfig)) throw error
    console.error(error.message)
    process.exit(1)
  })
  // The board in the main folder keeps the configured port; a copy in another folder has its own; `--port 4311`
  // wins over both.
  // The port of the board that records, as the file names it: a second board points the person there.
  const homePort = config.port
  // B319: the PC's list of boards keeps each project's port and its games' range, so two projects' boards run side by
  // side; the demo is no project's and keeps out of it.
  const boards = isDemo || config.project === '' ? null : boardsFile()
  const asked = { port: config.port, gamePort: config.gamePort }
  // The project as a whole path: the list is the PC's, read from every board's folder.
  const home = config.project === '' ? null : resolve(HERE, config.project)
  const chosen = await resolvePort({ here: HERE, given: argAfter(args, '--port'), configured: config.port, run: gitRunner(), project: home, gamePort: config.gamePort, boards })
  config.port = chosen.port
  if (chosen.gamePort !== undefined) config.gamePort = chosen.gamePort
  /** The main folder's board, on the port it was not given by hand: the one that keeps its project's place in the list. */
  const isHome = boards !== null && chosen.isMain && chosen.why !== 'given'
  const register = () => registerHome(boards, { project: home, folder: HERE, port: config.port, gamePort: config.gamePort, asked })
  if (args.includes('--launch-entry')) {
    // This folder's entry for the preview: named after the folder, with the port it listens on.
    if (config.project === '') return console.error('config.json names no project: there is no launch.json to write to.')
    // B319: the port the entry names is kept for the project from now on.
    if (isHome) await register().catch(error => console.error(`The list of boards could not be written: ${error.message}`))
    const file = join(config.project, '.claude', 'launch.json')
    const entry = launchEntry({ folder: HERE, port: config.port, node: process.execPath, main: chosen.main })
    await mkdir(join(config.project, '.claude'), { recursive: true })
    // B406: a launch.json that is there but cannot be read or parsed is never written over: its other entries would be
    // lost.
    const before = await readFile(file, 'utf8').catch(error => error?.code === 'ENOENT' ? '' : null)
    const refuse = why => {
      process.exitCode = 1
      console.error(why)
    }
    if (before === null) return refuse(`${file} could not be read: it is left as it is.`)
    if (before.trim() !== '' && !parses(before)) return refuse(`${file} is not valid JSON: fix it by hand; it is left as it is.`)
    await writeAtomic(file, withEntry(before, entry))
    return console.log(`Launch entry "${entry.name}" in ${file}: ${entry.url}/`)
  }
  const historyFrom = argAfter(args, '--history-from')
  const clock = Date.now

  const keep = { messageMs: config.messageKeepMinutes * 60_000, answerMs: config.answerKeepHours * 60 * 60_000 }
  const timeOf = at => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  // B404: every background loop runs through the record: its last success and error, and a log file of the errors
  // in the project's .claude folder (none for the demo).
  const loops = loopRecord({ now: clock, write: isDemo || config.project === '' ? () => {} : fileLog(join(resolve(HERE, config.project), '.claude', 'board-errors.log')) })
  /** B404: the checks after a report that run now, by step id; a restart waits for them, the stuck-check pass skips them. */
  const runningChecks = new Map()
  /** B404: set once a restart was asked: the board takes no more work and its loops start nothing new. */
  let isClosing = false
  /** B404: the reconciler's pass that runs now, for the restart to wait on. */
  let reconciling = null
  // The demo has no chats to type into, so it has no bridge.
  // Neither has a board that only shows another one's history: the board that records is the one that delivers,
  // so of two boards on one project it is always the same one.
  // The same holds for a copy in another folder than the repository's main one: a branch that is being built
  // must never take the chats away from the person's board, also not while that board is stopped.
  const isShowOnly = historyFrom !== undefined || chosen.isMain === false
  // Focus 2: the board that delivers writes the goal map, its brainstorms and the focus; a copy only a map of its own
  // (whole paths outside the project, by real paths, and not the live board's map), as its own work store. A copy's words
  // then wait in its own outbox: no chat takes from it.
  const writesMap = !isDemo && (!isShowOnly || await ownMapNow(config, { main: chosen.main }))
  // B142: a board its keeper started anew keeps the key it gave the chats' mod, so they reach it at once. The key
  // goes no further than this process: what the board starts does not get it.
  const keptKey = process.env.WORKER_BOARD_KEY ?? ''
  delete process.env.WORKER_BOARD_KEY
  const bridgeKey = isDemo || isShowOnly ? null : /^[0-9a-f]{64}$/.test(keptKey) ? keptKey : randomBytes(32).toString('hex')
  if (bridgeKey !== null) process.send?.({ key: bridgeKey })

  // B482, B488: one board process per project runs the loops (the reconciler, the look with its rounds, refine lines and
  // wakes, the outbox, the list): the one that holds this lock. A second process on the project (another --port) serves
  // the page and reads what the first wrote. The lock is checked at every run, so the other takes over within one run
  // when the holder ends (src/supervisor/loop.mjs loopOwner, loopGate). A copy that only shows runs its own loops, unlocked.
  const LOOP_LOCK = isDemo || isShowOnly || config.project === '' ? null : join(config.project, '.claude', 'sync-loop.json')
  /** Set below, where the stores and the bridge note are: what this process does when it gains the loops. */
  let gainedLoops = async () => {}
  const ownsLoops = LOOP_LOCK === null ? async () => true : loopGate({
    owner: loopOwner({
      read: () => readFile(LOOP_LOCK, 'utf8'),
      write: async text => {
        await mkdir(dirname(LOOP_LOCK), { recursive: true })
        await writeAtomic(LOOP_LOCK, text)
      },
      alive: pid => {
        try {
          process.kill(pid, 0)
          return true
        } catch (error) {
          return error?.code === 'EPERM'
        }
      },
      pid: process.pid,
      port: config.port,
      now: clock,
      settleMs: 80,
    }),
    now: clock,
    onGained: () => gainedLoops(),
    onFailed: error => loops.failed('loop-lock', error),
  })
  /** B529: the port of the board process that holds the lock, or null. */
  const loopHolderPort = async () => {
    try {
      const port = JSON.parse(await readFile(LOOP_LOCK, 'utf8')).port
      return Number.isInteger(port) ? port : null
    } catch {
      return null
    }
  }
  if (LOOP_LOCK !== null) {
    process.on('exit', () => {
      try {
        if (JSON.parse(readFileSync(LOOP_LOCK, 'utf8')).pid === process.pid) rmSync(LOOP_LOCK)
      } catch {
        // not there, or another board's by now
      }
    })
  }

  // The games started for a look at a branch. Each ends by itself; the board also ends them when it is closed.
  const games = createGames({
    launch: gameLauncher({
      command: config.runGame,
      board: HERE,
      cacheDir: join(HERE, 'data', 'game-cache'),
      idleSeconds: config.gameIdleSeconds,
      graceSeconds: config.gameOpenSeconds,
    }),
    now: clock,
  })
  let folders = async () => null
  let branches = async () => null
  // B110: the repositories whose branches say whether a step's work is merged: the game's, and the board's own.
  // B132: the game's repository only when the settings name one; `git -C ""` would read the board's own folder.
  const hasGame = config.gameRepo !== ''
  const branchesNow = () => readBranches(hasGame ? [config.gameRepo, HERE] : [HERE], gitRunner())
  // B304: the repositories the board knows, each with the branch work is merged into: the game's, and the board's own.
  const knownRepos = () => [...(hasGame ? [{ dir: config.gameRepo, base: config.baseBranch }] : []), { dir: HERE, base: 'main' }]

  // B110: an approval of merged work, and "Done" on what only the person could do, the board settles itself.
  const settle = (message, state) => settleByBoard(message, state, {
    work: workWriters,
    branchesNow,
    now: clock(),
    say: sent => store.say(sent),
    newId: () => randomBytes(8).toString('hex'),
  })

  // B296, B301: the work store, the one source of the work. Every board reads it; a store that is not there or cannot be
  // read is said on top of the page (work/read.mjs, `storeFault`), and nothing is drawn from the backlog file instead.
  const work = isDemo || config.project === '' ? async () => undefined : storeKeeper({ dir: workFolder(config), clock })
  // B297: the work store's API (work/api.mjs): the page's actions as the person, the work tool's as its chat. Each
  // change writes backlog.md anew as the store's view: the board that delivers writes the project's file; a copy with a
  // store of its own (outside the project) writes the view into that folder, never the project's backlog. A copy
  // without one only reads.
  const workDir = isDemo || config.project === '' ? null : workFolder(config)
  const viewFile = workDir === null ? null : !isShowOnly ? join(config.project, ...config.backlog.split('/')) : isOwnWork(config) ? join(workDir, 'backlog.md') : null
  const workWriters = viewFile === null ? null : { dir: workDir, viewFile }
  /**
   * Focus 2 (spec 2026-10-18, sections 3 and 6): a move of the Focus page, or a draft of the partner's (the page's route,
   * or the work tool's vibe-draft and how-draft through the work API), written into the
   * goal map (src/focus.mjs); the person's word to the partner goes into the outbox as every other board word, the
   * partner woken through the main chat when its chat is not running (Review Focus 5). Without the Workers mod it is
   * kept as copied and the page puts it on the clipboard.
   */
  const focusNow = async body => {
    const state = await readState()
    const done = await focusMove(body, {
      canWrite: writesMap,
      goalsFile: projectFile(config, 'goals'),
      historyDir: projectFile(config, 'goalsHistory'),
      brainstormDir: projectFile(config, 'brainstorms'),
      brainstormFolder: config.brainstorms,
      now: clock(),
      partner: state.advisor ?? null,
      job: join(HERE, 'roles', 'partner.md'),
      // Focus 3: "Is the vibe there?" is answered only once every part of the how is done, as the store says.
      allDone: state.focus?.id === body?.id && state.focus.progress.total > 0 && state.focus.progress.done === state.focus.progress.total,
    })
    readState.reset()
    // B382: a goal that is not the focus may be evaluated meanwhile: while an evaluation runs, the partner stays on high effort.
    // B467: a goal map it cannot read is not "none running": the partner's effort stays as it is (shown and logged).
    const running = done.ok ? await loops.run('evaluations', () => evaluationsRunning({ goalsFile: projectFile(config, 'goals') })) : []
    const isKnown = Array.isArray(running)
    // B359: the partner's how-draft ended the goal guard's evaluation: back to the usual partner, unless another runs.
    if (done.ok && done.result?.evaluated === true && isKnown && running.length === 0) await partnerMode(state, 'usual', 'the evaluation ended with the how: back to the usual partner')
    if (!done.ok || done.words === null) return done.ok ? { ok: true, result: done.result } : done
    // B352: Go on the how, and another goal as the focus, switch the partner back to the usual mode (the talk about the
    // same goal started again keeps it).
    // B354: something new waits in the map for its Done when: the focus did not change, so neither does the partner.
    const isSameFocus = body.command === 'focus' && (body.id === state.focus?.id || done.result?.isFocus === false)
    const back = isSameFocus || !isKnown || running.length > 0 ? null : effortBack(body.command, state.advisor?.effort)
    const main = state.restart?.main ?? null
    if (back !== null && main !== null) {
      const words = partnerEffortWords({ to: main, partner: state.advisor.name, session: state.advisor.appSession ?? null, mode: 'usual', why: back })
      const message = { id: randomBytes(8).toString('hex'), at: clock(), ...words, state: state.bridge?.isMissing === true ? 'copied' : 'waiting' }
      // Review: copied, it keeps its words as pasted, with the board's mark, as every copied word (the restart banner).
      await store.say(message.state === 'copied' ? { ...message, pasteText: messageText(message, timeOf) } : message)
    }
    return toPartner(done.words, done.result, state)
  }
  /**
   * B352, B359: a word to the main chat to set the partner's mode, unless it runs on that mode already: copied without the
   * Workers mod, as every board word.
   */
  const partnerMode = async (state, mode, why) => {
    const main = state.restart?.main ?? null
    if (main === null || (state.advisor ?? null) === null || (state.advisor.effort?.mode ?? 'usual') === mode) return
    const words = partnerEffortWords({ to: main, partner: state.advisor.name, session: state.advisor.appSession ?? null, mode, why })
    const message = { id: randomBytes(8).toString('hex'), at: clock(), ...words, state: state.bridge?.isMissing === true ? 'copied' : 'waiting' }
    await store.say(message.state === 'copied' ? { ...message, pasteText: messageText(message, timeOf) } : message)
  }
  /**
   * B359: the goal guard, after a failed check of goal `id` (a step's result check or the goal's re-check): at the third
   * failed attempt (since Go, else since its first refined step) the partner is switched to high effort and asked for the fundamental evaluation, once.
   */
  const guardNow = async id => {
    if (!writesMap || workDir === null || id === null) return
    const state = await readState()
    if ((state.advisor ?? null) === null) return
    // B446: a store it cannot read fails the guard's loop (shown and logged) instead of counting no attempt.
    const items = [...(await readStore(workDir)).items.values()]
    const done = await guardGoal(id, {
      canWrite: writesMap, goalsFile: projectFile(config, 'goals'), historyDir: projectFile(config, 'goalsHistory'), now: clock(),
      partner: state.advisor, job: join(HERE, 'roles', 'partner.md'), items, approveRebuilds: config.approveRebuilds === true, maxChars: config.maxMessageChars,
    })
    if (!done.ok || done.words === null) return
    await partnerMode(state, 'high', `the goal guard: ${id} failed ${GUARD_ATTEMPTS} attempts: a fundamental evaluation`)
    await toPartner(done.words, {}, state)
  }
  /**
   * B528: while an evaluation runs and has not ended, its word goes to the partner again every 30 minutes (src/focus.mjs
   * `evaluationsAgain`), so a word that did not arrive (refused, expired, lost) never leaves it waiting unseen. Not while
   * the person pauses.
   */
  const evaluateAgainNow = async state => {
    if (!writesMap || workDir === null || (state.advisor ?? null) === null || isHolding(state.pause)) return
    const again = await evaluationsAgain({
      canWrite: writesMap, goalsFile: projectFile(config, 'goals'), now: clock(), outbox: store.outbox(), partner: state.advisor,
      items: async () => [...(await readStore(workDir)).items.values()], job: join(HERE, 'roles', 'partner.md'),
      approveRebuilds: config.approveRebuilds === true, maxChars: config.maxMessageChars,
    })
    if (again.length === 0) return
    await partnerMode(state, 'high', `the goal guard: the evaluation of ${again.map(words => words.about).join(', ')} has not ended`)
    for (const words of again) await toPartner(words, {}, state)
  }
  /** Focus 2: the person's word to the partner into the outbox (copied without the Workers mod); a partner not running is woken. */
  const toPartner = async (words, result, state) => {
    const isCopied = state.bridge?.isMissing === true
    const message = { id: randomBytes(8).toString('hex'), at: clock(), ...words, state: isCopied ? 'copied' : 'waiting' }
    await store.say(message)
    readState.reset()
    if (isCopied) return { ok: true, result: { ...result, said: message.id, paste: { text: messageText(message, timeOf), chat: `${state.chatPrefix ?? ''}${message.to}` } } }
    const wake = wakeFor(message, state, store.outbox(), clock(), config.maxMessageChars)
    if (wake !== null) await store.say({ id: randomBytes(8).toString('hex'), at: clock(), ...wake, state: 'waiting' })
    return { ok: true, result: { ...result, said: message.id } }
  }
  /**
   * Focus 3 (spec 2026-10-18, sections 5 and 6): the person's Undo of a line the partner decided for them, from the Focus
   * page (`note-undo` on /api/goals, or `undo` on /api/work; `note` the daily note, `line` its words): the board types
   * `undo: <line>` to the partner, then the store marks it "undo asked" (work/api.mjs `undo`); a second Undo types
   * nothing (Review Focus 4), and a word not kept leaves the line unmarked (the review).
   */
  const undoNow = async body => {
    const state = await readState()
    const partner = state.advisor ?? null
    // The review: typed first, marked after (src/focus.mjs `undoLine`); a word not kept leaves the line unmarked.
    // Partner answers (2026-10-19): a partner's answer of an ask is taken back in the store, and its asking chat told.
    return undoLine({ note: body?.note, line: body?.line }, {
      work: action => workAction(action, 'person'),
      type: ({ of, line }) => {
        if (partner === null) return { ok: false, status: 409, why: 'No partner chat is on the board: the setting advisor names none.' }
        const title = (state.goals?.nodes ?? []).find(node => node.id === of)?.title ?? ''
        return toPartner(focusWords('undo', { to: partner.name, goal: { id: of, title }, words: line, note: body?.note }), {}, state)
      },
      tell: wake => sendWakes({ ok: true, result: { wake } }),
    })
  }
  /**
   * B299: the chats an action on the store wakes (`wake`, `wakeOwner`, B449 `wakePartner`): the chat that asked, with the answer to its ask
   * (bridge.mjs, as the person's answer reads), and the owner of the step the answer frees. Partner answers (2026-10-19):
   * also from the work tool (the partner's answer), and a line of its own (`line`: the person took a partner's answer
   * back). Only to a chat the board shows; copied without the Workers mod. What to paste, or null.
   */
  const sendWakes = async done => {
    const wakes = done?.ok === true ? [done.result.wake ?? null, done.result.wakeOwner ?? null, done.result.wakePartner ?? null].filter(one => one !== null) : []
    let paste = null
    for (const wake of isShowOnly ? [] : wakes) {
      const state = await readState()
      const shown = [...(state.chats ?? []).filter(chat => !chat.isLeftover), ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : [])].some(chat => chat.name === wake.to)
      if (!shown) continue
      const isCopied = state.bridge?.isMissing === true
      const words = typeof wake.line === 'string' ? { ...workWords(wake.to, wake.id, wake.line), kind: 'taken-back' } : answerWords(wake)
      const message = { id: randomBytes(8).toString('hex'), at: clock(), ...words, state: isCopied ? 'copied' : 'waiting' }
      await store.say(message)
      const start = isCopied ? null : wakeFor(message, state, store.outbox(), clock(), config.maxMessageChars)
      if (start !== null) await store.say({ id: randomBytes(8).toString('hex'), at: clock(), ...start, state: 'waiting' })
      readState.reset()
      if (isCopied) paste ??= { text: messageText(message, timeOf, path => inProject(config.project, path)), chat: `${state.chatPrefix ?? ''}${message.to}` }
    }
    return paste
  }
  /** What the API goes by: who is who in the list of chats, who is free, where the view goes. */
  const workCtx = async () => {
    const state = await readState()
    const lanes = (state.chats ?? []).filter(lane => !lane.isLeftover)
    const roles = new Map(lanes.map(lane => [lane.name, lane.isMain ? 'main' : 'worker']))
    if (state.advisor) roles.set(state.advisor.name, 'advisor')
    // B424: the partner's helper refines and checks as the partner does; no step is queued for it.
    if (state.advisorHelper) roles.set(state.advisorHelper.name, 'helper')
    return {
      // Focus 2: the partner's drafts of the focus (the work tool's vibe-draft and how-draft) go into the goal map.
      goalDraft: body => focusNow(body),
      // B358: the partner's re-check of a goal (the work tool's checked of a G<n>), written into the goal map.
      goalChecked: async body => {
        const done = await goalChecked(body, {
          canWrite: writesMap, goalsFile: projectFile(config, 'goals'), historyDir: projectFile(config, 'goalsHistory'), now: clock(),
        })
        readState.reset()
        return done
      },
      dir: workDir, now: clock(), prefix: state.chatPrefix ?? '', roleOf: chat => roles.get(chat) ?? null,
      routingPolicy: config.routing,
      routingCapabilities: null,
      sessionOf: name => {
        const subject = (state.spendingSubjects ?? []).find(one => one.name === name)
        return subject ? { sessionId: subject.session, appSessionId: subject.appSession, model: subject.model, effort: subject.effort, sampledAt: state.readAt } : null
      },
      // Pause and resume (spec 2026-10-18): the lanes' facts, for pause-state's list of whom the main chat wakes.
      lanes: [...lanes, ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : [])],
      // Focus 4: the list's chat names: a name given with the prefix or in another case is the list's.
      chats: [...roles.keys()],
      freeChats: new Set(lanes.filter(lane => lane.state === 'free').map(lane => lane.name)), overlapsOfStore: true,
      viewFile, boardUrl: `http://${HOST}:${homePort}`, backlogFile: join(config.project, ...config.backlog.split('/')),
      // Focus 3, the review: the goals of the map the board reads, for an ask or a daily note of a goal.
      hasGoal: id => (state.goals?.nodes ?? []).some(node => node.id === id),
      // B518: a goal in its fundamental evaluation ('running') or that ended one ('ended'): its steps default to opus and high.
      evaluationOf: id => evaluationState((state.goals?.nodes ?? []).find(one => one.id === id)),
      // B354: the project's kinds of work: a refined step that names one carries its standard.
      kinds: config.kinds,
      // 2026-10-24: an ask's picture the board cannot show is refused with where to put it (api.mjs ask).
      pictureProblem: path => pictureProblem(config.project, shownRoots(config), path),
      shownFolders: shownFolders(config),
      // Q311: a picture a chat's For you block names outside them is copied into the picture folder instead.
      adoptPicture: (path, subject) => adoptPicture(config.project, shownFolders(config)[0], subject, path),
      // Model per step: why a step's line waits for its worker's model or effort (effort.mjs `holds`), or null.
      stepHold: id => state.reconciled?.holds?.[id] ?? null,
      // The guard (2026-10-21): a step of a kind waits for its standard's confirm and its foundation (the product plan).
      standardHold: item => standardHold(item, state.plan?.standards ?? []),
      // B356: a board without a partner chat makes no result check: its own check closes a step.
      hasPartner: (state.advisor ?? null) !== null,
      // Worktree clean-up (2026-10-24): a result check is filed only once its own check-<id> worktrees are gone.
      checkWorktrees: id => stepLeftovers({ id, which: 'check', repos: knownRepos(), project: config.project, run: gitRunner(), fs: WORKTREE_FILES }),
      // Partner answers (2026-10-19): the focus goal, whose daily note lists the partner's answers of the day.
      focusGoal: state.focus?.id ?? null,
    }
  }
  /**
   * B356: the partner is asked for a step's result check (`check step`), as every board word to it: copied without the
   * Workers mod, and woken through the main chat when its chat does not run. Nothing without a partner on the board.
   */
  const askResultCheck = async step => {
    const state = await readState()
    if ((state.advisor ?? null) === null) return
    const isCopied = state.bridge?.isMissing === true
    const message = { id: randomBytes(8).toString('hex'), at: clock(), ...checkStepWords(state.advisor.name, step, join(HERE, 'roles', 'partner.md')), state: isCopied ? 'copied' : 'waiting' }
    await store.say(isCopied ? { ...message, pasteText: messageText(message, timeOf) } : message)
    const wake = isCopied ? null : wakeFor(message, state, store.outbox(), clock(), config.maxMessageChars)
    if (wake !== null) await store.say({ id: randomBytes(8).toString('hex'), at: clock(), ...wake, state: 'waiting' })
    readState.reset()
  }
  /** B359: the goal a checked item counts for: the goal itself (G<n>), or the step's Goal in the store. */
  const goalOfChecked = async id => {
    const plain = String(id ?? '').trim()
    if (/^G\d+$/.test(plain)) return plain
    const store = (await readStore(workDir)).items
    const item = store.get(plain)
    // B450: an ask counts for the goal it is of, or for the goal of the step it is of.
    const of = item?.head.get('Kind') === 'ask' ? item.head.get('Of') ?? null : null
    if (of !== null) return /^G\d+$/.test(of) ? of : store.get(of)?.head.get('Goal') ?? null
    return item?.head.get('Goal') ?? null
  }
  /**
   * B360: the person's Overturn of an open recap of a goal, with words: the goal opens again in the goal map first (the
   * board that writes the map only). Null when it is no such Overturn; the outcome otherwise, a refusal kept for the page.
   */
  const openOverturnedGoal = async body => {
    if (workDir === null) return null
    // B467: a store it cannot read fails the call (the page gets an error, the log a line), never "no such recap".
    const recap = (await readStore(workDir)).items.get(String(body.id ?? '').trim())
    const about = recap?.sections.get('About')?.[0] ?? ''
    if (recap?.head.get('Recap') !== 'open' || !/^G\d+$/.test(about) || String(body.text ?? '').trim() === '') return null
    if (!writesMap) return { ok: false, status: 409, why: `This board does not write the goal map: overturn ${about} on the board that delivers.` }
    const opened = await goalReopened({ id: about, words: String(body.text) }, { canWrite: writesMap, goalsFile: projectFile(config, 'goals'), historyDir: projectFile(config, 'goalsHistory'), now: clock() })
      .catch(() => ({ ok: false, status: 500, why: `${about} could not be opened again: try once more.` }))
    readState.reset()
    return opened
  }
  const workReads = new Set(['next', 'list', 'pause-state', 'route-state'])
  /** One action on the store; after a change the board reads it anew, and after a report (or a recheck) it runs its own check. */
  const workAction = async (body, as) => {
    if (workDir === null) return { ok: false, status: 404, why: 'This board has no work store.' }
    if (workWriters === null && !workReads.has(body?.action)) return { ok: false, status: 409, why: `This board only shows. Change the work on the board that delivers: http://${HOST}:${homePort}/` }
    // Focus 4: a board that only shows reads the main chat's notes without marking them read.
    const done = await workApi(body, { ...(await workCtx()), ...(as === undefined ? {} : { as }), ...(workWriters === null ? { onlyShows: true } : {}) })
    // B356, the second review: a fix's check that leaves the step it fixes in review asks the partner for that step again.
    // B446: both run as loops: a failure shows on the page and in the log (with the step not asked for), and never
    // fails the chat's call.
    const asked = done.ok ? done.result.resultCheck : undefined
    if (asked !== undefined) await loops.run('result-check', () => askResultCheck(asked).catch(error => { throw aboutError(asked.id, error) }))
    // B359: a failed check counts an attempt of its goal: the guard looks whether it fires.
    if (done.ok && body?.action === 'checked' && (done.result.fix !== undefined || done.result.ticked === false)) await loops.run('guard', async () => guardNow(await goalOfChecked(body.id)))
    // B450: and your no to a look of one of its steps counts an attempt too.
    if (done.ok && body?.action === 'answer') await loops.run('guard', async () => guardNow(await goalOfChecked(body.id)))
    if (done.ok && done.result.changed !== false) {
      work.reset?.()
      readState.reset()
    }
    if (done.ok && done.result.check !== undefined) {
      const { id, branch, result, merged, touches } = done.result.check
      // B304: the repositories the board knows; the check finds the one the step's work is in among them.
      void runCheck({ id, branch, result, merged, touches, repos: knownRepos() })
    }
    return done
  }
  /**
   * The board's check of a reported step (B304), run in the background. B404: kept in runningChecks while it runs, and
   * its errors recorded (loop "check") instead of swallowed; a check that never finished is run again by the reconciler.
   */
  function runCheck({ id, branch, result, merged, touches, repos = knownRepos() }) {
    if (runningChecks.has(id)) return runningChecks.get(id)
    // B404: a closing board starts no check; the stuck-check pass of the next board runs it.
    if (isClosing) return Promise.resolve()
    // B363: work outside git is checked by its files, in the project's folder or a repository's.
    const exists = path => stat(path).then(() => true, () => false)
    const running = loops.run(`check:${id}`, async () => {
      // Worktree clean-up (2026-10-24): no worktree of the step, nor its folder, is left in the project folder.
      const outcome = await reportCheck({ id, branch, result, merged, repos, run: gitRunner(), project: config.project, touches, exists, fs: WORKTREE_FILES })
      const checked = await workApi({ action: 'check', id, ...outcome }, { ...(await workCtx()), as: 'server' })
      if (checked?.ok !== true) throw new Error(`the check of ${id} could not be written: ${checked?.why ?? 'no answer'}`)
      // B356: the board's check passed and the step waits for its result check: the partner is asked for it.
      if (checked?.ok === true && checked.result.resultCheck !== undefined) await askResultCheck(checked.result.resultCheck)
      work.reset?.()
      readState.reset()
    }).finally(() => runningChecks.delete(id))
    runningChecks.set(id, running)
    return running
  }

  let store
  let readRaw
  let readLines = raw => raw.historyLines ?? store.lines()
  // B155: when the board first saw each step ticked, kept in its data folder from now on; null before its first look.
  const FINISHED_FILE = join(HERE, 'data', 'finished.json')
  let finishedSeen = {}
  // B173: what the clock of the Advisor's rounds wrote down; null before its first look.
  const ROUNDS_FILE = join(HERE, 'data', 'rounds.json')
  let roundsKept = null
  // B285: what the board wrote down when it began refining steps by itself (refineGate.mjs `firstLook`): the highest
  // step then, above which a step is new and gets one refine, and the steps queued then unrefined. Null before.
  const REFINE_FILE = join(HERE, 'data', 'refine-gate.json')
  let refineKept = null
  /**
   * B406: the data files the board started without: `{ file, aside, why }`, `aside` the copy a torn one was kept as, or
   * null when it could not be read or kept aside (`why`).
   */
  const setAside = []
  /** B406: a kept data file as the board reads it at its start (src/write.mjs, readKept); what it starts without is noted. */
  const kept = async file => {
    const read = await readKept(file, clock())
    if (read.setAside !== null) setAside.push({ file: basename(file), aside: basename(read.setAside), why: null })
    else if (read.unread !== null) setAside.push({ file: basename(file), aside: null, why: read.unread })
    return read.value
  }
  // B185: how long the tasks really took, read from the workers' transcripts and kept in the data folder, with the
  // list the chats read when they give a time. A board that shows another's history starts from that one's file
  // and measures in memory only.
  const TASK_TIMES_FILE = join(HERE, 'data', 'task-times.json')
  const TASK_LIST_FILE = join(HERE, 'data', 'task-times.md')
  const spending = createSpendingCollector({ dir: join(HERE, 'data'), transcripts: config.transcripts, clock })
  await spending.load()
  let taskTimes = { scans: {}, tasks: [] }
  // The supervisor's section on the demo: made-up rules, incidents and a check of its own (fixtures/demo.mjs).
  let demoSupervisor = () => null
  if (isDemo) {
    const { demoSources, demoSupervisor: madeUp, ROOTS } = await import('./fixtures/demo.mjs')
    config.pictureRoots = ROOTS
    store = memoryStore()
    readRaw = () => demoSources(clock())
    demoSupervisor = madeUp
  } else {
    folders = hasGame ? cached(() => readFolders(config.gameRepo, gitRunner(), config.baseBranch), FOLDERS_MS) : async () => null
    branches = cached(() => branchesNow(), FOLDERS_MS)
    readRaw = async () => {
      // B273: the app may move its folder while the board runs: the board follows it.
      // B467: as a loop: a failed search shows and is logged; the board reads where it read before.
      await loops.run('app-folder', () => followApp(config, process.env, process.platform))
      return readSources(config, folders, undefined, branches, work)
    }
    if (historyFrom === undefined) {
      store = await fileStore(join(HERE, 'data'), clock())
      // B406: a file torn by a restart or a power cut is set aside, and the board starts without it (the page says so).
      finishedSeen = await kept(FINISHED_FILE)
      roundsKept = await kept(ROUNDS_FILE)
      refineKept = await kept(REFINE_FILE)
      taskTimes = await kept(TASK_TIMES_FILE) ?? taskTimes
    } else {
      // The history of the board that is running; this one records nothing and keeps what is sent in memory.
      store = memoryStore()
      // B467: none there is none yet; one it cannot read or parse is shown (it is the other board's: never moved here).
      taskTimes = await readFile(join(resolve(historyFrom), 'task-times.json'), 'utf8').then(text => JSON.parse(text))
        .catch(absentAs(null)).catch(error => { loops.failed('history', error); return null }) ?? taskTimes
      const shared = cached(async () => parseHistory((await readHead(join(resolve(historyFrom), 'history.jsonl'), HISTORY_BYTES))?.text ?? ''), TICK_MS / 2)
      const lines = { now: [] }
      readLines = () => lines.now
      readRaw = async () => {
        lines.now = await shared()
        return readSources(config, folders, undefined, branches, work)
      }
    }
  }

  // When this board started, and since when it had been off: after a restart of the app both boards and every
  // chat were gone for that long.
  const startedAt = clock()
  let lastAlive = store.aliveAt?.() ?? null
  if (historyFrom !== undefined) {
    try {
      lastAlive = JSON.parse((await readHead(join(resolve(historyFrom), 'alive.json'), 1024))?.text ?? '').at
    } catch {
      lastAlive = null
    }
  }
  const offSince = Number.isFinite(lastAlive) && startedAt - lastAlive > 3 * 60_000 ? lastAlive : null

  // B142: the version this board runs (the commit its folder was on when it started), and whether the folder holds
  // a newer one. A board its keeper runs can be started anew from its page; it ends when its keeper is gone.
  const canRestart = typeof process.send === 'function'
  if (canRestart) process.on('disconnect', () => process.exit(0))
  const running = (await gitRunner()(['-C', HERE, 'rev-parse', '--short', 'HEAD']))?.trim() || null
  const versionNow = cached(() => readVersion(gitRunner(), HERE, running), VERSION_MS)
  // B454: a new server version is started by the board itself at a safe moment (src/selfUpdate.mjs): what it waits for
  // is shown on the page's note; the calls of the chats being answered now and the last chat log asked for are counted here.
  const selfUpdate = selfUpdater({ now: clock })
  let updateShown = null
  let callsNow = 0
  let lastLogAt = null
  const loggedAt = new Map()
  const counted = answer => async body => {
    callsNow += 1
    try {
      return await answer(body)
    } finally {
      callsNow -= 1
    }
  }
  // B319: the Workers mod this folder carries against the one the PC runs (one per PC, for every project's board).
  // Only the board that delivers says so: a copy or a board that shows another's history is no install of the mod.
  const modNow = isDemo || isShowOnly ? async () => null
    : cached(() => modVersions({ modsDir: join(HERE, 'mods'), file: pluginsFile(), markets: marketsFile() }), VERSION_MS)
  // B320: true while the New project button's project is being made.
  let makingProject = false

  // When each chat's mod last asked this board, by the chat's name: who asks runs. The demo has no bridge.
  const seen = bridgeKey === null ? null : { shown: {}, other: {} }
  // B465: the names a chat's mod was refused under lately, with its session, for the sync check's "old name".
  const refusedNames = new Map()
  const noteRefused = (body, checked) => {
    if (checked.ok || checked.status !== 409 || typeof body?.chat !== 'string' || typeof body?.session !== 'string') return
    const name = body.chat.trim().slice(0, 80)
    const session = body.session.trim().slice(0, 120)
    // The review: since when it asks under that name, so one refusal the mod then follows is no case (the rule old-name).
    const before = refusedNames.get(`${name} ${session}`)
    refusedNames.set(`${name} ${session}`, { name, session, first: before?.first ?? clock(), at: clock() })
    for (const [key, one] of refusedNames) if (clock() - one.at >= REFUSED_MS) refusedNames.delete(key)
  }
  // The supervisor (spec 2026-10-24): the board's own check of itself, B465's list of stuck states among it
  // (src/supervisor), set up with the reconciler on a board that writes; null on a board that never runs it. B482,
  // B488: it runs where the board's loops run (`ownsLoops`, its port `owns`).
  let supervisor = null

  // The Design tab: an idea becomes a picture that Codex makes. Only here does the board start a program that
  // makes something: on the person's click, one at a time, with a time limit (see src/codex.mjs).
  // B133: the kinds of idea are the project's own (the setting designKinds); the demo has its made-up ones.
  const kindsFile = isDemo ? join(HERE, 'fixtures', 'demo-design.json') : config.project === '' ? null : join(config.project, ...config.designKinds.split('/'))
  // B467: no file gives the usual kinds; one it cannot read gives them too, and says so.
  const settings = parseDesignSettings(kindsFile === null ? '' : await readFile(kindsFile, 'utf8').catch(absentAs('')).catch(error => { loops.failed('design-kinds', error); return '' }))
  // B198: new ideas go into the project's picture folder.
  const ideas = isDemo ? ideasOver((await import('./fixtures/demo.mjs')).demoIdeas(clock()), undefined, { pictures: config.pictureRoots[0] })
    // B406: a torn ideas file is set aside like the other data files, never written over with no ideas in it; a board
    // showing another's history reads its own as it is.
    : await ideasFile(join(HERE, 'data', 'ideas.json'), { pictures: config.pictureRoots[0], ...(historyFrom === undefined ? { kept: await kept(join(HERE, 'data', 'ideas.json')) } : {}) })
  const codex = isDemo ? null : await findCodex({ given: settings.codex })
  const inProject = (project, path) => join(project, ...path.split('/'))
  /** The picture being made: which idea and version, since when, and how to stop it. */
  let making = null
  /** The reference pictures the settings name that are not there, looked for once a minute. */
  const missingReferences = cached(async () => {
    const paths = [...new Set(settings.kinds.flatMap(kind => kind.references))]
    const found = await Promise.all(paths.map(path => stat(inProject(config.project, path)).then(file => file.isFile(), () => false)))
    return paths.filter((_path, index) => !found[index])
  }, 60_000)
  const canMake = !isDemo && codex !== null && settings.kinds.length > 0 && config.project !== ''
  const whyNoPicture = isDemo ? 'This is the demo: it makes no picture.'
    : kindsFile === null ? 'config.json names no project.'
      : settings.kinds.length === 0 ? `${kindsFile} names no kinds of idea: copy examples/design.json there and write the project's own.`
        : codex === null ? `Codex was not found on this PC (see "codex" in ${kindsFile}).` : 'config.json names no project.'
  /** What a picture took lately, for the page's "about a minute". */
  const typicalSeconds = () => {
    const took = ideas.all().flatMap(idea => idea.versions).filter(version => version.state === 'done' && Number.isFinite(version.seconds)).map(version => version.seconds).sort((a, b) => a - b)
    return took.length === 0 ? 60 : took[Math.floor(took.length / 2)]
  }
  /** Everything that was sent, with what waited too long marked so. */
  const sentNow = () => {
    const now = clock()
    return store.outbox().map(message => (message.state === 'waiting' && isLate(message, now, keep) ? { ...message, state: 'expired' } : message))
  }
  /** The Design tab's calls, one after the other. */
  const designTurn = inTurn()
  /** What the checks of the Design tab's calls go by. */
  const designNow = state => ({
    // An idea that was handed to the main chat carries how that word fared: one that did not arrive can be sent again.
    ideas: ideas.all().map(idea => (idea.sent === null ? idea : { ...idea, sent: { ...idea.sent, state: sentNow().find(message => message.id === idea.sent.message)?.state ?? 'delivered' } })),
    maxChars: config.maxMessageChars,
    kinds: settings.kinds,
    pictures: config.pictureRoots[0],
    canMake,
    why: whyNoPicture,
    busy: making === null ? null : { idea: making.idea, version: making.version, since: making.since },
    // Asking the main chat for the step is sending: only the board that delivers does it.
    canSend: !isDemo && !isShowOnly,
    whyNot: isDemo ? 'This is the demo: it asks nobody.' : `This board only shows. Do this on the board that delivers: http://${HOST}:${homePort}/`,
    main: state.restart?.main ?? null,
    workers: (state.chats ?? []).filter(chat => !chat.isLeftover && !chat.isMain).map(chat => chat.name),
  })

  /** Has Codex make one version of an idea; the answer to the page does not wait for it. */
  function startPicture(idea, version) {
    const kind = settings.kinds.find(one => one.id === idea.kind)
    making = { idea: idea.id, version: version.n, since: clock(), stop: () => {}, dir: null }
    const mine = making
    const work = async () => {
      const missing = await missingReferences()
      const before = version.from === null ? null : idea.versions.find(one => one.n === version.from)?.picture ?? null
      const looks = [...(kind?.references ?? []).filter(path => !missing.includes(path)), ...idea.references]
      const prompt = promptFor({
        opening: kind?.opening ?? '',
        text: idea.text,
        // What was asked before still holds; the change itself is named apart.
        changes: idea.versions.filter(one => one.n < version.n && one.state === 'done' && one.change).map(one => one.change),
        change: version.change,
        isEdit: before !== null,
        references: looks.length,
      })
      const picture = `${idea.folder}/v${version.n}.png`
      const made = await makePicture({
        command: [codex],
        prompt,
        // The picture to change comes first, then the references for the look.
        images: [...(before === null ? [] : [before]), ...looks].map(path => inProject(config.project, path)),
        to: inProject(config.project, picture),
        seconds: settings.seconds,
        onChild: (stop, dir) => Object.assign(mine, { stop, dir }),
      })
      await ideas.finish(idea.id, version.n, made.ok ? { picture, seconds: made.seconds } : { why: made.why, seconds: made.seconds })
    }
    // B446: a making that fails still ends the idea's version; the error is kept as a loop's, with the end's when that
    // fails too.
    loops.run('picture', () => work().catch(async error => {
      await ideas.finish(idea.id, version.n, { why: 'The picture could not be made.' })
        .catch(ending => { throw afterError(error, ending, 'and the end of the picture could not be written') })
      throw error
    })).finally(() => {
      if (making === mine) making = null
    })
  }

  const readState = cached(async () => {
    const raw = await readRaw()
    // The review of Pause 2: a line the person's pause holds does not grow late (store.mjs isLate, pause.mjs heldMs).
    keep.pause = raw.work?.pause ?? null
    const project = raw.project ?? config.project
    const state = buildState(raw, {
      lines: readLines(raw),
      outbox: outboxNow(store.outbox(), clock(), keep),
      runs: games.list(),
      board: { startedAt, offSince },
      seen,
      finishedSeen: finishedSeen ?? {},
      taskTimes: taskTimes.tasks,
      now: clock(),
      config: { ...config, project },
    })
    // B173: the Advisor's rounds as the clock has them, for the Advice & Chat tab.
    const rounds = { morningRound: config.morningRound, weeklyRound: config.weeklyRound, last: roundsKept, group: config.advisorSuggestions }
    // B132: whether the project has a game to run; the demo has its made-up one.
    // B273: where the board found the app's folder after the app moved it, for the note on top.
    // B406: the data files the board started without, for the note on top: a copy kept aside only while it is there
    // (the person deletes it once read).
    const shownAside = []
    for (const one of setAside) if (one.aside === null || await stat(join(HERE, 'data', one.aside)).then(() => true, () => false)) shownAside.push(one)
    return { ...state, spending: { periods: Object.fromEntries([1, 7, 30, null].map(days => [days ?? 'all', spending.summary(days)])) }, isDemo, project, rounds, name: config.name, hasGame: isDemo || hasGame, appMoved: isDemo ? null : config.appMoved ?? null, setAside: shownAside }
  }, STATE_MS)

  // B185: what the workers' transcripts gained since the last look, read on from where it stopped; the past is read
  // at the first look. Tasks a worker reported are added to the list, and the list the chats read is written anew.
  let measuring = false
  let hasList = false
  const measureTasks = async state => {
    if (measuring || typeof config.transcripts !== 'string' || workDir === null) return
    measuring = true
    try {
      // B301: a step's area and estimate as the store holds them; B468: and its effort.
      // B467: a store it cannot read fails this measuring (shown and logged); the transcripts are read on next time.
      const items = (await readStore(workDir)).items
      const stepOf = id => {
        const item = items.get(id)
        if (item === undefined) return null
        const words = [item.head.get('Title') ?? '', ...(item.sections.get('Context') ?? []), ...(item.sections.get('Touches') ?? []).map(one => `Touches: ${one}`)].join('\n')
        return { area: areaOf(words), estimateMin: minutesOf(`about ${item.head.get('Estimate') ?? ''}`), effort: effortOf(item).level }
      }
      const added = []
      const routingRecords = [...items.values()].map(item => ({ item, read: readRoutingRecord(item) }))
      // Clear after each step: the sessions cleared chats left are read on to their ends (the report's line, the last
      // minutes), for the task times and the spending, which read a lane's session only.
      const lanes = (state.spendingSubjects ?? []).map(one => one.session)
      const left = leftSubjects(chatLogs === null ? [] : await chatLogs.leftSessions(), state.movedFrom ?? [], lanes)
      const leftSpending = left.map(one => ({ session: one.session, appSession: null, name: one.name, model: null, effort: null, role: 'worker' }))
      await spending.scan([...(state.spendingSubjects ?? []), ...leftSpending], {
        assignments: routingRecords.filter(one => one.read.ok).flatMap(one => one.read.record.assignments),
        results: routingRecords.filter(one => one.item.head.get('Kind') === 'step').map(({ item, read }) => ({ id: item.head.get('Id'), title: item.head.get('Title'), accepted: item.head.get('State') === 'done', attempts: read.ok ? read.record.repair?.lifetimeAttempts ?? null : null, risk: read.ok ? read.record.contract?.risk?.class ?? null : null })),
      })
      for (const chat of state.chats) {
        if (chat.isMain || chat.isLeftover || typeof chat.session !== 'string' || !/^[\w-]+$/.test(chat.session)) continue
        const scan = taskTimes.scans[chat.session] ?? freshScan(chat.name)
        scan.worker = chat.name
        taskTimes.scans[chat.session] = scan
        added.push(...await readOn(join(config.transcripts, `${chat.session}.jsonl`), scan, stepOf))
      }
      for (const one of left) {
        const path = join(config.transcripts, `${one.session}.jsonl`)
        const scan = taskTimes.scans[one.session] ?? freshScan(one.name)
        scan.worker = one.name
        taskTimes.scans[one.session] = scan
        added.push(...await readOn(path, scan, stepOf))
        const size = await stat(path).then(file => file.size, () => null)
        if (isReadOut({ size, taskOffset: scan.offset, spendingOffset: spending.offsetOf(one.session) })) await chatLogs?.readOut(one.session)
      }
      if (added.length > 0) taskTimes.tasks = keptTasks(taskTimes.tasks, added)
      if (historyFrom === undefined) {
        await writeAtomic(TASK_TIMES_FILE, JSON.stringify(taskTimes))
        if (added.length > 0 || !hasList) await writeAtomic(TASK_LIST_FILE, listText(taskTimes.tasks, clock()))
        hasList = true
      }
      if (added.length > 0) readState.reset()
    } finally {
      measuring = false
    }
  }
  if (!isDemo && historyFrom !== undefined) {
    const measure = () => loops.run('measure', () => readState().then(measureTasks))
    measure()
    setInterval(measure, TICK_MS)
  }

  // B311: "CPU for the chats": the project's chats and what they started run at a lower priority, on fewer cores, while
  // the person plays (src/cpu.mjs). Every board but the demo and one that only shows another's history; a copy beside
  // the person's board starts at Off whatever config.json says, and applies only what was clicked on it.
  const chatSessions = async () => {
    // B467: no folder of cards is none; anything else fails this pass of the CPU loop (shown and logged). A state it
    // cannot read is a loop of its own: the chats of the cards are still limited, and a click on a level still works.
    const cards = await readdir(join(config.project, '.claude', 'chats')).catch(absentAs([]))
    const listed = (await loops.run('chat-list', () => readState()))?.chats ?? []
    return [...new Set([...sessionsOfCards(cards), ...listed.filter(chat => !chat.isLeftover && typeof chat.session === 'string').map(chat => chat.session)])]
  }
  const cpu = isDemo || historyFrom !== undefined || config.project === '' ? null : cpuLimiter({
    file: join(HERE, 'data', 'cpu.json'),
    fallback: isShowOnly ? 'off' : config.cpuLimit,
    // 2026-10-19: the PC's cores, never the board's own, which a chat that started the board may have narrowed; and the
    // board and its keeper are spared, and given Normal and all cores back at the first pass.
    cores: logicalCores(),
    sessions: chatSessions,
    // B440: the parent is the keeper only when there is one (it talks to the board); otherwise it may be a chat.
    spare: typeof process.send === 'function' ? [process.pid, process.ppid] : [process.pid],
    log: line => console.log(line),
  })
  if (cpu !== null && cpu.available) {
    const applyCpu = () => loops.run('cpu', () => cpu.apply())
    applyCpu()
    setInterval(applyCpu, Math.max(5, config.refreshSeconds) * 1000)
  }

  /** The person's words to a chat (POST /api/say), also for the board's own "resume" after Resume all. */
  let sayNow = null
  // B361: the settings panel's "Bother me" and "Approve rebuilds by itself", one change at a time.
  const SETTINGS_WHY_NOT = 'This board shows the history of another board: change its settings on that board.'
  const boardSettingsNow = () => panelSettings(config, { canSet: historyFrom === undefined, whyNot: SETTINGS_WHY_NOT })
  let settingsQueue = Promise.resolve()
  const settingsTurn = run => {
    const turn = settingsQueue.then(run, run)
    settingsQueue = turn.catch(() => {})
    return turn
  }
  // B412: the answers of the chats' work calls, kept by their request id (see `requestKeeper`).
  const requests = requestKeeper({ file: isDemo ? null : join(HERE, 'data', 'work-requests.json'), clock })
  // Clear after each step: the logs of the conversations the Workers mod clears, written by the board (src/chatLogs.mjs).
  // A log the board did not finish before it stopped is finished now; B529: by the board process that runs the loops
  // only (at its start, below; or when it gains them), so two never write the same log.
  const chatLogs = isDemo || isShowOnly || config.project === '' ? null : chatLogKeeper({
    file: join(HERE, 'data', 'chat-logs.json'), project: config.project, transcripts: config.transcripts, clock,
    failed: job => console.error(`A chat log was given up: ${job.log} (${job.why ?? 'unknown'}).`),
  })
  /** Clear after each step: the mod asks to keep the conversation before it clears a worker (`save-log`, `stepId`). */
  const saveLog = async (body, checked, state) => {
    if (chatLogs === null) return { ok: false, status: 503, why: 'This board keeps no chat logs.' }
    // B529: the journal is written by the board process that runs the loops only
    if (LOOP_LOCK !== null && !(await ownsLoops())) return { ok: false, status: 503, why: `Another board process of this project keeps the chat logs${await loopHolderPort().then(port => (port === null ? '' : ` (port ${port})`))}: try again in a moment.` }
    lastLogAt = clock()
    loggedAt.set(String(checked.chat), lastLogAt)
    const session = String(body.session ?? '').trim()
    const tail = /^[A-Za-z0-9_-]{1,120}$/.test(session) ? await readTail(join(config.transcripts, `${session}.jsonl`)) : null
    const refused = clearRefusal(state, checked.chat, tail === null ? 0 : backgroundRunning(parseTail(tail.text, tail.isCut)))
    if (refused !== null) return refused
    return chatLogs.save({ chat: checked.chat, session, step: body.stepId })
  }
  /**
   * Clear after each step: a session the state shows under no name may be a chat that went on under a new id a moment
   * ago (its card moved): the state is read anew once before the bridge refuses it.
   */
  const freshFor = new Map()
  const checkFresh = async body => {
    const state = await readState()
    const checked = checkTake(body, state)
    if (checked.ok || checked.status !== 409 || !isUnknownSession(body, state)) return { checked, state }
    // Once in a while per session: a chat the board never shows asks every few seconds, and is not read anew each time.
    const session = String(body.session)
    if (clock() - (freshFor.get(session) ?? -Infinity) < FRESH_MS) return { checked, state }
    freshFor.set(session, clock())
    for (const [one, at] of freshFor) if (clock() - at >= FRESH_MS) freshFor.delete(one)
    readState.reset()
    const fresh = await readState()
    return { checked: checkTake(body, fresh), state: fresh }
  }
  /** B297: one call of a chat's work tool, made once (B412: `requests` gives a repeat of it the same answer). */
  const bridgeWorkOnce = async (body, checked) => {
    const done = await workAction({ ...body, chat: checked.chat })
    // Partner answers (2026-10-19): the partner's answer wakes the chat that asked, as the person's answer on the page does.
    if (body?.action === 'partner-answer') await sendWakes(done)
    // B300: a free worker's pull at the end of its turn (with its turn-ended, or alone): its line goes into the outbox
    // once per step, chat and queueing (as the reconciler's delivery), and the mod takes it at once. Nothing for a chat
    // that is held by the limit or busy, as the board reads it anew now, or when the line went before.
    const pulled = !done.ok ? null : body?.action === 'pull' ? done.result : done.result.pull ?? null
    if (pulled === null || (pulled.wake ?? null) === null) return done
    readState.reset()
    const answered = await pullFor({
      dir: workDir, result: pulled, state: await readState(), outbox: store, now: clock(), maxChars: config.maxMessageChars,
      newId: () => randomBytes(8).toString('hex'), keep,
    })
    if (answered.text !== '') readState.reset()
    return { ok: true, result: body?.action === 'pull' ? answered : { ...done.result, pull: answered } }
  }
  // B142: started anew on the person's click, once the version its folder holds loads. B454: also by the board itself,
  // at a safe moment (src/selfUpdate.mjs).
  const restartNow = async () => {
    if (!canRestart) return { ok: false, status: 409, why: 'This board was started without its keeper: start it once from where it was started.' }
    // B128: a new start on a broken settings file would stop the board: this one keeps running instead.
    // B467: one Windows holds is not "not there": its own words, and the board keeps running.
    const settings = await readFile(join(HERE, 'config.json'), 'utf8').then(configProblem, error => (error?.code === 'ENOENT' ? 'it is not there' : `it cannot be read (${error?.code ?? error?.message ?? 'unknown'})`))
    if (settings !== null) return { ok: false, status: 409, why: `The settings file config.json is broken: ${settings}. Fix it first; this board keeps running.` }
    const check = await loads(join(HERE, 'server.mjs'))
    if (!check.ok) return { ok: false, status: 500, why: `The new version does not start: ${check.why}` }
    // B404: the board stops taking work and waits up to 10 s for the reconciler's pass and the running checks.
    isClosing = true
    return { ok: true, result: { at: clock() }, after: async () => {
      const inTime = await settleWithin([reconciling, ...runningChecks.values()], RESTART_WAIT_MS)
      if (!inTime) console.log('Restart: the board did not wait longer than 10 s for its running work; the next start checks again.')
      process.exit(START_ANEW)
    } }
  }
  const server = createBoard({
    token: randomBytes(32).toString('hex'),
    // B319: the demo is no project's.
    project: isDemo ? '' : home ?? '',
    getState: async () => {
      const { project, ...state } = await readState()
      const design = designState({
        ideas: ideas.all(),
        settings,
        canMake,
        why: whyNoPicture,
        busy: making === null ? null : { idea: making.idea, version: making.version, since: making.since },
        canSend: !isDemo && !isShowOnly && (state.restart?.main ?? null) !== null,
        whyNot: isDemo ? 'This is the demo: it asks nobody.' : isShowOnly ? `This board only shows. Do this on the board that delivers: http://${HOST}:${homePort}/` : 'No main chat is open to ask.',
        outbox: sentNow(),
        backlog: state.backlog,
        missing: isDemo ? [] : await missingReferences(),
        typical: typicalSeconds(),
      })
      // B256: whether the Goals part may change the map: only the board that delivers writes it.
      const goalsEdit = { canWrite: writesMap, whyNot: isDemo ? 'This is the demo: it changes no file.' : !writesMap ? `This board only shows. Change the map on the board that delivers: http://${HOST}:${homePort}/` : null }
      return { ...state, design, goalsEdit, cpu: cpu?.view() ?? null, loops: { failing: loops.failing(), line: failingLine(loops.failing(), timeOf) }, supervisor: supervisor !== null ? supervisor.view(clock()) : isDemo ? demoSupervisor(clock(), SUPERVISOR_RULES) : null, boardSettings: boardSettingsNow(), version: { commit: running, since: startedAt, ...(await versionNow()), canRestart, selfUpdate: updateShown }, mod: await modNow(),
        // B320: where the New project button suggests a new project's folder, and whether this board makes one.
        newProject: { parent: home === null ? null : dirname(home), canMake: !isDemo && !isShowOnly, isMaking: makingProject },
        // B322: what the page needs to open a new project's first chats in the Claude app: the board's folder (their
        // job texts), the project's name and the Advisor's; only the board that delivers opens chats.
        openChats: isDemo || isShowOnly ? null : { board: HERE, name: config.name, advisor: typeof config.advisor === 'string' && config.advisor !== '' ? config.advisor : null } }
    },
    // B320: a new project, from the New project button (src/newProject.mjs); one at a time, and only on the board that
    // delivers, so it is made from the version of the board the person works with.
    // B529: a board process that does not run the loops takes no write of its page: its words would wait in an outbox
    // no chat takes from. It names the page of the one that runs them.
    mayWrite: async () => {
      if (LOOP_LOCK === null || await ownsLoops()) return null
      const port = await loopHolderPort()
      return `Another board process of this project runs the loops: do this on its page${port === null ? '' : `, http://${HOST}:${port}/`}.`
    },
    newProject: async body => {
      if (isDemo) return { ok: false, status: 409, why: 'This is the demo: it makes no project.' }
      if (isShowOnly) return { ok: false, status: 409, why: `This board only shows. Make the project on the board that delivers: http://${HOST}:${homePort}/` }
      if (makingProject) return { ok: false, status: 409, why: 'A project is being made: wait until it is done.' }
      makingProject = true
      try {
        const made = await makeProject({ name: body?.name, folder: body?.folder, prefix: body?.prefix, here: HERE })
        return made.ok ? { ok: true, result: { url: made.url, project: made.project, lines: made.lines, warnings: made.warnings } } : made
      } finally {
        makingProject = false
      }
    },
    // B361: "Bother me" and "Approve rebuilds by itself" from the settings panel: into config.json, and at once into
    // the settings the board runs on. The demo changes them in memory only.
    settings: body => settingsTurn(async () => {
      const checked = checkSetting(body)
      if (!checked.ok) return checked
      if (historyFrom !== undefined) return { ok: false, status: 409, why: SETTINGS_WHY_NOT }
      if (!isDemo) {
        const file = join(HERE, 'config.json')
        // B467: only a file that is not there is "not there"; one it cannot read fails the call.
        const text = await readFile(file, 'utf8').catch(absentAs(null))
        if (text === null) return { ok: false, status: 409, why: 'The settings file config.json is not there.' }
        const changed = settingChanged(text, checked.key, checked.value)
        if (!changed.ok) return changed
        try {
          // B406: beside and in place, tried again while Windows holds the file (a virus scanner).
          await writeAtomic(file, changed.text)
        } catch (error) {
          return { ok: false, status: 500, why: `config.json not written: ${error instanceof Error ? error.message : 'unknown'}` }
        }
      }
      if (checked.key === 'routingMode') config.routing = parseRoutingPolicy({ ...(config.routing?.policy ?? {}), mode: checked.value })
      else config[checked.key] = checked.value
      readState.reset()
      return { ok: true, result: boardSettingsNow() }
    }),
    cpu: async body => (cpu === null ? { ok: false, status: 409, why: 'This board sets no CPU: it is the demo, or it shows the history of another board.' } : cpu.set(body?.level)),
    design: body => designTurn(async () => {
      const state = await readState()
      const checked = checkDesign(body, designNow(state))
      if (!checked.ok) return checked
      const now = clock()
      if (checked.action === 'make') {
        // The folders that are there already, also a copy's: a new idea gets one of its own.
        const taken = await readdir(inProject(config.project, ideasFolder(config.pictureRoots[0]))).catch(absentAs([]))
        // B156: a reference the page still names must be there: it may have gone with an idea that was not kept.
        const gone = await Promise.all(checked.references.map(path => stat(inProject(config.project, path)).then(file => !file.isFile(), () => true)))
        if (gone.some(Boolean)) return { ok: false, status: 409, why: 'A reference picture is not there any more: take it away and add it again.' }
        // B156: the references move into the idea's own folder, beside its pictures.
        const place = (paths, folder) => placeReferences(config.project, paths, folder)
        const idea = await ideas.add({ id: `i${randomBytes(6).toString('hex')}`, kind: checked.kind, text: checked.text, references: checked.references, now, taken, place })
        startPicture(idea, idea.versions[0])
        return { ok: true, result: { idea: idea.id } }
      }
      if (checked.action === 'again') {
        const version = await ideas.again(checked.idea, { change: checked.change, from: checked.from, now })
        startPicture(ideas.all().find(idea => idea.id === checked.idea), version)
        return { ok: true, result: { idea: checked.idea, version: version.n } }
      }
      if (checked.action === 'agree') await ideas.agree(checked.idea, checked.version)
      if (checked.action === 'drop') await ideas.drop(checked.idea, now)
      if (checked.action === 'send') {
        // The step is asked of the main chat in the board's own wording; the main chat writes it.
        const message = { id: randomBytes(8).toString('hex'), at: now, to: state.restart.main, ask: null, step: null, title: null, version: null, verdict: null, command: 'step', text: checked.text, state: 'waiting' }
        await store.say(message)
        // B368: a step asked without an idea has no idea to mark.
        if (checked.idea !== null) await ideas.send(checked.idea, { at: now, where: checked.where, worker: checked.worker, title: checked.title, message: message.id })
        readState.reset()
      }
      return { ok: true, result: {} }
    }),
    reference: async bytes => {
      if (!canMake) return { ok: false, status: 409, why: whyNoPicture }
      const kind = pictureKind(bytes)
      if (kind === null) return { ok: false, status: 415, why: 'That is no PNG, JPEG or WebP picture.' }
      // A name of the board's own choosing: nothing of the sender's reaches the path.
      const path = `${referencesFolder(config.pictureRoots[0])}/${randomBytes(8).toString('hex')}.${kind}`
      const file = inProject(config.project, path)
      await mkdir(dirname(file), { recursive: true })
      await writeAtomic(file, bytes)
      return { ok: true, result: { path } }
    },
    // B167: a picture pasted into Talk to Main, kept in the project's picture folder (see keepTalkPicture).
    talkPicture: async bytes => {
      if (isDemo) return { ok: false, status: 409, why: 'This is the demo: it keeps no picture.' }
      if (isShowOnly) return { ok: false, status: 409, why: `This board only shows. Send it on the board that delivers: http://${HOST}:${homePort}/` }
      if (config.project === '') return { ok: false, status: 409, why: 'This board knows no project folder to keep the picture in.' }
      const kind = pictureKind(bytes)
      if (kind === null) return { ok: false, status: 415, why: 'That is no PNG, JPEG or WebP picture.' }
      const path = await keepTalkPicture(config.project, bytes, kind, clock(), config.pictureRoots[0])
      return path === null ? { ok: false, status: 409, why: 'Too many pictures in this minute: wait a minute.' } : { ok: true, result: { path } }
    },
    say: sayNow = async body => {
      // What is answered here would never arrive: this board has no bridge.
      // Focus 2: a copy with a goal map of its own keeps the words of its brainstorms in its own outbox.
      const isOwnTalk = writesMap && typeof body?.command === 'string' && body.command.startsWith('brainstorm')
      if (isShowOnly && !isOwnTalk) return { ok: false, status: 409, why: `This board only shows. Answer on the board that delivers: http://${HOST}:${homePort}/` }
      // The person's "Dismiss" on the restart banner's copied word: kept on that word in the outbox.
      if (body?.command === 'dismiss copied') return dismissCopied(store, body.id, clock())
      // B465: "Out of sync?" runs the board's own list at once (its answer stands on the page); the main chat's check,
      // for what the list does not know, gets that answer with the rest, and the board as it stands after the fixes.
      // Null when another board process runs the project's list (B482), or the run failed (recorded as "sync").
      // The supervisor: "Check now" in a worker's menu names that worker as what the check is about.
      const subject = typeof body?.chat === 'string' && body.chat !== 'board' ? body.chat.slice(0, 80) : null
      const syncAnswer = body?.command === 'sync' && supervisor !== null ? await supervisor.run({ asked: true, subject }) : null
      if (syncAnswer !== null) readState.reset()
      const state = await readState()
      const checked = checkSay(body, syncAnswer === null ? state : { ...state, syncList: syncAnswer }, config.maxMessageChars)
      if (!checked.ok) return checked
      // B167: the picture is named to the main chat by where it is, so it has to be there.
      if (typeof checked.message.picture === 'string' && !(await stat(inProject(config.project, checked.message.picture)).then(file => file.isFile(), () => false))) {
        return { ok: false, status: 409, why: 'That picture is not there any more: paste it again.' }
      }
      // B258: so are the pictures of an ask from the goal map, each.
      for (const path of checked.message.pictures ?? []) {
        if (!(await stat(inProject(config.project, path)).then(file => file.isFile(), () => false))) return { ok: false, status: 409, why: 'A picture of the ask is not there any more: paste it again.' }
      }
      // B212: without a Workers mod nothing takes the board's words: they are kept as copied, and the page puts them on
      // the clipboard for the person to paste into the chat, marked as typed on the board.
      const isCopied = state.bridge?.isMissing === true
      // B285: a queue ask for a step that is not refined yet waits on the board until it is (refineGate.mjs).
      // B288: the words of a re-check of the goals name the board's folder and the project's settings. A second ask
      // made before the first was written down (a double click) finds the first in the store and is refused.
      const isRound = message => message.to === checked.message.to && (message.command === 'round' || message.command === 'recheck') && (message.state === 'waiting' || message.state === 'taken')
      if (checked.message.command === 'recheck' && store.outbox().some(isRound)) return { ok: false, status: 409, why: 'A round runs: wait until the Advisor has finished it.' }
      const words = checked.message.command === 'recheck' ? { text: recheckText({ board: HERE, config }) } : {}
      let message = { id: randomBytes(8).toString('hex'), at: clock(), ...checked.message, ...words, state: isCopied ? 'copied' : checked.message.held === true ? 'held' : 'waiting' }
      // B110: the approval of a step whose work is merged is the board's own to tick: no chat is woken for it.
      const ticked = await settle(message, state)
      if (ticked !== null) {
        readState.reset()
        return ticked
      }
      // B298: a line to a chat is filed as an instruction first and carries its id.
      message = await withInstruction(message, body => workAction(body, 'person'))
      // B315: the words as they were copied are kept with them, so the restart banner can copy them again and tell when
      // the main chat has them.
      if (isCopied) message = { ...message, pasteText: messageText(message, timeOf, path => inProject(config.project, path)) }
      await store.say(message)
      if (isCopied) {
        readState.reset()
        const paste = { text: message.pasteText, chat: `${state.chatPrefix ?? ''}${message.to}` }
        return { ok: true, message: { ...message, paste } }
      }
      // Sent to a chat that is not running: the main chat is asked to start it, so nothing waits without a word.
      const wake = message.state === 'held' ? null : wakeFor(message, state, store.outbox(), clock(), config.maxMessageChars)
      if (wake !== null) await store.say({ id: randomBytes(8).toString('hex'), at: clock(), ...wake, state: 'waiting' })
      // What was sent shows at once.
      readState.reset()
      return { ok: true, message }
    },
    gameFile: (path, alt) => findGameFile(config, path, alt),
    picture: async path => {
      const { project } = await readState()
      const found = await findPicture(project, shownRoots(config), path)
      return found === null ? null : { type: found.type, body: await readFile(found.file) }
    },
    // B221: the person closes or deletes a step on the Backlog tab, through the work API (the store, then its view).
    // B285: the state is read anew after a change, so an ask made next (Send answers · refine again) knows the block.
    backlog: async body => {
      const done = await editStep(body, { now: clock(), work: workWriters })
      work.reset?.()
      readState.reset()
      return done
    },
    // B256: the person changes the goal map on the Goals part. Only the board that delivers writes it; then the state
    // is read anew, so the page draws the file as it now is: also after a refusal, often a change made elsewhere.
    goals: async body => {
      if ([...FOCUS_MOVES, ...FOCUS_DRAFTS].includes(body?.command)) return focusNow(body)
      if (body?.command === 'note-undo') return undoNow(body)
      // B383: the Goals page's right panel: a Missing line (or all of them) made into a new step under the goal.
      if (body?.command === 'missing-add') {
        if (!writesMap || workWriters === null) return { ok: false, status: 403, why: 'This board only shows: add steps on the board that delivers.' }
        const goalsAt = { file: projectFile(config, 'goals'), historyDir: projectFile(config, 'goalsHistory'), now: clock() }
        // B467: a store or map it cannot read fails the call, never a step made under no activity or from no map.
        const store = await readStore(workDir)
        const done = await missingToSteps({ id: body.id, index: body.index, line: typeof body.line === 'string' ? body.line : undefined, all: body.all === true }, {
          readMap: () => readFile(goalsAt.file, 'utf8').catch(absentAs('')),
          makeStep: step => workAction(step, 'person'),
          changeMap: change => changeGoalsFile(change, goalsAt),
          activity: goal => activityFor(goal, store?.items, store?.activities),
        })
        readState.reset()
        return done
      }
      // B358: a goal ticked on the Goals part gets its re-check by the partner first, while a partner is on the board.
      if (body?.command === 'state' && body?.state === 'done' && ((await readState()).advisor ?? null) !== null) return focusNow({ command: 'goal-done', id: body.id, overturn: body.overturn === true })
      const done = await editGoals(body, {
        canWrite: writesMap,
        file: projectFile(config, 'goals'),
        historyDir: projectFile(config, 'goalsHistory'),
        now: clock(),
      })
      readState.reset()
      return done
    },
    // B259: the person's brainstorm on the Brainstorm part: its thread, and on Create the goal map. Only the board that
    // delivers writes; then the state is read anew.
    brainstorm: async body => {
      const done = await editThread(body, {
        canWrite: writesMap,
        dir: projectFile(config, 'brainstorms'),
        folder: config.brainstorms,
        goalsFile: projectFile(config, 'goals'),
        historyDir: projectFile(config, 'goalsHistory'),
        now: clock(),
      })
      readState.reset()
      return done
    },
    onError: error => loops.failed('request', error),
    onAnswered: () => loops.succeeded('request'),
    isClosing: () => isClosing,
    restart: restartNow,
    // The page's own version goes into the page, so it can tell when the folder holds a newer one.
    pageVersion: async () => {
      const { page } = await versionNow()
      return typeof page === 'string' && /^[0-9a-f]{4,40}$/.test(page) ? page : ''
    },
    bridgeKey,
    // B297: the page's actions on the work store, as the person. B299: an answer to an ask wakes the chat that asked.
    work: async body => {
      // Focus 3, the review: the person's Undo goes the one way that types the word before it marks the line.
      if (body?.action === 'undo') return undoNow({ note: body.id, line: body.line })
      // B360, the review: an Overturn of a goal's recap opens the goal first; the recap closes only once it is open.
      if (body?.action === 'overturn') {
        const opened = await openOverturnedGoal(body)
        if (opened !== null && !opened.ok) return opened
      }
      const done = await workAction(body, 'person')
      // Pause and resume (spec 2026-10-18): after Resume all the board types "resume" into the main chat when it runs;
      // when it does not, the banner opens it, and its Workers mod reads the resume from pause.json.
      if (done.ok && body?.action === 'resume-all' && !isShowOnly) {
        const state = await readState()
        const main = resumeTypeTo(state)
        const typed = main === null ? null : await sayNow({ to: main, command: 'resume' })
        return { ok: true, result: { ...done.result, typed: typed?.ok === true } }
      }
      // Focus 3, the review: and the owner of the step the answer frees, when another chat asked (`wakeOwner`).
      const paste = await sendWakes(done)
      if (paste !== null) return { ok: true, result: { ...done.result, paste } }
      return done
    },
    // B297: a chat's work tool: only the chat the board shows under that name, with its session, as for taking.
    bridgeWork: counted(async body => {
      // B412: a call the mod repeats with its request id (its answer was slow or cut off) gets the first answer, before
      // anything else is looked at: right after a restart the board may not show the chat yet. The id is the session's.
      const { request, ...asked } = body ?? {}
      const session = String(body?.session ?? '')
      const kept = await requests.known(session, request)
      if (kept !== undefined) return kept
      const { checked, state } = await checkFresh(body)
      noteRefused(body, checked)
      if (!checked.ok) return checked
      if (asked.action === 'save-log') return requests.answer(session, request, () => saveLog(asked, checked, state))
      if (isReadAction(asked.action)) return bridgeWorkOnce(asked, checked)
      return requests.answer(session, request, () => bridgeWorkOnce(asked, checked))
    }),
    take: counted(async body => {
      const { checked } = await checkFresh(body)
      // Who asks runs, also a chat the board shows another session for.
      if (seen !== null && typeof body?.chat === 'string' && (checked.ok || checked.status === 409)) (checked.ok ? seen.shown : seen.other)[body.chat.trim().slice(0, 80)] = clock()
      noteRefused(body, checked)
      if (!checked.ok) return checked
      // The review of Pause 2: while the person pauses no chat takes what would start a turn; only the board's own
      // "resume" to the main chat goes. The rest waits in the outbox, held until the resume (2026-10-19: Resume all, no
      // longer running: while resuming every line goes, so an answer to a chat that has not started reaches it).
      const only = isHolding((await readState()).pause) ? message => message.command === 'resume' : undefined
      // B532: what no longer matters is closed first, so a chat is never handed a word whose purpose is gone.
      await sweepOutbox({ dir: workDir, outbox: store, state: await readState(), now: clock(), keep, to: checked.chat }).catch(error => console.error(`The outbox sweep failed: ${error.message}`))
      const taken = await store.take(checked.chat, clock(), keep, only)
      // What was taken shows as on its way at once.
      if (taken.length > 0) readState.reset()
      return { ok: true, result: { messages: taken.map(message => ({ id: message.id, text: messageText(message, timeOf, path => inProject(config.project, path)) })) } }
    }),
    typed: counted(async body => {
      const checked = checkTyped(body, await readState())
      if (!checked.ok) return checked
      if (await store.settle(checked.chat, checked, clock()) > 0) readState.reset()
      return { ok: true, result: {} }
    }),
    game: async body => {
      const checked = checkGame(body, await readState())
      if (!checked.ok) return checked
      if (isDemo) return { ok: false, status: 409, why: 'This is the demo: it starts no game.' }
      // B197: how the game starts is the project's to say.
      if (checked.action === 'start' && config.runGame.length === 0) return { ok: false, status: 409, why: 'The board\'s settings name no command that starts the game ("runGame"): examples/config.json has one for a Vite game.' }
      if (checked.action === 'stop') {
        games.stop(checked.path)
        readState.reset()
        return { ok: true, result: { url: null } }
      }
      try {
        // A folder keeps its port from one start to the next, so the game finds what it saved in the browser.
        const place = ((await folders()) ?? []).findIndex(folder => pathKey(folder.path) === pathKey(checked.path))
        // B319: inside its project's range, which no other project's board uses.
        const url = await games.start({ path: checked.path, port: config.gamePort + (Math.max(0, place) % GAME_SPAN) })
        readState.reset()
        return { ok: true, result: { url } }
      } catch (error) {
        // The reason is the board's own, or the last line of the game's own tools: never words from a chat.
        return { ok: false, status: 502, why: error instanceof Error ? error.message : 'The game did not start.' }
      }
    },
  })

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0))
  process.on('exit', () => {
    games.stopAll()
    // A picture that is being made ends with the board, and its folder under the temporary folder goes with it.
    making?.stop()
    if (typeof making?.dir === 'string' && making.dir.includes('worker-board-design-')) rmSync(making.dir, { recursive: true, force: true })
  })

  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${config.port} is in use: the board may be running already.`
      : `The board could not start (${error.code ?? 'unknown error'}).`)
    process.exit(1)
  })
  // Where the mod finds the board. The file goes when the board does, so no chat asks a board that is gone.
  const noteFile = join(config.project, '.claude', 'board.json')
  process.on('exit', () => {
    try {
      if (bridgeKey !== null && JSON.parse(readFileSync(noteFile, 'utf8')).key === bridgeKey) rmSync(noteFile)
    } catch {
      // Not there, or another board's by now.
    }
  })
  /**
   * True when the file names another board that still delivers: it takes the key the file holds. The chats are
   * that board's, and stay so. A board that is gone, or one that was started anew and only shows, has let go.
   */
  async function isTaken() {
    try {
      const note = JSON.parse(await readFile(noteFile, 'utf8'))
      const other = new URL(note.url)
      if (other.hostname !== HOST || Number(other.port) === config.port) return false
      const answer = await fetch(new URL('/api/bridge/take', other), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Board-Key': String(note.key) },
        body: '{}',
        signal: AbortSignal.timeout(1500),
      })
      return answer.status !== 403 && answer.status !== 404
    } catch {
      return false
    }
  }
  /** Writes where the mod finds this board, unless another board still delivers. */
  async function claimBridge() {
    if (bridgeKey === null || config.project === '') return
    if (await isTaken()) {
      console.error('Another worker board already delivers to the chats (.claude/board.json): answers given on this one will not arrive.')
      return
    }
    await mkdir(join(config.project, '.claude'), { recursive: true })
      .then(() => writeAtomic(noteFile, bridgeNote({ port: config.port, key: bridgeKey, at: clock() })))
      .catch(error => {
        // B467: shown on the page too, until the board starts again: the chats cannot find it.
        loops.failed('bridge-note', error)
        console.error('The board could not write .claude/board.json: answers will not reach the chats.')
      })
  }
  // B488: this process gains the loops when the one that ran them ended: it reads again what that one wrote (the
  // outbox and the notes of what was sent and seen), so it sends nothing twice and writes no old state over a new
  // one, and the mod finds it at once.
  // B529: and the journal of the chat logs, whose open logs it finishes (a holder that died left them).
  gainedLoops = async () => {
    await store.reload?.()
    finishedSeen = await kept(FINISHED_FILE)
    roundsKept = await kept(ROUNDS_FILE)
    refineKept = await kept(REFINE_FILE)
    taskTimes = await kept(TASK_TIMES_FILE) ?? taskTimes
    await spending.load()
    readState.reset()
    if (chatLogs !== null) {
      await chatLogs.reload()
      void chatLogs.resume().catch(error => loops.failed('chat-logs', error))
    }
    await claimBridge()
  }
  server.listen(config.port, HOST, async () => {
    // B529: the loops' first owner finishes the open chat logs; one that gains the loops later does it then.
    const owns = await ownsLoops()
    if (owns) void chatLogs?.resume().catch(error => loops.failed('chat-logs', error))
    if (bridgeKey !== null && config.project !== '') {
      if (owns) await claimBridge()
      else console.error('Another board process of this project runs the loops (.claude/sync-loop.json): this one shows the page and reads.')
    }
    // B319: listening, it keeps its port and games' range for its project in the PC's list of boards.
    if (isHome && historyFrom === undefined) await register().catch(error => console.error(`The list of boards could not be written: ${error.message}`))
    console.log(`Worker board: http://${HOST}:${config.port}/${isDemo ? '  (demo data)' : historyFrom === undefined ? '' : '  (shows another board\'s history, records none)'}`)
    if (chosen.why === 'moved') console.log(`  Port ${homePort} belongs to the board of ${chosen.holder ?? 'another program'}: this project's board has ${config.port}, its games ${config.gamePort} up.`)
    else if (chosen.why === 'kept') console.log(`  Port ${config.port} is this project's own in the PC's list of boards (${boards}); config.json asks for ${homePort}.`)
    // B135: which of the Claude app's folders it reads, found by itself or set.
    if (!isDemo) console.log(`  The Claude app's chats: ${config.appSessions || '(none found: set "appSessions")'}${typeof config.appFolder === 'string' ? ' (found by itself)' : ''}`)
    if (chosen.why === 'own' || chosen.why === 'new') console.log(`  Port ${config.port} is this folder's own (data/port.json); the board in the main folder has ${homePort}.`)
  })

  // B454: a new server version is started by the board itself at a safe moment; until then the page says what it waits for,
  // and after 10 minutes without one the note on top asks for the person's click as before (B142).
  if (!isDemo && canRestart) {
    const lookAtUpdate = () => loops.run('self-update', async () => {
      if (isClosing) return
      const version = await versionNow()
      const state = await readState()
      const blockers = blockersOf({
        now: clock(), outbox: store.outbox(), checks: runningChecks.size, isReconciling: reconciling !== null,
        logs: chatLogs === null ? 0 : (await chatLogs.pending()).length, calls: callsNow, lastLogAt, isPaused: isHolding(state.pause),
        reported: reportedNotLogged({ items: itemsOf(await work()), now: clock(), loggedAt }),
      })
      const seen = selfUpdate.look({ isNewer: version.isServerNewer === true, canRestart, blockers })
      updateShown = seen.shown
      if (!seen.restart) return
      const done = await restartNow()
      if (!done.ok) {
        selfUpdate.refused(done.why)
        updateShown = selfUpdate.look({ isNewer: true, canRestart, blockers: ['the new version'] }).shown
        return
      }
      console.log('Restart: the new version of the board starts by itself.')
      done.after?.()
    })
    setInterval(lookAtUpdate, 3000)
  }

  if (!isDemo && historyFrom === undefined) {
    const look = () => isClosing ? Promise.resolve() : loops.run('look', () => ownsLoops().then(async owns => {
      // B488: a board process that does not run the loops reads what the one that does has written, and shows it.
      if (!owns) {
        await store.reload?.()
        readState.reset()
        return
      }
      const state = await readState()
      await tick(store, state, clock())
      // B446: a loop of its own: its failure shows and is logged, and the look goes on.
      await loops.run('measure', () => measureTasks(state))
      // B155: the steps it sees ticked for the first time, with when. B301: only from a store it can read, and with
      // the store's own time of each step's move to done.
      const next = seenFromState(finishedSeen, state, clock())
      if (next !== finishedSeen) {
        await writeAtomic(FINISHED_FILE, JSON.stringify(next))
        finishedSeen = next
      }
      // B173: the Advisor's rounds, typed into its chat on the board's clock. Only the board that delivers, and only
      // while there is an Advisor; a chat that is not running is started through the main chat, as for a message.
      // B288: not while a round runs (one the person asked for a moment ago): the clock's comes at a later look.
      if (bridgeKey !== null && (state.advisor ?? null) !== null && state.advisor.roundRuns !== true) {
        const now = clock()
        const week = state.limits?.week ?? null
        const next = roundsNow({
          now, kept: roundsKept, morningRound: config.morningRound, weeklyRound: config.weeklyRound, skipPercent: config.morningSkipPercent,
          weekReset: week?.resetsAt ?? week?.resetAt ?? null, fiveHour: state.limits?.fiveHour?.used ?? null,
        })
        if (next.round !== null) {
          const message = { id: randomBytes(8).toString('hex'), at: now, to: state.advisor.name, ask: null, step: null, title: null, version: null, verdict: null, command: 'round', round: next.round, text: roundText(next.round, { board: HERE, config, focus: state.focus ?? null }), state: 'waiting' }
          await store.say(message)
          const wake = wakeFor({ ...message, command: null }, state, store.outbox(), now, config.maxMessageChars)
          if (wake !== null) await store.say({ id: randomBytes(8).toString('hex'), at: now, ...wake, state: 'waiting' })
          readState.reset()
        }
        if (JSON.stringify(next.kept) !== JSON.stringify(roundsKept)) {
          await writeAtomic(ROUNDS_FILE, JSON.stringify(next.kept))
          roundsKept = next.kept
        }
      }
      // B285: steps are refined before they go into a queue. The board sends a step to the Advisor by itself, one at a
      // time; lets a held queue ask go to the main chat once its step is refined; and tells the main chat when a step it
      // queued unrefined is refined. Only the board that delivers.
      if (bridgeKey !== null && state.bridge?.isMissing !== true) {
        const now = clock()
        const begun = firstLook(refineKept, state)
        const due = begun === null ? { release: [], drop: [], refine: null, notice: null, kept: null } : refineWhenDue(state, sentNow(), begun, now)
        if (due.kept !== null && JSON.stringify(due.kept) !== JSON.stringify(refineKept)) {
          await writeAtomic(REFINE_FILE, JSON.stringify(due.kept))
          refineKept = due.kept
        }
        for (const id of due.release) await store.update(id, { state: 'waiting', at: now, releasedAt: now })
        for (const id of due.drop) await store.update(id, { state: 'dropped' })
        for (const words of [due.refine, due.notice]) {
          if (words === null) continue
          const message = { id: randomBytes(8).toString('hex'), at: now, ...words, state: 'waiting' }
          await store.say(message)
          const wake = wakeFor(message, state, store.outbox(), now, config.maxMessageChars)
          if (wake !== null) await store.say({ id: randomBytes(8).toString('hex'), at: now, ...wake, state: 'waiting' })
        }
        if (due.release.length + due.drop.length > 0 || due.refine !== null || due.notice !== null) readState.reset()
      }
      // Words that wait for a chat that is not running, sent while the main chat did not run either, are followed by
      // the word to start it once the main chat runs (say.mjs wakesDue). Only the board that delivers.
      if (bridgeKey !== null && state.bridge?.isMissing !== true) {
        const now = clock()
        const starts = wakesDue(state, sentNow(), now, config.maxMessageChars)
        for (const start of starts) await store.say({ id: randomBytes(8).toString('hex'), at: now, ...start, state: 'waiting' })
        if (starts.length > 0) readState.reset()
      }
      // B491: the open brainstorm question whose title the board refuses (over 12 words, or none) goes back to the
      // Advisor at once, once for each wording. Only the board that delivers, and only while there is an Advisor.
      if (bridgeKey !== null && (state.advisor ?? null) !== null) {
        const now = clock()
        for (const words of fixesToTell(state.brainstorms?.threads, store.outbox(), state.advisor)) {
          const message = { id: randomBytes(8).toString('hex'), at: now, ...words, state: 'waiting' }
          await store.say(message)
          const wake = wakeFor(message, state, store.outbox(), now, config.maxMessageChars)
          if (wake !== null) await store.say({ id: randomBytes(8).toString('hex'), at: now, ...wake, state: 'waiting' })
          readState.reset()
        }
      }
      // B124: the main chat alone in the list is asked for workers, once. Only the board that delivers asks.
      const ask = bridgeKey === null ? null : spawnWhenAlone(state, store.outbox(), store.lines())
      if (ask !== null) {
        await store.say({ id: randomBytes(8).toString('hex'), at: clock(), ...ask, state: 'waiting' })
        readState.reset()
      }
    }))
    look()
    setInterval(look, TICK_MS)
  }

  // B300: the reconciler at every refresh: the server's moves through the work API, and
  // each chat's line that a step is its own, once (src/work/deliver.mjs). Only a board that writes the store: the one
  // that delivers, or a copy with a store of its own (whose outbox no chat takes from).
  if (!isDemo && historyFrom === undefined && workWriters !== null) {
    let isReconciling = false
    /** The review of Pause 2: the main chats the board typed "resume" into by itself, per resume (its since). */
    const retyped = new Set()
    const reconcileNow = async () => {
      if (isReconciling || isClosing) return
      isReconciling = true
      let finish = () => {}
      reconciling = new Promise(done => { finish = done })
      try {
        // B488: only the board process that runs the loops reconciles (a refused one leaves it to the next refresh)
        if (!(await ownsLoops())) return
        const state = await readState()
        // B313: a chat renamed (its session under another name) takes its open items along, once.
        const renamed = await followRenames({
          dir: workDir, chats: [...(state.chats ?? []), ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : [])].map(chat => ({ session: chat.session, name: chat.name })),
          apply: body => workAction(body, 'server'), now: clock(), prefix: state.chatPrefix ?? '',
        })
        if (renamed.moved.length > 0) {
          work.reset?.()
          readState.reset()
        }
        // Pause and resume (spec 2026-10-18): once every chat holding a step has started a turn since Resume all, the
        // board sets running, and the banner goes. 2026-10-19: or 20 minutes after Resume all, whichever is first; the
        // banner then names for an hour who did not start, as information.
        if (resumeEnds(state.pause, clock())) {
          const set = await workAction({ action: 'resumed' }, 'server')
          if (set.ok && set.result.changed !== false) readState.reset()
        }
        // The review of Pause 2: after "Open <main>" its process runs while resuming and it has done nothing: the board
        // types "resume" into it now, once (the bridge is there then; the state's `typedAt` says it went).
        const retype = isShowOnly ? null : resumeRetypeTo(state)
        if (retype !== null && sayNow !== null && !retyped.has(`${retype} ${state.pause.since}`)) {
          retyped.add(`${retype} ${state.pause.since}`)
          const typed = await sayNow({ to: retype, command: 'resume' })
          if (typed?.ok === true) readState.reset()
        }
        // B360: a recap left alone for its 24 hours approves itself and moves to the closed items. B404: on its own, so
        // an odd recap that makes it throw stops no delivery.
        await loops.run('approve-recaps', async () => {
          const approved = await workAction({ action: 'approve-recaps' }, 'server')
          if (!approved.ok) throw new Error(approved.why ?? 'approve-recaps was refused')
        })
        // The supervisor (spec 2026-10-24): an incident whose fix step is done is fixed; one whose fix was dropped, open again.
        // Only while the supervisor's view holds one being fixed: each work call reads the whole store.
        if (supervisor !== null && supervisor.view(clock()).incidents.some(one => one.state === 'fix')) {
          await loops.run('incidents-fixed', async () => {
            const fixed = await workAction({ action: 'incidents-fixed' }, 'server')
            if (!fixed.ok) throw new Error(fixed.why ?? 'incidents-fixed was refused')
          })
        }
        const done = await deliverWork({
          state, dir: workDir, outbox: store, apply: body => workAction(body, 'server'), now: clock(), maxChars: config.maxMessageChars,
          newId: () => randomBytes(8).toString('hex'), keep,
        })
        if (done.moved.length + done.sent.length + done.withdrawn.length + done.closed.length > 0) {
          work.reset?.()
          readState.reset()
        }
        loops.succeeded('reconcile')
        // B528: an evaluation that has not ended is asked of the partner again; on its own, so a failure stops no delivery.
        await loops.run('evaluate-again', () => evaluateAgainNow(state))
        // B404: a step that has stood on "check pending" for more than 2 minutes (a restart right after a report ended
        // its check) is checked again; the checks that run now are skipped.
        await loops.run('stuck-checks', async () => {
          const stuck = await workAction({ action: 'recheck-stuck', skip: [...runningChecks.keys()] }, 'server')
          if (!stuck.ok) throw new Error(stuck.why ?? 'recheck-stuck was refused')
          for (const check of stuck.result.checks ?? []) void runCheck(check)
        })
      } catch (error) {
        // Tried again at the next refresh; B404: recorded, so the page shows a delivery that keeps failing.
        loops.failed('reconcile', error)
      } finally {
        isReconciling = false
        reconciling = null
        finish()
      }
    }
    setInterval(reconcileNow, Math.max(5, config.refreshSeconds) * 1000)

    // The supervisor (spec 2026-10-24), with B465's list of stuck states: every few minutes and on "Out of sync?", the
    // safe fixes it makes itself (through the work API as the board, and its lines once per finding), the rest to the
    // main chat in one note, never twice for the same thing (the project's .claude/sync.json keeps what it was told).
    // Not on a copy beside the person's board.
    if (!isShowOnly) {
      // B482, the review: kept with the project, beside the loop's lock, so every board of it reads the same
      const SYNC_FILE = join(config.project, '.claude', 'sync.json')
      // The supervisor's own memory (its watch, the day's repairs, the rules' trips), beside sync.json and apart from it
      const SUPERVISOR_FILE = join(config.project, '.claude', 'supervisor.json')
      supervisor = createSupervisor({
        state: () => readState(),
        items: async () => (await readStore(workDir)).items,
        outbox: () => store.outbox(),
        refused: () => [...refusedNames.values()],
        apply: async body => {
          const done = await workAction(body, 'server')
          if (done.ok && done.result?.changed !== false) {
            work.reset?.()
            readState.reset()
          }
          return done
        },
        wake: async ({ chat, id, text, key }) => sendOnce({
          dir: workDir, key: `sync ${key}`, words: { ...workWords(chat, id, text), kind: 'sync', syncKey: key }, outbox: store, state: await readState(),
          now: clock(), maxChars: config.maxMessageChars, newId: () => randomBytes(8).toString('hex'), keep,
        }),
        // Worktree clean-up (2026-10-24): the leftover worktrees of the repositories the board knows, and the empty
        // folders they left in the project folder; the safe ones removed, never a main checkout nor the board's folder.
        leftovers: ({ items, now }) => findLeftovers({
          repos: knownRepos(), project: config.project, items, run: gitRunner(), now,
          keep: [HERE, config.project, ...(hasGame ? [config.gameRepo] : [])],
        }),
        clean: one => cleanLeftover(one),
        // B482: what the main chat was told and since when a wait was seen, kept over a restart
        noted: {
          load: async () => {
            // (the board's own data/sync.json, from before B482's review, until the project's is written)
            const value = (await kept(SYNC_FILE)) ?? (await kept(join(HERE, 'data', 'sync.json')))
            return {
              noted: Array.isArray(value?.noted) ? value.noted.filter(key => typeof key === 'string') : [],
              seen: value?.seen !== null && typeof value?.seen === 'object' ? value.seen : {},
            }
          },
          save: state => writeAtomic(SYNC_FILE, JSON.stringify(state)),
        },
        memory: {
          load: () => kept(SUPERVISOR_FILE),
          save: value => writeAtomic(SUPERVISOR_FILE, JSON.stringify(value)),
        },
        // The Workers mod installed; the version each chat runs is not reported by the mod yet (none known: no finding)
        mods: async () => ({ installed: (await modNow())?.installed ?? null, chats: {} }),
        now: clock,
        // B482, B488: the list runs where the loops run (ownsLoops, above); a board without the lock runs it as its own
        owns: ownsLoops,
        loops,
        closing: () => isClosing,
        settings: config,
      })
      supervisor.start()
    }
  }
}

/**
 * B142: what was started keeps the board. It runs the board as its child, with a channel, and starts it anew when the
 * board ends asking for that; stopping it stops the board. `--launch-entry` writes a file and ends: it needs none.
 */
function keepBoard(args) {
  const keeper = keep({
    start: key => spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...args], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, WORKER_BOARD_CHILD: '1', ...(key === null ? {} : { WORKER_BOARD_KEY: key }) },
      windowsHide: true,
    }),
    done: code => process.exit(code),
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      keeper.stop()
      process.exit(0)
    })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (process.env.WORKER_BOARD_CHILD === '1' || args.includes('--launch-entry')) await main(args)
  else keepBoard(args)
}
