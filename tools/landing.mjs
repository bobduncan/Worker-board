// 2026-11-04: the small program tools/land.ps1 calls where PowerShell would be fragile (src/landing.mjs holds the logic).
// Each command prints one line of ASCII JSON; its exit code is the verdict: 0 ok, 1 not ok, 2 a wrong call.
//
//   node tools/landing.mjs gate-check --kind board|mod --file <gate log> [--exit <code>]
//   node tools/landing.mjs lock-take --file <lock> --by <chat> --branch <branch> --pid <pid> [--stale-minutes 15]
//   node tools/landing.mjs lock-release --file <lock> --pid <pid> --at <the time lock-take gave>
//   node tools/landing.mjs inspect --boards <json> --processes <json> --connections <json>
//   node tools/landing.mjs log-line --file <data/landings.jsonl> --fields <json>
//
// A json file may start with a byte-order mark (Windows PowerShell writes one) and may hold one object where a list is meant,
// or nothing at all (PowerShell's pipeline of nothing).

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STALE_LOCK_MS, asciiJson, gatePassed, inspectorDecision, landingLine, releaseLock, takeLock } from '../src/landing.mjs'

const MIN = 60_000

/** The `--name value` pairs of the arguments. */
function options(args) {
  const found = {}
  for (let at = 0; at < args.length; at += 2) {
    if (!args[at].startsWith('--') || at + 1 >= args.length) throw new Error(`a wrong call: ${args[at]} needs a value`)
    found[args[at].slice(2)] = args[at + 1]
  }
  return found
}

const need = (found, name) => {
  if (found[name] === undefined) throw new Error(`a wrong call: --${name} is missing`)
  return found[name]
}

/** A text file's words without the byte-order mark; '' for a file that is not there. */
function readText(file) {
  try {
    return readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  } catch {
    return ''
  }
}

/** A json file as a list: a list stays, one object is a list of one, nothing is an empty list. */
function readList(file) {
  const text = readText(file).trim()
  if (text === '') return []
  const read = JSON.parse(text)
  return Array.isArray(read) ? read : read === null ? [] : [read]
}

const say = value => process.stdout.write(`${asciiJson(value)}\n`)

/** Runs one command; the number is the exit code. */
export function command(name, args) {
  const given = options(args)
  if (name === 'gate-check') {
    const kind = given.kind === 'mod' ? 'mod' : 'board'
    const exit = given.exit === undefined ? undefined : Number(given.exit)
    const result = gatePassed(readText(need(given, 'file')), kind, exit)
    say(result)
    return result.ok ? 0 : 1
  }
  if (name === 'lock-take') {
    const staleMs = given['stale-minutes'] === undefined ? STALE_LOCK_MS : Number(given['stale-minutes']) * MIN
    const by = need(given, 'by')
    const branch = need(given, 'branch')
    const pid = Number(need(given, 'pid'))
    const took = takeLock(need(given, 'file'), { by, branch, pid, staleMs })
    say(took.ok ? { ok: true, by, branch, pid, at: took.token.at, broke: took.broke } : { ok: false, why: took.why })
    return took.ok ? 0 : 1
  }
  if (name === 'lock-release') {
    const released = releaseLock(need(given, 'file'), { pid: Number(need(given, 'pid')), at: need(given, 'at') })
    say({ released })
    return released ? 0 : 1
  }
  if (name === 'inspect') {
    const decision = inspectorDecision({ boards: readList(need(given, 'boards')), processes: readList(need(given, 'processes')), connections: readList(need(given, 'connections')) })
    say(decision)
    return decision.verdict === 'refuse' ? 1 : 0
  }
  if (name === 'log-line') {
    const file = need(given, 'file')
    const line = landingLine(JSON.parse(readText(need(given, 'fields'))))
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${line}\n`)
    process.stdout.write(`${line}\n`)
    return 0
  }
  throw new Error(`a wrong call: the command ${name} is not one of gate-check, lock-take, lock-release, inspect, log-line`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = command(process.argv[2] ?? '', process.argv.slice(3))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
  }
}
