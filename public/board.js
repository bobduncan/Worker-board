// The worker board's page, second design: an Overview (one lane per worker, the inbox "For you", today's
// timeline) and Advice & Chat. It asks the server for the state and redraws. Everything from a chat, the backlog
// or the advice file is put on the page as text (textContent), never as HTML, so words in a transcript can never
// become part of the page's code.

'use strict'

const TOKEN = document.querySelector('meta[name="board-token"]').content
/** B142: the version of the page as it was loaded; empty when the board did not say it. */
const PAGE = (document.querySelector('meta[name="board-page"]')?.content ?? '').replace(/^\{\{page\}\}$/, '')
const STATES = { working: 'Working', waiting: 'Waiting for you', free: 'Free', unknown: 'Unknown', interrupted: 'Interrupted', suspended: 'Suspended', off: 'Not running' }
/** How often the page asks again while the board does not answer. */
const AWAY_MS = 5000
const KINDS = {
  input: { sign: '?', tag: 'Input needed' },
  verify: { sign: '✓', tag: 'Verification needed' },
  intervene: { sign: '!', tag: 'Intervention needed' },
  do: { sign: '→', tag: 'Only you can do' },
  // B301: a chat wrote questions in its chat but filed no ask: a warning, with the way to its chat.
  unfiled: { sign: '!', tag: 'No ask filed' },
  // B308: a worker holds a step, is not working and asked nothing: a hint, with the way to its answer.
  idle: { sign: '!', tag: 'May wait for you' },
  // B541: chats on an older Workers mod than the one installed: the one way to bring them up to date.
  'old-mod': { sign: '!', tag: 'Restart to update' },
}
/** What a step in the backlog says it asks of the person. */
const ASKS = { verify: 'Verify', decide: 'Decide', provide: 'Provide', do: 'Do' }
const MIN = 60_000
const HOUR = 60 * MIN
const LONG_CHARS = 700
const UNDELIVERED = 'What you send is typed into the advisor\'s chat as your own words, within seconds when that chat is open.'

const $ = id => document.getElementById(id)

// What the person did on the page and a redraw must not undo.
const openLanes = new Set()
const openBubbles = new Set()
const drafts = new Map()
// B524: what a reload kept (see `reloadPage`) is read here and put back once, by the first `draw`.
const KEPT_KEY = 'kept-state'
let keptText = null
let kept = null
try {
  keptText = sessionStorage.getItem(KEPT_KEY)
  kept = keptBack(keptText)
  sessionStorage.removeItem(KEPT_KEY)
} catch { /* no sessionStorage: nothing was kept */ }
/** The boxes `restoreKept` filled: told about it after the first draw, so what listens to them reads the words. */
let restoredBoxes = []
const chosen = new Map()
const problems = new Map()
const sending = new Set()
/** B364: the pause panel's Details stay open across redraws once opened. */
let isPauseDetailsOpen = false
const openForms = new Set()
/** The requests whose game is being started. */
const starting = new Set()
const pictures = new Map()
const drawn = {}
let board = null
let timer = null
/** When the board stopped answering; null while it answers. */
let awaySince = null
/** True while the person is asked whether they really want to pause all chats. */
let isAskingPause = false

// Small helpers

function el(tag, className = '', text = null) {
  const node = document.createElement(tag)
  if (className !== '') node.className = className
  if (text !== null) node.textContent = text
  return node
}

function fill(parent, children) {
  parent.replaceChildren(...children.filter(child => child !== null))
  return parent
}

/** Redraws a part of the page only when what it shows has changed, so typing and scrolling are left alone. */
function once(key, data, draw) {
  const signature = JSON.stringify(data)
  if (drawn[key] === signature) return
  drawn[key] = signature
  draw()
}

// times:start
const pad = value => String(value).padStart(2, '0')

function clock(ms) {
  const date = new Date(ms)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A length of time: "40 min", "1 h 50". */
function span(ms) {
  const minutes = Math.round(ms / MIN)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${pad(minutes % 60)}`
}

const ago = (ms, now) => (now - ms < MIN ? 'just now' : `${span(now - ms)} ago`)
// times:end

/** A time that keeps counting between redraws: `data-at` is read again at every look. */
function since(at, now) {
  const node = el('time', '', at === null ? '' : ago(at, now))
  if (at !== null) node.dataset.at = String(at)
  return node
}

const ICONS = {
  game: 'M7 8h10a4 4 0 0 1 3.9 3.1l1 4.5a2.8 2.8 0 0 1-4.7 2.6L15 16H9l-2.2 2.2a2.8 2.8 0 0 1-4.7-2.6l1-4.5A4 4 0 0 1 7 8zM6 12h4M8 10v4M16 11h.01M18 13h.01',
  website: 'M3 7h18M7 5h.01M10 5h.01M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 11h10M7 15h6',
  app: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM10 5h4M12 18h.01',
  other: 'M9 3H3v6h6V3zM21 3h-6v6h6V3zM9 15H3v6h6v-6zM18 15v6M15 18h6',
  // B280: the Advisor, set apart from the workers.
  advisor: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1.26A7 7 0 0 0 12 2z',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.5M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5M20 20v-4h-4',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  // B159: a worker (a chat, whatever it works on) and a queue.
  chat: 'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01',
  list: 'M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01',
  // Focus 1: the person, beside their words in the talk with the partner.
  person: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  // The supervisor (spec 2026-10-24): "Check now" and its section, a wrench.
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', width: '18', height: '18' })) {
    svg.setAttribute(key, value)
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICONS[name])
  svg.append(path)
  return svg
}

/** Puts text into a node, with **bold**, `code` and [words](where they point) as the only marks. */
function mark(node, text, linker = null) {
  const pieces = []
  for (const piece of text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/)) {
    const link = piece.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/)
    // B218: where the text is a file of the game's, its links work (`linker` draws them).
    if (link !== null && linker !== null) pieces.push(linker(link[1], link[2]))
    else if (link !== null) {
      // B94: a link shows its words; where it points is the hint. The page opens nothing by it.
      const words = el('span', 'linked', link[1])
      words.title = link[2]
      pieces.push(words)
    } else if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) pieces.push(el('strong', '', piece.slice(2, -2)))
    else if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) pieces.push(el('code', '', piece.slice(1, -1)))
    else if (piece !== '') pieces.push(piece)
  }
  node.replaceChildren(...pieces)
  return node
}

const marked = (tag, className, text, linker = null) => mark(el(tag, className), text, linker)

// Pictures: fetched from the board's own server with the token, and shown from memory

/** B676: why a picture could not be shown, by path (a plain line: "Too big to show: 41.2 MB ..."). */
const pictureProblems = new Map()

function pictureUrl(path) {
  if (!pictures.has(path)) {
    pictures.set(path, fetch(`/api/picture?path=${encodeURIComponent(path)}`, { headers: { 'X-Board-Token': TOKEN } })
      .then(async answer => {
        if (answer.status === 413) pictureProblems.set(path, (await answer.text()).trim())
        return answer.ok ? answer.blob() : null
      })
      .then(blob => (blob === null ? null : URL.createObjectURL(blob)))
      .catch(() => null))
  }
  return pictures.get(path)
}

/** A picture that opens large on a click. */
function picture(path, caption = '') {
  const frame = el('button', 'picture')
  frame.type = 'button'
  frame.dataset.zoom = path
  frame.dataset.caption = caption
  frame.title = caption === '' ? path : `${caption}\n${path}`
  const image = el('img')
  image.alt = caption
  frame.append(image)
  pictureUrl(path).then(url => {
    if (url !== null) image.src = url
    else frame.replaceChildren(el('span', 'muted', 'picture not found'))
  })
  return frame
}

// update:start
// B142: the note on top when a new version of the board is there, and the version in the top bar. The person,
// 2026-10-14: "i want the board to show a little notification on top that a new version is available and I click
// it to start it. dont auto refresh."

/**
 * The note: its words, what a click does (`restart`: the board starts the version its folder holds; `reload`: only
 * the page is newer and is loaded again; null: nothing to click), and its `tone`. Null when nothing is new.
 * `loadedPage` is the page's version as it was loaded; `isStarting` and `problem` are what became of a click.
 */
function updateView(version, loadedPage, { isStarting = false, problem = null } = {}) {
  if (version === undefined || version === null) return null
  if (isStarting) return { text: 'Starting the new version of the board…', action: null, tone: 'busy' }
  if (problem !== null) return { text: `${problem} Click to try again.`, action: 'restart', tone: 'problem' }
  // B454: the board starts a new server by itself at a safe moment: until then the note says what it waits for; after 10
  // minutes without one it asks for the click as before.
  if (version.isServerNewer && version.canRestart && version.selfUpdate?.state === 'waiting') return { text: version.selfUpdate.line, action: null, tone: 'quiet' }
  if (version.isServerNewer) {
    return version.canRestart
      ? { text: 'A new version of the board is available. Click to start it.', action: 'restart', tone: 'new' }
      : { text: 'A new version of the board is available. This board cannot start itself anew: start it once from where it was started.', action: null, tone: 'new' }
  }
  if (loadedPage !== '' && typeof version.page === 'string' && version.page !== loadedPage) return { text: 'A new version of the page is available. Click to load it.', action: 'reload', tone: 'new' }
  return null
}

/**
 * B454: whether the page loads the new version of itself now: only the page is newer (a newer server restarts the
 * board, and the page then loads itself anew), the page is idle (`isIdle`) and it did not do so within the last minute
 * (`lastAt`), so a version it cannot settle on cannot make it load over and over.
 */
function reloadsNow(version, loadedPage, { isIdle, lastAt = 0, now = 0 }) {
  if (version === undefined || version === null || version.isServerNewer || loadedPage === '' || typeof version.page !== 'string') return false
  return version.page !== loadedPage && isIdle && now - lastAt > MIN
}

/**
 * B519: whether the page loads itself anew after the board answered 403 (it was started again and has a new token, so
 * every Send of this page fails): at once, at most once a minute (`lastAt`), so a real refusal cannot make it reload
 * over and over. What the person did is not lost: see `keptState`.
 */
function reloadsOn403(status, { lastAt = 0, now = 0 }) {
  return status === 403 && now - lastAt > MIN
}

/**
 * B524: what the person did on the page that a reload must not undo, as text for sessionStorage. One pair of helpers
 * (`keptState`, `keptBack`) serves every reload: the 403 one (B519), the new page (B454) and the note's click.
 * `drafts`, `words`, `picks`, `chosen`: lists of [id, text] (the answers being typed, a popup's note and pick, the
 * option chosen); `forms`: the ids of the forms left open; `fields`: the words in the page's own boxes (the Talk to
 * Main and Advisor boxes, ...) by their element id; `focusWords`: the Focus page's boxes; `details`: what the open
 * popup is about (`detailsOf`). Empty words and anything of another shape are left out.
 */
function keptState({ drafts = [], words = [], picks = [], chosen = [], forms = [], fields = {}, focusWords = {}, details = null }) {
  const pairs = list => [...list].filter(([name, text]) => typeof name === 'string' && typeof text === 'string' && text !== '')
  return JSON.stringify({
    drafts: pairs(drafts),
    words: pairs(words),
    picks: pairs(picks),
    chosen: pairs(chosen),
    forms: [...forms].filter(id => typeof id === 'string'),
    fields: Object.fromEntries(pairs(Object.entries(fields))),
    focusWords: Object.fromEntries(pairs(Object.entries(focusWords))),
    details,
  })
}

/** B524: what `keptState` wrote, back from the text, every part present and well-formed; anything unreadable gives null. */
function keptBack(text) {
  let kept
  try {
    kept = JSON.parse(text ?? 'null')
  } catch {
    return null
  }
  if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return null
  const pairs = list => (Array.isArray(list) ? list.filter(pair => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' && pair[1] !== '') : [])
  const named = object => (typeof object === 'object' && object !== null && !Array.isArray(object) ? pairs(Object.entries(object)) : [])
  const isPlain = object => typeof object === 'object' && object !== null && !Array.isArray(object) && Object.values(object).every(value => ['string', 'number', 'boolean'].includes(typeof value) || value === null)
  return {
    drafts: pairs(kept.drafts),
    words: pairs(kept.words),
    picks: pairs(kept.picks),
    chosen: pairs(kept.chosen),
    forms: Array.isArray(kept.forms) ? kept.forms.filter(id => typeof id === 'string') : [],
    fields: named(kept.fields),
    focusWords: named(kept.focusWords),
    details: isPlain(kept.details) ? kept.details : null,
  }
}

/** B454: the short note after the page loaded itself, for a few seconds (`at`: when it did). */
function updatedView(at, now) {
  return Number.isFinite(at) && at > 0 && now - at < 8000 ? { text: 'The page was updated to the new version.', action: null, tone: 'quiet' } : null
}

/** Which version of the board runs, and since when: "Board 5fb7da8 · since 09:31". */
function versionLine(version) {
  return typeof version?.commit === 'string' && version.commit !== '' ? `Board ${version.commit} · since ${clock(version.since)}` : ''
}
// update:end

// appnote:start
/**
 * B273: the note on top when the Claude app moved its folder while the board ran or since its settings were written
 * (`appMoved`: from where, to where, when): where the board found it, or that it found it nowhere. Null: no note.
 */
function appNote(moved, clockOf) {
  if (moved === null || moved === undefined) return null
  if (moved.to === null) {
    return { tone: 'problem', text: `The Claude app's list of chats is gone from ${moved.from} (${clockOf(moved.at)}), and the board found it nowhere else: it shows no chats. Set "appSessions" in the board's config.json to the app's folder.` }
  }
  return { tone: 'info', text: `The Claude app's folder moved: found it at ${moved.to} (${clockOf(moved.at)}). The board reads the chats from there, no longer from ${moved.from}.` }
}
// appnote:end

// modnote:start
/**
 * B319: the note on top when this board's folder carries another Workers mod than the PC runs (`mod`: `carried`,
 * `installed`; one mod per PC, shared by every project's board). Null: the same, the demo, or nobody can tell.
 */
function modNote(mod) {
  if (mod === null || mod === undefined || typeof mod.carried !== 'string' || mod.installed === undefined || mod.installed === mod.carried) return null
  if (mod.installed === null) {
    return { tone: 'problem', text: 'The Workers mod is not installed on this PC: the chats cannot reach this board. Run npm run setup in the board\'s folder, then quit the Claude app fully and open it again.' }
  }
  const newer = mod.installed.split('.').map(Number).reduce((by, part, at) => by || part - (Number(mod.carried.split('.')[at]) || 0), 0) > 0
  if (newer) return { tone: 'info', text: `This PC runs the Workers mod ${mod.installed}, newer than the ${mod.carried} this board carries, and keeps it: bring the board's folder up to date to match.` }
  // Installed from another board's folder (another project's): setup is run there, never here.
  if (typeof mod.from === 'string' && mod.isHere === false) {
    return { tone: 'problem', text: `This board carries the Workers mod ${mod.carried}; this PC runs ${mod.installed}, installed from ${mod.from}: bring that folder up to date and run npm run setup there, then quit the Claude app fully and open it again.` }
  }
  return { tone: 'problem', text: `This board carries the Workers mod ${mod.carried}; this PC runs ${mod.installed}. Run npm run setup in this board's folder, then quit the Claude app fully and open it again.` }
}

function drawModNote(state) {
  const shown = modNote(state.mod)
  const note = $('mod-note')
  note.hidden = shown === null
  if (shown === null) return
  note.className = `app-note is-${shown.tone}`
  note.textContent = shown.text
}
// modnote:end

// cpu:start
/**
 * B311, B735: the head's control "CPU for Claude" (`cpu` from the state: `available`, `level`, `count`, `fault`, `cores`,
 * `lowCores`): which level is lit, the line beside it, its tip, and the note on top when the board could not read
 * the processes. Null: no control (the demo).
 */
function cpuView(cpu, pending = null) {
  if (cpu === null || cpu === undefined) return null
  const level = pending ?? cpu.level
  if (cpu.available !== true) return { level: null, disabled: true, label: 'CPU for Claude: not available here', count: '', title: 'The board sets the CPU for Claude on Windows only.', note: null }
  const processes = n => `${n} process${n === 1 ? '' : 'es'}`
  const count = pending !== null ? '' : level === 'low' ? `${processes(cpu.count)} on ${cpu.lowCores} cores, lowest priority: tests and builds run slower` : 'full power'
  const title = level === 'full' ? 'Claude runs at full power.' : `Applies to everything the project started, the board included: ${processes(cpu.count)} now.`
  return { level, disabled: pending !== null, label: 'CPU for Claude', count, title, note: typeof cpu.fault === 'string' ? cpu.fault : null }
}
// cpu:end

// store:start
/**
 * B296: the line under the Backlog tab's head about the work store, the one source of the work: how many items it holds
 * and that backlog.md is its view (`store` from the state). Null without a store.
 */
function storeLine(store) {
  if (store === null || store === undefined) return null
  const problems = store.problems ?? []
  if (store.ok !== true) return { tone: 'problem', text: `Store: ${store.why}`, problems }
  const parts = ['Store', `${store.items} item${store.items === 1 ? '' : 's'}`, 'backlog.md is its view']
  if (problems.length > 0) parts.push(`${problems.length} problem${problems.length === 1 ? '' : 's'}`)
  return { tone: problems.length > 0 ? 'warn' : 'ok', text: parts.join(' · '), problems }
}

/**
 * B296, B301: the note on top about the work store: it is not there or cannot be read (`store.why`, naming its folder
 * and what to run; the board then shows no work, and nothing from backlog.md instead); a file in it the board cannot
 * read (the reconciler's lines, naming the folder and the file); or backlog.md was edited by hand, the edit kept beside
 * it (`store.kept`). Null: none.
 */
function storeNote(store, workFlags = []) {
  if (store !== null && store !== undefined && store.ok !== true) return { tone: 'problem', text: store.why }
  // B300: the reconciler's lines on top: a file it cannot read, an id twice, a state the flow does not know.
  if (workFlags.length > 0) return { tone: 'problem', text: `The work store${typeof store?.dir === 'string' ? ` ${store.dir}` : ''}: ${workFlags.join(' · ')}. Such an item is shown as it is and not moved: fix the file by hand.` }
  if (typeof store?.kept === 'string') return { tone: 'warn', text: `backlog.md was edited by hand. The board wrote it anew from the work store and kept the edited file as ${store.kept}: carry what it adds over with the work tool, then delete it.` }
  return null
}
// store:end

// setAside:start
/**
 * B406: the note on top when the board set data files aside at its start (`state.setAside`: `{ file, aside }`): each
 * did not parse, torn perhaps by a restart or a power cut, and the board started without it. Null: none.
 */
function setAsideNote(setAside) {
  if (!Array.isArray(setAside) || setAside.length === 0) return null
  const listed = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)
  const words = list => (list.length > 1 ? ['them', 'those files'] : ['it', 'that file'])
  const kept = setAside.filter(one => typeof one.aside === 'string')
  // One there that could not be read, or not kept aside: its next write replaces it.
  const lost = setAside.filter(one => typeof one.aside !== 'string')
  const lines = []
  if (kept.length > 0) {
    const [them, files] = words(kept)
    lines.push(`At its start the board could not read ${listed(kept.map(one => one.file))} in its data folder (torn, perhaps by a restart or a power cut). It kept ${them} aside as ${listed(kept.map(one => one.aside))} and started without ${them}. Delete ${files} once you no longer need ${them}.`)
  }
  if (lost.length > 0) {
    const [them] = words(lost)
    lines.push(`At its start the board could not read ${listed(lost.map(one => `${one.file} (${one.why})`))} in its data folder, nor keep ${them} aside: it started without ${them} and writes ${them} anew.`)
  }
  return lines.join(' ')
}
// setAside:end

function drawAppNote(state) {
  const shown = appNote(state.appMoved ?? null, clock)
  const note = $('app-note')
  note.hidden = shown === null
  if (shown === null) return
  note.className = `app-note is-${shown.tone}`
  note.textContent = shown.text
}

/** B311: the head's "CPU for Claude" and its note on top (see `cpuView`). */
function drawCpu(state) {
  const shown = cpuView(state.cpu ?? null, sending.has('cpu') ? cpuPending : null)
  const box = $('cpu')
  box.hidden = shown === null
  const note = $('cpu-note')
  const problem = problems.get('cpu') ?? null
  const noteText = problem ?? shown?.note ?? null
  note.hidden = noteText === null
  if (noteText !== null) note.textContent = noteText
  drawSettings(state, shown)
  if (shown === null) return
  $('cpu-label').textContent = shown.label
  $('cpu-count').textContent = shown.count
  box.title = shown.title
  for (const button of box.querySelectorAll('[data-cpu]')) {
    const isOn = button.dataset.cpu === shown.level
    button.classList.toggle('is-on', isOn)
    button.setAttribute('aria-pressed', String(isOn))
    button.disabled = shown.disabled
    button.hidden = state.cpu.available !== true
  }
}

/**
 * B307: the ⚙ button on the top bar that holds CPU for Claude, its processes and the board's version; its tooltip
 * says the level and the version, so a hover tells them. Hidden when it holds nothing.
 */
function drawSettings(state, cpu) {
  const version = versionLine(state.version)
  const settings = $('settings')
  // B320: the New project button, on the board that delivers.
  $('new-project-button').hidden = state.newProject?.canMake !== true
  drawBoardSettings(state)
  drawCodeJobs(state)
  settings.hidden = cpu === null && version === '' && $('new-project-button').hidden && (state.boardSettings ?? null) === null && (state.codeJobs ?? null) === null
  const level = cpu === null || cpu.level === null ? null : `CPU for Claude: ${cpu.level[0].toUpperCase()}${cpu.level.slice(1)}${cpu.count === '' ? '' : ` (${cpu.count})`}`
  const shown = state.boardSettings ?? null
  const bother = shown === null ? null : `Bother me: ${shown.botherMe === 'daily' ? 'once a day' : 'at once'}`
  $('settings-button').title = [level, bother, version].filter(part => part !== null && part !== '').join('\n') || 'CPU for Claude and the board\'s version'
}

/** B361: the setting being sent ({ key, value }), lit at once. */
let settingPending = null

/** B-max: the ends of "Workers at most" (the board's own range is MAX_WORKERS_RANGE in src/boardSettings.mjs). */
const WORKERS_AT_MOST = [1, 10]

/** B361: "Bother me", "Approve rebuilds by itself" and (B-max) "Workers at most" in the settings panel, lit as the board runs them. */
function drawBoardSettings(state) {
  const shown = state.boardSettings ?? null
  const problem = problems.get('setting') ?? null
  $('settings-note').hidden = problem === null
  if (problem !== null) $('settings-note').textContent = problem
  for (const id of ['bother-me', 'approve-rebuilds', 'max-workers']) {
    const group = $(id)
    group.hidden = shown === null || (id === 'max-workers' && !Number.isInteger(shown.maxWorkers))
    group.title = shown === null || shown.canSet ? '' : shown.whyNot ?? ''
  }
  if (shown === null) return
  // B-max: the number, and the two buttons that send it one lower or one higher (the answer's number, kept in range);
  // the button at an end of the range is off, as is each of them while a change is on its way.
  const workers = settingPending !== null && settingPending.key === 'maxWorkers' ? settingPending.value : shown.maxWorkers
  if (Number.isInteger(workers)) $('max-workers-value').textContent = String(workers)
  for (const button of $('settings').querySelectorAll('[data-setting="maxWorkers"]')) {
    const step = Number(button.dataset.step)
    button.dataset.value = String(Math.min(WORKERS_AT_MOST[1], Math.max(WORKERS_AT_MOST[0], workers + step)))
    const atEnd = step > 0 ? workers >= WORKERS_AT_MOST[1] : workers <= WORKERS_AT_MOST[0]
    button.disabled = shown.canSet !== true || sending.has('setting') || atEnd
  }
  for (const button of $('settings').querySelectorAll('[data-setting]:not([data-step])')) {
    const key = button.dataset.setting
    const value = settingPending !== null && settingPending.key === key ? settingPending.value : shown[key]
    const isOn = button.dataset.value === String(value)
    button.classList.toggle('is-on', isOn)
    button.setAttribute('aria-pressed', String(isOn))
    button.disabled = shown.canSet !== true || sending.has('setting')
  }
}

/**
 * B767 (the person, 2026-10-28: "is this clear for new users of the worker board for new pc's?"): the setup check's
 * lines, one per routine job of the main chat's (`state.codeJobs.rows`): by code, or still the main chat's and why.
 */
function codeJobLines(jobs) {
  // Plain for a first-time user (the person, 2026-10-28: "as long as instructions are clear when a new user tries the
  // board for the first time"): a short state, the full reason in its tooltip.
  // T14: the wake row while only chats in Auto mode run (src/codeJobs.mjs SEND_WHY, SEND_SOON); the reason in its tooltip.
  const short = {
    'not allowed yet': 'needs your OK', 'no stored start-worker task on this PC': 'needs its routines', 'no chat with the Workers mod runs now': 'no chat runs now',
    'chats in Auto mode may not send messages until the project allows mcp__ccd_session_mgmt__send_message': 'needs your OK',
    'allowed: the running chats see it within ten minutes': 'within 10 min',
  }
  return (jobs?.rows ?? []).map(row => {
    // T13 part 4: the board's own job, no chat's: opening a chat when none runs; it stopped after tries that brought none back.
    if (row.key === 'open') {
      const failed = String(row.why ?? '').startsWith('the last try failed')
      return {
        key: row.key, title: row.title, byCode: row.byCode === true,
        text: row.byCode === true ? 'by itself' : failed ? 'last try failed' : 'not on this board',
        why: row.byCode === true ? 'When no chat runs and work waits for one, the board opens a chat of the project in the Claude app.' : `The board does not open a chat by itself now: ${row.why}${failed ? '; open any chat of the project yourself' : ''}.`,
      }
    }
    // The person, 2026-10-30: the workers' own preview tools, allowed or not (src/codeJobs.mjs, settingsOnly): no main chat's job.
    if (row.key === 'preview') {
      return {
        key: row.key, title: row.title, byCode: row.byCode === true,
        text: row.byCode === true ? 'no popup' : 'needs your OK',
        why: row.byCode === true ? 'A worker starts, checks and stops the game preview with no popup.' : 'Each worker asks you in a popup before it starts the game preview: allow it for this project.',
      }
    }
    // T12: each worker starts from a routine of its own; the row names the workers that have none yet.
    const fewRoutines = String(row.why ?? '').startsWith('needs routines for')
    return {
      key: row.key, title: row.title, byCode: row.byCode === true,
      text: row.byCode === true ? 'by itself' : fewRoutines ? row.why : short[row.why] ?? (String(row.why ?? '').startsWith('the last try failed') ? 'last try failed' : 'after a restart'),
      why: row.byCode === true ? 'The board does this by itself.' : fewRoutines ? `The board starts a worker by itself when that worker has a routine of its own: ${row.why}.` : `The main chat does this for now: ${row.why}.`,
    }
  })
}

/** B767: the note on top while a job of the main chat's could run by code once allowed or once the task is made. */
function codeJobsNote(jobs) {
  if (jobs === null || jobs === undefined) return null
  const needsOk = ['not allowed yet', 'no stored start-worker task on this PC', 'chats in Auto mode may not send messages until the project allows mcp__ccd_session_mgmt__send_message']
  const lacking = (jobs.rows ?? []).filter(row => row.byCode !== true && needsOk.includes(row.why))
  if (lacking.length === 0) return null
  return `The board can do ${lacking.length === 1 ? 'one more job' : `${lacking.length} more jobs`} by itself on this PC once you allow ${lacking.length === 1 ? 'it' : 'them'}: ${lacking.map(row => row.title.toLowerCase()).join(', ')}.`
}

/** B767: the setup check in the settings panel and its note on top. */
function drawCodeJobs(state) {
  const jobs = state.codeJobs ?? null
  const note = codeJobsNote(jobs)
  $('code-jobs-note').hidden = note === null
  if (note !== null) $('code-jobs-note-text').textContent = note
  $('code-jobs').hidden = jobs === null
  if (jobs === null) return
  once('code-jobs', [jobs.rows, jobs.missing, jobs.taskLine, jobs.checked], () => {
    fill($('code-job-list'), codeJobLines(jobs).map(line => {
      const row = el('li', `code-job${line.byCode ? ' is-code' : ''}`)
      row.title = line.why
      row.append(el('span', 'code-job-title', line.title), el('span', 'code-job-state', line.text))
      return row
    }))
  })
  const allow = $('code-jobs-allow')
  allow.hidden = jobs.canAllow !== true || (jobs.missing ?? []).length === 0
  allow.disabled = sending.has('code-jobs')
  allow.title = `Adds to this project's .claude/settings.local.json: ${(jobs.missing ?? []).join(', ')}`
  $('code-jobs-task').hidden = typeof jobs.taskLine !== 'string'
  const problem = problems.get('code-jobs') ?? null
  const checked = jobs.checked === null ? 'No chat runs now to check it.' : `Checked by ${jobs.checked.chat} at ${clock(jobs.checked.at)}.`
  const open = (jobs.rows ?? []).some(row => row.byCode !== true)
  const steps = [allow.hidden ? null : '"Allow them" adds the permissions to this project\'s own settings', $('code-jobs-task').hidden ? null : '"Copy the line" gives a line to paste into any chat of this project and send'].filter(Boolean)
  $('code-jobs-about').textContent = problem ?? (open ? `What the board does not do by itself yet, the main chat does.${steps.length === 0 ? '' : ` ${steps.join('; ')}.`} ${checked}` : checked)
}

$('code-jobs-open').addEventListener('click', () => { $('settings').open = true })

$('code-jobs-allow').addEventListener('click', async () => {
  if (board === null || sending.has('code-jobs')) return
  sending.add('code-jobs')
  problems.delete('code-jobs')
  drawCodeJobs(board)
  try {
    const answer = await fetch('/api/code-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify({ action: 'allow' }) })
    if (!answer.ok) throw new Error((await answer.text()).trim() || `refused (${answer.status})`)
    const done = await answer.json()
    problems.set('code-jobs', done.added.length === 0 ? 'Nothing was missing.' : `Allowed: ${done.added.length} tools. The chats see it within ten minutes.`)
  } catch (error) {
    problems.set('code-jobs', `Not allowed: ${error instanceof Error ? error.message : 'the board did not answer'}`)
  } finally {
    sending.delete('code-jobs')
    drawCodeJobs(board)
  }
})

$('code-jobs-task').addEventListener('click', () => {
  const line = board?.codeJobs?.taskLine ?? null
  if (line === null) return
  navigator.clipboard.writeText(line).then(
    () => problems.set('code-jobs', 'Copied: paste it into any chat of this project and send it.'),
    () => problems.set('code-jobs', 'Not copied: the browser refused the clipboard.'),
  ).finally(() => drawCodeJobs(board))
})

$('settings').addEventListener('click', async event => {
  const button = event.target.closest('[data-setting]')
  if (button === null || button.disabled || board === null || sending.has('setting') || board.boardSettings?.canSet !== true) return
  const key = button.dataset.setting
  // B-max: "Workers at most" sends a number (the stepper's `data-value`), the others a word or a flag.
  const value = key === 'approveRebuilds' ? button.dataset.value === 'true' : key === 'maxWorkers' ? Number(button.dataset.value) : button.dataset.value
  if (board.boardSettings[key] === value) return
  settingPending = { key, value }
  sending.add('setting')
  problems.delete('setting')
  drawBoardSettings(board)
  try {
    const answer = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify({ key, value }) })
    if (!answer.ok) throw new Error((await answer.text()).trim() || `refused (${answer.status})`)
    board.boardSettings = await answer.json()
    // The recaps and the asks that can wait move between Needs your attention and the daily note at once.
    board.recapsShow = board.boardSettings.botherMe
    await read()
  } catch (error) {
    problems.set('setting', `Setting not changed: ${error instanceof Error ? error.message : 'the board did not answer'}`)
  } finally {
    sending.delete('setting')
    settingPending = null
    drawBoardSettings(board)
    redrawNeeds()
    redrawFocus()
  }
})

// A click elsewhere, or Escape, folds it again.
document.addEventListener('click', event => {
  if ($('settings').open && !$('settings').contains(event.target)) $('settings').open = false
})
// On a narrow screen the part stands fixed under the button: a scroll folds it, so it never floats away from it.
window.addEventListener('scroll', () => {
  if ($('settings').open && window.matchMedia('(max-width: 760px)').matches) $('settings').open = false
}, { passive: true })
$('settings').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !$('settings').open) return
  $('settings').open = false
  $('settings-button').focus()
})

/** The level being sent, lit at once. */
let cpuPending = null

$('cpu').addEventListener('click', async event => {
  const button = event.target.closest('[data-cpu]')
  if (button === null || board === null || sending.has('cpu') || board.cpu?.level === button.dataset.cpu) return
  cpuPending = button.dataset.cpu
  sending.add('cpu')
  problems.delete('cpu')
  drawCpu(board)
  try {
    const answer = await fetch('/api/cpu', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify({ level: cpuPending }) })
    if (!answer.ok) throw new Error((await answer.text()).trim() || `refused (${answer.status})`)
    board.cpu = await answer.json()
  } catch (error) {
    problems.set('cpu', `CPU for Claude not changed: ${error instanceof Error ? error.message : 'the board did not answer'}`)
  } finally {
    sending.delete('cpu')
    cpuPending = null
    drawCpu(board)
  }
})

// newproject:start
/** B320: the folder the New project form suggests: beside this project's, named after the new one; '' when not known. */
function suggestedFolder(parent, name) {
  if (typeof parent !== 'string' || parent === '') return ''
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]+$/, '')}${separator}${name}`
}

/** What the form says once the project is made: where it is, the link to its board, and what went wrong on the way. */
function newProjectDone(result) {
  return { text: `Made ${result.project}. Its board: `, link: result.url, warnings: Array.isArray(result.warnings) ? result.warnings : [] }
}
// newproject:end

/** B320: the New project form. The folder follows the name until the person types a folder of their own. */
let isFolderTyped = false
$('new-project-button').addEventListener('click', () => {
  $('settings').open = false
  isFolderTyped = false
  $('new-project-form').reset()
  $('new-project-status').textContent = ''
  $('new-project-make').disabled = false
  $('new-project-cancel').textContent = 'Cancel'
  $('new-project').showModal()
  $('new-project-name').focus()
})
$('new-project-name').addEventListener('input', () => {
  const name = $('new-project-name').value.trim()
  $('new-project-prefix').placeholder = name === '' ? '' : `${name} - `
  if (!isFolderTyped) $('new-project-folder').value = name === '' ? '' : suggestedFolder(board?.newProject?.parent ?? null, name)
})
$('new-project-folder').addEventListener('input', () => {
  isFolderTyped = true
})
$('new-project-cancel').addEventListener('click', () => $('new-project').close())
// Closed, the focus goes back to the ⚙ button that holds New project….
$('new-project').addEventListener('close', () => $('settings-button').focus())
$('new-project-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (sending.has('new-project')) return
  sending.add('new-project')
  const status = $('new-project-status')
  status.className = 'new-project-status'
  status.textContent = 'Making the project: its folder, its copy of the board, its icon… (this takes a few seconds)'
  // The focus stays in the form while its button waits.
  $('new-project-cancel').focus()
  $('new-project-make').disabled = true
  try {
    const body = { name: $('new-project-name').value, folder: $('new-project-folder').value, prefix: $('new-project-prefix').value }
    const answer = await fetch('/api/new-project', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify(body) })
    if (!answer.ok) throw new Error((await answer.text()).trim() || `refused (${answer.status})`)
    const done = newProjectDone(await answer.json())
    const link = el('a', '', done.link)
    link.href = done.link
    link.target = '_blank'
    link.rel = 'noopener'
    status.replaceChildren(document.createTextNode(done.text), link)
    // Review: an icon not made, or a board that did not start, is said under it.
    for (const warning of done.warnings) status.append(el('span', 'new-project-warning', warning))
    status.classList.add('is-done')
    $('new-project-cancel').textContent = 'Close'
    $('new-project-cancel').focus()
  } catch (error) {
    status.textContent = `Not made: ${error instanceof Error ? error.message : 'the board did not answer'}`
    status.classList.add('is-problem')
    $('new-project-make').disabled = false
  } finally {
    sending.delete('new-project')
  }
})

// supervisor:start
/**
 * The supervisor (spec 2026-10-24, "To you and to the Advisor"): its section under the Workers panel's head, where B465's
 * "Out of sync?" list stood. B465: each status of the board's own check and the tone it shows in. Worktree clean-up
 * (2026-10-24): Cleaned, a leftover worktree or empty folder the board removed; Left, one it leaves, with why. The
 * section uses quiet, cool colours only: nothing in it is the person's to act on (the person's attention colours,
 * amber to red, stay out of it).
 */
const SYNC_TONES = { Fixed: 'done', Woke: 'done', Sent: 'done', Cleaned: 'done', 'For Main': 'main', Left: 'fine', Fine: 'fine' }
/**
 * The incident cards (2026-10-24, the person's choice of layout B): one card per fix step, `view.cards` (the supervisor's
 * own cards.mjs: the step, its live state in the words of the chip, the incidents it covers), the incidents' own records
 * from `view.incidents`. How many fixed cards stay in sight; the older ones fold under one button.
 */
const FIXED_CARDS_SHOWN = 3
/** The longest evidence the details of a card show; the rest is in the work store. */
const EVIDENCE_SHOWN = 600

/** Small words a cut title does not end on ("steps that sit in…" reads better as "steps that sit…"). */
const TRAILING_SMALL = /\s+(?:a|an|the|in|on|of|to|for|and|or|with|that|while|is|are|by|at)$/i

/**
 * The first few words of an incident's title: up to its first ";" or ", " (what follows is detail the evidence gives), and
 * at most `most` characters, cut at a word and not on a small one. `whole` keeps what follows the first ";" or ", " too
 * (a card that lists its incidents one by one shows each title whole, so the lines tell the incidents apart).
 */
function gistOf(title, most = 60, whole = false) {
  const text = (whole ? String(title ?? '') : String(title ?? '').split(/;|, /)[0]).trim()
  if (text.length <= most) return text
  const head = text.slice(0, most + 1)
  let cut = head.slice(0, Math.max(head.lastIndexOf(' '), Math.floor(most / 2))).trimEnd()
  while (TRAILING_SMALL.test(cut)) cut = cut.replace(TRAILING_SMALL, '')
  return `${cut}…`
}

/** "seen 5 times, since 10:27, last 10:40" of an incident: what the details of a card say of its times. */
function seenOf(one) {
  return [one.count === 1 ? 'seen once' : `seen ${one.count} times`, Number.isFinite(one.firstSeen) ? `since ${clock(one.firstSeen)}` : null, one.count > 1 && Number.isFinite(one.lastSeen) ? `last ${clock(one.lastSeen)}` : null].filter(Boolean).join(', ')
}

/**
 * When an incident was last seen, for a list line: the time of day when that was today (`now`'s day), else the date
 * ("22 Oct"); '' for no time.
 */
function lastSeenWords(at, now) {
  if (!Number.isFinite(at)) return ''
  const then = new Date(at)
  if (then.toDateString() === new Date(now).toDateString()) return clock(at)
  return `${then.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][then.getMonth()]}`
}

/**
 * One card as drawn, from the supervisor's card and the incidents' records: its head (the step's id, which opens that
 * step, and its short title), its chip (the live state), its lines and, folded away until a click, each incident's
 * evidence, times and count. `lines` (`line` is the same joined by line breaks): 2026-10-26, the person ("it says 9 open
 * but i only see 3 fixed, where are the open ones?"): a card that is not fixed lists every incident on its own line, the
 * one seen last first: its id, its own title whole, `seen N×, last 10:40` (the date when not today; the card without a
 * fix step also says an incident's own state when they differ). A card with one incident, and a fixed one, keep the one
 * quiet line (the incident ids and a few words, "seen N×" only when it was seen more than once). The card without a fix
 * step counts the incidents it lists in its title. `now` the time the lines count today from.
 */
function incidentCardOf(card, byId, now = Date.now()) {
  const covered = card.incidents.map(one => {
    const record = byId.get(one.id) ?? { id: one.id, title: '', state: null, fix: null, count: 0, firstSeen: null, lastSeen: null, evidence: null, ruleWanted: null }
    return { ...record, word: one.word ?? null }
  })
  const isList = covered.length > 1 && card.state.tone !== 'done'
  let lines
  if (isList) {
    // The incident seen last first (its first time when it has no last, else the newest id); the details follow the same order.
    const timeOf = one => (Number.isFinite(one.lastSeen) ? one.lastSeen : Number.isFinite(one.firstSeen) ? one.firstSeen : 0)
    covered.sort((a, b) => timeOf(b) - timeOf(a) || String(b.id).localeCompare(String(a.id), 'en', { numeric: true }))
    const mixed = new Set(covered.map(one => one.word)).size > 1
    lines = covered.map(one => {
      const last = lastSeenWords(one.lastSeen, now)
      const times = [one.count > 0 ? `seen ${one.count}×` : null, last === '' ? null : `last ${last}`].filter(Boolean).join(', ')
      const title = gistOf(one.title, 110, true)
      return [title === '' ? one.id : `${one.id} · ${title}`, mixed ? one.word : null, times === '' ? null : times].filter(Boolean).join(' · ')
    })
  } else {
    const seen = Math.max(0, ...covered.map(one => one.count || 0))
    lines = [`${covered.map(one => one.id).join(' ')} · ${gistOf(covered[0]?.title)}${seen > 1 ? ` (seen ${seen}×)` : ''}`]
  }
  return {
    key: card.key, step: card.step, href: card.step === null ? null : `#details=${card.step}`,
    // The card without a fix step says how many incidents it lists: the person counts them against the head's "N open".
    title: (card.title ?? '(this step is not in the store)') + (card.key === 'nofix' ? ` (${covered.length})` : ''),
    state: card.state.text, tone: card.state.tone, line: lines.join('\n'), lines,
    details: covered.map(one => ({
      id: one.id, title: one.title ?? '', state: one.state === 'fix' && one.fix ? `fix ${one.fix}` : one.state ?? 'open', seen: seenOf(one),
      evidence: one.evidence === null || one.evidence === undefined ? null : one.evidence.length > EVIDENCE_SHOWN ? `${one.evidence.slice(0, EVIDENCE_SHOWN).trimEnd()}…` : one.evidence,
      ruleWanted: one.ruleWanted ?? null,
    })),
  }
}

/** B465: the last check's rows: a row per finding (Fixed, Woke, Sent, For Main, Cleaned or Left) and one for the checks that found nothing. */
function checkRowsOf(run) {
  if (run === null || run === undefined || !Array.isArray(run.rows)) return []
  const rows = run.rows.map(row => ({ status: row.status, tone: SYNC_TONES[row.status] ?? 'main', text: row.text }))
  const found = rows.some(row => row.status !== 'Left')
  const fine = Number.isFinite(run.fine) && run.fine > 0 ? [{ status: 'Fine', tone: 'fine', text: `${run.fine} ${found ? 'other ' : ''}checks: nothing stuck` }] : []
  return [...rows, ...fine]
}

/** B573: a day. The section's counts roll over the last day and the day before it (the person, 2026-10-26, "apply A"). */
const SUPERVISOR_DAY = 24 * 60 * 60_000
/** B573: the states of a fix step the section counts as in work (cards.mjs `phase`). */
const IN_WORK = ['queued', 'taken', 'in progress', 'waiting on you', 'review']

/**
 * B573: whether an incident is new to the person: found (opened, or came back) in the last day and since `seenAt`, when
 * the person last opened the section (null: never), and not fixed since.
 */
function isNewIncident(one, seenAt, now) {
  return Number.isFinite(one?.foundAt) && one.state !== 'fixed' && one.state !== 'closed' && one.foundAt > Math.max(Number.isFinite(seenAt) ? seenAt : -Infinity, now - SUPERVISOR_DAY)
}

/** Whether an incident was found (opened, or came back: its `foundAt`) in [from, until): the lower edge in, the upper out. */
function isFoundBetween(one, from, until) {
  return Number.isFinite(one?.foundAt) && one.foundAt >= from && one.foundAt < until
}

/** Whether an incident is fixed: its own state, or its fix step done (the card's `phase`). */
function isFixedIncident(one, phase) {
  return one?.state === 'fixed' || one?.state === 'closed' || phase === 'done'
}

/**
 * Whether the section counts and lists an incident. An open one always: it never drops out of sight because it is old
 * (a problem that silently disappears). A fixed one only when it was found or seen again in the last 24 hours (at or
 * after `now` minus a day); with no time known it is counted, never hidden. Before the person's rolling day
 * (2026-10-26) a start time in config.json did this; nothing is set by hand now.
 */
function isCountedIncident(one, phase, now) {
  if (!isFixedIncident(one, phase)) return true
  const times = [one?.foundAt, one?.lastSeen].filter(Number.isFinite)
  return times.length === 0 || times.some(time => time >= now - SUPERVISOR_DAY)
}

/**
 * B573, the person (2026-10-24): "understand how many things it found and is working on". The section's counts, from
 * the view's incidents and their cards, over a rolling day (2026-10-26): `found` opened or came back in [now - 24 h,
 * now), `foundBefore` in [now - 48 h, now - 24 h) (both by `isFoundBetween`, over every incident the view holds, the fixed
 * ones too); and, over the incidents counted (`isCountedIncident`: every open one whatever its age, the fixed ones of
 * the last 24 h): `inWork` its fix step queued, taken, in progress, waiting on the person or in review; `withAdvisor`
 * no fix under way yet (none, or one still being refined); `fixed` (in the last 24 h); `fresh` new to the person
 * (`isNewIncident`).
 */
function supervisorCounts(view, seenAt, now) {
  const phases = new Map()
  for (const card of view?.cards ?? []) for (const one of card.incidents ?? []) phases.set(one.id, card.phase ?? null)
  const counts = { found: 0, foundBefore: 0, inWork: 0, withAdvisor: 0, fixed: 0, fresh: 0 }
  for (const one of view?.incidents ?? []) {
    if (isFoundBetween(one, now - SUPERVISOR_DAY, now)) counts.found += 1
    else if (isFoundBetween(one, now - 2 * SUPERVISOR_DAY, now - SUPERVISOR_DAY)) counts.foundBefore += 1
    const phase = phases.get(one.id) ?? null
    if (!isCountedIncident(one, phase, now)) continue
    if (isNewIncident(one, seenAt, now)) counts.fresh += 1
    if (isFixedIncident(one, phase)) counts.fixed += 1
    else if (IN_WORK.includes(phase)) counts.inWork += 1
    else counts.withAdvisor += 1
  }
  return counts
}

/**
 * B573, the person's B (2026-10-26, "make it more simple": the head was too crowded): the section's head line, the same
 * folded or open: how many incidents are open (every one not fixed, whatever its age: in work and with the Advisor
 * together; "new" is the card's badge, no count here) and how many were found in the last 24 hours. Nothing else.
 */
function supervisorHead(counts) {
  return `Supervisor · ${counts.inWork + counts.withAdvisor} open · ${counts.found} found in 24 h`
}

/**
 * The rest of the old head, moved into the open section as one plain line at the top of its note: what was found in the
 * last 24 hours (and the 24 hours before), what was fixed in the last 24 hours, and the open ones by where they stand.
 */
function supervisorLast24(counts) {
  return `Last 24 h: ${counts.found} found (${counts.foundBefore} the 24 h before), ${counts.fixed} fixed. Open: ${counts.inWork} in work, ${counts.withAdvisor} with the Advisor.`
}

/** "Check now", the person (2026-10-26): how long the head keeps what an asked check came to, from the moment it ended. */
const CHECKED_SHOWN_MS = 10 * 60_000
/**
 * How long the board waits for the supervisor's chat to start an asked sweep (sweep.mjs SWEEP_SETTLE_MS, a test keeps the
 * two the same): a chat that has not read the health summary by then is not running and was not woken.
 */
const CHECK_START_MS = 2 * 60_000
/** The rules' asked run and the asked sweep it came with are one press when the run came at most this long before the sweep. */
const SAME_PRESS_MS = 2 * 60_000
/** The head's plain line when the supervisor's chat did not take the sweep: the code rules ran at the press all the same. */
const CHECK_NOT_STARTED = 'the supervisor\'s chat did not start: the code rules ran, the sweep did not'

/**
 * The person (2026-10-26): "i asked the supervisor to check, but i dont see indication if it's checking or not". What the
 * head says of a "Check now", or null when it says nothing, from the view the board knows and the press itself (`isPressed`:
 * the page has sent the press and the board's next state has not come). `{ state, text, tone, title }`:
 * - `checking`: the press, or the asked sweep (`lastSweep.asked`) that has not ended; the button reads "Checking…" then;
 * - `no-sweep`: the supervisor's chat was not reached, said instead of spinning: the asked sweep has run 2 minutes without
 *   its chat reading the health summary, or the board ended it with nobody having taken its word (`how` quiet, nothing
 *   read: not running and not woken in 2 minutes, or the word expired), or the sweep did not start at all (the view's
 *   `sweepNote`, asked: no chat open, a mod too old, a pause, ...). The code rules ran at the press either way;
 * - `checked`: "checked 15:26: nothing new" or "checked 15:26: 2 new", for 10 minutes after the asked sweep ended. New:
 *   the incidents not fixed found (opened or came back, `foundAt`) since the press; the store keeps the minute, so the
 *   press's minute counts whole, and the asked run of the rules just before the sweep counts as the same press. `tone`
 *   `found` for 1 or more (the attention colour), else `quiet`.
 * The newest end of an asked check counts: a refused press after the asked sweep ended shows its own line.
 */
function checkStatusOf(view, { isPressed = false, now = Date.now() } = {}) {
  if (view === null || view === undefined) return null
  const sweep = view.lastSweep?.asked === true ? view.lastSweep : null
  const isRunning = sweep !== null && !Number.isFinite(sweep.ended)
  const quiet = (state, text, title) => ({ state, text, tone: 'quiet', title })
  if (isPressed) return quiet('checking', 'checking…', 'Checking: the rules run at once, then the supervisor\'s chat sweeps the board')
  if (isRunning) {
    const hasStarted = sweep.read === true || sweep.found > 0
    if (now - sweep.at < CHECK_START_MS || hasStarted) return quiet('checking', 'checking…', `Checking: asked at ${clock(sweep.at)}, the supervisor's chat is sweeping the board`)
    return quiet('no-sweep', CHECK_NOT_STARTED, `Asked at ${clock(sweep.at)}${sweep.note ? `; ${sweep.note}` : ''}`)
  }
  // The sweep that did not even start (the board's note, newer than the last sweep): the newest end of an asked check wins.
  const note = view.sweepNote?.asked === true && Number.isFinite(view.sweepNote.at) ? view.sweepNote : null
  const endedAt = sweep !== null && Number.isFinite(sweep.ended) ? sweep.ended : -Infinity
  if (note !== null && note.at > endedAt) {
    return now - note.at < CHECKED_SHOWN_MS ? quiet('no-sweep', `checked ${clock(note.at)}: the code rules ran, the sweep did not`, `No sweep: ${note.why}`) : null
  }
  if (sweep === null || now - sweep.ended >= CHECKED_SHOWN_MS) return null
  if (sweep.how === 'quiet' && sweep.read !== true) return quiet('no-sweep', CHECK_NOT_STARTED, `Asked at ${clock(sweep.at)}${sweep.note ? `; ${sweep.note}` : ''}`)
  const run = view.run ?? null
  const pressedAt = run?.asked === true && Number.isFinite(run.at) && run.at <= sweep.at && sweep.at - run.at < SAME_PRESS_MS ? run.at : sweep.at
  const since = Math.floor(pressedAt / 60_000) * 60_000
  const found = (view.incidents ?? []).filter(one => !isFixedIncident(one, null) && Number.isFinite(one?.foundAt) && one.foundAt >= since).length
  return {
    state: 'checked', text: `checked ${clock(sweep.ended)}: ${found === 0 ? 'nothing new' : `${found} new`}`, tone: found > 0 ? 'found' : 'quiet',
    title: `Check now of ${clock(pressedAt)}: the code rules and the supervisor's sweep; ${found === 0 ? 'no incident opened or came back' : `${found} incident${found === 1 ? '' : 's'} opened or came back`} since`,
  }
}

/**
 * The section as drawn, from the state's `supervisor` (the supervisor's `view`), or null on a board without one (a copy
 * beside the person's board): its head (B573: the counts, see `supervisorHead`; with `status`, what a "Check now" came to,
 * see `checkStatusOf`, `isPressed` while the press is on its way), a note (when open, the 24 h line first, see `supervisorLast24`; then when it checked itself, and its
 * schedule), the incident cards (one per fix step; B573: a card with an incident new since `seenAt` carries New and comes
 * first), the last check (the newest one asked, or one that found something, for an hour), the rules (those that tripped
 * now or today first, how often, a failed one with why; the rest counted as fine) and the last sweep, or "No sweep yet".
 */
function supervisorOf(view, { seenAt = null, isOpen = true, now = Date.now(), isPressed = false } = {}) {
  if (view === null || view === undefined) return null
  const run = view.run ?? null
  const rules = (view.rules ?? []).map(rule => ({
    id: rule.id, says: rule.says, tone: rule.state === 'failed' ? 'failed' : rule.state === 'tripped' ? 'tripped' : rule.state === 'fine' ? 'fine' : 'unchecked',
    often: Number(rule.trips) > 0 ? `${rule.trips}× today` : rule.state === null || rule.state === undefined ? 'not checked yet' : 'fine today',
    why: rule.state === 'failed' ? rule.why ?? 'it failed' : null,
  }))
  // Those that tripped now or earlier today, or failed, first; the rest only when the person asks for them.
  const isShown = rule => rule.tone === 'tripped' || rule.tone === 'failed' || /× today$/.test(rule.often)
  const shown = rules.filter(isShown)
  const tripped = rules.filter(rule => rule.tone === 'tripped').length
  const failed = rules.filter(rule => rule.tone === 'failed').length
  const every = Number.isFinite(view.sweepEvery) ? view.sweepEvery : 0
  // One card per fix step, those with something new first; the fixed ones beyond the newest few fold away.
  const byId = new Map((view.incidents ?? []).map(one => [one.id, one]))
  const fresh = new Set((view.incidents ?? []).filter(one => isNewIncident(one, seenAt, now)).map(one => one.id))
  // A card lists only the incidents counted (every open one; a fixed one of the last 24 h), and one with none is left out.
  const counted = card => (card.incidents ?? []).filter(one => isCountedIncident(byId.get(one.id), card.phase ?? null, now))
  const drawn = (view.cards ?? []).filter(card => counted(card).length > 0)
    .map(card => ({ ...card, incidents: counted(card) }))
    .map(card => ({ ...incidentCardOf(card, byId, now), isNew: (card.incidents ?? []).some(one => fresh.has(one.id)) }))
  // The person, 2026-10-26 ("why is it not showing the open tickets first?"): the open cards first, the new among them
  // first, then the fixed ones, the new among those first.
  const isOpenCard = card => card.tone !== 'done'
  const cards = [true, false].flatMap(isOpen => [true, false].flatMap(isNew => drawn.filter(card => isOpenCard(card) === isOpen && card.isNew === isNew)))
  let fixed = 0
  const older = cards.filter(card => card.tone === 'done' && !card.isNew && (fixed += 1) > FIXED_CARDS_SHOWN)
  const checked = Number.isFinite(view.checkedAt) ? `Checked itself at ${clock(view.checkedAt)}.` : 'Not checked yet.'
  const counts = supervisorCounts(view, seenAt, now)
  const schedule = every > 0
    ? `${checked} It checks every 3 min and sweeps every ${every} min while work runs; Check now does both.`
    : `${checked} It checks every 3 min; Check now checks and sweeps at once.`
  return {
    head: supervisorHead(counts),
    // What a "Check now" is doing or came to (null for nothing): the word after the counts, folded or open.
    status: checkStatusOf(view, { isPressed, now }),
    // Open, the note's first line is the 24 h line (a line break, kept on the page); folded, the section draws no note.
    note: isOpen ? `${supervisorLast24(counts)}\n${schedule}` : schedule,
    cards: cards.filter(card => !older.includes(card)),
    older,
    check: run === null ? null : { head: `Last check at ${clock(run.at)}${run.asked ? `, asked${run.subject ? ` about ${run.subject}` : ''}` : ''}`, rows: checkRowsOf(run) },
    rules: { head: `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}${tripped > 0 ? ` · ${tripped} tripped` : ''}${failed > 0 ? ` · ${failed} failed` : ''}`, shown, rest: rules.filter(rule => !isShown(rule)) },
    sweep: sweepLineOf(view),
  }
}

/** A count of tokens in words: "31,200 tokens". */
const tokenWords = count => `${Math.round(count).toLocaleString('en-US')} tokens`

/**
 * The supervisor's Part 2: the last sweep of its chat, in one line: asked or by the clock, about whom, running or what it
 * found and cost; why the newest did not run (Check now, or the clock, with the supervisor's chat missing); the day's
 * sweeps and their tokens. "No sweep yet." before the first.
 */
function sweepLineOf(view) {
  const sweep = view.lastSweep ?? null
  const refused = view.sweepNote ?? null
  const about = one => `${one.asked ? 'asked' : 'by the clock'}${one.subject ? `, about ${one.subject}` : ''}`
  const parts = []
  if (refused !== null) parts.push(`No sweep at ${clock(refused.at)}: ${refused.why}.`)
  if (sweep === null) {
    if (refused === null) parts.push('No sweep yet.')
  } else if (!Number.isFinite(sweep.ended)) {
    parts.push(`Sweep at ${clock(sweep.at)} (${about(sweep)}): running${sweep.note ? `; ${sweep.note}` : ''}.`)
  } else {
    const found = sweep.found === 1 ? 'one finding' : `${sweep.found ?? 0} findings`
    const cost = Number.isFinite(sweep.tokens) ? `, ${tokenWords(sweep.tokens)}` : ', its tokens not read yet'
    parts.push(`Last sweep at ${clock(sweep.at)} (${about(sweep)}): ${found}${cost}${sweep.note ? `; ${sweep.note}` : ''}.`)
  }
  const today = view.sweepsToday ?? null
  if (today !== null && today.count > 1) parts.push(`Today ${today.count} sweeps, ${tokenWords(today.tokens)}.`)
  return parts.join(' ')
}

/** B573: the section stands on every board with a supervisor, folded to its head line unless the person opened it. */
function isSupervisorShown(view) {
  return view !== null && view !== undefined
}

/**
 * B573: the person's one line under Needs your attention for the supervisor's notes there (one per new or returning
 * incident, Via supervisor) not read yet: "Supervisor: 3 new findings", with the notes' ids, read once the section is
 * opened; null for none. B581: its x reads them too, and `isClosing` (a note whose read is on its way) leaves the line at
 * once; a new or returning incident is a new note, so it brings a line back.
 */
function supervisorLine(information, isClosing = () => false) {
  const ids = (information ?? []).filter(one => one.via === 'supervisor' && one.isRead !== true && !isClosing(one.id)).map(one => one.id)
  if (ids.length === 0) return null
  return { ids, text: `Supervisor: ${ids.length === 1 ? 'one new finding' : `${ids.length} new findings`}` }
}

/** B573: the keys the page keeps the section under (localStorage): opened or folded, and when the person last opened it. */
const SUPERVISOR_KEEP = { open: 'supervisor-open', seenAt: 'supervisor-seen-at', shownSince: 'supervisor-shown-since' }

/**
 * B573: the section as the page kept it across a reload (`storage`, localStorage): folded unless kept open; `seenAt`
 * when the person last opened it, `shownSince` the opening before that (the New tags of the open section stand against
 * it, so opening does not wipe them at once). Nothing kept, or storage that throws: folded, never opened.
 */
function supervisorKept(storage) {
  const time = key => {
    const value = Number(storage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : null
  }
  try {
    return { isOpen: storage.getItem(SUPERVISOR_KEEP.open) === 'yes', seenAt: time(SUPERVISOR_KEEP.seenAt), shownSince: time(SUPERVISOR_KEEP.shownSince) }
  } catch {
    return { isOpen: false, seenAt: null, shownSince: null }
  }
}

/** B573: opens or folds the section (`ui`, `supervisorKept`'s shape) and keeps it in `storage`; opening marks all seen. */
function foldSupervisor(ui, isOpen, storage, now) {
  if (isOpen && !ui.isOpen) {
    ui.shownSince = ui.seenAt
    ui.seenAt = now
  }
  ui.isOpen = isOpen
  try {
    storage.setItem(SUPERVISOR_KEEP.open, isOpen ? 'yes' : 'no')
    if (ui.seenAt !== null) storage.setItem(SUPERVISOR_KEEP.seenAt, String(ui.seenAt))
    if (ui.shownSince !== null) storage.setItem(SUPERVISOR_KEEP.shownSince, String(ui.shownSince))
    else storage.removeItem(SUPERVISOR_KEEP.shownSince)
  } catch { /* a browser without storage: kept for this visit only */ }
  return ui
}
// supervisor:end

/** B573: the page's own storage for the section's fold, or null where the browser blocks it (then nothing is kept). */
const supervisorStorage = (() => {
  try { return localStorage } catch { return null }
})()
/** The supervisor's section: folded to its head line or opened by the person (B573: kept across reloads), and what shows in it. */
const supervisorUi = { ...supervisorKept(supervisorStorage), showsRules: false, showsOlder: false, openCards: new Set() }

/** Whether a "Check now" (the board's, or a worker's menu: the key `sync:<chat>`) is on its way to the board. */
function isCheckPressed() {
  return [...sending].some(key => String(key).startsWith('sync:'))
}

/** The quiet word after the section head's counts (see `checkStatusOf`): "checking…", "checked 15:26: nothing new"; null for none. */
function checkStatusPart(status) {
  if (status === null || status === undefined) return null
  const part = el('span', `supervisor-check is-${status.tone}`, status.text)
  part.title = status.title
  return part
}

/**
 * "Check now" with its wrench, in the button's own colour: the board's own check at once (`sync` to the server). From the
 * press until the asked sweep has ended every such button reads "Checking…" and is disabled (see `checkStatusOf`).
 */
function checkNowButton(about, state, title) {
  const isChecking = checkStatusOf(state.supervisor ?? null, { isPressed: isCheckPressed(), now: Date.now() })?.state === 'checking'
  const button = el('button', 'quiet-button sync-button check-now')
  button.type = 'button'
  button.dataset.sync = about
  button.disabled = state.changeAsks?.sync?.[about]?.isOpen === true || sending.has(`sync:${about}`) || isChecking
  button.title = state.changeAsks?.sync?.[about]?.isOpen === true ? 'Checked: the main chat answers here' : isChecking ? 'Checking: the rules run at once, then the supervisor\'s chat sweeps the board' : title
  const wrench = icon('wrench')
  wrench.setAttribute('aria-hidden', 'true')
  button.append(wrench, el('span', '', isChecking ? 'Checking…' : 'Check now'))
  return button
}

/**
 * One incident card (see `incidentCardOf`): the step's id (a link that opens it) and title, the chip with its live state,
 * the one quiet line, and, once the person clicked the card, each incident's evidence, times and count.
 */
function drawIncidentCard(card, isOpen) {
  const box = el('article', `inc-card is-${card.tone}${card.isNew ? ' is-new' : ''}${isOpen ? ' is-open' : ''}`)
  box.dataset.supervisorCard = card.key
  const top = el('div', 'inc-top')
  // B573: found since the person last opened the section: a quiet tag, never the person's attention colours.
  if (card.isNew) top.append(el('span', 'inc-new', 'New'))
  if (card.step !== null) {
    const link = el('a', 'inc-step', card.step)
    link.href = card.href
    link.dataset.supervisorStep = card.step
    link.title = `Opens ${card.step}`
    top.append(link)
  }
  top.append(el('span', 'inc-title', card.title), el('span', `inc-state is-${card.tone}`, card.state))
  // 2026-10-26: several incidents are a row each inside the one button; one incident (or a fixed card) is its one line of text.
  const line = el('button', 'inc-line', card.lines.length > 1 ? null : card.line)
  if (card.lines.length > 1) line.append(...card.lines.map(text => el('span', 'inc-row', text)))
  line.type = 'button'
  line.setAttribute('aria-expanded', String(isOpen))
  line.title = isOpen ? 'Fold the evidence away' : 'Click for the evidence, the times and the counts'
  box.append(top, line)
  if (isOpen) {
    const details = el('div', 'inc-details')
    for (const one of card.details) {
      const part = el('div', 'inc-detail')
      part.append(el('div', 'inc-detail-head', `${one.id} · ${one.title}`), el('div', 'inc-detail-meta', `${one.state} · ${one.seen}`))
      if (one.evidence !== null) part.append(el('div', 'inc-detail-evidence', `Evidence: ${one.evidence}`))
      if (one.ruleWanted !== null) part.append(el('div', 'inc-detail-evidence', `Rule wanted: ${one.ruleWanted}`))
      details.append(part)
    }
    box.append(details)
  }
  return box
}

/** The supervisor's section under the Workers panel's head (see `supervisorOf`). B573: folded to one head line with its
 * counts until the person opens it; open, the New tags stand against the opening before (`shownSince`). */
function drawSupervisor(state) {
  const view = state.supervisor ?? null
  const shown = isSupervisorShown(view)
  const isOpen = supervisorUi.isOpen
  const main = state.workers?.main ?? null
  // What a Check now is doing or came to stands in the signature: the word changes, and goes 10 minutes after, by itself.
  const isPressed = isCheckPressed()
  const status = shown ? checkStatusOf(view, { isPressed, now: Date.now() }) : null
  once('supervisor', [view, shown, isOpen, supervisorUi.seenAt, supervisorUi.shownSince, supervisorUi.showsRules, supervisorUi.showsOlder, [...supervisorUi.openCards], main, state.changeAsks?.sync?.board ?? null, sending.has('sync:board'), status], () => {
    const box = $('supervisor')
    box.hidden = !shown
    box.classList.toggle('is-folded', !isOpen)
    if (!shown) return fill(box, [])
    const part = supervisorOf(view, { seenAt: isOpen ? supervisorUi.shownSince : supervisorUi.seenAt, isOpen, now: Date.now(), isPressed })
    const toggle = el('button', 'supervisor-fold')
    toggle.type = 'button'
    toggle.dataset.supervisorFold = ''
    toggle.setAttribute('aria-expanded', String(isOpen))
    toggle.title = isOpen ? 'Fold the section to this line' : 'Open the incidents, the rules and the last sweep; what is new is then seen'
    const wrench = icon('wrench')
    wrench.setAttribute('aria-hidden', 'true')
    fill(toggle, [el('span', 'supervisor-caret', isOpen ? '▾' : '▸'), wrench, el('span', 'supervisor-title', part.head), checkStatusPart(part.status)])
    const head = el('header', 'supervisor-head')
    head.append(toggle, el('span', 'grow'), ...(main === null ? [] : [boardSyncButton(state)]))
    if (!isOpen) return fill(box, [head])
    const parts = [head, el('p', 'supervisor-note', part.note)]
    const cards = supervisorUi.showsOlder ? [...part.cards, ...part.older] : part.cards
    if (cards.length > 0) {
      const list = el('div', 'supervisor-cards')
      for (const card of cards) list.append(drawIncidentCard(card, supervisorUi.openCards.has(card.key)))
      parts.push(el('h4', 'supervisor-sub', 'Incidents and what is being done about them'), list)
      if (part.older.length > 0) {
        const older = el('button', 'quiet-button supervisor-more', supervisorUi.showsOlder ? 'Hide the older fixed ones' : `Show ${part.older.length} older fixed`)
        older.type = 'button'
        older.dataset.supervisorOlder = ''
        parts.push(older)
      }
    }
    if (part.check !== null) {
      const rows = el('div', 'sync-rows')
      for (const row of part.check.rows) rows.append(el('span', `sync-status is-${row.tone}`, row.status), el('span', 'sync-text', row.text))
      parts.push(el('h4', 'supervisor-sub', part.check.head), rows)
    }
    // The rules stay one folded line ("20 rules · 2 tripped"); a click opens the list.
    const fold = el('button', 'quiet-button supervisor-more supervisor-rules-line', `${supervisorUi.showsRules ? '▾' : '▸'} ${part.rules.head}`)
    fold.type = 'button'
    fold.dataset.supervisorRules = ''
    fold.setAttribute('aria-expanded', String(supervisorUi.showsRules))
    parts.push(fold)
    if (supervisorUi.showsRules) {
      const rules = el('div', 'supervisor-rules')
      for (const rule of [...part.rules.shown, ...part.rules.rest]) {
        const row = el('div', `rule is-${rule.tone}`)
        row.title = rule.id
        row.append(el('span', 'rule-dot'), el('span', 'rule-says', rule.says), el('span', 'rule-often', rule.often))
        if (rule.why !== null) row.append(el('span', 'rule-why', rule.why))
        rules.append(row)
      }
      parts.push(rules)
    }
    parts.push(el('p', 'supervisor-sweep', part.sweep))
    fill(box, parts)
  })
}

/** B573: the supervisor's one line under Needs your attention (see `supervisorLine`); a click opens the section. */
function drawSupervisorLine(line) {
  if (line === null) return null
  const part = el('div', 'supervisor-lines')
  const button = el('button', 'supervisor-line')
  button.type = 'button'
  button.dataset.supervisorLine = line.ids.join(' ')
  button.title = 'Opens the supervisor\'s section; its findings are then read'
  const wrench = icon('wrench')
  wrench.setAttribute('aria-hidden', 'true')
  button.append(wrench, el('span', '', line.text))
  // B581: the x closes only this line (its notes read); the incidents stay open, counting, in the section.
  const close = el('button', 'icon-button supervisor-line-close', '×')
  close.type = 'button'
  close.dataset.supervisorClose = line.ids.join(' ')
  close.title = 'Close this line; the incidents stay open'
  close.setAttribute('aria-label', 'Close this line; the incidents stay open')
  const row = el('div', 'supervisor-line-row')
  row.append(button, close)
  part.append(row)
  return part
}

/** B573: opens or folds the supervisor's section and keeps it so; opening marks what is new seen and reads its notes. */
function setSupervisorOpen(isOpen) {
  foldSupervisor(supervisorUi, isOpen, supervisorStorage, Date.now())
  if (isOpen) readSupervisorNotes()
  if (board !== null) {
    drawLanes(board)
    drawSupervisor(board)
  }
}

/** B573: the supervisor's notes under Needs your attention count as read once the section is opened (B581: or `ids`, its x). */
function readSupervisorNotes(ids = supervisorLine(board?.information)?.ids ?? []) {
  for (const id of ids) {
    if (!sending.has(`read:${id}`)) sendWork({ action: 'read', id }, `read:${id}`)
  }
}

/** Opens the supervisor's section (in Details: Simple leaves the Workers panel out) and brings it into sight. */
function openSupervisor() {
  if ($('view-overview').dataset.mode === 'simple') document.querySelector('#overview-mode [data-overview-mode="details"]')?.click()
  setSupervisorOpen(true)
  $('supervisor').scrollIntoView({ block: 'nearest' })
}

/** B406: the note on top about the data files set aside at the start (see `setAsideNote`). */
function drawSetAsideNote(state) {
  const text = setAsideNote(state.setAside)
  const note = $('set-aside-note')
  note.hidden = text === null
  if (text !== null) note.textContent = text
}

/** B296, B301: the note on top about the work store (see `storeNote`). */
function drawStoreNote(state) {
  const shown = storeNote(state.store ?? null, state.workFlags ?? [])
  const note = $('store-note')
  note.hidden = shown === null
  if (shown !== null) note.textContent = shown.text
}

/** B404: the note on top when a background loop of the board keeps failing ("Delivery failing since 23:10 (...)"). */
function drawLoopsNote(state) {
  const line = typeof state.loops?.line === 'string' && state.loops.line !== '' ? state.loops.line : null
  const note = $('loops-note')
  note.hidden = line === null
  if (line !== null) {
    note.textContent = line
    note.title = "The board keeps trying; its errors are in board-errors.log in the project's .claude folder."
  }
}

/** B454: nothing is open or being typed: no popup, no field with focus or with words in it, nothing on its way. */
function isPageIdle() {
  if (document.querySelector('dialog[open]') !== null || sending.size > 0) return false
  const isText = field => field.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="number"]')
  if (document.activeElement !== null && document.activeElement !== document.body && document.activeElement.matches('input, textarea, select, [contenteditable]')) return false
  return ![...document.querySelectorAll('textarea, input')].some(field => isText(field) && field.value.trim() !== '')
}

/** B524: the words in the page's own boxes, by element id (the Talk to Main and Advisor boxes, the Goals and Design boxes, ...). */
function boxesWithWords() {
  const isText = field => field.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="number"]')
  return Object.fromEntries([...document.querySelectorAll('textarea[id], input[id]')].filter(field => isText(field) && field.value.trim() !== '').map(field => [field.id, field.value]))
}

/** B524: writes what the person did on the page into sessionStorage, for `restoreKept` after the reload. */
function keepForReload() {
  try {
    // A reload before the first draw: what the last one kept was not put back yet, so it stays kept.
    if (kept !== null && keptText !== null) return sessionStorage.setItem(KEPT_KEY, keptText)
    sessionStorage.setItem(KEPT_KEY, keptState({
      drafts, words: calmWords, picks: calmPicks, chosen, forms: openForms,
      fields: boxesWithWords(), focusWords: focusUi.words, details: detailsOf,
    }))
  } catch { /* full or blocked: the page still loads */ }
}

/** B524: the one way the page loads itself anew: what the person did is kept first. */
function reloadPage() {
  keepForReload()
  location.reload()
}

/** B524: puts back what `keepForReload` kept, once, before the first draw. The popup opens at the end of that draw. */
function restoreKept() {
  const back = kept
  kept = null
  if (back === null) return
  for (const [name, text] of back.drafts) drafts.set(name, text)
  for (const [name, text] of back.words) calmWords.set(name, text)
  for (const [name, pick] of back.picks) calmPicks.set(name, pick)
  for (const [name, choice] of back.chosen) chosen.set(name, choice)
  for (const id of back.forms) openForms.add(id)
  for (const [key, text] of back.focusWords) if (key in focusUi.words) focusUi.words[key] = text
  for (const [id, text] of back.fields) {
    const box = $(id)
    if (box !== null && box.value === '') {
      box.value = text
      restoredBoxes.push(box)
    }
  }
  detailsOf = back.details
}

/** B524: after the first draw: the boxes hear of their words, and the popup that was open opens again. */
function finishRestore() {
  for (const box of restoredBoxes.splice(0)) box.dispatchEvent(new Event('input', { bubbles: true }))
  if (detailsOf !== null && !$('details').open && $('details').childNodes.length > 0) $('details').showModal()
}

/** The note on top (see `updateView`). B454: a newer page loads itself when the page is idle; a short note says so after. */
function drawUpdate(state) {
  const note = $('update-note')
  const lastAt = Number(sessionStorage.getItem('page-updated-at') ?? 0)
  if (reloadsNow(state.version, PAGE, { isIdle: isPageIdle(), lastAt, now: Date.now() })) {
    sessionStorage.setItem('page-updated-at', String(Date.now()))
    reloadPage()
    return
  }
  const shown = updateView(state.version, PAGE, { isStarting: sending.has('board-anew'), problem: problems.get('board-anew') ?? null }) ?? updatedView(lastAt, Date.now())
  note.hidden = shown === null
  if (shown === null) return
  note.className = `update-note is-${shown.tone}`
  note.textContent = shown.text
  note.disabled = shown.action === null
}

$('update-note').addEventListener('click', async () => {
  const shown = board === null ? null : updateView(board.version, PAGE, { isStarting: sending.has('board-anew'), problem: problems.get('board-anew') ?? null })
  if (shown === null || shown.action === null) return
  if (shown.action === 'reload') return reloadPage()
  sending.add('board-anew')
  problems.delete('board-anew')
  drawUpdate(board)
  try {
    const answer = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: '{}' })
    if (!answer.ok) throw new Error((await answer.text()).trim() || `refused (${answer.status})`)
    // The board ends and comes back with a new token: the page then loads itself anew (see `read`).
  } catch (error) {
    sending.delete('board-anew')
    problems.set('board-anew', `Not started: ${error instanceof Error ? error.message : 'the board did not answer'}`)
    drawUpdate(board)
  }
})

// The top bar

/** B327: the Overview's simple view: the bar and its chips, and which view is up (Simple or Details). */
function drawSimpleOverview(state) {
  const view = simpleView({ focus: state.focus ?? null, counts: state.counts ?? {}, limits: state.limits ?? null, milestone: state.milestone ?? null })
  const parts = []
  if (view.bar !== null) {
    const line = el('div', 'simple-line')
    line.title = view.bar.title
    line.append(el('b', '', view.bar.text))
    parts.push(line)
    if (view.bar.percent !== null) parts.push(simpleTrack(view.bar.percent))
  } else {
    parts.push(el('p', 'simple-none', 'No goal is your focus yet: pick one on the Focus tab.'))
  }
  const chips = el('div', 'simple-chips')
  const busy = el('span', `simple-chip${view.busy.isBusy ? ' is-busy' : ''}`)
  busy.append(el('span', 'dot'), view.busy.text)
  chips.append(busy)
  if (view.limit !== null) chips.append(el('span', `simple-chip is-${view.limit.tone}`, view.limit.text))
  parts.push(chips)
  // B322, B335: a new project's Initialise button stands here too: the simple view hides the workers.
  const setup = setupChat(state)
  if (setup !== null) parts.push(setupBox(setup, hasOtherChats(state)))
  fill($('simple-bar'), parts)
  drawSimpleColumns(state)
  showOverviewMode()
}

/** A thin bar filled to `percent`, as the simple view draws its bars. */
function simpleTrack(percent, isSmall = false) {
  const track = el('div', `simple-track${isSmall ? ' is-small' : ''}`)
  const fillBar = el('span', '')
  fillBar.style.width = `${percent}%`
  track.append(fillBar)
  return track
}

/**
 * B343: the simple view's two columns beside Needs your attention: the focus goal's steps, and the workers. Drawn again
 * only when what they say changes (a time changes by the minute), so a tooltip or a selection stays put.
 */
function drawSimpleColumns(state) {
  const steps = simpleSteps(state.focus ?? null, state.chats ?? [], state.readAt)
  // B424: the partner and its helper under the workers, apart from them.
  const workers = simpleWorkers(state.chats ?? [], state.counts ?? {}, state.readAt, [state.advisor, state.advisorHelper])
  once('simple-columns', [steps, workers], () => fillSimpleColumns(steps, workers))
}

/** B343: fills the two columns from their views (simpleSteps, simpleWorkers). */
function fillSimpleColumns(steps, workers) {
  const focusHead = el('h2', 'simple-col-head', 'Your focus: its tasks')
  if (steps !== null) focusHead.append(el('small', 'muted', steps.goal))
  const focusRows = steps === null ? [el('p', 'simple-none', 'No goal is your focus yet.')]
    : steps.empty !== null ? [el('p', 'simple-none', steps.empty)]
      : steps.rows.map(row => {
        const line = el('div', `simple-row is-${row.tone}`)
        const what = el('span', 'simple-what clip')
        what.append(el('b', 'task-code', row.id), ' ', row.title)
        what.title = `${row.id} ${row.title}`
        line.append(el('span', `simple-state is-${row.tone}`, row.chip), what)
        if (row.who !== null) line.append(el('span', 'simple-who', row.who))
        return line
      })
  fill($('simple-focus'), [focusHead, ...focusRows])
  const workersHead = el('h2', 'simple-col-head', 'Workers')
  workersHead.append(el('small', 'muted', workers.busy))
  const rowOf = row => {
    const line = el('div', `simple-row simple-worker is-${row.tone}`)
    const middle = el('div', 'simple-task')
    if (row.task === null) middle.append(el('span', 'muted', row.left))
    else {
      const what = el('span', 'simple-what clip')
      if (row.code !== null) what.append(el('b', 'task-code', row.code), ' ')
      what.append(row.task)
      what.title = row.code === null ? row.task : `${row.code} ${row.task}`
      middle.append(what)
      if (row.percent !== null) middle.append(simpleTrack(row.percent, true))
    }
    // The time (or nothing, for a chat without a task) with the model chip under it.
    const end = el('div', 'simple-end')
    end.append(el('b', 'simple-left', row.task === null ? '' : row.left))
    const chip = drawRunChip(row.run ?? null)
    if (chip !== null) end.append(chip)
    line.append(el('b', 'simple-name', row.name), middle, end)
    return line
  }
  const workerRows = workers.rows.map(rowOf)
  // B424: the partner and its helper, under their own small head: they take no queue.
  const partnerRows = (workers.partner ?? []).length === 0 ? [] : [el('h3', 'simple-sub-head', 'Advisor'), ...workers.partner.map(rowOf)]
  fill($('simple-workers'), [workersHead, ...(workerRows.length > 0 ? workerRows : [el('p', 'simple-none', 'No chats on the board yet.')]), ...partnerRows])
}

/**
 * B327: puts the Overview in the view the person chose and marks the switch: `chosen` when a click chose it (it holds
 * for this visit even where the browser keeps nothing), else the one this browser kept, else Simple.
 */
function showOverviewMode(chosen = null) {
  let stored = null
  try { stored = localStorage.getItem('overview-mode') } catch { /* a browser without storage shows Simple */ }
  const mode = overviewMode(chosen ?? overviewChosen ?? stored)
  $('view-overview').dataset.mode = mode
  for (const button of document.querySelectorAll('[data-overview-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.overviewMode === mode))
  }
}

/** The view chosen by a click in this visit (null: none yet), so it holds where the browser keeps nothing. */
let overviewChosen = null
$('overview-mode').addEventListener('click', event => {
  const button = event.target.closest('[data-overview-mode]')
  if (button === null) return
  overviewChosen = overviewMode(button.dataset.overviewMode)
  try { localStorage.setItem('overview-mode', overviewChosen) } catch { /* kept for this visit only */ }
  showOverviewMode(overviewChosen)
})
// The chosen view from the start, before the board is first read.
showOverviewMode()

function drawTop(state) {
  const updated = $('updated')
  updated.textContent = `Last updated ${clock(state.readAt)}${state.isDemo ? ' · demo data' : ''}`
  // B327: a failure in the simple view must not stop the rest of the board from drawing
  try { drawSimpleOverview(state) } catch (error) { console.error('[board] the simple view:', error) }
  $('version').textContent = versionLine(state.version)
  updated.classList.remove('is-stale')
  // B307: "0 waiting for you" goes; the yellow count shows when something waits.
  fill($('counts'), shownCounts(state.counts)
    .map(name => {
      const pill = el('div', `count-pill is-${name}`)
      pill.append(el('span', 'dot'), el('b', '', String(state.counts[name])), STATES[name].toLowerCase())
      return pill
    }).concat(estimatesPill(state.taskTimes ?? null)))
  for (const node of document.querySelectorAll('time[data-at]')) node.textContent = ago(Number(node.dataset.at), state.readAt)
}

// tasktimes:start
// B185: how long tasks really take, as the board measured it (src/taskTimes.mjs). The person, 2026-10-14: "a
// finished task shows 'estimate 1 h, took 6 min', and the board shows how far estimates were off lately".

/** Minutes as the chats write them: "45 min", "1 h", "1 h 30 min". */
function minutesWords(minutes) {
  const whole = Math.round(minutes)
  if (whole < 60) return `${whole} min`
  return whole % 60 === 0 ? `${whole / 60} h` : `${Math.floor(whole / 60)} h ${whole % 60} min`
}

/** A finished step's times: "estimate 1 h, took 6 min", "took 6 min" without an estimate, or '' when not measured. */
function tookWords(measured) {
  if (measured === undefined || measured === null) return ''
  return `${measured.estimateMin === null ? '' : `estimate ${minutesWords(measured.estimateMin)}, `}took ${minutesWords(measured.workMin)}`
}

/** How far estimates were off lately, for the Overview: `{ text, title }`, or null before anything was measured. */
function estimatesLine(times) {
  if (times === null || times.lately === undefined || times.lately.count === 0 || times.lately.off === null) return null
  const areas = times.areas.map(area => `${area.area}: ${area.count} tasks, typically ${minutesWords(area.typicalMin)}${area.off === null ? '' : `, estimates ${area.off}`}${area.isEnough ? '' : ' (too few to go by)'}`)
  return {
    text: `Estimates lately: ${times.lately.off}`,
    title: [`The last ${times.lately.count} finished tasks with an estimate, against their real working time.`, ...areas].join('\n'),
  }
}
// tasktimes:end

/** B185: the Overview's pill with how far estimates were off lately; none before anything was measured. */
function estimatesPill(times) {
  const line = estimatesLine(times)
  if (line === null) return []
  const pill = el('div', 'count-pill is-estimates', line.text)
  pill.title = line.title
  return [pill]
}

// limits:start
// B113: the plan's limits in the head, a worker held by the limit, and why a queued step is not started.

/** A figure the app has not renewed for this long is old: it samples about every quarter of an hour while it is open. */
const LIMIT_OLD_MS = 20 * MIN
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A moment as its clock time, with the weekday in front when it is not today. */
function dayClock(at, now) {
  const [then, today] = [new Date(at), new Date(now)]
  const isToday = then.getFullYear() === today.getFullYear() && then.getMonth() === today.getMonth() && then.getDate() === today.getDate()
  return isToday ? clock(at) : `${WEEKDAYS[then.getDay()]} ${clock(at)}`
}

/**
 * What the head shows of the limits: `five` and `week` as `{ name, value, width, tone, under }` (null for a limit
 * nothing is known of) and `age`, how old the figure is. Null when neither is known. `tone` is the limit's level:
 * `ok`, `warn` from about 80%, `full` when it is reached.
 */
function limitsView(limits, now) {
  const [five, week] = [limits?.fiveHour ?? null, limits?.week ?? null]
  if (five === null && week === null) return null
  const width = limit => (limit.level === 'full' ? 100 : Math.max(0, Math.min(100, Math.round(limit.used))))
  const fiveUnder = () => {
    if (five.resetAt !== null) return `reset at ${clock(five.resetAt)}`
    if (five.resetsAt === null) return 'reset time not known yet'
    return `${five.level === 'full' ? 'work goes on at' : 'resets'} ${clock(five.resetsAt)} · in ${span(five.resetsAt - now)}`
  }
  // The age is that of a figure something gave: an empty bar after a reset is the board's own conclusion.
  const read = [five, week].filter(limit => limit !== null && limit.resetAt === null).map(limit => limit.at)
  const newest = read.length === 0 ? null : Math.max(...read)
  return {
    five: five === null ? null : { name: '5-hour limit', value: five.level === 'full' ? 'Limit reached' : `${Math.round(five.used)}% used`, width: width(five), tone: five.level, under: fiveUnder() },
    week: week === null ? null : {
      name: 'Week',
      value: week.level === 'full' ? 'Reached' : `${Math.round(week.used)}%`,
      width: width(week),
      tone: week.level,
      under: week.resetsAt === null ? 'reset not known' : `${week.level === 'full' ? 'until' : 'resets'} ${dayClock(week.resetsAt, now)}`,
    },
    age: newest === null ? { text: 'no figure since the reset', isOld: false } : { text: `read ${ago(newest, now)}`, isOld: now - newest > LIMIT_OLD_MS },
  }
}

const LIMIT_NAMES = { fiveHour: 'session', week: 'weekly' }

/** Why a queued step is not started, as one line, and whether the limit is the reason (`tone`). Null without a reason. */
function whyText(why) {
  if (why === null || why === undefined) return null
  const said = (tone, words) => ({ tone, text: `Not started: ${words}` })
  switch (why.reason) {
    case 'limit': return said('limit', `the ${LIMIT_NAMES[why.limit] ?? 'session'} limit is reached${why.limit === 'fiveHour' && why.until !== null ? `, work goes on at ${clock(why.until)}` : ''}`)
    case 'suspended': return why.by === 'parked' ? said('wait', `${why.worker} is suspended on purpose`) : said('limit', why.isBack ? `${why.worker} has not gone on since the limit came back` : `${why.worker} is suspended${why.until === null ? '' : ` until ${clock(why.until)}`}`)
    case 'after': {
      if (!Array.isArray(why.steps)) return said('wait', `after ${why.words}`)
      // B542: a step in review is waited on for its check.
      const checks = Array.isArray(why.checks) ? why.checks : []
      const [last, ...first] = why.steps.map(id => (checks.includes(id) ? `the check of ${id}` : id)).reverse()
      return said('wait', `waits for ${first.length === 0 ? last : `${first.reverse().join(', ')} and ${last}`}`)
    }
    case 'busy': return said('wait', `${why.worker} is busy${why.leftMs === null ? '' : `, about ${span(why.leftMs)} left`}`)
    case 'you': return said('wait', `${why.worker} waits for you`)
    case 'cut': return said('wait', `${why.worker} was cut off`)
    // B315: its process does not run since the app was opened again.
    case 'off': return said('wait', `${why.worker} is not running`)
    // Redesign Part 2: the board hands it out: given to its free worker, which takes it now; or pinned to it.
    case 'ready': return said('plain', why.isPinned ? `pinned to ${why.worker}; the board gives it once nothing holds it` : `given to ${why.worker}; it takes it now`)
    case 'nobody': return said('plain', 'no worker is named for it')
    default: return said('plain', `the state of ${why.worker ?? 'its worker'} is not known`)
  }
}

/**
 * The person, 2026-10-28 ("i expect red mean unexpected ... i feel pausing is better to have it purple, suspended"): while
 * the person pauses all chats, a chat that stopped with its task open and wrote its checkpoint since the pause stopped as
 * asked: the page shows it suspended by the pause, not interrupted. One with no checkpoint since the pause (the pause
 * view's `unsaved`) stays interrupted: that one is unexpected. Only what the page shows changes; the board's own reading
 * of the chat stays as it is. Plain data in, a copy out.
 */
function pausedLanes(chats, pause) {
  if (pause?.state !== 'pausing' || !Array.isArray(chats)) return chats
  const unsaved = pause.unsaved ?? []
  // Its own step decides (the person's look, 13:40: Worker 3 checkpointed B757 and stayed red for B736, a step of it in
  // review); a lane that names no step is decided by any step of its chat.
  const isUnsaved = lane => {
    const id = lane.task?.stepId ?? null
    return unsaved.some(one => one?.chat === lane.name && (id === null || one.id === id))
  }
  // T13 part 3: an asleep one (its process ended with its turn cut) waits for Resume all too: the board sends it nothing meanwhile.
  return chats.map(lane => (lane?.state === 'interrupted' && (lane.asleep === true || !isUnsaved(lane)) ? { ...lane, state: 'suspended', suspended: { by: 'pause', since: pause.since ?? null, until: null, isBack: false } } : lane))
}

/** What a suspended lane says: who held it (the app's stop, or its own pause) and when it goes on. */
function heldText(held) {
  if (held.by === 'pause') return 'Paused by you · stopped at its checkpoint; goes on at Resume all'
  if (held.by === 'parked') return `Suspended on purpose · goes on once ${held.on.join(' and ')} ${held.on.length === 1 ? 'is' : 'are'} done`
  const who = `${held.by === 'app' ? 'Stopped by the app at' : 'Paused for'} the ${LIMIT_NAMES[held.limit] ?? 'session'} limit`
  if (held.isBack) return `${who} · the limit is back${held.until === null ? '' : ` since ${clock(held.until)}`}, and it has not gone on yet`
  return `${who} · ${held.until === null ? 'no time known yet' : `goes on at ${clock(held.until)}`}`
}
// limits:end

/** One limit as a bar: its name and figure above, what is known of its reset under it. */
function drawLimit(shown, isSmall) {
  const box = el('div', `limit is-${shown.tone}${isSmall ? ' is-small' : ''}`)
  const top = el('div', 'limit-top')
  top.append(el('span', '', shown.name), el('b', '', shown.value))
  const bar = el('div', 'limit-bar')
  bar.setAttribute('role', 'progressbar')
  bar.setAttribute('aria-label', shown.name)
  bar.setAttribute('aria-valuemin', '0')
  bar.setAttribute('aria-valuemax', '100')
  bar.setAttribute('aria-valuenow', String(shown.width))
  const fill = el('i')
  fill.style.width = `${shown.width}%`
  bar.append(fill)
  box.append(top, bar, el('small', '', shown.under))
  return box
}

const LIMITS_TIP = 'From the Claude app\'s own usage file on this PC, which it renews about every 15 minutes while it is open. The reset time comes from the last time a chat looked the limits up. Reading it asks no chat and costs nothing.'

/** B113: the limits in the head, in one place. A board whose server does not give them shows nothing there. */
function drawLimits(state) {
  const box = $('limits')
  const shown = state.limits === undefined ? null : limitsView(state.limits, state.readAt)
  box.hidden = state.limits === undefined
  if (state.limits === undefined) return
  box.title = LIMITS_TIP
  if (shown === null) return fill(box, [el('small', 'limit-age', 'Limits not known: the app\'s usage file was not found')])
  // B307: how old the figure is shows when it is old; else it is in the tooltip.
  box.title = `${LIMITS_TIP}\n${shown.age.text}`
  fill(box, [
    shown.five === null ? null : drawLimit(shown.five, false),
    shown.week === null ? null : drawLimit(shown.week, true),
    shown.age.isOld ? el('small', 'limit-age is-old', shown.age.text) : null,
  ].filter(part => part !== null))
}

// A restart of the app

// pause:start
/** B364: the ring's states, in the order the names beside it are listed, with what is said after a group's names. */
const PAUSE_STATES = [['working', ''], ['asking', ' (waiting for you)'], ['typing', ''], ['still', ''], ['off', ' (not running)']]

/**
 * B364 (the user's pick B of 2026-10-19): while pausing, the panel is one ring with a slice per chat (`pause.chats`,
 * coloured by its state), the count of still chats of those that run in its middle, and beside it one line for the
 * whole ("Pausing…", then "All still: safe to restart") and the names by state. The rest (since when, steps with no
 * checkpoint) are `notes`, one click away. Null outside a pause.
 */
function pauseRing(pause) {
  if (pause === null || pause === undefined || pause.state !== 'pausing') return null
  // A server from before B364 names no chats: the ring is drawn from who still works, asks or has a line typed into it.
  const chats = pause.chats ?? [
    ...(pause.working ?? []).map(name => ({ name, state: 'working' })),
    ...(pause.asking ?? []).map(name => ({ name, state: 'asking' })),
    ...(pause.typing ?? []).map(name => ({ name, state: 'typing' })),
  ]
  const running = chats.filter(chat => chat.state !== 'off')
  const still = running.filter(chat => chat.state === 'still').length
  const groups = PAUSE_STATES
    .map(([state, after]) => ({ state, names: chats.filter(chat => chat.state === state).map(chat => chat.name), after }))
    .filter(group => group.names.length > 0)
    .map(({ state, names, after }) => ({ state, text: `${names.join(', ')}${after}` }))
  const notes = [
    `Paused since ${clock(pause.since)}.`,
    // B386: which chat a line is being typed into is a detail, not said on the panel.
    ...chats.filter(chat => chat.state === 'typing').map(chat => `A line is being typed into ${chat.name}.`),
    // B442: lines the pause holds back wait for the resume; they keep nothing from being safe.
    ...((pause.held ?? []).length === 0 ? [] : [`${pause.held.length === 1 ? '1 line waits' : `${pause.held.length} lines wait`} for the resume (${pause.held.map(one => `${one.chat}${one.step === null ? '' : `: ${one.step}`}`).join(', ')}).`]),
    ...[
      ...(pause.unsaved ?? []).map(one => `${one.id} (${one.chat})`),
      ...(pause.offBoard ?? []).map(one => `${one.id} (${one.title}, not on the board)`),
    ].map(what => `${what} has no checkpoint; it resumes from its branch and History.`),
  ]
  return {
    head: pause.isSafe ? 'All still: safe to restart' : 'Pausing…', tone: pause.isSafe ? 'ready' : '', isDone: pause.isSafe === true,
    still, of: running.length, slices: chats.map(chat => chat.state), groups, notes,
  }
}

/**
 * The pause's lines in words: those of a resume (a pause shows as its ring, pauseRing). 2026-10-19: a chat is named
 * once with the steps it holds, with when the board goes on by itself; after a resume that ended by the time, who did
 * not start, for an hour, as information.
 */
function pauseLines(pause) {
  if (pause === null || pause === undefined || pause.state === 'pausing') return []
  if (pause.state === 'running') return (pause.notStarted ?? []).map(one => ({ tone: 'muted', text: `${one.chat} did not start after the resume: ${one.ids.join(', ')}.` }))
  const until = Number.isFinite(pause.until) ? ` The board goes on without waiting at ${clock(pause.until)}.` : ''
  const lines = [{ tone: '', text: pause.waiting.length === 0 ? `Resuming since ${clock(pause.since)}: every chat that holds a step has started again.` : `Resuming since ${clock(pause.since)}: not started yet: ${pause.waiting.map(one => `${one.chat} (${one.ids.join(', ')})`).join(', ')}.${until}` }]
  const main = pause.main ?? null
  if (main === null || pause.waiting.length === 0) return lines
  if (main.isRunning === true) {
    if (Number.isFinite(pause.typedAt)) lines.push({ tone: 'muted', text: `Typed "resume" into ${main.name} at ${clock(pause.typedAt)}: it wakes each chat that holds a step.` })
    return lines
  }
  // The review of part 1: "not known yet" while no mod has asked the board; the link only for an app id (local_ and a uuid).
  const open = { tone: 'alert', text: main.isRunning === false ? `${main.title} is not running: open it; its Workers mod tells it whom to wake.` : `Whether ${main.title} runs is not known yet: open it; its Workers mod tells it whom to wake.` }
  const isAppId = typeof main.session === 'string' && /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(main.session)
  lines.push(isAppId ? { ...open, link: { label: `Open ${main.title}`, href: `claude://claude.ai/epitaxy/${main.session}` } } : open)
  return lines
}
// pause:end

// restartwords:start
/**
 * The review of chat-reports: the restart banner's lines about the chats stopped in the middle of a task. One whose
 * Workers mod reported idle with its task open is named as that; one the board read as cut off keeps those words.
 */
function stoppedLines(restart, chats = []) {
  const reported = new Set(chats.filter(lane => lane.state === 'interrupted' && lane.report?.state === 'idle').map(lane => lane.name))
  // 2026-10-28: a chat that stopped for the person's pause at its checkpoint (`pausedLanes`) is no stop to name here.
  const paused = new Set(chats.filter(lane => lane.state === 'suspended' && lane.suspended?.by === 'pause').map(lane => lane.name))
  const stopped = restart.interrupted.filter(name => !paused.has(name))
  const idle = stopped.filter(name => reported.has(name))
  const cut = stopped.filter(name => !reported.has(name))
  return [
    ...(cut.length > 0 ? [`Cut off in the middle of a task: ${cut.join(', ')}.`] : []),
    ...(idle.length > 0 ? [`Idle with its task open: ${idle.join(', ')}.`] : []),
  ]
}
// restartwords:end

/**
 * What the board knows about a restart of the app, above the lanes: that it was off, who was cut off, how the pause
 * stands (pause.json, spec 2026-10-18), and Resume all. "Pause all" and "Resume all" write the pause through the
 * page's work API; the Workers mod of each chat reads it. Nothing is shown when there is nothing to say.
 */
function drawRestart(state) {
  const restart = state.restart ?? null
  const pause = state.pause ?? null
  const box = $('restart')
  const pauseAll = $('pause-all')
  pauseAll.hidden = restart === null || restart.main === null || pause?.state === 'pausing'
  pauseAll.disabled = sending.has('restart')
  const line = (className, text) => el('p', className, text)
  // T13 part 4: the chat the board opened when none ran, in one quiet line; amber once its tries brought no chat back.
  const opened = typeof state.opener?.text === 'string' ? line(`opener-note ${state.opener.tone === 'attention' ? 'alert' : 'muted'}`, state.opener.text) : null
  if (restart === null || restart.main === null) {
    box.hidden = opened === null
    if (opened !== null) fill(box, [opened])
    return
  }
  const button = (label, className, command) => {
    const node = el('button', `button ${className}`, label)
    node.type = 'button'
    node.dataset.restart = command
    node.disabled = sending.has('restart')
    return node
  }
  const parts = []
  if (restart.off !== null) parts.push(line('muted', `The board was off from ${clock(restart.off.from)} to ${clock(restart.off.to)} (${span(restart.off.to - restart.off.from)}).`))
  if (opened !== null) parts.push(opened)
  for (const text of stoppedLines(restart, state.chats ?? [])) parts.push(line('alert', text))
  // Who has to be started before it can carry on: said where a restart is at hand, not all day long.
  const down = restart.notRunning ?? []
  const isAtHand = restart.off !== null || restart.interrupted.length > 0 || (pause !== null && pause.state !== 'running')
  if (isAtHand && down.includes(restart.main)) parts.push(line('alert', `${restart.main} is not running: open its chat first, the buttons here type into it.`))
  // B364: while pausing the ring names who does not run; this line is for a restart and a resume.
  if (isAtHand && pause?.state !== 'pausing' && down.some(name => name !== restart.main)) {
    parts.push(line('', `Not running yet: ${down.filter(name => name !== restart.main).join(', ')}. "Resume all" tells ${restart.main} to start them; one that stays "not running" has to be opened by you.`))
  }
  // B315: a word to the main chat that was only copied, because no chat ran to take it: said plainly, with the way to
  // paste it, until the main chat has it.
  const copied = restart.copied ?? null
  if (copied !== null) {
    const row = el('div', 'restart-ask')
    row.append(line('alert', copiedLine(copied, { main: restart.main, isModThere: state.mod?.installed !== null })), button('Copy again', 'is-quiet', 'copy'), button('Dismiss', 'is-quiet', 'dismiss'))
    parts.push(row)
  }

  if (isAskingPause) {
    const ask = el('div', 'restart-ask')
    ask.append(line('', 'Pause all chats? Each chat commits its work, writes its checkpoint and ends its turn; nothing new starts.'), button('Yes, pause', '', 'pause-all'), button('No', 'is-quiet', 'cancel'))
    parts.push(ask)
  }
  // Pause and resume: the pause's own lines, with Resume all while pausing.
  for (const one of pauseLines(pause)) {
    if (one.link === undefined) {
      parts.push(line(one.tone, one.text))
      continue
    }
    const row = el('div', 'restart-ask')
    const open = el('a', 'button', one.link.label)
    open.href = one.link.href
    row.append(line(one.tone, one.text), open)
    parts.push(row)
  }
  const ring = pauseRing(pause)
  if (ring === null) isPauseDetailsOpen = false
  if (ring !== null) {
    parts.push(drawPauseRing(ring))
    const row = el('div', 'restart-ask')
    const details = el('details', 'pause-details')
    details.open = isPauseDetailsOpen
    details.addEventListener('toggle', () => { isPauseDetailsOpen = details.open })
    details.append(el('summary', '', `Details (${ring.notes.length} ${ring.notes.length === 1 ? 'note' : 'notes'})`), ...ring.notes.map(note => el('p', 'muted', note)))
    row.append(button('Resume all', pause.isSafe ? 'is-quiet' : '', 'resume'), details)
    parts.push(row)
  }
  // The review of part 1: a chat that will never start (gone, or not to be resumed) ends the resume by the person's word.
  if (pause?.state === 'resuming' && (pause.waiting ?? []).length > 0) {
    const row = el('div', 'restart-ask')
    row.append(button('End resume', 'is-quiet', 'end-resume'), el('small', 'muted', 'The board stops waiting for the chats not started yet.'))
    parts.push(row)
  }
  // Resuming is offered without a pause too, when there is somebody to bring back: a chat that was cut off.
  // The review of part 1: after a cycle pause.json says running, which is no pause: the button shows as without it.
  if ((pause === null || pause.state === 'running') && restart.interrupted.length > 0) {
    const row = el('div', 'restart-ask')
    row.append(button(`Resume all (${restart.interrupted.length} cut off)`, '', 'resume'), el('small', 'muted', `${restart.main} wakes each chat that holds a task.`))
    parts.push(row)
  }
  if (problems.has('restart')) parts.push(line('problem', problems.get('restart')))
  box.hidden = parts.length === 0
  fill(box, parts)
}

/**
 * B364: the pause's ring (pauseRing): a slice per chat in its state's colour, the count of still chats in the middle (a
 * tick once all are still), and beside it the line for the whole and the names by state.
 */
function drawPauseRing(ring) {
  const SVG = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 36 36')
  svg.setAttribute('class', 'pause-ring-svg')
  const n = Math.max(ring.slices.length, 1)
  const gap = n > 1 ? 1.6 : 0
  const circle = (state, length, offset) => {
    const node = document.createElementNS(SVG, 'circle')
    for (const [key, value] of Object.entries({ cx: '18', cy: '18', r: '15.9155', fill: 'none', 'stroke-width': '4', 'stroke-dasharray': `${length} ${100 - length}`, 'stroke-dashoffset': String(offset) })) node.setAttribute(key, value)
    node.setAttribute('class', `pause-slice is-${state}`)
    return node
  }
  svg.append(circle('track', 100, 0))
  ring.slices.forEach((state, i) => svg.append(circle(state, Math.max(100 / n - gap, 0.4), 25 - (i * 100) / n - gap / 2)))
  const middle = el('div', 'pause-ring-mid')
  if (ring.isDone) middle.append(el('span', 'pause-ring-tick', '✓'))
  else middle.append(el('span', 'pause-ring-count', `${ring.still}/${ring.of}`), el('small', 'muted', 'still'))
  const dial = el('div', 'pause-ring')
  dial.append(svg, middle)
  const legend = el('div', 'pause-legend')
  for (const group of ring.groups) {
    const item = el('span', '')
    item.append(el('b', `pause-key is-${group.state}`), document.createTextNode(group.text))
    legend.append(item)
  }
  const side = el('div', 'pause-side')
  side.append(el('p', `pause-head ${ring.tone}`, ring.head), legend)
  const box = el('div', `pause-panel${ring.isDone ? ' is-done' : ''}`)
  box.append(dial, side)
  return box
}

// copied:start
/**
 * B315: what the restart banner says of a word to the main chat that was only copied (`restart.copied`): that its chat
 * is not running yet, where to open it, that the word is on the clipboard, and the app's id for the chat when known.
 * `isModThere` false: no Workers mod is installed, so nothing would type it in even with the chat open.
 */
function copiedLine(copied, { main, isModThere }) {
  const id = typeof copied.session === 'string' && copied.session !== '' ? ` Its session id: ${copied.session}.` : ''
  if (!isModThere) return `No Workers mod types it in for you: open ${copied.chat} in the app (or click it in the sidebar) and paste with Ctrl+V; the word is on your clipboard.${id}`
  if (copied.isMainRunning === true) return `${main}'s chat runs now, but the word was only copied: paste it into ${copied.chat} with Ctrl+V; the word is on your clipboard.${id}`
  return `${main}'s chat is not running yet: open ${copied.chat} in the app (or click it in the sidebar) and paste with Ctrl+V; the word is on your clipboard.${id}`
}
// copied:end

// The lanes

const about = minutes => (minutes === null ? null : `~ ${span(minutes * MIN)}`)

// lanetime:start
/**
 * B95: what a lane's time column says. For a worker that works, the time left is the main figure ("24 min left")
 * and the clock time it ends at the small one. A time that is not the worker's own estimate says where it is from
 * (`from`, B64): its backlog step's "about <time>", or the one in its hand-over. A worker that works without any
 * time is a fault (`tone: 'fault'`), not a normal lane. Every part is one line: `label` above, `main` large,
 * `small` beside or under it.
 */
function timeOf(lane, now) {
  const plain = (main, tone = 'muted', label = '') => ({ label, main, tone, small: [], from: null })
  if (lane.isLeftover) return plain('Leftover')
  // T13 part 3: a chat whose process ended while its turn ran (or it held a task) resumes by itself: the board sends it
  // its resume word. No alarm: nothing is wrong yet.
  if (lane.state === 'interrupted' && lane.asleep === true) return { ...plain('resumes by itself', 'muted', 'Interrupted'), small: [asleepWords(lane)] }
  // The review of chat-reports: a chat whose Workers mod reported idle with its task open says that, since when.
  if (lane.state === 'interrupted' && lane.report?.state === 'idle') return plain(`since ${clock(lane.report.since)}`, 'bad', 'Idle, task open')
  if (lane.state === 'interrupted') return plain(lane.cutOffAt === null ? 'by a restart' : `at ${clock(lane.cutOffAt)}`, 'bad', 'Cut off')
  if (lane.state === 'suspended') {
    // B113: held by the limit. The figure is when it goes on; once that has passed it needs a hand.
    const held = lane.suspended
    if (held.isBack) return plain(held.until === null ? 'Not gone on' : `since ${clock(held.until)}`, 'bad', 'Limit is back')
    return held.until === null ? plain('Suspended') : { label: 'Goes on', main: clock(held.until), tone: 'time', small: [`in ${span(held.until - now)}`], from: null }
  }
  // B315: its card was left "working" by a quit app, and its process does not run.
  // The review of chat-reports: a reporting chat says why it does not run ("silent since HH:MM", its session ended).
  if (lane.state === 'off') return { ...plain('Not running', 'bad', 'Process'), small: typeof lane.offWhy === 'string' ? [lane.offWhy] : [] }
  if (lane.state === 'waiting') return plain('Blocked', 'bad', 'ETA')
  // B722: free by its card but known not to run (its chat is closed): never "Available", the hand-out gives only to a running chat.
  // B728: free by its card but known not to run: the one word "Not running", as the pill and the head count say.
  // T13 part 3: not an asleep one: it is free, and the line of the task it gets wakes it.
  if (lane.state === 'free' && lane.isRunning === false && lane.asleep !== true) return { ...plain('Not running', 'bad', 'Process'), title: 'This chat does not run. The board asks for it to be started when a task waits and no running worker is free.' }
  if (lane.state === 'free' && lane.asleep === true) return { ...plain('Available'), small: [asleepWords(lane)] }
  if (lane.state === 'free') return plain('Available')
  if (lane.state !== 'working') return plain('Unknown')
  const eta = lane.eta ?? null
  // B793: the time worked, not the time since: a pause, a stop or a restart is no time spent.
  const soFar = lane.task === null || !Number.isFinite(lane.task.startedAt) ? [] : [`${span(now - lane.task.startedAt - (lane.task.offStartMs ?? 0))} so far`]
  if (eta === null) {
    // The main chat hands out work and answers: it has no task to time.
    return lane.isWithoutTime === true
      ? { label: 'ETA', main: 'No time', tone: 'fault', small: soFar, from: null, title: 'This worker works without a time: it gave none, and its step names none.' }
      : { label: '', main: 'Working', tone: 'muted', small: soFar, from: null }
  }
  // T13: a task with no time of its own and no plan recorded yet has the size its refine gave, counted from its take.
  const from = eta.isOwn !== false ? null : eta.from === 'refine' ? {
    text: "refine's estimate",
    title: `The worker has recorded no plan yet: this is the size the refine of ${lane.task?.stepId ?? 'its step'} gave, counted from when the task was taken.`,
  } : {
    text: `from ${lane.task?.stepId ?? 'its step'}`,
    title: 'The worker gave no estimate of its own: this is the time its step names, counted from when the task started.',
  }
  // Overdue stays overdue, with how far over as its figure.
  if (eta.isOverdue) return { label: 'Overdue', main: `${span(now - eta.at)} over`, tone: 'bad', small: [`was ${clock(eta.at)}`], from }
  // B185: a little over is no fault: over twice its estimate and by 10 minutes is (above).
  if (eta.isOver === true) return { label: 'ETA', main: `${span(now - eta.at)} over`, tone: 'time', small: [`was ${clock(eta.at)}`], from }
  return { label: 'ETA', main: `${span(eta.leftMs)} left`, tone: 'time', small: [`until ${clock(eta.at)}`], from }
}

/**
 * T13 part 3: the quiet note of an asleep chat (its process ended while its last report stands; the board wakes it with a
 * message): since when, and what wakes it.
 */
function asleepWords(lane) {
  const since = Number.isFinite(lane.asleepSince) ? `asleep since ${clock(lane.asleepSince)}` : 'asleep'
  if (lane.state === 'interrupted') return `${since}; the board sends it its resume word`
  if (lane.state === 'free') return `${since}, wakes when it gets a task`
  return `${since}, wakes when a word comes for it`
}
// lanetime:end

// calmoverview:start
// B307: a calmer Overview, one line per worker and per note. The person, 2026-10-18: "I want to see if i can make this
// overview slightly easier and have less text/details." What goes from a row stays in its tooltip or its details.

/**
 * What the column Left shows of a lane: for a worker that works, its time once ("1 h 34"; over its time "12 min over"),
 * with its end time and where the time is from in the tooltip (`title`). A free worker shows nothing (null); one that
 * is held, cut off or blocked says so as `timeOf` does.
 */
function leftView(lane, now) {
  if (lane.state === 'free') return null
  const time = timeOf(lane, now)
  const eta = lane.eta ?? null
  if (lane.state !== 'working') return time
  if (eta === null) return { ...time, label: '', main: time.tone === 'fault' ? time.main : time.small[0] ?? time.main, small: [], title: time.title ?? time.small.join(' · ') }
  const from = time.from === null ? [] : [`${time.from.text}: ${time.from.title}`]
  const title = (words, ...more) => [words, ...more, ...from].join('\n')
  if (eta.isOverdue) return { label: '', main: time.main, tone: 'bad', small: [], from: null, title: title(`Overdue: ${time.small[0]}`) }
  if (eta.isOver === true) return { label: '', main: time.main, tone: 'time', small: [], from: null, title: title(time.small[0]) }
  return { label: '', main: span(eta.leftMs), tone: 'time', small: [], from: null, title: title(`${span(eta.leftMs)} left, ${time.small[0]}`) }
}

/** A free worker's one line: since when it is free ("free since 13:01"); null when that is not known. */
function freeShort(lane, clockOf = null) {
  if (lane.state !== 'free' || clockOf === null || !Number.isFinite(lane.idle?.since)) return null
  return `free since ${clockOf(lane.idle.since)}`
}

/** The column "Next in queue": the next step by its id and title, why it is not started, and how many come after it. */
function nextInQueue(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return null
  const [first] = queue
  const why = whyText(first.why)
  return { id: first.id ?? null, title: first.title, why: why === null ? null : { tone: why.tone, text: why.text.replace(/^Not started: /, '') }, more: queue.length - 1, ...(first.isFix === true ? { isFix: true } : {}) }
}

/** A note of the Information part as one line: the step it is about, who sent it, its words without "Report from X:". */
function infoLine(row) {
  return { about: row.about ?? null, from: row.from ?? null, words: (row.text ?? '').replace(/^(?:Report|Note|Question) from [^:\n]{1,80}?:\s*/, '') }
}

/** T9.4: where an open note's link goes, by the item it is about: a step or an ask opens its window, an incident the Supervisor section; null for none. */
function infoTarget(about) {
  if (typeof about !== 'string') return null
  if (/^[BQ]\d+$/.test(about)) return { href: `#details=${about}`, text: `Open ${about}` }
  if (/^X\d+$/.test(about)) return { href: '#supervisor', text: `Open ${about} under Supervisor` }
  return null
}

/** The counts in the head: working and free always, the others only when there is one ("0 waiting for you" goes). */
function shownCounts(counts) {
  return ['working', 'waiting', 'free', 'suspended', 'interrupted', 'off', 'unknown'].filter(name => name === 'working' || name === 'free' || (counts[name] ?? 0) > 0)
}

/** The Information part's height: at least 90 pixels, and the asks above it keep 120 of the `room` both share. */
function infoHeightFit(height, room) {
  return Math.round(Math.max(90, Math.min(height, room - 120)))
}
// calmoverview:end

// runchip:start
// The model chip (the person, 2026-10-24: "Can we make it visual on the board which model/effort level its running?"):
// beside the state of every chat on the Overview's worker list (Details' pill, Simple's time), the model and effort it
// runs at now, as the app's own file of the chat says them (the state's `model` and `effort`). Since the main chat
// switches a worker's model and effort before a step (B468, model per step), the chip also shows a switch the board is
// waiting for (the lane's `effortRun`, src/work/effort.mjs): "Sonnet · medium → Opus · high".

/** The levels of the app's effort setting as the page says them (the same words as `EFFORT_WORDS` in src/work/effort.mjs). */
const EFFORT_WORDS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max' }
/** The models a chip has a colour of its own for; any other model is drawn quiet, as Sonnet is. */
const CHIP_TONES = ['opus', 'sonnet', 'fable']
/** A model id of the app's, "claude-opus-5-5", in its newer or older form, with a date and a "[1m]" after it left out. */
const MODEL_ID_NEW = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/
const MODEL_ID_OLD = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?$/

/**
 * A model id as the chip says it: `short` ("Opus"), `full` ("Claude Opus 5.5"), its `family` and its `tone`. An id that
 * is not of that form shows what follows its "claude-" (cut when long) and counts as no family; null without an id.
 */
function modelFacts(id) {
  if (typeof id !== 'string' || id.trim() === '') return null
  const bare = id.trim().replace(/\[[^\]]*\]$/, '')
  const fresh = bare.match(MODEL_ID_NEW)
  const old = fresh === null ? bare.match(MODEL_ID_OLD) : null
  const [family, major, minor] = fresh !== null ? [fresh[1], fresh[2], fresh[3]] : old !== null ? [old[3], old[1], old[2]] : [null, null, null]
  if (family === null) {
    const short = bare.replace(/^claude-/, '')
    return { family: null, short: short.length > 18 ? `${short.slice(0, 17)}…` : short, full: id.trim(), tone: 'other' }
  }
  const name = `${family[0].toUpperCase()}${family.slice(1)}`
  return { family, short: name, full: `Claude ${name} ${minor === undefined ? major : `${major}.${minor}`}`, tone: CHIP_TONES.includes(family) ? family : 'other' }
}

/** An effort level in words ("extra high"); a level the page does not know stays as the app wrote it; null without one. */
function effortWord(level) {
  if (typeof level !== 'string' || level.trim() === '') return null
  return Object.hasOwn(EFFORT_WORDS, level) ? EFFORT_WORDS[level] : level.trim()
}

/** "Opus · extra high": the model's short name and the effort in words, whichever of them there is. */
const chipWords = (model, effort) => [model, effort].filter(part => part !== null && part !== '').join(' · ')

/** The tooltip's first sentence: what the chat runs at, and that it is the app's own setting. */
function runsLine(model, effort) {
  if (model !== null && effort !== null) return `Runs on ${model.full} at ${effort} effort (the app's setting for this chat)`
  if (model !== null) return `Runs on ${model.full} (the app's setting for this chat; it does not say the effort)`
  return `Runs at ${effort} effort (the app's setting for this chat; it does not say the model)`
}

/** Why a switch is not made yet, from the main chat's ask (`asked`, the lane's `effortRun.asked`; null: none sent). */
function askedLine(asked) {
  if (asked === null || asked === undefined || !Number.isFinite(asked.at)) return 'the board has not asked the main chat to switch it yet'
  const isLost = asked.state === 'expired' || asked.state === 'failed'
  return `the main chat was asked to switch it at ${clock(asked.at)}${isLost ? ', but the word did not arrive' : ''}`
}

/**
 * What a chip says for a chat (a lane, the Advisor's card or its helper's): `now` ("Sonnet · medium"), its `tone`
 * (opus, sonnet, fable or other), `title` (the tooltip), and `next` while a switch is pending, `{ text, tone }`, the
 * setting its step needs: the lane's `effortRun` is not set yet and asks another setting than the chat has. `text` has
 * both ("Sonnet · medium → Opus · high"). Null when the chat has neither a model nor an effort. The Advisor's own
 * `effort` is its high-effort mode (B352), so its app setting is `appEffort`; a lane's is `effort`.
 */
function runChipOf(chat) {
  if (chat === null || chat === undefined) return null
  const model = modelFacts(chat.model)
  const effort = effortWord(typeof chat.effort === 'string' ? chat.effort : chat.appEffort)
  if (model === null && effort === null) return null
  const now = chipWords(model?.short ?? null, effort)
  let next = null
  let pending = null
  const run = chat.effortRun ?? null
  if (run !== null && run.isSet === false) {
    const family = typeof run.model === 'string' && run.model !== '' ? run.model : null
    const name = family === null ? model?.short ?? null : `${family[0].toUpperCase()}${family.slice(1)}`
    const text = chipWords(name, effortWord(run.level))
    // The same setting again is no switch to show.
    if (text !== '' && text !== now) {
      next = { text, tone: family === null ? model?.tone ?? 'other' : CHIP_TONES.includes(family) ? family : 'other' }
      pending = `Switching to ${text}${typeof run.step === 'string' ? ` for ${run.step}` : ', its usual setting'}: ${askedLine(run.asked)}.`
    }
  }
  return {
    text: next === null ? now : `${now} → ${next.text}`,
    now,
    tone: model?.tone ?? 'other',
    next,
    title: [runsLine(model, effort), pending].filter(Boolean).join('\n'),
  }
}
// runchip:end

// simpleoverview:start
// B327: the Overview opens on a simple view (the person's four answers of 2026-10-18, brainstorm "Board easier day to
// day"): one bar for the focus goal, how many workers are busy, the
// 5-hour limit with its reset, and Needs your attention. Today's Overview is one click away under Details. B343 (the
// person's Q70): the full width, and under the bar three columns, the focus goal's steps, the workers, and Needs your
// attention without the backlog, the instructions and what is closed (the agreed drawing "simple-wide").

/**
 * What the simple view's bar and chips say. `focus`: the state's (null: none); `counts`: the head's counts (state.counts);
 * `limits`: the state's; `milestone`: the state's way to the next milestone (src/milestone.mjs; null: none). `bar`: the
 * focus goal's steps done and the time left, counted as the Focus page counts them (focusView: once the run has
 * started); before that, which stage the goal is in, without a count (`percent` null). B328: with no focus, or the last
 * one done, the next milestone's steps done of all and the time its open steps name; null when there is neither.
 * `busy`: "4 of 5 workers busy". `limit`: the 5-hour limit's use and its reset, or null when nothing is known of it.
 */
function simpleView({ focus = null, counts = {}, limits = null, milestone = null } = {}, now = Date.now()) {
  let bar = null
  const hasFocus = focus !== null && focus !== undefined
  if ((!hasFocus || focus.stage === 'done') && milestone !== null && milestone !== undefined) bar = milestoneBar(milestone)
  else if (hasFocus && focus.stage !== 'run' && focus.stage !== 'done') {
    // the Focus page shows no progress before the run either
    const doing = focus.stage === 'how' ? 'agreeing the how' : 'agreeing the vibe'
    bar = { text: `Focus ${focus.id} · ${focus.title} · ${doing}`, percent: null, title: `${focus.id} · ${focus.title}` }
  } else if (focus !== null && focus !== undefined) {
    const progress = focus.progress ?? { done: 0, total: 0, minutesLeft: null }
    // B343: the steps the column lists, when the board names them; else the parts, as the Focus page counts them
    const listed = focus.steps ?? []
    const { done, total } = listed.length > 0 ? { done: listed.filter(step => step.state === 'done').length, total: listed.length } : progress
    const left = focus.stage === 'done' ? null : focusTimeLeft(progress.minutesLeft)
    bar = {
      // B343: with the goal's title, as the agreed drawing has it
      text: `Focus ${focus.id} · ${focus.title} · ${done} of ${total} steps done${left === null ? '' : ` · about ${left} left`}`,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
      title: `${focus.id} · ${focus.title}`,
    }
  }
  const all = chatsCounted(counts)
  const busy = counts?.working ?? 0
  const five = limits?.fiveHour ?? null
  let limit = null
  if (five !== null) {
    const full = five.level === 'full'
    const reset = five.resetAt !== null && five.resetAt !== undefined ? ` · reset at ${clock(five.resetAt)}`
      : five.resetsAt === null || five.resetsAt === undefined ? '' : ` · ${full ? 'work goes on at' : 'resets'} ${clock(five.resetsAt)}`
    limit = { text: `5-hour ${full ? 'limit reached' : `${Math.round(five.used)}%`}${reset}`, tone: five.level }
  }
  void now
  return { bar, busy: { text: `${busy} of ${all} workers busy`, isBusy: busy > 0 }, limit }
}

/**
 * B328: the bar of the next milestone (the person's answer of 2026-10-18): "M1 · The loop is fun · 9 of 23 steps done ·
 * about 30 h left", every backlog step under it, its sub-goals' too, and the parts its Missing lines name ("2 not made
 * yet"), so all steps done is not all of it; without steps yet, or not mapped yet, it says so, without a count, as the
 * Next milestone row does.
 */
function milestoneBar(way) {
  const { name, title } = way.milestone
  const { done, open, missing, minutesLeft } = way.totals
  const head = `${name} · ${title}`
  const about = `The next milestone, ${head}`
  if (way.isMapped === false) return { text: `${head} · not mapped yet`, percent: null, title: about }
  if (done + open === 0) return { text: `${head} · no steps of it on the board yet`, percent: null, title: about }
  const left = focusTimeLeft(minutesLeft)
  const unmade = missing > 0 ? `, ${missing} not made yet` : ''
  return { text: `${head} · ${done} of ${done + open} steps done${unmade}${left === null ? '' : ` · about ${left} left`}`, percent: Math.round((done / (done + open)) * 100), title: about }
}

/** All the chats the head's counts count, whatever their state. */
const chatsCounted = counts => Object.values(counts ?? {}).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0)

/** B343: a working chat's time left as its lane's Left column says it ("1 h 50", "10 min over"), or null without one. */
function simpleLeft(lane, now) {
  if (lane.state !== 'working' || (lane.eta ?? null) === null) return null
  return leftView(lane, now)?.main ?? null
}

/**
 * B343 (the person's Q70: "I want the workers and maybe what the current focus is with the tasks"): the simple view's
 * first column, the focus goal's steps one by one (state.focus.steps): Done, Working or Next, who is on it, and for the
 * one at work its worker's time left (that worker's lane, while it works on that step). `empty` says why there are
 * none yet. Null without a focus.
 */
function simpleSteps(focus, chats = [], now = Date.now()) {
  if (focus === null || focus === undefined) return null
  const chips = { done: 'Done', now: 'Working', next: 'Next' }
  const rows = (focus.steps ?? []).map(step => {
    const lane = step.state !== 'now' || step.owner === null ? null : (chats ?? []).find(one => one.name === step.owner
      && one.state === 'working' && [null, step.id].includes(laneTaskOf(one).code)) ?? null
    const left = lane === null ? null : simpleLeft(lane, now)
    const who = step.owner === null ? null : left === null ? step.owner : `${step.owner} · ${left}`
    // B392: a step at work whose open blocking asks all wait for the partner says so.
    if ((step.waitsForPartner ?? []).length > 0) return { id: step.id, title: step.title, chip: 'Waits for your partner', tone: 'partner', who: step.owner }
    return { id: step.id, title: step.title, chip: chips[step.state] ?? 'Next', tone: chips[step.state] === undefined ? 'next' : step.state, who }
  })
  const before = focus.stage !== 'run' && focus.stage !== 'done'
  return { goal: focus.id, rows, empty: rows.length > 0 ? null : before ? 'No steps yet: your partner makes them once you agree the how.' : 'No steps of it on the board.' }
}

// simpleidle:start
/** B343: what a chat's row says in place of its time when it does not work: a few plain words. */
function simpleIdle(lane) {
  if ((lane.waitsForPartner ?? []).length > 0) return `waits for your partner (${lane.waitsForPartner.join(', ')})`
  if (lane.state === 'free') return 'free'
  if (lane.state === 'working') return 'working'
  if (lane.state === 'waiting') return 'waits for you'
  if (lane.state === 'suspended') return Number.isFinite(lane.suspended?.until) ? `paused until ${clock(lane.suspended.until)}` : 'paused'
  if (lane.state === 'off') return typeof lane.offWhy === 'string' ? `not running (${lane.offWhy})` : 'not running'
  // T13 part 3: an asleep one resumes by itself.
  if (lane.state === 'interrupted' && lane.asleep === true) return 'interrupted, resumes by itself'
  if (lane.state === 'interrupted') return lane.report?.state === 'idle' ? 'idle, task open' : 'cut off'
  return String(lane.state ?? '')
}
// simpleidle:end

/**
 * B343: the simple view's second column, the workers: each chat of the list (no leftover) with the step it is on, a bar
 * of its steps and its time left; one without work says so in a few words. `busy`: "4 of 5 busy", by the head's counts.
 * B424: `partner` the same rows for the partner and its helper (state.advisor, state.advisorHelper; a missing one is
 * left out), shown apart under the workers and not counted among them.
 */
function simpleWorkers(chats = [], counts = {}, now = Date.now(), partners = []) {
  const all = chatsCounted(counts)
  const rowOf = lane => {
    const task = lane.task ?? null
    const { code, text } = task === null ? { code: null, text: null } : laneTaskOf(lane)
    const hasSteps = task !== null && Number.isFinite(task.step) && Number.isFinite(task.steps) && task.steps > 0
    // B392: a chat that waits for the partner's answer says so, in its own colour, not its time left.
    const waitsForPartner = (lane.waitsForPartner ?? []).length > 0
    // The model chip (runchip): what the chat runs at, under its time; a chat that has neither a model nor an effort has none.
    const run = runChipOf(lane)
    return {
      name: lane.name,
      code,
      task: text,
      percent: hasSteps ? Math.round(Math.max(0, Math.min(1, task.step / task.steps)) * 100) : null,
      left: waitsForPartner ? simpleIdle(lane) : simpleLeft(lane, now) ?? simpleIdle(lane),
      tone: waitsForPartner ? 'partner' : lane.state,
      ...(run === null ? {} : { run }),
    }
  }
  const rows = (chats ?? []).filter(lane => lane.isLeftover !== true).map(rowOf)
  const partner = (partners ?? []).filter(lane => lane !== null && lane !== undefined).map(rowOf)
  return { busy: `${counts?.working ?? 0} of ${all} busy`, rows, partner }
}

/** The Overview's view: the person's choice kept in this browser, Simple unless they chose Details. */
function overviewMode(stored) {
  return stored === 'details' ? 'details' : 'simple'
}
// simpleoverview:end

/**
 * B82: the topic the chat recorded for its task. A chat that recorded nothing has no words to show: what was typed to
 * it stays in its chat. B182: the backlog step it is on stands in front ("B173 Build the new Advisor's job and
 * clock", the person, 2026-10-14), once, whether or not the topic began with it.
 */
function taskTitle(lane) {
  const { code, text } = laneTaskOf(lane)
  if (text === null) return el('p', 'task is-none', 'Task not recorded yet')
  const title = el('p', 'task clip')
  if (code !== null) title.append(el('span', 'task-code', code), ' ')
  title.append(text)
  title.title = code === null ? text : `${code} ${text}`
  return title
}

// stepline:start
/**
 * B108: the steps of a task as one line: which step of how many ("2/5"), the name of the step the chat is on, and
 * the time left for that step ("12 min left"; a step without a time says so). `steps` is every step by name with
 * where it stands, for the list that opens on hover and on the keyboard's focus. Null when the chat named no
 * steps: the page then shows its bar and "2 of 5". The step's time counts down from when the chat gave it while
 * the chat works; a chat that waits or was cut off keeps what it said.
 */
function stepLine(lane, now) {
  const task = lane.task ?? null
  if (task === null || !Array.isArray(task.names) || task.names.length === 0) return null
  const total = Math.max(task.steps ?? 0, task.names.length)
  const at = Number.isInteger(task.step) && task.step >= 1 ? task.step : null
  const name = at === null ? 'No step yet' : task.names[at - 1] ?? `Step ${at}`
  const given = Number.isFinite(task.stepLeftMs) && Number.isFinite(task.stepEstimateAt)
  // B793: it counts down in working time: the moment it runs out is moved on by what was not worked since it was given.
  const leftMs = !given ? null : lane.state === 'working' ? (task.stepCountAt ?? task.stepEstimateAt) + task.stepLeftMs - now : task.stepLeftMs
  const time = leftMs === null ? 'no time for this step' : leftMs < 0 ? `${span(-leftMs)} over` : `${span(leftMs)} left`
  return {
    count: `${at ?? '–'}/${total}`,
    name,
    time,
    tone: leftMs === null ? 'none' : leftMs < 0 ? 'bad' : 'time',
    steps: task.names.map((one, index) => ({ name: one, state: at === null || index > at - 1 ? 'next' : index === at - 1 ? 'now' : 'done' })),
    label: `${at === null ? `No step of ${total} yet` : `Step ${at} of ${total}: ${name}`}, ${time}`,
  }
}
// stepline:end

/** B108: the line of a task's steps, and the list of all of them that opens on hover and on the keyboard's focus. */
function drawStepLine(lane, line) {
  const box = el('div', 'step-line')
  const now = el('button', 'step-now')
  now.type = 'button'
  now.dataset.stepsOf = lane.name
  now.setAttribute('aria-label', `${line.label}. All steps: ${line.steps.map((step, index) => `${index + 1}. ${step.name}${step.state === 'now' ? ' (now)' : step.state === 'done' ? ' (done)' : ''}`).join('; ')}`)
  // B307: the time left shows once on the row, in the column Left; the step's own time is in the list that opens.
  now.append(el('span', 'step-count', line.count), el('span', 'step-name', line.name))
  now.title = line.label
  const list = el('ol', 'step-list')
  for (const step of line.steps) {
    const item = el('li', `is-${step.state}`, step.name)
    if (step.state === 'now') item.append(el('small', '', 'now'), el('span', `step-time step-list-time is-${line.tone}`, line.time))
    list.append(item)
  }
  box.append(now, list)
  return box
}

/** B64: why a worker counts as working although its turn has ended (its task is not reported, a review runs, its branch is open). */
function betweenTurns(lane) {
  if (lane.state !== 'working' || (lane.between ?? null) === null) return []
  const note = el('p', 'now clip between')
  note.title = lane.between
  note.append(el('b', '', 'Between turns: '), el('span', '', lane.between.replace(/^Its turn has ended; /, '')))
  return [note]
}

/** B307: the column Left (see `leftView`); empty for a free worker. */
function drawEta(lane, now) {
  const time = leftView(lane, now)
  if (time === null) return el('div', 'eta is-muted')
  const box = el('div', `eta is-${time.tone}`)
  if (time.title !== undefined) box.title = time.title
  if (time.label !== '') box.append(el('small', '', time.label))
  box.append(el(time.tone === 'time' ? 'b' : 'span', time.tone === 'time' ? '' : `state${time.tone === 'bad' ? ' is-blocked' : time.tone === 'fault' ? ' is-fault' : ''}`, time.main))
  for (const line of time.small) box.append(el('small', '', line))
  if (time.from !== null) {
    const note = el('small', 'from-step', time.from.text)
    note.title = time.from.title
    box.append(note)
  }
  return box
}

// alerts:start
/** What is wrong with a lane, when something is: shown only then. */
function alertsOf(lane, state) {
  const alerts = []
  const task = lane.task
  // B247: a quiet lane that waits on one step without an answer may wait for the person's approval in its chat.
  const waits = lane.unanswered ?? null
  // The step "Now:" names already is "it".
  const step = waits === null ? null : waits.doing === lane.doingNow ? 'it' : `its step "${waits.doing}"`
  if (lane.isQuiet) alerts.push(step === null ? `no sign of life for ${span(lane.quietMs)}` : `no answer to ${step} for ${span(state.readAt - waits.since)}: it may wait for your approval in its chat`)
  // B508: one signal per problem. "No time" (B95: no worker works without a time) and "over" already stand in the column
  // Left (timeOf, leftView), so no line under the task repeats them.
  const leftSaysOver = lane.eta != null && (lane.eta.isOverdue === true || lane.eta.isOver === true)
  if (task !== null && task.firstEstimateMs !== null && task.workedMs > task.firstEstimateMs + MIN && !leftSaysOver) alerts.push(`${span(task.workedMs - task.firstEstimateMs)} over its first estimate`)
  // B793: how old the estimate is counts working time too (a pause or a restart does not age it).
  const estimateAge = task === null || task.estimateAt === null ? null : state.readAt - (task.countAt ?? task.estimateAt)
  if (lane.state === 'working' && estimateAge !== null && estimateAge > state.estimateOldMs) {
    alerts.push(`estimate ${span(estimateAge)} old`)
  }
  return alerts
}
// alerts:end

function drawMore(lane, state) {
  const more = el('div', 'more')
  const now = state.readAt

  const queue = el('div')
  queue.append(el('h4', '', 'Queue'))
  if (lane.queue.length === 0) queue.append(el('p', 'muted', 'Nothing is queued for this worker.'))
  else {
    const list = el('ol')
    lane.queue.forEach((step, place) => {
      const item = el('li')
      if (step.isFix === true) item.append(fixChip(), ' ')
      const title = el('button', 'link', step.title)
      title.type = 'button'
      title.dataset.lane = lane.name
      title.dataset.step = String(place)
      title.title = 'Show the details'
      item.append(title)
      const notes = [step.id, about(step.minutes), step.after === null ? null : `after ${step.after}`].filter(Boolean)
      if (notes.length > 0) item.append(el('small', '', `  ${notes.join(' · ')}`))
      const why = whyText(step.why)
      if (why !== null) item.append(el('small', `why is-${why.tone}`, why.text))
      list.append(item)
    })
    queue.append(list)
  }

  const details = el('div')
  details.append(el('h4', '', 'Details'))
  const list = el('ul')
  const task = lane.task
  if (task !== null) {
    const waited = task.waitedMs >= MIN ? `, ${span(task.waitedMs)} of it waiting for you` : ''
    list.append(el('li', '', `Started ${clock(task.startedAt)}: ${span(now - task.startedAt - (task.offStartMs ?? 0))} worked so far${waited}`))
    if (task.firstEstimateMs !== null) list.append(el('li', '', `First estimate ${span(task.firstEstimateMs)}, worked ${span(task.workedMs)}`))
    if (task.leftMs !== null && task.estimateAt !== null) list.append(el('li', '', `Said ${span(task.leftMs)} left, ${ago(task.estimateAt, now)}`))
    if (task.source === 'unrecorded') list.append(el('li', 'muted', 'It has recorded no task yet: no topic, no steps and no time.'))
    if (task.source === 'step') list.append(el('li', 'muted', 'It named no task: this is the task the work store holds for it.'))
    if (lane.eta !== null && lane.eta.isOwn === false && lane.eta.from === 'refine') list.append(el('li', 'muted', `It has recorded no plan yet: the refine of ${task.stepId ?? 'its step'} gave its size, ${about(task.refineMinutes)}, counted from when the task was taken.`))
    else if (lane.eta !== null && lane.eta.isOwn === false) list.append(el('li', 'muted', `It gave no estimate: ${task.stepId ?? 'its step'} says ${about(task.stepMinutes)}, counted from the start.`))
    if (task.isSavedPlan === true) list.append(el('li', 'muted', `Its card holds no plan: this is the plan saved with ${task.stepId ?? 'its step'}.`))
    if (task.source === 'plan' && (task.stepId ?? null) !== null) list.append(el('li', 'muted', `It is on task ${task.stepId} of the backlog.`))
  }
  // B307: what the row no longer says, here in full.
  if (lane.state === 'working' && (lane.doingNow ?? null) !== null) list.append(el('li', '', `Now: ${lane.doingNow}`))
  if (lane.state === 'working' && (lane.between ?? null) !== null) list.append(el('li', 'muted', `Between turns: ${lane.between.replace(/^Its turn has ended; /, '')}`))
  const free = freeLine(lane, clock)
  if (free !== null) list.append(el('li', '', free))
  const owedClear = clearOwedLine(lane.clearOwed ?? null, clock)
  if (owedClear !== null) list.append(el('li', '', owedClear.title))
  const stopped = stoppedLine(lane.stopped ?? null, clock)
  if (stopped !== null) list.append(el('li', '', stopped.title))
  const compacted = compactionLine(lane.compaction ?? null, clock)
  if (compacted !== null && compacted.log !== undefined) {
    const item = el('li', 'muted', `${compacted.title} `)
    item.append(clearedNote(compacted))
    list.append(item)
  } else if (compacted !== null) list.append(el('li', 'muted', compacted.title))
  if (lane.statusDetail !== null) list.append(el('li', '', `Last: ${lane.statusDetail}`))
  for (const folder of lane.folders) list.append(el('li', '', folderLine(folder, now)))
  if (lane.lastActivityAt !== null) list.append(el('li', 'muted', `Last activity ${ago(lane.lastActivityAt, now)}`))
  details.append(list)

  more.append(queue, details)
  return more
}

function folderLine(folder, now) {
  const parts = [`Folder ${folder.name}`, folder.branch ?? 'no branch']
  if (folder.ahead) parts.push(`${folder.ahead} commits not in main`)
  if (folder.uncommitted) parts.push(`${folder.uncommitted} files changed`)
  if (folder.lastCommitAt !== null) parts.push(`last commit ${ago(folder.lastCommitAt, now)}`)
  return parts.join(' · ')
}

// lanefree:start
/**
 * B148: the one dim line of a free lane: ready for a new task, or the task its card still named, as finished (the
 * card was left behind). Null for a lane that is not free. B262: with since when it is idle and who says so, the
 * app or its transcript; a turn whose last entry was a tool's answer ended without a closing message. `clock` writes
 * a time as the page does.
 */
function freeLine(lane, clock = null) {
  if (lane.state !== 'free') return null
  const ready = typeof lane.lastTask?.text === 'string' && lane.lastTask.text !== '' ? `Last task: ${lane.lastTask.text}, finished` : 'Ready for a new task'
  const idle = lane.idle ?? null
  if (idle === null || !Number.isFinite(idle.since) || clock === null) return ready
  const when = idle.isSilent ? `turn ended without a closing message at ${clock(idle.since)}` : `idle since ${clock(idle.since)}`
  return `${ready} · ${when}, from ${idle.from === 'app' ? 'the app' : 'the transcript'}`
}
// lanefree:end

// laneflags:start
/**
 * B300: the reconciler's flags on a lane (`lane.flags`), each a line, and for a chat that holds work but does not run a
 * button "Start <chat>" that asks the main chat to start it (the board's own start words; `data-start`). No button
 * without a main chat, for the main chat itself, or while an ask to start it is on its way (`restart.starting`). B304:
 * a step whose check failed gets "Check again" (`data-recheck`), the board's check run anew.
 */
function laneFlags(lane, restart = null) {
  const main = restart?.main ?? null
  const isAsked = (restart?.starting ?? []).some(one => one.chat === lane.name && one.state !== 'expired' && one.state !== 'failed')
  return (lane.flags ?? []).map(flag => ({
    text: flag.text,
    // Model per step: a step that waits for its worker to run on Opus is a wait, no fault.
    // 2026-10-31 (B799): a step whose work is on a branch not merged is back with its worker: a quiet line, no button for the person.
    tone: flag.kind === 'card' || flag.kind === 'model' ? 'warn' : flag.kind === 'not merged' ? 'quiet' : 'problem',
    // B304: a failed check is the person's to run again ("Check again", `data-recheck`: the work API's `recheck`).
    button: flag.kind === 'check failed' ? { label: 'Check again', recheck: flag.id }
      : flag.button === null || main === null || main === lane.name ? null : { label: flag.button, start: lane.name, isAsked },
  }))
}
// laneflags:end

// offwork:start
/**
 * A worker whose chat does not run: whether it holds work, and its lane's line. Work is a store step taken, in progress
 * or waiting on the person with it as Owner (`lane.storeSteps`), or a ready task pinned to it (`state.readyList`). One
 * that holds none is no problem: nothing waits for it and the board starts it when work comes (`isIdle`, a muted line).
 * One that holds work says what waits for it, and whether the board asked `main` to start it. Null for any other lane.
 */
function offWorkOf(lane, state, main) {
  if (lane?.state !== 'off' || lane.isLeftover === true) return null
  const name = String(lane.name ?? '').trim().toLowerCase()
  const held = (lane.storeSteps ?? []).filter(one => ['taken', 'in progress', 'waiting on you'].includes(one.state)).map(one => one.id)
  const pinned = (state?.readyList?.ready ?? []).filter(one => typeof one.pinned === 'string' && one.pinned.trim().toLowerCase() === name).map(one => one.id)
  const waits = [...new Set([...held, ...pinned])]
  if (waits.length === 0) return { isIdle: true, waits, text: 'Not running, nothing waits for it' }
  const isAsked = (state?.restart?.starting ?? []).some(one => one.chat === lane.name && ['waiting', 'taken', 'delivered', 'copied'].includes(one.state))
  const what = `${waits.join(', ')} ${waits.length === 1 ? 'waits' : 'wait'} for it`
  return { isIdle: false, waits, text: isAsked ? `${what}; the board asked ${main} to start it.` : `${what}: it does nothing until its chat is opened, or ${main} starts it (Resume all).` }
}
// offwork:end

/**
 * The model chip for a view of `runChipOf` (runchip): a small label, "Opus · extra high", in the colour of its model;
 * while a switch is pending it adds an arrow and the setting the step needs, with a dashed edge. The tooltip says what
 * it runs on and, while pending, who was asked to switch it. Null for no view, so nothing is drawn.
 */
function drawRunChip(view) {
  if (view === null || view === undefined) return null
  const chip = el('span', `run-chip is-${view.tone}${view.next === null ? '' : ' is-pending'}`)
  chip.title = view.title
  chip.append(el('span', 'run-now', view.now))
  if (view.next !== null) {
    // The arrow and the setting after it stay together: a narrow chip wraps before them.
    const arrow = el('span', 'run-arrow', '→')
    arrow.setAttribute('aria-hidden', 'true')
    const to = el('span', 'run-to')
    to.append(arrow, el('span', `run-next is-${view.next.tone}`, view.next.text))
    chip.append(to)
  }
  return chip
}

function drawLane(lane, state) {
  const isOpen = openLanes.has(lane.name)
  // T13 part 3: an asleep chat whose turn was cut resumes by itself: a quiet colour, no alarm (`is-asleep`).
  const isAsleepCut = lane.asleep === true && lane.state === 'interrupted'
  const card = el('article', `lane is-${lane.state}${isAsleepCut ? ' is-asleep' : ''}${lane.isLeftover ? ' is-leftover' : ''}${isOpen ? ' is-open' : ''}`)
  card.dataset.lane = lane.name
  const row = el('div', 'lane-row')

  const who = el('div', 'who')
  const names = el('div', 'who-names')
  // B392: waiting for the partner's answer has a colour of its own.
  names.append(el('h3', '', lane.name), el('span', `pill is-${(lane.waitsForPartner ?? []).length > 0 && !lane.isLeftover ? 'partner' : lane.state === 'free' && lane.isRunning === false && lane.asleep !== true ? 'off' : isAsleepCut ? 'asleep' : lane.state}`, lane.isLeftover ? 'Leftover' : laneStateText(lane)))
  // The model chip (runchip) beside the pill: what the chat runs at now, and a switch it waits for. None for a leftover.
  const runChip = lane.isLeftover ? null : drawRunChip(runChipOf(lane))
  if (runChip !== null) names.append(runChip)
  // T13 part 3: an asleep chat says so quietly, with since when and what wakes it.
  if (lane.asleep === true && lane.state !== 'off') {
    const asleep = el('small', 'not-running', 'asleep')
    asleep.title = `${asleepWords(lane)}. Its process ended; a message through the app wakes it.`
    names.append(asleep)
  } else if (lane.isRunning === false && lane.state !== 'off') {
    // B315 (a lane that is "Not running" says so in its pill already): after a restart of the app a chat does not run
    // until it is opened, or messaged through the app.
    const idle = el('small', 'not-running', 'not running')
    idle.title = `This chat's process is not running: nothing reaches it until its chat is opened, or ${board?.workers?.mainTitle ?? 'the main chat'} starts it.`
    names.append(idle)
  }
  // B235: whether the Workers mod compacted it after its last report, or why not. B307: on the row only when something
  // is wrong; else on hovering the name.
  // B547: a worker that owes a clear says so on its row, before the mod's last word.
  const owed = clearOwedLine(lane.clearOwed ?? null, clock)
  if (owed !== null) {
    const note = el('small', 'compaction is-warning', owed.text)
    note.title = owed.title
    names.append(note)
  }
  // B577: a chat whose session was stopped takes no word until it gets input: its row says since when.
  const stopped = stoppedLine(lane.stopped ?? null, clock)
  if (stopped !== null) {
    const note = el('small', 'compaction is-warning', stopped.text)
    note.title = stopped.title
    names.append(note)
  }
  const compacted = compactionLine(lane.compaction ?? null, clock)
  if (owed !== null) names.title = compacted?.title ?? ''
  else if (compacted !== null && compacted.isWarning) {
    const note = el('small', 'compaction is-warning', compacted.text)
    note.title = compacted.title
    names.append(note)
  } else if (compacted !== null && compacted.log !== undefined) names.append(clearedNote(compacted))
  else if (compacted !== null) names.title = compacted.title
  // B143: a worker can be removed; the main chat cannot. The board asks the main chat, which closes the worker.
  const main = state.workers?.mainTitle ?? 'the main chat'
  const removal = removalView(lane, main, state.readAt)
  const isWarned = removal.canRemove && warned.has(lane.name) && removal.reasons.length > 0 && !removal.isDisabled
  // B159: the button sits in the part a click on "⋯" unfolds, as in the agreed design.
  const tools = []
  if (removal.canRemove && (state.workers?.main ?? null) !== null) {
    const remove = el('button', `remove-button${isWarned ? ' is-warned' : ''}`, '✕ Remove')
    remove.type = 'button'
    remove.dataset.remove = lane.name
    remove.disabled = removal.isDisabled || sending.has(`remove:${lane.name}`)
    remove.title = removal.reasons.length === 0 ? 'Asks the main chat to close this worker.' : 'This worker is not free: the board says what would stop first.'
    tools.push(remove)
  }
  // B83: a worker's task can be stopped from the board, after one question.
  const stop = stopPart(lane, state)
  if (stop !== null) tools.push(stop)
  // B438: "Check now" ("Out of sync?" until the supervisor): the board's own checks, and the main chat checks this worker.
  const sync = syncPart(lane, state)
  if (sync !== null) tools.push(sync)
  // B159: the worker's icon takes the colour of its state.
  const sign = el('span', `worker-icon is-${lane.isLeftover ? 'leftover' : isAsleepCut ? 'asleep' : lane.state}`)
  sign.setAttribute('aria-hidden', 'true')
  sign.append(icon('chat'))
  who.append(sign, names)

  // B307: one line: the task, or since when it is free. What it does now and why it counts as working between two
  // turns are in the task's tooltip and in the details "⋯" unfolds.
  const what = el('div', 'what')
  // An off worker that holds no work is quiet: no task, no bar, no alert, nothing red in its Process column.
  const offWork = offWorkOf(lane, state, main)
  const isQuietOff = offWork?.isIdle === true
  const task = isQuietOff ? null : lane.task
  const more = [
    lane.state === 'working' && (lane.doingNow ?? null) !== null ? `Now: ${lane.doingNow}` : null,
    lane.state === 'working' && (lane.between ?? null) !== null ? `Between turns: ${lane.between.replace(/^Its turn has ended; /, '')}` : null,
  ].filter(Boolean)
  if (task === null) {
    if (lane.state === 'working') {
      const none = el('p', 'task is-none', 'Task not recorded yet')
      if (more.length > 0) none.title = more.join('\n')
      what.append(none)
    }
    const free = freeShort(lane, clock)
    if (free !== null) {
      const line = el('p', 'note free-since', free)
      line.title = freeLine(lane, clock)
      what.append(line)
    }
  } else {
    const title = taskTitle(lane)
    if (more.length > 0) title.title = [title.title, ...more].filter(Boolean).join('\n')
    what.append(title)
  }
  // B159: the progress of its task in a column of its own: a bar of its steps, and its step line (B108) under it.
  const progress = el('div', 'progress-cell')
  const bar = el('div', 'bar')
  const done = el('div', 'fill')
  const hasSteps = task !== null && Number.isFinite(task.step) && Number.isFinite(task.steps) && task.steps > 0
  done.style.width = hasSteps ? `${Math.max(0, Math.min(100, (task.step / task.steps) * 100))}%` : '0%'
  bar.append(done)
  // B307: a worker without a task has no bar either.
  if (task !== null) progress.append(bar)
  const steps = task === null ? null : stepLine(lane, state.readAt)
  if (steps !== null) progress.append(drawStepLine(lane, steps))
  else if (hasSteps) progress.append(el('small', 'progress-count', `${task.step} of ${task.steps}`))
  else if (task !== null) progress.append(el('small', 'progress-count', 'no steps given'))
  // T13 part 3: an asleep one is no alarm: the board sends it its resume word.
  if (isAsleepCut) what.append(el('p', 'off-idle', `Interrupted when its chat stopped: it resumes by itself (${asleepWords(lane)}).`))
  else if (lane.state === 'interrupted') what.append(el('p', 'alert', lane.report?.state === 'idle' ? 'Idle with its task open: its turn ended before its task was reported; it does nothing until it is woken.' : 'Cut off in the middle of its turn: it does nothing until it is resumed.'))
  // B315: its process does not run. With work it waits for, that is the alarm; without, a muted line.
  if (offWork !== null) what.append(el('p', isQuietOff ? 'off-idle' : 'alert', offWork.text))
  if (lane.state === 'suspended') what.append(el('p', `held${lane.suspended.isBack ? ' is-back' : ''}`, heldText(lane.suspended)))
  if (lane.state === 'waiting') {
    // B100: the lane opens what it waits for; the line is a button, so the keyboard reaches it too.
    const open = el('button', 'needs-you', 'Needs your decision')
    open.type = 'button'
    open.title = 'See what it waits for, and answer it here'
    open.append(el('small', '', 'see and answer ›'))
    what.append(open)
  }
  const alerts = isQuietOff ? [] : alertsOf(lane, state)
  if (alerts.length > 0) what.append(el('p', 'alert', alerts.join(' · ')))
  for (const flag of laneFlags(lane, state.restart ?? null)) {
    const line = el('p', `lane-flag is-${flag.tone}`, flag.text)
    if (flag.button?.recheck !== undefined) {
      const again = el('button', 'choice', flag.button.label)
      again.type = 'button'
      again.dataset.recheck = flag.button.recheck
      again.disabled = sending.has(`recheck:${flag.button.recheck}`)
      again.title = `The board checks ${flag.button.recheck} again`
      line.append(' ', again)
    } else if (flag.button !== null) {
      const start = el('button', 'choice', flag.button.isAsked ? `${flag.button.label}: asked` : flag.button.label)
      start.type = 'button'
      start.dataset.start = flag.button.start
      start.disabled = flag.button.isAsked || sending.has(`start:${flag.button.start}`)
      start.title = `Asks ${state.restart.main} to start it`
      line.append(' ', start)
    }
    if (problems.has(`recheck:${flag.button?.recheck}`)) line.append(' ', el('span', 'lane-flag-problem', problems.get(`recheck:${flag.button.recheck}`)))
    what.append(line)
  }
  if (removal.line !== null) what.append(el('p', `remove-line is-${removal.line.tone}`, removal.line.text))
  if (problems.has(`remove:${lane.name}`)) what.append(el('p', 'remove-line is-problem', problems.get(`remove:${lane.name}`)))
  // B438: what became of its last sync check, on the row itself: asked, or the main chat's answer in one line.
  const syncLine = syncLineOf(state.changeAsks?.sync?.[lane.name] ?? null, main)
  if (syncLine !== null) what.append(el('p', `sync-line is-${syncLine.tone}`, syncLine.text))
  if (problems.has(`sync:${lane.name}`)) what.append(el('p', 'sync-line is-problem', problems.get(`sync:${lane.name}`)))

  // B307: the column "Next in queue": the next step's id and title, and why it waits; empty when nothing is queued.
  const queue = el('div', 'queue')
  const next = nextInQueue(lane.queue)
  if (next !== null) {
    const first = el('div', 'queue-first')
    const item = el('button', 'queue-item queue-next')
    item.type = 'button'
    item.dataset.lane = lane.name
    item.dataset.step = '0'
    // B113: why it is not started, in full, with how long it takes and the length of the queue.
    item.title = [lane.queue[0].text, [`Queue (${lane.queue.length})`, next.id, about(lane.queue[0].minutes) ?? 'no time given'].filter(Boolean).join(' · '), whyText(lane.queue[0].why)?.text ?? null, 'Show the details'].filter(Boolean).join('\n')
    const words = el('span', 'queue-text')
    if (next.isFix) words.append(fixChip(), ' ')
    if (next.id !== null) words.append(el('span', 'queue-id', next.id), ' ')
    words.append(next.title)
    if (next.why !== null) words.append(el('span', `why is-${next.why.tone}`, ` · ${next.why.text}`))
    item.append(words)
    first.append(item)
    if (next.more > 0) first.append(el('div', 'queue-more', `+${next.more}`))
    queue.append(first)
  }

  const menu = el('div', 'lane-menu-cell')
  const unfold = el('button', 'lane-menu', '⋯')
  unfold.type = 'button'
  unfold.dataset.lane = lane.name
  // B438: the main chat and a leftover have neither "Check now" nor Remove.
  const menuWords = lane.isMain || lane.isLeftover ? 'the whole queue and the details' : 'the whole queue, the details, Check now and Remove'
  unfold.title = `${menuWords[0].toUpperCase()}${menuWords.slice(1)}`
  unfold.setAttribute('aria-label', `${lane.name}: ${menuWords}`)
  unfold.setAttribute('aria-expanded', String(isOpen))
  menu.append(unfold)

  row.append(who, what, progress, isQuietOff ? el('div', 'eta is-muted') : drawEta(lane, state.readAt), queue, menu)
  card.append(row)
  if (isWarned) {
    card.classList.add('has-warning')
    card.append(drawRemoveWarning(lane, removal, main))
  }
  if (isOpen) {
    const more = drawMore(lane, state)
    if (tools.length > 0) {
      const bar = el('div', 'lane-tools')
      bar.append(...tools)
      more.prepend(bar)
    }
    card.append(more)
  }
  return card
}

$('lanes').addEventListener('click', event => {
  const head = event.target.closest('.queue-head, .lane-menu')
  if (head === null) return
  if (!openLanes.delete(head.dataset.lane)) openLanes.add(head.dataset.lane)
  if (board !== null) drawLanes(board)
})

// openchats:start
/**
 * B322: the link the Claude desktop app opens as a new chat of its Code tab, in `folder`, with its first words ready
 * (`claude://code/new`, its `q` and `folder`): the app neither sends them nor names the chat from outside.
 */
function openChatLink(folder, words) {
  return `claude://code/new?q=${encodeURIComponent(words)}&folder=${encodeURIComponent(folder)}`
}

/**
 * B322, B335: the first words of a new project's main chat: it names itself with its title (the board then knows it),
 * joins the list of chats, reads its job and the project's own facts, and starts the Advisor by a start card or a chip
 * (`advisor`, its title, when the settings name one).
 */
function firstWords({ title, name, projectName, project, board, advisor = null, task = null }) {
  // Review: a path as the board's folder writes it (a Mac's with /).
  const sep = board.includes('\\') || !board.includes('/') ? '\\' : '/'
  const at = (base, ...parts) => [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
  return [
    `You are the main chat of the project ${projectName}, worked on with the worker board.`,
    `1. Name this chat "${title}": call the app's session tool set_session_title (mcp__ccd_session_mgmt__set_session_title) with session_id "self" and that title.`,
    `2. Join the list of chats: when the tool mcp__workers__chat is there, call it with action "join", name "${name}", role "main".`,
    `3. Read your job, ${at(board, 'roles', 'main.md')}, the words the board and the chats share, ${at(board, 'roles', 'protocol.md')}, this project's facts, ${at(project, '.claude', 'main-briefing.md')}, and how to answer the user, ${at(project, 'CLAUDE.md')}.`,
    // B324: the trial's main chat had no spawn_task, only start cards: the words name both and take the one there is.
    ...(advisor === null ? [] : [`4. Start the Advisor as you start a worker: a new chat titled "${advisor.title}" (a start card, mcp__ccd_session__start_session, or a chip, mcp__ccd_session__spawn_task, whichever the app gives you), whose prompt tells it that it is the Advisor (the partner) of this project, to join the list as "${advisor.name}" with role "worker", and to read ${at(board, 'roles', 'partner.md')}, ${at(board, 'roles', 'protocol.md')} and ${at(project, 'CLAUDE.md')}. Tell the user in one line to click it.`]),
    // B767: the stored start-worker task, made in this first turn the person typed (only then is its Auto mode saved).
    ...(task === null ? [] : [`${advisor === null ? 4 : 5}. ${task.replace(/ Then say in one line that they are made\.$/, '')}`]),
    'Then say in one line that you are ready: the board then asks you for workers.',
  ].join('\n')
}

/**
 * B335: the one chat a new project's Initialise button opens, its main chat (`{ title, words, link }`), while the list
 * has none; null otherwise, on the demo, on a board that only shows, or without a list of chats and its prefix (the
 * board finds no chat then). The main chat starts the Advisor itself.
 */
function setupChat(state) {
  const open = state?.openChats ?? null
  const workers = state?.workers ?? null
  if (open === null || workers === null || workers.main !== null || typeof workers.mainTitle !== 'string' || typeof workers.project !== 'string' || workers.project === '') return null
  const prefix = typeof state.chatPrefix === 'string' ? state.chatPrefix : ''
  if (prefix === '') return null
  const name = workers.mainTitle.slice(prefix.length) || 'Main'
  // An Advisor named as the main chat would be a second main chat.
  const hasAdvisor = typeof open.advisor === 'string' && open.advisor !== '' && open.advisor.toLowerCase() !== name.toLowerCase() && (state.advisor ?? null) === null
  const task = typeof state.codeJobs?.taskLine === 'string' ? state.codeJobs.taskLine : null
  const words = firstWords({ title: workers.mainTitle, name, projectName: open.name || name, project: workers.project, board: open.board, advisor: hasAdvisor ? { name: open.advisor, title: `${prefix}${open.advisor}` } : null, task })
  return { title: workers.mainTitle, words, link: openChatLink(workers.project, words) }
}

/** B335: the button's words: Initialise, or, within five minutes of its click, that the main chat was opened. */
function initLabel(openedAt, now, clockOf) {
  return openedAt !== null && openedAt !== undefined && now - openedAt < 5 * 60_000 ? `Opened ${clockOf(openedAt)}: press Enter in the Claude app` : 'Initialise'
}
// openchats:end

/** B335: whether the project has chats at all, its main chat missing (one archived, for example). */
const hasOtherChats = state => (state.chats ?? []).length > 0 || (state.advisor ?? null) !== null

/** B335: when the Initialise button was clicked: it says so for a while, so a second click is no surprise. */
let initialisedAt = null

/**
 * B335: a new project's box: one line and the Initialise button, which opens its main chat in the Claude app. Its
 * heading says no chats only when there are none (a project whose main chat is gone has its other chats still).
 */
function setupBox(chat, hasChats = false) {
  const box = el('section', 'open-chats')
  box.append(el('h3', '', hasChats ? 'No main chat yet' : 'This project has no chats yet'), el('p', 'open-chats-about', 'One click opens its main chat in the Claude app: press Enter there, and it sets up the rest.'))
  const link = el('a', 'open-chats-button', initLabel(initialisedAt, Date.now(), clock))
  link.href = chat.link
  link.title = `Opens ${chat.title} in the Claude app`
  link.dataset.initialise = ''
  box.append(link)
  return box
}

// Review: on the page as a whole, so the button under the simple view's bar says so too.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-initialise]')
  if (button === null) return
  initialisedAt = Date.now()
  // The link opens the app; the button says so once the page has followed it.
  setTimeout(() => { button.textContent = initLabel(initialisedAt, Date.now(), clock) }, 0)
})

// workers:start
// B124: under the lanes, what the board says about workers: how to make the main chat when the list has none, that
// it asked the main chat for workers and what happens next, and the button for one more. The names come from the
// list of chats: no word here names a project.

const COUNT_WORDS = { 2: 'two', 3: 'three' }
/** B213: what changes when no Workers mod takes the board's words. */
const WITHOUT_MOD = 'No Workers mod answers this board: what you send is copied for you to paste into the chat, the board cannot tell whether a chat runs, and a large worker is not compacted after its report.'
/** "one more worker", "three workers". */
const workersWord = count => (count === 1 ? 'one more worker' : `${COUNT_WORDS[count] ?? count} workers`)

/**
 * What the row under the lanes shows: `kind` is `none` (no main chat: `steps` to make one, each a list of plain
 * words and `{ code }`), `alone` (the main chat and no worker) or `more` (workers exist); `lines` each with a
 * `tone` ('', asked, note, problem); `button` with its label and whether it waits for an open ask. Null when the
 * server says nothing about workers.
 */
function workersView(workers, now) {
  if (workers === null || workers === undefined) return null
  // B131, B137: what the board looks for and did not find, with where (the paths from the settings).
  const lookFor = [
    ...(workers.lookFor ?? []).map(text => ({ tone: 'problem', text })),
    // B213: what the board cannot do or know without the Workers mod, in one plain line.
    ...(workers.withoutMod === true ? [{ tone: 'note', text: WITHOUT_MOD }] : []),
  ]
  if (workers.main === null) {
    // Without a list of chats there is no main chat's name to give: the lines say what to make first.
    const hasList = typeof workers.mainTitle === 'string'
    return {
      kind: 'none',
      title: 'No main chat yet',
      text: `The board shows the chats of this project: the main chat, which hands out the work, and its workers. ${hasList ? 'It has found no main chat. To begin:' : 'It has not found what it looks for yet:'}`,
      steps: !hasList ? [] : [
        workers.project === '' ? ['In the Claude app, start a new chat in the project\'s folder.'] : ['In the Claude app, start a new chat in the folder ', { code: workers.project }, '.'],
        ['Name it ', { code: workers.mainTitle }, ': the name the list of chats gives the main chat.'],
        ['The board finds it within a minute and asks it for three workers.'],
      ],
      lines: lookFor,
      button: null,
    }
  }
  const isAlone = workers.count === 0
  const ask = workers.ask ?? null
  const main = `the main chat, ${workers.mainTitle},`
  const lines = (() => {
    const done = ask === null || (ask.state === 'delivered' && !ask.isOpen && ask.arrived >= ask.count)
    if (done) return [{ tone: '', text: isAlone ? `The board asks ${main} for three workers as soon as its chat is open.` : `Asks ${main} to start one more worker. Any worker takes any task.` }]
    if (ask.state === 'expired' || ask.state === 'failed') return [{ tone: 'problem', text: `The ask of ${clock(ask.at)} did not reach the main chat: open its chat, then ask again.` }]
    const asked = `${ask.why === 'button' ? 'You asked' : 'The board asked'} ${main} for ${workersWord(ask.count)} at ${clock(ask.at)}`
    if (!ask.isOpen) return [{ tone: '', text: `${asked}; ${ask.arrived === 0 ? 'none has come' : `${ask.arrived} of ${ask.count} came`}.` }]
    const first = { tone: 'asked', text: ask.arrived > 0 ? `${asked}: ${ask.arrived} of ${ask.count} ${ask.arrived === 1 ? 'has' : 'have'} come.` : `${asked}.` }
    if (ask.state === 'waiting') return [first, { tone: 'note', text: 'It waits for the main chat to take it: its chat must be open.' }]
    if (ask.state === 'taken') return [first, { tone: 'note', text: 'It is handed to the main chat.' }]
    // Whether the main chat starts a chat itself or puts up a chip for the person to click, this stays true.
    return [first, { tone: 'note', text: ask.count === 1
      ? 'The main chat starts it. Where it puts a chip into its chat instead, click the chip.'
      : 'The main chat starts them. Where it puts a chip into its chat for each worker instead, click each chip: one chip starts one worker. Each worker then shows here as a lane.' }]
  })()
  return {
    kind: isAlone ? 'alone' : 'more',
    title: isAlone ? 'No workers yet' : null,
    text: null,
    steps: [],
    lines: [...lookFor, ...lines],
    button: { label: isAlone ? 'Ask for three workers' : '+ Add worker', isDisabled: ask?.isOpen === true },
  }
}
// workers:end

/** B124: the row under the lanes (see `workersView`), or null. */
function drawWorkers(state) {
  const shown = workersView(state.workers, state.readAt)
  fill($('workers-add'), [])
  if (shown === null) return null
  const isRow = shown.kind === 'more'
  const box = el(isRow ? 'div' : 'section', isRow ? 'lane-add' : 'empty-workers')
  if (shown.title !== null) box.append(el('h3', '', shown.title))
  if (shown.text !== null) box.append(el('p', '', shown.text))
  // B335: a new project without a main chat: one Initialise button, nothing else.
  const setup = shown.kind === 'none' ? setupChat(state) : null
  if (setup !== null) return setupBox(setup, hasOtherChats(state))
  if (shown.steps.length > 0) {
    const list = el('ol')
    for (const parts of shown.steps) {
      const item = el('li')
      item.append(...parts.map(part => (typeof part === 'string' ? part : el('code', '', part.code))))
      list.append(item)
    }
    box.append(list)
  }
  const lines = el('div', 'workers-lines')
  for (const line of shown.lines) lines.append(el('p', `workers-line${line.tone === '' ? '' : ` is-${line.tone}`}`, line.text))
  if (problems.has('spawn')) lines.append(el('p', 'workers-line is-problem', problems.get('spawn')))
  if (shown.button === null) {
    box.append(lines)
    return box
  }
  const button = el('button', 'spawn-button', shown.button.label)
  button.type = 'button'
  button.dataset.spawn = 'ask'
  button.disabled = shown.button.isDisabled || sending.has('spawn')
  button.title = 'The board asks the main chat; the main chat starts the worker.'
  if (isRow) {
    // B159: in the panel's head, as in the agreed design. What it does is its title; only what became of an ask is said.
    button.title = shown.lines.find(line => line.tone === '')?.text ?? button.title
    for (const line of [...lines.children]) if (line.className === 'workers-line') line.remove()
    // B438: "Check now" for the whole board beside it; what became of it stands in the head's lines.
    const check = syncLineOf(state.changeAsks?.sync?.board ?? null, state.workers.mainTitle ?? 'the main chat')
    if (check !== null) lines.append(el('p', `workers-line sync-line is-${check.tone}`, check.text))
    if (problems.has('sync:board')) lines.append(el('p', 'workers-line sync-line is-problem', problems.get('sync:board')))
    // The supervisor: while its section shows, "Check now" stands in it, not twice.
    fill($('workers-add'), [lines, isSupervisorShown(state.supervisor ?? null) ? null : boardSyncButton(state), button])
    return null
  }
  box.append(lines, button)
  return box
}

// advisorlane:start
/**
 * B280: how the Advisor stands on its card: working, asking you something, idle, or not running (its chat's process
 * is not there). The person, 2026-10-17: "i want to see what you are doing in the worker board so I dont stop your
 * current task ... show the advisor in the workers tab on the overview but distinct from the workers".
 */
function advisorStanding(advisor) {
  // T13 part 3: an asleep one (its process ended while its last report stands) is no closed one: a message wakes it.
  if (advisor.isRunning === false && advisor.asleep !== true) return { key: 'off', label: 'Not running' }
  if (advisor.asleep === true && advisor.state === 'interrupted') return { key: 'asleep', label: 'Interrupted, resumes by itself' }
  if (advisor.state === 'working') return { key: 'working', label: 'Working' }
  // A server without the card's fields: an Advisor that waits (its question form) asks you something.
  if (advisor.asksYou === true || (advisor.asksYou === undefined && advisor.state === 'waiting')) return { key: 'waiting', label: 'Needs your answer' }
  if (advisor.state === 'interrupted') return { key: 'interrupted', label: 'Cut off' }
  if (advisor.state === 'suspended') return { key: 'suspended', label: 'Suspended' }
  return { key: 'free', label: 'Idle' }
}

/**
 * B464: what it asks you, for its row: the first of its open asks by id and title (and how many more), or its chat when
 * the app's question form asks; null while it asks you nothing. The person, 2026-10-21: "i dont see this. please fix
 * the notification for that" (its row said "Needs your answer" beside a refine line that waited for it, not for them).
 */
function advisorAsks(advisor) {
  if (advisor?.asksYou !== true) return null
  const asks = advisor.asking ?? []
  if (asks.length === 0) return { text: 'Asks you in its chat', tone: 'waiting' }
  const more = asks.length > 1 ? ` and ${asks.length - 1} more` : ''
  return { text: `Asks you (${asks[0].id}${more}): ${asks[0].title}`, tone: 'waiting' }
}

/**
 * The person, 2026-10-28 ("it's not clear what else will be picked up from the refinement ... i cant click on the 5 waiting for it
 * and get an expand of what those 5 are"): where an item of the Advisor's queue leads: a step, an ask or an instruction opens its
 * window, an incident goes to the supervisor's part, a goal to the Goals part; null for any other word.
 */
function advisorNextHref(id) {
  const code = String(id ?? '')
  return /^[BQI]\d+$/.test(code) ? `#details=${code}` : /^X\d+$/.test(code) ? '#supervisor' : /^G\d+$/.test(code) ? `#advice/goals/${code}` : null
}

/** One row of the Advisor's queue in words: "Q2 · Lead: Icons?", "refine B770: <title>", "incident X104: <title>", "evaluate G61: <title>". */
function advisorNextWords(one) {
  const tail = (one.title ?? '') === '' ? '' : `: ${one.title}`
  return one.kind === 'question' ? `${one.id} · ${one.who ?? one.from ?? 'nobody'}${tail}` : `${[one.kind, one.id].filter(Boolean).join(' ')}${tail}`
}

/**
 * "Next for it (N)": the server's whole queue of the Advisor (the state's `advisor.next`, in pick-up order, the item it is on left
 * out) as `{ count, text, asks, isNext }`: N is the rows and the rounds of the board's clock (which have no row, only the tooltip's
 * words); each row a link where it has one, with where it stands. Null when nothing waits.
 */
function advisorNextView(queued, next) {
  const rows = next.filter(one => one !== null && typeof one === 'object' && typeof one.kind === 'string')
  const rounds = queued?.rounds ?? 0
  if (rows.length + rounds === 0) return null
  const kinds = [['question', 'question', 'questions'], ['refine', 'refine', 'refines'], ['incident', 'incident', 'incidents'], ['evaluate', 'evaluation', 'evaluations']]
    .map(([kind, single, many]) => [rows.filter(one => one.kind === kind).length, single, many])
  kinds.push([rows.length - kinds.reduce((sum, [one]) => sum + one, 0), 'message', 'messages'], [rounds, 'round of the clock', 'rounds of the clock'])
  return {
    count: rows.length + rounds, isNext: true,
    text: kinds.filter(([one]) => one > 0).map(([one, single, many]) => `${one} ${one === 1 ? single : many}`).join(', '),
    asks: rows.map(one => ({ id: one.id ?? null, kind: one.kind, href: advisorNextHref(one.id), text: advisorNextWords(one), stand: standWords(one.stand) })),
  }
}

/** B280: what waits for the Advisor, not in its chat yet: a count and its kinds ("1 refine, 2 messages"); null for nothing. */
function advisorQueued(queued, waiting = [], next = null) {
  // 2026-10-28: a server that sends its whole queue (`advisor.next`): that is the list; an older one, the lines as they were.
  if (Array.isArray(next)) return advisorNextView(queued, next)
  // The person, 2026-10-26 ("I also expect this Q423 is in the queue with the advisor"; then "all of it"): what waits for
  // it besides messages (the state's `advisor.waiting`: the questions it answers for you first, refines),
  // each one a link to its step or ask with where it stands. An entry without a kind is a question (an older server).
  const items = Array.isArray(waiting) ? waiting.filter(one => typeof one?.id === 'string').map(one => ({ ...one, kind: one.kind ?? 'question' })) : []
  const of = kind => items.filter(one => one.kind === kind).length
  // The refines of the list are the refines; without any in it, the count of the words that wait.
  const refines = of('refine') > 0 ? of('refine') : queued?.refines ?? 0
  const kinds = [[of('question'), 'question', 'questions'], [refines, 'refine', 'refines'], [queued?.rounds ?? 0, 'round of the clock', 'rounds of the clock'], [queued?.words ?? 0, 'message', 'messages']]
  const count = kinds.reduce((sum, [one]) => sum + one, 0)
  if (count === 0) return null
  const text = kinds.filter(([one]) => one > 0).map(([one, single, many]) => `${one} ${one === 1 ? single : many}`).join(', ')
  if (items.length === 0) return { count, text }
  const named = one => (one.kind === 'refine' ? `refine ${one.id}: ${one.title ?? ''}` : `${one.id} · ${one.from ?? one.who ?? 'nobody'}: ${one.title ?? ''}`)
  return { count, text, asks: items.map(one => ({ id: one.id, kind: one.kind, href: `#details=${one.id}`, text: named(one), stand: standWords(one.stand) })) }
}

/**
 * The person, 2026-10-26 ("does this include ensuring the advisor also starts with B??? or Q??? when it does something"): the
 * Advisor's task line when the board knows the item it is on (the state's `advisor.on`, from the board's word it took): the
 * item's id as a link (a step or an ask opens its window; an incident goes to the supervisor's part), then its title, as a
 * worker's line names its step. Its own card's text and its step count are in the tooltip. `lane` carries its `task`.
 */
function advisorOnLine(on, lane) {
  const line = el('p', 'task clip advisor-on')
  const code = el('a', 'task-code advisor-on-code', on.id)
  code.href = on.kind === 'incident' ? '#supervisor' : `#details=${on.id}`
  code.title = on.kind === 'incident' ? `Incident ${on.id}: the supervisor's part on the Overview` : `Open ${on.id}`
  code.addEventListener('click', event => event.stopPropagation())
  line.append(code, ' ', on.title ?? '')
  const task = lane?.task ?? null
  const step = task !== null && Number.isInteger(task.step) && Number.isInteger(task.steps) ? `Step ${task.step} of ${task.steps}${Array.isArray(task.names) && task.names[task.step - 1] ? `: ${task.names[task.step - 1]}` : ''}` : null
  line.title = [`${on.id} ${on.title ?? ''}`.trim(), (task?.text ?? '') === '' ? null : `Its own card: ${task.text}`, step].filter(Boolean).join('\n')
  return line
}

/**
 * What waits for it, on its line: "Next for it:" (an older server: "Waiting for it:"), each a link that opens its item where it
 * has one (the click does not open its chat) and, in quiet words after it, where it stands (the person, 2026-10-26: queued, or the
 * Advisor is on it; 2026-10-28: next to refine).
 */
function drawWaitingAsks(asks, head = 'Waiting for it: ') {
  const line = el('p', 'advisor-lane-asks')
  line.append(el('span', 'muted', head))
  for (const ask of asks) {
    const row = el('span', 'advisor-lane-ask-row')
    if ((ask.href ?? null) === null) row.append(el('span', 'advisor-lane-ask', ask.text))
    else {
      const link = el('a', 'advisor-lane-ask', ask.text)
      link.href = ask.href
      link.title = ask.kind === 'refine' ? `Open ${ask.id}: the step the Advisor refines`
        : ask.kind === 'incident' ? `Incident ${ask.id}: the supervisor's part on the Overview`
          : ask.kind === 'evaluate' ? `Goal ${ask.id} on the Goals part`
            : ask.kind === 'question' ? `Open ${ask.id}: the whole question, its options and advice, who asked it`
              : `Open ${ask.id}`
      link.addEventListener('click', event => event.stopPropagation())
      row.append(link)
    }
    if ((ask.stand ?? null) !== null) row.append(el('span', 'advisor-lane-ask-stand muted', ask.stand))
    line.append(row)
  }
  return line
}

/** Whether "Next for it" is open on the Advisor's card: this page only; it survives the board's redraws. */
const advisorNextUi = { isOpen: false }

/**
 * "Next for it (N)", the count in the Advisor's card as a quiet button: a click opens and closes the list under its line. The
 * click is the button's: it does not open the Advisor's chat (the card's own click). With no row to show (only rounds of the
 * clock) it is a count alone.
 */
function advisorNextButton(queued) {
  const button = el('button', 'advisor-waits-count', `Next for it (${queued.count})`)
  button.type = 'button'
  button.dataset.advisorNext = ''
  button.title = queued.text
  button.disabled = queued.asks.length === 0
  button.setAttribute('aria-expanded', advisorNextUi.isOpen && queued.asks.length > 0 ? 'true' : 'false')
  button.addEventListener('click', event => {
    event.stopPropagation()
    advisorNextUi.isOpen = !advisorNextUi.isOpen
    if (board !== null) drawLanes(board)
    $('lanes').querySelector('[data-advisor-next]')?.focus()
  })
  return button
}
// advisorlane:end

/**
 * B280: the Advisor's card under the workers, set apart by its own label, line and accent: how it stands, its task as
 * its card names it (topic, step, time left), and what waits for it. No queue and no buttons of a worker: it takes no
 * tasks. A click, or Enter, opens its chat on the Advisor tab. Null without an Advisor.
 */
function drawAdvisorLane(state) {
  const advisor = state.advisor ?? null
  // B424: the partner's helper, on its own card right under the Advisor's.
  const helper = drawHelperCard(state)
  if (advisor === null && helper === null) return null
  const part = el('div', 'advisor-part')
  const label = el('p', 'advisor-label')
  label.append(el('b', '', 'Advisor'), el('span', '', 'advises on what to do next; takes no tasks'))
  if (advisor === null) {
    part.append(label, helper)
    return part
  }
  const standing = advisorStanding(advisor)
  // The lane's own parts read it as they read a worker.
  const lane = { name: advisor.name, state: advisor.state, task: advisor.task ?? null, eta: advisor.eta ?? null, doingNow: advisor.doingNow, between: advisor.between ?? null, givenTask: null, isLeftover: false, isWithoutTime: false, cutOffAt: null }
  const card = el('article', 'lane is-advisor')
  card.dataset.standing = standing.key
  card.dataset.openAdvisor = ''
  card.tabIndex = 0
  card.setAttribute('role', 'button')
  card.setAttribute('aria-label', `${advisor.name}, ${standing.label}: open its chat on the Advisor tab`)
  card.title = 'Open its chat on the Advisor tab'
  const row = el('div', 'lane-row')

  const who = el('div', 'who')
  const sign = el('span', `worker-icon is-${standing.key}`)
  sign.setAttribute('aria-hidden', 'true')
  sign.append(icon('advisor'))
  const names = el('div', 'who-names')
  names.append(el('h3', '', advisor.name), el('span', `pill is-${standing.key}`, standing.label))
  const runChip = drawRunChip(runChipOf(advisor))
  if (runChip !== null) names.append(runChip)
  who.append(sign, names)

  // B307: one line, as a worker's: its task, else what it refines, else how it stands; the rest in the tooltip.
  const what = el('div', 'what')
  // 2026-10-26: when the board knows the item it is on (the board's word it took), the line names it: its id as a link, then its title.
  const on = advisor.on ?? null
  const hasTask = on !== null || (lane.task !== null && (lane.task.text ?? '') !== '')
  if (hasTask) {
    const title = on !== null ? advisorOnLine(on, lane) : taskTitle(lane)
    const more = [
      advisor.state === 'working' && advisor.doingNow !== null ? `Now: ${advisor.doingNow}` : null,
      advisor.state === 'working' && lane.between !== null ? `Between turns: ${lane.between.replace(/^Its turn has ended; /, '')}` : null,
    ].filter(Boolean)
    if (more.length > 0) title.title = [title.title, ...more].filter(Boolean).join('\n')
    what.append(title)
  } else if (advisor.state === 'working') what.append(el('p', 'task is-none', 'Task not recorded yet'))
  // B287: what it refines, as on the Advisor tab; under a task only when it is stopped and waits for Send again.
  const refine = advisorRefine(state.backlog)
  // What the row does not say, on hovering the card and its line.
  const tip = []
  // B464: what it asks you comes first; what it refines then goes in the tooltip.
  const asking = advisorAsks(advisor)
  const isAsking = asking !== null && !hasTask
  if (isAsking) {
    const line = el('p', 'advisor-lane-refine')
    line.append(el('span', `advisor-refine-state is-${asking.tone}`, asking.text))
    what.append(line)
  }
  // The review: under a task, what it asks you is in the tooltip.
  if (asking !== null && hasTask) tip.push(asking.text)
  if (refine !== null && (hasTask || isAsking) && refine.canSend !== true) tip.push(refine.text)
  if (refine !== null && ((!hasTask && !isAsking) || refine.canSend === true)) {
    const line = el('p', 'advisor-lane-refine')
    line.append(el('span', `advisor-refine-state is-${refine.tone}`, refine.text))
    // B312: the board stopped refining it: one round more, in the Refine button's words.
    if (refine.canSend === true) {
      const key = `refine-again:${refine.step}`
      const again = el('button', 'advisor-refine-again', sending.has(key) ? 'Sending…' : 'Send again')
      again.type = 'button'
      again.dataset.refineAgain = refine.step
      again.disabled = sending.has(key)
      again.title = `Ask ${advisor.name} for one more refine round of ${refine.step}`
      line.append(again)
      if (problems.has(key)) line.append(el('span', 'advisor-refine-problem', problems.get(key)))
    }
    what.append(line)
  }
  const isSaid = what.childElementCount > 0
  if (standing.key === 'waiting' && !isSaid) what.append(el('p', 'note', 'It asks you something: see Needs your attention.'))
  if (standing.key === 'off') what.append(el('p', 'note', 'Its chat is not running: what is sent to it waits until it is opened.'))
  if (standing.key === 'free' && Number.isFinite(advisor.idle?.since)) {
    if (isSaid) tip.push(`Idle since ${clock(advisor.idle.since)}`)
    else what.append(el('p', 'note', `idle since ${clock(advisor.idle.since)}`))
  }
  if (tip.length > 0) {
    card.title = [card.title, ...tip].join('\n')
    const first = what.firstElementChild
    if (first !== null) first.title = [first.title, ...tip].filter(Boolean).join('\n')
  }

  // The step count of its own card is in the tooltip of the line that names the item it is on.
  const progress = advisorProgress(on === null ? lane.task : null)

  // B307: its time left once while it works; else nothing, as its pill says how it stands.
  const time = advisor.state === 'working' ? drawEta(lane, state.readAt) : el('div', 'eta is-muted')

  // B307: what waits for it, by kind in the tooltip; nothing when nothing waits (or the server does not count it).
  const queued = advisorQueued(advisor.queued, advisor.waiting ?? (state.withPartner ?? []), advisor.next)
  const waits = el('div', 'queue advisor-waits')
  if (queued !== null && queued.isNext === true) waits.append(advisorNextButton(queued))
  else if (queued !== null) {
    const count = el('span', 'advisor-waits-count', `${queued.count} waiting for it`)
    count.title = queued.text
    waits.append(count)
  }
  // What is next for it, under its line, once "Next for it (N)" is open, each opening its item (the click does not open its chat);
  // an older server's list stays as it was.
  if ((queued?.asks ?? []).length > 0 && (queued.isNext !== true || advisorNextUi.isOpen)) what.append(drawWaitingAsks(queued.asks, queued.isNext === true ? 'Next for it: ' : undefined))

  const open = el('div', 'lane-menu-cell')
  open.append(el('span', 'advisor-open', '›'))
  row.append(who, what, progress, time, waits, open)
  card.append(row)
  part.append(label, card, ...(helper === null ? [] : [helper]))
  return part
}

/** The step a card's task is on, as a bar and a count ("2 of 5"); empty without steps. */
function advisorProgress(task) {
  const progress = el('div', 'progress-cell')
  const hasSteps = task !== null && Number.isFinite(task.step) && Number.isFinite(task.steps) && task.steps > 0
  if (hasSteps) {
    const bar = el('div', 'bar')
    const done = el('div', 'fill')
    done.style.width = `${Math.max(0, Math.min(100, (task.step / task.steps) * 100))}%`
    bar.append(done)
    progress.append(bar)
    // Its step as a count: the step's name and time are in its chat, the time left beside it.
    progress.append(el('small', 'progress-count', `${task.step} of ${task.steps}`))
  }
  return progress
}

/**
 * B424: the partner's helper (the list of chats' "helper", such as Advisor 2) on its own card under the Advisor's:
 * how it stands, its task as its card names it, its step and its time while it works. No queue and no worker buttons:
 * the partner hands it the next refine or result check. Null without a helper.
 */
function drawHelperCard(state) {
  const helper = state.advisorHelper ?? null
  if (helper === null) return null
  const standing = advisorStanding(helper)
  const lane = { name: helper.name, state: helper.state, task: helper.task ?? null, eta: helper.eta ?? null, doingNow: helper.doingNow, between: helper.between ?? null, givenTask: null, isLeftover: false, isWithoutTime: false, cutOffAt: null }
  const card = el('article', 'lane is-advisor is-helper')
  card.dataset.standing = standing.key
  card.dataset.helper = helper.name
  card.setAttribute('aria-label', `${helper.name}, ${standing.label}: helps ${state.advisor?.name ?? 'the Advisor'} with refines and result checks`)
  const row = el('div', 'lane-row')

  const who = el('div', 'who')
  const sign = el('span', `worker-icon is-${standing.key}`)
  sign.setAttribute('aria-hidden', 'true')
  sign.append(icon('advisor'))
  const names = el('div', 'who-names')
  names.append(el('h3', '', helper.name), el('span', `pill is-${standing.key}`, standing.label))
  const runChip = drawRunChip(runChipOf(helper))
  if (runChip !== null) names.append(runChip)
  who.append(sign, names)

  // One line: its task, else what it is for; since when it is idle in the tooltip.
  const what = el('div', 'what')
  if (lane.task !== null && (lane.task.text ?? '') !== '') {
    const title = taskTitle(lane)
    if (helper.state === 'working' && helper.doingNow !== null) title.title = [title.title, `Now: ${helper.doingNow}`].filter(Boolean).join('\n')
    what.append(title)
  } else if (helper.state === 'working') what.append(el('p', 'task is-none', 'Task not recorded yet'))
  else if (standing.key === 'off') what.append(el('p', 'note', 'Its chat is not running: the partner does the next refine itself.'))
  else what.append(el('p', 'note', `helps ${state.advisor?.name ?? 'the Advisor'}: refines and result checks`))
  if (standing.key === 'free' && Number.isFinite(helper.idle?.since)) card.title = `Idle since ${clock(helper.idle.since)}`

  const time = helper.state === 'working' ? drawEta(lane, state.readAt) : el('div', 'eta is-muted')
  // The columns of the Advisor's card, so the two line up; nothing waits for it and nothing opens.
  row.append(who, what, advisorProgress(lane.task), time, el('div', 'queue advisor-waits'), el('div', 'lane-menu-cell'))
  card.append(row)
  return card
}

$('lanes').addEventListener('click', event => {
  // B312: Send again on the Advisor's card: the Refine button's message for that step.
  const again = event.target.closest('[data-refine-again]')
  const advisor = board?.advisor?.name ?? null
  if (again !== null && advisor !== null) {
    send({ to: advisor, command: 'refine', step: again.dataset.refineAgain }, `refine-again:${again.dataset.refineAgain}`)
    return
  }
  if (event.target.closest('[data-open-advisor]') === null || event.target.closest('.step-line, [data-refine-again]') !== null) return
  show('advice')
  showAdvisorPane('chat')
})
$('lanes').addEventListener('keydown', event => {
  if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches('[data-open-advisor]')) return
  event.preventDefault()
  show('advice')
  showAdvisorPane('chat')
})

/**
 * The lanes, drawn anew, and under them the row about workers (B124) and the Advisor's card (B280). A step line that
 * held the keyboard's focus holds it again, so its list of steps stays open.
 */
function drawLanes(state) {
  const focused = document.activeElement?.dataset?.stepsOf ?? null
  // B280: the Advisor's card, drawn anew, keeps the keyboard's focus too.
  const wasOnAdvisor = document.activeElement?.dataset?.openAdvisor !== undefined
  fill($('lanes'), [...state.chats.map(lane => drawLane(lane, state)), drawWorkers(state), drawAdvisorLane(state)].filter(part => part !== null))
  if (wasOnAdvisor) $('lanes').querySelector('[data-open-advisor]')?.focus()
  // B159: the columns are named only when there are lanes under them.
  $('workers-columns').hidden = state.chats.length === 0
  if (focused !== null) [...$('lanes').querySelectorAll('[data-steps-of]')].find(node => node.dataset.stepsOf === focused)?.focus()
}

// remove:start
// B143: "✕ Remove" on a worker's lane. The board only asks: the main chat stops the worker at a safe point, takes it
// out of the list, closes it and hands its queue on. A worker that is not free gets a warning first, which says
// what it is doing and what would stop; removing it then takes a second click. No word here names a project.

/** A line about an ask that is no longer open stays this long. */
const REMOVE_NOTE_MS = 60 * MIN

/**
 * What a lane shows for removing its worker: `canRemove` (a worker: not the main chat, not a leftover), `reasons`
 * (why it is not free, each a line of the warning; none when it is free and nothing is queued for it), `line` (how
 * the newest ask fares, with its `tone`: asked, note, problem) and `isDisabled` while an ask is open. `main` is the
 * main chat's title.
 */
function removalView(lane, main, now) {
  if (lane.isMain || lane.isLeftover) return { canRemove: false, reasons: [], line: null, isDisabled: true }
  // B152: its card says it left the list of chats: the lane says so for a little while, then goes.
  if (Number.isFinite(lane.removedAt)) {
    return { canRemove: true, reasons: [], line: { tone: 'asked', text: `Removed at ${clock(lane.removedAt)}: it left the list of chats, and this lane goes in a moment.` }, isDisabled: true }
  }
  const task = lane.task ?? null
  const what = task === null ? null
    : `"${task.text}"${Number.isInteger(task.step) && Number.isInteger(task.steps) ? `, step ${task.step} of ${task.steps}` : ''}`
  const reasons = []
  if (lane.state === 'working') {
    reasons.push(what === null
      ? 'It is working. What it does stops at a safe point.'
      : `It is working on ${what}${lane.eta ? `, about ${span(lane.eta.leftMs)} left` : ''}. That task stops at a safe point: its work is committed and its branch stays for another worker.`)
  }
  if (lane.state === 'waiting') reasons.push(`It waits for you${what === null ? '' : ` on ${what}`}: your answer would no longer be taken.`)
  if (lane.state === 'suspended') {
    const until = Number.isFinite(lane.suspended?.until) ? ` until ${clock(lane.suspended.until)}` : ''
    reasons.push(lane.suspended?.by === 'parked' ? `It is suspended on purpose${what === null ? '' : ` with ${what}`}: that task would not go on.`
      : `It paused for the limit${until}${what === null ? '' : ` with ${what}`}: that task would not go on.`)
  }
  if (lane.state === 'interrupted') reasons.push(`It was cut off in the middle of ${what ?? 'its turn'}: that work would not be resumed.`)
  if (lane.state === 'unknown') reasons.push('The board cannot tell what it is doing.')
  // B315: its chat is not running; the task its card names would not go on.
  if (lane.state === 'off' && what !== null) reasons.push(`It is not running, and its card still names ${what}: that task would not go on.`)
  const queue = lane.queue ?? []
  if (queue.length > 0) {
    const titles = queue.slice(0, 3).map(step => `"${step.title}"`).join(', ')
    const more = queue.length > 3 ? ` and ${queue.length - 3} more` : ''
    reasons.push(`${queue.length === 1 ? '1 step is' : `${queue.length} steps are`} queued for it: ${titles}${more}. The main chat hands ${queue.length === 1 ? 'it' : 'them'} to another worker.`)
  }

  const ask = lane.removal ?? null
  const asked = ask === null ? '' : `You asked the main chat, ${main}, to remove it at ${clock(ask.at)}.`
  const line = (() => {
    if (ask === null) return null
    if (ask.state === 'expired' || ask.state === 'failed') {
      return now - ask.at < REMOVE_NOTE_MS ? { tone: 'problem', text: `The ask of ${clock(ask.at)} to remove it did not reach the main chat: open its chat, then ask again.` } : null
    }
    if (ask.isOpen) {
      const where = ask.state === 'waiting' ? 'It waits for the main chat to take it.' : ask.state === 'taken' ? 'It is handed to the main chat.' : 'It is typed into its chat.'
      return { tone: 'asked', text: `${asked} ${where}` }
    }
    return now - ask.at < REMOVE_NOTE_MS ? { tone: 'note', text: `${asked} It is still in the list: ask again if it should go.` } : null
  })()
  return { canRemove: true, reasons, line, isDisabled: ask?.isOpen === true }
}
// remove:end

/** B143: the warning under a lane whose worker is not free, with the second click. */
function drawRemoveWarning(lane, removal, main) {
  const box = el('div', 'remove-warning')
  const list = el('ul')
  for (const reason of removal.reasons) list.append(el('li', '', reason))
  const sure = el('button', 'remove-sure', 'Remove anyway')
  sure.type = 'button'
  sure.dataset.removeSure = lane.name
  const keep = el('button', 'remove-keep', 'Keep it')
  keep.type = 'button'
  keep.dataset.removeKeep = lane.name
  const actions = el('div', 'remove-actions')
  actions.append(sure, keep, el('small', '', `The board asks the main chat, ${main}, to stop it at a safe point, take it out of the list and close it.`))
  box.append(el('b', '', `Remove ${lane.name}? It is not free.`), list, actions)
  return box
}

/** B143: the lanes whose warning is open. It stays in this page only. */
const warned = new Set()

/** B83: the lanes whose question "Stop its task?" is open. It stays in this page only. */
const stopping = new Set()

/**
 * B83: "Stop its task" for a worker on a task. A first click asks once; "Stop it" asks the main chat, which has the
 * worker stop at a safe point (the person, 2026-10-14: "1. A": work committed and pushed, nothing new started). An
 * ask on its way says so. Nothing for the main chat, a free worker or a leftover.
 */
function stopPart(lane, state) {
  if (lane.isMain || lane.isLeftover || lane.task === null || lane.state === 'free' || (state.workers?.main ?? null) === null) return null
  const main = state.workers.mainTitle ?? state.workers.main
  const key = `stop:${lane.name}`
  const ask = state.changeAsks?.stop?.[lane.name] ?? null
  if (ask?.isOpen === true) return el('span', 'stop-asked', `Asked to stop at ${clock(ask.at)}: ${main} has it stop at a safe point.`)
  if (!stopping.has(lane.name)) {
    const button = el('button', 'stop-button', '■ Stop its task')
    button.type = 'button'
    button.dataset.stop = lane.name
    button.disabled = sending.has(key)
    button.title = `Asks ${main} to have it stop at a safe point`
    return button
  }
  const part = el('div', 'stop-confirm')
  const sure = el('button', 'stop-button is-sure', 'Stop it')
  sure.type = 'button'
  sure.dataset.stopSure = lane.name
  const keep = el('button', 'quiet-button', 'Keep going')
  keep.type = 'button'
  keep.dataset.stopKeep = lane.name
  part.append(el('span', '', 'Stop its task? It finishes what runs, saves and shares its work, and starts nothing new.'), sure, keep)
  if (problems.has(key)) part.append(el('p', 'problem', problems.get(key)))
  return part
}

// B83: "Stop its task" opens the question; "Keep going" closes it; "Stop it" asks the main chat.
$('lanes').addEventListener('click', event => {
  const button = event.target.closest('[data-stop], [data-stop-sure], [data-stop-keep]')
  if (button === null || board === null) return
  const { stop = null, stopSure = null, stopKeep = null } = button.dataset
  if (stop !== null || stopKeep !== null) {
    if (stop !== null) stopping.add(stop)
    else stopping.delete(stopKeep)
    return drawLanes(board)
  }
  const main = board.workers?.main ?? null
  if (main === null) return
  stopping.delete(stopSure)
  button.disabled = true
  send({ to: main, command: 'stop', chat: stopSure, sure: true }, `stop:${stopSure}`)
})

/**
 * B438: "Out of sync?" in a worker's menu, "Check now" since the supervisor (spec 2026-10-24). The person, 2026-10-19
 * (I43): "I want an help/alert button, where i believe the board and the worker is out of sync, i press the new button
 * and somebody goes to investigate it and fix it." The board runs its own rules at once (the supervisor) and types
 * "check sync <name>" with what it shows into the main chat (say.mjs `syncWords`); one check at a time. Nothing for the
 * main chat (the board's own button covers it) or a leftover.
 */
function syncPart(lane, state) {
  if (lane.isMain || lane.isLeftover || (state.workers?.main ?? null) === null) return null
  return checkNowButton(lane.name, state, 'Runs the board\'s own checks at once, and a sweep by the supervisor\'s chat about this worker; what they find shows in the supervisor\'s section')
}

/** B438: the same for the whole board, in the Workers panel's head beside "+ Add worker", and in the supervisor's section. */
function boardSyncButton(state) {
  if ((state.workers?.main ?? null) === null) return null
  return checkNowButton('board', state, 'Runs the board\'s own checks at once, and a sweep of the whole board by the supervisor\'s chat; what they find shows in the supervisor\'s section')
}

// syncline:start
/**
 * B438: what became of the newest "Check now" ("Out of sync?" before the supervisor; state.mjs `changeAsks.sync`), in one line, or null: on its
 * way, with the main chat, the main chat's answer (its note "Sync check of <name>: ..."), or that none came.
 */
function syncLineOf(check, main) {
  if (check === null || check === undefined) return null
  if (check.answer !== null && check.answer !== undefined) return { tone: 'answer', text: `Sync check, ${clock(check.answer.at)}: ${check.answer.text}` }
  if (check.state === 'expired' || check.state === 'failed') return { tone: 'problem', text: `The sync check of ${clock(check.at)} did not reach ${main}: open its chat, then ask again.` }
  if (check.isOpen && (check.state === 'waiting' || check.state === 'taken')) return { tone: 'asked', text: `Check now, ${clock(check.at)}: on its way to ${main}.` }
  // The review: no Workers mod took the word; it was put on the clipboard for the person to paste.
  if (check.isOpen && check.state === 'copied') return { tone: 'asked', text: `Check now, ${clock(check.at)}: paste it into ${main}'s chat; then it checks and answers here.` }
  if (check.isOpen) return { tone: 'asked', text: `Check now, ${clock(check.at)}: ${main} checks it and answers here.` }
  return { tone: 'problem', text: `Check now, ${clock(check.at)}: no answer from ${main} yet; you can ask again.` }
}
// syncline:end

// B438: "Check now" (a worker's menu, the panel's head or the supervisor's section; "Out of sync?" until the supervisor)
// runs the board's own checks at once and asks the main chat to check and fix; the section opens for the answer.
$('workers-panel').addEventListener('click', event => {
  const button = event.target.closest('[data-sync]')
  if (button === null || board === null || (board.workers?.main ?? null) === null) return
  const main = board.workers.main
  const chat = button.dataset.sync
  button.disabled = true
  send({ to: main, command: 'sync', chat }, `sync:${chat}`)
  setSupervisorOpen(true)
})

/**
 * Redesign Part 2 (2026-10-25): in the window of a task in a worker's queue. A task the person pinned to it: "Move to"
 * pins it to another worker, "Unpin" puts it back on the list for any worker (the work API's `pin`, as the person). A
 * task the board gave it says so: it is the worker's to take, and goes back on the list if it does not. Nothing for a
 * task without an id.
 */
function pinChangePart(lane, step, state) {
  if (typeof step?.id !== 'string') return null
  const part = el('div', 'step-queue-line')
  if (step.isPinned !== true) {
    part.append(el('span', 'muted', `The board gave it to ${lane.name}: it takes it now, or the board puts it back on the list.`))
    return part
  }
  const key = `pin:${step.id}`
  const others = (state.chats ?? []).filter(one => !one.isMain && !one.isLeftover && one.name !== lane.name)
  part.append(el('span', '', `Pinned to ${lane.name}. `))
  if (others.length > 0) {
    const move = el('button', 'quiet-button', 'Move to')
    move.type = 'button'
    move.dataset.pinMove = step.id
    move.disabled = sending.has(key)
    const pick = el('select')
    pick.dataset.pinTarget = step.id
    pick.setAttribute('aria-label', 'The worker to pin it to')
    for (const one of others) {
      const option = el('option', '', one.name)
      option.value = one.name
      pick.append(option)
    }
    part.append(move, pick)
  }
  const out = el('button', 'quiet-button', 'Unpin')
  out.type = 'button'
  out.dataset.unpinStep = step.id
  out.disabled = sending.has(key)
  out.title = 'Back on the list: the board gives it to the first free worker'
  part.append(out)
  if (problems.has(key)) part.append(el('p', 'problem', problems.get(key)))
  return part
}

/**
 * Redesign Part 2: the person's pin of a task, from its window: "Pin to" (or "Move to") with the worker picked beside
 * it, or "Unpin". The work store changes at once (the work API's `pin`).
 */
function pinClick(button) {
  const id = button.dataset.pinMove ?? button.dataset.pinStep ?? button.dataset.unpinStep
  if (typeof id !== 'string') return
  const scope = button.closest('.step-queue-line, .step-line, .details-foot') ?? document
  const target = button.dataset.unpinStep !== undefined ? '' : [...scope.querySelectorAll('[data-pin-target]')].find(pick => pick.dataset.pinTarget === id)?.value ?? ''
  if (button.dataset.unpinStep === undefined && target === '') return
  button.disabled = true
  return sendWork({ action: 'pin', id, for: target }, `pin:${id}`)
}

// Redesign Part 2: the pin's buttons in a task's window.
$('details').addEventListener('click', event => {
  const button = event.target.closest('[data-pin-move], [data-pin-step], [data-unpin-step]')
  if (button !== null) return pinClick(button)
  // The person, 2026-10-30: the window's "Add to queue" or "Remove", as a Backlog row's.
  const queue = event.target.closest('[data-queue-add], [data-queue-remove]')
  if (queue !== null) queueClick(queue)
})

// B143: "✕ Remove" asks at once for a free worker with nothing queued, else opens (or closes) the warning;
// "Remove anyway" asks; "Keep it" closes the warning.
$('lanes').addEventListener('click', event => {
  const button = event.target.closest('[data-remove], [data-remove-sure], [data-remove-keep]')
  if (button === null || board === null) return
  const { remove = null, removeSure = null, removeKeep = null } = button.dataset
  if (removeKeep !== null) {
    warned.delete(removeKeep)
    return drawLanes(board)
  }
  const name = remove ?? removeSure
  const lane = board.chats.find(one => one.name === name)
  const main = board.workers?.main ?? null
  if (lane === undefined || main === null) return
  if (removeSure === null && removalView(lane, board.workers.mainTitle, board.readAt).reasons.length > 0) {
    if (!warned.delete(name)) warned.add(name)
    return drawLanes(board)
  }
  warned.delete(name)
  button.disabled = true
  send({ to: main, command: 'remove', chat: name, ...(removeSure === null ? {} : { sure: true }) }, `remove:${name}`)
})

// B124: one more worker, or three when there is none: the board asks the main chat, which starts them.
$('workers-panel').addEventListener('click', event => {
  const button = event.target.closest('[data-spawn]')
  if (button === null || board === null || (board.workers?.main ?? null) === null) return
  button.disabled = true
  send({ to: board.workers.main, command: 'spawn' }, 'spawn')
})

// B151: a click on a working worker's lane (also suspended, cut off, or between two turns) opens its task as it was
// given. The queue, the unfolded details, its step line and its remove control keep their own clicks.
$('lanes').addEventListener('click', event => {
  const card = event.target.closest('.lane.is-working, .lane.is-suspended, .lane.is-interrupted')
  if (card === null || board === null || event.target.closest('.queue, .more, .step-line, .remove-button, .remove-warning, .lane-menu, .lane-flag') !== null) return
  openDetails({ lane: card.dataset.lane, task: true })
})

// B100: a click on a lane that waits for the person opens what it waits for, with the form to answer it. The
// queue and the unfolded details keep their own clicks.
$('lanes').addEventListener('click', event => {
  const card = event.target.closest('.lane.is-waiting')
  if (card === null || board === null || event.target.closest('.queue, .more, .remove-button, .remove-warning, .lane-menu, .lane-flag') !== null) return
  const id = needOfLane(board.forYou, card.dataset.lane)
  if (id !== null) openDetails({ need: id })
})

/**
 * Redesign Part 2 (2026-10-25): the board's list of tasks ready for a worker, under the Workers, in its order (fixes,
 * then the focus goal's, then the rest, each by id): each with whom it is kept for (pinned to a worker, or a follow-up
 * of the one that just finished what it waits on), and the refined tasks something still holds, each with why.
 */
function drawReadyList(state) {
  const box = $('ready-list')
  if (box === null) return
  const list = state.readyList ?? null
  box.hidden = list === null || (list.ready.length === 0 && list.held.length === 0)
  if (box.hidden) return fill(box, [])
  const row = (one, why) => {
    const line = el('li', 'ready-row')
    const link = el('a', 'ready-id', one.id)
    link.href = `#details=${one.id}`
    line.append(link, ' ', el('span', 'ready-title', one.title ?? ''), ...(why === null ? [] : [el('span', 'muted', ` · ${why}`)]))
    return line
  }
  const keptWhy = one => [
    // The Backlog tab's blocks: a task the person added to the queue.
    (one.added ?? null) === null ? null : 'added by you',
    one.pinned !== null ? `pinned to ${one.pinned}` : one.keptFor !== null ? `kept for ${one.keptFor}${Number.isFinite(one.keptUntil) ? ` until ${clock(one.keptUntil)}` : ''}`
      : (one.prefers ?? null) !== null ? `to ${one.prefers} first when it is free` : null,
    // The review of 2026-10-25: a give the board's work API refused, and why; a task whose line was held twice.
    (one.refused ?? null) === null ? null : `not given to ${one.refused.chat}: ${one.refused.why}`,
    (one.note ?? null) === null ? null : one.note,
  ].filter(Boolean).join(' · ') || null
  const parts = [el('h3', '', `Ready for a worker (${list.ready.length})`)]
  const ready = el('ol', 'ready-rows')
  ready.append(...list.ready.map(one => row(one, keptWhy(one))))
  if (list.ready.length === 0) ready.append(el('li', 'muted', 'None: every refined task is given or held.'))
  parts.push(ready)
  if (list.held.length > 0) {
    const held = el('details', 'ready-held')
    held.append(el('summary', '', `Refined, but held (${list.held.length})`))
    const rows = el('ul', 'ready-rows')
    rows.append(...list.held.map(one => row(one, one.why)))
    held.append(rows)
    parts.push(held)
  }
  fill(box, parts)
}

/** What has no lane: folders no worker is named for. */
function drawStrips(state) {
  const strips = []
  if (state.otherFolders.length > 0) {
    const strip = el('details', 'strip')
    strip.append(el('summary', '', `Folders no worker is named for (${state.otherFolders.length})`))
    const list = el('ul')
    for (const folder of state.otherFolders) list.append(el('li', '', folderLine(folder, state.readAt)))
    strip.append(list)
    strips.push(strip)
  }
  fill($('folders'), strips)
}

// Today

function drawToday(state) {
  const { from, to, end } = state.day
  const at = time => `${Math.max(0, Math.min(100, ((time - from) / (end - from)) * 100))}%`
  const place = (node, time) => {
    node.style.left = at(time)
    return node
  }
  const bar = (className, start, stop, title) => {
    const node = place(el('div', `span ${className}`), start)
    node.style.width = `calc(${at(Math.min(stop, end))} - ${at(start)})`
    node.title = title
    return node
  }

  $('today-range').textContent = `${clock(from)} to ${clock(end)}`
  const hours = el('div', 'row hours')
  const scale = el('div', 'track')
  const everyHours = (end - from) / HOUR > 9 ? 2 : 1
  for (let time = from; time <= end; time += everyHours * HOUR) scale.append(place(el('span', 'hour', clock(time)), time))
  scale.append(place(el('span', 'now-label', 'Now'), to))
  hours.append(el('span'), scale)

  const rows = state.today.map(lane => {
    const row = el('div', 'row')
    const track = el('div', 'track')
    let before = null
    for (const piece of lane.spans) {
      track.append(bar(`is-${piece.state}`, piece.from, piece.to, `${STATES[piece.state] ?? piece.state}, ${clock(piece.from)} to ${clock(piece.to)}${(piece.task ?? '') === '' ? '' : `: ${piece.task}`}`))
      if ((piece.task ?? '') !== '' && piece.task !== before) {
        const tick = place(el('div', 'tick'), piece.from)
        tick.title = `${clock(piece.from)}: ${piece.task}`
        track.append(tick)
      }
      before = piece.task
    }
    for (const piece of lane.ahead) {
      if (piece.from >= end) break
      track.append(bar(piece.isQueued ? 'is-queued' : 'is-ahead', piece.from, piece.to, `Planned ${clock(piece.from)} to ${clock(piece.to)}: ${piece.title}`))
    }
    track.append(place(el('div', 'now-line'), to))
    const name = el('span', 'row-name', lane.chat)
    name.title = lane.chat
    row.append(name, track)
    return row
  })
  fill($('timeline'), [hours, ...rows])

  const entry = (mark, text) => {
    const item = el('li')
    item.append(mark, text)
    return item
  }
  fill($('legend'), [
    entry(el('span', 'dot is-working'), 'Working'),
    entry(el('span', 'dot is-waiting'), 'Waiting for you'),
    entry(el('span', 'dot is-free'), 'Free'),
    entry(el('span', 'dot is-suspended'), 'Suspended'),
    entry(el('span', 'dot'), 'Not seen'),
    entry(el('span', 'swatch is-ahead'), 'Expected'),
    entry(el('span', 'swatch is-queued'), 'Queued'),
    entry(el('span', 'mark'), 'Task change'),
    entry(el('span', 'mark is-now'), 'Now'),
  ])
}

// For you

/** The chat of that name on the board: a lane, or the advisor. */
const chatNamed = name => (board === null ? null : [...board.chats, board.advisor].find(chat => chat !== null && chat.name === name) ?? null)
/** The main chat as the board reads it (its name, whether it runs), or null without one. */
const mainChatOf = state => (state?.chats ?? []).find(chat => chat.name === (state?.restart?.main ?? null)) ?? null

/**
 * What is said where something waits for a chat that is not running: that the main chat was asked to start it,
 * or a button that asks it to. Nothing for a chat that runs.
 */
function startParts(name) {
  const main = board?.restart?.main ?? null
  if (chatNamed(name)?.isRunning !== false) return []
  // Without a main chat that runs there is nobody to ask: the chat has to be opened by hand.
  if (main === null || name === main) return [el('div', 'alert', `${name} is not running: open its chat, and what is sent to it is typed into it.`)]
  if (chatNamed(main)?.isRunning === false) return [el('div', 'alert', `${name} is not running, and neither is ${main}, which could start it: open one of the two chats.`)]
  const key = `start:${name}`
  const asked = (board.restart.starting ?? []).find(one => one.chat === name) ?? null
  const parts = []
  if (asked !== null && asked.state !== 'expired' && asked.state !== 'failed') {
    parts.push(el('div', 'alert', `${name} is not running. ${main} was asked at ${clock(asked.at)} to start it; this is typed into it as soon as it runs.`))
  } else {
    const ask = el('button', 'choice', `Ask ${main} to start ${name}`)
    ask.type = 'button'
    ask.dataset.start = name
    ask.disabled = sending.has(key)
    parts.push(el('div', 'alert', `${name} is not running, so what is sent to it waits.`), ask)
  }
  if (problems.has(key)) parts.push(el('p', 'problem', problems.get(key)))
  return parts
}

/** Where an answer is: it waits for its chat, was handed to it, or was typed into it. `to` is the chat it is for. */
function sentLine(answer, to = null) {
  const line = el('div', 'sent')
  const what = { approve: 'You approved', reject: 'You rejected', done: 'You marked it done' }[answer.verdict] ?? 'You answered'
  const where = {
    delivered: `typed into its chat${answer.deliveredAt ? ` at ${clock(answer.deliveredAt)}` : ''}`,
    taken: 'handed to its chat, which runs it when it is idle',
    // B212: no Workers mod types it in: the person pastes it.
    copied: 'copied for you to paste into its chat',
  }[answer.state] ?? (answer.isHeld ? 'held until resume' : 'waits for its chat to take it')
  line.append(el('b', '', what), ` at ${clock(answer.at)} · `, where)
  if (answer.text !== '') line.append(el('div', '', answer.text))
  if (answer.state === 'waiting' && to !== null) line.append(...startParts(to))
  return line
}

/** A step from the backlog has no chat that asked: it is headed by its activity and says where the answer goes. */
const isStep = need => need.activity !== undefined

// closed:start
const isLost = answer => answer.state === 'expired' || answer.state === 'failed'
/** Answered here, and the answer is on its way or has arrived: the card no longer waits for the person. */
const isAnswered = need => need.answer !== null && !isLost(need.answer)
/**
 * Closed for the person: ticked in the backlog, or answered here (B307: at once, wherever its answer is; the person,
 * 2026-10-18: "if I answer a question it shouldnt show up anymore"). An answer that did not arrive opens the card
 * again. Closed ones are hidden unless "Show closed" is ticked.
 */
const isClosed = need => need.isClosed === true || isAnswered(need)
/** B307: the cards Needs your attention draws: the open ones, and with "Show closed" the answered and ticked ones too. */
const shownNeeds = (needs, withClosed) => (withClosed ? needs : needs.filter(need => !isClosed(need)))
/** How a card looks: ticked in the backlog (faded), answered here (dashed, its answer line says where it is), or open. */
const needLook = need => (need.isClosed === true ? ' is-closed' : isAnswered(need) ? ' is-answered' : '')
// closed:end
const showsClosed = () => $('needs-closed').checked

// approve:start
/**
 * B110: what the answer box of work to verify says before anything is typed: where an approval goes. A backlog
 * step whose work is merged is ticked by the board itself and nobody is woken (`approval: 'tick'`); one whose
 * branch is still open goes to its worker, who merges. A rejection always goes back to the worker.
 */
function approveHint(need) {
  const [press, usual] = need.kind === 'do' ? ['Done', 'A note (optional)…'] : ['Approve', 'Feedback (optional when you approve)…']
  if (need.approval === 'tick') return `A note, kept under the step (optional). ${press} ticks it on the backlog; nobody is woken.`
  if (need.approval === 'worker') return `${usual} ${press} goes to ${need.from}${need.branch ? `: its branch ${need.branch} is still open` : ''}.`
  return usual
}
// approve:end

// askstand:start
/**
 * The person, 2026-10-26 ("is the advisor currently working on them or not. is it in its queue?"): where a question that
 * is with the partner stands, in plain words, from the server's facts (the state's `withPartner[].stand`: `{ kind, since,
 * toYouAt }`): "in the Advisor's queue since 14:02" or "the Advisor is on it since 14:05", then "comes to you at 14:32".
 * Null without a stand (a server that gives none) or for a kind it does not know: nothing is made up.
 */
function standWords(stand) {
  // `taken`: the Advisor took it and is not at work now (handed on to its helper, cut off, or waiting).
  const at = Number.isFinite(stand?.since) ? ` at ${clock(stand.since)}` : ''
  const where = stand?.kind === 'queued' ? "in the Advisor's queue" : stand?.kind === 'working' ? 'the Advisor is on it'
    : stand?.kind === 'taken' ? `the Advisor took it${at}, idle now` : stand?.kind === 'next' ? 'next to refine' : null
  if (where === null) return null
  return [Number.isFinite(stand.since) && stand.kind !== 'taken' ? `${where} since ${clock(stand.since)}` : where, Number.isFinite(stand.toYouAt) ? `comes to you at ${clock(stand.toYouAt)}` : null]
    .filter(Boolean).join(' · ')
}

/**
 * The window of a question that is with the partner (it is not among the cards waiting for you, so no other window shows
 * it): its code, title and who asked, where it stands, its context, options and advice, and its step; from the state's
 * `withPartner` entry. Plain data.
 */
function partnerAskWindowOf(ask) {
  return {
    code: ask.id, title: ask.title ?? '', fullTitle: ask.title ?? '',
    chips: [{ text: 'With your partner', tone: 'kind' }, ...(ask.from == null ? [] : [{ text: `From: ${ask.from}`, tone: 'to' }])],
    at: ask.at ?? null,
    stand: standWords(ask.stand),
    text: String(ask.text ?? ''), options: ask.options ?? [], advice: ask.advice ?? null,
    step: ask.of == null ? null : [ask.of, ask.ofTitle].filter(Boolean).join(' '),
  }
}

/** The window of a question with the partner (the details dialog): quiet, with where it stands first. */
function drawPartnerAskWindow(box, ask, state) {
  const view = partnerAskWindowOf(ask)
  const showing = JSON.stringify([detailsOf, view])
  if (box.open && detailsShown === showing) return
  detailsShown = showing
  const scroll = box.querySelector('.details-body')?.scrollTop ?? 0
  const parts = []
  if (view.stand !== null) {
    parts.push(section('Where it stands', [
      el('p', 'partner-ask-stand', view.stand),
      el('p', 'muted', 'Your partner answers it first; one it has not answered in 30 minutes comes to you.'),
    ]))
  }
  if (view.text.trim() !== '') parts.push(section('The question', view.text.split('\n').filter(line => line.trim() !== '').map(line => el('p', '', line))))
  if (view.options.length > 0 || view.advice !== null) {
    const list = el('ul', 'partner-ask-options')
    for (const option of view.options) list.append(el('li', '', `${option.label}${option.isRecommended ? ' (recommended)' : ''}`))
    parts.push(section('Options', [...(view.options.length > 0 ? [list] : []), ...(view.advice === null ? [] : [el('p', 'muted', `Advice: ${view.advice}`)])]))
  }
  if (view.step !== null) parts.push(section('Its step', [el('p', '', view.step)]))
  const main = el('div', 'details-main')
  main.append(...parts)
  const body = el('div', 'details-body is-single')
  body.append(main)
  box.classList.remove('is-calm')
  delete box.dataset.calmAt
  keepUnfolded(box, () => fill(box, [detailsHead(view, el('span', 'kind is-input', KINDS.input.sign), state.readAt), body]))
  body.scrollTop = scroll
}
// askstand:end

// partner-answers:start
/**
 * Partner answers (2026-10-19): what an ask's card says of the partner: its answer, its why and the Undo that takes it
 * back (while it may be taken back), or the line of an ask that came to the person by the partner (handed on, or its
 * answer taken back). Null for an ask the partner had nothing to do with.
 */
function partnerAnswerView(need) {
  if (need.answer?.by === 'partner') {
    return {
      text: `Your partner answered: ${need.answer.text}`,
      why: typeof need.answer.why === 'string' && need.answer.why !== '' ? `Why: ${need.answer.why}` : null,
      undo: need.canTakeBack === true ? { id: need.workId, label: 'Undo', title: TAKE_BACK_TITLE } : null,
    }
  }
  if (typeof need.routeNote === 'string' && need.routeNote !== '') return { text: need.routeNote, why: null, undo: null }
  return null
}

/**
 * Partner answers, the review's findings: the small line under Needs your attention for the asks with the partner now
 * (the state's `withPartner`): their count, and when opened one row each. Null when none is.
 */
function withPartnerView(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  // The person, 2026-10-26 ("i just need it clickable so i can see what the question is"): each row opens its ask.
  return { text: `With your partner: ${list.length} question${list.length === 1 ? '' : 's'}`, rows: list.map(one => ({ id: one.id, href: `#details=${one.id}`, text: `${one.id} · ${one.from ?? 'nobody'}: ${one.title}`, stand: standWords(one.stand) })) }
}

/** Partner answers, the review's findings: "Decided for you" (the state's `partnerDecided`): each answer with its Undo. */
function decidedView(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  return { title: 'Decided for you by your partner', count: list.length, rows: list.map(one => ({ ask: one.ask, text: one.line, undo: { id: one.ask, label: 'Undo', title: TAKE_BACK_TITLE } })) }
}

/** B466: the one line it folds to, with its count and a chevron that says whether it is open. */
function decidedToggleText(view, isOpen) {
  return `${view.title} · ${view.count} ${isOpen ? '▾' : '›'}`
}

/** A lane's state in words; the review's findings: a chat that waits on the partner's answer says so, not "for you". */
function laneStateText(lane, states = STATES) {
  if ((lane.waitsForPartner ?? []).length > 0) return `Waiting for your partner (${lane.waitsForPartner.join(', ')})`
  // B728: free by its card but known not to run is "Not running", the same word as everywhere. T13 part 3: an asleep one is Free.
  return states[lane.state === 'free' && lane.isRunning === false && lane.asleep !== true ? 'off' : lane.state]
}
// partner-answers:end

/** Partner answers, the review's findings: the "With your partner" line, a click lists the asks (B408: open as the view says). */
function drawWithPartner(state) {
  const view = withPartnerView(state.withPartner ?? [])
  if (view === null) return null
  const isOpen = state.ui?.withPartnerOpen === true
  const part = el('section', 'information with-partner')
  const toggle = el('button', 'choice with-partner-toggle', `${isOpen ? '▾' : '▸'} ${view.text}`)
  toggle.type = 'button'
  toggle.dataset.withPartner = 'toggle'
  toggle.title = 'Questions your partner answers for you first; one it has not answered in 30 minutes comes to you'
  part.append(toggle)
  if (isOpen) {
    part.append(fill(el('ul', 'with-partner-list'), view.rows.map(row => {
      const link = el('a', 'with-partner-ask', row.text)
      link.href = row.href
      link.title = `Open ${row.id}: the whole question, its options and advice, who asked it`
      // The person, 2026-10-26: where it stands, on its own quiet line under the row.
      return fill(el('li', 'muted'), [link, row.stand === null ? null : el('span', 'with-partner-stand', row.stand)])
    })))
  }
  return part
}

/** Partner answers, the review's findings: "Decided for you by your partner", each line with its Undo, for 7 days. */
function drawDecidedForYou(state) {
  const view = decidedView(state.partnerDecided ?? [])
  if (view === null) return null
  const part = el('section', 'information decided-for-you')
  // B466: folded to one line with its count until opened; the page remembers it (decidedUi).
  const isOpen = state.ui?.decidedOpen === true
  const toggle = el('button', 'decided-toggle', decidedToggleText(view, isOpen))
  toggle.type = 'button'
  toggle.dataset.decided = 'toggle'
  toggle.setAttribute('aria-expanded', String(isOpen))
  toggle.title = 'What your partner answered for you; open it to see each answer and take one back'
  part.append(toggle)
  if (!isOpen) return part
  const list = el('ul', 'focus-decided')
  for (const row of view.rows) {
    const item = el('li', '')
    const undo = el('button', 'focus-undo', row.undo.label)
    undo.type = 'button'
    undo.title = row.undo.title
    undo.dataset.takeBack = row.undo.id
    undo.disabled = sending.has(`work:${row.undo.id}`)
    item.append(linkedEl('span', '', row.text), undo)
    if (problems.has(`work:${row.undo.id}`)) item.append(el('p', 'problem', problems.get(`work:${row.undo.id}`)))
    list.append(item)
  }
  part.append(list)
  return part
}

/** Partner answers: the card's part of the partner, drawn (partnerAnswerView); none for an ask it had nothing to do with. */
function partnerAnswerParts(need) {
  const view = partnerAnswerView(need)
  if (view === null) return []
  const part = el('div', `partner-answer${need.answer?.by === 'partner' ? '' : ' is-routed'}`)
  part.append(el('b', '', view.text))
  if (view.why !== null) part.append(el('div', 'muted', view.why))
  if (view.undo !== null) {
    const undo = el('button', 'choice partner-undo', view.undo.label)
    undo.type = 'button'
    undo.title = view.undo.title
    undo.dataset.takeBack = view.undo.id
    undo.disabled = sending.has(need.id)
    part.append(undo)
  }
  return [part]
}

/**
 * The part of a request that takes the answer: what was sent, or the form its kind needs. `isFolded` keeps the
 * form of a backlog step behind a button until it is opened, so the many steps stay short.
 */
function answerPart(need, state, isFolded, inWindow = false) {
  const answer = need.answer
  // Partner answers (2026-10-19): the partner's answer with its Undo; an ask it handed on, or taken back, says so.
  if (answer?.by === 'partner') return [...partnerAnswerParts(need), ...(problems.has(need.id) ? [el('p', 'problem', problems.get(need.id))] : [])]
  const parts = [...partnerAnswerParts(need)]
  if (answer !== null && !isLost(answer)) return [...parts, sentLine(answer, need.from)]
  if (need.isClosed === true) return [el('p', 'muted', 'Closed: ticked in the backlog.')]
  if (answer !== null) parts.push(el('p', 'problem', `Your answer of ${clock(answer.at)} did not reach the chat. Send it again when the chat can take it.`))
  // The step changed since it was answered: it asks again, and says what was answered before.
  const earlier = need.earlier ?? null
  if (earlier !== null) {
    const what = { approve: 'approved', reject: 'rejected', done: 'marked done' }[earlier.verdict] ?? 'answered'
    parts.push(el('p', 'muted', `Changed since you ${what} it at ${clock(earlier.at)}${earlier.text === '' ? '' : `: "${earlier.text}"`}.`))
  }
  if (need.kind === 'unfiled' || need.kind === 'idle') return [...parts, ...wayButtons(need, inWindow)]
  if (need.kind === 'old-mod') return [...parts, ...oldModParts(need, state)]
  // B533: a quiet worker's card carries Check now; a question of the app's own form is answered in its chat only.
  if (!need.canAnswer) {
    const check = String(need.id).startsWith('quiet:') ? wayButtons(need) : []
    const where = isStep(need) ? 'No main chat is open to take the answer.'
      : String(need.id).startsWith('quiet:') ? `${check.length > 0 ? 'Or look' : 'Look'} at its chat in the Claude app.`
        : 'Answer it in its chat in the Claude app: that form takes its answer only there.'
    return [...parts, ...check, el('p', 'muted', where)]
  }
  if (isFolded && !openForms.has(need.id)) {
    const open = el('button', 'choice', `Answer (goes to ${need.from})`)
    open.type = 'button'
    open.dataset.open = need.id
    return [...parts, open]
  }

  const text = el('textarea')
  text.rows = 2
  text.maxLength = state.maxMessageChars
  text.placeholder = need.kind === 'verify' || need.kind === 'do' ? approveHint(need) : 'Your decision or feedback…'
  text.value = drafts.get(need.id) ?? ''
  text.setAttribute('aria-label', `Answer to ${need.from}`)
  const buttons = el('div', `buttons${need.kind === 'verify' ? ' is-split' : ''}`)
  const button = (label, className, verdict) => {
    const node = el('button', `button ${className}`, label)
    node.type = 'button'
    node.dataset.send = verdict
    node.disabled = sending.has(need.id)
    return node
  }
  if (need.kind === 'verify') {
    buttons.append(button('✓  Approve', 'is-approve', 'approve'), button('✕  Reject', 'is-reject', 'reject'))
    buttons.firstChild.title = approveHint(need)
    buttons.lastChild.title = `Goes back to ${need.from} with your words.`
  }
  else if (need.kind === 'do') {
    buttons.append(button('✓  Done', 'is-approve', 'done'))
    buttons.firstChild.title = approveHint(need)
  }
  else buttons.append(button('Send', '', ''))
  if (need.kind === 'verify') parts.push(buttons, text)
  else parts.push(text, buttons)
  if (problems.has(need.id)) parts.push(el('p', 'problem', problems.get(need.id)))
  return parts
}

/**
 * B301: the way to the chat of a warning that it wrote questions without filing an ask: Talk to Main, the Advisor's
 * chat on its tab, or, for a worker, this card's window with its last answer. B308: also the hint that a worker holds a
 * step but is not working and asked nothing.
 */
/**
 * B541: the card of chats on an older Workers mod: each chat with what it runs and what that costs, the one way to bring
 * them up to date, and Pause all (it asks as the button above the lanes does). While a pause stands, the next step.
 */
function oldModParts(need, state) {
  const chats = el('ul', 'old-mod-chats')
  for (const one of need.chats ?? []) chats.append(el('li', '', `${one.name}: ${one.runs}, ${one.cost}`))
  const steps = el('ol', 'old-mod-steps')
  for (const step of need.steps ?? []) steps.append(el('li', '', step))
  const parts = [chats, el('p', 'old-mod-do', 'Do'), steps]
  const pause = state.pause?.state ?? 'running'
  if (pause !== 'running') parts.push(el('p', 'muted', pause === 'resuming' ? 'Resuming: the chats start anew on the installed mod.' : 'The pause stands: once every chat has stopped, restart the Claude app, then press Resume all.'))
  else if ((state.restart?.main ?? null) === null) parts.push(el('p', 'muted', 'No main chat is open: Pause all needs one.'))
  else {
    const button = el('button', 'button', 'Pause all')
    button.type = 'button'
    button.dataset.oldModPause = need.id
    button.title = 'Asks first, as Pause all above the workers does'
    parts.push(button)
  }
  return parts
}

// cardways:start
/**
 * B533: the ways a card under Needs your attention gives the person to do what it waits for. The person, 2026-10-24:
 * "I want a button to approve/disapprove or a link to where I need to do something. This has neither." An ask the board
 * can answer has its form; the board's hints (B301, B308) carry the way to the chat's words and a button that asks the
 * chat to act, typed into its chat as the person's own line (filed as an instruction, which the chat closes); a chat
 * with no sign of life gets Check now (B438). Only a question asked with the app's own form, and a main chat that is
 * quiet, are the app's: the board can only say so. `canCheck` whether the board has a main chat for Check now.
 */
function cardWays(need, canCheck) {
  if (need.kind === 'old-mod') return [{ way: 'pause' }]
  if (need.kind === 'unfiled' || need.kind === 'idle') {
    const talk = { way: 'talk', to: need.talk === 'main' || need.talk === 'advisor' ? need.talk : need.id }
    talk.label = need.talk === 'main' ? `Open Talk to ${need.from}` : need.talk === 'advisor' ? `Open ${need.from}'s chat` : `Open ${need.from}'s answer`
    return [talk, { way: 'nudge', to: need.from, ...nudgeWords(need) }]
  }
  if (String(need.id).startsWith('quiet:')) return need.isMain !== true && canCheck ? [{ way: 'check', chat: need.from }] : [{ way: 'app' }]
  if (need.canAnswer === true) return [{ way: 'form' }]
  return [{ way: 'app' }]
}

/** B533: the button of a hint and the line it types into the chat, as the person's own words. */
function nudgeWords(need) {
  if (need.kind === 'unfiled') {
    return { label: 'Ask it to file them as asks', text: 'Your last answer asks me things in its "For you" block, but you filed no ask for them: file each with work ask, so I can answer them on the board.' }
  }
  const held = /\bholds ((?:B\d+)(?:(?:, | and )B\d+)*)/.exec(need.title ?? '')?.[1] ?? 'a step'
  return { label: 'Ask it to go on or report', text: `Your turn has ended while you hold ${held}, with nothing running and no ask open: go on with it, file what you need from me with work ask, or report it.` }
}
// cardways:end

/** B533: what a nudge sent from this page is about: the card's id and when, so the button says it once it went. */
const nudged = new Map()

/** B533: the buttons of a card's ways (cardWays) that are no answer form: in its card, and (`inWindow`) in its window. */
function wayButtons(need, inWindow = false) {
  const parts = []
  for (const way of cardWays(need, (board?.workers?.main ?? null) !== null)) {
    if (way.way === 'talk' && !(inWindow && way.to === need.id)) {
      const open = el('button', 'choice', way.label)
      open.type = 'button'
      open.dataset.openTalk = way.to
      parts.push(open)
    } else if (way.way === 'nudge') {
      const at = nudged.get(need.id) ?? null
      const key = `nudge:${need.id}`
      const button = el('button', 'choice', sending.has(key) ? 'Sending…' : at === null ? way.label : `Asked at ${clock(at)}`)
      button.type = 'button'
      button.dataset.nudge = need.id
      button.title = `Types into ${way.to}'s chat as your words: "${way.text}"`
      button.disabled = sending.has(key) || at !== null
      parts.push(button)
      if (problems.has(key)) parts.push(el('p', 'problem', problems.get(key)))
    } else if (way.way === 'check') {
      const key = `sync:${way.chat}`
      const button = el('button', 'choice', sending.has(key) ? 'Asking…' : 'Check now')
      button.type = 'button'
      button.dataset.cardSync = way.chat
      button.title = 'Runs the board\'s own checks at once, and a sweep by the supervisor\'s chat about this worker'
      button.disabled = sending.has(key)
      parts.push(button)
    }
  }
  if (parts.length === 0) return []
  const row = el('div', 'choices')
  row.append(...parts.filter(part => part.tagName === 'BUTTON'))
  return [row, ...parts.filter(part => part.tagName !== 'BUTTON')]
}

/** B533: a hint's nudge: its line typed into the chat as the person's own; the button says when it went. */
async function sendNudge(id) {
  const need = board === null ? undefined : findNeed(id)
  const way = need === undefined ? undefined : cardWays(need, false).find(one => one.way === 'nudge')
  if (way === undefined) return
  await send({ to: way.to, text: way.text }, `nudge:${id}`)
  if (!problems.has(`nudge:${id}`)) nudged.set(id, Date.now())
  redrawNeeds()
  if ($('details').open) {
    detailsShown = null
    drawDetails(board)
  }
}

document.addEventListener('click', event => {
  const nudge = event.target.closest('[data-nudge]')
  if (nudge !== null) {
    event.stopPropagation()
    nudge.disabled = true
    sendNudge(nudge.dataset.nudge)
    return
  }
  // B533: a Focus run's card that waits for the person: its ask's window, else Needs your attention.
  const needs = event.target.closest('[data-open-needs]')
  if (needs !== null) {
    event.stopPropagation()
    // B701: the card of the three failed checks opens its step's window, where the question stands as its options.
    if (needs.dataset.openStep !== undefined && board !== null) return openStepWindow(board, needs.dataset.openStep)
    const ask = board === null || needs.dataset.openNeeds === '' ? undefined : everyNeed(board).find(one => one.workId === needs.dataset.openNeeds)
    return ask === undefined ? openWaiting(null) : openDetails({ need: ask.id })
  }
  // B533: a quiet worker's card: Check now, as in its menu.
  const check = event.target.closest('[data-card-sync]')
  if (check !== null && (board?.workers?.main ?? null) !== null) {
    event.stopPropagation()
    check.disabled = true
    send({ to: board.workers.main, command: 'sync', chat: check.dataset.cardSync }, `sync:${check.dataset.cardSync}`)
    setSupervisorOpen(true)
  }
}, true)

/** The options of a request: a button under its picture for each that has one, plain buttons for the others. */
function optionParts(need) {
  const parts = []
  const choice = option => {
    const button = el('button', `choice${chosen.get(need.id) === option.label ? ' is-chosen' : ''}`, `${option.label}${option.isRecommended ? ' (recommended)' : ''}`)
    button.type = 'button'
    button.dataset.choose = option.label
    return button
  }
  const withPicture = need.options.filter(option => option.picture !== null)
  if (withPicture.length > 0 || need.pictures.length > 0) {
    const grid = el('div', 'pictures')
    for (const option of withPicture) {
      const box = el('div', 'option')
      box.append(picture(option.picture, option.label), choice(option))
      grid.append(box)
    }
    for (const path of need.pictures) grid.append(picture(path))
    parts.push(grid)
  }
  const plain = need.options.filter(option => option.picture === null)
  if (plain.length > 0) {
    const choices = el('div', 'choices')
    for (const option of plain) choices.append(choice(option))
    parts.push(choices)
  }
  return parts
}

/**
 * The game as it is on main, always there on the Overview: what the workers merged is in it. The line under the
 * button says which commit main is on and since when, so it shows whether a result is in it yet.
 */
function drawMainGame(state) {
  const game = state.mainGame ?? null
  if (game === null) return fill($('main-game'), [])
  const row = el('div', 'game')
  row.dataset.gameOf = 'main'
  const isStarting = starting.has('main')
  const run = el('button', 'run')
  run.type = 'button'
  run.dataset.game = 'start'
  run.disabled = isStarting
  run.title = 'Starts the game as it is on main, on a port of its own, and opens it. It stops by itself after you close its tab.'
  run.append(icon('open'), isStarting ? 'Starting the game…' : 'Run game')
  row.append(run)
  if (game.url !== null) {
    const stop = el('button', 'choice', 'Stop')
    stop.type = 'button'
    stop.dataset.game = 'stop'
    row.append(stop)
  }
  // B307: which commit main is on, and since when, on hovering Run game; a running game keeps its link under it.
  const facts = [state.baseBranch, game.commit?.hash ?? null, game.lastCommitAt === null ? null : `last change ${ago(game.lastCommitAt, state.readAt)}`].filter(Boolean)
  run.title = [run.title, facts.join(' · '), game.commit?.subject ?? null].filter(Boolean).join('\n')
  let note = null
  if (game.url !== null) {
    note = el('small', 'run-note', 'running at ')
    const link = el('a', '', game.url.replace(/^http:\/\//, '').replace(/\/$/, ''))
    link.href = game.url
    link.target = '_blank'
    link.rel = 'noreferrer noopener'
    note.append(link)
  }
  const problem = problems.get('game:main')
  fill($('main-game'), [row, note, problem === undefined ? null : el('p', 'problem', problem)].filter(part => part !== null))
}

/**
 * The game to look at for a request: one button that starts the branch's game when it is not running and opens
 * it in a new tab. A game the board started ends by itself after its tab is closed.
 */
function gameParts(need) {
  const game = need.game ?? null
  if (game === null) {
    // An ask from before the board could start a game gives the address itself.
    if (need.run === null || need.run.url === null) return []
    const note = need.run.entry === null ? [] : [el('small', 'run-note', `If it does not open, start "${need.run.entry}" first.`)]
    return [runLink(need.run), ...note]
  }
  if (game.path === null) return [el('small', 'run-note', `The branch ${game.branch} is in no working folder now, so the board cannot start its game.`)]

  const row = el('div', 'game')
  row.dataset.gameOf = need.id
  const isStarting = starting.has(need.id)
  const open = el('button', 'run')
  open.type = 'button'
  open.dataset.game = 'start'
  open.disabled = isStarting
  open.append(icon('open'), isStarting ? 'Starting the game…' : `Open the game on ${game.branch}`)
  row.append(open)
  if (game.url !== null) {
    const stop = el('button', 'choice', 'Stop')
    stop.type = 'button'
    stop.dataset.game = 'stop'
    stop.title = 'Stop this game now'
    row.append(stop)
  }
  const parts = [row]
  if (game.url === null) {
    parts.push(el('small', 'run-note', `Starts the game from the folder ${game.folder} on a port of its own. It stops by itself after you close its tab.`))
  } else {
    // The address as a plain link too, for when the browser did not let the tab open.
    const note = el('small', 'run-note', `Running since ${clock(game.since)} at `)
    const link = el('a', '', game.url.replace(/^http:\/\//, '').replace(/\/$/, ''))
    link.href = game.url
    link.target = '_blank'
    link.rel = 'noreferrer noopener'
    note.append(link, '. It stops by itself after you close its tab.')
    parts.push(note)
  }
  const problem = problems.get(`game:${need.id}`)
  if (problem !== undefined) parts.push(el('p', 'problem', problem))
  return parts
}

function runLink(run) {
  const link = el('a', 'run')
  link.href = run.url
  link.target = '_blank'
  link.rel = 'noreferrer noopener'
  link.append(icon('open'), 'Open branch in local build')
  return link
}

function listBox(title, lines) {
  const box = el('div', 'box')
  const list = el('ul')
  for (const line of lines) list.append(el('li', '', line))
  box.append(el('b', '', title), list)
  return box
}

// storeasks:start
/** B299: what an ask of the work store says of itself (`Q<n>`): its own kind, what it blocks, its play link. */
const STORE_ASKS = { decide: 'Decide', look: 'Look', provide: 'Provide', do: 'Do' }
function storeAskParts(need, isRunning = null) {
  if (need.workId === undefined) return null
  const blocks = need.blocks.length > 0
    ? `blocks ${need.blocks.map(one => `${one.step}${one.owner === null ? '' : ` · ${one.owner} waits`}`).join(', ')}`
    : need.of === null ? null : `on ${need.of}${need.ofTitle === null ? '' : ` ${need.ofTitle}`}`
  return {
    id: need.workId,
    tag: `${STORE_ASKS[need.asks] ?? 'Decide'}${need.isRefine ? ' · refine' : ''}`,
    blocks,
    play: need.play === null ? null : `/#play=${need.play}`,
    // Review of B299: a question of the app's form whose chat does not run (not seen for a while) can be withdrawn here.
    withdraw: need.isForm === true && isRunning === false && (need.answer ?? null) === null,
  }
}

/** B299: the Information list: notes and reports, unread first, one line each; read ones fade. */
function informationRows(list) {
  return (list ?? []).map(one => ({
    // B307: who sent it and the step it is about, for its one line.
    id: one.id, text: one.text, isRead: one.isRead, from: one.from ?? null, about: one.about ?? null,
    head: `${one.from ?? 'the board'}${one.to === 'main' ? ' → Main' : ''}${one.about === null ? '' : ` · ${one.about}`}`,
    at: one.since,
  }))
}
// storeasks:end

/** B299: the parts of a store ask's card under its head: what it blocks, its play link (one of the app's form says
 * "Answer in its chat" in its answer part). */
function storeAskLines(need, state) {
  const parts = storeAskParts(need, (state.chats ?? []).find(chat => chat.name === need.from)?.isRunning ?? (state.advisor?.name === need.from ? state.advisor.isRunning ?? null : null))
  if (parts === null) return []
  const out = []
  if (parts.withdraw) {
    const button = el('button', 'choice', sending.has(need.id) ? 'Withdrawing…' : 'Withdraw')
    button.type = 'button'
    button.dataset.withdraw = need.workId
    button.title = `${need.from} does not run, and only its chat can take this answer: withdraw the question.`
    button.disabled = sending.has(need.id)
    out.push(button)
  }
  if (parts.blocks !== null) out.push(el('p', `ask-blocks${need.blocking ? ' is-blocking' : ''}`, parts.blocks))
  if (parts.play !== null) {
    const link = el('a', 'run')
    link.href = parts.play
    link.target = '_blank'
    link.rel = 'noreferrer noopener'
    link.append(icon('open'), 'Play it')
    out.push(link)
  }
  return out
}

// calmpanel:start
/** Calm panel: a count with its word, in the singular for one. */
const countOf = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Calm panel (2026-10-19): what the log holds that is new: the notes and reports not read yet, and the instructions not
 * closed (missed ones among them). Never part of the count of Needs your attention.
 */
function logCounts(information, instructions) {
  return {
    reports: (information ?? []).filter(one => one.isRead !== true).length,
    instructions: (instructions ?? []).filter(one => (one.closedAs ?? null) === null).length,
  }
}

/** The log's one quiet line: "Log: 44 reports · 3 instructions", a part with none left out; "nothing new" for none. */
function logLineText({ reports, instructions }) {
  const parts = [reports > 0 ? countOf(reports, 'report') : null, instructions > 0 ? countOf(instructions, 'instruction') : null].filter(part => part !== null)
  return `Log: ${parts.length === 0 ? 'nothing new' : parts.join(' · ')}`
}

/**
 * An instruction a chat missed (it ended a turn with the person's words open: red in the log) is something for the
 * person: one line each under Needs your attention, "Main missed your words of 14:02: open the log". `clockOf` says a
 * time as the page does.
 */
function missedLines(instructions, clockOf) {
  return (instructions ?? []).filter(one => one.isMissed === true && (one.closedAs ?? null) === null)
    .map(one => ({ id: one.id, text: `${one.chat} missed your words${typeof one.since === 'number' ? ` of ${clockOf(one.since)}` : ''}: open the log` }))
}

/**
 * The cards of Needs your attention: the asks of the chats and of the store, then the asks the backlog held (migrated
 * with their B ids), open ones as cards like every other and ticked ones closed, shown with "Show closed".
 */
const panelNeeds = state => [...(state.forYou ?? []), ...(state.backlogForYou ?? []), ...(state.backlogClosed ?? [])]
// calmpanel:end

/** B307: the notes opened to their whole words, by id. */
const openInfos = new Set()

/** Calm panel: whether the log is open: folded unless the person opened it in this browser. */
let isLogOpen = false
try {
  isLogOpen = localStorage.getItem('log-open') === 'yes'
} catch {
  // Without storage the log is folded after each reload.
}

/**
 * B299: the part "Information" under Needs your attention: what the chats told the person; "Read" puts it away. B307:
 * in a box of its own under a handle that sets its height, each note one line (the step it is about, who sent it, its
 * words cut at the edge); a click opens the whole note with its Read button. "Mark all read" reads every new one.
 * Calm panel (2026-10-19): that box is the log, folded behind one quiet line at the bottom of the panel ("Log: 44
 * reports · 3 instructions"); open, it holds Open instructions and Information as they were.
 */
function drawInformation(state) {
  const box = $('information')
  const line = $('log-line')
  line.textContent = logLineText(logCounts(state.information, state.instructions))
  line.setAttribute('aria-expanded', String(isLogOpen))
  line.title = isLogOpen ? 'Fold the log' : 'Open the log: your instructions to the chats with what came of them, and their notes and reports'
  // A note that is no longer there is no longer open.
  for (const id of openInfos) if (!(state.information ?? []).some(one => one.id === id)) openInfos.delete(id)
  box.hidden = !isLogOpen
  $('info-resizer').hidden = !isLogOpen
  if (!isLogOpen) return fill(box, [])
  const rows = informationRows(state.information).filter(row => !row.isRead || showsClosed())
  const top = box.scrollTop
  const focused = document.activeElement?.closest?.('#information [data-info-open]')?.dataset.infoOpen ?? null
  const unread = informationRows(state.information).filter(row => !row.isRead)
  // All read, however: what held "Mark all read" back is said no more.
  if (unread.length === 0) problems.delete('read:all')
  const hasInstructions = instructionGroups(state.instructions ?? []).length > 0
  // Information as it was, when there is any note at all.
  const information = (state.information ?? []).length === 0 ? null : el('section', 'information')
  const part = information ?? el('section', 'information')
  const head = el('h3', '', 'Information')
  head.append(el('small', 'muted', unread.length === 0 ? 'all read' : `${unread.length} new`))
  if (unread.length > 0) {
    const all = el('button', 'choice info-read-all', sending.has('read:all') ? 'Reading…' : 'Mark all read')
    all.type = 'button'
    all.dataset.readAll = ''
    all.disabled = sending.has('read:all')
    all.title = `Marks the ${unread.length} new notes read; they stay under "Show closed" for a day`
    head.append(all)
  }
  part.append(head)
  if (problems.has('read:all')) part.append(el('p', 'problem', problems.get('read:all')))
  for (const row of rows) {
    const isOpen = openInfos.has(row.id)
    const line = el('div', `info${row.isRead ? ' is-read' : ''}${isOpen ? ' is-open' : ''}`)
    line.dataset.info = row.id
    const short = infoLine(row)
    const toggle = el('button', 'info-line')
    toggle.type = 'button'
    toggle.dataset.infoOpen = row.id
    toggle.setAttribute('aria-expanded', String(isOpen))
    toggle.title = isOpen ? 'Fold the note' : 'Show the whole note'
    if (short.about !== null) toggle.append(el('span', 'info-about', short.about), ' ')
    if (short.from !== null) toggle.append(el('span', 'info-from', `${short.from}:`), ' ')
    toggle.append(el('span', 'info-words', short.words))
    line.append(toggle)
    if (isOpen) {
      const whole = el('div', 'info-whole')
      const words = el('p', '')
      words.append(el('b', '', row.head), ' ', row.text)
      whole.append(words, el('small', 'muted', row.at === null ? row.id : `${row.id} · ${ago(row.at, state.readAt)}`))
      const target = infoTarget(row.about)
      if (target !== null) {
        const open = el('a', 'info-open-item', target.text)
        open.href = target.href
        whole.append(' ', open)
      }
      if (!row.isRead) {
        const read = el('button', 'choice', sending.has(`read:${row.id}`) ? 'Reading…' : 'Read')
        read.type = 'button'
        read.dataset.read = row.id
        read.disabled = sending.has(`read:${row.id}`) || sending.has('read:all')
        whole.append(read)
      }
      line.append(whole)
    }
    const problem = problems.get(`read:${row.id}`)
    if (problem !== undefined) line.append(el('p', 'problem', problem))
    part.append(line)
  }
  // All read and hidden: one line, no height to drag.
  if (rows.length === 0) part.append(el('p', 'empty', 'All read: "Show closed" shows them.'))
  // Nothing in the log at all: one line says so.
  const empty = information === null && !hasInstructions ? el('p', 'empty', 'Nothing in the log yet.') : null
  // A short log (no note shown, no instruction) has no height to drag.
  const isShort = rows.length === 0 && !hasInstructions
  box.classList.toggle('is-all-read', isShort)
  $('info-resizer').hidden = isShort
  fill(box, [drawInstructions(state), information, empty])
  box.scrollTop = top
  if (focused !== null) [...box.querySelectorAll('[data-info-open]')].find(node => node.dataset.infoOpen === focused)?.focus()
}

/** B307: "Mark all read": each new note read in turn; the first that is refused stops it and says why. */
async function readAllInformation(ids) {
  sending.add('read:all')
  problems.delete('read:all')
  if (board !== null) drawInformation(board)
  for (const id of ids) {
    let problem = null
    try {
      const answer = await fetch('/api/work', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify({ action: 'read', id }) })
      if (!answer.ok) problem = (await answer.text()).trim() || `refused (${answer.status})`
    } catch {
      problem = 'the board\'s server does not answer'
    }
    if (problem !== null) {
      problems.set('read:all', `Not all read: ${id} ${problem}`)
      break
    }
  }
  sending.delete('read:all')
  await read()
}

$('information').addEventListener('click', event => {
  if (board === null) return
  // B298: the main chat's name over its instructions opens the talk with it (in the log since the calm panel).
  const side = event.target.closest('.instructions [data-show-side]')
  if (side !== null) return showSide(side.dataset.showSide)
  const read = event.target.closest('[data-read]')
  if (read !== null) return sendWork({ action: 'read', id: read.dataset.read }, `read:${read.dataset.read}`)
  if (event.target.closest('[data-read-all]') !== null && !sending.has('read:all')) {
    return readAllInformation(informationRows(board.information).filter(row => !row.isRead).map(row => row.id))
  }
  const toggle = event.target.closest('[data-info-open]')
  if (toggle === null) return
  if (!openInfos.delete(toggle.dataset.infoOpen)) openInfos.add(toggle.dataset.infoOpen)
  drawInformation(board)
})

/** Calm panel: the log opened or folded by the person, and kept so in this browser. */
function setLogOpen(open) {
  isLogOpen = open
  try {
    localStorage.setItem('log-open', isLogOpen ? 'yes' : 'no')
  } catch {
    // Not kept; it still holds until the page is closed.
  }
  if (board !== null) drawInformation(board)
}
$('log-line').addEventListener('click', () => setLogOpen(!isLogOpen))

/**
 * Calm panel: a missed instruction's line opens the log at that instruction; in Simple, which leaves the log out, it
 * goes to Details first, as the person's own click there would.
 */
function openLog(instruction = null) {
  if ($('view-overview').dataset.mode === 'simple') document.querySelector('#overview-mode [data-overview-mode="details"]')?.click()
  setLogOpen(true)
  const row = instruction === null ? undefined : [...$('information').querySelectorAll('[data-instruction]')].find(node => node.dataset.instruction === instruction)
  ;(row ?? $('log-line')).scrollIntoView({ block: 'nearest' })
}

/**
 * B258: the part "Answers to your asks" under Needs your attention: each ask on the goal map the Advisor answered and
 * the person has not read. "Read it" opens the answer under its goal; "Done" marks it read.
 */
function drawGoalAskNeeds(state) {
  const needs = state.goalAskNeeds ?? []
  if (needs.length === 0) return null
  const part = el('section', 'information goal-ask-needs')
  const head = el('h3', '', 'Answers to your asks')
  head.append(el('small', 'muted', `${needs.length} to read`))
  part.append(head)
  for (const need of needs) {
    const line = el('div', 'info')
    const words = el('p', '')
    words.append(el('b', '', need.title), ' ', `${need.id}: ${need.question}`)
    const open = el('button', 'choice', 'Read it →')
    open.type = 'button'
    Object.assign(open.dataset, { goalAskOpen: need.goal, ask: need.id })
    const done = el('button', 'choice', 'Done')
    done.type = 'button'
    done.title = 'Mark the answer read; it stays under the goal'
    Object.assign(done.dataset, { goalAskDone: need.goal, ask: need.id })
    done.disabled = !canEditGoals(state)
    line.append(words, el('small', 'muted', `answered ${need.at}`), open, done)
    part.append(line)
  }
  return part
}

// refinelines:start
/**
 * B287: a refine question of the work store (an ask made by the Advisor's refine, on a step): it has no card of its
 * own under Needs your attention, answered or not; its step's line says it (the person, on G17: "show refine
 * questions under Needs your attention, one line per step").
 */
const isRefineQuestion = need => need.isRefine === true && (need.of ?? null) !== null

/**
 * B287: the open refine questions as one line per step, the step that waits longest first: `{ step, title, count, at,
 * ids }`, `at` its oldest question's time. `needs` are the cards of Needs your attention.
 */
function refineLines(needs) {
  const lines = new Map()
  for (const need of needs) {
    if (!isRefineQuestion(need) || need.isClosed === true || (need.answer ?? null) !== null) continue
    const line = lines.get(need.of) ?? { step: need.of, title: need.ofTitle ?? '', count: 0, at: need.at, ids: [] }
    line.count += 1
    line.ids.push(need.workId)
    if (need.at !== null && (line.at === null || need.at < line.at)) line.at = need.at
    lines.set(need.of, line)
  }
  return [...lines.values()].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.step.localeCompare(b.step, 'en', { numeric: true }))
}

/** B287: the part "Refine questions" under Needs your attention: a line per step, opening its window to answer them. */
function drawRefineNeeds(state) {
  const lines = refineLines(state.forYou)
  if (lines.length === 0) return null
  const part = el('section', 'information refine-needs')
  const head = el('h3', '', 'Refine questions')
  head.append(el('small', 'muted', `${lines.length} task${lines.length === 1 ? '' : 's'} wait${lines.length === 1 ? 's' : ''} for your answers`))
  part.append(head)
  for (const line of lines) {
    const row = el('div', 'info')
    const words = el('p', '')
    words.append(el('b', '', line.step), ' ', line.title === '' ? '' : `${line.title}: `, `${line.count} question${line.count === 1 ? '' : 's'}`)
    const open = el('button', 'choice', 'Answer them →')
    open.type = 'button'
    open.dataset.refineOpen = line.step
    // Where the step is not on the Backlog tab to open, its first question's own window opens.
    open.dataset.refineFirst = line.ids[0]
    open.title = 'Opens the step\'s window: answer each question there with Yes or No, or take the advice'
    row.append(words, el('small', 'muted', line.at === null ? 'the Advisor asks' : `asked ${ago(line.at, state.readAt)}`), open)
    part.append(row)
  }
  return part
}
// refinelines:end

// B287: a refine line opens its step's window, where its questions are answered.
$('needs').addEventListener('click', event => {
  const button = event.target.closest('[data-refine-open]')
  if (button === null) return
  const step = (board?.backlog ?? []).flatMap(activity => activity.steps).find(one => one.id === button.dataset.refineOpen)
  // A finished step's window answers no refine question: then, as for a step not on the tab, the question's own.
  if (step !== undefined && step.status !== 'done') openDetails({ step: step.key })
  else openDetails({ need: `work:${button.dataset.refineFirst}` })
})

/** B259: the part "Brainstorms" under Needs your attention: a question of the Advisor's waiting, a proposal to tick. */
function drawBrainstormNeeds(state) {
  const needs = state.brainstormNeeds ?? []
  if (needs.length === 0) return null
  const part = el('section', 'information goal-ask-needs')
  const head = el('h3', '', 'Brainstorms')
  head.append(el('small', 'muted', `${needs.length} wait${needs.length === 1 ? 's' : ''} for you`))
  part.append(head)
  for (const need of needs) {
    const line = el('div', 'info')
    const words = el('p', '')
    words.append(el('b', '', need.title), ' ', need.text)
    const open = el('button', 'choice', need.what === 'question' ? 'Answer it →' : 'Tick it →')
    open.type = 'button'
    open.dataset.brainstormNeed = need.path
    line.append(words, el('small', 'muted', need.what === 'question' ? 'the Advisor asks' : 'the Advisor proposes'), open)
    part.append(line)
  }
  return part
}

function drawNeed(need, state) {
  const kind = KINDS[need.kind]
  const card = el('article', `need is-${need.kind}${isStep(need) ? ' is-step' : ''}${needLook(need)}`)
  card.dataset.id = need.id
  // The head of a card opens its details.
  const head = el('div', 'need-head')
  head.dataset.details = need.id
  head.title = 'Show the details'
  const top = el('header', 'need-top')
  if (isStep(need)) top.append(el('span', 'kind', kind.sign), need.step === null ? '' : el('b', '', need.step), el('span', 'tag', ASKS[need.asks] ?? 'Not sorted'), el('small', 'muted', need.activity))
  else top.append(el('span', 'kind', kind.sign), el('b', '', need.from ?? 'the board'), el('span', 'tag', storeAskParts(need)?.tag ?? kind.tag), since(need.at, state.readAt))
  // B426: its ids and the pages it names are links in the title too
  head.append(top, linkedEl('h4', '', need.title))
  card.append(head, ...storeAskLines(need, state))
  // B397: its ids and the pages it names are links, and an ask it points to stands inline.
  if (need.text !== '') {
    const words = el('p')
    words.append(...linkedWords(need.text, state))
    card.append(words)
  }
  if (!isStep(need)) card.append(...pointedAskBox(need, state))
  card.append(...optionParts(need))

  card.append(...gameParts(need))
  if (need.checks.length > 0) card.append(listBox('Key points to check', need.checks))
  if (need.tried.length > 0) card.append(listBox('Already tried', need.tried))
  card.append(...answerPart(need, state, isStep(need)))
  return card
}

// B360: kept between these two marks so a test can run it without the page.
// recaps:start
/**
 * B360: the recaps Needs your attention shows, each as a card of its own: none while they gather in the daily note
 * (`recapsShow` "daily"); else the open ones, and with "Show closed" those closed within the last day too.
 */
const shownRecaps = (state, withClosed) => (state.recapsShow === 'daily' ? [] : (state.recaps ?? []).filter(recap => withClosed || !recap.isClosed))
/** B360: the open recaps the daily note gathers, while they gather there. */
const gatheredRecaps = state => (state.recapsShow === 'daily' ? (state.recaps ?? []).filter(recap => !recap.isClosed) : [])
/**
 * B361: the asks the daily note gathers while "Bother me" is once a day: the store's asks that hold up no chat (a
 * blocking one always reaches the person at once), not a refine question (its step's line says it), not one of the
 * app's form, not closed. An answered one stays there until it leaves the list.
 */
const gatheredAsks = state => (state.recapsShow === 'daily'
  ? (state.forYou ?? []).filter(need => typeof need.workId === 'string' && need.blocking !== true && need.isRefine !== true && need.isForm !== true && need.isClosed !== true)
  : [])
/** B360: a time left, as a card says it: hours from an hour on, else minutes. */
const timeLeft = ms => (ms >= HOUR ? `${Math.round(ms / HOUR)} h` : `${Math.max(1, Math.round(ms / MIN))} min`)
/** B360: the person's words in quotes, without a full stop of their own before the sentence goes on. */
const quoted = words => `"${String(words).trim().replace(/[.!?]+$/, '')}"`
/** B360: what a recap says under its picture: when it approves itself, or what became of it. */
function recapStatus(recap, now) {
  if (recap.state === 'approved') return 'Approved by itself: its 24 hours passed.'
  if (recap.state === 'seen') return 'Seen by you: approved.'
  if (recap.state === 'overturned') return `Overturned: ${quoted(recap.words)}. ${recap.isGoal ? 'The goal is open again; your partner makes its next steps.' : 'Your partner makes the fix.'}`
  if (recap.state === 'feedback') return `Your feedback went to your partner: ${quoted(recap.words)}.`
  const left = recap.approvesAt === null ? 0 : recap.approvesAt - now
  // B591: as the agreed card (Q352) says it; its two buttons say the rest.
  return left <= 0 ? 'Approves itself now.' : `Approves itself in ${timeLeft(left)}.`
}
/** B360, B390: what the person's click on a recap's button sends: Overturn needs their words, OK, seen sends none. */
function recapSend(recap, verdict, text) {
  if (verdict === 'seen') return { ok: true, body: { action: 'seen', id: recap.workId } }
  if (verdict !== 'overturn') return { ok: false, why: 'Overturn or OK, seen.' }
  if (text === '') return { ok: false, why: 'Say what is wrong: your partner makes the fix from your words.' }
  return { ok: true, body: { action: verdict, id: recap.workId, text } }
}
// recaps:end

// B390: kept between these two marks so a test can run it without the page.
// recapCard:start
/**
 * B360: a recap of finished work: marked Information (it asks nothing and blocks nothing), the step or goal, what the
 * person gets, the evidence picture and when it approves itself. B390 (the person, I28: "red is overturn with text
 * feedback, blue is ok, mark as seen no text needed"): at rest two buttons, Overturn (red) and OK, seen (blue); Overturn
 * opens a box for their words, sent with "Overturn with these words" or closed again with Cancel.
 */
function drawRecap(recap, state) {
  const card = el('article', `need is-recap${recap.isClosed ? ' is-closed' : ''}`)
  card.dataset.id = recap.id
  const top = el('header', 'need-top')
  top.append(el('span', 'kind', 'ℹ'), el('b', '', recap.about ?? ''), el('span', 'tag', 'Information'), since(recap.at, state.readAt))
  card.append(top, el('h4', '', recap.heading ?? recap.title))
  // B569 (I92): bold Context and Change in plain words, the Before | After picture, one quiet Checked line.
  const words = el('div', 'recap-words')
  for (const [label, said] of [['Context', recap.context], ['Change', recap.change]]) {
    if (!said) continue
    const part = el('p')
    part.append(el('b', '', `${label}:`), ` ${said}`)
    words.append(part)
  }
  if (words.children.length > 0) card.append(words)
  if (!/^none\b/i.test(recap.evidence)) {
    const pictures = el('div', 'pictures')
    pictures.append(picture(recap.evidence, recap.heading ?? recap.title))
    card.append(pictures)
  }
  if (recap.checked) {
    const checked = el('a', 'muted recap-checked', `Checked: ${recap.checked} points pass`)
    if (recap.checkedLink) checked.href = recap.checkedLink
    checked.title = 'Opens its points'
    card.append(checked)
  }
  card.append(el('p', 'muted recap-status', recapStatus(recap, state.readAt)))
  if (recap.isClosed) return card
  const button = (label, className, title) => {
    const node = el('button', `button ${className}`, label)
    node.type = 'button'
    node.disabled = sending.has(recap.id)
    node.title = title
    return node
  }
  const overturns = recap.isGoal ? 'Opens the goal again; your partner makes its next steps from your words.' : 'Your partner makes a fix step from your words.'
  if (!openForms.has(recap.id)) {
    // At rest: Overturn opens the box (the answer forms' data-open); OK, seen approves it now, with no words.
    const overturn = button('↺  Overturn', 'is-reject', overturns)
    overturn.dataset.open = recap.id
    const seen = button('✓  OK, seen', 'is-seen', 'Approves it now: the work stays done, and nothing goes to your partner.')
    seen.dataset.send = 'seen'
    const buttons = el('div', 'buttons is-split')
    buttons.append(overturn, seen)
    card.append(buttons)
  } else {
    const text = el('textarea')
    text.rows = 2
    text.maxLength = state.maxMessageChars
    text.placeholder = recap.isGoal ? 'What is missing: the goal opens again, and your partner makes its next steps from your words…' : 'What is wrong: your partner makes a fix step from your words…'
    text.value = drafts.get(recap.id) ?? ''
    text.setAttribute('aria-label', `Your words on ${recap.about ?? 'this recap'}`)
    const send = button('↺  Overturn with these words', 'is-reject', overturns)
    send.dataset.send = 'overturn'
    const cancel = button('Cancel', 'is-quiet', 'Closes the box; the recap stays as it is.')
    cancel.dataset.cancel = recap.id
    const buttons = el('div', 'buttons recap-words')
    buttons.append(send, cancel)
    card.append(text, buttons)
  }
  if (problems.has(recap.id)) card.append(el('p', 'problem', problems.get(recap.id)))
  return card
}
// recapCard:end

// B85 (the order of the cards): kept between these two marks so a test can run it without the page.
// order:start
/**
 * How new a card is: when it was filed. A step from the backlog has no date, so the number of its id says it: the
 * highest id is the newest.
 */
const newness = need => need.at ?? (Number(String(need.step ?? '').replace(/\D/g, '')) || 0)

/**
 * The cards in the order chosen in "For you": newest first, oldest first, or by the worker the answer goes to
 * (newest first within a worker). For the requests of the chats and for the steps from the backlog alike.
 */
function ordered(needs) {
  const order = $('needs-order').value
  const list = [...needs].sort((a, b) => newness(b) - newness(a))
  if (order === 'oldest') list.reverse()
  if (order === 'worker') list.sort((a, b) => (a.from ?? '').localeCompare(b.from ?? '') || newness(b) - newness(a))
  // B300: a blocking ask that waited longer than the board's ask time stands first, whatever the order.
  return list.sort((a, b) => Number(b.isOld === true) - Number(a.isOld === true))
}
// order:end

/** Puts the cursor back into the answer it was in, after a redraw of `box`. The words are kept in `drafts`. */
function refocus(box, id) {
  if (id === null) return
  const again = [...box.querySelectorAll('.need')].find(card => card.dataset.id === id)?.querySelector('textarea')
  if (!again) return
  again.focus()
  again.setSelectionRange(again.value.length, again.value.length)
}

const focusedNeed = box => (box.contains(document.activeElement) ? document.activeElement.closest('.need')?.dataset.id ?? null : null)

// instructions:start
/**
 * B298: the person's words filed as instructions, per chat, for the part "Open instructions" under Needs your
 * attention: each chat's missed ones first (a turn of the chat ended with them open: red), then the open ones, then the
 * ones closed lately (grey, with what came of them). `list` is the state's `instructions`; empty without the store.
 */
function instructionGroups(list) {
  const groups = new Map()
  for (const one of list ?? []) {
    const tone = one.closedAs !== null && one.closedAs !== undefined ? 'closed' : one.isMissed ? 'missed' : 'open'
    const note = tone === 'closed' ? `→ ${one.closedAs}` : tone === 'missed' ? `missed ${one.turns} turn${one.turns === 1 ? '' : 's'}` : 'new'
    const row = { id: one.id, text: one.text, tone, note, at: one.since ?? null, via: one.via ?? 'chat' }
    if (!groups.has(one.chat)) groups.set(one.chat, [])
    groups.get(one.chat).push(row)
  }
  const rank = { missed: 0, open: 1, closed: 2 }
  return [...groups].map(([chat, rows]) => ({
    chat, rows: rows.sort((a, b) => rank[a.tone] - rank[b.tone]), missed: rows.filter(row => row.tone === 'missed').length, open: rows.filter(row => row.tone !== 'closed').length,
  })).sort((a, b) => b.missed - a.missed || b.open - a.open || a.chat.localeCompare(b.chat))
}
// instructions:end

/**
 * B298: the part "Open instructions": the person's words per chat; a click on the main chat's opens the talk with it.
 * Calm panel: in the log, above Information; each line names its instruction, so a missed line opens the log at it.
 */
function drawInstructions(state) {
  const groups = instructionGroups(state.instructions ?? [])
  if (groups.length === 0) return null
  const open = groups.reduce((sum, group) => sum + group.open, 0)
  const part = el('section', 'instructions')
  const head = el('h3', '', 'Open instructions')
  head.append(el('small', 'muted', open === 0 ? 'all closed' : `${open} open`))
  part.append(head)
  for (const group of groups) {
    const box = el('div', 'instruction-chat')
    const name = el('b', '', group.chat)
    if (group.chat === state.restart?.main) {
      name.dataset.showSide = 'main'
      name.title = 'Open the talk with the main chat'
      name.classList.add('is-link')
    }
    box.append(name)
    for (const row of group.rows) {
      const line = el('p', `instruction is-${row.tone}`)
      line.dataset.instruction = row.id
      line.append(el('span', 'instruction-id', row.id), el('span', 'instruction-text', row.text), el('small', 'instruction-note', row.at === null || row.tone === 'closed' ? row.note : `${row.note} · ${ago(row.at, state.readAt)}`))
      box.append(line)
    }
    part.append(box)
  }
  return part
}

// nobodyruns:start
/**
 * T9.4: the one line under Needs your attention while words wait for chats that are off and no chat of the project runs, so
 * nobody can carry the board's word that starts them (`state.nobodyRuns`: `{ since, chats }`). Null while a chat runs.
 */
function nobodyRunsText(nobody) {
  const names = nobody?.chats ?? []
  if (names.length === 0) return null
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `No chat is running, so nobody can wake ${list}: open any chat of the project, and the board wakes the rest.`
}

/**
 * T9.4 (review of 2026-10-25): the line for a chat the board asked in vain (`state.wakeFailed`: `{ chat, tries, since }`): three
 * asks, or every chat that runs was asked, and it still does not run. The person opens it themselves.
 */
function wakeFailedText(failed) {
  return `Nobody could wake ${failed.chat} after ${failed.tries === 1 ? '1 try' : `${failed.tries} tries`} since ${clock(failed.since)}: open it yourself.`
}
// nobodyruns:end

/** T9.4: that line, in the attention colour (see `nobodyRunsText`); null for none. */
function drawNobodyRuns(nobody) {
  const text = nobodyRunsText(nobody)
  return text === null ? null : el('p', 'nobody-runs', text)
}

/** T9.4: one such line for each chat nobody could wake (see `wakeFailedText`), in the same style; null for none. */
function drawWakeFailed(failed) {
  const lines = (failed ?? []).map(one => el('p', 'nobody-runs', wakeFailedText(one)))
  return lines.length === 0 ? null : lines
}

/** Calm panel: the instructions a chat missed, one red line each under Needs your attention; a click opens the log. */
function drawMissed(missed) {
  if (missed.length === 0) return null
  const part = el('div', 'log-missed')
  for (const line of missed) {
    const button = el('button', 'log-missed-line', line.text)
    button.type = 'button'
    button.dataset.openLog = line.id
    button.title = `Opens the log at ${line.id}, your words the chat has not taken up yet`
    part.append(button)
  }
  return part
}

// clicks:start
/** Partner answers: whether the "With your partner" line is open (this page only). */
const withPartnerUi = { isOpen: false }
/** B466: whether "Decided for you by your partner" is open; folded unless the person left it open (this browser). */
const decidedUi = { isOpen: false }
try { decidedUi.isOpen = localStorage.getItem('decided-open') === 'yes' } catch { /* a browser without storage: folded */ }
/** B775: the ticks of the obsolete check's rows the person changed (id → ticked); a row not here is ticked when its verdict is obsolete. */
const obsoleteUi = { set: new Map() }

/**
 * B408: the page's one click handler, with a table of acts. A button names its act by a data attribute (the table's
 * key), and the act runs wherever the button is drawn: in Needs your attention, in a worker's details, or under the
 * daily note on the Focus page. The table grows part by part (docs/robustness-2026-10.md, place 3); the boxes' own
 * handlers hold the rest until then.
 */
const CLICK_ACTS = {
  // Partner answers (2026-10-19): the Undo of a partner's answer (the board's undo: the ask opens for the person).
  'take-back': button => sendWork({ action: 'undo', id: button.dataset.takeBack }, `work:${button.dataset.takeBack}`),
  // Partner answers, the review's findings: the "With your partner" line opens and closes its list.
  'with-partner': () => {
    withPartnerUi.isOpen = !withPartnerUi.isOpen
    redrawNeeds()
  },
  // B775: "Find obsolete items" asks the partner to judge the open items; "Close the N ticked" closes the ticked ones.
  'obsolete': button => {
    if (button.dataset.obsolete === 'check') return sendWork({ action: 'obsolete-check' }, 'obsolete:check')
    const ids = obsoleteRows(board?.obsolete ?? null).filter(row => row.ticked).map(row => row.id)
    if (ids.length > 0) sendWork({ action: 'obsolete-close', ids }, 'obsolete:close')
  },
  'obsolete-tick': box => {
    obsoleteUi.set.set(box.dataset.obsoleteTick, box.checked)
    redrawNeeds()
  },
  // B466: "Decided for you by your partner" opens and closes; the page remembers it.
  'decided': () => {
    decidedUi.isOpen = !decidedUi.isOpen
    try { localStorage.setItem('decided-open', decidedUi.isOpen ? 'yes' : 'no') } catch { /* kept for this visit only */ }
    redrawNeeds()
  },
  // The supervisor: its line under Needs your attention opens its section, and its notes are read.
  'supervisor-line': () => openSupervisor(),
  // B581: its x closes only the line: its notes are read, the section stays folded and the incidents open.
  'supervisor-close': button => readSupervisorNotes(button.dataset.supervisorClose.split(' ').filter(Boolean)),
  // B573: the section's head line opens or folds it; opening marks what is new seen. Its other rules show or fold.
  'supervisor-fold': () => setSupervisorOpen(!supervisorUi.isOpen),
  'supervisor-rules': () => {
    supervisorUi.showsRules = !supervisorUi.showsRules
    if (board !== null) drawSupervisor(board)
  },
  // The supervisor's cards: the id of a card's step is a link (#details=B541) that opens that step; the click on it must
  // not also open the card, so this act stands before the card's own (the table is read in order).
  'supervisor-step': () => {
    setTimeout(() => {
      if (board === null) return
      openFromAddress(board)
      // A step the board does not show (an old one) opens nothing: the address is left clean.
      if (detailsOf === null && location.hash.startsWith('#details=')) history.replaceState(null, '', location.pathname)
    }, 0)
  },
  // The supervisor's cards: a click on a card opens its incidents' evidence, times and counts, and folds them again.
  'supervisor-card': button => {
    const key = button.dataset.supervisorCard
    if (!supervisorUi.openCards.delete(key)) supervisorUi.openCards.add(key)
    if (board !== null) drawSupervisor(board)
  },
  // The supervisor's cards: the fixed ones beyond the newest few show or fold.
  'supervisor-older': () => {
    supervisorUi.showsOlder = !supervisorUi.showsOlder
    if (board !== null) drawSupervisor(board)
  },
  // B541: Pause all on the card of chats on an older Workers mod: the same question as the button above the workers.
  'old-mod-pause': () => {
    isAskingPause = true
    redrawNeeds()
    $('restart').scrollIntoView({ block: 'nearest' })
  },
}

/** The act of a click: the nearest button with an attribute of the table, and the act; null for none, or a button that is off. */
function clickAct(target, acts = CLICK_ACTS) {
  for (const name of Object.keys(acts)) {
    const button = target?.closest?.(`[data-${name}]`) ?? null
    if (button !== null) return button.disabled === true ? null : { name, button }
  }
  return null
}

document.addEventListener('click', event => {
  const act = clickAct(event.target)
  if (act !== null) CLICK_ACTS[act.name](act.button)
})
// clicks:end

// B299: "Read" puts a note away. Calm panel: a missed instruction's line opens the log at it.
$('needs').addEventListener('click', event => {
  const missed = event.target.closest('[data-open-log]')
  if (missed !== null) openLog(missed.dataset.openLog)
  // B301: a warning's way to its chat.
  const talk = event.target.closest('[data-open-talk]')
  if (talk !== null) {
    const where = talk.dataset.openTalk
    if (where === 'main') showSide('main')
    else if (where === 'advisor') {
      show('advice')
      showAdvisorPane('chat')
    } else openDetails({ need: where })
  }
  const read = event.target.closest('[data-read]')
  if (read !== null) sendWork({ action: 'read', id: read.dataset.read }, `read:${read.dataset.read}`)
  const withdraw = event.target.closest('[data-withdraw]')
  if (withdraw !== null) sendWork({ action: 'withdraw', id: withdraw.dataset.withdraw, why: 'its chat does not run' }, `work:${withdraw.dataset.withdraw}`)
  // B258: an answer to an ask on the goal map: read it under its goal, or mark it read.
  const askOpen = event.target.closest('[data-goal-ask-open]')
  if (askOpen !== null) {
    show('advice')
    showAdvisorPane('goals')
    // The map is drawn at once: the answer's block is there to bring into sight.
    zoomGoal(askOpen.dataset.goalAskOpen)
    goalsShowAsk(askOpen.dataset.ask)
  }
  // B259: a brainstorm that waits for the person opens on its part.
  const thinking = event.target.closest('[data-brainstorm-need]')
  if (thinking !== null) {
    show('advice')
    showAdvisorPane('brainstorm')
    brainstormUi.open = thinking.dataset.brainstormNeed
    brainstormUi.newAbout = undefined
    redrawBrainstorm()
  }
  const askDone = event.target.closest('[data-goal-ask-done]')
  if (askDone !== null) sendGoals({ command: 'read', id: askDone.dataset.goalAskDone, ask: askDone.dataset.ask })
})

// partner-needs:start
/** Focus 4 (spec 2026-10-18, section 4): the group of the partner's questions, first under Needs your attention. */
const PARTNER_GROUP = 'From your partner'

/**
 * The cards split into the partner's (`isPartner`, marked by the server) and the rest: the partner's asks of the focus
 * first, in the order the focus shows them (`focusIds`, the ids of state.focus.needs: its daily note's first), then
 * its other asks; within each, and the rest, the order the cards came in (the one the person chose).
 */
function partnerFirst(needs, focusIds) {
  const order = Array.isArray(focusIds) ? focusIds : []
  const rank = need => (need.workId !== undefined && order.includes(need.workId) ? order.indexOf(need.workId) : order.length)
  const partner = needs.filter(need => need.isPartner === true)
    .map((need, at) => ({ need, at }))
    .sort((a, b) => rank(a.need) - rank(b.need) || a.at - b.at)
    .map(one => one.need)
  return { partner, rest: needs.filter(need => need.isPartner !== true) }
}
// partner-needs:end

// waits:start
// The trial's gap 3 (2026-10-24): a question waited on the Overview while the user was on another tab and missed it.
// The top bar says on every tab how many wait for you; a question that comes while the page is open shows a notice.

/** The top bar's words: "2 wait for you", or null when nothing waits. */
function waitsWords(count) {
  return count > 0 ? `${count} wait${count === 1 ? 's' : ''} for you` : null
}

/**
 * Which of the open questions are new: `seen` the ids seen before (null on the page's first draw, when none are new).
 * `{ seen, fresh }`: every id seen so far, and the questions not seen before.
 */
function freshWaiting(seen, open) {
  const fresh = seen === null ? [] : open.filter(one => !seen.has(one.id))
  return { seen: new Set([...(seen ?? []), ...open.map(one => one.id)]), fresh }
}

/** The notice's words: "New question from Main: May I ...?". */
function noticeWords(one) {
  return `New question${one.from ? ` from ${one.from}` : ''}: ${one.title}`
}
// waits:end

/** The top bar's count and the notice of a new question, from what Needs your attention counts and shows. */
let waitsSeen = null
let noticeOf = null
function drawWaits(count, open) {
  const button = $('waits-for-you')
  const words = waitsWords(count)
  button.hidden = words === null
  button.textContent = words ?? ''
  const { seen, fresh } = freshWaiting(waitsSeen, open)
  waitsSeen = seen
  // The notice stays until it is opened or closed, or its question no longer waits.
  if (fresh.length > 0) noticeOf = fresh[fresh.length - 1]
  if (noticeOf !== null && !open.some(one => one.id === noticeOf.id)) noticeOf = null
  const notice = $('ask-notice')
  notice.hidden = noticeOf === null
  if (noticeOf !== null) {
    const opener = el('button', 'is-primary', 'Open it')
    opener.type = 'button'
    opener.dataset.openWaiting = noticeOf.id
    const close = el('button', 'icon-button', '×')
    close.type = 'button'
    close.dataset.closeNotice = ''
    close.setAttribute('aria-label', 'Close')
    notice.replaceChildren(el('span', 'ask-notice-mark', '?'), el('span', 'ask-notice-words', noticeWords(noticeOf)), opener, close)
  }
}

/** Opens Needs your attention on the Overview at a question (its id), or at the first that waits. */
function openWaiting(id) {
  show('overview')
  showSide('needs')
  const cards = [...$('needs').querySelectorAll('[data-id]')]
  const card = cards.find(one => one.dataset.id === id) ?? cards.find(one => !one.classList.contains('is-closed')) ?? null
  if (card === null) return
  card.scrollIntoView({ block: 'center', behavior: 'smooth' })
  card.classList.remove('is-lit')
  void card.offsetWidth
  card.classList.add('is-lit')
}

$('waits-for-you').addEventListener('click', () => openWaiting(null))
$('ask-notice').addEventListener('click', event => {
  const open = event.target.closest('[data-open-waiting]')
  if (open !== null) openWaiting(open.dataset.openWaiting)
  if (open !== null || event.target.closest('[data-close-notice]') !== null) {
    noticeOf = null
    $('ask-notice').hidden = true
  }
})

/** Focus 4: the group "From your partner" with its cards, or null when the partner asks nothing. */
function drawPartnerNeeds(cards, open) {
  if (cards.length === 0) return null
  const part = el('section', 'partner-needs')
  const head = el('h3', '', PARTNER_GROUP)
  head.append(el('small', 'muted', open === 0 ? 'all answered' : `${open} wait${open === 1 ? 's' : ''} for you`))
  part.append(head, ...cards)
  return part
}

// obsolete:start
/** B775: the verdicts' words on the page. */
const OBSOLETE_WORDS = { obsolete: 'Obsolete', unsure: 'Unsure', open: 'Still open' }

/** B775: the check's rows with the person's ticks: a row they changed keeps their tick, any other is ticked when obsolete. */
function obsoleteRows(view, set = obsoleteUi.set) {
  return (view?.rows ?? []).map(row => ({ ...row, ticked: set.has(row.id) ? set.get(row.id) === true : row.ticked }))
}

/**
 * B775: the part under Needs your attention that finds the open items that are obsolete: the button (it reads "The Advisor is
 * checking" while the partner judges, "Try again" when it did not answer in 15 minutes), how many the check closed, and each
 * item it left with its verdict, why and evidence. The person, 2026-10-31: the obsolete ones close by themselves when the
 * Advisor answers; unsure and open ones stay as they are.
 */
function drawObsolete(state) {
  const view = state.obsolete ?? null
  if (view === null || (view.openCount === 0 && view.state === 'none' && view.last === null)) return null
  const rows = obsoleteRows(view, new Map(state.ui?.obsoleteSet ?? []))
  const part = el('section', 'information obsolete-check')
  const isChecking = view.state === 'checking'
  const head = el('div', 'obsolete-head')
  const isSending = sending.has('obsolete:check')
  const label = isSending ? 'Asking the Advisor…' : isChecking ? 'The Advisor is checking' : view.state === 'late' ? 'Try again' : view.state === 'done' ? 'Check again' : 'Find obsolete items'
  const button = el('button', 'choice', label)
  // The person, 2026-10-31: a press shows at once: a spinner and the button greyed while it is sent and while the partner checks.
  if (isSending || isChecking) button.prepend(el('span', 'calm-spinner'))
  button.type = 'button'
  button.dataset.obsolete = 'check'
  button.disabled = isChecking || sending.has('obsolete:check') || view.canCheck === false
  button.title = view.canCheck === false ? view.whyNot : 'Your partner judges every open item here against what happened since it was made; the obsolete ones close by themselves'
  head.append(button)
  if (view.state === 'late') head.append(el('small', 'muted', 'The Advisor did not answer in 15 minutes.'))
  else if (view.state === 'none' || view.state === 'done') head.append(el('small', 'muted', `${view.openCount} open item${view.openCount === 1 ? '' : 's'} here`))
  part.append(head)
  if (problems.has('obsolete:check')) part.append(el('p', 'problem', problems.get('obsolete:check')))
  if (view.state === 'done') {
    const closed = view.last === null ? '' : `Closed ${view.last.closed} obsolete. `
    part.append(el('p', 'muted obsolete-none', rows.length === 0 ? `${closed}Nothing is left to look at.` : `${closed}These stay:`))
  }
  if (rows.length > 0) {
    part.append(fill(el('ul', 'obsolete-rows'), rows.map(row => {
      const item = el('li', `obsolete-row is-${row.verdict}`)
      const words = el('div', 'obsolete-words')
      const line = el('div', 'obsolete-line')
      line.append(el('b', 'task-code', row.id), ' ', row.title, ' ', el('span', 'obsolete-verdict', OBSOLETE_WORDS[row.verdict] ?? row.verdict))
      words.append(line, el('small', 'muted obsolete-why', row.why))
      if (row.evidence !== '') words.append(el('small', 'muted obsolete-evidence', row.evidence))
      item.append(words)
      return item
    })))
  }
  return part
}
// obsolete:end

function drawNeeds(state) {
  const box = $('needs')
  const focused = focusedNeed(box)
  const top = box.scrollTop
  // B361: with "Bother me" once a day the asks that hold up no chat gather under the daily note instead.
  const gathered = new Set(gatheredAsks(state).map(need => need.id))
  const forYou = state.forYou.filter(need => !gathered.has(need.id))
  // Calm panel: the open asks the backlog held are cards as every other ask (`panelNeeds`), its ticked ones closed.
  const needs = panelNeeds({ ...state, forYou })
  const open = needs.filter(need => !isClosed(need))
  // B287: a refine question has no card: its step's line says it, and only while it is open.
  const lines = refineLines(open)
  const cardsOpen = open.filter(need => !isRefineQuestion(need))
  // What was answered on this board lately; the backlog's old ticked asks show with "Show closed", uncounted.
  const answered = forYou.filter(need => isClosed(need) && !isRefineQuestion(need)).length
  // Calm panel: an instruction a chat missed is the person's: one line here, while the log holds the rest.
  const missed = missedLines(state.instructions, clock)
  // The supervisor: one quiet line for its new or returning incidents (B573: "Supervisor: 3 new findings"), never counted.
  const supervised = supervisorLine(state.information, id => sending.has(`read:${id}`))
  // B258: an answer to an ask on the goal map waits to be read, and counts.
  // B287: the refine questions count once per step, as their lines stand.
  // Calm panel: the missed lines count too; the log's notes and open instructions never do.
  const unanswered = cardsOpen.filter(need => !isAnswered(need)).length + lines.length + (state.goalAskNeeds ?? []).length + (state.brainstormNeeds ?? []).length + missed.length
  $('needs-count').textContent = unanswered === 0 ? '' : String(unanswered)
  drawWaits(unanswered, cardsOpen.filter(need => !isAnswered(need)).map(need => ({ id: need.id, from: need.from ?? null, title: need.title })))
  // Focus 4: the partner's questions first, under "From your partner"; the rest as before.
  const shown = ordered(shownNeeds(needs, showsClosed()).filter(need => !isRefineQuestion(need)))
  const { partner, rest } = partnerFirst(shown, (state.focus?.needs ?? []).map(need => need.id))
  const partnerCards = partner.map(need => drawNeed(need, state))
  // B300: a blocking ask that waited too long stands first, above the refine lines too.
  const oldCards = rest.filter(need => need.isOld === true).map(need => drawNeed(need, state))
  const cards = rest.filter(need => need.isOld !== true).map(need => drawNeed(need, state))
  const none = cardsOpen.length > 0 || lines.length > 0 || missed.length > 0 || nobodyRunsText(state.nobodyRuns) !== null || (state.wakeFailed ?? []).length > 0 || (state.goalAskNeeds ?? []).length > 0 || (state.brainstormNeeds ?? []).length > 0 ? null : el('p', 'empty', answered > 0 && !showsClosed() ? `Nothing waits for you. ${answered} answered, hidden.` : 'Nothing waits for you.')
  // B360: the recaps of finished work, as information after what asks for an answer.
  const recaps = shownRecaps(state, showsClosed()).map(recap => drawRecap(recap, state))
  fill(box, [none, drawObsolete(state), drawPartnerNeeds(partnerCards, partner.filter(need => !isClosed(need) && !isAnswered(need)).length), drawMissed(missed), drawSupervisorLine(supervised), drawGoalAskNeeds(state), drawBrainstormNeeds(state), ...oldCards, drawRefineNeeds(state), ...cards, drawWithPartner(state), drawDecidedForYou(state), ...recaps])
  // T9.4: no chat runs, so nobody can wake the chats words wait for (and the chats the board asked in vain): one line each on top of the panel, in the attention colour.
  const nobodyLines = [drawNobodyRuns(state.nobodyRuns), ...(drawWakeFailed(state.wakeFailed) ?? [])].filter(line => line !== null)
  if (nobodyLines.length > 0) box.prepend(...nobodyLines)
  box.scrollTop = top
  refocus(box, focused)
  // B307: Information in its own box under the asks, as high as the person dragged it.
  drawInformation(state)
}

/** Who runs and who was asked to be started: a card that waits for a chat says so, and follows it. */
const runningData = state => [state.chats.map(chat => chat.isRunning), state.advisor?.isRunning ?? null, state.restart?.starting ?? [], state.restart?.main ?? null]

// redraw:start
/**
 * B408: what a part of the page draws, as plain data. once() is keyed on its JSON, and the part is drawn from it, not
 * from the whole state: a field the part reads and its view leaves out is missing on the page at once, never drawn
 * late. A chat counts by its name and whether it runs (a card asks to start it), the backlog by its steps' ids (the
 * linked words), the time by its minute (how long ago; the times keep counting by themselves). `ui` is what the
 * person does on the page.
 */
const minuteOf = at => Math.floor((at ?? 0) / MIN) * MIN
const runnerOf = chat => ((chat ?? null) === null ? null : { name: chat.name, isRunning: chat.isRunning ?? null })
const stepKeysOf = backlog => [{ steps: (backlog ?? []).flatMap(activity => activity.steps ?? []).map(step => ({ key: step.key })) }]

/** What a card of Needs your attention reads (drawNeed, drawRecap): the asks (its linked words), who runs, the box's length. */
function cardsView(state) {
  return {
    forYou: state.forYou ?? [],
    backlogForYou: state.backlogForYou ?? [],
    backlogClosed: state.backlogClosed ?? [],
    recaps: state.recaps ?? [],
    recapsShow: state.recapsShow ?? null,
    chats: (state.chats ?? []).map(runnerOf),
    advisor: runnerOf(state.advisor),
    restart: { main: state.restart?.main ?? null, starting: state.restart?.starting ?? [] },
    backlog: stepKeysOf(state.backlog),
    maxMessageChars: state.maxMessageChars ?? null,
    readAt: minuteOf(state.readAt),
  }
}

/** Needs your attention as drawn (drawNeeds): its cards in the daily note's order, the log's lines, the partner's parts, Information. */
function needsView(state, ui) {
  return {
    ...cardsView(state),
    focus: { needs: (state.focus?.needs ?? []).map(need => ({ id: need.id })) },
    instructions: state.instructions ?? [],
    information: state.information ?? [],
    // T9.4: no chat runs, so nobody can wake the chats words wait for.
    nobodyRuns: state.nobodyRuns ?? null,
    wakeFailed: state.wakeFailed ?? [],
    // B520: the goal map's ids, so a G id in a card's words links (linkedWords).
    goalIds: (state.goals?.nodes ?? []).map(node => node.id),
    goalAskNeeds: state.goalAskNeeds ?? [],
    brainstormNeeds: state.brainstormNeeds ?? [],
    goalsEdit: { canWrite: state.goalsEdit?.canWrite ?? null, whyNot: state.goalsEdit?.whyNot ?? null },
    withPartner: state.withPartner ?? [],
    partnerDecided: state.partnerDecided ?? [],
    // B775: the obsolete check (its rows come with the ticks in `ui`).
    obsolete: state.obsolete ?? null,
    // B541: the card of chats on an older Workers mod says how the pause stands.
    pause: { state: state.pause?.state ?? null },
    ui,
  }
}

/**
 * The Focus page as drawn (drawFocus): the focus, the map, the talks, the partner (its name, whether it runs, its
 * effort), the Partner answers switch, and the note's linked words (the asks' and the steps' ids). While the daily
 * note gathers recaps or asks, they are drawn as Needs your attention draws them (who runs, the minute, the whole
 * asks); without them none of that is drawn, so the page is not drawn anew each minute and its talk stays where the
 * person reads it (the review of B408).
 */
function focusPageView(state, ui) {
  const gathers = gatheredRecaps(state).length > 0 || gatheredAsks(state).length > 0
  // An ask's id for the linked words, and what gatheredAsks and gatheredRecaps decide by.
  const linkable = list => (list ?? []).map(one => ({ id: one.id, workId: one.workId, blocking: one.blocking, isRefine: one.isRefine, isForm: one.isForm, isClosed: one.isClosed }))
  const cards = gathers ? cardsView(state) : {
    forYou: linkable(state.forYou),
    backlogForYou: linkable(state.backlogForYou),
    backlogClosed: linkable(state.backlogClosed),
    recaps: linkable(state.recaps),
    recapsShow: state.recapsShow ?? null,
    backlog: stepKeysOf(state.backlog),
    // The main chat alone (its name, whether it runs): the talk's line says whether it can start a partner that does
    // not run (mainChatOf); the other chats are not drawn here.
    chats: (state.chats ?? []).filter(chat => chat.name === (state.restart?.main ?? null)).map(runnerOf),
    restart: { main: state.restart?.main ?? null },
  }
  return {
    ...cards,
    focus: state.focus ?? null,
    goals: state.goals ?? null,
    brainstorms: state.brainstorms ?? null,
    advisor: (state.advisor ?? null) === null ? null : { ...runnerOf(state.advisor), effort: state.advisor.effort ?? null },
    goalsEdit: { canWrite: state.goalsEdit?.canWrite ?? null, whyNot: state.goalsEdit?.whyNot ?? null },
    workers: { main: state.workers?.main ?? null },
    partnerAnswers: state.partnerAnswers ?? null,
    ui,
  }
}

/** B408: what the person does in Needs your attention, for its view: the order, Show closed, what is picked, sent, open. */
const needsUi = () => ({ obsoleteSet: [...obsoleteUi.set], showsClosed: showsClosed(), order: $('needs-order').value, withPartnerOpen: withPartnerUi.isOpen, decidedOpen: decidedUi.isOpen, chosen: [...chosen], problems: [...problems], sending: [...sending], openForms: [...openForms], starting: [...starting] })

/**
 * B408: what the person does on the Focus page, for its view: the moves of focusUi (not the words typed, which a redraw
 * keeps), and what is picked, sent, refused or open on its cards (the switches, the gathered recaps and asks).
 */
const focusPageUi = () => ({ busy: focusUi.busy, note: focusUi.note, notYet: focusUi.notYet, picked: focusUi.picked, picking: focusUi.picking, dropping: focusUi.dropping, asked: [...focusUi.asked], partsOpen: { ...focusUi.partsOpen }, chosen: [...chosen], problems: [...problems], sending: [...sending], openForms: [...openForms], starting: [...starting] })
// redraw:end

/** B408: Needs your attention, drawn from its view when that changed. */
function needsOnce(state) {
  const view = needsView(state, needsUi())
  once('needs', view, () => drawNeeds(view))
}

/** Draws again what shows requests: the inbox, and the details when they are open. */
function redrawNeeds() {
  if (board === null) return
  drawMainGame(board)
  drawRestart(board)
  needsOnce(board)
  drawDetails(board)
}

const everyNeed = state => [...state.forYou, ...state.backlogForYou, ...state.backlogClosed, ...(state.recaps ?? [])]
const findNeed = id => (board === null ? undefined : everyNeed(board).find(one => one.id === id))

/** The answer forms work the same in the inbox and in the details: both hold `.need` elements named by their id. */
function takeAnswers(box) {
  box.addEventListener('input', event => {
    const card = event.target.closest('.need')
    if (card !== null && event.target.matches('textarea')) drafts.set(card.dataset.id, event.target.value)
  })

  box.addEventListener('click', event => {
    const gameButton = event.target.closest('[data-game]')
    if (gameButton !== null && board !== null) return game(gameButton.closest('[data-game-of]').dataset.gameOf, gameButton.dataset.game)
    const card = event.target.closest('.need')
    if (card === null || board === null) return
    const id = card.dataset.id
    const need = findNeed(id)
    if (event.target.closest('[data-open]') !== null) {
      openForms.add(id)
      redrawNeeds()
      // B361: an ask gathered under the daily note is answered on the Focus page.
      redrawFocus()
      refocus(box, id)
      return
    }
    // B390: Cancel closes a recap's box for the words again, and drops them.
    if (event.target.closest('[data-cancel]') !== null) {
      openForms.delete(id)
      drafts.delete(id)
      problems.delete(id)
      redrawNeeds()
      redrawFocus()
      return
    }
    const choice = event.target.closest('[data-choose]')
    if (choice !== null) {
      // Choosing an option writes it into the answer, where it can be added to before it is sent.
      const before = chosen.get(id)
      const draft = drafts.get(id) ?? ''
      if (draft.trim() === '' || draft === before) drafts.set(id, choice.dataset.choose)
      chosen.set(id, choice.dataset.choose)
      drawn.needs = null
      redrawNeeds()
      redrawFocus()
      return
    }
    const button = event.target.closest('[data-send]')
    if (button === null || need === undefined) return
    const verdict = button.dataset.send === '' ? null : button.dataset.send
    const text = (drafts.get(id) ?? '').trim()
    // B360, B390: a recap takes the person's words with Overturn, or none with OK, seen.
    if (id.startsWith('recap:')) {
      const sent = recapSend(need, verdict, text)
      return sent.ok ? sendWork(sent.body, id) : fail(id, sent.why)
    }
    if (verdict === 'reject' && text === '') return fail(id, 'Say why you reject it: the worker needs to know what to change.')
    if (verdict === null && text === '') return fail(id, 'This needs your words.')
    openForms.delete(id)
    // B299: an ask of the work store is answered in the store; the board wakes the chat that asked.
    if (need.workId !== undefined) return sendWork({ action: 'answer', id: need.workId, verdict, text }, id)
    send({ to: need.from, ask: id, verdict, text }, id)
  })
}

function fail(id, why) {
  problems.set(id, why)
  redrawNeeds()
  // B360: a recap gathered on the Focus page shows its problem there too.
  redrawFocus()
}

takeAnswers($('needs'))
takeAnswers($('details'))
// B360: the recaps gathered in the daily note, on the Focus page.
takeAnswers($('advisor-focus'))
$('pause-all').addEventListener('click', () => {
  isAskingPause = true
  redrawNeeds()
})
$('restart').addEventListener('click', event => {
  const button = event.target.closest('[data-restart]')
  if (button === null || board === null || board.restart.main === null) return
  isAskingPause = false
  if (button.dataset.restart === 'cancel') return redrawNeeds()
  // Pause and resume (spec 2026-10-18): both write pause.json; the board types "resume" into a main chat that runs.
  if (button.dataset.restart === 'pause-all') return sendWork({ action: 'pause-all' }, 'restart')
  if (button.dataset.restart === 'resume') return sendWork({ action: 'resume-all' }, 'restart')
  if (button.dataset.restart === 'end-resume') return sendWork({ action: 'end-resume' }, 'restart')
  // B315: the word that was only copied, on the clipboard again.
  if (button.dataset.restart === 'copy') {
    const words = board.restart.copied?.text ?? ''
    navigator.clipboard.writeText(words).then(() => { button.textContent = 'Copied' }, () => { button.textContent = 'Not copied' })
    return
  }
  // The copied word no longer needs pasting: the board keeps it dismissed.
  if (button.dataset.restart === 'dismiss') {
    if (board.restart.copied != null) send({ command: 'dismiss copied', id: board.restart.copied.id }, 'restart')
    return
  }
  send({ to: board.restart.main, command: button.dataset.restart }, 'restart')
})
// "Ask the main chat to start it", wherever it stands: on a card, in the details, on the advisor's tab.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-start]')
  if (button === null || board === null || (board.restart?.main ?? null) === null) return
  send({ to: board.restart.main, command: 'start', chat: button.dataset.start }, `start:${button.dataset.start}`)
})
// B304: "Check again" on a step whose check failed: the board runs its check anew.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-recheck]')
  if (button === null || board === null) return
  sendWork({ action: 'recheck', id: button.dataset.recheck }, `recheck:${button.dataset.recheck}`)
})
$('main-game').addEventListener('click', event => {
  const button = event.target.closest('[data-game]')
  if (button !== null && board !== null) game('main', button.dataset.game)
})
$('needs-order').addEventListener('change', redrawNeeds)

// "Show closed" is off unless the person ticked it; the choice is kept in this browser.
try {
  $('needs-closed').checked = localStorage.getItem('show-closed') === 'yes'
} catch {
  // Without storage it is off after each reload.
}
$('needs-closed').addEventListener('change', () => {
  try {
    localStorage.setItem('show-closed', showsClosed() ? 'yes' : 'no')
  } catch {
    // Not kept; it still applies until the page is closed.
  }
  redrawNeeds()
})

// The details of a request or of a queued step, in a window over the board

// B65 (the window of a backlog step): what it shows, worked out without the page. Kept between these two marks so a
// test can run it.
// window:start
/** A section of a step's notes that lists what to check: it becomes the window's checklist. */
const isChecklist = part => part.title !== null && /^(requirements?|checklist|checks?|key points to check)$/i.test(part.title.trim())

/**
 * What the window of a request (`need`) or of a queued step (`step`, for the worker `lane`) shows in its head and
 * its checklist. The window is about the step itself: nothing about a queue is in it, no place, no other steps and
 * no waiting or working time. `names` gives the words for a kind (`ask`, `kind`); `isStep` and `isClosed` say what
 * the page knows about the request.
 */
function windowOf({ need = null, step = null, lane = null, isStep = false, isClosed = false }, names) {
  const notes = (need === null ? step?.notes : need.notes) ?? []
  const checklist = [...(need?.checks ?? []), ...notes.filter(isChecklist).flatMap(part => [...part.lines, ...part.points])]
  const rest = notes.filter(part => !isChecklist(part))
  if (need === null) {
    const refined = refinedChips(step.refined ?? null, step.status === 'done')
    return {
      code: step.id ?? null,
      title: step.title,
      chips: [
        // B293: a step refined in the newer form says its goal, its size, and its questions or Ready, in place of "Step".
        ...(refined ?? [{ text: 'Step', tone: 'kind' }]),
        // Where the step itself stands, when the backlog says so: worked on, or ticked.
        ...(step.status === 'progress' ? [{ text: 'In progress', tone: 'plain' }] : step.status === 'done' ? [{ text: 'Finished', tone: 'plain' }] : []),
        ...(lane === null ? [] : [{ text: `For: ${lane}`, tone: 'to' }]),
      ],
      at: null,
      checklist,
      notes: rest,
      hasNotes: notes.length > 0,
    }
  }
  const chips = []
  if (isClosed) chips.push({ text: 'Closed', tone: 'plain' })
  chips.push({ text: isStep ? names.ask(need.asks) : names.kind(need.kind), tone: 'kind' })
  if (isStep && need.activity) chips.push({ text: need.activity, tone: 'plain' })
  if (!isStep && need.from) chips.push({ text: `From: ${need.from}`, tone: 'to' })
  // B110: a step the board ticks itself says so; only what makes work goes to a chat.
  const ticks = need.approval === 'tick' ? (need.kind === 'do' ? 'Done ticks it here' : `Approve ticks it here · Reject goes to: ${need.from}`) : null
  if (isStep && need.from !== null && need.from !== undefined && need.isClosed !== true) chips.push({ text: ticks ?? `Answer goes to: ${need.from}`, tone: 'to' })
  // `hasNotes`: something is written under the step, wherever the window shows it (B94).
  return { code: need.step ?? null, title: need.title, chips, at: need.at ?? null, checklist, notes: rest, hasNotes: notes.length > 0 }
}

/** B293: a size as a chip says it: "about 3-4 hours" is "about 3–4 h". */
const sizeText = size => String(size).replace(/(\d)\s*-\s*(\d)/g, '$1–$2').replace(/\bhours?\b/gi, 'h').replace(/\bminutes?\b/gi, 'min').trim()

/** B293: a refine block in the newer form: a summary, its goal or its size, or ready. */
const hasNewForm = refined => refined !== null && refined !== undefined && (refined.ready === true || refined.summary !== '' || refined.partOf !== '' || refined.size !== '')

/**
 * B293: the chips of a step refined in the newer form: its goal, its size, and the questions that wait for the
 * person (none for a finished step, `isDone`), or Ready. Null for a step refined in the older form, or not.
 */
function refinedChips(refined, isDone = false) {
  if (!hasNewForm(refined)) return null
  // B309: the open asks under the step count as its questions; one answered and not folded in yet keeps Ready away.
  const asks = refined.asks ?? []
  const open = isDone ? 0 : (refined.ready ? 0 : refined.questions.filter(one => one.answer === null).length) + asks.filter(one => one.answer === null).length
  return [
    ...(refined.partOf === '' ? [] : [{ text: refined.partOf, tone: 'goal' }]),
    ...(refined.size === '' ? [] : [{ text: sizeText(refined.size), tone: 'plain' }]),
    ...(refined.ready && asks.length === 0 ? [{ text: 'Ready', tone: 'ready' }] : open > 0 ? [{ text: `${open} question${open === 1 ? '' : 's'} for you`, tone: 'wait' }] : []),
  ]
}
/**
 * B296: the strip of a step's states in its window, from the flow file (flow.json) of the work store: each state, the
 * step's own marked, those before it passed; and the moves out of it, who makes each and what must hold first. Null
 * without the store.
 */
function flowStripOf(flow) {
  if (flow === null || flow === undefined) return null
  const at = flow.states.indexOf(flow.state)
  // B392: a step whose open blocking asks all wait for the partner says so in its own colour, not "waiting on you".
  const partner = (flow.waitsForPartner ?? []).length > 0 ? `waits for your partner (${flow.waitsForPartner.join(', ')})` : null
  return {
    states: flow.states.map((name, index) => (index === at && partner !== null ? { name: partner, tone: 'partner' } : { name, tone: index === at ? 'now' : at >= 0 && index < at ? 'past' : 'later' })),
    state: flow.state,
    isKnown: at >= 0,
    next: flow.next.map(move => `${move.to}, by ${move.by.join(' or ')}${move.when === null ? '' : ` when ${move.when}`}`),
  }
}

// item:start
/** B468: the levels of a step's effort, lowest first, as the app names them. */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
/** Model per step: the model families a step may name, cheapest first, and the words the page says them with. */
const MODEL_FAMILIES = ['sonnet', 'opus']
const MODEL_NAMES = { sonnet: 'Sonnet', opus: 'Opus' }
/** Model per step: a model family and an effort level as the page says them, "Sonnet · medium" (the level alone without a family). */
const runWords = (family, level) => (typeof family === 'string' && family !== '' ? `${MODEL_NAMES[family] ?? family} · ${level}` : level)
const EFFORT_HOLDS = ['taken', 'in progress', 'waiting on you']
const effortClock = ms => { const at = new Date(ms); return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` }
const effortMinutes = minutes => (minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`)
const effortTokens = tokens => (tokens < 1000 ? String(tokens) : tokens < 1_000_000 ? `${Math.round(tokens / 1000)} k` : `${Math.round(tokens / 100_000) / 10} M`)

/**
 * B468: what a step's window says under its effort, from its worker's lane (`lanes`, the state's chats with their
 * `effortRun`, src/work/effort.mjs): that the worker runs at it until the step ends, or that the main chat was asked to
 * set it and it is not set yet; for a step queued for a worker, that it will. Null for a step nobody holds or will take.
 * Model per step: the step's model beside its effort ("Sonnet · low"), and the usual setting after it.
 */
function effortRunLine(item, lanes = []) {
  const owner = item?.owner ?? null
  const isHeld = EFFORT_HOLDS.includes(item?.state)
  if (owner === null || (!isHeld && item.state !== 'queued')) return null
  const setting = runWords(item.model?.family, item.effort.level)
  const run = lanes.find(lane => String(lane.name).toLowerCase() === String(owner).toLowerCase())?.effortRun ?? null
  if (run !== null && run.step === item.id && run.isSet) {
    return isHeld ? `${owner} runs at ${setting} until the step ends, then at its usual setting (${runWords(run.usualModel, run.usual)}).` : `${owner} is set to ${setting} for it already.`
  }
  if (run !== null && run.step === item.id && run.asked !== null) return `The main chat was asked at ${effortClock(run.asked.at)} to set ${owner} to ${setting}; not set yet.`
  return isHeld ? `${owner} is to run at ${setting} while it holds the step.` : `${owner} is set to ${setting} before the step goes to it.`
}

/** B468: what the board kept for a level (`efforts`, the state's taskTimes.efforts): its steps, their typical time and tokens. */
function effortKeptLine(level, efforts = []) {
  const kept = efforts.find(one => one.level === level) ?? null
  if (kept === null) return `Kept per level: the time and tokens its steps take, so the levels can be tuned. None at ${level} yet.`
  return `Kept for ${level}: ${kept.count} step${kept.count === 1 ? '' : 's'} so far, typically ${effortMinutes(kept.typicalMin)}${kept.tokens === null ? '' : ` and ${effortTokens(kept.tokens)} tokens`}.`
}

/**
 * B299: the parts of a step's window from the work store, in their order: the Summary on top, the picture, the
 * goal chip, B468 its effort, the flow strip, What we build, then Requirements and Touches folded, History last. `item`
 * is the state's `item` of the step; only the parts it has. `lanes` and `efforts` (the state's chats and
 * taskTimes.efforts) say who runs at its effort and what was kept for that level.
 */
function itemPartsOf(item, hasFlow, { lanes = [], efforts = [] } = {}) {
  if (item === null || item === undefined) return []
  const words = item.yourWords ?? []
  const parts = [
    item.summary.length > 0 ? { key: 'summary', title: 'Summary', lines: item.summary, isFolded: false } : null,
    // Your words (2026-10-30): the person's answers and notes on it, each with what it answered, and "Add a note".
    words.length > 0 ? { key: 'yourwords', title: 'Your words', lines: yourWordsRows(words).map(one => one.head), isFolded: false, id: item.id, points: words } : null,
    item.picture !== null ? { key: 'picture', title: 'Picture', lines: [item.picture], isFolded: false } : null,
    item.goal !== null ? { key: 'goal', title: 'Goal', lines: [item.goal], isFolded: false } : null,
    // Model per step: its model with it, where the board sets one (the settings name the model ids; else none).
    (item.effort ?? null) !== null ? { key: 'effort', title: (item.model ?? null) === null ? 'Effort' : 'Model and effort', lines: [], isFolded: false, effort: item.effort, model: item.model ?? null, run: effortRunLine(item, lanes), kept: effortKeptLine(item.effort.level, efforts) } : null,
    hasFlow ? { key: 'flow', title: 'Flow', lines: [], isFolded: false } : null,
    item.what.length > 0 ? { key: 'what', title: 'What we build', lines: item.what, isFolded: false } : null,
    // B356: the result check by a helper that did not build it: the ticks, the score and the evidence picture.
    (item.checked ?? null) !== null ? { key: 'checked', title: 'Checked by a helper', lines: checkedLines(item.checked), isFolded: false, checked: item.checked } : null,
    (item.fixOf ?? null) !== null ? { key: 'fixof', title: 'A fix of', lines: [item.fixOf], isFolded: false } : null,
    item.requirements.length > 0 ? { key: 'requirements', title: 'Requirements', lines: item.requirements, isFolded: true } : null,
    item.touches.length > 0 ? { key: 'touches', title: 'Touches', lines: item.touches, isFolded: true } : null,
    item.history.length > 0 ? { key: 'history', title: 'History', lines: item.history, isFolded: false } : null,
  ]
  return parts.filter(part => part !== null)
}

/**
 * Your words (the person, 2026-10-30: "ensure my answer/rejection/note has context of what i answered it to"): each point
 * of a step's "Your words" as its window shows it, newest last: its head (number, time, how, in plain words: B701, no ids),
 * its context (who asked what, the options, the advice), the pictures it showed (shown as pictures, not paths) and the
 * person's words.
 */
function yourWordsRows(points) {
  const isPicture = path => /\.(?:png|jpe?g|gif|webp)$/i.test(path)
  return (points ?? []).map(one => {
    const shown = one.shown ?? []
    return {
      n: one.n,
      head: `${one.n}. ${one.at} · your ${String(one.how ?? '').replace(/^answer to Q\d+, a refine question/, 'answer to a refine question').replace(/^answer to Q\d+/, 'answer')}`,
      context: [
        (one.question ?? null) === null ? '' : `${one.by === null || one.by === undefined ? 'Asked' : `${one.by} asked`}: "${one.question}"`,
        (one.about ?? null) === null ? '' : `About: "${one.about}"`,
        (one.options ?? []).length === 0 ? '' : `options: ${one.options.join(' / ')}`,
        (one.advice ?? null) === null ? '' : `advised: ${one.advice}`,
        shown.some(path => !isPicture(path)) ? 'with a play link' : '',
      ].filter(Boolean).join(' · '),
      pictures: shown.filter(isPicture),
      words: `You: ${one.answer}`,
    }
  })
}

/** B356: a result check's lines: "2 of 3 points pass · score 82 of 75", then each point with its tick. */
function checkedLines(checked) {
  const marks = { pass: '✓', fail: '✗', ask: '?' }
  return [
    `${checked.passed} of ${checked.total} points pass${checked.score === null ? '' : ` · score ${checked.score}`}`,
    ...checked.points.map(one => `${marks[one.verdict] ?? '·'} ${one.text}${one.verdict === 'ask' ? ' (for you to judge)' : ''}`),
  ]
}

/**
 * B293: an item's picture line as the refine writes it: `{ path, caption }` for a picture file with what it shows in
 * brackets (a path written as code too), or `{ path: null, note }` with why there is none ("none (a rule only)").
 */
function pictureOfLine(line) {
  const words = String(line).replace(/`([^`]*)`/g, '$1').trim()
  const inBrackets = text => text.replace(/^\((.*)\)\.?$/, '$1').trim()
  const file = words.match(/^(\S+\.(?:png|jpe?g|gif|webp))(?=\s|$)\s*(.*)$/i)
  if (file !== null) return { path: file[1], caption: inBrackets(file[2].trim()), note: '' }
  return { path: null, caption: '', note: inBrackets(words.replace(/^none\b[\s:,;.-]*/i, '').trim()) }
}
// item:end
// window:end

// taskwindow:start
/**
 * B701 (the person, 2026-10-26: "there is way too much information for me ... 2 lines of context, then brief what
 * happened, conclusion, possible options ... compactly and highover described, never any details. i want lots of
 * pictures"): the window of a step that was taken opens on a Summary in plain words, drawn from the step's record: what
 * we want, the target beside the latest result, why we are not there yet, one line per try, the conclusion, the options
 * of the step's open question. The checks, the history and the settings stand behind tabs. These are pure, for the test.
 */
const TASK_TABS = [['summary', 'Summary'], ['checks', 'Checks'], ['history', 'History'], ['settings', 'Settings']]
/** The states in which a step's window opens on its Summary; before them (new, refined, queued) the Backlog tab's refine is its window. */
const TASK_STATES = ['taken', 'in progress', 'waiting on you', 'review', 'done', 'dropped']
const isTaskStep = item => item !== null && item !== undefined && TASK_STATES.includes(item.state)

const TASK_SENTENCE = /(?<=[.!?])\s+(?=[A-Z0-9"“])/
const TASK_ID = /\b[BQGX]\d{1,4}\b/
const upFirst = text => text.charAt(0).toUpperCase() + text.slice(1)
const cutWords = (text, most) => (text.length <= most ? text : `${text.slice(0, most).replace(/\s+\S*$/, '')}…`)

/** A text as its plain sentences: the card's cleaner (`isTechnical`: code, files, paths, programmers' words) and no step or ask ids. */
function plainSentences(text) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim()
  return words === '' ? [] : words.split(TASK_SENTENCE).filter(one => !isTechnical(one) && !TASK_ID.test(one))
}

/** A standard line, "<kind> · <reference picture> · target <score>": the reference picture's path, or null. */
function standardPicture(line) {
  const field = String(line ?? '').split(/\s*·\s*/)[1]?.trim() ?? ''
  return /\.(?:png|jpe?g|gif|webp)$/i.test(field) ? field : null
}

/**
 * B701: the Summary of a step (`item`, the state's item of it, with its `tries`): `{ want, target, now, why, tried,
 * triedPictures, conclusion, failed, isFailed }`. A part with nothing to show is empty or null, and the window leaves it
 * out. `want`: the step's summary in at most two plain lines; `target`: the standard's reference picture, else the step's
 * own picture; `now`: the newest check's evidence picture; `why`: what is wrong with the latest version, when its check
 * failed; `tried`: one line per try of the chain, `{ n, way, result, isFailed }`, `result` why it failed; `conclusion`:
 * the newest check's one line.
 */
function summaryOf(item) {
  const tries = item.tries ?? []
  const checks = tries.map((one, place) => ({ ...one, n: place + 1 })).filter(one => one.check !== null && one.check.total > 0)
  const isFailedTry = one => one.check.passed < one.check.total
  const latest = checks.at(-1) ?? null
  const latestFailed = latest !== null && isFailedTry(latest) ? latest : null
  const pictureOf = line => (line === null || line === undefined ? null : pictureOfLine(line).path)
  const now = [...checks].reverse().map(one => pictureOf(one.check.evidence)).find(path => path !== null) ?? null
  const target = standardPicture(item.standard) ?? pictureOf(item.picture)
  const want = plainSentences((item.summary ?? []).join(' ')).slice(0, 2).map(one => upFirst(cutWords(one, 220)))
  // The checker's own words, through the cleaner; without them (an older check) the count, never the raw failed points (B706).
  const why = latestFailed === null ? []
    : plainSentences(latestFailed.check.why ?? '').length > 0 ? plainSentences(latestFailed.check.why).slice(0, 2).map(one => upFirst(cutWords(one, 220)))
      : [`The latest check passed ${latestFailed.check.passed} of ${latestFailed.check.total} points.`]
  const tried = checks.slice(-8).map(one => {
    const failed = isFailedTry(one)
    // Without the checker's words a try is its step's title (a fix's title, "Fix: ...", names what it fixes: cut short, and "a fix" when it is not plain).
    const title = plainSentences(one.title.replace(/^Fix:\s*/i, ''))[0] ?? ''
    const way = plainSentences(one.check.tried ?? '')[0] ?? (one.n === 1 ? title || 'a first build' : title === '' ? 'a fix' : `Fix: ${cutWords(title, 70)}`)
    const result = failed ? (plainSentences(one.check.why ?? '').slice(0, 2).join(' ') || `${one.check.passed} of ${one.check.total} points passed`) : ''
    return { n: one.n, way: cutWords(way.replace(/[.!?]+$/, ''), 140), result: cutWords(result.replace(/[.!?]+$/, ''), 200), isFailed: failed, picture: pictureOf(one.check.evidence) }
  })
  // A failed try's evidence picture, but not the one already shown as the latest result.
  const triedPictures = tried.filter(one => one.isFailed && one.picture !== null && one.picture !== now).slice(-4).map(one => ({ path: one.picture, caption: `Try ${one.n} · ${cutWords(one.result === '' ? one.way : one.result, 60)}` }))
  const conclusion = latest === null ? null : upFirst(plainSentences(latest.check.conclusion ?? '').slice(0, 2).join(' ')) || null
  return { want, target, now, why, tried, triedPictures, conclusion, failed: tries.filter(one => one.check !== null && one.check.total > 0 && isFailedTry(one)).length, isFailed: latestFailed !== null }
}

/** B701: the open questions of a step (asks of the store the board can answer), oldest first; with the goal guard's question of its goal (`guardAsk`: Fable or Opus), which is about the step's failed checks. */
const taskAsksOf = (id, needs, guardAsk = null) => needs.filter(one => !isStep(one) && isCalm(one) && (one.of === id || (guardAsk !== null && one.workId === guardAsk))).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))

/**
 * B706: the goal guard's question (Fable or Opus), when it is about this very step: the focus goal's guard asks of the
 * first step of the chain whose failed checks it counted (`guard.step`), and only that step's window offers it; on the
 * goal's other steps (B702, B696 beside B691) it is not theirs to answer. Null otherwise.
 */
const taskGuardAsk = (item, focus) => (focus?.guard?.state === 'asking' && focus.guard.step === item.id && item.goal === focus.id ? focus.guard.ask ?? null : null)

/** B706: the question of an ask as the Options show it, in plain words: the guard's question in its own words; any other ask's title, without step, goal or ask ids. */
function taskQuestion(need, isGuard) {
  if (isGuard) return 'The checks failed three times. Should the strategy be evaluated by Fable (the strongest model, far more tokens) or by Opus?'
  const words = splitAsk(need.question ?? need.title).question
  return upFirst(words.replace(/\b[BQGX]\d{1,4}\b\s*(?:·\s*)?/g, '').replace(/\s+/g, ' ').trim())
}

/** B706: the goal's name for the window's chip, as the goal map titles it without its id; the id when the map has none. */
function goalNameOf(id, nodes) {
  const title = String((nodes ?? []).find(one => one.id === id)?.title ?? '').replace(new RegExp(`^${id}\\s+`), '').trim()
  return title === '' ? id : title
}

/**
 * B706: a check's points as the Checks tab shows them, one short line each: `{ verdict, mark, text, full }`, `text` the
 * point's first sentence cut to about 110 characters, `full` its whole words (the line's tooltip).
 */
function taskCheckLines(points) {
  const marks = { pass: '✓', fail: '✗', ask: '?' }
  return (points ?? []).map(one => {
    const first = String(one.text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?:;])\s+/)[0]
    return { verdict: one.verdict, mark: marks[one.verdict] ?? '·', text: cutWords(first.replace(/[.;:]+$/, ''), 110), full: one.text }
  })
}
// taskwindow:end

// waiting:start
/**
 * B100: the request to open for a lane that waits for the person: what its chat itself waits for, else a request
 * it filed that is not answered yet, else the one that was answered last. Null when the lane has none.
 */
function needOfLane(needs, name) {
  const mine = needs.filter(need => need.from === name && need.kind !== 'intervene' && need.activity === undefined && need.isClosed !== true)
  const isOpen = need => (need.answer ?? null) === null
  return (mine.find(need => need.id.startsWith(`chat:${name}:`) && isOpen(need)) ?? mine.find(isOpen) ?? mine[0] ?? null)?.id ?? null
}

/**
 * B100: what the window of a worker that waits shows above the answer: its task in a few lines, as its own card
 * names it (`task`), and what it wants from the person, in its own words: the questions it asked with the app's
 * question form, the plan it asks to have approved, or what it last said (`words`); `summary` is the app's line of
 * what it needs. `where` says where the answer goes: `here`, in its `chat` only (the app's own question form), or
 * nowhere any more (`answered`). Null for a request that is not a waiting worker's.
 */
function waitingOf(need, now) {
  if (need === null || need.waits === undefined) return null
  const task = need.task ?? null
  const lines = []
  if (task === null || task.text === '') lines.push('It recorded no task.')
  else {
    lines.push(task.text)
    if (task.step !== null && task.steps !== null) lines.push(`Step ${task.step} of ${task.steps}${task.name === null ? '' : `: ${task.name}`}`)
  }
  if (task !== null && task.stepId !== null) lines.push(`Backlog step ${task.stepId}`)
  if (task !== null && Number.isFinite(task.startedAt)) lines.push(`Since ${clock(task.startedAt)} (${span(now - task.startedAt)})`)
  const waits = need.waits ?? null
  // B533: a hint of the board's (B301, B308): its window says what the board found, with its buttons, apart.
  const isHint = need.kind === 'unfiled' || need.kind === 'idle'
  const where = (need.answer ?? null) !== null ? 'answered' : isHint ? 'hint' : need.canAnswer ? 'here' : 'chat'
  return {
    task: lines,
    hasTask: task !== null && task.text !== '',
    // For a question of the app's form the need's own line only says where to answer: the window says that below.
    summary: where === 'chat' || isHint ? '' : need.text ?? '',
    isHint,
    questions: waits?.questions ?? [],
    plan: waits?.plan ?? null,
    // B149: its words without the closing block, which the window shows apart, formatted.
    words: waits?.handover?.rest ?? waits?.words ?? '',
    saidAt: waits?.at ?? null,
    where,
    // B149: the parts of its answer when it finished a task with something left for the person (`handover`).
    handover: waits?.handover ?? null,
    // B169: the main chat's window shows what the person decides on (`mainParts`).
    isMain: need.isMain === true,
    // B275: so does the Advisor's, which asks the person as part of its talk with them.
    isAdvisor: need.isAdvisor === true,
  }
}

/** B149: whether a finished worker's answer has the parts of the agreed form, so the window shows them. */
const hasForm = handover => handover !== null && (handover.items.length > 0 || handover.task !== null || handover.did !== null)

/** B149: the closing block's lines, to show as a small table: `[label, words, tone]`; tone 'good' or 'bad' for Done. */
function closingRows(closing) {
  if (closing === null) return []
  return [['Prompt', closing.prompt, ''], ['Who', closing.who, ''], ['Done', closing.done, closing.isDone === true ? 'good' : closing.isDone === false ? 'bad' : '']]
    .filter(([, words]) => words !== null && words !== '')
}
// waiting:end

// calm:start
/**
 * B269: the person, 2026-10-15: "This input needed screen is too cluttered with too much information. this new image
 * makes it less chaotic ... i want it even more spacious then the image". What waits for the person is the work store's
 * asks (B299): each gets one calm window, the step in one line on top, one question at a time as its title, its
 * answers as large cards with the advised one marked, everything else folded behind one line, a note, and one Send.
 * Whether an ask's window is drawn that way: an ask of the store the board can answer, not answered yet, and not a
 * refine question (those are answered in their step's refine part).
 */
const isCalm = need => need !== null && need !== undefined && need.workId !== undefined && need.canAnswer === true
  && (need.answer ?? null) === null && need.isRefine !== true && need.isForm !== true

/** B269: the asks one calm window goes through, one at a time: the open ones of the same chat on the same step, oldest first. */
function calmGroup(need, needs) {
  const order = ask => Number(String(ask.workId).replace(/\D/g, '')) || 0
  return needs.filter(one => one === need || (isCalm(one) && one.from === need.from && (one.of ?? null) === (need.of ?? null)))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || order(a) - order(b))
}

/**
 * B269: a question's words split into the question itself, the window's title (up to its first "?", else its first
 * sentence), and the rest: the why and the advice, under it. Words that would make too long a title stay whole.
 */
function splitAsk(words) {
  const text = String(words ?? '').replace(/\s+/g, ' ').trim()
  const mark = text.search(/\?(?=\s|$)/)
  // A sentence ends at a full stop before a capital, but not after an abbreviation ("e.g. Yew").
  const ends = [...text.matchAll(/[.!](?=\s+[A-Z0-9"“])/g)].map(found => found.index)
  const sentence = ends.find(index => !/\b(?:e\.g|i\.e|etc|vs|cf|approx|fig|ca|incl|resp|est|mr|mrs|ms|dr|st)$/i.test(text.slice(0, index))) ?? -1
  // B452: a question mark past 280 characters makes no title: the first sentence is the title then.
  const at = mark >= 0 && mark <= 280 ? mark : sentence
  if (at < 0 || at > 280) return { question: text, rest: '' }
  return { question: text.slice(0, at + 1), rest: text.slice(at + 1).trim() }
}

// B397: an ask's words carry what the person needs to decide. The person, 2026-10-19, on an ask that named another:
// "where can i find Q202, i need a link in the future". Kept between these two marks so a test can run it.
// asklinks:start
/** A page of the project: a path with /, a text or picture ending, standing on its own (not inside an address). */
const ASK_PAGE = /(?<=^|[\s(["'`])((?:[\w@+-][\w@+.-]*\/)+[\w@+-][\w@+.-]*\.(?:md|txt|json|csv|png|jpe?g|webp|gif))(?![\w/]|\.\w)/gi
/** A G, Q or B id standing on its own: not part of a word, a path, a file name or an address. */
const ASK_ID = /(?<![\w/.:#=-])([GQB]\d+)(?![\w/-]|\.\w)/g
/** B507: a tab by the words the board shows on it, and the part of the Focus tab named after it ("the Focus tab, then Goals"). */
const ASK_TAB = /(?<![\w-])(Vision|Focus|Backlog|Design|Spending) tab(?![\w-])(?:(?<=Focus tab),? then (Focus|Goals|Brainstorm)(?![\w-]))?/g
const ASK_TAB_ADDRESS = { Vision: '#vision', Focus: '#advice/focus', Backlog: '#backlog', Design: '#design', Spending: '#spending' }

/**
 * An ask's words in pieces: words, `{ ask }` (a Q id `known.isAsk` knows), `{ step }` (a B id `known.isStep` knows),
 * `{ path, isPicture }` (a page of the project) and `{ place, words, label }` (B507: a goal `known.isGoal` knows, or a
 * tab with the part named after it: the address on this board and the words that name it); an id the board does not
 * know stays words.
 */
function askLinkPieces(text, known) {
  const pieces = []
  const say = words => {
    if (words === '') return
    if (typeof pieces.at(-1) === 'string') pieces[pieces.length - 1] += words
    else pieces.push(words)
  }
  // The ids in words that are no page.
  const ids = words => {
    let from = 0
    for (const found of words.matchAll(ASK_ID)) {
      const id = found[1]
      const piece = id[0] === 'G'
        ? (known.isGoal?.(id) === true ? { place: `#advice/goals/${id}`, words: id, label: `Open ${id} on Goals` } : null)
        : id[0] === 'Q' ? (known.isAsk(id) ? { ask: id } : null) : known.isStep(id) ? { step: id } : null
      if (piece === null) continue
      say(words.slice(from, found.index))
      pieces.push(piece)
      from = found.index + id.length
    }
    say(words.slice(from))
  }
  // The tabs, and the part named after one, in words that are no page.
  const tabs = words => {
    let from = 0
    for (const found of words.matchAll(ASK_TAB)) {
      ids(words.slice(from, found.index))
      const place = found[2] === undefined ? ASK_TAB_ADDRESS[found[1]] : `#advice/${found[2].toLowerCase()}`
      pieces.push({ place, words: found[0], label: `Open the ${found[0]}` })
      from = found.index + found[0].length
    }
    ids(words.slice(from))
  }
  const all = String(text ?? '')
  let from = 0
  for (const found of all.matchAll(ASK_PAGE)) {
    tabs(all.slice(from, found.index))
    pieces.push({ path: found[1], isPicture: /\.(?:png|jpe?g|webp|gif)$/i.test(found[1]) })
    from = found.index + found[1].length
  }
  tabs(all.slice(from))
  return pieces
}

/** The one other open ask (of `needs`, one the person can still answer) an ask's words name by its Q id; null when none or several. */
function pointedAsk(need, needs) {
  const words = [need.question, need.title, need.text].filter(one => typeof one === 'string').join('\n')
  const named = new Set(askLinkPieces(words, { isAsk: () => true, isStep: () => false }).filter(piece => piece.ask !== undefined).map(piece => piece.ask))
  named.delete(need.workId)
  const open = needs.filter(one => one !== need && one.canAnswer === true && one.isClosed !== true && named.has(one.workId))
  return open.length === 1 && named.size === 1 ? open[0] : null
}
// asklinks:end

/** B269: a picture's file name in words, for its link: without its folder, date and ending ("b12 the gate"). */
const pictureWords = path => String(path).split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/^\d{4}-\d{2}-\d{2}[-_ ]*/, '').replace(/[-_]+/g, ' ').trim()

/** B269: whether the chat's advice says yes or no ("yes", "No, not yet"): 'yes', 'no' or null. */
const adviceSays = advice => String(advice ?? '').trim().match(/^(yes|no)\b/i)?.[1].toLowerCase() ?? null

/**
 * B269: the cards of an ask: its options, each with its letter ("A thin") and its words (a short head before a colon
 * is the card's title), the one it advises marked; else Yes and No for a look (approve, reject) or a decide; Done for
 * a do; none for a provide, which takes the person's words. `verdict` is what a pick of it stands for.
 */
function cardsOf(need) {
  const says = adviceSays(need.advice)
  // A letter before punctuation ("A: thin", "B. thick") is always one; before a space ("A thin") only when the options
  // so lettered run A, B, ... (two at least), else it is the word "A" ("A new tab").
  const marked = /^([A-H])(?:[.:)]\s*|\s+[—–-]\s+)(.+)$/
  const spaced = /^([A-H])\s+(.+)$/
  const options = need.options ?? []
  const letters = options.map(one => (one.label.match(marked) ?? one.label.match(spaced))?.[1] ?? null).filter(one => one !== null)
  const isSpacedLettered = letters.length >= 2 && letters.every((letter, at) => letter === 'ABCDEFGH'[at])
  const advisedKey = String(need.advice ?? '').trim().match(/^([A-H])(?:\b|$)/)?.[1] ?? null
  const option = one => {
    const lettered = one.label.match(marked) ?? (isSpacedLettered ? one.label.match(spaced) : null)
    const words = lettered === null ? one.label : lettered[2]
    const parts = words.match(/^(.{1,60}?)(?::\s+|\s+[—–]\s+)(.+)$/)
    const key = lettered?.[1] ?? null
    return { verdict: one.label, key, title: parts === null ? words : parts[1], text: parts === null ? '' : parts[2], isAdvised: one.isRecommended === true || (key !== null && key === advisedKey) }
  }
  if (options.length > 0) return options.map(option)
  if (need.kind === 'do') return [{ verdict: 'done', key: null, title: 'Done', text: '', isAdvised: false }]
  if (need.asks === 'provide') return []
  const [yes, no] = need.kind === 'verify' ? ['approve', 'reject'] : ['yes', 'no']
  return [
    { verdict: yes, key: null, title: 'Yes', text: '', isAdvised: says === 'yes' },
    { verdict: no, key: null, title: 'No', text: 'Say in the note what to change.', isAdvised: says === 'no' },
  ]
}

/**
 * B269: what the window sends for an ask, from the card picked and the note: `{ verdict, text }` as the store takes
 * an answer (a look approved or rejected, a do done, else the person's words, a pick first); `{ lacks: 'words' }` for
 * a No without words, `{ lacks: 'pick' }` for words on a look or a do without a pick; null when nothing is given.
 */
function calmAnswer(need, pick, words) {
  const note = String(words ?? '').trim()
  if (pick === null || pick === undefined) {
    if (note === '') return null
    return need.kind === 'verify' || need.kind === 'do' ? { lacks: 'pick' } : { verdict: null, text: note }
  }
  if ((pick === 'no' || pick === 'reject') && note === '') return { lacks: 'words' }
  if (pick === 'approve' || pick === 'reject' || pick === 'done') return { verdict: pick, text: note }
  const label = pick === 'yes' ? 'Yes' : pick === 'no' ? 'No' : pick
  return { verdict: null, text: note === '' ? label : `${label}\n${note}` }
}

/**
 * B269: what one Send of a calm window does, from the card picked (`pickOf(id)`) and the note (`wordsOf(id)`) of each
 * of its asks: `{ send: [{ id, need, answer }] }`, the answers given in order (the questions without one stay open);
 * `{ lacks: id, what: 'words' | 'pick' }` for the first that cannot go as it is, which holds them all back; or
 * `{ none: id }` when nothing is given.
 */
function calmPlan(group, pickOf, wordsOf) {
  const answers = group.map(need => ({ id: need.id, need, answer: calmAnswer(need, pickOf(need.id), wordsOf(need.id)) }))
  const lacking = answers.find(one => one.answer?.lacks !== undefined)
  if (lacking !== undefined) return { lacks: lacking.id, what: lacking.answer.lacks }
  const send = answers.filter(one => one.answer !== null)
  return send.length === 0 ? { none: group[0]?.id ?? null } : { send }
}

/** B269: whether the store refused an answer because the ask was answered or withdrawn meanwhile ("Q3 is answered already."). */
const isGoneAlready = problem => /\bQ\d+ is [a-z ]+ already\.$/.test(String(problem ?? ''))

/** B269: what stands over the note: optional, except for a No, which needs words; for a provide it is the answer. */
const noteLabel = (need, pick) => (need.asks === 'provide' && (need.options ?? []).length === 0 ? 'Your answer'
  : pick === 'no' || pick === 'reject' ? 'Add a note (needed for No)' : 'Add a note (optional)')

/** B269: the Send button, which says how many of the window's questions have an answer to go. */
const sendLabel = (count, given) => (count === 1 ? 'Send answer' : given === 0 ? 'Send answers' : given === count ? `Send ${count} answers` : `Send ${given} of ${count} answers`)

/** B269: where it stands, for the line on top: the step the ask is about, and whether the chat waits for the answer. */
function standingOf(need) {
  const line = need.of === null || need.of === undefined ? '' : `${need.of}${need.ofTitle === null || need.ofTitle === undefined ? '' : ` ${need.ofTitle}`}`
  return { line, more: `${need.from ?? 'The board'} ${need.blocking === true ? 'waits for your answer' : 'goes on meanwhile'}` }
}

/**
 * B402: the Send button of a calm window: "Sending…" with a spinner, and not to be clicked, only while one of its
 * asks goes; after any reply it is free again.
 */
function calmSendView(group, sending, words = sendLabel(group.length, group.length)) {
  const isBusy = group.some(one => sending.has(one.id))
  return { text: isBusy ? 'Sending…' : words, isBusy, isDisabled: isBusy }
}

/** B402: the toast once the answers went: "Answer sent to Digger", "2 answers sent to Digger". */
const sentToast = sent => `${sent.length === 1 ? 'Answer' : `${sent.length} answers`} sent to ${sent[0]?.from ?? 'the board'}`

/**
 * B402: whether the calm window that shows the ask `calmAt` closes on this refresh: the ask was answered elsewhere
 * (another tab, its chat, the partner) or is gone. A window opened on an answered ask (no `calmAt`) stays.
 */
const isAnsweredElsewhere = (calmAt, need) => calmAt !== undefined && (need === undefined || need === null || (need.id === calmAt && !isCalm(need)))
// calm:end

/**
 * B149: the parts of a worker's answer window when its answer has the agreed form: its task as its own Task line says,
 * what it did, its whole answer folded, and its closing block. `{ main, side }`, each a list of sections.
 */
function handoverParts(waiting) {
  const { handover } = waiting
  // B157: on top, set apart: the task in at most two lines, and what it did in plain words (a technical sentence
  // is left out there; the folded details have its whole answer).
  const did = plainWords(handover.did)
  const main = [briefPart([
    ['The task', [briefTask(shortTask(handover.task, null, waiting.task[0] ?? null))]],
    ['What I did', did === '' ? [] : [el('p', 'brief-text', did)]],
  ])]

  // B301: its "For you" items are not shown as questions to answer here: what waits for the person is the store's asks.
  // B157: below, folded: its whole answer, its closing block.
  main.push(foldedDetails([
    waiting.words === '' ? null : section(`Its whole answer${waiting.saidAt === null ? '' : `, ${clock(waiting.saidAt)}`}`, [rich(el('div', 'said-words'), waiting.words)]),
    ...closingParts(handover.closing),
  ]))
  return { main: main.filter(part => part !== null), side: [] }
}

/**
 * B169: the window of the main chat that waits for the person. The person, 2026-10-14: "This 'for you' tab, doesnt
 * contain the information i need to approve. i think it works for for workers, but not for the main chat". On top what
 * the person asked it (its closing block's Prompt) and where that stands (Done); then its answer itself, open; its
 * closing block folded, and the way to Talk to Main. B301: the questions of its "For you" block are not offered as
 * questions to answer here: what waits for the person is the store's asks.
 */
function mainParts(waiting) {
  const handover = waiting.handover
  const closing = handover?.closing ?? null
  const asked = closing?.prompt ?? ''
  const stands = closing?.done ?? ''
  const tone = closing?.isDone === true ? ' is-good' : closing?.isDone === false ? ' is-bad' : ''
  const main = []
  if (asked !== '' || stands !== '') {
    main.push(briefPart([
      ['You asked', asked === '' ? [] : [briefTask(capitalized(asked))]],
      ['Where it stands', stands === '' ? [] : [el('p', `brief-text${tone}`, capitalized(stands))]],
    ]))
  }
  const material = handover?.material ?? waiting.words
  if (material !== '') main.push(section(`Its answer${waiting.saidAt === null ? '' : ` of ${clock(waiting.saidAt)}`}`, [drawTalkText(el('div', 'main-material'), material)]))
  // B275: what it asked with the app's own form, or the plan it asks to have approved: answered in its chat.
  const form = formParts(waiting)
  if (form.length > 0) main.push(section('What it asks in its chat', [...form, el('p', 'muted', 'It asked with the app\'s own question form: that one takes its answer only in its chat.')]))
  // B533: a hint says what the board found above; "It waits for you" only when the chat itself asks.
  if (material === '' && form.length === 0 && !waiting.isHint) main.push(el('p', 'muted', waiting.where === 'answered' ? 'It has your answer and went on.' : 'It waits for you, and said no more.'))
  const open = el('button', 'link-button', waiting.isAdvisor ? 'Open its chat on the Advisor tab' : `Open Talk to ${board?.mainTalk?.name ?? 'Main'}`)
  open.type = 'button'
  // B275: the Advisor's window leads to the talk with it, on its own tab.
  if (waiting.isAdvisor) open.dataset.showAdvisor = 'chat'
  else open.dataset.showSide = 'main'
  main.push(foldedDetails([
    ...closingParts(closing),
    section('Its talk', [el('p', 'muted', 'All its answers are in the talk with it.'), open]),
  ]))
  return { main, side: [] }
}

/** B169: words with a capital first letter, as a line of the window starts. */
const capitalized = text => text.charAt(0).toUpperCase() + text.slice(1)

/** B149: the closing block of a worker's answer as three lines, Done in green or red; nothing when it has none. */
function closingParts(closing) {
  const rows = closingRows(closing)
  if (rows.length === 0) return []
  const list = el('dl', 'closing-rows')
  for (const [label, words, tone] of rows) list.append(el('dt', 'muted', label), el('dd', tone === '' ? '' : `is-${tone}`, words))
  return [section('Its closing block', [list])]
}

$('details').addEventListener('click', event => {
  // B533: a hint's window: the way to the main chat's talk or the Advisor's chat, as on its card.
  const talk = event.target.closest('[data-open-talk]')
  if (talk !== null && (talk.dataset.openTalk === 'main' || talk.dataset.openTalk === 'advisor')) {
    closeDetails()
    if (talk.dataset.openTalk === 'main') showSide('main')
    else {
      show('advice')
      showAdvisorPane('chat')
    }
    return
  }
  // B169: from the main chat's window to the talk with it, on the right side.
  const side = event.target.closest('[data-show-side]')
  if (side !== null) {
    closeDetails()
    showSide(side.dataset.showSide)
    return
  }
  const advisor = event.target.closest('[data-show-advisor]')
  if (advisor !== null) {
    closeDetails()
    show('advice')
    showAdvisorPane(advisor.dataset.showAdvisor)
    return
  }
  // B269: Back and Next in the calm window show another ask of the same chat and step.
  const go = event.target.closest('[data-calm-go]')
  if (go !== null && detailsOf?.need !== undefined) {
    detailsOf = { ...detailsOf, need: go.dataset.calmGo }
    calmFocus = 'question'
    detailsShown = null
    drawDetails(board)
    return
  }
  // B269: a card of the calm window picks that answer; a second click takes it back.
  const pick = event.target.closest('[data-calm-pick]')
  if (pick !== null && detailsOf?.need !== undefined) {
    const id = detailsOf.need
    calmPicks.set(id, calmPicks.get(id) === pick.dataset.calmPick ? null : pick.dataset.calmPick)
    problems.delete(`calm:${id}`)
    calmFocus = `pick:${pick.dataset.calmPick}`
    detailsShown = null
    drawDetails(board)
    return
  }
  if (event.target.closest('[data-calm-send]') !== null && detailsOf?.need !== undefined) sendCalm(detailsOf.need)
})
$('details').addEventListener('input', event => {
  // B269: the note of the calm window, kept per ask until it is sent.
  if (!event.target.matches('[data-calm-words]') || detailsOf?.need === undefined) return
  calmWords.set(detailsOf.need, event.target.value)
  // The words came: what held the answers back is said no more.
  if (problems.delete(`calm:${detailsOf.need}`)) $('details').querySelector('.calm-answer .problem')?.remove()
  const need = findNeed(detailsOf.need)
  const send = $('details').querySelector('[data-calm-send]')
  if (need !== undefined && send !== null && board !== null) send.textContent = calmSendText(calmGroup(need, everyNeed(board)))
})

/** B100: the questions a chat asked with the app's own form, with the options it offers, and the plan it asks to have approved. */
function formParts(waiting) {
  const parts = []
  for (const one of waiting.questions) {
    parts.push(el('p', 'waiting-question', one.question))
    if (one.options.length > 0) parts.push(listOf(one.options))
  }
  if (waiting.plan !== null) {
    const plan = el('div', 'said')
    plan.append(el('small', 'muted', 'The plan it asks you to approve'), rich(el('div', 'said-words'), waiting.plan))
    parts.push(plan)
  }
  return parts
}

/** B100: the two parts of a waiting worker's window: its task, and what it wants from the person. */
function waitingParts(waiting, needId = null) {
  // B169: the main chat, which asks the person as part of its talk with them; B275: the Advisor too.
  if (waiting.isMain || waiting.isAdvisor) return mainParts(waiting)
  // B149: a finished worker whose answer has the agreed form.
  if (hasForm(waiting.handover)) return handoverParts(waiting)
  const task = waiting.task.map((line, index) => el('p', index === 0 ? `waiting-topic${waiting.hasTask ? '' : ' muted'}` : 'muted', line))
  const wants = []
  if (waiting.summary !== '') wants.push(el('p', 'waiting-summary', waiting.summary))
  wants.push(...formParts(waiting))
  if (waiting.words !== '') {
    const said = el('div', 'said')
    said.append(el('small', 'muted', `Its last words${waiting.saidAt === null ? '' : `, ${clock(waiting.saidAt)}`}`), rich(el('div', 'said-words'), waiting.words))
    wants.push(said)
  }
  if (wants.length === 0) wants.push(el('p', 'muted', waiting.where === 'answered' ? 'It has your answer and went on.' : waiting.isHint ? 'The board kept no words of its last answer.' : 'It waits for you, and said no more.'))
  if (waiting.where === 'chat') wants.push(el('p', 'muted', 'It asked with the app\'s own question form: that one takes its answer only in its chat.'))
  // B149: an answer that has only the closing block shows it apart, formatted, and not among its words.
  return { main: [section('Its task', task), section('What it wants from you', wants)], side: closingParts(waiting.handover?.closing ?? null) }
}

/** B65: the ticks the person set in a window's checklist, kept while the page is open (they are the person's own notes, sent nowhere). */
const ticked = new Map()

/** B65: the checklist of a window: what the step lists under "Requirements", each with a box to tick while checking. */
function drawChecklist(id, points) {
  const list = el('ul', 'checklist')
  const mine = ticked.get(id) ?? new Set()
  points.forEach((point, index) => {
    const item = el('li')
    const label = el('label')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = mine.has(index)
    box.dataset.tick = String(index)
    box.dataset.of = id
    label.append(box, el('span', '', point))
    item.append(label)
    list.append(item)
  })
  return list
}

/** B65: the pictures of a window: the first two large and side by side, the others in a row under them; a click enlarges each. */
function drawReferences(shown) {
  const figureOf = ({ path, caption }) => {
    const figure = el('figure')
    figure.append(picture(path, caption), el('figcaption', '', caption === '' ? path.split('/').pop() : caption))
    return figure
  }
  const large = el('div', `references${shown.length === 1 ? ' is-one' : ''}`)
  for (const one of shown.slice(0, 2)) large.append(figureOf(one))
  if (shown.length <= 2) return [large]
  const strip = el('div', 'references-more')
  for (const one of shown.slice(2)) strip.append(figureOf(one))
  return [large, strip]
}


// lanewindow:start
/** Model per step: the words a lane's chip says a model family with ("Sonnet · low"). */
const LANE_MODELS = { sonnet: 'Sonnet', opus: 'Opus' }
/** B235: a size in tokens, short: 820000 is "820k". */
const tokensOf = count => (Number.isFinite(count) ? (count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)) : null)

/**
 * B248: why the Workers mod did not compact a worker, in plain words: the first whose pattern fits its reason. `null`
 * words are not shown (the main chat is never compacted this way); `isWarning` only for a real failure. A reason
 * the board does not know is a failure too.
 */
const NOT_COMPACTED = [
  [/main chat/, null, false],
  [/small enough/, 'small, no compaction needed', false],
  [/switched off/, 'compaction switched off', false],
  [/not reported yet/, 'not compacted: its task is not reported yet', false],
  [/more of the same work/, 'not compacted: more of the same work follows', false],
  [/compacting with \/compact once/, 'compaction on its way', false],
  // Mod 0.9.0 could not compact in the app's chats; a chat gets the newer one only when the app starts anew.
  [/headless|\$\.session\.compact/, 'not compacted: needs a restart of the app for the new Workers mod', true],
  [/size is not known/, 'not compacted: its size could not be read', true],
  [/could not be read/, 'not compacted: its card could not be read', true],
  [/^\/compact did not run/, 'not compacted: the compaction did not run', true],
  [/(?:)/, 'not compacted: the Workers mod hit a problem', true],
]

/**
 * B235: the one line on whether the Workers mod compacted a worker after its last report, or why not; null without.
 * B248: the mod's own words, with the time, in its tooltip (`title`).
 */
function compactionLine(compaction, clockOf) {
  if (compaction === null || compaction === undefined) return null
  // Clear after each step: the mod cleared the worker after its reported step; its conversation is kept as a log.
  if (compaction.kind === 'cleared') {
    const text = `cleared after ${compaction.step ?? 'its step'}`
    const kept = (compaction.log ?? null) === null ? 'its log was not named' : `the conversation before is kept in ${compaction.log}`
    return { text, title: `Workers mod at ${clockOf(compaction.at)}: ${text}; ${kept}`, isWarning: false, log: compaction.log ?? null }
  }
  // B547: the mod's newest word is why it did not clear the worker after its reported step.
  if (compaction.kind === 'not-cleared') return { text: 'not cleared after its step', title: `Workers mod at ${clockOf(compaction.at)}: not cleared: ${compaction.why}`, isWarning: true }
  // Clear after each step: why the mod did not clear the worker, and compacted it instead.
  const notCleared = (compaction.notCleared ?? null) === null ? '' : ` Not cleared at ${clockOf(compaction.notCleared.at)}: ${compaction.notCleared.why}.`
  if (compaction.kind === 'skipped') {
    const [, words, isWarning] = NOT_COMPACTED.find(([pattern]) => pattern.test(compaction.why))
    return words === null ? null : { text: words, title: `Workers mod at ${clockOf(compaction.at)}: ${compaction.why}${notCleared}`, isWarning }
  }
  // B247: an after of 0 is not known yet (the mod writes it before the size is known): only the size before is said.
  const [before, after] = [tokensOf(compaction.before), compaction.after > 0 ? tokensOf(compaction.after) : null]
  const text = `compacted at ${clockOf(compaction.at)}${before === null ? '' : `, from ${before}${after === null ? '' : ` to ${after}`} tokens`}`
  return { text, title: `${text}${notCleared}`, isWarning: false }
}

/**
 * B547: the line of a worker that owes a clear (its last report newer than its last clear, state.mjs `clearOwed`): its
 * next step waits for the clear its Workers mod runs once the chat is idle; an older mod cannot, and its chat needs the
 * restart that brings the new one. Null when nothing is owed.
 */
function clearOwedLine(owed, clockOf) {
  if (owed === null || owed === undefined) return null
  const last = Number.isFinite(owed.clearedAt) ? `its last clear at ${clockOf(owed.clearedAt)}` : 'no clear known'
  const then = owed.canClear === true ? 'its next step waits until its Workers mod clears it, as soon as the chat is idle' : 'its Workers mod is too old to clear it now: restart its chat (Pause all, restart the app, Resume all)'
  return { text: `not cleared after ${owed.step}`, title: `Reported ${owed.step} at ${clockOf(owed.reportedAt)}, ${last}: ${then}.${owed.why === null || owed.why === undefined ? '' : ` Why not cleared: ${owed.why}.`}` }
}

/**
 * B577: the line of a chat whose session was stopped (state.mjs `stopped`): the app drops every word to it until it gets
 * input, so its words wait and the main chat is asked once to wake it. Null when it is not stopped.
 */
function stoppedLine(stop, clockOf) {
  if (stop === null || stop === undefined || !Number.isFinite(stop.since)) return null
  const count = `${stop.words} ${stop.words === 1 ? 'word waits' : 'words wait'}`
  return { text: `stopped since ${clockOf(stop.since)}`, title: `Stopped since ${clockOf(stop.since)}: the app takes no word for it until it gets input. ${count} for it; the main chat is asked to wake it.` }
}

/**
 * Clear after each step: the line "cleared after B482 · log" under a worker's name; "log" opens the conversation the
 * mod cleared in the board's file viewer (B218).
 */
function clearedNote(line) {
  const note = el('small', 'compaction is-cleared', `${line.text} · `)
  note.title = line.title
  if (line.log === null) {
    note.append('no log')
    return note
  }
  const open = el('button', 'ask-link', 'log')
  open.type = 'button'
  open.dataset.gameFile = line.log
  open.dataset.projectFile = line.log
  open.title = `Open ${line.log}`
  note.append(open)
  return note
}

const LANE_WINDOW_STATES = { working: 'Working', suspended: 'Suspended', interrupted: 'Cut off', off: 'Not running' }

/**
 * B182: a lane's task as the Workers panel and its window name it: `code` is the backlog step it is on (the step its
 * hand-over named, else the one its card is on; null without one), `text` the card's topic without that step's
 * number in front (B157: a topic that starts with "B173" or "B173:" does not say it twice beside it). Null when the
 * chat recorded no topic.
 */
function laneTaskOf(lane) {
  const task = lane.task ?? null
  const code = lane.givenTask?.step?.id ?? task?.stepId ?? null
  // B299: a step of the store is named by its title as the store holds it, never by the card's short topic. B292:
  // without the note in brackets a migrated title, or a card named after one, may have brought along.
  if (typeof task?.title === 'string' && task.title !== '') return { code, text: withoutNote(task.title) }
  if (task === null || (task.text ?? '') === '') return { code, text: null }
  return { code, text: withoutNote(code === null ? task.text : task.text.replace(new RegExp(`^${code}[:,]?\\s+`), '')) }
}

/**
 * B292: words without the notes in brackets at their end ("See tall walls (not handed out; after today)"), one level of
 * brackets inside a note; words that are nothing but brackets keep them. As the board's reading of a step does.
 */
function withoutNote(words) {
  let rest = String(words)
  for (;;) {
    const found = rest.match(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/)
    if (found === null || rest.slice(0, found.index).trim() === '') return rest.trim()
    rest = rest.slice(0, found.index)
  }
}

const SHORT_TASK_CHARS = 220

/**
 * B157: the task in one short sentence, for someone who forgot the context: the message's own "In short: ..." line
 * when it has one; else the sentence of its first line, without the main chat's "Task from <main chat>: B<id>, "
 * before it and the "About <time>." after it (the person's own words stay as they are); else the backlog step's
 * title, else the card's topic. The window shows it in at most two lines; it is cut at SHORT_TASK_CHARS.
 */
function shortTask(given, stepTitle = null, topic = null) {
  const lines = String(given ?? '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(line => line !== '')
  const inShort = lines.find(line => /^in short:/i.test(line))
  let words = inShort === undefined ? null : inShort.replace(/^in short:\s*/i, '')
  if (words === null && lines.length > 0) {
    const first = lines[0]
      .replace(/^(?:\w+\s+){0,2}tasks?\s+from\s+[^:]{1,60}:\s*/i, '')
      .replace(/^B\d+[,:]\s+/, '')
      .replace(/\s+about\s+[^.]{1,40}\.?\s*$/i, '')
      .trim()
    if (first !== '') words = first
  }
  return twoLines(words ?? stepTitle ?? topic ?? '')
}

/** B425: a title longer than this is cut to its first clause; what is still longer, at a word. */
const SHORT_TITLE_CHARS = 60
const MOST_TITLE_CHARS = 72

/**
 * B425: a step's title for the head of its window (the person, I40: "It's title is too long"): a short one whole; a
 * long one up to its first clause (a ": ", "; ", " - ", ", " or " (" after its first 20 characters, so "Build the
 * Causeway," is not all it says; a ", " in a list, "summary, picture and what we build", ends none); what is still too
 * long cut at a word, with "…".
 */
function shortTitle(title) {
  const words = String(title).trim()
  if (words.length <= SHORT_TITLE_CHARS) return words
  const clause = /:\s|;\s|\s[—–-]\s|,\s|\s\(/g
  // A comma whose part after it, up to the next clause mark, holds an "and" or an "or" is a list's.
  const isList = found => found[0] === ', ' && /\s(?:and|or)\s/.test(words.slice(found.index + 2).split(/:\s|;\s|\s[—–-]\s|,\s|\s\(/)[0])
  let found = clause.exec(words)
  while (found !== null && (found.index < 20 || isList(found))) found = clause.exec(words)
  const first = found === null ? words : words.slice(0, found.index).trim()
  if (first.length <= MOST_TITLE_CHARS) return first
  // One more character, so a word that ends right at the limit stays.
  const cut = first.slice(0, MOST_TITLE_CHARS + 1)
  const at = cut.lastIndexOf(' ')
  return `${cut.slice(0, at > 20 ? at : MOST_TITLE_CHARS).replace(/[\s,;:]+$/, '')}…`
}

/** A task's words for the window's two lines: with a capital, cut at SHORT_TASK_CHARS. */
function twoLines(words) {
  const chosen = String(words).trim()
  const capital = chosen.charAt(0).toUpperCase() + chosen.slice(1)
  return capital.length > SHORT_TASK_CHARS ? `${capital.slice(0, SHORT_TASK_CHARS - 1).trimEnd()}…` : capital
}

/**
 * B281: what the backlog step a task is about is, in at most two lines: as shortTask finds it in the message (its
 * "In short: ..." line, else its first line), unless that only names the step again: then the step's own first line
 * in the backlog that says what it is (`step.about`). The person, 2026-10-17: "I want the task to be clear, recap the
 * original task briefly".
 */
function stepTask(given, step, topic = null) {
  const said = shortTask(given, step.title, topic)
  const bare = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '')
  // The message's first line that only names the step again says nothing the head does not.
  const isTitle = bare(said) === '' || bare(step.title).includes(bare(said)) || bare(said).includes(bare(step.title))
  return isTitle && typeof step.about === 'string' && step.about.trim() !== '' ? twoLines(step.about) : said
}

/**
 * B157: what makes a sentence technical for the person: code, a file or a path, an address setting, a function, a
 * programmer's name (snake_case, camelCase) or a programmer's word.
 */
const TECHNICAL = [
  /`/, /\b[\w-]+\.(?:m?js|ts|tsx|css|html|md|json|py|png|jpe?g|webp)\b/i, /[\w.-]+[\\/][\w.-]+[\\/]?/, /[?&][\w-]+=/,
  /\b[A-Za-z_]\w*\(/, /\b[a-z]+_[a-z][\w]*\b/, /\b[a-z]+[A-Z]\w*\b/,
  /\b(?:commits?|branch(?:es)?|npm|regex|refactor\w*|typecheck\w*|endpoints?|api|vitest|worktree|repositor(?:y|ies)|origin|stash)\b/i,
]

/** B157: whether a piece of text is technical (see TECHNICAL). */
const isTechnical = text => TECHNICAL.some(pattern => pattern.test(text))

/**
 * B157: the plain sentences of a worker's words, for the window's top part (the person, 2026-10-14: "non technical
 * and highover"): a sentence that is technical is left out, so the top shows less rather than technical words; the
 * folded details hold the whole text. Empty when nothing plain is left.
 */
function plainWords(text) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (words === '') return ''
  return words.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).filter(sentence => !isTechnical(sentence)).join(' ')
}

/**
 * B157: a working worker's plan, in plain words: its steps by name with where each stands (`done`, `now`, `next`),
 * the technical ones left out, and one line with the step it is on and the time left. Null when it named no steps.
 */
function planOf(lane, now) {
  const line = stepLine(lane, now)
  if (line === null) return null
  const [at, total] = line.count.split('/')
  return {
    steps: line.steps.filter(step => !isTechnical(step.name)),
    line: `${at === '–' ? `No step of ${total} yet` : `Step ${at} of ${total}`} · ${line.time}`,
  }
}

/**
 * B151: what the window of a working worker's lane shows (also one that is suspended, cut off, or between two turns):
 * in its head the task as its card names it; then the task as it was given (`given`: what the person typed there,
 * with when; B301: the step the work store holds for it has no words of its own), the step it is on, and where it
 * stands now (`standing`: its step line, its time, what it does). Null for a lane whose window this is not: a free
 * one, or one that waits for the person (that one opens what it waits for, B100).
 */
function laneWindowOf(lane, now, mainTitle) {
  // T13 part 3: an asleep one resumes by itself: "Interrupted", not "Cut off".
  const chip = lane.state === 'interrupted' && lane.asleep === true ? 'Interrupted' : lane.state === 'interrupted' && lane.report?.state === 'idle' ? 'Idle, task open' : LANE_WINDOW_STATES[lane.state]
  if (chip === undefined) return null
  const task = lane.task ?? null
  const given = lane.givenTask ?? null
  const step = given?.step ?? null
  // B425: what the store holds of the step: its refined parts, what it is, its goal by name, the rest for the details.
  const brief = step?.brief ?? null
  // A refine block with a summary, what we build or a picture file (not "none (...)").
  const hasPicture = typeof brief?.picture === 'string' && !/^none\b/i.test(brief.picture.trim())
  const refined = brief === null || (brief.summary.length === 0 && brief.what.length === 0 && !hasPicture) ? null
    : { summary: brief.summary.join(' '), picture: hasPicture ? brief.picture : null, what: brief.what }
  const line = stepLine(lane, now)
  const time = timeOf(lane, now)
  const fullTitle = laneTaskOf(lane).text
  return {
    code: laneTaskOf(lane).code,
    // B425: the title cut to its first clause (the person, I40: "It's title is too long"); the whole one on hover.
    title: fullTitle === null ? 'Task not recorded yet' : shortTitle(fullTitle),
    fullTitle,
    chips: [{ text: chip, tone: 'kind' }, { text: `Worker: ${lane.name}`, tone: 'to' }, ...((brief?.goal ?? null) === null ? [] : [{ text: brief.goal, tone: 'goal' }]),
      // B468: the effort it runs at for the step, and "not set yet" while the main chat was asked and the app has not.
      // Model per step: with its model, "Sonnet · low".
      ...((brief?.effort ?? null) === null ? [] : [{ text: `${(brief.model ?? null) === null ? 'Effort: ' : `${LANE_MODELS[brief.model.family] ?? brief.model.family} · `}${brief.effort.level}${lane.effortRun?.step === step.id && lane.effortRun.isSet === false && lane.effortRun.asked != null ? ', not set yet' : ''}`, tone: 'plain' }])],
    // B301: only the person's words give a task; the main chat's messages give none.
    given: given === null || given.by !== 'you' ? null : { from: `Typed by you, ${clock(given.at)}`, text: given.text },
    step,
    // B157: the top part: the task in one short sentence, and its plan in plain words; the person's feedback the
    // worker is on as a part apart (B281). B425: for a step with a refine block, its summary, picture and what we
    // build; without one, the first lines of its context. The step's id and title stand in the head only.
    refined,
    task: step === null
      ? shortTask(given?.text ?? null, null, task === null || task.text === '' ? null : task.text)
      : refined !== null && refined.summary !== '' ? twoLines(refined.summary)
        : (brief?.about ?? []).length > 0 ? twoLines(brief.about.join(' '))
          : given.by === 'step' ? stepTask('', step) : stepTask(given.text, step, task === null || task.text === '' ? null : task.text),
    details: step === null ? null : {
      step: `${step.id} · ${step.title}`,
      // What it touches stands apart, not again among its context.
      context: (brief?.context ?? []).filter(one => !/^Touches:/.test(one)),
      touches: brief?.touches ?? [],
      history: brief?.history ?? [],
    },
    feedback: (lane.feedback ?? null) === null ? null : { title: `Now on your feedback (${clock(lane.feedback.at)})`, text: lane.feedback.text },
    plan: planOf(lane, now),
    standing: [
      ...(line === null ? [] : [line.label]),
      `${time.label === '' ? '' : `${time.label}: `}${time.main}${time.small.length > 0 ? `, ${time.small.join(', ')}` : ''}`,
      ...(typeof lane.doingNow === 'string' && lane.doingNow !== '' ? [`Now: ${lane.doingNow}`] : []),
      ...(typeof lane.between === 'string' && lane.between !== '' ? [`Between turns: ${lane.between.replace(/^Its turn has ended; /, '')}`] : []),
    ],
  }
}
// lanewindow:end

/**
 * B151: the parts of a working lane's window, in order. Each takes the window's view (`laneWindowOf`) and the lane,
 * and gives a section, or null when it has nothing to show. A later window (B149) adds its own parts here.
 */
const LANE_PARTS = {
  main: [
    // B157: on top, set apart: the task in at most two lines, and its plan in plain words. B281: the step it is on,
    // and the person's feedback it is on now in a part of its own.
    view => briefPart([['The task', taskNodes(view)], [view.feedback?.title ?? '', feedbackNodes(view.feedback)], ['Its plan', planNodes(view.plan)]]),
    // B157: below, folded: the task as it was given, its step, where it stands; B425: its context, touches, history.
    view => foldedDetails([
      section('Its task as it was given', view.given === null
        ? [el('p', 'muted', 'The message that gave it this task is not in the part of its chat the board reads.')]
        : [el('small', 'muted', view.given.from), rich(el('div', 'said-words'), view.given.text)]),
      view.details === null ? null : section('Backlog step', [el('p', '', view.details.step)]),
      view.details === null || view.details.context.length === 0 ? null : section('Context', [listOf(view.details.context)]),
      view.details === null || view.details.touches.length === 0 ? null : section('Touches', [listOf(view.details.touches)]),
      section('Where it stands', view.standing.map(line => el('p', '', line))),
      view.details === null || view.details.history.length === 0 ? null : section('History', [listOf(view.details.history)]),
    ]),
  ],
  side: [],
}

/** B157: the top part of a task window: under each header in capitals, its lines; set apart from the rest. */
function briefPart(rows) {
  const panel = el('div', 'task-brief')
  for (const [title, nodes] of rows) {
    if (nodes.length === 0) continue
    const part = el('div', 'brief-part')
    part.append(el('h3', '', title), ...nodes)
    panel.append(part)
  }
  return panel
}

/** B157: the task in its two lines; a window without one says so. */
const briefTask = task => el('p', `brief-task${task === '' ? ' muted' : ''}`, task === '' ? 'The board does not know the task yet.' : task)

/**
 * B281: a working worker's task: what it is in two lines. B425: a step with a refine block shows its summary, its
 * picture (a thumbnail that opens in the picture popup) and what we build, "Not in it" greyed.
 */
function taskNodes(view) {
  if (view.refined === null) return [briefTask(view.task)]
  const picture = view.refined.picture === null ? null : pictureOfLine(view.refined.picture)
  return [
    // Without a summary, what the step is from its context.
    view.refined.summary === '' ? briefTask(view.task) : el('p', 'brief-summary', view.refined.summary),
    ...(picture === null || picture.path === null ? [] : [pictureRow(picture.path, picture.caption)]),
    ...(view.refined.what.length === 0 ? [] : [el('h3', '', 'What we build'), buildList(view.refined.what)]),
  ]
}

/** B281: the person's feedback the worker is on, in at most two lines; nothing when it is on none. */
const feedbackNodes = feedback => (feedback === null ? [] : [el('p', 'brief-feedback', feedback.text)])

/** B157: a plan as one line of its steps (done ones struck through, the current one marked) and its step and time. */
function planNodes(plan) {
  if (plan === null) return [el('p', 'brief-line', 'It has not named its plan yet.')]
  const nodes = []
  if (plan.steps.length > 0) {
    const steps = el('p', 'brief-plan')
    plan.steps.forEach((step, index) => {
      if (index > 0) steps.append(el('span', 'brief-dot', ' · '))
      steps.append(el('span', `is-${step.state}`, `${step.state === 'done' ? '✓ ' : step.state === 'now' ? '▶ ' : ''}${step.name}`))
    })
    nodes.push(steps)
  }
  nodes.push(el('p', 'brief-line', plan.line))
  return nodes
}

/** B157: the details of a task window under one header, folded until the person opens it. */
function foldedDetails(parts) {
  const shown = parts.filter(part => part !== null)
  if (shown.length === 0) return null
  const details = el('details', 'task-details')
  details.append(el('summary', '', 'Details'), ...shown)
  return details
}

/** B157: a window drawn anew keeps its details open when the person had opened them. */
function keepUnfolded(box, draw) {
  const wasOpen = box.querySelector('.task-details')?.open === true
  draw()
  const details = box.querySelector('.task-details')
  if (wasOpen && details !== null) details.open = true
}

/** The head of a window: its code and title, its chips, when it was asked, the sign of its kind, and the cross. */
function detailsHead(view, sign, now) {
  const head = el('header', 'details-head')
  const names = el('div', 'details-names')
  const heading = el('h2')
  if (view.code !== null) heading.append(el('span', 'details-code', view.code))
  heading.append(view.title)
  // B425: a title cut short shows the whole one on hover.
  if (typeof view.fullTitle === 'string' && view.fullTitle !== view.title) heading.title = view.fullTitle
  const chips = el('p', 'details-chips')
  for (const chip of view.chips) chips.append(el('span', `chip is-${chip.tone}`, chip.text))
  if ((view.at ?? null) !== null) chips.append(el('span', 'chip is-time', `Asked ${ago(view.at, now)}`))
  names.append(heading, chips)
  const close = el('button', 'icon-button', '✕')
  close.type = 'button'
  close.dataset.close = ''
  close.title = 'Close'
  close.setAttribute('aria-label', 'Close')
  head.append(sign, names, close)
  return head
}

// calmwindow:start
/** B269: the card picked and the note per ask of a calm window, until it is sent; they stay in this page only. */
const calmPicks = new Map()
const calmWords = new Map()

/** B269: an ask's pictures and its play link as links under the question: a picture opens here, Play it in a new tab. */
function askLinks(need) {
  const nodes = need.pictures.map(path => {
    const open = el('button', 'handover-link', `See the picture: ${pictureWords(path)}`)
    open.type = 'button'
    open.dataset.zoom = path
    open.dataset.caption = pictureWords(path)
    open.title = `Opens the picture here: ${path}`
    return open
  })
  const play = storeAskParts(need)?.play ?? null
  if (play !== null && board?.hasGame !== false) {
    const link = el('a', 'handover-link', '▶  Play it')
    link.href = play
    link.target = '_blank'
    link.rel = 'noreferrer noopener'
    link.title = 'Starts the game with this work in a new tab, where the change shows.'
    nodes.push(link)
  }
  return nodes
}

/**
 * B269: what the calm window folds behind one line: the step the ask is about as the work store holds it (its
 * Summary and what we build), who asked when and what waits on it, and its pictures large. Nothing the person needs
 * is lost: it is one click away.
 */
function calmContext(need, state) {
  const item = need.of === null ? null : itemFor({ id: need.of }, state)
  const about = item === null ? [] : itemPartsOf(item, false).filter(part => part.key === 'summary' || part.key === 'what').map(part => itemPart(part, null))
  const parts = storeAskParts(need)
  return [
    need.of === null ? null : section('The step', [el('p', '', standingOf(need).line)]),
    ...about,
    section('Asked', [
      el('p', '', `${need.from ?? 'The board'} asked${need.at === null ? '' : ` at ${clock(need.at)}`} (${parts?.id ?? need.id}).`),
      parts?.blocks === null || parts?.blocks === undefined ? null : el('p', 'muted', capitalized(parts.blocks)),
    ].filter(part => part !== null)),
    need.pictures.length === 0 ? null : section('References', drawReferences(need.pictures.map(path => ({ path, caption: pictureWords(path) })))),
  ].filter(part => part !== null)
}

/** B269: the Send button's words for the asks of a calm window: how many have an answer to go. */
function calmSendText(group) {
  const given = group.filter(one => calmAnswer(one, calmPicks.get(one.id) ?? null, calmWords.get(one.id) ?? '') !== null).length
  return sendLabel(group.length, given)
}

/** B269: the calm window of an ask of the work store (see `isCalm`). */
function drawCalm(box, need, state) {
  const now = state.readAt
  const group = calmGroup(need, everyNeed(state))
  const at = Math.max(0, group.indexOf(need))
  const pick = calmPicks.get(need.id) ?? null
  // Only while it stays open: a window opened anew starts at its top, folded.
  const wasAt = box.open && box.dataset.calmAt === need.id
  // Drawn anew on the same question: the caret where it was, the scroll and the fold as they were.
  const active = document.activeElement
  const typing = wasAt && box.contains(active) && active.matches('[data-calm-words]') ? [active.selectionStart, active.selectionEnd] : null
  const scroll = wasAt ? box.querySelector('.details-body')?.scrollTop ?? 0 : 0
  const wasUnfolded = wasAt && box.querySelector('.calm-context')?.open === true

  // The head: who asks and since when; nothing else.
  const head = el('header', 'details-head calm-head')
  const names = el('div', 'details-names')
  const tag = storeAskParts(need)?.tag ?? KINDS[need.kind].tag
  names.append(el('h2', '', `${need.from ?? 'The board'} needs your answer`), el('p', 'calm-sub', [tag, need.at === null ? null : `Asked ${ago(need.at, now)}`].filter(Boolean).join(' · ')))
  const close = el('button', 'icon-button', '✕')
  close.type = 'button'
  close.dataset.close = ''
  close.title = 'Close'
  close.setAttribute('aria-label', 'Close')
  head.append(el('span', `kind is-${need.kind}`, KINDS[need.kind].sign), names, close)

  const main = el('div', 'details-main calm-main')
  // The step in one line, whether the chat waits under it; a click opens the folded context.
  const standing = standingOf(need)
  const step = el('button', 'calm-step')
  step.type = 'button'
  step.dataset.calmContext = ''
  step.title = 'Shows the context'
  const words = el('span', 'calm-step-words')
  if (standing.line !== '') words.append(el('span', 'calm-step-line', standing.line))
  words.append(el('span', 'calm-step-more', standing.more))
  step.append(el('span', 'calm-step-sign', '≡'), words, el('span', 'calm-chevron', '›'))
  main.append(step)

  // The question: its title, the why and the advice under it, its links.
  const part = el('div', 'calm-item')
  const ask = el('div', 'calm-ask')
  if (group.length > 1) ask.append(el('p', 'calm-count', `Question ${at + 1} of ${group.length}`))
  const { question, rest } = splitAsk(need.question ?? need.title)
  // B397: its ids and the pages it names are links, and an ask it points to stands inline.
  const title = el('h3', 'calm-question')
  title.append(...linkedWords(capitalized(question), state))
  title.tabIndex = -1
  ask.append(title)
  const why = [rest, need.text].filter(one => one !== '').join('\n')
  if (why !== '') {
    const words = el('p', 'calm-why')
    words.append(...linkedWords(why, state))
    ask.append(words)
  }
  ask.append(...pointedAskBox(need, state))
  const links = askLinks(need)
  if (links.length > 0) {
    const row = el('div', 'calm-links')
    row.append(...links)
    ask.append(row)
  }
  part.append(ask)

  // The answers as large cards; the advised one says so.
  const cardList = cardsOf(need)
  if (cardList.length > 0) {
    // Toggle buttons: a click picks the card, a second click takes the pick back.
    const cards = el('div', 'calm-cards')
    cards.setAttribute('role', 'group')
    cards.setAttribute('aria-label', group.length > 1 ? `Your answer to question ${at + 1}` : 'Your answer')
    for (const card of cardList) {
      const button = el('button', `calm-card${pick === card.verdict ? ' is-chosen' : ''}`)
      button.type = 'button'
      button.dataset.calmPick = card.verdict
      button.setAttribute('aria-pressed', String(pick === card.verdict))
      const cardTitle = el('span', 'calm-card-title')
      if (card.key !== null) cardTitle.append(el('span', 'calm-key', card.key))
      cardTitle.append(el('span', '', capitalized(card.title)))
      if (card.isAdvised) cardTitle.append(el('span', 'calm-advised', 'Recommended'))
      const cardWords = el('span', 'calm-card-words')
      cardWords.append(cardTitle)
      if (card.text !== '') cardWords.append(el('span', 'calm-card-text', capitalized(card.text)))
      button.append(el('span', 'calm-dot'), cardWords)
      cards.append(button)
    }
    part.append(cards)
  }

  // Everything else, folded behind one line; its own fold, so no other window opens it.
  const context = el('details', 'calm-context')
  context.open = wasUnfolded
  context.append(el('summary', '', 'View context'), ...calmContext(need, state))

  const note = el('label', 'calm-note')
  const area = el('textarea')
  area.rows = 3
  area.maxLength = state.maxMessageChars ?? 2000
  area.value = calmWords.get(need.id) ?? ''
  area.placeholder = 'Your thoughts, questions or context…'
  area.dataset.calmWords = ''
  note.append(el('span', 'calm-note-label', noteLabel(need, pick)), area)
  part.append(context, note)
  main.append(part)

  // The foot: Cancel, Back and Next between the questions, one Send at the end.
  const foot = el('footer', 'details-foot calm-foot')
  const form = el('div', 'calm-answer')
  // What held the answers back (only here), else what the store refused.
  const problem = group.map(one => problems.get(`calm:${one.id}`) ?? problems.get(one.id)).find(one => one !== undefined)
  if (problem !== undefined) form.append(el('p', 'problem', problem))
  const buttons = el('div', 'calm-buttons')
  const button = (label, className) => {
    const node = el('button', `button ${className}`, label)
    node.type = 'button'
    return node
  }
  const cancel = button('Cancel', 'is-quiet')
  cancel.dataset.close = ''
  cancel.title = 'Closes the window; your answers stay here until you send them.'
  buttons.append(cancel)
  if (at > 0) {
    const back = button('Back', 'is-quiet')
    back.dataset.calmGo = group[at - 1].id
    buttons.append(back)
  }
  if (at < group.length - 1) {
    const next = button('Next', 'is-next')
    next.dataset.calmGo = group[at + 1].id
    buttons.append(next)
  } else {
    // B402: a spinner while it goes; free again after any reply.
    // B483: after a send that did not go, the button says to try again.
    const shown = calmSendView(group, sending, problem?.startsWith('Not sent:') ? 'Try again' : calmSendText(group))
    const send = button(shown.text, 'is-send')
    if (shown.isBusy) send.prepend(el('span', 'calm-spinner'))
    send.dataset.calmSend = ''
    send.disabled = shown.isDisabled
    send.title = `Goes to ${need.from ?? 'the board'}`
    buttons.append(send)
  }
  form.append(buttons)
  foot.append(form)

  const body = el('div', 'details-body is-single calm-body')
  body.append(main)
  box.classList.add('is-calm')
  box.dataset.calmAt = need.id
  fill(box, [head, body, foot])
  body.scrollTop = scroll
  // Focus: back in the note while typing; else where the last step asks for it (see `calmFocus`).
  const focus = typing === null ? calmFocus : null
  calmFocus = null
  if (typing !== null) {
    area.focus()
    area.setSelectionRange(...typing)
  } else if (focus === 'words') area.focus()
  else if (focus === 'question') title.focus()
  else if (focus === 'pick') (box.querySelector('.calm-card') ?? area).focus()
  else if (typeof focus === 'string' && focus.startsWith('pick:')) [...box.querySelectorAll('[data-calm-pick]')].find(one => one.dataset.calmPick === focus.slice(5))?.focus()
}

/** B269: where the calm window puts the focus when it is drawn next: 'question', 'words', 'pick', or `pick:<verdict>`. */
let calmFocus = null
// calmwindow:end

// calmsend:start
/**
 * B269: Send in the calm window: every answer given in it goes to the work store, which wakes the chat. A No without
 * words, or words on a look without a pick, is not sent: the window shows that question and says why. Questions left
 * without an answer stay open on the board. Sent without a problem, the window closes.
 */
/** B402: whether a calm window's answers are going: no refresh closes it meanwhile (see `isAnsweredElsewhere`). */
let calmBusy = false

async function sendCalm(id) {
  const need = findNeed(id)
  if (board === null || need === undefined) return
  const group = calmGroup(need, everyNeed(board))
  // Whether the window still shows these asks: the person may close it, or open another, while the answers go.
  const isShowing = () => detailsOf !== null && group.some(one => one.id === detailsOf.need)
  const show = (at, focus) => {
    if (!isShowing()) return
    detailsOf = { ...detailsOf, need: at }
    calmFocus = focus
  }
  for (const one of group) {
    problems.delete(one.id)
    problems.delete(`calm:${one.id}`)
  }
  const plan = calmPlan(group, at => calmPicks.get(at) ?? null, at => calmWords.get(at) ?? '')
  if (plan.lacks !== undefined) {
    show(plan.lacks, plan.what === 'words' ? 'words' : 'pick')
    return fail(`calm:${plan.lacks}`, plan.what === 'words' ? 'Say in the note why No: the chat needs to know what to change.' : 'Pick an answer first.')
  }
  if (plan.none !== undefined) {
    show(plan.none, 'pick')
    return fail(`calm:${plan.none}`, 'Pick an answer first.')
  }
  // B402: the button turns to a spinner at once, while the answers go.
  for (const { need } of plan.send) sending.add(need.id)
  detailsShown = null
  drawDetails(board)
  calmBusy = true
  try {
    return await sendEach(plan.send, show, isShowing)
  } catch (error) {
    // B483: whatever fails on the page, the button never stays "Sending…": the window says why, with Try again.
    for (const { need } of plan.send) sending.delete(need.id)
    const [first] = plan.send
    problems.set(first.need.id, `Not sent: the page failed (${error?.message ?? error}); reload it and try again`)
    show(first.need.id, 'question')
    detailsShown = null
    if (isShowing()) drawDetails(board)
  } finally {
    calmBusy = false
  }
}

/** B402: the answers of one Send, one after the other; see `sendCalm`. */
async function sendEach(toSend, show, isShowing) {
  const sent = []
  for (const { need, answer } of toSend) {
    // B402: not the whole board read again before the window closes: that held the greyed button for long.
    await sendWork({ action: 'answer', id: need.workId, ...answer }, need.id, { reread: false })
    // Answered or withdrawn meanwhile (in its chat, or on its card): nothing to send any more; the rest go on.
    if (isGoneAlready(problems.get(need.id))) problems.delete(need.id)
    else if (problems.has(need.id)) {
      // It did not go: the window shows it, with why, while it still shows these asks; the rest wait for another Send.
      for (const one of toSend) sending.delete(one.need.id)
      show(need.id, 'question')
      detailsShown = null
      if (isShowing()) drawDetails(board)
      return read()
    }
    else sent.push(need)
    calmPicks.delete(need.id)
    calmWords.delete(need.id)
  }
  // B402: saved: the window closes, a toast says where the answers went (none when all were answered elsewhere
  // meanwhile), and the board is read again.
  if (isShowing()) closeDetails()
  if (sent.length > 0) showToast(sentToast(sent))
  return read()
}
// calmsend:end

/** B151: the window of a working lane (see `laneWindowOf` and `LANE_PARTS`). */
function drawLaneWindow(box, lane, state) {
  const view = laneWindowOf(lane, state.readAt, state.workers?.mainTitle ?? 'the main chat')
  const showing = JSON.stringify([detailsOf, view])
  if (box.open && detailsShown === showing) return
  detailsShown = showing
  const scroll = box.querySelector('.details-body')?.scrollTop ?? 0
  const left = el('div', 'details-main')
  left.append(...LANE_PARTS.main.map(part => part(view, lane)).filter(part => part !== null))
  const right = el('div', 'details-side')
  right.append(...LANE_PARTS.side.map(part => part(view, lane)).filter(part => part !== null))
  const body = el('div', `details-body${right.children.length === 0 ? ' is-single' : ''}`)
  body.append(left, ...(right.children.length === 0 ? [] : [right]))
  box.classList.remove('is-calm')
  delete box.dataset.calmAt
  keepUnfolded(box, () => fill(box, [detailsHead(view, el('span', 'kind is-working', '▶'), state.readAt), body]))
  body.scrollTop = scroll
}

/** What the details are about: a request by its id, a queued step by its lane and place, or a working lane's task (B151). */
let detailsOf = null
let detailsShown = null

function subjectOf(state) {
  if (detailsOf === null) return null
  if (detailsOf.need !== undefined) {
    const need = everyNeed(state).find(one => one.id === detailsOf.need)
    return need === undefined ? null : { need, lane: null, place: -1 }
  }
  if (detailsOf.partnerAsk !== undefined) {
    // A question that is with the partner: it has no card among the ones for you. It closes once the partner answered it.
    const ask = (state.withPartner ?? []).find(one => one.id === detailsOf.partnerAsk)
    return ask === undefined ? null : { partnerAsk: ask }
  }
  if (detailsOf.step !== undefined) {
    // A step of the backlog by its key (the Coordinate tab): whatever its state, with the worker it names.
    const step = (state.backlog ?? []).flatMap(activity => activity.steps).find(one => one.key === detailsOf.step)
    return step === undefined ? null : { need: null, lane: state.chats.find(one => one.name === step.worker) ?? null, place: -1, step }
  }
  if (detailsOf.task === true) {
    const lane = state.chats.find(one => one.name === detailsOf.lane)
    // A lane that stopped working has no such window: it closes.
    return lane === undefined || laneWindowOf(lane, state.readAt, '') === null ? null : { laneTask: lane }
  }
  const lane = state.chats.find(one => one.name === detailsOf.lane)
  // A queued step is followed by its id when it has one, so the details stay on it when the queue moves.
  const place = lane === undefined ? -1 : detailsOf.id === null ? detailsOf.place : lane.queue.findIndex(step => step.id === detailsOf.id)
  return lane === undefined || lane.queue[place] === undefined ? null : { need: null, lane, place }
}

function copyRow(sign, text) {
  const row = el('div', 'copy-row')
  const button = el('button', 'copy', 'Copy')
  button.type = 'button'
  button.dataset.copy = text
  button.title = 'Copy to the clipboard'
  row.append(el('span', 'muted', sign), el('span', 'copy-text', text), button)
  return row
}

function section(title, children) {
  const box = el('section', 'details-part')
  box.append(el('h3', '', title), ...children)
  return box
}

/** The notes under a step: its own words first, then the named sections. "Context" goes to the side column. */
function noteParts(notes) {
  const isContext = part => part.title !== null && /context/i.test(part.title)
  const draw = part => {
    const nodes = part.lines.map(line => el('p', '', line))
    if (part.points.length > 0) {
      const list = el('ul')
      for (const point of part.points) list.append(el('li', '', point))
      nodes.push(list)
    }
    return nodes
  }
  return {
    lead: notes.filter(part => part.title === null).flatMap(draw),
    named: notes.filter(part => part.title !== null && !isContext(part)).map(part => section(part.title, draw(part))),
    context: notes.filter(isContext).flatMap(draw),
  }
}

/** B296: the flow of the step a window shows: a Backlog tab's step carries it; another is found by its id. */
function flowFor(step, need, state) {
  if (step !== null && step.flow !== undefined) return step.flow
  const id = step?.id ?? (need !== null && isStep(need) ? need.step ?? null : null)
  if (id === null) return null
  return (state.backlog ?? []).flatMap(activity => activity.steps).find(one => one.id === id)?.flow ?? null
}

/** B296: the strip of states, the step's own marked, and the moves out of it. */
function flowPart(strip) {
  const row = el('ol', 'flow-strip')
  for (const one of strip.states) row.append(el('li', `flow-state is-${one.tone}`, one.name))
  const parts = [row]
  if (!strip.isKnown) parts.push(el('p', 'warn', `It is "${strip.state}", a state the flow file does not know.`))
  if (strip.next.length > 0) parts.push(el('p', 'muted flow-next', `Next: ${strip.next.join(' · ')}`))
  return section('Flow', parts)
}

function drawDetails(state) {
  const box = $('details')
  const subject = subjectOf(state)
  // B402: a calm window whose ask was answered elsewhere closes, instead of staying as if unsent.
  if (subject !== null && box.open && !calmBusy && isAnsweredElsewhere(box.dataset.calmAt, subject.need)) {
    closeDetails()
    return
  }
  if (subject === null) {
    // What it was about is gone: answered, closed, or handed out.
    if (box.open) box.close()
    detailsOf = null
    return
  }
  if (subject.laneTask !== undefined) return drawLaneWindow(box, subject.laneTask, state)
  if (subject.partnerAsk !== undefined) return drawPartnerAskWindow(box, subject.partnerAsk, state)
  const { need, lane, place } = subject
  const step = subject.step ?? (need === null ? lane.queue[place] : null)
  const now = state.readAt
  // B701: a step that was taken opens on its Summary, with the checks, the history and the settings behind tabs; before
  // that (new, refined, queued) the Backlog tab's refine is its window.
  const taskItem = need === null ? itemFor(subject.step ?? step ?? null, state) : isStep(need) ? itemFor({ id: need.step }, state) : null
  const isTask = isTaskStep(taskItem)
  const taskAsks = isTask ? taskAsksOf(taskItem.id, everyNeed(state), taskGuardAsk(taskItem, state.focus)) : []
  // Drawn again only when what it shows has changed, so reading and typing in it are left alone.
  // B269: a calm window also follows the other asks it goes through.
  const calmIds = isCalm(need) ? calmGroup(need, everyNeed(state)).map(one => one.id) : null
  // B397: and the ask it points to, shown inline.
  const pointed = need !== null && !isStep(need) ? pointedAsk(need, everyNeed(state)) : null
  const showing = JSON.stringify([detailsOf, need ?? subject.step ?? [lane.name, lane.queue], [...chosen], [...problems], [...sending], [...starting], runningData(state), state.changeAsks ?? null, state.advisor?.name ?? null, calmIds, pointed, need === null ? null : nudged.get(need.id) ?? null, isTask ? [taskItem, taskAsks.map(one => [one.id, one.question ?? one.title, one.options, one.advice])] : null])
  if (box.open && detailsShown === showing) return
  detailsShown = showing
  const focused = focusedNeed(box)
  // B233: the Refine field the person is typing in, to give its focus back after the window is drawn anew.
  const typing = box.contains(document.activeElement) ? document.activeElement.dataset?.refineField ?? null : null
  const scroll = box.querySelector('.details-body')?.scrollTop ?? 0

  // The head: what it is and whose it is. Nothing about a queue: the window is about the step itself.
  const view = windowOf(
    { need, step, lane: lane?.name ?? step?.worker ?? null, isStep: need !== null && isStep(need), isClosed: need !== null && isClosed(need) },
    { ask: asks => ASKS[asks] ?? 'Not sorted', kind: kind => KINDS[kind].tag },
  )
  // B269: an ask of the work store gets the calm window.
  if (isCalm(need)) return drawCalm(box, need, state)
  if (isTask) return drawTaskWindow(box, { state, need, lane, subject, step, item: taskItem, asks: taskAsks, strip: flowStripOf(flowFor(subject.step ?? step ?? null, need, state)), scroll, focused })
  box.classList.remove('is-calm')
  delete box.dataset.calmAt
  const head = detailsHead(view, el('span', `kind is-${need === null ? 'queued' : need.kind}`, need === null ? '≡' : KINDS[need.kind].sign), now)

  // The left column, the wider one: what it is about and what to look at
  // B299: a step of the store shows its Touches in the item's folded part, not a second time among the notes.
  const itemNow = need === null ? itemFor(subject.step ?? step ?? null, state) : null
  const notes = noteParts((itemNow?.touches.length ?? 0) > 0 ? view.notes.filter(note => note.title !== 'Touches') : view.notes)
  // A request a chat filed has its own text. A step of the backlog is one line, which is the title above; what
  // describes it further are the lines written under it.
  // B397: an ask's ids and the pages it names are links, and an ask it points to stands inline.
  const asked = need !== null && !isStep(need)
  const words = []
  if (asked && need.text !== '') {
    const text = el('p')
    text.append(...linkedWords(need.text, state))
    words.push(text)
  }
  if (asked) words.push(...pointedAskBox(need, state))
  // The step's own line in full: the title above is the short of it.
  const full = need !== null && isStep(need) && typeof need.words === 'string' && need.words !== need.title ? [el('p', '', need.words)] : []
  const described = [...words, ...full, ...notes.lead]
  const left = el('div', 'details-main')
  // B100: a worker that waits: its task in a few lines, then what it wants, in place of a description.
  const waiting = waitingOf(need, now)
  const waitingShown = waiting === null ? null : waitingParts(waiting, need.id)
  // B533: a hint's window opens with the card's own words and links, then the chat's answer it is about; its buttons
  // stand at the window's foot (answerPart).
  if (waiting?.isHint === true) left.append(section('What the board found', words))
  if (waitingShown !== null) left.append(...waitingShown.main)
  // B94: "nothing more is written" only when nothing is: a step whose lines are its checklist and its context
  // has them on the right.
  // B296: where the step stands in the flow (flow.json), from the work store.
  const strip = flowStripOf(flowFor(subject.step ?? step ?? null, need, state))
  // B299: a step's window shows its item from the work store: Summary, picture, goal, the strip, What we
  // build, Requirements and Touches folded; its History comes last.
  const itemParts = itemPartsOf(itemNow, strip !== null, { lanes: state.chats ?? [], efforts: state.taskTimes?.efforts ?? [] })
  const isItemShown = itemParts.length > 0
  // B233: a step of the Backlog tab: what refining it says, with the person's answers and feedback. B293: without
  // the store's item, once ready it is the step's description, first, and the step's own lines follow as its notes;
  // with the item, its Summary, picture and What we build stand above, and the refine part holds the questions. A
  // step in a worker's queue shows its refine to read; it is answered in its window on the Backlog tab.
  const refined = subject.step?.refined ?? (need === null ? step?.refined ?? null : null)
  const refine = subject.step !== undefined ? refinePart(subject.step, state, isItemShown)
    : refined !== null && !isItemShown ? refineToRead(refined) : null
  const isReady = refine?.classList.contains('is-ready') === true
  // A refine with a summary describes the step: no "nothing more is written" above it.
  const isSummed = isReady || (refine !== null && (refined?.summary ?? '') !== '')
  // B293: a refine's goal stands in the head already, as its chip: not a second time here.
  const isGoalInHead = (refined?.partOf ?? '') !== ''
  if (isItemShown) left.append(...itemParts.filter(part => part.key !== 'history' && !(part.key === 'goal' && isGoalInHead)).map(part => itemPart(part, strip)))
  // Your words (2026-10-30): "Add a note" on a step of the store without words of the person's yet (with them, it stands in their part).
  if (isItemShown && !itemParts.some(part => part.key === 'yourwords')) left.append(...yourWordsNodes(itemNow.id, []))
  if (!isItemShown) {
    if (isReady) left.append(refine)
    if (waiting !== null) { /* said above */ } else if (described.length > 0) left.append(section(isReady ? 'Notes' : 'Description', described))
    else if (!view.hasNotes && !isSummed) left.append(section('Description', [el('p', 'muted', 'Nothing more is written about it. Lines under the task in the backlog show here.')]))
    if (strip !== null) left.append(flowPart(strip))
  }
  if (refine !== null && !isReady) left.append(refine)
  left.append(...notes.named)
  if (need !== null && need.tried.length > 0) left.append(section('Already tried', [listOf(need.tried)]))
  // B293: the refine's picture shows in it, not a second time here.
  const refinedPicture = refined?.picture?.path ?? null
  const shown = need === null ? step.pictures.filter(path => path !== refinedPicture).map(path => ({ path, caption: '' })) : [
    ...need.options.filter(option => option.picture !== null).map(option => ({ path: option.picture, caption: `${option.label}${option.isRecommended ? ' (recommended)' : ''}` })),
    ...need.pictures.map(path => ({ path, caption: '' })),
  ]
  if (shown.length > 0) left.append(section('References', drawReferences(shown)))
  const history = itemParts.find(part => part.key === 'history')
  if (history !== undefined) left.append(itemPart(history, strip))

  // The right column: where its files lie, and what to check. Only what the step really has.
  const right = el('div', 'details-side')
  const branch = need === null ? step.branch : need.branch ?? need.run?.branch ?? null
  const folder = branch === null ? null : [...state.chats.flatMap(one => one.folders), ...state.otherFolders].find(one => one.branch === branch) ?? null
  const files = []
  // The folders the pictures lie in, to open by hand.
  for (const path of new Set(shown.map(one => one.path.split('/').slice(0, -1).join('/')))) files.push(copyRow('Folder', path))
  if (folder !== null) files.push(copyRow('Folder', folder.path))
  if (branch !== null) files.push(copyRow('Branch', branch))
  if (folder !== null) files.push(el('p', 'muted', folderLine(folder, now)))
  if (need !== null) files.push(...gameParts(need))
  // B149: a worker's closing block, formatted, first on the right.
  if (waitingShown !== null) right.append(...waitingShown.side)
  if (files.length > 0) right.append(section('Files / Branch', files))
  if (view.checklist.length > 0) {
    const part = section('Checklist', [drawChecklist(need === null ? `step:${view.code ?? view.title}` : need.id, view.checklist)])
    part.querySelector('h3').append(el('small', 'muted', 'optional'))
    right.append(part)
  }
  if (notes.context.length > 0) {
    const context = el('div', 'box')
    context.append(...notes.context)
    right.append(section('Additional context', [context]))
  }

  // The foot: the answer, with the form of its kind. The feedback on the left, the buttons on the right. It is the
  // same answer as on the card: what is typed in one shows in the other. A queued step takes no answer.
  const foot = el('footer', 'details-foot')
  if (need !== null) {
    const form = el('div', `need is-${need.kind} details-answer`)
    form.dataset.id = need.id
    form.append(...optionChoices(need), ...answerPart(need, state, false, true))
    foot.append(form)
  }
  // Redesign Part 2: a new or refined task of the Backlog tab: "Pin to" a worker in its foot (the Backlog tab's blocks of
  // 2026-10-25: only here; its row has "Add to queue").
  const pin = need === null && subject.step !== undefined ? pinPart(subject.step, state) : null
  if (pin !== null) foot.append(pin)
  // Redesign Part 2: a task in a worker's queue: pinned, it moves to another worker or is unpinned; given, it says so.
  const change = need === null && subject.step === undefined && lane !== null && lane !== undefined ? pinChangePart(lane, step, state) : null
  if (change !== null) foot.append(change)
  // B233: Refine; B293: Send answers and Take the advice, or Refine again.
  const refineFoot = subject.step !== undefined ? refineButtons(subject.step, state) : null
  if (refineFoot !== null) foot.append(refineFoot)
  // B221: a step of the Backlog tab can be closed or deleted from its window.
  const edit = subject.step !== undefined ? editPart(subject.step, true) : null
  if (edit !== null) foot.append(edit)

  const body = el('div', `details-body${right.children.length === 0 ? ' is-single' : ''}`)
  body.append(left, ...(right.children.length === 0 ? [] : [right]))
  // B157: a finished worker's window drawn anew keeps its details open when the person had opened them.
  keepUnfolded(box, () => fill(box, foot.children.length === 0 ? [head, body] : [head, body, foot]))
  body.scrollTop = scroll
  refocus(box, focused)
  const field = typing === null ? null : [...box.querySelectorAll('[data-refine-field]')].find(one => one.dataset.refineField === typing)
  if (field) {
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }
}

// B701: the window of a step that was taken: a Summary in plain words, with the checks, the history and the settings
// behind tabs (see `summaryOf`). The tab is part of what the window is about (`detailsOf.tab`), so a window opened anew
// starts on its Summary.

/** B701: a picture with a bold word and what it shows ("Target · what it should look like"). */
function taskFigure(path, word, detail) {
  const figure = el('figure')
  const caption = el('figcaption')
  caption.append(el('b', '', word))
  if (detail !== '') caption.append(` · ${detail}`)
  const frame = picture(path, detail === '' ? word : `${word} · ${detail}`)
  figure.append(frame, caption)
  // B713: a picture keeps its own shape: the figure is as wide as its picture is wide for its height, so pictures side by side
  // are as tall as each other and none has a bar or a cut edge.
  const image = frame.querySelector('img')
  image.addEventListener('load', () => {
    const shape = image.naturalWidth / Math.max(1, image.naturalHeight)
    figure.style.flexGrow = String(Math.round(shape * 100))
    figure.style.maxWidth = `${Math.round(shape * TASK_PICTURE_HEIGHT)}px`
    figure.dataset.shape = shape.toFixed(3)
  })
  return figure
}

/** B713: the tallest a picture of the Summary grows alone (px); its figure is never wider than this height gives it. */
const TASK_PICTURE_HEIGHT = 520

/** B701: a line closed with a full stop, unless it ends with one already (or was cut short). */
const endOf = text => (/[.!?…]$/.test(text) ? text : `${text}.`)

/** B701: a titled part of the Summary, its words as short paragraphs. */
function taskPart(title, nodes) {
  const part = el('section', 'task-part')
  part.append(el('h3', '', title), ...nodes)
  return part
}

/** B701: where a step stands, in a line, for a Summary that has no check to tell it. */
function taskStanding(item) {
  const owner = item.owner ?? 'its worker'
  if (item.state === 'done') return 'It is done.'
  if (item.state === 'dropped') return 'It was dropped.'
  if (item.state === 'review') return 'It is built and waits for its check.'
  if (item.state === 'waiting on you') return `${owner} waits for your answer.`
  return `${owner} is working on it.`
}

/** B701: the options of an open question: cards to click, the advised one marked, a box for an idea of your own, and Send. */
function taskOptions(need, isGuard) {
  const part = el('section', 'task-part task-options')
  part.dataset.ask = need.id
  part.append(el('h3', '', 'Options'))
  // B706: the question the cards answer stands above them, always (the guard's card was Yes / No alone).
  part.append(el('p', 'task-question', taskQuestion(need, isGuard)))
  const pick = calmPicks.get(need.id) ?? null
  const cards = el('div', 'task-cards')
  cards.setAttribute('role', 'group')
  for (const card of cardsOf(need)) {
    const button = el('button', `task-card${pick === card.verdict ? ' is-chosen' : ''}${card.isAdvised ? ' is-advised' : ''}`)
    button.type = 'button'
    button.dataset.taskPick = card.verdict
    button.setAttribute('aria-pressed', String(pick === card.verdict))
    const words = el('span', 'task-card-words')
    const title = el('b', '', capitalized(card.title))
    if (card.isAdvised) title.append(el('span', 'task-advised', 'advised'))
    words.append(title)
    if (card.text !== '') words.append(el('small', '', capitalized(card.text)))
    button.append(el('span', 'task-letter', card.key ?? ''), words)
    cards.append(button)
  }
  const area = el('textarea')
  area.rows = 3
  area.placeholder = 'Or your own idea…'
  area.dataset.taskWords = need.id
  area.value = calmWords.get(need.id) ?? ''
  const problem = problems.get(`calm:${need.id}`) ?? problems.get(need.id)
  const shown = calmSendView([need], sending, problem?.startsWith('Not sent:') ? 'Try again' : 'Send')
  const send = el('button', 'task-send', shown.text)
  send.type = 'button'
  send.disabled = shown.isDisabled
  send.dataset.taskSend = need.id
  const row = el('div', 'task-send-row')
  if (problem !== undefined) row.append(el('p', 'problem', problem))
  row.append(send)
  part.append(...(cards.children.length === 0 ? [] : [cards]), area, row)
  return part
}

/** Your words: the note the person is writing per step (its id), kept while the window is drawn anew. */
const noteDrafts = new Map()

/**
 * Your words (the person, 2026-10-30: "I like it to retain the feedback i gave it so when i tries to suggest new ways to
 * accomplish what i want it can verify what i originally asked"): the points of a step's "Your words", newest last, each
 * its head, what it answered and the person's words; then "Add a note" for a step with an id.
 */
function yourWordsNodes(id, points) {
  const nodes = []
  if ((points ?? []).length > 0) {
    const list = el('ol', 'your-words')
    for (const row of yourWordsRows(points)) {
      const point = el('li', 'your-word')
      point.append(el('p', 'your-word-head', row.head))
      if (row.context !== '') point.append(el('p', 'muted your-word-context', row.context))
      if (row.pictures.length > 0) {
        const pictures = el('div', 'your-word-pics')
        for (const path of row.pictures) pictures.append(picture(path, 'What you were shown'))
        point.append(pictures)
      }
      point.append(el('p', 'your-word-text', row.words))
      list.append(point)
    }
    nodes.push(list)
  }
  if (typeof id === 'string' && /^B\d+$/.test(id)) nodes.push(addNotePart(id))
  return nodes
}

/** Your words: "Add a note" folded under the points: the person's words go on the step (the work API's `words`). */
function addNotePart(id) {
  const key = `words:${id}`
  const fold = el('details', 'item-fold your-words-add')
  fold.open = noteDrafts.has(id) || problems.has(key) || sending.has(key)
  fold.append(el('summary', '', 'Add a note'))
  const area = el('textarea')
  area.rows = 3
  area.placeholder = 'Your words on this task: every chat on it reads them before it asks or reports'
  area.dataset.wordsText = id
  area.value = noteDrafts.get(id) ?? ''
  const send = el('button', 'task-send', sending.has(key) ? 'Adding…' : 'Add note')
  send.type = 'button'
  send.dataset.wordsSend = id
  send.disabled = sending.has(key)
  const row = el('div', 'task-send-row')
  if (problems.has(key)) row.append(el('p', 'problem', problems.get(key)))
  row.append(send)
  fold.append(area, row)
  return fold
}

/** Your words: the click on "Add note": the words go to the step, and the window shows them as its newest point. */
async function sendWords(id) {
  const key = `words:${id}`
  const text = (noteDrafts.get(id) ?? '').trim()
  if (text === '') problems.set(key, 'Write your note first.')
  else {
    problems.delete(key)
    const problem = await sendWork({ action: 'words', id, text, where: 'on the board' }, key)
    if (problem === null) noteDrafts.delete(id)
  }
  detailsShown = null
  if (board !== null && detailsOf !== null) drawDetails(board)
}

/** B701: the Summary tab: only the parts that have something to say. */
function taskSummary(item, asks, guardAsk) {
  const view = summaryOf(item)
  const parts = []
  // Your words (2026-10-30): the person's words on the step stand first; without any, only "Add a note", last.
  const words = item.yourWords ?? []
  if (words.length > 0) parts.push(taskPart('Your words', yourWordsNodes(item.id, words)))
  if (view.want.length > 0) parts.push(taskPart('What we want', view.want.map(one => el('p', '', one))))
  const pictures = el('div', 'task-pics')
  if (view.target !== null) pictures.append(taskFigure(view.target, 'Target', 'what it should look like'))
  if (view.now !== null) pictures.append(taskFigure(view.now, 'Now', 'the latest try'))
  if (pictures.children.length > 0) parts.push(pictures)
  if (view.why.length > 0) parts.push(taskPart('Why we\'re not there yet', view.why.map(one => el('p', '', one))))
  if (view.tried.length === 0) parts.push(taskPart('Where it stands', [el('p', '', taskStanding(item))]))
  else {
    const list = el('ul', 'task-tried')
    for (const one of view.tried) {
      const line = el('li')
      line.append(el('b', '', `Try ${one.n}:`), ` ${endOf(one.way)} `)
      if (one.isFailed) line.append(el('span', 'is-fail', 'Failed:'), ` ${endOf(one.result)}`)
      else line.append(el('span', 'is-pass', 'Passed.'))
      list.append(line)
    }
    parts.push(taskPart('What we tried', [list]))
    if (view.triedPictures.length > 0) {
      const tried = el('div', 'task-pics')
      for (const one of view.triedPictures) tried.append(taskFigure(one.path, one.caption.split(' · ')[0], one.caption.split(' · ').slice(1).join(' · ')))
      parts.push(tried)
    }
  }
  if (view.conclusion !== null) parts.push(taskPart('Conclusion', [el('p', '', view.conclusion)]))
  // The step's open questions, each with its own cards (the guard's, when it is about this step, among them).
  for (const need of asks) parts.push(taskOptions(need, guardAsk !== null && need.workId === guardAsk))
  if (words.length === 0) parts.push(...yourWordsNodes(item.id, []))
  return parts
}

/** B706: the latest check as one short line per point (a tick, a cross or a question mark, its first words; the whole point on hover) and its evidence picture. */
function taskCheckPart(title, checked) {
  const list = el('ul', 'checked-points task-checks')
  for (const one of taskCheckLines(checked.points)) {
    const line = el('li', `is-${one.verdict}`, `${one.mark} ${one.text}`)
    line.title = one.full
    list.append(line)
  }
  const evidence = pictureOfLine(checked.evidence ?? 'none')
  return section(title, [el('p', 'checked-head', `${checked.passed} of ${checked.total} points pass${checked.score === null || checked.score === undefined ? '' : ` · score ${checked.score}`}`), list, ...(evidence.path === null ? [el('p', 'muted', `Evidence: ${evidence.note || 'none'}`)] : [pictureRow(evidence.path, 'The evidence: the result beside its reference')])])
}

/** B701: the Checks tab: the latest check as short pass and fail lines, its evidence, the agreed points folded. */
function taskChecks(item, strip) {
  const parts = []
  // The newest check of the chain of tries the step is in, else the step's own.
  const latest = (item.tries ?? []).findLast(one => one.check !== null && (one.check.points ?? []).length > 0)
  const checked = latest === undefined ? item.checked ?? null : { passed: latest.check.passed, total: latest.check.total, score: latest.check.score, points: latest.check.points, evidence: latest.check.evidence }
  if (checked === null) parts.push(el('p', 'muted', 'No result check yet.'))
  else parts.push(taskCheckPart(latest === undefined ? 'Latest check' : `Latest check · ${latest.id}`, checked))
  if (item.what.length > 0) {
    const fold = el('details', 'item-fold')
    fold.append(el('summary', '', `Agreed points (${item.what.length})`), buildList(item.what))
    parts.push(fold)
  }
  for (const [title, lines] of [['Requirements', item.requirements], ['Touches', item.touches]]) {
    if (lines.length === 0) continue
    const fold = el('details', 'item-fold')
    fold.append(el('summary', '', `${title} (${lines.length})`), listOf(lines))
    parts.push(fold)
  }
  return parts
}

/** B701: the Settings tab: who, model and effort, the flow, where its files lie, and the buttons that change it. */
function taskSettings(item, strip, state, extra) {
  const parts = itemPartsOf(item, strip !== null, { lanes: state.chats ?? [], efforts: state.taskTimes?.efforts ?? [] })
    .filter(part => ['effort', 'flow', 'fixof'].includes(part.key)).map(part => itemPart(part, strip))
  const list = el('dl', 'task-facts')
  for (const [label, value] of [['Worker', item.owner ?? 'none'], ['State', item.state]]) list.append(el('dt', 'muted', label), el('dd', '', value))
  return [list, ...parts, ...extra]
}

/**
 * B706: the Settings tab of a taken step: worker and state, model and effort, the flow, the folder and branch, and the
 * buttons that change the step (pin or move, close, delete), which stand here out of the way.
 */
function taskSettingsTab({ item, need, subject, lane, step, strip, state }) {
  const pin = need === null && subject.step !== undefined ? pinPart(subject.step, state) : null
  const change = need === null && subject.step === undefined && lane !== null && lane !== undefined ? pinChangePart(lane, step, state) : null
  const edit = subject.step !== undefined ? editPart(subject.step, true) : null
  const branch = need === null ? step?.branch ?? null : need.branch ?? need.run?.branch ?? null
  const folder = branch === null ? null : [...state.chats.flatMap(one => one.folders), ...state.otherFolders].find(one => one.branch === branch) ?? null
  const files = [...(folder === null ? [] : [copyRow('Folder', folder.path)]), ...(branch === null ? [] : [copyRow('Branch', branch)])]
  return taskSettings(item, strip, state, [...(files.length === 0 ? [] : [section('Files / Branch', files)]), ...[pin, change, edit].filter(one => one !== null)])
}

/** B701: the window of a taken step (see above). `item` is the state's item of the step. */
function drawTaskWindow(box, { state, need, lane, subject, step, item, asks, strip, scroll, focused }) {
  const now = state.readAt
  const tab = TASK_TABS.some(([key]) => key === detailsOf.tab) ? detailsOf.tab : 'summary'
  const failed = summaryOf(item).failed
  const chips = [
    { text: capitalized(item.state), tone: item.state === 'done' ? 'good' : 'kind' },
    ...(failed > 0 ? [{ text: `${failed} check${failed === 1 ? '' : 's'} failed`, tone: 'bad' }] : []),
    ...(item.owner === null || item.owner === undefined ? [] : [{ text: item.owner, tone: 'plain' }]),
    ...(item.goal === null || item.goal === undefined ? [] : [{ text: `Goal: ${goalNameOf(item.goal, state.goals?.nodes)}`, tone: 'goal' }]),
  ]
  const head = detailsHead({ code: item.id, title: item.title, chips, at: null }, el('span', `kind is-${need === null ? 'queued' : need.kind}`, need === null ? '≡' : KINDS[need.kind].sign), now)
  // B713: the mockup's quiet chips and its one-line title (the whole title on hover).
  head.classList.add('task-head')
  head.querySelector('h2').title = item.title

  const nav = el('nav', 'task-tabs')
  for (const [key, name] of TASK_TABS) {
    const button = el('button', `task-tab${key === tab ? ' is-on' : ''}`, name)
    button.type = 'button'
    button.dataset.taskTab = key
    nav.append(button)
  }
  const content = el('div', 'task-body')
  if (tab === 'summary') content.append(...taskSummary(item, asks, taskGuardAsk(item, state.focus)))
  else if (tab === 'checks') content.append(...taskChecks(item, strip))
  else if (tab === 'history') {
    const list = el('ul', 'task-history')
    for (const line of item.history) list.append(el('li', '', line))
    content.append(...(item.history.length === 0 ? [el('p', 'muted', 'Nothing yet.')] : [list]))
  } else content.append(...taskSettingsTab({ item, need, subject, lane, step, strip, state }))
  const body = el('div', 'details-body is-single task-window')
  const main = el('div', 'details-main')
  main.append(nav, content)
  body.append(main)

  // A step that is also a request of the board keeps its answer at the foot, as before.
  const foot = el('footer', 'details-foot')
  if (need !== null) {
    const form = el('div', `need is-${need.kind} details-answer`)
    form.dataset.id = need.id
    form.append(...optionChoices(need), ...answerPart(need, state, false, true))
    foot.append(form)
  }
  const active = document.activeElement
  const typing = box.contains(active) && active.matches('[data-task-words]') ? [active.dataset.taskWords, active.selectionStart, active.selectionEnd] : null
  const sameTab = box.dataset.taskShown === `${item.id}:${tab}`
  box.classList.toggle('is-calm', false)
  delete box.dataset.calmAt
  box.dataset.taskShown = `${item.id}:${tab}`
  keepUnfolded(box, () => fill(box, foot.children.length === 0 ? [head, body] : [head, body, foot]))
  body.scrollTop = sameTab ? scroll : 0
  refocus(box, focused)
  if (typing !== null) {
    const area = [...box.querySelectorAll('[data-task-words]')].find(one => one.dataset.taskWords === typing[0])
    if (area !== undefined) {
      area.focus()
      area.setSelectionRange(typing[1], typing[2])
    }
  }
}

/** B701: Send in a step's Summary: the answer goes to the work store as in the calm window, and the window closes once sent. */
async function sendTask(id) {
  const need = findNeed(id)
  if (board === null || need === undefined) return
  const isShowing = () => detailsOf !== null
  const redraw = () => {
    detailsShown = null
    if (isShowing()) drawDetails(board)
  }
  problems.delete(id)
  problems.delete(`calm:${id}`)
  const plan = calmPlan([need], at => calmPicks.get(at) ?? null, at => calmWords.get(at) ?? '')
  if (plan.lacks !== undefined || plan.none !== undefined) {
    fail(`calm:${id}`, plan.what === 'words' ? 'Say in the box why No: the chat needs to know what to change.' : plan.lacks !== undefined ? 'Pick an option first.' : 'Pick an option, or write your own idea.')
    return redraw()
  }
  sending.add(id)
  redraw()
  calmBusy = true
  try {
    return await sendEach(plan.send, () => {}, isShowing)
  } catch (error) {
    sending.delete(id)
    problems.set(id, `Not sent: the page failed (${error?.message ?? error}); reload it and try again`)
    redraw()
  } finally {
    calmBusy = false
  }
}

$('details').addEventListener('click', event => {
  const tab = event.target.closest('[data-task-tab]')
  if (tab !== null && detailsOf !== null) {
    detailsOf = { ...detailsOf, tab: tab.dataset.taskTab }
    detailsShown = null
    return drawDetails(board)
  }
  const pick = event.target.closest('[data-task-pick]')
  if (pick !== null) {
    const id = pick.closest('[data-ask]')?.dataset.ask
    if (id === undefined) return
    calmPicks.set(id, calmPicks.get(id) === pick.dataset.taskPick ? null : pick.dataset.taskPick)
    problems.delete(`calm:${id}`)
    detailsShown = null
    return drawDetails(board)
  }
  const send = event.target.closest('[data-task-send]')
  if (send !== null) return sendTask(send.dataset.taskSend)
  // Your words: "Add note" of a step's window.
  const words = event.target.closest('[data-words-send]')
  if (words !== null && !words.disabled) sendWords(words.dataset.wordsSend)
})
$('details').addEventListener('input', event => {
  // Your words: the note being written is kept, so a window drawn anew keeps it.
  if (event.target.matches('[data-words-text]')) {
    const id = event.target.dataset.wordsText
    if (event.target.value.trim() === '') noteDrafts.delete(id)
    else noteDrafts.set(id, event.target.value)
    return
  }
  if (!event.target.matches('[data-task-words]')) return
  const id = event.target.dataset.taskWords
  calmWords.set(id, event.target.value)
  // The words came: what held the answer back is said no more.
  if (problems.delete(`calm:${id}`)) event.target.closest('.task-options')?.querySelector('.problem')?.remove()
})

/** B299: a step's item as the store holds it, for its window: from the Backlog tab's step, else found by its id. */
function itemFor(step, state) {
  if (step === null || step === undefined) return null
  if (step.item !== undefined) return step.item
  return (state.backlog ?? []).flatMap(activity => activity.steps).find(one => one.id !== null && one.id === step.id)?.item ?? null
}

/** B299: one part of a step's item in its window (see itemPartsOf). */
function itemPart(part, strip) {
  if (part.key === 'flow') return flowPart(strip)
  if (part.key === 'picture') return pictureSection(pictureOfLine(part.lines[0]))
  if (part.key === 'goal') return el('p', 'chip is-goal', `Goal: ${part.lines[0]}`)
  // B468: the five levels with the step's lit, its reason, who runs at it, and what the board kept for that level. Model
  // per step: the model families above them, the step's lit, with its reason.
  if (part.key === 'effort') {
    const models = el('div', 'effort-levels')
    for (const family of MODEL_FAMILIES) models.append(el('span', `effort-level${family === part.model?.family ? ' is-on' : ''}`, MODEL_NAMES[family]))
    const modelWhy = el('p', 'muted', part.model?.isSet ? part.model.why : 'Its refine gave no model: it counts as Sonnet.')
    const levels = el('div', 'effort-levels')
    for (const level of EFFORT_LEVELS) levels.append(el('span', `effort-level${level === part.effort.level ? ' is-on' : ''}`, level))
    const why = el('p', 'muted', part.effort.isSet ? part.effort.why : 'Its refine gave no effort: it counts as medium.')
    return section(part.title, [...((part.model ?? null) === null ? [] : [models, modelWhy]), levels, why, ...(part.run === null ? [] : [el('p', 'effort-run', part.run)]), el('p', 'muted effort-kept', part.kept)])
  }
  if (part.key === 'summary') return section('Summary', part.lines.map(one => el('p', '', one)))
  // Your words (2026-10-30): every point with what it answered, newest last, and "Add a note".
  if (part.key === 'yourwords') return section(part.title, yourWordsNodes(part.id, part.points))
  // B293: what we build as the refine shows it, "Not in it" greyed.
  if (part.key === 'what') return section('What we build', [buildList(part.lines)])
  // B356: the ticks of the result check, each point green, red or amber, and the evidence picture under them.
  if (part.key === 'checked') {
    const [head, ...points] = part.lines
    const list = el('ul', 'checked-points')
    part.checked.points.forEach((one, index) => list.append(el('li', `is-${one.verdict}`, points[index])))
    const evidence = pictureOfLine(part.checked.evidence ?? 'none')
    return section(part.title, [el('p', 'checked-head', head), list, ...(evidence.path === null ? [el('p', 'muted', `Evidence: ${evidence.note || 'none'}`)] : [pictureRow(evidence.path, 'The evidence: the result beside its reference')])])
  }
  if (part.key === 'fixof') return el('p', 'chip is-goal', `A fix of ${part.lines[0]}: done once it is checked, and ${part.lines[0]} with it`)
  if (part.isFolded) {
    const box = el('details', 'item-fold')
    box.append(el('summary', '', `${part.title} (${part.lines.length})`), listOf(part.lines))
    return box
  }
  return section(part.title, [listOf(part.lines)])
}

/** B293: the item's picture as in the refine's picture row; or why there is none. */
function pictureSection({ path, caption, note }) {
  if (path === null) return holding('section', 'details-part refined-nopicture', el('span', 'refine-tag', 'Picture'), el('p', 'muted', note === '' ? 'None.' : `None: ${note}`))
  return holding('section', 'details-part', pictureRow(path, caption))
}

/** B293: the points of what we build, "Not in it: ..." greyed. */
function buildList(points) {
  const list = el('ul', 'refined-build')
  for (const point of points) list.append(el('li', /^Not in it\b/i.test(point) ? 'is-not' : '', point))
  return list
}

/** B293: a picture as a thumbnail that opens it large, with what it shows and "Open the picture ↗" beside it. */
function pictureRow(path, caption) {
  const row = el('div', 'refined-picture')
  const open = el('button', 'refined-open', 'Open the picture ↗')
  open.type = 'button'
  open.dataset.zoom = path
  open.dataset.caption = caption
  row.append(picture(path, caption), holding('div', '', el('span', 'refine-tag', 'Picture'), el('p', '', caption === '' ? path.split('/').pop() : caption), open))
  return row
}

function listOf(lines) {
  const list = el('ul')
  for (const line of lines) list.append(el('li', '', line))
  return list
}

/** In the details the pictures are shown large on the left, so the answer only needs the options as buttons. */
function optionChoices(need) {
  if (need.options.length === 0) return []
  const choices = el('div', 'choices')
  for (const option of need.options) {
    const button = el('button', `choice${chosen.get(need.id) === option.label ? ' is-chosen' : ''}`, `${option.label}${option.isRecommended ? ' (recommended)' : ''}`)
    button.type = 'button'
    button.dataset.choose = option.label
    choices.append(button)
  }
  return [choices]
}

function openDetails(what) {
  detailsOf = what
  if (board === null) return
  drawDetails(board)
  if (detailsOf !== null && !$('details').open) $('details').showModal()
}

function closeDetails() {
  detailsOf = null
  detailsShown = null
  // B402: what the calm window showed is no longer shown (see `isAnsweredElsewhere`).
  delete $('details').dataset.calmAt
  if ($('details').open) $('details').close()
  if (location.hash.startsWith('#details=') || location.hash.startsWith('#task=')) history.replaceState(null, '', location.pathname)
}

/** B402: a short line at the foot of the page that goes by itself: "Answer sent to Digger". */
let toastTimer = null
function showToast(words) {
  const toast = $('toast')
  toast.textContent = words
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.hidden = true
  }, 4000)
}

$('details').addEventListener('click', event => {
  // A click beside the window, on the dimmed board, closes it; so does its cross and its Close button.
  if (event.target === $('details') || event.target.closest('[data-close]') !== null) return closeDetails()
  // A tick in the checklist is the person's own note: kept while the page is open.
  const tick = event.target.closest('[data-tick]')
  if (tick !== null) {
    const mine = ticked.get(tick.dataset.of) ?? new Set()
    if (tick.checked) mine.add(Number(tick.dataset.tick))
    else mine.delete(Number(tick.dataset.tick))
    ticked.set(tick.dataset.of, mine)
    return
  }
  // B269: the step line on top of the calm window opens what is folded.
  const context = event.target.closest('[data-calm-context]')
  if (context !== null) {
    const fold = $('details').querySelector('.calm-context')
    if (fold !== null) {
      fold.open = true
      fold.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    return
  }
  // B221: a step closed or deleted from its window.
  const edit = event.target.closest('[data-edit-step]')
  if (edit !== null) return editStepClick(edit)
  const copy = event.target.closest('[data-copy]')
  if (copy === null) return
  navigator.clipboard.writeText(copy.dataset.copy).then(() => { copy.textContent = 'Copied' }, () => { copy.textContent = 'Not copied' })
})
$('details').addEventListener('close', () => {
  detailsOf = null
  detailsShown = null
})

// The head of a card in the inbox, and a step in a lane's queue, open the details.
$('needs').addEventListener('click', event => {
  const head = event.target.closest('[data-details]')
  if (head !== null) openDetails({ need: head.dataset.details })
})
// B361: the head of an ask gathered under the daily note opens its window, as in Needs your attention.
$('advisor-focus').addEventListener('click', event => {
  const head = event.target.closest('.focus-asks [data-details]')
  if (head !== null) openDetails({ need: head.dataset.details })
})
$('lanes').addEventListener('click', event => {
  const step = event.target.closest('[data-step]')
  if (step === null) return
  const lane = board?.chats.find(one => one.name === step.dataset.lane)
  const place = Number(step.dataset.step)
  if (lane?.queue[place] !== undefined) openDetails({ lane: lane.name, place, id: lane.queue[place].id })
})

/** `#details=B14` in the address opens the details of that step: a link to it, and what a picture of it is taken with. */
function openFromAddress(state) {
  // B149: the links in a worker's answer: `#picture=<path>` shows that picture here, `#play=<branch>&<settings>`
  // makes this tab that branch's game, where the settings put it. Followed once.
  // B699: `#demo=<path of a demo.json>` opens that goal demo as a page.
  if (location.hash.startsWith('#demo=')) {
    const path = decodeURIComponent(location.hash.slice('#demo='.length))
    history.replaceState(null, '', location.pathname)
    openDemo(path)
    return
  }
  if (location.hash.startsWith('#picture=') || location.hash.startsWith('#play=')) {
    const hash = location.hash
    history.replaceState(null, '', location.pathname)
    if (hash.startsWith('#picture=')) {
      const path = decodeURIComponent(hash.slice('#picture='.length))
      openPicture(path, path)
    } else {
      const [branch, ...settings] = hash.slice('#play='.length).split('&')
      if (state.hasGame !== false) play(decodeURIComponent(branch), settings.join('&'), { inPlace: true })
    }
    return
  }
  // B151: `#task=Units` opens the window of that working worker's task.
  if (location.hash.startsWith('#task=') && detailsOf === null) {
    const name = decodeURIComponent(location.hash.slice('#task='.length))
    const lane = state.chats.find(one => one.name === name)
    if (lane !== undefined && laneWindowOf(lane, state.readAt, '') !== null) openDetails({ lane: name, task: true })
    return
  }
  if (!location.hash.startsWith('#details=') || detailsOf !== null) return
  openStepWindow(state, decodeURIComponent(location.hash.slice('#details='.length)))
}

/** The window of a step, an ask or a request by its id (`B14`, `Q3`): a request's own first, then its place in a lane's queue, else the step on the Backlog tab. */
function openStepWindow(state, code) {
  const need = everyNeed(state).find(one => one.step === code || one.id === code || one.workId === code)
  if (need !== undefined) return openDetails({ need: need.id })
  // A question that is with the partner has no card among the ones for you: its own window.
  if ((state.withPartner ?? []).some(one => one.id === code)) return openDetails({ partnerAsk: code })
  for (const lane of state.chats) {
    const place = lane.queue.findIndex(step => step.id === code)
    if (place >= 0) return openDetails({ lane: lane.name, place, id: code })
  }
  // B507: a step in no worker's queue opens as the step it is.
  if ((state.backlog ?? []).flatMap(activity => activity.steps).some(step => step.key === code)) openDetails({ step: code })
}

// Pictures, large: a window of its own, so it also opens over the details

// zoom:start
// B676: the picture window. A picture opens fitted to the window; a click toggles it to its full size at the point
// clicked, the wheel zooms around the pointer, a drag moves it. The view is { scale, x, y }: the picture's top-left in
// the stage, in px, and its size relative to the file. These are pure, for the test.
const ZOOM_MOST = 8

/** The scale that fits a picture into the stage: never above 100 %. */
function zoomFit(natural, box) {
  if (!(natural.width > 0) || !(natural.height > 0)) return 1
  return Math.min(1, box.width / natural.width, box.height / natural.height)
}

/** A view kept on the stage: a picture larger than it reaches every edge but never leaves it, a smaller one is centred. */
function zoomClamp(view, natural, box) {
  const place = (offset, size, room) => (size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, offset)))
  return { scale: view.scale, x: place(view.x, natural.width * view.scale, box.width), y: place(view.y, natural.height * view.scale, box.height) }
}

/** The view at `scale` (between fitted and 800 %) with the picture point under `point` (stage px) staying under it. */
function zoomAround(view, natural, box, scale, point) {
  const next = Math.min(ZOOM_MOST, Math.max(zoomFit(natural, box), scale))
  const ratio = next / view.scale
  return zoomClamp({ scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, natural, box)
}

/** The fitted view. */
function zoomFitted(natural, box) {
  return zoomClamp({ scale: zoomFit(natural, box), x: 0, y: 0 }, natural, box)
}

/** Whether the view is the fitted one. */
const zoomIsFitted = (view, natural, box) => Math.abs(view.scale - zoomFit(natural, box)) < 0.001

/** The scale a click goes to: 100 % from fitted (200 % when the picture is no larger than the stage), else back to fitted. */
function zoomClickScale(view, natural, box) {
  if (!zoomIsFitted(view, natural, box)) return zoomFit(natural, box)
  return zoomFit(natural, box) < 1 ? 1 : 2
}

/** The quiet line under the picture: the zoom, and what a click does. */
function zoomLine(view, natural, box) {
  const goes = zoomIsFitted(view, natural, box) ? `${Math.round(zoomClickScale(view, natural, box) * 100)} %` : 'fit'
  return `${Math.round(view.scale * 100)} % · click: ${goes}`
}
// zoom:end

/** The picture window's state: the file's size, the view, and a drag in progress. */
const lightbox = { natural: { width: 0, height: 0 }, view: { scale: 1, x: 0, y: 0 }, drag: null, moved: false }

const stageBox = () => ({ width: $('lightbox-stage').clientWidth, height: $('lightbox-stage').clientHeight })

/** Puts the picture where the view says and writes the zoom line. */
function drawLightbox() {
  const { natural, view } = lightbox
  const image = $('lightbox-picture')
  image.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
  image.classList.toggle('pixels', view.scale > 1)
  $('lightbox-zoom').textContent = zoomLine(view, natural, stageBox())
}

/** The pointer's place in the stage, in px. */
function stagePoint(event) {
  const rect = $('lightbox-stage').getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/** One window for every picture (B676): the link, the frames, a game file; `problem` is a plain line when there is no picture. */
function showPicture(url, caption, problem = null) {
  const box = $('lightbox')
  const image = $('lightbox-picture')
  box.classList.toggle('zoomable', !PHONE.matches)
  $('lightbox-caption').textContent = caption
  $('lightbox-problem').textContent = problem ?? ''
  $('lightbox-problem').hidden = problem === null
  image.hidden = url === null
  $('lightbox-zoom').hidden = url === null || PHONE.matches
  lightbox.natural = { width: 0, height: 0 }
  lightbox.view = { scale: 1, x: 0, y: 0 }
  image.style.transform = ''
  const place = () => {
    lightbox.natural = { width: image.naturalWidth, height: image.naturalHeight }
    lightbox.view = zoomFitted(lightbox.natural, stageBox())
    drawLightbox()
  }
  image.onload = PHONE.matches ? null : place
  if (url !== null) image.src = url
  if (!box.open) box.showModal()
  if (url !== null && image.complete && !PHONE.matches) place()
}

/** A picture the board may show, large, with its caption; a plain line when it may not (too big), nothing otherwise. */
function openPicture(path, caption) {
  pictureUrl(path).then(url => {
    if (url !== null) return showPicture(url, caption || path)
    const problem = pictureProblems.get(path)
    if (problem !== undefined) showPicture(null, caption || path, problem)
  })
}

document.addEventListener('click', event => {
  const frame = event.target.closest('[data-zoom]')
  if (frame !== null) openPicture(frame.dataset.zoom, frame.dataset.caption)
})

// demo:start
/** B699: the goal demo's page body from the board's page model (src/demo.mjs demoPage): the verdict of each part, its labelled pictures at their own size (a click opens the picture window), the follow-up last. Words, order and labels are the model's. */
function demoBody(page) {
  const body = el('div', 'demo-body')
  const bullets = (items, className) => {
    const list = el('ul', className)
    for (const item of items) list.append(el('li', '', item))
    return list
  }
  body.append(el('h2', 'demo-title', `${page.goal} · ${page.title}: the goal demo`), el('p', 'demo-intro', page.intro))
  for (const section of page.sections) {
    const part = el('section', `demo-section is-${section.kind}`)
    part.append(el('div', 'demo-band', section.band))
    if (section.intro.length > 0) part.append(bullets(section.intro, 'demo-lines'))
    if (section.items.length > 0) part.append(bullets(section.items, 'demo-items'))
    for (const row of section.rows) {
      const card = el('div', 'demo-row')
      const head = el('h3', 'demo-row-title')
      head.append(el('span', 'demo-verdict', section.verdict), el('span', '', row.title))
      card.append(head)
      if (row.note !== '') card.append(el('p', 'demo-row-note', row.note))
      const shots = el('div', 'demo-pictures')
      for (const one of row.pictures) {
        const figure = el('figure', one.kind === null ? 'demo-figure' : `demo-figure is-${one.kind}`)
        if (one.label !== null) figure.append(el('div', 'demo-kind', one.label))
        figure.append(el('figcaption', '', one.caption))
        const frame = picture(one.path, one.caption)
        frame.className += ' demo-picture'
        figure.append(frame)
        shots.append(figure)
      }
      card.append(shots)
      part.append(card)
    }
    body.append(part)
  }
  if (page.followUp !== null) {
    const follow = el('section', 'demo-section is-follow-up')
    follow.append(el('div', 'demo-band', page.followUp.band))
    for (const group of page.followUp.groups) {
      const block = el('div', `demo-group is-${group.key}`)
      block.append(el('h3', '', group.title), bullets(group.items, 'demo-items'))
      follow.append(block)
    }
    body.append(follow)
  }
  return body
}
// demo:end

/** B699: the goal demo of a demo.json as a page of its own: each picture stays its own file, opened at its own size with a click. */
async function openDemo(path) {
  const box = $('demo-page')
  const head = el('header', 'file-view-head')
  const close = el('button', 'icon-button', '✕')
  close.type = 'button'
  close.dataset.closeDemo = ''
  close.setAttribute('aria-label', 'Close')
  head.append(el('h2', '', 'The goal demo'), close)
  const answer = await fetch(`/api/demo?path=${encodeURIComponent(path)}`, { headers: { 'X-Board-Token': TOKEN } }).catch(() => null)
  let body
  if (answer === null) body = el('p', 'problem', 'The board\'s server does not answer.')
  else if (!answer.ok) body = el('p', 'problem', (await answer.text()).trim() || 'This goal demo is not shown.')
  else body = demoBody(await answer.json())
  const scroll = el('div', 'demo-scroll')
  scroll.append(body)
  fill(box, [head, scroll])
  if (!box.open) box.showModal()
}
document.addEventListener('click', event => {
  const link = event.target.closest('[data-demo]')
  if (link !== null) return openDemo(link.dataset.demo)
  if (event.target === $('demo-page') || event.target.closest('[data-close-demo]') !== null) $('demo-page').close()
})

// B208: a phone is a screen up to 600 px wide, as the style sheet has it.
const PHONE = matchMedia('(max-width: 600px)')

$('lightbox').addEventListener('click', event => {
  const image = $('lightbox-picture')
  // B208: on a phone a tap on the picture keeps it open, to pinch and move it; a tap beside it closes it.
  if (PHONE.matches) {
    if (event.target === image) return
    return $('lightbox').close()
  }
  if (event.target.closest('#lightbox-close') !== null) return $('lightbox').close()
  if (lightbox.moved) { lightbox.moved = false; return } // the end of a drag is no click
  if (event.target === image) {
    // B676: a click on the picture zooms (100 % at the point clicked, or back to fitted), it no longer closes the window
    const box = stageBox()
    const scale = zoomClickScale(lightbox.view, lightbox.natural, box)
    lightbox.view = zoomAround(lightbox.view, lightbox.natural, box, scale, stagePoint(event))
    return drawLightbox()
  }
  $('lightbox').close()
})

$('lightbox-stage').addEventListener('wheel', event => {
  if (PHONE.matches || lightbox.natural.width === 0) return
  event.preventDefault()
  const view = lightbox.view
  lightbox.view = zoomAround(view, lightbox.natural, stageBox(), view.scale * Math.exp(-event.deltaY * 0.0015), stagePoint(event))
  drawLightbox()
}, { passive: false })

$('lightbox-picture').addEventListener('pointerdown', event => {
  if (PHONE.matches || event.button !== 0) return
  lightbox.drag = { x: event.clientX, y: event.clientY, view: lightbox.view, far: false }
  event.target.setPointerCapture(event.pointerId)
  event.preventDefault()
})
$('lightbox-picture').addEventListener('pointermove', event => {
  const drag = lightbox.drag
  if (drag === null) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  if (!drag.far && Math.hypot(dx, dy) < 4) return
  drag.far = true
  lightbox.view = zoomClamp({ scale: drag.view.scale, x: drag.view.x + dx, y: drag.view.y + dy }, lightbox.natural, stageBox())
  drawLightbox()
})
const endDrag = () => {
  if (lightbox.drag !== null && lightbox.drag.far) lightbox.moved = true
  lightbox.drag = null
}
$('lightbox-picture').addEventListener('pointerup', endDrag)
$('lightbox-picture').addEventListener('pointercancel', endDrag)

$('lightbox').addEventListener('close', () => { lightbox.moved = false; lightbox.drag = null })

window.addEventListener('resize', () => {
  if (!$('lightbox').open || PHONE.matches || lightbox.natural.width === 0) return
  const box = stageBox()
  lightbox.view = zoomIsFitted(lightbox.view, lightbox.natural, box) ? zoomFitted(lightbox.natural, box) : zoomClamp(lightbox.view, lightbox.natural, box)
  drawLightbox()
})

// B208: on a phone an answer box grows as one types: the style sheet's field-sizing where the browser has it, else here.
if (!CSS.supports('field-sizing', 'content')) {
  document.addEventListener('input', event => {
    const box = event.target
    if (!PHONE.matches || !(box instanceof HTMLTextAreaElement)) return
    box.style.height = 'auto'
    box.style.height = `${Math.min(box.scrollHeight + 2, Math.round(window.innerHeight * 0.4))}px`
  })
}

// Advice: headings, lists, tables and paragraphs of a plain markdown text

// rich:start
const isTableLine = line => /^\s*\|.*\|\s*$/.test(line)
/** The cells of one line of a table: "| a | b |" is ["a", "b"]. */
const cellsOf = line => line.trim().slice(1, -1).split('|').map(cell => cell.trim())
const isRuleLine = line => isTableLine(line) && cellsOf(line).every(cell => /^:?-+:?$/.test(cell))

/**
 * B94: a text in parts, in order: `{ text }` for plain lines and `{ table: { head, rows } }` for a table as the
 * chats write it (two or more lines between bars; a line of dashes under the first makes that one the head). The
 * advisor's tables are then drawn as tables, not as bars and dashes.
 */
function partsOf(text) {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''))
  const parts = []
  let plain = []
  const flush = () => {
    const words = plain.join('\n').replace(/^\n+|\n+$/g, '')
    if (words !== '') parts.push({ text: words })
    plain = []
  }
  for (let at = 0; at < lines.length; at += 1) {
    let end = at
    while (end < lines.length && isTableLine(lines[end])) end += 1
    if (end - at < 2) {
      plain.push(lines[at])
      continue
    }
    flush()
    const block = lines.slice(at, end)
    const hasHead = isRuleLine(block[1])
    parts.push({ table: { head: hasHead ? cellsOf(block[0]) : null, rows: block.slice(hasHead ? 2 : 0).filter(line => !isRuleLine(line)).map(cellsOf) } })
    at = end - 1
  }
  flush()
  return parts
}

const ADVICE_OLD_MS = 2 * 60 * 60_000

/**
 * B94: how old the advice is, in words, and whether that is old enough to warn (`isOld`): the advisor writes it
 * once and the person decides things after. Null when the board does not know when it was written.
 */
function adviceAge(at, now) {
  if (!Number.isFinite(at)) return null
  const isToday = new Date(at).toDateString() === new Date(now).toDateString()
  const day = isToday ? '' : `on ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} `
  const isOld = now - at > ADVICE_OLD_MS
  const age = now - at < 60_000 ? 'just now' : `${span(now - at)} ago`
  return { text: `Written ${age}, ${day}at ${clock(at)}.${isOld ? ' What was decided since is not in it.' : ''}`, isOld }
}
// rich:end

/** B94: a table of the advisor's, drawn as one. */
function drawTable({ head, rows }, linker = null) {
  const table = el('table')
  if (head !== null) {
    const top = el('thead')
    const row = el('tr')
    for (const cell of head) row.append(marked('th', '', cell, linker))
    top.append(row)
    table.append(top)
  }
  const body = el('tbody')
  for (const cells of rows) {
    const row = el('tr')
    for (const cell of cells) row.append(marked('td', '', cell, linker))
    body.append(row)
  }
  table.append(body)
  const wrap = el('div', 'table-wrap')
  wrap.append(table)
  return wrap
}

/** B94: text with its tables drawn as tables; all else as `mark` puts it. */
function rich(node, text) {
  const parts = partsOf(text)
  if (parts.every(part => part.table === undefined)) return mark(node, text)
  node.replaceChildren(...parts.map(part => (part.table === undefined ? marked('div', '', part.text) : drawTable(part.table))))
  return node
}

// advisor:start
// B173: the Advisor tab (Advice & Chat until B195) shows the Advisor's work: its open suggestions, when its rounds come, and the game plan.

/** When the board's clock starts the Advisor's rounds, and a round it left out in the last day. `clockOf(ms)` is "09:00". */
function roundsLine(rounds, now, clockOf) {
  if (rounds === null || rounds === undefined) return ''
  const when = [rounds.morningRound ? `every day at ${rounds.morningRound}` : null, rounds.weeklyRound ? 'a deep one right after the weekly limit resets' : null].filter(Boolean)
  if (when.length === 0) return 'The board\'s clock starts no rounds: the settings leave both out. Ask the Advisor in the chat.'
  const skipped = rounds.last?.skipped ?? null
  const left = skipped !== null && now - skipped.at < 24 * 60 * 60_000 ? ` The ${skipped.round} round at ${clockOf(skipped.at)} was left out: ${skipped.why}.` : ''
  return `Rounds from the board's clock: ${when.join(', and ')}; or ask it in the chat.${left}`
}

/** An open suggestion as it reads on the tab: its id and title, and its lines ("Why: ...") in the order written. */
function suggestionView(step) {
  const lines = (step.notes ?? []).flatMap(section => [...section.lines, ...section.points].map(line => (section.title === null ? line : `${section.title}: ${line}`)))
  return { title: [step.id, step.title].filter(Boolean).join(' '), lines }
}
// advisor:end

function drawSuggestions(state) {
  const list = state.suggestions ?? []
  const group = state.rounds?.group ?? 'Advisor suggestions'
  const head = el('h3', '', list.length === 0 ? 'Suggestions' : `Suggestions (${list.length} open)`)
  // B195: the count on the Suggestions button of the Advisor's tab.
  $('advisor-suggestions-count').textContent = list.length === 0 ? '' : String(list.length)
  if (list.length === 0) return fill($('advice-suggestions'), [head, el('p', 'muted', `No open suggestions. The Advisor puts them on the backlog under "${group}"; you answer them under For you.`)])
  fill($('advice-suggestions'), [head, ...list.map(step => {
    const view = suggestionView(step)
    const card = el('div', 'suggestion')
    card.append(el('b', '', view.title), ...view.lines.map(line => marked('p', '', line)))
    return card
  }), el('p', 'muted', 'Accept or reject each one under For you.')])
}

// refinelist:start
// B286: the Advisor tab's Refine part: every step a chat can do, by where its refine stands (backlog.mjs
// refineStateOf), in the order of a refine; each row opens the step's window. Goal G17.

/** The groups of the Refine part, in the order of a refine: their state and their title. */
const REFINE_GROUPS = [
  ['none', 'Not refined'],
  ['asking', 'The Advisor on it now'],
  ['answers', 'Your answers waiting'],
  ['answered', 'Answered, waiting for the next round'],
  // B312: the board's rounds reached their cap with no new answer since; Send again on the Advisor's card goes on.
  ['stopped', 'Stopped: no new answers since its last rounds'],
  ['ready', 'Ready'],
]

/** The work store's states of a step a chat holds (src/work/api.mjs HELD): not for a chat to take, whatever the line says. */
const REFINE_HELD = ['taken', 'in progress', 'waiting on you', 'review']

/** The open and queued steps with an id of the backlog's activities, by refine state, in the backlog's order. */
function refineGroups(activities) {
  const steps = (activities ?? []).flatMap(activity => (activity.steps ?? [])
    .filter(step => typeof step.id === 'string' && (step.status === 'open' || step.status === 'queued') && !REFINE_HELD.includes(step.flow?.state))
    .map(step => ({ state: step.refineState ?? 'none', row: { key: step.key, id: step.id, title: step.title, activity: activity.name } })))
  return REFINE_GROUPS.map(([state, title]) => ({ state, title, steps: steps.filter(one => one.state === state).map(one => one.row) }))
}

/** The count on the Refine button: the steps whose answers wait for the person; '' for none. */
function refineCount(groups) {
  const waiting = groups.find(group => group.state === 'answers')?.steps.length ?? 0
  return waiting === 0 ? '' : String(waiting)
}

/** Whether a group stands open: as the person left it, else open when it holds a few steps. */
function refineIsOpen(group, left) {
  return left.has(group.state) ? left.get(group.state) : group.steps.length > 0 && group.steps.length <= 12
}
// refinelist:end

/** The groups the person opened or closed, by state, so a redraw keeps them so. */
const refineLeft = new Map()

/** Fills the Refine part: a group per state with its count, a row per step; the count of answers waiting on its button. */
function drawRefineList(groups) {
  $('advisor-refine-count').textContent = refineCount(groups)
  const parts = groups.map(group => {
    const part = el('details', 'refine-group')
    part.open = refineIsOpen(group, refineLeft)
    part.addEventListener('toggle', () => refineLeft.set(group.state, part.open))
    part.append(el('summary', '', `${group.title} (${group.steps.length})`))
    if (group.steps.length === 0) {
      part.append(el('p', 'muted', 'None.'))
      return part
    }
    const list = el('ul', 'refine-rows')
    for (const one of group.steps) {
      const row = el('button', 'refine-row')
      row.type = 'button'
      row.dataset.refineStep = one.key
      row.append(el('b', '', one.id), el('span', '', one.title), el('small', 'muted', one.activity))
      const item = el('li', '')
      item.append(row)
      list.append(item)
    }
    part.append(list)
    return part
  })
  fill($('advisor-refine'), [el('h3', '', 'Refine'), el('p', 'muted', 'Every task a chat can do, by where its refine stands: a task goes on the board\'s list for a worker once it is ready. Click one to open it.'), ...parts])
}
// refinelist:events
$('advisor-refine').addEventListener('click', event => {
  const row = event.target.closest('[data-refine-step]')
  if (row !== null) openDetails({ step: row.dataset.refineStep })
})

// B255: the goal map's outline in the Advisor tab's Goals part (spec 2026-10-15, section 2). The person, 2026-10-15:
// "I dont want to be overwhelmed with too many things at once ... a simple counter is enough, the ability to click on
// a node/milestone can zoom in, and quickly zoom out seamlessly". One level at a time: the focused node and its
// children, with counters; the rest folded and dimmed. The focus is in the address (#advice/goals/G12).
let goalsFocus = null
/** The rows whose ▸ the person opened, one level more without zooming; a zoom folds them again. */
const goalsOpened = new Set()
let goalsLinesOpen = false

// goals:start
// Worked out without the page, so the tests can run it. `goals` is state.goals: { roots, nodes (each with counts), problems }.
function goalById(goals, id) { return id === null ? null : goals.nodes.find(one => one.id === id) ?? null }

/** Goals › the focus's ancestors › the focus; an unknown focus is the top. */
function goalCrumb(goals, focusId) {
  const chain = []
  const seen = new Set()
  for (let node = goalById(goals, focusId); node !== null && !seen.has(node.id); node = goalById(goals, node.parent)) {
    seen.add(node.id)
    chain.unshift({ id: node.id, title: node.title })
  }
  return [{ id: null, title: 'Goals' }, ...chain]
}

/** B505: the goals a search finds at any depth, done or not: an id (G33, g33) or every word of the title; id matches first, at most 8. */
function goalSearch(goals, query) {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return []
  const rank = node => {
    const id = node.id.toLowerCase()
    return id === words[0] ? 0 : id.startsWith(words[0]) ? 1 : 2
  }
  return goals.nodes
    .filter(node => words.every(word => `${node.id} ${node.title}`.toLowerCase().includes(word)))
    .map((node, order) => ({ node, order, rank: rank(node) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, 8)
    .map(({ node }) => ({ id: node.id, title: node.title, where: goalCrumb(goals, node.id).slice(1).map(step => /^M\d+(?= |$)/.exec(step.title)?.[0] ?? step.id).join(' › ') }))
}

/** "2 inside · 4 steps · 3 done · 1 missing"; "no steps yet" when there is nothing to count. */
function goalCounter(counts) {
  if (counts === undefined || counts === null) return ''
  const parts = []
  if (counts.nodes > 0) parts.push(`${counts.nodes} inside`)
  if (counts.steps > 0) parts.push(`${counts.steps} step${counts.steps === 1 ? '' : 's'}`, `${counts.done} done`)
  if (counts.missing > 0) parts.push(`${counts.missing} missing`)
  if (counts.unknown > 0) parts.push(`${counts.unknown} unknown`)
  return parts.length === 0 ? 'no steps yet' : parts.join(' · ')
}

/** B258: where an ask stands: the Advisor has not answered it, answered and the person has not read it, or read. */
function goalAskState(ask) { return ask.answer === null ? 'pending' : ask.readAt === null ? 'answered' : 'read' }

/** "1 ask pending", "2 asks pending": the asks of a goal the Advisor has not answered yet ("" when none). */
function goalAsksPending(node) {
  const pending = node.asks.filter(ask => goalAskState(ask) === 'pending').length
  return pending === 0 ? '' : `${pending} ask${pending === 1 ? '' : 's'} pending`
}

/**
 * B258: a goal's asks as the blocks its frame shows, oldest first: the question with its id and time, where it stands,
 * the answer with its page (`more`) and the pictures it names. One read already only when `showRead` (the frame's
 * lines unfolded): the block stays under the goal after Done.
 */
function goalAskBlocks(node, showRead) {
  return node.asks.filter(ask => showRead || goalAskState(ask) !== 'read')
    .map(ask => ({ id: ask.id, at: ask.at, question: ask.text, state: goalAskState(ask), answer: ask.answer, pictures: goalAskPictures(ask.answer) }))
}

/** The pictures an answer names by their paths (png, jpg, webp), in its words or as its More line, each once. */
function goalAskPictures(answer) {
  if (answer === null || answer === undefined) return []
  const found = `${answer.text ?? ''} ${answer.more ?? ''}`.match(/[\w@+./-]+\.(?:png|jpe?g|webp)\b/gi) ?? []
  return [...new Set(found.map(path => path.replace(/^\.\//, '')))]
}

/**
 * B258: what "Make a step from this" puts into Talk to Main, for the person to change and send: the goal, the ask and
 * the answer, as plain words. (B259 gives the main chat words of its own for a step from the map.)
 */
function goalStepWords(node, block) {
  const answer = block.answer === null ? '' : ` The Advisor's answer: ${block.answer.text}${block.answer.more ? ` (more in ${block.answer.more})` : ''}`
  return `Make a backlog step from the goal map, for ${goalLabel(node)}, from my ask ${block.id}: ${block.question}${/[.?!]$/.test(block.question) ? '' : '.'}${answer}`
}

/** A node's own lines folded to one: "Done when: … · 1 ask pending · 1 note · 1 missing" ("" when it has none of these). */
function goalFrameLine(node) {
  const parts = []
  if (node.doneWhen) parts.push(`Done when: ${node.doneWhen}`)
  if (goalAsksPending(node) !== '') parts.push(goalAsksPending(node))
  const unread = node.asks.filter(ask => goalAskState(ask) === 'answered').length
  if (unread > 0) parts.push(`${unread} answer${unread === 1 ? '' : 's'} to read`)
  const notes = node.notes.filter(line => line.startsWith('Note')).length
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? '' : 's'}`)
  if (node.missing.length > 0) parts.push(`${node.missing.length} missing`)
  // B358: where its re-check before the tick stands.
  const recheck = goalRecheckLine(node)
  if (recheck !== null) parts.push(recheck)
  return parts.join(' · ')
}

/** B358: a goal's re-check in a few words: asked, or its last outcome with the attempts so far; null without one. */
function goalRecheckLine(node) {
  const last = (node.rechecks ?? []).at(-1)
  // A re-check that waits for the person stays asked: its last outcome says so.
  if ((node.recheckAsked ?? null) !== null && !(last?.verdict === 'waits for you' && last.at >= node.recheckAsked)) return 'your partner re-checks it'
  if (last === undefined) return null
  const attempts = (node.rechecks ?? []).filter(one => one.verdict === 'failed').length
  if (last.verdict === 'passed') return `re-checked: ${last.summary}`
  if (last.verdict === 'waits for you') return `re-check waits for you: ${last.gap ?? last.summary}`
  return `re-check failed (attempt ${attempts}): ${last.gap ?? last.summary}`
}

/** A node's own lines unfolded, as the file names them; another goal by its title and id. Its asks are blocks of their own (B258). */
function goalFrameLines(goals, node) {
  const named = id => { const other = goalById(goals, id); return other === null ? id : `${other.title} (${id})` }
  const lines = []
  if (node.doneWhen) lines.push(`Done when: ${node.doneWhen}`)
  if (node.why) lines.push(`Why: ${node.why}`)
  if (node.fromPlan) lines.push(`From the game plan: ${node.fromPlan}`)
  if (node.enables.length > 0) lines.push(`Enables: ${node.enables.map(named).join(', ')}`)
  if (node.alsoPartOf.length > 0) lines.push(`Also part of: ${node.alsoPartOf.map(named).join(', ')}`)
  if (node.steps.length > 0) lines.push(`Steps: ${node.steps.join(', ')}`)
  for (const line of node.missing) lines.push(`Missing: ${line}`)
  if (node.recommendation) {
    const rec = node.recommendation
    lines.push(`Recommendation (${rec.id}): ${[rec.title, rec.why, rec.cost, rec.step ?? 'none'].filter(Boolean).join(' · ')}`)
  }
  if (node.brainstorm) lines.push(`Brainstorm: ${node.brainstorm.path} (${node.brainstorm.state})`)
  // B358: its re-checks before the tick, each with its outcome and evidence, and the person's tick after a failed one.
  for (const one of node.rechecks ?? []) lines.push(`Re-checked ${one.at}${one.by ? ` by ${one.by}` : ''}: ${one.verdict} · ${one.summary}${one.gap ? ` · ${one.verdict === 'waits for you' ? 'for you' : 'gap'}: ${one.gap}` : ''}${one.evidence ? ` · evidence ${one.evidence}` : ''}`)
  for (const one of node.overturned ?? []) lines.push(`Overturned: ${one}`)
  if ((node.recheckAsked ?? null) !== null) lines.push(`Re-check asked ${node.recheckAsked}: your partner re-checks it against its Done when before its tick`)
  lines.push(...node.notes)
  return lines
}

function goalTags(goals, node, isRef) {
  const tags = []
  if (isRef) tags.push(`also here · home: ${goalById(goals, node.parent)?.title ?? 'the top'}`)
  else for (const id of node.alsoPartOf) tags.push(`also under ${goalById(goals, id)?.title ?? id}`)
  for (const id of node.enables) tags.push(`enables → ${goalById(goals, id)?.title ?? id}`)
  if (node.brainstorm?.state === 'running') tags.push('brainstorm')
  // B258: an ask the Advisor has not answered, and an answer not read yet, at the goal's home.
  if (!isRef && goalAsksPending(node) !== '') tags.push(goalAsksPending(node))
  if (!isRef && node.asks.some(ask => goalAskState(ask) === 'answered')) tags.push('answer to read')
  return tags
}

/**
 * The outline's rows: the whole tree. The focus's ancestors stand open; the focus's children show, folded; every other
 * node is folded unless `opened` holds it (a ▸ the person opened). Outside the focus everything is dimmed (nothing at
 * the top). A node that is also part of an open node stands under it as a reference row, which never folds open (its
 * click zooms into it at its home). An id used twice is walked once, so a broken file cannot send the outline round in
 * circles. `foldable` says whether a ▸/▾ does something: the focus and its ancestors stay open while zoomed there.
 */
function goalOutlineRows(goals, focusId, opened, hidden = []) {
  const focus = goalById(goals, focusId) === null ? null : focusId
  const chain = new Set(goalCrumb(goals, focus).map(one => one.id).filter(id => id !== null))
  const hides = new Set(hidden)
  const rows = []
  const walked = new Set()
  // B316: a group's hidden goals as one line after the goals that stay ("+2 done hidden"); no line when none hide.
  const hiddenLine = (ids, depth, lit) => {
    const count = new Set(ids.filter(id => hides.has(id) && goalById(goals, id) !== null)).size
    if (count > 0) rows.push({ id: null, depth, hidden: count, isDim: focus !== null && !lit })
  }
  const walk = (id, depth, isRef, inFocus) => {
    const node = goalById(goals, id)
    if (node === null || (!isRef && walked.has(id)) || hides.has(id)) return
    if (!isRef) walked.add(id)
    const isFocus = !isRef && id === focus
    const lit = inFocus || isFocus
    const isOpen = !isRef && (chain.has(id) || opened.has(id))
    const refs = isRef ? [] : goals.nodes.filter(other => other.id !== id && other.alsoPartOf.includes(id))
    const hasInside = !isRef && (node.children.length > 0 || refs.length > 0)
    rows.push({ id, depth, title: node.title, state: node.state, counter: goalCounter(node.counts), tags: goalTags(goals, node, isRef), isFocus, isDim: focus !== null && !lit, isRef, fold: hasInside ? (isOpen ? 'open' : 'closed') : null, foldable: hasInside && !chain.has(id) })
    if (!isOpen) return
    for (const child of node.children) walk(child, depth + 1, false, lit)
    for (const other of refs) walk(other.id, depth + 1, true, lit)
    hiddenLine(node.children, depth + 1, lit)
  }
  for (const root of goals.roots) walk(root, 0, false, focus === null)
  hiddenLine(goals.roots, 0, focus === null)
  return rows
}

/**
 * B316: the goals "Hide done" hides: done, with every goal inside done too (a done goal with an open goal inside
 * stays, so nothing open disappears; a milestone is a goal too). The goal zoomed into and the goals on the way down to
 * it never hide, so a link to a hidden goal still shows it.
 */
function goalsHidden(goals, focusId) {
  const chain = new Set(goalCrumb(goals, goalById(goals, focusId) === null ? null : focusId).map(one => one.id))
  return new Set(goals.nodes.filter(node => node.state === 'done' && !chain.has(node.id) && !goalHasOpenInside(goals, node.id)).map(node => node.id))
}

/** B316: the switch's words, with how many goals it hides ("Hide done (7)"). */
function goalsHideLabel(count) { return count > 0 ? `Hide done (${count})` : 'Hide done' }

function goalAddress(focusId) { return focusId === null ? '#advice/goals' : `#advice/goals/${focusId}` }

/** The focus an address names: null for the top, undefined when the address is not the map's. */
function goalFocusOf(hash) {
  const found = /^#advice\/goals(?:\/(G\d+))?$/.exec(hash)
  return found === null ? undefined : found[1] ?? null
}

/** Where Esc and ‹ go from a focus: one level up, the top from a top goal. */
function goalZoomOut(goals, focusId) {
  const crumb = goalCrumb(goals, focusId)
  return crumb.length > 2 ? crumb.at(-2).id : null
}

/** The tab an address names, for the first look and the browser's back and forward; null for a link to something else. */
function tabOfAddress(hash) {
  if (hash === '' || hash === '#') return 'overview'
  if (hash === '#advice' || /^#advice\/[a-z]+$/.test(hash) || goalFocusOf(hash) !== undefined) return 'advice'
  if (hash === '#backlog' || hash === '#coordinate' || hash === '#backlog/days') return 'coordinate'
  if (hash === '#design') return 'design'
  if (hash === '#vision') return 'vision'
  if (hash === '#spending') return 'spending'
  return null
}

// B256: editing the map in the outline (spec 2026-10-15, section 3). A move is `{ parent, index }`: the goal becomes
// child number `index` of `parent` (null: the top), counted without the goal itself, as src/goalsWrite.mjs moves it.
function goalSiblings(goals, parent) { return parent === null ? goals.roots : goalById(goals, parent)?.children ?? [] }

/** Whether `maybeInside` is `id` or stands somewhere inside it. */
function goalInside(goals, id, maybeInside) {
  const seen = new Set()
  for (let node = goalById(goals, maybeInside); node !== null && !seen.has(node.id); node = goalById(goals, node.parent)) {
    if (node.id === id) return true
    seen.add(node.id)
  }
  return false
}

/** Where a drop on a row puts the goal: before or after that row's goal, or inside it (`overId` null: the top). */
function goalDropTarget(goals, fromId, overId, place) {
  if (goalById(goals, fromId) === null) return null
  if (overId === null) return place === 'into' ? { parent: null, index: goals.roots.filter(one => one !== fromId).length } : null
  if (goalInside(goals, fromId, overId)) return null
  const over = goalById(goals, overId)
  if (over === null) return null
  if (place === 'into') return { parent: overId, index: over.children.filter(one => one !== fromId).length }
  const siblings = goalSiblings(goals, over.parent).filter(one => one !== fromId)
  const at = siblings.indexOf(overId)
  return { parent: over.parent, index: place === 'before' ? at : at + 1 }
}

/** Where on a row of `height` the pointer at `y` drops: its top quarter before it, its bottom quarter after, else in. */
function goalPlaceAt(y, height) { return y < height / 4 ? 'before' : y > (height * 3) / 4 ? 'after' : 'into' }

/** Alt+↑/↓ among its siblings, Tab under the sibling above (last), Shift+Tab out, after its parent; null: no move. */
function goalKeyMove(goals, id, key) {
  const node = goalById(goals, id)
  if (node === null) return null
  const siblings = goalSiblings(goals, node.parent)
  const at = siblings.indexOf(id)
  if (key === 'up') return at > 0 ? { parent: node.parent, index: at - 1 } : null
  if (key === 'down') return at >= 0 && at < siblings.length - 1 ? { parent: node.parent, index: at + 1 } : null
  if (key === 'in') return at > 0 ? { parent: siblings[at - 1], index: goalById(goals, siblings[at - 1])?.children.length ?? 0 } : null
  if (key === 'out') {
    if (node.parent === null) return null
    const grand = goalById(goals, node.parent)?.parent ?? null
    return { parent: grand, index: goalSiblings(goals, grand).indexOf(node.parent) + 1 }
  }
  return null
}

/**
 * The frame's tools for a goal, as [kind, words]. A goal of the game plan ("From the game plan:") keeps the plan's
 * title and Done when, and stays (spec section 1): no Rename, Done when…, Dissolve or Delete there.
 */
function goalTools(node) {
  const isPlan = Boolean(node.fromPlan)
  const tools = [['add', '+ Sub-goal'], ...(isPlan ? [] : [['rename', 'Rename'], ['Done when', 'Done when…']]), ['Why', 'Why…'], ['note', 'Note…'], ['Also part of', 'Also part of…'], ['Enables', 'Enables…']]
  if (!isPlan) tools.push(node.children.length > 0 ? ['dissolve', 'Dissolve'] : ['delete', 'Delete'])
  return tools
}

/** A click on the dot: open → in progress → done → open. */
function goalNextState(state) { return state === 'open' ? 'now' : state === 'now' ? 'done' : 'open' }

/** Whether a goal not done stands somewhere inside it: then "done" is asked once. */
function goalHasOpenInside(goals, id) {
  const seen = new Set([id])
  const walk = node => node.children.some(child => {
    const inner = goalById(goals, child)
    if (inner === null || seen.has(child)) return false
    seen.add(child)
    return inner.state !== 'done' || walk(inner)
  })
  const node = goalById(goals, id)
  return node !== null && walk(node)
}

/**
 * The goals a link from `id` may point to, whose titles hold every word typed (any case), in file order: not itself,
 * not one it names already, and for "Also part of" neither its home nor a goal inside it. `where` is the goal's home
 * (null at the top).
 */
function goalLinkChoices(goals, id, name, words) {
  const node = goalById(goals, id)
  if (node === null) return []
  const has = name === 'Enables' ? node.enables : node.alsoPartOf
  const wanted = String(words).toLowerCase().split(/\s+/).filter(Boolean)
  const seen = new Set()
  return goals.nodes.filter(other => {
    if (seen.has(other.id)) return false
    seen.add(other.id)
    if (other.id === id || has.includes(other.id)) return false
    if (name === 'Also part of' && (other.id === node.parent || goalInside(goals, id, other.id))) return false
    // B284: found by its id too ("G17").
    const title = goalLabel(other).toLowerCase()
    return wanted.every(word => title.includes(word))
  }).map(other => ({ id: other.id, title: other.title, where: goalById(goals, other.parent)?.title ?? null }))
}

// B257: the goal tree beside the outline (spec section 2, zoom style 1): the focused goal as the frame on top, the
// goals inside it as boxes in rows under it, joined by a trunk, a bus per row and a drop per box; a goal that is also
// part of it as a dotted reference box; an "enables" arrow between two goals in view, or from a small ghost at the
// right edge when its source is out of view. At the top the goals stand as boxes with no frame.
const GOAL_BOX = { w: 150, h: 92, gap: 20, rowGap: 150, busAbove: 24, firstY: 180, topY: 60, frameH: 64, ghostW: 98, ghostH: 34, ghostsMost: 3 }

function goalTreeLayout(goals, focusId, width, hidden = []) {
  const focus = goalById(goals, focusId)
  // B316: the goals "Hide done" hides are no box, no reference, no arrow's end and no ghost; the frame always shows.
  const hides = new Set(hidden)
  if (focus !== null) hides.delete(focus.id)
  const seen = new Set()
  const once = id => !seen.has(id) && seen.add(id)
  const allChildIds = (focus === null ? goals.roots : focus.children).filter(id => goalById(goals, id) !== null && once(id))
  const childIds = allChildIds.filter(id => !hides.has(id))
  const hiddenCount = allChildIds.length - childIds.length
  const refIds = focus === null ? [] : goals.nodes.filter(other => other.id !== focus.id && !hides.has(other.id) && other.alsoPartOf.includes(focus.id) && once(other.id)).map(other => other.id)
  const shown = new Set([...childIds, ...refIds, ...(focus === null ? [] : [focus.id])])
  // The arrows between goals in view, and one ghost per goal out of view that enables one in view.
  const arrows = []
  const sources = new Map()
  const walked = new Set()
  for (const node of goals.nodes) {
    if (walked.has(node.id) || hides.has(node.id)) continue
    walked.add(node.id)
    for (const to of node.enables) {
      if (!shown.has(to) || to === node.id) continue
      if (shown.has(node.id)) arrows.push({ from: node.id, to })
      else sources.set(node.id, [...(sources.get(node.id) ?? []), to])
    }
  }
  const outside = [...sources]
  // The ghosts keep a column of their own at the right edge; the frame and the boxes stand in what is left.
  const area = outside.length > 0 ? width - GOAL_BOX.ghostW - 24 : width
  const ghosts = outside.slice(0, GOAL_BOX.ghostsMost).map(([id, to], index) => ({ id, title: goalById(goals, id)?.title ?? id, x: width - GOAL_BOX.ghostW, y: 12 + index * 42, w: GOAL_BOX.ghostW, h: GOAL_BOX.ghostH, arrowTo: to }))
  const frame = focus === null ? null : { id: focus.id, x: 0, y: 0, w: area, h: GOAL_BOX.frameH }
  const perRow = Math.max(1, Math.floor((area + GOAL_BOX.gap) / (GOAL_BOX.w + GOAL_BOX.gap)))
  // B258: the goal's asks not answered or not read yet stand after the references, as violet boxes of kind "ask".
  const askIds = focus === null ? [] : focus.asks.filter(ask => goalAskState(ask) !== 'read').map(ask => ask.id)
  const all = [...childIds.map(id => ({ id, kind: 'child' })), ...refIds.map(id => ({ id, kind: 'ref' })), ...askIds.map(id => ({ id, kind: 'ask' }))]
  const firstY = frame === null ? GOAL_BOX.topY : GOAL_BOX.firstY
  const boxes = all.map((one, index) => {
    const row = Math.floor(index / perRow)
    const inRow = Math.min(perRow, all.length - row * perRow)
    const rowWidth = inRow * GOAL_BOX.w + (inRow - 1) * GOAL_BOX.gap
    const x = Math.round((area - rowWidth) / 2) + (index % perRow) * (GOAL_BOX.w + GOAL_BOX.gap)
    return { ...one, x, y: firstY + row * GOAL_BOX.rowGap, w: GOAL_BOX.w, h: GOAL_BOX.h, row }
  })
  // The frame's trunk comes down to the first row's bus; a spine left of every box joins the rows below (no line runs
  // behind a box); each row's bus reaches from the spine (or the trunk) to its last box, a drop to each box.
  const lines = []
  if (frame !== null && boxes.length > 0) {
    const trunkX = Math.round(area / 2)
    const lastRow = boxes.at(-1).row
    const spineX = Math.max(4, Math.min(...boxes.map(box => box.x)) - 12)
    const busOf = row => firstY + row * GOAL_BOX.rowGap - GOAL_BOX.busAbove
    lines.push({ x1: trunkX, y1: frame.h, x2: trunkX, y2: busOf(0) })
    if (lastRow > 0) lines.push({ x1: spineX, y1: busOf(0), x2: spineX, y2: busOf(lastRow) })
    for (let row = 0; row <= lastRow; row += 1) {
      const inRow = boxes.filter(box => box.row === row)
      const centres = inRow.map(box => box.x + GOAL_BOX.w / 2)
      const from = Math.min(centres[0], row === 0 ? trunkX : spineX, lastRow > 0 ? spineX : Infinity)
      const to = Math.max(centres.at(-1), row === 0 ? trunkX : -Infinity)
      lines.push({ x1: from, y1: busOf(row), x2: to, y2: busOf(row) })
      for (const centre of centres) lines.push({ x1: centre, y1: busOf(row), x2: centre, y2: busOf(row) + GOAL_BOX.busAbove })
    }
  }
  const moreGhosts = outside.length - ghosts.length
  // B316: one line under the boxes (where the first row would stand without any) says how many hide here.
  const hiddenLine = hiddenCount === 0 ? null : { count: hiddenCount, x: Math.round(area / 2), y: boxes.length === 0 ? firstY : boxes.at(-1).y + GOAL_BOX.h + 26 }
  const bottoms = [frame === null ? 0 : frame.h, ...boxes.map(box => box.y + box.h), ...ghosts.map(ghost => ghost.y + ghost.h + (moreGhosts > 0 ? 18 : 0)), hiddenLine === null ? 0 : hiddenLine.y]
  return { width, height: Math.max(...bottoms) + 20, frame, boxes, lines, arrows, ghosts, moreGhosts, hiddenLine }
}

/**
 * B284: a goal as the map names it: its id before its title ("G17 The Advisor's work…"), so it can be named by its id
 * anywhere; a milestone keeps its own "M1 ·" after the id. The top of the map (no id) is its title alone, and a title
 * that already starts with its id does not say it twice.
 */
function goalLabel(node) {
  const id = typeof node?.id === 'string' ? node.id : ''
  const title = String(node?.title ?? '')
  return id === '' || title === id || title.startsWith(`${id} `) ? title : `${id} ${title}`
}

/**
 * B289: the part under the goal map with the open steps no goal names: its line ("Not under a goal: 3 steps") and the
 * steps, each with its id and title. Null without the list (no goal map).
 */
function unlinkedView(unlinked) {
  if (!Array.isArray(unlinked)) return null
  const count = unlinked.length
  return {
    summary: count === 0 ? 'Every open step is under a goal' : `Not under a goal: ${count} step${count === 1 ? '' : 's'}`,
    rows: unlinked.map(step => ({ id: step.id, title: step.title.charAt(0).toUpperCase() + step.title.slice(1) })),
  }
}

/** B284: a drawn line of a goal's label in its parts: what stands before the id ("↗ "), the id, and the rest. */
function goalIdSplit(line, id) {
  const lead = line.startsWith('↗ ') ? '↗ ' : ''
  const after = line.slice(lead.length)
  if (typeof id !== 'string' || id === '' || !(after === id || after.startsWith(`${id} `))) return { lead: '', id: '', rest: line }
  return { lead, id, rest: after.slice(id.length) }
}

/**
 * A title in at most two lines of `most` characters, cut at a space; what does not fit ends in "…". B284: never at
 * the space after a goal's id, so "G17" never stands alone on a line.
 */
function goalTitleLines(title, most) {
  if (title.length <= most) return [title]
  const lead = /^(?:↗ )?G\d+ /.exec(title)?.[0].length ?? 0
  const space = title.lastIndexOf(' ', most)
  const cut = space < lead ? -1 : space
  const shorten = words => (words.length <= most ? words : `${words.slice(0, most - 1)}…`)
  if (cut <= 0) return [shorten(title)]
  return [title.slice(0, cut).trimEnd(), shorten(title.slice(cut + 1).trimStart())]
}

/**
 * Where a box dragged in the tree lands, for the point (x, y) in the tree: in the middle of a box inside it, at its
 * left or right quarter before or after it; on the frame, last inside the goal zoomed into. `target` is null when the
 * goal may not go there (into its own branch, onto a reference box); the whole answer is null over empty ground.
 */
function goalTreeDrop(goals, layout, fromId, x, y) {
  const hit = one => x >= one.x && x <= one.x + one.w && y >= one.y && y <= one.y + one.h
  const box = layout.boxes.find(hit)
  if (box !== undefined) {
    const at = (x - box.x) / box.w
    const place = at < 0.25 ? 'before' : at > 0.75 ? 'after' : 'into'
    return { place, over: box.id, target: box.kind !== 'child' ? null : goalDropTarget(goals, fromId, box.id, place) }
  }
  if (layout.frame !== null && hit(layout.frame)) return { place: 'into', over: layout.frame.id, target: goalDropTarget(goals, fromId, layout.frame.id, 'into') }
  return null
}
// goals:end

// goalsteps:start
// B383: the right side of the Goals page, "Steps for this goal" (as the person's design picture of the page has it):
// the selected goal's steps and what it still misses.

/** A step's badge in the panel, from where it stands in the flow: its words and its tone. */
function goalStepBadge(step) {
  const state = step.flow?.state ?? null
  if (state === 'done' || step.status === 'done') return ['Done', 'done']
  // B392: a step whose open blocking asks all wait for the partner is not the person's yet.
  if ((step.flow?.waitsForPartner ?? []).length > 0) return ['Waits for your partner', 'partner']
  if (state === 'waiting on you' || step.status === 'you') return ['Needs you', 'you']
  if (state === 'in progress' || state === 'taken' || (state === null && step.status === 'progress')) return ['Working', 'working']
  if (state === 'review') return ['In review', 'review']
  if (state === 'queued' || (state === null && step.status === 'queued')) return ['Queued', 'queued']
  if (state === 'refined') return ['Ready', 'ready']
  return ['New', 'new']
}

/**
 * The panel for the goal `goalId` of the map (`goals`), from the state's backlog: its steps (those its Steps and Part
 * lines name, then the store's steps with its Goal, a dropped one left out), each numbered with its title, one line of
 * what it does, its badge and its chat; the filter All / Open / Done, done steps folded under "Show N completed steps"
 * while All shows; its Missing lines, each split at a dash into words and a line under them; "Add all" for two or more.
 * `ui`: `tab` (steps or missing), `filter`, `showDone`, `canWrite` and `whyNot`.
 */
function goalStepsView(goals, goalId, backlog, ui = {}) {
  const node = goalId === null || goalId === undefined ? null : (goals?.nodes ?? []).find(one => one.id === goalId) ?? null
  if (node === null) return { goal: null, empty: 'Pick a goal on the map: its steps and what it still misses show here.' }
  const steps = (backlog ?? []).flatMap(activity => activity.steps ?? []).filter(step => typeof step.id === 'string')
  const byId = new Map(steps.map(step => [step.id, step]))
  const named = [...new Set([...(node.steps ?? []), ...(node.parts ?? []).flatMap(part => part.steps ?? [])])]
  const number = id => Number(String(id).slice(1))
  const others = steps.filter(step => step.item?.goal === node.id && !named.includes(step.id)).map(step => step.id).sort((a, b) => number(a) - number(b))
  // The review: a step keeps its number whatever the filter shows.
  const all = [...named, ...others].map(id => byId.get(id)).filter(step => step !== undefined && step.flow?.state !== 'dropped').map((step, index) => {
    const [badge, tone] = goalStepBadge(step)
    const line = String(step.item?.summary?.[0] ?? step.item?.what?.[0] ?? '').replace(/\s+/g, ' ').trim()
    return { n: index + 1, id: step.id, key: step.key ?? step.id, title: step.title, line: line.length > 140 ? `${line.slice(0, 139)}…` : line, badge, tone, chat: step.worker ?? '' }
  })
  const done = all.filter(row => row.tone === 'done')
  const open = all.filter(row => row.tone !== 'done')
  const filter = ['all', 'open', 'done'].includes(ui.filter) ? ui.filter : 'all'
  const shown = filter === 'open' ? open : filter === 'done' ? done : ui.showDone === true ? all : open
  const missing = (node.missing ?? []).map((text, index) => {
    const [title, ...rest] = text.split(/\s+[—–]\s+/)
    return { index, text, title: title.trim(), sub: rest.length === 0 ? null : rest.join(' — ').trim() }
  })
  const tab = ui.tab === 'missing' ? 'missing' : 'steps'
  const allowed = ui.canWrite === true
  return {
    goal: { id: node.id, title: node.title },
    tab,
    tabs: [{ key: 'steps', label: 'Associated tasks', count: all.length, isOn: tab === 'steps' }, { key: 'missing', label: 'Missing tasks', count: missing.length, isOn: tab === 'missing' }],
    filter,
    filters: [['all', 'All'], ['open', 'Open'], ['done', 'Done']].map(([key, label]) => ({ key, label, isOn: filter === key })),
    rows: shown,
    // The review: shown, they fold again.
    foldedDone: filter !== 'all' || done.length === 0 ? null : ui.showDone === true ? `Hide the ${done.length === 1 ? 'completed step' : `${done.length} completed steps`}` : `Show ${done.length} completed step${done.length === 1 ? '' : 's'}`,
    missing,
    addAll: missing.length < 2 ? null : { label: `Add all ${missing.length} to this goal`, isEnabled: allowed, title: allowed ? `Each becomes a new step under ${node.id}; your partner refines it` : ui.whyNot ?? 'This board only shows.' },
    canWrite: allowed,
    whyNot: allowed ? null : ui.whyNot ?? 'This board only shows.',
  }
}
// goalsteps:end

const GOAL_STATES = { open: 'open', now: 'in progress', done: 'done' }
/** B256: what each editor asks for, and the words of its box. */
const GOAL_EDITORS = {
  add: 'The new goal, in a few words',
  sibling: 'The next goal, in a few words',
  rename: 'The goal, in a few words',
  'Done when': 'Done when …',
  Why: 'Why …',
  note: 'A note',
  Enables: 'Find the goal it enables',
  'Also part of': 'Find the goal it is also part of',
  group: 'The new goal they go under',
}
const GOAL_CONFIRM_MS = 5000
const GOAL_NOTE_MS = 8000

/**
 * B256: what the person is doing on the Goals part, which a redraw keeps: the editor that is open (`editing`: its kind,
 * the goal, the words typed so far), the goals chosen with Ctrl-click, a "click again" (`confirm`: delete, dissolve or
 * done with open goals inside, for five seconds), the line after a refused change (`note`), how many of this page's
 * changes Ctrl+Z can undo, whether a change is on its way, and the goal being dragged.
 */
const goalsUi = { editing: null, chosen: new Set(), confirm: null, note: null, undoable: 0, busy: false, drag: null, menu: null, menuInto: false, menuWords: '', justDragged: false }

function goalsData(state) {
  const editing = goalsUi.editing === null ? null : { kind: goalsUi.editing.kind, id: goalsUi.editing.id }
  return [state.goals ?? null, state.goalsFile ?? null, state.goalsEdit ?? null, goalsFocus, [...goalsOpened], goalsLinesOpen, editing, [...goalsUi.chosen], goalsUi.confirm, goalsUi.note, goalsUi.undoable, goalsUi.busy, goalsUi.menu, goalsUi.menuInto, goalsViews, goalsHideDone, state.advisor?.name ?? null, state.advisor?.isRunning ?? null, state.goalAsksFolder ?? null]
}

const canEditGoals = state => state?.goalsEdit?.canWrite === true
/** Asked and not yet answered; a second click within GOAL_CONFIRM_SLOW_MS (a double-click) is no answer. */
const isConfirming = (kind, id) => goalsUi.confirm !== null && goalsUi.confirm.kind === kind && goalsUi.confirm.id === id
const isConfirmed = (kind, id) => isConfirming(kind, id) && Date.now() - goalsUi.confirm.at >= GOAL_CONFIRM_SLOW_MS
const GOAL_CONFIRM_SLOW_MS = 400
/** B256: this page's own word, so the board undoes this page's changes and no other's. */
const GOALS_PAGE = Math.random().toString(36).slice(2, 12).padEnd(6, '0')

function goalButton(className, text, data = {}) {
  const button = el('button', className, text)
  button.type = 'button'
  Object.assign(button.dataset, data)
  return button
}

/** The box an editor is typed in, with what was typed so far; Enter keeps it, Esc lets it go. */
function goalEditorBox(goals) {
  const editing = goalsUi.editing
  const box = el('div', 'goals-editor')
  const input = el('input', 'goals-input')
  input.type = 'text'
  input.id = 'goals-input'
  input.maxLength = editing.kind === 'Done when' || editing.kind === 'Why' || editing.kind === 'note' ? 300 : 120
  input.placeholder = GOAL_EDITORS[editing.kind] ?? ''
  input.value = editing.value ?? ''
  input.setAttribute('aria-label', GOAL_EDITORS[editing.kind] ?? 'Goal')
  box.append(input)
  if (editing.kind === 'Enables' || editing.kind === 'Also part of') box.append(goalChoicesList(goals))
  box.append(el('small', 'muted', editing.kind === 'Enables' || editing.kind === 'Also part of' ? 'Click a goal · Esc closes' : 'Enter keeps it · Esc closes'))
  return box
}

function goalChoicesList(goals) {
  const editing = goalsUi.editing
  const list = el('div', 'goals-choices')
  list.id = 'goals-choices'
  const choices = goalLinkChoices(goals, editing.id, editing.kind, editing.value ?? '').slice(0, 8)
  if (choices.length === 0) list.append(el('span', 'muted', 'No goal fits those words.'))
  for (const choice of choices) {
    const button = goalButton('goals-choice', '', { linkTarget: choice.id })
    button.append(el('b', '', goalLabel(choice)), el('small', 'muted', choice.where === null ? ' · at the top' : ` · in ${choice.where}`))
    list.append(button)
  }
  return list
}

/** An editor in the outline: a row at the depth the new goal will stand. */
function goalEditorRow(goals, depth) {
  const row = el('div', `goal-row goal-depth-${Math.min(depth, 8)} is-editor`)
  row.append(el('span', 'goal-fold'), el('span', 'goal-dot is-open'), goalEditorBox(goals))
  return row
}

function drawGoals(state) {
  const goals = state.goals ?? null
  $('goals-find').hidden = goals === null || goals.nodes.length === 0
  const canEdit = canEditGoals(state)
  drawUnlinked(goals)
  // B257: the view buttons say what shows at this width (a phone shows the outline unless the diagram is chosen).
  showGoalsViews()
  // B316: the switch says how many goals it hides, on or off.
  showGoalsHideDone(goals === null ? 0 : goalsHidden(goals, goalsFocus).size)
  if (goals === null || (goals.nodes.length === 0 && goals.problems.length === 0)) {
    fill($('goals-crumb'), [el('span', 'goals-here', 'Goals')])
    $('goals-count').textContent = ''
    $('goals-problems').hidden = true
    $('goals-frame').hidden = true
    $('goals-chosen').hidden = true
    // A file without goals takes its first one here; without a file the Advisor writes it first.
    fill($('goals-actions'), goals !== null && canEdit ? [goalButton('goals-action', '+ Goal', { goalAction: 'add' })] : [])
    $('goals-note').hidden = goalsUi.note === null
    $('goals-note').textContent = goalsUi.note?.text ?? ''
  $('goals-note').classList.toggle('is-ok', goalsUi.note?.tone === 'ok')
    fill($('goals-outline'), [el('p', 'muted goals-empty', goals === null
      ? `No goal map yet. The Advisor writes ${state.goalsFile ?? '.claude/goals.md'} with you; the board draws it here.`
      : `${state.goalsFile ?? 'The goals file'} holds no goal yet. The Advisor writes them with you; the board draws them here.`),
    goals !== null && canEdit && goalsUi.editing?.kind === 'add' ? goalEditorRow(goals, 0) : null])
    if ($('goals-input') !== null) $('goals-input').focus()
    showGoalAsk()
    drawGoalTree(state)
    return
  }
  const focus = goalById(goals, goalsFocus)
  const crumb = goalCrumb(goals, focus?.id ?? null)
  const back = el('button', 'goals-back', '‹')
  back.type = 'button'
  back.title = 'Zoom out one level (Esc)'
  back.disabled = focus === null
  if (focus !== null) back.dataset.goal = crumb.at(-2).id ?? ''
  fill($('goals-crumb'), [back, ...crumb.flatMap((step, place) => {
    const isHere = place === crumb.length - 1
    // B284: each goal with its id; the top ("Goals") has none.
    const part = isHere ? el('span', 'goals-here') : el('button', 'goals-link')
    part.append(...goalLabelNodes(step))
    if (!isHere) part.type = 'button'
    // B256: a crumb also takes a dropped goal, as its last goal inside.
    part.dataset.goal = step.id ?? ''
    return place === 0 ? [part] : [el('span', 'goals-sep', '›'), part]
  })])
  $('goals-count').textContent = focus === null ? `${goals.roots.length} goal${goals.roots.length === 1 ? '' : 's'}` : goalCounter(focus.counts)
  $('goals-problems').hidden = goals.problems.length === 0
  $('goals-problems').textContent = goals.problems.length === 0 ? '' : `${state.goalsFile ?? 'The goals file'} has a mistake, drawn as well as it goes: ${goals.problems.join(' · ')}`

  // B256: the actions of the whole map, and a refused change in one line.
  const actions = []
  if (!canEdit) {
    const only = el('span', 'goals-readonly muted', 'Read only here')
    only.title = state.goalsEdit?.whyNot ?? 'This board does not change the map.'
    actions.push(only)
  } else {
    if (focus === null) actions.push(goalButton('goals-action', '+ Goal', { goalAction: 'add' }))
    const undo = goalButton('goals-action', '↶ Undo', { goalAction: 'undo' })
    undo.title = 'Undo the last change made on this page (Ctrl+Z)'
    undo.disabled = goalsUi.undoable === 0 || goalsUi.busy
    actions.push(undo)
  }
  fill($('goals-actions'), actions)
  $('goals-note').hidden = goalsUi.note === null
  $('goals-note').textContent = goalsUi.note?.text ?? ''
  $('goals-note').classList.toggle('is-ok', goalsUi.note?.tone === 'ok')

  // B256: the goals chosen with Ctrl-click, to put under a new goal.
  const chosen = [...goalsUi.chosen].filter(id => goalById(goals, id) !== null)
  $('goals-chosen').hidden = !canEdit || chosen.length === 0
  if (canEdit && chosen.length > 0) {
    const parts = [el('span', '', `${chosen.length} chosen`)]
    if (goalsUi.editing?.kind === 'group') parts.push(goalEditorBox(goals))
    else parts.push(goalButton('goals-action', 'Group under a new goal…', { goalAction: 'group' }))
    parts.push(goalButton('goals-action', 'Clear', { goalAction: 'clear' }))
    fill($('goals-chosen'), parts)
  }

  $('goals-frame').hidden = focus === null
  if (focus !== null) {
    const head = el('div', 'goals-frame-head')
    const isRenaming = goalsUi.editing?.kind === 'rename' && goalsUi.editing.id === focus.id
    head.append(el('span', `goal-dot is-${focus.state}`), isRenaming ? goalEditorBox(goals) : goalFrameTitle(focus), el('span', `goals-frame-state is-${focus.state}`, GOAL_STATES[focus.state] ?? focus.state))
    const lines = goalFrameLines(goals, focus)
    // B258: an ask read already folds away with the lines; the others always show, as blocks under the frame's tools.
    const readAsks = focus.asks.filter(ask => goalAskState(ask) === 'read').length
    const summary = el('div', 'goals-frame-line')
    // Unfolded, the lines say it all: the folded line goes.
    if (!goalsLinesOpen || lines.length === 0) summary.append(el('span', '', goalFrameLine(focus)))
    if (lines.length > 0 || readAsks > 0) {
      const folded = [lines.length > 0 ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : null, readAsks > 0 ? `${readAsks} ask${readAsks === 1 ? '' : 's'} read` : null].filter(Boolean).join(' · ')
      const toggle = el('button', 'goals-lines', goalsLinesOpen ? 'fold ▾' : `${folded} ▸`)
      toggle.type = 'button'
      toggle.id = 'goals-lines'
      toggle.setAttribute('aria-expanded', String(goalsLinesOpen))
      summary.append(toggle)
    }
    const parts = [head, summary, goalsLinesOpen && lines.length > 0 ? fill(el('ul', 'goals-frame-lines'), lines.map(line => el('li', '', line))) : null]
    if (canEdit) {
      // The links it has, each with its ×.
      const links = [...focus.enables.map(target => ['Enables', target]), ...focus.alsoPartOf.map(target => ['Also part of', target])]
      if (links.length > 0) {
        parts.push(fill(el('div', 'goals-links'), links.map(([name, target]) => {
          const link = el('span', 'goal-tag')
          link.append(`${name === 'Enables' ? 'enables' : 'also part of'} ${goalById(goals, target)?.title ?? target} `, goalButton('goals-unlink', '×', { unlink: name, target }))
          return link
        })))
      }
      const tools = el('div', 'goals-tools')
      for (const [kind, words] of goalTools(focus)) {
        const isDrop = kind === 'dissolve' || kind === 'delete'
        const tool = goalButton(`goals-tool${isDrop ? ` is-${kind}` : ''}`, isDrop && isConfirming(kind, focus.id) ? `Click again to ${kind} it` : words, { goalTool: kind })
        if (kind === 'dissolve') tool.title = 'Lift the goals inside it into its place, and remove it'
        if (kind === 'delete') tool.title = 'Remove it and the links to it'
        tools.append(tool)
      }
      // B258: ask the Advisor about this goal, when the board has an Advisor: second, after "+ Sub-goal".
      if ((state.advisor ?? null) !== null) tools.insertBefore(goalButton('goals-tool is-ask', 'Ask the Advisor…', { goalTool: 'ask' }), tools.children[1] ?? null)
      // B259: think it through with the Advisor, one question at a time, on the Brainstorm part.
      if ((state.advisor ?? null) !== null) tools.insertBefore(goalButton('goals-tool is-ask', 'Brainstorm this', { goalTool: 'brainstorm' }), tools.children[2] ?? null)
      // B358, the review: a re-check that is asked can be taken back; the goal stays open.
      if ((focus.recheckAsked ?? null) !== null && focus.state !== 'done') tools.append(goalButton('goals-tool', 'Take the re-check back', { goalTool: 'recheck-back' }))
      // B354: a goal without a Done when is not ticked and not picked as the focus: the partner is asked to write one.
      // The review: also a goal of the game plan, whose line the partner takes from its milestone in the plan.
      if ((state.advisor ?? null) !== null && focus.state !== 'done' && !hasDoneWhenLine(focus)) {
        tools.insertBefore(goalButton('goals-tool is-ask', 'Ask your partner for a Done when', { goalTool: 'done-when' }), tools.children[1] ?? null)
      }
      if (focus.fromPlan) tools.append(el('small', 'muted', 'Its title and Done when are the game plan\'s.'))
      parts.push(tools)
      const editing = goalsUi.editing
      if (editing !== null && editing.id === focus.id && !['rename', 'add', 'sibling', 'group'].includes(editing.kind)) parts.push(goalEditorBox(goals))
    }
    for (const block of goalAskBlocks(focus, goalsLinesOpen)) parts.push(goalAskBlockNode(focus, block, canEdit))
    fill($('goals-frame'), parts)
  }
  showGoalAsk()

  // A redraw keeps the keyboard where it was: on the same row's arrow, title or "…", in its menu, or on a box.
  const active = document.activeElement
  const had = active?.closest?.('#goals-outline .goal-row') ?? null
  const kept = had === null ? null : { goal: had.dataset.goal, isRef: had.classList.contains('is-ref'), part: active.classList.contains('goal-fold') ? '.goal-fold' : active.classList.contains('goal-more') ? '.goal-more' : '.goal-title' }
  const inMenu = active?.closest?.('.goal-menu') ? (active.id === 'goals-menu-words' ? '#goals-menu-words' : /^[a-z]+$/.test(active.dataset?.menuAction ?? '') ? `.goal-menu [data-menu-action="${active.dataset.menuAction}"]` : null) : null
  const inTree = active?.closest?.('#goals-diagram') && /^G\d+$/.test(active.dataset?.goal ?? '') ? `#goals-diagram [data-goal="${active.dataset.goal}"]` : null
  const rows = goalOutlineRows(goals, focus?.id ?? null, goalsOpened, goalsHiddenNow(goals))
  const chain = new Set(crumb.map(step => step.id).filter(id => id !== null))
  const drawn = rows.map(row => {
    // B316: where hidden goals stood, one line; a click shows them again.
    if (row.id === null) return goalButton(`goals-hidden-line goal-depth-${Math.min(row.depth, 8)}${row.isDim ? ' is-dim' : ''}`, `+${row.hidden} done hidden`, { goalsShowDone: '' })
    const line = el('div', `goal-row goal-depth-${Math.min(row.depth, 8)}${row.isFocus ? ' is-focus' : ''}${row.isDim ? ' is-dim' : ''}${row.isRef ? ' is-ref' : ''}${goalsUi.chosen.has(row.id) && !row.isRef ? ' is-chosen' : ''}`)
    line.dataset.goal = row.id
    const mark = row.fold === null ? '' : row.fold === 'open' ? '▾' : '▸'
    const fold = row.foldable ? el('button', 'goal-fold', mark) : el('span', 'goal-fold', mark)
    if (row.foldable) {
      fold.type = 'button'
      fold.setAttribute('aria-label', row.fold === 'open' ? `Fold ${row.title}` : `Unfold ${row.title}`)
      fold.setAttribute('aria-expanded', String(row.fold === 'open'))
    }
    // B256: the dot changes the state; done with open goals inside asks once.
    const dot = canEdit && !row.isRef ? goalButton(`goal-dot is-${row.state}`, '', { goalDot: row.id }) : el('span', `goal-dot is-${row.state}`)
    if (canEdit && !row.isRef) dot.title = `${GOAL_STATES[row.state]}: click for ${GOAL_STATES[goalNextState(row.state)]}`
    const isRenaming = goalsUi.editing?.kind === 'rename' && goalsUi.editing.id === row.id && !row.isRef && !row.isFocus
    // B284: its id first.
    const title = isRenaming ? goalEditorBox(goals) : el('button', 'goal-title')
    if (!isRenaming) title.append(...goalLabelNodes(row, row.isRef ? '↗ ' : ''))
    if (!isRenaming) {
      title.type = 'button'
      title.title = row.isRef ? 'Its home is elsewhere: zoom into it there' : 'Zoom in · Enter adds the next goal · F2 renames · drag to move'
    }
    const asks = isConfirming('done', row.id) ? [el('span', 'goal-tag is-ask', 'goals inside are open: click the dot again to mark it done')] : []
    // B257: the row's "…": every change without dragging.
    const more = canEdit && !row.isRef ? goalButton('goal-more', '…', { goalMenu: row.id }) : null
    if (more !== null) {
      more.setAttribute('aria-label', `More for ${row.title}`)
      more.setAttribute('aria-expanded', String(goalsUi.menu === row.id))
    }
    line.append(fold, dot, title, ...row.tags.map(tag => el('span', `goal-tag${tag.startsWith('enables') ? ' is-enables' : /^(?:\d+ asks? pending|answer to read)$/.test(tag) ? ' is-asking' : ''}`, tag)), ...asks, el('span', 'goal-meta', row.counter))
    if (more !== null) line.append(more)
    // B256: rows move by dragging, all but the references and the path down to the focus.
    if (canEdit && !row.isRef && !chain.has(row.id)) line.draggable = true
    return line
  })
  // An editor for a new goal stands where the goal will: after its parent's rows (add) or its sibling's (sibling).
  const editing = goalsUi.editing
  if (canEdit && editing !== null && (editing.kind === 'add' || editing.kind === 'sibling')) {
    const anchor = editing.id === null ? -1 : rows.findIndex(row => row.id === editing.id && !row.isRef)
    if (editing.id === null || anchor >= 0) {
      const depth = editing.id === null ? 0 : rows[anchor].depth
      let at = editing.id === null ? rows.length : anchor + 1
      while (at < rows.length && rows[at].depth > depth) at += 1
      drawn.splice(at, 0, goalEditorRow(goals, editing.kind === 'add' && editing.id !== null ? depth + 1 : depth))
    }
  }
  // B257: the open "…" menu stands right under its row.
  if (canEdit && goalsUi.menu !== null) {
    const at = drawn.findIndex(line => line.dataset.goal === goalsUi.menu && !line.classList.contains('is-ref'))
    const node = goalById(goals, goalsUi.menu)
    if (at >= 0 && node !== null) drawn.splice(at + 1, 0, goalMenuRow(goals, node, rows.find(row => row.id === node.id && !row.isRef)?.depth ?? 0))
  }
  fill($('goals-outline'), drawn)
  drawGoalTree(state)
  // The editor takes the keys, unless the person types somewhere else on the page.
  const typingElsewhere = document.activeElement?.closest?.('input, textarea') && !$('advisor-goals').contains(document.activeElement)
  if ($('goals-input') !== null && !typingElsewhere) $('goals-input').focus()
  else if (inMenu !== null && document.querySelector(inMenu) !== null) document.querySelector(inMenu).focus()
  else if (inTree !== null && document.querySelector(inTree) !== null) document.querySelector(inTree).focus()
  else if (kept !== null) {
    const row = [...$('goals-outline').querySelectorAll('.goal-row')].find(one => one.dataset.goal === kept.goal && one.classList.contains('is-ref') === kept.isRef)
    row?.querySelector(`button${kept.part}`)?.focus()
  }
}

function redrawGoals() {
  if (board !== null && board !== undefined) once('goals', goalsData(board), () => drawGoals(board))
  redrawGoalSteps()
}

// B383: the right panel "Steps for this goal": what the person chose in it, and its drawing.
const goalStepsUi = { tab: 'steps', filter: 'all', showDone: false, menu: null, busy: false, goal: null }
function goalStepsData(state) {
  return [state.goals ?? null, goalsFocus, state.backlog ?? null, canEditGoals(state), state.goalsEdit?.whyNot ?? null, goalStepsUi.tab, goalStepsUi.filter, goalStepsUi.showDone, goalStepsUi.menu, goalStepsUi.busy, goalsUi.busy]
}
function redrawGoalSteps() {
  if (board !== null && board !== undefined) once('goalsteps', goalStepsData(board), () => drawGoalSteps(board))
}

/** B383: draws the panel from goalStepsView, as the person's design picture has it. */
function drawGoalSteps(state) {
  const box = $('goals-steps')
  if (box === null) return
  // The review: another goal opens with its completed steps folded and no menu open.
  if (goalStepsUi.goal !== goalsFocus) Object.assign(goalStepsUi, { goal: goalsFocus, showDone: false, menu: null })
  // The review: the key that had the focus keeps it after the redraw.
  const focused = box.contains(document.activeElement) ? ['goalStepsTab', 'goalStepsFilter', 'goalStepMenu', 'goalStepOpen', 'missingAdd', 'missingDismiss', 'missingAll', 'goalStepsShowDone'].find(key => key in document.activeElement.dataset) : undefined
  const focusedAt = focused === undefined ? null : [focused, document.activeElement.dataset[focused]]
  const view = goalStepsView(state.goals ?? null, goalsFocus, state.backlog ?? [], { ...goalStepsUi, canWrite: canEditGoals(state), whyNot: state.goalsEdit?.whyNot ?? null })
  const head = [el('h2', '', 'Tasks for this goal')]
  if (view.goal === null) return fill(box, [...head, el('p', 'muted', view.empty)])
  head.push(el('p', 'goal-steps-of', `${view.goal.id} · ${view.goal.title}`))
  const tabs = el('div', 'goal-steps-tabs')
  for (const one of view.tabs) {
    const tab = el('button', `goal-steps-tab${one.isOn ? ' is-on' : ''}${one.key === 'missing' && one.count > 0 ? ' is-missing' : ''}`, one.label)
    tab.type = 'button'
    tab.dataset.goalStepsTab = one.key
    tab.setAttribute('aria-pressed', String(one.isOn))
    tab.append(el('span', 'goal-steps-count', String(one.count)))
    tabs.append(tab)
  }
  const parts = [...head, tabs]
  if (view.tab === 'steps') {
    const filters = el('div', 'goal-steps-filters')
    for (const one of view.filters) {
      const button = el('button', one.isOn ? 'is-on' : '', one.label)
      button.type = 'button'
      button.dataset.goalStepsFilter = one.key
      button.setAttribute('aria-pressed', String(one.isOn))
      filters.append(button)
    }
    parts.push(filters, el('h3', 'goal-steps-title', 'Associated tasks'), el('p', 'muted', 'Tasks that contribute to this goal.'))
    const list = el('ol', 'goal-steps-list')
    for (const row of view.rows) {
      const item = el('li', `goal-step tone-${row.tone}`)
      const open = el('button', 'goal-step-open')
      open.type = 'button'
      open.dataset.goalStepOpen = row.key
      open.title = `Open ${row.id}`
      open.append(el('span', 'goal-step-n', String(row.n)))
      const words = el('span', 'goal-step-words')
      words.append(el('b', '', row.title), ...(row.line === '' ? [] : [el('small', '', row.line)]))
      open.append(words)
      const side = el('span', 'goal-step-side')
      side.append(el('span', `goal-step-badge tone-${row.tone}`, row.badge), ...(row.chat === '' ? [] : [el('small', '', row.chat)]))
      const more = el('button', 'goal-step-more', '⋮')
      more.type = 'button'
      more.dataset.goalStepMenu = row.key
      more.setAttribute('aria-label', `More for ${row.id}`)
      more.setAttribute('aria-expanded', String(goalStepsUi.menu === row.key))
      item.append(open, side, more)
      if (goalStepsUi.menu === row.key) {
        const menu = el('div', 'goal-step-menu')
        const step = goalButton('goals-tool', `Open ${row.id}`, { goalStepOpen: row.key })
        menu.append(step)
        if (row.chat !== '') menu.append(goalButton('goals-tool', `Open ${row.chat}'s window`, { goalStepChat: row.chat }))
        item.append(menu)
      }
      list.append(item)
    }
    if (view.rows.length === 0) list.append(el('li', 'muted', view.filter === 'done' ? 'No task of this goal is done yet.' : 'No open task under this goal.'))
    parts.push(list)
    if (view.foldedDone !== null) parts.push(goalButton('goal-steps-fold', `› ${view.foldedDone}`, { goalStepsShowDone: '' }))
  }
  if (view.missing.length > 0 || view.tab === 'missing') parts.push(goalMissingBox(view))
  fill(box, parts)
  if (focusedAt !== null) [...box.querySelectorAll('button')].find(button => button.dataset[focusedAt[0]] === focusedAt[1])?.focus()
}

/** B383: the box of the goal's Missing lines, each with Add step and Dismiss, and "Add all". */
function goalMissingBox(view) {
  const part = el('section', 'goal-missing')
  part.append(el('h3', '', '⚠ Missing tasks'))
  if (view.missing.length === 0) {
    part.append(el('p', 'muted', 'Nothing is missing: every outcome of this goal has a task.'))
    return part
  }
  part.append(el('p', 'muted', 'These outcomes have no task yet. Add tasks to make this goal complete.'))
  for (const one of view.missing) {
    const row = el('div', 'goal-missing-row')
    const words = el('span', 'goal-missing-words')
    words.append(el('b', '', one.title), ...(one.sub === null ? [] : [el('small', '', one.sub)]))
    const add = goalButton('goal-missing-add', '+ Add step', { missingAdd: String(one.index) })
    const dismiss = goalButton('goal-missing-dismiss', 'Dismiss', { missingDismiss: String(one.index) })
    for (const button of [add, dismiss]) {
      button.disabled = !view.canWrite || goalStepsUi.busy
      button.title = view.canWrite ? (button === add ? `A new step under ${view.goal.id}; your partner refines it` : 'This line goes from the goal') : view.whyNot
    }
    const acts = el('span', 'goal-missing-acts')
    acts.append(add, dismiss)
    row.append(el('span', 'goal-missing-sign', '!'), words, acts)
    part.append(row)
  }
  if (view.addAll !== null) {
    const all = goalButton('goal-missing-all', view.addAll.label, { missingAll: '' })
    all.disabled = !view.addAll.isEnabled || goalStepsUi.busy
    all.title = view.addAll.title
    part.append(all)
  }
  return part
}

/** B383: a Missing line (`index`, or all) made into steps under the selected goal, or dismissed. */
async function goalMissingAct(kind, index) {
  const node = board?.goals ? goalById(board.goals, goalsFocus) : null
  if (node === null || goalStepsUi.busy) return
  goalStepsUi.busy = true
  redrawGoalSteps()
  try {
    if (kind === 'dismiss') {
      const line = node.missing[index]
      if (line !== undefined && await sendGoals({ command: 'missing-dismiss', id: node.id, line }) !== null) goalsSay('The line is taken out of the goal.', 'ok')
    } else {
      // The review: the line goes by its words, so a map changed meanwhile never makes a step of another line.
      const done = await sendGoals(kind === 'all' ? { command: 'missing-add', id: node.id, all: true } : { command: 'missing-add', id: node.id, index, line: node.missing[index] })
      const made = done?.made ?? []
      const failed = (done?.failed ?? []).map(one => `"${one.line}": ${one.why}`).join(' ')
      if (made.length > 0) goalsSay(`${made.join(', ')} ${made.length === 1 ? 'is' : 'are'} on the backlog under ${node.id}: your partner refines ${made.length === 1 ? 'it' : 'them'}.${failed === '' ? '' : ` Not made: ${failed}`}`, failed === '' ? 'ok' : 'problem')
    }
  } finally {
    goalStepsUi.busy = false
    redrawGoalSteps()
  }
}

$('goals-steps').addEventListener('click', event => {
  const tab = event.target.closest('[data-goal-steps-tab]')
  if (tab !== null) {
    goalStepsUi.tab = tab.dataset.goalStepsTab
    goalStepsUi.menu = null
    return redrawGoalSteps()
  }
  const filter = event.target.closest('[data-goal-steps-filter]')
  if (filter !== null) {
    goalStepsUi.filter = filter.dataset.goalStepsFilter
    return redrawGoalSteps()
  }
  if (event.target.closest('[data-goal-steps-show-done]') !== null) {
    goalStepsUi.showDone = !goalStepsUi.showDone
    return redrawGoalSteps()
  }
  const menu = event.target.closest('[data-goal-step-menu]')
  if (menu !== null) {
    goalStepsUi.menu = goalStepsUi.menu === menu.dataset.goalStepMenu ? null : menu.dataset.goalStepMenu
    return redrawGoalSteps()
  }
  const open = event.target.closest('[data-goal-step-open]')
  if (open !== null) {
    goalStepsUi.menu = null
    return openDetails({ step: open.dataset.goalStepOpen })
  }
  const chat = event.target.closest('[data-goal-step-chat]')
  if (chat !== null) {
    goalStepsUi.menu = null
    return openDetails({ lane: chat.dataset.goalStepChat, task: true })
  }
  const add = event.target.closest('[data-missing-add]')
  if (add !== null && !add.disabled) return goalMissingAct('add', Number(add.dataset.missingAdd))
  const dismiss = event.target.closest('[data-missing-dismiss]')
  if (dismiss !== null && !dismiss.disabled) return goalMissingAct('dismiss', Number(dismiss.dataset.missingDismiss))
  const all = event.target.closest('[data-missing-all]')
  if (all !== null && !all.disabled) return goalMissingAct('all', null)
})

// B257: the goal tree, drawn as svg from goalTreeLayout. The person, 2026-10-15: "like a diagram of nodes what is a
// part of what", in zoom style 1 ("I like style 1"): the clicked box glides into the frame.
/** Which views the Goals part shows: both, the diagram alone or the outline alone; kept in this browser. */
let goalsViews = 'both'
try {
  const kept = localStorage.getItem('goals-views')
  if (['both', 'diagram', 'outline'].includes(kept)) goalsViews = kept
} catch {
  // Without storage both views show after each reload.
}
/** The tree as drawn last, for the drag's hit test. */
let goalsTree = null
const isPhone = () => matchMedia('(max-width: 760px)').matches

function svgEl(tag, attrs = {}, className = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value))
  if (className !== '') node.setAttribute('class', className)
  return node
}
function svgText(x, y, words, className) {
  const text = svgEl('text', { x, y }, className)
  text.textContent = words
  return text
}
const cut = (words, most) => (words.length <= most ? words : `${words.slice(0, most - 1)}…`)

/** B289: the open steps no goal names, folded under the map; a row opens the step's window. */
function drawUnlinked(goals) {
  const box = $('goals-unlinked')
  const view = unlinkedView(goals?.unlinked)
  box.hidden = view === null
  if (view === null) return
  // Drawn anew only when it changed, so a list the person opened stays open.
  once('goals-unlinked', view, () => {
    const list = el('div', 'goals-unlinked-list')
    for (const row of view.rows) {
      const button = el('button', 'goals-unlinked-row')
      button.type = 'button'
      button.dataset.unlinkedStep = row.id
      button.title = 'Show the step'
      button.append(el('span', 'step-id', row.id), el('span', 'goals-unlinked-title', row.title))
      list.append(button)
    }
    fill(box, [el('summary', '', view.summary), view.rows.length === 0 ? null : list])
  })
}

/** B284: a goal's label as page nodes: its id in a span of its own colour, then its title; `lead` before them ("↗ "). */
function goalLabelNodes(node, lead = '') {
  const parts = goalIdSplit(`${lead}${goalLabel(node)}`, node.id)
  return parts.id === '' ? [`${lead}${goalLabel(node)}`] : [parts.lead, el('span', 'goal-id', parts.id), parts.rest].filter(part => part !== '')
}

const ASK_STATES = { pending: 'waiting for the Advisor', answered: 'answered', read: 'read' }

/**
 * B258: one ask under the goal zoomed into: the question, the answer with its pictures and its page (More ↗, from the
 * project's folder or the asks' folder), and, on a board that writes the map, what the person can do with it.
 */
function goalAskBlockNode(node, block, canEdit) {
  const box = el('div', `goal-ask-block is-${block.state}`)
  box.dataset.askBlock = block.id
  const head = el('p', 'goal-ask-head')
  head.append(el('b', '', `? Ask ${block.id}`), el('small', 'muted', ` · ${block.at} · ${ASK_STATES[block.state]}`))
  box.append(head, el('p', 'goal-ask-question', block.question))
  if (block.answer !== null) {
    const answer = el('div', 'goal-ask-answer')
    answer.append(el('small', 'muted', `Answer · ${block.answer.at} · ${block.answer.by}`), el('p', '', block.answer.text))
    if (block.pictures.length > 0) answer.append(fill(el('div', 'goal-ask-pictures'), block.pictures.map(path => picture(path, `${block.id}: ${path}`))))
    box.append(answer)
  }
  const buttons = el('div', 'goals-tools')
  if (block.answer?.more) {
    const more = goalButton('goals-tool', 'More ↗', { gameFile: block.answer.more, projectFile: `${board?.goalAsksFolder ?? '.claude/goal-asks'}/${block.answer.more.split('/').pop()}` })
    more.title = `Open ${block.answer.more}`
    buttons.append(more)
  }
  if (canEdit && block.answer !== null) {
    buttons.append(goalButton('goals-tool', 'Make a step from this', { askAction: 'step', askId: block.id }), goalButton('goals-tool', 'Brainstorm this', { askAction: 'brainstorm', askId: block.id }), goalButton('goals-tool', 'Ask again', { askAction: 'again', askId: block.id }))
    if (block.state === 'answered') buttons.append(goalButton('goals-tool is-read', 'Done', { askAction: 'done', askId: block.id }))
  }
  if (buttons.children.length > 0) box.append(buttons)
  return box
}

/** B284: the title in the head of the frame of the goal zoomed into, with its id. */
function goalFrameTitle(focus) {
  const title = el('b', 'goals-frame-title')
  title.append(...goalLabelNodes(focus))
  return title
}

/** B258: an ask under the goal zoomed into, as a violet dashed box: its id, its question and where it stands. */
function goalAskBox(goals, box) {
  const ask = goalById(goals, goalsFocus)?.asks.find(one => one.id === box.id) ?? null
  const state = ask === null ? 'pending' : goalAskState(ask)
  const g = svgEl('g', { 'data-ask': box.id, tabindex: 0, role: 'button', 'aria-label': `Ask ${box.id}: ${ask?.text ?? ''}. ${state === 'pending' ? 'The Advisor has not answered yet' : 'Answered: read it'}` }, `goal-box is-ask is-${state}`)
  g.append(svgEl('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 8 }, 'goal-box-rect'))
  g.append(svgText(box.x + 10, box.y + 21, `? Ask ${box.id}`, 'goal-box-title goal-ask-title'))
  const question = svgEl('text', { x: box.x + 10, y: box.y + 40 }, 'goal-box-meta')
  goalTitleLines(ask?.text ?? '', 23).forEach((line, index) => {
    const span = svgEl('tspan', index === 0 ? {} : { x: box.x + 10, dy: 14 })
    span.textContent = line
    question.append(span)
  })
  g.append(question, svgText(box.x + 10, box.y + 84, state === 'pending' ? 'waiting for the Advisor' : 'answered · read it', 'goal-box-state'))
  return g
}

function goalBoxGroup(goals, box) {
  if (box.kind === 'ask') return goalAskBox(goals, box)
  const node = goalById(goals, box.id)
  const counts = node.counts
  const g = svgEl('g', { 'data-goal': box.id, tabindex: 0, role: 'button', 'aria-label': `${goalLabel(node)}: ${GOAL_STATES[node.state]}, ${goalCounter(counts)}` }, `goal-box is-${node.state} is-${box.kind}${goalsUi.chosen.has(box.id) && box.kind === 'child' ? ' is-chosen' : ''}`)
  g.append(svgEl('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 8 }, 'goal-box-rect'))
  const title = svgEl('text', { x: box.x + 10, y: box.y + 21 }, 'goal-box-title')
  // B284: its id first, in a colour of its own.
  goalTitleLines(`${box.kind === 'ref' ? '↗ ' : ''}${goalLabel(node)}`, 21).forEach((line, index) => {
    const span = svgEl('tspan', index === 0 ? {} : { x: box.x + 10, dy: 15 })
    const parts = index === 0 ? goalIdSplit(line, node.id) : { lead: '', id: '', rest: line }
    if (parts.id === '') span.textContent = line
    else {
      const id = svgEl('tspan', {}, 'goal-box-id')
      id.textContent = parts.id
      span.append(parts.lead, id, parts.rest)
    }
    title.append(span)
  })
  g.append(title)
  const steps = counts === null || counts === undefined || counts.steps === 0 ? (counts?.nodes > 0 ? `${counts.nodes} inside` : 'no steps yet') : `${counts.steps} step${counts.steps === 1 ? '' : 's'} · ${counts.done} done`
  g.append(svgText(box.x + 10, box.y + 56, steps, 'goal-box-meta'))
  if (counts?.missing > 0) g.append(svgText(box.x + 10, box.y + 70, `${counts.missing} missing`, 'goal-box-meta'))
  g.append(svgText(box.x + 10, box.y + 84, box.kind === 'ref' ? cut(`home: ${goalById(goals, node.parent)?.title ?? 'the top'}`, 22) : GOAL_STATES[node.state], 'goal-box-state'))
  // "+n": goals inside, a click away.
  if (box.kind === 'child' && node.children.length > 0) {
    g.append(svgEl('rect', { x: box.x + box.w - 36, y: box.y + box.h - 24, width: 28, height: 16, rx: 8 }, 'goal-badge'))
    g.append(svgText(box.x + box.w - 30, box.y + box.h - 12, `+${node.children.length}`, 'goal-badge-text'))
  }
  return g
}

/** One arrow from a point to another, dashed, with its head and a word on it. */
function goalArrow(from, to, isCurved) {
  const g = svgEl('g', {}, 'goal-arrow-group')
  const lift = Math.min(from.y, to.y) - 36
  const path = isCurved ? `M ${from.x} ${from.y} C ${from.x} ${lift} ${to.x} ${lift} ${to.x} ${to.y}` : `M ${from.x} ${from.y} L ${to.x} ${to.y}`
  g.append(svgEl('path', { d: path, 'marker-end': 'url(#goal-arrow)' }, 'goal-arrow'))
  g.append(svgText((from.x + to.x) / 2 - 18, isCurved ? lift + 22 : (from.y + to.y) / 2 - 4, 'enables', 'goal-arrow-label'))
  return g
}

function drawGoalTree(state) {
  const place = $('goals-diagram')
  const goals = state?.goals ?? null
  const width = Math.floor(place.clientWidth) - 12
  if (goals === null || goals.nodes.length === 0 || width < 160) {
    goalsTree = null
    return fill(place, [])
  }
  const focus = goalById(goals, goalsFocus)
  const layout = goalTreeLayout(goals, focus?.id ?? null, width, goalsHiddenNow(goals))
  goalsTree = layout
  const svg = svgEl('svg', { viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width, height: layout.height, role: 'group', 'aria-label': focus === null ? 'Your goals' : `Inside ${focus.title}` }, 'goal-tree')
  const defs = svgEl('defs')
  const marker = svgEl('marker', { id: 'goal-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
  marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z' }, 'goal-arrow-head'))
  defs.append(marker)
  svg.append(defs)
  if (layout.frame !== null) {
    const frame = layout.frame
    const g = svgEl('g', { 'data-goal': frame.id }, `goal-tree-frame is-${focus.state}`)
    g.append(svgEl('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, rx: 10 }, 'goal-frame-rect'))
    // B284: the goal's id first, in its own colour.
    const head = svgText(14, 26, '', 'goal-frame-title')
    const parts = goalIdSplit(cut(goalLabel(focus), Math.floor(frame.w / 9)), focus.id)
    if (parts.id === '') head.textContent = parts.rest
    else {
      const id = svgEl('tspan', {}, 'goal-box-id')
      id.textContent = parts.id
      head.append(id, parts.rest)
    }
    g.append(head)
    g.append(svgText(14, 48, cut(`${GOAL_STATES[focus.state]} · ${goalCounter(focus.counts)}`, Math.floor(frame.w / 7)), 'goal-frame-meta'))
    svg.append(g)
  }
  for (const line of layout.lines) svg.append(svgEl('line', { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }, 'goal-line'))
  for (const box of layout.boxes) svg.append(goalBoxGroup(goals, box))
  // Where an arrow starts and ends: a box's top middle, the frame's bottom middle (or its right side for a ghost).
  const shown = new Map(layout.boxes.map(box => [box.id, box]))
  const top = id => (shown.has(id) ? { x: shown.get(id).x + shown.get(id).w / 2, y: shown.get(id).y } : { x: layout.frame.x + layout.frame.w / 2, y: layout.frame.h })
  for (const arrow of layout.arrows) svg.append(goalArrow(top(arrow.from), top(arrow.to), shown.has(arrow.to)))
  for (const ghost of layout.ghosts) {
    const g = svgEl('g', { 'data-goal': ghost.id, tabindex: 0, role: 'button', 'aria-label': `${goalLabel(ghost)} enables this: go there` }, 'goal-ghost')
    g.append(svgEl('rect', { x: ghost.x, y: ghost.y, width: ghost.w, height: ghost.h, rx: 6 }))
    // B284: its id first, the part that still fits a narrow box.
    g.append(svgText(ghost.x + 8, ghost.y + 21, cut(`↗ ${goalLabel(ghost)}`, 13), ''))
    svg.append(g)
    const from = { x: ghost.x, y: ghost.y + ghost.h / 2 }
    for (const target of ghost.arrowTo) {
      const to = shown.has(target) ? top(target) : { x: layout.frame.x + layout.frame.w, y: Math.min(ghost.y + ghost.h / 2, layout.frame.h - 8) }
      svg.append(goalArrow(from, to, false))
    }
  }
  // B316: how many done goals hide here, under the boxes; a click shows them again.
  if (layout.hiddenLine !== null) {
    const count = layout.hiddenLine.count
    const line = svgText(layout.hiddenLine.x, layout.hiddenLine.y, `+${count} done hidden`, 'goal-hidden-text')
    for (const [name, value] of Object.entries({ 'text-anchor': 'middle', 'data-goals-show-done': '', tabindex: 0, role: 'button', 'aria-label': `${count} done goal${count === 1 ? '' : 's'} hidden here: show them` })) line.setAttribute(name, String(value))
    svg.append(line)
  }
  // More goals out of view enable these: counted under the ghosts.
  if (layout.moreGhosts > 0) {
    const last = layout.ghosts.at(-1)
    svg.append(svgText(last.x + 8, last.y + last.h + 14, `+${layout.moreGhosts} more enable it`, 'goal-ghost-more'))
  }
  fill(place, [svg])
}

/** The views as chosen: the split's classes and the buttons' state. */
function showGoalsViews() {
  const split = $('goals-split')
  split.classList.toggle('is-diagram-only', goalsViews === 'diagram')
  split.classList.toggle('is-outline-only', goalsViews === 'outline')
  const diagram = $('goals-views').querySelector('[data-goals-view="diagram"]')
  const outline = $('goals-views').querySelector('[data-goals-view="outline"]')
  // On a phone the outline shows unless the diagram is chosen alone.
  diagram.setAttribute('aria-pressed', String(isPhone() ? goalsViews === 'diagram' : goalsViews !== 'outline'))
  outline.setAttribute('aria-pressed', String(goalsViews !== 'diagram'))
}
$('goals-views').addEventListener('click', event => {
  const view = event.target.closest('[data-goals-view]')?.dataset.goalsView
  if (view === undefined) return
  // One view always shows: a click takes its own view away, or brings it back beside the other.
  if (isPhone()) setGoalsViews(view === 'diagram' && goalsViews !== 'diagram' ? 'diagram' : 'outline')
  else if (view === 'diagram') setGoalsViews(goalsViews === 'outline' ? 'both' : 'outline')
  else setGoalsViews(goalsViews === 'diagram' ? 'both' : 'diagram')
})
function setGoalsViews(views) {
  goalsViews = views
  try {
    localStorage.setItem('goals-views', goalsViews)
  } catch {
    // Kept for this page only.
  }
  showGoalsViews()
  if (board !== null) drawGoalTree(board)
}
showGoalsViews()

// B316: "Hide done" (the person, 2026-10-18: "i want an option to hide complete goals/milestone in the diagram"):
// off by default, kept in this browser; on, a goal done with every goal inside it done leaves the diagram and the
// outline (goalsHidden), the goal zoomed into never; the counters still count everything.
let goalsHideDone = false
try {
  goalsHideDone = localStorage.getItem('goals-hide-done') === 'on'
} catch {
  // Without storage the switch starts off after each reload.
}
/** The goals hidden now: none while the switch is off. */
function goalsHiddenNow(goals) { return goalsHideDone && goals !== null ? [...goalsHidden(goals, goalsFocus)] : [] }
function showGoalsHideDone(count) {
  const button = $('goals-hide-done')
  button.textContent = goalsHideLabel(count)
  button.setAttribute('aria-pressed', String(goalsHideDone))
}
function setGoalsHideDone(on) {
  goalsHideDone = on
  try {
    localStorage.setItem('goals-hide-done', on ? 'on' : 'off')
  } catch {
    // Kept for this page only.
  }
  redrawGoals()
}
$('goals-hide-done').addEventListener('click', () => setGoalsHideDone(!goalsHideDone))
$('goals-outline').addEventListener('click', event => {
  if (event.target.closest('[data-goals-show-done]') !== null) setGoalsHideDone(false)
})
// On a phone the switch stands behind the bar's "…".
$('goals-bar-more').addEventListener('click', () => {
  const opens = !$('goals-hide-wrap').classList.contains('is-open')
  $('goals-hide-wrap').classList.toggle('is-open', opens)
  $('goals-bar-more').setAttribute('aria-expanded', String(opens))
})
resizable($('goals-resizer'), $('goals-split'), 'goals-outline-width', 440)
// The tree is laid out for the width it has: drawn anew when that changes, but not while a box glides into the frame.
new ResizeObserver(() => {
  if (board !== null && !$('goals-diagram').classList.contains('is-gliding') && goalsTree?.width !== Math.floor($('goals-diagram').clientWidth) - 12) drawGoalTree(board)
}).observe($('goals-diagram'))
matchMedia('(max-width: 760px)').addEventListener('change', showGoalsViews)

/** A click on a box: it glides into the frame, then the map zooms into it. */
function goalsGlide(id) {
  const place = $('goals-diagram')
  // One glide at a time: a double-click is one zoom.
  if (place.classList.contains('is-gliding')) return
  const svg = place.querySelector('svg')
  const box = goalsTree?.boxes.find(one => one.id === id)
  if (!svg || !box || matchMedia('(prefers-reduced-motion: reduce)').matches) return zoomGoal(id)
  const scale = Math.min(4, goalsTree.width / box.w)
  const from = goalsFocus
  svg.style.transform = `translate(${-box.x * scale}px, ${-box.y * scale}px) scale(${scale})`
  svg.classList.add('is-gliding')
  place.classList.add('is-gliding')
  setTimeout(() => {
    place.classList.remove('is-gliding')
    // The map moved elsewhere meanwhile (Back, a crumb): that wins.
    if (goalsFocus === from) zoomGoal(id)
    else if (board !== null) drawGoalTree(board)
  }, 260)
}

$('goals-diagram').addEventListener('click', event => {
  if (goalsUi.justDragged || board?.goals === undefined) return
  // B316: the line where hidden goals stood shows them again.
  if (event.target.closest('[data-goals-show-done]') !== null) return setGoalsHideDone(false)
  // B258: an ask's box shows its block in the frame.
  const ask = event.target.closest('[data-ask]')
  if (ask !== null) return goalsShowAsk(ask.dataset.ask)
  const hit = event.target.closest('[data-goal]')
  // The empty ground zooms out one level.
  if (hit === null) {
    if (goalsFocus !== null && event.target.closest('svg') !== null) zoomGoal(goalZoomOut(board.goals, goalsFocus))
    return
  }
  if (hit.classList.contains('goal-tree-frame')) return
  if ((event.ctrlKey || event.metaKey) && canEditGoals(board) && hit.classList.contains('is-child')) {
    if (goalsUi.chosen.has(hit.dataset.goal)) goalsUi.chosen.delete(hit.dataset.goal)
    else goalsUi.chosen.add(hit.dataset.goal)
    return redrawGoals()
  }
  if (hit.classList.contains('goal-ghost')) return zoomGoal(hit.dataset.goal)
  goalsGlide(hit.dataset.goal)
})
$('goals-diagram').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  if (event.target.closest?.('[data-goals-show-done]')) {
    event.preventDefault()
    return setGoalsHideDone(false)
  }
  const ask = event.target.closest?.('[data-ask]')
  if (ask !== null && ask !== undefined) {
    event.preventDefault()
    return goalsShowAsk(ask.dataset.ask)
  }
  const hit = event.target.closest?.('[data-goal]')
  if (hit === null || hit === undefined) return
  event.preventDefault()
  if (hit.classList.contains('goal-ghost')) zoomGoal(hit.dataset.goal)
  else if (!hit.classList.contains('goal-tree-frame')) goalsGlide(hit.dataset.goal)
})
// Both views point at the same goal: hovering a box lights its row, and the other way round.
function goalsHoverSync(id) {
  for (const lit of document.querySelectorAll('#advisor-goals .is-hover')) lit.classList.remove('is-hover')
  if (id) for (const one of document.querySelectorAll(`#goals-outline .goal-row[data-goal="${id}"], #goals-diagram [data-goal="${id}"]`)) one.classList.add('is-hover')
}
for (const [id, pick] of [['goals-diagram', '[data-goal]'], ['goals-outline', '.goal-row']]) {
  $(id).addEventListener('mouseover', event => goalsHoverSync(event.target.closest?.(pick)?.dataset.goal ?? null))
  $(id).addEventListener('mouseleave', () => goalsHoverSync(null))
}

// B257: dragging a box in the tree: after 6 px it lifts and a label follows the pointer; its middle drops into a box,
// its sides before or after it, the frame last inside the goal zoomed into, a crumb into that goal; held over a box's
// middle for a second, the map zooms into it and the drag goes on there. Not on a phone (the "…" menu there).
let goalsTreePress = null
function goalsTreeDropAt(event, fromId) {
  const under = document.elementFromPoint(event.clientX, event.clientY)
  const crumb = under?.closest?.('.goals-crumb [data-goal]')
  if (crumb) return { kind: 'crumb', mark: crumb, place: 'into', over: crumb.dataset.goal || null, target: goalDropTarget(board.goals, fromId, crumb.dataset.goal === '' ? null : crumb.dataset.goal, 'into') }
  const svg = $('goals-diagram').querySelector('svg')
  if (!svg || goalsTree === null || !svg.contains(under)) return null
  const rect = svg.getBoundingClientRect()
  const drop = goalTreeDrop(board.goals, goalsTree, fromId, (event.clientX - rect.left) * (goalsTree.width / rect.width), (event.clientY - rect.top) * (goalsTree.height / rect.height))
  if (drop === null) return null
  return { ...drop, kind: drop.over === goalsTree.frame?.id ? 'frame' : 'box', mark: svg.querySelector(`[data-goal="${drop.over}"]`) }
}
function goalsTreeMark(at) {
  for (const marked of document.querySelectorAll('#goals-diagram .is-into, #goals-diagram .is-before, #goals-diagram .is-after, .goals-crumb .is-into')) marked.classList.remove('is-into', 'is-before', 'is-after')
  if (at?.target && at.mark) at.mark.classList.add(`is-${at.place}`)
}
function goalsTreeLetGo(press) {
  clearTimeout(press.hold?.timer)
  press.follower?.remove()
  goalsTreeMark(null)
  for (const lifted of document.querySelectorAll('#goals-diagram .is-lift')) lifted.classList.remove('is-lift')
}
$('goals-diagram').addEventListener('pointerdown', event => {
  if (event.button !== 0 || !canEditGoals(board) || isPhone()) return
  const hit = event.target.closest('g.goal-box.is-child')
  if (hit === null) return
  goalsTreePress = { id: hit.dataset.goal, x: event.clientX, y: event.clientY, lifted: false, follower: null, over: null, hold: null }
})
window.addEventListener('pointermove', event => {
  const press = goalsTreePress
  if (press === null || !board?.goals) return
  // Its button is up without a pointerup reaching here (a menu, another window): the drag is over, nothing moves.
  if (event.buttons === 0) {
    if (press.lifted) goalsTreeLetGo(press)
    goalsTreePress = null
    return
  }
  if (!press.lifted) {
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return
    press.lifted = true
    const lifted = goalById(board.goals, press.id)
    press.follower = el('div', 'goal-tree-follower', lifted === null ? press.id : goalLabel(lifted))
    document.body.append(press.follower)
  }
  document.querySelector(`#goals-diagram [data-goal="${press.id}"]`)?.classList.add('is-lift')
  press.follower.style.left = `${event.clientX + 12}px`
  press.follower.style.top = `${event.clientY + 10}px`
  const at = goalsTreeDropAt(event, press.id)
  goalsTreeMark(at)
  press.over = at
  const spring = at?.kind === 'box' && at.place === 'into' && at.target !== null ? at.over : null
  if (press.hold?.id !== spring) {
    clearTimeout(press.hold?.timer)
    press.hold = spring === null ? null : { id: spring, timer: setTimeout(() => { press.hold = null; zoomGoal(spring) }, 1000) }
  }
})
window.addEventListener('pointerup', event => {
  const press = goalsTreePress
  goalsTreePress = null
  if (press === null || !press.lifted) return
  // Where it is let go, in the map as it is now (a spring may have zoomed since the last move).
  const at = board?.goals ? goalsTreeDropAt(event, press.id) : null
  goalsTreeLetGo(press)
  // The click that ends a drag is no click on a box.
  goalsUi.justDragged = true
  setTimeout(() => { goalsUi.justDragged = false }, 0)
  if (at?.target) goalsMove(press.id, at.target)
})
window.addEventListener('pointercancel', () => {
  if (goalsTreePress?.lifted) goalsTreeLetGo(goalsTreePress)
  goalsTreePress = null
})

// B257: a row's "…" menu: move up, down or into another goal, link it, mark it done, rename, dissolve or delete it,
// without dragging (the phone's way; spec section 3). Brainstorm and asks join it with B259 and B258.
function goalMenuRow(goals, node, depth) {
  const menu = el('div', `goal-menu goal-depth-${Math.min(depth + 1, 8)}`)
  menu.dataset.menuOf = node.id
  const action = (words, name, isOff = false) => {
    const button = goalButton('goals-tool', words, { menuAction: name })
    button.disabled = isOff
    return button
  }
  const isPlan = Boolean(node.fromPlan)
  menu.append(
    action('Move up', 'up', goalKeyMove(goals, node.id, 'up') === null),
    action('Move down', 'down', goalKeyMove(goals, node.id, 'down') === null),
    action(goalsUi.menuInto ? 'Move into… ▾' : 'Move into…', 'into'),
    action('Also part of…', 'link'),
  )
  // B258: ask the Advisor about it, when the board has an Advisor.
  if ((board?.advisor ?? null) !== null) menu.append(action('Ask the Advisor…', 'ask'), action('Brainstorm this', 'brainstorm'))
  if (node.state !== 'done') menu.append(action(isConfirming('done', node.id) ? 'Goals inside are open: again to mark done' : 'Mark done', 'done'))
  if (!isPlan) {
    menu.append(action('Rename', 'rename'))
    const kind = node.children.length > 0 ? 'dissolve' : 'delete'
    menu.append(action(isConfirming(kind, node.id) ? `Again to ${kind} it` : kind === 'dissolve' ? 'Dissolve' : 'Delete', kind))
  }
  menu.append(action('Close', 'close'))
  if (goalsUi.menuInto) {
    const words = el('input', 'goals-input')
    words.type = 'text'
    words.id = 'goals-menu-words'
    words.placeholder = 'Find the goal it goes into'
    words.setAttribute('aria-label', 'Find the goal it goes into')
    words.value = goalsUi.menuWords
    menu.append(words, goalMenuChoices(goals, node))
  }
  return menu
}

/** The goals a goal may move into, whose titles hold every word typed; the first twenty. */
function goalMenuChoices(goals, node) {
  const list = el('div', 'goals-choices')
  list.id = 'goals-menu-choices'
  const wanted = goalsUi.menuWords.toLowerCase().split(/\s+/).filter(Boolean)
  const into = goals.nodes.filter(other => other.id !== node.parent && goalDropTarget(goals, node.id, other.id, 'into') !== null && wanted.every(word => goalLabel(other).toLowerCase().includes(word)))
  if (node.parent !== null && wanted.length === 0) list.append(goalButton('goals-choice', 'The top: a goal of its own', { moveInto: '' }))
  for (const other of into.slice(0, 20)) {
    const button = goalButton('goals-choice', '', { moveInto: other.id })
    button.append(el('b', '', goalLabel(other)), el('small', 'muted', ` · ${goalById(goals, other.parent)?.title ?? 'at the top'}`))
    list.append(button)
  }
  if (into.length > 20) list.append(el('small', 'muted', `${into.length - 20} more: type a word of the title`))
  if (into.length === 0 && wanted.length > 0) list.append(el('span', 'muted', 'No goal fits those words.'))
  return list
}
$('goals-outline').addEventListener('input', event => {
  if (event.target.id !== 'goals-menu-words' || !board?.goals) return
  goalsUi.menuWords = event.target.value
  const node = goalById(board.goals, goalsUi.menu)
  if (node !== null) $('goals-menu-choices')?.replaceWith(goalMenuChoices(board.goals, node))
})
$('goals-outline').addEventListener('keydown', event => {
  if (event.target.id !== 'goals-menu-words' || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  goalsUi.menu = null
  goalsUi.menuInto = false
  redrawGoals()
})

$('goals-outline').addEventListener('click', event => {
  const opener = event.target.closest('[data-goal-menu]')
  if (opener !== null) {
    event.stopPropagation()
    goalsUi.menu = goalsUi.menu === opener.dataset.goalMenu ? null : opener.dataset.goalMenu
    goalsUi.menuInto = false
    goalsUi.menuWords = ''
    return redrawGoals()
  }
  const menu = event.target.closest('.goal-menu')
  if (menu === null || !board?.goals) return
  event.stopPropagation()
  const id = menu.dataset.menuOf
  const node = goalById(board.goals, id)
  const into = event.target.closest('[data-move-into]')
  const close = () => { goalsUi.menu = null; goalsUi.menuInto = false }
  if (into !== null) {
    const parent = into.dataset.moveInto === '' ? null : into.dataset.moveInto
    close()
    return goalsMove(id, goalDropTarget(board.goals, id, parent, 'into'))
  }
  const name = event.target.closest('[data-menu-action]')?.dataset.menuAction
  if (name === undefined || node === null) return
  if (name === 'up' || name === 'down') return goalsMove(id, goalKeyMove(board.goals, id, name))
  if (name === 'into') {
    goalsUi.menuInto = !goalsUi.menuInto
    goalsUi.menuWords = ''
    redrawGoals()
    return $('goals-menu-words')?.focus()
  }
  if (name === 'close') {
    close()
    return redrawGoals()
  }
  if (name === 'link') {
    close()
    zoomGoal(id)
    return goalsEdit('Also part of', id)
  }
  if (name === 'brainstorm') {
    close()
    return openBrainstorm(id)
  }
  if (name === 'ask') {
    close()
    zoomGoal(id)
    return openGoalAsk(id)
  }
  if (name === 'rename') {
    close()
    return goalsEdit('rename', id, node.title)
  }
  if (name === 'done') {
    // The second review: the click that confirms an overturn is not asked about the goals inside again.
    if (!isConfirming('overturn', id) && goalHasOpenInside(board.goals, id) && !isConfirmed('done', id)) {
      if (!isConfirming('done', id)) goalsAsk('done', id)
      return redrawGoals()
    }
    if (!isConfirming('overturn', id)) goalsUi.confirm = null
    close()
    return goalTick(id)
  }
  if (name === 'delete' || name === 'dissolve') {
    if (!isConfirmed(name, id)) {
      if (!isConfirming(name, id)) goalsAsk(name, id)
      return redrawGoals()
    }
    goalsUi.confirm = null
    close()
    return sendGoals({ command: name, id }).then(done => {
      if (done !== null && id === goalsFocus) zoomGoal(node.parent)
    })
  }
}, true)

/** Zoom to a node (null: the top); the browser's back zooms back. */
function zoomGoal(id) {
  goalsFocus = id
  goalsOpened.clear()
  goalsLinesOpen = false
  goalsUi.editing = null
  if (location.hash !== goalAddress(id)) history.pushState(null, '', goalAddress(id))
  redrawGoals()
}

/** A line under the map for a while: why a change was refused, or (B258, tone 'ok') that an ask went out. */
function goalsSay(text, tone = 'problem') {
  const until = Date.now() + GOAL_NOTE_MS
  goalsUi.note = { text, until, tone }
  setTimeout(() => {
    if (goalsUi.note?.until === until) {
      goalsUi.note = null
      redrawGoals()
    }
  }, GOAL_NOTE_MS + 50)
  redrawGoals()
}

/** Asks for a second click on the same thing within five seconds. */
function goalsAsk(kind, id) {
  const until = Date.now() + GOAL_CONFIRM_MS
  goalsUi.confirm = { kind, id, until, at: Date.now() }
  setTimeout(() => {
    if (goalsUi.confirm?.until === until) {
      goalsUi.confirm = null
      redrawGoals()
    }
  }, GOAL_CONFIRM_MS + 50)
}

/** B256: one change to the goal map; the map is then read anew. Answers what the board answered, or null. */
async function sendGoals(body) {
  if (goalsUi.busy) return null
  goalsUi.busy = true
  goalsUi.note = null
  redrawGoals()
  let result = null
  try {
    const answer = await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
      body: JSON.stringify({ ...body, page: GOALS_PAGE }),
    })
    if (answer.ok) result = await answer.json()
    else goalsSay(`Not changed: ${(await answer.text()).trim() || `refused (${answer.status})`}`)
  } catch {
    goalsSay('Not changed: the board\'s server does not answer.')
  }
  // A change that changed nothing is nothing to undo. B258: an ask and a read mark are no change undo takes back, and
  // after them the map no longer reads as the changes before left it, so those cannot be undone either.
  // B354: a word to the partner (done-when) changes nothing in the map: nothing to count for undo.
  // B358, the reviews: a re-check asked, its take-back or an overturn is no change the page's undo takes back; after
  // one the map no longer reads as the changes before left it, so those cannot be undone either.
  const isOutside = result?.recheck !== undefined || result?.overturned === true || (body.command === 'line' && body.name === 'Recheck asked') || body.command === 'missing-add'
  if (result !== null && result.unchanged !== true && body.command !== 'done-when') goalsUi.undoable = body.command === 'ask' || body.command === 'read' || isOutside ? 0 : body.command === 'undo' ? Math.max(0, goalsUi.undoable - 1) : Math.min(20, goalsUi.undoable + 1)
  // Changed or refused, the map is read anew (a refusal is often a change made elsewhere in between), and the next
  // key works on the map as it now is.
  await read()
  goalsUi.busy = false
  redrawGoals()
  return result
}

function goalsEdit(kind, id, value = '') {
  // The editors of a new goal and of a row's title stand in the outline: it shows again if it was hidden.
  if (goalsViews === 'diagram' && (kind === 'add' || kind === 'sibling' || (kind === 'rename' && id !== goalsFocus))) setGoalsViews(isPhone() ? 'outline' : 'both')
  goalsUi.editing = { kind, id, value }
  goalsUi.confirm = null
  redrawGoals()
}

/** What the open editor sends; null keeps it open (nothing typed). */
async function goalsSubmit(value) {
  const editing = goalsUi.editing
  if (editing === null) return
  const words = value.trim()
  const bodies = {
    add: { command: 'add', parent: editing.id, title: words },
    sibling: { command: 'add', after: editing.id, title: words },
    rename: { command: 'rename', id: editing.id, title: words },
    'Done when': { command: 'line', id: editing.id, name: 'Done when', value: words },
    Why: { command: 'line', id: editing.id, name: 'Why', value: words },
    note: { command: 'note', id: editing.id, value: words },
    group: { command: 'group', ids: [...goalsUi.chosen], title: words },
  }
  const body = bodies[editing.kind]
  if (body === undefined) {
    // The search box: Enter takes the first goal it offers.
    const first = $('goals-choices')?.querySelector('[data-link-target]')
    if (first) await goalsLink(first.dataset.linkTarget)
    return
  }
  if (words === '' && !['Done when', 'Why'].includes(editing.kind)) return
  const done = await sendGoals(body)
  if (done !== null) {
    goalsUi.editing = null
    if (editing.kind === 'group') goalsUi.chosen.clear()
    redrawGoals()
  }
}

async function goalsLink(target) {
  const editing = goalsUi.editing
  if (editing === null) return
  const done = await sendGoals({ command: 'link', id: editing.id, name: editing.kind, target })
  if (done !== null) {
    goalsUi.editing = null
    redrawGoals()
  }
}

/** B358: what a tick on the Goals part did when it did not tick at once: the partner's re-check asked, or an overturn. */
function goalTickSaid(result) {
  // The review: without the Workers mod the word is put on the clipboard to paste, as every word to the partner.
  showPaste(result?.paste ?? null)
  const copied = result?.paste ? ' Copied: paste it into your partner’s chat.' : ''
  if (result?.recheck === 'asked') goalsSay(`Your partner re-checks it against its Done when first: it gets its tick once that passed.${copied}`, 'ok')
  else if (result?.recheck === 'asked again') goalsSay(`${result.unchanged ? 'Your partner was asked a moment ago.' : 'Your partner is asked again for its re-check.'} Click again to tick it without the re-check.${copied}`, 'ok')
  else if (result?.overturned === true) goalsSay('Ticked by you without a passed re-check: the overturn is written under the goal.', 'ok')
  return result
}

/**
 * B358: a tick of a goal on the Goals part: its re-check is asked first. While the re-check is open, a click asks the
 * partner again, and a second click soon after ticks it without the re-check (an overturn, written under the goal).
 */
async function goalTick(id) {
  const node = board?.goals ? goalById(board.goals, id) : null
  const isOpen = (node?.recheckAsked ?? null) !== null
  if (isOpen && isConfirmed('overturn', id)) {
    goalsUi.confirm = null
    return goalTickSaid(await sendGoals({ command: 'state', id, state: 'done', overturn: true }))
  }
  // A double click is not the second click the overturn asks for.
  if (isConfirming('overturn', id)) return null
  const result = await sendGoals({ command: 'state', id, state: 'done' })
  if (result?.recheck === 'asked again') goalsAsk('overturn', id)
  return goalTickSaid(result)
}

/** The dot: the next state; done with open goals inside asks once. */
async function goalsCycle(id) {
  const node = board?.goals ? goalById(board.goals, id) : null
  if (node === null) return
  const next = goalNextState(node.state)
  if (next === 'done' && !isConfirming('overturn', id) && goalHasOpenInside(board.goals, id) && !isConfirmed('done', id)) {
    // A double-click is not the second click it asks for.
    if (!isConfirming('done', id)) goalsAsk('done', id)
    return redrawGoals()
  }
  // The second review: the confirm of an overturn is kept for goalTick, which reads it.
  if (!(next === 'done' && isConfirming('overturn', id))) goalsUi.confirm = null
  if (next === 'done') return goalTick(id)
  await sendGoals({ command: 'state', id, state: next })
}

async function goalsMove(id, target) {
  if (target === null) return
  await sendGoals({ command: 'move', id, parent: target.parent, index: target.index })
}

// B258: the box under the frame that asks the Advisor about the goal zoomed into (spec 2026-10-15, section 4): the
// question, pictures pasted (Ctrl+V) or picked, Send. It stands in the page itself, so the words typed stay while the
// map is drawn anew; it shows while its goal is the focus. Send writes the Ask line under the goal (its id comes back),
// then types the words into the Advisor's chat with that id and the pictures the board kept. `written` is an ask
// written under its goal whose words did not reach the Advisor: Send again types that one, and writes no second ask.
// While it sends, the box stays as it is.
const goalsAskBox = { goal: null, pictures: [], problem: null, busy: false, written: null }
const ASK_PICTURES_MOST = 4

function openGoalAsk(id) {
  if (goalsAskBox.busy) return
  if (goalsAskBox.goal !== id) {
    $('goals-ask-text').value = ''
    setAskPictures([])
    goalsAskBox.written = null
  }
  goalsAskBox.goal = id
  goalsAskBox.problem = null
  showGoalAsk()
  $('goals-ask-text').focus()
}

function closeGoalAsk() {
  goalsAskBox.goal = null
  goalsAskBox.problem = null
  goalsAskBox.written = null
  $('goals-ask-text').value = ''
  setAskPictures([])
  showGoalAsk()
}

function setAskPictures(pictures) {
  for (const one of goalsAskBox.pictures) if (!pictures.includes(one)) URL.revokeObjectURL(one.url)
  goalsAskBox.pictures = pictures
}

/** Shown under the frame of the goal it asks about, on a board that writes the map and has an Advisor. */
function showGoalAsk() {
  const form = $('goals-ask')
  const node = board?.goals ? goalById(board.goals, goalsAskBox.goal) : null
  form.hidden = node === null || goalsFocus !== node.id || !canEditGoals(board) || (board?.advisor ?? null) === null
  if (form.hidden) return
  $('goals-ask-head').textContent = `Ask the Advisor about ${goalLabel(node)}`
  // No longer than the board takes a message; an ask written already keeps the words the map holds.
  $('goals-ask-text').maxLength = Math.min(2000, board.maxMessageChars ?? 2000)
  $('goals-ask-text').readOnly = goalsAskBox.written !== null
  $('goals-ask-send').disabled = goalsAskBox.busy
  $('goals-ask-send').textContent = goalsAskBox.busy ? 'Sending…' : goalsAskBox.written !== null ? 'Send again' : 'Send'
  $('goals-ask-pick').disabled = goalsAskBox.busy || goalsAskBox.pictures.length >= ASK_PICTURES_MOST
  const note = $('goals-ask-note')
  note.classList.toggle('is-error', goalsAskBox.problem !== null)
  note.textContent = goalsAskBox.problem ?? (board.advisor.isRunning === false
    ? `${board.advisor.name}'s chat is not running: the main chat is asked to start it, then it answers under the goal.`
    : 'The Advisor answers under the goal; do other things meanwhile. Ctrl+V pastes a picture.')
  const shown = goalsAskBox.pictures.map((one, index) => {
    const image = el('img')
    image.src = one.url
    image.alt = `Picture ${index + 1} of the ask`
    const remove = el('button', 'main-picture-remove', '×')
    remove.type = 'button'
    remove.dataset.askPicture = String(index)
    remove.title = 'Take the picture away'
    remove.setAttribute('aria-label', 'Take the picture away')
    const frame = el('span', 'main-picture-frame')
    frame.append(image, remove)
    return frame
  })
  fill($('goals-ask-pictures'), shown)
  $('goals-ask-pictures').hidden = shown.length === 0
}

/** A pasted or picked picture for the ask; why it was not taken otherwise. */
function addAskPicture(file, why = null) {
  goalsAskBox.problem = file === null ? why ?? 'The clipboard holds no picture.'
    : !TALK_TYPES.includes(file.type) ? 'Only a PNG, JPEG or WebP picture can go with an ask.'
      : goalsAskBox.pictures.length >= ASK_PICTURES_MOST ? `At most ${ASK_PICTURES_MOST} pictures go with an ask.` : talkPictureProblem(file)
  if (goalsAskBox.problem === null) setAskPictures([...goalsAskBox.pictures, { file, url: URL.createObjectURL(file), path: null }])
  showGoalAsk()
}

async function sendGoalAsk() {
  const goal = goalsAskBox.goal
  const advisor = board?.advisor?.name ?? null
  const text = $('goals-ask-text').value.trim()
  if (goal === null || advisor === null || goalsAskBox.busy) return
  if (text === '' || goalsUi.busy) {
    goalsAskBox.problem = text === '' ? 'Say what you want to know.' : 'Another change to the map is on its way: send again in a moment.'
    return showGoalAsk()
  }
  goalsAskBox.busy = true
  goalsAskBox.problem = null
  showGoalAsk()
  const fail = why => {
    goalsAskBox.busy = false
    goalsAskBox.problem = why
    showGoalAsk()
  }
  // The board keeps the pictures as Talk to Main's; one kept on an earlier try is not kept twice.
  const pictures = []
  for (const one of goalsAskBox.pictures) {
    if (one.path === null) {
      const kept = await keepTalkFile(one.file)
      if (kept.path === undefined) return fail(`Not sent: ${kept.problem}`)
      one.path = kept.path
    }
    pictures.push(one.path)
  }
  // An ask written on an earlier try is typed again, never written twice.
  let id = goalsAskBox.written?.goal === goal ? goalsAskBox.written.id : null
  if (id === null) {
    const written = await sendGoals({ command: 'ask', id: goal, text })
    if (typeof written?.id !== 'string') return fail('Not sent: the ask could not be written under the goal (the line above the map says why).')
    id = written.id
    goalsAskBox.written = { goal, id }
  }
  const key = `goal-ask:${id}`
  await send({ to: advisor, command: 'goal-ask', goal, ask: id, text, pictures }, key)
  if (problems.has(key)) {
    const why = problems.get(key)
    problems.delete(key)
    return fail(`${id} stands under the goal, but the words did not reach ${advisor}: ${why.replace(/^Not sent: /, '').replace(/\.$/, '')}. "Send again" types it again.`)
  }
  goalsAskBox.busy = false
  closeGoalAsk()
  goalsSay(`Asked ${advisor} (${id}). The answer comes under the goal and under Needs your attention.`, 'ok')
}

/** B258: what the person does with an answer: a step from it (Talk to Main, prefilled), ask again, or Done (read). */
function goalsAskAction(kind, goal, askId) {
  const node = board?.goals ? goalById(board.goals, goal) : null
  const block = node === null ? undefined : goalAskBlocks(node, true).find(one => one.id === askId)
  if (block === undefined) return
  if (kind === 'done') return sendGoals({ command: 'read', id: goal, ask: askId })
  if (kind === 'again') return openGoalAsk(goal)
  // B259: the answer as the opening of a brainstorm on the goal.
  if (kind === 'brainstorm') return openBrainstorm(goal, `About my ask ${block.id}: ${block.question}${block.answer === null ? '' : ` The Advisor answered: ${block.answer.text}`}`.slice(0, 2000))
  if (kind === 'step') {
    // After what was typed there already, and no longer than a message may be.
    showSide('main')
    const draft = $('main-text').value.trim()
    $('main-text').value = `${draft === '' ? '' : `${draft}\n\n`}${goalStepWords(node, block)}`.slice(0, board.maxMessageChars ?? 2000)
    $('main-text').focus()
  }
}

/** An ask's block in the frame, brought into sight and lit for a moment (from its box in the tree). */
function goalsShowAsk(id) {
  const block = document.querySelector(`#goals-frame [data-ask-block="${id}"]`)
  if (block === null) return
  block.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  block.classList.remove('is-lit')
  void block.offsetWidth
  block.classList.add('is-lit')
}

$('goals-ask').addEventListener('submit', event => {
  event.preventDefault()
  sendGoalAsk()
})
$('goals-ask').addEventListener('paste', event => {
  if (goalsAskBox.busy) return event.preventDefault()
  const pasted = pastedTalk(event.clipboardData?.items)
  if (pasted.ignore === true) return
  event.preventDefault()
  addAskPicture(pasted.take?.getAsFile() ?? null, pasted.problem ?? null)
})
$('goals-ask').addEventListener('click', event => {
  const remove = event.target.closest('[data-ask-picture]')
  if (remove !== null && !goalsAskBox.busy) {
    setAskPictures(goalsAskBox.pictures.filter((one, index) => index !== Number(remove.dataset.askPicture)))
    showGoalAsk()
    return $('goals-ask-text').focus()
  }
  if (event.target.closest('#goals-ask-pick') !== null) return $('goals-ask-file').click()
  if (event.target.closest('#goals-ask-cancel') !== null && !goalsAskBox.busy) closeGoalAsk()
})
$('goals-ask-file').addEventListener('change', event => {
  for (const file of Array.from(event.target.files ?? [])) addAskPicture(file)
  event.target.value = ''
})
$('goals-ask-text').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !goalsAskBox.busy) {
    event.preventDefault()
    closeGoalAsk()
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    sendGoalAsk()
  }
})
$('goals-ask-text').addEventListener('input', () => {
  if (goalsAskBox.problem === null) return
  goalsAskBox.problem = null
  showGoalAsk()
})

// brainstorm:start
// B259: the Brainstorm part (spec 2026-10-15, section 5), worked out without the page, so the tests can run it. A thread
// is one of state.brainstorms.threads (src/brainstorm.mjs, brainstormsState).

/** An answer as the card and the list read it back: the option and the person's words, skipped, or back. */
function brainstormAnswerText(question) {
  const answer = question.answer
  if (answer === null || answer === undefined) return 'not answered'
  if (answer.skipped === true) return 'skipped'
  if (Number.isInteger(answer.back)) return `back to Q${answer.back}`
  if (answer.key === 'Other') return `your words: "${answer.words}"`
  const option = (question.options ?? []).find(one => one.key === answer.key)
  const said = option === undefined ? answer.key : `${answer.key}, ${option.text}`
  return answer.words ? `${said}: "${answer.words}"` : said
}

/**
 * The card of a brainstorm: the open question (when the Advisor asked one and no proposal stands), its options, whether
 * it takes an answer and a Back, the earlier questions with their answers, and, while the Advisor has the turn, what it
 * does: thinking, on something else (its card's line), or not running, with the way to wake it (Review Focus 4).
 * `advisor` is state.advisor.
 */
function brainstormCardView(thread, advisor) {
  const latest = thread.latest
  const isOver = thread.state === 'done' || thread.state === 'discarded'
  const isOpen = !isOver && thread.state === 'running' && thread.proposal === null && latest !== null && latest.answer === null
  const asked = [...thread.earlier, ...(latest === null || isOpen ? [] : [latest])]
  let waiting = null
  if (!isOver && !isOpen && thread.proposal === null) {
    const doing = advisor?.state === 'working' ? String(advisor.doingNow ?? '').trim() : ''
    waiting = advisor === null || advisor === undefined ? 'No Advisor is on the board: a brainstorm waits for one.'
      : advisor.isRunning === false ? 'The Advisor\'s chat is not running: start it from the Workers lane (the main chat starts it)'
        : doing !== '' && !/^brainstorm\b/i.test(doing) ? `The Advisor is on: ${doing}` : 'The Advisor is thinking…'
  }
  return {
    // B475: the question as its short title and its context, as an ask's window shows them (B452).
    question: isOpen ? { n: latest.n, title: latest.title ?? latest.text, context: latest.context ?? '', why: latest.why, picture: latest.picture } : null,
    options: isOpen ? latest.options : [],
    canAnswer: isOpen,
    canBack: isOpen && thread.earlier.length > 0,
    waiting,
    earlier: asked.map(question => ({ n: question.n, title: question.title ?? question.text, context: question.context ?? '', answerText: brainstormAnswerText(question) })),
  }
}

/**
 * The last proposal of a brainstorm with a tick per goal and per step (`g0`, `s1`: all ticked but the keys in
 * `unticked`), its note, whether Create can go (something ticked, not created yet), and once created what came of it.
 */
function proposalView(thread, unticked) {
  const proposal = thread.proposal
  const off = new Set(unticked ?? [])
  const created = proposal.created
  const isTicked = (key, title) => (created === null ? !off.has(key) : !created.leftOut.includes(brainstormLeftKey(title)))
  const goals = proposal.goals.map((goal, index) => ({ index, key: `g${index}`, title: goal.title, where: goal.under === null ? 'at the top' : `under ${goal.under}`, doneWhen: goal.doneWhen, ticked: isTicked(`g${index}`, goal.title) }))
  const steps = proposal.steps.map((step, index) => ({ index, key: `s${index}`, title: step.title, worker: step.worker, cost: step.cost, ticked: isTicked(`s${index}`, step.title) }))
  const stepWords = created === null ? '' : created.steps.length > 0 ? created.steps.join(', ') : created.asked > 0 ? `${created.asked} step${created.asked === 1 ? '' : 's'} asked of the main chat` : 'no steps'
  return {
    at: proposal.at,
    decided: proposal.decided,
    goals,
    steps,
    note: proposal.note,
    created: created === null ? null : [`Created at ${created.at}: ${created.goals.length > 0 ? created.goals.join(', ') : 'no goals'}`, stepWords, created.leftOut.length > 0 ? `left out: ${created.leftOut.join(', ')}` : null].filter(Boolean).join(' · '),
    canCreate: created === null && thread.state !== 'discarded' && thread.state !== 'done' && [...goals, ...steps].some(one => one.ticked),
  }
}

/** A title as the Created line keeps it among what was left out (src/brainstorm.mjs, leftOutKey). */
function brainstormLeftKey(title) { return String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000).replace(/ · /g, ' - ') }

/** The list at the left: the running brainstorms first, then the ones done or discarded, each with one line. */
function brainstormListView(threads) {
  const running = []
  const done = []
  for (const thread of threads ?? []) {
    const day = String(thread.started ?? '').slice(0, 10)
    const count = thread.questions === 0 ? null : `${thread.questions} question${thread.questions === 1 ? '' : 's'}`
    const isOpen = thread.state === 'running' && thread.proposal === null && thread.latest !== null && thread.latest.answer === null
    const hasProposal = thread.proposal !== null && thread.proposal.created === null
    if (thread.state === 'running' || thread.state === 'wrapping up') {
      const what = isOpen ? `question ${thread.latest.n} waits for you` : hasProposal ? 'proposal to tick' : thread.state === 'wrapping up' ? 'wrapping up with the Advisor' : 'with the Advisor'
      running.push({ path: thread.path, title: thread.title, line: [day, isOpen ? null : count, what].filter(Boolean).join(' · '), waits: isOpen || hasProposal })
      continue
    }
    const created = thread.proposal?.created ?? null
    const came = created === null ? null : [created.goals.join(', '), created.steps.length > 0 ? created.steps.join(', ') : created.asked > 0 ? `${created.asked} step${created.asked === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
    const line = thread.state === 'discarded' ? [day, count, 'discarded'].filter(Boolean).join(' · ') : `${[day, count].filter(Boolean).join(' · ')} → ${came || 'nothing created'}`
    done.push({ path: thread.path, title: thread.title, line, waits: false })
  }
  return { running, done }
}

/** The brainstorm the card shows: the one chosen while it is there, else the first running one, else the newest. */
function brainstormChosen(threads, open) {
  const list = threads ?? []
  if (list.some(thread => thread.path === open)) return open
  return (list.find(thread => thread.state === 'running' || thread.state === 'wrapping up') ?? list[0])?.path ?? null
}
// brainstorm:end

/**
 * B259: what the person is doing on the Brainstorm part, which a redraw keeps: the brainstorm the card shows, the box
 * for a new one (`newAbout`: undefined while closed, null for a free one, else the goal), the option chosen and the own
 * words typed per brainstorm, the ticks taken away per proposal, the box to change a proposal, a "click again" to
 * discard, whether a change is on its way, and the line after it.
 */
const brainstormUi = { open: null, newAbout: undefined, chosen: new Map(), other: new Map(), unticked: new Map(), changing: null, changeWords: '', confirm: null, busy: false, note: null, failedSteps: new Map() }

function brainstormData(state) {
  return [state.brainstorms ?? null, state.advisor?.name ?? null, state.advisor?.isRunning ?? null, state.advisor?.state ?? null, state.advisor?.doingNow ?? null,
    state.goalsEdit?.canWrite ?? null, state.restart?.main ?? null, (state.goals?.nodes ?? []).map(node => [node.id, node.title]),
    brainstormUi.open, brainstormUi.newAbout === undefined ? 'closed' : brainstormUi.newAbout, [...brainstormUi.chosen],
    [...brainstormUi.unticked].map(([path, keys]) => [path, [...keys]]), [...brainstormUi.failedSteps], brainstormUi.changing, brainstormUi.confirm, brainstormUi.busy, brainstormUi.note]
}
function redrawBrainstorm() {
  if (board !== null && board !== undefined) once('brainstorm', brainstormData(board), () => drawBrainstorm(board))
}
const canBrainstorm = state => state?.goalsEdit?.canWrite === true && (state?.advisor ?? null) !== null
const threadAt = path => (board?.brainstorms?.threads ?? []).find(thread => thread.path === path) ?? null

function drawBrainstorm(state) {
  const threads = state.brainstorms?.threads ?? []
  const waits = (state.brainstormNeeds ?? []).length
  $('advisor-brainstorm-count').textContent = waits === 0 ? '' : String(waits)
  const list = brainstormListView(threads)
  const chosen = brainstormChosen(threads, brainstormUi.open)
  const start = el('button', 'brainstorm-start', '+ New brainstorm… (about a goal, or free)')
  start.type = 'button'
  start.dataset.brainstormNew = ''
  start.disabled = !canBrainstorm(state)
  if (start.disabled) start.title = (state.advisor ?? null) === null ? 'No Advisor is on the board.' : state.goalsEdit?.whyNot ?? 'This board only shows.'
  const row = one => {
    const line = el('button', `brainstorm-row${one.path === chosen ? ' is-chosen' : ''}${one.waits ? ' is-waiting' : ''}`)
    line.type = 'button'
    line.dataset.brainstormOpen = one.path
    line.append(el('b', '', one.title), el('small', '', one.line))
    return line
  }
  fill($('brainstorm-list'), [
    start,
    list.running.length > 0 ? el('h4', 'brainstorm-group', 'Running') : null, ...list.running.map(row),
    list.done.length > 0 ? el('h4', 'brainstorm-group', 'Done') : null, ...list.done.map(row),
    threads.length === 0 ? el('p', 'muted brainstorm-empty', 'No brainstorm yet. Start one here, or with "Brainstorm this" on a goal of the map. The Advisor asks you one question at a time and ends with a proposal you tick.') : null,
  ])
  showBrainstormNew(state)
  const thread = threads.find(one => one.path === chosen) ?? null
  // The box typed in keeps the keys, and the cursor where it was.
  const active = document.activeElement
  const typing = $('brainstorm-card').contains(active) && /^(?:brainstorm-other|brainstorm-change-text)$/.test(active.id) ? { id: active.id, at: active.selectionStart } : null
  fill($('brainstorm-card'), thread === null ? [] : brainstormCard(thread, state))
  const again = typing === null ? null : $(typing.id)
  if (again !== null && !again.disabled) {
    again.focus()
    again.setSelectionRange(typing.at, typing.at)
  }
}

function brainstormButton(text, act, className = 'goals-tool') {
  const button = el('button', className, text)
  button.type = 'button'
  button.dataset.brainstormAct = act
  button.disabled = brainstormUi.busy
  return button
}

/** The card of the brainstorm chosen: what it is about, the open question or what it waits for, the proposal, the earlier answers. */
function brainstormCard(thread, state) {
  const view = brainstormCardView(thread, state.advisor ?? null)
  const canWrite = canBrainstorm(state)
  const about = el('p', 'brainstorm-about')
  about.append('about: ')
  if (thread.goal === null) about.append(el('span', '', 'no goal yet (free)'))
  else {
    const goal = el('button', 'goals-link', `${thread.goal.id} ${thread.goal.title}`)
    goal.type = 'button'
    goal.dataset.brainstormGoal = thread.goal.id
    goal.title = 'Open it in the goal map'
    about.append(goal)
  }
  const box = el('section', `brainstorm-box is-${thread.state.replace(' ', '-')}`)
  const step = view.question !== null ? `question ${view.question.n}` : thread.proposal !== null ? 'proposal' : thread.state
  box.append(el('small', 'brainstorm-meta', `Brainstorm · with the Advisor · ${step} · started ${thread.started ?? ''}`), el('h3', 'brainstorm-title', thread.title))
  if (thread.opening) box.append(el('p', 'brainstorm-opening', `You opened with: ${thread.opening}`))
  if (view.question !== null) {
    box.append(el('h4', 'brainstorm-question', view.question.title))
    if (view.question.context) box.append(el('p', 'brainstorm-context', view.question.context))
    if (view.question.why) box.append(el('p', 'muted brainstorm-why', `The Advisor asks because ${view.question.why}`))
    const picked = brainstormUi.chosen.get(thread.path) ?? null
    const options = el('div', 'brainstorm-options')
    for (const option of view.options) {
      const button = el('button', `brainstorm-option${picked === option.key ? ' is-chosen' : ''}`)
      button.type = 'button'
      button.dataset.option = option.key
      button.disabled = !canWrite || brainstormUi.busy
      button.setAttribute('aria-pressed', String(picked === option.key))
      button.append(el('span', 'brainstorm-key', option.key), el('span', 'brainstorm-option-text', option.text))
      if (option.isAdvised) button.append(el('span', 'brainstorm-advised', 'advised'))
      options.append(button)
    }
    const other = el('input', `brainstorm-other${picked === 'Other' ? ' is-chosen' : ''}`)
    other.type = 'text'
    other.id = 'brainstorm-other'
    other.maxLength = 1000
    other.placeholder = picked !== null && picked !== 'Other' ? `Words to go with ${picked} (if any)…` : 'Other: your own words…'
    other.value = brainstormUi.other.get(thread.path) ?? ''
    other.disabled = !canWrite || brainstormUi.busy
    other.setAttribute('aria-label', 'Your own words')
    options.append(other)
    box.append(options)
    if (view.question.picture) {
      const shown = picture(view.question.picture, `Q${view.question.n}: every option side by side`)
      shown.classList.add('brainstorm-picture')
      box.append(shown)
    }
    if (canWrite) {
      const words = (brainstormUi.other.get(thread.path) ?? '').trim()
      const answer = brainstormButton(picked !== null && picked !== 'Other' ? `Answer ${picked}` : words !== '' ? 'Answer with your words' : 'Answer', 'answer', 'goals-action is-send')
      answer.id = 'brainstorm-answer'
      answer.disabled = brainstormUi.busy || (picked === null && words === '')
      const foot = el('div', 'brainstorm-buttons')
      foot.append(answer, brainstormButton('Skip', 'skip'))
      if (view.canBack) foot.append(brainstormButton('Back', 'back'))
      foot.append(el('span', 'brainstorm-gap'), brainstormButton('Enough, wrap up', 'wrap'))
      box.append(foot)
    }
  }
  if (view.waiting !== null) {
    const waiting = el('p', `brainstorm-waiting${/not running|No Advisor/.test(view.waiting) ? ' is-off' : ''}`, view.waiting)
    // Nothing comes back for long: the last word is typed into the Advisor's chat once more.
    if (canWrite && thread.state !== 'done' && thread.state !== 'discarded') {
      const again = brainstormButton('Type it to the Advisor again', 'again', 'goals-lines')
      again.title = 'When nothing came back: the board types its last word about this brainstorm into the Advisor\'s chat again'
      waiting.append(' ', again)
    }
    box.append(waiting)
  }
  // Lines of the thread the board cannot read: the Advisor is asked to write them in the form.
  if (thread.problems.length > 0) box.append(el('p', 'brainstorm-problems', `The thread has ${thread.problems.length === 1 ? 'a line' : 'lines'} the board cannot read (${thread.problems.slice(0, 3).join(' · ')}${thread.problems.length > 3 ? ' …' : ''}): ask the Advisor to write ${thread.problems.length === 1 ? 'it' : 'them'} as roles/partner.md shows.`))
  if (thread.proposal !== null) box.append(proposalPart(thread, canWrite))
  if (thread.state === 'discarded') box.append(el('p', 'muted', 'Discarded: nothing of it was created.'))
  if (view.earlier.length > 0) {
    const earlier = el('details', 'brainstorm-earlier')
    earlier.append(el('summary', '', `Earlier in this brainstorm (${view.earlier.length})`))
    for (const one of view.earlier) {
      const line = el('p', '')
      line.append(el('b', '', `Q${one.n} ${one.title}`), el('span', 'muted', ` → ${one.answerText}`))
      earlier.append(line)
      if (one.context) earlier.append(el('p', 'muted brainstorm-earlier-context', one.context))
    }
    box.append(earlier)
  }
  const foot = el('div', 'brainstorm-file')
  const file = el('button', 'goals-link', `The thread file: ${thread.path} ↗`)
  file.type = 'button'
  file.dataset.gameFile = thread.path
  foot.append(file)
  if (canWrite && (thread.state === 'running' || thread.state === 'wrapping up')) {
    const discard = brainstormButton(brainstormUi.confirm === thread.path ? 'Click again to discard it' : 'Discard', 'discard', 'goals-tool is-delete')
    discard.title = 'End it without creating anything'
    foot.append(discard)
  }
  const parts = [about, box, foot]
  if (brainstormUi.note !== null && brainstormUi.note.path === thread.path) parts.splice(2, 0, el('p', `brainstorm-note${brainstormUi.note.isProblem ? ' is-error' : ''}`, brainstormUi.note.text))
  return parts
}

/** The proposal: what was decided, the goals and the steps with their ticks, the note; Create, Change… and what came of it. */
function proposalPart(thread, canWrite) {
  const view = proposalView(thread, brainstormUi.unticked.get(thread.path) ?? [])
  const part = el('section', 'brainstorm-proposal')
  part.append(el('h4', '', `The proposal · ${view.at}`))
  if (view.decided.length > 0) part.append(el('h5', '', 'What we decided'), fill(el('ul', 'brainstorm-decided'), view.decided.map(line => el('li', '', line))))
  const tick = (item, main, small) => {
    const label = el('label', `brainstorm-tick${item.ticked ? '' : ' is-off'}`)
    const box = el('input')
    box.type = 'checkbox'
    box.checked = item.ticked
    box.dataset.tick = item.key
    box.disabled = !canWrite || view.created !== null || brainstormUi.busy
    label.append(box, el('span', '', main), el('small', 'muted', small))
    return label
  }
  if (view.goals.length > 0) part.append(el('h5', '', 'New goals for the map'), ...view.goals.map(goal => tick(goal, goal.title, `${goal.where} · Done when: ${goal.doneWhen}`)))
  if (view.steps.length > 0) part.append(el('h5', '', 'New tasks for the backlog'), ...view.steps.map(step => tick(step, step.title, `${step.worker} · ${step.cost}`)))
  if (view.note) part.append(el('h5', '', 'The note kept under the goal'), el('p', 'brainstorm-note-kept', view.note))
  if (view.created !== null) {
    part.append(el('p', 'brainstorm-created', view.created))
    const failed = brainstormUi.failedSteps.get(thread.path) ?? []
    if (canWrite && failed.length > 0) part.append(brainstormButton(`Ask the main chat again for ${failed.length} step${failed.length === 1 ? '' : 's'}`, 'steps-again', 'goals-action is-send'))
    return part
  }
  if (canWrite && thread.state !== 'discarded') {
    const buttons = el('div', 'brainstorm-buttons')
    const create = brainstormButton('Create what\'s ticked', 'create', 'goals-action is-send')
    create.disabled = brainstormUi.busy || !view.canCreate
    create.title = 'The goals go into the map now; the main chat is asked for each step'
    buttons.append(create, brainstormButton(brainstormUi.changing === thread.path ? 'Change… ▾' : 'Change…', 'change'))
    part.append(buttons)
    if (brainstormUi.changing === thread.path) {
      const change = el('div', 'brainstorm-change')
      const words = el('textarea')
      words.id = 'brainstorm-change-text'
      words.rows = 2
      words.maxLength = 1000
      words.placeholder = 'What should the Advisor change in the proposal?'
      words.value = brainstormUi.changeWords
      words.disabled = brainstormUi.busy
      change.append(words, brainstormButton('Send the change', 'send-change', 'goals-action is-send'))
      part.append(change)
    }
  }
  return part
}

/** The box for a new brainstorm: shown on a board that writes, with an Advisor; about the goal given, or free. */
function showBrainstormNew(state) {
  const form = $('brainstorm-new')
  form.hidden = brainstormUi.newAbout === undefined || !canBrainstorm(state)
  if (form.hidden) return
  const goal = brainstormUi.newAbout === null ? null : goalById(state.goals ?? { nodes: [] }, brainstormUi.newAbout)
  const about = $('brainstorm-new-about')
  if (goal === null) about.replaceChildren('Free: about no goal yet. The Advisor proposes where its goals go.')
  else {
    const free = el('button', 'goals-unlink', '× make it free')
    free.type = 'button'
    free.dataset.brainstormFree = ''
    about.replaceChildren(`About ${goalLabel(goal)} `, free)
  }
  $('brainstorm-new-start').disabled = brainstormUi.busy
  $('brainstorm-new-start').textContent = brainstormUi.busy ? 'Starting…' : 'Start'
  const note = brainstormUi.note !== null && brainstormUi.note.path === null ? brainstormUi.note : null
  $('brainstorm-new-note').classList.toggle('is-error', note?.isProblem === true)
  $('brainstorm-new-note').textContent = note?.text ?? 'The Advisor writes the questions into the thread file; you answer here, one at a time.'
}

/** "Brainstorm this" on a goal, or "+ New brainstorm…": the part with the box open, or the brainstorm running on that goal. */
function openBrainstorm(goal, opening = '', isNew = false) {
  show('advice')
  showAdvisorPane('brainstorm')
  const running = goal === null ? null : (board?.brainstorms?.threads ?? []).find(thread => thread.goal?.id === goal && (thread.state === 'running' || thread.state === 'wrapping up')) ?? null
  if (running !== null && isNew) goal = null
  else if (running !== null) {
    brainstormUi.open = running.path
    brainstormUi.newAbout = undefined
    return redrawBrainstorm()
  }
  if (brainstormUi.newAbout !== goal) {
    const node = goal === null ? null : goalById(board?.goals ?? { nodes: [] }, goal)
    $('brainstorm-new-title').value = node === null ? '' : node.title
    $('brainstorm-new-opening').value = opening
  }
  brainstormUi.newAbout = goal
  brainstormUi.note = null
  redrawBrainstorm()
  $(goal === null ? 'brainstorm-new-title' : 'brainstorm-new-opening').focus()
}

/** One change to a brainstorm (POST /api/brainstorm); the state is read anew. Answers what the board answered, or null with its reason under the card. */
async function sendBrainstorm(body) {
  let result = null
  try {
    const answer = await fetch('/api/brainstorm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify(body) })
    if (answer.ok) result = await answer.json()
    else brainstormUi.note = { path: body.path ?? null, isProblem: true, text: `Not done: ${(await answer.text()).trim() || `refused (${answer.status})`}` }
  } catch {
    brainstormUi.note = { path: body.path ?? null, isProblem: true, text: 'Not done: the board\'s server does not answer.' }
  }
  await read()
  return result
}

/** Words to a chat; their problem, if any, under the card. True when they went. */
async function sayBrainstorm(message, path) {
  const key = `brainstorm:${path}:${message.command}${Number.isInteger(message.step) ? `:${message.step}` : ''}`
  await send(message, key)
  if (!problems.has(key)) return true
  brainstormUi.note = { path, isProblem: true, text: `${problems.get(key).replace(/\.?$/, '.')} The thread holds it: the board can type it again.` }
  problems.delete(key)
  return false
}

async function brainstormAct(act, path) {
  const thread = threadAt(path)
  const advisor = board?.advisor?.name ?? null
  const main = board?.restart?.main ?? null
  if (thread === null || brainstormUi.busy) return
  if (act === 'again' && brainstormUi.busy === false) {
    // The word the brainstorm waits on: the start, the answer to the last question, or the wrap-up.
    const word = thread.state === 'wrapping up' && thread.proposal === null ? { command: 'brainstorm-wrap' }
      : thread.questions === 0 && thread.proposal === null ? { command: 'brainstorm' }
        : thread.latest !== null && thread.latest.answer !== null && thread.proposal === null ? { command: 'brainstorm-answer', n: thread.latest.n } : null
    if (word === null) return
    brainstormUi.busy = true
    brainstormUi.note = null
    redrawBrainstorm()
    if (await sayBrainstorm({ to: advisor, thread: path, ...word }, path)) brainstormUi.note = { path, isProblem: false, text: 'Typed into the Advisor\'s chat again.' }
    brainstormUi.busy = false
    return redrawBrainstorm()
  }
  if (act === 'change') {
    brainstormUi.changing = brainstormUi.changing === path ? null : path
    redrawBrainstorm()
    return $('brainstorm-change-text')?.focus()
  }
  if (act === 'discard' && brainstormUi.confirm !== path) {
    brainstormUi.confirm = path
    setTimeout(() => {
      if (brainstormUi.confirm === path) {
        brainstormUi.confirm = null
        redrawBrainstorm()
      }
    }, 5000)
    return redrawBrainstorm()
  }
  brainstormUi.busy = true
  brainstormUi.confirm = null
  brainstormUi.note = null
  redrawBrainstorm()
  try {
    const n = thread.latest?.n ?? null
    if (act === 'answer' || act === 'skip' || act === 'back') {
      const picked = brainstormUi.chosen.get(path) ?? null
      const words = (brainstormUi.other.get(path) ?? '').trim()
      const answer = act === 'skip' ? { command: 'skip' } : act === 'back' ? { command: 'back', to: n - 1 }
        : picked !== null && picked !== 'Other' ? { command: 'answer', key: picked, words } : { command: 'answer', key: 'Other', words }
      if (await sendBrainstorm({ path, n, ...answer }) !== null) {
        brainstormUi.chosen.delete(path)
        brainstormUi.other.delete(path)
        await sayBrainstorm({ to: advisor, command: 'brainstorm-answer', thread: path, n }, path)
      }
    } else if (act === 'wrap') {
      if (await sendBrainstorm({ command: 'wrap', path }) !== null) await sayBrainstorm({ to: advisor, command: 'brainstorm-wrap', thread: path }, path)
    } else if (act === 'discard') {
      await sendBrainstorm({ command: 'discard', path })
    } else if (act === 'send-change') {
      const words = brainstormUi.changeWords.trim()
      if (words === '') brainstormUi.note = { path, isProblem: true, text: 'Say what the Advisor should change.' }
      else if (await sayBrainstorm({ to: advisor, command: 'brainstorm-change', thread: path, text: words }, path)) {
        brainstormUi.changing = null
        brainstormUi.changeWords = ''
        brainstormUi.note = { path, isProblem: false, text: 'Sent to the Advisor: it writes the proposal anew.' }
      }
    } else if (act === 'steps-again') {
      // The steps the main chat was not reached with, asked again; the ones that go are done with.
      const failed = []
      for (const index of brainstormUi.failedSteps.get(path) ?? []) if (!(await sayBrainstorm({ to: main, command: 'goal-step', thread: path, step: index }, path))) failed.push(index)
      if (failed.length > 0) brainstormUi.failedSteps.set(path, failed)
      else {
        brainstormUi.failedSteps.delete(path)
        brainstormUi.note = { path, isProblem: false, text: 'The main chat is asked for every step.' }
      }
    } else if (act === 'create') {
      const view = proposalView(thread, brainstormUi.unticked.get(path) ?? [])
      const steps = view.steps.filter(step => step.ticked).map(step => step.index)
      const made = await sendBrainstorm({ command: 'create', path, goals: view.goals.filter(goal => goal.ticked).map(goal => goal.index), steps, seen: thread.length })
      if (made !== null) {
        // One message per step to the main chat, which writes it on the backlog and links it to its goal.
        let asked = 0
        const failed = []
        for (const index of steps) {
          if (await sayBrainstorm({ to: main, command: 'goal-step', thread: path, step: index }, path)) asked += 1
          else failed.push(index)
        }
        if (failed.length > 0) brainstormUi.failedSteps.set(path, failed)
        const goals = made.goals.map(goal => goal.id).join(', ')
        if (brainstormUi.note === null) brainstormUi.note = { path, isProblem: false, text: `Created: ${goals || 'no goals'}${steps.length > 0 ? `; the main chat is asked for ${asked} of ${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}.` }
      }
    }
  } finally {
    brainstormUi.busy = false
    redrawBrainstorm()
  }
}

$('brainstorm-list').addEventListener('click', event => {
  if (event.target.closest('[data-brainstorm-new]') !== null) return openBrainstorm(goalsFocus, '', true)
  const open = event.target.closest('[data-brainstorm-open]')
  if (open === null) return
  brainstormUi.open = open.dataset.brainstormOpen
  brainstormUi.newAbout = undefined
  redrawBrainstorm()
})
$('brainstorm-card').addEventListener('click', event => {
  const path = brainstormChosen(board?.brainstorms?.threads ?? [], brainstormUi.open)
  if (path === null) return
  const option = event.target.closest('[data-option]')
  if (option !== null && !option.disabled) {
    brainstormUi.open = path
    brainstormUi.chosen.set(path, brainstormUi.chosen.get(path) === option.dataset.option ? null : option.dataset.option)
    if (brainstormUi.chosen.get(path) === null) brainstormUi.chosen.delete(path)
    return redrawBrainstorm()
  }
  const goal = event.target.closest('[data-brainstorm-goal]')
  if (goal !== null) {
    showAdvisorPane('goals')
    return zoomGoal(goal.dataset.brainstormGoal)
  }
  const act = event.target.closest('[data-brainstorm-act]')
  if (act !== null && !act.disabled) {
    brainstormUi.open = path
    brainstormAct(act.dataset.brainstormAct, path)
  }
})
$('brainstorm-card').addEventListener('change', event => {
  const tick = event.target.closest('[data-tick]')
  const path = brainstormChosen(board?.brainstorms?.threads ?? [], brainstormUi.open)
  if (tick === null || path === null) return
  const off = new Set(brainstormUi.unticked.get(path) ?? [])
  if (tick.checked) off.delete(tick.dataset.tick)
  else off.add(tick.dataset.tick)
  brainstormUi.unticked.set(path, off)
  redrawBrainstorm()
})
// The own words: kept while typed, and the Answer button follows them without drawing the card anew.
$('brainstorm-card').addEventListener('input', event => {
  // The words of a change stay while the card is drawn anew.
  if (event.target.id === 'brainstorm-change-text') brainstormUi.changeWords = event.target.value
  if (event.target.id !== 'brainstorm-other') return
  const path = brainstormChosen(board?.brainstorms?.threads ?? [], brainstormUi.open)
  brainstormUi.other.set(path, event.target.value)
  const picked = brainstormUi.chosen.get(path) ?? null
  const words = event.target.value.trim()
  const answer = $('brainstorm-answer')
  if (answer !== null) {
    answer.disabled = brainstormUi.busy || (picked === null && words === '')
    answer.textContent = picked !== null && picked !== 'Other' ? `Answer ${picked}` : words !== '' ? 'Answer with your words' : 'Answer'
  }
})
$('brainstorm-card').addEventListener('keydown', event => {
  if (event.target.id === 'brainstorm-other' && event.key === 'Enter' && !$('brainstorm-answer')?.disabled) {
    event.preventDefault()
    brainstormAct('answer', brainstormChosen(board?.brainstorms?.threads ?? [], brainstormUi.open))
  }
})
$('brainstorm-new').addEventListener('click', event => {
  if (event.target.closest('[data-brainstorm-free]') !== null) {
    brainstormUi.newAbout = null
    redrawBrainstorm()
  }
  if (event.target.closest('#brainstorm-new-cancel') !== null && !brainstormUi.busy) {
    brainstormUi.newAbout = undefined
    redrawBrainstorm()
  }
})
$('brainstorm-new').addEventListener('submit', async event => {
  event.preventDefault()
  const advisor = board?.advisor?.name ?? null
  const title = $('brainstorm-new-title').value.trim()
  const opening = $('brainstorm-new-opening').value.trim()
  if (brainstormUi.busy || advisor === null) return
  if (title === '' || opening === '') {
    brainstormUi.note = { path: null, isProblem: true, text: 'Give it a title and your opening words.' }
    return redrawBrainstorm()
  }
  brainstormUi.busy = true
  brainstormUi.note = null
  redrawBrainstorm()
  const started = await sendBrainstorm({ command: 'start', title, goal: brainstormUi.newAbout ?? null, opening })
  if (started !== null) {
    $('brainstorm-new-title').value = ''
    $('brainstorm-new-opening').value = ''
    brainstormUi.newAbout = undefined
    brainstormUi.open = started.path
    await sayBrainstorm({ to: advisor, command: 'brainstorm', thread: started.path }, started.path)
  }
  brainstormUi.busy = false
  redrawBrainstorm()
})

// B289: a step under no goal opens its window.
$('goals-unlinked').addEventListener('click', event => {
  const row = event.target.closest('[data-unlinked-step]')
  if (row === null || board === null) return
  const step = (board.backlog ?? []).flatMap(activity => activity.steps).find(one => one.id === row.dataset.unlinkedStep)
  if (step !== undefined) openDetails({ step: step.key })
})

// B505: the search box finds a goal by id or words and zooms to it (its parents open, the browser's back returns).
const goalsFind = { matches: [], at: 0 }
function drawGoalsFind() {
  const query = $('goals-find-input').value
  const goals = board?.goals ?? null
  goalsFind.matches = goals === null ? [] : goalSearch(goals, query)
  goalsFind.at = Math.min(goalsFind.at, Math.max(goalsFind.matches.length - 1, 0))
  const list = $('goals-find-list')
  list.hidden = query.trim() === ''
  $('goals-find-clear').hidden = query === ''
  fill(list, goalsFind.matches.length === 0
    ? [el('li', 'goals-find-none muted', 'No goal matches')]
    : goalsFind.matches.map((match, place) => {
      const row = el('li', 'goals-find-row')
      row.setAttribute('role', 'option')
      row.dataset.goal = match.id
      row.setAttribute('aria-selected', String(place === goalsFind.at))
      row.append(el('b', 'goals-find-id', match.id), el('span', 'goals-find-title', match.title), el('small', 'goals-find-where', match.where))
      return row
    }))
}
function clearGoalsFind() {
  $('goals-find-input').value = ''
  goalsFind.at = 0
  drawGoalsFind()
}
function pickGoalsFind(id) {
  clearGoalsFind()
  zoomGoal(id)
}
$('goals-find-input').addEventListener('input', () => {
  goalsFind.at = 0
  drawGoalsFind()
})
$('goals-find-input').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.stopPropagation()
    clearGoalsFind()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = goalsFind.matches.length
    if (count > 0) goalsFind.at = (goalsFind.at + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
    drawGoalsFind()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const match = goalsFind.matches[goalsFind.at]
    if (match !== undefined) pickGoalsFind(match.id)
  }
})
$('goals-find-list').addEventListener('mousedown', event => event.preventDefault())
$('goals-find-list').addEventListener('click', event => {
  const row = event.target.closest('[data-goal]')
  if (row !== null) pickGoalsFind(row.dataset.goal)
})
$('goals-find-clear').addEventListener('click', () => {
  clearGoalsFind()
  $('goals-find-input').focus()
})

$('goals-crumb').addEventListener('click', event => {
  const link = event.target.closest('button[data-goal]')
  if (link !== null && !link.disabled) zoomGoal(link.dataset.goal === '' ? null : link.dataset.goal)
})
$('goals-actions').addEventListener('click', event => {
  const action = event.target.closest('[data-goal-action]')?.dataset.goalAction
  if (action === 'add') goalsEdit('add', null)
  if (action === 'undo') sendGoals({ command: 'undo' })
})
$('goals-chosen').addEventListener('click', event => {
  const action = event.target.closest('[data-goal-action]')?.dataset.goalAction
  if (action === 'group') goalsEdit('group', null)
  if (action === 'clear') {
    goalsUi.chosen.clear()
    if (goalsUi.editing?.kind === 'group') goalsUi.editing = null
    redrawGoals()
  }
})
$('goals-frame').addEventListener('click', event => {
  if (event.target.closest('#goals-lines') !== null) {
    goalsLinesOpen = !goalsLinesOpen
    return redrawGoals()
  }
  const focus = goalsFocus
  const choice = event.target.closest('[data-link-target]')
  if (choice !== null) return goalsLink(choice.dataset.linkTarget)
  const unlink = event.target.closest('[data-unlink]')
  if (unlink !== null && focus !== null) return sendGoals({ command: 'unlink', id: focus, name: unlink.dataset.unlink, target: unlink.dataset.target })
  // B258: what the person does with an ask's answer.
  const askAction = event.target.closest('[data-ask-action]')
  if (askAction !== null && focus !== null) return goalsAskAction(askAction.dataset.askAction, focus, askAction.dataset.askId)
  const tool = event.target.closest('[data-goal-tool]')?.dataset.goalTool
  if (tool === undefined || focus === null) return
  if (tool === 'ask') return openGoalAsk(focus)
  // B358: the re-check taken back: the goal stays open.
  if (tool === 'recheck-back') return sendGoals({ command: 'line', id: focus, name: 'Recheck asked', value: '' }).then(done => { if (done !== null) goalsSay(done.unchanged ? 'There was no re-check to take back.' : 'The re-check is taken back: the goal stays open.', 'ok') })
  if (tool === 'brainstorm') return openBrainstorm(focus)
  // B354: the partner is asked to write the goal's Done when; the map itself is not changed.
  // The review: without the Workers mod the word is put on the clipboard to paste, as every word to the partner.
  if (tool === 'done-when') {
    return sendGoals({ command: 'done-when', id: focus }).then(done => {
      if (done === null) return
      showPaste(done.paste ?? null)
      goalsSay(done.paste ? 'Copied: paste it into your partner\'s chat.' : 'Your partner is asked to write its Done when.', 'ok')
    })
  }
  const node = board?.goals ? goalById(board.goals, focus) : null
  if (tool === 'delete' || tool === 'dissolve') {
    if (!isConfirmed(tool, focus)) {
      if (!isConfirming(tool, focus)) goalsAsk(tool, focus)
      return redrawGoals()
    }
    goalsUi.confirm = null
    // Gone from the map, deleted or dissolved: the map shows where it stood.
    return sendGoals({ command: tool, id: focus }).then(done => {
      if (done !== null) zoomGoal(node?.parent ?? null)
    })
  }
  const value = tool === 'rename' ? node?.title ?? '' : tool === 'Done when' ? node?.doneWhen ?? '' : tool === 'Why' ? node?.why ?? '' : ''
  goalsEdit(tool, focus, value)
})
$('goals-outline').addEventListener('click', event => {
  const row = event.target.closest('.goal-row')
  if (row === null || row.classList.contains('is-editor')) return
  const choice = event.target.closest('[data-link-target]')
  if (choice !== null) return goalsLink(choice.dataset.linkTarget)
  if (event.target.closest('button.goal-fold') !== null) {
    if (goalsOpened.has(row.dataset.goal)) goalsOpened.delete(row.dataset.goal)
    else goalsOpened.add(row.dataset.goal)
    return redrawGoals()
  }
  if (event.target.closest('[data-goal-dot]') !== null) return goalsCycle(row.dataset.goal)
  if (event.target.closest('.goals-editor') !== null) return
  // B256: Ctrl-click chooses goals to group; it zooms nowhere.
  if ((event.ctrlKey || event.metaKey) && canEditGoals(board) && !row.classList.contains('is-ref')) {
    if (goalsUi.chosen.has(row.dataset.goal)) goalsUi.chosen.delete(row.dataset.goal)
    else goalsUi.chosen.add(row.dataset.goal)
    return redrawGoals()
  }
  if (row.classList.contains('is-focus')) return
  zoomGoal(row.dataset.goal)
})

// B256: the editor's box, wherever it stands: Enter keeps, Esc closes, the search box finds as one types.
for (const id of ['goals-frame', 'goals-outline', 'goals-chosen']) {
  $(id).addEventListener('input', event => {
    if (event.target.id !== 'goals-input' || goalsUi.editing === null) return
    goalsUi.editing.value = event.target.value
    if ($('goals-choices') !== null && board?.goals) $('goals-choices').replaceWith(goalChoicesList(board.goals))
  })
  $(id).addEventListener('keydown', event => {
    if (event.target.id !== 'goals-input') return
    if (event.key === 'Enter') {
      event.preventDefault()
      goalsSubmit(event.target.value)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      goalsUi.editing = null
      redrawGoals()
    }
  })
}

// B256: keys on a row's title in the outline, as in an outliner: ↑/↓ walk the rows; Alt+↑/↓ move the goal among its
// siblings, Tab or Alt+→ under the one above, Shift+Tab or Alt+← out after its parent; F2 renames it, Enter adds the
// next goal after it. The row's arrow and dot keep their own keys.
$('goals-outline').addEventListener('keydown', event => {
  if (event.target.closest('.goal-title') === null) return
  const row = event.target.closest('.goal-row')
  if (row === null || row.classList.contains('is-editor')) return
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    const titles = [...$('goals-outline').querySelectorAll('.goal-row .goal-title')]
    const next = titles[titles.indexOf(event.target) + (event.key === 'ArrowUp' ? -1 : 1)]
    if (next) {
      event.preventDefault()
      next.focus()
    }
    return
  }
  if (!canEditGoals(board) || !board?.goals || row.classList.contains('is-ref')) return
  const id = row.dataset.goal
  const key = event.altKey && event.key === 'ArrowUp' ? 'up'
    : event.altKey && event.key === 'ArrowDown' ? 'down'
      : (event.altKey && event.key === 'ArrowRight') || (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.shiftKey) ? 'in'
        : (event.altKey && event.key === 'ArrowLeft') || (event.key === 'Tab' && event.shiftKey && !event.altKey && !event.ctrlKey) ? 'out' : null
  if (key !== null) {
    const target = goalKeyMove(board.goals, id, key)
    if (target === null) return
    event.preventDefault()
    return goalsMove(id, target)
  }
  if (event.key === 'F2') {
    event.preventDefault()
    // The game plan's own goals keep their title.
    if (goalById(board.goals, id)?.fromPlan) return goalsSay('Its title is the game plan\'s: change it through the plan.')
    return goalsEdit('rename', id, goalById(board.goals, id)?.title ?? '')
  }
  if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    goalsEdit('sibling', id)
  }
})

// B256: dragging a row: before or after another, inside it, or onto a crumb; a folded row opens after a second.
let goalsHover = null
function goalsClearMarks() {
  for (const marked of document.querySelectorAll('.goal-row.is-before, .goal-row.is-after, .goal-row.is-into, .goals-crumb .is-into')) marked.classList.remove('is-before', 'is-after', 'is-into')
}
/** Where a drop would land, or null: only a goal dragged on this page counts, never a file or words from elsewhere. */
function goalsDropAt(event) {
  if (goalsUi.drag === null || !board?.goals || !event.dataTransfer?.types.includes('application/x-goal')) return null
  const crumb = event.target.closest?.('.goals-crumb [data-goal]')
  if (crumb) return { mark: crumb, place: 'into', target: goalDropTarget(board.goals, goalsUi.drag, crumb.dataset.goal === '' ? null : crumb.dataset.goal, 'into') }
  const row = event.target.closest?.('.goal-row')
  // A reference row stands away from its goal's home: a drop there would land somewhere else than it shows.
  if (!row || row.classList.contains('is-editor') || row.classList.contains('is-ref')) return null
  const box = row.getBoundingClientRect()
  const place = goalPlaceAt(event.clientY - box.top, box.height)
  return { mark: row, place, target: goalDropTarget(board.goals, goalsUi.drag, row.dataset.goal, place) }
}
$('goals-outline').addEventListener('dragstart', event => {
  const row = event.target.closest?.('.goal-row')
  if (!row || !row.draggable) return
  goalsUi.drag = row.dataset.goal
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-goal', row.dataset.goal)
  event.dataTransfer.setData('text/plain', row.dataset.goal)
  row.classList.add('is-dragging')
})
for (const id of ['goals-outline', 'goals-crumb']) {
  $(id).addEventListener('dragover', event => {
    const at = goalsDropAt(event)
    goalsClearMarks()
    // Held over a folded row, inside it, for a second: the row opens, to drop deeper. Anywhere else the wait ends.
    const fold = at?.target ? at.mark.querySelector?.('button.goal-fold[aria-expanded="false"]') : null
    const over = at?.place === 'into' && fold ? at.mark.dataset.goal : null
    if (goalsHover !== null && goalsHover.id !== over) {
      clearTimeout(goalsHover.timer)
      goalsHover = null
    }
    if (at === null || at.target === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    at.mark.classList.add(`is-${at.place}`)
    if (over !== null && goalsHover === null) goalsHover = { id: over, timer: setTimeout(() => { goalsOpened.add(over); redrawGoals() }, 1000) }
  })
  $(id).addEventListener('drop', event => {
    const at = goalsDropAt(event)
    const from = goalsUi.drag
    goalsEndDrag()
    if (at === null || at.target === null || from === null) return
    event.preventDefault()
    goalsMove(from, at.target)
  })
}
$('goals-outline').addEventListener('dragleave', event => {
  if (!$('goals-outline').contains(event.relatedTarget)) goalsClearMarks()
})
/** The drag is over: dropped, let go, or its row was drawn anew while it was held. */
function goalsEndDrag() {
  goalsUi.drag = null
  clearTimeout(goalsHover?.timer)
  goalsHover = null
  goalsClearMarks()
  for (const row of document.querySelectorAll('.goal-row.is-dragging')) row.classList.remove('is-dragging')
}
// The dragged row may have been drawn anew (a folded row opened), so its own dragend never comes: a drop anywhere
// ends the drag too.
for (const name of ['dragend', 'drop']) {
  document.addEventListener(name, () => {
    if (goalsUi.drag !== null) goalsEndDrag()
  })
}

// Esc zooms out one level while the map is on screen and nothing else (a window, a text box) has the key.
// B256: Ctrl+Z there undoes the last change made on this page.
document.addEventListener('keydown', event => {
  if ($('view-advice').hidden || $('view-advice').dataset.pane !== 'goals') return
  if (document.querySelector('dialog[open]') !== null || event.target.closest?.('input, textarea, select, [contenteditable]')) return
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    if (!canEditGoals(board) || goalsUi.undoable === 0) return
    event.preventDefault()
    return sendGoals({ command: 'undo' })
  }
  if (event.key !== 'Escape') return
  if (goalsTreePress !== null) {
    if (goalsTreePress.lifted) goalsTreeLetGo(goalsTreePress)
    goalsTreePress = null
    return
  }
  if (goalsUi.menu !== null) {
    goalsUi.menu = null
    goalsUi.menuInto = false
    return redrawGoals()
  }
  if (goalsUi.chosen.size > 0) {
    goalsUi.chosen.clear()
    return redrawGoals()
  }
  if (goalsFocus === null) return
  zoomGoal(board?.goals ? goalZoomOut(board.goals, goalsFocus) : null)
})
// The browser's back and forward walk the zoom, and the tabs a goal was left for.
/** The Focus-tab part an address names (`#advice/brainstorm`); undefined when it names none (the map has its own, `goalFocusOf`). */
function advicePaneOf(hash) {
  const found = /^#advice\/([a-z]+)$/.exec(hash)
  return found !== null && found[1] !== 'goals' && ADVISOR_PANES.includes(found[1]) ? found[1] : undefined
}

/** Shows what an address names: a goal on the map, a part of the Focus tab, or a tab. */
function followAddress(hash) {
  const focus = goalFocusOf(hash)
  if (focus === undefined) {
    const tab = tabOfAddress(hash)
    if (tab === null) return
    show(tab)
    const pane = advicePaneOf(hash)
    if (tab === 'advice' && pane !== undefined) showAdvisorPane(pane)
    else if (tab === 'advice' && $('view-advice').dataset.pane === 'goals') showAdvisorPane(advisorFirstPart(board?.advisorParts))
    return
  }
  goalsFocus = focus
  goalsOpened.clear()
  goalsLinesOpen = false
  show('advice')
  showAdvisorPane('goals')
  redrawGoals()
}
window.addEventListener('popstate', () => followAddress(location.hash))

/** B507: a link in an ask's words to a place on this board: closes the popup and goes there; Back returns. */
function goToPlace(hash) {
  if ($('details').open) closeDetails()
  history.pushState(null, '', hash)
  followAddress(hash)
}

// B195: the Advisor's tab in parts: the way to the next milestone first, then the game plan, the suggestions and
// the chat. The person, 2026-10-14: the details go to "different tabs and the main tab only shows some visual
// simplistic flow"; the chat is one of those parts, not a tab of the board's own ("i Do not want a 5th tab").
// B255: the goal map is the second part. B259: the brainstorm the third ("B", its own part).
// Focus 1 (spec 2026-10-18, section 4): the tab is named Focus, its first part is the Focus page; its bar shows Focus,
// Goals and Brainstorm, the others only when the setting advisorParts names them (hidden, not deleted).
// focus:start
const ADVISOR_PANES = ['focus', 'way', 'goals', 'brainstorm', 'plan', 'suggestions', 'refine', 'chat']
const ADVISOR_PARTS_USUAL = ['focus', 'goals', 'brainstorm']

/** The parts the tab's bar shows (the setting advisorParts), in the bar's own order; none it knows: the usual three. */
function advisorPartsShown(setting) {
  const named = Array.isArray(setting) ? ADVISOR_PANES.filter(pane => setting.includes(pane)) : []
  return named.length > 0 ? named : [...ADVISOR_PARTS_USUAL]
}

/** The part the tab opens on when none is named, or one it does not know: the first its bar shows. */
function advisorFirstPart(setting) {
  return advisorPartsShown(setting)[0]
}

const FOCUS_STAGES = [['vibe', 'The goal'], ['how', 'The how'], ['run', 'The run']]

/** "3 h", "45 min": the time the parts not done still name. */
function focusTimeLeft(minutes) {
  if (minutes === null || minutes === undefined) return null
  if (minutes < 60) return `${minutes} min`
  return `${Math.round(minutes / 30) / 2} h`
}

/**
 * Focus 2: whether the person may make the Focus page's moves: on a board that writes the goal map, with a partner on
 * it (the chat the setting advisor names); else why not, in one line.
 */
function focusCan(state) {
  if ((state?.advisor ?? null) === null) return { canWrite: false, whyNot: 'No partner chat is on the board: the setting advisor names none.' }
  if (state?.goalsEdit?.canWrite !== true) return { canWrite: false, whyNot: state?.goalsEdit?.whyNot ?? 'This board only shows.' }
  return { canWrite: true, whyNot: null }
}

/**
 * B358: the focus goal's re-check before its tick, for the run's card: asked (it runs), or its last outcome: a gap the
 * partner closes with follow-up steps, or points for the person. Null without one, or after a passed one.
 */
function focusRecheckView(focus) {
  const waits = focus.lastRecheck?.verdict === 'waits for you' && (focus.recheckAsked === null || focus.lastRecheck.at >= focus.recheckAsked)
  if ((focus.recheckAsked ?? null) !== null && !waits) return { tone: 'asked', title: 'Your partner re-checks it', text: `Against its Done when and its vibe, with the steps' evidence: ${focus.id} gets its tick once that passed.` }
  const last = focus.lastRecheck ?? null
  if (last === null || last.verdict === 'passed') return null
  // B533: with the button to the partner's questions under Needs your attention.
  if (last.verdict === 'waits for you') return { tone: 'waits', title: 'The re-check waits for you', text: `${last.summary}; for you to judge: ${last.gap ?? 'see the questions from your partner'}.`, needs: { label: 'Open your partner\'s questions', ask: null } }
  return { tone: 'failed', title: `The re-check found a gap (attempt ${focus.attempts ?? 1})`, text: `${last.summary}; the gap: ${last.gap ?? 'named under the goal'}. Your partner makes the steps that close it.` }
}

/**
 * B359: the goal guard for the run's card: failed checks since Go so far, the partner's fundamental evaluation, or a
 * rebuild that waits for the person. Null before the first failed check, and without a guard.
 */
function focusGuardView(focus) {
  const guard = focus?.guard ?? null
  if (guard === null) return null
  // B533: each with the button to its question under Needs your attention.
  const needs = { label: guard.ask === null || guard.ask === undefined ? 'Open Needs your attention' : `Answer ${guard.ask}`, ask: guard.ask ?? null }
  // B701: the card of the three failed checks opens the step's window: what was tried, and the question as its options.
  if (guard.state === 'asking' && typeof guard.step === 'string') Object.assign(needs, { label: `See what was tried and answer ${guard.ask}`, step: guard.step })
  if (guard.state === 'rebuild') return { tone: 'rebuild', title: 'A rebuild waits for you', text: `Your partner's evaluation proposes a new how for ${focus.id}${guard.ask === null ? '' : ` (${guard.ask})`}: answer it under Needs your attention. Nothing is rebuilt before your yes.`, needs }
  // 2026-10-24: before the evaluation the board asks the person which model runs it: Fable only with their yes.
  // B669: failed checks are counted per part: the part under evaluation is named, the other parts go on.
  const ofPart = typeof guard.part === 'string' && guard.part !== '' ? ` on ${guard.part}` : ''
  if (guard.state === 'asking') return { tone: 'asking', title: 'Fable or Opus? The board asks you', text: `${guard.attempts} checks failed${ofPart}: before your partner evaluates the approach, answer ${guard.ask} under Needs your attention: A Yes, Fable 5.1 (the strongest, far more tokens), or B No, Opus 5.5. Nothing starts before your answer.`, needs }
  if (guard.state === 'evaluating') return { tone: 'evaluating', title: 'Your partner evaluates the approach', text: `${guard.attempts} checks failed${ofPart}: on high effort your partner asks whether the how is right and what caps the result, then brings you 2 or 3 other ways to pick.${ofPart === '' ? '' : ' The other parts go on.'}` }
  if (guard.attempts === 0) return null
  // 2026-10-25 (the user: "if everything is done, i assumed the red checks failed would disappear"): information, calm.
  // B669: the count per part, worst first, in the calm colour: "Cliffs 3 · Round shapes 1".
  const perPart = (guard.parts ?? []).filter(one => one.count > 0).map(one => `${one.title} ${one.count}`).join(' · ')
  // B752: two rounds without real progress, else three, and the partner brings other ways.
  if (perPart !== '') return { tone: 'counting', title: perPart, text: `Failed checks not fixed yet, per part. At 2 on one part without real progress, or ${guard.of}, your partner looks again at the approach and brings you other ways; the other parts go on. A check whose fix passed counts no more.` }
  return { tone: 'counting', title: `${guard.attempts} failed check${guard.attempts === 1 ? '' : 's'} not fixed yet`, text: `At 2 without real progress, or ${guard.of}, your partner looks again at the approach and brings you other ways. A check whose fix passed counts no more.` }
}

/** B354: whether a goal (or the focus) has a Done when line with words in it. */
function hasDoneWhenLine(node) { return typeof node?.doneWhen === 'string' && node.doneWhen.trim() !== '' }

/** B354: a step's standard as the page shows it: "<kind> · <reference picture> · target <score>", read into its parts. */
function standardParts(line) {
  const [kind = '', picture = '', target = ''] = String(line).split(/\s*·\s*/)
  return { kind, picture, target, line: String(line) }
}

const isPicture = path => /\.(?:png|jpe?g|gif|webp)$/i.test(path ?? '')

/**
 * B684: a part's steps for the Focus page: `blocks` (one tone per step: done, now, wait, stop), `count` (the line under
 * the bar), `toggle` and `steps` (id, title, state in words, tone, `line`: its check, what it waits for and its worker,
 * with the evidence pictures), and `isOpen`: the person's own open or close (`partsOpen`, by the part's title), else open
 * while a step is stopped or a check failed and not fixed (B504: a fix that passed settles it).
 */
function focusStepsView(part, partsOpen) {
  const steps = (part.steps ?? []).map(one => {
    const check = one.check
    const fix = check?.fix
    const isFailed = one.isFailed
    const checkText = check === null ? null
      : check.passed === check.total ? `Check passed: ${check.passed} of ${check.total}`
        : `Check failed: ${check.passed} of ${check.total}${fix === undefined ? '' : fix.isFixed ? `, then its fix ${fix.by} passed${fix.total === null ? '' : ` (${fix.passed} of ${fix.total})`}` : `, ${fix.note}`}`
    const bits = [checkText, one.waitsFor.length === 0 ? null : `Waits for ${one.waitsFor.map(wait => `${wait.id} (${wait.title})`).join(', ')}`, one.owner].filter(bit => bit !== null)
    return {
      id: one.id, title: one.title, tone: one.tone, state: one.state, line: bits.join(' · '), isFailed,
      picture: check !== null && isPicture(check.evidence) ? { path: check.evidence, caption: `${one.id}: ${checkText}` } : null,
      fixPicture: fix !== undefined && isPicture(fix.evidence) ? { path: fix.evidence, caption: `${one.id}: its fix ${fix.by}` } : null,
    }
  })
  // B690: the counts and the open-by-itself flag come from the state; this only words them.
  const { done, checking, fixing, building, stopped, waiting, total } = part.counts ?? { done: 0, checking: 0, fixing: 0, building: 0, stopped: 0, waiting: 0, total: 0 }
  const words = [`${done} of ${total} step${total === 1 ? '' : 's'} finished`, checking > 0 ? `${checking} being checked` : null, fixing > 0 ? `${fixing} being fixed` : null, building > 0 ? `${building} being built` : null, stopped > 0 ? `${stopped} stopped` : null, waiting > 0 ? `${waiting} waiting` : null, part.state === 'now' && part.owner !== null ? `${part.owner} is on it` : null].filter(word => word !== null)
  const isOpen = typeof partsOpen?.[part.title] === 'boolean' ? partsOpen[part.title] : part.opensItself === true
  return {
    blocks: steps.map(one => one.tone),
    count: total === 0 ? null : words.join(' · '),
    toggle: total === 0 ? null : `${isOpen ? 'Hide' : 'Show'} the ${total} step${total === 1 ? '' : 's'}`,
    isOpen: total > 0 && isOpen,
    steps,
  }
}

/**
 * Focus 1: what the Focus page shows (spec 2026-10-18, section 4), from the state's `focus` (null: none) and the goal
 * map (`goals`, the state's): its stage, the head with the goal and, once agreed, its vibe in one line; the strip
 * 1 The vibe → 2 The how → 3 The run; the run's progress; the right card of each stage and its buttons; the run's parts
 * without step ids; and, with no focus or a goal done, the open goals to pick. Focus 2: the buttons work where `can`
 * (focusCan) allows; "This is the goal definition" once the partner wrote one, "Go" once it proposed parts; each says why not.
 */
function focusView(focus, goals, can = null, ui = {}) {
  const stage = focus === null || focus === undefined ? 'pick' : focus.stage
  const at = FOCUS_STAGES.findIndex(([name]) => name === stage)
  const strip = FOCUS_STAGES.map(([, label], index) => ({ n: index + 1, label, state: stage === 'done' || index < at ? 'done' : index === at ? 'now' : 'next' }))
  const allowed = can?.canWrite === true
  const why = allowed ? null : can?.whyNot ?? 'This board only shows.'
  const button = (label, act, isEnabled, title) => ({ label, act, isEnabled: allowed && isEnabled, title: allowed ? title : why })
  const seen = new Set()
  // B354: a goal is picked only with a Done when; without one its row asks the partner to write it (asked: `ui.asked`).
  const asked = Array.isArray(ui.asked) ? ui.asked : []
  const rows = (goals?.nodes ?? []).filter(node => node.state !== 'done' && !seen.has(node.id) && seen.add(node.id))
    .map(node => ({ id: node.id, title: node.title, depth: node.depth, isNow: node.state === 'now', hasDoneWhen: hasDoneWhenLine(node), isAsked: asked.includes(node.id) }))
  const pickOf = question => ({
    question, rows, isEnabled: allowed, title: allowed ? 'Make it your focus: you and your partner agree its vibe first' : why,
    ask: { label: 'Ask your partner to write it', act: 'done-when', isEnabled: allowed, title: allowed ? 'A goal becomes your focus once its Done when says how you check it: your partner writes one' : why },
    noDoneWhen: 'No Done when yet',
    asked: 'Your partner writes its Done when',
    // The review of B354: a word that got lost can be asked again.
    askAgain: { label: 'Ask again', act: 'done-when', isEnabled: allowed, title: allowed ? 'Ask your partner once more to write its Done when' : why },
  })
  if (stage === 'pick') return { stage, head: null, strip: null, progress: null, change: null, pick: pickOf('What do you want to work on?') }
  const vibeLine = focus.vibeAgreed === null ? null : focus.vibe.length > 0 ? focus.vibe.join(' · ') : '(no words kept)'
  const view = {
    stage,
    head: { label: 'Your focus', id: focus.id, title: focus.title, vibeLine },
    strip,
    progress: null,
    vibe: { title: 'The vibe so far', sub: 'draft, written by your partner', lines: focus.vibe, picture: focus.vibePicture, empty: focus.vibe.length > 0 || focus.vibePicture !== null ? null : 'Your partner writes the vibe here while you talk.' },
    how: {
      title: 'The how so far',
      sub: 'proposed by your partner',
      parts: focus.parts.map(part => ({ title: part.title, size: part.size })),
      partnerDecides: focus.partnerDecides,
      youDecide: focus.youDecide,
      empty: focus.parts.length > 0 ? null : 'Your partner proposes the parts here once you talk about the how.',
    },
    buttons: [],
    // The review of Focus 2: in every stage a way back to the pick list.
    change: { label: 'Change focus', isEnabled: allowed, title: allowed ? 'Pick another goal as your focus' : why },
  }
  const hasVibe = focus.vibe.length > 0 || focus.vibePicture !== null
  if (stage === 'vibe') view.buttons = [
    button('This is the goal definition', 'vibe-agree', hasVibe, hasVibe ? 'Agreed: your partner proposes the how next' : 'Your partner writes the vibe here first, while you talk'),
    button('Not yet', 'vibe-not-yet', true, 'Say what is missing: your partner goes on talking'),
  ]
  if (stage === 'how') view.buttons = [
    button('Go', 'how-go', focus.parts.length > 0, focus.parts.length > 0 ? 'Agreed: your partner makes the steps, the main chat hands them out' : 'Your partner proposes the parts here first'),
    button('Not yet', 'how-not-yet', true, 'Say what does not fit: your partner changes the how'),
  ]
  if (stage === 'run' || stage === 'done') {
    const { done, total, minutesLeft } = focus.progress
    const left = stage === 'done' ? null : focusTimeLeft(minutesLeft)
    // B680: a Stopped part is named beside the count, never counted as done.
    const stopped = focus.progress.stopped ?? 0
    view.progress = { text: `${done} of ${total} done${stopped > 0 ? ` · ${stopped} stopped` : ''}${left === null ? '' : ` · about ${left} left`}`, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
  }
  if (stage === 'run') {
    // Redesign Part 2: a part whose tasks are refined and none given yet is on the board's list for a worker.
    // B680: a part with only dropped steps is Stopped (calm, nothing reached); one the person dropped says why.
    const chips = { done: 'Done', now: 'In progress', next: 'Next', ready: 'On the list for a worker', refining: 'Waiting for its refine, then it goes on the list', stopped: 'Stopped, nothing reached' }
    view.run = {
      title: 'The how',
      page: focus.page ?? null,
      parts: focus.parts.map(part => ({
        title: part.title,
        chip: part.state === 'dropped' ? `Dropped: ${part.why ?? ''}`.trim() : chips[part.state],
        tone: part.state,
        percent: part.state === 'done' ? 100 : part.state === 'stopped' || part.state === 'dropped' || part.total === 0 ? 0 : Math.round((part.done / part.total) * 100),
        // B680: under a Stopped part the person may drop it, with a reason; a dropped one has its Undo.
        ...(part.state === 'stopped' ? { drop: { label: 'Drop this part', act: 'part-drop', isEnabled: allowed, title: allowed ? 'You stop this part: say why in one line. It then counts out of the whole. Your partner can instead try another way.' : why } } : {}),
        ...(part.state === 'dropped' ? { undo: { label: 'Undo', act: 'part-undo', isEnabled: allowed, title: allowed ? 'Take the drop back: the part is Stopped again' : why } } : {}),
        owner: part.state === 'now' && part.owner !== null ? `${part.owner} is on it` : null,
        // Fix first: its worker does a board fix first.
        ...(typeof part.fixFirst === 'string' ? { fixFirst: `A board fix goes first: ${part.fixFirst}` } : {}),
        // B354: what its results are checked against: the kind, the reference picture, the target.
        standards: (part.standards ?? []).map(standardParts),
        // B684: one block per step on the bar, a line of words under it, and the steps behind a toggle; a part with a
        // stopped step or a failed check not yet fixed opens by itself, until the person opens or closes it.
        ...focusStepsView(part, ui.partsOpen),
      })),
      stepsOf: focus.id,
    }
    view.note = focusNoteView(focus, allowed, why)
    // Focus 4: the slim talk bar under the parts: the person's words to the partner, in the talk about the goal.
    view.talkBar = { placeholder: 'Talk to your partner about this goal…', act: 'talk-bar', isEnabled: allowed, title: allowed ? 'Your words go to your partner, in the talk about this goal' : why }
    const { done, total } = focus.progress
    // B354: the goal gets its tick against its Done when; a focus picked before that rule may have none.
    const hasLine = hasDoneWhenLine(focus)
    // B677: the goal demo comes first: its link stands above Yes and No; without it Yes waits and the partner is asked.
    const demo = focus.demo ?? null
    view.vibeThere = total > 0 && done === total && (focus.progress.stopped ?? 0) === 0 ? {
      question: 'Did we reach the goal?',
      vibe: focus.vibe,
      doneWhenLine: hasLine ? `Done when: ${focus.doneWhen.trim()}` : null,
      buttons: [
        button('Yes', 'vibe-there-yes', hasLine && demo !== null, !hasLine ? 'Its Done when is missing: the goal gets its tick against it' : demo === null ? 'Your partner makes the goal demo first: you see it before you answer' : 'Your partner re-checks it against its Done when and its vibe; it gets its tick once that passed'),
        button('No', 'vibe-there-no', true, 'Say what is missing: your partner changes the how'),
      ],
      demo: demo === null
        ? { text: focus.demoGaveUp === true ? `Your partner did not answer in ${focus.demoWords} tries: no goal demo yet.` : 'Your partner makes the goal demo first.', link: null, again: button('Ask your partner again', 'goal-demo', allowed, focus.demoAsked === null ? 'Your partner is asked for the goal demo by the board' : 'Your partner was asked: ask once more when the demo does not come') }
        : { text: null, link: { label: 'See the goal demo', path: demo.path, caption: demo.caption || demo.path, isPage: demo.isPage === true }, again: null },
      doneWhen: hasLine ? null : asked.includes(focus.id)
        ? button('Ask your partner again', 'done-when', true, 'Your partner was asked: ask once more when its Done when does not come')
        : button('Ask your partner to write its Done when', 'done-when', true, 'Your partner writes how you check the goal is done'),
    } : null
    // B358: the re-check before the tick: while it runs it stands in place of the question; a gap it found is named.
    view.recheck = focusRecheckView(focus)
    if (view.recheck?.tone === 'asked') view.vibeThere = null
    // B359: the goal guard: attempts so far, the evaluation, a rebuild for the person.
    view.guard = focusGuardView(focus)
  }
  if (stage === 'done') view.pick = pickOf(`${focus.id} is done. What do you want to work on next?`)
  else if (ui.picking === true && allowed) {
    view.pick = { ...pickOf('What do you want to work on instead?'), rows: rows.filter(row => row.id !== focus.id) }
    view.back = { label: `Back to ${focus.id}`, act: 'keep-focus' }
  }
  return view
}

/** Partner answers (2026-10-19): what the Undo of a partner's answer of an ask does. */
const TAKE_BACK_TITLE = 'Take back your partner\'s answer: the question comes to you, and its chat waits for your answer'

/**
 * Partner answers (2026-10-19): the Focus page's switch, "Your partner answers detail questions", as the store keeps it
 * (the state's `partnerAnswers`, on unless the person switched it off); null without a store.
 */
function partnerSwitchView(partnerAnswers) {
  if (partnerAnswers === null || partnerAnswers === undefined) return null
  const on = partnerAnswers.on !== false
  return {
    label: 'Your partner answers detail questions',
    on,
    isEnabled: true,
    title: on
      ? 'On: a worker\'s question that comes with its options or advice goes to your partner first; it answers it and lists the answer in its daily note with an Undo; questions only you can answer still come to you.'
      : 'Off: every question comes to you, as before.',
  }
}

/** Focus 3: at most this many of the partner's questions show under "Needs you"; the rest as "and n more". */
const FOCUS_NEEDS_SHOWN = 3

/**
 * Focus 3 (spec 2026-10-18, sections 3 and 4): the run's right card, "Today's note from your partner": the newest daily
 * note's decided lines, each with Undo (off once asked: "undo asked"), and "Needs you": the partner's open questions on
 * the focus, three at most, then "and n more". `allowed` and `why` as focusView's.
 */
function focusNoteView(focus, allowed, why) {
  const note = focus.note ?? null
  const needs = focus.needs ?? []
  // Partner answers (2026-10-19): a line that lists the partner's answer of an ask (`ask`, a field the state reads from
  // the ask) is taken back, not undone by the partner; `takenBack` says it was (the review's findings: by its field).
  const isAnswer = one => typeof one.ask === 'string'
  const undo = one => (one.takenBack === true
    ? { label: 'taken back', isEnabled: false, title: 'You took your partner\'s answer back: the question came to you' }
    : one.undoAsked && !isAnswer(one) ? { label: 'undo asked', isEnabled: false, title: 'You asked your partner to undo this' }
      // An answer not taken back keeps its Undo, also when its line was marked before (the review's findings).
      : { label: 'Undo', isEnabled: allowed, title: allowed ? (isAnswer(one) ? TAKE_BACK_TITLE : 'Ask your partner to undo this') : why })
  return {
    title: 'Today\'s note from your partner',
    decided: note === null ? [] : note.decided.map(one => ({ text: one.text, note: note.id, ...(isAnswer(one) ? { ask: one.ask } : {}), undo: undo(one) })),
    needs: needs.slice(0, FOCUS_NEEDS_SHOWN),
    more: needs.length > FOCUS_NEEDS_SHOWN ? `and ${needs.length - FOCUS_NEEDS_SHOWN} more` : null,
    empty: note === null && needs.length === 0 ? 'No note yet: your partner writes one each morning, with what it decided for you and what needs you.' : null,
  }
}

/**
 * Focus 2: where the talk stands, as the Brainstorm part answers it: the partner's open question with its options, its
 * why and its picture (the person answers it here), or, while the partner has the turn, what it does. `partner` is
 * state.advisor; `main` the main chat (its name, whether it runs), which starts a partner that does not run.
 */
function focusAsk(thread, partner, main = null) {
  // The review of Focus 2: no talk, or one that is over, wrapped up or holding a proposal (the Brainstorm part's), is
  // started anew from here (`restart`: "Start the talk").
  if (thread === null || thread === undefined) return { question: null, waiting: 'No talk about this goal runs: start one.', restart: true }
  const latest = thread.latest ?? null
  if (thread.state !== 'running' || thread.proposal !== null) return { question: null, waiting: 'This talk is over: start a new one about this goal.', restart: true }
  if (latest !== null && latest.answer === null) {
    return { question: { n: latest.n, why: latest.why ?? null, picture: latest.picture ?? null, options: (latest.options ?? []).map(one => ({ key: one.key, text: one.text, isAdvised: one.isAdvised === true })) }, waiting: null, restart: false }
  }
  const waiting = partner === null || partner === undefined ? 'No partner chat is on the board.'
    : partner.isRunning === false && main?.isRunning === false ? `Your partner's chat is not running, and neither is ${main.name}, which could start it: open one of the two chats.`
      : partner.isRunning === false ? 'Your partner\'s chat is not running: the main chat is asked to start it.'
      : 'Your partner is thinking…'
  return { question: null, waiting, restart: false }
}

/**
 * The talk with the partner on the left of the vibe and the how: the focus goal's brainstorm thread, as bubbles: the
 * person's opening, then each question of the partner and the person's answer (the option and the words), in order.
 */
function focusTalk(thread) {
  if (thread === null || thread === undefined) return []
  const said = question => {
    const answer = question.answer
    if (answer === null || answer === undefined) return null
    if (answer.skipped === true) return 'skipped'
    if (Number.isInteger(answer.back)) return `back to question ${answer.back}`
    if (answer.key === 'Other') return answer.words
    const option = (question.options ?? []).find(one => one.key === answer.key)
    const picked = option === undefined ? answer.key : `${answer.key}, ${option.text}`
    return answer.words ? `${picked}: ${answer.words}` : picked
  }
  const bubbles = thread.opening ? [{ who: 'you', text: thread.opening }] : []
  for (const question of [...(thread.earlier ?? []), ...(thread.latest ? [thread.latest] : [])]) {
    // B475: the question's title, its context after it (an older question has its whole text as the title).
    bubbles.push({ who: 'partner', text: [question.title ?? question.text, question.context].filter(Boolean).join(' ') })
    const words = said(question)
    if (words !== null) bubbles.push({ who: 'you', text: words })
  }
  return bubbles
}

/**
 * The steps behind a goal, for the Backlog: those its Steps and Part lines name, and those of the goals inside it, each
 * once, by number. An id used twice in the map is walked once.
 */
function goalStepIds(goals, id) {
  const byId = new Map()
  for (const node of goals?.nodes ?? []) if (!byId.has(node.id)) byId.set(node.id, node)
  const found = new Set()
  const seen = new Set()
  const walk = at => {
    const node = byId.get(at)
    if (node === undefined || seen.has(at)) return
    seen.add(at)
    for (const step of [...(node.steps ?? []), ...(node.parts ?? []).flatMap(part => part.steps)]) found.add(step)
    for (const child of node.children ?? []) walk(child)
  }
  walk(id)
  return [...found].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}
// focus:end

// vision:start
/** The own-words card's label among an ask's options: no option of the partner's is written so. */
const OWN_WORDS = '\u0000own words'
/** What a project builds, the empty Vision tab's first choice (the trial's gap 1, 2026-10-24). */
const VISION_KINDS = ['Game', 'Website', 'App', 'Other']

/**
 * The empty Vision tab's start (the user, 2026-10-24: "it should start with a nice and easy prompt of what am I trying
 * to build ... Game, website, app, other with text input"): the kinds with the one picked, and whether it can start;
 * Other says nothing by itself, so it needs the person's words (`ui.extra`).
 */
function visionStart(ui) {
  const kind = VISION_KINDS.includes(ui.startKind) ? ui.startKind : null
  const words = String(ui.extra ?? '').trim()
  return { kinds: VISION_KINDS.map(key => ({ key, isPicked: key === kind })), kind, canStart: kind !== null && (kind !== 'Other' || words !== '') }
}

/** The start's words to the partner: the kind, then the person's words on one line ("Game: a tactics game"). */
function visionStartWords(kind, words) {
  const said = String(words ?? '').replace(/\s+/g, ' ').trim()
  return said === '' ? kind : `${kind}: ${said}`
}

/**
 * The wait after Start (2026-10-24, the user: "i want a loader while im waiting for the partner"): what the empty tab
 * shows while the partner starts the plan, from the board's `planStart` (or the Start just sent, before the board read
 * it again). Null shows the start card: nothing sent, a start that never arrived, or Start again.
 */
function visionStartWait(planStart, ui, partner) {
  if (ui.startAgain === true) return null
  const state = planStart?.state ?? (ui.startSent === true ? 'waiting' : null)
  if (state === null || state === 'failed') return null
  const head = state === 'waiting' ? `Your start waits for ${partner} to pick it up`
    : state === 'working' ? `${partner} is starting your plan` : `No answer from ${partner} yet`
  const line = state === 'late' ? `Look in ${partner}'s chat, or start again.`
    : 'It reads what you build, fills in what it already knows and writes its first questions. They come here, one per slide.'
  return { state, isBusy: state !== 'late', head, line, at: planStart?.at ?? null, canAgain: state === 'late' }
}

/** Why the start card shows again: a start that never reached the partner; else null. */
function visionStartProblem(planStart, partner) {
  return planStart?.state === 'failed' ? `Your start did not reach ${partner}: start again.` : null
}
/**
 * The plan's strategies (the user, 2026-10-24: "before it makes this plan it can require imput from the user to choose
 * the strategy"): chosen on the Plan step before the partner lays the plan, or in the person's own words.
 */
const STRATEGIES = [['Playable first', 'a rough version of one path from start to end, then widen'],
  ['Quality first', 'one small part at the final quality first, so the bar is set before you widen'],
  ['Foundation first', 'the systems and tools that are hard to change later, before the content'], ['Risk first', 'the hardest unknown first']]

/**
 * A plan change's label on a milestone or goal (2026-10-24), or null when it keeps it as it is: one short word (the
 * user, 2026-10-25: the long labels covered the titles); its whole words stand on the goal's card.
 */
const BADGE_WORDS = { new: 'New', drop: 'Drop', rename: 'Renamed', merge: 'Merged', split: 'Split', move: 'Moved' }
function planBadge(change) {
  if (change === null || change === undefined || change.kind === 'keep') return null
  return { label: BADGE_WORDS[change.kind] ?? 'Changed', tone: change.kind === 'new' ? 'new' : change.kind === 'drop' ? 'drop' : 'change' }
}

/**
 * The goal map's goal a plan goal goes into (2026-10-25, the user: "i cant see which goals belong to which
 * milestone"): "merge G23 into G41" or "move G43 under G6" on the goal that is G23 or G43; null for a goal of its own.
 */
function absorbedInto(goal) {
  const change = goal.change ?? null
  if (change === null || !['merge', 'move'].includes(change.kind) || (goal.goal ?? null) === null) return null
  return String(change.text ?? '').match(new RegExp(`^${goal.goal}\\s+(?:into|under)\\s+(G\\d+)`))?.[1] ?? null
}

/**
 * The last look (2026-10-25, the user: "1 massive section of text and is not readable"): today's words only, without
 * the earlier looks after "Before:", as a headline and short points.
 */
function planLook(text) {
  const today = String(text ?? '').split(/\s+Before:\s/)[0].trim()
  const at = today.indexOf(': ')
  const head = (at < 0 ? today.split(/\.\s+/)[0] : today.slice(0, at)).trim().replace(/\.$/, '')
  const rest = at < 0 ? today.slice(head.length) : today.slice(at + 2)
  // A point ends at "; " or at ". " before a capital, never inside brackets ("(maps; feel; sound)" stays one point).
  const points = []
  let depth = 0
  let from = 0
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index]
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (char === ';' || (char === '.' && /^\s+[A-Z0-9]/.test(rest.slice(index + 1, index + 3)))) && /\s/.test(rest[index + 1] ?? '')) {
      points.push(rest.slice(from, index))
      from = index + 1
    }
  }
  points.push(rest.slice(from))
  return { head, points: points.map(one => one.trim().replace(/\.$/, '').trim()).filter(Boolean) }
}
/** A feature's marks (the user, 2026-10-21: the milestones do not exist yet on the Features step; the plan places it). */
const MARK_LABELS = [['must', 'Must'], ['later', 'Later'], ['no', 'No'], ['unsure', '?']]

/** "from game-vision.md, 2026-10-10", "you, 2026-10-19", or null: where an answer, mark or goal came from. */
function visionSource(one) {
  const when = one.at === null || one.at === undefined ? '' : `, ${one.at}`
  return one.from !== null && one.from !== undefined ? `from ${one.from}${when}` : one.by !== null && one.by !== undefined ? `${one.by}${when}` : null
}

/** A question's slide: its options as cards, your own words as the last card (D after A, B, C), the one picked. */
function questionSlide(question, ui, title) {
  const keys = question.options.map(option => option.key).filter(key => /^[A-Z]$/.test(key))
  const ownKey = keys.length === 0 ? '' : String.fromCharCode(Math.max(...keys.map(key => key.charCodeAt(0))) + 1)
  const own = { label: OWN_WORDS, key: ownKey, head: 'In your own words', points: [], isAdvised: false, picture: null, isOwn: true }
  const options = [...question.options, own]
  return {
    kind: 'ask', id: question.id, about: question.about, title, askId: question.askId, question: question.question || title,
    isDeeper: question.isDeeper, text: question.text, advice: question.advice, pictures: question.pictures,
    options: options.map(option => ({ ...option, isPicked: ui.picked?.[question.id] === option.label })),
    picked: options.find(option => option.label === ui.picked?.[question.id]) ?? null,
  }
}

/**
 * Vision (2026-10-19): the Vision tab's view of the product plan (src/plan.mjs), in three steps and an interview.
 * `vision`: the pitch and a card per answer (its points, pictures, state, source, and Go deeper). `features`: a card per
 * feature with its mark (your mark not sent yet over the page's), complex or not, built or not, and the architecture
 * check. `goals`: the partner's preset per milestone, each goal with its done when, sub-goals and state (your Confirm
 * not sent yet over the page's). `interview`: one slide per question, in the page's order: an open answer the partner
 * has not asked yet, the partner's questions (the answers' own and deeper ones, then features', then goals'), and the
 * part you press Change on; dots step through them, as the help tour has. `ui` is the tab's own state.
 */
function visionView(plan, ui = { page: 'vision', at: 0, picked: {}, change: null, asked: [], marks: {}, confirms: [] }, focus = null) {
  if (plan === null || plan === undefined) return null
  const questions = plan.questions ?? []
  const features = plan.features ?? []
  const milestones = plan.milestones ?? []
  // What the partner is preparing from your words (src/plan.mjs `withPlanWork`): busy while waiting or working; late
  // or failed may be sent again.
  const working = plan.working ?? []
  const workOn = (command, about = 'plan') => working.find(one => one.command === command && one.about === about) ?? null
  const isBusy = one => one !== null && (one.state === 'waiting' || one.state === 'working')
  const slides = []
  // The Interview as the guided path (the user, 2026-10-21): after the partner's questions of each step, every decision
  // that waits on you there, one per slide, in the steps' order. A decision sent from here stays as sent until the page
  // is written anew (`ui.sent`).
  const sent = ui.sent ?? []
  const decide = slide => slides.push({ kind: 'decide', text: '', ...slide, isSent: sent.includes(slide.id) })
  for (const answer of plan.answers) {
    // An open answer the partner has not asked yet: get its options from the partner, or answer it in your words.
    // 2026-10-24: right after your answer on this card, its next question is on its way (the user: "I would like this prepared in advance").
    if (answer.state === 'open' && answer.ask === null) {
      const isFromAnswer = isBusy(workOn('plan-answer', answer.id))
      slides.push({ kind: 'open', id: answer.id, title: answer.title, question: answer.title, text: answer.known, isFromAnswer, isAsked: isFromAnswer || isBusy(workOn('plan-ask', answer.id)) || (ui.asked ?? []).includes(answer.id) })
    }
    for (const question of questions.filter(one => one.about === answer.id)) slides.push(questionSlide(question, ui, answer.title))
    // An answer your partner assumed: yours, or changed.
    if (answer.state === 'assumed') {
      decide({ id: answer.id, step: 'vision', title: answer.title, question: `Is this your answer for ${answer.title}?`, points: answer.points.length > 0 ? answer.points : [answer.answer].filter(Boolean), pictures: answer.pictures,
        actions: [{ label: 'Yes, mine', act: 'confirm', id: answer.id, isPrimary: true }, { label: 'Change', act: 'change', id: answer.id }] })
    }
  }
  const standards = plan.standards ?? []
  const goalsOfPreset = milestones.flatMap(one => one.goals)
  // 2026-10-25: a goal merged into another goal of the plan, or moved under it, is part of that goal: no card, no slide.
  const planGoalOf = new Map(goalsOfPreset.filter(one => (one.goal ?? null) !== null).map(one => [one.goal, one]))
  const absorbedBy = new Map(goalsOfPreset.map(one => [one.id, planGoalOf.get(absorbedInto(one))?.id ?? null]).filter(([, target]) => target !== null))
  const titleOf = id => features.find(one => one.id === id)?.name ?? goalsOfPreset.find(one => one.id === id)?.title ?? standards.find(one => one.id === id)?.title ?? id
  const questionsOf = isAbout => questions.filter(one => !plan.answers.some(answer => answer.id === one.about) && isAbout(one.about))
  // Features: the partner's questions, then a feature not placed yet: in which milestone does it come?
  for (const question of questionsOf(about => /^F/.test(about))) slides.push(questionSlide(question, ui, titleOf(question.about)))
  // A tradeoff (the user, 2026-10-21): a complex feature later or not sure, prepare now or wait; "?" alone is an answer.
  for (const feature of features.filter(one => one.isComplex && (one.mark === 'later' || one.mark === 'unsure') && one.tradeoff === null)) {
    decide({ id: feature.id, step: 'features', title: feature.name, question: `${feature.name}: prepare now, or wait?`, points: feature.points, pictures: feature.pictures.slice(0, 1),
      tradeoff: feature.prepare ?? null,
      actions: feature.prepare === null || feature.prepare.advice === null
        ? [{ label: 'Get the tradeoff from your partner', act: 'get-tradeoffs', id: feature.id, isPrimary: true }]
        : [{ label: 'Prepare now', act: 'tradeoff-now', id: `${feature.id}:prepare`, isPrimary: feature.prepare.advice === 'now' }, { label: 'Wait', act: 'tradeoff-now', id: `${feature.id}:wait`, isPrimary: feature.prepare.advice === 'wait' },
          { label: 'It is a must', act: 'mark-now', id: `${feature.id}:must` }, { label: 'No', act: 'mark-now', id: `${feature.id}:no` }] })
  }
  // Standards: the partner's questions, then a standard not confirmed yet.
  for (const question of questionsOf(about => /^K/.test(about))) slides.push(questionSlide(question, ui, titleOf(question.about)))
  for (const standard of standards.filter(one => one.state !== 'confirmed')) {
    decide({ id: standard.id, step: 'standards', title: standard.title, question: `Is this the bar for ${standard.title}?`, points: standard.bar.filter((point, index) => (standard.barLevels?.[index] ?? 0) === 0),
      pictures: [standard.reference, ...(standard.barPictures ?? []).map(one => ({ path: one.path, caption: standard.bar[one.at] ?? '' }))].filter(one => one !== null && one !== undefined).slice(0, 3),
      actions: [{ label: 'Confirm', act: 'confirm-standard-now', id: standard.id, isPrimary: true }, { label: 'Change', act: 'change', id: standard.id }] })
  }
  // The plan: the partner's questions, then a goal it proposed.
  for (const question of questionsOf(about => /^S/.test(about))) slides.push(questionSlide(question, ui, titleOf(question.about)))
  for (const goal of goalsOfPreset.filter(one => one.state !== 'confirmed' && one.state !== 'later' && !absorbedBy.has(one.id))) {
    decide({ id: goal.id, step: 'plan', title: goal.title, question: `Is this a goal: ${goal.title}?`, points: [goal.doneWhen === '' ? null : `**Done when:** ${goal.doneWhen}`, goal.why ? `**Why:** ${goal.why}` : null, ...goal.subs].filter(Boolean), pictures: goal.pictures,
      actions: [{ label: 'Confirm', act: 'confirm-goal-now', id: goal.id, isPrimary: true }, { label: 'Change', act: 'change', id: goal.id }] })
  }
  for (const question of questionsOf(about => !/^[FKS]/.test(about))) slides.push(questionSlide(question, ui, titleOf(question.about)))
  // The focus: the next one your partner proposes, when it is not your focus already.
  const next = plan.nextFocus ?? null
  if (next !== null && next.goal !== null && next.goal !== (focus?.id ?? null)) {
    decide({ id: `focus:${next.goal}`, step: 'focus', title: next.title, question: `Focus next on ${next.title}?`, points: [next.why ? `**Why:** ${next.why}` : null, next.when ? `**When:** ${next.when}` : null].filter(Boolean), pictures: [],
      actions: [{ label: 'Make it my focus', act: 'focus-accept', id: next.goal, isPrimary: true }, { label: 'Another', act: 'page', id: 'focus' }] })
  }
  // The part being changed, last: an answer, a feature or a goal of the preset.
  const answer = plan.answers.find(one => one.id === ui.change && one.state !== 'open') ?? null
  const feature = features.find(one => one.id === ui.change) ?? null
  const goal = milestones.flatMap(one => one.goals).find(one => one.id === ui.change) ?? null
  if (answer !== null) slides.push({ kind: 'change', id: answer.id, title: answer.title, question: `Change: ${answer.title}`, points: answer.points.length > 0 ? answer.points : [answer.answer].filter(Boolean), pictures: answer.pictures })
  else if (feature !== null) slides.push({ kind: 'change', id: feature.id, title: feature.name, question: `Change: ${feature.name}`, points: feature.points, pictures: feature.pictures })
  else if (goal !== null) slides.push({ kind: 'change', id: goal.id, title: goal.title, question: `Change: ${goal.title}`, points: [goal.doneWhen === '' ? null : `**Done when:** ${goal.doneWhen}`, ...goal.subs].filter(Boolean), pictures: goal.pictures })
  else {
    const standard = standards.find(one => one.id === ui.change) ?? null
    if (standard !== null) slides.push({ kind: 'change', id: standard.id, title: standard.title, question: `Change: ${standard.title}`, points: [standard.count === '' ? null : `**How many:** ${standard.count}`, ...standard.bar.map((point, index) => (standard.barLevels?.[index] ?? 0) > 0 ? `– ${point}` : `**Bar:** ${point}`)].filter(Boolean), pictures: [standard.reference, standard.today, ...(standard.pictures ?? [])].filter(one => one !== null) })
  }
  // 2026-10-25 (the user: "it says 3 questions left, but i still see all the other question i answered"): a decision you
  // sent leaves the Interview at once; how many are with your partner shows under the dots.
  const answered = slides.filter(slide => slide.kind === 'decide' && slide.isSent).length
  for (let index = slides.length - 1; index >= 0; index -= 1) if (slides[index].kind === 'decide' && slides[index].isSent) slides.splice(index, 1)
  const slideOf = id => slides.findIndex(slide => (slide.kind === 'ask' || slide.kind === 'open') && (slide.id === id || slide.about === id))
  const open = ui.open ?? []
  // A card's pictures as a gallery: one big, the others as thumbnails under it (the user, 2026-10-20); `shown` is the
  // one picked, the first until a click.
  const shownOf = (id, gallery) => Math.min(Math.max(0, (ui.gallery ?? {})[id] ?? 0), Math.max(0, gallery.length - 1))
  const cards = plan.answers.map(one => {
    const points = one.state === 'open' ? [one.known].filter(Boolean) : one.points.length > 0 ? one.points : [one.answer].filter(Boolean)
    // The card shows four points; the rest fold under Details (the user, 2026-10-20: "a lot of text").
    const isOpen = open.includes(one.id)
    return {
      id: one.id, title: one.title, state: one.state, points,
      shown: isOpen ? points : points.slice(0, 4), folded: isOpen ? 0 : Math.max(0, points.length - 4), isOpen,
      pictures: one.pictures, gallery: one.pictures.map(shown => ({ ...shown, label: '' })), shownPicture: shownOf(one.id, one.pictures),
      // Without pictures, the card's icons (the user, 2026-10-20: "add visuals for them all").
      icons: one.icons ?? [],
      source: visionSource(one), revisit: one.revisit, overturned: one.overturned,
      slide: slideOf(one.id), deeper: one.deeper ?? 0, canDeeper: one.state !== 'open',
      // Go deeper sent and not answered yet: the card says so, its button waits.
      deeperWork: workOn('plan-deeper', one.id)?.state ?? null,
      // Settled: a deeper round answered, or the person's "Good enough"; the partner's one line of advice.
      settled: one.settled ?? null, advice: one.advice ?? '', settleWork: workOn('plan-settled', one.id)?.state ?? null,
    }
  })
  const titleOfPart = about => plan.answers.find(one => one.id === about)?.title ?? (about === 'plan' ? null : titleOf(about))
  const marks = ui.marks ?? {}
  const featureCards = features.map(one => ({
    id: one.id, name: one.name, isComplex: one.isComplex, why: one.why, built: one.built, pictures: one.pictures, points: one.points,
    mark: marks[one.id] ?? one.mark, isPending: marks[one.id] !== undefined && marks[one.id] !== one.mark,
    // The milestone the plan placed it in (2026-10-21), with the milestone's name from the preset.
    milestone: one.milestone ?? null, milestoneTitle: milestones.find(stone => stone.id === one.milestone)?.title ?? '',
    prepare: one.prepare ?? null, tradeoff: one.tradeoff ?? null, tradeoffAt: one.tradeoffAt ?? null,
    source: visionSource(one), slide: slideOf(one.id),
  }))
  const pendingMarks = featureCards.filter(card => card.isPending).map(card => `${card.id} ${card.mark}`)
  const tradeoffCards = featureCards.filter(card => card.isComplex && (card.mark === 'later' || card.mark === 'unsure'))
    .map(card => ({ id: card.id, name: card.name, picture: card.pictures[0] ?? null, mark: card.mark, prepare: card.prepare, choice: card.tradeoff, at: card.tradeoffAt, isSent: sent.includes(card.id) }))
  const tradeoffsOpen = tradeoffCards.filter(card => card.choice === null)
  const count = mark => featureCards.filter(card => card.mark === mark).length
  // The architecture check, from the marks as they stand with yours: a complex feature later or unsure means a check of
  // the structure at every milestone.
  const complexOpen = featureCards.filter(card => card.isComplex && (card.mark === 'later' || card.mark === 'unsure'))
  const complex = featureCards.filter(card => card.isComplex)
  const architecture = featureCards.length === 0 ? null : complexOpen.length > 0
    ? `${complexOpen.length} complex feature${complexOpen.length === 1 ? ' is' : 's are'} later or not sure (${complexOpen.map(card => card.name).join(', ')}): the structure is checked again at every milestone, so a rebuild is a planned step, not a surprise.`
    : complex.length > 0 ? `Every complex feature is decided (${complex.map(card => card.name).join(', ')}): build for them now; the structure is checked again only when a new complex feature comes.` : 'No complex feature: the structure is checked again only when one comes.'
  const confirms = ui.confirms ?? []
  const goalCards = milestones.map(one => ({
    id: one.id, title: one.title,
    // 2026-10-24: a plan change's label and cause on the milestone and on each goal; where a goal's steps go.
    badge: planBadge(one.change ?? null), cause: one.cause ?? '',
    goals: one.goals.filter(item => !absorbedBy.has(item.id)).map(item => ({
      id: item.id, title: item.title, doneWhen: item.doneWhen, serves: item.serves, pictures: item.pictures, subs: item.subs, goal: item.goal, why: item.why ?? '',
      badge: planBadge(item.change ?? null), cause: item.cause ?? '', steps: item.steps ?? '', changeText: item.change === null || item.change === undefined ? '' : `${item.change.kind === 'other' ? '' : `${item.change.kind} `}${item.change.text}`.trim(),
      takesIn: goalsOfPreset.filter(other => absorbedBy.get(other.id) === item.id).map(other => ({ id: other.id, title: other.title })),
      state: item.state === 'confirmed' ? 'confirmed' : confirms.includes(item.id) ? 'confirming' : item.state === 'later' ? 'later' : 'proposed', source: visionSource(item), slide: slideOf(item.id),
    })),
  }))
  const allGoals = goalCards.flatMap(one => one.goals)
  // Only what changes (2026-10-24): the goals a plan change touches, and the milestones that hold one or change.
  const onlyChanges = ui.onlyChanges === true
  const shownMilestones = !onlyChanges ? goalCards : goalCards
    .map(one => ({ ...one, goals: one.goals.filter(item => item.badge !== null) }))
    .filter(one => one.badge !== null || one.goals.length > 0)
  // Standards (2026-10-20): per kind of thing the goals need: the bar, the foundation first, today's gap.
  const standardConfirms = ui.standardConfirms ?? []
  // A standard's gallery: the bar's picture, today's, one per bar point that has one (the aspect highlighted), the rest.
  const galleryOf = one => [
    one.reference === null ? null : { ...one.reference, label: 'the bar' },
    one.today === null ? null : { ...one.today, label: 'today' },
    ...(one.barPictures ?? []).map(shown => ({ path: shown.path, caption: one.bar[shown.at] ?? '', label: '', bar: shown.at })),
    ...(one.pictures ?? []).map(shown => ({ ...shown, label: '' })),
  ].filter(shown => shown !== null)
  const standardCards = standards.map(one => ({
    id: one.id, title: one.title, count: one.count, kind: one.kind, done: one.done, reference: one.reference, today: one.today, bar: one.bar, barLevels: one.barLevels ?? [],
    foundation: one.foundation, foundationBuilt: one.foundationBuilt === true, perItem: one.perItem, score: one.score, met: one.met, total: one.total, gap: one.gap,
    gallery: galleryOf(one), shownPicture: shownOf(one.id, galleryOf(one)),
    // Per bar point, where its picture stands in the gallery, or -1: the bullet shows it big on a click.
    barPictureAt: one.bar.map((point, index) => galleryOf(one).findIndex(shown => shown.bar === index)),
    state: one.state === 'confirmed' ? 'confirmed' : standardConfirms.includes(one.id) ? 'confirming' : 'proposed',
    source: visionSource(one), slide: slideOf(one.id), measureWork: workOn('plan-measure', one.id)?.state ?? null,
  }))
  // The Change slide of a standard carries its card, so the slide shows the bar and the rest as the card does.
  const changing = slides.find(slide => slide.kind === 'change')
  if (changing !== undefined && /^K/.test(changing.id)) changing.standard = standardCards.find(card => card.id === changing.id) ?? null
  const { decided, assumed, open: openAnswers } = plan.counts
  const total = plan.answers.length
  const asks = slides.filter(slide => slide.kind === 'ask' || slide.kind === 'open' || (slide.kind === 'decide' && !slide.isSent)).length
  const firstWaiting = Math.max(0, slides.findIndex(slide => slide.kind === 'ask' || slide.kind === 'open' || (slide.kind === 'decide' && !slide.isSent)))
  // The trial's round (2026-10-24, the user: "i prefer to start directly with the interview"): until you pick a step
  // (`ui.page` null), a plan you have decided nothing of yet opens on the Interview, at its first question.
  const isFresh = (ui.page ?? null) === null && decided === 0 && asks > 0
  const at = isFresh ? firstWaiting : slides.length === 0 ? 0 : Math.min(Math.max(0, ui.at ?? 0), slides.length - 1)
  // The new order (2026-10-21): "goals" was the plan's step before.
  const page = isFresh ? 'interview' : ui.page === 'goals' ? 'plan' : ['vision', 'features', 'standards', 'plan', 'focus', 'interview'].includes(ui.page) ? ui.page : 'vision'
  return {
    path: plan.path, pitch: plan.pitch, page, cards, slides, at,
    summary: [`${decided} of ${total} decided by you`, assumed > 0 ? `${assumed} assumed for now` : null, openAnswers > 0 ? `${openAnswers} open` : null, cards.filter(card => card.settled !== null).length > 0 ? `${cards.filter(card => card.settled !== null).length} settled` : null].filter(Boolean).join(' · '),
    // The new order (the user, 2026-10-21): the road's milestones in the vision; features marked must or later (the plan places them in a milestone); the
    // standards; the plan, where the partner lays every goal and names what is missing; the focus it proposes next.
    steps: [
      { id: 'vision', label: '1 · Vision', isDone: total > 0 && openAnswers === 0 },
      { id: 'features', label: '2 · Features', isDone: featureCards.length > 0 && tradeoffsOpen.length === 0 },
      { id: 'standards', label: '3 · Standards', isDone: standardCards.length > 0 && standardCards.every(item => item.state === 'confirmed') },
      { id: 'plan', label: '4 · Plan', isDone: allGoals.length > 0 && allGoals.every(item => item.state === 'confirmed' || item.state === 'later') },
      { id: 'focus', label: '5 · Focus', isDone: focus !== null },
    ],
    interviewLabel: asks > 0 ? `Interview · ${asks} to decide` : 'Interview',
    answered,
    // What waits on you (2026-10-21): how many, and the first slide that does, for the bar's Start.
    waiting: asks, firstWaiting,
    working: working.map(one => ({ ...one, title: titleOfPart(one.about) })),
    busy: {
      marks: isBusy(workOn('plan-marks')), featureAdd: isBusy(workOn('plan-feature-add')),
      confirms: isBusy(workOn('plan-goals-confirm')), goalsChange: isBusy(workOn('plan-goals-change')), agree: isBusy(workOn('plan-goals-agree')),
      standards: isBusy(workOn('plan-standards')), standardConfirms: isBusy(workOn('plan-standards-confirm')), standardsChange: isBusy(workOn('plan-standards-change')), standardsAgree: isBusy(workOn('plan-standards-agree')),
      check: isBusy(workOn('plan-check')), focus: isBusy(workOn('plan-focus')), tradeoffs: isBusy(workOn('plan-tradeoffs')),
      // 2026-10-24: the plan laid in the strategy you picked.
      strategy: isBusy(workOn('plan-strategy')),
    },
    standards: {
      cards: standardCards, pending: standardCards.filter(card => card.state === 'confirming').map(card => card.id),
      summary: standardCards.length === 0 ? '' : `${standardCards.length} standards · ${standardCards.filter(card => card.state === 'confirmed').length} confirmed by you · ${standardCards.filter(card => card.gap !== '').length} with a gap`,
    },
    features: {
      cards: featureCards, architecture, pending: pendingMarks,
      markOptions: MARK_LABELS,
      summary: featureCards.length === 0 ? '' : [`${featureCards.length} features`, `${count('must')} must`, `${count('later')} later`, `${count('no')} no`, `${count('unsure')} not sure`].join(' · '),
      // What keeps the step from its ✓: the features still not sure (the user, 2026-10-21: "there is no clear I'm done").
      unsure: featureCards.filter(card => card.mark === 'unsure').map(card => ({ id: card.id, name: card.name })),
      // The tradeoffs (2026-10-21): each complex feature later or not sure, the partner's advice and your choice; the
      // step's ✓ and the plan's check wait for every choice.
      tradeoffs: tradeoffCards, tradeoffsOpen: tradeoffsOpen.map(card => card.id),
    },
    goals: {
      milestones: shownMilestones, pending: allGoals.filter(item => item.state === 'confirming').map(item => item.id),
      // 2026-10-24: the strategy the plan is laid in (null: you choose it first), the partner's advice, the four.
      strategy: plan.strategy ?? null, strategyAdvice: plan.strategyAdvice ?? null,
      strategies: STRATEGIES.map(([name, words]) => ({ name, words, isAdvised: plan.strategyAdvice?.name === name })),
      onlyChanges, changes: goalCards.filter(one => one.badge !== null).length + allGoals.filter(item => item.badge !== null && (item.state === 'proposed' || item.state === 'confirming')).length,
      totals: { milestones: goalCards.length, goals: allGoals.length },
      summary: allGoals.length === 0 ? '' : `${allGoals.length} goals · ${allGoals.filter(item => item.state === 'confirmed').length} confirmed by you`,
      // The partner's last check of the whole plan (null: none yet).
      check: plan.check ?? null,
    },
    // The focus (2026-10-21): yours now (null: none), and the next one your partner proposes (null: none asked).
    focus: {
      current: focus === null ? null : { id: focus.id, title: focus.title ?? '', doneWhen: focus.doneWhen ?? '', stage: focus.stage ?? null },
      proposal: next === null ? null : { ...next, isCurrent: next.goal !== null && next.goal === (focus?.id ?? null) },
      summary: focus === null ? 'No focus yet' : `Your focus: ${focus.id} ${focus.title ?? ''}`.trim(),
    },
  }
}

/** "**Thinking pays:** a clever push" as text nodes and bold ones, so the lead words stand out. */
function boldParts(text) {
  return String(text).split(/\*\*(.+?)\*\*/).map((part, index) => (index % 2 === 1 ? el('b', '', part) : document.createTextNode(part)))
}
// vision:end

function showAdvisorPane(name) {
  const pane = ADVISOR_PANES.includes(name) ? name : advisorFirstPart(board?.advisorParts)
  $('view-advice').dataset.pane = pane
  for (const button of $('advisor-tabs').querySelectorAll('[data-advisor-pane]')) button.setAttribute('aria-pressed', String(button.dataset.advisorPane === pane))
  if (pane === 'chat') $('messages').scrollTop = $('messages').scrollHeight
  // B255: the address says which part is open on the Advisor tab, and where in the map.
  if (!$('view-advice').hidden) history.replaceState(null, '', adviceAddress())
  try {
    localStorage.setItem('advisor-pane', pane)
  } catch {
    // Kept for this page only.
  }
}
/** Focus 1: the part the tab opened on at the page's start. */
let advisorStartPane = null
$('advisor-tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-advisor-pane]')
  if (button !== null) showAdvisorPane(button.dataset.advisorPane)
})
{
  let saved = null
  try {
    saved = localStorage.getItem('advisor-pane')
  } catch {
    // Without storage the tab opens on the way.
  }
  // B255: a link to the map (#advice/goals/G12) opens it at that goal.
  const linked = goalFocusOf(location.hash)
  if (linked !== undefined) goalsFocus = linked
  showAdvisorPane(linked !== undefined ? 'goals' : advicePaneOf(location.hash) ?? saved)
  advisorStartPane = $('view-advice').dataset.pane
}

/**
 * Focus 1: the tab's bar shows the parts the setting advisorParts names. A part opened at the page's start (the one
 * kept from last time) that the bar no longer shows gives way to the first it does; one opened from elsewhere (the
 * Advisor's chat from its card) stays open.
 */
function drawAdvisorParts(state) {
  const parts = advisorPartsShown(state.advisorParts)
  for (const button of $('advisor-tabs').querySelectorAll('[data-advisor-pane]')) button.hidden = !parts.includes(button.dataset.advisorPane)
  const pane = $('view-advice').dataset.pane
  if (!parts.includes(pane) && pane === advisorStartPane) showAdvisorPane(parts[0])
}

/**
 * Focus 2: what the person is doing on the Focus page, which a redraw keeps: a move on its way, the line after it, the
 * box of "Not yet" open (`vibe` or `how`) and the words typed in each box, the option picked for the open question.
 */
// B354: `asked`, the goals whose Done when the person asked the partner for on this page.
// B680: `dropping`, the title of the Stopped part whose reason the person is writing.
const focusUi = { busy: false, note: null, notYet: null, picked: null, picking: false, dropping: null, asked: [], partsOpen: {}, words: { talk: '', notYet: '', new: '', bar: '', drop: '' } }
const FOCUS_BOXES = { 'focus-talk-words': 'talk', 'focus-not-yet-words': 'notYet', 'focus-new-words': 'new', 'focus-bar-words': 'bar', 'focus-drop-words': 'drop' }

/** B408: the Focus page, drawn from its view when that changed. */
function focusOnce(state) {
  const view = focusPageView(state, focusPageUi())
  once('focus', view, () => drawFocus(view))
}
function redrawFocus() {
  if (board !== null && board !== undefined) focusOnce(board)
}

/** A button of the page: its move (`act`), off with why on hover while it may not go or a move is on its way. */
function focusButton(one, className) {
  const button = el('button', className, one.label)
  button.type = 'button'
  button.disabled = !one.isEnabled || focusUi.busy
  button.title = one.title ?? ''
  if (one.act) button.dataset.focusAct = one.act
  return button
}

/**
 * A box to write in, with its button: `box` names the words it keeps (FOCUS_BOXES), `act` the move its button makes;
 * off with `title` when it may not go.
 */
function focusSay(placeholder, className, { box = null, act = null, label = 'Send', isEnabled = false, title = '' } = {}) {
  const form = el('form', className)
  if (act !== null) form.dataset.focusForm = act
  const text = el('textarea')
  text.rows = 1
  text.placeholder = placeholder
  text.disabled = !isEnabled || focusUi.busy
  text.title = isEnabled ? '' : title
  text.setAttribute('aria-label', placeholder)
  if (box !== null) {
    text.id = box
    text.maxLength = 1000
    text.value = focusUi.words[FOCUS_BOXES[box]]
  }
  form.append(text, focusButton({ label, act, isEnabled, title }, 'focus-send'))
  return form
}

// effortswitch:start
/**
 * B352: the high effort mode's switch under the talk with the partner (`effort`, the state's `advisor.effort`): on or
 * off, its line, whether the partner still has to switch (the line dashed until its answer runs on the mode asked),
 * and its note. Null without a partner.
 */
function effortView(effort) {
  if (effort === null || effort === undefined) return null
  // 2026-10-24: Fable (only for a goal guard's evaluation, with the person's yes) is on too; flipping it goes to usual.
  const isFable = effort.mode === 'fable'
  const isOn = effort.mode === 'high' || isFable
  const label = isFable ? effort.labels.fable ?? 'Fable' : effort.labels.high
  const isSettling = effort.isSet === false
  // Review: a word that did not arrive changed nothing; the switch shows what the partner runs on.
  const note = effort.missed ? 'The main chat did not take the word: flip the switch again.'
    : isSettling ? 'Switching… the main chat sets it; the line turns solid once your partner runs on it.'
      : isFable ? `Your partner runs on ${label} for the goal guard's evaluation, with your yes. Its end switches it back.`
        : isOn ? `Your partner runs on ${label}. Go on the how switches it back.`
          : 'Flip it for the vibe and the how of a hard goal: your partner switches at its next answer.'
  return { isOn, line: isOn ? `on: ${label}` : `off: ${effort.labels.usual}`, isSettling, note }
}
// effortswitch:end

/** B352: the switch's row: "High effort mode", its line and a toggle, then its note (or why the word was not sent). */
function effortSwitch(state, can) {
  const box = el('div', 'effort-box')
  const view = effortView(state.advisor?.effort ?? null)
  if (view === null) return box
  const row = el('div', `effort-switch${view.isOn ? ' is-on' : ''}${view.isSettling ? ' is-settling' : ''}`)
  const toggle = el('button', 'effort-toggle')
  toggle.type = 'button'
  toggle.setAttribute('role', 'switch')
  toggle.setAttribute('aria-checked', String(view.isOn))
  toggle.setAttribute('aria-label', 'High effort mode')
  toggle.dataset.focusAct = 'effort'
  const main = state.workers?.main ?? null
  // Review: off on a board that only shows, as the Focus page's other moves.
  toggle.disabled = main === null || can?.canWrite !== true || sending.has('partner-effort')
  toggle.title = can?.canWrite !== true ? can?.whyNot ?? 'This board only shows.' : main === null ? 'No main chat on the board to switch your partner' : view.isOn ? 'Back to the usual partner' : 'Your partner on high effort for this talk'
  row.append(el('b', '', 'High effort mode'), el('span', 'effort-line', ` · ${view.line}`), toggle)
  const problem = problems.get('partner-effort') ?? null
  box.append(row, el('p', `effort-note${problem === null ? '' : ' is-error'}`, problem ?? view.note))
  return box
}

/** B352: the switch flipped: the word to the main chat, which sets the partner's chat. */
async function switchEffort() {
  const main = board?.workers?.main ?? null
  const effort = board?.advisor?.effort ?? null
  if (main === null || effort === null || sending.has('partner-effort')) return
  await send({ to: main, command: 'partner-effort', mode: effort.mode === 'usual' ? 'high' : 'usual' }, 'partner-effort')
}

/**
 * The talk on the left of the vibe and the how: the focus goal's brainstorm thread, as bubbles; the partner's open
 * question is answered here as on the Brainstorm part: an option, your own words, or both.
 */
function focusTalkCard(state, can) {
  const card = el('section', 'focus-card focus-talk')
  card.append(el('h3', '', 'Talk with your partner'))
  const thread = (state.brainstorms?.threads ?? []).find(one => one.path === state.focus.thread) ?? null
  const bubbles = focusTalk(thread)
  const ask = focusAsk(thread, state.advisor ?? null, mainChatOf(state))
  const list = el('div', 'focus-bubbles')
  if (bubbles.length === 0) list.append(el('p', 'muted', 'No talk about this goal yet.'))
  for (const bubble of bubbles) {
    const row = el('div', `focus-bubble is-${bubble.who}`)
    const face = el('span', 'focus-face')
    face.append(icon(bubble.who === 'you' ? 'person' : 'advisor'))
    const words = el('div', 'focus-words')
    words.append(el('small', '', bubble.who === 'you' ? 'You' : 'Partner'), el('p', '', bubble.text))
    row.append(face, words)
    list.append(row)
  }
  card.append(list)
  if (ask.question !== null) {
    if (ask.question.why) card.append(el('p', 'muted focus-why', `Why: ${ask.question.why}`))
    if (ask.question.options.length > 0) {
      const options = el('div', 'focus-options')
      for (const option of ask.question.options) {
        const chip = el('button', `focus-option${focusUi.picked === option.key ? ' is-chosen' : ''}`)
        chip.type = 'button'
        chip.dataset.focusOption = option.key
        chip.disabled = !can.canWrite || focusUi.busy
        chip.setAttribute('aria-pressed', String(focusUi.picked === option.key))
        chip.append(el('b', '', option.key), el('span', '', option.text))
        if (option.isAdvised) chip.append(el('small', '', 'advised'))
        options.append(chip)
      }
      card.append(options)
    }
    if (ask.question.picture) card.append(picture(ask.question.picture, 'Every option side by side'))
  } else {
    const waiting = el('p', `focus-waiting${/not running|No partner|over|No talk/.test(ask.waiting) ? ' is-off' : ''}`, ask.waiting)
    if (ask.restart) waiting.append(' ', focusButton({ label: 'Start the talk', act: 'restart-talk', isEnabled: can.canWrite, title: can.canWrite ? 'A talk about this goal with your partner, as when you picked it' : can.whyNot }, 'goals-action is-send'))
    card.append(waiting)
  }
  const picked = focusUi.picked !== null && ask.question?.options.some(one => one.key === focusUi.picked) ? focusUi.picked : null
  const placeholder = ask.question === null ? 'Your partner has the turn…' : picked !== null ? `Words to go with ${picked} (if any)…` : 'Write to your partner…'
  card.append(focusSay(placeholder, 'focus-say', { box: 'focus-talk-words', act: 'talk', isEnabled: can.canWrite && ask.question !== null, title: can.canWrite ? 'Your partner has the turn' : can.whyNot }))
  card.append(effortSwitch(state, can))
  return card
}

/** The box of "Not yet" under the buttons: what is missing, in the person's words, sent to the partner. */
function focusNotYet(stage, can) {
  const box = el('div', 'focus-not-yet')
  box.append(focusSay(stage === 'vibe' ? 'What is missing from the vibe?' : stage === 'there' ? 'What is missing? Your partner changes the how.' : 'What does not fit in the how?', 'focus-say', { box: 'focus-not-yet-words', act: 'send-not-yet', label: 'Send to your partner', isEnabled: can.canWrite, title: can.whyNot }))
  return box
}

/** The right card of the vibe: its lines with a tick, its picture, and the two buttons. */
function focusVibeCard(view) {
  const card = el('section', 'focus-card focus-draft')
  card.append(el('h3', '', view.vibe.title), el('p', 'focus-sub', view.vibe.sub))
  if (view.vibe.empty !== null) card.append(el('p', 'muted', view.vibe.empty))
  const lines = el('ul', 'focus-ticks')
  for (const line of view.vibe.lines) lines.append(el('li', '', line))
  card.append(lines)
  if (view.vibe.picture !== null) card.append(picture(view.vibe.picture, 'The vibe in a picture'))
  return card
}

/** The right card of the how: its parts with their sizes, what the partner settles and what it brings to you. */
function focusHowCard(view) {
  const card = el('section', 'focus-card focus-draft')
  card.append(el('h3', '', view.how.title), el('p', 'focus-sub', view.how.sub))
  if (view.how.empty !== null) card.append(el('p', 'muted', view.how.empty))
  const parts = el('ol', 'focus-plan')
  for (const part of view.how.parts) {
    const row = el('li', '')
    row.append(el('span', '', part.title))
    if (part.size !== null) row.append(el('small', '', part.size))
    parts.append(row)
  }
  card.append(parts)
  for (const [title, lines] of [['Decided by your partner', view.how.partnerDecides], ['Brought to you', view.how.youDecide]]) {
    if (lines.length === 0) continue
    card.append(el('h4', '', title))
    const list = el('ul', 'focus-decides')
    for (const line of lines) list.append(el('li', '', line))
    card.append(list)
  }
  return card
}

/** A picture opened with a click, named by its words. */
function focusLook(label, picture) {
  const look = el('button', 'focus-standard-picture', label)
  look.type = 'button'
  look.dataset.zoom = picture.path
  look.dataset.caption = picture.caption
  return look
}

/**
 * B702: a step's title in its row: its words open the step, and a step id inside it (Remake of B612) opens that one.
 * Built from the one helper of the ask words; a step the board does not know keeps plain words.
 */
function focusStepTitle(one) {
  const node = el('span', 'focus-step-what')
  const pieces = [...linkedWords(one.title, board)]
  const known = [...linkedWords(one.id, board)].some(piece => typeof piece !== 'string')
  for (const piece of pieces) {
    if (typeof piece !== 'string' || !known) {
      node.append(piece)
      continue
    }
    const words = el('button', 'ask-link focus-step-title', piece)
    words.type = 'button'
    words.dataset.askLink = one.id
    words.title = `Open the step ${one.id}`
    node.append(words)
  }
  return node
}

/** B684: the opened steps of a part: the reference picture once, then a row per step with its state and its line. */
function focusStepList(part) {
  const box = el('div', 'focus-step-list')
  // B354: what the part's results are checked against, its reference picture opened with a click.
  for (const standard of part.standards ?? []) {
    const line = el('small', 'focus-standard', `Reference: ${standard.kind} · `)
    line.append(focusLook(standard.picture, { path: standard.picture, caption: `The reference for ${standard.kind}` }), ` · ${standard.target}`)
    box.append(line)
  }
  const list = el('ul', 'focus-steps-list')
  for (const one of part.steps) {
    const row = el('li', `focus-step is-${one.tone}`)
    const what = focusStepTitle(one)
    if (one.line !== '' || one.picture !== null || one.fixPicture !== null) {
      // B696: the step ids in the line (its fix, "Waits for") open their step, through the one helper of the ask words.
      const line = linkedEl('small', one.isFailed ? 'is-fail' : '', one.line)
      // B356, B504: the evidence of the check and of its fix, opened with a click
      if (one.picture !== null) line.append(' · ', focusLook('the evidence', one.picture))
      if (one.fixPicture !== null) line.append(' · ', focusLook('the evidence of the fix', one.fixPicture))
      what.append(line)
    }
    row.append(el('span', 'focus-step-dot'), linkedEl('span', 'focus-step-id', one.id), what, el('span', 'focus-step-state', one.state))
    list.append(row)
  }
  box.append(list)
  return box
}

/** The run: the parts with their progress and who is on each; the steps behind a click on its bar's toggle. */
function focusRunCard(view) {
  const card = el('section', 'focus-card focus-run')
  card.append(el('h3', '', view.run.title))
  // 2026-10-25: the page the goal makes, opened on the board.
  if ((view.run.page ?? null) !== null) {
    const page = el('button', 'focus-page', `The page: ${view.run.page.caption || view.run.page.path}`)
    page.type = 'button'
    page.dataset.gameFile = view.run.page.path
    card.append(page)
  }
  for (const part of view.run.parts) {
    const row = el('div', `focus-part is-${part.tone}`)
    const top = el('div', 'focus-part-top')
    top.append(el('b', '', part.title), el('span', `focus-chip is-${part.tone}`, part.chip))
    // B684: one block per step, coloured by its state; a part without steps keeps its plain fill.
    const bar = el('div', part.blocks.length > 0 ? 'focus-bar focus-blocks' : 'focus-bar')
    if (part.blocks.length > 0) for (const tone of part.blocks) bar.append(el('span', `focus-block is-${tone}`))
    else {
      const fillBar = el('span', '')
      fillBar.style.width = `${part.percent}%`
      bar.append(fillBar)
    }
    row.append(top, bar)
    if (part.count !== null) row.append(el('small', 'focus-count', part.count))
    if (part.toggle !== null) {
      const toggle = el('button', 'focus-toggle', `${part.isOpen ? '▾' : '▸'} ${part.toggle}`)
      toggle.type = 'button'
      toggle.dataset.focusPart = part.title
      toggle.setAttribute('aria-expanded', String(part.isOpen))
      row.append(toggle)
      if (part.isOpen) row.append(focusStepList(part))
    }
    if (typeof part.fixFirst === 'string') row.append(linkedEl('small', 'focus-fix', part.fixFirst))
    // B680: under a Stopped part a small "Drop this part" (the reason is asked for first); a dropped one has its Undo.
    if (part.drop !== undefined) {
      const drop = focusButton(part.drop, 'focus-drop')
      drop.dataset.focusGoal = part.title
      row.append(drop)
      if (focusUi.dropping === part.title) row.append(focusSay('Why do you drop this part? One line.', 'focus-say focus-drop-say', { box: 'focus-drop-words', act: 'part-drop-send', label: 'Drop it', isEnabled: part.drop.isEnabled, title: part.drop.title }))
    }
    if (part.undo !== undefined) {
      const undo = focusButton(part.undo, 'focus-drop')
      undo.dataset.focusGoal = part.title
      row.append(undo)
    }
    card.append(row)
  }
  const steps = el('button', 'focus-steps', 'See the tasks behind this →')
  steps.type = 'button'
  steps.dataset.focusSteps = view.run.stepsOf
  card.append(steps)
  return card
}

/** No focus, or the focus is done: the open goals of the map to pick from, and a free line. */
function focusPickCard(view) {
  const back = view.back === undefined ? null : focusButton({ label: view.back.label, act: view.back.act, isEnabled: true, title: 'Keep your focus' }, 'focus-change')
  const pickButton = row => {
    const button = focusButton({ label: 'Pick', act: 'pick', isEnabled: view.pick.isEnabled, title: view.pick.title }, 'goals-action')
    button.dataset.focusGoal = row.id
    return button
  }
  const card = el('section', 'focus-card focus-pick')
  card.append(el('h2', '', view.pick.question))
  if (back !== null) card.append(back)
  const list = el('ul', 'focus-goals')
  for (const row of view.pick.rows) {
    const line = el('li', row.isNow ? 'is-now' : '')
    line.style.setProperty('--depth', String(row.depth))
    line.append(el('span', 'focus-goal-id', row.id), el('span', 'focus-goal-title', row.title))
    // B354: a goal without a Done when is not picked: its row asks the partner to write one, or says it was asked.
    if (row.hasDoneWhen) line.append(pickButton(row))
    else if (row.isAsked) {
      const again = focusButton(view.pick.askAgain, 'goals-action focus-ask-done-when')
      again.dataset.focusGoal = row.id
      line.append(el('small', 'focus-done-when is-asked', view.pick.asked), again)
    } else {
      const ask = focusButton(view.pick.ask, 'goals-action focus-ask-done-when')
      ask.dataset.focusGoal = row.id
      line.append(el('small', 'focus-done-when', view.pick.noDoneWhen), ask)
    }
    list.append(line)
  }
  if (view.pick.rows.length === 0) list.append(el('li', 'muted', 'The goal map has no open goal.'))
  card.append(list, focusSay('Or something new: what do you want to work on?', 'focus-say', { box: 'focus-new-words', act: 'new', label: 'Start', isEnabled: view.pick.isEnabled, title: view.pick.title }))
  return card
}

/**
 * Focus 3: "Today's note from your partner": what it decided for you, each line with Undo (or "undo asked"), and what
 * needs you: its open questions on the focus, each with its options (the advised one marked) and its pictures.
 */
function focusNoteCard(view) {
  const card = el('section', 'focus-card focus-daily')
  card.append(el('h3', '', view.note.title))
  if (view.note.empty !== null) card.append(el('p', 'muted', view.note.empty))
  if (view.note.decided.length > 0) {
    card.append(el('h4', '', 'Decided for you'))
    const list = el('ul', 'focus-decided')
    for (const one of view.note.decided) {
      const row = el('li', '')
      const undo = el('button', `focus-undo${one.undo.isEnabled ? '' : ' is-asked'}`, one.undo.label)
      undo.type = 'button'
      undo.disabled = !one.undo.isEnabled || focusUi.busy
      undo.title = one.undo.title
      undo.dataset.focusUndo = one.text
      undo.dataset.focusNote = one.note
      if (typeof one.ask === 'string') undo.dataset.focusAsk = one.ask
      row.append(linkedEl('span', '', one.text), undo)
      list.append(row)
    }
    card.append(list)
  }
  // B361: while asks gather under the note ("Bother me: once a day"), their whole card stands below: not twice.
  const gathered = new Set(gatheredAsks(board ?? {}).map(need => need.workId))
  const needs = view.note.needs.filter(ask => !gathered.has(ask.id))
  if (needs.length > 0) {
    card.append(el('h4', '', 'Needs you'))
    for (const ask of needs) {
      const box = el('div', 'focus-ask')
      box.append(linkedEl('b', '', ask.title))
      // B452: the ask's context under its title.
      if ((ask.context ?? '') !== '') box.append(linkedEl('p', 'muted focus-why', ask.context))
      if (ask.options.length > 0) {
        const options = el('div', 'focus-ask-options')
        for (const option of ask.options) {
          const button = el('button', `focus-answer${option.isAdvised ? ' is-advised' : ''}`, option.isAdvised ? `${option.label} (advised)` : option.label)
          button.type = 'button'
          button.disabled = focusUi.busy || board?.goalsEdit?.canWrite !== true
          button.dataset.focusAnswer = ask.id
          button.dataset.focusLabel = option.label
          options.append(button)
        }
        box.append(options)
      } else box.append(el('p', 'muted', 'Answer it under Needs your attention, on the Overview.'))
      if (ask.pictures.length > 0) {
        const pictures = el('div', 'focus-ask-pictures')
        for (const path of ask.pictures) pictures.append(picture(path, ask.title))
        box.append(pictures)
      }
      card.append(box)
    }
    if (view.note.more !== null) card.append(el('p', 'muted', view.note.more))
  }
  return card
}

// Vision (2026-10-19): the Vision tab, its own state, its drawing and its moves. The partner writes the page; the board
// types your moves and answers to it (src/planMoves.mjs `planMove`, the store's `answer`). Your feature marks and goal
// confirms wait on the page until you send them, in one word.
const visionUi = { page: null, at: 0, picked: {}, change: null, asked: [], marks: {}, confirms: [], standardConfirms: [], open: [], gallery: {}, words: '', extra: '', busy: false, note: null, sent: [], startKind: null, startSent: false, startAgain: false, startWords: '', strategy: null, changingStrategy: false, onlyChanges: false, notNow: [] }

function visionData(state) {
  return [state.plan ?? null, visionCan(state), state.goalsEdit?.whyNot ?? null, state.focus?.id ?? null, state.focus?.stage ?? null, (visionUi.sent ?? []).join(','), visionUi.page, visionUi.at, visionUi.picked, visionUi.change, visionUi.asked.join(','), visionUi.marks, visionUi.confirms.join(','), visionUi.standardConfirms.join(','), visionUi.open.join(','), visionUi.gallery, visionUi.busy, visionUi.note, visionUi.startKind, visionUi.startSent, visionUi.startAgain, state.planStart ?? null, visionUi.strategy, visionUi.changingStrategy, visionUi.onlyChanges, visionUi.notNow.join(','),
    // While the partner prepares something, the minute, for "sent 2 min ago"; and the partner's name.
    (state.plan?.working ?? []).length > 0 || (state.planStart ?? null) !== null ? Math.floor(state.readAt / MIN) : null, state.advisor?.name ?? null]
}
function redrawVision() {
  if (board !== null && board !== undefined) once('vision', visionData(board), () => drawVision(board))
}
const visionCan = state => state.goalsEdit?.canWrite === true && (state.advisor ?? null) !== null

function visionButton(label, act, { id = null, className = '', isEnabled = true, title = '' } = {}) {
  const button = el('button', `vision-button ${className}`.trim(), label)
  button.type = 'button'
  button.dataset.visionAct = act
  if (id !== null) button.dataset.visionId = id
  button.disabled = !isEnabled || visionUi.busy
  if (!isEnabled && title !== '') button.title = title
  return button
}

/** Up to three pictures, each with its caption under it. */
function visionPictures(pictures, limit = 3) {
  const box = el('div', 'vision-pictures')
  for (const shown of pictures.slice(0, limit)) {
    const frame = el('figure', 'vision-picture')
    frame.append(picture(shown.path, shown.caption))
    if (shown.caption !== '') frame.append(el('figcaption', '', shown.caption))
    box.append(frame)
  }
  return box
}

/** A list of points with their bold lead words. */
function visionPoints(points) {
  const list = el('ul', 'vision-points')
  for (const point of points) {
    const item = el('li')
    item.append(...boldParts(point))
    list.append(item)
  }
  return list
}

/** A text box of the tab: `id` names which of the tab's words it keeps. */
function visionBox(id, placeholder, rows, can) {
  const text = el('textarea', 'vision-box')
  text.id = id
  text.rows = rows
  text.maxLength = 1000
  text.placeholder = placeholder
  text.value = id === 'vision-extra-words' ? visionUi.extra : visionUi.words
  text.disabled = !can || visionUi.busy
  return text
}

function drawVision(state) {
  // The tab is drawn anew as a whole, so the place scrolled to is kept across the redraw (the user, 2026-10-20: a
  // thumbnail clicked sent the page to the top).
  const scrolled = $('view-vision').querySelector('.vision')?.scrollTop ?? 0
  const view = visionView(state.plan ?? null, visionUi, state.focus ?? null)
  // The first page shown with a plan stays, as if picked: the moves that follow (an answer, the arrow keys) read it.
  if (view !== null && visionUi.page === null) Object.assign(visionUi, { page: view.page, at: view.at })
  const can = visionCan(state)
  // Why the buttons are off: a copy or the demo only shows; without a partner chat nobody takes the words.
  const off = state.goalsEdit?.whyNot ?? ((state.advisor ?? null) === null ? 'No partner chat is on the board: the setting advisor names none.' : 'This board only shows.')
  const main = el('main', 'vision')
  const top = el('header', 'vision-top')
  const title = el('div', 'vision-title')
  title.append(el('h1', '', 'Vision'))
  if (view !== null) title.append(el('small', 'muted', view.page === 'features' ? view.features.summary : view.page === 'plan' ? view.goals.summary : view.page === 'standards' ? view.standards.summary : view.page === 'focus' ? view.focus.summary : view.summary))
  top.append(title)
  if (view !== null) {
    const steps = el('nav', 'vision-steps')
    steps.setAttribute('aria-label', 'The steps of the plan')
    view.steps.forEach((step, place) => {
      if (place > 0) steps.append(el('span', 'vision-arrow', '→'))
      const button = visionButton(`${step.label}${step.isDone ? ' ✓' : ''}`, 'page', { id: step.id, className: `vision-mode${step.isDone ? ' is-done' : ''}` })
      button.disabled = false
      button.setAttribute('aria-pressed', String(view.page === step.id))
      steps.append(button)
    })
    const interview = visionButton(view.interviewLabel, 'page', { id: 'interview', className: 'vision-mode vision-interview' })
    interview.disabled = false
    interview.setAttribute('aria-pressed', String(view.page === 'interview'))
    steps.append(interview)
    top.append(steps)
  }
  main.append(top)
  if (!can) main.append(el('p', 'vision-note', `The buttons are off here. ${off}`))
  if (visionUi.note !== null) main.append(el('p', `vision-note${visionUi.note.isProblem ? ' is-problem' : ''}`, visionUi.note.text))
  if (view !== null && view.working.length > 0) main.append(visionWorking(view.working, state, can, off))
  // Decisions waiting (the user, 2026-10-21: "when in the flow is this supposed to happen"): a bar on every step.
  if (view !== null && view.page !== 'interview' && view.waiting > 0) {
    const bar = el('div', 'vision-waiting')
    bar.append(el('b', '', `${view.waiting} decision${view.waiting === 1 ? '' : 's'} wait${view.waiting === 1 ? 's' : ''} for you`),
      el('span', 'muted', ' · one per slide, in the steps\' order'), el('span', 'grow'),
      visionButton('Start', 'start-interview', { className: 'is-primary' }))
    main.append(bar)
  }
  if (view === null) {
    const partner = `${state.chatPrefix ?? ''}${state.advisor?.name ?? 'your partner'}`
    const wait = visionStartWait(state.planStart ?? null, visionUi, partner)
    main.append(wait === null ? visionStartCard(visionStart(visionUi), can, off, visionUi.startAgain ? null : visionStartProblem(state.planStart ?? null, partner)) : visionStartWaitCard(wait, state, can, off))
  }
  else if (view.page === 'vision') main.append(...visionPage(view, can, off))
  else if (view.page === 'features') main.append(...featuresPage(view, can, off))
  else if (view.page === 'plan') main.append(...planPage(view, can, off))
  else if (view.page === 'standards') main.append(...standardsPage(view, can, off))
  else if (view.page === 'focus') main.append(...focusStepPage(view, can, off))
  else if (view.slides.length === 0 || (view.waiting === 0 && !view.slides.some(slide => slide.kind === 'change'))) main.append(visionAllDecided(view))
  else main.append(visionSlide(view, can, off))
  if (view !== null) {
    const file = el('button', 'vision-file', `The whole page: ${view.path}`)
    file.type = 'button'
    file.dataset.gameFile = view.path
    main.append(file)
  }
  $('view-vision').replaceChildren(main)
  if (scrolled > 0) main.scrollTop = scrolled
}

/** The Interview with nothing waiting (2026-10-21): all decided, and where to go from here. */
function visionAllDecided(view) {
  const box = el('section', 'vision-extra vision-all-decided')
  box.append(el('h3', '', 'All decided'),
    el('p', 'muted', view.slides.length > 0 ? 'Your answers went to your partner; the steps show them once it writes the page.' : 'Nothing waits on you now. Go deeper on a vision card, Check the plan on step 4, or Change anything.'),
    visionButton('Back to the steps', 'page', { id: 'vision' }))
  return box
}

/** A small turning circle: something is being prepared. */
function visionSpinner() {
  const spin = el('span', 'vision-spinner')
  spin.setAttribute('aria-hidden', 'true')
  return spin
}

/** "at 23:30, 2 min ago": when a word was sent, against the board's last read (`now`). */
function visionAgo(at, now) {
  const minutes = Math.max(0, Math.floor((now - at) / MIN))
  const ago = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`
  return `at ${clock(at)}, ${ago}`
}

/**
 * Vision (2026-10-19): what the partner is preparing from your words, a line each, with the partner's name: busy with a
 * turning circle, late or failed with Send again where the word can be sent again as it was (no words in it).
 */
function visionWorking(working, state, can, off) {
  const partner = `${state.chatPrefix ?? ''}${state.advisor?.name ?? 'your partner'}`
  const box = el('section', 'vision-working')
  box.setAttribute('aria-live', 'polite')
  for (const one of working) {
    const line = el('div', `vision-working-line is-${one.state}`)
    const on = one.title === null ? '' : ` on ${one.title}`
    const words = one.state === 'waiting' ? `Your word waits for ${partner} to pick it up: ${one.what}${on}.`
      : one.state === 'working' ? `${partner} is preparing ${one.what}${on}.`
        : one.state === 'late' ? `No answer from ${partner} yet on ${one.what}${on}.`
          : `Your word for ${one.what}${on} did not reach ${partner}.`
    if (one.state === 'waiting' || one.state === 'working') line.append(visionSpinner())
    else line.append(el('span', 'vision-working-mark', '!'))
    line.append(el('span', '', words), el('span', 'muted', `sent ${visionAgo(one.at, state.readAt ?? Date.now())}`), el('span', 'grow'))
    if ((one.state === 'late' || one.state === 'failed') && ['plan-deeper', 'plan-ask', 'plan-goals-agree', 'plan-settled', 'plan-measure', 'plan-standards', 'plan-standards-agree'].includes(one.command)) {
      line.append(visionButton('Send again', 'resend', { id: `${one.command}|${one.about}`, isEnabled: can, title: off }))
    } else if (one.state === 'late' || one.state === 'failed') line.append(el('span', 'muted', `Send it again from its box, or look in ${partner}'s chat.`))
    box.append(line)
  }
  // A word waits for a partner whose chat does not run (2026-10-21: three waited an hour unseen): say who can start it,
  // or that the person opens it, with the button that asks the main chat (startParts).
  if (working.some(one => one.state === 'waiting') && (state.advisor ?? null) !== null) box.append(...startParts(state.advisor.name))
  return box
}

/**
 * A card's pictures as a gallery (the user, 2026-10-20): one big, the others as a strip of thumbnails under it, a click
 * on a thumbnail showing it big. The big one zooms as every picture does. Without pictures, `missing` says so.
 */
function visionGallery(id, gallery, shown, missing = 'no picture yet') {
  const box = el('div', 'vision-gallery')
  if (gallery.length === 0) {
    box.append(el('div', 'vision-nopicture', missing))
    return box
  }
  const at = Math.min(Math.max(0, shown), gallery.length - 1)
  const big = gallery[at]
  const frame = el('figure', 'vision-picture is-big')
  frame.append(picture(big.path, big.caption || big.label || ''))
  const caption = [big.label, big.caption].filter(Boolean).join(': ')
  if (caption !== '') frame.append(el('figcaption', '', caption))
  box.append(frame)
  if (gallery.length > 1) {
    const strip = el('div', 'vision-thumbs')
    gallery.forEach((one, index) => {
      const thumb = el('button', 'vision-thumb')
      thumb.type = 'button'
      thumb.dataset.visionAct = 'gallery'
      thumb.dataset.visionId = `${id}:${index}`
      thumb.setAttribute('aria-pressed', String(index === at))
      thumb.title = [one.label, one.caption].filter(Boolean).join(': ') || one.path
      const image = el('img')
      image.alt = thumb.title
      thumb.append(image)
      pictureUrl(one.path).then(url => { if (url !== null) image.src = url })
      strip.append(thumb)
    })
    box.append(strip)
  }
  return box
}

/**
 * The board's icons for a vision card without pictures (the user, 2026-10-20: "a simple steam icon in the how people
 * get it ... typescript and pixijs icons in the built on ... add visuals for them all"): plain line drawings in a
 * 24-unit box, by name. The partner names them in the plan ("- Icon: store · Steam, later"); "badge:TS" is a lettered
 * square for a tool or a brand, drawn here rather than its logo.
 */
const VISION_ICONS = {
  gamepad: [['rect', { x: 3, y: 8, width: 18, height: 9, rx: 4 }], ['path', { d: 'M7 12.5h3M8.5 11v3' }], ['circle', { cx: 15.5, cy: 11.5, r: 0.9 }], ['circle', { cx: 18, cy: 13.5, r: 0.9 }]],
  person: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21a8 8 0 0 1 16 0' }]],
  spark: [['path', { d: 'M12 3l2.4 6 6.4.5-4.9 4.2 1.5 6.3L12 16.6 6.6 20l1.5-6.3L3.2 9.5l6.4-.5z' }]],
  layers: [['path', { d: 'M12 3l9 5-9 5-9-5z' }], ['path', { d: 'M3 12l9 5 9-5M3 16l9 5 9-5' }]],
  map: [['path', { d: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z' }], ['path', { d: 'M9 4v14M15 6v14' }]],
  store: [['path', { d: 'M4 10l1-6h14l1 6z' }], ['path', { d: 'M5 10v10h14V10' }], ['path', { d: 'M10 20v-6h4v6' }]],
  browser: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 9h18' }], ['circle', { cx: 6, cy: 6.5, r: 0.7 }], ['circle', { cx: 8.5, cy: 6.5, r: 0.7 }], ['circle', { cx: 11, cy: 6.5, r: 0.7 }]],
  link: [['path', { d: 'M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1' }], ['path', { d: 'M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1' }]],
  code: [['path', { d: 'M8 6l-5 6 5 6M16 6l5 6-5 6' }]],
  flag: [['path', { d: 'M5 21V4' }], ['path', { d: 'M5 4h13l-3 4 3 4H5' }]],
  check: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8 12l3 3 5-6' }]],
  gauge: [['path', { d: 'M4 16a8 8 0 0 1 16 0' }], ['path', { d: 'M12 16l4-5' }], ['circle', { cx: 12, cy: 16, r: 1 }], ['path', { d: 'M3 20h18' }]],
  sound: [['path', { d: 'M4 10h4l5-4v12l-5-4H4z' }], ['path', { d: 'M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11' }]],
  brush: [['path', { d: 'M4 20l9-9' }], ['path', { d: 'M12 8l4 4 4-4-4-4z' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  coins: [['ellipse', { cx: 12, cy: 7, rx: 7, ry: 3 }], ['path', { d: 'M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5' }]],
}
const UNKNOWN_ICON = [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01' }]]
const BADGE_COLOURS = ['#2f6fcf', '#1d9e75', '#7f57d6', '#c2781d']

/** The icons of a card, each with its caption under it; an unknown name draws as a question mark. */
function visionIcons(icons) {
  const row = el('div', 'vision-icons')
  for (const one of icons.slice(0, 5)) {
    const box = el('figure', 'vision-icon')
    const badge = one.name.match(/^badge:(.{1,5})$/)
    if (badge !== null) {
      const letters = el('span', 'vision-badge', badge[1])
      letters.style.background = BADGE_COLOURS[[...badge[1]].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % BADGE_COLOURS.length]
      box.append(letters)
    } else {
      // Drawn element by element: the page turns no text into markup.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('aria-hidden', 'true')
      for (const [tag, attributes] of VISION_ICONS[one.name] ?? UNKNOWN_ICON) {
        const shape = document.createElementNS('http://www.w3.org/2000/svg', tag)
        for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, String(value))
        svg.append(shape)
      }
      box.append(svg)
    }
    if (one.caption !== '') box.append(el('figcaption', '', one.caption))
    row.append(box)
  }
  return row
}

/** Step 1: the pitch and a card per answer, with Go deeper. */
function visionPage(view, can, off) {
  const parts = []
  if (view.pitch !== '') parts.push(el('p', 'vision-pitch', view.pitch))
  const grid = el('div', 'vision-grid')
  for (const card of view.cards) {
    const box = el('section', `vision-card is-${card.state}`)
    const head = el('h3', '')
    const badges = el('span', 'vision-badges')
    badges.append(el('span', `vision-state is-${card.state}`, card.state))
    if (card.settled !== null) badges.append(el('span', 'vision-state is-settled', 'settled ✓'))
    head.append(el('span', '', card.title), badges)
    box.append(head)
    if (card.gallery.length > 1) box.append(visionGallery(card.id, card.gallery, card.shownPicture))
    else if (card.pictures.length > 0) box.append(visionPictures(card.pictures))
    else if (card.icons.length > 0) box.append(visionIcons(card.icons))
    if (card.shown.length > 0) box.append(visionPoints(card.shown))
    // Four points show; the rest fold under Details, and open on a click.
    if (card.folded > 0 || card.isOpen && card.points.length > 4) {
      const fold = visionButton(card.isOpen ? 'Fewer ▴' : `Details · ${card.folded} more ▾`, 'fold', { id: card.id, className: 'vision-fold' })
      fold.disabled = false
      box.append(fold)
    }
    for (const over of card.overturned) box.append(el('p', 'vision-overturned', `Overturned ${over}`))
    if (card.advice !== '') {
      const advice = el('p', 'vision-advice')
      advice.append(el('b', '', 'Your partner: '), document.createTextNode(card.advice))
      box.append(advice)
    }
    // The foot sits at the card's bottom, so cards of a row end level: where it came from, then the buttons.
    const meta = [card.source, card.revisit === null ? null : `ask again after ${card.revisit}`].filter(one => one !== null).join(' · ')
    const foot = el('div', 'vision-foot')
    if (meta !== '') foot.append(el('p', 'vision-meta muted', meta))
    const buttons = el('div', 'vision-foot-buttons')
    if (card.state === 'open') buttons.append(visionButton('Answer it →', 'goto', { id: String(card.slide), className: 'is-primary' }))
    else {
      if (card.deeper > 0) buttons.append(visionButton(`${card.deeper} deeper question${card.deeper === 1 ? '' : 's'} →`, 'goto', { id: String(card.slide), className: 'is-primary' }))
      else if (card.deeperWork === 'waiting' || card.deeperWork === 'working') {
        // Sent: the button waits, turning, until the partner's questions are there.
        const busy = visionButton('Preparing questions…', 'deeper', { id: card.id, className: 'is-busy', isEnabled: false })
        busy.title = 'Your partner is preparing up to five questions on this card; they come in the interview.'
        busy.prepend(visionSpinner())
        buttons.append(busy)
      } else buttons.append(visionButton(card.settled !== null || card.deeperWork !== null ? 'Deepen again' : 'Go deeper', 'deeper', { id: card.id, isEnabled: can, title: off }))
      // Settled: nothing more to ask on this card, your word. Until then, "Good enough" says so.
      if (card.settled === null && card.state === 'decided') {
        if (card.settleWork === 'waiting' || card.settleWork === 'working') {
          const busy = visionButton('Settling…', 'settle', { id: card.id, className: 'is-busy', isEnabled: false })
          busy.prepend(visionSpinner())
          buttons.append(busy)
        } else buttons.append(visionButton('Good enough', 'settle', { id: card.id, isEnabled: can, title: off }))
      }
      if (card.state === 'assumed' || card.source?.startsWith('from ')) buttons.append(visionButton(card.state === 'assumed' ? 'Confirm' : 'Yes, mine', 'confirm', { id: card.id, isEnabled: can, title: off }))
      buttons.append(visionButton('Change', 'change', { id: card.id, isEnabled: can, title: off }))
    }
    foot.append(buttons)
    box.append(foot)
    grid.append(box)
  }
  parts.push(grid)
  return parts
}

/** Step 2: the features, each with its mark; the architecture check; your marks sent in one word; a feature you miss. */
function featuresPage(view, can, off) {
  const parts = []
  const { cards, architecture, pending } = view.features
  if (cards.length === 0) return [el('p', 'vision-empty', 'No features yet. Type "plan features" to your partner: it lists every feature it sees, each with a picture, for you to mark.')]
  // The tradeoffs (the user, 2026-10-21: "clear tradeoffs before we move on"), apart from the overview, on top.
  if (view.features.tradeoffs.length > 0) parts.push(tradeoffSection(view, can, off))
  const check = el('p', 'vision-check')
  check.append(el('b', '', 'Architecture check: '), document.createTextNode(architecture))
  parts.push(check)
  if (pending.length > 0) {
    const bar = el('div', 'vision-pending')
    bar.append(el('span', '', `${pending.length} mark${pending.length === 1 ? '' : 's'} not sent yet: ${pending.join(', ')}`), el('span', 'grow'),
      visionButton('Undo', 'undo-marks'), visionButton('Send to your partner', 'send-marks', { className: 'is-primary', isEnabled: can && !view.busy.marks, title: view.busy.marks ? 'Your partner is still writing your last marks.' : off }))
    parts.push(bar)
  }
  const grid = el('div', 'vision-grid is-features')
  for (const card of cards) {
    const box = el('section', `vision-card vision-feature is-${card.mark}${card.isPending ? ' is-pending' : ''}`)
    box.dataset.feature = card.id
    if (card.pictures.length > 0) box.append(visionPictures(card.pictures, 1))
    else box.append(el('div', 'vision-nopicture', card.built === 'no' ? 'no picture yet' : ''))
    const head = el('h3', '')
    head.append(el('span', '', card.name))
    const tags = el('span', 'vision-tags')
    if (card.isComplex) {
      const tag = el('span', 'vision-tag is-complex', 'complex')
      tag.title = card.why === '' ? 'Changes how the game is built underneath.' : card.why
      tags.append(tag)
    }
    tags.append(el('span', `vision-tag is-built-${card.built}`, card.built === 'yes' ? 'in the game' : card.built === 'partly' ? 'partly built' : 'not built'))
    head.append(tags)
    box.append(head)
    if (card.isComplex && card.why !== '') box.append(el('p', 'vision-why-complex', `Why complex: ${card.why}`))
    if (card.points.length > 0) box.append(visionPoints(card.points))
    const foot = el('div', 'vision-foot')
    if (card.source !== null) foot.append(el('p', 'vision-meta muted', `${card.isPending ? 'yours, not sent yet' : card.source}`))
    const chips = el('div', 'vision-marks')
    for (const [mark, label] of view.features.markOptions) {
      const chip = visionButton(label, 'mark', { id: `${card.id}:${mark}`, className: `vision-mark is-${mark}`, isEnabled: can, title: off })
      chip.setAttribute('aria-pressed', String(card.mark === mark))
      chip.title = mark === 'unsure' ? 'Not sure yet: the step waits for a mark' : label
      chips.append(chip)
    }
    if (card.isComplex && (card.mark === 'later' || card.mark === 'unsure')) foot.append(el('p', 'vision-meta muted', card.tradeoff === null ? 'Tradeoff: to decide above' : `Tradeoff: ${card.tradeoff === 'prepare' ? 'prepare now' : 'wait'} (yours)`))
    // Where the plan put it (2026-10-21): a must or later feature in a milestone of the road.
    if (card.milestone !== null && (card.mark === 'must' || card.mark === 'later')) foot.append(el('p', 'vision-meta muted', `The plan puts it in ${card.milestone}${card.milestoneTitle === '' ? '' : ` · ${card.milestoneTitle}`}`))
    foot.append(chips)
    if (card.slide >= 0) foot.append(visionButton('Your partner asks about it →', 'goto', { id: String(card.slide), className: 'is-primary' }))
    box.append(foot)
    grid.append(box)
  }
  parts.push(grid)
  const add = el('section', 'vision-extra')
  add.append(el('h3', '', 'A feature you miss'), visionBox('vision-extra-words', 'In your own words: what should the game have that is not here?', 2, can),
    visionButton('Send to your partner', 'feature-add', { className: 'is-primary', isEnabled: can && !view.busy.featureAdd, title: view.busy.featureAdd ? 'Your partner is still adding your last feature.' : off }))
  parts.push(add)
  return parts
}

/** Step 3: the partner's preset of goals per milestone; Confirm (sent in one word), Change, your words on the whole. */
function planPage(view, can, off) {
  const parts = []
  const { milestones, pending, check, strategy } = view.goals
  // 2026-10-24 (the user: "I want him to recommend goals/subgoals in to make this a reality"): the partner's plan to
  // make the vision real, laid in the strategy you choose first; a compact overview on top, the visual cards below.
  const head = el('section', 'vision-extra plan-head')
  head.append(el('h3', '', "Your partner's plan to make this real"))
  const waiting = view.features.tradeoffsOpen
  if (waiting.length > 0) {
    // The tradeoffs first (2026-10-21): what to prepare now changes what the plan holds.
    const first = el('div', 'vision-left')
    first.append(el('span', '', `First the tradeoffs: ${waiting.length} complex feature${waiting.length === 1 ? '' : 's'} on step 2 wait${waiting.length === 1 ? 's' : ''} for prepare now or wait.`), el('span', 'grow'),
      visionButton('Decide them', 'page', { id: 'features', className: 'is-primary' }))
    head.append(first)
  }
  if (visionUi.changingStrategy || (strategy === null && milestones.length === 0 && view.goals.totals.goals === 0)) {
    head.append(planStrategyChoice(view, can, off))
    if (strategy === null && view.goals.totals.goals === 0) {
      parts.push(head)
      return parts
    }
  } else if (strategy === null) {
    const line = el('div', 'plan-strategy-line')
    line.append(el('p', 'muted', 'Strategy: not chosen yet'), el('span', 'grow'), visionButton('Choose a strategy', 'change-strategy', { isEnabled: can, title: off }))
    head.append(line)
  } else {
    const line = el('div', 'plan-strategy-line')
    const said = el('p', '')
    said.append(el('b', '', `Strategy: ${strategy.name} `), el('span', 'muted', [strategy.by === null && strategy.at === null ? '' : `(${[strategy.by, strategy.at].filter(Boolean).join(', ')})`, strategy.why === '' ? '' : `· ${strategy.why}`].filter(Boolean).join(' ')))
    line.append(said, el('span', 'grow'), visionButton('Change strategy', 'change-strategy', { isEnabled: can, title: off }))
    head.append(line)
  }
  const counts = el('div', 'plan-counts')
  const { totals, changes } = view.goals
  const only = el('label', 'check')
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.checked = view.goals.onlyChanges
  box.dataset.visionAct = 'only-changes'
  only.append(box, document.createTextNode(' Only what changes'))
  counts.append(el('span', 'muted', [`${totals.milestones} milestone${totals.milestones === 1 ? '' : 's'}`, `${totals.goals} goal${totals.goals === 1 ? '' : 's'}`, changes > 0 ? `${changes} change${changes === 1 ? '' : 's'} for you to decide` : null].filter(Boolean).join(' · ')), el('span', 'grow'), only)
  if (view.busy.check || view.busy.strategy) {
    const busy = visionButton('Your partner is laying the plan…', 'check-plan', { className: 'is-busy', isEnabled: false })
    busy.prepend(visionSpinner())
    counts.append(busy)
  } else counts.append(visionButton('Recommend again', 'check-plan', { isEnabled: can && waiting.length === 0, title: waiting.length > 0 ? 'Decide the tradeoffs on step 2 first.' : off }))
  head.append(counts)
  if (check !== null) {
    // 2026-10-25 (the user: "1 massive section of text"): today's look only, a headline and its points.
    const look = planLook(check.text)
    const last = el('div', 'plan-look')
    const said = el('p', '')
    said.append(el('b', '', `Last look${check.at === null ? '' : ` (${check.at})`}: `), document.createTextNode(look.head))
    last.append(said)
    if (look.points.length > 0) {
      const list = el('ul', '')
      for (const point of look.points.slice(0, 6)) list.append(el('li', '', point))
      last.append(list)
    }
    if (look.points.length > 6) {
      const more = el('details', '')
      const list = el('ul', '')
      for (const point of look.points.slice(6)) list.append(el('li', '', point))
      more.append(el('summary', 'muted', `${look.points.length - 6} more`), list)
      last.append(more)
    }
    head.append(last)
  }
  parts.push(head)
  if (milestones.length === 0) return [...parts, el('p', 'vision-empty', view.busy.strategy || view.busy.check ? 'Your partner is laying the plan: its milestones and goals come here.' : view.goals.onlyChanges ? 'Nothing changes in this plan.' : 'No goals yet: Recommend again, and your partner lays them per milestone.')]
  // Your words on the whole plan, first (the user, 2026-10-25: "how do i provide feedback based on the current plan?").
  if (!visionUi.changingStrategy) {
    const words = el('section', 'vision-extra plan-feedback')
    words.append(el('h3', '', 'What would you change in this plan?'),
      visionBox('vision-extra-words', 'In your own words: a goal missing, two to merge, fewer goals in M1, another order... Your partner proposes the plan anew.', 3, can))
    const send = el('div', 'vision-foot-buttons')
    send.append(el('span', 'grow'), visionButton('Send to your partner', 'goals-change', { className: 'is-primary', isEnabled: can && !view.busy.goalsChange, title: view.busy.goalsChange ? 'Your partner is still proposing the changed plan.' : off }))
    words.append(send)
    parts.push(words)
  }
  parts.push(planOverview(milestones))
  if (pending.length > 0) {
    const bar = el('div', 'vision-pending')
    bar.append(el('span', '', `${pending.length} goal${pending.length === 1 ? '' : 's'} to confirm: ${pending.join(', ')}`), el('span', 'grow'),
      visionButton('Undo', 'undo-confirms'), visionButton('Send to your partner', 'send-confirms', { className: 'is-primary', isEnabled: can && !view.busy.confirms, title: view.busy.confirms ? 'Your partner is still writing your last confirms.' : off }))
    parts.push(bar)
  }
  for (const milestone of milestones) {
    const section = el('section', 'vision-milestone')
    const title = el('h2', '', `${milestone.id} · ${milestone.title}`)
    if (milestone.badge !== null) title.append(planBadgeEl(milestone.badge))
    section.append(title)
    if (milestone.cause !== '') section.append(el('p', 'vision-meta', `Because: ${milestone.cause}`))
    for (const goal of milestone.goals) section.append(planGoalCard(goal, can, off))
    parts.push(section)
  }
  const extra = el('section', 'vision-extra')
  const buttons = el('div', 'vision-foot-buttons')
  buttons.append(el('span', 'grow'), visionButton('Put the confirmed goals in my goal map', 'goals-agree', { className: 'is-primary', isEnabled: can && !view.busy.agree, title: view.busy.agree ? 'Your partner is putting them in your goal map now.' : off }))
  extra.append(buttons)
  parts.push(extra)
  return parts
}

/** A plan change's label (2026-10-24): New in green, a change in blue, Drop in red. */
function planBadgeEl(badge) {
  return el('span', `plan-badge is-${badge.tone}`, badge.label)
}

/** The strategy to lay the plan in (2026-10-24): the four with the partner's advice, or your own words; then Lay the plan. */
function planStrategyChoice(view, can, off) {
  const box = el('div', 'plan-strategy')
  box.append(el('p', '', 'How should your partner lay the plan? Pick a strategy, or say your own.'))
  const options = el('div', 'plan-strategy-options')
  for (const one of view.goals.strategies) {
    const button = visionButton('', 'pick-strategy', { id: one.name, className: 'vision-mode', isEnabled: can, title: off })
    button.setAttribute('aria-pressed', String(visionUi.strategy === one.name))
    button.append(el('b', '', one.name), el('span', 'muted', one.words))
    if (one.isAdvised) button.append(el('span', 'plan-badge is-new', 'advised'))
    options.append(button)
  }
  box.append(options)
  const advice = view.goals.strategyAdvice
  if (advice !== null && advice.why !== '') box.append(el('p', 'vision-meta', `Your partner advises ${advice.name}: ${advice.why}`))
  box.append(visionBox('vision-extra-words', 'Or your own strategy, in your words', 2, can))
  const buttons = el('div', 'vision-buttons')
  buttons.append(el('span', 'grow'))
  if (visionUi.changingStrategy) buttons.append(visionButton('Keep the strategy', 'keep-strategy'))
  if (view.busy.strategy) {
    const busy = visionButton('Your partner is laying the plan…', 'lay-plan', { className: 'is-busy', isEnabled: false })
    busy.prepend(visionSpinner())
    buttons.append(busy)
  } else buttons.append(visionButton('Lay the plan', 'lay-plan', { className: 'is-primary', isEnabled: can, title: off }))
  box.append(buttons)
  return box
}

/**
 * The overview (2026-10-24, the user: "i need an highover overview as wel"; 2026-10-25: "i cant see which goals belong
 * to which milestone and which goals have subgoals"): one tree per milestone, its goals under it, each goal's sub-goals
 * under the goal; a goal merged into another stands inside it. A click on a goal shows its card.
 */
function planOverview(milestones) {
  const box = el('section', 'vision-extra plan-overview')
  box.append(el('p', 'plan-overview-title', 'Overview · click a goal to see its card'))
  for (const milestone of milestones) {
    const band = el('div', 'plan-tree')
    const head = el('div', 'plan-tree-head')
    head.append(el('b', '', `${milestone.id} · ${milestone.title}`))
    if (milestone.badge !== null) head.append(planBadgeEl(milestone.badge))
    head.append(el('span', 'muted', `${milestone.goals.length} goal${milestone.goals.length === 1 ? '' : 's'}`))
    const goals = el('ul', 'plan-tree-goals')
    for (const goal of milestone.goals) {
      const item = el('li', `plan-tree-goal is-${goal.state}`)
      const node = el('button', 'plan-tree-node')
      node.type = 'button'
      node.dataset.visionAct = 'show-goal'
      node.dataset.visionId = goal.id
      if (goal.changeText !== '') node.title = goal.changeText
      node.append(el('span', 'plan-ov-id', goal.id), el('span', 'plan-tree-title', goal.title))
      if (goal.badge !== null) node.append(planBadgeEl(goal.badge))
      item.append(node)
      if (goal.takesIn.length > 0) item.append(el('p', 'plan-tree-takes muted', `takes in ${goal.takesIn.map(one => `${one.id} ${one.title}`).join(' · ')}`))
      if (goal.subs.length > 0) {
        const subs = el('ol', 'plan-tree-subs')
        for (const sub of goal.subs) subs.append(el('li', '', sub))
        item.append(subs)
      }
      goals.append(item)
    }
    band.append(head, goals)
    box.append(band)
  }
  return box
}

/** A goal's card: its picture, Done when, sub-goals in order, why or cause, its steps, and Yes, Change, Not now. */
function planGoalCard(goal, can, off) {
  const later = goal.state === 'later' || (visionUi.notNow.includes(goal.id) && goal.state === 'proposed')
  const row = el('div', `vision-goal is-${later ? 'later' : goal.state}`)
  row.dataset.goalCard = goal.id
  const shown = el('div', 'vision-goal-picture')
  if (goal.pictures.length > 0) shown.append(picture(goal.pictures[0].path, goal.pictures[0].caption))
  else shown.append(el('div', 'vision-nopicture', ''))
  const body = el('div', 'vision-goal-body')
  const head = el('h3', '')
  head.append(el('span', '', `${goal.id} · ${goal.title}`))
  if (goal.badge !== null) head.append(planBadgeEl(goal.badge))
  head.append(el('span', `vision-state is-${goal.state === 'confirmed' ? 'decided' : goal.state === 'confirming' ? 'assumed' : 'open'}`, later ? 'not now' : goal.state === 'confirming' ? 'yes, not sent' : goal.state))
  body.append(head)
  if (goal.doneWhen !== '') {
    const done = el('p', 'vision-done-when')
    done.append(el('b', '', 'Done when: '), document.createTextNode(goal.doneWhen))
    body.append(done)
  }
  if (goal.subs.length > 0) {
    const list = el('ol', 'plan-subs')
    for (const sub of goal.subs) list.append(el('li', '', sub))
    body.append(list)
  }
  if (goal.why !== '') body.append(el('p', 'vision-meta', `Why: ${goal.why}`))
  if (goal.changeText !== '') {
    const change = el('p', 'vision-meta')
    change.append(el('b', '', 'Change: '), document.createTextNode(goal.changeText))
    body.append(change)
  }
  if (goal.takesIn.length > 0) {
    const takes = el('p', 'vision-meta')
    takes.append(el('b', '', 'Takes in: '), document.createTextNode(goal.takesIn.map(one => `${one.id} ${one.title}`).join(' · ')))
    body.append(takes)
  }
  if (goal.cause !== '') {
    const cause = el('p', 'vision-meta')
    cause.append(el('b', '', 'Because: '), document.createTextNode(goal.cause))
    body.append(cause)
  }
  if (goal.steps !== '') {
    const steps = el('p', 'vision-meta')
    steps.append(el('b', '', 'Its tasks: '), document.createTextNode(goal.steps))
    body.append(steps)
  }
  const meta = [goal.serves.length > 0 ? `serves ${goal.serves.join(', ')}` : null, goal.goal === null ? null : `is ${goal.goal} in your goal map`].filter(Boolean).join(' · ')
  if (meta !== '') body.append(el('p', 'vision-meta muted', meta))
  const buttons = el('div', 'vision-goal-buttons')
  if (goal.state !== 'confirmed') buttons.append(visionButton(goal.state === 'confirming' ? 'Undo yes' : 'Yes', 'confirm-goal', { id: goal.id, className: goal.state === 'confirming' ? '' : 'is-primary', isEnabled: can, title: off }))
  buttons.append(visionButton('Change', 'change', { id: goal.id, isEnabled: can, title: off }))
  if (!later && goal.state !== 'confirmed') buttons.append(visionButton('Not now', 'not-now', { id: goal.id, isEnabled: can, title: off }))
  if (goal.slide >= 0) buttons.append(visionButton('Your partner asks →', 'goto', { id: String(goal.slide), className: 'is-primary' }))
  row.append(shown, body, buttons)
  return row
}

/** The partner's tradeoff for a feature: prepare now (what, the cost now, a late add's cost) or wait (why), or none yet. */
function tradeoffBox(prepare) {
  const box = el('div', `vision-tradeoff is-${prepare?.advice ?? 'none'}`)
  if (prepare === null || prepare.advice === null) box.append(el('b', '', 'Not weighed yet: '), document.createTextNode('your partner says what preparing now costs, and what adding it later costs.'))
  else if (prepare.advice === 'now') {
    box.append(el('b', '', 'Your partner advises: prepare now. '), document.createTextNode(prepare.what))
    if (prepare.now !== '') box.append(el('p', '', `Now: ${prepare.now}`))
    if (prepare.later !== '') box.append(el('p', '', `Later: ${prepare.later}`))
  } else box.append(el('b', '', 'Your partner advises: wait. '), document.createTextNode(prepare.what))
  return box
}

/**
 * The tradeoffs on top of Features (the user, 2026-10-21: "I want clear tradeoffs before we move on"): each complex
 * feature later or not sure, with its picture, the partner's advice, and Prepare now or Wait, sent at once; the step's ✓
 * and the plan's check wait for every choice.
 */
function tradeoffSection(view, can, off) {
  const { tradeoffs, tradeoffsOpen } = view.features
  const section = el('section', 'vision-tradeoffs')
  section.append(el('h2', '', tradeoffsOpen.length > 0 ? `Tradeoffs to decide before the plan: ${tradeoffsOpen.length} of ${tradeoffs.length}` : 'Tradeoffs: all decided'),
    el('p', 'muted', 'A complex feature later or not sure: preparing for it now can be much cheaper than a rebuild when it comes. Not sure is fine; the choice here is only what to prepare.'))
  for (const card of tradeoffs) {
    const row = el('div', `vision-tradeoff-row${card.choice === null ? ' is-open' : ''}`)
    const shown = el('div', 'vision-goal-picture')
    if (card.picture !== null) shown.append(picture(card.picture.path, card.picture.caption))
    const body = el('div', '')
    body.append(el('h3', '', `${card.name} · ${card.mark === 'unsure' ? 'not sure' : 'later'}`), tradeoffBox(card.prepare))
    const buttons = el('div', 'vision-goal-buttons')
    if (card.choice !== null) buttons.append(el('p', 'vision-meta', `Your choice: ${card.choice === 'prepare' ? 'prepare now' : 'wait'}${card.at === null ? '' : ` (${card.at})`}`))
    if (card.isSent && card.choice === null) buttons.append(el('p', 'vision-meta muted', 'Sent: your partner writes it.'))
    else if (card.prepare === null || card.prepare.advice === null) buttons.append(visionButton(view.busy.tradeoffs ? 'Your partner is weighing…' : 'Get the tradeoff', 'get-tradeoffs', { id: card.id, isEnabled: can && !view.busy.tradeoffs, title: off }))
    else {
      for (const [choice, label] of [['prepare', 'Prepare now'], ['wait', 'Wait']]) {
        const button = visionButton(label, 'tradeoff-now', { id: `${card.id}:${choice}`, className: card.choice === choice ? 'is-chosen' : (card.choice === null && (choice === 'prepare') === (card.prepare.advice === 'now')) ? 'is-primary' : '', isEnabled: can, title: off })
        button.setAttribute('aria-pressed', String(card.choice === choice))
        buttons.append(button)
      }
    }
    row.append(shown, body, buttons)
    section.append(row)
  }
  return section
}

/**
 * Step 5 (the user, 2026-10-21: "I want to let AI propose which goal to focus on. then A"): your focus now, and the next
 * one your partner proposes on your word, with its why and when; you make it your focus (the partner never does).
 * Steps are made for the focus goal only, on the Focus tab: its vibe, its how, then Go.
 */
function focusStepPage(view, can, off) {
  const parts = []
  const { current, proposal } = view.focus
  const now = el('section', 'vision-extra')
  now.append(el('h3', '', 'Your focus now'))
  if (current === null) now.append(el('p', 'muted', 'No focus yet.'))
  else {
    now.append(el('p', '', `${current.id} · ${current.title}`))
    if (current.doneWhen !== '') {
      const done = el('p', 'vision-done-when')
      done.append(el('b', '', 'Done when: '), document.createTextNode(current.doneWhen))
      now.append(done)
    }
  }
  now.append(el('p', 'vision-meta muted', 'Tasks are made for the focus only: on the Focus tab your partner drafts its vibe and its how, and Go makes the tasks, each refined before it goes on the list.'))
  parts.push(now)
  const next = el('section', 'vision-extra')
  next.append(el('h3', '', 'Next focus'))
  if (proposal === null || proposal.goal === null) next.append(el('p', 'muted', 'Your partner proposes one when you ask: from the open goals, the milestones\' order, foundations before what needs them, and your focus now.'))
  else {
    const head = el('p', '')
    head.append(el('b', '', `${proposal.goal} · ${proposal.title}`), document.createTextNode(proposal.isCurrent ? ' (your focus now)' : ''))
    next.append(head)
    if (proposal.why !== '') next.append(el('p', '', `Why: ${proposal.why}`))
    if (proposal.when !== '') next.append(el('p', 'muted', `When: ${proposal.when}`))
    if (proposal.others.length > 0) next.append(el('p', 'muted', `Or: ${proposal.others.map(one => `${one.goal} · ${one.title}`).join('; ')}`))
    if (!proposal.isCurrent) next.append(visionButton('Make it my focus', 'focus-accept', { id: proposal.goal, className: 'is-primary', isEnabled: can, title: off }))
  }
  next.append(visionBox('vision-extra-words', 'In your words, when you want another: what matters most to you next...', 2, can))
  if (view.busy.focus) {
    const busy = visionButton('Your partner is choosing…', 'propose-focus', { className: 'is-busy', isEnabled: false })
    busy.prepend(visionSpinner())
    next.append(busy)
  } else next.append(visionButton(proposal === null ? 'Propose the next focus' : 'Propose again', 'propose-focus', { isEnabled: can, title: off }))
  parts.push(next)
  return parts
}

/**
 * A standard's two parts, apart (the user, 2026-10-20: "not all the bullets are the bar ... it all feels the same"):
 * the bar, what each thing must meet (the standard itself, each point with a "see" where it has a picture and its
 * sub-points under it); today, the score and the gap. What the goals need ("5 per world") is no part of the standard:
 * one muted line first. How the things get built (the foundation, the hours) is not shown: a standard is not a step
 * (the user, 2026-10-21: "it's a standard, not a step ... let's just make it a goal"); the gap goal carries the
 * foundation. The card and the Change slide show the same.
 */
function standardSections(card) {
  const parts = []
  if (card.count !== '') parts.push(el('p', 'vision-meta muted', `Needed: ${card.count}`))
  const bar = el('section', 'vision-part is-bar')
  bar.append(el('h4', 'vision-part-label', 'The bar: what each one must meet'))
  if (card.bar.length > 0) {
    // A point of level 1 is a sub-point: it goes in a list under the point before it (the user, 2026-10-20: "use
    // sub-bullets like I did, it reads easier").
    const list = el('ul', 'vision-points')
    let under = null
    card.bar.forEach((point, index) => {
      const item = el('li')
      item.append(...boldParts(point))
      if (card.barPictureAt[index] >= 0) {
        const see = visionButton(card.shownPicture === card.barPictureAt[index] ? '◉ shown' : '◎ see', 'gallery', { id: `${card.id}:${card.barPictureAt[index]}`, className: 'vision-see' })
        see.disabled = false
        see.title = 'Show this aspect\'s picture big'
        item.append(document.createTextNode(' '), see)
      }
      if ((card.barLevels?.[index] ?? 0) > 0 && under !== null) {
        let subs = under.querySelector(':scope > ul')
        if (subs === null) {
          subs = el('ul', 'vision-subpoints')
          under.append(subs)
        }
        subs.append(item)
      } else {
        list.append(item)
        under = item
      }
    })
    bar.append(list)
  } else bar.append(el('p', 'muted', 'Not written yet.'))
  parts.push(bar)
  const today = el('section', 'vision-part')
  today.append(el('h4', 'vision-part-label', 'Today'))
  today.append(el('p', 'vision-today', card.score === '' ? 'Not measured yet.' : card.score))
  if (card.gap !== '') today.append(el('span', 'vision-gap', `gap: ${card.gap}`))
  else if (card.score !== '') today.append(el('span', 'vision-gap is-ok', 'no gap'))
  // The guard (2026-10-21): what the board holds back for this kind, as the queue says it.
  const held = card.state !== 'confirmed' ? `Held: no ${card.kind === '' ? 'step of this kind' : `${card.kind} step`} goes into a queue until this standard is confirmed.`
    : (card.foundation ?? '') !== '' && card.foundationBuilt !== true ? `Held: until its foundation is built, only the foundation's own steps go into a queue.` : null
  if (held !== null) today.append(el('p', 'vision-hold', held))
  parts.push(today)
  return parts
}

/**
 * Step 4 (2026-10-20): the standards, one card per kind of thing the goals need: how many, the bar beside its reference
 * and a picture of today, the foundation to build first, the cost per item, today's score and the gap. Confirm (sent in
 * one word), Change, Measure today (the partner's helper scores what exists), your words on the whole, the gaps into goals.
 */
function standardsPage(view, can, off) {
  const parts = []
  const { cards, pending } = view.standards
  if (cards.length === 0) {
    const empty = el('section', 'vision-extra')
    empty.append(el('h3', '', 'No standards yet'), el('p', 'muted', 'Your partner proposes one per kind of thing your goals need (units, maps, effects, feel...): how many, the bar each must meet, what to build first so each one is cheap, and how today\'s game scores. Gaps become goals.'))
    if (view.busy.standards) {
      const busy = visionButton('Your partner is proposing them…', 'propose-standards', { className: 'is-busy', isEnabled: false })
      busy.prepend(visionSpinner())
      empty.append(busy)
    } else empty.append(visionButton('Propose standards', 'propose-standards', { className: 'is-primary', isEnabled: can, title: off }))
    return [empty]
  }
  if (pending.length > 0) {
    const bar = el('div', 'vision-pending')
    bar.append(el('span', '', `${pending.length} standard${pending.length === 1 ? '' : 's'} to confirm: ${pending.join(', ')}`), el('span', 'grow'),
      visionButton('Undo', 'undo-standard-confirms'), visionButton('Send to your partner', 'send-standard-confirms', { className: 'is-primary', isEnabled: can && !view.busy.standardConfirms, title: view.busy.standardConfirms ? 'Your partner is still writing your last confirms.' : off }))
    parts.push(bar)
  }
  parts.push(el('p', 'vision-check', "The guard: the board keeps a task of a kind off its list until that kind's standard is confirmed and its foundation is built; the foundation's own tasks go first. Every task of the kind is checked against the bar."))
  for (const card of cards) {
    const row = el('div', `vision-standard is-${card.state}`)
    const pictures = visionGallery(card.id, card.gallery, card.shownPicture, 'no picture of the bar or of today yet')
    const body = el('div', 'vision-standard-body')
    const head = el('h3', '')
    const badge = card.state === 'confirmed' ? 'decided' : card.state === 'confirming' ? 'assumed' : 'open'
    head.append(el('span', '', card.title), el('span', `vision-state is-${badge}`, card.state === 'confirming' ? 'confirm, not sent' : card.state))
    body.append(head)
    body.append(...standardSections(card))
    const meta = [card.source, card.kind === '' ? null : `kind ${card.kind}`, card.done === '' ? null : `definition of done: ${card.done}`].filter(one => one !== null).join(' · ')
    if (meta !== '') body.append(el('p', 'vision-meta muted', meta))
    const buttons = el('div', 'vision-goal-buttons')
    if (card.state !== 'confirmed') buttons.append(visionButton(card.state === 'confirming' ? 'Unconfirm' : 'Confirm', 'confirm-standard', { id: card.id, isEnabled: can, title: off }))
    buttons.append(visionButton('Change', 'change', { id: card.id, isEnabled: can, title: off }))
    if (card.measureWork === 'waiting' || card.measureWork === 'working') {
      const busy = visionButton('Measuring…', 'measure', { id: card.id, className: 'is-busy', isEnabled: false })
      busy.prepend(visionSpinner())
      buttons.append(busy)
    } else buttons.append(visionButton(card.score === '' ? 'Measure today' : 'Measure again', 'measure', { id: card.id, isEnabled: can, title: off }))
    if (card.slide >= 0) buttons.append(visionButton('Your partner asks →', 'goto', { id: String(card.slide), className: 'is-primary' }))
    row.append(pictures, body, buttons)
    parts.push(row)
  }
  const extra = el('section', 'vision-extra')
  extra.append(el('h3', '', 'What would you change in these standards?'),
    visionBox('vision-extra-words', 'In your own words: a bar too high or too low, a kind missing, another foundation... Your partner rewrites them.', 3, can))
  const buttons = el('div', 'vision-foot-buttons')
  // The new order (2026-10-21): a standard's gap becomes a goal in step 4, Plan, when your partner checks the plan.
  extra.append(el('p', 'vision-meta muted', 'The gaps become goals on step 4, Plan: Check the plan.'))
  buttons.append(    visionButton('Send to your partner', 'standards-change', { className: 'is-primary', isEnabled: can && !view.busy.standardsChange, title: view.busy.standardsChange ? 'Your partner is still rewriting the standards.' : off }))
  extra.append(buttons)
  parts.push(extra)
  return parts
}

/** One slide of the interview: its options as picture cards (or the Change box), the question, the dots, the buttons. */
function visionSlide(view, can, off) {
  const slide = view.slides[view.at]
  const card = el('section', 'vision-slide')
  const stage = el('div', 'vision-stage')
  if (slide.kind === 'ask') {
    if (slide.pictures.length > 0) {
      const pictures = el('div', 'vision-pictures')
      for (const path of slide.pictures) pictures.append(picture(path, slide.question))
      stage.append(pictures)
    }
    const options = el('div', 'vision-options')
    for (const option of slide.options) {
      // The own-words card holds a text box, which a button may not: it is a card that acts as one.
      const box = el(option.isOwn ? 'div' : 'button', `vision-option${option.isPicked ? ' is-picked' : ''}`)
      if (option.isOwn) {
        box.setAttribute('role', 'button')
        box.tabIndex = 0
      } else box.type = 'button'
      box.dataset.visionAct = 'pick'
      box.dataset.visionId = option.label
      box.setAttribute('aria-pressed', String(option.isPicked))
      if (option.picture !== null) box.append(picture(option.picture, option.head))
      box.append(el('b', '', `${option.key === '' ? '' : `${option.key} · `}${option.head}`))
      if (option.isAdvised) box.append(el('span', 'vision-advised', 'advised'))
      if (option.points.length > 0) {
        const list = el('ul', '')
        for (const point of option.points) list.append(el('li', '', point))
        box.append(list)
      }
      // Your own words: the card holds its box; picking the card or typing in it picks it.
      if (option.isOwn) {
        const text = visionBox('vision-change-words', 'Something else: say it here', 3, can)
        text.classList.add('vision-own')
        box.classList.add('is-own')
        box.append(text)
      }
      options.append(box)
    }
    stage.append(options)
  } else if (slide.kind === 'decide') {
    // A decision that waits on you (2026-10-21): what it is, its pictures, and the buttons of its step.
    if (slide.pictures.length > 0) stage.append(visionPictures(slide.pictures))
    if (slide.tradeoff !== undefined) stage.append(tradeoffBox(slide.tradeoff))
    if (slide.points.length > 0) stage.append(visionPoints(slide.points))
    // Your own words on this one (the user, 2026-10-21: "sometimes I don't have the option to answer its question"):
    // they go to this item, never through the box for a feature you miss.
    if (!slide.isSent) {
      const form = el('form', 'vision-change')
      form.append(visionBox('vision-change-words', 'Or in your own words: what you think, a condition, a doubt... It goes to your partner about this one.', 2, can))
      stage.append(form)
    }
  } else if (slide.kind === 'open') {
    // No options yet: the partner prepares them (with pictures where it is about looks), or you answer in your words.
    const ask = el('div', 'vision-open')
    const head = el('b', '', slide.isFromAnswer ? 'Your partner is preparing the next question.' : slide.isAsked ? 'Your partner is preparing the options.' : 'Your partner has not prepared options for this yet.')
    if (slide.isAsked) head.prepend(visionSpinner())
    ask.append(head,
      el('p', 'muted', slide.isAsked ? 'They come here as cards, with pictures where it is about how it looks. You can answer in your own words meanwhile.' : 'Get two or three options to pick from, or answer it in your own words.'))
    if (!slide.isAsked) ask.append(visionButton('Get options from your partner', 'ask-options', { id: slide.id, className: 'is-primary', isEnabled: can, title: off }))
    const form = el('form', 'vision-change')
    form.append(visionBox('vision-change-words', 'Or answer it in your own words', 2, can))
    stage.append(ask, form)
  } else {
    const form = el('form', 'vision-change')
    form.append(visionBox('vision-change-words', 'What should it be? In your words; your partner rewrites it.', 3, can))
    if (slide.standard !== undefined && slide.standard !== null) {
      // A standard: its gallery and its two parts, as its card shows them.
      stage.append(visionGallery(slide.standard.id, slide.standard.gallery, slide.standard.shownPicture, 'no picture yet'))
      stage.append(el('p', 'muted', 'Now:'), ...standardSections(slide.standard), form)
    } else {
      if (slide.pictures.length > 0) stage.append(visionPictures(slide.pictures))
      stage.append(el('p', 'muted', 'Now:'), visionPoints(slide.points), form)
    }
  }
  const STEP_NAMES = { vision: '1 · Vision', features: '2 · Features', standards: '3 · Standards', plan: '4 · Plan', focus: '5 · Focus' }
  const kicker = slide.kind === 'decide' ? STEP_NAMES[slide.step] ?? null : slide.kind === 'ask' && slide.isDeeper ? `Deeper · ${slide.title}` : slide.kind === 'ask' && slide.id !== slide.title ? slide.title : null
  if (kicker !== null && kicker !== slide.question) card.append(el('p', 'vision-kicker', kicker))
  card.append(stage, el('h2', 'vision-question', slide.question))
  if (slide.kind !== 'change' && slide.text !== '') card.append(el('p', 'vision-why', slide.text))
  if (slide.kind === 'ask' && slide.advice !== null) card.append(el('p', 'vision-why muted', `Your partner advises ${slide.advice}.`))
  const dots = el('div', 'help-dots')
  view.slides.forEach((one, place) => {
    const dot = el('button', 'help-dot')
    dot.type = 'button'
    dot.dataset.visionAct = 'goto'
    dot.dataset.visionId = String(place)
    dot.setAttribute('aria-label', `Question ${place + 1}: ${one.question}`)
    if (place === view.at) dot.setAttribute('aria-current', 'true')
    dots.append(dot)
  })
  card.append(dots)
  if (view.answered > 0) card.append(el('p', 'vision-meta muted vision-answered', `${view.answered} answered: your partner writes ${view.answered === 1 ? 'it' : 'them'} in`))
  const buttons = el('div', 'vision-buttons')
  const back = visionButton('Back', 'goto', { id: String(view.at - 1) })
  back.disabled = view.at === 0
  buttons.append(back, el('span', 'grow'))
  if (slide.kind === 'ask') {
    buttons.append(visionButton("Don't know", 'dunno', { id: slide.askId, isEnabled: can, title: off }))
    buttons.append(visionButton(slide.picked === null ? 'Pick an option' : `Answer: ${slide.picked.key || slide.picked.head}`, 'answer', { id: slide.askId, className: 'is-primary', isEnabled: can && slide.picked !== null, title: slide.picked === null ? 'Pick an option first.' : off }))
  } else if (slide.kind === 'decide') {
    if (slide.isSent) buttons.append(el('span', 'muted', 'Sent: your partner writes it.'))
    else {
      for (const action of slide.actions) buttons.append(visionButton(action.label, action.act, { id: action.id, className: action.isPrimary ? 'is-primary' : '', isEnabled: can || action.act === 'page', title: off }))
      buttons.append(visionButton('Send my words', 'decide-words', { id: slide.id, isEnabled: can, title: off }))
    }
  } else if (slide.kind === 'open') {
    buttons.append(visionButton('Send my answer', 'send-open', { id: slide.id, isEnabled: can, title: off }))
  } else {
    buttons.append(visionButton('Keep it', 'keep', { id: slide.id }))
    buttons.append(visionButton('Send to your partner', 'send-change', { id: slide.id, className: 'is-primary', isEnabled: can, title: off }))
  }
  const next = visionButton('Next', 'goto', { id: String(view.at + 1) })
  next.disabled = view.at >= view.slides.length - 1
  buttons.append(next)
  card.append(buttons)
  return card
}

/**
 * The empty Vision tab's start (the trial's gap 1, 2026-10-24): what you build, picked from four, your words, and Start,
 * which asks the partner to begin the interview; its questions then come here, one per slide.
 */
function visionStartCard(start, can, off, problem) {
  const card = el('section', 'vision-card vision-start')
  card.append(el('h2', '', 'What are you building?'),
    el('p', 'muted', 'Pick what it is and say it in a few words. Your partner starts the plan from it; its questions come here, one per slide.'))
  if (problem !== null) card.append(el('p', 'vision-note is-problem', problem))
  const kinds = el('div', 'vision-steps vision-start-kinds')
  for (const kind of start.kinds) {
    const button = visionButton(kind.key, 'start-kind', { id: kind.key, className: 'vision-mode', isEnabled: can, title: off })
    button.setAttribute('aria-pressed', String(kind.isPicked))
    const examples = {
      Game: ['🎮', 'e.g. a tactics game, mobile puzzle, …'],
      Website: ['💻', 'e.g. portfolio, blog, landing page, …'],
      App: ['📱', 'e.g. iOS/Android app, tool, utility, …'],
      Other: ['💡', 'e.g. a goal, automation, service, …'],
    }
    const [picture, example] = examples[kind.key] ?? examples.Other
    const symbol = el('span', 'vision-kind-picture', picture)
    symbol.setAttribute('aria-hidden', 'true')
    button.replaceChildren(symbol, el('span', 'vision-kind-label', kind.key), el('span', 'vision-kind-example', example))
    kinds.append(button)
  }
  card.append(kinds, visionBox('vision-extra-words', 'In a few words: what is it, and who is it for? (a tactics game for short breaks, a site for my bakery...)', 3, can))
  const buttons = el('div', 'vision-buttons')
  buttons.append(el('span', 'grow'))
  const why = !can ? off : start.kind === null ? 'Pick what you build first.' : 'Say in a few words what it is.'
  const begin = visionButton('Start the plan', 'start-plan', { className: 'is-primary', isEnabled: can && start.canStart && !visionUi.busy, title: why })
  const arrow = el('span', 'vision-start-arrow', '→')
  arrow.setAttribute('aria-hidden', 'true')
  begin.append(arrow)
  buttons.append(begin)
  card.append(buttons)
  return card
}

/** The loader after Start (2026-10-24): a turning circle while the partner starts the plan; late, with Start again. */
function visionStartWaitCard(wait, state, can, off) {
  const card = el('section', `vision-card vision-start vision-start-wait is-${wait.state}`)
  card.setAttribute('aria-live', 'polite')
  const head = el('div', 'vision-start-wait-head')
  if (wait.isBusy) {
    const spin = visionSpinner()
    spin.classList.add('is-big')
    head.append(spin)
  } else head.append(el('span', 'vision-working-mark', '!'))
  head.append(el('h2', '', wait.head))
  card.append(head, el('p', 'muted', wait.line))
  if (wait.at !== null) card.append(el('p', 'muted vision-start-wait-at', `Sent ${visionAgo(wait.at, state.readAt ?? Date.now())}`))
  if (wait.canAgain) {
    const buttons = el('div', 'vision-buttons')
    buttons.append(el('span', 'grow'), visionButton('Start again', 'start-again', { isEnabled: can, title: off }))
    card.append(buttons)
  }
  return card
}

/** A move of the Vision tab: to the store (an answer) or to the goals route (a word to the partner), then read again. */
async function visionSend(url, body, done) {
  visionUi.busy = true
  visionUi.note = null
  redrawVision()
  let ok = false
  try {
    const answer = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify(body) })
    ok = answer.ok
    if (answer.ok) {
      visionUi.note = { isProblem: false, text: done }
      showPaste((await answer.json().catch(() => null))?.paste ?? null)
    } else visionUi.note = { isProblem: true, text: `Not done: ${(await answer.text()).trim() || `refused (${answer.status})`}` }
  } catch {
    visionUi.note = { isProblem: true, text: 'Not done: the board\'s server does not answer.' }
  } finally {
    visionUi.busy = false
  }
  await read()
  redrawVision()
  return ok
}

// 2026-10-24: the Vision tab's words go on the plan's own way (server.mjs /api/plan), with no focus on it.
const toPartner = (body, done) => visionSend('/api/plan', body, done)

async function visionAct(act, id) {
  // The empty tab's start (the trial's gap 1): its two moves come before there is a plan to view.
  if (act === 'start-kind') {
    visionUi.startKind = id
    visionUi.note = null
    return redrawVision()
  }
  if (act === 'start-plan') {
    const start = visionStart(visionUi)
    if (!start.canStart) return redrawVision()
    const words = visionStartWords(start.kind, visionUi.extra)
    if (await toPartner({ command: 'plan-start', text: words }, 'Sent to your partner: it starts the plan interview.')) {
      // The words stay at hand for Start again, but not in the other boxes that share them.
      visionUi.startWords = visionUi.extra
      visionUi.extra = ''
      visionUi.startSent = true
      visionUi.startAgain = false
      visionUi.note = null
    }
    return redrawVision()
  }
  if (act === 'start-again') {
    visionUi.startAgain = true
    visionUi.extra = visionUi.startWords
    visionUi.note = null
    return redrawVision()
  }
  const view = visionView(board?.plan ?? null, visionUi, board?.focus ?? null)
  if (view === null) return
  const slide = view.slides[view.at] ?? null
  if (act === 'page') {
    visionUi.page = id
    visionUi.note = null
  } else if (act === 'goto') {
    const at = Math.min(Math.max(0, Number(id)), Math.max(0, view.slides.length - 1))
    // Words typed on one slide do not follow to the next.
    if (at !== view.at || visionUi.page !== 'interview') visionUi.words = ''
    visionUi.page = 'interview'
    visionUi.at = at
  } else if (act === 'pick' && slide?.kind === 'ask') {
    visionUi.picked = { ...visionUi.picked, [slide.id]: visionUi.picked[slide.id] === id ? null : id }
  } else if (act === 'change') {
    visionUi.change = id
    visionUi.words = ''
    visionUi.page = 'interview'
    visionUi.at = visionView(board?.plan ?? null, visionUi, board?.focus ?? null).slides.length - 1
  } else if (act === 'keep') {
    visionUi.change = null
    visionUi.page = pageOfPart(slide?.id ?? '')
  } else if (act === 'fold') {
    visionUi.open = visionUi.open.includes(id) ? visionUi.open.filter(one => one !== id) : [...visionUi.open, id]
  } else if (act === 'gallery') {
    // A thumbnail clicked: that picture big on its card.
    const [part, index] = String(id).split(':')
    visionUi.gallery = { ...visionUi.gallery, [part]: Number(index) }
  } else if (act === 'settle') {
    return toPartner({ command: 'plan-settled', id }, `${id} is settled: your partner marks it so.`)
  } else if (act === 'confirm-standard') {
    visionUi.standardConfirms = visionUi.standardConfirms.includes(id) ? visionUi.standardConfirms.filter(one => one !== id) : [...visionUi.standardConfirms, id]
  } else if (act === 'undo-standard-confirms') {
    visionUi.standardConfirms = []
  } else if (act === 'send-standard-confirms') {
    if (await toPartner({ command: 'plan-standards-confirm', text: view.standards.pending.join(', ') }, 'Your confirms went to your partner: it marks the standards confirmed and writes each into its definition of done.')) visionUi.standardConfirms = []
  } else if (act === 'propose-standards') {
    return toPartner({ command: 'plan-standards' }, 'Your partner proposes a standard per kind your goals need: they come here as cards.')
  } else if (act === 'measure') {
    return toPartner({ command: 'plan-measure', id }, `Your partner's helper scores today's ${titleOfStandard(view, id)} against the bar: the score and a picture come on the card.`)
  } else if (act === 'standards-change') {
    if (visionUi.extra.trim() === '') visionUi.note = { isProblem: true, text: 'Write it in the box first.' }
    else if (await toPartner({ command: 'plan-standards-change', text: visionUi.extra.trim() }, 'Sent to your partner: it rewrites the standards.')) visionUi.extra = ''
  } else if (act === 'standards-agree') {
    return toPartner({ command: 'plan-standards-agree' }, 'Your partner turns every gap into a goal of the preset and your goal map, the foundation first.')
  } else if (act === 'mark') {
    const [feature, mark] = String(id).split(':')
    visionUi.marks = { ...visionUi.marks, [feature]: mark }
  } else if (act === 'undo-marks') {
    visionUi.marks = {}
  } else if (act === 'confirm-goal') {
    visionUi.confirms = visionUi.confirms.includes(id) ? visionUi.confirms.filter(one => one !== id) : [...visionUi.confirms, id]
  } else if (act === 'undo-confirms') {
    visionUi.confirms = []
  } else if (act === 'confirm') {
    if (slide?.kind === 'decide' && slide.id === id) visionUi.sent = [...visionUi.sent, id]
    return toPartner({ command: 'plan-confirm', id }, `${id} is your decision now: your partner writes it so.`)
  } else if (act === 'deeper') {
    return toPartner({ command: 'plan-deeper', id }, `Your partner prepares up to five deeper questions on ${id}: they come in the interview.`)
  } else if (act === 'send-marks') {
    if (await toPartner({ command: 'plan-marks', text: view.features.pending.join('; ') }, 'Your marks went to your partner: it writes them into the plan.')) visionUi.marks = {}
  } else if (act === 'feature-add' || act === 'goals-change') {
    if (visionUi.extra.trim() === '') visionUi.note = { isProblem: true, text: 'Write it in the box first.' }
    else if (await toPartner({ command: act === 'feature-add' ? 'plan-feature-add' : 'plan-goals-change', text: visionUi.extra.trim() }, act === 'feature-add' ? 'Sent to your partner: it adds the feature, with a picture.' : 'Sent to your partner: it proposes a changed preset.')) visionUi.extra = ''
  } else if (act === 'send-confirms') {
    if (await toPartner({ command: 'plan-goals-confirm', text: view.goals.pending.join(', ') }, 'Your confirms went to your partner: it marks the goals confirmed.')) visionUi.confirms = []
  } else if (act === 'resend') {
    // A late or lost word without words of the person's in it, sent again as it was.
    const [command, about] = String(id).split('|')
    if (!['plan-deeper', 'plan-ask', 'plan-goals-agree', 'plan-settled', 'plan-measure', 'plan-standards', 'plan-standards-agree', 'plan-check', 'plan-focus'].includes(command)) return
    return toPartner(['plan-goals-agree', 'plan-standards', 'plan-standards-agree', 'plan-check', 'plan-focus'].includes(command) ? { command } : { command, id: about }, 'Sent again to your partner.')
  } else if (act === 'show-unsure') {
    // The first feature still not sure, brought into view and marked for a moment.
    const card = document.querySelector(`.vision-feature[data-feature="${CSS.escape(String(id))}"]`)
    if (card !== null) {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' })
      card.classList.add('is-flash')
      setTimeout(() => card.classList.remove('is-flash'), 1600)
    }
    return
  } else if (act === 'start-interview') {
    visionUi.words = ''
    visionUi.page = 'interview'
    visionUi.at = view.firstWaiting
  } else if (act === 'decide-words' && slide?.kind === 'decide') {
    // Your own words on a decision: a change of that item (a focus proposal: a new proposal from your words).
    const words = visionUi.words.trim()
    if (words === '') visionUi.note = { isProblem: true, text: 'Write your words in the box first.' }
    else {
      const body = slide.step === 'focus' ? { command: 'plan-focus', text: words } : { command: 'plan-change', id: slide.id, text: words }
      if (await toPartner(body, `${slide.title}: your words went to your partner.`)) {
        visionUi.words = ''
        visionUi.sent = [...visionUi.sent, slide.id]
      }
    }
  } else if (act === 'get-tradeoffs') {
    return toPartner({ command: 'plan-tradeoffs' }, 'Your partner weighs every complex feature later or not sure: prepare now, or wait, with the cost now and later.')
  } else if (act === 'tradeoff-now') {
    const [part, choice] = String(id).split(':')
    if (await toPartner({ command: 'plan-tradeoff', id: part, text: choice }, `${part}: ${choice === 'prepare' ? 'prepare now' : 'wait'}, sent to your partner.`)) {
      visionUi.sent = [...visionUi.sent, part]
    }
  } else if (act === 'check-plan') {
    return toPartner({ command: 'plan-check' }, 'Your partner looks at the whole plan again: what changes comes on step 4, each with its cause.')
  } else if (act === 'pick-strategy') {
    visionUi.strategy = visionUi.strategy === id ? null : id
  } else if (act === 'change-strategy' || act === 'keep-strategy') {
    visionUi.changingStrategy = act === 'change-strategy'
    visionUi.strategy = null
  } else if (act === 'lay-plan') {
    // Your pick, your words, or both ("Playable first: but the map editor early").
    const words = visionUi.extra.trim()
    const text = [visionUi.strategy, words].filter(one => one !== null && one !== '').join(': ')
    if (text === '') visionUi.note = { isProblem: true, text: 'Pick a strategy or write your own first.' }
    else if (await toPartner({ command: 'plan-strategy', text }, 'Your partner lays the plan in your strategy: it comes here.')) {
      visionUi.extra = ''
      visionUi.strategy = null
      visionUi.changingStrategy = false
    }
  } else if (act === 'only-changes') {
    visionUi.onlyChanges = !visionUi.onlyChanges
  } else if (act === 'not-now') {
    if (await toPartner({ command: 'plan-not-now', id }, `${id}: not now, sent to your partner.`)) {
      visionUi.notNow = [...visionUi.notNow, id]
      visionUi.confirms = visionUi.confirms.filter(one => one !== id)
    }
  } else if (act === 'show-goal') {
    const card = document.querySelector(`.vision-goal[data-goal-card="${CSS.escape(String(id))}"]`)
    if (card !== null) {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' })
      card.classList.add('is-flash')
      setTimeout(() => card.classList.remove('is-flash'), 1600)
    }
    return
  } else if (act === 'propose-focus') {
    if (await toPartner({ command: 'plan-focus', text: visionUi.extra.trim() }, 'Your partner proposes the next focus: it comes on step 5 with its why.')) visionUi.extra = ''
  } else if (act === 'focus-accept') {
    // Only your click makes a goal your focus; the partner then starts the talk about it on the Focus tab.
    if (await toPartner({ command: 'focus', id }, `${id} is your focus now: on the Focus tab your partner drafts its vibe and its how.`)) visionUi.sent = [...visionUi.sent, `focus:${id}`]
  } else if (['mark-now', 'confirm-standard-now', 'confirm-goal-now'].includes(act)) {
    // A decision of the Interview, sent at once; the slide says so and the next one comes.
    const [part, mark] = String(id).split(':')
    const body = act === 'mark-now' ? { command: 'plan-marks', text: `${part} ${mark}` } : act === 'confirm-standard-now' ? { command: 'plan-standards-confirm', text: part } : { command: 'plan-goals-confirm', text: part }
    if (await toPartner(body, `${part}: sent to your partner.`)) visionUi.sent = [...visionUi.sent, part]
  } else if (act === 'goals-agree') {
    return toPartner({ command: 'plan-goals-agree' }, 'Your partner puts the confirmed goals into your goal map: they show on the Focus tab\'s Goals part.')
  } else if (act === 'send-change' && slide?.kind === 'change') {
    if (visionUi.words.trim() === '') visionUi.note = { isProblem: true, text: 'Say what it should be, in your words.' }
    else if (await toPartner({ command: 'plan-change', id: slide.id, text: visionUi.words.trim() }, 'Sent to your partner: it rewrites it.')) {
      visionUi.page = pageOfPart(slide.id)
      visionUi.change = null
      visionUi.words = ''
    }
  } else if (act === 'ask-options' && slide?.kind === 'open') {
    if (await toPartner({ command: 'plan-ask', id: slide.id }, `Your partner prepares the options for ${slide.title}: they come here as a slide.`)) visionUi.asked = [...new Set([...visionUi.asked, slide.id])]
  } else if (act === 'send-open' && slide?.kind === 'open') {
    // Your own words for an open answer: the partner writes them as your decision, as a change does.
    if (visionUi.words.trim() === '') visionUi.note = { isProblem: true, text: 'Write your answer first.' }
    else if (await toPartner({ command: 'plan-change', id: slide.id, text: visionUi.words.trim() }, `Sent to your partner: it writes ${slide.title} as your decision.`)) visionUi.words = ''
  } else if ((act === 'answer' || act === 'dunno') && slide?.kind === 'ask') {
    const isOwn = act === 'answer' && slide.picked?.isOwn === true
    if (isOwn && visionUi.words.trim() === '') {
      visionUi.note = { isProblem: true, text: 'Write your answer in the box first.' }
      return redrawVision()
    }
    const label = act === 'dunno' ? "Don't know: take your advice for now"
      : isOwn ? `${slide.picked.key === '' ? '' : `${slide.picked.key}, `}in my own words: ${visionUi.words.trim()}` : slide.picked?.label ?? null
    if (label === null) return
    if (isOwn) visionUi.words = ''
    await visionSend('/api/work', { action: 'answer', id, text: label }, act === 'dunno' ? `${slide.id}: your partner takes its advice for now, marked assumed.` : `${slide.id}: answered. Your partner writes it into the plan.`)
    return
  }
  redrawVision()
}

/** The step a part of the plan belongs to, by its id: F a feature, S a goal of the preset, K a standard, else the vision. */
const pageOfPart = id => (/^F/.test(id) ? 'features' : /^S/.test(id) ? 'plan' : /^K/.test(id) ? 'standards' : 'vision')
const titleOfStandard = (view, id) => view.standards.cards.find(card => card.id === id)?.title.toLowerCase() ?? id

/** Back into the own-words box after the slide was drawn anew, the caret at its end. */
function visionRefocus() {
  const box = $('vision-change-words')
  if (box === null || box.disabled) return
  box.focus()
  box.setSelectionRange(box.value.length, box.value.length)
}

$('view-vision').addEventListener('click', event => {
  const button = event.target.closest('[data-vision-act]')
  if (button === null || button.disabled || event.target.closest('[data-zoom]') !== null) return
  // A click into the own-words box picks its card (never unpicks it), and the box keeps the caret.
  if (event.target.id === 'vision-change-words') {
    if (button.dataset.visionAct === 'pick' && button.getAttribute('aria-pressed') !== 'true') visionAct('pick', button.dataset.visionId).then(visionRefocus)
    return
  }
  visionAct(button.dataset.visionAct, button.dataset.visionId ?? null)
})
$('view-vision').addEventListener('input', event => {
  if (event.target.id === 'vision-change-words') visionUi.words = event.target.value
  else if (event.target.id === 'vision-extra-words') visionUi.extra = event.target.value
})
$('view-vision').addEventListener('keydown', event => {
  // The own-words card picks with Enter or Space, as a button does.
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('div.vision-option[data-vision-act]')) {
    event.preventDefault()
    return visionAct('pick', event.target.dataset.visionId)
  }
  if (visionUi.page !== 'interview' || event.target.tagName === 'TEXTAREA') return
  if (event.key === 'ArrowRight') visionAct('goto', String(visionUi.at + 1))
  else if (event.key === 'ArrowLeft') visionAct('goto', String(visionUi.at - 1))
})

/**
 * B360: the recaps of finished work gathered under the daily note (the setting botherMe "daily"), each with its
 * picture, Overturn and OK, seen (B390), as in Needs your attention.
 */
function focusRecapCard(state) {
  const card = el('section', 'focus-card focus-recaps')
  const recaps = gatheredRecaps(state)
  card.append(el('h3', '', `Finished: ${recaps.length}`), el('p', 'muted', 'Gathered here under your partner\'s note, not one by one in Needs your attention. Each approves itself 24 hours after it came, unless you overturn it or mark it seen.'))
  card.append(...recaps.map(recap => drawRecap(recap, state)))
  return card
}

/**
 * B361: the asks gathered under the daily note ("Bother me: once a day"), each as its card in Needs your attention:
 * its pictures, its options and its answer, answered here.
 */
function focusAsksCard(state) {
  const card = el('section', 'focus-card focus-asks')
  const asks = gatheredAsks(state)
  card.append(el('h3', '', `Questions that can wait: ${asks.filter(need => !isAnswered(need)).length}`), el('p', 'muted', `Gathered here under your partner's note, not one by one in Needs your attention ("Bother me: once a day" in ⚙). A question that holds up a chat still reaches you there at once.`))
  card.append(...asks.map(need => drawNeed(need, state)))
  return card
}

/** B360, B361: what the daily note gathers: the recaps of finished work and the asks that can wait. */
const gatheredCards = state => [gatheredRecaps(state).length > 0 ? focusRecapCard(state) : null, gatheredAsks(state).length > 0 ? focusAsksCard(state) : null].filter(card => card !== null)

/** Focus 3: every part done: "Is the vibe there?" with the agreed vibe, Yes, and No with a box for what is missing. */
function focusVibeThereCard(view, can) {
  const card = el('section', 'focus-card focus-there')
  card.append(el('h3', '', view.vibeThere.question))
  // B677: the goal demo before Yes and No: a big link (the picture window), or the line that the partner makes it first.
  const demo = view.vibeThere.demo
  if (demo.link !== null) {
    const see = el('button', 'focus-demo-link', demo.link.label)
    see.type = 'button'
    // B699: a demo.json opens the page the board draws; a picture opens the picture window as before.
    if (demo.link.isPage) see.dataset.demo = demo.link.path
    else see.dataset.zoom = demo.link.path
    see.dataset.caption = demo.link.caption
    card.append(see)
  } else {
    card.append(el('p', 'focus-demo-wait', demo.text))
    if (demo.again !== null) card.append(focusButton(demo.again, 'focus-ask-demo'))
  }
  const lines = el('ul', 'focus-ticks')
  for (const line of view.vibeThere.vibe) lines.append(el('li', '', line))
  const buttons = el('div', 'focus-buttons')
  view.vibeThere.buttons.forEach((one, index) => buttons.append(focusButton(one, index === 0 ? 'focus-yes' : 'focus-no')))
  // B354: the goal is ticked against its Done when: it stands under the vibe, or the button asks the partner for it.
  if (view.vibeThere.doneWhenLine !== null) lines.append(el('li', 'focus-done-when-line', view.vibeThere.doneWhenLine))
  if (view.vibeThere.doneWhen !== null) buttons.append(focusButton(view.vibeThere.doneWhen, 'focus-ask-done-when'))
  card.append(lines, buttons)
  if (focusUi.notYet === 'there') card.append(focusNotYet('there', can))
  return card
}

/** B358: the run's card of the goal's re-check: it runs, it found a gap, or it waits for the person. */
function focusRecheckCard(recheck) {
  const card = el('section', `focus-card focus-recheck is-${recheck.tone}`)
  // B533: its ids are links, and one that waits for the person opens what it waits for.
  card.append(el('h3', '', recheck.title), linkedEl('p', '', recheck.text), ...focusNeedsButton(recheck))
  return card
}

/** B359: the run's card of the goal guard. */
function focusGuardCard(guard) {
  const card = el('section', `focus-card focus-guard is-${guard.tone}`)
  card.append(el('h3', '', guard.title), linkedEl('p', '', guard.text), ...focusNeedsButton(guard))
  return card
}

/** B533: a run's card that waits for the person: the button to its question under Needs your attention. */
function focusNeedsButton(view) {
  if (view.needs === undefined) return []
  const open = el('button', 'quiet-button', view.needs.label)
  open.type = 'button'
  open.dataset.openNeeds = view.needs.ask ?? ''
  if (typeof view.needs.step === 'string') open.dataset.openStep = view.needs.step
  return [open]
}

/** Focus 1 (spec 2026-10-18, section 4): the Focus page, read-only from goals.md: the head, the strip, each stage's cards. */
function drawFocus(state) {
  const can = focusCan(state)
  const view = focusView(state.focus ?? null, state.goals ?? null, can, { picking: focusUi.picking, asked: focusUi.asked, partsOpen: focusUi.partsOpen })
  const box = $('advisor-focus')
  box.dataset.stage = view.stage
  const parts = []
  let recapsDrawn = false
  // Partner answers (2026-10-19): the switch, beside today's note in the run, else under everything else.
  const toggle = partnerSwitch(state)
  let switchDrawn = false
  if (view.head !== null) {
    const head = el('header', 'focus-head')
    const title = el('div', 'focus-title')
    title.append(el('small', 'focus-label', view.head.label), el('h2', '', `${view.head.id} · ${view.head.title}`))
    if (view.head.vibeLine !== null) title.append(el('p', 'focus-vibe-line', view.head.vibeLine))
    if (view.change !== null && view.back === undefined) title.append(focusButton({ ...view.change, act: 'change-focus' }, 'focus-change'))
    const side = el('div', 'focus-side')
    const strip = el('ol', 'focus-strip')
    for (const stage of view.strip) {
      const item = el('li', `focus-stage is-${stage.state}`)
      item.append(el('span', 'focus-n', String(stage.n)), el('span', '', stage.label))
      if (stage.state === 'done') item.append(el('span', 'focus-check', '✓'))
      strip.append(item)
    }
    side.append(strip)
    if (view.progress !== null) {
      const progress = el('div', 'focus-progress')
      const bar = el('div', 'focus-bar is-wide')
      const fillBar = el('span', '')
      fillBar.style.width = `${view.progress.percent}%`
      bar.append(fillBar)
      progress.append(el('small', '', view.progress.text), bar)
      side.append(progress)
    }
    head.append(title, side)
    parts.push(head)
  }
  if (view.stage === 'pick' || view.stage === 'done' || view.back !== undefined) parts.push(focusPickCard(view))
  else {
    const body = el('div', 'focus-body')
    if (view.stage === 'run') {
      const left = el('div', 'focus-column')
      left.append(focusRunCard(view), focusSay(view.talkBar.placeholder, 'focus-say is-slim', { box: 'focus-bar-words', act: view.talkBar.act, isEnabled: view.talkBar.isEnabled, title: view.talkBar.title }))
      const right = el('div', 'focus-column')
      if (view.guard !== null && view.guard !== undefined) right.append(focusGuardCard(view.guard))
      if (view.recheck !== null && view.recheck !== undefined) right.append(focusRecheckCard(view.recheck))
      if (view.vibeThere !== null) right.append(focusVibeThereCard(view, can))
      right.append(focusNoteCard(view))
      // B360, B361: with botherMe "daily" the recaps of finished work and the asks that can wait gather under the note.
      const gathered = gatheredCards(state)
      right.append(...gathered)
      recapsDrawn = gathered.length > 0
      if (toggle !== null) {
        right.append(toggle)
        switchDrawn = true
      }
      body.append(left, right)
    } else {
      const right = view.stage === 'vibe' ? focusVibeCard(view) : focusHowCard(view)
      const buttons = el('div', 'focus-buttons')
      view.buttons.forEach((one, index) => buttons.append(focusButton(one, index === 0 ? 'focus-yes' : 'focus-no')))
      right.append(buttons)
      if (focusUi.notYet === view.stage) right.append(focusNotYet(view.stage, can))
      body.append(focusTalkCard(state, can), right)
    }
    parts.push(body)
  }
  // B360: without a run on the page (or while the focus is being changed), the gathered recaps stand under it.
  if (!recapsDrawn) parts.push(...gatheredCards(state))
  if (toggle !== null && !switchDrawn) parts.push(toggle)
  if (focusUi.note !== null) parts.splice(view.head === null ? 0 : 1, 0, el('p', `focus-note${focusUi.note.isProblem ? ' is-error' : ''}`, focusUi.note.text))
  // The box typed in keeps its words, and the cursor where it was.
  const active = document.activeElement
  const typing = box.contains(active) && active.id in FOCUS_BOXES ? { id: active.id, at: active.selectionStart } : null
  // B360: and a recap's box, as in Needs your attention.
  const recapTyping = focusedNeed(box)
  fill(box, parts)
  refocus(box, recapTyping)
  // The talk shows its newest lines: the partner's open question stands at its end.
  const bubbles = box.querySelector('.focus-bubbles')
  if (bubbles !== null) bubbles.scrollTop = bubbles.scrollHeight
  const again = typing === null ? null : $(typing.id)
  if (again !== null && !again.disabled) {
    again.focus()
    again.setSelectionRange(typing.at, typing.at)
  }
}

/** Partner answers (2026-10-19): the switch drawn (partnerSwitchView), with the problem of its last change. */
function partnerSwitch(state) {
  const view = partnerSwitchView(state.partnerAnswers ?? null)
  if (view === null) return null
  const row = el('div', 'focus-partner-switch')
  row.title = view.title
  const label = el('label', '')
  const box = el('input', '')
  box.type = 'checkbox'
  box.checked = view.on
  box.disabled = !view.isEnabled || sending.has('partner-answers')
  box.dataset.partnerAnswers = 'switch'
  label.append(box, el('span', '', view.label), el('small', 'muted', view.on ? 'on: detail questions go to your partner first' : 'off: every question comes to you'))
  row.append(label)
  if (problems.has('partner-answers')) row.append(el('p', 'problem', problems.get('partner-answers')))
  return row
}

/** Focus 2: one move of the page (POST /api/goals); the line after it, and the state read anew. The board's answer, or null. */
async function sendFocus(body, done) {
  let result = null
  try {
    const answer = await fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify(body) })
    if (answer.ok) {
      result = await answer.json()
      focusUi.note = { isProblem: false, text: result.unchanged === true ? 'That was done already.' : done }
      showPaste(result.paste ?? null)
    } else focusUi.note = { isProblem: true, text: `Not done: ${(await answer.text()).trim() || `refused (${answer.status})`}` }
  } catch {
    focusUi.note = { isProblem: true, text: 'Not done: the board\'s server does not answer.' }
  }
  await read()
  return result
}

/**
 * Focus 2 (spec 2026-10-18, sections 3 and 6): a move on the Focus page. Pick a goal or something new; answer the
 * partner's open question in the talk (written into the thread, then `brainstorm answer` to the partner, as the
 * Brainstorm part does); "This is the goal definition", "Go", and "Not yet" with the person's words. The board writes goals.md and
 * types the word to the partner (src/focus.mjs); one move at a time.
 */
async function focusAct(act, goal = null, extra = null) {
  if (act === 'effort') return switchEffort()
  const focus = board?.focus ?? null
  if (focusUi.busy) return
  if (act === 'change-focus' || act === 'keep-focus') {
    if (act === 'change-focus') focusUi.picking = true
    else focusUi.picking = false
    focusUi.note = null
    return redrawFocus()
  }
  // B680: "Drop this part" opens the box for the reason under that part; a second click closes it.
  if (act === 'part-drop') {
    focusUi.dropping = focusUi.dropping === goal ? null : goal
    redrawFocus()
    return $('focus-drop-words')?.focus()
  }
  if (act === 'vibe-not-yet' || act === 'how-not-yet' || act === 'vibe-there-no') {
    const stage = act === 'vibe-not-yet' ? 'vibe' : act === 'how-not-yet' ? 'how' : 'there'
    focusUi.notYet = focusUi.notYet === stage ? null : stage
    redrawFocus()
    return $('focus-not-yet-words')?.focus()
  }
  const words = key => focusUi.words[key].trim()
  focusUi.busy = true
  focusUi.note = null
  redrawFocus()
  try {
    if (act === 'pick') {
      if (await sendFocus({ command: 'focus', id: goal }, 'Your partner is told: the talk about the vibe starts on the left.') !== null) focusUi.picking = false
    } else if (act === 'restart-talk' && focus !== null) await sendFocus({ command: 'focus', id: focus.id }, 'The talk starts again: your partner is told.')
    else if (act === 'new') {
      if (words('new') === '') focusUi.note = { isProblem: true, text: 'Write what you want to work on.' }
      else {
        const result = await sendFocus({ command: 'focus', text: words('new') }, 'A new goal, your focus now: your partner starts the talk about its vibe.')
        if (result !== null) focusUi.words.new = ''
        // B354: a new goal has no Done when yet: it waits in the map while the partner writes one, then the person picks it.
        if (result?.isFocus === false) {
          focusUi.asked = [...new Set([...focusUi.asked, result.id])]
          focusUi.note = { isProblem: false, text: `${result.id} is in your goal map. Your partner writes its Done when: pick it here once it stands.` }
        } else if (result !== null) focusUi.picking = false
      }
    } else if (act === 'done-when') {
      // B354: the partner is asked to write the goal's Done when (a row of the pick list, or the focus itself).
      const id = goal ?? focus?.id ?? null
      if (id !== null && await sendFocus({ command: 'done-when', id: goal ?? focus?.id }, 'Your partner is asked to write its Done when.') !== null) focusUi.asked = [...new Set([...focusUi.asked, id])]
    } else if (act === 'goal-demo' && focus !== null) await sendFocus({ command: 'goal-demo', id: focus.id }, 'Your partner is asked for the goal demo.')
    else if (act === 'vibe-agree' && focus !== null) await sendFocus({ command: 'vibe-agree', id: focus.id }, 'Agreed. Your partner proposes the how next.')
    else if (act === 'how-go' && focus !== null) await sendFocus({ command: 'how-go', id: focus.id }, 'Go: your partner makes the steps, and the main chat hands them out.')
    else if (act === 'send-not-yet' && focus !== null && focusUi.notYet !== null) {
      if (words('notYet') === '') focusUi.note = { isProblem: true, text: 'Say what is missing, in your words.' }
      else if (focusUi.notYet === 'there') {
        // Focus 3: the vibe is not there yet: the how opens again, with the person's words.
        if (await sendFocus({ command: 'vibe-there-no', id: focus.id, text: words('notYet') }, 'Sent to your partner: it proposes a changed how.') !== null) {
          focusUi.words.notYet = ''
          focusUi.notYet = null
        }
      } else if (await sendFocus({ command: focusUi.notYet === 'vibe' ? 'vibe-not-yet' : 'how-not-yet', id: focus.id, text: words('notYet') }, 'Sent to your partner: the talk goes on.') !== null) {
        focusUi.words.notYet = ''
        focusUi.notYet = null
      }
    } else if (act === 'part-drop-send' && focus !== null && focusUi.dropping !== null) {
      if (words('drop') === '') focusUi.note = { isProblem: true, text: 'Say why you drop it, in one line.' }
      else if (await sendFocus({ command: 'part-drop', id: focus.id, part: focusUi.dropping, text: words('drop') }, 'The part is dropped: it counts out of the whole. Undo takes it back.') !== null) {
        focusUi.words.drop = ''
        focusUi.dropping = null
      }
    // B692: Undo takes back that part's own drop line, in any order (not the goal map's snapshot undo).
    } else if (act === 'part-undo' && focus !== null) await sendFocus({ command: 'part-undrop', id: focus.id, part: goal ?? '' }, 'Taken back: the part is Stopped again.')
    else if (act === 'talk' && focus !== null) await focusAnswer(focus)
    // Focus 4: the run's talk bar: the words into the goal's talk (started or reused), typed to the partner as yours.
    else if (act === 'talk-bar' && focus !== null) {
      if (words('bar') === '') focusUi.note = { isProblem: true, text: 'Write what you want to tell your partner.' }
      else if (await sendFocus({ command: 'talk', id: focus.id, text: words('bar') }, 'Sent to your partner, in the talk about this goal.') !== null) focusUi.words.bar = ''
    }
    // Focus 3: the run's moves: the vibe is there; Undo of a decided line; an answer to the partner's question.
    else if (act === 'vibe-there-yes' && focus !== null) await sendFocus({ command: 'vibe-there-yes', id: focus.id }, 'Your partner re-checks it against its Done when and its vibe: it gets its tick once that passed.')
    // Partner answers, the review's findings: a partner's answer is taken back, and the line says so (by the line's field).
    else if (act === 'undo' && focus !== null && extra !== null) await sendFocus({ command: 'note-undo', id: focus.id, note: extra.note, line: extra.line }, extra.ask ? 'Taken back: the question comes to you under Needs your attention, and its chat waits for your answer.' : 'Your partner is asked to undo it.')
    else if (act === 'answer' && extra !== null) await focusAnswerAsk(extra.id, extra.label)
  } finally {
    focusUi.busy = false
    redrawFocus()
  }
}

/** Focus 3: an option of the partner's question under "Needs you", answered in the store; the board wakes the partner. */
async function focusAnswerAsk(id, label) {
  try {
    const answer = await fetch('/api/work', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify({ action: 'answer', id, text: label }) })
    if (answer.ok) {
      focusUi.note = { isProblem: false, text: `Answered: ${label}. Your partner is told.` }
      showPaste((await answer.json().catch(() => null))?.paste ?? null)
    } else focusUi.note = { isProblem: true, text: `Not answered: ${(await answer.text()).trim() || `refused (${answer.status})`}` }
  } catch {
    focusUi.note = { isProblem: true, text: 'Not answered: the board\'s server does not answer.' }
  }
  await read()
}

/** The person's answer to the partner's open question: written under it in the thread, then typed to the partner. */
async function focusAnswer(focus) {
  const thread = (board?.brainstorms?.threads ?? []).find(one => one.path === focus.thread) ?? null
  const ask = focusAsk(thread, board?.advisor ?? null, mainChatOf(board))
  const words = focusUi.words.talk.trim()
  const picked = focusUi.picked !== null && ask.question?.options.some(one => one.key === focusUi.picked) ? focusUi.picked : null
  if (ask.question === null) return
  if (picked === null && words === '') {
    focusUi.note = { isProblem: true, text: 'Pick an option or write your words.' }
    return
  }
  const answer = picked !== null ? { key: picked, words } : { key: 'Other', words }
  const path = thread.path
  const n = ask.question.n
  try {
    const written = await fetch('/api/brainstorm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN }, body: JSON.stringify({ command: 'answer', path, n, ...answer }) })
    if (!written.ok) {
      focusUi.note = { isProblem: true, text: `Not sent: ${(await written.text()).trim() || `refused (${written.status})`}` }
      return await read()
    }
  } catch {
    focusUi.note = { isProblem: true, text: 'Not sent: the board\'s server does not answer.' }
    return
  }
  focusUi.words.talk = ''
  focusUi.picked = null
  const key = `focus:${path}:${n}`
  await send({ to: board?.advisor?.name ?? null, command: 'brainstorm-answer', thread: path, n }, key)
  if (problems.has(key)) {
    focusUi.note = { isProblem: true, text: `${problems.get(key).replace(/\.?$/, '.')} Your answer stands in the thread: answer again on the Brainstorm part to type it once more.` }
    problems.delete(key)
  }
}

$('advisor-focus').addEventListener('click', event => {
  const option = event.target.closest('[data-focus-option]')
  if (option !== null && !option.disabled) {
    focusUi.picked = focusUi.picked === option.dataset.focusOption ? null : option.dataset.focusOption
    redrawFocus()
    return $('focus-talk-words')?.focus()
  }
  const act = event.target.closest('[data-focus-act]')
  if (act !== null && !act.disabled) focusAct(act.dataset.focusAct, act.dataset.focusGoal ?? null)
  // Focus 3: Undo of a line of the partner's note; an option of its question.
  const undo = event.target.closest('[data-focus-undo]')
  if (undo !== null && !undo.disabled) focusAct('undo', null, { note: undo.dataset.focusNote, line: undo.dataset.focusUndo, ask: undo.dataset.focusAsk ?? null })
  const answer = event.target.closest('[data-focus-answer]')
  if (answer !== null && !answer.disabled) focusAct('answer', null, { id: answer.dataset.focusAnswer, label: answer.dataset.focusLabel })
})
// Partner answers (2026-10-19): the switch kept in the store, as the person's change.
$('advisor-focus').addEventListener('change', event => {
  if (event.target.dataset?.partnerAnswers === 'switch') sendWork({ action: 'partner-answers', on: event.target.checked }, 'partner-answers')
})
// The words typed stay while the page is drawn anew; Enter sends a box's words, Shift+Enter makes a new line.
$('advisor-focus').addEventListener('input', event => {
  const key = FOCUS_BOXES[event.target.id]
  if (key !== undefined) focusUi.words[key] = event.target.value
})
$('advisor-focus').addEventListener('keydown', event => {
  const form = event.target.closest('[data-focus-form]')
  if (form === null || event.key !== 'Enter' || event.shiftKey || event.target.tagName !== 'TEXTAREA') return
  event.preventDefault()
  focusAct(form.dataset.focusForm)
})
$('advisor-focus').addEventListener('submit', event => {
  event.preventDefault()
  const form = event.target.closest('[data-focus-form]')
  if (form !== null) focusAct(form.dataset.focusForm)
})

// B684: a part's toggle opens or closes its steps; the person's word stays while the page redraws.
$('advisor-focus').addEventListener('click', event => {
  const toggle = event.target.closest('[data-focus-part]')
  if (toggle === null) return
  focusUi.partsOpen = { ...focusUi.partsOpen, [toggle.dataset.focusPart]: toggle.getAttribute('aria-expanded') !== 'true' }
  redrawFocus()
})

// Focus 1: "See the steps behind this" opens the Backlog on the steps behind the focus goal.
$('advisor-focus').addEventListener('click', event => {
  const button = event.target.closest('[data-focus-steps]')
  if (button === null || board === null) return
  coordinateGoal = { id: button.dataset.focusSteps, steps: goalStepIds(board.goals ?? null, button.dataset.focusSteps) }
  show('coordinate')
  drawCoordinate(board)
})

// B195: the way to the next milestone, as the Advisor maps it (src/milestone.mjs): a row of steps, the one picked
// with its items under it, and the Advisor's recommendation answered with a click.
const WAY_STATES = { done: '✓ Done', part: 'Part done', none: 'Not started' }
let wayPicked = null
let wayNoOpen = false
let wayReason = ''

// B288: the person asks the Advisor for a round now, from the Next milestone part; off while a round runs.
/** The button "Re-check the goals now" with why it was refused under it, or null without an Advisor. */
function recheckPart(state) {
  if ((state.advisor?.name ?? null) === null) return null
  const runs = state.advisor.roundRuns === true
  const button = el('button', `way-recheck${problems.has('recheck') ? ' is-error' : ''}`, sending.has('recheck') ? 'Asking…' : runs ? 'A round runs' : 'Re-check the goals now')
  button.type = 'button'
  button.dataset.recheck = 'yes'
  button.disabled = runs || sending.has('recheck')
  button.title = runs ? 'The Advisor works on a round now: it brings the goals up to date.' : 'Ask the Advisor for a round now: it brings the way to the next milestone and the goal map up to date.'
  const part = el('div', 'way-recheck-line')
  part.append(button)
  if (problems.has('recheck')) part.append(el('p', 'problem', problems.get('recheck')))
  return part
}
// recheck:end

function drawWay(state) {
  const box = $('advisor-way')
  const way = state.milestone ?? null
  const recheck = recheckPart(state)
  if (way === null) {
    // B260: the way is the goal map's first milestone of the game plan that is not done.
    return fill(box, [el('h2', '', 'The way to the next milestone'), el('p', 'muted', `No milestone to go to yet. The Advisor marks the game plan's milestones in the goal map (${state.goalsFile ?? '.claude/goals.md'}) at its next round.`), ...(recheck === null ? [] : [recheck])])
  }
  const { milestone, nodes, totals } = way
  const head = el('div', 'way-head')
  const named = el('div')
  named.append(el('small', 'way-kicker', milestone.name === '' ? 'Next milestone' : `Next milestone · ${milestone.name}`), el('h2', '', milestone.title))
  if (milestone.doneWhen !== '') named.append(el('p', 'muted', `Done when: ${milestone.doneWhen}`))
  // B260: a milestone of the plan without sub-goals in the goal map yet has no way to draw.
  if (recheck !== null) named.append(recheck)
  if (way.isMapped === false) {
    head.append(named)
    return fill(box, [head, el('p', 'muted', `Its way is not mapped yet: the Advisor adds its tasks as sub-goals in the goal map (${state.goalsFile ?? '.claude/goals.md'}) at its next round.`), ...recommendationPart(way.recommendation ?? null, state)])
  }
  const total = el('div', 'way-total')
  total.append(el('b', '', `${totals.left} to go`), el('span', 'muted', `${totals.done} done · ${totals.open} on the backlog · ${totals.missing} not on it yet`))
  head.append(named, total)
  const all = totals.done + totals.open + totals.missing
  const bar = el('div', 'way-bar')
  bar.setAttribute('aria-hidden', 'true')
  for (const [key, count] of [['done', totals.done], ['open', totals.open], ['missing', totals.missing]]) {
    const part = el('i', `is-${key}`)
    part.style.width = `${all === 0 ? 0 : (100 * count) / all}%`
    bar.append(part)
  }
  // Under the row: the step picked, else the first that is not done.
  const picked = Math.min(wayPicked ?? Math.max(0, nodes.findIndex(node => node.state !== 'done')), nodes.length - 1)
  const flow = el('ol', 'way-flow')
  nodes.forEach((node, index) => {
    const item = el('li', `way-node is-${node.isGoal ? 'goal' : node.state}`)
    const button = el('button', 'way-step')
    button.type = 'button'
    button.dataset.wayNode = String(index)
    button.setAttribute('aria-pressed', String(index === picked))
    const counts = el('span', 'way-counts')
    if (node.done > 0) counts.append(el('span', 'way-count is-done', `${node.done} done`))
    if (node.open > 0) counts.append(el('span', 'way-count is-open', `${node.open} open`))
    if (node.missing.length > 0) counts.append(el('span', 'way-count is-missing', `${node.missing.length} missing`))
    const left = el('span', 'way-left')
    left.append(el('b', '', String(node.left)), ' to go')
    button.append(el('span', 'way-state', node.isGoal ? '⚑ Milestone' : WAY_STATES[node.state]), el('span', 'way-title', node.title), counts, left)
    item.append(button)
    flow.append(item)
  })
  const legend = el('p', 'way-legend muted', 'Open: on the backlog. Missing: not on the backlog yet. Click a step to see its items.')
  const node = nodes[picked]
  const details = el('div', 'way-details')
  const list = el('ul')
  const line = (tag, kind, words) => {
    const li = el('li')
    li.append(el('span', `way-tag is-${kind}`, tag), el('span', '', words))
    list.append(li)
  }
  for (const item of node.items.filter(one => !one.isDone)) line(`${item.id} open`, 'open', item.title)
  for (const missing of node.missing) line('missing', 'missing', missing)
  const done = node.items.filter(one => one.isDone)
  if (done.length > 0) line(`${done.length} done`, 'done', done.map(one => one.id).join(', '))
  if (list.children.length === 0) list.append(el('li', 'muted', 'Nothing is listed for this step yet.'))
  details.append(el('h3', '', node.title), list)
  const active = document.activeElement
  const onStep = box.contains(active) ? active?.dataset?.wayNode ?? null : null
  const inReason = active?.id === 'way-reason' ? [active.selectionStart, active.selectionEnd] : null
  fill(box, [head, bar, flow, legend, details, ...recommendationPart(way.recommendation ?? null, state)])
  if (onStep !== null) box.querySelector(`[data-way-node="${onStep}"]`)?.focus()
  const reason = inReason === null ? null : $('way-reason')
  if (reason !== null) {
    reason.focus()
    reason.setSelectionRange(...inReason)
  }
}

/**
 * B195: the Advisor's recommendation under the way: yes goes to the main chat, no with a reason to the Advisor. Since
 * 2026-10-28 a board that writes the store carries a yes out itself: the step is on the backlog at once.
 */
function recommendationPart(rec, state) {
  if (rec === null) return []
  const main = state.workers?.mainTitle ?? state.workers?.main ?? 'the main chat'
  const box = el('section', 'way-rec')
  box.setAttribute('aria-label', 'The Advisor recommends next')
  const words = el('div')
  words.append(el('small', 'way-kicker', 'The Advisor recommends next'), el('h3', '', rec.title))
  const why = [rec.why, rec.cost].filter(Boolean).join(' ')
  if (why !== '') words.append(el('p', 'muted', why))
  box.append(words)
  const answer = rec.answer ?? null
  if (answer !== null) {
    const sent = answer.state === 'delivered' ? '' : ' (on its way)'
    box.append(el('p', 'way-answered', answer.answer === 'yes' && answer.byBoard === true
      ? `You said yes at ${clock(answer.at)}: it is on the backlog as ${answer.step}; the board hands it out as any task.`
      : answer.answer === 'yes'
      ? `You said yes at ${clock(answer.at)}${sent}: ${main} puts it on the backlog when it is not there and hands it out.`
      : `You said no at ${clock(answer.at)}${sent}: the Advisor proposes another task at its next round.`))
    return [box]
  }
  const canYes = state.goalsEdit?.canWrite === true || (state.workers?.main ?? null) !== null
  const canNo = (state.advisor?.name ?? null) !== null
  const buttons = el('div', 'way-buttons')
  const button = (what, words, kind) => {
    const one = el('button', kind, words)
    one.type = 'button'
    one.dataset.recommend = what
    one.disabled = sending.has('recommend')
    buttons.append(one)
  }
  if (canYes) button('yes', 'Yes, queue it', 'is-yes')
  if (canNo && !wayNoOpen) button('no-open', 'No…', 'is-no')
  box.append(buttons)
  if (canNo && wayNoOpen) {
    const form = el('div', 'way-reason')
    const reason = el('textarea')
    reason.id = 'way-reason'
    reason.maxLength = 1000
    reason.placeholder = 'Why not? The Advisor reads it and proposes another step.'
    reason.setAttribute('aria-label', 'Why not')
    reason.value = wayReason
    form.append(reason)
    const send = el('button', 'is-no', 'Send no')
    send.type = 'button'
    send.dataset.recommend = 'no'
    send.disabled = sending.has('recommend')
    const cancel = el('button', '', 'Cancel')
    cancel.type = 'button'
    cancel.dataset.recommend = 'cancel'
    const both = el('div', 'way-buttons')
    both.append(send, cancel)
    form.append(both)
    box.append(form)
  }
  if (problems.has('recommend')) box.append(el('p', 'problem', problems.get('recommend')))
  box.append(el('p', 'way-where muted', `Yes: ${main} puts it on the backlog when it is not there and hands it out. No: you say why, and the Advisor proposes another task at its next round.`))
  return [box]
}

// B288: the re-check of the goals, asked of the Advisor.
$('advisor-way').addEventListener('click', event => {
  const button = event.target.closest('[data-recheck]')
  if (button === null || button.disabled) return
  const advisor = board?.advisor?.name ?? null
  if (advisor === null) return
  // Off at once, so a second click sends nothing; the next redraw shows how it stands.
  button.disabled = true
  button.textContent = 'Asking…'
  send({ to: advisor, command: 'recheck' }, 'recheck')
})
$('advisor-way').addEventListener('click', event => {
  if (board === null) return
  const step = event.target.closest('[data-way-node]')
  if (step !== null) {
    wayPicked = Number(step.dataset.wayNode)
    drawWay(board)
    $('advisor-way').querySelector(`[data-way-node="${wayPicked}"]`)?.focus()
    return
  }
  const button = event.target.closest('[data-recommend]')
  const rec = board.milestone?.recommendation ?? null
  if (button === null || rec === null) return
  const what = button.dataset.recommend
  if (what === 'no-open' || what === 'cancel') {
    wayNoOpen = what === 'no-open'
    problems.delete('recommend')
    drawWay(board)
    if (wayNoOpen) $('way-reason')?.focus()
    return
  }
  if (what === 'yes') {
    button.disabled = true
    send({ to: board.workers?.main ?? null, command: 'recommend', about: rec.id, answer: 'yes' }, 'recommend')
    return
  }
  if (what === 'no') {
    if (wayReason.trim() === '') {
      problems.set('recommend', 'Say why, so the Advisor can propose another step.')
      return drawWay(board)
    }
    button.disabled = true
    send({ to: board.advisor.name, command: 'recommend', about: rec.id, answer: 'no', reason: wayReason.trim() }, 'recommend').then(() => {
      if (problems.has('recommend')) return
      wayNoOpen = false
      wayReason = ''
    })
  }
})
$('advisor-way').addEventListener('input', event => {
  if (event.target.id === 'way-reason') wayReason = event.target.value
})

// B218: the game plan as the page draws it, its links working and its headings folding. The person, 2026-10-14:
// "advisor game plan has links that dont work i want to be able to click them in the UI", and "adding collapsing
// headers so this page feel more manageable". Kept between these two marks so a test can run it.
// planlinks:start
/**
 * Where a link in a file of the game's folder points (`from` is that file's own path, as "docs/game-plan.md"): a
 * web page `{ web }`, or a path inside the game's folder `{ path, alt, isPicture }`, `alt` being the same link read
 * from the project's folder (a plan may be written that way), or null; null when it leads out of the folder or is no
 * path at all (an anchor, a drive, a root).
 */
function planTarget(from, href) {
  if (/^https?:\/\//i.test(href)) return { web: href }
  const bare = href.replace(/[?#].*$/, '')
  if (bare === '' || /^[a-z][\w+.-]*:/i.test(bare) || bare.startsWith('/') || bare.includes('\\')) return null
  let words
  try {
    words = decodeURIComponent(bare)
  } catch {
    return null
  }
  const walk = start => {
    const parts = [...start]
    for (const part of words.split('/')) {
      if (part === '' || part === '.') continue
      if (part !== '..') parts.push(part)
      else if (parts.length === 0) return null
      else parts.pop()
    }
    return parts.length === 0 ? null : parts.join('/')
  }
  const path = walk(from.split('/').slice(0, -1))
  return path === null ? null : { path, alt: walk([]), isPicture: /\.(?:png|jpe?g|webp|gif)$/i.test(path) }
}
// planlinks:end

/** A link's words as the plan draws them: a web page opens in a new tab, a file of the game in a window here. */
const planLinker = from => (words, href) => {
  const target = planTarget(from, href)
  if (target === null) {
    const plain = el('span', 'linked', words)
    plain.title = `${href} (not a file of the game's folder)`
    return plain
  }
  if (target.web !== undefined) {
    const link = el('a', 'plan-link', words)
    link.href = target.web
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    return link
  }
  const button = el('button', 'plan-link', words)
  button.type = 'button'
  button.dataset.gameFile = target.path
  if (target.alt !== null) button.dataset.projectFile = target.alt
  button.title = `Open ${target.alt ?? target.path}`
  return button
}

/** The parts of the plan the person unfolded, by their headings: a redraw keeps them open. */
const planOpen = new Set()

/**
 * The text of a file of the game's folder as nodes: headings, paragraphs, lists and tables, its links working
 * (`from` is its own path). With `fold`, every heading folds what stands under it, folded at first with its first
 * line beside it, so the whole plan fits on a screen.
 */
function gameFileNodes(text, from, fold) {
  const linker = planLinker(from)
  const top = []
  const stack = []
  const add = node => (stack.length === 0 ? top.push(node) : stack.at(-1).box.append(node))
  // A folded part shows the first line under its heading.
  const firstLine = words => {
    const part = stack.at(-1)
    if (part === undefined || part.hasLine) return
    part.hasLine = true
    const plain = words.replace(/\*\*|`/g, '').replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    part.summary.append(el('small', 'plan-line', plain.length > 140 ? `${plain.slice(0, 137)}…` : plain))
  }
  let list = null
  let item = null
  let paragraph = null
  const flush = () => {
    if (paragraph !== null) {
      firstLine(paragraph)
      add(marked('p', '', paragraph, linker))
    }
    paragraph = null
  }
  const take = (line, index) => {
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    if (line.trim() === '') {
      flush()
      list = null
      item = null
    } else if (heading !== null) {
      flush()
      list = null
      item = null
      const level = heading[1].length
      // The panel or the window has the title already.
      if (index === 0 && level === 1) return
      if (!fold) return add(marked(level <= 2 ? 'h3' : 'h4', '', heading[2], linker))
      while (stack.length > 0 && stack.at(-1).level >= level) stack.pop()
      const key = [...stack.map(part => part.title), heading[2]].join(' / ')
      const box = el('details', `plan-part is-level-${Math.min(level, 4)}`)
      box.open = planOpen.has(key)
      box.dataset.planPart = key
      const summary = el('summary')
      // A click on the heading folds: its words are not links.
      summary.append(marked(level <= 2 ? 'h3' : 'h4', '', heading[2].replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')))
      box.append(summary)
      add(box)
      stack.push({ level, box, summary, hasLine: false, title: heading[2] })
    } else if (bullet !== null || numbered !== null) {
      flush()
      const kind = bullet !== null ? 'ul' : 'ol'
      if (list === null || list.localName !== kind) {
        list = el(kind)
        if (numbered !== null) list.start = Number(numbered[1])
        add(list)
      }
      item = { text: (bullet ?? numbered).at(-1), node: null }
      item.node = marked('li', '', item.text, linker)
      list.append(item.node)
      firstLine(item.text)
    } else if (item !== null && /^\s+\S/.test(line)) {
      // An indented line goes on with the list item above it.
      item.text = `${item.text} ${line.trim()}`
      const again = marked('li', '', item.text, linker)
      item.node.replaceWith(again)
      item.node = again
    } else {
      list = null
      item = null
      paragraph = paragraph === null ? line.trim() : `${paragraph} ${line.trim()}`
    }
  }
  let index = 0
  for (const part of partsOf(text)) {
    if (part.table === undefined) {
      for (const line of part.text.split('\n')) take(line, index++)
      continue
    }
    flush()
    list = null
    item = null
    index += 1
    add(drawTable(part.table, linker))
  }
  flush()
  return top
}

function drawAdvice(state) {
  const box = $('advice-text')
  if (state.advice === null) return fill(box, [el('p', 'muted', `No game plan yet. The Advisor writes it with you, as ${state.gamePlan ?? 'the game plan'} in the game's repository.`)])
  fill(box, gameFileNodes(state.advice, state.gamePlan ?? '', true))
}
// The toggle of a part does not bubble: it is heard on its way down.
$('advice-text').addEventListener('toggle', event => {
  const part = event.target
  if (!(part instanceof HTMLElement) || part.dataset.planPart === undefined) return
  if (part.open) planOpen.add(part.dataset.planPart)
  else planOpen.delete(part.dataset.planPart)
}, true)

/** B218: a file of the game's folder, read-only, in a window of its own; a picture in the picture popup. */
async function openGameFile(path, alt = null) {
  const query = `path=${encodeURIComponent(path)}${alt === null ? '' : `&alt=${encodeURIComponent(alt)}`}`
  const answer = await fetch(`/api/game-file?${query}`, { headers: { 'X-Board-Token': TOKEN } }).catch(() => null)
  // Where the board found it: in the game's folder, or from the project's.
  const shown = answer?.headers.get('X-Board-File') || alt || path
  const box = $('file-view')
  const head = el('header', 'file-view-head')
  const close = el('button', 'icon-button', '✕')
  close.type = 'button'
  close.dataset.closeFile = ''
  close.setAttribute('aria-label', 'Close')
  head.append(el('h2', '', shown), close)
  if (answer !== null && answer.ok && (answer.headers.get('Content-Type') ?? '').startsWith('image/')) {
    showPicture(URL.createObjectURL(await answer.blob()), shown)
    return
  }
  const body = el('div', 'file-view-body advice')
  if (answer === null) body.append(el('p', 'problem', 'The board\'s server does not answer.'))
  else if (!answer.ok) body.append(el('p', 'problem', (await answer.text()).trim() || 'This file is not shown.'))
  // Its own links are read from where it was found.
  else if (/\.md$/i.test(path)) body.append(...gameFileNodes(await answer.text(), answer.headers.get('X-Board-File') || path, false))
  else body.append(el('pre', '', await answer.text()))
  fill(box, [head, body])
  if (!box.open) box.showModal()
}
document.addEventListener('click', event => {
  const link = event.target.closest('[data-game-file]')
  if (link !== null) return openGameFile(link.dataset.gameFile, link.dataset.projectFile ?? null)
  if (event.target === $('file-view') || event.target.closest('[data-close-file]') !== null) $('file-view').close()
})

/** B397: an ask's words as nodes, its ids and the pages it names working as links. */
function linkedWords(text, state) {
  const needs = state === null ? [] : everyNeed(state)
  const steps = new Set((state?.backlog ?? []).flatMap(activity => activity.steps).map(step => step.key))
  const goals = new Set(state?.goalIds ?? (state?.goals?.nodes ?? []).map(node => node.id))
  const known = { isAsk: id => needs.some(one => one.workId === id), isStep: id => steps.has(id), isGoal: id => goals.has(id) }
  return askLinkPieces(text, known).map(piece => {
    if (typeof piece === 'string') return piece
    const link = el('button', 'ask-link', piece.place === undefined ? piece.ask ?? piece.step ?? piece.path : piece.words)
    link.type = 'button'
    if (piece.place !== undefined) {
      // B507: a place on this board (a goal, a tab, a part of the Focus tab): a click goes there and closes the popup.
      link.dataset.place = piece.place
      link.title = piece.label
    } else if (piece.path !== undefined) {
      // A page of the game's folder, else of the project's: read-only in a window, a picture in the picture popup
      // (B426: wherever it stands in the project, not only in the picture folders).
      link.dataset.gameFile = piece.path
      link.dataset.projectFile = piece.path
      link.title = `Open ${piece.path}`
    } else {
      link.dataset.askLink = piece.ask ?? piece.step
      link.title = piece.ask !== undefined ? `Open the ask ${piece.ask}` : `Open the step ${piece.step}`
    }
    return link
  })
}

/** B426: a node of `tag` holding text whose ids and pages are links (linkedWords, with the board as it is now). */
function linkedEl(tag, className, text) {
  const node = el(tag, className)
  node.append(...linkedWords(text, board))
  return node
}

/** B397: the ask an ask points to, inline: its question, its words and its options, so one window holds it all. */
function pointedAskBox(need, state) {
  const other = state === null ? null : pointedAsk(need, everyNeed(state))
  if (other === null) return []
  const box = el('div', 'pointed-ask')
  const head = el('p', 'pointed-ask-head')
  const open = el('button', 'ask-link', other.workId)
  open.type = 'button'
  open.dataset.askLink = other.workId
  open.title = `Open the ask ${other.workId}`
  head.append(open, ` ${other.from === null || other.from === undefined ? '' : `from ${other.from}, `}which this one points to:`)
  box.append(head, el('p', 'pointed-ask-question', other.question ?? other.title))
  if (other.text !== '' && other.text !== undefined) {
    const words = el('p', 'pointed-ask-text')
    words.append(...linkedWords(other.text, state))
    box.append(words)
  }
  const options = other.options ?? []
  if (options.length > 0) {
    const list = el('ul', 'pointed-ask-options')
    for (const option of options) list.append(el('li', '', `${option.label}${option.isRecommended ? ' (recommended)' : ''}`))
    box.append(list)
  }
  return [box]
}

document.addEventListener('click', event => {
  // B426: a page link in a card's title opens the page, not the card's window as well
  const page = event.target.closest('.ask-link[data-game-file]')
  if (page !== null) {
    event.stopPropagation()
    return openGameFile(page.dataset.gameFile, page.dataset.projectFile ?? null)
  }
  const place = event.target.closest('[data-place]')
  if (place !== null) {
    event.stopPropagation()
    return goToPlace(place.dataset.place)
  }
  const link = event.target.closest('[data-ask-link]')
  if (link === null || board === null) return
  event.stopPropagation()
  const id = link.dataset.askLink
  const need = everyNeed(board).find(one => one.workId === id)
  if (need === undefined && (board.withPartner ?? []).some(one => one.id === id)) return openDetails({ partnerAsk: id })
  openDetails(need !== undefined ? { need: need.id } : { step: id })
}, true)

// The chat with the advisor

function drawMessage({ key, kind, time, who, text, picture: shown = null, note = null }) {
  const row = el('div', `message ${kind}`)
  const bubble = el('div', 'bubble')
  if (text.length > LONG_CHARS || text.split('\n').length > 12) {
    bubble.classList.add('is-long')
    bubble.dataset.key = key
    if (openBubbles.has(key)) bubble.classList.add('is-open')
  }
  rich(bubble, text)
  // B282: a picture pasted with it, small; a click opens it large.
  if (shown !== null) {
    const frame = picture(shown)
    frame.classList.add('talk-picture')
    bubble.append(frame)
  }
  if (note !== null) bubble.append(el('small', '', note))
  row.append(el('time', '', time), el('span', 'speaker', who), bubble)
  return row
}

// advisorrefine:start
/**
 * B287: the Advisor's refine state, from the backlog's steps: the step it refines now (asked and not written yet), else
 * (B312) a step the board stopped refining after its rounds without new answers (`canSend`: the card offers to send one
 * round more), else a step whose answers are all in and wait for it to fold them in; null when none. `{ step, text, tone }`.
 */
function advisorRefine(backlog) {
  const steps = (backlog ?? []).flatMap(activity => activity.steps ?? [])
  // The one it has in hand first, else one on its way.
  const asks = steps.filter(step => step.refineAsk?.isOpen === true)
  const asked = asks.find(step => step.refineAsk.state === 'delivered') ?? asks[0]
  if (asked !== undefined) {
    const round = asked.refineAsk.round ?? 1
    const text = asked.refineAsk.state === 'delivered' ? `Refining ${asked.id}${round > 1 ? `, round ${round}` : ''}` : `${asked.id} to refine, on its way`
    return { step: asked.id, text, tone: 'working' }
  }
  // Answers folded in only for a step not taken up yet (open or queued), as the board's own refining does (B285).
  const isUp = step => step.status === 'open' || step.status === 'queued'
  const stopped = steps.find(step => step.refineState === 'stopped' && isUp(step))
  if (stopped !== undefined) {
    const rounds = stopped.refineStop?.rounds ?? 3
    return { step: stopped.id, text: `Refine of ${stopped.id} stopped after ${rounds} round${rounds === 1 ? '' : 's'} without new answers`, tone: 'stopped', canSend: true }
  }
  const answered = steps.find(step => step.refineState === 'answered' && isUp(step))
  // B464: they wait for the Advisor, not for you: in its own colour, not the one that asks you.
  return answered === undefined ? null : { step: answered.id, text: `Your answers on ${answered.id} wait for the Advisor`, tone: 'answered' }
}
// advisorrefine:end

function drawTalk(state) {
  const advisor = state.advisor
  const box = $('messages')
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60
  $('talk-title').textContent = advisor?.name ?? 'Advisor'
  // B287: what it refines, beside its state.
  const refine = advisorRefine(state.backlog)
  fill($('talk-state'), [
    advisor === null ? null : el('span', `pill is-${advisor.state}`, STATES[advisor.state]),
    advisor === null || refine === null ? null : el('span', `advisor-refine-state is-${refine.tone}`, refine.text),
    // A chat that does not run takes nothing: what is typed here waits until its chat is opened.
    // A chat that does not run takes nothing: the main chat is asked to start it when something is typed here.
    ...(advisor === null ? [] : startParts(advisor.name)),
  ])
  $('say-send').disabled = advisor === null
  $('say-text').maxLength = state.maxMessageChars
  // B280: while it works, what on stands right above the typing box: what is typed waits until it is done.
  const busy = $('talk-busy')
  busy.hidden = advisor?.state !== 'working'
  if (!busy.hidden) {
    const topic = advisor.task?.text || advisor.doingNow || 'its turn'
    // Written anew only when its words change: it is a status line, and a reader would hear it again each time.
    const words = `Working: ${topic}`
    if (busy.dataset.words !== words) {
      busy.dataset.words = words
      busy.replaceChildren(el('b', '', words), el('span', '', 'What you type waits until it is done.'))
    }
  }
  // B282: why a send or a paste did not go, else where what is sent goes.
  const sayProblem = problems.get('talk') ?? pictureSlots.advisor.problem
  $('say-note').classList.toggle('is-error', sayProblem !== null)
  $('say-note').textContent = sayProblem ?? UNDELIVERED

  const rows = advisor === null ? [] : advisor.messages.map(message => drawMessage({
    key: `${message.at}:${message.from}`,
    kind: `is-${message.from}`,
    time: message.at === null ? '' : clock(message.at),
    who: message.who,
    text: message.text,
    picture: message.picture ?? null,
    note: message.via === 'board' ? 'typed on the board' : null,
  }))
  for (const typed of advisor?.pending ?? []) {
    const note = { expired: 'did not arrive, and is too old to deliver now', failed: 'could not be typed into its chat', taken: 'handed to its chat, which runs it when it is idle', copied: 'copied for you to paste into its chat' }[typed.state] ?? (typed.isHeld ? 'held until resume' : 'waits for its chat to take it')
    rows.push(drawMessage({ key: `out:${typed.id}`, kind: 'is-you is-pending', time: clock(typed.at), who: 'You', text: typed.text, picture: typed.picture ?? null, note }))
  }
  if (advisor !== null && advisor.state === 'working') {
    const status = el('div', 'message is-status')
    status.append(el('time'), el('span'), el('div', 'bubble', `${advisor.name} is working${advisor.doingNow === null ? '' : `: ${advisor.doingNow}`}`))
    rows.push(status)
  }
  if (rows.length === 0) rows.push(el('p', 'empty', advisor === null ? 'No advisor chat is open.' : 'Nothing said yet.'))
  const top = box.scrollTop
  fill(box, rows)
  box.scrollTop = atEnd ? box.scrollHeight : top
}

$('messages').addEventListener('click', event => {
  const bubble = event.target.closest('.bubble[data-key]')
  if (bubble === null || window.getSelection().toString() !== '' || event.target.closest('[data-zoom]') !== null) return
  if (bubble.classList.toggle('is-open')) openBubbles.add(bubble.dataset.key)
  else openBubbles.delete(bubble.dataset.key)
})

// talkmain:start
// B161: the talk with the main chat on the Overview's right side. The person, 2026-10-14: "I want a place in the
// overview to talk to the main chat to assign new tasks", "include the 'for you' as is", "add tabs there so i can
// swap between the two".

/**
 * An answer in its parts, so it reads as the chats write it (the project's CLAUDE.md): plain words (`text`), a quote
 * block such as "For you" (`quote`), a rule (`rule`), and a fenced block such as the closing block (`code`), each
 * of its lines with a `tone`: `good` for "+", `bad` for "-".
 */
function talkParts(text) {
  const lines = String(text).replace(/\r/g, '').split('\n')
  const parts = []
  let words = []
  const flush = () => {
    const joined = words.join('\n').replace(/^\n+|\n+$/g, '')
    if (joined !== '') parts.push({ kind: 'text', text: joined })
    words = []
  }
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]
    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/)
    if (fence !== null) {
      flush()
      const code = []
      at += 1
      while (at < lines.length && !/^\s*```\s*$/.test(lines[at])) code.push(lines[at++])
      parts.push({ kind: 'code', lang: fence[1], lines: code.map(one => ({ text: one, tone: one.startsWith('+') ? 'good' : one.startsWith('-') ? 'bad' : 'plain' })) })
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const quoted = []
      while (at < lines.length && /^\s*>/.test(lines[at])) quoted.push(lines[at++].replace(/^\s*> ?/, ''))
      at -= 1
      parts.push({ kind: 'quote', text: quoted.join('\n') })
      continue
    }
    if (/^\s*-{3,}\s*$/.test(line)) {
      flush()
      parts.push({ kind: 'rule' })
      continue
    }
    words.push(line)
  }
  flush()
  return parts
}

/** The head of the talk: its title, the tab's name, and whether the main chat's chat runs. */
function mainTalkView(talk) {
  if (talk === null || talk === undefined) return { title: 'Talk to the main chat', tab: 'Talk to Main', status: { text: 'No main chat is open', tone: 'off' } }
  const status = talk.isRunning === false
    ? { text: `${talk.name}'s chat is not running: what you type waits until it runs`, tone: 'off' }
    : talk.isRunning === null
      ? { text: talk.name, tone: 'unknown' }
      : talk.state === 'working'
        ? { text: `${talk.name} is working${typeof talk.doingNow === 'string' && talk.doingNow !== '' ? `: ${talk.doingNow}` : ''}`, tone: 'on' }
        : { text: `${talk.name} is online`, tone: 'on' }
  return { title: `Talk to ${talk.name}`, tab: `Talk to ${talk.name}`, status }
}

// B167: a picture from the clipboard goes with the words. The person, 2026-10-14: "i need a change so that i can post
// pictures in the 'talk to main' chat in the worker board, from my clipboard".
const TALK_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const TALK_BYTES = 8 * 1024 * 1024

/**
 * What Ctrl+V in Talk to Main takes from the clipboard's `items`: its picture (`take`), or a short line why nothing
 * was taken (`problem`). Words stay words (`ignore`): text copied from a document often brings a picture of itself.
 */
function pastedTalk(items) {
  const all = Array.from(items ?? [])
  if (all.some(item => item?.type === 'text/plain')) return { ignore: true }
  const files = all.filter(item => item?.kind === 'file')
  const picture = files.find(item => typeof item.type === 'string' && item.type.startsWith('image/'))
  if (picture !== undefined) return TALK_TYPES.includes(picture.type) ? { take: picture } : { problem: 'Only a PNG, JPEG or WebP picture can be pasted here.' }
  return { problem: files.length > 0 ? 'That is no picture: only a picture or words can be pasted here.' : 'The clipboard holds no picture.' }
}
// talkmain:end

/** B161: an answer drawn in its parts (see `talkParts`). */
function drawTalkText(node, text) {
  node.replaceChildren(...talkParts(text).map(part => {
    if (part.kind === 'rule') return el('hr', 'talk-rule')
    if (part.kind === 'quote') return rich(el('blockquote', 'talk-quote'), part.text)
    if (part.kind === 'code') {
      const block = el('pre', 'talk-code')
      for (const line of part.lines) block.append(el('span', `is-${line.tone}`, line.text), '\n')
      return block
    }
    return rich(el('div', 'talk-words'), part.text)
  }))
  return node
}

/** B161: one message of the talk: who and when above, the words under it. */
function drawTalkMessage({ key, from, who, at, text, picture: shown = null, note = null, isPending = false }) {
  const row = el('div', `talk-message is-${from}${isPending ? ' is-pending' : ''}`)
  const head = el('div', 'talk-head')
  const sign = el('span', `talk-avatar is-${from}`)
  if (from === 'chat') sign.append(icon('chat'))
  else sign.textContent = 'U'
  head.append(sign, el('b', '', who), el('time', '', at === null ? '' : clock(at)))
  const bubble = el('div', 'bubble talk-bubble')
  if (text.length > LONG_CHARS || text.split('\n').length > 14) {
    bubble.classList.add('is-long')
    bubble.dataset.key = key
    if (openBubbles.has(key)) bubble.classList.add('is-open')
  }
  drawTalkText(bubble, text)
  // B167: a picture pasted with it, small; a click opens it large.
  if (shown !== null) {
    const frame = picture(shown)
    frame.classList.add('talk-picture')
    bubble.append(frame)
  }
  if (note !== null) bubble.append(el('small', '', note))
  row.append(head, bubble)
  return row
}

/** B161: the talk with the main chat, drawn anew only when what it shows has changed, so typing is left alone. */
function drawMainTalk(state) {
  const talk = state.mainTalk ?? null
  const view = mainTalkView(talk)
  $('main-tab').textContent = view.tab
  $('main-talk-title').textContent = view.title
  const status = el('span', `main-talk-status is-${view.status.tone}`)
  status.append(el('span', 'dot'), view.status.text)
  fill($('main-talk-state'), [status])
  $('main-send').disabled = talk === null || sending.has('main-talk')
  $('main-text').maxLength = state.maxMessageChars
  const note = $('main-note')
  note.classList.toggle('is-error', problems.has('main-talk') || pictureSlots.main.problem !== null)
  note.textContent = problems.get('main-talk') ?? pictureSlots.main.problem ?? 'What you send is typed into the main chat\'s chat as your own words, once it is idle.'

  const box = $('main-messages')
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60
  const rows = (talk?.messages ?? []).map(message => drawTalkMessage({
    key: `main:${message.at}:${message.from}`,
    from: message.from,
    who: message.from === 'you' ? 'You' : talk.name,
    at: message.at,
    text: message.text,
    picture: message.picture ?? null,
    note: message.via === 'board' ? 'typed on the board' : null,
  }))
  for (const typed of talk?.pending ?? []) {
    const waits = { expired: 'did not arrive, and is too old to deliver now', failed: 'could not be typed into its chat', taken: 'handed to its chat, which runs it when it is idle', copied: 'copied for you to paste into its chat' }[typed.state] ?? (typed.isHeld ? 'held until resume' : 'waits for its chat to take it')
    rows.push(drawTalkMessage({ key: `main-out:${typed.id}`, from: 'you', who: 'You', at: typed.at, text: typed.text, picture: typed.picture ?? null, note: waits, isPending: true }))
  }
  if (rows.length === 0) rows.push(el('p', 'empty', talk === null ? 'No main chat is open.' : 'Nothing said here yet. Tell the main chat what to do next.'))
  const top = box.scrollTop
  fill(box, rows)
  box.scrollTop = atEnd ? box.scrollHeight : top
}

/** B161: which tab of the right side shows; kept in this browser. */
function showSide(name) {
  for (const tab of document.querySelectorAll('.side-tab')) {
    tab.classList.toggle('is-active', tab.dataset.side === name)
    tab.setAttribute('aria-selected', String(tab.dataset.side === name))
  }
  $('side-needs').hidden = name !== 'needs'
  $('side-main').hidden = name !== 'main'
  try {
    localStorage.setItem('side-tab', name)
  } catch {
    // Without storage the right side opens on "For you".
  }
  if (name === 'main') $('main-messages').scrollTop = $('main-messages').scrollHeight
}

for (const tab of document.querySelectorAll('.side-tab')) tab.addEventListener('click', () => showSide(tab.dataset.side))
document.querySelector('.side-tab[data-side="main"]').id = 'main-tab'
try {
  if (localStorage.getItem('side-tab') === 'main') showSide('main')
} catch {
  // Without storage the right side opens on "For you".
}

// B167: the picture pasted for the next message, shown small above the words until it is sent or taken away. The
// board keeps it only once it is sent; what it answered is remembered, so a second try does not keep it twice.
// B282: one slot per typing box, Talk to Main's and the Advisor's, served by the same code: where it shows (`box`),
// the words it goes with (`text`), the key of a failed send (`key`), the picture, why a paste was not taken, and how
// the box's talk is drawn again.
const pictureSlots = {
  main: { box: 'main-picture', text: 'main-text', key: 'main-talk', picture: null, problem: null, redraw: () => board !== null && drawMainTalk(board) },
  advisor: { box: 'say-picture', text: 'say-text', key: 'talk', picture: null, problem: null, redraw: () => board !== null && drawTalk(board) },
}

function setSlotPicture(slot, file) {
  if (slot.picture !== null) URL.revokeObjectURL(slot.picture.url)
  slot.picture = file === null ? null : { file, url: URL.createObjectURL(file), path: null }
  const box = $(slot.box)
  box.hidden = slot.picture === null
  if (slot.picture === null) return box.replaceChildren()
  const image = el('img')
  image.src = slot.picture.url
  image.alt = 'The picture to send'
  const remove = el('button', 'main-picture-remove', '×')
  remove.type = 'button'
  remove.title = 'Take the picture away'
  remove.setAttribute('aria-label', 'Take the picture away')
  const frame = el('span', 'main-picture-frame')
  frame.append(image, remove)
  box.replaceChildren(frame)
}

/**
 * The board keeps a picture to send and answers `{ path }` in the project, or `{ problem }` with the reason. B258: the
 * typing boxes' slots and the ask on the goal map keep their pictures this one way.
 */
async function keepTalkFile(file) {
  try {
    const got = await fetch('/api/talk/picture', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Board-Token': TOKEN }, body: file })
    if (got.ok) return { path: (await got.json()).path }
    return { problem: `the picture was not taken: ${(await got.text()).trim() || `refused (${got.status})`}` }
  } catch {
    return { problem: 'the board\'s server does not answer' }
  }
}

/** Why a picture cannot go with the words: too large; null when it can (the types are pastedTalk's). */
const talkPictureProblem = file => (file.size > TALK_BYTES ? `That picture is too large: ${TALK_BYTES / (1024 * 1024)} MB at most.` : null)

/** The board keeps the picture and answers its path; null, with the reason shown, when it did not. */
async function keepSlotPicture(slot) {
  if (slot.picture.path !== null) return slot.picture.path
  const kept = await keepTalkFile(slot.picture.file)
  if (kept.path !== undefined) return (slot.picture.path = kept.path)
  problems.set(slot.key, `Not sent: ${kept.problem}`)
  return null
}

/**
 * Ctrl+V in a typing box: a picture on the clipboard is shown small, to send with the words; anything else that is no
 * picture gets a short line. Words are pasted as words.
 */
function pasteInto(slot, event) {
  const pasted = pastedTalk(event.clipboardData?.items)
  if (pasted.ignore === true) return
  event.preventDefault()
  const file = pasted.take?.getAsFile() ?? null
  slot.problem = file === null ? pasted.problem ?? 'The clipboard holds no picture.' : talkPictureProblem(file)
  if (slot.problem === null) {
    problems.delete(slot.key)
    setSlotPicture(slot, file)
  }
  slot.redraw()
}

/** A typing box takes a pasted picture, lets it be taken away again, and forgets why a paste failed once typed in. */
function wirePictureSlot(slot, form) {
  $(form).addEventListener('paste', event => pasteInto(slot, event))
  $(slot.box).addEventListener('click', event => {
    if (event.target.closest('.main-picture-remove') === null) return
    setSlotPicture(slot, null)
    $(slot.text).focus()
  })
  $(slot.text).addEventListener('input', () => {
    if (slot.problem === null) return
    slot.problem = null
    slot.redraw()
  })
}
wirePictureSlot(pictureSlots.main, 'main-say')
wirePictureSlot(pictureSlots.advisor, 'say')

$('main-say').addEventListener('submit', async event => {
  event.preventDefault()
  const slot = pictureSlots.main
  const text = $('main-text').value.trim()
  if ((text === '' && slot.picture === null) || (board?.mainTalk ?? null) === null || sending.has('main-talk')) return
  $('main-send').disabled = true
  slot.problem = null
  problems.delete('main-talk')
  sending.add('main-talk')
  const pending = slot.picture
  const picture = pending === null ? null : await keepSlotPicture(slot)
  sending.delete('main-talk')
  // Taken away or pasted anew while it was kept: nothing is sent, and the new one stays.
  if (slot.picture !== pending) return drawMainTalk(board)
  if (pending === null || picture !== null) await send({ to: board.mainTalk.name, text, ...(picture === null ? {} : { picture }) }, 'main-talk')
  if (!problems.has('main-talk')) {
    $('main-text').value = ''
    setSlotPicture(slot, null)
  }
  if (board !== null) drawMainTalk(board)
})

$('main-text').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    $('main-say').requestSubmit()
  }
})

$('main-messages').addEventListener('click', event => {
  const bubble = event.target.closest('.bubble[data-key]')
  if (bubble === null || window.getSelection().toString() !== '' || event.target.closest('[data-zoom]') !== null) return
  if (bubble.classList.toggle('is-open')) openBubbles.add(bubble.dataset.key)
  else openBubbles.delete(bubble.dataset.key)
})

$('main-talk-icon').append(icon('chat'))

// The right side of a tab is as wide as the person drags it

/**
 * Makes `handle` set the width of the right side of `view`: by dragging, by the arrow keys, and back to the usual
 * width with a double-click. The width is kept in this browser under `name`.
 */
function resizable(handle, view, name, usual) {
  const least = 300
  const fit = width => Math.round(Math.max(least, Math.min(width, window.innerWidth * 0.7)))
  let width = usual
  try {
    width = Number(localStorage.getItem(name)) || usual
  } catch {
    // Without storage the width is the usual one after each reload.
  }
  const set = (next, isKept = true) => {
    width = fit(next)
    view.style.setProperty('--side', `${width}px`)
    handle.setAttribute('aria-valuenow', String(width))
    if (!isKept) return
    try {
      localStorage.setItem(name, String(width))
    } catch {
      // Not kept; it still applies until the page is closed.
    }
  }
  set(width, false)

  handle.addEventListener('pointerdown', event => {
    event.preventDefault()
    try {
      // So the drag goes on when the pointer leaves the thin handle.
      handle.setPointerCapture(event.pointerId)
    } catch {
      // A pointer that cannot be captured still drags while it stays on the handle.
    }
    document.body.classList.add('is-resizing')
    // The side reaches from the pointer to the right edge of the view.
    const move = moved => set(view.getBoundingClientRect().right - moved.clientX, false)
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      document.body.classList.remove('is-resizing')
      set(width)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  })
  handle.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') set(width + 24)
    else if (event.key === 'ArrowRight') set(width - 24)
    else return
    event.preventDefault()
  })
  handle.addEventListener('dblclick', () => set(usual))
  window.addEventListener('resize', () => set(width, false))
}

resizable($('inbox-resizer'), $('view-overview'), 'for-you-width', 390)
resizable($('talk-resizer'), $('view-advice'), 'chat-width', 500)

/**
 * B307: the handle above Information sets that part's height (see `infoHeightFit`): by dragging, by the arrow keys,
 * and back to the usual height with a double-click. The height is kept in this browser.
 */
function resizableInformation(handle, side, usual) {
  // The height the person chose, apart from the one that fits now: a window made narrow and wide again keeps it.
  let wanted = usual
  let height = usual
  try {
    wanted = Number(localStorage.getItem('information-height')) || usual
  } catch {
    // Without storage the height is the usual one after each reload.
  }
  // Where the side flows under the Overview (a narrow window) it has no height of its own to share.
  const flows = window.matchMedia('(max-width: 1250px)')
  handle.setAttribute('aria-valuemin', '90')
  /** Applies `next` as far as it fits; `isChosen`: the person chose it (it is kept, also in this browser). */
  const set = (next, isChosen = true) => {
    const room = side.getBoundingClientRect().height
    height = flows.matches || room <= 0 ? Math.round(next) : infoHeightFit(next, room)
    side.style.setProperty('--info-height', `${height}px`)
    handle.setAttribute('aria-valuenow', String(height))
    if (room > 0 && !flows.matches) handle.setAttribute('aria-valuemax', String(Math.max(90, Math.round(room - 120))))
    if (!isChosen) return
    wanted = height
    try {
      localStorage.setItem('information-height', String(height))
    } catch {
      // Not kept; it still applies until the page is closed.
    }
  }
  set(wanted, false)
  handle.addEventListener('pointerdown', event => {
    // Only the main button drags.
    if (event.button !== 0) return
    event.preventDefault()
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // A pointer that cannot be captured still drags while it stays on the handle.
    }
    document.body.classList.add('is-resizing-rows')
    // Information reaches from the pointer to the bottom of the side.
    const move = moved => set(side.getBoundingClientRect().bottom - moved.clientY, false)
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      document.body.classList.remove('is-resizing-rows')
      set(height)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  })
  handle.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp') set(height + 24)
    else if (event.key === 'ArrowDown') set(height - 24)
    else return
    event.preventDefault()
  })
  handle.addEventListener('dblclick', () => set(usual))
  window.addEventListener('resize', () => set(wanted, false))
}

resizableInformation($('info-resizer'), $('side-needs'), 260)

// finished:start
// B155: the steps finished last, newest first, at the top of the Backlog tab. The person, 2026-10-14: "i want a
// chronological list of backlog items that were recently finish desc, so latest items first."

const FINISHED_HOW = { line: 'its line in the backlog', store: 'its move to done in the work store', seen: 'the board saw it ticked', day: 'only the day is known' }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The rows of the list: when (the clock time today, the day and the time before today, only the day when that is
 * all there is, "≈" when the board saw it ticked), the step's id and title, who finished it, and where the time
 * comes from. `isRough` marks a time that is only roughly known.
 */
function finishedRows(list, now, byStep = {}) {
  const dayOf = at => `${new Date(at).getDate()} ${MONTH_NAMES[new Date(at).getMonth()]}`
  const isToday = at => new Date(at).toDateString() === new Date(now).toDateString()
  return list.map(one => ({
    key: one.key,
    code: one.id ?? '',
    title: one.title,
    when: one.how === 'day' ? dayOf(one.at) : `${one.how === 'seen' ? '≈ ' : ''}${isToday(one.at) ? '' : `${dayOf(one.at)} `}${clock(one.at)}`,
    isRough: one.how === 'day' || one.how === 'seen',
    who: one.by ?? '—',
    how: FINISHED_HOW[one.how] ?? '',
    // B185: its estimate and how long it really took, when the board measured it.
    took: one.id === null ? '' : tookWords(byStep[one.id]),
  }))
}
// finished:end

// B179: the list folds away with a click on its head, and stays so in this browser. The person, 2026-10-14: "Make
// the backlog 'recently finished' collapsible."
let finishedFolded = false
try {
  finishedFolded = localStorage.getItem('finished-folded') === 'yes'
} catch {
  // Without storage the list opens unfolded.
}

/** B155: the list at the top of the Backlog tab. A click on a row opens the step's window, as the list below does. */
function drawFinished(state) {
  const box = $('finished')
  box.hidden = !Array.isArray(state.finished)
  if (box.hidden) return
  box.classList.toggle('is-folded', finishedFolded)
  const head = el('h2')
  head.id = 'finished-title'
  const fold = el('button', 'finished-fold')
  fold.type = 'button'
  fold.dataset.foldFinished = ''
  fold.title = finishedFolded ? 'Show the steps finished last' : 'Fold the list away'
  fold.setAttribute('aria-expanded', String(!finishedFolded))
  fold.setAttribute('aria-controls', 'finished-body')
  const arrow = el('span', 'finished-arrow', finishedFolded ? '▸' : '▾')
  arrow.setAttribute('aria-hidden', 'true')
  fold.append(arrow, 'Recently finished', el('small', '', 'the last 20, newest first'))
  head.append(fold)
  const rows = finishedRows(state.finished, state.readAt, state.taskTimes?.byStep ?? {})
  const list = rows.length === 0 ? el('p', 'muted finished-none', 'No finished task has a time the board can find yet.') : el('ol', 'finished-list')
  list.id = 'finished-body'
  list.hidden = finishedFolded
  for (const row of rows) {
    const item = el('li')
    const button = el('button', 'finished-row')
    button.type = 'button'
    button.dataset.finished = row.key
    button.title = 'Open the step'
    button.append(el('span', `finished-when${row.isRough ? ' is-rough' : ''}`, row.when), el('span', 'finished-code', row.code), el('span', 'finished-title', row.title), el('span', 'finished-who', row.who), el('span', 'finished-took', row.took), el('span', 'finished-how', row.how))
    item.append(button)
    list.append(item)
  }
  // A redraw with new data keeps the keyboard on the head when it was there.
  const wasOnHead = document.activeElement?.closest?.('[data-fold-finished]') != null
  fill(box, [head, list])
  if (wasOnHead) fold.focus()
}

$('finished').addEventListener('click', event => {
  if (event.target.closest('[data-fold-finished]') !== null) {
    finishedFolded = !finishedFolded
    try {
      localStorage.setItem('finished-folded', finishedFolded ? 'yes' : 'no')
    } catch {
      // Kept for this page only.
    }
    if (board !== null) drawFinished(board)
    // The head is drawn anew: the keyboard stays on it, also where a click does not focus a button.
    $('finished').querySelector('[data-fold-finished]')?.focus()
    return
  }
  const row = event.target.closest('[data-finished]')
  if (row !== null) openDetails({ step: row.dataset.finished })
})

// B579: Completed by day. The Backlog tab shows the open items or, at the toggle, one day of finished steps with a short
// recap on top (src/work/doneDays.mjs, src/dayRecap.mjs). The person, 2026-10-24: "i want to be able to see which
// changes were done today ... including a generated recap text, highover ... the goal here is easy overview".
// doneday:start
const DAY_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** The local moment of a `YYYY-MM-DD` day's start. */
const dayStart = day => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}
/** A day's name beside today's: "Today", "Yesterday", else its weekday. */
function dayName(day, today) {
  if (day === today) return 'Today'
  const before = dayStart(today)
  before.setDate(before.getDate() - 1)
  const then = dayStart(day)
  return then.getTime() === before.getTime() ? 'Yesterday' : DAY_WEEKDAYS[then.getDay()]
}
/** "October 24, 2026", or short: "Oct 24, 2026". */
function dayDate(day, isShort = false) {
  const then = dayStart(day)
  const month = DAY_MONTHS[then.getMonth()]
  return `${isShort ? month.slice(0, 3) : month} ${then.getDate()}, ${then.getFullYear()}`
}
/** The day before (-1) or after (1) a day. */
function dayStep(day, count) {
  const then = dayStart(day)
  then.setDate(then.getDate() + count)
  return `${then.getFullYear()}-${String(then.getMonth() + 1).padStart(2, '0')}-${String(then.getDate()).padStart(2, '0')}`
}
/** The finished steps a find box keeps: by id ("B12", "12") or by words of the title. */
function dayFinds(step, find) {
  const wanted = find.trim().toLowerCase()
  if (wanted === '') return true
  const digits = /^b?0*(\d+)$/.exec(wanted)
  if (digits !== null && String(step.id).toLowerCase().replace(/^b0*/, '').startsWith(digits[1])) return true
  return step.title.toLowerCase().includes(wanted)
}
// doneday:end

/** The quiet colours of the recap's points, in order: no amber, gold, orange or red (those ask for attention). */
const POINT_TONES = ['#60a5fa', '#2dd4bf', '#a78bfa', '#38bdf8', '#818cf8', '#94a3b8', '#5eead4']
/** How many rows the table shows before "Show all". */
const DAY_ROWS = 12

// The address #backlog/days opens it on Completed by day; else the tab opens as it was left in this browser.
let backlogMode = location.hash === '#backlog/days' ? 'days' : 'open'
try {
  if (location.hash !== '#backlog' && localStorage.getItem('backlog-mode') === 'days') backlogMode = 'days'
} catch {
  // Without storage the tab opens on the open items.
}
const backlogAddress = () => (backlogMode === 'days' ? '#backlog/days' : '#backlog')
let doneDay = null // the day shown; null: today
let doneDayView = null // the server's answer for it
let doneDayAt = 0
let doneDayAll = false
let doneDayFind = ''
let doneDayLoading = null
let doneDayProblem = null

/** Fetches the day shown (at most every 9 s unless `isNow`) and draws it. */
async function refreshDoneDay(isNow = false) {
  if (backlogMode !== 'days' || $('view-coordinate').hidden) return
  if (!isNow && Date.now() - doneDayAt < 9000) return
  if (doneDayLoading !== null) return
  const asked = doneDay ?? ''
  doneDayAt = Date.now()
  doneDayLoading = fetch(`/api/recap?day=${encodeURIComponent(asked)}`, { headers: { 'X-Board-Token': TOKEN } })
    .then(async answer => {
      if (!answer.ok) throw new Error((await answer.text()) || `The board answered ${answer.status}.`)
      const view = await answer.json()
      if ((doneDay ?? '') !== asked) return
      doneDayView = view
      doneDayProblem = null
    })
    .catch(error => { doneDayProblem = error.message })
    .finally(() => {
      doneDayLoading = null
      drawDoneDay()
      // A day asked while this one was read is read next.
      if ((doneDay ?? '') !== asked) refreshDoneDay(true)
    })
}

function showBacklogMode() {
  const isDays = backlogMode === 'days'
  for (const button of $('coordinate-mode').querySelectorAll('[data-mode]')) {
    button.classList.toggle('is-chosen', button.dataset.mode === backlogMode)
    button.setAttribute('aria-pressed', String(button.dataset.mode === backlogMode))
  }
  for (const id of ['coordinate-filters', 'coordinate-tools', 'finished', 'coordinate-list', 'coordinate-count']) $(id).classList.toggle('is-off-mode', isDays)
  $('done-day').hidden = !isDays
  $('coordinate-note').hidden = !isDays
  if (isDays) {
    drawDoneDay()
    refreshDoneDay(true)
  }
}

$('coordinate-mode').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]')
  if (button === null || button.dataset.mode === backlogMode) return
  backlogMode = button.dataset.mode
  try {
    localStorage.setItem('backlog-mode', backlogMode)
  } catch {
    // Kept for this page only.
  }
  if (location.hash === '#backlog' || location.hash === '#backlog/days') history.replaceState(null, '', backlogAddress())
  showBacklogMode()
})

function chipOf(id) {
  const chip = el('button', 'day-chip', id)
  chip.type = 'button'
  chip.dataset.dayStep = id
  chip.title = 'Open the step'
  return chip
}

/** One part of the right column: a head with its icon, and what it holds. */
function daySide(icon, title, ...parts) {
  const box = el('section', 'day-card day-side')
  const head = el('h3', 'day-head')
  head.append(el('span', 'day-icon', icon), title)
  box.append(head, ...parts)
  return box
}

function drawDoneDay() {
  const box = $('done-day')
  if (backlogMode !== 'days') return
  const view = doneDayView
  if (view === null) {
    fill(box, [el('p', 'muted day-wait', doneDayProblem ?? 'Reading the finished tasks…')])
    return
  }
  const { day, today } = view
  const steps = view.steps ?? []
  const tones = new Map((view.recap?.points ?? []).map((point, index) => [point, POINT_TONES[index % POINT_TONES.length]]))

  // The bar: the pager and the count.
  const bar = el('div', 'day-bar')
  const before = el('button', 'day-pager', '‹')
  before.type = 'button'
  before.dataset.dayGo = dayStep(day, -1)
  before.title = 'The day before'
  before.disabled = day <= view.first
  const after = el('button', 'day-pager', '›')
  after.type = 'button'
  after.dataset.dayGo = dayStep(day, 1)
  after.title = 'The day after'
  after.disabled = day >= today
  const label = el('span', 'day-label')
  label.append(el('span', 'day-cal', '▦'), `${dayName(day, today)} · ${dayDate(day)}`)
  const count = el('span', 'day-count')
  count.append(el('span', 'day-dot'), `${steps.length} item${steps.length === 1 ? '' : 's'} completed`)
  bar.append(before, label, after, count)
  if (doneDayProblem !== null) bar.append(el('span', 'warn day-problem', doneDayProblem))

  // The recap.
  const recapBox = el('section', 'day-card day-recap')
  const recapHead = el('h3', 'day-head')
  recapHead.append(el('span', 'day-icon is-spark', '✦'), day === today ? 'Today’s recap' : `Recap of ${dayDate(day, true)}`)
  const recap = view.recap
  const how = recap === null ? '' : view.isWriting ? 'Writing the recap…'
    : recap.isGenerated ? `Generated from ${steps.length} completed item${steps.length === 1 ? '' : 's'}.`
      : `Not generated${recap.why ? `: ${recap.why.replace(/\.$/, '')}` : ''}. Grouped by goal for now.`
  recapHead.append(el('small', '', how))
  recapBox.append(recapHead)
  if (recap === null) recapBox.append(el('p', 'muted day-none', 'Nothing was finished on this day.'))
  else {
    // Four points or fewer stand in one row, five or six in rows of three.
    const points = el('div', `day-points${recap.points.length > 4 ? ' is-rows' : ''}`)
    points.style.setProperty('--cols', String(recap.points.length > 4 ? 3 : Math.max(1, recap.points.length)))
    recap.points.forEach((point, index) => {
      const one = el('article', 'day-point')
      one.style.setProperty('--tone', tones.get(point))
      const top = el('div', 'day-point-top')
      top.append(el('span', 'day-point-icon', String(index + 1)), el('b', '', point.title))
      const chips = el('div', 'day-chips')
      for (const id of point.ids.slice(0, 3)) chips.append(chipOf(id))
      if (point.ids.length > 3) {
        const more = el('span', 'day-chip is-more', `+${point.ids.length - 3}`)
        more.title = point.ids.slice(3).join(', ')
        chips.append(more)
      }
      one.append(top, el('p', '', point.text), chips)
      points.append(one)
    })
    recapBox.append(points, el('p', 'muted day-note', 'ⓘ One recap point can include several backlog items.'))
  }

  // The table.
  const shown = steps.filter(step => dayFinds(step, doneDayFind))
  const tableBox = el('section', 'day-card day-items')
  const tableHead = el('div', 'day-items-top')
  const tableTitle = el('h3', 'day-head')
  tableTitle.append(el('span', 'day-tick', '✓'), 'Completed items', el('small', '', `${steps.length} item${steps.length === 1 ? '' : 's'}`))
  const find = el('input', 'day-find')
  find.type = 'search'
  find.id = 'done-day-find'
  find.placeholder = 'Find a completed item…'
  find.setAttribute('aria-label', 'Find a completed item')
  find.maxLength = 60
  find.value = doneDayFind
  tableHead.append(tableTitle, find)
  const table = el('div', 'day-table')
  const head = el('div', 'day-row is-head')
  head.append(el('span', '', ''), el('span', '', 'Item'), el('span', '', ''), el('span', '', 'Completed ▾'), el('span', '', 'Worker'))
  table.append(head)
  for (const step of doneDayAll ? shown : shown.slice(0, DAY_ROWS)) {
    const row = el('button', 'day-row')
    row.type = 'button'
    row.dataset.dayStep = step.id
    row.title = step.goalTitle === null ? 'Open the step' : `Open the step · ${step.goalTitle}`
    row.append(el('span', 'day-tick', '✓'), el('span', 'day-chip', step.id), el('span', 'day-title', step.title), el('span', 'day-time', clock(step.at)), el('span', 'day-who', step.by ?? '—'))
    table.append(row)
  }
  tableBox.append(tableHead, table)
  if (shown.length === 0 && steps.length > 0) tableBox.append(el('p', 'muted day-none', 'No completed item has these words.'))
  if (shown.length > DAY_ROWS) {
    const all = el('button', 'day-all', doneDayAll ? 'Show fewer' : `Show all ${shown.length} completed items →`)
    all.type = 'button'
    all.dataset.dayAll = ''
    tableBox.append(all)
  }

  // The right column.
  const workers = new Set(steps.map(step => step.by).filter(by => by !== null)).size
  const glance = el('div', 'day-glance')
  for (const [figure, words] of [[steps.length, 'Completed items'], [workers, 'Workers contributed'], [recap?.points.length ?? 0, 'Recap points']]) {
    const one = el('div', 'day-figure')
    one.append(el('b', '', String(figure)), el('span', '', words))
    glance.append(one)
  }
  const browse = el('ol', 'day-browse')
  for (const one of view.days ?? []) {
    const item = el('li')
    const button = el('button', `day-browse-row${one.day === day ? ' is-chosen' : ''}`)
    button.type = 'button'
    button.dataset.dayGo = one.day
    button.append(el('b', '', dayName(one.day, today)), el('span', 'muted', dayDate(one.day, true)), el('span', 'day-done', `${one.count} completed`), el('span', 'day-arrow', '›'))
    item.append(button)
    browse.append(item)
  }
  const coverage = el('ul', 'day-coverage')
  const most = Math.max(1, ...(recap?.points ?? []).map(point => point.ids.length))
  for (const point of recap?.points ?? []) {
    const row = el('li')
    row.style.setProperty('--tone', tones.get(point))
    const barOf = el('span', 'day-cover-bar')
    const filled = el('i')
    filled.style.width = `${Math.round((point.ids.length / most) * 100)}%`
    barOf.append(filled)
    row.append(el('span', 'day-cover-dot'), el('span', 'day-cover-name', point.title), el('b', '', String(point.ids.length)), barOf)
    coverage.append(row)
  }
  const copy = el('button', 'day-copy')
  copy.type = 'button'
  copy.dataset.dayCopy = ''
  copy.disabled = recap === null
  const copyWords = el('span', 'day-copy-words')
  copyWords.append(el('b', '', 'Copy daily recap'), el('small', '', 'The recap as plain text, to share.'))
  copy.append(el('span', 'day-copy-icon', '⧉'), copyWords)
  const side = el('div', 'day-column is-side')
  side.append(
    daySide('▮', 'This day at a glance', glance),
    daySide('▦', 'Browse days', browse),
    daySide('◔', 'Recap coverage', el('p', 'muted day-sub', 'How this day’s completed items are grouped.'), recap === null ? el('p', 'muted day-none', 'No recap for this day.') : coverage),
    copy,
  )
  const main = el('div', 'day-column')
  main.append(recapBox, tableBox)
  const grid = el('div', 'day-grid')
  grid.append(main, side)
  // A redraw keeps the typing in the find box.
  const wasFinding = document.activeElement?.id === 'done-day-find'
  const caret = wasFinding ? document.activeElement.selectionStart : null
  fill(box, [bar, grid])
  if (wasFinding) {
    find.focus()
    find.setSelectionRange(caret, caret)
  }
}

$('done-day').addEventListener('click', event => {
  const go = event.target.closest('[data-day-go]')
  if (go !== null && !go.disabled) {
    const today = doneDayView?.today ?? null
    doneDay = go.dataset.dayGo === today ? null : go.dataset.dayGo
    doneDayAll = false
    if (doneDayView !== null) doneDayView = { ...doneDayView, day: go.dataset.dayGo, steps: [], recap: null }
    drawDoneDay()
    refreshDoneDay(true)
    return
  }
  const step = event.target.closest('[data-day-step]')
  if (step !== null) return openDetails({ step: step.dataset.dayStep })
  if (event.target.closest('[data-day-all]') !== null) {
    doneDayAll = !doneDayAll
    return drawDoneDay()
  }
  const copy = event.target.closest('[data-day-copy]')
  if (copy !== null && doneDayView?.copy) {
    const words = copy.querySelector('b')
    navigator.clipboard.writeText(doneDayView.copy).then(() => { words.textContent = 'Copied' }, () => { words.textContent = 'Not copied' })
  }
})
$('done-day').addEventListener('input', event => {
  if (event.target.id !== 'done-day-find') return
  doneDayFind = event.target.value
  drawDoneDay()
})
showBacklogMode()

// The Coordinate tab: the whole backlog by activity. It only shows; a click on a step opens its window.

// B84: what the tab lists, worked out without the page. Kept between these two marks so a test can run it.
// coordinate:start
/** The ways to narrow the list, in the order of their buttons. */
const COORDINATE_FILTERS = [['all', 'All'], ['progress', 'In progress'], ['queued', 'Queued'], ['you', 'Needs your attention'], ['unassigned', 'Without a worker']]

/** Whether an open step shows under a way to narrow the list. "Without a worker": a step for nobody yet, not the person's. */
function coordinateShows(step, filter) {
  if (filter === 'progress' || filter === 'queued' || filter === 'you') return step.status === filter
  if (filter === 'unassigned') return step.worker === null && step.status !== 'you'
  return true
}

/** Whether a step is what was typed in the search: an id ("B64", "b6", "64") by its start, anything else by the words of its title. */
function coordinateFinds(step, find) {
  const wanted = find.trim().toLowerCase()
  if (wanted === '') return true
  // By its number, whatever zeros stand before it: "2" finds B02 and B20.
  const digits = /^b?0*(\d+)$/.exec(wanted)
  if (digits !== null) return (step.id ?? '').toLowerCase().replace(/^b0*/, '').startsWith(digits[1])
  return `${step.id ?? ''} ${step.title}`.toLowerCase().includes(wanted)
}

/**
 * The tab's list: the activities in the order given (the person's focus first), each with the steps that pass the
 * filter and the search; finished steps only when asked for, and never under a filter but "All". An activity with no
 * step left is left out. `counts` says how many open steps each filter holds, whatever is searched for. The Backlog
 * tab's blocks (2026-10-25) sort what it keeps into blocks (`backlogBlocks`).
 */
function coordinateList(activities, { filter = 'all', find = '', showDone = false, goal = null } = {}) {
  const counts = {}
  // Focus 1: only the steps behind a goal (`goal`: their ids). B325: its finished ones only with "Show finished", as
  // without a goal (the user, 2026-10-18: "the show finished checkbox doesnt work if you have a goal in the filter").
  const isOfGoal = step => goal === null || (typeof step.id === 'string' && goal.includes(step.id))
  for (const [name] of COORDINATE_FILTERS) counts[name] = 0
  const groups = []
  let shown = 0
  for (const activity of activities) {
    const steps = []
    for (const step of activity.steps) {
      if (!isOfGoal(step)) continue
      const isDone = step.status === 'done'
      if (!isDone) for (const [name] of COORDINATE_FILTERS) if (coordinateShows(step, name)) counts[name] += 1
      if (isDone ? !(showDone && filter === 'all') : !coordinateShows(step, filter)) continue
      if (!coordinateFinds(step, find)) continue
      steps.push(step)
    }
    // Fix first: an open board fix stands first in its group.
    steps.sort((a, b) => Number(isOpenFix(b)) - Number(isOpenFix(a)))
    if (steps.length > 0) groups.push({ name: activity.name, isFocus: activity.isFocus, steps })
    shown += steps.length
  }
  return { groups, counts, shown }
}

/** Fix first: a step marked as a board fix that is not finished. */
function isOpenFix(step) {
  return step.isFix === true && step.status !== 'done'
}

/**
 * The Backlog tab's blocks (2026-10-25, the person's yes on the mockup of that day, with "In progress is higher than
 * queue"): under "Recently finished", top to bottom: `[key, title, the words after its count]`.
 */
const BACKLOG_BLOCKS = [
  ['progress', 'In progress', ''],
  ['queue', 'Queue', 'a free worker takes the top one'],
  ['refined', 'Refined', 'waiting for your choice'],
  ['new', 'Not refined yet', 'the Advisor refines these first'],
  ['done', 'Finished', ''],
]
/**
 * A task under way, by its state in the work store: `[its words, its tone]`, in this order in the block. Green only
 * while a worker is on it; the colour of "waiting for you" only when it waits on the person (amber is for attention
 * only); the rest quiet.
 */
const UNDER_WAY_STATES = {
  'in progress': ['In progress', 'progress'],
  'waiting on you': ['Waiting on you', 'you'],
  taken: ['Taken', 'queued'],
  queued: ['Given', 'queued'],
  review: ['In review', 'review'],
}
const FINISHED_STATES = ['done', 'dropped', 'answered']
/** What a task not refined yet waits for, by where its refine stands (its `refineState`). */
const REFINE_WAITS = { asking: 'being refined', answered: 'being refined', ready: 'being refined', answers: 'waits for your answer', stopped: 'its refine stopped', none: 'waits for its refine' }
/** A goal of the goal map, which a row links to on the Goals part. */
const GOAL_LINK_ID = /^G\d+$/

/** A step's number for "newest first"; a step without an id last. */
const blockNumber = step => (typeof step.id === 'string' ? Number(step.id.replace(/^\D+/, '')) || 0 : -1)
const newestFirst = (a, b) => Number(b.isFix) - Number(a.isFix) || blockNumber(b.step) - blockNumber(a.step)

/**
 * 2026-10-26, T9.1.1 (the person, 2026-10-27: workers do the checks): where the result check of a step in review stands, in words
 * for its state cell (the step's `reviewStand`, from the server: its Quality Assurance task, `{ kind, since, qa, who }`):
 * "waits for its check: B730, queued since 16:14" or "B730: Worker 3 is checking it since 16:20". Null when the server said
 * nothing (the step waits for a fix, for an answer, or has nothing to check).
 */
function checkStandWords(stand) {
  const since = Number.isFinite(stand?.since) ? ` since ${clock(stand.since)}` : ''
  const task = typeof stand?.qa === 'string' && stand.qa !== '' ? stand.qa : null
  if (stand?.kind === 'queued') return `waits for its check: ${task ?? 'its QA task'}, queued${since}`
  if (stand?.kind === 'working') return `${task ?? 'its QA task'}: ${typeof stand.who === 'string' && stand.who !== '' ? stand.who : 'a worker'} is checking it${since}`
  return null
}

/**
 * The Backlog tab's blocks: the steps of the tab's list (`coordinateList`) sorted by where they stand, with the board's
 * ready list (`readyList`, the state's `{ ready, held }`; null without a store). Each block `{ key, title, note, rows }`,
 * each row with its step (`step`), its goal (`goal`), its pin (`pinned`), whether the person added it (`isAdded`) and
 * whether it is an open fix (`isFix`):
 * - In progress: given (queued), taken, in progress, waiting on you or in review, with its worker (`who`) and its
 *   state (`state`, `tone`); a fix first, then by state, then newest first.
 * - Queue: the ready list's `ready`, numbered (`n`) in the order a free worker takes them (its place in the whole list,
 *   also when the search narrows it), with its chips (`isFix`, `isFocus`, `isAdded`), for whom (`who`), a refusal or a
 *   note of the board's (`note`), and `canRemove` on the person's own: added or pinned.
 * - Refined: the refined steps the ready list holds back: one held for the person's choice (`choice`) has `canAdd`;
 *   any other says why (`why`), quietly, with `canRemove` on the person's own. A fix first, then newest first.
 * - Not refined yet: the other open steps, with what they wait for (`wait`): being refined, or waiting for your answer.
 * - Finished: only with `showDone`, newest first.
 * A step whose store state the page does not know (no store) goes by its status.
 */
function backlogBlocks(list, readyList, { showDone = false } = {}) {
  const ready = new Map((readyList?.ready ?? []).map((one, index) => [one.id, { ...one, n: index + 1 }]))
  const held = new Map((readyList?.held ?? []).map(one => [one.id, one]))
  const rows = { progress: [], queue: [], refined: [], new: [], done: [] }
  const steps = list.groups.flatMap(group => group.steps.map(step => ({ ...step, activity: step.activity ?? group.name })))
  for (const step of steps) {
    const item = step.item ?? null
    const state = item?.state ?? null
    const pinned = item?.pinned ?? null
    const base = { step, goal: item?.goal ?? null, pinned, isAdded: (item?.queuedBy ?? null) !== null, isFix: isOpenFix(step) }
    const isOwn = base.isAdded || pinned !== null
    const forWho = pinned === null ? '' : `for ${pinned} only`
    if (step.status === 'done' || FINISHED_STATES.includes(state)) {
      if (showDone) rows.done.push({ ...base, who: item?.owner ?? step.worker ?? '' })
      continue
    }
    const under = state !== null ? (Object.hasOwn(UNDER_WAY_STATES, state) ? UNDER_WAY_STATES[state] : null)
      : step.status === 'progress' ? UNDER_WAY_STATES['in progress'] : step.status === 'queued' ? UNDER_WAY_STATES.queued : null
    if (under !== null) {
      const owner = item?.owner ?? step.worker ?? ''
      // 2026-10-26 (the person: "it says worker 4 is doing something"): a step in review is not its builder at work. Its worker
      // column says who built it, and its state whom it waits for: the Advisor's check (where that stands), or what it says in its title.
      const isReview = state === 'review'
      rows.progress.push({
        ...base, who: isReview && owner !== '' ? `built by ${owner}` : owner, state: isReview ? checkStandWords(step.reviewStand) ?? under[0] : under[0], tone: under[1],
        order: Object.values(UNDER_WAY_STATES).indexOf(under),
      })
      continue
    }
    const one = typeof step.id === 'string' ? ready.get(step.id) : undefined
    if (state === 'refined' && one !== undefined) {
      const kept = one.pinned ?? pinned
      const isAdded = (one.added ?? null) !== null || base.isAdded
      rows.queue.push({
        ...base, n: one.n, isFix: one.rank === 0 || base.isFix, isFocus: one.rank === 1, isAdded, pinned: kept,
        // T9.1.1: a Quality Assurance task goes to any free worker but the ones that built the step it checks (`notBy`).
        who: kept !== null ? `for ${kept} only` : (one.keptFor ?? null) !== null ? `kept for ${one.keptFor}` : (one.notBy ?? []).length > 0 ? `any free worker but ${one.notBy.join(', ')}` : 'any free worker',
        note: [(one.refused ?? null) === null ? null : `not given to ${one.refused.chat}: ${one.refused.why}`, one.note ?? null].filter(Boolean).join(' · '),
        canRemove: queueChoice({ inQueue: true, isAdded, pinned: kept }).canRemove,
      })
      continue
    }
    if (state === 'refined') {
      const hold = typeof step.id === 'string' ? held.get(step.id) ?? null : null
      const { canAdd, canRemove } = queueChoice({ state, isAdded: base.isAdded, pinned, choice: hold?.choice })
      rows.refined.push({ ...base, who: forWho, canAdd, why: canAdd ? '' : hold?.why ?? '', canRemove })
      continue
    }
    rows.new.push({ ...base, who: forWho, wait: step.status === 'you' ? 'waits for your answer' : REFINE_WAITS[step.refineState] ?? '', canRemove: queueChoice({ isAdded: base.isAdded, pinned }).canRemove })
  }
  const sorted = {
    progress: rows.progress.sort((a, b) => Number(b.isFix) - Number(a.isFix) || a.order - b.order || blockNumber(b.step) - blockNumber(a.step)),
    queue: rows.queue.sort((a, b) => a.n - b.n),
    refined: rows.refined.sort(newestFirst),
    new: rows.new.sort(newestFirst),
    done: rows.done.sort((a, b) => blockNumber(b.step) - blockNumber(a.step)),
  }
  return BACKLOG_BLOCKS.filter(([key]) => key !== 'done' || showDone).map(([key, title, note]) => ({ key, title, note, rows: sorted[key] }))
}

/** The Backlog tab's blocks: whether a block stands open, as this browser left it (`folds`: `{ queue: true }` is folded). */
function isBlockOpen(key, folds) {
  return folds?.[key] !== true
}

/** The Backlog tab's blocks: the address of a row's goal on the Goals part (`#advice/goals/G<n>`), or null. */
function goalPlace(goal) {
  return typeof goal === 'string' && GOAL_LINK_ID.test(goal) ? `#advice/goals/${goal}` : null
}
// coordinate:end

/** Fix first: the small chip that marks a board fix, in a lane's queue and on the Backlog tab. */
function fixChip() {
  const chip = el('span', 'fix-chip', 'fix')
  chip.title = 'A fix for the worker board: it goes first in its worker\'s queue'
  return chip
}

let coordinateFilter = 'all'
/** Focus 1: the goal the Backlog is narrowed to, from "See the steps behind this": `{ id, steps }`, or null. */
let coordinateGoal = null

/**
 * The person's choice on a new or refined task, the same in a Backlog row and in its window: "Add to queue" (`canAdd`)
 * on a refined task the ready list holds for their choice (`choice`) and they did not add yet; "Remove" (`canRemove`) on
 * their own (added, or pinned), in the queue (`inQueue`) or not.
 */
function queueChoice({ state = null, isAdded = false, pinned = null, inQueue = false, choice = false }) {
  const isOwn = isAdded || pinned !== null
  const canAdd = !inQueue && state === 'refined' && choice === true && !isAdded
  return { canAdd, canRemove: !canAdd && isOwn }
}

/**
 * Redesign Part 2 (2026-10-25): the board hands out every task; a pinned task's window says "Pinned to <worker>" with
 * Unpin and Move to. Not pinned: the person, 2026-10-30 ("we replaced pin to worker 1 option with add to queue. so also
 * change this in the popups"): "Add to queue" or "Remove" as its Backlog row has (`queueChoice`, `queueButton`), with
 * where it stands. Null for any other task, or with nothing to say.
 */
function pinPart(step, state) {
  if (step.status !== 'open' || typeof step.id !== 'string') return null
  const workers = (state.chats ?? []).filter(one => !one.isMain && !one.isLeftover).map(one => one.name)
  const pinned = step.item?.pinned ?? null
  if (pinned === null) {
    const one = (state.readyList?.ready ?? []).find(ready => ready.id === step.id)
    const hold = (state.readyList?.held ?? []).find(held => held.id === step.id) ?? null
    const isAdded = (step.item?.queuedBy ?? null) !== null || (one?.added ?? null) !== null
    const choice = queueChoice({ state: step.item?.state ?? null, isAdded, inQueue: one !== undefined, choice: hold?.choice })
    const button = queueButton({ step, pinned, ...choice })
    const where = one !== undefined ? 'In the queue: the first free worker takes it.'
      : choice.canAdd ? 'Not in the queue: it waits for your choice.' : hold?.why ?? ''
    if (button === null && where === '') return null
    const line = el('div', 'step-queue-line')
    if (button !== null) line.append(button, ' ')
    if (where !== '') line.append(el('span', 'muted', where))
    return line
  }
  // Pinned: Unpin, and Move to the other workers.
  const key = `pin:${step.id}`
  const line = el('div', 'step-queue-line')
  const pick = (label, others) => {
    const select = el('select')
    select.dataset.pinTarget = step.id
    select.setAttribute('aria-label', `${label}: ${step.id} ${step.title}`)
    for (const name of others) {
      const option = el('option', '', name)
      option.value = name
      select.append(option)
    }
    return select
  }
  const button = (label, data, title) => {
    const one = el('button', `step-queue${problems.has(key) ? ' is-error' : ''}`, sending.has(key) ? 'Pinning…' : problems.has(key) ? 'Try again' : label)
    one.type = 'button'
    one.dataset[data] = step.id
    one.disabled = sending.has(key)
    one.title = problems.get(key) ?? title
    one.setAttribute('aria-label', `${label}: ${step.id} ${step.title}`)
    return one
  }
  line.append(el('span', 'step-pinned', `Pinned to ${pinned}`), ' ', button('Unpin', 'unpinStep', 'Back on the list: the board gives it to the first free worker'))
  const others = workers.filter(name => name !== pinned)
  if (others.length > 0) line.append(' ', button('Move to', 'pinStep', 'Pin it to another worker'), pick('Move to', others))
  if (problems.has(key)) line.append(el('p', 'problem', problems.get(key)))
  return line
}

// stepedit:start
/**
 * B221: what the person is told before they close or delete a step that somebody has: a worker on it, or a queue it
 * waits in. Empty for a step nobody has. The person, 2026-10-14: "Add an item into the queue that I can delete or
 * close items from the backlog in the backlog tab".
 */
function stepEditWarning(step) {
  if (step.status === 'progress') return `${step.worker ?? 'A worker'} is working on this step now. `
  if (step.status === 'queued') return `This step is queued for ${step.worker ?? 'a worker'}. `
  return ''
}

/** B221: the question before a step is closed (ticked, kept in the file) or deleted (taken out with its lines). */
function stepEditQuestion(step, action) {
  const name = `${step.id} "${step.title}"`
  return action === 'close'
    ? `${stepEditWarning(step)}Close ${name}? It is ticked and stays in the backlog as history. A reason, if you want to give one:`
    : `${stepEditWarning(step)}Delete ${name} and the lines under it from the backlog? This cannot be undone on the board.`
}
// stepedit:end

/**
 * B221: "Close" and "Delete" for a step with an id: Close only while it is open. `isLong` gives the window's
 * wording, with what went wrong under the buttons. Null for a step without an id (the board cannot name it).
 */
function editPart(step, isLong) {
  if (typeof step.id !== 'string' || step.id === '') return null
  const key = `edit:${step.id}`
  const box = el(isLong ? 'div' : 'span', isLong ? 'step-edit-line' : 'step-edit')
  for (const [action, label] of [['close', 'Close'], ['delete', 'Delete']]) {
    if (action === 'close' && step.status === 'done') continue
    const button = el('button', `step-edit-button is-${action}`, sending.has(key) ? '…' : isLong ? `${label} task` : label)
    button.type = 'button'
    button.dataset.editStep = step.id
    button.dataset.editAction = action
    button.disabled = sending.has(key)
    button.title = action === 'close' ? 'Tick it in the backlog, as history' : 'Take it and its lines out of the backlog'
    button.setAttribute('aria-label', `${label}: ${step.id} ${step.title}`)
    box.append(button)
  }
  if (isLong && problems.has(key)) box.append(el('p', 'problem', problems.get(key)))
  if (!isLong && problems.has(key)) box.title = problems.get(key)
  return box
}

/** B221: the click on "Close" or "Delete": the question first, then the board writes the backlog. */
async function editStepClick(button) {
  const step = (board?.backlog ?? []).flatMap(activity => activity.steps).find(one => one.id === button.dataset.editStep)
  if (step === undefined) return
  const action = button.dataset.editAction
  let reason = ''
  if (action === 'close') {
    const given = window.prompt(stepEditQuestion(step, 'close'), '')
    if (given === null) return
    reason = given
  } else if (!window.confirm(stepEditQuestion(step, 'delete'))) {
    return
  }
  const key = `edit:${step.id}`
  sending.add(key)
  problems.delete(key)
  redrawNeeds()
  const problem = await sendBacklog({ action, step: step.id, reason })
  sending.delete(key)
  if (problem !== null) problems.set(key, `Not done: ${problem}`)
  await read()
}

// refine:start
/**
 * B233: what the Refine part of a step's window shows, worked out without the page. The person, 2026-10-14: "the goal
 * is to let AI clarify what the orginal problem is that we try to solve, if any, or what the goal is. Ask any
 * questions needed before we start picking it up. the UI must facilitate me being able to provide feedback to the AI
 * refining it. this information is stored inside the backlog item so it's not lost." `advisor` is the Advisor's
 * name, or null when the board has none. Null for a step that cannot be refined (no id, or finished).
 */
function refineView(step, advisor) {
  if (typeof step.id !== 'string' || step.status === 'done') return null
  const refined = step.refined ?? null
  const ask = step.refineAsk?.isOpen === true ? step.refineAsk : null
  const meta = refined === null ? '' : [`round ${refined.round}`, refined.by === null ? null : `by ${refined.by}`, refined.at].filter(Boolean).join(' · ')
  const open = refined === null ? [] : refined.questions.filter(one => one.answer === null)
  const isReady = refined?.ready === true
  return {
    refined,
    meta,
    isAccepted: refined?.accepted != null,
    open: open.length,
    // B293: the newer form (a summary, its goal or its size, or ready) is drawn as in the picture; the older one as before.
    isNewForm: refined !== null && (isReady || refined.summary !== '' || refined.partOf !== '' || refined.size !== ''),
    isReady,
    // While the Advisor works on it, nothing more is sent.
    working: ask === null ? null : { at: ask.at, round: ask.round, isDelivered: ask.state === 'delivered' },
    canAsk: advisor !== null && ask === null,
    // B293: "Take the advice", in place of "Accept as refined": while a question with advice is open.
    canTakeAdvice: advisor !== null && ask === null && !isReady && open.some(one => one.advice !== null),
    why: advisor === null ? 'The board has no Advisor to refine it.' : null,
  }
}

/**
 * B293: the answers "Take the advice" writes: for every open question the person's pick when they made one, else
 * the Advisor's advice; for an answered one only a new pick. `picks` are by the question's place (from 0);
 * `missing` are the numbers (from 1) of open questions with neither, which the person answers first.
 */
function adviceAnswers(refined, picks) {
  const answers = []
  const missing = []
  refined.questions.forEach((one, index) => {
    const pick = String(picks[index] ?? '').trim()
    if (pick !== '') answers.push({ index, answer: pick })
    else if (one.answer !== null) { /* answered already, and left as it is */ } else if (one.advice !== null) answers.push({ index, answer: one.advice })
    else missing.push(index + 1)
  })
  return { answers, missing }
}
// refine:end

/** B293: an element holding the given nodes. */
function holding(tag, className, ...children) {
  const node = el(tag, className)
  node.append(...children)
  return node
}

/**
 * B233: the Refine part of a step's window, left under its description; null when the step cannot be refined.
 * B293: in the newer form, while refining, a box as in the picture the person approved (of the two stages):
 * the summary, the picture, and one line per question with the advice and Yes / No; once ready, the step's
 * description itself (`is-ready`): the summary, the picture and what we build, with no box, no rounds and no questions.
 */
function refinePart(step, state, isItemShown = false) {
  const advisor = state.advisor?.name ?? null
  const view = refineView(step, advisor)
  const working = view?.working == null ? null
    : el('p', 'refine-working', `Asked at ${clock(view.working.at)}: ${advisor} ${view.working.isDelivered ? 'is refining it' : 'gets it when its chat takes it'}. It shows here once written.`)
  // A ready description stays, also once the step is finished; so does a finished step's summary, without its questions.
  const isDescribed = step.refined?.ready === true || (step.status === 'done' && hasNewForm(step.refined))
  // With the store's item shown, the description stands above already: only "refining again" is said here.
  if (isDescribed && isItemShown) return working === null ? null : holding('section', 'details-part refine', working)
  if (isDescribed) {
    const box = el('section', 'details-part refined is-ready')
    box.append(...refinedParts(step.refined))
    // "Refine again" asked: said here too, not only on the button.
    if (working !== null) box.append(working)
    return box
  }
  if (view === null) return null
  const box = el('section', 'details-part refine')
  const heading = el('h3', '', 'Refined')
  if (view.refined === null) {
    box.append(heading)
    heading.textContent = 'Refine'
    box.append(el('p', 'muted', `Not refined yet. ${advisor ?? 'The Advisor'} sums up what you get, with a picture, its goal and its size, and asks what it needs to know before it is picked up. Your answers are folded into one description under the task.`))
  } else {
    const { refined } = view
    // The older form keeps its heading with the round; the newer one shows no rounds.
    if (!view.isNewForm) {
      heading.append(el('small', '', `${view.meta}${view.isAccepted ? ' · accepted' : ''}`))
      box.append(heading)
    }
    // With the store's item shown, its Summary and picture stand above: not twice.
    box.append(...refinedParts(isItemShown ? { ...refined, summary: '', picture: null, pictureNote: '', build: [], effort: '' } : refined))
    if (refined.questions.length > 0) box.append(refineQuestions(step, refined, view))
    if (refined.feedback.length > 0) {
      box.append(el('span', 'refine-tag', 'Your feedback so far'), listOf(refined.feedback))
    }
    const feedback = el('textarea', 'refine-field')
    feedback.rows = view.isNewForm ? 1 : 2
    feedback.dataset.refineField = `${step.id}:feedback`
    feedback.placeholder = 'Feedback: anything the Advisor got wrong or missed…'
    feedback.value = drafts.get(`refine:${step.id}:feedback`) ?? ''
    feedback.setAttribute('aria-label', 'Feedback to the Advisor')
    if (!view.isNewForm) box.append(el('span', 'refine-tag', 'Feedback'))
    box.append(feedback)
  }
  if (working !== null) box.append(working)
  return box
}

/**
 * B293: the refine of a step in a worker's queue, to read: its description once ready, else what it says so far and
 * how many questions wait (answered in the step's window on the Backlog tab). Null when it says nothing.
 */
function refineToRead(refined) {
  const box = el('section', `details-part ${refined.ready ? 'refined is-ready' : 'refine'}`)
  box.append(...refinedParts(refined))
  const open = refined.ready ? 0 : refined.questions.filter(one => one.answer === null).length
  if (open > 0) box.append(el('p', 'muted', `${open} question${open === 1 ? '' : 's'} wait for your answer in the task's window on the Backlog tab.`))
  return box.children.length === 0 ? null : box
}

/** B293: the parts of a refine block that describe the step: summary, picture, problem and goal (the older form), what we build. */
function refinedParts(refined) {
  const parts = []
  if (refined.summary !== '') parts.push(holding('div', 'refined-summary', el('span', 'refine-tag', 'Summary'), el('p', '', refined.summary)))
  if (refined.picture !== null) parts.push(pictureRow(refined.picture.path, refined.picture.caption))
  else if (refined.pictureNote !== '') {
    parts.push(holding('div', 'refined-nopicture', el('span', 'refine-tag', 'Picture'), el('p', 'muted', `None: ${refined.pictureNote}`)))
  }
  if (refined.problem !== '') parts.push(el('span', 'refine-tag', 'Problem'), el('p', '', refined.problem))
  if (refined.goal !== '') parts.push(el('span', 'refine-tag', 'Goal'), el('p', '', refined.goal))
  if (refined.build.length > 0) {
    parts.push(holding('div', '', el('span', 'refine-tag', 'What we build'), buildList(refined.build)))
  }
  // Model per step: the model its worker runs on, "<sonnet or opus> · <reason>".
  if ((refined.model ?? '') !== '') parts.push(holding('div', 'refined-effort', el('span', 'refine-tag', 'Model'), el('p', '', refined.model)))
  // B468: the effort its worker runs at, "<level> · <reason>".
  if ((refined.effort ?? '') !== '') parts.push(holding('div', 'refined-effort', el('span', 'refine-tag', 'Effort'), el('p', '', refined.effort)))
  return parts
}

/**
 * B293: the questions, one line each: its number, the question, the advice (its reason on hover) and Yes / No, the
 * person's pick or answer pressed. A question without advice (the older form) keeps a field for the person's words.
 */
function refineQuestions(step, refined, view) {
  const box = el('div', 'refine-questions')
  box.append(el('span', 'refine-tag', `Questions · ${refined.questions.length}`))
  refined.questions.forEach((one, index) => {
    const key = `refine:${step.id}:${index}`
    if (one.advice === null) {
      const part = el('div', 'refine-question')
      part.append(el('span', 'refine-tag', `Question ${index + 1}`), el('p', '', one.text))
      if (one.answer !== null) part.append(el('p', 'refine-answer', `Your answer: ${one.answer}`))
      const field = el('textarea', 'refine-field')
      field.rows = 1
      field.dataset.refineField = `${step.id}:${index}`
      field.placeholder = one.answer === null ? 'Your answer…' : 'Change your answer…'
      field.value = drafts.get(key) ?? ''
      field.setAttribute('aria-label', `Answer to question ${index + 1}`)
      part.append(field)
      box.append(part)
      return
    }
    const line = el('div', `refine-q${one.answer === null ? '' : ' is-answered'}`)
    const advice = el('span', 'refine-advice', `advised: ${one.advice}`)
    if (one.why !== '') advice.title = one.why
    const pick = String(drafts.get(key) ?? one.answer ?? '').trim().toLowerCase()
    const choices = el('span', 'refine-picks')
    // What is written already: a pick taken back shows it again.
    choices.dataset.answer = String(one.answer ?? '').trim().toLowerCase()
    for (const value of ['yes', 'no']) {
      const button = el('button', 'refine-pick', value === 'yes' ? 'Yes' : 'No')
      button.type = 'button'
      button.dataset.refinePick = `${step.id}:${index}`
      button.dataset.value = value
      button.setAttribute('aria-pressed', String(pick === value))
      button.setAttribute('aria-label', `${value === 'yes' ? 'Yes' : 'No'} to question ${index + 1}`)
      button.disabled = view.working !== null
      choices.append(button)
    }
    // B462: the question itself first, its numbers and why muted after it, as an ask's title and context.
    const { question, rest } = splitAsk(one.text)
    const text = el('span', 'refine-text', question)
    if (rest !== '') text.append(' ', el('span', 'muted', rest))
    line.append(el('span', 'refine-n', String(index + 1)), text, advice, choices)
    // An answer in words of its own, not a yes or a no, shows under its question.
    if (one.answer !== null && !/^(yes|no)$/i.test(one.answer)) line.append(el('p', 'refine-answer', `Your answer: ${one.answer}`))
    box.append(line)
  })
  return box
}

/**
 * B233: the buttons of the Refine part, in the window's foot. B293: "Send answers" and "Take the advice" while it is
 * refined (in place of "Send answers · refine again" and "Accept as refined"), "Refine again" once it is ready.
 */
function refineButtons(step, state) {
  const view = refineView(step, state.advisor?.name ?? null)
  if (view === null) return null
  const key = `refine:${step.id}`
  const line = el('div', 'refine-line')
  const words = view.refined === null ? 'Refine' : view.isReady ? 'Refine again' : 'Send answers'
  const ask = el('button', `refine-button${view.isReady ? ' is-quiet' : ''}${problems.has(key) ? ' is-error' : ''}`, sending.has(key) ? 'Sending…' : words)
  ask.type = 'button'
  ask.dataset.refineStep = step.id
  ask.dataset.refineAction = 'ask'
  ask.disabled = sending.has(key) || !view.canAsk
  ask.title = view.why ?? (view.working !== null ? 'The Advisor is on it'
    : view.refined === null ? 'The Advisor sums it up and asks what it needs to know'
      : view.isReady ? 'The Advisor checks it again against the backlog and the goals'
        : 'Your answers and feedback are written under the step, then the Advisor folds them into the description')
  line.append(ask)
  if (view.refined !== null && !view.isReady && view.refined.questions.some(one => one.advice !== null)) {
    const advice = el('button', 'refine-advice-all', 'Take the advice')
    advice.type = 'button'
    advice.dataset.refineStep = step.id
    advice.dataset.refineAction = 'advice'
    advice.disabled = sending.has(key) || !view.canTakeAdvice
    advice.title = view.canTakeAdvice ? 'The advice becomes your answer for every open question you did not answer yourself' : view.why ?? 'No question is open'
    line.append(advice)
  }
  if (problems.has(key)) line.append(el('p', 'problem', problems.get(key)))
  return line
}

/**
 * B233: the click on "Refine", "Send answers" or "Refine again": the answers and feedback given are written under
 * the step first, then the Advisor is asked. B293: "Take the advice" writes the advice as the answer to every open
 * question the person did not answer, then asks the same way.
 */
async function refineClick(button) {
  const step = (board?.backlog ?? []).flatMap(activity => activity.steps).find(one => one.id === button.dataset.refineStep)
  const advisor = board?.advisor?.name ?? null
  if (step === undefined) return
  const key = `refine:${step.id}`
  const fields = [...drafts.keys()].filter(name => name.startsWith(`${key}:`))
  const picks = Object.fromEntries(fields.filter(name => /:\d+$/.test(name)).map(name => [Number(name.split(':').pop()), drafts.get(name)]))
  const feedback = drafts.get(`${key}:feedback`) ?? ''
  let answers = Object.entries(picks).map(([index, answer]) => ({ index: Number(index), answer })).filter(one => one.answer.trim() !== '')
  problems.delete(key)
  if (button.dataset.refineAction === 'advice') {
    const taken = adviceAnswers(step.refined, picks)
    if (taken.missing.length > 0) {
      problems.set(key, taken.missing.length === 1 ? `Question ${taken.missing[0]} has no advice: answer it first.` : `Questions ${taken.missing.join(' and ')} have no advice: answer them first.`)
      return redrawNeeds()
    }
    answers = taken.answers
  }
  sending.add(key)
  redrawNeeds()
  let problem = null
  if (answers.length > 0 || feedback.trim() !== '') problem = await sendBacklog({ action: 'refine-answer', step: step.id, answers, feedback })
  if (problem === null) {
    for (const name of fields) drafts.delete(name)
    sending.delete(key)
    return send({ to: advisor, command: 'refine', step: step.id }, key)
  }
  sending.delete(key)
  problems.set(key, `Not done: ${problem}`)
  await read()
}

$('details').addEventListener('click', event => {
  // B293: Yes or No to a question: kept as the person's pick until they send it; a second click takes it back to
  // what is written already, if anything (a written answer is changed, never taken away).
  const pick = event.target.closest('[data-refine-pick]')
  if (pick !== null && !pick.disabled) {
    const key = `refine:${pick.dataset.refinePick}`
    const written = pick.parentElement.dataset.answer ?? ''
    const isPressed = pick.getAttribute('aria-pressed') === 'true'
    const shown = isPressed ? written : pick.dataset.value
    if (shown === written) drafts.delete(key)
    else drafts.set(key, shown)
    for (const one of pick.parentElement.querySelectorAll('[data-refine-pick]')) one.setAttribute('aria-pressed', String(one.dataset.value === shown))
    return
  }
  const button = event.target.closest('[data-refine-step]')
  if (button !== null && !button.disabled) refineClick(button)
})

$('details').addEventListener('input', event => {
  const name = event.target.dataset?.refineField
  if (name !== undefined) drafts.set(`refine:${name}`, event.target.value)
})

function drawCoordinate(state) {
  const activities = state.backlog ?? []
  // B296: one line about the work store; its problems on hover.
  const store = storeLine(state.store ?? null)
  const storeBox = $('coordinate-store')
  storeBox.hidden = store === null
  if (store !== null) {
    storeBox.className = `coordinate-store is-${store.tone}`
    storeBox.textContent = store.text
    storeBox.title = store.problems.join('\n')
  }
  const find = $('coordinate-find').value
  const showDone = $('coordinate-done').checked
  const list = coordinateList(activities, { filter: coordinateFilter, find, showDone, goal: coordinateGoal?.steps ?? null })
  $('coordinate-count').textContent = `${list.counts.all} open step${list.counts.all === 1 ? '' : 's'}`
  fill($('coordinate-filters'), [...COORDINATE_FILTERS.map(([name, label]) => {
    const button = el('button', `choice${name === coordinateFilter ? ' is-chosen' : ''}`, `${label} `)
    button.type = 'button'
    button.dataset.filter = name
    button.append(el('small', '', String(list.counts[name])))
    return button
  }), coordinateGoalChip()])
  // The Backlog tab's blocks (2026-10-25): narrowed by a filter, the search or a goal, a block with nothing left is left out.
  const isNarrowed = coordinateFilter !== 'all' || find.trim() !== '' || coordinateGoal !== null
  const blocks = backlogBlocks(list, state.readyList ?? null, { showDone }).filter(block => !isNarrowed || block.rows.length > 0)
  const folds = blockFolds()
  // A block's head the keyboard was on keeps the focus when the list is drawn anew.
  const focused = $('coordinate-list').contains(document.activeElement) ? document.activeElement.dataset?.blockFold ?? null : null
  fill($('coordinate-list'), blocks.length > 0 ? blocks.map(block => drawBlock(block, !isBlockOpen(block.key, folds))) : [el('p', 'muted', activities.length === 0 ? 'The backlog could not be read.' : 'No task matches.')])
  if (focused !== null) $('coordinate-list').querySelector(`[data-block-fold="${focused}"]`)?.focus()
}

/** The Backlog tab's blocks: what an empty block says. */
const BLOCK_EMPTY = { progress: 'No task is under way.', queue: 'Nothing waits for a free worker.', refined: 'No refined task waits for your choice.', new: 'Every task is refined.', done: 'No finished task.' }

/**
 * The Backlog tab's blocks: one block, a section whose head folds it (kept in this browser), with its count and its
 * words, and its rows.
 */
function drawBlock(block, isFolded) {
  const box = el('section', `backlog-block is-${block.key}${isFolded ? ' is-folded' : ''}`)
  const head = el('h2')
  const fold = el('button', 'block-fold')
  fold.type = 'button'
  fold.dataset.blockFold = block.key
  fold.title = isFolded ? `Show ${block.title}` : `Fold ${block.title} away`
  fold.setAttribute('aria-expanded', String(!isFolded))
  fold.setAttribute('aria-controls', `block-${block.key}`)
  const arrow = el('span', 'block-arrow', isFolded ? '▸' : '▾')
  arrow.setAttribute('aria-hidden', 'true')
  fold.append(arrow, block.title, el('small', '', [String(block.rows.length), block.note].filter(Boolean).join(' · ')))
  head.append(fold)
  const body = el('div', 'block-body')
  body.id = `block-${block.key}`
  body.hidden = isFolded
  if (block.rows.length === 0) body.append(el('p', 'muted block-none', BLOCK_EMPTY[block.key] ?? 'None.'))
  for (const row of block.rows) body.append(blockLine(row, block.key))
  box.append(head, body)
  return box
}

/** The Backlog tab's blocks: a small quiet chip beside a title ("focus", "added by you"). */
function blockChip(words, tone, title) {
  const chip = el('span', `block-chip is-${tone}`, words)
  chip.title = title
  return chip
}

/**
 * The Backlog tab's blocks: a step's row. Its place in the queue, its id and title (with its chips; a click opens its
 * window), its goal as a link to the Goals part, for whom, its state or why it waits, and "Add to queue" or "Remove";
 * Close and Delete (B221) over its right end while the pointer or the keyboard is on it.
 */
function blockLine(row, key) {
  const { step } = row
  const line = el('div', `step-line block-line is-${key}`)
  const open = el('button', 'block-open')
  open.type = 'button'
  open.dataset.openStep = step.key
  open.title = [step.title, step.activity ?? null, 'Show the details'].filter(Boolean).join('\n')
  const title = el('span', 'block-title')
  if (row.isFix) title.append(fixChip(), ' ')
  if (row.isFocus === true) title.append(blockChip('focus', 'focus', 'A task of the focus goal: the board hands it out by itself'), ' ')
  if (row.isAdded) title.append(blockChip('added by you', 'you', 'You added it to the queue'), ' ')
  title.append(step.title)
  // B543: a step in review says what it waits for: its first check, its fix B<n>, the person's answer.
  // 2026-10-26: not when the state cell says where its check stands (the Advisor's queue, or checking it).
  if (typeof step.reviewWait === 'string' && checkStandWords(step.reviewStand) === null) title.append(' ', el('small', 'step-wait', `(${step.reviewWait})`))
  open.append(el('span', 'step-id', step.id ?? ''), title)
  const place = goalPlace(row.goal)
  let goal = el('span', 'block-goal', row.goal ?? '')
  if (place !== null) {
    goal = el('a', 'block-goal', row.goal)
    goal.href = place
    goal.dataset.place = place
    goal.title = `Open ${row.goal} on Goals`
  }
  const words = row.why ?? row.wait ?? row.note ?? ''
  const status = key === 'progress' ? el('span', `step-state is-${row.tone}`, row.state) : el('span', 'block-why', words)
  if (key !== 'progress' && words !== '') status.title = words
  const action = queueButton(row) ?? el('span', 'block-act')
  line.append(el('span', 'block-n', row.n === undefined ? '' : String(row.n)), open, goal, el('span', 'block-who', row.who ?? ''), status, action)
  const edit = editPart(step, false)
  if (edit !== null) {
    line.append(edit)
    if (action.tagName === 'BUTTON') line.classList.add('has-action')
  }
  return line
}

/**
 * The Backlog tab's blocks: "Add to queue" on a refined task held for the person's choice, "Remove" on the person's
 * own (added, or pinned in its window), through the work store at once (the work API's `add-to-queue` and
 * `remove-from-queue`, the person's only). Null for any other row.
 */
function queueButton(row) {
  const id = row.step.id
  if (typeof id !== 'string' || !(row.canAdd === true || row.canRemove === true)) return null
  const key = `queue:${id}`
  const isAdd = row.canAdd === true
  const label = isAdd ? 'Add to queue' : 'Remove'
  const button = el('button', `block-action${isAdd ? '' : ' is-quiet'}${problems.has(key) ? ' is-error' : ''}`, sending.has(key) ? (isAdd ? 'Adding…' : 'Removing…') : problems.has(key) ? 'Try again' : label)
  button.type = 'button'
  button.dataset[isAdd ? 'queueAdd' : 'queueRemove'] = id
  button.disabled = sending.has(key)
  button.title = problems.get(key) ?? (isAdd ? 'The first free worker takes it, after the focus goal\'s tasks'
    : row.pinned !== null && row.pinned !== undefined ? `Take it off the queue: your pin to ${row.pinned} goes too` : 'Take it off the queue: it waits for your choice again')
  button.setAttribute('aria-label', `${label}: ${id} ${row.step.title}`)
  return button
}

/** The Backlog tab's blocks: the click on "Add to queue" or "Remove". */
function queueClick(button) {
  const id = button.dataset.queueAdd ?? button.dataset.queueRemove
  if (typeof id !== 'string' || sending.has(`queue:${id}`)) return
  const isAdd = button.dataset.queueAdd !== undefined
  button.disabled = true
  button.textContent = isAdd ? 'Adding…' : 'Removing…'
  return sendWork({ action: isAdd ? 'add-to-queue' : 'remove-from-queue', id }, `queue:${id}`)
}

/**
 * The Backlog tab's blocks the person folded, kept in this browser: `{ queue: true }`; without storage, for as long as
 * the page is open.
 */
let blockFoldsHere = {}
function blockFolds() {
  try {
    const kept = JSON.parse(localStorage.getItem('backlog-blocks-folded') ?? 'null')
    if (kept !== null && typeof kept === 'object' && !Array.isArray(kept)) return kept
  } catch {
    // No storage, or what it held is not readable: the folds of this page.
  }
  return { ...blockFoldsHere }
}

/** Focus 1: the goal the list is narrowed to ("See the steps behind this"), with ✕ to show every step again; null without. */
function coordinateGoalChip() {
  if (coordinateGoal === null) return null
  const chip = el('button', 'choice is-chosen is-goal', `Tasks behind ${coordinateGoal.id} ✕`)
  chip.type = 'button'
  chip.dataset.goalClear = ''
  chip.title = 'Show every step again'
  return chip
}

$('coordinate-filters').addEventListener('click', event => {
  if (event.target.closest('[data-goal-clear]') !== null) {
    coordinateGoal = null
    if (board !== null) drawCoordinate(board)
    return
  }
  const button = event.target.closest('[data-filter]')
  if (button === null) return
  coordinateFilter = button.dataset.filter
  if (board !== null) drawCoordinate(board)
})
$('coordinate-find').addEventListener('input', () => { if (board !== null) drawCoordinate(board) })
$('coordinate-done').addEventListener('change', () => { if (board !== null) drawCoordinate(board) })
// A block's head folds or unfolds it; this browser keeps it. A step for the person opens its card, with the answer;
// any other step opens as the step it is.
$('coordinate-list').addEventListener('click', event => {
  const fold = event.target.closest('[data-block-fold]')
  if (fold !== null) {
    const folds = blockFolds()
    folds[fold.dataset.blockFold] = fold.getAttribute('aria-expanded') === 'true'
    blockFoldsHere = folds
    try {
      localStorage.setItem('backlog-blocks-folded', JSON.stringify(folds))
    } catch {
      // Kept for this page only.
    }
    if (board !== null) drawCoordinate(board)
    return
  }
  // A row's goal: to that goal on the Goals part (B507's way: Back returns).
  const place = event.target.closest('[data-place]')
  if (place !== null) {
    event.preventDefault()
    return goToPlace(place.dataset.place)
  }
  const queue = event.target.closest('[data-queue-add], [data-queue-remove]')
  if (queue !== null) return queueClick(queue)
  const edit = event.target.closest('[data-edit-step]')
  if (edit !== null) return editStepClick(edit)
  const row = event.target.closest('[data-open-step]')
  if (row === null || board === null) return
  const step = (board.backlog ?? []).flatMap(activity => activity.steps).find(one => one.key === row.dataset.openStep)
  if (step === undefined) return
  openDetails(step.needId !== null && everyNeed(board).some(need => need.id === step.needId) ? { need: step.needId } : { step: step.key })
})

// Design (B99): from an idea to a picture by Codex to a step on the backlog. The page reads `state.design` and
// writes through POST /api/design; the board's side (the job that runs Codex, what is kept, the request to the
// main chat) is B101. The page writes nothing into the backlog itself.

// design:start
/** What the server holds to, as `design.limits` names it; these stand in for a board that does not say. */
const DESIGN_LIMITS = { idea: 1500, change: 600, title: 160, description: 1200, requirement: 200, requirements: 12, references: 3, referenceBytes: 8 * 1024 * 1024 }
const limitsOf = design => ({ ...DESIGN_LIMITS, ...(design?.limits ?? {}) })
/** The kinds of picture the board takes as a reference. */
const REFERENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * B156: what a paste on the Design tab brings: `take`, the clipboard's picture to add as a reference; `problem`, a
 * line for the person; or `ignore`, text pasted into a text field, which stays text there. `items` are the
 * clipboard's entries (`kind`, `type`); `isTextField` says whether it was pasted into a field.
 */
function pastedReference(items, isTextField) {
  const all = Array.from(items ?? [])
  // Text copied from a document often brings a picture of itself along: in a field, the text is what was meant.
  if (isTextField && all.some(item => item?.type === 'text/plain')) return { ignore: true }
  const files = all.filter(item => item?.kind === 'file')
  const picture = files.find(item => typeof item.type === 'string' && item.type.startsWith('image/'))
  if (picture !== undefined) return REFERENCE_TYPES.includes(picture.type) ? { take: picture } : { problem: 'A reference is a PNG, JPEG or WebP picture.' }
  if (isTextField) return { ignore: true }
  return { problem: files.length > 0 ? 'Only a picture can be pasted as a reference.' : 'The clipboard holds no picture: copy one, or add one from disk.' }
}

/** "shop-screen", the folder's short name, as a name to read: "Shop screen". */
const ideaName = idea => {
  const words = String(idea.name ?? '').replace(/[-_]+/g, ' ').trim()
  return words === '' ? 'An idea' : words.charAt(0).toUpperCase() + words.slice(1)
}

/** The newest version of an idea that has a picture, or null. */
const newestDone = idea => idea.versions.findLast(version => version.state === 'done' && version.picture !== null) ?? null

/** What "Ideas so far" says of an idea, and in which tone. `main` is the main chat's name. */
function ideaBadge(idea, main = null) {
  const step = idea.sent?.step ?? null
  const worker = step?.worker ?? idea.sent?.worker ?? null
  if (step?.isDone === true) return { text: `Done · ${step.id}`, tone: 'good' }
  switch (idea.status) {
    case 'making': return { text: 'Picture being made', tone: 'busy' }
    case 'failed': return { text: 'Picture failed', tone: 'bad' }
    case 'look': return { text: 'Waiting for your look', tone: 'you' }
    case 'agreed': return { text: 'Agreed', tone: 'good' }
    case 'asked': return { text: `Asked of ${main ?? 'the main chat'}`, tone: 'plain' }
    case 'backlog': return { text: `On the backlog${step === null ? '' : ` · ${step.id}`}`, tone: 'plain' }
    case 'queued': return { text: `Queued${worker === null ? '' : ` for ${worker}`}${step === null ? '' : ` · ${step.id}`}`, tone: 'plain' }
    default: return { text: 'Unknown', tone: 'plain' }
  }
}

/** A length of time as a clock counts it: "0:32", "1:05". */
const counted = ms => `${Math.floor(Math.max(0, ms) / 60_000)}:${String(Math.floor((Math.max(0, ms) % 60_000) / 1000)).padStart(2, '0')}`

/**
 * What the three parts show for what the person chose: `chosen.idea` (null for a new idea) and `chosen.version`
 * (the version they look at; without one: the agreed one, else the newest with a picture, else the newest).
 * `form` says what part 3 is: `locked` until a picture is agreed, `open` to fill in, `sent` once the step was
 * asked for (an asking that did not arrive opens it again).
 */
function designView(design, chosen, now) {
  const busy = design?.busy ?? null
  const making = busy === null ? null : { idea: busy.idea, version: busy.version, line: `${counted(now - busy.since)} of about ${counted((design.seconds ?? 60) * 1000)}` }
  const canMake = design?.canMake === true && busy === null
  const idea = (design?.ideas ?? []).find(one => one.id === chosen.idea) ?? null
  // B368: a step needs no picture: with no idea chosen, part 3 is open for one of its own.
  if (idea === null) return { idea: null, version: null, making, canMake, canAgain: false, canAgree: false, canTakeBack: false, canRetry: false, form: design === null ? 'locked' : 'open' }
  const version = idea.versions.find(one => one.n === chosen.version)
    ?? idea.versions.find(one => one.n === idea.agreed) ?? newestDone(idea) ?? idea.versions.at(-1) ?? null
  const isLost = idea.sent !== null && (idea.sent.state === 'expired' || idea.sent.state === 'failed')
  const isSent = idea.sent !== null && !isLost
  const isDone = version !== null && version.state === 'done'
  return {
    idea,
    version,
    making,
    canMake,
    // Another version, while nothing is being made and the step was not asked for.
    canAgain: canMake && !isSent && isDone,
    // A picture that failed is tried again as it was asked.
    canRetry: canMake && !isSent && version !== null && version.state === 'failed',
    canAgree: !isSent && isDone && idea.agreed !== version.n,
    canTakeBack: !isSent && isDone && idea.agreed === version.n,
    // B379: an idea is as it was: part 3 opens once its picture is agreed. A step without a picture is a New idea's.
    form: isSent ? 'sent' : idea.agreed !== null ? 'open' : 'locked',
    isLost,
  }
}

/** "about 1 h", "45 min", "1 h 30", "90" as minutes: null for nothing typed, NaN for what is no time. */
function timeTyped(text) {
  const plain = String(text ?? '').trim().toLowerCase().replace(/^(about|around|~)\s*/, '')
  if (plain === '') return null
  const found = plain.match(/^(?:(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*(?:m|mins?|minutes?)?)?$/)
  if (found === null || (found[1] === undefined && found[2] === undefined)) return NaN
  const minutes = Math.round(Number((found[1] ?? '0').replace(',', '.')) * 60 + Number(found[2] ?? 0))
  return minutes > 0 && minutes <= 24 * 60 ? minutes : NaN
}

/** What "Make a picture" sends (`body`), or why it cannot be sent (`problem`). */
function makeBody(draft, design) {
  const limits = limitsOf(design)
  const text = draft.text.trim()
  if (text === '') return { problem: 'Type the idea first.' }
  if (text.length > limits.idea) return { problem: `The idea is too long: ${limits.idea} characters at most, it has ${text.length}.` }
  if (!(design?.kinds ?? []).some(kind => kind.id === draft.kind)) return { problem: 'Choose what it is about.' }
  if (draft.references.length > limits.references) return { problem: `At most ${limits.references} reference pictures.` }
  return { body: { action: 'make', kind: draft.kind, text, references: [...draft.references] } }
}

/**
 * What "Try again" sends for a picture that was not made: the same change again, said of the newest picture there
 * is; with no picture yet there is nothing to change, and the idea is simply tried again.
 */
function retryBody(idea, version) {
  const change = (version.change ?? '').trim()
  return { body: change === '' ? { action: 'again', idea: idea.id } : { action: 'again', idea: idea.id, change } }
}

/** What "Make it again" sends for the version the person looks at, or why not. */
function againBody(idea, version, change, design) {
  const limits = limitsOf(design)
  const words = change.trim()
  if (words === '') return { problem: 'Say what should change.' }
  if (words.length > limits.change) return { problem: `That is too long: ${limits.change} characters at most.` }
  return { body: { action: 'again', idea: idea.id, change: words, from: version.n } }
}

/** What "Put on the backlog" (`where: 'backlog'`) and "Put on the list" (`'queue'`) send, or why not. */
function sendBody(idea, form, where, design) {
  const limits = limitsOf(design)
  const title = form.title.trim()
  const description = form.description.trim()
  const requirements = form.requirements.map(line => line.trim()).filter(line => line !== '')
  const minutes = timeTyped(form.time)
  if (title === '') return { problem: 'Give it a title.' }
  if (title.length > limits.title) return { problem: `The title is too long: ${limits.title} characters at most.` }
  if (description.length > limits.description) return { problem: `The description is too long: ${limits.description} characters at most.` }
  if (requirements.length > limits.requirements) return { problem: `At most ${limits.requirements} requirements.` }
  if (requirements.some(line => line.length > limits.requirement)) return { problem: `A requirement is too long: ${limits.requirement} characters at most.` }
  if (Number.isNaN(minutes)) return { problem: 'I cannot read that time. Write it like "45 min" or "1 h 30".' }
  const body = { action: 'send', where, title, description, requirements, minutes }
  // B368: without an idea the step goes on its own, with no picture.
  return { body: idea === null ? body : { action: 'send', idea: idea.id, ...body } }
}

/** B368: what part 3 says after a step without an idea was sent: that it was sent and where it goes, not more. */
function bareSentWords(sent, main = null) {
  const who = main ?? 'the main chat'
  const what = sent.where === 'queue' ? 'put on the list for a worker' : 'put on the backlog'
  return `Sent: you asked ${who} to have "${sent.title}" ${what}. It shows on the backlog once ${who} wrote it.`
}

/** B368: the empty form of a step asked without an idea. */
function blankForm() {
  return { title: '', description: '', requirements: [''], time: '' }
}

/** The form an agreed idea starts with: a title from the idea's first line, the idea as the description. */
function firstForm(idea) {
  const words = String(idea.text ?? '').trim()
  const first = words.split('\n')[0]
  const title = first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first
  return { title: title.charAt(0).toUpperCase() + title.slice(1), description: words, requirements: [''], time: '' }
}

/** What to say when the board's own reference pictures for a kind of idea are not there: the picture may fit the game less. */
function missingOf(design, kind) {
  const missing = (design?.kinds ?? []).find(one => one.id === kind)?.missing ?? []
  return missing.length === 0 ? '' : ` The board misses ${missing.length === 1 ? 'a reference picture' : `${missing.length} reference pictures`} for this kind, so the picture may fit the game less.`
}

/** Where the asking for the step is, in words. `main` is the main chat's name. */
function sentWords(sent, main = null) {
  const who = main ?? 'the main chat'
  const what = sent.where === 'queue' ? 'put on the list for a worker' : 'put on the backlog'
  const where = {
    waiting: `waits for ${who} to take it`,
    taken: `handed to ${who}, which writes the step when it is idle`,
    delivered: `typed into ${who}'s chat`,
    expired: `did not reach ${who}`,
    failed: `did not reach ${who}`,
  }[sent.state] ?? `waits for ${who} to take it`
  const step = sent.step ?? null
  const lines = [`You asked ${who} to have "${sent.title}" ${what}: ${where}.`]
  if (step !== null) lines.push(`It is step ${step.id} on the backlog${step.worker === null ? '' : `, for ${step.worker}`}${step.isDone ? ', and it is done' : ''}.`)
  return lines
}
// design:end

// providers:start
/**
 * T9.3 part 1: the Design tab's part "Asset providers", one line per kind of asset in the order the board sends
 * them (`state.providers`): the kind, its provider, and "works" or why it does not. Only a provider that does not
 * work is in the attention tone; the rest is quiet. A board that sends none (an older server, the demo) shows none.
 */
function providerLines(providers) {
  return (Array.isArray(providers) ? providers : []).map(one => ({
    kind: one.kind,
    provider: one.provider ?? 'none',
    text: one.ok === true ? 'works' : one.why || 'does not work',
    tone: one.ok === true ? 'quiet' : 'attention',
  }))
}
// providers:end

/** What the person chose and typed on the Design tab; a redraw must not undo it. */
const designChosen = { idea: null, version: null }
const designDraft = { text: '', kind: null, references: [] }
const designForms = new Map()
const designChanges = new Map()
const designProblems = { make: null, picture: null, form: null }
let isDesignSending = false
let designFormOf = null
/** B368: the last step asked without an idea (where, worker, title), said under part 3 until the next one is typed. */
let designBareSent = null
let isDropAsked = false

const designNow = () => (board === null ? null : board.design ?? null)
const designLook = () => designView(designNow(), designChosen, Date.now())

/** One writing call to the board's Design side. Answers what the server said, or sets the part's problem. */
async function designCall(body, part) {
  isDesignSending = true
  designProblems[part] = null
  drawDesign()
  let answer = null
  try {
    const got = await fetch('/api/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
      body: JSON.stringify(body),
    })
    if (got.ok) answer = await got.json().catch(() => ({}))
    else designProblems[part] = `Not done: ${(await got.text()).trim() || `refused (${got.status})`}`
  } catch {
    designProblems[part] = 'Not done: the board\'s server does not answer'
  }
  isDesignSending = false
  await read()
  return answer
}

/** A picture in a box that is no button of its own: a version to choose, an idea in the strip. */
function designThumb(path) {
  const image = el('img')
  image.alt = ''
  if (path !== null) pictureUrl(path).then(url => { if (url !== null) image.src = url })
  return image
}

function drawDesignNew(design, view) {
  once('design-kinds', [design?.kinds ?? [], designDraft.kind], () => {
    fill($('design-kinds'), (design?.kinds ?? []).map(kind => {
      const button = el('button', `choice${designDraft.kind === kind.id ? ' is-chosen' : ''}`, kind.name)
      button.type = 'button'
      button.dataset.kind = kind.id
      button.setAttribute('aria-pressed', String(designDraft.kind === kind.id))
      return button
    }))
  })
  const mostReferences = limitsOf(design).references
  once('design-references', [[...designDraft.references], mostReferences], () => {
    const add = el('button', 'design-add-reference', 'Add a reference picture (optional), or paste one with Ctrl+V')
    add.type = 'button'
    add.dataset.addReference = ''
    // No more than the board takes: the box to add one goes when they are there.
    fill($('design-references'), [...(designDraft.references.length < mostReferences ? [add] : []), ...designDraft.references.map((path, place) => {
      const frame = el('div', 'design-reference')
      const remove = el('button', 'icon-button', '✕')
      remove.type = 'button'
      remove.dataset.removeReference = String(place)
      remove.title = 'Leave this picture out'
      remove.setAttribute('aria-label', 'Leave this picture out')
      frame.append(picture(path, 'Reference'), remove)
      return frame
    })])
  })
  $('design-text').maxLength = limitsOf(design).idea
  $('design-text').disabled = design === null
  $('design-make').disabled = !view.canMake || isDesignSending
  $('design-hint').textContent = design === null ? ''
    : design.canMake !== true ? design.why ?? 'This board cannot make pictures.'
      : view.making !== null ? `Codex is making a picture: ${view.making.line}. One at a time.`
        : `Codex makes it. It takes about a minute.${missingOf(design, designDraft.kind)}`
  $('design-make-problem').hidden = designProblems.make === null
  $('design-make-problem').textContent = designProblems.make ?? ''
}

function drawDesignPicture(design, view, main) {
  const { idea, version } = view
  // The counting time redraws the stage only of the idea whose picture is being made.
  const counting = view.making !== null && view.making.idea === idea?.id ? view.making.line : null
  once('design-stage', [idea?.id ?? null, version, counting, idea?.text ?? null], () => {
    const stage = $('design-stage')
    if (idea === null) return fill(stage, [el('p', 'muted design-empty', 'Your picture shows here. Type an idea on the left, or pick one of your ideas below.')])
    const parts = [el('p', 'design-idea', idea.text)]
    if (version === null || version.state === 'making') {
      const wait = el('div', 'design-making')
      wait.append(el('span', 'design-spinner'), el('p', '', `Codex is making picture ${version?.n ?? 1}`), el('p', 'muted', counting ?? 'It takes about a minute.'))
      parts.push(wait)
    } else if (version.state === 'failed') {
      const failed = el('div', 'design-making is-failed')
      failed.append(el('p', '', `Picture ${version.n} was not made.`), el('p', 'muted', version.why ?? 'The board gave no reason.'))
      parts.push(failed)
    } else {
      const caption = [`Version ${version.n}`, clock(version.at), version.change === null ? null : `changed: ${version.change}`].filter(Boolean).join(' · ')
      const figure = el('figure', 'design-figure')
      figure.append(picture(version.picture, `${ideaName(idea)}, version ${version.n}`), el('figcaption', 'muted', caption))
      parts.push(figure)
    }
    fill(stage, parts)
  })
  once('design-versions', [idea?.id ?? null, idea?.versions ?? [], version?.n ?? null, idea?.agreed ?? null], () => {
    fill($('design-versions'), (idea?.versions ?? []).map(one => {
      const button = el('button', `design-version${one.n === version?.n ? ' is-chosen' : ''}${one.state === 'failed' ? ' is-failed' : ''}`)
      button.type = 'button'
      button.dataset.version = String(one.n)
      button.title = `Version ${one.n}${one.change === null ? '' : `: ${one.change}`}${one.n === idea.agreed ? ' (the one you agreed to)' : ''}`
      button.append(el('span', 'design-version-number', `${one.n}${one.n === idea.agreed ? ' ✓' : ''}`), one.state === 'done' ? designThumb(one.picture) : el('small', 'muted', one.state === 'failed' ? 'failed' : 'being made'))
      return button
    }))
  })
  const change = $('design-change')
  change.maxLength = limitsOf(design).change
  change.disabled = !view.canAgain
  $('design-again').disabled = !(view.canAgain || view.canRetry) || isDesignSending
  $('design-again').textContent = view.canRetry ? 'Try again' : 'Make it again'
  $('design-agree').disabled = !(view.canAgree || view.canTakeBack) || isDesignSending
  $('design-agree').textContent = view.canTakeBack ? 'Agreed · take it back' : 'I agree'
  $('design-agree').classList.toggle('is-quiet', view.canTakeBack)
  $('design-agree').classList.toggle('is-approve', !view.canTakeBack)
  $('design-drop').hidden = idea === null
  $('design-drop').textContent = isDropAsked ? 'Really drop it? Click again' : 'Drop this idea'
  $('design-picture-problem').hidden = designProblems.picture === null
  $('design-picture-problem').textContent = designProblems.picture ?? ''
}

/** The lines of the requirements, each an input with a cross. Drawn anew only when lines come or go. */
function drawRequirements(form, isLocked) {
  fill($('design-requirements'), form.requirements.map((line, place) => {
    const row = el('div', 'design-requirement')
    const input = el('input')
    input.type = 'text'
    input.value = line
    input.dataset.requirement = String(place)
    input.maxLength = limitsOf(designNow()).requirement
    input.disabled = isLocked
    input.setAttribute('aria-label', `Requirement ${place + 1}`)
    const remove = el('button', 'icon-button', '✕')
    remove.type = 'button'
    remove.dataset.removeRequirement = String(place)
    remove.title = 'Take this line out'
    remove.setAttribute('aria-label', `Take requirement ${place + 1} out`)
    remove.disabled = isLocked
    row.append(input, remove)
    return row
  }))
}

function drawDesignForm(design, view, main) {
  const { idea } = view
  const isOpen = view.form === 'open'
  // The fields show the form of the idea that is chosen: its own draft, kept while the page is open.
  // B368: with no idea chosen it is a step of its own, without a picture, kept under no id.
  const key = idea?.id ?? null
  const form = view.form === 'locked' ? null : designForms.get(key) ?? (idea === null ? blankForm() : firstForm(idea))
  if (form !== null && isOpen && !designForms.has(key)) designForms.set(key, form)
  const shown = `${idea?.id ?? ''}:${view.form}`
  if (designFormOf !== shown) {
    designFormOf = shown
    $('design-title').value = form === null || view.form === 'locked' ? '' : idea?.sent?.title ?? form.title
    $('design-description').value = form === null || view.form === 'locked' ? '' : form.description
    $('design-time').value = form === null || view.form === 'locked' ? '' : form.time
    drawRequirements(form === null || view.form === 'locked' ? { requirements: [''] } : form, !isOpen)
  }
  // While a step is being asked for the fields wait too: what is typed then would be emptied with the form.
  $('design-fields').disabled = !isOpen || isDesignSending
  // Once the step was asked for, what was asked stands in its place.
  $('design-fields').hidden = view.form === 'sent'
  $('design-title').maxLength = limitsOf(design).title
  $('design-description').maxLength = limitsOf(design).description
  $('design-add-line').disabled = !isOpen || (form !== null && form.requirements.length >= limitsOf(design).requirements)
  const cannotSend = design?.canSend === false
  for (const id of ['design-backlog', 'design-queue']) $(id).disabled = !isOpen || isDesignSending || cannotSend
  $('design-agreed').hidden = idea === null || idea.agreed === null
  $('design-form-note').textContent = view.form === 'locked'
    ? (idea === null ? '' : 'Agree with a picture of this idea first: "I agree" under it. For a step without a picture, choose New idea.')
    : view.form === 'open' && cannotSend ? design.whyNot ?? 'This board cannot ask the main chat for the step.'
      : view.form === 'open' && view.isLost ? 'Your asking did not arrive. Send it again.'
        // B368: the step of its own that was just asked for; the form is empty again for the next.
        // Its way to the main chat is not followed here: the note says only that it was sent, and where it goes.
        : idea === null && designBareSent !== null ? bareSentWords(designBareSent, main)
          : idea === null ? 'A picture is optional: fill this in for a step without one, or make a picture first.' : ''
  $('design-form-note').hidden = $('design-form-note').textContent === ''
  const sent = $('design-sent')
  sent.hidden = view.form !== 'sent'
  once('design-sent', view.form === 'sent' ? [idea.sent, main] : null, () => {
    fill(sent, view.form === 'sent' ? [el('b', '', `Asked at ${clock(idea.sent.at)}`), ...sentWords(idea.sent, main).map(line => el('p', '', line))] : [])
  })
  $('design-form-problem').hidden = designProblems.form === null
  $('design-form-problem').textContent = designProblems.form ?? ''
}

function drawDesignStrip(design, view, main) {
  once('design-strip', [design?.ideas ?? null, designChosen.idea, main], () => {
    const fresh = el('button', `design-card is-new${designChosen.idea === null ? ' is-chosen' : ''}`)
    fresh.type = 'button'
    fresh.dataset.idea = ''
    fresh.append(el('span', 'design-plus', '+'), el('b', '', 'New idea'))
    const cards = (design?.ideas ?? []).map(idea => {
      const card = el('button', `design-card${idea.id === designChosen.idea ? ' is-chosen' : ''}`)
      card.type = 'button'
      card.dataset.idea = idea.id
      card.title = idea.text
      const badge = ideaBadge(idea, main)
      const words = el('span', 'design-card-words')
      words.append(el('b', '', ideaName(idea)), el('span', `design-badge is-${badge.tone}`, badge.text))
      card.append(designThumb(newestDone(idea)?.picture ?? null), words)
      return card
    })
    fill($('design-strip'), [fresh, ...cards])
  })
}

/** T9.3 part 1: "Asset providers" under the ideas: hidden while the board sends no providers. */
function drawProviders() {
  const lines = providerLines(board?.providers)
  $('design-providers').hidden = lines.length === 0
  once('design-providers', lines, () => {
    fill($('design-provider-list'), lines.map(line => {
      const row = el('li', 'provider-line')
      row.append(el('span', 'provider-kind', line.kind), el('span', 'provider-name', line.provider), el('span', `provider-state is-${line.tone}`, line.text))
      return row
    }))
  })
}

/** The Design tab, from the board's state and what the person chose. Typed text is never drawn over. */
function drawDesign() {
  const design = designNow()
  const main = board?.restart?.main ?? null
  // An idea that is gone (dropped, or the board started anew without it) is no longer chosen.
  if (designChosen.idea !== null && !(design?.ideas ?? []).some(idea => idea.id === designChosen.idea)) Object.assign(designChosen, { idea: null, version: null })
  const view = designLook()
  const note = $('design-note')
  note.hidden = design !== null
  note.textContent = design === null ? 'This board\'s server has no Design part yet. Once that part is in, start the board anew and this tab works.' : ''
  drawDesignNew(design, view)
  drawDesignPicture(design, view, main)
  drawDesignForm(design, view, main)
  drawDesignStrip(design, view, main)
  drawProviders()
}

// While a picture is being made its time counts on, also between two readings of the state.
setInterval(() => {
  if (!$('view-design').hidden && (designNow()?.busy ?? null) !== null) drawDesign()
}, 1000)

$('design-text').addEventListener('input', () => { designDraft.text = $('design-text').value })
$('design-change').addEventListener('input', () => { if (designChosen.idea !== null) designChanges.set(designChosen.idea, $('design-change').value) })

$('design-kinds').addEventListener('click', event => {
  const button = event.target.closest('[data-kind]')
  if (button === null) return
  designDraft.kind = button.dataset.kind
  designProblems.make = null
  drawDesign()
})

$('design-references').addEventListener('click', event => {
  if (event.target.closest('[data-add-reference]') !== null) return $('design-file').click()
  const remove = event.target.closest('[data-remove-reference]')
  if (remove === null) return
  designDraft.references.splice(Number(remove.dataset.removeReference), 1)
  drawDesign()
})

// A reference picture of the person's own, picked from disk or pasted, goes to the board, which answers where it keeps it.
// The ones still on their way count too, so two quick pastes do not get past the limit.
let referencesOnTheWay = 0
async function addReference(file) {
  const limits = limitsOf(designNow())
  if (!REFERENCE_TYPES.includes(file.type)) designProblems.make = 'A reference is a PNG, JPEG or WebP picture.'
  else if (file.size > limits.referenceBytes) designProblems.make = `That picture is too large: ${Math.floor(limits.referenceBytes / (1024 * 1024))} MB at most.`
  else if (designDraft.references.length + referencesOnTheWay >= limits.references) designProblems.make = `At most ${limits.references} reference pictures.`
  else {
    designProblems.make = null
    referencesOnTheWay += 1
    try {
      const got = await fetch('/api/design/reference', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Board-Token': TOKEN }, body: file })
      if (got.ok) designDraft.references.push((await got.json()).path)
      else designProblems.make = `The picture was not taken: ${(await got.text()).trim() || `refused (${got.status})`}`
    } catch {
      designProblems.make = 'The picture was not taken: the board\'s server does not answer'
    } finally {
      referencesOnTheWay -= 1
    }
  }
  drawDesign()
}

$('design-file').addEventListener('change', () => {
  const file = $('design-file').files[0]
  $('design-file').value = ''
  if (file !== undefined) addReference(file)
})

// B156: Ctrl+V on the Design tab takes the picture on the clipboard as a reference, the same as one picked from disk.
// Text pasted into a field stays text.
document.addEventListener('paste', event => {
  // A window open over the tab has fields of its own: a paste there is not for the new idea.
  if ($('view-design').hidden || document.querySelector('dialog[open]') !== null) return
  const isTextField = event.target instanceof Element && event.target.closest('textarea, input, [contenteditable]') !== null
  const pasted = pastedReference(event.clipboardData?.items, isTextField)
  if (pasted.ignore === true) return
  event.preventDefault()
  const file = pasted.take?.getAsFile() ?? null
  if (file !== null) return addReference(file)
  designProblems.make = pasted.problem ?? 'The clipboard holds no picture: copy one, or add one from disk.'
  drawDesign()
})

$('design-make').addEventListener('click', async () => {
  const made = makeBody(designDraft, designNow())
  if (made.problem !== undefined) {
    designProblems.make = made.problem
    return drawDesign()
  }
  const answer = await designCall(made.body, 'make')
  if (answer === null) return
  // The new idea is the one to look at; the box is free for the next.
  const id = typeof answer.idea === 'string' ? answer.idea : answer.idea?.id ?? null
  Object.assign(designChosen, { idea: id, version: null })
  Object.assign(designDraft, { text: '', references: [] })
  $('design-text').value = ''
  drawDesign()
})

$('design-versions').addEventListener('click', event => {
  const button = event.target.closest('[data-version]')
  if (button === null) return
  designChosen.version = Number(button.dataset.version)
  drawDesign()
})

$('design-again').addEventListener('click', async () => {
  const view = designLook()
  if (view.idea === null || view.version === null) return
  // A picture that failed is asked for again as it was; any other is changed by what the person typed.
  const again = view.canRetry ? retryBody(view.idea, view.version) : againBody(view.idea, view.version, $('design-change').value, designNow())
  if (again.problem !== undefined) {
    designProblems.picture = again.problem
    return drawDesign()
  }
  const id = view.idea.id
  const answer = await designCall(again.body, 'picture')
  if (answer === null) return
  designChanges.delete(id)
  $('design-change').value = ''
  designChosen.version = typeof answer.version === 'number' ? answer.version : answer.version?.n ?? null
  drawDesign()
})

$('design-change').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) $('design-again').click()
})

$('design-agree').addEventListener('click', () => {
  const view = designLook()
  if (view.idea === null || view.version === null) return
  designCall({ action: 'agree', idea: view.idea.id, version: view.canTakeBack ? null : view.version.n }, 'picture')
})

// Dropping takes two clicks: the first asks.
$('design-drop').addEventListener('click', async () => {
  if (designChosen.idea === null) return
  if (!isDropAsked) {
    isDropAsked = true
    return drawDesign()
  }
  isDropAsked = false
  const id = designChosen.idea
  if (await designCall({ action: 'drop', idea: id }, 'picture') === null) return
  designForms.delete(id)
  designChanges.delete(id)
})
$('design-drop').addEventListener('blur', () => {
  isDropAsked = false
  drawDesign()
})

$('design-strip').addEventListener('click', event => {
  const card = event.target.closest('[data-idea]')
  if (card === null) return
  Object.assign(designChosen, { idea: card.dataset.idea === '' ? null : card.dataset.idea, version: null })
  for (const part of Object.keys(designProblems)) designProblems[part] = null
  isDropAsked = false
  $('design-change').value = designChanges.get(designChosen.idea) ?? ''
  drawDesign()
  if (designChosen.idea === null) $('design-text').focus()
})

/** The form of the chosen idea, as the fields hold it now. */
function designForm() {
  const form = designForms.get(designChosen.idea)
  if (form === undefined) return null
  Object.assign(form, { title: $('design-title').value, description: $('design-description').value, time: $('design-time').value })
  for (const input of $('design-requirements').querySelectorAll('[data-requirement]')) form.requirements[Number(input.dataset.requirement)] = input.value
  return form
}

$('design-fields').addEventListener('input', () => {
  designForm()
  if (designChosen.idea === null && designBareSent !== null) {
    designBareSent = null
    drawDesign()
  }
})
$('design-fields').addEventListener('change', designForm)

$('design-add-line').addEventListener('click', () => {
  const form = designForm()
  if (form === null) return
  form.requirements.push('')
  drawRequirements(form, false)
  $('design-requirements').querySelector(`[data-requirement="${form.requirements.length - 1}"]`).focus()
  drawDesign()
})

$('design-requirements').addEventListener('click', event => {
  const remove = event.target.closest('[data-remove-requirement]')
  const form = remove === null ? null : designForm()
  if (form === null) return
  form.requirements.splice(Number(remove.dataset.removeRequirement), 1)
  if (form.requirements.length === 0) form.requirements.push('')
  drawRequirements(form, false)
  drawDesign()
})

// Enter in a requirement goes on to a new line, as in a list.
$('design-requirements').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing && event.target.matches('[data-requirement]') && !$('design-add-line').disabled) $('design-add-line').click()
})

for (const [id, where] of [['design-backlog', 'backlog'], ['design-queue', 'queue']]) {
  $(id).addEventListener('click', () => {
    const view = designLook()
    const form = designForm()
    if (form === null || view.form !== 'open') return
    const sent = sendBody(view.idea, form, where, designNow())
    if (sent.problem !== undefined) {
      designProblems.form = sent.problem
      return drawDesign()
    }
    designCall(sent.body, 'form').then(answer => {
      // B368: a step without an idea leaves no idea to show it: the form empties and the note says it was asked.
      if (answer === null || view.idea !== null) return
      designBareSent = { where, title: sent.body.title }
      designForms.delete(null)
      designFormOf = null
      drawDesign()
    })
  })
}

// Tabs

/** The Advisor tab's address: the map's with its focus when the Goals part is open. */
function adviceAddress() { return $('view-advice').dataset.pane === 'goals' ? goalAddress(goalsFocus) : '#advice' }

function show(tab) {
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('is-active', button.dataset.tab === tab)
  $('view-overview').hidden = tab !== 'overview'
  $('view-advice').hidden = tab !== 'advice'
  $('view-coordinate').hidden = tab !== 'coordinate'
  $('view-design').hidden = tab !== 'design'
  $('view-vision').hidden = tab !== 'vision'
  if ($('view-spending')) $('view-spending').hidden = tab !== 'spending'
  // The address says which tab is open, so a reload stays on it. A link to a step's details is left as it is.
  // B149: so is a worker's link to a picture or to the game, until it is followed.
  if (!['#details=', '#task=', '#picture=', '#play=', '#demo='].some(start => location.hash.startsWith(start))) {
    const address = tab === 'overview' ? location.pathname : tab === 'coordinate' ? backlogAddress() : tab === 'advice' ? adviceAddress() : `#${tab}`
    // B255: leaving the goal map for another tab keeps its place in the browser's history: Back returns to the goal.
    if (goalFocusOf(location.hash) !== undefined && tab !== 'advice') history.pushState(null, '', address)
    else history.replaceState(null, '', address)
  }
  if (tab === 'advice') $('messages').scrollTop = $('messages').scrollHeight
  if (tab === 'coordinate') refreshDoneDay(true)
}

for (const button of document.querySelectorAll('.tab')) button.addEventListener('click', () => show(button.dataset.tab))

// B207: on a phone the timeline and the folders are folded away under the workers; this button shows them.
$('phone-more').addEventListener('click', () => {
  const shows = $('view-overview').classList.toggle('shows-more')
  $('phone-more').setAttribute('aria-expanded', String(shows))
  $('phone-more').textContent = shows ? 'Hide the timeline and folders' : 'Show the timeline and folders'
})

// Reading and sending

function draw(state) {
  board = state
  restoreKept()
  window.BoardSpending?.draw(state)
  drawTop(state)
  drawUpdate(state)
  drawAppNote(state)
  drawModNote(state)
  drawStoreNote(state)
  drawSetAsideNote(state)
  drawLoopsNote(state)
  drawCpu(state)
  drawMainGame(state)
  drawLimits(state)
  drawRestart(state)
  drawLanes(state)
  drawSupervisor(state)
  drawStrips(state)
  drawReadyList(state)
  drawToday(state)
  needsOnce(state)
  // The Backlog tab's blocks: also when an add to the queue or a remove is on its way or was refused.
  const queueing = [[...sending].filter(key => key.startsWith('queue:')), [...problems].filter(([key]) => key.startsWith('queue:'))]
  // The Backlog tab's blocks: the ready list too, which makes the Queue and holds the Refined ones.
  once('coordinate', [state.backlog ?? null, state.readyList ?? null, queueing], () => drawCoordinate(state))
  // B155: today's times name no day, so the list is drawn anew when the day changes too.
  once('finished', [state.finished ?? null, state.taskTimes?.byStep ?? null, new Date(state.readAt).toDateString()], () => drawFinished(state))
  // B579: the day of Completed by day, read anew with the page's own refresh.
  refreshDoneDay()
  drawDetails(state)
  openFromAddress(state)
  // B129: the project's own name from the settings, on the page and in the tab.
  once('name', state.name ?? '', () => {
    $('project-name').textContent = state.name || 'Worker board'
    document.title = state.name ? `${state.name} · Worker board` : 'Worker board'
  })
  once('advice', [state.advice, state.gamePlan ?? null], () => drawAdvice(state))
  // B195: the way to the next milestone, also when an answer to its recommendation is on its way or refused.
  once('way', [state.milestone ?? null, state.goalsFile ?? null, state.workers?.main ?? null, state.goalsEdit?.canWrite ?? null, state.advisor?.name ?? null, sending.has('recommend'), problems.get('recommend') ?? null, state.advisor?.roundRuns ?? null, sending.has('recheck'), problems.get('recheck') ?? null], () => drawWay(state))
  once('advice-suggestions', [state.suggestions ?? [], state.rounds?.group ?? null], () => drawSuggestions(state))
  // B286: the steps by where their refine stands, drawn anew only when the list changes.
  const refining = refineGroups(state.backlog)
  once('refine-list', refining, () => drawRefineList(refining))
  // B255: the goal map's outline, when the map or the zoom changes.
  once('goals', goalsData(state), () => drawGoals(state))
  // B383: the right panel of the Goals page.
  once('goalsteps', goalStepsData(state), () => drawGoalSteps(state))
  // B259: the brainstorms, when one changes or what the person does on the part.
  once('brainstorm', brainstormData(state), () => drawBrainstorm(state))
  // Focus 1: the Focus page, when the focus, the map or the brainstorms change; the tab's bar, when its setting does.
  focusOnce(state)
  // Vision (2026-10-19): the Vision tab, when the plan or what the person does on it changes.
  once('vision', visionData(state), () => drawVision(state))
  once('advisor-parts', state.advisorParts ?? null, () => drawAdvisorParts(state))
  // The line about a round left out goes after a day.
  once('advice-rounds', [state.rounds ?? null, Math.floor(state.readAt / 3_600_000)], () => { $('advice-rounds').textContent = roundsLine(state.rounds, state.readAt, clock) })
  const age = state.advice === null ? null : adviceAge(state.adviceAt ?? null, state.readAt)
  once('advice-age', age, () => {
    $('advice-age').hidden = age === null
    $('advice-age').className = `advice-age${age !== null && age.isOld ? ' is-old' : ''}`
    $('advice-age').textContent = age === null ? '' : age.text
  })
  once('talk', [state.advisor, advisorRefine(state.backlog), runningData(state), [...problems], [...sending]], () => drawTalk(state))
  once('main-talk', [state.mainTalk ?? null, state.maxMessageChars, problems.get('main-talk') ?? null, sending.has('main-talk')], () => drawMainTalk(state))
  drawDesign()
  finishRestore()
}

// withanswers:start
/**
 * I66, B483: a card the server sends without an answer (the hand-out card of a goal) broke every redraw, so every
 * Send: each card of `forYou` gets `answer: null` when it has none.
 */
function withAnswers(state) {
  if (Array.isArray(state.forYou)) state.forYou = state.forYou.map(need => (need.answer === undefined ? { ...need, answer: null } : need))
  return state
}
// withanswers:end

async function read() {
  clearTimeout(timer)
  try {
    const answer = await fetch('/api/state', { headers: { 'X-Board-Token': TOKEN }, cache: 'no-store' })
    // The server was started again and has a new token: a fresh page has it, and every Send of this page fails until
    // then. B519: so the page loads itself at once, and keeps the answers being typed in sessionStorage across it
    // (B512 waited for idle, but Send failed on the old token meanwhile). At most once a minute, so a real refusal
    // cannot make the page load itself over and over.
    if (reloadsOn403(answer.status, { lastAt: Number(sessionStorage.getItem('reloaded-at') ?? 0), now: Date.now() })) {
      sessionStorage.setItem('reloaded-at', String(Date.now()))
      reloadPage()
      return
    }
    if (!answer.ok) throw new Error(String(answer.status))
    const state = await answer.json()
    // 2026-10-28: while the person pauses, a chat stopped at its checkpoint shows as suspended (`pausedLanes`).
    if (state?.pause?.state === 'pausing') state.chats = pausedLanes(state.chats, state.pause)
    withAnswers(state)
    draw(state)
    awaySince = null
    helpAtStart(state)
  } catch {
    // The board is away (Claude was closed, or the board is being started again): the page keeps asking, and
    // says for how long. When the board is back it has a new token, and the page loads itself anew.
    if (awaySince === null) awaySince = Date.now()
    const updated = $('updated')
    updated.classList.add('is-stale')
    const away = `The board has not answered since ${clock(awaySince)} (${span(Date.now() - awaySince)}). Asking again every few seconds`
    updated.textContent = board === null ? `${away}.` : `${away}; showing what was read at ${clock(board.readAt)}.`
  }
  timer = setTimeout(read, awaySince === null ? (board?.refreshSeconds ?? 30) * 1000 : AWAY_MS)
}

/** B221: asks the board to close or delete a backlog step. Null when it did, else what went wrong. */
async function sendBacklog(body) {
  try {
    const answer = await fetch('/api/backlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
      body: JSON.stringify(body),
    })
    return answer.ok ? null : (await answer.text()).trim() || `refused (${answer.status})`
  } catch {
    return 'the board\'s server does not answer'
  }
}

/** Sends an answer or a message. `id` is the request it answers, or null for the chat with the advisor. */
async function send(message, id) {
  const key = id ?? 'talk'
  sending.add(key)
  problems.delete(key)
  if (id === null) $('say-send').disabled = true
  else redrawNeeds()
  let problem = null
  try {
    const answer = await fetch('/api/say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
      body: JSON.stringify(message),
    })
    if (!answer.ok) problem = (await answer.text()).trim() || `refused (${answer.status})`
    // B212: no Workers mod takes the board's words: they are on the clipboard, to be pasted into the chat.
    else showPaste((await answer.json().catch(() => null))?.paste ?? null)
  } catch {
    problem = 'the board\'s server does not answer'
  }
  sending.delete(key)
  if (problem === null) {
    drafts.delete(key)
    chosen.delete(key)
  } else {
    problems.set(key, `Not sent: ${problem}`)
  }
  if (id === null) {
    $('say-send').disabled = false
    $('say-note').classList.toggle('is-error', problem !== null)
    $('say-note').textContent = problem === null ? UNDELIVERED : problems.get(key)
    if (problem === null) $('say-text').value = ''
  }
  await read()
  if (id === null) $('messages').scrollTop = $('messages').scrollHeight
}

// sendwork:start
/**
 * B483: how long the page waits for the board's answer to one action. The person, 2026-10-21: "approving on the
 * board doesnt seem to work": a Yes sent while the board restarted stayed on "Sending…" for good.
 */
const WORK_WAIT_MS = 15000

/**
 * B299: one action of the person on the work store (POST /api/work: the token, the origin, JSON): an answer to an
 * ask, a note read. Its problem shows where `key` says, as for `send`. B483: it never stays "Sending…": no answer
 * within WORK_WAIT_MS, or a fault of the page itself, is a problem like a refusal, and the key is free again.
 */
async function sendWork(body, key, { reread = true } = {}) {
  sending.add(key)
  problems.delete(key)
  let problem = null
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), WORK_WAIT_MS)
  try {
    redrawNeeds()
    redrawFocus()
    const answer = await fetch('/api/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
      body: JSON.stringify(body),
      signal: stop.signal,
    })
    if (!answer.ok) problem = (await answer.text()).trim() || `refused (${answer.status})`
    else showPaste((await answer.json().catch(() => null))?.paste ?? null)
  } catch (error) {
    problem = stop.signal.aborted ? `the board did not answer within ${WORK_WAIT_MS / 1000} s (it may be restarting); try again`
      : error instanceof TypeError && /fetch/i.test(error.message) ? 'the board\'s server does not answer'
        : `the page failed (${error?.message ?? error}); reload it and try again`
  } finally {
    clearTimeout(timer)
    sending.delete(key)
  }
  if (problem === null) {
    drafts.delete(key)
    chosen.delete(key)
  } else problems.set(key, `Not sent: ${problem}`)
  redrawFocus()
  // B402: the calm window reads the board itself, once it has closed or said why not.
  if (reread) await read()
  return problem
}
// sendwork:end

// paste:start
/** B212: the line on top that says the words were copied, and into which chat to paste them. */
function pasteLine(paste, isCopied, isModThere = false) {
  // B315: with the Workers mod installed, words are only copied while no chat runs to take them.
  const why = isModThere ? 'Its chat is not running yet, so nothing types it in for you.' : 'No Workers mod types it in for you.'
  return isCopied
    ? `Copied for you: open the chat "${paste.chat}" in the Claude app and paste it there (Ctrl+V). ${why}`
    : `Not copied by itself: click Copy, then open the chat "${paste.chat}" in the Claude app and paste it there.`
}
// paste:end

let pasting = null

async function copyPaste() {
  try {
    await navigator.clipboard.writeText(pasting.text)
    return true
  } catch {
    return false
  }
}

/** B212: puts the words on the clipboard and says so in a bar on top, with Copy (again) and close. */
async function showPaste(paste) {
  if (paste === null || typeof paste?.text !== 'string') return
  pasting = paste
  let bar = document.querySelector('.paste-note')
  if (bar === null) {
    bar = el('div', 'paste-note')
    bar.setAttribute('role', 'status')
    document.body.append(bar)
  }
  const isCopied = await copyPaste()
  const copy = el('button', 'paste-copy', 'Copy')
  copy.type = 'button'
  copy.addEventListener('click', async () => { copy.textContent = (await copyPaste()) ? 'Copied' : 'Copy failed' })
  const close = el('button', 'paste-close', '×')
  close.type = 'button'
  close.setAttribute('aria-label', 'Close')
  close.addEventListener('click', () => bar.remove())
  bar.replaceChildren(el('span', '', pasteLine(paste, isCopied, typeof board?.mod?.installed === 'string')), copy, close)
}

/**
 * Starts the game of a request's branch and shows it in a new tab, or stops it. The tab is opened with the click
 * itself: one opened after the server answered would be stopped by the browser as a pop-up.
 */
/**
 * B149: starts the game with a branch's work and shows it where the change is: the game's own settings
 * ("arena=crossing&enemies=skeletons") go into its address. From a click the game opens in the tab opened with it;
 * from a link to the board (`#play=`, `inPlace`) this tab becomes the game.
 */
async function play(branch, settings, { tab = null, inPlace = false } = {}) {
  const key = `play:${branch}`
  starting.add(key)
  problems.delete(key)
  let problem = !inPlace && tab === null ? 'the browser stopped the new tab; allow pop-ups for the board' : null
  // B675: `page=<name>` opens that page of the game (`/<name>.html`) instead of its start.
  const params = new URLSearchParams(settings)
  const page = params.get('page')
  params.delete('page')
  if (problem === null) {
    try {
      const answer = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
        body: JSON.stringify({ item: 'branch', branch, action: 'start', ...(page === null ? {} : { page }) }),
      })
      if (!answer.ok) problem = (await answer.text()).trim() || `refused (${answer.status})`
      else {
        const url = new URL((await answer.json()).url)
        url.search = page === null ? settings : params.toString()
        if (inPlace) location.replace(url.href)
        else {
          // The game's page gets no hold on the board's page.
          tab.opener = null
          tab.location.replace(url.href)
        }
      }
    } catch {
      problem = 'the board\'s server does not answer'
    }
  }
  if (problem !== null && tab !== null) tab.close()
  starting.delete(key)
  if (problem !== null) problems.set(key, `Not started: ${problem}`)
  await read()
}

async function game(id, action) {
  const key = `game:${id}`
  let tab = null
  if (action === 'start') {
    try {
      tab = window.open('about:blank', '_blank')
    } catch {
      // No tab: the card shows the address once the game runs.
    }
  }
  starting.add(id)
  problems.delete(key)
  redrawNeeds()
  let problem = null
  try {
    const answer = await fetch('/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
      body: JSON.stringify({ item: id, action }),
    })
    if (!answer.ok) problem = (await answer.text()).trim() || `refused (${answer.status})`
    else if (tab !== null) {
      const { url } = await answer.json()
      // The game's page gets no hold on the board's page.
      tab.opener = null
      tab.location.replace(url)
    }
  } catch {
    problem = 'the board\'s server does not answer'
  }
  if (problem !== null && tab !== null) tab.close()
  starting.delete(id)
  if (problem !== null) problems.set(key, `Not ${action === 'start' ? 'started' : 'stopped'}: ${problem}`)
  await read()
}

$('say').addEventListener('submit', async event => {
  event.preventDefault()
  // B282: with the picture pasted for it, which the board keeps first, as in Talk to Main.
  const slot = pictureSlots.advisor
  const text = $('say-text').value.trim()
  if ((text === '' && slot.picture === null) || !board?.advisor || sending.has('talk')) return
  slot.problem = null
  problems.delete('talk')
  sending.add('talk')
  $('say-send').disabled = true
  const pending = slot.picture
  const picture = pending === null ? null : await keepSlotPicture(slot)
  sending.delete('talk')
  $('say-send').disabled = false
  // Not kept, or taken away or pasted anew meanwhile: nothing is sent, and what is in the box stays.
  if (slot.picture !== pending || (pending !== null && picture === null)) return slot.redraw()
  await send({ to: board.advisor.name, text, ...(picture === null ? {} : { picture }) }, null)
  if (!problems.has('talk') && slot.picture === pending) setSlotPicture(slot, null)
})

$('say-text').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    $('say').requestSubmit()
  }
})

// help:start
/**
 * B348: the help tour's six cards (G26, the person's brainstorm of 2026-10-18): each with its picture, its title, one or
 * two plain lines, and what the picture shows for whoever cannot see it. B375: the pictures are drawings of the board
 * itself (tools/help-pictures.mjs), the part each card is about ringed and numbered (the person's pick, Q173).
 */
const HELP_CARDS = [
  {
    picture: '/help/1-install.svg',
    title: 'Install the board',
    lines: ['One command installs the board and makes your project.', 'Your board opens in the browser.'],
    alt: 'A terminal running the install command, ringed as step 1, and the new board opening beside it',
  },
  {
    picture: '/help/2-initialise.svg',
    title: 'Press Initialise',
    lines: ['Initialise starts the main chat in the Claude app.', 'It sets up the rest: the workers, your partner, the backlog.'],
    alt: 'The Overview of a new project with its Initialise button ringed as step 2, and the main chat starting',
  },
  {
    picture: '/help/3-talk.svg',
    title: 'Talk it through with your partner',
    lines: ['Pick a goal on the Focus tab.', 'Your partner, the Advisor, works out with you how it should feel and how to build it.'],
    alt: 'The Focus tab at the vibe of a goal, with the talk with your partner on the right ringed as step 3',
  },
  {
    picture: '/help/4-go.svg',
    title: 'Press Go',
    lines: ['Agreed on the how? Press Go: your partner makes the steps.'],
    alt: 'The how of a goal with three parts and its Go button ringed as step 4, and the steps it makes beside it',
  },
  {
    picture: '/help/5-workers.svg',
    title: 'The workers build',
    lines: ['The main chat hands the steps to the workers.', 'The Overview shows who builds what and how far it is.'],
    alt: 'The Overview with the Workers column ringed as step 5, each worker with its step and a progress bar',
  },
  {
    picture: '/help/6-check.svg',
    title: 'You check',
    lines: ['What needs you waits under Needs your attention.', 'Look at the result: Approve it, or Reject it and say what to change.'],
    alt: 'Needs your attention ringed as step 6: the result picture a worker sent, with its Approve and Reject buttons',
  },
]

/** The card shown after a move: 'next', 'back' or a card's place, never before the first nor past the last. */
function helpMove(index, to, count) {
  const wanted = to === 'next' ? index + 1 : to === 'back' ? index - 1 : Number(to)
  return Math.min(Math.max(wanted, 0), count - 1)
}

/** What the tour shows of card `index`: its number and title, painting and lines, Back after the first, Done last. */
function helpView(index, cards) {
  const card = cards[index]
  return {
    heading: `${index + 1} · ${card.title}`,
    picture: card.picture,
    alt: card.alt,
    lines: card.lines,
    hasBack: index > 0,
    next: index === cards.length - 1 ? 'Done' : 'Next',
    dots: cards.map((_, place) => place === index),
  }
}

/**
 * Whether the tour opens by itself: the first time this browser opens the board, on a plain open; never over a link
 * from a chat (a picture, a game, a step, a tab) and never on the demo, whose pictures the chats take.
 */
function helpOpensAtStart({ seen, hash, isDemo }) {
  return !seen && (hash === '' || hash === '#') && !isDemo
}
// help:end

/** B348: the card the tour shows, the address the page was opened with, and whether the first read looked. */
let helpAt = 0
const helpStartHash = location.hash
let helpLooked = false

function drawHelp() {
  const view = helpView(helpAt, HELP_CARDS)
  $('help-picture').src = view.picture
  $('help-picture').alt = view.alt
  $('help-heading').textContent = view.heading
  $('help-lines').replaceChildren(...view.lines.map(line => el('p', '', line)))
  $('help-dots').replaceChildren(...view.dots.map((isAt, place) => {
    const dot = el('button', 'help-dot')
    dot.type = 'button'
    dot.dataset.helpCard = String(place)
    dot.setAttribute('aria-label', `Card ${place + 1}: ${HELP_CARDS[place].title}`)
    dot.setAttribute('aria-current', isAt ? 'true' : 'false')
    return dot
  }))
  $('help-back').disabled = !view.hasBack
  $('help-next').textContent = view.next
}

function moveHelp(to) {
  const wasDot = document.activeElement?.classList.contains('help-dot') === true
  helpAt = helpMove(helpAt, to, HELP_CARDS.length)
  drawHelp()
  // Review: the focus stays in the tour, so the arrow keys go on working: a redrawn dot hands it to the card's dot,
  // a Back that hid itself on the first card to Next.
  if (wasDot) $('help-dots').querySelector('[aria-current="true"]')?.focus()
  else if (!$('help').contains(document.activeElement) || document.activeElement.disabled) $('help-next').focus()
}

function openHelp() {
  helpAt = 0
  drawHelp()
  if (!$('help').open) $('help').showModal()
  $('help-next').focus()
}

$('help-button').addEventListener('click', openHelp)
$('help-close').addEventListener('click', () => $('help').close())
$('help-back').addEventListener('click', () => moveHelp('back'))
$('help-next').addEventListener('click', () => (helpAt === HELP_CARDS.length - 1 ? $('help').close() : moveHelp('next')))
$('help-dots').addEventListener('click', event => {
  const dot = event.target.closest('[data-help-card]')
  if (dot !== null) moveHelp(Number(dot.dataset.helpCard))
})
// The arrow keys move too, wherever the focus is while the tour is open; with Alt and the like they are the browser's
// (Alt+Left is Back). Escape closes (the dialog's own).
document.addEventListener('keydown', event => {
  if (!$('help').open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (event.key === 'ArrowRight') moveHelp('next')
  if (event.key === 'ArrowLeft') moveHelp('back')
})
// Closed by ×, Done or Escape: this browser saw it, so it opens only from the ? button from now on.
$('help').addEventListener('close', () => {
  try { localStorage.setItem('help-seen', 'yes') } catch { /* it opens again next time */ }
  $('help-button').focus()
})

/** At the first read: the tour opens by itself, once. A browser that keeps nothing is not shown it every time. */
function helpAtStart(state) {
  if (helpLooked) return
  helpLooked = true
  let seen = true
  try { seen = localStorage.getItem('help-seen') === 'yes' } catch { /* seen stays true */ }
  if (helpOpensAtStart({ seen, hash: helpStartHash, isDemo: state?.isDemo === true })) openHelp()
}

// The person, 2026-10-31: the reload icon spins while the board reads again (at least a moment, so a quick read shows too).
async function readSpinning() {
  const buttons = ['refresh', 'refresh-title'].map(id => $(id))
  for (const button of buttons) button.classList.add('is-loading')
  try {
    await Promise.all([read(), new Promise(done => setTimeout(done, 600))])
  } finally {
    for (const button of buttons) button.classList.remove('is-loading')
  }
}
for (const id of ['refresh', 'refresh-title']) {
  $(id).append(icon('refresh'))
  $(id).addEventListener('click', readSpinning)
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) read()
})

show(tabOfAddress(location.hash) ?? 'overview')
read()
