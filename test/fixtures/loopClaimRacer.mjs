// F55: one racer of test/supervisor/loopClaimRace.test.mjs: a process that holds the board's own loop-owner check on a real lock
// file (the same ports server.mjs builds: the lock written unflushed, the claim through claimFile.mjs) and runs it once for every
// "go <round>" line on stdin, answering "<round> <true|false>" on stdout. RACER_DEAD names pids to count as dead (a seeded claim).
//   node test/fixtures/loopClaimRacer.mjs <lock file> <port>

import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

import { claimFileOf, claimPorts } from '../../src/supervisor/claimFile.mjs'
import { loopOwner } from '../../src/supervisor/loop.mjs'
import { writeUnflushed } from '../../src/write.mjs'

const [lock, port] = process.argv.slice(2)
const dead = new Set((process.env.RACER_DEAD ?? '').split(',').filter(Boolean).map(Number))
const owner = loopOwner({
  read: () => readFile(lock, 'utf8'),
  write: text => writeUnflushed(lock, text),
  claim: claimPorts(claimFileOf(lock)),
  alive: pid => {
    if (dead.has(pid)) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error?.code === 'EPERM'
    }
  },
  pid: process.pid,
  port: Number(port),
  now: Date.now,
})

let chain = Promise.resolve()
const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  if (line === 'quit') { lines.close(); return }
  const round = line.split(' ')[1]
  chain = chain.then(async () => {
    let owns
    try {
      owns = await owner()
    } catch (error) {
      owns = `error ${error?.message ?? error}`
    }
    process.stdout.write(`${round} ${owns}\n`)
  })
})
lines.on('close', () => { chain.then(() => process.exit(0)) })
process.stdout.write(`ready ${process.pid}\n`)
