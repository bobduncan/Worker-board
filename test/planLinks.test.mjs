// B218: the game plan on the Advisor tab: its links work (a file of the game's folder opens read-only in a window of
// the board, a picture in the popup, a web page in a new tab), and its headings fold. The person, 2026-10-14:
// "advisor game plan has links that dont work i want to be able to click them in the UI", and "adding collapsing
// headers so this page feel more manageable". Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { findGameFile, insidePath, readGameFile } from '../src/gameFile.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const context = {}
vm.runInNewContext(`${script.slice(script.indexOf('// planlinks:start'), script.indexOf('// planlinks:end'))}\nthis.planTarget = planTarget`, context)
const target = (from, href) => JSON.parse(JSON.stringify(context.planTarget(from, href) ?? null))

test('a link is read from the file it stands in: a path inside the game\'s folder, a web page, or nothing', () => {
  assert.deepEqual(target('docs/game-plan.md', 'visual/units.md'), { path: 'docs/visual/units.md', alt: 'visual/units.md', isPicture: false })
  assert.deepEqual(target('docs/game-plan.md', './process/done/level.md#checks'), { path: 'docs/process/done/level.md', alt: 'process/done/level.md', isPicture: false })
  assert.deepEqual(target('docs/game-plan.md', '../art/hero%20sheet.png'), { path: 'art/hero sheet.png', alt: null, isPicture: true })
  // A plan may write its links from the project's folder: that reading goes along.
  assert.deepEqual(target('docs/game-plan.md', 'game/docs/advisor/decisions.md'), { path: 'docs/game/docs/advisor/decisions.md', alt: 'game/docs/advisor/decisions.md', isPicture: false })
  assert.deepEqual(target('docs/game-plan.md', 'https://example.com/a'), { web: 'https://example.com/a' })
  // Out of the folder, a root, a drive, another kind of address, or only an anchor: no file.
  for (const href of ['../../secret.md', '/etc/passwd', 'C:/x.md', 'file:///c:/x.md', 'javascript:alert(1)', '#part-2', '..\\x.md', '%E0%A4%A']) {
    assert.equal(target('docs/game-plan.md', href), null, href)
  }
})

