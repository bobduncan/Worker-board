// The worker board's page. It asks the server for the state and redraws. Everything from a chat is put on the page
// as text (textContent), never as HTML, so words in a transcript can never become part of the page's code.

'use strict'

const TOKEN = document.querySelector('meta[name="board-token"]').content
const STATES = { working: 'Working', waiting: 'Waiting for you', free: 'Free', unknown: 'Unknown' }
const MIN = 60_000
const HOUR = 60 * MIN
const LONG_CHARS = 420

const $ = id => document.getElementById(id)

/** Messages the person opened in the dock, so a redraw does not fold them again. */
const opened = new Set()
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

/** Redraws a scrolling list without losing the place the person scrolled to. */
function refill(parent, children) {
  const top = parent.scrollTop
  fill(parent, children)
  parent.scrollTop = top
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

const ICONS = {
  refresh: 'M20 11a8 8 0 0 0-14.3-4.5M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5M20 20v-4h-4',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
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

// The top bar

function drawTop(state) {
  const updated = $('updated')
  updated.textContent = `Last updated ${clock(state.readAt)}${state.isDemo ? ' · demo data' : ''}`
  updated.classList.remove('is-stale')

  const pills = ['working', 'waiting', 'free', 'unknown']
    .filter(name => name !== 'unknown' || state.counts.unknown > 0)
    .map(name => {
      const pill = el('div', `count-pill is-${name}`)
      pill.append(el('span', 'dot'), el('b', '', String(state.counts[name])), STATES[name].toLowerCase())
      return pill
    })
  fill($('counts'), pills)
}

// Workers

function timeLines(chat, state) {
  const task = chat.task
  const now = state.readAt
  const lines = []
  if (task === null) return lines

  const soFar = now - task.startedAt
  const worked = soFar - task.waitedMs
  const first = el('p', 'times')
  first.append(`started ${clock(task.startedAt)} · `, el('b', '', span(soFar)), ' so far')
  if (task.waitedMs >= MIN) first.append(` (${span(task.waitedMs)} of it waiting for you)`)
  lines.push(first)

  if (task.firstEstimateMs !== null) {
    const estimate = el('p', 'times')
    estimate.append(`first estimate ${span(task.firstEstimateMs)}`)
    if (worked > task.firstEstimateMs + MIN) estimate.append(' · ', el('span', 'warn', `${span(worked - task.firstEstimateMs)} over`))
    lines.push(estimate)
  }
  if (task.leftMs !== null) {
    const left = el('p', 'times')
    left.append('now says about ', el('b', '', span(task.leftMs)), ' left')
    if (task.estimateAt !== null) {
      const age = now - task.estimateAt
      const isOld = chat.state === 'working' && age > state.estimateOldMs
      left.append(' · ', el('span', isOld ? 'warn' : '', isOld ? `estimate ${span(age)} old` : `said ${ago(task.estimateAt, now)}`))
    }
    lines.push(left)
  }
  return lines
}

function drawCard(chat, state) {
  const card = el('article', `card is-${chat.state}${chat.isMain ? ' is-main' : ''}${chat.isLeftover ? ' is-leftover' : ''}`)
  const top = el('header', 'card-top')
  top.append(el('span', 'avatar', chat.name.charAt(0).toUpperCase()), el('h3', '', chat.name))
  top.append(el('span', `pill is-${chat.state}`, chat.isLeftover ? 'Leftover' : STATES[chat.state]))
  card.append(top)

  const task = chat.task
  if (task === null) {
    card.append(el('p', 'task is-none', chat.state === 'working' ? 'Task not named' : 'No active task'))
  } else {
    const line = el('p', 'task clip')
    line.title = task.text
    // A chat that named no task shows what started its turn, and who asked.
    if (task.source === 'prompt') line.append(el('span', 'muted', task.by === 'you' || task.by === null ? 'You asked: ' : `${task.by} sent: `))
    line.append(task.text)
    card.append(line)
  }

  if (task !== null && task.step !== null && task.steps !== null && task.steps > 0) {
    const progress = el('div', 'progress')
    const bar = el('div', 'bar')
    const done = el('div', 'fill')
    done.style.width = `${Math.max(0, Math.min(100, (task.step / task.steps) * 100))}%`
    bar.append(done)
    progress.append(bar, el('span', '', `${task.step} / ${task.steps}`))
    card.append(progress)
  }
  card.append(...timeLines(chat, state))

  if (chat.state === 'working' && chat.doingNow !== null) {
    const now = el('p', 'now clip')
    now.append(el('b', '', 'Now: '), el('span', '', chat.doingNow))
    card.append(now)
  }
  if (chat.isQuiet) card.append(el('p', 'times warn', `quiet for ${span(chat.quietMs)}`))
  if (chat.state === 'waiting') {
    const needs = el('p', 'needs clip')
    needs.title = chat.needsYou ?? ''
    needs.append(el('b', '', 'Needs you: '), chat.needsYou ?? 'see its chat')
    card.append(needs)
  }
  if (chat.state === 'free' && chat.statusDetail !== null) card.append(el('p', 'detail clip', `Last: ${chat.statusDetail}`))
  return card
}

// For you, Queue, Working folders

function drawForYou(state) {
  const items = state.forYou.map(need => {
    const item = el('div', `item${need.chat === null ? '' : ' is-chat'}`)
    if (need.chat !== null) {
      const top = el('div', 'item-top')
      top.append(el('b', '', need.chat))
      if (need.since !== null) top.append(el('small', '', span(state.readAt - need.since)))
      item.append(top)
    }
    item.append(el('div', '', need.text))
    if (need.activity !== null) item.append(el('small', '', need.activity))
    return item
  })
  $('for-you-count').textContent = items.length === 0 ? '' : String(items.length)
  refill($('for-you-list'), items.length === 0 ? [el('p', 'empty', 'Nothing waits for you.')] : items)
}

function drawQueue(state) {
  const rows = state.queue.map(step => {
    const item = el('div', 'item queue-row')
    const words = el('div')
    words.append(el('div', '', step.title))
    const notes = [step.minutes === null ? null : `about ${span(step.minutes * MIN)}`, step.after === null ? null : `after ${step.after}`].filter(Boolean)
    if (notes.length > 0) words.append(el('small', '', notes.join(' · ')))
    item.append(words)
    if (step.worker !== null) item.append(el('span', 'tag', step.worker))
    return item
  })
  const open = state.openWork.map(step => {
    const item = el('div', 'item queue-row')
    const words = el('div')
    words.append(el('div', '', step.text), el('small', '', step.activity))
    item.append(words)
    if (step.worker !== null) item.append(el('span', 'tag', step.worker))
    return item
  })
  $('queue-count').textContent = rows.length === 0 ? '' : String(rows.length)
  refill($('queue-list'), [
    ...(rows.length === 0 ? [el('p', 'empty', 'Nothing is queued to hand out.')] : rows),
    open.length === 0 ? null : el('p', 'subhead', `Open in your focus, not handed out (${open.length})`),
    ...open,
  ])
}

function drawFolders(state) {
  if (state.folders === null) return refill($('folders-list'), [el('p', 'empty', 'Git did not answer.')])
  const rows = state.folders.map(folder => {
    const row = el('div', 'row')
    const symbol = el('span', 'icon')
    symbol.append(icon('folder'))
    const ahead = folder.ahead === null ? '?' : folder.ahead === 0 ? '–' : `↑ ${folder.ahead}`
    const names = el('div', 'names')
    names.title = `${folder.path}\n${folder.branch ?? 'no branch'}`
    names.append(el('span', 'name', folder.name), el('span', 'branch', folder.branch ?? 'no branch'))
    const changed = folder.uncommitted === null ? '?' : folder.uncommitted === 0 ? '' : `${folder.uncommitted} changed`
    const changedCell = el('span', 'changed', changed)
    changedCell.title = 'files changed and not committed'
    const aheadCell = el('span', `ahead${folder.ahead ? '' : ' is-none'}`, ahead)
    aheadCell.title = folder.ahead === null ? 'unknown' : `${folder.ahead} commits ahead of main`
    row.append(symbol, names, changedCell, aheadCell, el('span', 'when', folder.lastCommitAt === null ? 'unknown' : ago(folder.lastCommitAt, state.readAt)))
    return row
  })
  refill($('folders-list'), rows.length === 0 ? [el('p', 'empty', 'No working folders.')] : rows)
}

// Today

function drawToday(state) {
  const { from, to } = state.day
  // The scale runs from the start of the day to the first full hour after now.
  const end = from + Math.max(1, Math.ceil((to - from + 10 * MIN) / HOUR)) * HOUR
  const at = time => `${Math.max(0, Math.min(100, ((time - from) / (end - from)) * 100))}%`
  const place = (node, time) => {
    node.style.left = at(time)
    return node
  }

  const hours = el('div', 'lane hours')
  const scale = el('div', 'track')
  const everyHours = (end - from) / HOUR > 9 ? 2 : 1
  for (let time = from; time <= end; time += everyHours * HOUR) scale.append(place(el('span', 'hour', clock(time)), time))
  scale.append(place(el('span', 'now-label', 'Now'), to))
  hours.append(el('span'), scale)

  const lanes = state.today.map(lane => {
    const row = el('div', 'lane')
    const track = el('div', 'track')
    let before = null
    for (const piece of lane.spans) {
      const bar = place(el('div', `span is-${piece.state}`), piece.from)
      bar.style.width = `calc(${at(piece.to)} - ${at(piece.from)})`
      bar.title = `${STATES[piece.state] ?? piece.state}, ${clock(piece.from)} to ${clock(piece.to)}${piece.task === null ? '' : `: ${piece.task}`}`
      track.append(bar)
      if (piece.task !== null && piece.task !== before) {
        const tick = place(el('div', 'tick'), piece.from)
        tick.title = `${clock(piece.from)}: ${piece.task}`
        track.append(tick)
      }
      before = piece.task
    }
    track.append(place(el('div', 'now-line'), to))
    const name = el('span', 'lane-name', lane.chat)
    name.title = lane.chat
    row.append(name, track)
    return row
  })
  fill($('timeline'), [hours, ...lanes])

  fill($('legend'), ['working', 'waiting', 'free'].map(name => {
    const item = el('li')
    item.append(el('span', `dot is-${name}`), STATES[name])
    return item
  }).concat((() => {
    const item = el('li')
    item.append(el('span', 'dot'), 'Not seen')
    return item
  })()))
}

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

// The chat dock

function drawMessage({ key, kind, time, who, text, note = null, isReport = false }) {
  const row = el('div', `message ${kind}`)
  const bubble = el('div', 'bubble')
  if (isReport) {
    bubble.classList.add('is-report')
    bubble.dataset.key = key
    bubble.dataset.full = text
    bubble.dataset.short = `Report from ${who}: ${text.split('\n')[0].slice(0, 90)}`
  } else if (text.length > LONG_CHARS || text.split('\n').length > 8) {
    bubble.classList.add('is-long')
    bubble.dataset.key = key
  }
  const isOpen = opened.has(key)
  if (isOpen) bubble.classList.add('is-open')
  if (isReport && !isOpen) bubble.textContent = bubble.dataset.short
  else mark(bubble, text)
  if (note !== null) bubble.append(el('small', '', note))
  row.append(el('time', '', time), el('span', 'who', who), bubble)
  return row
}

function drawDock(state) {
  const box = $('messages')
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60
  const rows = state.mainChat.map(message => drawMessage({
    key: `${message.at}:${message.from}`,
    kind: `is-${message.from}`,
    time: message.at === null ? '' : clock(message.at),
    who: message.who,
    text: message.text,
    note: message.via === 'board' ? 'typed on the board' : null,
    isReport: message.from === 'report',
  }))
  for (const waiting of state.outbox) {
    rows.push(drawMessage({ key: `out:${waiting.id}`, kind: 'is-you is-pending', time: clock(waiting.at), who: 'You', text: waiting.text, note: 'not delivered yet' }))
  }
  const main = state.chats.find(chat => chat.isMain)
  if (main !== undefined && main.state === 'working') {
    const status = el('div', 'message is-status')
    status.append(el('time'), el('span'), el('div', 'bubble', `Main is working${main.doingNow === null ? '' : `: ${main.doingNow}`}`))
    rows.push(status)
  }
  if (rows.length === 0) rows.push(el('p', 'empty', main === undefined ? 'No main chat found.' : 'Nothing to show from the main chat yet.'))
  const top = box.scrollTop
  fill(box, rows)
  box.scrollTop = atEnd ? box.scrollHeight : top
  $('say-text').maxLength = state.maxMessageChars
}

$('messages').addEventListener('click', event => {
  const bubble = event.target.closest('.bubble[data-key]')
  if (bubble === null || window.getSelection().toString() !== '') return
  const isOpen = bubble.classList.toggle('is-open')
  if (isOpen) opened.add(bubble.dataset.key)
  else opened.delete(bubble.dataset.key)
  if (!bubble.classList.contains('is-report')) return
  if (isOpen) mark(bubble, bubble.dataset.full)
  else bubble.textContent = bubble.dataset.short
})

// Reading and sending

function draw(state) {
  board = state
  drawTop(state)
  const count = state.chats.length
  $('cards').style.setProperty('--columns', String(count <= 5 ? Math.max(1, count) : Math.ceil(count / 2)))
  fill($('cards'), state.chats.map(chat => drawCard(chat, state)))
  drawForYou(state)
  drawQueue(state)
  drawFolders(state)
  drawToday(state)
  drawAdvice(state)
  drawDock(state)
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

async function send(text) {
  const note = $('say-note')
  const button = $('say-send')
  button.disabled = true
  try {
    const answer = await fetch('/api/say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Board-Token': TOKEN },
      body: JSON.stringify({ text }),
    })
    if (!answer.ok) throw new Error((await answer.text()).trim() || String(answer.status))
    $('say-text').value = ''
    note.classList.remove('is-error')
    note.textContent = 'Messages are kept and shown here. Delivery to the chat is not connected in this version.'
    await read()
    $('messages').scrollTop = $('messages').scrollHeight
  } catch (error) {
    note.classList.add('is-error')
    note.textContent = `Not kept: ${error.message}`
  } finally {
    button.disabled = false
  }
}

$('say').addEventListener('submit', event => {
  event.preventDefault()
  const text = $('say-text').value.trim()
  if (text !== '') send(text)
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

read()
