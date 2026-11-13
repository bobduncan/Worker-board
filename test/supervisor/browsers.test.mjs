// Leaked headless browsers (2026-11-13): the rule `browsers` finds, from one listing of the PC's processes, every headless
// Edge main process in the temp folder whose starter is gone and that ran over half an hour or over two cores for five
// minutes in a row, and the board closes it once and removes its temp folder. The real case: a worker's scratch CDP helper
// on a fixed port left an Edge from 07:42 rendering the game on 13 of 24 cores. Made-up listings shaped like the real
// one (ThreadCount, the command lines); the kill and the remove are fakes.

import assert from 'node:assert/strict'
import test from 'node:test'

import { BUSY_CORES, BUSY_MS, LEAKED_AFTER_MS, browserKey, browserMemory, closeLeaked, fileTimeMs, isBusy, isHeadlessMain, isInTemp, leakedWords, prefixOf, profileOf, tempRootOf, watchBrowsers } from '../../src/supervisor/browsers.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 13, 21, 0).getTime()
const FILETIME = ms => (ms + 11_644_473_600_000) * 10_000
const TEMP = 'C:\\Users\\p\\AppData\\Local\\Temp'
const proc = (pid, parent, name, minutesAgo, more = {}) => ({ pid, parent, name, priority: 8, threads: 20, cpuMs: 0, created: FILETIME(NOW - minutesAgo * MIN), commandLine: null, ...more })
const cdp = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --headless=new --use-angle=swiftshader --remote-debugging-port=9391 --user-data-dir=${TEMP}\\edge-cdp-b1126-k3Xp9q http://127.0.0.1:5173/`
const evidence = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check --user-data-dir="${TEMP}\\board-evidence-GYJKCI\\profile" --remote-debugging-port=0 --edge-skip-compat-layer-relaunch about:blank`
const options = { now: NOW, temp: TEMP, platform: 'win32' }
const watch = (list, memory = browserMemory(), more = {}) => watchBrowsers(list, memory, { ...options, ...more })

test('a headless or remote-driven Edge main process is one; the person\'s own Edge and Edge\'s children are not', () => {
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: cdp })), true)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: evidence })), true)
  assert.equal(isHeadlessMain(proc(5, 1, 'MSEDGE.EXE', 1, { commandLine: 'msedge.exe --headless --user-data-dir=C:\\t\\lava-shot-4321-Xy12ab' })), true)
  // The person's Edge: neither flag. A child of a headless Edge: --type=. Another program with the flags: no.
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: 'msedge.exe --profile-directory=Default --flag-switches-begin' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: 'msedge.exe --type=gpu-process --headless=new' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'chrome.exe', 1, { commandLine: 'chrome.exe --headless' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1)), false)
})

test('the profile, its prefix (the tool\'s own name up to the first number or random tail) and the tool\'s folder in the temp folder', () => {
  assert.equal(profileOf(cdp), `${TEMP}\\edge-cdp-b1126-k3Xp9q`)
  assert.equal(profileOf(evidence), `${TEMP}\\board-evidence-GYJKCI\\profile`)
  assert.equal(profileOf('msedge.exe "--user-data-dir=C:\\My Temp\\lava-shot-4321-Xy12ab" --headless'), 'C:\\My Temp\\lava-shot-4321-Xy12ab')
  assert.equal(profileOf('msedge.exe --headless'), null)
  assert.equal(prefixOf(`${TEMP}\\edge-cdp-b1126-k3Xp9q`), 'edge-cdp-b1126')
  assert.equal(prefixOf('C:\\t\\board-evidence-Ab12Cd'), 'board-evidence')
  assert.equal(prefixOf('C:\\t\\board-evidence-GYJKCI'), 'board-evidence', 'the real tail of 2026-11-13 21:10, capitals alone')
  assert.equal(prefixOf('C:\\t\\board-evidence-AbCdEf'), 'board-evidence', 'a random tail of letters alone, by its capitals')
  assert.equal(prefixOf('C:\\t\\game-shots-weekly-Ab12Cd'), 'game-shots-weekly', 'a word is no tail')
  assert.equal(prefixOf('C:\\t\\lava-shot-4321-Xy12ab\\'), 'lava-shot')
  assert.equal(prefixOf('/tmp/lava-shot-4321-Xy12ab'), 'lava-shot')
  assert.equal(prefixOf('C:\\t\\scoped_dir1234'), 'scoped_dir1234')
  assert.equal(prefixOf(null), 'no profile')
  // The temp folder: inside it, whatever the case; the folder itself, or one beside it, is not.
  assert.equal(isInTemp(`${TEMP}\\edge-cdp-b1126-k3Xp9q`, TEMP, 'win32'), true)
  assert.equal(isInTemp(`${TEMP.toLowerCase()}\\x`, TEMP, 'win32'), true)
  assert.equal(isInTemp(TEMP, TEMP, 'win32'), false)
  assert.equal(isInTemp('C:\\Users\\p\\AppData\\Local\\Temporary\\x', TEMP, 'win32'), false)
  assert.equal(isInTemp(null, TEMP, 'win32'), false)
  // The folder the board removes: the tool's own in the temp folder (the evidence tool's profile stands IN its folder), spelt as given.
  assert.equal(tempRootOf(`${TEMP}\\edge-cdp-b1126-k3Xp9q`, TEMP, 'win32'), `${TEMP}\\edge-cdp-b1126-k3Xp9q`)
  assert.equal(tempRootOf(`${TEMP}\\board-evidence-GYJKCI\\profile`, TEMP, 'win32'), `${TEMP}\\board-evidence-GYJKCI`)
  assert.equal(tempRootOf('D:\\keep\\lava-shot-77-Qq12ab', TEMP, 'win32'), null)
  assert.equal(tempRootOf(TEMP, TEMP, 'win32'), null)
  assert.equal(fileTimeMs(FILETIME(NOW)), NOW)
  assert.equal(fileTimeMs(null), null)
})

test('leaked: a headless main in the temp folder, over one thread, starter gone, over 30 min old; every exclusion on a listing shaped like the real one', () => {
  const started = NOW - 800 * MIN
  const list = [
    proc(499, 1, 'node.exe', 900, { commandLine: 'node logs/b1126-cdp.mjs' }),
    // The leaked one: its parent 7000 is gone (not listed). Its children by --type=, one of them with a reused parent number too old to be its child.
    proc(500, 7000, 'msedge.exe', 800, { commandLine: cdp, cpuMs: 800 * MIN * 12.8 }),
    proc(501, 500, 'msedge.exe', 799, { threads: 12, commandLine: 'msedge.exe --type=gpu-process' }),
    proc(502, 501, 'msedge.exe', 798, { threads: 5, commandLine: 'msedge.exe --type=renderer' }),
    proc(503, 500, 'msedge.exe', 900, { threads: 5, commandLine: 'msedge.exe --type=utility' }),
    // The evidence tool's Edge whose starter (499) still runs: nothing, however old.
    proc(600, 499, 'msedge.exe', 90, { commandLine: evidence }),
    // The person's own Edge, parent gone: never.
    proc(700, 7001, 'msedge.exe', 800, { commandLine: 'msedge.exe --profile-directory=Default' }),
    // A 1-thread zombie of a killed headless Edge: not alive.
    proc(800, 7002, 'msedge.exe', 800, { threads: 1, commandLine: cdp }),
    // Starter gone, but started 29 minutes ago and quiet: not yet.
    proc(900, 7003, 'msedge.exe', 29, { commandLine: `msedge.exe --headless --user-data-dir=${TEMP}\\lava-shot-4321-Xy12ab` }),
    // Starter "alive" by number only: the parent listed was created AFTER the child (the number given out again): gone.
    proc(1000, 1001, 'msedge.exe', 60, { commandLine: `msedge.exe --headless --user-data-dir=${TEMP}\\lava-shot-77-Qq12ab`, cpuMs: 60 * MIN * 0.3 }),
    proc(1001, 1, 'cmd.exe', 10),
    // Guard 1: a headless Edge with a profile OUTSIDE the temp folder (somebody's own), starter gone, however old: never touched.
    proc(1100, 7004, 'msedge.exe', 800, { commandLine: 'msedge.exe --headless=new --remote-debugging-port=9222 --user-data-dir=D:\\own\\profile' }),
    // Guard 1: a remote-driven Edge with a USER profile, starter gone: never touched.
    proc(1200, 7005, 'msedge.exe', 800, { commandLine: 'msedge.exe --remote-debugging-port=9222 --user-data-dir=C:\\Users\\p\\AppData\\Local\\Microsoft\\Edge\\User Data' }),
  ]
  const found = watch(list)
  assert.deepEqual(found, [
    { pid: 500, key: browserKey(list[1]), profile: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, folder: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, prefix: 'edge-cdp-b1126', startedAt: started, children: [501, 502], cores: 12.8, why: 'ran over 30 min', closedAt: null },
    { pid: 1000, key: browserKey(list[9]), profile: `${TEMP}\\lava-shot-77-Qq12ab`, folder: `${TEMP}\\lava-shot-77-Qq12ab`, prefix: 'lava-shot', startedAt: NOW - 60 * MIN, children: [], cores: 0.3, why: 'ran over 30 min', closedAt: null },
  ])
  // The mutants: counted at 30 minutes (not 29); a zombie counted alive; a starter that runs read as gone (then the evidence tool's Edge, by its folder).
  assert.equal(LEAKED_AFTER_MS, 30 * MIN)
  assert.deepEqual(watch(list, browserMemory(), { now: NOW + MIN }).map(one => one.pid), [500, 900, 1000])
  assert.deepEqual(watch(list.map(one => (one.pid === 800 ? { ...one, threads: 2 } : one))).map(one => one.pid), [500, 800, 1000])
  const orphaned = watch(list.filter(one => one.pid !== 499))
  assert.deepEqual(orphaned.map(one => one.pid), [500, 600, 1000])
  assert.deepEqual([orphaned[1].prefix, orphaned[1].folder], ['board-evidence', `${TEMP}\\board-evidence-GYJKCI`])
  // A listing without threads (an older board's script) counts nothing alive: nothing is closed on a guess.
  assert.deepEqual(watch(list.map(one => ({ ...one, threads: null }))), [])
  assert.equal(leakedWords(found[0], NOW), 'edge-cdp-b1126: a headless Edge (process 500, started 07:40, 13 h 20, 12.8 cores) with its starter gone, ran over 30 min')
  assert.equal(leakedWords({ ...found[1], cores: null }, NOW), 'lava-shot: a headless Edge (process 1000, started 20:00, 1 h 00, CPU unknown) with its starter gone, ran over 30 min')
})

test('guard 2: under 30 minutes, a browser is leaked once it used over 2 cores for 5 minutes in a row; the samples live in the loop\'s memory and go with the process', () => {
  assert.equal(BUSY_CORES, 2)
  assert.equal(BUSY_MS, 5 * MIN)
  const sample = (minutesAgo, cpuMs) => ({ at: NOW - minutesAgo * MIN, cpuMs })
  // 3-minute steps: 2.5 cores over 6 minutes (two steps) is busy; one step of 3 minutes is not yet; a quiet step in between breaks the run.
  assert.equal(isBusy([sample(6, 0), sample(3, 3 * MIN * 2.5), sample(0, 6 * MIN * 2.5)], { cores: 2, spanMs: 5 * MIN }), true)
  assert.equal(isBusy([sample(3, 0), sample(0, 3 * MIN * 2.5)], { cores: 2, spanMs: 5 * MIN }), false)
  assert.equal(isBusy([sample(6, 0), sample(3, 3 * MIN * 1.5), sample(0, 3 * MIN * 1.5 + 3 * MIN * 2.5)], { cores: 2, spanMs: 5 * MIN }), false)
  assert.equal(isBusy([sample(9, 0), sample(6, 3 * MIN * 0.1), sample(3, 3 * MIN * 0.1 + 3 * MIN * 2.5), sample(0, 3 * MIN * 0.1 + 6 * MIN * 2.5)], { cores: 2, spanMs: 5 * MIN }), true, 'an old quiet step before the run does not count')
  assert.equal(isBusy([], { cores: 2, spanMs: 5 * MIN }), false)
  // Through the loop's memory: a 12-minute-old Edge, starter gone, eating 12.8 cores: nothing at the first two samples (3 min of CPU), closed at the third.
  const memory = browserMemory()
  const young = (at, cpuMs) => [proc(500, 7000, 'msedge.exe', 0, { created: FILETIME(NOW - 12 * MIN), commandLine: cdp, cpuMs })]
  assert.deepEqual(watch(young(NOW, 12 * MIN * 12.8), memory, { now: NOW }), [])
  assert.deepEqual(watch(young(NOW, 15 * MIN * 12.8), memory, { now: NOW + 3 * MIN }), [])
  const third = watch(young(NOW, 18 * MIN * 12.8), memory, { now: NOW + 6 * MIN })
  assert.deepEqual(third.map(one => [one.pid, one.why, one.cores]), [[500, 'over 2 cores for 5 min', 12.8]])
  assert.equal(leakedWords(third[0], NOW + 6 * MIN), 'edge-cdp-b1126: a headless Edge (process 500, started 20:48, 18 min, 12.8 cores) with its starter gone, over 2 cores for 5 min')
  // A quiet one (0.4 cores) is left alone until the half hour.
  const quiet = browserMemory()
  for (const step of [0, 3, 6, 9, 12]) assert.deepEqual(watch(young(NOW, (12 + step) * MIN * 0.4), quiet, { now: NOW + step * MIN }), [], `${step} min`)
  assert.equal(watch(young(NOW, 30 * MIN * 0.4), quiet, { now: NOW + 18 * MIN }).length, 1)
  // The memory follows the processes: a key whose process is gone is dropped (its samples and its close), the same number created anew is another browser.
  assert.deepEqual([...memory.samples.keys()], [browserKey(young(NOW, 0)[0])])
  memory.closed.set(browserKey(young(NOW, 0)[0]), NOW)
  assert.deepEqual(watch([], memory, { now: NOW + 9 * MIN }), [])
  assert.deepEqual([memory.samples.size, memory.closed.size], [0, 0])
})

test('guard 4: a browser the board closed before and still sees carries its close time (the rule lists it, never a second kill)', () => {
  const memory = browserMemory()
  const list = [proc(500, 7000, 'msedge.exe', 800, { commandLine: cdp })]
  assert.equal(watch(list, memory)[0].closedAt, null)
  memory.closed.set(browserKey(list[0]), NOW - MIN)
  assert.equal(watch(list, memory)[0].closedAt, NOW - MIN)
})

test('closing: the tree is killed, then the tool\'s folder in the temp folder removed; outside it nothing is closed; a failed kill is not ok, a failed remove is said', async () => {
  const calls = []
  const kill = async pids => { calls.push(['kill', pids]); return { ok: true, why: null } }
  const remove = async folder => { calls.push(['remove', folder]); return { ok: true, why: null } }
  const one = { pid: 500, children: [501, 502], profile: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, folder: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, prefix: 'edge-cdp-b1126', startedAt: NOW }
  assert.deepEqual(await closeLeaked(one, { kill, remove }), { ok: true, why: null, profile: 'removed' })
  assert.deepEqual(calls, [['kill', [500, 501, 502]], ['remove', `${TEMP}\\edge-cdp-b1126-k3Xp9q`]])
  calls.length = 0
  // The evidence tool's folder, not the profile in it, is what goes.
  assert.deepEqual(await closeLeaked({ ...one, profile: `${TEMP}\\board-evidence-f9NyC5\\profile`, folder: `${TEMP}\\board-evidence-f9NyC5` }, { kill, remove }), { ok: true, why: null, profile: 'removed' })
  assert.deepEqual(calls.at(-1), ['remove', `${TEMP}\\board-evidence-f9NyC5`])
  calls.length = 0
  // Guard 1, at the last gate too: no folder in the temp folder, nothing is killed.
  assert.deepEqual(await closeLeaked({ ...one, folder: null }, { kill, remove }), { ok: false, why: 'its profile is not in the temp folder: not the board\'s to close', profile: null })
  assert.deepEqual(calls, [], 'nothing killed, nothing removed')
  assert.deepEqual(await closeLeaked(one, { kill: async () => ({ ok: false, why: 'access denied' }), remove }), { ok: false, why: 'access denied', profile: null })
  assert.deepEqual(await closeLeaked(one, { kill, remove: async () => ({ ok: false, why: 'EBUSY' }) }), { ok: true, why: null, profile: 'left (EBUSY)' })
})
