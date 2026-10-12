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
    for (const step of lane.queue) {
      const item = el('li')
      item.append(el('b', '', step.title))
      const notes = [about(step.minutes), step.after === null ? null : `after ${step.after}`].filter(Boolean)
      if (notes.length > 0) item.append(el('small', '', `  ${notes.join(' · ')}`))
      list.append(item)
    }
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
    const item = el('div', 'queue-item')
    item.title = lane.queue[0].text
    item.append(el('b', '', lane.queue[0].title), el('small', '', about(lane.queue[0].minutes) ?? 'no time given'))
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
    strip.append(el('b', '', `Queued for nobody (${state.unassigned.length}): `), state.unassigned.map(step => step.title).join(' · '))
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
  const { from, to } = state.day
  // The scale runs from the start of the day to the first full hour after now, and on to the end of what is
  // planned, but not further than six hours ahead.
  const until = Math.min(Math.max(to, state.day.until), to + 6 * HOUR)
  const end = from + Math.max(1, Math.ceil((until - from + 10 * MIN) / HOUR)) * HOUR
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

  $('today-range').textContent = `${clock(from)} – now`
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

function sentLine(answer, now) {
  const line = el('div', 'sent')
  const what = { approve: 'You approved', reject: 'You rejected', done: 'You marked it done' }[answer.verdict] ?? 'You answered'
  line.append(el('b', '', what), ` at ${clock(answer.at)} · `, answer.state === 'delivered' ? 'delivered' : 'not delivered yet')
  if (answer.text !== '') line.append(el('div', '', answer.text))
  return line
}

function drawNeed(need, state) {
  const kind = KINDS[need.kind]
  // A step from the backlog has no chat that asked: it is headed by its activity and says where the answer goes.
  const isStep = need.activity !== undefined
  const card = el('article', `need is-${need.kind}${isStep ? ' is-step' : ''}`)
  card.dataset.id = need.id
  const top = el('header', 'need-top')
  if (isStep) top.append(el('span', 'kind', kind.sign), el('span', 'tag', ASKS[need.asks] ?? 'Not sorted'), el('small', 'muted', need.activity))
  else top.append(el('span', 'kind', kind.sign), el('b', '', need.from), el('span', 'tag', kind.tag), since(need.at, state.readAt))
  card.append(top, el('h4', '', need.title))
  if (need.text !== '') card.append(el('p', '', need.text))

  // An option is chosen with the button under its picture; the picture itself opens large.
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
    card.append(grid)
  }
  const plain = need.options.filter(option => option.picture === null)
  if (plain.length > 0) {
    const choices = el('div', 'choices')
    for (const option of plain) choices.append(choice(option))
    card.append(choices)
  }

  if (need.run !== null) {
    if (need.run.url !== null) {
      const link = el('a', 'run')
      link.href = need.run.url
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
      link.append(icon('open'), 'Open branch in local build')
      card.append(link)
    }
    const where = [need.run.branch === null ? null : `branch ${need.run.branch}`, need.run.entry === null ? null : `if it does not open, start "${need.run.entry}" first`].filter(Boolean)
    if (where.length > 0) card.append(el('small', 'run-note', where.join(' · ')))
  }
  for (const [title, lines] of [['Key points to check', need.checks], ['Already tried', need.tried]]) {
    if (lines.length === 0) continue
    const box = el('div', 'box')
    const list = el('ul')
    for (const line of lines) list.append(el('li', '', line))
    box.append(el('b', '', title), list)
    card.append(box)
  }

  const answer = need.answer
  if (answer !== null && answer.state !== 'expired') {
    card.append(sentLine(answer, state.readAt))
    return card
  }
  if (answer !== null) card.append(el('p', 'problem', `Your answer of ${clock(answer.at)} was not delivered in time. Send it again when the chat can take it.`))
  if (!need.canAnswer) {
    card.append(el('p', 'muted', isStep ? 'No main chat is open to take the answer.' : 'Answer in its chat.'))
    return card
  }
  // The many steps of the backlog stay short until one is opened to answer it.
  if (isStep && !openForms.has(need.id)) {
    const open = el('button', 'choice', `Answer (goes to ${need.from})`)
    open.type = 'button'
    open.dataset.open = need.id
    card.append(open)
    return card
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
  if (need.kind === 'verify') card.append(buttons, text)
  else card.append(text, buttons)
  if (problems.has(need.id)) card.append(el('p', 'problem', problems.get(need.id)))
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
  if (state.backlogForYou.length === 0) return null
  const box = el('details', 'legacy')
  box.open = isLegacyOpen
  const counts = Object.keys(ASKS).map(asks => [ASKS[asks], state.backlogForYou.filter(step => step.asks === asks).length]).filter(([, count]) => count > 0)
  const summary = el('summary', '', `From the backlog (${state.backlogForYou.length})`)
  summary.append(el('small', '', counts.map(([name, count]) => `${count} ${name.toLowerCase()}`).join(' · ')))
  box.append(summary)
  for (const step of state.backlogForYou) box.append(drawNeed(step, state))
  box.addEventListener('toggle', () => { isLegacyOpen = box.open })
  return box
}

