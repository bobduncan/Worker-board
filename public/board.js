// The worker board's page, second design: an Overview (one lane per worker, the inbox "For you", today's
// timeline) and Advice & Chat. It asks the server for the state and redraws. Everything from a chat, the backlog
// or the advice file is put on the page as text (textContent), never as HTML, so words in a transcript can never
// become part of the page's code.

'use strict'

const TOKEN = document.querySelector('meta[name="board-token"]').content
const STATES = { working: 'Working', waiting: 'Waiting for you', free: 'Free', unknown: 'Unknown' }
const KINDS = {
  input: { sign: '?', tag: 'Input needed' },
  verify: { sign: '✓', tag: 'Verification needed' },
  intervene: { sign: '!', tag: 'Intervention needed' },
  do: { sign: '→', tag: 'Only you can do' },
}
/** What a step in the backlog says it asks of the person. */
const ASKS = { verify: 'Verify', decide: 'Decide', provide: 'Provide', do: 'Do' }
const MIN = 60_000
const HOUR = 60 * MIN
const LONG_CHARS = 700
const UNDELIVERED = 'What you send is kept and shown here. It reaches the chat once the bridge is in.'

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

/** A time that keeps counting between redraws: `data-at` is read again at every look. */
function since(at, now) {
  const node = el('time', '', at === null ? '' : ago(at, now))
  if (at !== null) node.dataset.at = String(at)
  return node
}

const ICONS = {
  refresh: 'M20 11a8 8 0 0 0-14.3-4.5M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5M20 20v-4h-4',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
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

/** Puts text into a node, with **bold** and `code` as the only marks. */
function mark(node, text) {
  const pieces = []
  for (const piece of text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/)) {
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) pieces.push(el('strong', '', piece.slice(2, -2)))
    else if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) pieces.push(el('code', '', piece.slice(1, -1)))
    else if (piece !== '') pieces.push(piece)
  }
  node.replaceChildren(...pieces)
  return node
}

const marked = (tag, className, text) => mark(el(tag, className), text)

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

// The top bar

function drawTop(state) {
  const updated = $('updated')
  updated.textContent = `Last updated ${clock(state.readAt)}${state.isDemo ? ' · demo data' : ''}`
  updated.classList.remove('is-stale')
  fill($('counts'), ['working', 'waiting', 'free', 'unknown']
    .filter(name => name !== 'unknown' || state.counts.unknown > 0)
    .map(name => {
      const pill = el('div', `count-pill is-${name}`)
      pill.append(el('span', 'dot'), el('b', '', String(state.counts[name])), STATES[name].toLowerCase())
      return pill
    }))
  for (const node of document.querySelectorAll('time[data-at]')) node.textContent = ago(Number(node.dataset.at), state.readAt)
}

// The lanes

const about = minutes => (minutes === null ? null : `~ ${span(minutes * MIN)}`)

function drawEta(lane, now) {
  const box = el('div', 'eta')
  const state = (text, isBlocked = false) => el('span', `state${isBlocked ? ' is-blocked' : ''}`, text)
  if (lane.isLeftover) box.append(state('Leftover'))
  else if (lane.state === 'waiting') box.append(el('small', '', 'ETA'), state('Blocked', true))
  else if (lane.state === 'free') box.append(state('Available'))
  else if (lane.state === 'unknown') box.append(state('Unknown'))
  else if (lane.eta !== null && !lane.eta.isOverdue) box.append(el('small', '', 'ETA'), el('b', '', clock(lane.eta.at)), el('small', '', `(${span(lane.eta.leftMs)})`))
  else if (lane.eta !== null) box.append(el('small', '', 'ETA'), state('Overdue', true), el('small', '', `was ${clock(lane.eta.at)}`))
  else box.append(el('small', '', 'ETA'), state('No estimate'), lane.task === null ? '' : el('small', '', `(${span(now - lane.task.startedAt)} so far)`))
  return box
}

