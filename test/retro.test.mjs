// The Retrospective tab (chat 1's brief, 2026-11-27): the pages newest first with their "In one line", one page by its date,
// the button's states, and the one word to the main chat.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { listRetros, mayRun, oneLineOf, readRetro, retroFolderOf, retroWords, RUN_STALE_MS, runView } from '../src/retro.mjs'

/** A page in its shape since 2026-11-27: "In short" first (three lines), no "In one line". */
const PAGE = (line, extra = '') => `# Weekly retrospective\n\n## 1. In short\n\n- ${line}\n- Second line.\n- Third line.\n\n## 2. The numbers\n\n| number | this week | last week |\n|---|---|---|\n| items done | 41 steps · 12 go-lives | 33 steps · 9 go-lives |\n${extra}`
/** An older page, with its "In one line" section. */
const OLD_PAGE = line => `# Weekly retrospective\n\n## 1. In one line\n\n${line}\n\n## 2. The numbers\n`

async function folderWith(t, pages) {
  const root = await mkdtemp(join(tmpdir(), 'retro-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const folder = retroFolderOf(root)
  await mkdir(folder, { recursive: true })
  for (const [date, text, at] of pages) {
    await writeFile(join(folder, `${date}.md`), text)
    if (at) await utimes(join(folder, `${date}.md`), at / 1000, at / 1000)
  }
  return folder
}

test('retro: the pages newest first, each with the first line of its "In short" (an older page: its "In one line"); a missing folder has none', async t => {
  const folder = await folderWith(t, [['2026-11-20', OLD_PAGE('Slower: the test queue waited 31 hours.')], ['2026-11-27', PAGE('Faster: go-lives took half the time.')]])
  await writeFile(join(folder, 'notes.txt'), 'x')
  const pages = await listRetros(folder)
  assert.deepEqual(pages.map(page => [page.date, page.oneLine]), [['2026-11-27', 'Faster: go-lives took half the time.'], ['2026-11-20', 'Slower: the test queue waited 31 hours.']])
  assert.ok(pages.every(page => Number.isFinite(page.at)))
  assert.deepEqual(await listRetros(join(folder, 'none')), [])
})

test('retro: the list line: "In short"\'s first line (a bullet, numbered or bold), else "In one line", else none', () => {
  assert.equal(oneLineOf(PAGE('**Faster:** go-lives took half the time.')), 'Faster: go-lives took half the time.')
  assert.equal(oneLineOf('## 1. In short\n\n1. More got done.\n2. Fewer refusals.\n'), 'More got done.')
  assert.equal(oneLineOf(`${OLD_PAGE('Older shape.')}\n## In short\n\nIn short wins.`), 'In short wins.', 'In short comes first wherever it stands')
  assert.equal(oneLineOf(OLD_PAGE('Same: nothing moved.')), 'Same: nothing moved.')
  assert.equal(oneLineOf('**In one line:** Faster, because the fence landed.\n'), 'Faster, because the fence landed.')
  assert.equal(oneLineOf('1. In one line: slower.\n'), 'slower.')
  assert.equal(oneLineOf('# Retro\n\nNothing here.'), null)
})

test('retro: one page by its date only; a path or a date that is no page gives nothing', async t => {
  const folder = await folderWith(t, [['2026-11-27', PAGE('Faster.')]])
  assert.match(await readRetro(folder, '2026-11-27'), /In short/)
  assert.equal(await readRetro(folder, '2026-11-28'), null)
  await writeFile(join(folder, '..', 'secret.md'), 'not a page')
  assert.equal(await readRetro(folder, '../secret'), null, 'a file beside the folder is never read')
  assert.equal(await readRetro(folder, '2026-11-27.md'), null)
})

test('retro: the word to the main chat starts one subagent with the task\'s prompt on demand, and nothing else', () => {
  const word = retroWords('Lava Tactics - Main', 'D:\\home\\.claude\\scheduled-tasks\\lava-weekly-retrospective\\SKILL.md')
  assert.equal(word.to, 'Lava Tactics - Main')
  assert.equal(word.command, 'retro-run')
  assert.match(word.text, /ON DEMAND/)
  assert.match(word.text, /start ONE subagent with a fresh context and give it the prompt in D:\\home\\\.claude\\scheduled-tasks\\lava-weekly-retrospective\\SKILL\.md/)
  assert.match(word.text, /skip that prompt's FIRST check/)
  assert.match(word.text, /Do nothing else yourself; when it ends, say done\./)
})

test('retro: the button\'s states: idle, asked for, running, done, and not finished (late, or the word dropped)', () => {
  const now = 10_000_000
  const pages = [{ date: '2026-11-20', at: 1_000 }]
  assert.deepEqual(runView({ pages, now }), { state: 'idle', lastRanAt: 1_000 })
  const run = { requestedAt: now - 60_000, by: 'the board page', to: 'Main', wordId: 'w1' }
  assert.equal(runView({ run, pages, outbox: [{ id: 'w1', state: 'waiting' }], now }).state, 'requested')
  const running = runView({ run, pages, outbox: [{ id: 'w1', state: 'taken', takenAt: now - 30_000 }], now })
  assert.deepEqual([running.state, running.since, running.to], ['running', now - 30_000, 'Main'])
  // The word left the outbox after it was taken: the kept takenAt says since when it runs.
  assert.equal(runView({ run: { ...run, takenAt: now - 30_000 }, pages, outbox: [], now }).state, 'running')
  assert.deepEqual(runView({ run, pages: [...pages, { date: '2026-11-27', at: now - 1_000 }], outbox: [], now }), { state: 'idle', lastRanAt: now - 1_000, done: true })
  const late = runView({ run: { ...run, takenAt: now - RUN_STALE_MS - 1 }, pages, outbox: [], now })
  assert.deepEqual([late.state, late.why], ['unfinished', 'no page 3 h after Main took it'])
  assert.equal(runView({ run, pages, outbox: [{ id: 'w1', state: 'dropped', why: 'the main chat does not run' }], now }).why, 'the main chat does not run')
  assert.equal(mayRun({ state: 'idle' }), true)
  assert.equal(mayRun({ state: 'unfinished' }), true)
  assert.equal(mayRun({ state: 'requested' }), false)
  assert.equal(mayRun({ state: 'running' }), false)
})

/** The pure part of public/retro.js. */
async function page() {
  const script = await readFile(new URL('../public/retro.js', import.meta.url), 'utf8')
  const context = { Date }
  vm.runInNewContext(`${script.slice(script.indexOf('// retro:start'), script.indexOf('// retro:end'))}\nthis.blocksOf = blocksOf; this.inlineOf = inlineOf; this.buttonOf = buttonOf; this.dateWords = dateWords`, context)
  return context
}

test('retro page: Markdown is read as headings, paragraphs, lists and the table; bold is the one inline mark; no HTML is made', async () => {
  const { blocksOf, inlineOf } = await page()
  const blocks = JSON.parse(JSON.stringify(blocksOf(`${PAGE('Faster: half the **wait**.')}\n## 3. Bottlenecks\n\n1. The test queue: 12 h\n2. Go-lives: 6 h\n\n- one\n- <b>two</b>\n\nA line\nthat goes on.`)))
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'heading', 'list', 'heading', 'table', 'heading', 'list', 'list', 'paragraph'])
  assert.deepEqual(blocks[2], { kind: 'list', ordered: false, items: ['Faster: half the **wait**.', 'Second line.', 'Third line.'] })
  assert.deepEqual(blocks[4], { kind: 'table', head: ['number', 'this week', 'last week'], rows: [['items done', '41 steps · 12 go-lives', '33 steps · 9 go-lives']] })
  assert.deepEqual(blocks[6], { kind: 'list', ordered: true, items: ['The test queue: 12 h', 'Go-lives: 6 h'] })
  assert.deepEqual(blocks[7].items, ['one', '<b>two</b>'], 'markup is kept as text, drawn with textContent')
  assert.equal(blocks[8].text, 'A line that goes on.')
  // The bottlenecks are short paragraphs, each with its bold name first: each stays one paragraph.
  const bottlenecks = JSON.parse(JSON.stringify(blocksOf('## 3. Biggest bottlenecks\n\n**Waiting for a go (9 step-hours).** Built changes waited.\nCause: one at a time.\n\n**PC sleep (6 hours).** The PC slept twice.')))
  assert.deepEqual(bottlenecks.map(block => [block.kind, block.text ?? null]), [['heading', '3. Biggest bottlenecks'], ['paragraph', '**Waiting for a go (9 step-hours).** Built changes waited. Cause: one at a time.'], ['paragraph', '**PC sleep (6 hours).** The PC slept twice.']])
  assert.deepEqual(JSON.parse(JSON.stringify(inlineOf('half the **wait** now'))), [{ text: 'half the ', bold: false }, { text: 'wait', bold: true }, { text: ' now', bold: false }])
  const script = await readFile(new URL('../public/retro.js', import.meta.url), 'utf8')
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|outerHTML/)
})

