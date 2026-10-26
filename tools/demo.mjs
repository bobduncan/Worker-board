// B677: the goal demo the person sees before they answer "Did we reach the goal?": one picture of everything the goal
// made. Three sections apart: Reached (green titles), Not reached with what went wrong (red titles), Still open (grey);
// in every row the target first, then the state before this goal, then results in between, and the final result last;
// every picture labelled plainly (target, before this goal, in between, final in the game or not); then a last section,
// the follow-up on what went wrong (fixed for good, fixed this time only, not fixed yet, escalated). It knows nothing of
// the project's work: the partner's helper writes the list, this draws it.
//
//   node tools/demo.mjs --list demo.json [--out G12-demo.png]
//
// The list (JSON):
//   { "goal": "G12", "title": "How we build good maps", "intro": "optional line under the title",
//     "sections": [ { "kind": "reached" | "not-reached" | "open", "intro": ["a line"], "items": ["one bullet each"],
//                     "rows": [ { "title": "1. The row", "note": "one line", "pictures": [ { "kind": "target", "caption": "Concept B", "path": "a.png" } ] },
//                               { "title": "6. A grid", "note": "...", "grid": [ { "caption": "A", "path": "b.png" } ], "cols": 4 } ] } ],
//     "followUp": { "fixedForGood": ["..."], "fixedOnce": ["..."], "backlog": ["..."], "noStep": ["..."], "escalate": ["..."] } }
//
// A picture's kind: target, before, between, final (in the game), final-not (the last try, in the game) or final-art
// (the final, not in the game yet). The rows' pictures are put in that order whatever order they are listed in. A path is
// absolute or relative to the list's folder; a picture that is not there stops the demo and is named (only files that
// exist). Pictures keep their own pixel size (B686): a row wraps to the next line when the next picture does not fit, and only a picture wider than the page shrinks to the page; "cols" is no longer used. Every bullet
// list is one item per line: an item with a line break or a "•" in it is refused. Without --out the picture lands beside
// the list as <goal>-demo.png. It is drawn by a headless Edge or Chrome as tools/evidence.mjs does (B266).

import { existsSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findBrowser, shootPage } from './evidence.mjs'

export const WIDTH = 2400
const SECTIONS = {
  reached: { band: 'REACHED', colour: '#5ad19a', ink: '#0a140e' },
  'not-reached': { band: 'NOT REACHED: WHAT WENT WRONG', colour: '#ff8278', ink: '#1a0b09' },
  open: { band: 'STILL OPEN', colour: '#9aa7bb', ink: '#0d1218' },
}
/** The pictures of a row in this order: the target first, the final last. */
const PICTURES = {
  target: { rank: 0, label: 'TARGET', colour: '#e6ecf5' },
  before: { rank: 1, label: 'BEFORE THIS GOAL', colour: '#8fb6ff' },
  between: { rank: 2, label: 'IN BETWEEN', colour: '#8fb6ff' },
  final: { rank: 3, label: 'FINAL, IN THE GAME', colour: '#5ad19a' },
  'final-not': { rank: 3, label: 'LAST TRY, IN THE GAME', colour: '#ff8278' },
  'final-art': { rank: 3, label: 'FINAL, NOT IN THE GAME YET', colour: '#5ad19a' },
}
/** The follow-up's five groups, in this order. */
const GROUPS = [
  ['fixedForGood', 'Fixed for good: a rule or the board now prevents it', '#5ad19a'],
  ['fixedOnce', 'Fixed this time only: needs a lasting fix', '#f0be5a'],
  ['backlog', 'Not fixed yet: on the backlog', '#8fb6ff'],
  ['noStep', 'Not fixed yet: no step', '#f0be5a'],
  ['escalate', 'Escalate: no clear fix here', '#ff8278'],
]
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