/** What is wrong with a lane, when something is: shown only then. */
function alertsOf(lane, state) {
  const alerts = []
  const task = lane.task
  if (lane.isQuiet) alerts.push(`no sign of life for ${span(lane.quietMs)}`)
  if (task !== null && task.firstEstimateMs !== null && task.workedMs > task.firstEstimateMs + MIN) alerts.push(`${span(task.workedMs - task.firstEstimateMs)} over its first estimate`)
  if (lane.state === 'working' && task !== null && task.estimateAt !== null && state.readAt - task.estimateAt > state.estimateOldMs) {
    alerts.push(`estimate ${span(state.readAt - task.estimateAt)} old`)
  }
  return alerts
}

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
    if (task.source === 'prompt') list.append(el('li', 'muted', 'It named no task: this is what started its turn.'))
    if (task.source === 'handover') list.append(el('li', 'muted', 'It recorded no plan: this is the task as it was handed over.'))
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

function drawLane(lane, state) {
  const isOpen = openLanes.has(lane.name)
  const card = el('article', `lane is-${lane.state}${lane.isLeftover ? ' is-leftover' : ''}${isOpen ? ' is-open' : ''}`)
  const row = el('div', 'lane-row')

  const who = el('div', 'who')
  const names = el('div')
  names.append(el('h3', '', lane.name), el('span', `pill is-${lane.state}`, lane.isLeftover ? 'Leftover' : STATES[lane.state]))
  who.append(el('span', 'avatar', lane.name.charAt(0).toUpperCase()), names)

  const what = el('div', 'what')
  const task = lane.task
  if (task === null) {
    what.append(el('p', 'task is-none', lane.state === 'working' ? 'Task not named' : 'No active task'))
    if (lane.state === 'free') what.append(el('p', 'note', 'Ready for a new task'))
  } else {
    const title = el('p', 'task clip')
    title.title = task.text
    if (task.source === 'prompt') title.append(el('span', 'muted', task.by === 'you' || task.by === null ? 'You asked: ' : `${task.by} sent: `))
    title.append(task.text)
    what.append(title)
    if (task.step !== null && task.steps !== null && task.steps > 0) {
      const progress = el('div', 'progress')
      const bar = el('div', 'bar')
      const done = el('div', 'fill')
      done.style.width = `${Math.max(0, Math.min(100, (task.step / task.steps) * 100))}%`
      bar.append(done)
      progress.append(bar, el('span', '', `${task.step} of ${task.steps}`))
      what.append(progress)
    }
  }
  if (lane.state === 'working' && lane.doingNow !== null) {
    const now = el('p', 'now clip')
    now.append(el('b', '', 'Now: '), el('span', '', lane.doingNow))
    what.append(now)
  }
  if (lane.state === 'waiting') what.append(el('p', 'needs-you', 'Needs your decision'))
  const alerts = alertsOf(lane, state)
  if (alerts.length > 0) what.append(el('p', 'alert', alerts.join(' · ')))

  const queue = el('div', 'queue')
  const head = el('button', 'queue-head', `Queue (${lane.queue.length})`)
  head.type = 'button'
  head.dataset.lane = lane.name
  head.title = 'Show the whole queue and the details'
  queue.append(head)
  if (lane.queue.length > 0) {
    const first = el('div', 'queue-first')
    const item = el('button', 'queue-item')
    item.type = 'button'
    item.dataset.lane = lane.name
    item.dataset.step = '0'
    item.title = `${lane.queue[0].text}\nShow the details`
    item.append(el('b', '', lane.queue[0].title), el('small', '', [lane.queue[0].id, about(lane.queue[0].minutes) ?? 'no time given'].filter(Boolean).join(' · ')))
    first.append(item)
    if (lane.queue.length > 1) first.append(el('div', 'queue-more', `+${lane.queue.length - 1}`))
    queue.append(first)
  }

  row.append(who, what, drawEta(lane, state.readAt), queue)
  card.append(row)
  if (isOpen) card.append(drawMore(lane, state))
  return card
}

