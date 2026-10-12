// Serves one working folder's game for the person to look at, and ends by itself. Started by the board (see
// src/games.mjs), one process per folder:
//
//   node run-game.mjs --folder <working folder> --port 5300 --idle 30 --grace 120 --cache <folder for the cache>
//
// It uses the folder's own vite with the folder's own configuration, so the game runs as the worker's own start
// of it does. Two things differ: it listens on this machine only, and vite's cache is kept with the board, so
// nothing is written into the folder's `node_modules` while a worker may be running the game from it too.
//
// It ends when no tab has shown the game for `--idle` seconds (a tab keeps a connection open as long as it shows
// the game), or when nobody opened it within `--grace` seconds of its start. It prints `ready <port>` once.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { idleWatch } from './src/games.mjs'

const HOST = '127.0.0.1'

const args = process.argv.slice(2)
const argAfter = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const seconds = (name, usual) => {
  const value = Number(argAfter(name))
  return (Number.isFinite(value) && value > 0 ? value : usual) * 1000
}

/** The folder's own vite: the file its package names as its entry. */
async function viteOf(folder) {
  const home = join(folder, 'node_modules', 'vite')
  const pack = JSON.parse(await readFile(join(home, 'package.json'), 'utf8'))
  const main = pack.exports?.['.']
  const entry = typeof main === 'string' ? main : main?.import?.default ?? main?.import ?? main?.default ?? pack.module ?? pack.main ?? 'dist/node/index.js'
  return import(pathToFileURL(join(home, entry)).href)
}

async function main() {
  const folder = argAfter('--folder')
  const port = Number(argAfter('--port'))
  if (folder === undefined || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Needs --folder and --port.')

  const vite = await viteOf(folder)
  const server = await vite.createServer({
    root: folder,
    cacheDir: argAfter('--cache'),
    clearScreen: false,
    // A port in use is not a failure: the next free one is taken, and the board is told which.
    server: { host: HOST, port, strictPort: false, open: false },
  })
  const watch = idleWatch({ idleMs: seconds('--idle', 30), graceMs: seconds('--grace', 120), now: Date.now() })
  server.httpServer.on('connection', socket => {
    watch.opened()
    socket.once('close', () => watch.closed(Date.now()))
  })
  await server.listen()
  console.log(`ready ${server.httpServer.address().port}`)

  const timer = setInterval(() => {
    if (!watch.isOver(Date.now())) return
    clearInterval(timer)
    // Nothing is open, so there is nothing to wait for; a close that hangs must not keep the game alive.
    setTimeout(() => process.exit(0), 3000).unref()
    Promise.resolve(server.close()).catch(() => {}).finally(() => process.exit(0))
  }, 500)
}

main().catch(error => {
  console.error(error?.message ?? 'The game could not be served.')
  process.exit(1)
})
