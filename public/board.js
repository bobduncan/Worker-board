// The worker board's page, second design: an Overview (one lane per worker, the inbox "For you", today's
// timeline) and Advice & Chat. It asks the server for the state and redraws. Everything from a chat, the backlog
// or the advice file is put on the page as text (textContent), never as HTML, so words in a transcript can never
// become part of the page's code.

'use strict'

const TOKEN = document.querySelector('meta[name="board-token"]').content
/** B142: the version of the page as it was loaded; empty when the board did not say it. */
const PAGE = (document.querySelector('meta[name="board-page"]')?.content ?? '').replace(/^\{\{page\}\}$/, '')
const STATES = { working: 'Working', waiting: 'Waiting for you', free: 'Free', unknown: 'Unknown', interrupted: 'Interrupted', suspended: 'Suspended' }
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
const chosen = new Map()
const problems = new Map()
const sending = new Set()
const openForms = new Set()
/** The requests whose game is being started. */
const starting = new Set()
const pictures = new Map()
const drawn = {}
let isLegacyOpen = false
let board = null
let timer = null
/** When the board stopped answering; null while it answers. */
let awaySince = null
/** True while the person is asked whether they really want to prepare a restart. */
let isAskingRestart = false

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
  refresh: 'M20 11a8 8 0 0 0-14.3-4.5M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5M20 20v-4h-4',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  // B159: a worker (a chat, whatever it works on) and a queue.
  chat: 'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01',
  list: 'M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01',
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