$('lanes').addEventListener('click', event => {
  const head = event.target.closest('.queue-head')
  if (head === null) return
  if (!openLanes.delete(head.dataset.lane)) openLanes.add(head.dataset.lane)
  if (board !== null) fill($('lanes'), board.chats.map(lane => drawLane(lane, board)))
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
      track.append(bar(`is-${piece.state}`, piece.from, piece.to, `${STATES[piece.state] ?? piece.state}, ${clock(piece.from)} to ${clock(piece.to)}${piece.task === null ? '' : `: ${piece.task}`}`))
      if (piece.task !== null && piece.task !== before) {
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
    entry(el('span', 'dot'), 'Not seen'),
    entry(el('span', 'swatch is-ahead'), 'Expected'),
    entry(el('span', 'swatch is-queued'), 'Queued'),
    entry(el('span', 'mark'), 'Task change'),
    entry(el('span', 'mark is-now'), 'Now'),
  ])
}

// For you

function sentLine(answer) {
  const line = el('div', 'sent')
  const what = { approve: 'You approved', reject: 'You rejected', done: 'You marked it done' }[answer.verdict] ?? 'You answered'
  line.append(el('b', '', what), ` at ${clock(answer.at)} · `, answer.state === 'delivered' ? 'delivered' : 'not delivered yet')
  if (answer.text !== '') line.append(el('div', '', answer.text))
  return line
}

/** A step from the backlog has no chat that asked: it is headed by its activity and says where the answer goes. */
const isStep = need => need.activity !== undefined

/**
 * Closed for the person: ticked in the backlog, or answered here. An answer that did not arrive in time opens it
 * again. Closed ones are hidden unless "Show closed" is ticked.
 */
const isClosed = need => need.isClosed === true || (need.answer !== null && need.answer.state !== 'expired')
const showsClosed = () => $('needs-closed').checked

/**
 * The part of a request that takes the answer: what was sent, or the form its kind needs. `isFolded` keeps the
 * form of a backlog step behind a button until it is opened, so the many steps stay short.
 */
