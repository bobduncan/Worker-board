// S9 (the PC plan, the person's choice of 2026-11-25 21:2x): the light check with every go-live. land.ps1's gate leaves out the
// slowest test files (test/slow-files.json: every file over 60 s in the gates of 11-25, board-starting ones too), except a slow file
// whose area the change touches, by honest globs per file, or that a red big run put on probation. The big suite (tools/big-suite.mjs)
// runs every file when the PC is idle, at least every 4 hours and once each night.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** The list of slow test files with their globs, beside the tests. */
export const SLOW_FILES = 'test/slow-files.json'
/** A file on probation leaves it after this many green big runs in a row (chat 1, 2026-11-25: "until 2 green big runs in a row"). */
export const PROBATION_GREENS = 2

/**
 * A glob as a regular expression over a path with "/": `**` any folders (also none), `*` within one folder, `?` one character. PURE.
 */
export function globToRegExp(glob) {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      i += 1
      if (glob[i + 1] === '/') {
        i += 1
        out += '(?:.*/)?'
      } else out += '.*'
    } else if (char === '*') out += '[^/]*'
    else if (char === '?') out += '[^/]'
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`, 'i')
}

/** A path as git and the globs write it: "/" between folders, no "./" in front. PURE. */
export const asRepoPath = file => String(file).replace(/\\/g, '/').replace(/^\.\//, '')

/** The globs that guard a slow file: its own path, its globs, `@board` for the board's own (the list's `board`). PURE. */
export function guardsOf(spec, file) {
  const own = spec.files?.[file] ?? []
  return [file, ...own.flatMap(glob => (glob === '@board' ? spec.board ?? [] : [glob]))]
}

/**
 * Which slow files the light check still runs, each with why: `area` (the change touches one of its globs: the first path it
 * matched) or `probation` (a red big run put it there and it has not had its green runs since). `changed` is the change's files;
 * `null` when they could not be read, and then every slow file runs. PURE.
 */
export function slowFilesToRun({ spec, changed, probation = {} }) {
  const runs = []
  for (const file of Object.keys(spec.files ?? {})) {
    if (changed === null) {
      runs.push({ file, why: 'the change could not be read' })
      continue
    }
    const guards = guardsOf(spec, file).map(globToRegExp)
    const hit = changed.map(asRepoPath).find(one => guards.some(re => re.test(one)))
    if (hit !== undefined) runs.push({ file, why: `area: ${hit}` })
    else if (probation[file] !== undefined) runs.push({ file, why: 'probation' })
  }
  return runs
}

/**
 * The files of the light check: every test file but the slow ones that do not run (`all` the test files, as repository paths).
 * `{ files, runs, left }`: what runs, the slow files that run with why, the slow files left out. The slow files that run go first, in
 * the list's order (longest first: node --test starts files in the order given, so the long ones do not end the run alone). PURE.
 */
export function lightFiles({ all, spec, changed, probation = {} }) {
  const runs = slowFilesToRun({ spec, changed, probation })
  const slow = new Set(Object.keys(spec.files ?? {}))
  const running = new Set(runs.map(one => one.file))
  const left = [...slow].filter(file => !running.has(file)).sort()
  const first = runs.map(one => one.file).filter(file => all.includes(file))
  return { files: [...first, ...all.filter(file => !slow.has(file))], runs, left }
}

/** Every test file under `root`'s test folder (`*.test.mjs`), as repository paths, sorted. */
export function testFiles(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (entry.name.endsWith('.test.mjs')) found.push(rel)
    }
  }
  walk('test')
  return found.sort()
}

/** The list of slow files in `root` (test/slow-files.json); null when it cannot be read (then nothing is left out). */
export function readSlowFiles(root) {
  try {
    const spec = JSON.parse(readFileSync(path.join(root, SLOW_FILES), 'utf8'))
    return spec && typeof spec.files === 'object' ? spec : null
  } catch {
    return null
  }
}

/**
 * The files a light check's change touches: what the branch changed since it left main (`git diff --name-only <base>...HEAD`, the
 * base main's head, else origin/main). null when git cannot tell, and then every slow file runs. `git` runs git in `root`.
 */
export function changedFiles(git, bases = ['main', 'origin/main']) {
  for (const base of bases) {
    const out = git(['diff', '--name-only', `${base}...HEAD`])
    if (out !== null) return out.split('\n').map(line => line.trim()).filter(Boolean)
  }
  return null
}

/** The light check's lines for the log: how many files run, the slow files that run and why, how many the big suite keeps. PURE. */
export function lightLines({ all, picked }) {
  const lines = [`light check: ${picked.files.length} of ${all.length} test files; ${picked.left.length} slow file(s) left to the big suite`]
  for (const one of picked.runs) lines.push(`light check: runs ${one.file} (${one.why})`)
  return lines
}
