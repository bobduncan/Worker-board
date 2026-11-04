// B947: the shell hook's guard refuses removing a folder that is a link or holds one. The guard is the project's own
// (`<project>/.claude/hooks/guard-removal.mjs`, outside the board's repository); the board's tests run it when it is
// there. A real junction in a temporary folder; the real case is Worker 5's command of 2026-11-02 16:37:29 on B920.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'hooks')
const GUARD = join(HOOKS, 'guard-removal.mjs')
const present = existsSync(GUARD)
const { removalGuard, removalRefusal } = present ? await import(pathToFileURL(GUARD).href) : {}
const options = { skip: present ? false : 'the project has no .claude/hooks/guard-removal.mjs' }

/** `<tmp>/lava-tactics` (a checkout), `<tmp>/lava-tactics-b920` (a task folder with the junction), `<tmp>/plain` (no link). */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'b947-guard-'))
  const packages = join(root, 'packages')
  mkdirSync(packages)
  writeFileSync(join(packages, 'a.js'), 'a')
  mkdirSync(join(root, 'lava-tactics'))
  const folder = join(root, 'lava-tactics-b920')
  mkdirSync(folder)
  writeFileSync(join(folder, 'own.txt'), 'own')
  symlinkSync(packages, join(folder, 'node_modules'), 'junction')
  const plain = join(root, 'plain')
  mkdirSync(plain)
  writeFileSync(join(plain, 'own.txt'), 'own')
  return { root, cwd: join(root, 'lava-tactics'), folder, plain, junction: join(folder, 'node_modules') }
}
const unix = path => path.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/')
const call = (command, cwd, tool = 'Bash') => ({ tool_name: tool, tool_input: { command }, cwd })

