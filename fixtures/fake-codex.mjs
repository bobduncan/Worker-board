// A stand-in for the Codex command line, for the tests: it is started as Codex is (`exec -C <dir> ... -o <reply> -`),
// reads what it is told from its input, and behaves by a word in it. It makes no picture of anything: a "picture"
// is a few bytes that begin as a PNG does.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const after = name => args[args.indexOf(name) + 1]
const dir = after('-C')
const reply = after('-o')

let told = ''
for await (const chunk of process.stdin) told += chunk

// What it was started with, for a test that asks.
if (process.env.FAKE_CODEX_LOG) {
  const images = args.flatMap((arg, index) => (arg === '-i' ? [args[index + 1]] : []))
  await writeFile(process.env.FAKE_CODEX_LOG, JSON.stringify({ args, images, told, cwd: process.cwd(), codexHome: process.env.CODEX_HOME }))
}

if (told.includes('SLOW')) await new Promise(done => setTimeout(done, 30_000))
if (told.includes('NOTOOL')) {
  await writeFile(reply, 'NO_IMAGE_TOOL\n')
} else if (told.includes('NOTHING')) {
  await writeFile(reply, 'I could not make that.\n')
  process.exitCode = 3
} else if (told.includes('DRAWN')) {
  // Drew the picture, but its sandbox refused the copy into the job folder: it stays in Codex's own folder (B1310).
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9])
  const count = told.includes('DRAWNTWO') ? 2 : 1
  for (let n = 1; n <= count; n++) {
    await mkdir(join(process.env.CODEX_HOME, 'generated_images', `session-${n}`), { recursive: true })
    await writeFile(join(process.env.CODEX_HOME, 'generated_images', `session-${n}`, `exec-${n}.png`), png)
  }
  await writeFile(reply, 'The image was generated, but the workspace rejected the copy command.\n')
} else if (told.includes('TEXTFILE')) {
  await writeFile(join(dir, 'picture.png'), 'this is no picture')
} else {
  await writeFile(join(dir, 'picture.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]))
  await writeFile(reply, 'Saved picture.png\n')
}
