// B375: the help tour's six pictures as simplified drawings of the board itself (the person, 2026-10-19, I23: "more
// drawn like the actual board. simplified, but like it's clear roughly how to board looks like and what steps it needs
// to do"). Each is the board in its own colours and shapes, with the one part its card is about ringed and numbered, so
// the six read in order: install, Initialise, talk with your partner, Go, the workers build, you check. Vector
// pictures: crisp at any size, and a change of the board is a redraw here: `node tools/help-pictures.mjs [folder]`
// writes them into public/help (or the folder named).

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The board's colours (public/board.css, :root). */
const C = {
  bg: '#0a0f18', panel: '#101826', inset: '#152032', line: '#202d40', edge: '#2a3850', text: '#e8eef7', muted: '#8d9aae',
  working: '#3fd27f', waiting: '#f6b93b', free: '#3b82f6', ask: '#b48cff', link: '#7fb0ff',
}
const W = 960
const H = 540
const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif"

const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rect = (x, y, w, h, { fill = C.panel, stroke = C.line, r = 8, width = 1, extra = '' } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${extra}/>`
const text = (x, y, words, { size = 14, fill = C.text, weight = 400, anchor = 'start', family = FONT } = {}) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(words)}</text>`
/** A line of text drawn as a bar: the words do not matter, the shape does. */
const bar = (x, y, w, fill = C.muted, h = 8) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" opacity="0.55"/>`
const pill = (x, y, words, fill, ink = '#08110c', w = 54) => `${rect(x, y, w, 22, { fill, stroke: 'none', r: 6 })}${text(x + w / 2, y + 15.5, words, { size: 12, fill: ink, weight: 700, anchor: 'middle' })}`
const progress = (x, y, w, share, fill = C.working) => `${rect(x, y, w, 7, { fill: C.line, stroke: 'none', r: 3.5 })}${rect(x, y, Math.round(w * share), 7, { fill, stroke: 'none', r: 3.5 })}`

/** The board's top: the four tabs (one active), the ? button, and the window's frame around everything. */
function frame(active, body, { dim = [] } = {}) {
  const tabs = ['Overview', 'Focus', 'Backlog', 'Design']
  let x = 22
  const drawn = tabs.map(name => {
    const w = name.length * 8.4 + 30
    const isOn = name === active
    const part = `${isOn ? rect(x, 10, w, 36, { fill: C.panel, stroke: 'none', r: 6 }) + `<rect x="${x}" y="43" width="${w}" height="3" fill="${C.free}"/>` : ''}${text(x + w / 2, 33, name, { size: 15, fill: isOn ? C.text : C.muted, weight: isOn ? 600 : 400, anchor: 'middle' })}`
    x += w + 6
    return part
  }).join('')
  const shade = dim.map(([dx, dy, dw, dh]) => rect(dx, dy, dw, dh, { fill: C.bg, stroke: 'none', r: 10, extra: ' opacity="0.62"' })).join('')
  return [
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>`,
    `<rect x="0" y="0" width="${W}" height="48" fill="#0c121d"/><rect x="0" y="48" width="${W}" height="1" fill="${C.line}"/>`,
    drawn,
    `<circle cx="${W - 30}" cy="26" r="13" fill="none" stroke="${C.edge}"/>${text(W - 30, 31, '?', { size: 14, weight: 700, anchor: 'middle' })}`,
    body,
    shade,
  ].join('\n')
}

/** The ring around the part a card is about, with its number: amber, as the board marks what waits for you. */
function ring(x, y, w, h, number, label, { labelAt = 'below' } = {}) {
  const lw = label.length * 7.6 + 30
  // Inside the ring at its foot, or below it; never past the picture's right edge.
  const lx = labelAt === 'inside' ? x + 12 : Math.min(x, W - lw - 12)
  const ly = labelAt === 'inside' ? y + h - 46 : y + h + 14
  return [
    `<rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="14" fill="none" stroke="${C.waiting}" stroke-width="10" opacity="0.18"/>`,
    `<rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="14" fill="none" stroke="${C.waiting}" stroke-width="3"/>`,
    `<circle cx="${x - 6}" cy="${y - 6}" r="19" fill="${C.waiting}" stroke="${C.bg}" stroke-width="3"/>`,
    text(x - 6, y + 1, String(number), { size: 21, fill: '#1a1204', weight: 800, anchor: 'middle' }),
    rect(lx, ly, lw, 32, { fill: '#2a2110', stroke: C.waiting, r: 8 }),
    text(lx + 15, ly + 21, label, { size: 15, fill: '#ffe2a6', weight: 600 }),
  ].join('\n')
}

/** An arrow from one point to another, in the board's blue. */
const arrow = (x1, y1, x2, y2, color = C.free) => {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = [[x2, y2], [x2 - 12 * Math.cos(angle - 0.45), y2 - 12 * Math.sin(angle - 0.45)], [x2 - 12 * Math.cos(angle + 0.45), y2 - 12 * Math.sin(angle + 0.45)]]
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3" stroke-linecap="round"/><polygon points="${head.map(point => point.map(n => n.toFixed(1)).join(',')).join(' ')}" fill="${color}"/>`
}

/** A chat bubble: the partner's (left, panel) or yours (right, blue). */
function bubble(x, y, w, lines, mine) {
  const h = 18 + lines * 16
  return `${rect(x, y, w, h, { fill: mine ? '#1d3a6b' : C.inset, stroke: mine ? '#2f5ea8' : C.line, r: 10 })}${Array.from({ length: lines }, (_, i) => bar(x + 14, y + 13 + i * 16, (i === lines - 1 ? 0.6 : 0.9) * (w - 28), mine ? '#cfe0ff' : C.muted, 7)).join('')}`
}

/** The Overview's three columns: your focus's steps, the workers, Needs your attention. */
function overviewBody() {
  const steps = [['Done', C.working], ['Done', C.working], ['Next', C.edge], ['Next', C.edge]]
  const stepRows = steps.map(([state, fill], i) => `${pill(40, 186 + i * 52, state, fill, state === 'Done' ? '#08110c' : C.text)}${bar(106, 190 + i * 52, 150)}${bar(106, 204 + i * 52, 100)}`).join('')
  const workers = [['Main', null], ['Worker 1', 0.7], ['Worker 2', 0.35], ['Worker 3', 0.9]]
  const workerRows = workers.map(([name, share], i) => `${text(346, 200 + i * 56, name, { size: 14, weight: 700 })}${share === null ? text(436, 200 + i * 56, 'free', { size: 13, fill: C.muted }) : `${rect(432, 186 + i * 56, 38, 18, { fill: 'none', stroke: 'none' })}${bar(436, 189 + i * 56, 140, C.link)}${progress(436, 206 + i * 56, 150, share)}`}`).join('')
  return [
    text(24, 82, 'My project', { size: 24, weight: 700 }),
    text(24, 112, 'Focus G1 · Your goal · 2 of 4 steps done · about 2 h left', { size: 14, weight: 600 }),
    progress(24, 122, 912, 0.5),
    rect(20, 146, 290, 380, { r: 12 }), text(38, 172, 'Your focus: its steps', { size: 16, weight: 700 }), stepRows,
    rect(326, 146, 290, 380, { r: 12 }), text(344, 172, 'Workers', { size: 16, weight: 700 }), workerRows,
    rect(632, 146, 308, 380, { r: 12 }), text(650, 172, 'Needs your attention', { size: 16, weight: 700 }),
    `<circle cx="836" cy="166" r="11" fill="${C.waiting}"/>`, text(836, 171, '1', { size: 13, fill: '#1a1204', weight: 800, anchor: 'middle' }),
  ].join('\n')
}

/** The Focus page: its goal, the three stages, and the talk with your partner on the right. */
function focusBody(stage) {
  const stages = ['The vibe', 'The how', 'The run'].map((name, i) => {
    const x = 24 + i * 152
    const done = i < stage
    const on = i === stage
    return `${rect(x, 128, 136, 34, { fill: on ? '#16264a' : C.panel, stroke: done ? '#2c7a4b' : on ? C.free : C.line, r: 8 })}<circle cx="${x + 20}" cy="145" r="10" fill="${done ? C.working : on ? C.free : C.edge}"/>${text(x + 20, 150, String(i + 1), { size: 12, fill: done ? '#08110c' : C.text, weight: 700, anchor: 'middle' })}${text(x + 38, 150, `${name}${done ? ' ✓' : ''}`, { size: 14, fill: done ? C.working : C.text, weight: 600 })}`
  }).join('')
  return [
    ...['Focus', 'Goals', 'Brainstorm'].map((name, i) => `${rect(22 + i * 92, 60, 84, 26, { fill: i === 0 ? '#16264a' : C.panel, stroke: i === 0 ? C.free : C.line, r: 6 })}${text(64 + i * 92, 78, name, { size: 12.5, fill: i === 0 ? C.text : C.muted, weight: i === 0 ? 600 : 400, anchor: 'middle' })}`),
    text(24, 116, 'G1 · Your goal', { size: 24, weight: 700 }),
    stages,
  ].join('\n')
}

/** The talk with your partner, as the Focus page shows it on the right. */
function talk(x, y, w, h) {
  return [
    rect(x, y, w, h, { r: 12 }),
    text(x + 18, y + 30, 'Advisor', { size: 16, weight: 700 }), text(x + 92, y + 30, 'your partner', { size: 12.5, fill: C.muted }),
    `<circle cx="${x + w - 24}" cy="${y + 25}" r="5" fill="${C.working}"/>`,
    bubble(x + 16, y + 50, w - 90, 3, false),
    bubble(x + 74, y + 126, w - 90, 2, true),
    bubble(x + 16, y + 186, w - 90, 3, false),
    rect(x + 16, y + h - 52, w - 32, 36, { fill: C.inset, stroke: C.edge, r: 8 }), text(x + 30, y + h - 29, 'Say something…', { size: 13, fill: C.muted }),
  ].join('\n')
}

/** The how: its parts, each with its size, and Go. */
function how(x, y, w, { done = false } = {}) {
  const parts = ['Part 1', 'Part 2', 'Part 3'].map((name, i) => `${rect(x + 16, y + 48 + i * 50, w - 32, 40, { fill: C.inset, r: 8 })}${text(x + 30, y + 73 + i * 50, name, { size: 14, weight: 700 })}${bar(x + 92, y + 66 + i * 50, w - 200)}${text(x + w - 30, y + 73 + i * 50, ['2 h', '1 h', '3 h'][i], { size: 13, fill: C.muted, anchor: 'end' })}`).join('')
  return [
    rect(x, y, w, 250, { r: 12 }),
    text(x + 18, y + 30, 'The how', { size: 17, weight: 700 }),
    parts,
    done ? '' : `${rect(x + w - 112, y + 202, 96, 36, { fill: C.working, stroke: 'none', r: 8 })}${text(x + w - 64, y + 226, 'Go', { size: 16, fill: '#08110c', weight: 800, anchor: 'middle' })}`,
  ].join('\n')
}

/** The six pictures, in the tour's order. */
export const HELP_PICTURES = [
  {
    name: '1-install',
    svg: () => [
      `<rect width="${W}" height="${H}" fill="${C.bg}"/>`,
      '<g transform="translate(0 40)">',
      rect(48, 120, 430, 260, { fill: '#05080d', stroke: C.edge, r: 12 }),
      `<rect x="48" y="120" width="430" height="34" rx="12" fill="${C.inset}"/><rect x="48" y="140" width="430" height="14" fill="${C.inset}"/>`,
      ...['#ff6b6b', C.waiting, C.working].map((fill, i) => `<circle cx="${70 + i * 18}" cy="137" r="5.5" fill="${fill}"/>`),
      text(150, 142, 'Terminal', { size: 13, fill: C.muted }),
      text(70, 190, '> irm …/install.ps1 | iex', { size: 16, fill: C.text, family: 'Consolas, monospace' }),
      text(70, 226, 'Installing the board…', { size: 14, fill: C.muted, family: 'Consolas, monospace' }),
      text(70, 254, 'Making your project…', { size: 14, fill: C.muted, family: 'Consolas, monospace' }),
      text(70, 290, '✓ The board runs: 127.0.0.1:4310', { size: 14, fill: C.working, family: 'Consolas, monospace' }),
      ring(48, 120, 430, 260, 1, 'One command installs it'),
      arrow(500, 250, 556, 250),
      rect(572, 150, 340, 200, { fill: C.bg, stroke: C.edge, r: 10 }),
      `<rect x="572" y="150" width="340" height="30" rx="10" fill="#0c121d"/><rect x="572" y="170" width="340" height="10" fill="#0c121d"/>`,
      ...['Overview', 'Focus', 'Backlog', 'Design'].map((name, i) => text(594 + i * 74, 170, name, { size: 11, fill: i === 0 ? C.text : C.muted, weight: i === 0 ? 600 : 400 })),
      text(594, 212, 'My project', { size: 17, weight: 700 }),
      rect(594, 228, 296, 98, { fill: C.panel, r: 8 }), bar(612, 250, 200), bar(612, 268, 150),
      rect(612, 286, 100, 28, { fill: C.free, stroke: 'none', r: 6 }), text(662, 305, 'Initialise', { size: 12.5, weight: 600, anchor: 'middle' }),
      text(742, 388, 'your board opens', { size: 14, fill: C.muted, anchor: 'middle' }),
      '</g>',
    ].join('\n'),
  },
  {
    name: '2-initialise',
    svg: () => frame('Overview', [
      text(24, 92, 'My project', { size: 26, weight: 700 }),
      text(24, 120, 'A new project: no main chat yet', { size: 14, fill: C.muted }),
      rect(24, 146, 520, 170, { r: 12 }),
      text(48, 184, 'Start the project', { size: 18, weight: 700 }),
      bar(48, 204, 380), bar(48, 222, 300),
      rect(48, 248, 170, 46, { fill: C.free, stroke: 'none', r: 8 }), text(133, 278, 'Initialise', { size: 17, weight: 700, anchor: 'middle' }),
      ring(48, 248, 170, 46, 2, 'Press Initialise'),
      arrow(236, 271, 600, 271),
      rect(612, 146, 320, 250, { r: 12 }),
      text(632, 178, 'Main chat', { size: 16, weight: 700 }), text(718, 178, 'starts in the Claude app', { size: 12.5, fill: C.muted }),
      bubble(632, 198, 250, 3, false),
      text(632, 296, 'It sets up the rest:', { size: 13, fill: C.muted }),
      ...['the workers', 'your partner', 'the backlog'].map((name, i) => `<circle cx="640" cy="${322 + i * 22}" r="4" fill="${C.working}"/>${text(652, 327 + i * 22, name, { size: 13 })}`),
    ].join('\n')),
  },
  {
    name: '3-talk',
    svg: () => frame('Focus', [
      focusBody(0),
      rect(24, 186, 470, 300, { r: 12 }),
      text(42, 216, 'The vibe', { size: 17, weight: 700 }), text(124, 216, 'how it should feel', { size: 13, fill: C.muted }),
      ...[0, 1, 2].map(i => `<circle cx="48" cy="${250 + i * 34}" r="4" fill="${C.muted}"/>${bar(62, 246 + i * 34, [330, 280, 360][i])}`),
      rect(42, 360, 434, 100, { fill: C.inset, r: 8 }), text(58, 384, 'A picture of it', { size: 13, fill: C.muted }),
      `<polygon points="70,446 120,404 160,436 200,412 260,446" fill="#24364f"/><circle cx="230" cy="402" r="10" fill="#3a5375"/>`,
      talk(516, 60, 420, 330),
      ring(516, 60, 420, 330, 3, 'Talk it through with your partner'),
    ].join('\n')),
  },
  {
    name: '4-go',
    svg: () => frame('Focus', [
      focusBody(1),
      how(24, 186, 560),
      ring(472, 388, 96, 36, 4, 'Agreed? Press Go'),
      arrow(604, 406, 660, 406, C.working),
      ...['B1', 'B2', 'B3'].map((id, i) => `${rect(676, 300 + i * 52, 250, 40, { fill: C.panel, r: 8 })}${text(692, 325 + i * 52, id, { size: 14, fill: C.link, weight: 700 })}${bar(726, 318 + i * 52, 130)}${pill(864, 309 + i * 52, 'step', C.edge, C.text, 50)}`),
      text(676, 286, 'Your partner makes the steps', { size: 13, fill: C.muted }),
    ].join('\n')),
  },
  {
    name: '5-workers',
    svg: () => frame('Overview', [overviewBody(), ring(326, 146, 290, 380, 5, 'The workers build the steps', { labelAt: 'inside' })].join('\n'), { dim: [[20, 146, 290, 380], [632, 146, 308, 380]] }),
  },
  {
    name: '6-check',
    svg: () => frame('Overview', [
      overviewBody(),
      rect(648, 190, 276, 300, { fill: '#1b1608', stroke: C.waiting, r: 10 }),
      pill(662, 204, '?', C.waiting, '#1a1204', 24), text(696, 221, 'Worker 2', { size: 14, weight: 700 }), pill(772, 204, 'Look', C.waiting, '#1a1204', 48),
      bar(662, 244, 230, C.text), bar(662, 260, 180, C.text),
      rect(662, 280, 248, 120, { fill: C.inset, r: 8 }),
      `<polygon points="680,386 740,330 790,370 830,344 896,386" fill="#2c4a6e"/><circle cx="858" cy="318" r="14" fill="${C.waiting}" opacity="0.85"/>`,
      rect(662, 412, 118, 34, { fill: C.working, stroke: 'none', r: 8 }), text(721, 434, 'Keep it', { size: 14, fill: '#08110c', weight: 700, anchor: 'middle' }),
      rect(790, 412, 120, 34, { fill: C.inset, stroke: C.edge, r: 8 }), text(850, 434, 'Change…', { size: 14, anchor: 'middle' }),
      ring(632, 146, 308, 380, 6, 'Look, then keep it or change it', { labelAt: 'inside' }),
    ].join('\n'), { dim: [[20, 146, 290, 380], [326, 146, 290, 380]] }),
  },
]

/** One picture as an SVG file's text. */
export function helpPicture(picture) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n${picture.svg()}\n</svg>\n`
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'help'))
  await mkdir(out, { recursive: true })
  for (const picture of HELP_PICTURES) await writeFile(join(out, `${picture.name}.svg`), helpPicture(picture))
  console.log(`${HELP_PICTURES.length} pictures in ${out}`)
}
