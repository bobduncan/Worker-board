// Leaked headless browsers (2026-11-13): the rule `browsers` finds, from one listing of the PC's processes, every headless
// Edge main process whose starter is gone and that runs over ten minutes, and the board closes it and removes its temp
// profile. The real case: a worker's scratch CDP helper on a fixed port left an Edge from 07:42 rendering the game on 13
// of 24 cores. Made-up listings; the kill and the remove are fakes.

import assert from 'node:assert/strict'
import test from 'node:test'

import { LEAKED_AFTER_MS, closeLeaked, fileTimeMs, isHeadlessMain, isInTemp, leakedBrowsers, leakedWords, prefixOf, profileOf, tempRootOf } from '../../src/supervisor/browsers.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 13, 21, 0).getTime()
const FILETIME = ms => (ms + 11_644_473_600_000) * 10_000
const TEMP = 'C:\\Users\\p\\AppData\\Local\\Temp'
const proc = (pid, parent, name, minutesAgo, more = {}) => ({ pid, parent, name, priority: 8, threads: 20, created: FILETIME(NOW - minutesAgo * MIN), commandLine: null, ...more })
const cdp = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --headless=new --use-angle=swiftshader --remote-debugging-port=9391 --user-data-dir=${TEMP}\\edge-cdp-b1126-k3Xp9q http://127.0.0.1:5173/`
const options = { now: NOW, temp: TEMP, platform: 'win32' }

test('a headless or remote-driven Edge main process is one; the person\'s own Edge and Edge\'s children are not', () => {
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: cdp })), true)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: 'msedge.exe --remote-debugging-port=0 --disable-gpu --user-data-dir=C:\\t\\board-evidence-Ab12Cd' })), true)
  assert.equal(isHeadlessMain(proc(5, 1, 'MSEDGE.EXE', 1, { commandLine: 'msedge.exe --headless --user-data-dir=C:\\t\\lava-shot-4321-Xy12ab' })), true)
  // The person's Edge: neither flag. A child of a headless Edge: --type=. Another program with the flags: no.
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: 'msedge.exe --profile-directory=Default --flag-switches-begin' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: 'msedge.exe --type=gpu-process --headless=new' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'chrome.exe', 1, { commandLine: 'chrome.exe --headless' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1)), false)
})

test('the profile and its prefix: the tool\'s own name up to the first number or random tail', () => {
  assert.equal(profileOf(cdp), `${TEMP}\\edge-cdp-b1126-k3Xp9q`)
  assert.equal(profileOf('msedge.exe "--user-data-dir=C:\\My Temp\\lava-shot-4321-Xy12ab" --headless'), 'C:\\My Temp\\lava-shot-4321-Xy12ab')
  assert.equal(profileOf('msedge.exe --headless'), null)
  assert.equal(prefixOf(`${TEMP}\\edge-cdp-b1126-k3Xp9q`), 'edge-cdp-b1126')
  assert.equal(prefixOf('C:\\t\\board-evidence-Ab12Cd'), 'board-evidence')
  assert.equal(prefixOf('C:\\t\\lava-shot-4321-Xy12ab\\'), 'lava-shot')
  assert.equal(prefixOf('/tmp/lava-shot-4321-Xy12ab'), 'lava-shot')
  assert.equal(prefixOf('C:\\t\\scoped_dir1234'), 'scoped_dir1234')
  assert.equal(prefixOf('C:\\t\\board-evidence-AbCdEf'), 'board-evidence', 'a random tail of letters alone, by its mixed case')
  assert.equal(prefixOf('C:\\t\\board-evidence-GYJKCI'), 'board-evidence', 'the real tail of 2026-11-13 21:10, capitals alone')
  assert.equal(prefixOf('C:\\t\\game-shots-weekly-Ab12Cd'), 'game-shots-weekly', 'a word is no tail')
  assert.equal(prefixOf(null), 'no profile')
  // The temp folder: inside it, whatever the case; the folder itself, or one beside it, is not.
  assert.equal(isInTemp(`${TEMP}\\edge-cdp-b1126-k3Xp9q`, TEMP, 'win32'), true)
  assert.equal(isInTemp(`${TEMP.toLowerCase()}\\x`, TEMP, 'win32'), true)
  assert.equal(isInTemp(TEMP, TEMP, 'win32'), false)
  assert.equal(isInTemp('C:\\Users\\p\\AppData\\Local\\Temporary\\x', TEMP, 'win32'), false)
  assert.equal(isInTemp(null, TEMP, 'win32'), false)
  // The folder the board removes: the tool's own in the temp folder (the evidence tool's profile stands IN its folder), spelt as given.
  assert.equal(tempRootOf(`${TEMP}\\edge-cdp-b1126-k3Xp9q`, TEMP, 'win32'), `${TEMP}\\edge-cdp-b1126-k3Xp9q`)
  assert.equal(tempRootOf(`${TEMP}\\board-evidence-f9NyC5\\profile`, TEMP, 'win32'), `${TEMP}\\board-evidence-f9NyC5`)
  assert.equal(tempRootOf('D:\\keep\\lava-shot-77-Qq12ab', TEMP, 'win32'), null)
  assert.equal(tempRootOf(TEMP, TEMP, 'win32'), null)
  assert.equal(fileTimeMs(FILETIME(NOW)), NOW)
  assert.equal(fileTimeMs(null), null)
})

