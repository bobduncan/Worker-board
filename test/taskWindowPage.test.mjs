// B713: the step window in a real page. The B701 and B706 tests read the window's words through a script; what the person
// sees (a picture cropped by a fixed box, loud chips, a title on two lines, a tab that opens nothing) was only ever
// judged by eye, and came back failed twice. This opens the demo board's step B40 in a headless browser (tools/task-probe.mjs,
// the probe that shoots the window beside the mockup) and reads what is drawn. Skipped where no Edge or Chrome is.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { findBrowser } from '../tools/evidence.mjs'
import { probeStep } from '../tools/task-probe.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const browser = findBrowser()

/** A free port of this PC. */
const freePort = () => new Promise((done, fail) => {
  const probe = createServer()
  probe.on('error', fail)
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)) })
})

/** The demo board on a port of its own, for the run of `use`; stopped after it. */
async function withDemoBoard(use) {
  const port = await freePort()
  const board = spawn(process.execPath, [join(ROOT, 'server.mjs'), '--demo', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' })
  const dir = await mkdtemp(join(tmpdir(), 'task-window-page-'))
  try {
    for (let i = 0; i < 60; i++) {
      if (await fetch(`http://127.0.0.1:${port}/`).then(answer => answer.ok, () => false)) break
      await new Promise(done => setTimeout(done, 250))
    }
    return await use({ address: `http://127.0.0.1:${port}`, dir })
  } finally {
    board.kill()
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

const skip = browser === null && 'no Edge or Chrome on this PC'

test('B713: the Summary window as drawn: Summary opens first, every picture in its own shape, quiet chips, the title on one line, the advised card marked', { skip }, async () => {
  await withDemoBoard(async ({ address, dir }) => {
    const { layout } = await probeStep({ board: address, step: 'B40', out: join(dir, 'summary.png'), browser })
    assert.equal(layout.opened, 'Summary', 'the window opens on its Summary tab')
    assert.equal(layout.loaded, layout.pictures)
    assert.equal(layout.figures.length, 2)
    // Each picture's box has its picture's shape (the target is wide, the latest try tall): no fixed box, no crop, no bars.
    for (const one of layout.figures) {
      assert.equal(one.fit, 'contain')
      assert.ok(Math.abs(one.box - one.natural) / one.natural < 0.03, `a picture of shape ${one.natural.toFixed(2)} is drawn in a box of ${one.box.toFixed(2)}`)
    }
    assert.ok(layout.figures[0].natural > 1.5 && layout.figures[1].natural < 1, 'the two pictures differ in shape')
    // Side by side they are as tall as each other.
    assert.ok(Math.abs(layout.figures[0].height - layout.figures[1].height) < 4, 'pictures in a row are as tall as each other')
    // The chips are the mockup's quiet pills: the same dark ground, none filled with a colour of its own.
    assert.ok(layout.chips.length >= 3)
    for (const chip of layout.chips) assert.equal(chip.background, 'rgb(23, 34, 58)', `the chip "${chip.text}" is quiet`)
    assert.equal(layout.titleLines, 1, 'the title stays on one line')
    assert.deepEqual(layout.advised, ['advised'], 'the advised card carries its mark')
  })
})

test('B713: the Settings tab opens its own tab, with the step\'s facts', { skip }, async () => {
  await withDemoBoard(async ({ address, dir }) => {
    const { layout } = await probeStep({ board: address, step: 'B40', tab: 'settings', out: join(dir, 'settings.png'), browser })
    assert.equal(layout.opened, 'Summary')
    assert.equal(layout.on, 'Settings')
    assert.equal(layout.facts, true, 'the Settings tab holds the worker and the state')
    assert.deepEqual(layout.figures, [], 'no Summary pictures on the Settings tab')
  })
})
