// 2026-11-04 (the person, in the lead's chat: "Yes, write them"): the board's setup may write the landing rules of a new project: an
// allow rule for the board's landing script in the project's own settings, and the autoMode lines of the person's Claude settings
// that tell Claude Code's auto mode the board is a local development tool (it reads autoMode from user settings only, and else
// refuses a landing as a "production deploy"). Every test uses a temporary home folder and a temporary project: the real
// ~/.claude and this PC's project settings are never touched, and a test that would fails (the guard at the end).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

import { FORCE_PUSH_DENY } from '../src/codeJobs.mjs'
import { addAutoMode, autoModeLines, describeSetup, landAllowRules, setupLanding, withAutoMode } from '../src/landingSetup.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = mkdtempSync(join(tmpdir(), 'landing-setup-test-'))
// What a test writes carries this name; the guard at the end looks for it in the real files.
const TOKEN = `landing-setup-test-${createHash('sha1').update(scratch).digest('hex').slice(0, 10)}`
const REAL = [join(homedir(), '.claude', 'settings.json'), resolve(ROOT, '..', '.claude', 'settings.local.json')]
let counter = 0

after(() => {
  rmSync(scratch, { recursive: true, force: true })
  for (const file of REAL) {
    if (existsSync(file)) assert.ok(!readFileSync(file, 'utf8').includes(TOKEN), `${file} (the person's real settings) holds a line a test wrote: a test touched it`)
  }
})

/** A temporary home and project, never the real ones (a guard refuses anything else). */
function made() {
  const dir = join(scratch, `${TOKEN}-${++counter}`)
  const home = join(dir, 'home')
  const project = join(dir, TOKEN)
  const board = join(project, 'worker-board')
  mkdirSync(home, { recursive: true })
  mkdirSync(board, { recursive: true })
  for (const path of [home, project]) {
    assert.ok(resolve(path).startsWith(resolve(tmpdir())), 'a test works in the temporary folder only')
    assert.notEqual(resolve(path), resolve(homedir()))
  }
  return { home, project, board, settings: join(home, '.claude', 'settings.json'), local: join(project, '.claude', 'settings.local.json') }
}
const write = (file, value) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
}
const read = file => JSON.parse(readFileSync(file, 'utf8'))
const backups = world => (existsSync(dirname(world.settings)) ? readdirSync(dirname(world.settings)).filter(name => name.startsWith('settings.json.bak-')) : [])
const NOW = new Date(2026, 10, 4, 23, 30, 15)
const flow = (world, extra = {}) => setupLanding({ answer: 'y', isTty: true, project: world.project, board: world.board, port: 4321, home: world.home, now: NOW, ...extra })

test('the allow rules for the landing script name the new project\'s board folder with forward slashes, for the Bash and the PowerShell tool', () => {
  assert.deepEqual(landAllowRules('D:\\Work\\Garden\\worker-board'), [
    'Bash(powershell -NoProfile -ExecutionPolicy Bypass -File "D:/Work/Garden/worker-board/tools/land.ps1" *)',
    'PowerShell(powershell -NoProfile -ExecutionPolicy Bypass -File "D:/Work/Garden/worker-board/tools/land.ps1" *)',
  ])
})

test('the autoMode lines say the board is a local development tool on this PC, with the project, the board folder, the ports and the trial copy when there is one', () => {
  const lines = autoModeLines({ project: 'D:\\Work\\Garden', board: 'D:\\Work\\Garden\\worker-board', port: 4321 })
  assert.equal(lines.environment.length, 1)
  assert.equal(lines.allow.length, 2)
  assert.equal(lines.environment[0], 'D:\\Work\\Garden is the user\'s personal hobby project. Its worker board (a Node server on 127.0.0.1:4321 in D:\\Work\\Garden\\worker-board) is a local development tool on this PC, not a production system. Its git remote is the user\'s own repository; pushing its main branch after the tests pass is the normal way board work lands.')
  assert.equal(lines.allow[0], 'Putting a worker-board change live with the board\'s landing script land.ps1 (fast-forward a tested branch into worker-board main, push main to the user\'s own repository, restart the local boards on 127.0.0.1:4321) is routine local development, not a production deploy.')
  assert.equal(lines.allow[1], 'Restarting the local worker board (node server.mjs or node start-board.mjs in D:\\Work\\Garden\\worker-board, or POST /api/restart on 127.0.0.1:4321) is allowed.')
  const withTrial = autoModeLines({ project: 'D:\\Work\\Garden', board: 'D:\\Work\\Garden\\worker-board', port: 4321, trial: { dir: 'D:\\Work\\trial\\worker-board', port: 4324 } })
  assert.ok(withTrial.environment[0].includes('127.0.0.1:4321 in D:\\Work\\Garden\\worker-board, and a trial copy in D:\\Work\\trial\\worker-board on 127.0.0.1:4324)'))
  assert.ok(withTrial.allow[0].includes('push main to the user\'s own repository, update the trial copy, restart the local boards on 127.0.0.1:4321 and 4324)'))
  assert.ok(withTrial.allow[1].includes('in D:\\Work\\Garden\\worker-board or D:\\Work\\trial\\worker-board, or POST /api/restart on 127.0.0.1:4321 or 4324)'))
  // A port not known yet (a check before the project is made) is said as such.
  assert.ok(autoModeLines({ project: 'p', board: 'b' }).environment[0].includes('127.0.0.1:<its port>'))
})