test('the server shows a file inside the game\'s folder only, of a kind it knows, and small', async t => {
  const root = await mkdtemp(join(tmpdir(), 'game-file-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'docs', 'plan.md'), '# Plan')
  await writeFile(join(root, 'docs', 'run.exe'), 'MZ')
  await writeFile(join(root, 'docs', 'big.txt'), 'x'.repeat(1_000_001))
  // B426: a picture may be as large as the picture popup allows (32 MB), a text page 1 MB
  await writeFile(join(root, 'docs', 'big.png'), Buffer.alloc(2_000_000))
  await writeFile(join(root, 'docs', 'huge.png'), Buffer.alloc(32 * 1024 * 1024 + 1))
  assert.equal((await readGameFile(root, 'docs/big.png'))?.type, 'image/png')
  assert.equal(await readGameFile(root, 'docs/huge.png'), null)
  const outside = await mkdtemp(join(tmpdir(), 'game-out-'))
  t.after(() => rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeFile(join(outside, 'secret.md'), 'no')
  const found = await readGameFile(root, 'docs/plan.md')
  assert.deepEqual([found.type, found.body.toString()], ['text/plain; charset=utf-8', '# Plan'])
  for (const path of ['docs/run.exe', 'docs/big.txt', 'docs/none.md', '../secret.md', 'docs/../../x.md', '/docs/plan.md', 'docs\\plan.md', '']) {
    assert.equal(await readGameFile(root, path), null, path)
  }
  assert.equal(await readGameFile('', 'docs/plan.md'), null)
  // A link in the folder that leads out of it shows nothing.
  const linked = await symlink(outside, join(root, 'out'), 'junction').then(() => true, () => false)
  if (linked) assert.equal(await readGameFile(root, 'out/secret.md'), null)
  // The project's reading of a link, when the game's has nothing; never out of the project.
  assert.equal((await findGameFile({ gameRepo: join(root, 'docs'), project: root }, 'plan.md', null)).where, 'plan.md')
  assert.equal((await findGameFile({ gameRepo: join(root, 'docs'), project: root }, 'docs/plan.md', 'docs/plan.md')).where, 'docs/plan.md')
  assert.equal(await findGameFile({ gameRepo: join(root, 'docs'), project: root }, 'none.md', '../secret.md'), null)
  assert.equal(insidePath('docs/a b.md'), true)
  assert.equal(insidePath('docs/./a.md'), false)
})

test('the page: the plan folds under its headings with their first line, and its links open where they point', () => {
  const plan = script.slice(script.indexOf('function gameFileNodes('), script.indexOf('function drawAdvice('))
  assert.match(plan, /const box = el\('details', `plan-part is-level-\$\{Math\.min\(level, 4\)\}`\)\n {6}box\.open = planOpen\.has\(key\)/)
  assert.match(plan, /part\.summary\.append\(el\('small', 'plan-line'/)
  assert.match(script, /fill\(box, gameFileNodes\(state\.advice, state\.gamePlan \?\? '', true\)\)/)
  // One function of each name: a second "function planNodes" would take the place of a worker's plan in its window.
  for (const name of ['planNodes', 'gameFileNodes', 'planTarget', 'planLinker', 'openGameFile']) {
    assert.equal((script.match(new RegExp(`function ${name}\\(|const ${name} =`, 'g')) ?? []).length, 1, name)
  }
  // A web page in a new tab, without the board's page as its opener; a file in the board's window.
  assert.match(script, /link\.target = '_blank'\n {4}link\.rel = 'noopener noreferrer'/)
  assert.match(script, /const query = `path=\$\{encodeURIComponent\(path\)\}\$\{alt === null \? '' : `&alt=\$\{encodeURIComponent\(alt\)\}`\}`/)
  assert.match(script, /fetch\(`\/api\/game-file\?\$\{query\}`, \{ headers: \{ 'X-Board-Token': TOKEN \} \}\)/)
  assert.match(html, /<dialog class="file-view" id="file-view"/)
  // Links in a chat's words stay words: only the plan's text gets working links.
  assert.match(script, /if \(link !== null && linker !== null\) pieces\.push\(linker\(link\[1\], link\[2\]\)\)/)
})

test('T5.2 A4: with the data home and the chat home set, a plan\'s link is found where the table puts it (a plan under <data>/docs, a chat log in the chat home, the store under <data>), inside those homes only; with the settings empty nothing new is looked at', async t => {
  const root = await mkdtemp(join(tmpdir(), 'game-file-a4-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const project = join(root, 'wrap', 'game')
  const data = join(project, '.workerboard')
  const home = join(root, 'wrap')
  await mkdir(join(data, 'docs', 'plans'), { recursive: true })
  await mkdir(join(data, '.claude', 'work'), { recursive: true })
  await mkdir(join(home, '.claude', 'chat-logs', 'Main'), { recursive: true })
  await mkdir(join(project, '.claude', 'plans'), { recursive: true })
  await writeFile(join(data, 'docs', 'plans', 'p.md'), '# Moved plan')
  await writeFile(join(data, '.claude', 'work', 'B1.md'), 'Id: B1')
  await writeFile(join(home, '.claude', 'chat-logs', 'Main', 'x.txt'), 'log')
  await writeFile(join(root, 'secret.md'), 'no')
  const moved = { project, gameRepo: project, chatHome: home, data, work: '.claude/work', backlog: '.claude/backlog.md', pictureRoots: [] }
  assert.equal(String((await findGameFile(moved, '.claude/plans/p.md', null)).body), '# Moved plan')
  assert.equal(String((await findGameFile(moved, '.claude/chat-logs/Main/x.txt', null)).body), 'log')
  assert.equal(String((await findGameFile(moved, '.claude/work/B1.md', null)).body), 'Id: B1')
  assert.equal(await findGameFile(moved, '../../secret.md', null), null, 'never out of a home')
  assert.equal(await findGameFile(moved, '.claude/plans/none.md', null), null)
  // The settings empty: the game's and the project's folders only, as before.
  const today = { project, gameRepo: project, chatHome: '', data: '', work: '.claude/work', backlog: '.claude/backlog.md', pictureRoots: [] }
  await writeFile(join(project, '.claude', 'plans', 'q.md'), '# Here')
  assert.equal(String((await findGameFile(today, '.claude/plans/q.md', null)).body), '# Here')
  assert.equal(await findGameFile(today, '.claude/plans/p.md', null), null, 'the data home is not looked at while data is empty')
  assert.equal(await findGameFile(today, '.claude/chat-logs/Main/x.txt', null), null)
})