function pictureUrl(path) {
  if (!pictures.has(path)) {
    pictures.set(path, fetch(`/api/picture?path=${encodeURIComponent(path)}`, { headers: { 'X-Board-Token': TOKEN } })
      .then(answer => (answer.ok ? answer.blob() : null))
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
  if (version.isServerNewer) {
    return version.canRestart
      ? { text: 'A new version of the board is available. Click to start it.', action: 'restart', tone: 'new' }
      : { text: 'A new version of the board is available. This board cannot start itself anew: start it once from where it was started.', action: null, tone: 'new' }
  }
  if (loadedPage !== '' && typeof version.page === 'string' && version.page !== loadedPage) return { text: 'A new version of the page is available. Click to load it.', action: 'reload', tone: 'new' }
  return null
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

function drawAppNote(state) {
  const shown = appNote(state.appMoved ?? null, clock)
  const note = $('app-note')
  note.hidden = shown === null
  if (shown === null) return
  note.className = `app-note is-${shown.tone}`
  note.textContent = shown.text
}

/** B296, B301: the note on top about the work store (see `storeNote`). */
function drawStoreNote(state) {
  const shown = storeNote(state.store ?? null, state.workFlags ?? [])
  const note = $('store-note')
  note.hidden = shown === null
  if (shown !== null) note.textContent = shown.text
}

/** The note on top (see `updateView`). */
function drawUpdate(state) {
  const note = $('update-note')
  const shown = updateView(state.version, PAGE, { isStarting: sending.has('board-anew'), problem: problems.get('board-anew') ?? null })
  note.hidden = shown === null
  if (shown === null) return
  note.className = `update-note is-${shown.tone}`
  note.textContent = shown.text
  note.disabled = shown.action === null
}

$('update-note').addEventListener('click', async () => {
  const shown = board === null ? null : updateView(board.version, PAGE, { isStarting: sending.has('board-anew'), problem: problems.get('board-anew') ?? null })
  if (shown === null || shown.action === null) return
  if (shown.action === 'reload') return location.reload()
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

function drawTop(state) {
  const updated = $('updated')
  updated.textContent = `Last updated ${clock(state.readAt)}${state.isDemo ? ' · demo data' : ''}`
  $('version').textContent = versionLine(state.version)
  updated.classList.remove('is-stale')
  fill($('counts'), ['working', 'waiting', 'free', 'suspended', 'interrupted', 'unknown']
    .filter(name => (name !== 'unknown' && name !== 'interrupted' && name !== 'suspended') || (state.counts[name] ?? 0) > 0)
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
    // B291: stopped at a safe point for a restart, not held by a limit.
    case 'suspended': if (why.by === 'restart') return said('wait', `${why.worker} stopped for the restart`)
      return said('limit', why.isBack ? `${why.worker} has not gone on since the limit came back` : `${why.worker} is suspended${why.until === null ? '' : ` until ${clock(why.until)}`}`)
    case 'after': {
      if (!Array.isArray(why.steps)) return said('wait', `after ${why.words}`)
      const [last, ...first] = [...why.steps].reverse()
      return said('wait', `waits for ${first.length === 0 ? last : `${first.reverse().join(', ')} and ${last}`}`)
    }
    case 'busy': return said('wait', `${why.worker} is busy${why.leftMs === null ? '' : `, about ${span(why.leftMs)} left`}`)
    case 'you': return said('wait', `${why.worker} waits for you`)
    case 'cut': return said('wait', `${why.worker} was cut off`)
    case 'handout': return said('plain', why.isOwn ? `${why.main} has not started it` : `waits for ${why.main} to hand it out`)
    case 'nobody': return said('plain', 'no worker is named for it')
    default: return said('plain', `the state of ${why.worker ?? 'its worker'} is not known`)
  }
}

/** What a suspended lane says: who held it (the app's stop, or its own pause) and when it goes on. */
function heldText(held) {
  // B291: stopped at a safe point for a restart of the app; it goes on when the person resumes.
  if (held.by === 'restart') return `Stopped for the restart at ${clock(held.since)} · waits for Resume`
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

/** B113: the limits in the head, in one place. A board whose server does not give them shows nothing there. */
function drawLimits(state) {
  const box = $('limits')
  const shown = state.limits === undefined ? null : limitsView(state.limits, state.readAt)
  box.hidden = state.limits === undefined
  if (state.limits === undefined) return
  box.title = 'From the Claude app\'s own usage file on this PC, which it renews about every 15 minutes while it is open. The reset time comes from the last time a chat looked the limits up. Reading it asks no chat and costs nothing.'
  if (shown === null) return fill(box, [el('small', 'limit-age', 'Limits not known: the app\'s usage file was not found')])
  fill(box, [
    shown.five === null ? null : drawLimit(shown.five, false),
    shown.week === null ? null : drawLimit(shown.week, true),
    el('small', `limit-age${shown.age.isOld ? ' is-old' : ''}`, shown.age.text),
  ].filter(part => part !== null))
}

// A restart of the app

/**
 * What the board knows about a restart of the app, above the lanes: that it was off, who was cut off, how the
 * preparing stands, and the one button that brings the workers back. The main chat does the work: the buttons
 * type "prepare restart" and "resume" into its chat. Nothing is shown when there is nothing to say.
 */
function drawRestart(state) {
  const restart = state.restart ?? null
  const box = $('restart')
  const prepare = $('prepare-restart')
  prepare.hidden = restart === null || restart.main === null
  // B130: the main chat by its title from the list of chats.
  prepare.title = `Before you quit Claude: ${state.workers?.mainTitle ?? 'the main chat'} asks every working chat to stop at a safe point and writes down who was on what`
  prepare.disabled = sending.has('restart')
  if (restart === null || restart.main === null) {
    box.hidden = true
    return
  }
  const line = (className, text) => el('p', className, text)
  const button = (label, className, command) => {
    const node = el('button', `button ${className}`, label)
    node.type = 'button'
    node.dataset.restart = command
    node.disabled = sending.has('restart')
    return node
  }
  const parts = []
  if (restart.off !== null) parts.push(line('muted', `The board was off from ${clock(restart.off.from)} to ${clock(restart.off.to)} (${span(restart.off.to - restart.off.from)}).`))
  if (restart.interrupted.length > 0) parts.push(line('alert', `Cut off in the middle of a task: ${restart.interrupted.join(', ')}.`))
  // Who has to be started before it can carry on: said where a restart is at hand, not all day long.
  const down = restart.notRunning ?? []
  const isAtHand = restart.off !== null || restart.interrupted.length > 0 || restart.prepared !== null || restart.resuming !== null
  if (isAtHand && down.includes(restart.main)) parts.push(line('alert', `${restart.main} is not running: open its chat first, the buttons here type into it.`))
  if (isAtHand && down.some(name => name !== restart.main)) {
    parts.push(line('', `Not running yet: ${down.filter(name => name !== restart.main).join(', ')}. "Resume all" tells ${restart.main} to start them; one that stays "not running" has to be opened by you.`))
  }
  if (restart.prepared !== null) parts.push(line('muted', `${restart.main} last wrote down who was on what at ${clock(restart.prepared.at)} (restart.md).`))

  if (isAskingRestart) {
    const ask = el('div', 'restart-ask')
    ask.append(line('', `Prepare a restart? ${restart.main} asks every working chat to stop at a safe point and writes down who was on what.`), button('Yes, prepare', '', 'prepare restart'), button('No', 'is-quiet', 'cancel'))
    parts.push(ask)
  }
  const preparing = restart.preparing
  if (preparing !== null) {
    // B291: written after the last worker's safe-point line too, so it holds what every worker said.
    const isWritten = restart.prepared !== null && restart.prepared.at >= Math.max(preparing.at, preparing.lastLine ?? 0)
    if (preparing.state === 'waiting') parts.push(line('', `"Prepare restart" waits for ${restart.main} to take it: its chat must be open.`))
    else if (preparing.state === 'expired' || preparing.state === 'failed') parts.push(line('problem', `"Prepare restart" did not reach ${restart.main}. Open its chat and press it again.`))
    // B291: a worker that sent its safe-point line counts as stopped (its lane says Suspended), whatever its
    // transcript shows: only the chats with no line yet still work.
    else if (preparing.working.length > 0) parts.push(line('', `Preparing the restart since ${clock(preparing.at)}. Still working (no safe point yet): ${preparing.working.join(', ')}.`))
    else if (isWritten) parts.push(line('ready', `Everyone stopped: safe to restart. ${restart.main} wrote down who was on what; you can quit Claude now.`))
    else parts.push(line('', `Everyone stopped. ${restart.main} has not written down who was on what yet.`))
  }
  const resuming = restart.resuming
  if (resuming !== null) {
    if (resuming.state === 'waiting') parts.push(line('', `"Resume" waits for ${restart.main} to take it: its chat must be open.`))
    else if (resuming.state === 'expired' || resuming.state === 'failed') parts.push(line('problem', `"Resume" did not reach ${restart.main}. Open its chat and press it again.`))
    else parts.push(line('muted', `"Resume" was handed to ${restart.main} at ${clock(resuming.at)}: it brings the workers back.`))
  }
  // Resuming is offered when there is somebody to bring back: a chat that was cut off, or a restart that was prepared.
  if ((restart.interrupted.length > 0 || restart.prepared !== null) && (resuming === null || resuming.state === 'expired' || resuming.state === 'failed')) {
    const row = el('div', 'restart-ask')
    row.append(button(restart.interrupted.length > 0 ? `Resume all (${restart.interrupted.length} cut off)` : 'Resume all', '', 'resume'), el('small', 'muted', `${restart.main} does the resuming: its chat must be open.`))
    parts.push(row)
  }
  if (problems.has('restart')) parts.push(line('problem', problems.get('restart')))
  box.hidden = parts.length === 0
  fill(box, parts)
}

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
  if (lane.state === 'interrupted') return plain(lane.cutOffAt === null ? 'by a restart' : `at ${clock(lane.cutOffAt)}`, 'bad', 'Cut off')
  if (lane.state === 'suspended') {
    // B113: held by the limit. The figure is when it goes on; once that has passed it needs a hand.
    const held = lane.suspended
    if (held.by === 'restart') return plain('Restart', 'muted', 'Stopped for')
    if (held.isBack) return plain(held.until === null ? 'Not gone on' : `since ${clock(held.until)}`, 'bad', 'Limit is back')
    return held.until === null ? plain('Suspended') : { label: 'Goes on', main: clock(held.until), tone: 'time', small: [`in ${span(held.until - now)}`], from: null }
  }
  if (lane.state === 'waiting') return plain('Blocked', 'bad', 'ETA')
  if (lane.state === 'free') return plain('Available')
  if (lane.state !== 'working') return plain('Unknown')
  const eta = lane.eta ?? null
  const soFar = lane.task === null || !Number.isFinite(lane.task.startedAt) ? [] : [`${span(now - lane.task.startedAt)} so far`]
  if (eta === null) {
    // The main chat hands out work and answers: it has no task to time.
    return lane.isWithoutTime === true
      ? { label: 'ETA', main: 'No time', tone: 'fault', small: soFar, from: null, title: 'This worker works without a time: it gave none, and its step names none.' }
      : { label: '', main: 'Working', tone: 'muted', small: soFar, from: null }
  }
  const from = eta.isOwn !== false ? null : {
    text: `from ${lane.task?.stepId ?? 'its step'}`,
    title: 'The worker gave no estimate of its own: this is the time its step names, counted from when the task started.',
  }
  // Overdue stays overdue, with how far over as its figure.
  if (eta.isOverdue) return { label: 'Overdue', main: `${span(now - eta.at)} over`, tone: 'bad', small: [`was ${clock(eta.at)}`], from }
  // B185: a little over is no fault: over twice its estimate and by 10 minutes is (above).
  if (eta.isOver === true) return { label: 'ETA', main: `${span(now - eta.at)} over`, tone: 'time', small: [`was ${clock(eta.at)}`], from }
  return { label: 'ETA', main: `${span(eta.leftMs)} left`, tone: 'time', small: [`until ${clock(eta.at)}`], from }
}
// lanetime:end

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
  const leftMs = !given ? null : lane.state === 'working' ? task.stepEstimateAt + task.stepLeftMs - now : task.stepLeftMs
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
  now.append(el('span', 'step-count', line.count), el('span', 'step-name', line.name), el('span', `step-time is-${line.tone}`, line.time))
  const list = el('ol', 'step-list')
  for (const step of line.steps) {
    const item = el('li', `is-${step.state}`, step.name)
    if (step.state === 'now') item.append(el('small', '', 'now'))
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

function drawEta(lane, now) {
  const time = timeOf(lane, now)
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
  // B95: no worker works without a time; one that does is a fault to fix.
  if (lane.isWithoutTime === true) alerts.push('works without a time: its chat has to say how long it expects')
  if (task !== null && task.firstEstimateMs !== null && task.workedMs > task.firstEstimateMs + MIN) alerts.push(`${span(task.workedMs - task.firstEstimateMs)} over its first estimate`)
  if (lane.state === 'working' && task !== null && task.estimateAt !== null && state.readAt - task.estimateAt > state.estimateOldMs) {
    alerts.push(`estimate ${span(state.readAt - task.estimateAt)} old`)
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
    list.append(el('li', '', `Started ${clock(task.startedAt)}: ${span(now - task.startedAt)} so far${waited}`))
    if (task.firstEstimateMs !== null) list.append(el('li', '', `First estimate ${span(task.firstEstimateMs)}, worked ${span(task.workedMs)}`))
    if (task.leftMs !== null && task.estimateAt !== null) list.append(el('li', '', `Said ${span(task.leftMs)} left, ${ago(task.estimateAt, now)}`))
    if (task.source === 'unrecorded') list.append(el('li', 'muted', 'It has recorded no task yet: no topic, no steps and no time.'))
    if (task.source === 'step') list.append(el('li', 'muted', 'It named no task: this is the step the work store holds for it.'))
    if (lane.eta !== null && lane.eta.isOwn === false) list.append(el('li', 'muted', `It gave no estimate: ${task.stepId ?? 'its step'} says ${about(task.stepMinutes)}, counted from the start.`))
    if (task.source === 'plan' && (task.stepId ?? null) !== null) list.append(el('li', 'muted', `It is on step ${task.stepId} of the backlog.`))
  }
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
    tone: flag.kind === 'card' ? 'warn' : 'problem',
    // B304: a failed check is the person's to run again ("Check again", `data-recheck`: the work API's `recheck`).
    button: flag.kind === 'check failed' ? { label: 'Check again', recheck: flag.id }
      : flag.button === null || main === null || main === lane.name ? null : { label: flag.button, start: lane.name, isAsked },
  }))
}
// laneflags:end

function drawLane(lane, state) {
  const isOpen = openLanes.has(lane.name)
  const card = el('article', `lane is-${lane.state}${lane.isLeftover ? ' is-leftover' : ''}${isOpen ? ' is-open' : ''}`)
  card.dataset.lane = lane.name
  const row = el('div', 'lane-row')

  const who = el('div', 'who')
  const names = el('div', 'who-names')
  names.append(el('h3', '', lane.name), el('span', `pill is-${lane.state}`, lane.isLeftover ? 'Leftover' : STATES[lane.state]))
  if (lane.isRunning === false) {
    // After a restart of the app a chat does not run until it is opened, or messaged through the app.
    const idle = el('small', 'not-running', 'not running')
    idle.title = `This chat's process is not running: nothing reaches it until its chat is opened, or ${board?.workers?.mainTitle ?? 'the main chat'} starts it.`
    names.append(idle)
  }
  // B235: whether the Workers mod compacted it after its last report, or why not.
  const compacted = compactionLine(lane.compaction ?? null, clock)
  if (compacted !== null) {
    const note = el('small', `compaction${compacted.isWarning ? ' is-warning' : ''}`, compacted.text)
    note.title = compacted.title
    names.append(note)
  }
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
  // B159: the worker's icon takes the colour of its state.
  const sign = el('span', `worker-icon is-${lane.isLeftover ? 'leftover' : lane.state}`)
  sign.setAttribute('aria-hidden', 'true')
  sign.append(icon('chat'))
  who.append(sign, names)

  const what = el('div', 'what')
  const task = lane.task
  if (task === null) {
    what.append(el('p', 'task is-none', lane.state === 'working' ? 'Task not recorded yet' : 'No active task'))
    const free = freeLine(lane, clock)
    if (free !== null) what.append(el('p', 'note', free))
  } else {
    what.append(taskTitle(lane))
  }
  // B159: the progress of its task in a column of its own: a bar of its steps, and its step line (B108) under it.
  const progress = el('div', 'progress-cell')
  const bar = el('div', 'bar')
  const done = el('div', 'fill')
  const hasSteps = task !== null && Number.isFinite(task.step) && Number.isFinite(task.steps) && task.steps > 0
  done.style.width = hasSteps ? `${Math.max(0, Math.min(100, (task.step / task.steps) * 100))}%` : '0%'
  bar.append(done)
  progress.append(bar)
  const steps = task === null ? null : stepLine(lane, state.readAt)
  if (steps !== null) progress.append(drawStepLine(lane, steps))
  else if (hasSteps) progress.append(el('small', 'progress-count', `${task.step} of ${task.steps}`))
  else if (task !== null) progress.append(el('small', 'progress-count', 'no steps given'))
  if (lane.state === 'working' && lane.doingNow !== null) {
    const now = el('p', 'now clip')
    now.append(el('b', '', 'Now: '), el('span', '', lane.doingNow))
    what.append(now)
  }
  what.append(...betweenTurns(lane))
  if (lane.state === 'interrupted') what.append(el('p', 'alert', 'Cut off in the middle of its turn: it does nothing until it is resumed.'))
  if (lane.state === 'suspended') what.append(el('p', `held${lane.suspended.isBack ? ' is-back' : ''}`, heldText(lane.suspended)))
  if (lane.state === 'waiting') {
    // B100: the lane opens what it waits for; the line is a button, so the keyboard reaches it too.
    const open = el('button', 'needs-you', 'Needs your decision')
    open.type = 'button'
    open.title = 'See what it waits for, and answer it here'
    open.append(el('small', '', 'see and answer ›'))
    what.append(open)
  }
  const alerts = alertsOf(lane, state)
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

  const queue = el('div', 'queue')
  if (lane.queue.length === 0) queue.append(el('span', 'queue-empty', 'Queue (0)'))
  if (lane.queue.length > 0) {
    const first = el('div', 'queue-first')
    const item = el('button', 'queue-item')
    item.type = 'button'
    item.dataset.lane = lane.name
    item.dataset.step = '0'
    item.title = `${lane.queue[0].text}\nShow the details`
    const listSign = el('span', 'queue-icon')
    listSign.append(icon('list'))
    const words = el('span', 'queue-text')
    words.append(el('b', '', lane.queue[0].title), el('small', '', [`Queue (${lane.queue.length})`, lane.queue[0].id, about(lane.queue[0].minutes) ?? 'no time given'].filter(Boolean).join(' · ')))
    item.append(listSign, words)
    // B113: why it is not started.
    const why = whyText(lane.queue[0].why)
    if (why !== null) {
      const line = el('small', `why is-${why.tone}`, why.text)
      line.title = why.text
      words.append(line)
    }
    first.append(item)
    if (lane.queue.length > 1) first.append(el('div', 'queue-more', `+${lane.queue.length - 1}`))
    queue.append(first)
  }

  const menu = el('div', 'lane-menu-cell')
  const unfold = el('button', 'lane-menu', '⋯')
  unfold.type = 'button'
  unfold.dataset.lane = lane.name
  unfold.title = 'The whole queue, the details, and Remove'
  unfold.setAttribute('aria-label', `${lane.name}: the whole queue, the details, and Remove`)
  unfold.setAttribute('aria-expanded', String(isOpen))
  menu.append(unfold)

  row.append(who, what, progress, drawEta(lane, state.readAt), queue, menu)
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
    fill($('workers-add'), [lines, button])
    return null
  }
  box.append(lines, button)
  return box
}

/**
 * The lanes, drawn anew, and under them the row about workers (B124). A step line that held the keyboard's focus
 * holds it again, so its list of steps stays open.
 */
function drawLanes(state) {
  const focused = document.activeElement?.dataset?.stepsOf ?? null
  fill($('lanes'), [...state.chats.map(lane => drawLane(lane, state)), drawWorkers(state)].filter(part => part !== null))
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
    // B291: stopped at a safe point for a restart, not for a limit.
    const why = lane.suspended?.by === 'restart' ? 'It stopped for the restart' : `It paused for the limit${until}`
    reasons.push(`${why}${what === null ? '' : ` with ${what}`}: that task would not go on.`)
  }
  if (lane.state === 'interrupted') reasons.push(`It was cut off in the middle of ${what ?? 'its turn'}: that work would not be resumed.`)
  if (lane.state === 'unknown') reasons.push('The board cannot tell what it is doing.')
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
 * B83: in the window of a step in a worker's queue: "Move to" another worker, and "Take out of the queue" (it stays on
 * the backlog without a worker). B301, the review: both change the work store at once through the work API, as the
 * person (`requeue`, `unqueue`); the board delivers the step to its new worker. Nothing for a step without an id.
 */
function queueChangePart(lane, step, state) {
  if (typeof step?.id !== 'string') return null
  const key = `change:${step.id}`
  const others = (state.chats ?? []).filter(one => !one.isMain && !one.isLeftover && one.name !== lane.name)
  if (others.length > 0) {
    const move = el('button', 'quiet-button', 'Move to')
    move.type = 'button'
    move.dataset.moveStep = step.id
    move.disabled = sending.has(key)
    const pick = el('select')
    pick.dataset.moveTarget = step.id
    pick.setAttribute('aria-label', 'The worker to move it to')
    for (const one of others) {
      const option = el('option', '', one.name)
      option.value = one.name
      pick.append(option)
    }
    part.append(move, pick)
  }
  const out = el('button', 'quiet-button', 'Take out of the queue')
  out.type = 'button'
  out.dataset.unqueueStep = step.id
  out.disabled = sending.has(key)
  out.title = 'It stays on the backlog, without a worker'
  part.append(out, el('span', 'muted', 'The work store changes at once; the board delivers the step to its new worker.'))
  if (problems.has(key)) part.append(el('p', 'problem', problems.get(key)))
  return part
}

// B83: the queue's changes from a step's window.
$('details').addEventListener('click', event => {
  const button = event.target.closest('[data-move-step], [data-unqueue-step]')
  if (button === null) return
  const id = button.dataset.moveStep ?? button.dataset.unqueueStep
  button.disabled = true
  if (button.dataset.moveStep === undefined) return sendWork({ action: 'unqueue', id }, `change:${id}`)
  const target = [...$('details').querySelectorAll('[data-move-target]')].find(pick => pick.dataset.moveTarget === id)?.value ?? ''
  return sendWork({ action: 'requeue', id, for: target }, `change:${id}`)
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

/** What has no lane: queued steps that name no worker, and folders no worker is named for. */
function drawStrips(state) {
  const strips = []
  if (state.unassigned.length > 0) {
    const strip = el('div', 'strip')
    strip.append(el('b', '', `Queued for nobody (${state.unassigned.length}): `), state.unassigned.map(step => [step.id, step.title].filter(Boolean).join(' ')).join(' · '))
    strips.push(strip)
  }
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
  }[answer.state] ?? 'waits for its chat to take it'
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

/**
 * The part of a request that takes the answer: what was sent, or the form its kind needs. `isFolded` keeps the
 * form of a backlog step behind a button until it is opened, so the many steps stay short.
 */
function answerPart(need, state, isFolded) {
  const parts = []
  const answer = need.answer
  if (answer !== null && !isLost(answer)) return [sentLine(answer, need.from)]
  if (need.isClosed === true) return [el('p', 'muted', 'Closed: ticked in the backlog.')]
  if (answer !== null) parts.push(el('p', 'problem', `Your answer of ${clock(answer.at)} did not reach the chat. Send it again when the chat can take it.`))
  // The step changed since it was answered: it asks again, and says what was answered before.
  const earlier = need.earlier ?? null
  if (earlier !== null) {
    const what = { approve: 'approved', reject: 'rejected', done: 'marked done' }[earlier.verdict] ?? 'answered'
    parts.push(el('p', 'muted', `Changed since you ${what} it at ${clock(earlier.at)}${earlier.text === '' ? '' : `: "${earlier.text}"`}.`))
  }
  if (need.kind === 'unfiled' || need.kind === 'idle') return [...parts, ...talkButton(need)]
  if (!need.canAnswer) return [...parts, el('p', 'muted', isStep(need) ? 'No main chat is open to take the answer.' : 'Answer in its chat.')]
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
function talkButton(need) {
  const open = el('button', 'choice', need.talk === 'main' ? `Open Talk to ${need.from}` : need.talk === 'advisor' ? `Open ${need.from}'s chat` : `Open ${need.from}'s answer`)
  open.type = 'button'
  open.dataset.openTalk = need.talk === 'main' || need.talk === 'advisor' ? need.talk : need.id
  return [open]
}

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
  const facts = [state.baseBranch, game.commit?.hash ?? null, game.lastCommitAt === null ? null : `last change ${ago(game.lastCommitAt, state.readAt)}`].filter(Boolean)
  const note = el('small', 'run-note', facts.join(' · '))
  if (game.commit?.subject) note.title = game.commit.subject
  if (game.url !== null) {
    const link = el('a', '', game.url.replace(/^http:\/\//, '').replace(/\/$/, ''))
    link.href = game.url
    link.target = '_blank'
    link.rel = 'noreferrer noopener'
    note.append(' · running at ', link)
  }
  const problem = problems.get('game:main')
  fill($('main-game'), [row, note, problem === undefined ? null : el('p', 'problem', problem)])
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
    id: one.id, text: one.text, isRead: one.isRead,
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

/** B299: the part "Information" under Needs your attention: what the chats told the person; "Read" puts it away. */
function drawInformation(state) {
  const rows = informationRows(state.information)
  if (rows.length === 0) return null
  const unread = rows.filter(row => !row.isRead).length
  const part = el('section', 'information')
  const head = el('h3', '', 'Information')
  head.append(el('small', 'muted', unread === 0 ? 'all read' : `${unread} new`))
  part.append(head)
  for (const row of rows) {
    if (row.isRead && !showsClosed()) continue
    const line = el('div', `info${row.isRead ? ' is-read' : ''}`)
    line.dataset.info = row.id
    const words = el('p', '')
    words.append(el('b', '', row.head), ' ', row.text)
    line.append(words, el('small', 'muted', row.at === null ? row.id : `${row.id} · ${ago(row.at, state.readAt)}`))
    if (!row.isRead) {
      const read = el('button', 'choice', sending.has(`read:${row.id}`) ? 'Reading…' : 'Read')
      read.type = 'button'
      read.dataset.read = row.id
      read.disabled = sending.has(`read:${row.id}`)
      line.append(read)
    }
    const problem = problems.get(`read:${row.id}`)
    if (problem !== undefined) line.append(el('p', 'problem', problem))
    part.append(line)
  }
  return part
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
  head.append(el('small', 'muted', `${lines.length} step${lines.length === 1 ? '' : 's'} wait${lines.length === 1 ? 's' : ''} for your answers`))
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
  head.append(top, el('h4', '', need.title))
  card.append(head, ...storeAskLines(need, state))
  if (need.text !== '') card.append(el('p', '', need.text))
  card.append(...optionParts(need))

  card.append(...gameParts(need))
  if (need.checks.length > 0) card.append(listBox('Key points to check', need.checks))
  if (need.tried.length > 0) card.append(listBox('Already tried', need.tried))
  card.append(...answerPart(need, state, isStep(need)))
  return card
}

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

function drawLegacy(state) {
  const open = state.backlogForYou.filter(step => !isClosed(step))
  const closed = [...state.backlogForYou.filter(isClosed), ...state.backlogClosed]
  if (open.length === 0 && closed.length === 0) return null
  const box = el('details', 'legacy')
  box.open = isLegacyOpen
  // What still waits for the person: an answered step is among the closed ones (B307), and is not counted.
  const waiting = open.filter(step => !isAnswered(step))
  const counts = Object.keys(ASKS).map(asks => [ASKS[asks], waiting.filter(step => step.asks === asks).length]).filter(([, count]) => count > 0)
  const summary = el('summary', '', `From the backlog (${waiting.length})`)
  const notes = counts.map(([name, count]) => `${count} ${name.toLowerCase()}`)
  if (closed.length > 0) notes.push(`${closed.length} closed ${showsClosed() ? 'shown' : 'hidden'}`)
  summary.append(el('small', '', notes.join(' · ')))
  box.append(summary)
  for (const step of ordered(open)) box.append(drawNeed(step, state))
  if (showsClosed()) for (const step of ordered(closed)) box.append(drawNeed(step, state))
  box.addEventListener('toggle', () => { isLegacyOpen = box.open })
  return box
}

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

/** B298: the part "Open instructions": the person's words per chat; a click on the main chat's opens the talk with it. */
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
      line.append(el('span', 'instruction-id', row.id), el('span', 'instruction-text', row.text), el('small', 'instruction-note', row.at === null || row.tone === 'closed' ? row.note : `${row.note} · ${ago(row.at, state.readAt)}`))
      box.append(line)
    }
    part.append(box)
  }
  return part
}

// B298: the main chat's name over its instructions opens the talk with it. B299: "Read" puts a note away.
$('needs').addEventListener('click', event => {
  const side = event.target.closest('.instructions [data-show-side]')
  if (side !== null) showSide(side.dataset.showSide)
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

function drawNeeds(state) {
  const box = $('needs')
  const focused = focusedNeed(box)
  const top = box.scrollTop
  const open = state.forYou.filter(need => !isClosed(need))
  // B287: a refine question has no card: its step's line says it, and only while it is open.
  const lines = refineLines(open)
  const cardsOpen = open.filter(need => !isRefineQuestion(need))
  const answered = state.forYou.filter(need => isClosed(need) && !isRefineQuestion(need)).length
  // B258: an answer to an ask on the goal map waits to be read, and counts.
  // B287: the refine questions count once per step, as their lines stand.
  const unanswered = cardsOpen.filter(need => !isAnswered(need)).length + lines.length + (state.goalAskNeeds ?? []).length + (state.brainstormNeeds ?? []).length
  $('needs-count').textContent = unanswered === 0 ? '' : String(unanswered)
  const shown = ordered(shownNeeds(state.forYou, showsClosed()).filter(need => !isRefineQuestion(need)))
  // B300: a blocking ask that waited too long stands first, above the refine lines too.
  const oldCards = shown.filter(need => need.isOld === true).map(need => drawNeed(need, state))
  const cards = shown.filter(need => need.isOld !== true).map(need => drawNeed(need, state))
  const none = cardsOpen.length > 0 || lines.length > 0 || (state.goalAskNeeds ?? []).length > 0 || (state.brainstormNeeds ?? []).length > 0 ? null : el('p', 'empty', answered > 0 && !showsClosed() ? `Nothing waits for you. ${answered} answered, hidden.` : 'Nothing waits for you.')
  fill(box, [none, drawGoalAskNeeds(state), drawBrainstormNeeds(state), ...oldCards, drawRefineNeeds(state), ...cards, drawLegacy(state), drawInformation(state), drawInstructions(state)])
  box.scrollTop = top
  refocus(box, focused)
}

/** Who runs and who was asked to be started: a card that waits for a chat says so, and follows it. */
const runningData = state => [state.chats.map(chat => chat.isRunning), state.advisor?.isRunning ?? null, state.restart?.starting ?? [], state.restart?.main ?? null]
// A card says how long ago it was filed: the minute is part of what is drawn.
const needsData = state => [state.forYou, state.backlogForYou, state.backlogClosed, state.instructions ?? [], state.information ?? [], state.goalAskNeeds ?? [], state.brainstormNeeds ?? [], state.goalsEdit?.canWrite ?? null, showsClosed(), $('needs-order').value, [...chosen], [...problems], [...sending], [...openForms], [...starting], runningData(state), Math.floor(state.readAt / MIN)]

/** Draws again what shows requests: the inbox, and the details when they are open. */
function redrawNeeds() {
  if (board === null) return
  drawMainGame(board)
  drawRestart(board)
  once('needs', needsData(board), () => drawNeeds(board))
  drawDetails(board)
}

const everyNeed = state => [...state.forYou, ...state.backlogForYou, ...state.backlogClosed]
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
      refocus(box, id)
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
      return
    }
    const button = event.target.closest('[data-send]')
    if (button === null || need === undefined) return
    const verdict = button.dataset.send === '' ? null : button.dataset.send
    const text = (drafts.get(id) ?? '').trim()
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
}

takeAnswers($('needs'))
takeAnswers($('details'))
$('prepare-restart').addEventListener('click', () => {
  isAskingRestart = true
  redrawNeeds()
})
$('restart').addEventListener('click', event => {
  const button = event.target.closest('[data-restart]')
  if (button === null || board === null || board.restart.main === null) return
  isAskingRestart = false
  if (button.dataset.restart === 'cancel') return redrawNeeds()
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
  return {
    states: flow.states.map((name, index) => ({ name, tone: index === at ? 'now' : at >= 0 && index < at ? 'past' : 'later' })),
    state: flow.state,
    isKnown: at >= 0,
    next: flow.next.map(move => `${move.to}, by ${move.by.join(' or ')}${move.when === null ? '' : ` when ${move.when}`}`),
  }
}

// item:start
/**
 * B299: the parts of a step's window from the work store, in their order: the Summary on top, the picture, the
 * goal chip, the flow strip, What we build, then Requirements and Touches folded, History last. `item` is the state's
 * `item` of the step; only the parts it has.
 */
function itemPartsOf(item, hasFlow) {
  if (item === null || item === undefined) return []
  const parts = [
    item.summary.length > 0 ? { key: 'summary', title: 'Summary', lines: item.summary, isFolded: false } : null,
    item.picture !== null ? { key: 'picture', title: 'Picture', lines: [item.picture], isFolded: false } : null,
    item.goal !== null ? { key: 'goal', title: 'Goal', lines: [item.goal], isFolded: false } : null,
    hasFlow ? { key: 'flow', title: 'Flow', lines: [], isFolded: false } : null,
    item.what.length > 0 ? { key: 'what', title: 'What we build', lines: item.what, isFolded: false } : null,
    item.requirements.length > 0 ? { key: 'requirements', title: 'Requirements', lines: item.requirements, isFolded: true } : null,
    item.touches.length > 0 ? { key: 'touches', title: 'Touches', lines: item.touches, isFolded: true } : null,
    item.history.length > 0 ? { key: 'history', title: 'History', lines: item.history, isFolded: false } : null,
  ]
  return parts.filter(part => part !== null)
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
  const where = (need.answer ?? null) !== null ? 'answered' : need.canAnswer ? 'here' : 'chat'
  return {
    task: lines,
    hasTask: task !== null && task.text !== '',
    // For a question of the app's form the need's own line only says where to answer: the window says that below.
    summary: where === 'chat' ? '' : need.text ?? '',
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
  const at = mark >= 0 ? mark : text.search(/[.!](?=\s+[A-Z0-9"“])/)
  if (at < 0 || at > 280) return { question: text, rest: '' }
  return { question: text.slice(0, at + 1), rest: text.slice(at + 1).trim() }
}

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
  const option = one => {
    const lettered = one.label.match(/^([A-H])(?:[.:)]\s*|\s+[—–-]\s+|\s+)(.+)$/)
    const words = lettered === null ? one.label : lettered[2]
    const parts = words.match(/^(.{1,60}?)(?::\s+|\s+[—–]\s+)(.+)$/)
    return { verdict: one.label, key: lettered?.[1] ?? null, title: parts === null ? words : parts[1], text: parts === null ? '' : parts[2], isAdvised: one.isRecommended === true }
  }
  if ((need.options ?? []).length > 0) return need.options.map(option)
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
  if (material === '' && form.length === 0) main.push(el('p', 'muted', waiting.where === 'answered' ? 'It has your answer and went on.' : 'It waits for you, and said no more.'))
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
    detailsShown = null
    drawDetails(board)
    return
  }
  // B269: a card of the calm window picks that answer; a second click takes it back.
  const pick = event.target.closest('[data-calm-pick]')
  if (pick !== null && detailsOf?.need !== undefined) {
    const id = detailsOf.need
    calmPicks.set(id, calmPicks.get(id) === pick.dataset.calmPick ? null : pick.dataset.calmPick)
    problems.delete(id)
    detailsShown = null
    drawDetails(board)
    $('details').querySelector(`[data-calm-pick="${CSS.escape(pick.dataset.calmPick)}"]`)?.focus()
    return
  }
  if (event.target.closest('[data-calm-send]') !== null && detailsOf?.need !== undefined) sendCalm(detailsOf.need)
})
$('details').addEventListener('input', event => {
  // B269: the note of the calm window, kept per ask until it is sent.
  if (!event.target.matches('[data-calm-words]') || detailsOf?.need === undefined) return
  calmWords.set(detailsOf.need, event.target.value)
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
  if (wants.length === 0) wants.push(el('p', 'muted', waiting.where === 'answered' ? 'It has your answer and went on.' : 'It waits for you, and said no more.'))
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
  if (compaction.kind === 'skipped') {
    const [, words, isWarning] = NOT_COMPACTED.find(([pattern]) => pattern.test(compaction.why))
    return words === null ? null : { text: words, title: `Workers mod at ${clockOf(compaction.at)}: ${compaction.why}`, isWarning }
  }
  // B247: an after of 0 is not known yet (the mod writes it before the size is known): only the size before is said.
  const [before, after] = [tokensOf(compaction.before), compaction.after > 0 ? tokensOf(compaction.after) : null]
  const text = `compacted at ${clockOf(compaction.at)}${before === null ? '' : `, from ${before}${after === null ? '' : ` to ${after}`} tokens`}`
  return { text, title: text, isWarning: false }
}

const LANE_WINDOW_STATES = { working: 'Working', suspended: 'Suspended', interrupted: 'Cut off' }

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
  const chip = LANE_WINDOW_STATES[lane.state]
  if (chip === undefined) return null
  const task = lane.task ?? null
  const given = lane.givenTask ?? null
  const line = stepLine(lane, now)
  const time = timeOf(lane, now)
  return {
    code: laneTaskOf(lane).code,
    title: laneTaskOf(lane).text ?? 'Task not recorded yet',
    chips: [{ text: chip, tone: 'kind' }, { text: `Worker: ${lane.name}`, tone: 'to' }],
    // B301: only the person's words give a task; the main chat's messages give none.
    given: given === null || given.by !== 'you' ? null : { from: `Typed by you, ${clock(given.at)}`, text: given.text },
    step: given?.step ?? null,
    // B157: the top part: the task in one short sentence, and its plan in plain words. B281: for a backlog step, the
    // step's id and title above it, and what the step is; the person's feedback the worker is on as a part apart.
    taskHead: (given?.step ?? null) === null ? null : `${given.step.id} · ${given.step.title}`,
    task: (given?.step ?? null) === null
      ? shortTask(given?.text ?? null, null, task === null || task.text === '' ? null : task.text)
      : given.by === 'step' ? stepTask('', given.step) : stepTask(given.text, given.step, task === null || task.text === '' ? null : task.text),
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
    // B157: below, folded: the task as it was given, its backlog step, where it stands.
    view => foldedDetails([
      section('Its task as it was given', view.given === null
        ? [el('p', 'muted', 'The message that gave it this task is not in the part of its chat the board reads.')]
        : [el('small', 'muted', view.given.from), rich(el('div', 'said-words'), view.given.text)]),
      view.step === null ? null : section('Backlog step', [el('p', '', `${view.step.id} · ${view.step.title}`)]),
      section('Where it stands', view.standing.map(line => el('p', '', line))),
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

/** B281: a working worker's task: the backlog step it is on ("B231 · title"), then what it is in two lines. */
const taskNodes = view => [...(view.taskHead === null ? [] : [el('p', 'brief-head', view.taskHead)]), briefTask(view.task)]

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
  const typing = box.contains(document.activeElement) && document.activeElement.matches('[data-calm-words]')
  const wasAt = box.dataset.calmAt === need.id
  const scroll = wasAt ? box.querySelector('.details-body')?.scrollTop ?? 0 : 0

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
  ask.append(el('h3', 'calm-question', capitalized(question)))
  const why = [rest, need.text].filter(one => one !== '').join(' ')
  if (why !== '') ask.append(el('p', 'calm-why', why))
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
    const cards = el('div', 'calm-cards')
    cards.setAttribute('role', 'radiogroup')
    cards.setAttribute('aria-label', group.length > 1 ? `Your answer to question ${at + 1}` : 'Your answer')
    for (const card of cardList) {
      const button = el('button', `calm-card${pick === card.verdict ? ' is-chosen' : ''}`)
      button.type = 'button'
      button.dataset.calmPick = card.verdict
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(pick === card.verdict))
      const title = el('span', 'calm-card-title')
      if (card.key !== null) title.append(el('span', 'calm-key', card.key))
      title.append(el('span', '', capitalized(card.title)))
      if (card.isAdvised) title.append(el('span', 'calm-advised', 'Recommended'))
      const cardWords = el('span', 'calm-card-words')
      cardWords.append(title)
      if (card.text !== '') cardWords.append(el('span', 'calm-card-text', capitalized(card.text)))
      button.append(el('span', 'calm-dot'), cardWords)
      cards.append(button)
    }
    part.append(cards)
  }

  // Everything else, folded behind one line.
  const context = el('details', 'task-details calm-context')
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
  const problem = group.map(one => problems.get(one.id)).find(one => one !== undefined)
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
    const send = button(calmSendText(group), 'is-send')
    send.dataset.calmSend = ''
    send.disabled = group.some(one => sending.has(one.id))
    send.title = `Goes to ${need.from ?? 'the board'}`
    buttons.append(send)
  }
  form.append(buttons)
  foot.append(form)

  const body = el('div', 'details-body is-single calm-body')
  body.append(main)
  box.classList.add('is-calm')
  box.dataset.calmAt = need.id
  keepUnfolded(box, () => fill(box, [head, body, foot]))
  body.scrollTop = scroll
  if (typing) {
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }
}
// calmwindow:end

// calmsend:start
/**
 * B269: Send in the calm window: every answer given in it goes to the work store, which wakes the chat. A No without
 * words, or words on a look without a pick, is not sent: the window shows that question and says why. Questions left
 * without an answer stay open on the board. Sent without a problem, the window closes.
 */
async function sendCalm(id) {
  const need = findNeed(id)
  if (board === null || need === undefined) return
  const group = calmGroup(need, everyNeed(board))
  const answers = group.map(one => ({ need: one, answer: calmAnswer(one, calmPicks.get(one.id) ?? null, calmWords.get(one.id) ?? '') }))
  for (const one of group) problems.delete(one.id)
  const lacking = answers.find(one => one.answer?.lacks !== undefined)
  if (lacking !== undefined) {
    detailsOf = { ...detailsOf, need: lacking.need.id }
    return fail(lacking.need.id, lacking.answer.lacks === 'words' ? 'Say in the note why No: the chat needs to know what to change.' : 'Pick an answer first.')
  }
  const given = answers.filter(one => one.answer !== null)
  if (given.length === 0) return fail(id, 'Pick an answer first.')
  for (const { need, answer } of given) {
    await sendWork({ action: 'answer', id: need.workId, ...answer }, need.id)
    if (problems.has(need.id)) {
      detailsOf = { ...detailsOf, need: need.id }
      detailsShown = null
      return drawDetails(board)
    }
    calmPicks.delete(need.id)
    calmWords.delete(need.id)
  }
  // The cards on the right say where the answers are.
  if (group.some(one => one.id === detailsOf?.need)) closeDetails()
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
  if (subject === null) {
    // What it was about is gone: answered, closed, or handed out.
    if (box.open) box.close()
    detailsOf = null
    return
  }
  if (subject.laneTask !== undefined) return drawLaneWindow(box, subject.laneTask, state)
  const { need, lane, place } = subject
  const step = subject.step ?? (need === null ? lane.queue[place] : null)
  const now = state.readAt
  // Drawn again only when what it shows has changed, so reading and typing in it are left alone.
  // B269: a calm window also follows the other asks it goes through.
  const calmIds = isCalm(need) ? calmGroup(need, everyNeed(state)).map(one => one.id) : null
  const showing = JSON.stringify([detailsOf, need ?? subject.step ?? [lane.name, lane.queue], [...chosen], [...problems], [...sending], [...starting], runningData(state), state.changeAsks ?? null, state.advisor?.name ?? null, calmIds])
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
  box.classList.remove('is-calm')
  const head = detailsHead(view, el('span', `kind is-${need === null ? 'queued' : need.kind}`, need === null ? '≡' : KINDS[need.kind].sign), now)

  // The left column, the wider one: what it is about and what to look at
  // B299: a step of the store shows its Touches in the item's folded part, not a second time among the notes.
  const itemNow = need === null ? itemFor(subject.step ?? step ?? null, state) : null
  const notes = noteParts((itemNow?.touches.length ?? 0) > 0 ? view.notes.filter(note => note.title !== 'Touches') : view.notes)
  // A request a chat filed has its own text. A step of the backlog is one line, which is the title above; what
  // describes it further are the lines written under it.
  const words = need !== null && !isStep(need) && need.text !== '' ? [el('p', '', need.text)] : []
  // The step's own line in full: the title above is the short of it.
  const full = need !== null && isStep(need) && typeof need.words === 'string' && need.words !== need.title ? [el('p', '', need.words)] : []
  const described = [...words, ...full, ...notes.lead]
  const left = el('div', 'details-main')
  // B100: a worker that waits: its task in a few lines, then what it wants, in place of a description.
  const waiting = waitingOf(need, now)
  const waitingShown = waiting === null ? null : waitingParts(waiting, need.id)
  if (waitingShown !== null) left.append(...waitingShown.main)
  // B94: "nothing more is written" only when nothing is: a step whose lines are its checklist and its context
  // has them on the right.
  // B296: where the step stands in the flow (flow.json), from the work store.
  const strip = flowStripOf(flowFor(subject.step ?? step ?? null, need, state))
  // B299: a step's window shows its item from the work store: Summary, picture, goal, the strip, What we
  // build, Requirements and Touches folded; its History comes last.
  const itemParts = itemPartsOf(itemNow, strip !== null)
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
  else {
    if (isReady) left.append(refine)
    if (waiting !== null) { /* said above */ } else if (described.length > 0) left.append(section(isReady ? 'Notes' : 'Description', described))
    else if (!view.hasNotes && !isSummed) left.append(section('Description', [el('p', 'muted', 'Nothing more is written about it. Lines under the step in the backlog show here.')]))
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
    form.append(...optionChoices(need), ...answerPart(need, state, false))
    foot.append(form)
  }
  // B181: a step of the Backlog tab that nobody has: "Add to queue" in its foot, as in its row.
  const queue = need === null && subject.step !== undefined ? queuePart(subject.step, state, true) : null
  if (queue !== null) foot.append(queue)
  // B83: a step in a worker's queue can move to another worker, or out of the queue.
  const change = need === null && subject.step === undefined && lane !== null && lane !== undefined ? queueChangePart(lane, step, state) : null
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
  if (part.key === 'summary') return section('Summary', part.lines.map(one => el('p', '', one)))
  // B293: what we build as the refine shows it, "Not in it" greyed.
  if (part.key === 'what') return section('What we build', [buildList(part.lines)])
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
  if ($('details').open) $('details').close()
  if (location.hash.startsWith('#details=') || location.hash.startsWith('#task=')) history.replaceState(null, '', location.pathname)
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
  // B181: a step nobody has, asked for the queue from its window.
  const queue = event.target.closest('[data-queue-step]')
  if (queue !== null) return askQueue(queue)
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
  const code = decodeURIComponent(location.hash.slice('#details='.length))
  const need = everyNeed(state).find(one => one.step === code || one.id === code)
  if (need !== undefined) return openDetails({ need: need.id })
  for (const lane of state.chats) {
    const place = lane.queue.findIndex(step => step.id === code)
    if (place >= 0) return openDetails({ lane: lane.name, place, id: code })
  }
}

// Pictures, large: a window of its own, so it also opens over the details

/** A picture the board may show, large, with its caption; nothing when the board will not show it. */
function openPicture(path, caption) {
  pictureUrl(path).then(url => {
    if (url === null) return
    $('lightbox-picture').src = url
    $('lightbox-caption').textContent = caption || path
    if (!$('lightbox').open) $('lightbox').showModal()
  })
}

document.addEventListener('click', event => {
  const frame = event.target.closest('[data-zoom]')
  if (frame !== null) openPicture(frame.dataset.zoom, frame.dataset.caption)
})

// B208: a phone is a screen up to 600 px wide, as the style sheet has it.
const PHONE = matchMedia('(max-width: 600px)')

$('lightbox').addEventListener('click', event => {
  // B208: on a phone a tap on the picture keeps it open, to pinch and move it; a tap beside it closes it.
  if (PHONE.matches && event.target === $('lightbox-picture')) return
  $('lightbox').close()
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
  fill($('advisor-refine'), [el('h3', '', 'Refine'), el('p', 'muted', 'Every step a chat can do, by where its refine stands: a step goes into a queue once it is ready. Click one to open it.'), ...parts])
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
  return parts.join(' · ')
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
function goalOutlineRows(goals, focusId, opened) {
  const focus = goalById(goals, focusId) === null ? null : focusId
  const chain = new Set(goalCrumb(goals, focus).map(one => one.id).filter(id => id !== null))
  const rows = []
  const walked = new Set()
  const walk = (id, depth, isRef, inFocus) => {
    const node = goalById(goals, id)
    if (node === null || (!isRef && walked.has(id))) return
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
  }
  for (const root of goals.roots) walk(root, 0, false, focus === null)
  return rows
}

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
  if (hash === '#advice' || goalFocusOf(hash) !== undefined) return 'advice'
  if (hash === '#backlog' || hash === '#coordinate') return 'coordinate'
  if (hash === '#design') return 'design'
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

function goalTreeLayout(goals, focusId, width) {
  const focus = goalById(goals, focusId)
  const seen = new Set()
  const once = id => !seen.has(id) && seen.add(id)
  const childIds = (focus === null ? goals.roots : focus.children).filter(id => goalById(goals, id) !== null && once(id))
  const refIds = focus === null ? [] : goals.nodes.filter(other => other.id !== focus.id && other.alsoPartOf.includes(focus.id) && once(other.id)).map(other => other.id)
  const shown = new Set([...childIds, ...refIds, ...(focus === null ? [] : [focus.id])])
  // The arrows between goals in view, and one ghost per goal out of view that enables one in view.
  const arrows = []
  const sources = new Map()
  const walked = new Set()
  for (const node of goals.nodes) {
    if (walked.has(node.id)) continue
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
  const bottoms = [frame === null ? 0 : frame.h, ...boxes.map(box => box.y + box.h), ...ghosts.map(ghost => ghost.y + ghost.h + (moreGhosts > 0 ? 18 : 0))]
  return { width, height: Math.max(...bottoms) + 20, frame, boxes, lines, arrows, ghosts, moreGhosts }
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
  return [state.goals ?? null, state.goalsFile ?? null, state.goalsEdit ?? null, goalsFocus, [...goalsOpened], goalsLinesOpen, editing, [...goalsUi.chosen], goalsUi.confirm, goalsUi.note, goalsUi.undoable, goalsUi.busy, goalsUi.menu, goalsUi.menuInto, goalsViews, state.advisor?.name ?? null, state.advisor?.isRunning ?? null, state.goalAsksFolder ?? null]
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
  const canEdit = canEditGoals(state)
  drawUnlinked(goals)
  // B257: the view buttons say what shows at this width (a phone shows the outline unless the diagram is chosen).
  showGoalsViews()
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
  const rows = goalOutlineRows(goals, focus?.id ?? null, goalsOpened)
  const chain = new Set(crumb.map(step => step.id).filter(id => id !== null))
  const drawn = rows.map(row => {
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
}

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
  const layout = goalTreeLayout(goals, focus?.id ?? null, width)
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
    if (goalHasOpenInside(board.goals, id) && !isConfirmed('done', id)) {
      if (!isConfirming('done', id)) goalsAsk('done', id)
      return redrawGoals()
    }
    goalsUi.confirm = null
    close()
    return sendGoals({ command: 'state', id, state: 'done' })
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
  if (result !== null && result.unchanged !== true) goalsUi.undoable = body.command === 'ask' || body.command === 'read' ? 0 : body.command === 'undo' ? Math.max(0, goalsUi.undoable - 1) : Math.min(20, goalsUi.undoable + 1)
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

/** The dot: the next state; done with open goals inside asks once. */
async function goalsCycle(id) {
  const node = board?.goals ? goalById(board.goals, id) : null
  if (node === null) return
  const next = goalNextState(node.state)
  if (next === 'done' && goalHasOpenInside(board.goals, id) && !isConfirmed('done', id)) {
    // A double-click is not the second click it asks for.
    if (!isConfirming('done', id)) goalsAsk('done', id)
    return redrawGoals()
  }
  goalsUi.confirm = null
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
    question: isOpen ? { n: latest.n, text: latest.text, why: latest.why, picture: latest.picture } : null,
    options: isOpen ? latest.options : [],
    canAnswer: isOpen,
    canBack: isOpen && thread.earlier.length > 0,
    waiting,
    earlier: asked.map(question => ({ n: question.n, text: question.text, answerText: brainstormAnswerText(question) })),
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
    box.append(el('h4', 'brainstorm-question', view.question.text))
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
  if (thread.problems.length > 0) box.append(el('p', 'brainstorm-problems', `The thread has ${thread.problems.length === 1 ? 'a line' : 'lines'} the board cannot read (${thread.problems.slice(0, 3).join(' · ')}${thread.problems.length > 3 ? ' …' : ''}): ask the Advisor to write ${thread.problems.length === 1 ? 'it' : 'them'} as roles/advisor.md shows.`))
  if (thread.proposal !== null) box.append(proposalPart(thread, canWrite))
  if (thread.state === 'discarded') box.append(el('p', 'muted', 'Discarded: nothing of it was created.'))
  if (view.earlier.length > 0) {
    const earlier = el('details', 'brainstorm-earlier')
    earlier.append(el('summary', '', `Earlier in this brainstorm (${view.earlier.length})`))
    for (const one of view.earlier) {
      const line = el('p', '')
      line.append(el('b', '', `Q${one.n} `), one.text, el('span', 'muted', ` → ${one.answerText}`))
      earlier.append(line)
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
  if (view.steps.length > 0) part.append(el('h5', '', 'New steps for the backlog'), ...view.steps.map(step => tick(step, step.title, `${step.worker} · ${step.cost}`)))
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
  if (tool === 'brainstorm') return openBrainstorm(focus)
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
window.addEventListener('popstate', () => {
  const focus = goalFocusOf(location.hash)
  if (focus === undefined) {
    const tab = tabOfAddress(location.hash)
    if (tab === null) return
    show(tab)
    if (tab === 'advice' && $('view-advice').dataset.pane === 'goals') showAdvisorPane('way')
    return
  }
  goalsFocus = focus
  goalsOpened.clear()
  goalsLinesOpen = false
  show('advice')
  showAdvisorPane('goals')
  redrawGoals()
})

// B195: the Advisor's tab in parts: the way to the next milestone first, then the game plan, the suggestions and
// the chat. The person, 2026-10-14: the details go to "different tabs and the main tab only shows some visual
// simplistic flow"; the chat is one of those parts, not a tab of the board's own ("i Do not want a 5th tab").
// B255: the goal map is the second part. B259: the brainstorm the third ("B", its own part).
const ADVISOR_PANES = ['way', 'goals', 'brainstorm', 'plan', 'suggestions', 'refine', 'chat']
function showAdvisorPane(name) {
  const pane = ADVISOR_PANES.includes(name) ? name : 'way'
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
  showAdvisorPane(linked === undefined ? saved : 'goals')
}

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
    return fill(box, [head, el('p', 'muted', `Its way is not mapped yet: the Advisor adds its steps as sub-goals in the goal map (${state.goalsFile ?? '.claude/goals.md'}) at its next round.`), ...recommendationPart(way.recommendation ?? null, state)])
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

/** B195: the Advisor's recommendation under the way: yes goes to the main chat, no with a reason to the Advisor. */
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
    box.append(el('p', 'way-answered', answer.answer === 'yes'
      ? `You said yes at ${clock(answer.at)}${sent}: ${main} puts it on the backlog when it is not there and hands it out.`
      : `You said no at ${clock(answer.at)}${sent}: the Advisor proposes another step at its next round.`))
    return [box]
  }
  const canYes = (state.workers?.main ?? null) !== null
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
  box.append(el('p', 'way-where muted', `Yes: ${main} puts it on the backlog when it is not there and hands it out. No: you say why, and the Advisor proposes another step at its next round.`))
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
    send({ to: board.workers.main, command: 'recommend', about: rec.id, answer: 'yes' }, 'recommend')
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
    $('lightbox-picture').src = URL.createObjectURL(await answer.blob())
    $('lightbox-caption').textContent = shown
    if (!$('lightbox').open) $('lightbox').showModal()
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
 * a step whose answers are all in and wait for it to fold them in; null when neither. `{ step, text, tone }`.
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
  const answered = steps.find(step => step.refineState === 'answered' && (step.status === 'open' || step.status === 'queued'))
  return answered === undefined ? null : { step: answered.id, text: `Your answers on ${answered.id} wait for it`, tone: 'waiting' }
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
    const note = { expired: 'did not arrive, and is too old to deliver now', failed: 'could not be typed into its chat', taken: 'handed to its chat, which runs it when it is idle', copied: 'copied for you to paste into its chat' }[typed.state] ?? 'waits for its chat to take it'
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
    const waits = { expired: 'did not arrive, and is too old to deliver now', failed: 'could not be typed into its chat', taken: 'handed to its chat, which runs it when it is idle', copied: 'copied for you to paste into its chat' }[typed.state] ?? 'waits for its chat to take it'
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
  const list = rows.length === 0 ? el('p', 'muted finished-none', 'No finished step has a time the board can find yet.') : el('ol', 'finished-list')
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
 * step left is left out. `counts` says how many open steps each filter holds, whatever is searched for. B164: with
 * `asOne`, every step that passes is in one group (`isOne`) without the activities, the highest id on top and a step
 * from before the ids at the end, each with the name of its activity. B250: with `hideBusy`, the steps a worker is on
 * or that wait in a queue are left out, and `hidden` says how many of those the filter and the search would show.
 */
function coordinateList(activities, { filter = 'all', find = '', showDone = false, asOne = false, hideBusy = false } = {}) {
  const counts = {}
  for (const [name] of COORDINATE_FILTERS) counts[name] = 0
  const groups = []
  let shown = 0
  let hidden = 0
  for (const activity of activities) {
    const steps = []
    for (const step of activity.steps) {
      const isDone = step.status === 'done'
      if (!isDone) for (const [name] of COORDINATE_FILTERS) if (coordinateShows(step, name)) counts[name] += 1
      if (isDone ? !(showDone && filter === 'all') : !coordinateShows(step, filter)) continue
      if (!coordinateFinds(step, find)) continue
      if (hideBusy && (step.status === 'progress' || step.status === 'queued')) hidden += 1
      else steps.push(step)
    }
    if (steps.length > 0) groups.push({ name: activity.name, isFocus: activity.isFocus, steps })
    shown += steps.length
  }
  if (!asOne) return { groups, counts, shown, hidden }
  // B164: "1 long list desc. so last item on the backlog first": by the id's number, a step without one at the end.
  const number = step => (typeof step.id === 'string' ? Number(step.id.slice(1)) : -1)
  const steps = groups.flatMap(group => group.steps.map(step => ({ ...step, activity: group.name })))
    .map((step, index) => ({ step, index }))
    .sort((a, b) => number(b.step) - number(a.step) || a.index - b.index)
    .map(one => one.step)
  return { groups: steps.length === 0 ? [] : [{ name: null, isFocus: false, isOne: true, steps }], counts, shown, hidden }
}

/**
 * B302: the tab's list (`coordinateList`, by activity) regrouped under the goals of the goal map (`goals`: the state's
 * `roots` and `nodes`), nested as there (the person's choice A, 2026-10-18), as rows in the order they are drawn:
 * `{ kind: 'goal', id, title, depth, isMilestone, open, done, under }` and `{ kind: 'step', step, depth, under }`
 * (`under`: the goals it stands in, outermost first; `open` and `done`: the steps shown under it, as they stand). A goal's own steps come before its goals. A step stands under
 * the first goal of the map that names it; the steps under none, and those without an id, end the list under "Not
 * under a goal" (`id` 'none', `isNone`). A goal with nothing shown under it is left out. Null without a goal map: the
 * tab then groups by activity as before.
 */
function goalRows(list, goals) {
  // How many of the steps shown under a goal are open, and how many finished (shown with "Show finished").
  const counted = steps => ({ open: steps.filter(step => step.status !== 'done').length, done: steps.filter(step => step.status === 'done').length })
  if (goals === null || goals === undefined || (goals.roots ?? []).length === 0) return null
  // An id twice in the map: the first one counts, as everywhere on the board (goals.mjs).
  const byId = new Map()
  for (const node of goals.nodes ?? []) if (!byId.has(node.id)) byId.set(node.id, node)
  const steps = list.groups.flatMap(group => group.steps.map(step => ({ ...step, activity: step.activity ?? group.name })))
  const placed = new Set()
  const seen = new Set()
  const walk = (id, depth, under) => {
    const node = byId.get(id)
    if (node === undefined || seen.has(id)) return []
    seen.add(id)
    const inside = [...under, id]
    const own = steps.filter(step => typeof step.id === 'string' && node.steps.includes(step.id) && !placed.has(step.id))
    for (const step of own) placed.add(step.id)
    const inner = node.children.flatMap(child => walk(child, depth + 1, inside))
    if (own.length === 0 && inner.length === 0) return []
    const below = [...own, ...inner.filter(row => row.kind === 'step').map(row => row.step)]
    // A milestone: a goal taken from a part of the game plan other than its goal, as on the goal map.
    const plan = String(node.fromPlan ?? '').trim()
    const isMilestone = plan !== '' && !/^the goal$/i.test(plan)
    return [
      { kind: 'goal', id, title: node.title, depth, isMilestone, ...counted(below), under },
      ...own.map(step => ({ kind: 'step', step, depth: depth + 1, under: inside })),
      ...inner,
    ]
  }
  const rows = goals.roots.flatMap(id => walk(id, 0, []))
  const rest = steps.filter(step => typeof step.id !== 'string' || !placed.has(step.id))
  if (rest.length > 0) {
    rows.push({ kind: 'goal', id: 'none', title: 'Not under a goal', depth: 0, isMilestone: false, isNone: true, ...counted(rest), under: [] })
    rows.push(...rest.map(step => ({ kind: 'step', step, depth: 1, under: ['none'] })))
  }
  return rows
}

/** B302: whether a goal's header stands open: as the person left it (`folds`), else open for a root and a milestone. */
function isGoalOpen(row, folds) {
  if (typeof folds[row.id] === 'boolean') return folds[row.id]
  return row.depth === 0 || row.isMilestone === true || row.isNone === true
}
// coordinate:end

const STEP_STATES = { progress: 'In progress', queued: 'Queued', you: 'Needs your attention', open: 'Open', done: 'Finished' }
let coordinateFilter = 'all'

/**
 * B181: a step nobody has (open, with an id) gets a button that asks the main chat to hand it out; once asked, it
 * says when, until the main chat's note names a worker. The person, 2026-10-14: "I want a button add to queue for the
 * items on the backlog." `isLong` gives the window's wording. Null for any other step.
 */
function queuePart(step, state, isLong) {
  const main = state.workers?.main ?? null
  if (step.status !== 'open' || typeof step.id !== 'string' || main === null) return null
  const mainTitle = state.workers.mainTitle ?? main
  const key = `queue:${step.id}`
  const ask = step.queueAsk ?? null
  // B285: a step goes into a queue only once refined; until then the ask waits on the board.
  if (ask?.isOpen === true && ask.state === 'held') {
    const part = el('span', 'step-queue is-asked', isLong ? `Asked at ${clock(ask.at)}: the Advisor refines it first, then it goes to ${mainTitle} by itself.` : `Refine, then queue`)
    part.title = `Asked at ${clock(ask.at)}: refined first, then handed to ${mainTitle}`
    return part
  }
  if (ask?.isOpen === true) {
    const where = ask.state === 'delivered' ? `in ${mainTitle}'s chat` : `on its way to ${mainTitle}`
    const part = el('span', 'step-queue is-asked', isLong ? `Asked at ${clock(ask.at)}, ${where}: it shows as queued once its note names a worker.` : `Asked ${clock(ask.at)}`)
    part.title = `Asked at ${clock(ask.at)} to hand it out, ${where}`
    return part
  }
  // Refused: the row says so, and why on hover; the window says why in full.
  const button = el('button', `step-queue${problems.has(key) ? ' is-error' : ''}`, sending.has(key) ? 'Asking…' : problems.has(key) ? 'Try again' : 'Add to queue')
  button.type = 'button'
  button.dataset.queueStep = step.id
  button.disabled = sending.has(key)
  // B285: a step that is not refined is refined by the Advisor first (`refineState`, backlog.mjs refineStateOf).
  const isRefined = step.refineState === 'ready'
  button.title = problems.get(key) ?? (isRefined ? `Ask ${mainTitle} to hand it to a worker` : `The Advisor refines it first, then ${mainTitle} hands it to a worker`)
  // Every row has one: the step it is for is in its name.
  button.setAttribute('aria-label', `${button.textContent}: ${step.id} ${step.title}`)
  if (!isLong) return button
  const line = el('div', 'step-queue-line')
  line.append(button, el('span', 'muted', isRefined ? `${mainTitle} picks the worker, or what it waits for.` : `Not refined yet: the Advisor refines it first, then ${mainTitle} picks the worker.`))
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
    const button = el('button', `step-edit-button is-${action}`, sending.has(key) ? '…' : isLong ? `${label} step` : label)
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
    box.append(el('p', 'muted', `Not refined yet. ${advisor ?? 'The Advisor'} sums up what you get, with a picture, its goal and its size, and asks what it needs to know before it is picked up. Your answers are folded into one description under the step.`))
  } else {
    const { refined } = view
    // The older form keeps its heading with the round; the newer one shows no rounds.
    if (!view.isNewForm) {
      heading.append(el('small', '', `${view.meta}${view.isAccepted ? ' · accepted' : ''}`))
      box.append(heading)
    }
    // With the store's item shown, its Summary and picture stand above: not twice.
    box.append(...refinedParts(isItemShown ? { ...refined, summary: '', picture: null, pictureNote: '', build: [] } : refined))
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
  if (open > 0) box.append(el('p', 'muted', `${open} question${open === 1 ? '' : 's'} wait for your answer in the step's window on the Backlog tab.`))
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
    line.append(el('span', 'refine-n', String(index + 1)), el('span', 'refine-text', one.text), advice, choices)
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

/** B181: the click on "Add to queue", in a row of the Backlog tab or in a step's window. */
function askQueue(button) {
  const main = board?.workers?.main ?? null
  if (main === null) return
  button.disabled = true
  send({ to: main, command: 'queue', step: button.dataset.queueStep }, `queue:${button.dataset.queueStep}`)
}

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
  const list = coordinateList(activities, { filter: coordinateFilter, find: $('coordinate-find').value, showDone: $('coordinate-done').checked, asOne: $('coordinate-one').checked, hideBusy: $('coordinate-busy').checked })
  // B250: how many steps the box hides, so none seems lost.
  $('coordinate-busy-count').textContent = $('coordinate-busy').checked ? `(${list.hidden} hidden)` : ''
  $('coordinate-count').textContent = `${list.counts.all} open step${list.counts.all === 1 ? '' : 's'}`
  fill($('coordinate-filters'), COORDINATE_FILTERS.map(([name, label]) => {
    const button = el('button', `choice${name === coordinateFilter ? ' is-chosen' : ''}`, `${label} `)
    button.type = 'button'
    button.dataset.filter = name
    button.append(el('small', '', String(list.counts[name])))
    return button
  }))
  // B302: with "One list" off, the steps stand under the goals of the goal map; by activity only without one.
  const rows = $('coordinate-one').checked ? null : goalRows(list, state.goals ?? null)
  const groups = rows !== null ? drawGoalRows(rows, state) : list.groups.map(group => {
    const box = el('section', `coordinate-group${group.isFocus ? ' is-focus' : ''}${group.isOne ? ' is-one' : ''}`)
    const heading = el('h2', '', group.isOne ? 'Every step, newest first' : group.name)
    if (group.isFocus) heading.append(el('span', 'chip is-focus', 'Focus'))
    heading.append(el('small', '', String(group.steps.length)))
    box.append(heading)
    for (const step of group.steps) box.append(coordinateLine(step, state))
    return box
  })
  // B302: a goal's header the keyboard was on keeps the focus when the list is drawn anew.
  const focusedGoal = $('coordinate-list').contains(document.activeElement) ? document.activeElement.dataset?.goalFold ?? null : null
  fill($('coordinate-list'), groups.length > 0 ? groups : [el('p', 'muted', activities.length === 0 ? 'The backlog could not be read.' : 'No step matches.')])
  if (focusedGoal !== null) $('coordinate-list').querySelector(`[data-goal-fold="${focusedGoal}"]`)?.focus()
}

/** A step's line on the Backlog tab: its row, which opens its window, with "Add to queue", Close and Delete beside it. */
function coordinateLine(step, state) {
  const row = el('button', `step-row is-${step.status}`)
  row.type = 'button'
  row.dataset.openStep = step.key
  row.title = [step.title, step.activity ?? null, 'Show the details'].filter(Boolean).join('\n')
  row.append(
    el('span', 'step-id', step.id ?? ''),
    el('span', `step-kind${step.asks === null ? ' is-none' : ''}`, step.asks === null ? '' : ASKS[step.asks] ?? ''),
    el('span', 'step-title', step.title),
    el('span', 'step-worker', step.worker ?? (step.status === 'you' ? 'You' : '')),
    el('span', 'step-branch', step.branch ?? ''),
    el('span', `step-state is-${step.status}`, STEP_STATES[step.status] ?? step.status),
    // Room for what B83 will put here (stop a task, move a queued step, take one out of a queue). B181's "Add to
    // queue" stands over it, beside the row's own button: a button holds no other.
    el('span', 'step-actions'),
  )
  const line = el('div', 'step-line')
  line.append(row)
  const queue = queuePart(step, state, false)
  if (queue !== null) line.append(queue)
  // B221: Close and Delete, shown on the row the pointer or the keyboard is on.
  const edit = editPart(step, false)
  if (edit !== null) {
    line.append(edit)
    if (queue !== null) line.classList.add('has-queue')
  }
  return line
}

/**
 * B302: the goals the person folded or opened on the Backlog tab, kept in this browser: `{ G3: true, G2: false }`;
 * without storage, for as long as the page is open.
 */
let goalFoldsHere = {}
function goalFolds() {
  try {
    const kept = JSON.parse(localStorage.getItem('backlog-goal-folds') ?? 'null')
    if (kept !== null && typeof kept === 'object') return kept
  } catch {
    // No storage, or what it held is not readable: the folds of this page.
  }
  return { ...goalFoldsHere }
}

/**
 * B302: the rows of `goalRows` as the tab shows them: a header per goal, which folds, indented by its depth, with its
 * G id, its title and how many of its steps are open; under it its steps. What stands in a folded goal is not drawn.
 */
function drawGoalRows(rows, state) {
  const folds = goalFolds()
  const goals = new Map(rows.filter(row => row.kind === 'goal').map(row => [row.id, row]))
  const box = el('section', 'coordinate-group is-goals')
  for (const row of rows) {
    if (row.under.some(id => !isGoalOpen(goals.get(id), folds))) continue
    if (row.kind === 'step') {
      const line = coordinateLine(row.step, state)
      line.classList.add('goal-steps')
      line.style.setProperty('--depth', String(row.depth))
      box.append(line)
      continue
    }
    const isOpen = isGoalOpen(row, folds)
    const head = el('button', `goal-head${row.depth === 0 ? ' is-root' : ''}${row.isMilestone ? ' is-milestone' : ''}${row.isNone ? ' is-none' : ''}`)
    head.type = 'button'
    head.dataset.goalFold = row.id
    head.setAttribute('aria-expanded', String(isOpen))
    head.style.setProperty('--depth', String(row.depth))
    // What stands under it as shown: the filters and the search count, as the rows do.
    const count = `${row.open} open${row.done > 0 ? ` · ${row.done} done` : ''}`
    const sign = el('span', 'goal-fold', isOpen ? '▾' : '▸')
    sign.setAttribute('aria-hidden', 'true')
    head.append(sign, ...(row.isNone ? [] : [el('span', 'goal-id', row.id)]), el('span', 'goal-title', row.title), el('small', 'goal-count', count))
    head.title = isOpen ? 'Fold this goal' : 'Unfold this goal'
    box.append(head)
  }
  return [box]
}

// B302: a goal's header folds or unfolds it; this browser keeps it.
$('coordinate-list').addEventListener('click', event => {
  const head = event.target.closest('[data-goal-fold]')
  if (head === null) return
  const folds = goalFolds()
  folds[head.dataset.goalFold] = head.getAttribute('aria-expanded') !== 'true'
  goalFoldsHere = folds
  try {
    localStorage.setItem('backlog-goal-folds', JSON.stringify(folds))
  } catch {
    // Kept for this page only.
  }
  if (board !== null) drawCoordinate(board)
})

$('coordinate-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]')
  if (button === null) return
  coordinateFilter = button.dataset.filter
  if (board !== null) drawCoordinate(board)
})
$('coordinate-find').addEventListener('input', () => { if (board !== null) drawCoordinate(board) })
$('coordinate-done').addEventListener('change', () => { if (board !== null) drawCoordinate(board) })
// B164: one list or by activity, kept in this browser. B179: one list unless this browser chose otherwise (the
// person, 2026-10-14: "one list checkbox turned on by default").
try {
  $('coordinate-one').checked = localStorage.getItem('backlog-one') !== 'no'
} catch {
  // Without storage the tab opens as one list, as the page says.
}
$('coordinate-one').addEventListener('change', () => {
  try {
    localStorage.setItem('backlog-one', $('coordinate-one').checked ? 'yes' : 'no')
  } catch {
    // Kept for this page only.
  }
  if (board !== null) drawCoordinate(board)
})
// B250: the steps a worker is on or that wait in a queue hidden, kept in this browser; off unless it chose otherwise.
try {
  $('coordinate-busy').checked = localStorage.getItem('backlog-hide-busy') === 'yes'
} catch {
  // Without storage the box starts off.
}
$('coordinate-busy').addEventListener('change', () => {
  try {
    localStorage.setItem('backlog-hide-busy', $('coordinate-busy').checked ? 'yes' : 'no')
  } catch {
    // Kept for this page only.
  }
  if (board !== null) drawCoordinate(board)
})
// A step for the person opens its card, with the answer; any other step opens as the step it is.
$('coordinate-list').addEventListener('click', event => {
  const queue = event.target.closest('[data-queue-step]')
  if (queue !== null) return askQueue(queue)
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
  if (idea === null) return { idea: null, version: null, making, canMake, canAgain: false, canAgree: false, canTakeBack: false, canRetry: false, form: 'locked' }
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

/** What "Put on the backlog" (`where: 'backlog'`) and "Put in a queue" (`'queue'`) send, or why not. */
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
  return { body: { action: 'send', idea: idea.id, where, title, description, requirements, worker: form.worker === '' ? null : form.worker, minutes } }
}

/** The form an agreed idea starts with: a title from the idea's first line, the idea as the description. */
function firstForm(idea) {
  const words = String(idea.text ?? '').trim()
  const first = words.split('\n')[0]
  const title = first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first
  return { title: title.charAt(0).toUpperCase() + title.slice(1), description: words, requirements: [''], worker: '', time: '' }
}

/** What to say when the board's own reference pictures for a kind of idea are not there: the picture may fit the game less. */
function missingOf(design, kind) {
  const missing = (design?.kinds ?? []).find(one => one.id === kind)?.missing ?? []
  return missing.length === 0 ? '' : ` The board misses ${missing.length === 1 ? 'a reference picture' : `${missing.length} reference pictures`} for this kind, so the picture may fit the game less.`
}

/** Where the asking for the step is, in words. `main` is the main chat's name. */
function sentWords(sent, main = null) {
  const who = main ?? 'the main chat'
  const what = sent.where === 'queue' ? `put in ${sent.worker === null ? 'a queue' : `the queue of ${sent.worker}`}` : 'put on the backlog'
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

/** What the person chose and typed on the Design tab; a redraw must not undo it. */
const designChosen = { idea: null, version: null }
const designDraft = { text: '', kind: null, references: [] }
const designForms = new Map()
const designChanges = new Map()
const designProblems = { make: null, picture: null, form: null }
let isDesignSending = false
let designFormOf = null
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
  const form = idea === null ? null : designForms.get(idea.id) ?? firstForm(idea)
  if (idea !== null && isOpen && !designForms.has(idea.id)) designForms.set(idea.id, form)
  const shown = `${idea?.id ?? ''}:${view.form}`
  if (designFormOf !== shown) {
    designFormOf = shown
    $('design-title').value = form === null || view.form === 'locked' ? '' : idea.sent?.title ?? form.title
    $('design-description').value = form === null || view.form === 'locked' ? '' : form.description
    $('design-time').value = form === null || view.form === 'locked' ? '' : form.time
    drawRequirements(form === null || view.form === 'locked' ? { requirements: [''] } : form, !isOpen)
  }
  once('design-workers', [(board?.chats ?? []).map(lane => [lane.name, lane.isMain, lane.isLeftover]), main], () => {
    const first = el('option', '', `Let ${main ?? 'the main chat'} decide`)
    first.value = ''
    fill($('design-worker'), [first, ...(board?.chats ?? []).filter(lane => !lane.isMain && !lane.isLeftover).map(lane => {
      const option = el('option', '', lane.name)
      option.value = lane.name
      return option
    })])
  })
  $('design-worker').value = form === null || view.form === 'locked' ? '' : idea.sent?.worker ?? form.worker
  $('design-fields').disabled = !isOpen
  // Once the step was asked for, what was asked stands in its place.
  $('design-fields').hidden = view.form === 'sent'
  $('design-title').maxLength = limitsOf(design).title
  $('design-description').maxLength = limitsOf(design).description
  $('design-add-line').disabled = !isOpen || (form !== null && form.requirements.length >= limitsOf(design).requirements)
  const cannotSend = design?.canSend === false
  for (const id of ['design-backlog', 'design-queue']) $(id).disabled = !isOpen || isDesignSending || cannotSend
  $('design-agreed').hidden = idea === null || idea.agreed === null
  $('design-form-note').textContent = view.form === 'locked'
    ? (idea === null ? 'Agree with a picture first. Then you say here what you want and where it goes.' : 'Agree with a picture of this idea first: "I agree" under it.')
    : view.form === 'open' && cannotSend ? design.whyNot ?? 'This board cannot ask the main chat for the step.'
      : view.form === 'open' && view.isLost ? 'Your asking did not arrive. Send it again.' : ''
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
  Object.assign(form, { title: $('design-title').value, description: $('design-description').value, worker: $('design-worker').value, time: $('design-time').value })
  for (const input of $('design-requirements').querySelectorAll('[data-requirement]')) form.requirements[Number(input.dataset.requirement)] = input.value
  return form
}

$('design-fields').addEventListener('input', designForm)
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
    if (view.idea === null || form === null || view.form !== 'open') return
    const sent = sendBody(view.idea, form, where, designNow())
    if (sent.problem !== undefined) {
      designProblems.form = sent.problem
      return drawDesign()
    }
    designCall(sent.body, 'form')
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
  // The address says which tab is open, so a reload stays on it. A link to a step's details is left as it is.
  // B149: so is a worker's link to a picture or to the game, until it is followed.
  if (!['#details=', '#task=', '#picture=', '#play='].some(start => location.hash.startsWith(start))) {
    const address = tab === 'overview' ? location.pathname : tab === 'coordinate' ? '#backlog' : tab === 'advice' ? adviceAddress() : `#${tab}`
    // B255: leaving the goal map for another tab keeps its place in the browser's history: Back returns to the goal.
    if (goalFocusOf(location.hash) !== undefined && tab !== 'advice') history.pushState(null, '', address)
    else history.replaceState(null, '', address)
  }
  if (tab === 'advice') $('messages').scrollTop = $('messages').scrollHeight
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
  drawTop(state)
  drawUpdate(state)
  drawAppNote(state)
  drawStoreNote(state)
  drawMainGame(state)
  drawLimits(state)
  drawRestart(state)
  drawLanes(state)
  drawStrips(state)
  drawToday(state)
  once('needs', needsData(state), () => drawNeeds(state))
  // B181: also when an "Add to queue" is on its way or was refused, and when the main chat it asks comes or goes.
  const queueing = [[...sending].filter(key => key.startsWith('queue:')), [...problems].filter(([key]) => key.startsWith('queue:')), state.workers?.main ?? null]
  // B302: the goal map too, which groups the tab when "One list" is off.
  once('coordinate', [state.backlog ?? null, queueing, state.goals ?? null], () => drawCoordinate(state))
  // B155: today's times name no day, so the list is drawn anew when the day changes too.
  once('finished', [state.finished ?? null, state.taskTimes?.byStep ?? null, new Date(state.readAt).toDateString()], () => drawFinished(state))
  drawDetails(state)
  openFromAddress(state)
  // B129: the project's own name from the settings, on the page and in the tab.
  once('name', state.name ?? '', () => {
    $('project-name').textContent = state.name || 'Worker board'
    document.title = state.name ? `${state.name} · Worker board` : 'Worker board'
  })
  once('advice', [state.advice, state.gamePlan ?? null], () => drawAdvice(state))
  // B195: the way to the next milestone, also when an answer to its recommendation is on its way or refused.
  once('way', [state.milestone ?? null, state.goalsFile ?? null, state.workers?.main ?? null, state.advisor?.name ?? null, sending.has('recommend'), problems.get('recommend') ?? null, state.advisor?.roundRuns ?? null, sending.has('recheck'), problems.get('recheck') ?? null], () => drawWay(state))
  once('advice-suggestions', [state.suggestions ?? [], state.rounds?.group ?? null], () => drawSuggestions(state))
  // B286: the steps by where their refine stands, drawn anew only when the list changes.
  const refining = refineGroups(state.backlog)
  once('refine-list', refining, () => drawRefineList(refining))
  // B255: the goal map's outline, when the map or the zoom changes.
  once('goals', goalsData(state), () => drawGoals(state))
  // B259: the brainstorms, when one changes or what the person does on the part.
  once('brainstorm', brainstormData(state), () => drawBrainstorm(state))
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
}

async function read() {
  clearTimeout(timer)
  try {
    const answer = await fetch('/api/state', { headers: { 'X-Board-Token': TOKEN }, cache: 'no-store' })
    // The server was started again and has a new token: a fresh page has it. At most once a minute, so a real
    // refusal cannot make the page load itself over and over.
    if (answer.status === 403 && Date.now() - Number(sessionStorage.getItem('reloaded-at') ?? 0) > MIN) {
      sessionStorage.setItem('reloaded-at', String(Date.now()))
      location.reload()
      return
    }
    if (!answer.ok) throw new Error(String(answer.status))
    draw(await answer.json())
    awaySince = null
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

/**
 * B299: one action of the person on the work store (POST /api/work: the token, the origin, JSON): an answer to an
 * ask, a note read. Its problem shows where `key` says, as for `send`.
 */
async function sendWork(body, key) {
  sending.add(key)
  problems.delete(key)
  redrawNeeds()
  let problem = null
  try {
    const answer = await fetch('/api/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
      body: JSON.stringify(body),
    })
    if (!answer.ok) problem = (await answer.text()).trim() || `refused (${answer.status})`
    else showPaste((await answer.json().catch(() => null))?.paste ?? null)
  } catch {
    problem = 'the board\'s server does not answer'
  }
  sending.delete(key)
  if (problem === null) {
    drafts.delete(key)
    chosen.delete(key)
  } else problems.set(key, `Not sent: ${problem}`)
  await read()
}

// paste:start
/** B212: the line on top that says the words were copied, and into which chat to paste them. */
function pasteLine(paste, isCopied) {
  return isCopied
    ? `Copied for you: open the chat "${paste.chat}" in the Claude app and paste it there (Ctrl+V). No Workers mod types it in for you.`
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
  bar.replaceChildren(el('span', '', pasteLine(paste, isCopied)), copy, close)
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
  if (problem === null) {
    try {
      const answer = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
        body: JSON.stringify({ item: 'branch', branch, action: 'start' }),
      })
      if (!answer.ok) problem = (await answer.text()).trim() || `refused (${answer.status})`
      else {
        const url = new URL((await answer.json()).url)
        url.search = settings
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

for (const id of ['refresh', 'refresh-title']) {
  $(id).append(icon('refresh'))
  $(id).addEventListener('click', read)
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) read()
})

show(tabOfAddress(location.hash) ?? 'overview')
read()