test('y: the project gets the landing allow rules, the Claude settings get the autoMode lines once after "$defaults", every other key stays, and a backup is written first', async () => {
  const world = made()
  const user = {
    permissions: { allow: ['Read(*)'] }, hooks: { Stop: [{ hooks: [] }] }, enabledPlugins: { 'a@b': true }, outputStyle: 'x',
    autoMode: { environment: ['$defaults', 'My own line about my own project.'], allow: ['$defaults', 'My own allow line.'], soft_deny: ['$defaults'] },
  }
  write(world.settings, user)
  const before = readFileSync(world.settings)
  write(world.local, { permissions: { allow: ['mcp__x'], deny: ['D'] } })
  const done = await flow(world)
  assert.equal(done.wrote, true)
  const lines = autoModeLines({ project: world.project, board: world.board, port: 4321 })
  const settings = read(world.settings)
  assert.deepEqual(settings.autoMode.environment, ['$defaults', 'My own line about my own project.', ...lines.environment])
  assert.deepEqual(settings.autoMode.allow, ['$defaults', 'My own allow line.', ...lines.allow])
  assert.deepEqual(settings.autoMode.soft_deny, ['$defaults'], 'another autoMode key is kept')
  for (const key of ['permissions', 'hooks', 'enabledPlugins', 'outputStyle']) assert.deepEqual(settings[key], user[key], `${key} is kept`)
  assert.deepEqual(Object.keys(settings), Object.keys(user), 'the keys keep their order')
  // The backup holds the old file as it was, and the answer says where it is.
  assert.deepEqual(backups(world), ['settings.json.bak-20261104-233015'])
  assert.deepEqual(readFileSync(join(dirname(world.settings), backups(world)[0])), before)
  assert.equal(done.auto.backup, join(dirname(world.settings), 'settings.json.bak-20261104-233015'))
  // The project's settings: the landing rules added to what it had.
  assert.deepEqual(read(world.local), { permissions: { allow: ['mcp__x', ...landAllowRules(world.board)], deny: ['D'] } })
})

test('a rerun adds nothing: no line twice, no second backup, the files stay byte for byte', async () => {
  const world = made()
  write(world.settings, { autoMode: { environment: ['$defaults'], allow: ['$defaults'] } })
  await flow(world)
  const afterFirst = [readFileSync(world.settings), readFileSync(world.local)]
  const again = await flow(world, { now: new Date(NOW.getTime() + 60_000) })
  assert.equal(again.wrote, true)
  assert.deepEqual(again.auto.added, { environment: [], allow: [] })
  assert.equal(again.auto.backup, null)
  assert.deepEqual(again.allowed.added, [])
  assert.deepEqual([readFileSync(world.settings), readFileSync(world.local)], afterFirst)
  assert.equal(backups(world).length, 1)
  const lines = autoModeLines({ project: world.project, board: world.board, port: 4321 })
  assert.equal(read(world.settings).autoMode.allow.filter(line => line === lines.allow[0]).length, 1)
})

test('"$defaults" comes first where a list had none or none was there; where it stands already it stays where it is', async () => {
  const none = made()
  await flow(none)
  assert.equal(readdirSync(dirname(none.settings)).length, 1, 'no settings file before: nothing to back up, the file is made')
  assert.deepEqual(read(none.settings).autoMode.environment[0], '$defaults')
  assert.deepEqual(read(none.settings).autoMode.allow[0], '$defaults')
  assert.equal(read(none.settings).autoMode.allow.length, 3)
  const partial = made()
  write(partial.settings, { autoMode: { environment: ['Their line first.'], allow: ['Their allow.', '$defaults'] } })
  await flow(partial)
  const settings = read(partial.settings)
  assert.deepEqual(settings.autoMode.environment.slice(0, 2), ['$defaults', 'Their line first.'])
  assert.deepEqual(settings.autoMode.allow.slice(0, 2), ['Their allow.', '$defaults'], 'not moved')
})

