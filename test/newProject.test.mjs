// B320: a new project in one click. The person, 2026-10-18 15:23: "also starting a new project feels like 1 click, the
// board setsup the folder and chat and the work stores itself as well." 15:26: "windows only and claude only ... with
// an icon to run it." One flow, from `npm run new` or the board's New project button: a name, a folder and the chats'
// prefix, asked once; a folder that is not empty is refused; then the folder, git, a README, the project's own copy of
// the board at the same version, its settings, the list of chats, an empty work store, the launch entry on a port of
// its own (B319), the project's CLAUDE.md and briefings, an icon on the desktop and in the Start menu, and the board
// started. Made-up projects in a temporary folder only; no real icon is made and no board is started here.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'
import { openCommand } from '../start-board.mjs'
import { checkNewProject, folderIsFree, makeProject, projectFiles, shortcutEnv, shortcutScript } from '../src/newProject.mjs'
import { readBoards } from '../src/ports.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFile(path, 'utf8')
const there = path => stat(path).then(() => true, () => false)

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'board-new-project-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }))
  return dir
}

test('checkNewProject: a name, a whole folder path, and the chats\' prefix ("<name> - " unless given)', () => {
  assert.deepEqual(checkNewProject({ name: ' Garden ', folder: 'D:\\Work\\garden' }), { ok: true, name: 'Garden', folder: 'D:\\Work\\garden', prefix: 'Garden - ' })
  assert.equal(checkNewProject({ name: 'Garden', folder: 'D:\\Work\\garden', prefix: 'G - ' }).prefix, 'G - ')
  assert.equal(checkNewProject({ name: 'Garden', folder: 'D:\\Work\\garden', prefix: '  ' }).prefix, 'Garden - ')
  for (const [input, words] of [
    [{ name: '', folder: 'D:\\Work\\x' }, /name/],
    [{ name: 'a/b', folder: 'D:\\Work\\x' }, /name/],
    [{ name: 'x'.repeat(61), folder: 'D:\\Work\\x' }, /name/],
    [{ name: 'Garden', folder: 'garden' }, /whole path/],
    [{ name: 'Garden', folder: '' }, /folder/],
    [{ name: 'Garden', folder: 'D:\\Work\\x', prefix: 'x'.repeat(41) }, /prefix/],
    // B322 review: the prefix goes into a chat's first words, quoted: no line break or quote in it.
    [{ name: 'Garden', folder: 'D:\\Work\\x', prefix: 'G\n1. Do' }, /prefix/],
    [{ name: 'Garden', folder: 'D:\\Work\\x', prefix: 'G" - ' }, /prefix/],
    [{ name: 'Gar\nden', folder: 'D:\\Work\\x' }, /name/],
    [{ name: 'Garden', folder: 'D:\\Work\\x\ty' }, /folder/],
  ]) {
    const checked = checkNewProject(input)
    assert.equal(checked.ok, false, JSON.stringify(input))
    assert.match(checked.why, words)
  }
})

test('folderIsFree: a folder that is not there or empty is free; anything in it, or a file, is not', async t => {
  const dir = await folder(t)
  assert.equal(await folderIsFree(join(dir, 'new')), true)
  await mkdir(join(dir, 'empty'))
  assert.equal(await folderIsFree(join(dir, 'empty')), true)
  await mkdir(join(dir, 'full'))
  await writeFile(join(dir, 'full', 'notes.txt'), 'x')
  assert.equal(await folderIsFree(join(dir, 'full')), false)
  assert.equal(await folderIsFree(join(dir, 'full', 'notes.txt')), false)
})

const examples = async () => ({
  config: await read(join(ROOT, 'examples', 'config.json')),
  flow: await read(join(ROOT, 'examples', 'work', 'flow.json')),
  claude: await read(join(ROOT, 'examples', 'CLAUDE.md')),
  mainBriefing: await read(join(ROOT, 'examples', 'main-briefing.md')),
  workerBriefing: await read(join(ROOT, 'examples', 'worker-briefing.md')),
})