function answerPart(need, state, isFolded) {
  const parts = []
  const answer = need.answer
  if (answer !== null && answer.state !== 'expired') return [sentLine(answer)]
  if (need.isClosed === true) return [el('p', 'muted', 'Closed: ticked in the backlog.')]
  if (answer !== null) parts.push(el('p', 'problem', `Your answer of ${clock(answer.at)} was not delivered in time. Send it again when the chat can take it.`))
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
  text.placeholder = need.kind === 'verify' ? 'Feedback (optional when you approve)…' : need.kind === 'do' ? 'A note (optional)…' : 'Your decision or feedback…'
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
  if (need.kind === 'verify') buttons.append(button('✓  Approve', 'is-approve', 'approve'), button('✕  Reject', 'is-reject', 'reject'))
  else if (need.kind === 'do') buttons.append(button('✓  Done', 'is-approve', 'done'))
  else buttons.append(button('Send', '', ''))
  if (need.kind === 'verify') parts.push(buttons, text)
  else parts.push(text, buttons)
  if (problems.has(need.id)) parts.push(el('p', 'problem', problems.get(need.id)))
  return parts
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

function drawNeed(need, state) {
  const kind = KINDS[need.kind]
  const card = el('article', `need is-${need.kind}${isStep(need) ? ' is-step' : ''}${isClosed(need) ? ' is-closed' : ''}`)
  card.dataset.id = need.id
  // The head of a card opens its details.
  const head = el('div', 'need-head')
  head.dataset.details = need.id
  head.title = 'Show the details'
  const top = el('header', 'need-top')
  if (isStep(need)) top.append(el('span', 'kind', kind.sign), need.step === null ? '' : el('b', '', need.step), el('span', 'tag', ASKS[need.asks] ?? 'Not sorted'), el('small', 'muted', need.activity))
  else top.append(el('span', 'kind', kind.sign), el('b', '', need.from), el('span', 'tag', kind.tag), since(need.at, state.readAt))
  head.append(top, el('h4', '', need.title))
  card.append(head)
  if (need.text !== '') card.append(el('p', '', need.text))
  card.append(...optionParts(need))

  card.append(...gameParts(need))
  if (need.checks.length > 0) card.append(listBox('Key points to check', need.checks))
  if (need.tried.length > 0) card.append(listBox('Already tried', need.tried))
  card.append(...answerPart(need, state, isStep(need)))
  return card
}

function ordered(needs) {
  const order = $('needs-order').value
  const list = [...needs]
  if (order === 'oldest') list.reverse()
  if (order === 'worker') list.sort((a, b) => a.from.localeCompare(b.from) || (b.at ?? 0) - (a.at ?? 0))
  return list
}

function drawLegacy(state) {
  const open = state.backlogForYou.filter(step => !isClosed(step))
  const closed = [...state.backlogForYou.filter(isClosed), ...state.backlogClosed]
  if (open.length === 0 && closed.length === 0) return null
  const box = el('details', 'legacy')
  box.open = isLegacyOpen
  const counts = Object.keys(ASKS).map(asks => [ASKS[asks], open.filter(step => step.asks === asks).length]).filter(([, count]) => count > 0)
  const summary = el('summary', '', `From the backlog (${open.length})`)
  const notes = counts.map(([name, count]) => `${count} ${name.toLowerCase()}`)
  if (closed.length > 0) notes.push(`${closed.length} closed ${showsClosed() ? 'shown' : 'hidden'}`)
  summary.append(el('small', '', notes.join(' · ')))
  box.append(summary)
  for (const step of open) box.append(drawNeed(step, state))
  if (showsClosed()) for (const step of closed) box.append(drawNeed(step, state))
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

function drawNeeds(state) {
  const box = $('needs')
  const focused = focusedNeed(box)
  const top = box.scrollTop
  const open = state.forYou.filter(need => !isClosed(need))
  const answered = state.forYou.length - open.length
  $('needs-count').textContent = open.length === 0 ? '' : String(open.length)
  const cards = ordered(showsClosed() ? state.forYou : open).map(need => drawNeed(need, state))
  const none = open.length > 0 ? null : el('p', 'empty', answered > 0 && !showsClosed() ? `Nothing waits for you. ${answered} answered, hidden.` : 'Nothing waits for you.')
  fill(box, [none, ...cards, drawLegacy(state)])
  box.scrollTop = top
  refocus(box, focused)
}

const needsData = state => [state.forYou, state.backlogForYou, state.backlogClosed, showsClosed(), $('needs-order').value, [...chosen], [...problems], [...sending], [...openForms], [...starting]]

/** Draws again what shows requests: the inbox, and the details when they are open. */
function redrawNeeds() {
  if (board === null) return
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
    send({ to: need.from, ask: id, verdict, text }, id)
  })
}

function fail(id, why) {
  problems.set(id, why)
  redrawNeeds()
}

takeAnswers($('needs'))
takeAnswers($('details'))
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

/** What the details are about: a request by its id, or a queued step by its lane and place. */
let detailsOf = null
let detailsShown = null

