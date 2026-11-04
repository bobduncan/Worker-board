// The made-up start-board.mjs of test/landScript.test.mjs: starts this folder's made-up board in the background (the port is
// in data/port.txt) and ends with 0 once it answers, as the real one does.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const port = Number(readFileSync(join(HERE, 'data', 'port.txt'), 'utf8'))
const child = spawn(process.execPath, [join(HERE, 'server.mjs')], { cwd: HERE, detached: true, stdio: 'ignore', windowsHide: true })
child.unref()
// No process.exit right after a detached spawn: libuv may still be closing its handle (the real start-board.mjs waits a second).
process.exitCode = 1
for (let tries = 0; tries < 100 && process.exitCode !== 0; tries += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/`)).ok) process.exitCode = 0
  } catch {
    // Not up yet.
  }
  if (process.exitCode !== 0) await new Promise(done => setTimeout(done, 100))
}
if (process.exitCode !== 0) console.error('the made-up board did not start')
