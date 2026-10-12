// The worker board's page, second design: an Overview (one lane per worker, the inbox "For you", today's
// timeline) and Advice & Chat. It asks the server for the state and redraws. Everything from a chat, the backlog
// or the advice file is put on the page as text (textContent), never as HTML, so words in a transcript can never
// become part of the page's code.

'use strict'

const TOKEN = document.querySelector('meta[name="board-token"]').content
const STATES = { working: 'Working', waiting: 'Waiting for you', free: 'Free', unknown: 'Unknown', interrupted: 'Interrupted' }
/** How often the page asks again while the board does not answer. */
const AWAY_MS = 5000
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
// times:end

const ago =(ms, now) => (now - ms < MIN ? 'just now' : `${span(now - ms)} ago`)

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

/** Puts text into a node, with **bold**, `code` and [words](where they point) as the only marks. */
function mark(node, text) {
  const pieces = []
  for (const piece of text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/)) {
    const link = piece.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/)
    if (link !== null) {
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
  fill($('counts'), ['working', 'waiting', 'free', 'interrupted', 'unknown']
    .filter(name => (name !== 'unknown' && name !== 'interrupted') || (state.counts[name] ?? 0) > 0)
    .map(name => {
      const pill = el('div', `count-pill is-${name}`)
      pill.append(el('span', 'dot'), el('b', '', String(state.counts[name])), STATES[name].toLowerCase())
      return pill
    }))
  for (const node of document.querySelectorAll('time[data-at]')) node.textContent = ago(Number(node.dataset.at), state.readAt)
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
  if (restart.prepared !== null) parts.push(line('muted', `${restart.main} wrote down who was on what at ${clock(restart.prepared.at)} (restart.md).`))

  if (isAskingRestart) {
    const ask = el('div', 'restart-ask')
    ask.append(line('', `Prepare a restart? ${restart.main} asks every working chat to stop at a safe point and writes down who was on what.`), button('Yes, prepare', '', 'prepare restart'), button('No', 'is-quiet', 'cancel'))
    parts.push(ask)
  }
  const preparing = restart.preparing
  if (preparing !== null) {
    const isWritten = restart.prepared !== null && restart.prepared.at >= preparing.at
    if (preparing.state === 'waiting') parts.push(line('', `"Prepare restart" waits for ${restart.main} to take it: its chat must be open.`))
    else if (preparing.state === 'expired' || preparing.state === 'failed') parts.push(line('problem', `"Prepare restart" did not reach ${restart.main}. Open its chat and press it again.`))
    else if (preparing.working.length > 0) parts.push(line('', `Preparing the restart since ${clock(preparing.at)}. Still working: ${preparing.working.join(', ')}.`))
    else if (isWritten) parts.push(line('ready', `Ready: every chat is at rest and ${restart.main} wrote down who was on what. You can quit Claude now.`))
    else parts.push(line('', `Every chat is at rest. ${restart.main} has not written down who was on what yet.`))
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
  if (lane.state === 'waiting') return plain('Blocked', 'bad', 'ETA')
  if (lane.state === 'free') return plain('Available')
  if (lane.state !== 'working') return plain('Unknown')
  const eta = lane.eta ?? null
  const soFar = lane.task === null || !Number.isFinite(lane.task.startedAt) ? [] : [`${span(now - lane.task.startedAt)} so far`]
  if (eta === null) {
    // The main chat hands out work and answers: it has no task to time.
    return lane.isWithoutTime === true
      ? { label: 'ETA', main: 'No time', tone: 'fault', small: soFar, from: null, title: 'This worker works without a time: it gave none, its step names none, and its hand-over named none.' }
      : { label: '', main: 'Working', tone: 'muted', small: soFar, from: null }
  }
  const from = eta.isOwn !== false ? null : {
    text: eta.from === 'handover' ? 'from its hand-over' : `from ${lane.task?.stepId ?? 'its step'}`,
    title: `The worker gave no estimate of its own: this is the time its ${eta.from === 'handover' ? 'hand-over' : 'backlog step'} names, counted from when the task started.`,
  }
  if (eta.isOverdue) return { label: 'ETA', main: `${span(now - eta.at)} over`, tone: 'bad', small: [`was ${clock(eta.at)}`], from }
  return { label: 'ETA', main: `${span(eta.leftMs)} left`, tone: 'time', small: [`until ${clock(eta.at)}`], from }
}
// lanetime:end

/** B82: the topic the chat recorded for its task. A chat that recorded nothing has no words to show: what was typed to it stays in its chat. */
function taskTitle(task) {
  if (task.text === '') return el('p', 'task is-none', 'Task not recorded yet')
  const title = el('p', 'task clip', task.text)
  title.title = task.text
  return title
}

/** B82: the steps of a task by name, the one the chat is on marked. Null when the chat recorded no names: the page then shows "2 of 5". */
function stepNames(task) {
  if (!Array.isArray(task.names) || task.names.length === 0) return null
  const at = task.step === null ? -1 : task.step - 1
  const list = el('ol', 'steps')
  task.names.forEach((name, index) => {
    const item = el('li', index < at ? 'is-done' : index === at ? 'is-now' : 'is-next', name)
    item.title = index < at ? 'Done' : index === at ? `Step ${index + 1} of ${task.names.length}: it is on this one` : `Step ${index + 1} of ${task.names.length}`
    list.append(item)
  })
  return list
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

/** What is wrong with a lane, when something is: shown only then. */
function alertsOf(lane, state) {
  const alerts = []
  const task = lane.task
  if (lane.isQuiet) alerts.push(`no sign of life for ${span(lane.quietMs)}`)
  // B95: no worker works without a time; one that does is a fault to fix.
  if (lane.isWithoutTime === true) alerts.push('works without a time: its chat has to say how long it expects')
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
    if (task.source === 'unrecorded') list.append(el('li', 'muted', 'It has recorded no task yet: no topic, no steps and no time.'))
    if (task.source === 'step') list.append(el('li', 'muted', 'It named no task: this is the backlog step that names its branch.'))
    if (lane.eta !== null && lane.eta.isOwn === false) {
      const [where, minutes] = lane.eta.from === 'handover' ? ['its hand-over', task.handMinutes] : [task.stepId ?? 'its step', task.stepMinutes]
      list.append(el('li', 'muted', `It gave no estimate: ${where} says ${about(minutes)}, counted from the start.`))
    }
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

function drawLane(lane, state) {
  const isOpen = openLanes.has(lane.name)
  const card = el('article', `lane is-${lane.state}${lane.isLeftover ? ' is-leftover' : ''}${isOpen ? ' is-open' : ''}`)
  const row = el('div', 'lane-row')

  const who = el('div', 'who')
  const names = el('div')
  names.append(el('h3', '', lane.name), el('span', `pill is-${lane.state}`, lane.isLeftover ? 'Leftover' : STATES[lane.state]))
  if (lane.isRunning === false) {
    // After a restart of the app a chat does not run until it is opened, or messaged through the app.
    const idle = el('small', 'not-running', 'not running')
    idle.title = 'This chat\'s process is not running: nothing reaches it until its chat is opened, or Game - Main starts it.'
    names.append(idle)
  }
  who.append(el('span', 'avatar', lane.name.charAt(0).toUpperCase()), names)

  const what = el('div', 'what')
  const task = lane.task
  if (task === null) {
    what.append(el('p', 'task is-none', lane.state === 'working' ? 'Task not recorded yet' : 'No active task'))
    if (lane.state === 'free') what.append(el('p', 'note', 'Ready for a new task'))
  } else {
    what.append(taskTitle(task))
    const steps = stepNames(task)
    if (steps !== null) what.append(steps)
    else if (task.step !== null && task.steps !== null && task.steps > 0) {
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
  what.append(...betweenTurns(lane))
  if (lane.state === 'interrupted') what.append(el('p', 'alert', 'Cut off in the middle of its turn: it does nothing until it is resumed.'))
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
  }[answer.state] ?? 'waits for its chat to take it'
  line.append(el('b', '', what), ` at ${clock(answer.at)} · `, where)
  if (answer.text !== '') line.append(el('div', '', answer.text))
  if (answer.state === 'waiting' && to !== null) line.append(...startParts(to))
  return line
}

/** A step from the backlog has no chat that asked: it is headed by its activity and says where the answer goes. */
const isStep = need => need.activity !== undefined

// closed:start
/** An answered card stays in sight this long after its answer was typed into its chat. */
const SHOWN_AFTER_TYPED_MS = 2 * 60_000
const closedNow = () => (typeof board === 'object' && board !== null ? board.readAt : Date.now())
const isLost = answer => answer.state === 'expired' || answer.state === 'failed'
/** Answered here, and the answer is on its way or has arrived: the card no longer waits for the person. */
const isAnswered = need => need.answer !== null && !isLost(need.answer)
/**
 * Closed for the person: ticked in the backlog, or answered here and typed into its chat a little while ago. Until
 * then an answered card stays in sight and says where its answer is: it waits for its chat, was handed to it, was
 * typed. An answer that did not arrive opens the card again. Closed ones are hidden unless "Show closed" is ticked.
 */
const isClosed = (need, now = closedNow()) => need.isClosed === true
  || (isAnswered(need) && need.answer.state === 'delivered' && now - (need.answer.deliveredAt ?? need.answer.at) > SHOWN_AFTER_TYPED_MS)
// closed:end
const showsClosed = () => $('needs-closed').checked

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
  const facts = ['main', game.commit?.hash ?? null, game.lastCommitAt === null ? null : `last change ${ago(game.lastCommitAt, state.readAt)}`].filter(Boolean)
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

function drawNeed(need, state) {
  const kind = KINDS[need.kind]
  const card = el('article', `need is-${need.kind}${isStep(need) ? ' is-step' : ''}${isClosed(need) ? ' is-closed' : isAnswered(need) ? ' is-answered' : ''}`)
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
  return list
}
// order:end

function drawLegacy(state) {
  const open = state.backlogForYou.filter(step => !isClosed(step))
  const closed = [...state.backlogForYou.filter(isClosed), ...state.backlogClosed]
  if (open.length === 0 && closed.length === 0) return null
  const box = el('details', 'legacy')
  box.open = isLegacyOpen
  // What still waits for the person: an answered step stays in sight until its answer has arrived, but is not counted.
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

function drawNeeds(state) {
  const box = $('needs')
  const focused = focusedNeed(box)
  const top = box.scrollTop
  const open = state.forYou.filter(need => !isClosed(need))
  const answered = state.forYou.length - open.length
  const unanswered = open.filter(need => !isAnswered(need)).length
  $('needs-count').textContent = unanswered === 0 ? '' : String(unanswered)
  const cards = ordered(showsClosed() ? state.forYou : open).map(need => drawNeed(need, state))
  const none = open.length > 0 ? null : el('p', 'empty', answered > 0 && !showsClosed() ? `Nothing waits for you. ${answered} answered, hidden.` : 'Nothing waits for you.')
  fill(box, [none, ...cards, drawLegacy(state)])
  box.scrollTop = top
  refocus(box, focused)
}

/** Who runs and who was asked to be started: a card that waits for a chat says so, and follows it. */
const runningData = state => [state.chats.map(chat => chat.isRunning), state.advisor?.isRunning ?? null, state.restart?.starting ?? [], state.restart?.main ?? null]
// A card is closed two minutes after its answer was typed: the minute is part of what is drawn.
const needsData = state => [state.forYou, state.backlogForYou, state.backlogClosed, showsClosed(), $('needs-order').value, [...chosen], [...problems], [...sending], [...openForms], [...starting], runningData(state), Math.floor(state.readAt / MIN)]

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
    return {
      code: step.id ?? null,
      title: step.title,
      chips: [
        { text: 'Step', tone: 'kind' },
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
  if (isStep && need.from !== null && need.from !== undefined && need.isClosed !== true) chips.push({ text: `Answer goes to: ${need.from}`, tone: 'to' })
  // `hasNotes`: something is written under the step, wherever the window shows it (B94).
  return { code: need.step ?? null, title: need.title, chips, at: need.at ?? null, checklist, notes: rest, hasNotes: notes.length > 0 }
}
// window:end

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


/** What the details are about: a request by its id, or a queued step by its lane and place. */
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
  const step = subject.step ?? (need === null ? lane.queue[place] : null)
  const now = state.readAt
  // Drawn again only when what it shows has changed, so reading and typing in it are left alone.
  const showing = JSON.stringify([detailsOf, need ?? subject.step ?? [lane.name, lane.queue], [...chosen], [...problems], [...sending], [...starting], runningData(state)])
  if (box.open && detailsShown === showing) return
  detailsShown = showing
  const focused = focusedNeed(box)
  const scroll = box.querySelector('.details-body')?.scrollTop ?? 0

  // The head: what it is and whose it is. Nothing about a queue: the window is about the step itself.
  const view = windowOf(
    { need, step, lane: lane?.name ?? step?.worker ?? null, isStep: need !== null && isStep(need), isClosed: need !== null && isClosed(need) },
    { ask: asks => ASKS[asks] ?? 'Not sorted', kind: kind => KINDS[kind].tag },
  )
  const head = el('header', 'details-head')
  const names = el('div', 'details-names')
  const heading = el('h2')
  if (view.code !== null) heading.append(el('span', 'details-code', view.code))
  heading.append(view.title)
  const chips = el('p', 'details-chips')
  for (const chip of view.chips) chips.append(el('span', `chip is-${chip.tone}`, chip.text))
  if (view.at !== null) chips.append(el('span', 'chip is-time', `Asked ${ago(view.at, now)}`))
  names.append(heading, chips)
  const close = el('button', 'icon-button', '✕')
  close.type = 'button'
  close.dataset.close = ''
  close.title = 'Close'
  close.setAttribute('aria-label', 'Close')
  head.append(el('span', `kind is-${need === null ? 'queued' : need.kind}`, need === null ? '≡' : KINDS[need.kind].sign), names, close)

  // The left column, the wider one: what it is about and what to look at
  const notes = noteParts(view.notes)
  // A request a chat filed has its own text. A step of the backlog is one line, which is the title above; what
  // describes it further are the lines written under it.
  const words = need !== null && !isStep(need) && need.text !== '' ? [el('p', '', need.text)] : []
  // The step's own line in full: the title above is the short of it.
  const full = need !== null && isStep(need) && typeof need.words === 'string' && need.words !== need.title ? [el('p', '', need.words)] : []
  const described = [...words, ...full, ...notes.lead]
  const left = el('div', 'details-main')
  // B94: "nothing more is written" only when nothing is: a step whose lines are its checklist and its context
  // has them on the right.
  if (described.length > 0) left.append(section('Description', described))
  else if (!view.hasNotes) left.append(section('Description', [el('p', 'muted', 'Nothing more is written about it. Lines under the step in the backlog show here.')]))
  left.append(...notes.named)
  if (need !== null && need.tried.length > 0) left.append(section('Already tried', [listOf(need.tried)]))
  const shown = need === null ? step.pictures.map(path => ({ path, caption: '' })) : [
    ...need.options.filter(option => option.picture !== null).map(option => ({ path: option.picture, caption: `${option.label}${option.isRecommended ? ' (recommended)' : ''}` })),
    ...need.pictures.map(path => ({ path, caption: '' })),
  ]
  if (shown.length > 0) left.append(section('References', drawReferences(shown)))

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

  const body = el('div', `details-body${right.children.length === 0 ? ' is-single' : ''}`)
  body.append(left, ...(right.children.length === 0 ? [] : [right]))
  fill(box, need === null ? [head, body] : [head, body, foot])
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
  // A tick in the checklist is the person's own note: kept while the page is open.
  const tick = event.target.closest('[data-tick]')
  if (tick !== null) {
    const mine = ticked.get(tick.dataset.of) ?? new Set()
    if (tick.checked) mine.add(Number(tick.dataset.tick))
    else mine.delete(Number(tick.dataset.tick))
    ticked.set(tick.dataset.of, mine)
    return
  }
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
function drawTable({ head, rows }) {
  const table = el('table')
  if (head !== null) {
    const top = el('thead')
    const row = el('tr')
    for (const cell of head) row.append(marked('th', '', cell))
    top.append(row)
    table.append(top)
  }
  const body = el('tbody')
  for (const cells of rows) {
    const row = el('tr')
    for (const cell of cells) row.append(marked('td', '', cell))
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
  }
  let index = 0
  for (const part of partsOf(state.advice)) {
    if (part.table === undefined) {
      for (const line of part.text.split('\n')) take(line, index++)
      continue
    }
    flush()
    list = null
    item = null
    index += 1
    nodes.push(drawTable(part.table))
  }
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
  rich(bubble, text)
  if (note !== null) bubble.append(el('small', '', note))
  row.append(el('time', '', time), el('span', 'speaker', who), bubble)
  return row
}

function drawTalk(state) {
  const advisor = state.advisor
  const box = $('messages')
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60
  $('talk-title').textContent = advisor?.name ?? 'Advisor'
  fill($('talk-state'), [
    advisor === null ? null : el('span', `pill is-${advisor.state}`, STATES[advisor.state]),
    // A chat that does not run takes nothing: what is typed here waits until its chat is opened.
    // A chat that does not run takes nothing: the main chat is asked to start it when something is typed here.
    ...(advisor === null ? [] : startParts(advisor.name)),
  ])
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
    const note = { expired: 'did not arrive, and is too old to deliver now', failed: 'could not be typed into its chat', taken: 'handed to its chat, which runs it when it is idle' }[typed.state] ?? 'waits for its chat to take it'
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

// The Coordinate tab: the whole backlog by activity. It only shows; a click on a step opens its window.

// B84: what the tab lists, worked out without the page. Kept between these two marks so a test can run it.
// coordinate:start
/** The ways to narrow the list, in the order of their buttons. */
const COORDINATE_FILTERS = [['all', 'All'], ['progress', 'In progress'], ['queued', 'Queued'], ['you', 'For you'], ['unassigned', 'Without a worker']]

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
 * step left is left out. `counts` says how many open steps each filter holds, whatever is searched for.
 */
function coordinateList(activities, { filter = 'all', find = '', showDone = false } = {}) {
  const counts = {}
  for (const [name] of COORDINATE_FILTERS) counts[name] = 0
  const groups = []
  let shown = 0
  for (const activity of activities) {
    const steps = []
    for (const step of activity.steps) {
      const isDone = step.status === 'done'
      if (!isDone) for (const [name] of COORDINATE_FILTERS) if (coordinateShows(step, name)) counts[name] += 1
      if (isDone ? !(showDone && filter === 'all') : !coordinateShows(step, filter)) continue
      if (coordinateFinds(step, find)) steps.push(step)
    }
    if (steps.length > 0) groups.push({ name: activity.name, isFocus: activity.isFocus, steps })
    shown += steps.length
  }
  return { groups, counts, shown }
}
// coordinate:end

const STEP_STATES = { progress: 'In progress', queued: 'Queued', you: 'For you', open: 'Open', done: 'Finished' }
let coordinateFilter = 'all'

function drawCoordinate(state) {
  const activities = state.backlog ?? []
  const list = coordinateList(activities, { filter: coordinateFilter, find: $('coordinate-find').value, showDone: $('coordinate-done').checked })
  $('coordinate-count').textContent = `${list.counts.all} open step${list.counts.all === 1 ? '' : 's'}`
  fill($('coordinate-filters'), COORDINATE_FILTERS.map(([name, label]) => {
    const button = el('button', `choice${name === coordinateFilter ? ' is-chosen' : ''}`, `${label} `)
    button.type = 'button'
    button.dataset.filter = name
    button.append(el('small', '', String(list.counts[name])))
    return button
  }))
  const groups = list.groups.map(group => {
    const box = el('section', `coordinate-group${group.isFocus ? ' is-focus' : ''}`)
    const heading = el('h2', '', group.name)
    if (group.isFocus) heading.append(el('span', 'chip is-focus', 'Focus'))
    heading.append(el('small', '', String(group.steps.length)))
    box.append(heading)
    for (const step of group.steps) {
      const row = el('button', `step-row is-${step.status}`)
      row.type = 'button'
      row.dataset.openStep = step.key
      row.title = `${step.title}
Show the details`
      row.append(
        el('span', 'step-id', step.id ?? ''),
        el('span', `step-kind${step.asks === null ? ' is-none' : ''}`, step.asks === null ? '' : ASKS[step.asks] ?? ''),
        el('span', 'step-title', step.title),
        el('span', 'step-worker', step.worker ?? (step.status === 'you' ? 'You' : '')),
        el('span', 'step-branch', step.branch ?? ''),
        el('span', `step-state is-${step.status}`, STEP_STATES[step.status] ?? step.status),
        // Room for what B83 will put here (stop a task, move a queued step, take one out of a queue). Nothing yet.
        el('span', 'step-actions'),
      )
      box.append(row)
    }
    return box
  })
  fill($('coordinate-list'), groups.length > 0 ? groups : [el('p', 'muted', activities.length === 0 ? 'The backlog could not be read.' : 'No step matches.')])
}

$('coordinate-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]')
  if (button === null) return
  coordinateFilter = button.dataset.filter
  if (board !== null) drawCoordinate(board)
})
$('coordinate-find').addEventListener('input', () => { if (board !== null) drawCoordinate(board) })
$('coordinate-done').addEventListener('change', () => { if (board !== null) drawCoordinate(board) })
// A step for the person opens its card, with the answer; any other step opens as the step it is.
$('coordinate-list').addEventListener('click', event => {
  const row = event.target.closest('[data-open-step]')
  if (row === null || board === null) return
  const step = (board.backlog ?? []).flatMap(activity => activity.steps).find(one => one.key === row.dataset.openStep)
  if (step === undefined) return
  openDetails(step.needId !== null && everyNeed(board).some(need => need.id === step.needId) ? { need: step.needId } : { step: step.key })
})

// Tabs

function show(tab) {
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('is-active', button.dataset.tab === tab)
  $('view-overview').hidden = tab !== 'overview'
  $('view-advice').hidden = tab !== 'advice'
  $('view-coordinate').hidden = tab !== 'coordinate'
  // The address says which tab is open, so a reload stays on it. A link to a step's details is left as it is.
  if (!location.hash.startsWith('#details=')) history.replaceState(null, '', tab === 'overview' ? location.pathname : `#${tab}`)
  if (tab === 'advice') $('messages').scrollTop = $('messages').scrollHeight
}

for (const button of document.querySelectorAll('.tab')) button.addEventListener('click', () => show(button.dataset.tab))

// Reading and sending

function draw(state) {
  board = state
  drawTop(state)
  drawMainGame(state)
  drawRestart(state)
  fill($('lanes'), state.chats.map(lane => drawLane(lane, state)))
  drawStrips(state)
  drawToday(state)
  once('needs', needsData(state), () => drawNeeds(state))
  once('coordinate', state.backlog ?? null, () => drawCoordinate(state))
  drawDetails(state)
  openFromAddress(state)
  once('advice', state.advice, () => drawAdvice(state))
  const age = state.advice === null ? null : adviceAge(state.adviceAt ?? null, state.readAt)
  once('advice-age', age, () => {
    $('advice-age').hidden = age === null
    $('advice-age').className = `advice-age${age !== null && age.isOld ? ' is-old' : ''}`
    $('advice-age').textContent = age === null ? '' : age.text
  })
  once('talk', [state.advisor, runningData(state), [...problems], [...sending]], () => drawTalk(state))
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

show(location.hash === '#advice' ? 'advice' : location.hash === '#coordinate' ? 'coordinate' : 'overview')
read()