test('retro page: the button in each state, with who and since when, and the cost line', async () => {
  const { buttonOf, dateWords } = await page()
  const now = new Date(2026, 10, 27, 16, 0).getTime()
  const at = new Date(2026, 10, 27, 15, 12).getTime()
  assert.deepEqual({ ...buttonOf({ state: 'idle', lastRanAt: new Date(2026, 10, 20, 15, 12).getTime() }, now) }, { label: 'Run retrospective now', disabled: false, line: 'Last run: 20 Nov 15:12. A run costs a few percent of the weekly limit.' })
  assert.deepEqual({ ...buttonOf({ state: 'requested', since: at, to: 'Lava Tactics - Main' }, now) }, { label: 'Asked Lava Tactics - Main at 15:12', disabled: true, line: 'Waiting for Lava Tactics - Main to pick it up. A run costs a few percent of the weekly limit.' })
  assert.deepEqual({ ...buttonOf({ state: 'running', since: at, to: 'Lava Tactics - Main' }, now) }, { label: 'Running…', disabled: true, line: 'Lava Tactics - Main runs it since 15:12. A run costs a few percent of the weekly limit.' })
  assert.equal(buttonOf({ state: 'idle', done: true, lastRanAt: at }, now).line, 'Done: the new page is on top. Last run: 15:12. A run costs a few percent of the weekly limit.')
  assert.deepEqual({ ...buttonOf({ state: 'unfinished', why: 'no page 3 h after Main took it' }, now) }, { label: 'Run retrospective again', disabled: false, line: 'The last run did not finish: no page 3 h after Main took it. A run costs a few percent of the weekly limit.' })
  assert.equal(buttonOf({ state: 'idle', lastRanAt: null }, now).line, 'No run yet. A run costs a few percent of the weekly limit.')
  assert.equal(dateWords('2026-11-27'), '27 Nov 2026')
})

