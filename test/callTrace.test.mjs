// B1139 (X93): the work calls' trace (src/callTrace.mjs): every chat work call cut into its parts from the chat's send to the
// answer, with the loop's and the file system's delay and the CPU, one line per arrival in a local file; the reader
// (tools/call-trace-read.mjs) says where the slow ones waited. A made-up clock and folder, a board on a free port for the route.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import test from 'node:test'

import { createBoard } from '../server.mjs'
import { callTracer, cpuShare, probeMax, sentOf, TRACE_KEEP_MS } from '../src/callTrace.mjs'
import { partsOf, sharesOf, slowCalls } from '../tools/call-trace-read.mjs'
import { tempDir } from './tempDir.mjs'

const SENT = new Date(2026, 10, 23, 14, 56, 41).getTime()
const idAt = (ms, n = 1) => `0f3c9a2e-5d1b-4c7e-9a10-2b3c4d5e6f70-${ms}-${n}`

test('the live case of 2026-11-23 14:57: a call sent 19 s before its answer, with a 2 s handler, reads 19 s from its send and 17 s before the board took it', () => {
  let now = SENT + 17_000
  const tracer = callTracer({ now: () => now })
  const call = tracer.open({ request: idAt(SENT) })
  call.set({ action: 'pause-state' })
  now += 5
  call.mark('lock')
  call.mark('body')
  call.mark('known')
  call.mark('begin')
  now += 1500
  call.mark('fresh')
  now += 495
  call.mark('action')
  call.set({ chat: 'Worker 2', status: 200, rebuilds: 0 })
  const line = call.end()
  assert.equal(sentOf(idAt(SENT)), SENT)
  assert.deepEqual([line.sent, line.arrived, line.total, line.beforeBoard, line.marks.answered], [SENT, SENT + 17_000, 19_000, 17_000, 2000])
  assert.deepEqual([line.action, line.chat, line.status, line.attempt], ['pause-state', 'Worker 2', 200, 1])
  assert.deepEqual(partsOf(line), { beforeBoard: 17_000, lock: 5, body: 0, known: 0, begin: 0, fresh: 1500, action: 495, answered: 0 })
  // Once ended, the line is written once: a second end changes nothing.
  assert.equal(call.end(), null)
  assert.equal(tracer.lines().length, 1)
})

test('a repeated request id is one call from its first send: its second arrival is attempt 2, timed from the first send; the reader counts it once', () => {
  let now = SENT + 10_000
  const tracer = callTracer({ now: () => now })
  const first = tracer.open({ request: idAt(SENT) })
  now += 2000
  const again = tracer.open({ request: idAt(SENT) })
  again.set({ action: 'turn-ended', repeat: true })
  now += 100
  const second = again.end()
  now += 900
  first.set({ action: 'turn-ended' })
  const one = first.end()
  assert.deepEqual([one.attempt, second.attempt], [1, 2])
  assert.equal(second.total, 12_100)
  assert.equal(second.sent, one.sent)
  // The calls in flight at the arrival: the repeat came while the first ran.
  assert.deepEqual([one.inFlight, second.inFlight], [1, 2])
  const slow = slowCalls(tracer.lines(), { overMs: 5000 })
  assert.equal(slow.length, 1)
  assert.equal(slow[0].arrivals, 2)
  // A call without a request id (an older mod) counts by its own time, from its arrival.
  const loose = callTracer({ now: () => now }).open({ request: null })
  now += 6000
  const line = loose.end()
  assert.deepEqual([line.sent, line.total, line.marks.answered], [null, null, 6000])
  assert.equal(slowCalls([line], { overMs: 5000 }).length, 1)
})

test('the probes: the loop\'s delay, a file-system call still waiting counted by its age, the CPU share; each call reads the largest during it', async () => {
  let now = 1_000_000
  let release = null
  const stats = []
  const tracer = callTracer({
    now: () => now,
    statProbe: () => new Promise(done => {
      stats.push(now)
      release = done
    }),
    cpus: () => [{ times: { user: now, nice: 0, sys: 0, irq: 0, idle: now * 3 } }],
  })
  tracer.probe()
  now += 500
  tracer.probe()
  // The loop ran 4.5 s late.
  now += 5000
  tracer.probe()
  assert.equal(stats.length, 1, 'one file-system probe at a time')
  const call = tracer.open({ request: idAt(now - 1000) })
  now += 3000
  // The stat has waited 8.5 s and still waits: the call reads its age.
  const line = call.end()
  assert.equal(line.loopMax, 4500, 'the loop ran late after the chat sent it: that delay counts')
  assert.equal(line.fsMax, 8500)
  release()
  await new Promise(done => setImmediate(done))
  assert.equal(probeMax([{ at: 10, ms: 5 }, { at: 30, ms: 4 }, { at: 100, ms: 50 }], 20, 40), 4)
  assert.equal(probeMax([], 0, 10, 4), 6)
  assert.equal(cpuShare([{ times: { user: 0, nice: 0, sys: 0, irq: 0, idle: 0 } }], [{ times: { user: 60, nice: 0, sys: 2, irq: 0, idle: 38 } }]), 62)
  assert.equal(cpuShare(null, []), null)
})