function drawNeeds(state) {
  const box = $('needs')
  const focused = document.activeElement?.closest?.('.need')?.dataset.id ?? null
  const top = box.scrollTop
  $('needs-count').textContent = state.forYou.length === 0 ? '' : String(state.forYou.length)
  const cards = ordered(state.forYou).map(need => drawNeed(need, state))
  fill(box, [cards.length === 0 ? el('p', 'empty', 'Nothing waits for you.') : null, ...cards, drawLegacy(state)])
  box.scrollTop = top
  // A redraw while the person types: the words are kept in `drafts`, and the cursor goes back where it was.
  if (focused !== null) {
    const again = [...box.querySelectorAll('.need')].find(card => card.dataset.id === focused)?.querySelector('textarea')
    if (again) {
      again.focus()
      again.setSelectionRange(again.value.length, again.value.length)
    }
  }
}

const needsData = state => [state.forYou, state.backlogForYou, $('needs-order').value, [...chosen], [...problems], [...sending], [...openForms]]

$('needs').addEventListener('input', event => {
  const card = event.target.closest('.need')
  if (card !== null && event.target.matches('textarea')) drafts.set(card.dataset.id, event.target.value)
})

$('needs').addEventListener('click', event => {
  const card = event.target.closest('.need')
  if (card === null || board === null) return
  const id = card.dataset.id
  const need = [...board.forYou, ...board.backlogForYou].find(one => one.id === id)
  if (event.target.closest('[data-open]') !== null) {
    openForms.add(id)
    once('needs', needsData(board), () => drawNeeds(board))
    card.ownerDocument.querySelector(`.need[data-id="${CSS.escape(id)}"] textarea`)?.focus()
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
    once('needs', needsData(board), () => drawNeeds(board))
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

function fail(id, why) {
  problems.set(id, why)
  if (board !== null) once('needs', needsData(board), () => drawNeeds(board))
}

$('needs-order').addEventListener('change', () => {
  if (board !== null) once('needs', needsData(board), () => drawNeeds(board))
})

// Pictures, large

document.addEventListener('click', event => {
  const frame = event.target.closest('[data-zoom]')
  if (frame !== null) {
    pictureUrl(frame.dataset.zoom).then(url => {
      if (url === null) return
      $('lightbox-picture').src = url
      $('lightbox-caption').textContent = frame.dataset.caption || frame.dataset.zoom
      $('lightbox').hidden = false
    })
  } else if (event.target.closest('#lightbox') !== null) {
    $('lightbox').hidden = true
  }
})

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') $('lightbox').hidden = true
})

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

// Tabs

function show(tab) {
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('is-active', button.dataset.tab === tab)
  $('view-overview').hidden = tab !== 'overview'
  $('view-advice').hidden = tab !== 'advice'
  // The address says which tab is open, so a reload stays on it.
  history.replaceState(null, '', tab === 'advice' ? '#advice' : location.pathname)
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
  else if (board !== null) once('needs', needsData(board), () => drawNeeds(board))
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

$('refresh').append(icon('refresh'))
$('refresh').addEventListener('click', read)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) read()
})

show(location.hash === '#advice' ? 'advice' : 'overview')
read()