const esc = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The list's words as the page draws them; it throws with the reason on a list it cannot draw. Pure: no file is read. */
export function checkList(list) {
  if (list === null || typeof list !== 'object' || Array.isArray(list)) throw new Error('The demo list is an object.')
  if (typeof list.goal !== 'string' || !/^G\d+$/.test(list.goal)) throw new Error('The list names its goal by id: "goal": "G12".')
  if (!Array.isArray(list.sections) || list.sections.length === 0) throw new Error('The list has no sections.')
  for (const [at, section] of list.sections.entries()) {
    if (SECTIONS[section?.kind] === undefined) throw new Error(`Section ${at + 1}: "kind" is reached, not-reached or open.`)
    for (const item of [...(section.intro ?? []), ...(section.items ?? [])]) bulletOf(item, `Section ${at + 1}`)
    for (const [r, row] of (section.rows ?? []).entries()) {
      const name = `Section ${at + 1}, row ${r + 1}`
      if (typeof row?.title !== 'string' || row.title.trim() === '') throw new Error(`${name} has no title.`)
      const hasPictures = Array.isArray(row.pictures) && row.pictures.length > 0
      const hasGrid = Array.isArray(row.grid) && row.grid.length > 0
      if (hasPictures === hasGrid) throw new Error(`${name} has pictures or a grid, one of the two.`)
      for (const one of row.pictures ?? []) {
        if (PICTURES[one?.kind] === undefined) throw new Error(`${name}: a picture's kind is ${Object.keys(PICTURES).join(', ')}.`)
        if (typeof one.path !== 'string' || one.path === '') throw new Error(`${name}: a picture has no path.`)
      }
      for (const one of row.grid ?? []) if (typeof one?.path !== 'string' || one.path === '') throw new Error(`${name}: a grid picture has no path.`)
    }
  }
  for (const [key] of GROUPS) for (const item of list.followUp?.[key] ?? []) bulletOf(item, `The follow-up (${key})`)
  return list
}

/** One bullet's words: one item, never several on one line. */
function bulletOf(item, where) {
  const words = String(item ?? '').trim()
  if (words === '') throw new Error(`${where}: an empty bullet.`)
  if (/[\r\n]/.test(words) || words.includes('•')) throw new Error(`${where}: one item per bullet, never several on one line: "${words.slice(0, 60)}".`)
  return words
}

/** Every picture file the list names, as a path (absolute, or from `base`). */
export function pictureFiles(list, base) {
  const at = path => (isAbsolute(path) ? path : resolve(base, path))
  return (list.sections ?? []).flatMap(section => (section.rows ?? []).flatMap(row => [...(row.pictures ?? []), ...(row.grid ?? [])].map(one => at(one.path))))
}

/** Pictures that are not there, by their paths: the demo shows only files that exist. */
export function missingPictures(list, base, exists = existsSync) {
  return [...new Set(pictureFiles(list, base))].filter(file => !exists(file))
}

/** The pictures of a row in the demo's order; equal ranks keep the order they were listed in. */
export const orderedPictures = pictures => pictures.map((one, at) => ({ one, at })).sort((a, b) => PICTURES[a.one.kind].rank - PICTURES[b.one.kind].rank || a.at - b.at).map(({ one }) => one)

const list = (items, cls = '') => (items.length === 0 ? '' : `<ul class="${cls}">${items.map(item => `<li>${esc(bulletOf(item, 'A bullet'))}</li>`).join('')}</ul>`)

function rowHtml(row, colour, at) {
  const src = one => esc(pathToFileURL(isAbsolute(one.path) ? one.path : resolve(at, one.path)).href)
  const head = `<h3 style="color:${colour}">${esc(row.title)}</h3>${row.note ? `<p class="note">${esc(row.note)}</p>` : ''}`
  if (Array.isArray(row.grid) && row.grid.length > 0) {
    return `<section class="row">${head}<div class="grid">${row.grid.map(one => `<figure><figcaption>${esc(one.caption)}</figcaption><img src="${src(one)}" alt="${esc(one.caption)}"></figure>`).join('')}</div></section>`
  }
  const figures = orderedPictures(row.pictures).map(one => {
    const kind = PICTURES[one.kind]
    return `<figure><div class="kind" style="color:${kind.colour}">${kind.label}</div><figcaption>${esc(one.caption)}</figcaption><img src="${src(one)}" alt="${esc(one.caption)}"></figure>`
  }).join('')
  return `<section class="row">${head}<div class="pictures">${figures}</div></section>`
}

