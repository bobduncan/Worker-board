// B676: the picture window zooms. A picture opens fitted, a click goes to its full size at the point clicked, the wheel
// zooms around the pointer, a drag moves it and never loses it off the stage; a picture over the limit says so.
// Made-up sizes only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { findPicture, PICTURE_BYTES, pictureTooBig } from '../src/pictures.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const context = {}
vm.runInNewContext(`${script.slice(script.indexOf('// zoom:start'), script.indexOf('// zoom:end'))}
this.zoomFit = zoomFit; this.zoomFitted = zoomFitted; this.zoomClamp = zoomClamp; this.zoomAround = zoomAround
this.zoomClickScale = zoomClickScale; this.zoomLine = zoomLine; this.zoomIsFitted = zoomIsFitted`, context)
const plain = value => JSON.parse(JSON.stringify(value))

const box = { width: 1000, height: 600 }
const tall = { width: 2000, height: 3000 }
const small = { width: 300, height: 200 }

test('a picture opens fitted: scaled down to the window, centred, never enlarged', () => {
  assert.equal(context.zoomFit(tall, box), 0.2)
  assert.deepEqual(plain(context.zoomFitted(tall, box)), { scale: 0.2, x: 300, y: 0 })
  assert.deepEqual(plain(context.zoomFitted(small, box)), { scale: 1, x: 350, y: 200 })
  assert.equal(context.zoomLine(context.zoomFitted(tall, box), tall, box), '20 % · click: 100 %')
})

test('a click goes to 100 % at the point clicked, and the next click back to fitted', () => {
  const fitted = context.zoomFitted(tall, box)
  assert.equal(context.zoomClickScale(fitted, tall, box), 1)
  // the picture point under (500, 300) is (500 - 300) / 0.2 = 1000 and 300 / 0.2 = 1500: it stays under the pointer
  const full = plain(context.zoomAround(fitted, tall, box, 1, { x: 500, y: 300 }))
  assert.equal(full.scale, 1)
  assert.deepEqual([full.x, full.y], [-500, -1200])
  assert.equal(context.zoomLine(full, tall, box), '100 % · click: fit')
  assert.equal(context.zoomClickScale(full, tall, box), 0.2)
  // a picture no larger than the window goes to 200 %
  assert.equal(context.zoomClickScale(context.zoomFitted(small, box), small, box), 2)
})

test('the wheel zooms around the pointer, from fitted up to 800 %, and no further', () => {
  const fitted = context.zoomFitted(tall, box)
  const near = context.zoomAround(fitted, tall, box, 0.4, { x: 500, y: 300 })
  assert.equal(near.scale, 0.4)
  // the picture point under the pointer did not move
  assert.equal((500 - near.x) / near.scale, (500 - fitted.x) / fitted.scale)
  assert.equal(context.zoomAround(near, tall, box, 100, { x: 10, y: 10 }).scale, 8)
  assert.equal(context.zoomAround(near, tall, box, 0.001, { x: 10, y: 10 }).scale, 0.2)
})

test('a drag moves the picture to every edge and never loses it off the stage', () => {
  const full = { scale: 1, x: -1000, y: -1200 }
  const farLeftUp = plain(context.zoomClamp({ scale: 1, x: -99999, y: -99999 }, tall, box))
  assert.deepEqual([farLeftUp.x, farLeftUp.y], [-1000, -2400]) // the right and bottom edges reach the stage's
  const farRightDown = plain(context.zoomClamp({ scale: 1, x: 99999, y: 99999 }, tall, box))
  assert.deepEqual([farRightDown.x, farRightDown.y], [0, 0]) // the top and left edges
  assert.deepEqual(plain(context.zoomClamp(full, tall, box)), full)
  // smaller than the stage on one side: centred on that side
  assert.deepEqual(plain(context.zoomClamp({ scale: 1, x: 5, y: 5 }, { width: 400, height: 3000 }, box)), { scale: 1, x: 300, y: 0 })
})

test('the window is one code path: every opener shows through showPicture; a click on the picture zooms and no longer closes', () => {
  // the window is opened in showPicture only (the file view's own box is another dialog)
  const shower = script.slice(script.indexOf('function showPicture('), script.indexOf('function openPicture('))
  assert.equal((shower.match(/box\.showModal\(\)/g) ?? []).length, 1)
  assert.equal((script.match(/\$\('lightbox'\)\.showModal\(\)/g) ?? []).length, 0)
  assert.match(script, /showPicture\(URL\.createObjectURL\(await answer\.blob\(\)\), shown\)/)
  assert.match(script, /if \(event\.target === image\) \{[^}]*zoomClickScale[^}]*lightbox.view = zoomAround[^}]*return drawLightbox\(\)\n  \}\n  \$\('lightbox'\)\.close\(\)/s)
  assert.match(script, /\$\('lightbox-stage'\)\.addEventListener\('wheel'[\s\S]*?\{ passive: false \}\)/)
})

test('a picture up to 32 MB opens; a bigger one is reported with its size, never an empty window', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zoom-pic-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await mkdir(join(root, 'pictures', 'demo'), { recursive: true })
  await writeFile(join(root, 'pictures', 'demo', 'big.png'), Buffer.alloc(17 * 1024 * 1024))
  await writeFile(join(root, 'pictures', 'demo', 'huge.png'), Buffer.alloc(PICTURE_BYTES + 1))
  assert.equal(PICTURE_BYTES, 32 * 1024 * 1024)
  assert.equal((await findPicture(root, ['pictures'], 'pictures/demo/big.png'))?.type, 'image/png')
  assert.equal(await pictureTooBig(root, ['pictures'], 'pictures/demo/big.png'), null)
  assert.equal(await findPicture(root, ['pictures'], 'pictures/demo/huge.png'), null)
  assert.equal(await pictureTooBig(root, ['pictures'], 'pictures/demo/huge.png'), PICTURE_BYTES + 1)
  assert.equal(await pictureTooBig(root, ['pictures'], 'pictures/demo/none.png'), null)
  // the page shows the server's line in the window
  assert.match(script, /answer\.status === 413\) pictureProblems\.set\(path/)
})
