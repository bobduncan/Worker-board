// The one place where the board starts a program that makes something: Codex, for a picture of an idea on the
// Design tab. It runs only when the person asked for a picture on the board's own page, one at a time, with a time
// limit, in a folder of its own under the system's temporary folder (outside the game's and the board's folders).
// It is given the idea's own words and the reference pictures, nothing from a chat or a transcript. Codex is the
// OpenAI command line the person is signed in to; the board holds no key and calls no service itself.

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { writeAtomic } from './write.mjs'

/** The name Codex is asked to save its picture under, in its own folder. */
const PICTURE = 'picture.png'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/**
 * Where Codex is: the path the settings give, else the newest `codex.exe` under the Codex app's folder (its name
 * changes with every update of the app). Null when there is none.
 */
export async function findCodex({ given = '', env = process.env, platform = process.platform } = {}) {
  const isFile = async path => (await stat(path).then(found => found.isFile(), () => false))
  if (given !== '') return (await isFile(given)) ? given : null
  // B214: Codex as a program on the PATH, as it is installed on a Mac or Linux (and may be on Windows).
  const onPath = async () => {
    const byUpper = new Map(Object.entries(env).map(([name, value]) => [name.toUpperCase(), value]))
    const folders = String(byUpper.get('PATH') ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
    for (const folder of folders) {
      for (const name of platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']) if (await isFile(join(folder, name))) return join(folder, name)
    }
    return null
  }
  const home = platform === 'win32' ? env.LOCALAPPDATA ?? env.LocalAppData : null
  if (typeof home !== 'string' || home === '') return onPath()
  const bin = join(home, 'OpenAI', 'Codex', 'bin')
  let folders
  try {
    folders = await readdir(bin)
  } catch {
    return onPath()
  }
  const found = []
  for (const folder of folders) {
    const path = join(bin, folder, 'codex.exe')
    const info = await stat(path).catch(() => null)
    if (info !== null && info.isFile()) found.push({ path, at: info.mtimeMs })
  }
  return found.sort((a, b) => b.at - a.at)[0]?.path ?? onPath()
}

const lastLine = text => text.split('\n').map(line => line.trim()).filter(line => line !== '').pop() ?? ''

/**
 * Makes one picture. `command` starts Codex (its path, and for the tests a stand-in), `prompt` is what it is told,
 * `images` the pictures attached in order, `to` where the picture is copied (a prompt file goes beside it), and
 * `seconds` how long it may take. Answers `{ ok: true, seconds }` or `{ ok: false, why, seconds }`; it never
 * throws. `onChild` is handed the way to stop it, and its folder.
 */
export async function makePicture({ command, prompt, images, to, seconds, now = Date.now, onChild = () => {} }) {
  const began = now()
  const took = () => Math.round((now() - began) / 1000)
  let dir = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'worker-board-design-'))
    const own = dir
    const reply = join(dir, 'reply.txt')
    const args = [...command.slice(1), 'exec', '-C', dir, '-s', 'workspace-write', '--skip-git-repo-check', '--color', 'never', ...images.flatMap(image => ['-i', image.replace(/\\/g, '/')]), '-o', reply, '-']
    const ended = await new Promise(resolve => {
      const child = spawn(command[0], args, { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
      let said = ''
      let isLate = false
      const late = setTimeout(() => {
        isLate = true
        child.kill()
      }, seconds * 1000)
      // How to stop it, and its folder: the board ends both when it is closed in the middle of a picture.
      onChild(() => child.kill(), own)
      child.stderr.on('data', chunk => {
        said = (said + chunk).slice(-2000)
      })
      child.once('error', () => {
        clearTimeout(late)
        resolve({ code: null, isLate, said: 'Codex could not be started.' })
      })
      child.once('exit', code => {
        clearTimeout(late)
        resolve({ code, isLate, said })
      })
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    })
    if (ended.isLate) return { ok: false, why: `Codex took longer than ${seconds} seconds and was stopped.`, seconds: took() }

    const made = join(dir, PICTURE)
    const head = await readFile(made).then(bytes => bytes.subarray(0, 4), () => null)
    if (head === null || !head.equals(PNG)) {
      const words = await readFile(reply, 'utf8').catch(() => '')
      if (words.includes('NO_IMAGE_TOOL')) return { ok: false, why: 'Codex has no picture tool in this session.', seconds: took() }
      const said = lastLine(words) || lastLine(ended.said)
      return { ok: false, why: `Codex made no picture${ended.code === 0 || ended.code === null ? '' : ` (it ended with code ${ended.code})`}.${said === '' ? '' : ` It said: ${said.slice(0, 200)}`}`, seconds: took() }
    }
    await mkdir(dirname(to), { recursive: true })
    // B406: whole or not there, never half a picture.
    await writeAtomic(to, await readFile(made))
    // The words it was made with stay beside the picture, as with the pictures made by hand.
    await writeAtomic(to.replace(/\.png$/i, '.prompt.txt'), prompt).catch(() => {})
    return { ok: true, seconds: took() }
  } catch {
    return { ok: false, why: 'The picture could not be made or kept.', seconds: took() }
  } finally {
    // Its own folder, made above under the temporary folder: nothing else is ever removed.
    if (dir !== null) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
