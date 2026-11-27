/* The Retrospective tab (chat 1's brief, 2026-11-27): the weekly retrospective's pages, newest first, one opened at a time, and
 * the button that asks the main chat to run one now. Text only: a page is read as Markdown and drawn with textContent, never as
 * HTML. The pure part (retro:start to retro:end) is read by the tests. */
(() => {
  'use strict'

  // retro:start
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  /** A time as the board says it: "15:12" today, "24 Nov 15:12" another day. */
  function whenOf(ms, now = Date.now()) {
    if (!Number.isFinite(ms)) return ''
    const at = new Date(ms)
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    return at.toDateString() === new Date(now).toDateString() ? clock : `${at.getDate()} ${MONTHS[at.getMonth()]} ${clock}`
  }
  /** A page's date (YYYY-MM-DD) as words: "27 Nov 2026". */
  function dateWords(date) {
    const [y, m, d] = String(date).split('-').map(Number)
    return Number.isFinite(y) && m >= 1 && m <= 12 ? `${d} ${MONTHS[m - 1]} ${y}` : String(date)
  }
  /** Inline text as pieces: `{ text, bold }`, from **bold**; every other mark stays as it is written. */
  function inlineOf(text) {
    const pieces = []
    const parts = String(text).split(/\*\*/)
    parts.forEach((part, i) => { if (part !== '') pieces.push({ text: part, bold: i % 2 === 1 && i < parts.length - 1 }) })
    return pieces
  }
  /**
   * A page as blocks: `{ kind: 'heading', level, text }`, `{ kind: 'paragraph', text }`, `{ kind: 'list', ordered, items }`,
   * `{ kind: 'table', head, rows }`. Lines that belong together are one block; the table's line of dashes is left out.
   */
  function blocksOf(markdown) {
    const blocks = []
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
    const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim() === '') continue
      const heading = /^(#{1,6})\s+(.*)$/.exec(line)
      if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() }); continue }
      if (/^\s*\|/.test(line)) {
        const rows = []
        for (; i < lines.length && /^\s*\|/.test(lines[i]); i += 1) if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cells(lines[i]))
        i -= 1
        blocks.push({ kind: 'table', head: rows[0] ?? [], rows: rows.slice(1) })
        continue
      }
      const item = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line)
      if (item) {
        const ordered = /\d/.test(item[1])
        const items = []
        for (; i < lines.length; i += 1) {
          const next = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(lines[i])
          if (next && /\d/.test(next[1]) === ordered) items.push(next[2].trim())
          else if (lines[i].trim() !== '' && /^\s{2,}/.test(lines[i]) && items.length > 0) items[items.length - 1] += ` ${lines[i].trim()}`
          else break
        }
        i -= 1
        blocks.push({ kind: 'list', ordered, items })
        continue
      }
      const text = [line.trim()]
      for (i += 1; i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|\s*\||\s*([-*]|\d+[.)])\s)/.test(lines[i]); i += 1) text.push(lines[i].trim())
      i -= 1
      blocks.push({ kind: 'paragraph', text: text.join(' ') })
    }
    return blocks
  }
  /** The button and its line for the run's state (`run` from /api/retro): `{ label, disabled, line }`. */
  function buttonOf(run, now = Date.now()) {
    const cost = 'A run costs a few percent of the weekly limit.'
    const last = run?.lastRanAt ? `Last run: ${whenOf(run.lastRanAt, now)}.` : 'No run yet.'
    const to = run?.to ?? 'Main'
    switch (run?.state) {
      case 'requested': return { label: `Asked ${to} at ${whenOf(run.since, now)}`, disabled: true, line: `Waiting for ${to} to pick it up. ${cost}` }
      case 'running': return { label: 'Running…', disabled: true, line: `${to} runs it since ${whenOf(run.since, now)}. ${cost}` }
      case 'unfinished': return { label: 'Run retrospective again', disabled: false, line: `The last run did not finish: ${run.why ?? 'no page came'}. ${cost}` }
      default: return { label: 'Run retrospective now', disabled: false, line: `${run?.done ? 'Done: the new page is on top. ' : ''}${last} ${cost}` }
    }
  }
  // retro:end

  const $ = id => document.getElementById(id)
  function node(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = String(text); return n }
  function inline(parent, text) {
    for (const piece of inlineOf(text)) parent.append(piece.bold ? node('strong', '', piece.text) : document.createTextNode(piece.text))
    return parent
  }
  function drawPage(target, markdown) {
    target.replaceChildren()
    for (const block of blocksOf(markdown)) {
      if (block.kind === 'heading') target.append(inline(node(`h${Math.min(6, block.level + 1)}`, 'retro-heading'), block.text))
      else if (block.kind === 'paragraph') target.append(inline(node('p', 'retro-paragraph'), block.text))
      else if (block.kind === 'list') {
        const list = node(block.ordered ? 'ol' : 'ul', 'retro-list')
        for (const item of block.items) list.append(inline(node('li'), item))
        target.append(list)
      } else if (block.kind === 'table') {
        const wrap = node('div', 'retro-table-scroll'), table = node('table', 'retro-table'), head = node('thead'), body = node('tbody'), tr = node('tr')
        for (const cell of block.head) tr.append(inline(node('th'), cell))
        head.append(tr)
        for (const row of block.rows) { const line = node('tr'); for (const cell of row) line.append(inline(node('td'), cell)); body.append(line) }
        table.append(head, body); wrap.append(table); target.append(wrap)
      }
    }
  }

  let token = ''
  let timer = null
  let opened = null
  let busy = false
  async function load() {
    const answer = await fetch('/api/retro', { headers: { 'X-Board-Token': token } })
    if (!answer.ok) throw new Error((await answer.text()) || `HTTP ${answer.status}`)
    return answer.json()
  }
  async function openPage(date, target) {
    if (opened === date) { opened = null; target.replaceChildren(); return }
    opened = date
    target.replaceChildren(node('p', 'retro-muted', 'Opening…'))
    const answer = await fetch(`/api/retro-page?date=${encodeURIComponent(date)}`, { headers: { 'X-Board-Token': token } })
    if (opened !== date) return
    if (!answer.ok) { target.replaceChildren(node('p', 'retro-muted', 'This page cannot be read now.')); return }
    drawPage(target, await answer.text())
  }
  function draw(data, note = '') {
    const root = $('retro-content')
    if (!root) return
    root.replaceChildren()
    const head = node('section', 'retro-head')
    head.append(node('h2', 'retro-title', 'Retrospective'))
    const look = buttonOf(data.run)
    const button = node('button', 'retro-run', busy ? 'Asking…' : look.label)
    button.type = 'button'
    button.disabled = busy || look.disabled
    button.addEventListener('click', run)
    head.append(button, node('p', 'retro-muted', note || look.line))
    root.append(head)
    if (data.pages.length === 0) { root.append(node('p', 'retro-muted', 'No retrospective yet.')); return }
    const list = node('ol', 'retro-weeks')
    data.pages.forEach((page, i) => {
      const item = node('li', `retro-week${i === 0 ? ' is-newest' : ''}`)
      const open = node('button', 'retro-week-open')
      open.type = 'button'
      open.append(node('strong', '', `${i === 0 ? 'This week · ' : ''}${dateWords(page.date)}`), node('span', 'retro-one-line', page.oneLine ?? 'No "In one line" on this page.'))
      const body = node('div', 'retro-page')
      open.addEventListener('click', () => openPage(page.date, body).catch(() => {}))
      item.append(open, body)
      list.append(item)
      if (opened === page.date) { opened = null; openPage(page.date, body).catch(() => {}) }
    })
    root.append(list)
  }
  async function refresh() {
    try { draw(await load()) } catch (error) { const root = $('retro-content'); if (root) root.replaceChildren(node('p', 'retro-muted', `The board could not read the retrospectives: ${error.message}`)) }
  }
  async function run() {
    if (busy) return
    busy = true
    let note = ''
    try {
      const answer = await fetch('/api/retro-run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token }, body: '{}' })
      if (!answer.ok) note = (await answer.text()) || `HTTP ${answer.status}`
    } finally {
      busy = false
    }
    try { draw(await load(), note) } catch { await refresh() }
  }
  window.BoardRetro = {
    open(given) {
      token = given
      refresh()
      clearInterval(timer)
      timer = setInterval(() => { if ($('view-retro') && !$('view-retro').hidden) refresh(); else clearInterval(timer) }, 10_000)
    },
  }
})()