test('leaked: a headless main process with over one thread, over ten minutes old, whose starter is gone; its tree and its profile go with it', () => {
  const started = NOW - 800 * MIN
  const list = [
    proc(499, 1, 'node.exe', 900, { commandLine: 'node logs/b1126-cdp.mjs' }),
    // The leaked one: its parent 7000 is gone (not listed). Its children by --type=, one of them with a reused parent number too old to be its child.
    proc(500, 7000, 'msedge.exe', 800, { commandLine: cdp }),
    proc(501, 500, 'msedge.exe', 799, { threads: 12, commandLine: 'msedge.exe --type=gpu-process' }),
    proc(502, 501, 'msedge.exe', 798, { threads: 5, commandLine: 'msedge.exe --type=renderer' }),
    proc(503, 500, 'msedge.exe', 900, { threads: 5, commandLine: 'msedge.exe --type=utility' }),
    // A board-evidence Edge whose starter (499) still runs: nothing, however old.
    proc(600, 499, 'msedge.exe', 30, { commandLine: `msedge.exe --headless=new --remote-debugging-port=0 --disable-gpu --user-data-dir="${TEMP}\\board-evidence-Ab12Cd\\profile"` }),
    // The person's own Edge, parent gone: never.
    proc(700, 7001, 'msedge.exe', 800, { commandLine: 'msedge.exe --profile-directory=Default' }),
    // A 1-thread zombie of a killed headless Edge: not alive.
    proc(800, 7002, 'msedge.exe', 800, { threads: 1, commandLine: cdp }),
    // Starter gone, but started 9 minutes ago: not yet.
    proc(900, 7003, 'msedge.exe', 9, { commandLine: 'msedge.exe --headless --user-data-dir=C:\\t\\lava-shot-4321-Xy12ab' }),
    // Starter "alive" by number only: the parent listed was created AFTER the child (the number given out again): gone.
    proc(1000, 1001, 'msedge.exe', 60, { commandLine: 'msedge.exe --headless --user-data-dir=D:\\keep\\lava-shot-77-Qq12ab' }),
    proc(1001, 1, 'cmd.exe', 10),
  ]
  const found = leakedBrowsers(list, options)
  assert.deepEqual(found, [
    { pid: 500, profile: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, folder: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, prefix: 'edge-cdp-b1126', startedAt: started, children: [501, 502] },
    { pid: 1000, profile: 'D:\\keep\\lava-shot-77-Qq12ab', folder: null, prefix: 'lava-shot', startedAt: NOW - 60 * MIN, children: [] },
  ])
  // The mutants: counted at 10 minutes (not 9); a zombie counted alive; a starter that runs read as gone.
  assert.equal(LEAKED_AFTER_MS, 10 * MIN)
  assert.deepEqual(leakedBrowsers(list, { ...options, now: NOW + MIN }).map(one => one.pid), [500, 900, 1000])
  assert.deepEqual(leakedBrowsers(list.map(one => (one.pid === 800 ? { ...one, threads: 2 } : one)), options).map(one => one.pid), [500, 800, 1000])
  const evidence = leakedBrowsers(list.filter(one => one.pid !== 499), options)
  assert.deepEqual(evidence.map(one => one.pid), [500, 600, 1000])
  // The real case of 2026-11-13 21:09: the evidence tool's Edge, its profile `board-evidence-<tail>\\profile`: the prefix and the folder are the tool's.
  assert.deepEqual([evidence[1].prefix, evidence[1].folder], ['board-evidence', `${TEMP}\\board-evidence-Ab12Cd`])
  // A listing without threads (an older board's script) counts nothing alive: nothing is closed on a guess.
  assert.deepEqual(leakedBrowsers(list.map(one => ({ ...one, threads: null })), options), [])
  assert.equal(leakedWords(found[0], NOW), 'edge-cdp-b1126: a headless Edge (process 500, started 07:40, 13 h 20) with its starter gone')
  assert.equal(leakedWords(found[1], NOW), 'lava-shot: a headless Edge (process 1000, started 20:00, 1 h 00) with its starter gone')
  assert.equal(leakedWords({ ...found[1], startedAt: NOW - 11 * MIN }, NOW), 'lava-shot: a headless Edge (process 1000, started 20:49, 11 min) with its starter gone')
})