test('the file: lines are appended in one write per moment, and cut to the newest day', async t => {
  const dir = await tempDir(t, 'call-trace-')
  const file = join(dir, 'call-trace.jsonl')
  const { appendFile, writeFile } = await import('node:fs/promises')
  let now = SENT
  const tracer = callTracer({
    now: () => now, append: text => appendFile(file, text), read: () => readFile(file, 'utf8'), rewrite: text => writeFile(file, text), appendMs: 10_000,
  })
  for (const n of [1, 2, 3]) tracer.open({ request: idAt(now, n) }).end()
  await tracer.flush()
  assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 3)
  now += TRACE_KEEP_MS + 1
  tracer.open({ request: idAt(now) }).end()
  await tracer.flush()
  await tracer.trim()
  const kept = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(kept.map(line => line.arrived), [now])
})

test('the reader says where the slow calls waited, part by part', () => {
  const calls = [
    { request: idAt(1), arrived: 9000, total: 9000, beforeBoard: 8000, marks: { lock: 10, body: 10, known: 10, begin: 10, fresh: 900, answered: 1000 } },
    { request: idAt(2), arrived: 2000, total: 2000, beforeBoard: 0, marks: { answered: 2000 } },
  ]
  assert.deepEqual(slowCalls(calls, { overMs: 5000 }).map(one => one.request), [idAt(1)])
  assert.deepEqual(sharesOf(slowCalls(calls, { overMs: 5000 })), { beforeBoard: 8000, lock: 10, body: 0, known: 0, begin: 0, fresh: 890, answered: 100 })
})

test('the route: a chat\'s work call is traced from the handler\'s take to its answer, by its request id, with its status; other routes are not', async t => {
  const KEY = 'c'.repeat(64)
  const traces = []
  const server = createBoard({
    token: 'a'.repeat(64), getState: async () => ({ readAt: 1, chats: [] }), say: async () => ({ ok: false, status: 400, why: 'No.' }), bridgeKey: KEY,
    traceCall: request => {
      const one = { request, marks: [], fields: {}, ended: 0 }
      traces.push(one)
      return { mark: name => one.marks.push(name), set: more => Object.assign(one.fields, more), end: () => { one.ended += 1 } }
    },
    bridgeWork: async (body, trace) => {
      trace?.mark('begin')
      return body?.action === 'take' ? { ok: false, status: 409, why: 'Held.' } : { ok: true, result: { text: 'Yours:' } }
    },
    take: async () => ({ ok: true, result: { messages: [] } }),
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const port = server.address().port
  const ask = (path, headers, body) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'Content-Type': 'application/json', 'X-Board-Key': KEY, ...headers } }, res => {
      res.resume()
      res.on('end', () => done(res.statusCode))
    })
    req.on('error', fail)
    req.end(body)
  })
  assert.equal(await ask('/api/bridge/work', { 'X-Work-Request': idAt(SENT) }, JSON.stringify({ action: 'next' })), 200)
  assert.equal(await ask('/api/bridge/work', {}, JSON.stringify({ action: 'take' })), 409)
  assert.equal(await ask('/api/bridge/take', {}, JSON.stringify({})), 200)
  await new Promise(done => setTimeout(done, 50))
  assert.equal(traces.length, 2)
  assert.deepEqual(traces.map(one => [one.request, one.marks, one.fields.status, one.ended]), [[idAt(SENT), ['lock', 'body', 'begin'], 200, 1], [null, ['lock', 'body', 'begin'], 409, 1]])
})

test('the server traces each part in order and changes no order of the call', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const part = (from, to) => server.slice(server.indexOf(from), server.indexOf(to, server.indexOf(from)))
  const bridge = part('    bridgeWork: counted(async (body, trace = null) => {', '    take: counted(async body => {')
  const order = ["requests.known(session, request)", "trace?.mark('known')", 'callStall(asked.action, session, request)', "trace?.mark('begin')", 'await checkFresh(body)', "trace?.mark('fresh')"]
  const at = order.map(one => bridge.indexOf(one))
  assert.ok(at.every((one, i) => one > -1 && (i === 0 || one > at[i - 1])), JSON.stringify(at))
  const action = part('  const workAction = async (body, as, trace = null) => {', 'if (done.ok && done.result.changed !== false)')
  assert.ok(action.indexOf("trace?.mark('ctx')") > action.indexOf('await workCtx(') && action.indexOf("trace?.mark('ctx')") < action.indexOf('await workApi('))
  assert.ok(action.indexOf("trace?.mark('action')") > action.indexOf('await workApi('))
  const once = part('  const bridgeWorkOnce = async (body, checked, trace = null) => {', '  const restartNow')
  assert.ok(once.indexOf("trace?.mark('decide')") > once.indexOf('await decideFor(checked.chat'))
  assert.ok(once.indexOf("trace?.mark('handout')") > once.indexOf('await handOut(store'))
  // The file is the board's own data, never one of a demo or a history copy; the probes start with the stall log's timer.
  assert.match(server, /const traceFile = isDemo \|\| historyFrom !== undefined \? null : join\(HERE, 'data', 'call-trace\.jsonl'\)/)
  assert.match(server, /watchLoop\(stalls\)\n[^\n]*\n\s+void tracer\?\.trim\(\)\n\s+tracer\?\.start\(\)/)
  assert.match(server, /if \(trace !== null\) res\.once\('close', \(\) => trace\.end\(\)\)/)
})