test('the real case: Worker 5\'s command on a folder with the junction is refused, naming the link and the tool', options, () => {
  const { root, cwd, folder, junction } = fixture()
  try {
    const why = removalGuard(call('git merge --ff-only b920 && git push; git worktree remove ../lava-tactics-b920', cwd))
    assert.match(why, /^Refused: /)
    assert.ok(why.includes(junction), why)
    assert.match(why, /remove-task-folder\.mjs/)
    assert.ok(why.includes(`cmd /c rmdir "${junction}"`), why)
    assert.ok(why.includes(folder))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the same folder once the junction is taken away (rmdir of the link alone) passes', options, () => {
  const { root, cwd, folder, junction } = fixture()
  try {
    assert.equal(removalGuard(call(`cmd /c rmdir "${junction}"`, cwd)), null, 'rmdir of the link itself is no recursive removal')
    rmSync(junction, { recursive: false })
    assert.equal(removalGuard(call('git worktree remove ../lava-tactics-b920', cwd)), null)
    assert.equal(removalGuard(call(`rm -rf "${unix(folder)}"`, cwd)), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a task folder without links passes: git worktree remove, rm -rf, rmdir /s', options, () => {
  const { root, cwd, plain } = fixture()
  try {
    assert.equal(removalGuard(call('git worktree remove ../plain', cwd)), null)
    assert.equal(removalGuard(call('git -C ../lava-tactics worktree remove --force ../plain', cwd)), null)
    assert.equal(removalGuard(call(`rm -rf ${unix(plain)}`, cwd)), null)
    assert.equal(removalGuard(call(`rmdir /s /q "${plain}"`, cwd, 'PowerShell')), null)
    assert.equal(removalGuard(call(`Remove-Item -Recurse -Force "${plain}"`, cwd, 'PowerShell')), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rm -rf, rmdir /s, rd /s and Remove-Item -Recurse on the folder that holds the junction are refused', options, () => {
  const { root, cwd, folder } = fixture()
  try {
    for (const command of [`rm -rf "${unix(folder)}"`, `rm -r ${unix(folder)}`, `rm -fr ../lava-tactics-b920`, `rmdir /s /q "${folder}"`, `rd /s /q "${folder}"`, `cmd /c rmdir /s /q "${folder}"`, `Remove-Item -Recurse -Force -Path "${folder}"`, `Remove-Item "${folder}" -Recurse`, `ri -r "${folder}"`, `Remove-Item -LiteralPath "${folder}" -rec`]) {
      for (const tool of ['Bash', 'PowerShell']) assert.match(removalGuard(call(command, cwd, tool)) ?? '', /^Refused: /, command)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Remove-Item -Recurse on the junction itself is refused (PowerShell 5.1 follows it)', options, () => {
  const { root, cwd, junction } = fixture()
  try {
    const why = removalGuard(call(`Remove-Item -Recurse -Force "${junction}"`, cwd, 'PowerShell'))
    assert.match(why, /is a link/)
    assert.match(why, /cmd \/c rmdir/)
    assert.match(removalGuard(call(`rm -rf ${unix(junction)}`, cwd)) ?? '', /is a link/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every command of a chain is read, with an earlier cd and a wrapper', options, () => {
  const { root, cwd, folder } = fixture()
  try {
    assert.match(removalGuard(call(`echo done; git status && rm -rf "${unix(folder)}"`, cwd)) ?? '', /^Refused/)
    assert.match(removalGuard(call(`true || false | rm -rf "${unix(folder)}"`, cwd)) ?? '', /^Refused/)
    assert.match(removalGuard(call(`cd ${unix(dirname(folder))} && rm -rf lava-tactics-b920`, cwd)) ?? '', /^Refused/)
    assert.match(removalGuard(call(`cd "${dirname(folder)}"; git worktree remove lava-tactics-b920`, cwd)) ?? '', /^Refused/)
    assert.match(removalGuard(call(`bash -c "rm -rf ${unix(folder)}"`, cwd, 'PowerShell')) ?? '', /^Refused/)
    assert.match(removalGuard(call(`powershell -Command "Remove-Item -Recurse '${folder}'"`, cwd)) ?? '', /^Refused/)
    assert.match(removalGuard(call(`git -C "${dirname(folder)}" worktree remove lava-tactics-b920`, cwd)) ?? '', /^Refused/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a target it cannot resolve passes: a variable, a glob, a folder that is not there; so does a command that is no removal', options, () => {
  const { root, cwd, folder } = fixture()
  try {
    for (const command of ['rm -rf $FOLDER', 'rm -rf ../lava-tactics-b*', 'Remove-Item -Recurse $env:TEMP\\x', 'rm -rf ../not-there', 'git worktree list', `ls "${unix(folder)}"`, `rm "${unix(folder)}/own.txt"`, `Remove-Item -Force "${folder}\\own.txt"`, 'echo rm -rf ../lava-tactics-b920 > /dev/null', `rmdir "${unix(folder)}"`]) {
      assert.equal(removalGuard(call(command, cwd)), null, command)
    }
    assert.equal(removalGuard(call('rm -rf ../lava-tactics-b920', undefined)), null, 'no cwd: a relative target cannot be resolved against it')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('input it cannot read lets the call pass, and the guard never throws', options, () => {
  for (const input of [null, undefined, {}, { tool_name: 'Bash' }, { tool_name: 'Bash', tool_input: { command: 42 } }, { tool_name: 'Edit', tool_input: { command: 'rm -rf x' } }, 'text']) {
    assert.equal(removalGuard(input), null)
  }
})

test('the hook script refuses the real case with exit 2 and one line (and passes a plain command)', options, () => {
  const { root, cwd } = fixture()
  try {
    const run = command => spawnSync('node', [join(HOOKS, 'guard-dev-servers.mjs')], { input: JSON.stringify(call(command, cwd)), encoding: 'utf8' })
    const refused = run('git worktree remove ../lava-tactics-b920')
    assert.equal(refused.status, 2)
    assert.match(refused.stderr.trim(), /^Refused: .*holds the link/)
    assert.equal(refused.stderr.trim().split('\n').length, 1)
    assert.equal(run('git status').status, 0)
    assert.equal(run('git worktree remove ../plain').status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('removalRefusal answers null for an empty command', options, () => {
  assert.equal(removalRefusal(''), null)
})