test('retro: the server asks once: the button\'s route is a page route under the lock, and a second click while one runs writes nothing', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /'\/api\/retro-run': \{ kind: 'json', guard: 'lock' \}/)
  const run = server.slice(server.indexOf('    retroRun: async body => {'), server.indexOf('    },\n  })', server.indexOf('    retroRun: async body => {')))
  assert.ok(run.indexOf('if (!mayRun(now.run)) return { ok: false, status: 409') > 0)
  assert.ok(run.indexOf('if (!mayRun(now.run))') < run.indexOf('await store.say(message)'), 'the refusal comes before the word')
  assert.ok(run.indexOf('await store.say(message)') < run.indexOf('await writeAtomic(RETRO_RUN'))
  assert.match(server, /if \(pathname === '\/api\/retro-page'\) \{[^]*?retroPage\(searchParams\.get\('date'\) \?\? ''\)/)
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
  assert.match(html, /data-tab="spending">Spending<\/button>\s*<button class="tab" type="button" data-tab="retro">Retrospective<\/button>/)
})

test('retro page: a cell marked [+] is better, [-] worse, and the mark is not shown; a cell without one stays plain', async () => {
  const script = await readFile(new URL('../public/retro.js', import.meta.url), 'utf8')
  const context = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// retro:start'), script.indexOf('// retro:end'))}\nthis.markOf = markOf`, context)
  assert.deepEqual({ ...context.markOf('41 [+]') }, { text: '41', mark: 'better' })
  assert.deepEqual({ ...context.markOf('8 of 15 [-]') }, { text: '8 of 15', mark: 'worse' })
  assert.deepEqual({ ...context.markOf('22 min') }, { text: '22 min', mark: null })
  assert.deepEqual({ ...context.markOf('a [+] in the middle') }, { text: 'a [+] in the middle', mark: null })
  assert.match(script, /node\('td', mark === null \? '' : `retro-\$\{mark\}`\)/)
  const css = await readFile(new URL('../public/board.css', import.meta.url), 'utf8')
  assert.match(css, /\.retro-table td\.retro-better \{ color: var\(--working\)/)
  assert.match(css, /\.retro-table td\.retro-worse \{ color: var\(--warn\)/)
})
