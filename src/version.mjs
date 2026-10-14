// B142: which version of the board runs, and whether its folder holds a newer one. The version is the git commit the
// board was started on; a merge moves the folder on. A newer server needs the board started anew; a newer page only
// needs the page loaded again, because the board reads its page from the folder at every load.

import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** What a changed file of the board's folder is: the page's (`page`), the server's (`server`), or neither (null). */
export function kindOf(path) {
  if (path.startsWith('public/')) return 'page'
  if (path === 'server.mjs' || path === 'run-game.mjs' || path === 'config.json' || path.startsWith('src/')) return 'server'
  return null
}

const line = text => (typeof text === 'string' && text.trim() !== '' ? text.trim() : null)

/**
 * The board's folder as git sees it now: its commit (`head`), the last commit that changed its page (`page`), and
 * whether a file of its server changed since `running`, the commit the board was started on. `run(args)` is git
 * (folders.mjs, `gitRunner`); without its answer nothing is said to be newer.
 */
export async function readVersion(run, folder, running) {
  const head = line(await run(['-C', folder, 'rev-parse', '--short', 'HEAD']))
  const page = line(await run(['-C', folder, 'log', '-1', '--format=%h', 'HEAD', '--', 'public']))
  let isServerNewer = false
  if (head !== null && running !== null && head !== running) {
    const names = await run(['-C', folder, 'diff', '--name-only', running, 'HEAD'])
    isServerNewer = typeof names === 'string' && names.split('\n').some(name => kindOf(name.trim()) === 'server')
  }
  return { head, page, isServerNewer }
}

const LOAD_SECONDS = 20

/**
 * Loads a module once in a process of its own: before the board ends for a new version, that version must load,
 * or there would be no board at all. `{ ok, why }`, with the error's one line when it does not load.
 */
export function loads(file) {
  return new Promise(resolve => {
    execFile(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(file).href],
      { timeout: LOAD_SECONDS * 1000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) return resolve({ ok: true, why: null })
        const lines = String(stderr).split(/\r?\n/).map(part => part.trim()).filter(part => part !== '')
        const why = lines.find(part => /^(\w*Error|Error)\b/.test(part)) ?? lines.at(-1) ?? (error.killed ? 'it did not load in time' : 'it did not load')
        resolve({ ok: false, why: why.slice(0, 200) })
      })
  })
}