/** The demo's page: pure; `base` is the folder a relative picture path starts from. */
export function demoHtml(input, base = '.') {
  const demo = checkList(input)
  const sections = demo.sections.map(section => {
    const look = SECTIONS[section.kind]
    return `<div class="band" style="background:${look.colour};color:${look.ink}">${look.band}</div>${list(section.intro ?? [], 'intro')}${list(section.items ?? [])}${(section.rows ?? []).map(row => rowHtml(row, look.colour, base)).join('')}`
  }).join('')
  const groups = GROUPS.map(([key, title, colour]) => ((demo.followUp?.[key] ?? []).length === 0 ? '' : `<section class="group"><h3 style="color:${colour};border-left-color:${colour}">${esc(title)}</h3>${list(demo.followUp[key])}</section>`)).join('')
  const follow = groups === '' ? '' : `<div class="band" style="background:#e6ecf5;color:#0d1218">FOLLOW-UP: WHAT WENT WRONG, AND WHAT IS DONE ABOUT IT</div>${groups}`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#10141c;color:#e6ecf5;font-family:'Segoe UI',system-ui,sans-serif}
body{width:${WIDTH}px;padding-bottom:30px}
h1{margin:0;padding:24px 24px 0;font-size:48px}.sub{margin:0;padding:14px 24px 20px;color:#aab8cd;font-size:27px}
.band{margin:16px 0 8px;padding:12px 24px;font-size:40px;font-weight:700}
h3{margin:0;padding:18px 24px 0;font-size:34px}
.note{margin:6px 24px 0;color:#aab8cd;font-size:27px}
ul{margin:8px 24px 8px;padding-left:36px;font-size:27px;line-height:38px}li{margin:0}ul.intro{list-style:none;padding-left:0}
.pictures{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;padding:10px 20px 6px}
figure{margin:0;min-width:0;max-width:100%;flex:none}.pictures img{display:block;max-width:100%;height:auto}
figure .kind{font-size:24px;font-weight:700;padding:0 4px}figcaption{font-size:24px;color:#aab8cd;padding:2px 4px 6px}
.grid{display:flex;flex-wrap:wrap;gap:16px;padding:10px 20px;align-items:flex-start}.grid img{display:block;max-width:100%;height:auto}.grid figcaption{color:#e6ecf5}
.group h3{border-left:10px solid;margin:10px 0 0 24px;padding:0 0 0 14px;font-size:34px}
</style></head><body>
<h1>${esc(demo.goal)} · ${esc(demo.title ?? 'the goal demo')}: the goal demo</h1>
<p class="sub">${esc(demo.intro ?? 'In every row: target first, then before this goal, then results in between, and the final result last.')}</p>
${sections}${follow}
</body></html>`
}

/** Runs in the page: waits for every picture, then answers the picture's size. */
const LAYOUT = `(async () => {
  const images = [...document.images]
  await Promise.all(images.map(image => (image.decode ? image.decode().catch(() => {}) : Promise.resolve())))
  const broken = images.filter(image => image.naturalWidth === 0).map(image => image.alt)
  if (broken.length > 0) throw new Error('These pictures did not load: ' + broken.join(', '))
  return { width: ${WIDTH}, height: Math.ceil(document.documentElement.scrollHeight) }
})()`

/** Draws the demo of the list file into `out` (beside the list as <goal>-demo.png without it). */
export async function renderDemo({ listFile, out, browser = findBrowser() }) {
  const file = resolve(listFile)
  const input = checkList(JSON.parse(await readFile(file, 'utf8')))
  const base = dirname(file)
  const gone = missingPictures(input, base)
  if (gone.length > 0) throw new Error(`These pictures are not there; the demo shows only files that exist:\n${gone.map(one => `  ${one}`).join('\n')}`)
  for (const picture of pictureFiles(input, base)) if (TYPES[extname(picture).toLowerCase()] === undefined) throw new Error(`${basename(picture)}: a picture is a .png, .jpg, .webp or .gif.`)
  const target = out === undefined ? join(base, `${input.goal}-demo.png`) : resolve(out)
  return shootPage({ browser, html: demoHtml(input, base), layoutScript: LAYOUT, viewport: { width: WIDTH, height: 1000 }, out: target, timeoutMs: 180_000 })
}

function argsOf(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '')
    if (!argv[i].startsWith('--') || !['list', 'out'].includes(name)) throw new Error(`Unknown argument ${argv[i]}.`)
    if (argv[i + 1] === undefined) throw new Error(`--${name} needs a value.`)
    args[name] = argv[i + 1]
  }
  if (args.list === undefined) throw new Error('--list is needed: the JSON list of the demo.')
  return args
}

function isCommand() {
  if (process.argv[1] === undefined) return false
  const same = path => { const real = realpathSync(resolve(path)); return process.platform === 'win32' ? real.toLowerCase() : real }
  try { return same(process.argv[1]) === same(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isCommand()) {
  const args = argsOf(process.argv.slice(2))
  renderDemo({ listFile: args.list, out: args.out })
    .then(done => console.log(`saved ${done.out} (${done.layout.width}x${done.layout.height})`))
    .catch(error => { console.error(error.message); process.exit(1) })
}