test('an existing line is never changed or removed: a line like ours that the person edited stays, ours is added beside it', async () => {
  const world = made()
  const lines = autoModeLines({ project: world.project, board: world.board, port: 4321 })
  const edited = `${lines.environment[0]} (the person's own addition)`
  write(world.settings, { autoMode: { environment: ['$defaults', edited], allow: ['$defaults', lines.allow[1]] } })
  await flow(world)
  const settings = read(world.settings)
  assert.deepEqual(settings.autoMode.environment, ['$defaults', edited, lines.environment[0]])
  assert.deepEqual(settings.autoMode.allow, ['$defaults', lines.allow[1], lines.allow[0]], 'the restart line was there: only the landing line is new')
})

test('n: nothing is written, not the project\'s settings and not the Claude settings', async () => {
  const world = made()
  const done = await flow(world, { answer: 'n' })
  assert.equal(done.wrote, false)
  assert.equal(existsSync(join(world.home, '.claude')), false)
  assert.equal(existsSync(join(world.project, '.claude')), false)
  for (const answer of ['', 'no', 'later']) assert.equal((await flow(world, { answer })).wrote, false)
  assert.deepEqual(readdirSync(world.home), [])
})

test('no keyboard and no --allow-landing: nothing is written even when the question\'s default is y; with the flag it is', async () => {
  const world = made()
  const silent = await flow(world, { answer: 'y', isTty: false, flag: undefined })
  assert.equal(silent.wrote, false)
  assert.equal(existsSync(join(world.home, '.claude')), false)
  assert.equal(existsSync(join(world.project, '.claude')), false)
  const flagged = await flow(world, { answer: 'yes', isTty: false, flag: 'yes' })
  assert.equal(flagged.wrote, true)
  assert.equal(existsSync(world.settings), true)
})

test('--check says what each part would add and writes nothing: no file made, no file changed, no backup', async () => {
  const world = made()
  const empty = await flow(world, { check: true })
  assert.equal(empty.wrote, false)
  assert.equal(existsSync(join(world.home, '.claude')), false)
  assert.equal(existsSync(join(world.project, '.claude')), false)
  const text = empty.lines.join('\n')
  assert.match(text, /settings\.local\.json/)
  assert.match(text, new RegExp(`${FORCE_PUSH_DENY.length} deny rules`))
  assert.match(text, /2 allow rules for the landing script/)
  assert.match(text, /autoMode\.environment: 1 line/)
  assert.match(text, /autoMode\.allow: 2 lines/)
  assert.match(text, /"\$defaults" first in both/)
  // With files there: what is added now, what is already there; the files are as they were.
  write(world.settings, { autoMode: { environment: ['$defaults'], allow: ['$defaults'] } })
  await flow(world)
  const bytes = [readFileSync(world.settings), readFileSync(world.local)]
  const files = readdirSync(dirname(world.settings))
  const done = await flow(world, { check: true })
  assert.match(done.lines.join('\n'), /autoMode\.environment: nothing to add/)
  assert.match(done.lines.join('\n'), /nothing to add/)
  assert.deepEqual([readFileSync(world.settings), readFileSync(world.local)], bytes)
  assert.deepEqual(readdirSync(dirname(world.settings)), files)
})

test('a Claude settings file that is no JSON is left alone, with the reason; the home folder must be given', async () => {
  const world = made()
  write(world.settings, '{ "autoMode": torn')
  const done = await flow(world)
  assert.equal(done.auto.ok, false)
  assert.match(done.auto.why, /settings\.json is no JSON/)
  assert.equal(readFileSync(world.settings, 'utf8'), '{ "autoMode": torn')
  assert.equal(backups(world).length, 0)
  await assert.rejects(addAutoMode({ lines: autoModeLines({ project: 'p', board: 'b' }) }), /home/)
  assert.equal(withAutoMode('[1]', autoModeLines({ project: 'p', board: 'b' })).ok, false)
})

test('describeSetup reads the files and writes none', async () => {
  const world = made()
  const lines = await describeSetup({ project: world.project, board: world.board, home: world.home, codeTools: ['mcp__a', 'mcp__b'] })
  assert.match(lines.join('\n'), /2 allow rules for the board's routine jobs/)
  assert.equal(existsSync(join(world.home, '.claude')), false)
})

test('npm run new asks the landing question of its own, takes --allow-landing and --check, and passes the home folder only from here', () => {
  const flowText = readFileSync(join(ROOT, 'tools', 'new-project.mjs'), 'utf8')
  assert.match(flowText, /May the board\\?'s chats put board changes live with tools\/land\.ps1 by themselves\?/)
  assert.match(flowText, /given\('allow-landing'\)/)
  assert.match(flowText, /args\.includes\('--check'\)/)
  assert.equal((flowText.match(/setupLanding\(/g) ?? []).length, 1)
  assert.match(flowText, /home: homedir\(\)/)
  assert.ok(!/addAutoMode|writeFile|settings\.json/.test(flowText), 'the flow writes nothing itself: src/landingSetup.mjs does, and takes its home as given')
})