test('projectFiles: the settings, the list of chats, an empty work store, the CLAUDE.md and briefings, filled in', async () => {
  const made = projectFiles({ name: 'Garden', prefix: 'Garden - ', project: 'D:\\Work\\garden', board: 'D:\\Work\\garden\\worker-board', examples: await examples() })
  const config = JSON.parse(made.config)
  assert.deepEqual([config.name, config.project, config.gameRepo, config.port], ['Garden', 'D:\\Work\\garden', '', 4310])
  // The list of chats names the prefix and the main chat; the board is started by its icon, not kept by the chats.
  assert.deepEqual(JSON.parse(made.files['.claude/chats/list.json']), { prefix: 'Garden - ', main: 'Main' })
  // An empty work store with the default flow and one activity for the first steps.
  assert.equal(made.files['.claude/work/flow.json'], (await examples()).flow)
  assert.deepEqual(JSON.parse(made.files['.claude/work/last-ids.json']), {})
  const activities = JSON.parse(made.files['.claude/work/activities.json'])
  assert.deepEqual(activities.activities.map(one => [one.name, one.isFocus, one.steps]), [['Garden', true, []]])
  // The CLAUDE.md holds the answer rules; the briefings know the project, the board and the prefix.
  const claude = made.files['CLAUDE.md']
  for (const words of ['> **For you**', '**Answer:**', '**Do:**', '**Task:**', '**What I did:**', '+ Done:   yes', 'paused for the limit until HH:MM', 'Garden']) assert.ok(claude.includes(words), words)
  for (const file of ['CLAUDE.md', '.claude/main-briefing.md', '.claude/worker-briefing.md', 'README.md']) {
    assert.ok(!/<(project|board|prefix|name)>/.test(made.files[file]), `${file} keeps a placeholder`)
  }
  assert.ok(made.files['.claude/main-briefing.md'].includes('"Garden - Main"'))
  assert.ok(made.files['.claude/worker-briefing.md'].includes('D:\\Work\\garden\\worker-board'))
  // The board's copy is a repository of its own, and the chats' files stay out of the project's.
  assert.match(made.files['.gitignore'], /^worker-board\/$/m)
  assert.match(made.files['.gitignore'], /^\.claude\/$/m)
  assert.match(made.files['README.md'], /^# Garden$/m)
  assert.match(made.files['README.md'], /Garden board/)
  // Review: a $ in a name is a $, never a pattern of the text it is put into.
  const cash = projectFiles({ name: "Cash $' flow $&", prefix: 'C - ', project: 'D:\\$$', board: 'D:\\$$\\worker-board', examples: await examples() })
  assert.match(cash.files['CLAUDE.md'], /^# Cash \$' flow \$&: how every chat answers the user$/m)
  assert.ok(cash.files['.claude/worker-briefing.md'].includes('D:\\$$\\worker-board'))
})

test('shortcutScript: an icon on the desktop and in the Start menu; the words come in apart, never inside the script', () => {
  // Review: a name or folder with quotes of any kind (’ is one to PowerShell too), $ or ` cannot change the script.
  const shortcut = { name: 'Bob’s $(calc) `board', target: 'C:\\Program Files\\nodejs\\node.exe', args: '"D:\\W\\x’;calc;’\\start-board.mjs" --open', cwd: 'D:\\W\\x’;calc;’', icon: 'D:\\W\\x’;calc;’\\public\\board.ico' }
  const script = shortcutScript()
  for (const word of ['Bob', 'calc', 'D:\\W']) assert.ok(!script.includes(word), word)
  assert.match(script, /GetFolderPath\('Desktop'\)/)
  assert.match(script, /GetFolderPath\('Programs'\)/)
  assert.match(script, /WindowStyle = 7/)
  // An icon of that name that is there already is left as it is, and named.
  assert.match(script, /Test-Path -LiteralPath \$file/)
  assert.match(script, /KEPT:/)
  assert.deepEqual(shortcutEnv(shortcut), {
    BOARD_ICON_NAME: 'Bob’s $(calc) `board.lnk', BOARD_ICON_TARGET: shortcut.target, BOARD_ICON_ARGS: shortcut.args,
    BOARD_ICON_CWD: shortcut.cwd, BOARD_ICON_FILE: `${shortcut.icon},0`, BOARD_ICON_ABOUT: 'Starts the worker board of Bob’s $(calc) `board and opens its page',
  })
})

test('start-board --open opens the board\'s page in the person\'s browser', () => {
  assert.deepEqual(openCommand('http://127.0.0.1:4313/', 'win32'), ['explorer.exe', ['http://127.0.0.1:4313/']])
  assert.deepEqual(openCommand('http://127.0.0.1:4313/', 'darwin')[0], 'open')
})

test('the board carries the icon the shortcuts show', async () => {
  const icon = await readFile(join(ROOT, 'public', 'board.ico'))
  // An .ico: reserved 0, type 1, at least one picture.
  assert.deepEqual([icon.readUInt16LE(0), icon.readUInt16LE(2)], [0, 1])
  assert.ok(icon.readUInt16LE(4) >= 1)
})

test('makeProject: the whole project, its own copy of the board at the same version, its port, its icons, its board started', { timeout: 120_000 }, async t => {
  const dir = await folder(t)
  const project = join(dir, 'garden')
  const boards = join(dir, 'pc', 'boards.json')
  const icons = []
  const started = []
  const made = await makeProject({
    name: 'Garden', folder: project, here: ROOT, boards,
    shortcuts: async shortcut => icons.push(shortcut),
    start: async board => {
      started.push(board)
      return { ok: true, line: 'The worker board runs.' }
    },
  })
  assert.equal(made.ok, true, made.why)
  const board = join(project, 'worker-board')
  assert.deepEqual([made.project, made.board], [project, board])

  // git in the folder; the board's copy is a clone at the commit of the board that made it.
  assert.equal(await there(join(project, '.git')), true)
  const head = folderPath => execFileSync('git', ['-C', folderPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assert.equal(head(board), head(ROOT))
  assert.equal(await there(join(board, 'server.mjs')), true)

  // Its settings, filled in; its port from the PC's list, the same in the launch entry.
  const config = JSON.parse(await read(join(board, 'config.json')))
  assert.deepEqual([config.name, config.project, config.gameRepo], ['Garden', project, ''])
  const listed = (await readBoards(boards)).find(one => one.project === project)
  assert.equal(listed.port, made.port)
  const launch = JSON.parse(await read(join(project, '.claude', 'launch.json')))
  assert.deepEqual(launch.configurations.map(one => [one.name, one.port]), [['worker-board', made.port]])
  assert.equal(made.url, `http://127.0.0.1:${made.port}/`)

  // The project's own files.
  for (const file of ['README.md', 'CLAUDE.md', '.gitignore', '.claude/chats/list.json', '.claude/work/flow.json', '.claude/work/activities.json', '.claude/work/last-ids.json', '.claude/main-briefing.md', '.claude/worker-briefing.md']) {
    assert.equal(await there(join(project, file)), true, file)
  }

  // One icon, made for the desktop and the Start menu, starts this project's board and opens its page.
  assert.equal(icons.length, 1)
  assert.deepEqual([icons[0].name, icons[0].target, icons[0].cwd], ['Garden board', process.execPath, board])
  assert.equal(icons[0].args, `"${join(board, 'start-board.mjs')}" --open`)
  assert.equal(icons[0].icon, join(board, 'public', 'board.ico'))
  assert.deepEqual(started, [board])
  assert.ok(made.lines.some(line => line.includes('Garden board')), made.lines.join('\n'))

  // Made again in the same folder: refused, and nothing in it changes.
  const before = await read(join(project, 'README.md'))
  const again = await makeProject({ name: 'Other', folder: project, here: ROOT, boards, shortcuts: async () => {}, start: async () => ({ ok: true }) })
  assert.deepEqual([again.ok, again.status], [false, 409])
  assert.match(again.why, /not empty/)
  assert.equal(await read(join(project, 'README.md')), before)
})

test('makeProject: an icon of that name already there is left as it is, and said', { timeout: 120_000 }, async t => {
  const dir = await folder(t)
  const kept = 'C:\\Users\\x\\Desktop\\Garden board.lnk'
  const made = await makeProject({ name: 'Garden', folder: join(dir, 'garden'), here: ROOT, boards: join(dir, 'pc', 'boards.json'), shortcuts: async () => ({ kept: [kept] }), start: async () => ({ ok: true }) })
  assert.equal(made.ok, true, made.why)
  assert.ok(made.warnings.some(line => line.includes(kept) && line.includes('left as it is')), made.warnings.join('\n'))
})

test('makeProject: from a board that is no repository, the copy is a repository of its own, so it delivers', { timeout: 120_000 }, async t => {
  const dir = await folder(t)
  const plain = join(dir, 'plain-board')
  for (const part of ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures', 'mods']) {
    await cp(join(ROOT, part), join(plain, part), { recursive: true })
  }
  const made = await makeProject({ name: 'Plain', folder: join(dir, 'plain'), here: plain, boards: join(dir, 'pc', 'boards.json'), shortcuts: async () => {}, start: async () => ({ ok: true }) })
  assert.equal(made.ok, true, made.why)
  const top = execFileSync('git', ['-C', made.board, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  assert.equal(top.replaceAll('/', '\\').toLowerCase(), made.board.toLowerCase())
})

test('makeProject: a project that fails half way leaves nothing behind, so it can be tried again', { timeout: 60_000 }, async t => {
  const dir = await folder(t)
  const broken = join(dir, 'broken-board')
  await mkdir(broken)
  const project = join(dir, 'half')
  const failed = await makeProject({ name: 'Half', folder: project, here: broken, boards: join(dir, 'pc', 'boards.json'), shortcuts: async () => {}, start: async () => ({ ok: true }) })
  assert.equal(failed.ok, false)
  assert.match(failed.why, /nothing of it was kept/)
  assert.equal(await there(project), false)
  assert.deepEqual(await readBoards(join(dir, 'pc', 'boards.json')), [])
  // An empty folder the person gave stays, empty.
  await mkdir(join(dir, 'given'))
  await makeProject({ name: 'Half', folder: join(dir, 'given'), here: broken, boards: join(dir, 'pc', 'boards.json'), shortcuts: async () => {}, start: async () => ({ ok: true }) })
  assert.equal(await folderIsFree(join(dir, 'given')), true)
  assert.equal(await there(join(dir, 'given')), true)
})

test('makeProject: a second project on the same PC takes another port', { timeout: 120_000 }, async t => {
  const dir = await folder(t)
  const boards = join(dir, 'pc', 'boards.json')
  const quiet = { here: ROOT, boards, shortcuts: async () => {}, start: async () => ({ ok: true }) }
  const one = await makeProject({ name: 'One', folder: join(dir, 'one'), ...quiet })
  const two = await makeProject({ name: 'Two', folder: join(dir, 'two'), ...quiet })
  assert.equal(one.ok && two.ok, true, `${one.why} ${two.why}`)
  assert.notEqual(one.port, two.port)
})

// The button on the board.

test('the board makes a new project only for its own page', async t => {
  const asked = []
  const server = createBoard({
    token: 'a'.repeat(64),
    getState: async () => ({ readAt: 1, chats: [] }),
    say: async () => ({ ok: false, status: 400, why: 'no' }),
    newProject: async body => {
      asked.push(body)
      return { ok: true, result: { url: 'http://127.0.0.1:4313/', lines: ['Made.'] } }
    },
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => server.close())
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  const post = headers => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/new-project', headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(JSON.stringify({ name: 'Garden', folder: 'D:\\Work\\garden', prefix: '' }))
  })
  assert.equal((await post({ 'Content-Type': 'application/json', Origin: origin })).status, 403)
  const done = await post({ 'X-Board-Token': 'a'.repeat(64), Origin: origin, 'Content-Type': 'application/json' })
  assert.equal(done.status, 200)
  assert.deepEqual(JSON.parse(done.text), { url: 'http://127.0.0.1:4313/', lines: ['Made.'] })
  assert.deepEqual(asked, [{ name: 'Garden', folder: 'D:\\Work\\garden', prefix: '' }])
})

const script = await read(join(ROOT, 'public', 'board.js'))
const html = await read(join(ROOT, 'public', 'index.html'))
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))

test('the New project button: in the ⚙ part, a form that asks the name, the folder and the prefix once', () => {
  assert.match(html, /<button[^>]*id="new-project-button"[^>]*>New project…<\/button>/)
  assert.match(html, /<dialog[^>]*id="new-project"/)
  for (const field of ['new-project-name', 'new-project-folder', 'new-project-prefix']) assert.match(html, new RegExp(`id="${field}"`))
  const page = {}
  vm.runInNewContext(`${cut('newproject')}\nthis.suggestedFolder = suggestedFolder; this.newProjectDone = newProjectDone`, page)
  // The folder is suggested beside this project's, named after the project; a typed folder is kept.
  assert.equal(page.suggestedFolder('D:\\Work', 'Garden'), 'D:\\Work\\Garden')
  assert.equal(page.suggestedFolder('D:\\Work\\', 'My garden'), 'D:\\Work\\My garden')
  assert.equal(page.suggestedFolder(null, 'Garden'), '')
  // What the page says once it is made: where, and the link to the new board.
  const warning = 'The icon "Garden board" could not be made (x): start the board with: node "D:\\Work\\Garden\\worker-board\\start-board.mjs" --open'
  const done = page.newProjectDone({ url: 'http://127.0.0.1:4313/', project: 'D:\\Work\\Garden', lines: ['Made D:\\Work\\Garden, a git repository.', warning], warnings: [warning] })
  assert.deepEqual([done.text, done.link], ['Made D:\\Work\\Garden. Its board: ', 'http://127.0.0.1:4313/'])
  // Review: what went wrong on the way stands under it (an icon not made, a board that did not start).
  assert.deepEqual([...done.warnings], [warning])
  assert.deepEqual([...page.newProjectDone({ url: 'u', project: 'p', lines: ['The board runs: u'] }).warnings], [])
})