test('closing: the tree is killed, then the profile removed only inside the temp folder; a failed kill is not ok, a failed remove is said', async () => {
  const calls = []
  const kill = async pids => { calls.push(['kill', pids]); return { ok: true, why: null } }
  const remove = async profile => { calls.push(['remove', profile]); return { ok: true, why: null } }
  const one = { pid: 500, children: [501, 502], profile: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, folder: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, prefix: 'edge-cdp-b1126', startedAt: NOW }
  assert.deepEqual(await closeLeaked(one, { kill, remove }), { ok: true, why: null, profile: 'removed' })
  assert.deepEqual(calls, [['kill', [500, 501, 502]], ['remove', `${TEMP}\\edge-cdp-b1126-k3Xp9q`]])
  calls.length = 0
  assert.deepEqual(await closeLeaked({ ...one, folder: null }, { kill, remove }), { ok: true, why: null, profile: 'kept (not in the temp folder)' })
  // The evidence tool's folder, not the profile in it, is what goes.
  assert.deepEqual(await closeLeaked({ ...one, profile: `${TEMP}\\board-evidence-f9NyC5\\profile`, folder: `${TEMP}\\board-evidence-f9NyC5` }, { kill, remove }), { ok: true, why: null, profile: 'removed' })
  assert.deepEqual(calls.at(-1), ['remove', `${TEMP}\\board-evidence-f9NyC5`])
  calls.length = 0
  assert.deepEqual(await closeLeaked({ ...one, profile: null }, { kill, remove }), { ok: true, why: null, profile: 'none' })
  assert.deepEqual(calls, [['kill', [500, 501, 502]]], 'nothing removed')
  assert.deepEqual(await closeLeaked(one, { kill: async () => ({ ok: false, why: 'access denied' }), remove }), { ok: false, why: 'access denied', profile: null })
  assert.deepEqual(await closeLeaked(one, { kill, remove: async () => ({ ok: false, why: 'EBUSY' }) }), { ok: true, why: null, profile: 'left (EBUSY)' })
})
