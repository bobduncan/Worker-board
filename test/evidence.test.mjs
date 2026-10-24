// B357: the evidence picture every check shows: the reference left, the result right at the same height (the result
// never larger than it was taken), the step's id and title on top, the agreed points ticked green or red and the score
// beside its target below. Without a reference only the ticked list. It knows nothing of the game.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

import { evidenceHtml, findBrowser, outPath, parseArgs, pngSize, readPoints, renderEvidence } from '../tools/evidence.mjs'

/** A plain PNG of one colour, made here so the test needs no picture files. */
function png(width, height, [r, g, b]) {
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = bytes => {
    let c = 0xffffffff
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc(body))
    return Buffer.concat([head, body, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

test('the arguments name the pictures, the points, the score and where it goes', () => {
  const args = parseArgs(['--reference', 'ref.png', '--result', 'res.png', '--points', 'p.json', '--score', '63', '--target', '75', '--step', 'B314', '--title', 'Fight Bats', '--out', 'x.png'])
  assert.deepEqual(args, { reference: 'ref.png', result: 'res.png', points: 'p.json', score: 63, target: 75, step: 'B314', title: 'Fight Bats', out: 'x.png', height: 720 })
  assert.equal(parseArgs(['--result', 'r.png', '--points', '[]', '--step', 'B1', '--height', '540']).height, 540)
  assert.throws(() => parseArgs(['--result', 'r.png', '--step', 'B1']), /--points/)
  assert.throws(() => parseArgs(['--points', '[]']), /--step/)
  assert.throws(() => parseArgs(['--points', '[]', '--step', 'B1', '--score', 'lots']), /--score/)
  assert.throws(() => parseArgs(['--points', '[]', '--step', 'B1', '--colour', 'red']), /--colour/)
})

test('the points come as JSON or a file of it, each passed or failed', async () => {
  assert.deepEqual(await readPoints('[{"text":"Bats fly","result":"pass"},{"text":"The card says so","pass":false}]'), [
    { text: 'Bats fly', verdict: 'pass' },
    { text: 'The card says so', verdict: 'fail' },
  ])
  const dir = await mkdtemp(join(tmpdir(), 'evidence-points-'))
  try {
    const file = join(dir, 'points.json')
    await writeFile(file, JSON.stringify([{ text: 'One hit is enough', result: 'fail' }]))
    assert.deepEqual(await readPoints(file), [{ text: 'One hit is enough', verdict: 'fail' }])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  await assert.rejects(readPoints('[{"text":"no verdict"}]'), /pass, fail or ask/)
  await assert.rejects(readPoints('[{"result":"pass"}]'), /text/)
})

test('without --out the picture lands in the project\'s picture folder under the step', () => {
  const config = { project: join('C:', 'proj'), pictureRoots: ['art-inbox', 'pictures'] }
  assert.equal(outPath(config, { step: 'B314' }), join('C:', 'proj', 'art-inbox', 'B314', 'evidence.png'))
  assert.equal(outPath(config, { step: 'B314', out: 'here.png' }), 'here.png')
  assert.throws(() => outPath(config, { step: '../x' }), /step/)
})

test('the page holds the title, both pictures, the ticks in their colours and the score beside its target', () => {
  const html = evidenceHtml({
    step: 'B314', title: 'Fight <Bats>', reference: 'data:image/png;base64,AA', result: 'data:image/png;base64,BB', height: 720,
    points: [{ text: 'Bats fly', verdict: 'pass' }, { text: 'The card says so', verdict: 'fail' }], score: 63, target: 75,
  })
  assert.match(html, /B314/)
  assert.match(html, /Fight &lt;Bats&gt;/)
  assert.match(html, /id="reference"[^>]*src="data:image\/png;base64,AA"/)
  assert.match(html, /id="result"[^>]*src="data:image\/png;base64,BB"/)
  assert.match(html, /class="point pass"[^>]*>[\s\S]*?Bats fly/)
  assert.match(html, /class="point fail"[^>]*>[\s\S]*?The card says so/)
  assert.match(html, /63[\s\S]*75/)
  assert.match(html, /class="score below"/)
  assert.doesNotMatch(evidenceHtml({ step: 'B1', title: 't', result: 'data:,', points: [], score: 80, target: 75, height: 720 }), /class="score below"/)
  const list = evidenceHtml({ step: 'B2', title: 'A rule', points: [{ text: 'It holds', verdict: 'pass' }], height: 720 })
  assert.doesNotMatch(list, /<img/)
  assert.doesNotMatch(list, /class="score/)
})

test('B569: Before | After: both pictures, labelled, no points; the ticked list alone is refused', () => {
  assert.deepEqual(parseArgs(['--step', 'B5', '--before', 'b.png', '--after', 'a.png']), { title: '', step: 'B5', before: 'b.png', after: 'a.png', height: 720 })
  assert.throws(() => parseArgs(['--step', 'B5', '--before', 'b.png']), /--before and --after go together/)
  assert.throws(() => parseArgs(['--step', 'B5', '--after', 'a.png', '--before', 'b.png', '--result', 'r.png']), /no --reference or --result/)
  assert.throws(() => parseArgs(['--step', 'B5', '--points', '[]']), /none \(nothing on screen\)/)
  const config = { project: join('C:', 'proj'), pictureRoots: ['art-inbox'] }
  assert.equal(outPath(config, { step: 'B5', before: 'b.png' }), join('C:', 'proj', 'art-inbox', 'B5', 'before-after.png'))
  const html = evidenceHtml({ step: 'B5', title: 'Short cards', before: 'data:image/png;base64,AA', after: 'data:image/png;base64,BB', height: 720 })
  assert.match(html, /<figcaption>Before<\/figcaption><img id="reference"[^>]*src="data:image\/png;base64,AA"/)
  assert.match(html, /<figcaption>After<\/figcaption><img id="result"[^>]*src="data:image\/png;base64,BB"/)
  assert.doesNotMatch(html, /id="points"|agreed points/)
})

const browser = findBrowser()

test('it renders: reference left, result right at the same height, never above the result\'s own size, ticks below', { skip: browser === null && 'no Edge or Chrome on this PC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'evidence-render-'))
  try {
    await writeFile(join(dir, 'ref.png'), png(400, 300, [200, 30, 30]))
    await writeFile(join(dir, 'big.png'), png(1280, 720, [30, 30, 200]))
    await writeFile(join(dir, 'small.png'), png(200, 100, [30, 200, 30]))
    const points = [{ text: 'First point', verdict: 'pass' }, { text: 'Second point', verdict: 'fail' }, { text: 'Third point', verdict: 'ask' }]

    const one = await renderEvidence({ browser, step: 'B9', title: 'A unit', reference: join(dir, 'ref.png'), result: join(dir, 'big.png'), points, score: 70, target: 75, height: 720, out: join(dir, 'one.png') })
    assert.equal(one.layout.reference.height, 720)
    assert.equal(one.layout.result.height, 720)
    assert.equal(one.layout.result.width, 1280)
    assert.equal(one.layout.reference.width, 960)
    assert.ok(one.layout.reference.x + one.layout.reference.width <= one.layout.result.x, 'the reference stands left of the result')
    assert.ok(one.layout.points.y >= one.layout.result.y + one.layout.result.height, 'the ticks stand below the pictures')
    assert.equal(one.layout.ticks, 3)
    assert.equal(one.layout.asks, 1)
    const size = pngSize(await readFile(join(dir, 'one.png')))
    assert.deepEqual(size, { width: one.layout.width, height: one.layout.height })

    const two = await renderEvidence({ browser, step: 'B9', title: 'A unit', reference: join(dir, 'ref.png'), result: join(dir, 'small.png'), points, height: 720, out: join(dir, 'two.png') })
    assert.equal(two.layout.result.height, 100, 'a small result is never enlarged')
    assert.equal(two.layout.reference.height, 100)

    // B569: the ticked list alone is no picture any more.
    await assert.rejects(renderEvidence({ browser, step: 'B9', title: 'A rule', points, height: 720, out: join(dir, 'three.png') }), /none \(nothing on screen\)/)

    // B569: Before | After, at one height, with no points below.
    const four = await renderEvidence({ browser, step: 'B9', title: 'A card', before: join(dir, 'ref.png'), after: join(dir, 'big.png'), height: 720, out: join(dir, 'four.png') })
    assert.equal(four.layout.reference.height, 720)
    assert.equal(four.layout.result.height, 720)
    assert.ok(four.layout.reference.x + four.layout.reference.width <= four.layout.result.x, 'before stands left of after')
    assert.equal(four.layout.points, null)
    assert.equal(four.layout.ticks, 0)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B369: a point only the person can judge is marked ask: its own colour, "for you", and counted apart', async () => {
  assert.deepEqual(await readPoints('[{"text":"Feels fast","result":"ask"},{"text":"Reads at 48 px","verdict":"pass"}]'), [
    { text: 'Feels fast', verdict: 'ask' },
    { text: 'Reads at 48 px', verdict: 'pass' },
  ])
  // The lines a result check keeps ("pass: ...") are read as they are.
  assert.deepEqual(await readPoints('["pass: One", "fail: Two", "ask: Three"]'), [
    { text: 'One', verdict: 'pass' }, { text: 'Two', verdict: 'fail' }, { text: 'Three', verdict: 'ask' },
  ])
  await assert.rejects(readPoints('["maybe: Four"]'), /pass, fail or ask/)
  const html = evidenceHtml({ step: 'B3', title: 'A look', points: [{ text: 'Bats fly', verdict: 'pass' }, { text: 'No card', verdict: 'fail' }, { text: 'Feels fast', verdict: 'ask' }], height: 720 })
  assert.match(html, /class="point ask"[^>]*>[\s\S]*?Feels fast[\s\S]*?for you/)
  assert.match(html, /1 pass · 1 fail · 1 for you, of 3 agreed points/)
  const colourOf = kind => html.match(new RegExp(`\\.${kind} \\.mark \\{ color: (#[0-9a-f]{6})`))[1]
  assert.notEqual(colourOf('ask'), colourOf('pass'), 'not green')
  assert.notEqual(colourOf('ask'), colourOf('fail'), 'not red')
  assert.match(evidenceHtml({ step: 'B4', title: 't', points: [{ text: 'x', verdict: 'pass' }], height: 720 }), /1 of 1 agreed points pass/)
})