function subjectOf(state) {
  if (detailsOf === null) return null
  if (detailsOf.need !== undefined) {
    const need = everyNeed(state).find(one => one.id === detailsOf.need)
    return need === undefined ? null : { need, lane: null, place: -1 }
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

function drawDetails(state) {
  const box = $('details')
  const subject = subjectOf(state)
  if (subject === null) {
    // What it was about is gone: answered, closed, or handed out.
    if (box.open) box.close()
    detailsOf = null
    return
  }
  const { need, lane, place } = subject
  const step = need === null ? lane.queue[place] : null
  const now = state.readAt
  // Drawn again only when what it shows has changed, so reading and typing in it are left alone.
  const showing = JSON.stringify([detailsOf, need ?? [lane.name, lane.queue], [...chosen], [...problems], [...sending], [...starting]])
  if (box.open && detailsShown === showing) return
  detailsShown = showing
  const focused = focusedNeed(box)
  const scroll = box.querySelector('.details-body')?.scrollTop ?? 0

  // The head: what it is, whose it is, where it stands
  const code = need === null ? step.id : need.step ?? null
  const title = need === null ? step.title : need.title
  const meta = need === null
    ? [`Worker: ${lane.name}`, `In queue (${place + 1} of ${lane.queue.length})`, about(step.minutes), step.after === null ? null : `after ${step.after}`]
    : [
        isClosed(need) ? 'Closed' : null,
        isStep(need) ? (ASKS[need.asks] ?? 'Not sorted') : KINDS[need.kind].tag,
        isStep(need) ? need.activity : `From: ${need.from}`,
        isStep(need) && need.from !== null && need.isClosed !== true ? `Answer goes to: ${need.from}` : null,
        need.at === null ? null : `Asked ${ago(need.at, now)}`,
      ]
  const head = el('header', 'details-head')
  const names = el('div', 'details-names')
  const heading = el('h2')
  if (code !== null) heading.append(el('span', 'details-code', code))
  heading.append(title)
  names.append(heading, el('p', 'muted', meta.filter(Boolean).join('  |  ')))
  const close = el('button', 'icon-button', '✕')
  close.type = 'button'
  close.dataset.close = ''
  close.title = 'Close'
  close.setAttribute('aria-label', 'Close')
  head.append(el('span', `kind is-${need === null ? 'queued' : need.kind}`, need === null ? '≡' : KINDS[need.kind].sign), names, close)

  // The left column: what it is about and what to look at
  const notes = noteParts(need === null ? step.notes : need.notes ?? [])
  // A request a chat filed has its own text. A step of the backlog is one line, which is the title above; what
  // describes it further are the lines written under it.
  const words = need !== null && !isStep(need) && need.text !== '' ? [el('p', '', need.text)] : []
  const described = [...words, ...notes.lead]
  const left = el('div', 'details-main')
  left.append(section('Description', described.length > 0 ? described : [el('p', 'muted', 'Nothing more is written about it. Lines under the step in the backlog show here.')]), ...notes.named)
  if (need !== null && need.checks.length > 0) left.append(section('Key points to check', [listOf(need.checks)]))
  if (need !== null && need.tried.length > 0) left.append(section('Already tried', [listOf(need.tried)]))
  const shown = need === null ? step.pictures.map(path => ({ path, caption: '' })) : [
    ...need.options.filter(option => option.picture !== null).map(option => ({ path: option.picture, caption: `${option.label}${option.isRecommended ? ' (recommended)' : ''}` })),
    ...need.pictures.map(path => ({ path, caption: '' })),
  ]
  if (shown.length > 0) {
    const grid = el('div', 'references')
    for (const { path, caption } of shown) {
      const figure = el('figure')
      figure.append(picture(path, caption), el('figcaption', '', caption === '' ? path.split('/').pop() : caption))
      grid.append(figure)
    }
    // The folders the pictures lie in, to open by hand.
    const folders = [...new Set(shown.map(({ path }) => path.split('/').slice(0, -1).join('/')))]
    left.append(section('References', [grid, ...folders.map(folder => copyRow('Folder', folder))]))
  }

  // The right column: where it stands, what else there is to know, where its work lies
  const right = el('div', 'details-side')
  if (need === null) {
    const list = el('ol', 'queue-list')
    lane.queue.forEach((other, index) => {
      const item = el('li', index === place ? 'is-here' : '')
      item.append(el('span', 'place', String(index + 1)), el('span', 'queue-title', other.title), el('small', '', about(other.minutes) ?? ''))
      list.append(item)
    })
    const part = section('Status in queue', [list])
    part.querySelector('h3').append(el('small', 'muted', `${place + 1} of ${lane.queue.length}`))
    right.append(part)
  }
  if (notes.context.length > 0) {
    const context = el('div', 'box')
    context.append(...notes.context)
    right.append(section('Additional context', [context]))
  }

  const branch = need === null ? step.branch : need.branch ?? need.run?.branch ?? null
  const folder = branch === null ? null : [...state.chats.flatMap(one => one.folders), ...state.otherFolders].find(one => one.branch === branch) ?? null
  const files = []
  if (folder !== null) files.push(copyRow('Folder', folder.path))
  if (branch !== null) files.push(copyRow('Branch', branch))
  if (folder !== null) files.push(el('p', 'muted', folderLine(folder, now)))
  if (need !== null) files.push(...gameParts(need))
  if (files.length > 0) right.append(section('Files / Branch', files))

  if (need !== null) {
    // The answer, with the form of its kind. It is the same answer as on the card: what is typed in one shows in the other.
    const form = el('div', `need is-${need.kind} details-answer`)
    form.dataset.id = need.id
    form.append(...optionChoices(need), ...answerPart(need, state, false))
    right.append(section('Your answer', [form]))
  }
  if (right.children.length === 0) right.append(el('p', 'muted', 'Nothing more is known about this step.'))

  // The foot: what a worker estimated, where it stands, and the way out
  const foot = el('footer', 'details-foot')
  if (need === null) {
    const fact = (label, value) => {
      const one = el('div', 'fact')
      one.append(el('small', 'muted', label), el('b', '', value))
      return one
    }
    foot.append(fact('Estimated', about(step.minutes) ?? 'no time given'), fact('Position in queue', `${place + 1} of ${lane.queue.length}`))
  }
  const done = el('button', 'button', 'Close')
  done.type = 'button'
  done.dataset.close = ''
  foot.append(el('span', 'grow'), done)

  const body = el('div', 'details-body')
  body.append(left, right)
  fill(box, [head, body, foot])
  body.scrollTop = scroll
  refocus(box, focused)
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
  if (location.hash.startsWith('#details=')) history.replaceState(null, '', location.pathname)
}

$('details').addEventListener('click', event => {
  // A click beside the window, on the dimmed board, closes it; so does its cross and its Close button.
  if (event.target === $('details') || event.target.closest('[data-close]') !== null) return closeDetails()
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

document.addEventListener('click', event => {
  const frame = event.target.closest('[data-zoom]')
  if (frame === null) return
  pictureUrl(frame.dataset.zoom).then(url => {
    if (url === null) return
    $('lightbox-picture').src = url
    $('lightbox-caption').textContent = frame.dataset.caption || frame.dataset.zoom
    if (!$('lightbox').open) $('lightbox').showModal()
  })
})

$('lightbox').addEventListener('click', () => $('lightbox').close())

// Advice: headings, lists and paragraphs of a plain markdown text

function drawAdvice(state) {
  const box = $('advice-text')
  if (state.advice === null) return fill(box, [el('p', 'muted', 'No advice yet.')])
  const nodes = []
  let list = null
  let item = null
  let paragraph = null
  const flush = () => {
    if (paragraph !== null) nodes.push(marked('p', '', paragraph))
    paragraph = null
  }
  const lines = state.advice.split('\n').map(line => line.replace(/\r$/, ''))
  lines.forEach((line, index) => {
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
      // The panel has the title already.
      if (!(index === 0 && heading[1] === '#')) nodes.push(marked(heading[1].length <= 2 ? 'h3' : 'h4', '', heading[2]))
    } else if (bullet !== null || numbered !== null) {
      flush()
      const kind = bullet !== null ? 'ul' : 'ol'
      if (list === null || list.localName !== kind) {
        list = el(kind)
        if (numbered !== null) list.start = Number(numbered[1])
        nodes.push(list)
      }
      item = { text: (bullet ?? numbered).at(-1), node: null }
      item.node = marked('li', '', item.text)
      list.append(item.node)
    } else if (item !== null && /^\s+\S/.test(line)) {
      // An indented line goes on with the list item above it.
      item.text = `${item.text} ${line.trim()}`
      const again = marked('li', '', item.text)
      item.node.replaceWith(again)
      item.node = again
    } else {
      list = null
      item = null
      paragraph = paragraph === null ? line.trim() : `${paragraph} ${line.trim()}`
    }
  })
  flush()
  fill(box, nodes)
}

// The chat with the advisor

function drawMessage({ key, kind, time, who, text, note = null }) {
  const row = el('div', `message ${kind}`)
  const bubble = el('div', 'bubble')
  if (text.length > LONG_CHARS || text.split('\n').length > 12) {
    bubble.classList.add('is-long')
    bubble.dataset.key = key
    if (openBubbles.has(key)) bubble.classList.add('is-open')
  }
  mark(bubble, text)
  if (note !== null) bubble.append(el('small', '', note))
  row.append(el('time', '', time), el('span', 'speaker', who), bubble)
  return row
}

function drawTalk(state) {
  const advisor = state.advisor
  const box = $('messages')
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60
  $('talk-title').textContent = advisor?.name ?? 'Advisor'
  fill($('talk-state'), [advisor === null ? null : el('span', `pill is-${advisor.state}`, STATES[advisor.state])])
  $('say-send').disabled = advisor === null
  $('say-text').maxLength = state.maxMessageChars
  if (!$('say-note').classList.contains('is-error')) $('say-note').textContent = UNDELIVERED

  const rows = advisor === null ? [] : advisor.messages.map(message => drawMessage({
    key: `${message.at}:${message.from}`,
    kind: `is-${message.from}`,
    time: message.at === null ? '' : clock(message.at),
    who: message.who,
    text: message.text,
    note: message.via === 'board' ? 'typed on the board' : null,
  }))
  for (const typed of advisor?.pending ?? []) {
    const note = typed.state === 'expired' ? 'not delivered, and too old to deliver now' : 'not delivered yet'
    rows.push(drawMessage({ key: `out:${typed.id}`, kind: 'is-you is-pending', time: clock(typed.at), who: 'You', text: typed.text, note }))
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
  if (bubble === null || window.getSelection().toString() !== '') return
  if (bubble.classList.toggle('is-open')) openBubbles.add(bubble.dataset.key)
  else openBubbles.delete(bubble.dataset.key)
})

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

// Tabs

function show(tab) {
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('is-active', button.dataset.tab === tab)
  $('view-overview').hidden = tab !== 'overview'
  $('view-advice').hidden = tab !== 'advice'
  // The address says which tab is open, so a reload stays on it. A link to a step's details is left as it is.
  if (!location.hash.startsWith('#details=')) history.replaceState(null, '', tab === 'advice' ? '#advice' : location.pathname)
  if (tab === 'advice') $('messages').scrollTop = $('messages').scrollHeight
}

for (const button of document.querySelectorAll('.tab')) button.addEventListener('click', () => show(button.dataset.tab))

// Reading and sending

function draw(state) {
  board = state
  drawTop(state)
  fill($('lanes'), state.chats.map(lane => drawLane(lane, state)))
  drawStrips(state)
  drawToday(state)
  once('needs', needsData(state), () => drawNeeds(state))
  drawDetails(state)
  openFromAddress(state)
  once('advice', state.advice, () => drawAdvice(state))
  once('talk', state.advisor, () => drawTalk(state))
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
  } catch {
    const updated = $('updated')
    updated.classList.add('is-stale')
    updated.textContent = board === null
      ? 'The board\'s server does not answer.'
      : `The board's server does not answer. Showing what was read at ${clock(board.readAt)}.`
  }
  timer = setTimeout(read, (board?.refreshSeconds ?? 30) * 1000)
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
 * Starts the game of a request's branch and shows it in a new tab, or stops it. The tab is opened with the click
 * itself: one opened after the server answered would be stopped by the browser as a pop-up.
 */
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

$('say').addEventListener('submit', event => {
  event.preventDefault()
  const text = $('say-text').value.trim()
  if (text !== '' && board?.advisor) send({ to: board.advisor.name, text }, null)
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

show(location.hash === '#advice' ? 'advice' : 'overview')
read()
